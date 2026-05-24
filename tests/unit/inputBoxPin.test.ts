/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { InputBox } from "../../src/ui/inputBox.js";

describe("InputBox pin", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renders wrapper and input with optional placeholder, value, aria-label", () => {
    const box = new InputBox(container, {
      placeholder: "Type here",
      value: "hello",
      ariaLabel: "Name",
    });
    expect(box.element.classList.contains("ui-input-box")).toBe(true);
    expect(box.inputElement.classList.contains("ui-input-box-input")).toBe(true);
    expect(box.inputElement.placeholder).toBe("Type here");
    expect(box.inputElement.value).toBe("hello");
    expect(box.inputElement.getAttribute("aria-label")).toBe("Name");
    expect(box.inputElement.spellcheck).toBe(false);
    expect(box.inputElement.autocomplete).toBe("off");
    box.dispose();
  });

  it("defaults type to text; honors password type", () => {
    const text = new InputBox(container);
    expect(text.inputElement.type).toBe("text");
    text.dispose();

    const pass = new InputBox(document.createElement("div"), { type: "password" });
    expect(pass.inputElement.type).toBe("password");
    pass.dispose();
  });

  it("value getter/setter mirrors the input element", () => {
    const box = new InputBox(container, { value: "a" });
    expect(box.value).toBe("a");
    box.value = "b";
    expect(box.inputElement.value).toBe("b");
    expect(box.value).toBe("b");
    box.dispose();
  });

  it("fires onDidChange on input events", () => {
    const box = new InputBox(container);
    const seen: string[] = [];
    box.onDidChange((v) => seen.push(v));
    box.inputElement.value = "abc";
    box.inputElement.dispatchEvent(new Event("input"));
    expect(seen).toEqual(["abc"]);
    box.dispose();
  });

  it("Enter fires onDidSubmit with current value", () => {
    const box = new InputBox(container, { value: "submit-me" });
    let submitted: string | undefined;
    box.onDidSubmit((v) => { submitted = v; });
    box.inputElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(submitted).toBe("submit-me");
    box.dispose();
  });

  it("Escape fires onDidCancel", () => {
    const box = new InputBox(container);
    let cancelled = 0;
    box.onDidCancel(() => { cancelled++; });
    box.inputElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(cancelled).toBe(1);
    box.dispose();
  });

  it("showValidation toggles --invalid class and text", () => {
    const box = new InputBox(container);
    box.showValidation("Required");
    expect(box.element.classList.contains("ui-input-box--invalid")).toBe(true);
    const label = box.element.querySelector(".ui-input-box-validation")!;
    expect(label.textContent).toBe("Required");
    box.hideValidation();
    expect(box.element.classList.contains("ui-input-box--invalid")).toBe(false);
    expect(label.textContent).toBe("");
    box.dispose();
  });

  it("validationFn (sync) runs on input and updates the validation label", async () => {
    const box = new InputBox(container, {
      validationFn: (v) => (v.length < 3 ? "too short" : null),
    });
    box.inputElement.value = "ab";
    box.inputElement.dispatchEvent(new Event("input"));
    await Promise.resolve();
    expect(box.element.classList.contains("ui-input-box--invalid")).toBe(true);
    box.inputElement.value = "abcd";
    box.inputElement.dispatchEvent(new Event("input"));
    await Promise.resolve();
    expect(box.element.classList.contains("ui-input-box--invalid")).toBe(false);
    box.dispose();
  });

  it("validationFn (async) is awaited", async () => {
    const box = new InputBox(container, {
      validationFn: async (v) => (v === "bad" ? "nope" : null),
    });
    box.value = "bad";
    await new Promise((r) => setTimeout(r, 0));
    expect(box.element.classList.contains("ui-input-box--invalid")).toBe(true);
    box.dispose();
  });

  it("focus() and select() delegate to the input element", () => {
    const box = new InputBox(container, { value: "abc" });
    box.inputElement.focus = () => { (box.inputElement as any).__focused = true; };
    box.inputElement.select = () => { (box.inputElement as any).__selected = true; };
    box.focus();
    box.select();
    expect((box.inputElement as any).__focused).toBe(true);
    expect((box.inputElement as any).__selected).toBe(true);
    box.dispose();
  });

  it("dispose() does not throw and emitters stop firing afterwards", () => {
    const box = new InputBox(container);
    const seen: string[] = [];
    box.onDidChange((v) => seen.push(v));
    box.dispose();
    box.inputElement.value = "after";
    box.inputElement.dispatchEvent(new Event("input"));
    // Emitter is disposed; no new event should be observed.
    expect(seen).toEqual([]);
  });
});
