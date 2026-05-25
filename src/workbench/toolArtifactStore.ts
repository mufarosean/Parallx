// toolArtifactStore.ts — In-memory store for tool-produced artifacts (Slice A10)
//
// Workbench-owned canonical store for `ToolArtifactResource` payloads. Tools
// (extensions, web research, agents) write artifacts here; consumers read
// them by `(toolId, artifactId)` via the same store interface that the
// `ToolArtifactResourceResolver` consumes.
//
// Scope: in-memory only for now. Persistence (per-workspace, per-session,
// or per-conversation) is a separate concern handled by future slices —
// the in-memory store gives an immediate concrete home for artifacts and
// makes `resolveUri('parallx://tool-artifact:...')` work end-to-end.
//
// Pure-additive: no existing code reads from this. Wired into
// IResourceRegistry as the source for the tool-artifact resolver.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

export interface ToolArtifactRecord {
  readonly toolId: string;
  readonly artifactId: string;
  readonly mimeType?: string;
  readonly data: unknown;
  readonly createdAt: number;
  readonly workspaceId?: string;
}

export interface IToolArtifactStore {
  /** Store an artifact. Overwrites any existing entry with the same `(toolId, artifactId)`. */
  put(record: ToolArtifactRecord): void;
  /** Retrieve an artifact, or `undefined` if not stored. */
  get(toolId: string, artifactId: string): ToolArtifactRecord | undefined;
  /**
   * `true` iff an artifact is stored at `(toolId, artifactId)`. Guard
   * counterpart to `get` for callers that only need existence.
   */
  has(toolId: string, artifactId: string): boolean;
  /** Delete an artifact. Returns `true` if it existed. */
  delete(toolId: string, artifactId: string): boolean;
  /**
   * Delete every artifact owned by `toolId`. Returns the number of
   * records removed. Fires `onDidChange` once per removed record
   * (in insertion order).
   */
  deleteByTool(toolId: string): number;
  /**
   * Delete every artifact whose `workspaceId === workspaceId`. Returns
   * the number of records removed. Fires `onDidChange` once per removed
   * record (in insertion order). Records with no `workspaceId` are
   * never matched. Empty/undefined `workspaceId` returns 0 with no
   * events.
   */
  deleteByWorkspace(workspaceId: string): number;
  /**
   * Snapshot listing of stored artifacts. With no argument, returns every
   * record. With a `toolId` argument, returns only records owned by that
   * tool. Insertion order is preserved. The returned array is a fresh
   * snapshot and is not affected by subsequent mutations.
   */
  list(toolId?: string): readonly ToolArtifactRecord[];
  /**
   * Return the first stored record for which `predicate` returns truthy,
   * or `undefined` if none match. Iteration is in insertion order. The
   * predicate is invoked at most once per record and must not mutate the
   * store.
   */
  find(predicate: (record: ToolArtifactRecord) => boolean): ToolArtifactRecord | undefined;
  /**
   * Return every stored record for which `predicate` returns truthy.
   * Insertion order preserved. Returns a fresh snapshot array. The
   * predicate must not mutate the store.
   */
  filter(predicate: (record: ToolArtifactRecord) => boolean): readonly ToolArtifactRecord[];
  /**
   * Delete every stored artifact. Returns the number removed. Fires
   * `onDidChange` once per record (insertion order, `kind: 'delete'`),
   * so existing subscribers see each removal exactly as if `delete()`
   * had been called for it. Empty store → 0 with no events. Idempotent.
   *
   * Designed for workspace switches and test teardown.
   */
  clear(): number;
  /** Number of stored artifacts. */
  readonly size: number;
  /** Fires whenever an artifact is added, replaced, or deleted. */
  readonly onDidChange: Event<{ readonly toolId: string; readonly artifactId: string; readonly kind: 'put' | 'delete' }>;
}

export class InMemoryToolArtifactStore extends Disposable implements IToolArtifactStore {
  private readonly _records = new Map<string, ToolArtifactRecord>();
  private readonly _onDidChange = this._register(
    new Emitter<{ readonly toolId: string; readonly artifactId: string; readonly kind: 'put' | 'delete' }>(),
  );
  readonly onDidChange = this._onDidChange.event;

  private static _key(toolId: string, artifactId: string): string {
    return `${toolId}\u0000${artifactId}`;
  }

  put(record: ToolArtifactRecord): void {
    if (this.isDisposed) return;
    if (!record.toolId || !record.artifactId) {
      throw new Error('[InMemoryToolArtifactStore] toolId and artifactId are required');
    }
    this._records.set(InMemoryToolArtifactStore._key(record.toolId, record.artifactId), record);
    this._onDidChange.fire({ toolId: record.toolId, artifactId: record.artifactId, kind: 'put' });
  }

  get(toolId: string, artifactId: string): ToolArtifactRecord | undefined {
    return this._records.get(InMemoryToolArtifactStore._key(toolId, artifactId));
  }

  has(toolId: string, artifactId: string): boolean {
    return this._records.has(InMemoryToolArtifactStore._key(toolId, artifactId));
  }

  delete(toolId: string, artifactId: string): boolean {
    const key = InMemoryToolArtifactStore._key(toolId, artifactId);
    const existed = this._records.delete(key);
    if (existed) {
      this._onDidChange.fire({ toolId, artifactId, kind: 'delete' });
    }
    return existed;
  }

  deleteByTool(toolId: string): number {
    if (!toolId) return 0;
    // Collect first so we don't mutate the map during iteration in a way
    // that depends on the runtime's deletion semantics.
    const victims: string[] = [];
    for (const [key, rec] of this._records) {
      if (rec.toolId === toolId) victims.push(key);
    }
    for (const key of victims) {
      const rec = this._records.get(key);
      if (!rec) continue;
      this._records.delete(key);
      this._onDidChange.fire({ toolId: rec.toolId, artifactId: rec.artifactId, kind: 'delete' });
    }
    return victims.length;
  }

  deleteByWorkspace(workspaceId: string): number {
    if (!workspaceId) return 0;
    const victims: string[] = [];
    for (const [key, rec] of this._records) {
      if (rec.workspaceId === workspaceId) victims.push(key);
    }
    for (const key of victims) {
      const rec = this._records.get(key);
      if (!rec) continue;
      this._records.delete(key);
      this._onDidChange.fire({ toolId: rec.toolId, artifactId: rec.artifactId, kind: 'delete' });
    }
    return victims.length;
  }

  get size(): number {
    return this._records.size;
  }

  list(toolId?: string): readonly ToolArtifactRecord[] {
    if (toolId === undefined) {
      return Array.from(this._records.values());
    }
    const out: ToolArtifactRecord[] = [];
    for (const r of this._records.values()) {
      if (r.toolId === toolId) out.push(r);
    }
    return out;
  }

  find(predicate: (record: ToolArtifactRecord) => boolean): ToolArtifactRecord | undefined {
    for (const r of this._records.values()) {
      if (predicate(r)) return r;
    }
    return undefined;
  }

  filter(predicate: (record: ToolArtifactRecord) => boolean): readonly ToolArtifactRecord[] {
    const out: ToolArtifactRecord[] = [];
    for (const r of this._records.values()) {
      if (predicate(r)) out.push(r);
    }
    return out;
  }

  clear(): number {
    if (this._records.size === 0) return 0;
    const victims = Array.from(this._records.values());
    this._records.clear();
    for (const rec of victims) {
      this._onDidChange.fire({ toolId: rec.toolId, artifactId: rec.artifactId, kind: 'delete' });
    }
    return victims.length;
  }

  override dispose(): void {
    this._records.clear();
    super.dispose();
  }
}
