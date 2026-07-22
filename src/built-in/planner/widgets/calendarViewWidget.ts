// calendarViewWidget.ts — month/week/day calendar widget.
//
// Configurable per instance via `view`. Renders a compact grid showing
// event dots (month), short bars (week), or detailed bars (day).

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../../dashboard/dashboardTypes.js';
import type { PlannerDataService } from '../plannerDataService.js';
import type { PlannerEvent } from '../plannerTypes.js';

type View = 'month' | 'week' | 'day';

interface Config {
  readonly view: View;
}

const DEFAULT_CONFIG: Config = { view: 'month' };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

function startOfDay(d: Date): Date { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }
function endOfDay(d: Date): Date { const c = new Date(d); c.setHours(23, 59, 59, 999); return c; }
function startOfWeek(d: Date): Date { const c = startOfDay(d); c.setDate(c.getDate() - c.getDay()); return c; }
function startOfMonth(d: Date): Date { const c = startOfDay(d); c.setDate(1); return c; }
function endOfMonth(d: Date): Date { const c = startOfMonth(d); c.setMonth(c.getMonth() + 1); c.setMilliseconds(-1); return c; }
function addDays(d: Date, n: number): Date { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function buildCalendarViewWidget(data: PlannerDataService): WidgetTypeRegistration<Config> {
  return {
    typeId: 'parallx.planner.calendar-view',
    displayName: 'Calendar',
    description: 'Month / week / day calendar view. Configure per instance — month is glanceable; day shows detail.',
    icon: ICON_SVG,
    category: 'query',
    defaultSize: { colSpan: 8, rowSpan: 4 },
    defaultConfig: DEFAULT_CONFIG,
    configSchema: {
      fields: {
        view: {
          type: 'enum',
          label: 'View',
          options: [
            { value: 'month', label: 'Month' },
            { value: 'week',  label: 'Week' },
            { value: 'day',   label: 'Day' },
          ],
        },
      },
    },
    defaultRefreshPolicy: { kind: 'interval', ms: 60_000 },

    async refresh(ctx: WidgetRefreshContext<Config>): Promise<string> {
      const view = (ctx.config?.view ?? 'month') as View;
      const now = new Date();
      let from: number, to: number;
      if (view === 'month') {
        from = startOfMonth(now).getTime();
        to = endOfMonth(now).getTime();
      } else if (view === 'week') {
        const start = startOfWeek(now);
        from = start.getTime();
        to = addDays(start, 7).getTime();
      } else {
        from = startOfDay(now).getTime();
        to = endOfDay(now).getTime();
      }
      const events = await data.listEvents({ from, to, limit: 500 });
      return JSON.stringify({ view, events });
    },

    createWidget(container: HTMLElement, ctx: WidgetContext<Config>): WidgetHandle {
      container.classList.add('pl-cal');

      const surface = document.createElement('div');
      surface.className = 'pl-cal__surface';
      container.appendChild(surface);

      function paint(cached: string | null): void {
        surface.innerHTML = '';
        let view: View = 'month';
        let events: PlannerEvent[] = [];
        try {
          if (cached) {
            const parsed = JSON.parse(cached) as { view?: View; events?: PlannerEvent[] };
            if (parsed.view) view = parsed.view;
            if (Array.isArray(parsed.events)) events = parsed.events;
          }
        } catch { /* malformed */ }

        if (view === 'month') paintMonth(surface, events);
        else if (view === 'week') paintWeek(surface, events);
        else paintDay(surface, events);

        surface.addEventListener('click', () => {
          const api = ctx.api as { commands?: { executeCommand(id: string): Promise<unknown> } };
          api?.commands?.executeCommand?.('planner.open').catch(() => {});
        });
      }

      paint(ctx.cachedOutput);
      if (!ctx.cachedOutput) ctx.requestRefresh();

      return {
        refreshFromCache(cached: string | null) { paint(cached); },
        dispose() { /* noop */ },
      };
    },
  };
}

function paintMonth(host: HTMLElement, events: PlannerEvent[]): void {
  const grid = document.createElement('div');
  grid.className = 'pl-cal__month';

  const weekdayRow = document.createElement('div');
  weekdayRow.className = 'pl-cal__weekdays';
  for (const wd of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
    const c = document.createElement('div');
    c.className = 'pl-cal__weekday';
    c.textContent = wd;
    weekdayRow.appendChild(c);
  }
  grid.appendChild(weekdayRow);

  const cellsEl = document.createElement('div');
  cellsEl.className = 'pl-cal__cells';
  const now = new Date();
  const first = startOfMonth(now);
  const gridStart = startOfWeek(first);
  const last = endOfMonth(now);
  const gridEnd = addDays(startOfWeek(last), 6);
  const total = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;

  for (let i = 0; i < total; i++) {
    const day = addDays(gridStart, i);
    const dayStart = startOfDay(day).getTime();
    const dayEnd = endOfDay(day).getTime();
    const dayCount = events.filter(ev => ev.startAt <= dayEnd && ev.endAt >= dayStart).length;

    const cell = document.createElement('div');
    cell.className = 'pl-cal__cell';
    if (day.getMonth() !== now.getMonth()) cell.classList.add('pl-cal__cell--other');
    if (sameDay(day, now)) cell.classList.add('pl-cal__cell--today');

    const num = document.createElement('span');
    num.className = 'pl-cal__num';
    num.textContent = String(day.getDate());
    cell.appendChild(num);

    if (dayCount > 0) {
      const dots = document.createElement('span');
      dots.className = 'pl-cal__dots';
      const shown = Math.min(3, dayCount);
      for (let j = 0; j < shown; j++) {
        const dot = document.createElement('span');
        dot.className = 'pl-cal__dot';
        dots.appendChild(dot);
      }
      if (dayCount > 3) {
        const extra = document.createElement('span');
        extra.className = 'pl-cal__more';
        extra.textContent = `+${dayCount - 3}`;
        dots.appendChild(extra);
      }
      cell.appendChild(dots);
    }
    cellsEl.appendChild(cell);
  }
  grid.appendChild(cellsEl);
  host.appendChild(grid);
}

function paintWeek(host: HTMLElement, events: PlannerEvent[]): void {
  const grid = document.createElement('div');
  grid.className = 'pl-cal__week';

  const start = startOfWeek(new Date());
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const col = document.createElement('div');
    col.className = 'pl-cal__weekcol';
    if (sameDay(day, new Date())) col.classList.add('pl-cal__weekcol--today');

    const head = document.createElement('div');
    head.className = 'pl-cal__weekhead';
    head.innerHTML = `<span>${day.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>${day.getDate()}</strong>`;
    col.appendChild(head);

    const list = document.createElement('div');
    list.className = 'pl-cal__weeklist';
    const dayEvents = events
      .filter(ev => ev.startAt <= endOfDay(day).getTime() && ev.endAt >= startOfDay(day).getTime())
      .sort((a, b) => a.startAt - b.startAt);
    for (const ev of dayEvents.slice(0, 4)) {
      const chip = document.createElement('div');
      chip.className = 'pl-cal__weekchip';
      chip.innerHTML = `<span class="pl-cal__weekchip-time">${escapeHtml(ev.allDay ? '·' : fmtTime(ev.startAt))}</span><span class="pl-cal__weekchip-title">${escapeHtml(ev.title)}</span>`;
      list.appendChild(chip);
    }
    if (dayEvents.length > 4) {
      const more = document.createElement('span');
      more.className = 'pl-cal__weekmore';
      more.textContent = `+${dayEvents.length - 4}`;
      list.appendChild(more);
    }
    col.appendChild(list);
    grid.appendChild(col);
  }
  host.appendChild(grid);
}

