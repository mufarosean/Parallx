/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { Emitter } from "../../src/platform/events";
import { ContextKeyService } from "../../src/context/contextKey";
import {
  WorkbenchContextManager,
  CTX_SIDEBAR_VISIBLE,
  CTX_PANEL_VISIBLE,
  CTX_AUXILIARY_BAR_VISIBLE,
  CTX_STATUS_BAR_VISIBLE,
  CTX_PANEL_MAXIMIZED,
  CTX_ZEN_MODE,
  CTX_ACTIVE_PART,
  CTX_ACTIVE_VIEW,
  CTX_FOCUSED_VIEW,
  CTX_FOCUSED_PART,
  CTX_ACTIVE_EDITOR,
  CTX_ACTIVE_EDITOR_GROUP,
  CTX_EDITOR_GROUP_COUNT,
  CTX_ACTIVE_EDITOR_DIRTY,
  CTX_ACTIVE_VIEW_CONTAINER,
  CTX_WORKSPACE_LOADED,
  CTX_WORKBENCH_STATE,
  CTX_WORKSPACE_FOLDER_COUNT,
  CTX_WORKSPACE_HAS_FOLDER,
  CTX_SELECTION_EXISTS,
} from "../../src/context/workbenchContext";

function makePart(initialVisible: boolean) {
  const e = new Emitter<boolean>();
  return {
    visible: initialVisible,
    onDidChangeVisibility: e.event,
    fire: (v: boolean) => e.fire(v),
  } as any;
}

describe("WorkbenchContextManager — construction is non-throwing", () => {
  it("constructs without a focus tracker and registers handles for standard keys", () => {
    const ctx = new ContextKeyService();
    expect(() => new WorkbenchContextManager(ctx, undefined)).not.toThrow();
  });
});

describe("WorkbenchContextManager — trackPartVisibility", () => {
  it("seeds initial value and updates on onDidChangeVisibility for known names", () => {
    const ctx = new ContextKeyService();
    const mgr = new WorkbenchContextManager(ctx, undefined);
    const part = makePart(true);
    mgr.trackPartVisibility(part, CTX_SIDEBAR_VISIBLE);
    expect(ctx.getContextValue(CTX_SIDEBAR_VISIBLE)).toBe(true);
    part.fire(false);
    expect(ctx.getContextValue(CTX_SIDEBAR_VISIBLE)).toBe(false);
  });

  it("warns and skips unknown visibility key names", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = new ContextKeyService();
    const mgr = new WorkbenchContextManager(ctx, undefined);
    mgr.trackPartVisibility(makePart(true), "notARealKey");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown visibility key"));
    warnSpy.mockRestore();
  });
});

describe("WorkbenchContextManager — trackViewManager", () => {
  it("seeds activeView and updates on onDidChangeActiveView", () => {
    const ctx = new ContextKeyService();
    const mgr = new WorkbenchContextManager(ctx, undefined);
    const onDidChangeActiveView = new Emitter<string | undefined>();
    const vm = { activeViewId: "v1", onDidChangeActiveView: onDidChangeActiveView.event } as any;
    mgr.trackViewManager(vm);
    expect(ctx.getContextValue(CTX_ACTIVE_VIEW)).toBe("v1");
    onDidChangeActiveView.fire("v2");
    expect(ctx.getContextValue(CTX_ACTIVE_VIEW)).toBe("v2");
    onDidChangeActiveView.fire(undefined);
    expect(ctx.getContextValue(CTX_ACTIVE_VIEW)).toBeUndefined();
  });
});

