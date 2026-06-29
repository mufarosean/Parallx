// plannerTypes.ts — public types for the planner tool.
//
// Kept narrow on purpose — these are the shapes that cross extension and
// widget boundaries (chat tools, dashboard widgets, future sync providers).

// ─── Tasks ───────────────────────────────────────────────────────────────────

/**
 * Lifecycle:
 *   - reviewing: captured fast, due date defaulted, user hasn't picked a real
 *     date yet. Surfaced in the editor's Review queue.
 *   - planned: user (or AI) has set a real date.
 *   - done: completed_at populated.
 *   - cancelled: soft-deleted; still in the DB but excluded from the default
 *     UI views.
 */
export type TaskStatus = 'reviewing' | 'planned' | 'done' | 'cancelled';

export interface PlannerTask {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly dueAt: number | null;          // ms epoch
  readonly reminderAt: number | null;
  readonly reminderFired: boolean;
  readonly completedAt: number | null;
  readonly tags: readonly string[];
  readonly calendarId: string | null;
  readonly color: string | null;
  readonly sourceUri: string | null;
  readonly sourceProvider: string | null;
  readonly sourceId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly dueAt?: number | null;
  readonly reminderAt?: number | null;
  readonly tags?: readonly string[];
  readonly calendarId?: string | null;
  readonly color?: string | null;
  readonly sourceUri?: string | null;
  readonly sourceProvider?: string | null;
  readonly sourceId?: string | null;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly dueAt?: number | null;
  readonly reminderAt?: number | null;
  readonly tags?: readonly string[];
  readonly calendarId?: string | null;
  readonly color?: string | null;
  readonly completedAt?: number | null;
}

export interface TaskQuery {
  /** Filter by status. Defaults to "not cancelled". */
  readonly status?: TaskStatus | readonly TaskStatus[];
  /** Inclusive ms-epoch window. */
  readonly dueFrom?: number;
  readonly dueTo?: number;
  /** Tasks with no due date — used for the Review queue. */
  readonly includeUndated?: boolean;
  /** Tasks must include all of these tags. */
  readonly tags?: readonly string[];
  /** Order — defaults to dueAt asc, NULLs last. */
  readonly orderBy?: 'due' | 'created' | 'updated';
  readonly limit?: number;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface PlannerEvent {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly startAt: number;             // ms epoch
  readonly endAt: number;               // ms epoch (>= startAt)
  readonly allDay: boolean;
  readonly location: string | null;
  readonly calendarId: string | null;
  readonly color: string | null;
  readonly recurrence: string | null;
  /** Present on expanded recurring instances — the base event row id. */
  readonly seriesId?: string;
  readonly sourceProvider: string | null;
  readonly sourceId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateEventInput {
  readonly title: string;
  readonly description?: string | null;
  readonly startAt: number;
  readonly endAt?: number;
  readonly allDay?: boolean;
  readonly location?: string | null;
  readonly calendarId?: string | null;
  readonly color?: string | null;
  readonly recurrence?: string | null;
  readonly sourceProvider?: string | null;
  readonly sourceId?: string | null;
}

export interface UpdateEventInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly startAt?: number;
  readonly endAt?: number;
  readonly allDay?: boolean;
  readonly location?: string | null;
  readonly calendarId?: string | null;
  readonly color?: string | null;
  readonly recurrence?: string | null;
}

export interface EventQuery {
  readonly from: number;
  readonly to: number;
  readonly limit?: number;
}

// ─── Calendars ───────────────────────────────────────────────────────────────

export interface PlannerCalendar {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly visible: boolean;
  readonly isDefault: boolean;
  readonly sortOrder: number;
  readonly sourceProvider: string | null;
  readonly sourceId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateCalendarInput {
  readonly name: string;
  readonly color?: string;
  readonly visible?: boolean;
}

export interface UpdateCalendarInput {
  readonly name?: string;
  readonly color?: string;
  readonly visible?: boolean;
  readonly sortOrder?: number;
}

// ─── Free-slot scheduling ────────────────────────────────────────────────────

export interface FreeSlotRequest {
  readonly durationMinutes: number;
  readonly withinDays: number;
  /** Working window in 24h, e.g. { startHour: 9, endHour: 18 }. Defaults to 9-18. */
  readonly startHour?: number;
  readonly endHour?: number;
}

export interface FreeSlot {
  readonly startAt: number;
  readonly endAt: number;
}

// ─── Sync (M82 ships the shape; no providers built yet) ─────────────────────

export interface SyncedTask extends Partial<PlannerTask> {
  readonly title: string;
  readonly sourceProvider: string;
  readonly sourceId: string;
}

export interface SyncedEvent extends Partial<PlannerEvent> {
  readonly title: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly sourceProvider: string;
  readonly sourceId: string;
}

/** A pending local deletion that still needs propagating to a provider. */
export interface SyncDeletion {
  readonly provider: string;
  readonly sourceId: string;
  readonly kind: 'event' | 'task';
  readonly remoteParent: string | null;
}

/** Cursor handed to a provider on each pull. */
export interface SyncPullState {
  /** Opaque incremental cursor from the provider's previous pull (e.g. Google
   *  syncToken). Undefined on the first pull or after a reset. */
  readonly token?: string;
  /** Floor timestamp (ms epoch) for providers that can only filter by time. */
  readonly sinceMs: number;
}

/** Result of a provider pull — remote upserts, deletions, and the next cursor. */
export interface SyncPullResult {
  readonly upsertedEvents: readonly SyncedEvent[];
  readonly deletedEventSourceIds: readonly string[];
  readonly upsertedTasks?: readonly SyncedTask[];
  readonly deletedTaskSourceIds?: readonly string[];
  /** Opaque cursor to pass back on the next pull. */
  readonly nextToken?: string;
  /** True when the incremental cursor expired and the provider returned a full
   *  snapshot — the orchestrator should not infer deletions from absence. */
  readonly reset?: boolean;
}

/**
 * Contract a Google Calendar (or other) provider implements to sync events /
 * tasks with the planner. The planner exposes `registerSyncProvider(provider)`
 * from its activate(); the sync orchestrator (plannerSyncOrchestrator.ts) drives
 * every registered provider on a timer and on demand.
 *
 * The shape intentionally evolved from the M82 placeholder: `pull()` replaces
 * `pullEvents()` so a provider can report deletions and an incremental cursor in
 * one round-trip. `deleteEvent`/`deleteTask` propagate local deletions upstream.
 */
export interface ICalendarSyncProvider {
  readonly id: string;
  readonly displayName: string;

