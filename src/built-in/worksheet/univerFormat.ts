// univerFormat.ts — the engine's side of the sheet's toolbar (sheetFormat.ts).
//
// Part of the engine bundle (see univerHost.ts): it reads how the active cell
// is formatted and runs one act on the selection. Wherever the engine has a
// command for an act, the command is used, so an act here is the same act the
// engine's own ribbon did (the whole selection, one undo step).

import { BorderStyleTypes, BorderType, ICommandService, IUndoRedoService } from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/lib/facade';
import { FormatPainterStatus, IFormatPainterService, SheetSkeletonManagerService } from '@univerjs/sheets-ui';
import { IRenderManagerService } from '@univerjs/engine-render';
import { expandToContinuousRange } from '@univerjs/sheets';
import { UniverSheetsSortPreset } from '@univerjs/presets/preset-sheets-sort';
import UniverPresetSheetsSortEnUS from '@univerjs/presets/preset-sheets-sort/locales/en-US';
import { UniverSheetsFilterPreset } from '@univerjs/presets/preset-sheets-filter';
import UniverPresetSheetsFilterEnUS from '@univerjs/presets/preset-sheets-filter/locales/en-US';
import '@univerjs/presets/lib/styles/preset-sheets-sort.css';
import '@univerjs/presets/lib/styles/preset-sheets-filter.css';
import { SHEET_BORDER_BLACK } from './sheetFormat.js';
import type { ISheetFormat, SheetAlign, SheetBorderLine, SheetBorders, SheetFormatAction, SheetFormatState, SheetOverflow, SheetVAlign } from './sheetFormat.js';

/** The engine's commands for the acts that are one command each. */
const COMMANDS: Partial<Record<SheetFormatAction['do'], string>> = {
  undo: 'univer.command.undo',
  redo: 'univer.command.redo',
  bold: 'sheet.command.set-range-bold',
  italic: 'sheet.command.set-range-italic',
  underline: 'sheet.command.set-range-underline',
  strike: 'sheet.command.set-range-stroke',
  percent: 'sheet.command.numfmt.set.percent',
  currency: 'sheet.command.numfmt.set.currency',
  moreDecimals: 'sheet.command.numfmt.add.decimal.command',
  fewerDecimals: 'sheet.command.numfmt.subtract.decimal.command',
  painter: 'sheet.command.set-once-format-painter',
  textToNumber: 'sheet.command.text-to-number',
  insertImage: 'sheet.command.insert-float-image',
  functions: 'formula-ui.operation.more-functions',
  numberFormats: 'sheet.operation.open.numfmt.panel',
  protect: 'sheet.command.add-range-protection-from-toolbar',
  clearFormat: 'sheet.command.clear-selection-format',
  clearAll: 'sheet.command.clear-selection-all',
  largerText: 'sheet.command.set-range-font-increase',
  smallerText: 'sheet.command.set-range-font-decrease',
  mergeAcross: 'sheet.command.add-worksheet-merge-horizontal',
  mergeDown: 'sheet.command.add-worksheet-merge-vertical',
  unmerge: 'sheet.command.remove-worksheet-merge',
  insertCellImage: 'sheet.command.insert-cell-image',
  customSort: 'sheet.command.sort-range-custom',
  clearFilter: 'sheet.command.clear-filter-criteria',
  reapplyFilter: 'sheet.command.re-calc-filter',
};

// The engine's numbers for alignment and wrapping (HorizontalAlign, VerticalAlign, WrapStrategy).
const H_ALIGN: Record<SheetAlign, number> = { left: 1, center: 2, right: 3 };
const V_ALIGN: Record<SheetVAlign, number> = { top: 1, middle: 2, bottom: 3 };
const WRAP_ON = 3;
const WRAP_OFF = 1;
const OVERFLOW: Record<SheetOverflow, number> = { overflow: 1, clip: 2, wrap: 3 };
const LINES: Record<SheetBorderLine, BorderStyleTypes> = {
  thin: BorderStyleTypes.THIN, medium: BorderStyleTypes.MEDIUM, thick: BorderStyleTypes.THICK,
  dashed: BorderStyleTypes.DASHED, dotted: BorderStyleTypes.DOTTED, double: BorderStyleTypes.DOUBLE,
};

