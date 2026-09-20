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
// Pictures and text boxes from imported workbooks are floating images
// (Problem Bank, docs/PROBLEM_BANK.md); the drawing preset renders them.
import { UniverSheetsDrawingPreset } from '@univerjs/presets/preset-sheets-drawing';
import UniverPresetSheetsDrawingEnUS from '@univerjs/presets/preset-sheets-drawing/locales/en-US';
import { IFunctionService } from '@univerjs/engine-formula';
import { IContextMenuService, ContextMenuPosition, IShortcutService, KeyCode, MetaKeys } from '@univerjs/ui';
import { ICommandService, IContextService, IUniverInstanceService, UniverInstanceType, LifecycleService, LifecycleStages, CommandType, Direction, EDITOR_ACTIVATED, FOCUSING_SHEET, FOCUSING_UNIVER_EDITOR, DOCS_NORMAL_EDITOR_UNIT_ID_KEY, DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, getBodySlice, type DocumentDataModel } from '@univerjs/core';
import { ReplaceTextRunsCommand } from '@univerjs/docs-ui';
import { sequenceNodeType } from '@univerjs/engine-formula';
import { IEditorBridgeService, MoveSelectionCommand, MoveSelectionEnterAndTabCommand, SetCellEditVisibleOperation, SheetScrollManagerService, SheetSkeletonManagerService } from '@univerjs/sheets-ui';
import { SheetInterceptorService, INTERCEPTOR_POINT, SetSelectionsOperation, SetColHiddenMutation, SetColVisibleMutation } from '@univerjs/sheets';
import { DeviceInputEventType, IRenderManagerService, type IRender } from '@univerjs/engine-render';
import * as XLSX from 'xlsx';
import type { IWorkbookData, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/lib/facade';
import { ATHENA_FUNCTIONS } from './athenaFunctions.js';
import { roundForDisplay } from './displayNumbers.js';
import { restoreAbsoluteMarkers } from './formulaRefs.js';
import '@univerjs/presets/lib/styles/preset-sheets-core.css';
import '@univerjs/presets/lib/styles/preset-sheets-drawing.css';

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
  /**
   * Decimals an unformatted number paints (worksheet.displayDecimals);
   * null shows what the engine keeps. The stored value and the cell editor
   * keep full precision, and a number format set on a cell always wins.
   */
  readonly displayDecimals?: number | null;
  /**
   * Called when a formula in this sheet evaluates to an error value, with a
   * one-line diagnosis (formula, error, engine health). The pane records it
   * in the activity journal so an intermittent failure leaves evidence.
   */
  readonly onFormulaError?: (summary: string, detail: string) => void;
  /**
   * Called when the engine itself misbehaves outside a calculation (a
   * teardown that threw), with a one-line summary and the detail.
   */
  readonly onEngineFault?: (summary: string, detail: string) => void;
}

/** The user's place on a sheet: active cell and the viewport's first visible row and column. */
export interface SheetViewState {
  row: number;
  col: number;
  scrollRow: number;
  scrollCol: number;
}

/** Live hosts on the page (the quiz mounts and disposes one per problem). */
let _hostsAlive = 0;
/** Mounts so far in this window; part of every engine unit id. */
let _mountSeq = 0;

/**
 * A copy of the workbook data under another unit id: the id itself and
 * every `unitId` field inside plugin resources (drawings carry one per text
 * box). Resources are JSON strings, so each is parsed, rewritten and
 * serialised again; one that fails to parse is kept as it is.
 */
function withUnitId<T extends Partial<IWorkbookData>>(data: T, from: string, to: string): T {
  const swap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = k === 'unitId' && v === from ? to : swap(v);
      return out;
    }
    return value;
  };
  const resources = data.resources?.map((r) => {
    if (typeof r.data !== 'string') return r;
    try { return { ...r, data: JSON.stringify(swap(JSON.parse(r.data))) }; } catch { return r; }
  });
  return { ...data, id: to, ...(resources ? { resources } : {}) } as T;
}

