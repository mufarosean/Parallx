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
import {
  IAutonomyLogService,
  IAutonomyTaskRailService,
  IAutonomyPatternMemoryService,
  IAutonomyFeatureFlagsService,
} from '../../services/serviceTypes.js';
import type {
  AutonomyLogService,
  AutonomyOrigin,
  IAutonomyLogEntry,
} from '../../services/autonomyLogService.js';
import type {
  IAutonomyTaskRailService as IRail,
  IRailRow,
} from '../../services/autonomyTaskRailService.js';
import type {
  IAutonomyPatternMemoryService as IPatternMemory,
  IAutonomyApprovedPattern,
} from '../../services/autonomyPatternMemoryService.js';
import {
  FLAG_PAUSED_GLOBAL,
  type AutonomyFeatureFlagsService,
} from '../../services/autonomyFeatureFlags.js';

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

type LiveFilter = 'all' | AutonomyOrigin;
type RailTriggerFilter =
  | 'all'
  | 'chat'
  | 'heartbeat'
  | 'cron'
  | 'subagent'
  | 'followup'
  | 'file-change'
  | 'replay';
type Mode = 'live' | 'history' | 'patterns';

const ORIGIN_BADGE: Record<string, { label: string; cls: string }> = {
  heartbeat:   { label: 'Heartbeat',   cls: 'heartbeat' },
  cron:        { label: 'Cron',        cls: 'cron' },
  subagent:    { label: 'Subagent',    cls: 'subagent' },
  agent:       { label: 'Agent',       cls: 'agent' },
  chat:        { label: 'Chat',        cls: 'agent' },
  followup:    { label: 'Followup',    cls: 'agent' },
  'file-change': { label: 'File',      cls: 'agent' },
  replay:      { label: 'Replay',      cls: 'agent' },
};

let logService: AutonomyLogService | undefined;
let railService: IRail | undefined;
let patternMemory: IPatternMemory | undefined;
let flagsService: AutonomyFeatureFlagsService | undefined;

let currentMode: Mode = 'live';
let currentLiveFilter: LiveFilter = 'all';
let currentRailFilter: RailTriggerFilter = 'all';

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
  railService = api.services.has(IAutonomyTaskRailService)
    ? api.services.get<IRail>(IAutonomyTaskRailService)
    : undefined;
  patternMemory = api.services.has(IAutonomyPatternMemoryService)
    ? api.services.get<IPatternMemory>(IAutonomyPatternMemoryService)
    : undefined;
  flagsService = api.services.has(IAutonomyFeatureFlagsService)
    ? api.services.get<AutonomyFeatureFlagsService>(IAutonomyFeatureFlagsService)
    : undefined;

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
  railService = undefined;
  patternMemory = undefined;
  flagsService = undefined;
}

// ── View renderer ────────────────────────────────────────────────────────────

