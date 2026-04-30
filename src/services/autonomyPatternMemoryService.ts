// autonomyPatternMemoryService.ts — M60 Phase ζ §8 T5.E3
//
// "Approve this pattern" memory for sub-agent spawn approvals.
//
// When the user explicitly remembers a sub-agent spawn approval, the
// pattern is recorded here and consulted on subsequent spawn attempts.
// Matching patterns auto-approve (skipping the approval gate) until the
// user revokes them.
//
// Pattern shape (lossy — never stores raw args):
//   { toolName, parentSessionPattern, argsShapeHash, approvedAt, label? }
//
// Storage:
//   `<APP_ROOT>/data/autonomy-patterns.json` via the renderer fs bridge,
//   one JSON file per workspace (the bridge resolves to the active
//   workspace data dir). Falls back to in-memory only when no fs bridge
//   is available (tests).
//
// Privacy (§3.9): the args are reduced to a sorted list of keys
// (`{a:1,b:'x'}` → `'a,b'`) before hashing. No values are stored.
//
// Out of scope for ζ: cron pattern memory (cron jobs are user-defined
// already; approval is implicit at create time). Focus is sub-agent.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IAutonomyPatternKey {
  /** Tool name that initiated the approval (e.g. `sessions_spawn`). */
  readonly toolName: string;
  /**
   * Parent session id pattern. Today: the literal session id. Future:
   * could be a glob ("workspace:*"). Stored verbatim because session ids
   * are local and contain no PII.
   */
  readonly parentSessionPattern: string;
  /**
   * Stable digest of the argument *shape* — sorted top-level keys joined
   * with commas. Values are never included.
   */
  readonly argsShape: string;
}

export interface IAutonomyApprovedPattern extends IAutonomyPatternKey {
  /** Stable id (hash of the key tuple). */
  readonly id: string;
  /** Optional human-readable label. */
  readonly label?: string;
  /** ISO timestamp when the pattern was first remembered. */
  readonly approvedAt: string;
  /** Number of times this pattern has matched a spawn since approval. */
  readonly matchCount: number;
  /** ISO timestamp of the last match. */
  readonly lastMatchedAt?: string;
}

export interface IAutonomyPatternMemoryFs {
  readFile(path: string, encoding?: string): Promise<{ ok: boolean; data?: string; error?: string }>;
  writeFile(path: string, content: string, encoding?: string): Promise<{ ok: boolean; error?: string }>;
  exists(path: string): Promise<{ ok: boolean; exists?: boolean; error?: string }>;
  mkdir(path: string): Promise<{ ok: boolean; error?: string }>;
}

export interface IAutonomyPatternMemoryOptions {
  readonly dataDir: string;
  readonly fs?: IAutonomyPatternMemoryFs;
  readonly now?: () => number;
}

