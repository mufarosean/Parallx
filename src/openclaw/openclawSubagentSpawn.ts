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
import type { IOpenclawContextEngine } from './openclawContextEngine.js';

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
  /**
   * HARNESS.md §4 — typed subagent profile. 'reader' runs with the readonly
   * tool profile (research / summarize — context isolation is the point);
   * 'worker' runs with the standard profile (reads + safe writes, no shell).
   * Absent = legacy behavior (parent-mode profile).
   */
  readonly profile?: 'reader' | 'worker';
  /**
   * HARNESS.md §4.1 (the M59 debt, finally paid) — explicit tool allowlist
   * for the subagent turn. Applied as the agent-tools allow filter in the
   * tool policy pipeline; empty/absent = no extra restriction.
   */
  readonly tools?: readonly string[];
  /**
   * The run that asked (its session id). A helper of your chat turn shares
   * the turn's place in the model queue; a helper of a background run waits
   * behind chat (AGENT_RUNTIME_DESIGN.md §4).
   */
  readonly parentRunId?: string;
  /** The parent turn's cancel: stopping the parent stops the helper. */
  readonly signal?: AbortSignal;
}

/** The per-spawn policy the executor registers for the ephemeral session. */
export interface ISubagentSessionPolicy {
  readonly profile?: 'reader' | 'worker';
  readonly tools?: readonly string[];
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
  policy?: ISubagentSessionPolicy,
  control?: ISubagentTurnControl,
) => Promise<string>;

/**
 * How the spawner steers a running helper turn: `signal` aborts it (Stop or
 * its time limit; the executor cancels the turn, which closes the model
 * request), and `onSession` names the session it runs in, so the time limit
 * can leave out time spent waiting for the model behind your chat.
 */
export interface ISubagentTurnControl {
  readonly signal: AbortSignal;
  /** The run that spawned this helper (see ISubagentSpawnParams.parentRunId). */
  readonly parentRunId?: string;
  onSession?(sessionId: string): void;
}

/**
 * Delegate that announces a sub-agent result back to the parent chat.
 * Upstream: completion announcement with retry.
 */
export type SubagentAnnouncer = (
  run: ISubagentRun,
  result: string,
) => Promise<void>;

// ---------------------------------------------------------------------------
// M60 Phase γ — controls layer types
// ---------------------------------------------------------------------------

/**
 * Per-spawn autonomy event hand-off. The spawner produces this on every
 * `spawn()` invocation; the wiring in `src/built-in/chat/main.ts` translates
 * it into an `IAutonomyEventLog.emit({ trigger: { kind: 'subagent' }, ... })` call.
 */
export interface ISubagentSpawnAutonomyInfo {
  readonly outcome: 'completed' | 'gated' | 'budget' | 'error' | 'cancelled';
  readonly runId: string;
  readonly depth: number;
  readonly durationMs: number;
  readonly note?: string;
}

