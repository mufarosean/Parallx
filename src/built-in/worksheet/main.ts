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
import type { IWorksheetHost } from './univerHost.js';
import { renderMarkdown } from '../../ui/renderMarkdown.js';
import {
  listItems, getItem, createItem, deleteItem, getOpenAttempt, getLatestWork, saveAttemptCells,
  discardOpenAttempt, completeAttempt, saveAttemptReview, onWorksheetDataChanged,
  getSessionGrades, attachWorksheetDatabase, recordImportedRating, upsertProgressSnapshot,
  getCampaign, startCampaign, endCampaign, listCompletedAttempts,
  getOpenQuizSession, saveQuizSession, finishQuizSession, finishOpenQuizSessions,
  getQuizSession, listQuizSessions, getSessionItemStates, getProblemNotes, setProblemNote, setItemStarred, getStarred,
  type WorksheetItem, type WorksheetItemSummary,
} from './worksheetData.js';
import { openXlsx } from './ooxml.js';
import { detectProblems, readWorkbookTimeline, normalizeRating, ratingLabel, paperLabel, SOURCE_LABELS, KIND_LABELS, QUADRANT_LABELS, type ProblemImport, type WorkbookSnapshot } from './problemImport.js';
import { createDashboardPane } from './dashboardPane.js';
import { planCampaign, campaignProgress, addDays, spanDays, workingDays, restDaysLabel, isCampaignProblem, WEEKDAY_LABELS } from './campaign.js';
import { parseDisplayDecimals, DISPLAY_DECIMALS_CHOICES, DEFAULT_DISPLAY_DECIMALS } from './displayNumbers.js';
import { indexPristine, solutionSegments as pureSolutionSegments, applySolutionVisibility as pureApplySolutionVisibility, type PristineIndex } from './solutionVisibility.js';
import { syncRewards } from './rewardsSync.js';
import { dayKey } from './progressInsights.js';
import { IDatabaseService } from '../../services/serviceTypes.js';
import { buildPracticeSet, itemTags } from './practiceSession.js';
import { itemToWorkbooks, workbookHasOnSheetQuestion, type GeneratedItem } from './itemFormat.js';
import { generateItems, reviewAttempt, buildReviewRequest, type LmApiLike } from './worksheetAi.js';
import { registerWorksheetChatTools } from './worksheetChat.js';
import { detectExcelItems, wholeSheetItem, type GridSheet, type ExcelItem } from './excelImport.js';
import './worksheet.css';

// ── API typings (structural — the tool API surface) ─────────────────────────

