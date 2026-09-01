// workflowService.ts — the workflow spine: documents, scheduling, event
// triggers, runs, and the cooldown ledger. docs/WORKFLOWS_BRIEF.md.
//
// Lifecycle follows CronService exactly (the proven autonomy pattern):
// CORE constructs and hydrates it (autonomyBootstrap) so workflows are
// visible from boot; chat attaches the execution half when its substrate
// is ready (attachExecution), and start() begins the schedule timer.
// Everything attachable is late-bound — the service never imports chat.
//
// Persistence is the cron.json pattern: one JSON snapshot in
// `<workspace>/.parallx/workflows.json` holding documents, runtime
// schedule state, the cooldown ledger, and the recent-run ring.

import type { IDisposable } from '../../platform/lifecycle.js';
import { Emitter, type Event } from '../../platform/events.js';
import { createServiceIdentifier } from '../../platform/types.js';
import { computeNextRun, type ICronJob } from '../../openclaw/openclawCronService.js';
import { buildCronSchedule } from '../../openclaw/cronScheduleSpec.js';
import type { IActivityEvent } from '../activityJournalService.js';
import {
  MAX_RUNS_RETAINED,
  MAX_WORKFLOWS,
  isTriggerNode,
  type WorkflowDoc,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowTriggerContext,
} from './workflowTypes.js';
import { describeTriggerNode, validateWorkflow } from './workflowGraph.js';
import {
  executeWorkflowRun,
  type CooldownLedger,
  type WorkflowExecutionDeps,
} from './workflowRunner.js';
import { WORKFLOW_TEMPLATES, cronJobToWorkflow, instantiateTemplate } from './workflowLibrary.js';

export const WORKFLOW_CHECK_INTERVAL_MS = 60_000;
/** Event-triggered firings per workflow are rate-limited to one a minute —
 *  a chatty journal must never turn a workflow into a machine gun. */
const EVENT_FIRE_MIN_GAP_MS = 60_000;

// ── Persistence ─────────────────────────────────────────────────────────────

export interface IWorkflowPersistedSnapshot {
  readonly version: 1;
  readonly docs: readonly WorkflowDoc[];
  readonly runs: readonly WorkflowRun[];
  readonly ledger: Readonly<Record<string, number>>;
  /** `${workflowId}:${nodeId}` → schedule runtime state. */
  readonly schedules: Readonly<Record<string, { anchorMs: number; nextRunAt: number | null }>>;
}

export interface IWorkflowPersistence {
  load(): Promise<IWorkflowPersistedSnapshot | null>;
  save(snapshot: IWorkflowPersistedSnapshot): Promise<void>;
}

// ── Observers (the log + audit seams, late-bound like cron's) ───────────────

export interface IWorkflowObservers {
  /** UX log (AutonomyLogService.append) — one entry per completed run. */
  readonly onRunRecorded?: (run: WorkflowRun) => void;
  /** Global pause — FLAG_PAUSED_GLOBAL. Automatic firings hold; manual runs pass. */
  readonly isPaused?: () => boolean;
}

export interface IWorkflowChangeEvent {
  readonly kind: 'added' | 'updated' | 'removed' | 'ran' | 'bulk';
  readonly workflowId?: string;
}

// ── The service ─────────────────────────────────────────────────────────────

export class WorkflowService implements IDisposable {
  private readonly _docs = new Map<string, WorkflowDoc>();
  private readonly _runs: WorkflowRun[] = [];
  private readonly _ledger = new Map<string, number>();
  /** `${workflowId}:${nodeId}` → schedule runtime state. */
  private readonly _schedules = new Map<string, { anchorMs: number; nextRunAt: number | null }>();
  private readonly _lastEventFire = new Map<string, number>();

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _disposed = false;
  private _nextId = 1;
  private _deps: WorkflowExecutionDeps | undefined;
  private _observers: IWorkflowObservers = {};
  private _persistence: IWorkflowPersistence | undefined;
  private _journalSub: IDisposable | undefined;

