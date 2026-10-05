// excelEditorPane.ts — Spreadsheet (.xlsx/.xls/.ods/.csv…) reader pane.
//
// Renders per-sheet rows from the Electron document bridge as a read-only
// spreadsheet-style grid (column letters, row numbers, sticky header + gutter),
// with a sheet-tab bar. Cells are set via textContent, so there is no
// HTML-injection surface. The plain-text extraction path (indexing) is separate.

import './excelEditorPane.css';
import { EditorPane, type EditorPaneViewState } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { $, hide, show } from '../../ui/dom.js';
import { getIcon } from '../../ui/iconRegistry.js';
import { ExcelEditorInput } from './excelEditorInput.js';
import { takeFileReveal, type IFileRevealTarget } from '../fileReveal.js';
import { parseCellRef } from '../../services/quoteLocator.js';

const PANE_ID = 'excel-editor-pane';
const RENDER_ROW_CAP = 1000;

const ICON = { sheet: getIcon('table') || getIcon('grid') };

interface SpreadsheetSheet {
  readonly name: string;
  /** Rows from the used range's first row, blank rows included. */
  readonly rows: readonly (readonly string[])[];
  readonly cols: number;
  readonly truncated: boolean;
  /** 0-based workbook row of rows[0] and column of each row's first cell. */
  readonly rowStart?: number;
  readonly colStart?: number;
}
interface SpreadsheetDocument {
  readonly format: 'spreadsheet';
  readonly title: string;
  readonly sheets: readonly SpreadsheetSheet[];
}