describe("WorkbenchContextManager — focus tracker subscription", () => {
  it("updates active/focused part and focused view on focus change", () => {
    const ctx = new ContextKeyService();
    const onDidChangeFocus = new Emitter<{ partId?: string; viewId?: string }>();
    new WorkbenchContextManager(ctx, { onDidChangeFocus: onDidChangeFocus.event } as any);
    onDidChangeFocus.fire({ partId: "sidebar", viewId: "explorer" });
    expect(ctx.getContextValue(CTX_ACTIVE_PART)).toBe("sidebar");
    expect(ctx.getContextValue(CTX_FOCUSED_PART)).toBe("sidebar");
    expect(ctx.getContextValue(CTX_FOCUSED_VIEW)).toBe("explorer");
    // partId undefined should NOT clobber activePart; focusedView always updates
    onDidChangeFocus.fire({ partId: undefined, viewId: undefined });
    expect(ctx.getContextValue(CTX_ACTIVE_PART)).toBe("sidebar"); // still
    expect(ctx.getContextValue(CTX_FOCUSED_VIEW)).toBeUndefined();
  });
});

describe("WorkbenchContextManager — manual setters", () => {
  it("setters write to the corresponding context keys", () => {
    const ctx = new ContextKeyService();
    const mgr = new WorkbenchContextManager(ctx, undefined);
    mgr.setActiveEditor("e1");
    mgr.setActiveEditorGroup("g1");
    mgr.setEditorGroupCount(3);
    mgr.setActiveEditorDirty(true);
    mgr.setActiveViewContainer("sidebar");
    mgr.setWorkspaceLoaded(true);
    mgr.setWorkbenchState("folder");
    mgr.setPanelMaximized(true);
    mgr.setZenMode(true);
    expect(ctx.getContextValue(CTX_ACTIVE_EDITOR)).toBe("e1");
    expect(ctx.getContextValue(CTX_ACTIVE_EDITOR_GROUP)).toBe("g1");
    expect(ctx.getContextValue(CTX_EDITOR_GROUP_COUNT)).toBe(3);
    expect(ctx.getContextValue(CTX_ACTIVE_EDITOR_DIRTY)).toBe(true);
    expect(ctx.getContextValue(CTX_ACTIVE_VIEW_CONTAINER)).toBe("sidebar");
    expect(ctx.getContextValue(CTX_WORKSPACE_LOADED)).toBe(true);
    expect(ctx.getContextValue(CTX_WORKBENCH_STATE)).toBe("folder");
    expect(ctx.getContextValue(CTX_PANEL_MAXIMIZED)).toBe(true);
    expect(ctx.getContextValue(CTX_ZEN_MODE)).toBe(true);
  });

  it("setWorkspaceFolderCount also sets the hasFolder boolean", () => {
    const ctx = new ContextKeyService();
    const mgr = new WorkbenchContextManager(ctx, undefined);
    mgr.setWorkspaceFolderCount(0);
    expect(ctx.getContextValue(CTX_WORKSPACE_FOLDER_COUNT)).toBe(0);
    expect(ctx.getContextValue(CTX_WORKSPACE_HAS_FOLDER)).toBe(false);
    mgr.setWorkspaceFolderCount(2);
    expect(ctx.getContextValue(CTX_WORKSPACE_FOLDER_COUNT)).toBe(2);
    expect(ctx.getContextValue(CTX_WORKSPACE_HAS_FOLDER)).toBe(true);
  });
});

describe("WorkbenchContextManager — trackSelectionService", () => {
  it("seeds selectionExists and updates when selection changes", () => {
    const ctx = new ContextKeyService();
    const mgr = new WorkbenchContextManager(ctx, undefined);
    let has = false;
    const onDidChangeSelection = new Emitter<void>();
    const svc = {
      hasAnySelection: () => has,
      onDidChangeSelection: onDidChangeSelection.event,
    } as any;
    mgr.trackSelectionService(svc);
    expect(ctx.getContextValue(CTX_SELECTION_EXISTS)).toBe(false);
    has = true;
    onDidChangeSelection.fire();
    expect(ctx.getContextValue(CTX_SELECTION_EXISTS)).toBe(true);
    has = false;
    onDidChangeSelection.fire();
    expect(ctx.getContextValue(CTX_SELECTION_EXISTS)).toBe(false);
  });
});
