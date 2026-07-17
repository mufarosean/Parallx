# Milestone 86 — Dashboard as a System: Contribution, Ownership, Orchestration

> **Status: BUILT** (2026-07-16, third slice; tsc + unit suite + build green).
> Everything below is implemented except three explicitly-deferred items:
>
> - **C4 page schedules — DONE**: `dashboard_pages.refresh_policy_json`
>   (migration 005), headless schedule engine in dashboard main (fires
>   whether or not the page is open; widgets refresh through the admission
>   queue), and a page-header schedule popover (off / hourly / every 4h /
>   daily / weekdays / custom cron; local→UTC conversion for times).
> - **renderMode 'markdown' — DONE**: contract + validation + dashboard-side
>   renderer with `parallx://` link routing through the link resolver.
>   News-brief re-homed to the web-research extension as plain JS using it.
> - **C3 — DONE**: timer (sessions logged as data), tracker board
>   (items × stages), saved-query (retrieval + AI modes), table/chart over
>   .csv/.tsv/.xlsx/.xls (new `dashboard:readTable` IPC parsing with the
>   same `xlsx` package the indexer uses — the renderer fs bridge is
>   utf-8-only), and the picker's Templates rail (8 recipes spanning study,
>   home, finance, news domains; recipes hide when their type is absent).
> - **C2 — DONE with a correction**: the planner ALREADY contributed three
>   widgets (tasks-summary, calendar-agenda, calendar-view) via a
>   `dashboard.getRegistry` polling workaround — migrated to
>   `api.dashboard` (the polling bug the hub was designed to kill).
>   Canvas now contributes `parallx.canvas.page-embed` (markdown render of
>   any page, heading links back to the real page).
>
> **Deferred, with reasons:** (1) canvas *database-view* widget — needs a
> row-query mapping through DatabaseDataService; follow-up slice. (2) tasks
> widget planner source-switch — redundant: the planner's own tasks-summary
> widget already IS the planner-backed task list; keeping the dashboard
> tasks widget as the private checklist is the cleaner separation. (3) C5
> USER_GUIDE rewrite is summarized rather than exhaustive.
> suite, build green): `parallx.dashboard` bridge + hub with validation /
> namespacing / legacy-owner table; hub→registry mirror in dashboard main;
> live placeholder⇄widget re-mount on registry change; `provider_tool_id`
> column (migration 004) + provider-named placeholders; recent-files re-homed
> to explorer (tracker + `explorer.getRecentItems` + legacy command alias);
> autonomy-activity re-homed to chat; budget contributes
> `parallx.budget.mtd-spend` (external proof); 15 bridge unit tests; authoring
> doc §4.15. **Deferred within C2:** news-brief → web-research — moving an
> AI/markdown widget into a plain-JS extension needs a `renderMode:'markdown'`
> contract (dashboard renders cached markdown itself) so external widgets
> don't duplicate the renderer; land it alongside the renderMode work.
>
> **C4 core BUILT** (2026-07-16, same-day follow-up; tsc + 3,749 unit tests +
> build green): `chat.runBackgroundPrompt` command on the ephemeral-session
> rail (`chat/utilities/backgroundPromptRunner.ts` — create → sendRequest →
> purge, cron-executor parity, every run appended to the autonomy log with
> origin 'dashboard'); all five AI widgets (custom, live, news, weather,
> market) default to background turns — the chat panel is never revealed —
> with a per-widget "Run in chat" escape-hatch button (`WidgetRefreshContext.
> mode`); `refresh` contract now allows returning `null` ("output delivered
> via my own channel — don't clobber the cache"); manual refresh + new
> "Refresh all" header button route through the scheduler's admission queue
> (previously manual clicks bypassed the AI cap entirely);
> `dashboard.aiRefreshConcurrency` settings-registry entry (default 2, live-
> read, clamped 1-8) replaces the hardcoded cap; AI refreshes get a 5-minute
> timeout (`AI_REFRESH_TIMEOUT_MS`) instead of 60s. **Remaining in C4:**
> page-level refresh schedules ("weekdays 7:00 refresh this page"). C3 and
> C5 not started. (M85 is the in-flight AI-agency milestone; overlap is
> confined to the ephemeral-session substrate, which already exists.)
>
> **Boundary:** Dashboard built-in, a new `parallx.dashboard` API bridge in
> `src/api/`, widget re-homing inside existing built-ins (planner, canvas,
> explorer, chat/autonomy) and one external extension (budget), and a new
> background-refresh executor on the existing ephemeral-session rail. No new
> main-process/IPC surface except what the xlsx file-source needs (read-only
> file access already exists). Explicitly **out of scope**: camera/stream
> widgets, extension-raised alerting into the signal bus, and the mind-map —
> each is a candidate follow-on once this system exists.

## Why

Parallx is a life management system: a substrate where a person organizes the
artifacts of their life — documents, notes, schedules, media, numbers — and
queries them in context. The dashboard should be that system's **glance-and-act
layer**: the surface you open first, where every widget is a *door, not a
poster* — it shows live state from some organ of the system, and one click
takes you into that organ to act.

Today the dashboard is architecturally strong (12-column grid, pages, chrome
presets, per-widget cron/interval refresh, AI push model with sandboxed HTML,
skill pinning) but systemically isolated:

1. **Widgets are islands, not organs.** Not one of the 13 built-in widgets
   reads from the planner, canvas, index, or any extension. Even the Tasks
   widget keeps a private JSON checklist while a full planner with two-way
   Google sync sits one part over.
2. **The registry is public in name only.** `DashboardRegistry` circulates
   among built-ins by direct import; there is **no `parallx.dashboard` bridge
   in `src/api/`**, so extensions cannot contribute widgets at all. This
   contradicts the founding thesis (M1: a shell hosting arbitrary tools
   "without embedding assumptions about their meaning or behavior") — the
   dashboard currently embeds every assumption, because only the dashboard
   can define widgets.
3. **AI widgets don't scale past one.** Refresh routes through
   `chat.submitPrompt`, which reveals the chat panel and streams into the
   user's *active visible session*, serialized behind an AI-concurrency cap
   of 1. Refreshing a dashboard of five AI widgets means five manual clicks
   and five hijackings of the user's chat. There is no "refresh my dashboard"
   as a single intent.

**The thesis of M86: the dashboard becomes a system with three contracts —
anyone can contribute widgets (contribution), widgets belong to the organ that
owns their data (ownership), and the dashboard can refresh itself as a whole,
with AI work fanned out to background agents (orchestration).**

The design test for every piece: *could two people with unrelated lives — one
studying for an actuarial exam, one managing home documents and finances —
both configure this without us writing their domain into the code?* Every
widget below is stated domain-blind and must ship with two unrelated
instantiations documented in its picker description.

---

## Capability 1 — Widget contribution API (`parallx.dashboard`)

Extensions (and built-ins, through the same door) register widget types the
way they register views, commands, and editors today.

### Surface

```ts
// api.dashboard (new bridge: src/api/dashboardBridge.ts)
registerWidgetType<TConfig>(reg: WidgetTypeRegistration<TConfig>): Disposable;
listWidgetTypes(): readonly WidgetTypeDescriptor[];   // metadata snapshot, no createWidget
```

- `WidgetTypeRegistration` is the existing shape in `dashboardTypes.ts` —
  it was designed as the stable contribution contract; this milestone makes
  that true. Validation at the bridge boundary: `validateRefreshPolicy`,
  size bounds, `MAX_CACHED_OUTPUT_BYTES`, and **typeId namespacing** — an
  extension's typeIds are forced under its extension id
  (`ext.budget.burn-rate`), exactly like command/view contributions.
- **Activation-order independence.** Contributions land in a pending queue if
  the dashboard tool activates later; the registry replays them. Deactivation
  disposes the type but **not** persisted instances (see below).
- **Provider-unavailable placeholder.** A persisted widget whose type isn't
  currently registered (extension disabled/uninstalled) renders a neutral
  placeholder card — type name, "provided by X, currently unavailable",
  enable/remove actions. A missing extension must never corrupt or evict a
  user's dashboard layout.
- Docs: new "Contributing dashboard widgets" section in
  `PARALLX_EXTENSION_AUTHORING_FOR_AI.md`, written for AI extension authors.

### Acceptance

- The budget extension contributes a real widget (C2) through this bridge
  with zero dashboard-internal imports.
- Disabling budget mid-session leaves the instance as a placeholder;
  re-enabling restores it live, cached output intact.

## Capability 2 — Ownership: widgets move to their organs

**Principle: a widget belongs to the tool that owns the data.** The dashboard
core keeps only domain-blind widgets and infrastructure. `typeId`s never
change when a widget moves — persisted instances must survive re-homing
untouched.

### Re-homed (registration moves to the owning tool, same typeId)

| Widget | New owner | Notes |
|---|---|---|
| Recent files | explorer built-in | already file-system semantics |
| Autonomy activity | chat/autonomy built-in | it renders autonomy-log data |
| News brief | web-research extension | it is a search/fetch consumer; also becomes the reference for *external* AI-widget contribution |

Clock/links, notes, tasks, countdown, image, video, weather, market, custom
AI, and Live stay dashboard-core (domain-blind or AI infrastructure).

### New organ-owned widgets (each ships complete: config UI, picker entry, click-through)

- **Planner → Agenda widget.** Today/this-week tasks and events from
  `PlannerDataService.listTasks/listEvents` (Google-synced data included).
  Interactive: complete a task inline; click an event → opens the planner at
  that item. Instantiations: a study schedule; medication and bill-due dates.
- **Planner → the Tasks widget learns a source switch.** `source: 'self'`
  (today's private checklist, unchanged default) or `source: 'planner'`
  (a saved planner task query, two-way). One widget, both worlds — no
  breaking change to existing instances.
- **Canvas → Page embed widget.** Renders a chosen canvas page read-only
  (reuse the TipTap render path in read-only mode; no second renderer).
  Click → opens the page in the editor. Instantiations: a notes index page;
  a home-inventory page.
- **Canvas → Database view widget.** Renders a canvas database as a compact
  table with the database's own view config. Click-through to the database
  page. Instantiations: a flashcard/coverage database; a warranty registry.
- **Budget (external) → one widget of the extension author's choice**
  (e.g. month-to-date spend). Its real purpose: prove C1 end-to-end from an
  `ext/` extension and serve as the documented example.

### Acceptance

- Existing dashboards (persisted instances of re-homed types) load unchanged.
- Each new widget demonstrably answers a click with navigation into its organ.

## Capability 3 — The generic core slate

Domain-blind widgets the dashboard itself owns. Every one must document two
unrelated instantiations in its description (the dual-instantiation test).

- **Tracker board.** User-defined items × user-defined stages; each item may
  link to a page, file, or URL; renders as a status board/heat strip with
  counts; click-through on items. Instantiations: syllabus topics
  (unread→notes→practiced→mastered); insurance policies (active→renewal
  due→renewed).
- **Table/chart widget over data sources.** One widget, pluggable sources:
  a canvas database, or a spreadsheet/CSV file in the workspace (**first real
  consumer of the `xlsx` dependency, which is in package.json and imported
  nowhere today**). Column picker, table or bar/line render, refresh on
  interval or file change. Instantiations: practice-exam scores; net-worth
  by month. (Chart rendering follows the same sandboxed-HTML path the Live
  widget uses — no new chart library in the app DOM.)
- **Saved-query widget.** A pinned question over the workspace. Two modes:
  *retrieval* (top-k passages via the existing hybrid retrieval rail, no LLM,
  instant and free) and *AI* (existing custom-AI path). Instantiations:
  "who do I call for plumbing" over closing documents; "what expires in the
  next 30 days" over policy files. This is the water-leak loop, made
  persistent.
- **Timer widget.** Interval timer with named presets (pomodoro is a preset,
  not a feature) whose completed sessions append to a queryable log
  (`cached_output`-backed, same as tasks) — so the table/chart widget can
  chart it. Instantiations: study sessions; billable client time.
- **Template gallery.** The picker gains a "Templates" rail: preconfigured
  widget recipes (type + config + prompt + optional skill file it writes to
  `.parallx/skills/`). Ships with a starter set spanning *different life
  domains* (agenda + tracker + saved-query + AI brief). Creativity here is a
  discoverability problem; the gallery is the multiplier.

## Capability 4 — Orchestration: the refresh rail

**Problem.** AI-category widgets refresh by hijacking the visible chat
session (`chat.submitPrompt` reveals the panel and streams into the user's
active session), serialized at `MAX_CONCURRENT_AI_REFRESHES = 1`, and only
per-widget — the user refreshes each one by hand.

**Design: background agent turns on the existing ephemeral-session rail.**
The heartbeat and cron executors already run isolated headless LLM turns via
`chatService.createEphemeralSession(parentId, seed)` → `sendRequest` →
`purgeEphemeralSession`, with permission scoping. AI widget refresh becomes
the third consumer of that rail:

- A new `DashboardAgentRefreshExecutor` seeds an ephemeral session per AI
  widget refresh: widget prompt + skill + the `dashboard_render_widget`
  delivery contract + workspace context. No panel reveal; the user's chat
  session is never touched. Output lands exactly as today (same tool, same
  cache write, same status dots).
- **Refresh-all.** A page-level "Refresh" action (and command palette entry)
  enumerates the page's widgets: query/static widgets run in parallel as
  today; AI widgets fan out to an agent pool. `MAX_CONCURRENT_AI_REFRESHES`
  stops being a hardcoded 1 — it becomes a settings-registry entry
  (default conservative, e.g. 2) since it now governs background agents, not
  the user's chat.
- **Page-level schedule.** A dashboard page gains an optional refresh policy
  of its own ("weekdays 7:00") that triggers refresh-all — the morning
  dashboard that's already current when you sit down. Per-widget policies
  still work and win when tighter.
- **Governance.** Per-run caps (max widgets per run, per-turn timeout from
  `DASHBOARD_LIMITS`), failure isolation (one widget's error never aborts
  the run), and every agent-refresh logged to the autonomy log with the
  widget instance as origin — the existing autonomy-activity widget then
  shows dashboard refreshes for free. Cloud-model use follows the existing
  per-workspace `ai.allowCloudModels` gate; nothing about this rail widens
  model access.
- **Escape hatch.** A per-widget "Run in chat" action keeps the old visible
  path for debugging a prompt — explicit, never the default.

### Acceptance

- Five AI widgets on a page; one click refreshes all; chat panel never
  opens; widgets go `running → ok` independently; autonomy log shows five
  origin-tagged turns.
- Scheduler honors the concurrency setting and the per-refresh timeout;
  killing one agent turn mid-run does not affect the others.

## Capability 5 — System coherence

- All new knobs (AI refresh concurrency, page schedules, template gallery
  visibility) go through the settings schema registry — no code defaults
  masquerading as settings.
- `USER_GUIDE.md` dashboard section rewritten around the three contracts;
  extension-authoring doc gains the widget section (C1).
- Tests: unit coverage for the bridge validation, re-homing id stability,
  refresh-all fan-out (scheduler-level, no LLM), and the xlsx source parser.
  E2E specs for picker/gallery and refresh-all are written but gated (no
  visible app launches during authoring sessions; run explicitly).

---

## Build order

1. **C1 bridge + C2 re-homing** — the contribution door first; re-homing
   proves id stability; budget widget proves the external path.
2. **C4 refresh rail** — highest felt impact on daily use; independent of C3.
3. **C3 generic slate + gallery** — each widget lands complete, one PR each.
4. **C5 docs/settings** — continuous, closes with the milestone.

## Falsifiable outcomes

- An extension author (human or AI) can add a working widget to a dashboard
  without touching `src/built-in/dashboard/` — measured by the budget widget
  diff being confined to `ext/budget/`.
- A dashboard with N AI widgets refreshes with 1 user action and 0 chat-panel
  interruptions.
- The same tracker-board widget type, configured twice, runs a study
  coverage board and an insurance-renewal board with zero code difference.
