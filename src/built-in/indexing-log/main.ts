// Indexing Log — built-in panel tool for Parallx
//
// Provides a real-time scrollable log of files and pages being indexed.
// Shows success/skip/error status for each source with timestamps.
//
// Pattern: Panel view contribution (same as Output tool).

import './indexingLog.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { IIndexingPipelineService } from '../../services/serviceTypes.js';
import type { IIndexingPipelineService as IndexingPipelineServiceShape } from '../../services/serviceTypes.js';
import type { IndexingProgress, IndexingSourceResult } from '../../services/indexingPipeline.js';

// ── SVG Icons (Codicon-style, 16×16) ────────────────────────────────────────

const ICON_CHECK = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`;
const ICON_SKIP = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 8a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 8z"/></svg>`;
const ICON_ERROR = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.06 4.94a.75.75 0 010 1.06L9.06 8l2 2a.75.75 0 11-1.06 1.06L8 9.06l-2 2a.75.75 0 01-1.06-1.06l2-2-2-2a.75.75 0 011.06-1.06L8 6.94l2-2a.75.75 0 011.06 0z"/></svg>`;
const ICON_PAGE = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 1h7l3 3v9.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11A1.5 1.5 0 014.5 1H3zm7 0v3h3"/></svg>`;
const ICON_FILE = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.57 1H4.5A1.5 1.5 0 003 2.5v11A1.5 1.5 0 004.5 15h7a1.5 1.5 0 001.5-1.5V3.43L10.57 1zM10 2l2 2h-2V2zM4.5 2H9v3h3v8.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5z"/></svg>`;
const ICON_CLEAR = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm2.78 3.22a.75.75 0 010 1.06L9.06 8l1.72 1.72a.75.75 0 11-1.06 1.06L8 9.06l-1.72 1.72a.75.75 0 01-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 011.06-1.06L8 6.94l1.72-1.72a.75.75 0 011.06 0z"/></svg>`;
const ICON_FILTER = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 2h13l-5 6v4.5L7.5 14V8L1.5 2z"/></svg>`;

// ── Local API type ───────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: { name?: string; icon?: string }): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}

// ── State ────────────────────────────────────────────────────────────────────

/** Max entries to keep (circular buffer). */
const MAX_ENTRIES = 2000;

/** All log entries. */
const entries: IndexingLogEntry[] = [];

/** Current filter: null = show all, 'error' = errors only. */
let currentFilter: 'error' | null = null;

/** Whether auto-scroll is enabled (scroll to bottom on new entries). */
let autoScroll = true;

/** DOM references for the active view. */
let listEl: HTMLElement | null = null;
let headerEl: HTMLElement | null = null;
let countEls: { total: HTMLElement; indexed: HTMLElement; skipped: HTMLElement; errors: HTMLElement } | null = null;

/** Live subscription state for the current indexing pipeline instance. */
let activePipeline: IndexingPipelineServiceShape | null = null;
let activePipelineSubscriptions: IDisposable[] = [];

/** Running counters. */
let totalCount = 0;
let indexedCount = 0;
let skippedCount = 0;
let errorCount = 0;

/** Current phase label. */
let currentPhaseLabel = 'Idle';

interface IndexingLogEntry {
  readonly timestamp: number;
  readonly result: IndexingSourceResult;
}

// ── Activation ───────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  const disposePipelineSubscriptions = (): void => {
    for (const subscription of activePipelineSubscriptions) {
      try {
        subscription.dispose();
      } catch {
        // Best effort cleanup only.
      }
    }
    activePipelineSubscriptions = [];
  };

  const bindToPipeline = (pipeline: IndexingPipelineServiceShape | null): void => {
    if (activePipeline === pipeline) {
      return;
    }

    disposePipelineSubscriptions();
    activePipeline = pipeline;

    if (!pipeline) {
      currentPhaseLabel = 'Idle';
      refreshHeader();
      return;
    }

    activePipelineSubscriptions.push(
      pipeline.onDidIndexSource((result) => {
        addEntry(result);
      }),
    );

    activePipelineSubscriptions.push(
      pipeline.onDidChangeProgress((progress) => {
        updatePhaseHeader(progress);
      }),
    );

    activePipelineSubscriptions.push(
      pipeline.onDidCompleteInitialIndex((stats) => {
        currentPhaseLabel = `Complete — ${stats.pages} pages, ${stats.files} files in ${(stats.durationMs / 1000).toFixed(1)}s`;

        const dbTotal = stats.pages + stats.files;
        if (dbTotal > 0 && totalCount === 0) {
          totalCount = dbTotal;
          indexedCount = dbTotal;
        }

        refreshHeader();
      }),
    );

    if (pipeline.isIndexing) {
      updatePhaseHeader(pipeline.progress);
    } else if (pipeline.isInitialIndexComplete) {
      currentPhaseLabel = 'Complete';
      refreshHeader();
    } else {
      currentPhaseLabel = 'Idle';
      refreshHeader();
    }
  };

  const refreshPipelineBinding = (): void => {
    const pipeline = api.services.has(IIndexingPipelineService)
      ? api.services.get<IIndexingPipelineService>(IIndexingPipelineService)
      : null;

    if (!pipeline && !activePipeline) {
      console.warn('[IndexingLog] IIndexingPipelineService not available — panel will be empty');
    }

    bindToPipeline(pipeline);
  };

  refreshPipelineBinding();

  const rebindingTimer = window.setInterval(() => {
    refreshPipelineBinding();
  }, 1000);
  context.subscriptions.push({
    dispose() {
      window.clearInterval(rebindingTimer);
      disposePipelineSubscriptions();
      activePipeline = null;
    },
  });

  // Register view provider for the panel tab
  const viewDisposable = api.views.registerViewProvider('view.indexingLog', {
    createView(container: HTMLElement): IDisposable {
      return renderIndexingLogView(container);
    },
  });
  context.subscriptions.push(viewDisposable);

  // Register commands
  const clearCmd = api.commands.registerCommand('indexingLog.clear', () => {
    entries.length = 0;
    totalCount = 0;
    indexedCount = 0;
    skippedCount = 0;
    errorCount = 0;
    refreshView();
  });
  context.subscriptions.push(clearCmd);

  const toggleFilterCmd = api.commands.registerCommand('indexingLog.toggleErrorFilter', () => {
    currentFilter = currentFilter === 'error' ? null : 'error';
    refreshView();
  });
  context.subscriptions.push(toggleFilterCmd);
}

