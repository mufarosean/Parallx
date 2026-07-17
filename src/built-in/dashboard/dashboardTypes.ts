// dashboardTypes.ts — public types for the dashboard tool.
//
// The widget contribution CONTRACT (WidgetTypeRegistration and friends) is
// canonically defined in the API layer (`src/api/bridges/dashboardBridge.ts`)
// so that any tool — built-in or external extension — contributes widgets
// through `parallx.dashboard` against one definition. This file re-exports
// the contract for dashboard-internal code and keeps the shapes that are
// genuinely dashboard-private (DB rows, appearance, change events).

import type { IDisposable } from '../../platform/lifecycle.js';
import type {
  WidgetPlacement,
  WidgetRefreshPolicy,
  WidgetTypeRegistration,
} from '../../api/bridges/dashboardBridge.js';

// ─── Contribution contract (canonical home: api/bridges/dashboardBridge.ts) ──

export {
  DASHBOARD_GRID_COLS,
  DASHBOARD_LIMITS,
} from '../../api/bridges/dashboardBridge.js';

export type {
  WidgetPlacement,
  WidgetSizeBounds,
  WidgetConfigFieldType,
  WidgetConfigField,
  WidgetConfigSchema,
  WidgetRefreshPolicy,
  WidgetCategory,
  WidgetRefreshContext,
  WidgetContext,
  WidgetHandle,
  WidgetChromeStyle,
  WidgetTypeRegistration,
  WidgetTypeDescriptor,
} from '../../api/bridges/dashboardBridge.js';

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
  readonly headerHidden: boolean;
  /**
   * Page-level refresh schedule (M86 C4, migration 005). When set, firing
   * refreshes every widget on the page headlessly. Null = off.
   */
  readonly refreshPolicy: WidgetRefreshPolicy | null;
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
  /** Per-instance title override. null/empty = use the widget type's displayName. */
  readonly title: string | null;
  /** Hide the header title row entirely (actions still reveal on hover). */
  readonly titleHidden: boolean;
}

export const DEFAULT_WIDGET_APPEARANCE: WidgetAppearance = {
  background: 'default',
  backgroundColor: null,
  border: 'default',
  borderColor: null,
  title: null,
  titleHidden: false,
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
  /**
   * Tool that provided the widget type when this instance was added
   * (M86, migration 004). Used by the unavailable-placeholder to say who
   * to re-enable. Null for instances created before the column existed.
   */
  readonly providerToolId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ─── Page-level events ───────────────────────────────────────────────────────

export type DashboardChangeKind = 'page-created' | 'page-renamed' | 'page-updated' | 'page-removed' | 'widget-added' | 'widget-updated' | 'widget-removed' | 'widget-cache' | 'widget-status';

export interface DashboardChangeEvent {
  readonly kind: DashboardChangeKind;
  readonly pageId?: string;
  readonly widgetId?: string;
}
