// tableActionMenu.ts — the command door for a table row, column, or the table
//
// Opened by the grips in handles/tableControls.ts.  Deliberately built from
// the SAME `.block-action-*` vocabulary as the block action menu: one menu
// language on the canvas, so a row menu and a block menu are recognisably the
// same kind of object.
//
// Every item here is a call into tableOps.ts — the grips, this menu, and the
// table keyboard policy are three doors onto one set of operations, never
// three implementations of them.
//
// The targeting contract: the caller has ALREADY put a visible CellSelection
// on the row / column / table before opening this menu (Notion does the same),
// so every command reads `state.selection` and needs no coordinates.

import type { Editor } from '@tiptap/core';
import { $, attachPopupDismiss, layoutPopup } from '../../../ui/dom.js';
import {
  svgIcon,
  clearSelectedCells,
  duplicateColumn,
  duplicateRow,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  mergeSelectedCells,
  moveColumnBy,
  moveRowBy,
  removeColumn,
  removeRow,
  removeTable,
  splitSelectedCell,
  tableFrameAt,
  toggleHeaderColumnOp,
  toggleHeaderRowOp,
  canMergeCells,
  canSplitCell,
} from './canvasMenuRegistry.js';
import type { ICanvasMenu } from './canvasMenuRegistry.js';
import type { CanvasMenuRegistry } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ── Host ────────────────────────────────────────────────────────────────────

export interface TableActionMenuHost {
  readonly editor: Editor | null;
}

/** What the open menu is aimed at. */
export type TableMenuTarget = 'row' | 'column' | 'table';

