// googleCalendarSyncProvider.ts — ICalendarSyncProvider over the Google
// Calendar v3 API.
//
// All HTTP goes through the main-process bridge (googleClient → google:fetch),
// which injects the access token and is host-allowlisted to www.googleapis.com.
// This module owns the Google⇄planner shape mapping and per-calendar
// incremental sync tokens (stored in planner_settings via PlannerDataService).
//
// Scope of this provider (v1): events on the calendars the user enabled (mirror
// rows where source_provider = 'google'). Recurring series sync as a single
// RRULE row; per-instance exceptions are intentionally out of scope (logged,
// not applied). Tasks live in a separate provider path (Phase 4).

import type { PlannerDataService } from '../plannerDataService.js';
import type {
  EventOverride,
  ICalendarSyncProvider,
  PlannerEvent,
  PlannerTask,
  SyncCalendarSnapshot,
  SyncedEvent,
  SyncedEventOverride,
  SyncedTask,
  SyncPullResult,
  SyncPullState,
  SyncPushResult,
} from '../plannerTypes.js';
import { googleSync } from './googleClient.js';

export const GOOGLE_PROVIDER_ID = 'google';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const TASKS_BASE = 'https://www.googleapis.com/tasks/v1';
const DEFAULT_TASKLIST = '@default';
const PAGE_SIZE = 250;
/** planner_settings flag toggled by the "Sync tasks" checkbox. */
export const GOOGLE_TASKS_ENABLED_KEY = `sync.${GOOGLE_PROVIDER_ID}.tasks.enabled`;
/** Pulled Google tasks land on the built-in Tasks calendar. */
const TASKS_CALENDAR_ID = 'cal-tasks';

// ─── Google wire shapes (minimal) ─────────────────────────────────────────────

interface GCalDate { date?: string; dateTime?: string; timeZone?: string }
interface GCalEvent {
  id?: string;
  status?: string;            // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  description?: string;
  location?: string;
  start?: GCalDate;
  end?: GCalDate;
  recurrence?: string[];
  recurringEventId?: string;  // present on instance exceptions → master id
  originalStartTime?: GCalDate; // the occurrence slot this exception overrides
  colorId?: string;           // Google's per-event colour index (1–11)
  updated?: string;           // RFC3339
}

