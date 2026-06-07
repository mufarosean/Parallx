// mindStore.ts — durable persistence for the agent's MIND (continuity, Build-1b).
//
// The pure model (agentMindModel.ts) is in-memory and stateless by design. This
// is the thin durable wrapper that lets the MIND survive across heartbeat ticks
// and app restarts — the difference between an amnesiac reflex and an agent that
// remembers what it was thinking.
//
// Persistence is workspace-scoped key/value storage (the MIND is per-workspace
// agent state, not global), serialized as one JSON document. The whole model is
// small (compacted to ≤200 entries), so a single load/save is simpler and more
// robust than per-entry SQL — and it keeps this module trivially testable
// against an in-memory IStorage fake. Loads are validated: a corrupt or partial
// document degrades to an empty MIND rather than crashing the loop.

import type { IStorage } from '../../platform/storage.js';
import {
  compact,
  type IMindEntry,
  type ICompactOptions,
} from './agentMindModel.js';

const MIND_STORAGE_KEY = 'autonomy.mind.v1';

/** Validate a parsed entry just enough to trust it in the loop. */
function isValidEntry(v: unknown): v is IMindEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    (e.kind === 'belief' || e.kind === 'thread' || e.kind === 'prediction') &&
    typeof e.content === 'string' &&
    typeof e.confidence === 'number' &&
    Array.isArray(e.provenance) &&
    typeof e.createdMs === 'number' &&
    typeof e.updatedMs === 'number' &&
    typeof e.halfLifeMs === 'number'
  );
}

export interface IMindStore {
  /** Load the persisted MIND (validated; never throws). */
  load(): Promise<IMindEntry[]>;
  /** Persist the MIND, compacting first so the document can't grow unbounded. */
  save(entries: readonly IMindEntry[], nowMs: number, opts?: ICompactOptions): Promise<void>;
}

export class MindStore implements IMindStore {
  constructor(
    private readonly _storage: IStorage,
    private readonly _key: string = MIND_STORAGE_KEY,
  ) {}

  async load(): Promise<IMindEntry[]> {
    let raw: string | undefined;
    try {
      raw = await this._storage.get(this._key);
    } catch {
      return [];
    }
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidEntry);
    } catch {
      return []; // corrupt document → empty MIND, never crash the loop
    }
  }

  async save(entries: readonly IMindEntry[], nowMs: number, opts?: ICompactOptions): Promise<void> {
    // Forgetting is enforced at the persistence boundary so the stored document
    // can never grow without bound, even if a caller forgets to compact.
    const { kept } = compact(entries, nowMs, opts);
    await this._storage.set(this._key, JSON.stringify(kept));
  }
}
