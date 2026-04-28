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
import { InlineAIChatController, type InlineAIChatHost, type SendChatRequestFn, type RetrieveContextFn } from './inlineAIChat.js';
import { showImageInsertPopup as _showImageInsertPopup } from './imageInsertPopup.js';
import { showMediaInsertPopup as _showMediaInsertPopup } from './mediaInsertPopup.js';
import { showBookmarkInsertPopup as _showBookmarkInsertPopup } from './bookmarkInsertPopup.js';
import {
  getSlashMenuBlocks as _getSlashMenuBlocks,
  getTurnIntoBlocks as _getTurnIntoBlocks,
  getBlockLabel as _getBlockLabel,
  getBlockByName as _getBlockByName,
  BLOCK_REGISTRY as _BLOCK_REGISTRY,
  type InsertActionContext as _InsertActionContext,
  type InsertActionBaseContext as _InsertActionBaseContext,
} from '../config/blockRegistry.js';

// Re-export both context types so menu children (slashMenu.ts) get them
// through their parent registry rather than importing blockRegistry directly.
export type InsertActionContext = _InsertActionContext;
export type InsertActionBaseContext = _InsertActionBaseContext;

// ── Icon Access (registry-to-registry gate) ─────────────────────────────────
// MenuRegistry talks to IconRegistry so that individual menu files never
// import iconRegistry directly.  They import these re-exports from
// canvasMenuRegistry — their single entry point.

import {
  svgIcon as _ir_svgIcon,
  PAGE_SELECTABLE_ICONS as _ir_PAGE_SELECTABLE_ICONS,
} from '../config/iconRegistry.js';

/** @see {@link import('../config/iconRegistry.js').svgIcon} — original source (IconRegistry → here) */
export const svgIcon: (id: string) => string = _ir_svgIcon;

// ── Block Mutation Access (from BlockStateRegistry — source owner) ─────────
// Menu children (blockActionMenu) get mutation helpers through
// canvasMenuRegistry — their single entry point.  These originate in
// blockStateRegistry's child files — we go to the source, not through
// BlockRegistry.

export {
  applyBackgroundColorToBlock,
  applyTextColorToBlock,
  deleteBlockAt,
  duplicateBlockAt,
  turnBlockWithSharedStrategy,
  canTakeTextColor,
  canTakeBackgroundColor,
  canTurnInto,
} from '../config/blockStateRegistry/blockStateRegistry.js';

/** @see {@link import('../config/iconRegistry.js').PAGE_SELECTABLE_ICONS} — original source (IconRegistry → here) */
export const PAGE_SELECTABLE_ICONS: readonly string[] = _ir_PAGE_SELECTABLE_ICONS;

// ── Slash Menu Data (registry-to-child gate) ─────────────────────────────────
// slashMenuItems.ts is a pure data file.  Re-export its types and builder so
// slashMenu.ts imports everything through canvasMenuRegistry — its single gate.

export { buildSlashMenuItems } from './slashMenuItems.js';
export type { SlashMenuItem, SlashBlockDef } from './slashMenuItems.js';

// ── Popup Insert Helpers (menu-child gate) ───────────────────────────────────
// Popup files are menu-layer children.  Re-export them so no file outside the
// menu layer needs to import them directly.  canvasMenuRegistry also injects
// them into InsertActionContext at runtime (see executeBlockInsert).

export { showImageInsertPopup as showImageInsertPopup } from './imageInsertPopup.js';
export { showMediaInsertPopup as showMediaInsertPopup } from './mediaInsertPopup.js';
export { showBookmarkInsertPopup as showBookmarkInsertPopup } from './bookmarkInsertPopup.js';

// ── Color Palette (shared between block-action and bubble color submenus) ───
// Notion-style: same swatches in both surfaces; only the *target* differs
// (whole block vs current text selection).  Centralised here so both menus
// stay visually identical and so adding a colour requires editing one file.

/** A single swatch entry in the colour submenu. */
export interface ColorSwatch {
  /** Visible label. */
  readonly label: string;
  /** The CSS colour string applied to the editor; `null` removes the colour. */
  readonly value: string | null;
  /** The CSS colour shown in the swatch preview (often more saturated than `value`). */
  readonly display: string;
}

