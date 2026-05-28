# Milestone 71 — Dashboard

> **Status:** Planning. M71 framework + 3 reference widgets. Prototype-first — interaction
> details (drag affordances, config UX, header chrome) are expected to shift after
> first contact.

## Why

Parallx is a workbench, but it has no landing surface. Users open the app and pick a
tool — canvas, chat, budget — but there is no place that *unifies* what is happening
across the workspace. The dashboard is that place: a launchpad that pulls a thin slice
of every tool into one screen so the user can see the workspace at a glance and jump
into anything in one click.

Concretely, the dashboard should be able to host things like:

- A clock / calendar header
- A daily news brief (background AI call to web research)
- Recent files / recent chats (clickable, opens the relevant editor)
- A budget snapshot (no AI — query the budget DB and render)
- A task list (eventually backed by a `tasks` tool, possibly synced with Google Calendar)
- A freeform notes area (a canvas editor embedded as a widget)
- Anything an extension wants to contribute

This is not about cramming features into a home page. It is about giving every tool a
**publish surface** — the same way the workbench gives every tool a sidebar slot — so
new tools land in the user's field of view without each one inventing its own home.

## Architecture decision: a standalone tool, not a canvas page

The dashboard is its own built-in tool (`parallx.dashboard`), opened as an editor
pane (`typeId: 'dashboard'`, one instance per dashboard page). It is **not** a canvas
page with a special block type.

Rationale:

- **Layout shapes are different.** Canvas is a flowing-text editor (Tiptap/ProseMirror,
  blocks stack vertically). A dashboard is a grid (2D placement, fixed cell sizes).
  Borrowing canvas's block-handle / column-drop mechanics means dragging Tiptap into a
  tool that doesn't need it.
- **Lifecycle independence.** Canvas pages have block-state invariants, page-cover /
  ribbon / breadcrumb infra, and content-reload semantics that would all become
  load-bearing for the dashboard. The dashboard should not break when canvas refactors.
- **Widget framework needs its own contribution point.** Widgets are not Tiptap nodes.
  Pretending they are is a leaky abstraction.

The dashboard can *embed* a canvas editor inside a widget — that is the right way to
get a "notes area inside the dashboard". Layout vs. rich-text stays decoupled, and the
two compose.

## Editor pane housing

