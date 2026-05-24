/** @vitest-environment jsdom */
//
// Pin tests for src/ui/breadcrumbs.ts — BreadcrumbsWidget.
//
// Covers structural invariants:
//   - DOM scaffolding (.parallx-breadcrumbs, role=list, tabIndex)
//   - setItems renders one .parallx-breadcrumb-item per entry + role=listitem
//   - Each item gets a .breadcrumb-separator chevron
//   - Render error fallback ("<<RENDER ERROR>>")
//   - Item dispose called on replacement + widget dispose
//   - setEnabled toggles .disabled class
//   - focusNext/focusPrev clamp and fire onDidFocusItem
//   - Enter selects focused item and fires onDidSelectItem
//   - ArrowLeft/ArrowRight move focus + preventDefault
//   - Escape clears focus + selection
//   - Click on item focuses + selects (one of each event)
//   - Disabled widget ignores keyboard + click

import { describe, it, expect, beforeAll } from "vitest";
import { BreadcrumbsWidget, BreadcrumbsItem } from "../../src/ui/breadcrumbs.js";

beforeAll(() => {
  // jsdom does not implement scrollIntoView; widget calls it in revealLast/reveal.
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

class TextItem extends BreadcrumbsItem {
  disposed = false;
  constructor(public label: string) { super(); }
  render(container: HTMLElement): void {
    const span = document.createElement("span");
    span.textContent = this.label;
    container.appendChild(span);
  }
  equals(other: BreadcrumbsItem): boolean {
    return other instanceof TextItem && other.label === this.label;
  }
  dispose(): void { this.disposed = true; }
}

class ThrowingItem extends BreadcrumbsItem {
  render(_container: HTMLElement): void { throw new Error("boom"); }
  equals(other: BreadcrumbsItem): boolean { return other === this; }
  dispose(): void {}
}

function makeWidget() {
  const container = document.createElement("div");
  const w = new BreadcrumbsWidget(container);
  return { container, w };
}

describe("BreadcrumbsWidget — DOM scaffolding", () => {
  it("appends a .parallx-breadcrumbs node to the container with role=list and tabIndex=0", () => {
    const { container, w } = makeWidget();
    const dom = w.domNode;
    expect(dom.parentElement).toBe(container);
    expect(dom.classList.contains("parallx-breadcrumbs")).toBe(true);
    expect(dom.getAttribute("role")).toBe("list");
    expect(dom.tabIndex).toBe(0);
    w.dispose();
  });

  it("getItems() returns empty initially", () => {
    const { w } = makeWidget();
    expect(w.getItems()).toEqual([]);
    w.dispose();
  });
});

describe("BreadcrumbsWidget — setItems rendering", () => {
  it("renders one .parallx-breadcrumb-item per entry with role=listitem + separator", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b"), new TextItem("c")];
    w.setItems(items);

    const nodes = w.domNode.querySelectorAll(".parallx-breadcrumb-item");
    expect(nodes.length).toBe(3);
    for (const n of nodes) {
      expect(n.getAttribute("role")).toBe("listitem");
      expect((n as HTMLElement).tabIndex).toBe(-1);
      expect(n.querySelector(".breadcrumb-separator")).not.toBeNull();
    }
    expect(w.getItems().length).toBe(3);
    w.dispose();
  });

  it("disposes previous items when setItems is called again", () => {
    const { w } = makeWidget();
    const first = [new TextItem("a"), new TextItem("b")];
    w.setItems(first);
    const second = [new TextItem("c")];
    w.setItems(second);
    expect(first[0].disposed).toBe(true);
    expect(first[1].disposed).toBe(true);
    expect(second[0].disposed).toBe(false);
    w.dispose();
  });

  it("falls back to <<RENDER ERROR>> when an item's render throws", () => {
    const { w } = makeWidget();
    // Silence console.error noise from the catch block
    const orig = console.error;
    console.error = () => {};
    try {
      w.setItems([new ThrowingItem()]);
      const node = w.domNode.querySelector(".parallx-breadcrumb-item") as HTMLElement;
      expect(node).not.toBeNull();
      // textContent contains both the fallback marker and the separator's '›'
      expect(node.textContent || "").toContain("<<RENDER ERROR>>");
    } finally {
      console.error = orig;
    }
    w.dispose();
  });
});

describe("BreadcrumbsWidget — enabled/disabled", () => {
  it("setEnabled(false) adds .disabled class; setEnabled(true) removes it", () => {
    const { w } = makeWidget();
    w.setEnabled(false);
    expect(w.domNode.classList.contains("disabled")).toBe(true);
    w.setEnabled(true);
    expect(w.domNode.classList.contains("disabled")).toBe(false);
    w.dispose();
  });
});

describe("BreadcrumbsWidget — focus navigation", () => {
  it("focusNext advances focus and fires onDidFocusItem", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b"), new TextItem("c")];
    w.setItems(items);
    const events: BreadcrumbsItem[] = [];
    w.onDidFocusItem(e => events.push(e.item));

    w.focusNext();
    expect(w.getFocused()).toBe(items[0]);
    w.focusNext();
    expect(w.getFocused()).toBe(items[1]);
    w.focusNext();
    expect(w.getFocused()).toBe(items[2]);
    // Clamp at end
    w.focusNext();
    expect(w.getFocused()).toBe(items[2]);
    expect(events.length).toBe(3);
    w.dispose();
  });

  it("focusPrev clamps at start", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    w.setFocused(items[1]);
    w.focusPrev();
    expect(w.getFocused()).toBe(items[0]);
    w.focusPrev();
    expect(w.getFocused()).toBe(items[0]);
    w.dispose();
  });

  it("setFocused(undefined) clears focus", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    w.setFocused(items[0]);
    expect(w.getFocused()).toBe(items[0]);
    w.setFocused(undefined);
    expect(w.getFocused()).toBeUndefined();
    w.dispose();
  });
});

