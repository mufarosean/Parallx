/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTooltip, updateTooltip } from "../../src/ui/tooltip";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("setupTooltip pin", () => {
  it("removes native title attribute and marks element as managed", () => {
    const el = document.createElement("button");
    el.setAttribute("title", "old");
    document.body.appendChild(el);
    const d = setupTooltip(el, "new");
    expect(el.hasAttribute("title")).toBe(false);
    expect(el.hasAttribute("data-parallx-tooltip-managed")).toBe(true);
    d.dispose();
  });

  it("shows tooltip after 500ms delay on mouseenter; hides on mouseleave", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    const d = setupTooltip(el, "hello");

    el.dispatchEvent(new MouseEvent("mouseenter"));
    // Not visible yet
    expect(document.querySelector(".parallx-tooltip")).toBeNull();

    vi.advanceTimersByTime(500);
    const tip = document.querySelector(".parallx-tooltip") as HTMLElement;
    expect(tip).not.toBeNull();
    expect(tip.textContent).toBe("hello");
    expect(tip.style.display).toBe("block");

    el.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(50);
    expect(tip.style.display).toBe("none");
    d.dispose();
  });

  it("mousedown also hides the tooltip", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    const d = setupTooltip(el, "x");
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(500);
    const tip = document.querySelector(".parallx-tooltip") as HTMLElement;
    expect(tip.style.display).toBe("block");
    el.dispatchEvent(new MouseEvent("mousedown"));
    vi.advanceTimersByTime(50);
    expect(tip.style.display).toBe("none");
    d.dispose();
  });

  it("dispose() removes all listeners and stops scheduled show", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    const d = setupTooltip(el, "x");
    el.dispatchEvent(new MouseEvent("mouseenter"));
    d.dispose();
    vi.advanceTimersByTime(1000);
    // After dispose, no tooltip should show
    const tip = document.querySelector(".parallx-tooltip") as HTMLElement | null;
    // Element may exist (singleton) but never set to block in this flow
    if (tip) {
      expect(tip.style.display).toBe("none");
    }
  });

  it("tooltip element has role=tooltip and class .parallx-tooltip", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    const d = setupTooltip(el, "x");
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(500);
    const tip = document.querySelector(".parallx-tooltip") as HTMLElement;
    expect(tip.getAttribute("role")).toBe("tooltip");
    d.dispose();
  });

  it("updateTooltip is alias for setupTooltip — replaces text", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    const d1 = setupTooltip(el, "old");
    const d2 = updateTooltip(el, "new");
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(500);
    const tip = document.querySelector(".parallx-tooltip") as HTMLElement;
    expect(tip.textContent).toBe("new");
    d1.dispose();
    d2.dispose();
  });
});