const BORDERS: Record<SheetBorders, BorderType> = {
  all: BorderType.ALL, outside: BorderType.OUTSIDE, inside: BorderType.INSIDE, top: BorderType.TOP,
  bottom: BorderType.BOTTOM, left: BorderType.LEFT, right: BorderType.RIGHT, none: BorderType.NONE,
};

/**
 * The engine parts a sheet of one's own has and an exam sheet does not: sort
 * and filter. The exam tool has neither, so a sheet held to its function list
 * is given neither (its right-click menu stays as it was).
 */
export function freeSheetParts(free: boolean): { presets: unknown[]; locales: Record<string, unknown>[] } {
  if (!free) return { presets: [], locales: [] };
  return {
    presets: [UniverSheetsSortPreset(), UniverSheetsFilterPreset()],
    locales: [UniverPresetSheetsSortEnUS as Record<string, unknown>, UniverPresetSheetsFilterEnUS as Record<string, unknown>],
  };
}

interface CellStyle {
  bl?: number; it?: number; ul?: { s?: number }; st?: { s?: number }; ff?: string | null; fs?: number;
  ht?: number | null; vt?: number | null; tb?: number | null; tr?: { a?: number } | null; n?: { pattern?: string } | null;
}

export function createSheetFormat(univer: Univer, univerAPI: FUniver, isDisposed: () => boolean): ISheetFormat & { dispose(): void } {
  const injector = univer.__getInjector();
  const commands = injector.get(ICommandService);
  const listeners = new Set<() => void>();
  const subs: { dispose(): void }[] = [];
  let undoStatus = { undos: 0, redos: 0 };
  // One telling for a burst of commands. A timer, not a paint frame: a window that is not painting
  // (minimised, behind another) still has a sheet whose toolbar must be right when it is seen again.
  let pending: ReturnType<typeof setTimeout> | null = null;
  const tell = (): void => {
    if (pending || isDisposed()) return;
    pending = setTimeout(() => { pending = null; if (!isDisposed()) for (const l of [...listeners]) { try { l(); } catch (err) { console.warn('[SheetFormat] listener threw:', err); } } }, 16);
  };
  subs.push(commands.onCommandExecuted(tell));
  try {
    const sub = injector.get(IUndoRedoService).undoRedoStatus$.subscribe((s) => { undoStatus = s; tell(); });
    subs.push({ dispose: () => sub.unsubscribe() });
  } catch { /* no undo service: the two buttons stay off */ }

  const sheet = () => univerAPI.getActiveWorkbook()?.getActiveSheet() ?? null;

  function state(): SheetFormatState | null {
    if (isDisposed()) return null;
    try {
      const s = sheet();
      const cell = s?.getSelection()?.getCurrentCell();
      const range = s?.getActiveRange();
      if (!s || !cell || !range) return null;
      const at = s.getRange(cell.actualRow, cell.actualColumn);
      const style = (at.getCellStyleData() ?? {}) as CellStyle;
      const freeze = s.getFreeze();
      let painter = false;
      try { painter = injector.get(IFormatPainterService).getStatus() !== FormatPainterStatus.OFF; } catch { /* not there */ }
      let filter = false;
      try { filter = !!s.getFilter(); } catch { /* the filter part is not on for this sheet */ }
      const alignOf = <T extends string>(map: Record<T, number>, v: number | null | undefined): T | '' => (Object.keys(map) as T[]).find((k) => map[k] === v) ?? '';
      return {
        range: range.getA1Notation(),
        bold: style.bl === 1, italic: style.it === 1, underline: style.ul?.s === 1, strike: style.st?.s === 1,
        wrap: style.tb === WRAP_ON,
        overflow: style.tb === WRAP_ON ? 'wrap' : style.tb === OVERFLOW.clip ? 'clip' : 'overflow',
        merged: at.isPartOfMerge(),
        align: alignOf(H_ALIGN, style.ht), valign: alignOf(V_ALIGN, style.vt),
        numberFormat: style.n?.pattern && style.n.pattern !== 'General' ? style.n.pattern : '',
        fontFamily: style.ff ?? '', fontSize: style.fs ?? 0, rotation: style.tr?.a ?? 0,
        frozenRows: Math.max(0, freeze?.ySplit ?? 0), frozenColumns: Math.max(0, freeze?.xSplit ?? 0),
        filter, painter,
        canUndo: undoStatus.undos > 0, canRedo: undoStatus.redos > 0,
      };
    } catch {
      return null;
    }
  }

  /** The cells an act with no selection of its own works on: the selection, or the block of data around a single cell. */
  function workingRange() {
    const s = sheet();
    const range = s?.getActiveRange();
    if (!s || !range) return null;
    if (range.getWidth() * range.getHeight() > 1) return range;
    // The whole block the cell is in, out to the first empty row and column on each side (the
    // engine's own getDataRegion reaches one row and one column out, no further).
    const at = { startRow: range.getRow(), endRow: range.getRow(), startColumn: range.getColumn(), endColumn: range.getColumn() };
    const block = expandToContinuousRange(at, { left: true, right: true, up: true, down: true }, s.getSheet());
    return s.getRange(block.startRow, block.startColumn, block.endRow - block.startRow + 1, block.endColumn - block.startColumn + 1);
  }

  function sort(ascending: boolean): boolean {
    const s = sheet();
    const cell = s?.getSelection()?.getCurrentCell();
    let region = workingRange();
    if (!s || !cell || !region) return false;
    const column = Math.min(Math.max(cell.actualColumn - region.getColumn(), 0), region.getWidth() - 1);
    // A heading stays where it is: words over a number in the column sorted by is a heading row, as Excel reads it.
    if (region.getHeight() > 2) {
      const values = region.getValues();
      const isNumber = (v: unknown): boolean => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
      const top = values[0]?.[column];
      if (typeof top === 'string' && top.trim() !== '' && !isNumber(top) && isNumber(values[1]?.[column])) {
        region = s.getRange(region.getRow() + 1, region.getColumn(), region.getHeight() - 1, region.getWidth());
      }
    }
    region.sort({ column, ascending });
    return true;
  }

  function toggleFilter(): boolean {
    const s = sheet();
    if (!s) return false;
    const on = s.getFilter();
    if (on) return on.remove();
    return !!workingRange()?.createFilter();
  }

  function freeze(what: 'row' | 'column' | 'here' | 'none'): boolean {
    const s = sheet();
    const cell = s?.getSelection()?.getCurrentCell();
    if (!s) return false;
    if (what === 'none') s.cancelFreeze();
    else if (what === 'row') s.setFrozenRows(1);
    else if (what === 'column') s.setFrozenColumns(1);
    else {
      if (!cell || (cell.actualRow === 0 && cell.actualColumn === 0)) return false;
      s.setFreeze({ xSplit: cell.actualColumn, ySplit: cell.actualRow, startRow: cell.actualRow, startColumn: cell.actualColumn });
    }
    return true;
  }

  function run(action: SheetFormatAction): boolean {
    if (isDisposed()) return false;
    try {
      const s = sheet();
      const range = s?.getActiveRange();
      const exec = (id: string, params?: object): boolean => { void commands.executeCommand(id, params); return true; };
      switch (action.do) {
        case 'numberFormat': if (!range) return false; range.setNumberFormat(action.pattern || 'General'); return true;
        case 'textColor': return action.color ? exec('sheet.command.set-range-text-color', { value: action.color }) : exec('sheet.command.reset-range-text-color');
        case 'fill': return action.color ? exec('sheet.command.set-background-color', { value: action.color }) : exec('sheet.command.reset-background-color');
        case 'borders': if (!range) return false; range.setBorder(BORDERS[action.kind], LINES[action.line ?? 'thin'], action.color ?? SHEET_BORDER_BLACK); return true;
        case 'overflow': return exec('sheet.command.set-text-wrap', { value: OVERFLOW[action.to] });
        case 'stackText': return exec('sheet.command.set-text-rotation', { value: 'v' });
        case 'align': return exec('sheet.command.set-horizontal-text-align', { value: H_ALIGN[action.to] });
        case 'valign': return exec('sheet.command.set-vertical-text-align', { value: V_ALIGN[action.to] });
        case 'rotate': return exec('sheet.command.set-text-rotation', { value: action.degrees });
        case 'font': return exec('sheet.command.set-range-font-family', { value: action.family });
        case 'fontSize': return exec('sheet.command.set-range-fontsize', { value: action.size });
        case 'wrap': return exec('sheet.command.set-text-wrap', { value: state()?.wrap ? WRAP_OFF : WRAP_ON });
        case 'merge': return exec(state()?.merged ? 'sheet.command.remove-worksheet-merge' : 'sheet.command.add-worksheet-merge-all');
        case 'sum': return exec('formula-ui.operation.insert-function', { value: action.fn });
        case 'sort': return sort(action.ascending);
        case 'filter': return toggleFilter();
        case 'freeze': return freeze(action.what);
        default: {
          const id = COMMANDS[action.do];
          return id ? exec(id) : false;
        }
      }
    } catch (err) {
      console.warn('[SheetFormat] could not', action.do, err);
      return false;
    } finally {
      tell();
    }
  }

  function selectionText(maxCells = 2000): { range: string; text: string; cells: number } | null {
    if (isDisposed()) return null;
    try {
      const range = sheet()?.getActiveRange();
      if (!range) return null;
      const cells = range.getWidth() * range.getHeight();
      const rows = range.getDisplayValues();
      let left = maxCells;
      const lines: string[] = [];
      for (const row of rows) {
        if (left <= 0) break;
        lines.push(row.slice(0, left).join('\t'));
        left -= row.length;
      }
      return { range: range.getA1Notation(), text: lines.join('\n'), cells };
    } catch {
      return null;
    }
  }

  /**
   * Where the selection's first cell is in the window. The engine gives a cell's place on the whole
   * sheet; what is on screen is that, less what has scrolled away (frozen rows and columns do not
   * scroll), times the zoom, from the canvas's corner. The same sum the engine does for its own popups.
   */
  function selectionRect(): { left: number; top: number; right: number; bottom: number } | null {
    if (isDisposed()) return null;
    try {
      const book = univerAPI.getActiveWorkbook();
      const s = book?.getActiveSheet();
      const range = s?.getActiveRange();
      const render = book ? injector.get(IRenderManagerService).getRenderById(book.getId()) : null;
      const scene = render?.scene;
      const skeleton = render?.with(SheetSkeletonManagerService).getCurrentSkeleton();
      const view = scene?.getViewport('viewMain');
      const canvas = render?.engine.getCanvasElement();
      if (!s || !range || !scene || !skeleton || !view || !canvas) return null;
      const cell = skeleton.getCellWithCoordByIndex(range.getRow(), range.getColumn());
      const { scaleX, scaleY } = scene.getAncestorScale();
      const freeze = s.getFreeze();
      const from = skeleton.getNoMergeCellWithCoordByIndex(freeze.startRow - freeze.ySplit, freeze.startColumn - freeze.xSplit, false);
      const to = skeleton.getNoMergeCellWithCoordByIndex(freeze.startRow, freeze.startColumn, false);
      const x = (v: number): number => (v > view.left ? v - view.viewportScrollX : to.startX - from.startX + skeleton.rowHeaderWidth - (view.left - v)) * scaleX;
      const y = (v: number): number => (v > view.top ? v - view.viewportScrollY : to.startY - from.startY + skeleton.columnHeaderHeight - (view.top - v)) * scaleY;
      const box = canvas.getBoundingClientRect();
      const cssWidth = Number.parseInt(canvas.style.width, 10);
      const k = cssWidth > 0 ? box.width / cssWidth : 1;
      const rect = { left: box.left + x(cell.startX) * k, top: box.top + y(cell.startY) * k, right: box.left + x(cell.endX) * k, bottom: box.top + y(cell.endY) * k };
      return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
    } catch {
      return null;
    }
  }

  return {
    state,
    run,
    selectionText,
    selectionRect,
    onChange: (listener) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
    dispose: () => { if (pending) clearTimeout(pending); listeners.clear(); for (const d of subs) { try { d.dispose(); } catch { /* engine gone */ } } },
  };
}
