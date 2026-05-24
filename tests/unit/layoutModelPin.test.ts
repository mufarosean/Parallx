import { describe, it, expect } from "vitest";
import {
  LAYOUT_SCHEMA_VERSION,
  SerializedNodeType,
  createDefaultLayoutState,
  type SerializedBranchNode,
  type SerializedLeafNode,
} from "../../src/layout/layoutModel";
import { Orientation, SizingMode } from "../../src/layout/layoutTypes";

describe("layoutModel pin", () => {
  it("LAYOUT_SCHEMA_VERSION is 1 (bump deliberately on schema break)", () => {
    expect(LAYOUT_SCHEMA_VERSION).toBe(1);
  });

  it("SerializedNodeType discriminants are stable string literals", () => {
    expect(SerializedNodeType.Branch).toBe("branch");
    expect(SerializedNodeType.Leaf).toBe("leaf");
  });

  it("createDefaultLayoutState includes version, grid root, parts and active part", () => {
    const s = createDefaultLayoutState(1280, 800);
    expect(s.version).toBe(LAYOUT_SCHEMA_VERSION);
    expect(s.grid.width).toBe(1280);
    expect(s.grid.height).toBe(800);
    expect(s.grid.orientation).toBe(Orientation.Vertical);
    expect(s.activePart).toBe("workbench.parts.editor");
    expect(s.views).toEqual([]);
  });

  it("default root is a vertical branch with 4 children (titlebar / main / panel / statusbar)", () => {
    const s = createDefaultLayoutState(1280, 800);
    const root = s.grid.root as SerializedBranchNode;
    expect(root.type).toBe(SerializedNodeType.Branch);
    expect(root.orientation).toBe(Orientation.Vertical);
    expect(root.children).toHaveLength(4);
    const ids = root.children.map(c =>
      c.type === SerializedNodeType.Leaf ? (c as SerializedLeafNode).viewId : "branch",
    );
    expect(ids).toEqual([
      "workbench.parts.titlebar",
      "branch",
      "workbench.parts.panel",
      "workbench.parts.statusbar",
    ]);
  });

  it("titlebar leaf has fixed 30px height (pinned)", () => {
    const s = createDefaultLayoutState(1280, 800);
    const root = s.grid.root as SerializedBranchNode;
    const titlebar = root.children[0] as SerializedLeafNode;
    expect(titlebar.size).toBe(30);
    expect(titlebar.sizingMode).toBe(SizingMode.Pixel);
    expect(titlebar.minimumHeight).toBe(30);
    expect(titlebar.maximumHeight).toBe(30);
  });

  it("statusbar leaf has fixed 22px height (pinned)", () => {
    const s = createDefaultLayoutState(1280, 800);
    const root = s.grid.root as SerializedBranchNode;
    const sb = root.children[3] as SerializedLeafNode;
    expect(sb.viewId).toBe("workbench.parts.statusbar");
    expect(sb.size).toBe(22);
    expect(sb.minimumHeight).toBe(22);
    expect(sb.maximumHeight).toBe(22);
  });

  it("main horizontal branch hosts sidebar (250 default, 170/800 min/max), editor (proportional), aux (250 default, 170/800)", () => {
    const s = createDefaultLayoutState(1280, 800);
    const root = s.grid.root as SerializedBranchNode;
    const main = root.children[1] as SerializedBranchNode;
    expect(main.orientation).toBe(Orientation.Horizontal);
    const [sidebar, editor, aux] = main.children as SerializedLeafNode[];

    expect(sidebar.viewId).toBe("workbench.parts.sidebar");
    expect(sidebar.size).toBe(250);
    expect(sidebar.minimumWidth).toBe(170);
    expect(sidebar.maximumWidth).toBe(800);

    expect(editor.viewId).toBe("workbench.parts.editor");
    expect(editor.sizingMode).toBe(SizingMode.Proportional);
    expect(editor.minimumWidth).toBe(200);

    expect(aux.viewId).toBe("workbench.parts.auxiliarybar");
    expect(aux.size).toBe(250);
    expect(aux.minimumWidth).toBe(170);
    expect(aux.maximumWidth).toBe(800);
  });

  it("default parts list pins visibility (titlebar/sidebar/editor/panel/statusbar visible, auxbar hidden)", () => {
    const s = createDefaultLayoutState(1280, 800);
    const map = new Map(s.parts.map(p => [p.partId, p.visible]));
    expect(map.get("workbench.parts.titlebar")).toBe(true);
    expect(map.get("workbench.parts.sidebar")).toBe(true);
    expect(map.get("workbench.parts.editor")).toBe(true);
    expect(map.get("workbench.parts.auxiliarybar")).toBe(false);
    expect(map.get("workbench.parts.panel")).toBe(true);
    expect(map.get("workbench.parts.statusbar")).toBe(true);
  });
});
