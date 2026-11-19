// Worksheets: what a pane does to move around. Open a tab, start a quiz,
// open a past one, import a plan, hand the plan pane its actions.

import { URI } from '../../platform/uri.js';
import { serializeSheetFile, sheetTitle, uniqueSheetFileName } from './sheetFile.js';
import type { IKitAction } from '../../ui/kit.js';
import { showExtensionContextMenu, type IExtensionMenuItem } from '../../ui/contextMenu.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { notifyWorksheetViewsChanged, getQuizSession, savePlanJson, clearPlan } from './worksheetData.js';
import type { PlanActions } from './panes/planPane.js';
import { parsePlan } from './plan.js';
import { IActivityJournalService } from '../../services/activityJournalService.js';
import { practiceListeners, quizPresetListeners, reviewListeners, beginPractice, sheetsToFocus, state } from './state.js';
import { WS_ICON_SVG } from './widgets.js';

/** A past quiz reopened: the same player over the same problems, with the
 *  work and ratings as they are now. Finished ones review; an open one resumes. */
export async function openPastQuiz(id: string): Promise<void> {
  const row = await getQuizSession(id).catch(() => null);
  if (!row || row.itemIds.length === 0) return;
  state.practice = {
    id: row.id, name: row.name, ids: row.itemIds, startedAt: row.startedAt, skipped: new Set(row.skipped), marked: new Set(row.marked), finishedAt: row.finishedAt,
    index: row.finishedAt ? 0 : Math.max(0, Math.min(row.position, row.itemIds.length)),
  };
  for (const fn of practiceListeners) { try { fn(); } catch { /* pane torn down */ } }
  await openWorksheet('practice-run', state.practice?.name || 'Quiz');
}
/** A new quiz over exactly these problems, in this order, under `name`. */
export function startQuizWith(ids: number[], startAt = 0, name = ''): void {
  if (ids.length === 0) return;
  void (async () => {
    await beginPractice(ids, startAt, name);
    if (state.api?.activity) state.api.activity.note('started', `the quiz "${state.practice?.name ?? name}" (${ids.length} ${ids.length === 1 ? 'problem' : 'problems'})`);
    await openWorksheet('practice-run', state.practice?.name || 'Quiz');
  })();
}

export async function beginReview(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  state.review = { ids: [...ids], index: 0 };
  for (const fn of reviewListeners) { try { fn(); } catch { /* pane torn down */ } }
  await openWorksheet('review', 'Review');
}

// ── Open helper ─────────────────────────────────────────────────────────────

/** Each Worksheets tab carries the icon of its Home card, so two tabs never
 *  look alike (the app's Dashboard and this one, the builder and a quiz). */
const TAB_ICONS: Record<string, string> = {
  home: 'table', dashboard: 'gauge', bank: 'library', quizzes: 'list-checks', practice: 'plus',
  'practice-run': 'list-checks', review: 'eye', settings: 'settings', create: 'sparkles', 'excel-import': 'folder-input', scratch: 'table-2',
};
function tabIconHtml(instanceId: string): string {
  const id = TAB_ICONS[instanceId] ?? (instanceId.startsWith('item:') ? 'file-spreadsheet' : 'table');
  try { return state.api?.icons?.createIconHtml?.(id, 14) || WS_ICON_SVG; } catch { return WS_ICON_SVG; }
}

// ── A sheet of one's own: a `.sheet` file in the workspace (sheetFile.ts) ────

/** The tab icon of a sheet file. */
export function sheetFileIconHtml(): string { return tabIconHtml('sheet-file'); }

const fileUriOf = (filePath: string): string => URI.file(filePath).toString();

export async function readSheetText(filePath: string): Promise<string> {
  const fs = state.api?.workspace?.fs;
  if (!fs) throw new Error('No workspace folder is open.');
  return (await fs.readFile(fileUriOf(filePath))).content ?? '';
}

export async function writeSheetText(filePath: string, text: string): Promise<void> {
  const fs = state.api?.workspace?.fs;
  if (!fs) throw new Error('No workspace folder is open.');
  await fs.writeFile(fileUriOf(filePath), text);
}

/** Whether the sheet's file is still where the tab was opened from. On any doubt it is: a save is not held back by a failed question. */
export async function sheetFileExists(filePath: string): Promise<boolean> {
  try { return (await state.api?.workspace?.fs?.exists(fileUriOf(filePath))) !== false; } catch { return true; }
}

