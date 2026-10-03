// Worksheets (M99) — exam-faithful practice sheets.
//
// A generic substrate surface: bounded spreadsheet items with givens and
// solutions, for practicing under a target tool's constraints (first user:
// CAS Exam 7 / Pearson Athena — docs/research/CAS_Pearson_Spreadsheet_Environment.md).
//
// The Univer engine ships as a SEPARATE lazily-imported bundle
// (dist/renderer/worksheet-univer.js, built from ./univerHost.ts) so the main
// bundle never pays for it. This module only type-imports from univerHost.
//
// Pane lifecycle contract (see editor-pane-lifecycle memory): panes are
// DESTROYED and rebuilt on every same-group tab switch. Scratch-sheet state
// survives via an in-memory snapshot cache; item attempts persist to SQLite
// (autosave + capture on dispose), so nothing is lost either way.
//
// Athena fidelity notes: the real exam does NOT lock given cells — the heavy
// border fences them visually and Reset Sheet is the recovery path. We match
// that: no cell locking, a confirmed Reset, one sheet, no tabs.

import type { IWorkbookData } from '@univerjs/core';
import type { IWorksheetHost, SheetViewState } from './univerHost.js';
import { renderMarkdown } from '../../ui/renderMarkdown.js';
import { createButton, createEmptyState, createFilterChip, createIconButton, createPageHeader, createSectionLabel, createSegmented, type IKitAction } from '../../ui/kit.js';
import { showExtensionContextMenu, type IExtensionMenuItem } from '../../ui/contextMenu.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import {
  listItems, getItem, createItem, deleteItem, getOpenAttempt, getLatestWork, saveAttemptCells,
  discardOpenAttempt, completeAttempt, markAttemptWorked, saveAttemptReview, onWorksheetDataChanged,
  getSessionGrades, attachWorksheetDatabase, recordImportedRating, upsertProgressSnapshot,
  getCampaign, startCampaign, endCampaign, listAttemptHistory,
  getOpenQuizSession, saveQuizSession, finishQuizSession, renameQuizSession, reopenQuizSession, deleteQuizSession,
  getQuizSession, listQuizSessions, getSessionItemStates, getProblemNotes, setProblemNote, setItemStarred, getStarred,
  addStudySeconds, getStudySecondsForItem, recordXpCashout,
  type WorksheetItem, type WorksheetItemSummary,
} from './worksheetData.js';
import { openXlsx } from './ooxml.js';
import { detectProblems, readWorkbookTimeline, normalizeRating, ratingLabel, paperLabel, SOURCE_LABELS, KIND_LABELS, QUADRANT_LABELS, type ProblemImport, type WorkbookSnapshot } from './problemImport.js';
import { createDashboardPane, planDay, dayStrip } from './dashboardPane.js';
import { planCampaign, campaignProgress, addDays, spanDays, workingDays, restDaysLabel, isCampaignProblem, WEEKDAY_LABELS } from './campaign.js';
import { parseDisplayDecimals, DISPLAY_DECIMALS_CHOICES, DEFAULT_DISPLAY_DECIMALS } from './displayNumbers.js';
import { indexPristine, solutionSegments as pureSolutionSegments, applySolutionVisibility as pureApplySolutionVisibility, type PristineIndex } from './solutionVisibility.js';
import { syncRewards } from './rewardsSync.js';
import { dayKey, computeInsights } from './progressInsights.js';
import { IDatabaseService } from '../../services/serviceTypes.js';
import { buildPracticeSet, itemTags } from './practiceSession.js';
import { itemToWorkbooks, workbookHasOnSheetQuestion, type GeneratedItem } from './itemFormat.js';
import { generateItems, reviewAttempt, buildReviewRequest, type LmApiLike } from './worksheetAi.js';
import { nextMarkedIndex } from './practiceSession.js';
import { createStudyTicker, DEFAULT_IDLE_MINUTES } from './studyClock.js';
import { registerWorksheetChatTools, buildNotesDigest } from './worksheetChat.js';
import { detectExcelItems, wholeSheetItem, type GridSheet, type ExcelItem } from './excelImport.js';
import './worksheet.css';

// ── API typings (structural — the tool API surface) ─────────────────────────

// ── Review in Chat ──────────────────────────────────────────────────────────
// The learner's cells and the model solution go to the chat as an attached
// context chip, with the review brief STAGED in the input, not sent: the user
// adds their own question under the brief and presses send, the same hand-off
// the flashcards' Discuss with AI uses (Mufaro, 2026-09-21: auto-sending asked
// only the question the code guessed; 2026-09-08: the one-shot panel left
// nowhere to ask further). Returns 'inline' when the chat surface is not
// there, so the caller can fall back to the one-shot review. An empty sheet
// throws before anything is staged.
async function reviewInChat(
  item: { title: string; questionMd: string; solutionJson: string; solutionNotesMd: string },
  itemId: number,
  cellsJson: string,
): Promise<'chat' | 'inline'> {
  const req = buildReviewRequest(item, cellsJson);
  const cmds = _api?.commands;
  if (!cmds?.executeCommand) return 'inline';
  try {
    // chat.show is the idempotent reveal (never chat.focus, which toggles).
    await cmds.executeCommand('chat.show');
    await cmds.executeCommand('chat.addSelectionContext', {
      kind: 'selection',
      id: `worksheet:item/${itemId}/work/${Date.now()}`,
      name: `${item.title}: my work`,
      fullPath: `worksheet:item/${itemId}`,
      isImplicit: false,
      selectedText: req.context,
      surface: 'worksheet',
    });
    await cmds.executeCommand('chat.stagePrompt', { text: req.prompt });
  } catch {
    return 'inline';
  }
  // Staged, not sent: the journal must not claim a review that may never run.
  _api?.activity?.note('staged', `worksheet attempt on "${item.title}"`, 'in the chat with the review brief, for a question and send');
  return 'chat';
}

/** Every note, staged in the chat (Mufaro, 2026-09-21: "have AI look at the
 *  whole bank, which problems have notes, gain some insights"). The digest
 *  is the text the worksheet.getNotes tool returns, so what he sees in the
 *  chip is what the model reads. Staged, never sent. */
async function discussNotesInChat(items: WorksheetItemSummary[]): Promise<void> {
  const cmds = _api?.commands;
  if (!cmds?.executeCommand) return;
  const noted = items.filter((it) => it.note);
  if (noted.length === 0) return;
  const noun = noted.length === 1 ? 'problem' : 'problems';
  try {
    await cmds.executeCommand('chat.show');
    await cmds.executeCommand('chat.addSelectionContext', {
      kind: 'selection',
      id: `worksheet:notes/${Date.now()}`,
      name: `My notes on ${noted.length} ${noun}`,
      fullPath: 'worksheet:notes',
      isImplicit: false,
      selectedText: buildNotesDigest(items),
      surface: 'worksheet',
    });
    await cmds.executeCommand('chat.stagePrompt', {
      text: [
        `Read my notes on ${noted.length} ${noun} in the attached context. I write them on the fly during quizzes, mostly about what I need to review.`,
        'Group them by topic, tell me what I keep flagging, and which problems to revisit first, naming each problem.',
      ].join(' ') + '\n\n',
    });
  } catch { /* no chat surface */ }
  _api?.activity?.note('staged', `notes on ${noted.length} worksheet ${noun}`, 'in the chat, for a question and send');
}

