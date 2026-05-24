/** @vitest-environment jsdom */
/**
 * Pin tests for src/parts/auxiliaryBarPart.ts + src/parts/panelPart.ts.
 *
 * Pins (AuxiliaryBarPart):
 *   - Constructor uses PartId.AuxiliaryBar, position=Right, defaultVisible=false, snap=true.
 *   - hasTitleArea = true; create() mounts `.auxiliary-bar-header` (titleSlot) and
 *     `.auxiliary-bar-content > .auxiliary-bar-views` (viewContainerSlot).
 *   - setActiveView fires onDidChangeActiveView when value changes; no-op when unchanged.
 *   - save/restorePartData round-trips activeViewId.
 *   - auxiliaryBarPartDescriptor exposes documented metadata and a factory.
 *
 * Pins (PanelPart):
 *   - Constructor uses PartId.Panel, position=Bottom, defaultVisible=true, snap=true.
 *   - hasTitleArea = false; create() mounts `.panel-content > .panel-views` (viewContainerSlot).
 *   - setActiveTab fires onDidChangeActiveTab on change; no-op when unchanged.
 *   - save/restorePartData round-trips activeTabId.
 *   - panelPartDescriptor exposes documented metadata and a factory.
 */
import { describe, it, expect } from "vitest";
import { AuxiliaryBarPart, auxiliaryBarPartDescriptor } from "../../src/parts/auxiliaryBarPart";
import { PanelPart, panelPartDescriptor } from "../../src/parts/panelPart";
import { PartId, PartPosition } from "../../src/parts/partTypes";

describe("parts/AuxiliaryBarPart", () => {
  it("constructor wires id, position, defaultVisible=false, snap=true", () => {
    const p = new AuxiliaryBarPart();
    expect(p.id).toBe(PartId.AuxiliaryBar);
    expect(p.position).toBe(PartPosition.Right);
    expect(p.visible).toBe(false);
    expect(p.snap).toBe(true);
  });

  it("create() mounts header (titleArea) and content slots with documented classes", () => {
    const p = new AuxiliaryBarPart();
    const host = document.createElement("div");
    p.create(host);

    const root = p.element;
    expect(root.querySelector(".auxiliary-bar-header")).toBeTruthy();
    expect(root.querySelector(".auxiliary-bar-content")).toBeTruthy();
    expect(root.querySelector(".auxiliary-bar-views")).toBeTruthy();
    expect(p.headerSlot).toBe(root.querySelector(".auxiliary-bar-header"));
    expect(p.viewContainerSlot).toBe(root.querySelector(".auxiliary-bar-views"));
  });

  it("setActiveView fires onDidChangeActiveView on change, no-op when unchanged", () => {
    const p = new AuxiliaryBarPart();
    const events: Array<string | undefined> = [];
    p.onDidChangeActiveView(v => events.push(v));
    p.setActiveView("foo");
    p.setActiveView("foo");
    p.setActiveView(undefined);
    expect(events).toEqual(["foo", undefined]);
    expect(p.activeViewId).toBeUndefined();
  });

  it("save/restorePartData round-trips activeViewId; undefined when no active view", () => {
    const p = new AuxiliaryBarPart();
    expect((p as any).savePartData()).toBeUndefined();
    p.setActiveView("foo");
    const saved = (p as any).savePartData();
    expect(saved).toEqual({ activeViewId: "foo" });
    const p2 = new AuxiliaryBarPart();
    (p2 as any).restorePartData(saved);
    expect(p2.activeViewId).toBe("foo");
  });

  it("auxiliaryBarPartDescriptor exposes documented metadata + factory", () => {
    expect(auxiliaryBarPartDescriptor.id).toBe(PartId.AuxiliaryBar);
    expect(auxiliaryBarPartDescriptor.position).toBe(PartPosition.Right);
    expect(auxiliaryBarPartDescriptor.defaultVisible).toBe(false);
    expect(typeof auxiliaryBarPartDescriptor.factory).toBe("function");
    const inst = auxiliaryBarPartDescriptor.factory();
    expect(inst).toBeInstanceOf(AuxiliaryBarPart);
  });
});

describe("parts/PanelPart", () => {
  it("constructor wires id, position, defaultVisible=true, snap=true", () => {
    const p = new PanelPart();
    expect(p.id).toBe(PartId.Panel);
    expect(p.position).toBe(PartPosition.Bottom);
    expect(p.visible).toBe(true);
    expect(p.snap).toBe(true);
  });

  it("create() does NOT mount a title area; mounts `.panel-content > .panel-views`", () => {
    const p = new PanelPart();
    const host = document.createElement("div");
    p.create(host);

    const root = p.element;
    expect(root.querySelector(".part-title")).toBeNull(); // hasTitleArea = false
    expect(root.querySelector(".panel-content")).toBeTruthy();
    expect(root.querySelector(".panel-views")).toBeTruthy();
    expect(p.viewContainerSlot).toBe(root.querySelector(".panel-views"));
    expect(p.tabBarSlot).toBeUndefined();
  });

  it("setActiveTab fires onDidChangeActiveTab on change, no-op when unchanged", () => {
    const p = new PanelPart();
    const events: Array<string | undefined> = [];
    p.onDidChangeActiveTab(v => events.push(v));
    p.setActiveTab("terminal");
    p.setActiveTab("terminal");
    p.setActiveTab("output");
    expect(events).toEqual(["terminal", "output"]);
    expect(p.activeTabId).toBe("output");
  });

  it("save/restorePartData round-trips activeTabId; undefined when no active tab", () => {
    const p = new PanelPart();
    expect((p as any).savePartData()).toBeUndefined();
    p.setActiveTab("terminal");
    const saved = (p as any).savePartData();
    expect(saved).toEqual({ activeTabId: "terminal" });
    const p2 = new PanelPart();
    (p2 as any).restorePartData(saved);
    expect(p2.activeTabId).toBe("terminal");
  });

  it("panelPartDescriptor exposes documented metadata + factory", () => {
    expect(panelPartDescriptor.id).toBe(PartId.Panel);
    expect(panelPartDescriptor.position).toBe(PartPosition.Bottom);
    expect(panelPartDescriptor.defaultVisible).toBe(true);
    expect(typeof panelPartDescriptor.factory).toBe("function");
    const inst = panelPartDescriptor.factory();
    expect(inst).toBeInstanceOf(PanelPart);
  });
});
