// plannerChatTools.ts — three consolidated chat tools the AI can call.
//
// captureTask:  create-or-update a task (taskId presence switches mode).
// captureEvent: create-or-update an event (eventId presence switches mode).
// read:         single reader, discriminated by `what` ('tasks' | 'events' | 'free-slot').
//
// All tools are no-confirmation. Capture writes are safe by default because
// new tasks land in status='reviewing' — they're visible to the user in the
// review queue rather than silently merged into their planned work.

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';
import type { IPlannerSyncController } from './sync/plannerSyncOrchestrator.js';
import type { TaskStatus } from './plannerTypes.js';

interface ChatApi {
  registerTool(toolId: string, def: {
    description: string;
    parameters: object;
    requiresConfirmation: boolean;
    handler: (args: unknown) => Promise<{ content: string; isError?: boolean }>;
  }): IDisposable;
}

const VALID_STATUSES: readonly TaskStatus[] = ['reviewing', 'planned', 'done', 'cancelled'];

function isValidStatus(s: unknown): s is TaskStatus {
  return typeof s === 'string' && (VALID_STATUSES as readonly string[]).includes(s);
}

function parseDateInput(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Accept ISO 8601, RFC-ish "+5d" style relative durations, or "YYYY-MM-DD".
  const rel = trimmed.match(/^\+(\d+)\s*([dhm])$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const ms = unit === 'd' ? n * 86_400_000 : unit === 'h' ? n * 3_600_000 : n * 60_000;
    return Date.now() + ms;
  }
  // Date-only strings mean LOCAL midnight (what the tool schema promises).
  // Date.parse('YYYY-MM-DD') would return UTC midnight — a different day
  // for half the world's timezones.
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]).getTime();
  }
  const ts = Date.parse(trimmed);
  return Number.isFinite(ts) ? ts : null;
}

function ok(payload: unknown): { content: string; isError?: boolean } {
  return { content: JSON.stringify(payload) };
}

/** Local-time echo block for capture results — the model reads THESE back to
 *  the user instead of (mis)computing from raw epoch numbers. */
function localEcho(fields: Record<string, number | null | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = { timezone: localTimezone() };
  for (const [key, ms] of Object.entries(fields)) {
    if (typeof ms === 'number' && Number.isFinite(ms)) out[key] = fmtLocal(ms);
  }
  return out;
}
function err(message: string): { content: string; isError: true } {
  return { content: message, isError: true };
}

// Models misread raw epoch ms — hand them local human-readable strings alongside
// the numbers so they read times instead of (mis)computing them.
function fmtLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function localTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; } catch { return 'local'; }
}

/**
 * Resolve the calendar an item should land in from `calendarId` / `calendarName`
 * args. Returns `{ calendarId }` (undefined = let the data service pick the
 * default), or `{ error }` when a named/id'd calendar can't be found — so the
 * agent gets a correctable message rather than a silent wrong-calendar write.
 */
async function resolveCalendarArg(
  data: PlannerDataService,
  args: Record<string, unknown>,
): Promise<{ calendarId?: string; error?: string }> {
  const rawId = typeof args.calendarId === 'string' ? args.calendarId.trim() : '';
  const rawName = typeof args.calendarName === 'string' ? args.calendarName.trim() : '';
  if (!rawId && !rawName) return {}; // no target named → default resolution downstream

  if (rawId) {
    const cal = await data.getCalendar(rawId);
    if (!cal) return { error: `Calendar not found: "${rawId}". Call planner.read what="calendars" to list valid calendars.` };
    return { calendarId: cal.id };
  }
  const cals = await data.listCalendars();
  const needle = rawName.toLowerCase();
  const match = cals.find((c) => c.name.toLowerCase() === needle)
    ?? cals.find((c) => c.name.toLowerCase().includes(needle));
  if (!match) return { error: `No calendar matches "${rawName}". Call planner.read what="calendars" to list valid calendars.` };
  return { calendarId: match.id };
}

