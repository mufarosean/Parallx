// yearProgressWidget.ts — how far through the year we are, as a quiet bar.
//
// Static + client-ticking, same family as the clock and countdown: no
// refresh handler, everything derives from the current time. Optionally
// stacks month and day bars under the year one.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface YearProgressConfig {
  readonly showMonth: boolean;
  readonly showDay: boolean;
}

const DEFAULT_CONFIG: YearProgressConfig = { showMonth: false, showDay: false };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="10" width="18" height="4" rx="2"/><path d="M3 5h10"/><path d="M3 19h6"/></svg>';

function normalizeConfig(raw: unknown): YearProgressConfig {
  const cfg = (raw ?? {}) as Partial<YearProgressConfig>;
  return { showMonth: cfg.showMonth === true, showDay: cfg.showDay === true };
}

/** Fraction elapsed between two moments, clamped to [0, 1]. */
function fraction(start: number, end: number, now: number): number {
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export const YEAR_PROGRESS_WIDGET: WidgetTypeRegistration<YearProgressConfig> = {
  typeId: 'parallx.dashboard.year-progress',
  displayName: 'Year Progress',
  description: 'How far through the year you are, as a quiet bar. Optionally the month and the day too.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 2 },
  chromeStyle: 'minimal',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      showMonth: { type: 'boolean', label: 'Show month progress' },
      showDay: { type: 'boolean', label: 'Show day progress' },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<YearProgressConfig>): WidgetHandle {
    container.classList.add('ypw');
    let config = normalizeConfig(ctx.config);

    function bar(label: string, pct: number, caption: string): string {
      const shown = Math.round(pct * 1000) / 10;
      return `<div class="ypw__row">
        <div class="ypw__head"><span class="ypw__label">${label}</span><span class="ypw__pct">${shown}%</span></div>
        <div class="ypw__track"><div class="ypw__fill" style="width:${shown}%"></div></div>
        <div class="ypw__caption">${caption}</div>
      </div>`;
    }

    function tick(): void {
      const now = new Date();
      const t = now.getTime();
      const year = now.getFullYear();
      const yearStart = new Date(year, 0, 1).getTime();
      const yearEnd = new Date(year + 1, 0, 1).getTime();
      const dayOfYear = Math.floor((t - yearStart) / 86_400_000) + 1;
      const daysInYear = Math.round((yearEnd - yearStart) / 86_400_000);

      const rows = [bar(String(year), fraction(yearStart, yearEnd, t),
        `Day ${dayOfYear} of ${daysInYear}, ${daysInYear - dayOfYear} to go`)];

      if (config.showMonth) {
        const monthStart = new Date(year, now.getMonth(), 1).getTime();
        const monthEnd = new Date(year, now.getMonth() + 1, 1).getTime();
        rows.push(bar(now.toLocaleDateString(undefined, { month: 'long' }),
          fraction(monthStart, monthEnd, t), ''));
      }
      if (config.showDay) {
        const dayStart = new Date(year, now.getMonth(), now.getDate()).getTime();
        rows.push(bar('Today', fraction(dayStart, dayStart + 86_400_000, t), ''));
      }
      container.innerHTML = rows.join('');
    }

    tick();
    const interval = setInterval(tick, 60_000);
    const sub = ctx.onDidChangeConfig((next) => { config = normalizeConfig(next); tick(); });

    return {
      dispose() {
        clearInterval(interval);
        sub.dispose();
      },
    };
  },
};
