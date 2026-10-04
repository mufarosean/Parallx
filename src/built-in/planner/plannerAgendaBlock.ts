// plannerAgendaBlock.ts — the Planner's Agenda block for pages
//
// Shows events and tasks for today, tomorrow or the next seven days, kept
// current as the planner changes. Tick a task to mark it done (untick to put
// it back); click anything else to open the planner. Overdue tasks that are
// not done show at the top of today.
//
// The Planner brings this block to the canvas while it runs
// (api.canvas.registerBlock); with the Planner turned off the block is not
// offered, and pages that have one say the Planner is needed.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { CanvasBlockRegistration } from '../../api/bridges/canvasBlocksBridge.js';
import { addAppDays, appDateString, appTimeString, startOfAppDay } from '../../services/localTime.js';

export type AgendaRange = 'today' | 'tomorrow' | 'week';
export type AgendaShow = 'all' | 'events' | 'tasks';

export const AGENDA_RANGES: ReadonlyArray<{ value: AgendaRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'Next 7 days' },
];
export const AGENDA_SHOWS: ReadonlyArray<{ value: AgendaShow; label: string }> = [
  { value: 'all', label: 'Events and tasks' },
  { value: 'events', label: 'Events only' },
  { value: 'tasks', label: 'Tasks only' },
];

// The planner's shapes, as much of them as the block reads.
export interface AgendaEventLike { readonly id: string; readonly title: string; readonly startAt: number; readonly endAt: number; readonly allDay: boolean; readonly color: string | null }
export interface AgendaTaskLike { readonly id: string; readonly title: string; readonly status: string; readonly dueAt: number | null; readonly color: string | null }

/** Midnight starting the user's day (the app's Time Zone). */
export function startOfDay(t: number): number {
  return startOfAppDay(t);
}

/** Adds whole calendar days (a day across a clock change is not 24 hours). */
function addDays(t: number, days: number): number {
  return addAppDays(t, days);
}

/** The window a range covers, both ends inclusive. */
export function agendaWindow(range: string, now: number = Date.now()): { from: number; to: number; days: number } {
  const today = startOfDay(now);
  if (range === 'tomorrow') return { from: addDays(today, 1), to: addDays(today, 2) - 1, days: 1 };
  if (range === 'week') return { from: today, to: addDays(today, 7) - 1, days: 7 };
  return { from: today, to: addDays(today, 1) - 1, days: 1 };
}

export type AgendaItem =
  | { kind: 'event'; id: string; title: string; allDay: boolean; startAt: number; endAt: number; color: string | null }
  | { kind: 'task'; id: string; title: string; done: boolean; overdue: boolean; dueAt: number; color: string | null };

export interface AgendaDay { readonly start: number; readonly items: AgendaItem[] }

/** Events and tasks by day, each day in order: all-day events, timed events
 *  by start, then tasks (overdue first). Days with nothing are left out. */
export function buildAgenda(
  events: readonly AgendaEventLike[], tasks: readonly AgendaTaskLike[],
  range: string, show: string, now: number = Date.now(),
): AgendaDay[] {
  const win = agendaWindow(range, now);
  const today = startOfDay(now);
  const days: AgendaDay[] = [];
  for (let i = 0; i < win.days; i++) days.push({ start: addDays(win.from, i), items: [] });
  const dayIndex = (t: number): number => {
    for (let i = days.length - 1; i >= 0; i--) if (t >= days[i].start) return i;
    return -1;
  };

  if (show !== 'tasks') {
    for (const e of events) {
      if (e.endAt < win.from || e.startAt > win.to) continue;
      // On every day of the window it covers (a trip, a multi-day course).
      const first = Math.max(0, dayIndex(e.startAt));
      const lastAt = e.endAt > e.startAt ? e.endAt - 1 : e.endAt;
      const last = Math.max(first, dayIndex(Math.min(lastAt, win.to)));
      for (let i = first; i <= last; i++) {
        days[i].items.push({ kind: 'event', id: e.id, title: e.title, allDay: e.allDay, startAt: e.startAt, endAt: e.endAt, color: e.color });
      }
    }
  }
  if (show !== 'events') {
    for (const t of tasks) {
      if (t.dueAt === null || t.status === 'cancelled') continue;
      const done = t.status === 'done';
      if (t.dueAt < win.from) {
        // Overdue, not done: carried onto today when the window shows today.
        if (done || win.from !== today) continue;
        days[0].items.push({ kind: 'task', id: t.id, title: t.title, done, overdue: true, dueAt: t.dueAt, color: t.color });
        continue;
      }
      if (t.dueAt > win.to) continue;
      const i = dayIndex(t.dueAt);
      if (i < 0) continue;
      days[i].items.push({ kind: 'task', id: t.id, title: t.title, done, overdue: false, dueAt: t.dueAt, color: t.color });
    }
  }

  const rank = (it: AgendaItem): number => (it.kind === 'event' ? (it.allDay ? 0 : 1) : (it.overdue ? 2 : 3));
  const at = (it: AgendaItem): number => (it.kind === 'event' ? it.startAt : it.dueAt);
  for (const d of days) d.items.sort((a, b) => rank(a) - rank(b) || at(a) - at(b) || a.title.localeCompare(b.title));
  return days.filter((d) => d.items.length > 0);
}

export function agendaDayLabel(start: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  if (start === today) return 'Today';
  if (start === addDays(today, 1)) return 'Tomorrow';
  return appDateString(start, { weekday: 'long', month: 'short', day: 'numeric' });
}

function timeOf(t: number): string {
  return appTimeString(t, { hour: 'numeric', minute: '2-digit' });
}

