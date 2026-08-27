// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  YEAR_PROGRESS_WIDGET,
  measureYearProgress,
  normalizeYearProgressConfig,
  type YearProgressConfig,
} from '../../src/built-in/dashboard/widgets/yearProgressWidget';
import { Emitter } from '../../src/platform/events';
import type { WidgetContext } from '../../src/built-in/dashboard/dashboardTypes';

/** A minimal context: the widget only reads config and the change event. */
function makeCtx(config: Partial<YearProgressConfig>): {
  ctx: WidgetContext<YearProgressConfig>;
  change: Emitter<YearProgressConfig>;
} {
  const change = new Emitter<YearProgressConfig>();
  const ctx = {
    instanceId: 'widget_year_1',
    pageId: 'page_1',
    config: config as YearProgressConfig,
    api: {},
    cachedOutput: null,
    errorMessage: null,
    onDidChangeConfig: change.event,
    requestRefresh: () => {},
    setCachedOutput: () => {},
    setError: () => {},
    clearError: () => {},
  } as unknown as WidgetContext<YearProgressConfig>;
  return { ctx, change };
}

function mount(config: Partial<YearProgressConfig>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const { ctx, change } = makeCtx(config);
  const handle = YEAR_PROGRESS_WIDGET.createWidget(container, ctx);
  return { container, handle, change };
}

describe('yearProgress config normalization', () => {
  it('fills every field from an empty config', () => {
    expect(normalizeYearProgressConfig(undefined)).toEqual({
      layout: 'inline',
      barStyle: 'bar',
      color: 'neutral',
      precision: '1',
      showCaption: true,
      showMonth: false,
      showWeek: false,
      showDay: false,
    });
  });

  it('rejects values outside each option set rather than passing them to the DOM', () => {
    const cfg = normalizeYearProgressConfig({
      layout: 'diagonal',
      barStyle: 'rainbow',
      color: '#ff0000',
      precision: '9',
    });
    expect(cfg.layout).toBe('inline');
    expect(cfg.barStyle).toBe('bar');
    expect(cfg.color).toBe('neutral');
    expect(cfg.precision).toBe('1');
  });

  it('keeps the caption for instances saved before the option existed', () => {
    // The old config shape — the caption was unconditional then.
    expect(normalizeYearProgressConfig({ showMonth: false, showDay: false }).showCaption).toBe(true);
    expect(normalizeYearProgressConfig({ showCaption: false }).showCaption).toBe(false);
  });

  it('carries the old row toggles forward', () => {
    const cfg = normalizeYearProgressConfig({ showMonth: true, showDay: true });
    expect(cfg.showMonth).toBe(true);
    expect(cfg.showDay).toBe(true);
    expect(cfg.showWeek).toBe(false);
  });
});

describe('yearProgress measurement', () => {
  it('counts Jan 1 as day 1 and Dec 31 as the last day', () => {
    expect(measureYearProgress(new Date(2026, 0, 1, 12)).dayOfYear).toBe(1);
    const end = measureYearProgress(new Date(2026, 11, 31, 12));
    expect(end.dayOfYear).toBe(365);
    expect(end.daysInYear).toBe(365);
  });

  it('knows a leap year has 366 days', () => {
    expect(measureYearProgress(new Date(2028, 5, 1)).daysInYear).toBe(366);
  });

  it('starts the week on Monday', () => {
    // 2026-08-25 is a Tuesday: one full day plus the current one elapsed.
    const tuesdayNoon = measureYearProgress(new Date(2026, 7, 25, 12));
    expect(tuesdayNoon.units.week.progress).toBeCloseTo(1.5 / 7, 5);
  });

  it('divides each unit into the divisions it actually has', () => {
    const m = measureYearProgress(new Date(2026, 1, 10)); // February
    expect(m.units.year.segments).toBe(12);
    expect(m.units.week.segments).toBe(7);
    expect(m.units.day.segments).toBe(24);
    expect(m.units.month.segments).toBe(28);
  });

  it('clamps progress into [0, 1] at both ends of the year', () => {
    const start = measureYearProgress(new Date(2026, 0, 1, 0, 0, 0));
    expect(start.units.year.progress).toBeGreaterThanOrEqual(0);
    const end = measureYearProgress(new Date(2026, 11, 31, 23, 59));
    expect(end.units.year.progress).toBeLessThanOrEqual(1);
  });
});