// Google Calendar's 11 event colours (colorId → hex). Mirrors PLANNER_COLORS in
// plannerEditorProvider so imported events keep the colour the user set in
// Google. Kept local to avoid the sync layer importing the renderer UI module.
const GCAL_EVENT_COLOR_HEX: Readonly<Record<string, string>> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
  '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161',
  '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
};
interface GCalEventsResponse {
  items?: GCalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

// ─── Pure mappers (exported for unit tests) ───────────────────────────────────

function pad2(n: number): string { return String(n).padStart(2, '0'); }

/** Local Y-M-D for an all-day boundary (Google all-day dates are floating). */
export function toAllDayDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse a floating all-day date ('YYYY-MM-DD') to local-midnight ms. */
export function parseAllDayDate(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00`);
}

/**
 * Parse Google Tasks' date-only `due` (RFC3339 anchored to 00:00:00 UTC) to
 * LOCAL midnight of that calendar date. Parsing the UTC instant directly (the
 * old bug) shifts the task to the PREVIOUS day in negative-offset timezones —
 * a task created in Parallx jumped a day (and lost its time) after a sync
 * round-trip. Only the calendar date is meaningful for a Google task.
 */
export function parseGoogleTaskDue(due: string): number {
  const local = parseAllDayDate(due.slice(0, 10)); // 'YYYY-MM-DD'
  return Number.isFinite(local) ? local : Date.parse(due);
}

/** First RRULE line out of Google's recurrence[] (EXDATE/RDATE dropped in v1). */
export function extractRrule(recurrence: readonly string[] | undefined): string | null {
  if (!recurrence) return null;
  const line = recurrence.find((r) => r.startsWith('RRULE:'));
  return line ? line.slice('RRULE:'.length) : null;
}

/**
 * Google event → SyncedEvent. Returns null for items we can't represent in v1
 * (per-instance exceptions of a recurring series).
 */
export function mapGoogleEventToSynced(
  item: GCalEvent,
  plannerCalendarId: string,
): SyncedEvent | null {
  if (!item.id || !item.start || !item.end) return null;
  if (item.recurringEventId) return null; // instance exception — v1 skips

  const allDay = !!item.start.date;
  let startAt: number;
  let endAt: number;
  if (allDay) {
    startAt = parseAllDayDate(item.start.date!);
    // Google all-day end.date is exclusive; keep the same exclusive ms so a
    // round-trip back to Google is stable.
    endAt = item.end.date ? parseAllDayDate(item.end.date) : startAt + 86_400_000;
  } else {
    startAt = Date.parse(item.start.dateTime ?? '');
    endAt = Date.parse(item.end.dateTime ?? '');
  }
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null;

  return {
    title: item.summary?.trim() || '(no title)',
    description: item.description ?? null,
    startAt,
    endAt,
    allDay,
    location: item.location ?? null,
    calendarId: plannerCalendarId,
    // Import Google's per-event colour so synced events keep their real colour
    // instead of all inheriting the one calendar colour.
    color: item.colorId ? (GCAL_EVENT_COLOR_HEX[item.colorId] ?? null) : null,
    recurrence: extractRrule(item.recurrence),
    updatedAt: item.updated ? Date.parse(item.updated) : Date.now(),
    sourceProvider: GOOGLE_PROVIDER_ID,
    sourceId: item.id,
  };
}

/** A Google recurring INSTANCE exception (edited or cancelled single occurrence)
 *  → a SyncedEventOverride keyed by its original slot. Null if unrepresentable. */
export function mapGoogleExceptionToOverride(item: GCalEvent): SyncedEventOverride | null {
  if (!item.id || !item.recurringEventId || !item.originalStartTime) return null;
  const orig = item.originalStartTime;
  const origMs = orig.date ? parseAllDayDate(orig.date) : Date.parse(orig.dateTime ?? '');
  if (!Number.isFinite(origMs)) return null;
  const updatedAt = item.updated ? Date.parse(item.updated) : Date.now();
  if (item.status === 'cancelled') {
    return { baseSourceId: item.recurringEventId, originalStartAt: origMs, cancelled: true, sourceId: item.id, updatedAt };
  }
  const allDay = !!item.start?.date;
  const startAt = allDay ? parseAllDayDate(item.start!.date!) : Date.parse(item.start?.dateTime ?? '');
  const endAt = allDay
    ? (item.end?.date ? parseAllDayDate(item.end.date) : startAt + 86_400_000)
    : Date.parse(item.end?.dateTime ?? '');
  return {
    baseSourceId: item.recurringEventId,
    originalStartAt: origMs,
    cancelled: false,
    title: item.summary?.trim() || null,
    description: item.description ?? null,
    startAt: Number.isFinite(startAt) ? startAt : null,
    endAt: Number.isFinite(endAt) ? endAt : null,
    allDay,
    location: item.location ?? null,
    sourceId: item.id,
    updatedAt,
  };
}

/** Deterministic Google instance-event id: `{masterId}_{originalStartCompact}`.
 *  Timed → `..._YYYYMMDDTHHMMSSZ` (the instant, in UTC).
 *  All-day → `..._YYYYMMDD` (the LOCAL calendar date — all-day slots are stored
 *  as local midnight, whose UTC date is the previous day east of Greenwich, so
 *  reading it in UTC would address the wrong occurrence).
 *  Only a best guess: `pushOverride` falls back to asking Google when it misses. */
export function googleInstanceId(masterId: string, originalStartAt: number, allDay: boolean): string {
  const d = new Date(originalStartAt);
  const p = (n: number): string => String(n).padStart(2, '0');
  const suffix = allDay
    ? toAllDayDateStr(originalStartAt).replace(/-/g, '')
    : `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return `${masterId}_${suffix}`;
}

/**
 * The machine's IANA zone, resolved at call time — never hardcoded, and never
 * cached across a machine/OS zone change.
 *
 * Google REQUIRES an explicit timeZone on start and end for any RECURRING
 * event, even when the dateTime already carries a UTC offset, and rejects the
 * create outright with "Missing time zone definition for start time." (A
 * one-off event is accepted from the offset alone, which is why single events
 * synced fine while every series silently failed to push.) The zone is also
 * what makes a series repeat at the right WALL-CLOCK time across a DST
 * boundary rather than drifting an hour.
 */
export function machineTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : undefined;
  } catch {
    return undefined; // omit the field rather than guess a zone
  }
}

