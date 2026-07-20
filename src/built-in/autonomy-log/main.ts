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

import { EMPTY_STATES } from '../../ui/emptyStates.js';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { getIcon } from '../../ui/iconRegistry.js';
import {
  IAutonomyLogService,
  IAutonomyTaskRailService,
  IAutonomyPatternMemoryService,
  IAutonomyFeatureFlagsService,
  IUnifiedAIConfigService,
} from '../../services/serviceTypes.js';
import { ICronService } from '../../openclaw/openclawCronService.js';
import type { CronService, ICronJob } from '../../openclaw/openclawCronService.js';
import type { IUnifiedAIConfigService as IUnifiedConfig } from '../../aiSettings/unifiedConfigTypes.js';
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
  FLAG_CRON_ENABLED,
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
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
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
let cronService: CronService | undefined;
let configService: IUnifiedConfig | undefined;
/** Run a workbench command (wake agent, deep-link into settings, …). */
let runCommand: (<T = unknown>(id: string, ...args: unknown[]) => Promise<T>) | undefined;
let apiRef: ParallxApi | undefined;

/**
 * (Re)resolve the autonomy services from DI. The autonomy-log built-in can
 * activate BEFORE the chat extension registers the flags / cron / rail
 * services, so resolving once at `activate()` leaves them `undefined` (status
 * stuck "Off", Enable a no-op). We resolve lazily — at activate AND at view
 * render (+ a one-shot heal) — and only overwrite with a found instance, never
 * clobber a good one with undefined.
 */
function resolveServices(api: ParallxApi): void {
  if (api.services.has(IAutonomyLogService)) logService = api.services.get<AutonomyLogService>(IAutonomyLogService);
  if (api.services.has(IAutonomyTaskRailService)) railService = api.services.get<IRail>(IAutonomyTaskRailService);
  if (api.services.has(IAutonomyPatternMemoryService)) patternMemory = api.services.get<IPatternMemory>(IAutonomyPatternMemoryService);
  if (api.services.has(IAutonomyFeatureFlagsService)) flagsService = api.services.get<AutonomyFeatureFlagsService>(IAutonomyFeatureFlagsService);
  if (api.services.has(ICronService)) cronService = api.services.get<CronService>(ICronService);
  if (api.services.has(IUnifiedAIConfigService)) configService = api.services.get<IUnifiedConfig>(IUnifiedAIConfigService);
  runCommand = (id, ...args) => api.commands.executeCommand(id, ...args);
}

let currentMode: Mode = 'live';
let currentLiveFilter: LiveFilter = 'all';
let currentRailFilter: RailTriggerFilter = 'all';

/**
 * Heartbeat suggestion ids the user has already acted on or dismissed this
 * session. Heartbeat 'ACT' results are the one autonomous output that asks for
 * a decision; we let the user respond from the log (Do it / Tell me more /
 * Dismiss) instead of the dead end of a purged ephemeral session. Log entries
 * are immutable apart from `read`, so we track "handled" here so the buttons
 * don't reappear on the next repaint. Session-scoped — a relaunch drops it,
 * by which point the suggestion is stale anyway.
 */
const handledHeartbeat = new Set<string>();

/** Whether a live log entry is an actionable heartbeat suggestion (test seam). */
export function _isActionableHeartbeat(
  entry: Pick<IAutonomyLogEntry, 'id' | 'origin' | 'content' | 'metadata'>,
  handled: ReadonlySet<string>,
): boolean {
  return (
    entry.origin === 'heartbeat'
    && entry.content.trim().length > 0
    && entry.metadata?.error !== true
    && !handled.has(entry.id)
  );
}

