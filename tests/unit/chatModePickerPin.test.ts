/**
 * @vitest-environment jsdom
 *
 * Pin: ChatModePicker — button label+title+chevron, mode item list, active
 * class, click → setMode + emit + close, Agent reveals autonomy sub-list +
 * active autonomy row + click fires onDidChangeAutonomy + closes, non-Agent
 * does NOT render autonomy section, outside-click close, dispose teardown,
 * onDidChangeMode → label refresh.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatModePicker } from "../../src/built-in/chat/pickers/chatModePicker";
import { ChatMode } from "../../src/services/chatTypes.js";
import { Emitter } from "../../src/platform/events.js";

function makeServices(initial: { mode: ChatMode; available?: ChatMode[] }) {
  const state = { mode: initial.mode, available: initial.available ?? [ChatMode.Edit, ChatMode.Agent] };
  const emitter = new Emitter<void>();
  return {
    emitter,
    services: {
      getMode: vi.fn(() => state.mode),
      setMode: vi.fn((m: ChatMode) => { state.mode = m; }),
      getAvailableModes: vi.fn(() => state.available),
      onDidChangeMode: emitter.event,
    },
    setMode(m: ChatMode) { state.mode = m; },
  };
}

describe("built-in/chat/pickers/chatModePicker — ChatModePicker", () => {
  let container: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renders root + button with icon, label, chevron, title", () => {
    const { services } = makeServices({ mode: ChatMode.Edit });
    new ChatModePicker(container, services as any);
    const btn = container.querySelector("button.parallx-chat-picker-btn--mode") as HTMLButtonElement;
    expect(btn.type).toBe("button");
    expect(btn.querySelector(".parallx-chat-picker-icon")).not.toBeNull();
    expect(btn.querySelector(".parallx-chat-picker-label")?.textContent).toBe("Edit");
    expect(btn.querySelector(".parallx-chat-picker-chevron")).not.toBeNull();
    expect(btn.title).toBe("Edit mode — structured canvas changes");
  });

  it("onDidChangeMode triggers label/title refresh", () => {
    const ctx = makeServices({ mode: ChatMode.Edit });
    new ChatModePicker(container, ctx.services as any);
    ctx.setMode(ChatMode.Agent);
    ctx.emitter.fire();
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.querySelector(".parallx-chat-picker-label")?.textContent).toBe("Agent");
    expect(btn.title).toBe("Agent mode — awake, action-capable, approval-aware");
  });

  it("clicking button opens dropdown with one row per available mode and active class on current", () => {
    const { services } = makeServices({ mode: ChatMode.Agent });
    new ChatModePicker(container, services as any);
    (container.querySelector("button") as HTMLButtonElement).click();
    const items = [...document.querySelectorAll(".parallx-chat-picker-dropdown .parallx-chat-picker-item")];
    expect(items.map(i => i.querySelector(".parallx-chat-picker-item-name")?.textContent))
      .toEqual(["Edit", "Agent"]);
    expect(items[0].classList.contains("parallx-chat-picker-item--active")).toBe(false);
    expect(items[1].classList.contains("parallx-chat-picker-item--active")).toBe(true);
  });

  it("clicking a mode row calls setMode, fires onDidSelectMode, closes dropdown", () => {
    const ctx = makeServices({ mode: ChatMode.Edit });
    const picker = new ChatModePicker(container, ctx.services as any);
    const selected: ChatMode[] = [];
    picker.onDidSelectMode(m => selected.push(m));
    (container.querySelector("button") as HTMLButtonElement).click();
    const items = [...document.querySelectorAll(".parallx-chat-picker-dropdown .parallx-chat-picker-item")];
    (items[1] as HTMLElement).click(); // Agent
    expect(ctx.services.setMode).toHaveBeenCalledWith(ChatMode.Agent);
    expect(selected).toEqual([ChatMode.Agent]);
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("Edit mode dropdown does NOT render autonomy header/rows", () => {
    const { services } = makeServices({ mode: ChatMode.Edit });
    new ChatModePicker(container, services as any);
    (container.querySelector("button") as HTMLButtonElement).click();
    expect(document.querySelector(".parallx-chat-picker-autonomy-header")).toBeNull();
    expect(document.querySelector(".parallx-chat-picker-autonomy-row")).toBeNull();
    expect(document.querySelector(".parallx-chat-picker-separator")).toBeNull();
  });

  it("Agent mode dropdown renders separator + 'Agent autonomy' header + 4 rows in fixed order with 'allow-reads' default active", () => {
    const { services } = makeServices({ mode: ChatMode.Agent });
    new ChatModePicker(container, services as any);
    (container.querySelector("button") as HTMLButtonElement).click();
    expect(document.querySelector(".parallx-chat-picker-separator")).not.toBeNull();
    expect(document.querySelector(".parallx-chat-picker-autonomy-header")?.textContent).toBe("Agent autonomy");
    const rows = [...document.querySelectorAll(".parallx-chat-picker-autonomy-row")];
    expect(rows.map(r => r.querySelector(".parallx-chat-picker-item-name")?.textContent))
      .toEqual(["Manual", "Allow Reads", "Allow Safe", "Custom"]);
    expect(rows[1].classList.contains("parallx-chat-picker-autonomy-row--active")).toBe(true);
    [0, 2, 3].forEach(i => expect(rows[i].classList.contains("parallx-chat-picker-autonomy-row--active")).toBe(false));
  });

  it("autonomy click fires onDidChangeAutonomy, updates picker.autonomyLevel, stops propagation, closes dropdown", () => {
    const { services } = makeServices({ mode: ChatMode.Agent });
    const picker = new ChatModePicker(container, services as any);
    const autonomies: string[] = [];
    picker.onDidChangeAutonomy(l => autonomies.push(l));
    (container.querySelector("button") as HTMLButtonElement).click();
    const rows = [...document.querySelectorAll(".parallx-chat-picker-autonomy-row")];
    // Click Manual.
    (rows[0] as HTMLElement).click();
    expect(autonomies).toEqual(["manual"]);
    expect(picker.autonomyLevel).toBe("manual");
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("outside mousedown closes dropdown; inside does not", () => {
    const { services } = makeServices({ mode: ChatMode.Edit });
    new ChatModePicker(container, services as any);
    (container.querySelector("button") as HTMLButtonElement).click();
    const dropdown = document.querySelector(".parallx-chat-picker-dropdown") as HTMLElement;
    dropdown.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".parallx-chat-picker-dropdown")).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("button click toggles dropdown closed when already open", () => {
    const { services } = makeServices({ mode: ChatMode.Edit });
    new ChatModePicker(container, services as any);
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).not.toBeNull();
    btn.click();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("dispose removes root + closes any open dropdown", () => {
    const { services } = makeServices({ mode: ChatMode.Edit });
    const picker = new ChatModePicker(container, services as any);
    (container.querySelector("button") as HTMLButtonElement).click();
    picker.dispose();
    expect(container.querySelector(".parallx-chat-mode-picker")).toBeNull();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });
});
