/**
 * Pin: workspaceTypes — runtime exports: WORKSPACE_STATE_VERSION,
 * WorkbenchState const enum, default snapshot factories, and
 * DEFAULT_MAX_RECENT_WORKSPACES.
 */
import { describe, it, expect } from "vitest";
import {
  WORKSPACE_STATE_VERSION,
  WorkbenchState,
  createDefaultEditorSnapshot,
  createDefaultContextSnapshot,
  DEFAULT_MAX_RECENT_WORKSPACES,
} from "../../src/workspace/workspaceTypes";

describe("workspaceTypes — module-level runtime constants", () => {
  it("WORKSPACE_STATE_VERSION === 2 (bump-protected — bump only on migration)", () => {
    expect(WORKSPACE_STATE_VERSION).toBe(2);
  });

  it("DEFAULT_MAX_RECENT_WORKSPACES === 20", () => {
    expect(DEFAULT_MAX_RECENT_WORKSPACES).toBe(20);
  });
});

describe("WorkbenchState const enum — VS Code-matched ordinals", () => {
  it("EMPTY === 1, FOLDER === 2, WORKSPACE === 3", () => {
    expect(WorkbenchState.EMPTY).toBe(1);
    expect(WorkbenchState.FOLDER).toBe(2);
    expect(WorkbenchState.WORKSPACE).toBe(3);
  });
});

describe("createDefaultEditorSnapshot — empty editor state", () => {
  it("returns 1 group, no editors, activeEditorIndex=-1, activeGroupIndex=0", () => {
    const snap = createDefaultEditorSnapshot();
    expect(snap.groups).toHaveLength(1);
    expect(snap.groups[0].editors).toEqual([]);
    expect(snap.groups[0].activeEditorIndex).toBe(-1);
    expect(snap.activeGroupIndex).toBe(0);
  });

  it("returns a fresh object on each call (callers may mutate)", () => {
    const a = createDefaultEditorSnapshot();
    const b = createDefaultEditorSnapshot();
    expect(a).not.toBe(b);
    expect(a.groups).not.toBe(b.groups);
  });
});

describe("createDefaultContextSnapshot — empty context state", () => {
  it("activePart, focusedView, activeEditor, activeEditorGroup all undefined", () => {
    const snap = createDefaultContextSnapshot();
    expect(snap.activePart).toBeUndefined();
    expect(snap.focusedView).toBeUndefined();
    expect(snap.activeEditor).toBeUndefined();
    expect(snap.activeEditorGroup).toBeUndefined();
  });

  it("returns fresh object per call", () => {
    expect(createDefaultContextSnapshot()).not.toBe(createDefaultContextSnapshot());
  });
});
