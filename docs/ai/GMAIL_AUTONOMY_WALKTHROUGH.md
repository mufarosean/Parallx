# Gmail Autonomy Walkthrough

**How to connect Parallx to your Gmail, have it check mail on a schedule (or on command), and deliver summarized reports — using only the surfaces that exist in the current build (post-M58-real post-ship UX reshape).**

This guide is task-oriented. It walks one concrete scenario end-to-end:

> *"Every weekday at 8am, and whenever I ask, read my Gmail inbox, summarize the new messages, prioritize them, and have the report ready for me to read."*

All capabilities used below are already shipped: MCP servers (D1), the cron scheduler (W4), the heartbeat runner (W2), isolated real turns (M58-real), the surface router (W6), and the dedicated **Autonomy Log** (M58-real post-ship UX reshape). No workarounds; no hidden flags.

---

## 1. Mental model

Parallx autonomy is four coordinated pieces:

| Piece | What it does | Where it lives |
|---|---|---|
| **MCP server** | Gives the agent tools to talk to external systems (Gmail, Slack, databases, etc.) | `AI Settings → MCP Servers` |
| **Cron scheduler** | Fires autonomous agent turns at a wall-clock schedule | `AI Settings → Scheduled jobs` (the agent manages jobs via `cron_add` / `cron_list` / `cron_remove`) |
| **Autonomy Log** | Dedicated in-memory log where every autonomous result lands, tagged by origin (`heartbeat`, `cron`, `subagent`). Your chat transcript stays clean. | `AI Settings → Autonomy Log` |
| **`autonomy_log` tool** | Lets the agent read the log back between turns, so it can tell you what ran while you were away | Built-in, always-allowed |

The flow for our Gmail scenario:

```
┌──────────────┐  tools   ┌──────────────┐   result   ┌──────────────┐
│  Gmail MCP   │ ───────> │  Cron-fired  │ ─────────> │ Autonomy Log │
│  server      │ <─OAuth  │  agent turn  │            │  (dedicated) │
└──────────────┘          └──────────────┘            └──────┬───────┘
       ▲                          ▲                         │
       │                          │                         │ autonomy_log tool
  AI Settings                cron_add tool                  │
  → MCP Servers             (agent proposes,                ▼
                             you approve)             ┌──────────────┐
                                                      │  Your chat   │
                                                      │  (when you   │
                                                      │   ask about  │
                                                      │   it)        │
                                                      └──────────────┘
```

The key shift from earlier revisions: **autonomous results do not auto-post into your chat.** They land in the Autonomy Log. The agent can read them with the `autonomy_log` tool when you ask "what happened?" — or you open the log directly in AI Settings.

---

## 2. Step 1 — Add a Gmail MCP server

Parallx consumes any server that speaks the Model Context Protocol. Several open-source Gmail MCP servers exist (`gmail-mcp`, `@modelcontextprotocol/server-gmail`, etc.). Pick one that fits your OAuth comfort level — Parallx doesn't care which.

1. Install the server per its own README. A typical `stdio`-transport server looks like:
   ```bash
   npm install -g some-gmail-mcp-server
   # run its OAuth bootstrap once to store credentials on disk
   some-gmail-mcp-server --auth
   ```
2. Open Parallx → **AI Settings** (gear icon in the chat title bar) → **MCP Servers** section.
3. Click **+ Add Server**. Fill in:
   - **Name**: `gmail`
   - **Transport**: `stdio`
   - **Command**: `some-gmail-mcp-server`
   - **Args**: whatever the server's docs call for (e.g. `--inbox-only`)
   - **Env**: any required API keys (stored locally, never round-tripped through chat)
   - **Enabled**: ✓
4. Save. The status dot should go `Connecting… → Connected` within a few seconds. If it goes `Error`, hover the dot to see the diagnostic — usually it's the OAuth token not being bootstrapped yet.

Once connected, Parallx auto-discovers the tools the server exposes. For a typical Gmail MCP server that's something like:

- `gmail_list_messages(query, max_results)`
- `gmail_get_message(id)`
- `gmail_search(query)`
- `gmail_mark_read(id)`
- `gmail_send(to, subject, body)`

These appear in the agent's tool catalog automatically. You can verify with the `/tools` slash command in chat or by opening **AI Settings → Tools**.

**Safety default:** all MCP tools land with their upstream approval posture. Destructive ones (`gmail_send`, `gmail_mark_read`) will ask before running. Read-only ones (`gmail_list_messages`, `gmail_get_message`) run without prompting. You can override per-tool in **AI Settings → Tools**.

---

## 3. Step 2 — Run it once on command

Before automating, prove the path works.

In any chat, type:

> Read my Gmail inbox for unread messages from today, summarize them, and rank them high / medium / low priority. Use the `gmail` MCP tools.

