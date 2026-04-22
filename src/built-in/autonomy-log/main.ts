// Autonomy Log — built-in panel tool for Parallx
//
// The primary UI for heartbeat / cron / subagent run results. These
// deliveries used to inject themselves into the chat transcript
// (M58-real post-ship was the second-pass fix), which made actual
// conversation hard to read. This panel view displays the same stream
// in a purpose-built tab next to Indexing Log and AI Diagnostics, where
// you can scan activity without the overlay cost of AI Settings.
//
// The agent reads the same data via the `autonomy_log` built-in tool,
// so the log doubles as its memory of what happened while the user
// wasn't on turn.
//
// Pattern: Panel view contribution (same as indexing-log tool).

import './autonomyLog.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { IAutonomyLogService } from '../../services/serviceTypes.js';
import type {
  AutonomyLogService,
  AutonomyOrigin,
  IAutonomyLogEntry,
} from '../../services/autonomyLogService.js';

// ── Local API type ───────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(
      viewId: string,
      provider: { createView(container: HTMLElement): IDisposable },
      options?: { name?: string; icon?: string },
    ): IDisposable;
  };
  commands: {
    registerCommand(commandId: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  services: {
    has(id: unknown): boolean;
    get<T>(id: unknown): T;
  };
}

// ── State ────────────────────────────────────────────────────────────────────

type Filter = 'all' | AutonomyOrigin;

const ORIGIN_BADGE: Record<string, { label: string; cls: string }> = {
  heartbeat: { label: 'Heartbeat', cls: 'heartbeat' },
  cron:      { label: 'Cron',      cls: 'cron' },
  subagent:  { label: 'Subagent',  cls: 'subagent' },
  agent:     { label: 'Agent',     cls: 'agent' },
};

let logService: AutonomyLogService | undefined;
let currentFilter: Filter = 'all';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ── Activation ───────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  const svc = api.services.has(IAutonomyLogService)
    ? api.services.get<AutonomyLogService>(IAutonomyLogService)
    : undefined;
  logService = svc;

  const viewDisposable = api.views.registerViewProvider('view.autonomyLog', {
    createView(container: HTMLElement): IDisposable {
      return renderAutonomyLogView(container);
    },
  });
  context.subscriptions.push(viewDisposable);

  const markAllCmd = api.commands.registerCommand('autonomyLog.markAllRead', () => {
    logService?.markRead();
  });
  context.subscriptions.push(markAllCmd);

  const clearCmd = api.commands.registerCommand('autonomyLog.clear', () => {
    logService?.clear();
  });
  context.subscriptions.push(clearCmd);
}

export function deactivate(): void {
  logService = undefined;
}

// ── View renderer ────────────────────────────────────────────────────────────

function renderAutonomyLogView(container: HTMLElement): IDisposable {
  container.classList.add('autonomy-log-container');

  // ── Header ──
  const header = $('div.autonomy-log-header');

  const summary = $('span.autonomy-log-summary');
  header.appendChild(summary);

  const spacer = $('span.autonomy-log-spacer');
  header.appendChild(spacer);

  // Filter chips
  const filters = $('div.autonomy-log-filters');
  const chipByFilter: Record<string, HTMLButtonElement> = Object.create(null);
  for (const f of ['all', 'heartbeat', 'cron', 'subagent'] as const) {
    const chip = $('button.autonomy-log-chip') as HTMLButtonElement;
    chip.dataset.filter = f;
    chip.textContent = f[0].toUpperCase() + f.slice(1);
    chip.addEventListener('click', () => {
      currentFilter = f;
      paintChips();
      paintList();
    });
    filters.appendChild(chip);
    chipByFilter[f] = chip;
  }
  header.appendChild(filters);

  // Actions
  const markAll = $('button.autonomy-log-action') as HTMLButtonElement;
  markAll.textContent = 'Mark all read';
  markAll.title = 'Mark every entry as read';
  markAll.addEventListener('click', () => { logService?.markRead(); });
  header.appendChild(markAll);

  const clearBtn = $('button.autonomy-log-action') as HTMLButtonElement;
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Remove all entries';
  clearBtn.addEventListener('click', () => {
    if (confirm('Clear the entire autonomy log?')) logService?.clear();
  });
  header.appendChild(clearBtn);

  container.appendChild(header);

  // ── Body ──
  const listEl = $('div.autonomy-log-list');
  const emptyEl = $('div.autonomy-log-empty');
  emptyEl.textContent =
    'No autonomy activity yet. Heartbeat, cron, and subagent results will appear here.';
  container.appendChild(listEl);
  container.appendChild(emptyEl);

  // ── Render helpers ──
  function paintChips(): void {
    for (const [f, chip] of Object.entries(chipByFilter)) {
      chip.classList.toggle('autonomy-log-chip--active', f === currentFilter);
    }
  }

  function paintSummary(): void {
    if (!logService) {
      summary.textContent = 'Autonomy log service unavailable';
      return;
    }
    const total = logService.size;
    const unread = logService.getUnreadCount();
    if (total === 0) {
      summary.textContent = '';
      summary.classList.remove('autonomy-log-summary--unread');
      return;
    }
    summary.textContent = unread > 0 ? `${unread} new · ${total} total` : `${total} total`;
    summary.classList.toggle('autonomy-log-summary--unread', unread > 0);
  }

  function paintList(): void {
    if (!logService) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }

    const originFilter = currentFilter === 'all' ? undefined : currentFilter;
    const entries = logService.getEntries({ limit: 200, origin: originFilter });

    listEl.innerHTML = '';
    if (entries.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    for (const entry of entries) {
      listEl.appendChild(renderEntry(entry));
    }
  }

  function renderEntry(entry: IAutonomyLogEntry): HTMLElement {
    const row = $('div.autonomy-log-entry');
    if (!entry.read) row.classList.add('autonomy-log-entry--unread');

    const head = $('div.autonomy-log-entry__header');
    const badgeMeta = ORIGIN_BADGE[entry.origin] ?? { label: entry.origin, cls: 'agent' };
    const badge = $(`span.autonomy-log-badge.autonomy-log-badge--${badgeMeta.cls}`);
    badge.textContent = badgeMeta.label;
    head.appendChild(badge);

    const label = $('span.autonomy-log-entry__label');
    label.textContent = entry.requestText;
    head.appendChild(label);

    const time = $('span.autonomy-log-entry__time');
    time.textContent = formatTime(entry.timestamp);
    head.appendChild(time);

    row.appendChild(head);

    const body = $('div.autonomy-log-entry__body');
    body.textContent = entry.content;
    row.appendChild(body);

    row.addEventListener('click', () => {
      if (!entry.read) logService?.markRead([entry.id]);
    });

    return row;
  }

  function paintAll(): void {
    paintSummary();
    paintList();
  }

  // Initial paint
  paintChips();
  paintAll();

  // Live updates — rAF-coalesced to soak up bursts.
  let pending = false;
  const sub = logService?.onDidChange(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      paintAll();
    });
  });

  return {
    dispose(): void {
      sub?.dispose();
    },
  };
}
