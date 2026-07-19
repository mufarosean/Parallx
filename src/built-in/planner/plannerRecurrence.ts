// plannerRecurrence.ts — minimal RRULE support for planner events.
//
// We store recurring events as a single base row carrying an RRULE string
// (`FREQ=…;INTERVAL=…;BYDAY=…;UNTIL=…|COUNT=…`) and expand instances at read
// time over the visible window. Storing standard RRULE (not a bespoke shape)
// means a future Google Calendar provider maps recurrence 1:1.
//
// Scope is deliberately the common cases — daily / weekly (incl. specific
// weekdays) / monthly / yearly, with INTERVAL and UNTIL or COUNT. That covers
// what the popover's "Repeats" control can produce; richer RRULE (BYMONTHDAY,
// BYSETPOS, exceptions) can layer on later without changing the storage.

export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface ParsedRecurrence {
  readonly freq: RecurrenceFreq;
  readonly interval: number;
  /** Weekday numbers 0=Sun … 6=Sat (WEEKLY only). */
  readonly byDay?: readonly number[];
  /** Inclusive cutoff (ms epoch). */
  readonly until?: number;
  /** Total number of occurrences from the series start. */
  readonly count?: number;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Parse an RRULE string. Returns null if it is malformed / unsupported. */
export function parseRRule(rule: string): ParsedRecurrence | null {
  if (typeof rule !== 'string' || rule.trim().length === 0) return null;
  const parts = new Map<string, string>();
  for (const seg of rule.replace(/^RRULE:/i, '').split(';')) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    parts.set(seg.slice(0, eq).trim().toUpperCase(), seg.slice(eq + 1).trim());
  }

  const freq = parts.get('FREQ')?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;

  const interval = Math.max(1, parseInt(parts.get('INTERVAL') ?? '1', 10) || 1);

  let byDay: number[] | undefined;
  const byDayRaw = parts.get('BYDAY');
  if (byDayRaw) {
    byDay = byDayRaw.split(',')
      .map(c => DAY_CODES.indexOf(c.trim().toUpperCase().slice(-2)))
      .filter(i => i >= 0);
    if (byDay.length === 0) byDay = undefined;
  }

  let until: number | undefined;
  const untilRaw = parts.get('UNTIL');
  if (untilRaw) {
    const ms = parseICalDate(untilRaw);
    if (ms != null) until = ms;
  }

  let count: number | undefined;
  const countRaw = parts.get('COUNT');
  if (countRaw) {
    const n = parseInt(countRaw, 10);
    if (Number.isFinite(n) && n > 0) count = n;
  }

  return { freq, interval, byDay, until, count };
}

