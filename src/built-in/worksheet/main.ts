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
  listItems, getItem, createItem, deleteItem, getOpenAttempt, saveAttemptCells,
  discardOpenAttempt, completeAttempt, saveAttemptReview, onWorksheetDataChanged,
  getSessionGrades, attachWorksheetDatabase, findItemBySheet, recordImportedRating,
  type WorksheetItem, type WorksheetItemSummary,
} from './worksheetData.js';
import { openXlsx } from './ooxml.js';
import { detectProblems, normalizeRating, ratingLabel, paperLabel, SOURCE_LABELS, KIND_LABELS, QUADRANT_LABELS, type ProblemImport } from './problemImport.js';
import { IDatabaseService } from '../../services/serviceTypes.js';
import { buildPracticeSet, itemTags } from './practiceSession.js';
import { itemToWorkbooks, workbookHasOnSheetQuestion, type GeneratedItem } from './itemFormat.js';
import { generateItems, reviewAttempt, type LmApiLike } from './worksheetAi.js';
import { registerWorksheetChatTools } from './worksheetChat.js';
import { detectExcelItems, wholeSheetItem, type GridSheet, type ExcelItem } from './excelImport.js';
import './worksheet.css';

// ── API typings (structural — the tool API surface) ─────────────────────────

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
  };
  services?: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
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

function sheetThemeLabel(): string {
  const appearance = getSheetAppearance();
  if (appearance === 'app') return 'Sheet Theme: App';
  return resolveSheetDark(appearance) ? 'Sheet Theme: Dark' : 'Sheet Theme: Light';
}

/** The scratch-bar / item-header toggle: flips the sheet light↔dark (a
 *  pinned choice — 'app' is reachable in Settings). */
function makeSheetThemeButton(): HTMLButtonElement {
  const btn = el('button', 'ws-btn') as HTMLButtonElement;
  btn.textContent = sheetThemeLabel();
  btn.title = 'Flip this practice sheet between light and dark. The app theme is unaffected; light matches the real exam surface. Settings has a follow-the-app option.';
  btn.addEventListener('click', () => {
    void setSheetAppearance(resolveSheetDark() ? 'light' : 'dark');
  });
  return btn;
}

const WS_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

const AUTOSAVE_MS = 5000;

// ── Univer bundle loader ────────────────────────────────────────────────────

