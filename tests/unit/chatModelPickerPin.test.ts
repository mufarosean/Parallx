/**
 * @vitest-environment jsdom
 *
 * Pin: ChatModelPicker — button label/chevron, dropdown lifecycle, empty
 * state, item click → setActiveModel + emit, outside-click dismissal,
 * onDidChangeModels label refresh, context-length formatting.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatModelPicker } from "../../src/built-in/chat/pickers/chatModelPicker";
import { Emitter } from "../../src/platform/events.js";

type ModelInfo = { id: string; displayName: string; parameterSize: string; contextLength: number; capabilities?: readonly string[] };

function makeServices(initial: { models: ModelInfo[]; active: string | null }) {
  const state = { ...initial };
  const changeEmitter = new Emitter<void>();
  return {
    emitter: changeEmitter,
    services: {
      getModels: vi.fn(async () => state.models),
      getActiveModel: vi.fn(() => state.active),
      setActiveModel: vi.fn((id: string) => { state.active = id; }),
      onDidChangeModels: changeEmitter.event,
    },
    setActive(id: string | null) { state.active = id; },
    setModels(m: ModelInfo[]) { state.models = m; },
  };
}

describe("built-in/chat/pickers/chatModelPicker — ChatModelPicker", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("appends .parallx-chat-model-picker root with a chevron button", () => {
    const { services } = makeServices({ models: [], active: null });
    new ChatModelPicker(container, services as any);
    const root = container.querySelector(".parallx-chat-model-picker")!;
    expect(root).not.toBeNull();
    const btn = root.querySelector("button.parallx-chat-picker-btn.parallx-chat-picker-btn--model") as HTMLButtonElement;
    expect(btn.type).toBe("button");
    expect(btn.querySelector(".parallx-chat-picker-chevron")).not.toBeNull();
  });

  it("shows 'No model' label when no active model", () => {
    const { services } = makeServices({ models: [], active: null });
    new ChatModelPicker(container, services as any);
    const label = container.querySelector("button span:first-child")!;
    expect(label.textContent).toBe("No model");
  });

  it("truncates active model id over 20 chars with ellipsis", () => {
    const longId = "really-long-model-name-that-exceeds-twenty";
    const { services } = makeServices({ models: [], active: longId });
    new ChatModelPicker(container, services as any);
    const label = container.querySelector("button span:first-child")!;
    expect(label.textContent).toBe(longId.slice(0, 17) + "\u2026");
  });

  it("onDidChangeModels triggers label refresh", () => {
    const ctx = makeServices({ models: [], active: null });
    new ChatModelPicker(container, ctx.services as any);
    expect(container.querySelector("button span:first-child")?.textContent).toBe("No model");
    ctx.setActive("llama-3");
    ctx.emitter.fire();
    expect(container.querySelector("button span:first-child")?.textContent).toBe("llama-3");
  });

  it("clicking button opens dropdown with empty placeholder when no models", async () => {
    const { services } = makeServices({ models: [], active: null });
    new ChatModelPicker(container, services as any);
    const btn = container.querySelector("button")! as HTMLButtonElement;
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    const empty = document.querySelector(".parallx-chat-picker-dropdown .parallx-chat-picker-item--empty");
    expect(empty?.textContent).toBe("No models available");
  });

  it("dropdown renders one item per model with name + parameterSize + ctxLabel", async () => {
    const models: ModelInfo[] = [
      { id: "a", displayName: "Alpha", parameterSize: "7B", contextLength: 4096 },
      { id: "b", displayName: "Beta", parameterSize: "13B", contextLength: 131072 },
      { id: "c", displayName: "Gamma", parameterSize: "70B", contextLength: 0 },
    ];
    const { services } = makeServices({ models, active: "b" });
    new ChatModelPicker(container, services as any);
    (container.querySelector("button") as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    const items = [...document.querySelectorAll(".parallx-chat-picker-dropdown .parallx-chat-picker-item")];
    expect(items).toHaveLength(3);
    const sizes = items.map(i => i.querySelector(".parallx-chat-picker-item-size")?.textContent);
    expect(sizes).toEqual(["7B · 4K", "13B · 128K", "70B"]);
    // Active class on the active item only
    expect(items[1].classList.contains("parallx-chat-picker-item--active")).toBe(true);
    expect(items[0].classList.contains("parallx-chat-picker-item--active")).toBe(false);
    expect(items[2].classList.contains("parallx-chat-picker-item--active")).toBe(false);
  });

  it("clicking an item calls setActiveModel, fires onDidSelectModel, and closes dropdown", async () => {
    const models: ModelInfo[] = [{ id: "a", displayName: "Alpha", parameterSize: "7B", contextLength: 1024 }];
    const ctx = makeServices({ models, active: null });
    const picker = new ChatModelPicker(container, ctx.services as any);
    const selected: string[] = [];
    picker.onDidSelectModel(id => selected.push(id));
    (container.querySelector("button") as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    (document.querySelector(".parallx-chat-picker-dropdown .parallx-chat-picker-item") as HTMLElement).click();
    expect(ctx.services.setActiveModel).toHaveBeenCalledWith("a");
    expect(selected).toEqual(["a"]);
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("clicking the button while open closes the dropdown", async () => {
    const { services } = makeServices({ models: [], active: null });
    new ChatModelPicker(container, services as any);
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).not.toBeNull();
    btn.click();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("outside mousedown closes dropdown; inside mousedown does not", async () => {
    const { services } = makeServices({ models: [{ id: "a", displayName: "A", parameterSize: "7B", contextLength: 0 }], active: null });
    new ChatModelPicker(container, services as any);
    (container.querySelector("button") as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    const dropdown = document.querySelector(".parallx-chat-picker-dropdown") as HTMLElement;
    expect(dropdown).not.toBeNull();
    // Inside: no close.
    dropdown.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".parallx-chat-picker-dropdown")).not.toBeNull();
    // Outside: close.
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });

  it("getModels rejection leaves no dropdown and re-enables opening", async () => {
    const failing = {
      getModels: vi.fn(async () => { throw new Error("boom"); }),
      getActiveModel: () => null,
      setActiveModel: vi.fn(),
      onDidChangeModels: new Emitter<void>().event,
    };
    new ChatModelPicker(container, failing as any);
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
    // Subsequent open works.
    failing.getModels.mockResolvedValueOnce([{ id: "x", displayName: "X", parameterSize: "1B", contextLength: 0 } as any]);
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).not.toBeNull();
  });

  it("dispose removes root + closes any open dropdown", async () => {
    const { services } = makeServices({ models: [], active: null });
    const picker = new ChatModelPicker(container, services as any);
    (container.querySelector("button") as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    picker.dispose();
    expect(container.querySelector(".parallx-chat-model-picker")).toBeNull();
    expect(document.querySelector(".parallx-chat-picker-dropdown")).toBeNull();
  });
});