  /** Pull remote changes since `state`. Returns upserts, deletions, next cursor. */
  pull(state: SyncPullState): Promise<SyncPullResult>;

  /** Push a local event upstream. Returns the provider's id to store as source_id. */
  pushEvent?(local: PlannerEvent): Promise<{ providerId: string }>;
  /** Delete an event upstream by its provider id. `remoteParentId` is the
   *  container recorded at delete time (Google calendar id). */
  deleteEvent?(sourceId: string, remoteParentId?: string): Promise<void>;

  /** Push a local task upstream. Returns the provider's id to store as source_id. */
  pushTask?(local: PlannerTask): Promise<{ providerId: string }>;
  /** Delete a task upstream by its provider id. `remoteParentId` is the tasklist id. */
  deleteTask?(sourceId: string, remoteParentId?: string): Promise<void>;

  /** Whether the user has opted this provider into task sync. When false the
   *  orchestrator skips pushing local tasks (the provider still self-gates its
   *  pull). Absent ⇒ tasks are not pushed. */
  wantsTaskSync?(): Promise<boolean>;

  /** @deprecated M82 placeholder, superseded by `pull()`. Kept optional so any
   *  external implementer of the published shape still type-checks. */
  pullEvents?(sinceMs: number): Promise<readonly SyncedEvent[]>;
  /** @deprecated superseded by `pull()`. */
  pullTasks?(sinceMs: number): Promise<readonly SyncedTask[]>;
}

// ─── Change events ───────────────────────────────────────────────────────────

export type PlannerChangeKind = 'task-created' | 'task-updated' | 'task-removed' | 'event-created' | 'event-updated' | 'event-removed' | 'calendar-changed';

export interface PlannerChangeEvent {
  readonly kind: PlannerChangeKind;
  readonly taskId?: string;
  readonly eventId?: string;
  readonly calendarId?: string;
}
