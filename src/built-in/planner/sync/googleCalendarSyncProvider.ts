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
  ICalendarSyncProvider,
  PlannerEvent,
  PlannerTask,
  SyncedEvent,
  SyncedTask,
  SyncPullResult,
  SyncPullState,
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
  recurringEventId?: string;  // present on instance exceptions (skipped in v1)
  updated?: string;           // RFC3339
}
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
    recurrence: extractRrule(item.recurrence),
    updatedAt: item.updated ? Date.parse(item.updated) : Date.now(),
    sourceProvider: GOOGLE_PROVIDER_ID,
    sourceId: item.id,
  };
}

/** Planner event → Google event request body. */
export function mapPlannerEventToGoogle(local: PlannerEvent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: local.title,
    description: local.description ?? undefined,
    location: local.location ?? undefined,
  };
  if (local.allDay) {
    const endMs = local.endAt > local.startAt ? local.endAt : local.startAt + 86_400_000;
    body.start = { date: toAllDayDateStr(local.startAt) };
    body.end = { date: toAllDayDateStr(endMs) };
  } else {
    body.start = { dateTime: new Date(local.startAt).toISOString() };
    body.end = { dateTime: new Date(local.endAt).toISOString() };
  }
  if (local.recurrence) {
    const rule = local.recurrence.startsWith('RRULE:') ? local.recurrence : `RRULE:${local.recurrence}`;
    body.recurrence = [rule];
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
    dueAt: item.due ? Date.parse(item.due) : null,
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

// ─── Provider ──────────────────────────────────────────────────────────────────

export class GoogleCalendarSyncProvider implements ICalendarSyncProvider {
  readonly id = GOOGLE_PROVIDER_ID;
  readonly displayName = 'Google Calendar';

  constructor(private readonly _data: PlannerDataService) {}

  private _tokenKey(googleCalId: string): string {
    return `sync.${this.id}.cal.${googleCalId}.token`;
  }

  async wantsTaskSync(): Promise<boolean> {
    return (await this._data.getSetting(GOOGLE_TASKS_ENABLED_KEY)) === '1';
  }

  async pull(state: SyncPullState): Promise<SyncPullResult> {
    const cals = await this._data.listSyncedCalendars(this.id);
    const upsertedEvents: SyncedEvent[] = [];
    const deletedEventSourceIds: string[] = [];
    let anyReset = false;

    for (const cal of cals) {
      if (!cal.sourceId) continue;
      const r = await this._pullCalendar(cal.sourceId, cal.id, state.sinceMs);
      upsertedEvents.push(...r.upserted);
      deletedEventSourceIds.push(...r.deleted);
      if (r.reset) anyReset = true;
    }

    let upsertedTasks: SyncedTask[] | undefined;
    let deletedTaskSourceIds: string[] | undefined;
    if (await this.wantsTaskSync()) {
      const t = await this._pullTasks(state.sinceMs);
      upsertedTasks = t.upserted;
      deletedTaskSourceIds = t.deleted;
    }

    return { upsertedEvents, deletedEventSourceIds, upsertedTasks, deletedTaskSourceIds, reset: anyReset };
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

    await this._data.setSetting(wmKey, String(runStart));
    return { upserted, deleted };
  }

  /** Pull one calendar with pagination + a single 410 (expired token) recovery. */
  private async _pullCalendar(
    googleCalId: string,
    plannerCalId: string,
    sinceMs: number,
  ): Promise<{ upserted: SyncedEvent[]; deleted: string[]; reset: boolean }> {
    const upserted: SyncedEvent[] = [];
    const deleted: string[] = [];
    let reset = false;

    let token = (await this._data.getSetting(this._tokenKey(googleCalId))) || undefined;
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
          await this._data.setSetting(this._tokenKey(googleCalId), '');
          continue;
        }
        throw new Error(`Google Calendar pull failed (${googleCalId}): ${res.error ?? 'unknown'}`);
      }

      const body = res.data ?? {};
      for (const item of body.items ?? []) {
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

    if (nextSyncToken) await this._data.setSetting(this._tokenKey(googleCalId), nextSyncToken);
    return { upserted, deleted, reset };
  }

  async pushEvent(local: PlannerEvent): Promise<{ providerId: string }> {
    const cal = await this._data.getCalendar(local.calendarId ?? '');
    const googleCalId = cal?.sourceProvider === this.id ? cal.sourceId : null;
    if (!googleCalId) throw new Error(`Event ${local.id} is not in a Google-synced calendar`);

    const body = mapPlannerEventToGoogle(local);

    if (local.sourceId) {
      // Update existing remote event.
      const url = `${CAL_BASE}/${encodeURIComponent(googleCalId)}/events/${encodeURIComponent(local.sourceId)}`;
      const res = await googleSync.fetch<GCalEvent>({ method: 'PATCH', url, body });
      if (!res.ok) throw new Error(`Google Calendar update failed: ${res.error ?? 'unknown'}`);
      return { providerId: res.data?.id ?? local.sourceId };
    }

    // Create new remote event.
    const url = `${CAL_BASE}/${encodeURIComponent(googleCalId)}/events`;
    const res = await googleSync.fetch<GCalEvent>({ method: 'POST', url, body });
    if (!res.ok || !res.data?.id) throw new Error(`Google Calendar create failed: ${res.error ?? 'no id'}`);
    return { providerId: res.data.id };
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

  async pushTask(local: PlannerTask): Promise<{ providerId: string }> {
    const body = mapPlannerTaskToGoogle(local);
    if (local.sourceId) {
      const url = `${TASKS_BASE}/lists/${encodeURIComponent(DEFAULT_TASKLIST)}/tasks/${encodeURIComponent(local.sourceId)}`;
      const res = await googleSync.fetch<GTask>({ method: 'PATCH', url, body });
      if (!res.ok) throw new Error(`Google Tasks update failed: ${res.error ?? 'unknown'}`);
      return { providerId: res.data?.id ?? local.sourceId };
    }
    const url = `${TASKS_BASE}/lists/${encodeURIComponent(DEFAULT_TASKLIST)}/tasks`;
    const res = await googleSync.fetch<GTask>({ method: 'POST', url, body });
    if (!res.ok || !res.data?.id) throw new Error(`Google Tasks create failed: ${res.error ?? 'no id'}`);
    return { providerId: res.data.id };
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
