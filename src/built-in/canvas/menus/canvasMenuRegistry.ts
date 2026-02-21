// canvasMenuRegistry.ts — Centralized menu registry for canvas editor
//
// The single facade through which canvasEditorProvider interacts with all
// canvas menu surfaces.  Owns:
//   • ICanvasMenu contract with lifecycle hooks (onTransaction, onSelectionUpdate)
//   • Mutual exclusion — showing one menu hides all others
//   • Outside-click dismissal via a single document mousedown listener
//   • Interaction arbitration (column-resizing, dragging, etc.)
//   • Factory that creates and registers the standard menu set
//   • Lifecycle dispatch (notifyTransaction, notifySelectionUpdate)
//   • Disposal of all registered menus
//
// canvasEditorProvider imports ONLY this file for menu functionality.
// blockHandles imports IBlockActionMenu (interface) from this file.

import type { Editor } from '@tiptap/core';
import type { IDisposable } from '../../../platform/lifecycle.js';
import { SlashMenuController, type SlashMenuHost } from './slashMenu.js';
import { BubbleMenuController, type BubbleMenuHost } from './bubbleMenu.js';
import { BlockActionMenuController, type BlockActionMenuHost } from './blockActionMenu.js';
import { IconMenuController, type IconMenuHost, type IconMenuOptions } from './iconMenu.js';
import { CoverMenuController, type CoverMenuHost, type CoverMenuOptions } from './coverMenu.js';
import { InlineMathEditorController, type InlineMathEditorHost } from '../math/inlineMathEditor.js';
import {
  getSlashMenuBlocks as _getSlashMenuBlocks,
  getTurnIntoBlocks as _getTurnIntoBlocks,
  getBlockLabel as _getBlockLabel,
  getBlockByName as _getBlockByName,
  BLOCK_REGISTRY as _BLOCK_REGISTRY,
  type InsertActionContext as _InsertActionContext,
} from '../config/blockRegistry.js';

// Re-export InsertActionContext so menu children (slashMenu.ts) get it
// through their parent registry rather than importing blockRegistry directly.
export type InsertActionContext = _InsertActionContext;

// ── Icon Access (registry-to-registry gate) ─────────────────────────────────
// MenuRegistry talks to IconRegistry so that individual menu files never
// import iconRegistry directly.  They import these re-exports from
// canvasMenuRegistry — their single entry point.

import {
  svgIcon as _ir_svgIcon,
  PAGE_SELECTABLE_ICONS as _ir_PAGE_SELECTABLE_ICONS,
} from '../config/iconRegistry.js';

/** Render an SVG icon string by ID (delegates to IconRegistry). */
export const svgIcon: (id: string) => string = _ir_svgIcon;

// ── Block Mutation Access (registry-to-registry gate) ────────────────────────
// Menu children (blockActionMenu) get mutation helpers through
// canvasMenuRegistry — their single entry point — instead of importing
// blockMutations or blockRegistry directly.
//
// canvasMenuRegistry → blockRegistry → blockMutations  (the correct chain).

export {
  applyBackgroundColorToBlock,
  applyTextColorToBlock,
  deleteBlockAt,
  duplicateBlockAt,
  turnBlockWithSharedStrategy,
} from '../config/blockRegistry.js';

/** Icon IDs selectable by users for pages/callouts (delegates to IconRegistry). */
export const PAGE_SELECTABLE_ICONS: readonly string[] = _ir_PAGE_SELECTABLE_ICONS;

// ── Menu contract ───────────────────────────────────────────────────────────

/**
 * Narrow block-info shape exposed to menu consumers.
 *
 * Menus never import blockRegistry directly — they receive block data
 * through CanvasMenuRegistry methods typed with this interface.
 */
export interface MenuBlockInfo {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly icon: string;
  readonly iconIsText?: boolean;
  readonly defaultAttrs?: Record<string, any>;
  readonly defaultContent?: Record<string, any>;
  readonly slashMenu?: { readonly label?: string; readonly description: string };
  readonly turnInto?: { readonly order: number; readonly shortcut?: string };
}

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

  /** Called on every editor transaction (state change). Optional. */
  onTransaction?(editor: Editor): void;

  /** Called on every editor selection update. Optional. */
  onSelectionUpdate?(editor: Editor): void;

  /** Dispose DOM and resources. Optional. */
  dispose?(): void;
}

// ── Block Action Menu interface (consumed by blockHandles.ts) ───────────────

/**
 * Narrow interface for the block-action menu, consumed by
 * BlockHandlesController so it doesn't need to import the concrete class.
 */
export interface IBlockActionMenu extends ICanvasMenu {
  show(pos: number, node: any, anchor: DOMRect, anchorEl?: HTMLElement): void;
  readonly menu: HTMLElement | null;
}

// ── Combined host type (union of all menu hosts) ────────────────────────────

export type CanvasMenuHost = SlashMenuHost & BubbleMenuHost & BlockActionMenuHost & IconMenuHost & CoverMenuHost & InlineMathEditorHost;

// ── Registry ────────────────────────────────────────────────────────────────

export class CanvasMenuRegistry {
  private readonly _menus = new Map<string, ICanvasMenu>();
  private readonly _getEditor: () => Editor | null;
  private _iconMenu: IconMenuController | null = null;
  private _coverMenu: CoverMenuController | null = null;
  private _inlineMathEditor: InlineMathEditorController | null = null;

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

