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
  /**
   * Sheet chrome mode. The PANE decides this (worksheet.sheetAppearance
   * setting: pinned light for exam fidelity, pinned dark, or app-following)
   * and drives live changes through setDarkMode — the engine host itself
   * never watches the app theme.
   */
  readonly darkMode?: boolean;
}

export interface IWorksheetHost {
  /** Serializable full-workbook state (cells, formats, formulas). */
  getSnapshot(): IWorkbookData | null;
  /** Flip the engine chrome between light and dark at runtime. */
  setDarkMode(dark: boolean): void;
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

interface SnapshotSheet {
  name?: string;
  cellData?: Record<string, Record<string, { v?: unknown; f?: string }>>;
  mergeData?: { startRow: number; startColumn: number; endRow: number; endColumn: number }[];
}

/** Convert one workbook sheet into a SheetJS worksheet (values, formulas,
 *  merges). Null when the sheet holds nothing exportable. */
function sheetToSheetJs(sheet: SnapshotSheet): XLSX.WorkSheet | null {
  const ws: XLSX.WorkSheet = {};
  let maxRow = 0;
  let maxCol = 0;
  let any = false;
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
  if (!any) return null;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  const merges = (sheet.mergeData ?? []).map((m) => ({
    s: { r: m.startRow, c: m.startColumn }, e: { r: m.endRow, c: m.endColumn },
  }));
  if (merges.length) ws['!merges'] = merges;
  return ws;
}

/** All sheets of a snapshot in tab order, as named SheetJS worksheets. */
function snapshotToSheetJs(snapshot: IWorkbookData): { name: string; ws: XLSX.WorkSheet }[] {
  const cast = snapshot as unknown as { sheetOrder?: string[]; sheets?: Record<string, SnapshotSheet> };
  const sheets = cast.sheets ?? {};
  const order = Array.isArray(cast.sheetOrder) && cast.sheetOrder.length > 0
    ? cast.sheetOrder.filter((id) => sheets[id])
    : Object.keys(sheets);
  const out: { name: string; ws: XLSX.WorkSheet }[] = [];
  for (const id of order) {
    const ws = sheetToSheetJs(sheets[id]);
    if (ws) out.push({ name: (sheets[id].name || `Sheet${out.length + 1}`).slice(0, 31), ws });
  }
  return out;
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

/** Body-level portal for Univer's popups/dropdowns. Editor panes clip
 *  overflow, so ribbon menus rendered inside the pane never show — the
 *  portal escapes that, and its z-index clears the app's overlay layers
 *  (dropdown lists sit at 10005 app-wide). */
const POPUP_ROOT_ID = 'ws-univer-popup-root';

function ensurePopupRoot(): void {
  if (document.getElementById(POPUP_ROOT_ID)) return;
  const root = document.createElement('div');
  root.id = POPUP_ROOT_ID;
  root.style.position = 'relative';
  root.style.zIndex = '10005';
  document.body.appendChild(root);
}

export function createWorksheetHost(opts: IWorksheetHostOptions): IWorksheetHost {
  ensurePopupRoot();
  const sheetsPresetConfig = {
    container: opts.container,
    // Workbook model (Mufaro): items carry parts on separate tabs, so the
    // sheet-tab footer is ON. (Athena itself has no tabs — deliberate
    // deviation, settled 2026-08-11.)
    footer: true,
    // No selection-statistics strip (not part of the exam surface).
    statusBarStatistic: false,
    // Real formula bar + ribbon ARE part of the exam surface.
    formulaBar: true,
    header: true,
    toolbar: true,
    contextMenu: true,
    // Reaches the UI plugin (IUniverUIConfig.popupRootId) even though the
    // preset's Pick<> doesn't re-export it — hence the cast. Toolbar menus
    // are screenshot-verified working with this portal; removing it does NOT
    // fix the grid right-click menu (tested), so that bug lies elsewhere.
    popupRootId: POPUP_ROOT_ID,
  };
  const created: { univer: Univer; univerAPI: FUniver } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS as Record<string, unknown>),
    },
    // Default LIGHT: the real Athena sheet is always white, so exam fidelity
    // wins unless the pane's sheet-appearance setting says otherwise.
    darkMode: opts.darkMode ?? false,
    presets: [
      UniverSheetsCorePreset(sheetsPresetConfig as unknown as Parameters<typeof UniverSheetsCorePreset>[0]),
    ],
  });

  const { univer, univerAPI } = created;

  // Stranded-tooltip sweep. Ribbon relayout (resize overflow, More-overlay
  // close) can unmount a hovered toolbar item mid-tooltip; Univer's Tooltip
  // hides ONLY via the trigger's mouseleave/blur, so the body-portaled
  // bubble (pointer-events:auto, gray-700) floats over the sheet forever —
  // the user-reported phantom. No event, real or synthetic, reaches it, and
  // one-shot sweeps lose the race against Univer's deferred relayout commits
  // (probe-verified). So: a legit tooltip only ever lives 8px from its
  // HOVERED trigger — any tooltip far from the pointer is stranded. Track
  // the pointer (bare coordinate store, no layout work — rafThrottle not
  // needed) and periodically hide far-away tooltips. display:none is safe
  // under React portals (later unmount still works); a fresh hover mounts a
  // new portal, so live tooltips are unaffected.
  const pointer = { x: -1e6, y: -1e6 };
  const trackPointer = (e: PointerEvent) => { pointer.x = e.clientX; pointer.y = e.clientY; };
  document.addEventListener('pointermove', trackPointer, { passive: true });
  const NEAR_PX = 64;
  const sweepInterval = setInterval(() => {
    const tips = document.body.querySelectorAll(':scope > [role="tooltip"]');
    for (const tip of tips) {
      const el = tip as HTMLElement;
      if (!el.className.includes('univer-') || el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - pointer.x, pointer.x - r.right, 0);
      const dy = Math.max(r.top - pointer.y, pointer.y - r.bottom, 0);
      if (Math.hypot(dx, dy) > NEAR_PX) el.style.display = 'none';
    }
  }, 700);

  /** Teardown leak guard: if univer.dispose() throws mid-unmount, React's
   *  BODY-level portals (radix popper wrappers — the More overlay — and
   *  tooltips) survive the pane teardown and float over the app forever.
   *  Hiding (never removing — removal breaks a live React commit) is safe
   *  in every case; an open dropdown of ANOTHER live pane just closes. */
  const hideBodyPortals = () => {
    for (const el of document.body.querySelectorAll(':scope > [data-radix-popper-content-wrapper], :scope > [role="tooltip"]')) {
      (el as HTMLElement).style.display = 'none';
    }
  };

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
    setDarkMode: (dark: boolean) => {
      if (disposed) return;
      try { univerAPI.toggleDarkMode(dark); } catch { /* engine disposed */ }
    },
    exportToXlsx: (filename: string) => {
      const snapshot = getSnapshot();
      if (!snapshot) return false;
      const sheets = snapshotToSheetJs(snapshot);
      if (sheets.length === 0) return false;
      const wb = XLSX.utils.book_new();
      const used = new Set<string>();
      for (const { name, ws } of sheets) {
        let tab = name;
        for (let n = 2; used.has(tab); n++) tab = `${name.slice(0, 28)} ${n}`;
        used.add(tab);
        XLSX.utils.book_append_sheet(wb, ws, tab);
      }
      XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
      return true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(sweepInterval);
      document.removeEventListener('pointermove', trackPointer);
      try {
        univer.dispose();
      } catch {
        // Engine teardown failed — its body-level portals may have leaked.
        hideBodyPortals();
      }
    },
  };
}
