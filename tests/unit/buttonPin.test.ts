/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { Button } from "../../src/ui/button";

describe("Button pin", () => {
  it("appends a <button type=button class=ui-button> to the container", () => {
    const host = document.createElement("div");
    const b = new Button(host);
    expect(host.children.length).toBe(1);
    expect(b.element.tagName).toBe("BUTTON");
    expect(b.element.type).toBe("button");
    expect(b.element.classList.contains("ui-button")).toBe(true);
    b.dispose();
  });

  it("secondary option adds .ui-button--secondary", () => {
    const b = new Button(document.createElement("div"), { secondary: true });
    expect(b.element.classList.contains("ui-button--secondary")).toBe(true);
    b.dispose();
  });

  it("label/icon getters/setters propagate to span children", () => {
    const b = new Button(document.createElement("div"), { label: "Save", icon: "X" });
    expect(b.label).toBe("Save");
    expect(b.icon).toBe("X");
    b.label = "OK";
    b.icon = "Y";
    expect(b.label).toBe("OK");
    expect(b.icon).toBe("Y");
    b.dispose();
  });

  it("icon-only class set when icon present and label empty", () => {
    const b = new Button(document.createElement("div"), { icon: "X" });
    expect(b.element.classList.contains("ui-button--icon-only")).toBe(true);
    b.label = "now-labeled";
    expect(b.element.classList.contains("ui-button--icon-only")).toBe(false);
    b.dispose();
  });

  it("icon setter toggles .ui-hidden on icon span when empty", () => {
    const b = new Button(document.createElement("div"));
    const iconSpan = b.element.querySelector(".ui-button-icon") as HTMLSpanElement;
    b.icon = "";
    expect(iconSpan.classList.contains("ui-hidden")).toBe(true);
    b.icon = "Q";
    expect(iconSpan.classList.contains("ui-hidden")).toBe(false);
    b.dispose();
  });

  it("title option sets element.title", () => {
    const b = new Button(document.createElement("div"), { title: "hover" });
    expect(b.element.title).toBe("hover");
    b.dispose();
  });

  it("enabled = false disables element and adds .ui-button--disabled", () => {
    const b = new Button(document.createElement("div"));
    expect(b.enabled).toBe(true);
    b.enabled = false;
    expect(b.element.disabled).toBe(true);
    expect(b.element.classList.contains("ui-button--disabled")).toBe(true);
    b.enabled = true;
    expect(b.element.disabled).toBe(false);
    expect(b.element.classList.contains("ui-button--disabled")).toBe(false);
    b.dispose();
  });

  it("click fires onDidClick when enabled, suppressed when disabled", () => {
    const b = new Button(document.createElement("div"));
    const seen = vi.fn();
    b.onDidClick(seen);
    b.element.click();
    expect(seen).toHaveBeenCalledTimes(1);
    b.enabled = false;
    b.element.click();
    expect(seen).toHaveBeenCalledTimes(1);
    b.dispose();
  });

  it("focus() focuses the underlying button element", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const b = new Button(host);
    b.focus();
    expect(document.activeElement).toBe(b.element);
    b.dispose();
    document.body.removeChild(host);
  });
});
