import { describe, it, expect } from "vitest";
import {
  EditorActivation,
  EditorCloseResult,
  EditorGroupChangeKind,
  GroupDirection,
  EDITOR_TAB_DRAG_TYPE,
} from "../../src/editor/editorTypes";

describe("editorTypes pin", () => {
  it("EditorActivation enum is stable", () => {
    expect(EditorActivation.Activate).toBe("activate");
    expect(EditorActivation.Restore).toBe("restore");
    expect(EditorActivation.Preserve).toBe("preserve");
  });

  it("EditorCloseResult enum is stable", () => {
    expect(EditorCloseResult.Closed).toBe("closed");
    expect(EditorCloseResult.Vetoed).toBe("vetoed");
  });

  it("GroupDirection enum covers all four directions", () => {
    expect(GroupDirection.Left).toBe("left");
    expect(GroupDirection.Right).toBe("right");
    expect(GroupDirection.Up).toBe("up");
    expect(GroupDirection.Down).toBe("down");
  });

  it("EditorGroupChangeKind enumerates all change kinds (pinned values)", () => {
    expect(EditorGroupChangeKind.EditorOpen).toBe("editorOpen");
    expect(EditorGroupChangeKind.EditorClose).toBe("editorClose");
    expect(EditorGroupChangeKind.EditorMove).toBe("editorMove");
    expect(EditorGroupChangeKind.EditorPin).toBe("editorPin");
    expect(EditorGroupChangeKind.EditorUnpin).toBe("editorUnpin");
    expect(EditorGroupChangeKind.EditorSticky).toBe("editorSticky");
    expect(EditorGroupChangeKind.EditorUnsticky).toBe("editorUnsticky");
    expect(EditorGroupChangeKind.EditorActive).toBe("editorActive");
    expect(EditorGroupChangeKind.EditorDirty).toBe("editorDirty");
    expect(EditorGroupChangeKind.GroupActive).toBe("groupActive");
  });

  it("EDITOR_TAB_DRAG_TYPE constant is stable", () => {
    expect(EDITOR_TAB_DRAG_TYPE).toBe("application/parallx-editor-tab");
  });
});
