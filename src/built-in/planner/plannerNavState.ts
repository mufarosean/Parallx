// plannerNavState.ts — what a Planner command hands the pane that draws the
// place it opens. Which page a tab shows is the core's (services/places.ts);
// a form or an item to open over that page rides along once, read by the
// drawing of that place and by no other (not kept in the address).

/** A YYYY-MM-DD day as the local date it names, or null. */
export function plannerDayFrom(date: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** A form, or an item in detail, opened over a place: a popover, not a place of its own. */
export type PlannerOver =
  | { readonly form: 'newTask' }
  | { readonly form: 'newEvent' }
  | { readonly form: 'task'; readonly id: string }
  | { readonly form: 'event'; readonly id: string; readonly at: number };

let _carried: { readonly place: string; readonly over: PlannerOver } | null = null;

/** A command, before it opens `place`: what the drawing of that place opens over it. */
export function carryPlannerOver(place: string, over: PlannerOver | null): void {
  _carried = over ? { place, over } : null;
}

/** The drawing of `place`: what to open over it, once (null when nothing rides along to this place). */
export function takePlannerOver(place: string): PlannerOver | null {
  if (!_carried || _carried.place !== place) return null;
  const { over } = _carried;
  _carried = null;
  return over;
}

/** True while a command has sent something to open over a place not yet drawn. */
export function plannerOverPending(): boolean {
  return _carried !== null;
}

/** YYYY-MM-DD of a moment, in local time (as the calendar's address names a day). */
export function plannerDayString(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
