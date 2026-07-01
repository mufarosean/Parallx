// plannerDataService.ts — typed wrapper around the shared workspace DB
// for planner_tasks + planner_events. Mirrors the canvas / dashboard
// pattern: direct IPC bridge, change-event emitter, no ORM.

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter, type Event } from '../../platform/events.js';
import type {
  CreateCalendarInput,
  CreateEventInput,
  CreateTaskInput,
  EventQuery,
  FreeSlot,
  FreeSlotRequest,
  PlannerCalendar,
  PlannerChangeEvent,
  PlannerEvent,
  PlannerTask,
  SyncedEvent,
  SyncedTask,
  SyncDeletion,
  TaskQuery,
  TaskStatus,
  UpdateCalendarInput,
  UpdateEventInput,
  UpdateTaskInput,
} from './plannerTypes.js';
import { expandRecurrence } from './plannerRecurrence.js';

/**
 * Setting key: which calendar new events land in when a caller (quick-add, the
 * chat agent) doesn't name one. Empty = "auto": prefer a Google-synced calendar
 * so agent/quick-added events reach Google by default, else the local Personal
 * calendar. Stored in planner_settings (same mechanism as the Google toggles).
 */
export const DEFAULT_EVENT_CALENDAR_KEY = 'planner.defaultEventCalendar';

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): PlannerTask {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse((row.tags_json as string) ?? '[]');
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch { /* keep [] */ }
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    description: (row.description as string) ?? null,
    status: (row.status as TaskStatus) ?? 'reviewing',
    dueAt: typeof row.due_at === 'number' ? row.due_at : null,
    reminderAt: typeof row.reminder_at === 'number' ? row.reminder_at : null,
    reminderFired: ((row.reminder_fired as number) ?? 0) !== 0,
    completedAt: typeof row.completed_at === 'number' ? row.completed_at : null,
    tags,
    calendarId: (row.calendar_id as string) ?? null,
    color: (row.color as string) ?? null,
    sourceUri: (row.source_uri as string) ?? null,
    sourceProvider: (row.source_provider as string) ?? null,
    sourceId: (row.source_id as string) ?? null,
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  };
}

function rowToEvent(row: Record<string, unknown>): PlannerEvent {
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    description: (row.description as string) ?? null,
    startAt: (row.start_at as number) ?? 0,
    endAt: (row.end_at as number) ?? 0,
    allDay: ((row.all_day as number) ?? 0) !== 0,
    location: (row.location as string) ?? null,
    calendarId: (row.calendar_id as string) ?? null,
    color: (row.color as string) ?? null,
    recurrence: (row.recurrence as string) ?? null,
    sourceProvider: (row.source_provider as string) ?? null,
    sourceId: (row.source_id as string) ?? null,
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  };
}

function rowToCalendar(row: Record<string, unknown>): PlannerCalendar {
  return {
    id: row.id as string,
    name: (row.name as string) ?? 'Calendar',
    color: (row.color as string) ?? '#4c8bf5',
    visible: ((row.visible as number) ?? 1) !== 0,
    isDefault: ((row.is_default as number) ?? 0) !== 0,
    sortOrder: (row.sort_order as number) ?? 0,
    sourceProvider: (row.source_provider as string) ?? null,
    sourceId: (row.source_id as string) ?? null,
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  };
}

function generateId(prefix: string): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Expanded recurring instances carry an id of `${baseId}::${startMs}`; edits
 *  and deletes resolve to the base series row. */
