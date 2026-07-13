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

const PANE_ID = 'excel-editor-pane';
const RENDER_ROW_CAP = 1000;

const ICON = { sheet: getIcon('table') || getIcon('grid') };

interface SpreadsheetSheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
  readonly cols: number;
  readonly truncated: boolean;
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

  constructor() {
    super(PANE_ID);
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
    const shownRows = Math.min(rowCount, RENDER_ROW_CAP);
    this._metaEl.textContent = `${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'} × ${cols} col${cols === 1 ? '' : 's'}`;

    const table = $('table.excel-grid');

    // Header: corner + column letters
    const thead = $('thead');
    const headRow = $('tr');
    headRow.appendChild($('th.excel-corner'));
    for (let c = 0; c < cols; c++) {
      const th = $('th.excel-colhead');
      th.textContent = colLabel(c);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // Body: row-number gutter + cells (textContent — no injection)
    const tbody = $('tbody');
    for (let r = 0; r < shownRows; r++) {
      const row = sheet.rows[r] ?? [];
      const tr = $('tr');
      const rownum = $('th.excel-rownum');
      rownum.textContent = String(r + 1);
      tr.appendChild(rownum);
      for (let c = 0; c < cols; c++) {
        const td = $('td');
        const v = row[c] ?? '';
        if (v !== '') td.textContent = v;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    this._gridScroll.textContent = '';
    this._gridScroll.appendChild(table);

    if (rowCount > shownRows || sheet.truncated) {
      const note = $('div.excel-truncation-note');
      note.textContent = `Showing the first ${shownRows.toLocaleString()} rows${sheet.truncated ? ' (workbook is larger than the viewer cap)' : ` of ${rowCount.toLocaleString()}`} — open in a spreadsheet app for everything.`;
      this._gridScroll.appendChild(note);
    }

    this._gridScroll.scrollTop = 0;
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
