/**
 * @vitest-environment jsdom
 *
 * Pin: showCanvasTemplatePicker — modal scaffold, built-ins vs user split,
 * 'Your templates' separator presence, Custom pill, footer button labels
 * (blank/manage variants/cancel), card click resolves, Escape/backdrop/cancel
 * dismiss with template:null, manage opens manager (openedManager:true),
 * first card auto-focus.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock canvasTemplates module — we own the list of templates.
const mockTemplates: any[] = [];
vi.mock("../../src/built-in/canvas/canvasTemplates.js", () => ({
  getAllCanvasTemplates: vi.fn(async () => mockTemplates),
}));

// Mock iconRegistry to keep createIconElement deterministic + sync.
vi.mock("../../src/built-in/canvas/config/iconRegistry.js", () => ({
  createIconElement: (id: string, size: number) => {
    const s = document.createElement("span");
    s.className = "mock-icon";
    s.dataset.id = id;
    s.dataset.size = String(size);
    return s;
  },
}));

import { showCanvasTemplatePicker } from "../../src/built-in/canvas/canvasTemplatePicker";

function setTemplates(list: any[]): void {
  mockTemplates.length = 0;
  mockTemplates.push(...list);
}

const tBuiltin = (id: string, name: string, desc?: string) => ({
  id, name, source: "builtin", icon: "file-text",
  description: desc, sections: [],
});
const tUser = (id: string, name: string) => ({
  id, name, source: "user", icon: "file-text",
  description: "by user", sections: [],
});

describe("built-in/canvas/canvasTemplatePicker — showCanvasTemplatePicker", () => {
  beforeEach(() => { document.body.innerHTML = ""; mockTemplates.length = 0; });

  it("renders backdrop + modal + title + subtitle + grid", async () => {
    setTemplates([tBuiltin("a", "A")]);
    const p = showCanvasTemplatePicker({} as any);
    // Allow microtasks for getAllCanvasTemplates promise.
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".canvas-template-picker-backdrop")).not.toBeNull();
    expect(document.querySelector(".canvas-template-picker")).not.toBeNull();
    expect(document.querySelector(".canvas-template-picker-title")?.textContent).toBe("Start from a template");
    expect(document.querySelector(".canvas-template-picker-subtitle")?.textContent)
      .toBe("Pick a starter shape. You can edit everything afterwards.");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
  });

  it("renders builtins, then 'Your templates' separator, then user templates with Custom pill", async () => {
    setTemplates([tBuiltin("b1", "Built 1"), tBuiltin("b2", "Built 2"), tUser("u1", "Mine")]);
    const p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    const grid = document.querySelector(".canvas-template-picker-grid")!;
    const children = [...grid.children];
    // builtins (2) + separator + user (1) = 4
    expect(children.length).toBe(4);
    expect(children[0].classList.contains("canvas-template-card")).toBe(true);
    expect(children[1].classList.contains("canvas-template-card")).toBe(true);
    expect(children[2].classList.contains("canvas-template-picker-section-header")).toBe(true);
    expect(children[2].textContent).toBe("Your templates");
    expect(children[3].classList.contains("canvas-template-card")).toBe(true);
    // Pill present only on user card.
    expect(children[3].querySelector(".canvas-template-card-pill")?.textContent).toBe("Custom");
    expect(children[0].querySelector(".canvas-template-card-pill")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
  });

  it("no user templates → no separator", async () => {
    setTemplates([tBuiltin("b1", "B")]);
    const p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".canvas-template-picker-section-header")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
  });

  it("manage button label flips: 'Manage templates…' when user templates exist, else 'Create a custom template…'", async () => {
    setTemplates([tBuiltin("b1", "B")]);
    let p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".canvas-template-picker-manage span:last-child")?.textContent)
      .toBe("Create a custom template…");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;

    setTemplates([tBuiltin("b1", "B"), tUser("u1", "U")]);
    p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".canvas-template-picker-manage span:last-child")?.textContent)
      .toBe("Manage templates…");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
  });

  it("footer has blank, manage, cancel buttons in order", async () => {
    setTemplates([tBuiltin("b", "B")]);
    const p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    const footer = document.querySelector(".canvas-template-picker-footer")!;
    const buttons = [...footer.querySelectorAll("button")];
    expect(buttons.map(b => b.className)).toEqual([
      "canvas-template-picker-blank",
      "canvas-template-picker-manage",
      "canvas-template-picker-cancel",
    ]);
    expect(buttons[2].textContent).toBe("Cancel");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
  });

  it("clicking a card resolves with that template", async () => {
    const tpl = tBuiltin("pick-me", "Pick me");
    setTemplates([tpl]);
    const p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    (document.querySelector("button.canvas-template-card") as HTMLButtonElement).click();
    const result = await p;
    expect(result.template).toBe(tpl);
    expect(result.openedManager).toBeUndefined();
    expect(document.querySelector(".canvas-template-picker-backdrop")).toBeNull();
  });

  it("'Start with a blank page' resolves with template:null (no openedManager)", async () => {
    setTemplates([tBuiltin("b", "B")]);
    const p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    (document.querySelector(".canvas-template-picker-blank") as HTMLButtonElement).click();
    const result = await p;
    expect(result.template).toBeNull();
    expect(result.openedManager).toBeUndefined();
  });

  it("'Manage templates…' resolves with template:null + openedManager:true", async () => {
    setTemplates([tBuiltin("b", "B"), tUser("u", "U")]);
    const p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    (document.querySelector(".canvas-template-picker-manage") as HTMLButtonElement).click();
    const result = await p;
    expect(result.template).toBeNull();
    expect(result.openedManager).toBe(true);
  });

  it("Cancel + backdrop click + Escape all resolve to template:null", async () => {
    setTemplates([tBuiltin("b", "B")]);

    let p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    (document.querySelector(".canvas-template-picker-cancel") as HTMLButtonElement).click();
    expect((await p).template).toBeNull();

    p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    const backdrop = document.querySelector(".canvas-template-picker-backdrop") as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect((await p).template).toBeNull();

    p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((await p).template).toBeNull();
  });

  it("clicking INSIDE the modal does NOT dismiss (only true backdrop target does)", async () => {
    setTemplates([tBuiltin("b", "B")]);
    let resolved = false;
    const p = showCanvasTemplatePicker({} as any).then(r => { resolved = true; return r; });
    await Promise.resolve(); await Promise.resolve();
    const modal = document.querySelector(".canvas-template-picker") as HTMLElement;
    // Manually dispatch a click event whose target is the modal (bubbles to backdrop).
    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(resolved).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
  });

  it("first card receives focus after render", async () => {
    setTemplates([tBuiltin("b1", "B1"), tBuiltin("b2", "B2")]);
    const p = showCanvasTemplatePicker({} as any);
    await Promise.resolve(); await Promise.resolve();
    const first = document.querySelector("button.canvas-template-card") as HTMLButtonElement;
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
  });
});
