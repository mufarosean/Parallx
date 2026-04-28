// blockActionMenu.ts — Block Action Menu controller
//
// Extracted from blockHandles.ts.  Owns:
//   • Block action menu DOM (turn-into, color, duplicate, delete)
//   • Turn-Into submenu with block types from the registry
//   • Color submenu (10 text colours + 10 background colours)
//
// Outside-click dismissal is handled centrally by CanvasMenuRegistry.
//
// Triggered by BlockHandlesController via show(pos, node, anchorRect).
// Lives in menus/ alongside BubbleMenuController and SlashMenuController.

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { $, layoutPopup } from '../../../ui/dom.js';
import { getIcon } from '../../../ui/iconRegistry.js';
import {
  svgIcon,
  applyBackgroundColorToBlock,
  applyTextColorToBlock,
  deleteBlockAt,
  duplicateBlockAt,
  turnBlockWithSharedStrategy,
  canTakeTextColor,
  canTakeBackgroundColor,
  canTurnInto,
  recordRecentColor,
  renderColorPalette,
} from './canvasMenuRegistry.js';
import type { ICanvasMenu } from './canvasMenuRegistry.js';
import type { CanvasMenuRegistry } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ── Host Interface ──────────────────────────────────────────────────────────

/**
 * Minimal structural view of the multi-block selection controller used by
 * the action menu. Declared inline (not imported from handles/) to keep
 * blockActionMenu.ts gate-compliant — menus must not import from handles/
 * directly. The full controller in handles/blockSelection.ts satisfies
 * this shape.
 */
export interface IMenuBlockSelection {
  readonly hasSelection: boolean;
  readonly positions: number[];
  clear(): void;
  deleteSelected(): void;
  duplicateSelected(): void;
}

export interface BlockActionMenuHost {
  readonly editor: Editor | null;
  /**
   * Optional multi-block selection controller. When the action-menu's
   * anchor block is part of an active selection, actions (delete,
   * duplicate, turn-into, color) apply to every selected block instead
   * of just the anchor — matching the visual highlight users see.
   */
  readonly blockSelection?: IMenuBlockSelection;
}

// ── Submenu hover-handoff helper ────────────────────────────────────────────

/**
 * Standard "hover from action item → submenu → back to parent menu"
 * handoff with a small grace timer so the submenu doesn't snap shut
 * while the cursor crosses the gap between menu and submenu.
 *
 * Wired in two halves so the trigger item and lazily-created submenu
 * each get their own listeners but share one timer.
 */
class SubmenuHoverHandoff {
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly _parentMenu: () => HTMLElement | null,
    private readonly _submenu: () => HTMLElement | null,
    private readonly _onHide: () => void,
    private readonly _delayMs: number = 200,
  ) {}

  cancel(): void {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  private _scheduleHide(): void {
    this.cancel();
    this._timer = setTimeout(() => this._onHide(), this._delayMs);
  }

  /** Cancel timer on enter, show via callback. Schedule hide on leave unless leaving toward the submenu. */
  wireTrigger(item: HTMLElement, onShow: () => void): void {
    item.addEventListener('mouseenter', () => {
      this.cancel();
      onShow();
    });
    item.addEventListener('mouseleave', (event) => {
      const related = event.relatedTarget as HTMLElement | null;
      if (!this._submenu()?.contains(related)) this._scheduleHide();
    });
  }

  /** Cancel timer on submenu enter. Schedule hide on leave unless leaving toward the parent menu. */
  wireSubmenu(submenu: HTMLElement): void {
    submenu.addEventListener('mouseenter', () => this.cancel());
    submenu.addEventListener('mouseleave', (event) => {
      const related = (event as MouseEvent).relatedTarget as HTMLElement | null;
      if (!this._parentMenu()?.contains(related)) this._scheduleHide();
    });
  }

  dispose(): void {
    this.cancel();
  }
}

// ── Controller ──────────────────────────────────────────────────────────────

export class BlockActionMenuController implements ICanvasMenu {
  readonly id = 'block-action-menu';
  // DOM elements
  private _blockActionMenu: HTMLElement | null = null;
  private _turnIntoSubmenu: HTMLElement | null = null;
  private _colorSubmenu: HTMLElement | null = null;

  // Submenu hover handoff (cancel timer on enter, delayed hide on leave)
  private readonly _turnIntoHover = new SubmenuHoverHandoff(
    () => this._blockActionMenu,
    () => this._turnIntoSubmenu,
    () => this._hideTurnIntoSubmenu(),
  );
  private readonly _colorHover = new SubmenuHoverHandoff(
    () => this._blockActionMenu,
    () => this._colorSubmenu,
    () => this._hideColorSubmenu(),
  );