/**
 * A stored RRULE rendered for Google's wire format.
 *
 * RFC 5545 requires UNTIL to match DTSTART's value type: an all-day series
 * (DTSTART is a DATE) must end on a DATE, not a UTC datetime. `setRRuleUntil`
 * always writes the datetime form, so an all-day series capped by "this and
 * following" produced a mismatched rule Google can reject.
 *
 * The date is taken in LOCAL time, not UTC. UNTIL for an all-day series is
 * "local midnight minus a second", whose UTC calendar date is the NEXT day in
 * negative-offset zones — reading it as UTC would extend the series by a day.
 */
export function rruleForGoogle(rule: string, allDay: boolean): string {
  const bare = rule.replace(/^RRULE:/i, '');
  if (!allDay) return bare;
  return bare.replace(/UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/i,
    (_m, y: string, mo: string, d: string, hh: string, mm: string, ss: string, z: string) => {
      // With Z the stamp is a UTC instant; without it, RFC 5545 floating local.
      const ms = z
        ? Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss)
        : new Date(+y, +mo - 1, +d, +hh, +mm, +ss).getTime();
      if (!Number.isFinite(ms)) return `UNTIL=${y}${mo}${d}`;
      return `UNTIL=${toAllDayDateStr(ms).replace(/-/g, '')}`;
    });
}

/** Planner event → Google event request body. */
export function mapPlannerEventToGoogle(local: PlannerEvent): Record<string, unknown> {
  const timeZone = machineTimeZone();
  const body: Record<string, unknown> = {
    summary: local.title,
    description: local.description ?? undefined,
    location: local.location ?? undefined,
  };
  if (local.allDay) {
    const endMs = local.endAt > local.startAt ? local.endAt : local.startAt + 86_400_000;
    body.start = { date: toAllDayDateStr(local.startAt), timeZone };
    body.end = { date: toAllDayDateStr(endMs), timeZone };
  } else {
    body.start = { dateTime: new Date(local.startAt).toISOString(), timeZone };
    body.end = { dateTime: new Date(local.endAt).toISOString(), timeZone };
  }
  if (local.recurrence) {
    body.recurrence = [`RRULE:${rruleForGoogle(local.recurrence, local.allDay)}`];
  }
  return body;
}

// ─── Google Tasks shapes + mappers ────────────────────────────────────────────

interface GTask {
  id?: string;
  title?: string;
  notes?: string;
  status?: string;     // 'needsAction' | 'completed'
  due?: string;        // RFC3339 (date — time component ignored by Google)
  completed?: string;  // RFC3339
  updated?: string;
  deleted?: boolean;
}
interface GTasksResponse { items?: GTask[]; nextPageToken?: string }

/** Google task → SyncedTask. */
export function mapGoogleTaskToSynced(item: GTask, plannerCalendarId: string): SyncedTask | null {
  if (!item.id) return null;
  const done = item.status === 'completed';
  return {
    title: item.title?.trim() || '(no title)',
    description: item.notes ?? null,
    status: done ? 'done' : 'planned',
    dueAt: item.due ? parseGoogleTaskDue(item.due) : null,
    completedAt: item.completed ? Date.parse(item.completed) : null,
    calendarId: plannerCalendarId,
    updatedAt: item.updated ? Date.parse(item.updated) : Date.now(),
    sourceProvider: GOOGLE_PROVIDER_ID,
    sourceId: item.id,
  };
}

