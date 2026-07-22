// cronScheduleSpec.ts — the human schedule model over ICronSchedule.
//
// One implementation of "daily at 08:00" ↔ `0 8 * * *` shared by every
// surface that edits cron jobs: the Planner's Automations tab and the AI
// Hub's Scheduled-jobs section. Pure functions only — UI stays with the
// surfaces. Extracted from plannerAutomations.ts (M93) when the AI Hub
// section dropped its raw `cron:<expr>` text field for the same friendly
// builder.

import type { ICronSchedule } from './openclawCronService.js';

export type AutomationScheduleSpec =
  | { readonly kind: 'daily'; readonly time: string }                        // 'HH:MM'
  | { readonly kind: 'weekly'; readonly day: number; readonly time: string } // day 0=Sun
  | { readonly kind: 'interval'; readonly every: string }                    // '30m' | '2h' | '1d'
  | { readonly kind: 'once'; readonly at: string }                          // ISO datetime
  | { readonly kind: 'cron'; readonly expr: string };                       // 5-field cron

export const WEEKDAY_LABELS: readonly string[] = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** Parse 'HH:MM' (24h). Returns null when malformed or out of range. */
export function parseTimeOfDay(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Build the cron-service schedule for a form spec. Throws with a
 * user-presentable message on invalid input — forms surface it inline.
 */
export function buildCronSchedule(spec: AutomationScheduleSpec): ICronSchedule {
  switch (spec.kind) {
    case 'daily': {
      const t = parseTimeOfDay(spec.time);
      if (!t) throw new Error(`Invalid time "${spec.time}". Expected HH:MM.`);
      return { cron: `${t.minute} ${t.hour} * * *` };
    }
    case 'weekly': {
      const t = parseTimeOfDay(spec.time);
      if (!t) throw new Error(`Invalid time "${spec.time}". Expected HH:MM.`);
      if (!Number.isInteger(spec.day) || spec.day < 0 || spec.day > 6) {
        throw new Error('Invalid weekday.');
      }
      return { cron: `${t.minute} ${t.hour} * * ${spec.day}` };
    }
    case 'interval': {
      const v = spec.every.trim();
      if (!/^\d+(?:\.\d+)?[smhd]$/i.test(v)) {
        throw new Error(`Invalid interval "${spec.every}". Use e.g. "30m", "2h", "1d".`);
      }
      return { every: v };
    }
    case 'once': {
      const ts = Date.parse(spec.at);
      if (!Number.isFinite(ts)) throw new Error(`Invalid date/time "${spec.at}".`);
      if (ts <= Date.now()) throw new Error('One-time runs must be in the future.');
      return { at: new Date(ts).toISOString() };
    }
    case 'cron': {
      const expr = spec.expr.trim();
      if (expr.split(/\s+/).length !== 5) {
        throw new Error('Cron expressions need 5 fields (minute hour day month weekday).');
      }
      return { cron: expr };
    }
  }
}

/**
 * Best-effort inverse of {@link buildCronSchedule} so an edit form reopens
 * with the friendly controls when the schedule is one it could have built.
 * Falls back to the raw cron/interval/once representation otherwise.
 */
export function specFromSchedule(s: ICronSchedule): AutomationScheduleSpec {
  if (s.every) return { kind: 'interval', every: s.every };
  if (s.at) return { kind: 'once', at: s.at };
  if (s.cron) {
    const m = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\*|\d)$/.exec(s.cron.trim());
    if (m) {
      const minute = parseInt(m[1], 10);
      const hour = parseInt(m[2], 10);
      if (hour <= 23 && minute <= 59) {
        const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        if (m[3] === '*') return { kind: 'daily', time };
        return { kind: 'weekly', day: parseInt(m[3], 10), time };
      }
    }
    return { kind: 'cron', expr: s.cron };
  }
  // Degenerate — treat as custom cron so the form still opens.
  return { kind: 'cron', expr: '' };
}

/** Human-readable schedule line for job cards and lists. */
export function describeSchedule(s: ICronSchedule): string {
  const spec = specFromSchedule(s);
  switch (spec.kind) {
    case 'daily': return `Every day at ${spec.time}`;
    case 'weekly': return `Every ${WEEKDAY_LABELS[spec.day] ?? '?'} at ${spec.time}`;
    case 'interval': return `Every ${spec.every}`;
    case 'once': {
      const d = new Date(spec.at);
      return Number.isNaN(d.getTime()) ? `Once at ${spec.at}` : `Once at ${d.toLocaleString()}`;
    }
    case 'cron': return `Cron: ${spec.expr}`;
  }
}
