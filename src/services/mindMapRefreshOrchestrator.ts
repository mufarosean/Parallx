// mindMapRefreshOrchestrator.ts — user-initiated incremental refresh of
// LLM-driven mind-map producers (M76 Phase 3).
//
// Phases 4 (lineage classifier) and 5 (concept clustering) each register
// themselves as a RefreshPass. The orchestrator owns:
//   - per-source / per-pass state for incremental change detection,
//   - cooperative cancellation via AbortController,
//   - progress events for the workspace-graph status UI,
//   - a refresh history table for the user-facing "Last refreshed"
//     panel and an audit trail of past runs.
//
// The orchestrator NEVER runs autonomously. It only acts when something
// calls startRefresh() — wired today to a "Refresh mind map" button in
// the workspace-graph extension's settings panel. No cron, no indexing
// hook, no chat hook. This is the contract.
//
// Phase 3 ships the infrastructure; Phase 4 plugs the lineage pass in,
// Phase 5 the concept-clustering pass.

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import type { IDatabaseService } from './serviceTypes.js';
import type { SemanticGraphSourceType } from './semanticGraphService.js';

/** One indexed source whose content hash has drifted from the last refresh. */
export interface ChangedSource {
  readonly sourceType: SemanticGraphSourceType;
  readonly sourceId: string;
  /** Current content hash from the vector index. */
  readonly currentHash: string;
  /**
   * Hash this source had the last time the requesting pass ran. `null`
   * means the pass has never seen this source (new source).
   */
  readonly lastProcessedHash: string | null;
}

/** Context handed to a RefreshPass.run() invocation. */
export interface RefreshContext {
  /** The refresh-history id this pass is running under. */
  readonly refreshId: string;
  /** Sources the pass should process — already filtered to its delta. */
  readonly changedSources: readonly ChangedSource[];
  /** Cooperative cancellation. Passes must check signal.aborted between units of work. */
  readonly signal: AbortSignal;
  /**
   * Emit progress for the status UI. `current` is the count of work units
   * completed; `total` is the planned count. `label` is human-readable
   * ("Classifying pair 12 of 38").
   */
  reportProgress(current: number, total: number, label?: string): void;
  /**
   * Mark a source as processed by this pass at the current content hash.
   * Called after the pass successfully handles a source so the next
   * refresh doesn't reprocess it.
   */
  markProcessed(sourceType: SemanticGraphSourceType, sourceId: string, contentHash: string): Promise<void>;
}

/**
 * A unit of refresh work that Phases 4 and 5 register. The orchestrator
 * iterates registered passes in registration order during startRefresh.
 */
export interface RefreshPass {
  /** Stable identifier, used as the pass_id in refresh_pass_state rows. */
  readonly id: string;
  /** Human-readable name shown in progress UI ("Lineage classification"). */
  readonly displayName: string;
  /**
   * Optional per-source cost estimate in seconds. The orchestrator
   * sums these to produce the "estimated ~N minutes" hint in the
   * confirmation prompt. If omitted, the orchestrator shows no estimate.
   */
  estimateSecondsPerSource?(): number;
  /** Do the work. Must respect ctx.signal and call ctx.reportProgress. */
  run(ctx: RefreshContext): Promise<void>;
}

/** Lifecycle status emitted by the orchestrator for status UI subscribers. */
export interface RefreshStatus {
  readonly isRefreshing: boolean;
  /** Current pass id (e.g. 'lineage') or null when idle. */
  readonly activePassId: string | null;
  /** Most recent progress label from the active pass, if any. */
  readonly label: string | null;
  /** Current progress units / total, or null. */
  readonly progress: { current: number; total: number } | null;
}

/** Outcome of a single refresh invocation. */
export interface RefreshResult {
  readonly refreshId: string;
  readonly status: 'completed' | 'cancelled' | 'error';
  readonly errorMessage?: string;
  readonly durationMs: number;
  /** Total sources processed across all passes. */
  readonly sourcesProcessed: number;
}

/** A row from refresh_history, surfaced to the UI. */
export interface RefreshHistoryEntry {
  readonly refreshId: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly status: 'running' | 'completed' | 'cancelled' | 'error';
  readonly sourcesProcessed: number;
  readonly errorMessage: string | null;
}

/** Summary of what a refresh would touch — used by the confirmation prompt. */
export interface RefreshPreview {
  /** Total distinct sources that would be processed across all passes. */
  readonly sourcesChanged: number;
  /** Per-pass breakdown of changed sources. */
  readonly perPass: ReadonlyArray<{ passId: string; displayName: string; sourcesChanged: number }>;
  /** Estimated total seconds, if every registered pass provides an estimate. */
  readonly estimatedSeconds: number | null;
}

interface _RegisteredPass {
  readonly pass: RefreshPass;
  readonly disposable: IDisposable;
}

