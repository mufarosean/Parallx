/**
 * @vitest-environment jsdom
 *
 * Pin: IconMenuController — registers with registry, mounts an IconPicker,
 * forwards select/remove events, dismisses prior picker on re-show, hides
 * cleanly. We mock IconPicker so the test pins ONLY the controller contract.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

(globalThis as any).ResizeObserver ??= class { observe(){} disconnect(){} unobserve(){} };

// Mock IconPicker with an inline class; export instances for assertions.
vi.mock("../../src/ui/iconPicker.js", () => {
  const instances: any[] = [];
  class MockIconPicker {
    public element: HTMLElement;
    public dismiss = vi.fn();
    public onDidSelectIcon = vi.fn();
    public onDidRemoveIcon = vi.fn();
    public onDidDismiss = vi.fn();
    public selectCb: ((id: string) => void) | null = null;
    public removeCb: (() => void) | null = null;
    public dismissCb: (() => void) | null = null;
    public ctorOpts: any;
    constructor(public container: HTMLElement, opts: any) {
      this.ctorOpts = opts;
      this.element = document.createElement("div");
      this.element.className = "mock-icon-picker";
      container.appendChild(this.element);
      this.onDidSelectIcon.mockImplementation((cb: any) => { this.selectCb = cb; });
      this.onDidRemoveIcon.mockImplementation((cb: any) => { this.removeCb = cb; });
      this.onDidDismiss.mockImplementation((cb: any) => { this.dismissCb = cb; });
      instances.push(this);
    }
  }
  (MockIconPicker as any).__instances = instances;
  return { IconPicker: MockIconPicker };
});

// Mock canvasMenuRegistry's icon catalog + svgIcon (used by ctor opts).
vi.mock("../../src/built-in/canvas/menus/canvasMenuRegistry.js", async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    ALL_PAGE_SELECTABLE_ICONS: ["page", "folder", "image"],
    svgIcon: (id: string) => `<svg data-id="${id}"></svg>`,
  };
});

import { IconMenuController } from "../../src/built-in/canvas/menus/iconMenu";
import { IconPicker as MockedPicker } from "../../src/ui/iconPicker.js";

const pickerInstances = (MockedPicker as any).__instances as any[];

function makeRegistry() {
  return {
    register: vi.fn(() => ({ dispose: vi.fn() })),
    notifyShow: vi.fn(),
  };
}

describe("built-in/canvas/menus/iconMenu — IconMenuController", () => {
  let container: HTMLElement;
  let anchor: HTMLElement;
  let registry: ReturnType<typeof makeRegistry>;
  let controller: IconMenuController;

  beforeEach(() => {
    pickerInstances.length = 0;
    document.body.innerHTML = "";
    container = document.createElement("div");
    anchor = document.createElement("button");
    document.body.append(container, anchor);
    registry = makeRegistry();
    controller = new IconMenuController({ container }, registry as any);
  });

  it("id is 'icon-menu' and visible defaults to false", () => {
    expect(controller.id).toBe("icon-menu");
    expect(controller.visible).toBe(false);
  });

  it("create() registers exactly once with the registry", () => {
    controller.create();
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registry.register).toHaveBeenCalledWith(controller);
  });

  it("show() notifies registry, mounts IconPicker with defaults, marks visible", () => {
    const onSelect = vi.fn();
    controller.show({ anchor, onSelect });
    expect(registry.notifyShow).toHaveBeenCalledWith("icon-menu");
    expect(pickerInstances).toHaveLength(1);
    const p = pickerInstances[0];
    expect(p.container).toBe(container);
    expect(p.ctorOpts.anchor).toBe(anchor);
    expect(p.ctorOpts.icons).toEqual(["page", "folder", "image"]);
    expect(p.ctorOpts.showSearch).toBe(true);
    expect(p.ctorOpts.showRemove).toBe(false);
    expect(p.ctorOpts.iconSize).toBe(22);
    expect(p.ctorOpts.renderIcon("page")).toBe(`<svg data-id="page"></svg>`);
    expect(controller.visible).toBe(true);
  });

  it("show() honors showSearch=false, showRemove=true, iconSize override", () => {
    controller.show({ anchor, onSelect: vi.fn(), showSearch: false, showRemove: true, iconSize: 32 });
    const p = pickerInstances[0];
    expect(p.ctorOpts.showSearch).toBe(false);
    expect(p.ctorOpts.showRemove).toBe(true);
    expect(p.ctorOpts.iconSize).toBe(32);
  });

  it("calling show() twice dismisses the prior picker", () => {
    controller.show({ anchor, onSelect: vi.fn() });
    const first = pickerInstances[0];
    controller.show({ anchor, onSelect: vi.fn() });
    expect(first.dismiss).toHaveBeenCalledTimes(1);
    expect(pickerInstances).toHaveLength(2);
  });

  it("forwards onSelect when picker fires selection", () => {
    const onSelect = vi.fn();
    controller.show({ anchor, onSelect });
    pickerInstances[0].selectCb("folder");
    expect(onSelect).toHaveBeenCalledWith("folder");
  });

  it("only wires onDidRemoveIcon when onRemove is provided", () => {
    controller.show({ anchor, onSelect: vi.fn() });
    expect(pickerInstances[0].onDidRemoveIcon).not.toHaveBeenCalled();
    pickerInstances.length = 0;
    const onRemove = vi.fn();
    controller.show({ anchor, onSelect: vi.fn(), onRemove });
    expect(pickerInstances[0].onDidRemoveIcon).toHaveBeenCalledTimes(1);
    pickerInstances[0].removeCb();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("picker dismiss callback clears visible + picker reference", () => {
    controller.show({ anchor, onSelect: vi.fn() });
    expect(controller.visible).toBe(true);
    pickerInstances[0].dismissCb();
    expect(controller.visible).toBe(false);
    expect(controller.containsTarget(document.body)).toBe(false);
  });

  it("hide() dismisses picker and clears visible", () => {
    controller.show({ anchor, onSelect: vi.fn() });
    controller.hide();
    expect(pickerInstances[0].dismiss).toHaveBeenCalledTimes(1);
    expect(controller.visible).toBe(false);
  });

  it("containsTarget delegates to picker.element.contains; false when no picker", () => {
    expect(controller.containsTarget(document.body)).toBe(false);
    controller.show({ anchor, onSelect: vi.fn() });
    const inner = document.createElement("span");
    pickerInstances[0].element.appendChild(inner);
    expect(controller.containsTarget(inner)).toBe(true);
    expect(controller.containsTarget(document.body)).toBe(false);
  });

  it("dispose() hides + disposes the registry registration", () => {
    controller.create();
    const reg = (registry.register.mock.results[0].value);
    controller.show({ anchor, onSelect: vi.fn() });
    controller.dispose();
    expect(pickerInstances[0].dismiss).toHaveBeenCalled();
    expect(reg.dispose).toHaveBeenCalledTimes(1);
    // Second dispose is a no-op (registration already cleared).
    controller.dispose();
    expect(reg.dispose).toHaveBeenCalledTimes(1);
  });
});