Each dashboard page is opened via `api.editors.openEditor({ typeId: 'dashboard',
instanceId: pageId, title, iconHtml })` — same surface canvas pages use
([editorsBridge.ts:180-208](../src/api/bridges/editorsBridge.ts#L180-L208)).
The dashboard registers an editor provider via
`api.editors.registerEditorProvider('dashboard', { createEditorPane(container, input?) })`
([editorsBridge.ts:130-175](../src/api/bridges/editorsBridge.ts#L130-L175)).

Workspace restore: the editor input is rebuilt from serialized data by the
registered deserializer ([editorsBridge.ts:144-158](../src/api/bridges/editorsBridge.ts#L144-L158));
`iconHtml` is intentionally not persisted, so the dashboard provider re-seeds
`setName` / `setIconHtml` during pane init — same pattern as canvas
([canvasEditorProvider.ts](../src/built-in/canvas/canvasEditorProvider.ts)).

This gives us for free:

- Tab bar entry, Open Editors entry, workspace-restore on app reopen
- Multiple dashboards open simultaneously in different tabs
- Pinning / sharing / closing using existing editor commands

There is no separate dashboard pane in the workbench shell. **No dashboard-internal
sidebar in M71** — if a user accumulates too many widgets, the answer is more
dashboard pages, not nested navigation.

## Layout model: snap-to-grid

A dashboard page is a 12-column CSS Grid; rows grow as needed. Each widget instance
occupies an integer column×row rectangle:

```typescript
interface WidgetPlacement {
  row: number;     // top row, 0-indexed
  col: number;     // left column, 0-indexed
  rowSpan: number; // ≥ 1
  colSpan: number; // 1 ≤ colSpan ≤ 12
}
```

The grid is plain CSS Grid — no layout engine, no Tiptap, no virtual nodes. Drag-to-
move and drag-to-resize are pure DOM interactions: the dashboard listens for
`pointerdown` on widget headers (move) and corner handles (resize), snaps to integer
cells during the drag, commits on release.

Layout is **read-only by default and editable in an explicit "Edit layout" mode**
(toolbar toggle on the dashboard pane). Exiting edit mode commits the layout to the
DB. This keeps the inactive dashboard from accidentally rearranging itself when the
user clicks into a widget.

## Widget contribution interface

Widgets are contributed by tools, including built-in tools. A tool registers a widget
type once and the dashboard can instantiate it many times across pages.

```typescript
interface WidgetTypeRegistration {
  /** Unique id, namespaced by tool. e.g. 'parallx.dashboard.clock', 'budget.summary'. */
  readonly typeId: string;
  /** Human-readable label shown in the widget picker. */
  readonly displayName: string;
  /** Icon (codicon id or pre-rendered SVG). */
  readonly icon?: string;
  /** Short description shown in the picker. */
  readonly description?: string;
  /** Default cell size when first added. User can resize freely after that. */
  readonly defaultSize: { colSpan: number; rowSpan: number };
  /** Optional min/max bounds for resize, if the widget has hard layout requirements. */
  readonly sizeBounds?: { minColSpan?: number; maxColSpan?: number; minRowSpan?: number; maxRowSpan?: number };
  /** Default config for a new instance. */
  readonly defaultConfig: Record<string, unknown>;
  /**
   * Optional schema for the config — drives the per-widget settings form.
   * Restricted to flat objects of primitives: string / number / boolean / enum.
   * Anything fancier and the widget can render its own settings drawer.
   */
  readonly configSchema?: WidgetConfigSchema;
  /** Optional refresh policy hint — the user can override per instance. */
  readonly defaultRefreshPolicy?: WidgetRefreshPolicy;

  /**
   * Pure data fetch. Runs both headless (cron / interval) and mounted (manual
   * refresh from the UI). MUST return a string ≤ 256 KB. Omit for widgets with
   * nothing to refresh (e.g. a clock).
   */
  refresh?(ctx: WidgetRefreshContext): Promise<string>;

  /**
   * DOM render. Only runs when the dashboard is mounted. The widget paints from
   * ctx.cachedOutput on first paint and from subsequent setCachedOutput calls.
   */
  createWidget(container: HTMLElement, ctx: WidgetContext): WidgetHandle;
}

interface WidgetRefreshContext {
  readonly instanceId: string;
  readonly pageId: string;
  readonly config: Record<string, unknown>;
  /** Access to the workbench API surface (chat, fs, editors, mcp, db, …). */
  readonly api: ParallxApi;
}

interface WidgetContext extends WidgetRefreshContext {
  /** Latest cached output, if any. Widgets render from cache on first paint. */
  readonly cachedOutput: string | null;
  /** Subscribe to config changes from the dashboard's settings drawer. */
  readonly onDidChangeConfig: Event<Record<string, unknown>>;
  /** Trigger a manual refresh (calls the widget's refresh() if defined). */
  requestRefresh(): void;
  /** Push fresh output. Persists to DB cache and clears any error state. */
  setCachedOutput(output: string): void;
  /** Flip status to 'error' with a message. Shown in the widget chrome with retry. */
  setError(message: string): void;
  /** Explicitly clear an error without writing new output. */
  clearError(): void;
}

interface WidgetHandle {
  /** Called when the widget is removed, page closes, or extension deactivates. */
  dispose(): void;
}

type WidgetRefreshPolicy =
  | { kind: 'manual' }
  | { kind: 'interval'; ms: number }            // ms ≥ 60_000
  | { kind: 'cron'; cron: string }              // standard cron expression
  | { kind: 'event'; eventName: string };       // workbench event the widget listens for
```

Registration is one line from the tool's `activate()`:

```typescript
parallx.dashboard.registerWidgetType({ typeId: 'budget.summary', /* … */ });
```

Deregistration on tool deactivate removes the widget from the picker but leaves
existing instances in the DB; the dashboard renders an "Unavailable — extension X
not installed" placeholder until the tool reactivates. This matches how the workbench
handles tool-contributed editors today.

### Why widgets do not own their layout slot

The widget renderer gets a `container` and a `ctx`. It does not know its placement,
does not draw resize handles, does not negotiate with neighbours. The dashboard owns
all of that. Widgets only render into the box they're given. This is what keeps the
contribution model open — third-party widgets do not need to know about the grid.

## Widget lifecycle

1. **First paint (open or reopen):** dashboard reads `dashboard_widgets`, creates a
   container per row, instantiates the widget renderer, passes `cachedOutput` via
   `ctx`. Renderer paints from cache immediately — no network, no AI call.
2. **Mounted refresh:** user clicks the header refresh button. Dashboard calls
   `widget.refresh(ctx)` and writes the resolved string to the cache.
3. **Headless refresh:** scheduled by cron / interval policy. The dashboard tool
   registers callbacks with `ICronService` that run regardless of whether any
   dashboard tab is open. Each callback calls `refresh(ctx)` and writes the result to
   the cache. Next time the user opens the dashboard, the cell paints fresh from
   cache instantly.
4. **Config edits:** the dashboard's settings drawer renders a form from the widget's
   `configSchema`. On save, the dashboard writes `config_json` and fires
   `onDidChangeConfig` on the live instance. Widgets that prefer the simpler
   "re-render from scratch" path can ignore the event and let the dashboard
   re-instantiate them on the next refresh — both are valid.
5. **Errors:** `setError(msg)` flips `status='error'` in the DB; the cell shows the
   message with a retry button that triggers another `refresh(ctx)`. A subsequent
   `setCachedOutput` clears the error.

### Single-flight per widget

Mounted refresh + headless refresh could race when the dashboard is open at the
moment the cron fires. The dashboard enforces single-flight per `instanceId`: a
second `refresh()` request while one is in flight is a no-op (or coalesces to a
"will refresh after current completes" — the simpler form ships first).

## Storage

Two tables in the shared workspace DB, prefixed `dashboard_*`:

```sql
CREATE TABLE dashboard_pages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,         -- ordering, even if UI ships with 1 page
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE dashboard_widgets (
  id                  TEXT PRIMARY KEY,
  page_id             TEXT NOT NULL REFERENCES dashboard_pages(id) ON DELETE CASCADE,
  widget_type_id      TEXT NOT NULL,
  -- Placement
  row                 INTEGER NOT NULL,
  col                 INTEGER NOT NULL,
  row_span            INTEGER NOT NULL,
  col_span            INTEGER NOT NULL,
  position            INTEGER NOT NULL,            -- stable ordering tiebreaker
  -- Behaviour
  config_json         TEXT NOT NULL,
  refresh_policy_json TEXT NOT NULL,
  -- Cache + status (managed by dashboard, written by widgets via ctx)
  cached_output       TEXT,
  cached_at           INTEGER,
  status              TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'error' | 'running'
  error_message       TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX idx_dashboard_widgets_page ON dashboard_widgets(page_id);
```

### What the dashboard owns vs. what widgets own

- **Dashboard owns:** layout, widget instance metadata, refresh policy, cached output,
  status. All in `dashboard_widgets`.
- **Widgets own:** anything that is not "what does this instance currently render".
  A news widget that fetches headlines stores those headlines in its extension's own
  tables / files / KV. The dashboard does not become a junk drawer for widget data.

The dashboard tool's startup hook auto-creates a default page on first open if no
rows exist — no init command. New schema versions land via the standard migration
runner.

## Background AI calls

AI-backed widgets (news brief, summaries) must use a **background chat path** — not
the active chat thread the user is mid-conversation in.

The verified surface: the chat tool registers a command
`chat.getInlineAIProvider` ([chat/main.ts:2372-2395](../src/built-in/chat/main.ts#L2372-L2395))
that returns `{ sendChatRequest, retrieveContext? }` where:

```ts
sendChatRequest(
  messages: readonly IChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
  signal?: AbortSignal,
): AsyncIterable<IChatResponseChunk>;
```

Widget refresh handlers obtain the provider via
`api.commands.executeCommand('chat.getInlineAIProvider')` (cached after first call),
build messages, await the async iterable, and pass the concatenated content to
`ctx.setCachedOutput`. This is the same surface canvas's inline-AI uses
([canvas/main.ts:289-296](../src/built-in/canvas/main.ts#L289-L296)) — no new
chat infrastructure for M71.

## Hard limits

The four numbers that keep headless refresh from becoming a slowdown vector:

| Limit                                            | Value     | Enforced where                                  |
|--------------------------------------------------|-----------|-------------------------------------------------|
| Minimum refresh interval                         | 60 s      | `registerWidgetType` rejects shorter intervals  |
| Max simultaneous AI refreshes per workspace      | 1         | Dashboard's refresh scheduler (queue the rest)  |
| Max `cached_output` size                         | 256 KB    | `setCachedOutput` truncates with warning        |
| Per-refresh timeout                              | 60 s      | Wrapper kills the refresh; widget flips `error` |

These are conservative starting numbers, not contracts. We can loosen any of them
when a real widget needs it — but we ship with them in place to prevent the
"I configured 20 widgets and now the app is slow" failure mode.

## M71 ship list

**Framework:**

- `parallx.dashboard` built-in tool
- Editor provider for `typeId: 'dashboard'` (one instance per page)
- 12-column CSS Grid layout primitive
- "Edit layout" mode with drag-to-move and drag-to-resize (snap-to-cell, commit on
  release)
- Widget contribution API (`registerWidgetType`) with the `refresh` / `createWidget`
  split
- Widget settings drawer (renders form from `configSchema` — primitives only)
- Refresh scheduler wired into `ICronService` (cron + interval + event policies,
  manual via header button)
- Headless refresh path with single-flight per instance and the four hard limits
- Two-table schema + initial migration
- Default page auto-created on first workspace open
- "Add widget" picker listing registered widget types
- Per-widget header: title, status indicator, refresh button, ⋯ menu (configure,
  remove)

**Reference widgets (prove the model — not the feature list):**

1. **`parallx.dashboard.clock-and-links`** — *static.* Renders date/time +
   user-configured quick links. No `refresh()`. Proves the render path and the
   `configSchema` form (the links list is an enum-of-strings).
2. **`parallx.dashboard.recent-files`** — *query-backed.* `refresh()` queries the
   workspace filesystem index for top N recent files; click opens in the appropriate
   editor via `ctx.api.editors.openFileEditor`. Proves data binding + cross-tool
   navigation without AI.
3. **`parallx.dashboard.news-brief`** — *AI-backed.* `refresh()` runs a background
   chat request with the web-fetch tool, using a prompt template the user configures
   (default: "top 10 news stories for {{location}}"). Manual refresh in M71. Proves
   the headless path with AI + per-instance config.

Three widgets cover the three lifecycle shapes — static, query-driven, AI-driven —
which is enough to prove the contribution model holds.

## Out of scope (deferred)

- **Multi-page dashboard UI.** Schema supports multiple pages from day one but M71
  ships UI for one default page only.
- **Cross-extension widgets (`budget.summary`, `tasks.today`, calendar, canvas notes
  embed).** Each lands in its owning tool's milestone once the framework is real and
  the contribution API has survived first contact.
- **Custom user-defined AI prompt widget** beyond the news brief's templated prompt.
- **Widget marketplace / discovery.** Picker just lists what is registered.
- **Sharing / export, themed widget backgrounds, custom widget styling.**
- **Deprioritization of headless refresh when the chat is active.** Polish, not
  correctness — landing in M71.5 if needed.
- **Exponential backoff on consecutive refresh errors.** M71.5.

## Implementation discipline

Same features, smart implementation. The trap with a framework like this is shipping
infrastructure for needs we don't yet have. Concretely, at build time:

- **Use CSS Grid for layout. Don't write a layout engine.** No virtual DOM, no
  collision-resolver, no react-grid-layout dependency. `grid-template-columns: repeat(12, 1fr)`
  + `grid-column: <col> / span <colSpan>` does everything we need. Drag math is
  `Math.round((pointerX - gridLeft) / cellWidth)`.
- **Reuse the existing migration runner.** Drop `*.sql` files in
  `src/built-in/dashboard/migrations/` and call `electron.database.migrate(dir)` in
  `activate()` — same pattern as canvas
  ([canvas/main.ts:544-568](../src/built-in/canvas/main.ts#L544-L568)).
- **Don't couple to `ICronService`.** Its `CronTurnExecutor` fires agent turns and
  there's only one executor per service ([openclawCronService.ts:162-275](../src/openclaw/openclawCronService.ts#L162-L275)).
  Build a tiny dashboard-local scheduler — `setTimeout` for cron, `setInterval`
  for interval — and reuse the exported `parseDuration` / `parseCronField` /
  `computeNextCronRun` helpers from openclawCronService when we need them.
  ~50 lines, no coupling to autonomy semantics.
- **`configSchema` form: render the four primitive types and that's it.** No nested
  objects, no conditionals, no validation framework. If a widget needs richer config,
  it can render its own settings UI later.
- **Headless refresh is the same code path as mounted refresh.** Both call
  `widget.refresh(ctx)`. The only difference is that mounted refreshes also call
  `setCachedOutput` → re-paint synchronously, while headless refreshes write to the
  DB and stop. One function, two callers.
- **Widget settings drawer is a single shared component.** Same drawer for every
  widget, populated from `configSchema`.
- **Status / error rendering is dashboard-side chrome.** Widgets call `setError`;
  the dashboard draws the error UI.
- **Single-flight is a `Map<instanceId, Promise>`** held in the refresh scheduler.
  Second `refresh()` while the first is pending returns the same promise.
- **Re-instantiation is the default response to config change.** Fire
  `onDidChangeConfig` for widgets that opt in; otherwise dispose + recreate.
- **DB access via `window.parallxElectron.database`.** Same pattern as
  CanvasDataService ([canvasDataService.ts:160-173](../src/built-in/canvas/canvasDataService.ts#L160-L173)) —
  typed wrapper around the IPC bridge, no ORM, no migrations DSL.
- **Don't pre-build extension points we won't use in M71.** Widget headers are not
  customizable (body-only render). Widget chrome is not themeable. No widget-to-
  widget messaging.

## Existing pieces to build on (verified)

| Piece                          | Verified location                                                                                                                                            |
|--------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Built-in tool manifest         | [src/tools/builtinManifests.ts](../src/tools/builtinManifests.ts) (add `DASHBOARD_MANIFEST`) + [workbench.ts:2829-2846](../src/workbench/workbench.ts#L2829-L2846) builtins array |
| Tool activate(api, context)    | [src/built-in/canvas/main.ts:114](../src/built-in/canvas/main.ts#L114) pattern; receives `ParallxApi` + `ToolContext`                                        |
| Editor provider                | `api.editors.registerEditorProvider(typeId, { createEditorPane })` — [editorsBridge.ts:130](../src/api/bridges/editorsBridge.ts#L130)                        |
| Editor focus / open by id      | `api.editors.openEditor({ typeId, instanceId, ... })`, `api.editors.focusEditor(id)` (M81-era)                                                               |
| DB migration runner            | `electron.database.migrate(migrationsDir)` — [canvas/main.ts:544-568](../src/built-in/canvas/main.ts#L544-L568); files at `src/built-in/<tool>/migrations/*.sql` |
| DB query bridge                | `window.parallxElectron.database.run/get/all/runTransaction` — [canvasDataService.ts:160-173](../src/built-in/canvas/canvasDataService.ts#L160-L173)         |
| Cron parsing helpers (reusable)| `parseDuration`, `parseCronField`, `computeNextCronRun` exported from [openclawCronService.ts](../src/openclaw/openclawCronService.ts)                       |
| Background AI request          | `api.commands.executeCommand('chat.getInlineAIProvider')` → `{ sendChatRequest, retrieveContext? }` — [chat/main.ts:2372-2395](../src/built-in/chat/main.ts#L2372-L2395) |
| Recent files (M71 widget)      | `workspaceStorage.get('parallx:quickAccess:recentFiles')` — [welcome/main.ts:338,357-365](../src/built-in/welcome/main.ts#L338) (JSON array of file URIs)    |
| Workspace state per tool       | `context.workspaceState.get/update<T>(key, default?)` — [canvas/main.ts:261-269](../src/built-in/canvas/main.ts#L261-L269)                                   |
| Web-fetch tool (for news brief)| `ext/web-research/` — referenced via prompt → tool-use; verified at Phase 4                                                                                  |

## Success criteria

- Workspace opens for the first time → a dashboard editor opens with the default page
  and at least the clock-and-links widget visible.
- Adding a new widget from the picker, configuring it, and seeing it render is a
  single sub-30-second flow with no app reload.
- A widget in `error` state shows a clear message and a working retry button. The
  page does not crash; other widgets keep rendering from their own caches.
- The news brief widget refreshes via a background AI call without touching the
  user's active chat thread.
- Closing the dashboard and reopening it paints from cache instantly — no AI call,
  no re-query.
- A cron-policy widget refreshes correctly even when no dashboard tab is open
  (headless), bounded by the four hard limits.
- An extension that contributes a widget type can register it at activate-time with
  no changes required to `parallx.dashboard`. Deactivating the extension leaves the
  instance in place with an "Unavailable" placeholder; reactivating restores it.
- The dashboard editor participates in workspace restore — closing and reopening the
  app preserves which dashboard pages were open and which was active.

## Open questions to resolve at implementation

- **Drag-to-move conflict with click-into-widget content.** Header-only drag region
  is the assumption; verify with a recent-files widget where rows are clickable.
- **Widget header customization.** Body-only render is the M71 assumption.
- **Cached output format.** String — widgets serialize to whatever string format they
  prefer (markdown, plain text, JSON). The dashboard does not interpret the cache;
  widgets read their own cache in `createWidget` and render it however they choose.
- **Headless wake when app is minimized.** Our scheduler uses `setTimeout` /
  `setInterval` which fire on the renderer event loop. Electron throttles renderer
  timers when the window is hidden (≥1 s minimum). Cron-policy widgets with intervals
  ≥ 60 s are unaffected; sub-second intervals would be throttled but we already
  enforce a 60 s floor.
