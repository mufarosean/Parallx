// univerKeys.ts — the keys a person expects in a spreadsheet that the engine
// does not have:
//
//   Home                 the first cell of the row
//   Ctrl+Home            the first cell of the sheet (under and right of what is frozen)
//   Ctrl+End             the last cell in use
//   Page Down, Page Up   a screen down, a screen up
//   Shift+Space          the whole row; Ctrl+Space the whole column
//   F5, Ctrl+G           Go To: the keys go to the name box
//   Ctrl+Shift+1, 4, 5   two decimals with thousands, currency, percent (Excel's !, $ and %)
//   Ctrl+1               the number format choices
//   Ctrl+Shift+Plus      insert: the choices come to the selection
//   an arrow at the edge stays put (it wrapped: Up from A1 landed on the last cell)
//
// Part of the engine bundle (see univerHost.ts). Every key acts only while
// the keys are in the grid and no cell is being typed in, so none of them
// takes a key from an entry, the formula bar or the name box.

import { CommandType, Direction, EDITOR_ACTIVATED, FOCUSING_SHEET, FOCUSING_UNIVER_EDITOR, ICommandService, RANGE_TYPE } from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/lib/facade';
import { IRenderManagerService } from '@univerjs/engine-render';
import { SetSelectionsOperation } from '@univerjs/sheets';
import { MoveSelectionCommand, SheetSkeletonManagerService } from '@univerjs/sheets-ui';
import { IShortcutService, KeyCode, MetaKeys } from '@univerjs/ui';
import { SHEET_MENU_EVENT, type SheetFormatAction } from './sheetFormat.js';

// The browser's key codes for the keys the engine's own list leaves out.
const KEY_PAGE_UP = 33;
const KEY_PAGE_DOWN = 34;
const KEY_END = 35;
const KEY_HOME = 36;

type Where = 'rowStart' | 'sheetStart' | 'sheetEnd' | 'pageDown' | 'pageUp' | 'row' | 'column';

export interface SheetKeysDeps {
  /** The element the sheet is mounted in. */
  readonly container: HTMLElement;
  /** One act on the selection, as the toolbar does it. */
  readonly run: (action: SheetFormatAction) => boolean;
}

