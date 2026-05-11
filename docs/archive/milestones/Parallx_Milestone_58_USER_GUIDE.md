# M58 — What's Wired and How to Use It

**Plain-English reference for Milestone 58: "Wake Parallx"**
**Scope:** Everything on branch `milestone-58` through commit `9550a55`.
**Last updated:** M58 closure.

---

## TL;DR — the one-paragraph version

M58 wired **six autonomy runtimes** that were already built but sitting
unused: Followup (turn self-continuation), Heartbeat (timer/event-driven
pulse), Cron (scheduled jobs), Subagent (delegated isolated turns),
SurfaceRouter (multi-target output), and the deprecated loop-safety shim
removal. **Heartbeat and Cron ship "thin"** — they emit status/notification
surface deliveries but do not yet run real LLM turns (that lands in M59).
**Subagent ships "real"** — it actually runs isolated turns and returns
results to your chat. **Heartbeat is OFF by default**; you must opt in.
**All mutating actions (cron add/edit/remove, subagent spawn, filesystem
surface writes) are approval-gated** — nothing runs without you clicking
approve.

---

## Quick reference table

| Feature | How you access it | Default state | What you'll see |
|---|---|---|---|
| **Followup (self-continuation)** | Automatic, per-turn. Only fires when a tool returns `continuationRequested`. Max 5 chained turns. | Always on | Normal chat turn continues without you typing |
| **Heartbeat (proactive tick)** | AI Settings → **Heartbeat** section → toggle enabled | **OFF** | Status bar pulses `heartbeat` when active |
| **Cron (scheduled jobs)** | Ask agent in chat: *"Add a cron job that fires every 5 minutes"* → approve | Empty (no jobs) | Status bar + notification toast when job fires; visible in cron list |
| **Subagent spawn** | Ask agent: *"Spawn a subagent to research X"* → approve | Available on demand | Approval card in task rail; result card in parent chat |
| **Wake agent (manual)** | Command palette: `Parallx: Wake Agent` | Command registered | Heartbeat fires one tick with reason `wake` |
| **SurfaceRouter (multi-output)** | Automatic. Tools use `surface_send` / `surface_list` to target non-chat destinations | Always on | Status bar, notification toast, or filesystem depending on target |

---

## 1. Followup Runner (W1) — turn self-continuation

**What it is:** When a tool call signals "I need another turn to finish,"
the chat continues automatically. Hard-capped at 5 continuations per user
turn.

**How to use it:** Nothing to do. It activates when a built-in tool returns
`continuationRequested: true` in its result. Today the main consumer is
multi-step tool chains.

**How to tell it fired:** You'll see consecutive assistant turns without
having typed anything between them. Currently they render as generic
"Continue processing" user bubbles (logged LOW observation in UX report —
cosmetic improvement deferred to M59).

**Safety:** Depth-5 guard prevents runaway chains. The loop breaks
gracefully at depth 5 with a final assistant message.

---

## 2. Heartbeat Runner (W2) — proactive tick

**What it is:** A timer + event-driven pulse that wakes the agent on
interval, on file changes, on workspace changes, or on index completion.

**⚠ Ship-thin note:** In M58 the heartbeat **does NOT run a real LLM turn**.
It emits a status-bar pulse only. The full behavior (run an isolated turn
and act on the event) lands in M59 when the heartbeat executor is
retrofitted onto the W5 ephemeral-session substrate.

### How to enable it

1. Open **AI Settings** (chat participant settings panel).
2. Scroll to the **Heartbeat** section (between Agent and Tools).
3. Toggle **Enabled**.
4. Optionally adjust interval (30s / 5m / 30m / 1h).
5. Optionally narrow the allowed reasons list (default: all 5 —
   `interval`, `system-event`, `cron`, `wake`, `hook`).

### How to manually trigger one tick

- Command palette: **Parallx: Wake Agent** (`parallx.wakeAgent`)
- This calls `runner.wake('wake')` — fires one tick immediately.

### How to tell it's active

Look at the status bar. When heartbeat is enabled and ticking, you'll see
a subtle pulse labeled with origin `heartbeat`. No chat pollution — these
pulses never enter your chat transcript.

### Configuration keys (for power users)

In unified AI config:
- `heartbeat.enabled`: boolean, default `false`
- `heartbeat.intervalMs`: number, default `300000` (5 min), clamped 30s–1h
- `heartbeat.reasons[]`: allowlist, default all 5

### Known observation (non-blocking)

Because `unifiedConfigService.onDidChangeConfig` isn't scoped, any AI
settings edit restarts the heartbeat timer. Harmless but eager — M59 will
scope the listener.

---

## 3. Cron Service (W4) — scheduled jobs

**What it is:** Time-triggered job scheduler. 8 tool actions match upstream
OpenClaw exactly.

**⚠ Ship-thin note:** The executor that fires on schedule **does NOT run
the job's `agentTurn` payload as a real LLM turn in M58**. It fires a
status-flash + notification toast only. The `agentTurn` payload is
captured verbatim in the job record and will execute in M59 when the cron
executor is retrofitted onto the W5 substrate.

