// registerPlannerWidgets.ts — register the planner's dashboard widgets.
//
// M86: contributed through `api.dashboard` (the narrow registrar interface
// below), which is activation-order independent — no more getRegistry
// polling. typeIds are already namespaced under this tool's id.

import { toDisposable, type IDisposable } from '../../../platform/lifecycle.js';
import type { WidgetTypeRegistration } from '../../../api/bridges/dashboardBridge.js';
import type { PlannerDataService } from '../plannerDataService.js';
import { buildTasksSummaryWidget } from './tasksSummaryWidget.js';
import { buildCalendarAgendaWidget } from './calendarAgendaWidget.js';
import { buildCalendarViewWidget } from './calendarViewWidget.js';

interface WidgetRegistrar {
  registerWidgetType<TConfig = Record<string, unknown>>(
    registration: WidgetTypeRegistration<TConfig>,
  ): IDisposable;
}

export function registerPlannerDashboardWidgets(
  registry: WidgetRegistrar,
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