/** Planner task → Google task request body. */
export function mapPlannerTaskToGoogle(local: PlannerTask): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: local.title,
    notes: local.description ?? undefined,
    status: local.status === 'done' ? 'completed' : 'needsAction',
  };
  if (local.dueAt != null) {
    // Tasks `due` is a floating date; send UTC midnight of the local day so the
    // calendar date the user picked round-trips.
    const d = new Date(local.dueAt);
    body.due = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
  }
  if (local.status === 'done' && local.completedAt != null) {
    body.completed = new Date(local.completedAt).toISOString();
  }
  return body;
}

// ─── Calendar list (for the settings selection UI) ────────────────────────────

export interface GoogleCalendarListEntry {
  readonly id: string;
  readonly summary: string;
  readonly backgroundColor?: string;
  readonly primary?: boolean;
  readonly accessRole?: string; // 'owner' | 'writer' | 'reader' | 'freeBusyReader'
}

/** The calendars on the connected account (for the "calendars to sync" picker). */
export async function fetchGoogleCalendarList(): Promise<GoogleCalendarListEntry[]> {
  const res = await googleSync.fetch<{ items?: GoogleCalendarListEntry[] }>({
    method: 'GET',
    url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
  });
  if (!res.ok) throw new Error(res.error ?? 'calendarList failed');
  return (res.data?.items ?? []).filter((c) => !!c.id);
}

/** The provider-clock stamp a write produced, when Google echoes it back. */
function remoteStamp(updated: string | undefined): number | undefined {
  if (!updated) return undefined;
  const ms = Date.parse(updated);
  return Number.isFinite(ms) ? ms : undefined;
}

// ─── Provider ──────────────────────────────────────────────────────────────────

export class GoogleCalendarSyncProvider implements ICalendarSyncProvider {
  readonly id = GOOGLE_PROVIDER_ID;
  readonly displayName = 'Google Calendar';

  /**
   * Cursors produced by the last pull, held in memory until the orchestrator
   * confirms it applied that pull (commitCursors). Writing a syncToken the
   * moment paging finishes — the old behaviour — meant any failure between
   * "Google told us" and "we stored it" silently burned those changes: Google
   * considers a consumed token acknowledged and never resends. That is exactly
   * how one workspace ends up permanently missing edits another one made.
   */
  private _pendingCalTokens = new Map<string, string>();
  private _pendingTaskWatermark: number | null = null;

  constructor(private readonly _data: PlannerDataService) {}

  private _tokenKey(googleCalId: string): string {
    return `sync.${this.id}.cal.${googleCalId}.token`;
  }

  /** Publish the cursors buffered by the last successful pull. */
  async commitCursors(): Promise<void> {
    for (const [googleCalId, token] of this._pendingCalTokens) {
      await this._data.setSetting(this._tokenKey(googleCalId), token);
    }
    this._pendingCalTokens.clear();
    if (this._pendingTaskWatermark != null) {
      await this._data.setSetting(`sync.${this.id}.tasks.updatedMin`, String(this._pendingTaskWatermark));
      this._pendingTaskWatermark = null;
    }
  }

  /** Drop every cursor so the next pull re-reads the account from scratch. */
  async resetCursors(): Promise<void> {
    this._pendingCalTokens.clear();
    this._pendingTaskWatermark = null;
    await this._data.clearSyncCursors(this.id);
  }

  async wantsTaskSync(): Promise<boolean> {
    return (await this._data.getSetting(GOOGLE_TASKS_ENABLED_KEY)) === '1';
  }