/** 0→A, 25→Z, 26→AA … (spreadsheet column labels). */
function colLabel(i: number): string {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

export class ExcelEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _titleEl!: HTMLElement;
  private _metaEl!: HTMLElement;
  private _gridScroll!: HTMLElement;
  private _tabsEl!: HTMLElement;
  private _loadingEl!: HTMLElement;
  private _errorEl!: HTMLElement;

  private _current: ExcelEditorInput | null = null;
  private _sheets: readonly SpreadsheetSheet[] = [];
  private _active = 0;
  private _loadSeq = 0;
  /** Index into the active sheet's rows of the first row rendered. */
  private _renderFrom = 0;
  /** Cell a citation link pointed at: [rows index, cols index] in the active sheet. */
  private _revealed: { row: number; col: number } | null = null;

  constructor() {
    super(PANE_ID);
  }

  /** Shown and laid out: apply a citation link's sheet and cell, if one is pending. */
  protected override onDidShow(): void {
    const path = this._current?.uri.fsPath;
    if (!path || this._sheets.length === 0) return;
    const target = takeFileReveal(path);
    if (target) this._applyReveal(target);
  }

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('excel-editor-pane');

    // ── Toolbar ──
    const toolbar = $('div.excel-toolbar');
    const titleGroup = $('div.excel-toolbar-title-group');
    const icon = $('span.excel-toolbar-icon');
    if (ICON.sheet) icon.innerHTML = ICON.sheet;
    this._titleEl = $('span.excel-toolbar-title');
    titleGroup.appendChild(icon);
    titleGroup.appendChild(this._titleEl);
    toolbar.appendChild(titleGroup);
    const spacer = $('div.excel-toolbar-spacer');
    toolbar.appendChild(spacer);
    this._metaEl = $('span.excel-toolbar-meta');
    toolbar.appendChild(this._metaEl);
    container.appendChild(toolbar);

    // ── Grid ──
    this._gridScroll = $('div.excel-grid-scroll');
    this._gridScroll.tabIndex = 0;
    container.appendChild(this._gridScroll);

    // ── Sheet tabs ──
    this._tabsEl = $('div.excel-tabs');
    container.appendChild(this._tabsEl);

    this._loadingEl = $('div.excel-message', 'Loading…');
    this._errorEl = $('div.excel-message.excel-error');
    container.appendChild(this._loadingEl);
    container.appendChild(this._errorEl);
    hide(this._loadingEl);
    hide(this._errorEl);
  }

  protected override async renderInput(input: IEditorInput, _previous: IEditorInput | undefined): Promise<void> {
    if (!(input instanceof ExcelEditorInput)) {
      this._showError('Cannot render: not a spreadsheet input.');
      return;
    }
    this._current = input;
    const seq = ++this._loadSeq;
    this._titleEl.textContent = input.name;
    this._showLoading();

    try {
      const electron = (globalThis as { parallxElectron?: { document?: { readSpreadsheet?: (p: string) => Promise<SpreadsheetDocument | { error?: { message?: string } }> } } }).parallxElectron;
      if (!electron?.document?.readSpreadsheet) {
        throw new Error('Document bridge not available');
      }
      const result = await electron.document.readSpreadsheet(input.uri.fsPath);
      if (seq !== this._loadSeq) return;
      if (result && 'error' in result && result.error) {
        throw new Error(result.error.message || 'Spreadsheet rendering failed');
      }
      const doc = result as SpreadsheetDocument;
      this._sheets = doc.sheets ?? [];
      this._active = Math.min(Math.max(0, input.activeSheet || 0), Math.max(0, this._sheets.length - 1));
      hide(this._loadingEl);
      hide(this._errorEl);
      if (this._sheets.length === 0) {
        this._showError('This workbook has no sheets.');
        return;
      }
      this._renderFrom = 0;
      this._revealed = null;
      this._renderTabs();
      this._renderActiveSheet();
    } catch (err) {
      if (seq !== this._loadSeq) return;
      console.error('[ExcelEditorPane] Failed to load spreadsheet:', err);
      this._showError(`Couldn’t open this spreadsheet: ${(err as Error).message}`);
    }
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._loadSeq++;
    this._current = null;
    this._sheets = [];
    this._active = 0;
    this._gridScroll.textContent = '';
    this._tabsEl.textContent = '';
    this._titleEl.textContent = '';
    this._metaEl.textContent = '';
    hide(this._loadingEl);
    hide(this._errorEl);
  }

  override focus(): void {
    this._gridScroll?.focus();
  }

  protected override savePaneViewState(): EditorPaneViewState {
    return { scrollTop: this._gridScroll?.scrollTop ?? 0 };
  }

  protected override restorePaneViewState(state: EditorPaneViewState): void {
    if (typeof state.scrollTop === 'number' && this._gridScroll) {
      this._gridScroll.scrollTop = state.scrollTop;
    }
  }

  // ── Rendering ──

  private _renderTabs(): void {
    this._tabsEl.textContent = '';
    if (this._sheets.length <= 1) { hide(this._tabsEl); return; }
    show(this._tabsEl);
    this._sheets.forEach((sheet, i) => {
      const tab = $('button.excel-tab') as HTMLButtonElement;
      tab.type = 'button';
      tab.textContent = sheet.name;
      tab.title = sheet.name;
      tab.classList.toggle('is-active', i === this._active);
      tab.addEventListener('click', () => {
        if (i === this._active) return;
        this._active = i;
        if (this._current) this._current.activeSheet = i;
        this._renderFrom = 0;
        this._revealed = null;
        this._renderTabs();
        this._renderActiveSheet();
      });
      this._tabsEl.appendChild(tab);
    });
  }

  private _renderActiveSheet(): void {
    const sheet = this._sheets[this._active];
    if (!sheet) return;

    const rowCount = sheet.rows.length;
    const cols = Math.max(1, sheet.cols);
    const rowStart = sheet.rowStart ?? 0;
    const colStart = sheet.colStart ?? 0;
    const from = Math.max(0, Math.min(this._renderFrom, Math.max(0, rowCount - 1)));
    const to = Math.min(rowCount, from + RENDER_ROW_CAP);
    this._metaEl.textContent = `${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'} × ${cols} col${cols === 1 ? '' : 's'}`;

    const table = $('table.excel-grid');

    // Header: corner + column letters
    const thead = $('thead');
    const headRow = $('tr');
    headRow.appendChild($('th.excel-corner'));
    for (let c = 0; c < cols; c++) {
      const th = $('th.excel-colhead');
      // The workbook's own letters: a sheet whose data starts in column C
      // is labelled from C, as Excel shows it.
      th.textContent = colLabel(colStart + c);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // Body: row-number gutter + cells (textContent — no injection)
    const tbody = $('tbody');
    for (let r = from; r < to; r++) {
      const row = sheet.rows[r] ?? [];
      const tr = $('tr');
      const rownum = $('th.excel-rownum');
      // The workbook's own row number (blank rows are kept, so it counts
      // the way Excel does).
      rownum.textContent = String(rowStart + r + 1);
      tr.appendChild(rownum);
      for (let c = 0; c < cols; c++) {
        const td = $('td');
        const v = row[c] ?? '';
        if (v !== '') td.textContent = v;
        if (this._revealed && this._revealed.row === r && this._revealed.col === c) td.classList.add('excel-cell-revealed');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    this._gridScroll.textContent = '';
    this._gridScroll.appendChild(table);

    const shown = to - from;
    if (from > 0 || rowCount > to || sheet.truncated) {
      const note = $('div.excel-truncation-note');
      const span = from > 0
        ? `Showing rows ${(rowStart + from + 1).toLocaleString()} to ${(rowStart + to).toLocaleString()}`
        : `Showing the first ${shown.toLocaleString()} rows`;
      note.textContent = `${span}${sheet.truncated ? ' (workbook is larger than the viewer cap)' : ` of ${rowCount.toLocaleString()}`}. Open in a spreadsheet app for everything.`;
      this._gridScroll.appendChild(note);
    }

    this._gridScroll.scrollTop = 0;
  }

  /**
   * Show the sheet and cell a citation link points at: switch to the sheet,
   * render the rows around the cell, scroll it into view and mark it. A cell
   * outside the sheet's data leaves the view as it is.
   */
  private _applyReveal(target: IFileRevealTarget): void {
    if (this._sheets.length === 0) return;
    let sheetIndex = this._active;
    if (target.sheet) {
      const wanted = target.sheet.toLowerCase();
      const found = this._sheets.findIndex((s) => s.name.toLowerCase() === wanted);
      if (found >= 0) sheetIndex = found;
    }
    const sheet = this._sheets[sheetIndex];
    const ref = target.cell ? parseCellRef(target.cell) : undefined;
    const row = ref ? ref.row - (sheet.rowStart ?? 0) : -1;
    const col = ref ? ref.col - (sheet.colStart ?? 0) : -1;
    const inSheet = row >= 0 && row < sheet.rows.length && col >= 0 && col < Math.max(1, sheet.cols);

    if (sheetIndex !== this._active) {
      this._active = sheetIndex;
      if (this._current) this._current.activeSheet = sheetIndex;
      this._renderTabs();
    }
    this._revealed = inSheet ? { row, col } : null;
    this._renderFrom = inSheet && row >= RENDER_ROW_CAP ? Math.max(0, row - Math.floor(RENDER_ROW_CAP / 2)) : 0;
    this._renderActiveSheet();
    if (!inSheet) return;
    const td = this._gridScroll.querySelector('td.excel-cell-revealed');
    td?.scrollIntoView({ block: 'center', inline: 'center' });
  }

  private _showLoading(): void {
    this._gridScroll.textContent = '';
    this._tabsEl.textContent = '';
    hide(this._errorEl);
    show(this._loadingEl);
  }

  private _showError(message: string): void {
    this._gridScroll.textContent = '';
    this._tabsEl.textContent = '';
    hide(this._loadingEl);
    this._errorEl.textContent = message;
    show(this._errorEl);
  }
}
