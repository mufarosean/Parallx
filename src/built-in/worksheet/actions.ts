// Worksheets: what a pane does to move around. Open a tab, start a quiz,
// open a past one, import a plan, hand the plan pane its actions.

import type { IKitAction } from '../../ui/kit.js';
import { showExtensionContextMenu, type IExtensionMenuItem } from '../../ui/contextMenu.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { notifyWorksheetViewsChanged, getQuizSession, savePlanJson, clearPlan } from './worksheetData.js';
import type { PlanActions } from './panes/planPane.js';
import { parsePlan } from './plan.js';
import { IActivityJournalService } from '../../services/activityJournalService.js';
import { practiceListeners, reviewListeners, beginPractice, state } from './state.js';
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
    openHome: () => BACK_TO_HOME.onClick(),
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
export const BACK_TO_HOME: IKitAction = { label: 'Worksheets', onClick: () => void openWorksheet('home', 'Worksheets') };
export const openBuilder = () => void openWorksheet('practice', 'New Quiz');
/** The quiz tab: one tab for the running quiz, named after it. */
export const openQuizTab = () => void openWorksheet('practice-run', state.practice?.name || 'Quiz');

/** The app's menu, anchored under a button, icons from the registry. */
export function showMenu(anchor: HTMLElement, items: IExtensionMenuItem[]): void {
  showExtensionContextMenu(anchor, items, { anchorPosition: 'below' }, (icon, c) => c.appendChild(createIconElement(icon, 14)));
}
