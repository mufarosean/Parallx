// calendarDates.ts — days for the calendar and timeline views (pure).
//
// Everything is a local calendar day as "YYYY-MM-DD"; no Date arithmetic
// leaks across a time zone, and a test gets the same grid on any machine.

export type DayKey = string; // "YYYY-MM-DD"

export function dayKeyOf(d: Date): DayKey {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): DayKey { return dayKeyOf(now); }

export function parseDay(key: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  return m ? { y: +m[1]!, m: +m[2]!, d: +m[3]! } : null;
}

function utc(key: DayKey): number {
  const p = parseDay(key)!;
  return Date.UTC(p.y, p.m - 1, p.d);
}

export function addDays(key: DayKey, n: number): DayKey {
  const t = new Date(utc(key) + n * 86_400_000);
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b − a); negative when b is earlier. */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: DayKey): number {
  return new Date(utc(key)).getUTCDay();
}

export function monthOf(key: DayKey): string { return key.slice(0, 7); }

export function firstOfMonth(month: string): DayKey { return `${month}-01`; }

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "November 2026" in the user's language. */
export function monthTitle(month: string, locale?: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** Weekday initials from `weekStart` (0 Sunday or 1 Monday) in the user's language. */
export function weekdayLabels(weekStart: 0 | 1, locale?: string): string[] {
  const base = new Date(2024, 0, 7 + weekStart); // a Sunday (Jan 7 2024) or Monday
  return Array.from({ length: 7 }, (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + i).toLocaleDateString(locale, { weekday: 'short' }));
}

export interface IMonthCell { readonly key: DayKey; readonly inMonth: boolean }

/** The 6 × 7 grid of a month: leading and trailing days of the neighbours fill the rows. */
export function monthGrid(month: string, weekStart: 0 | 1): IMonthCell[][] {
  const first = firstOfMonth(month);
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  let key = addDays(first, -lead);
  const rows: IMonthCell[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: IMonthCell[] = [];
    for (let c = 0; c < 7; c++) { row.push({ key, inMonth: monthOf(key) === month }); key = addDays(key, 1); }
    rows.push(row);
  }
  return rows;
}

/** The day a stored date or datetime falls on, or null. */
export function dayOfValue(v: unknown): DayKey | null {
  if (typeof v !== 'string') return null;
  const p = parseDay(v);
  return p ? v.slice(0, 10) : null;
}

/** "Nov 9" or "Nov 9, 2026" when the year differs from `now`. */
export function shortDay(key: DayKey, now: Date = new Date(), locale?: string): string {
  const p = parseDay(key);
  if (!p) return key;
  const d = new Date(p.y, p.m - 1, p.d);
  return d.toLocaleDateString(locale, p.y === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
