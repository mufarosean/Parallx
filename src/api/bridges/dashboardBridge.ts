// dashboardBridge.ts — bridges `parallx.dashboard` to a shared in-process
// hub of dashboard widget-type contributions.
//
// Any tool (built-in or external extension) registers widget types through
// its own per-tool bridge; the dashboard tool consumes the hub to populate
// its registry, picker, and scheduler. The hub is module-global so
// contributions survive activation-order differences: a tool may register
// before OR after the dashboard activates — the dashboard replays the hub
// on activation and follows changes live.
//
// This file is also the canonical home of the widget contribution CONTRACT
// (`WidgetTypeRegistration` and friends). The dashboard built-in re-exports
// these from `dashboardTypes.ts`, so the API layer never depends on
// built-in code — the dependency arrow points built-in → api only.
//
// Same architecture as workspaceGraphBridge: module-global hub + per-tool
// bridge instances whose registrations are cleaned up on deactivation.

import { type IDisposable, toDisposable } from '../../platform/lifecycle.js';
import type { Event } from '../../platform/events.js';
import { parseCronField } from '../../openclaw/openclawCronService.js';

// ─── Grid / Placement ────────────────────────────────────────────────────────

/** 12-column dashboard grid. */
export const DASHBOARD_GRID_COLS = 12;

/** Hard limits enforced at the contribution / scheduler boundary. */
export const DASHBOARD_LIMITS = {
  /** Minimum interval / cron tick allowed at widget registration. */
  MIN_REFRESH_INTERVAL_MS: 60_000,
  /** Maximum concurrent AI-policy refreshes per workspace. */
  MAX_CONCURRENT_AI_REFRESHES: 1,
  /** Maximum bytes of cached_output we persist; anything larger is truncated. */
  MAX_CACHED_OUTPUT_BYTES: 256 * 1024,
  /** Per-refresh timeout — refresh that doesn't complete is killed. */
  REFRESH_TIMEOUT_MS: 60_000,
} as const;

export interface WidgetPlacement {
  readonly row: number;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

export interface WidgetSizeBounds {
  readonly minColSpan?: number;
  readonly maxColSpan?: number;
  readonly minRowSpan?: number;
  readonly maxRowSpan?: number;
}

// ─── Config schema (form-driven) ─────────────────────────────────────────────

export type WidgetConfigFieldType = 'string' | 'number' | 'boolean' | 'enum' | 'textarea' | 'markdown' | 'string-list';

export interface WidgetConfigField {
  readonly type: WidgetConfigFieldType;
  readonly label: string;
  readonly description?: string;
  /** Enum options (when type === 'enum'). */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Default value (mirrors widget's defaultConfig — convenience for picker forms). */
  readonly default?: unknown;
  /** Optional placeholder for text inputs. */
  readonly placeholder?: string;
}

export interface WidgetConfigSchema {
  /** Keyed by config-property name. Renders in declaration order. */
  readonly fields: Readonly<Record<string, WidgetConfigField>>;
}

// ─── Refresh policy ──────────────────────────────────────────────────────────

export type WidgetRefreshPolicy =
  | { readonly kind: 'manual' }
  | { readonly kind: 'interval'; readonly ms: number }   // ms ≥ 60_000
  | { readonly kind: 'cron'; readonly cron: string };    // standard 5-field cron

// ─── Widget contribution interface ───────────────────────────────────────────

export type WidgetCategory =
  /** Static / no refresh (clock, links). */
  | 'static'
  /** Query-backed (filesystem, DB). */
  | 'query'
  /** AI-backed (background prompt). */
  | 'ai';

export interface WidgetRefreshContext<TConfig = unknown> {
  readonly instanceId: string;
  readonly pageId: string;
  readonly config: TConfig;
  /** Full Parallx API surface, scoped to the dashboard tool. */
  readonly api: unknown;
  /** Last cached output for this instance, if any. */
  readonly cachedOutput: string | null;
}

export interface WidgetContext<TConfig = unknown> extends WidgetRefreshContext<TConfig> {
  /** Last persisted error message for this instance, if the prior refresh failed. */
  readonly errorMessage: string | null;
  /** Fires when the user saves new config from the settings drawer. */
  readonly onDidChangeConfig: Event<TConfig>;

