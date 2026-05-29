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
}

export interface EventQuery {
  readonly from: number;
  readonly to: number;
  readonly limit?: number;
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

/**
 * Contract a future Google Calendar (or other) extension implements to
 * sync events / tasks into the planner. The planner exposes
 * `registerSyncProvider(provider)` from its activate(); providers can be
 * registered at any time and removed via the returned disposable.
 *
 * No sync provider ships in M82 — this is the shape so we don't paint
 * ourselves into a corner.
 */
export interface ICalendarSyncProvider {
  readonly id: string;
  readonly displayName: string;
  /** Pull events newer than `sinceMs`. Provider returns whatever it has. */
  pullEvents(sinceMs: number): Promise<readonly SyncedEvent[]>;
  /** Push a local event upstream. Returns the provider's id for the row. */
  pushEvent?(local: PlannerEvent): Promise<{ providerId: string }>;
  /** Optional: same shape for tasks if the provider supports them. */
  pullTasks?(sinceMs: number): Promise<readonly SyncedTask[]>;
  pushTask?(local: PlannerTask): Promise<{ providerId: string }>;
}

// ─── Change events ───────────────────────────────────────────────────────────

export type PlannerChangeKind = 'task-created' | 'task-updated' | 'task-removed' | 'event-created' | 'event-updated' | 'event-removed';

export interface PlannerChangeEvent {
  readonly kind: PlannerChangeKind;
  readonly taskId?: string;
  readonly eventId?: string;
}
