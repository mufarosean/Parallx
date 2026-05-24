/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { PanelPart } from "../../src/parts/panelPart.js";
import { AuxiliaryBarPart } from "../../src/parts/auxiliaryBarPart.js";
import { PartId, PartPosition } from "../../src/parts/partTypes.js";

function mount<T extends { create(host: HTMLElement): void }>(factory: () => T) {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const part = factory();
  part.create(host);
  return { host, part };
}

describe("PanelPart pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("descriptor: id Panel, Bottom position, snap=true", () => {
    const p = new PanelPart();
    expect(p.id).toBe(PartId.Panel);
    expect(p.position).toBe(PartPosition.Bottom);
    expect(p.snap).toBe(true);
    expect(p.minimumHeight).toBe(100);
  });

  it("createContent builds view container slot; no title area", () => {
    const { part } = mount(() => new PanelPart());
    expect(part.viewContainerSlot).toBeTruthy();
    expect(part.viewContainerSlot!.classList.contains("panel-views")).toBe(true);
    // hasTitleArea is false → no .part-title element
    expect(part.element.querySelector(".part-title")).toBeNull();
  });

  it("setActiveTab fires only on change", () => {
    const p = new PanelPart();
    const seen: (string | undefined)[] = [];
    p.onDidChangeActiveTab((v) => seen.push(v));
    p.setActiveTab("terminal");
    p.setActiveTab("terminal");
    p.setActiveTab(undefined);
    expect(seen).toEqual(["terminal", undefined]);
  });

  it("saveState / restoreState round-trip activeTabId", () => {
    const p = new PanelPart();
    p.setActiveTab("output");
    const s = p.saveState();
    expect(s.data?.activeTabId).toBe("output");
    const p2 = new PanelPart();
    p2.restoreState(s);
    expect(p2.activeTabId).toBe("output");
  });
});

describe("AuxiliaryBarPart pin", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("descriptor: AuxiliaryBar, Right, hidden by default, snap=true", () => {
    const p = new AuxiliaryBarPart();
    expect(p.id).toBe(PartId.AuxiliaryBar);
    expect(p.position).toBe(PartPosition.Right);
    expect(p.snap).toBe(true);
    expect(p.visible).toBe(false);
    expect(p.minimumWidth).toBe(170);
  });

  it("title + content slots are wired", () => {
    const { part } = mount(() => new AuxiliaryBarPart());
    expect(part.headerSlot).toBeTruthy();
    expect(part.viewContainerSlot).toBeTruthy();
    expect(part.headerSlot!.classList.contains("auxiliary-bar-header")).toBe(true);
    expect(part.viewContainerSlot!.classList.contains("auxiliary-bar-views")).toBe(true);
  });

  it("setActiveView fires only on change", () => {
    const p = new AuxiliaryBarPart();
    const seen: (string | undefined)[] = [];
    p.onDidChangeActiveView((v) => seen.push(v));
    p.setActiveView("docs");
    p.setActiveView("docs");
    p.setActiveView("ai");
    expect(seen).toEqual(["docs", "ai"]);
  });

  it("element keeps 'hidden' class when defaultVisible=false", () => {
    const { part } = mount(() => new AuxiliaryBarPart());
    expect(part.element.classList.contains("hidden")).toBe(true);
    part.setVisible(true);
    expect(part.element.classList.contains("hidden")).toBe(false);
  });

  it("saveState includes visibility false and activeViewId round-trip", () => {
    const p = new AuxiliaryBarPart();
    p.setActiveView("notes");
    const s = p.saveState();
    expect(s.visible).toBe(false);
    expect(s.data?.activeViewId).toBe("notes");
    const p2 = new AuxiliaryBarPart();
    p2.restoreState(s);
    expect(p2.activeViewId).toBe("notes");
    expect(p2.visible).toBe(false);
  });
});