  async pull(state: SyncPullState): Promise<SyncPullResult> {
    // A pull that throws must leave NO cursor behind — otherwise the batch it
    // half-read is acknowledged to Google and lost. Start from a clean buffer.
    this._pendingCalTokens.clear();
    this._pendingTaskWatermark = null;

    const cals = await this._data.listSyncedCalendars(this.id);
    const upsertedEvents: SyncedEvent[] = [];
    const deletedEventSourceIds: string[] = [];
    const upsertedOverrides: SyncedEventOverride[] = [];
    const snapshots: SyncCalendarSnapshot[] = [];
    let anyReset = false;

    for (const cal of cals) {
      if (!cal.sourceId) continue;
      const r = await this._pullCalendar(cal.sourceId, cal.id, state.sinceMs);
      upsertedEvents.push(...r.upserted);
      deletedEventSourceIds.push(...r.deleted);
      upsertedOverrides.push(...r.overrides);
      if (r.reset) anyReset = true;
      // A full listing is the whole truth for its window — hand it to the
      // orchestrator so it can drop mirrors of events deleted while we were
      // behind, which no incremental cursor could ever have reported.
      if (r.full) snapshots.push({ calendarId: cal.id, sourceIds: r.seenIds, fromMs: r.fromMs });
    }

    let upsertedTasks: SyncedTask[] | undefined;
    let deletedTaskSourceIds: string[] | undefined;
    if (await this.wantsTaskSync()) {
      const t = await this._pullTasks(state.sinceMs);
      upsertedTasks = t.upserted;
      deletedTaskSourceIds = t.deleted;
    }

    return {
      upsertedEvents, deletedEventSourceIds, upsertedOverrides,
      upsertedTasks, deletedTaskSourceIds, reset: anyReset,
      snapshots: snapshots.length ? snapshots : undefined,
    };
  }

  /** Pull the default tasklist. Tasks API has no syncToken — we page by
   *  updatedMin (with a small overlap) and persist the watermark ourselves. */
  private async _pullTasks(sinceMs: number): Promise<{ upserted: SyncedTask[]; deleted: string[] }> {
    const upserted: SyncedTask[] = [];
    const deleted: string[] = [];
    const wmKey = `sync.${this.id}.tasks.updatedMin`;
    let watermark = parseInt((await this._data.getSetting(wmKey)) ?? '', 10);
    if (!Number.isFinite(watermark)) watermark = sinceMs;
    const since = Math.max(0, watermark - 60_000); // overlap guards edge updates
    const runStart = Date.now();

    let pageToken: string | undefined;
    for (let guard = 0; guard < 1000; guard++) {
      const params = new URLSearchParams();
      params.set('showCompleted', 'true');
      params.set('showHidden', 'true');
      params.set('showDeleted', 'true');
      params.set('maxResults', '100');
      params.set('updatedMin', new Date(since).toISOString());
      if (pageToken) params.set('pageToken', pageToken);

      const url = `${TASKS_BASE}/lists/${encodeURIComponent(DEFAULT_TASKLIST)}/tasks?${params.toString()}`;
      const res = await googleSync.fetch<GTasksResponse>({ method: 'GET', url });
      if (!res.ok) throw new Error(`Google Tasks pull failed: ${res.error ?? 'unknown'}`);

      for (const item of res.data?.items ?? []) {
        if (item.deleted) { if (item.id) deleted.push(item.id); continue; }
        const mapped = mapGoogleTaskToSynced(item, TASKS_CALENDAR_ID);
        if (mapped) upserted.push(mapped);
      }
      pageToken = res.data?.nextPageToken;
      if (!pageToken) break;
    }

    // Buffered, not written: the watermark only becomes true once these tasks
    // have actually landed locally (see commitCursors).
    this._pendingTaskWatermark = runStart;
    return { upserted, deleted };
  }

