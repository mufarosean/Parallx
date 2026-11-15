// Worksheets: a sheet of one's own, a `.sheet` file in the workspace.
//
// The general spreadsheet: every function, a grid that grows, nothing of
// any exam. The file is read when the tab opens and written a moment after
// each change and on leaving; the tab carries its name. It follows the
// app's light or dark. The practice sheet (sheetPane.ts) is a different
// pane and is not touched by this one. A file is live in one pane at a time,
// is never written back after it was renamed or deleted, and is written at
// once when the window closes.

import type { IWorksheetHost, SheetViewState } from '../univerHost.js';
import { createEmptyState } from '../../../ui/kit.js';
import { readSheetText, saveSheetCopy, sheetFileExists, writeSheetText } from '../actions.js';
import { parseSheetFile, serializeSheetFile, sheetTitle } from '../sheetFile.js';
import { FREE_SHEET_LIMITS, SHEET_ON_SCREEN_KEY } from '../worksheetConstants.js';
import { appIsDark, decimalsListeners, getDisplayDecimals, loadUniverModule, state } from '../state.js';

/** How often a sheet with changes is written. */
const FILE_AUTOSAVE_MS = 1500;

/** Writes still on their way to disk, by file: a tab reopened at once waits for its own last save. */
const writesInFlight = new Map<string, Promise<void>>();

/** The live sheet of each file on screen, the one last opened last. */
const liveSheets: { host: IWorksheetHost; filePath: string }[] = [];
/** True while a sheet file is live on screen: what a menu entry that needs one asks (its `when`). */
let sheetOnScreenKey: { set(value: boolean): void } | null | undefined;
function noteLiveSheets(): void {
  if (sheetOnScreenKey === undefined) sheetOnScreenKey = state.api?.context?.createContextKey?.(SHEET_ON_SCREEN_KEY, false) ?? null;
  sheetOnScreenKey?.set(liveSheets.length > 0);
}

/** Export the sheet file on screen to .xlsx; false when none is open or it is empty. */
export function exportOpenSheetFile(): boolean {
  const open = liveSheets[liveSheets.length - 1];
  if (!open) {
    void state.api?.window?.showInformationMessage?.('Open a sheet file first.');
    return false;
  }
  open.host.commitEdit();
  const name = sheetTitle(open.filePath).replace(/[^\w\- ]+/g, '').trim() || 'sheet';
  const done = open.host.exportToXlsx(name);
  if (!done) void state.api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
  return done;
}

// One live sheet to a file. A file shown twice (the editor split) would be
// two engines each writing its whole sheet over the other's; the second
// pane waits, and takes the file when the first lets go.
const holders = new Map<string, symbol>();
const waiting = new Map<string, Set<() => void>>();
const fileKey = (filePath: string): string => filePath.replace(/\\/g, '/').toLowerCase();

// The window closing does not wait for a timer: every sheet with a change
// writes it while the page can still send (as the canvas does for pages).
const unloadFlushes = new Set<() => void>();
const flushForUnload = (): void => { for (const flush of unloadFlushes) flush(); };
function onUnload(flush: () => void): () => void {
  if (!unloadFlushes.size) window.addEventListener('beforeunload', flushForUnload);
  unloadFlushes.add(flush);
  return () => {
    unloadFlushes.delete(flush);
    if (!unloadFlushes.size) window.removeEventListener('beforeunload', flushForUnload);
  };
}

