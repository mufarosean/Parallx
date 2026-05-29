// registerPlannerWidgets.ts — register the planner's dashboard widgets.

import { toDisposable, type IDisposable } from '../../../platform/lifecycle.js';
import type { DashboardRegistry } from '../../dashboard/dashboardTypes.js';
import type { PlannerDataService } from '../plannerDataService.js';
import { buildTasksSummaryWidget } from './tasksSummaryWidget.js';
import { buildCalendarAgendaWidget } from './calendarAgendaWidget.js';
import { buildCalendarViewWidget } from './calendarViewWidget.js';

export function registerPlannerDashboardWidgets(
  registry: DashboardRegistry,
  data: PlannerDataService,
): IDisposable {
  const disposables: IDisposable[] = [
    registry.registerWidgetType(buildTasksSummaryWidget(data)),
    registry.registerWidgetType(buildCalendarAgendaWidget(data)),
    registry.registerWidgetType(buildCalendarViewWidget(data)),
  ];
  return toDisposable(() => {
    for (const d of disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
  });
}
