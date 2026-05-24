/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { Overlay } from "../../src/ui/overlay";

describe("Overlay pin", () => {
  it("creates backdrop .ui-overlay and content .ui-overlay-content elements", () => {
    const o = new Overlay(document.body);
    expect(o.element.classList.contains("ui-overlay")).toBe(true);
    expect(o.contentElement.classList.contains("ui-overlay-content")).toBe(true);
    expect(o.contentElement.parentElement).toBe(o.element);
    o.dispose();
  });

  it("transparent option toggles .ui-overlay--transparent class", () => {
    const a = new Overlay(document.body, { transparent: true });
    expect(a.element.classList.contains("ui-overlay--transparent")).toBe(true);
    const b = new Overlay(document.body);
    expect(b.element.classList.contains("ui-overlay--transparent")).toBe(false);
    a.dispose(); b.dispose();
  });

  it("centered option toggles .ui-overlay--centered class", () => {
    const o = new Overlay(document.body, { centered: true });
    expect(o.element.classList.contains("ui-overlay--centered")).toBe(true);
    o.dispose();
  });

  it("contentClass adds extra class on the content element", () => {
    const o = new Overlay(document.body, { contentClass: "my-modal" });
    expect(o.contentElement.classList.contains("my-modal")).toBe(true);
    o.dispose();
  });

  it("show() appends to parent and focuses the backdrop; hide() removes and fires onDidClose", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const o = new Overlay(parent);
    expect(o.visible).toBe(false);

    o.show();
    expect(o.visible).toBe(true);
    expect(parent.contains(o.element)).toBe(true);
    expect(o.element.tabIndex).toBe(-1);

    const closed = vi.fn();
    o.onDidClose(closed);
    o.hide();
    expect(o.visible).toBe(false);
    expect(parent.contains(o.element)).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);

    o.dispose();
    document.body.removeChild(parent);
  });

  it("show()/hide() are idempotent", () => {
    const o = new Overlay(document.body);
    const closed = vi.fn();
    o.onDidClose(closed);
    o.show();
    o.show();
    o.hide();
    o.hide();
    expect(closed).toHaveBeenCalledTimes(1);
    o.dispose();
  });

  it("clicking the backdrop (target === element) hides when closeOnClickOutside (default)", () => {
    const o = new Overlay(document.body);
    o.show();
    const closed = vi.fn();
    o.onDidClose(closed);

    const evt = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(evt, "target", { value: o.element });
    o.element.dispatchEvent(evt);
    expect(o.visible).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
    o.dispose();
  });

  it("clicking inside content does NOT close", () => {
    const o = new Overlay(document.body);
    o.show();
    const closed = vi.fn();
    o.onDidClose(closed);
    const evt = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(evt, "target", { value: o.contentElement });
    o.element.dispatchEvent(evt);
    expect(o.visible).toBe(true);
    expect(closed).not.toHaveBeenCalled();
    o.dispose();
  });

  it("closeOnClickOutside=false disables backdrop click close", () => {
    const o = new Overlay(document.body, { closeOnClickOutside: false });
    o.show();
    const evt = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(evt, "target", { value: o.element });
    o.element.dispatchEvent(evt);
    expect(o.visible).toBe(true);
    o.dispose();
  });

  it("Escape key hides by default; closeOnEscape=false disables it", () => {
    const o1 = new Overlay(document.body);
    o1.show();
    o1.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(o1.visible).toBe(false);

    const o2 = new Overlay(document.body, { closeOnEscape: false });
    o2.show();
    o2.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(o2.visible).toBe(true);
    o1.dispose(); o2.dispose();
  });

  it("dispose() removes the element if still visible", () => {
    const o = new Overlay(document.body);
    o.show();
    o.dispose();
    expect(document.body.contains(o.element)).toBe(false);
  });
});
