/**
 * @vitest-environment jsdom
 */
// actionBarPin.test.ts — pin ActionBar DOM render + click event contract.

import { describe, it, expect, vi } from "vitest";
import { ActionBar } from "../../src/ui/actionBar";

describe("ActionBar", () => {
  it("constructor creates an empty toolbar appended to the container", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    expect(bar.element.classList.contains("ui-action-bar")).toBe(true);
    expect(bar.element.getAttribute("role")).toBe("toolbar");
    expect(root.children.length).toBe(1);
    expect(bar.element.children.length).toBe(0);
  });

  it("setActions renders one .ui-action-bar-item button per action", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    bar.setActions([
      { id: "save", label: "Save" },
      { id: "del", label: "Delete" },
    ]);
    expect(bar.element.querySelectorAll(".ui-action-bar-item").length).toBe(2);
  });

  it("disabled action gets the --disabled class and button.disabled=true", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    bar.setActions([{ id: "x", label: "X", enabled: false }]);
    const btn = bar.element.querySelector("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("ui-action-bar-item--disabled")).toBe(true);
  });

  it("action with icon renders an icon span and no label span", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    bar.setActions([{ id: "x", label: "Hi", icon: "★" }]);
    const btn = bar.element.querySelector("button") as HTMLButtonElement;
    expect(btn.querySelector(".ui-action-bar-icon")?.textContent).toBe("★");
    expect(btn.querySelector(".ui-action-bar-label")).toBeNull();
  });

  it("action without icon renders a label span containing the label text", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    bar.setActions([{ id: "x", label: "Hello" }]);
    const btn = bar.element.querySelector("button") as HTMLButtonElement;
    expect(btn.querySelector(".ui-action-bar-label")?.textContent).toBe("Hello");
    expect(btn.querySelector(".ui-action-bar-icon")).toBeNull();
  });

  it("clicking an enabled action fires onDidRun with the action id", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    bar.setActions([{ id: "save", label: "Save" }]);
    const fired = vi.fn();
    bar.onDidRun(fired);
    (bar.element.querySelector("button") as HTMLButtonElement).click();
    expect(fired).toHaveBeenCalledWith("save");
  });

  it("clicking a disabled action does NOT fire onDidRun", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    bar.setActions([{ id: "x", label: "X", enabled: false }]);
    const fired = vi.fn();
    bar.onDidRun(fired);
    (bar.element.querySelector("button") as HTMLButtonElement).click();
    expect(fired).not.toHaveBeenCalled();
  });

  it("setActions replaces previous actions entirely", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    bar.setActions([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
    bar.setActions([{ id: "c", label: "C" }]);
    const buttons = bar.element.querySelectorAll(".ui-action-bar-item");
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain("C");
  });

  it("getAction returns the registered action by id", () => {
    const root = document.createElement("div");
    const bar = new ActionBar(root);
    bar.setActions([{ id: "save", label: "Save" }]);
    expect(bar.getAction("save")?.label).toBe("Save");
    expect(bar.getAction("nope")).toBeUndefined();
  });
});
