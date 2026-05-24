/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { FindReplaceWidget } from "../../src/ui/findReplaceWidget.js";

function mount() {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.appendChild(container);
  const ta = document.createElement("textarea");
  document.body.appendChild(ta);
  const w = new FindReplaceWidget(container, { textarea: ta });
  return { w, ta, container };
}

describe("FindReplaceWidget pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("hidden by default; show() reveals; hide() hides again and fires onDidClose", () => {
    const { w } = mount();
    expect(w.visible).toBe(false);
    expect(w.element.style.display).toBe("none");

    w.show();
    expect(w.visible).toBe(true);
    expect(w.element.style.display).toBe("");

    let closed = 0;
    w.onDidClose(() => { closed++; });
    w.hide();
    expect(w.visible).toBe(false);
    expect(w.element.style.display).toBe("none");
    expect(closed).toBe(1);
    w.dispose();
  });

  it("show(true) opens replace row; toggle button toggles it", () => {
    const { w } = mount();
    w.show(true);
    const replaceRow = w.element.querySelector(".find-replace-row--replace") as HTMLElement;
    expect(replaceRow.style.display).toBe("");
    const toggle = w.element.querySelector(".find-replace-toggle-btn") as HTMLButtonElement;
    toggle.click();
    expect(replaceRow.style.display).toBe("none");
    toggle.click();
    expect(replaceRow.style.display).toBe("");
    w.dispose();
  });

  it("show() seeds find input from textarea selection (single-line only)", () => {
    const { w, ta } = mount();
    ta.value = "hello world";
    ta.setSelectionRange(6, 11);
    w.show();
    const findInput = w.element.querySelector("input.find-replace-input") as HTMLInputElement;
    expect(findInput.value).toBe("world");
    w.dispose();
  });

  it("typing in find input runs search; match count reflects literal matches", () => {
    const { w, ta } = mount();
    ta.value = "foo Foo foo bar";
    w.show();
    const findInput = w.element.querySelector("input.find-replace-input") as HTMLInputElement;
    findInput.value = "foo";
    findInput.dispatchEvent(new Event("input"));
    const count = w.element.querySelector(".find-replace-match-count")!;
    // case-insensitive default → 3 matches
    expect(count.textContent).toMatch(/of 3/);
    w.dispose();
  });

  it("nextMatch / previousMatch wrap around", () => {
    const { w, ta } = mount();
    ta.value = "aa aa aa";
    w.show();
    const findInput = w.element.querySelector("input.find-replace-input") as HTMLInputElement;
    findInput.value = "aa";
    findInput.dispatchEvent(new Event("input"));
    const count = w.element.querySelector(".find-replace-match-count")!;
    const first = count.textContent;
    w.nextMatch();
    expect(count.textContent).not.toBe(first);
    w.nextMatch();
    w.nextMatch();
    // wrapped back
    expect(count.textContent).toMatch(/of 3/);
    w.previousMatch();
    expect(count.textContent).toMatch(/of 3/);
    w.dispose();
  });

  it("case-sensitive toggle changes match count", () => {
    const { w, ta } = mount();
    ta.value = "Foo foo";
    w.show();
    const findInput = w.element.querySelector("input.find-replace-input") as HTMLInputElement;
    findInput.value = "foo";
    findInput.dispatchEvent(new Event("input"));
    const count = w.element.querySelector(".find-replace-match-count")!;
    expect(count.textContent).toMatch(/of 2/);
    const caseBtn = w.element.querySelectorAll(".find-replace-option-btn")[0] as HTMLButtonElement;
    caseBtn.click();
    expect(count.textContent).toMatch(/of 1/);
    w.dispose();
  });

  it("regex toggle enables pattern syntax; invalid regex shows 'Invalid regex'", () => {
    const { w, ta } = mount();
    ta.value = "abc 123 xyz";
    w.show();
    const findInput = w.element.querySelector("input.find-replace-input") as HTMLInputElement;
    const opts = w.element.querySelectorAll(".find-replace-option-btn");
    (opts[2] as HTMLButtonElement).click(); // regex
    findInput.value = "\\d+";
    findInput.dispatchEvent(new Event("input"));
    const count = w.element.querySelector(".find-replace-match-count")!;
    expect(count.textContent).toMatch(/of 1/);
    findInput.value = "[";
    findInput.dispatchEvent(new Event("input"));
    expect(count.textContent).toBe("Invalid regex");
    w.dispose();
  });

  it("replaceCurrent() replaces the current match and dispatches input on textarea", () => {
    const { w, ta } = mount();
    ta.value = "alpha beta alpha";
    ta.setSelectionRange(0, 0); // cursor at start → first match is current
    w.show();
    const findInput = w.element.querySelector("input.find-replace-input") as HTMLInputElement;
    findInput.value = "alpha";
    findInput.dispatchEvent(new Event("input"));
    const replaceInput = w.element.querySelectorAll("input.find-replace-input")[1] as HTMLInputElement;
    replaceInput.value = "AAA";
    let inputs = 0;
    ta.addEventListener("input", () => { inputs++; });
    w.replaceCurrent();
    expect(ta.value).toBe("AAA beta alpha");
    expect(inputs).toBeGreaterThanOrEqual(1);
    w.dispose();
  });

  it("replaceAll() replaces every match", () => {
    const { w, ta } = mount();
    ta.value = "x x x";
    w.show();
    const findInput = w.element.querySelector("input.find-replace-input") as HTMLInputElement;
    findInput.value = "x";
    findInput.dispatchEvent(new Event("input"));
    const replaceInput = w.element.querySelectorAll("input.find-replace-input")[1] as HTMLInputElement;
    replaceInput.value = "yy";
    w.replaceAll();
    expect(ta.value).toBe("yy yy yy");
    w.dispose();
  });

  it("Escape in find input hides widget", () => {
    const { w } = mount();
    w.show();
    const findInput = w.element.querySelector("input.find-replace-input") as HTMLInputElement;
    findInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.visible).toBe(false);
    w.dispose();
  });

  it("empty query shows empty match count text (no 'No results' until user types)", () => {
    const { w } = mount();
    w.show();
    const count = w.element.querySelector(".find-replace-match-count")!;
    expect(count.textContent).toBe("");
    w.dispose();
  });

  it("dispose() removes the widget element from the DOM", () => {
    const { w } = mount();
    w.show();
    expect(w.element.parentNode).not.toBeNull();
    w.dispose();
    expect(w.element.parentNode).toBeNull();
  });
});
