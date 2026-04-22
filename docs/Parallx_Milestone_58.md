# Milestone 58 — Wake Parallx: Runtime Wiring of Autonomy Modules

**Date:** 2026-04-22
**Status:** Planning
**Branch:** `milestone-58` (from `master`)
**Theme:** Take the six built-but-unwired OpenClaw autonomy modules to runtime
parity with upstream so Parallx **wakes, acts on events, schedules itself,
delegates work, and routes output across surfaces** — not just responds to
chat turns.

---

## 1. Vision

A Parallx that feels alive.

Today the AI is purely reactive: it only runs when the user sends a chat
message. M46 built the mechanisms to change that — **self-continuation, timed
check-ins, cron, sub-agent spawning, and multi-surface output** — and
M41–M47 audited each one to full parity with upstream `openclaw/openclaw`.
But M46 defined "done" as `audited + tested + closed`, never
`wired into runtime`. The result: 6 modules, 187 tests, zero production
imports.

M58 is the closing milestone on that arc. When it lands:

- a turn can **continue itself** when a tool asks for continuation (Followup)
- a background **heartbeat** ticks on an interval and on real workspace events
  (file changes, indexing complete, cron fires) and decides whether to act
- the agent can schedule **reminders, timed reflections, recurring scans**
  via a cron tool and those jobs actually fire
- the agent can **spawn a sub-agent** on an isolated task and get its result
  back without polluting the active chat
- agent output can **write to non-chat surfaces** (canvas pages, files,
  notifications, status bar) through a single surface router
- autonomy remains **inspectable and controllable** — every autonomous turn
  flows through the existing task rail, approval service, and loop-safety
  hooks, not a parallel engine

The end state is *autonomy parity with upstream OpenClaw, adapted for
single-user desktop.*

---

## 2. Verified Pre-State (2026-04-22)

### 2.1 Dead modules — confirmed by grep

| # | Module | File | Lines | Tests | Production imports |
|---|--------|------|-------|-------|-------------------:|
| 1 | FollowupRunner | `src/openclaw/openclawFollowupRunner.ts` | ~250 | 21 | 0 |
| 2 | HeartbeatRunner | `src/openclaw/openclawHeartbeatRunner.ts` | ~380 | 22 | 0 |
| 3 | CronService | `src/openclaw/openclawCronService.ts` | ~600 | 77 | 0 |
| 4 | SubagentSpawner | `src/openclaw/openclawSubagentSpawn.ts` | ~450 | 34 | 0 |
| 5 | SurfacePlugin / SurfaceRouter | `src/openclaw/openclawSurfacePlugin.ts` | ~480 | 33 | 0 |
| 6 | ToolLoopSafety shim | `src/openclaw/openclawToolLoopSafety.ts` | 3 | 0 | 0 — canonical is `src/services/chatToolLoopSafety.ts` |

`grep "createFollowupRunner|HeartbeatRunner|CronService|SubagentSpawner|SurfaceRouter" src/` returns only
the declaration files themselves plus their tests. No `new`, no `import`,
no `require` anywhere else in `src/`.

### 2.2 What is already wired (must not be re-invented)

| Surface | Status | Source of truth |
|---------|--------|----------------|
| Runtime-owned tool loop, observer, approval | ✅ wired | `src/built-in/chat/utilities/chatGroundedExecutor.ts`, `src/services/languageModelToolsService.ts` |
| Chat task rail, approvals | ✅ wired | `src/services/agentSessionService.ts`, `src/services/agentApprovalService.ts`, `src/built-in/chat/widgets/chatWidget.ts` |
| Autonomy mirror (per-turn task creation, plan steps, approval bridging) | ✅ wired (2026-03-25) | `src/built-in/chat/utilities/chatTurnSynthesis.ts`, `chatTurnExecutionConfig.ts`, `chatDataService.ts` |
| Canonical loop safety | ✅ wired | `src/services/chatToolLoopSafety.ts` — used by grounded executor and default participant |
| Agent registry + agent definitions | ✅ wired | `src/openclaw/agents/openclawAgentRegistry.ts`, `openclawAgentConfig.ts` |
| OpenClaw default/workspace/canvas participants | ✅ wired | `src/openclaw/participants/*` |
| MCP client, tool policy, token budget, error classification, response validation, context engine | ✅ wired | `src/openclaw/*` (38 of 44 files active) |

