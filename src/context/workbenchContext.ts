// workbenchContext.ts — structural context model
//
// Defines and continuously updates the standard set of workbench context keys.
// These keys reflect structural state (part visibility, active part/view,
// editor groups, workspace state) and are consumed by when-clause expressions
// on commands and UI elements.
//
// WorkbenchContextManager is a Disposable that subscribes to workbench events
// and synchronously updates the ContextKeyService whenever state changes.

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { ContextKeyService, IContextKey } from './contextKey.js';
import { FocusTracker } from './focusTracker.js';

// ─── Standard Context Key Names ──────────────────────────────────────────────
// Exported so consumers can reference them without magic strings.

export const CTX_SIDEBAR_VISIBLE = 'sidebarVisible';
export const CTX_PANEL_VISIBLE = 'panelVisible';
export const CTX_AUXILIARY_BAR_VISIBLE = 'auxiliaryBarVisible';
export const CTX_STATUS_BAR_VISIBLE = 'statusBarVisible';

export const CTX_ACTIVE_PART = 'activePart';
export const CTX_ACTIVE_VIEW = 'activeView';
export const CTX_FOCUSED_VIEW = 'focusedView';
export const CTX_FOCUSED_PART = 'focusedPart';

export const CTX_ACTIVE_EDITOR = 'activeEditor';
export const CTX_ACTIVE_EDITOR_GROUP = 'activeEditorGroup';
export const CTX_EDITOR_GROUP_COUNT = 'editorGroupCount';
export const CTX_ACTIVE_EDITOR_DIRTY = 'activeEditorDirty';

export const CTX_ACTIVE_VIEW_CONTAINER = 'activeViewContainer';

export const CTX_WORKSPACE_LOADED = 'workspaceLoaded';
export const CTX_WORKBENCH_STATE = 'workbenchState';

// ─── WorkbenchParts interface ────────────────────────────────────────────────
// Minimal shape of the parts we track. Avoids importing the Workbench class.

export interface TrackablePart {
  readonly id: string;
  readonly visible: boolean;
  readonly onDidChangeVisibility: (listener: (visible: boolean) => void) => IDisposable;
}

export interface TrackableViewManager {
  readonly activeViewId: string | undefined;
  readonly onDidChangeActiveView: (listener: (viewId: string | undefined) => void) => IDisposable;
}

// ─── WorkbenchContextManager ─────────────────────────────────────────────────

/**
 * Creates and continuously syncs all standard workbench context keys.
 *
 * Usage:
 * ```ts
 * const ctx = new WorkbenchContextManager(contextKeyService, focusTracker);
 * ctx.trackPartVisibility(sidebar, CTX_SIDEBAR_VISIBLE);
 * ctx.trackPartVisibility(panel, CTX_PANEL_VISIBLE);
 * ctx.trackViewManager(viewManager);
 * ctx.setWorkbenchState('folder');
 * ctx.setWorkspaceLoaded(true);
 * ```
 */
export class WorkbenchContextManager extends Disposable {
  // Typed handles for each standard key
  private readonly _sidebarVisible: IContextKey<boolean>;
  private readonly _panelVisible: IContextKey<boolean>;
  private readonly _auxiliaryBarVisible: IContextKey<boolean>;
  private readonly _statusBarVisible: IContextKey<boolean>;

  private readonly _activePart: IContextKey<string | undefined>;
  private readonly _activeView: IContextKey<string | undefined>;
  private readonly _focusedView: IContextKey<string | undefined>;
  private readonly _focusedPart: IContextKey<string | undefined>;

  private readonly _activeEditor: IContextKey<string | undefined>;
  private readonly _activeEditorGroup: IContextKey<string | undefined>;
  private readonly _editorGroupCount: IContextKey<number>;

  private readonly _activeEditorDirty: IContextKey<boolean>;

  private readonly _activeViewContainer: IContextKey<string | undefined>;

  private readonly _workspaceLoaded: IContextKey<boolean>;
  private readonly _workbenchState: IContextKey<string>;

