// trackerBoardWidget.ts — user-defined items × user-defined stages (M86 C3).
//
// The generic "where does each thing stand?" board. Items and stages are
// pure config; per-item stage assignments are user-owned state persisted in
// cached_output. One person tracks exam syllabus topics
// (unread → notes → practiced → mastered); another tracks insurance policies
// (active → renewal due → renewed) or job applications. Zero domain code.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface TrackerConfig {
  readonly items: readonly string[];
  readonly stages: readonly string[];
}

const DEFAULT_CONFIG: TrackerConfig = {
  items: [],
  stages: ['Not started', 'In progress', 'Done'],
};

interface TrackerState {
  /** item → stage index. Items not present default to stage 0. */
  statuses: Record<string, number>;
}

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/><path d="M8 8h8"/><path d="M8 16h5"/></svg>';

function parseState(cached: string | null): TrackerState {
  if (cached) {
    try {
      const p = JSON.parse(cached) as Partial<TrackerState>;
      if (p.statuses && typeof p.statuses === 'object') {
        const statuses: Record<string, number> = {};
        for (const [k, v] of Object.entries(p.statuses)) {
          if (typeof v === 'number' && Number.isFinite(v)) statuses[k] = Math.max(0, Math.floor(v));
        }
        return { statuses };
      }
    } catch { /* fresh */ }
  }
  return { statuses: {} };
}

function normalizeConfig(raw: unknown): TrackerConfig {
  const cfg = (raw ?? {}) as Partial<TrackerConfig>;
  const items = Array.isArray(cfg.items)
    ? cfg.items.map((s) => String(s).trim()).filter(Boolean).slice(0, 100)
    : [];
  const stages = Array.isArray(cfg.stages)
    ? cfg.stages.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    items,
    stages: stages.length >= 2 ? stages : DEFAULT_CONFIG.stages,
  };
}

export const TRACKER_BOARD_WIDGET: WidgetTypeRegistration<TrackerConfig> = {
  typeId: 'parallx.dashboard.tracker',
  displayName: 'Tracker board',
  description: 'Your items, your stages — click an item to advance it. Syllabus topics for one person, insurance renewals or job applications for another.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 4 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      items: {
        type: 'string-list',
        label: 'Items to track',
        description: 'One per line. Up to 100.',
      },
      stages: {
        type: 'string-list',
        label: 'Stages',
        description: 'In order, 2-8. Clicking an item cycles through them.',
      },
    },
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<TrackerConfig>): WidgetHandle {
    container.classList.add('dtracker');
    let cfg = normalizeConfig(ctx.config);
    let state = parseState(ctx.cachedOutput);

    const summary = document.createElement('div');
    summary.className = 'dtracker__summary';
    container.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'dtracker__list';
    container.appendChild(list);

    const stageOf = (item: string): number => {
      const s = state.statuses[item] ?? 0;
      return Math.min(s, cfg.stages.length - 1);
    };

    const render = (): void => {
      // Summary strip: proportional segments per stage.
      summary.innerHTML = '';
      if (cfg.items.length > 0) {
        const counts = cfg.stages.map(() => 0);
        for (const item of cfg.items) counts[stageOf(item)]++;
        const strip = document.createElement('div');
        strip.className = 'dtracker__strip';
        counts.forEach((count, i) => {
          if (count === 0) return;
          const seg = document.createElement('span');
          seg.className = 'dtracker__seg';
          seg.style.flexGrow = String(count);
          // Progress tint: later stages are stronger.
          seg.style.opacity = String(0.25 + 0.75 * (i / Math.max(1, cfg.stages.length - 1)));
          seg.title = `${cfg.stages[i]}: ${count}`;
          strip.appendChild(seg);
        });
        summary.appendChild(strip);
        const label = document.createElement('span');
        label.className = 'dtracker__count';
        const doneCount = counts[cfg.stages.length - 1];
        label.textContent = `${doneCount}/${cfg.items.length} ${cfg.stages[cfg.stages.length - 1].toLowerCase()}`;
        summary.appendChild(label);
      }

      list.innerHTML = '';
      if (cfg.items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dtracker__empty';
        empty.innerHTML = '<strong>Nothing to track yet</strong><p>Open settings and add the items you want to move through stages.</p>';
        list.appendChild(empty);
        return;
      }
      for (const item of cfg.items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dtracker__row';
        const si = stageOf(item);
        row.title = `${cfg.stages[si]} — click to advance`;

        const name = document.createElement('span');
        name.className = 'dtracker__name';
        name.textContent = item;
        row.appendChild(name);

        const chip = document.createElement('span');
        chip.className = 'dtracker__chip';
        chip.dataset.last = String(si === cfg.stages.length - 1);
        chip.style.opacity = String(0.45 + 0.55 * (si / Math.max(1, cfg.stages.length - 1)));
        chip.textContent = cfg.stages[si];
        row.appendChild(chip);

        row.addEventListener('click', () => {
          state.statuses[item] = (stageOf(item) + 1) % cfg.stages.length;
          ctx.setCachedOutput(JSON.stringify(state));
          render();
        });
        list.appendChild(row);
      }
    };

    render();

    const sub = ctx.onDidChangeConfig((next) => {
      cfg = normalizeConfig(next);
      render();
    });

    return {
      refreshFromCache(cached: string | null) {
        state = parseState(cached);
        render();
      },
      dispose() { sub.dispose(); },
    };
  },
};