export function agendaTimeLabel(it: AgendaItem): string {
  if (it.kind === 'task') return it.overdue ? `Due ${appDateString(it.dueAt, { month: 'short', day: 'numeric' })}` : '';
  if (it.allDay) return 'All day';
  return `${timeOf(it.startAt)} – ${timeOf(it.endAt)}`;
}

export interface AgendaData {
  listEvents(q: { from: number; to: number; limit?: number }): Promise<readonly AgendaEventLike[]>;
  listTasks(q: { status?: readonly ('reviewing' | 'planned' | 'done' | 'cancelled')[]; dueFrom?: number; dueTo?: number; limit?: number }): Promise<readonly AgendaTaskLike[]>;
  updateTask(id: string, patch: { status?: 'reviewing' | 'planned' | 'done' | 'cancelled'; completedAt?: number | null }): Promise<unknown>;
  onDidChange(listener: () => void): IDisposable;
}

/** The registration the Planner hands to `api.canvas.registerBlock`. */
export function agendaBlock(data: AgendaData, openPlanner: () => void): CanvasBlockRegistration {
  return {
    typeId: 'parallx.planner.agenda',
    label: 'Agenda',
    description: "Today's events and tasks from the planner",
    icon: 'calendar-check',
    defaultConfig: { range: 'today', show: 'all' },
    settings: {
      title: 'Agenda',
      fields: {
        range: { type: 'enum', label: 'Days', options: AGENDA_RANGES },
        show: { type: 'enum', label: 'Include', options: AGENDA_SHOWS },
      },
    },
    readable: (config) => `[Agenda: ${AGENDA_RANGES.find((r) => r.value === config.range)?.label ?? 'Today'}]`,
    render(body, ctx) {
      body.classList.add('planner-agenda');
      ctx.setActions([{ label: 'Open Planner', run: openPlanner }]);
      let config = ctx.config;
      let seq = 0;
      let disposed = false;
      let changeTimer: ReturnType<typeof setTimeout> | null = null;
      let dayTimer: ReturnType<typeof setTimeout> | null = null;

      const row = (it: AgendaItem): HTMLElement => {
        const r = document.createElement('div');
        r.className = `planner-agenda__item planner-agenda__item--${it.kind}`;
        if (it.kind === 'task') {
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.className = 'planner-agenda__check';
          box.checked = it.done;
          box.setAttribute('aria-label', it.done ? `Mark “${it.title}” not done` : `Mark “${it.title}” done`);
          box.addEventListener('change', () => {
            r.classList.toggle('planner-agenda__item--done', box.checked);
            void data.updateTask(it.id, box.checked ? { status: 'done', completedAt: Date.now() } : { status: 'planned', completedAt: null })
              .catch(() => { box.checked = !box.checked; r.classList.toggle('planner-agenda__item--done', box.checked); });
          });
          r.appendChild(box);
          if (it.done) r.classList.add('planner-agenda__item--done');
          if (it.overdue) r.classList.add('planner-agenda__item--overdue');
        } else {
          const dot = document.createElement('span');
          dot.className = 'planner-agenda__dot';
          if (it.color) dot.style.background = it.color;
          r.appendChild(dot);
        }
        const name = document.createElement('button');
        name.type = 'button';
        name.className = 'planner-agenda__name';
        name.textContent = it.title || (it.kind === 'task' ? 'Untitled task' : 'Untitled event');
        name.title = 'Open the planner';
        name.addEventListener('click', openPlanner);
        r.appendChild(name);
        const when = agendaTimeLabel(it);
        if (when) {
          const w = document.createElement('span');
          w.className = 'planner-agenda__when';
          w.textContent = when;
          r.appendChild(w);
        }
        return r;
      };

      const render = async (): Promise<void> => {
        const mine = ++seq;
        const range = String(config.range ?? 'today');
        const show = String(config.show ?? 'all');
        ctx.setTitle(AGENDA_RANGES.find((r) => r.value === range)?.label ?? 'Today');
        const win = agendaWindow(range);
        const [events, inWindow, overdue] = await Promise.all([
          show === 'tasks' ? [] : data.listEvents({ from: win.from, to: win.to }).catch(() => []),
          show === 'events' ? [] : data.listTasks({ status: ['planned', 'reviewing', 'done'], dueFrom: win.from, dueTo: win.to, limit: 200 }).catch(() => []),
          show === 'events' || range === 'tomorrow' ? [] : data.listTasks({ status: ['planned', 'reviewing'], dueFrom: 0, dueTo: win.from - 1, limit: 50 }).catch(() => []),
        ]);
        if (disposed || mine !== seq) return;
        const days = buildAgenda(events, [...overdue, ...inWindow], range, show);
        if (!days.length) {
          ctx.showNote(show === 'events' ? 'No events.' : show === 'tasks' ? 'No tasks due.' : 'Nothing planned.');
        } else {
          body.innerHTML = '';
          for (const d of days) {
            if (range === 'week') {
              const h = document.createElement('div');
              h.className = 'planner-agenda__day';
              h.textContent = agendaDayLabel(d.start);
              body.appendChild(h);
            }
            for (const it of d.items) body.appendChild(row(it));
          }
        }
        // Today becomes yesterday at midnight: move on with it.
        if (dayTimer) clearTimeout(dayTimer);
        dayTimer = setTimeout(() => void render(), Math.max(1000, addDays(startOfDay(Date.now()), 1) - Date.now() + 1000));
      };

      // A sync brings many changes at once: read once they settle.
      const sub = data.onDidChange(() => {
        if (changeTimer) clearTimeout(changeTimer);
        changeTimer = setTimeout(() => void render(), 250);
      });
      void render();

      return {
        update(next) { config = next; void render(); },
        dispose() {
          disposed = true;
          sub.dispose();
          if (changeTimer) clearTimeout(changeTimer);
          if (dayTimer) clearTimeout(dayTimer);
        },
      };
    },
  };
}
