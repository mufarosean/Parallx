/**
 * @vitest-environment jsdom
 *
 * Pin: inputIsolation.isolateInputFromEditor — stop-propagation contract
 * for popup inputs that float inside ProseMirror. Without this, every
 * canvas insert popup (image/media/bookmark URL field) leaks events
 * back into the editor view.
 */
import { describe, it, expect, vi } from "vitest";
import { isolateInputFromEditor } from "../../src/built-in/canvas/menus/inputIsolation";

function makeInput(): { parent: HTMLElement; input: HTMLInputElement } {
  const parent = document.createElement("div");
  const input = document.createElement("input");
  parent.appendChild(input);
  document.body.appendChild(parent);
  return { parent, input };
}

describe("built-in/canvas/menus/inputIsolation", () => {
  it("Enter fires onSubmit and prevents default; bubbles stop at the input", () => {
    const { parent, input } = makeInput();
    const onSubmit = vi.fn();
    const parentKey = vi.fn();
    parent.addEventListener("keydown", parentKey);
    isolateInputFromEditor(input, { onSubmit });

    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(parentKey).not.toHaveBeenCalled();
  });

  it("Escape fires onCancel and prevents default", () => {
    const { input } = makeInput();
    const onCancel = vi.fn();
    isolateInputFromEditor(input, { onCancel });

    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Enter without onSubmit does NOT preventDefault (popup decides nothing)", () => {
    const { input } = makeInput();
    isolateInputFromEditor(input, {});
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("non-Enter / non-Escape keys still stopPropagation", () => {
    const { parent, input } = makeInput();
    const parentKey = vi.fn();
    parent.addEventListener("keydown", parentKey);
    isolateInputFromEditor(input);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(parentKey).not.toHaveBeenCalled();
  });

  it("keyup / keypress / paste / copy / cut all stopPropagation past the input", () => {
    const { parent, input } = makeInput();
    const seen = vi.fn();
    for (const type of ["keyup", "keypress", "paste", "copy", "cut"]) {
      parent.addEventListener(type, seen);
    }
    isolateInputFromEditor(input);

    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true }));
    input.dispatchEvent(new Event("paste", { bubbles: true }));
    input.dispatchEvent(new Event("copy", { bubbles: true }));
    input.dispatchEvent(new Event("cut", { bubbles: true }));

    expect(seen).not.toHaveBeenCalled();
  });

  it("input event fires onInput AFTER stopPropagation and does not bubble", () => {
    const { parent, input } = makeInput();
    const onInput = vi.fn();
    const parentInput = vi.fn();
    parent.addEventListener("input", parentInput);
    isolateInputFromEditor(input, { onInput });

    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(parentInput).not.toHaveBeenCalled();
  });

  it("works with no options (all hooks undefined, all events still isolated)", () => {
    const { parent, input } = makeInput();
    const seen = vi.fn();
    parent.addEventListener("keydown", seen);
    parent.addEventListener("input", seen);
    isolateInputFromEditor(input);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
  });
});
