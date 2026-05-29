// builtInWidgets.ts — registers the dashboard's own built-in widgets.
//
// Imported by the dashboard's main.ts during activate(). Each widget lives
// in its own file; this barrel just hooks them up.

import { toDisposable, type IDisposable } from '../../../platform/lifecycle.js';
import type { DashboardRegistry } from '../dashboardTypes.js';
import { CLOCK_AND_LINKS_WIDGET } from './clockAndLinksWidget.js';
import { RECENT_FILES_WIDGET } from './recentFilesWidget.js';
import { NEWS_BRIEF_WIDGET } from './newsBriefWidget.js';
import { IMAGE_WIDGET } from './imageWidget.js';

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
    registry.registerWidgetType(IMAGE_WIDGET),
  ];

  return toDisposable(() => {
    for (const d of disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
  });
}
