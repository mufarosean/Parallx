/** @vitest-environment jsdom */
/**
 * Pin tests for src/contributions/editableContextMenu.ts — invariant guards.
 *
 * Pins:
 *   - Constructor installs a capture-phase 'contextmenu' listener on document.
 *   - The listener stops propagation when the right-click is inside an editable surface.
 *   - The listener does NOT stop propagation outside editable surfaces.
 *   - The listener does NOT stop propagation inside `.context-menu` (already-open menu).
 *   - dispose() removes the document listener (subsequent contextmenu events propagate).
 *   - Without `parallxElectron.editableMenu.onOpen`, construction does not throw.
 *   - With a bridge, `onOpen` is wired (called once during construction).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditableContextMenu } from "../../src/contributions/editableContextMenu";

describe("contributions/editableContextMenu — global listener", () => {
  let instance: EditableContextMenu | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as any).parallxElectron;
  });

  afterEach(() => {
    instance?.dispose();
    instance = undefined;
    document.body.innerHTML = "";
  });

  it("construction does not throw when no bridge is registered", () => {
    expect(() => { instance = new EditableContextMenu(); }).not.toThrow();
  });

  it("stops propagation on contextmenu inside a plain <input>", () => {
    instance = new EditableContextMenu();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    const stopSpy = vi.spyOn(evt, "stopPropagation");
    input.dispatchEvent(evt);

    expect(stopSpy).toHaveBeenCalled();
  });

  it("stops propagation on contextmenu inside a <textarea>", () => {
    instance = new EditableContextMenu();
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);

    const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(evt, "stopPropagation");
    ta.dispatchEvent(evt);

    expect(stopSpy).toHaveBeenCalled();
  });

  it("stops propagation on contextmenu inside a contenteditable surface", () => {
    instance = new EditableContextMenu();
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    // jsdom does not set isContentEditable from the attribute automatically — patch it.
    Object.defineProperty(div, "isContentEditable", { value: true, configurable: true });

    const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(evt, "stopPropagation");
    div.dispatchEvent(evt);

    expect(stopSpy).toHaveBeenCalled();
  });

  it("does NOT stop propagation on contextmenu outside any editable surface", () => {
    instance = new EditableContextMenu();
    const div = document.createElement("div");
    document.body.appendChild(div);

    const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(evt, "stopPropagation");
    div.dispatchEvent(evt);

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("does NOT stop propagation when the event originates inside `.context-menu`", () => {
    instance = new EditableContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu";
    const inner = document.createElement("input");
    inner.type = "text";
    menu.appendChild(inner);
    document.body.appendChild(menu);

    const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(evt, "stopPropagation");
    inner.dispatchEvent(evt);

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("dispose() removes the document listener — subsequent contextmenu events are not intercepted", () => {
    instance = new EditableContextMenu();
    instance.dispose();
    instance = undefined;

    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(evt, "stopPropagation");
    input.dispatchEvent(evt);

    expect(stopSpy).not.toHaveBeenCalled();
  });
});

describe("contributions/editableContextMenu — main-process bridge", () => {
  let instance: EditableContextMenu | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as any).parallxElectron;
  });

  afterEach(() => {
    instance?.dispose();
    instance = undefined;
    delete (window as any).parallxElectron;
  });

  it("wires `parallxElectron.editableMenu.onOpen` exactly once when present", () => {
    const onOpen = vi.fn();
    (window as any).parallxElectron = { editableMenu: { onOpen } };

    instance = new EditableContextMenu();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not throw when `editableMenu` is missing entirely", () => {
    (window as any).parallxElectron = {};
    expect(() => { instance = new EditableContextMenu(); }).not.toThrow();
  });

  it("does not throw when `editableMenu.onOpen` is undefined", () => {
    (window as any).parallxElectron = { editableMenu: {} };
    expect(() => { instance = new EditableContextMenu(); }).not.toThrow();
  });
});