// ─── Tool: planner.captureTask ───────────────────────────────────────────────

const CAPTURE_TASK_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: {
      type: 'string',
      description: 'Existing task id (e.g. "task-…"). When present this is an update. When absent, a new task is created. Use updates to mark done (status="done"), cancel (status="cancelled"), or set a real due date the user picked.',
    },
    title: {
      type: 'string',
      description: 'Short user-facing title. Required on create.',
    },
    description: {
      type: 'string',
      description: 'Optional longer-form context for the task.',
    },
    status: {
      type: 'string',
      enum: ['reviewing', 'planned', 'done', 'cancelled'],
      description: 'Task lifecycle. New tasks default to "reviewing" so they sit in the user\'s review queue without breaking their current flow. Use "planned" once a real due date is picked; "done" to complete; "cancelled" as the soft-delete path.',
    },
    dueAt: {
      type: 'string',
      description: 'Due date: "YYYY-MM-DD" (local midnight), zone-less ISO like "2026-07-20T15:00" (the user\'s LOCAL time — preferred; do NOT append "Z", that means UTC and lands hours off), or a relative shortcut like "+5d" / "+3h". On create the default is "+5d" so journaling-style capture doesn\'t pull the user into a date picker.',
    },
    reminderAt: {
      type: 'string',
      description: 'Optional reminder time (same format as dueAt — zone-less = user\'s local time). Fires once via the in-app notification service.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tag list. Replaces existing tags on update.',
    },
    calendarId: {
      type: 'string',
      description: 'Optional calendar id to file the task under (see planner.read what="calendars"). Tasks sync to Google Tasks whenever Google task sync is on, regardless of calendar. Omit to use the default.',
    },
    calendarName: {
      type: 'string',
      description: 'Optional calendar name (case-insensitive) as an alternative to calendarId.',
    },
    sourceUri: {
      type: 'string',
      description: 'Optional URI identifying where the task was captured (e.g. a journal page URI). Helpful for "jump back to the conversation that captured this".',
    },
  },
};

// ─── Tool: planner.captureEvent ──────────────────────────────────────────────

const CAPTURE_EVENT_PARAMETERS = {
  type: 'object',
  properties: {
    eventId: {
      type: 'string',
      description: 'Existing event id. Present = update, absent = create.',
    },
    title: {
      type: 'string',
      description: 'Short user-facing title. Required on create.',
    },
    description: {
      type: 'string',
      description: 'Optional longer-form description / agenda.',
    },
    startAt: {
      type: 'string',
      description: 'Event start. Zone-less ISO like "2026-07-20T15:00" is the user\'s LOCAL time (preferred — do NOT append "Z", that means UTC and shifts the event by the timezone offset); "YYYY-MM-DD" = local midnight; "+1d" style relatives also work. Required on create.',
    },
    endAt: {
      type: 'string',
      description: 'Event end (same format as startAt — zone-less = local). Defaults to startAt + 1 hour. Must be >= startAt.',
    },
    allDay: {
      type: 'boolean',
      description: 'Whether this is an all-day event. When true, startAt is treated as the start of the day and endAt as the end.',
    },
    location: {
      type: 'string',
      description: 'Optional location string.',
    },
    calendarId: {
      type: 'string',
      description: 'Calendar id the event belongs to (see planner.read what="calendars"). To make an event appear on the user\'s GOOGLE calendar, use a calendar whose syncsToGoogle is true. Omit to use the default (which targets the Google-synced calendar when connected).',
    },
    calendarName: {
      type: 'string',
      description: 'Calendar name (case-insensitive) as an alternative to calendarId — e.g. "Work" or the account email for the primary Google calendar.',
    },
  },
};

// ─── Tool: planner.read ──────────────────────────────────────────────────────

