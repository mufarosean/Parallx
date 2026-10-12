// plannerDates.ts — the Planner's days, weeks and months, and how it writes times.
//
// Days, weeks and months are the user's (the app's Time Zone setting, else
// this computer's zone): a Date here is an instant, and its calendar fields
// are read with appDateParts, never with the machine-local getters. Pure:
// the pane calls these for every grid, chip and form field.

import { addAppDays, appDateParts, appDateString, appTime, appTimeString, isSameAppDay, startOfAppDay } from '../../services/localTime.js';
import type { PlannerEvent } from './plannerTypes.js';

export function startOfDay(date: Date): Date { return new Date(startOfAppDay(date)); }
export function endOfDay(date: Date): Date { return new Date(addAppDays(startOfAppDay(date), 1) - 1); }
export function startOfWeek(date: Date): Date {
  // Week starts on Sunday for compatibility with most calendars; could be configurable later.
  const d = startOfAppDay(date);
  return new Date(addAppDays(d, -appDateParts(d).weekday));
}
export function startOfMonth(date: Date): Date {
  const p = appDateParts(date);
  return new Date(appTime(p.year, p.month, 1));
}
export function endOfMonth(date: Date): Date {
  const p = appDateParts(date);
  return new Date(appTime(p.year, p.month + 1, 1) - 1);
}
export function addDays(date: Date, n: number): Date {
  return new Date(addAppDays(date, n));
}
/** `date`'s day in the app zone at the given wall-clock time. */
export function atTime(date: Date | number, hour: number, minute = 0): number {
  const p = appDateParts(date);
  return appTime(p.year, p.month, p.day, hour, minute);
}

export function startOfDayMs(): number {
  return startOfAppDay(Date.now());
}

export function sameDay(a: Date, b: Date): boolean {
  return isSameAppDay(a, b);
}

export function formatDateShort(ts: number): string {
  const now = Date.now();
  if (isSameAppDay(ts, now)) return 'Today';
  if (isSameAppDay(ts, addAppDays(now, 1))) return 'Tomorrow';
  const diff = ts - now;
  if (diff > 0 && diff < 7 * 86_400_000) return appDateString(ts, { weekday: 'short' });
  return appDateString(ts, { month: 'short', day: 'numeric' });
}

export function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

export function formatTimeShort(ms: number): string {
  return appTimeString(ms, { hour: 'numeric', minute: '2-digit' });
}

export function formatTimeRange(ev: PlannerEvent): string {
  const fmt = (ts: number) => appTimeString(ts, { hour: 'numeric', minute: '2-digit' });
  if (ev.allDay) return 'All Day';
  return `${fmt(ev.startAt)} – ${fmt(ev.endAt)}`;
}

export function toDateInputValue(ms: number): string {
  const d = appDateParts(ms);
  const m = String(d.month + 1).padStart(2, '0');
  const day = String(d.day).padStart(2, '0');
  return `${d.year}-${m}-${day}`;
}

export function toTimeInputValue(ms: number): string {
  const d = appDateParts(ms);
  const h = String(d.hour).padStart(2, '0');
  const m = String(d.minute).padStart(2, '0');
  return `${h}:${m}`;
}

export function fromDateTimeInputs(dateStr: string, timeStr: string): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  let hour = 0, min = 0;
  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
    if (Number.isFinite(hh)) hour = hh;
    if (Number.isFinite(mm)) min = mm;
  }
  const dt = appTime(y, m - 1, d, hour, min, 0, 0);
  return Number.isFinite(dt) ? dt : null;
}
