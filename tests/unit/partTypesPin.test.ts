/**
 * Pin: partTypes — PartId + PartPosition enum values are the storage keys
 * for workbench layout persistence (saveState/restoreState) and the IDs
 * used by layout/grid wiring. A typo here would silently break layout
 * restoration across upgrades.
 *
 * Also pins panelPartDescriptor (the bottom-panel registration). The DOM
 * factory is exercised in workbench tests; here we pin the static
 * metadata only.
 */
import { describe, it, expect } from "vitest";
import { PartId, PartPosition } from "../../src/parts/partTypes";
import { panelPartDescriptor } from "../../src/parts/panelPart";

describe("PartId enum — workbench layout persistence keys", () => {
  it("pins exact 'workbench.parts.*' string values for all 7 part ids", () => {
    expect(PartId.Titlebar).toBe("workbench.parts.titlebar");
    expect(PartId.ActivityBar).toBe("workbench.parts.activitybar");
    expect(PartId.Sidebar).toBe("workbench.parts.sidebar");
    expect(PartId.Panel).toBe("workbench.parts.panel");
    expect(PartId.Editor).toBe("workbench.parts.editor");
    expect(PartId.AuxiliaryBar).toBe("workbench.parts.auxiliarybar");
    expect(PartId.StatusBar).toBe("workbench.parts.statusbar");
  });

  it("pins exactly 7 PartId members (no additions/removals without audit)", () => {
    const values = Object.values(PartId).filter((v) => typeof v === "string");
    expect(values.sort()).toEqual([
      "workbench.parts.activitybar",
      "workbench.parts.auxiliarybar",
      "workbench.parts.editor",
      "workbench.parts.panel",
      "workbench.parts.sidebar",
      "workbench.parts.statusbar",
      "workbench.parts.titlebar",
    ]);
  });

  it("every PartId value is unique", () => {
    const values = Object.values(PartId).filter((v) => typeof v === "string");
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("PartPosition enum — layout positioning", () => {
  it("pins exact lowercase string values: top/bottom/left/right/center", () => {
    expect(PartPosition.Top).toBe("top");
    expect(PartPosition.Bottom).toBe("bottom");
    expect(PartPosition.Left).toBe("left");
    expect(PartPosition.Right).toBe("right");
    expect(PartPosition.Center).toBe("center");
  });

  it("pins exactly 5 PartPosition members", () => {
    const values = Object.values(PartPosition).filter((v) => typeof v === "string");
    expect(values.sort()).toEqual(["bottom", "center", "left", "right", "top"]);
  });
});

describe("panelPartDescriptor — bottom-panel registration", () => {
  it("id = PartId.Panel ('workbench.parts.panel')", () => {
    expect(panelPartDescriptor.id).toBe(PartId.Panel);
    expect(panelPartDescriptor.id).toBe("workbench.parts.panel");
  });

  it("name = 'Panel'", () => {
    expect(panelPartDescriptor.name).toBe("Panel");
  });

  it("position = Bottom; defaultVisible = true", () => {
    expect(panelPartDescriptor.position).toBe(PartPosition.Bottom);
    expect(panelPartDescriptor.defaultVisible).toBe(true);
  });

  it("constraints: minimumHeight=100, height unbounded above; width unconstrained", () => {
    const c = panelPartDescriptor.constraints;
    expect(c.minimumHeight).toBe(100);
    expect(c.maximumHeight).toBe(Number.POSITIVE_INFINITY);
    expect(c.minimumWidth).toBe(0);
    expect(c.maximumWidth).toBe(Number.POSITIVE_INFINITY);
  });

  it("factory is callable to produce a fresh part", () => {
    expect(typeof panelPartDescriptor.factory).toBe("function");
  });
});
