# Milestone 82 — Planner extension + dashboard widget catalog

> **Status:** Planner = planned. Image widget shipped 2026-05-28. Widget
> catalog (below) refreshed to match shipped state — the M71 dashboard now
> ships **six** widgets (clock & quick links, recent files, news brief,
> AI widget, image, autonomy activity), not the three this doc originally
> listed.

# Planner (built-in calendar + tasks)

## Why

Parallx has nowhere to capture "I should do this" outside of an open chat
or a canvas page that nobody opens again. Users either keep it in their
head, write it down somewhere else, or break flow to fully plan it. The
planner is the place that *captures fast, plans later*.

The anchoring scenario the design is built around: during a journaling
or socratic session the user says "I need to remember to take my car in
for maintenance." A chat tool creates a task with a defaulted due date
several days in the future and flips it to a `reviewing` status. The
journaling session keeps going — no time spent on dates or priorities.
Later, when the user opens the planner, the task sits in a small review
queue waiting for a real date. If the user has a calendar with their
real schedule on it, the AI can *propose* a real date by finding open
time. Capture is one tool call; planning is a separate step the user
does when they're already in planning mode.

This is a unified planner — tasks **and** calendar in one extension —
because separating them would make "schedule this task on a real free
slot" cross a tool boundary for no good reason.

## Architecture decision: one built-in tool, sync-ready from day one

`parallx.planner` is a built-in tool registered the same way budget,
canvas, and dashboard are ([builtinManifests.ts](../src/tools/builtinManifests.ts)
+ [workbench.ts](../src/workbench/workbench.ts)). It owns SQLite tables
in the shared workspace DB, exposes chat tools so AI surfaces can capture
work without ceremony, registers a sidebar view + editor pane, and
contributes three dashboard widgets.

We do **not** invent a new AI surface. The planner exposes chat tools the
same way budget does ([ext/budget/main.js](../ext/budget/main.js) —
`api.chat.registerTool`); skills + chat threads pick those up
automatically and the dashboard's AI widgets can call them too.

The schema carries `source_provider` + `source_id` from day one. Local
data has `source_provider = NULL`; a future Google Calendar provider
extension implements an `ICalendarSyncProvider` interface and writes rows
with `source_provider = 'google'`. The Google sync itself is out of M82
scope but the storage doesn't need to change to add it.

## Data model

Two tables in the shared workspace DB, prefixed `planner_*`:

```sql
CREATE TABLE planner_tasks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'reviewing',
                  -- 'reviewing' | 'planned' | 'done' | 'cancelled'
  due_at          INTEGER,          -- ms epoch, nullable
  reminder_at     INTEGER,          -- ms epoch, nullable
  completed_at    INTEGER,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  source_uri      TEXT,             -- e.g. journal page URI that captured this
  source_provider TEXT,             -- NULL = local; 'google' etc when synced
  source_id       TEXT,             -- opaque id from the sync provider
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_planner_tasks_status ON planner_tasks(status);
CREATE INDEX idx_planner_tasks_due ON planner_tasks(due_at);

CREATE TABLE planner_events (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  start_at        INTEGER NOT NULL,
  end_at          INTEGER NOT NULL,
  all_day         INTEGER NOT NULL DEFAULT 0,
  location        TEXT,
  source_provider TEXT,
  source_id       TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_planner_events_start ON planner_events(start_at);
CREATE INDEX idx_planner_events_provider ON planner_events(source_provider, source_id);
```

`status='reviewing'` is the load-bearing default — it's how the planner
knows a task was captured fast and the user still needs to pick a real
date. The Planner editor surfaces a "Review queue" section that lists
every reviewing task with the AI's default due date so the user can
batch-confirm or adjust.

## Chat tools — the AI surface

Registered from `activate()` via `api.chat.registerTool(name, def)` (the
budget pattern). **Three tools, not six** — see the consolidation note
below. Each capture tool merges create + update on id-presence; the read
tool branches on a `what` discriminator.

| Tool | Purpose | Defaults |
| --- | --- | --- |
| `planner.captureTask({ title, dueAt?, status?, reminderAt?, tags?, sourceUri?, taskId? })` | Create or update a task. `taskId` present = update, absent = create. `status: 'cancelled'` is the soft-delete path. | On create: `dueAt = +5 days`, `status = 'reviewing'`. |
| `planner.captureEvent({ title, startAt, endAt?, allDay?, location?, eventId? })` | Create or update a calendar event. Same `eventId`-presence rule. | — |
| `planner.read({ what: 'tasks' \| 'events' \| 'free-slot', ...filters })` | One reader. `'tasks'`: filter by status / due window / tags. `'events'`: time window. `'free-slot'`: returns the first open block of `durationMinutes` within `withinDays`, accounting for existing events. | — |

The `dueAt = +5 days, status = 'reviewing'` defaults are what turn the
journaling scenario into a single AI tool call — the user doesn't get
pulled into a date picker mid-session, the captured task sits in the
review queue, and the AI can later propose a real date with
`planner.read({ what: 'free-slot', durationMinutes: ... })` followed by
`planner.captureTask({ taskId, dueAt })`.

