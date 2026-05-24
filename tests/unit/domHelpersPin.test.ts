/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import {
  $, append, clearNode, addDisposableListener,
  hide, show, toggleClass, isAncestorOfActiveElement,
  startDrag, endDrag, layoutPopup, attachPopupDismiss,
} from "../../src/ui/dom.js";

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) } as DOMRect);

describe("ui/dom pin", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  });

  it("$() creates element with tag and dotted class list", () => {
    const el = $("div.foo.bar");
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("foo")).toBe(true);
    expect(el.classList.contains("bar")).toBe(true);
  });

  it("$() appends string children as text and element children as nodes", () => {
    const child = document.createElement("span");
    const el = $("p", "hi", child, " there");
    expect(el.childNodes.length).toBe(3);
    expect(el.textContent).toBe("hi there");
    expect(el.contains(child)).toBe(true);
  });

  it("$() defaults to div when descriptor has only classes", () => {
    const el = $(".only-class");
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("only-class")).toBe(true);
  });

  it("append() returns parent and appends multiple children", () => {
    const p = document.createElement("div");
    const a = document.createElement("span");
    const b = document.createElement("span");
    const r = append(p, a, b);
    expect(r).toBe(p);
    expect(p.children.length).toBe(2);
  });

  it("clearNode() removes all children", () => {
    const p = $("div", $("span"), $("span"));
    clearNode(p);
    expect(p.children.length).toBe(0);
  });

  it("addDisposableListener returns a disposable that detaches the listener", () => {
    const el = document.createElement("button");
    let n = 0;
    const d = addDisposableListener(el, "click", () => { n++; });
    el.click();
    expect(n).toBe(1);
    d.dispose();
    el.click();
    expect(n).toBe(1);
  });

  it("hide/show toggle display style", () => {
    const el = document.createElement("div");
    hide(el);
    expect(el.style.display).toBe("none");
    show(el);
    expect(el.style.display).toBe("");
    show(el, "flex");
    expect(el.style.display).toBe("flex");
  });

  it("toggleClass adds/removes based on condition", () => {
    const el = document.createElement("div");
    toggleClass(el, "active", true);
    expect(el.classList.contains("active")).toBe(true);
    toggleClass(el, "active", false);
    expect(el.classList.contains("active")).toBe(false);
  });

  it("isAncestorOfActiveElement returns true when focus is inside", () => {
    const wrap = document.createElement("div");
    const input = document.createElement("input");
    wrap.appendChild(input);
    document.body.appendChild(wrap);
    input.focus();
    expect(isAncestorOfActiveElement(wrap)).toBe(true);
    const other = document.createElement("div");
    document.body.appendChild(other);
    expect(isAncestorOfActiveElement(other)).toBe(false);
  });

  it("startDrag/endDrag set and restore body cursor + userSelect", () => {
    startDrag("col-resize");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    endDrag();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("layoutPopup point-anchor places top-left at the point and clamps to viewport", () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    document.body.appendChild(el);
    Object.defineProperty(el, "offsetWidth", { value: 100, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 50, configurable: true });
    layoutPopup(el, { x: 5, y: 5 });
    expect(el.style.left).toBe("8px"); // clamped to margin (default 8)
    expect(el.style.top).toBe("8px");
  });

  it("layoutPopup rect-anchor 'below' positions below by default", () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    document.body.appendChild(el);
    Object.defineProperty(el, "offsetWidth", { value: 100, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 50, configurable: true });
    layoutPopup(el, rect(100, 100, 80, 30), { position: "below", gap: 4 });
    expect(el.style.left).toBe("100px");
    expect(el.style.top).toBe(`${100 + 30 + 4}px`);
  });

  it("layoutPopup flips 'below' to above when overflowing bottom", () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    document.body.appendChild(el);
    Object.defineProperty(el, "offsetWidth", { value: 100, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 100, configurable: true });
    // anchor near bottom; below would overflow → flips above
    layoutPopup(el, rect(100, 750, 80, 30), { position: "below", gap: 4 });
    expect(parseInt(el.style.top, 10)).toBeLessThan(750);
  });

  it("layoutPopup sets maxHeight + overflowY when popup taller than available space", () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    document.body.appendChild(el);
    Object.defineProperty(el, "offsetWidth", { value: 100, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 900, configurable: true });
    layoutPopup(el, { x: 100, y: 100 });
    expect(el.style.maxHeight).not.toBe("");
    expect(el.style.overflowY).toBe("auto");
  });

  it("attachPopupDismiss fires onDismiss on outside mousedown after RAF", async () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    let dismissed = 0;
    const detach = attachPopupDismiss(popup, () => { dismissed++; });
    await new Promise(r => requestAnimationFrame(() => r(null)));
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dismissed).toBe(1);
    detach();
  });

  it("attachPopupDismiss does NOT dismiss when mousedown is inside popup", async () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    let dismissed = 0;
    const detach = attachPopupDismiss(popup, () => { dismissed++; });
    await new Promise(r => requestAnimationFrame(() => r(null)));
    popup.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dismissed).toBe(0);
    detach();
  });

  it("attachPopupDismiss fires onDismiss on Escape keydown", async () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    let dismissed = 0;
    const detach = attachPopupDismiss(popup, () => { dismissed++; });
    await new Promise(r => requestAnimationFrame(() => r(null)));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(dismissed).toBe(1);
    detach();
  });

  it("attachPopupDismiss escapeKey:false suppresses Escape", async () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    let dismissed = 0;
    const detach = attachPopupDismiss(popup, () => { dismissed++; }, { escapeKey: false });
    await new Promise(r => requestAnimationFrame(() => r(null)));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(dismissed).toBe(0);
    detach();
  });

  it("attachPopupDismiss accepts a roots array and treats any as 'inside'", async () => {
    const popup = document.createElement("div");
    const anchor = document.createElement("button");
    document.body.appendChild(popup);
    document.body.appendChild(anchor);
    let dismissed = 0;
    const detach = attachPopupDismiss([popup, anchor], () => { dismissed++; });
    await new Promise(r => requestAnimationFrame(() => r(null)));
    anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dismissed).toBe(0);
    detach();
  });

  it("attachPopupDismiss detach() before RAF cancels listener attachment", async () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    let dismissed = 0;
    const detach = attachPopupDismiss(popup, () => { dismissed++; });
    detach();
    await new Promise(r => requestAnimationFrame(() => r(null)));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dismissed).toBe(0);
  });

  it("attachPopupDismiss onEscape overrides onDismiss for Escape key", async () => {
    const popup = document.createElement("div");
    document.body.appendChild(popup);
    let dismissed = 0;
    let escaped = 0;
    const detach = attachPopupDismiss(popup, () => { dismissed++; }, {
      onEscape: () => { escaped++; },
    });
    await new Promise(r => requestAnimationFrame(() => r(null)));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(escaped).toBe(1);
    expect(dismissed).toBe(0);
    detach();
  });
});
