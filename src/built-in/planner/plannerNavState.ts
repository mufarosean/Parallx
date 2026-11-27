// plannerNavState.ts — handoffs between a Planner command and a Planner pane
// that may still be building. Which page the pane shows is no longer one of
// them: the core's places (services/places.ts) say where each tab is.

/** A YYYY-MM-DD day as the local date it names, or null. */
export function plannerDayFrom(date: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// planner.newTask: it opens the editor and then dispatches
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