export function createSheetFilePane(container: HTMLElement, filePath: string) {
  const title = sheetTitle(filePath);
  // The engine mounts straight into the pane. `ws-pane__sheet` is the class its styles and the
  // probes know a live sheet by, so the pane wears it only once the engine is in it.
  container.classList.add('ws-pane');

  let host: IWorksheetHost | null = null;
  let disposed = false;
  /** Set once the file has been read: nothing is ever written over a file that was not. */
  let fileReady = false;
  /** Set when the file was found gone at a save: nothing more is written. */
  let gone = false;
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

  /** The file is no longer where it was (renamed, moved or deleted by something else): this tab stops saving, and says so once. */
  const fileIsGone = (snap: unknown): void => {
    if (gone) return;
    gone = true;
    if (timer) clearInterval(timer);
    void (async () => {
      const copy = { title: 'Save a Copy' };
      const picked = await state.api?.window?.showWarningMessage?.(`"${title}" is no longer where it was: it was renamed, moved or deleted. This tab cannot save to it.`, copy, { title: 'Discard Changes' });
      if (picked?.title === copy.title) await saveSheetCopy(filePath, serializeSheetFile(snap as Parameters<typeof serializeSheetFile>[0]));
    })();
  };

  /**
   * Write the sheet when it differs from what the file holds. The timer
   * passes false and skips a clean sheet. `last` is the save of a pane being
   * torn down: it is sent at once, because the tool may be turned off the
   * next moment and nothing can be asked or written after that.
   */
  const save = async (force = true, last = false): Promise<void> => {
    if (!fileReady || gone || (!force && !dirty)) return;
    dirty = false;
    // What is being typed in a cell is part of the sheet: leaving does not drop it.
    if (force) host?.commitEdit();
    const snap = host?.getSnapshot();
    if (!snap) return;
    const json = JSON.stringify(snap);
    if (json === lastSaved) return;
    lastSaved = json;
    const earlier = writesInFlight.get(filePath);
    const send = (): Promise<void> => writeSheetText(filePath, serializeSheetFile(snap));
    const write = (last
      ? (earlier ? earlier.then(send) : send())
      : (earlier ?? Promise.resolve()).then(async () => {
        // Never bring back a file that was renamed or deleted: the edit would land in a file nobody asked for.
        if (!(await sheetFileExists(filePath))) { fileIsGone(snap); return; }
        await send();
      }))
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

  /** The window is closing: send the change now, without the questions a normal save asks first. */
  const flushNow = (): void => {
    if (!fileReady || gone || !host) return;
    host.commitEdit();
    const snap = host.getSnapshot();
    if (!snap) return;
    const json = JSON.stringify(snap);
    if (json === lastSaved) return;
    lastSaved = json;
    void writeSheetText(filePath, serializeSheetFile(snap)).catch(() => { /* the window is going */ });
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

  const me = Symbol(title);
  const key = fileKey(filePath);
  let stopUnloadFlush: (() => void) | null = null;

  const open = async (): Promise<void> => {
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
      container.classList.add('ws-pane__sheet');
      host = mod.createWorksheetHost({
        container, snapshot: parsed.workbook, darkMode: appIsDark(), displayDecimals: getDisplayDecimals(), limits: FREE_SHEET_LIMITS,
        onFormulaError: (summary, detail) => { try { state.api?.activity?.note('formula error', `${title}: ${summary}`, detail); } catch { /* no journal */ } },
        onEngineFault: (summary, detail) => { try { state.api?.activity?.note('engine fault', `${title}: ${summary}`, detail); } catch { /* no journal */ } },
      });
      // Probe hook (tests/probes): the live host, reachable from the DOM.
      (container as unknown as { __wsHost?: unknown }).__wsHost = host;
      liveSheets.push({ host, filePath });
      noteLiveSheets();
      stopUnloadFlush = onUnload(flushNow);
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
  };

  /** Take the file if no other pane holds it. */
  const take = (): boolean => {
    if (disposed || (holders.has(key) && holders.get(key) !== me)) return false;
    holders.set(key, me);
    waiting.get(key)?.delete(retry);
    void open();
    return true;
  };
  function retry(): void {
    if (take()) return;
    if (!disposed) waiting.get(key)?.add(retry);
  }
  if (!take()) {
    say(`"${title}" is open in another tab group`, 'It is shown there. Close that tab to work on it here.');
    if (!waiting.has(key)) waiting.set(key, new Set());
    waiting.get(key)!.add(retry);
  }

  return {
    // One live engine per window: the sheet is torn down when its tab is
    // switched away and read from its file again on return.
    retainOnHide: false,
    ready,
    saveViewState: () => {
      // Leaving the tab tears the pane down next: this is its last save.
      void save(true, true);
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
      void save(true, true);
      disposed = true;
      stopUnloadFlush?.();
      const at = liveSheets.findIndex((entry) => entry.host === host);
      if (at >= 0) liveSheets.splice(at, 1);
      noteLiveSheets();
      // Let go of the file; a pane waiting for it (the other side of a split) takes it, after this pane's last save.
      waiting.get(key)?.delete(retry);
      if (holders.get(key) === me) {
        holders.delete(key);
        const next = [...(waiting.get(key) ?? [])][0];
        if (next) next();
      }
      if (!waiting.get(key)?.size) waiting.delete(key);
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
