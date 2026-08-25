// builtInWidgets.ts — registers the dashboard's own built-in widgets.
//
// Imported by the dashboard's main.ts during activate(). Each widget lives
// in its own file; this barrel just hooks them up.

import { toDisposable, type IDisposable } from '../../../platform/lifecycle.js';
import type { DashboardRegistry } from '../dashboardTypes.js';
import { CLOCK_AND_LINKS_WIDGET } from './clockAndLinksWidget.js';
import { CUSTOM_AI_WIDGET } from './customAiWidget.js';
import { LIVE_WIDGET } from './liveWidget.js';
import { IMAGE_WIDGET } from './imageWidget.js';
import { VIDEO_WIDGET } from './videoWidget.js';
import { NOTES_WIDGET } from './notesWidget.js';
import { TASKS_WIDGET } from './tasksWidget.js';
import { COUNTDOWN_WIDGET } from './countdownWidget.js';
import { WEATHER_WIDGET } from './weatherWidget.js';
import { MARKET_WIDGET } from './marketWidget.js';
import { TIMER_WIDGET } from './timerWidget.js';
import { TRACKER_BOARD_WIDGET } from './trackerBoardWidget.js';
import { SAVED_QUERY_WIDGET } from './savedQueryWidget.js';
import { TABLE_WIDGET } from './tableWidget.js';
import { YEAR_PROGRESS_WIDGET } from './yearProgressWidget.js';
import { QUOTE_WIDGET } from './quoteWidget.js';
import { BREATHE_WIDGET } from './breatheWidget.js';
import { DECISION_COIN_WIDGET } from './decisionCoinWidget.js';
import { COMPANION_WIDGET } from './companionWidget.js';

interface ApiSurfaceUsedByWidgets {
  commands: { executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> };
  editors: { openFileEditor?(uri: string, options?: { pinned?: boolean }): Promise<void> };
}

export function registerBuiltInDashboardWidgets(
  registry: DashboardRegistry,
  _api: ApiSurfaceUsedByWidgets,
): IDisposable {
  // The widgets receive the api through the per-instance ctx (the dashboard
  // editor pane stuffs it into the context object). Nothing to capture here
  // beyond registration.

  // M86: organ-owned widgets are NOT registered here — they are contributed
  // by the tool that owns their data via `api.dashboard.registerWidgetType`
  // (recent-files → explorer; autonomy-activity → chat; news-brief →
  // web-research extension). Their typeIds are unchanged, so persisted
  // instances keep working.
  const disposables: IDisposable[] = [
    registry.registerWidgetType(CLOCK_AND_LINKS_WIDGET),
    registry.registerWidgetType(CUSTOM_AI_WIDGET),
    registry.registerWidgetType(LIVE_WIDGET),
    registry.registerWidgetType(IMAGE_WIDGET),
    registry.registerWidgetType(VIDEO_WIDGET),
    registry.registerWidgetType(NOTES_WIDGET),
    registry.registerWidgetType(TASKS_WIDGET),
    registry.registerWidgetType(COUNTDOWN_WIDGET),
    registry.registerWidgetType(WEATHER_WIDGET),
    registry.registerWidgetType(MARKET_WIDGET),
    // M86 C3 — the generic slate: domain-blind, config-shaped widgets.
    registry.registerWidgetType(TIMER_WIDGET),
    registry.registerWidgetType(TRACKER_BOARD_WIDGET),
    registry.registerWidgetType(SAVED_QUERY_WIDGET),
    registry.registerWidgetType(TABLE_WIDGET),
    // The personality shelf: small, config-shaped, no data dependencies.
    registry.registerWidgetType(YEAR_PROGRESS_WIDGET),
    registry.registerWidgetType(QUOTE_WIDGET),
    registry.registerWidgetType(BREATHE_WIDGET),
    registry.registerWidgetType(DECISION_COIN_WIDGET),
    registry.registerWidgetType(COMPANION_WIDGET),
  ];

  return toDisposable(() => {
    for (const d of disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
  });
}
