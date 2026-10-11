// keybindingContribution.ts — contributes.keybindings processor
//
// Processes the `contributes.keybindings` section from tool manifests.
// Maintains a keybinding map from normalized key combos to command IDs.
// Listens for global keyboard events and dispatches matching commands.
//
// M2 scope: basic keybinding map with single-key combos (no chords).
// Full keybinding resolution system with chords and contexts deferred.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IToolDescription } from '../tools/toolManifest.js';
import type { IContributedKeybinding, IContributionProcessor } from './contributionTypes.js';
import { normalizeKeybinding, reservedKeyOwner } from '../services/keybindingUtils.js';

/** Minimal shape of KeybindingService to avoid circular imports (M3 Capability 0.3). */
interface IKeybindingServiceLike {
  registerKeybinding(key: string, commandId: string, when?: string, source?: string): import('../platform/lifecycle.js').IDisposable;
  removeKeybindingsBySource(source: string): void;
}

// ─── KeybindingContributionProcessor ─────────────────────────────────────────

/**
 * Processes `contributes.keybindings` from tool manifests and provides
 * a global keyboard event listener that dispatches matching commands.
 */
export class KeybindingContributionProcessor extends Disposable implements IContributionProcessor {

  /** All contributed keybindings, keyed by normalized key string. */
  private readonly _keybindings = new Map<string, IContributedKeybinding[]>();

  /** Keybindings per tool for cleanup. */
  private readonly _toolKeybindings = new Map<string, IContributedKeybinding[]>();

  /**
   * The centralized KeybindingService — the ONE dispatcher (M3 Capability
   * 0.3; the processor's own legacy listener was deleted by Retirement
   * Part 3.2). This class is now purely a manifest→service forwarder that
   * keeps per-tool bookkeeping for clean removal.
   */
  private _keybindingService: IKeybindingServiceLike | undefined;

  // ── Events ──

  private readonly _onDidProcessKeybindings = this._register(new Emitter<{ toolId: string; keybindings: readonly IContributedKeybinding[] }>());
  readonly onDidProcessKeybindings: Event<{ toolId: string; keybindings: readonly IContributedKeybinding[] }> = this._onDidProcessKeybindings.event;

  private readonly _onDidRemoveKeybindings = this._register(new Emitter<{ toolId: string }>());
  readonly onDidRemoveKeybindings: Event<{ toolId: string }> = this._onDidRemoveKeybindings.event;

  /**
   * Set the centralized KeybindingService. Contributions processed before
   * this arrives are replayed through it.
   */
  setKeybindingService(service: IKeybindingServiceLike): void {
    this._keybindingService = service;

    // Re-register all existing tool keybindings through the centralized service
    for (const [toolId, keybindings] of this._toolKeybindings) {
      for (const kb of keybindings) {
        this._keybindingService.registerKeybinding(kb.key, kb.commandId, kb.when, `tool:${toolId}`);
      }
    }
  }

  // ── IContributionProcessor ──

