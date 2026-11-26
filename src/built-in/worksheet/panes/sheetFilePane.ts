// Worksheets: a sheet of one's own, a `.sheet` file in the workspace.
//
// The general spreadsheet: every function, a grid that grows, nothing of
// any exam. The file is read when the tab opens and written a moment after
// each change and on leaving; the tab carries its name. It follows the
// app's light or dark. The practice sheet (sheetPane.ts) is a different
// pane and is not touched by this one. One sheet is live at a time, a file is
// never written back after it was renamed or deleted, and it is written
// when the tool is turned off, the app closes or the window reloads.

import type { IWorksheetHost, SheetViewState } from '../univerHost.js';
import { createEmptyState } from '../../../ui/kit.js';
import { createToolbarBody } from '../../../ui/toolbar.js';
import { mountSheetToolbar, type ISheetToolbar } from './sheetToolbar.js';
import { readSheetText, saveSheetCopy, sheetFileExists, writeSheetText } from '../actions.js';
import { parseSheetFile, serializeSheetFile, sheetTitle } from '../sheetFile.js';
import { FREE_SHEET_LIMITS, SHEET_ON_SCREEN_KEY } from '../worksheetConstants.js';
import { appIsDark, decimalsListeners, getDisplayDecimals, loadUniverModule, sheetsToFocus, state } from '../state.js';

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

// One live sheet at a time. The engine is built for one live instance in a
// window: two at once share its formula editor and its caches, and a formula
// typed into one lands garbled in the other (seen in the app with two sheet
// files side by side, and with a sheet file beside a practice sheet). So a
// sheet file's pane waits while another engine is live, gives way when a
// practice sheet opens beside it, and can be brought forward from its notice.
const fileKey = (filePath: string): string => filePath.replace(/\\/g, '/').toLowerCase();
/** The sheet file pane that is live, when one is: it can be asked to give way. */
let liveFilePane: { readonly key: string; giveWay(): Promise<void> } | null = null;
/** The panes that are waiting, by the id their notice's button carries. */
const waitingPanes = new Map<string, { readonly token: symbol; retry(): void }>();
/** The waiting pane that asked to come forward: it is the one that mounts when the engine is free. */
let comesForward: symbol | null = null;
let paneSeq = 0;

