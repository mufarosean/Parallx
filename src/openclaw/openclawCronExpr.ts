// openclawCronExpr.ts — five-field cron expressions: parse a field, and the
// next time an expression fires on the app's clock (cron jobs and dashboard
// refresh schedules).

import { appDateParts, appTime } from '../services/localTime.js';

// ---------------------------------------------------------------------------
// Minimal 5-field cron parser
// Upstream ref: src/cron/schedule.ts — computeNextRunAtMs()
// Supports: numbers, *, ranges (1-5), steps (*/5), lists (1,3,5)
// ---------------------------------------------------------------------------

/**
 * Parse a single cron field into an array of matching values.
 * Handles: *, N, N-M, star/N, N-M/S, and comma-separated lists.
 */
export function parseCronField(field: string, min: number, max: number): number[] {
  const result = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`Empty cron field segment`);

    // Check for step: "*/5" or "1-10/2"
    const slashIdx = trimmed.indexOf('/');
    let rangePart = trimmed;
    let step = 1;

    if (slashIdx !== -1) {
      rangePart = trimmed.slice(0, slashIdx);
      step = parseInt(trimmed.slice(slashIdx + 1), 10);
      if (isNaN(step) || step < 1) throw new Error(`Invalid step: ${trimmed}`);
    }

    let rangeStart: number;
    let rangeEnd: number;

    if (rangePart === '*') {
      rangeStart = min;
      rangeEnd = max;
    } else if (rangePart.includes('-')) {
      const [lo, hi] = rangePart.split('-').map(s => parseInt(s, 10));
      if (isNaN(lo) || isNaN(hi)) throw new Error(`Invalid range: ${rangePart}`);
      if (lo < min || hi > max || lo > hi) throw new Error(`Range out of bounds: ${rangePart}`);
      rangeStart = lo;
      rangeEnd = hi;
    } else {
      const val = parseInt(rangePart, 10);
      if (isNaN(val) || val < min || val > max) throw new Error(`Value out of range: ${rangePart}`);
      if (slashIdx === -1) {
        result.add(val);
        continue;
      }
      rangeStart = val;
      rangeEnd = max;
    }

    for (let v = rangeStart; v <= rangeEnd; v += step) {
      result.add(v);
    }
  }

  if (result.size === 0) throw new Error(`Cron field produced no values: ${field}`);
  return [...result].sort((a, b) => a - b);
}

/**
 * Compute next run time for a 5-field cron expression.
 * Fields: minute hour day-of-month month day-of-week
 * Iterates forward from fromMs + 1 minute, up to 366 days.
 * Returns null if no match found.
 *
 * Upstream ref: src/cron/schedule.ts — computeNextRunAtMs()
 */

export function computeNextCronRun(expr: string, fromMs: number): number | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const daysOfMonth = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const daysOfWeek = parseCronField(parts[4], 0, 6);

  const minuteSet = new Set(minutes);
  const hourSet = new Set(hours);
  const domSet = new Set(daysOfMonth);
  const monthSet = new Set(months);
  const dowSet = new Set(daysOfWeek);

  // Evaluate on the user's wall clock: "0 9 * * *" means 9am where the user
  // is, matching every real-world crontab and what a user asking "every day
  // at 9" obviously means. The original implementation walked UTC fields, so
  // that job fired at 4am US-Central. The wall clock is the app's Time Zone
  // (the setting, else this computer's zone); appTime absorbs DST jumps the
  // way Date's local setters do. A step never moves the cursor backwards (a
  // repeated hour at a clock change would otherwise be walked twice).
  const step = (cursor: number, next: number): number => Math.max(next, cursor + 60_000);
  // Start from the next whole minute after fromMs.
  const f = appDateParts(fromMs);
  let cursor = step(fromMs - f.second * 1000 - f.millisecond, appTime(f.year, f.month, f.day, f.hour, f.minute + 1));

  const limit = fromMs + 366 * 86_400_000; // 366 days max lookahead

  while (cursor <= limit) {
    const c = appDateParts(cursor);
    if (!monthSet.has(c.month + 1)) {
      // Skip to first day of next month
      cursor = step(cursor, appTime(c.year, c.month + 1, 1));
      continue;
    }

    if (!domSet.has(c.day) || !dowSet.has(c.weekday)) {
      // Skip to next day
      cursor = step(cursor, appTime(c.year, c.month, c.day + 1));
      continue;
    }

    if (!hourSet.has(c.hour)) {
      // Skip to next hour
      cursor = step(cursor, appTime(c.year, c.month, c.day, c.hour + 1));
      continue;
    }

    if (!minuteSet.has(c.minute)) {
      // Skip to next minute
      cursor = step(cursor, appTime(c.year, c.month, c.day, c.hour, c.minute + 1));
      continue;
    }

    return cursor;
  }

  return null;
}