function renderAutonomyLogView(container: HTMLElement): IDisposable {
  container.classList.add('autonomy-log-container');

  // ── Header ──
  const header = $('div.autonomy-log-header');

  const summary = $('span.autonomy-log-summary');
  header.appendChild(summary);

  // M60 §8 Phase ζ T5.E2 — global pause toggle (kill-switch).
  // Visible only when the autonomy flags service is bound. Persisted via
  // AutonomyFeatureFlagsService → IStorage.
  let pauseCheckbox: HTMLInputElement | undefined;
  if (flagsService) {
    const pauseLabel = $('label.autonomy-log-pause') as HTMLLabelElement;
    pauseLabel.title = 'Pause every autonomy trigger (heartbeat, cron, sub-agent, followup). Survives reload.';
    pauseCheckbox = document.createElement('input');
    pauseCheckbox.type = 'checkbox';
    pauseCheckbox.checked = flagsService.isEnabled(FLAG_PAUSED_GLOBAL);
    pauseCheckbox.addEventListener('change', () => {
      void flagsService?.setEnabled(FLAG_PAUSED_GLOBAL, pauseCheckbox!.checked);
    });
    pauseLabel.appendChild(pauseCheckbox);
    const pauseText = document.createElement('span');
    pauseText.textContent = ' Pause autonomy';
    pauseLabel.appendChild(pauseText);
    header.appendChild(pauseLabel);
  }

  const spacer = $('span.autonomy-log-spacer');
  header.appendChild(spacer);

  // Mode tabs (live / history / patterns).
  const tabs = $('div.autonomy-log-tabs');
  const tabByMode: Partial<Record<Mode, HTMLButtonElement>> = {};
  const availableModes: Mode[] = ['live'];
  if (railService) availableModes.push('history');
  if (patternMemory) availableModes.push('patterns');
  for (const m of availableModes) {
    const t = $('button.autonomy-log-tab') as HTMLButtonElement;
    t.textContent = m === 'live' ? 'Live' : m === 'history' ? 'History' : 'Patterns';
    t.addEventListener('click', () => {
      currentMode = m;
      paintTabs();
      paintFilters();
      paintAll();
    });
    tabs.appendChild(t);
    tabByMode[m] = t;
  }
  header.appendChild(tabs);

  // Filter chips
  const filters = $('div.autonomy-log-filters');
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
    if (currentMode === 'patterns') {
      if (patternMemory && confirm('Forget every approved sub-agent pattern?')) {
        void patternMemory.clear();
      }
      return;
    }
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
  const liveChipKeys: readonly LiveFilter[] = ['all', 'heartbeat', 'cron', 'subagent'];
  const railChipKeys: readonly RailTriggerFilter[] = [
    'all', 'chat', 'heartbeat', 'cron', 'subagent', 'followup', 'file-change', 'replay',
  ];

  function paintTabs(): void {
    for (const [m, btn] of Object.entries(tabByMode)) {
      btn?.classList.toggle('autonomy-log-tab--active', m === currentMode);
    }
  }

  function paintFilters(): void {
    filters.innerHTML = '';
    if (currentMode === 'patterns') return;
    const keys = currentMode === 'live' ? liveChipKeys : railChipKeys;
    const active = currentMode === 'live' ? currentLiveFilter : currentRailFilter;
    for (const f of keys) {
      const chip = $('button.autonomy-log-chip') as HTMLButtonElement;
      chip.dataset.filter = f;
      chip.textContent = f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1);
      if (f === active) chip.classList.add('autonomy-log-chip--active');
      chip.addEventListener('click', () => {
        if (currentMode === 'live') currentLiveFilter = f as LiveFilter;
        else currentRailFilter = f as RailTriggerFilter;
        paintFilters();
        paintList();
      });
      filters.appendChild(chip);
    }
  }

  function paintSummary(): void {
    if (currentMode === 'patterns') {
      const count = patternMemory?.list().length ?? 0;
      summary.textContent = count === 0
        ? 'No approved patterns'
        : `${count} approved ${count === 1 ? 'pattern' : 'patterns'}`;
      summary.classList.remove('autonomy-log-summary--unread');
      return;
    }
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
    if (currentMode === 'patterns') {
      paintPatternList();
      return;
    }
    if (currentMode === 'history') {
      paintHistoryList();
      return;
    }
    if (!logService) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }
    const originFilter = currentLiveFilter === 'all' ? undefined : currentLiveFilter;
    const entries = logService.getEntries({ limit: 200, origin: originFilter });
    listEl.innerHTML = '';
    if (entries.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';
    for (const entry of entries) {
      listEl.appendChild(renderLiveEntry(entry));
    }
  }

  async function paintHistoryList(): Promise<void> {
    listEl.innerHTML = '';
    if (!railService) {
      emptyEl.style.display = '';
      return;
    }
    const triggers = currentRailFilter === 'all' ? undefined : [currentRailFilter];
    const rows = await railService.readRows({
      sinceDays: 30,
      limit: 200,
      triggers: triggers as never,
    });
    if (rows.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';
    for (const row of rows) {
      listEl.appendChild(renderRailRow(row));
    }
  }

  function paintPatternList(): void {
    listEl.innerHTML = '';
    if (!patternMemory) {
      emptyEl.style.display = '';
      return;
    }
    const patterns = patternMemory.list();
    if (patterns.length === 0) {
      emptyEl.textContent =
        'No approved sub-agent patterns yet. When you approve a spawn and choose "remember", it will appear here.';
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';
    for (const p of patterns) {
      listEl.appendChild(renderPatternRow(p));
    }
  }

  function renderLiveEntry(entry: IAutonomyLogEntry): HTMLElement {
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

  function renderRailRow(rrow: IRailRow): HTMLElement {
    const row = $('div.autonomy-log-entry');
    const head = $('div.autonomy-log-entry__header');
    const trig = rrow.trigger;
    const badgeMeta = ORIGIN_BADGE[trig] ?? { label: trig, cls: 'agent' };
    const badge = $(`span.autonomy-log-badge.autonomy-log-badge--${badgeMeta.cls}`);
    badge.textContent = badgeMeta.label;
    head.appendChild(badge);

    const label = $('span.autonomy-log-entry__label');
    if (rrow.kind === 'live') {
      label.textContent = rrow.requestText;
    } else {
      const dur = rrow.durationMs !== undefined ? ` · ${rrow.durationMs}ms` : '';
      const note = rrow.note ? ` · ${rrow.note}` : '';
      label.textContent = `${rrow.outcome}${dur}${note}`;
    }
    head.appendChild(label);

    const time = $('span.autonomy-log-entry__time');
    time.textContent = formatTime(new Date(rrow.triggeredAt).getTime());
    head.appendChild(time);

    row.appendChild(head);

    if (rrow.kind === 'live') {
      const body = $('div.autonomy-log-entry__body');
      body.textContent = rrow.content;
      row.appendChild(body);
    }
    return row;
  }

  function renderPatternRow(p: IAutonomyApprovedPattern): HTMLElement {
    const row = $('div.autonomy-log-entry');
    const head = $('div.autonomy-log-entry__header');

    const badge = $('span.autonomy-log-badge.autonomy-log-badge--agent');
    badge.textContent = 'Pattern';
    head.appendChild(badge);

    const label = $('span.autonomy-log-entry__label');
    label.textContent = p.label || p.id;
    head.appendChild(label);

    const time = $('span.autonomy-log-entry__time');
    time.textContent = `${p.matchCount} match${p.matchCount === 1 ? '' : 'es'}`;
    head.appendChild(time);

    row.appendChild(head);

    const body = $('div.autonomy-log-entry__body');
    const approvedAt = new Date(p.approvedAt).toLocaleString();
    body.textContent = `Approved ${approvedAt}. ID: ${p.id}.`;
    row.appendChild(body);

    const actions = $('div.autonomy-log-entry__actions');
    const revoke = $('button.autonomy-log-action') as HTMLButtonElement;
    revoke.textContent = 'Revoke';
    revoke.title = 'Forget this approval';
    revoke.addEventListener('click', () => {
      void patternMemory?.revoke(p.id).then(() => paintAll());
    });
    actions.appendChild(revoke);
    row.appendChild(actions);
    return row;
  }

  function paintAll(): void {
    paintSummary();
    paintList();
  }

  // Initial paint
  paintTabs();
  paintFilters();
  paintAll();

  // Live updates — rAF-coalesced to soak up bursts.
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      // Sync pause checkbox with possible external state changes.
      if (pauseCheckbox && flagsService) {
        pauseCheckbox.checked = flagsService.isEnabled(FLAG_PAUSED_GLOBAL);
      }
      paintAll();
    });
  };
  const subLog = logService?.onDidChange(schedule);
  const subRail = railService?.onDidChange(schedule);
  const subFlags = flagsService?.onDidChange(schedule);

  return {
    dispose(): void {
      subLog?.dispose();
      subRail?.dispose();
      subFlags?.dispose();
    },
  };
}