interface ParallxApiLike {
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
  };
  services?: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
  icons?: { createIconHtml?(id: string, size?: number): string };
  window?: {
    showConfirmModal?(options: { message: string; detail?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
    showWarningMessage?(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showInformationMessage?(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage?(message: string): Promise<unknown>;
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

interface ToolContextLike {
  subscriptions: { push(d: { dispose(): void }): void };
}

let _api: ParallxApiLike | null = null;

/** Scratch-sheet snapshots cached across pane rebuilds (in-memory only). */
const _scratchCache = new Map<string, IWorkbookData>();
/**
 * The last working snapshot of each item pane, by instance id. A sheet pane
 * is torn down on every tab switch (one live engine per window); the
 * database write it makes on the way out may still be in flight when the
 * tab comes back, so the remount reads this first.
 */
const _workingCache = new Map<string, IWorkbookData>();

// ── Sheet appearance (worksheet.sheetAppearance) ────────────────────────────
//
// The SHEET theme is independent of the app theme (Mufaro: "user may want
// dark mode for UI, but worksheet as light mode"). 'light' is the default —
// the real Athena sheet is always white. 'app' follows the workbench mode
// live; the Sheet Theme button on any sheet flips light↔dark and persists.

type SheetAppearance = 'light' | 'dark' | 'app';

/** Open sheet panes listening for appearance changes (toggle on one pane
 *  updates every pane — no config-change event exists for tools). */
const _appearanceListeners = new Set<(appearance: SheetAppearance) => void>();

function appIsDark(): boolean {
  return document.documentElement.getAttribute('data-px-mode') !== 'light';
}

function getSheetAppearance(): SheetAppearance {
  try {
    const v = _api?.workspace?.getConfiguration('worksheet').get<string>('sheetAppearance', 'light');
    return v === 'dark' || v === 'app' ? v : 'light';
  } catch {
    return 'light';
  }
}

function resolveSheetDark(appearance: SheetAppearance = getSheetAppearance()): boolean {
  return appearance === 'dark' || (appearance === 'app' && appIsDark());
}

async function setSheetAppearance(value: SheetAppearance): Promise<void> {
  try {
    await _api?.workspace?.getConfiguration('worksheet').update('sheetAppearance', value);
  } catch (err) {
    console.warn('[Worksheet] sheetAppearance persist failed (applied for this session):', err);
  }
  for (const fn of _appearanceListeners) { try { fn(value); } catch { /* pane torn down */ } }
}

// ── Study clock idle threshold (worksheet.idleMinutes) ─────────────────────
//
// The clock counts while a problem or the quiz is on screen and the student
// is active; after this many minutes without input the stretch is taken back
// (studyClock.ts). Reading keeps it running through the odd scroll; a break
// with the tab up counts for nothing.
const IDLE_MINUTES_CHOICES = [5, 10, 15, 30] as const;
function getIdleMinutes(): number {
  try {
    const v = Number(_api?.workspace?.getConfiguration('worksheet').get<number>('idleMinutes', DEFAULT_IDLE_MINUTES) ?? DEFAULT_IDLE_MINUTES);
    return (IDLE_MINUTES_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_IDLE_MINUTES;
  } catch {
    return DEFAULT_IDLE_MINUTES;
  }
}
async function setIdleMinutes(value: number): Promise<void> {
  try {
    await _api?.workspace?.getConfiguration('worksheet').update('idleMinutes', value);
  } catch (err) {
    console.warn('[Worksheet] idleMinutes persist failed:', err);
  }
}
/** The pane is on screen: connected, laid out, and the window not hidden. */
function paneOnScreen(root: HTMLElement): boolean {
  return !document.hidden && root.isConnected && root.offsetParent !== null;
}

// ── Exam date and XP as cash (worksheet.examDate, worksheet.xpCashRate) ─────
//
// The Dashboard counts the days to the exam, and, at a rate of dollars per
// 100 XP, says what the campaign's XP and each reward are worth (Mufaro,
// 2026-09-21: XP "sort of means nothing to me; what if XP could be converted
// to cash"). Cash Out on the Dashboard records what he paid himself.
function getExamDate(): string {
  try {
    const v = String(_api?.workspace?.getConfiguration('worksheet').get<string>('examDate', '') ?? '');
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}
async function setExamDate(value: string): Promise<void> {
  try {
    await _api?.workspace?.getConfiguration('worksheet').update('examDate', value);
  } catch (err) {
    console.warn('[Worksheet] examDate persist failed:', err);
  }
}
/** Dollars per 100 XP; 0 turns cash off. */
function getXpCashRate(): number {
  try {
    const v = Number(_api?.workspace?.getConfiguration('worksheet').get<number>('xpCashRate', 0) ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}
async function setXpCashRate(value: number): Promise<void> {
  try {
    await _api?.workspace?.getConfiguration('worksheet').update('xpCashRate', value);
  } catch (err) {
    console.warn('[Worksheet] xpCashRate persist failed:', err);
  }
}

// ── Decimals shown (worksheet.displayDecimals) ──────────────────────────────
//
// A cell without a number format paints at most this many decimals; the
// stored value and the cell editor keep full precision. Open sheet panes
// listen so a change on the Settings tab repaints every sheet at once.

const _decimalsListeners = new Set<(decimals: number | null) => void>();

function getDisplayDecimalsSetting(): string {
  try {
    const v = String(_api?.workspace?.getConfiguration('worksheet').get<string>('displayDecimals', DEFAULT_DISPLAY_DECIMALS) ?? DEFAULT_DISPLAY_DECIMALS);
    return (DISPLAY_DECIMALS_CHOICES as readonly string[]).includes(v) ? v : DEFAULT_DISPLAY_DECIMALS;
  } catch {
    return DEFAULT_DISPLAY_DECIMALS;
  }
}

function getDisplayDecimals(): number | null {
  return parseDisplayDecimals(getDisplayDecimalsSetting());
}

async function setDisplayDecimalsSetting(value: string): Promise<void> {
  try {
    await _api?.workspace?.getConfiguration('worksheet').update('displayDecimals', value);
  } catch (err) {
    console.warn('[Worksheet] displayDecimals persist failed (applied for this session):', err);
  }
  const decimals = parseDisplayDecimals(value);
  for (const fn of _decimalsListeners) { try { fn(decimals); } catch { /* pane torn down */ } }
}


/** The scratch-bar / item-header toggle: flips the sheet light↔dark (a
 *  pinned choice — 'app' is reachable in Settings). */
/** An icon button for the sheet bars: the icon is the label and the word is
 *  the tooltip's first line (Mufaro, 2026-09-14: no more rows of word
 *  buttons; same pattern as the flashcards study toolbar). Falls back to the
 *  word when the registry lacks the icon. */
function iconBtn(iconId: string, label: string, opts: { hint?: string; primary?: boolean; danger?: boolean; onClick?: () => void } = {}): HTMLButtonElement {
  // The kit's icon button; an accent glyph for the primary one, red on hover for a danger one.
  const b = createIconButton(null, { icon: iconId, title: label });
  if (opts.primary) b.classList.add('ws-icon--accent');
  if (opts.danger) b.classList.add('ws-icon--danger');
  paintIconBtn(b, iconId, label, opts.hint);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}
function paintIconBtn(b: HTMLButtonElement, iconId: string, label: string, hint?: string): void {
  let svg = '';
  try { svg = _api?.icons?.createIconHtml?.(iconId, 16) ?? ''; } catch { svg = ''; }
  if (svg) b.innerHTML = svg; else b.textContent = label;
  // The app's tooltip collapses line breaks, so the word and the hint read as two sentences.
  b.title = hint ? `${label}. ${hint}` : label;
  b.setAttribute('aria-label', label);
}
/** The star: the student's bookmark on a problem, one look everywhere it
 *  appears (sheet header, bank row, quiz overview). Stored on the problem,
 *  so it outlives the quiz it was set in. */
const STAR_HINT = 'Kept on the problem across quizzes. Quiz Starred on Home, the Dashboard or the quiz builder runs every starred problem.';
function paintStarBtn(b: HTMLButtonElement, on: boolean): void {
  paintIconBtn(b, 'star', on ? 'Unstar Problem' : 'Star Problem', on ? 'Takes the star off this problem.' : STAR_HINT);
  b.classList.toggle('ws-star--on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function starBtn(itemId: number, starred: boolean, onChange?: (on: boolean) => void): HTMLButtonElement {
  const b = iconBtn('star', 'Star Problem');
  b.classList.add('ws-star');
  let on = starred;
  paintStarBtn(b, on);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    on = !on;
    paintStarBtn(b, on);
    onChange?.(on);
    void setItemStarred(itemId, on).catch(() => { on = !on; paintStarBtn(b, on); onChange?.(on); });
  });
  return b;
}
/** Mark For Later: the flag on a problem inside ONE quiz, an exam's mark for
 *  review (Mufaro, 2026-09-21: no easy way to come back to a problem later in
 *  the quiz). Same pressed look as the star, a flag instead of a star, so the
 *  two never read as one thing; stored on the quiz, so it goes with it. */
const MARK_HINT = 'Flags this problem to come back to in this quiz. Marked problems show in Quiz Overview, and Next Marked jumps between them.';
function paintMarkBtn(b: HTMLButtonElement, on: boolean): void {
  paintIconBtn(b, 'flag', on ? 'Unmark Problem' : 'Mark for Later', on ? 'Takes the mark off this problem.' : MARK_HINT);
  b.classList.toggle('ws-mark--on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function markBtn(session: RunningPractice, itemId: number, onChange?: (on: boolean) => void): HTMLButtonElement {
  const b = iconBtn('flag', 'Mark for Later');
  b.classList.add('ws-mark');
  paintMarkBtn(b, session.marked.has(itemId));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !session.marked.has(itemId);
    if (on) session.marked.add(itemId); else session.marked.delete(itemId);
    paintMarkBtn(b, on);
    void persistPractice();
    onChange?.(on);
    for (const fn of _markListeners) { try { fn(); } catch { /* pane torn down */ } }
  });
  return b;
}
/** Sun when the sheet is dark (click for light), moon when light. */
function paintSheetThemeButton(btn: HTMLButtonElement): void {
  const dark = resolveSheetDark();
  paintIconBtn(btn, dark ? 'sun' : 'moon', dark ? 'Light Sheet' : 'Dark Sheet', 'Flips this practice sheet only. Light matches the real exam surface; Settings has a follow-the-app option.');
}
function makeSheetThemeButton(): HTMLButtonElement {
  const btn = iconBtn('moon', 'Dark Sheet', { onClick: () => { void setSheetAppearance(resolveSheetDark() ? 'light' : 'dark'); } });
  paintSheetThemeButton(btn);
  return btn;
}

const WS_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

const AUTOSAVE_MS = 5000;

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
function loadUniverModule(): Promise<UniverHostModule> {
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

function parseWorkbook(json: string): IWorkbookData | null {
  if (!json) return null;
  try { return JSON.parse(json) as IWorkbookData; } catch { return null; }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── Item browser (instanceId 'home') ────────────────────────────────────────

/** Papers opened in the Problem Bank page; survives re-renders. */
const _homeOpen = new Set<string>();

function createBankPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-home');
  container.appendChild(root);
  let disposed = false;
  let items: WorksheetItemSummary[] = [];
  // The header and the filter bar stay put while you type; only the list
  // and the counts repaint.
  const headHost = el('div');
  const barHost = el('div');
  const listHost = el('div');
  root.append(headHost, barHost, listHost);
  let countEl: HTMLElement | null = null;

  const shownProblems = () => items.filter((it) => it.paper && bankMatches(it, _bankFilters, _bankQuery));

  const paintHeader = () => {
    headHost.replaceChildren();
    const problems = items.filter((it) => it.paper);
    const rated = problems.filter((it) => normalizeRating(it.attemptState)).length;
    const papers = new Set(problems.map((it) => it.paper)).size;
    const noted = items.filter((it) => it.note);
    const generated = items.filter((it) => !it.paper);
    const shown = shownProblems();
    createPageHeader(headHost, {
      back: BACK_TO_HOME,
      title: 'Problem Bank',
      subtitle: problems.length ? `${problems.length} problems · ${rated} rated · ${papers} ${papers === 1 ? 'paper' : 'papers'}` : undefined,
      secondary: noted.length ? [{ label: `Discuss Notes in Chat (${noted.length})`, icon: 'message-square', title: 'Stages every note, with its problem, paper and rating, in the chat. Add your question under the brief, then send.', onClick: () => void discussNotesInChat(items) }] : [],
      primary: shown.length ? { label: 'Quiz These…', title: 'Opens the quiz builder with the problems shown here.', onClick: () => { _quizPreset = { ids: shown.map((it) => it.id), name: '' }; openBuilder(); } } : undefined,
      more: generated.length ? [{ label: `Delete All Generated Items (${generated.length})…`, icon: 'trash-2', danger: true, onSelect: () => void deleteGeneratedItems(generated) }] : [],
    });
  };

  // One row per problem, but only inside the paper you open: 331 rows in a
  // flat list is the workbook's 331 tabs all over again.
  const itemRow = (item: WorksheetItemSummary, generated: boolean): HTMLElement => {
    const row = el('div', 'ws-list__row ws-bankrow');
    row.appendChild(starBtn(item.id, item.starred));
    const info = el('button', 'ws-list__text') as HTMLButtonElement;
    info.type = 'button';
    const titleRow = el('span', 'ws-list__title');
    titleRow.appendChild(document.createTextNode(item.title));
    if (item.attemptState === 'open') titleRow.appendChild(el('span', 'ws-chip ws-chip--open', 'In progress'));
    else if (item.attemptState) titleRow.appendChild(el('span', `ws-chip ws-chip--${stateClass(item.attemptState)}`, gradeLabel(item.attemptState)));
    else titleRow.appendChild(el('span', 'ws-chip ws-chip--muted', 'Not rated'));
    info.appendChild(titleRow);
    const meta: string[] = [];
    if (item.paper) meta.push([SOURCE_LABELS[item.source] ?? '', KIND_LABELS[item.kind] ?? '', item.quadrant ? QUADRANT_LABELS[item.quadrant] : ''].filter(Boolean).join(' · '));
    else if (item.sourceLabel) meta.push(item.sourcePage > 0 ? `${item.sourceLabel} · p.${item.sourcePage}` : item.sourceLabel);
    if (!item.paper && item.tags) meta.push(item.tags.split(',').filter(Boolean).map((t) => `#${t.trim()}`).join(' '));
    if (item.attemptCount > 0) meta.push(`${item.attemptCount} ${item.attemptCount === 1 ? 'attempt' : 'attempts'}`);
    if (item.seconds > 0) meta.push(fmtStudy(item.seconds));
    if (item.lastAttemptAt > 0) meta.push(`last ${new Date(item.lastAttemptAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
    info.appendChild(el('span', 'ws-list__meta', meta.join(' · ')));
    // The note, in the row: what he told himself about this problem, where he picks it.
    if (item.note) {
      const n = el('span', 'ws-list__note');
      n.append(createIconElement('notebook-pen', 12), document.createTextNode(item.note));
      n.title = item.note;
      info.appendChild(n);
    }
    info.title = `Practice ${item.title}`;
    info.addEventListener('click', () => void openWorksheet(`item:${item.id}`, item.title));
    row.appendChild(info);
    const actions = el('div', 'ws-list__end ws-list__hover');
    createButton(actions, { label: 'Practice', size: 'sm', onClick: () => void openWorksheet(`item:${item.id}`, item.title) });
    const more = createIconButton(actions, { icon: 'ellipsis', title: `More actions for ${item.title}`, size: 'sm' });
    more.addEventListener('click', () => showMenu(more, [
      { label: 'Quiz This Problem', icon: 'play', onSelect: () => startQuizWith([item.id], 0, item.title) },
      { label: item.starred ? 'Unstar' : 'Star', icon: 'star', onSelect: () => void setItemStarred(item.id, !item.starred).catch(() => {}) },
      ...(generated ? [
        { separator: true },
        { label: 'Delete Item…', icon: 'trash-2', danger: true, onSelect: () => {
          void (async () => {
            const ok = await _api?.window?.showConfirmModal?.({
              message: `Delete "${item.title}"?`,
              detail: 'This permanently deletes the item, its solution, and every attempt. This cannot be undone.',
              confirmLabel: 'Delete Item',
              danger: true,
            }) ?? false;
            if (ok) await deleteItem(item.id);
          })();
        } },
      ] : []),
    ]));
    row.appendChild(actions);
    return row;
  };

  const paintList = () => {
    listHost.replaceChildren();
    paintHeader();
    const all = items.filter((it) => it.paper);
    const problems = shownProblems();
    if (countEl) {
      countEl.replaceChildren(document.createTextNode(`${problems.length} of ${all.length}`));
      if (_bankFilters.size || _bankQuery) {
        const clear = el('button', 'ws-linkbtn', 'Clear filters') as HTMLButtonElement;
        clear.type = 'button';
        clear.addEventListener('click', () => { _bankFilters.clear(); _bankQuery = ''; paintBar(); paintList(); });
        countEl.append(document.createTextNode(' · '), clear);
      }
    }
    const filtering = _bankFilters.size > 0 || !!_bankQuery;
    const generated = items.filter((it) => !it.paper);
    const byPaper = new Map<string, WorksheetItemSummary[]>();
    for (const it of all) { if (!byPaper.has(it.paper)) byPaper.set(it.paper, []); byPaper.get(it.paper)!.push(it); }
    const list = el('div', 'ws-list');
    for (const [key, group] of [...byPaper.entries()].sort((a, b) => paperLabel(a[0]).localeCompare(paperLabel(b[0])))) {
      const shown = group.filter((it) => problems.includes(it));
      const rated = group.filter((it) => normalizeRating(it.attemptState)).length;
      const secs = group.reduce((n, it) => n + it.seconds, 0);
      const open = filtering ? shown.length > 0 : _homeOpen.has(key);
      const head = el('button', 'ws-list__row ws-list__group') as HTMLButtonElement;
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      head.appendChild(createIconElement(open ? 'chevron-down' : 'chevron-right', 14));
      head.appendChild(el('span', 'ws-list__title', paperLabel(key)));
      if (filtering) head.appendChild(el('span', 'ws-list__meta', `${shown.length} shown`));
      const end = el('span', 'ws-list__end');
      const bar = el('span', 'ws-bank__bar');
      bar.title = 'Easy, medium and hard, of the paper';
      for (const cls of ['easy', 'medium', 'hard'] as const) {
        const n = group.filter((it) => stateClass(it.attemptState) === cls).length;
        if (n === 0) continue;
        const seg = el('span', cls);
        seg.style.width = `${(n / group.length) * 100}%`;
        bar.appendChild(seg);
      }
      end.append(bar, el('span', 'ws-list__meta', `${rated} of ${group.length} rated${secs > 0 ? ` · ${fmtStudy(secs)}` : ''}`));
      head.appendChild(end);
      head.addEventListener('click', () => { if (_homeOpen.has(key)) _homeOpen.delete(key); else _homeOpen.add(key); paintList(); });
      list.appendChild(head);
      if (open) for (const it of (filtering ? shown : group)) list.appendChild(itemRow(it, false));
    }
    if (generated.length > 0) {
      const open = _homeOpen.has('__generated');
      const head = el('button', 'ws-list__row ws-list__group') as HTMLButtonElement;
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      head.appendChild(createIconElement(open ? 'chevron-down' : 'chevron-right', 14));
      head.appendChild(el('span', 'ws-list__title', 'Generated items'));
      head.appendChild(el('span', 'ws-list__meta', `${generated.length} · not part of the workbook bank`));
      head.addEventListener('click', () => { if (open) _homeOpen.delete('__generated'); else _homeOpen.add('__generated'); paintList(); });
      list.appendChild(head);
      if (open) for (const it of generated) list.appendChild(itemRow(it, true));
    }
    listHost.appendChild(list);
  };

  const paintBar = () => {
    barHost.replaceChildren();
    if (items.length === 0) return;
    const bar = el('div', 'ws-home__filters');
    const search = el('label', 'ws-search');
    search.appendChild(createIconElement('search', 14));
    const input = el('input') as HTMLInputElement;
    input.type = 'search';
    input.placeholder = 'Search problems';
    input.value = _bankQuery;
    input.setAttribute('aria-label', 'Search problems');
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { _bankQuery = input.value.trim(); paintList(); }, 120);
    });
    search.appendChild(input);
    bar.appendChild(search);
    // One chip per filter, grouped by what they filter on; several can be on.
    // Within a group any may match, across groups all must.
    const chips = el('div', 'ws-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Filters');
    const present = new Set<string>();
    for (const it of items) { present.add(it.source); present.add(it.kind); }
    const count = (f: string) => items.filter((it) => it.paper && bankMatches(it, new Set([f]), '')).length;
    for (const [value, label] of BANK_FILTERS) {
      if (([...BANK_FACETS.source, ...BANK_FACETS.kind] as readonly string[]).includes(value) && !present.has(value)) continue;
      const withCount = value === 'starred' || value === 'noted' || value === 'incomplete';
      createFilterChip(chips, {
        label, count: withCount ? count(value) : undefined, pressed: _bankFilters.has(value),
        onToggle: (on) => { if (on) _bankFilters.add(value); else _bankFilters.delete(value); paintList(); },
      });
    }
    bar.appendChild(chips);
    countEl = el('span', 'ws-home__summary');
    bar.appendChild(countEl);
    barHost.appendChild(bar);
  };

  const render = async () => {
    if (disposed) return;
    items = await listItems().catch(() => []);
    if (disposed) return;
    if (items.length === 0) {
      headHost.replaceChildren();
      createPageHeader(headHost, { back: BACK_TO_HOME, title: 'Problem Bank' });
      barHost.replaceChildren();
      listHost.replaceChildren();
      createEmptyState(listHost, {
        icon: 'library',
        headline: 'No problems yet.',
        hint: 'Import a practice workbook, or generate items from a PDF or pasted material.',
        action: { label: 'Import Workbook…', onClick: () => void openWorksheet('excel-import', 'Import Workbook') },
      });
      return;
    }
    if (!barHost.firstChild) paintBar();
    paintList();
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());

  return {
    dispose: () => {
      disposed = true;
      sub.dispose();
      root.remove();
    },
  };
}

/** Easy, Medium, Hard: the workbook's words, for new and legacy grades alike. */
function gradeLabel(grade: string): string {
  return ratingLabel(grade) || grade;
}
/** The chip/dot class for an attempt state: easy | medium | hard | open. */
function stateClass(state: string): string {
  return state === 'open' ? 'open' : normalizeRating(state) || state;
}
/** Study time in a summary: "12m", "3h 08m", never seconds (those belong to the sheet's clock). */
function fmtStudy(total: number): string {
  const s = Math.max(0, Math.round(total));
  if (s < 60) return s === 0 ? '0m' : '<1m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}
function fmtSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// ── The bank (sidebar): papers with counts and rating colours, filters, search ──
//
// The workbook's sidebar was 331 hidden tabs and three unhide buttons; this
// is the same bank laid out as a list. Groups open and close, and the
// choice survives a re-render (module state, like the scratch cache).

const _bankOpen = new Set<string>();
/** The bank's chips: any number on; within a facet any may match, across facets all must. */
const _bankFilters = new Set<string>();
let _bankQuery = '';
const BANK_FACETS = {
  status: ['starred', 'noted', 'incomplete'],
  rating: ['easy', 'medium', 'hard'],
  source: ['rf', 'cas'],
  kind: ['quant', 'qual', 'essay'],
} as const satisfies Record<string, readonly string[]>;
const BANK_FILTERS: [string, string][] = [
  ['starred', 'Starred'], ['noted', 'Noted'], ['incomplete', 'Incomplete'],
  ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'],
  ['rf', 'Rising Fellow'], ['cas', 'CAS Exam'],
  ['quant', 'Quantitative'], ['qual', 'Qualitative'], ['essay', 'Essay'],
];

function bankMatches(item: WorksheetItemSummary, filters: ReadonlySet<string>, query: string): boolean {
  const state = stateClass(item.attemptState);
  const test = (f: string): boolean => {
    if (f === 'starred') return !!item.starred;
    if (f === 'noted') return !!item.note;
    if (f === 'incomplete') return item.attemptCount === 0 || item.attemptState === 'open';
    if (f === 'easy' || f === 'medium' || f === 'hard') return state === f;
    if (f === 'rf' || f === 'cas') return item.source === f;
    return item.kind === f;
  };
  for (const facet of Object.values(BANK_FACETS) as readonly (readonly string[])[]) {
    const on = facet.filter((f) => filters.has(f));
    if (on.length && !on.some(test)) return false;
  }
  if (query) {
    const q = query.toLowerCase();
    const hay = `${item.title} ${item.sheetName} ${item.questionMd} ${paperLabel(item.paper)} ${item.note}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Remove every generated item (never a workbook problem), after one confirmation. */
async function deleteGeneratedItems(generated: WorksheetItemSummary[]): Promise<void> {
  const ok = await _api?.window?.showConfirmModal?.({
    message: `Delete all ${generated.length} generated ${generated.length === 1 ? 'item' : 'items'}?`,
    detail: 'Items generated from PDFs or pasted material, with their attempts, are permanently deleted. Workbook problems are untouched. This cannot be undone.',
    confirmLabel: 'Delete Generated Items',
    danger: true,
  }) ?? false;
  if (!ok) return;
  for (const it of generated) await deleteItem(it.id);
  _api?.activity?.note('deleted', `${generated.length} generated worksheet items`);
}

/** The bank in the sidebar: papers with their rating bars and counts, open to the problems, nothing else. */
function renderBankSnapshot(root: HTMLElement, items: WorksheetItemSummary[]): void {
  const problems = items.filter((it) => it.paper);
  const generated = items.filter((it) => !it.paper);
  const section = el('div', 'ws-side__section');
  const title = el('button', 'ws-side__sectiontitle', 'Problem Bank') as HTMLButtonElement;
  title.type = 'button';
  title.title = 'Open the Problem Bank as a tab';
  title.addEventListener('click', () => void openWorksheet('bank', 'Problem Bank'));
  section.appendChild(title);
  const ratedAll = problems.filter((it) => normalizeRating(it.attemptState)).length;
  section.appendChild(el('span', 'ws-side__sectioncount', `${ratedAll}/${problems.length}`));
  root.appendChild(section);
  const listHost = el('div', 'ws-bank__list');
  root.appendChild(listHost);

  const paint = () => {
    listHost.replaceChildren();
    const groups = new Map<string, WorksheetItemSummary[]>();
    for (const it of problems) { if (!groups.has(it.paper)) groups.set(it.paper, []); groups.get(it.paper)!.push(it); }
    for (const key of [...groups.keys()].sort((a, b) => paperLabel(a).localeCompare(paperLabel(b)))) {
      const list = groups.get(key)!;
      const head = el('div', 'ws-bank__paper');
      head.setAttribute('role', 'button');
      head.appendChild(el('span', 'ws-bank__papername', paperLabel(key)));
      const easy = list.filter((it) => stateClass(it.attemptState) === 'easy').length;
      const medium = list.filter((it) => stateClass(it.attemptState) === 'medium').length;
      const hard = list.filter((it) => stateClass(it.attemptState) === 'hard').length;
      const bar = el('div', 'ws-bank__bar');
      bar.title = `${easy} Easy · ${medium} Medium · ${hard} Hard · ${list.length - easy - medium - hard} not rated`;
      for (const [cls, n] of [['easy', easy], ['medium', medium], ['hard', hard]] as const) {
        if (n === 0) continue;
        const seg = el('span', cls);
        seg.style.width = `${(n / list.length) * 100}%`;
        bar.appendChild(seg);
      }
      head.appendChild(bar);
      head.appendChild(el('span', 'ws-bank__count', `${easy + medium + hard}/${list.length}`));
      head.addEventListener('click', () => { if (_bankOpen.has(key)) _bankOpen.delete(key); else _bankOpen.add(key); paint(); });
      listHost.appendChild(head);
      if (!_bankOpen.has(key)) continue;
      const rows = el('div', 'ws-bank__items');
      for (const it of list) {
        const row = el('div', 'ws-bank__item');
        // A workbook rating is a ring until the problem is touched here;
        // worked without a rating of his own, it takes the in-progress dot,
        // never the workbook's colour.
        const dot = it.attemptState === 'open' || (it.ratingImported && it.worked) ? 'open'
          : it.ratingImported ? `${stateClass(it.attemptState)} ws-bank__dot--workbook`
            : stateClass(it.attemptState);
        row.appendChild(el('span', `ws-bank__dot ${dot}`));
        row.appendChild(el('span', 'ws-bank__itemtitle', it.title));
        const secs = it.seconds > 0 ? ` · ${fmtStudy(it.seconds)}` : '';
        const state = !it.attemptState ? 'Never tried'
          : it.attemptState === 'open' ? 'In Progress'
            : it.ratingImported ? `${gradeLabel(it.attemptState)} in your workbook${it.worked ? ', worked here' : ''}`
              : gradeLabel(it.attemptState);
        row.title = `${it.title} · ${state}${secs}`;
        row.addEventListener('click', () => void openWorksheet(`item:${it.id}`, it.title));
        rows.appendChild(row);
      }
      listHost.appendChild(rows);
    }
    if (generated.length > 0) {
      const head = el('div', 'ws-bank__paper ws-bank__paper--generated');
      head.setAttribute('role', 'button');
      head.appendChild(el('span', 'ws-bank__papername', 'Generated Items'));
      head.appendChild(el('span', 'ws-bank__count', String(generated.length)));
      head.title = 'Items generated from PDFs or pasted material, kept apart from the workbook. Opens the Problem Bank.';
      head.addEventListener('click', () => void openWorksheet('bank', 'Problem Bank'));
      listHost.appendChild(head);
    }
  };
  paint();
}

// ── Sidebar view (activity bar → Worksheets): navigation, then the bank snapshot ──

function createSidebarView(container: HTMLElement) {
  const root = el('div', 'ws-sidebar');
  container.appendChild(root);
  let disposed = false;

  const render = async () => {
    if (disposed) return;
    const items = await listItems().catch(() => []);
    if (disposed) return;
    root.replaceChildren();
    const nav = el('div', 'ws-nav');
    // Same row shape as every other tool's sidebar: icon, then label.
    const navItem = (label: string, icon: string, instanceId: string, tabTitle: string, tip: string) => {
      const b = el('button', 'ws-nav__item') as HTMLButtonElement;
      b.type = 'button';
      b.title = tip;
      const ic = el('span', 'ws-nav__icon');
      try { ic.innerHTML = _api?.icons?.createIconHtml?.(icon, 16) ?? ''; } catch { /* label alone */ }
      b.append(ic, el('span', 'ws-nav__label', label));
      b.addEventListener('click', () => void openWorksheet(instanceId, tabTitle));
      nav.appendChild(b);
    };
    navItem('Home', 'home', 'home', 'Worksheets', 'Quiz, dashboard, bank, import, generate, scratch sheet');
    navItem('Study Dashboard', 'gauge', 'dashboard', 'Study Dashboard', 'Progress, pace, the campaign, what to work on next');
    navItem('Quizzes', 'list-checks', 'quizzes', 'Quizzes', 'Every quiz, open and completed: resume, rename, copy, reopen, delete');
    navItem('Settings', 'settings', 'settings', 'Worksheets Settings', 'The campaign and the sheet appearance');
    root.appendChild(nav);
    if (items.length === 0) return;
    renderBankSnapshot(root, items);
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());
  return { dispose: () => { disposed = true; sub.dispose(); root.remove(); } };
}

// ── Home (instanceId 'home'): the launcher ──────────────────────────────────

function createLauncherPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-launch');
  container.appendChild(root);
  let disposed = false;

  // Only the newest render may touch the DOM (a reward unlock announces a
  // data change mid-render and starts another).
  let renderSeq = 0;
  const render = async () => {
    if (disposed) return;
    const seq = ++renderSeq;
    const [items, campaign, attempts] = await Promise.all([
      listItems().catch(() => []),
      getCampaign().catch(() => null),
      listAttemptHistory().catch(() => []),
    ]);
    const rewards = await syncRewards(items, attempts, campaign).catch(() => null);
    const open = await getOpenQuizSession().catch(() => null);
    const quizzes = await listQuizSessions().catch(() => []);
    if (disposed || seq !== renderSeq) return;
    const problems = items.filter((it) => it.paper);
    const rated = problems.filter((it) => normalizeRating(it.attemptState)).length;
    // Noted: what he told himself to review, newest note first.
    const noted = items.filter((it) => it.note).sort((a, b) => b.noteAt - a.noteAt);
    const ins = computeInsights(items, attempts);
    const due = ins.due.filter((d) => isCampaignProblem(d.item)).map((d) => d.item.id);
    const resume = open ? { name: open.name, position: Math.min(open.position, open.itemIds.length - 1), total: open.itemIds.length } : null;
    const plan = await planDay(items, attempts, campaign, due, resume, rewards?.bonusXp ?? 0, {
      startQuiz: (ids, startAt, name) => startQuizWith(ids, startAt, name),
      resumeQuiz: () => { if (open) void openPastQuiz(open.id); },
      studyFlashcards: () => studyFlashcards(),
      openSettings: () => void openWorksheet('settings', 'Worksheets Settings'),
    });
    if (disposed || seq !== renderSeq) return;
    root.replaceChildren();
    // Home is where you continue and where you go (Mufaro, 2026-09-21: nine
    // tiles was a wall). The three places you go every day are cards with a
    // live line; the ways to add problems sit in the header's Add menu.
    const col = el('div', 'ws-home__col');
    root.appendChild(col);
    const header = createPageHeader(col, {
      title: 'Worksheets',
      subtitle: problems.length ? `${problems.length} problems · ${rated} rated${noted.length ? ` · ${noted.length} noted` : ''}` : 'The bank is empty. Import a workbook to begin.',
      secondary: [{ label: 'Add Problems', icon: 'plus', onClick: () => {} }],
      primary: problems.length ? { label: 'New Quiz', onClick: () => openBuilder() } : { label: 'Import Workbook…', onClick: () => void openWorksheet('excel-import', 'Import Workbook') },
      more: [
        ...(noted.length ? [{ label: `Discuss Notes in Chat (${noted.length})`, icon: 'message-square', onSelect: () => void discussNotesInChat(items) }] : []),
        { label: 'Worksheets Settings', icon: 'settings', onSelect: () => void openWorksheet('settings', 'Worksheets Settings') },
      ],
    });
    // Add Problems opens its menu under itself.
    const add = header.querySelector<HTMLButtonElement>('.px-page-header__actions .px-btn--secondary');
    if (add) {
      add.appendChild(createIconElement('chevron-down', 12));
      add.setAttribute('aria-haspopup', 'menu');
      add.addEventListener('click', () => showMenu(add, [
        { label: 'Import Workbook…', icon: 'folder-input', onSelect: () => void openWorksheet('excel-import', 'Import Workbook') },
        { label: 'Generate Items…', icon: 'sparkles', onSelect: () => void openWorksheet('create', 'Generate Items') },
        { separator: true },
        { label: 'Open Scratch Sheet', icon: 'table-2', onSelect: () => void openWorksheet('scratch', 'Scratch Sheet') },
      ]));
    }

    const dest = el('div', 'ws-home__dest');
    const card = (label: string, line: string, icon: string, go: () => void) => {
      const b = el('button', 'ws-home__destcard') as HTMLButtonElement;
      b.type = 'button';
      const ic = el('span', 'ws-home__desticon');
      ic.appendChild(createIconElement(icon, 20));
      const text = el('span', 'ws-home__desttext');
      text.append(el('span', 'ws-home__desttitle', label), el('span', 'ws-home__destline', line));
      b.append(ic, text);
      b.addEventListener('click', go);
      dest.appendChild(b);
    };
    const openCount = quizzes.filter((q) => !q.finishedAt).length;
    card('Study Dashboard', ins.rated > 0 ? `${Math.round(ins.attempted * 100)}% attempted · ${Math.round(ins.score * 100)}% score` : 'Progress, pace, what to work on next', 'gauge', () => void openWorksheet('dashboard', 'Study Dashboard'));
    card('Problem Bank', problems.length ? `${problems.length} problems in ${new Set(problems.map((it) => it.paper)).size} papers` : 'Empty until you import a workbook', 'library', () => void openWorksheet('bank', 'Problem Bank'));
    card('Quizzes', quizzes.length ? `${openCount} open · ${quizzes.length - openCount} completed` : 'None yet', 'list-checks', () => void openWorksheet('quizzes', 'Quizzes'));
    col.appendChild(dest);

    // Today: the campaign's line, its days, and the day's one action.
    const today = el('div', 'ws-home__today');
    const text = el('div', 'ws-home__todaytext');
    text.appendChild(el('div', 'ws-home__todaytitle', plan.title));
    text.appendChild(el('div', 'ws-home__todayline', plan.line));
    if (plan.progress) text.appendChild(dayStrip(plan.progress));
    today.appendChild(text);
    const acts = el('div', 'ws-home__todayacts');
    const first = plan.actions.secondary.find((a) => !a.label.startsWith('Review Due Flashcards'));
    if (first) createButton(acts, { label: first.label, title: first.title, onClick: () => first.onClick() });
    if (plan.actions.primary) {
      const a = plan.actions.primary;
      createButton(acts, { label: a.label, icon: a.icon, title: a.title, kind: 'primary', onClick: () => a.onClick() });
    }
    if (acts.childElementCount) today.appendChild(acts);
    col.appendChild(today);

    // What you touched last, and what you told yourself to review: two short
    // lists, each row opens the problem.
    const lists = el('div', 'ws-launch__lists');
    const listOf = (title: string, rows: WorksheetItemSummary[], meta: (it: WorksheetItemSummary) => string) => {
      if (rows.length === 0) return;
      const box = el('div', 'ws-launch__list');
      createSectionLabel(box, title);
      const list = el('div', 'ws-list');
      for (const it of rows) {
        const row = el('button', 'ws-list__row') as HTMLButtonElement;
        row.type = 'button';
        row.appendChild(el('span', `ws-bank__dot ${stateClass(it.attemptState) || 'rest'}`));
        const t = el('span', 'ws-list__text');
        t.appendChild(el('span', 'ws-list__title', it.title));
        t.appendChild(el('span', 'ws-list__meta', meta(it)));
        row.appendChild(t);
        row.title = `Open ${it.title}`;
        row.addEventListener('click', () => void openWorksheet(`item:${it.id}`, it.title));
        list.appendChild(row);
      }
      box.appendChild(list);
      lists.appendChild(box);
    };
    const recent = items.filter((it) => it.lastAttemptAt > 0).sort((a, b) => b.lastAttemptAt - a.lastAttemptAt).slice(0, 5);
    listOf('Recent', recent, (it) => [it.paper ? paperLabel(it.paper) : it.sourceLabel, it.attemptState === 'open' ? 'In progress' : gradeLabel(it.attemptState), whenCap(it.lastAttemptAt)].filter(Boolean).join(' · '));
    listOf('Noted', noted.slice(0, 5), (it) => it.note);
    col.appendChild(lists);
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());
  return { dispose: () => { disposed = true; sub.dispose(); root.remove(); } };
}

// ── Settings (instanceId 'settings') ────────────────────────────────────────

function fmtShortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function createSettingsPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-settings');
  container.appendChild(root);
  let disposed = false;
  const disposables: { dispose(): void }[] = [];

  const render = async () => {
    if (disposed) return;
    const [items, campaign, attempts] = await Promise.all([
      listItems().catch(() => []),
      getCampaign().catch(() => null),
      listAttemptHistory().catch(() => []),
    ]);
    if (disposed) return;
    for (const d of disposables.splice(0)) d.dispose();
    root.replaceChildren();
    createPageHeader(root, { back: BACK_TO_HOME, title: 'Worksheets Settings' });
    const body = el('div', 'ws-settings__body');
    root.appendChild(body);

    // The app's settings layout: what a setting does on the left, the control on the right.
    const card = (label: string) => {
      createSectionLabel(body, label);
      const c = el('div', 'ws-setcard');
      body.appendChild(c);
      return c;
    };
    const row = (host: HTMLElement, title: string, desc: string, control?: HTMLElement, labelFor?: string) => {
      const r = el('div', 'ws-setrow');
      const text = el('div', 'ws-setrow__text');
      const t = el(labelFor ? 'label' : 'div', 'ws-setrow__title', title);
      if (labelFor) (t as HTMLLabelElement).htmlFor = labelFor;
      text.appendChild(t);
      if (desc) text.appendChild(el('div', 'ws-setrow__desc', desc));
      r.appendChild(text);
      if (control) { control.classList.add('ws-setrow__control'); r.appendChild(control); }
      host.appendChild(r);
      return r;
    };
    const switchOf = (ariaLabel: string, items: { value: string; label: string }[], value: string, onChange: (v: string) => void) => {
      const seg = createSegmented(null, { ariaLabel, items, value, onChange });
      disposables.push(seg);
      return seg.element;
    };

    // The campaign: every problem in the bank in N days.
    const camp = card('Campaign');
    // Essay sheets stay out: they are flashcards now.
    const problems = items.filter(isCampaignProblem);
    if (!campaign) {
      // Length as days or as a last day (either edits the other), and the
      // weekdays that carry no quota.
      const today = dayKey(Date.now());
      const rest = new Set<number>();
      const perDay = el('span');
      const daysIn = el('input', 'ws-input ws-input--count') as HTMLInputElement;
      daysIn.type = 'number'; daysIn.min = '1'; daysIn.max = '365'; daysIn.value = '18';
      daysIn.id = 'ws-camp-days';
      const endIn = el('input', 'ws-input ws-input--date') as HTMLInputElement;
      endIn.type = 'date'; endIn.min = today;
      endIn.id = 'ws-camp-end';
      const readDays = () => Math.max(1, Math.min(365, parseInt(daysIn.value, 10) || 18));
      const sync = () => {
        const d = readDays();
        const endDay = addDays(today, d - 1);
        endIn.value = endDay;
        const plan = planCampaign(problems.length, d, Date.now(), [...rest]);
        const working = workingDays(today, d, plan.restDays);
        const off = restDaysLabel(plan.restDays);
        perDay.textContent = working === 0
          ? 'Every day in that span is a rest day.'
          : `${plan.dailyTarget} a day over ${working} working ${working === 1 ? 'day' : 'days'}, ending ${fmtShortDay(endDay)}${off ? `, ${off}` : ''}.`;
      };
      daysIn.addEventListener('input', sync);
      endIn.addEventListener('change', () => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(endIn.value)) daysIn.value = String(Math.max(1, Math.min(365, spanDays(today, endIn.value))));
        sync();
      });
      const start = createButton(null, {
        label: 'Start Campaign', kind: 'primary', disabled: problems.length === 0,
        title: problems.length === 0 ? 'Import a workbook first.' : `${problems.length} problems, every one but the essay sheets, from today.`,
        onClick: () => { void startCampaign(planCampaign(problems.length, readDays(), Date.now(), [...rest])); },
      });
      row(camp, 'No campaign running', 'Every problem in the bank in a set number of days, drawn across all papers. Each day gets its own draw, every rating earns XP, a full day keeps the streak.', start);
      row(camp, 'Days', '', daysIn, daysIn.id);
      row(camp, 'Last day', '', endIn, endIn.id);
      const weekdays = el('div', 'ws-chips');
      weekdays.setAttribute('role', 'group');
      weekdays.setAttribute('aria-label', 'Rest days');
      for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
        createFilterChip(weekdays, {
          label: WEEKDAY_LABELS[wd].slice(0, 3),
          title: `${WEEKDAY_LABELS[wd]}s carry no quota; the streak and the pace step over them`,
          onToggle: (on) => { if (on && rest.size < 6) rest.add(wd); else rest.delete(wd); sync(); },
        });
      }
      const restRow = row(camp, 'Rest days', '', weekdays);
      restRow.querySelector('.ws-setrow__text')!.appendChild(el('div', 'ws-setrow__desc')).appendChild(perDay);
      sync();
    } else {
      const p = campaignProgress(campaign, items, attempts);
      const off = restDaysLabel(campaign.restDays);
      const end = createButton(null, {
        label: 'End Campaign…', kind: 'danger',
        title: 'Stops the campaign. Ratings and attempts stay; the streak, XP and draws are dropped.',
        onClick: () => {
          void (async () => {
            const ok = await _api?.window?.showConfirmModal?.({
              message: 'End the campaign?',
              detail: 'Ratings, attempts and study time stay on the problems. The streak, the XP and the daily draws are dropped. This cannot be undone.',
              confirmLabel: 'End Campaign',
              danger: true,
            }) ?? false;
            if (ok && !disposed) await endCampaign();
          })();
        },
      });
      row(camp, `Day ${p.dayIndex} of ${campaign.days}`, `${p.done} of ${p.total} done · ${p.target} a day${off ? ` · ${off}` : ''} · ends ${fmtShortDay(addDays(campaign.startDay, campaign.days - 1))}`, end);
    }

    // The exam: the Dashboard counts the days to it.
    const examWrap = el('div', 'ws-setrow__inline');
    const examIn = el('input', 'ws-input ws-input--date') as HTMLInputElement;
    examIn.type = 'date';
    examIn.id = 'ws-exam-date';
    examIn.value = getExamDate();
    examIn.addEventListener('change', () => { void setExamDate(examIn.value).then(() => render()); });
    examWrap.appendChild(examIn);
    if (getExamDate()) createButton(examWrap, { label: 'Clear', kind: 'ghost', size: 'sm', onClick: () => { void setExamDate('').then(() => render()); } });
    row(camp, 'Exam date', 'The Dashboard counts down to it.', examWrap, examIn.id);

    // XP as cash: what the campaign's points are worth, paid to yourself.
    const cashWrap = el('div', 'ws-setrow__inline');
    cashWrap.appendChild(el('span', 'ws-hint', '$'));
    const cashIn = el('input', 'ws-input ws-input--count') as HTMLInputElement;
    cashIn.type = 'number';
    cashIn.id = 'ws-xp-cash';
    cashIn.min = '0';
    cashIn.step = '0.25';
    cashIn.value = String(getXpCashRate() || 0);
    cashIn.addEventListener('change', () => { const v = Math.max(0, Number(cashIn.value) || 0); void setXpCashRate(v).then(() => render()); });
    cashWrap.appendChild(cashIn);
    row(camp, 'XP to cash', 'Dollars per 100 XP. The Dashboard then shows what your XP and each reward are worth, and Cash Out records what you paid yourself. 0 turns it off.', cashWrap, cashIn.id);

    // The sheet's look, independent of the app theme.
    const sheet = card('Practice sheet');
    row(sheet, 'Sheet appearance', 'Light matches the exam tool. Follow app uses the workbench theme.',
      switchOf('Sheet appearance', [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'app', label: 'Follow app' }], getSheetAppearance(), (v) => { void setSheetAppearance(v as SheetAppearance); }));
    row(sheet, 'Decimals shown', 'A cell without a number format shows at most this many. The value and the cell editor keep full precision, and a format set on a cell always wins.',
      switchOf('Decimals shown', DISPLAY_DECIMALS_CHOICES.map((v) => ({ value: v, label: v === 'full' ? 'Full' : v })), getDisplayDecimalsSetting(), (v) => { void setDisplayDecimalsSetting(v); }));

    // The study clock: when a stretch without input stops being study.
    const clock = card('Study clock');
    row(clock, 'Stop counting after', 'Time counts while a problem or quiz is on screen and you are active. After this long with no input, the stretch is taken back, so a break with the tab up counts for nothing.',
      switchOf('Stop counting after', IDLE_MINUTES_CHOICES.map((v) => ({ value: String(v), label: `${v} min` })), String(getIdleMinutes()), (v) => { void setIdleMinutes(Number(v)); }));
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());
  return { dispose: () => { disposed = true; sub.dispose(); for (const d of disposables) d.dispose(); root.remove(); } };
}

// ── Generate pane (instanceId 'create') ─────────────────────────────────────

function createGeneratePane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create');
  container.appendChild(root);
  let disposed = false;

  createPageHeader(root, {
    back: BACK_TO_HOME,
    title: 'Generate Items',
    subtitle: 'Practice items with givens and a worked model answer, from a PDF or pasted material. Kept apart from the workbook.',
  });

  const source = { text: '', label: '', uri: '', pageTexts: null as string[] | null };
  const status = el('div', 'ws-hint ws-create__status', 'No source loaded yet.');

  const drop = el('div', 'ws-drop ws-dropzone');
  const dropIcon = createIconElement('upload', 28);
  dropIcon.classList.add('ws-drop__icon');
  drop.append(dropIcon, el('div', 'ws-drop__head', 'Drop a PDF or document here'), el('div', 'ws-hint', 'From the Explorer or your files, or a page from the Canvas sidebar.'));
  const onDragOver = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) {
      // The Explorer's dragstart sets effectAllowed='move'; answering with
      // dropEffect 'copy' makes Chromium refuse the drop outright (the drop
      // event never fires — the "dragging from the workspace does nothing"
      // bug). Answer with a compatible effect instead.
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    }
    drop.classList.add('ws-dropzone--over');
  };
  drop.addEventListener('dragenter', onDragOver);
  drop.addEventListener('dragover', onDragOver);
  drop.addEventListener('dragleave', (e) => { if (e.target === drop) drop.classList.remove('ws-dropzone--over'); });
  const extractFromPath = async (path: string, label: string): Promise<void> => {
    const electron = (window as {
      parallxElectron?: {
        document?: { extractText(p: string): Promise<{ error?: { message: string } | null; text?: string; pageTexts?: string[] }> };
      };
    }).parallxElectron;
    if (!electron?.document?.extractText) {
      status.textContent = 'Document extraction is unavailable in this build.';
      return;
    }
    status.textContent = `Extracting ${label}…`;
    try {
      const res = await electron.document.extractText(path);
      if (res?.error) throw new Error(res.error.message);
      const text = (res?.text ?? '').trim();
      if (text.length < 200) throw new Error('Almost no text extracted. Scanned PDFs need OCR.');
      source.text = text;
      source.label = label;
      source.uri = path;
      source.pageTexts = Array.isArray(res?.pageTexts) && res.pageTexts.length > 1 ? res.pageTexts : null;
      const pages = source.pageTexts ? ` · ${source.pageTexts.length} pages` : '';
      status.textContent = `Loaded ${label} (${text.length.toLocaleString()} chars${pages}).`;
    } catch (err) {
      status.textContent = `Extraction failed: ${(err as Error).message}`;
    }
  };

  // file:// URI or bare path → fs path (mirrors the flashcards drop logic).
  const uriToFsPath = (raw: string): string => {
    let p = raw;
    if (/^file:\/\//i.test(p)) {
      p = p.replace(/^file:\/\//i, '');
      try { p = decodeURIComponent(p); } catch { /* leave encoded */ }
      if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    }
    return p;
  };
  const looksLikePath = (raw: string): boolean =>
    /^file:\/\//i.test(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\');

  drop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    drop.classList.remove('ws-dropzone--over');
    const dt = e.dataTransfer;
    void (async () => {
      // 1. An OS file drop carries File objects.
      const file = dt?.files?.[0];
      if (file) {
        const electron = (window as { parallxElectron?: { getPathForFile?(f: File): string } }).parallxElectron;
        const path = electron?.getPathForFile?.(file) ?? '';
        if (!path) { status.textContent = 'Could not resolve that file to a path in this build.'; return; }
        await extractFromPath(path, file.name);
        return;
      }
      // 2. Explorer/internal drags carry text/plain: a path, file:// URI, or
      //    a canvas page id — NOT File objects (the original silent gap).
      const raw = (dt?.getData('text/plain') || '').trim();
      if (!raw) {
        status.textContent = 'That drag carried no file. Drag from the Explorer or drop an OS file.';
        return;
      }
      if (looksLikePath(raw)) {
        const path = uriToFsPath(raw);
        await extractFromPath(path, path.split(/[\\/]/).pop() || 'document');
        return;
      }
      if (/^[0-9a-fA-F][0-9a-fA-F-]{7,}$/.test(raw)) {
        // Canvas page drag: fetch its markdown through the canvas command.
        try {
          status.textContent = 'Reading canvas page…';
          const result = await (_api as unknown as {
            commands: { executeCommand<T>(id: string, ...args: unknown[]): Promise<T> };
          }).commands.executeCommand<{ markdown?: string; title?: string }>('canvas.getPageMarkdown', raw);
          const text = (result?.markdown ?? '').trim();
          if (text.length < 100) throw new Error('That canvas page has almost no text.');
          source.text = text;
          source.label = result?.title || 'Canvas page';
          source.uri = `parallx://canvas/page/${raw}`;
          source.pageTexts = null;
          status.textContent = `Loaded ${source.label} (${text.length.toLocaleString()} chars).`;
        } catch (err) {
          status.textContent = `Could not read that canvas page: ${(err as Error).message}`;
        }
        return;
      }
      status.textContent = 'Drop a document file from the Explorer, or a page from the Canvas sidebar.';
    })();
  });
  root.appendChild(drop);
  root.appendChild(status);

  const pasteIn = el('textarea', 'ws-textarea') as HTMLTextAreaElement;
  pasteIn.placeholder = 'Or paste study material here (overrides the loaded file).';
  pasteIn.rows = 5;
  root.appendChild(pasteIn);

  const controls = el('div', 'ws-create__controls');
  const guideIn = el('input', 'ws-input') as HTMLInputElement;
  guideIn.placeholder = 'Guidance, e.g. focus on Brosius least squares';
  controls.appendChild(guideIn);
  const countIn = el('input', 'ws-input ws-input--count') as HTMLInputElement;
  countIn.type = 'number';
  countIn.min = '1'; countIn.max = '6'; countIn.value = '3';
  countIn.title = 'How many items to generate';
  controls.appendChild(countIn);
  countIn.setAttribute('aria-label', 'How many items to generate');
  guideIn.setAttribute('aria-label', 'Guidance');
  const genBtn = createButton(controls, { label: 'Generate Items', icon: 'sparkles', kind: 'primary' });
  const genLabel = genBtn.querySelector('.px-btn__label') as HTMLElement;
  root.appendChild(controls);

  const err = el('div', 'ws-error');
  err.style.display = 'none';
  root.appendChild(err);
  const reviewHost = el('div', 'ws-create__review');
  root.appendChild(reviewHost);

  genBtn.addEventListener('click', () => {
    void (async () => {
      const text = (pasteIn.value.trim() || source.text).trim();
      if (!text) {
        err.textContent = 'Load a source or paste some material first.';
        err.style.display = '';
        return;
      }
      if (!_api?.lm) {
        err.textContent = 'No language model API available in this build.';
        err.style.display = '';
        return;
      }
      err.style.display = 'none';
      genBtn.disabled = true;
      genLabel.textContent = 'Generating…';
      try {
        const usingLoaded = !pasteIn.value.trim() && !!source.text;
        const items = await generateItems(_api.lm, text, {
          count: Math.min(6, Math.max(1, parseInt(countIn.value, 10) || 3)),
          focus: guideIn.value.trim(),
          pageTexts: usingLoaded ? source.pageTexts : null,
        });
        if (disposed) return;
        renderReview(items);
      } catch (e2) {
        err.textContent = (e2 as Error).message;
        err.style.display = '';
      } finally {
        genBtn.disabled = false;
        genLabel.textContent = 'Generate Items';
      }
    })();
  });

  const renderReview = (items: GeneratedItem[]) => {
    reviewHost.replaceChildren();
    createSectionLabel(reviewHost, `Review ${items.length} generated ${items.length === 1 ? 'item' : 'items'}`);
    reviewHost.appendChild(el('div', 'ws-hint', 'Edit titles and questions inline; drop anything weak. Nothing is saved until you click Save.'));

    const rows: { item: GeneratedItem; titleIn: HTMLInputElement; partIns: HTMLTextAreaElement[]; dropped: boolean; row: HTMLElement }[] = [];
    for (const item of items) {
      const row = el('div', 'ws-genitem');
      const titleIn = el('input', 'ws-input') as HTMLInputElement;
      titleIn.value = item.title;
      row.appendChild(titleIn);
      // One editable question per part — each part becomes a sheet tab.
      const partIns: HTMLTextAreaElement[] = [];
      for (const part of item.parts) {
        if (part.name) row.appendChild(el('div', 'ws-genitem__partlabel', `Part (${part.name})`));
        const questionIn = el('textarea', 'ws-textarea') as HTMLTextAreaElement;
        questionIn.rows = 2;
        questionIn.value = part.question;
        row.appendChild(questionIn);
        partIns.push(questionIn);
      }
      const givens = item.parts.reduce((n, p) => n + p.givens.length, 0);
      const solution = item.parts.reduce((n, p) => n + p.solution.length, 0);
      const meta: string[] = [
        `${item.parts.length} ${item.parts.length === 1 ? 'part' : 'parts'}`,
        `${givens} given ${givens === 1 ? 'cell' : 'cells'}`,
        `${solution} solution ${solution === 1 ? 'cell' : 'cells'}`,
      ];
      if (item.page) meta.push(`p.${item.page}`);
      if (item.tags.length) meta.push(item.tags.map((t) => `#${t}`).join(' '));
      row.appendChild(el('div', 'ws-list__meta', meta.join(' · ')));
      const entry = { item, titleIn, partIns, dropped: false, row };
      const dropBtn = createButton(null, { label: 'Drop', kind: 'ghost', size: 'sm' });
      const dropLabel = dropBtn.querySelector('.px-btn__label') as HTMLElement;
      dropBtn.addEventListener('click', () => {
        entry.dropped = !entry.dropped;
        row.classList.toggle('ws-genitem--dropped', entry.dropped);
        dropLabel.textContent = entry.dropped ? 'Keep' : 'Drop';
      });
      row.appendChild(dropBtn);
      rows.push(entry);
      reviewHost.appendChild(row);
    }

    const saveBtn = createButton(null, { label: `Save ${items.length} ${items.length === 1 ? 'Item' : 'Items'}`, kind: 'primary' });
    saveBtn.addEventListener('click', () => {
      void (async () => {
        const keep = rows.filter((r) => !r.dropped && r.titleIn.value.trim());
        if (keep.length === 0) {
          err.textContent = 'No items left to save.';
          err.style.display = '';
          return;
        }
        saveBtn.disabled = true;
        try {
          for (const r of keep) {
            // Edited part questions flow into the workbook build (on-sheet
            // text) AND the item-level question_md (browse/chat context).
            const parts = r.item.parts.map((p, i) => ({ ...p, question: r.partIns[i]?.value.trim() || p.question }));
            const edited = { ...r.item, parts };
            const { givensJson, solutionJson } = itemToWorkbooks(edited);
            await createItem({
              title: r.titleIn.value.trim(),
              questionMd: parts.map((p) => (p.name ? `(${p.name}) ${p.question}` : p.question)).join('\n\n'),
              givensJson,
              solutionJson,
              solutionNotesMd: r.item.solutionNotes,
              sourceUri: source.uri,
              sourceLabel: source.label || 'Pasted material',
              sourcePage: r.item.page ?? 0,
              tags: r.item.tags.join(','),
            });
          }
          _api?.activity?.note('generated', `${keep.length} worksheet practice ${keep.length === 1 ? 'item' : 'items'}`, source.label || 'pasted material');
          await _api?.window?.showInformationMessage?.(`Saved ${keep.length} ${keep.length === 1 ? 'item' : 'items'}.`);
          await openWorksheet('home', 'Worksheets');
        } catch (e3) {
          err.textContent = (e3 as Error).message;
          err.style.display = '';
          saveBtn.disabled = false;
        }
      })();
    });
    reviewHost.appendChild(saveBtn);
    saveBtn.scrollIntoView({ block: 'nearest' });
  };

  return {
    dispose: () => {
      disposed = true;
      root.remove();
    },
  };
}

// ── Practice sessions (instanceIds 'practice' + 'practice-run') ─────────────
//
// The daily driver: filter the bank (tags ANY-match, attempt-state focus),
// pick a count, shuffle, then work the items one after another with the
// full item player (attempts, reveal, self-grade, AI review — all reused).
// The running session lives module-level so pane rebuilds cannot eat it.

interface RunningPractice {
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
let _practice: RunningPractice | null = null;
/** Told when a problem is marked or unmarked, wherever the flag was clicked. */
const _markListeners = new Set<() => void>();
/** Open Quiz tabs, told when a different quiz begins so they show it. */
const _practiceListeners = new Set<() => void>();

function newQuizId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
/** The running quiz as stored: a restart or a tool reload resumes it. */
async function persistPractice(announce = false): Promise<void> {
  const s = _practice;
  if (!s) return;
  await saveQuizSession({ id: s.id, name: s.name, itemIds: s.ids, position: s.index, skipped: [...s.skipped], marked: [...s.marked], startedAt: s.startedAt, finishedAt: s.finishedAt }, announce)
    .catch((err) => console.warn('[Worksheet] quiz session save failed:', err));
}
/** "today", "yesterday", "N days ago": how Home and the quiz screens date things. */
function when(ms: number): string {
  // Calendar days, not 24-hour spans: 11 pm last night is "yesterday" at
  // 8 am, which the elapsed-time count called "today".
  const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((midnight(Date.now()) - midnight(ms)) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
/** `when` at the start of a fragment: "Today", "Yesterday", "3 days ago". */
function whenCap(ms: number): string {
  const w = when(ms);
  return w.charAt(0).toUpperCase() + w.slice(1);
}
/** A quiz named after the moment it began, when nothing better was given. */
function defaultQuizName(count: number): string {
  const at = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${count} ${count === 1 ? 'Problem' : 'Problems'} · ${at}`;
}
/** A new, named quiz over these problems, starting at `startAt`. Open quizzes
 *  stay open: a quiz is a saved thing, and only Complete Quiz on its summary
 *  finishes it (Mufaro, 2026-09-17). */
async function beginPractice(ids: number[], startAt = 0, name = ''): Promise<void> {
  _practice = { id: newQuizId(), name: name.trim() || defaultQuizName(ids.length), ids: [...ids], index: Math.max(0, Math.min(startAt, ids.length - 1)), startedAt: Date.now(), skipped: new Set(), marked: new Set(), finishedAt: null };
  await persistPractice(true);
  for (const fn of _practiceListeners) { try { fn(); } catch { /* pane torn down */ } }
}
/** The quiz in memory, else the stored open one (app restart, tool reload). */
async function restorePractice(): Promise<RunningPractice | null> {
  if (_practice) return _practice;
  const row = await getOpenQuizSession().catch(() => null);
  if (!row || row.itemIds.length === 0) return null;
  _practice = { id: row.id, name: row.name, ids: row.itemIds, index: Math.max(0, Math.min(row.position, row.itemIds.length)), startedAt: row.startedAt, skipped: new Set(row.skipped), marked: new Set(row.marked), finishedAt: null };
  return _practice;
}
/** A past quiz reopened: the same player over the same problems, with the
 *  work and ratings as they are now. Finished ones review; an open one resumes. */
async function openPastQuiz(id: string): Promise<void> {
  const row = await getQuizSession(id).catch(() => null);
  if (!row || row.itemIds.length === 0) return;
  _practice = {
    id: row.id, name: row.name, ids: row.itemIds, startedAt: row.startedAt, skipped: new Set(row.skipped), marked: new Set(row.marked), finishedAt: row.finishedAt,
    index: row.finishedAt ? 0 : Math.max(0, Math.min(row.position, row.itemIds.length)),
  };
  for (const fn of _practiceListeners) { try { fn(); } catch { /* pane torn down */ } }
  await openWorksheet('practice-run', _practice?.name || 'Quiz');
}
/** The quiz an attempt rated now belongs to, when its problem is in the running quiz. */
function quizSessionIdFor(itemId: number): string | undefined {
  return _practice && _practice.ids.includes(itemId) ? _practice.id : undefined;
}
/** Filters chosen elsewhere (the dashboard's Quiz buttons), taken by the next quiz builder. */
let _quizPreset: { papers?: string[]; state?: string; starred?: 'starred' | 'unstarred'; ids?: number[]; name?: string } | null = null;

/** A new quiz over exactly these problems, in this order, under `name`. */
function startQuizWith(ids: number[], startAt = 0, name = ''): void {
  if (ids.length === 0) return;
  void (async () => {
    await beginPractice(ids, startAt, name);
    if (_api?.activity) _api.activity.note('started', `the quiz "${_practice?.name ?? name}" (${ids.length} ${ids.length === 1 ? 'problem' : 'problems'})`);
    await openWorksheet('practice-run', _practice?.name || 'Quiz');
  })();
}

// ── Quizzes ───────────────────────────────────────────────────────────────
// Every quiz, open ones first, with its lifecycle beside it (Mufaro,
// 2026-09-17: "where do I see all my quizzes and do these operations?").
// Complete Quiz stays on a quiz's summary, where the ratings are in view;
// here a quiz is opened, renamed, copied, reopened or deleted.
function createQuizzesPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-home');
  container.appendChild(root);
  let disposed = false;
  let renderSeq = 0;
  createPageHeader(root, {
    back: BACK_TO_HOME,
    title: 'Quizzes',
    subtitle: 'A quiz stays open until you complete it from its summary.',
    primary: { label: 'New Quiz', icon: 'plus', title: 'The quiz builder: papers, sources, kinds, a rating band, a length, a name.', onClick: () => openBuilder() },
  });
  const listHost = el('div', 'ws-quizzes');
  root.appendChild(listHost);

  const render = async () => {
    const seq = ++renderSeq;
    const [sessions, bank] = await Promise.all([listQuizSessions(500).catch(() => []), listItems().catch(() => [])]);
    if (disposed || seq !== renderSeq) return;
    listHost.replaceChildren();
    if (sessions.length === 0) {
      createEmptyState(listHost, {
        icon: 'list-checks',
        headline: 'No quizzes yet.',
        // New Quiz is the header's primary action; a second one here made
        // two primaries for the same thing (one per view).
        hint: 'New Quiz builds one from the problems you choose. Starred and due problems can also start one from Home.',
      });
      return;
    }
    const bankById = new Map(bank.map((i) => [i.id, i]));
    const groups: { label: string; host: HTMLElement }[] = [];
    const groupFor = (label: string) => {
      let g = groups.find((x) => x.label === label);
      if (!g) {
        createSectionLabel(listHost, label);
        g = { label, host: el('div', 'ws-list') };
        listHost.appendChild(g.host);
        groups.push(g);
      }
      return g.host;
    };
    for (const q of sessions) {
      const grades = await getSessionGrades(q.itemIds, q.startedAt, q.id, q.finishedAt ?? null).catch(() => new Map<number, string>());
      if (disposed || seq !== renderSeq) return;
      const counts = { easy: 0, medium: 0, hard: 0 };
      let unrated = 0;
      for (const id of q.itemIds) {
        const r = normalizeRating(grades.get(id) ?? bankById.get(id)?.attemptState ?? '');
        if (r === 'easy' || r === 'medium' || r === 'hard') counts[r]++; else unrated++;
      }
      const started = new Date(q.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const n = q.itemIds.length;
      const row = el('div', 'ws-list__row ws-quizrow');
      row.appendChild(el('span', `ws-bank__dot ${q.finishedAt ? 'rest' : 'open'}`));
      const info = el('button', 'ws-list__text ws-quizrow__info') as HTMLButtonElement;
      info.type = 'button';
      const nameEl = el('span', 'ws-list__title', q.name || started);
      info.appendChild(nameEl);
      // The date only when the name does not already say it (an auto-named quiz is its date).
      const showStarted = !(q.name || '').includes(started);
      const tally = [`${n} ${n === 1 ? 'problem' : 'problems'}`, `${counts.easy} easy`, counts.medium ? `${counts.medium} medium` : '', `${counts.hard} hard`, unrated ? `${unrated} not rated` : ''].filter(Boolean);
      const dated = q.finishedAt ? `completed ${when(q.finishedAt)}` : showStarted ? `started ${started}` : '';
      info.appendChild(el('span', 'ws-list__meta', [...tally, dated].filter(Boolean).join(' · ')));
      info.title = q.finishedAt ? 'Open this completed quiz to review it.' : 'Resume this quiz where it stands.';
      info.addEventListener('click', () => void openPastQuiz(q.id));
      row.appendChild(info);
      const end = el('div', 'ws-list__end');
      if (!q.finishedAt) {
        const at = Math.min(q.position, n);
        const prog = el('div', 'ws-quizrow__progress');
        const bar = el('div', 'ws-bar');
        const fill = el('span', 'ws-bar__fill');
        fill.style.width = `${Math.round((at / Math.max(1, n)) * 100)}%`;
        bar.appendChild(fill);
        prog.append(bar, el('span', 'ws-list__meta', q.position >= n ? 'At the summary' : `${q.position + 1} of ${n}`));
        end.appendChild(prog);
      }
      createButton(end, {
        label: q.finishedAt ? 'Review' : 'Resume',
        icon: q.finishedAt ? undefined : 'play',
        kind: q.finishedAt ? 'secondary' : 'primary',
        size: 'sm',
        title: q.finishedAt ? 'Open this completed quiz to review the work and the ratings.' : 'Continue this quiz where it stands.',
        onClick: () => void openPastQuiz(q.id),
      });
      const rename = () => {
        const input = el('input', 'ws-input') as HTMLInputElement;
        input.type = 'text';
        input.maxLength = 80;
        input.value = q.name;
        input.placeholder = 'Quiz name';
        input.setAttribute('aria-label', 'Quiz name');
        let done = false;
        const commit = () => {
          if (done) return;
          done = true;
          const v = input.value.trim();
          if (v && v !== q.name) void renameQuizSession(q.id, v).catch(() => {});
          else input.replaceWith(nameEl);
        };
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') { input.value = q.name; input.blur(); }
        });
        input.addEventListener('blur', commit);
        nameEl.replaceWith(input);
        input.focus();
        input.select();
      };
      const remove = async () => {
        const ok = await _api?.window?.showConfirmModal?.({
          message: `Delete the quiz "${q.name || started}"?`,
          detail: 'The quiz and its position are removed. Ratings and work on the problems are kept. This cannot be undone.',
          confirmLabel: 'Delete Quiz',
          danger: true,
        }) ?? false;
        if (!ok || disposed) return;
        await deleteQuizSession(q.id).catch(() => {});
        if (_practice?.id === q.id) {
          _practice = null;
          for (const fn of _practiceListeners) { try { fn(); } catch { /* pane torn down */ } }
        }
      };
      const more = createIconButton(end, { icon: 'ellipsis', title: `More actions for ${q.name || started}`, size: 'sm' });
      more.addEventListener('click', () => showMenu(more, [
        { label: 'Rename…', icon: 'pencil', onSelect: rename },
        { label: 'Copy as New Quiz', icon: 'copy', tooltip: 'A new open quiz over the same problems in the same order. Ratings start fresh for the copy.', onSelect: () => startQuizWith(q.itemIds, 0, `${q.name || 'Quiz'} Copy`) },
        ...(q.finishedAt ? [{ label: 'Reopen', icon: 'rotate-ccw', tooltip: 'Makes this completed quiz open again, at its last problem.', onSelect: () => void reopenQuizSession(q.id).catch(() => {}) }] : []),
        { separator: true },
        { label: 'Delete Quiz…', icon: 'trash-2', danger: true, onSelect: () => void remove() },
      ]));
      row.appendChild(end);
      groupFor(q.finishedAt ? 'Completed' : 'Open').appendChild(row);
    }
  };
  const sub = onWorksheetDataChanged(() => void render());
  void render();
  return { dispose: () => { disposed = true; sub.dispose(); root.remove(); } };
}

function createPracticeConfigPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create ws-builder');
  container.appendChild(root);
  let disposed = false;
  const disposables: { dispose(): void }[] = [];

  createPageHeader(root, {
    back: BACK_TO_HOME,
    title: 'New Quiz',
    subtitle: 'Choose what to draw from. Every rating you give lands on the problem.',
  });

  // The workbook's Quiz Generator, as chips: which papers, which sources,
  // which kinds (several each), then one rating band and one starred choice.
  // Generated items stay out unless their source chip is on.
  const filters = { papers: new Set<string>(), sources: new Set<string>(), kinds: new Set<string>(), state: 'all', starred: 'any' as 'any' | 'starred' | 'unstarred' };
  let bank: WorksheetItemSummary[] = [];
  // A set handed over from the Dashboard or the bank (Due Now, Quiz These…):
  // the filters then narrow within it, and the From chip says where it came
  // from until cleared.
  let presetIds: Set<number> | null = null;
  let presetName = '';
  const pool = (): WorksheetItemSummary[] => (presetIds ? bank.filter((it) => presetIds!.has(it.id)) : bank);

  const grid = el('div', 'ws-builder__grid');
  const left = el('div', 'ws-builder__filters');
  const side = el('div', 'ws-builder__side');
  grid.append(left, side);
  root.appendChild(grid);
  const group = (label: string) => {
    const g = el('div', 'ws-builder__group');
    createSectionLabel(g, label);
    const host = el('div', 'ws-chips');
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', label);
    g.appendChild(host);
    left.appendChild(g);
    return { g, host };
  };
  const from = group('From');
  const papers = group('Papers');
  const sources = group('Sources');
  const kinds = group('Kinds');
  const ratingGroup = group('Rating');
  const starGroup = group('Starred');
  left.appendChild(el('div', 'ws-hint', 'No chip on in a group means every one in it.'));

  // The side card: what you will get, and how.
  side.appendChild(el('div', 'ws-builder__label', 'Matching problems'));
  const bigCount = el('div', 'ws-builder__count', '0');
  const breakdown = el('div', 'ws-hint');
  side.append(bigCount, breakdown);
  const lenLabel = el('label', 'ws-builder__field');
  lenLabel.appendChild(el('span', 'ws-builder__fieldlabel', 'Length'));
  const stepper = el('div', 'ws-stepper');
  const countIn = el('input', 'ws-stepper__value') as HTMLInputElement;
  countIn.type = 'number'; countIn.min = '1'; countIn.max = '100'; countIn.value = '10';
  countIn.setAttribute('aria-label', 'Number of problems');
  const ofLine = el('span', 'ws-hint');
  let matching = 0;
  const clampCount = () => {
    const n = Math.max(1, Math.min(Math.max(1, matching), parseInt(countIn.value, 10) || 10));
    countIn.value = String(n);
  };
  const minus = createIconButton(stepper, { icon: 'minus', title: 'Fewer', size: 'sm', onClick: () => { countIn.value = String((parseInt(countIn.value, 10) || 1) - 1); clampCount(); } });
  stepper.appendChild(countIn);
  const plus = createIconButton(stepper, { icon: 'plus', title: 'More', size: 'sm', onClick: () => { countIn.value = String((parseInt(countIn.value, 10) || 0) + 1); clampCount(); } });
  void minus; void plus;
  countIn.addEventListener('change', clampCount);
  const lenRow = el('div', 'ws-builder__row');
  lenRow.append(stepper, ofLine);
  lenLabel.appendChild(lenRow);
  side.appendChild(lenLabel);
  const shuffleWrap = el('label', 'ws-builder__check') as HTMLLabelElement;
  const shuffleIn = el('input') as HTMLInputElement;
  shuffleIn.type = 'checkbox'; shuffleIn.checked = true;
  shuffleWrap.append(shuffleIn, document.createTextNode('Shuffle'));
  side.appendChild(shuffleWrap);
  // The quiz's name: what Home lists it under, filled from the choices until you type one.
  const nameLabel = el('label', 'ws-builder__field');
  nameLabel.appendChild(el('span', 'ws-builder__fieldlabel', 'Name'));
  const nameIn = el('input', 'ws-input') as HTMLInputElement;
  nameIn.type = 'text';
  nameIn.maxLength = 80;
  nameIn.title = 'The quiz is saved under this name and listed on Home until you complete it.';
  let nameEdited = false;
  nameIn.addEventListener('input', () => { nameEdited = nameIn.value.trim().length > 0; });
  nameLabel.appendChild(nameIn);
  side.appendChild(nameLabel);
  const startBtn = createButton(side, { label: 'Start Quiz', kind: 'primary' });
  startBtn.classList.add('ws-builder__start');

  const filtersName = (): string => {
    const ps = [...filters.papers].map(paperLabel);
    const parts = [presetIds ? presetName : ps.length ? ps.join(', ') : 'All papers'];
    const STATE_WORDS: Record<string, string> = { incomplete: 'incomplete', unseen: 'never tried', easy: 'easy', medium: 'medium', hard: 'hard', struggling: 'medium or hard' };
    if (STATE_WORDS[filters.state]) parts.push(STATE_WORDS[filters.state]);
    if (filters.starred === 'starred') parts.push('starred');
    if (filters.starred === 'unstarred') parts.push('not starred');
    return parts.join(' · ');
  };
  const currentFilters = () => ({
    tags: [] as string[],
    papers: [...filters.papers],
    sources: [...filters.sources],
    kinds: [...filters.kinds],
    state: filters.state,
    starred: filters.starred,
    count: Math.max(1, parseInt(countIn.value, 10) || 10),
    shuffle: shuffleIn.checked,
  });

  const syncSide = () => {
    const ids = buildPracticeSet(pool(), { ...currentFilters(), count: 10_000, shuffle: false });
    matching = ids.length;
    bigCount.textContent = String(matching);
    const byPaper = new Map<string, number>();
    const byId = new Map(bank.map((it) => [it.id, it]));
    for (const id of ids) { const p = byId.get(id)?.paper ?? ''; byPaper.set(p, (byPaper.get(p) ?? 0) + 1); }
    breakdown.textContent = matching === 0 ? 'No problems match.' : [...byPaper.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${p ? paperLabel(p) : 'Generated'} ${n}`).join(' · ') + (byPaper.size > 4 ? ' · …' : '');
    countIn.max = String(Math.max(1, matching));
    if ((parseInt(countIn.value, 10) || 0) > matching && matching > 0) countIn.value = String(matching);
    ofLine.textContent = `of ${matching}`;
    startBtn.disabled = matching === 0;
    if (!nameEdited) nameIn.value = filtersName();
  };

  const multi = (host: HTMLElement, values: [string, string, number][], selected: Set<string>) => {
    host.replaceChildren();
    for (const [value, label, n] of values) {
      createFilterChip(host, { label, count: n, pressed: selected.has(value), onToggle: (on) => { if (on) selected.add(value); else selected.delete(value); syncSide(); } });
    }
    if (selected.size) {
      createButton(host, { label: 'Clear', kind: 'ghost', size: 'sm', onClick: () => { selected.clear(); renderFilters(); } });
    }
  };
  const renderFilters = () => {
    from.g.style.display = presetIds ? '' : 'none';
    from.host.replaceChildren();
    if (presetIds) {
      createFilterChip(from.host, { label: presetName, count: pool().length, pressed: true, title: 'The set handed over. Clear chooses from the whole bank.', onToggle: () => { presetIds = null; presetName = ''; renderFilters(); } });
    }
    const count = (pick: (it: WorksheetItemSummary) => string) => {
      const m = new Map<string, number>();
      for (const it of bank) { const k = pick(it); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    multi(papers.host, [...count((it) => it.paper).entries()].sort((a, b) => paperLabel(a[0]).localeCompare(paperLabel(b[0]))).map(([k, n]) => [k, paperLabel(k), n]), filters.papers);
    multi(sources.host, [...count((it) => it.source || 'generated').entries()].map(([k, n]) => [k, SOURCE_LABELS[k] ?? (k === 'generated' ? 'Generated' : k), n] as [string, string, number]), filters.sources);
    multi(kinds.host, [...count((it) => it.kind).entries()].map(([k, n]) => [k, KIND_LABELS[k] ?? k, n] as [string, string, number]), filters.kinds);
    syncSide();
  };
  const renderSwitches = () => {
    // One rating band and one starred choice: switches, made once.
    const rating = createSegmented(ratingGroup.host, {
      ariaLabel: 'Rating',
      items: [['all', 'Any'], ['unseen', 'Never tried'], ['incomplete', 'Incomplete'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['struggling', 'Medium or hard']].map(([value, label]) => ({ value, label })),
      value: filters.state,
      onChange: (v) => { filters.state = v; syncSide(); },
    });
    const nStarred = bank.filter((it) => it.starred).length;
    const star = createSegmented(starGroup.host, {
      ariaLabel: 'Starred',
      items: [{ value: 'any', label: 'Any' }, { value: 'starred', label: `Starred (${nStarred})` }, { value: 'unstarred', label: 'Not starred' }],
      value: filters.starred,
      onChange: (v) => {
        filters.starred = v as 'any' | 'starred' | 'unstarred';
        // Starred means all of them unless the length is lowered by hand.
        if (v === 'starred' && nStarred > 0) countIn.value = String(Math.min(100, nStarred));
        syncSide();
      },
    });
    star.element.title = STAR_HINT;
    disposables.push(rating, star);
  };

  countIn.addEventListener('input', () => { ofLine.textContent = `of ${matching}`; });

  startBtn.addEventListener('click', () => {
    clampCount();
    const ids = buildPracticeSet(pool(), currentFilters());
    if (ids.length === 0) return;
    startQuizWith(ids, 0, nameIn.value.trim() || filtersName());
  });

  void (async () => {
    bank = await listItems().catch(() => []);
    if (disposed) return;
    if (bank.length === 0) {
      grid.remove();
      createEmptyState(root, {
        icon: 'list-checks',
        headline: 'The bank is empty.',
        hint: 'Import your practice workbook first; a quiz draws from it.',
        action: { label: 'Import Workbook…', onClick: () => void openWorksheet('excel-import', 'Import Workbook') },
      });
      return;
    }
    // Generated items are left out until asked for, so a quiz is the workbook's problems by default.
    const realSources = new Set(bank.map((it) => it.source).filter(Boolean));
    if (realSources.size > 0 && bank.some((it) => !it.source)) for (const src of realSources) filters.sources.add(src);
    if (_quizPreset) {
      for (const p of _quizPreset.papers ?? []) filters.papers.add(p);
      if (_quizPreset.state) filters.state = _quizPreset.state;
      if (_quizPreset.starred) filters.starred = _quizPreset.starred;
      if (_quizPreset.ids && _quizPreset.ids.length) {
        presetIds = new Set(_quizPreset.ids);
        presetName = _quizPreset.name || 'Problem Bank selection';
        countIn.value = String(Math.min(100, _quizPreset.ids.length));
      }
      _quizPreset = null;
    }
    renderSwitches();
    renderFilters();
  })();

  return { dispose: () => { disposed = true; for (const d of disposables) d.dispose(); root.remove(); } };
}

function createPracticeRunPane(container: HTMLElement, input?: { setName?(name: string): void }) {
  const root = el('div', 'ws-pane');
  /** The tab carries the running quiz's name. */
  const nameTab = (name: string) => { try { input?.setName?.(name || 'Quiz'); } catch { /* not a tool input */ } };
  container.appendChild(root);
  let disposed = false;
  let player: { dispose(): void } | null = null;
  let changeSub: { dispose(): void } | null = null;
  /** The study clock for the quiz's own screens (overview, summary); a problem on screen has its own. */
  let quizTicker: { dispose(): void } | null = null;
  /** Bumped by every change of what the player shows; a sheet still being staged for an older step is thrown away. */
  let serveSeq = 0;
  let markCleanup: (() => void) | null = null;
  const bar = el('div', 'ws-sessionbar');
  const playerHost = el('div', 'ws-session__player');
  root.append(bar, playerHost);
  const gradeLabelFor = (g: string | undefined) => (g ? gradeLabel(g) : '');

  // No quiz: the tab came back with nothing to resume, or a quiz ended.
  const renderIdle = () => {
    serveSeq++;
    bar.style.display = 'none';
    bar.replaceChildren();
    playerHost.replaceChildren();
    nameTab('Quiz');
    createEmptyState(playerHost, {
      icon: 'list-checks',
      headline: 'No quiz is running.',
      hint: 'Build one, or start one from the Study Dashboard or Quizzes.',
      action: { label: 'New Quiz', onClick: () => openBuilder() },
    });
  };

  const run = (session: RunningPractice) => {
    bar.style.display = '';
    nameTab(session.name);
    markCleanup?.();
    let view: 'sheet' | 'overview' = 'sheet';
    // Reviewing the overview or the summary is study too: it counts under
    // item 0 of this quiz, only while no problem sheet is on screen.
    quizTicker?.dispose();
    quizTicker = createStudyTicker({
      visible: () => !disposed && paneOnScreen(root) && (view === 'overview' || session.index >= session.ids.length),
      idleMs: getIdleMinutes() * 60_000,
      credit: (secs, final) => { void addStudySeconds(dayKey(Date.now()), 0, session.id, secs, final).catch(() => {}); },
    });

    // The quiz's lifecycle, one action each (Mufaro, 2026-09-17: one button
    // used to start, finish and replace). Complete Quiz is the only way a
    // quiz finishes; Reopen Quiz undoes it; Copy Quiz is a new open quiz over
    // the same problems; Rename changes what Home lists it under.
    const completeQuiz = async () => {
      if (session.finishedAt) return;
      // A quiz never closes quietly one short. Anything neither worked nor
      // rated is counted out loud first (Mufaro, 2026-09-20: a day ended 16
      // of 17 with every problem in it gone over).
      const states = await getSessionItemStates(session.ids, session.startedAt).catch(() => new Map());
      const byId = new Map((await listItems().catch(() => [])).map((s) => [s.id, s]));
      const undone = session.ids.filter((id) => {
        const st = states.get(id);
        if (st?.worked || normalizeRating(st?.grade ?? '')) return false;
        const it = byId.get(id);
        return !(it?.worked || (!it?.ratingImported && normalizeRating(it?.attemptState ?? '')));
      });
      // Marks are the student's own "come back to this"; completing over
      // them is asked about in those words.
      const marked = session.ids.filter((id) => session.marked.has(id));
      if (undone.length > 0 || marked.length > 0) {
        const n = undone.length > 0 ? undone.length : marked.length;
        const noun = n === 1 ? 'problem' : 'problems';
        const marksLeft = marked.length > 0 ? ` ${marked.length} ${marked.length === 1 ? 'is' : 'are'} still marked for later.` : '';
        const ok = await _api?.window?.showConfirmModal?.({
          message: undone.length > 0 ? `Complete this quiz with ${n} ${noun} not done?` : `Complete this quiz with ${n} ${noun} still marked for later?`,
          detail: undone.length > 0
            ? `Nothing was worked or rated on them, so they count for nothing today and stay in the bank for another day. Back To Quiz takes you to them.${marksLeft}`
            : 'You marked them to come back to. Next Marked on the summary takes you to them; a completed quiz keeps its marks.',
          confirmLabel: 'Complete Anyway',
        }) ?? true;
        if (!ok || disposed) return;
      }
      await finishQuizSession(session.id).catch(() => {});
      session.finishedAt = Date.now();
      _api?.activity?.note('finished', `the quiz "${session.name}"`);
      if (disposed) return;
      session.index = session.ids.length;
      view = 'sheet';
      serve();
    };
    const reopenQuiz = async () => {
      if (!session.finishedAt) return;
      await reopenQuizSession(session.id).catch(() => {});
      session.finishedAt = null;
      _practice = session;
      if (disposed) return;
      session.index = Math.max(0, Math.min(session.index, session.ids.length - 1));
      view = 'sheet';
      serve();
    };
    const copyQuiz = () => startQuizWith(session.ids, 0, `${session.name || 'Quiz'} Copy`);
    const renameQuiz = async (name: string) => {
      const v = name.trim();
      if (!v || v === session.name) return;
      session.name = v;
      nameTab(v);
      await renameQuizSession(session.id, v).catch(() => {});
    };

    const renderSummary = async () => {
      serveSeq++;
      player?.dispose();
      player = null;
      bar.style.display = 'none';
      bar.replaceChildren();
      playerHost.replaceChildren();
      // The summary finishes nothing. Complete Quiz is the one way a quiz
      // ends; until then it stays open and resumable, however many problems
      // are rated.
      if (disposed) return;
      const wrap = el('div', 'ws-home ws-summary');
      const [grades, bank, states] = await Promise.all([
        getSessionGrades(session.ids, session.startedAt, session.id, session.finishedAt ?? null),
        listItems().catch(() => []),
        getSessionItemStates(session.ids, session.startedAt, session.id).catch(() => new Map<number, { grade: string; attempted: boolean; worked: boolean; seconds: number }>()),
      ]);
      if (disposed) return;
      const byId = new Map(bank.map((i) => [i.id, i]));
      // What this quiz rated, then what the problem already carried.
      const resolved = new Map<number, { grade: string; own: boolean }>();
      for (const id of session.ids) {
        const own = grades.get(id);
        if (own) { resolved.set(id, { grade: own, own: true }); continue; }
        const prev = byId.get(id)?.attemptState ?? '';
        if (normalizeRating(prev)) resolved.set(id, { grade: prev, own: false });
      }
      const counts = { nailed: 0, partial: 0, missed: 0, ungraded: 0 };
      let seconds = 0;
      const list = el('div', 'ws-list');
      session.ids.forEach((id, i) => {
        const item = byId.get(id);
        const hit = resolved.get(id);
        const grade = hit?.grade;
        const r = grade ? normalizeRating(grade) : '';
        if (r === 'easy') counts.nailed++;
        else if (r === 'medium') counts.partial++;
        else if (r === 'hard') counts.missed++;
        else counts.ungraded++;
        const row = el('button', 'ws-list__row') as HTMLButtonElement;
        row.type = 'button';
        row.appendChild(el('span', 'ws-list__idx', String(i + 1)));
        row.appendChild(el('span', 'ws-list__title ws-list__grow', item?.title ?? `Item ${id}`));
        // Own rating, then an earlier one of his, then work without one, then
        // what the workbook carried: the summary never dresses a workbook
        // rating up as his.
        let pill: HTMLElement;
        if (grade && hit!.own) pill = el('span', `ws-chip ws-chip--${stateClass(grade)}`, gradeLabelFor(grade));
        else if (grade && !item?.ratingImported) pill = el('span', `ws-chip ws-chip--${stateClass(grade)}`, `${gradeLabelFor(grade)} earlier`);
        else if (item?.worked) pill = el('span', 'ws-chip ws-chip--open', 'Worked, not rated');
        else if (grade) pill = el('span', `ws-chip ws-chip--${stateClass(grade)}`, `${gradeLabelFor(grade)} in workbook`);
        else pill = el('span', 'ws-chip ws-chip--muted', session.skipped.has(id) ? 'Skipped' : 'Not rated');
        row.appendChild(pill);
        // The flag keeps its own column beside the time, so flags line up.
        const flagSlot = el('span', 'ws-list__flag');
        if (session.marked.has(id)) {
          flagSlot.appendChild(createIconElement('flag', 14));
          flagSlot.setAttribute('role', 'img');
          flagSlot.setAttribute('aria-label', 'Marked for later');
        }
        row.appendChild(flagSlot);
        const secs = states.get(id)?.seconds ?? 0;
        seconds += secs;
        row.appendChild(el('span', 'ws-list__time', secs ? fmtStudy(secs) : '–'));
        row.title = `Open ${item?.title ?? 'this problem'}`;
        row.addEventListener('click', () => { _practice = session; view = 'sheet'; goTo(i); });
        list.appendChild(row);
      });
      const tagRoll = new Map<string, { n: number; nailed: number }>();
      for (const id of session.ids) {
        const item = byId.get(id);
        if (!item) continue;
        for (const t of itemTags(item.tags)) {
          const entry = tagRoll.get(t) ?? { n: 0, nailed: 0 };
          entry.n++;
          if (normalizeRating(resolved.get(id)?.grade) === 'easy') entry.nailed++;
          tagRoll.set(t, entry);
        }
      }

      const n = session.ids.length;
      createPageHeader(wrap, {
        back: { label: 'Quizzes', onClick: () => void openWorksheet('quizzes', 'Quizzes') },
        title: session.name || 'Quiz',
        subtitle: [`Quiz summary · ${n} ${n === 1 ? 'problem' : 'problems'}`, seconds ? fmtStudy(seconds) : '', session.finishedAt ? `completed ${when(session.finishedAt)}` : 'open'].filter(Boolean).join(' · '),
        secondary: session.finishedAt ? [] : [{ label: 'Back to Quiz', title: 'Continues where the quiz was. It stays open.', onClick: () => { _practice = session; goTo(session.ids.length - 1); } }],
        primary: session.finishedAt
          ? { label: 'Reopen Quiz', title: 'Makes this completed quiz open again, at its last problem.', onClick: () => void reopenQuiz() }
          : { label: 'Complete Quiz…', icon: 'check', title: 'Marks this quiz completed. Ratings stay on the problems; Reopen Quiz undoes it.', onClick: () => void completeQuiz() },
        more: [
          ...(!session.finishedAt && session.marked.size > 0 ? [{ label: `Next Marked (${session.marked.size})`, icon: 'skip-forward', onSelect: () => { _practice = session; goToMarked(-1); } }] : []),
          { label: 'Quiz Overview', icon: 'list', onSelect: () => { _practice = session; session.index = Math.min(session.index, session.ids.length - 1); view = 'overview'; serve(); } },
          { label: 'Copy as New Quiz', icon: 'copy', tooltip: 'A new open quiz over the same problems in the same order. Ratings start fresh for the copy.', onSelect: copyQuiz },
        ],
      });

      // The quiz at a glance: one bar, then the counts it is made of.
      const glance = el('div', 'ws-summary__glance');
      const bar2 = el('div', 'ws-ratingbar');
      bar2.setAttribute('role', 'img');
      bar2.setAttribute('aria-label', `${counts.nailed} easy, ${counts.partial} medium, ${counts.missed} hard, ${counts.ungraded} not rated`);
      for (const [cls, v] of [['easy', counts.nailed], ['medium', counts.partial], ['hard', counts.missed]] as const) {
        if (!v) continue;
        const seg = el('span', `ws-ratingbar__seg ws-ratingbar__seg--${cls}`);
        seg.style.width = `${(v / Math.max(1, n)) * 100}%`;
        bar2.appendChild(seg);
      }
      glance.appendChild(bar2);
      const legend = (cls: string, text: string) => {
        const k = el('span', 'ws-summary__key');
        k.append(el('span', `ws-bank__dot ${cls}`), document.createTextNode(text));
        glance.appendChild(k);
      };
      legend('easy', `${counts.nailed} easy`);
      legend('medium', `${counts.partial} medium`);
      legend('hard', `${counts.missed} hard`);
      legend('rest', `${counts.ungraded} not rated`);
      if (session.marked.size) {
        const k = el('span', 'ws-summary__key ws-summary__key--marked');
        k.append(createIconElement('flag', 12), document.createTextNode(`${session.marked.size} marked`));
        glance.appendChild(k);
      }
      // The per-tag rollup rides as the tooltip: twenty hashtags in a row was noise on screen.
      if (tagRoll.size > 0) glance.title = `By tag (easy / seen): ${[...tagRoll.entries()].map(([t, e]) => `#${t} ${e.nailed}/${e.n}`).join(' · ')}`;
      wrap.appendChild(glance);
      wrap.appendChild(list);
      playerHost.appendChild(wrap);
    };

    const gradeNote = el('span', 'ws-sessionbar__grade');
    /** What this quiz knows about the item on screen: its rating and whether it was worked. */
    let currentState: { grade: string; attempted: boolean } | undefined;
    const refreshGradeNote = async () => {
      if (disposed || session.index >= session.ids.length) return;
      const id = session.ids[session.index];
      const [grades, states] = await Promise.all([
        getSessionGrades([id], session.startedAt, session.id, session.finishedAt ?? null),
        getSessionItemStates([id], session.startedAt, session.id).catch(() => new Map<number, { grade: string; attempted: boolean; worked: boolean; seconds: number }>()),
      ]);
      if (disposed || id !== session.ids[session.index]) return;
      const g = grades.get(id);
      const st = states.get(id);
      currentState = { grade: g ?? st?.grade ?? '', attempted: !!st?.attempted };
      gradeNote.textContent = g ? `Rated ${gradeLabelFor(g)}` : '';
      // Work on a problem cancels an earlier skip: a rated or attempted item
      // never reads as one left undone.
      if ((currentState.grade || currentState.attempted) && session.skipped.delete(id)) void persistPractice();
    };
    changeSub?.dispose();
    changeSub = onWorksheetDataChanged(() => { void refreshGradeNote(); void paintDots(); });

    // Every move is stored, so a restart lands on the same item.
    const goTo = (index: number) => {
      session.index = Math.max(0, Math.min(session.ids.length, index));
      void persistPractice();
      view = 'sheet';
      serve();
    };
    /** Next Marked: the marked problem after `from`, round the quiz; -1 starts at the first. */
    const goToMarked = (from: number) => {
      const i = nextMarkedIndex(session.ids, session.marked, from);
      if (i >= 0) goTo(i);
    };

    // The overview: every problem in the quiz with what happened to it, a
    // note per problem, and a click to jump. Skipping problem 1 no longer
    // means clicking through the rest to get back to it.
    const renderOverview = async () => {
      player?.dispose();
      player = null;
      playerHost.replaceChildren();
      const wrap = el('div', 'ws-quiz__overview');
      playerHost.appendChild(wrap);
      const [states, notes, bank] = await Promise.all([
        getSessionItemStates(session.ids, session.startedAt, session.id).catch(() => new Map<number, { grade: string; attempted: boolean; worked: boolean; seconds: number }>()),
        getProblemNotes(session.ids).catch(() => new Map<number, string>()),
        listItems().catch(() => []),
      ]);
      if (disposed || view !== 'overview') return;
      const byId = new Map(bank.map((i) => [i.id, i]));
      const counts = { rated: 0, attempted: 0, skipped: 0, untouched: 0, marked: 0 };
      const countsLine = el('span', 'ws-hint');
      const paintCounts = () => {
        countsLine.textContent = [`${counts.rated} rated`, `${counts.attempted} worked`, `${counts.skipped} skipped`, `${counts.untouched} not started`, counts.marked ? `${counts.marked} marked for later` : ''].filter(Boolean).join(' · ');
      };
      const rows: HTMLElement[] = [];
      let paintCountsHook = paintCounts;
      session.ids.forEach((id, i) => {
        const item = byId.get(id);
        const st = states.get(id);
        const sessionGrade = st?.grade ? normalizeRating(st.grade) : '';
        // Rated before this quiz began: the rating still shows, marked as earlier.
        const earlierGrade = !sessionGrade && item ? normalizeRating(item.attemptState) : '';
        const gradeText = sessionGrade ? st!.grade : (item?.attemptState ?? '');
        if ((sessionGrade || st?.attempted) && session.skipped.delete(id)) void persistPractice();
        const skipped = session.skipped.has(id);
        if (session.marked.has(id)) counts.marked++;
        // Work outranks an old rating here: working a problem is what counts
        // it for the day, and a rating that came in with the workbook is said
        // in those words so it is never mistaken for one given here.
        const earlierText = item?.ratingImported ? `${gradeLabel(item.attemptState)} in workbook` : `${gradeLabel(item?.attemptState ?? '')} earlier`;
        const status = sessionGrade ? gradeLabel(st!.grade) : st?.worked ? 'Worked, not rated' : earlierGrade ? earlierText : st?.attempted ? 'Opened' : skipped ? 'Skipped' : 'Not started';
        if (sessionGrade) counts.rated++; else if (st?.worked) counts.attempted++; else if (skipped) counts.skipped++; else counts.untouched++;
        const row = el('div', `ws-quiz__row${i === session.index ? ' ws-quiz__row--current' : ''}`);
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.appendChild(el('span', 'ws-quiz__num', String(i + 1)));
        const text = el('div', 'ws-quiz__rowtext');
        text.appendChild(el('div', 'ws-quiz__rowtitle', item?.title ?? `Item ${id}`));
        text.appendChild(el('div', 'ws-quiz__rowmeta', item?.paper ? paperLabel(item.paper) : (item?.sourceLabel ?? '')));
        const note = notes.get(id) ?? '';
        const preview = el('div', 'ws-quiz__notepreview', note);
        if (!note) preview.style.display = 'none';
        text.appendChild(preview);
        row.appendChild(text);
        const chipCls = sessionGrade ? `ws-chip--${stateClass(gradeText)}` : st?.worked ? 'ws-chip--open' : earlierGrade ? `ws-chip--${stateClass(gradeText)}` : 'ws-chip--muted';
        row.appendChild(el('span', `ws-chip ${chipCls}`, status));
        row.appendChild(el('span', 'ws-quiz__time', st?.seconds ? fmtStudy(st.seconds) : ''));
        const noteBtn = iconBtn('notebook-pen', note ? 'Edit Note' : 'Add Note', { hint: 'A note on this problem, kept with it across quizzes.' });
        row.appendChild(noteBtn);
        const editor = el('div', 'ws-quiz__note');
        editor.style.display = 'none';
        const ta = el('textarea', 'ws-quiz__notetext') as HTMLTextAreaElement;
        ta.value = note;
        ta.placeholder = 'What to remember about this problem.';
        ta.addEventListener('click', (e) => e.stopPropagation());
        ta.addEventListener('keydown', (e) => e.stopPropagation());
        ta.addEventListener('blur', () => {
          const v = ta.value.trim();
          void setProblemNote(id, v).catch(() => {});
          preview.textContent = v;
          preview.style.display = v ? '' : 'none';
          paintIconBtn(noteBtn, 'notebook-pen', v ? 'Edit Note' : 'Add Note', 'A note on this problem, kept with it across quizzes.');
        });
        editor.appendChild(ta);
        noteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = editor.style.display === 'none';
          editor.style.display = open ? '' : 'none';
          if (open) ta.focus();
        });
        row.appendChild(markBtn(session, id, (on) => { counts.marked += on ? 1 : -1; paintCountsHook(); }));
        row.appendChild(starBtn(id, item?.starred ?? false));
        row.appendChild(editor);
        row.addEventListener('click', () => goTo(i));
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) goTo(i); });
        rows.push(row);
      });
      // The kit header: the quiz's name (renamed from ⋯), the counts, the way
      // back to the problem and on to the summary.
      paintCounts();
      const back = Math.min(session.index, session.ids.length - 1);
      const header = createPageHeader(wrap, {
        title: session.name || 'Quiz',
        subtitle: countsLine.textContent ?? '',
        secondary: [{ label: `Back to Problem ${back + 1}`, title: 'The problem you were on.', onClick: () => { view = 'sheet'; goTo(back); } }],
        primary: session.finishedAt
          ? { label: 'Reopen Quiz', title: 'Makes this completed quiz open again.', onClick: () => void reopenQuiz() }
          : { label: 'Quiz Summary', title: 'The ratings so far, and Complete Quiz when you are done.', onClick: () => goTo(session.ids.length) },
        more: [
          { label: 'Rename…', icon: 'pencil', onSelect: () => {
            const nameEl = header.querySelector('.px-page-header__title') as HTMLElement | null;
            if (!nameEl) return;
            const input = el('input', 'ws-input ws-input--title') as HTMLInputElement;
            input.type = 'text';
            input.maxLength = 80;
            input.value = session.name;
            input.placeholder = 'Quiz name';
            input.setAttribute('aria-label', 'Quiz name');
            const commit = () => { void renameQuiz(input.value).then(() => { nameEl.textContent = session.name || 'Quiz'; input.replaceWith(nameEl); }); };
            input.addEventListener('keydown', (e) => {
              e.stopPropagation();
              if (e.key === 'Enter') input.blur();
              if (e.key === 'Escape') { input.value = session.name; input.blur(); }
            });
            input.addEventListener('blur', commit);
            nameEl.replaceWith(input);
            input.focus();
            input.select();
          } },
          { label: 'Copy as New Quiz', icon: 'copy', tooltip: 'A new open quiz over the same problems in the same order.', onSelect: copyQuiz },
        ],
      });
      // The counts follow a mark set from a row.
      const subEl = header.querySelector('.px-page-header__subtitle');
      const repaint = paintCounts;
      paintCountsHook = () => { repaint(); if (subEl) subEl.textContent = countsLine.textContent; };
      const list = el('div', 'ws-list ws-quiz__list');
      for (const r of rows) list.appendChild(r);
      wrap.appendChild(list);
    };

    // One dot per problem: rated in its colour, worked in the accent, the
    // rest quiet; the current one ringed. A click goes there.
    const dots = el('div', 'ws-sessionbar__dots');
    dots.setAttribute('role', 'group');
    dots.setAttribute('aria-label', 'Problems in this quiz');
    let dotsSeq = 0;
    const paintDots = async () => {
      const seq = ++dotsSeq;
      const [states, bank] = await Promise.all([
        getSessionItemStates(session.ids, session.startedAt, session.id).catch(() => new Map<number, { grade: string; attempted: boolean; worked: boolean; seconds: number }>()),
        listItems().catch(() => []),
      ]);
      if (disposed || seq !== dotsSeq) return;
      const byId = new Map(bank.map((i) => [i.id, i]));
      dots.replaceChildren();
      session.ids.forEach((id, i) => {
        const st = states.get(id);
        const item = byId.get(id);
        const own = st?.grade ? normalizeRating(st.grade) : '';
        const earlier = !own && item && !item.ratingImported ? normalizeRating(item.attemptState) : '';
        const cls = own || earlier || (st?.worked ? 'open' : 'rest');
        const words = own ? gradeLabel(st!.grade) : earlier ? `${gradeLabel(item!.attemptState)} earlier` : st?.worked ? 'worked' : session.skipped.has(id) ? 'skipped' : 'not started';
        const d = el('button', `ws-sessionbar__dot ws-bank__dot ${cls}${i === session.index && view === 'sheet' ? ' ws-sessionbar__dot--current' : ''}`) as HTMLButtonElement;
        d.type = 'button';
        const label = `Problem ${i + 1}, ${words}${session.marked.has(id) ? ', marked' : ''}`;
        d.setAttribute('aria-label', label);
        d.title = `${item?.title ?? `Problem ${i + 1}`}: ${words}${session.marked.has(id) ? ', marked for later' : ''}`;
        if (i === session.index) d.setAttribute('aria-current', 'step');
        d.addEventListener('click', () => goTo(i));
        dots.appendChild(d);
      });
    };

    const paintBar = () => {
      bar.replaceChildren();
      const prev = createIconButton(bar, { icon: 'chevron-left', title: 'Previous Problem', size: 'sm', onClick: () => goTo(session.index - 1) });
      prev.disabled = session.index === 0;
      const pos = el('span', 'ws-sessionbar__pos');
      pos.append(el('span', 'ws-sessionbar__name', session.name || 'Quiz'), el('span', 'ws-sessionbar__count', ` · ${session.index + 1} of ${session.ids.length}`));
      bar.appendChild(pos);
      // The last Next opens the summary, where Complete Quiz is a separate
      // decision; nothing here finishes the quiz.
      const last = session.index === session.ids.length - 1;
      createIconButton(bar, { icon: last ? 'check' : 'chevron-right', title: last ? 'Quiz Summary' : 'Next Problem', size: 'sm', onClick: () => goTo(session.index + 1) });
      bar.appendChild(dots);
      void paintDots();
      if (session.finishedAt) {
        const chip = el('span', 'ws-chip ws-chip--muted', 'Reviewing');
        chip.title = 'A completed quiz, reopened. Ratings you give still count on the problems; Reopen Quiz on the summary makes it open again.';
        bar.appendChild(chip);
      }
      gradeNote.textContent = '';
      bar.appendChild(gradeNote);
      const spacer = el('div'); spacer.style.flex = '1';
      bar.appendChild(spacer);
      const overviewBtn = createButton(bar, {
        label: 'Overview', icon: 'list', kind: 'ghost', size: 'sm',
        title: view === 'overview' ? 'Back to the problem' : 'Every problem in this quiz, with status, rating, time and notes',
        onClick: () => { view = view === 'overview' ? 'sheet' : 'overview'; serve(); },
      });
      overviewBtn.setAttribute('aria-pressed', String(view === 'overview'));
      // Next Marked carries its count, shown only while there is one.
      const nextMarkedBtn = createButton(bar, { label: 'Next Marked', icon: 'skip-forward', kind: 'ghost', size: 'sm', title: 'Goes to the next problem you marked for later, round the quiz.', onClick: () => goToMarked(session.index) });
      const paintNextMarked = () => {
        const n = session.marked.size;
        const lbl = nextMarkedBtn.querySelector('.px-btn__label');
        if (lbl) lbl.textContent = `Next Marked (${n})`;
        nextMarkedBtn.style.display = n ? '' : 'none';
      };
      paintNextMarked();
      markRepaint = () => { paintNextMarked(); void paintDots(); };
      // Skipping an item already rated or worked moves on without marking anything.
      createIconButton(bar, {
        icon: 'chevron-last', title: 'Skip Problem', size: 'sm',
        onClick: () => {
          if (!(currentState?.grade || currentState?.attempted)) session.skipped.add(session.ids[session.index]);
          goTo(session.index + 1);
        },
      });
    };
    /** Marks set from the problem's header repaint the bar. */
    let markRepaint = () => {};
    const onMark = () => markRepaint();
    _markListeners.add(onMark);
    markCleanup = () => _markListeners.delete(onMark);

    const serve = () => {
      if (disposed) return;
      const seq = ++serveSeq;
      if (session.index >= session.ids.length) { void renderSummary(); return; }
      bar.style.display = '';
      paintBar();
      if (view === 'overview') {
        player?.dispose();
        player = null;
        playerHost.replaceChildren();
        void renderOverview();
        return;
      }
      // The next sheet is built behind the one on screen and swapped in once
      // its engine has painted. Tearing the old one down first showed the
      // empty pane, the loading line and the first paint one after another
      // on every Next and Previous (the flash).
      const stage = el('div', 'ws-session__stage ws-session__stage--staging');
      playerHost.appendChild(stage);
      const next = createSheetPane(stage, `item:${session.ids[session.index]}`);
      void next.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        if (disposed || seq !== serveSeq) { next.dispose(); stage.remove(); return; }
        player?.dispose();
        player = null;
        for (const old of [...playerHost.children]) if (old !== stage) old.remove();
        stage.classList.remove('ws-session__stage--staging');
        player = next;
      })));
      void refreshGradeNote();
    };
    serve();
  };

  // The quiz in memory, or the stored one after a restart or a tool reload.
  const init = async () => {
    player?.dispose();
    player = null;
    const session = await restorePractice();
    if (disposed) return;
    if (session) run(session); else renderIdle();
  };
  const onPractice = () => void init();
  _practiceListeners.add(onPractice);
  void init();

  return {
    dispose: () => {
      disposed = true;
      _practiceListeners.delete(onPractice);
      markCleanup?.();
      changeSub?.dispose();
      quizTicker?.dispose();
      quizTicker = null;
      player?.dispose();
      root.remove();
    },
  };
}