/** Seed prompt sent to the main chat when the user acts on a suggestion (test seam). */
export function _heartbeatSeedPrompt(content: string, instruction: string): string {
  return `A background heartbeat check flagged this:\n\n${content.trim()}\n\n${instruction}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ── Activation ───────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  apiRef = api;
  resolveServices(api);

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
  cronService = undefined;
  configService = undefined;
  runCommand = undefined;
  apiRef = undefined;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

/** Compact "in 2h 5m" / "in 40s" / "now" formatter for a future timestamp. */
function formatUntil(ts: number): string {
  const ms = ts - Date.now();
  if (ms <= 0) return 'now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `in ${h}h ${rem}m` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}

/** Compact "5m ago" / "40s ago" / "just now" formatter for a past timestamp. */
function formatAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m ago` : `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Compact interval label, e.g. 300000 → "5m". */
function formatInterval(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m >= 60 && m % 60 === 0) return `${m / 60}h`;
  if (m >= 1) return `${m}m`;
  return `${Math.round(ms / 1000)}s`;
}

/** The cron job firing soonest (enabled, has a nextRunAt). */
function nextCronJob(jobs: readonly ICronJob[]): ICronJob | undefined {
  let best: ICronJob | undefined;
  for (const j of jobs) {
    if (!j.enabled || j.nextRunAt == null) continue;
    if (!best || (best.nextRunAt != null && j.nextRunAt < best.nextRunAt)) best = j;
  }
  return best;
}

// ── View renderer ────────────────────────────────────────────────────────────

function renderAutonomyLogView(container: HTMLElement): IDisposable {
  container.classList.add('autonomy-log-container');
  // Re-resolve in case services registered after we activated (see resolveServices).
  if (apiRef) resolveServices(apiRef);

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

  header.appendChild($('div.autonomy-log-divider'));

  // Filter chips
  const filters = $('div.autonomy-log-filters');
  header.appendChild(filters);

  header.appendChild($('div.autonomy-log-divider'));

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

  // ── Status board (live mode) — answers "is autonomy on / is it doing anything?" ──
  const statusBoard = $('div.autonomy-status');
  container.appendChild(statusBoard);
  // Whether the Mind row is expanded into its editable belief list (persists
  // across repaints so the panel doesn't collapse when the board refreshes).
  let mindExpanded = false;

  /** The editable Mind panel: the agent's beliefs, each with a "forget" (✕). */
  function buildMindPanel(): HTMLElement {
    const panel = $('div.autonomy-mind-panel');
    panel.textContent = 'Loading the agent’s beliefs…';
    void runCommand?.<{ available?: boolean; beliefs?: { id: string; content: string; confidence: number }[] }>('parallx.mind.status').then((s) => {
      panel.innerHTML = '';
      const beliefs = s && s.available !== false ? (s.beliefs ?? []) : [];
      if (beliefs.length === 0) {
        const empty = $('div.autonomy-mind-panel__empty');
        empty.textContent = `${EMPTY_STATES['mind.noBeliefs'].headline} — ${EMPTY_STATES['mind.noBeliefs'].hint}`;
        panel.appendChild(empty);
        return;
      }
      const hint = $('div.autonomy-mind-panel__hint');
      hint.textContent = 'What the agent believes about you & your work. Forget (✕) anything wrong — you steer the mind.';
      panel.appendChild(hint);

      // Clean slate: wipe every belief at once (for when the accumulated set is
      // noise the user no longer trusts — quicker than forgetting one by one).
      const clearAll = $('button.autonomy-mind-panel__clear') as HTMLButtonElement;
      clearAll.textContent = `Clear all ${beliefs.length} beliefs`;
      clearAll.title = 'Wipe the agent’s entire belief set and start fresh';
      clearAll.addEventListener('click', () => {
        if (!confirm(`Clear all ${beliefs.length} of the agent’s beliefs? This can’t be undone.`)) return;
        void runCommand?.('parallx.mind.clearAll').then(() => { panel.innerHTML = '';
          const empty = $('div.autonomy-mind-panel__empty');
          empty.textContent = 'Beliefs cleared — the agent will form fresh ones as it reviews your work.';
          panel.appendChild(empty);
        }).catch(() => {});
      });
      panel.appendChild(clearAll);

      for (const b of beliefs) {
        const row = $('div.autonomy-mind-belief');
        const text = $('span.autonomy-mind-belief__text');
        text.textContent = `${Math.round((b.confidence ?? 0) * 100)}% · ${b.content}`;
        const forget = $('button.autonomy-mind-belief__forget') as HTMLButtonElement;
        forget.textContent = '✕';
        forget.title = 'Forget this — tell the agent it’s wrong';
        forget.addEventListener('click', (e) => {
          e.stopPropagation();
          void runCommand?.('parallx.mind.forget', { id: b.id }).then(() => { row.remove(); }).catch(() => {});
        });
        row.appendChild(text);
        row.appendChild(forget);
        panel.appendChild(row);
      }
    }).catch(() => { panel.textContent = 'Mind unavailable.'; });
    return panel;
  }

  // ── Body — a single scrollable region (the status board above stays pinned).
  // The list AND the empty/guide both live here so either can scroll. ──
  const body = $('div.autonomy-log-body');
  const listEl = $('div.autonomy-log-list');
  const emptyEl = $('div.autonomy-log-empty');
  body.appendChild(listEl);
  body.appendChild(emptyEl);
  container.appendChild(body);

  // A registered-icon span (Parallx uses the Lucide icon set — never emojis).
  function iconSpan(name: string, cls: string): HTMLElement {
    const span = $(`span.${cls}`);
    span.innerHTML = getIcon(name);
    return span;
  }

  type StateKind = 'on' | 'off' | 'paused';

  // One engine row: icon tile · name + state badge over a detail line · action.
  function statusRow(
    iconName: string,
    badge: { label: string; kind: StateKind },
    title: string,
    detail: string,
    action?: { label: string; icon?: string; run: () => void; primary?: boolean },
  ): HTMLElement {
    const row = $('div.autonomy-status__row');

    const tile = $(`div.autonomy-status__icon.is-${badge.kind}`);
    tile.innerHTML = getIcon(iconName);
    row.appendChild(tile);

    const main = $('div.autonomy-status__main');
    const top = $('div.autonomy-status__top');
    const name = $('span.autonomy-status__name');
    name.textContent = title;
    top.appendChild(name);
    const b = $(`span.autonomy-status__badge.is-${badge.kind}`);
    b.textContent = badge.label;
    top.appendChild(b);
    main.appendChild(top);
    const det = $('div.autonomy-status__detail');
    det.textContent = detail;
    main.appendChild(det);
    row.appendChild(main);

    if (action) {
      const btn = $('button.autonomy-status__btn') as HTMLButtonElement;
      if (action.primary) btn.classList.add('is-primary');
      if (action.icon) btn.appendChild(iconSpan(action.icon, 'autonomy-status__btn-ic'));
      const t = document.createElement('span');
      t.textContent = action.label;
      btn.appendChild(t);
      btn.addEventListener('click', action.run);
      row.appendChild(btn);
    }
    return row;
  }

  function paintStatus(): void {
    statusBoard.innerHTML = '';
    if (currentMode !== 'live') { statusBoard.style.display = 'none'; return; }
    statusBoard.style.display = '';

    const paused = flagsService?.isEnabled(FLAG_PAUSED_GLOBAL) ?? false;

    // Heartbeat — gated by ONE user control (`heartbeat.enabled`) plus the
    // global kill switch. (The old `autonomy.heartbeat.enabled` flag no longer
    // gates the runner; it was a redundant second switch.)
    const hbCfg = configService?.getEffectiveConfig().heartbeat;
    const hbOn = hbCfg?.enabled ?? false;
    if (paused) {
      statusBoard.appendChild(statusRow('heart-pulse', { label: 'Paused', kind: 'paused' },
        'Heartbeat', 'Globally paused — nothing fires.'));
    } else if (hbOn) {
      const iv = hbCfg ? formatInterval(hbCfg.intervalMs) : '30m';
      const baseDetail = `Reviews the app every ${iv} · reacts to changes, diagnostics & signals`;
      const hbRow = statusRow('heart-pulse', { label: 'Armed', kind: 'on' },
        'Heartbeat', baseDetail,
        { label: 'Wake now', icon: 'zap', primary: true, run: () => { void runCommand?.('parallx.wakeAgent'); } });
      statusBoard.appendChild(hbRow);
      // One-shot enrichment: show when it last reviewed / when the next is due,
      // pulled from the live runner state. Updates on the next board repaint.
      void runCommand?.<{
        lastRunMs?: number;
        nextDueMs?: number;
        triggerLane?: { at: number; delivered: number; suppressed: number; failed: number } | null;
      }>('parallx.heartbeat.status').then((s) => {
        if (!s) return;
        const det = hbRow.querySelector('.autonomy-status__detail');
        if (!det) return;
        const parts = [`Reviews every ${iv}`];
        if (typeof s.lastRunMs === 'number' && s.lastRunMs > 0) parts.push(`last ${formatAgo(s.lastRunMs)}`);
        if (typeof s.nextDueMs === 'number' && s.nextDueMs > Date.now()) parts.push(`next ${formatUntil(s.nextDueMs)}`);
        // M87 S4 — make the quiet lane legible: silence now reads as
        // "checked, nothing needed" instead of "did nothing".
        if (s.triggerLane) {
          const t = s.triggerLane;
          parts.push(t.delivered > 0
            ? `watchers: ${t.delivered} filed${t.suppressed > 0 ? `, ${t.suppressed} on cooldown` : ''}`
            : t.suppressed > 0
              ? `watchers: all quiet (${t.suppressed} on cooldown)`
              : 'watchers: all quiet');
        }
        det.textContent = `${parts.join(' · ')} · reacts to changes, diagnostics & signals`;
      }).catch(() => { /* status unavailable — keep base detail */ });
    } else {
      statusBoard.appendChild(statusRow('heart-pulse', { label: 'Off', kind: 'off' },
        'Heartbeat', 'Proactive check-ins are disabled.',
        { label: 'Enable', icon: 'power', run: () => {
            void configService?.updateActivePreset({ heartbeat: { enabled: true } });
          } }));
    }

    // Cron — gated by the cron flag; the scheduler timer runs regardless.
    const cronFlag = flagsService?.isEnabled(FLAG_CRON_ENABLED) ?? false;
    if (paused) {
      statusBoard.appendChild(statusRow('calendar-clock', { label: 'Paused', kind: 'paused' },
        'Cron', 'Globally paused — no jobs fire.'));
    } else if (!cronFlag) {
      statusBoard.appendChild(statusRow('calendar-clock', { label: 'Off', kind: 'off' },
        'Cron', 'Scheduled jobs won’t fire.',
        { label: 'Enable', icon: 'power', run: () => { void flagsService?.setEnabled(FLAG_CRON_ENABLED, true); } }));
    } else {
      const jobs = cronService?.jobs ?? [];
      const next = nextCronJob(jobs);
      const detail = jobs.length === 0
        ? 'On · no jobs scheduled yet.'
        : next
          ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} · next: ${next.name} ${formatUntil(next.nextRunAt!)}`
          : `${jobs.length} job${jobs.length === 1 ? '' : 's'} scheduled.`;
      statusBoard.appendChild(statusRow('calendar-clock', { label: 'On', kind: 'on' },
        'Cron', detail,
        { label: jobs.length === 0 ? 'Schedule' : 'Manage', icon: 'alarm-clock', run: () => { void runCommand?.('aiSettings.manageCron'); } }));
    }

    // Mind — the agent's persistent inner model (the continuity keystone). Shown
    // so the human can SEE what it believes, how accurate its predictions have
    // been, and that the tamper-evident audit ledger is intact. Transparency =
    // trust; the mind is the agent's, but none of it is hidden.
    const mindRow = statusRow('brain', { label: '…', kind: 'on' }, 'Mind',
      'Loading the agent’s inner model…');
    mindRow.classList.add('autonomy-status__row--clickable');
    mindRow.title = 'Show what the agent believes — and forget anything wrong';
    mindRow.addEventListener('click', () => { mindExpanded = !mindExpanded; paintStatus(); });
    statusBoard.appendChild(mindRow);
    if (mindExpanded) statusBoard.appendChild(buildMindPanel());
    void runCommand?.<{
      available?: boolean;
      fidelity?: number | null;
      beliefs?: { content: string; confidence: number }[];
      predictions?: { resolved?: unknown }[];
      audit?: { ok: boolean };
      capability?: { assistanceShare: number | null; deskillingRisk: boolean };
      fluency?: { trend: string; completed: number };
      nag?: { dismissRatio: number | null; throttled: boolean };
    }>('parallx.mind.status').then((s) => {
      const badge = mindRow.querySelector('.autonomy-status__badge');
      const det = mindRow.querySelector('.autonomy-status__detail');
      if (!s || s.available === false) {
        if (badge) badge.textContent = 'Empty';
        if (det) det.textContent = 'No inner model yet — runs once the heartbeat reviews a workspace.';
        return;
      }
      const beliefs = s.beliefs?.length ?? 0;
      const preds = s.predictions ?? [];
      const pending = preds.filter(p => !p.resolved).length;
      const resolved = preds.filter(p => p.resolved).length;
      if (badge) badge.textContent = s.audit?.ok ? 'Intact' : 'Tampered';
      if (det) {
        const parts = [`${beliefs} belief${beliefs === 1 ? '' : 's'}`];
        if (pending) parts.push(`${pending} prediction${pending === 1 ? '' : 's'} pending`);
        if (resolved && typeof s.fidelity === 'number') parts.push(`fidelity ${s.fidelity.toFixed(2)} (brier · lower better)`);
        const cap = s.capability;
        if (cap && typeof cap.assistanceShare === 'number') {
          parts.push(`you ${Math.round((1 - cap.assistanceShare) * 100)}% · agent ${Math.round(cap.assistanceShare * 100)}%`);
          if (cap.deskillingRisk) parts.push('⚠ deskilling — you’re offloading more over time');
        }
        if (s.fluency && s.fluency.completed > 0 && s.fluency.trend !== 'insufficient') {
          parts.push(`your fluency ${s.fluency.trend}`);
        }
        if (s.nag && s.nag.throttled) {
          parts.push('quieting down — you’ve been dismissing');
        }
        parts.push(s.audit?.ok ? 'audit ✓' : 'audit ✗ TAMPERED');
        det.textContent = parts.join(' · ');
      }
    }).catch(() => { /* mind unavailable — leave the loading line */ });

    // Footer: autonomy level + a deep-link into the unified config.
    const level = configService?.getEffectiveConfig().heartbeat.autonomy ?? 'allow-safe-actions';
    const foot = $('div.autonomy-status__foot');
    foot.appendChild(iconSpan('sliders-horizontal', 'autonomy-status__foot-ic'));
    const lvl = $('span.autonomy-status__level');
    lvl.textContent = `Autonomy level · ${level}`;
    foot.appendChild(lvl);
    const link = $('button.autonomy-status__link') as HTMLButtonElement;
    const linkText = document.createElement('span');
    linkText.textContent = 'Full settings';
    link.appendChild(linkText);
    link.appendChild(iconSpan('arrow-up-right', 'autonomy-status__link-ic'));
    link.addEventListener('click', () => { void runCommand?.('aiSettings.manageAgents'); });
    foot.appendChild(link);
    statusBoard.appendChild(foot);
  }

  // Rich guide shown in the live list when there's no activity yet.
  function buildLiveGuide(): void {
    emptyEl.innerHTML = '';
    emptyEl.classList.add('autonomy-log-empty--guide');

    const head = $('div.autonomy-guide__head');
    head.appendChild(iconSpan('sparkles', 'autonomy-guide__head-ic'));
    const title = $('div.autonomy-guide__title');
    title.textContent = 'Nothing has run yet';
    head.appendChild(title);
    emptyEl.appendChild(head);

    const body = $('div.autonomy-guide__body');
    body.textContent =
      'Heartbeat reacts to your workspace — a file you save, indexing finishing. Cron runs on a schedule you set. ' +
      'Both work quietly in the background and log their turns right here. Try one:';
    emptyEl.appendChild(body);

    const chips = $('div.autonomy-guide__chips');
    const examples: { label: string; icon: string; run: () => void }[] = [
      { label: 'Wake the agent now', icon: 'zap', run: () => { void runCommand?.('parallx.wakeAgent'); } },
      { label: 'Schedule a job', icon: 'calendar-clock', run: () => { void runCommand?.('aiSettings.manageCron'); } },
      { label: 'Ask in chat', icon: 'message-circle', run: () => { void runCommand?.('chat.show'); } },
    ];
    for (const e of examples) {
      const chip = $('button.autonomy-guide__chip') as HTMLButtonElement;
      chip.appendChild(iconSpan(e.icon, 'autonomy-guide__chip-ic'));
      const t = document.createElement('span');
      t.textContent = e.label;
      chip.appendChild(t);
      chip.addEventListener('click', e.run);
      chips.appendChild(chip);
    }
    emptyEl.appendChild(chips);
  }

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
      // Filtered-out vs genuinely empty: only show the onboarding guide for the
      // unfiltered "all" view; a filter with no hits gets a plain note.
      if (currentLiveFilter === 'all') buildLiveGuide();
      else setPlainEmpty(`No ${currentLiveFilter} activity yet.`);
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
      setPlainEmpty('No autonomy history in the last 30 days.');
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
      setPlainEmpty(
        'No approved sub-agent patterns yet. When you approve a spawn and choose "remember", it will appear here.',
      );
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

    // Heartbeat 'ACT' results are actionable: let the user respond from here
    // rather than the dead end of a one-way card. (Skip error deliveries and
    // anything already handled this session.)
    if (_isActionableHeartbeat(entry, handledHeartbeat)) {
      row.appendChild(renderHeartbeatActions(entry));
    }

    row.addEventListener('click', () => {
      if (!entry.read) logService?.markRead([entry.id]);
    });

    return row;
  }

  /**
   * Do it / Tell me more / Dismiss for a heartbeat suggestion. "Do it" and
   * "Tell me more" open a real, repliable turn in the main chat seeded with
   * the finding (via the same `chat.submitPrompt` command the dashboard AI
   * widgets use); "Dismiss" just retires the card.
   */
  function renderHeartbeatActions(entry: IAutonomyLogEntry): HTMLElement {
    const actions = $('div.autonomy-log-entry__actions');

    const handle = (seededPrompt: string | null): void => {
      handledHeartbeat.add(entry.id);
      if (seededPrompt) void runCommand?.('chat.submitPrompt', { text: seededPrompt });
      // Feed the nag governor's external sensor: acting (Do it / Tell me more)
      // keeps the agent chatty; dismissing throttles it.
      void runCommand?.('parallx.mind.feedback', { outcome: seededPrompt ? 'act' : 'dismiss' });
      logService?.markRead([entry.id]);
      actions.remove();
    };

    const seed = (instruction: string): string => _heartbeatSeedPrompt(entry.content, instruction);

    const doIt = $('button.autonomy-log-action.autonomy-log-action--primary') as HTMLButtonElement;
    doIt.textContent = 'Do it';
    doIt.title = 'Open the chat and have the agent act on this';
    doIt.addEventListener('click', (e) => {
      e.stopPropagation();
      handle(seed('Please go ahead and handle it.'));
    });

    const more = $('button.autonomy-log-action') as HTMLButtonElement;
    more.textContent = 'Tell me more';
    more.title = 'Open the chat and ask the agent to explain before deciding';
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      handle(seed('Tell me more about this before I decide what to do.'));
    });

    const dismiss = $('button.autonomy-log-action') as HTMLButtonElement;
    dismiss.textContent = 'Dismiss';
    dismiss.title = 'Retire this suggestion';
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      handle(null);
    });

    actions.appendChild(doIt);
    actions.appendChild(more);
    actions.appendChild(dismiss);
    return actions;
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

  function setPlainEmpty(text: string): void {
    emptyEl.classList.remove('autonomy-log-empty--guide');
    emptyEl.textContent = text;
  }

  function paintAll(): void {
    paintStatus();
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
  let subLog = logService?.onDidChange(schedule);
  let subRail = railService?.onDidChange(schedule);
  let subFlags = flagsService?.onDidChange(schedule);
  let subCron = cronService?.onDidChangeJobs(schedule);
  let subConfig = configService?.onDidChangeConfig(schedule);
  // Relative "next: in 2h" timers drift between events — refresh the board
  // on a slow tick so the countdown stays honest without a firehose of repaints.
  const refreshTimer = setInterval(() => { if (currentMode === 'live') paintStatus(); }, 30_000);

  // Self-heal: if the view mounted before the chat extension registered the
  // flags / cron services, re-resolve shortly after, wire up the now-available
  // subscriptions, and repaint — so the panel goes live without a reopen.
  let healTimer: ReturnType<typeof setTimeout> | undefined;
  if (apiRef && (!flagsService || !cronService)) {
    healTimer = setTimeout(() => {
      healTimer = undefined;
      if (apiRef) resolveServices(apiRef);
      if (!subLog && logService) subLog = logService.onDidChange(schedule);
      if (!subRail && railService) subRail = railService.onDidChange(schedule);
      if (!subFlags && flagsService) subFlags = flagsService.onDidChange(schedule);
      if (!subCron && cronService) subCron = cronService.onDidChangeJobs(schedule);
      if (!subConfig && configService) subConfig = configService.onDidChangeConfig(schedule);
      paintAll();
    }, 800);
  }

  return {
    dispose(): void {
      subLog?.dispose();
      subRail?.dispose();
      subFlags?.dispose();
      subCron?.dispose();
      subConfig?.dispose();
      clearInterval(refreshTimer);
      if (healTimer) clearTimeout(healTimer);
    },
  };
}