export function installSheetKeys(univer: Univer, univerAPI: FUniver, deps: SheetKeysDeps): { dispose(): void }[] {
  const injector = univer.__getInjector();
  const commands = injector.get(ICommandService);
  const shortcuts = injector.get(IShortcutService);
  const out: { dispose(): void }[] = [];
  const idleSheet = (ctx: { getContextValue(key: string): boolean }): boolean =>
    ctx.getContextValue(FOCUSING_SHEET) && ctx.getContextValue(FOCUSING_UNIVER_EDITOR) && !ctx.getContextValue(EDITOR_ACTIVATED);

  const sheet = () => univerAPI.getActiveWorkbook()?.getActiveSheet() ?? null;

  /** Selects `range` with `row`, `column` as the active cell, and brings that cell into view. */
  function select(range: { startRow: number; endRow: number; startColumn: number; endColumn: number; rangeType?: RANGE_TYPE }, row: number, column: number, scroll = true): boolean {
    const book = univerAPI.getActiveWorkbook();
    const s = sheet();
    if (!book || !s) return false;
    commands.syncExecuteCommand(SetSelectionsOperation.id, {
      unitId: book.getId(), subUnitId: s.getSheetId(),
      selections: [{
        range: { ...range, rangeType: range.rangeType ?? RANGE_TYPE.NORMAL },
        primary: { actualRow: row, actualColumn: column, startRow: row, endRow: row, startColumn: column, endColumn: column, isMerged: false, isMergedMainCell: false },
        style: null,
      }],
    });
    // Only as far as it takes to see the cell: a cell already in view leaves the view where it is.
    if (scroll) commands.syncExecuteCommand('sheet.command.scroll-to-cell', { range: { startRow: row, endRow: row, startColumn: column, endColumn: column } });
    return true;
  }

  /** How many rows the grid shows at once, less one so a row of the last screen is still in sight: a page. */
  function pageRows(row: number, column: number): number {
    try {
      const book = univerAPI.getActiveWorkbook();
      const render = book ? injector.get(IRenderManagerService).getRenderById(book.getId()) : null;
      const skeleton = render?.with(SheetSkeletonManagerService).getCurrentSkeleton();
      const view = render?.scene?.getViewport('viewMain');
      if (!skeleton || !view) return 20;
      const cell = skeleton.getCellWithCoordByIndex(row, column);
      const rowHeight = Math.max(1, cell.endY - cell.startY);
      return Math.max(1, Math.floor((view.height ?? 0) / rowHeight) - 1);
    } catch {
      return 20;
    }
  }

  function go(where: Where): boolean {
    const s = sheet();
    const cell = s?.getSelection()?.getCurrentCell();
    if (!s || !cell) return false;
    const lastRow = s.getMaxRows() - 1;
    const lastColumn = s.getMaxColumns() - 1;
    const one = (row: number, column: number): boolean => select({ startRow: row, endRow: row, startColumn: column, endColumn: column }, row, column);
    const freeze = s.getFreeze();
    // The first cell that scrolls: under the frozen rows, right of the frozen columns.
    const firstRow = freeze.ySplit > 0 ? Math.max(0, freeze.startRow) : 0;
    const firstColumn = freeze.xSplit > 0 ? Math.max(0, freeze.startColumn) : 0;
    switch (where) {
      case 'rowStart': return one(cell.actualRow, firstColumn);
      case 'sheetStart': return one(firstRow, firstColumn);
      case 'sheetEnd': return one(Math.max(0, s.getLastRow()), Math.max(0, s.getLastColumn()));
      case 'pageDown': return one(Math.min(lastRow, cell.actualRow + pageRows(cell.actualRow, cell.actualColumn)), cell.actualColumn);
      case 'pageUp': return one(Math.max(firstRow, cell.actualRow - pageRows(cell.actualRow, cell.actualColumn)), cell.actualColumn);
      // The whole row or column: the active cell stays where it is, and the view does not move.
      case 'row': return select({ startRow: cell.actualRow, endRow: cell.actualRow, startColumn: 0, endColumn: lastColumn, rangeType: RANGE_TYPE.ROW }, cell.actualRow, cell.actualColumn, false);
      case 'column': return select({ startRow: 0, endRow: lastRow, startColumn: cell.actualColumn, endColumn: cell.actualColumn, rangeType: RANGE_TYPE.COLUMN }, cell.actualRow, cell.actualColumn, false);
      default: return false;
    }
  }

  /** An arrow, stopped at the sheet's edge: there is no cell beyond it to go to. */
  function step(direction: Direction): boolean {
    const s = sheet();
    const cell = s?.getSelection()?.getCurrentCell();
    if (s && cell) {
      const atEdge = (direction === Direction.UP && cell.actualRow <= 0) || (direction === Direction.LEFT && cell.actualColumn <= 0)
        || (direction === Direction.DOWN && cell.actualRow >= s.getMaxRows() - 1) || (direction === Direction.RIGHT && cell.actualColumn >= s.getMaxColumns() - 1);
      if (atEdge) return true;
    }
    // The engine's move answers later (a promise), so it is not run as one that answers at once.
    void commands.executeCommand(MoveSelectionCommand.id, { direction });
    return true;
  }

  function goTo(): boolean {
    const box = deps.container.querySelector<HTMLInputElement>('[data-u-comp="defined-name"] input');
    if (!box) return false;
    box.focus();
    box.select();
    return true;
  }

  const askMenu = (name: string): boolean => deps.container.dispatchEvent(new CustomEvent(SHEET_MENU_EVENT, { detail: name, bubbles: true }));

  const bind = (id: string, description: string, binding: number, handler: () => boolean): void => {
    out.push(commands.registerCommand({ id, type: CommandType.COMMAND, handler: () => { try { return handler(); } catch (err) { console.warn(`[SheetKeys] ${id} failed:`, err); return false; } } }));
    out.push(shortcuts.registerShortcut({ id, description, group: '3_sheet-view', binding: binding as KeyCode, priority: 1000, preconditions: idleSheet }));
  };
  const CTRL = MetaKeys.CTRL_COMMAND;
  const SHIFT = MetaKeys.SHIFT;
  try {
    bind('parallx.sheet.row-start', 'Go to the first cell of the row', KEY_HOME, () => go('rowStart'));
    bind('parallx.sheet.sheet-start', 'Go to the first cell of the sheet', KEY_HOME | CTRL, () => go('sheetStart'));
    bind('parallx.sheet.sheet-end', 'Go to the last cell in use', KEY_END | CTRL, () => go('sheetEnd'));
    bind('parallx.sheet.page-down', 'Go down a screen', KEY_PAGE_DOWN, () => go('pageDown'));
    bind('parallx.sheet.page-up', 'Go up a screen', KEY_PAGE_UP, () => go('pageUp'));
    bind('parallx.sheet.select-row', 'Select the row', KeyCode.SPACE | SHIFT, () => go('row'));
    bind('parallx.sheet.select-column', 'Select the column', KeyCode.SPACE | CTRL, () => go('column'));
    bind('parallx.sheet.go-to', 'Go to a cell', KeyCode.F5, goTo);
    bind('parallx.sheet.go-to-g', 'Go to a cell', KeyCode.G | CTRL, goTo);
    bind('parallx.sheet.format-number', 'Two decimals, with thousands', KeyCode.Digit1 | CTRL | SHIFT, () => deps.run({ do: 'numberFormat', pattern: '#,##0.00' }));
    bind('parallx.sheet.format-currency', 'Currency', KeyCode.Digit4 | CTRL | SHIFT, () => deps.run({ do: 'numberFormat', pattern: '$#,##0.00' }));
    bind('parallx.sheet.format-percent', 'Percent', KeyCode.Digit5 | CTRL | SHIFT, () => deps.run({ do: 'numberFormat', pattern: '0%' }));
    bind('parallx.sheet.number-formats', 'Number format choices', KeyCode.Digit1 | CTRL, () => deps.run({ do: 'numberFormats' }));
    bind('parallx.sheet.insert', 'Insert cells, rows or columns', KeyCode.EQUAL | CTRL | SHIFT, () => askMenu('insert'));
    bind('parallx.sheet.step-up', 'Select the cell above', KeyCode.ARROW_UP, () => step(Direction.UP));
    bind('parallx.sheet.step-down', 'Select the cell below', KeyCode.ARROW_DOWN, () => step(Direction.DOWN));
    bind('parallx.sheet.step-left', 'Select the cell to the left', KeyCode.ARROW_LEFT, () => step(Direction.LEFT));
    bind('parallx.sheet.step-right', 'Select the cell to the right', KeyCode.ARROW_RIGHT, () => step(Direction.RIGHT));
  } catch (err) {
    console.warn('[Worksheet] sheet keys not registered:', err);
  }
  return out;
}