export class MindMapRefreshOrchestrator extends Disposable {
  private readonly _onDidChangeStatus = this._register(new Emitter<RefreshStatus>());
  readonly onDidChangeStatus: Event<RefreshStatus> = this._onDidChangeStatus.event;

  private readonly _onDidComplete = this._register(new Emitter<RefreshResult>());
  readonly onDidComplete: Event<RefreshResult> = this._onDidComplete.event;

  private readonly _passes = new Map<string, _RegisteredPass>();

  private _schemaReady = false;
  private _isRefreshing = false;
  private _activePassId: string | null = null;
  private _label: string | null = null;
  private _progress: { current: number; total: number } | null = null;
  private _abortController: AbortController | null = null;

  constructor(private readonly _db: IDatabaseService) {
    super();
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** Current snapshot of refresh status. Same shape as onDidChangeStatus payloads. */
  getStatus(): RefreshStatus {
    return {
      isRefreshing: this._isRefreshing,
      activePassId: this._activePassId,
      label: this._label,
      progress: this._progress,
    };
  }

  /**
   * Register a refresh pass. Returns a disposable that unregisters when
   * disposed. Registering the same pass id twice replaces the previous
   * registration (last-write-wins, with the prior disposable becoming a
   * no-op).
   */
  registerPass(pass: RefreshPass): IDisposable {
    const prior = this._passes.get(pass.id);
    if (prior) prior.disposable.dispose();
    const disposable: IDisposable = {
      dispose: () => {
        const current = this._passes.get(pass.id);
        if (current && current.pass === pass) {
          this._passes.delete(pass.id);
        }
      },
    };
    this._passes.set(pass.id, { pass, disposable });
    return disposable;
  }

  /** Names of currently-registered passes, in registration order. */
  getRegisteredPasses(): readonly { id: string; displayName: string }[] {
    return Array.from(this._passes.values()).map((rp) => ({
      id: rp.pass.id,
      displayName: rp.pass.displayName,
    }));
  }

  /**
   * Preview what a refresh would touch right now. Used by the
   * confirmation prompt so the user sees "3 changed sources, ~4 minutes"
   * before committing.
   */
  async preview(): Promise<RefreshPreview> {
    await this._ensureSchema();
    const allChanges = new Set<string>(); // dedupe across passes
    const perPass: { passId: string; displayName: string; sourcesChanged: number }[] = [];
    let estimatedSeconds = 0;
    let everyPassEstimates = true;

    for (const rp of this._passes.values()) {
      const changes = await this._getChangedSourcesForPass(rp.pass.id);
      perPass.push({ passId: rp.pass.id, displayName: rp.pass.displayName, sourcesChanged: changes.length });
      for (const c of changes) allChanges.add(`${c.sourceType}:${c.sourceId}`);

      const est = rp.pass.estimateSecondsPerSource?.();
      if (typeof est === 'number' && est >= 0) {
        estimatedSeconds += est * changes.length;
      } else {
        everyPassEstimates = false;
      }
    }

    return {
      sourcesChanged: allChanges.size,
      perPass,
      estimatedSeconds: everyPassEstimates ? estimatedSeconds : null,
    };
  }

  /**
   * Kick off a refresh. Rejects if a refresh is already running. Returns
   * when all registered passes complete, cancel, or error out.
   */
  async startRefresh(): Promise<RefreshResult> {
    if (this._isRefreshing) {
      throw new Error('[MindMapRefresh] A refresh is already running');
    }
    // Set the lock SYNCHRONOUSLY before any await so two concurrent
    // callers can't both pass the guard above (they'd race across the
    // first await otherwise).
    this._isRefreshing = true;
    this._abortController = new AbortController();
    this._activePassId = null;
    this._label = null;
    this._progress = null;
    this._fireStatus();

    try {
      await this._ensureSchema();
    } catch (err) {
      // Schema setup failed — release the lock and rethrow so the caller
      // sees the error rather than a silently-stuck refresh.
      this._isRefreshing = false;
      this._abortController = null;
      this._fireStatus();
      throw err;
    }

    const refreshId = _newRefreshId();
    const startedAt = new Date().toISOString();

    await this._db.run(
      `INSERT INTO refresh_history (id, started_at, status, sources_processed) VALUES (?, ?, 'running', 0)`,
      [refreshId, startedAt],
    );

    const startMs = Date.now();
    let totalProcessed = 0;
    let status: RefreshResult['status'] = 'completed';
    let errorMessage: string | undefined;

    try {
      for (const rp of this._passes.values()) {
        if (this._abortController.signal.aborted) {
          status = 'cancelled';
          break;
        }
        this._activePassId = rp.pass.id;
        this._label = `${rp.pass.displayName}: gathering work`;
        this._progress = null;
        this._fireStatus();

        const changes = await this._getChangedSourcesForPass(rp.pass.id);
        if (changes.length === 0) continue;

        const ctx: RefreshContext = {
          refreshId,
          changedSources: changes,
          signal: this._abortController.signal,
          reportProgress: (current, total, label) => {
            this._progress = { current, total };
            if (label !== undefined) this._label = label;
            this._fireStatus();
          },
          markProcessed: async (sourceType, sourceId, contentHash) => {
            await this._db.run(
              `INSERT OR REPLACE INTO refresh_pass_state
                 (pass_id, source_type, source_id, last_processed_hash, last_processed_at)
               VALUES (?, ?, ?, ?, datetime('now'))`,
              [rp.pass.id, sourceType, sourceId, contentHash],
            );
            totalProcessed += 1;
          },
        };

        await rp.pass.run(ctx);

        if (this._abortController.signal.aborted) {
          status = 'cancelled';
          break;
        }
      }
    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const completedAt = new Date().toISOString();
    await this._db.run(
      `UPDATE refresh_history
         SET completed_at = ?, status = ?, sources_processed = ?, error_message = ?
       WHERE id = ?`,
      [completedAt, status, totalProcessed, errorMessage ?? null, refreshId],
    );

    this._isRefreshing = false;
    this._activePassId = null;
    this._label = null;
    this._progress = null;
    this._abortController = null;
    this._fireStatus();

    const result: RefreshResult = {
      refreshId,
      status,
      errorMessage,
      durationMs: Date.now() - startMs,
      sourcesProcessed: totalProcessed,
    };
    this._onDidComplete.fire(result);
    return result;
  }

  /**
   * Signal an in-progress refresh to stop at the next cooperative
   * checkpoint. No-op when nothing is running.
   */
  cancelRefresh(): void {
    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort();
    }
  }

  /** Read the N most recent refresh-history rows, newest first. */
  async getRefreshHistory(limit: number = 10): Promise<RefreshHistoryEntry[]> {
    await this._ensureSchema();
    const cap = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = await this._db.all<{
      id: string;
      started_at: string;
      completed_at: string | null;
      status: 'running' | 'completed' | 'cancelled' | 'error';
      sources_processed: number;
      error_message: string | null;
    }>(
      `SELECT id, started_at, completed_at, status, sources_processed, error_message
         FROM refresh_history
        ORDER BY started_at DESC
        LIMIT ?`,
      [cap],
    );
    return rows.map((r) => ({
      refreshId: r.id,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      status: r.status,
      sourcesProcessed: r.sources_processed,
      errorMessage: r.error_message,
    }));
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private async _ensureSchema(): Promise<void> {
    if (this._schemaReady || !this._db.isOpen) return;

    // Per-pass per-source state for incremental change detection. A pass
    // marks each source it processed with the source's content hash at
    // that time. The next refresh compares against the current hash to
    // identify deltas. Cascade-on-pass-deletion isn't necessary because
    // pass ids are stable program-wide.
    await this._db.run(`
      CREATE TABLE IF NOT EXISTS refresh_pass_state (
        pass_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        last_processed_hash TEXT NOT NULL,
        last_processed_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (pass_id, source_type, source_id)
      )
    `);

    // Refresh audit log. One row per startRefresh invocation. UI shows
    // the most recent N rows; the table is unbounded but small.
    await this._db.run(`
      CREATE TABLE IF NOT EXISTS refresh_history (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        sources_processed INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      )
    `);

    await this._db.run(
      'CREATE INDEX IF NOT EXISTS idx_refresh_history_started ON refresh_history(started_at DESC)',
    );

    this._schemaReady = true;
  }

  /**
   * For a given pass, return sources whose current content hash differs
   * from what the pass has previously processed. New sources (no prior
   * row) are included.
   */
  private async _getChangedSourcesForPass(passId: string): Promise<ChangedSource[]> {
    const rows = await this._db.all<{
      source_type: SemanticGraphSourceType;
      source_id: string;
      current_hash: string;
      last_processed_hash: string | null;
    }>(
      `SELECT s.source_type, s.source_id, s.content_hash as current_hash,
              r.last_processed_hash
         FROM semantic_graph_sources s
         LEFT JOIN refresh_pass_state r
           ON r.pass_id = ? AND r.source_type = s.source_type AND r.source_id = s.source_id
        WHERE s.content_hash IS NOT NULL
          AND (r.last_processed_hash IS NULL OR r.last_processed_hash <> s.content_hash)`,
      [passId],
    );
    return rows.map((r) => ({
      sourceType: r.source_type,
      sourceId: r.source_id,
      currentHash: r.current_hash,
      lastProcessedHash: r.last_processed_hash,
    }));
  }

  private _fireStatus(): void {
    this._onDidChangeStatus.fire(this.getStatus());
  }
}

function _newRefreshId(): string {
  // crypto.randomUUID is available in modern Node and Chromium. We don't
  // need cryptographic uniqueness — just a stable id for one workspace.
  if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for unusual runtimes — adequate for an audit-log id.
  const part = (): string => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${part()}-${part()}`;
}
