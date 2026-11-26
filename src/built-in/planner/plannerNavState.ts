// plannerNavState.ts — tiny nav handoff between the planner sidebar and the
// editor pane.
//
// The sidebar opens the planner editor and then dispatches a `focusTab` event
// to switch tabs. On FIRST open the pane (and its event listener) isn't built
// yet when the event fires, so the event was lost and the pane fell back to its
// default tab ('tasks') — which is exactly why clicking "Calendar" landed on
// Tasks. The sidebar now records the requested tab here BEFORE opening; the
// pane reads (and clears) it at creation so the initial tab is deterministic.
// The `focusTab` event is still used for re-clicks while the editor is already
// open.

export type PlannerTab = 'today' | 'tasks' | 'calendar';

let _pendingTab: PlannerTab | null = null;
/** With the Tasks tab, the list to show (a Tasks filter key, e.g. 'overdue'). */
let _pendingFilter: string | null = null;
/** With the Calendar tab, the day to show (YYYY-MM-DD), from the column's small month. */
let _pendingDate: string | null = null;

/** Sidebar: record the tab (and, for Tasks, the list; for Calendar, the day) to open before invoking openEditor. */
export function setPendingPlannerTab(tab: PlannerTab, tasksFilter: string | null = null, date: string | null = null): void {
  _pendingTab = tab;
  _pendingFilter = tasksFilter;
  _pendingDate = date;
}

/** Pane: consume the requested tab, list and day (one-shot). Returns null if none pending. */
export function takePendingPlannerTab(): { tab: PlannerTab; tasksFilter: string | null; date: string | null } | null {
  const tab = _pendingTab;
  const tasksFilter = _pendingFilter;
  const date = _pendingDate;
  _pendingTab = null;
  _pendingFilter = null;
  _pendingDate = null;
  return tab ? { tab, tasksFilter, date } : null;
}

/** A YYYY-MM-DD day as the local date it names, or null. */
export function plannerDayFrom(date: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// planner.newTask has the same race: it opens the editor and then dispatches
// `newTask`, which a pane still building misses, so the Planner opened with no
// form. The command records the request first; the pane that opens the form
// (an open one on the event, a new one once it has drawn) takes it.
let _pendingNewTask = false;

/** planner.newTask: record the request before invoking openEditor. */
export function setPendingPlannerNewTask(pending: boolean): void {
  _pendingNewTask = pending;
}

/** Pane: consume the request (one-shot). */
export function takePendingPlannerNewTask(): boolean {
  const pending = _pendingNewTask;
  _pendingNewTask = false;
  return pending;
}

// planner.newEvent, the same way: the pane that draws takes the request and
// opens the event dialog.
let _pendingNewEvent = false;

/** planner.newEvent: record the request before invoking openEditor. */
export function setPendingPlannerNewEvent(pending: boolean): void {
  _pendingNewEvent = pending;
}

/** Pane: consume the request (one-shot). */
export function takePendingPlannerNewEvent(): boolean {
  const pending = _pendingNewEvent;
  _pendingNewEvent = false;
  return pending;
}