describe('yearProgress rendering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 25, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('stamps layout, style and color on the root so CSS owns every variant', () => {
    const { container, handle } = mount({ layout: 'detail', barStyle: 'pill', color: 'green' });
    expect(container.dataset.layout).toBe('detail');
    expect(container.dataset.style).toBe('pill');
    expect(container.dataset.color).toBe('green');
    handle.dispose();
  });

  it('puts the number at the end of the bar in the inline layout', () => {
    const { container, handle } = mount({ layout: 'inline' });
    const line = container.querySelector('.ypw__line');
    expect(line).not.toBeNull();
    const classes = Array.from(line!.children).map((c) => c.className);
    expect(classes).toEqual(['ypw__label', 'ypw__track', 'ypw__pct']);
    handle.dispose();
  });

  it('hides the day count when the caption is off, and shows it when on', () => {
    const off = mount({ showCaption: false });
    expect(off.container.querySelector('.ypw__caption')).toBeNull();
    off.handle.dispose();

    const on = mount({ showCaption: true });
    const caption = on.container.querySelector('.ypw__caption');
    expect(caption?.textContent).toBe('Day 237 of 365, 128 to go');
    on.handle.dispose();
  });

  it('renders the endpoints and the three counts in the detail layout', () => {
    const { container, handle } = mount({ layout: 'detail', showCaption: true });
    const ends = Array.from(container.querySelectorAll('.ypw__end')).map((e) => e.textContent);
    expect(ends).toEqual(['Jan 1', 'Dec 31']);
    const nums = Array.from(container.querySelectorAll('.ypw__stat-n')).map((e) => e.textContent);
    expect(nums).toEqual(['237', '128', '365']);
    const labels = Array.from(container.querySelectorAll('.ypw__stat-l')).map((e) => e.textContent);
    expect(labels).toEqual(['days passed', 'days remaining', 'days (year)']);
    handle.dispose();
  });

  it('drops the counts in the detail layout when the caption is off', () => {
    const { container, handle } = mount({ layout: 'detail', showCaption: false });
    expect(container.querySelector('.ypw__stats')).toBeNull();
    expect(container.querySelectorAll('.ypw__end')).toHaveLength(2);
    handle.dispose();
  });

  it('orders enabled rows smallest first, with the year last', () => {
    const { container, handle } = mount({ showDay: true, showWeek: true, showMonth: true });
    const labels = Array.from(container.querySelectorAll('.ypw__label')).map((e) => e.textContent);
    expect(labels).toEqual(['Day', 'Week', 'August', '2026']);
    handle.dispose();
  });

  it('captions only the year, because the count is a count of days of the year', () => {
    const { container, handle } = mount({ showDay: true, showMonth: true, showCaption: true });
    expect(container.querySelectorAll('.ypw__caption')).toHaveLength(1);
    handle.dispose();
  });

  it('honours the decimal-places choice', () => {
    for (const [precision, expected] of [['0', '65%'], ['1', '64.8%'], ['2', '64.78%']] as const) {
      const { container, handle } = mount({ precision });
      expect(container.querySelector('.ypw__pct')?.textContent).toBe(expected);
      handle.dispose();
    }
  });

  it('cuts the bar into real divisions in the segments style', () => {
    const { container, handle } = mount({ barStyle: 'segments' });
    const segs = container.querySelectorAll('.ypw__seg');
    expect(segs).toHaveLength(12); // months of the year
    // Late August is 7.77 months in: seven full, the eighth partial, four empty.
    const widths = Array.from(container.querySelectorAll<HTMLElement>('.ypw__segfill'))
      .map((e) => e.style.width);
    expect(widths.slice(0, 7).every((w) => w === '100%')).toBe(true);
    expect(widths.slice(8)).toEqual(['0%', '0%', '0%', '0%']);
    expect(widths[7]).not.toBe('0%');
    expect(widths[7]).not.toBe('100%');
    handle.dispose();
  });

  it('rebuilds on a config change instead of stacking a second copy', () => {
    const { container, handle, change } = mount({ layout: 'inline' });
    expect(container.querySelectorAll('.ypw__row')).toHaveLength(1);
    change.fire({ layout: 'detail', showWeek: true } as YearProgressConfig);
    expect(container.dataset.layout).toBe('detail');
    expect(container.querySelectorAll('.ypw__row')).toHaveLength(2);
    handle.dispose();
  });

  it('moves the fill on tick without rebuilding the DOM', () => {
    const { container, handle } = mount({ layout: 'inline' });
    const fill = container.querySelector<HTMLElement>('.ypw__fill')!;
    const before = fill.style.width;
    vi.advanceTimersByTime(60_000);
    // Same element — a rebuild would have replaced it.
    expect(container.querySelector('.ypw__fill')).toBe(fill);
    expect(fill.style.width).not.toBe(before);
    handle.dispose();
  });

  it('stops ticking once disposed', () => {
    const { container, handle } = mount({});
    const fill = container.querySelector<HTMLElement>('.ypw__fill')!;
    handle.dispose();
    const after = fill.style.width;
    vi.advanceTimersByTime(600_000);
    expect(fill.style.width).toBe(after);
  });
});
