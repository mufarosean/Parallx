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
import { $, layoutPopup } from '../../../ui/dom.js';
import { svgIcon } from '../canvasIcons.js';
import {
  applyBackgroundColorToBlock,
  applyTextColorToBlock,
  deleteBlockAt,
  duplicateBlockAt,
  turnBlockWithSharedStrategy,
} from '../mutations/blockMutations.js';
import { getBlockLabel, getTurnIntoBlocks } from '../config/blockRegistry.js';
import type { ICanvasMenu } from './canvasMenuRegistry.js';
import type { CanvasMenuRegistry } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ── Host Interface ──────────────────────────────────────────────────────────

export interface BlockActionMenuHost {
  readonly editor: Editor | null;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class BlockActionMenuController implements ICanvasMenu {
  readonly id = 'block-action-menu';
  // DOM elements
  private _blockActionMenu: HTMLElement | null = null;
  private _turnIntoSubmenu: HTMLElement | null = null;
  private _colorSubmenu: HTMLElement | null = null;

  // Timers
  private _turnIntoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private _colorHideTimer: ReturnType<typeof setTimeout> | null = null;

  // Action target
  private _actionBlockPos: number = -1;
  private _actionBlockNode: any = null;

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
  show(pos: number, node: any, anchor: DOMRect, anchorEl?: HTMLElement): void {
    this._actionBlockPos = pos;
    this._actionBlockNode = node;
    this._anchorEl = anchorEl ?? null;
    this._showBlockActionMenu(anchor);
    this._registry.notifyShow(this.id);
  }

  hide(): void {
    this._hideBlockActionMenu();
  }

  // ── Block Action Menu ───────────────────────────────────────────────────

  private _showBlockActionMenu(anchor: DOMRect): void {
    if (!this._blockActionMenu || !this._actionBlockNode) return;
    this._blockActionMenu.innerHTML = '';

    // Header — block type label
    const header = $('div.block-action-header');
    header.textContent = getBlockLabel(this._actionBlockNode.type.name);
    this._blockActionMenu.appendChild(header);

    // Turn into
    const turnIntoSvg = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 7C13 4.24 10.76 2 8 2C5.24 2 3 4.24 3 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M3 9C3 11.76 5.24 14 8 14C10.76 14 13 11.76 13 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M1 7L3 5L5 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 9L13 11L11 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const turnIntoItem = this._createActionItem('Turn into', turnIntoSvg, true);
    turnIntoItem.addEventListener('mouseenter', () => {
      if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
      this._showTurnIntoSubmenu(turnIntoItem);
    });
    turnIntoItem.addEventListener('mouseleave', (e) => {
      const related = e.relatedTarget as HTMLElement;
      if (!this._turnIntoSubmenu?.contains(related)) {
        this._turnIntoHideTimer = setTimeout(() => this._hideTurnIntoSubmenu(), 200);
      }
    });
    this._blockActionMenu.appendChild(turnIntoItem);

    // Color
    const colorSvg = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><text x="3" y="11" font-size="11" font-weight="700" fill="currentColor" font-family="sans-serif">A</text><rect x="2" y="13" width="12" height="2" rx="0.5" fill="currentColor" opacity="0.5"/></svg>';
    const colorItem = this._createActionItem('Color', colorSvg, true);
    colorItem.addEventListener('mouseenter', () => {
      if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
      this._showColorSubmenu(colorItem);
    });
    colorItem.addEventListener('mouseleave', (e) => {
      const related = e.relatedTarget as HTMLElement;
      if (!this._colorSubmenu?.contains(related)) {
        this._colorHideTimer = setTimeout(() => this._hideColorSubmenu(), 200);
      }
    });
    this._blockActionMenu.appendChild(colorItem);

    // Separator
    this._blockActionMenu.appendChild($('div.block-action-separator'));

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
      this._turnIntoSubmenu.addEventListener('mouseenter', () => {
        if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
      });
      this._turnIntoSubmenu.addEventListener('mouseleave', (e) => {
        const related = (e as MouseEvent).relatedTarget as HTMLElement;
        if (!this._blockActionMenu?.contains(related)) {
          this._turnIntoHideTimer = setTimeout(() => this._hideTurnIntoSubmenu(), 200);
        }
      });
      document.body.appendChild(this._turnIntoSubmenu);
    }
    this._turnIntoSubmenu.innerHTML = '';

    const turnIntoBlocks = getTurnIntoBlocks();

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
    if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
    if (this._turnIntoSubmenu) this._turnIntoSubmenu.style.display = 'none';
  }

  // ── Color Submenu ───────────────────────────────────────────────────────