### Why three tools, not six

The initial sketch had six tools (`createTask`, `listTasks`,
`updateTask`, `createEvent`, `listEvents`, `findFreeSlot`). The
consolidation:

- **`createX` + `updateX` → single capture tool with optional id.**
  Models handle "id present = update, absent = create" reliably, and the
  AI's intent ("write a task") is the same in both cases. Splitting
  doubles the tool count for no clarity gain. Mark-done becomes
  `captureTask({ taskId, status: 'done' })`; soft-delete becomes
  `captureTask({ taskId, status: 'cancelled' })`.
- **`listTasks` + `listEvents` + `findFreeSlot` → single read tool.**
  All three are "ask the planner for data" — different *what*, same
  *intent*. A `what` discriminator picks the shape.

What we explicitly chose **not** to consolidate further:

- **`captureTask` and `captureEvent` stay separate** rather than
  collapsing into one `planner.write({ kind, ... })`. Task fields
  (`dueAt`, `status`, `tags`) and event fields (`startAt`, `endAt`,
  `allDay`, `location`) are different enough that a union shape makes
  the tool description longer and harder for the model to validate.
  Two clean single-shape capture tools cost less prompt budget than one
  union write tool.

Each tool is no-confirmation. Capture writes are safe by default because
new tasks land in `status = 'reviewing'` — they're visible in the review
queue, not silently merged into the user's "real" plan.

## Surfaces

**Sidebar view** ("Planner" container, sidebar location, icon
`list-checks`). Single view: a list of tasks with filter chips along the
top — *Reviewing*, *Today*, *This week*, *Overdue*, *Done*. Tap a task
to inline-edit; click an event to open the calendar at that date.

**Editor pane** (`typeId: 'planner'`). One instance per planner workspace.
A simple tab bar at the top: **Tasks** | **Calendar**.

- Tasks tab — list with grouping (by status / by due / by tag) and a
  prominent Review queue section at top.
- Calendar tab — month / week / day toggle. Each more detailed than the
  last: month shows event dots + counts per day; week shows day columns
  with time slots and event bars; day shows a single column with detail.
  No drag-to-reschedule in M82 (M82.5).

**Dashboard widgets** (three, all contribute via
`parallx.dashboard.registerWidgetType`):

| Widget | Type | Notes |
| --- | --- | --- |
| `planner.tasks.summary` | query | Pending count, due today, overdue, recent completed. Click rows to open the task; click the title to open the Planner editor. |
| `planner.calendar.agenda` | query | Today + next N days as a vertical list. Click event → opens detail in the Planner editor. |
| `planner.calendar.view` | query | Month / week / day view with `view` config field. Sized larger by default (8×4 colSpans for month). |

Widgets use the standard widget pattern — config schema for view choice,
`refresh()` reads from the planner data service, `chromeStyle: 'card'`.
No new dashboard framework work needed.

## Reminders

The planner runs a small in-process scheduler — same pattern as the
dashboard's refresh scheduler. On a 60-second tick it queries
`SELECT id, title FROM planner_tasks WHERE reminder_at IS NOT NULL AND
reminder_at <= now() AND status != 'done'` and dispatches each through
the workbench notification service. Reminders fire once per task; firing
nulls the `reminder_at` column so it doesn't repeat. No new
infrastructure.

## Sync architecture (planned, deferred)

Defined now so M82's schema doesn't need to change later:

```ts
interface ICalendarSyncProvider {
  readonly id: string;             // e.g. 'google'
  readonly displayName: string;
  pullEvents(since: number): Promise<readonly SyncedEvent[]>;
  pushEvent(local: PlannerEvent): Promise<{ providerId: string }>;
  // tasks may or may not sync depending on provider capabilities
}
```

A Google Calendar provider lives in its own extension (e.g.
`parallx.google-calendar`), authenticates via OAuth in a process that
mirrors `tools/gmail-mcp-server/` for credential handling, calls
`planner.registerSyncProvider(...)` at activate, and the planner's UI
adds a per-source filter. None of that ships in M82 — but adding it
later does not require a schema migration.

## Scope

**In scope for M82:**

- `parallx.planner` built-in tool
- Two-table schema + initial migration
- Tasks + events data service (CRUD, query, find-free-slot)
- Sidebar view with filter chips
- Editor pane with Tasks tab + Calendar tab (month/week/day)
- Three chat tools (`captureTask`, `captureEvent`, `read`)
- In-process reminder scheduler
- Three dashboard widgets (tasks summary, calendar agenda, calendar view)
- Sync architecture *as code shape* — interface + provider registration
  hook + `source_provider` columns. No actual sync.

**Out of scope (deferred):**

- Google Calendar sync (separate extension, separate milestone).
- Recurring tasks / events.
- Drag-to-reschedule on the calendar.
- Task dependencies, subtasks, sharing.
- Push notifications outside the in-app notification service.
- iCal import/export.

## Estimated effort

Rough sizing for one developer:

- Schema + migrations + data service: ~1 day
- Sidebar view: ~1 day
- Tasks editor tab (list + grouping + Review queue): ~1 day
- Calendar editor tab (month/week/day): ~2 days
- Chat tools (3): ~0.5 day
- Reminder scheduler hook: ~0.5 day
- Three widgets: ~1.5 days
- Sync interface + provider plumbing (no actual sync): ~0.5 day
- Polish + UX: ~1 day

Total ≈ 8 days. The calendar editor is the biggest cost; everything else
follows established patterns (budget for chat tools, dashboard for
widgets, canvas for migrations + editor panes).

## Open questions

- **Tool name**: `parallx.planner` ("Planner") is the working name.
  Alternative: `parallx.calendar` with tasks-inside. *Recommendation:*
  Planner — it reads more naturally as "capture + plan", and a future
  Google Calendar extension is a separate thing with its own name.
- **Reminder UI**: in-app notification service for M82. iOS/desktop OS
  notifications are out of scope but the notification service can grow
  into them later.
- **Calendar view interaction depth in M82**: read-only (click an event
  for detail). Drag-to-reschedule and click-to-create-event are M82.5
  candidates if they're cheap.

---

# Dashboard widget catalog

The M71 dashboard ships with six widgets — Clock & quick links, Recent
files, News brief, AI widget, Image, Autonomy activity. That's enough to
prove the contribution model and exercise three lifecycle shapes plus the
push model for AI delivery. This section catalogs vetted widget ideas
beyond those six. Effort is relative to the existing widget pattern.

## Pattern reminder — Image widget validated this

The Image widget ([imageWidget.ts](../src/built-in/dashboard/widgets/imageWidget.ts))
established the canonical "user-authored single-value widget" pattern:
self-contained instance state belongs in `ctx.setCachedOutput`
⇄ `ctx.cachedOutput`, **not** in a new schema column. The image is
downscaled client-side (max 1280px), encoded to a data URL, and dropped
to PNG → JPEG until it fits `MAX_CACHED_OUTPUT_BYTES` (256 KB). On
reload the widget paints from cache. No upload, no network, no
migration.

Any future "scratchpad / sticky note / single-value-stored-per-instance"
widget should follow this exact pattern.

## Backlog — widget ideas

Items the user explicitly named for M82 (tasks / calendar) are not in
this catalog — they're shipped by the Planner above.

### High value — data already in Parallx
| Widget | Source | Effort | Notes |
| --- | --- | --- | --- |
| Budget snapshot | budget extension SQLite | M | MTD spend, top categories, remaining vs. budget; tap to open finance view. |
| Media library stats | media-organizer DB | M | Photo/video counts, storage used, latest-4 thumbnail strip. |
| Workspace graph mini-map | workspace-graph | M | Node/edge counts, most-connected notes; links into the graph view. |
| Recent conversations | chat store | S | Jump back into recent AI threads. |

### Productivity / glanceable
| Widget | Source | Effort | Notes |
| --- | --- | --- | --- |
| Sticky note / scratchpad | widget config (cache) | S | Freeform markdown saved per instance — follows the image-widget pattern. |
| Countdown / focus timer | client-side | S | Pomodoro or countdown-to-date. |
| Weather | web fetch (egress bridge) | M | Must route through the web-research/egress chokepoint. |
| Quick capture | workspace | S–M | One input that drops a note/file into the workspace. |
| Bookmarks grid | widget config | S | Visual favicon tiles vs. the current text quick-links. |

### AI-native — partially subsumed by the AI widget
The shipped `parallx.dashboard.ai-custom` widget already lets the user
write any prompt + optional skill name, so several "AI-backed widget"
ideas reduce to *"a configured instance of the AI widget"* rather than a
new widget type. Listed below are the ones that still want a bespoke
shape.

| Widget | Source | Effort | Notes |
| --- | --- | --- | --- |
| Daily brief | files + chats + autonomy events (AI) | L | Could be an AI-widget recipe; a bespoke widget would add cross-source structure. |
| Ask Parallx | chat | S–M | Inline prompt box that opens a seeded chat. Distinct enough from ai-custom (no rendered output) to be its own widget. |
| Suggested actions | recent activity (AI) | L | AI-surfaced next steps with action buttons; the buttons make it more than a Markdown render. |
| Research feed | web-research extension | M | Saved/queued web-research results — list shape, not a Markdown blob. |

### System / utility
| Widget | Source | Effort | Notes |
| --- | --- | --- | --- |
| Storage & health | DB / workspace | S | DB size, file count, last migration/backup. |
| MCP servers status | MCP bridge | S–M | Connected servers, quick reconnect. |

## Security notes

- Any widget that fetches the network (Weather, Research feed) **must**
  route through the existing web-research egress chokepoint; no direct
  `fetch` from a widget.
- The image widget stores user content as a data URL in the local
  workspace DB only — no upload, no network. Downscaling caps the stored
  size.

## Out of scope

- Third-party / extension-contributed widgets — the API already supports
  them, this catalog is about built-ins.
- Drag/resize, appearance, and layout behavior — covered by M71 + its
  polish iterations.
