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

/** The machine's IANA zone, or 'UTC' if the runtime cannot say. */
export function machineTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** True when `tz` is a zone Intl can format in. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }); return true; } catch { return false; }
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