// ── Excel import pane (instanceId 'excel-import') ───────────────────────────
//
// Real practice workbooks (Rising Fellow problem sets, CAS item files) come
// in as native worksheet items: the question sheet becomes the practice
// surface, the answer region/sheet becomes the revealed solution — formulas,
// merges and layout intact. Detection is mechanical (no AI): "Item N /
// Answer N" pairs, and question-left / "Solution ->"-right sheets.

// A workbook path handed to `worksheet.importExcel` (a probe, a drop, a
// script) skips the native dialog: the live pane takes it at once, a pane not
// yet built takes it when it mounts.
let _pendingImportPath: string | null = null;
let _importPaneHooks: { importPath(filePath: string): Promise<void> } | null = null;

function createExcelImportPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create');
  container.appendChild(root);
  let disposed = false;

  createPageHeader(root, {
    back: BACK_TO_HOME,
    title: 'Import Workbook',
    subtitle: 'A practice workbook: one problem per sheet, named Paper.Source_NN.',
  });

  // Before a file: one place to choose it, and what will happen. After: a
  // slim line with the file's status and Choose Another….
  const pickRow = el('div', 'ws-drop');
  const dropIcon = createIconElement('upload', 28);
  dropIcon.classList.add('ws-drop__icon');
  const dropHead = el('div', 'ws-drop__head', 'Choose an Excel workbook');
  const dropHint = el('div', 'ws-hint', 'Every sheet comes in with its formatting, the solution hidden until you reveal it, your ratings carried over. Importing the same workbook again adds only new problems.');
  dropHint.title = 'Other spreadsheets: Item/Answer sheet pairs and question-left, solution-right sheets are detected; anything else can be imported whole.';
  const pickBtn = createButton(null, { label: 'Choose Excel File…', kind: 'primary' });
  const status = el('span', 'ws-hint ws-drop__status');
  pickRow.append(dropIcon, dropHead, dropHint, pickBtn, status);
  root.appendChild(pickRow);
  /** Once a workbook is read, the chooser shrinks to a line. */
  const compactPicker = () => {
    pickRow.classList.add('ws-drop--compact');
    const lbl = pickBtn.querySelector('.px-btn__label');
    if (lbl) lbl.textContent = 'Choose Another…';
    pickBtn.className = 'px-btn px-btn--secondary';
  };
  // The import's one action, in a footer that says what it will do.
  const footer = el('div', 'ws-footbar');
  const footNote = el('span', 'ws-hint');
  footer.appendChild(footNote);
  const footHost = el('div', 'ws-footbar__actions');
  footer.appendChild(footHost);
  footer.style.display = 'none';

  const err = el('div', 'ws-error');
  err.style.display = 'none';
  root.appendChild(err);
  const listHost = el('div', 'ws-create__review');
  root.appendChild(listHost);
  root.appendChild(footer);

  const renderSelection = (items: ExcelItem[], leftovers: GridSheet[], filePath: string, fileLabel: string) => {
    listHost.replaceChildren();
    err.style.display = 'none';

    interface Row { item: ExcelItem; include: boolean; box: HTMLInputElement }
    const rows: Row[] = [];
    const addRow = (item: ExcelItem, include: boolean, host: HTMLElement) => {
      const row = el('div', 'ws-genitem ws-xlrow');
      const line = el('label', 'ws-xlrow__line');
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = include;
      line.appendChild(box);
      line.appendChild(el('span', 'ws-xlrow__title', item.title));
      const meta: string[] = [];
      if (item.points > 0) meta.push(`${item.points} pts`);
      meta.push(item.kind === 'pair' ? 'Item + Answer sheets' : item.kind === 'split' ? 'solution alongside' : 'whole sheet');
      line.appendChild(el('span', 'ws-list__meta', meta.join(' · ')));
      row.appendChild(line);
      host.appendChild(row);
      rows.push({ item, include, box });
    };

    if (items.length > 0) {
      createSectionLabel(listHost, `${items.length} practice ${items.length === 1 ? 'item' : 'items'} detected`);
      const toggles = el('div', 'ws-create__controls');
      createButton(toggles, { label: 'Select All', kind: 'ghost', size: 'sm', onClick: () => { for (const r of rows) if (r.item.kind !== 'whole') r.box.checked = true; } });
      createButton(toggles, { label: 'Select None', kind: 'ghost', size: 'sm', onClick: () => { for (const r of rows) r.box.checked = false; } });
      listHost.appendChild(toggles);
      for (const item of items) addRow(item, true, listHost);
    }
    if (leftovers.length > 0) {
      createSectionLabel(listHost, `Other sheets (${leftovers.length})`);
      listHost.appendChild(el('div', 'ws-hint', 'No question and solution found. Tick any to import the whole sheet as a practice surface.'));
      for (const sheet of leftovers) addRow(wholeSheetItem(sheet, fileLabel), false, listHost);
    }
    if (items.length === 0 && leftovers.length === 0) {
      listHost.appendChild(el('div', 'ws-hint', 'That workbook has no importable sheets.'));
      return;
    }

    footHost.replaceChildren();
    const importBtn = createButton(footHost, { label: 'Import Selected Items', kind: 'primary' });
    const countSelected = () => { const n = rows.filter((r) => r.box.checked).length; footNote.textContent = `${n} selected`; const l = importBtn.querySelector('.px-btn__label'); if (l) l.textContent = n ? `Import ${n} ${n === 1 ? 'Item' : 'Items'}` : 'Import Selected Items'; };
    listHost.onchange = () => countSelected();
    footer.style.display = '';
    countSelected();
    importBtn.addEventListener('click', () => {
      void (async () => {
        const keep = rows.filter((r) => r.box.checked);
        if (keep.length === 0) {
          err.textContent = 'Nothing selected to import.';
          err.style.display = '';
          return;
        }
        importBtn.disabled = true;
        try {
          let done = 0;
          for (const r of keep) {
            await createItem({
              title: r.item.title,
              questionMd: r.item.questionMd,
              givensJson: r.item.givensJson,
              solutionJson: r.item.solutionJson,
              solutionNotesMd: '',
              sourceUri: filePath,
              sourceLabel: fileLabel,
              sourcePage: 0,
              tags: r.item.tags,
            });
            done++;
            if (done % 10 === 0) status.textContent = `Importing ${done} of ${keep.length}…`;
          }
          _api?.activity?.note('imported', `${keep.length} worksheet practice ${keep.length === 1 ? 'item' : 'items'}`, fileLabel);
          await _api?.window?.showInformationMessage?.(`Imported ${keep.length} ${keep.length === 1 ? 'item' : 'items'}.`);
          await openWorksheet('home', 'Worksheets');
        } catch (e) {
          err.textContent = (e as Error).message;
          err.style.display = '';
          importBtn.disabled = false;
        }
      })();
    });
  };

  /** Problem Bank import: problems grouped by paper, already-imported ones marked. */
  const renderProblems = async (problems: ProblemImport[], filePath: string, fileLabel: string, timeline: WorkbookSnapshot[]) => {
    listHost.replaceChildren();
    err.style.display = 'none';
    // One pass over the bank, not a query per problem: 331 round trips left
    // the pane blank for seconds with nothing to say.
    const existing = new Map<string, number>();
    for (const it of await listItems().catch(() => [] as WorksheetItemSummary[])) {
      if (it.sourceLabel === fileLabel && it.sheetName) existing.set(it.sheetName, it.id);
    }
    if (disposed) return;
    const rows: { problem: ProblemImport; box: HTMLInputElement }[] = [];
    // The footer says what Import will do; with nothing new it brings the history.
    const countSelected = () => {
      const n = rows.filter((r) => r.box.checked && !existing.has(r.problem.sheetName)).length;
      const papersOn = new Set(rows.filter((r) => r.box.checked && !existing.has(r.problem.sheetName)).map((r) => r.problem.paper)).size;
      footNote.textContent = n ? `${n} selected · ${papersOn} ${papersOn === 1 ? 'paper' : 'papers'}` : timeline.length ? 'Nothing new selected' : 'Nothing selected';
      const l = importBtn.querySelector('.px-btn__label');
      if (l) l.textContent = n ? `Import ${n} ${n === 1 ? 'Problem' : 'Problems'}` : timeline.length > 0 ? 'Import Dashboard History' : 'Import Selected Problems';
    };
    listHost.onchange = () => countSelected();
    const rated = problems.filter((p) => p.rating).length;
    const fresh = problems.length - existing.size;
    createSectionLabel(listHost, `${problems.length} problems in ${fileLabel}`);
    listHost.appendChild(el('div', 'ws-hint', `${fresh} new, ${existing.size} already in the bank, ${rated} with a rating to carry over${timeline.length ? `, ${timeline.length} ${timeline.length === 1 ? 'day' : 'days'} of dashboard history` : ''}.`));
    const toggles = el('div', 'ws-create__controls');
    createButton(toggles, { label: 'Select New', kind: 'ghost', size: 'sm', onClick: () => { for (const r of rows) r.box.checked = !existing.has(r.problem.sheetName); countSelected(); } });
    createButton(toggles, { label: 'Select None', kind: 'ghost', size: 'sm', onClick: () => { for (const r of rows) r.box.checked = false; countSelected(); } });
    listHost.appendChild(toggles);
    const byPaper = new Map<string, ProblemImport[]>();
    for (const p of problems) { if (!byPaper.has(p.paper)) byPaper.set(p.paper, []); byPaper.get(p.paper)!.push(p); }
    for (const [paper, list] of [...byPaper.entries()].sort((a, b) => paperLabel(a[0]).localeCompare(paperLabel(b[0])))) {
      const group = el('div', 'ws-import__group');
      const head = el('div', 'ws-import__grouphead');
      const groupBox = el('input') as HTMLInputElement;
      groupBox.type = 'checkbox';
      groupBox.checked = list.some((p) => !existing.has(p.sheetName));
      head.appendChild(groupBox);
      head.appendChild(el('span', undefined, `${paperLabel(paper)} (${list.length})`));
      group.appendChild(head);
      const groupRows: HTMLInputElement[] = [];
      for (const p of list) {
        const row = el('label', 'ws-import__row');
        const box = el('input') as HTMLInputElement;
        box.type = 'checkbox';
        box.checked = !existing.has(p.sheetName);
        row.appendChild(box);
        row.appendChild(el('span', 'ws-xlrow__title', p.title));
        const meta = [SOURCE_LABELS[p.source] ?? p.source, KIND_LABELS[p.kind] ?? p.kind, p.quadrant ? QUADRANT_LABELS[p.quadrant] : ''].filter(Boolean).join(' · ');
        row.appendChild(el('span', 'ws-list__meta', meta));
        if (p.rating) row.appendChild(el('span', `ws-chip ws-chip--${p.rating}`, ratingLabel(p.rating)));
        if (existing.has(p.sheetName)) row.appendChild(el('span', 'ws-chip ws-chip--muted', 'In the bank'));
        else row.appendChild(el('span', 'ws-chip ws-chip--open', 'New'));
        if (p.stats.imagesSkipped > 0) row.appendChild(el('span', 'ws-chip ws-chip--muted', `${p.stats.imagesSkipped} picture${p.stats.imagesSkipped === 1 ? '' : 's'} not shown`));
        group.appendChild(row);
        rows.push({ problem: p, box });
        groupRows.push(box);
      }
      groupBox.addEventListener('change', () => { for (const b of groupRows) b.checked = groupBox.checked; });
      listHost.appendChild(group);
    }
    footHost.replaceChildren();
    const importBtn = createButton(footHost, { label: 'Import Selected Problems', kind: 'primary' });
    footer.style.display = '';
    countSelected();
    importBtn.addEventListener('click', () => {
      void (async () => {
        const keep = rows.filter((r) => r.box.checked);
        // A bank that already holds every problem can still take the workbook's history.
        if (keep.length === 0 && timeline.length === 0) { err.textContent = 'Nothing selected to import.'; err.style.display = ''; return; }
        importBtn.disabled = true;
        let done = 0;
        let carried = 0;
        try {
          for (const r of keep) {
            const p = r.problem;
            if (existing.has(p.sheetName)) { done++; continue; }
            const id = await createItem({
              title: p.title, questionMd: p.questionMd, sourceUri: filePath, sourceLabel: fileLabel, tags: p.tags,
              sheetJson: p.sheetJson, solutionCol: p.solutionCol, workRow: p.workRow, solutionRow: p.solutionRow,
              paper: p.paper, source: p.source, kind: p.kind, quadrant: p.quadrant, sheetName: p.sheetName,
            });
            if (id != null && p.rating) { await recordImportedRating(id, p.rating, Date.now()); carried++; }
            done++;
            if (done % 10 === 0) status.textContent = `Importing ${done} of ${keep.length}…`;
          }
          // The workbook's own dashboard history, so the timeline starts where his did.
          for (const s of timeline) await upsertProgressSnapshot(s.day, s.attempted, s.score, 'workbook');
          status.textContent = '';
          _api?.activity?.note('imported', `${done} problems from ${fileLabel}`, carried ? `${carried} ratings carried over` : undefined);
          const history = timeline.length ? `${timeline.length} ${timeline.length === 1 ? 'day' : 'days'} of dashboard history` : '';
          await _api?.window?.showInformationMessage?.(
            done === 0 && history ? `Nothing new to import. Added ${history}.`
              : `Imported ${done} ${done === 1 ? 'problem' : 'problems'}${carried ? `, ${carried} with your rating` : ''}${history ? `, ${history}` : ''}.`,
          );
          await openWorksheet('bank', 'Problem Bank');
        } catch (e) {
          err.textContent = (e as Error).message;
          err.style.display = '';
          importBtn.disabled = false;
        }
      })();
    });
    listHost.appendChild(importBtn);
  };

  const importPath = async (filePath: string): Promise<void> => {
      const electron = (window as {
        parallxElectron?: {
          document?: { extractWorkbookGrid?(p: string): Promise<{ error?: { message: string }; sheets?: GridSheet[] }> };
          fs?: { readFile?(p: string): Promise<{ error?: { message: string }; content?: string; encoding?: string }> };
        };
      }).parallxElectron;
      // An .xlsx/.xlsm goes through the app's own reader (fs.readFile); only
      // the legacy .xls path needs the document extractor.
      const ooxml = /\.(xlsx|xlsm)$/i.test(filePath);
      if (!electron || (ooxml ? !electron.fs?.readFile : !electron.document?.extractWorkbookGrid)) {
        err.textContent = 'Excel import needs the desktop app.';
        err.style.display = '';
        return;
      }
      if (!filePath || disposed) return;
      const fileLabel = filePath.split(/[\\/]/).pop() || 'Workbook';
      status.textContent = `Reading ${fileLabel}…`;
      err.style.display = 'none';
      // The Problem Bank path first: our own reader keeps the formatting.
      if (electron.fs?.readFile && /\.(xlsx|xlsm)$/i.test(filePath)) {
        try {
          const read = await electron.fs.readFile(filePath);
          if (read?.error) throw new Error(read.error.message);
          if (read?.encoding === 'base64' && read.content) {
            const bin = atob(read.content);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const book = await openXlsx(bytes);
            const { problems } = await detectProblems(book, (done, total) => { status.textContent = `Reading ${fileLabel}: ${done} / ${total} problems…`; });
            if (disposed) return;
            if (problems.length > 0) {
              const timeline = await readWorkbookTimeline(book).catch(() => [] as WorkbookSnapshot[]);
              status.textContent = `${fileLabel}: ${problems.length} problems found${timeline.length ? `, ${timeline.length} days of history` : ''}.`;
              compactPicker();
              // A failure listing the problems is shown, never swallowed into the legacy path.
              try {
                await renderProblems(problems, filePath, fileLabel, timeline);
              } catch (e) {
                status.textContent = '';
                err.textContent = `Could not list the problems: ${(e as Error).message}`;
                err.style.display = '';
              }
              return;
            }
          }
        } catch (e) {
          console.warn('[Worksheet] problem-bank import fell back to sheet detection:', e);
        }
      }
      try {
        if (!electron.document?.extractWorkbookGrid) throw new Error('the document extractor is not available');
        const grid = await electron.document.extractWorkbookGrid(filePath);
        if (grid?.error) throw new Error(grid.error.message);
        const sheets = grid?.sheets ?? [];
        if (disposed) return;
        const { items, leftovers } = detectExcelItems(sheets, fileLabel.replace(/\.(xlsx|xlsm|xls)$/i, ''));
        const leftoverSheets = sheets.filter((s) => leftovers.includes(s.name));
        status.textContent = `${fileLabel}: ${sheets.length} sheets, ${items.length} items detected.`;
        compactPicker();
        renderSelection(items, leftoverSheets, filePath, fileLabel);
      } catch (e) {
        status.textContent = '';
        err.textContent = `Could not read the workbook: ${(e as Error).message}`;
        err.style.display = '';
      }
  };
  _importPaneHooks = { importPath };
  pickBtn.addEventListener('click', () => {
    void (async () => {
      const dialog = (window as { parallxElectron?: { dialog?: { openFile?(opts: unknown): Promise<string[] | null> } } }).parallxElectron?.dialog;
      if (!dialog?.openFile) { err.textContent = 'Excel import needs the desktop app.'; err.style.display = ''; return; }
      const res = await dialog.openFile({ title: 'Import practice problems', filters: [{ name: 'Excel Workbooks', extensions: ['xlsx', 'xlsm', 'xls'] }] });
      const filePath = Array.isArray(res) ? res[0] : undefined;
      if (filePath) await importPath(filePath);
    })();
  });
  if (_pendingImportPath) { const p = _pendingImportPath; _pendingImportPath = null; void importPath(p); }

  return {
    dispose: () => {
      disposed = true;
      if (_importPaneHooks?.importPath === importPath) _importPaneHooks = null;
      root.remove();
    },
  };
}