export interface IWorksheetHost {
  /** Serializable full-workbook state (cells, formats, formulas). */
  getSnapshot(): IWorkbookData | null;
  /** Flip the engine chrome between light and dark at runtime. */
  setDarkMode(dark: boolean): void;
  /** Change how many decimals unformatted numbers paint, and repaint. */
  setDisplayDecimals(decimals: number | null): void;
  /**
   * Export the current sheet to a real .xlsx (values + formulas; styling is
   * not carried — SheetJS community edition). Downloads via the browser
   * path, landing in the OS Downloads folder. Returns false when there is
   * nothing to export.
   */
  exportToXlsx(filename: string): boolean;
  /** Write plain text into one cell of the active sheet (zero-based row and column). */
  setCellText(row: number, col: number, text: string): void;
  /**
   * Hide or show a run of columns on the active sheet IN PLACE, through the
   * engine's own command (Reveal Solution). Remounting on an edited snapshot
   * redrew the whole sheet, the flash Mufaro saw; this keeps the canvas, the
   * scroll and the selection. False when the engine refused (caller falls
   * back to a remount).
   */
  setColumnsHidden(startCol: number, count: number, hidden: boolean): boolean;
  /** A1 name of the active cell (probes, diagnostics); null when there is none. */
  getActiveCell(): string | null;
  /** Engine state for probes: active cell, selection, editor open, focus flags. */
  probeState(): Record<string, unknown>;
  /** Scroll the active sheet so the given cell is at the top-left (probes). */
  scrollToCell(row: number, col: number): boolean;
  /** Where the user is: the active cell and the viewport's first visible row and column. */
  getViewState(): SheetViewState | null;
  /** Put the viewport and the active cell back where getViewState found them. */
  restoreViewState(state: SheetViewState): void;
  /** Probe knob: switch the editor's follow-scroll off ('dom' is the shipped default). */
  setEditorFollowMode(mode: 'off' | 'dom'): void;
  /** Open the sheet's own right-click menu at a viewport point (probes; the app never needs it). */
  openContextMenu(clientX: number, clientY: number): void;
  /** Probes: write a formula through the facade and read a computed value back. */
  probeSetFormula(row: number, col: number, formula: string): boolean;
  probeReadValue(row: number, col: number): unknown;
  /** Probes: make a cell the active selection, as a click would. */
  probeActivate(row: number, col: number): boolean;
  /** Probes: open the cell editor on the active cell, as a double-click would. */
  probeStartEditing(): boolean;
  /** Probes: force a full recalculation. */
  probeRecalculate(): boolean;
  /** Fires after the engine hides or shows columns by any means: the sheet's own menu, our button, an undo. */
  onColumnsVisibilityChanged(listener: () => void): { dispose(): void };
  /**
   * A cell's contents were changed by the student: typing, pasting, clearing
   * or moving cells, and structural edits to rows and columns. This is the
   * Problem Bank's proof that a problem was worked, so it deliberately
   * ignores selection, scrolling, formatting and the engine's own formula
   * results, and it fires on every edit (the caller marks once).
   */
  onEdited(listener: () => void): { dispose(): void };
  /** Resolves once the engine reports itself rendered (or after a short fallback), so a pane can be swapped in already painted. */
  whenRendered(): Promise<void>;
  /** Tear down the engine and all DOM it created. */
  dispose(): void;
}

