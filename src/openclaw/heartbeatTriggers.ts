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

export type HeartbeatFindingKind = 'stalled-plan' | 'review-queue' | 'overdue-task';

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
/** Ledger entries older than this are pruned (bounds storage forever). */
const LEDGER_RETENTION_MS = 60 * DAY_MS;

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

  // ── Cooldowns + ledger maintenance ──
  const findings: IHeartbeatFinding[] = [];
  let suppressed = 0;
  const nextLedger: IHeartbeatLedger = {};
  for (const [key, at] of Object.entries(ledger)) {
    if (typeof at === 'number' && nowMs - at < LEDGER_RETENTION_MS) nextLedger[key] = at;
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
