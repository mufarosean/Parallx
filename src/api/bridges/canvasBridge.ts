// canvasBridge.ts — bridges parallx.canvas to ICanvasBlockTypeRegistry (M82 Slice A)
//
// The extension's `activate()` calls `api.canvas.registerBlockType(definition)`
// with the full Tiptap `BlockDefinition` (including the `extension(context)`
// factory). The bridge has two paths:
//
//   1. Manifest-declared: if `definition.id` matches a stub registered from
//      `contributes.canvas.blockTypes[]`, calls
//      `wireRealDefinition(id, definition)` on the contribution processor,
//      which registers it with the runtime registry. Disposing the
//      bridge-returned disposable unwires the real registration (the manifest
//      stub remains until the tool itself is removed).
//
//   2. Imperative-only: if no stub exists, calls
//      `ICanvasBlockTypeRegistry.register(definition)` directly and returns
//      its disposable.
//
// Pattern mirrors `ChatBridge.registerParticipant` (M82 Slice B).

import { toDisposable } from '../../platform/lifecycle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { BlockDefinition } from '../../built-in/canvas/config/blockRegistry.js';
import type { ICanvasBlockTypeRegistry } from '../../services/canvasBlockTypeRegistry.js';
import type { ICanvasBlockTypeContributionService } from '../../services/serviceTypes.js';

export class CanvasBridge {
  private readonly _registrations: IDisposable[] = [];
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _registry: ICanvasBlockTypeRegistry,
    private readonly _subscriptions: IDisposable[],
    /** Optional — present only when manifest-declared block types may exist. */
    private readonly _blockTypeContribution?: ICanvasBlockTypeContributionService,
  ) {
    // _toolId is captured for future attribution / observability; not used at
    // runtime today because the registry returns its own disposable.
    void this._toolId;
  }

  /**
   * Register a canvas block type with the runtime registry.
   * Returns a disposable that removes the registration.
   */
  registerBlockType(definition: BlockDefinition): IDisposable {
    this._throwIfDisposed();
    if (!definition?.id || typeof definition.id !== 'string') {
      throw new Error('[CanvasBridge.registerBlockType] definition.id is required');
    }
    if (!definition.name || typeof definition.name !== 'string') {
      throw new Error(`[CanvasBridge.registerBlockType] definition.name is required (id=${definition.id})`);
    }

    // Path 1: manifest-declared stub exists.
    if (this._blockTypeContribution?.hasContributed(definition.id)) {
      const wired = this._blockTypeContribution.wireRealDefinition(definition.id, definition);
      if (wired) {
        const disposable = toDisposable(() => {
          // Drop the runtime registration owned by the processor.
          this._blockTypeContribution?.unwireRealDefinition(definition.id);
        });
        this._registrations.push(disposable);
        this._subscriptions.push(disposable);
        return disposable;
      }
    }

    // Path 2: imperative-only.
    const reg = this._registry.register(definition);
    this._registrations.push(reg);
    this._subscriptions.push(reg);
    return reg;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const r of this._registrations) {
      try { r.dispose(); } catch { /* swallow */ }
    }
    this._registrations.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error('[CanvasBridge] bridge has been disposed');
    }
  }
}
