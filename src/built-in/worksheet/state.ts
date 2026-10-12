// Worksheets: what the panes share. The host api, the running quiz and
// review, the caches a pane rebuild reads back, the listener sets, and the
// settings every pane reads (sheet appearance, idle minutes, exam date, XP
// cash rate, display decimals).

import type { IWorkbookData } from '@univerjs/core';
import type { IWorksheetHost } from './univerHost.js';
import { getOpenQuizSession, saveQuizSession } from './worksheetData.js';
import { parseDisplayDecimals, DISPLAY_DECIMALS_CHOICES, DEFAULT_DISPLAY_DECIMALS } from './displayNumbers.js';
import type { LmApiLike } from './worksheetAi.js';
import { DEFAULT_IDLE_MINUTES } from './studyClock.js';
import { defaultQuizName, newQuizId } from './labels.js';

export interface ParallxApiLike {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): { dispose(): void } }): { dispose(): void };
  };
  editors: {
    registerEditorProvider(typeId: string, provider: unknown): { dispose(): void };
    openEditor(options: {
      typeId: string; title: string; iconHtml?: string; instanceId?: string;
    }): Promise<void>;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
    executeCommand?<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
    getCommands?(): Promise<string[]>;
  };
  tools?: { onDidChange?(listener: () => void): { dispose(): void } };
  services?: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
  icons?: { createIconHtml?(id: string, size?: number): string };
  canvas?: { registerBlock(registration: import('../../api/bridges/canvasBlocksBridge.js').CanvasBlockRegistration): { dispose(): void } };
  window?: {
    showConfirmModal?(options: { message: string; detail?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
    showWarningMessage?(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showInformationMessage?(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage?(message: string): Promise<unknown>;
    showQuickPick?(items: readonly { label: string; description?: string; picked?: boolean }[], options?: { placeholder?: string; canPickMany?: boolean }): Promise<unknown>;
    showInputBox?(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
  };
  workspace?: {
    getConfiguration(section?: string): {
      get<T>(key: string, defaultValue?: T): T | undefined;
      update(key: string, value: unknown): Promise<void>;
    };
  };
  chat?: {
    registerTool(name: string, tool: {
      description: string;
      parameters: Record<string, unknown>;
      handler: (args: Record<string, unknown>, token: unknown) => Promise<{ content: string; isError?: boolean }>;
      requiresConfirmation: boolean;
    }): { dispose(): void };
  };
  /** Activity journal: note(verb, object, detail) — the app's common activity language. */
  activity?: { note(verb: string, object: string, detail?: string): boolean };
  lm?: LmApiLike;
}

export interface ToolContextLike {
  subscriptions: { push(d: { dispose(): void }): void };
}

/**
 * What every pane and action shares and may reassign. One object, so a
 * pane sees the value the activation or another pane set after it loaded.
 */
export const state = {
  /** The host api, bound in activate(). */
  api: null as ParallxApiLike | null,
  /** The running quiz, or null between quizzes. */
  practice: null as RunningPractice | null,
  /** The review walk open in Review tabs. */
  review: null as ReviewWalk | null,
  /** Filters the quiz builder opens with, set by whoever opened it. */
  quizPreset: null as { papers?: string[]; state?: string; starred?: 'starred' | 'unstarred'; ids?: number[]; name?: string } | null,
  /**
   * A workbook path handed to `worksheet.importExcel` (a probe, a drop, a
   * script) skips the native dialog: the live pane takes it at once, a pane
   * not yet built takes it when it mounts.
   */
  pendingImportPath: null as string | null,
  importPaneHooks: null as { importPath(filePath: string): Promise<void> } | null,
};

/** Scratch-sheet snapshots cached across pane rebuilds (in-memory only). */
export const scratchCache = new Map<string, IWorkbookData>();
/**
 * The last working snapshot of each item pane, by instance id. A sheet pane
 * is torn down on every tab switch (one live engine per window); the
 * database write it makes on the way out may still be in flight when the
 * tab comes back, so the remount reads this first.
 */
export const workingCache = new Map<string, IWorkbookData>();

// ── Sheet appearance (worksheet.sheetAppearance) ────────────────────────────
//
// The SHEET theme is independent of the app theme (a dark app with a light
// sheet is a common wish). 'light' is the default —
// the real Athena sheet is always white. 'app' follows the workbench mode
// live; the Sheet Theme button on any sheet flips light↔dark and persists.

export type SheetAppearance = 'light' | 'dark' | 'app';

/** Open sheet panes listening for appearance changes (toggle on one pane
 *  updates every pane — no config-change event exists for tools). */
export const appearanceListeners = new Set<(appearance: SheetAppearance) => void>();

export function appIsDark(): boolean {
  return document.documentElement.getAttribute('data-px-mode') !== 'light';
}

export function getSheetAppearance(): SheetAppearance {
  try {
    const v = state.api?.workspace?.getConfiguration('worksheet').get<string>('sheetAppearance', 'light');
    return v === 'dark' || v === 'app' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function resolveSheetDark(appearance: SheetAppearance = getSheetAppearance()): boolean {
  return appearance === 'dark' || (appearance === 'app' && appIsDark());
}

export async function setSheetAppearance(value: SheetAppearance): Promise<void> {
  try {
    await state.api?.workspace?.getConfiguration('worksheet').update('sheetAppearance', value);
  } catch (err) {
    console.warn('[Worksheet] sheetAppearance persist failed (applied for this session):', err);
  }
  for (const fn of appearanceListeners) { try { fn(value); } catch { /* pane torn down */ } }
}

// ── Study clock idle threshold (worksheet.idleMinutes) ─────────────────────
//
// The clock counts while a problem or the quiz is on screen and the student
// is active; after this many minutes without input the stretch is taken back
// (studyClock.ts). Reading keeps it running through the odd scroll; a break
// with the tab up counts for nothing.
export const IDLE_MINUTES_CHOICES = [5, 10, 15, 30] as const;
export function getIdleMinutes(): number {
  try {
    const v = Number(state.api?.workspace?.getConfiguration('worksheet').get<number>('idleMinutes', DEFAULT_IDLE_MINUTES) ?? DEFAULT_IDLE_MINUTES);
    return (IDLE_MINUTES_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_IDLE_MINUTES;
  } catch {
    return DEFAULT_IDLE_MINUTES;
  }
}
export async function setIdleMinutes(value: number): Promise<void> {
  try {
    await state.api?.workspace?.getConfiguration('worksheet').update('idleMinutes', value);
  } catch (err) {
    console.warn('[Worksheet] idleMinutes persist failed:', err);
  }
}
/** The pane is on screen: connected, laid out, and the window not hidden. */
export function paneOnScreen(root: HTMLElement): boolean {
  return !document.hidden && root.isConnected && root.offsetParent !== null;
}

// ── Exam date and XP as cash (worksheet.examDate, worksheet.xpCashRate) ─────
//
// The Dashboard counts the days to the exam, and, at a rate of dollars per
// 100 XP, says what the campaign's XP and each reward are worth: XP on its
// own means little, cash is a reward one can feel. Cash Out on the Dashboard
// records what the student paid themselves.
export function getExamDate(): string {
  try {
    const v = String(state.api?.workspace?.getConfiguration('worksheet').get<string>('examDate', '') ?? '');
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}
export async function setExamDate(value: string): Promise<void> {
  try {
    await state.api?.workspace?.getConfiguration('worksheet').update('examDate', value);
  } catch (err) {
    console.warn('[Worksheet] examDate persist failed:', err);
  }
}
/** Dollars per 100 XP; 0 turns cash off. */
export function getXpCashRate(): number {
  try {
    const v = Number(state.api?.workspace?.getConfiguration('worksheet').get<number>('xpCashRate', 0) ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}
export async function setXpCashRate(value: number): Promise<void> {
  try {
    await state.api?.workspace?.getConfiguration('worksheet').update('xpCashRate', value);
  } catch (err) {
    console.warn('[Worksheet] xpCashRate persist failed:', err);
  }
}

// ── Decimals shown (worksheet.displayDecimals) ──────────────────────────────
//
// A cell without a number format paints at most this many decimals; the
// stored value and the cell editor keep full precision. Open sheet panes
// listen so a change on the Settings tab repaints every sheet at once.

export const decimalsListeners = new Set<(decimals: number | null) => void>();

export function getDisplayDecimalsSetting(): string {
  try {
    const v = String(state.api?.workspace?.getConfiguration('worksheet').get<string>('displayDecimals', DEFAULT_DISPLAY_DECIMALS) ?? DEFAULT_DISPLAY_DECIMALS);
    return (DISPLAY_DECIMALS_CHOICES as readonly string[]).includes(v) ? v : DEFAULT_DISPLAY_DECIMALS;
  } catch {
    return DEFAULT_DISPLAY_DECIMALS;
  }
}

export function getDisplayDecimals(): number | null {
  return parseDisplayDecimals(getDisplayDecimalsSetting());
}

export async function setDisplayDecimalsSetting(value: string): Promise<void> {
  try {
    await state.api?.workspace?.getConfiguration('worksheet').update('displayDecimals', value);
  } catch (err) {
    console.warn('[Worksheet] displayDecimals persist failed (applied for this session):', err);
  }
  const decimals = parseDisplayDecimals(value);
  for (const fn of decimalsListeners) { try { fn(decimals); } catch { /* pane torn down */ } }
}

export const AUTOSAVE_MS = 5000;

// ── Univer bundle loader ────────────────────────────────────────────────────

type UniverHostModule = {
  createWorksheetHost(opts: { container: HTMLElement; snapshot?: IWorkbookData | null; darkMode?: boolean; displayDecimals?: number | null; onFormulaError?: (summary: string, detail: string) => void; onEngineFault?: (summary: string, detail: string) => void }): IWorksheetHost;
};

let _univerModule: Promise<UniverHostModule> | null = null;

/**
 * Load the engine bundle once per window. The specifier is computed at
 * runtime so esbuild cannot inline the multi-megabyte engine into the main
 * bundle; Chromium resolves it against the renderer's HTTP origin.
 */
export function loadUniverModule(): Promise<UniverHostModule> {
  if (_univerModule) return _univerModule;
  const jsUrl = new URL('dist/renderer/worksheet-univer.js', document.baseURI).href;
  const cssId = 'worksheet-univer-css';
  if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = new URL('dist/renderer/worksheet-univer.css', document.baseURI).href;
    document.head.appendChild(link);
  }
  _univerModule = import(/* webpackIgnore: true */ jsUrl) as Promise<UniverHostModule>;
  return _univerModule;
}

export function parseWorkbook(json: string): IWorkbookData | null {
  if (!json) return null;
  try { return JSON.parse(json) as IWorkbookData; } catch { return null; }
}

// ── Practice sessions (instanceIds 'practice' + 'practice-run') ─────────────
//
// The daily driver: filter the bank (tags ANY-match, attempt-state focus),
// pick a count, shuffle, then work the items one after another with the
// full item player (attempts, reveal, self-grade, AI review — all reused).
// The running session lives module-level so pane rebuilds cannot eat it.

export interface RunningPractice {
  /** The stored session (ws_quiz_session); attempts rated inside carry it. */
  id: string;
  /** The quiz's name: given on Home, the Dashboard or the builder, changed from the overview. */
  name: string;
  ids: number[];
  index: number;
  startedAt: number;
  skipped: Set<number>;
  /** Mark For Later: problems flagged in this quiz to come back to. Only the
   *  student clears a mark; rating or working the problem leaves it, unlike
   *  a skip. On the quiz, not the problem (the star is the cross-quiz one). */
  marked: Set<number>;
  /** Set when the quiz is finished and reopened to review the work. */
  finishedAt: number | null;
}
/** Told when a problem is marked or unmarked, wherever the flag was clicked. */
export const markListeners = new Set<() => void>();
/** Open Quiz tabs, told when a different quiz begins so they show it. */
export const practiceListeners = new Set<() => void>();

/** The running quiz as stored: a restart or a tool reload resumes it. */
export async function persistPractice(announce = false): Promise<void> {
  const s = state.practice;
  if (!s) return;
  await saveQuizSession({ id: s.id, name: s.name, itemIds: s.ids, position: s.index, skipped: [...s.skipped], marked: [...s.marked], startedAt: s.startedAt, finishedAt: s.finishedAt }, announce)
    .catch((err) => console.warn('[Worksheet] quiz session save failed:', err));
}
/** A new, named quiz over these problems, starting at `startAt`. Open quizzes
 *  stay open: a quiz is a saved thing, and only Complete Quiz on its summary
 *  finishes it. */
export async function beginPractice(ids: number[], startAt = 0, name = ''): Promise<void> {
  state.practice = { id: newQuizId(), name: name.trim() || defaultQuizName(ids.length), ids: [...ids], index: Math.max(0, Math.min(startAt, ids.length - 1)), startedAt: Date.now(), skipped: new Set(), marked: new Set(), finishedAt: null };
  await persistPractice(true);
  for (const fn of practiceListeners) { try { fn(); } catch { /* pane torn down */ } }
}
/** The quiz in memory, else the stored open one (app restart, tool reload). */
export async function restorePractice(): Promise<RunningPractice | null> {
  if (state.practice) return state.practice;
  const row = await getOpenQuizSession().catch(() => null);
  if (!row || row.itemIds.length === 0) return null;
  state.practice = { id: row.id, name: row.name, ids: row.itemIds, index: Math.max(0, Math.min(row.position, row.itemIds.length)), startedAt: row.startedAt, skipped: new Set(row.skipped), marked: new Set(row.marked), finishedAt: null };
  return state.practice;
}
/** The quiz an attempt rated now belongs to, when its problem is in the running quiz. */
export function quizSessionIdFor(itemId: number): string | undefined {
  return state.practice && state.practice.ids.includes(itemId) ? state.practice.id : undefined;
}
// ── Review: walking through problems, work and solution showing, no quiz ──
//
// Going back over problems already done, filtered as one likes, without a
// quiz: no session, no scoring, nothing recorded. The
// walk is the bank's filtered list; each step is the problem's own sheet,
// opened as he left it with the solution revealed. Rating, starring and the
// note stay available on the sheet because they are his tracking; an edit
// still counts as work, as it does anywhere.

export interface ReviewWalk { ids: number[]; index: number }
/** Open Review tabs, told when a new walk begins so they show it. */
export const reviewListeners = new Set<() => void>();
