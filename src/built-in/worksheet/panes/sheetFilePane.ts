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

/** How many autosave beats between looks at whether the file is still there (about every six seconds). */
const GONE_CHECK_BEATS = 4;

/** Writes still on their way to disk, by file: a tab reopened at once waits for its own last save. */
const writesInFlight = new Map<string, Promise<void>>();

/** The live sheet of each file on screen, the one last opened last. */
const liveSheets: { host: IWorksheetHost; filePath: string }[] = [];
/**
 * True while a sheet file is live on screen: what a menu entry that needs
 * one asks (its `when`). The key belongs to the running tool, so it is made
 * again when the tool has been turned off and on (the old one is dead).
 */
let sheetOnScreenKey: { of: unknown; key: { set(value: boolean): void } | null } | null = null;
function noteLiveSheets(): void {
  const api = state.api;
  if (!api) return;
  if (sheetOnScreenKey?.of !== api) sheetOnScreenKey = { of: api, key: api.context?.createContextKey?.(SHEET_ON_SCREEN_KEY, false) ?? null };
  sheetOnScreenKey.key?.set(liveSheets.length > 0);
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
// In the capture phase: the workbench's own listener for this event shuts the
// tools down, and after that nothing can be written.
const unloadFlushes = new Set<() => void>();
const flushForUnload = (): void => { for (const flush of unloadFlushes) flush(); };
function onUnload(flush: () => void): () => void {
  if (!unloadFlushes.size) window.addEventListener('beforeunload', flushForUnload, true);
  unloadFlushes.add(flush);
  return () => {
    unloadFlushes.delete(flush);
    if (!unloadFlushes.size) window.removeEventListener('beforeunload', flushForUnload, true);
  };
}

/** The save of each live pane, entry being typed included. */
const liveSaves = new Set<() => Promise<void>>();

/**
 * Every sheet file's work, on disk: each live pane saves, and every write on
 * its way is waited for. The tool does this before it is turned off or the
 * app closes, while it can still write.
 */
export async function settleSheetFiles(): Promise<void> {
  await Promise.all([...liveSaves].map((save) => save().catch(() => undefined)));
  await Promise.all([...writesInFlight.values()]);
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

  /**
   * The file is no longer where it was (renamed, moved or deleted by
   * something else). This tab cannot save to it, so it does not stay open
   * as a sheet that silently keeps nothing: the person is asked, in a
   * dialog that waits, whether to keep what is on screen as a copy, and the
   * tab is closed either way.
   */
  const fileIsGone = (lastSnap: unknown): void => {
    if (gone) return;
    gone = true;
    if (timer) clearInterval(timer);
    void (async () => {
      const api = state.api;
      const keep = await api?.window?.showConfirmModal?.({
        message: `"${title}" is no longer where it was`,
        detail: 'Its file was renamed, moved or deleted, so this tab cannot save to it. Keep what is on screen as a copy beside where it was, or close the tab without it.',
        confirmLabel: 'Save a Copy',
        cancelLabel: 'Close Without Saving',
      });
      // What is on screen now, not what it was when the file was found gone (the pane may be closed by now: then that).
      if (keep) host?.commitEdit();
      const snap = (keep ? host?.getSnapshot() : null) ?? lastSnap;
      // This tab first: the copy may take the very name the file had, and would otherwise be shown in the tab that is going.
      const mine = api?.editors.openEditors?.find((e) => fileKey(e.description) === key);
      if (mine) await api?.editors.closeEditor?.(mine.id).catch(() => false);
      if (keep && snap) await saveSheetCopy(filePath, serializeSheetFile(snap as Parameters<typeof serializeSheetFile>[0]));
    })();
  };

  /**
   * Write the sheet when it differs from what the file holds. The timer
   * passes false and skips a clean sheet. `commit` first keeps what is being
   * typed in a cell, as clicking elsewhere would: only where the pane is
   * going (a save that runs while the person types must not end the entry).
   * Every save asks first whether the file is still there, and never brings
   * back one that was renamed or deleted.
   */
  const save = async (force = true, commit = false): Promise<void> => {
    if (!fileReady || gone || (!force && !dirty)) return;
    dirty = false;
    if (commit) host?.commitEdit();
    const snap = host?.getSnapshot();
    if (!snap) return;
    const json = JSON.stringify(snap);
    if (json === lastSaved) return;
    lastSaved = json;
    const write = (writesInFlight.get(filePath) ?? Promise.resolve())
      .then(async () => {
        if (!(await sheetFileExists(filePath))) { fileIsGone(snap); return; }
        await writeSheetText(filePath, serializeSheetFile(snap));
      })
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
  const saveAll = (): Promise<void> => save(true, true);

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
      liveSaves.add(saveAll);
      void host.whenRendered().then(() => { readyResolve(); applyPendingView(); });
      changedSub = host.onChanged(() => { dirty = true; });
      lastSaved = await settledSnapshot();
      if (disposed) return;
      fileReady = true;
      let beat = 0;
      timer = setInterval(() => {
        void save(false);
        // Every few beats, with nothing to save: is the file still there? So a tab left or closed
        // long after another program took its file away does not write it back.
        if (++beat % GONE_CHECK_BEATS === 0 && !dirty && !gone) void sheetFileExists(filePath).then((there) => { if (!there && !disposed) fileIsGone(host?.getSnapshot() ?? null); });
      }, FILE_AUTOSAVE_MS);
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
      // Called whenever the workbench saves its state, not only on leaving: an entry being typed is left alone.
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
      // Capture before teardown, so closing the tab cannot drop work. The write itself outlives
      // the teardown: it is returned, so whoever closed the tab can wait for it.
      const lastSave = saveAll();
      disposed = true;
      stopUnloadFlush?.();
      liveSaves.delete(saveAll);
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
      return lastSave;
    },
  };
}
