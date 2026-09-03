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
import { IWorkflowService, type WorkflowService } from '../../services/workflows/workflowService.js';
import type { WorkflowDoc, WorkflowRun } from '../../services/workflows/workflowTypes.js';
import { isTriggerNode } from '../../services/workflows/workflowTypes.js';
import { describeTriggerNode } from '../../services/workflows/workflowGraph.js';
import { WORKFLOW_TEMPLATES, cronJobToWorkflow } from '../../services/workflows/workflowLibrary.js';
import { renderWorkflowThumbnail } from './workflowThumbnail.js';
import { WorkflowEditorPane } from './workflowEditorPane.js';
import { ISettingsRegistryService, ICanvasPageQueryService } from '../../services/serviceTypes.js';
import { ILanguageModelToolsService, ILanguageModelsService } from '../../services/chatTypes.js';

// ── Local API type ───────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(
      viewId: string,
      provider: { createView(container: HTMLElement): IDisposable },
      options?: { name?: string; icon?: string },
    ): IDisposable;
  };
  editors: {
    registerEditorProvider(
      typeId: string,
      provider: { createEditorPane(container: HTMLElement, input?: unknown): IDisposable },
    ): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId: string }): Promise<unknown>;
  };
  commands: {
    registerCommand(commandId: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  services: {
    has(id: unknown): boolean;
    get<T>(id: unknown): T;
  };
  window: {
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
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
type Mode = 'workflows' | 'live' | 'history' | 'patterns';

const ORIGIN_BADGE: Record<string, { label: string; cls: string }> = {
  workflow:    { label: 'Workflow',    cls: 'workflow' },
  heartbeat:   { label: 'Heartbeat',   cls: 'heartbeat' },
  cron:        { label: 'Cron',        cls: 'cron' },
  subagent:    { label: 'Subagent',    cls: 'subagent' },
  dashboard:   { label: 'Dashboard',   cls: 'cron' },
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
let workflowService: WorkflowService | undefined;
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
  if (api.services.has(IWorkflowService)) workflowService = api.services.get<WorkflowService>(IWorkflowService);
  if (api.services.has(IUnifiedAIConfigService)) configService = api.services.get<IUnifiedConfig>(IUnifiedAIConfigService);
  runCommand = (id, ...args) => api.commands.executeCommand(id, ...args);
}

let currentMode: Mode = 'workflows';
/** The mounted view's repaint, so a command can switch modes from outside. */
let _viewRepaint: (() => void) | null = null;
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

/** Workflow row whose latest run trace is expanded (persists across repaints). */
let expandedWorkflowId: string | null = null;

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

  // ── The workflow editor (docs/WORKFLOWS_BRIEF.md — the pane surface).
  // Same registration pattern as canvas's database editor: a typed editor
  // behind `workflow:<workflowId>` instance ids, openable from panel rows.
  context.subscriptions.push(
    api.editors.registerEditorProvider('workflow', {
      createEditorPane(container: HTMLElement, input?: unknown): IDisposable {
        const inputObj = input as { instanceId?: string; id?: string } | undefined;
        const workflowId = inputObj?.instanceId ?? inputObj?.id ?? '';
        resolveServices(api);
        if (!workflowService) {
          const msg = document.createElement('div');
          msg.className = 'wfe__gone';
          msg.textContent = 'Workflows are not available in this workspace.';
          container.appendChild(msg);
          return { dispose: () => msg.remove() };
        }
        return new WorkflowEditorPane(container, workflowId, {
          service: workflowService,
          listTemplates: async () => {
            const res = await api.commands.executeCommand<{ id: string; name: string; description: string }[]>('canvas.listTemplates');
            return Array.isArray(res) ? res : [];
          },
          listModels: async () => {
            try {
              if (!api.services.has(ILanguageModelsService)) return [];
              const lm = api.services.get<import('../../services/chatTypes.js').ILanguageModelsService>(ILanguageModelsService);
              return (await lm.getModels()).map((m) => ({ id: m.id, displayName: m.displayName }));
            } catch { return []; }
          },
          listPages: async () => {
            try {
              if (!api.services.has(ICanvasPageQueryService)) return [];
              const canvas = api.services.get<import('../../services/serviceTypes.js').ICanvasPageQueryService>(ICanvasPageQueryService);
              return (await canvas.getRootPages())
                .filter((p) => !p.isArchived)
                .map((p) => ({ id: p.id, title: p.title }));
            } catch { return []; }
          },
          listTools: () => {
            try {
              if (!api.services.has(ILanguageModelToolsService)) return [];
              const tools = api.services.get<import('../../services/chatTypes.js').ILanguageModelToolsService>(ILanguageModelToolsService);
              return tools.getToolDefinitions().map((t) => ({ name: t.name, description: t.description }));
            } catch { return []; }
          },
        });
      },
    }),
  );

  context.subscriptions.push(api.commands.registerCommand('workflows.openEditor', async (...args: unknown[]) => {
    const id = typeof args[0] === 'string' ? args[0] : '';
    resolveServices(api);
    const wf = workflowService?.getWorkflow(id);
    if (!wf) return false;
    await api.editors.openEditor({ typeId: 'workflow', title: wf.name, icon: 'git-branch', instanceId: wf.id });
    return true;
  }));

  // The one door other surfaces use to land on the Workflows tab (the
  // planner's Scheduled tab, suggestions). Reveals the panel view and
  // switches the mode; nothing else knows how this panel is built.
  context.subscriptions.push(api.commands.registerCommand('workflows.showPanel', async () => {
    currentMode = 'workflows';
    _viewRepaint?.();
    await api.commands.executeCommand('workbench.view.show', 'view.autonomyLog').catch(() => undefined);
    return true;
  }));

  context.subscriptions.push(api.commands.registerCommand('workflows.new', async () => {
    resolveServices(api);
    if (!workflowService) return null;
    const wf = workflowService.addWorkflow({
      name: 'Untitled Workflow',
      class: 'quiet',
      enabled: false,
      source: 'user',
      nodes: [{ id: 'n1', label: 'Manual', kind: 'trigger.manual', x: 60, y: 120 }],
      edges: [],
    });
    await api.editors.openEditor({ typeId: 'workflow', title: wf.name, icon: 'git-branch', instanceId: wf.id });
    return wf.id;
  }));

  // The attention budget's schema — registered here (idempotently) because
  // the settings registry is guaranteed alive at tool activation; the
  // service reads it lazily through its observers (autonomyBootstrap).
  try {
    if (api.services.has(ISettingsRegistryService)) {
      const registry = api.services.get<import('../../services/settingsRegistryService.js').ISettingsRegistryService>(ISettingsRegistryService);
      if (!registry.getSchema('workflows.attentionInterruptionsPerDay')) {
        registry.register({
          key: 'workflows.attentionInterruptionsPerDay',
          type: 'number',
          default: 6,
          min: 0,
          max: 50,
          scope: 'workspace',
          description: 'How many times a day attention-class workflows may interrupt you automatically. Held firings are recorded in their run history.',
          category: 'Autonomy',
        });
      }
    }
  } catch { /* settings registry unavailable — the default budget applies */ }

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
  workflowService = undefined;
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
    pauseText.textContent = 'Pause Autonomy';
    pauseLabel.appendChild(pauseText);
    header.appendChild(pauseLabel);
  }

  const spacer = $('span.autonomy-log-spacer');
  header.appendChild(spacer);

  // Mode tabs (live / history / patterns).
  const tabs = $('div.autonomy-log-tabs');
  const tabByMode: Partial<Record<Mode, HTMLButtonElement>> = {};
  const availableModes: Mode[] = [];
  if (workflowService) availableModes.push('workflows');
  availableModes.push('live');
  if (railService) availableModes.push('history');
  if (patternMemory) availableModes.push('patterns');
  if (currentMode === 'workflows' && !workflowService) currentMode = 'live';
  for (const m of availableModes) {
    const t = $('button.autonomy-log-tab') as HTMLButtonElement;
    t.textContent = m === 'workflows' ? 'Workflows' : m === 'live' ? 'Live' : m === 'history' ? 'History' : 'Patterns';
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
  _viewRepaint = () => { paintTabs(); paintFilters(); paintAll(); };

  header.appendChild($('div.autonomy-log-divider'));

  // Filter chips
  const filters = $('div.autonomy-log-filters');
  header.appendChild(filters);

  header.appendChild($('div.autonomy-log-divider'));

  // Actions
  const markAll = $('button.autonomy-log-action') as HTMLButtonElement;
  markAll.textContent = 'Mark All Read';
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

  /** Plain-language verdict on prediction accuracy (never a raw Brier dump). */
  function accuracyWords(fidelity: number | null | undefined, graded: number): string | undefined {
    if (!graded || typeof fidelity !== 'number') return undefined;
    const grade = fidelity <= 0.1 ? 'sharp' : fidelity <= 0.25 ? 'fair' : 'rough';
    return `predictions so far: ${grade} (${graded} graded)`;
  }

  /** Plain-language read of the work balance (the conscience meter). */
  function balanceWords(cap: { assistanceShare: number | null; deskillingRisk: boolean } | undefined): string | undefined {
    if (!cap || typeof cap.assistanceShare !== 'number') return undefined;
    const share = cap.assistanceShare;
    const base = share <= 0.05 ? 'recent work: all yours'
      : share < 0.35 ? 'recent work: mostly yours'
      : share < 0.65 ? 'recent work: split with the agent'
      : 'recent work: mostly the agent';
    return cap.deskillingRisk ? `${base}, and growing; worth noticing` : base;
  }

  /**
   * The expanded Mind surface: beliefs with confidence bars (each forgettable),
   * noticed routines from the habit detector, and the meters in words. The mind
   * is the agent's, but every piece of it is visible and correctable here.
   */
  function buildMindPanel(): HTMLElement {
    const panel = $('div.autonomy-mind-panel');
    panel.textContent = 'Reading the agent’s inner model…';
    void runCommand?.<{
      available?: boolean;
      fidelity?: number | null;
      beliefs?: { id: string; content: string; confidence: number }[];
      predictions?: { resolved?: unknown }[];
      audit?: { ok: boolean };
      capability?: { assistanceShare: number | null; deskillingRisk: boolean };
      habits?: { action: string; typicalTime: string | null; daysObserved: number }[];
    }>('parallx.mind.status').then((s) => {
      panel.innerHTML = '';
      if (!s || s.available === false) {
        const empty = $('div.autonomy-mind-panel__empty');
        empty.textContent = 'The inner model needs workspace storage, which is not available here.';
        panel.appendChild(empty);
        return;
      }
      const beliefs = s.beliefs ?? [];
      const habits = s.habits ?? [];
      const graded = (s.predictions ?? []).filter(p => p.resolved).length;

      // Meters, in words — the numbers behind them stay in the tooltip.
      const meta = $('div.autonomy-mind-panel__meta');
      const metaParts = [accuracyWords(s.fidelity, graded), balanceWords(s.capability)]
        .filter((p): p is string => !!p);
      if (s.audit && !s.audit.ok) metaParts.unshift('records damaged: the action ledger failed verification');
      if (metaParts.length > 0) {
        meta.textContent = metaParts.join(' · ');
        if (typeof s.fidelity === 'number') meta.title = `Mean Brier score ${s.fidelity.toFixed(2)} over ${graded} resolved prediction${graded === 1 ? '' : 's'} (0 is perfect)`;
        panel.appendChild(meta);
      }

      // Beliefs — the correctable heart of the panel.
      const beliefHead = $('div.autonomy-mind-panel__section');
      beliefHead.textContent = 'What it believes';
      panel.appendChild(beliefHead);
      if (beliefs.length === 0) {
        const empty = $('div.autonomy-mind-panel__empty');
        empty.textContent = `${EMPTY_STATES['mind.noBeliefs'].headline}. ${EMPTY_STATES['mind.noBeliefs'].hint}`;
        panel.appendChild(empty);
      }
      for (const b of beliefs) {
        const row = $('div.autonomy-mind-belief');
        const pct = Math.round((b.confidence ?? 0) * 100);
        const bar = $('span.autonomy-mind-belief__bar');
        bar.title = `${pct}% confident. Fades unless reaffirmed.`;
        const fill = $('span.autonomy-mind-belief__fill');
        fill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
        bar.appendChild(fill);
        const text = $('span.autonomy-mind-belief__text');
        text.textContent = b.content;
        const forget = $('button.autonomy-mind-belief__forget') as HTMLButtonElement;
        forget.innerHTML = getIcon('x');
        forget.title = 'Forget this. Tell the agent it’s wrong.';
        forget.addEventListener('click', (e) => {
          e.stopPropagation();
          void runCommand?.('parallx.mind.forget', { id: b.id }).then(() => { row.remove(); }).catch(() => {});
        });
        row.appendChild(bar);
        row.appendChild(text);
        row.appendChild(forget);
        panel.appendChild(row);
      }

      // Routines — what the habit detector has noticed (fed by the activity
      // journal + extension signals). Shown so "it knows my mornings" is
      // never a surprise.
      if (habits.length > 0) {
        const habitHead = $('div.autonomy-mind-panel__section');
        habitHead.textContent = 'Routines it has noticed';
        panel.appendChild(habitHead);
        for (const h of habits.slice(0, 6)) {
          const row = $('div.autonomy-mind-habit');
          row.textContent = h.typicalTime
            ? `${h.action} · most days around ${h.typicalTime} (seen on ${h.daysObserved} days)`
            : `${h.action} · ${h.daysObserved} days`;
          panel.appendChild(row);
        }
        // The collapsed cell reports the full count — never let the expanded
        // view silently show less than it claims.
        if (habits.length > 6) {
          const more = $('div.autonomy-mind-habit.autonomy-mind-habit--more');
          more.textContent = `And ${habits.length - 6} more, strongest first.`;
          panel.appendChild(more);
        }
      }

      if (beliefs.length > 0) {
        const foot = $('div.autonomy-mind-panel__foot');
        const hint = $('span.autonomy-mind-panel__hint');
        hint.textContent = 'You steer the mind. Forget anything wrong.';
        foot.appendChild(hint);
        const clearAll = $('button.autonomy-mind-panel__clear') as HTMLButtonElement;
        clearAll.textContent = `Clear all ${beliefs.length}`;
        clearAll.title = 'Wipe the agent’s entire belief set and start fresh';
        clearAll.addEventListener('click', () => {
          if (!confirm(`Clear all ${beliefs.length} of the agent’s beliefs? This can’t be undone.`)) return;
          void runCommand?.('parallx.mind.clearAll').then(() => {
            panel.innerHTML = '';
            const empty = $('div.autonomy-mind-panel__empty');
            empty.textContent = 'Beliefs cleared. Fresh ones will form as it reviews your work.';
            panel.appendChild(empty);
          }).catch(() => {});
        });
        foot.appendChild(clearAll);
        panel.appendChild(foot);
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

  type StateKind = 'on' | 'off' | 'paused' | 'alert';

  // One instrument cell: state dot · name · action link over a detail line.
  // The strip reads like a control panel — typography and hairlines carry the
  // identity; state lives in the dot, exceptions in words, numbers in tabular
  // figures. No icon tiles, no badge pills for the expected states.
  function statusCell(
    kind: StateKind,
    title: string,
    detail: string,
    action?: { label: string; run: () => void; primary?: boolean },
  ): HTMLElement {
    const cell = $('div.as-cell');

    const head = $('div.as-cell__head');
    head.appendChild($(`span.as-cell__dot.is-${kind}`));
    const name = $('span.as-cell__name');
    name.textContent = title;
    head.appendChild(name);
    if (action) {
      const btn = $('button.as-cell__action') as HTMLButtonElement;
      if (action.primary) btn.classList.add('is-primary');
      btn.textContent = action.label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); action.run(); });
      head.appendChild(btn);
    }
    cell.appendChild(head);

    const det = $('div.as-cell__detail');
    det.textContent = detail;
    cell.appendChild(det);
    return cell;
  }

  function paintStatus(): void {
    statusBoard.innerHTML = '';
    if (currentMode !== 'live') { statusBoard.style.display = 'none'; return; }
    statusBoard.style.display = '';

    const paused = flagsService?.isEnabled(FLAG_PAUSED_GLOBAL) ?? false;
    const strip = $('div.autonomy-strip');
    statusBoard.appendChild(strip);

    // Heartbeat — gated by ONE user control (`heartbeat.enabled`) plus the
    // global kill switch. (The old `autonomy.heartbeat.enabled` flag no longer
    // gates the runner; it was a redundant second switch.)
    const hbCfg = configService?.getEffectiveConfig().heartbeat;
    const hbOn = hbCfg?.enabled ?? false;
    if (paused) {
      strip.appendChild(statusCell('paused', 'Heartbeat', 'paused globally'));
    } else if (hbOn) {
      const iv = hbCfg ? formatInterval(hbCfg.intervalMs) : '30m';
      const hbCell = statusCell('on', 'Heartbeat', `reviews every ${iv}`,
        { label: 'Wake Now', primary: true, run: () => { void runCommand?.('parallx.wakeAgent'); } });
      strip.appendChild(hbCell);
      // One-shot enrichment: last review / next due / watcher outcome, from
      // the live runner state. Updates on the next board repaint.
      void runCommand?.<{
        lastRunMs?: number;
        nextDueMs?: number;
        triggerLane?: { at: number; delivered: number; suppressed: number; failed: number } | null;
      }>('parallx.heartbeat.status').then((s) => {
        if (!s) return;
        const det = hbCell.querySelector('.as-cell__detail');
        if (!det) return;
        const parts = [`every ${iv}`];
        if (typeof s.lastRunMs === 'number' && s.lastRunMs > 0) parts.push(`last ${formatAgo(s.lastRunMs)}`);
        if (typeof s.nextDueMs === 'number' && s.nextDueMs > Date.now()) parts.push(`next ${formatUntil(s.nextDueMs)}`);
        // M87 S4 — make the quiet lane legible: silence reads as "checked,
        // nothing needed" instead of "did nothing".
        if (s.triggerLane) {
          const t = s.triggerLane;
          parts.push(t.delivered > 0
            ? `${t.delivered} watcher${t.delivered === 1 ? '' : 's'} filed`
            : 'watchers quiet');
        }
        det.textContent = parts.join(' · ');
      }).catch(() => { /* status unavailable — keep base detail */ });
    } else {
      strip.appendChild(statusCell('off', 'Heartbeat', 'check-ins off',
        { label: 'Enable', run: () => { void configService?.updateActivePreset({ heartbeat: { enabled: true } }); } }));
    }

    // Cron — gated by the cron flag; the scheduler timer runs regardless.
    const cronFlag = flagsService?.isEnabled(FLAG_CRON_ENABLED) ?? false;
    if (paused) {
      strip.appendChild(statusCell('paused', 'Cron', 'paused globally'));
    } else if (!cronFlag) {
      strip.appendChild(statusCell('off', 'Cron', 'schedules off',
        { label: 'Enable', run: () => { void flagsService?.setEnabled(FLAG_CRON_ENABLED, true); } }));
    } else {
      const jobs = cronService?.jobs ?? [];
      const next = nextCronJob(jobs);
      const detail = jobs.length === 0
        ? 'no jobs yet'
        : next
          ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} · next ${formatUntil(next.nextRunAt!)}`
          : `${jobs.length} job${jobs.length === 1 ? '' : 's'}`;
      strip.appendChild(statusCell('on', 'Cron', detail,
        { label: jobs.length === 0 ? 'Schedule' : 'Manage', run: () => { void runCommand?.('aiSettings.manageCron'); } }));
    }

    // Mind — the agent's persistent inner model. The cell speaks plainly
    // (beliefs, routines); the meters live in the expanded panel, in words.
    // Only the exceptional state (a damaged ledger) changes its color.
    const mindCell = statusCell('off', 'Mind', 'reading…',
      { label: mindExpanded ? 'Hide' : 'Show', run: () => { mindExpanded = !mindExpanded; paintStatus(); } });
    mindCell.classList.add('as-cell--clickable');
    mindCell.title = 'What the agent believes about you and your work. Open it, correct it.';
    mindCell.addEventListener('click', () => { mindExpanded = !mindExpanded; paintStatus(); });
    strip.appendChild(mindCell);
    void runCommand?.<{
      available?: boolean;
      beliefs?: { content: string; confidence: number }[];
      predictions?: { resolved?: unknown }[];
      audit?: { ok: boolean };
      habits?: { action: string }[];
    }>('parallx.mind.status').then((s) => {
      const dot = mindCell.querySelector('.as-cell__dot');
      const det = mindCell.querySelector('.as-cell__detail');
      if (!det || !dot) return;
      if (!s || s.available === false) {
        det.textContent = 'Not available here.';
        return;
      }
      if (s.audit && !s.audit.ok) {
        dot.className = 'as-cell__dot is-alert';
        det.textContent = 'Records damaged. Open for details.';
        return;
      }
      const beliefs = s.beliefs?.length ?? 0;
      const open = (s.predictions ?? []).filter(p => !p.resolved).length;
      const habits = s.habits?.length ?? 0;
      if (beliefs === 0 && open === 0 && habits === 0) {
        det.textContent = 'Nothing learned yet.';
        return;
      }
      dot.className = 'as-cell__dot is-on';
      const parts: string[] = [];
      if (beliefs > 0) parts.push(`${beliefs} belief${beliefs === 1 ? '' : 's'}`);
      if (habits > 0) parts.push(`${habits} routine${habits === 1 ? '' : 's'} noticed`);
      if (open > 0) parts.push(`${open} open prediction${open === 1 ? '' : 's'}`);
      det.textContent = parts.join(' · ');
    }).catch(() => { /* mind unavailable — leave the reading line */ });

    // Strip tail: autonomy level + the deep-link into full settings.
    const tail = $('div.autonomy-strip__tail');
    const level = configService?.getEffectiveConfig().heartbeat.autonomy ?? 'allow-safe-actions';
    const lvl = $('span.autonomy-strip__level');
    lvl.textContent = level.replace(/-/g, ' ');
    lvl.title = `Autonomy level: ${level}`;
    tail.appendChild(lvl);
    const link = $('button.autonomy-strip__link') as HTMLButtonElement;
    const linkText = document.createElement('span');
    linkText.textContent = 'Settings';
    link.appendChild(linkText);
    link.appendChild(iconSpan('arrow-up-right', 'autonomy-strip__link-ic'));
    link.addEventListener('click', () => { void runCommand?.('aiSettings.manageAgents'); });
    tail.appendChild(link);
    strip.appendChild(tail);

    if (mindExpanded) statusBoard.appendChild(buildMindPanel());
  }

  // Rich guide shown in the live list when there's no activity yet.
  function buildLiveGuide(): void {
    emptyEl.innerHTML = '';
    // Own the class list — the workflows tab's `wf-empty` must not leak
    // its width overrides into this tab (the stretched-guide bug).
    emptyEl.classList.remove('wf-empty');
    emptyEl.classList.add('autonomy-log-empty--guide');

    const head = $('div.autonomy-guide__head');
    head.appendChild(iconSpan('px-ai-mark', 'autonomy-guide__head-ic'));
    const title = $('div.autonomy-guide__title');
    title.textContent = 'Nothing has run yet';
    head.appendChild(title);
    emptyEl.appendChild(head);

    const body = $('div.autonomy-guide__body');
    body.textContent =
      'Background runs land here: what triggered them, which model served them, and what came of it. ' +
      'The heartbeat reviews your workspace as you work; cron fires on schedules you set. Try one:';
    emptyEl.appendChild(body);

    const chips = $('div.autonomy-guide__chips');
    const examples: { label: string; icon: string; run: () => void }[] = [
      { label: 'Wake the Agent Now', icon: 'px-ai-mark', run: () => { void runCommand?.('parallx.wakeAgent'); } },
      { label: 'Schedule a Job', icon: 'calendar-clock', run: () => { void runCommand?.('aiSettings.manageCron'); } },
      { label: 'Ask in Chat', icon: 'px-ai-mark', run: () => { void runCommand?.('chat.show'); } },
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
  const liveChipKeys: readonly LiveFilter[] = ['all', 'workflow', 'heartbeat', 'cron', 'subagent', 'dashboard'];
  const railChipKeys: readonly RailTriggerFilter[] = [
    'all', 'chat', 'heartbeat', 'cron', 'subagent', 'followup', 'file-change', 'replay',
  ];

  function paintTabs(): void {
    for (const [m, btn] of Object.entries(tabByMode)) {
      btn?.classList.toggle('autonomy-log-tab--active', m === currentMode);
    }
    // Mark-all-read / Clear act on the LOG — dead weight on the Workflows tab.
    const logActions = currentMode !== 'workflows';
    markAll.style.display = logActions ? '' : 'none';
    clearBtn.style.display = logActions ? '' : 'none';
  }

  function paintFilters(): void {
    filters.innerHTML = '';
    if (currentMode === 'patterns' || currentMode === 'workflows') return;
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
    if (currentMode === 'workflows') {
      const flows = workflowService?.workflows ?? [];
      const on = flows.filter((w) => w.enabled).length;
      summary.textContent = flows.length === 0 ? '' : `${on} of ${flows.length} enabled`;
      summary.classList.remove('autonomy-log-summary--unread');
      return;
    }
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
    if (currentMode === 'workflows') {
      paintWorkflowList();
      return;
    }
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

  // ── Workflows tab (docs/WORKFLOWS_BRIEF.md — tab one of the reshape) ──

  function workflowTriggerSummary(wf: WorkflowDoc): string {
    const triggers = wf.nodes.filter(isTriggerNode);
    if (triggers.length === 0) return 'Draft, no trigger yet';
    return triggers.map((t) => describeTriggerNode(t)).join(' · ');
  }

  function runBadgeText(run: WorkflowRun): string {
    switch (run.status) {
      case 'ok': return 'ok';
      case 'error': return 'failed';
      case 'gated': return 'awaiting approval';
      case 'cooldown': return 'held (cooldown)';
      case 'held': return 'held (arbiter)';
      case 'running': return 'running';
    }
  }

  function renderRunTrace(run: WorkflowRun): HTMLElement {
    const trace = $('div.wf-row__trace');
    const head = $('div.wf-row__trace-head');
    head.textContent = `${formatTime(run.startedAt)} · ${run.trigger.summary}`;
    trace.appendChild(head);
    for (const n of run.nodes) {
      const line = $(`div.wf-row__trace-line.is-${n.status}`);
      const tail = n.error ? `: ${n.error}` : n.summary ? `: ${n.summary}` : '';
      line.textContent = `${n.label}: ${n.status}${tail}`;
      trace.appendChild(line);
    }
    return trace;
  }

  function renderSuggestedRow(wf: WorkflowDoc): HTMLElement {
    const service = workflowService!;
    const row = $('div.wf-row.wf-row--suggested');
    const head = $('div.wf-row__head');
    const kindIc = $('span.wf-row__kind-ic');
    kindIc.innerHTML = getIcon('px-ai-mark');
    head.appendChild(kindIc);
    const name = $('span.wf-row__name');
    name.textContent = wf.name;
    head.appendChild(name);
    const actions = $('div.wf-row__actions');
    const editBtn = $('button.as-cell__action') as HTMLButtonElement;
    editBtn.textContent = 'Review';
    editBtn.title = 'Open the draft in the workflow editor.';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runCommand?.('workflows.openEditor', wf.id);
    });
    actions.appendChild(editBtn);
    const addBtn = $('button.as-cell__action.is-primary') as HTMLButtonElement;
    addBtn.textContent = 'Add';
    addBtn.title = 'Keep it and turn it on. It becomes one of your workflows.';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { service.updateWorkflow(wf.id, { source: 'user', enabled: true }); } catch { /* repaint below */ }
    });
    actions.appendChild(addBtn);
    const dismissBtn = $('button.as-cell__action') as HTMLButtonElement;
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.title = 'Delete the suggestion. This habit is not suggested again.';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { service.removeWorkflow(wf.id); } catch { /* repaint below */ }
    });
    actions.appendChild(dismissBtn);
    head.appendChild(actions);
    row.appendChild(head);
    const det = $('div.wf-row__detail');
    det.textContent = wf.description ?? workflowTriggerSummary(wf);
    row.appendChild(det);
    return row;
  }

  function renderWorkflowRow(wf: WorkflowDoc): HTMLElement {
    const service = workflowService!;
    const row = $('div.wf-row');
    if (!wf.enabled) row.classList.add('wf-row--off');

    const head = $('div.wf-row__head');
    head.appendChild($(`span.as-cell__dot.is-${wf.enabled ? 'on' : 'off'}`));
    const kindIc = $('span.wf-row__kind-ic');
    kindIc.innerHTML = getIcon(triggerIconFor(wf));
    head.appendChild(kindIc);
    const name = $('span.wf-row__name');
    name.textContent = wf.name;
    head.appendChild(name);
    if (wf.source === 'migrated-cron') {
      const chip = $('span.wf-row__chip');
      chip.textContent = 'From Cron';
      chip.title = 'Migrated from a cron job. The original job still exists.';
      head.appendChild(chip);
    }
    if (wf.class === 'destructive') {
      const chip = $('span.wf-row__chip.wf-row__chip--danger');
      chip.textContent = 'Approval Required';
      head.appendChild(chip);
    }

    const actions = $('div.wf-row__actions');
    const editBtn = $('button.as-cell__action') as HTMLButtonElement;
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runCommand?.('workflows.openEditor', wf.id);
    });
    actions.appendChild(editBtn);

    const runBtn = $('button.as-cell__action.is-primary') as HTMLButtonElement;
    runBtn.textContent = 'Run Now';
    runBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runBtn.disabled = true;
      service.runNow(wf.id).catch((err) => {
        console.warn('[AutonomyLog] workflow run failed:', err);
      }).finally(() => { runBtn.disabled = false; paintAll(); });
    });
    actions.appendChild(runBtn);

    const toggleBtn = $('button.as-cell__action') as HTMLButtonElement;
    toggleBtn.textContent = wf.enabled ? 'Disable' : 'Enable';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { service.setEnabled(wf.id, !wf.enabled); } catch { /* repaint below */ }
    });
    actions.appendChild(toggleBtn);

    const delBtn = $('button.as-cell__action') as HTMLButtonElement;
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void apiRef?.window.showWarningMessage(
        `Delete the workflow "${wf.name}"? Its run history goes with it.`,
        { title: 'Delete' },
        { title: 'Cancel' },
      ).then((res) => {
        if (res?.title === 'Delete') service.removeWorkflow(wf.id);
      });
    });
    actions.appendChild(delBtn);
    head.appendChild(actions);
    row.appendChild(head);

    const det = $('div.wf-row__detail');
    const parts: string[] = [workflowTriggerSummary(wf)];
    const runs = service.getRuns(wf.id);
    const last = runs[runs.length - 1];
    if (last) parts.push(`last: ${runBadgeText(last)} ${formatAgo(last.startedAt)}`);
    const next = service.nextRunAt(wf.id);
    if (wf.enabled && next !== null) parts.push(`next ${formatUntil(next)}`);
    if (wf.model) parts.push(wf.model);
    det.textContent = parts.join(' · ');
    if (last?.status === 'error') det.classList.add('wf-row__detail--error');
    row.appendChild(det);

    // Click the row to open the latest run's trace — runs are documents.
    if (last) {
      row.classList.add('wf-row--openable');
      row.addEventListener('click', () => {
        expandedWorkflowId = expandedWorkflowId === wf.id ? null : wf.id;
        paintList();
      });
      if (expandedWorkflowId === wf.id) row.appendChild(renderRunTrace(last));
    }
    return row;
  }

  interface GalleryCardSpec {
    readonly name: string;
    readonly desc: string;
    readonly foot?: string;
    readonly thumb?: SVGSVGElement;
    readonly blank?: boolean;
    readonly onPick: () => void;
  }

  function galleryCard(spec: GalleryCardSpec): HTMLElement {
    const card = $('button.wf-card') as HTMLButtonElement;
    const stage = $('div.wf-card__stage');
    if (spec.thumb) {
      stage.appendChild(spec.thumb);
    } else if (spec.blank) {
      stage.classList.add('wf-card__stage--blank');
      const plus = $('span.wf-card__plus');
      plus.innerHTML = getIcon('plus');
      stage.appendChild(plus);
    }
    card.appendChild(stage);
    const name = $('div.wf-card__name');
    name.textContent = spec.name;
    card.appendChild(name);
    const desc = $('div.wf-card__desc');
    desc.textContent = spec.desc;
    card.appendChild(desc);
    if (spec.foot) {
      const foot = $('div.wf-card__foot');
      foot.textContent = spec.foot;
      card.appendChild(foot);
    }
    card.addEventListener('click', spec.onPick);
    return card;
  }

  /** The card gallery: blank canvas · templates · cron migrations. Every
   *  card previews the REAL graph it installs. */
  function buildGalleryGrid(): HTMLElement {
    const service = workflowService!;
    const grid = $('div.wf-gallery-grid');

    grid.appendChild(galleryCard({
      name: 'New Workflow',
      desc: 'Start from a blank canvas and draw your own.',
      foot: 'Blank canvas',
      blank: true,
      onPick: () => { void runCommand?.('workflows.new'); },
    }));

    for (const t of WORKFLOW_TEMPLATES) {
      const triggerNode = t.nodes.find((n) => n.kind.startsWith('trigger.'));
      grid.appendChild(galleryCard({
        name: t.name,
        desc: t.description,
        foot: triggerNode ? describeTriggerNode(triggerNode) : undefined,
        thumb: renderWorkflowThumbnail(t.nodes, t.edges),
        onPick: () => {
          try {
            const doc = service.installTemplate(t.key);
            void runCommand?.('workflows.openEditor', doc.id);
          } catch (err) { console.warn('[AutonomyLog] template install failed:', err); }
        },
      }));
    }

    const migrated = new Set(service.workflows.map((w) => w.migratedFromCronId).filter(Boolean));
    for (const job of cronService?.jobs ?? []) {
      if (migrated.has(job.id)) continue;
      const preview = cronJobToWorkflow(job, 'preview');
      const triggerNode = preview.nodes.find((n) => n.kind.startsWith('trigger.'));
      grid.appendChild(galleryCard({
        name: job.name,
        desc: 'Migrate this cron job into a workflow. The original job stays until you remove it.',
        foot: triggerNode ? `From Cron · ${describeTriggerNode(triggerNode)}` : 'From Cron',
        thumb: renderWorkflowThumbnail(preview.nodes, preview.edges),
        onPick: () => {
          try {
            const doc = service.migrateCronJob(job);
            void runCommand?.('workflows.openEditor', doc.id);
          } catch (err) { console.warn('[AutonomyLog] cron migration failed:', err); }
        },
      }));
    }
    return grid;
  }

  function triggerIconFor(wf: WorkflowDoc): string {
    const t = wf.nodes.find((n) => isTriggerNode(n));
    if (!t) return 'circle-dashed';
    if (t.kind === 'trigger.schedule') return 'calendar-clock';
    if (t.kind === 'trigger.event') return 'radio';
    return 'play';
  }

  function paintWorkflowList(): void {
    listEl.innerHTML = '';
    if (!workflowService) {
      setPlainEmpty('Workflows are not available in this workspace.');
      emptyEl.style.display = '';
      return;
    }
    const flows = workflowService.workflows;
    if (flows.length === 0) {
      emptyEl.innerHTML = '';
      emptyEl.classList.add('autonomy-log-empty--guide', 'wf-empty');
      const hero = $('div.wf-empty__hero');
      const title = $('div.wf-empty__title');
      title.textContent = 'Automations you can read';
      hero.appendChild(title);
      const sub = $('div.wf-empty__sub');
      sub.textContent =
        'A workflow is a small graph: a trigger, the steps it takes, and every run recorded. '
        + 'Pick one to see how it works. Nothing runs until you enable it.';
      hero.appendChild(sub);
      emptyEl.appendChild(hero);
      emptyEl.appendChild(buildGalleryGrid());
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';
    // Suggestions first: the AI noticed a habit and drafted a workflow for
    // it. They are disabled until approved, and a dismissal deletes them.
    const suggested = flows.filter((wf) => wf.source === 'suggested');
    const rest = flows.filter((wf) => wf.source !== 'suggested');
    if (suggested.length > 0) {
      const sec = $('div.wf-suggested');
      const head = $('div.wf-suggested__head');
      head.textContent = 'Suggested by the AI';
      sec.appendChild(head);
      const sub = $('div.wf-suggested__sub');
      sub.textContent = 'Habits it noticed in your activity, drafted as workflows. Nothing runs until you add one.';
      sec.appendChild(sub);
      for (const wf of suggested) sec.appendChild(renderSuggestedRow(wf));
      listEl.appendChild(sec);
    }
    for (const wf of rest) listEl.appendChild(renderWorkflowRow(wf));
    const foot = $('div.wf-gallery');
    const head = $('div.wf-gallery__head');
    head.textContent = 'Add More';
    foot.appendChild(head);
    foot.appendChild(buildGalleryGrid());
    listEl.appendChild(foot);
  }

  function renderLiveEntry(entry: IAutonomyLogEntry): HTMLElement {
    const row = $('div.autonomy-log-entry');
    if (!entry.read) row.classList.add('autonomy-log-entry--unread');

    const head = $('div.autonomy-log-entry__header');
    const badgeMeta = ORIGIN_BADGE[entry.origin] ?? { label: entry.origin, cls: 'agent' };
    const badge = $(`span.autonomy-log-badge.autonomy-log-badge--${badgeMeta.cls}`);
    badge.textContent = badgeMeta.label;
    head.appendChild(badge);

    // Failed runs must not read like successes: metadata.error entries get a
    // distinct treatment (transparency — a broken background refresh was
    // previously indistinguishable from a good one in this list).
    if ((entry.metadata as { error?: boolean } | undefined)?.error) {
      row.classList.add('autonomy-log-entry--error');
      const errBadge = $('span.autonomy-log-badge.autonomy-log-badge--error');
      errBadge.textContent = 'Failed';
      head.appendChild(errBadge);
    }
    if ((entry.metadata as { model?: string } | undefined)?.model) {
      const modelTag = $('span.autonomy-log-entry__model');
      modelTag.textContent = String((entry.metadata as { model?: string }).model);
      modelTag.title = 'Model that served this run';
      head.appendChild(modelTag);
    }

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

    // M91 — reopen the full transcript of the autonomous run that produced
    // this entry, read-only, like going back to a chat.
    if (entry.sessionId && String(entry.sessionId).startsWith('ephemeral-')) {
      const view = $('button.autonomy-log-entry__viewrun') as HTMLButtonElement;
      view.type = 'button';
      view.textContent = 'View Full Run';
      view.addEventListener('click', (e) => {
        e.stopPropagation();
        void runCommand?.('chat.openArchivedRun', {
          sessionId: entry.sessionId,
          origin: entry.origin,
          title: entry.requestText,
        });
      });
      row.appendChild(view);
    }

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
    doIt.textContent = 'Do It';
    doIt.title = 'Open the chat and have the agent act on this';
    doIt.addEventListener('click', (e) => {
      e.stopPropagation();
      handle(seed('Please go ahead and handle it.'));
    });

    const more = $('button.autonomy-log-action') as HTMLButtonElement;
    more.textContent = 'Tell Me More';
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
    emptyEl.classList.remove('autonomy-log-empty--guide', 'wf-empty');
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
  let subWf = workflowService?.onDidChangeWorkflows(schedule);
  let subRail = railService?.onDidChange(schedule);
  let subFlags = flagsService?.onDidChange(schedule);
  let subCron = cronService?.onDidChangeJobs(schedule);
  let subConfig = configService?.onDidChangeConfig(schedule);
  // Relative "next: in 2h" timers drift between events — refresh the board
  // on a slow tick so the countdown stays honest without a firehose of repaints.
  // Skip the tick while focus is inside the board: paintStatus rebuilds the
  // strip wholesale, which would silently drop a keyboard user's focus to
  // <body> mid-Tab (the tick only refreshes relative-time text; it can wait).
  const refreshTimer = setInterval(() => {
    const focused = document.activeElement;
    if (currentMode === 'workflows') {
      // Keep "next in 2h" honest; skip while the user is on a row control.
      if (focused instanceof HTMLElement && body.contains(focused)) return;
      paintList();
      return;
    }
    if (currentMode !== 'live') return;
    if (focused instanceof HTMLElement && statusBoard.contains(focused)) return;
    paintStatus();
  }, 30_000);

  // Self-heal: if the view mounted before the chat extension registered the
  // flags / cron services, re-resolve shortly after, wire up the now-available
  // subscriptions, and repaint — so the panel goes live without a reopen.
  let healTimer: ReturnType<typeof setTimeout> | undefined;
  if (apiRef && (!flagsService || !cronService || !workflowService)) {
    healTimer = setTimeout(() => {
      healTimer = undefined;
      if (apiRef) resolveServices(apiRef);
      if (!subLog && logService) subLog = logService.onDidChange(schedule);
      if (!subRail && railService) subRail = railService.onDidChange(schedule);
      if (!subFlags && flagsService) subFlags = flagsService.onDidChange(schedule);
      if (!subCron && cronService) subCron = cronService.onDidChangeJobs(schedule);
      if (!subWf && workflowService) subWf = workflowService.onDidChangeWorkflows(schedule);
      if (!subConfig && configService) subConfig = configService.onDidChangeConfig(schedule);
      paintAll();
    }, 800);
  }

  return {
    dispose(): void {
      subLog?.dispose();
      subWf?.dispose();
      subRail?.dispose();
      subFlags?.dispose();
      subCron?.dispose();
      subConfig?.dispose();
      clearInterval(refreshTimer);
      if (healTimer) clearTimeout(healTimer);
    },
  };
}