The agent will:
1. Call `gmail_list_messages({ query: "is:unread newer_than:1d", max_results: 50 })`.
2. Call `gmail_get_message(id)` per hit (batched).
3. Produce a markdown report.
4. Post it as a normal assistant reply in your current chat.

This is a *foreground* turn — you asked, so the reply goes to the transcript like any other answer. The Autonomy Log is only for results produced *without* you being on turn.

If this works, autonomy is just "do the same thing on a schedule / on an event."

---

## 4. Step 3 — Have the agent schedule it for you

The cron scheduler in Parallx is not configured by hand. The agent schedules jobs for itself, in plain language, and you approve the `cron_add` tool call. This matches how you'd hand a task to a human assistant — you tell them *what* and *when*, not how.

In chat, say:

> Every weekday at 8am, do the Gmail inbox summary we just ran, and also let me kick it off with "morning mail" on demand. Schedule it.

The agent will propose a `cron_add` tool call with something close to:

```json
{
  "name": "morning-mail",
  "schedule": { "cron": "0 8 * * 1-5" },
  "wakeMode": "now",
  "contextMessages": 0,
  "description": "Summarize unread Gmail from the last day, prioritize",
  "payload": {
    "agentTurn": "Read my Gmail inbox for unread messages from the last 24 hours. Summarize each, group them by priority (high/medium/low), and post a single report. Use the gmail MCP tools."
  }
}
```

Click **Approve**. Parallx's scheduler now owns that job. You can confirm at any time:

- **AI Settings → Scheduled jobs** — lists all jobs with next run time
- In chat: *"List my cron jobs"* — the agent calls `cron_list` (free, no approval) and shows them to you

---

## 5. Step 4 — What happens at 8am

At 08:00 on a weekday:

1. The **cron service** fires `morning-mail`. Because `wakeMode` is `"now"`, it runs immediately (the alternative, `"next-heartbeat"`, piggybacks on the next filesystem event).
2. The **cron executor** opens an **ephemeral session** — a scratch session that never appears in your chat list, never persists to disk, and cannot bleed into the parent transcript. This is the M58 isolation substrate.
3. The ephemeral session runs a real LLM turn using the `agentTurn` prompt from the job. The agent uses the `gmail` MCP tools exactly like it did when you ran it manually.
4. When the turn finishes, the ephemeral session is purged. Its last assistant message is routed through the **surface router** (origin-tagged `cron`, feedback-loop guard applied) to `SURFACE_CHAT`.
5. The **chat surface plugin** appends the result to the **Autonomy Log** — not to your chat transcript. The entry carries the origin (`cron`), the job label (`[cron · morning-mail]`), the full markdown report, and a timestamp.

When you next look, you'll see it in **AI Settings → Autonomy Log**:

> **[cron · morning-mail]**   *Mon 08:00:04*   🟣 unread
>
> **Morning mail — 12 unread since yesterday**
>
> **High priority (3)**
> - *Alex @ Acme*: Contract redline needs your reply by Thu. Short thread; Alex is flagging Section 4.2.
> - *Billing (Render)*: Card expiring this month. Action: update payment method.
> - *GitHub*: 2 failing CI runs on `parallx/main`.
>
> **Medium (5)** …
> **Low (4)** …

Your chat transcript is untouched. No bubble appeared, no notification popped into a conversation you were having with the agent.

To catch up from *within* chat, just ask:

> What did cron run while I was away?

The agent calls the built-in `autonomy_log` tool (always-allowed, no approval), reads the recent entries, and summarizes them inline in the current chat — quoting the report from the Autonomy Log back to you without dumping the raw card into the transcript.

---

## 6. Step 5 — On-demand: "morning mail" as a command

You already got this for free. Because the job prompt is plain English and the same tools are available to every turn, you can just type in chat:

> morning mail

The agent recognizes the phrase, runs the same summarization against Gmail live, and replies **in the chat** — because this is a foreground turn you initiated. Only *unprompted* autonomous results (cron firings, heartbeat reactions, subagent deliveries) go to the Autonomy Log.

If you want a hard slash command: ask the agent to register one. *("Make `/mail` run the morning mail summary.")* That uses the same mechanism as any Parallx slash command registration.

---

## 7. Step 6 — Event-driven variant (heartbeat)

Cron is for wall-clock time. **Heartbeat** is for *"something happened in the workspace that the agent should react to."* For Gmail, the obvious case: *"when I save a file named `TODO.md`, also pull my inbox and cross-reference."*

You don't configure heartbeat either — it's always running. You just tell the agent what to do when it fires:

> When I save TODO.md, pull any Gmail threads from the last hour whose subject or body mentions items in the TODO list, and append them as citations under each item.

