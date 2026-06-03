// plannerICal.ts — export planner events + tasks as RFC 5545 iCalendar (.ics).
//
// Lets a planner calendar be imported into Google / Apple / Outlook. Events
// become VEVENT (the recurrence we already store as an RRULE is emitted
// verbatim, so a recurring series exports as one VEVENT + RRULE rather than
// hundreds of rows); tasks become VTODO. Pure string building — no DOM — so
// it is unit-testable; the renderer just hands the result to a file save.

import type { PlannerEvent, PlannerTask } from './plannerTypes.js';

const PRODID = '-//Parallx//Planner//EN';

/** Escape a TEXT value per RFC 5545 §3.3.11 (backslash, newline, comma, semicolon). */
export function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\n|\r/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Fold a content line to ≤75 octets with CRLF + a single leading space (§3.1). */
export function foldICalLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

/** UTC date-time: YYYYMMDDTHHMMSSZ. */
export function formatICalUTC(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Floating DATE (local calendar day): YYYYMMDD. */
export function formatICalDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function line(name: string, value: string): string {
  return foldICalLine(`${name}:${value}`);
}

function eventToVEvent(ev: PlannerEvent, stamp: string): string[] {
  const out = ['BEGIN:VEVENT'];
  out.push(line('UID', `${ev.seriesId ?? ev.id}@parallx.app`));
  out.push(line('DTSTAMP', stamp));
  if (ev.allDay) {
    out.push(line('DTSTART;VALUE=DATE', formatICalDate(ev.startAt)));
    // All-day DTEND is exclusive → the day after the last day covered.
    const endExclusive = new Date(ev.endAt);
    endExclusive.setHours(0, 0, 0, 0);
    endExclusive.setDate(endExclusive.getDate() + 1);
    out.push(line('DTEND;VALUE=DATE', formatICalDate(endExclusive.getTime())));
  } else {
    out.push(line('DTSTART', formatICalUTC(ev.startAt)));
    out.push(line('DTEND', formatICalUTC(ev.endAt)));
  }
  out.push(line('SUMMARY', escapeICalText(ev.title)));
  if (ev.description) out.push(line('DESCRIPTION', escapeICalText(ev.description)));
  if (ev.location) out.push(line('LOCATION', escapeICalText(ev.location)));
  if (ev.recurrence) out.push(line('RRULE', ev.recurrence.replace(/^RRULE:/i, '')));
  out.push('END:VEVENT');
  return out;
}

function taskToVTodo(task: PlannerTask, stamp: string): string[] {
  const out = ['BEGIN:VTODO'];
  out.push(line('UID', `${task.id}@parallx.app`));
  out.push(line('DTSTAMP', stamp));
  if (task.dueAt != null) out.push(line('DUE', formatICalUTC(task.dueAt)));
  out.push(line('SUMMARY', escapeICalText(task.title)));
  if (task.description) out.push(line('DESCRIPTION', escapeICalText(task.description)));
  if (task.tags.length > 0) out.push(line('CATEGORIES', task.tags.map(escapeICalText).join(',')));
  if (task.status === 'done') {
    out.push(line('STATUS', 'COMPLETED'));
    out.push(line('PERCENT-COMPLETE', '100'));
    if (task.completedAt != null) out.push(line('COMPLETED', formatICalUTC(task.completedAt)));
  } else {
    out.push(line('STATUS', 'NEEDS-ACTION'));
  }
  out.push('END:VTODO');
  return out;
}

export interface ICalExportInput {
  readonly events?: readonly PlannerEvent[];
  readonly tasks?: readonly PlannerTask[];
  readonly calendarName?: string;
  /** Hex colour (e.g. "#4c8bf5") for X-APPLE-CALENDAR-COLOR round-tripping. */
  readonly calendarColor?: string;
  /** Override "now" for DTSTAMP — tests pass a fixed value. */
  readonly nowMs?: number;
}

/** Build a complete VCALENDAR document (CRLF-terminated, ready to save). */
export function buildICalendar(input: ICalExportInput): string {
  const stamp = formatICalUTC(input.nowMs ?? Date.now());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (input.calendarName) lines.push(line('X-WR-CALNAME', escapeICalText(input.calendarName)));
  if (input.calendarColor) lines.push(line('X-APPLE-CALENDAR-COLOR', input.calendarColor));
  for (const ev of input.events ?? []) lines.push(...eventToVEvent(ev, stamp));
  for (const task of input.tasks ?? []) lines.push(...taskToVTodo(task, stamp));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