  private _showColorSubmenu(anchor: HTMLElement): void {
    this._hideTurnIntoSubmenu();
    if (!this._colorSubmenu) {
      this._colorSubmenu = $('div.block-action-submenu.block-color-submenu');
      this._colorSubmenu.addEventListener('mouseenter', () => {
        if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
      });
      this._colorSubmenu.addEventListener('mouseleave', (e) => {
        const related = (e as MouseEvent).relatedTarget as HTMLElement;
        if (!this._blockActionMenu?.contains(related)) {
          this._colorHideTimer = setTimeout(() => this._hideColorSubmenu(), 200);
        }
      });
      document.body.appendChild(this._colorSubmenu);
    }
    this._colorSubmenu.innerHTML = '';

    // Text color section
    const textHeader = $('div.block-color-section-header');
    textHeader.textContent = 'Text color';
    this._colorSubmenu.appendChild(textHeader);

    const textColors = [
      { label: 'Default text', value: null, display: 'rgba(255,255,255,0.81)' },
      { label: 'Gray text', value: 'rgb(155,155,155)', display: 'rgb(155,155,155)' },
      { label: 'Brown text', value: 'rgb(186,133,83)', display: 'rgb(186,133,83)' },
      { label: 'Orange text', value: 'rgb(230,150,60)', display: 'rgb(230,150,60)' },
      { label: 'Yellow text', value: 'rgb(223,196,75)', display: 'rgb(223,196,75)' },
      { label: 'Green text', value: 'rgb(80,185,120)', display: 'rgb(80,185,120)' },
      { label: 'Blue text', value: 'rgb(70,160,230)', display: 'rgb(70,160,230)' },
      { label: 'Purple text', value: 'rgb(170,120,210)', display: 'rgb(170,120,210)' },
      { label: 'Pink text', value: 'rgb(220,120,170)', display: 'rgb(220,120,170)' },
      { label: 'Red text', value: 'rgb(220,80,80)', display: 'rgb(220,80,80)' },
    ];

    for (const color of textColors) {
      const row = $('div.block-color-item');
      const swatch = $('span.block-color-swatch');
      swatch.textContent = 'A';
      swatch.style.color = color.display;
      row.appendChild(swatch);
      const label = $('span.block-action-label');
      label.textContent = color.label;
      row.appendChild(label);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._applyBlockTextColor(color.value); });
      this._colorSubmenu!.appendChild(row);
    }

    // Separator
    this._colorSubmenu.appendChild($('div.block-action-separator'));

    // Background color section
    const bgHeader = $('div.block-color-section-header');
    bgHeader.textContent = 'Background color';
    this._colorSubmenu.appendChild(bgHeader);

    const bgColors = [
      { label: 'Default background', value: null, display: 'transparent' },
      { label: 'Gray background', value: 'rgba(155,155,155,0.2)', display: 'rgba(155,155,155,0.35)' },
      { label: 'Brown background', value: 'rgba(186,133,83,0.2)', display: 'rgba(186,133,83,0.35)' },
      { label: 'Orange background', value: 'rgba(230,150,60,0.2)', display: 'rgba(230,150,60,0.35)' },
      { label: 'Yellow background', value: 'rgba(223,196,75,0.2)', display: 'rgba(223,196,75,0.35)' },
      { label: 'Green background', value: 'rgba(80,185,120,0.2)', display: 'rgba(80,185,120,0.35)' },
      { label: 'Blue background', value: 'rgba(70,160,230,0.2)', display: 'rgba(70,160,230,0.35)' },
      { label: 'Purple background', value: 'rgba(170,120,210,0.2)', display: 'rgba(170,120,210,0.35)' },
      { label: 'Pink background', value: 'rgba(220,120,170,0.2)', display: 'rgba(220,120,170,0.35)' },
      { label: 'Red background', value: 'rgba(220,80,80,0.2)', display: 'rgba(220,80,80,0.35)' },
    ];

    for (const color of bgColors) {
      const row = $('div.block-color-item');
      const swatch = $('span.block-color-swatch');
      if (color.value) {
        swatch.style.backgroundColor = color.display;
      } else {
        swatch.style.border = '1px solid rgba(255,255,255,0.2)';
      }
      row.appendChild(swatch);
      const label = $('span.block-action-label');
      label.textContent = color.label;
      row.appendChild(label);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._applyBlockBgColor(color.value); });
      this._colorSubmenu!.appendChild(row);
    }

    // Position to the right of anchor
    const rect = anchor.getBoundingClientRect();
    this._colorSubmenu.style.display = 'block';
    layoutPopup(this._colorSubmenu, rect, { position: 'right', gap: 2 });
  }

  private _hideColorSubmenu(): void {
    if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
    if (this._colorSubmenu) this._colorSubmenu.style.display = 'none';
  }

  // ── Block Transform Execution ──────────────────────────────────────────

  private _turnBlockInto(targetType: string, attrs?: any): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    if (this._isCurrentBlockType(targetType, attrs)) return;

    turnBlockWithSharedStrategy(editor, pos, node, targetType, attrs);
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
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    applyTextColorToBlock(editor, pos, node, value);
  }

  private _applyBlockBgColor(value: string | null): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    applyBackgroundColorToBlock(editor, pos, node, value);
  }

  // ── Duplicate / Delete ─────────────────────────────────────────────────

  private _duplicateBlock(): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    duplicateBlockAt(editor, pos, node);
    editor.commands.focus();
  }

  private _deleteBlock(): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    deleteBlockAt(editor, pos, node);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────


  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    this._registration?.dispose();
    this._registration = null;
    if (this._turnIntoHideTimer) {
      clearTimeout(this._turnIntoHideTimer);
      this._turnIntoHideTimer = null;
    }
    if (this._colorHideTimer) {
      clearTimeout(this._colorHideTimer);
      this._colorHideTimer = null;
    }
    if (this._blockActionMenu) { this._blockActionMenu.remove(); this._blockActionMenu = null; }
    if (this._turnIntoSubmenu) { this._turnIntoSubmenu.remove(); this._turnIntoSubmenu = null; }
    if (this._colorSubmenu) { this._colorSubmenu.remove(); this._colorSubmenu = null; }
    this._actionBlockNode = null;
    this._anchorEl = null;
  }
}
