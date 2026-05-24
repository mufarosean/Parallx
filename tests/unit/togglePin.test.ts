/** @vitest-environment jsdom */
/**
 * Pin tests for src/ui/toggle.ts — Toggle invariants.
 *
 * Pins:
 *   - Constructor mounts `.ui-toggle` with role='switch' into the container.
 *   - aria-checked reflects initial `checked` option.
 *   - `disabled` flag adds `.ui-toggle--disabled`.
 *   - `label` option renders `.ui-toggle__label` with that text.
 *   - Clicking flips `checked`, updates `.ui-toggle--checked`, fires onDidChange.
 *   - Click on a disabled toggle is a no-op.
 *   - Space and Enter keys toggle; other keys do not.
 *   - Setter `checked = v` updates DOM but does NOT fire onDidChange.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Toggle } from "../../src/ui/toggle";

let container: HTMLElement;
let toggle: Toggle | undefined;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  toggle?.dispose();
  toggle = undefined;
});

describe("ui/Toggle — mount + initial state", () => {
  it("mounts `.ui-toggle` with role='switch' into the container", () => {
    toggle = new Toggle(container);
    const el = container.querySelector(".ui-toggle") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("switch");
    expect(el.getAttribute("aria-checked")).toBe("false");
  });

  it("checked=true initializes with `.ui-toggle--checked` and aria-checked='true'", () => {
    toggle = new Toggle(container, { checked: true });
    const el = container.querySelector(".ui-toggle") as HTMLElement;
    expect(el.classList.contains("ui-toggle--checked")).toBe(true);
    expect(el.getAttribute("aria-checked")).toBe("true");
  });

  it("disabled=true adds `.ui-toggle--disabled`", () => {
    toggle = new Toggle(container, { disabled: true });
    const el = container.querySelector(".ui-toggle") as HTMLElement;
    expect(el.classList.contains("ui-toggle--disabled")).toBe(true);
  });

  it("`label` option renders `.ui-toggle__label` with text", () => {
    toggle = new Toggle(container, { label: "Enable" });
    const lbl = container.querySelector(".ui-toggle__label");
    expect(lbl?.textContent).toBe("Enable");
  });
});

describe("ui/Toggle — interaction", () => {
  it("clicking flips checked, updates the class, fires onDidChange", () => {
    toggle = new Toggle(container);
    const onChange = vi.fn();
    toggle.onDidChange(onChange);

    toggle.element.click();
    expect(toggle.checked).toBe(true);
    expect(toggle.element.classList.contains("ui-toggle--checked")).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("click on a disabled toggle is a no-op", () => {
    toggle = new Toggle(container, { disabled: true });
    const onChange = vi.fn();
    toggle.onDidChange(onChange);

    toggle.element.click();
    expect(toggle.checked).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Space and Enter toggle; other keys do not", () => {
    toggle = new Toggle(container);
    const onChange = vi.fn();
    toggle.onDidChange(onChange);

    toggle.element.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(toggle.checked).toBe(true);

    toggle.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(toggle.checked).toBe(false);

    toggle.element.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(toggle.checked).toBe(false);

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("setter `checked = v` updates DOM/aria but does NOT fire onDidChange", () => {
    toggle = new Toggle(container);
    const onChange = vi.fn();
    toggle.onDidChange(onChange);

    toggle.checked = true;
    expect(toggle.element.classList.contains("ui-toggle--checked")).toBe(true);
    expect(toggle.element.getAttribute("aria-checked")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });
});
