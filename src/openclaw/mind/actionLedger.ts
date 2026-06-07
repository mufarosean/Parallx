// actionLedger.ts — the tamper-evident, append-only record of what the agent
// ACTUALLY did (the S3* audit channel; Build-1c).
//
// The most dangerous failure of an autonomous loop is not error — it is
// CONFABULATION: a system that narrates "I reviewed X and acted" convincingly
// while its behaviour never changed, with a self-graded dashboard that always
// trends up. The only defense is to make "what it did" auditable INDEPENDENTLY
// of "what it says it did." The ledger is that ground truth.
//
// It is a hash chain: each record carries the hash of the previous record, so
// any after-the-fact edit, reorder, or deletion of an interior record breaks the
// chain and is detectable (`verifyChain`). The hash is a fast non-crypto digest
// (FNV-1a) — adequate for tamper-EVIDENCE against accidental/casual corruption;
// swapping in a cryptographic digest is a localized hardening.
//
// Pure chain ops (deterministic, clock + hash injected) so the tamper-evidence
// is unit-tested; the persisted store is a thin wrapper.

import type { IStorage } from '../../platform/storage.js';

export type AgentActionKind =
  | 'review'              // a heartbeat review ran
  | 'note'               // surfaced a NOTE to the autonomy log
  | 'act'                // took a delivered ACT
  | 'tool-call'          // invoked a tool
  | 'belief-update'      // wrote to the MIND
  | 'prediction'         // recorded a falsifiable prediction
  | 'prediction-resolved'// graded a prediction against observed reality
  | 'deferred'           // held off (back-pressure / budget)
  | 'noop'               // reviewed, nothing warranted action
  | 'error';

export interface IAgentActionInput {
  readonly kind: AgentActionKind;
  readonly summary: string;
  readonly detail?: string;
  /** Where it came from, e.g. "heartbeat:interval", "heartbeat:wake". */
  readonly origin: string;
  /** Whether the action can be undone (Invariant: reversible-by-default). */
  readonly reversible?: boolean;
}

export interface IAgentActionRecord extends IAgentActionInput {
  readonly seq: number;
  readonly ts: number;
  readonly prevHash: string;
  readonly hash: string;
}

export const GENESIS_HASH = 'genesis';

/** FNV-1a 32-bit, hex. Fast, deterministic, dependency-free. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The canonical, order-stable payload a record's hash covers. */
function payload(seq: number, ts: number, a: IAgentActionInput): string {
  return JSON.stringify({
    seq, ts, kind: a.kind, summary: a.summary,
    detail: a.detail ?? '', origin: a.origin, reversible: a.reversible ?? false,
  });
}

/** Append one action, chaining its hash to the prior record. Pure. */
export function appendAction(
  chain: readonly IAgentActionRecord[],
  input: IAgentActionInput,
  ts: number,
  hashFn: (s: string) => string = fnv1a,
): readonly IAgentActionRecord[] {
  const prev = chain[chain.length - 1];
  const seq = (prev?.seq ?? -1) + 1;
  const prevHash = prev?.hash ?? GENESIS_HASH;
  const p = payload(seq, ts, input);
  const hash = hashFn(prevHash + p);
  return [...chain, {
    kind: input.kind,
    summary: input.summary,
    detail: input.detail,
    origin: input.origin,
    reversible: input.reversible ?? false,
    seq, ts, prevHash, hash,
  }];
}

/**
 * Verify chain integrity over the retained window: each record's hash recomputes
 * from (prevHash + payload), each links to the previous record's hash, and seq is
 * strictly +1. Does NOT require the first record to be genesis (the window is
 * capped), so it detects tampering of any RETAINED record. Pure.
 */
export function verifyChain(
  chain: readonly IAgentActionRecord[],
  hashFn: (s: string) => string = fnv1a,
): { readonly ok: boolean; readonly brokenAt?: number } {
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (i > 0) {
      if (r.prevHash !== chain[i - 1].hash) return { ok: false, brokenAt: i };
      if (r.seq !== chain[i - 1].seq + 1) return { ok: false, brokenAt: i };
    }
    if (hashFn(r.prevHash + payload(r.seq, r.ts, r)) !== r.hash) return { ok: false, brokenAt: i };
  }
  return { ok: true };
}

// ─── Durable, capped ledger ──────────────────────────────────────────────────

const LEDGER_KEY = 'autonomy.ledger.v1';
const DEFAULT_MAX_RECORDS = 1000;

export class ActionLedger {
  constructor(
    private readonly _storage: IStorage,
    private readonly _maxRecords: number = DEFAULT_MAX_RECORDS,
    private readonly _key: string = LEDGER_KEY,
  ) {}

  async load(): Promise<IAgentActionRecord[]> {
    let raw: string | undefined;
    try { raw = await this._storage.get(this._key); } catch { return []; }
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as IAgentActionRecord[]) : [];
    } catch { return []; }
  }

  /** Append an action and persist. Returns the new record. Caps the retained
   *  window (oldest dropped); the chain stays internally verifiable. */
  async append(input: IAgentActionInput, ts: number): Promise<IAgentActionRecord> {
    const chain = appendAction(await this.load(), input, ts);
    const capped = chain.length > this._maxRecords ? chain.slice(chain.length - this._maxRecords) : chain;
    await this._storage.set(this._key, JSON.stringify(capped));
    return capped[capped.length - 1];
  }

  /** Audit: is the retained ledger intact? */
  async verify(): Promise<{ ok: boolean; brokenAt?: number }> {
    return verifyChain(await this.load());
  }
}