  /** Trigger a manual refresh — same code path as cron / interval. */
  requestRefresh(): void;
  /** Persist a fresh output string. Clears any prior error. */
  setCachedOutput(output: string): void;
  /** Flip the widget to error state with a user-visible message. */
  setError(message: string): void;
  /** Explicitly clear error state without writing new output. */
  clearError(): void;
}

export interface WidgetHandle extends IDisposable {
  /** Optional manual re-render hook the dashboard calls after `setCachedOutput`. */
  refreshFromCache?(cachedOutput: string | null): void;
  /**
   * Optional hook the dashboard calls when a refresh fails, so the widget can
   * surface the reason in its own body instead of relying on the small header
   * status dot. Called with `null` when the error clears.
   */
  renderError?(message: string | null): void;
}

/**
 * Visual chrome preset for a widget instance.
 *
 * - 'card' (default): full chrome — card background, persistent header
 *   (title + status + actions), bottom footer for "updated N ago".
 * - 'minimal': transparent background and no footer. Header is hidden by
 *   default and reveals on hover so the widget body sits flush with the
 *   dashboard background. Good for time / counter / glance widgets.
 * - 'bare': no chrome at all. Just the widget body, edge to edge. Hover
 *   still reveals a tiny floating action strip in the top-right so the
 *   user can refresh / configure / remove without losing the look.
 */
export type WidgetChromeStyle = 'card' | 'minimal' | 'bare';

export interface WidgetTypeRegistration<TConfig = Record<string, unknown>> {
  readonly typeId: string;
  readonly displayName: string;
  readonly description?: string;
  /** Codicon name or pre-rendered SVG/HTML. */
  readonly icon?: string;
  /** Coarse category — drives picker grouping. */
  readonly category: WidgetCategory;
  readonly defaultSize: { readonly colSpan: number; readonly rowSpan: number };
  readonly sizeBounds?: WidgetSizeBounds;
  readonly defaultConfig: TConfig;
  readonly configSchema?: WidgetConfigSchema;
  readonly defaultRefreshPolicy?: WidgetRefreshPolicy;
  /** Default chrome preset. User config may override per instance later. */
  readonly chromeStyle?: WidgetChromeStyle;

  /**
   * Pure data fetch. Runs both headless (scheduler) and mounted (user click).
   * Must return a string ≤ MAX_CACHED_OUTPUT_BYTES; anything larger is truncated.
   * Omit for widgets with nothing to refresh.
   */
  refresh?(ctx: WidgetRefreshContext<TConfig>): Promise<string>;