const READ_PARAMETERS = {
  type: 'object',
  required: ['what'],
  properties: {
    what: {
      type: 'string',
      enum: ['tasks', 'events', 'free-slot', 'calendars'],
      description: 'Discriminator. "tasks" returns matching tasks; "events" returns events in a time window; "free-slot" returns the first open calendar block of the requested duration; "calendars" lists the user\'s calendars with which ones sync to Google (use this to pick where an event should land).',
    },
    // tasks-only filters
    status: {
      type: 'string',
      enum: ['reviewing', 'planned', 'done', 'cancelled'],
      description: '(tasks) Filter by lifecycle status. Omit to get everything except cancelled.',
    },
    dueWithinDays: {
      type: 'number',
      description: '(tasks) Limit to tasks due within the next N days from now.',
    },
    includeUndated: {
      type: 'boolean',
      description: '(tasks) Include tasks with no due date — e.g. for surfacing the review queue.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: '(tasks) Require all listed tags.',
    },
    // events-only filters
    from: {
      type: 'string',
      description: '(events) Window start (ISO 8601 / YYYY-MM-DD / relative). Defaults to the START OF TODAY (local). For a single specific day, pass that day\'s date (00:00).',
    },
    to: {
      type: 'string',
      description: '(events) Window end. Defaults to "+7d". For a single day, pass the END of that day (e.g. the next date at 00:00) so you get exactly that day, not the whole week.',
    },
    // free-slot
    durationMinutes: {
      type: 'number',
      description: '(free-slot) How long an open block to find. Required for free-slot.',
    },
    withinDays: {
      type: 'number',
      description: '(free-slot) How many days ahead to search. Defaults to 7. Max 60.',
    },
    startHour: {
      type: 'number',
      description: '(free-slot) Earliest hour of the working window (0-23). Defaults to 9.',
    },
    endHour: {
      type: 'number',
      description: '(free-slot) Latest hour of the working window (1-24). Defaults to 18.',
    },
    limit: {
      type: 'number',
      description: '(tasks/events) Cap the number of returned rows. Defaults to 50.',
    },
  },
};

// ─── Registration ────────────────────────────────────────────────────────────

