/** @vitest-environment jsdom */
/**
 * Pin tests for src/ui/slider.ts — Slider invariants.
 *
 * Pins:
 *   - Constructor mounts `.ui-slider` with `<input type="range">` (.ui-slider__input).
 *   - min/max/step/value attributes reflect options.
 *   - `value` defaults to `min` when not provided.
 *   - `disabled` adds `.ui-slider--disabled` and disables the input.
 *   - `labeledStops` renders `.ui-slider__stops` with one `.ui-slider__stop` per entry,
 *     sorted by ascending value.
 *   - Input event fires `onDidChange` with the new numeric value.
 *   - `--slider-fill` CSS custom property is set on the wrapper.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Slider } from "../../src/ui/slider";

let container: HTMLElement;
let slider: Slider | undefined;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  slider?.dispose();
  slider = undefined;
});

describe("ui/Slider — mount", () => {
  it("mounts `.ui-slider` with an `<input type='range'>` child", () => {
    slider = new Slider(container);
    const wrapper = container.querySelector(".ui-slider") as HTMLElement;
    expect(wrapper).toBeTruthy();
    const input = wrapper.querySelector("input.ui-slider__input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("range");
  });

  it("min/max/step/value attributes reflect options", () => {
    slider = new Slider(container, { min: 10, max: 50, step: 5, value: 25 });
    const input = container.querySelector("input.ui-slider__input") as HTMLInputElement;
    expect(input.min).toBe("10");
    expect(input.max).toBe("50");
    expect(input.step).toBe("5");
    expect(input.value).toBe("25");
    expect(slider.value).toBe(25);
  });

  it("value defaults to min when not provided", () => {
    slider = new Slider(container, { min: 7, max: 100 });
    expect(slider.value).toBe(7);
  });
});

describe("ui/Slider — disabled + stops", () => {
  it("disabled adds `.ui-slider--disabled` and disables the input", () => {
    slider = new Slider(container, { disabled: true });
    const wrapper = container.querySelector(".ui-slider") as HTMLElement;
    const input = wrapper.querySelector("input") as HTMLInputElement;
    expect(wrapper.classList.contains("ui-slider--disabled")).toBe(true);
    expect(input.disabled).toBe(true);
  });

  it("labeledStops renders sorted `.ui-slider__stop` entries inside `.ui-slider__stops`", () => {
    slider = new Slider(container, {
      labeledStops: [
        { value: 50, label: "Mid" },
        { value: 0, label: "Low" },
        { value: 100, label: "High" },
      ],
    });
    const stops = container.querySelectorAll(".ui-slider__stops .ui-slider__stop");
    expect(Array.from(stops).map(n => n.textContent)).toEqual(["Low", "Mid", "High"]);
  });
});

describe("ui/Slider — events + fill", () => {
  it("input event fires onDidChange with the new numeric value", () => {
    slider = new Slider(container, { min: 0, max: 100, value: 10 });
    const onChange = vi.fn();
    slider.onDidChange(onChange);

    const input = container.querySelector("input.ui-slider__input") as HTMLInputElement;
    input.value = "42";
    input.dispatchEvent(new Event("input"));

    expect(onChange).toHaveBeenCalledWith(42);
    expect(slider.value).toBe(42);
  });

  it("`--slider-fill` CSS custom property is set on the wrapper after construction", () => {
    slider = new Slider(container, { min: 0, max: 100, value: 25 });
    const wrapper = container.querySelector(".ui-slider") as HTMLElement;
    const fill = wrapper.style.getPropertyValue("--slider-fill");
    expect(fill).toBe("25%");
  });
});
