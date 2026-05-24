/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  $,
  append,
  clearNode,
  addDisposableListener,
  hide,
  show,
  toggleClass,
  isAncestorOfActiveElement,
  startDrag,
  endDrag,
  layoutPopup,
  attachPopupDismiss,
} from "../../src/ui/dom";

describe("dom helpers pin", () => {
  it("$('tag.cls1.cls2', child, text) builds element with classes and children", () => {
    const child = document.createElement("span");
    const el = $("div.a.b", child, "hello");
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("a")).toBe(true);
    expect(el.classList.contains("b")).toBe(true);
    expect(el.children[0]).toBe(child);
    expect(el.textContent).toContain("hello");
  });

  it("$ with empty descriptor falls back to 'div'", () => {
    const el = $("");
    expect(el.tagName).toBe("DIV");
  });

  it("append() appends all children and returns parent", () => {
    const p = document.createElement("div");
    const a = document.createElement("span");
    const b = document.createElement("span");
    expect(append(p, a, b)).toBe(p);
    expect(p.children.length).toBe(2);
  });

  it("clearNode() removes every child", () => {
    const p = document.createElement("div");
    p.appendChild(document.createElement("span"));
    p.appendChild(document.createElement("span"));
    clearNode(p);
    expect(p.children.length).toBe(0);
  });

  it("addDisposableListener returns a disposable that removes the listener", () => {
    const el = document.createElement("button");
    const handler = vi.fn();
    const d = addDisposableListener(el, "click", handler);
    el.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);
    d.dispose();
    el.dispatchEvent(new MouseEvent("click"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("hide() sets display:none; show() restores", () => {
    const el = document.createElement("div");
    hide(el);
    expect(el.style.display).toBe("none");
    show(el);
    expect(el.style.display).toBe("");
    show(el, "flex");
    expect(el.style.display).toBe("flex");
  });

  it("toggleClass toggles the class based on condition", () => {
    const el = document.createElement("div");
    toggleClass(el, "on", true);
    expect(el.classList.contains("on")).toBe(true);
    toggleClass(el, "on", false);
    expect(el.classList.contains("on")).toBe(false);
  });

  it("isAncestorOfActiveElement detects active descendant", () => {
    const host = document.createElement("div");
    const input = document.createElement("input");
    host.appendChild(input);
    document.body.appendChild(host);
    input.focus();
    expect(isAncestorOfActiveElement(host)).toBe(true);
    const other = document.createElement("div");
    document.body.appendChild(other);
    expect(isAncestorOfActiveElement(other)).toBe(false);
    document.body.removeChild(host);
    document.body.removeChild(other);
  });

  it("startDrag/endDrag set and clear cursor + userSelect on body", () => {
    startDrag("col-resize");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    endDrag();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });
});

describe("layoutPopup pin", () => {
  beforeEach(() => {
    // jsdom doesn't lay out — stub viewport + offsets
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  function makePopup(w: number, h: number): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetWidth", { configurable: true, value: w });
    Object.defineProperty(el, "offsetHeight", { configurable: true, value: h });
    document.body.appendChild(el);
    return el;
  }

  it("point anchor places top-left at the point and clamps to viewport margins", () => {
    const el = makePopup(100, 100);
    layoutPopup(el, { x: 50, y: 50 });
    expect(el.style.left).toBe("50px");
    expect(el.style.top).toBe("50px");
  });

  it("below placement positions popup under anchor with gap", () => {
    const el = makePopup(100, 50);
    const anchor = { left: 200, top: 100, right: 280, bottom: 130, width: 80, height: 30 } as DOMRect;
    layoutPopup(el, anchor, { position: "below", gap: 4, margin: 8 });
    expect(el.style.left).toBe("200px");
    expect(el.style.top).toBe("134px");
  });

  it("flips to above when below overflows but space exists above", () => {
    const el = makePopup(100, 200);
    const anchor = { left: 100, top: 700, right: 200, bottom: 720, width: 100, height: 20 } as DOMRect;
    layoutPopup(el, anchor, { position: "below" });
    // below would be 724..924 > vh=800 ; above is 700-4-200=496
    expect(parseInt(el.style.top, 10)).toBeLessThan(700);
  });

  it("sets maxHeight + overflowY:auto when popup taller than available space", () => {
    const el = makePopup(100, 900);
    layoutPopup(el, { x: 10, y: 10 });
    expect(el.style.maxHeight).toMatch(/px$/);
    expect(el.style.overflowY).toBe("auto");
  });
});

describe("attachPopupDismiss pin", () => {
  let raf: ReturnType<typeof vi.spyOn>;
  let now: number;
  beforeEach(() => {
    // Run RAF immediately so listeners attach synchronously
    raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(now++);
      return 1;
    });
  });
  afterEach(() => raf.mockRestore());

  it("outside click invokes onDismiss; click inside popup does not", () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    const dismissed = vi.fn();
    const dispose = attachPopupDismiss(popup, dismissed);

    // Inside
    popup.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dismissed).not.toHaveBeenCalled();

    // Outside
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dismissed).toHaveBeenCalledTimes(1);

    dispose();
    document.body.removeChild(popup);
    document.body.removeChild(outside);
  });

  it("Escape key triggers onDismiss (or onEscape when provided)", () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    const onDismiss = vi.fn();
    const onEscape = vi.fn();
    const dispose = attachPopupDismiss(popup, onDismiss, { onEscape });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    dispose();
    document.body.removeChild(popup);
  });

  it("isDismissable=false keeps popup open on outside click", () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    const onDismiss = vi.fn();
    const dispose = attachPopupDismiss(popup, onDismiss, { isDismissable: () => false });

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    dispose();
    document.body.removeChild(popup);
    document.body.removeChild(outside);
  });

  it("dispose() removes both listeners; second dispose is a no-op", () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    const onDismiss = vi.fn();
    const dispose = attachPopupDismiss(popup, onDismiss);
    dispose();
    dispose();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    document.body.removeChild(popup);
    document.body.removeChild(outside);
  });
});