export function registerPlannerChatTools(
  chat: ChatApi,
  data: PlannerDataService,
  sync?: IPlannerSyncController,
): IDisposable {
  const disposables: IDisposable[] = [];

  // After an agent write, kick a reconcile so the change reaches Google promptly
  // (instead of waiting for the next timer tick). Best-effort: never block or
  // throw into the tool result — if it's already running or offline, the timer
  // still catches up.
  const nudgeSync = (): void => {
    if (!sync || sync.isRunning) return;
    void Promise.resolve(sync.syncNow()).catch(() => { /* timer will retry */ });
  };

  disposables.push(chat.registerTool('planner.captureTask', {
    description:
      'Create or update a planner task. Present a taskId to update an existing task; omit it to capture a new one. New tasks default to status="reviewing" and dueAt="+5d" so journaling-style capture lands in the user\'s review queue without breaking their flow. Mark complete with status="done"; soft-delete with status="cancelled".',
    parameters: CAPTURE_TASK_PARAMETERS,
    requiresConfirmation: false,
    handler: async (raw) => {
      const args = (raw ?? {}) as Record<string, unknown>;
      const taskId = typeof args.taskId === 'string' ? args.taskId : null;
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const description = typeof args.description === 'string' ? args.description : undefined;
      const status = isValidStatus(args.status) ? args.status : undefined;
      const dueAt = args.dueAt !== undefined ? parseDateInput(args.dueAt) : undefined;
      const reminderAt = args.reminderAt !== undefined ? parseDateInput(args.reminderAt) : undefined;
      const tags = Array.isArray(args.tags) ? (args.tags as unknown[]).filter((t): t is string => typeof t === 'string') : undefined;
      const sourceUri = typeof args.sourceUri === 'string' ? args.sourceUri : undefined;

      try {
        const cal = await resolveCalendarArg(data, args);
        if (cal.error) return err(cal.error);

        if (taskId) {
          const updated = await data.updateTask(taskId, {
            title: title || undefined,
            description,
            status,
            dueAt: dueAt ?? undefined,
            reminderAt: reminderAt ?? undefined,
            tags,
            calendarId: cal.calendarId,
          });
          if (!updated) return err(`Task not found: ${taskId}`);
          nudgeSync();
          return ok({ task: updated, localTimes: localEcho({ dueAt: updated.dueAt, reminderAt: updated.reminderAt }) });
        }
        if (!title) return err('createTask requires a title.');
        const created = await data.createTask({
          title,
          description,
          status: status ?? 'reviewing',
          // Default the due date for the "log it and move on" capture flow.
          dueAt: dueAt ?? Date.now() + 5 * 86_400_000,
          reminderAt: reminderAt ?? null,
          tags,
          calendarId: cal.calendarId,
          sourceUri,
        });
        nudgeSync();
        return ok({ task: created, localTimes: localEcho({ dueAt: created.dueAt, reminderAt: created.reminderAt }) });
      } catch (e) {
        return err(`captureTask failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  }));

  disposables.push(chat.registerTool('planner.captureEvent', {
    description:
      'Create or update a planner calendar event. Present an eventId to update; omit it to create. startAt is required on create. To place an event on the user\'s GOOGLE calendar, target a calendar whose syncsToGoogle is true (call planner.read what="calendars" first to find it, or omit calendarId to use the default, which targets the Google-synced calendar when connected). Created/updated events reconcile to Google automatically.',
    parameters: CAPTURE_EVENT_PARAMETERS,
    requiresConfirmation: false,
    handler: async (raw) => {
      const args = (raw ?? {}) as Record<string, unknown>;
      const eventId = typeof args.eventId === 'string' ? args.eventId : null;
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const description = typeof args.description === 'string' ? args.description : undefined;
      const startAt = args.startAt !== undefined ? parseDateInput(args.startAt) : undefined;
      const endAt = args.endAt !== undefined ? parseDateInput(args.endAt) : undefined;
      const allDay = typeof args.allDay === 'boolean' ? args.allDay : undefined;
      const location = typeof args.location === 'string' ? args.location : undefined;

      try {
        const cal = await resolveCalendarArg(data, args);
        if (cal.error) return err(cal.error);

        if (eventId) {
          const updated = await data.updateEvent(eventId, {
            title: title || undefined,
            description,
            startAt: startAt ?? undefined,
            endAt: endAt ?? undefined,
            allDay,
            location,
            calendarId: cal.calendarId,
          });
          if (!updated) return err(`Event not found: ${eventId}`);
          nudgeSync();
          return ok({ event: updated, localTimes: localEcho({ startAt: updated.startAt, endAt: updated.endAt }) });
        }
        if (!title) return err('createEvent requires a title.');
        if (startAt === undefined || startAt === null) return err('createEvent requires a startAt.');
        const created = await data.createEvent({
          title,
          description,
          startAt,
          endAt: endAt ?? undefined,
          allDay: allDay ?? false,
          location,
          calendarId: cal.calendarId,
        });
        nudgeSync();
        return ok({ event: created, localTimes: localEcho({ startAt: created.startAt, endAt: created.endAt }) });
      } catch (e) {
        return err(`captureEvent failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  }));

  disposables.push(chat.registerTool('planner.read', {
    description:
      'Read planner data. `what="tasks"` returns matching tasks (status / dueWithinDays / tags / includeUndated). `what="events"` returns events in a time window (from / to) — recurring events are already expanded into per-day instances. `what="free-slot"` returns the first open calendar block of the requested durationMinutes within withinDays. `what="calendars"` lists the user\'s calendars with `syncsToGoogle` and `isDefaultForNewEvents`. For "what\'s on my calendar today", call what="events" with from = start of today and to = start of tomorrow. Each result includes local human-readable `start`/`end`/`day` plus a top-level `now`/`timezone` — READ THOSE for times; do not recompute from the raw epoch `startAt`/`endAt`, and never invent events that are not in the returned list.',
    parameters: READ_PARAMETERS,
    requiresConfirmation: false,
    handler: async (raw) => {
      const args = (raw ?? {}) as Record<string, unknown>;
      const what = typeof args.what === 'string' ? args.what : '';

      try {
        if (what === 'tasks') {
          const dueWithinDays = typeof args.dueWithinDays === 'number' ? args.dueWithinDays : undefined;
          const tasks = await data.listTasks({
            status: isValidStatus(args.status) ? args.status : undefined,
            dueFrom: dueWithinDays !== undefined ? Date.now() : undefined,
            dueTo: dueWithinDays !== undefined ? Date.now() + dueWithinDays * 86_400_000 : undefined,
            includeUndated: args.includeUndated === true,
            tags: Array.isArray(args.tags) ? (args.tags as unknown[]).filter((t): t is string => typeof t === 'string') : undefined,
            limit: typeof args.limit === 'number' ? args.limit : 50,
          });
          return ok({
            now: fmtLocal(Date.now()),
            timezone: localTimezone(),
            tasks: tasks.map((t) => ({ ...t, due: t.dueAt != null ? fmtLocal(t.dueAt) : null })),
          });
        }
        if (what === 'events') {
          // Default the window to the START OF TODAY (not "now") so a bare "what's
          // on my calendar today" includes events that already started/ended this
          // morning — otherwise the model sees a half-day and invents the rest.
          const from = args.from !== undefined ? parseDateInput(args.from) : startOfTodayMs();
          const to = args.to !== undefined ? parseDateInput(args.to) : Date.now() + 7 * 86_400_000;
          if (from === null || to === null) return err('events: from / to must parse to dates.');
          const events = await data.listEvents({
            from,
            to,
            limit: typeof args.limit === 'number' ? args.limit : 50,
          });
          return ok({
            now: fmtLocal(Date.now()),
            timezone: localTimezone(),
            windowStart: fmtLocal(from),
            windowEnd: fmtLocal(to),
            events: events.map((e) => ({
              id: e.id,
              title: e.title,
              start: fmtLocal(e.startAt),
              end: fmtLocal(e.endAt),
              day: fmtDay(e.startAt),
              allDay: e.allDay,
              location: e.location,
              description: e.description,
              calendarId: e.calendarId,
              seriesId: e.seriesId ?? null,
              startAt: e.startAt,
              endAt: e.endAt,
            })),
          });
        }
        if (what === 'free-slot') {
          const durationMinutes = typeof args.durationMinutes === 'number' ? args.durationMinutes : NaN;
          if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return err('free-slot requires a positive durationMinutes.');
          const withinDays = typeof args.withinDays === 'number' ? args.withinDays : 7;
          const startHour = typeof args.startHour === 'number' ? args.startHour : undefined;
          const endHour = typeof args.endHour === 'number' ? args.endHour : undefined;
          const slot = await data.findFreeSlot({ durationMinutes, withinDays, startHour, endHour });
          if (!slot) return ok({ slot: null, message: 'No open slot found in the requested window.' });
          return ok({ slot: { ...slot, start: fmtLocal(slot.startAt), end: fmtLocal(slot.endAt) } });
        }
        if (what === 'calendars') {
          const cals = await data.listCalendars();
          const defaultId = await data.resolveDefaultEventCalendarId();
          return ok({
            calendars: cals.map((c) => ({
              id: c.id,
              name: c.name,
              color: c.color,
              syncsToGoogle: c.sourceProvider === 'google',
              googleCalendarId: c.sourceId ?? null,
              isDefaultForNewEvents: c.id === defaultId,
            })),
          });
        }
        return err(`Unknown what: "${what}". Use "tasks", "events", "free-slot", or "calendars".`);
      } catch (e) {
        return err(`read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  }));

  return toDisposable(() => {
    for (const d of disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
  });
}
