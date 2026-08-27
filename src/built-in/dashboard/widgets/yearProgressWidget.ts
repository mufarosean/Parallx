// yearProgressWidget.ts — how far through the year we are, as a quiet bar.
//
// Static + client-ticking, same family as the clock and countdown: no
// refresh handler, everything derives from the current time.
//
// The widget is a SHAPE the user chooses, not one fixed look. Three
// layouts (the number inline at the end of the bar, stacked above it, or
// the spare endpoint-and-stats treatment), four bar styles, six
// token-backed colors, and a toggle for every line of text. The DOM is
// built once per config and only the numbers move on the minute tick —
// that is what lets the fill animate instead of being re-created.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

// ─── Config ──────────────────────────────────────────────────────────────────

type YearProgressLayout = 'inline' | 'stacked' | 'detail';
type YearProgressBarStyle = 'bar' | 'slim' | 'pill' | 'segments';
type YearProgressColor = 'accent' | 'neutral' | 'green' | 'amber' | 'red' | 'blue';

export interface YearProgressConfig {
  readonly layout: YearProgressLayout;
  readonly barStyle: YearProgressBarStyle;
  readonly color: YearProgressColor;
  readonly precision: '0' | '1' | '2';
  readonly showCaption: boolean;
  readonly showMonth: boolean;
  readonly showWeek: boolean;
  readonly showDay: boolean;
}

const DEFAULT_CONFIG: YearProgressConfig = {
  layout: 'inline',
  barStyle: 'bar',
  color: 'neutral',
  precision: '1',
  showCaption: true,
  showMonth: false,
  showWeek: false,
  showDay: false,
};

const LAYOUTS: readonly YearProgressLayout[] = ['inline', 'stacked', 'detail'];
const BAR_STYLES: readonly YearProgressBarStyle[] = ['bar', 'slim', 'pill', 'segments'];
const COLORS: readonly YearProgressColor[] = ['accent', 'neutral', 'green', 'amber', 'red', 'blue'];
const PRECISIONS: readonly YearProgressConfig['precision'][] = ['0', '1', '2'];

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="10" width="18" height="4" rx="2"/><path d="M3 5h10"/><path d="M3 19h6"/></svg>';