  /** Pull one calendar with pagination + a single 410 (expired token) recovery. */
  private async _pullCalendar(
    googleCalId: string,
    plannerCalId: string,
    sinceMs: number,
  ): Promise<{
    upserted: SyncedEvent[]; deleted: string[]; overrides: SyncedEventOverride[];
    reset: boolean; full: boolean; seenIds: string[]; fromMs: number;
  }> {
    const upserted: SyncedEvent[] = [];
    const deleted: string[] = [];
    const overrides: SyncedEventOverride[] = [];
    const seenIds: string[] = [];
    let reset = false;

    let token = (await this._data.getSetting(this._tokenKey(googleCalId))) || undefined;
    // No token ⇒ this listing is a COMPLETE snapshot of [sinceMs, ∞), not a delta.
    const full = !token;
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    let triedFullResync = false;

    for (let guard = 0; guard < 1000; guard++) {
      const params = new URLSearchParams();
      params.set('singleEvents', 'false');
      params.set('showDeleted', 'true');
      params.set('maxResults', String(PAGE_SIZE));
      if (token) params.set('syncToken', token);
      else params.set('timeMin', new Date(sinceMs).toISOString());
      if (pageToken) params.set('pageToken', pageToken);

      const url = `${CAL_BASE}/${encodeURIComponent(googleCalId)}/events?${params.toString()}`;
      const res = await googleSync.fetch<GCalEventsResponse>({ method: 'GET', url });

      if (!res.ok) {
        // 410 Gone = syncToken expired → drop it and do a full resync once.
        if (res.status === 410 && !triedFullResync) {
          triedFullResync = true;
          reset = true;
          token = undefined;
          pageToken = undefined;
          upserted.length = 0; deleted.length = 0; overrides.length = 0; seenIds.length = 0;
          // Clearing a dead cursor is always safe (worst case: one extra full
          // pull). Advancing one is not — that write happens in commitCursors.
          await this._data.setSetting(this._tokenKey(googleCalId), '');
          continue;
        }
        throw new Error(`Google Calendar pull failed (${googleCalId}): ${res.error ?? 'unknown'}`);
      }

      const body = res.data ?? {};
      for (const item of body.items ?? []) {
        if (item.id && !item.recurringEventId) seenIds.push(item.id);
        // A single-occurrence exception (edit or cancel) — carries recurringEventId.
        // Route it to an override rather than treating a cancelled occurrence as
        // a whole-series delete.
        if (item.recurringEventId) {
          const ov = mapGoogleExceptionToOverride(item);
          if (ov) overrides.push(ov);
          continue;
        }
        if (item.status === 'cancelled') {
          if (item.id) deleted.push(item.id);
          continue;
        }
        const mapped = mapGoogleEventToSynced(item, plannerCalId);
        if (mapped) upserted.push(mapped);
      }

      if (body.nextSyncToken) nextSyncToken = body.nextSyncToken;
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }

    // Buffered, NOT written — see commitCursors(). Persisting here would tell
    // Google "delivered" before a single row had been applied locally.
    if (nextSyncToken) this._pendingCalTokens.set(googleCalId, nextSyncToken);
    return { upserted, deleted, overrides, reset, full: full || triedFullResync, seenIds, fromMs: sinceMs };
  }

  async pushEvent(local: PlannerEvent): Promise<SyncPushResult> {
    const cal = await this._data.getCalendar(local.calendarId ?? '');
    const googleCalId = cal?.sourceProvider === this.id ? cal.sourceId : null;
    if (!googleCalId) throw new Error(`Event ${local.id} is not in a Google-synced calendar`);

    const body = mapPlannerEventToGoogle(local);

    if (local.sourceId) {
      // Update existing remote event.
      const url = `${CAL_BASE}/${encodeURIComponent(googleCalId)}/events/${encodeURIComponent(local.sourceId)}`;
      const res = await googleSync.fetch<GCalEvent>({ method: 'PATCH', url, body });
      if (!res.ok) throw new Error(`Google Calendar update failed: ${res.error ?? 'unknown'}`);
      return { providerId: res.data?.id ?? local.sourceId, remoteUpdatedAt: remoteStamp(res.data?.updated) };
    }

    // Create new remote event.
    const url = `${CAL_BASE}/${encodeURIComponent(googleCalId)}/events`;
    const res = await googleSync.fetch<GCalEvent>({ method: 'POST', url, body });
    if (!res.ok || !res.data?.id) throw new Error(`Google Calendar create failed: ${res.error ?? 'no id'}`);
    return { providerId: res.data.id, remoteUpdatedAt: remoteStamp(res.data.updated) };
  }