function baseEventId(id: string): string {
  const i = id.indexOf('::');
  return i >= 0 ? id.slice(0, i) : id;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PlannerDataService extends Disposable {
  private readonly _onDidChange = this._register(new Emitter<PlannerChangeEvent>());
  readonly onDidChange: Event<PlannerChangeEvent> = this._onDidChange.event;

  private get _db(): DatabaseBridge {
    const electron = (window as { parallxElectron?: { database?: DatabaseBridge } }).parallxElectron;
    if (!electron?.database) {
      throw new Error('[PlannerDataService] window.parallxElectron.database not available');
    }
    return electron.database;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────

  async listTasks(query: TaskQuery = {}): Promise<PlannerTask[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      if (statuses.length > 0) {
        where.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
    } else {
      where.push(`status != 'cancelled'`);
    }

    if (typeof query.dueFrom === 'number') {
      if (query.includeUndated) {
        where.push(`(due_at IS NULL OR due_at >= ?)`);
      } else {
        where.push(`due_at >= ?`);
      }
      params.push(query.dueFrom);
    }
    if (typeof query.dueTo === 'number') {
      where.push(`due_at <= ?`);
      params.push(query.dueTo);
    }
    if (query.tags && query.tags.length > 0) {
      // LIKE matches against the JSON array; cheap-and-correct enough.
      for (const tag of query.tags) {
        where.push(`tags_json LIKE ?`);
        params.push(`%${JSON.stringify(tag)}%`);
      }
    }

    const orderBy =
      query.orderBy === 'created' ? `created_at DESC`
      : query.orderBy === 'updated' ? `updated_at DESC`
      : `(due_at IS NULL), due_at ASC, created_at DESC`;
    const limit = query.limit && query.limit > 0 ? `LIMIT ${Math.min(500, Math.floor(query.limit))}` : '';

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM planner_tasks ${whereClause} ORDER BY ${orderBy} ${limit}`;
    const res = await this._db.all(sql, params);
    if (res.error) {
      console.error('[PlannerDataService] listTasks failed:', res.error.message);
      return [];
    }
    return (res.rows ?? []).map(rowToTask);
  }

  async getTask(id: string): Promise<PlannerTask | null> {
    const res = await this._db.get(`SELECT * FROM planner_tasks WHERE id = ?`, [id]);
    if (res.error || !res.row) return null;
    return rowToTask(res.row);
  }

  async createTask(input: CreateTaskInput): Promise<PlannerTask> {
    const id = generateId('task');
    const now = Date.now();
    const status: TaskStatus = input.status ?? 'reviewing';

    const res = await this._db.run(
      `INSERT INTO planner_tasks
         (id, title, description, status, due_at, reminder_at, reminder_fired,
          completed_at, tags_json, calendar_id, color, source_uri, source_provider, source_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title,
        input.description ?? null,
        status,
        input.dueAt ?? null,
        input.reminderAt ?? null,
        status === 'done' ? now : null,
        JSON.stringify(input.tags ?? []),
        input.calendarId ?? 'cal-tasks',
        input.color ?? null,
        input.sourceUri ?? null,
        input.sourceProvider ?? null,
        input.sourceId ?? null,
        now,
        now,
      ],
    );
    if (res.error) throw new Error(`createTask failed: ${res.error.message}`);

    this._onDidChange.fire({ kind: 'task-created', taskId: id });
    const task = await this.getTask(id);
    if (!task) throw new Error('createTask: row not found after insert');
    return task;
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<PlannerTask | null> {
    const existing = await this.getTask(id);
    if (!existing) return null;

    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title); }
    if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
      // Auto-stamp completed_at when transitioning to done, clear when leaving done.
      if (patch.status === 'done' && existing.status !== 'done') {
        sets.push('completed_at = ?');
        params.push(now);
      } else if (patch.status !== 'done' && existing.status === 'done') {
        sets.push('completed_at = NULL');
      }
    }
    if (patch.dueAt !== undefined) { sets.push('due_at = ?'); params.push(patch.dueAt); }
    if (patch.reminderAt !== undefined) {
      sets.push('reminder_at = ?'); params.push(patch.reminderAt);
      // New reminder = unfire it so the scheduler can pick it up.
      sets.push('reminder_fired = 0');
    }
    if (patch.tags !== undefined) { sets.push('tags_json = ?'); params.push(JSON.stringify(patch.tags)); }
    if (patch.calendarId !== undefined) { sets.push('calendar_id = ?'); params.push(patch.calendarId); }
    if (patch.color !== undefined) { sets.push('color = ?'); params.push(patch.color); }
    if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(patch.completedAt); }

    if (sets.length === 1) return existing; // only updated_at would change — skip

    params.push(id);
    const res = await this._db.run(
      `UPDATE planner_tasks SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if (res.error) throw new Error(`updateTask failed: ${res.error.message}`);

    this._onDidChange.fire({ kind: 'task-updated', taskId: id });
    return this.getTask(id);
  }

  async removeTask(id: string): Promise<void> {
    const existing = await this.getTask(id);
    if (existing) await this._recordTaskTombstone(existing);
    const res = await this._db.run(`DELETE FROM planner_tasks WHERE id = ?`, [id]);
    if (res.error) throw new Error(`removeTask failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'task-removed', taskId: id });
  }

  /** Tasks whose reminder is due and not yet fired. Used by the reminder scheduler. */
  async listDueReminders(nowMs: number): Promise<PlannerTask[]> {
    const res = await this._db.all(
      `SELECT * FROM planner_tasks
        WHERE reminder_at IS NOT NULL
          AND reminder_at <= ?
          AND reminder_fired = 0
          AND status NOT IN ('done', 'cancelled')`,
      [nowMs],
    );
    if (res.error) return [];
    return (res.rows ?? []).map(rowToTask);
  }

  async markReminderFired(taskId: string): Promise<void> {
    await this._db.run(
      `UPDATE planner_tasks SET reminder_fired = 1, updated_at = ? WHERE id = ?`,
      [Date.now(), taskId],
    );
  }

  // ── Settings (planner_settings KV — backs the Settings hub panel) ─────

  async getSetting(key: string): Promise<string | null> {
    const res = await this._db.get(`SELECT value FROM planner_settings WHERE key = ?`, [key]);
    if (res.error || !res.row) return null;
    return typeof res.row.value === 'string' ? res.row.value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const res = await this._db.run(
      `INSERT INTO planner_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
    if (res.error) throw new Error(`setSetting failed: ${res.error.message}`);
  }

  /** Default length (minutes) for a new event when no explicit end is given. */
  async getDefaultEventMinutes(): Promise<number> {
    const raw = await this.getSetting('defaultEventMinutes');
    const n = raw != null ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 60;
  }

  async setDefaultEventMinutes(minutes: number): Promise<void> {
    await this.setSetting('defaultEventMinutes', String(Math.max(5, Math.round(minutes))));
  }

  // ── Events ───────────────────────────────────────────────────────────

  async listEvents(query: EventQuery): Promise<PlannerEvent[]> {
    const cap = query.limit && query.limit > 0 ? Math.min(500, Math.floor(query.limit)) : 500;

    // 1. Concrete (non-recurring) events overlapping the window.
    const baseRes = await this._db.all(
      `SELECT * FROM planner_events
        WHERE (recurrence IS NULL OR recurrence = '')
          AND end_at >= ? AND start_at <= ?
        ORDER BY start_at ASC`,
      [query.from, query.to],
    );
    if (baseRes.error) {
      console.error('[PlannerDataService] listEvents failed:', baseRes.error.message);
      return [];
    }
    const events: PlannerEvent[] = (baseRes.rows ?? []).map(rowToEvent);

    // 2. Recurring base rows whose series could reach the window, expanded.
    const recRes = await this._db.all(
      `SELECT * FROM planner_events
        WHERE recurrence IS NOT NULL AND recurrence != '' AND start_at <= ?`,
      [query.to],
    );
    if (!recRes.error) {
      for (const row of recRes.rows ?? []) {
        const baseEvent = rowToEvent(row);
        if (!baseEvent.recurrence) continue;
        const durationMs = Math.max(0, baseEvent.endAt - baseEvent.startAt);
        for (const occ of expandRecurrence(baseEvent.startAt, durationMs, baseEvent.recurrence, query.from, query.to)) {
          events.push({
            ...baseEvent,
            id: `${baseEvent.id}::${occ.startAt}`,
            startAt: occ.startAt,
            endAt: occ.endAt,
            seriesId: baseEvent.id,
          });
        }
      }
    }

    events.sort((a, b) => a.startAt - b.startAt);
    return events.length > cap ? events.slice(0, cap) : events;
  }

  async getEvent(id: string): Promise<PlannerEvent | null> {
    const res = await this._db.get(`SELECT * FROM planner_events WHERE id = ?`, [baseEventId(id)]);
    if (res.error || !res.row) return null;
    return rowToEvent(res.row);
  }

  /**
   * Which calendar a new event lands in when the caller doesn't name one.
   * Order: the user's configured default (if it still exists) → any Google-synced
   * calendar (so agent/quick-added events reach Google by default) → the local
   * Personal calendar. This is the seam that makes "put a meeting on my Google
   * calendar" actually reach Google without the caller knowing calendar ids.
   */
  async resolveDefaultEventCalendarId(): Promise<string> {
    const all = await this.listCalendars();
    const configured = (await this.getSetting(DEFAULT_EVENT_CALENDAR_KEY)) || '';
    if (configured && all.some((c) => c.id === configured)) return configured;
    const synced = all.find((c) => !!c.sourceProvider); // a mirror of a remote (Google) calendar
    if (synced) return synced.id;
    return all.some((c) => c.id === 'cal-personal') ? 'cal-personal' : (all[0]?.id ?? 'cal-personal');
  }

  async createEvent(input: CreateEventInput): Promise<PlannerEvent> {
    const id = generateId('event');
    const now = Date.now();
    const startAt = input.startAt;
    const endAt = input.endAt ?? startAt + (await this.getDefaultEventMinutes()) * 60 * 1000;
    if (endAt < startAt) throw new Error('createEvent: endAt must be >= startAt');
    const calendarId = input.calendarId ?? (await this.resolveDefaultEventCalendarId());

    const res = await this._db.run(
      `INSERT INTO planner_events
         (id, title, description, start_at, end_at, all_day, location,
          calendar_id, color, recurrence, source_provider, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title,
        input.description ?? null,
        startAt,
        endAt,
        input.allDay ? 1 : 0,
        input.location ?? null,
        calendarId,
        input.color ?? null,
        input.recurrence ?? null,
        input.sourceProvider ?? null,
        input.sourceId ?? null,
        now,
        now,
      ],
    );
    if (res.error) throw new Error(`createEvent failed: ${res.error.message}`);

    this._onDidChange.fire({ kind: 'event-created', eventId: id });
    const event = await this.getEvent(id);
    if (!event) throw new Error('createEvent: row not found after insert');
    return event;
  }

  async updateEvent(id: string, patch: UpdateEventInput): Promise<PlannerEvent | null> {
    const existing = await this.getEvent(id);
    if (!existing) return null;
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title); }
    if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }
    if (patch.startAt !== undefined) { sets.push('start_at = ?'); params.push(patch.startAt); }
    if (patch.endAt !== undefined) { sets.push('end_at = ?'); params.push(patch.endAt); }
    if (patch.allDay !== undefined) { sets.push('all_day = ?'); params.push(patch.allDay ? 1 : 0); }
    if (patch.location !== undefined) { sets.push('location = ?'); params.push(patch.location); }
    if (patch.calendarId !== undefined) { sets.push('calendar_id = ?'); params.push(patch.calendarId); }
    if (patch.color !== undefined) { sets.push('color = ?'); params.push(patch.color); }
    if (patch.recurrence !== undefined) { sets.push('recurrence = ?'); params.push(patch.recurrence); }

    if (sets.length === 1) return existing;

    params.push(baseEventId(id));
    const res = await this._db.run(
      `UPDATE planner_events SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if (res.error) throw new Error(`updateEvent failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'event-updated', eventId: baseEventId(id) });
    return this.getEvent(id);
  }

  async removeEvent(id: string): Promise<void> {
    // Record a tombstone first (while we can still resolve the remote parent),
    // so the orchestrator can delete the upstream copy on the next sync.
    const existing = await this.getEvent(id);
    if (existing) await this._recordEventTombstone(existing);
    const res = await this._db.run(`DELETE FROM planner_events WHERE id = ?`, [baseEventId(id)]);
    if (res.error) throw new Error(`removeEvent failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'event-removed', eventId: baseEventId(id) });
  }

  // ── Calendars ─────────────────────────────────────────────────────────

  async listCalendars(): Promise<PlannerCalendar[]> {
    const res = await this._db.all(`SELECT * FROM planner_calendars ORDER BY sort_order ASC, name ASC`);
    if (res.error) { console.error('[PlannerDataService] listCalendars failed:', res.error.message); return []; }
    return (res.rows ?? []).map(rowToCalendar);
  }

  async getCalendar(id: string): Promise<PlannerCalendar | null> {
    const res = await this._db.get(`SELECT * FROM planner_calendars WHERE id = ?`, [id]);
    if (res.error || !res.row) return null;
    return rowToCalendar(res.row);
  }

  async createCalendar(input: CreateCalendarInput): Promise<PlannerCalendar> {
    const id = generateId('cal');
    const now = Date.now();
    const max = await this._db.get(`SELECT MAX(sort_order) AS m FROM planner_calendars`);
    const order = (max.row && typeof max.row.m === 'number') ? max.row.m + 1 : 100;
    const res = await this._db.run(
      `INSERT INTO planner_calendars (id, name, color, visible, is_default, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      [id, input.name, input.color ?? '#4c8bf5', input.visible === false ? 0 : 1, order, now, now],
    );
    if (res.error) throw new Error(`createCalendar failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'calendar-changed', calendarId: id });
    const cal = await this.getCalendar(id);
    if (!cal) throw new Error('createCalendar: row not found after insert');
    return cal;
  }

  async updateCalendar(id: string, patch: UpdateCalendarInput): Promise<void> {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [Date.now()];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.color !== undefined) { sets.push('color = ?'); params.push(patch.color); }
    if (patch.visible !== undefined) { sets.push('visible = ?'); params.push(patch.visible ? 1 : 0); }
    if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(patch.sortOrder); }
    if (sets.length === 1) return;
    params.push(id);
    const res = await this._db.run(`UPDATE planner_calendars SET ${sets.join(', ')} WHERE id = ?`, params);
    if (res.error) throw new Error(`updateCalendar failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'calendar-changed', calendarId: id });
  }

  /**
   * Delete a calendar. Its events and tasks are reassigned to the default
   * calendar (never deleted with it). The default calendar can't be removed.
   */
  async deleteCalendar(id: string): Promise<{ ok: boolean; reason?: string }> {
    const cal = await this.getCalendar(id);
    if (!cal) return { ok: false, reason: 'Calendar not found.' };
    if (cal.isDefault) return { ok: false, reason: 'The default calendar can’t be deleted.' };
    const all = await this.listCalendars();
    const fallback = all.find(c => c.isDefault && c.id !== id) ?? all.find(c => c.id !== id);
    const fallbackId = fallback ? fallback.id : null;
    await this._db.run(`UPDATE planner_events SET calendar_id = ? WHERE calendar_id = ?`, [fallbackId, id]);
    await this._db.run(`UPDATE planner_tasks SET calendar_id = ? WHERE calendar_id = ?`, [fallbackId, id]);
    const res = await this._db.run(`DELETE FROM planner_calendars WHERE id = ?`, [id]);
    if (res.error) throw new Error(`deleteCalendar failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'calendar-changed', calendarId: id });
    return { ok: true };
  }

  /**
   * Raw rows for one calendar, for iCalendar (.ics) export. Events are the
   * base rows (recurrence kept as the stored RRULE — NOT expanded into
   * instances), so a recurring series exports as a single VEVENT + RRULE.
   * Cancelled tasks are excluded.
   */
  async getCalendarExport(calendarId: string): Promise<{ events: PlannerEvent[]; tasks: PlannerTask[] }> {
    const evRes = await this._db.all(
      `SELECT * FROM planner_events WHERE calendar_id = ? ORDER BY start_at ASC`,
      [calendarId],
    );
    const events = evRes.error ? [] : (evRes.rows ?? []).map(rowToEvent);
    const tkRes = await this._db.all(
      `SELECT * FROM planner_tasks WHERE calendar_id = ? AND status != 'cancelled' ORDER BY (due_at IS NULL), due_at ASC`,
      [calendarId],
    );
    const tasks = tkRes.error ? [] : (tkRes.rows ?? []).map(rowToTask);
    return { events, tasks };
  }

  // ── Sync support (two-way provider sync) ──────────────────────────────

  async getEventBySource(provider: string, sourceId: string): Promise<PlannerEvent | null> {
    const res = await this._db.get(
      `SELECT * FROM planner_events WHERE source_provider = ? AND source_id = ?`,
      [provider, sourceId],
    );
    if (res.error || !res.row) return null;
    return rowToEvent(res.row);
  }

  async getTaskBySource(provider: string, sourceId: string): Promise<PlannerTask | null> {
    const res = await this._db.get(
      `SELECT * FROM planner_tasks WHERE source_provider = ? AND source_id = ?`,
      [provider, sourceId],
    );
    if (res.error || !res.row) return null;
    return rowToTask(res.row);
  }

  /** Calendars mirrored from a provider (source_provider = provider). */
  async listSyncedCalendars(provider: string): Promise<PlannerCalendar[]> {
    const res = await this._db.all(
      `SELECT * FROM planner_calendars WHERE source_provider = ? ORDER BY name ASC`,
      [provider],
    );
    if (res.error) return [];
    return (res.rows ?? []).map(rowToCalendar);
  }

  /**
   * Create or update a calendar mirror for a provider calendar. Returns the
   * local planner calendar id. Used when the user enables a Google calendar.
   */
  async upsertCalendarFromSync(
    provider: string,
    sourceId: string,
    patch: { name?: string; color?: string },
  ): Promise<string> {
    const now = Date.now();
    const existing = await this._db.get(
      `SELECT * FROM planner_calendars WHERE source_provider = ? AND source_id = ?`,
      [provider, sourceId],
    );
    if (existing.row) {
      const cal = rowToCalendar(existing.row);
      const sets: string[] = ['updated_at = ?'];
      const params: unknown[] = [now];
      if (patch.name !== undefined && patch.name !== cal.name) { sets.push('name = ?'); params.push(patch.name); }
      if (patch.color !== undefined && patch.color !== cal.color) { sets.push('color = ?'); params.push(patch.color); }
      if (sets.length > 1) {
        params.push(cal.id);
        await this._db.run(`UPDATE planner_calendars SET ${sets.join(', ')} WHERE id = ?`, params);
        this._onDidChange.fire({ kind: 'calendar-changed', calendarId: cal.id });
      }
      return cal.id;
    }
    const id = generateId('cal');
    const max = await this._db.get(`SELECT MAX(sort_order) AS m FROM planner_calendars`);
    const order = (max.row && typeof max.row.m === 'number') ? max.row.m + 1 : 100;
    const res = await this._db.run(
      `INSERT INTO planner_calendars
         (id, name, color, visible, is_default, sort_order, source_provider, source_id, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
      [id, patch.name ?? 'Google calendar', patch.color ?? '#4c8bf5', order, provider, sourceId, now, now],
    );
    if (res.error) throw new Error(`upsertCalendarFromSync failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'calendar-changed', calendarId: id });
    return id;
  }

  /**
   * Stop syncing a provider calendar: drop its mirror and the (remote-sourced)
   * rows it held. Unlike deleteCalendar this does NOT reassign events to the
   * default calendar — they were Google's copies and stay on Google.
   */
  async removeSyncedCalendar(provider: string, sourceId: string): Promise<void> {
    const cal = (await this.listSyncedCalendars(provider)).find((c) => c.sourceId === sourceId);
    if (!cal) return;
    await this._db.run(`DELETE FROM planner_events WHERE calendar_id = ?`, [cal.id]);
    await this._db.run(`DELETE FROM planner_tasks WHERE calendar_id = ?`, [cal.id]);
    await this._db.run(`DELETE FROM planner_calendars WHERE id = ?`, [cal.id]);
    this._onDidChange.fire({ kind: 'calendar-changed', calendarId: cal.id });
  }

  /**
   * Events needing a push upstream: living in a provider-synced calendar and
   * edited locally since the last reconcile (or never pushed). Base rows only —
   * recurrence is left as the stored RRULE, never expanded.
   */
  async listEventsToPush(provider: string): Promise<PlannerEvent[]> {
    const res = await this._db.all(
      `SELECT e.* FROM planner_events e
         JOIN planner_calendars c ON c.id = e.calendar_id
        WHERE c.source_provider = ?
          AND (e.synced_at IS NULL OR e.updated_at > e.synced_at)`,
      [provider],
    );
    if (res.error) {
      console.error('[PlannerDataService] listEventsToPush failed:', res.error.message);
      return [];
    }
    return (res.rows ?? []).map(rowToEvent);
  }

  /**
   * Apply a remote event upsert, keyed by (source_provider, source_id). Stamps
   * `synced_at = updated_at = now` (local clock) so the row is not re-detected as
   * a local edit on the next push — echo-proof regardless of provider clock skew.
   */
  async upsertEventFromSync(synced: SyncedEvent): Promise<void> {
    const now = Date.now();
    const provider = synced.sourceProvider;
    const sourceId = synced.sourceId;
    const existing = await this.getEventBySource(provider, sourceId);
    const vals = [
      synced.title,
      synced.description ?? null,
      synced.startAt,
      synced.endAt,
      synced.allDay ? 1 : 0,
      synced.location ?? null,
      synced.calendarId ?? null,
      synced.color ?? null,
      synced.recurrence ?? null,
    ];
    if (existing) {
      const res = await this._db.run(
        `UPDATE planner_events
            SET title=?, description=?, start_at=?, end_at=?, all_day=?, location=?,
                calendar_id=?, color=?, recurrence=?, updated_at=?, synced_at=?
          WHERE id=?`,
        [...vals, now, now, existing.id],
      );
      if (res.error) throw new Error(`upsertEventFromSync(update) failed: ${res.error.message}`);
      this._onDidChange.fire({ kind: 'event-updated', eventId: existing.id });
    } else {
      const id = generateId('event');
      const res = await this._db.run(
        `INSERT INTO planner_events
           (id, title, description, start_at, end_at, all_day, location, calendar_id, color,
            recurrence, source_provider, source_id, created_at, updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ...vals, provider, sourceId, now, now, now],
      );
      if (res.error) throw new Error(`upsertEventFromSync(insert) failed: ${res.error.message}`);
      this._onDidChange.fire({ kind: 'event-created', eventId: id });
    }
  }

  /**
   * Tasks needing a push upstream: edited locally since the last reconcile (or
   * never pushed) and not cancelled. Tasks sync to a single provider list, so
   * (unlike events) there is no per-calendar filter.
   */
  async listTasksToPush(): Promise<PlannerTask[]> {
    const res = await this._db.all(
      `SELECT * FROM planner_tasks
        WHERE status != 'cancelled'
          AND (synced_at IS NULL OR updated_at > synced_at)`,
    );
    if (res.error) {
      console.error('[PlannerDataService] listTasksToPush failed:', res.error.message);
      return [];
    }
    return (res.rows ?? []).map(rowToTask);
  }

  /** Apply a remote task upsert, keyed by (source_provider, source_id). Echo-proof
   *  via synced_at = updated_at = now (see upsertEventFromSync). */
  async upsertTaskFromSync(synced: SyncedTask): Promise<void> {
    const now = Date.now();
    const provider = synced.sourceProvider;
    const sourceId = synced.sourceId;
    const existing = await this.getTaskBySource(provider, sourceId);
    const status: TaskStatus = synced.status ?? 'planned';
    const vals = [
      synced.title,
      synced.description ?? null,
      status,
      synced.dueAt ?? null,
      synced.completedAt ?? (status === 'done' ? now : null),
      JSON.stringify(synced.tags ?? []),
      synced.calendarId ?? 'cal-tasks',
    ];
    if (existing) {
      const res = await this._db.run(
        `UPDATE planner_tasks
            SET title=?, description=?, status=?, due_at=?, completed_at=?, tags_json=?,
                calendar_id=?, updated_at=?, synced_at=?
          WHERE id=?`,
        [...vals, now, now, existing.id],
      );
      if (res.error) throw new Error(`upsertTaskFromSync(update) failed: ${res.error.message}`);
      this._onDidChange.fire({ kind: 'task-updated', taskId: existing.id });
    } else {
      const id = generateId('task');
      const res = await this._db.run(
        `INSERT INTO planner_tasks
           (id, title, description, status, due_at, reminder_at, reminder_fired, completed_at,
            tags_json, calendar_id, color, source_uri, source_provider, source_id,
            created_at, updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        [id, vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], provider, sourceId, now, now, now],
      );
      if (res.error) throw new Error(`upsertTaskFromSync(insert) failed: ${res.error.message}`);
      this._onDidChange.fire({ kind: 'task-created', taskId: id });
    }
  }

  /** Mark a local task as reconciled after a successful push. */
  async markTaskSynced(id: string, provider: string, sourceId: string): Promise<void> {
    const res = await this._db.run(
      `UPDATE planner_tasks SET source_provider=?, source_id=?, synced_at=? WHERE id=?`,
      [provider, sourceId, Date.now(), id],
    );
    if (res.error) throw new Error(`markTaskSynced failed: ${res.error.message}`);
  }

  /** Mark a local event as reconciled after a successful push. */
  async markEventSynced(id: string, provider: string, sourceId: string): Promise<void> {
    const res = await this._db.run(
      `UPDATE planner_events SET source_provider=?, source_id=?, synced_at=? WHERE id=?`,
      [provider, sourceId, Date.now(), id],
    );
    if (res.error) throw new Error(`markEventSynced failed: ${res.error.message}`);
  }

  /** Delete a local event mirror in response to a remote deletion (no tombstone). */
  async applyRemoteEventDeletion(provider: string, sourceId: string): Promise<void> {
    const local = await this.getEventBySource(provider, sourceId);
    if (!local) return;
    const res = await this._db.run(`DELETE FROM planner_events WHERE id = ?`, [local.id]);
    if (res.error) throw new Error(`applyRemoteEventDeletion failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'event-removed', eventId: local.id });
  }

  /** Delete a local task mirror in response to a remote deletion (no tombstone). */
  async applyRemoteTaskDeletion(provider: string, sourceId: string): Promise<void> {
    const local = await this.getTaskBySource(provider, sourceId);
    if (!local) return;
    const res = await this._db.run(`DELETE FROM planner_tasks WHERE id = ?`, [local.id]);
    if (res.error) throw new Error(`applyRemoteTaskDeletion failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'task-removed', taskId: local.id });
  }

  // ── Deletion tombstones (local deletes pending upstream propagation) ───

  private async _recordEventTombstone(ev: PlannerEvent): Promise<void> {
    if (!ev.sourceProvider || !ev.sourceId) return; // local-only — nothing upstream
    let remoteParent: string | null = null;
    if (ev.calendarId) {
      const cal = await this.getCalendar(ev.calendarId);
      if (cal?.sourceProvider === ev.sourceProvider && cal.sourceId) remoteParent = cal.sourceId;
    }
    await this._db.run(
      `INSERT INTO planner_sync_deletions (provider, source_id, kind, remote_parent, deleted_at)
       VALUES (?, ?, 'event', ?, ?)
       ON CONFLICT(provider, source_id) DO UPDATE SET remote_parent=excluded.remote_parent, deleted_at=excluded.deleted_at`,
      [ev.sourceProvider, ev.sourceId, remoteParent, Date.now()],
    );
  }

  private async _recordTaskTombstone(t: PlannerTask): Promise<void> {
    if (!t.sourceProvider || !t.sourceId) return;
    // remote_parent (tasklist id) is resolved by the provider at delete time
    // from its stored tasklist mapping; tasks live in one list in v1.
    await this._db.run(
      `INSERT INTO planner_sync_deletions (provider, source_id, kind, remote_parent, deleted_at)
       VALUES (?, ?, 'task', NULL, ?)
       ON CONFLICT(provider, source_id) DO UPDATE SET deleted_at=excluded.deleted_at`,
      [t.sourceProvider, t.sourceId, Date.now()],
    );
  }

  /** Pending local deletions awaiting upstream propagation for a provider. */
  async listDeletions(provider: string): Promise<SyncDeletion[]> {
    const res = await this._db.all(
      `SELECT provider, source_id, kind, remote_parent FROM planner_sync_deletions WHERE provider = ?`,
      [provider],
    );
    if (res.error) return [];
    return (res.rows ?? []).map((r) => ({
      provider: r.provider as string,
      sourceId: r.source_id as string,
      kind: (r.kind as 'event' | 'task') ?? 'event',
      remoteParent: (r.remote_parent as string) ?? null,
    }));
  }

  /** Clear a tombstone once the provider has confirmed the upstream delete. */
  async clearDeletion(provider: string, sourceId: string): Promise<void> {
    await this._db.run(
      `DELETE FROM planner_sync_deletions WHERE provider = ? AND source_id = ?`,
      [provider, sourceId],
    );
  }

  // ── Free-slot scheduling ──────────────────────────────────────────────

  /**
   * Find the first open block of `durationMinutes` within the next
   * `withinDays`, accounting for existing events. Working window defaults
   * to 09:00-18:00 local time. Simple sweep — events sorted by start, walk
   * forward looking for a gap.
   *
   * Returns null if no slot fits.
   */
  async findFreeSlot(req: FreeSlotRequest): Promise<FreeSlot | null> {
    const durationMs = Math.max(15, Math.floor(req.durationMinutes)) * 60 * 1000;
    const withinDays = Math.max(1, Math.min(60, Math.floor(req.withinDays)));
    const startHour = Math.max(0, Math.min(23, req.startHour ?? 9));
    const endHour = Math.max(startHour + 1, Math.min(24, req.endHour ?? 18));

    const now = Date.now();
    const windowEnd = now + withinDays * 86_400_000;
    const events = await this.listEvents({ from: now, to: windowEnd });

    // Walk hour-by-hour through the next `withinDays`, intersecting the
    // working window per day. Stop at the first contiguous gap of
    // duration ≥ durationMs.
    let cursor = new Date(now);
    // Round cursor up to the next 15-min boundary so suggestions look human.
    cursor.setMinutes(Math.ceil(cursor.getMinutes() / 15) * 15, 0, 0);

    while (cursor.getTime() < windowEnd) {
      const hour = cursor.getHours();
      if (hour < startHour) {
        cursor.setHours(startHour, 0, 0, 0);
        continue;
      }
      if (hour >= endHour) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(startHour, 0, 0, 0);
        continue;
      }

      // Day-end clamp.
      const dayEnd = new Date(cursor);
      dayEnd.setHours(endHour, 0, 0, 0);

      // Largest open chunk = from cursor to the next event start (or day end).
      const slotStart = cursor.getTime();
      let slotEnd = Math.min(dayEnd.getTime(), windowEnd);
      for (const ev of events) {
        if (ev.endAt <= slotStart) continue;
        if (ev.startAt < slotEnd) {
          slotEnd = Math.min(slotEnd, ev.startAt);
        }
      }
      if (slotEnd - slotStart >= durationMs) {
        return { startAt: slotStart, endAt: slotStart + durationMs };
      }

      // Jump cursor past whatever event blocked us (or day-end).
      let nextCursor = slotEnd;
      for (const ev of events) {
        if (ev.startAt <= slotStart && ev.endAt > slotStart) {
          nextCursor = Math.max(nextCursor, ev.endAt);
        }
      }
      if (nextCursor <= slotStart) {
        // No event blocked us yet duration didn't fit — push to next day.
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(startHour, 0, 0, 0);
      } else {
        cursor = new Date(nextCursor);
      }
    }
    return null;
  }
}