// ── Sheet panes (scratch + item player) ─────────────────────────────────────

function createSheetPane(container: HTMLElement, instanceId: string) {
  const itemId = instanceId.startsWith('item:') ? Number(instanceId.slice(5)) : null;

  const root = el('div', 'ws-pane');
  // flex: 0 0 auto or the sheet (flex:1) CRUSHES the header — the question
  // text vanished entirely in the e2e screenshot (resize-thrash lesson:
  // pin non-growing flex children).
  const headerHost = el('div', 'ws-pane__headerhost');
  const sheetHost = el('div', 'ws-pane__sheet');
  const loading = el('div', 'ws-pane__loading', 'Loading the practice sheet engine…');
  root.append(headerHost, loading, sheetHost);
  container.appendChild(root);

  let host: IWorksheetHost | null = null;
  /** Where the user was when the tab was switched away; applied once the engine has painted. */
  let pendingView: SheetViewState | null = null;
  const applyPendingView = (): void => {
    if (!pendingView || !host || disposed) return;
    host.restoreViewState(pendingView);
    pendingView = null;
  };
  let disposed = false;
  let item: WorksheetItem | null = null;
  let itemStarred = false;
  /** Resolves once the first sheet has painted (or the pane gave up), so the quiz can swap it in whole. */
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
  /** 'working' = user's attempt on screen; 'solution' = model solution. */
  let mode: 'working' | 'solution' = 'working';
  let revealed = false;
  /** Set by the problem tab: re-reads the solution's visibility from the live sheet. */
  let syncRevealFromSheet: (() => void) | null = null;
  let visibilitySub: { dispose(): void } | null = null;
  /** Set by a Problem Bank item: the first cell edit is the proof it was worked. */
  let onSheetEdited: (() => void) | null = null;
  let editedSub: { dispose(): void } | null = null;
  let autosaveTimer: ReturnType<typeof setInterval> | null = null;
  let lastSavedCells = '';
  /** Problem Bank items: time on the open attempt (-1 = not a problem item). */
  /** Study seconds on this problem, every sitting (the header clock); -1 before a problem is loaded. */
  let problemSeconds = -1;
  let studyTicker: { dispose(): void } | null = null;

  const captureWorking = (): IWorkbookData | null => {
    if (mode !== 'working') return null;
    return host?.getSnapshot() ?? null;
  };

  const persistWorking = async (): Promise<void> => {
    if (itemId == null) {
      const snap = captureWorking();
      if (snap) _scratchCache.set(instanceId, snap);
      return;
    }
    const snap = captureWorking();
    if (!snap) return;
    _workingCache.set(instanceId, snap);
    const json = JSON.stringify(snap);
    if (json === lastSavedCells) return;
    lastSavedCells = json;
    await saveAttemptCells(itemId, json, problemSeconds >= 0 ? problemSeconds : undefined).catch((err) => {
      console.error('[Worksheet] attempt autosave failed:', err);
    });
  };

  // The engine keeps normalising a freshly mounted sheet for a moment (rich
  // text cells gain document margins and render config), so a snapshot taken
  // right after mount differs from one taken a second later with no edit at
  // all. The autosave baseline is the snapshot once it has stopped moving;
  // otherwise merely opening a problem wrote an "attempt".
  const settledSnapshotJson = async (): Promise<string> => {
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

  const mountSheet = async (snapshot: IWorkbookData | null): Promise<void> => {
    const mod = await loadUniverModule();
    if (disposed) return;
    loading.remove();
    host?.dispose();
    sheetHost.replaceChildren();
    host = mod.createWorksheetHost({
      container: sheetHost, snapshot, darkMode: resolveSheetDark(), displayDecimals: getDisplayDecimals(),
      // Evidence for the intermittent formula failures: the journal keeps it.
      onFormulaError: (summary, detail) => { try { _api?.activity?.note('formula error', `${item?.title ?? instanceId}: ${summary}`, detail); } catch { /* no journal */ } },
      onEngineFault: (summary, detail) => { try { _api?.activity?.note('engine fault', `${item?.title ?? instanceId}: ${summary}`, detail); } catch { /* no journal */ } },
    });
    // Probe hook (tests/probes): the live host, reachable from the DOM.
    (sheetHost as unknown as { __wsHost?: unknown }).__wsHost = host;
    void host.whenRendered().then(() => { readyResolve(); applyPendingView(); });
    // Unhiding the solution columns by hand is the same act as Reveal
    // Solution: the button follows the sheet, whichever way the columns moved.
    visibilitySub?.dispose();
    visibilitySub = host.onColumnsVisibilityChanged(() => syncRevealFromSheet?.());
    editedSub?.dispose();
    editedSub = host.onEdited(() => onSheetEdited?.());
  };

  // Sheet appearance: re-skin the live engine when the setting changes
  // (toggle on any pane) or, in 'app' mode, when the workbench theme flips.
  let scratchThemeBtn: HTMLButtonElement | null = null;
  const applyAppearance = (appearance: SheetAppearance) => {
    host?.setDarkMode(resolveSheetDark(appearance));
    if (item) renderItemHeader();
    else if (scratchThemeBtn) paintSheetThemeButton(scratchThemeBtn);
  };
  _appearanceListeners.add(applyAppearance);
  const applyDecimals = (decimals: number | null) => host?.setDisplayDecimals(decimals);
  _decimalsListeners.add(applyDecimals);
  const modeObserver = new MutationObserver(() => {
    if (getSheetAppearance() === 'app') host?.setDarkMode(appIsDark());
  });
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-px-mode'] });

  const renderItemHeader = () => {
    if (!item) return;
    headerHost.replaceChildren();
    const header = el('div', 'ws-item__header');
    const titleRow = el('div', 'ws-item__titlerow');
    titleRow.appendChild(el('div', 'ws-item__title', item.title));
    const spacer = el('div'); spacer.style.flex = '1';
    titleRow.appendChild(spacer);

    titleRow.appendChild(starBtn(item.id, itemStarred, (on) => { itemStarred = on; }));
    titleRow.appendChild(makeSheetThemeButton());

    if (mode === 'working') {
      titleRow.appendChild(iconBtn('file-spreadsheet', 'Export to Excel', {
        hint: 'Saves this sheet as a real .xlsx, values and formulas, in your Downloads folder.',
        onClick: () => {
          const name = (item?.title || 'practice-sheet').replace(/[^\w\- ]+/g, '').trim() || 'practice-sheet';
          if (!host?.exportToXlsx(name)) {
            void _api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
          }
        },
      }));

      const resetBtn = iconBtn('rotate-ccw', 'Reset Sheet', { danger: true, hint: 'Restores the item to its original state. Cannot be undone.' });
      resetBtn.addEventListener('click', () => {
        void (async () => {
          const ok = await _api?.window?.showConfirmModal?.({
            message: 'Reset this sheet?',
            detail: 'Your work on this item is discarded and the sheet returns to its original state. This cannot be undone.',
            confirmLabel: 'Reset Sheet',
            danger: true,
          }) ?? false;
          if (!ok || disposed || !item) return;
          lastSavedCells = '';
          await discardOpenAttempt(item.id);
          await mountSheet(parseWorkbook(item.givensJson));
        })();
      });
      titleRow.appendChild(resetBtn);

      titleRow.appendChild(iconBtn('eye', 'Reveal Solution', { primary: true, hint: 'Shows the worked solution.', onClick: () => void revealSolution() }));
    } else {
      titleRow.appendChild(iconBtn('eye-off', 'Show My Work', { hint: 'Back to your own sheet.', onClick: () => void showWorking() }));
    }
    header.appendChild(titleRow);

    // New-style items carry the question ON the sheet (merged block per
    // part tab — Mufaro: "better to have them directly on the page");
    // legacy items still need it here or it would vanish.
    if (item.questionMd && !workbookHasOnSheetQuestion(item.givensJson)) {
      const q = el('div', 'ws-item__question');
      q.appendChild(renderMarkdown(item.questionMd));
      header.appendChild(q);
    }

    if (mode === 'solution') {
      const sol = el('div', 'ws-item__solutionbar');
      sol.appendChild(el('span', 'ws-item__solutiontag', 'Model Solution'));
      if (!revealed) {
        // First reveal this session: ask for the self grade.
        const gradeWrap = el('span', 'ws-item__grades');
        gradeWrap.appendChild(el('span', 'ws-item__gradeprompt', 'How did it go?'));
        for (const [grade, label] of [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']] as const) {
          const b = el('button', `px-btn px-btn--secondary px-btn--sm ws-grade ws-grade--${grade}`) as HTMLButtonElement;
          b.textContent = label;
          b.addEventListener('click', () => {
            void (async () => {
              if (!item) return;
              revealed = true;
              await completeAttempt(item.id, grade, lastSavedCells);
              _api?.activity?.note('practiced', `worksheet item "${item.title}"`, `self-graded ${label.toLowerCase()}`);
              renderItemHeader();
            })();
          });
          gradeWrap.appendChild(b);
        }
        sol.appendChild(gradeWrap);
      } else {
        const again = el('button', 'px-btn px-btn--secondary') as HTMLButtonElement;
        again.textContent = 'Try Again';
        again.title = 'Start a fresh attempt from the original sheet.';
        again.addEventListener('click', () => {
          void (async () => {
            if (!item) return;
            revealed = false;
            mode = 'working';
            lastSavedCells = '';
            await discardOpenAttempt(item.id);
            renderItemHeader();
            await mountSheet(parseWorkbook(item.givensJson));
          })();
        });
        sol.appendChild(again);
      }
      header.appendChild(sol);

      if (item.solutionNotesMd) {
        const notes = el('div', 'ws-item__solutionnotes');
        notes.appendChild(renderMarkdown(item.solutionNotesMd));
        header.appendChild(notes);
      }

      // M99 S6 — AI critique of the work vs the model solution. Feedback,
      // never a score: CAS grades method, and false precision misleads.
      const reviewWrap = el('div', 'ws-item__review');
      const reviewBtn = el('button', 'px-btn px-btn--secondary') as HTMLButtonElement;
      reviewBtn.textContent = 'Review in Chat';
      reviewBtn.title = 'Stages your cells, the model solution and a review brief in the chat. Add your question under the brief, then send.';
      const reviewOut = el('div', 'ws-item__reviewout');
      reviewOut.style.display = 'none';
      reviewBtn.addEventListener('click', () => {
        void (async () => {
          if (!item || !_api?.lm) return;
          if (!lastSavedCells.trim()) {
            reviewOut.style.display = '';
            reviewOut.textContent = 'There is no work on the sheet to review yet.';
            return;
          }
          reviewBtn.disabled = true;
          try {
            if (await reviewInChat(item, item.id, lastSavedCells) === 'chat') { reviewOut.style.display = 'none'; return; }
            // No chat surface: the one-shot review, in place.
            reviewBtn.textContent = 'Reviewing…';
            reviewOut.style.display = '';
            reviewOut.textContent = 'Reading your work…';
            const review = await reviewAttempt(_api.lm, item, lastSavedCells, (partial) => {
              reviewOut.textContent = partial;
            });
            reviewOut.replaceChildren(renderMarkdown(review));
            await saveAttemptReview(item.id, review);
            _api?.activity?.note('reviewed', `worksheet attempt on "${item.title}"`, 'AI method feedback saved');
          } catch (err) {
            reviewOut.style.display = '';
            reviewOut.textContent = `Review failed: ${(err as Error).message}`;
          } finally {
            reviewBtn.disabled = false;
            reviewBtn.textContent = 'Review in Chat';
          }
        })();
      });
      reviewWrap.append(reviewBtn, reviewOut);
      header.appendChild(reviewWrap);
    }

    headerHost.appendChild(header);
  };

  const revealSolution = async (): Promise<void> => {
    if (!item || mode === 'solution') return;
    await persistWorking();
    mode = 'solution';
    renderItemHeader();
    await mountSheet(parseWorkbook(item.solutionJson));
  };

  const showWorking = async (): Promise<void> => {
    if (!item || mode === 'working') return;
    mode = 'working';
    renderItemHeader();
    const open = await getOpenAttempt(item.id);
    const prior = open ? null : await getLatestWork(item.id);
    const snap = _workingCache.get(instanceId) ?? ((open ?? prior) ? parseWorkbook((open ?? prior)!.cellsJson) : null);
    await mountSheet(snap ?? parseWorkbook(item.givensJson));
  };

  // ── Problem Bank item: one sheet, the solution hidden until revealed ──
  // The sheet is the workbook's sheet. Columns from the solution marker on
  // are hidden; Reveal unhides them beside the work, Hide puts them away;
  // neither touches the student's cells. Rating is Easy, Medium or Hard,
  // any time; time on the attempt runs while the tab is on screen.
  type SheetShape = { columnCount?: number; columnData?: Record<number, { hd?: number; w?: number }>; cellData?: Record<number, Record<number, Record<string, unknown>>>; mergeData?: { startColumn: number; endColumn: number }[] };
  const firstSheet = (snap: IWorkbookData): SheetShape | null => (snap.sheets[snap.sheetOrder[0]] as unknown as SheetShape) ?? null;
  /** The pristine sheet: where its CONTENT ends (the solution ends there and
   *  the student works after it; a styled empty cell does not count, the
   *  banner rows run to BL) and which cells are its own, so the student's
   *  columns are known and never hidden (solutionVisibility.ts). */
  let pristine: PristineIndex = { content: new Set(), lastContentCol: -1 };
  let ratingCell: { row: number; col: number } | null = null;
  const readPristine = (problem: WorksheetItem): void => {
    const snap = parseWorkbook(problem.sheetJson) as IWorkbookData | null;
    const sheet = snap ? firstSheet(snap) : null;
    if (!sheet) return;
    pristine = indexPristine(sheet, problem.solutionCol);
    for (const [r, row] of Object.entries(sheet.cellData ?? {})) {
      if (Number(r) > 2) continue;
      for (const [c, cell] of Object.entries(row)) {
        // The workbook's own rating cell: "Self-Rating:" with the value beside it.
        if (typeof cell.v === 'string' && /^self-rating/i.test(cell.v.trim())) ratingCell = { row: Number(r), col: Number(c) + 1 };
      }
    }
  };
  /** The solution's columns to hide, as runs; the student's own columns are left out. */
  const solutionSegments = (snap: IWorkbookData): { start: number; last: number }[] => {
    if (!item || item.solutionCol < 0) return [];
    const sheet = firstSheet(snap);
    return sheet ? pureSolutionSegments(sheet, item.solutionCol, pristine) : [];
  };
  /** Rebuild visibility from the marker on: only the solution hides, never the
   *  student's columns, whatever an earlier snapshot had flagged. */
  const applySolutionVisibility = (snap: IWorkbookData, show: boolean): IWorkbookData => {
    if (!item || (item.solutionCol < 0 && item.solutionRow < 0)) return snap;
    const sheet = firstSheet(snap);
    if (sheet && item.solutionCol >= 0) pureApplySolutionVisibility(sheet, item.solutionCol, pristine, show);
    // A solution below the question hides by rows, from its "SOLUTION" row to the last row with content.
    if (sheet && item.solutionRow >= 0) {
      const rows = ((sheet as unknown as { rowData?: Record<number, { hd?: number }> }).rowData ??= {});
      const last = Math.max(item.solutionRow, ...Object.keys(sheet.cellData ?? {}).map(Number));
      for (let r = item.solutionRow; r <= last; r++) {
        if (!show) (rows[r] ??= {}).hd = 1;
        else if (rows[r]?.hd) delete rows[r].hd;
      }
    }
    return snap;
  };
  /** Show the current rating in the workbook's own rating cell. */
  const applyRatingCell = (snap: IWorkbookData, rating: string): IWorkbookData => {
    if (!ratingCell) return snap;
    const sheet = firstSheet(snap);
    if (!sheet) return snap;
    const row = ((sheet.cellData ??= {})[ratingCell.row] ??= {});
    const cell = (row[ratingCell.col] ??= {});
    cell.v = ratingLabel(rating) || 'Unrated';
    cell.t = 1;
    delete cell.p;
    return snap;
  };
  // `open` is the attempt in progress; `prior` is the last rated attempt's
  // sheet when nothing is in progress. Rating never takes the work away: the
  // sheet comes back as he left it, and the next edit starts a fresh attempt
  // (its own timer) from that sheet.
  const initProblem = async (problem: WorksheetItem, open: Awaited<ReturnType<typeof getOpenAttempt>>, prior: Awaited<ReturnType<typeof getLatestWork>> = null): Promise<void> => {
    problemSeconds = await getStudySecondsForItem(problem.id).catch(() => 0);
    readPristine(problem);
    let latestRating = '';
    /** The rating shown came in with the workbook, not from work done here. */
    let ratingImported = false;
    /** A cell on this sheet has been changed: the campaign counts it done. */
    let worked = false;
    /** The rating landing in its cell is a write on the sheet, not work. */
    let ratingWrite = false;
    let starred = false;
    const refreshRating = async () => {
      const summary = (await listItems().catch(() => [])).find((s) => s.id === problem.id);
      latestRating = summary ? normalizeRating(summary.attemptState) : '';
      ratingImported = summary?.ratingImported ?? false;
      worked = summary?.worked ?? false;
      starred = summary?.starred ?? false;
    };
    await refreshRating();
    const timerEl = el('span', 'ws-problem__timer', fmtSeconds(problemSeconds));
    timerEl.title = 'Study time on this problem, every sitting. Counts while it is on screen and you are active; idle stretches are taken back.';
    // The note on this problem, taken where the work is (Mufaro, 2026-09-21:
    // it lived only on the quiz overview, a screen away). One button on the
    // header opens the editor under it; saved on blur, kept across quizzes.
    let problemNote = (await getProblemNotes([problem.id]).catch(() => new Map<number, string>())).get(problem.id) ?? '';
    const noteHost = el('div', 'ws-item__note');
    noteHost.style.display = 'none';
    const noteArea = el('textarea', 'ws-quiz__notetext') as HTMLTextAreaElement;
    noteArea.placeholder = 'What to remember about this problem.';
    noteArea.value = problemNote;
    noteArea.setAttribute('aria-label', 'Note on this problem');
    noteArea.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') noteArea.blur(); });
    noteArea.addEventListener('blur', () => {
      const v = noteArea.value.trim();
      if (v === problemNote) return;
      problemNote = v;
      void setProblemNote(problem.id, v).catch(() => {});
      paintHeader();
    });
    noteHost.appendChild(noteArea);
    const header = el('div', 'ws-item__header');
    const titleRow = el('div', 'ws-item__titlerow');
    const paintHeader = () => {
      titleRow.replaceChildren();
      titleRow.appendChild(el('div', 'ws-item__title', problem.title));
      const meta = el('div', 'ws-problem__meta');
      const bits = [paperLabel(problem.paper), SOURCE_LABELS[problem.source] ?? '', KIND_LABELS[problem.kind] ?? '', problem.quadrant ? QUADRANT_LABELS[problem.quadrant] : ''].filter(Boolean);
      if (bits.length) meta.appendChild(el('span', undefined, bits.join(' · ')));
      titleRow.appendChild(meta);
      const spacer = el('div'); spacer.style.flex = '1';
      titleRow.appendChild(spacer);
      titleRow.appendChild(timerEl);
      // A rating carried in from the workbook is not a rating given here: it
      // never lights a button, because a lit button reads as "done" and the
      // work then goes uncounted (Mufaro, 2026-09-20). It is said in words
      // instead, beside a plain statement of whether the problem was worked.
      const ownRating = ratingImported ? '' : latestRating;
      // A lit button is the one sign of a rating given here; the chip speaks
      // only when the buttons cannot say it, in the accent, never a grade colour.
      const status = ownRating ? null
        : worked ? { text: 'Worked, not rated', cls: 'ws-chip--open', hint: ratingImported ? `Counts as done for the day. Your workbook rated this ${ratingLabel(latestRating)}; rate it here to score it and set when it comes back.` : 'Counts as done for the day. A rating scores it and sets when it comes back.' }
          : ratingImported ? { text: `${ratingLabel(latestRating)} in your workbook`, cls: 'ws-chip--muted', hint: 'Carried in with the import. It counts for the campaign once you work it here or rate it again.' }
            : null;
      if (status) {
        const chip = el('span', `ws-chip ${status.cls} ws-problem__status`, status.text);
        chip.title = status.hint;
        titleRow.appendChild(chip);
      }
      titleRow.appendChild(el('span', 'ws-vdiv'));
      // The rating is one choice of three: the switch. A click on the lit
      // one rates again (a later sitting), so the click is caught before the
      // switch decides it is no change.
      const rateWith = (grade: 'easy' | 'medium' | 'hard') => {
        void (async () => {
          await persistWorking();
          await completeAttempt(problem.id, grade, lastSavedCells, { seconds: problemSeconds, sessionId: quizSessionIdFor(problem.id) });
          _api?.activity?.note('practiced', `problem "${problem.title}"`, `rated ${ratingLabel(grade)}`);
          latestRating = grade;
          ratingImported = false;
          if (ratingCell) {
            ratingWrite = true;
            host?.setCellText(ratingCell.row, ratingCell.col, ratingLabel(grade));
            setTimeout(() => { ratingWrite = false; }, 100);
          }
          paintHeader();
        })();
      };
      const rate = createSegmented(titleRow, {
        ariaLabel: 'Rate this problem',
        items: (['easy', 'medium', 'hard'] as const).map((g) => ({ value: g, label: ratingLabel(g) })),
        value: ownRating || '',
        onChange: (v) => rateWith(v as 'easy' | 'medium' | 'hard'),
      });
      rate.element.classList.add('ws-rate');
      rate.element.title = 'Your rating feeds the dashboard and the quiz filters.';
      rate.element.addEventListener('click', (e) => {
        const seg = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
        if (seg?.classList.contains('ui-segmented-control__segment--active') && seg.dataset.value === ownRating) rateWith(ownRating as 'easy' | 'medium' | 'hard');
      }, true);
      titleRow.appendChild(el('span', 'ws-vdiv'));
      titleRow.appendChild(starBtn(problem.id, starred, (on) => { starred = on; }));
      // The flag belongs to a quiz: shown only while this problem is in the running one.
      if (_practice && _practice.ids.includes(problem.id)) titleRow.appendChild(markBtn(_practice, problem.id));
      const noteBtn = iconBtn('notebook-pen', problemNote ? 'Edit Note' : 'Add Note', {
        hint: problemNote || 'A note on this problem, kept with it across quizzes and shown in the bank.',
        onClick: () => { const open = noteHost.style.display === 'none'; noteHost.style.display = open ? '' : 'none'; if (open) noteArea.focus(); },
      });
      noteBtn.classList.toggle('ws-note--on', !!problemNote);
      noteBtn.setAttribute('aria-pressed', problemNote ? 'true' : 'false');
      titleRow.appendChild(noteBtn);
      if (problem.solutionCol >= 0 || problem.solutionRow >= 0) {
        // Revealing changes the whole sheet, so it says so in words.
        createButton(titleRow, {
          label: revealed ? 'Hide Solution' : 'Reveal Solution',
          icon: revealed ? 'eye-off' : 'eye',
          title: revealed ? 'Hides the worked solution again. Your work stays.' : 'Shows the worked solution beside your work, as in the workbook.',
          onClick: () => {
            void (async () => {
              const live = host?.getSnapshot();
              if (!live || !host) return;
              revealed = !revealed;
              // In place: the engine hides or shows the solution columns
              // itself, so the canvas, scroll and selection stay. The remount
              // remains only as the fallback when the engine refuses.
              const segs = solutionSegments(live);
              const h = host;
              const inPlace = segs.length > 0 && segs.every((seg) => h.setColumnsHidden(seg.start, seg.last - seg.start + 1, !revealed));
              if (!inPlace) await mountSheet(applySolutionVisibility(live, revealed));
              // Revealing is not work. With work on the sheet the column state
              // is saved alongside it; without any, the baseline moves instead,
              // so a look at the solution never writes an attempt.
              if (worked) { lastSavedCells = ''; await persistWorking(); }
              else lastSavedCells = JSON.stringify(host?.getSnapshot() ?? null);
              paintHeader();
            })();
          },
        });
      }
      // The rest of the sheet's tools, behind ⋯.
      const resetWork = async () => {
        const ok = await _api?.window?.showConfirmModal?.({
          message: 'Reset your work on this problem?',
          detail: 'Everything you typed on this sheet is discarded. Your ratings and study time are kept. This cannot be undone.',
          confirmLabel: 'Reset Work',
          danger: true,
        }) ?? false;
        if (!ok || disposed) return;
        lastSavedCells = '';
        _workingCache.delete(instanceId);
        await discardOpenAttempt(problem.id);
        await mountSheet(applyRatingCell(applySolutionVisibility(parseWorkbook(problem.sheetJson) as IWorkbookData, revealed), latestRating));
        lastSavedCells = await settledSnapshotJson();
      };
      const moreBtn = createIconButton(titleRow, { icon: 'ellipsis', title: 'More Actions' });
      moreBtn.addEventListener('click', () => {
        const dark = resolveSheetDark();
        showMenu(moreBtn, [
          { label: dark ? 'Light Sheet' : 'Dark Sheet', icon: dark ? 'sun' : 'moon', tooltip: 'Flips this practice sheet only. Light matches the real exam surface.', onSelect: () => void setSheetAppearance(dark ? 'light' : 'dark') },
          { label: 'Export to Excel', icon: 'file-spreadsheet', tooltip: 'Saves this sheet as a real .xlsx, values and formulas, in your Downloads folder.', onSelect: () => {
            const name = (problem.sheetName || problem.title || 'problem').replace(/[^\w\- .]+/g, '').trim() || 'problem';
            if (!host?.exportToXlsx(name)) void _api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
          } },
          ...(instanceId.startsWith('item:') && _practice?.ids.includes(problem.id) ? [{ label: 'Open Problem in Its Own Tab', icon: 'file-spreadsheet', onSelect: () => void openWorksheet(`item:${problem.id}`, problem.title) }] : []),
          { label: 'Show in Problem Bank', icon: 'library', onSelect: () => void openWorksheet('bank', 'Problem Bank') },
          { separator: true },
          { label: 'Reset Work…', icon: 'rotate-ccw', danger: true, tooltip: 'Clears your work and the timer; the problem returns to the sheet as imported. Ratings stay.', onSelect: () => void resetWork() },
        ]);
      });
      header.replaceChildren(titleRow, noteHost);
      if (revealed && _api?.lm) {
        const reviewWrap = el('div', 'ws-item__review');
        const reviewBtn = el('button', 'px-btn px-btn--secondary') as HTMLButtonElement;
        reviewBtn.textContent = 'Review in Chat';
        reviewBtn.title = 'Stages your cells, the worked solution and a review brief in the chat. Add your question under the brief, then send.';
        const reviewOut = el('div', 'ws-item__reviewout');
        reviewOut.style.display = 'none';
        reviewBtn.addEventListener('click', () => {
          void (async () => {
            if (!_api?.lm) return;
            await persistWorking();
            reviewBtn.disabled = true;
            try {
              const reviewItem = { ...problem, solutionJson: problem.sheetJson };
              if (await reviewInChat(reviewItem, problem.id, lastSavedCells) === 'chat') { reviewOut.style.display = 'none'; return; }
              // No chat surface: the one-shot review, in place.
              reviewBtn.textContent = 'Reviewing…';
              reviewOut.style.display = '';
              reviewOut.textContent = 'Reading your work…';
              const review = await reviewAttempt(_api.lm, reviewItem, lastSavedCells, (partial) => { reviewOut.textContent = partial; });
              reviewOut.replaceChildren(renderMarkdown(review));
              await saveAttemptReview(problem.id, review);
            } catch (e) {
              reviewOut.style.display = '';
              reviewOut.textContent = `Review failed: ${(e as Error).message}`;
            } finally {
              reviewBtn.disabled = false;
              reviewBtn.textContent = 'Review in Chat';
            }
          })();
        });
        reviewWrap.append(reviewBtn, reviewOut);
        header.appendChild(reviewWrap);
      }
    };
    headerHost.replaceChildren(header);
    syncRevealFromSheet = () => {
      if (disposed || !host) return;
      const live = host.getSnapshot();
      if (!live) return;
      const segs = solutionSegments(live);
      if (segs.length === 0) return;
      const columnData = firstSheet(live)?.columnData ?? {};
      let hidden = 0;
      for (const seg of segs) for (let c = seg.start; c <= seg.last; c++) if (columnData[c]?.hd) hidden++;
      const nowRevealed = hidden === 0;
      if (nowRevealed === revealed) return;
      revealed = nowRevealed;
      paintHeader();
      if (worked) { lastSavedCells = ''; void persistWorking(); }
      else lastSavedCells = JSON.stringify(host?.getSnapshot() ?? null);
    };
    paintHeader();
    const carried = open ?? prior;
    const base = _workingCache.get(instanceId) ?? (carried ? (parseWorkbook(carried.cellsJson) as IWorkbookData | null) : null);
    await mountSheet(applyRatingCell(applySolutionVisibility((base ?? parseWorkbook(problem.sheetJson)) as IWorkbookData, revealed), latestRating));
    // Baseline = what the sheet holds once the engine has settled after the
    // mount, so merely reopening a problem (rated or not) starts no new attempt.
    lastSavedCells = await settledSnapshotJson();
    if (disposed) return;
    // Work is what the campaign counts, not the rating alone. The first cell
    // edit records it, so a problem that arrived carrying its workbook rating
    // still closes out the day once it has actually been done. Armed only
    // now, after the engine has settled, so nothing the mount does counts.
    onSheetEdited = () => {
      if (disposed || worked || ratingWrite) return;
      worked = true;
      void (async () => {
        await persistWorking();
        await markAttemptWorked(problem.id, problemSeconds >= 0 ? problemSeconds : undefined).catch(() => {});
        if (!disposed) paintHeader();
      })();
    };
    autosaveTimer = setInterval(() => { void persistWorking(); }, AUTOSAVE_MS);
    // The study clock: elapsed time on screen while active, whatever the
    // cells do; flushed to the ledger every half minute and at teardown,
    // which announces the change so the dashboard's day catches up.
    studyTicker?.dispose();
    studyTicker = createStudyTicker({
      visible: () => !disposed && paneOnScreen(root),
      idleMs: getIdleMinutes() * 60_000,
      credit: (secs, final) => { void addStudySeconds(dayKey(Date.now()), problem.id, quizSessionIdFor(problem.id) ?? '', secs, final).catch(() => {}); },
      onTotal: (delta) => { problemSeconds = Math.max(0, problemSeconds + delta); timerEl.textContent = fmtSeconds(problemSeconds); },
    });
  };

  void (async () => {
    try {
      if (itemId != null) {
        item = await getItem(itemId);
        if (!item) {
          loading.textContent = 'This practice item no longer exists.';
          readyResolve();
          return;
        }
        if (item.sheetJson) {
          const open = await getOpenAttempt(itemId);
          await initProblem(item, open, open ? null : await getLatestWork(itemId));
          return;
        }
        itemStarred = (await getStarred([itemId]).catch(() => new Set<number>())).has(itemId);
        renderItemHeader();
        const open = await getOpenAttempt(itemId);
        const prior = open ? null : await getLatestWork(itemId);
        const snap = _workingCache.get(instanceId) ?? ((open ?? prior) ? parseWorkbook((open ?? prior)!.cellsJson) : null);
        await mountSheet(snap ?? parseWorkbook(item.givensJson));
        // Baseline = what the sheet holds RIGHT AFTER mount. Autosave only
        // writes when the snapshot moves off this baseline — without it,
        // merely opening an item wrote the givens as an "attempt" and
        // flagged it In Progress forever (M99 review).
        lastSavedCells = await settledSnapshotJson();
        if (disposed) return;
        autosaveTimer = setInterval(() => { void persistWorking(); }, AUTOSAVE_MS);
      } else {
        // Scratch sheet: a slim bar so export is reachable without an item.
        const bar = el('div', 'ws-scratchbar');
        bar.appendChild(el('span', 'ws-scratchbar__label', 'Scratch Sheet'));
        const spacer = el('div'); spacer.style.flex = '1';
        bar.appendChild(spacer);
        scratchThemeBtn = makeSheetThemeButton();
        bar.appendChild(scratchThemeBtn);
        bar.appendChild(iconBtn('file-spreadsheet', 'Export to Excel', {
          hint: 'Saves this sheet as a real .xlsx, values and formulas, in your Downloads folder.',
          onClick: () => {
            if (!host?.exportToXlsx('scratch-sheet')) {
              void _api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
            }
          },
        }));
        headerHost.appendChild(bar);
        await mountSheet(_scratchCache.get(instanceId) ?? null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      loading.textContent = `The sheet engine failed to load: ${message}`;
      readyResolve();
      console.error('[Worksheet] engine load failed:', err);
    }
  })();

  return {
    // One live engine per window: the sheet is torn down when its tab is
    // switched away and rebuilt on return. The engine keeps module-level
    // state that every live instance in the window shares, and it is built
    // for one instance per page; hidden instances are where the shared
    // caches, the focus tracking and the render loops crossed (2026-09-17).
    retainOnHide: false,
    saveViewState: () => {
      void persistWorking();
      return { instanceId, view: host?.getViewState() ?? null };
    },
    ready,
    restoreViewState: (state: unknown) => {
      // Content rides SQLite and the working cache, applied in the async init
      // above; the place on the sheet rides here.
      const view = (state as { view?: SheetViewState | null } | null)?.view ?? null;
      if (!view) return;
      pendingView = view;
      applyPendingView();
    },
    dispose: () => {
      readyResolve();
      if (autosaveTimer) clearInterval(autosaveTimer);
      studyTicker?.dispose();
      studyTicker = null;
      // Capture-before-teardown so close-without-save cannot drop work.
      void persistWorking();
      disposed = true;
      _appearanceListeners.delete(applyAppearance);
      _decimalsListeners.delete(applyDecimals);
      visibilitySub?.dispose();
      editedSub?.dispose();
      modeObserver.disconnect();
      host?.dispose();
      host = null;
      root.remove();
    },
  };
}

// ── Open helper ─────────────────────────────────────────────────────────────

/** Each Worksheets tab carries the icon of its Home card, so two tabs never
 *  look alike (the app's Dashboard and this one, the builder and a quiz). */
const TAB_ICONS: Record<string, string> = {
  home: 'table', dashboard: 'gauge', bank: 'library', quizzes: 'list-checks', practice: 'plus',
  'practice-run': 'list-checks', settings: 'settings', create: 'sparkles', 'excel-import': 'folder-input', scratch: 'table-2',
};
function tabIconHtml(instanceId: string): string {
  const id = TAB_ICONS[instanceId] ?? (instanceId.startsWith('item:') ? 'file-spreadsheet' : 'table');
  try { return _api?.icons?.createIconHtml?.(id, 14) || WS_ICON_SVG; } catch { return WS_ICON_SVG; }
}

async function openWorksheet(instanceId: string, title: string): Promise<void> {
  await _api?.editors.openEditor({
    typeId: 'worksheet',
    title,
    iconHtml: tabIconHtml(instanceId),
    instanceId,
  });
}

/** The day's other quest: the flashcards extension's due cards. */
function studyFlashcards(): void {
  const cmds = (_api as unknown as { commands?: { executeCommand?: (id: string) => Promise<unknown> } } | null)?.commands;
  if (cmds?.executeCommand) void cmds.executeCommand('flashcards.study').catch(() => void _api?.window?.showInformationMessage?.('Flashcards is not available in this workspace.'));
}

/** The page every Worksheets tab links back to. */
const BACK_TO_HOME: IKitAction = { label: 'Worksheets', onClick: () => void openWorksheet('home', 'Worksheets') };
const openBuilder = () => void openWorksheet('practice', 'New Quiz');
/** The quiz tab: one tab for the running quiz, named after it. */
const openQuizTab = () => void openWorksheet('practice-run', _practice?.name || 'Quiz');

/** The app's menu, anchored under a button, icons from the registry. */
function showMenu(anchor: HTMLElement, items: IExtensionMenuItem[]): void {
  showExtensionContextMenu(anchor, items, { anchorPosition: 'below' }, (icon, c) => c.appendChild(createIconElement(icon, 14)));
}

// ── Activation ──────────────────────────────────────────────────────────────

async function runMigrations(): Promise<void> {
  const electron = (window as {
    parallxElectron?: {
      database?: { isOpen(): Promise<{ isOpen: boolean }>; migrate(dir: string): Promise<{ error: { message: string } | null }> };
      appPath?: string; platform?: string;
    };
  }).parallxElectron;
  if (!electron?.database || !electron.appPath) {
    console.warn('[Worksheet] Cannot run migrations — database or appPath not available');
    return;
  }
  const status = await electron.database.isOpen();
  if (!status.isOpen) {
    console.warn('[Worksheet] Database not open — skipping migrations');
    return;
  }
  const sep = electron.platform === 'win32' ? '\\' : '/';
  const migrationsDir = [electron.appPath, 'src', 'built-in', 'worksheet', 'migrations'].join(sep);
  const result = await electron.database.migrate(migrationsDir);
  if (result.error) console.error('[Worksheet] Migration failed:', result.error.message);
}

export async function activate(api: ParallxApiLike, context: ToolContextLike): Promise<void> {
  _api = api;
  // Route SQL through the IDatabaseService tool bridge so worksheet writes
  // land on the unified data stream (STANDARDIZATION.md P2).
  if (api.services?.has(IDatabaseService)) {
    attachWorksheetDatabase(
      api.services.get<import('../../services/serviceTypes.js').IDatabaseService>(IDatabaseService).asBridge(),
    );
  }
  await runMigrations();

  context.subscriptions.push(
    api.editors.registerEditorProvider('worksheet', {
      createEditorPane: (container: HTMLElement, input?: { id?: string; instanceId?: string }) => {
        // Provenance contract (M98 lesson): key on instanceId, never parse
        // the namespaced input.id.
        const instanceId = input?.instanceId ?? input?.id ?? 'home';
        if (instanceId === 'home') return createLauncherPane(container);
        if (instanceId === 'bank') return createBankPane(container);
        if (instanceId === 'settings') return createSettingsPane(container);
        if (instanceId === 'create') return createGeneratePane(container);
        if (instanceId === 'excel-import') return createExcelImportPane(container);
        if (instanceId === 'practice') return createPracticeConfigPane(container);
        if (instanceId === 'practice-run') return createPracticeRunPane(container, input as { setName?(name: string): void } | undefined);
        if (instanceId === 'quizzes') return createQuizzesPane(container);
        if (instanceId === 'dashboard') {
          return createDashboardPane(container, {
            openItem: (id, title) => void openWorksheet(`item:${id}`, title),
            startQuiz: (ids, startAt, name) => startQuizWith(ids, startAt, name),
            resumeQuiz: () => openQuizTab(),
            openQuiz: (id) => void openPastQuiz(id),
            renderIcon: (id, size) => { try { return _api?.icons?.createIconHtml?.(id, size) ?? ''; } catch { return ''; } },
            configureQuiz: (preset) => { _quizPreset = preset; openBuilder(); },
            importWorkbook: () => void openWorksheet('excel-import', 'Import Workbook'),
            openSettings: () => void openWorksheet('settings', 'Worksheets Settings'),
            openHome: () => BACK_TO_HOME.onClick(),
            examDate: () => getExamDate(),
            xpCashRate: () => getXpCashRate(),
            cashOut: async (xp, cents) => {
              const dollars = (cents / 100).toFixed(2);
              const ok = await _api?.window?.showConfirmModal?.({
                message: `Cash out ${xp} XP for $${dollars}?`,
                detail: 'Pay yourself, then this records it. The XP stays on your level; only what is left to cash out goes down.',
                confirmLabel: 'Cash Out',
              }) ?? true;
              if (!ok) return;
              await recordXpCashout(xp, cents);
              _api?.activity?.note('cashed out', `${xp} XP for $${dollars}`);
            },
            studyFlashcards: () => studyFlashcards(),
          });
        }
        return createSheetPane(container, instanceId);
      },
    }),
  );

  context.subscriptions.push(
    api.views.registerViewProvider('view.worksheet', {
      createView: (container: HTMLElement) => createSidebarView(container),
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('worksheet.open', () => openWorksheet('home', 'Worksheets')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.openScratch', () => openWorksheet('scratch', 'Scratch Sheet')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.generate', () => openWorksheet('create', 'Generate Items')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.importExcel', async (filePath?: unknown) => {
      await openWorksheet('excel-import', 'Import Workbook');
      if (typeof filePath === 'string' && filePath) {
        if (_importPaneHooks) void _importPaneHooks.importPath(filePath);
        else _pendingImportPath = filePath;
      }
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.practice', () => openWorksheet('practice', 'New Quiz')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.dashboard', () => openWorksheet('dashboard', 'Study Dashboard')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.quizzes', () => openWorksheet('quizzes', 'Quizzes')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.bank', () => openWorksheet('bank', 'Problem Bank')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.settings', () => openWorksheet('settings', 'Worksheets Settings')),
  );

  // The AI's read surface: bank/progress + the user's actual sheet work.
  registerWorksheetChatTools(api, context.subscriptions);
}

export function deactivate(): void {
  _api = null;
  _scratchCache.clear();
}
