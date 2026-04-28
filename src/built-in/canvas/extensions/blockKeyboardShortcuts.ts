// blockKeyboardShortcuts.ts — Global keyboard shortcuts for block surfaces
//
// Keeps only cross-surface/global shortcuts here (Esc block select,
// Shift+Arrow block-selection extend, plus post-selection actions:
// Backspace/Delete, Mod-d duplicate, Mod-Shift-Arrow move, Enter edit).
// Column-scoped movement/duplicate shortcuts live in columnNodes.ts so there is
// a single owner for Mod-Shift-ArrowUp/Down and Mod-d behavior.

import { Extension } from '@tiptap/core';

export const BlockKeyboardShortcuts = Extension.create({
  name: 'blockKeyboardShortcuts',

  // Higher than the default 100 used by columnNodes / list extensions, so
  // multi-block shortcuts (Mod-d, Backspace, Delete, Mod-Shift-Arrow) get
  // the first chance to handle the keystroke when a block selection is
  // active. With same priority, registration order would decide and a
  // single-block column-scoped Mod-d could shadow the multi-block path.
  priority: 200,

  addStorage() {
    return {
      /** Set by the orchestrator after editor creation.
       *  Used by the Esc shortcut to trigger block selection. */
      selectAtCursor: null as (() => boolean) | null,
      /** Extend block selection upward (Shift+ArrowUp). */
      extendSelectionUp: null as (() => boolean) | null,
      /** Extend block selection downward (Shift+ArrowDown). */
      extendSelectionDown: null as (() => boolean) | null,
      /** Delete all selected blocks (Backspace / Delete). */
      deleteSelected: null as (() => void) | null,
      /** Duplicate all selected blocks (Mod-d). */
      duplicateSelected: null as (() => void) | null,
      /** Move selected blocks up (Mod-Shift-ArrowUp). */
      moveSelectedUp: null as (() => boolean) | null,
      /** Move selected blocks down (Mod-Shift-ArrowDown). */
      moveSelectedDown: null as (() => boolean) | null,
      /** Enter edit mode on first selected block (Enter). */
      enterEditFirstSelected: null as (() => boolean) | null,
      /** Check whether any blocks are currently selected. */
      hasSelection: null as (() => boolean) | null,
    };
  },

  addKeyboardShortcuts() {
    return {
      // ── Esc — Select block at cursor ──
      Escape: () => {
        const fn = this.storage.selectAtCursor;
        if (fn) return fn();
        return false;
      },

      // ── Shift+ArrowUp — Extend block selection upward ──
      'Shift-ArrowUp': () => {
        const fn = this.storage.extendSelectionUp;
        if (fn) return fn();
        return false;
      },

      // ── Shift+ArrowDown — Extend block selection downward ──
      'Shift-ArrowDown': () => {
        const fn = this.storage.extendSelectionDown;
        if (fn) return fn();
        return false;
      },

      // ── Backspace — Delete selected blocks ──
      Backspace: () => {
        if (!this.storage.hasSelection?.()) return false;
        this.storage.deleteSelected?.();
        return true;
      },

      // ── Delete — Delete selected blocks ──
      Delete: () => {
        if (!this.storage.hasSelection?.()) return false;
        this.storage.deleteSelected?.();
        return true;
      },

      // ── Mod-d — Duplicate selected blocks ──
      'Mod-d': () => {
        if (!this.storage.hasSelection?.()) return false;
        this.storage.duplicateSelected?.();
        return true;
      },

      // ── Mod-Shift-ArrowUp — Move selected blocks up ──
      'Mod-Shift-ArrowUp': () => {
        const fn = this.storage.moveSelectedUp;
        if (fn) return fn();
        return false;
      },

      // ── Mod-Shift-ArrowDown — Move selected blocks down ──
      'Mod-Shift-ArrowDown': () => {
        const fn = this.storage.moveSelectedDown;
        if (fn) return fn();
        return false;
      },

      // ── Enter — Edit first selected block ──
      Enter: () => {
        const fn = this.storage.enterEditFirstSelected;
        if (fn && this.storage.hasSelection?.()) return fn();
        return false;
      },
    };
  },
});