// ── Review in Chat ──────────────────────────────────────────────────────────
// The learner's cells and the model solution go to the chat as an attached
// context chip, with the review brief as the message, so the feedback streams
// in the conversation and follow-up questions have the work in front of them
// (Mufaro, 2026-09-08: the one-shot panel left nowhere to ask further). Returns
// 'inline' when the chat surface is not there, so the caller can fall back to
// the one-shot review. An empty sheet throws before anything is sent.
async function reviewInChat(
  item: { title: string; questionMd: string; solutionJson: string; solutionNotesMd: string },
  itemId: number,
  cellsJson: string,
): Promise<'chat' | 'inline'> {
  const req = buildReviewRequest(item, cellsJson);
  const cmds = _api?.commands;
  if (!cmds?.executeCommand) return 'inline';
  try {
    await cmds.executeCommand('chat.addSelectionContext', {
      kind: 'selection',
      id: `worksheet:item/${itemId}/work/${Date.now()}`,
      name: `${item.title}: my work`,
      fullPath: `worksheet:item/${itemId}`,
      isImplicit: false,
      selectedText: req.context,
      surface: 'worksheet',
    });
    await cmds.executeCommand('chat.submitPrompt', { text: req.prompt });
  } catch {
    return 'inline';
  }
  _api?.activity?.note('reviewed', `worksheet attempt on "${item.title}"`, 'sent to chat for method feedback');
  return 'chat';
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
  const b = el('button', `ws-btn ws-btn--icon${opts.primary ? ' ws-btn--primary' : ''}${opts.danger ? ' ws-btn--danger' : ''}`) as HTMLButtonElement;
  b.type = 'button';
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
  createWorksheetHost(opts: { container: HTMLElement; snapshot?: IWorkbookData | null; darkMode?: boolean; displayDecimals?: number | null; onFormulaError?: (summary: string, detail: string) => void }): IWorksheetHost;
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

/** A page title whose explanation lives in its tooltip, so the page stays quiet. */
function titled(text: string, hint: string): HTMLElement {
  const t = el('div', 'ws-home__title', text);
  t.title = hint;
  return t;
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

  const render = async () => {
    if (disposed) return;
    const items = await listItems().catch(() => []);
    if (disposed) return;
    root.replaceChildren();

    const head = el('div', 'ws-home__head');
    head.appendChild(titled('Problem Bank', 'Every problem by paper. Open a paper for its problems; click one to practice it.'));
    root.appendChild(head);

    if (items.length === 0) {
      const empty = el('div', 'ws-empty');
      empty.appendChild(el('div', 'ws-empty__headline', 'No practice items yet'));
      empty.appendChild(el('div', 'ws-empty__hint',
        'Click Generate Items to turn a PDF or pasted material into worked practice items with model solutions. The scratch sheet gives you the exam-faithful grid any time.'));
      root.appendChild(empty);
      return;
    }

    // One row per problem, but only inside the paper you open: 331 rows in
    // a flat list is the workbook's 331 tabs all over again.
    const itemRow = (item: WorksheetItemSummary, withDelete: boolean): HTMLElement => {
      const row = el('div', 'ws-itemrow');
      const info = el('div', 'ws-itemrow__info');
      const titleRow = el('div', 'ws-itemrow__title', item.title);
      if (item.attemptState === 'open') titleRow.appendChild(el('span', 'ws-chip ws-chip--open', 'In Progress'));
      else if (item.attemptState) titleRow.appendChild(el('span', `ws-chip ws-chip--${stateClass(item.attemptState)}`, gradeLabel(item.attemptState)));
      info.appendChild(titleRow);
      const meta: string[] = [];
      if (item.paper) meta.push([SOURCE_LABELS[item.source] ?? '', KIND_LABELS[item.kind] ?? '', item.quadrant ? QUADRANT_LABELS[item.quadrant] : ''].filter(Boolean).join(' · '));
      else if (item.sourceLabel) meta.push(item.sourcePage > 0 ? `${item.sourceLabel} · p.${item.sourcePage}` : item.sourceLabel);
      if (!item.paper && item.tags) meta.push(item.tags.split(',').filter(Boolean).map((t) => `#${t.trim()}`).join(' '));
      if (item.attemptCount > 0) meta.push(`${item.attemptCount} ${item.attemptCount === 1 ? 'attempt' : 'attempts'}`);
      if (item.seconds > 0) meta.push(fmtSeconds(item.seconds));
      if (item.lastAttemptAt > 0) meta.push(`last ${new Date(item.lastAttemptAt).toLocaleDateString()}`);
      info.appendChild(el('div', 'ws-itemrow__meta', meta.join(' · ')));
      info.addEventListener('click', () => void openWorksheet(`item:${item.id}`, item.title));
      row.appendChild(starBtn(item.id, item.starred));
      row.appendChild(info);
      const actions = el('div', 'ws-itemrow__actions');
      const openBtn = el('button', 'ws-btn') as HTMLButtonElement;
      openBtn.textContent = 'Practice';
      openBtn.addEventListener('click', () => void openWorksheet(`item:${item.id}`, item.title));
      actions.appendChild(openBtn);
      if (withDelete) {
        const delBtn = el('button', 'ws-btn ws-btn--danger') as HTMLButtonElement;
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => {
          void (async () => {
            const ok = await _api?.window?.showConfirmModal?.({
              message: `Delete "${item.title}"?`,
              detail: 'This permanently deletes the item, its solution, and every attempt. This cannot be undone.',
              confirmLabel: 'Delete Item',
              danger: true,
            }) ?? false;
            if (ok) await deleteItem(item.id);
          })();
        });
        actions.appendChild(delBtn);
      }
      row.appendChild(actions);
      return row;
    };

    // Search and filters live here now; the sidebar only navigates.
    root.appendChild(bankFilterBar(items, () => void render()));
    const filtering = _bankFilter !== 'all' || !!_bankQuery;
    const problems = items.filter((it) => it.paper && bankMatches(it, _bankFilter, _bankQuery));
    const generated = items.filter((it) => !it.paper);
    const byPaper = new Map<string, WorksheetItemSummary[]>();
    for (const it of problems) { if (!byPaper.has(it.paper)) byPaper.set(it.paper, []); byPaper.get(it.paper)!.push(it); }
    const list = el('div', 'ws-home__list');
    for (const [key, group] of [...byPaper.entries()].sort((a, b) => paperLabel(a[0]).localeCompare(paperLabel(b[0])))) {
      const rated = group.filter((it) => normalizeRating(it.attemptState)).length;
      const secs = group.reduce((n, it) => n + it.seconds, 0);
      const head = el('div', 'ws-home__paper');
      head.setAttribute('role', 'button');
      head.appendChild(el('span', 'ws-home__papername', paperLabel(key)));
      const bar = el('div', 'ws-bank__bar');
      for (const cls of ['easy', 'medium', 'hard'] as const) {
        const n = group.filter((it) => stateClass(it.attemptState) === cls).length;
        if (n === 0) continue;
        const seg = el('span', cls);
        seg.style.width = `${(n / group.length) * 100}%`;
        bar.appendChild(seg);
      }
      head.appendChild(bar);
      head.appendChild(el('span', 'ws-home__papermeta', `${rated} of ${group.length} rated${secs > 0 ? ` · ${fmtSeconds(secs)}` : ''}`));
      head.addEventListener('click', () => { if (_homeOpen.has(key)) _homeOpen.delete(key); else _homeOpen.add(key); void render(); });
      list.appendChild(head);
      if (filtering || _homeOpen.has(key)) {
        const rows = el('div', 'ws-home__paperitems');
        for (const it of group) rows.appendChild(itemRow(it, false));
        list.appendChild(rows);
      }
    }
    if (generated.length > 0) {
      const head = el('div', 'ws-home__paper ws-home__paper--generated');
      head.setAttribute('role', 'button');
      head.appendChild(el('span', 'ws-home__papername', 'Generated Items'));
      head.appendChild(el('span', 'ws-home__papermeta', `${generated.length} · not part of the workbook bank`));
      head.addEventListener('click', () => { if (_homeOpen.has('__generated')) _homeOpen.delete('__generated'); else _homeOpen.add('__generated'); void render(); });
      list.appendChild(head);
      if (_homeOpen.has('__generated')) {
        const rows = el('div', 'ws-home__paperitems');
        const clear = el('button', 'ws-btn ws-btn--danger') as HTMLButtonElement;
        clear.textContent = 'Delete All Generated Items';
        clear.addEventListener('click', () => { void deleteGeneratedItems(generated); });
        rows.appendChild(clear);
        for (const it of generated) rows.appendChild(itemRow(it, true));
        list.appendChild(rows);
      }
    }
    root.appendChild(list);
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
let _bankFilter = 'all';
let _bankQuery = '';

function bankMatches(item: WorksheetItemSummary, filter: string, query: string): boolean {
  const state = stateClass(item.attemptState);
  if (filter === 'starred' && !item.starred) return false;
  if (filter === 'incomplete' && !(item.attemptCount === 0 || item.attemptState === 'open')) return false;
  if ((filter === 'easy' || filter === 'medium' || filter === 'hard') && state !== filter) return false;
  if ((filter === 'rf' || filter === 'cas') && item.source !== filter) return false;
  if ((filter === 'quant' || filter === 'qual' || filter === 'essay') && item.kind !== filter) return false;
  if (query) {
    const q = query.toLowerCase();
    const hay = `${item.title} ${item.sheetName} ${item.questionMd} ${paperLabel(item.paper)}`.toLowerCase();
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

/** Search and filter chips for the Problem Bank page; the sidebar only navigates. */
function bankFilterBar(items: WorksheetItemSummary[], onChange: () => void): HTMLElement {
  const bar = el('div', 'ws-home__filters');
  const search = el('input', 'ws-input ws-bank__search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search problems';
  search.value = _bankQuery;
  search.setAttribute('aria-label', 'Search problems');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { _bankQuery = search.value.trim(); onChange(); }, 120);
  });
  bar.appendChild(search);
  const filters = el('div', 'ws-bank__filters');
  const FILTERS: [string, string][] = [['all', 'All'], ['starred', 'Starred'], ['incomplete', 'Incomplete'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['rf', 'RF'], ['cas', 'CAS'], ['quant', 'Quant'], ['qual', 'Qual'], ['essay', 'Essay']];
  const present = new Set<string>();
  for (const it of items) { present.add(it.source); present.add(it.kind); }
  for (const [value, label] of FILTERS) {
    if ((value === 'rf' || value === 'cas' || value === 'quant' || value === 'qual' || value === 'essay') && !present.has(value)) continue;
    const b = el('button', 'ws-bank__filter') as HTMLButtonElement;
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', _bankFilter === value ? 'true' : 'false');
    b.addEventListener('click', () => { _bankFilter = value; onChange(); });
    filters.appendChild(b);
  }
  bar.appendChild(filters);
  const problems = items.filter((it) => it.paper);
  const shown = problems.filter((it) => bankMatches(it, _bankFilter, _bankQuery));
  const rated = problems.filter((it) => normalizeRating(it.attemptState)).length;
  bar.appendChild(el('span', 'ws-home__summary', `${shown.length} of ${problems.length} · ${rated} rated`));
  return bar;
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
        row.appendChild(el('span', `ws-bank__dot ${stateClass(it.attemptState)}`));
        row.appendChild(el('span', 'ws-bank__itemtitle', it.title));
        const secs = it.seconds > 0 ? ` · ${fmtSeconds(it.seconds)}` : '';
        row.title = `${it.title}${it.attemptState ? ` · ${it.attemptState === 'open' ? 'In Progress' : gradeLabel(it.attemptState)}` : ''}${secs}`;
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
    const navItem = (label: string, instanceId: string, tabTitle: string, tip: string) => {
      const b = el('button', 'ws-nav__item', label) as HTMLButtonElement;
      b.type = 'button';
      b.title = tip;
      b.addEventListener('click', () => void openWorksheet(instanceId, tabTitle));
      nav.appendChild(b);
    };
    navItem('Home', 'home', 'Worksheets', 'Quiz, dashboard, bank, import, generate, scratch sheet');
    navItem('Dashboard', 'dashboard', 'Dashboard', 'Progress, pace, the campaign, what to work on next');
    navItem('Settings', 'settings', 'Worksheets Settings', 'The campaign and the sheet appearance');
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
      listCompletedAttempts().catch(() => []),
    ]);
    if (disposed || seq !== renderSeq) return;
    root.replaceChildren();
    root.appendChild(el('div', 'ws-home__title', 'Worksheets'));
    const grid = el('div', 'ws-launch__grid');
    const tile = (title: string, desc: string, instanceId: string, tabTitle: string, primary = false, onClick?: () => void) => {
      const b = el('button', primary ? 'ws-launch__tile ws-launch__tile--primary' : 'ws-launch__tile') as HTMLButtonElement;
      b.type = 'button';
      b.appendChild(el('span', 'ws-launch__tiletitle', title));
      b.appendChild(el('span', 'ws-launch__tiledesc', desc));
      b.addEventListener('click', onClick ?? (() => void openWorksheet(instanceId, tabTitle)));
      grid.appendChild(b);
    };
    const problems = items.filter((it) => it.paper);
    const rated = problems.filter((it) => normalizeRating(it.attemptState)).length;
    let dashDesc = 'Progress, pace, what to work on next.';
    const rewards = await syncRewards(items, attempts, campaign).catch(() => null);
    if (disposed || seq !== renderSeq) return;
    if (campaign) {
      const p = campaignProgress(campaign, items, attempts, Date.now(), rewards?.bonusXp ?? 0);
      dashDesc = p.finished ? 'Campaign complete.' : p.restToday ? `Day ${p.dayIndex} of ${campaign.days} · rest day` : `Day ${p.dayIndex} of ${campaign.days} · ${p.doneToday} of ${p.target} today`;
    }
    tile('Start Quiz', 'Draw problems from the bank and work them in order.', 'practice', 'Quiz', true);
    // Starred: the student's own set, every one of them, in bank order.
    const starred = items.filter((it) => it.starred);
    tile('Quiz Starred', starred.length ? `${starred.length} starred · every one of them, in order.` : 'Star problems from their sheet; they collect here.', 'bank', 'Problem Bank', false,
      () => { if (starred.length) startQuizWith(starred.map((it) => it.id)); else void openWorksheet('bank', 'Problem Bank'); });
    tile('Dashboard', dashDesc, 'dashboard', 'Dashboard');
    tile('Problem Bank', problems.length ? `${problems.length} problems · ${rated} rated` : 'Empty until you import a workbook.', 'bank', 'Problem Bank');
    tile('Import Workbook', 'A ProblemTrack workbook, every sheet as it is.', 'excel-import', 'Import Workbook');
    tile('Generate Items', 'Practice items from a PDF or pasted material.', 'create', 'Generate Items');
    tile('Scratch Sheet', 'The exam grid, blank.', 'scratch', 'Practice Sheet');
    tile('Settings', campaign ? 'Campaign running · sheet appearance' : 'Campaign · sheet appearance', 'settings', 'Worksheets Settings');
    root.appendChild(grid);

    // What you touched last, and what arrived last: two short lists, each row opens the item.
    const lists = el('div', 'ws-launch__lists');
    const listOf = (title: string, rows: WorksheetItemSummary[], meta: (it: WorksheetItemSummary) => string) => {
      if (rows.length === 0) return;
      const box = el('div', 'ws-launch__list');
      box.appendChild(el('div', 'ws-launch__listtitle', title));
      for (const it of rows) {
        const row = el('button', 'ws-launch__row') as HTMLButtonElement;
        row.type = 'button';
        row.appendChild(el('span', `ws-bank__dot ${stateClass(it.attemptState) || 'rest'}`));
        const text = el('span', 'ws-launch__rowtext');
        text.appendChild(el('span', 'ws-launch__rowtitle', it.title));
        text.appendChild(el('span', 'ws-launch__rowmeta', meta(it)));
        row.appendChild(text);
        row.addEventListener('click', () => void openWorksheet(`item:${it.id}`, it.title));
        box.appendChild(row);
      }
      lists.appendChild(box);
    };
    const when = (ms: number) => {
      const days = Math.floor((Date.now() - ms) / 86400000);
      return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    };
    const recent = items.filter((it) => it.lastAttemptAt > 0).sort((a, b) => b.lastAttemptAt - a.lastAttemptAt).slice(0, 8);
    listOf('Recent', recent, (it) => [it.paper ? paperLabel(it.paper) : it.sourceLabel, it.attemptState === 'open' ? 'in progress' : gradeLabel(it.attemptState), when(it.lastAttemptAt)].filter(Boolean).join(' · '));
    listOf('Starred', starred.slice(0, 8), (it) => [it.paper ? paperLabel(it.paper) : it.sourceLabel, it.attemptState === 'open' ? 'in progress' : gradeLabel(it.attemptState) || 'never tried'].filter(Boolean).join(' · '));
    const added = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    listOf('Newly Added', added, (it) => [it.paper ? paperLabel(it.paper) : it.sourceLabel, `added ${when(it.createdAt)}`].filter(Boolean).join(' · '));
    // Quizzes: every one you ran, open to review the work and learn from the misses.
    const sessions = await listQuizSessions(8).catch(() => []);
    if (disposed || seq !== renderSeq) return;
    if (sessions.length > 0) {
      const box = el('div', 'ws-launch__list');
      box.appendChild(el('div', 'ws-launch__listtitle', 'Quizzes'));
      for (const q of sessions) {
        const grades = await getSessionGrades(q.itemIds, q.startedAt).catch(() => new Map<number, string>());
        if (disposed || seq !== renderSeq) return;
        const counts = { easy: 0, medium: 0, hard: 0 };
        for (const g of grades.values()) { const r = normalizeRating(g); if (r === 'easy' || r === 'medium' || r === 'hard') counts[r]++; }
        const row = el('button', 'ws-launch__row') as HTMLButtonElement;
        row.type = 'button';
        row.appendChild(el('span', `ws-bank__dot ${q.finishedAt ? 'rest' : 'open'}`));
        const text = el('span', 'ws-launch__rowtext');
        const started = new Date(q.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        text.appendChild(el('span', 'ws-launch__rowtitle', `${started} · ${q.itemIds.length} ${q.itemIds.length === 1 ? 'problem' : 'problems'}${q.finishedAt ? '' : ' · in progress'}`));
        text.appendChild(el('span', 'ws-launch__rowmeta', `${counts.easy} Easy · ${counts.medium} Medium · ${counts.hard} Hard · ${q.itemIds.length - grades.size} not rated`));
        row.appendChild(text);
        row.title = q.finishedAt ? 'Reopen this quiz to review the work and the ratings.' : 'Resume this quiz where it was.';
        row.addEventListener('click', () => void openPastQuiz(q.id));
        box.appendChild(row);
      }
      lists.appendChild(box);
    }
    root.appendChild(lists);
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

  const render = async () => {
    if (disposed) return;
    const [items, campaign, attempts] = await Promise.all([
      listItems().catch(() => []),
      getCampaign().catch(() => null),
      listCompletedAttempts().catch(() => []),
    ]);
    if (disposed) return;
    root.replaceChildren();
    root.appendChild(titled('Worksheets Settings', 'The campaign and how the practice sheet looks.'));

    // The campaign: every problem in the bank in N days.
    const camp = el('section', 'ws-settings__section');
    const campTitle = el('div', 'ws-settings__sectiontitle', 'Campaign');
    campTitle.title = 'Every problem in the bank in a set number of days, drawn across all papers. Each day gets its own draw, every rating earns XP, a full day keeps the streak, a paper is cleared when nothing in it is left.';
    camp.appendChild(campTitle);
    // Essay sheets stay out: they are flashcards now.
    const problems = items.filter(isCampaignProblem);
    if (!campaign) {
      // Length as days or as a last day (either edits the other), and the
      // weekdays that carry no quota.
      const today = dayKey(Date.now());
      const rest = new Set<number>();
      const row = el('div', 'ws-settings__row');
      const daysIn = el('input', 'ws-input ws-input--count') as HTMLInputElement;
      daysIn.type = 'number'; daysIn.min = '1'; daysIn.max = '365'; daysIn.value = '18';
      daysIn.setAttribute('aria-label', 'Days');
      const endIn = el('input', 'ws-input ws-input--date') as HTMLInputElement;
      endIn.type = 'date'; endIn.min = today;
      endIn.setAttribute('aria-label', 'Last Day');
      const perDay = el('div', 'ws-settings__status');
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
          : `${plan.dailyTarget} a day over ${working} working ${working === 1 ? 'day' : 'days'}, ending ${fmtShortDay(endDay)}${off ? `, ${off}` : ''}`;
      };
      daysIn.addEventListener('input', sync);
      endIn.addEventListener('change', () => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(endIn.value)) daysIn.value = String(Math.max(1, Math.min(365, spanDays(today, endIn.value))));
        sync();
      });
      row.append(el('span', 'ws-hint', 'Days'), daysIn, el('span', 'ws-hint', 'Last Day'), endIn);
      camp.appendChild(row);
      const restRow = el('div', 'ws-settings__row');
      restRow.appendChild(el('span', 'ws-hint', 'Rest Days'));
      const weekdays = el('div', 'ws-settings__weekdays');
      for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
        const b = el('button', 'ws-chip ws-practicechip') as HTMLButtonElement;
        b.type = 'button';
        b.textContent = WEEKDAY_LABELS[wd].slice(0, 3);
        b.title = `${WEEKDAY_LABELS[wd]}s carry no quota; the streak and the pace step over them`;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          if (rest.has(wd)) rest.delete(wd); else if (rest.size < 6) rest.add(wd);
          b.classList.toggle('ws-practicechip--active', rest.has(wd));
          b.setAttribute('aria-pressed', String(rest.has(wd)));
          sync();
        });
        weekdays.appendChild(b);
      }
      restRow.appendChild(weekdays);
      camp.appendChild(restRow);
      camp.appendChild(perDay);
      sync();
      const start = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
      start.textContent = 'Start Campaign';
      start.disabled = problems.length === 0;
      start.title = problems.length === 0 ? 'Import a workbook first.' : `${problems.length} problems, every one but the essay sheets, from today.`;
      start.addEventListener('click', () => { void startCampaign(planCampaign(problems.length, readDays(), Date.now(), [...rest])); });
      camp.appendChild(start);
    } else {
      const p = campaignProgress(campaign, items, attempts);
      const off = restDaysLabel(campaign.restDays);
      camp.appendChild(el('div', 'ws-settings__status', `Day ${p.dayIndex} of ${campaign.days} · ${p.done} of ${p.total} done · ${p.target} a day${off ? ` · ${off}` : ''} · ends ${fmtShortDay(addDays(campaign.startDay, campaign.days - 1))}`));
      const end = el('button', 'ws-btn ws-btn--danger') as HTMLButtonElement;
      end.textContent = 'End Campaign';
      end.title = 'Stops the campaign. Ratings and attempts stay; the streak, XP and draws are dropped.';
      end.addEventListener('click', () => {
        if (end.dataset.armed !== '1') { end.dataset.armed = '1'; end.textContent = 'End It, Really'; setTimeout(() => { end.dataset.armed = ''; end.textContent = 'End Campaign'; }, 4000); return; }
        void endCampaign();
      });
      camp.appendChild(end);
    }
    root.appendChild(camp);

    // The sheet's look, independent of the app theme.
    const look = el('section', 'ws-settings__section');
    const lookTitle = el('div', 'ws-settings__sectiontitle', 'Sheet Appearance');
    lookTitle.title = 'The practice sheet keeps its own theme. Light matches the real exam tool; App follows the workbench.';
    look.appendChild(lookTitle);
    const row = el('div', 'ws-settings__row');
    const current = getSheetAppearance();
    for (const [value, label] of [['light', 'Light'], ['dark', 'Dark'], ['app', 'Follow App']] as [SheetAppearance, string][]) {
      const b = el('button', 'ws-chip ws-practicechip', label) as HTMLButtonElement;
      b.type = 'button';
      b.classList.toggle('ws-practicechip--active', current === value);
      b.setAttribute('aria-pressed', current === value ? 'true' : 'false');
      b.addEventListener('click', () => { void setSheetAppearance(value).then(() => render()); });
      row.appendChild(b);
    }
    look.appendChild(row);
    root.appendChild(look);

    // Decimals: what a cell without a number format paints.
    const nums = el('section', 'ws-settings__section');
    const numsTitle = el('div', 'ws-settings__sectiontitle', 'Decimals Shown');
    numsTitle.title = 'A cell without a number format shows at most this many decimals. The value itself and the cell editor keep full precision, and a number format set on a cell always wins.';
    nums.appendChild(numsTitle);
    const numsRow = el('div', 'ws-settings__row');
    const currentDecimals = getDisplayDecimalsSetting();
    for (const value of DISPLAY_DECIMALS_CHOICES) {
      const b = el('button', 'ws-chip ws-practicechip', value === 'full' ? 'Full' : value) as HTMLButtonElement;
      b.type = 'button';
      b.classList.toggle('ws-practicechip--active', currentDecimals === value);
      b.setAttribute('aria-pressed', currentDecimals === value ? 'true' : 'false');
      b.addEventListener('click', () => { void setDisplayDecimalsSetting(value).then(() => render()); });
      numsRow.appendChild(b);
    }
    nums.appendChild(numsRow);
    root.appendChild(nums);
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());
  return { dispose: () => { disposed = true; sub.dispose(); root.remove(); } };
}

