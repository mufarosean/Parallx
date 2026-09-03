// relativeTime.ts — ONE way to say "how long ago".
//
// The canvas ribbon ("Edited 14h ago") and the chat session list ("22h ago",
// "yesterday") each kept their own formatter with different thresholds and
// different words. One reads a stamp, the other a caption; they should still
// speak the same language. Two styles, one clock:
//
//   long   "just now" · "5 minutes ago" · "14 hours ago" · "yesterday"
//          "3 days ago" · "Aug 20" · "Aug 20, 2025"
//   short  "now" · "5m ago" · "14h ago" · "yesterday" · "3d ago" · "Aug 20"
//
// Dependency rules: src/ui/ depends only on src/platform/.

export type RelativeTimeStyle = 'long' | 'short';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

function calendarDate(then: Date, now: Date): string {
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format `when` relative to `now`.
 *
 * @param when  A timestamp in ms, an ISO string, or a Date.
 * @param style 'long' for stamps read on their own; 'short' for captions in
 *              narrow rows. Default 'long'.
 * @param now   Injectable clock for tests.
 */
export function formatRelativeTime(
  when: number | string | Date,
  style: RelativeTimeStyle = 'long',
  now: number = Date.now(),
): string {
  const thenMs = when instanceof Date ? when.getTime() : typeof when === 'string' ? Date.parse(when) : when;
  if (!Number.isFinite(thenMs)) return '';
  const diff = Math.max(0, now - thenMs);
  const short = style === 'short';

  if (diff < MINUTE) return short ? 'now' : 'just now';
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return short ? `${m}m ago` : plural(m, 'minute');
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return short ? `${h}h ago` : plural(h, 'hour');
  }

  // Past a day, count calendar days so "yesterday" means yesterday, not
  // "between 24 and 48 hours ago".
  const thenDate = new Date(thenMs);
  const nowDate = new Date(now);
  const startOfThen = new Date(thenDate.getFullYear(), thenDate.getMonth(), thenDate.getDate()).getTime();
  const startOfNow = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const days = Math.round((startOfNow - startOfThen) / DAY);

  if (days <= 1) return 'yesterday';
  if (days < 7) return short ? `${days}d ago` : plural(days, 'day');
  if (days < 30) {
    const w = Math.floor(days / 7);
    return short ? `${w}w ago` : plural(w, 'week');
  }
  return calendarDate(thenDate, nowDate);
}
