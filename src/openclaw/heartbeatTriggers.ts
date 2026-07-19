// heartbeatTriggers.ts — M87 S1: the heartbeat's DETERMINISTIC trigger engine.
//
// The old heartbeat asked a model "can you genuinely help?" every beat — an
// unanswerable brief that correctly resolved to NOOP forever. This module is
// the replacement core: pure functions that turn collected FACTS about the
// user's life-data into FINDINGS via thresholds, rising edges, and per-key
// cooldowns. NO model is involved; every rule is reproducible in a unit test.
//
// S1 rules (docs/Parallx_Milestone_87.md §4):
//   UC1 stalled-plan     — a session plan's active step untouched > stallDays
//   UC2 review-queue     — ≥ reviewQueueSize captured tasks, oldest > 3d
//   UC3 overdue-task     — a planned task > overdueDays past due
//
// Senses feeding this engine are equally pure: buildPlanFacts maps chat
// session plans; task facts arrive typed from IPlannerQueryService.
// Delivery/persistence live in heartbeatDeterministicLane.ts.

// ── Facts ────────────────────────────────────────────────────────────────────

export interface IHeartbeatPlanFact {
  readonly sessionId: string;
  readonly goal: string;
  /** Text of the first step with status 'active', if any. */
  readonly activeStep: string | null;
  /** Last plan_update timestamp (ms). */
  readonly updatedAt: number;
}

export interface IHeartbeatTaskFact {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly dueAt: number | null;
  readonly createdAt: number;
}

export interface IHeartbeatFacts {
  readonly plans: readonly IHeartbeatPlanFact[];
  readonly tasks: readonly IHeartbeatTaskFact[];
  /** UC4 — planner sync health. null/undefined = sync not configured. */
  readonly sync?: { readonly failed: boolean; readonly detail: string | null } | null;
  /** UC5 — today's schedule shape (events + tasks due today, local day). */
  readonly today?: { readonly events: number; readonly tasksDue: number } | null;
  /**
   * UC7 — AGENTS.md staleness inputs: a short content hash (null = file
   * missing) and how many canvas pages changed in the last 30 days.
   */
  readonly agentsMd?: { readonly hashPrefix: string | null; readonly recentPageUpdates: number } | null;
}

