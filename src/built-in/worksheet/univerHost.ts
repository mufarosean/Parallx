// univerHost.ts — the Univer spreadsheet engine host (M99).
//
// THIS FILE IS A SEPARATE BUNDLE. scripts/build.mjs compiles it to
// dist/renderer/worksheet-univer.js (+ .css), and the worksheet pane loads it
// with a runtime dynamic import the moment a practice sheet first opens. It
// must NEVER be statically imported from the main renderer tree — the engine
// is several megabytes, and pulling it into dist/renderer/main.js would tax
// every app boot on machines that never open a worksheet (type-only imports
// are fine; they erase).
//
// Everything Athena-fidelity-related that the PRESET can express lives here
// (no sheet-tab footer, no status-bar statistics); grid bounds and item
// semantics (givens fencing, Reset Sheet) belong to the pane layer above.

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import { IFunctionService } from '@univerjs/engine-formula';
import * as XLSX from 'xlsx';
import type { IWorkbookData, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/lib/facade';
import { ATHENA_FUNCTIONS } from './athenaFunctions.js';
import '@univerjs/presets/lib/styles/preset-sheets-core.css';

import { ATHENA_ROWS, ATHENA_COLUMNS } from './worksheetConstants.js';

export { ATHENA_ROWS, ATHENA_COLUMNS };

export interface IWorksheetHostOptions {
  /** Element the sheet mounts into. Must be attached and sized. */
  readonly container: HTMLElement;
  /**
   * Full workbook snapshot to restore (pane rebuilds, item loads). When
   * absent, a blank single-sheet Athena-bounded workbook is created.
   */
  readonly snapshot?: IWorkbookData | null;
}

export interface IWorksheetHost {
  /** Serializable full-workbook state (cells, formats, formulas). */
  getSnapshot(): IWorkbookData | null;
  /**
   * Export the current sheet to a real .xlsx (values + formulas; styling is
   * not carried — SheetJS community edition). Downloads via the browser
   * path, landing in the OS Downloads folder. Returns false when there is
   * nothing to export.
   */
  exportToXlsx(filename: string): boolean;
  /** Tear down the engine and all DOM it created. */
  dispose(): void;
}

/** Convert a workbook snapshot's cells into a SheetJS worksheet. */
function snapshotToSheetJs(snapshot: IWorkbookData): XLSX.WorkSheet | null {
  const sheets = (snapshot as unknown as {
    sheets?: Record<string, { cellData?: Record<string, Record<string, { v?: unknown; f?: string }>> }>;
  }).sheets;
  if (!sheets) return null;
  const ws: XLSX.WorkSheet = {};
  let maxRow = 0;
  let maxCol = 0;
  let any = false;
  for (const sheet of Object.values(sheets)) {
    for (const [rowStr, cols] of Object.entries(sheet.cellData ?? {})) {
      const r = Number(rowStr);
      for (const [colStr, data] of Object.entries(cols ?? {})) {
        const c = Number(colStr);
        if (data?.v === undefined && !data?.f) continue;
        const cell: XLSX.CellObject = { t: typeof data.v === 'number' ? 'n' : 's', v: data.v as string | number };
        if (data.f) cell.f = String(data.f).replace(/^=/, '');
        if (data.v === undefined) { cell.t = 'n'; delete cell.v; }
        ws[XLSX.utils.encode_cell({ r, c })] = cell;
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, c);
        any = true;
      }
    }
    break; // single-sheet surface
  }
  if (!any) return null;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  return ws;
}

let _hostCounter = 0;

/** A blank Athena-bounded workbook: one sheet, 150×40, no extras. */
export function blankWorkbookData(): Partial<IWorkbookData> {
  const unitId = `worksheet-${Date.now()}-${_hostCounter++}`;
  return {
    id: unitId,
    name: 'Practice Sheet',
    sheetOrder: ['sheet1'],
    sheets: {
      sheet1: {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: ATHENA_ROWS,
        columnCount: ATHENA_COLUMNS,
      },
    },
  };
}

/**
 * Athena fidelity (M99 S4): unregister every function the Pearson exam
 * driver does not support, so using one yields the same #NAME? the real
 * exam would — and it disappears from the fx catalog and autocomplete.
 * The allowlist is generated from Pearson's own comparison workbook.
 */
function applyAthenaFunctionSet(univer: Univer): void {
  try {
    const injector = univer.__getInjector();
    const fnService = injector.get(IFunctionService);
    const allowed = new Set(ATHENA_FUNCTIONS);
    const toRemove: string[] = [];
    for (const name of fnService.getDescriptions().keys()) {
      if (!allowed.has(String(name).toUpperCase())) toRemove.push(String(name));
    }
    if (toRemove.length) {
      fnService.unregisterExecutors(...toRemove);
      fnService.unregisterDescriptions(...toRemove);
      console.log(`[WorksheetHost] Athena function set applied — ${toRemove.length} non-exam functions removed, ${allowed.size} allowed`);
    }
  } catch (err) {
    // Filtering is fidelity, not safety — a Univer internals change must
    // degrade to "extra functions available", never to a broken sheet.
    console.warn('[WorksheetHost] Athena function filtering skipped:', err);
  }
}

export function createWorksheetHost(opts: IWorksheetHostOptions): IWorksheetHost {
  const created: { univer: Univer; univerAPI: FUniver } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS as Record<string, unknown>),
    },
    presets: [
      UniverSheetsCorePreset({
        container: opts.container,
        // Athena has no workbook: hide the sheet-tab footer entirely.
        footer: false,
        // No selection-statistics strip (not part of the exam surface).
        statusBarStatistic: false,
        // Real formula bar + ribbon ARE part of the exam surface.
        formulaBar: true,
        header: true,
        toolbar: true,
        contextMenu: true,
      }),
    ],
  });

  const { univer, univerAPI } = created;
  applyAthenaFunctionSet(univer);
  univerAPI.createWorkbook(opts.snapshot ?? blankWorkbookData());

  let disposed = false;
  const getSnapshot = (): IWorkbookData | null => {
    if (disposed) return null;
    try {
      return univerAPI.getActiveWorkbook()?.save() ?? null;
    } catch {
      return null;
    }
  };
  return {
    getSnapshot,
    exportToXlsx: (filename: string) => {
      const snapshot = getSnapshot();
      if (!snapshot) return false;
      const ws = snapshotToSheetJs(snapshot);
      if (!ws) return false;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
      return true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try { univer.dispose(); } catch { /* engine already gone */ }
    },
  };
}
