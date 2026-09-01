// autonomyBootstrap.ts — the autonomy substrate is core's to build.
//
// Phase D step 5a (PHASE_D_BRIEF.md). Four services whose modules always
// lived in src/services were nevertheless CONSTRUCTED inside chat's
// activate: the feature flags, the ndjson event log, the task-rail
// viewmodel, and the pattern memory. None of them touches a model or a
// chat session — they are storage-shaped infrastructure other tools and
// the AI Settings surfaces consume. The workbench now builds them after
// the workspace folders are known and before any tool activates; chat
// resolves them like every other consumer.
//
// Step 5b adds the cron scheduler: CORE constructs and hydrates it (so
// every extension sees the restored job set from boot, and the AI Hub's
// job list works whether or not chat is up), while the EXECUTION half —
// genuinely chat-domain, it runs turns in ephemeral sessions — is
// late-bound: chat calls attachExecution(...) and then start(). The
// background prompt runner stays chat-constructed for the same reason.

import type { IDisposable } from '../platform/lifecycle.js';
import type { ServiceCollection } from './serviceCollection.js';
import { CronService, ICronService } from '../openclaw/openclawCronService.js';
import { AutonomyFeatureFlagsService, isAutonomyTriggerAllowed, FLAG_CRON_ENABLED, FLAG_PAUSED_GLOBAL } from './autonomyFeatureFlags.js';
import { WorkflowService, IWorkflowService } from './workflows/workflowService.js';
import { IActivityJournalService } from './activityJournalService.js';
import type { AutonomyLogService } from './autonomyLogService.js';
import type { WorkflowRun } from './workflows/workflowTypes.js';
import { AutonomyEventLog, type IAutonomyEventLogFs } from './autonomyEventLog.js';
import { AutonomyPatternMemoryService, type IAutonomyPatternMemoryFs } from './autonomyPatternMemoryService.js';
import { AutonomyTaskRailService } from './autonomyTaskRailService.js';
import {
  IAutonomyEventLog,
  IAutonomyFeatureFlagsService,
  IAutonomyLogService,
  IAutonomyPatternMemoryService,
  IAutonomyTaskRailService,
  ISettingsRegistryService,
  IWorkspaceStorageService,
} from './serviceTypes.js';

