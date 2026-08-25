// structuralCommandTypes.ts — Shared types and utilities for structural commands
//
// Extracted from structuralCommands.ts during Milestone 7.2 Phase D (C.7).
// Houses the WorkbenchLike shape (avoids circular imports), ElectronBridge
// interface, and common helper functions used across all command families.

import type { CommandExecutionContext } from './commandTypes.js';
import type { IWorkspaceService, IFileService } from '../services/serviceTypes.js';
import { URI } from '../platform/uri.js';

// ─── Workbench type (avoids circular import) ────────────────────────────────
// Command handlers access workbench via `ctx.workbench` cast to this shape.

export interface WorkbenchLike {
  toggleAuxiliaryBar(): void;
  toggleSidebar(): void;
  togglePanel(): void;
  /**
   * Toggle a body AREA: hide/show whatever occupies the region relative to
   * the editor. What the titlebar toggles and Ctrl+B / Ctrl+J mean.
   */
  toggleArea(area: 'left' | 'right' | 'bottom'): void;
  /** Capture the live body shape under a name (Settings > Layouts is the
   *  management home; empty name = a default dated name). */
  saveCurrentLayout(name: string): Promise<unknown>;
  /** Adopt a dashboard widget into the workbench as a standalone seat. */
  adoptWidget(widgetId: string): Promise<boolean>;
  /** Open the widget type picker; choosing a type creates and seats one. */
  showAddWidgetMenu(anchor?: { x: number; y: number }): void;
  toggleMaximizedPanel(): void;
  toggleStatusBar(): void;
  toggleZenMode(): void;
  toggleCommandPalette(): void;
  showQuickOpen(): void;
  showGoToLine(): void;
  selectColorTheme(): void;
  showSidebarView(viewId: string): void;
  readonly workspace: { readonly id: string; readonly name: string; readonly displayName: string; rename(name: string): void };
  createWorkspace(name: string, path?: string, switchTo?: boolean, cloneState?: unknown): Promise<unknown>;
  switchWorkspace(targetId: string): Promise<void>;
  openFolder(folderPath: string): Promise<void>;
  getRecentWorkspaces(): Promise<readonly { identity: { id: string; name: string }; metadata: { lastAccessedAt: string } }[]>;
  removeRecentWorkspace(workspaceId: string): Promise<void>;
  shutdown(): Promise<void>;

  // Focus model (Cap 8)
  focusPart(partId: string): void;
  hasFocus(partId: string): boolean;
  isPartVisible(partId: string): boolean;

  // Part refs for toggle commands
  readonly _sidebar: { visible: boolean; setVisible(v: boolean): void; id: string };
  readonly _panel: { visible: boolean; setVisible(v: boolean): void; id: string };
  readonly _statusBar: { visible: boolean; setVisible(v: boolean): void };
  readonly _auxiliaryBar: { visible: boolean; setVisible(v: boolean): void };
  _relayout(): void;
  /**
   * The one body grid. Commands address parts by view id — never by sash
   * index or child position, which stopped meaning anything when the layout
   * became a tree.
   */
  readonly _grid: {
    layout(): void;
    hasView(viewId: string): boolean;
    getViewSize(viewId: string): number | undefined;
    resizeView(viewId: string, size: number): void;
  };
  /** Rebuild the default shape — the reset command's whole implementation. */
  resetLayout(): void;
  /** Put ONE part back at its default position, leaving the rest alone. */
  resetPartPlacement(partId: string): void;
  /**
   * Move a part to an outer edge of the body. Orientation values are the
   * grid's ('horizontal' | 'vertical'); before = left/top edge.
   */
  movePartToEdge(partId: string, orientation: 'horizontal' | 'vertical', before: boolean): void;
  readonly _workspaceSaver: { save(): Promise<void>; collectState(): unknown };
  readonly _titlebar: { setWorkspaceName(name: string): void };
  _updateWindowTitle(editor?: unknown): void;
  readonly _sidebarContainer: ViewContainerLike;
  readonly _panelContainer: ViewContainerLike;
  readonly _auxBarContainer: ViewContainerLike | undefined;
  readonly _viewManager: { getView(viewId: string): unknown | undefined };
  _layoutViewContainers(): void;
}

/** Minimal shape of a view container for cross-container moves. */
export interface ViewContainerLike {
  readonly id: string;
  addView(view: unknown, index?: number): void;
  removeView(viewId: string): unknown | undefined;
  getView(viewId: string): unknown | undefined;
}

export function wb(ctx: CommandExecutionContext): WorkbenchLike {
  return ctx.workbench as WorkbenchLike;
}

// ─── Electron bridge type ────────────────────────────────────────────────────

export interface ElectronBridge {
  close(): void;
  dialog: {
    openFolder(options?: { title?: string }): Promise<string[] | null>;
    openFile(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string[] | null>;
    saveFile(options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
    showMessageBox(options: { type?: string; title?: string; message: string; buttons?: string[]; defaultId?: number }): Promise<{ response: number }>;
  };
}

export function electronBridge(): ElectronBridge | undefined {
  return (globalThis as any).parallxElectron as ElectronBridge | undefined;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

export async function ensureUriWithinWorkspaceOrPrompt(
  ctx: CommandExecutionContext,
  uri: URI,
  actionLabel: string,
): Promise<boolean> {
  const wsService = ctx.getService<IWorkspaceService>('IWorkspaceService');
  if (!wsService) return true;

  if (wsService.getWorkspaceFolder(uri)) return true;

  const parentFolder = uri.dirname;
  if (!parentFolder) return false;

  const fileService = ctx.getService<IFileService>('IFileService');
  const decision = fileService
    ? await fileService.showMessageBox({
        type: 'warning',
        title: 'Path Outside Workspace',
        message: `${actionLabel} is outside the current workspace. Add its folder to workspace first?`,
        buttons: ['Add Folder & Continue', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      })
    : { response: 1, checkboxChecked: false };

  if (decision.response !== 0) return false;

  wsService.addFolder(parentFolder);
  await wb(ctx)._workspaceSaver.save();
  return true;
}
