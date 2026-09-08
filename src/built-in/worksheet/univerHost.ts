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
import { ICommandService, IContextService, CommandType, Direction, EDITOR_ACTIVATED, FOCUSING_SHEET, FOCUSING_UNIVER_EDITOR } from '@univerjs/core';
import { IEditorBridgeService, MoveSelectionCommand, SetCellEditVisibleOperation, SheetScrollManagerService } from '@univerjs/sheets-ui';
import { DeviceInputEventType, IRenderManagerService, type IRender } from '@univerjs/engine-render';
import * as XLSX from 'xlsx';
import type { IWorkbookData, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/lib/facade';
import { ATHENA_FUNCTIONS } from './athenaFunctions.js';
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
  /** Probe knob: switch the editor's follow-scroll off ('dom' is the shipped default). */
  setEditorFollowMode(mode: 'off' | 'dom'): void;
  /** Open the sheet's own right-click menu at a viewport point (probes; the app never needs it). */
  openContextMenu(clientX: number, clientY: number): void;
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
  univerAPI.createWorkbook(opts.snapshot ?? blankWorkbookData());

  let disposed = false;

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
  const REVERSE_MOVE_ID = 'parallx.sheet.move-selection-reverse';
  const engineRegistrations: { dispose(): void }[] = [];
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
      return univerAPI.getActiveWorkbook()?.save() ?? null;
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
    setEditorFollowMode: (mode) => { follow.mode = mode; },
    openContextMenu,
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
      opts.container.removeEventListener('keydown', onEditKeydown, true);
      for (const d of engineRegistrations) { try { d.dispose(); } catch { /* engine already gone */ } }
      try {
        univer.dispose();
      } catch {
        // Engine teardown failed — its body-level portals may have leaked.
        hideBodyPortals();
      }
    },
  };
}
