# Milestone 71 — Dashboard

> **Status:** Shipped. M71 framework + 6 widgets. Iterated past the initial spec —
> push-model AI delivery, per-widget appearance, per-page header collapse persisted
> to the DB, and three widgets beyond the original reference set (AI widget, image,
> autonomy activity). This doc has been back-updated from shipped code. For ground
> truth always verify against [src/built-in/dashboard/](../src/built-in/dashboard/).

## Post-spec evolution

The framework + 3 reference widgets shipped roughly as specced. Most of the
interesting design moves happened *after* first contact, in this order:

1. **Widget chrome modes + per-instance appearance.** `WidgetChromeStyle =
   'card' | 'minimal' | 'bare'` on the type, plus a `WidgetAppearance` JSON
   blob per instance (background, border, title, titleHidden) edited from a
   dedicated drawer. Migration 002 added `appearance_json` to
   `dashboard_widgets`. The clock widget defaults to `minimal` (transparent),
   AI/news/files default to `card`. Status dot only renders when status ≠ ok.
2. **Pane header collapse persisted to DB.** Migration 003 added
   `dashboard_pages.header_hidden`. (Initially landed in renderer
   localStorage, which M53 doesn't migrate, so the state was effectively
   lost across launches.) Collapsed header still exposes Add / Edit / expand
   via a reveal strip at the top edge.
3. **All-edge resize + smoother drag.** Resize handles on every edge + the
   bottom-right corner, live during drag (snap on release). Drag/resize
   share placement math through the same scheduler.
4. **Push-model AI widgets.** News brief and the new generic AI widget no
   longer compute their own output. They call `chat.submitPrompt` /
   `chat.runToolQuery`; the AI does the work with its real tools, then
   delivers the finished Markdown back via a shared `renderToWidget` tool.
   Slow / failed turns never wipe the last good content — the refresh
   handler returns a "Refreshing…" banner over the prior output, and the
   AI's later callback overwrites the whole cache.
5. **Title-addressable rendering.** `renderToWidget` resolves its target by
   `instanceId` *or* by case-insensitive title via
   `DashboardDataService.findWidgetByTitle` (refuses ambiguous matches). A
   widget's own refresh auto-injects its instanceId; users + skills can
   address a widget by title ("update my Morning News widget").
6. **Per-widget skills.** The generic AI widget exposes a `skill` field. If
   set, the refresh prompt prepends `Use the <skill> skill for this task.`
   so the model loads the user's authored skill from
   `.parallx/skills/<name>/SKILL.md`. Rich, reusable guidance lives in the
   skill; the widget config stays one field.
7. **In-body error feedback.** `WidgetHandle.renderError(message | null)`
   + persisted `errorMessage` on `WidgetContext`. Failed widgets surface
   reasons in their own body, not just as a header dot, and a relaunched
   broken widget says *why* it's broken instead of looking empty.
8. **News brief moved to `chat.runToolQuery`.** The original
   `chat.getInlineAIProvider` path was a raw model call with no tools; the
   model invented stories. `chat.runToolQuery` runs a bounded agentic loop
   with the web-research tools (webSearch + webFetch) and returns the final
   assistant text. Real sources, real URLs.
9. **Three more widgets shipped:** `ai-custom` (generic AI widget),
   `image` (drop / pick / paste an image, downscaled client-side, persisted
   as data URL in `cached_output`), `autonomy-activity` (query-backed via
   `chat.getRecentAutonomyEvents` — shows recent background agent runs).

What landed below the spec line:

- **`event` refresh policy.** Specced, never shipped. Live policies are
  `manual | interval | cron` only.

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
`pointerdown` on widget headers (move) and **all-edge + corner** resize handles
(resize), updates the cell live during the drag, snaps to integer cells, commits on
release.

Layout is **read-only by default and editable in an explicit "Edit layout" mode**
(toolbar toggle on the dashboard pane). When the pane header is collapsed, the same
Edit-layout button lives in the reveal strip so the toggle is always reachable.
Exiting edit mode commits the layout to the DB. This keeps the inactive dashboard
from accidentally rearranging itself when the user clicks into a widget.