interface AutonomyFsBridge {
  readdir?: (path: string) => Promise<{ ok: boolean; entries?: Array<{ name: string }>; error?: string }>;
  rename?: (oldPath: string, newPath: string) => Promise<{ ok: boolean; error?: string }>;
  exists?: (path: string) => Promise<{ ok: boolean; exists?: boolean; error?: string }>;
  mkdir?: (path: string) => Promise<{ ok: boolean; error?: string }>;
  readFile?: (path: string, encoding: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  writeFile?: (path: string, data: string, encoding: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Construct, initialize, and DI-register the autonomy substrate. Call
 * AFTER workspace folders are restored (the log and pattern dirs are
 * workspace-scoped) and before any tool activates.
 */
export async function bootstrapAutonomyServices(
  services: ServiceCollection,
  workspaceFolder: string | undefined,
): Promise<IDisposable[]> {
  const disposables: IDisposable[] = [];

  const bridge = (globalThis as { parallxElectron?: { appPath?: string; fs?: AutonomyFsBridge } }).parallxElectron;
  const appPath = bridge?.appPath;
  const fs = bridge?.fs;

  // ── Feature flags (M60 §3.8) — per-workspace storage, defaults apply. ──
  const flags = new AutonomyFeatureFlagsService(services.tryGet(IWorkspaceStorageService));
  void flags.initialize().catch(() => { /* defaults apply */ });
  disposables.push(flags);
  services.registerInstance(IAutonomyFeatureFlagsService, flags);

  // ── Event log (M60 §3.10) — ndjson under <workspace>/.parallx/logs. ──
  const logDir = workspaceFolder
    ? `${workspaceFolder}/.parallx/logs`
    : (appPath ? `${appPath}/data` : undefined);

  // (The M61 legacy-global log migration window CLOSED in the Retirement
  // phase: the one-shot move of autonomy-events.*.ndjson into the
  // workspace's legacy/ subfolder ran on first boot long ago.)

  let eventLog: AutonomyEventLog | undefined;
  if (logDir && fs) {
    eventLog = new AutonomyEventLog(fs as unknown as IAutonomyEventLogFs, { dataDir: logDir });
    disposables.push(eventLog);
    services.registerInstance(IAutonomyEventLog, eventLog);
  }

  // ── Task rail (M60 §8 Phase ζ) — read-only viewmodel over live entries
  //    (AutonomyLogService, workbench-registered) + persisted history. ──
  const autonomyLog = services.tryGet(IAutonomyLogService);
  if (autonomyLog) {
    const rail = new AutonomyTaskRailService(
      autonomyLog as ConstructorParameters<typeof AutonomyTaskRailService>[0],
      eventLog,
    );
    disposables.push(rail);
    services.registerInstance(IAutonomyTaskRailService, rail);
  }

  // ── Pattern memory — per-workspace "remember this approval" store. ──
  const patternDir = workspaceFolder
    ? `${workspaceFolder}/.parallx`
    : (appPath ? `${appPath}/data` : undefined);

  // (The M61 legacy-global approvals migration window CLOSED in the
  // Retirement phase: the rename physically consumed the legacy file on
  // its first run, so the every-boot probe was pure cost.)

  if (patternDir) {
    const patterns = new AutonomyPatternMemoryService({
      dataDir: patternDir,
      fs: fs as IAutonomyPatternMemoryFs | undefined,
    });
    void patterns.initialize().catch(() => { /* defaults apply */ });
    disposables.push(patterns);
    services.registerInstance(IAutonomyPatternMemoryService, patterns);
  }

  // ── Cron scheduler (M58 W4 / step 5b) — constructed and HYDRATED here,
  //    started by chat once it attaches the execution half. Hydration is
  //    awaited so every extension that upserts jobs during activation sees
  //    the restored set (the fresh-anchor corruption race, M61). ──
  const cron = new CronService();
  disposables.push(cron);
  services.registerInstance(ICronService, cron);

  cron.setObservers({
    isFlagEnabled: () => isAutonomyTriggerAllowed(flags, FLAG_CRON_ENABLED),
    onAutonomyEvent: eventLog
      ? (info) => {
          eventLog!.emit({
            trigger: { kind: 'cron', ref: info.jobId },
            outcome: info.outcome,
            durationMs: info.durationMs,
            toolCalls: [{
              name: 'cron.fire',
              argsDigest: info.idempotencyKey,
              durationMs: info.durationMs,
              idempotencyKey: info.idempotencyKey,
              ...(info.note ? { error: info.note } : {}),
            }],
            note: info.note,
          });
        }
      : undefined,
  });

  // Per-workspace persistence (`<workspace>/.parallx/cron.json`). In-memory
  // when the bridge or folder is unavailable. (The M61 legacy-global copy
  // shim was DELETED by the Retirement phase — it copied but never removed
  // `data/cron.json`, so every future fresh workspace would have silently
  // inherited M61-era global jobs. A new workspace now starts empty.)
  if (workspaceFolder && appPath && fs?.exists && fs.readFile && fs.writeFile && fs.mkdir) {
    const cronJsonPath = `${workspaceFolder}/.parallx/cron.json`;
    const cronJsonDir = `${workspaceFolder}/.parallx`;
    cron.setPersistence({
      load: async () => {
        try {
          const wsExists = await fs.exists!(cronJsonPath);
          if (wsExists.ok && wsExists.exists) {
            const result = await fs.readFile!(cronJsonPath, 'utf-8');
            if (!result.ok || typeof result.data !== 'string') return null;
            return JSON.parse(result.data);
          }
          return null;
        } catch {
          return null;
        }
      },
      save: async (snapshot) => {
        try {
          await fs.mkdir!(cronJsonDir);
          await fs.writeFile!(cronJsonPath, JSON.stringify(snapshot, null, 2), 'utf-8');
        } catch {
          /* persistence failures don't affect in-memory truth */
        }
      },
    });
    await cron.loadFromPersistence();
  }

  // ── Workflows (docs/WORKFLOWS_BRIEF.md) — the composition layer over
  //    cron/journal/tools. Constructed and HYDRATED here exactly like cron:
  //    documents visible from boot, execution late-bound by chat
  //    (attachExecution + start). Persistence mirrors cron.json.
  const workflows = new WorkflowService();
  disposables.push(workflows);
  services.registerInstance(IWorkflowService, workflows);

  workflows.setObservers({
    isPaused: () => flags.isEnabled(FLAG_PAUSED_GLOBAL),
    // Lazy read: the schema registers at tool activation (autonomy-log);
    // before that — or if it never does — the default budget applies.
    attentionBudgetPerDay: () => {
      try {
        const registry = services.tryGet(ISettingsRegistryService);
        if (registry?.getSchema('workflows.attentionInterruptionsPerDay')) {
          const v = registry.getValue<number>('workflows.attentionInterruptionsPerDay');
          if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
        }
      } catch { /* default below */ }
      return 6;
    },
    onRunRecorded: (run: WorkflowRun) => {
      // UX feed (the Autonomy Log panel) — one entry per run.
      try {
        (autonomyLog as AutonomyLogService | undefined)?.append({
          origin: 'workflow',
          requestText: `[workflow · ${run.workflowName}]`,
          content: describeWorkflowRun(run),
          metadata: {
            workflowId: run.workflowId,
            runId: run.id,
            status: run.status,
            ...(run.status === 'error' ? { error: true } : {}),
          },
        });
      } catch { /* the feed never breaks a run */ }
      // Audit trail (ndjson event log).
      try {
        eventLog?.emit({
          trigger: { kind: 'workflow', ref: run.workflowId },
          outcome: run.status === 'error' ? 'error' : run.status === 'gated' ? 'gated' : 'completed',
          durationMs: (run.finishedAt ?? run.startedAt) - run.startedAt,
          note: `${run.workflowName} · ${run.trigger.summary} · ${run.status}`,
        });
      } catch { /* audit never breaks a run */ }
    },
  });

  // Event triggers ride the activity journal's live feed.
  const journal = services.tryGet(IActivityJournalService);
  if (journal) workflows.attachJournalFeed(journal.onDidAppend);

  if (workspaceFolder && appPath && fs?.exists && fs.readFile && fs.writeFile && fs.mkdir) {
    const wfJsonPath = `${workspaceFolder}/.parallx/workflows.json`;
    const wfJsonDir = `${workspaceFolder}/.parallx`;
    workflows.setPersistence({
      load: async () => {
        try {
          const wsExists = await fs.exists!(wfJsonPath);
          if (wsExists.ok && wsExists.exists) {
            const result = await fs.readFile!(wfJsonPath, 'utf-8');
            if (!result.ok || typeof result.data !== 'string') return null;
            return JSON.parse(result.data);
          }
          return null;
        } catch {
          return null;
        }
      },
      save: async (snapshot) => {
        try {
          await fs.mkdir!(wfJsonDir);
          await fs.writeFile!(wfJsonPath, JSON.stringify(snapshot, null, 2), 'utf-8');
        } catch {
          /* persistence failures don't affect in-memory truth */
        }
      },
    });
    await workflows.loadFromPersistence();
  }

  return disposables;
}

/** One readable line per node — the run trace as feed content. */
function describeWorkflowRun(run: WorkflowRun): string {
  const lines: string[] = [`Trigger: ${run.trigger.summary}`];
  for (const n of run.nodes) {
    const tail = n.error ? ` — ${n.error}` : n.summary ? ` — ${n.summary}` : '';
    lines.push(`• ${n.label}: ${n.status}${tail}`);
  }
  return lines.join('\n');
}