function paintDay(host: HTMLElement, events: PlannerEvent[]): void {
  const wrap = document.createElement('div');
  wrap.className = 'pl-cal__day';
  const sorted = [...events].sort((a, b) => a.startAt - b.startAt);
  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pl-cal__empty';
    empty.innerHTML = '<strong>Nothing today</strong><p>Your calendar is clear.</p>';
    wrap.appendChild(empty);
  } else {
    for (const ev of sorted) {
      const row = document.createElement('div');
      row.className = 'pl-cal__dayrow';
      const time = document.createElement('span');
      time.className = 'pl-cal__daytime';
      time.textContent = ev.allDay ? 'All day' : `${fmtTime(ev.startAt)} – ${fmtTime(ev.endAt)}`;
      const main = document.createElement('span');
      main.className = 'pl-cal__daymain';
      const title = document.createElement('span');
      title.className = 'pl-cal__daytitle';
      title.textContent = ev.title;
      main.appendChild(title);
      if (ev.location) {
        const loc = document.createElement('span');
        loc.className = 'pl-cal__dayloc';
        loc.textContent = ev.location;
        main.appendChild(loc);
      }
      row.appendChild(time);
      row.appendChild(main);
      wrap.appendChild(row);
    }
  }
  host.appendChild(wrap);
}