/** Optional autonomy controls (M60 §3.8/§3.10/§8). */
export interface ISubagentObservers {
  /** Returns `true` when the `autonomy.subagent.enabled` flag is on AND `autonomy.paused.global` is off. */
  readonly isFlagEnabled?: () => boolean;
  /** Called once per spawn lifecycle event. */
  readonly onAutonomyEvent?: (info: ISubagentSpawnAutonomyInfo) => void;
  /**
   * M60 §8 E3 — pattern memory pre-flight. Returns `true` when the spawn
   * shape matches a remembered pattern. The spawner records a matched
   * pattern via `notePatternMatch` after completion. Pattern memory only
   * shapes the *presentation* (skip user prompt) — the flag gate is still
   * authoritative.
   */
  readonly isPatternApproved?: (params: { task: string; label?: string; model?: string }) => boolean;
  /** Called when a remembered pattern matched. Used to bump match count. */
  readonly notePatternMatch?: (params: { task: string; label?: string; model?: string }) => void;
}

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
  /** M60 Phase γ — controls layer observers (flag + event emit). */
  private _observers: ISubagentObservers = {};
  /** Running helper turns, by run id: abort stops the turn. */
  private readonly _controllers = new Map<string, AbortController>();
  private _waitingMs: ((sessionId: string) => number) | undefined;

  constructor(
    private readonly _executor: SubagentTurnExecutor,
    private readonly _announcer: SubagentAnnouncer | null,
    private readonly _maxDepth: number = DEFAULT_MAX_SPAWN_DEPTH,
    registry?: SubagentRegistry,
    /** D8-8: Optional context engine for subagent context preparation/feedback. */
    private readonly _contextEngine?: IOpenclawContextEngine,
    private readonly _parentSessionId?: string,
  ) {
    this._registry = registry ?? new SubagentRegistry();
  }

  /** M60 Phase γ §3.8/§3.10 — install autonomy controls. Idempotent. */
  setObservers(observers: ISubagentObservers): void {
    this._observers = { ...observers };
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
    const startMsGate = Date.now();

    // M60 §3.8: autonomy.subagent.enabled feature flag gate. Refuse spawn
    // when off and emit a `gated` autonomy event.
    if (this._observers.isFlagEnabled && !this._observers.isFlagEnabled()) {
      this._emitSpawnEvent({
        outcome: 'gated',
        runId: '',
        depth,
        durationMs: 0,
        note: 'autonomy.subagent.enabled=false',
      });
      return {
        runId: '',
        status: 'failed',
        result: null,
        error: 'gated:autonomy.subagent.enabled=false',
        durationMs: 0,
      };
    }

    // Gate: depth limit — upstream enforces maxSpawnDepth.
    // M60 §3.6: M60 hard-caps at depth=1 (no nested spawns) via the
    // chat extension wiring; this is an additional defense.
    if (depth >= this._maxDepth) {
      this._emitSpawnEvent({
        outcome: 'budget',
        runId: '',
        depth,
        durationMs: Date.now() - startMsGate,
        note: `depth-limit:max=${this._maxDepth}`,
      });
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
      this._emitSpawnEvent({
        outcome: 'budget',
        runId: '',
        depth,
        durationMs: Date.now() - startMsGate,
        note: `concurrency-limit:max=${MAX_CONCURRENT_RUNS}`,
      });
      return {
        runId: '',
        status: 'failed',
        result: null,
        error: `Maximum concurrent sub-agent runs reached (${MAX_CONCURRENT_RUNS})`,
        durationMs: 0,
      };
    }

    // M60 §8 E3 — note remembered-pattern match (for visibility in the
    // task rail). This does NOT replace the flag gate above; it only
    // bumps the match counter and surfaces a `pattern-approved` note in
    // the autonomy event so the user can see why a spawn skipped manual
    // approval.
    let patternMatched = false;
    if (this._observers.isPatternApproved && this._observers.isPatternApproved({
      task: params.task,
      label: params.label,
      model: params.model,
    })) {
      patternMatched = true;
      this._observers.notePatternMatch?.({
        task: params.task,
        label: params.label,
        model: params.model,
      });
    }

    // Step 1: Register — upstream: registerSubagentRun
    const run = this._registry.register(params);
    const startMs = Date.now();

    // Step 2: Mark running
    this._registry.update(run.id, { status: 'running' });

    // Step 2b: D8-8 — Prepare context snapshot from engine if available
    if (this._contextEngine?.prepareSubagentSpawn && this._parentSessionId) {
      try {
        await this._contextEngine.prepareSubagentSpawn({
          task: params.task,
          tokenBudget: 2048,
          parentSessionId: this._parentSessionId,
        });
      } catch {
        // Context preparation failure is non-fatal
      }
    }

    // Step 3: Execute with timeout
    try {
      const result = await this._executeWithTimeout(
        params.task,
        params.model ?? null,
        run.timeoutMs,
        { profile: params.profile, tools: params.tools },
        run.id,
        params.parentRunId,
        params.signal,
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

      // Step 5b: D8-8 — Notify context engine of subagent completion
      if (this._contextEngine?.onSubagentEnded && this._parentSessionId) {
        try {
          await this._contextEngine.onSubagentEnded({
            runId: run.id,
            parentSessionId: this._parentSessionId,
            result,
            status: 'completed',
          });
        } catch {
          // Context engine feedback failure is non-fatal
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

      // D8-8: Notify context engine of subagent failure
      if (this._contextEngine?.onSubagentEnded && this._parentSessionId) {
        try {
          await this._contextEngine.onSubagentEnded({
            runId: run.id,
            parentSessionId: this._parentSessionId,
            result: null,
            status: isTimeout ? 'timeout' : 'failed',
          });
        } catch {
          // Non-fatal
        }
      }

      this._emitSpawnEvent({
        outcome: 'error',
        runId: run.id,
        depth,
        durationMs: now - startMs,
        note: errorMessage,
      });
      return {
        runId: run.id,
        status,
        result: null,
        error: errorMessage,
        durationMs: now - startMs,
      };
    } finally {
      // Emit on the success branch (only if status was set to completed).
      const finalRun = this._registry.get(run.id);
      if (finalRun?.status === 'completed') {
        this._emitSpawnEvent({
          outcome: 'completed',
          runId: run.id,
          depth,
          durationMs: Date.now() - startMs,
          note: patternMatched ? 'pattern-approved' : undefined,
        });
      }
    }
  }

  /** M60 Phase γ — emit a spawn-lifecycle autonomy event; never throws. */
  private _emitSpawnEvent(info: ISubagentSpawnAutonomyInfo): void {
    if (!this._observers.onAutonomyEvent) return;
    try {
      this._observers.onAutonomyEvent(info);
    } catch {
      /* observer errors are non-fatal */
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
    // Stop the turn itself, so the model engine is free at once.
    this._controllers.get(runId)?.abort();
    this._controllers.delete(runId);
    return true;
  }

  /**
   * Time a helper's session has spent waiting for the model (the engine
   * broker's count), left out of its time limit.
   */
  setWaitingClock(fn: ((sessionId: string) => number) | undefined): void {
    this._waitingMs = fn;
  }

  /**
   * Execute the sub-agent turn with a timeout.
   */
  private async _executeWithTimeout(
    task: string,
    model: string | null,
    timeoutMs: number,
    policy?: ISubagentSessionPolicy,
    runId?: string,
    parentRunId?: string,
    parentSignal?: AbortSignal,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const controller = new AbortController();
      if (runId) this._controllers.set(runId, controller);
      // Stopping the parent turn stops the helper too.
      const onParentAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (runId) this._controllers.delete(runId);
        controller.abort();
        reject(new Error('Sub-agent cancelled: the turn that asked for it was stopped.'));
      };
      if (parentSignal?.aborted) { queueMicrotask(onParentAbort); }
      parentSignal?.addEventListener('abort', onParentAbort, { once: true });
      let sessionId: string | undefined;
      const startedAt = Date.now();

      // The limit counts working time: time the helper spent waiting for
      // the model behind your chat does not use it up.
      const working = () => Date.now() - startedAt - (sessionId && this._waitingMs ? this._waitingMs(sessionId) : 0);
      let timer: ReturnType<typeof setTimeout>;
      const check = () => {
        if (settled) return;
        const used = working();
        if (used < timeoutMs) { timer = setTimeout(check, Math.max(250, timeoutMs - used)); return; }
        settled = true;
        if (runId) this._controllers.delete(runId);
        controller.abort();
        reject(new Error(`Sub-agent timeout after ${timeoutMs}ms`));
      };
      timer = setTimeout(check, timeoutMs);

      this._executor(task, model, policy, { signal: controller.signal, parentRunId, onSession: (id) => { sessionId = id; } })
        .then(result => {
          parentSignal?.removeEventListener('abort', onParentAbort);
          if (runId) this._controllers.delete(runId);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch(err => {
          parentSignal?.removeEventListener('abort', onParentAbort);
          if (runId) this._controllers.delete(runId);
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
    for (const c of this._controllers.values()) c.abort();
    this._controllers.clear();
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
