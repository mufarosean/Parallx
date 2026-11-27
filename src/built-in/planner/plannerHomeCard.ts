// plannerHomeCard.ts — what the Planner has for Home: one card for today.
//
// The number is what today holds (events, and tasks still open and due
// today), the line is what comes next, and the action opens Today. Read
// from the same model the Today page draws (plannerToday.ts), so the two
// cannot disagree. Home asks for it when it opens and when the Planner's
// data changed.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { ToolHomeCard, ToolHomeCardProvider } from '../../api/homeApi.js';
import type { PlannerDataService } from './plannerDataService.js';
import { formatTimeShort } from './plannerDates.js';
import { addLocalDays, buildTodayModel, startOfLocalDay, type TodayModel } from './plannerToday.js';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Today's card from today's model; null when the day holds nothing and nothing is overdue. */
export function plannerHomeCard(model: TodayModel, now: number): ToolHomeCard | null {
  const events = model.allDay.length + model.schedule.filter((i) => i.kind === 'event').length;
  const due = model.schedule.filter((i) => i.kind === 'task' && i.task.status !== 'done').length
    + model.anytime.filter((t) => t.status !== 'done').length;
  const overdue = model.overdue.length;
  if (!events && !due && !overdue) return null;
  const base = { id: 'today', icon: 'px-planner', action: { label: 'Open Today', icon: 'arrow-right', command: 'planner.show', args: ['today'] } };
  if (!events && !due) {
    return { ...base, number: String(overdue), unit: 'overdue', line: 'Nothing else is planned for today.' };
  }
  const next = model.schedule.find((i) => i.at > now && (i.kind === 'event' || i.task.status !== 'done'));
  const title = next ? (next.kind === 'event' ? next.event.title : next.task.title) || 'Untitled' : '';
  const line = next ? `Next: ${title}, ${formatTimeShort(next.at)}.`
    : overdue ? `${overdue} ${plural(overdue, 'task is', 'tasks are')} overdue.`
      : 'Nothing more on the schedule today.';
  const unit = events && due ? 'for today' : due ? plural(due, 'task due', 'tasks due') : plural(events, 'event today', 'events today');
  return { ...base, number: String(events + due), unit, line };
}

interface HomeApi {
  home?: { registerCardProvider?(provider: ToolHomeCardProvider): IDisposable };
}

/** Gives Home the Planner's card while the Planner runs. */
export function registerPlannerHomeCard(api: HomeApi, data: PlannerDataService): IDisposable | undefined {
  return api.home?.registerCardProvider?.({
    id: 'today',
    read: async () => {
      const now = Date.now();
      const dayStart = startOfLocalDay(now);
      const [calendars, tasks, events] = await Promise.all([
        data.listCalendars().catch(() => []),
        data.listTasks({ status: ['reviewing', 'planned', 'done'], includeUndated: true, limit: 500 }),
        data.listEvents({ from: dayStart, to: addLocalDays(dayStart, 1) }),
      ]);
      // A calendar that is hidden hides its items; one that is unknown or unset never does.
      const hidden = new Set(calendars.filter((c) => !c.visible).map((c) => c.id));
      return plannerHomeCard(buildTodayModel({ tasks, events, isVisible: (id) => id == null || !hidden.has(id), now }), now);
    },
    onDidChange: (listener) => data.onDidChange(() => listener()),
  });
}
