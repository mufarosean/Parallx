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
  listItems, getItem, deleteItem, getOpenAttempt, saveAttemptCells,
  discardOpenAttempt, completeAttempt, onWorksheetDataChanged,
  type WorksheetItem,
} from './worksheetData.js';
import './worksheet.css';

// ── API typings (structural — the tool API surface) ─────────────────────────

interface ParallxApiLike {
  editors: {
    registerEditorProvider(typeId: string, provider: unknown): { dispose(): void };
    openEditor(options: {
      typeId: string; title: string; iconHtml?: string; instanceId?: string;
    }): Promise<void>;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
  };
  window?: {
    showConfirmModal?(options: { message: string; detail?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
    showWarningMessage?(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showInformationMessage?(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage?(message: string): Promise<unknown>;
  };
}

interface ToolContextLike {
  subscriptions: { push(d: { dispose(): void }): void };
}

let _api: ParallxApiLike | null = null;

/** Scratch-sheet snapshots cached across pane rebuilds (in-memory only). */
const _scratchCache = new Map<string, IWorkbookData>();

const WS_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

const AUTOSAVE_MS = 5000;

// ── Univer bundle loader ────────────────────────────────────────────────────

type UniverHostModule = {
  createWorksheetHost(opts: { container: HTMLElement; snapshot?: IWorkbookData | null }): IWorksheetHost;
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
    head.appendChild(el('div', 'ws-home__title', 'Practice Items'));
    const spacer = el('div'); spacer.style.flex = '1';
    head.appendChild(spacer);
    const scratchBtn = el('button', 'ws-btn') as HTMLButtonElement;
    scratchBtn.textContent = 'Open Scratch Sheet';
    scratchBtn.addEventListener('click', () => void openWorksheet('scratch', 'Practice Sheet'));
    head.appendChild(scratchBtn);
    root.appendChild(head);

    if (items.length === 0) {
      const empty = el('div', 'ws-empty');
      empty.appendChild(el('div', 'ws-empty__headline', 'No practice items yet'));
      empty.appendChild(el('div', 'ws-empty__hint',
        'Items are generated from your study materials and arrive with their model solutions. Until then, the scratch sheet gives you the exam-faithful grid.'));
      root.appendChild(empty);
      return;
    }

    const list = el('div', 'ws-home__list');
    for (const item of items) {
      const row = el('div', 'ws-itemrow');
      const info = el('div', 'ws-itemrow__info');
      const titleRow = el('div', 'ws-itemrow__title', item.title);
      if (item.attemptState === 'open') titleRow.appendChild(el('span', 'ws-chip ws-chip--open', 'In Progress'));
      else if (item.attemptState) titleRow.appendChild(el('span', `ws-chip ws-chip--${item.attemptState}`, gradeLabel(item.attemptState)));
      info.appendChild(titleRow);
      const meta: string[] = [];
      if (item.sourceLabel) meta.push(item.sourcePage > 0 ? `${item.sourceLabel} · p.${item.sourcePage}` : item.sourceLabel);
      if (item.tags) meta.push(item.tags.split(',').filter(Boolean).map((t) => `#${t.trim()}`).join(' '));
      if (item.attemptCount > 0) meta.push(`${item.attemptCount} ${item.attemptCount === 1 ? 'attempt' : 'attempts'}`);
      meta.push(new Date(item.createdAt).toLocaleDateString());
      info.appendChild(el('div', 'ws-itemrow__meta', meta.join(' · ')));
      info.addEventListener('click', () => void openWorksheet(`item:${item.id}`, item.title));
      row.appendChild(info);

      const actions = el('div', 'ws-itemrow__actions');
      const openBtn = el('button', 'ws-btn') as HTMLButtonElement;
      openBtn.textContent = 'Practice';
      openBtn.addEventListener('click', () => void openWorksheet(`item:${item.id}`, item.title));
      actions.appendChild(openBtn);
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
      row.appendChild(actions);
      list.appendChild(row);
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

function gradeLabel(grade: string): string {
  switch (grade) {
    case 'nailed': return 'Nailed It';
    case 'partial': return 'Partial';
    case 'missed': return 'Missed';
    default: return grade;
  }
}

// ── Sheet panes (scratch + item player) ─────────────────────────────────────

function createSheetPane(container: HTMLElement, instanceId: string) {
  const itemId = instanceId.startsWith('item:') ? Number(instanceId.slice(5)) : null;

  const root = el('div', 'ws-pane');
  const headerHost = el('div');
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
    await saveAttemptCells(itemId, json).catch((err) => {
      console.error('[Worksheet] attempt autosave failed:', err);
    });
  };

  const mountSheet = async (snapshot: IWorkbookData | null): Promise<void> => {
    const mod = await loadUniverModule();
    if (disposed) return;
    loading.remove();
    host?.dispose();
    sheetHost.replaceChildren();
    host = mod.createWorksheetHost({ container: sheetHost, snapshot });
  };

  const renderItemHeader = () => {
    if (!item) return;
    headerHost.replaceChildren();
    const header = el('div', 'ws-item__header');
    const titleRow = el('div', 'ws-item__titlerow');
    titleRow.appendChild(el('div', 'ws-item__title', item.title));
    const spacer = el('div'); spacer.style.flex = '1';
    titleRow.appendChild(spacer);

    if (mode === 'working') {
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

    if (item.questionMd) {
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
        for (const [grade, label] of [['nailed', 'Nailed It'], ['partial', 'Partially'], ['missed', 'Missed It']] as const) {
          const b = el('button', `ws-btn ws-btn--grade ws-btn--grade-${grade}`) as HTMLButtonElement;
          b.textContent = label;
          b.addEventListener('click', () => {
            void (async () => {
              if (!item) return;
              revealed = true;
              await completeAttempt(item.id, grade, lastSavedCells);
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

  void (async () => {
    try {
      if (itemId != null) {
        item = await getItem(itemId);
        if (!item) {
          loading.textContent = 'This practice item no longer exists.';
          return;
        }
        renderItemHeader();
        const open = await getOpenAttempt(itemId);
        lastSavedCells = open?.cellsJson ?? '';
        const snap = open ? parseWorkbook(open.cellsJson) : null;
        await mountSheet(snap ?? parseWorkbook(item.givensJson));
        autosaveTimer = setInterval(() => { void persistWorking(); }, AUTOSAVE_MS);
      } else {
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
      // Capture-before-teardown so close-without-save cannot drop work.
      void persistWorking();
      disposed = true;
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
  await runMigrations();

  context.subscriptions.push(
    api.editors.registerEditorProvider('worksheet', {
      createEditorPane: (container: HTMLElement, input?: { id?: string; instanceId?: string }) => {
        // Provenance contract (M98 lesson): key on instanceId, never parse
        // the namespaced input.id.
        const instanceId = input?.instanceId ?? input?.id ?? 'home';
        return instanceId === 'home'
          ? createHomePane(container)
          : createSheetPane(container, instanceId);
      },
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('worksheet.open', () => openWorksheet('home', 'Worksheets')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.openScratch', () => openWorksheet('scratch', 'Practice Sheet')),
  );
}

export function deactivate(): void {
  _api = null;
  _scratchCache.clear();
}