  constructor(
    private readonly _contextKeyService: ContextKeyService,
    private readonly _focusTracker: FocusTracker | undefined,
  ) {
    super();

    // Create typed key handles (all in global scope)
    this._sidebarVisible = _contextKeyService.createKey(CTX_SIDEBAR_VISIBLE, false);
    this._panelVisible = _contextKeyService.createKey(CTX_PANEL_VISIBLE, false);
    this._auxiliaryBarVisible = _contextKeyService.createKey(CTX_AUXILIARY_BAR_VISIBLE, false);
    this._statusBarVisible = _contextKeyService.createKey(CTX_STATUS_BAR_VISIBLE, true);

    this._activePart = _contextKeyService.createKey<string | undefined>(CTX_ACTIVE_PART, undefined);
    this._activeView = _contextKeyService.createKey<string | undefined>(CTX_ACTIVE_VIEW, undefined);
    this._focusedView = _contextKeyService.createKey<string | undefined>(CTX_FOCUSED_VIEW, undefined);
    this._focusedPart = _contextKeyService.createKey<string | undefined>(CTX_FOCUSED_PART, undefined);

    this._activeEditor = _contextKeyService.createKey<string | undefined>(CTX_ACTIVE_EDITOR, undefined);
    this._activeEditorGroup = _contextKeyService.createKey<string | undefined>(CTX_ACTIVE_EDITOR_GROUP, undefined);
    this._editorGroupCount = _contextKeyService.createKey(CTX_EDITOR_GROUP_COUNT, 1);

    this._activeEditorDirty = _contextKeyService.createKey(CTX_ACTIVE_EDITOR_DIRTY, false);

    this._activeViewContainer = _contextKeyService.createKey<string | undefined>(CTX_ACTIVE_VIEW_CONTAINER, undefined);

    this._workspaceLoaded = _contextKeyService.createKey(CTX_WORKSPACE_LOADED, false);
    this._workbenchState = _contextKeyService.createKey(CTX_WORKBENCH_STATE, 'empty');

    // Subscribe to focus tracker
    if (_focusTracker) {
      this._register(_focusTracker.onDidChangeFocus((e) => {
        if (e.partId !== undefined) {
          this._activePart.set(e.partId);
          this._focusedPart.set(e.partId);
        }
        // Always update focusedView (may be undefined)
        this._focusedView.set(e.viewId);
      }));
    }
  }

  // ─── Part Visibility Tracking ──────────────────────────────────────────

  /**
   * Wire up tracking for a part's visibility changes.
   */
  trackPartVisibility(part: TrackablePart, contextKeyName: string): void {
    // Determine which key handle to use
    const key = this._getVisibilityKey(contextKeyName);
    if (!key) {
      console.warn(`[WorkbenchContext] Unknown visibility key: ${contextKeyName}`);
      return;
    }

    // Set initial value
    key.set(part.visible);

    // Subscribe to changes
    this._register(part.onDidChangeVisibility((visible) => {
      key.set(visible);
    }));
  }

  private _getVisibilityKey(name: string): IContextKey<boolean> | undefined {
    switch (name) {
      case CTX_SIDEBAR_VISIBLE: return this._sidebarVisible;
      case CTX_PANEL_VISIBLE: return this._panelVisible;
      case CTX_AUXILIARY_BAR_VISIBLE: return this._auxiliaryBarVisible;
      case CTX_STATUS_BAR_VISIBLE: return this._statusBarVisible;
      default: return undefined;
    }
  }

  // ─── View Manager Tracking ─────────────────────────────────────────────

  /**
   * Wire up tracking for the view manager's active view.
   */
  trackViewManager(vm: TrackableViewManager): void {
    // Initial
    this._activeView.set(vm.activeViewId);

    // Subscribe
    this._register(vm.onDidChangeActiveView((viewId) => {
      this._activeView.set(viewId);
    }));
  }

  // ─── Manual Setters ────────────────────────────────────────────────────

  setActiveEditor(editorId: string | undefined): void {
    this._activeEditor.set(editorId);
  }

  setActiveEditorGroup(groupId: string | undefined): void {
    this._activeEditorGroup.set(groupId);
  }

  setEditorGroupCount(count: number): void {
    this._editorGroupCount.set(count);
  }

  setActiveEditorDirty(dirty: boolean): void {
    this._activeEditorDirty.set(dirty);
  }

  setWorkspaceLoaded(loaded: boolean): void {
    this._workspaceLoaded.set(loaded);
  }

  setWorkbenchState(state: 'empty' | 'folder' | 'workspace'): void {
    this._workbenchState.set(state);
  }

  setSidebarVisible(visible: boolean): void {
    this._sidebarVisible.set(visible);
  }

  setPanelVisible(visible: boolean): void {
    this._panelVisible.set(visible);
  }

  setAuxiliaryBarVisible(visible: boolean): void {
    this._auxiliaryBarVisible.set(visible);
  }

  setStatusBarVisible(visible: boolean): void {
    this._statusBarVisible.set(visible);
  }

  setActiveViewContainer(containerId: string | undefined): void {
    this._activeViewContainer.set(containerId);
  }
}
