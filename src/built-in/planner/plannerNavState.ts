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

/** Sidebar: record the tab (and, for Tasks, the list) to open before invoking openEditor. */
export function setPendingPlannerTab(tab: PlannerTab, tasksFilter: string | null = null): void {
  _pendingTab = tab;
  _pendingFilter = tasksFilter;
}

/** Pane: consume the requested tab and list (one-shot). Returns null if none pending. */
export function takePendingPlannerTab(): { tab: PlannerTab; tasksFilter: string | null } | null {
  const tab = _pendingTab;
  const tasksFilter = _pendingFilter;
  _pendingTab = null;
  _pendingFilter = null;
  return tab ? { tab, tasksFilter } : null;
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