## Widget contribution interface

Widgets are contributed by tools, including built-in tools. A tool registers a widget
type once and the dashboard can instantiate it many times across pages.

Current shipped shape (see
[dashboardTypes.ts](../src/built-in/dashboard/dashboardTypes.ts)):

```typescript
type WidgetChromeStyle = 'card' | 'minimal' | 'bare';

interface WidgetTypeRegistration<TConfig = Record<string, unknown>> {
  readonly typeId: string;
  readonly displayName: string;
  readonly description?: string;
  readonly icon?: string;
  /** Coarse category — drives picker grouping ('static' / 'query' / 'ai'). */
  readonly category: WidgetCategory;
  readonly defaultSize: { colSpan: number; rowSpan: number };
  readonly sizeBounds?: WidgetSizeBounds;
  readonly defaultConfig: TConfig;
  /** Drives the per-widget settings form. Primitives + textarea + string-list. */
  readonly configSchema?: WidgetConfigSchema;
  readonly defaultRefreshPolicy?: WidgetRefreshPolicy;
  /** Default chrome preset. Per-instance overrides live in WidgetAppearance. */
  readonly chromeStyle?: WidgetChromeStyle;

  /**
   * Pure data fetch. Runs both headless (interval/cron) and mounted (manual
   * refresh from the UI). MUST return a string ≤ MAX_CACHED_OUTPUT_BYTES.
   * Omit for widgets with nothing to refresh (e.g. clock, image).
   *
   * Push-model AI widgets (news brief, ai-custom) use refresh() as a
   * trigger: they dispatch chat.submitPrompt / chat.runToolQuery and return
   * a "Refreshing…" banner over the prior output. The real Markdown is
   * delivered asynchronously by the AI calling the `renderToWidget` tool.
   */
  refresh?(ctx: WidgetRefreshContext<TConfig>): Promise<string>;

  /** DOM render. Receives cachedOutput via ctx.cachedOutput on first paint. */
  createWidget(container: HTMLElement, ctx: WidgetContext<TConfig>): WidgetHandle;
}

interface WidgetRefreshContext<TConfig = unknown> {
  readonly instanceId: string;
  readonly pageId: string;
  readonly config: TConfig;
  /** Parallx API surface (commands, editors, fs, …). */
  readonly api: unknown;
  /** Last cached output for this instance, if any. */
  readonly cachedOutput: string | null;
}

interface WidgetContext<TConfig = unknown> extends WidgetRefreshContext<TConfig> {
  /** Persisted error message from the last failed refresh, if any. */
  readonly errorMessage: string | null;
  readonly onDidChangeConfig: Event<TConfig>;
  requestRefresh(): void;
  setCachedOutput(output: string): void;
  setError(message: string): void;
  clearError(): void;
}

interface WidgetHandle extends IDisposable {
  /** Called after setCachedOutput so the widget can re-paint from the new cache. */
  refreshFromCache?(cachedOutput: string | null): void;
  /**
   * Called on refresh failure (message) AND success (null) so the widget can
   * surface the reason in its own body instead of relying on the header status
   * dot. Failed-then-relaunched widgets show their reason on mount via the
   * persisted errorMessage on WidgetContext.
   */
  renderError?(message: string | null): void;
}

type WidgetRefreshPolicy =
  | { kind: 'manual' }
  | { kind: 'interval'; ms: number }   // ms ≥ 60_000
  | { kind: 'cron'; cron: string };    // standard 5-field cron
// (The originally-specced 'event' policy did not ship.)
```

Per-instance overrides live in `WidgetAppearance`, persisted as
`appearance_json` (migration 002) and edited from the dedicated Appearance
drawer:

