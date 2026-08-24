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
  /** The PROVIDER's own last-modified stamp for this row (its clock, not ours).
   *  Undefined/null = never reconciled. Never compare it to `updatedAt`. */
  readonly remoteUpdatedAt?: number | null;
  /** Local ms-epoch of the last reconcile with the provider. Dirty ⇔
   *  `updatedAt > syncedAt`. */
  readonly syncedAt?: number | null;
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
  /** The PROVIDER's own last-modified stamp for this row (its clock, not ours).
   *  Undefined/null = never reconciled. Never compare it to `updatedAt`. */
  readonly remoteUpdatedAt?: number | null;
  /** Local ms-epoch of the last reconcile with the provider. Dirty ⇔
   *  `updatedAt > syncedAt`. */
  readonly syncedAt?: number | null;
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

/** How a change to one occurrence of a recurring series applies (Google-parity). */
export type SeriesEditScope = 'this' | 'following' | 'all';

/**
 * A per-occurrence exception on a recurring series, pinned by its ORIGINAL start
 * slot. `cancelled` removes that occurrence; otherwise the non-null fields
 * replace the base for that one instance. Mirrors Google's exception model.
 */
export interface EventOverride {
  readonly id: string;
  readonly baseId: string;
  readonly originalStartAt: number;
  readonly cancelled: boolean;
  readonly title: string | null;
  readonly description: string | null;
  readonly startAt: number | null;
  readonly endAt: number | null;
  readonly allDay: boolean | null;
  readonly location: string | null;
  readonly color: string | null;
  readonly sourceId: string | null;
  /** The provider's last-modified stamp for the remote exception (its clock). */
  readonly remoteUpdatedAt?: number | null;
}

/** Fields an override can carry (all optional; omitted = inherit from base). */
export interface OverridePatch {
  readonly cancelled?: boolean;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly startAt?: number | null;
  readonly endAt?: number | null;
  readonly allDay?: boolean | null;
  readonly location?: string | null;
  readonly color?: string | null;
  readonly sourceId?: string | null;
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

/** A remote per-occurrence exception (Google instance edit/cancel) to ingest. */
export interface SyncedEventOverride {
  /** The remote recurring MASTER id (Google recurringEventId) — links to a local base. */
  readonly baseSourceId: string;
  /** The occurrence slot this exception overrides (ms epoch, from originalStartTime). */
  readonly originalStartAt: number;
  readonly cancelled: boolean;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly startAt?: number | null;
  readonly endAt?: number | null;
  readonly allDay?: boolean | null;
  readonly location?: string | null;
  /** The remote exception event id (stored so we PATCH the right instance). */
  readonly sourceId: string;
  readonly updatedAt?: number;
}

/** Result of a provider pull — remote upserts, deletions, and the next cursor. */
export interface SyncPullResult {
  readonly upsertedEvents: readonly SyncedEvent[];
  readonly deletedEventSourceIds: readonly string[];
  /** Per-occurrence exceptions on recurring series (Google instance edits/cancels). */
  readonly upsertedOverrides?: readonly SyncedEventOverride[];
  readonly upsertedTasks?: readonly SyncedTask[];
  readonly deletedTaskSourceIds?: readonly string[];
  /** Opaque cursor to pass back on the next pull. */
  readonly nextToken?: string;
  /** True when the incremental cursor expired and the provider returned a full
   *  snapshot — the orchestrator should not infer deletions from absence. */
  readonly reset?: boolean;
  /** Complete snapshots produced by this pull (only on a full/reset pull). Each
   *  entry lets the orchestrator reconcile deletions it could never have seen
   *  incrementally: any local row in that calendar, inside the snapshot window,
   *  whose source_id is absent from `sourceIds` is gone upstream. */
  readonly snapshots?: readonly SyncCalendarSnapshot[];
}

/** A complete listing of one calendar over a bounded window. */
export interface SyncCalendarSnapshot {
  /** The LOCAL planner calendar id the snapshot covers. */
  readonly calendarId: string;
  /** Every remote id present in the window (upserted or cancelled). */
  readonly sourceIds: readonly string[];
  /** Lower bound of the window (ms epoch) — rows ending before it weren't listed. */
  readonly fromMs: number;
}

/** What a push returns: the provider's id for the row, plus — when the provider
 *  echoes it — the provider-clock timestamp the write produced. Recording that
 *  stamp is what keeps the next pull from mistaking our own write for someone
 *  else's remote change. */
export interface SyncPushResult {
  readonly providerId: string;
  readonly remoteUpdatedAt?: number;
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

  /** Pull remote changes since `state`. Returns upserts, deletions, next cursor.
   *
   *  MUST NOT persist its own cursors — a cursor written before the caller has
   *  applied the rows it covers turns any later failure into permanent data
   *  loss (the provider will never resend those changes). Buffer them and
   *  publish in `commitCursors()`, which the orchestrator calls only after
   *  every pulled row has landed locally. */
  pull(state: SyncPullState): Promise<SyncPullResult>;

  /** Durably persist the cursors buffered by the last successful `pull()`.
   *  Called once the orchestrator has applied that pull in full. Providers
   *  holding no internal cursor may omit it. */
  commitCursors?(): Promise<void>;

  /** Throw away every incremental cursor so the next `pull()` is a full one.
   *  Backs the user-facing "Resync from scratch" repair. */
  resetCursors?(): Promise<void>;

  /** Push a local event upstream. Returns the provider's id to store as source_id. */
  pushEvent?(local: PlannerEvent): Promise<SyncPushResult>;
  /** Delete an event upstream by its provider id. `remoteParentId` is the
   *  container recorded at delete time (Google calendar id). */
  deleteEvent?(sourceId: string, remoteParentId?: string): Promise<void>;

  /** Push a single-occurrence exception upstream. `baseSourceId` is the remote
   *  recurring master id; `override` carries the local exception. Returns the
   *  remote instance id to store as the override's source_id. */
  pushOverride?(baseSourceId: string, override: EventOverride): Promise<SyncPushResult>;

  /** Push a local task upstream. Returns the provider's id to store as source_id. */
  pushTask?(local: PlannerTask): Promise<SyncPushResult>;
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