  // Action target
  private _actionBlockPos: number = -1;
  private _actionBlockNode: PMNode | null = null;

  /**
   * External element that should NOT trigger outside-click dismissal
   * (the drag handle that opened the menu).
   */
  private _anchorEl: HTMLElement | null = null;
  private _registration: IDisposable | null = null;

  constructor(
    private readonly _host: BlockActionMenuHost,
    private readonly _registry: CanvasMenuRegistry,
  ) {}

  // ── Setup / Lifecycle ─────────────────────────────────────────────────

  create(): void {
    this._blockActionMenu = $('div.block-action-menu');
    this._blockActionMenu.style.display = 'none';
    document.body.appendChild(this._blockActionMenu);
    this._registration = this._registry.register(this);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** The block-action-menu element (for outside-click checks). */
  get menu(): HTMLElement | null { return this._blockActionMenu; }

  /** Whether the menu is currently visible. */
  get visible(): boolean {
    return this._blockActionMenu?.style.display === 'block';
  }

  /** DOM containment check for centralized outside-click handling. */
  containsTarget(target: Node): boolean {
    if (this._blockActionMenu?.contains(target)) return true;
    if (this._turnIntoSubmenu?.contains(target)) return true;
    if (this._colorSubmenu?.contains(target)) return true;
    if (this._anchorEl?.contains(target)) return true;
    return false;
  }

  /**
   * Show the block action menu for the given block.
   *
   * @param pos    — Absolute ProseMirror position of the block node
   * @param node   — The ProseMirror node at that position
   * @param anchor — Bounding rect to position the menu below (typically the drag handle)
   * @param anchorEl — The anchor DOM element (excluded from outside-click dismissal)
   */
  show(pos: number, node: PMNode, anchor: DOMRect, anchorEl?: HTMLElement): void {
    this._actionBlockPos = pos;
    this._actionBlockNode = node;
    this._anchorEl = anchorEl ?? null;
    this._showBlockActionMenu(anchor);
    this._registry.notifyShow(this.id);
  }

  hide(): void {
    this._hideBlockActionMenu();
  }

  // ── Transaction-based staleness detection ─────────────────────────────

  /**
   * Called on every editor transaction via CanvasMenuRegistry dispatch.
   * If the menu is visible and the document changed, verify that the node
   * at the stored position still matches expectations.  If not, close the
   * menu — the user must re-click the handle to get a fresh snapshot.
   */
  onTransaction(editor: Editor): void {
    if (!this.visible) return;
    if (this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const node = editor.state.doc.nodeAt(this._actionBlockPos);
    if (!node || node.type.name !== this._actionBlockNode.type.name) {
      this.hide();
    }
  }

  /**
   * Safety-net revalidation called at the start of every action method.
   * Returns `true` if the stored pos/node are still valid.  On mismatch
   * (doc was mutated between show() and action click), hides the menu and
   * returns `false` so the caller can bail out.
   *
   * When valid, refreshes `_actionBlockNode` with the current node so
   * downstream code sees up-to-date attrs (e.g. after a color was applied
   * and the user re-opens the menu quickly).
   */
  private _revalidateActionBlock(): boolean {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return false;
    const node = editor.state.doc.nodeAt(this._actionBlockPos);
    if (!node || node.type.name !== this._actionBlockNode.type.name) {
      this._hideBlockActionMenu();
      return false;
    }
    // Refresh snapshot so downstream reads current attrs/content
    this._actionBlockNode = node;
    return true;
  }

  // ── Block Action Menu ───────────────────────────────────────────────────

  private _showBlockActionMenu(anchor: DOMRect): void {
    if (!this._blockActionMenu || !this._actionBlockNode) return;
    this._blockActionMenu.innerHTML = '';

    // Header — block type label (or batch count when multi-selection is
    // active and the anchor is part of it).  Gives users immediate visual
    // confirmation that subsequent actions will apply to all selected
    // blocks, not just the one whose handle they clicked.
    const sel = this._host.blockSelection;
    const isBatch = !!sel?.hasSelection
      && sel.positions.length > 1
      && sel.positions.includes(this._actionBlockPos);
    const header = $('div.block-action-header');
    header.textContent = isBatch
      ? `${sel!.positions.length} blocks selected`
      : this._registry.labelForBlockType(this._actionBlockNode.type.name);
    this._blockActionMenu.appendChild(header);

    // ── Notion parity: capability filtering ──
    // Build the per-row "should I show this row?" answers up-front from
    // the active target set (single-block or multi-block).  An action row
    // is shown iff at least one targeted block supports it.  Inside each
    // action's batch loop we additionally skip blocks that can't take
    // that specific operation (e.g. divider in a colour bulk-apply).
    const targetTypes = this._collectTargetTypeNames();
    const showTurnInto = targetTypes.some(t => canTurnInto(t));
    const showAnyColor =
      targetTypes.some(t => canTakeTextColor(t)) ||
      targetTypes.some(t => canTakeBackgroundColor(t));

    // Turn into
    if (showTurnInto) {
      const turnIntoSvg = getIcon('refresh')!;
      const turnIntoItem = this._createActionItem('Turn into', turnIntoSvg, true);
      this._turnIntoHover.wireTrigger(turnIntoItem, () => this._showTurnIntoSubmenu(turnIntoItem));
      this._blockActionMenu.appendChild(turnIntoItem);
    }

    // Color
    if (showAnyColor) {
      const colorSvg = getIcon('color')!;
      const colorItem = this._createActionItem('Color', colorSvg, true);
      this._colorHover.wireTrigger(colorItem, () => this._showColorSubmenu(colorItem));
      this._blockActionMenu.appendChild(colorItem);
    }

    // Separator — only when at least one capability-row is present
    if (showTurnInto || showAnyColor) {
      this._blockActionMenu.appendChild($('div.block-action-separator'));
    }

    // Duplicate
    const dupItem = this._createActionItem('Duplicate', svgIcon('duplicate'), false, 'Ctrl+D');
    dupItem.addEventListener('mousedown', (e) => { e.preventDefault(); this._duplicateBlock(); });
    this._blockActionMenu.appendChild(dupItem);

    // Delete
    const delItem = this._createActionItem('Delete', svgIcon('trash'), false, 'Del');
    delItem.classList.add('block-action-item--danger');
    delItem.addEventListener('mousedown', (e) => { e.preventDefault(); this._deleteBlock(); });
    this._blockActionMenu.appendChild(delItem);

    // Position below anchor
    this._blockActionMenu.style.display = 'block';
    layoutPopup(this._blockActionMenu, anchor, { position: 'below', gap: 4 });
  }

  private _hideBlockActionMenu(): void {
    if (!this._blockActionMenu) return;
    this._blockActionMenu.style.display = 'none';
    this._hideTurnIntoSubmenu();
    this._hideColorSubmenu();
  }

  private _createActionItem(label: string, iconHtml: string, hasSubmenu: boolean, shortcut?: string): HTMLElement {
    const item = $('div.block-action-item');
    const iconEl = $('span.block-action-icon');
    iconEl.innerHTML = iconHtml;
    const svg = iconEl.querySelector('svg');
    if (svg && !svg.getAttribute('width')) { svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); }
    item.appendChild(iconEl);
    const labelEl = $('span.block-action-label');
    labelEl.textContent = label;
    item.appendChild(labelEl);
    if (shortcut) {
      const sc = $('span.block-action-shortcut');
      sc.textContent = shortcut;
      item.appendChild(sc);
    }
    if (hasSubmenu) {
      const arrow = $('span.block-action-arrow');
      arrow.innerHTML = svgIcon('chevron-right');
      const chevSvg = arrow.querySelector('svg');
      if (chevSvg) { chevSvg.setAttribute('width', '12'); chevSvg.setAttribute('height', '12'); }
      item.appendChild(arrow);
    }
    return item;
  }

  // ── Turn Into Submenu ───────────────────────────────────────────────────

  private _showTurnIntoSubmenu(anchor: HTMLElement): void {
    this._hideColorSubmenu();
    if (!this._turnIntoSubmenu) {
      this._turnIntoSubmenu = $('div.block-action-submenu');
      this._turnIntoHover.wireSubmenu(this._turnIntoSubmenu);
      document.body.appendChild(this._turnIntoSubmenu);
    }
    this._turnIntoSubmenu.innerHTML = '';

    const turnIntoBlocks = this._registry.getTurnIntoBlocks();

    for (const def of turnIntoBlocks) {
      const row = $('div.block-action-item');
      const iconEl = $('span.block-action-icon');
      if (def.iconIsText) {
        iconEl.textContent = def.icon;
        iconEl.classList.add('block-action-icon--text');
      } else {
        iconEl.innerHTML = svgIcon(def.icon as any);
        const isvg = iconEl.querySelector('svg');
        if (isvg) { isvg.setAttribute('width', '16'); isvg.setAttribute('height', '16'); }
      }
      row.appendChild(iconEl);
      const labelEl = $('span.block-action-label');
      labelEl.textContent = def.label;
      row.appendChild(labelEl);
      if (def.turnInto?.shortcut) {
        const sc = $('span.block-action-shortcut');
        sc.textContent = def.turnInto.shortcut;
        row.appendChild(sc);
      }
      if (this._isCurrentBlockType(def.name, def.defaultAttrs)) {
        const check = $('span.block-action-check');
        check.textContent = '\u2713';
        row.appendChild(check);
      }
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._turnBlockInto(def.name, def.defaultAttrs); });
      this._turnIntoSubmenu!.appendChild(row);
    }