```typescript
interface WidgetAppearance {
  /** 'default' = chrome default, 'transparent' = no fill, 'custom' = backgroundColor. */
  readonly background: 'default' | 'transparent' | 'custom';
  readonly backgroundColor: string | null;
  /** 'default' = chrome default, 'none' = no border, 'custom' = borderColor. */
  readonly border: 'default' | 'none' | 'custom';
  readonly borderColor: string | null;
  /** Per-instance title override. Null/empty falls back to displayName. */
  readonly title: string | null;
  /** Hide the title row entirely (actions still reveal on hover). */
  readonly titleHidden: boolean;
}
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
   container per row, instantiates the widget renderer, passes `cachedOutput` *and*
   `errorMessage` via `ctx`. Renderer paints from cache immediately — no network,
   no AI call. If `errorMessage` is non-null and `cachedOutput` is null, the
   widget paints its persisted reason instead of looking empty.
2. **Mounted refresh:** user clicks the header refresh button. Dashboard calls
   `widget.refresh(ctx)` and writes the resolved string to the cache.
3. **Headless refresh:** scheduled by cron / interval policy by the dashboard's
   own scheduler ([dashboardRefreshScheduler.ts](../src/built-in/dashboard/dashboardRefreshScheduler.ts)).
   Same code path as mounted — `refresh(ctx)` runs whether or not the tab is open;
   the result lands in the DB cache; next mount paints fresh.
4. **Config edits:** the dashboard's settings drawer renders a form from the widget's
   `configSchema`. On save, the dashboard writes `config_json` and fires
   `onDidChangeConfig` on the live instance.
5. **Errors:** `setError(msg)` flips `status='error'` in the DB and calls
   `WidgetHandle.renderError(msg)`, so the widget paints the reason in its own
   body. A subsequent `setCachedOutput` clears the error and calls
   `renderError(null)`.

### Push model — for AI widgets

AI widgets do **not** compute their result in `refresh()`. Pattern:

1. `refresh()` dispatches the work to the active chat session via
   `chat.submitPrompt({ text })` (or `chat.runToolQuery` for a bounded
   tool-loop). The prompt embeds the widget's `instanceId` and instructs
   the AI to deliver the finished Markdown via the shared `renderToWidget`
   tool when done.
2. `refresh()` returns immediately with a `"_Refreshing…_"` banner over
   the prior output, so the cell repaints instantly and the user always
   has the last good content visible while the new run is in flight.
3. The AI's later `renderToWidget` call resolves the target widget by
   `instanceId` *or* by case-insensitive title
   (`DashboardDataService.findWidgetByTitle`, refuses ambiguous matches)
   and writes the finished Markdown to `cached_output`. The cell re-paints.
4. A slow / failed turn never wipes good content — worst case, the
   "Refreshing…" banner lingers above yesterday's still-readable brief.

This is what makes "update my Morning News widget" work from chat or from a
hand-written skill: the widget is title-addressable.

### Single-flight per widget

Mounted refresh + headless refresh could race when the dashboard is open at the
moment the schedule fires. The dashboard enforces single-flight per `instanceId`:
a second `refresh()` request while one is in flight reuses the same promise.

## Storage

Two tables in the shared workspace DB, prefixed `dashboard_*`, evolved across
three migrations ([migrations/](../src/built-in/dashboard/migrations/)):

```sql
-- 001_dashboard_schema.sql — base
CREATE TABLE dashboard_pages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE dashboard_widgets (
  id                  TEXT PRIMARY KEY,
  page_id             TEXT NOT NULL REFERENCES dashboard_pages(id) ON DELETE CASCADE,
  widget_type_id      TEXT NOT NULL,
  row                 INTEGER NOT NULL,
  col                 INTEGER NOT NULL,
  row_span            INTEGER NOT NULL,
  col_span            INTEGER NOT NULL,
  position            INTEGER NOT NULL,
  config_json         TEXT NOT NULL,
  refresh_policy_json TEXT NOT NULL,
  cached_output       TEXT,
  cached_at           INTEGER,
  status              TEXT NOT NULL DEFAULT 'ok',
  error_message       TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_dashboard_widgets_page ON dashboard_widgets(page_id);

-- 002_widget_appearance.sql — per-instance visual overrides (JSON blob so
-- the shape can evolve without further migrations; empty {} = inherit chrome).
ALTER TABLE dashboard_widgets
  ADD COLUMN appearance_json TEXT NOT NULL DEFAULT '{}';

-- 003_page_header_hidden.sql — pane header collapse persisted in the
-- workspace DB (moved out of renderer localStorage, which M53 didn't migrate).
ALTER TABLE dashboard_pages
  ADD COLUMN header_hidden INTEGER NOT NULL DEFAULT 0;
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

## AI integration

AI-backed widgets use the active chat session as their runtime so they
inherit the user's model + skills + tools. Two distinct cross-extension
contracts grew out of the iteration:

**Push model** (`ai-custom`, news brief). The widget's `refresh()` calls
`chat.submitPrompt({ text })` with a prompt that:

- embeds the widget's `instanceId` so the AI can address its target,
- instructs the AI to gather what it needs with its normal tools,
- instructs the AI to deliver the finished Markdown via the shared
  `renderToWidget` tool.

`refresh()` returns immediately with a `"_Refreshing…_"` banner over the
prior output (preserved). The AI's later `renderToWidget` call overwrites
`cached_output` with the finished Markdown; the widget re-paints. Slow /
failed turns leave yesterday's content intact behind the banner.

**Bounded tool query** (news brief uses this for research). The chat tool
exposes `chat.runToolQuery({ messages, allowedTools })` — a bounded
agentic loop with a specified tool subset (web-research's `webSearch` +
`webFetch` for the news brief) that returns the final assistant text
synchronously. Used when the widget needs to wait for a structured result
rather than handing off to the user's chat session.

**Legacy** (`chat.getInlineAIProvider`). Still available; canvas inline AI
uses it. Initially used by the news brief, replaced by `runToolQuery`
when fabrication was the observed failure mode (raw-model calls with no
tools invented stories).

**Title-addressable targets.** `renderToWidget` resolves its target by
`instanceId` *or* by case-insensitive title via
`DashboardDataService.findWidgetByTitle` (refuses ambiguous matches). The
widget's own refresh auto-injects its instanceId; users and skills can
address a widget from chat by its title.

**Per-widget skills.** The `ai-custom` widget exposes a `skill` field. If
set, the refresh prompt prepends `Use the <skill> skill for this task.`
so the model loads the user's authored skill from
`.parallx/skills/<name>/SKILL.md`. Rich, reusable instructions live in the
skill; widget config stays a single field.

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

## M71 ship list (as shipped)

**Framework:**

- `parallx.dashboard` built-in tool
- Editor provider for `typeId: 'dashboard'` (one instance per page)
- Left-ribbon icon + "Dashboards" sidebar view listing pages, with
  active-page highlight that tracks the active editor + new / rename /
  duplicate (copies all widgets) / delete
- 12-column CSS Grid layout primitive
- "Edit layout" mode with drag-to-move + all-edge drag-to-resize, live
  during drag, snap on release
- Pane header collapsible per page, persisted to
  `dashboard_pages.header_hidden`; reveal strip at top edge exposes
  Add / Edit / expand when collapsed
- Widget contribution API (`registerWidgetType`) with the `refresh` /
  `createWidget` split + `WidgetHandle.refreshFromCache` + `renderError`
- `WidgetChromeStyle` ('card' / 'minimal' / 'bare') on the type
- `WidgetAppearance` per-instance (background, border, title,
  titleHidden) edited in a dedicated Appearance drawer
- Widget settings drawer (renders form from `configSchema`)
- Status dot only renders when status ≠ ok
- Refresh scheduler (manual + interval + cron), dashboard-local, not
  coupled to `ICronService`. Single-flight per instance. Four hard limits.
- Three-migration schema (base + appearance_json + header_hidden)
- Default page auto-created on first workspace open (gated by a
  workspaceState flag so it doesn't fight workspace-restore)
- "Add widget" picker grouped by category, with chrome-aware previews

**Shipped widgets:**

1. **`parallx.dashboard.clock-and-links`** — *static.* `chromeStyle:
   'minimal'`, 12h default + 24h option, configurable seconds + greeting
   + quick links.
2. **`parallx.dashboard.recent-files`** — *query.* Reads workspace
   storage `parallx:quickAccess:recentFiles`. Click opens via
   `openFileEditor`.
3. **`parallx.dashboard.news-brief`** — *AI, bounded tool query.* Uses
   `chat.runToolQuery` with web-research tools (webSearch + webFetch) to
   do real research with real cited URLs. Keeps last good brief behind a
   "Refreshing…" banner during a refresh.
4. **`parallx.dashboard.ai-custom` ("AI widget")** — *AI, push model.*
   Generic. User writes a prompt + optional `skill` name; refresh
   dispatches via `chat.submitPrompt`; AI delivers Markdown back via
   `renderToWidget`. One widget, any task.
5. **`parallx.dashboard.image`** — *static.* User picks / drops an image;
   downscaled client-side to fit `MAX_CACHED_OUTPUT_BYTES`; persisted as
   data URL in `cached_output` (no extra storage column needed).
6. **`parallx.dashboard.autonomy-activity`** — *query.* Reads
   `chat.getRecentAutonomyEvents` for recent background agent runs —
   trigger, outcome, duration, tool count. Body-free projection of the
   autonomy task rail.

## Out of scope (still deferred)

- **Custom themed widget backgrounds beyond color choices.** Backgrounds
  are color or transparent; image backgrounds, gradients, glass effects
  not in scope.
- **Cross-extension widgets** owned by other tools (`budget.summary`,
  calendar embed, etc.). Land in their owning tool's milestone.
- **Widget marketplace / discovery.** Picker just lists what is
  registered.
- **Sharing / export.**
- **Deprioritization of headless refresh when the chat is active.**
- **Exponential backoff on consecutive refresh errors.**

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
  The dashboard runs its own `setTimeout`-based scheduler and reuses the
  exported `parseDuration` / `parseCronField` helpers from
  openclawCronService. No coupling to autonomy semantics.
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
| Push-model AI delivery         | `chat.submitPrompt({ text })` (fires the active chat session) + `renderToWidget` tool registered by the dashboard (resolves target by `instanceId` OR title via `findWidgetByTitle`) |
| Bounded tool query             | `chat.runToolQuery({ messages, allowedTools })` — bounded agentic loop, returns final assistant text. Used by news brief with web-research tools.            |
| Recent autonomy events         | `chat.getRecentAutonomyEvents({ sinceDays, limit })` — body-free projection of the autonomy task rail. Used by autonomy-activity widget.                     |
| Inline AI (legacy)             | `chat.getInlineAIProvider` — still registered, still used by canvas inline AI. Replaced by `chat.runToolQuery` for the news brief.                           |
| Recent files (widget)          | `workspaceStorage.get('parallx:quickAccess:recentFiles')` — same key the welcome page uses; JSON array of file URIs                                          |
| Workspace state per tool       | `context.workspaceState.get/update<T>(key, default?)`                                                                                                        |

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

## Resolved during implementation

- **Drag region conflict with widget content.** Resolved: drag region is
  the widget header in normal mode; in edit mode, the whole card is
  draggable (resize handles take precedence on the edges). Recent-files
  rows stay clickable because they're inside the body, not the header.
- **Widget header customization.** Resolved via `chromeStyle` + per-instance
  `WidgetAppearance.title` / `titleHidden`.
- **Cached output format.** Stays string. The dashboard doesn't interpret
  it; AI widgets that produce Markdown share a small renderer
  (`widgets/markdownRenderer.ts`); the image widget stores a data URL;
  recent-files stores JSON. Each widget owns its format.
- **Headless wake when app is minimized.** Scheduler uses `setTimeout` /
  `setInterval` on the renderer event loop. Electron throttles hidden
  windows to ≥1 s; the 60 s minimum interval keeps us above the throttle.
