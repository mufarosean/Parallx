/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { View, DEFAULT_SIZE_CONSTRAINTS } from "../../src/views/view";
import type { ViewState } from "../../src/views/viewTypes";

class ProbeView extends View {
  public created = vi.fn();
  public laidOut = vi.fn();
  public saved: ViewState = { ok: true };
  public restored: ViewState | undefined;

  protected createViewContent(container: HTMLElement): void {
    this.created(container);
    const inner = document.createElement("span");
    inner.className = "inner";
    container.appendChild(inner);
  }

  protected override layoutContent(w: number, h: number): void {
    this.laidOut(w, h);
  }

  protected override saveViewState(): ViewState {
    return this.saved;
  }

  protected override restoreViewState(state: ViewState): void {
    this.restored = state;
  }

  fireConstraints(): void {
    this.fireConstraintsChanged();
  }
}

describe("View base pin", () => {
  it("default size constraints match DEFAULT_SIZE_CONSTRAINTS getters", () => {
    const v = new ProbeView("a", "A");
    expect(v.minimumWidth).toBe(DEFAULT_SIZE_CONSTRAINTS.minimumWidth);
    expect(v.maximumWidth).toBe(DEFAULT_SIZE_CONSTRAINTS.maximumWidth);
    expect(v.minimumHeight).toBe(DEFAULT_SIZE_CONSTRAINTS.minimumHeight);
    expect(v.maximumHeight).toBe(DEFAULT_SIZE_CONSTRAINTS.maximumHeight);
    v.dispose();
  });

  it("custom size constraints flow through getters", () => {
    const v = new ProbeView("a", "A", undefined, {
      minimumWidth: 10, maximumWidth: 100, minimumHeight: 20, maximumHeight: 200,
    });
    expect(v.minimumWidth).toBe(10);
    expect(v.maximumWidth).toBe(100);
    expect(v.minimumHeight).toBe(20);
    expect(v.maximumHeight).toBe(200);
    v.dispose();
  });

  it("createElement builds <div> with classes view + view-<id> + data-view-id; calls createViewContent once", () => {
    const v = new ProbeView("hello", "Hello");
    const host = document.createElement("div");
    v.createElement(host);
    const el = v.element!;
    expect(el).toBeDefined();
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("view")).toBe(true);
    expect(el.classList.contains("view-hello")).toBe(true);
    expect(el.getAttribute("data-view-id")).toBe("hello");
    expect(host.contains(el)).toBe(true);
    expect(v.created).toHaveBeenCalledTimes(1);
    expect(el.querySelector(".inner")).toBeTruthy();
    v.dispose();
  });

  it("createElement is idempotent: re-mounts into a new container without rebuilding content", () => {
    const v = new ProbeView("a", "A");
    const host1 = document.createElement("div");
    const host2 = document.createElement("div");
    v.createElement(host1);
    const el = v.element!;
    v.createElement(host2);
    expect(v.element).toBe(el);
    expect(host2.contains(el)).toBe(true);
    expect(v.created).toHaveBeenCalledTimes(1);
    v.dispose();
  });

  it("setVisible fires onDidChangeVisibility only on transitions and toggles .visible class", () => {
    const v = new ProbeView("a", "A");
    v.createElement(document.createElement("div"));
    const seen: boolean[] = [];
    v.onDidChangeVisibility(b => seen.push(b));
    expect(v.visible).toBe(false);
    v.setVisible(true);
    v.setVisible(true);
    v.setVisible(false);
    expect(seen).toEqual([true, false]);
    expect(v.element!.classList.contains("visible")).toBe(false);
    v.setVisible(true);
    expect(v.element!.classList.contains("visible")).toBe(true);
    v.dispose();
  });

  it("layout sets width/height + element style and invokes layoutContent", () => {
    const v = new ProbeView("a", "A");
    v.createElement(document.createElement("div"));
    v.layout(123, 45);
    expect(v.width).toBe(123);
    expect(v.height).toBe(45);
    expect(v.element!.style.width).toBe("123px");
    expect(v.element!.style.height).toBe("45px");
    expect(v.laidOut).toHaveBeenCalledWith(123, 45);
    v.dispose();
  });

  it("focus() forwards to element.focus() when present", () => {
    const v = new ProbeView("a", "A");
    const host = document.createElement("div");
    document.body.appendChild(host);
    v.createElement(host);
    v.element!.tabIndex = -1;
    v.focus();
    expect(document.activeElement).toBe(v.element);
    v.dispose();
    document.body.removeChild(host);
  });

  it("focus() is a no-op when element has not been created", () => {
    const v = new ProbeView("a", "A");
    expect(() => v.focus()).not.toThrow();
    v.dispose();
  });

  it("saveState/restoreState delegate to saveViewState/restoreViewState", () => {
    const v = new ProbeView("a", "A");
    expect(v.saveState()).toEqual({ ok: true });
    v.restoreState({ hello: 1 });
    expect(v.restored).toEqual({ hello: 1 });
    v.dispose();
  });

  it("fireConstraintsChanged emits onDidChangeConstraints", () => {
    const v = new ProbeView("a", "A");
    const seen = vi.fn();
    v.onDidChangeConstraints(seen);
    v.fireConstraints();
    expect(seen).toHaveBeenCalledTimes(1);
    v.dispose();
  });

  it("id, name, and icon are exposed verbatim", () => {
    const v = new ProbeView("idx", "Name", "iconX");
    expect(v.id).toBe("idx");
    expect(v.name).toBe("Name");
    expect(v.icon).toBe("iconX");
    v.dispose();
  });
});
