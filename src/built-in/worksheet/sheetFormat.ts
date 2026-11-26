// sheetFormat.ts — what the sheet's toolbar and the engine say to each other.
//
// The toolbar is the app's own (panes/sheetToolbar.ts, built from the kit);
// the engine is a separate bundle (univerHost.ts). This file is the whole of
// what passes between them: the state of the selection the toolbar shows, and
// the acts it asks for. It imports nothing from the engine, so both sides can
// read it.

/** How the active cell is formatted and what the sheet can do right now. */
export interface SheetFormatState {
  /** The selection as a person writes it: "B3" or "B3:D8". */
  readonly range: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly wrap: boolean;
  /** What a text longer than its cell does: runs on over empty cells, wraps, or is cut at the cell's edge. */
  readonly overflow: SheetOverflow;
  /** The active cell is part of a merged cell. */
  readonly merged: boolean;
  /** '' when the cell follows its content (text left, numbers right). */
  readonly align: SheetAlign | '';
  readonly valign: SheetVAlign | '';
  /** The number format's pattern; '' is General. */
  readonly numberFormat: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly rotation: number;
  readonly frozenRows: number;
  readonly frozenColumns: number;
  /** The sheet has a filter on. */
  readonly filter: boolean;
  /** The format painter is holding a format to paint. */
  readonly painter: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type SheetAlign = 'left' | 'center' | 'right';
export type SheetVAlign = 'top' | 'middle' | 'bottom';
export type SheetInsert = 'rowAbove' | 'rowBelow' | 'columnLeft' | 'columnRight' | 'cellsRight' | 'cellsDown';
export type SheetOverflow = 'overflow' | 'wrap' | 'clip';
export type SheetBorderLine = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';
export type SheetBorders = 'all' | 'outside' | 'inside' | 'top' | 'bottom' | 'left' | 'right' | 'none';
export type SheetSumFunction = 'SUM' | 'AVERAGE' | 'COUNT' | 'MAX' | 'MIN';
export type SheetFreeze = 'row' | 'column' | 'here' | 'none';

/** One act on the selection. A plain object, so a command can carry it. */
export type SheetFormatAction =
  | { readonly do: 'undo' | 'redo' | 'bold' | 'italic' | 'underline' | 'strike' | 'wrap' | 'merge' | 'percent' | 'currency' | 'moreDecimals' | 'fewerDecimals' | 'filter' | 'painter' | 'textToNumber' | 'insertImage' | 'functions' | 'numberFormats' | 'protect' | 'clearFormat' }
  | { readonly do: 'clearAll' | 'largerText' | 'smallerText' | 'mergeAcross' | 'mergeDown' | 'unmerge' | 'insertCellImage' | 'customSort' | 'clearFilter' | 'reapplyFilter' | 'stackText' | 'find' | 'replace' }
  | { readonly do: 'overflow'; readonly to: SheetOverflow }
  | { readonly do: 'insert'; readonly what: SheetInsert }
  | { readonly do: 'numberFormat'; readonly pattern: string }
  | { readonly do: 'textColor' | 'fill'; readonly color: string | null }
  | { readonly do: 'borders'; readonly kind: SheetBorders; readonly line?: SheetBorderLine; readonly color?: string }
  | { readonly do: 'align'; readonly to: SheetAlign }
  | { readonly do: 'valign'; readonly to: SheetVAlign }
  | { readonly do: 'rotate'; readonly degrees: number }
  | { readonly do: 'font'; readonly family: string }
  | { readonly do: 'fontSize'; readonly size: number }
  | { readonly do: 'sum'; readonly fn: SheetSumFunction }
  | { readonly do: 'sort'; readonly ascending: boolean }
  | { readonly do: 'freeze'; readonly what: SheetFreeze };

/** The engine's side, as the toolbar holds it. */
export interface ISheetFormat {
  /** Null while the sheet has no selection (it is still mounting, or gone). */
  state(): SheetFormatState | null;
  /** Does it; false when the engine refused or is gone. */
  run(action: SheetFormatAction): boolean;
  /** Called, at most once a frame, after the selection or anything on the sheet changed. */
  onChange(listener: () => void): { dispose(): void };
  /** Where the selection's first cell is in the window, for a bar that comes to it; null when it is not on screen. */
  selectionRect(): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null;
  /** Puts the keys back in the grid (after a press on the toolbar with the mouse, or a menu that came to the selection). */
  focusGrid(): void;
  /** The selection as text for another tool: its range and its cells, tab-separated, a row a line. */
  selectionText(maxCells?: number): { readonly range: string; readonly text: string; readonly cells: number } | null;
}

// ── What the menus offer ─────────────────────────────────────────────────────

/** Number formats in the order a person reaches for them. `pattern` '' is General. */
export const NUMBER_FORMATS: ReadonlyArray<{ readonly id: string; readonly label: string; readonly sample: string; readonly pattern: string }> = [
  { id: 'general', label: 'General', sample: '1234.5', pattern: '' },
  { id: 'number', label: 'Number', sample: '1,234.50', pattern: '#,##0.00' },
  { id: 'whole', label: 'Whole Number', sample: '1,235', pattern: '#,##0' },
  { id: 'percent', label: 'Percent', sample: '12.35%', pattern: '0.00%' },
  { id: 'currency', label: 'Currency', sample: '$1,234.50', pattern: '$#,##0.00' },
  { id: 'scientific', label: 'Scientific', sample: '1.23E+03', pattern: '0.00E+00' },
  { id: 'date', label: 'Date', sample: '3/4/2026', pattern: 'm/d/yyyy' },
  { id: 'time', label: 'Time', sample: '1:30:00 PM', pattern: 'h:mm:ss AM/PM' },
  { id: 'text', label: 'Text', sample: '007', pattern: '@' },
];

/** The name a pattern goes by on the toolbar: one of the list's, or "Custom". */
export function numberFormatLabel(pattern: string): string {
  const p = pattern === 'General' ? '' : pattern;
  return NUMBER_FORMATS.find((f) => f.pattern === p)?.label ?? 'Custom';
}

/**
 * The colours the text and fill menus offer, by name. Sheet colours are data
 * (they are saved in the file and exported to Excel), so they are fixed values
 * here and not theme tokens: a red cell is red in light and in dark.
 */
export const SHEET_COLORS: ReadonlyArray<{ readonly name: string; readonly text: string; readonly fill: string }> = [
  { name: 'Red', text: '#c0392b', fill: '#f8d7d3' },
  { name: 'Orange', text: '#b9770e', fill: '#fbe5c8' },
  { name: 'Yellow', text: '#9a7d0a', fill: '#fcf3bf' },
  { name: 'Green', text: '#1e8449', fill: '#d4efdf' },
  { name: 'Blue', text: '#1f618d', fill: '#d6eaf8' },
  { name: 'Violet', text: '#6c3483', fill: '#e8daef' },
  { name: 'Grey', text: '#616a6b', fill: '#e5e7e9' },
];

export const SHEET_FONTS: readonly string[] = ['Arial', 'Calibri', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
export const SHEET_FONT_SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36];
export const SHEET_ROTATIONS: ReadonlyArray<{ readonly label: string; readonly degrees: number }> = [
  { label: 'None', degrees: 0 }, { label: 'Tilt Up', degrees: -45 }, { label: 'Tilt Down', degrees: 45 }, { label: 'Up', degrees: -90 }, { label: 'Down', degrees: 90 },
];
export const SHEET_BORDER_LINES: ReadonlyArray<{ readonly id: SheetBorderLine; readonly label: string }> = [
  { id: 'thin', label: 'Thin' }, { id: 'medium', label: 'Medium' }, { id: 'thick', label: 'Thick' },
  { id: 'dashed', label: 'Dashed' }, { id: 'dotted', label: 'Dotted' }, { id: 'double', label: 'Double' },
];
/** A border's colour when none was chosen. */
export const SHEET_BORDER_BLACK = '#000000';

/**
 * The event the sheet's element sends when a key asks for a menu the app
 * draws (Ctrl+Shift+Plus: the insert choices). Its detail is the menu's name.
 */
export const SHEET_MENU_EVENT = 'px-sheet-menu';
