// canvasMenuRegistry.ts — Centralized menu registry for canvas editor
//
// Owns mutual exclusion, outside-click dismissal, and interaction
// arbitration for all canvas menu surfaces (slash, bubble, block-action,
// and — in Phase 2 — ephemeral insert-popups).
//
// Each menu implements `ICanvasMenu` and registers with the registry.
// When a menu shows, it calls `registry.notifyShow(id)` which hides all
// other visible menus.  A single `mousedown` listener on `document`
// handles outside-click dismissal for every registered surface.

import type { Editor } from '@tiptap/core';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ── Menu contract ───────────────────────────────────────────────────────────

/**
 * Implemented by every canvas menu surface that participates in
 * centralized visibility management.
 */
export interface ICanvasMenu {
  /** Unique identifier (e.g. 'slash-menu', 'bubble-menu'). */
  readonly id: string;

  /** Whether this menu is currently visible. */
  readonly visible: boolean;

  /**
   * Returns `true` if `target` is "inside" this menu.
   *
   * Each menu defines its own containment rules — the block-action menu
   * includes its submenus and anchor element, while the slash menu only
   * checks its root element.
   */
  containsTarget(target: Node): boolean;

  /** Hide the menu (and any child submenus). */
  hide(): void;
}

// ── Registry ────────────────────────────────────────────────────────────────

export class CanvasMenuRegistry {
  private readonly _menus = new Map<string, ICanvasMenu>();
  private readonly _getEditor: () => Editor | null;

  // Bound once so we can remove the same reference on dispose.
  private readonly _onDocMousedown = (e: MouseEvent): void => {
    if (this.isInteractionLocked()) {
      this.hideAll();
      return;
    }
    const target = e.target as Node;
    for (const menu of this._menus.values()) {
      if (menu.visible && !menu.containsTarget(target)) {
        menu.hide();
      }
    }
  };

  constructor(getEditor: () => Editor | null) {
    this._getEditor = getEditor;
    document.addEventListener('mousedown', this._onDocMousedown, true);
  }

  // ── Registration ────────────────────────────────────────────────────────

  /** Register a menu surface.  Returns a disposable that removes it. */
  register(menu: ICanvasMenu): IDisposable {
    this._menus.set(menu.id, menu);
    return { dispose: () => { this._menus.delete(menu.id); } };
  }

  // ── Visibility management ───────────────────────────────────────────────

  /**
   * Called by a menu immediately after it becomes visible.
   * Hides every *other* visible menu (mutual exclusion).
   */
  notifyShow(menuId: string): void {
    for (const [id, menu] of this._menus) {
      if (id !== menuId && menu.visible) {
        menu.hide();
      }
    }
  }

  /** Hide every registered menu. */
  hideAll(): void {
    for (const menu of this._menus.values()) {
      if (menu.visible) menu.hide();
    }
  }

  /** `true` if at least one registered menu is visible. */
  isAnyVisible(): boolean {
    for (const menu of this._menus.values()) {
      if (menu.visible) return true;
    }
    return false;
  }

  /**
   * `true` if `document.activeElement` is inside any visible menu.
   *
   * Used by the `onBlur` handler to avoid hiding menus when focus
   * temporarily moves to a button inside the menu itself.
   */
  containsFocusedElement(): boolean {
    const active = document.activeElement;
    if (!active) return false;
    for (const menu of this._menus.values()) {
      if (menu.visible && menu.containsTarget(active)) return true;
    }
    return false;
  }

  // ── Interaction arbitration ─────────────────────────────────────────────

  /**
   * `true` when an incompatible interaction is in progress and all
   * menus should be hidden.
   *
   * Checks the **superset** of all previously-per-menu conditions:
   *   • `column-resizing`          (body)
   *   • `column-resize-hover`      (body)
   *   • `block-handle-interacting` (body)
   *   • `dragging`                 (editor.view.dom)
   */
  isInteractionLocked(): boolean {
    const body = document.body;
    if (body.classList.contains('column-resizing')) return true;
    if (body.classList.contains('column-resize-hover')) return true;
    if (body.classList.contains('block-handle-interacting')) return true;
    const editor = this._getEditor();
    if (editor && editor.view.dom.classList.contains('dragging')) return true;
    return false;
  }

  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    document.removeEventListener('mousedown', this._onDocMousedown, true);
    this._menus.clear();
  }
}
