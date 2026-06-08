// peerTransport.ts — the Commons transport abstraction (Build-11).
//
// The protocol is deliberately transport-agnostic. Today we prove it with an
// in-process LoopbackBus (two nodes in one process exchanging artifacts) — the
// honest "ARPANET first packet" that validates the governance end to end without
// a network. The REAL transport (encrypted, local-first/CRDT, peer-to-peer over
// the wire) implements this same IPeerTransport interface and drops in behind it.
// Nothing above this line knows or cares which transport is in use.

import type { IFederatedArtifact } from './federatedArtifact.js';

export interface IPeerTransport {
  /** Send an artifact to connected peers. */
  broadcast(artifact: IFederatedArtifact): void;
  /** Subscribe to artifacts received from peers. Returns an unsubscribe. */
  onReceive(handler: (artifact: IFederatedArtifact) => void): () => void;
}

/** An in-process bus that wires LoopbackTransports together (test/dev only). */
export class LoopbackBus {
  private readonly _peers = new Set<LoopbackTransport>();
  connect(t: LoopbackTransport): void { this._peers.add(t); }
  disconnect(t: LoopbackTransport): void { this._peers.delete(t); }
  /** Deliver to every peer except the sender (a broadcast, not an echo). */
  deliver(from: LoopbackTransport, artifact: IFederatedArtifact): void {
    for (const p of this._peers) if (p !== from) p.receive(artifact);
  }
}

export class LoopbackTransport implements IPeerTransport {
  private readonly _handlers = new Set<(a: IFederatedArtifact) => void>();
  constructor(private readonly _bus: LoopbackBus) { _bus.connect(this); }
  broadcast(artifact: IFederatedArtifact): void { this._bus.deliver(this, artifact); }
  onReceive(handler: (a: IFederatedArtifact) => void): () => void {
    this._handlers.add(handler);
    return () => this._handlers.delete(handler);
  }
  /** @internal — called by the bus to deliver an inbound artifact. */
  receive(artifact: IFederatedArtifact): void {
    for (const h of this._handlers) h(artifact);
  }
}