/** Text-colour swatches — applied to the `Color` mark or block text colour. */
export const TEXT_COLORS: readonly ColorSwatch[] = [
  { label: 'Default text', value: null,                   display: 'rgba(255,255,255,0.81)' },
  { label: 'Gray text',    value: 'rgb(155,155,155)',     display: 'rgb(155,155,155)' },
  { label: 'Brown text',   value: 'rgb(186,133,83)',      display: 'rgb(186,133,83)' },
  { label: 'Orange text',  value: 'rgb(230,150,60)',      display: 'rgb(230,150,60)' },
  { label: 'Yellow text',  value: 'rgb(223,196,75)',      display: 'rgb(223,196,75)' },
  { label: 'Green text',   value: 'rgb(80,185,120)',      display: 'rgb(80,185,120)' },
  { label: 'Blue text',    value: 'rgb(70,160,230)',      display: 'rgb(70,160,230)' },
  { label: 'Purple text',  value: 'rgb(170,120,210)',     display: 'rgb(170,120,210)' },
  { label: 'Pink text',    value: 'rgb(220,120,170)',     display: 'rgb(220,120,170)' },
  { label: 'Red text',     value: 'rgb(220,80,80)',       display: 'rgb(220,80,80)' },
];

/**
 * Background-colour swatches — applied either as a block `backgroundColor`
 * GlobalAttribute (block-action menu) or as a `Highlight` mark (bubble menu).
 * The `value` is the lower-saturation shade actually painted; `display` is
 * a slightly stronger preview shown in the picker swatch.
 */
export const BG_COLORS: readonly ColorSwatch[] = [
  { label: 'Default background', value: null,                          display: 'transparent' },
  { label: 'Gray background',    value: 'rgba(155,155,155,0.2)',       display: 'rgba(155,155,155,0.35)' },
  { label: 'Brown background',   value: 'rgba(186,133,83,0.2)',        display: 'rgba(186,133,83,0.35)' },
  { label: 'Orange background',  value: 'rgba(230,150,60,0.2)',        display: 'rgba(230,150,60,0.35)' },
  { label: 'Yellow background',  value: 'rgba(223,196,75,0.2)',        display: 'rgba(223,196,75,0.35)' },
  { label: 'Green background',   value: 'rgba(80,185,120,0.2)',        display: 'rgba(80,185,120,0.35)' },
  { label: 'Blue background',    value: 'rgba(70,160,230,0.2)',        display: 'rgba(70,160,230,0.35)' },
  { label: 'Purple background',  value: 'rgba(170,120,210,0.2)',       display: 'rgba(170,120,210,0.35)' },
  { label: 'Pink background',    value: 'rgba(220,120,170,0.2)',       display: 'rgba(220,120,170,0.35)' },
  { label: 'Red background',     value: 'rgba(220,80,80,0.2)',         display: 'rgba(220,80,80,0.35)' },
];

// ── Recent-list helper (Notion parity) ─────────────────────────────────────
// Tiny localStorage-backed MRU list used by slash-menu recents and the colour
// palette Recent section.  Per-device UI state (parity with property-bar
// collapse), not per-workspace.  All errors degrade silently — quota exhaustion
// or disabled storage should never break the canvas.

export interface RecentList {
  /** Return the recents list, newest-first, capped at the max. */
  readonly read: () => string[];
  /** Move `value` to the front of the list (or insert it). */
  readonly record: (value: string) => void;
}

export function createRecentList(key: string, max: number): RecentList {
  const read = (): string[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is string => typeof x === 'string').slice(0, max);
    } catch {
      return [];
    }
  };
  const record = (value: string): void => {
    try {
      const next = [value, ...read().filter(v => v !== value)].slice(0, max);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* localStorage may be unavailable / quota-exceeded — silently degrade */
    }
  };
  return { read, record };
}

// ── Recent colors (Notion parity) ───────────────────────────────────────────
// Each surface (block-level color, inline text color, inline highlight) tracks
// the user's last few picks and surfaces them as a "Recent" mini-section above
// the canonical palette.  `null` (= "Default …") is never recorded.

const RECENT_COLOR_MAX = 3;
const _recentTextColors = createRecentList('parallx-canvas-recent-text-colors', RECENT_COLOR_MAX);
const _recentBgColors = createRecentList('parallx-canvas-recent-bg-colors', RECENT_COLOR_MAX);

export type ColorKind = 'text' | 'bg';

function _recentColorList(kind: ColorKind): RecentList {
  return kind === 'text' ? _recentTextColors : _recentBgColors;
}

/**
 * Record that the user just applied a colour.  `null` (Default) is ignored —
 * "I want to clear the colour" is not interesting to surface as a recent.
 */
export function recordRecentColor(kind: ColorKind, value: string | null): void {
  if (value === null) return;
  _recentColorList(kind).record(value);
}

