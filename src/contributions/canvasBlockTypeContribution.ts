// canvasBlockTypeContribution.ts — contributes.canvas.blockTypes processor (M82 Slice A)
//
// Processes `contributes.canvas.blockTypes[]` from tool manifests.
//
// The manifest entry is *metadata-only*: id, name, label, icon, kind. The
// actual Tiptap `BlockDefinition` (which includes the `extension(context)`
// factory and any insert-action JS) must be wired imperatively from the
// contributing extension's `activate()` via
// `api.canvas.registerBlockType(fullDefinition)`. The canvas bridge looks up
// the manifest stub by id and calls `wireRealDefinition(id, def)` to swap the
// real definition in place; on success, the registry registration is the
// canonical runtime entry that the Tiptap editor reads from.
//
// Pattern mirrors `ChatParticipantContributionProcessor` (M82 Slice B).
//
// Conflict policy (M82 audit §Q1):
//   - Reject any id already in the built-in `BLOCK_REGISTRY`.
//   - Reject any id already contributed by another manifest entry.
//
// See `docs/Parallx_Milestone_82.md` §10 Slice A and
// `docs/research/M82_CONTRIBUTION_AUDIT.md` Q1.

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import type { IToolDescription, IManifestCanvasBlockType } from '../tools/toolManifest.js';
import type { BlockDefinition } from '../built-in/canvas/config/blockRegistry.js';
import { BLOCK_REGISTRY } from '../built-in/canvas/config/blockRegistry.js';
import type { ICanvasBlockTypeRegistry } from '../services/canvasBlockTypeRegistry.js';
import type { IContributionProcessor } from './contributionTypes.js';

interface IContributedBlockType {
  readonly blockTypeId: string;
  readonly toolId: string;
  readonly manifest: IManifestCanvasBlockType;
  /** Real registration into the runtime registry, populated when the bridge calls wireRealDefinition. */
  realRegistration: IDisposable | undefined;
}

export class CanvasBlockTypeContributionProcessor extends Disposable implements IContributionProcessor {

  private readonly _contributed = new Map<string, IContributedBlockType>();

  private readonly _onDidRegisterBlockType = this._register(new Emitter<{ toolId: string; blockTypeId: string }>());
  readonly onDidRegisterBlockType: Event<{ toolId: string; blockTypeId: string }> = this._onDidRegisterBlockType.event;

  private readonly _onDidRemoveBlockType = this._register(new Emitter<{ toolId: string; blockTypeId: string }>());
  readonly onDidRemoveBlockType: Event<{ toolId: string; blockTypeId: string }> = this._onDidRemoveBlockType.event;

  constructor(private readonly _registry: ICanvasBlockTypeRegistry) {
    super();
  }

  // ── IContributionProcessor ──

  processContributions(toolDescription: IToolDescription): void {
    if (this.isDisposed) return;
    const { manifest } = toolDescription;
    const blockTypes = manifest.contributes?.canvas?.blockTypes;
    if (!blockTypes || blockTypes.length === 0) return;

    const toolId = manifest.id;
    for (const def of blockTypes) {
      if (!def?.id || !def?.name) {
        console.warn(
          `[CanvasBlockTypeContribution] Skipping invalid block type in tool "${toolId}":`,
          'missing required field "id" or "name"',
        );
        continue;
      }

      if (BLOCK_REGISTRY.has(def.id)) {
        console.warn(
          `[CanvasBlockTypeContribution] Block type "${def.id}" is a built-in — skipping registration from "${toolId}"`,
        );
        continue;
      }
      if (this._contributed.has(def.id)) {
        const owner = this._contributed.get(def.id);
        console.warn(
          `[CanvasBlockTypeContribution] Block type "${def.id}" already contributed by`,
          `"${owner?.toolId}" — skipping registration from "${toolId}"`,
        );
        continue;
      }

      this._contributed.set(def.id, {
        blockTypeId: def.id,
        toolId,
        manifest: def,
        realRegistration: undefined,
      });
      this._onDidRegisterBlockType.fire({ toolId, blockTypeId: def.id });
      console.log(`[CanvasBlockTypeContribution] reserved ${def.id} from ${toolId} (awaiting api.canvas.registerBlockType)`);
    }
  }

  removeContributions(toolId: string): void {
    if (this.isDisposed) return;
    const removed: string[] = [];
    for (const [id, record] of this._contributed) {
      if (record.toolId !== toolId) continue;
      if (record.realRegistration) {
        try { record.realRegistration.dispose(); }
        catch (err) {
          console.error(
            `[CanvasBlockTypeContribution] dispose failed for "${id}" from "${toolId}":`,
            err,
          );
        }
      }
      this._contributed.delete(id);
      this._onDidRemoveBlockType.fire({ toolId, blockTypeId: id });
      removed.push(id);
    }
    if (removed.length > 0) {
      console.log(
        `[CanvasBlockTypeContribution] removed ${removed.length} block type(s) from ${toolId}:`,
        removed.join(', '),
      );
    }
  }

  // ── Real-definition wiring ──

  /**
   * Called by the canvas bridge when an extension provides the full Tiptap
   * `BlockDefinition` for a block type declared in its manifest. Performs
   * the runtime-registry registration and stashes the disposable so
   * `removeContributions(toolId)` can revert it later.
   *
   * Returns true if a matching manifest stub was found and the real
   * definition was registered; false if no manifest stub exists for
   * `blockTypeId`, in which case the caller should fall back to direct
   * `ICanvasBlockTypeRegistry.register` (the imperative-only path).
   *
   * Throws if registration fails (e.g. id conflict).
   */
  wireRealDefinition(blockTypeId: string, definition: BlockDefinition): boolean {
    const record = this._contributed.get(blockTypeId);
    if (!record) return false;
    if (record.realRegistration) {
      // Re-wiring: dispose the previous registration first so the registry
      // accepts the new one without an id-conflict throw.
      try { record.realRegistration.dispose(); } catch { /* swallow */ }
      record.realRegistration = undefined;
    }
    record.realRegistration = this._registry.register(definition);
    return true;
  }

  /**
   * Drop the runtime registration previously installed by `wireRealDefinition`.
   * The manifest stub itself remains — only the runtime entry is removed.
   * No-op if no real definition is currently wired.
   */
  unwireRealDefinition(blockTypeId: string): void {
    const record = this._contributed.get(blockTypeId);
    if (!record?.realRegistration) return;
    try { record.realRegistration.dispose(); } catch { /* swallow */ }
    record.realRegistration = undefined;
  }

  /** True if `blockTypeId` was declared in some manifest. */
  hasContributed(blockTypeId: string): boolean {
    return this._contributed.has(blockTypeId);
  }

  /** Owning tool id for a contributed block type, or undefined. */
  getOwnerToolId(blockTypeId: string): string | undefined {
    return this._contributed.get(blockTypeId)?.toolId;
  }

  /** Enumerate all contributed block-type ids. Test/debugging only. */
  getContributedIds(): readonly string[] {
    return [...this._contributed.keys()];
  }
}
