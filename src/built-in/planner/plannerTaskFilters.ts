// plannerTaskFilters.ts — the six lists a task can be found in: Review Queue,
// Today, This Week, Overdue, All Tasks, Completed. One definition, read by
// the Tasks page and by the lists under Tasks in Planner's column, so the two
// can never count differently.

import type { PlannerTask } from './plannerTypes.js';
import { isOverdue } from './plannerToday.js';
import { isSameAppDay } from '../../services/localTime.js';
import { startOfDayMs } from './plannerDates.js';

export interface PlannerTaskFilter {
  readonly key: string;
  readonly label: string;
  /** Set apart from the rest, on top: what waits for a decision. */
  readonly pinned?: boolean;
  match(task: PlannerTask): boolean;
}

const open = (t: PlannerTask): boolean => t.status === 'planned' || t.status === 'reviewing';

export const PLANNER_TASK_FILTERS: readonly PlannerTaskFilter[] = [
  { key: 'review', label: 'Review Queue', pinned: true, match: (t) => t.status === 'reviewing' },
  { key: 'today', label: 'Today', match: (t) => open(t) && t.dueAt != null && isSameAppDay(t.dueAt, Date.now()) },
  { key: 'week', label: 'This Week', match: (t) => open(t) && t.dueAt != null && t.dueAt >= startOfDayMs() && t.dueAt <= startOfDayMs() + 7 * 86_400_000 },
  { key: 'overdue', label: 'Overdue', match: (t) => open(t) && isOverdue(t, Date.now()) },
  { key: 'all', label: 'All Tasks', match: (t) => t.status !== 'cancelled' },
  { key: 'completed', label: 'Completed', match: (t) => t.status === 'done' },
];

/** What the lists are counted over: every task that is not cancelled. */
export const PLANNER_TASK_LIST_QUERY = { status: ['reviewing', 'planned', 'done'] as ('reviewing' | 'planned' | 'done')[], includeUndated: true, limit: 500 };
