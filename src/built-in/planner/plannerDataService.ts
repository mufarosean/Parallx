// plannerDataService.ts — typed wrapper around the shared workspace DB
// for planner_tasks + planner_events. Mirrors the canvas / dashboard
// pattern: direct IPC bridge, change-event emitter, no ORM.

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter, type Event } from '../../platform/events.js';
import type {
  CreateEventInput,
  CreateTaskInput,
  EventQuery,
  FreeSlot,
  FreeSlotRequest,
  PlannerChangeEvent,
  PlannerEvent,
  PlannerTask,
  TaskQuery,
  TaskStatus,
  UpdateEventInput,
  UpdateTaskInput,
} from './plannerTypes.js';

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
          completed_at, tags_json, source_uri, source_provider, source_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title,
        input.description ?? null,
        status,
        input.dueAt ?? null,
        input.reminderAt ?? null,
        status === 'done' ? now : null,
        JSON.stringify(input.tags ?? []),
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

  // ── Events ───────────────────────────────────────────────────────────

  async listEvents(query: EventQuery): Promise<PlannerEvent[]> {
    const limit = query.limit && query.limit > 0 ? `LIMIT ${Math.min(500, Math.floor(query.limit))}` : '';
    const res = await this._db.all(
      `SELECT * FROM planner_events
        WHERE end_at >= ? AND start_at <= ?
        ORDER BY start_at ASC ${limit}`,
      [query.from, query.to],
    );
    if (res.error) {
      console.error('[PlannerDataService] listEvents failed:', res.error.message);
      return [];
    }
    return (res.rows ?? []).map(rowToEvent);
  }

  async getEvent(id: string): Promise<PlannerEvent | null> {
    const res = await this._db.get(`SELECT * FROM planner_events WHERE id = ?`, [id]);
    if (res.error || !res.row) return null;
    return rowToEvent(res.row);
  }

  async createEvent(input: CreateEventInput): Promise<PlannerEvent> {
    const id = generateId('event');
    const now = Date.now();
    const startAt = input.startAt;
    const endAt = input.endAt ?? startAt + 60 * 60 * 1000; // default 1h
    if (endAt < startAt) throw new Error('createEvent: endAt must be >= startAt');

    const res = await this._db.run(
      `INSERT INTO planner_events
         (id, title, description, start_at, end_at, all_day, location,
          source_provider, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title,
        input.description ?? null,
        startAt,
        endAt,
        input.allDay ? 1 : 0,
        input.location ?? null,
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

    if (sets.length === 1) return existing;

    params.push(id);
    const res = await this._db.run(
      `UPDATE planner_events SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if (res.error) throw new Error(`updateEvent failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'event-updated', eventId: id });
    return this.getEvent(id);
  }

  async removeEvent(id: string): Promise<void> {
    const res = await this._db.run(`DELETE FROM planner_events WHERE id = ?`, [id]);
    if (res.error) throw new Error(`removeEvent failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'event-removed', eventId: id });
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
