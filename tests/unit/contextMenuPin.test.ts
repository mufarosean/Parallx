/** @vitest-environment jsdom */
/**
 * Pin tests for src/ui/contextMenu.ts — invariant guards.
 *
 * Pins:
 *   - `ContextMenu.show()` returns a ContextMenu and mounts `.context-menu` to body.
 *   - Sets role='menu' on root and role='menuitem' on rows.
 *   - Renders exactly one row per non-disabled item with the label text.
 *   - Disabled items get `.context-menu-item--disabled` and ignore clicks.
 *   - Click on an enabled row fires `onDidSelect` with that item and dismisses.
 *   - Items with a `submenu` show the submenu arrow and DO NOT fire onDidSelect on click
 *     (clicking opens the submenu instead).
 *   - Items with a `keybinding` (no submenu) render a `.context-menu-item-keybinding` span.
 *   - Group separators are inserted between groups (one separator per group boundary).
 *   - `dismiss()` removes the element from the DOM and fires `onDidDismiss`.
 *   - `autoSelectFirst: true` highlights the first row.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ContextMenu } from "../../src/ui/contextMenu";

beforeEach(() => {
  document.body.innerHTML = "";
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = function () {};
  }
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("ui/contextMenu — mount + roles", () => {
  it("mounts `.context-menu` to document.body with role='menu'", () => {
    const m = ContextMenu.show({
      items: [{ id: "a", label: "Alpha" }],
      anchor: { x: 0, y: 0 },
    });
    const root = document.querySelector(".context-menu") as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute("role")).toBe("menu");
    m.dismiss();
  });

  it("renders one row per item with role='menuitem' and the label text", () => {
    const m = ContextMenu.show({
      items: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Bravo" },
        { id: "c", label: "Charlie" },
      ],
      anchor: { x: 0, y: 0 },
    });
    const rows = document.querySelectorAll(".context-menu-item");
    expect(rows.length).toBe(3);
    rows.forEach((r) => expect(r.getAttribute("role")).toBe("menuitem"));
    const labels = Array.from(document.querySelectorAll(".context-menu-item-label")).map((n) => n.textContent);
    expect(labels).toEqual(["Alpha", "Bravo", "Charlie"]);
    m.dismiss();
  });
});

describe("ui/contextMenu — selection", () => {
  it("clicking an enabled row fires onDidSelect with the item and dismisses", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    const items = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Bravo" },
    ];
    const m = ContextMenu.show({ items, anchor: { x: 0, y: 0 } });
    m.onDidSelect(onSelect);
    m.onDidDismiss(onDismiss);

    const rows = document.querySelectorAll(".context-menu-item");
    (rows[1] as HTMLElement).click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].item).toBe(items[1]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("disabled rows get `.context-menu-item--disabled` and clicking does NOT fire onDidSelect", () => {
    const onSelect = vi.fn();
    const m = ContextMenu.show({
      items: [
        { id: "a", label: "Alpha", disabled: true },
        { id: "b", label: "Bravo" },
      ],
      anchor: { x: 0, y: 0 },
    });
    m.onDidSelect(onSelect);

    const rows = document.querySelectorAll(".context-menu-item");
    expect(rows[0].classList.contains("context-menu-item--disabled")).toBe(true);
    (rows[0] as HTMLElement).click();
    expect(onSelect).not.toHaveBeenCalled();
    m.dismiss();
  });
});

describe("ui/contextMenu — submenus + keybindings + groups", () => {
  it("items with a submenu show the arrow indicator and do NOT fire onDidSelect on click", () => {
    const onSelect = vi.fn();
    const m = ContextMenu.show({
      items: [
        { id: "more", label: "More…", submenu: [{ id: "x", label: "X" }] },
      ],
      anchor: { x: 0, y: 0 },
    });
    m.onDidSelect(onSelect);

    expect(document.querySelector(".context-menu-submenu-arrow")).toBeTruthy();
    expect(document.querySelector(".context-menu-item--has-submenu")).toBeTruthy();

    const row = document.querySelector(".context-menu-item--has-submenu") as HTMLElement;
    row.click();
    expect(onSelect).not.toHaveBeenCalled();

    m.dismiss();
  });

  it("items with a keybinding (and no submenu) render `.context-menu-item-keybinding`", () => {
    const m = ContextMenu.show({
      items: [{ id: "c", label: "Copy", keybinding: "Ctrl+C" }],
      anchor: { x: 0, y: 0 },
    });
    const kb = document.querySelector(".context-menu-item-keybinding");
    expect(kb).toBeTruthy();
    expect(kb!.textContent).toBe("Ctrl+C");
    m.dismiss();
  });

  it("inserts a `.context-menu-separator` between distinct groups", () => {
    const m = ContextMenu.show({
      items: [
        { id: "a", label: "A", group: "1" },
        { id: "b", label: "B", group: "1" },
        { id: "c", label: "C", group: "2" },
        { id: "d", label: "D", group: "2" },
      ],
      anchor: { x: 0, y: 0 },
    });
    const seps = document.querySelectorAll(".context-menu-separator");
    expect(seps.length).toBe(1);
    m.dismiss();
  });
});

describe("ui/contextMenu — lifecycle", () => {
  it("dismiss() removes the root element and fires onDidDismiss exactly once", () => {
    const onDismiss = vi.fn();
    const m = ContextMenu.show({ items: [{ id: "a", label: "A" }], anchor: { x: 0, y: 0 } });
    m.onDidDismiss(onDismiss);

    expect(document.querySelector(".context-menu")).toBeTruthy();
    m.dismiss();
    expect(document.querySelector(".context-menu")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // Second dismiss is a no-op
    m.dismiss();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("autoSelectFirst highlights the first row with `.context-menu-item--selected`", () => {
    const m = ContextMenu.show({
      items: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Bravo" },
      ],
      anchor: { x: 0, y: 0 },
      autoSelectFirst: true,
    });
    const rows = document.querySelectorAll(".context-menu-item");
    expect(rows[0].classList.contains("context-menu-item--selected")).toBe(true);
    expect(rows[1].classList.contains("context-menu-item--selected")).toBe(false);
    m.dismiss();
  });
});
