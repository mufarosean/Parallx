# Parallx User Guide

A short, practical guide to running Parallx day to day. Read top-to-bottom
the first time; after that, jump to the section you need.

> **Audience:** end users opening Parallx for the first time, plus anyone
> coming back after a few weeks and wondering "wait, where was that
> setting again?".

---

## 1. Where settings live

Parallx has **one** place to change every setting: press `Ctrl+Alt+S`
(or open the chat panel and click the gear icon). That opens the
**Settings overlay** — a single, searchable list of every knob in the
app.

The overlay is grouped by **category** (Persona, Chat, Model, Retrieval,
Indexing, Suggestions, Agent, Tools, Integrations, Autonomy, Workspace).
Use the search box to jump straight to a setting by name.

### 1.1 User vs. workspace settings

Every setting is one of two scopes:

| Scope | Where it lives on disk | Survives across workspaces? |
|-------|------------------------|------------------------------|
| **User** | `<APP_ROOT>/data/global-storage.json` | Yes — applies everywhere |
| **Workspace** | `<workspace>/.parallx/workspace-state.json` | No — each workspace has its own value |

The overlay shows the scope next to each setting. If you want different
defaults for "personal notes" vs. "client project", use **two
workspaces** (see §4).

### 1.2 What's user-scoped

The short list:

- **Integrations** — OAuth client IDs / secrets that you only set up once
  on your machine. (Provider integrations now ship as MCP servers —
  e.g. `tools/gmail-mcp-server/` — which manage their own credentials
  outside the settings registry.)
- **Settings editor enabled** — internal kill switch.

Everything else (persona, model defaults, retrieval, indexing,
suggestions, autonomy, MCP servers, cron jobs, tool enablement) is
**workspace-scoped**. Open a new workspace → start fresh.

### 1.3 Action rows

Some entries in the overlay are **actions**, not values. They look like
buttons:

- **Manage tools…** → opens the tool tree
- **Manage MCP servers…** → opens the MCP catalog + custom-server form
- **Manage agents…** → per-agent config (model, max iterations,
  instructions)
- **Manage cron jobs…** → scheduled-job list
- **Export workspace config…** → save every workspace setting to a JSON file
- **Import workspace config…** → load a previously exported JSON file
- **Reset workspace settings…** → wipe every workspace setting back to
  default (asks for confirmation)

---

## 2. Enabling autonomy (heartbeat, cron, follow-up)

Autonomy is **off by default**. Three things have to be true for the
agent to run on its own:

1. The **global kill-switch** is not engaged (`autonomy.paused.global` =
   `false`, the default).
2. The specific feature is enabled.
3. The agent has at least one **surface** turned on so its output can
   land somewhere.

### 2.1 Heartbeat vs. Cron — which one do I want?

Both run the agent on its own. The difference is **what triggers them**:

| | **Heartbeat** | **Cron** |
|---|---|---|
| **Trigger** | File changes in the workspace (debounced) | A clock — fires at fixed times |
| **Cadence** | Reactive — only when you've been editing | Scheduled — fires whether or not you're working |
| **Configuration** | A single interval floor + coalesce window | A cron expression per job (e.g. `0 9 * * 1` = Mon 9 am) |
| **Number of jobs** | One global runner | Many independent jobs, each with its own prompt + schedule |
| **Use it for…** | "Watch what I'm doing and suggest things" — keep notes tidy, flag broken links, surface related material as you write | "Do this on a clock" — morning digest, weekly review, daily backup, end-of-day summary |
| **Don't use it for…** | Anything that needs a fixed time | Anything that should react to live edits |

Rule of thumb:

- If your prompt starts with **"every time I…"** → heartbeat.
- If your prompt starts with **"every Monday at…"** or **"once a day…"** → cron.
- You can run both at the same time. They don't conflict — they answer
  different questions.

### 2.2 Heartbeat (file-watcher → agent)

A periodic tick that runs the agent against recent file activity. The
heartbeat is **idle by default** — it only does work when there have
been file changes since the last tick. If nothing has changed, it
silently skips. The "interval" is really a *floor*: the agent will not
run more often than once per interval, even if you save furiously.

1. Open `Ctrl+Alt+S`.
2. Search "heartbeat".
3. Set **Autonomy → Heartbeat enabled** to `On`.
4. (Optional) Adjust **Heartbeat interval (ms)** — minimum 15 000 ms,
   default 60 000 ms.