The agent will schedule this as a heartbeat rule (approval-gated the same way cron jobs are). When you next save `TODO.md`, the heartbeat runner:
1. Collects the save event.
2. Runs its own ephemeral turn with the rule's prompt.
3. Appends the result to the Autonomy Log tagged `[heartbeat · file-saved]`.

30-second debounce applies (`${type}|${path}` key), so rapid saves don't flood you.

---

## 8. Step 7 — Managing, pausing, killing the job

All through chat:

| You say | Agent does | Approval? |
|---|---|---|
| *"List my cron jobs"* | `cron_list` | No |
| *"Show the last 5 runs of morning-mail"* | `cron_runs` | No |
| *"Run morning-mail right now"* | `cron_run` | No |
| *"What did autonomy do overnight?"* | `autonomy_log` | No |
| *"Pause morning-mail"* | `cron_update { enabled: false }` | **Yes** |
| *"Change morning-mail to 7am"* | `cron_update { schedule: { cron: "0 7 * * 1-5" } }` | **Yes** |
| *"Delete morning-mail"* | `cron_remove` | **Yes** |

Or use **AI Settings → Scheduled jobs** (for cron) and **AI Settings → Autonomy Log** (for results) for the same actions in a UI.

---

## 9. What *doesn't* work today (and the workaround)

- **Push notifications** — the Autonomy Log is a pull surface. You have to either open AI Settings → Autonomy Log or ask the agent what ran. If you want a ping, the cron prompt can end with `gmail_send(...)` to mail the report to yourself, or hit another MCP you have wired up (Slack, Discord, push notification service).
- **Persistence across restarts** — the Autonomy Log is in-memory with a 200-entry ring buffer. Quit Parallx and the log is gone. File-backed persistence is on the M53 roadmap. For durable archives today, end the cron prompt with a `fs_write` to a file in your workspace.
- **Webhook / email / Slack delivery** — cron can't push the report *out* of Parallx by itself. The agent's turn prompt ending with `gmail_send(...)` is the real workaround and it works today.
- **Conditional skipping** — cron doesn't have native "skip if no unread." The agent can do this itself in the prompt: *"If there are no unread messages from the last 24 hours, reply with exactly 'no mail.'"* — then a one-line log entry is your signal that it ran and had nothing to report.
- **Cross-session memory** — each cron run is a fresh ephemeral turn. It doesn't remember yesterday's summary on its own, *but* it can now read the last N Autonomy Log entries via the `autonomy_log` tool if you put that in the prompt: *"Before summarizing, read the last 3 morning-mail entries from the autonomy log and note which threads are carrying over."*

---

## 10. Trust, safety, and the kill switch

- Every MCP server is a separate process with its own credentials. Disable one in **AI Settings → MCP Servers** and the agent loses those tools the next turn — no restart.
- Every cron job is owned by you. The agent cannot schedule a job without your explicit approval of the `cron_add` tool call. Same for update / remove.
- Autonomous turns carry origin tags (`ORIGIN_CRON`, `ORIGIN_HEARTBEAT`, `ORIGIN_SUBAGENT`) through the surface router. That's the mechanism Parallx uses to prevent an autonomous card from triggering another autonomous turn — no infinite loops even if you accidentally write a rule that could cause one.
- Autonomy Log entries always identify themselves: `[cron · <name>]`, `[heartbeat · <reason>]`, `[subagent]`. The origin badge in the UI is color-coded so you can scan at a glance.
- Your chat is sacrosanct. Autonomous results never appear there uninvited. The only way an autonomous run shows up in your transcript is if you ask about it and the agent quotes the log back to you.
- Hard kill: close Parallx. Cron is in-process, not a system daemon. The Autonomy Log is in-memory and vanishes with the process.

---

## 11. One-screen cheat sheet

```
# Connect
AI Settings → MCP Servers → + Add Server
  name: gmail   transport: stdio
  command: <your gmail mcp server>   enabled: ✓

# Prove it works (foreground, lands in chat)
Chat: "read my unread gmail from today, summarize, prioritize"

# Schedule it (background, lands in Autonomy Log)
Chat: "every weekday at 8am do the gmail summary — schedule it"
  → approve the cron_add tool call

# Fire on demand
Chat: "morning mail"                ← foreground turn, goes to chat
   or: "run morning-mail now"       ← cron_run; result goes to Autonomy Log

# Catch up after the fact
AI Settings → Autonomy Log          ← read it directly
   or: "what did cron do overnight?"  ← agent reads via autonomy_log tool

# Manage cron
AI Settings → Scheduled jobs
   or: "list my cron jobs" / "pause morning-mail" / "delete morning-mail"

# React to events instead of time
Chat: "when I save TODO.md, cross-reference with gmail"
  → heartbeat rule, same approval flow, result in Autonomy Log
```

That's the whole system. Same path works for Slack, calendars, Jira, a home-assistant smart bulb, or anything else with an MCP server — the Gmail specifics above are just one worked example.
