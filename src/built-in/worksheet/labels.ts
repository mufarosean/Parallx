// labels.ts — the short words the Worksheets panes put next to things.
//
// Grades, study time, clock time, days and quiz names, each written one way
// everywhere. Dates follow the app's Time Zone (localTime.ts), never the
// machine's.

import { ratingLabel } from './problemImport.js';
import { appDateTimeString, startOfAppDay } from '../../services/localTime.js';

/** Easy, Medium, Hard: the workbook's words, for new and legacy grades alike. */
export function gradeLabel(grade: string): string {
  return ratingLabel(grade) || grade;
}

/** Study time in a summary: "12m", "3h 08m", never seconds (those belong to the sheet's clock). */
export function fmtStudy(total: number): string {
  const s = Math.max(0, Math.round(total));
  if (s < 60) return s === 0 ? '0m' : '<1m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/** A clock reading: "m:ss", or "h:mm:ss" past an hour. */
export function fmtSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** A day key (YYYY-MM-DD) as "Sep 17, 2026". */
export function fmtShortDay(day: string): string {
  // A day key is a calendar date: written as one, through no zone's clock.
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** A fresh quiz id (a UUID where the platform has one). */
export function newQuizId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "today", "yesterday", "N days ago": how Home and the quiz screens date things. */
export function when(ms: number): string {
  // Calendar days, not 24-hour spans: 11 pm last night is "yesterday" at
  // 8 am, which the elapsed-time count called "today".
  // The user's days, in the app's Time Zone.
  const days = Math.round((startOfAppDay(Date.now()) - startOfAppDay(ms)) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** `when` at the start of a fragment: "Today", "Yesterday", "3 days ago". */
export function whenCap(ms: number): string {
  const w = when(ms);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** A quiz named after the moment it began, when nothing better was given. */
export function defaultQuizName(count: number): string {
  const at = appDateTimeString(Date.now(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${count} ${count === 1 ? 'Problem' : 'Problems'} · ${at}`;
}
