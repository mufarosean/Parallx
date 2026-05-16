# Milestone 71 — Configurable Dashboard (Home)

> **Status:** Planning.

## Why

Every Parallx workspace accumulates activity across canvas pages, budget
transactions, AI sessions, file changes, and web research — but there is no
single place where a user can see the state of everything at once. Users either
navigate to individual views or rely on the AI to tell them what is happening.

The goal is a configurable home screen that gives a live snapshot of the
workspace: not a static link list (Notion's limitation) but a grid of cells
where each one is backed by a real process — a cron job, an autonomous agent
trigger, or a manual refresh — so the dashboard stays current without the user
doing anything.

## Architecture decision: canvas page, not a new editor type

The dashboard lives as a **canvas page with a special block type**
(`dashboard-cell`), not a dedicated `dashboard.editor`.

Rationale:
- Users already know how to navigate the canvas page tree
- The dashboard appears in recent pages, can be pinned, and can link to other pages
- It inherits canvas page sharing, archiving, and search for free
- A separate editor type adds friction for something that should feel like home

A workspace gets one default dashboard page, created automatically on first use
(see M72 — no init command required). The user can rename it, move it in the
tree, or create additional dashboard pages.

## Cell model

Each `dashboard-cell` block has a configuration object:

```typescript
interface DashboardCell {
  id: string;
  type: CellType;
  title?: string;
  config: Record<string, unknown>;     // type-specific config
  refreshPolicy: RefreshPolicy;
  cachedOutput: string | null;          // last rendered markdown
  cachedAt: number | null;             // unix ms
  status: 'ok' | 'error' | 'running' | 'stale';
  errorMessage?: string;
}

type CellType =
  | 'recent-files'
  | 'budget-summary'
  | 'workspace-activity'
  | 'research-digest'
  | 'quick-links'
  | 'custom-ai-query';

type RefreshPolicy =
  | { kind: 'manual' }
  | { kind: 'cron'; interval: string }        // cron expression
  | { kind: 'autonomous'; trigger: string };  // event name
```

The dashboard reads from `cachedOutput` — it never waits for execution. The cell
runner writes to the cache asynchronously.

## Cell types

### Built-in cells (no AI required)

| Cell | Data source | Default refresh | Notes |
|---|---|---|---|
| `recent-files` | Filesystem watcher events | Autonomous: on file change | Top 10 recently modified files with type icons |
| `quick-links` | User-configured list | Manual | Static links to canvas pages, views, or commands |

### AI-backed cells

| Cell | Data source | Default refresh | Notes |
|---|---|---|---|
| `budget-summary` | Budget SQLite DB | Cron every 30min | AI summarises last 7 days of transactions in 3–5 bullet points |
| `workspace-activity` | Canvas edits + session history | Cron hourly | AI writes a short paragraph: "this week you worked on…" |
| `research-digest` | Web research history file | Cron daily | AI summarises new research findings since last digest |
| `custom-ai-query` | User-written prompt | Any policy | User provides a prompt; AI runs it and renders the output |

### Custom AI query cell

The most powerful cell type. The user writes a prompt such as:

> "Summarise any budget transactions over $200 from the last 14 days and flag
> anything unusual."

The cell runner executes this against the available workspace context on the
configured schedule. This is essentially a persistent background agent per cell,
reusing OpenClaw's heartbeat infrastructure.

**Deferred to M71.5:** Custom query cells ship in a follow-up once the cron
infrastructure from M71 core is validated. M71 ships the five built-in types.

## Process runner

Each AI-backed cell with a cron policy is a cron job registered with
`ICronService`. The job:

1. Gathers the cell's data source (DB query, file read, API call)
2. Sends a focused prompt to the configured model (not the chat model — a
   background call so it does not interrupt the user)
3. Writes the markdown result to the cell's `cachedOutput` in the workspace DB
4. Updates `cachedAt` and `status`
5. Fires a change event; the dashboard UI re-renders the cell

The runner never blocks the UI thread. Cells that fail set `status: 'error'` with
a message; the dashboard shows a retry button.

## Scope

**In scope for M71:**

- `dashboard-cell` block type in the canvas page system
- Dashboard page auto-creation on first workspace open
- Cell configuration UI (type picker, refresh policy, title)
- Cell runner service wired into `ICronService`
- Built-in cell types: `recent-files`, `budget-summary`, `workspace-activity`,
  `research-digest`, `quick-links`
- Manual refresh button on every cell
- `status` indicator (last run time, error state)
- Workspace DB schema for cell state

**Out of scope for M71:**

- `custom-ai-query` cell type (M71.5)
- Autonomous trigger policy (M71.5 — needs event taxonomy design)
- Dashboard sharing or export
- Cell drag-to-reorder (use existing canvas block ordering)
- Mobile / narrow viewport layout

## Existing pieces to build on

| Piece | Location |
|---|---|
| Canvas page block system | `src/built-in/canvas/` |
| Cron infrastructure | `src/openclaw/openclawCronService.ts`, `openclawCronExecutor.ts` |
| Budget DB | `ext/budget/main.js` — SQLite via `api.database` |
| Web research history | `ext/web-research/main.js` — `_appendHistoryLine` |
| Session/canvas history | `src/services/memoryService.ts`, `chatDataService.ts` |
| Workspace DB | `src/services/` — existing SQLite pattern |

## Success criteria

- Workspace opens to a dashboard page by default
- Budget summary cell shows last 7 days in < 5 bullet points, refreshes every 30 minutes without user interaction
- Recent files cell updates within 5 seconds of a file change
- A cell in `error` state shows a clear message and a retry button, does not crash the page
- Adding a new cell takes under 30 seconds of interaction
- Dashboard page is a normal canvas page — can be renamed, linked, archived
