import { describe, it, expect } from "vitest";
import {
  createDefaultLayoutState,
  LAYOUT_SCHEMA_VERSION,
  SerializedNodeType,
} from "../../src/layout/layoutModel";

const TITLEBAR = "workbench.parts.titlebar";
const SIDEBAR = "workbench.parts.sidebar";
const EDITOR = "workbench.parts.editor";
const AUX = "workbench.parts.auxiliarybar";
const PANEL = "workbench.parts.panel";
const STATUSBAR = "workbench.parts.statusbar";

describe("createDefaultLayoutState", () => {
  it("stamps the current schema version on the returned state", () => {
    const s = createDefaultLayoutState(1280, 720);
    expect(s.version).toBe(LAYOUT_SCHEMA_VERSION);
  });

  it("uses the requested grid dimensions", () => {
    const s = createDefaultLayoutState(1024, 768);
    expect(s.grid.width).toBe(1024);
    expect(s.grid.height).toBe(768);
  });

  it("places titlebar, main row, panel, and statusbar as children of the top branch", () => {
    const s = createDefaultLayoutState(800, 600);
    const root = s.grid.root;
    expect(root.type).toBe(SerializedNodeType.Branch);
    if (root.type !== SerializedNodeType.Branch) throw new Error("root must be branch");
    const childIds = root.children.map((c) =>
      c.type === SerializedNodeType.Leaf ? c.viewId : "<branch>",
    );
    expect(childIds).toEqual([TITLEBAR, "<branch>", PANEL, STATUSBAR]);
  });

  it("the main row contains sidebar, editor, auxiliarybar in left-to-right order", () => {
    const s = createDefaultLayoutState(800, 600);
    const root = s.grid.root;
    if (root.type !== SerializedNodeType.Branch) throw new Error();
    const mainRow = root.children[1];
    if (mainRow.type !== SerializedNodeType.Branch) throw new Error("main row must be branch");
    const ids = mainRow.children.map((c) => (c.type === SerializedNodeType.Leaf ? c.viewId : "<branch>"));
    expect(ids).toEqual([SIDEBAR, EDITOR, AUX]);
  });

  it("emits part visibility defaults — auxiliarybar hidden, everything else visible", () => {
    const s = createDefaultLayoutState(800, 600);
    const byId = new Map(s.parts.map((p) => [p.partId, p.visible]));
    expect(byId.get(TITLEBAR)).toBe(true);
    expect(byId.get(SIDEBAR)).toBe(true);
    expect(byId.get(EDITOR)).toBe(true);
    expect(byId.get(AUX)).toBe(false);
    expect(byId.get(PANEL)).toBe(true);
    expect(byId.get(STATUSBAR)).toBe(true);
  });

  it("default activePart is the editor and no focusedView is set", () => {
    const s = createDefaultLayoutState(800, 600);
    expect(s.activePart).toBe(EDITOR);
    expect(s.focusedView).toBeUndefined();
  });

  it("starts with no view assignments and no editorGrid", () => {
    const s = createDefaultLayoutState(800, 600);
    expect(s.views).toEqual([]);
    expect(s.editorGrid).toBeUndefined();
  });

  it("each call returns a fresh object (no shared structure between invocations)", () => {
    const a = createDefaultLayoutState(800, 600);
    const b = createDefaultLayoutState(800, 600);
    expect(a).not.toBe(b);
    expect(a.grid).not.toBe(b.grid);
    expect(a.parts).not.toBe(b.parts);
  });
});