    // Position to the right of anchor
    const rect = anchor.getBoundingClientRect();
    this._turnIntoSubmenu.style.display = 'block';
    layoutPopup(this._turnIntoSubmenu, rect, { position: 'right', gap: 2 });
  }

  private _hideTurnIntoSubmenu(): void {
    this._turnIntoHover.cancel();
    if (this._turnIntoSubmenu) this._turnIntoSubmenu.style.display = 'none';
  }

  // ── Color Submenu ───────────────────────────────────────────────────────

  private _showColorSubmenu(anchor: HTMLElement): void {
    this._hideTurnIntoSubmenu();
    if (!this._colorSubmenu) {
      this._colorSubmenu = $('div.block-action-submenu.block-color-submenu');
      this._colorHover.wireSubmenu(this._colorSubmenu);
      document.body.appendChild(this._colorSubmenu);
    }
    this._colorSubmenu.innerHTML = '';

    // Notion parity: hide entire color sections when none of the targeted
    // blocks support that section.  E.g. selection of dividers + a heading
    // → no text color section; selection of headings + image → only Text
    // color shown because images can't take backgroundColor.
    const targetTypes = this._collectTargetTypeNames();
    const showText = targetTypes.some(t => canTakeTextColor(t));
    const showBg = targetTypes.some(t => canTakeBackgroundColor(t));

    renderColorPalette(this._colorSubmenu, {
      showText,
      showBg,
      onPick: (kind, value) => {
        if (kind === 'text') this._applyBlockTextColor(value);
        else this._applyBlockBgColor(value);
      },
    });

    // Position to the right of anchor
    const rect = anchor.getBoundingClientRect();
    this._colorSubmenu.style.display = 'block';
    layoutPopup(this._colorSubmenu, rect, { position: 'right', gap: 2 });
  }

  private _hideColorSubmenu(): void {
    this._colorHover.cancel();
    if (this._colorSubmenu) this._colorSubmenu.style.display = 'none';
  }

  // ── Block Transform Execution ──────────────────────────────────────────

  /**
   * If the anchor block is part of an active multi-block selection,
   * return positions sorted DESCENDING (so callers can mutate end-first
   * and keep earlier positions valid). Otherwise return a single-element
   * array with just the anchor position.
   *
   * Resolves the inconsistency where users would highlight N blocks via
   * marquee/shift-click, click the drag handle of one to open the menu,
   * and then see the action only affect the anchor block.
   */
  private _resolveTargetPositionsDesc(): number[] {
    const sel = this._host.blockSelection;
    if (sel?.hasSelection && sel.positions.includes(this._actionBlockPos)) {
      return [...sel.positions].sort((a, b) => b - a);
    }
    return [this._actionBlockPos];
  }

  /**
   * Collect node-type names of every block targeted by the current menu.
   * Mirrors `_resolveTargetPositionsDesc` but returns *types*, used by
   * the menu render path to decide which capability rows / submenu
   * sections to show.  Resolves names from the LIVE doc so that if a
   * batch operation has already changed some types, we re-derive them
   * fresh on the next render.
   */
  private _collectTargetTypeNames(): string[] {
    if (!this._actionBlockNode) return [];
    const editor = this._host.editor;
    const sel = this._host.blockSelection;
    if (!editor || !sel?.hasSelection || !sel.positions.includes(this._actionBlockPos)) {
      return [this._actionBlockNode.type.name];
    }
    const out: string[] = [];
    for (const p of sel.positions) {
      const n = editor.state.doc.nodeAt(p);
      if (n) out.push(n.type.name);
    }
    return out;
  }

  private _turnBlockInto(targetType: string, attrs?: any): void {
    if (!this._revalidateActionBlock()) return;
    const editor = this._host.editor!;
    const positions = this._resolveTargetPositionsDesc();
    const anchorNode = this._actionBlockNode;
    this._hideBlockActionMenu();

    // Single-block fast path preserves existing no-op-on-same-type behavior.
    if (positions.length === 1) {
      if (this._isCurrentBlockType(targetType, attrs)) return;
      turnBlockWithSharedStrategy(editor, positions[0], anchorNode, targetType, attrs);
      this._host.blockSelection?.clear();
      return;
    }

    // Batch: iterate descending, re-resolving each node from CURRENT state.
    // Each turnBlockWithSharedStrategy dispatches its own transaction and
    // may change nodeSize, but lower positions remain valid because we
    // process from end to start. Notion parity: silently skip blocks
    // whose type can't be a turn-into source (image, divider, etc.).
    for (const pos of positions) {
      const node = editor.state.doc.nodeAt(pos);
      if (!node) continue;
      if (!canTurnInto(node.type.name)) continue;
      if (node.type.name === targetType) {
        if (targetType !== 'heading') continue;
        if (attrs?.level && node.attrs?.level === attrs.level) continue;
      }
      turnBlockWithSharedStrategy(editor, pos, node, targetType, attrs);
    }
    this._host.blockSelection?.clear();
  }

  private _isCurrentBlockType(targetType: string, attrs?: any): boolean {
    if (!this._actionBlockNode) return false;
    const node = this._actionBlockNode;
    if (node.type.name !== targetType) return false;
    if (targetType === 'heading' && attrs?.level && node.attrs?.level !== attrs.level) return false;
    return true;
  }

  // ── Color Application ──────────────────────────────────────────────────

  private _applyBlockTextColor(value: string | null): void {
    if (!this._revalidateActionBlock()) return;
    const editor = this._host.editor!;
    const positions = this._resolveTargetPositionsDesc();
    this._hideBlockActionMenu();
    // Text/bg color ops don't change nodeSize, so descending order is safe
    // and re-resolving the node from current state is a defensive no-op.
    // Notion parity: skip blocks whose type can't take a text-color mark.
    for (const pos of positions) {
      const node = editor.state.doc.nodeAt(pos);
      if (!node) continue;
      if (!canTakeTextColor(node.type.name)) continue;
      applyTextColorToBlock(editor, pos, node, value);
    }
    recordRecentColor('text', value);
  }

  private _applyBlockBgColor(value: string | null): void {
    if (!this._revalidateActionBlock()) return;
    const editor = this._host.editor!;
    const positions = this._resolveTargetPositionsDesc();
    this._hideBlockActionMenu();
    for (const pos of positions) {
      const node = editor.state.doc.nodeAt(pos);
      if (!node) continue;
      if (!canTakeBackgroundColor(node.type.name)) continue;
      applyBackgroundColorToBlock(editor, pos, node, value);
    }
    recordRecentColor('bg', value);
  }

  // ── Duplicate / Delete ─────────────────────────────────────────────────

  private _duplicateBlock(): void {
    if (!this._revalidateActionBlock()) return;
    const editor = this._host.editor!;
    const sel = this._host.blockSelection;
    const useBatch = sel?.hasSelection && sel.positions.includes(this._actionBlockPos);
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode!;
    this._hideBlockActionMenu();
    if (useBatch && sel) {
      // Reuse the controller's batched, position-aware implementation.
      sel.duplicateSelected();
    } else {
      duplicateBlockAt(editor, pos, node);
    }
    editor.commands.focus();
  }

  private _deleteBlock(): void {
    if (!this._revalidateActionBlock()) return;
    const editor = this._host.editor!;
    const sel = this._host.blockSelection;
    const useBatch = sel?.hasSelection && sel.positions.includes(this._actionBlockPos);
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode!;
    this._hideBlockActionMenu();
    if (useBatch && sel) {
      sel.deleteSelected();
    } else {
      deleteBlockAt(editor, pos, node);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────


  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    this._registration?.dispose();
    this._registration = null;
    this._turnIntoHover.dispose();
    this._colorHover.dispose();
    if (this._blockActionMenu) { this._blockActionMenu.remove(); this._blockActionMenu = null; }
    if (this._turnIntoSubmenu) { this._turnIntoSubmenu.remove(); this._turnIntoSubmenu = null; }
    if (this._colorSubmenu) { this._colorSubmenu.remove(); this._colorSubmenu = null; }
    this._actionBlockNode = null;
    this._anchorEl = null;
  }
}
