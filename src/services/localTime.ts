/**
 * localTime — the one clock everything the model reads is written in.
 *
 * The assistant used to be shown two clocks on every turn: the local time
 * in words and the same instant as an ISO string ending in Z, and every
 * tool that stamped an event stamped it in ISO-UTC too. Given a readable
 * local time and a machine-shaped UTC one, a model copies the machine one,
 * and the user in Central hears "13:00Z" for lunch. So: one zone, chosen
 * once (`chat.timeZone`, empty for this computer's zone), and one format,
 * `2026-09-16 07:31 CDT`, that names the zone on every stamp.
 *
 * The configured zone is held here as a module value because the renderers
 * that need it (the activity journal line, tool results, the prompt's
 * runtime section) are pure functions with no configuration in reach; the
 * chat tool sets it at activation and again when the setting changes.
 */

let _configured = '';

// Asking Intl for the machine's zone builds a formatter (tens of µs), and the
// calendar helpers below ask on every call. The answer is kept until the
// machine's UTC offsets change (the OS zone changed, or a test set TZ).
const PROBE_WINTER = Date.UTC(2026, 0, 1);
const PROBE_SUMMER = Date.UTC(2026, 6, 1);
let _machineZone: { key: string; tz: string } | null = null;

/** The machine's IANA zone, or 'UTC' if the runtime cannot say. */
export function machineTimeZone(): string {
  const key = `${new Date(PROBE_WINTER).getTimezoneOffset()}/${new Date(PROBE_SUMMER).getTimezoneOffset()}`;
  if (_machineZone && _machineZone.key === key) return _machineZone.tz;
  let tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* UTC */ }
  _machineZone = { key, tz };
  return tz;
}

const _validZones = new Map<string, boolean>();

/** True when `tz` is a zone Intl can format in. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  const name = tz.trim();
  let ok = _validZones.get(name);
  if (ok === undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: name }); ok = true; } catch { ok = false; }
    if (_validZones.size < 256) _validZones.set(name, ok);
  }
  return ok;
}

/** The zone a setting value means: a valid IANA name as given, anything else (empty, 'system', a typo) the machine's. */
export function resolveTimeZone(configured?: string | null): string {
  const v = typeof configured === 'string' ? configured.trim() : '';
  if (!v || v.toLowerCase() === 'system' || v.toLowerCase() === 'local') return machineTimeZone();
  return isValidTimeZone(v) ? v : machineTimeZone();
}

/** Remember the configured zone (the raw setting value; resolved on read). */
export function setAssistantTimeZone(configured?: string | null): void {
  _configured = typeof configured === 'string' ? configured : '';
}

/** The zone every model-facing time is written in. */
export function assistantTimeZone(): string {
  return resolveTimeZone(_configured);
}

interface IFormatOptions {
  /** Include seconds (`07:31:02`). Off by default: a journal line does not need them. */
  readonly seconds?: boolean;
  /** A zone other than the assistant's; tests and previews. */
  readonly timeZone?: string;
  /** Leave the zone abbreviation off (`2026-09-16 07:31`). */
  readonly bare?: boolean;
}

function parts(ms: number | Date, tz: string, seconds: boolean): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
    hour12: false, timeZoneName: 'short',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(ms instanceof Date ? ms : new Date(ms))) out[p.type] = p.value;
  // Some ICU builds render midnight as "24" with hour12 off.
  if (out['hour'] === '24') out['hour'] = '00';
  return out;
}

/** `2026-09-16 07:31 CDT` (with `:02` seconds when asked) in the assistant's zone. */
export function formatLocalDateTime(ms: number | Date, opts: IFormatOptions = {}): string {
  const tz = opts.timeZone && isValidTimeZone(opts.timeZone) ? opts.timeZone : assistantTimeZone();
  const p = parts(ms, tz, !!opts.seconds);
  const time = `${p['hour']}:${p['minute']}${opts.seconds ? `:${p['second']}` : ''}`;
  const stamp = `${p['year']}-${p['month']}-${p['day']} ${time}`;
  return opts.bare ? stamp : `${stamp} ${p['timeZoneName']}`;
}

/** `07:31` in the assistant's zone: the journal's line prefix. */
export function formatLocalTime(ms: number | Date, opts: IFormatOptions = {}): string {
  const tz = opts.timeZone && isValidTimeZone(opts.timeZone) ? opts.timeZone : assistantTimeZone();
  const p = parts(ms, tz, !!opts.seconds);
  return `${p['hour']}:${p['minute']}${opts.seconds ? `:${p['second']}` : ''}`;
}

/** `2026-09-16` in the assistant's zone: the day an instant belongs to, for the user. */
export function formatLocalDate(ms: number | Date, opts: IFormatOptions = {}): string {
  const tz = opts.timeZone && isValidTimeZone(opts.timeZone) ? opts.timeZone : assistantTimeZone();
  const p = parts(ms, tz, false);
  return `${p['year']}-${p['month']}-${p['day']}`;
}

