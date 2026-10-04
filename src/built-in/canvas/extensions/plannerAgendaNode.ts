// plannerAgendaNode.ts — Agenda: the planner's day (or week) in a page
//
// Shows events and tasks from the planner for today, tomorrow or the next
// seven days, kept current as the planner changes. Tick a task to mark it
// done (untick to put it back); click anything else to open the planner.
// Overdue tasks that are not done show at the top of today.
//
// Reads the planner through its `planner.getRegistry` command, so a page
// works without the planner (it says so) and never imports it.

import { Node, mergeAttributes } from '@tiptap/core';
import {
  type LiveBlockOptions, openBlockPopover, popoverRow, selectControl, blockEditButton, setBlockAttrs,
  focusBlock, askTool, retrySoon,
} from './liveBlock.js';

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
interface PlannerDataLike {
  listEvents(q: { from: number; to: number; limit?: number }): Promise<AgendaEventLike[]>;
  listTasks(q: { status?: readonly string[]; dueFrom?: number; dueTo?: number; limit?: number }): Promise<AgendaTaskLike[]>;
  updateTask(id: string, patch: { status?: string; completedAt?: number | null }): Promise<unknown>;
  onDidChange(listener: () => void): { dispose(): void };
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Adds whole calendar days (a day across a clock change is not 24 hours). */
function addDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
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
  return new Date(start).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function timeOf(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function agendaTimeLabel(it: AgendaItem): string {
  if (it.kind === 'task') return it.overdue ? `Due ${new Date(it.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
  if (it.allDay) return 'All day';
  return `${timeOf(it.startAt)} – ${timeOf(it.endAt)}`;
}

async function plannerData(live: LiveBlockOptions['live']): Promise<PlannerDataLike | null> {
  const reg = await askTool<{ data?: PlannerDataLike } | null>(live, 'planner.getRegistry');
  const data = reg.ok ? reg.value?.data : undefined;
  return data && typeof data.listEvents === 'function' && typeof data.listTasks === 'function' ? data : null;
}

export const PlannerAgenda = Node.create<LiveBlockOptions>({
  name: 'plannerAgenda',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() { return { live: undefined }; },

  addAttributes() {
    return {
      range: { default: 'today' },
      show: { default: 'all' },
    };
  },

  parseHTML() { return [{ tag: 'div[data-type="plannerAgenda"]' }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'plannerAgenda', class: 'canvas-agenda' })];
  },

  addNodeView() {
    const live = this.options.live;
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'canvas-agenda';
      dom.setAttribute('data-type', 'plannerAgenda');
      dom.contentEditable = 'false';
      const bar = document.createElement('div');
      bar.className = 'canvas-agenda__bar';
      const title = document.createElement('span');
      title.className = 'canvas-agenda__title';
      const open = blockEditButton('Open Planner');
      open.addEventListener('click', () => void askTool(live, 'planner.open'));
      const edit = blockEditButton('Edit…');
      bar.append(title, open, edit);
      const body = document.createElement('div');
      body.className = 'canvas-agenda__body';
      body.setAttribute('aria-live', 'polite');
      dom.append(bar, body);

      let data: PlannerDataLike | null = null;
      let dataSub: { dispose(): void } | null = null;
      let stopRetry = (): void => {};
      let dayTimer: ReturnType<typeof setTimeout> | null = null;
      let changeTimer: ReturnType<typeof setTimeout> | null = null;
      let seq = 0;
      let destroyed = false;

      const note = (text: string): void => {
        body.innerHTML = '';
        const n = document.createElement('div');
        n.className = 'canvas-agenda__note';
        n.textContent = text;
        body.appendChild(n);
      };

      const paint = (days: AgendaDay[]): void => {
        body.innerHTML = '';
        const show = String(current.attrs.show);
        if (!days.length) {
          note(show === 'events' ? 'No events.' : show === 'tasks' ? 'No tasks due.' : 'Nothing planned.');
          return;
        }
        const multi = String(current.attrs.range) === 'week';
        for (const d of days) {
          if (multi) {
            const h = document.createElement('div');
            h.className = 'canvas-agenda__day';
            h.textContent = agendaDayLabel(d.start);
            body.appendChild(h);
          }
          for (const it of d.items) body.appendChild(row(it));
        }
      };

      const row = (it: AgendaItem): HTMLElement => {
        const r = document.createElement('div');
        r.className = `canvas-agenda__item canvas-agenda__item--${it.kind}`;
        if (it.kind === 'task') {
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.className = 'canvas-agenda__check';
          box.checked = it.done;
          box.setAttribute('aria-label', it.done ? `Mark “${it.title}” not done` : `Mark “${it.title}” done`);
          box.addEventListener('change', () => {
            if (!data) return;
            r.classList.toggle('canvas-agenda__item--done', box.checked);
            void data.updateTask(it.id, box.checked ? { status: 'done', completedAt: Date.now() } : { status: 'planned', completedAt: null })
              .catch(() => { box.checked = !box.checked; r.classList.toggle('canvas-agenda__item--done', box.checked); });
          });
          r.appendChild(box);
          if (it.done) r.classList.add('canvas-agenda__item--done');
          if (it.overdue) r.classList.add('canvas-agenda__item--overdue');
        } else {
          const dot = document.createElement('span');
          dot.className = 'canvas-agenda__dot';
          if (it.color) dot.style.background = it.color;
          r.appendChild(dot);
        }
        const name = document.createElement('button');
        name.type = 'button';
        name.className = 'canvas-agenda__name';
        name.textContent = it.title || (it.kind === 'task' ? 'Untitled task' : 'Untitled event');
        name.title = 'Open the planner';
        name.addEventListener('click', () => void askTool(live, 'planner.open'));
        r.appendChild(name);
        const when = agendaTimeLabel(it);
        if (when) {
          const w = document.createElement('span');
          w.className = 'canvas-agenda__when';
          w.textContent = when;
          r.appendChild(w);
        }
        return r;
      };

      const render = async (attempt = 0): Promise<void> => {
        const mine = ++seq;
        const range = String(current.attrs.range);
        const show = String(current.attrs.show);
        title.textContent = AGENDA_RANGES.find((r) => r.value === range)?.label ?? 'Today';
        if (!data) {
          data = await plannerData(live);
          if (destroyed || mine !== seq) return;
          if (!data) {
            note('The planner is not available.');
            stopRetry = retrySoon(() => void render(attempt + 1), attempt);
            return;
          }
          // A sync brings many changes at once: read once they settle.
          dataSub = data.onDidChange?.(() => {
            if (changeTimer) clearTimeout(changeTimer);
            changeTimer = setTimeout(() => void render(), 250);
          });
        }
        const win = agendaWindow(range);
        const [events, inWindow, overdue] = await Promise.all([
          show === 'tasks' ? [] : data.listEvents({ from: win.from, to: win.to }).catch(() => []),
          show === 'events' ? [] : data.listTasks({ status: ['planned', 'reviewing', 'done'], dueFrom: win.from, dueTo: win.to, limit: 200 }).catch(() => []),
          show === 'events' || range === 'tomorrow' ? [] : data.listTasks({ status: ['planned', 'reviewing'], dueFrom: 0, dueTo: win.from - 1, limit: 50 }).catch(() => []),
        ]);
        if (destroyed || mine !== seq) return;
        paint(buildAgenda(events, [...overdue, ...inWindow], range, show));
        // Today becomes yesterday at midnight: move on with it.
        if (dayTimer) clearTimeout(dayTimer);
        dayTimer = setTimeout(() => void render(), Math.max(1000, addDays(startOfDay(Date.now()), 1) - Date.now() + 1000));
      };
      void render();

      edit.addEventListener('click', () => {
        if (!editor.isEditable) return;
        openBlockPopover(edit, 'Agenda', (pop, close) => {
          const range = selectControl(AGENDA_RANGES, String(current.attrs.range));
          range.setAttribute('aria-label', 'Show');
          popoverRow(pop, 'Days', range);
          const show = selectControl(AGENDA_SHOWS, String(current.attrs.show));
          show.setAttribute('aria-label', 'Include');
          popoverRow(pop, 'Include', show);
          const done = document.createElement('button');
          done.type = 'button';
          done.className = 'canvas-live-popover__primary';
          done.textContent = 'Done';
          done.addEventListener('click', () => { setBlockAttrs(editor, getPos, { range: range.value, show: show.value }); close(); });
          pop.appendChild(done);
        }, () => focusBlock(editor, getPos));
      });

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== 'plannerAgenda') return false;
          const changed = updated.attrs.range !== current.attrs.range || updated.attrs.show !== current.attrs.show;
          current = updated;
          if (changed) void render();
          return true;
        },
        stopEvent: (e: Event) => {
          const t = e.target as HTMLElement | null;
          return !!t && (t.tagName === 'INPUT' || !!t.closest?.('button'));
        },
        ignoreMutation: () => true,
        destroy() {
          destroyed = true;
          stopRetry();
          dataSub?.dispose();
          if (dayTimer) clearTimeout(dayTimer);
          if (changeTimer) clearTimeout(changeTimer);
        },
      };
    };
  },
});