**Implication:** M58 is narrow. The autonomy *engine* exists. The autonomy
*triggers*, *schedulers*, *delegators*, and *output routers* don't.

### 2.3 What is *not* yet wired that M58 needs as supporting substrate

| Need | Current state | M58 action |
|------|--------------|-----------|
| Heartbeat config keys in unified AI config | Absent | Add (core change, requires approval) |
| System-event bus (file-watcher → queue, indexer → queue) | Scattered emitters | Small unified pushEvent gateway |
| Isolated sub-session for subagent turns | Absent | Lightweight fork of session state in `chatSessionPersistence` (core change) |
| Cron tool + subagent tool + surface routing tool definitions | Absent | 10 new tool defs in dedicated tool files |
| Surface plugin concrete implementations | Absent | 5 plugins: chat, canvas, filesystem, notifications, status |
| Approval gate for subagent spawn | Absent | Extend `openclawToolPolicy.ts` |

---

## 3. Ground Rules

M58 uses the **parity agent workflow** (`.github/agents/Parity*.agent.md`) that
drove M41–M47. Every domain follows the 12-step audit → gap map → code →
verify → UX loop (see `docs/OPENCLAW_DEAD_CODE_AND_PARITY_AGENTS.md`).

### The 6 M41 principles apply without exception

| # | Principle |
|---|-----------|
| P1 | Framework, not fixes |
| P2 | OpenClaw is the blueprint |
| P3 | Study source, then build |
| P4 | Not installing OpenClaw — adapting for desktop |
| P5 | No deterministic solutions |
| P6 | Don't invent when upstream has a proven approach |

### The 7 anti-patterns are forbidden

Preservation bias · patch-thinking · output repair · pre-classification ·
eval-driven patchwork · wrapper framing · subtractive framing.

### Do-not-assume rule

Although each module is audit-closed at 100% capability coverage, the audits
were performed **months ago** against a commit `e635cedb` snapshot.
Before wiring, the Parity Auditor will **re-audit each module against the
current upstream head** and confirm the wiring contract is still accurate.
Drift since the baseline audit is treated as a first-class finding.

### Scope boundary

Parallx is single-user, single-instance, local-first desktop. The following
upstream surfaces are **explicitly out of scope** for M58 (same as the M46
audits):

- ACP / Gateway control plane
- Multi-session / thread-bound subagents
- Persistent JSONL run logs (stays in-memory)
- Remote / server announce delivery
- Multi-channel messaging (Telegram, Discord)

---

## 4. Domain Map

Ordered by dependency and effort. Each domain is an independent parity cycle
that must reach ALIGNED + tests + UX + commit before the next begins.

```
W0 (shim)              low     standalone
W1 Followup            low     depends on tool-continuation signal (already live)
W6 SurfacePlugin       med-hi  standalone — unblocks heartbeat status surface
W2 Heartbeat           med     depends on W6 (status surface), unified config, event bus
W4 Cron                med     depends on W2 (wake mode "next-heartbeat"), tool defs
W5 Subagent            high    depends on session isolation — hardest
```

Why this order:

- **W0 first** — trivial cleanup clears a red flag in the tree.
- **W1 next** — purely additive, wires a single post-turn hook, can land alone
  and immediately makes turns that say *"give me a moment, running follow-up"*
  actually do it.
- **W6 before W2** — the heartbeat needs a status-bar surface to show it's
  ticking; wiring surface first gives heartbeat somewhere to report to.
- **W2 before W4** — cron's `"next-heartbeat"` wake mode delegates to
  `heartbeatRunner.wake('cron')`. Without heartbeat, that mode is null.
- **W4 before W5** — cron is a narrower scheduler; subagent is full session
  isolation. Learn scheduling patterns first, then tackle isolation.
- **W5 last** — isolated session management is the only genuinely unsolved
  design problem. Prior domains reduce its risk by proving the substrate.

---

## 5. Domain Work Packages

Every package below has identical structure:
**Re-audit → Gap map → Wire → Tests → Verify → UX → Commit.**
Estimates are effort-relative, not time-bound.

---

### W0 — Delete deprecated `ToolLoopSafety` shim

**Effort:** trivial **Risk:** zero

