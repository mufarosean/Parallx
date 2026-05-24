/** @vitest-environment jsdom */
/**
 * Pin tests for src/ui/segmentedControl.ts — SegmentedControl invariants.
 *
 * Pins:
 *   - Mounts `.ui-segmented-control` with role='radiogroup'.
 *   - Renders one `<button>.ui-segmented-control__segment` per segment with role='radio'.
 *   - Initial active segment matches `selected` (or first if omitted).
 *   - Active segment gets `.ui-segmented-control__segment--active` and aria-checked='true'.
 *   - Clicking a non-active segment switches active state and fires onDidChange.
 *   - Clicking the already-active segment does NOT fire onDidChange.
 *   - disabled=true adds `.ui-segmented-control--disabled` and disables all buttons.
 *   - ArrowRight / ArrowLeft keys move active.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SegmentedControl } from "../../src/ui/segmentedControl";

let container: HTMLElement;
let ctrl: SegmentedControl | undefined;
const SEGS = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "detailed", label: "Detailed" },
];

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  ctrl?.dispose();
  ctrl = undefined;
});

describe("ui/SegmentedControl — mount + render", () => {
  it("mounts `.ui-segmented-control` with role='radiogroup'", () => {
    ctrl = new SegmentedControl(container, { segments: SEGS });
    const el = container.querySelector(".ui-segmented-control") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("radiogroup");
  });

  it("renders one button per segment with role='radio' and the label text", () => {
    ctrl = new SegmentedControl(container, { segments: SEGS });
    const btns = container.querySelectorAll<HTMLButtonElement>("button.ui-segmented-control__segment");
    expect(btns.length).toBe(3);
    expect(Array.from(btns).map(b => b.textContent)).toEqual(["Concise", "Balanced", "Detailed"]);
    btns.forEach(b => expect(b.getAttribute("role")).toBe("radio"));
  });

  it("first segment is active when `selected` is omitted", () => {
    ctrl = new SegmentedControl(container, { segments: SEGS });
    const btns = container.querySelectorAll<HTMLButtonElement>("button.ui-segmented-control__segment");
    expect(btns[0].classList.contains("ui-segmented-control__segment--active")).toBe(true);
    expect(btns[0].getAttribute("aria-checked")).toBe("true");
    expect(ctrl.value).toBe("concise");
  });

  it("`selected` option sets the initially active segment", () => {
    ctrl = new SegmentedControl(container, { segments: SEGS, selected: "balanced" });
    expect(ctrl.value).toBe("balanced");
    const btns = container.querySelectorAll<HTMLButtonElement>("button.ui-segmented-control__segment");
    expect(btns[1].classList.contains("ui-segmented-control__segment--active")).toBe(true);
  });
});

describe("ui/SegmentedControl — interaction", () => {
  it("clicking a non-active segment switches active and fires onDidChange", () => {
    ctrl = new SegmentedControl(container, { segments: SEGS });
    const onChange = vi.fn();
    ctrl.onDidChange(onChange);
    const btns = container.querySelectorAll<HTMLButtonElement>("button.ui-segmented-control__segment");
    btns[2].click();
    expect(ctrl.value).toBe("detailed");
    expect(btns[2].classList.contains("ui-segmented-control__segment--active")).toBe(true);
    expect(btns[0].classList.contains("ui-segmented-control__segment--active")).toBe(false);
    expect(onChange).toHaveBeenCalledWith("detailed");
  });

  it("clicking the already-active segment does NOT fire onDidChange", () => {
    ctrl = new SegmentedControl(container, { segments: SEGS, selected: "balanced" });
    const onChange = vi.fn();
    ctrl.onDidChange(onChange);
    const btns = container.querySelectorAll<HTMLButtonElement>("button.ui-segmented-control__segment");
    btns[1].click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled=true adds `.ui-segmented-control--disabled` and disables every button", () => {
    ctrl = new SegmentedControl(container, { segments: SEGS, disabled: true });
    const root = container.querySelector(".ui-segmented-control") as HTMLElement;
    expect(root.classList.contains("ui-segmented-control--disabled")).toBe(true);
    const btns = container.querySelectorAll<HTMLButtonElement>("button.ui-segmented-control__segment");
    btns.forEach(b => expect(b.disabled).toBe(true));
  });

  it("ArrowRight moves selection forward; ArrowLeft moves it back", () => {
    ctrl = new SegmentedControl(container, { segments: SEGS });
    const onChange = vi.fn();
    ctrl.onDidChange(onChange);
    const root = container.querySelector(".ui-segmented-control") as HTMLElement;

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(ctrl.value).toBe("balanced");

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(ctrl.value).toBe("concise");

    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