/** Write a sheet's text to a new file beside where it was, then open it (after `beforeOpening`, when given): where the work goes when its own file is gone. Returns the copy's file name. */
export async function saveSheetCopy(filePath: string, text: string, beforeOpening?: () => Promise<void>): Promise<string | undefined> {
  const api = state.api;
  const fs = api?.workspace?.fs;
  if (!api || !fs) return undefined;
  try {
    const folder = URI.file(filePath).dirname ?? URI.file(filePath);
    const taken = (await fs.readdir(folder.toString()).catch(() => [] as { name: string }[])).map((entry) => entry.name);
    const target = folder.joinPath(uniqueSheetFileName(sheetTitle(filePath), taken));
    await fs.writeFile(target.toString(), text);
    // The copy is on disk before anything is closed or opened.
    await beforeOpening?.();
    await api.editors.openFileEditor?.(target.fsPath);
    return target.basename;
  } catch (err) {
    void api.window?.showErrorMessage?.(`The copy could not be saved: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Make a new sheet file and open it. The name is asked for unless one is
 * given; the file goes in the given folder, else the workspace's first
 * folder. Returns the file's path, or undefined when nothing was made.
 */
export async function newSheet(name?: unknown, folder?: unknown): Promise<string | undefined> {
  const api = state.api;
  const fs = api?.workspace?.fs;
  const folderUri = typeof folder === 'string' && folder ? folder : api?.workspace?.workspaceFolders?.[0]?.uri;
  if (!api || !fs || !folderUri) {
    void api?.window?.showInformationMessage?.('Open a folder first: a sheet is a file in the workspace.');
    return undefined;
  }
  let wanted = typeof name === 'string' ? name : undefined;
  if (wanted === undefined) {
    wanted = await api.window?.showInputBox?.({ prompt: 'Name the sheet', value: 'Untitled', placeholder: 'Budget 2026' });
    if (wanted === undefined) return undefined;
  }
  const parent = /^[a-z][a-z0-9+.-]*:\/\//i.test(folderUri) ? URI.parse(folderUri) : URI.file(folderUri);
  const taken = (await fs.readdir(parent.toString()).catch(() => [] as { name: string }[])).map((entry) => entry.name);
  const target = parent.joinPath(uniqueSheetFileName(wanted, taken));
  try {
    await fs.writeFile(target.toString(), serializeSheetFile(null));
  } catch (err) {
    void api.window?.showErrorMessage?.(`The sheet could not be made: ${(err as Error).message}`);
    return undefined;
  }
  // A sheet just made is made to be typed into: it takes the keyboard when it opens.
  sheetsToFocus.add(target.fsPath);
  await api.editors.openFileEditor?.(target.fsPath);
  return target.fsPath;
}

export async function openWorksheet(instanceId: string, title: string): Promise<void> {
  await state.api?.editors.openEditor({
    typeId: 'worksheet',
    title,
    iconHtml: tabIconHtml(instanceId),
    instanceId,
  });
}

/**
 * The day's other quest: the flashcards tool's due cards. Offered only while
 * that tool runs (its study command exists); turned off, the button goes.
 */
const FLASHCARDS_STUDY = 'flashcards.study';
let _flashcardsOn = false;
export async function refreshFlashcardsOn(): Promise<void> {
  const ids = await state.api?.commands?.getCommands?.().catch(() => [] as string[]) ?? [];
  const on = ids.includes(FLASHCARDS_STUDY);
  if (on !== _flashcardsOn) { _flashcardsOn = on; notifyWorksheetViewsChanged(); }
}
export function studyFlashcards(): (() => void) | undefined {
  return _flashcardsOn ? () => void state.api?.commands?.executeCommand?.(FLASHCARDS_STUDY) : undefined;
}

// ── The study plan (the Campaign tab) ─────────────────────────────────────────

/** The app's activity journal, when it runs: how a plan learns that another tool finished a session. */
function activityJournal(): IActivityJournalService | null {
  try { return state.api?.services?.has(IActivityJournalService) ? state.api.services.get<IActivityJournalService>(IActivityJournalService) : null; } catch { return null; }
}
/** A new quiz over these problems, named; the session id once it runs. */
async function startQuizReturningId(ids: number[], name: string): Promise<string> {
  if (ids.length === 0) return '';
  await beginPractice(ids, 0, name);
  if (state.api?.activity) state.api.activity.note('started', `the quiz "${state.practice?.name ?? name}" (${ids.length} ${ids.length === 1 ? 'problem' : 'problems'})`);
  await openWorksheet('practice-run', state.practice?.name || 'Quiz');
  return state.practice?.id ?? '';
}
/** A plan file (JSON) becomes the plan: the old one and its block states go. */
export async function importPlanFromPath(filePath: string): Promise<boolean> {
  const fs = (window as { parallxElectron?: { fs?: { readFile?(p: string, enc?: string): Promise<{ content?: string; error?: { message: string } }> } } }).parallxElectron?.fs;
  if (!fs?.readFile) { await state.api?.window?.showErrorMessage?.('Importing a plan needs the desktop app.'); return false; }
  const res: { content?: string; error?: { message: string } } = await fs.readFile(filePath, 'utf8').catch((e: Error) => ({ error: { message: e.message } }));
  if (res.error || typeof res.content !== 'string') { await state.api?.window?.showErrorMessage?.(`Could not read the plan: ${res.error?.message ?? 'empty file'}`); return false; }
  const { plan, error } = parsePlan(res.content);
  if (!plan) { await state.api?.window?.showErrorMessage?.(`That is not a plan: ${error}`); return false; }
  await savePlanJson(res.content, new Set(plan.days.flatMap((d) => d.blocks.map((b) => `${d.day}/${b.id}`))));
  state.api?.activity?.note('imported', `the plan "${plan.title}"`, `${plan.days.length} days`);
  await openWorksheet('plan', 'Campaign');
  return true;
}
export async function pickAndImportPlan(): Promise<void> {
  const dialog = (window as { parallxElectron?: { dialog?: { openFile?(opts: unknown): Promise<string[] | null> } } }).parallxElectron?.dialog;
  if (!dialog?.openFile) { await state.api?.window?.showErrorMessage?.('Importing a plan needs the desktop app.'); return; }
  const res = await dialog.openFile({ title: 'Import a study plan', filters: [{ name: 'Plan (JSON)', extensions: ['json'] }] });
  const filePath = Array.isArray(res) ? res[0] : undefined;
  if (filePath) await importPlanFromPath(filePath);
}
export function planActions(): PlanActions {
  return {
    openItem: (id, title) => void openWorksheet(`item:${id}`, title),
    startQuiz: (ids, name) => startQuizReturningId(ids, name),
    openQuiz: (id) => void openPastQuiz(id),
    runCommand: async (command, args) => {
      const ids = await state.api?.commands?.getCommands?.().catch(() => [] as string[]) ?? [];
      if (!ids.includes(command)) { await state.api?.window?.showWarningMessage?.(`The tool that runs "${command}" is not on.`); return false; }
      await state.api?.commands?.executeCommand?.(command, ...args);
      return true;
    },
    commandExists: async (command) => ((await state.api?.commands?.getCommands?.().catch(() => [] as string[])) ?? []).includes(command),
    journalHits: async (verb, object, sinceTs) => {
      const j = activityJournal();
      if (!j) return [];
      const events = await j.query({ verb, sinceTs, limit: 500 }).catch(() => []);
      return events.filter((e) => e.object === object).map((e) => e.ts);
    },
    journalFinished: async (sinceTs) => {
      const j = activityJournal();
      if (!j) return [];
      const events = await j.query({ verb: 'finished', sinceTs, limit: 300 }).catch(() => []);
      return events.filter((e) => e.source.startsWith('ext:')).map((e) => ({ object: e.object, detail: e.detail ?? '', ts: e.ts }));
    },
    renderIcon: (id, size) => { try { return state.api?.icons?.createIconHtml?.(id, size) ?? ''; } catch { return ''; } },
    openHome: () => BACK_TO_HOME.onClick?.(),
    importPlan: () => void pickAndImportPlan(),
    removePlan: () => {
      void (async () => {
        const ok = await state.api?.window?.showConfirmModal?.({ message: 'Remove the plan?', detail: 'The plan and what each block recorded go. Quizzes and ratings stay.', confirmLabel: 'Remove Plan' }) ?? true;
        if (ok) await clearPlan();
      })();
    },
  };
}

/** The page every Worksheets tab links back to. */
export const BACK_TO_HOME: IKitAction = { id: 'worksheet.home', label: 'Worksheets', onClick: () => void openWorksheet('home', 'Worksheets') };
export const openBuilder = () => void openWorksheet('practice', 'New Quiz');
/**
 * The quiz builder on a set handed over (a paper, the problems shown, a
 * rating band). A builder that is already open takes it at once, in place of
 * what it had chosen; one not yet made reads it as it is made. Either way it
 * is taken once, so the next builder starts clean.
 */
export function openBuilderWith(preset: NonNullable<typeof state.quizPreset>): void {
  state.quizPreset = preset;
  for (const fn of [...quizPresetListeners]) { try { fn(); } catch { /* pane torn down */ } }
  openBuilder();
}
/** The quiz tab: one tab for the running quiz, named after it. */
export const openQuizTab = () => void openWorksheet('practice-run', state.practice?.name || 'Quiz');

/** The app's menu, anchored under a button, icons from the registry. */
export function showMenu(anchor: HTMLElement, items: IExtensionMenuItem[]): void {
  showExtensionContextMenu(anchor, items, { anchorPosition: 'below' }, (icon, c) => c.appendChild(createIconElement(icon, 14)));
}