export interface IAutonomyPatternMemoryService {
  /** Lookup whether a spawn matching this key has a remembered approval. */
  isApproved(key: IAutonomyPatternKey): boolean;
  /** Record a pattern. Idempotent — re-remembering an existing pattern is a no-op apart from updating `matchCount=0` reset. */
  remember(key: IAutonomyPatternKey, label?: string): Promise<IAutonomyApprovedPattern>;
  /** Bump match counter and timestamp. Returns the updated record (or undefined when no match). */
  noteMatch(key: IAutonomyPatternKey): Promise<IAutonomyApprovedPattern | undefined>;
  /** Revoke a remembered pattern by id. Returns true when it existed. */
  revoke(id: string): Promise<boolean>;
  /** Drop all remembered patterns. */
  clear(): Promise<void>;
  /** Snapshot of all remembered patterns (newest-first). */
  list(): readonly IAutonomyApprovedPattern[];
  /** Fired on any mutation (remember/match/revoke/clear). */
  readonly onDidChange: Event<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FILE_NAME = 'autonomy-patterns.json';

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/**
 * Reduce a value to a stable shape signature. Args are usually shallow
 * objects ({task, label, model, …}); we hash the sorted list of top-level
 * keys. Arrays collapse to `array(len)`. Primitives collapse to their type.
 */
export function computeArgsShape(args: unknown): string {
  if (args === null || args === undefined) return 'null';
  if (Array.isArray(args)) return `array(${args.length})`;
  if (typeof args !== 'object') return typeof args;
  const keys = Object.keys(args as Record<string, unknown>).sort();
  return keys.join(',');
}

/**
 * Stable id for a pattern key. Non-cryptographic, fine for storage keys.
 */
export function patternKeyId(key: IAutonomyPatternKey): string {
  const raw = `${key.toolName}|${key.parentSessionPattern}|${key.argsShape}`;
  // FNV-1a 32-bit, then base36 — cheap, stable, no PII.
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `pat-${hash.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AutonomyPatternMemoryService extends Disposable implements IAutonomyPatternMemoryService {
  private readonly _dataDir: string;
  private readonly _fs: IAutonomyPatternMemoryFs | undefined;
  private readonly _now: () => number;
  private readonly _patterns = new Map<string, IAutonomyApprovedPattern>();
  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;
  private _saveChain: Promise<void> = Promise.resolve();
  private _initialized = false;

  constructor(options: IAutonomyPatternMemoryOptions) {
    super();
    this._dataDir = options.dataDir;
    this._fs = options.fs;
    this._now = options.now ?? (() => Date.now());
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
    if (!this._fs) return;
    try {
      const file = joinPath(this._dataDir, FILE_NAME);
      const exists = await this._fs.exists(file);
      if (!exists.ok || !exists.exists) return;
      const read = await this._fs.readFile(file, 'utf-8');
      if (!read.ok || typeof read.data !== 'string') return;
      const parsed = JSON.parse(read.data) as { patterns?: IAutonomyApprovedPattern[] };
      if (!parsed || !Array.isArray(parsed.patterns)) return;
      for (const p of parsed.patterns) {
        if (!p || typeof p.id !== 'string') continue;
        this._patterns.set(p.id, p);
      }
    } catch {
      // Corrupt file — fall back to empty memory.
    }
  }

  isApproved(key: IAutonomyPatternKey): boolean {
    return this._patterns.has(patternKeyId(key));
  }

  async remember(key: IAutonomyPatternKey, label?: string): Promise<IAutonomyApprovedPattern> {
    const id = patternKeyId(key);
    const existing = this._patterns.get(id);
    if (existing) return existing;
    const record: IAutonomyApprovedPattern = {
      id,
      toolName: key.toolName,
      parentSessionPattern: key.parentSessionPattern,
      argsShape: key.argsShape,
      label,
      approvedAt: new Date(this._now()).toISOString(),
      matchCount: 0,
    };
    this._patterns.set(id, record);
    await this._scheduleSave();
    this._onDidChange.fire();
    return record;
  }

  async noteMatch(key: IAutonomyPatternKey): Promise<IAutonomyApprovedPattern | undefined> {
    const id = patternKeyId(key);
    const existing = this._patterns.get(id);
    if (!existing) return undefined;
    const updated: IAutonomyApprovedPattern = {
      ...existing,
      matchCount: existing.matchCount + 1,
      lastMatchedAt: new Date(this._now()).toISOString(),
    };
    this._patterns.set(id, updated);
    await this._scheduleSave();
    this._onDidChange.fire();
    return updated;
  }

  async revoke(id: string): Promise<boolean> {
    const removed = this._patterns.delete(id);
    if (!removed) return false;
    await this._scheduleSave();
    this._onDidChange.fire();
    return true;
  }

  async clear(): Promise<void> {
    if (this._patterns.size === 0) return;
    this._patterns.clear();
    await this._scheduleSave();
    this._onDidChange.fire();
  }

  list(): readonly IAutonomyApprovedPattern[] {
    return [...this._patterns.values()].sort(
      (a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''),
    );
  }

  /** Flush pending writes — exposed for tests. */
  flush(): Promise<void> {
    return this._saveChain;
  }

  private async _scheduleSave(): Promise<void> {
    if (!this._fs) return;
    this._saveChain = this._saveChain.then(() => this._save());
    return this._saveChain;
  }

  private async _save(): Promise<void> {
    if (!this._fs) return;
    try {
      await this._fs.mkdir(this._dataDir);
    } catch {
      // mkdir may already exist.
    }
    const file = joinPath(this._dataDir, FILE_NAME);
    const payload = JSON.stringify({ patterns: [...this._patterns.values()] }, null, 2);
    try {
      await this._fs.writeFile(file, payload, 'utf-8');
    } catch {
      // Persistence failure is non-fatal — runtime memory remains truth.
    }
  }
}
