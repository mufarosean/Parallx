// commonsNode.ts — a sovereign node in the Commons (Build-11).
//
// Ties the sovereignty firewall (what may leave) to a transport (how it travels)
// and a reputation ledger (whom to trust). The governance that makes federation
// safe lives here:
//
//   • CONTRIBUTE goes through the firewall — only generic, non-personal patterns
//     ever reach the wire.
//   • INBOUND artifacts from an untrusted origin are QUARANTINED, never applied.
//     The human approves them, which both accepts the artifact and earns that
//     origin trust. Trust is LOCAL and human-gated — each node decides whom it
//     trusts — which sidesteps the unsolved global Sybil-resistance problem (there
//     is no central authority to attack, and no stranger is ever auto-trusted).
//   • Accepted patterns are advisory knowledge, never executable code — so an
//     imported artifact can never run anything (the supply-chain attack is moot).
//
// Pure orchestration; deterministic with injected clock/id. The wire transport is
// the one piece still ahead — everything else (privacy, governance, exchange) is
// real and proven peer-to-peer in-process.

import { makeArtifact, type IFederatedArtifact, type IShareReview } from './federatedArtifact.js';
import type { IPeerTransport } from './peerTransport.js';

/** Per-origin trust, decided locally by this node (+ its human). */
export class ReputationLedger {
  private _rep = new Map<string, number>();
  scoreOf(originId: string): number { return this._rep.get(originId) ?? 0; }
  bump(originId: string, by = 1): void { this._rep.set(originId, this.scoreOf(originId) + by); }
  toState(): [string, number][] { return [...this._rep.entries()]; }
  restore(state: [string, number][] | undefined): void {
    if (Array.isArray(state)) this._rep = new Map(state.filter(e => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number'));
  }
}

export interface ICommonsNodeOptions {
  /** Reputation at/above which an origin's artifacts are auto-accepted. Default 1. */
  readonly trustThreshold?: number;
  readonly now?: () => number;
  readonly genId?: () => string;
}

export type ContributeResult = { artifact: IFederatedArtifact } | { rejected: IShareReview };

export class CommonsNode {
  private readonly _quarantine = new Map<string, IFederatedArtifact>();
  private readonly _accepted = new Map<string, IFederatedArtifact>();
  private readonly _rep = new ReputationLedger();
  private readonly _trustThreshold: number;
  private readonly _now: () => number;
  private readonly _genId: () => string;

  constructor(
    readonly originId: string,
    private readonly _transport: IPeerTransport,
    opts: ICommonsNodeOptions = {},
  ) {
    this._trustThreshold = opts.trustThreshold ?? 1;
    this._now = opts.now ?? Date.now;
    this._genId = opts.genId ?? (() => `${originId}-${Math.random().toString(36).slice(2, 10)}`);
    this._transport.onReceive((a) => this._onReceive(a));
  }

  /** Share a generic pattern. Goes through the firewall; only allowed if generic. */
  contribute(content: string): ContributeResult {
    const out = makeArtifact(content, this.originId, this._now(), this._genId);
    if ('rejected' in out) return out;
    this._transport.broadcast(out.artifact);
    return out;
  }

  private _onReceive(a: IFederatedArtifact): void {
    if (a.originId === this.originId) return;                 // ignore our own echo
    if (this._accepted.has(a.id) || this._quarantine.has(a.id)) return; // dedup
    if (this._rep.scoreOf(a.originId) >= this._trustThreshold) {
      this._accepted.set(a.id, a);                            // trusted origin → accept
    } else {
      this._quarantine.set(a.id, a);                          // stranger → quarantine, NEVER auto-apply
    }
  }

  /** The human accepts a quarantined artifact — and the origin earns trust. */
  approve(artifactId: string): boolean {
    const a = this._quarantine.get(artifactId);
    if (!a) return false;
    this._quarantine.delete(artifactId);
    this._accepted.set(artifactId, a);
    this._rep.bump(a.originId, 1);
    return true;
  }

  /** The human rejects a quarantined artifact (no trust earned). */
  reject(artifactId: string): boolean {
    return this._quarantine.delete(artifactId);
  }

  quarantined(): IFederatedArtifact[] { return [...this._quarantine.values()]; }
  accepted(): IFederatedArtifact[] { return [...this._accepted.values()]; }
  reputationOf(originId: string): number { return this._rep.scoreOf(originId); }
}
