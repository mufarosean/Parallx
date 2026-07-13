// builtInWidgets.ts — registers the dashboard's own built-in widgets.
//
// Imported by the dashboard's main.ts during activate(). Each widget lives
// in its own file; this barrel just hooks them up.

import { toDisposable, type IDisposable } from '../../../platform/lifecycle.js';
import type { DashboardRegistry } from '../dashboardTypes.js';
import { CLOCK_AND_LINKS_WIDGET } from './clockAndLinksWidget.js';
import { RECENT_FILES_WIDGET } from './recentFilesWidget.js';
import { NEWS_BRIEF_WIDGET } from './newsBriefWidget.js';
import { CUSTOM_AI_WIDGET } from './customAiWidget.js';
import { LIVE_WIDGET } from './liveWidget.js';
import { IMAGE_WIDGET } from './imageWidget.js';
import { VIDEO_WIDGET } from './videoWidget.js';
import { AUTONOMY_ACTIVITY_WIDGET } from './autonomyActivityWidget.js';
import { NOTES_WIDGET } from './notesWidget.js';
import { TASKS_WIDGET } from './tasksWidget.js';
import { COUNTDOWN_WIDGET } from './countdownWidget.js';
import { WEATHER_WIDGET } from './weatherWidget.js';
import { MARKET_WIDGET } from './marketWidget.js';

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

  const disposables: IDisposable[] = [
    registry.registerWidgetType(CLOCK_AND_LINKS_WIDGET),
    registry.registerWidgetType(RECENT_FILES_WIDGET),
    registry.registerWidgetType(NEWS_BRIEF_WIDGET),
    registry.registerWidgetType(CUSTOM_AI_WIDGET),
    registry.registerWidgetType(LIVE_WIDGET),
    registry.registerWidgetType(IMAGE_WIDGET),
    registry.registerWidgetType(VIDEO_WIDGET),
    registry.registerWidgetType(AUTONOMY_ACTIVITY_WIDGET),
    registry.registerWidgetType(NOTES_WIDGET),
    registry.registerWidgetType(TASKS_WIDGET),
    registry.registerWidgetType(COUNTDOWN_WIDGET),
    registry.registerWidgetType(WEATHER_WIDGET),
    registry.registerWidgetType(MARKET_WIDGET),
  ];

  return toDisposable(() => {
    for (const d of disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
  });
}
