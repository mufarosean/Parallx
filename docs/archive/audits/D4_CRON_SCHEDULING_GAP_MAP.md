# D4 Cron & Scheduling — Gap Map (Change Plan)

**Source audit:** `docs/D4_CRON_SCHEDULING_AUDIT.md`  
**Date:** 2026-03-28  
**Parallx file:** `src/openclaw/openclawCronService.ts`  
**Test file:** `tests/unit/openclawCronService.test.ts`  
**Upstream commit:** `9098e948` (indexed 2026-03-27)

---

## Summary

| Capability | Classification | Disposition | Priority |
|-----------|---------------|-------------|----------|
| D4.13: Cron expression parser | MISALIGNED → ALIGNED | REQUIRED | HIGH |
| D4.10: Run history bounds | MISALIGNED → ALIGNED | REQUIRED | MEDIUM |
| D4.2: ICronJob missing fields | MISALIGNED → ALIGNED | RECOMMENDED | MEDIUM |
| D4.3: Schedule type structure | MISALIGNED → ALIGNED | DEFERRED | MEDIUM |
| MISSING: Job persistence (SQLite) | MISSING | DEFERRED | — |
| MISSING: `status` action | MISSING → ALIGNED | RECOMMENDED | LOW |
| MISSING: JSONL run-log | MISSING | DEFERRED | — |

---

## Change Plan

---

### D4.13: Cron Expression Parser — REQUIRED (HIGH)

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/cron/schedule.ts`, `computeNextRunAtMs()`, lines 85-140; uses `croner` library (`import { Cron } from "croner"`)
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `computeNextRun()` cron branch (~line 504)
- **Action**:
  1. Add `croner` as a dependency (`npm install croner`). Upstream uses it as the sole cron expression library — it supports 5-field and 6-field crontab, timezone via `Intl`, and provides `nextRun(refDate)` / `previousRuns(count, refDate)`.
  2. Replace the placeholder `return fromMs + 60_000` in the `computeNextRun()` cron branch with actual cron evaluation:
     ```ts
     import { Cron } from 'croner';

     // In the cron branch of computeNextRun():
     const cron = new Cron(schedule.cron);
     const next = cron.nextRun(new Date(fromMs));
     if (!next) return null;
     const nextMs = next.getTime();
     // Upstream workaround: croner can return past timestamps in some tz/date combos
     if (nextMs <= fromMs) {
       const retry = cron.nextRun(new Date(Math.floor(fromMs / 1000) * 1000 + 1000));
       return retry ? retry.getTime() : null;
     }
     return nextMs;
     ```
  3. Update `validateSchedule()` to use `Cron` for validation instead of the naive 5-field check:
     ```ts
     if (schedule.cron) {
       try { new Cron(schedule.cron); }
       catch { throw new Error(`Invalid cron expression: ${schedule.cron}`); }
     }
     ```
  4. Upstream caches `Cron` instances (LRU with 512 max, keyed by `tz + expr`). For desktop with MAX_CRON_JOBS=50, caching is nice-to-have but not required. A simple `Map<string, Cron>` with the same cap pattern is acceptable if performance matters later.
- **Remove**: The entire placeholder block: `return fromMs + 60_000` and its comment "This is a placeholder for a proper cron parser".
- **Verify**:
  - `computeNextRun({ cron: '*/5 * * * *' }, now)` returns a time within 5 minutes
  - `computeNextRun({ cron: '0 9 * * 1' }, mondayAt8am)` returns Monday 9:00 AM
  - `computeNextRun({ cron: '0 9 * * 1' }, mondayAt10am)` returns NEXT Monday 9:00 AM
  - Invalid expressions throw during validation
  - Existing `parseDuration` and "at"/"every" paths remain unchanged
- **Risk**: `croner` is a new dependency. It's well-maintained (upstream uses it at commit 9098e948), MIT licensed, zero transitive dependencies. Electron packaging should include it without issue. Existing "every" and "at" tests must still pass — only the cron branch changes.

---

### D4.10: Run History Bounds — REQUIRED (MEDIUM)

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/cron/run-log.ts` — JSONL per-job files with configurable retention; `src/cron/service/timer.ts:206-216` — failure alert integration
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `_runHistory` array, `runHistory` getter
- **Action**:
  1. Add a `MAX_RUN_HISTORY` constant (e.g., `200`). When `_runHistory.push(result)` would exceed the cap, shift the oldest entries. This is a simple ring-buffer pattern:
     ```ts
     export const MAX_RUN_HISTORY = 200;

     // After push:
     if (this._runHistory.length > MAX_RUN_HISTORY) {
       this._runHistory.splice(0, this._runHistory.length - MAX_RUN_HISTORY);
     }
     ```
  2. Add a `runHistoryForJob(jobId: string)` method that filters by `jobId` — upstream's `runs` action returns per-job history. This enables the cron-tool `runs` action to work correctly:
     ```ts
     runHistoryForJob(jobId: string): readonly ICronRunResult[] {
       return this._runHistory.filter(r => r.jobId === jobId);
     }
     ```
  3. The cap applies in both the success and error paths of `_executeJob()` (two `push` sites).