  /** DOM render. Receives cachedOutput via ctx.cachedOutput on first paint. */
  createWidget(container: HTMLElement, ctx: WidgetContext<TConfig>): WidgetHandle;
}

/** Metadata-only view of a registered widget type (no renderer access). */
export interface WidgetTypeDescriptor {
  readonly typeId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category: WidgetCategory;
  readonly defaultSize: { readonly colSpan: number; readonly rowSpan: number };
  /** Tool that contributed this type. */
  readonly ownerToolId: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a refresh policy. Mirrors the dashboard scheduler's rules:
 * intervals ≥ 60s, cron must be a parseable 5-field expression.
 */
export function validateWidgetRefreshPolicy(policy: WidgetRefreshPolicy): void {
  if (policy.kind === 'interval') {
    if (!Number.isFinite(policy.ms) || policy.ms < DASHBOARD_LIMITS.MIN_REFRESH_INTERVAL_MS) {
      throw new Error(`Refresh interval must be ≥ ${DASHBOARD_LIMITS.MIN_REFRESH_INTERVAL_MS}ms`);
    }
  } else if (policy.kind === 'cron') {
    const parts = policy.cron.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Cron expression must have 5 fields');
    const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
    for (let i = 0; i < 5; i++) parseCronField(parts[i], ranges[i][0], ranges[i][1]);
  } else if (policy.kind !== 'manual') {
    throw new Error(`Unsupported refresh policy kind: ${(policy as { kind?: string }).kind ?? 'undefined'}`);
  }
}

/**
 * Widget typeIds that predate organ ownership (M86 re-homing). Persisted
 * dashboards reference these id strings, so the ids are frozen while their
 * OWNER moved to the tool that owns the underlying data. Only the mapped
 * tool may register the id. Closed set — never add entries for new widgets;
 * new typeIds must be namespaced under the contributing tool's id.
 */
export const LEGACY_WIDGET_TYPE_OWNERS: Readonly<Record<string, string>> = {
  'parallx.dashboard.recent-files': 'parallx.explorer',
  'parallx.dashboard.autonomy-activity': 'parallx.chat',
  'parallx.dashboard.news-brief': 'parallx.web-research',
};

function validateRegistration(toolId: string, reg: WidgetTypeRegistration<unknown>): void {
  if (!reg || typeof reg !== 'object') {
    throw new Error('[api.dashboard] registerWidgetType: registration object is required');
  }
  const typeId = reg.typeId;
  if (typeof typeId !== 'string' || !typeId.trim() || /\s/.test(typeId)) {
    throw new Error('[api.dashboard] registerWidgetType: typeId must be a non-empty string without whitespace');
  }

  // Namespacing: a tool's typeIds live under its own id. The legacy table is
  // the only exception, and it maps each id to exactly one permitted owner.
  const legacyOwner = LEGACY_WIDGET_TYPE_OWNERS[typeId];
  const namespaced = typeId.startsWith(`${toolId}.`);
  if (!namespaced && legacyOwner !== toolId) {
    throw new Error(
      `[api.dashboard] Widget typeId "${typeId}" must start with "${toolId}." (typeIds are namespaced under the contributing tool's id).`,
    );
  }

  if (typeof reg.displayName !== 'string' || !reg.displayName.trim()) {
    throw new Error(`[api.dashboard] Widget "${typeId}": displayName is required`);
  }
  if (reg.category !== 'static' && reg.category !== 'query' && reg.category !== 'ai') {
    throw new Error(`[api.dashboard] Widget "${typeId}": category must be 'static' | 'query' | 'ai'`);
  }
  if (typeof reg.createWidget !== 'function') {
    throw new Error(`[api.dashboard] Widget "${typeId}": createWidget(container, ctx) is required`);
  }
  if (reg.refresh !== undefined && typeof reg.refresh !== 'function') {
    throw new Error(`[api.dashboard] Widget "${typeId}": refresh must be a function when provided`);
  }

  const size = reg.defaultSize;
  const validSpan = (n: unknown, max: number): boolean => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
  if (!size || !validSpan(size.colSpan, DASHBOARD_GRID_COLS) || !validSpan(size.rowSpan, 24)) {
    throw new Error(`[api.dashboard] Widget "${typeId}": defaultSize must be integers with 1 ≤ colSpan ≤ ${DASHBOARD_GRID_COLS} and 1 ≤ rowSpan ≤ 24`);
  }
  const b = reg.sizeBounds;
  if (b) {
    const inRange = (n: number | undefined, max: number): boolean => n === undefined || validSpan(n, max);
    if (!inRange(b.minColSpan, DASHBOARD_GRID_COLS) || !inRange(b.maxColSpan, DASHBOARD_GRID_COLS)
      || !inRange(b.minRowSpan, 24) || !inRange(b.maxRowSpan, 24)
      || (b.minColSpan !== undefined && b.maxColSpan !== undefined && b.minColSpan > b.maxColSpan)
      || (b.minRowSpan !== undefined && b.maxRowSpan !== undefined && b.minRowSpan > b.maxRowSpan)) {
      throw new Error(`[api.dashboard] Widget "${typeId}": sizeBounds are incoherent`);
    }
  }

  if (reg.defaultRefreshPolicy) {
    validateWidgetRefreshPolicy(reg.defaultRefreshPolicy);
  }
}

// ─── Module-global hub ───────────────────────────────────────────────────────

export interface ContributedWidgetType {
  readonly ownerToolId: string;
  readonly registration: WidgetTypeRegistration<unknown>;
}

const _contributions = new Map<string, ContributedWidgetType>();
const _changeListeners = new Set<() => void>();

function _fireChange(): void {
  for (const fn of _changeListeners) {
    try { fn(); } catch (err) { console.warn('[DashboardBridge] change listener threw:', err); }
  }
}

/**
 * Snapshot of all currently contributed widget types (all tools).
 * Consumed by the dashboard built-in to populate its registry — call again
 * after `onDashboardWidgetContributionsDidChange` fires.
 */
export function getContributedDashboardWidgetTypes(): readonly ContributedWidgetType[] {
  return Array.from(_contributions.values());
}

/**
 * Subscribe to hub changes (any tool registering or deregistering a type).
 */
export function onDashboardWidgetContributionsDidChange(listener: () => void): IDisposable {
  _changeListeners.add(listener);
  return toDisposable(() => { _changeListeners.delete(listener); });
}

// ─── Per-tool bridge ─────────────────────────────────────────────────────────

export class DashboardBridge {
  private _disposed = false;
  private readonly _registered = new Set<string>();

