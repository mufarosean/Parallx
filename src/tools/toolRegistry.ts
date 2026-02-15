// toolRegistry.ts — central registry for discovered and activated tools
//
// The registry is the single source of truth for all loaded tools.
// It holds validated tool descriptions, tracks their lifecycle state,
// and fires events when registrations or state transitions occur.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { IToolDescription } from './toolManifest.js';

// ─── Tool State ──────────────────────────────────────────────────────────────

/**
 * Lifecycle states a tool can be in.
 * Transitions are validated — see `_validateTransition`.
 */
export enum ToolState {
  Discovered = 'discovered',
  Registered = 'registered',
  Activating = 'activating',
  Activated = 'activated',
  Deactivating = 'deactivating',
  Deactivated = 'deactivated',
  Disposed = 'disposed',
}

/** Valid state transitions. */
const VALID_TRANSITIONS: ReadonlyMap<ToolState, readonly ToolState[]> = new Map([
  [ToolState.Discovered, [ToolState.Registered, ToolState.Disposed]],
  [ToolState.Registered, [ToolState.Activating, ToolState.Disposed]],
  [ToolState.Activating, [ToolState.Activated, ToolState.Deactivated, ToolState.Disposed]],
  [ToolState.Activated, [ToolState.Deactivating, ToolState.Disposed]],
  [ToolState.Deactivating, [ToolState.Deactivated, ToolState.Disposed]],
  [ToolState.Deactivated, [ToolState.Activating, ToolState.Disposed]],
  [ToolState.Disposed, []],
]);

// ─── Tool Entry ──────────────────────────────────────────────────────────────

/** Internal entry for a registered tool. */
export interface IToolEntry {
  /** Validated tool description (manifest + metadata). */
  readonly description: IToolDescription;
  /** Current lifecycle state. */
  readonly state: ToolState;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface ToolRegisteredEvent {
  readonly toolId: string;
  readonly description: IToolDescription;
}

export interface ToolStateChangedEvent {
  readonly toolId: string;
  readonly previousState: ToolState;
  readonly newState: ToolState;
}

// ─── Contribution point name constants ───────────────────────────────────────

export type ContributionPoint =
  | 'views'
  | 'viewContainers'
  | 'commands'
  | 'configuration'
  | 'menus'
  | 'keybindings';

// ─── Tool Registry ───────────────────────────────────────────────────────────

/**
 * Central registry for all validated tool descriptions.
 *
 * Responsibilities:
 * - Store validated tool descriptions
 * - Track tool lifecycle state
 * - Reject duplicate tool IDs
 * - Validate state transitions
 * - Provide query API (getAll, getById, getByState, getContributorsOf)
 * - Fire events on registration and state changes
 *
 * This is a singleton service registered in the DI container.
 */
export class ToolRegistry extends Disposable {

  // ── Storage ──
  private readonly _entries = new Map<string, { description: IToolDescription; state: ToolState }>();

  // ── Events ──
  private readonly _onDidRegisterTool = new Emitter<ToolRegisteredEvent>();
  readonly onDidRegisterTool: Event<ToolRegisteredEvent> = this._onDidRegisterTool.event;

  private readonly _onDidChangeToolState = new Emitter<ToolStateChangedEvent>();
  readonly onDidChangeToolState: Event<ToolStateChangedEvent> = this._onDidChangeToolState.event;

  constructor() {
    super();
    this._register(this._onDidRegisterTool);
    this._register(this._onDidChangeToolState);
  }

  // ── Registration ──

  /**
   * Register a validated tool description.
   * The tool starts in the `Registered` state.
   * @throws if a tool with the same ID is already registered.
   */
  register(description: IToolDescription): void {
    const id = description.manifest.id;

    if (this._entries.has(id)) {
      throw new Error(`[ToolRegistry] Duplicate tool ID: "${id}". A tool with this ID is already registered.`);
    }

    this._entries.set(id, { description, state: ToolState.Registered });

    this._onDidRegisterTool.fire({ toolId: id, description });
    console.log(`[ToolRegistry] Registered tool: ${id} (${description.manifest.name} v${description.manifest.version})`);
  }

  // ── State Transitions ──

  /**
   * Transition a tool to a new state.
   * Validates the transition is legal.
   * @throws if the transition is invalid or the tool is not found.
   */
  setToolState(toolId: string, newState: ToolState): void {
    const entry = this._entries.get(toolId);
    if (!entry) {
      throw new Error(`[ToolRegistry] Tool not found: "${toolId}"`);
    }

    const previousState = entry.state;
    this._validateTransition(toolId, previousState, newState);

    entry.state = newState;

    this._onDidChangeToolState.fire({ toolId, previousState, newState });
    console.log(`[ToolRegistry] Tool "${toolId}" state: ${previousState} → ${newState}`);
  }

  private _validateTransition(toolId: string, from: ToolState, to: ToolState): void {
    const allowed = VALID_TRANSITIONS.get(from);
    if (!allowed || !allowed.includes(to)) {
      throw new Error(
        `[ToolRegistry] Invalid state transition for "${toolId}": ${from} → ${to}. ` +
        `Allowed transitions from ${from}: [${(allowed ?? []).join(', ')}]`,
      );
    }
  }

  // ── Queries ──

  /**
   * Get all registered tool entries.
   */
  getAll(): readonly IToolEntry[] {
    return [...this._entries.values()].map(e => ({
      description: e.description,
      state: e.state,
    }));
  }

  /**
   * Get a tool entry by its manifest ID.
   * Returns `undefined` if not found.
   */
  getById(toolId: string): IToolEntry | undefined {
    const entry = this._entries.get(toolId);
    if (!entry) return undefined;
    return { description: entry.description, state: entry.state };
  }

  /**
   * Get all tools in a specific lifecycle state.
   */
  getByState(state: ToolState): readonly IToolEntry[] {
    return [...this._entries.values()]
      .filter(e => e.state === state)
      .map(e => ({ description: e.description, state: e.state }));
  }

  /**
   * Get all tools that contribute to a specific contribution point.
   * E.g. `getContributorsOf('views')` returns tools that declare views.
   */
  getContributorsOf(point: ContributionPoint): readonly IToolEntry[] {
    return [...this._entries.values()]
      .filter(e => {
        const contrib = e.description.manifest.contributes;
        if (!contrib) return false;
        const val = contrib[point];
        // Arrays (commands, views, viewContainers, etc.)
        if (Array.isArray(val) && val.length > 0) return true;
        // Record types (menus) — check for non-empty object
        if (val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length > 0) return true;
        return false;
      })
      .map(e => ({ description: e.description, state: e.state }));
  }

  /**
   * The total number of registered tools.
   */
  get count(): number {
    return this._entries.size;
  }

  /**
   * Check if a tool with the given ID is registered.
   */
  has(toolId: string): boolean {
    return this._entries.has(toolId);
  }

  // ── Disposal ──

  /**
   * Remove a tool from the registry.
   * Transitions the tool to `Disposed` if it isn't already.
   */
  unregister(toolId: string): void {
    const entry = this._entries.get(toolId);
    if (!entry) return;

    if (entry.state !== ToolState.Disposed) {
      // Force transition through disposal
      this.setToolState(toolId, ToolState.Disposed);
    }
    this._entries.delete(toolId);
  }

  override dispose(): void {
    // Dispose all remaining tool entries
    for (const [, entry] of this._entries) {
      if (entry.state !== ToolState.Disposed) {
        entry.state = ToolState.Disposed;
      }
    }
    this._entries.clear();

    super.dispose();
  }
}
