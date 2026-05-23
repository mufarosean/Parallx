// canvasBlockTypeRegistry.ts — runtime registry for contributed canvas block types (M82 Slice A)
//
// In-memory map of `BlockDefinition` entries contributed by extensions through
// `api.canvas.registerBlockType(definition)`. The canvas editor queries this
// registry at editor construction time and threads the resulting definitions'
// `.extension(context)` factories into the Tiptap extension list — in addition
// to the built-in `BLOCK_REGISTRY` which remains canonical and untouched.
//
// Conflict policy (M82 audit §Q1):
//   - Reject any id already in the built-in `BLOCK_REGISTRY`.
//   - Reject any id already contributed by another extension.
//
// Lifecycle:
//   - Registration returns an `IDisposable` that removes the entry.
//   - Removing the entry fires `onDidChange` so editor instances can rebuild if desired.
//   - The editor today snapshots at construction; live rebuild is a future option.
//
// Schema migration: none. Block types are runtime registrations, not rows.
// Workspace pages containing block ids that are not currently registered fall
// back to Tiptap's unknown-node placeholder — same behaviour as today when a
// built-in block is renamed/removed.

import { Disposable, toDisposable, type IDisposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import type { BlockDefinition } from '../built-in/canvas/config/blockRegistry.js';
import { BLOCK_REGISTRY } from '../built-in/canvas/config/blockRegistry.js';

export interface ICanvasBlockTypeRegistry {
  /**
   * Register a contributed block type. Throws if `definition.id` conflicts
   * with a built-in id or another contributed id.
   */
  register(definition: BlockDefinition): IDisposable;
  /** Snapshot of all contributed block definitions, in registration order. */
  getAll(): readonly BlockDefinition[];
  /** True if `id` is currently contributed (does NOT check built-ins). */
  has(id: string): boolean;
  /** Fires whenever a contribution is added or removed. */
  readonly onDidChange: Event<void>;
}

export class CanvasBlockTypeRegistry extends Disposable implements ICanvasBlockTypeRegistry {

  private readonly _contributed = new Map<string, BlockDefinition>();
  private readonly _builtInIds: ReadonlySet<string>;

  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor() {
    super();
    // Snapshot built-in ids once at construction. Built-ins are static at
    // process start so a snapshot is sufficient for conflict detection.
    this._builtInIds = new Set(BLOCK_REGISTRY.keys());
  }

  register(definition: BlockDefinition): IDisposable {
    if (this.isDisposed) {
      return toDisposable(() => undefined);
    }
    if (!definition?.id || typeof definition.id !== 'string') {
      throw new Error('CanvasBlockTypeRegistry.register: definition.id is required');
    }
    if (!definition.name || typeof definition.name !== 'string') {
      throw new Error(`CanvasBlockTypeRegistry.register: definition.name is required (id=${definition.id})`);
    }
    if (this._builtInIds.has(definition.id)) {
      throw new Error(
        `CanvasBlockTypeRegistry.register: id "${definition.id}" is a built-in block — choose a different id`,
      );
    }
    if (this._contributed.has(definition.id)) {
      throw new Error(
        `CanvasBlockTypeRegistry.register: id "${definition.id}" is already contributed`,
      );
    }

    this._contributed.set(definition.id, definition);
    this._onDidChange.fire();

    return toDisposable(() => {
      const existing = this._contributed.get(definition.id);
      if (existing === definition) {
        this._contributed.delete(definition.id);
        this._onDidChange.fire();
      }
    });
  }

  getAll(): readonly BlockDefinition[] {
    return [...this._contributed.values()];
  }

  has(id: string): boolean {
    return this._contributed.has(id);
  }
}
