/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { Textarea } from "../../src/ui/textarea";

describe("Textarea pin", () => {
  it("creates .ui-textarea wrapper + .ui-textarea__input textarea inside container", () => {
    const host = document.createElement("div");
    const t = new Textarea(host);
    expect(host.children.length).toBe(1);
    expect(t.element.classList.contains("ui-textarea")).toBe(true);
    expect(t.textareaElement.tagName).toBe("TEXTAREA");
    expect(t.textareaElement.classList.contains("ui-textarea__input")).toBe(true);
    expect(t.textareaElement.spellcheck).toBe(false);
    t.dispose();
  });

  it("default rows is 4; rows option overrides", () => {
    const a = new Textarea(document.createElement("div"));
    expect(a.textareaElement.rows).toBe(4);
    const b = new Textarea(document.createElement("div"), { rows: 7 });
    expect(b.textareaElement.rows).toBe(7);
    a.dispose(); b.dispose();
  });

  it("applies initial value, placeholder, and aria-label", () => {
    const t = new Textarea(document.createElement("div"), {
      value: "hi", placeholder: "type", ariaLabel: "label",
    });
    expect(t.textareaElement.value).toBe("hi");
    expect(t.textareaElement.placeholder).toBe("type");
    expect(t.textareaElement.getAttribute("aria-label")).toBe("label");
    t.dispose();
  });

  it("readonly option sets attribute + class on wrapper", () => {
    const t = new Textarea(document.createElement("div"), { readonly: true });
    expect(t.textareaElement.readOnly).toBe(true);
    expect(t.element.classList.contains("ui-textarea--readonly")).toBe(true);
    t.dispose();
  });

  it("disabled option sets attribute + class on wrapper", () => {
    const t = new Textarea(document.createElement("div"), { disabled: true });
    expect(t.textareaElement.disabled).toBe(true);
    expect(t.element.classList.contains("ui-textarea--disabled")).toBe(true);
    t.dispose();
  });

  it("value getter/setter round-trips through DOM", () => {
    const t = new Textarea(document.createElement("div"));
    t.value = "abc";
    expect(t.value).toBe("abc");
    expect(t.textareaElement.value).toBe("abc");
    t.dispose();
  });

  it("readonly setter toggles attribute and class symmetrically", () => {
    const t = new Textarea(document.createElement("div"));
    t.readonly = true;
    expect(t.textareaElement.readOnly).toBe(true);
    expect(t.element.classList.contains("ui-textarea--readonly")).toBe(true);
    t.readonly = false;
    expect(t.textareaElement.readOnly).toBe(false);
    expect(t.element.classList.contains("ui-textarea--readonly")).toBe(false);
    t.dispose();
  });

  it("disabled setter toggles attribute and class symmetrically", () => {
    const t = new Textarea(document.createElement("div"));
    t.disabled = true;
    expect(t.textareaElement.disabled).toBe(true);
    expect(t.element.classList.contains("ui-textarea--disabled")).toBe(true);
    t.disabled = false;
    expect(t.textareaElement.disabled).toBe(false);
    expect(t.element.classList.contains("ui-textarea--disabled")).toBe(false);
    t.dispose();
  });

  it("input event fires onDidChange with current value", () => {
    const t = new Textarea(document.createElement("div"));
    const seen: string[] = [];
    t.onDidChange(v => seen.push(v));
    t.textareaElement.value = "x";
    t.textareaElement.dispatchEvent(new Event("input"));
    expect(seen).toEqual(["x"]);
    t.dispose();
  });

  it("blur event fires onDidBlur", () => {
    const t = new Textarea(document.createElement("div"));
    const seen = vi.fn();
    t.onDidBlur(seen);
    t.textareaElement.dispatchEvent(new Event("blur"));
    expect(seen).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  it("focus() focuses the underlying textarea element", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const t = new Textarea(host);
    t.focus();
    expect(document.activeElement).toBe(t.textareaElement);
    t.dispose();
    document.body.removeChild(host);
  });
});