// ─── The user's calendar ─────────────────────────────────────────────────────
//
// Everything that decides "what day is it for the user" (today, tomorrow,
// overdue, the week a day sits in, the month a grid shows) and every date the
// user reads goes through these, so the Time Zone setting moves all of it at
// once. Storage stays epoch ms / ISO-UTC; only the reading of it changes.
//
// When the app zone is this computer's zone (the setting is empty, the common
// case) each helper is the plain local `Date` method it replaces, so nothing
// changes there; another zone is computed through Intl, DST included.

/** One instant read in the app zone. `month` is 0-11 and `weekday` 0 (Sunday) to 6, as `Date` has them. */
export interface IAppDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
  readonly weekday: number;
}

const _partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = _partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
    });
    _partsFormatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The app zone, and whether it is the one `Date`'s local methods already use. */
function appZone(): { tz: string; native: boolean } {
  const tz = assistantTimeZone();
  return { tz, native: tz === machineTimeZone() };
}

function msOf(ms: number): number { return ((ms % 1000) + 1000) % 1000; }

function zonedParts(ms: number, tz: string): IAppDateParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
  const hour = Number(out['hour']);
  return {
    year: Number(out['year']), month: Number(out['month']) - 1, day: Number(out['day']),
    hour: hour === 24 ? 0 : hour, minute: Number(out['minute']), second: Number(out['second']),
    millisecond: msOf(ms), weekday: WEEKDAYS[out['weekday'] ?? ''] ?? 0,
  };
}

function toMs(v: number | Date): number { return v instanceof Date ? v.getTime() : v; }

/** Year, month, day, time and weekday of an instant, for the user (the app zone). */
export function appDateParts(at: number | Date = Date.now()): IAppDateParts {
  const ms = toMs(at);
  const { tz, native } = appZone();
  if (!native) return zonedParts(ms, tz);
  const d = new Date(ms);
  return {
    year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(),
    second: d.getSeconds(), millisecond: d.getMilliseconds(), weekday: d.getDay(),
  };
}

/** `YYYY-MM-DD`: the user's day an instant falls on (the app zone). */
export function appDayKey(at: number | Date = Date.now()): string {
  const p = appDateParts(at);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** How far the zone's wall clock is ahead of UTC at instant `ms`, in ms. */
function zoneOffset(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second) - (ms - msOf(ms));
}

/**
 * The instant a wall-clock time in the app zone names: `new Date(y, m, d, h, mi)`
 * read in the app zone. Out-of-range fields roll over (day 0 is the last of the
 * previous month), a time skipped by a DST jump lands after the jump, and a
 * time that happens twice is the first, as `Date` does.
 */
export function appTime(year: number, month: number, day = 1, hour = 0, minute = 0, second = 0, millisecond = 0): number {
  const { tz, native } = appZone();
  if (native) return new Date(year, month, day, hour, minute, second, millisecond).getTime();
  const guess = Date.UTC(year, month, day, hour, minute, second, millisecond);
  const want = new Date(guess);
  const before = zoneOffset(guess - 86_400_000, tz);
  const after = zoneOffset(guess + 86_400_000, tz);
  const matches = (t: number): boolean => {
    const p = zonedParts(t, tz);
    return p.year === want.getUTCFullYear() && p.month === want.getUTCMonth() && p.day === want.getUTCDate()
      && p.hour === want.getUTCHours() && p.minute === want.getUTCMinutes();
  };
  const candidates = [guess - before, guess - after].filter(matches);
  if (candidates.length) return Math.min(...candidates);
  // Skipped by a jump forward: read with the offset from before the jump, as Date does.
  return guess - before;
}

/** The instant the user's day containing `at` began (midnight in the app zone). */
export function startOfAppDay(at: number | Date = Date.now()): number {
  const p = appDateParts(at);
  return appTime(p.year, p.month, p.day);
}

/** The same wall-clock time `n` days later (or earlier) in the app zone: `setDate(getDate() + n)`. */
export function addAppDays(at: number | Date, n: number): number {
  const p = appDateParts(at);
  return appTime(p.year, p.month, p.day + n, p.hour, p.minute, p.second, p.millisecond);
}

/** True when two instants fall on the same day for the user. */
export function isSameAppDay(a: number | Date, b: number | Date): boolean {
  return appDayKey(a) === appDayKey(b);
}

/** `toLocale*String` options that read the instant in the app zone. */
export function appLocaleOptions(opts: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
  return { ...opts, timeZone: assistantTimeZone() };
}

/** `toLocaleDateString`, read in the app zone. */
export function appDateString(at: number | Date, opts?: Intl.DateTimeFormatOptions, locale?: string | string[]): string {
  return new Date(toMs(at)).toLocaleDateString(locale, appLocaleOptions(opts));
}

/** `toLocaleTimeString`, read in the app zone. */
export function appTimeString(at: number | Date, opts?: Intl.DateTimeFormatOptions, locale?: string | string[]): string {
  return new Date(toMs(at)).toLocaleTimeString(locale, appLocaleOptions(opts));
}

/** `toLocaleString`, read in the app zone. */
export function appDateTimeString(at: number | Date, opts?: Intl.DateTimeFormatOptions, locale?: string | string[]): string {
  return new Date(toMs(at)).toLocaleString(locale, appLocaleOptions(opts));
}
