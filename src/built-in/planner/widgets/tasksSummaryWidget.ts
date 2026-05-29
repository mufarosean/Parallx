// tasksSummaryWidget.ts — dashboard widget showing pending / today /
// overdue counts + a short list of next-up tasks. Click → opens Planner.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../../dashboard/dashboardTypes.js';
import type { PlannerDataService } from '../plannerDataService.js';
import type { PlannerTask } from '../plannerTypes.js';

interface Config {
  readonly maxItems: number;
}
const DEFAULT_CONFIG: Config = { maxItems: 5 };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>';

interface SnapshotShape {
  readonly review: number;
  readonly today: number;
  readonly overdue: number;
  readonly done7d: number;
  readonly next: { id: string; title: string; dueAt: number | null; status: string }[];
}

function startOfDay(): number { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function endOfDay(): number { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }

async function buildSnapshot(data: PlannerDataService, max: number): Promise<SnapshotShape> {
  const [reviewing, planned, doneRecent] = await Promise.all([
    data.listTasks({ status: 'reviewing', includeUndated: true }),
    data.listTasks({ status: 'planned', includeUndated: true, limit: 200 }),
    data.listTasks({ status: 'done', orderBy: 'updated', limit: 100 }),
  ]);
  const today = planned.filter(t => t.dueAt && t.dueAt >= startOfDay() && t.dueAt <= endOfDay()).length;
  const overdue = planned.filter(t => t.dueAt && t.dueAt < startOfDay()).length;
  const done7d = doneRecent.filter(t => (t.completedAt ?? t.updatedAt) >= Date.now() - 7 * 86_400_000).length;
  const candidates = [...planned, ...reviewing]
    .filter(t => t.status !== 'done' && t.status !== 'cancelled')
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    .slice(0, Math.max(1, Math.min(20, max)));
  return {
    review: reviewing.length,
    today,
    overdue,
    done7d,
    next: candidates.map(t => ({ id: t.id, title: t.title, dueAt: t.dueAt, status: t.status })),
  };
}

function formatDue(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDate = d.toDateString() === now.toDateString();
  if (sameDate) return 'Today';
  const tom = new Date(); tom.setDate(tom.getDate() + 1);
  if (d.toDateString() === tom.toDateString()) return 'Tomorrow';
  const diff = ts - Date.now();
  if (diff < 0) return 'Overdue';
  if (diff < 7 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function buildTasksSummaryWidget(data: PlannerDataService): WidgetTypeRegistration<Config> {
  return {
    typeId: 'parallx.planner.tasks-summary',
    displayName: 'Tasks summary',
    description: 'Counts + next-up tasks. Click to open the Planner.',
    icon: ICON_SVG,
    category: 'query',
    defaultSize: { colSpan: 4, rowSpan: 3 },
    defaultConfig: DEFAULT_CONFIG,
    configSchema: {
      fields: {
        maxItems: { type: 'number', label: 'Next-up tasks to show', description: '1-12.' },
      },
    },
    defaultRefreshPolicy: { kind: 'interval', ms: 60_000 },

    async refresh(ctx: WidgetRefreshContext<Config>): Promise<string> {
      const max = typeof ctx.config?.maxItems === 'number' ? ctx.config.maxItems : DEFAULT_CONFIG.maxItems;
      const snap = await buildSnapshot(data, max);
      return JSON.stringify(snap);
    },

    createWidget(container: HTMLElement, ctx: WidgetContext<Config>): WidgetHandle {
      container.classList.add('pl-ts');

      const summary = document.createElement('div');
      summary.className = 'pl-ts__summary';
      container.appendChild(summary);

      const list = document.createElement('div');
      list.className = 'pl-ts__list';
      container.appendChild(list);

      const openLink = document.createElement('button');
      openLink.type = 'button';
      openLink.className = 'pl-ts__openlink';
      openLink.textContent = 'Open Planner →';
      openLink.addEventListener('click', () => {
        const api = ctx.api as { commands?: { executeCommand(id: string): Promise<unknown> } };
        api?.commands?.executeCommand?.('planner.open').catch(() => { /* noop */ });
      });
      container.appendChild(openLink);

      function paint(cached: string | null): void {
        if (!cached) {
          summary.innerHTML = '<span class="pl-ts__loading">Loading…</span>';
          list.innerHTML = '';
          return;
        }
        let snap: SnapshotShape;
        try { snap = JSON.parse(cached) as SnapshotShape; } catch { return; }

        summary.innerHTML = '';
        const tiles: { label: string; value: number; accent?: string }[] = [
          { label: 'Review', value: snap.review, accent: 'review' },
          { label: 'Today',  value: snap.today, accent: 'today' },
          { label: 'Overdue', value: snap.overdue, accent: snap.overdue > 0 ? 'overdue' : undefined },
          { label: 'Done 7d', value: snap.done7d },
        ];
        for (const t of tiles) {
          const tile = document.createElement('div');
          tile.className = 'pl-ts__tile';
          if (t.accent) tile.classList.add(`pl-ts__tile--${t.accent}`);
          const v = document.createElement('span');
          v.className = 'pl-ts__tile-value';
          v.textContent = String(t.value);
          const l = document.createElement('span');
          l.className = 'pl-ts__tile-label';
          l.textContent = t.label;
          tile.appendChild(v);
          tile.appendChild(l);
          summary.appendChild(tile);
        }

        list.innerHTML = '';
        if (snap.next.length === 0) {
          const empty = document.createElement('span');
          empty.className = 'pl-ts__empty';
          empty.textContent = 'No tasks yet — capture one in the Planner or via chat.';
          list.appendChild(empty);
        } else {
          for (const task of snap.next) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'pl-ts__row';
            if (task.status === 'reviewing') row.classList.add('pl-ts__row--review');
            if (task.dueAt && task.dueAt < Date.now()) row.classList.add('pl-ts__row--overdue');
            const titleEl = document.createElement('span');
            titleEl.className = 'pl-ts__row-title';
            titleEl.textContent = task.title;
            const meta = document.createElement('span');
            meta.className = 'pl-ts__row-meta';
            meta.textContent = formatDue(task.dueAt);
            row.appendChild(titleEl);
            row.appendChild(meta);
            row.addEventListener('click', () => {
              const api = ctx.api as { commands?: { executeCommand(id: string): Promise<unknown> } };
              api?.commands?.executeCommand?.('planner.open').catch(() => {});
            });
            list.appendChild(row);
          }
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

// Helper exported for the registration barrel.
export const TASKS_SUMMARY_TYPE_ID = 'parallx.planner.tasks-summary';
export type { PlannerTask };
