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
import { addAppDays, appDateParts, appDateString, appTime, appTimeString, isSameAppDay, startOfAppDay } from '../../../services/localTime.js';

type View = 'month' | 'week' | 'day';

interface Config {
  readonly view: View;
}

const DEFAULT_CONFIG: Config = { view: 'month' };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

// Days, weeks and months on the user's calendar (the app's Time Zone), as epoch ms.
function startOfDay(t: number): number { return startOfAppDay(t); }
function endOfDay(t: number): number { return addAppDays(startOfAppDay(t), 1) - 1; }
function startOfWeek(t: number): number { const c = startOfAppDay(t); return addAppDays(c, -appDateParts(c).weekday); }
function startOfMonth(t: number): number { const p = appDateParts(t); return appTime(p.year, p.month, 1); }
function endOfMonth(t: number): number { const p = appDateParts(t); return appTime(p.year, p.month + 1, 1) - 1; }
function addDays(t: number, n: number): number { return addAppDays(t, n); }

function fmtTime(ts: number): string {
  return appTimeString(ts, { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function buildCalendarViewWidget(data: PlannerDataService): WidgetTypeRegistration<Config> {
  return {
    typeId: 'parallx.planner.calendar-view',
    displayName: 'Calendar',
    description: 'Month / week / day calendar view. Configure per instance. Month is glanceable; day shows detail.',
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
      const now = Date.now();
      let from: number, to: number;
      if (view === 'month') {
        from = startOfMonth(now);
        to = endOfMonth(now);
      } else if (view === 'week') {
        const start = startOfWeek(now);
        from = start;
        to = addDays(start, 7);
      } else {
        from = startOfDay(now);
        to = endOfDay(now);
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
  const now = Date.now();
  const nowMonth = appDateParts(now).month;
  const first = startOfMonth(now);
  const gridStart = startOfWeek(first);
  const last = endOfMonth(now);
  const gridEnd = addDays(startOfWeek(last), 6);
  const total = Math.round((gridEnd - gridStart) / 86_400_000) + 1;

  for (let i = 0; i < total; i++) {
    const day = addDays(gridStart, i);
    const dayParts = appDateParts(day);
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    const dayCount = events.filter(ev => ev.startAt <= dayEnd && ev.endAt >= dayStart).length;

    const cell = document.createElement('div');
    cell.className = 'pl-cal__cell';
    if (dayParts.month !== nowMonth) cell.classList.add('pl-cal__cell--other');
    if (isSameAppDay(day, now)) cell.classList.add('pl-cal__cell--today');

    const num = document.createElement('span');
    num.className = 'pl-cal__num';
    num.textContent = String(dayParts.day);
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

  const now = Date.now();
  const start = startOfWeek(now);
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const col = document.createElement('div');
    col.className = 'pl-cal__weekcol';
    if (isSameAppDay(day, now)) col.classList.add('pl-cal__weekcol--today');

    const head = document.createElement('div');
    head.className = 'pl-cal__weekhead';
    head.innerHTML = `<span>${appDateString(day, { weekday: 'short' })}</span><strong>${appDateParts(day).day}</strong>`;
    col.appendChild(head);

    const list = document.createElement('div');
    list.className = 'pl-cal__weeklist';
    const dayEvents = events
      .filter(ev => ev.startAt <= endOfDay(day) && ev.endAt >= startOfDay(day))
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
