# W4 — Cron Wiring Audit (M58)

**Domain**: D4 CronService
**Milestone**: M58 W4
**Date**: 2026-04-22
**Outcome**: Module is audit-complete (D4 17/17 ALIGNED, 77 existing tests)
but had zero production imports pre-W4. Audit re-verified alignment and
substrate preconditions before wiring.

---

## 1. Upstream reference state

**Upstream target (D4 baseline)**: `cron-tool.ts:1-541` +
`cron/service.ts` at `github.com/openclaw/openclaw@e635cedb`.

### 1.1 Drift note

As of this audit, `cron-tool.ts` has restructured on upstream `main`
alongside the other autonomy modules (same pattern observed in W2 for
`heartbeat-runner.ts`). The 8-action tool surface
(`status`, `list`, `add`, `update`, `remove`, `run`, `runs`, `wake`) and
the job schema (`name`, `schedule {at|every|cron}`, `payload
{systemEvent?, agentTurn?}`, `wakeMode`, `contextMessages`, `enabled`,
`deleteAfterRun`, `description`) are still the semantic truth captured
inside `src/openclaw/openclawCronService.ts` and its 77-test suite.

**Decision**: drift is documented, not corrected. Parallx tracks the D4
baseline and its 17-capability closure. No behavioral correction needed.

### 1.2 Pattern-family references still live upstream

- **ChannelPlugin outbound tagging** (M58 W6) — cron reuses
  `ISurfaceRouterService.sendWithOrigin(..., ORIGIN_CRON)` to carry the
  origin through history, mirroring the upstream channel-outbound origin
  field.
- **HeartbeatRunner pigggy-back wake** (M58 W2) — cron's
  `"next-heartbeat"` mode exercises the heartbeat reasons allowlist
  (`'cron'` already shipped in W2 as `HEARTBEAT_REASON_OPTIONS`).

---

## 2. Parallx-side re-audit

### 2.1 Scheduler module — `src/openclaw/openclawCronService.ts`

| Capability | Status | Evidence |
|-----------|--------|----------|
| Job CRUD (add/update/remove/get) | ALIGNED | `CronService.addJob/updateJob/removeJob/getJob` |
| Schedule shape: at / every / cron | ALIGNED | `validateSchedule` enforces exactly one field |
| Duration parser (`5m`, `1h`, `500ms`, `1d`) | ALIGNED | `parseDuration` — unit test coverage |
| 5-field cron parser (`* * * * *`) | ALIGNED | `computeNextCronRun` + `parseCronField` |
| Timer tick + `_checkDueJobs` | ALIGNED | `setInterval` 60s default |
| Missed-job catchup on start | ALIGNED | `_runMissedJobs` called from `start()` |
| Context injection via fetcher | ALIGNED | `ContextLineFetcher` delegate |
| Wake modes `now` / `next-heartbeat` | ALIGNED | `_executeJob` branches on `wakeMode` |
| Run history + trim to MAX | ALIGNED | `_trimRunHistory` + `MAX_RUN_HISTORY=200` |
| Per-job run history view | ALIGNED | `getJobRuns(jobId)` |
| `deleteAfterRun` one-shot jobs | ALIGNED | `_executeJob` removes on success |
| Interval floor (1 min) | ALIGNED | `MIN_EVERY_INTERVAL_MS` enforcement |
| Max jobs cap (50) | ALIGNED | `MAX_CRON_JOBS` |
| Contextual lines clamp (0..10) | ALIGNED | `clampContextMessages` |
| `wake()` force-check-due | ALIGNED | `wake()` delegates to `_checkDueJobs` |
| `status()` summary | ALIGNED | Mirror of cron-tool.ts "status" action |
| Dispose releases timer + state | ALIGNED | `dispose()` clears timer + maps |

**Scheduler alignment: 17/17 ALIGNED** — matches D4 closure.

### 2.2 Wiring capabilities (NEW for W4)

| Capability | Pre-W4 | Post-W4 |
|-----------|--------|---------|
| W4.1 Thin `CronTurnExecutor` emitting ORIGIN_CRON deliveries | MISSING | ALIGNED |
| W4.2 `ContextLineFetcher` reading last-N pairs from active chat session | MISSING | ALIGNED |
| W4.3 `HeartbeatWaker` adapter → `heartbeatRunner.wake('cron')` | MISSING | ALIGNED |
| W4.4 Instantiation in `chat/main.ts` (deviation from plan `workbench.ts`, see W2 precedent) + `start()` + disposable + missed-job catchup | MISSING | ALIGNED |
| W4.5 8 tool definitions in `cronTools.ts` matching upstream action set | MISSING | ALIGNED |
| W4.6 Registration via `registerBuiltInTools` | MISSING | ALIGNED |
| W4.7 Approval gates in `openclawToolPolicy.ts` (add/update/remove require approval; status/list/runs/run/wake free) | MISSING | ALIGNED |
| W4.8 Persistence | DEFERRED | DEFERRED (M59 backlog — documented) |
| W4.9 Wiring tests: all 8 actions, wake modes, missed-job catchup, approval gating, origin tagging | MISSING | ALIGNED (13 tests) |
| W4.10 Minimal AI-settings cron subsection (info + approval posture + placeholder slot for M59 job list) | MISSING | ALIGNED |

**Wiring alignment: 9/9 ALIGNED + 1 DEFERRED (W4.8 persistence, tracked for M59).**

---

## 3. Substrate reality check (ship thin per §6.5)

Cron firing cannot invoke a real LLM turn today for the same reason W2
heartbeat ticks can't: Parallx has no isolated-turn substrate. Routing a
cron fire through `chatService.sendRequest` would pollute the active chat
session, and inventing a parallel turn engine would violate M41 P6.

**Decision (per Parallx_Milestone_58.md §6.5):** W4 ships a **thin
executor** — on fire it routes:

1. `SURFACE_STATUS` flash ("⏰ cron · <name>") with ORIGIN_CRON;
2. `SURFACE_NOTIFICATIONS` info toast ("Cron job <name> fired") with
   ORIGIN_CRON and `severity:'info'`;
3. `SURFACE_STATUS` idle reset.

`payload.agentTurn` is captured in the cron job record AND stamped into
every delivery's `metadata.cronEvent.agentTurn` field. When the M59
isolated-turn substrate (W5) lands, `createCronTurnExecutor` is the
stable swap seam — only the body changes; runner, scheduler, tool
surface, approval policy, and UX are untouched.

The 8-action tool surface fully drives the scheduler (add/update/remove
mutate state; list/status/runs/run/wake observe or trigger). Only the
*effect of a fire* is thin.

---

## 4. Feedback-loop guard

The cron scheduler has no event inputs — it is a pure timer over its own
job map. Surface writes from the executor cannot re-enter the scheduler
because nothing inside `CronService` inspects `SurfaceRouter` history.

Even so, every delivery is stamped ORIGIN_CRON so that:

- The W2 HeartbeatRunner (which may see notification or status surface
  activity via future workbench events) can filter its inputs via
  `getDeliveriesByOrigin(ORIGIN_CRON)` if a consumer ever wires that up.
- The `surface_list` tool reports origin posture alongside availability.

Assertion added to `openclawCronWiring.test.ts`: every executor delivery
carries ORIGIN_CRON, and `router.sendWithOrigin` is called exactly 3x
per fire — no other output path is touched.

---

## 5. Decision gate

All 9 wiring capabilities ALIGNED + 1 documented deferral (W4.8
persistence → M59 backlog). Thin-executor scope recorded. Feedback-loop
guard present. Proceed to GAP_MAP.