/** Parse YYYYMMDD or YYYYMMDDTHHMMSS[Z], else fall back to Date.parse. */
function parseICalDate(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(s.trim());
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    return Date.UTC(+y, +mo - 1, +d, hh ? +hh : 23, mm ? +mm : 59, ss ? +ss : 59);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export interface Occurrence {
  readonly startAt: number;
  readonly endAt: number;
}

/**
 * Expand a recurring event into concrete occurrences that intersect
 * [from, to]. `startAt` is the series DTSTART; each occurrence keeps the
 * base duration. COUNT is counted from the series start (not the window);
 * UNTIL is an absolute cutoff. Hard-capped for safety.
 */
export function expandRecurrence(
  startAt: number,
  durationMs: number,
  rule: string,
  from: number,
  to: number,
): Occurrence[] {
  const parsed = parseRRule(rule);
  if (!parsed) return [];

  const out: Occurrence[] = [];
  const HARD_CAP = 750;
  const dur = Math.max(0, durationMs);
  const ceiling = parsed.until != null ? Math.min(to, parsed.until) : to;
  let emitted = 0;

  const tryEmit = (t: number): boolean => {
    // returns false to signal "stop the whole expansion"
    if (parsed.count != null && emitted >= parsed.count) return false;
    if (parsed.until != null && t > parsed.until) return false;
    emitted++;
    if (t + dur >= from && t <= to) out.push({ startAt: t, endAt: t + dur });
    return out.length < HARD_CAP;
  };

  if (parsed.freq === 'WEEKLY' && parsed.byDay && parsed.byDay.length > 0) {
    const base = new Date(startAt);
    const h = base.getHours(), mi = base.getMinutes(), se = base.getSeconds(), ms = base.getMilliseconds();
    const weekStart = new Date(base);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const days = [...parsed.byDay].sort((a, b) => a - b);

    for (let wk = 0; wk < HARD_CAP; wk++) {
      const weekBase = new Date(weekStart);
      weekBase.setDate(weekBase.getDate() + wk * 7 * parsed.interval);
      if (weekBase.getTime() > ceiling) break;
      for (const dow of days) {
        const occ = new Date(weekBase);
        occ.setDate(occ.getDate() + dow);
        occ.setHours(h, mi, se, ms);
        const t = occ.getTime();
        if (t < startAt) continue;            // before the series start
        if (!tryEmit(t)) return out;
      }
      if (parsed.count != null && emitted >= parsed.count) break;
    }
    return out;
  }

  // DAILY / WEEKLY(no BYDAY) / MONTHLY / YEARLY: occurrence k is DERIVED
  // FROM THE SERIES START every time — never stepped from the previous
  // occurrence. Two bugs lived in the old cursor walk:
  //   • month-end overflow corrupted the whole series (Jan 31 → "Feb 31" →
  //     Mar 3, then Apr 3 forever). RFC 5545 semantics: months without the
  //     anchor day are SKIPPED and the anchor is kept (Jan 31 → Mar 31);
  //     same for Feb 29 yearly series in non-leap years.
  //   • a series older than the step guard (e.g. a daily event created 2+
  //     years ago) exhausted the guard before reaching the window and
  //     silently vanished from every view. Deriving from k lets COUNT-less
  //     series FAST-FORWARD near the window instead of replaying history.
  const base = new Date(startAt);
  const baseDay = base.getDate();
  const baseMonth = base.getMonth();

  const occurrenceAt = (k: number): number | null => {
    if (parsed.freq === 'DAILY') {
      const d = new Date(base);
      d.setDate(d.getDate() + k * parsed.interval);
      return d.getTime();
    }
    if (parsed.freq === 'WEEKLY') {
      const d = new Date(base);
      d.setDate(d.getDate() + k * 7 * parsed.interval);
      return d.getTime();
    }
    if (parsed.freq === 'MONTHLY') {
      const d = new Date(base);
      d.setDate(1); // avoid overflow while changing the month
      d.setMonth(d.getMonth() + k * parsed.interval);
      d.setDate(baseDay);
      return d.getDate() === baseDay ? d.getTime() : null; // short month → skip
    }
    const d = new Date(base);
    d.setDate(1); // avoid Feb-29 overflow while changing the year
    d.setFullYear(d.getFullYear() + k * parsed.interval);
    d.setMonth(baseMonth, baseDay);
    return (d.getMonth() === baseMonth && d.getDate() === baseDay)
      ? d.getTime()
      : null; // Feb 29 in a non-leap year → skip
  };

  // Fast-forward: COUNT-less series can start near the window (padded by a
  // few steps for DST wobble and skip runs). COUNT series must replay from
  // k=0 — skipped instances don't consume COUNT (RFC), so indexes and
  // emission counts only line up when counted from the start.
  let k = 0;
  if (parsed.count == null && from > startAt) {
    // Divisors deliberately OVERSTATE the true step (31-day months,
    // 366-day years), so the estimated k UNDERSHOOTS — the loop can only
    // start BEFORE the window, never past it (missing leading occurrences).
    const stepMs =
      parsed.freq === 'DAILY' ? parsed.interval * 86_400_000 :
      parsed.freq === 'WEEKLY' ? parsed.interval * 7 * 86_400_000 :
      parsed.freq === 'MONTHLY' ? parsed.interval * 31 * 86_400_000 :
      parsed.interval * 366 * 86_400_000;
    k = Math.max(0, Math.floor((from - dur - startAt) / stepMs) - 3);
  }

  for (let guard = 0; guard < HARD_CAP; guard++, k++) {
    const t = occurrenceAt(k);
    if (t === null) continue; // skipped instance (short month / non-leap year)
    if (t > ceiling) break;
    if (!tryEmit(t)) break;
  }
  return out;
}

/**
 * Cap a recurrence at an inclusive UNTIL (ms epoch), dropping any existing
 * UNTIL/COUNT (RFC 5545 forbids both). Used to split a series ("this and
 * following") or truncate it ("delete this and following"). Formats UNTIL as a
 * UTC "Z" datetime — Google-correct for timed series, and it round-trips through
 * parseRRule/expandRecurrence exactly (which compare absolute ms).
 */
export function setRRuleUntil(rule: string, untilMs: number): string {
  const kept = rule.replace(/^RRULE:/i, '').split(';').filter((seg) => {
    const k = seg.split('=')[0]?.trim().toUpperCase();
    return k && k !== 'UNTIL' && k !== 'COUNT';
  });
  const d = new Date(untilMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  const until =
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  kept.push(`UNTIL=${until}`);
  return kept.join(';');
}

/** Human label for a stored RRULE, for chips/popovers. Falls back to "Custom". */
export function describeRRule(rule: string | null | undefined): string {
  if (!rule) return 'Does not repeat';
  const p = parseRRule(rule);
  if (!p) return 'Custom';
  const every = p.interval > 1 ? `every ${p.interval} ` : '';
  if (p.freq === 'DAILY') return `Repeats ${every || 'daily'}${p.interval > 1 ? 'days' : ''}`.trim();
  if (p.freq === 'WEEKLY') {
    if (p.byDay && p.byDay.length > 0) {
      const names = p.byDay.slice().sort((a, b) => a - b).map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
      return `Repeats ${every}weekly on ${names}`.replace('every weekly', 'every week');
    }
    return p.interval > 1 ? `Repeats every ${p.interval} weeks` : 'Repeats weekly';
  }
  if (p.freq === 'MONTHLY') return p.interval > 1 ? `Repeats every ${p.interval} months` : 'Repeats monthly';
  return p.interval > 1 ? `Repeats every ${p.interval} years` : 'Repeats yearly';
}

/**
 * Build a simple RRULE for the popover's "Repeats" presets. `weekday` (0–6)
 * seeds BYDAY for the weekly preset so "weekly" means "this weekday".
 */
export function buildSimpleRRule(
  preset: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly',
  weekday?: number,
): string | null {
  switch (preset) {
    case 'none': return null;
    case 'daily': return 'FREQ=DAILY';
    case 'weekly': return weekday != null ? `FREQ=WEEKLY;BYDAY=${DAY_CODES[weekday]}` : 'FREQ=WEEKLY';
    case 'monthly': return 'FREQ=MONTHLY';
    case 'yearly': return 'FREQ=YEARLY';
    default: return null;
  }
}

/** Which preset a stored RRULE most closely matches (for the popover select). */
export function rruleToPreset(rule: string | null | undefined): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' {
  if (!rule) return 'none';
  const p = parseRRule(rule);
  if (!p) return 'custom';
  if (p.interval !== 1 || p.count != null) return 'custom';
  if (p.freq === 'DAILY') return p.byDay ? 'custom' : 'daily';
  if (p.freq === 'WEEKLY') return (!p.byDay || p.byDay.length <= 1) ? 'weekly' : 'custom';
  if (p.freq === 'MONTHLY') return 'monthly';
  if (p.freq === 'YEARLY') return 'yearly';
  return 'custom';
}
