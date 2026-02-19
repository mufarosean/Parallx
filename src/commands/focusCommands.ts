// focusCommands.ts — Focus navigation commands (F6, Ctrl+0, etc.)
//
// Extracted from structuralCommands.ts during Milestone 7.2 Phase D (C.7).

import type { CommandDescriptor } from './commandTypes.js';
import { PartId } from '../services/serviceTypes.js';
import { wb } from './structuralCommandTypes.js';
import type { WorkbenchLike } from './structuralCommandTypes.js';

// ─── Focus Commands (Cap 8) ──────────────────────────────────────────────────

/**
 * Cycling order for F6/Shift+F6 (matches VS Code navigationActions.ts):
 *   Editor → Panel → AuxiliaryBar → StatusBar → ActivityBar → Sidebar → Editor
 * Hidden parts are skipped automatically.
 */
const FOCUS_CYCLE_ORDER: string[] = [
  PartId.Editor,
  PartId.Panel,
  PartId.AuxiliaryBar,
  PartId.StatusBar,
  PartId.ActivityBar,
  PartId.Sidebar,
];

function findVisibleNeighbour(w: WorkbenchLike, partId: string, next: boolean): string {
  const idx = FOCUS_CYCLE_ORDER.indexOf(partId);
  const len = FOCUS_CYCLE_ORDER.length;
  let current = idx >= 0 ? idx : 0;

  // Walk up to len times to find a visible neighbour (avoids infinite loop)
  for (let i = 0; i < len; i++) {
    current = next
      ? (current + 1) % len
      : (current - 1 + len) % len;
    const candidateId = FOCUS_CYCLE_ORDER[current];
    // Editor is always visible
    if (candidateId === PartId.Editor || w.isPartVisible(candidateId)) {
      return candidateId;
    }
  }
  return PartId.Editor; // fallback
}

function getCurrentlyFocusedPart(w: WorkbenchLike): string | undefined {
  for (const partId of FOCUS_CYCLE_ORDER) {
    if (w.hasFocus(partId)) return partId;
  }
  return undefined;
}

export const focusNextPart: CommandDescriptor = {
  id: 'workbench.action.focusNextPart',
  title: 'Focus Next Part',
  category: 'View',
  keybinding: 'F6',
  handler(ctx) {
    const w = wb(ctx);
    const current = getCurrentlyFocusedPart(w) ?? PartId.Editor;
    const target = findVisibleNeighbour(w, current, true);
    w.focusPart(target);
  },
};

export const focusPreviousPart: CommandDescriptor = {
  id: 'workbench.action.focusPreviousPart',
  title: 'Focus Previous Part',
  category: 'View',
  keybinding: 'Shift+F6',
  handler(ctx) {
    const w = wb(ctx);
    const current = getCurrentlyFocusedPart(w) ?? PartId.Editor;
    const target = findVisibleNeighbour(w, current, false);
    w.focusPart(target);
  },
};

export const focusFirstEditorGroup: CommandDescriptor = {
  id: 'workbench.action.focusFirstEditorGroup',
  title: 'Focus First Editor Group',
  category: 'View',
  keybinding: 'Ctrl+1',
  handler(ctx) {
    wb(ctx).focusPart(PartId.Editor);
  },
};

export const focusSecondEditorGroup: CommandDescriptor = {
  id: 'workbench.action.focusSecondEditorGroup',
  title: 'Focus Second Editor Group',
  category: 'View',
  keybinding: 'Ctrl+2',
  handler(ctx) {
    // When multi-group is implemented, this should focus group 2.
    // For now, focus the editor part.
    wb(ctx).focusPart(PartId.Editor);
  },
};

export const focusThirdEditorGroup: CommandDescriptor = {
  id: 'workbench.action.focusThirdEditorGroup',
  title: 'Focus Third Editor Group',
  category: 'View',
  keybinding: 'Ctrl+3',
  handler(ctx) {
    wb(ctx).focusPart(PartId.Editor);
  },
};

export const focusSideBar: CommandDescriptor = {
  id: 'workbench.action.focusSideBar',
  title: 'Focus into Primary Side Bar',
  category: 'View',
  keybinding: 'Ctrl+0',
  handler(ctx) {
    const w = wb(ctx);
    // Show sidebar if hidden, then focus
    if (!w.isPartVisible(PartId.Sidebar)) {
      w.toggleSidebar();
    }
    w.focusPart(PartId.Sidebar);
  },
};

export const focusPanel: CommandDescriptor = {
  id: 'workbench.action.focusPanel',
  title: 'Focus into Panel',
  category: 'View',
  keybinding: 'Ctrl+`',
  handler(ctx) {
    const w = wb(ctx);
    // Show panel if hidden, then focus
    if (!w.isPartVisible(PartId.Panel)) {
      w.togglePanel();
    }
    w.focusPart(PartId.Panel);
  },
};

export const focusActivityBar: CommandDescriptor = {
  id: 'workbench.action.focusActivityBar',
  title: 'Focus Activity Bar',
  category: 'View',
  handler(ctx) {
    wb(ctx).focusPart(PartId.ActivityBar);
  },
};

export const focusStatusBar: CommandDescriptor = {
  id: 'workbench.action.focusStatusBar',
  title: 'Focus Status Bar',
  category: 'View',
  handler(ctx) {
    const w = wb(ctx);
    if (!w.isPartVisible(PartId.StatusBar)) return; // no-op if hidden
    w.focusPart(PartId.StatusBar);
  },
};
