/**
 * Sub-Agent Spawning — D5: Parallel Delegation.
 *
 * Upstream evidence:
 *   - subagent-spawn.ts:1-847 — spawnSubagentDirect, SpawnSubagentParams
 *   - sessions-spawn-tool.ts:1-212 — sessions_spawn tool definition
 *   - Modes: "run" (one-shot) | "session" (persistent)
 *   - Depth tracking: callerDepth, maxSpawnDepth, enforced limits
 *   - Registry: registerSubagentRun — tracks active/historical runs
 *   - Lifecycle: spawn → register → execute → announce → cleanup
 *   - Safety: agentId validation, sandbox enforcement
 *   - Model override: per-spawn model selection
 *   - Completion announcement with retry and idempotency
 *
 * Parallx adaptation:
 *   - Single Ollama instance — sub-agent runs on same or different local model
 *   - No ACP runtime — subagent runtime only
 *   - Task delegation: parent spawns isolated turn with specific task
 *   - Depth limit: configurable (default 3)
 *   - Registry: track active sub-tasks in memory
 *   - Announcement: sub-agent result posted back to parent chat
 *   - No thread binding (single chat surface)
 */

import type { IDisposable } from '../platform/lifecycle.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum spawn depth. Upstream: maxSpawnDepth. */
export const DEFAULT_MAX_SPAWN_DEPTH = 3;

/** Default run timeout in seconds. Upstream: runTimeoutSeconds param. */
export const DEFAULT_RUN_TIMEOUT_SECONDS = 120;

/** Maximum concurrent sub-agent runs. Safety limit. */
export const MAX_CONCURRENT_RUNS = 5;

/** Maximum completed runs to retain in registry history. */
export const MAX_REGISTRY_HISTORY = 100;

// ---------------------------------------------------------------------------
// Types (from upstream subagent-spawn.ts)
// ---------------------------------------------------------------------------

/**
 * Spawn mode.
 * Upstream: "run" (one-shot) | "session" (persistent/thread-bound).
 * Parallx: only "run" mode — no persistent sub-sessions.
 */
export type SubagentSpawnMode = 'run';

/**
 * Spawn status lifecycle.
 * Upstream: spawning → running → completed/failed/timeout.
 */
export type SubagentRunStatus =
  | 'spawning'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

/**
 * Parameters for spawning a sub-agent.
 * Upstream: SpawnSubagentParams (src/agents/subagent-spawn.ts:52-76).
 *
 * @deviation D5.3 — Upstream defines agentId, thinking, thread, mode, cleanup,
 * sandbox, expectsCompletionMessage, attachments, attachMountPath. All N/A for
 * single-agent desktop (no cross-agent routing, no persistent sub-sessions,
 * no sandbox runtimes, no file-mount workflow).
 */
export interface ISubagentSpawnParams {
  /** The task description for the sub-agent. */
  readonly task: string;
  /** Human-readable label for the sub-task. */
  readonly label?: string;
  /** Model override (e.g., "gpt-oss:20b" or "qwen3.5"). */
  readonly model?: string;
  /** Run timeout in seconds. */
  readonly runTimeoutSeconds?: number;
  /** Caller's current depth in the spawn tree. */
  readonly callerDepth?: number;
}

/**
 * A tracked sub-agent run.
 * Upstream: SubagentRunRecord (src/agents/subagent-registry.types.ts).
 *
 * @deviation D5.4 — Upstream tracks 25+ fields for multi-session server with
 * persistence, tree queries, and announce retry. Parallx tracks 11 fields for
 * single-agent desktop with in-memory runs consumed immediately. Missing:
 * parentRunId/childRunIds (D5.2b), session keys (N/A), archiveAtMs (N/A),
 * announceRetryCount (N/A), outputTokens (future metrics).
 *
 * @deviation D5.2b — Upstream tracks parentRunId/childRunIds for tree queries.
 * Deferred: single-agent desktop has shallow spawn trees with no tree-query consumers.
 */
export interface ISubagentRun {
  readonly id: string;
  readonly task: string;
  readonly label: string;
  readonly model: string | null;
  readonly status: SubagentRunStatus;
  readonly callerDepth: number;
  readonly spawnedAt: number;
  readonly completedAt: number | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly timeoutMs: number;
}

