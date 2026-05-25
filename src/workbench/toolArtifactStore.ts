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
  /** Delete an artifact. Returns `true` if it existed. */
  delete(toolId: string, artifactId: string): boolean;
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

  delete(toolId: string, artifactId: string): boolean {
    const key = InMemoryToolArtifactStore._key(toolId, artifactId);
    const existed = this._records.delete(key);
    if (existed) {
      this._onDidChange.fire({ toolId, artifactId, kind: 'delete' });
    }
    return existed;
  }

  get size(): number {
    return this._records.size;
  }

  override dispose(): void {
    this._records.clear();
    super.dispose();
  }
}