type UniverHostModule = {
  createWorksheetHost(opts: { container: HTMLElement; snapshot?: IWorkbookData | null; darkMode?: boolean }): IWorksheetHost;
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

function createHomePane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-home');
  container.appendChild(root);
  let disposed = false;

  const render = async () => {
    if (disposed) return;
    const items = await listItems().catch(() => []);
    if (disposed) return;
    root.replaceChildren();

    const head = el('div', 'ws-home__head');
    head.appendChild(el('div', 'ws-home__title', 'Problem Bank'));
    const spacer = el('div'); spacer.style.flex = '1';
    head.appendChild(spacer);
    const scratchBtn = el('button', 'ws-btn') as HTMLButtonElement;
    scratchBtn.textContent = 'Open Scratch Sheet';
    scratchBtn.addEventListener('click', () => void openWorksheet('scratch', 'Practice Sheet'));
    head.appendChild(scratchBtn);
    const importBtn = el('button', 'ws-btn') as HTMLButtonElement;
    importBtn.textContent = 'Import Workbook';
    importBtn.addEventListener('click', () => void openWorksheet('excel-import', 'Import Workbook'));
    head.appendChild(importBtn);
    const genBtn = el('button', 'ws-btn') as HTMLButtonElement;
    genBtn.textContent = 'Generate Items';
    genBtn.addEventListener('click', () => void openWorksheet('create', 'Generate Items'));
    head.appendChild(genBtn);
    // Practicing is the daily act — it takes the primary slot.
    const practiceBtn = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
    practiceBtn.textContent = 'Start Quiz';
    practiceBtn.addEventListener('click', () => void openWorksheet('practice', 'Quiz'));
    head.appendChild(practiceBtn);
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

    const problems = items.filter((it) => it.paper);
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
      if (_homeOpen.has(key)) {
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

function renderBank(root: HTMLElement, items: WorksheetItemSummary[]): void {
  const search = el('input', 'ws-input ws-bank__search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search problems';
  search.value = _bankQuery;
  search.setAttribute('aria-label', 'Search problems');
  root.appendChild(search);

  const filters = el('div', 'ws-bank__filters');
  const FILTERS: [string, string][] = [['all', 'All'], ['incomplete', 'Incomplete'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['rf', 'RF'], ['cas', 'CAS'], ['quant', 'Quant'], ['qual', 'Qual'], ['essay', 'Essay']];
  const present = new Set<string>();
  for (const it of items) { present.add(it.source); present.add(it.kind); }
  for (const [value, label] of FILTERS) {
    if ((value === 'rf' || value === 'cas' || value === 'quant' || value === 'qual' || value === 'essay') && !present.has(value)) continue;
    const b = el('button', 'ws-bank__filter') as HTMLButtonElement;
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', _bankFilter === value ? 'true' : 'false');
    b.addEventListener('click', () => { _bankFilter = value; paint(); });
    filters.appendChild(b);
  }
  root.appendChild(filters);

  const summary = el('div', 'ws-bank__summary');
  root.appendChild(summary);
  const listHost = el('div', 'ws-bank__list');
  root.appendChild(listHost);

  const paint = () => {
    for (const b of filters.querySelectorAll('button')) b.setAttribute('aria-pressed', b.textContent === (FILTERS.find(([v]) => v === _bankFilter)?.[1] ?? 'All') ? 'true' : 'false');
    listHost.replaceChildren();
    // The bank is the workbook's problems. Anything without a paper (items
    // generated from PDFs, experiments) lives in its own section below and
    // never mixes with the papers.
    const problems = items.filter((it) => it.paper);
    const generated = items.filter((it) => !it.paper);
    const shown = problems.filter((it) => bankMatches(it, _bankFilter, _bankQuery));
    const rated = problems.filter((it) => normalizeRating(it.attemptState)).length;
    summary.textContent = problems.length ? `${shown.length} of ${problems.length} problems · ${rated} rated` : 'No workbook problems yet. Import Workbook fills the bank.';
    const groups = new Map<string, WorksheetItemSummary[]>();
    for (const it of shown) {
      const key = it.paper || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : paperLabel(a).localeCompare(paperLabel(b))));
    const filtering = _bankFilter !== 'all' || !!_bankQuery;
    for (const key of keys) {
      const list = groups.get(key)!;
      const head = el('div', 'ws-bank__paper');
      head.setAttribute('role', 'button');
      const open = filtering || _bankOpen.has(key);
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
      head.addEventListener('click', () => {
        if (_bankOpen.has(key)) _bankOpen.delete(key); else _bankOpen.add(key);
        paint();
      });
      listHost.appendChild(head);
      if (!open) continue;
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
    if (shown.length === 0 && problems.length > 0) listHost.appendChild(el('div', 'ws-sidebar__empty', 'Nothing matches.'));
    if (generated.length > 0) {
      const head = el('div', 'ws-bank__paper ws-bank__paper--generated');
      head.setAttribute('role', 'button');
      head.appendChild(el('span', 'ws-bank__papername', 'Generated Items'));
      head.appendChild(el('span', 'ws-bank__count', String(generated.length)));
      head.title = 'Items generated from PDFs or pasted material. Not part of the workbook bank; quizzes leave them out unless you ask.';
      head.addEventListener('click', () => { if (_bankOpen.has('__generated')) _bankOpen.delete('__generated'); else _bankOpen.add('__generated'); paint(); });
      listHost.appendChild(head);
      if (_bankOpen.has('__generated')) {
        const rows = el('div', 'ws-bank__items');
        for (const it of generated) {
          const row = el('div', 'ws-bank__item');
          row.appendChild(el('span', `ws-bank__dot ${stateClass(it.attemptState)}`));
          row.appendChild(el('span', 'ws-bank__itemtitle', it.title));
          row.title = it.title;
          row.addEventListener('click', () => void openWorksheet(`item:${it.id}`, it.title));
          rows.appendChild(row);
        }
        const clear = el('button', 'ws-btn ws-btn--danger ws-btn--block') as HTMLButtonElement;
        clear.textContent = 'Delete All Generated Items';
        clear.style.marginTop = 'var(--px-space-1)';
        clear.addEventListener('click', () => { void deleteGeneratedItems(generated); });
        rows.appendChild(clear);
        listHost.appendChild(rows);
      }
    }
  };
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { _bankQuery = search.value.trim(); paint(); }, 120);
  });
  paint();
}

// ── Sidebar view (activity bar → Worksheets) ────────────────────────────────

function createSidebarView(container: HTMLElement) {
  const root = el('div', 'ws-sidebar');
  container.appendChild(root);
  let disposed = false;

  const render = async () => {
    if (disposed) return;
    const items = await listItems().catch(() => []);
    if (disposed) return;
    root.replaceChildren();

    const actions = el('div', 'ws-sidebar__actions');
    const mk = (label: string, primary: boolean, onClick: () => void) => {
      const b = el('button', primary ? 'ws-btn ws-btn--primary ws-btn--block' : 'ws-btn ws-btn--block') as HTMLButtonElement;
      b.textContent = label;
      b.addEventListener('click', onClick);
      actions.appendChild(b);
    };
    mk('Start Quiz', true, () => void openWorksheet('practice', 'Quiz'));
    mk('Import Workbook', false, () => void openWorksheet('excel-import', 'Import Workbook'));
    mk('Generate Items', false, () => void openWorksheet('create', 'Generate Items'));
    mk('Scratch Sheet', false, () => void openWorksheet('scratch', 'Practice Sheet'));
    root.appendChild(actions);

    if (items.length === 0) {
      root.appendChild(el('div', 'ws-sidebar__empty', 'The bank is empty. Import your practice workbook, or generate items from study material.'));
      return;
    }
    renderBank(root, items);
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

// ── Generate pane (instanceId 'create') ─────────────────────────────────────

function createGeneratePane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create');
  container.appendChild(root);
  let disposed = false;

  root.appendChild(el('div', 'ws-home__title', 'Generate Practice Items'));
  root.appendChild(el('div', 'ws-hint',
    'Drop a PDF (past exams, study cookbooks) or paste material. Items are generated with givens and a worked model solution, then reviewed by you before anything is saved.'));

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
  ids: number[];
  index: number;
  startedAt: number;
  skipped: Set<number>;
}
let _practice: RunningPractice | null = null;

function createPracticeConfigPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create');
  container.appendChild(root);
  let disposed = false;

  root.appendChild(el('div', 'ws-home__title', 'Start a Quiz'));
  root.appendChild(el('div', 'ws-hint',
    'Draw problems from the bank the way the workbook did: choose papers, sources and kinds, a rating band, a length, shuffle. Every rating you give lands on the problem and moves the dashboard.'));

  // The workbook's Quiz Generator, as chips: which papers, which sources,
  // which kinds, which rating band, how many. Generated items stay out
  // unless their source chip is on.
  const filters = { papers: new Set<string>(), sources: new Set<string>(), kinds: new Set<string>(), state: 'all', count: 10, shuffle: true };
  let bank: WorksheetItemSummary[] = [];

  const paperHost = el('div', 'ws-create__controls ws-practice__chips');
  const sourceHost = el('div', 'ws-create__controls ws-practice__chips');
  const kindHost = el('div', 'ws-create__controls ws-practice__chips');
  const stateHost = el('div', 'ws-create__controls');
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
    _practice = { ids, index: 0, startedAt: Date.now(), skipped: new Set() };
    if (_api?.activity) _api.activity.note('started', `a quiz of ${ids.length} ${ids.length === 1 ? 'problem' : 'problems'}`);
    void openWorksheet('practice-run', 'Quiz');
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
    renderFilters();
  })();

  return { dispose: () => { disposed = true; root.remove(); } };
}

