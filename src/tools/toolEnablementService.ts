// toolEnablementService.ts — persisted tool enable/disable state
//
// Manages which tools are enabled or disabled.
//
// Built-in tools are always enabled and cannot be toggled.
//
// External tools use **workspace-scoped activation**: they are only
// enabled in a workspace if the user has explicitly activated them
// there. The activated set is persisted to the workspace's filesystem
// at `<workspace>/.parallx/tool-activation.json` so it survives
// localStorage loss and does not bleed across workspaces.
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
 * - Built-in tools: always enabled, not toggleable.
 * - External tools: enabled only when explicitly activated in the
 *   current workspace.  The activated set is loaded from the
 *   workspace-local `tool-activation.json` file via `loadWorkspaceActivation()`.
 */
export class ToolEnablementService extends Disposable implements IToolEnablementService {

  /** Legacy set of disabled tool IDs (kept for potential back-compat). */
  private readonly _disabled = new Set<string>();

  /**
   * Set of external tool IDs that the user has explicitly activated
   * in the **current** workspace.  Tools not in this set are treated
   * as not-enabled (they show in the gallery but are not loaded).
   */
  private readonly _activatedInWorkspace = new Set<string>();

  /** Whether initial load from storage is complete. */
  // @ts-expect-error reserved for future guard
  private _loaded = false;

  /** Filesystem path to the current workspace folder (set by loadWorkspaceActivation). */
  private _workspaceFolderPath: string | undefined;

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
   * Load persisted disabled set from storage (legacy).
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

  /**
   * Load the workspace-scoped activation set from the filesystem.
   *
   * Reads `<folderPath>/.parallx/tool-activation.json`.
   * If the file does not exist this is a fresh workspace — no external
   * tools are activated.
   *
   * Must be called **after** `load()` and **before** external tool
   * discovery so that `isEnabled()` returns the correct value when
   * `_discoverAndRegisterExternalTools()` consults it.
   */
  async loadWorkspaceActivation(folderPath: string): Promise<void> {
    this._workspaceFolderPath = folderPath;

    const fs = (globalThis as any).parallxElectron?.fs;
    if (!fs) {
      console.warn('[ToolEnablementService] No FS bridge — workspace activation not loaded');
      return;
    }

    const sep = folderPath.includes('/') ? '/' : '\\';
    const filePath = folderPath + sep + '.parallx' + sep + 'tool-activation.json';

    try {
      const exists: boolean = await fs.exists(filePath);
      if (!exists) {
        console.log('[ToolEnablementService] No tool-activation.json — fresh workspace (no external tools activated)');
        return;
      }

      const result = await fs.readFile(filePath, 'utf-8');
      if (result?.content) {
        const data = JSON.parse(result.content);
        if (data && Array.isArray(data.activatedTools)) {
          for (const id of data.activatedTools) {
            if (typeof id === 'string' && id.length > 0) {
              this._activatedInWorkspace.add(id);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[ToolEnablementService] Failed to load workspace activation file:', err);
    }

    console.log(
      `[ToolEnablementService] Workspace activation: ${this._activatedInWorkspace.size} tool(s)`,
      this._activatedInWorkspace.size > 0 ? [...this._activatedInWorkspace] : '',
    );
  }

  // ── IToolEnablementService ──

  isEnabled(toolId: string): boolean {
    // Legacy explicit disable always wins
    if (this._disabled.has(toolId)) return false;

    const entry = this._registry.getById(toolId);

    // Built-in tools are always enabled
    if (entry?.description.isBuiltin) return true;

    // External tools: enabled ONLY if activated in this workspace
    if (entry && !entry.description.isBuiltin) {
      return this._activatedInWorkspace.has(toolId);
    }

    // Unknown tool (not yet registered) — safe default: not enabled
    // This prevents surprise activation of tools discovered during scanning
    return false;
  }

  getEnablementState(toolId: string): ToolEnablementState {
    return this.isEnabled(toolId)
      ? ToolEnablementState.EnabledGlobally
      : ToolEnablementState.DisabledGlobally;
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

    const entry = this._registry.getById(toolId);

    if (entry && !entry.description.isBuiltin) {
      // ── External tool: workspace-scoped activation ──
      if (enabled) {
        this._activatedInWorkspace.add(toolId);
      } else {
        this._activatedInWorkspace.delete(toolId);
      }
      // Persist workspace activation to filesystem
      await this._persistWorkspaceActivation();
    } else {
      // ── Legacy path (should rarely hit for external tools) ──
      if (enabled) {
        this._disabled.delete(toolId);
      } else {
        this._disabled.add(toolId);
      }
      await this._persist();
    }

    // Determine new state
    const newState = enabled
      ? ToolEnablementState.EnabledGlobally
      : ToolEnablementState.DisabledGlobally;

    console.log(`[ToolEnablementService] Tool "${toolId}" → ${newState}`);

    // Fire event
    this._onDidChangeEnablement.fire({ toolId, newState });
  }

  // ── Workspace Activation Queries ──

  /**
   * Get the set of tool IDs activated in the current workspace.
   */
  getWorkspaceActivatedToolIds(): ReadonlySet<string> {
    return this._activatedInWorkspace;
  }

  /**
   * Check whether a tool is activated in the current workspace.
   */
  isActivatedInWorkspace(toolId: string): boolean {
    return this._activatedInWorkspace.has(toolId);
  }

  // ── Internal ──

  /**
   * Persist the legacy disabled set to storage.
   */
  private async _persist(): Promise<void> {
    try {
      const data = JSON.stringify([...this._disabled]);
      await this._storage.set(STORAGE_KEY, data);
    } catch (err) {
      console.error('[ToolEnablementService] Failed to persist disabled set:', err);
    }
  }

  /**
   * Persist the workspace activation set to the filesystem.
   *
   * Writes `<folderPath>/.parallx/tool-activation.json` with the
   * current set of activated tool IDs.
   */
  private async _persistWorkspaceActivation(): Promise<void> {
    if (!this._workspaceFolderPath) {
      console.warn('[ToolEnablementService] No workspace folder path — cannot persist activation');
      return;
    }

    const fs = (globalThis as any).parallxElectron?.fs;
    if (!fs) return;

    const sep = this._workspaceFolderPath.includes('/') ? '/' : '\\';
    const dirPath = this._workspaceFolderPath + sep + '.parallx';
    const filePath = dirPath + sep + 'tool-activation.json';

    try {
      // Ensure .parallx directory exists
      const dirExists: boolean = await fs.exists(dirPath);
      if (!dirExists) {
        await fs.mkdir(dirPath);
      }

      const payload = JSON.stringify(
        { version: 1, activatedTools: [...this._activatedInWorkspace] },
        null,
        2,
      );
      await fs.writeFile(filePath, payload, 'utf-8');
    } catch (err) {
      console.error('[ToolEnablementService] Failed to persist workspace activation:', err);
    }
  }
}