**What DOES work today:**
- Full scheduler: `every 5m`, `at 2026-04-22T15:00`, cron expressions
- Job storage (in memory — persistence deferred to M59)
- All 8 tool actions driven end-to-end
- Missed-job catchup on workspace open
- Wake modes `now` (fire inline) vs `next-heartbeat` (wait for tick)
- Approval gating on mutations

### How to use it

Ask the agent in chat. Examples:

- *"Show me the cron service status"* → `cron_status`
- *"List all scheduled cron jobs"* → `cron_list`
- *"Add a cron job that fires every 5 minutes and scans my inbox"* →
  `cron_add` (**approval required** — task rail will show a card)
- *"Update cron job X to fire every hour instead"* → `cron_update`
  (**approval required**)
- *"Remove cron job X"* → `cron_remove` (**approval required**)
- *"Run cron job X now"* → `cron_run`
- *"Show me the last 10 cron run results"* → `cron_runs`
- *"Wake cron jobs"* → `cron_wake`

### Tool permissions at a glance

| Action | Approval needed? |
|---|---|
| `cron_status`, `cron_list`, `cron_runs`, `cron_run`, `cron_wake` | ❌ Free |
| `cron_add`, `cron_update`, `cron_remove` | ✅ Always |

### How to tell a cron job fired

1. Status-bar flash with origin `cron`
2. Notification toast (briefly overlays — known minor concern O2)
3. New entry in `cron_runs` history
4. **No chat pollution** — fires never enter your transcript

### AI Settings visibility

A minimal **Cron** section in AI settings shows whether the service is
active. Full job-management UI deferred — today you drive it via chat.

---

## 4. Subagent Spawner (W5) — delegated isolated turns 🌟

**What it is:** The M58 keystone. Spawn a subagent in an **ephemeral
session** that runs a **real isolated LLM turn** with tools, captures its
final response, and returns it to your parent chat as a result card. The
ephemeral session is **invisible** — no entry in your session list, no row
in the `chat_sessions` table, no UI events.

**⚠ Always-approval:** `sessions_spawn` always requires approval. No
bypass, no read-only exemption.

### How to use it

Ask the agent. Example:

> "Spawn a subagent to research the upstream OpenClaw SurfaceRouter plugin
> design and summarize the key patterns."

The agent will call `sessions_spawn`. You'll see:

1. Approval card in the **task rail** — "Spawning subagent: 'research the
   upstream...'"
2. Click **Approve**.
3. The subagent runs in an ephemeral session (invisible).
4. When it finishes, its final response appears as a **subagent result
   card** in your parent chat (metadata flag `subagentResult = true`,
   origin `subagent`).

### Guarantees (five-layer isolation)

1. Ephemeral session ID prefix sentinel (`ephemeral-...`)
2. Session list excludes them
3. Persistence layer early-returns on ephemeral IDs (three code paths)
4. No `onDidCreate/DeleteSession` events emitted
5. `purgeEphemeralSession` always runs in `finally` — even on error

### Limits

- **Depth cap = 1.** A subagent cannot spawn another subagent. Both the
  tool handler and `SubagentSpawner` enforce this (belt-and-braces).
- **Timeout.** Subagents have a `runTimeoutSeconds` structural guard.
- **Tool allowlist** (`seed.toolsEnabled`, `tools[]`) is **captured but
  not yet enforced** — M59 item.

### How to tell a subagent is running

- Approval card in task rail before it starts
- No chat messages during execution (isolation)
- Result card appears in parent chat on completion
- Denial → clean error tool result, no ghost session anywhere

---

## 5. SurfaceRouter (W6) — multi-target output

**What it is:** A routing layer that lets tools and agents send content to
destinations other than chat: status bar, notification toast, filesystem,
and (stub) canvas.

**How you see it:** Implicitly — this is what makes heartbeat pulses hit
the status bar, cron fires hit notification toasts, and subagent result
cards land in your chat without transcripts leaking.

### Available surfaces

| Surface | Purpose | Status |
|---|---|---|
| `chat` | Default chat transcript | Active |
| `status` | Status bar pulses | Active |
| `notification` | Toast notifications | Active |
| `filesystem` | Write to workspace file | Active (approval-gated) |
| `canvas` | Write to canvas page | **Stub — permanent error in M58**, deferred to M59 |

### Tools

- **`surface_send`** — agent can route content to a specific surface
- **`surface_list`** — agent can enumerate available surfaces

### Feedback-loop safety

Every surface delivery is tagged with a **non-forgeable origin** (via
`SURFACE_ORIGIN_KEY = '_origin'`). Origins: `user`, `agent`, `heartbeat`,
`cron`, `subagent`. Event sources don't read router history, so it is
**proven impossible by construction** for a heartbeat pulse to trigger
itself via the router.

---

## 6. The commands you can type into the VS Code command palette

Today M58 exposes exactly one workbench command:

- **`Parallx: Wake Agent`** (`parallx.wakeAgent`) — fires `runner.wake('wake')`
  on the heartbeat runner. Useful to confirm the runner is alive and see a
  status-bar pulse on demand.

