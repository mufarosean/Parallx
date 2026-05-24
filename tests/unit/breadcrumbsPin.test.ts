/** @vitest-environment jsdom */
/**
 * Pin tests for src/ui/breadcrumbs.ts — BreadcrumbsWidget invariants.
 *
 * Pins:
 *   - Mounts `.parallx-breadcrumbs` with role='list' into the container.
 *   - setItems renders one `.parallx-breadcrumb-item[role='listitem']` per item with a `.breadcrumb-separator`.
 *   - Calls `item.render(node)` exactly once per item.
 *   - Click on an item fires onDidSelectItem and onDidFocusItem, applies `.selected` and `.focused` classes.
 *   - ArrowRight/ArrowLeft move focus across items.
 *   - Escape clears focus + selection.
 *   - setEnabled(false) adds `.disabled` and suppresses click handling.
 *   - dispose() removes the dom node and disposes items.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BreadcrumbsWidget, BreadcrumbsItem } from "../../src/ui/breadcrumbs";

class TextCrumb extends BreadcrumbsItem {
  constructor(readonly text: string) { super(); }
  disposed = false;
  rendered = 0;
  override dispose(): void { this.disposed = true; }
  override equals(other: BreadcrumbsItem): boolean { return other instanceof TextCrumb && other.text === this.text; }
  override render(container: HTMLElement): void {
    this.rendered++;
    const s = document.createElement("span");
    s.className = "crumb-label";
    s.textContent = this.text;
    container.appendChild(s);
  }
}

let container: HTMLElement;
let widget: BreadcrumbsWidget | undefined;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = function () {};
  }
});
afterEach(() => {
  widget?.dispose();
  widget = undefined;
});

describe("ui/BreadcrumbsWidget — mount + render", () => {
  it("mounts `.parallx-breadcrumbs` with role='list'", () => {
    widget = new BreadcrumbsWidget(container);
    const el = container.querySelector(".parallx-breadcrumbs") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("list");
    expect(el).toBe(widget.domNode);
  });

  it("setItems renders one `.parallx-breadcrumb-item[role='listitem']` per item with a separator", () => {
    widget = new BreadcrumbsWidget(container);
    const items = [new TextCrumb("a"), new TextCrumb("b"), new TextCrumb("c")];
    widget.setItems(items);

    const rows = container.querySelectorAll(".parallx-breadcrumb-item");
    expect(rows.length).toBe(3);
    rows.forEach(r => {
      expect(r.getAttribute("role")).toBe("listitem");
      expect(r.querySelector(".breadcrumb-separator")).toBeTruthy();
    });
    items.forEach(i => expect(i.rendered).toBe(1));
    const labels = Array.from(container.querySelectorAll(".crumb-label")).map(n => n.textContent);
    expect(labels).toEqual(["a", "b", "c"]);
  });
});

describe("ui/BreadcrumbsWidget — interaction", () => {
  it("click on an item fires onDidSelectItem and onDidFocusItem, applies `.selected` and `.focused`", () => {
    widget = new BreadcrumbsWidget(container);
    const items = [new TextCrumb("a"), new TextCrumb("b")];
    widget.setItems(items);
    const onSelect = vi.fn();
    const onFocus = vi.fn();
    widget.onDidSelectItem(onSelect);
    widget.onDidFocusItem(onFocus);

    const rows = container.querySelectorAll<HTMLElement>(".parallx-breadcrumb-item");
    rows[1].click();

    expect(rows[1].classList.contains("selected")).toBe(true);
    expect(rows[1].classList.contains("focused")).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].item).toBe(items[1]);
  });

  it("ArrowRight moves focus forward; ArrowLeft moves it back", () => {
    widget = new BreadcrumbsWidget(container);
    const items = [new TextCrumb("a"), new TextCrumb("b"), new TextCrumb("c")];
    widget.setItems(items);
    // Start at item 0
    widget.setFocused(items[0]);

    widget.domNode.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(widget.getFocused()).toBe(items[1]);

    widget.domNode.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(widget.getFocused()).toBe(items[0]);
  });

  it("Escape clears focus and selection", () => {
    widget = new BreadcrumbsWidget(container);
    const items = [new TextCrumb("a"), new TextCrumb("b")];
    widget.setItems(items);
    widget.setFocused(items[1]);
    widget.setSelection(items[1]);

    widget.domNode.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(widget.getFocused()).toBeUndefined();
    expect(widget.getSelection()).toBeUndefined();
  });

  it("setEnabled(false) adds `.disabled` and suppresses click handling", () => {
    widget = new BreadcrumbsWidget(container);
    const items = [new TextCrumb("a"), new TextCrumb("b")];
    widget.setItems(items);
    const onSelect = vi.fn();
    widget.onDidSelectItem(onSelect);

    widget.setEnabled(false);
    expect(widget.domNode.classList.contains("disabled")).toBe(true);

    const rows = container.querySelectorAll<HTMLElement>(".parallx-breadcrumb-item");
    rows[1].click();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ui/BreadcrumbsWidget — dispose", () => {
  it("dispose() removes the dom node and disposes items", () => {
    widget = new BreadcrumbsWidget(container);
    const items = [new TextCrumb("a"), new TextCrumb("b")];
    widget.setItems(items);

    expect(container.querySelector(".parallx-breadcrumbs")).toBeTruthy();
    widget.dispose();
    widget = undefined;

    expect(container.querySelector(".parallx-breadcrumbs")).toBeNull();
    items.forEach(i => expect(i.disposed).toBe(true));
  });
});