/** Bring a waiting sheet forward: the live one saves and gives way (the command behind the notice's button). */
export async function bringSheetForward(paneId: unknown): Promise<void> {
  const waiter = typeof paneId === 'string' ? waitingPanes.get(paneId) : undefined;
  if (!waiter) return;
  if (!liveFilePane) { waiter.retry(); return; }
  comesForward = waiter.token;
  await liveFilePane.giveWay();
}

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
  // The pane is a column: the app's toolbar, then the element the engine mounts into.
  // `ws-pane__sheet` is the class the engine's styles and the probes know a live sheet by, so
  // that element is only there while the engine is in it.
  container.classList.add('ws-pane');
  let sheetEl: HTMLElement | null = null;
  let toolbar: ISheetToolbar | null = null;

  let host: IWorksheetHost | null = null;
  let disposed = false;
  /** Set once the file has been read: nothing is ever written over a file that was not. */
  let fileReady = false;
  /** Set when the file was found gone at a save: nothing more is written. */
  let gone = false;
  let dirty = false;
  let lastSaved = '';
  /** What the file is known to hold: as read, then as last written. */
  let onDisk = '';
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
   * something outside the app). This tab cannot save to it and does not
   * stay open as a sheet that silently keeps nothing. Nothing is asked: a
   * question that appears while a person types is answered by their next
   * key or click. Work the file does not hold is kept as a copy beside
   * where it was, which opens in this tab's place; with nothing unsaved the
   * tab is closed. Either way the person is told.
   */
  const fileIsGone = (lastSnap: unknown): void => {
    if (gone) return;
    gone = true;
    if (timer) clearInterval(timer);
    host?.commitEdit();
    const snap = host?.getSnapshot() ?? lastSnap;
    const unsaved = !!snap && JSON.stringify(snap) !== onDisk;
    void (async () => {
      const api = state.api;
      const closeThisTab = async (): Promise<void> => {
        const mine = api?.editors.openEditors?.find((e) => fileKey(e.description) === key);
        if (mine) await api?.editors.closeEditor?.(mine.id).catch(() => false);
      };
      const where = `"${title}" was renamed, moved or deleted outside Parallx.`;
      if (!unsaved) {
        await closeThisTab();
        void api?.window?.showInformationMessage?.(`${where} Its tab was closed; nothing in it was unsaved.`);
        return;
      }
      // The copy is written first, then this tab closed, then the copy opened: it may take the very name the
      // file had, and would otherwise be shown in the tab that is going.
      const copy = await saveSheetCopy(filePath, serializeSheetFile(snap as Parameters<typeof serializeSheetFile>[0]), closeThisTab);
      if (copy) void api?.window?.showWarningMessage?.(`${where} What was on screen is kept as "${copy}", now open.`);
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
        onDisk = json;
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
  const paneId = `sheet-file-pane-${++paneSeq}`;
  const key = fileKey(filePath);
  let stopUnloadFlush: (() => void) | null = null;
  /** While waiting: the engine becoming free. While live: a second engine appearing. */
  let engineWatch: { dispose(): void } | null = null;

  // Where the keyboard was when this pane was made. A file opened by a click in the Explorer leaves
  // the keyboard there (F2 and Delete then mean the file, not a cell); the engine takes focus as it
  // renders, so it is given back. A sheet just made, or one opened from inside the editor area, keeps it.
  const focusTrail: HTMLElement[] = [];
  for (let el = document.activeElement as HTMLElement | null; el && el !== document.body; el = el.parentElement) focusTrail.push(el);
  const editorArea = container.closest('[data-part-id]');
  const madeToType = sheetsToFocus.delete(filePath);
  let keepFocusOutside = !madeToType && focusTrail.length > 0 && !!editorArea && !editorArea.contains(focusTrail[0]);
  const personActed = (): void => { keepFocusOutside = false; };
  container.addEventListener('pointerdown', personActed, true);
  const giveFocusBack = (): void => {
    if (!keepFocusOutside || disposed || !container.contains(document.activeElement)) return;
    focusTrail.find((el) => el.isConnected && el.tabIndex >= 0)?.focus();
  };

  /** Take the engine out of the pane, leaving the pane: when it gives way, and when it closes. Returns its last save. */
  const unmount = (): Promise<void> => {
    if (timer) { clearInterval(timer); timer = null; }
    // Capture before teardown, so nothing typed is dropped. The write itself outlives the teardown.
    const lastSave = saveAll();
    fileReady = false;
    stopUnloadFlush?.();
    stopUnloadFlush = null;
    liveSaves.delete(saveAll);
    const at = liveSheets.findIndex((entry) => entry.host === host);
    if (at >= 0) liveSheets.splice(at, 1);
    noteLiveSheets();
    engineWatch?.dispose();
    engineWatch = null;
    if (liveFilePane === self) liveFilePane = null;
    changedSub?.dispose();
    changedSub = null;
    toolbar?.dispose();
    toolbar = null;
    delete (container as unknown as { __wsHost?: unknown }).__wsHost;
    const going = host;
    host = null;
    // Last: this frees the engine, and a waiting pane starts to open on that call.
    going?.dispose();
    sheetEl?.remove();
    sheetEl = null;
    return lastSave;
  };

  const self = {
    key,
    /** Save, take the engine down and wait: another sheet is to be the live one. */
    giveWay: async (): Promise<void> => {
      if (!host || disposed) return;
      const mod = await loadUniverModule();
      const saved = unmount();
      wait(mod);
      await saved;
    },
  };

  /** Show why there is no sheet here yet, and open when the engine is free. */
  function wait(mod: Awaited<ReturnType<typeof loadUniverModule>>): void {
    if (disposed) return;
    const sameFile = liveFilePane?.key === key;
    const action = liveFilePane ? { label: 'Work on This Sheet', command: 'worksheet.bringSheetForward', args: [paneId] } : undefined;
    notice?.remove();
    notice = createEmptyState(container, {
      icon: 'table',
      headline: sameFile ? `"${title}" is open in another tab group` : 'Another sheet is being worked on',
      hint: action ? 'One sheet is live at a time, so what is typed lands in the right one. Bringing this one forward saves the other, which then waits.' : 'One sheet is live at a time. This one comes back when the other is closed or its tab is left.',
      action,
    });
    readyResolve();
    waitingPanes.set(paneId, { token: me, retry: () => { void open(); } });
    engineWatch?.dispose();
    engineWatch = mod.liveEngines.onChange(() => { if (mod.liveEngines.count === 0 && !host && !disposed) void open(); });
  }

  async function open(): Promise<void> {
    try {
      await writesInFlight.get(filePath);
      const parsed = parseSheetFile(await readSheetText(filePath));
      if (disposed || host) return;
      if (parsed.error) {
        // Left as it is on disk.
        say(`"${title}" could not be opened as a sheet`, parsed.error);
        readyResolve();
        return;
      }
      const mod = await loadUniverModule();
      if (disposed || host) return;
      // From here to the engine being made nothing is awaited: two panes cannot both find it free.
      if (mod.liveEngines.count > 0 || (comesForward !== null && comesForward !== me)) { wait(mod); return; }
      if (comesForward === me) comesForward = null;
      waitingPanes.delete(paneId);
      engineWatch?.dispose();
      notice?.remove();
      notice = null;
      sheetEl = createToolbarBody(container, 'ws-pane__sheet');
      host = mod.createWorksheetHost({
        container: sheetEl, snapshot: parsed.workbook, darkMode: appIsDark(), displayDecimals: getDisplayDecimals(), limits: FREE_SHEET_LIMITS,
        onFormulaError: (summary, detail) => { try { state.api?.activity?.note('formula error', `${title}: ${summary}`, detail); } catch { /* no journal */ } },
        onEngineFault: (summary, detail) => { try { state.api?.activity?.note('engine fault', `${title}: ${summary}`, detail); } catch { /* no journal */ } },
      });
      const mounted = host;
      // Probe hook (tests/probes): the live host, reachable from the DOM.
      // On the sheet's element, and on the pane as before the pane had a toolbar of its own.
      (sheetEl as unknown as { __wsHost?: unknown }).__wsHost = host;
      (container as unknown as { __wsHost?: unknown }).__wsHost = host;
      toolbar = mountSheetToolbar(sheetEl, host.format, { free: true, title });
      liveSheets.push({ host, filePath });
      noteLiveSheets();
      liveFilePane = self;
      // A practice sheet opening beside this one makes a second engine: this one gives way.
      engineWatch = mod.liveEngines.onChange(() => { if (mod.liveEngines.count > 1 && host === mounted) void self.giveWay(); });
      stopUnloadFlush = onUnload(flushNow);
      liveSaves.add(saveAll);
      void host.whenRendered().then(() => { readyResolve(); applyPendingView(); giveFocusBack(); setTimeout(giveFocusBack, 300); });
      changedSub = host.onChanged(() => { dirty = true; });
      lastSaved = await settledSnapshot();
      onDisk = lastSaved;
      if (disposed || host !== mounted) return;
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
  }
  void open();

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
      // The write of what was on screen outlives the teardown: it is returned, so whoever closed the tab can wait for it.
      const lastSave = unmount();
      disposed = true;
      container.removeEventListener('pointerdown', personActed, true);
      waitingPanes.delete(paneId);
      if (comesForward === me) {
        // The pane that was to come forward is gone: the others stop waiting for it.
        comesForward = null;
        for (const waiter of [...waitingPanes.values()]) waiter.retry();
      }
      decimalsListeners.delete(applyDecimals);
      modeObserver.disconnect();
      notice?.remove();
      container.classList.remove('ws-pane');
      return lastSave;
    },
  };
}