| Task | File | Core change? |
|------|------|-------------|
| W0.1 | Delete `src/openclaw/openclawToolLoopSafety.ts` | No |
| W0.2 | Confirm zero importers (grep) | — |
| W0.3 | Run full test + type check | — |

**Done when:** file deleted, tree green, no imports broken.

---

### W1 — FollowupRunner: self-continuation

**Effort:** low **Risk:** low

**Capability:** A turn that sets `continuationRequested` on its result auto-queues
a followup turn (up to `MAX_FOLLOWUP_DEPTH = 5`, with `FOLLOWUP_DELAY_MS = 500`
between turns). Upstream parity: `followup-runner.ts:1-412`.

**Pre-wiring audit questions (Parity Auditor):**

- Has upstream changed the followup evaluation gates since `e635cedb`?
- Is `continuationRequested` still the correct signal, or has upstream moved
  to a structured `followup:{reason,message}` return?
- Is the 5-gate evaluation (steer-suppress, depth-cap, cancel, error,
  tool-continuation) still complete?

**Wiring tasks:**

| # | Task | File | Core change? |
|---|------|------|--------------|
| W1.1 | Instantiate `createFollowupRunner` inside the default participant once per session | `src/openclaw/participants/openclawDefaultParticipant.ts` | No |
| W1.2 | After `turnRunner` returns, call `evaluateFollowup(turnResult, depth)` | `openclawDefaultParticipant.ts` post-turn hook | No |
| W1.3 | If `shouldFollowup`, enqueue next turn via existing chat-service request API using `FollowupTurnSender` delegate | `openclawDefaultParticipant.ts` | No |
| W1.4 | Track `depth` in per-session `Map<sessionId, number>` — reset on new user turn | `openclawDefaultParticipant.ts` | No |
| W1.5 | Mirror followup turns into the autonomy task rail as continuation steps | `chatTurnSynthesis.ts` (already autonomy-aware) | No |
| W1.6 | Add integration test: tool-continuation signal → second turn runs → third turn gates at depth | `tests/unit/openclawDefaultParticipant.test.ts` extension | No |
| W1.7 | UX: followup turn is visually distinguishable in chat (existing "continuing…" style — verify), loops end cleanly | Chat widget review only | No |

**Done when:** a tool response carrying continuation-requested causes a
second turn to actually run, depth cap holds, steer suppression still fires.

---

### W6 — Multi-Surface Output: SurfaceRouter + 5 plugins

**Effort:** medium-high **Risk:** medium

**Capability:** A single `SurfaceRouter` the agent can target by `surfaceId`
to write content outside chat — canvas updates, file writes, notifications,
status-bar messages — with retry/backoff and permanent-error short-circuit.

**Pre-wiring audit questions:**

- Does upstream still use the `ChannelPlugin` shape for surface routing, or
  has it migrated?
- Is the `setup/config/security/messaging/outbound` plugin surface still
  stable?
- Are the five surface IDs (`chat`, `canvas`, `filesystem`, `notifications`,
  `status`) still the right partition, or has upstream added telemetry/log
  surfaces?

**Wiring tasks:**

| # | Task | File | Core change? |
|---|------|------|--------------|
| W6.1 | Instantiate `SurfaceRouter` as a singleton service under DI | `src/services/surfaceRouterService.ts` (new) | No (additive service) |
| W6.2 | Register it in `serviceTypes.ts` as `ISurfaceRouterService` | `src/services/serviceTypes.ts` | **YES** |
| W6.3 | Implement 5 plugins: | | |
| W6.3a | `ChatSurfacePlugin` → chat-service sendResponse | `src/built-in/chat/surfaces/chatSurface.ts` (new) | No |
| W6.3b | `CanvasSurfacePlugin` → `parallx.workspace.getCanvasPageTree` + write hooks (initially read-only / append-to-page) | `src/built-in/canvas/surfaces/canvasSurface.ts` (new) | No |
| W6.3c | `FilesystemSurfacePlugin` → workspace `fs.writeFile` | `src/services/surfaces/filesystemSurface.ts` (new) | No |
| W6.3d | `NotificationsSurfacePlugin` → workbench toast service | `src/workbench/surfaces/notificationSurface.ts` (new) | No |
| W6.3e | `StatusSurfacePlugin` → statusbar item (heartbeat tick here) | `src/workbench/surfaces/statusSurface.ts` (new) | No |
| W6.4 | Register plugins during `_initializeToolLifecycle` | `src/workbench/workbench.ts` | **YES** |
| W6.5 | Define surface-routing tool `surface_send` + `surface_list` | `src/built-in/chat/tools/surfaceTools.ts` (new) | No |
| W6.6 | Register tools + add conservative approval gate on `filesystem` / `canvas` surface writes | tool registry + `openclawToolPolicy.ts` | **YES** |
| W6.7 | Autonomy guard: a surface write must never re-trigger the heartbeat that authored it (feedback-loop break) | `SurfaceRouter` suppression window or surfaceId tag on heartbeat-origin deliveries | No |
| W6.8 | Tests: plugin registration, retry/backoff, feedback-loop break, approval gate | `tests/unit/surfaceRouter.test.ts` + 5 plugin tests | No |
| W6.9 | UX: status-bar item appears; notifications surface uses existing toast style; no surface writes happen without approval in default policy | UX Guardian pass | No |

