// autonomyFeatureFlags.ts — M60 Phase α §3.8 feature flag registry
//
// Live-toggleable boolean flags that gate autonomy entry points. Defaults
// per M60 §3.8. Overrides persist in IStorage (global) so toggles survive
// restart. T4 (settings UI) will adopt this registry; until then, the
// service is constructed with defaults and overrides are read from
// global storage at init time.
//
// Why a separate service from AISettingsService:
//   - AISettingsService is profile-based (presets, persona, prompts). Its
//     shape doesn't fit a flat flag-id → boolean map.
//   - Flags need to be queried on hot paths (every followup eval, every
//     surface route) — a tight, allocation-free getter is preferable.
//   - Independent ownership: T4 will register a settings page that reads
//     this service; flags ship before the UI does.
//
// Upstream parity: none — controls layer is Parallx-specific by design
// (M60 §3.8). Upstream openclaw runs as a server, gating happens through
// per-channel config there.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';

// ---------------------------------------------------------------------------
// Flag IDs (the "schema")
// ---------------------------------------------------------------------------

export const FLAG_FOLLOWUP_ENABLED = 'autonomy.followup.enabled';
export const FLAG_SURFACE_CHAT_ENABLED = 'autonomy.surface.chat.enabled';
export const FLAG_SURFACE_NOTIFICATION_ENABLED = 'autonomy.surface.notification.enabled';
export const FLAG_SURFACE_STATUSBAR_ENABLED = 'autonomy.surface.statusbar.enabled';
export const FLAG_SURFACE_CANVAS_ENABLED = 'autonomy.surface.canvas.enabled';
export const FLAG_SURFACE_FILESYSTEM_ENABLED = 'autonomy.surface.filesystem.enabled';
// M60 Phase γ §3.8 — autonomy substrate (heartbeat/cron/subagent).
// All three default OFF until proven via dogfood + autonomy eval, per M60 §3.8.
export const FLAG_HEARTBEAT_ENABLED = 'autonomy.heartbeat.enabled';
export const FLAG_CRON_ENABLED = 'autonomy.cron.enabled';
export const FLAG_SUBAGENT_ENABLED = 'autonomy.subagent.enabled';
// M60 Phase δ §3.8 — canvas depth.
// blockIds default ON: TipTap's `extension-unique-id` is already wired
// in src/built-in/canvas/config/tiptapExtensions.ts (UNIQUE_ID_BLOCK_TYPES);
// the flag exists for emergency rollback, not for opt-in.
// dataview default ON for the same reason — the node is shipped read-only,
// rendered by the canvas editor; flag gates registration.
export const FLAG_CANVAS_BLOCKIDS_ENABLED = 'canvas.blockIds.enabled';
export const FLAG_CANVAS_DATAVIEW_ENABLED = 'canvas.dataview.enabled';
// M60 Phase ζ §8 — autonomy task rail polish.
// `paused.global` is the kill switch (default false; trips → no autonomous
// trigger fires). `rail.enabled` lets the user hide the whole rail UI
// (default true). `patternMemory.enabled` gates the auto-approve-on-pattern
// memory recorded by AutonomyPatternMemoryService (default true).
export const FLAG_PAUSED_GLOBAL = 'autonomy.paused.global';
export const FLAG_RAIL_ENABLED = 'autonomy.rail.enabled';
export const FLAG_PATTERN_MEMORY_ENABLED = 'autonomy.patternMemory.enabled';

export type AutonomyFlagId =
  | typeof FLAG_FOLLOWUP_ENABLED
  | typeof FLAG_SURFACE_CHAT_ENABLED
  | typeof FLAG_SURFACE_NOTIFICATION_ENABLED
  | typeof FLAG_SURFACE_STATUSBAR_ENABLED
  | typeof FLAG_SURFACE_CANVAS_ENABLED
  | typeof FLAG_SURFACE_FILESYSTEM_ENABLED
  | typeof FLAG_HEARTBEAT_ENABLED
  | typeof FLAG_CRON_ENABLED
  | typeof FLAG_SUBAGENT_ENABLED
  | typeof FLAG_CANVAS_BLOCKIDS_ENABLED
  | typeof FLAG_CANVAS_DATAVIEW_ENABLED
  | typeof FLAG_PAUSED_GLOBAL
  | typeof FLAG_RAIL_ENABLED
  | typeof FLAG_PATTERN_MEMORY_ENABLED;

/**
 * Defaults per M60 §3.8. Canvas + filesystem are gated until C3 lands.
 * Followup + chat/notification/statusbar default ON because those wires
 * are already shipped (M58) and proven.
 * Heartbeat / cron / subagent default OFF (Phase γ — controls layer).
 */