/** Pick `value` if it is one of `allowed`, else `fallback`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeYearProgressConfig(raw: unknown): YearProgressConfig {
  const cfg = (raw ?? {}) as Partial<YearProgressConfig>;
  return {
    layout: oneOf(cfg.layout, LAYOUTS, DEFAULT_CONFIG.layout),
    barStyle: oneOf(cfg.barStyle, BAR_STYLES, DEFAULT_CONFIG.barStyle),
    color: oneOf(cfg.color, COLORS, DEFAULT_CONFIG.color),
    precision: oneOf(cfg.precision, PRECISIONS, DEFAULT_CONFIG.precision),
    // Absent means "an older instance saved before this option existed", and
    // the caption is what it had, so absent reads as true here and false for
    // the extra rows — which is exactly what those instances were showing.
    showCaption: cfg.showCaption !== false,
    showMonth: cfg.showMonth === true,
    showWeek: cfg.showWeek === true,
    showDay: cfg.showDay === true,
  };
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** Fraction elapsed between two moments, clamped to [0, 1]. */
function fraction(start: number, end: number, now: number): number {
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

type UnitId = 'day' | 'week' | 'month' | 'year';

interface Unit {
  readonly id: UnitId;
  readonly label: string;
  readonly progress: number;
  /** Discrete divisions the 'segments' style draws: hours, days, months. */
  readonly segments: number;
}

const DAY_MS = 86_400_000;

/** Midnight at the start of Monday of `now`'s week (ISO 8601 week start). */
function startOfWeek(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (midnight.getDay() + 6) % 7; // Sunday(0) → 6, Monday(1) → 0
  midnight.setDate(midnight.getDate() - offset);
  return midnight.getTime();
}

/** Every unit the widget can draw, smallest first, plus the year's day counts. */
export function measureYearProgress(now: Date): { units: Record<UnitId, Unit>; dayOfYear: number; daysInYear: number } {
  const t = now.getTime();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const monthStart = new Date(year, now.getMonth(), 1).getTime();
  const monthEnd = new Date(year, now.getMonth() + 1, 1).getTime();
  const dayStart = new Date(year, now.getMonth(), now.getDate()).getTime();
  const weekStart = startOfWeek(now);

  // Day-of-year by calendar dates rather than elapsed ms, so a DST shift
  // inside the year cannot round the count off by one.
  const dayOfYear = Math.round((dayStart - yearStart) / DAY_MS) + 1;
  const daysInYear = Math.round((yearEnd - yearStart) / DAY_MS);
  const daysInMonth = Math.round((monthEnd - monthStart) / DAY_MS);

  return {
    dayOfYear,
    daysInYear,
    units: {
      day: { id: 'day', label: 'Day', progress: fraction(dayStart, dayStart + DAY_MS, t), segments: 24 },
      week: { id: 'week', label: 'Week', progress: fraction(weekStart, weekStart + 7 * DAY_MS, t), segments: 7 },
      month: {
        id: 'month',
        label: now.toLocaleDateString(undefined, { month: 'long' }),
        progress: fraction(monthStart, monthEnd, t),
        segments: daysInMonth,
      },
      year: { id: 'year', label: String(year), progress: fraction(yearStart, yearEnd, t), segments: 12 },
    },
  };
}

// ─── DOM ─────────────────────────────────────────────────────────────────────

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A bar and the handle that moves it, for whichever style is configured. */
interface BarHandle {
  readonly element: HTMLElement;
  set(progress: number): void;
}

function createBar(style: YearProgressBarStyle, segments: number): BarHandle {
  if (style === 'segments') {
    const root = el('div', 'ypw__segs');
    const fills: HTMLElement[] = [];
    const count = Math.max(1, Math.min(60, segments));
    for (let i = 0; i < count; i++) {
      const seg = el('i', 'ypw__seg');
      const fill = el('i', 'ypw__segfill');
      seg.appendChild(fill);
      root.appendChild(seg);
      fills.push(fill);
    }
    return {
      element: root,
      set(progress) {
        // Each segment fills in turn: the ones behind the cursor are full,
        // the one under it is partial, the rest are empty.
        const cursor = progress * count;
        for (let i = 0; i < count; i++) {
          const pct = Math.min(1, Math.max(0, cursor - i)) * 100;
          fills[i].style.width = `${pct}%`;
        }
      },
    };
  }

  const track = el('div', 'ypw__track');
  const fill = el('div', 'ypw__fill');
  track.appendChild(fill);
  return {
    element: track,
    set(progress) { fill.style.width = `${progress * 100}%`; },
  };
}

/** Everything one tick has to write into a row. */
interface RowHandle {
  readonly element: HTMLElement;
  update(unit: Unit, pctText: string, caption: CaptionData): void;
}

interface CaptionData {
  readonly passed: number;
  readonly remaining: number;
  readonly total: number;
  readonly text: string;
}

function createRow(
  unit: Unit,
  config: YearProgressConfig,
  captioned: boolean,
): RowHandle {
  const bar = createBar(config.barStyle, unit.segments);

  // The spare treatment: the bar, its endpoints under it, then the day
  // counts. Year only — "Jan 1 → Dec 31" means nothing for a Tuesday.
  if (config.layout === 'detail' && unit.id === 'year') {
    const row = el('div', 'ypw__row ypw__row--detail');
    const ends = el('div', 'ypw__ends');
    const from = el('span', 'ypw__end', 'Jan 1');
    const to = el('span', 'ypw__end', 'Dec 31');
    ends.append(from, to);
    row.append(bar.element, ends);

    let stats: { passed: HTMLElement; remaining: HTMLElement; total: HTMLElement } | undefined;
    if (captioned) {
      const wrap = el('div', 'ypw__stats');
      const make = (label: string): HTMLElement => {
        const cell = el('div', 'ypw__stat');
        const num = el('div', 'ypw__stat-n', '0');
        cell.append(num, el('div', 'ypw__stat-l', label));
        wrap.appendChild(cell);
        return num;
      };
      stats = {
        passed: make('days passed'),
        remaining: make('days remaining'),
        total: make('days (year)'),
      };
      row.appendChild(wrap);
    }

    return {
      element: row,
      update(u, _pctText, cap) {
        bar.set(u.progress);
        if (stats) {
          stats.passed.textContent = String(cap.passed);
          stats.remaining.textContent = String(cap.remaining);
          stats.total.textContent = String(cap.total);
        }
      },
    };
  }

  // Stacked: label and number share a line above the bar (the older shape).
  if (config.layout === 'stacked') {
    const row = el('div', 'ypw__row ypw__row--stacked');
    const head = el('div', 'ypw__head');
    const label = el('span', 'ypw__label', unit.label);
    const pct = el('span', 'ypw__pct', '');
    head.append(label, pct);
    row.append(head, bar.element);
    const caption = captioned ? el('div', 'ypw__caption', '') : undefined;
    if (caption) row.appendChild(caption);

    return {
      element: row,
      update(u, pctText, cap) {
        label.textContent = u.label;
        pct.textContent = pctText;
        bar.set(u.progress);
        if (caption) caption.textContent = cap.text;
      },
    };
  }

  // Inline (the default): label, bar, and the number at the bar's end.
  const row = el('div', 'ypw__row ypw__row--inline');
  const line = el('div', 'ypw__line');
  const label = el('span', 'ypw__label', unit.label);
  const pct = el('span', 'ypw__pct', '');
  line.append(label, bar.element, pct);
  row.appendChild(line);
  const caption = captioned ? el('div', 'ypw__caption', '') : undefined;
  if (caption) row.appendChild(caption);

  return {
    element: row,
    update(u, pctText, cap) {
      label.textContent = u.label;
      pct.textContent = pctText;
      bar.set(u.progress);
      if (caption) caption.textContent = cap.text;
    },
  };
}

// ─── Registration ────────────────────────────────────────────────────────────

export const YEAR_PROGRESS_WIDGET: WidgetTypeRegistration<YearProgressConfig> = {
  typeId: 'parallx.dashboard.year-progress',
  displayName: 'Year Progress',
  description: 'How far through the year you are, as a quiet bar. Choose the shape, the bar, and the color; add the month, week, and day.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 2 },
  chromeStyle: 'minimal',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      layout: {
        type: 'enum',
        label: 'Layout',
        description: 'Where the number sits, and how much of the count shows.',
        default: DEFAULT_CONFIG.layout,
        options: [
          { value: 'inline', label: 'Number At The End' },
          { value: 'stacked', label: 'Number Above' },
          { value: 'detail', label: 'Endpoints And Counts' },
        ],
      },
      barStyle: {
        type: 'enum',
        label: 'Bar Style',
        default: DEFAULT_CONFIG.barStyle,
        options: [
          { value: 'bar', label: 'Bar' },
          { value: 'slim', label: 'Hairline' },
          { value: 'pill', label: 'Pill' },
          { value: 'segments', label: 'Segments' },
        ],
      },
      color: {
        type: 'enum',
        label: 'Bar Color',
        default: DEFAULT_CONFIG.color,
        options: [
          { value: 'neutral', label: 'Neutral' },
          { value: 'accent', label: 'Accent' },
          { value: 'green', label: 'Green' },
          { value: 'amber', label: 'Amber' },
          { value: 'red', label: 'Red' },
          { value: 'blue', label: 'Blue' },
        ],
      },
      precision: {
        type: 'enum',
        label: 'Decimal Places',
        default: DEFAULT_CONFIG.precision,
        options: [
          { value: '0', label: 'None (65%)' },
          { value: '1', label: 'One (64.9%)' },
          { value: '2', label: 'Two (64.87%)' },
        ],
      },
      showCaption: {
        type: 'boolean',
        label: 'Show Day Count',
        description: 'The "Day 237 of 365" line, or the counts under the bar.',
      },
      showDay: { type: 'boolean', label: 'Show Day Progress' },
      showWeek: { type: 'boolean', label: 'Show Week Progress' },
      showMonth: { type: 'boolean', label: 'Show Month Progress' },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<YearProgressConfig>): WidgetHandle {
    container.classList.add('ypw');
    let config = normalizeYearProgressConfig(ctx.config);
    let rows: { id: UnitId; handle: RowHandle }[] = [];

    function format(progress: number): string {
      return `${(progress * 100).toFixed(Number(config.precision))}%`;
    }

    /** Rebuild the DOM. Only on create and on a config change — never on tick. */
    function build(): void {
      container.dataset.layout = config.layout;
      container.dataset.style = config.barStyle;
      container.dataset.color = config.color;

      // Smallest first, so the eye climbs to the year the widget is named for.
      const order: UnitId[] = [];
      if (config.showDay) order.push('day');
      if (config.showWeek) order.push('week');
      if (config.showMonth) order.push('month');
      order.push('year');

      const { units } = measureYearProgress(new Date());
      rows = order.map((id) => ({
        id,
        // The caption belongs to the year — it counts days OF THE YEAR.
        handle: createRow(units[id], config, config.showCaption && id === 'year'),
      }));
      container.replaceChildren(...rows.map((r) => r.handle.element));
      tick();
    }

    function tick(): void {
      const { units, dayOfYear, daysInYear } = measureYearProgress(new Date());
      const remaining = daysInYear - dayOfYear;
      const caption: CaptionData = {
        passed: dayOfYear,
        remaining,
        total: daysInYear,
        text: `Day ${dayOfYear} of ${daysInYear}, ${remaining} to go`,
      };
      for (const row of rows) {
        const unit = units[row.id];
        row.handle.update(unit, format(unit.progress), caption);
      }
    }

    build();
    const interval = setInterval(tick, 60_000);
    const sub = ctx.onDidChangeConfig((next) => {
      config = normalizeYearProgressConfig(next);
      build();
    });

    return {
      dispose() {
        clearInterval(interval);
        sub.dispose();
      },
    };
  },
};