// ── Generate pane (instanceId 'create') ─────────────────────────────────────

function createGeneratePane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create');
  container.appendChild(root);
  let disposed = false;

  root.appendChild(titled('Generate Practice Items', 'Drop a PDF (past exams, study cookbooks) or paste material. Items are generated with givens and a worked model solution, then reviewed by you before anything is saved.'));

  const source = { text: '', label: '', uri: '', pageTexts: null as string[] | null };
  const status = el('div', 'ws-hint ws-create__status', 'No source loaded yet.');

  const drop = el('div', 'ws-dropzone');
  drop.appendChild(el('div', 'ws-dropzone__title', 'Drag a PDF or document here'));
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
  const genBtn = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
  genBtn.textContent = 'Generate Items';
  controls.appendChild(genBtn);
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
      genBtn.textContent = 'Generating…';
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
        genBtn.textContent = 'Generate Items';
      }
    })();
  });

  const renderReview = (items: GeneratedItem[]) => {
    reviewHost.replaceChildren();
    reviewHost.appendChild(el('div', 'ws-home__title', `Review ${items.length} generated ${items.length === 1 ? 'item' : 'items'}`));
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
      row.appendChild(el('div', 'ws-itemrow__meta', meta.join(' · ')));
      const entry = { item, titleIn, partIns, dropped: false, row };
      const dropBtn = el('button', 'ws-btn ws-btn--danger') as HTMLButtonElement;
      dropBtn.textContent = 'Drop';
      dropBtn.addEventListener('click', () => {
        entry.dropped = !entry.dropped;
        row.classList.toggle('ws-genitem--dropped', entry.dropped);
        dropBtn.textContent = entry.dropped ? 'Keep' : 'Drop';
      });
      row.appendChild(dropBtn);
      rows.push(entry);
      reviewHost.appendChild(row);
    }

    const saveBtn = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
    saveBtn.textContent = 'Save Items';
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
  ids: number[];
  index: number;
  startedAt: number;
  skipped: Set<number>;
  /** Set when the quiz is finished and reopened to review the work. */
  finishedAt: number | null;
}
let _practice: RunningPractice | null = null;
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
  await saveQuizSession({ id: s.id, itemIds: s.ids, position: s.index, skipped: [...s.skipped], startedAt: s.startedAt, finishedAt: s.finishedAt }, announce)
    .catch((err) => console.warn('[Worksheet] quiz session save failed:', err));
}
/** A new quiz over these problems, starting at `startAt`; any open quiz closes. */
async function beginPractice(ids: number[], startAt = 0): Promise<void> {
  await finishOpenQuizSessions().catch(() => {});
  _practice = { id: newQuizId(), ids: [...ids], index: Math.max(0, Math.min(startAt, ids.length - 1)), startedAt: Date.now(), skipped: new Set(), finishedAt: null };
  await persistPractice(true);
  for (const fn of _practiceListeners) { try { fn(); } catch { /* pane torn down */ } }
}
/** The quiz in memory, else the stored open one (app restart, tool reload). */
async function restorePractice(): Promise<RunningPractice | null> {
  if (_practice) return _practice;
  const row = await getOpenQuizSession().catch(() => null);
  if (!row || row.itemIds.length === 0) return null;
  _practice = { id: row.id, ids: row.itemIds, index: Math.max(0, Math.min(row.position, row.itemIds.length)), startedAt: row.startedAt, skipped: new Set(row.skipped), finishedAt: null };
  return _practice;
}
/** A past quiz reopened: the same player over the same problems, with the
 *  work and ratings as they are now. Finished ones review; an open one resumes. */
