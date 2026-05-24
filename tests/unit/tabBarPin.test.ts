/** @vitest-environment jsdom */
/**
 * Pin tests for src/ui/tabBar.ts — invariant guards.
 *
 * Pins:
 *   - Constructor mounts `.ui-tab-bar` with role='tablist' into the container.
 *   - `setItems` renders one `.ui-tab` per item with role='tab', label text, and `data-tab-id`.
 *   - Closable items render `.ui-tab-close`; closable=false omits it.
 *   - Click on a tab fires `onDidSelect(id)`.
 *   - Click on `.ui-tab-close` fires `onDidClose(id)` and does NOT fire onDidSelect.
 *   - Dblclick fires `onDidDoubleClick(id)`.
 *   - Middle click (`auxclick` button 1) fires `onDidMiddleClick(id)`.
 *   - `setActive(id)` adds `.ui-tab--active` + aria-selected='true' on the tab; deactivates prev.
 *   - `getActive()` returns the active id.
 *   - `dirty` decoration renders `.ui-tab-dirty`; `pinned` adds `.ui-tab--sticky`.
 *   - `italic` flag adds `.ui-tab--italic`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TabBar } from "../../src/ui/tabBar";

let container: HTMLElement;
let bar: TabBar | undefined;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = function () {};
  }
});
afterEach(() => {
  bar?.dispose();
  bar = undefined;
  document.body.innerHTML = "";
});

describe("ui/tabBar — mount", () => {
  it("mounts `.ui-tab-bar` with role='tablist' into the container", () => {
    bar = new TabBar(container);
    const root = container.querySelector(".ui-tab-bar") as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute("role")).toBe("tablist");
    expect(bar.element).toBe(root);
  });
});

describe("ui/tabBar — setItems + rendering", () => {
  it("renders one `.ui-tab` per item with role='tab', label text, and data-tab-id", () => {
    bar = new TabBar(container);
    bar.setItems([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Bravo" },
    ]);
    const tabs = container.querySelectorAll<HTMLElement>(".ui-tab");
    expect(tabs.length).toBe(2);
    expect(tabs[0].getAttribute("role")).toBe("tab");
    expect(tabs[0].dataset.tabId).toBe("a");
    expect(tabs[1].dataset.tabId).toBe("b");
    const labels = Array.from(container.querySelectorAll(".ui-tab-label")).map(n => n.textContent);
    expect(labels).toEqual(["Alpha", "Bravo"]);
  });

  it("closable=true (default) renders `.ui-tab-close`; closable=false omits it", () => {
    bar = new TabBar(container);
    bar.setItems([
      { id: "a", label: "A" },
      { id: "b", label: "B", closable: false },
    ]);
    const tabs = container.querySelectorAll<HTMLElement>(".ui-tab");
    expect(tabs[0].querySelector(".ui-tab-close")).toBeTruthy();
    expect(tabs[1].querySelector(".ui-tab-close")).toBeNull();
  });

  it("decorations.dirty renders `.ui-tab-dirty`; decorations.pinned adds `.ui-tab--sticky`", () => {
    bar = new TabBar(container);
    bar.setItems([
      { id: "a", label: "A", decorations: { dirty: true } },
      { id: "b", label: "B", decorations: { pinned: true } },
    ]);
    const tabs = container.querySelectorAll<HTMLElement>(".ui-tab");
    expect(tabs[0].querySelector(".ui-tab-dirty")).toBeTruthy();
    expect(tabs[1].classList.contains("ui-tab--sticky")).toBe(true);
  });

  it("italic flag adds `.ui-tab--italic`", () => {
    bar = new TabBar(container);
    bar.setItems([{ id: "a", label: "A", italic: true }]);
    const tab = container.querySelector<HTMLElement>(".ui-tab")!;
    expect(tab.classList.contains("ui-tab--italic")).toBe(true);
  });
});

describe("ui/tabBar — events", () => {
  it("click on a tab fires onDidSelect with the id", () => {
    bar = new TabBar(container);
    const onSelect = vi.fn();
    bar.onDidSelect(onSelect);
    bar.setItems([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
    const tab = container.querySelectorAll<HTMLElement>(".ui-tab")[1];
    tab.click();
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("click on `.ui-tab-close` fires onDidClose and stops propagation (no onDidSelect)", () => {
    bar = new TabBar(container);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    bar.onDidSelect(onSelect);
    bar.onDidClose(onClose);
    bar.setItems([{ id: "a", label: "A" }]);
    const close = container.querySelector<HTMLElement>(".ui-tab-close")!;
    close.click();
    expect(onClose).toHaveBeenCalledWith("a");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("dblclick on a tab fires onDidDoubleClick with the id", () => {
    bar = new TabBar(container);
    const onDbl = vi.fn();
    bar.onDidDoubleClick(onDbl);
    bar.setItems([{ id: "a", label: "A" }]);
    const tab = container.querySelector<HTMLElement>(".ui-tab")!;
    tab.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onDbl).toHaveBeenCalledWith("a");
  });

  it("auxclick with button=1 fires onDidMiddleClick with the id", () => {
    bar = new TabBar(container);
    const onMid = vi.fn();
    bar.onDidMiddleClick(onMid);
    bar.setItems([{ id: "a", label: "A" }]);
    const tab = container.querySelector<HTMLElement>(".ui-tab")!;
    tab.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onMid).toHaveBeenCalledWith("a");
  });

  it("auxclick with button=0 does NOT fire onDidMiddleClick", () => {
    bar = new TabBar(container);
    const onMid = vi.fn();
    bar.onDidMiddleClick(onMid);
    bar.setItems([{ id: "a", label: "A" }]);
    const tab = container.querySelector<HTMLElement>(".ui-tab")!;
    tab.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 0 }));
    expect(onMid).not.toHaveBeenCalled();
  });
});

describe("ui/tabBar — setActive / getActive", () => {
  it("setActive adds `.ui-tab--active` + aria-selected='true' and deactivates the previous tab", () => {
    bar = new TabBar(container);
    bar.setItems([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
    bar.setActive("a");
    let tabs = container.querySelectorAll<HTMLElement>(".ui-tab");
    expect(tabs[0].classList.contains("ui-tab--active")).toBe(true);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(bar.getActive()).toBe("a");

    bar.setActive("b");
    tabs = container.querySelectorAll<HTMLElement>(".ui-tab");
    expect(tabs[0].classList.contains("ui-tab--active")).toBe(false);
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs[1].classList.contains("ui-tab--active")).toBe(true);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(bar.getActive()).toBe("b");
  });
});