  /**
   * Process a tool's `contributes.keybindings`.
   */
  processContributions(toolDescription: IToolDescription): void {
    const { manifest } = toolDescription;
    const keybindings = manifest.contributes?.keybindings;
    if (!keybindings || keybindings.length === 0) return;

    const toolId = manifest.id;
    const contributedList: IContributedKeybinding[] = [];

    for (const kb of keybindings) {
      if (!kb.command || !kb.key) {
        console.warn(`[KeybindingContribution] Invalid keybinding in tool "${toolId}": missing command or key`);
        continue;
      }

      const normalizedKey = normalizeKeybinding(kb.key);

      // Reserved-key guard — a contribution may not point a reserved key at a
      // command other than its canonical owner.
      const reservedOwner = reservedKeyOwner(normalizedKey);
      if (reservedOwner && reservedOwner !== kb.command) {
        console.warn(
          `[KeybindingContribution] Ignoring "${kb.key}" from tool "${toolId}" → "${kb.command}": ` +
          `that key is reserved for "${reservedOwner}".`,
        );
        continue;
      }

      const contributed: IContributedKeybinding = {
        commandId: kb.command,
        toolId,
        key: kb.key,
        normalizedKey,
        when: kb.when,
      };

      // Check for conflicts
      const existing = this._keybindings.get(normalizedKey);
      if (existing && existing.length > 0) {
        const conflictCmd = existing[existing.length - 1].commandId;
        console.warn(
          `[KeybindingContribution] Keybinding conflict: "${kb.key}" (${normalizedKey}) ` +
          `from tool "${toolId}" → "${kb.command}" overrides existing binding for "${conflictCmd}"`,
        );
      }

      // Add to keybinding map (last-registered wins for conflicts)
      const bindings = this._keybindings.get(normalizedKey) ?? [];
      bindings.push(contributed);
      this._keybindings.set(normalizedKey, bindings);

      contributedList.push(contributed);
    }

    // Store per-tool for cleanup
    const existingToolKb = this._toolKeybindings.get(toolId) ?? [];
    this._toolKeybindings.set(toolId, [...existingToolKb, ...contributedList]);

    if (contributedList.length > 0) {
      this._onDidProcessKeybindings.fire({ toolId, keybindings: contributedList });
      console.log(
        `[KeybindingContribution] Registered ${contributedList.length} keybinding(s) from tool "${toolId}":`,
        contributedList.map(k => `${k.key} → ${k.commandId}`).join(', '),
      );

      // If centralized KeybindingService is available, register through it
      if (this._keybindingService) {
        for (const kb of contributedList) {
          this._keybindingService.registerKeybinding(kb.key, kb.commandId, kb.when, `tool:${toolId}`);
        }
      }
    }

  }

  /**
   * Remove all keybindings from a tool.
   */
  removeContributions(toolId: string): void {
    const toolKb = this._toolKeybindings.get(toolId);
    if (!toolKb || toolKb.length === 0) return;

    // Remove from centralized KeybindingService if available
    if (this._keybindingService) {
      this._keybindingService.removeKeybindingsBySource(`tool:${toolId}`);
    }

    for (const kb of toolKb) {
      const bindings = this._keybindings.get(kb.normalizedKey);
      if (bindings) {
        const filtered = bindings.filter(b => b.toolId !== toolId);
        if (filtered.length > 0) {
          this._keybindings.set(kb.normalizedKey, filtered);
        } else {
          this._keybindings.delete(kb.normalizedKey);
        }
      }
    }

    this._toolKeybindings.delete(toolId);
    this._onDidRemoveKeybindings.fire({ toolId });
    console.log(`[KeybindingContribution] Removed keybindings from tool "${toolId}"`);
  }

  // ── Queries ──

  /**
   * Get the keybinding for a command (the most recently registered one).
   */
  getKeybindingForCommand(commandId: string): IContributedKeybinding | undefined {
    for (const bindings of this._keybindings.values()) {
      for (let i = bindings.length - 1; i >= 0; i--) {
        if (bindings[i].commandId === commandId) return bindings[i];
      }
    }
    return undefined;
  }

  /**
   * Get all contributed keybindings.
   */
  getAllKeybindings(): readonly IContributedKeybinding[] {
    const all: IContributedKeybinding[] = [];
    for (const bindings of this._keybindings.values()) {
      all.push(...bindings);
    }
    return all;
  }

  // ── Disposal ──
  // (The legacy global keydown dispatcher — _installGlobalListener and
  // _isEditableTarget — was deleted by the Retirement phase, Part 3.2.
  // KeybindingService has owned dispatch since M3; the legacy listener was
  // removed synchronously at boot and unreachable in production, kept alive
  // only by this class's constructor installing it for a zero-tick window.)

  override dispose(): void {
    this._keybindings.clear();
    this._toolKeybindings.clear();
    super.dispose();
  }
}
