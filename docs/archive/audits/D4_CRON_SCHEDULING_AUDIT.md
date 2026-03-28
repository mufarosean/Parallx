# D4 Cron & Scheduling Service — Parity Audit

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-28  
**Parallx file:** `src/openclaw/openclawCronService.ts` (~540 lines)  
**Test file:** `tests/unit/openclawCronService.test.ts` (50 tests, all pass)  
**Upstream references:**
- `src/agents/tools/cron-tool.ts` (~541 lines) — tool actions: status, list, add, update, remove, run, runs, wake
- `src/cron/service.ts` — CronService facade: start/stop/add/update/remove/run/wake/status/list
- `src/cron/service/ops.ts` — CronService operations: add, update, remove, list, run, wake, status
- `src/cron/service/timer.ts` — Timer tick, job execution, missed-job catchup, wake
- `src/cron/service/state.ts` — CronServiceState, CronEvent, CronServiceDeps
- `src/cron/service/store.ts` — File-based job persistence, ensureLoaded, persist
- `src/cron/service/jobs.ts` — createJob, applyJobPatch, computeNextRunAtMs, recomputeNextRuns
- `src/cron/types.ts` — CronJob, CronSchedule, CronPayload, CronSessionTarget, CronWakeMode
- `src/cron/types-shared.ts` — CronJobBase generic definition
- `src/cron/normalize.ts` — normalizeCronJobCreate, normalizeCronJobPatch
- `src/cron/schedule.ts` — computeNextRunAtMs, computePreviousRunAtMs
- `src/cron/delivery.ts` — CronDeliveryPlan, delivery mode resolution

---

## Summary

| Metric | Count |
|--------|-------|
| Capabilities audited | 16 |
| **ALIGNED** | 8 |
| **MISALIGNED** | 5 |
| **HEURISTIC** | 0 |
| **MISSING** | 3 |