interface MenuItemSpec {
  readonly label: string;
  readonly icon: string;
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly run: (editor: Editor) => void;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class TableActionMenuController implements ICanvasMenu {
  readonly id = 'table-action-menu';

  private _menu: HTMLElement | null = null;
  private _anchorEl: HTMLElement | null = null;
  private _registration: IDisposable | null = null;

  /** Position of the table the open menu belongs to (staleness check). */
  private _tablePos = -1;

  /**
   * Detach for the popup-dismissal contract (Escape / outside press / window
   * blur, stack-aware).  CanvasMenuRegistry only sweeps outside-mousedown, so
   * a canvas menu on its own survives Escape and Alt-Tab — the exact gap
   * SYSTEM_INTEGRITY.md Phase A closed everywhere else.  A NEW menu joins the
   * contract rather than inheriting the tail; the registry's own sweep still
   * runs and hide() is idempotent.
   */
  private _detachDismiss: (() => void) | null = null;

  constructor(
    private readonly _host: TableActionMenuHost,
    private readonly _registry: CanvasMenuRegistry,
  ) {}

  create(): void {
    this._menu = $('div.block-action-menu.table-action-menu');
    this._menu.style.display = 'none';
    document.body.appendChild(this._menu);
    this._registration = this._registry.register(this);
  }

  get visible(): boolean {
    return this._menu?.style.display === 'block';
  }

  containsTarget(target: Node): boolean {
    if (this._menu?.contains(target)) return true;
    if (this._anchorEl?.contains(target)) return true;
    return false;
  }

  hide(): void {
    this._detachDismiss?.();
    this._detachDismiss = null;
    if (this._menu) this._menu.style.display = 'none';
    this._anchorEl = null;
    this._tablePos = -1;
  }

  /** The table under the menu vanished (deleted, or the doc was replaced). */
  onTransaction(editor: Editor): void {
    if (!this.visible || this._tablePos < 0) return;
    const node = editor.state.doc.nodeAt(this._tablePos);
    if (!node || node.type.name !== 'table') this.hide();
  }

  dispose(): void {
    this._detachDismiss?.();
    this._detachDismiss = null;
    this._registration?.dispose();
    this._registration = null;
    this._menu?.remove();
    this._menu = null;
  }

  // ── Show ────────────────────────────────────────────────────────────────

  /**
   * @param target   — which axis the grip belongs to
   * @param tablePos — absolute position of the table node
   * @param index    — row or column index (ignored for `table`)
   * @param anchor   — the grip's rect, which the menu opens below
   * @param anchorEl — the grip element (excluded from outside-click dismissal)
   */
  show(
    target: TableMenuTarget,
    tablePos: number,
    index: number,
    anchor: DOMRect,
    anchorEl?: HTMLElement,
  ): void {
    const editor = this._host.editor;
    if (!editor || !this._menu) return;
    const frame = tableFrameAt(editor.state.doc, tablePos);
    if (!frame) return;

    this._tablePos = tablePos;
    this._anchorEl = anchorEl ?? null;
    this._menu.innerHTML = '';

    const header = $('div.block-action-header');
    header.textContent = target === 'row' ? `Row ${index + 1}`
      : target === 'column' ? `Column ${index + 1}`
        : `Table · ${frame.rows} × ${frame.cols}`;
    this._menu.appendChild(header);

    for (const spec of this._itemsFor(target, frame, index)) {
      if (spec === null) {
        this._menu.appendChild($('div.block-action-separator'));
        continue;
      }
      this._menu.appendChild(this._renderItem(spec));
    }

    this._menu.style.display = 'block';
    layoutPopup(this._menu, anchor, { position: 'below', gap: 4 });

    // The grip that opened it counts as "inside", so the press that opened
    // the menu can't immediately dismiss it.
    this._detachDismiss?.();
    const roots = anchorEl ? [this._menu, anchorEl] : [this._menu];
    this._detachDismiss = attachPopupDismiss(roots, () => this.hide());

    this._registry.notifyShow(this.id);
  }

  // ── Item sets ───────────────────────────────────────────────────────────

  private _itemsFor(
    target: TableMenuTarget,
    frame: ReturnType<typeof tableFrameAt>,
    index: number,
  ): (MenuItemSpec | null)[] {
    if (!frame) return [];
    const items: (MenuItemSpec | null)[] = [];

    if (target === 'row') {
      // The header row stays pinned at the top, so "Insert Above" on it is
      // meaningless — tableOps redirects it, and the menu doesn't offer it.
      if (!(frame.headerRow && index === 0)) {
        items.push({ label: 'Insert Row Above', icon: 'arrow-up', run: insertRowAbove });
      }
      items.push({ label: 'Insert Row Below', icon: 'arrow-down', run: insertRowBelow });
      items.push({
        label: 'Duplicate Row', icon: 'duplicate', shortcut: 'Ctrl+D',
        run: (ed) => { if (!duplicateRow(ed)) insertRowBelow(ed); },
      });
      const floor = frame.headerRow ? 1 : 0;
      if (index > floor) {
        items.push({
          label: 'Move Up', icon: 'chevron-up', shortcut: 'Ctrl+Shift+↑',
          run: (ed) => { moveRowBy(ed, -1); },
        });
      }
      if (index >= floor && index < frame.rows - 1) {
        items.push({
          label: 'Move Down', icon: 'chevron-down', shortcut: 'Ctrl+Shift+↓',
          run: (ed) => { moveRowBy(ed, 1); },
        });
      }
      items.push(null);
      if (index === 0) {
        items.push({
          label: frame.headerRow ? 'Remove Header Row' : 'Make Header Row',
          icon: 'heading', run: (ed) => { toggleHeaderRowOp(ed); },
        });
      }
      this._pushCellItems(items);
      items.push({ label: 'Clear Contents', icon: 'eraser', run: (ed) => { clearSelectedCells(ed); } });
      if (frame.rows > 1) {
        items.push({ label: 'Delete Row', icon: 'trash', danger: true, run: (ed) => { removeRow(ed); } });
      }
      return items;
    }

    if (target === 'column') {
      if (!(frame.headerCol && index === 0)) {
        items.push({ label: 'Insert Column Left', icon: 'arrow-left', run: insertColumnLeft });
      }
      items.push({ label: 'Insert Column Right', icon: 'arrow-right', run: insertColumnRight });
      items.push({
        label: 'Duplicate Column', icon: 'duplicate',
        run: (ed) => { if (!duplicateColumn(ed)) insertColumnRight(ed); },
      });
      const floor = frame.headerCol ? 1 : 0;
      if (index > floor) {
        items.push({
          label: 'Move Left', icon: 'chevron-left', shortcut: 'Ctrl+Shift+←',
          run: (ed) => { moveColumnBy(ed, -1); },
        });
      }
      if (index >= floor && index < frame.cols - 1) {
        items.push({
          label: 'Move Right', icon: 'chevron-right', shortcut: 'Ctrl+Shift+→',
          run: (ed) => { moveColumnBy(ed, 1); },
        });
      }
      items.push(null);
      if (index === 0) {
        items.push({
          label: frame.headerCol ? 'Remove Header Column' : 'Make Header Column',
          icon: 'heading', run: (ed) => { toggleHeaderColumnOp(ed); },
        });
      }
      this._pushCellItems(items);
      items.push({ label: 'Clear Contents', icon: 'eraser', run: (ed) => { clearSelectedCells(ed); } });
      if (frame.cols > 1) {
        items.push({ label: 'Delete Column', icon: 'trash', danger: true, run: (ed) => { removeColumn(ed); } });
      }
      return items;
    }

    // Whole table
    items.push({
      label: frame.headerRow ? 'Remove Header Row' : 'Make Header Row',
      icon: 'heading', run: (ed) => { toggleHeaderRowOp(ed); },
    });
    items.push({
      label: frame.headerCol ? 'Remove Header Column' : 'Make Header Column',
      icon: 'columns', run: (ed) => { toggleHeaderColumnOp(ed); },
    });
    items.push(null);
    items.push({ label: 'Insert Row Below', icon: 'arrow-down', run: insertRowBelow });
    items.push({ label: 'Insert Column Right', icon: 'arrow-right', run: insertColumnRight });
    this._pushCellItems(items);
    items.push({ label: 'Clear Contents', icon: 'eraser', run: (ed) => { clearSelectedCells(ed); } });
    items.push({ label: 'Delete Table', icon: 'trash', danger: true, run: (ed) => { removeTable(ed); } });
    return items;
  }

  /** Merge / split, offered only when the current selection can take them. */
  private _pushCellItems(items: (MenuItemSpec | null)[]): void {
    const editor = this._host.editor;
    if (!editor) return;
    if (canMergeCells(editor.state)) {
      items.push({ label: 'Merge Cells', icon: 'merge', run: (ed) => { mergeSelectedCells(ed); } });
    }
    if (canSplitCell(editor.state)) {
      items.push({ label: 'Split Cell', icon: 'split', run: (ed) => { splitSelectedCell(ed); } });
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private _renderItem(spec: MenuItemSpec): HTMLElement {
    const item = $('div.block-action-item');
    if (spec.danger) item.classList.add('block-action-item--danger');

    const iconEl = $('span.block-action-icon');
    iconEl.innerHTML = svgIcon(spec.icon);
    const svg = iconEl.querySelector('svg');
    if (svg && !svg.getAttribute('width')) {
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
    }
    item.appendChild(iconEl);

    const labelEl = $('span.block-action-label');
    labelEl.textContent = spec.label;
    item.appendChild(labelEl);

    if (spec.shortcut) {
      const sc = $('span.block-action-shortcut');
      sc.textContent = spec.shortcut;
      item.appendChild(sc);
    }

    // mousedown, not click: the editor must not see a focus change between
    // the grip's selection and the command that reads it.
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const editor = this._host.editor;
      this.hide();
      if (!editor) return;
      spec.run(editor);
      editor.view.focus();
    });
    return item;
  }
}