export function deactivate(): void {
  listEl = null;
  headerEl = null;
  countEls = null;
}

// ── Entry Management ─────────────────────────────────────────────────────────

function addEntry(result: IndexingSourceResult): void {
  entries.push({ timestamp: Date.now(), result });

  // Trim old entries
  if (entries.length > MAX_ENTRIES) { entries.shift(); }

  // Update counters
  totalCount++;
  switch (result.status) {
    case 'indexed': indexedCount++; break;
    case 'skipped': skippedCount++; break;
    case 'error': errorCount++; break;
  }

  refreshView();
}

function updatePhaseHeader(progress: IndexingProgress): void {
  switch (progress.phase) {
    case 'idle':
      currentPhaseLabel = 'Idle';
      break;
    case 'pages':
      currentPhaseLabel = `Indexing pages... ${progress.processed}/${progress.total}`;
      break;
    case 'files':
      currentPhaseLabel = `Indexing files... ${progress.processed}/${progress.total}`;
      break;
    case 'incremental':
      currentPhaseLabel = `Re-indexing: ${progress.currentSource ?? '...'}`;
      break;
  }
  refreshHeader();
}

// ── View Rendering ───────────────────────────────────────────────────────────

function renderIndexingLogView(container: HTMLElement): IDisposable {
  container.classList.add('indexing-log-container');

  // ── Header bar ──
  const header = $('div.indexing-log-header');

  const titleSpan = $('span.indexing-log-title');
  titleSpan.textContent = 'INDEXING';
  header.appendChild(titleSpan);

  const phaseSpan = $('span.indexing-log-phase');
  phaseSpan.textContent = currentPhaseLabel;
  header.appendChild(phaseSpan);

  // Spacer
  header.appendChild($('span.indexing-log-spacer'));

  // Filter button
  const filterBtn = $('button.indexing-log-toolbar-btn');
  filterBtn.innerHTML = ICON_FILTER;
  filterBtn.title = 'Toggle: show errors only';
  filterBtn.addEventListener('click', () => {
    currentFilter = currentFilter === 'error' ? null : 'error';
    filterBtn.classList.toggle('indexing-log-toolbar-btn--active', currentFilter === 'error');
    refreshList();
  });
  header.appendChild(filterBtn);

  // Clear button
  const clearBtn = $('button.indexing-log-toolbar-btn');
  clearBtn.innerHTML = ICON_CLEAR;
  clearBtn.title = 'Clear log';
  clearBtn.addEventListener('click', () => {
    entries.length = 0;
    totalCount = 0;
    indexedCount = 0;
    skippedCount = 0;
    errorCount = 0;
    refreshView();
  });
  header.appendChild(clearBtn);

  container.appendChild(header);

  // ── Summary bar ──
  const summary = $('div.indexing-log-summary');

  const totalEl = $('span.indexing-log-count.indexing-log-count--total');
  totalEl.textContent = `Total: ${totalCount}`;
  summary.appendChild(totalEl);

  const indexedEl = $('span.indexing-log-count.indexing-log-count--indexed');
  indexedEl.textContent = `Indexed: ${indexedCount}`;
  summary.appendChild(indexedEl);

  const skippedEl = $('span.indexing-log-count.indexing-log-count--skipped');
  skippedEl.textContent = `Skipped: ${skippedCount}`;
  summary.appendChild(skippedEl);

  const errorsEl = $('span.indexing-log-count.indexing-log-count--errors');
  errorsEl.textContent = `Errors: ${errorCount}`;
  summary.appendChild(errorsEl);

  container.appendChild(summary);

  // ── Scrollable log list ──
  const list = $('div.indexing-log-list');
  container.appendChild(list);

  // Store refs
  listEl = list;
  headerEl = phaseSpan;
  countEls = { total: totalEl, indexed: indexedEl, skipped: skippedEl, errors: errorsEl };

  // Handle scroll — disable auto-scroll when user scrolls up
  list.addEventListener('scroll', () => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
    autoScroll = atBottom;
  });

  // Initial render
  refreshList();

  return {
    dispose() {
      listEl = null;
      headerEl = null;
      countEls = null;
      container.innerHTML = '';
    },
  };
}