describe("BreadcrumbsWidget — selection", () => {
  it("setSelection fires onDidSelectItem and adds .selected", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    const fired: BreadcrumbsItem[] = [];
    w.onDidSelectItem(e => fired.push(e.item));
    w.setSelection(items[1]);
    expect(w.getSelection()).toBe(items[1]);
    expect(fired).toEqual([items[1]]);
    const node = w.domNode.querySelectorAll(".parallx-breadcrumb-item")[1] as HTMLElement;
    expect(node.classList.contains("selected")).toBe(true);
    w.dispose();
  });
});

describe("BreadcrumbsWidget — keyboard", () => {
  function fireKey(el: HTMLElement, key: string): KeyboardEvent {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  }

  it("ArrowRight moves focus forward and preventDefaults", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    const ev = fireKey(w.domNode, "ArrowRight");
    expect(ev.defaultPrevented).toBe(true);
    expect(w.getFocused()).toBe(items[0]);
    w.dispose();
  });

  it("ArrowLeft moves focus backward", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    w.setFocused(items[1]);
    const ev = fireKey(w.domNode, "ArrowLeft");
    expect(ev.defaultPrevented).toBe(true);
    expect(w.getFocused()).toBe(items[0]);
    w.dispose();
  });

  it("Enter selects the currently focused item", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    w.setFocused(items[1]);
    const fired: BreadcrumbsItem[] = [];
    w.onDidSelectItem(e => fired.push(e.item));
    const ev = fireKey(w.domNode, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(fired).toEqual([items[1]]);
    w.dispose();
  });

  it("Escape clears focus and selection", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    w.setFocused(items[0]);
    w.setSelection(items[0]);
    const ev = fireKey(w.domNode, "Escape");
    expect(ev.defaultPrevented).toBe(true);
    expect(w.getFocused()).toBeUndefined();
    expect(w.getSelection()).toBeUndefined();
    w.dispose();
  });

  it("disabled widget ignores ArrowRight", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    w.setEnabled(false);
    fireKey(w.domNode, "ArrowRight");
    expect(w.getFocused()).toBeUndefined();
    w.dispose();
  });
});

describe("BreadcrumbsWidget — click + dispose", () => {
  it("clicking a child of an item focuses + selects that item", () => {
    const { w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b"), new TextItem("c")];
    w.setItems(items);
    const itemNode = w.domNode.querySelectorAll(".parallx-breadcrumb-item")[2] as HTMLElement;
    const inner = itemNode.querySelector("span") as HTMLElement;
    const focused: BreadcrumbsItem[] = [];
    const selected: BreadcrumbsItem[] = [];
    w.onDidFocusItem(e => focused.push(e.item));
    w.onDidSelectItem(e => selected.push(e.item));
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(focused).toEqual([items[2]]);
    expect(selected).toEqual([items[2]]);
    w.dispose();
  });

  it("dispose removes the DOM node, clears items, and disposes them", () => {
    const { container, w } = makeWidget();
    const items = [new TextItem("a"), new TextItem("b")];
    w.setItems(items);
    w.dispose();
    expect(container.querySelector(".parallx-breadcrumbs")).toBeNull();
    expect(items[0].disposed).toBe(true);
    expect(items[1].disposed).toBe(true);
    expect(w.getItems()).toEqual([]);
  });
});