**Done when:** agent can call `surface_send({surfaceId:'notifications',content:'hi'})` and a toast appears; feedback-loop guard proven; permanent errors short-circuit retries.

---

### W2 — HeartbeatRunner: proactive tick

**Effort:** medium **Risk:** medium

**Capability:** A timer-driven loop that, on interval and on real workspace
events, decides whether to run an isolated agent turn. Reasons: `interval`,
`system-event`, `cron`, `wake`, `hook`. Heartbeat turns do not pollute user
chat history.

**Pre-wiring audit questions:**

- Does upstream's `heartbeat-runner.ts:1-1200` still use the
  `setTimeout` chain pattern, or has it moved to a cooperative scheduler?
- Is input-level vs output-level dedup still the right desktop adaptation, or
  has upstream exposed a config knob?
- Are heartbeat turns still isolated from session history upstream?

**Wiring tasks:**

| # | Task | File | Core change? |
|---|------|------|--------------|
| W2.1 | Add unified AI config keys: `heartbeat.enabled` (default false), `heartbeat.intervalMs` (default 5 min), `heartbeat.reasons[]` (allowlist) | `src/aiSettings/unifiedConfigTypes.ts`, `unifiedAIConfigService.ts` | **YES** |
| W2.2 | Create `HeartbeatTurnExecutor` — **SHIP THIN** per §6.5. Emits origin-stamped status-surface delivery only. No LLM call, no tool loop. Remediated in M59. | `src/openclaw/openclawHeartbeatExecutor.ts` (new) | No |
| W2.3 | Instantiate `HeartbeatRunner` in workbench startup after chat service ready | `src/workbench/workbench.ts` Phase 5 | **YES** |
| W2.4 | Connect event sources to `pushEvent()` | | |
| W2.4a | File watcher (existing) → `pushEvent({kind:'file-change',path})` | `src/built-in/chat/main.ts` + file watcher bridge | **YES** |
| W2.4b | Indexer completion → `pushEvent({kind:'index-complete',stats})` | `src/services/indexingPipeline.ts` | **YES** |
| W2.4c | Workspace open/close → `pushEvent({kind:'workspace-change'})` | `src/workbench/workbench.ts` | **YES** |
| W2.5 | Wire `runner.wake('external')` into a workbench command `Parallx: Wake Agent` | `src/commands/` | No |
| W2.6 | Heartbeat reports tick to **StatusSurface** (W6 dependency) | Heartbeat executor → SurfaceRouter | No |
| W2.7 | Dispose on workbench teardown | `workbench.ts` | No |
| W2.8 | Tests: interval fires, event fires, dedup holds, disabled config stays silent, status surface updates | unit + autonomy e2e | No |
| W2.9 | UX: user can toggle heartbeat from AI settings; off by default; a subtle pulse in status bar when active | AI settings section + UX Guardian pass | No |

**Design decisions to confirm before W2.2:**

1. **Heartbeat visibility** — are heartbeat-initiated actions silent
   (background only), summarized in status bar, or posted to a dedicated
   "Agent activity" chat panel? Recommendation: status bar + explicit
   `SURFACE_CHAT` opt-in per heartbeat reason.
2. **Default off** — heartbeat ships disabled. User opts in via AI settings.
   This is a **non-negotiable** safety default.