export const AUTONOMY_FLAG_DEFAULTS: Readonly<Record<AutonomyFlagId, boolean>> = Object.freeze({
  [FLAG_FOLLOWUP_ENABLED]: true,
  [FLAG_SURFACE_CHAT_ENABLED]: true,
  [FLAG_SURFACE_NOTIFICATION_ENABLED]: true,
  [FLAG_SURFACE_STATUSBAR_ENABLED]: true,
  [FLAG_SURFACE_CANVAS_ENABLED]: false,
  [FLAG_SURFACE_FILESYSTEM_ENABLED]: false,
  [FLAG_HEARTBEAT_ENABLED]: false,
  [FLAG_CRON_ENABLED]: false,
  [FLAG_SUBAGENT_ENABLED]: false,
  [FLAG_CANVAS_BLOCKIDS_ENABLED]: true,
  [FLAG_CANVAS_DATAVIEW_ENABLED]: true,
  [FLAG_PAUSED_GLOBAL]: false,
  [FLAG_RAIL_ENABLED]: true,
  [FLAG_PATTERN_MEMORY_ENABLED]: true,
});

/** Surface plugin id → flag id. Used by SurfaceRouterService gating. */
export const SURFACE_FLAG_BY_ID: Readonly<Record<string, AutonomyFlagId>> = Object.freeze({
  chat: FLAG_SURFACE_CHAT_ENABLED,
  notifications: FLAG_SURFACE_NOTIFICATION_ENABLED,
  status: FLAG_SURFACE_STATUSBAR_ENABLED,
  canvas: FLAG_SURFACE_CANVAS_ENABLED,
  filesystem: FLAG_SURFACE_FILESYSTEM_ENABLED,
});

const STORAGE_KEY = 'autonomy.featureFlags';

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IAutonomyFeatureFlagChange {
  readonly id: AutonomyFlagId;
  readonly value: boolean;
}

export interface IAutonomyFeatureFlagsService {
  /** Read a flag (returns the default if not overridden). */
  isEnabled(id: AutonomyFlagId): boolean;
  /** Set a flag and persist. Fires onDidChange. */
  setEnabled(id: AutonomyFlagId, value: boolean): Promise<void>;
  /** Snapshot of all flags (defaults + overrides applied). */
  getAll(): Readonly<Record<AutonomyFlagId, boolean>>;
  /** Fired on every successful setEnabled. */
  readonly onDidChange: Event<IAutonomyFeatureFlagChange>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AutonomyFeatureFlagsService extends Disposable implements IAutonomyFeatureFlagsService {
  private _overrides: Partial<Record<AutonomyFlagId, boolean>> = {};
  private readonly _onDidChange = this._register(new Emitter<IAutonomyFeatureFlagChange>());
  readonly onDidChange: Event<IAutonomyFeatureFlagChange> = this._onDidChange.event;

  constructor(private readonly _storage: IStorage | undefined) {
    super();
  }

  /** Hydrate overrides from storage. Idempotent. */
  async initialize(): Promise<void> {
    if (!this._storage) return;
    try {
      const raw = await this._storage.get(STORAGE_KEY);
      if (typeof raw !== 'string') return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Partial<Record<AutonomyFlagId, boolean>> = {};
      for (const id of Object.keys(AUTONOMY_FLAG_DEFAULTS) as AutonomyFlagId[]) {
        const v = parsed[id];
        if (typeof v === 'boolean') next[id] = v;
      }
      this._overrides = next;
    } catch {
      // Corrupt storage — fall back to defaults silently.
    }
  }

  isEnabled(id: AutonomyFlagId): boolean {
    const ov = this._overrides[id];
    if (typeof ov === 'boolean') return ov;
    return AUTONOMY_FLAG_DEFAULTS[id];
  }

  async setEnabled(id: AutonomyFlagId, value: boolean): Promise<void> {
    if (!(id in AUTONOMY_FLAG_DEFAULTS)) {
      throw new Error(`[AutonomyFeatureFlags] unknown flag id: ${id}`);
    }
    if (this.isEnabled(id) === value) return;
    this._overrides = { ...this._overrides, [id]: value };
    await this._persist();
    this._onDidChange.fire({ id, value });
  }

  getAll(): Readonly<Record<AutonomyFlagId, boolean>> {
    const out = {} as Record<AutonomyFlagId, boolean>;
    for (const id of Object.keys(AUTONOMY_FLAG_DEFAULTS) as AutonomyFlagId[]) {
      out[id] = this.isEnabled(id);
    }
    return out;
  }

  private async _persist(): Promise<void> {
    if (!this._storage) return;
    try {
      await this._storage.set(STORAGE_KEY, JSON.stringify(this._overrides));
    } catch {
      // Persistence failures don't affect in-memory truth.
    }
  }
}

// ---------------------------------------------------------------------------
// Kill-switch helper (M60 §8 Phase ζ)
// ---------------------------------------------------------------------------

/**
 * Returns `true` only when the kill switch is OFF (`paused.global`=false)
 * AND the per-trigger flag is ON. Used by all runner observer wirings so
 * that flipping `autonomy.paused.global` halts every autonomy trigger
 * without touching individual flags.
 */
export function isAutonomyTriggerAllowed(
  flags: IAutonomyFeatureFlagsService,
  triggerFlag: AutonomyFlagId,
): boolean {
  if (flags.isEnabled(FLAG_PAUSED_GLOBAL)) return false;
  return flags.isEnabled(triggerFlag);
}