// A pane hidden with display:none (the editor keeps tabs alive that way)
// measures 0x0, and the engine's resize observer then resized every canvas
// to 0x0, which wipes its bitmap; the tab came back blank until the
// idle-time redraw (Mufaro, 2026-09-15: "navigating to a different tab and
// back causes flashes"). With the resize skipped while hidden, the canvas
// keeps its last picture, and a reveal at the same size repaints nothing.
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
      [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS as Record<string, unknown>, UniverPresetSheetsDrawingEnUS as Record<string, unknown>),
    },
    // Default LIGHT: the real Athena sheet is always white, so exam fidelity
    // wins unless the pane's sheet-appearance setting says otherwise.
    darkMode: opts.darkMode ?? false,
    presets: [
      UniverSheetsCorePreset(sheetsPresetConfig as unknown as Parameters<typeof UniverSheetsCorePreset>[0]),
      UniverSheetsDrawingPreset(),
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
  // Every mount gets its own engine unit id. The engine caches parsed
  // formulas at module level, keyed by unit id + formula text, shared by
  // every live instance in the window, and each cached node stays bound to
  // the config and runtime services of the instance that parsed it. A
  // problem mounted twice under its stored id (a tab and the quiz, or a
  // remount after a teardown that threw before the cache was cleared)
  // resolved references against the other instance's unit data; unit data
  // without the sheet reads as zero rows, so every reference reported
  // #NAME?, again on each Enter of the same text, until the app restarted
  // (Mufaro, 2026-09-17). Snapshots leave with the stored id put back, so
  // items, attempts and drawings never see the mount id.
  const stored = opts.snapshot ?? blankWorkbookData();
  const storedId = stored.id ?? 'worksheet';
  const mountId = `${storedId}~m${(_mountSeq++).toString(36)}${Date.now().toString(36)}`;
  univerAPI.createWorkbook(withUnitId(stored, storedId, mountId));

  let disposed = false;
  let renderedResolve: () => void = () => {};
  const rendered = new Promise<void>((resolve) => { renderedResolve = resolve; });

  // Array formulas keep their spilled cells in the engine, not in the saved
  // snapshot, so a sheet reopened from a snapshot showed only the first cell
  // of every spill (Mufaro, 2026-09-14: "formula spillage does not work
  // consistently"). A full recalculation on mount brings them back; the
  // snapshot itself does not change, so the autosave baseline holds.
  // The engine registers the workbook's formulas a moment after creation
  // (a recalculation at 0 ms did nothing in the probe); it runs once the
  // engine reports itself rendered, with a timer as the fallback.
  {
    let recalculated = false;
    const recalculate = () => {
      if (disposed || recalculated) return;
      recalculated = true;
      try { univerAPI.getFormula().executeCalculation(); } catch (err) { console.warn('[Worksheet] recalculation on mount failed:', err); }
    };
    try {
      const lifecycle = univer.__getInjector().get(LifecycleService);
      const sub = lifecycle.lifecycle$.subscribe((stage) => { if (stage >= LifecycleStages.Rendered) { sub.unsubscribe(); renderedResolve(); setTimeout(recalculate, 150); } });
    } catch { /* fallback timer below */ }
    setTimeout(() => { renderedResolve(); recalculate(); }, 1500);
  }

  // Excel's Shift+Tab and Shift+Enter WHILE EDITING a cell: commit and move
  // left, or up. Univer ends the edit on Tab and Enter but reads no modifier
  // (its _moveSelection maps TAB to RIGHT and ENTER to DOWN outright), so
  // Shift+Tab committed and jumped right (Mufaro, 2026-09-08). Caught on the
  // container in the capture phase, ahead of the editor's own key handler,
  // and only while the editor is open: with nothing being edited, Univer's
  // own shortcuts already move the selection left and up. The commit goes
  // through the engine's end-of-edit operation with an arrow keycode, the
  // same path its editor takes, so formulas and formats settle as usual.
  const onEditKeydown = (e: KeyboardEvent): void => {
    if (disposed || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    try {
      const injector = univer.__getInjector();
      const bridge = injector.get(IEditorBridgeService);
      // The cell editor is open (not merely the sheet focused).
      if (bridge.isVisible().visible !== true) return;
      const unitId = univerAPI.getActiveWorkbook()?.getId();
      if (!unitId) return;
      e.preventDefault();
      e.stopPropagation();
      bridge.disableForceKeepVisible();
      injector.get(ICommandService).syncExecuteCommand(SetCellEditVisibleOperation.id, {
        visible: false,
        eventType: DeviceInputEventType.Keyboard,
        keycode: e.key === 'Tab' ? KeyCode.ARROW_LEFT : KeyCode.ARROW_UP,
        unitId,
      });
    } catch (err) {
      console.warn('[Worksheet] Shift+Tab/Enter commit failed:', err);
    }
  };
  opts.container.addEventListener('keydown', onEditKeydown, true);

  // Idle Shift+Tab and Shift+Enter (nothing being edited): Univer 0.25's own
  // reverse move, MoveSelectionEnterAndTabCommand with LEFT or UP, drops the
  // selection outright, and no key does anything until the next click
  // (probe, 2026-09-08). The shortcut service runs the highest-priority match
  // for a binding, so a plain move steps in front of it.
  const engineRegistrations: { dispose(): void }[] = [];

  // A formula that points at another cell (=B7) came back wearing that
  // cell's number format: the engine tags each result with the referenced
  // pattern (objectValueToCellValue) and the apply step keeps it when the
  // formula cell has none (Excel's General-cell inheritance). Mufaro,
  // 2026-09-15: a reference pulls the value, never the formatting. The tag is
  // dropped from the result mutations before they land; explicit formats on
  // the formula cell are untouched.
  {
    const RESULT_MUTATIONS = new Set(['formula.mutation.set-formula-calculation-result', 'formula.mutation.set-array-formula-data']);
    const stripResultStyles = (units: unknown): void => {
      if (!units || typeof units !== 'object') return;
      for (const sheets of Object.values(units as Record<string, unknown>)) {
        if (!sheets || typeof sheets !== 'object') continue;
        for (const rows of Object.values(sheets as Record<string, unknown>)) {
          if (!rows || typeof rows !== 'object') continue;
          for (const cols of Object.values(rows as Record<string, unknown>)) {
            if (!cols || typeof cols !== 'object') continue;
            for (const cell of Object.values(cols as Record<string, { s?: unknown } | null>)) {
              if (cell && typeof cell === 'object' && 's' in cell) delete cell.s;
            }
          }
        }
      }
    };
    engineRegistrations.push(univer.__getInjector().get(ICommandService).beforeCommandExecuted((c) => {
      if (!RESULT_MUTATIONS.has(c.id)) return;
      const params = c.params as { unitData?: unknown; arrayFormulaCellData?: unknown } | undefined;
      stripResultStyles(params?.unitData);
      stripResultStyles(params?.arrayFormulaCellData);
    }));
  }
  // Formula errors leave evidence (Mufaro, 2026-09-14: formulas failing
  // intermittently in a long session, cleared by a restart, never reproduced
  // outside the app). Every calculation result is scanned for error values;
  // each one is reported once per cell with the formula text and the state
  // of the engine at that moment.
  _hostsAlive++;
  const mountedAt = Date.now();
  const reportedErrors = new Set<string>();
  const ERROR_VALUE = /^#(NAME\?|VALUE!|REF!|DIV\/0!|N\/A|NUM!|NULL!|SPILL!|CALC!)$/;
  try {
    const injector = univer.__getInjector();
    const fnService = injector.get(IFunctionService);
    engineRegistrations.push(injector.get(ICommandService).onCommandExecuted((c) => {
      if (c.id !== 'formula.mutation.set-formula-calculation-result') return;
      const unitData = (c.params as { unitData?: Record<string, Record<string, Record<string, Record<string, { v?: unknown }>>>> } | undefined)?.unitData;
      if (!unitData) return;
      const sheet = univerAPI.getActiveWorkbook()?.getActiveSheet();
      for (const sheets of Object.values(unitData)) for (const rows of Object.values(sheets)) for (const [r, cols] of Object.entries(rows)) for (const [col, cell] of Object.entries(cols)) {
        const v = cell?.v;
        if (typeof v !== 'string' || !ERROR_VALUE.test(v)) continue;
        const row = Number(r), column = Number(col);
        let formula = '';
        try { formula = String(sheet?.getRange(row, column)?.getFormula() ?? ''); } catch { formula = '?'; }
        const key = `${row}:${column}:${formula}:${v}`;
        if (reportedErrors.has(key)) continue;
        reportedErrors.add(key);
        const executors = fnService.getExecutors().size;
        const health = { executors, multiply: fnService.hasExecutor('MULTIPLY'), sum: fnService.hasExecutor('SUM'), hostsAlive: _hostsAlive, sinceMountS: Math.round((Date.now() - mountedAt) / 1000), decimals: displayDecimals };
        const cellName = `${(() => { let n = column + 1, s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; })()}${row + 1}`;
        const summary = `${cellName} ${formula || '(no formula)'} -> ${v}`;
        console.warn('[WorksheetHost] formula error', summary, health);
        try { opts.onFormulaError?.(summary, JSON.stringify(health)); } catch { /* journal unavailable */ }
      }
    }));
  } catch (err) {
    console.warn('[Worksheet] formula error watch not attached:', err);
  }

  const REVERSE_MOVE_ID = 'parallx.sheet.move-selection-reverse';
  // Unformatted numbers paint with a bounded number of decimals (Mufaro,
  // 2026-09-14: every computed cell showed twelve). A cell-content
  // interceptor rounds the painted value of a number that carries no number
  // format; the stored value, formulas and the cell editor keep full
  // precision, as they do under an Excel number format.
  let displayDecimals: number | null = opts.displayDecimals ?? null;
  try {
    const interceptors = univer.__getInjector().get(SheetInterceptorService);
    engineRegistrations.push(interceptors.intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
      id: 'parallx.sheet.display-decimals',
      priority: 20,
      handler: (cell, location, next) => {
        if (!cell || typeof cell.v !== 'number' || displayDecimals === null) return next(cell);
        const pattern = location.workbook.getStyles().get(cell.s)?.n?.pattern;
        if (pattern && pattern !== 'General') return next(cell);
        const v = roundForDisplay(cell.v, displayDecimals);
        return v === cell.v ? next(cell) : next({ ...cell, v });
      },
    }));
  } catch (err) {
    console.warn('[Worksheet] display decimals not applied:', err);
  }
  // Enter after a Tab run. Excel returns to the column where the run began,
  // and forgets the run the moment you navigate any other way (a click, an
  // arrow key). Univer 0.25 records the run's start on the first Tab and
  // forgets it only when Enter uses it, so a click elsewhere followed by
  // typing and Enter jumps back to that old column (Mufaro, 2026-09-14:
  // "Enter sends you to an unpredictable cell"). The service holding that
  // memory is not exported; it is found in the injector by its shape and
  // cleared on every selection change that is not part of a Tab run.
  type TabRunMemory = { remove(search: { unitId: string; sheetId: string; keycode: number }): unknown; getCurrentBySearch: unknown; addOrUpdate: unknown };
  type InjectorShape = {
    dependencyCollection?: { dependencyMap?: Map<unknown, unknown> };
    resolvedDependencyCollection?: { resolvedDependencies?: Map<unknown, unknown[]> };
    children?: InjectorShape[];
    get(id: unknown): unknown;
  };
  const looksLikeTabRunMemory = (o: unknown): o is TabRunMemory =>
    !!o && typeof o === 'object' && typeof (o as TabRunMemory).remove === 'function'
    && typeof (o as TabRunMemory).getCurrentBySearch === 'function' && typeof (o as TabRunMemory).addOrUpdate === 'function';
  let tabRunMemory: TabRunMemory | null = null;
  const findTabRunMemory = (): TabRunMemory | null => {
    if (tabRunMemory) return tabRunMemory;
    const queue: InjectorShape[] = [univer.__getInjector() as unknown as InjectorShape];
    while (queue.length) {
      const inj = queue.shift()!;
      for (const items of inj.resolvedDependencyCollection?.resolvedDependencies?.values() ?? []) {
        const inst = Array.isArray(items) ? items[0] : items;
        if (looksLikeTabRunMemory(inst)) return (tabRunMemory = inst);
      }
      for (const id of inj.dependencyCollection?.dependencyMap?.keys() ?? []) {
        const proto = typeof id === 'function' ? (id as { prototype?: unknown }).prototype : null;
        if (proto && looksLikeTabRunMemory(proto)) {
          try { const inst = inj.get(id); if (looksLikeTabRunMemory(inst)) return (tabRunMemory = inst); } catch { /* not constructible from here */ }
        }
      }
      queue.push(...(inj.children ?? []));
    }
    return null;
  };
  try {
    const commands = univer.__getInjector().get(ICommandService);
    let tabRunStepAt = 0;
    const isTabStep = (c: { id: string; params?: unknown }): boolean =>
      (c.id === MoveSelectionEnterAndTabCommand.id && (c.params as { keycode?: number } | undefined)?.keycode === KeyCode.TAB)
      || (c.id === REVERSE_MOVE_ID && (c.params as { direction?: Direction } | undefined)?.direction === Direction.LEFT);
    engineRegistrations.push(commands.beforeCommandExecuted((c) => { if (isTabStep(c)) tabRunStepAt = Date.now(); }));
    engineRegistrations.push(commands.onCommandExecuted((c) => {
      if (c.id !== SetSelectionsOperation.id || Date.now() - tabRunStepAt < 50) return;
      const unitId = univerAPI.getActiveWorkbook()?.getId();
      const sheetId = univerAPI.getActiveWorkbook()?.getActiveSheet()?.getSheetId();
      if (!unitId || !sheetId) return;
      try { findTabRunMemory()?.remove({ unitId, sheetId, keycode: KeyCode.TAB }); } catch { /* engine default stays */ }
    }));
  } catch (err) {
    console.warn('[Worksheet] Tab-run memory guard not attached:', err);
  }
  // Dollar signs survive a reference drag (Mufaro, 2026-09-14; reproduced
  // by a probe). Dragging or resizing a highlighted reference box makes the
  // formula editor rewrite every reference from the drawn boxes, which carry
  // no absolute markers, so $A$1 elsewhere in the formula came back as A1.
  // The rewrite is one ReplaceTextRunsCommand on the cell editor: the text
  // before it is read just ahead of the command, compared with the text
  // after, and when the markers were dropped by such a rewrite (a reference
  // moved, or every reference lost them) the editor gets the corrected text
  // back. F4 toggles and typing never match that shape (formulaRefs.ts).
  try {
    const injector = univer.__getInjector();
    const commands = injector.get(ICommandService);
    const instances = injector.get(IUniverInstanceService);
    const EDITORS = new Set<string>([DOCS_NORMAL_EDITOR_UNIT_ID_KEY, DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY]);
    const editorText = (unitId: string): string | null => {
      const doc = instances.getUnit<DocumentDataModel>(unitId, UniverInstanceType.UNIVER_DOC);
      const stream = doc?.getBody()?.dataStream;
      return typeof stream === 'string' ? stream.replace(/\r\n$/, '') : null;
    };
    let before: { unitId: string; text: string } | null = null;
    let restoring = false;
    // A reference box is dragged with the pointer while the editor is open;
    // the rewrite lands during the drag or right after the release.
    let pointerDownAt = 0;
    let pointerUpAt = 0;
    const bridge = injector.get(IEditorBridgeService);
    const onPointerDown = () => { try { if (bridge.isVisible().visible === true) pointerDownAt = Date.now(); } catch { /* engine gone */ } };
    const onPointerUp = () => { if (pointerDownAt) pointerUpAt = Date.now(); };
    opts.container.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    engineRegistrations.push({ dispose: () => { opts.container.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('pointerup', onPointerUp, true); } });
    const duringDrag = (): boolean => {
      if (!pointerDownAt) return false;
      const now = Date.now();
      if (now - pointerDownAt > 60000) return false;
      return pointerUpAt < pointerDownAt || now - pointerUpAt < 1500;
    };
    engineRegistrations.push(commands.beforeCommandExecuted((c) => {
      if (restoring || c.id !== ReplaceTextRunsCommand.id) return;
      const unitId = (c.params as { unitId?: string } | undefined)?.unitId ?? '';
      if (!EDITORS.has(unitId)) { before = null; return; }
      const text = editorText(unitId);
      before = text && text.startsWith('=') ? { unitId, text } : null;
    }));
    engineRegistrations.push(commands.onCommandExecuted((c) => {
      if (restoring || c.id !== ReplaceTextRunsCommand.id || !before) return;
      const { unitId, text: oldText } = before;
      before = null;
      if ((c.params as { unitId?: string } | undefined)?.unitId !== unitId) return;
      const newText = editorText(unitId);
      if (!newText || newText === oldText || !newText.startsWith('=')) return;
      const parse = (t: string) => { try { return univerAPI.getFormula().sequenceNodesBuilder(t) ?? null; } catch { return null; } };
      const oldNodes = parse(oldText);
      const newNodes = parse(newText);
      if (!oldNodes || !newNodes) return;
      const restored = restoreAbsoluteMarkers(oldNodes, newNodes, sequenceNodeType.REFERENCE, duringDrag());
      if (!restored) return;
      const fixed = restored.startsWith('=') ? restored : `=${restored}`;
      if (fixed === newText) return;
      const doc = instances.getUnit<DocumentDataModel>(unitId, UniverInstanceType.UNIVER_DOC);
      const body = doc?.getBody();
      if (!body) return;
      restoring = true;
      try {
        // The same body shape the editor itself writes: the text without its
        // trailing paragraph mark, no runs (the editor recolours references).
        const slice = getBodySlice({ ...body, dataStream: `${fixed}\r\n`, textRuns: [] }, 0, fixed.length);
        commands.syncExecuteCommand(ReplaceTextRunsCommand.id, { unitId, body: slice, textRanges: [{ startOffset: fixed.length, endOffset: fixed.length }] });
      } catch (err) {
        console.warn('[Worksheet] dollar-sign restore failed:', err);
      } finally {
        restoring = false;
      }
    }));
  } catch (err) {
    console.warn('[Worksheet] dollar-sign guard not attached:', err);
  }
  const repaint = () => {
    try {
      const unitId = univerAPI.getActiveWorkbook()?.getId();
      const render = unitId ? univer.__getInjector().get(IRenderManagerService).getRenderById(unitId) : null;
      render?.with(SheetSkeletonManagerService).reCalculate();
      render?.mainComponent?.makeDirty(true);
    } catch (err) {
      console.warn('[Worksheet] display decimals repaint failed:', err);
    }
  };
  try {
    const injector = univer.__getInjector();
    engineRegistrations.push(injector.get(ICommandService).registerCommand({
      id: REVERSE_MOVE_ID,
      type: CommandType.COMMAND,
      handler: (accessor, params?: { direction?: Direction }) =>
        accessor.get(ICommandService).syncExecuteCommand(MoveSelectionCommand.id, { direction: params?.direction ?? Direction.LEFT }),
    }));
    const idleSheet = (ctx: { getContextValue(key: string): boolean }) =>
      ctx.getContextValue(FOCUSING_SHEET) && ctx.getContextValue(FOCUSING_UNIVER_EDITOR) && !ctx.getContextValue(EDITOR_ACTIVATED);
    const shortcuts = injector.get(IShortcutService);
    engineRegistrations.push(shortcuts.registerShortcut({ id: REVERSE_MOVE_ID, description: 'Select the cell to the left', group: '3_sheet-view', binding: KeyCode.TAB | MetaKeys.SHIFT, priority: 1000, preconditions: idleSheet, staticParameters: { direction: Direction.LEFT } }));
    engineRegistrations.push(shortcuts.registerShortcut({ id: REVERSE_MOVE_ID, description: 'Select the cell above', group: '3_sheet-view', binding: KeyCode.ENTER | MetaKeys.SHIFT, priority: 1000, preconditions: idleSheet, staticParameters: { direction: Direction.UP } }));
  } catch (err) {
    console.warn('[Worksheet] reverse-move shortcuts not registered:', err);
  }

  // The floating cell editor follows the sheet when it scrolls. Univer 0.25
  // fixes the editor's screen position once, when editing starts, and every
  // keystroke re-places it there, so while a formula is being typed the box
  // stays put on screen as the grid moves under it; scroll back to any other
  // offset and it sits over the wrong cell (Mufaro, 2026-09-08: picking a
  // reference far to the left). On each scroll of the sheet's main viewport
  // while the editor is open, recompute the editor's layout from the current
  // scroll (position only; the typed text is untouched) and let the engine's
  // own resize service re-place the box. Coalesced to one refresh per frame.
  type FollowMode = 'off' | 'dom';
  const follow = { attached: false, signals: 0, refreshes: 0, error: '', mode: 'dom' as FollowMode, last: null as Record<string, unknown> | null };
  /** The floating cell editor's positioned wrapper (the engine's EditorContainer root). */
  const editorWrapper = (): HTMLElement | null => {
    for (const el of opts.container.querySelectorAll<HTMLElement>('.univer-absolute.univer-z-10')) {
      if (el.style.left && Number.parseFloat(el.style.left) > -500 && el.querySelector('canvas')) return el;
    }
    return null;
  };
  // Probe diagnostics: the last engine commands executed.
  const recentCommands: string[] = [];
  try {
    const cmdSub = univer.__getInjector().get(ICommandService).onCommandExecuted((c) => { recentCommands.push(c.id); if (recentCommands.length > 40) recentCommands.shift(); });
    engineRegistrations.push({ dispose: () => cmdSub.dispose() });
  } catch { /* diagnostics only */ }
  const attachEditorFollow = (render: IRender, attempt = 0): void => {
    if (disposed) return;
    // Two scroll signals: the main viewport's after-scroll event (wheel, bar)
    // and the sheet scroll manager's raw feed (commands, scroll-to-cell). Both
    // come into being a moment after the render unit itself, so this retries
    // briefly until both resolve.
    const viewportMain = render.scene?.getViewport('viewMain');
    let scrollManager: SheetScrollManagerService | null = null;
    try { scrollManager = render.with(SheetScrollManagerService); } catch { scrollManager = null; }
    if (!viewportMain || !scrollManager) {
      if (attempt < 40) setTimeout(() => attachEditorFollow(render, attempt + 1), 250);
      else follow.error = `follow not attached: viewport=${!!viewportMain} scrollManager=${!!scrollManager}`;
      return;
    }
    try {
      const injector = univer.__getInjector();
      const bridge = injector.get(IEditorBridgeService);
      let frame = 0;
      let trailing: ReturnType<typeof setTimeout> | null = null;
      // Recompute where the cell is and translate the box by the difference.
      // Idempotent: with nothing moved the delta is zero, so it is safe to run
      // again a little later, which covers a signal that arrives before the
      // viewport has actually moved (scroll-to-cell fires its raw signal
      // first, and a short animated scroll settles over a few frames).
      const refresh = (): void => {
        if (disposed || bridge.isVisible().visible !== true) return;
        try {
            // Refresh the engine's idea of where the cell is (so its own next
            // re-place, on the next keystroke, lands right), then translate
            // the box itself by exactly what the cell moved. No engine state
            // is written: pushing the editor manager's state re-ran the editor
            // container's effects and left the editor deaf to Enter, Escape
            // and reference clicks; the engine's resize routine did the same
            // (probe, 2026-09-08). Pixels = cell coordinates * (canvas client
            // width / canvas CSS width), the engine's own placement formula.
            const before = bridge.getEditCellState()?.position;
            bridge.refreshEditCellPosition(false);
            const after = bridge.getEditCellState()?.position;
            const el = editorWrapper();
            const diag: Record<string, unknown> = { found: !!el, before: before ? [before.startX, before.startY] : null, after: after ? [after.startX, after.startY] : null };
            if (before && after && el) {
              const canvasEl = render.engine.getCanvasElement();
              const cssWidth = Number.parseInt(canvasEl.style.width, 10);
              const k = cssWidth > 0 ? canvasEl.getBoundingClientRect().width / cssWidth : 1;
              const dx = (after.startX - before.startX) * k;
              const dy = (after.startY - before.startY) * k;
              diag.dx = dx; diag.dy = dy;
              if (dx !== 0) el.style.left = `${Number.parseFloat(el.style.left) + dx}px`;
              if (dy !== 0) el.style.top = `${Number.parseFloat(el.style.top) + dy}px`;
            }
            follow.last = diag;
            follow.refreshes++;
          } catch (err) { follow.error = String(err); }
      };
      const onScroll = (): void => {
        follow.signals++;
        if (disposed || follow.mode === 'off' || bridge.isVisible().visible !== true) return;
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            refresh();
            requestAnimationFrame(refresh);
          });
        }
        if (trailing) clearTimeout(trailing);
        trailing = setTimeout(() => { trailing = null; refresh(); }, 160);
      };
      const vsub = viewportMain.onScrollAfter$.subscribeEvent(onScroll);
      const msub = scrollManager.rawScrollInfo$.subscribe(onScroll);
      engineRegistrations.push({ dispose: () => { vsub.unsubscribe(); msub.unsubscribe(); if (frame) cancelAnimationFrame(frame); if (trailing) clearTimeout(trailing); } });
      follow.attached = true;
    } catch (err) {
      follow.error = String(err);
      console.warn('[Worksheet] editor follow-scroll not attached:', err);
    }
  };
  try {
    const renderManager = univer.__getInjector().get(IRenderManagerService);
    const unitId = univerAPI.getActiveWorkbook()?.getId();
    const existing = unitId ? renderManager.getRenderById(unitId) : null;
    if (existing) attachEditorFollow(existing);
    else {
      // The render unit is created a tick after the workbook.
      const created = renderManager.created$.subscribe((render) => {
        if (unitId && render.unitId !== unitId) return;
        created.unsubscribe();
        attachEditorFollow(render);
      });
      engineRegistrations.push({ dispose: () => created.unsubscribe() });
    }
  } catch (err) {
    console.warn('[Worksheet] editor follow-scroll setup failed:', err);
  }
  const setCellText = (row: number, col: number, text: string): void => {
    if (disposed) return;
    try {
      univerAPI.getActiveWorkbook()?.getActiveSheet()?.getRange(row, col)?.setValue(text);
    } catch (err) {
      console.warn('[Worksheet] setCellText failed:', err);
    }
  };
  const probeSetFormula = (row: number, col: number, formula: string): boolean => {
    if (disposed) return false;
    try { univerAPI.getActiveWorkbook()?.getActiveSheet()?.getRange(row, col)?.setFormula(formula); return true; } catch (err) { console.warn('[Worksheet] probeSetFormula failed:', err); return false; }
  };
  const probeReadValue = (row: number, col: number): unknown => {
    if (disposed) return null;
    try { return univerAPI.getActiveWorkbook()?.getActiveSheet()?.getRange(row, col)?.getValue() ?? null; } catch { return null; }
  };
  const probeActivate = (row: number, col: number): boolean => {
    if (disposed) return false;
    try { univerAPI.getActiveWorkbook()?.getActiveSheet()?.getRange(row, col)?.activate(); return true; } catch { return false; }
  };
  const probeStartEditing = (): boolean => {
    if (disposed) return false;
    try {
      const unitId = univerAPI.getActiveWorkbook()?.getId();
      if (!unitId) return false;
      return univer.__getInjector().get(ICommandService).syncExecuteCommand(SetCellEditVisibleOperation.id, { visible: true, eventType: DeviceInputEventType.Dblclick, unitId });
    } catch (err) { console.warn('[Worksheet] probeStartEditing failed:', err); return false; }
  };
  // Commands that change what a cell holds. Ids verified against the
  // installed @univerjs/sheets build; anything not listed (selection moves,
  // scrolling, styling, formula results) is not work.
  const EDIT_COMMANDS = new Set([
    'sheet.command.set-range-values',
    'sheet.command.auto-clear-content',
    'sheet.command.clear-selection-all',
    'sheet.command.clear-selection-content',
    'sheet.command.delete-range-move-left',
    'sheet.command.delete-range-move-up',
    'sheet.command.insert-range-move-down',
    'sheet.command.insert-range-move-right',
    'sheet.command.move-range',
    'sheet.command.paste',
    'sheet.command.paste-value',
    'sheet.command.optional-paste',
    'sheet.command.insert-row', 'sheet.command.insert-row-after', 'sheet.command.insert-row-before',
    'sheet.command.insert-col', 'sheet.command.insert-col-after', 'sheet.command.insert-col-before',
    'sheet.command.remove-row', 'sheet.command.remove-col',
  ]);
  const onEdited = (listener: () => void): { dispose(): void } => {
    if (disposed) return { dispose: () => {} };
    try {
      return univer.__getInjector().get(ICommandService).onCommandExecuted((c) => {
        if (!EDIT_COMMANDS.has(c.id)) return;
        try { listener(); } catch { /* pane torn down */ }
      });
    } catch { return { dispose: () => {} }; }
  };
  const onColumnsVisibilityChanged = (listener: () => void): { dispose(): void } => {
    if (disposed) return { dispose: () => {} };
    try {
      return univer.__getInjector().get(ICommandService).onCommandExecuted((c) => {
        if (c.id === SetColHiddenMutation.id || c.id === SetColVisibleMutation.id) { try { listener(); } catch { /* pane torn down */ } }
      });
    } catch { return { dispose: () => {} }; }
  };
  const probeRecalculate = (): boolean => { if (disposed) return false; try { univerAPI.getFormula().executeCalculation(); return true; } catch { return false; } };
  const setColumnsHidden = (startCol: number, count: number, hidden: boolean): boolean => {
    if (disposed || count <= 0 || startCol < 0) return false;
    try {
      const sheet = univerAPI.getActiveWorkbook()?.getActiveSheet();
      if (!sheet) return false;
      if (hidden) sheet.hideColumns(startCol, count); else sheet.showColumns(startCol, count);
      return true;
    } catch (err) {
      console.warn('[Worksheet] setColumnsHidden failed:', err);
      return false;
    }
  };
  const getActiveCell = (): string | null => {
    if (disposed) return null;
    try {
      return univerAPI.getActiveWorkbook()?.getActiveSheet()?.getActiveCell()?.getA1Notation() ?? null;
    } catch {
      return null;
    }
  };
  const probeState = (): Record<string, unknown> => {
    if (disposed) return { disposed: true };
    try {
      const injector = univer.__getInjector();
      const ctx = injector.get(IContextService);
      const sheet = univerAPI.getActiveWorkbook()?.getActiveSheet();
      const sel = sheet?.getSelection();
      return {
        activeCell: getActiveCell(),
        activeRange: sel?.getActiveRange()?.getA1Notation() ?? null,
        currentCell: (() => { const c = sel?.getCurrentCell(); return c ? `r${c.actualRow}c${c.actualColumn}` : null; })(),
        editorVisible: injector.get(IEditorBridgeService).isVisible().visible,
        tabRunMemory: !!findTabRunMemory(),
        hostsAlive: _hostsAlive,
        executors: injector.get(IFunctionService).getExecutors().size,
        editorActivated: ctx.getContextValue(EDITOR_ACTIVATED),
        focusingSheet: ctx.getContextValue('FOCUSING_SHEET'),
        focusingUniverEditor: ctx.getContextValue('FOCUSING_UNIVER_EDITOR'),
        activeElement: document.activeElement ? `${document.activeElement.tagName}.${String(document.activeElement.className).slice(0, 50)}` : 'none',
        follow: { ...follow },
        recentCommands: recentCommands.splice(0, recentCommands.length),
        scroll: (() => { try { const s = sheet?.getScrollState(); return s ? { startCol: s.sheetViewStartColumn, startRow: s.sheetViewStartRow, offsetX: s.offsetX, offsetY: s.offsetY } : null; } catch { return null; } })(),
      };
    } catch (err) {
      return { error: String(err) };
    }
  };
  const getViewState = (): SheetViewState | null => {
    if (disposed) return null;
    try {
      const workbook = univerAPI.getActiveWorkbook();
      const sheet = workbook?.getActiveSheet();
      const cell = sheet?.getActiveCell();
      const unitId = workbook?.getId();
      const render = unitId ? univer.__getInjector().get(IRenderManagerService).getRenderById(unitId) : null;
      const scroll = render?.with(SheetScrollManagerService).getCurrentScrollState();
      return {
        row: cell?.getRow() ?? 0,
        col: cell?.getColumn() ?? 0,
        scrollRow: scroll?.sheetViewStartRow ?? 0,
        scrollCol: scroll?.sheetViewStartColumn ?? 0,
      };
    } catch {
      return null;
    }
  };
  const restoreViewState = (state: SheetViewState): void => {
    if (disposed) return;
    try {
      const sheet = univerAPI.getActiveWorkbook()?.getActiveSheet();
      if (!sheet) return;
      sheet.scrollToCell(state.scrollRow, state.scrollCol);
      sheet.getRange(state.row, state.col).activate();
    } catch (err) {
      console.warn('[Worksheet] restoreViewState failed:', err);
    }
  };
  const scrollToCell = (row: number, col: number): boolean => {
    if (disposed) return false;
    try {
      const sheet = univerAPI.getActiveWorkbook()?.getActiveSheet();
      if (!sheet) return false;
      sheet.scrollToCell(row, col);
      return true;
    } catch (err) {
      console.warn('[Worksheet] scrollToCell failed:', err);
      return false;
    }
  };
  const openContextMenu = (clientX: number, clientY: number): void => {
    if (disposed) return;
    try {
      const injector = (univer as unknown as { __getInjector(): { get<T>(id: unknown): T } }).__getInjector();
      const service = injector.get<{ triggerContextMenu(event: unknown, position: unknown): void }>(IContextMenuService);
      service.triggerContextMenu({ clientX, clientY, preventDefault() { /* synthetic */ }, stopPropagation() { /* synthetic */ } }, ContextMenuPosition.MAIN_AREA);
    } catch (err) {
      console.warn('[Worksheet] openContextMenu failed:', err);
    }
  };
  const getSnapshot = (): IWorkbookData | null => {
    if (disposed) return null;
    try {
      const live = univerAPI.getActiveWorkbook()?.save() ?? null;
      return live ? withUnitId(live, mountId, storedId) : null;
    } catch {
      return null;
    }
  };
  return {
    getSnapshot,
    setCellText,
    setColumnsHidden,
    getActiveCell,
    probeState,
    scrollToCell,
    getViewState,
    restoreViewState,
    setEditorFollowMode: (mode) => { follow.mode = mode; },
    openContextMenu,
    probeSetFormula,
    probeReadValue,
    probeActivate,
    probeStartEditing,
    probeRecalculate,
    onColumnsVisibilityChanged,
    onEdited,
    setDarkMode: (dark: boolean) => {
      if (disposed) return;
      try { univerAPI.toggleDarkMode(dark); } catch { /* engine disposed */ }
    },
    setDisplayDecimals: (decimals: number | null) => {
      if (disposed || decimals === displayDecimals) return;
      displayDecimals = decimals;
      repaint();
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
    whenRendered: () => rendered,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      renderedResolve();
      _hostsAlive = Math.max(0, _hostsAlive - 1);
      clearInterval(sweepInterval);
      document.removeEventListener('pointermove', trackPointer);
      opts.container.removeEventListener('keydown', onEditKeydown, true);
      for (const d of engineRegistrations) { try { d.dispose(); } catch { /* engine already gone */ } }
      try {
        univer.dispose();
      } catch (err) {
        // Engine teardown failed: its body-level portals may have leaked, and
        // the services it left alive keep module-level caches bound to them.
        // The journal records it; the mount id keeps every later mount away
        // from what it left behind.
        hideBodyPortals();
        console.warn('[WorksheetHost] engine teardown threw:', err);
        try { opts.onEngineFault?.('engine teardown threw', String((err as { stack?: unknown } | null)?.stack ?? err)); } catch { /* journal unavailable */ }
      }
    },
  };
}