  constructor(
    private readonly _toolId: string,
    private readonly _subscriptions: IDisposable[],
  ) {}

  /**
   * Register a dashboard widget type. Validated at this boundary: typeId
   * namespacing under the tool id, required fields, sane sizes, refresh
   * policy limits. Returns a disposable that deregisters the type.
   */
  registerWidgetType<TConfig = Record<string, unknown>>(
    registration: WidgetTypeRegistration<TConfig>,
  ): IDisposable {
    this._throwIfDisposed();
    const reg = registration as WidgetTypeRegistration<unknown>;
    validateRegistration(this._toolId, reg);

    const typeId = reg.typeId;
    const existing = _contributions.get(typeId);
    if (existing && existing.ownerToolId !== this._toolId) {
      // Another tool owns this id — refuse the hijack.
      throw new Error(
        `[api.dashboard] Widget typeId "${typeId}" is already registered by "${existing.ownerToolId}".`,
      );
    }
    if (existing) {
      console.warn(`[api.dashboard] Widget type "${typeId}" re-registered by "${this._toolId}" — replacing.`);
    }

    const entry: ContributedWidgetType = { ownerToolId: this._toolId, registration: reg };
    _contributions.set(typeId, entry);
    this._registered.add(typeId);
    _fireChange();

    const d = toDisposable(() => {
      const current = _contributions.get(typeId);
      if (current === entry) {
        _contributions.delete(typeId);
        this._registered.delete(typeId);
        _fireChange();
      }
    });
    this._subscriptions.push(d);
    return d;
  }

  /**
   * Metadata snapshot of every contributed widget type, across all tools.
   * No renderer access — use the dashboard UI to instantiate widgets.
   */
  listWidgetTypes(): readonly WidgetTypeDescriptor[] {
    this._throwIfDisposed();
    return Array.from(_contributions.values(), ({ ownerToolId, registration }) => Object.freeze({
      typeId: registration.typeId,
      displayName: registration.displayName,
      description: registration.description,
      icon: registration.icon,
      category: registration.category,
      defaultSize: registration.defaultSize,
      ownerToolId,
    }));
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    let removed = false;
    for (const typeId of this._registered) {
      const current = _contributions.get(typeId);
      if (current && current.ownerToolId === this._toolId) {
        _contributions.delete(typeId);
        removed = true;
      }
    }
    this._registered.clear();
    if (removed) _fireChange();
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[DashboardBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}