function createPracticeRunPane(container: HTMLElement) {
  const root = el('div', 'ws-pane');
  container.appendChild(root);
  let disposed = false;
  let player: { dispose(): void } | null = null;
  const bar = el('div', 'ws-sessionbar');
  const playerHost = el('div', 'ws-session__player');
  root.append(bar, playerHost);

  if (!_practice) {
    bar.remove();
    playerHost.appendChild(el('div', 'ws-hint',
      'No practice session is running.'));
    const cfg = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
    cfg.textContent = 'Configure a Session';
    cfg.addEventListener('click', () => void openWorksheet('practice', 'Practice Session'));
    playerHost.appendChild(cfg);
    return { dispose: () => { disposed = true; root.remove(); } };
  }

  const session = _practice;
  const gradeLabelFor = (g: string | undefined) => (g ? gradeLabel(g) : '');

  const renderSummary = async () => {
    player?.dispose();
    player = null;
    bar.remove();
    playerHost.replaceChildren();
    const wrap = el('div', 'ws-home');
    wrap.appendChild(el('div', 'ws-home__title', 'Session Summary'));
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
      else title.appendChild(el('span', 'ws-chip', session.skipped.has(id) ? 'Skipped' : 'Not Graded'));
      info.appendChild(title);
      info.addEventListener('click', () => void openWorksheet(`item:${id}`, item?.title ?? 'Practice Item'));
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
    const again = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
    again.textContent = 'New Session';
    again.addEventListener('click', () => { _practice = null; void openWorksheet('practice', 'Practice Session'); });
    const home = el('button', 'ws-btn') as HTMLButtonElement;
    home.textContent = 'Back to Items';
    home.addEventListener('click', () => { _practice = null; void openWorksheet('home', 'Worksheets'); });
    actions.append(again, home);
    wrap.appendChild(actions);
    playerHost.appendChild(wrap);
    _api?.activity?.note('finished', `a practice session (${line})`);
  };

  const gradeNote = el('span', 'ws-sessionbar__grade');
  const refreshGradeNote = async () => {
    if (disposed || session.index >= session.ids.length) return;
    const grades = await getSessionGrades([session.ids[session.index]], session.startedAt);
    if (disposed) return;
    const g = grades.get(session.ids[session.index]);
    gradeNote.textContent = g ? `Graded: ${gradeLabelFor(g)}` : '';
  };
  const changeSub = onWorksheetDataChanged(() => void refreshGradeNote());

  const serve = () => {
    if (disposed) return;
    if (session.index >= session.ids.length) { void renderSummary(); return; }
    player?.dispose();
    playerHost.replaceChildren();
    bar.replaceChildren();
    bar.appendChild(el('span', 'ws-sessionbar__pos', `Item ${session.index + 1} of ${session.ids.length}`));
    gradeNote.textContent = '';
    bar.appendChild(gradeNote);
    const spacer = el('div'); spacer.style.flex = '1';
    bar.appendChild(spacer);
    const skip = el('button', 'ws-btn') as HTMLButtonElement;
    skip.textContent = 'Skip Item';
    skip.addEventListener('click', () => {
      session.skipped.add(session.ids[session.index]);
      session.index++;
      serve();
    });
    bar.appendChild(skip);
    const next = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
    next.textContent = session.index === session.ids.length - 1 ? 'Finish Session' : 'Next Item';
    next.addEventListener('click', () => {
      session.index++;
      serve();
    });
    bar.appendChild(next);
    player = createSheetPane(playerHost, `item:${session.ids[session.index]}`);
    void refreshGradeNote();
  };
  serve();

  return {
    dispose: () => {
      disposed = true;
      changeSub.dispose();
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

  root.appendChild(el('div', 'ws-home__title', 'Import a Practice Workbook'));
  root.appendChild(el('div', 'ws-hint',
    'A ProblemTrack-style workbook (one problem per sheet, named Paper.Source_NN, with a Solution marker) comes in as it is: every sheet with its formatting, the solution hidden until you reveal it, your Easy, Medium and Hard ratings carried over. Other spreadsheets fall back to Item/Answer pair and side-by-side detection.'));
  root.appendChild(el('div', 'ws-hint',
    'Bring existing spreadsheet practice problems in as native items. Item/Answer sheet pairs and question-left, solution-right sheets are detected automatically; anything else can be imported whole. Values, formulas and layout carry over.'));

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
  const renderProblems = async (problems: ProblemImport[], filePath: string, fileLabel: string) => {
    listHost.replaceChildren();
    err.style.display = 'none';
    const existing = new Map<string, number>();
    for (const p of problems) {
      const id = await findItemBySheet(fileLabel, p.sheetName).catch(() => null);
      if (id != null) existing.set(p.sheetName, id);
    }
    if (disposed) return;
    const rows: { problem: ProblemImport; box: HTMLInputElement }[] = [];
    const rated = problems.filter((p) => p.rating).length;
    const fresh = problems.length - existing.size;
    listHost.appendChild(el('div', 'ws-home__title', `${problems.length} problems in ${fileLabel}`));
    listHost.appendChild(el('div', 'ws-hint', `${fresh} new, ${existing.size} already in the bank, ${rated} with a rating to carry over.`));
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
    importBtn.textContent = 'Import Selected Problems';
    importBtn.style.marginTop = 'var(--px-space-3)';
    importBtn.addEventListener('click', () => {
      void (async () => {
        const keep = rows.filter((r) => r.box.checked);
        if (keep.length === 0) { err.textContent = 'Nothing selected to import.'; err.style.display = ''; return; }
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
          status.textContent = '';
          _api?.activity?.note('imported', `${done} problems from ${fileLabel}`, carried ? `${carried} ratings carried over` : undefined);
          await _api?.window?.showInformationMessage?.(`Imported ${done} ${done === 1 ? 'problem' : 'problems'}${carried ? `, ${carried} with your rating` : ''}.`);
          await openWorksheet('home', 'Problem Bank');
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
              status.textContent = `${fileLabel}: ${problems.length} problems found.`;
              await renderProblems(problems, filePath, fileLabel);
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
  /** 'working' = user's attempt on screen; 'solution' = model solution. */
  let mode: 'working' | 'solution' = 'working';
  let revealed = false;
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

  const mountSheet = async (snapshot: IWorkbookData | null): Promise<void> => {
    const mod = await loadUniverModule();
    if (disposed) return;
    loading.remove();
    host?.dispose();
    sheetHost.replaceChildren();
    host = mod.createWorksheetHost({ container: sheetHost, snapshot, darkMode: resolveSheetDark() });
  };

  // Sheet appearance: re-skin the live engine when the setting changes
  // (toggle on any pane) or, in 'app' mode, when the workbench theme flips.
  let scratchThemeBtn: HTMLButtonElement | null = null;
  const applyAppearance = (appearance: SheetAppearance) => {
    host?.setDarkMode(resolveSheetDark(appearance));
    if (item) renderItemHeader();
    else if (scratchThemeBtn) scratchThemeBtn.textContent = sheetThemeLabel();
  };
  _appearanceListeners.add(applyAppearance);
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

    titleRow.appendChild(makeSheetThemeButton());

    if (mode === 'working') {
      const exportBtn = el('button', 'ws-btn') as HTMLButtonElement;
      exportBtn.textContent = 'Export to Excel';
      exportBtn.title = 'Save this sheet as a real .xlsx (values and formulas) in your Downloads folder.';
      exportBtn.addEventListener('click', () => {
        const name = (item?.title || 'practice-sheet').replace(/[^\w\- ]+/g, '').trim() || 'practice-sheet';
        if (!host?.exportToXlsx(name)) {
          void _api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
        }
      });
      titleRow.appendChild(exportBtn);

      const resetBtn = el('button', 'ws-btn') as HTMLButtonElement;
      resetBtn.textContent = 'Reset Sheet';
      resetBtn.title = 'Restore the item to its original state. Cannot be undone.';
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

      const revealBtn = el('button', 'ws-btn ws-btn--primary') as HTMLButtonElement;
      revealBtn.textContent = 'Reveal Solution';
      revealBtn.addEventListener('click', () => void revealSolution());
      titleRow.appendChild(revealBtn);
    } else {
      const backBtn = el('button', 'ws-btn') as HTMLButtonElement;
      backBtn.textContent = 'Show My Work';
      backBtn.addEventListener('click', () => void showWorking());
      titleRow.appendChild(backBtn);
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
      reviewBtn.textContent = 'AI Review My Work';
      reviewBtn.title = 'Compare your cells against the model solution and get method-level feedback.';
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
          reviewBtn.textContent = 'Reviewing…';
          reviewOut.style.display = '';
          reviewOut.textContent = 'Reading your work…';
          try {
            const review = await reviewAttempt(_api.lm, item, lastSavedCells, (partial) => {
              reviewOut.textContent = partial;
            });
            reviewOut.replaceChildren(renderMarkdown(review));
            await saveAttemptReview(item.id, review);
            _api?.activity?.note('reviewed', `worksheet attempt on "${item.title}"`, 'AI method feedback saved');
          } catch (err) {
            reviewOut.textContent = `Review failed: ${(err as Error).message}`;
          } finally {
            reviewBtn.disabled = false;
            reviewBtn.textContent = 'AI Review My Work';
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
    const snap = open ? parseWorkbook(open.cellsJson) : null;
    await mountSheet(snap ?? parseWorkbook(item.givensJson));
  };

  // ── Problem Bank item: one sheet, the solution hidden until revealed ──
  // The sheet is the workbook's sheet. Columns from the solution marker on
  // are hidden; Reveal unhides them beside the work, Hide puts them away;
  // neither touches the student's cells. Rating is Easy, Medium or Hard,
  // any time; time on the attempt runs while the tab is on screen.
  const applySolutionVisibility = (snap: IWorkbookData, show: boolean): IWorkbookData => {
    if (!item || item.solutionCol < 0) return snap;
    const sheet = snap.sheets[snap.sheetOrder[0]] as unknown as { columnCount?: number; columnData?: Record<number, { hd?: number; w?: number }> };
    if (!sheet) return snap;
    const columnData = (sheet.columnData ??= {});
    const last = Math.max(sheet.columnCount ?? 0, ...Object.keys(columnData).map(Number)) - 1;
    for (let c = item.solutionCol; c <= last; c++) {
      if (show) { if (columnData[c]) delete columnData[c].hd; }
      else (columnData[c] ??= {}).hd = 1;
    }
    return snap;
  };
  const initProblem = async (problem: WorksheetItem, open: Awaited<ReturnType<typeof getOpenAttempt>>): Promise<void> => {
    problemSeconds = open?.seconds ?? 0;
    let latestRating = '';
    const refreshRating = async () => {
      const summary = (await listItems().catch(() => [])).find((s) => s.id === problem.id);
      latestRating = summary ? normalizeRating(summary.attemptState) : '';
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
            await completeAttempt(problem.id, grade, lastSavedCells, { seconds: problemSeconds });
            _api?.activity?.note('practiced', `problem "${problem.title}"`, `rated ${ratingLabel(grade)}`);
            latestRating = grade;
            paintHeader();
          })();
        });
        rate.appendChild(b);
      }
      titleRow.appendChild(rate);
      titleRow.appendChild(makeSheetThemeButton());
      const exportBtn = el('button', 'ws-btn') as HTMLButtonElement;
      exportBtn.textContent = 'Export to Excel';
      exportBtn.title = 'Save this sheet as a real .xlsx (values and formulas) in your Downloads folder.';
      exportBtn.addEventListener('click', () => {
        const name = (problem.sheetName || problem.title || 'problem').replace(/[^\w\- .]+/g, '').trim() || 'problem';
        if (!host?.exportToXlsx(name)) void _api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
      });
      titleRow.appendChild(exportBtn);
      const resetBtn = el('button', 'ws-btn') as HTMLButtonElement;
      resetBtn.textContent = 'Reset Work';
      resetBtn.title = 'Clear your work and the timer; the problem returns to the sheet as imported. Ratings stay.';
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
          await mountSheet(applySolutionVisibility(parseWorkbook(problem.sheetJson) as IWorkbookData, revealed));
          const mounted = host as IWorksheetHost | null;
          lastSavedCells = JSON.stringify(mounted?.getSnapshot() ?? null);
        })();
      });
      titleRow.appendChild(resetBtn);
      if (problem.solutionCol >= 0) {
        const revealBtn = el('button', revealed ? 'ws-btn' : 'ws-btn ws-btn--primary') as HTMLButtonElement;
        revealBtn.textContent = revealed ? 'Hide Solution' : 'Reveal Solution';
        revealBtn.title = revealed ? 'Hide the worked solution again. Your work stays.' : 'Show the worked solution beside your work, as in the workbook.';
        revealBtn.addEventListener('click', () => {
          void (async () => {
            const live = host?.getSnapshot();
            if (!live) return;
            revealed = !revealed;
            await mountSheet(applySolutionVisibility(live, revealed));
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
        reviewBtn.textContent = 'AI Review My Work';
        reviewBtn.title = 'Compare your cells against the worked solution and get method-level feedback.';
        const reviewOut = el('div', 'ws-item__reviewout');
        reviewOut.style.display = 'none';
        reviewBtn.addEventListener('click', () => {
          void (async () => {
            if (!_api?.lm) return;
            await persistWorking();
            reviewBtn.disabled = true;
            reviewBtn.textContent = 'Reviewing…';
            reviewOut.style.display = '';
            reviewOut.textContent = 'Reading your work…';
            try {
              const review = await reviewAttempt(_api.lm, { ...problem, solutionJson: problem.sheetJson }, lastSavedCells, (partial) => { reviewOut.textContent = partial; });
              reviewOut.replaceChildren(renderMarkdown(review));
              await saveAttemptReview(problem.id, review);
            } catch (e) {
              reviewOut.textContent = `Review failed: ${(e as Error).message}`;
            } finally {
              reviewBtn.disabled = false;
              reviewBtn.textContent = 'AI Review My Work';
            }
          })();
        });
        reviewWrap.append(reviewBtn, reviewOut);
        header.appendChild(reviewWrap);
      }
    };
    headerHost.replaceChildren(header);
    paintHeader();
    const base = open ? (parseWorkbook(open.cellsJson) as IWorkbookData | null) : null;
    await mountSheet(applySolutionVisibility((base ?? parseWorkbook(problem.sheetJson)) as IWorkbookData, revealed));
    const mounted = host as IWorksheetHost | null;
    lastSavedCells = open?.cellsJson ?? JSON.stringify(mounted?.getSnapshot() ?? null);
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
          return;
        }
        if (item.sheetJson) {
          await initProblem(item, await getOpenAttempt(itemId));
          return;
        }
        renderItemHeader();
        const open = await getOpenAttempt(itemId);
        const snap = open ? parseWorkbook(open.cellsJson) : null;
        await mountSheet(snap ?? parseWorkbook(item.givensJson));
        // Baseline = what the sheet holds RIGHT AFTER mount. Autosave only
        // writes when the snapshot moves off this baseline — without it,
        // merely opening an item wrote the givens as an "attempt" and
        // flagged it In Progress forever (M99 review).
        // TS narrows `host` to null here (it is assigned inside mountSheet,
        // which control-flow analysis does not see through) — cast resets it.
        const mounted = host as IWorksheetHost | null;
        lastSavedCells = open?.cellsJson ?? JSON.stringify(mounted?.getSnapshot() ?? null);
        autosaveTimer = setInterval(() => { void persistWorking(); }, AUTOSAVE_MS);
      } else {
        // Scratch sheet: a slim bar so export is reachable without an item.
        const bar = el('div', 'ws-scratchbar');
        bar.appendChild(el('span', 'ws-scratchbar__label', 'Scratch Sheet'));
        const spacer = el('div'); spacer.style.flex = '1';
        bar.appendChild(spacer);
        scratchThemeBtn = makeSheetThemeButton();
        bar.appendChild(scratchThemeBtn);
        const exportBtn = el('button', 'ws-btn') as HTMLButtonElement;
        exportBtn.textContent = 'Export to Excel';
        exportBtn.title = 'Save this sheet as a real .xlsx (values and formulas) in your Downloads folder.';
        exportBtn.addEventListener('click', () => {
          if (!host?.exportToXlsx('scratch-sheet')) {
            void _api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
          }
        });
        bar.appendChild(exportBtn);
        headerHost.appendChild(bar);
        await mountSheet(_scratchCache.get(instanceId) ?? null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      loading.textContent = `The sheet engine failed to load: ${message}`;
      console.error('[Worksheet] engine load failed:', err);
    }
  })();

  return {
    saveViewState: () => {
      void persistWorking();
      return { instanceId };
    },
    restoreViewState: (_state: unknown) => {
      // State rides SQLite (items) / the scratch cache (scratch), applied in
      // the async init above. Nothing positional to restore yet.
    },
    dispose: () => {
      if (autosaveTimer) clearInterval(autosaveTimer);
      if (problemTimer) clearInterval(problemTimer);
      // Capture-before-teardown so close-without-save cannot drop work.
      void persistWorking();
      disposed = true;
      _appearanceListeners.delete(applyAppearance);
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
        if (instanceId === 'home') return createHomePane(container);
        if (instanceId === 'create') return createGeneratePane(container);
        if (instanceId === 'excel-import') return createExcelImportPane(container);
        if (instanceId === 'practice') return createPracticeConfigPane(container);
        if (instanceId === 'practice-run') return createPracticeRunPane(container);
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

  // The AI's read surface: bank/progress + the user's actual sheet work.
  registerWorksheetChatTools(api, context.subscriptions);
}

export function deactivate(): void {
  _api = null;
  _scratchCache.clear();
}
