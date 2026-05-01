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
  on your machine (e.g. Gmail).
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
- **Event log** — `<APP_ROOT>/data/autonomy-events.<YYYY-MM-DD>.ndjson`
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
4. Fill in any required fields (e.g. Gmail asks for an OAuth client ID
   + client secret — both come from
   [console.cloud.google.com](https://console.cloud.google.com) →
   *APIs & Services → Credentials → OAuth client → Desktop app*).
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

## 5. Troubleshooting

### Autonomy isn't firing

1. Check **Autonomy → Paused (global)** — should be `Off`.
2. Check the specific feature toggle (heartbeat / cron / followup).
3. Check at least one **surface** is enabled — without surfaces the
   runner has nowhere to deliver output and silently no-ops.
4. Open `<APP_ROOT>/data/autonomy-events.<today>.ndjson` and look for
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

## 6. Reference: keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Open settings | `Ctrl+Alt+S` |
| Toggle chat panel | `Ctrl+Shift+L` |
| Open command palette | `Ctrl+Shift+P` |

---

## 7. Where to next

- `docs/PARALLX_WORKSPACE_SCHEMA.md` — full schema of the workspace
  state file.
- `docs/Parallx_Milestone_61.md` — design notes behind the unified
  settings system.
- `docs/ai/AI_USER_GUIDE.md` — deeper dive into the AI subsystem.