- **Remove**: Nothing — this is additive, fixing the unbounded growth.
- **Verify**:
  - After 250 job runs, `runHistory.length === 200` (oldest 50 trimmed)
  - `runHistoryForJob('cron-1')` returns only results for that job
  - Existing run-history tests still pass
- **Risk**: Low. Trimming old entries could lose history for long-running jobs, but 200 entries at ~100 bytes each is ~20KB — more than sufficient for a desktop app's session lifetime. No persistence (DEFERRED) means history resets on restart anyway.

---

### D4.2: ICronJob Missing Fields — RECOMMENDED (MEDIUM)

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/cron/types-shared.ts` lines 1-18, `CronJobBase<>` generic; `src/cron/types.ts` lines 128-162, `CronJob` concrete type
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `ICronJob` interface (~line 80)
- **Action**: Add the following **optional** fields to `ICronJob` to match upstream's `CronJobBase`. All new fields are optional to avoid breaking existing code:

  | Field | Type | Upstream source | Notes |
  |-------|------|----------------|-------|
  | `description?` | `string` | `CronJobBase.description` | Human-readable job description |
  | `deleteAfterRun?` | `boolean` | `CronJobBase.deleteAfterRun` | Auto-remove after successful one-shot |
  | `updatedAt?` | `number` | `CronJobBase.updatedAtMs` | Timestamp of last update |

  Implementation details:
  1. Add the three fields to `ICronJob` as `readonly` optional.
  2. In `addJob()`: set `deleteAfterRun` to `true` for "at" schedules (upstream default: `schedule.kind === "at" ? true : undefined` — `src/cron/service/jobs.ts` `createJob()` line ~380). Set `updatedAt` to `Date.now()`.
  3. In `updateJob()`: update `updatedAt` to `Date.now()`.
  4. If `deleteAfterRun` is `true` and execution succeeds, call `this._jobs.delete(job.id)` after recording the run result.
  5. Add `description` to `ICronJobCreateParams` and `ICronJobUpdateParams` as optional fields.

  **Fields NOT added** (desktop N/A):
  | Upstream field | Reason to skip |
  |---------------|----------------|
  | `sessionTarget` | Single session — always "current chat" on desktop |
  | `delivery` | No channel delivery — all output → chat |
  | `agentId` | Single agent on desktop |
  | `sessionKey` | Single session |
  | `failureAlert` | Requires delivery infrastructure |

- **Remove**: Nothing.
- **Verify**:
  - "at" jobs with `deleteAfterRun: true` are removed from `_jobs` after successful execution
  - `updatedAt` advances on each `updateJob()` call
  - `description` round-trips through add → getJob
  - All 50 existing tests still pass (new fields are optional)
- **Risk**: Low. All fields are optional, so no existing code breaks. The `deleteAfterRun` auto-removal behavior is new logic in `_executeJob()` — test it carefully for edge cases (what if execution fails? Job should NOT be deleted).

---

### D4.3: Schedule Type Structure — DEFERRED

- **Status**: MISALIGNED (deferred)
- **Upstream**: `src/cron/types.ts` lines 6-16 — `CronSchedule` discriminated union: `{ kind: "at"; at: string } | { kind: "every"; everyMs: number; anchorMs?: number } | { kind: "cron"; expr: string; tz?: string; staggerMs?: number }`
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `ICronSchedule` interface
- **Rationale for deferral**: Converting from `{ at?, every?, cron? }` to discriminated unions with `kind` is a breaking structural change that touches:
  - `ICronSchedule` interface (core type)
  - `validateSchedule()` (rewrite)
  - `computeNextRun()` (rewrite switch logic)
  - All `addJob()` / `updateJob()` callers
  - All 50+ tests that construct schedule objects
  - The cron tool surface (agent-facing API)

  The current optional-fields pattern is **functionally correct** — it just lacks type narrowing and upstream-specific fields (`tz`, `anchorMs`, `staggerMs`). The cron parser fix (D4.13 REQUIRED) works within either schema. This is a scope expansion with high refactoring cost and low correctness impact.

  **When to revisit**: When timezone support is needed, or when the cron tool API is formalized for agent consumption. The `tz` field on upstream's cron schedule variant is the only field with real functional impact.

---

### MISSING: `status` Action — RECOMMENDED (LOW)

- **Status**: MISSING → ALIGNED
- **Upstream**: `src/cron/service/ops.ts` `status()` — returns `{ enabled, storePath, jobs: number, nextWakeAtMs }`
- **Parallx file**: `src/openclaw/openclawCronService.ts`, `CronService` class
- **Action**: Add a `status()` method to `CronService`:
  ```ts
  /** Status summary — upstream: ops.status(). */
  status(): { enabled: boolean; jobs: number; nextWakeAtMs: number | null } {
    const nextWake = this.jobs
      .filter(j => j.enabled && j.nextRunAt !== null)
      .reduce<number | null>((min, j) => {
        if (j.nextRunAt === null) return min;
        return min === null ? j.nextRunAt : Math.min(min, j.nextRunAt);
      }, null);

    return {
      enabled: this.isRunning,
      jobs: this.jobCount,
      nextWakeAtMs: nextWake,
    };
  }
  ```
  Upstream also returns `storePath` (file path to JSON store) — N/A for in-memory desktop. The `nextWakeAtMs` field mirrors upstream's `nextWakeAtMs()` in `src/cron/service/jobs.ts` lines 260-280.
- **Remove**: Nothing.
- **Verify**:
  - `status()` returns correct job count, running state, and earliest `nextRunAt`
  - Returns `null` for `nextWakeAtMs` when no jobs are enabled or all are past-due
- **Risk**: None. Purely additive. Needed if the cron-tool `status` action is wired up.

---

### MISSING: Job Persistence (SQLite) — DEFERRED

- **Status**: MISSING (deferred)
- **Upstream**: `src/cron/service/store.ts` — file-based JSON store (`~/.openclaw/cron/store.json`), `ensureLoaded()`, `persist()`
- **Rationale**: User instruction explicitly says "Do NOT propose adding SQLite persistence." The existing in-memory `Map` is sufficient for desktop use. Jobs are lost on restart, which is acceptable for a single-user app where the agent can re-create reminders.
- **When to revisit**: When the SQLite-vec integration layer is stable and cron persistence is prioritized.

---

### MISSING: JSONL Run-Log — DEFERRED

- **Status**: MISSING (deferred)
- **Upstream**: `src/cron/run-log.ts` — JSONL file per job (`cron/runs/<jobId>.jsonl`), paginated reads, retention policy
- **Rationale**: The D4.10 fix (run history bounds + per-job filtering) provides the in-memory equivalent. Persistence to JSONL requires filesystem infrastructure that should wait for the persistence layer (same deferral as job persistence).
- **When to revisit**: When job persistence (SQLite) is implemented, run-log persistence follows naturally.

---

## Dependency Order

Changes should be implemented in this order:

1. **D4.13** — Cron parser fix (standalone, no dependency on other changes)
2. **D4.10** — Run history bounds (standalone, touches `_executeJob()`)
3. **D4.2** — ICronJob field additions (touches `ICronJob`, `addJob()`, `updateJob()`, `_executeJob()`)
4. **MISSING: status** — Status method (standalone, uses existing accessors)

Items 1-2 are independent and can be implemented in parallel. Item 3 depends on the `_executeJob()` changes from items 1-2 being stable. Item 4 is independent of all others.

---

## Cross-File Impact

| Change | Files affected | Type impact |
|--------|---------------|-------------|
| D4.13 (croner) | `openclawCronService.ts`, `package.json` | New dependency, no type changes |
| D4.10 (bounds) | `openclawCronService.ts` | New constant + method, no type changes |
| D4.2 (fields) | `openclawCronService.ts` | Optional fields added to `ICronJob`, `ICronJobCreateParams`, `ICronJobUpdateParams` |
| status action | `openclawCronService.ts` | New method, no type changes |
| Tests | `openclawCronService.test.ts` | New tests for cron parsing, history bounds, new fields, status |

No changes to files outside the cron service module. No cross-module type impacts (all new fields are optional).

---

## Platform Adaptation Notes

| Upstream pattern | Parallx adaptation | Reason |
|-----------------|-------------------|--------|
| `sessionTarget` discriminated union | Omitted (always current chat) | Single-user desktop, one session |
| `CronDelivery` modes (webhook/announce) | Omitted | No channel delivery, all output → chat |
| File-based store (`store.json`) | In-memory `Map` (deferred to SQLite) | Desktop app, persistence layer pending |
| JSONL run-log per job | In-memory array with cap | No filesystem persistence yet |
| `croner` timezone via `tz` field | Use system tz (omit `tz` field) | Single-user desktop, system clock is authoritative |
| Stagger window (`staggerMs`) | Omitted | MAX_CRON_JOBS=50, no resource spike concern |
| Smart timer arming (`armTimer`) | Fixed 60s interval | Acceptable for ≤50 jobs on desktop |
| Auth profile rotation per job | N/A | Single local Ollama instance |