/**
 * Result of a sub-agent spawn.
 */
export interface ISubagentSpawnResult {
  readonly runId: string;
  readonly status: SubagentRunStatus;
  readonly result: string | null;
  readonly error: string | null;
  readonly durationMs: number;
}

/**
 * Delegate that actually executes a sub-agent turn.
 * Takes the task string and optional model override, returns the result text.
 */
export type SubagentTurnExecutor = (
  task: string,
  model: string | null,
) => Promise<string>;

/**
 * Delegate that announces a sub-agent result back to the parent chat.
 * Upstream: completion announcement with retry.
 */
export type SubagentAnnouncer = (
  run: ISubagentRun,
  result: string,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Sub-Agent Registry
// ---------------------------------------------------------------------------

/**
 * Tracks active and historical sub-agent runs.
 * Upstream: registerSubagentRun in subagent-spawn.ts.
 *
 * @deviation D5.2b — Upstream tracks parentRunId/childRunIds for tree queries.
 * Deferred: single-agent desktop has shallow spawn trees with no tree-query consumers.
 */
export class SubagentRegistry implements IDisposable {
  private readonly _runs = new Map<string, ISubagentRun>();
  private _nextId = 1;
  private _disposed = false;

  /** All tracked runs (snapshots). */
  get runs(): readonly ISubagentRun[] {
    return [...this._runs.values()];
  }

  /** Currently active (spawning/running) runs. */
  get activeRuns(): readonly ISubagentRun[] {
    return this.runs.filter(r => r.status === 'spawning' || r.status === 'running');
  }

  /** Number of active runs. */
  get activeCount(): number {
    return this.activeRuns.length;
  }

  /** Register a new sub-agent run. Returns the run record. */
  register(params: ISubagentSpawnParams): ISubagentRun {
    if (this._disposed) throw new Error('SubagentRegistry is disposed');

    const id = `subagent-${this._nextId++}`;
    const run: ISubagentRun = {
      id,
      task: params.task,
      label: params.label ?? `Sub-task ${this._nextId - 1}`,
      model: params.model ?? null,
      status: 'spawning',
      callerDepth: params.callerDepth ?? 0,
      spawnedAt: Date.now(),
      completedAt: null,
      result: null,
      error: null,
      timeoutMs: (params.runTimeoutSeconds ?? DEFAULT_RUN_TIMEOUT_SECONDS) * 1000,
    };

    this._runs.set(id, run);
    this._pruneCompletedRuns();
    return { ...run };
  }

  /**
   * Remove oldest completed/failed/timeout/cancelled runs when total
   * completed runs exceed MAX_REGISTRY_HISTORY. Active runs are never pruned.
   */
  private _pruneCompletedRuns(): void {
    const completed = [...this._runs.values()]
      .filter(r => r.status !== 'spawning' && r.status !== 'running');
    if (completed.length <= MAX_REGISTRY_HISTORY) return;
    completed.sort((a, b) => (a.completedAt ?? a.spawnedAt) - (b.completedAt ?? b.spawnedAt));
    const excess = completed.length - MAX_REGISTRY_HISTORY;
    for (let i = 0; i < excess; i++) {
      this._runs.delete(completed[i].id);
    }
  }

  /** Update a run's status. */
  update(id: string, patch: Partial<Pick<ISubagentRun, 'status' | 'result' | 'error' | 'completedAt'>>): ISubagentRun {
    const existing = this._runs.get(id);
    if (!existing) throw new Error(`Sub-agent run not found: ${id}`);

    const updated: ISubagentRun = {
      ...existing,
      ...patch,
    };
    this._runs.set(id, updated);
    return { ...updated };
  }

  /** Get a run by ID. */
  get(id: string): ISubagentRun | undefined {
    const run = this._runs.get(id);
    return run ? { ...run } : undefined;
  }

  /** Remove a completed run from the registry. */
  remove(id: string): boolean {
    return this._runs.delete(id);
  }

  dispose(): void {
    this._disposed = true;
    this._runs.clear();
  }
}

// ---------------------------------------------------------------------------
// Sub-Agent Spawner
// ---------------------------------------------------------------------------

/**
 * Spawns and manages sub-agent runs.
 *
 * Upstream: spawnSubagentDirect() in subagent-spawn.ts:
 *   1. Validate depth limit
 *   2. Register run
 *   3. Create isolated session
 *   4. Execute sub-agent turn
 *   5. Announce completion
 *   6. Cleanup
 *
 * Parallx adaptation:
 *   - No isolated sessions — sub-agent runs as separate turn in memory
 *   - Depth tracking enforced at spawn time
 *   - Timeout via AbortController
 *   - Announcement via delegate
 */
export class SubagentSpawner implements IDisposable {
  private readonly _registry: SubagentRegistry;
  private _disposed = false;

  constructor(
    private readonly _executor: SubagentTurnExecutor,
    private readonly _announcer: SubagentAnnouncer | null,
    private readonly _maxDepth: number = DEFAULT_MAX_SPAWN_DEPTH,
    registry?: SubagentRegistry,
  ) {
    this._registry = registry ?? new SubagentRegistry();
  }

  /** The run registry. */
  get registry(): SubagentRegistry {
    return this._registry;
  }

  /**
   * Spawn a sub-agent run.
   * Upstream: spawnSubagentDirect() lifecycle.
   */
  async spawn(params: ISubagentSpawnParams): Promise<ISubagentSpawnResult> {
    if (this._disposed) throw new Error('SubagentSpawner is disposed');

    const depth = params.callerDepth ?? 0;

    // Gate: depth limit — upstream enforces maxSpawnDepth
    if (depth >= this._maxDepth) {
      return {
        runId: '',
        status: 'failed',
        result: null,
        error: `Spawn depth limit exceeded (depth=${depth}, max=${this._maxDepth})`,
        durationMs: 0,
      };
    }

    // Gate: concurrency limit
    if (this._registry.activeCount >= MAX_CONCURRENT_RUNS) {
      return {
        runId: '',
        status: 'failed',
        result: null,
        error: `Maximum concurrent sub-agent runs reached (${MAX_CONCURRENT_RUNS})`,
        durationMs: 0,
      };
    }

    // Step 1: Register — upstream: registerSubagentRun
    const run = this._registry.register(params);
    const startMs = Date.now();

    // Step 2: Mark running
    this._registry.update(run.id, { status: 'running' });

    // Step 3: Execute with timeout
    try {
      const result = await this._executeWithTimeout(
        params.task,
        params.model ?? null,
        run.timeoutMs,
      );

      // Step 4: Mark completed
      const now = Date.now();
      const completedRun = this._registry.update(run.id, {
        status: 'completed',
        result,
        completedAt: now,
      });

      // Step 5: Announce — upstream: completion announcement
      if (this._announcer && result) {
        try {
          await this._announcer(completedRun, result);
        } catch (err) {
          // Announcement failure is non-fatal — upstream retries but
          // we don't block on it
          console.error(`[SubagentSpawner] Announcement failed for ${run.id}:`, err);
        }
      }

      return {
        runId: run.id,
        status: 'completed',
        result,
        error: null,
        durationMs: now - startMs,
      };

    } catch (err) {
      const now = Date.now();
      const isTimeout = err instanceof Error && err.message.includes('timeout');
      const status: SubagentRunStatus = isTimeout ? 'timeout' : 'failed';
      const errorMessage = err instanceof Error ? err.message : String(err);

      this._registry.update(run.id, {
        status,
        error: errorMessage,
        completedAt: now,
      });

      return {
        runId: run.id,
        status,
        result: null,
        error: errorMessage,
        durationMs: now - startMs,
      };
    }
  }

  /**
   * Cancel a running sub-agent.
   */
  cancel(runId: string): boolean {
    const run = this._registry.get(runId);
    if (!run) return false;
    if (run.status !== 'spawning' && run.status !== 'running') return false;

    this._registry.update(runId, {
      status: 'cancelled',
      completedAt: Date.now(),
    });
    return true;
  }

  /**
   * Execute the sub-agent turn with a timeout.
   */
  private async _executeWithTimeout(
    task: string,
    model: string | null,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Sub-agent timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this._executor(task, model)
        .then(result => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch(err => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
    });
  }

  dispose(): void {
    this._disposed = true;
    // Cancel all active runs
    for (const run of this._registry.activeRuns) {
      this._registry.update(run.id, {
        status: 'cancelled',
        completedAt: Date.now(),
      });
    }
    this._registry.dispose();
  }
}