  async deleteEvent(sourceId: string, remoteParentId?: string): Promise<void> {
    if (!remoteParentId) return; // unknown calendar — nothing we can target
    const url = `${CAL_BASE}/${encodeURIComponent(remoteParentId)}/events/${encodeURIComponent(sourceId)}`;
    const res = await googleSync.fetch({ method: 'DELETE', url });
    // 404/410 = already gone upstream — treat as a successful delete.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`Google Calendar delete failed: ${res.error ?? 'unknown'}`);
    }
  }

  /**
   * Push a single-occurrence exception.
   *
   * Google addresses an instance by id, and the id is *usually* the derivable
   * `{masterId}_{originalStartUTC}`. Usually is not always: once an exception
   * exists Google may hand back a different id, an all-day slot uses the date
   * form, and a slot our local expander computes can land a second (or an hour,
   * across a zone change) away from the one Google expanded. A miss is a bare
   * 404 — "Not Found" — and the edit retries forever against an id that will
   * never exist.
   *
   * So: try the id we already recorded, then the derived one, and if both 404
   * ASK Google which instance occupies that slot rather than guessing again.
   * The id that works is stored (markOverrideSynced) so the next push is a
   * direct hit. originalStartTime is never sent — it is the pin to the slot
   * being overridden, and changing it would move the exception.
   */
  async pushOverride(baseSourceId: string, override: EventOverride): Promise<SyncPushResult> {
    const base = await this._data.getEventBySource(this.id, baseSourceId);
    const cal = base ? await this._data.getCalendar(base.calendarId ?? '') : null;
    const googleCalId = cal?.sourceProvider === this.id ? cal.sourceId : null;
    if (!googleCalId) throw new Error('Override master is not in a Google-synced calendar');

    const allDay = override.allDay ?? base?.allDay ?? false;

    let body: Record<string, unknown>;
    if (override.cancelled) {
      body = { status: 'cancelled' };
    } else {
      body = {};
      if (override.title != null) body.summary = override.title;
      if (override.description != null) body.description = override.description;
      if (override.location != null) body.location = override.location;
      const start = override.startAt ?? override.originalStartAt;
      const dur = base ? base.endAt - base.startAt : 3_600_000;
      const end = override.endAt ?? start + dur;
      // Same timeZone requirement as the series itself — an instance of a
      // recurring event is still a recurring-event write.
      const timeZone = machineTimeZone();
      if (allDay) {
        body.start = { date: toAllDayDateStr(start), timeZone };
        body.end = { date: toAllDayDateStr(end > start ? end : start + 86_400_000), timeZone };
      } else {
        body.start = { dateTime: new Date(start).toISOString(), timeZone };
        body.end = { dateTime: new Date(end).toISOString(), timeZone };
      }
    }

    const patch = async (instanceId: string): Promise<{ ok: boolean; status?: number; error?: string; data?: GCalEvent }> => {
      const url = `${CAL_BASE}/${encodeURIComponent(googleCalId)}/events/${encodeURIComponent(instanceId)}`;
      const res = await googleSync.fetch<GCalEvent>({ method: 'PATCH', url, body });
      return { ok: res.ok, status: res.status, error: res.error, data: res.data ?? undefined };
    };

    const derived = googleInstanceId(baseSourceId, override.originalStartAt, allDay);
    const candidates = override.sourceId && override.sourceId !== derived
      ? [override.sourceId, derived]
      : [derived];

    for (const id of candidates) {
      const res = await patch(id);
      if (res.ok) return { providerId: res.data?.id ?? id, remoteUpdatedAt: remoteStamp(res.data?.updated) };
      // Anything but "that instance isn't there" is a real failure — surface it
      // rather than papering over it with a lookup.
      if (res.status !== 404 && res.status !== 410) {
        throw new Error(`Google Calendar override push failed: ${res.error ?? 'unknown'}`);
      }
    }

    const resolved = await this._resolveInstanceId(googleCalId, baseSourceId, override.originalStartAt, allDay);
    if (!resolved) {
      const when = new Date(override.originalStartAt).toLocaleString();
      throw new Error(`no occurrence of the series at ${when} on Google (the series may have changed there)`);
    }
    const res = await patch(resolved);
    if (!res.ok) throw new Error(`Google Calendar override push failed: ${res.error ?? 'unknown'}`);
    return { providerId: res.data?.id ?? resolved, remoteUpdatedAt: remoteStamp(res.data?.updated) };
  }

  /**
   * Ask Google for the real id of the instance occupying `originalStartAt`.
   *
   * Matching is exact first. Failing that, same LOCAL calendar day: a daily or
   * weekly series has one occurrence per day, so the day identifies the slot
   * unambiguously even when our expansion and Google's disagree about the
   * instant (a DST boundary, a series whose zone changed). If a day somehow
   * holds several, the nearest in time wins. Anything looser would risk
   * rewriting the wrong occurrence, so it returns null instead.
   */
  private async _resolveInstanceId(
    googleCalId: string,
    masterId: string,
    originalStartAt: number,
    allDay: boolean,
  ): Promise<string | null> {
    const WINDOW_MS = 36 * 60 * 60 * 1000; // wide enough for any zone/DST slip
    const params = new URLSearchParams();
    params.set('timeMin', new Date(originalStartAt - WINDOW_MS).toISOString());
    params.set('timeMax', new Date(originalStartAt + WINDOW_MS).toISOString());
    params.set('maxResults', '50');
    params.set('showDeleted', 'true');

    const url = `${CAL_BASE}/${encodeURIComponent(googleCalId)}/events/${encodeURIComponent(masterId)}/instances?${params.toString()}`;
    const res = await googleSync.fetch<GCalEventsResponse>({ method: 'GET', url });
    if (!res.ok) return null;

    const wantedDay = toAllDayDateStr(originalStartAt);
    let sameDay: { id: string; delta: number } | null = null;

    for (const item of res.data?.items ?? []) {
      if (!item.id) continue;
      const slot = item.originalStartTime ?? item.start;
      const slotMs = slot?.date ? parseAllDayDate(slot.date) : Date.parse(slot?.dateTime ?? '');
      if (!Number.isFinite(slotMs)) continue;
      if (slotMs === originalStartAt) return item.id;
      if (allDay || toAllDayDateStr(slotMs) === wantedDay) {
        const delta = Math.abs(slotMs - originalStartAt);
        if (!sameDay || delta < sameDay.delta) sameDay = { id: item.id, delta };
      }
    }
    return sameDay?.id ?? null;
  }

  async pushTask(local: PlannerTask): Promise<SyncPushResult> {
    const body = mapPlannerTaskToGoogle(local);
    if (local.sourceId) {
      const url = `${TASKS_BASE}/lists/${encodeURIComponent(DEFAULT_TASKLIST)}/tasks/${encodeURIComponent(local.sourceId)}`;
      const res = await googleSync.fetch<GTask>({ method: 'PATCH', url, body });
      if (!res.ok) throw new Error(`Google Tasks update failed: ${res.error ?? 'unknown'}`);
      return { providerId: res.data?.id ?? local.sourceId, remoteUpdatedAt: remoteStamp(res.data?.updated) };
    }
    const url = `${TASKS_BASE}/lists/${encodeURIComponent(DEFAULT_TASKLIST)}/tasks`;
    const res = await googleSync.fetch<GTask>({ method: 'POST', url, body });
    if (!res.ok || !res.data?.id) throw new Error(`Google Tasks create failed: ${res.error ?? 'no id'}`);
    return { providerId: res.data.id, remoteUpdatedAt: remoteStamp(res.data.updated) };
  }

  async deleteTask(sourceId: string, remoteParentId?: string): Promise<void> {
    const list = remoteParentId || DEFAULT_TASKLIST;
    const url = `${TASKS_BASE}/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(sourceId)}`;
    const res = await googleSync.fetch({ method: 'DELETE', url });
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`Google Tasks delete failed: ${res.error ?? 'unknown'}`);
    }
  }
}