**Done when:** with heartbeat enabled, a file change causes an isolated
status-surface delivery (origin-stamped `heartbeat`) that does not appear in
the active chat transcript; status bar shows the tick; toggle in AI settings
persists across reloads. **Note:** no real LLM turn fires yet — see §6.5.
M59 retrofits the executor to run isolated turns through the W5 substrate.

---

### W4 — CronService: time-triggered autonomy

**Effort:** medium **Risk:** medium (depends on W2)

**Capability:** Agent can schedule recurring or one-shot jobs via tool calls.
Jobs fire with or without heartbeat. 8 tool actions match upstream
`cron-tool.ts`.

**Pre-wiring audit questions:**

- Does upstream `cron-tool.ts:1-541` still expose the same 8 actions (`status`,
  `list`, `add`, `update`, `remove`, `run`, `runs`, `wake`)?
- Has the job schema gained or dropped fields since `e635cedb`?
- Is the "at / every / cron" triple-union still the right shape?

**Wiring tasks:**

| # | Task | File | Core change? |
|---|------|------|--------------|
| W4.1 | Create `CronTurnExecutor` — **SHIP THIN** per §6.5. Emits origin-stamped status/notification surface delivery only. No LLM call, no tool loop. `payload.agentTurn` is captured but not executed until M59 substrate lands. | `src/openclaw/openclawCronExecutor.ts` (new) | No |
| W4.2 | Create `ContextLineFetcher` — pulls last N messages from session via `chatSessionPersistence` | `openclawCronExecutor.ts` | No |
| W4.3 | Create `HeartbeatWaker` adapter that calls `heartbeatRunner.wake('cron')` | `openclawCronExecutor.ts` | No |
| W4.4 | Instantiate `CronService` in workbench Phase 5, call `.start()`, add to disposables, schedule `runMissedJobs()` | `workbench.ts` | **YES** |
| W4.5 | Define 8 tool definitions in `src/built-in/chat/tools/cronTools.ts` (new): `cron_status`, `cron_list`, `cron_add`, `cron_update`, `cron_remove`, `cron_run`, `cron_runs`, `cron_wake` | new file | No |
| W4.6 | Register cron tools in `builtInTools.ts` | `src/built-in/chat/tools/builtInTools.ts` | **YES** |
| W4.7 | Tool policy: `cron_add/update/remove` require approval in default policy, read-only actions free | `src/openclaw/openclawToolPolicy.ts` | **YES** |
| W4.8 | Persistence **deferred** — jobs live in memory this milestone; note in milestone M59 backlog | — | — |
| W4.9 | Tests: all 8 actions, wake-mode `now` vs `next-heartbeat`, missed-job catchup, tool-approval gating | unit + approval tests | No |
| W4.10 | UX: user sees scheduled jobs via `/cron` chat command or AI settings panel; can kill/edit from UI | New small AI-settings subsection | No |

**Done when:** `cron add --every 5m --agentTurn "scan inbox"` creates a job
that fires every 5 minutes, the fire is observable via status/notification
surface and shows up in `cron_runs`; `cron list` shows it; `cron_add` is
gated by approval. **Note:** `agentTurn` payload is captured and persisted
in the job record but not yet executed as a real turn — that wires in M59
per §6.5. Thin executor proves scheduler, storage, events, tool surface,
and approval gating are sound.

---

### W5 — SubagentSpawner: delegated work

**Effort:** high **Risk:** high

**Capability:** Parent agent calls `sessions_spawn` with a task description;
a child turn runs in an **isolated session** (different message list,
different tool state, bounded timeout, bounded depth), returns its final
response, and that response is posted back to the parent chat as a quoted
sub-agent result.

**This is the only genuinely unsolved substrate work in M58.**

**Pre-wiring audit questions:**

- Does upstream `subagent-spawn.ts:1-847` still use `"run"` vs `"session"`
  modes? (Parallx only implements `"run"`.)
- Has depth tracking moved from `callerDepth` param to runtime-injected
  ambient?
- Is the `announce` step still a post-completion callback, or has upstream
  moved to a streaming sub-channel?

**Substrate tasks (these are the unknowns — break out as sub-domain W5-A):**

