// dashboardTypes.ts — public types for the dashboard tool.
//
// Re-exported through the widget contribution API surface that tools call
// from their `activate()`. Kept narrow and stable so third-party widget
// contributions don't break when internal refactors land.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { Event } from '../../platform/events.js';

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

export type WidgetConfigFieldType = 'string' | 'number' | 'boolean' | 'enum' | 'textarea' | 'string-list';

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
}

export interface WidgetContext<TConfig = unknown> extends WidgetRefreshContext<TConfig> {
  /** Last cached output for this instance, if any. */
  readonly cachedOutput: string | null;
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

// ─── Public registry surface (exposed to other built-ins / extensions) ───────

export interface DashboardRegistry {
  /** Register a widget type. Returns a disposable that deregisters. */
  registerWidgetType<TConfig = Record<string, unknown>>(
    registration: WidgetTypeRegistration<TConfig>,
  ): IDisposable;
  /** List the currently registered widget types (snapshot). */
  listWidgetTypes(): readonly WidgetTypeRegistration<unknown>[];
}

// ─── Internal row shapes (DB → JS) ───────────────────────────────────────────

export interface DashboardPageRow {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type WidgetStatus = 'ok' | 'error' | 'running' | 'stale';

/**
 * Per-instance visual overrides applied on top of the widget's chrome preset.
 *
 * Each axis defaults to 'default', which means "leave it to the chrome CSS"
 * (so a 'minimal' widget stays transparent unless the user opts in). The
 * editor applies non-default values as inline styles, which win over the
 * chrome classes and hover rules.
 */
export interface WidgetAppearance {
  /** 'default' = chrome default; 'transparent' = no fill; 'custom' = backgroundColor. */
  readonly background: 'default' | 'transparent' | 'custom';
  /** CSS color used when background === 'custom'. */
  readonly backgroundColor: string | null;
  /** 'default' = chrome default; 'none' = no border; 'custom' = borderColor. */
  readonly border: 'default' | 'none' | 'custom';
  /** CSS color used when border === 'custom'. */
  readonly borderColor: string | null;
}

export const DEFAULT_WIDGET_APPEARANCE: WidgetAppearance = {
  background: 'default',
  backgroundColor: null,
  border: 'default',
  borderColor: null,
};

export interface DashboardWidgetRow {
  readonly id: string;
  readonly pageId: string;
  readonly widgetTypeId: string;
  readonly placement: WidgetPlacement;
  readonly position: number;
  readonly config: Record<string, unknown>;
  readonly refreshPolicy: WidgetRefreshPolicy;
  readonly appearance: WidgetAppearance;
  readonly cachedOutput: string | null;
  readonly cachedAt: number | null;
  readonly status: WidgetStatus;
  readonly errorMessage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ─── Page-level events ───────────────────────────────────────────────────────

export type DashboardChangeKind = 'page-created' | 'page-renamed' | 'page-removed' | 'widget-added' | 'widget-updated' | 'widget-removed' | 'widget-cache' | 'widget-status';

export interface DashboardChangeEvent {
  readonly kind: DashboardChangeKind;
  readonly pageId?: string;
  readonly widgetId?: string;
}
