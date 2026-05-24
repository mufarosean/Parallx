/**
 * @vitest-environment jsdom
 *
 * Pin: ChatContextWindowPicker — label "Ctx: auto" / "Ctx: 64K", 7 presets in
 * order, active class + check icon, pick fires onPick + updates label + closes,
 * outside-click close, dispose teardown.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatContextWindowPicker } from "../../src/built-in/chat/pickers/chatContextWindowPicker";

describe("built-in/chat/pickers/chatContextWindowPicker — ChatContextWindowPicker", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("appends root + button with title + chevron + 'Ctx: auto' label initially", () => {
    new ChatContextWindowPicker(container, { onPick: vi.fn() });
    const root = container.querySelector(".parallx-chat-ctx-picker")!;
    const btn = root.querySelector("button.parallx-chat-picker-btn.parallx-chat-picker-btn--context") as HTMLButtonElement;
    expect(btn.type).toBe("button");
    expect(btn.title).toBe("Context window for this chat (lower = faster, less VRAM)");
    expect(btn.querySelector(".parallx-chat-picker-chevron")).not.toBeNull();
    expect(btn.querySelector("span")?.textContent).toBe("Ctx: auto");
  });

  it("setActiveContextWindow formats 65536 → 'Ctx: 64K' and 131072 → 'Ctx: 128K'", () => {
    const p = new ChatContextWindowPicker(container, { onPick: vi.fn() });
    const label = container.querySelector("button span") as HTMLSpanElement;
    p.setActiveContextWindow(65_536);
    expect(label.textContent).toBe("Ctx: 64K");
    p.setActiveContextWindow(131_072);
    expect(label.textContent).toBe("Ctx: 128K");
  });

  it("setActiveContextWindow(undefined | 0 | negative) → 'Ctx: auto'", () => {
    const p = new ChatContextWindowPicker(container, { onPick: vi.fn() });
    const label = container.querySelector("button span") as HTMLSpanElement;
    p.setActiveContextWindow(8192);
    expect(label.textContent).toBe("Ctx: 8K");
    p.setActiveContextWindow(undefined);
    expect(label.textContent).toBe("Ctx: auto");
    p.setActiveContextWindow(0);
    expect(label.textContent).toBe("Ctx: auto");
    p.setActiveContextWindow(-1);
    expect(label.textContent).toBe("Ctx: auto");
  });

  it("opening the dropdown renders the 7 presets in fixed order", () => {
    new ChatContextWindowPicker(container, { onPick: vi.fn() });
    (container.querySelector("button") as HTMLButtonElement).click();
    const items = [...document.querySelectorAll(".parallx-chat-picker-dropdown .parallx-chat-picker-item")];
    const names = items.map(i => i.querySelector(".parallx-chat-picker-item-name")?.textContent);
    expect(names).toEqual(["Model default", "4K", "8K", "16K", "32K", "64K", "128K"]);
  });

  it("active preset gets --active class + check icon; non-active rows have empty icon slot", () => {
    const p = new ChatContextWindowPicker(container, { onPick: vi.fn() });
    p.setActiveContextWindow(16_384);
    (container.querySelector("button") as HTMLButtonElement).click();
    const items = [...document.querySelectorAll(".parallx-chat-picker-dropdown .parallx-chat-picker-item")];
    // 16K is index 3.
    expect(items[3].classList.contains("parallx-chat-picker-item--active")).toBe(true);
    expect(items[3].querySelector(".parallx-chat-picker-item-icon")?.innerHTML).not.toBe("");
    items.forEach((it, i) => {
      if (i !== 3) {
        expect(it.classList.contains("parallx-chat-picker-item--active")).toBe(false);
        expect(it.querySelector(".parallx-chat-picker-item-icon")?.innerHTML).toBe("");
      }
    });
  });

  it("clicking a preset fires onPick(value), updates label, closes dropdown", () => {
    const onPick = vi.fn();
    new ChatContextWindowPicker(container, { onPick });
    (container.querySelector("button") as HTMLButtonElement).click();
    const items = [...document.querySelectorAll(".parallx-chat-picker-dropdown .parallx-chat-picker-item")];
    // 32K is index 4.
    (items[4] as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith(32_768);
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
    expect(container.querySelector("button span")?.textContent).toBe("Ctx: 32K");
  });

  it("Model default click clears override (value 0) and label returns to auto", () => {
    const onPick = vi.fn();
    const p = new ChatContextWindowPicker(container, { onPick });
    p.setActiveContextWindow(8192);
    (container.querySelector("button") as HTMLButtonElement).click();
    const items = [...document.querySelectorAll(".parallx-chat-picker-dropdown .parallx-chat-picker-item")];
    (items[0] as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith(0);
    expect(container.querySelector("button span")?.textContent).toBe("Ctx: auto");
  });

  it("clicking the button while open closes the dropdown (no second open)", () => {
    new ChatContextWindowPicker(container, { onPick: vi.fn() });
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).not.toBeNull();
    btn.click();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("outside mousedown closes; inside mousedown does NOT close", () => {
    new ChatContextWindowPicker(container, { onPick: vi.fn() });
    (container.querySelector("button") as HTMLButtonElement).click();
    const dropdown = document.querySelector(".parallx-chat-picker-dropdown") as HTMLElement;
    dropdown.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".parallx-chat-picker-dropdown")).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("dispose removes root and tears down any open dropdown", () => {
    const p = new ChatContextWindowPicker(container, { onPick: vi.fn() });
    (container.querySelector("button") as HTMLButtonElement).click();
    p.dispose();
    expect(container.querySelector(".parallx-chat-ctx-picker")).toBeNull();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });
});