| # | Task | File | Core change? |
|---|------|------|--------------|
| W5-A.1 | Design a session fork: `chatSessionPersistence.createEphemeralSession(parentId, seed)` returning a sessionId that participates in tool loop + loop-safety but is purged after capture | `src/services/chatSessionPersistence.ts`, `chatDataService.ts` | **YES** (substantive) |
| W5-A.2 | Ensure ephemeral sessions do not appear in session-list queries (restoreSessions, autonomy task rail) | session persistence filter | **YES** |
| W5-A.3 | Verify token budget + context engine handle isolated sessions without cross-contamination | `openclawTokenBudget.ts`, `openclawContextEngine.ts` | Maybe |

**Wiring tasks (after substrate):**

| # | Task | File | Core change? |
|---|------|------|--------------|
| W5.1 | Create `SubagentTurnExecutor` — creates ephemeral session, runs a single turn with timeout, collects final assistant message, disposes session | `src/openclaw/openclawSubagentExecutor.ts` (new) | No |
| W5.2 | Create `SubagentAnnouncer` — posts announcement + final result back to parent chat | `openclawSubagentExecutor.ts` | No |
| W5.3 | Instantiate `SubagentSpawner` in workbench Phase 5 | `workbench.ts` | **YES** |
| W5.4 | Define tool `sessions_spawn` in `src/built-in/chat/tools/subagentTools.ts` (new) | new file | No |
| W5.5 | Register tool, enforce **always-approval** default policy | tool registry + `openclawToolPolicy.ts` | **YES** |
| W5.6 | Wire to default participant with depth limit 3 and concurrent limit 5 | `openclawDefaultParticipant.ts` | No |
| W5.7 | Tests: happy path, timeout, depth limit, concurrent limit, parent-session pollution check, approval gate | unit + ephemeral-session tests | No |
| W5.8 | UX: sub-agent run appears as a collapsed card in parent chat with task label, status, final result; never shows as a separate chat tab | Chat widget extension | No |

**Done when:** parent agent can call `sessions_spawn({task:"summarize foo.md"})`,
the sub-agent runs on a fresh context, its final response lands as a quoted
card in the parent chat, and no ephemeral-session rows appear in
`chat_sessions`.

---

## 6. Core Files Requiring Approval

The parity principles require explicit owner approval for any core-file
change. M58 needs the following approvals **up front** — batched into one
decision so the parity cycles don't stall mid-work:

| File | Reason | Domains |
|------|--------|---------|
| `src/aiSettings/unifiedConfigTypes.ts` | Heartbeat config keys | W2 |
| `src/services/serviceTypes.ts` | `ISurfaceRouterService` registration | W6 |
| `src/workbench/workbench.ts` Phase 5 | Instantiation of Heartbeat, Cron, SurfaceRouter, Subagent | W2, W4, W5, W6 |
| `src/built-in/chat/main.ts` | Event-bus wiring to `heartbeatRunner.pushEvent()` | W2 |
| `src/services/indexingPipeline.ts` | `index-complete` event emit | W2 |
| `src/built-in/chat/tools/builtInTools.ts` | Cron, subagent, surface tool registration | W4, W5, W6 |
| `src/openclaw/openclawToolPolicy.ts` | Approval gates on cron mutations, subagent spawn, filesystem/canvas surface writes | W4, W5, W6 |
| `src/services/chatSessionPersistence.ts` + `chatDataService.ts` | Ephemeral session fork | W5 |

No other core file is touched by M58.

---

## 6.5. Deferred: The Isolated-Turn Substrate ("Ship Thin" Decision)

**Status:** In force for W2, W4, W5 executors in M58. Remediated in **M59**.

### The decision

During W2 (HeartbeatRunner wiring), the Parity Orchestrator discovered that
**no isolated-turn primitive exists** in Parallx today:

- `chatService.sendRequest` mutates the active session's `messages[]`.
- Every turn-running path pollutes whichever session it runs in.
- There is no "run a turn against a scratch message list, collect the final
  assistant response, discard the session state" facility.

Inventing a parallel turn engine to fix this would violate **M41 P6 —
"don't invent when upstream has a proven approach"** and would duplicate
logic that belongs in a shared substrate.

The **"ship thin"** decision, recorded here so it is not forgotten:

| Domain | Thin executor does | Full executor will do |
|--------|--------------------|-----------------------|
| W2 Heartbeat | Emits origin-stamped status-surface deliveries only — no LLM call, no tool loop | Runs a real isolated LLM turn with tools against a scratch context |
| W4 Cron | Same — status-surface delivery + (optionally) a notification surface ping | Runs a real isolated LLM turn with the cron job's `agentTurn` payload |
| W5 Subagent | Builds the isolated-turn substrate **and** the subagent executor on top of it | — |

### Why ship thin now

1. **Proves the substrate above the turn.** Config, events, triggers, UX,
   default-off safety, surface routing, origin tagging, and dispose all get
   end-to-end exercise. These are the hard-to-test surfaces if you skip them.
2. **Zero safety risk.** A heartbeat that only blinks a status bar cannot
   run tools, cannot write files, cannot spam chat. The failure mode is
   "status bar pulses at the wrong moment," which is recoverable.
3. **Avoids inventing a second turn engine.** W5 has to build isolated
   sessions anyway to make subagent spawn work. That work becomes the
   shared substrate for W2/W4/W5 executors instead of three independent
   half-solutions.
4. **`*TurnExecutor` signatures are stable seams.** The runner, config,
   UX, event routing, tool definitions, and tests survive the swap. Only
   the executor body changes.

### Remediation path

Tracked as the **M59 primary deliverable**:

1. Build the isolated-turn substrate in
   `src/services/chatSessionPersistence.ts` + `chatDataService.ts` per
   M58 W5-A (`createEphemeralSession`, list-filter, token/context isolation).
2. Retrofit `createHeartbeatTurnExecutor` to route turns through it,
   with `reasons`-keyed routing policy (e.g. `interval` → status only,
   `system-event` → isolated turn).
3. Retrofit `createCronTurnExecutor` the same way — `payload.agentTurn`
   now actually runs.
