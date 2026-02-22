// blockKeyboardShortcuts.ts — Global keyboard shortcuts for block surfaces
//
// Keeps only cross-surface/global shortcuts here (Esc block select,
// Shift+Arrow block-selection extend).
// Column-scoped movement/duplicate shortcuts live in columnNodes.ts so there is
// a single owner for Mod-Shift-ArrowUp/Down and Mod-d behavior.

import { Extension } from '@tiptap/core';

export const BlockKeyboardShortcuts = Extension.create({
  name: 'blockKeyboardShortcuts',

  addStorage() {
    return {
      /** Set by the orchestrator after editor creation.
       *  Used by the Esc shortcut to trigger block selection. */
      selectAtCursor: null as (() => boolean) | null,
      /** Extend block selection upward (Shift+ArrowUp). */
      extendSelectionUp: null as (() => boolean) | null,
      /** Extend block selection downward (Shift+ArrowDown). */
      extendSelectionDown: null as (() => boolean) | null,
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
    };
  },
});
