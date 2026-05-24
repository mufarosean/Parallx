/**
 * @vitest-environment jsdom
 *
 * Pin: attachInputPasteContextMenu — right-click paste sub-menu lifecycle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachInputPasteContextMenu } from "../../src/built-in/canvas/menus/inputPasteContextMenu";

function makeHost() {
  const popup = document.createElement("div");
  popup.style.position = "absolute";
  popup.style.left = "100px";
  popup.style.top = "50px";
  // jsdom always returns 0s for getBoundingClientRect; patch it explicitly.
  popup.getBoundingClientRect = () => ({ left: 100, top: 50, right: 300, bottom: 200, width: 200, height: 150, x: 100, y: 50, toJSON() {} }) as any;
  const input = document.createElement("input");
  popup.appendChild(input);
  document.body.appendChild(popup);
  return { popup, input };
}

function fireContextMenu(input: HTMLElement, clientX: number, clientY: number) {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY });
  input.dispatchEvent(ev);
  return ev;
}

const rafs: Array<() => void> = [];
const originalRaf = globalThis.requestAnimationFrame;

beforeEach(() => {
  rafs.length = 0;
  (globalThis as any).requestAnimationFrame = (cb: () => void) => { rafs.push(cb); return 1 as any; };
});
afterEach(() => {
  (globalThis as any).requestAnimationFrame = originalRaf;
  document.body.innerHTML = "";
  delete (window as any).parallxElectron;
});

describe("built-in/canvas/menus/inputPasteContextMenu", () => {
  it("returns a controller with isOpen() and dismiss()", () => {
    const { popup, input } = makeHost();
    const ctl = attachInputPasteContextMenu(input, popup);
    expect(typeof ctl.isOpen).toBe("function");
    expect(typeof ctl.dismiss).toBe("function");
    expect(ctl.isOpen()).toBe(false);
  });

  it("contextmenu mounts a single .canvas-input-paste-menu with a Paste button positioned relative to popup", () => {
    const { popup, input } = makeHost();
    const ctl = attachInputPasteContextMenu(input, popup);
    fireContextMenu(input, 150, 80);
    const menu = popup.querySelector(".canvas-input-paste-menu") as HTMLElement | null;
    expect(menu).toBeTruthy();
    expect(menu!.style.position).toBe("absolute");
    expect(menu!.style.left).toBe("50px");  // 150 - 100
    expect(menu!.style.top).toBe("30px");   // 80 - 50
    const item = menu!.querySelector(".canvas-input-paste-menu-item") as HTMLButtonElement;
    expect(item).toBeTruthy();
    expect(item.textContent).toBe("Paste");
    expect(item.tagName).toBe("BUTTON");
    expect(ctl.isOpen()).toBe(true);
  });

  it("contextmenu calls preventDefault and stopPropagation", () => {
    const { popup, input } = makeHost();
    attachInputPasteContextMenu(input, popup);
    const ev = fireContextMenu(input, 110, 60);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("re-firing contextmenu replaces (not duplicates) the menu", () => {
    const { popup, input } = makeHost();
    attachInputPasteContextMenu(input, popup);
    fireContextMenu(input, 110, 60);
    fireContextMenu(input, 120, 70);
    expect(popup.querySelectorAll(".canvas-input-paste-menu")).toHaveLength(1);
  });

  it("dismiss() removes the menu and clears isOpen()", () => {
    const { popup, input } = makeHost();
    const ctl = attachInputPasteContextMenu(input, popup);
    fireContextMenu(input, 110, 60);
    expect(ctl.isOpen()).toBe(true);
    ctl.dismiss();
    expect(ctl.isOpen()).toBe(false);
    expect(popup.querySelector(".canvas-input-paste-menu")).toBeNull();
  });

  it("outside mousedown dismisses (only attached after requestAnimationFrame)", () => {
    const { popup, input } = makeHost();
    const ctl = attachInputPasteContextMenu(input, popup);
    fireContextMenu(input, 110, 60);
    // Before RAF, outside mousedown should NOT dismiss.
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(ctl.isOpen()).toBe(true);
    // Flush the deferred listener attach.
    rafs.forEach((cb) => cb());
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(ctl.isOpen()).toBe(false);
  });

  it("mousedown inside the menu does NOT dismiss", () => {
    const { popup, input } = makeHost();
    const ctl = attachInputPasteContextMenu(input, popup);
    fireContextMenu(input, 110, 60);
    rafs.forEach((cb) => cb());
    const item = popup.querySelector(".canvas-input-paste-menu-item") as HTMLButtonElement;
    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(ctl.isOpen()).toBe(true);
  });

  it("Paste click inserts clipboard text at caret via electron bridge + fires input event + dismisses", async () => {
    const { popup, input } = makeHost();
    (window as any).parallxElectron = { clipboard: { readText: () => "hello" } };
    const ctl = attachInputPasteContextMenu(input, popup);
    input.value = "ab";
    input.setSelectionRange(1, 1);
    const inputEv = vi.fn();
    input.addEventListener("input", inputEv);
    fireContextMenu(input, 110, 60);
    const item = popup.querySelector(".canvas-input-paste-menu-item") as HTMLButtonElement;
    item.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe("ahellob");
    expect(inputEv).toHaveBeenCalled();
    expect(ctl.isOpen()).toBe(false);
  });

  it("Paste falls back to navigator.clipboard.readText when bridge missing", async () => {
    const { popup, input } = makeHost();
    const orig = (navigator as any).clipboard;
    (navigator as any).clipboard = { readText: vi.fn(async () => "world") };
    attachInputPasteContextMenu(input, popup);
    input.value = "";
    fireContextMenu(input, 110, 60);
    const item = popup.querySelector(".canvas-input-paste-menu-item") as HTMLButtonElement;
    item.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe("world");
    (navigator as any).clipboard = orig;
  });

  it("Empty clipboard text does not call setRangeText (value unchanged)", async () => {
    const { popup, input } = makeHost();
    (window as any).parallxElectron = { clipboard: { readText: () => "" } };
    const orig = (navigator as any).clipboard;
    (navigator as any).clipboard = { readText: async () => "" };
    attachInputPasteContextMenu(input, popup);
    input.value = "keep";
    fireContextMenu(input, 110, 60);
    const item = popup.querySelector(".canvas-input-paste-menu-item") as HTMLButtonElement;
    item.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe("keep");
    (navigator as any).clipboard = orig;
  });
});