4. Build `createSubagentTurnExecutor` directly on the substrate (no
   retrofit — it's the reason the substrate exists).

All three executors end M59 running real isolated LLM turns with tools,
never polluting user chat history. At that point the original M58 Section 1
success signal — *"an isolated agent turn that didn't require a user message
run to completion"* — is fully met.

### What M58 closure does NOT claim

M58 closure claims **triggers, schedulers, delegators, surface routers,
configs, events, and UX are all wired and safe**. It explicitly does **not**
claim the autonomy loop is semantically complete — heartbeat/cron turns in
M58 report state, not action. The autonomy loop closes in M59.

This split is intentional. Shipping thin first is the conservative,
principle-aligned path. Skipping W5's substrate work into M58 would have
been scope creep that M41 principles exist to prevent.

### Rule for remaining M58 domains

**W4 (Cron) and W5-thin-executor paths MUST ship thin** — consistent with
W2. Do not one-off a real turn path for cron while heartbeat stays thin.
One swap event in M59 retrofits all three uniformly.

W5's **substrate** (ephemeral session, list filter, isolation invariants)
is still in M58 scope per the original plan. Only the cron/heartbeat
*executor bodies* that would use that substrate are deferred. The
subagent executor that W5 ships **does** use the substrate — subagent
delivery is the minimum viable proof that the substrate works.

---

## 7. Verification Strategy

Per the parity workflow, every domain must pass:

1. **Unit tests** — existing 187 tests stay green; each wiring task adds
   integration tests that exercise the runtime path.
2. **Type check** — zero TS errors across the full tree.
3. **Full suite** — `npm run test:unit` full run, not targeted.
4. **AI eval** — autonomy scenarios in `tests/ai-eval/` must stay at 100%
   on autonomy scoring (`boundary`, `approval`, `completion`, `trace`).
   Retrieval regressions outside autonomy slice are tracked separately.
5. **UX Guardian pass** — 6 surfaces: chat input, chat list, task rail,
   approval flow, AI settings, status bar. No regressions.
6. **Loop safety audit** — after every domain lands, re-run loop-detection
   tests against the new call path.

### New autonomy integration e2e (added in M58)

| Scenario | Proves |
|----------|--------|
| Tool returns `continuationRequested` → turn continues once, stops at depth 5 | W1 |
| Surface toast fires from tool call, no feedback loop | W6 |
| File change while heartbeat enabled → isolated turn, status bar tick, no chat pollution | W2 |
| `cron_add --every 1m` → job fires, runs isolated turn, `cron_runs` shows history | W4 |
| `sessions_spawn` happy path → ephemeral session captured, result in parent chat, no DB row | W5 |
| Heartbeat disabled by default on fresh workspace | W2 (safety) |
| Approval denied on `cron_remove` → job preserved, task rail shows denial | W4 |

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Upstream API drift since `e635cedb` | Medium | Per-module rework | Parity Auditor re-audits **first** in every domain |
| Feedback loop: surface write → heartbeat → surface write | Medium | User-visible storm | W6.7 suppression window + surfaceId origin tag |
| Ephemeral session leaks into session list | Medium | Chat UI clutter | W5-A.2 persistence filter + explicit tests |
| Heartbeat runaway during dev | High (without default-off) | User confusion, local Ollama load | W2 ships **disabled**; AI settings toggle required |
| Cron runs missed jobs aggressively on startup and starves UI | Low | Startup lag | `runMissedJobs` already batched; verify in W4.9 |
| Subagent concurrent limit pinned too high, saturates local Ollama | Low | UI pause, model queue | Concurrent limit defaults to 2 on desktop, upstream's 5 ceiling preserved |
| Loop-safety passes on ephemeral sessions duplicate the parent's history | Medium | False positives | W5-A.3 verifies isolated tool-call history |

---

## 9. Deliverables Checklist

- [ ] W0 shim deleted
- [ ] W1 followup wired, autonomy e2e green
- [ ] W6 SurfaceRouter + 5 plugins live, tool defs registered, feedback-loop guard proven
- [ ] W2 Heartbeat wired, default-off, AI settings toggle, status-bar pulse
- [ ] W4 Cron wired, 8 tool defs registered, approval gates enforced
- [ ] W5 Subagent wired, ephemeral sessions, `sessions_spawn` tool, always-approval default
- [ ] All pre-existing 187 tests still green
- [ ] M58 autonomy e2e suite added and green
- [ ] AI settings panel surfaces heartbeat + cron visibility
- [ ] UX Guardian pass on all 6 surfaces
- [ ] M58 tracker per-domain in `docs/ai/openclaw/W*_TRACKER.md`
- [ ] Final merge to `master`, M59 backlog seeded with deferred items (cron persistence, subagent tree, canvas-write surface upgrade)

---

## 10. M59 Seed (explicitly deferred, not in scope)

- Cron job persistence (SQLite-backed `cron_jobs` table)
- Cron JSONL run-log
- Subagent descendant tree + registry persistence
- Canvas surface write upgrade (full page content writes, not just append)
- Surface `log` / `telemetry` plugin for trace visibility
- Heartbeat output-level dedup (24h window) if heartbeat turns become
  user-visible
- Multi-channel messaging parity (Telegram/Discord) — still out of scope

---

## 11. Agent Assignments

Per `docs/OPENCLAW_DEAD_CODE_AND_PARITY_AGENTS.md`, the parity workflow is
already fully specified. M58 uses:

| Agent | Role |
|-------|------|
| **Parity Orchestrator** | Drives the per-domain 12-step cycle, maintains M58 tracker |
| **AI Parity Auditor** | Re-audits each module against current upstream before wiring |
| **Gap Mapper** | Produces wiring gap maps per domain |
| **Parity Code Executor** | Implements wiring, traces every change to upstream |
| **Parity Verification Agent** | Full-suite test + type + AI eval after each domain |
| **Parity UX Guardian** | Validates user-facing surfaces after each domain |

Each domain produces three docs in `docs/ai/openclaw/`:

- `W{N}_{NAME}_AUDIT.md`
- `W{N}_{NAME}_GAP_MAP.md`
- `W{N}_{NAME}_TRACKER.md`

---

## 12. Success Signal

M58 is done when, on a fresh workspace with heartbeat enabled, a user can:

1. Edit a file in the workspace folder.
2. See the status bar pulse within one heartbeat interval.
3. Observe an isolated agent turn that **didn't require a user message** run
   to completion — visible in the task rail, not in chat history.
4. See the result of that turn land on an appropriate surface
   (notification / status / canvas append) via the router.
5. Ask the agent "schedule a daily 9am scan of my workspace" and see a real
   cron job appear in the cron list.
6. Ask the agent "spawn a sub-agent to summarize foo.md" and see a quoted
   sub-agent card land in chat with the final summary — without any pollution
   in the main session.

When that demo runs end-to-end without hand-wiring, **Parallx is awake.**
