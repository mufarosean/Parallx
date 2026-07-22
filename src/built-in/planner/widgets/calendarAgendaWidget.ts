// calendarAgendaWidget.ts — vertical agenda of upcoming events.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../../dashboard/dashboardTypes.js';
import type { PlannerDataService } from '../plannerDataService.js';

interface Config {
  readonly windowDays: number;
  readonly maxItems: number;
}
const DEFAULT_CONFIG: Config = { windowDays: 7, maxItems: 8 };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg>';

interface AgendaRow {
  readonly id: string;
  readonly title: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly location: string | null;
  readonly allDay: boolean;
}

function fmtDateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const tom = new Date(); tom.setDate(tom.getDate() + 1);
  if (d.toDateString() === tom.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function buildCalendarAgendaWidget(data: PlannerDataService): WidgetTypeRegistration<Config> {
  return {
    typeId: 'parallx.planner.calendar-agenda',
    displayName: 'Calendar agenda',
    description: 'Upcoming events for the next N days. Click to open the Planner calendar.',
    icon: ICON_SVG,
    category: 'query',
    defaultSize: { colSpan: 4, rowSpan: 3 },
    defaultConfig: DEFAULT_CONFIG,
    configSchema: {
      fields: {
        windowDays: { type: 'number', label: 'Days to show', description: '1-30. Default 7.' },
        maxItems:   { type: 'number', label: 'Max events',  description: '1-30. Default 8.' },
      },
    },
    defaultRefreshPolicy: { kind: 'interval', ms: 60_000 },

    async refresh(ctx: WidgetRefreshContext<Config>): Promise<string> {
      const cfg = {
        windowDays: clamp(ctx.config?.windowDays, 1, 30, DEFAULT_CONFIG.windowDays),
        maxItems: clamp(ctx.config?.maxItems, 1, 30, DEFAULT_CONFIG.maxItems),
      };
      const events = await data.listEvents({
        from: Date.now(),
        to: Date.now() + cfg.windowDays * 86_400_000,
        limit: cfg.maxItems,
      });
      const rows: AgendaRow[] = events.map(e => ({
        id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, location: e.location, allDay: e.allDay,
      }));
      return JSON.stringify({ rows });
    },

    createWidget(container: HTMLElement, ctx: WidgetContext<Config>): WidgetHandle {
      container.classList.add('pl-ag');
      const list = document.createElement('div');
      list.className = 'pl-ag__list';
      container.appendChild(list);

      function paint(cached: string | null): void {
        list.innerHTML = '';
        let rows: AgendaRow[] = [];
        try {
          if (cached) {
            const parsed = JSON.parse(cached) as { rows?: AgendaRow[] };
            rows = parsed.rows ?? [];
          }
        } catch { /* malformed */ }

        if (rows.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'pl-ag__empty';
          empty.innerHTML = '<strong>Nothing scheduled</strong><p>Add an event in the Planner calendar, or ask the AI to.</p>';
          list.appendChild(empty);
          return;
        }

        let lastDate = '';
        for (const row of rows) {
          const label = fmtDateLabel(row.startAt);
          if (label !== lastDate) {
            const header = document.createElement('div');
            header.className = 'pl-ag__daylabel';
            header.textContent = label;
            list.appendChild(header);
            lastDate = label;
          }
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'pl-ag__item';
          const time = document.createElement('span');
          time.className = 'pl-ag__time';
          time.textContent = row.allDay ? 'All day' : fmtTime(row.startAt);
          const main = document.createElement('span');
          main.className = 'pl-ag__main';
          const title = document.createElement('span');
          title.className = 'pl-ag__title';
          title.textContent = row.title;
          main.appendChild(title);
          if (row.location) {
            const loc = document.createElement('span');
            loc.className = 'pl-ag__loc';
            loc.textContent = row.location;
            main.appendChild(loc);
          }
          item.appendChild(time);
          item.appendChild(main);
          item.addEventListener('click', () => {
            const api = ctx.api as { commands?: { executeCommand(id: string): Promise<unknown> } };
            api?.commands?.executeCommand?.('planner.open').catch(() => {});
          });
          list.appendChild(item);
        }
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

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
