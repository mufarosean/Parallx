// heartbeatDeterministicLane.ts — M87 S1: collect facts → evaluate triggers →
// deliver findings. Runs on every interval beat BEFORE (and independent of)
// the LLM lane and its idle gate: this lane costs no tokens, needs no chat
// session, and its deliveries are review-queue tasks / notifications — never
// chat turns. A quiet workspace where tasks silently rot overdue gets checked
// every beat even when no workspace events fired.
//
// Everything here is fail-soft: a broken sense, storage, or delivery channel
// degrades to "no delivery this beat" and must never break the heartbeat.

import {
  evaluateTriggers,
  DEFAULT_TRIGGER_CONFIG,
  type IHeartbeatFacts,
  type IHeartbeatFinding,
  type IHeartbeatLedger,
  type IHeartbeatTriggerConfig,
} from './heartbeatTriggers.js';

export interface IHeartbeatLaneDeps {
  /** Collect the beat's facts (planner tasks + session plans). */
  readonly collectFacts: () => Promise<IHeartbeatFacts>;
  /** Cooldown ledger persistence (survives restarts). */
  readonly loadLedger: () => Promise<IHeartbeatLedger>;
  readonly saveLedger: (ledger: IHeartbeatLedger) => Promise<void>;
  /** Deliver a follow-up-shaped finding into the planner review queue.
   *  Returns true when a task was created (false = duplicate already open). */
  readonly deliverTask: (finding: IHeartbeatFinding) => Promise<boolean>;
  /** Deliver an alert/digest-shaped finding as an in-app notification. */
  readonly deliverNotification: (finding: IHeartbeatFinding) => Promise<boolean>;
  /** Mirror every delivered finding to the autonomy log (audit). */
  readonly log?: (finding: IHeartbeatFinding) => void;
  readonly getConfig?: () => IHeartbeatTriggerConfig;
  readonly now?: () => number;
}

export interface IHeartbeatLaneResult {
  readonly delivered: number;
  readonly suppressed: number;
  readonly failed: number;
}

export async function runHeartbeatDeterministicLane(
  deps: IHeartbeatLaneDeps,
): Promise<IHeartbeatLaneResult> {
  const nowMs = deps.now?.() ?? Date.now();

  let facts: IHeartbeatFacts;
  try {
    facts = await deps.collectFacts();
  } catch (err) {
    console.warn('[HeartbeatLane] fact collection failed:', err);
    return { delivered: 0, suppressed: 0, failed: 0 };
  }

  let ledger: IHeartbeatLedger;
  try {
    ledger = await deps.loadLedger();
  } catch {
    ledger = {};
  }

  let config = DEFAULT_TRIGGER_CONFIG;
  try {
    config = deps.getConfig?.() ?? DEFAULT_TRIGGER_CONFIG;
  } catch { /* keep defaults */ }

  const evaluation = evaluateTriggers(facts, ledger, nowMs, config);

  let delivered = 0;
  let failed = 0;
  const nextLedger: IHeartbeatLedger = { ...evaluation.ledger };

  for (const finding of evaluation.findings) {
    let ok = false;
    try {
      ok = finding.delivery === 'task'
        ? await deps.deliverTask(finding)
        : await deps.deliverNotification(finding);
    } catch (err) {
      console.warn(`[HeartbeatLane] delivery failed for ${finding.key}:`, err);
      failed++;
      continue; // key NOT stamped — retries next beat
    }
    // Stamp even when the channel reports "already exists" (ok === false for
    // a duplicate open task): the finding is present where the user looks,
    // so re-delivering on every beat would be nagging.
    nextLedger[finding.key] = nowMs;
    if (ok) {
      delivered++;
      try { deps.log?.(finding); } catch { /* audit is best-effort */ }
    }
  }

  try {
    await deps.saveLedger(nextLedger);
  } catch (err) {
    console.warn('[HeartbeatLane] ledger save failed:', err);
  }

  return { delivered, suppressed: evaluation.suppressed, failed };
}