**Overall assessment:** The Parallx CronService is a well-structured, clean implementation that captures the core operational patterns from upstream. The 8 ALIGNED capabilities cover the fundamentals (class structure, CRUD, timer lifecycle, wake modes, context injection, constants, duration parser, one-shot jobs). The 5 MISALIGNED items reflect structural differences in the job schema (upstream uses discriminated unions with `kind` fields for schedule/payload rather than Parallx's simple optional-field approach), missing upstream fields (`sessionTarget`, `delivery`, `agentId`, `description`, `deleteAfterRun`), and a placeholder cron expression parser. The 3 MISSING capabilities are: file-based persistence, a `status` action, and run-log JSONL persistence for the `runs` action. No anti-patterns detected — this is among the cleanest `src/openclaw/` modules.

---

## Per-Capability Findings

### D4.1: CronService Class Structure
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `CronService` class
- **Upstream reference**: `src/cron/service.ts` — `CronService` facade delegating to `ops.*`; `src/cron/service/ops.ts` — operational functions
- **Divergence**: Upstream splits into facade (`service.ts`) + ops (`ops.ts`) + timer (`timer.ts`) + store (`store.ts`) + jobs (`jobs.ts`). Parallx combines into a single class. This is an acceptable Parallx adaptation — the upstream split is for gateway-scale concerns (locked concurrency, file persistence, event emission). For a single-user desktop app, a single class is appropriate.
- **Evidence**: Parallx `CronService` has `addJob`, `updateJob`, `removeJob`, `runJob`, `wake`, `start`, `stop`, `dispose`, `getJob`, `jobs`, `runHistory`. Upstream has `add`, `update`, `remove`, `run`, `wake`, `start`, `stop`, `status`, `list`, `listPage`, `enqueueRun`, `getJob`.
- **Severity**: N/A

### D4.2: ICronJob Interface
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `ICronJob` interface
- **Upstream reference**: `src/cron/types-shared.ts` — `CronJobBase<>`, `src/cron/types.ts` — `CronJob` concrete type
- **Divergence**: Parallx `ICronJob` is missing several upstream fields. The structural differences are:

| Upstream Field | Parallx Field | Status |
|---------------|---------------|--------|
| `id: string` | `id: string` | ✅ Match |
| `agentId?: string` | — | ❌ Missing |
| `sessionKey?: string` | — | ❌ Missing |
| `name: string` | `name: string` | ✅ Match |
| `description?: string` | — | ❌ Missing |
| `enabled: boolean` | `enabled: boolean` | ✅ Match |
| `deleteAfterRun?: boolean` | — | ❌ Missing |
| `createdAtMs: number` | `createdAt: number` | ⚠️ Name diff (Ms suffix) |
| `updatedAtMs: number` | — | ❌ Missing |
| `schedule: CronSchedule` | `schedule: ICronSchedule` | ⚠️ Different schema (see D4.3) |
| `sessionTarget: CronSessionTarget` | — | ❌ Missing |
| `wakeMode: CronWakeMode` | `wakeMode: CronWakeMode` | ✅ Match |
| `payload: CronPayload` | `payload: ICronPayload` | ⚠️ Different schema (see below) |
| `delivery?: CronDelivery` | — | ❌ Missing (N/A for desktop) |
| `failureAlert?: CronFailureAlert` | — | ❌ Missing |
| `state: CronJobState` | Flattened fields (`lastRunAt`, `nextRunAt`, `runCount`) | ⚠️ Different shape |
| — | `contextMessages: number` | ⬆️ Parallx-specific |

  Additionally, upstream `CronPayload` is a discriminated union `{ kind: "systemEvent"; text } | { kind: "agentTurn"; message; model?; ... }`. Parallx `ICronPayload` is `{ systemEvent?: object; agentTurn?: string }` without a `kind` discriminator.

- **Evidence**: Comparing Parallx `ICronJob` with upstream `CronJobBase` in `types-shared.ts` lines 1-18.
- **Severity**: MEDIUM — The missing fields matter for feature completeness. `sessionTarget` and `delivery` are needed for upstream-compatible job semantics. `deleteAfterRun` controls one-shot cleanup. The `state` field consolidation is upstream's pattern for extensibility. `agentId` would matter if Parallx ever supports multi-agent cron. The `contextMessages` field is a Parallx adaptation of upstream's `buildReminderContextLines` which inlines context into payload text instead.

### D4.3: Schedule Validation
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `validateSchedule()` function
- **Upstream reference**: `src/cron/types.ts:6-16` — `CronSchedule` discriminated union; `src/gateway/protocol/schema/cron.ts:96-125` — `CronScheduleSchema`
- **Divergence**: Upstream uses discriminated unions with `kind` field: `{ kind: "at"; at: string }`, `{ kind: "every"; everyMs: number; anchorMs?: number }`, `{ kind: "cron"; expr: string; tz?: string; staggerMs?: number }`. Parallx uses optional fields `{ at?: string; every?: string; cron?: string }` with a "exactly one must be set" check. This means:
  - Upstream schedule identifies type via `kind` discriminator; Parallx uses field presence
  - Upstream `every` uses `everyMs` (milliseconds integer); Parallx `every` uses a human-readable duration string (parsed by `parseDuration`)
  - Upstream `cron` uses `expr` field for the expression with optional `tz` for timezone; Parallx puts the expression directly in the `cron` field with no timezone support
  - Upstream has `anchorMs` for "every" and `staggerMs` for "cron"; Parallx has neither
- **Evidence**: Parallx `validateSchedule` checks `fields.length !== 1`. Upstream validates via TypeBox schema with discriminated literal `kind` fields.
- **Severity**: MEDIUM — The Parallx approach is functional but structurally divergent from upstream's typed discriminant unions. Duration strings are a reasonable Parallx adaptation (upstream accepts ms via API but the tool/CLI also support duration input), but the lack of `tz` support for cron expressions is a gap for any schedule more complex than UTC.

### D4.4: Job CRUD (add/update/remove/list)
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `addJob()`, `updateJob()`, `removeJob()`, `getJob()`, `jobs` getter
- **Upstream reference**: `src/cron/service/ops.ts:242-349` — `add()`, `update()`, `remove()`, `list()`
- **Divergence**: Minimal. Both provide the same four operations plus get-by-id. Upstream `add()` normalizes delivery, computes next runs, persists, arms timer, emits events. Parallx `addJob()` validates, computes next run, stores in map. The core contract is the same — differences are persistence (upstream fs, Parallx in-memory) and gateway eventing (N/A for desktop).
- **Evidence**: All CRUD operations tested with 16+ tests covering happy path, error cases, and edge conditions (limit exhaustion, disposed state, unknown ID, schedule recomputation on update).
- **Severity**: N/A

### D4.5: Timer Lifecycle (start/stop)
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `start()`, `stop()`, `isRunning` getter
- **Upstream reference**: `src/cron/service/ops.ts:131-142` — `start()` and `stop()`; `src/cron/service/timer.ts` — `armTimer()`, `stopTimer()`
- **Divergence**: Upstream uses `armTimer` which dynamically adjusts the timer interval based on when the next job is due (`nextWakeAtMs`). Parallx uses a fixed `CRON_CHECK_INTERVAL_MS` (60s). Upstream's approach is more efficient (wakes only when needed), but the fixed-interval approach is acceptable for a desktop app with limited jobs.
- **Evidence**: `start()` calls `_runMissedJobs()` then sets a `setInterval`. `stop()` calls `clearInterval`. Both idempotent. Tests confirm start/stop/idempotent behavior.
- **Severity**: LOW — Fixed interval polling vs. smart timer arming. Could waste CPU checking sleeping jobs, but with MAX_CRON_JOBS=50 and 60s interval, this is negligible.

### D4.6: Job Execution (_executeJob)
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `_executeJob()` method
- **Upstream reference**: `src/cron/service/timer.ts:1188+` — `executeJob()`; `src/cron/service/timer.ts` — `executeJobCoreWithTimeout()`
- **Divergence**: Upstream execution is significantly more complex — handles delivery plans, timeout policies, session reaping, telemetry, failure alerts, run-log persistence, and event emission. Parallx distills this to: wake-mode dispatch → context fetch → executor delegate → state update → history recording. This is an appropriate simplification for a desktop app.
- **Evidence**: `_executeJob()` handles both wake modes, delegates execution, records results, catches errors. Tests verify success, failure, state updates, and history recording.
- **Severity**: N/A — Desktop simplification is legitimate; upstream's complexity is gateway-specific.

### D4.7: Missed Job Catchup
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `_runMissedJobs()` method
- **Upstream reference**: `src/cron/service/timer.ts` — `runMissedJobs()` (imported in ops.ts)
- **Divergence**: Both check for jobs whose `nextRunAt` has passed and fire them. Upstream's version is more nuanced — it handles the difference between the stored `nextRunAtMs` and current time, respects retry policies, and manages file persistence. Parallx does a simple scan-and-fire. The core pattern matches.
- **Evidence**: `_runMissedJobs()` is called inside `start()`, scans all enabled jobs with past-due `nextRunAt`, and fires them asynchronously with error logging.
- **Severity**: LOW — Functional match. Missing retry policy for missed jobs is minor for desktop.

### D4.8: Wake Mode Handling
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, wake mode logic in `_executeJob()`
- **Upstream reference**: `src/cron/service/timer.ts:1240+` — `wake()` function; `src/cron/service/ops.ts:594-600` — `wakeNow()`
- **Divergence**: Upstream `wake` enqueues a system event and optionally triggers an immediate heartbeat. In Parallx, "next-heartbeat" calls `_heartbeatWaker('cron')` to delegate to the HeartbeatRunner, and "now" executes the turn directly via the executor. This is structurally aligned — both distinguish between immediate and deferred execution.
- **Evidence**: Tests verify `"next-heartbeat"` calls heartbeat waker, `"now"` does not, and null waker is handled gracefully.
- **Severity**: N/A

### D4.9: Context Injection
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, context injection in `_executeJob()`; `ContextLineFetcher` type
- **Upstream reference**: `src/agents/tools/cron-tool.ts:443` — context injection via `buildReminderContextLines()` injecting into payload text
- **Divergence**: Upstream injects context directly into the payload text before sending to the gateway (`Recent context:\n...`). Parallx passes context lines as a separate parameter to the executor delegate. Parallx's approach is actually cleaner (separates context from payload), but it means the consuming executor must handle the context lines itself.
- **Evidence**: Tests verify context is fetched when `contextMessages > 0`, not fetched when 0, and passed correctly to the executor.
- **Severity**: LOW — Different integration point but same intent.

### D4.10: Run History Tracking
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `_runHistory` array, `runHistory` getter
- **Upstream reference**: `src/cron/run-log.ts` — JSONL file-based run log; gateway `cron.runs` method reads from `cron/runs/<jobId>.jsonl`
- **Divergence**: Upstream persists run history to JSONL files per-job with pagination, status filtering, and configurable retention. Parallx stores in an unbounded in-memory array with no pagination, no per-job isolation, and no retention policy. The `runs` cron-tool action relies on this persistent log.
- **Evidence**: `_runHistory: ICronRunResult[] = []` in the class. No per-job filtering. No size limit. Cleared on dispose. Tests verify single runs are recorded but don't test pagination or filtering.
- **Severity**: MEDIUM — Unbounded in-memory array could grow without limit. Missing per-job isolation means the `runs` action can't efficiently filter. No persistence means history is lost on restart.

### D4.11: Constants
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, constants at top
- **Upstream reference**: `src/agents/tools/cron-tool.ts:24` — `REMINDER_CONTEXT_MESSAGES_MAX = 10`; upstream CronService has configurable interval
- **Divergence**: 
  - `MAX_CONTEXT_MESSAGES = 10` matches upstream's `REMINDER_CONTEXT_MESSAGES_MAX = 10` ✅
  - `MAX_CRON_JOBS = 50` — no direct upstream equivalent (upstream has no hard limit, it's configurable) — reasonable desktop default
  - `CRON_CHECK_INTERVAL_MS = 60_000` — upstream uses dynamic timer arming, but 60s is a reasonable fallback
  - `MIN_EVERY_INTERVAL_MS = 60_000` — upstream validates via schema (`everyMs: { minimum: 1 }`), which is much lower. Parallx's 1-minute minimum is a safety guard.
- **Evidence**: Tests verify all four constants have expected values.
- **Severity**: N/A

### D4.12: Duration Parser
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `parseDuration()` function
- **Upstream reference**: Upstream accepts `everyMs` as raw milliseconds in the API. The CLI (`register.cron-add.ts`) accepts human-readable duration like `--every 1h`. Duration parsing is done at the CLI layer.
- **Divergence**: Parallx integrates duration parsing directly into the schedule contract (`every: "5m"`), while upstream separates it (CLI parses → API receives `everyMs`). Parallx's approach is cleaner for agent/tool use where a model can produce `"5m"` more naturally than `300000`.
- **Evidence**: Tests cover ms, s, m, h, d units, fractional values, case insensitivity, and error cases.
- **Severity**: N/A — Reasonable Parallx adaptation.

### D4.13: Cron Expression Handling
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `computeNextRun()` cron branch
- **Upstream reference**: `src/cron/schedule.ts` — `computeNextRunAtMs()` with full cron library
- **Divergence**: Parallx has **placeholder cron parsing** — it validates that the expression has 5 fields, but `computeNextRun` for cron schedules returns `fromMs + 60_000` (always 1 minute). The code itself notes: "This is a placeholder for a proper cron parser (upstream uses a full cron library)." This means `*/5 * * * *` and `0 9 * * 1` both fire every minute — incorrect behavior.
- **Evidence**: `computeNextRun` cron branch (line ~504): `return fromMs + 60_000;` with a comment acknowledging it's a placeholder.
- **Severity**: HIGH — Cron expressions are completely non-functional. Any cron-scheduled job fires every 60 seconds regardless of the expression. This is the most significant gap in the implementation.

### D4.14: One-Shot "at" Jobs
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `computeNextRun()` "at" branch
- **Upstream reference**: `src/cron/service/jobs.ts:538+` — `createJob()` with `deleteAfterRun` default for "at" schedule
- **Divergence**: Parallx correctly returns `null` for `nextRunAt` when the target time has passed (meaning the job won't fire again). Upstream additionally has `deleteAfterRun` which auto-removes one-shot jobs after success. Parallx doesn't auto-remove — the job persists with `nextRunAt: null`.
- **Evidence**: `computeNextRun` "at" branch: `return target > fromMs ? target : null;`
- **Severity**: LOW — Core one-shot semantics correct. Missing auto-remove is minor — job just becomes dormant.

### D4.15: Test Coverage
- **Classification**: ALIGNED
- **Parallx file**: `tests/unit/openclawCronService.test.ts` — 50 tests, 100% pass rate
- **Upstream reference**: `src/agents/tools/cron-tool.test.ts`, `src/cron/service.test-harness.ts`, multiple `service.*.test.ts` files
- **Divergence**: Parallx tests comprehensively cover: CRUD operations (8 tests), schedule validation (4 tests), timer lifecycle (3 tests), job execution (5 tests), context injection (2 tests), wake modes (3 tests), wake action (1 test), dispose (1 test), parseDuration (9 tests), constants (4 tests), plus timer-based execution (2 tests). The test structure uses proper mocking with vi.useFakeTimers and vi.fn delegates.
- **Evidence**: 50/50 tests pass. Good coverage of happy paths and error cases. Missing: cron expression actual parsing (can't test since it's a placeholder), persistence (none to test), status action, run history pagination.
- **Severity**: N/A

### D4.16: No Anti-Patterns (M41 Compliance)
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawCronService.ts`
- **Upstream reference**: M41 anti-pattern list
- **Divergence**: None detected.
  - ✅ **No preservation bias** — Code is clean, purpose-built, not inherited from heuristic patchwork
  - ✅ **No patch-thinking** — No workarounds on top of broken foundations
  - ✅ **No output repair** — No post-processing of cron results
  - ✅ **No pre-classification** — No regex/keyword routing
  - ✅ **No eval-driven patchwork** — Tests validate real behavior
  - ✅ **No invented patterns** — All capabilities trace to upstream cron-tool.ts and CronService
  - ✅ **Clean delegate architecture** — Uses CronTurnExecutor, ContextLineFetcher, HeartbeatWaker delegates instead of hardcoding
- **Evidence**: The module is one of the cleanest in `src/openclaw/` — well-documented, well-structured, proper separation of concerns.
- **Severity**: N/A

---

## Critical Findings

### 1. Cron Expression Parser is a Placeholder (D4.13) — **HIGH**
The `computeNextRun()` function returns `fromMs + 60_000` for all cron expressions regardless of their content. A job scheduled as `0 9 * * 1` (Monday at 9am) would fire every single minute. This needs a proper cron parser — either a library like `cron-parser` or a hand-written 5-field evaluator.

### 2. Job Schema Divergence (D4.2) — **MEDIUM**
`ICronJob` is missing upstream fields: `sessionTarget`, `delivery`, `agentId`, `description`, `deleteAfterRun`, `updatedAtMs`. The schedule and payload use different structural patterns (optional fields vs. discriminated unions). This means Parallx cron jobs can't represent the full range of upstream job configurations.

### 3. Schedule Type Structure (D4.3) — **MEDIUM**
Upstream uses `{ kind: "at" | "every" | "cron", ... }` discriminated unions with type-specific fields. Parallx uses `{ at?: string, every?: string, cron?: string }`. While functionally equivalent for simple cases, this prevents type-safe narrowing and loses upstream-specific fields (`anchorMs`, `tz`, `staggerMs`).

### 4. Missing Persistence (MISSING — not numbered) — **MEDIUM**
Upstream persists jobs to `~/.openclaw/cron/store.json` and run history to `cron/runs/<jobId>.jsonl`. Parallx stores everything in memory — all jobs and history are lost on restart. The docstring acknowledges "SQLite integration deferred to integration phase."

### 5. Missing `status` Action (MISSING — implied in D4.1) — **LOW**
Upstream's `status` action returns `{ enabled, storePath, jobs, nextWakeAtMs }`. Parallx has no `status()` method on CronService.

---

## Missing Capabilities (Not Covered by Audit IDs)

| Gap | Upstream | Parallx | Severity |
|-----|----------|---------|----------|
| Job persistence | `src/cron/service/store.ts` — file-based JSON store | In-memory `Map` | MEDIUM |
| `status` action | `ops.status()` | Missing | LOW |
| `enqueueRun` | `ops.enqueueRun()` — async queue | Missing | LOW |
| Delivery planning | `src/cron/delivery.ts` — announce/webhook/none | N/A for desktop | N/A |
| Failure alerts | `CronFailureAlert` — after N errors, alert | Missing | LOW |
| Session reaping | `sweepCronRunSessions()` | Missing | LOW |
| Smart timer arming | `armTimer()` based on `nextWakeAtMs` | Fixed interval | LOW |
| Job normalization | `normalizeCronJobCreate/Patch` | None | LOW |
| Run-log JSONL | `cron/runs/<jobId>.jsonl` | Unbounded in-memory array | MEDIUM |

---

## Recommendations

1. **HIGH PRIORITY**: Replace the cron expression placeholder with a real parser. Consider `cron-parser` npm package or a minimal 5-field evaluator.
2. **MEDIUM**: Align `ICronSchedule` with upstream discriminated union pattern (`kind` field + type-specific data).
3. **MEDIUM**: Add `sessionTarget` and `deleteAfterRun` to `ICronJob` — these affect job semantics.
4. **MEDIUM**: Add run-history size cap and per-job filtering to prevent unbounded growth.
5. **LOW**: Add `status()` method to CronService.
6. **DEFERRED**: Persistence can wait for SQLite integration phase.
7. **DEFERRED**: Delivery/failure-alert N/A for desktop-only use.
