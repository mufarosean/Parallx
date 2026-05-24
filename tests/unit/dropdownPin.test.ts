/** @vitest-environment jsdom */
/**
 * Pin tests for src/ui/dropdown.ts — Dropdown invariants.
 *
 * Pins:
 *   - Mounts `.ui-dropdown` with `.ui-dropdown__button[aria-haspopup='listbox']`.
 *   - Renders `.ui-dropdown__list[role='listbox']` with one `.ui-dropdown__item[role='option']` per item.
 *   - Initial button text reflects `selected` label (or placeholder if no selection).
 *   - Clicking the button toggles `.ui-dropdown--open` and aria-expanded.
 *   - Clicking an option fires onDidChange with the option's value, updates button text, closes.
 *   - Re-selecting the same value does NOT fire onDidChange.
 *   - disabled=true disables the button and adds `.ui-dropdown--disabled`.
 *   - Escape key closes an open dropdown.
 *   - Outside mousedown closes an open dropdown.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Dropdown } from "../../src/ui/dropdown";

let container: HTMLElement;
let dd: Dropdown | undefined;
const ITEMS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  dd?.dispose();
  dd = undefined;
});

describe("ui/Dropdown — mount + render", () => {
  it("mounts `.ui-dropdown` with button + listbox", () => {
    dd = new Dropdown(container, { items: ITEMS });
    expect(container.querySelector(".ui-dropdown")).toBeTruthy();
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;
    expect(btn.getAttribute("aria-haspopup")).toBe("listbox");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const list = container.querySelector(".ui-dropdown__list")!;
    expect(list.getAttribute("role")).toBe("listbox");
    const items = container.querySelectorAll(".ui-dropdown__item");
    expect(items.length).toBe(3);
    items.forEach(i => expect(i.getAttribute("role")).toBe("option"));
  });

  it("initial button text is the selected item's label", () => {
    dd = new Dropdown(container, { items: ITEMS, selected: "b" });
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;
    expect(btn.firstChild?.textContent).toBe("Bravo");
  });

  it("initial button text is the placeholder when nothing is selected", () => {
    dd = new Dropdown(container, { items: ITEMS, placeholder: "Choose…" });
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;
    expect(btn.firstChild?.textContent).toBe("Choose…");
  });
});

describe("ui/Dropdown — open/close", () => {
  it("clicking the button toggles `.ui-dropdown--open` and aria-expanded", () => {
    dd = new Dropdown(container, { items: ITEMS });
    const root = container.querySelector(".ui-dropdown") as HTMLElement;
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;

    btn.click();
    expect(root.classList.contains("ui-dropdown--open")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    btn.click();
    expect(root.classList.contains("ui-dropdown--open")).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape key closes an open dropdown", () => {
    dd = new Dropdown(container, { items: ITEMS });
    const root = container.querySelector(".ui-dropdown") as HTMLElement;
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;
    btn.click();
    expect(root.classList.contains("ui-dropdown--open")).toBe(true);

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.classList.contains("ui-dropdown--open")).toBe(false);
  });

  it("outside mousedown closes an open dropdown", () => {
    dd = new Dropdown(container, { items: ITEMS });
    const root = container.querySelector(".ui-dropdown") as HTMLElement;
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;
    btn.click();
    expect(root.classList.contains("ui-dropdown--open")).toBe(true);

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(root.classList.contains("ui-dropdown--open")).toBe(false);
  });
});

describe("ui/Dropdown — selection", () => {
  it("clicking an option fires onDidChange and closes the list", () => {
    dd = new Dropdown(container, { items: ITEMS });
    const onChange = vi.fn();
    dd.onDidChange(onChange);
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;
    btn.click(); // open

    const optBravo = container.querySelector<HTMLElement>('.ui-dropdown__item[data-value="b"]')!;
    optBravo.click();

    expect(onChange).toHaveBeenCalledWith("b");
    expect(dd.value).toBe("b");
    expect(btn.firstChild?.textContent).toBe("Bravo");
    const root = container.querySelector(".ui-dropdown") as HTMLElement;
    expect(root.classList.contains("ui-dropdown--open")).toBe(false);
  });

  it("selecting the same value again does NOT fire onDidChange", () => {
    dd = new Dropdown(container, { items: ITEMS, selected: "a" });
    const onChange = vi.fn();
    dd.onDidChange(onChange);
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;
    btn.click();
    const optAlpha = container.querySelector<HTMLElement>('.ui-dropdown__item[data-value="a"]')!;
    optAlpha.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled=true disables the button and adds `.ui-dropdown--disabled`", () => {
    dd = new Dropdown(container, { items: ITEMS, disabled: true });
    const root = container.querySelector(".ui-dropdown") as HTMLElement;
    const btn = container.querySelector<HTMLButtonElement>(".ui-dropdown__button")!;
    expect(root.classList.contains("ui-dropdown--disabled")).toBe(true);
    expect(btn.disabled).toBe(true);
  });
});