async function openPastQuiz(id: string): Promise<void> {
  const row = await getQuizSession(id).catch(() => null);
  if (!row || row.itemIds.length === 0) return;
  _practice = {
    id: row.id, ids: row.itemIds, startedAt: row.startedAt, skipped: new Set(row.skipped), finishedAt: row.finishedAt,
    index: row.finishedAt ? 0 : Math.max(0, Math.min(row.position, row.itemIds.length)),
  };
  for (const fn of _practiceListeners) { try { fn(); } catch { /* pane torn down */ } }
  await openWorksheet('practice-run', 'Quiz');
}
/** The quiz an attempt rated now belongs to, when its problem is in the running quiz. */
function quizSessionIdFor(itemId: number): string | undefined {
  return _practice && _practice.ids.includes(itemId) ? _practice.id : undefined;
}
/** Filters chosen elsewhere (the dashboard's Quiz buttons), taken by the next quiz builder. */
let _quizPreset: { papers?: string[]; state?: string } | null = null;

/** A quiz over exactly these problems, in this order. */
function startQuizWith(ids: number[], startAt = 0): void {
  if (ids.length === 0) return;
  void (async () => {
    await beginPractice(ids, startAt);
    if (_api?.activity) _api.activity.note('started', `a quiz of ${ids.length} ${ids.length === 1 ? 'problem' : 'problems'}`);
    await openWorksheet('practice-run', 'Quiz');
  })();
}

function createPracticeConfigPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create');
  container.appendChild(root);
  let disposed = false;

  root.appendChild(titled('Start a Quiz', 'Choose papers, sources and kinds, a rating band, starred or not, a length, shuffle. Every rating you give lands on the problem and moves the dashboard.'));

  // The workbook's Quiz Generator, as chips: which papers, which sources,
  // which kinds, which rating band, how many. Generated items stay out
  // unless their source chip is on.
  const filters = { papers: new Set<string>(), sources: new Set<string>(), kinds: new Set<string>(), state: 'all', starred: 'any' as 'any' | 'starred' | 'unstarred', count: 10, shuffle: true };
  let bank: WorksheetItemSummary[] = [];

  const paperHost = el('div', 'ws-create__controls ws-practice__chips');
  const sourceHost = el('div', 'ws-create__controls ws-practice__chips');
  const kindHost = el('div', 'ws-create__controls ws-practice__chips');
  const stateHost = el('div', 'ws-create__controls');
  const starHost = el('div', 'ws-create__controls');
  const optRow = el('div', 'ws-create__controls');
  const matchLine = el('div', 'ws-hint');
  const err = el('div', 'ws-error');
  err.style.display = 'none';

  root.appendChild(el('div', 'ws-sidebar__label', 'Papers'));
  root.appendChild(paperHost);
  root.appendChild(el('div', 'ws-sidebar__label', 'Sources'));
  root.appendChild(sourceHost);
  root.appendChild(el('div', 'ws-sidebar__label', 'Kinds'));
  root.appendChild(kindHost);
  root.appendChild(el('div', 'ws-sidebar__label', 'Rating'));
  root.appendChild(stateHost);
  root.appendChild(el('div', 'ws-sidebar__label', 'Starred'));
  root.appendChild(starHost);
  root.appendChild(el('div', 'ws-sidebar__label', 'Length'));
  root.appendChild(optRow);
  root.appendChild(matchLine);
  root.appendChild(err);

  const countIn = el('input', 'ws-input ws-input--count') as HTMLInputElement;
  countIn.type = 'number'; countIn.min = '1'; countIn.max = '100'; countIn.value = '10';
  optRow.appendChild(countIn);
  optRow.appendChild(el('span', 'ws-hint', 'problems'));
  const shuffleWrap = el('label', 'ws-hint') as HTMLLabelElement;
  const shuffleIn = el('input') as HTMLInputElement;
  shuffleIn.type = 'checkbox'; shuffleIn.checked = true;
  shuffleWrap.append(shuffleIn, document.createTextNode(' Shuffle'));
  optRow.appendChild(shuffleWrap);

  const startBtn = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
  startBtn.textContent = 'Start Quiz';
  root.appendChild(startBtn);

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

  const syncMatchLine = () => {
    const matching = buildPracticeSet(bank, { ...currentFilters(), count: 10_000, shuffle: false });
    matchLine.textContent = `${matching.length} ${matching.length === 1 ? 'problem matches' : 'problems match'} the filters.`;
  };

  const chip = (label: string, active: boolean, onClick: () => void) => {
    const b = el('button', 'ws-chip ws-practicechip') as HTMLButtonElement;
    b.type = 'button';
    b.textContent = label;
    b.classList.toggle('ws-practicechip--active', active);
    b.addEventListener('click', onClick);
    return b;
  };

  const groupChips = (host: HTMLElement, values: [string, string, number][], selected: Set<string>, allLabel: string) => {
    host.replaceChildren();
    host.appendChild(chip(allLabel, selected.size === 0, () => { selected.clear(); renderFilters(); }));
    for (const [value, label, n] of values) {
      host.appendChild(chip(`${label} ${n}`, selected.has(value), () => {
        if (selected.has(value)) selected.delete(value); else selected.add(value);
        renderFilters();
      }));
    }
  };
  const renderFilters = () => {
    const count = (pick: (it: WorksheetItemSummary) => string) => {
      const m = new Map<string, number>();
      for (const it of bank) { const k = pick(it); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    const papers = count((it) => it.paper);
    groupChips(paperHost, [...papers.entries()].sort((a, b) => paperLabel(a[0]).localeCompare(paperLabel(b[0]))).map(([k, n]) => [k, paperLabel(k), n]), filters.papers, 'All Papers');
    const sources = count((it) => it.source || 'generated');
    groupChips(sourceHost, [...sources.entries()].map(([k, n]) => [k, SOURCE_LABELS[k] ?? k, n] as [string, string, number]), filters.sources, 'All Sources');
    const kinds = count((it) => it.kind);
    groupChips(kindHost, [...kinds.entries()].map(([k, n]) => [k, KIND_LABELS[k] ?? k, n] as [string, string, number]), filters.kinds, 'All Kinds');
    stateHost.replaceChildren();
    for (const [value, label] of [['all', 'All Problems'], ['incomplete', 'Incomplete'], ['unseen', 'Never Tried'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['struggling', 'Medium or Hard']] as const) {
      stateHost.appendChild(chip(label, filters.state === value, () => {
        filters.state = value;
        renderFilters();
      }));
    }
    // Starred means all of them unless the length is lowered by hand.
    const nStarred = bank.filter((it) => it.starred).length;
    starHost.replaceChildren();
    starHost.appendChild(chip('Any Problem', filters.starred === 'any', () => { filters.starred = 'any'; renderFilters(); }));
    const starredChip = chip(`Starred ${nStarred}`, filters.starred === 'starred', () => {
      filters.starred = 'starred';
      if (nStarred > 0) countIn.value = String(Math.min(100, nStarred));
      renderFilters();
    });
    starredChip.title = STAR_HINT;
    starHost.appendChild(starredChip);
    starHost.appendChild(chip(`Not Starred ${bank.length - nStarred}`, filters.starred === 'unstarred', () => { filters.starred = 'unstarred'; renderFilters(); }));
    syncMatchLine();
  };

  countIn.addEventListener('input', syncMatchLine);
  shuffleIn.addEventListener('change', syncMatchLine);

  startBtn.addEventListener('click', () => {
    const ids = buildPracticeSet(bank, currentFilters());
    if (ids.length === 0) {
      err.textContent = 'No items match those filters.';
      err.style.display = '';
      return;
    }
    startQuizWith(ids);
  });

  void (async () => {
    bank = await listItems().catch(() => []);
    if (disposed) return;
    if (bank.length === 0) {
      root.replaceChildren(el('div', 'ws-hint',
        'The bank is empty. Import your practice workbook first.'));
      return;
    }
    // Generated items are left out until asked for, so a quiz is the workbook's problems by default.
    const realSources = new Set(bank.map((it) => it.source).filter(Boolean));
    if (realSources.size > 0 && bank.some((it) => !it.source)) for (const s of realSources) filters.sources.add(s);
    if (_quizPreset) {
      for (const p of _quizPreset.papers ?? []) filters.papers.add(p);
      if (_quizPreset.state) filters.state = _quizPreset.state;
      _quizPreset = null;
    }
    renderFilters();
  })();

  return { dispose: () => { disposed = true; root.remove(); } };
}

function createPracticeRunPane(container: HTMLElement) {
  const root = el('div', 'ws-pane');
  container.appendChild(root);
  let disposed = false;
  let player: { dispose(): void } | null = null;
  let changeSub: { dispose(): void } | null = null;
  /** Bumped by every change of what the player shows; a sheet still being staged for an older step is thrown away. */
  let serveSeq = 0;
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
    playerHost.appendChild(el('div', 'ws-hint', 'No quiz is running.'));
    const row = el('div', 'ws-create__controls');
    const dash = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
    dash.textContent = 'Dashboard';
    dash.addEventListener('click', () => void openWorksheet('dashboard', 'Dashboard'));
    const cfg = el('button', 'ws-btn') as HTMLButtonElement;
    cfg.textContent = 'Start A Quiz';
    cfg.addEventListener('click', () => void openWorksheet('practice', 'Quiz'));
    row.append(dash, cfg);
    playerHost.appendChild(row);
  };

  const run = (session: RunningPractice) => {
    bar.style.display = '';
    let view: 'sheet' | 'overview' = 'sheet';

    const renderSummary = async () => {
      serveSeq++;
      player?.dispose();
      player = null;
      bar.style.display = 'none';
      bar.replaceChildren();
      playerHost.replaceChildren();
      // The quiz is over: the stored session closes, so the Dashboard stops
      // offering to resume it. Ratings stay on the problems.
      await finishQuizSession(session.id).catch(() => {});
      session.finishedAt ??= Date.now();
      if (_practice === session) _practice = null;
      if (disposed) return;
      const wrap = el('div', 'ws-home');
      wrap.appendChild(el('div', 'ws-home__title', 'Quiz Summary'));
      const grades = await getSessionGrades(session.ids, session.startedAt);
      const bank = await listItems().catch(() => []);
      const byId = new Map(bank.map((i) => [i.id, i]));
      const counts = { nailed: 0, partial: 0, missed: 0, ungraded: 0 };
      const list = el('div', 'ws-home__list');
      session.ids.forEach((id, i) => {
        const item = byId.get(id);
        const grade = grades.get(id);
        const r = grade ? normalizeRating(grade) : '';
        if (r === 'easy') counts.nailed++;
        else if (r === 'medium') counts.partial++;
        else if (r === 'hard') counts.missed++;
        else counts.ungraded++;
        const row = el('div', 'ws-itemrow');
        const info = el('div', 'ws-itemrow__info');
        const title = el('div', 'ws-itemrow__title', `${i + 1}. ${item?.title ?? `Item ${id}`}`);
        if (grade) title.appendChild(el('span', `ws-chip ws-chip--${stateClass(grade)}`, gradeLabelFor(grade)));
        else title.appendChild(el('span', 'ws-chip', session.skipped.has(id) ? 'Skipped' : 'Not Rated'));
        info.appendChild(title);
        info.addEventListener('click', () => { _practice = session; view = 'sheet'; goTo(i); });
        row.appendChild(info);
        list.appendChild(row);
      });
      const tagRoll = new Map<string, { n: number; nailed: number }>();
      for (const id of session.ids) {
        const item = byId.get(id);
        if (!item) continue;
        for (const t of itemTags(item.tags)) {
          const entry = tagRoll.get(t) ?? { n: 0, nailed: 0 };
          entry.n++;
          if (normalizeRating(grades.get(id)) === 'easy') entry.nailed++;
          tagRoll.set(t, entry);
        }
      }
      const line = [
        `${counts.nailed} Easy`, `${counts.partial} Medium`, `${counts.missed} Hard`,
        counts.ungraded ? `${counts.ungraded} Not Rated` : '',
      ].filter(Boolean).join(' · ');
      wrap.appendChild(el('div', 'ws-hint', line));
      if (tagRoll.size > 0) {
        const tags = [...tagRoll.entries()]
          .map(([t, e]) => `#${t} ${e.nailed}/${e.n}`)
          .join(' · ');
        wrap.appendChild(el('div', 'ws-hint', `By tag (easy / seen): ${tags}`));
      }
      wrap.appendChild(list);
      const actions = el('div', 'ws-create__controls');
      const dash = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
      dash.textContent = 'Dashboard';
      dash.addEventListener('click', () => void openWorksheet('dashboard', 'Dashboard'));
      const over = el('button', 'ws-btn') as HTMLButtonElement;
      over.textContent = 'Quiz Overview';
      over.title = 'Every problem in this quiz, with your ratings and notes; click one to reopen it.';
      over.addEventListener('click', () => { _practice = session; session.index = Math.min(session.index, session.ids.length - 1); view = 'overview'; serve(); });
      const again = el('button', 'ws-btn') as HTMLButtonElement;
      again.textContent = 'New Quiz';
      again.addEventListener('click', () => void openWorksheet('practice', 'Quiz'));
      const home = el('button', 'ws-btn') as HTMLButtonElement;
      home.textContent = 'Home';
      home.addEventListener('click', () => void openWorksheet('home', 'Worksheets'));
      actions.append(dash, over, again, home);
      wrap.appendChild(actions);
      playerHost.appendChild(wrap);
      _api?.activity?.note('finished', `a quiz (${line})`);
    };

    const gradeNote = el('span', 'ws-sessionbar__grade');
    /** What this quiz knows about the item on screen: its rating and whether it was worked. */
    let currentState: { grade: string; attempted: boolean } | undefined;
    const refreshGradeNote = async () => {
      if (disposed || session.index >= session.ids.length) return;
      const id = session.ids[session.index];
      const [grades, states] = await Promise.all([
        getSessionGrades([id], session.startedAt),
        getSessionItemStates([id], session.startedAt).catch(() => new Map<number, { grade: string; attempted: boolean; seconds: number }>()),
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
    changeSub = onWorksheetDataChanged(() => void refreshGradeNote());

    // Every move is stored, so a restart lands on the same item.
    const goTo = (index: number) => {
      session.index = Math.max(0, Math.min(session.ids.length, index));
      void persistPractice();
      view = 'sheet';
      serve();
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
        getSessionItemStates(session.ids, session.startedAt).catch(() => new Map<number, { grade: string; attempted: boolean; seconds: number }>()),
        getProblemNotes(session.ids).catch(() => new Map<number, string>()),
        listItems().catch(() => []),
      ]);
      if (disposed || view !== 'overview') return;
      const byId = new Map(bank.map((i) => [i.id, i]));
      const counts = { rated: 0, attempted: 0, skipped: 0, untouched: 0 };
      const rows: HTMLElement[] = [];
      session.ids.forEach((id, i) => {
        const item = byId.get(id);
        const st = states.get(id);
        const sessionGrade = st?.grade ? normalizeRating(st.grade) : '';
        // Rated before this quiz began: the rating still shows, marked as earlier.
        const earlierGrade = !sessionGrade && item ? normalizeRating(item.attemptState) : '';
        const gradeText = sessionGrade ? st!.grade : (item?.attemptState ?? '');
        const rated = sessionGrade || earlierGrade;
        if ((sessionGrade || st?.attempted) && session.skipped.delete(id)) void persistPractice();
        const skipped = session.skipped.has(id);
        const status = sessionGrade ? gradeLabel(st!.grade) : earlierGrade ? `${gradeLabel(item!.attemptState)} earlier` : st?.attempted ? 'Attempted' : skipped ? 'Skipped' : 'Not Started';
        if (sessionGrade) counts.rated++; else if (st?.attempted) counts.attempted++; else if (skipped) counts.skipped++; else counts.untouched++;
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
        row.appendChild(el('span', `ws-chip ${rated ? `ws-chip--${stateClass(gradeText)}` : st?.attempted ? 'ws-chip--open' : 'ws-chip--muted'}`, status));
        row.appendChild(el('span', 'ws-quiz__time', st?.seconds ? fmtSeconds(st.seconds) : ''));
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
        row.appendChild(editor);
        noteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = editor.style.display === 'none';
          editor.style.display = open ? '' : 'none';
          if (open) ta.focus();
        });
        row.appendChild(starBtn(id, item?.starred ?? false));
        row.addEventListener('click', () => goTo(i));
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) goTo(i); });
        rows.push(row);
      });
      const head = el('div', 'ws-quiz__overviewhead');
      head.appendChild(el('div', 'ws-home__title', session.finishedAt ? `Quiz from ${new Date(session.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Quiz Overview'));
      head.appendChild(el('span', 'ws-hint', [`${counts.rated} rated`, `${counts.attempted} attempted`, `${counts.skipped} skipped`, `${counts.untouched} not started`].join(' · ')));
      wrap.appendChild(head);
      for (const r of rows) wrap.appendChild(r);
    };

    const paintBar = () => {
      bar.replaceChildren();
      const prev = iconBtn('chevron-left', 'Previous Item', { onClick: () => goTo(session.index - 1) });
      prev.disabled = session.index === 0;
      bar.appendChild(prev);
      bar.appendChild(el('span', 'ws-sessionbar__pos', `Item ${session.index + 1} of ${session.ids.length}`));
      // Next sits with Previous, either side of the position: the pair reads
      // as one control, and Skip keeps the far end to itself.
      const last = session.index === session.ids.length - 1;
      bar.appendChild(iconBtn(last ? 'check' : 'chevron-right', last ? 'Finish Quiz' : 'Next Item', { primary: true, onClick: () => goTo(session.index + 1) }));
      if (session.finishedAt) {
        const chip = el('span', 'ws-chip ws-chip--muted', 'Reviewing');
        chip.title = 'A finished quiz, reopened. Ratings you give still count on the problems.';
        bar.appendChild(chip);
      }
      gradeNote.textContent = '';
      bar.appendChild(gradeNote);
      const spacer = el('div'); spacer.style.flex = '1';
      bar.appendChild(spacer);
      bar.appendChild(iconBtn(view === 'overview' ? 'eye' : 'list', view === 'overview' ? 'Back To Sheet' : 'Quiz Overview', {
        hint: view === 'overview' ? 'Back to the problem you were on.' : 'Every problem in this quiz, with status, rating, time and notes; click one to jump to it.',
        onClick: () => { view = view === 'overview' ? 'sheet' : 'overview'; serve(); },
      }));
      if (!session.finishedAt) bar.appendChild(iconBtn('octagon-x', 'End Quiz', { danger: true, hint: 'Stops here and shows the summary. Ratings stay on the problems.', onClick: () => { void renderSummary(); } }));
      // Skipping an item already rated or worked moves on without marking anything.
      bar.appendChild(iconBtn('skip-forward', 'Skip Item', {
        hint: 'Moves on without a rating. Rating or working the problem later clears the skip.',
        onClick: () => {
          if (!(currentState?.grade || currentState?.attempted)) session.skipped.add(session.ids[session.index]);
          goTo(session.index + 1);
        },
      }));
    };

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
      changeSub?.dispose();
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

function createExcelImportPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create');
  container.appendChild(root);
  let disposed = false;

  root.appendChild(titled('Import a Practice Workbook', 'A ProblemTrack-style workbook (one problem per sheet, named Paper.Source_NN, with a Solution marker) comes in as it is: every sheet with its formatting, the solution hidden until you reveal it, your ratings carried over. Other spreadsheets: Item/Answer sheet pairs and question-left, solution-right sheets are detected; anything else can be imported whole.'));

  const pickRow = el('div', 'ws-create__controls');
  const pickBtn = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
  pickBtn.textContent = 'Choose Excel File…';
  pickRow.appendChild(pickBtn);
  const status = el('span', 'ws-hint');
  pickRow.appendChild(status);
  root.appendChild(pickRow);

  const err = el('div', 'ws-error');
  err.style.display = 'none';
  root.appendChild(err);
  const listHost = el('div', 'ws-create__review');
  root.appendChild(listHost);

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
      line.appendChild(el('span', 'ws-itemrow__meta', meta.join(' · ')));
      row.appendChild(line);
      host.appendChild(row);
      rows.push({ item, include, box });
    };

    if (items.length > 0) {
      const head = el('div', 'ws-home__title', `${items.length} practice ${items.length === 1 ? 'item' : 'items'} detected`);
      listHost.appendChild(head);
      const toggles = el('div', 'ws-create__controls');
      const allBtn = el('button', 'ws-btn') as HTMLButtonElement;
      allBtn.textContent = 'Select All';
      allBtn.addEventListener('click', () => { for (const r of rows) if (r.item.kind !== 'whole') r.box.checked = true; });
      const noneBtn = el('button', 'ws-btn') as HTMLButtonElement;
      noneBtn.textContent = 'Select None';
      noneBtn.addEventListener('click', () => { for (const r of rows) r.box.checked = false; });
      toggles.append(allBtn, noneBtn);
      listHost.appendChild(toggles);
      for (const item of items) addRow(item, true, listHost);
    }
    if (leftovers.length > 0) {
      listHost.appendChild(el('div', 'ws-home__title', `Other sheets (${leftovers.length})`));
      listHost.appendChild(el('div', 'ws-hint', 'No question/solution structure detected - tick any to import the whole sheet as a practice surface.'));
      for (const sheet of leftovers) addRow(wholeSheetItem(sheet, fileLabel), false, listHost);
    }
    if (items.length === 0 && leftovers.length === 0) {
      listHost.appendChild(el('div', 'ws-hint', 'That workbook has no importable sheets.'));
      return;
    }

    const importBtn = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
    importBtn.textContent = 'Import Selected Items';
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
            if (done % 10 === 0) status.textContent = `Importing - ${done} / ${keep.length}…`;
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
    listHost.appendChild(importBtn);
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
    const rated = problems.filter((p) => p.rating).length;
    const fresh = problems.length - existing.size;
    listHost.appendChild(el('div', 'ws-home__title', `${problems.length} problems in ${fileLabel}`));
    listHost.appendChild(el('div', 'ws-hint', `${fresh} new, ${existing.size} already in the bank, ${rated} with a rating to carry over${timeline.length ? `, ${timeline.length} ${timeline.length === 1 ? 'day' : 'days'} of dashboard history` : ''}.`));
    const toggles = el('div', 'ws-create__controls');
    const allBtn = el('button', 'ws-btn') as HTMLButtonElement;
    allBtn.textContent = 'Select New';
    allBtn.addEventListener('click', () => { for (const r of rows) r.box.checked = !existing.has(r.problem.sheetName); });
    const noneBtn = el('button', 'ws-btn') as HTMLButtonElement;
    noneBtn.textContent = 'Select None';
    noneBtn.addEventListener('click', () => { for (const r of rows) r.box.checked = false; });
    toggles.append(allBtn, noneBtn);
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
        row.appendChild(el('span', 'ws-itemrow__meta', meta));
        if (p.rating) row.appendChild(el('span', `ws-chip ws-chip--${p.rating}`, ratingLabel(p.rating)));
        if (existing.has(p.sheetName)) row.appendChild(el('span', 'ws-chip ws-chip--muted', 'In Bank'));
        if (p.stats.imagesSkipped > 0) row.appendChild(el('span', 'ws-chip ws-chip--muted', `${p.stats.imagesSkipped} picture${p.stats.imagesSkipped === 1 ? '' : 's'} not shown`));
        group.appendChild(row);
        rows.push({ problem: p, box });
        groupRows.push(box);
      }
      groupBox.addEventListener('change', () => { for (const b of groupRows) b.checked = groupBox.checked; });
      listHost.appendChild(group);
    }
    const importBtn = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
    // With nothing new to bring in, the button says what it will actually do.
    importBtn.textContent = fresh === 0 && timeline.length > 0 ? 'Import Dashboard History' : 'Import Selected Problems';
    importBtn.style.marginTop = 'var(--px-space-3)';
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
              sheetJson: p.sheetJson, solutionCol: p.solutionCol, workRow: p.workRow,
              paper: p.paper, source: p.source, kind: p.kind, quadrant: p.quadrant, sheetName: p.sheetName,
            });
            if (id != null && p.rating) { await recordImportedRating(id, p.rating, Date.now()); carried++; }
            done++;
            if (done % 10 === 0) status.textContent = `Importing ${done} / ${keep.length}…`;
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

  pickBtn.addEventListener('click', () => {
    void (async () => {
      const electron = (window as {
        parallxElectron?: {
          dialog?: { openFile?(opts: unknown): Promise<string[] | null> };
          document?: { extractWorkbookGrid?(p: string): Promise<{ error?: { message: string }; sheets?: GridSheet[] }> };
          fs?: { readFile?(p: string): Promise<{ error?: { message: string }; content?: string; encoding?: string }> };
        };
      }).parallxElectron;
      if (!electron?.dialog?.openFile || !electron?.document?.extractWorkbookGrid) {
        err.textContent = 'Excel import needs the desktop app.';
        err.style.display = '';
        return;
      }
      const res = await electron.dialog.openFile({
        title: 'Import practice problems',
        filters: [{ name: 'Excel Workbooks', extensions: ['xlsx', 'xlsm', 'xls'] }],
      });
      const filePath = Array.isArray(res) ? res[0] : undefined;
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
        const grid = await electron.document.extractWorkbookGrid(filePath);
        if (grid?.error) throw new Error(grid.error.message);
        const sheets = grid?.sheets ?? [];
        if (disposed) return;
        const { items, leftovers } = detectExcelItems(sheets, fileLabel.replace(/\.(xlsx|xlsm|xls)$/i, ''));
        const leftoverSheets = sheets.filter((s) => leftovers.includes(s.name));
        status.textContent = `${fileLabel}: ${sheets.length} sheets, ${items.length} items detected.`;
        renderSelection(items, leftoverSheets, filePath, fileLabel);
      } catch (e) {
        status.textContent = '';
        err.textContent = `Could not read the workbook: ${(e as Error).message}`;
        err.style.display = '';
      }
    })();
  });

  return {
    dispose: () => {
      disposed = true;
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
  let autosaveTimer: ReturnType<typeof setInterval> | null = null;
  let lastSavedCells = '';
  /** Problem Bank items: time on the open attempt (-1 = not a problem item). */
  let problemSeconds = -1;
  let problemTimer: ReturnType<typeof setInterval> | null = null;

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
    });
    // Probe hook (tests/probes): the live host, reachable from the DOM.
    (sheetHost as unknown as { __wsHost?: unknown }).__wsHost = host;
    void host.whenRendered().then(() => readyResolve());
    // Unhiding the solution columns by hand is the same act as Reveal
    // Solution: the button follows the sheet, whichever way the columns moved.
    visibilitySub?.dispose();
    visibilitySub = host.onColumnsVisibilityChanged(() => syncRevealFromSheet?.());
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
          const b = el('button', `ws-btn ws-btn--grade ws-btn--grade-${grade}`) as HTMLButtonElement;
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
        const again = el('button', 'ws-btn') as HTMLButtonElement;
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
      const reviewBtn = el('button', 'ws-btn') as HTMLButtonElement;
      reviewBtn.textContent = 'Review in Chat';
      reviewBtn.title = 'Sends your cells and the model solution to the chat for method-level feedback. Ask follow-up questions there.';
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
    const snap = (open ?? prior) ? parseWorkbook((open ?? prior)!.cellsJson) : null;
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
    if (!item || item.solutionCol < 0) return snap;
    const sheet = firstSheet(snap);
    if (sheet) pureApplySolutionVisibility(sheet, item.solutionCol, pristine, show);
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
    problemSeconds = open?.seconds ?? 0;
    readPristine(problem);
    let latestRating = '';
    let starred = false;
    const refreshRating = async () => {
      const summary = (await listItems().catch(() => [])).find((s) => s.id === problem.id);
      latestRating = summary ? normalizeRating(summary.attemptState) : '';
      starred = summary?.starred ?? false;
    };
    await refreshRating();
    const timerEl = el('span', 'ws-problem__timer', fmtSeconds(problemSeconds));
    timerEl.title = 'Time on this attempt. Runs while the problem is on screen.';
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
      const rate = el('div', 'ws-problem__rate');
      rate.appendChild(el('span', 'ws-problem__ratelabel', 'Rate'));
      for (const grade of ['easy', 'medium', 'hard'] as const) {
        const b = el('button', `ws-btn ws-btn--grade ws-btn--grade-${grade}`) as HTMLButtonElement;
        b.textContent = ratingLabel(grade);
        b.setAttribute('aria-pressed', latestRating === grade ? 'true' : 'false');
        b.title = `Rate this problem ${ratingLabel(grade)}. Your rating feeds the dashboard and the quiz filters.`;
        b.addEventListener('click', () => {
          void (async () => {
            await persistWorking();
            await completeAttempt(problem.id, grade, lastSavedCells, { seconds: problemSeconds, sessionId: quizSessionIdFor(problem.id) });
            _api?.activity?.note('practiced', `problem "${problem.title}"`, `rated ${ratingLabel(grade)}`);
            latestRating = grade;
            if (ratingCell) host?.setCellText(ratingCell.row, ratingCell.col, ratingLabel(grade));
            paintHeader();
          })();
        });
        rate.appendChild(b);
      }
      titleRow.appendChild(rate);
      titleRow.appendChild(starBtn(problem.id, starred, (on) => { starred = on; }));
      titleRow.appendChild(makeSheetThemeButton());
      titleRow.appendChild(iconBtn('file-spreadsheet', 'Export to Excel', {
        hint: 'Saves this sheet as a real .xlsx, values and formulas, in your Downloads folder.',
        onClick: () => {
          const name = (problem.sheetName || problem.title || 'problem').replace(/[^\w\- .]+/g, '').trim() || 'problem';
          if (!host?.exportToXlsx(name)) void _api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
        },
      }));
      const resetBtn = iconBtn('rotate-ccw', 'Reset Work', { danger: true, hint: 'Clears your work and the timer; the problem returns to the sheet as imported. Ratings stay.' });
      resetBtn.addEventListener('click', () => {
        void (async () => {
          const ok = await _api?.window?.showConfirmModal?.({
            message: 'Reset your work on this problem?',
            detail: 'Everything you typed on this sheet is discarded and the timer restarts. Your ratings are kept. This cannot be undone.',
            confirmLabel: 'Reset Work',
            danger: true,
          }) ?? false;
          if (!ok || disposed) return;
          lastSavedCells = '';
          problemSeconds = 0;
          timerEl.textContent = fmtSeconds(0);
          await discardOpenAttempt(problem.id);
          await mountSheet(applyRatingCell(applySolutionVisibility(parseWorkbook(problem.sheetJson) as IWorkbookData, revealed), latestRating));
          lastSavedCells = await settledSnapshotJson();
        })();
      });
      titleRow.appendChild(resetBtn);
      if (problem.solutionCol >= 0) {
        const revealBtn = revealed
          ? iconBtn('eye-off', 'Hide Solution', { hint: 'Hides the worked solution again. Your work stays.' })
          : iconBtn('eye', 'Reveal Solution', { primary: true, hint: 'Shows the worked solution beside your work, as in the workbook.' });
        revealBtn.addEventListener('click', () => {
          void (async () => {
            const live = host?.getSnapshot();
            if (!live || !host) return;
            revealed = !revealed;
            // In place: the engine hides or shows the solution columns itself,
            // so the canvas, scroll and selection stay. Remounting on an
            // edited snapshot redrew the whole sheet (the flash). The remount
            // remains only as the fallback when the engine refuses.
            const segs = solutionSegments(live);
            const h = host;
            const inPlace = segs.length > 0 && segs.every((seg) => h.setColumnsHidden(seg.start, seg.last - seg.start + 1, !revealed));
            if (!inPlace) await mountSheet(applySolutionVisibility(live, revealed));
            lastSavedCells = '';
            await persistWorking();
            paintHeader();
          })();
        });
        titleRow.appendChild(revealBtn);
      }
      header.replaceChildren(titleRow);
      if (revealed && _api?.lm) {
        const reviewWrap = el('div', 'ws-item__review');
        const reviewBtn = el('button', 'ws-btn') as HTMLButtonElement;
        reviewBtn.textContent = 'Review in Chat';
        reviewBtn.title = 'Sends your cells and the worked solution to the chat for method-level feedback. Ask follow-up questions there.';
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
      lastSavedCells = '';
      void persistWorking();
    };
    paintHeader();
    const carried = open ?? prior;
    const base = carried ? (parseWorkbook(carried.cellsJson) as IWorkbookData | null) : null;
    await mountSheet(applyRatingCell(applySolutionVisibility((base ?? parseWorkbook(problem.sheetJson)) as IWorkbookData, revealed), latestRating));
    // Baseline = what the sheet holds once the engine has settled after the
    // mount, so merely reopening a problem (rated or not) starts no new attempt.
    lastSavedCells = await settledSnapshotJson();
    if (disposed) return;
    autosaveTimer = setInterval(() => { void persistWorking(); }, AUTOSAVE_MS);
    problemTimer = setInterval(() => {
      if (disposed || document.hidden || !root.isConnected || root.offsetParent === null) return;
      problemSeconds++;
      timerEl.textContent = fmtSeconds(problemSeconds);
    }, 1000);
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
        const snap = (open ?? prior) ? parseWorkbook((open ?? prior)!.cellsJson) : null;
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
    saveViewState: () => {
      void persistWorking();
      return { instanceId };
    },
    ready,
    restoreViewState: (_state: unknown) => {
      // State rides SQLite (items) / the scratch cache (scratch), applied in
      // the async init above. Nothing positional to restore yet.
    },
    dispose: () => {
      readyResolve();
      if (autosaveTimer) clearInterval(autosaveTimer);
      if (problemTimer) clearInterval(problemTimer);
      // Capture-before-teardown so close-without-save cannot drop work.
      void persistWorking();
      disposed = true;
      _appearanceListeners.delete(applyAppearance);
      _decimalsListeners.delete(applyDecimals);
      visibilitySub?.dispose();
      modeObserver.disconnect();
      host?.dispose();
      host = null;
      root.remove();
    },
  };
}

// ── Open helper ─────────────────────────────────────────────────────────────

async function openWorksheet(instanceId: string, title: string): Promise<void> {
  await _api?.editors.openEditor({
    typeId: 'worksheet',
    title,
    iconHtml: WS_ICON_SVG,
    instanceId,
  });
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
        if (instanceId === 'practice-run') return createPracticeRunPane(container);
        if (instanceId === 'dashboard') {
          return createDashboardPane(container, {
            openItem: (id, title) => void openWorksheet(`item:${id}`, title),
            startQuiz: (ids, startAt) => startQuizWith(ids, startAt),
            resumeQuiz: () => void openWorksheet('practice-run', 'Quiz'),
            openQuiz: (id) => void openPastQuiz(id),
            renderIcon: (id, size) => { try { return _api?.icons?.createIconHtml?.(id, size) ?? ''; } catch { return ''; } },
            configureQuiz: (preset) => { _quizPreset = preset; void openWorksheet('practice', 'Quiz'); },
            importWorkbook: () => void openWorksheet('excel-import', 'Import Workbook'),
            openSettings: () => void openWorksheet('settings', 'Worksheets Settings'),
            studyFlashcards: () => {
              const cmds = (_api as unknown as { commands?: { executeCommand?: (id: string) => Promise<unknown> } } | null)?.commands;
              if (cmds?.executeCommand) void cmds.executeCommand('flashcards.study').catch(() => void _api?.window?.showInformationMessage?.('Flashcards is not available in this workspace.'));
            },
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
    api.commands.registerCommand('worksheet.openScratch', () => openWorksheet('scratch', 'Practice Sheet')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.generate', () => openWorksheet('create', 'Generate Items')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.importExcel', () => openWorksheet('excel-import', 'Import Workbook')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.practice', () => openWorksheet('practice', 'Quiz')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.dashboard', () => openWorksheet('dashboard', 'Dashboard')),
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
