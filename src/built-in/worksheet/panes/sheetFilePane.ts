// Worksheets: a sheet of one's own, a `.sheet` file in the workspace.
//
// The general spreadsheet: every function, a grid that grows, nothing of
// any exam. The file is read when the tab opens and written a moment after
// each change and on leaving; the tab carries its name. It follows the
// app's light or dark. The practice sheet (sheetPane.ts) is a different
// pane and is not touched by this one.

import type { IWorksheetHost, SheetViewState } from '../univerHost.js';
import { createEmptyState } from '../../../ui/kit.js';
import { readSheetText, writeSheetText } from '../actions.js';
import { parseSheetFile, serializeSheetFile, sheetTitle } from '../sheetFile.js';
import { FREE_SHEET_LIMITS } from '../worksheetConstants.js';
import { appIsDark, decimalsListeners, getDisplayDecimals, loadUniverModule, state } from '../state.js';

/** How often a sheet with changes is written. */
const FILE_AUTOSAVE_MS = 1500;

/** Writes still on their way to disk, by file: a tab reopened at once waits for its own last save. */
const writesInFlight = new Map<string, Promise<void>>();

/** The sheet file on screen (the engine allows one live sheet per window). */
let openSheet: { host: IWorksheetHost; filePath: string } | null = null;

/** Export the sheet file on screen to .xlsx; false when none is open or it is empty. */
export function exportOpenSheetFile(): boolean {
  if (!openSheet) {
    void state.api?.window?.showInformationMessage?.('Open a sheet first.');
    return false;
  }
  const name = sheetTitle(openSheet.filePath).replace(/[^\w\- ]+/g, '').trim() || 'sheet';
  const done = openSheet.host.exportToXlsx(name);
  if (!done) void state.api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
  return done;
}

export function createSheetFilePane(container: HTMLElement, filePath: string) {
  const title = sheetTitle(filePath);
  // The engine mounts straight into the pane; these are the classes its styles and the probes know.
  container.classList.add('ws-pane', 'ws-pane__sheet');

  let host: IWorksheetHost | null = null;
  let disposed = false;
  /** Set once the file has been read: nothing is ever written over a file that was not. */
  let fileReady = false;
  let dirty = false;
  let lastSaved = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  let changedSub: { dispose(): void } | null = null;
  let pendingView: SheetViewState | null = null;
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });

  let notice: HTMLElement | null = createEmptyState(container, { headline: 'Opening the sheet…', icon: 'table' });
  const say = (headline: string, hint?: string): void => {
    notice?.remove();
    notice = createEmptyState(container, { headline, hint, icon: 'table' });
  };

  const applyPendingView = (): void => {
    if (!pendingView || !host || disposed) return;
    host.restoreViewState(pendingView);
    pendingView = null;
  };

  /** Write the sheet when it differs from what the file holds. The timer passes false and skips a clean sheet. */
  const save = async (force = true): Promise<void> => {
    if (!fileReady || (!force && !dirty)) return;
    dirty = false;
    const snap = host?.getSnapshot();
    if (!snap) return;
    const json = JSON.stringify(snap);
    if (json === lastSaved) return;
    lastSaved = json;
    const write = (writesInFlight.get(filePath) ?? Promise.resolve())
      .then(() => writeSheetText(filePath, serializeSheetFile(snap)))
      .catch((err) => {
        // The next change saves again; until then the file is behind the screen.
        lastSaved = '';
        console.error('[Worksheet] the sheet could not be saved:', err);
        void state.api?.window?.showErrorMessage?.(`"${title}" could not be saved: ${(err as Error).message}`);
      });
    writesInFlight.set(filePath, write);
    await write;
    if (writesInFlight.get(filePath) === write) writesInFlight.delete(filePath);
  };

  // The engine keeps normalising a new sheet for a moment after it mounts;
  // the baseline is the snapshot once it has stopped moving, so merely
  // opening a sheet never rewrites its file.
  const settledSnapshot = async (): Promise<string> => {
    let prev = JSON.stringify(host?.getSnapshot() ?? null);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (disposed) return prev;
      const next = JSON.stringify(host?.getSnapshot() ?? null);
      if (next === prev) return next;
      prev = next;
    }
    return prev;
  };

  const modeObserver = new MutationObserver(() => host?.setDarkMode(appIsDark()));
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-px-mode'] });
  const applyDecimals = (decimals: number | null) => host?.setDisplayDecimals(decimals);
  decimalsListeners.add(applyDecimals);

  void (async () => {
    try {
      await writesInFlight.get(filePath);
      const parsed = parseSheetFile(await readSheetText(filePath));
      if (disposed) return;
      if (parsed.error) {
        // Left as it is on disk.
        say(`"${title}" could not be opened as a sheet`, parsed.error);
        readyResolve();
        return;
      }
      const mod = await loadUniverModule();
      if (disposed) return;
      notice?.remove();
      notice = null;
      host = mod.createWorksheetHost({
        container, snapshot: parsed.workbook, darkMode: appIsDark(), displayDecimals: getDisplayDecimals(), limits: FREE_SHEET_LIMITS,
        onFormulaError: (summary, detail) => { try { state.api?.activity?.note('formula error', `${title}: ${summary}`, detail); } catch { /* no journal */ } },
        onEngineFault: (summary, detail) => { try { state.api?.activity?.note('engine fault', `${title}: ${summary}`, detail); } catch { /* no journal */ } },
      });
      // Probe hook (tests/probes): the live host, reachable from the DOM.
      (container as unknown as { __wsHost?: unknown }).__wsHost = host;
      openSheet = { host, filePath };
      void host.whenRendered().then(() => { readyResolve(); applyPendingView(); });
      changedSub = host.onChanged(() => { dirty = true; });
      lastSaved = await settledSnapshot();
      if (disposed) return;
      fileReady = true;
      timer = setInterval(() => { void save(false); }, FILE_AUTOSAVE_MS);
    } catch (err) {
      say(`"${title}" could not be opened`, err instanceof Error ? err.message : String(err));
      readyResolve();
      console.error('[Worksheet] sheet file load failed:', err);
    }
  })();

  return {
    // One live engine per window: the sheet is torn down when its tab is
    // switched away and read from its file again on return.
    retainOnHide: false,
    ready,
    saveViewState: () => {
      void save();
      return { view: host?.getViewState() ?? null };
    },
    restoreViewState: (saved: unknown) => {
      const view = (saved as { view?: SheetViewState | null } | null)?.view ?? null;
      if (!view) return;
      pendingView = view;
      applyPendingView();
    },
    dispose: () => {
      readyResolve();
      if (timer) clearInterval(timer);
      // Capture before teardown, so closing the tab cannot drop work.
      void save();
      disposed = true;
      if (openSheet?.host === host) openSheet = null;
      decimalsListeners.delete(applyDecimals);
      changedSub?.dispose();
      modeObserver.disconnect();
      host?.dispose();
      host = null;
      notice?.remove();
      container.classList.remove('ws-pane', 'ws-pane__sheet');
    },
  };
}