  // ── Factory ─────────────────────────────────────────────────────────────

  /**
   * Create, initialise, and register the standard canvas menu set.
   *
   * Returns the block-action menu handle so the caller can pass it to
   * BlockHandlesController (the only external consumer).
   */
  createStandardMenus(host: CanvasMenuHost): IBlockActionMenu {
    const slash = new SlashMenuController(host, this);
    slash.create();

    const bubble = new BubbleMenuController(host, this);
    bubble.create();

    const blockAction = new BlockActionMenuController(host, this);
    blockAction.create();

    const icon = new IconMenuController(host, this);
    icon.create();
    this._iconMenu = icon;

    const cover = new CoverMenuController(host, this);
    cover.create();
    this._coverMenu = cover;

    const inlineMath = new InlineMathEditorController(host, this);
    inlineMath.create();
    this._inlineMathEditor = inlineMath;

    return blockAction;
  }

  // ── Registration ────────────────────────────────────────────────────────

  /** Register a menu surface.  Returns a disposable that removes it. */
  register(menu: ICanvasMenu): IDisposable {
    this._menus.set(menu.id, menu);
    return { dispose: () => { this._menus.delete(menu.id); } };
  }

  // ── Lifecycle dispatch ──────────────────────────────────────────────────

  /**
   * Forward an editor transaction to every registered menu that
   * implements `onTransaction`.
   */
  notifyTransaction(editor: Editor): void {
    for (const menu of this._menus.values()) {
      menu.onTransaction?.(editor);
    }
  }

  /**
   * Forward an editor selection-update to every registered menu that
   * implements `onSelectionUpdate`.
   */
  notifySelectionUpdate(editor: Editor): void {
    for (const menu of this._menus.values()) {
      menu.onSelectionUpdate?.(editor);
    }
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

  /**
   * Show the icon picker popup via the registry-managed icon menu.
   *
   * This is the single entry point for all icon picker usage — pageChrome,
   * pageBlockNode, calloutNode all call through here (directly or via a
   * callback threaded through their entry point).
   */
  showIconMenu(options: IconMenuOptions): void {
    this._iconMenu?.show(options);
  }

  /**
   * Show the cover picker popup via the registry-managed cover menu.
   *
   * This is the single entry point for all cover picker usage — pageChrome
   * calls through here instead of building raw DOM inline.
   */
  showCoverMenu(options: CoverMenuOptions): void {
    this._coverMenu?.show(options);
  }

  /**
   * Show the inline math editor popup for a specific node.
   *
   * This is the single entry point for all inline-math editing usage —
   * the click handler, slash menu, and bubble menu all call through here.
   */
  showInlineMathEditor(pos: number, latex: string, anchorEl: HTMLElement): void {
    this._inlineMathEditor?.show(pos, latex, anchorEl);
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

  // ── Block-data gate (menus read block info through here) ──────────────

  /**
   * Block definitions that appear in the slash menu, sorted by order.
   * Menus call this instead of importing blockRegistry directly.
   */
  getSlashMenuBlocks(): MenuBlockInfo[] {
    return _getSlashMenuBlocks();
  }

  /**
   * Block definitions that appear in the turn-into submenu, sorted by order.
   */
  getTurnIntoBlocks(): MenuBlockInfo[] {
    return _getTurnIntoBlocks();
  }

  /**
   * Look up a block definition by its registry ID (e.g. 'callout', 'details').
   * Returns undefined when the ID is not registered.
   */
  getBlockDefinition(id: string): MenuBlockInfo | undefined {
    return _BLOCK_REGISTRY.get(id);
  }

  /**
   * Human-readable label for a ProseMirror node type name.
   * Handles generic labels for multi-variant types (heading → 'Heading').
   */
  labelForBlockType(typeName: string): string {
    return _getBlockLabel(typeName);
  }

  /**
   * Whether the bubble menu should be suppressed for a given node type.
   * Checks the block registry's `suppressBubbleMenu` capability flag.
   */
  shouldSuppressBubbleMenu(typeName: string): boolean {
    const def = _getBlockByName(typeName);
    return def?.capabilities.suppressBubbleMenu ?? false;
  }

  // ── Block insert delegation ─────────────────────────────────────────────

  /**
   * Execute the insertion action for a block.
   *
   * Looks up the block definition by ID and delegates to its `insertAction`
   * callback when present.  Blocks without `insertAction` fall back to the
   * simple `insertContentAt(range, defaultContent).focus().run()` path.
   *
   * This is the single entry point for block insertion from any menu surface.
   * Menu children never contain orchestration logic — they call this method.
   */
  async executeBlockInsert(
    blockId: string,
    editor: Editor,
    range: { from: number; to: number },
    context: _InsertActionContext,
  ): Promise<void> {
    const def = _BLOCK_REGISTRY.get(blockId);
    if (!def) return;

    if (def.insertAction) {
      await def.insertAction(editor, range, context);
    } else if (def.defaultContent) {
      editor.chain().insertContentAt(range, def.defaultContent).focus().run();
    }
  }

  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    document.removeEventListener('mousedown', this._onDocMousedown, true);
    // Snapshot then clear to avoid re-entrant removal during dispose
    const menus = [...this._menus.values()];
    this._menus.clear();
    for (const menu of menus) {
      menu.dispose?.();
    }
  }
}