/** Tiny stable content hash (djb2, hex) for staleness identity — NOT crypto. */
export function contentHashPrefix(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Narrow session-plan shape (mirrors IChatSessionPlan without importing chat types). */
export interface ISessionPlanSnapshot {
  readonly sessionId: string;
  readonly plan?: {
    readonly goal: string;
    readonly steps: readonly { readonly text: string; readonly status: string }[];
    readonly updatedAt?: number;
  };
}

/** Pure sense: session plans → plan facts (sessions without plans drop out). */
export function buildPlanFacts(sessions: readonly ISessionPlanSnapshot[]): IHeartbeatPlanFact[] {
  const out: IHeartbeatPlanFact[] = [];
  for (const s of sessions) {
    const plan = s.plan;
    if (!plan || typeof plan.goal !== 'string' || !Array.isArray(plan.steps)) continue;
    const active = plan.steps.find((st) => st.status === 'active');
    out.push({
      sessionId: s.sessionId,
      goal: plan.goal,
      activeStep: active ? active.text : null,
      updatedAt: typeof plan.updatedAt === 'number' ? plan.updatedAt : 0,
    });
  }
  return out;
}

// ── Findings ─────────────────────────────────────────────────────────────────

export type HeartbeatFindingKind =
  | 'stalled-plan'
  | 'review-queue'
  | 'overdue-task'
  | 'sync-failure'
  | 'morning-digest'
  | 'agents-stale';

export interface IHeartbeatFinding {
  /** Stable identity for cooldown/dedup (e.g. "overdue-task:task-42"). */
  readonly key: string;
  readonly kind: HeartbeatFindingKind;
  readonly title: string;
  readonly detail: string;
  /** Where this lands: follow-up shaped → review-queue task; alert → notification. */
  readonly delivery: 'task' | 'notification';
  /** Re-delivery suppression window for this key. */
  readonly cooldownMs: number;
}

/** key → last-delivered epoch ms. Persisted by the lane across restarts. */
export type IHeartbeatLedger = Record<string, number>;

export interface IHeartbeatTriggerConfig {
  /** UC1: days an active plan step may sit untouched before a nudge. */
  readonly stallDays: number;
  /** UC2: review-queue size that warrants a triage nudge. */
  readonly reviewQueueSize: number;
  /** UC3: days past due before a follow-up. */
  readonly overdueDays: number;
}

export const DEFAULT_TRIGGER_CONFIG: IHeartbeatTriggerConfig = {
  stallDays: 4,
  reviewQueueSize: 5,
  overdueDays: 1,
};

const DAY_MS = 86_400_000;
/** UC2 also requires the OLDEST captured task to have aged this long. */
const REVIEW_QUEUE_MIN_AGE_MS = 3 * DAY_MS;
const COOLDOWN_STALLED_PLAN_MS = 7 * DAY_MS;
const COOLDOWN_REVIEW_QUEUE_MS = 3 * DAY_MS;
const COOLDOWN_OVERDUE_TASK_MS = 3 * DAY_MS;
/** UC4: after notifying a failure, stay quiet this long even if it persists. */
const COOLDOWN_SYNC_FAILURE_MS = 6 * 3_600_000;
/** UC5: morning digest window [start, end) in local hours (Mufaro: morning). */
const MORNING_DIGEST_START_HOUR = 7;
const MORNING_DIGEST_END_HOUR = 9;
/** UC7: AGENTS.md unchanged this long + churn ⇒ suggest a /init refresh. */
const AGENTS_STALE_MS = 30 * DAY_MS;
const AGENTS_CHURN_THRESHOLD = 5;
const COOLDOWN_AGENTS_STALE_MS = 30 * DAY_MS;
/** Ledger entries older than this are pruned (bounds storage forever). */
const LEDGER_RETENTION_MS = 60 * DAY_MS;
/** Ledger key marking "sync is currently failing" (rising-edge state). */
const SYNC_FAILING_STATE_KEY = 'state:sync-failing';
/** Ledger key prefix recording when an AGENTS.md content hash was first seen. */
const AGENTS_SEEN_KEY_PREFIX = 'agents-seen:';

export interface ITriggerEvaluation {
  /** Findings due for delivery NOW (cooldowns already applied). */
  readonly findings: readonly IHeartbeatFinding[];
  /** Findings whose rule matched but whose key is inside its cooldown. */
  readonly suppressed: number;
  /**
   * Ledger with stale entries pruned — NOT yet stamped for the returned
   * findings. The lane stamps `ledger[key] = nowMs` only after a delivery
   * SUCCEEDS, so a failed delivery retries on the next beat.
   */
  readonly ledger: IHeartbeatLedger;
}

function fmtDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Evaluate all built-in rules. Pure: same inputs → same outputs. */
export function evaluateTriggers(
  facts: IHeartbeatFacts,
  ledger: IHeartbeatLedger,
  nowMs: number,
  config: IHeartbeatTriggerConfig = DEFAULT_TRIGGER_CONFIG,
): ITriggerEvaluation {
  const candidates: IHeartbeatFinding[] = [];

  // ── UC1: stalled plans ──
  for (const plan of facts.plans) {
    if (!plan.activeStep) continue;
    if (plan.updatedAt <= 0) continue; // unknown age — never nag on missing data
    if (nowMs - plan.updatedAt < config.stallDays * DAY_MS) continue;
    const staleDays = Math.floor((nowMs - plan.updatedAt) / DAY_MS);
    candidates.push({
      key: `stalled-plan:${plan.sessionId}`,
      kind: 'stalled-plan',
      title: `Plan stalled: ${plan.goal}`,
      detail: `Step "${plan.activeStep}" has been active for ${staleDays} days without an update. Continue it, or clear the plan if the work is done.`,
      delivery: 'task',
      cooldownMs: COOLDOWN_STALLED_PLAN_MS,
    });
  }

  // ── UC2: review-queue triage ──
  const reviewing = facts.tasks.filter((t) => t.status === 'reviewing');
  if (reviewing.length >= config.reviewQueueSize) {
    const oldest = reviewing.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    if (nowMs - oldest.createdAt >= REVIEW_QUEUE_MIN_AGE_MS) {
      candidates.push({
        key: 'review-queue',
        kind: 'review-queue',
        title: `${reviewing.length} captured tasks await review`,
        detail: `Oldest: "${oldest.title}" (captured ${fmtDay(oldest.createdAt)}). Triage them into planned/cancelled.`,
        delivery: 'notification',
        cooldownMs: COOLDOWN_REVIEW_QUEUE_MS,
      });
    }
  }

  // ── UC3: overdue follow-ups (the water-leak loop) ──
  for (const task of facts.tasks) {
    if (task.status !== 'planned') continue;
    if (task.dueAt === null || !Number.isFinite(task.dueAt)) continue;
    if (nowMs - task.dueAt < config.overdueDays * DAY_MS) continue;
    candidates.push({
      key: `overdue-task:${task.id}`,
      kind: 'overdue-task',
      title: `Follow up: ${task.title}`,
      detail: `Was due ${fmtDay(task.dueAt)} and is still open. Reschedule it, do it, or cancel it.`,
      delivery: 'task',
      cooldownMs: COOLDOWN_OVERDUE_TASK_MS,
    });
  }

  // ── Ledger maintenance (prune first — state rules below write into it) ──
  const findings: IHeartbeatFinding[] = [];
  let suppressed = 0;
  const nextLedger: IHeartbeatLedger = {};
  for (const [key, at] of Object.entries(ledger)) {
    if (typeof at === 'number' && nowMs - at < LEDGER_RETENTION_MS) nextLedger[key] = at;
  }

  // ── UC4: sync failure (rising edge) ──
  // The `state:sync-failing` ledger key marks an ongoing failure so a
  // persistent outage notifies once, and a recovery re-arms the edge.
  if (facts.sync != null) {
    if (facts.sync.failed) {
      const alreadyFailing = typeof nextLedger[SYNC_FAILING_STATE_KEY] === 'number';
      if (!alreadyFailing) {
        candidates.push({
          key: 'sync-failure',
          kind: 'sync-failure',
          title: 'Planner sync is failing',
          detail: facts.sync.detail?.trim() || 'The last sync run reported an error. Check Settings → Planner → Google sync.',
          delivery: 'notification',
          cooldownMs: COOLDOWN_SYNC_FAILURE_MS,
        });
      }
      nextLedger[SYNC_FAILING_STATE_KEY] = nextLedger[SYNC_FAILING_STATE_KEY] ?? nowMs;
    } else {
      delete nextLedger[SYNC_FAILING_STATE_KEY];
    }
  }

  // ── UC5: morning digest (once per local day, only on non-empty days) ──
  if (facts.today != null) {
    const local = new Date(nowMs);
    const hour = local.getHours();
    const p = (n: number): string => String(n).padStart(2, '0');
    const dayKey = `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}`;
    const busy = facts.today.events > 0 || facts.today.tasksDue > 0;
    if (busy && hour >= MORNING_DIGEST_START_HOUR && hour < MORNING_DIGEST_END_HOUR) {
      candidates.push({
        // The local date in the key makes "once per day" structural.
        key: `morning-digest:${dayKey}`,
        kind: 'morning-digest',
        title: `Today: ${facts.today.events} event${facts.today.events === 1 ? '' : 's'}, ${facts.today.tasksDue} task${facts.today.tasksDue === 1 ? '' : 's'} due`,
        detail: 'Open the planner for the full picture.',
        delivery: 'notification',
        cooldownMs: DAY_MS,
      });
    }
  }

  // ── UC7: AGENTS.md staleness ──
  // First sighting of a content hash stamps `agents-seen:<hash>`; when that
  // same hash is still current 30d later AND the workspace has churned,
  // suggest a /init refresh. A regenerated file = new hash = clock resets.
  // (Ledger pruning at 60d simply re-stamps an ancient hash — that only
  // DELAYS the next nudge, never spams.)
  if (facts.agentsMd != null && facts.agentsMd.hashPrefix) {
    const seenKey = `${AGENTS_SEEN_KEY_PREFIX}${facts.agentsMd.hashPrefix}`;
    const firstSeen = nextLedger[seenKey];
    if (typeof firstSeen !== 'number') {
      nextLedger[seenKey] = nowMs;
    } else if (
      nowMs - firstSeen >= AGENTS_STALE_MS
      && facts.agentsMd.recentPageUpdates >= AGENTS_CHURN_THRESHOLD
    ) {
      const weeks = Math.floor((nowMs - firstSeen) / (7 * DAY_MS));
      candidates.push({
        key: `agents-stale:${facts.agentsMd.hashPrefix}`,
        kind: 'agents-stale',
        title: `AGENTS.md hasn't changed in ${weeks} weeks`,
        detail: `${facts.agentsMd.recentPageUpdates} pages changed recently while AGENTS.md stayed frozen — run /init to refresh the workspace description.`,
        delivery: 'notification',
        cooldownMs: COOLDOWN_AGENTS_STALE_MS,
      });
    }
  }
  for (const f of candidates) {
    const last = nextLedger[f.key];
    if (typeof last === 'number' && nowMs - last < f.cooldownMs) {
      suppressed++;
      continue;
    }
    findings.push(f);
  }

  return { findings, suppressed, ledger: nextLedger };
}
