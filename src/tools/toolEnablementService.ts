// toolEnablementService.ts — persisted tool enable/disable state
//
// Manages which tools are enabled or disabled. Persists the set of
// disabled tool IDs to workspace-scoped storage under the key
// `tool-enablement:disabled` as a JSON array.
//
// Built-in tools cannot be disabled — `canChangeEnablement()` returns
// `false` for any tool where `description.isBuiltin === true`.
//
// VS Code reference:
//   src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';
import type { ToolRegistry } from './toolRegistry.js';
import {
  ToolEnablementState,
  type IToolEnablementService,
  type ToolEnablementChangeEvent,
} from './toolEnablement.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Storage key for the persisted set of disabled tool IDs. */
const STORAGE_KEY = 'tool-enablement:disabled';

// ─── ToolEnablementService ───────────────────────────────────────────────────

/**
 * Concrete implementation of `IToolEnablementService`.
 *
 * Stores disabled tool IDs in workspace-scoped `IStorage` as a JSON
 * array of strings. All tools default to enabled — only disabled IDs
 * are persisted.
 */
export class ToolEnablementService extends Disposable implements IToolEnablementService {

  /** The set of tool IDs that are currently disabled. */
  private readonly _disabled = new Set<string>();

  /** Whether initial load from storage is complete. */
  // @ts-expect-error reserved for future guard
  private _loaded = false;

  // ── Events ──

  private readonly _onDidChangeEnablement = this._register(new Emitter<ToolEnablementChangeEvent>());
  readonly onDidChangeEnablement: Event<ToolEnablementChangeEvent> = this._onDidChangeEnablement.event;

  constructor(
    private readonly _storage: IStorage,
    private readonly _registry: ToolRegistry,
  ) {
    super();
  }

  // ── Initialization ──

  /**
   * Load persisted disabled set from storage.
   * Must be called once before first use. Handles missing or corrupt data
   * gracefully by falling back to an empty set (all tools enabled).
   */
  async load(): Promise<void> {
    try {
      const raw = await this._storage.get(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string' && id.length > 0) {
              this._disabled.add(id);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[ToolEnablementService] Failed to load persisted state — defaulting to all enabled:', err);
    }
    this._loaded = true;
    console.log(
      `[ToolEnablementService] Loaded: ${this._disabled.size} disabled tool(s)`,
      this._disabled.size > 0 ? [...this._disabled] : '',
    );
  }

  // ── IToolEnablementService ──

  isEnabled(toolId: string): boolean {
    return !this._disabled.has(toolId);
  }

  getEnablementState(toolId: string): ToolEnablementState {
    return this._disabled.has(toolId)
      ? ToolEnablementState.DisabledGlobally
      : ToolEnablementState.EnabledGlobally;
  }

  canChangeEnablement(toolId: string): boolean {
    const entry = this._registry.getById(toolId);
    if (!entry) return false;
    // Built-in tools are always enabled and cannot be toggled
    return !entry.description.isBuiltin;
  }

  getDisabledToolIds(): ReadonlySet<string> {
    return this._disabled;
  }

  async setEnablement(toolId: string, enabled: boolean): Promise<void> {
    // Validate
    if (!this.canChangeEnablement(toolId)) {
      throw new Error(
        `[ToolEnablementService] Cannot change enablement for tool "${toolId}" ` +
        `(built-in or not registered).`,
      );
    }

    const currentlyEnabled = this.isEnabled(toolId);
    if (currentlyEnabled === enabled) {
      return; // No change needed
    }

    // Update in-memory set
    if (enabled) {
      this._disabled.delete(toolId);
    } else {
      this._disabled.add(toolId);
    }

    // Persist to storage
    await this._persist();

    // Determine new state
    const newState = enabled
      ? ToolEnablementState.EnabledGlobally
      : ToolEnablementState.DisabledGlobally;

    console.log(`[ToolEnablementService] Tool "${toolId}" → ${newState}`);

    // Fire event
    this._onDidChangeEnablement.fire({ toolId, newState });
  }

  // ── Internal ──

  /**
   * Persist the current disabled set to storage.
   */
  private async _persist(): Promise<void> {
    try {
      const data = JSON.stringify([...this._disabled]);
      await this._storage.set(STORAGE_KEY, data);
    } catch (err) {
      console.error('[ToolEnablementService] Failed to persist disabled set:', err);
    }
  }
}
