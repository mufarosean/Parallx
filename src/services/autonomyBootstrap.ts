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
// Cron and the background prompt runner stay chat-constructed for now:
// their EXECUTORS are genuinely chat-domain (ephemeral sessions,
// sendRequest). Step 5b gives cron a pluggable-executor seam.

import type { IDisposable } from '../platform/lifecycle.js';
import type { ServiceCollection } from './serviceCollection.js';
import { AutonomyFeatureFlagsService } from './autonomyFeatureFlags.js';
import { AutonomyEventLog, type IAutonomyEventLogFs } from './autonomyEventLog.js';
import { AutonomyPatternMemoryService, type IAutonomyPatternMemoryFs } from './autonomyPatternMemoryService.js';
import { AutonomyTaskRailService } from './autonomyTaskRailService.js';
import {
  IAutonomyEventLog,
  IAutonomyFeatureFlagsService,
  IAutonomyLogService,
  IAutonomyPatternMemoryService,
  IAutonomyTaskRailService,
  IWorkspaceStorageService,
} from './serviceTypes.js';

interface AutonomyFsBridge {
  readdir?: (path: string) => Promise<{ ok: boolean; entries?: Array<{ name: string }>; error?: string }>;
  rename?: (oldPath: string, newPath: string) => Promise<{ ok: boolean; error?: string }>;
  exists?: (path: string) => Promise<{ ok: boolean; exists?: boolean; error?: string }>;
  mkdir?: (path: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Construct, initialize, and DI-register the autonomy substrate. Call
 * AFTER workspace folders are restored (the log and pattern dirs are
 * workspace-scoped) and before any tool activates.
 */
export function bootstrapAutonomyServices(
  services: ServiceCollection,
  workspaceFolder: string | undefined,
): IDisposable[] {
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

  // One-shot migration: legacy global autonomy-events.*.ndjson move into the
  // workspace's `legacy/` subfolder so old runs don't interleave with new
  // workspace-scoped events. Best-effort.
  if (workspaceFolder && appPath && fs?.readdir && fs.rename && fs.exists && fs.mkdir) {
    void (async () => {
      try {
        const legacyDir = `${appPath}/data`;
        const targetDir = `${workspaceFolder}/.parallx/logs/legacy`;
        const listing = await fs.readdir!(legacyDir);
        if (!listing.ok || !listing.entries) return;
        const matches = listing.entries
          .map((e) => e.name)
          .filter((n) => typeof n === 'string' && n.startsWith('autonomy-events.') && n.endsWith('.ndjson'));
        if (matches.length === 0) return;
        await fs.mkdir!(targetDir);
        for (const name of matches) {
          const src = `${legacyDir}/${name}`;
          const dst = `${targetDir}/${name}`;
          const dstExists = await fs.exists!(dst);
          if (dstExists.ok && dstExists.exists) continue;
          await fs.rename!(src, dst);
        }
        console.log(`[AutonomyEventLog] Migrated ${matches.length} legacy global log(s) to ${targetDir}`);
      } catch (err) {
        console.warn('[AutonomyEventLog] Legacy log migration skipped:', err);
      }
    })();
  }

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

  // One-shot migration of the legacy global approvals file. Best-effort.
  if (workspaceFolder && appPath && fs?.exists && fs.rename && fs.mkdir) {
    void (async () => {
      try {
        const legacyFile = `${appPath}/data/autonomy-patterns.json`;
        const targetFile = `${workspaceFolder}/.parallx/autonomy-patterns.json`;
        const legacyExists = await fs.exists!(legacyFile);
        if (!legacyExists.ok || !legacyExists.exists) return;
        const targetExists = await fs.exists!(targetFile);
        if (targetExists.ok && targetExists.exists) return;
        await fs.mkdir!(`${workspaceFolder}/.parallx`);
        await fs.rename!(legacyFile, targetFile);
        console.log(`[AutonomyPatternMemory] Migrated legacy global approvals to ${targetFile}`);
      } catch (err) {
        console.warn('[AutonomyPatternMemory] Legacy approvals migration skipped:', err);
      }
    })();
  }

  if (patternDir) {
    const patterns = new AutonomyPatternMemoryService({
      dataDir: patternDir,
      fs: fs as IAutonomyPatternMemoryFs | undefined,
    });
    void patterns.initialize().catch(() => { /* defaults apply */ });
    disposables.push(patterns);
    services.registerInstance(IAutonomyPatternMemoryService, patterns);
  }

  return disposables;
}