Everything else is driven through **chat tool calls** (the agent invokes
the tools; you approve or they run free per the policy table).

---

## 7. What's intentionally NOT in M58 (so you don't look for it)

Per the §6.5 ship-thin decision, documented in
[Parallx_Milestone_58.md](./Parallx_Milestone_58.md#65-deferred-the-isolated-turn-substrate-ship-thin-decision):

| Missing | Why | When |
|---|---|---|
| Heartbeat runs a real LLM turn on ticks | No isolated-turn substrate to route through — W5's substrate is new | M59 executor retrofit |
| Cron `agentTurn` payload actually executes | Same — ship thin until substrate retrofit lands | M59 executor retrofit |
| Cron jobs survive restart (persistence) | Scoped out — in-memory only for M58 | M59 |
| Subagent `tools[]` allowlist enforced | Captured, not filtered | M59 |
| Shared tool-loop depth counter across parent + subagent | Currently per-turn | M59 |
| Canvas surface writes | No canvas write API in M58 | M59+ |
| Cron job-management UI (add/edit/remove from settings) | Driven via chat today | M59 |
| Followup turns render as dedicated "continuation" bubbles | Cosmetic; logged in W1 UX pass | M59 |

None of these are bugs. They're intentional scope boundaries.

---

## 8. What you'd do to "try everything" in 5 minutes

1. **Open command palette** → run **Parallx: Wake Agent** → see status
   bar flash `heartbeat` origin. ✅ Heartbeat alive.
2. **Open AI Settings → Heartbeat section** → toggle Enabled → set
   interval to 30s → watch status bar pulse every 30s. ✅ Timer works.
3. **In chat**, ask: *"Show me cron status and list any jobs."* → agent
   calls `cron_status` and `cron_list` (both free) → see scheduler active
   with 0 jobs. ✅ Cron alive.
4. **In chat**, ask: *"Add a cron job that fires every minute with the
   payload 'ping'."* → approval card appears in task rail → approve →
   within ~60s see status-bar pulse + notification toast → ask *"Show
   me cron runs"* → see run history. ✅ Cron fires (thin).
5. **In chat**, ask: *"Spawn a subagent to count the number of TypeScript
   files in src/services."* → approval card appears → approve → wait for
   subagent result card in your chat. ✅ Subagent runs real isolated
   turn, result captured, zero session pollution.
6. **Open the chat session list** → confirm there is NO ephemeral session
   visible despite the subagent having just run. ✅ Isolation works.
7. **Toggle heartbeat off** → status bar stops pulsing → ✅ clean
   shutdown.

If all 7 work, M58 is fully operational on your machine.

---

## 9. Where to look when something feels off

| Symptom | First place to check |
|---|---|
| Heartbeat not pulsing | AI Settings → Heartbeat → Enabled? Interval reasonable? |
| Cron job added but never fires | `cron_runs` history; schedule type (`every` vs `at` vs cron expr); workspace was actually open at fire time |
| Subagent never returns | `runTimeoutSeconds` — it may have timed out; check task rail for error |
| Approval never prompts | Tool policy — read the permission table above; only mutations prompt |
| Ghost session in list after subagent | This is a bug. Report immediately — the five-layer isolation should prevent it |
| Status bar flashing unexpectedly | Origin tag in the delivery tells you whether it's `heartbeat`, `cron`, `subagent`, `agent`, or `user` |

---

## 10. Relationship to M59 (what's next)

M59's primary deliverable is the **executor retrofit**:

1. `HeartbeatTurnExecutor` — swap thin body for real isolated-turn call
   via W5 substrate
2. `CronTurnExecutor` — same swap; `payload.agentTurn` finally executes
3. Cron persistence to SQLite (jobs survive restart)
4. Subagent `tools[]` allowlist enforcement
5. Shared depth counter across parent + subagent
6. Cosmetic polish (followup bubble labels, cron job-management UI)

After M59 closes, M58's success signal — *"an isolated agent turn that
didn't require a user message ran to completion"* — is fully met for all
three autonomy surfaces (heartbeat, cron, subagent).

Today after M58, that signal is met **for subagent only**. Heartbeat and
cron prove everything around the turn; M59 lights the turn itself.

---

## Index of deeper reading

- [Parallx_Milestone_58.md](./Parallx_Milestone_58.md) — full plan
- [Parallx_Milestone_58.md §6.5](./Parallx_Milestone_58.md) — ship-thin decision
- `docs/ai/openclaw/W1_FOLLOWUP_WIRING_*.md` — W1 tracker/audit/gap-map trio
- `docs/ai/openclaw/W2_HEARTBEAT_WIRING_*.md` — W2
- `docs/ai/openclaw/W4_CRON_WIRING_*.md` — W4
- `docs/ai/openclaw/W5_SUBAGENT_WIRING_*.md` — W5
- `docs/ai/openclaw/W6_SURFACEROUTER_WIRING_*.md` — W6
- `docs/ai/openclaw/M58_UX_GUARDIAN_REPORT.md` — final UX pass (GREEN)
