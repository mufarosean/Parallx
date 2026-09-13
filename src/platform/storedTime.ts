// storedTime.ts — timestamps as the workspace database keeps them.
//
// SQLite's datetime('now') writes 'YYYY-MM-DD HH:MM:SS' in UTC, with no zone
// mark, and JavaScript reads a string like that as LOCAL time: a page edited
// at 13:05 in Chicago showed 18:05, and "Edited just now" stayed for five
// hours. The AI's page tools also wrote ISO strings ('...T...Z') beside
// SQLite's form, and the two sort wrongly as text.
//
// One format and one reader: every writer uses sqliteUtcNow() (the same text
// datetime('now') writes), and every reader uses parseStoredTime(), which
// reads that form as UTC and anything else (an ISO string with its zone, a
// time the user picked) as written.

const SQLITE_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** Now (or `at`) in SQLite's datetime('now') form: 'YYYY-MM-DD HH:MM:SS', UTC. */
export function sqliteUtcNow(at: Date = new Date()): string {
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

/** Milliseconds for a stored time; NaN when there is none or it cannot be read. */
export function parseStoredTime(value: string | number | Date | null | undefined): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const s = value.trim();
  return Date.parse(SQLITE_UTC.test(s) ? `${s.replace(' ', 'T')}Z` : s);
}

/**
 * A stored time for the AI to read: local clock time with its UTC offset,
 * e.g. '2026-09-11 13:05 (UTC-05:00)'. A value that cannot be read comes back
 * as it was.
 */
export function formatStoredTimeForModel(value: string | null | undefined): string {
  const ms = parseStoredTime(value);
  if (!Number.isFinite(ms)) return String(value ?? '');
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} (UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`;
}
