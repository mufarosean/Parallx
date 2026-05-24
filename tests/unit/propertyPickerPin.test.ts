/**
 * @vitest-environment jsdom
 *
 * Pin: showPropertyPicker — search/filter, system-name delete suppression,
 * create-new form opens with text default + submit, type dropdown selection
 * round-trips, item mousedown forwards to onAdd, delete forwards, dismiss
 * removal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let dismissFn: (() => void) | null = null;
vi.mock("../../src/built-in/canvas/properties/propertyEditors.js", () => ({
  createTypeIconElement: (type: string) => {
    const el = document.createElement("span");
    el.className = "mock-type-icon";
    el.dataset.type = type;
    return el;
  },
}));
vi.mock("../../src/ui/iconRegistry.js", () => ({
  createIconElement: (id: string) => {
    const el = document.createElement("span");
    el.className = "mock-icon";
    el.dataset.id = id;
    return el;
  },
}));
vi.mock("../../src/ui/dom.js", async () => ({
  layoutPopup: vi.fn(),
  attachPopupDismiss: vi.fn((_targets: any, cb: () => void) => {
    dismissFn = cb;
    return () => { dismissFn = null; };
  }),
}));

import { showPropertyPicker } from "../../src/built-in/canvas/properties/propertyPicker";
import type { IPropertyDefinition } from "../../src/built-in/canvas/properties/propertyTypes";

(globalThis as any).requestAnimationFrame ??= (cb: () => void) => { cb(); return 1 as any; };

function def(name: string, type: any = "text"): IPropertyDefinition {
  return { name, type, config: {}, sortOrder: 0, createdAt: "", updatedAt: "" } as IPropertyDefinition;
}

function makeAnchor() {
  const a = document.createElement("button");
  a.getBoundingClientRect = () => ({ left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20, x: 0, y: 0, toJSON() {} }) as any;
  document.body.appendChild(a);
  return a;
}

afterEach(() => { document.body.innerHTML = ""; dismissFn = null; });

describe("built-in/canvas/properties/propertyPicker", () => {
  it("mounts a single .canvas-property-picker with search + list", () => {
    const a = makeAnchor();
    showPropertyPicker(a, [], [def("status"), def("priority")], vi.fn(), vi.fn());
    const pickers = document.querySelectorAll(".canvas-property-picker");
    expect(pickers).toHaveLength(1);
    expect(pickers[0].querySelector(".canvas-property-picker__search input")).toBeTruthy();
    expect(pickers[0].querySelector(".canvas-property-picker__list")).toBeTruthy();
  });

  it("filters out properties already on the page (existingKeys)", () => {
    const a = makeAnchor();
    showPropertyPicker(a, ["status"], [def("status"), def("priority")], vi.fn(), vi.fn());
    const labels = Array.from(document.querySelectorAll(".canvas-property-picker__item-label")).map(e => e.textContent);
    expect(labels).toEqual(["priority"]);
  });

  it("opening twice dismisses the first picker", () => {
    const a = makeAnchor();
    showPropertyPicker(a, [], [def("a")], vi.fn(), vi.fn());
    showPropertyPicker(a, [], [def("b")], vi.fn(), vi.fn());
    expect(document.querySelectorAll(".canvas-property-picker")).toHaveLength(1);
  });

  it("search input filters list case-insensitively", () => {
    const a = makeAnchor();
    showPropertyPicker(a, [], [def("Status"), def("Priority"), def("Owner")], vi.fn(), vi.fn());
    const input = document.querySelector(".canvas-property-picker__search input") as HTMLInputElement;
    input.value = "PRI";
    input.dispatchEvent(new Event("input"));
    const labels = Array.from(document.querySelectorAll(".canvas-property-picker__item-label")).map(e => e.textContent);
    expect(labels).toEqual(["Priority"]);
  });

  it("renders divider only when at least one item is in the filtered list", () => {
    const a = makeAnchor();
    showPropertyPicker(a, [], [def("a")], vi.fn(), vi.fn());
    expect(document.querySelector(".canvas-property-picker__divider")).toBeTruthy();
    const input = document.querySelector(".canvas-property-picker__search input") as HTMLInputElement;
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    expect(document.querySelector(".canvas-property-picker__divider")).toBeNull();
    // Create-new is still present.
    expect(document.querySelector(".canvas-property-picker__create")).toBeTruthy();
  });

  it("clicking an item invokes onAdd(name) and dismisses", () => {
    const a = makeAnchor();
    const onAdd = vi.fn();
    showPropertyPicker(a, [], [def("status")], onAdd, vi.fn());
    const item = document.querySelector(".canvas-property-picker__item") as HTMLElement;
    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onAdd).toHaveBeenCalledWith("status");
    expect(document.querySelector(".canvas-property-picker")).toBeNull();
  });

  it("delete button only rendered when onDeleteDefinition provided AND name is not a system name", () => {
    const a = makeAnchor();
    const onDel = vi.fn();
    showPropertyPicker(a, [], [def("status"), def("tags")], vi.fn(), vi.fn(), onDel);
    const items = document.querySelectorAll(".canvas-property-picker__item");
    const deletes = document.querySelectorAll(".canvas-property-picker__delete");
    expect(items).toHaveLength(2);
    expect(deletes).toHaveLength(1); // tags is system → no delete
    const labelOfDelete = (deletes[0].parentElement!.querySelector(".canvas-property-picker__item-label") as HTMLElement).textContent;
    expect(labelOfDelete).toBe("status");
  });

  it("delete button mousedown forwards to onDeleteDefinition + dismisses picker", () => {
    const a = makeAnchor();
    const onDel = vi.fn();
    showPropertyPicker(a, [], [def("status")], vi.fn(), vi.fn(), onDel);
    const delBtn = document.querySelector(".canvas-property-picker__delete") as HTMLButtonElement;
    delBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onDel).toHaveBeenCalledWith("status");
    expect(document.querySelector(".canvas-property-picker")).toBeNull();
  });

  it("'+ Create new property' opens a name input + type button + Create button", () => {
    const a = makeAnchor();
    showPropertyPicker(a, [], [], vi.fn(), vi.fn());
    expect(document.querySelector(".canvas-property-picker__new-form")).toBeNull();
    (document.querySelector(".canvas-property-picker__create") as HTMLElement)
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const form = document.querySelector(".canvas-property-picker__new-form") as HTMLElement;
    expect(form).toBeTruthy();
    expect(form.querySelector('input[type="text"]')).toBeTruthy();
    expect(form.querySelector(".canvas-property-picker__type-btn")).toBeTruthy();
    // Default type label is "Text".
    expect(form.querySelector(".canvas-property-picker__type-btn span:not([class])")?.textContent).toBe("Text");
  });

  it("type dropdown lists all 8 types and selecting one updates the type-btn label", () => {
    const a = makeAnchor();
    showPropertyPicker(a, [], [], vi.fn(), vi.fn());
    (document.querySelector(".canvas-property-picker__create") as HTMLElement)
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const typeBtn = document.querySelector(".canvas-property-picker__type-btn") as HTMLElement;
    typeBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const items = document.querySelectorAll(".canvas-property-picker__type-item");
    expect(items).toHaveLength(8);
    const labels = Array.from(items).map(i => (i.querySelector("span:not([class])") as HTMLElement).textContent);
    expect(labels).toEqual(["Text", "Number", "Checkbox", "Date", "Date & time", "Tags", "Select", "URL"]);
    // Pick "Number".
    (items[1] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect((typeBtn.querySelector("span:not([class])") as HTMLElement).textContent).toBe("Number");
    // Dropdown closes after selection.
    expect(document.querySelector(".canvas-property-picker__type-dropdown")).toBeNull();
  });

  it("Create button submits trimmed name + selected type, dismisses, ignores empty input", () => {
    const a = makeAnchor();
    const onCreateNew = vi.fn();
    showPropertyPicker(a, [], [], vi.fn(), onCreateNew);
    (document.querySelector(".canvas-property-picker__create") as HTMLElement)
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const form = document.querySelector(".canvas-property-picker__new-form") as HTMLElement;
    const name = form.querySelector('input[type="text"]') as HTMLInputElement;
    const submit = form.querySelector("button:not(.canvas-property-picker__type-btn)") as HTMLButtonElement;
    // Empty name → no call.
    name.value = "   ";
    submit.click();
    expect(onCreateNew).not.toHaveBeenCalled();
    expect(document.querySelector(".canvas-property-picker")).toBeTruthy();
    // Trimmed name + default type 'text'.
    name.value = "  status  ";
    submit.click();
    expect(onCreateNew).toHaveBeenCalledWith("status", "text");
    expect(document.querySelector(".canvas-property-picker")).toBeNull();
  });
});