// ── Refresh Helpers ──────────────────────────────────────────────────────────

function refreshView(): void {
  refreshHeader();
  refreshCounts();
  refreshList();
}

function refreshHeader(): void {
  if (headerEl) {
    headerEl.textContent = currentPhaseLabel;
  }
}

function refreshCounts(): void {
  if (!countEls) { return; }
  countEls.total.textContent = `Total: ${totalCount}`;
  countEls.indexed.textContent = `Indexed: ${indexedCount}`;
  countEls.skipped.textContent = `Skipped: ${skippedCount}`;
  countEls.errors.textContent = `Errors: ${errorCount}`;

  // Highlight errors count if > 0
  countEls.errors.classList.toggle('indexing-log-count--has-errors', errorCount > 0);
}

function refreshList(): void {
  if (!listEl) { return; }

  const filtered = currentFilter === 'error'
    ? entries.filter((e) => e.result.status === 'error')
    : entries;

  // Build DOM — use DocumentFragment for performance
  const fragment = document.createDocumentFragment();

  for (const entry of filtered) {
    fragment.appendChild(createEntryRow(entry));
  }

  listEl.innerHTML = '';
  listEl.appendChild(fragment);

  // Auto-scroll
  if (autoScroll) {
    listEl.scrollTop = listEl.scrollHeight;
  }
}

function createEntryRow(entry: IndexingLogEntry): HTMLElement {
  const { result, timestamp } = entry;
  const row = $('div.indexing-log-row');
  row.classList.add(`indexing-log-row--${result.status}`);

  // Timestamp
  const ts = $('span.indexing-log-ts');
  const d = new Date(timestamp);
  ts.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  row.appendChild(ts);

  // Status icon
  const icon = $('span.indexing-log-icon');
  switch (result.status) {
    case 'indexed': icon.innerHTML = ICON_CHECK; break;
    case 'skipped': icon.innerHTML = ICON_SKIP; break;
    case 'error': icon.innerHTML = ICON_ERROR; break;
  }
  row.appendChild(icon);

  // Type icon (page vs file)
  const typeIcon = $('span.indexing-log-type-icon');
  typeIcon.innerHTML = result.type === 'page' ? ICON_PAGE : ICON_FILE;
  typeIcon.title = result.type === 'page' ? 'Canvas page' : 'Workspace file';
  row.appendChild(typeIcon);

  // Source name — shorten file paths to relative
  const nameSpan = $('span.indexing-log-name');
  nameSpan.textContent = shortenPath(result.source);
  nameSpan.title = result.source; // full path on hover
  row.appendChild(nameSpan);

  // Duration
  const duration = $('span.indexing-log-duration');
  duration.textContent = result.durationMs < 1000
    ? `${Math.round(result.durationMs)}ms`
    : `${(result.durationMs / 1000).toFixed(1)}s`;
  row.appendChild(duration);

  // M21 F.1: Pipeline badge
  if (result.pipeline && result.status === 'indexed') {
    const badge = $('span.indexing-log-pipeline');
    const pipelineLabels: Record<string, string> = {
      'docling': 'Docling',
      'docling-ocr': 'Docling+OCR',
      'legacy': 'Legacy',
      'text': 'Text',
    };
    badge.textContent = pipelineLabels[result.pipeline] ?? result.pipeline;
    badge.classList.add(`indexing-log-pipeline--${result.pipeline}`);
    if (result.fallback) {
      badge.classList.add('indexing-log-pipeline--fallback');
      badge.title = 'Docling failed — fell back to legacy extractor';
    }
    row.appendChild(badge);
  }

  // Error message (if any)
  if (result.error) {
    const err = $('span.indexing-log-error');
    err.textContent = result.error;
    err.title = result.error;
    row.appendChild(err);
  }

  return row;
}

// ── Utility Helpers ──────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Shorten a file path for display — strip common prefixes, keep the
 * last 2-3 path segments.
 */
function shortenPath(source: string): string {
  // For page titles, return as-is
  if (!source.includes('/') && !source.includes('\\')) {
    return source;
  }

  // Normalize separators
  const normalized = source.replace(/\\/g, '/');
  const parts = normalized.split('/');

  // Show last 3 segments max
  if (parts.length <= 3) { return parts.join('/'); }
  return '.../' + parts.slice(-3).join('/');
}