5. Make sure at least one of **Autonomy → Surface … enabled** is `On`
   (e.g. Chat or Notification — that's where heartbeat output appears).

### 2.3 Cron (scheduled jobs)

Run an agent at a fixed schedule (cron expression). Each cron job has
its own prompt and runs independently of the others. Cron is **not**
idle-aware — if the schedule says fire, it fires, even if you haven't
touched the workspace.

1. Open `Ctrl+Alt+S`.
2. Search "cron".
3. Set **Autonomy → Cron enabled** to `On`.
4. Click **Manage cron jobs…** to add or edit jobs.

> Cron jobs are workspace-scoped — they live in
> `<workspace>/.parallx/workspace-state.json`. Migrating from M60 or
> earlier? The first time M61 launches in a workspace, your existing
> jobs in `<APP_ROOT>/data/cron.json` are **copied** (not moved) into
> the workspace file. The global file is left in place.

### 2.4 Follow-up

Lets the agent chain follow-up turns after a tool call.

1. Open `Ctrl+Alt+S`.
2. Search "followup".
3. Set **Autonomy → Followup enabled** to `On`.
4. (Optional) **Autonomy → Followup max depth** — default 5.

### 2.5 The kill switch

If anything feels wrong, search "paused" in the overlay and flip
**Autonomy → Paused (global)** to `On`. That stops every autonomous
runner immediately. No restart needed.

### 2.6 Where do I see what the agent did?

- **Chat panel** — heartbeat outputs appear here when the chat surface
  is enabled.
- **Notifications** — toasts appear when the notification surface is on.
- **Status bar** — compact tick indicator when the statusbar surface is
  on.
- **Event log** — `<workspace>/.parallx/logs/autonomy-events.<YYYY-MM-DD>.ndjson` (per-workspace; legacy global logs from before this change live under `<workspace>/.parallx/logs/legacy/`)
  records every autonomy event in newline-delimited JSON. Open in any
  text viewer.

---

## 3. Installing an MCP server

MCP (Model Context Protocol) servers are external tools the agent can
call. Parallx ships a small **catalog** of pre-vetted servers plus a
fallback for any other server you want.

### 3.1 From the catalog (≤ 5 clicks)

1. Open `Ctrl+Alt+S`.
2. Click **Manage MCP servers…**.
3. Pick a server from the catalog list.
4. Fill in any required fields. (Some servers handle their own OAuth
   in a one-time CLI bootstrap — e.g. `tools/gmail-mcp-server/` runs
   `node dist/index.js --auth` once before you register it here. See
   `docs/ai/GMAIL_MCP_INTEGRATION.md`.)
5. Click **Install**. The server entry is written to your workspace
   config; the client connects on the next chat turn.

### 3.2 Adding a custom server

In the same dialog, scroll to **Custom server** and provide:

- **Name** — any short identifier.
- **Command** — the executable (`npx`, `node`, `python`, etc.).
- **Args** — JSON array of arguments.
- **Env** — JSON object of env vars.
- **Transport** — `stdio` or `sse`.

Click **Add**. The entry lives in the same workspace file as catalog
servers.

### 3.3 Where credentials live

- **OAuth client IDs / secrets** → user-scoped, stored in
  `<APP_ROOT>/data/global-storage.json`. Never sent anywhere except to
  the upstream provider.
- **Per-server config** → workspace-scoped, in
  `<workspace>/.parallx/workspace-state.json`.

When you **export** a workspace config (action row in §1.3), secrets are
**stripped**. Importing a config never overwrites secrets — you re-enter
them once on each machine.

---

## 4. Workspaces *are* your profiles

Parallx does **not** have a "profiles" concept. Use **workspaces**
instead:

- Want a "research" persona and a "coding" persona? Open two different
  folders as Parallx workspaces. Each has its own `.parallx/`
  directory and its own settings.
- Want to share a config with a teammate? Use **Export workspace
  config…** → send them the JSON → they use **Import workspace
  config…**. (Secrets are excluded from the export.)
- Want to wipe and start over? **Reset workspace settings…** clears
  every workspace-scoped key back to its default.

There is no global "preferences sync" — Parallx is intentionally local-first.

---

## 5. Dashboards

A dashboard is the workspace's **glance-and-act layer**: widgets that show
live state from the app's organs (planner, canvas, files, AI) and click
through into them. Open one with `Ctrl+Shift+H` or **Dashboard: Open**.

- **Add widget** opens the picker. The **Templates** rail at the top adds
  fully-configured widgets in one click (pomodoro timer, tracker boards,
  saved queries, an AI daily brief, a pinned canvas page…).
- **Widgets come from tools.** The planner contributes agenda/tasks/calendar
  widgets, the canvas contributes the page-embed, extensions contribute
  their own (e.g. budget's month-to-date card, web-research's news brief).
  If you disable a tool, its widgets stay on the page as placeholders and
  come back live when you re-enable it.
- **AI widgets run in the background.** Refreshing an AI widget (or
  clicking **Refresh all**) launches isolated background agents — your chat
  panel is never touched. How many run at once is the
  `dashboard.aiRefreshConcurrency` setting (default 2). Every background
  run is logged in the Autonomy Log. Each AI widget also has a
  **Run in chat** button when you want to watch the turn stream (debugging
  a prompt).
- **Page schedules.** The clock button in the dashboard header schedules
  the whole page ("weekdays at 7:00") — it refreshes headlessly even while
  the page is closed, so it's already current when you open it.
- **Table/chart widget** reads any `.csv`/`.xlsx` in the workspace;
  **saved-query** keeps a standing question answered from your own files
  (retrieval mode is instant and AI-free).

---

## 6. Concept Lab (the stats-to-reserving ladder)

Concept Lab is a **bottom-up statistics curriculum that ends at the Exam 7
papers**, taught entirely through live, draggable pictures. It assumes no
statistics background: probability itself is defined on the first rung,
and every symbol and insurance term is introduced before it is used. Levels 1–6 are
concept modules — probability, random variables, processes, estimation,
Bayesian theory, GLMs — and level 7 applies it all on the papers' own
printed exhibits. Open it from the command palette (**Open Concept Lab**),
the activity-bar icon, or by asking the chat AI to show you a concept.

**The ladder** (the home view): seven numbered levels, climbable in order
or entered anywhere. Every module carries two link rails so you are never
stranded:

- **Builds On** — the concepts this module stands on, one click down.
- **Where The Exam Uses This** — the exam modules that need it, one click
  up. Concept cards on the home view also name what they feed.

The surface, left to right — read the step, look at the picture, reach
for the dials:

- **Story column** (left): every module opens on step 1 of a short
  guided walk. Click the dots or the arrows — each step animates the
  parameters to a configuration and explains what you're looking at.
  This is the intended way IN to a module.
- **Predict-then-reveal**: some story steps ask you to commit to an
  answer BEFORE the parameters move. Pick one; the step marks it, shows
  the right answer, explains, and then plays the reveal. Answers stick
  per module, so revisits don't re-ask.
- **Worked Examples** (right rail): preset chips that jump to the paper's
  printed cases. The note under the chips tells you what the case shows.
  The Builds On and Where The Exam Uses This links live at the bottom of
  the same rail.
- **Parameters**: sliders in the paper's own notation. The value readout
  and every chart update live as you drag.
- **Charts are draggable.** Most scenes accept direct manipulation:
  drag the query marker on a scatter, the weight dot along a curve, the
  position on a regime map, a truncation line, a posterior marker. If a
  dot looks grabbable, it is.
- **The Formula and Readouts** sit in the story column, directly under
  the step that explains them: the governing equation with the CURRENT
  values live beneath its symbols, then the derived numbers. One column
  answers "what am I looking at, what does it say, what do the numbers
  come to."
- **Hover to trace.** Hover any formula term in the story column, any
  readout in the rail, or any legend entry — the exact element it drives
  lights up and everything else dims. This is how the formulas and the
  pictures are welded together.
- **Pin Ghost** freezes the current curve as a faint dashed copy so you
  can change parameters and compare against where you were (up to three).
- **Simulation modules** (the bootstrap, the MCMC sampler, the validation
  machine) carry their own transport in the scene header: play/pause,
  step, replay.
- **Source chip** (top right): on exam modules, the paper, section, and
  pages every number on screen comes from; on concept modules, the level
  of the ladder you are standing on. Concept modules are still
  machine-checked — their tests pin mathematical identities and seeded
  simulations instead of printed exhibits.

**Let the AI drive.** In chat, ask things like *"show me the MSE valley
at Mack's Example 1"* or *"open the bootstrap"* — the agent has a
`conceptLab_open` tool that opens the right module with a preset or
specific parameter values already applied. This works mid-explanation,
so the instructor can put the picture on screen while it talks.

Your state survives: leaving a module and coming back restores your
slider positions, active preset, and pinned ghosts.

---

## 7. Troubleshooting

### Autonomy isn't firing

1. Check **Autonomy → Paused (global)** — should be `Off`.
2. Check the specific feature toggle (heartbeat / cron / followup).
3. Check at least one **surface** is enabled — without surfaces the
   runner has nowhere to deliver output and silently no-ops.
4. Open `<workspace>/.parallx/logs/autonomy-events.<today>.ndjson` and look for
   `{"event":"runner.skipped"…}` lines — they include the reason.

### MCP server won't connect

1. **Manage MCP servers…** → check the server status indicator.
2. For OAuth servers, re-run the auth flow from the per-server *Reauth*
   button.
3. For custom servers, run the command yourself in a terminal — most
   failures are missing executables (`npx not found`) or wrong arg JSON.
4. MCP logs: each server's stderr is forwarded to the Parallx dev
   console (View → Toggle Developer Tools → Console).

### Settings don't persist after restart

1. Confirm the workspace folder isn't read-only — Parallx writes to
   `<workspace>/.parallx/workspace-state.json` on every change.
2. Confirm `<APP_ROOT>/data/` is writable for user-scoped settings.
3. Check the dev console for `[settings] persist failed` warnings.

### Lost a setting? Can't find it?

The overlay is the single source of truth. If something exists in the
app but isn't in the overlay, that's a bug — file it against the
**M61** milestone.

---

## 8. Reference: keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Open settings | `Ctrl+Alt+S` |
| Toggle chat panel | `Ctrl+Shift+L` |
| Open command palette | `Ctrl+Shift+P` |

---

## 9. Where to next

- `docs/PARALLX_WORKSPACE_SCHEMA.md` — full schema of the workspace
  state file.
- `docs/archive/milestones/Parallx_Milestone_61.md` — design notes behind
  the unified settings system.
- `docs/ai/AI_USER_GUIDE.md` — deeper dive into the AI subsystem.