/**
 * Resolved recent swatches (newest-first), filtered against the canonical
 * palette so stale or unknown values are dropped.
 */
export function getRecentColors(kind: ColorKind): ColorSwatch[] {
  const palette = kind === 'text' ? TEXT_COLORS : BG_COLORS;
  const out: ColorSwatch[] = [];
  for (const v of _recentColorList(kind).read()) {
    const swatch = palette.find(c => c.value === v);
    if (swatch) out.push(swatch);
  }
  return out;
}

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

export type CanvasMenuHost = SlashMenuHost & BubbleMenuHost & BlockActionMenuHost & IconMenuHost & CoverMenuHost & InlineMathEditorHost & InlineAIChatHost;

// Re-export AI chat types so canvasEditorProvider imports them through the registry gate
export type { SendChatRequestFn, RetrieveContextFn } from './inlineAIChat.js';

// ── Registry ────────────────────────────────────────────────────────────────

export class CanvasMenuRegistry {
  private readonly _menus = new Map<string, ICanvasMenu>();
  private readonly _getEditor: () => Editor | null;
  private _iconMenu: IconMenuController | null = null;
  private _coverMenu: CoverMenuController | null = null;
  private _inlineMathEditor: InlineMathEditorController | null = null;
  private _aiChat: InlineAIChatController | null = null;
  private _contextMenuGestureUntil = 0;

  // Bound once so we can remove the same reference on dispose.
  private readonly _onDocMousedown = (e: MouseEvent): void => {
    // When an incompatible interaction is active (drag handle, column resize,
    // or block dragging), skip outside-click processing entirely.  Each
    // interaction handler manages menu visibility itself.
    if (this.isInteractionLocked()) return;

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

    // InlineAIChatController is created lazily via createAIChat() after
    // the AI provider is available — not in this factory.

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

  /**
   * Mark that the current selection update cycle was initiated by a
   * right-click/context-menu gesture, not by an intentional text selection.
   *
   * Selection-driven menus (bubble / inline AI) should stay hidden while this
   * short-lived flag is active so the editable spellcheck menu is the only menu
   * that opens for right-click on a misspelled word.
   */
  markContextMenuGesture(): void {
    this._contextMenuGestureUntil = Date.now() + 1000;
    this.hideAll();
  }

  /** Clear the transient right-click/context-menu gesture flag. */
  clearContextMenuGesture(): void {
    this._contextMenuGestureUntil = 0;
  }

  /**
   * `true` while a recent right-click/context-menu gesture is still active.
   *
   * The flag auto-expires after a short timeout so normal selection-driven
   * menus resume without requiring explicit cleanup from every code path.
   */
  isContextMenuGestureActive(): boolean {
    if (this._contextMenuGestureUntil === 0) return false;
    if (Date.now() > this._contextMenuGestureUntil) {
      this._contextMenuGestureUntil = 0;
      return false;
    }
    return true;
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

  // ── Inline AI Chat ──────────────────────────────────────────────────────

  /**
   * Create the inline AI chat controller.  Called from canvasEditorProvider
   * after the chat tool's AI provider has been registered.
   */
  createAIChat(
    host: InlineAIChatHost,
    sendChatRequest: SendChatRequestFn,
    retrieveContext?: RetrieveContextFn,
  ): void {
    if (this._aiChat) return;
    const chat = new InlineAIChatController(host, this, sendChatRequest, retrieveContext);
    chat.create();
    this._aiChat = chat;
  }

  /** Toggle the inline AI chat (called by the bubble menu ✨ button). */
  toggleAIChat(): void {
    this._aiChat?.toggle();
  }

  /** Whether the inline AI chat is currently visible. */
  isAIChatVisible(): boolean {
    return this._aiChat?.visible ?? false;
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
    context: _InsertActionBaseContext,
  ): Promise<void> {
    const def = _BLOCK_REGISTRY.get(blockId);
    if (!def) return;

    if (def.insertAction) {
      // Augment base context with popup helpers to build the full
      // InsertActionContext.  This is the compile-time guarantee:
      // InsertActionContext requires all three popup fields, and
      // this is the single place that provides them.
      const fullContext: _InsertActionContext = {
        ...context,
        showImageInsertPopup: _showImageInsertPopup,
        showMediaInsertPopup: _showMediaInsertPopup,
        showBookmarkInsertPopup: _showBookmarkInsertPopup,
      };
      await def.insertAction(editor, range, fullContext);
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