  private readonly _onDidChangeWorkflows = new Emitter<IWorkflowChangeEvent>();
  readonly onDidChangeWorkflows: Event<IWorkflowChangeEvent> = this._onDidChangeWorkflows.event;
  private readonly _onDidRecordRun = new Emitter<WorkflowRun>();
  readonly onDidRecordRun: Event<WorkflowRun> = this._onDidRecordRun.event;

  // ── Late binding ──────────────────────────────────────────────────────────

  setPersistence(p: IWorkflowPersistence): void { this._persistence = p; }
  setObservers(o: IWorkflowObservers): void { this._observers = { ...o }; }

  attachExecution(deps: WorkflowExecutionDeps): void { this._deps = deps; }

  /** Subscribe event triggers to the activity journal's append feed. */
  attachJournalFeed(onDidAppend: Event<IActivityEvent>): void {
    this._journalSub?.dispose();
    this._journalSub = onDidAppend((e) => { void this._onJournalEvent(e); });
  }

  get executionAttached(): boolean { return this._deps !== undefined; }

  async loadFromPersistence(): Promise<void> {
    if (!this._persistence) return;
    try {
      const snap = await this._persistence.load();
      if (!snap || !Array.isArray(snap.docs)) return;
      this._docs.clear();
      let maxId = 0;
      for (const doc of snap.docs) {
        if (!doc || typeof doc.id !== 'string') continue;
        this._docs.set(doc.id, doc);
        const m = /^wf-(\d+)$/.exec(doc.id);
        if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
      }
      this._nextId = maxId + 1;
      this._runs.length = 0;
      for (const r of Array.isArray(snap.runs) ? snap.runs : []) this._runs.push(r);
      this._ledger.clear();
      for (const [k, v] of Object.entries(snap.ledger ?? {})) {
        if (Number.isFinite(v)) this._ledger.set(k, v);
      }
      this._schedules.clear();
      const now = Date.now();
      for (const [k, v] of Object.entries(snap.schedules ?? {})) {
        // Missed firings coalesce into one catch-up (cron's load semantics).
        this._schedules.set(k, {
          anchorMs: v.anchorMs,
          nextRunAt: v.nextRunAt !== null && v.nextRunAt <= now ? now : v.nextRunAt,
        });
      }
      this._syncScheduleStates();
      this._onDidChangeWorkflows.fire({ kind: 'bulk' });
    } catch { /* corrupt persistence — start empty */ }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  get workflows(): readonly WorkflowDoc[] { return [...this._docs.values()]; }
  getWorkflow(id: string): WorkflowDoc | undefined { return this._docs.get(id); }

  addWorkflow(doc: Omit<WorkflowDoc, 'id' | 'createdAt' | 'updatedAt'>): WorkflowDoc {
    if (this._disposed) throw new Error('WorkflowService is disposed');
    if (this._docs.size >= MAX_WORKFLOWS) {
      throw new Error(`Workflow limit reached (${MAX_WORKFLOWS}).`);
    }
    const now = Date.now();
    const full: WorkflowDoc = { ...doc, id: `wf-${this._nextId++}`, createdAt: now, updatedAt: now };
    this._assertValid(full);
    this._docs.set(full.id, full);
    this._syncScheduleStates();
    void this._save();
    this._onDidChangeWorkflows.fire({ kind: 'added', workflowId: full.id });
    return full;
  }

  updateWorkflow(id: string, patch: Partial<Omit<WorkflowDoc, 'id' | 'createdAt'>>): WorkflowDoc {
    const existing = this._docs.get(id);
    if (!existing) throw new Error(`Workflow not found: ${id}`);
    const updated: WorkflowDoc = { ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: Date.now() };
    this._assertValid(updated);
    this._docs.set(id, updated);
    this._syncScheduleStates();
    void this._save();
    this._onDidChangeWorkflows.fire({ kind: 'updated', workflowId: id });
    return updated;
  }

  removeWorkflow(id: string): boolean {
    const removed = this._docs.delete(id);
    if (removed) {
      this._syncScheduleStates();
      void this._save();
      this._onDidChangeWorkflows.fire({ kind: 'removed', workflowId: id });
    }
    return removed;
  }

  setEnabled(id: string, enabled: boolean): WorkflowDoc {
    return this.updateWorkflow(id, { enabled });
  }

  installTemplate(key: string): WorkflowDoc {
    const t = WORKFLOW_TEMPLATES.find((x) => x.key === key);
    if (!t) throw new Error(`Unknown workflow template: ${key}`);
    const doc = instantiateTemplate(t, `wf-${this._nextId++}`);
    this._assertValid(doc);
    this._docs.set(doc.id, doc);
    this._syncScheduleStates();
    void this._save();
    this._onDidChangeWorkflows.fire({ kind: 'added', workflowId: doc.id });
    return doc;
  }

  /** The two-node cron migration. The original job is left in place —
   *  the caller decides when to retire it. */
  migrateCronJob(job: ICronJob): WorkflowDoc {
    const doc = cronJobToWorkflow(job, `wf-${this._nextId++}`);
    this._assertValid(doc);
    this._docs.set(doc.id, doc);
    this._syncScheduleStates();
    void this._save();
    this._onDidChangeWorkflows.fire({ kind: 'added', workflowId: doc.id });
    return doc;
  }

  private _assertValid(doc: WorkflowDoc): void {
    const v = validateWorkflow(doc);
    // Drafts (no trigger yet) are storable; structural errors are not.
    if (v.errors.length > 0) {
      throw new Error(`Invalid workflow: ${v.errors.join(' ')}`);
    }
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  get runs(): readonly WorkflowRun[] { return [...this._runs]; }
  getRuns(workflowId: string): readonly WorkflowRun[] {
    return this._runs.filter((r) => r.workflowId === workflowId);
  }

  /** Next scheduled firing for a workflow, or null. */
  nextRunAt(workflowId: string): number | null {
    let best: number | null = null;
    for (const [key, st] of this._schedules) {
      if (!key.startsWith(`${workflowId}:`)) continue;
      if (st.nextRunAt !== null && (best === null || st.nextRunAt < best)) best = st.nextRunAt;
    }
    return best;
  }

  /**
   * Run a workflow NOW, from its manual trigger if it has one, else from
   * its first trigger. User-initiated: bypasses the pause flag (M90 —
   * user-initiated means approved).
   */
  async runNow(id: string): Promise<WorkflowRun> {
    const doc = this._docs.get(id);
    if (!doc) throw new Error(`Workflow not found: ${id}`);
    const triggers = doc.nodes.filter(isTriggerNode);
    const trigger = triggers.find((t) => t.kind === 'trigger.manual') ?? triggers[0];
    if (!trigger) throw new Error(`"${doc.name}" is a draft — it has no trigger to fire.`);
    return this._fire(doc, trigger, {
      kind: trigger.kind,
      summary: 'run manually',
    });
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  start(): void {
    if (this._disposed || this._timer) return;
    void this._checkDue(); // catch-up (coalesced at load)
    this._timer = setInterval(() => { void this._checkDue(); }, WORKFLOW_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  dispose(): void {
    this._disposed = true;
    this.stop();
    this._journalSub?.dispose();
    this._onDidChangeWorkflows.dispose();
    this._onDidRecordRun.dispose();
  }

  /** Recompute the schedule-state map from the current documents. */
  private _syncScheduleStates(): void {
    const seen = new Set<string>();
    const now = Date.now();
    for (const doc of this._docs.values()) {
      for (const node of doc.nodes) {
        if (node.kind !== 'trigger.schedule') continue;
        const key = `${doc.id}:${node.id}`;
        seen.add(key);
        const existing = this._schedules.get(key);
        if (existing) {
          // Disabled workflows hold their state but never fire (_checkDue
          // filters); re-enabling resumes the same grid.
          continue;
        }
        try {
          const schedule = buildCronSchedule(node.spec);
          this._schedules.set(key, { anchorMs: now, nextRunAt: computeNextRun(schedule, now, now) });
        } catch {
          this._schedules.set(key, { anchorMs: now, nextRunAt: null });
        }
      }
    }
    for (const key of [...this._schedules.keys()]) {
      if (!seen.has(key)) this._schedules.delete(key);
    }
  }

  private async _checkDue(): Promise<void> {
    if (this._disposed || !this._deps) return;
    if (this._observers.isPaused?.()) return;
    const now = Date.now();
    for (const [key, st] of this._schedules) {
      if (st.nextRunAt === null || st.nextRunAt > now) continue;
      const [workflowId, nodeId] = splitScheduleKey(key);
      const doc = this._docs.get(workflowId);
      const node = doc?.nodes.find((n) => n.id === nodeId);
      // Advance the grid FIRST — a throwing run must not wedge the slot.
      try {
        const schedule = node && node.kind === 'trigger.schedule' ? buildCronSchedule(node.spec) : null;
        let next = schedule ? computeNextRun(schedule, now, st.anchorMs) : null;
        // An exact-boundary `now` recomputes to the SAME slot — step past it.
        if (schedule && next !== null && next <= now) next = computeNextRun(schedule, next + 1, st.anchorMs);
        st.nextRunAt = next;
      } catch { st.nextRunAt = null; }
      if (!doc || !doc.enabled || !node || node.kind !== 'trigger.schedule') continue;
      await this._fire(doc, node, {
        kind: 'trigger.schedule',
        summary: describeTriggerNode(node),
      }).catch((err) => console.warn(`[Workflows] scheduled run of "${doc.name}" failed:`, err));
    }
    void this._save();
  }

  private async _onJournalEvent(e: IActivityEvent): Promise<void> {
    if (this._disposed || !this._deps) return;
    if (this._observers.isPaused?.()) return;
    const now = Date.now();
    for (const doc of this._docs.values()) {
      if (!doc.enabled) continue;
      for (const node of doc.nodes) {
        if (node.kind !== 'trigger.event') continue;
        if (node.actor !== undefined && node.actor !== e.actor) continue;
        if (node.verb !== undefined && node.verb !== e.verb) continue;
        if (node.source !== undefined && node.source !== e.source) continue;
        // Never react to the app's own workflow activity — echo guard.
        if (typeof e.detail === 'string' && e.detail.startsWith('workflow:')) continue;
        const gapKey = `${doc.id}:${node.id}`;
        const last = this._lastEventFire.get(gapKey) ?? 0;
        if (now - last < EVENT_FIRE_MIN_GAP_MS) continue;
        this._lastEventFire.set(gapKey, now);
        await this._fire(doc, node, {
          kind: 'trigger.event',
          summary: `${e.actor} ${e.verb} ${e.object}`,
          event: { actor: e.actor, verb: e.verb, object: e.object, source: e.source, detail: e.detail ?? '' },
        }).catch((err) => console.warn(`[Workflows] event run of "${doc.name}" failed:`, err));
        break; // one firing per doc per journal event
      }
    }
  }

  private async _fire(doc: WorkflowDoc, trigger: WorkflowNode, ctx: WorkflowTriggerContext): Promise<WorkflowRun> {
    if (!this._deps) throw new Error('Workflow execution is not attached yet.');
    const ledger: CooldownLedger = {
      sinceStamp: (k) => {
        const at = this._ledger.get(k);
        return at === undefined ? null : Date.now() - at;
      },
      stamp: (k) => { this._ledger.set(k, Date.now()); },
    };
    const run = await executeWorkflowRun(doc, trigger, ctx, this._deps, ledger);
    this._runs.push(run);
    if (this._runs.length > MAX_RUNS_RETAINED) {
      this._runs.splice(0, this._runs.length - MAX_RUNS_RETAINED);
    }
    void this._save();
    this._onDidChangeWorkflows.fire({ kind: 'ran', workflowId: doc.id });
    this._onDidRecordRun.fire(run);
    try { this._observers.onRunRecorded?.(run); } catch { /* observer failures never break runs */ }
    return run;
  }

  private async _save(): Promise<void> {
    if (!this._persistence) return;
    try {
      await this._persistence.save({
        version: 1,
        docs: [...this._docs.values()],
        runs: [...this._runs],
        ledger: Object.fromEntries(this._ledger),
        schedules: Object.fromEntries(this._schedules),
      });
    } catch { /* persistence failures never break the runtime */ }
  }
}

function splitScheduleKey(key: string): [string, string] {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
}

export const IWorkflowService = createServiceIdentifier<WorkflowService>('IWorkflowService');
