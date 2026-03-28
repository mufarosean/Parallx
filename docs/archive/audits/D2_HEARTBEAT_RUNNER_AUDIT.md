# D2 Heartbeat Runner — Parity Audit

**Auditor**: AI Parity Auditor  
**Date**: 2026-03-28  
**Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts` (259 lines)  
**Upstream file**: `src/infra/heartbeat-runner.ts` (~1200 lines) + `heartbeat-wake.ts`, `heartbeat-reason.ts`, `heartbeat-summary.ts`, `heartbeat-active-hours.ts`  
**Test file**: `tests/unit/openclawHeartbeatRunner.test.ts` (20 tests, all passing)

---

## Summary

| ID | Capability | Classification | Severity |
|----|-----------|---------------|----------|
| D2.1 | HeartbeatRunner class | **ALIGNED** | — |
| D2.2 | IHeartbeatState interface | **ALIGNED** | — |
| D2.3 | Reason flags | **ALIGNED** | — |
| D2.4 | Timer lifecycle (start/stop) | **MISALIGNED** | LOW |
| D2.5 | Event queue (pushEvent) | **ALIGNED** | — |
| D2.6 | Duplicate suppression | **MISALIGNED** | LOW |
| D2.7 | Wake handler | **ALIGNED** | — |
| D2.8 | Preflight gates | **ALIGNED** | — |
| D2.9 | Error handling | **ALIGNED** | — |
| D2.10 | Disposal & cleanup | **ALIGNED** | — |
| D2.11 | Constants | **MISALIGNED** | LOW |
| D2.12 | Test coverage | **ALIGNED** | — |
| D2.13 | No anti-patterns | **ALIGNED** | — |

**Totals**: ALIGNED: 10 | MISALIGNED: 3 | HEURISTIC: 0 | MISSING: 0

---

## Per-Capability Findings

### D2.1: HeartbeatRunner class
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `HeartbeatRunner` class
- **Upstream reference**: `src/infra/heartbeat-runner.ts`, `startHeartbeatRunner()` (L960-1199) + `runHeartbeatOnce()` (L533-960)
- **Divergence**: Upstream uses two standalone functions (`startHeartbeatRunner` returns `{ stop, updateConfig }` and `runHeartbeatOnce` is a separate export). Parallx wraps both into a single `HeartbeatRunner` class with constructor injection of executor delegate and config getter.
- **Evidence**: Parallx constructor takes `(executor: HeartbeatTurnExecutor, getConfig: () => IHeartbeatConfig)` — the executor delegate correctly separates scheduling from execution, matching the upstream pattern where `startHeartbeatRunner` takes `runOnce` as a delegate. The class encapsulation is a valid desktop adaptation since there's no need for the globally registered wake handler pattern that upstream needs for cross-module communication.
- **Severity**: —

### D2.2: IHeartbeatState interface
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `IHeartbeatState`
- **Upstream reference**: `src/infra/heartbeat-runner.ts`, `HeartbeatAgentState` (L109-116)
- **Divergence**: Parallx: `{ enabled, intervalMs, lastRunMs, nextDueMs, consecutiveRuns }`. Upstream: `{ agentId, heartbeat?, intervalMs, lastRunMs?, nextDueMs }`. Parallx adds `enabled` and `consecutiveRuns`, drops `agentId` (single agent) and `heartbeat?` config reference.
- **Evidence**: Core scheduling fields `intervalMs`, `lastRunMs`, `nextDueMs` match exactly. Added `enabled` provides state visibility; `consecutiveRuns` is useful for desktop monitoring. Dropped fields are N/A for single-agent desktop.
- **Severity**: —

### D2.3: Reason flags
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `HeartbeatReason` type
- **Upstream reference**: `src/infra/heartbeat-reason.ts`, `HeartbeatReasonKind` (L1-8)
- **Divergence**: Parallx: `'interval' | 'system-event' | 'cron' | 'wake' | 'hook'`. Upstream: `'retry' | 'interval' | 'manual' | 'exec-event' | 'wake' | 'cron' | 'hook' | 'other'`. Parallx uses `system-event` where upstream uses `exec-event`. Missing: `retry`, `manual`, `other`.
- **Evidence**: `system-event` maps to upstream's `exec-event` (pending file changes, completions). Missing reasons (`retry`, `manual`, `other`) relate to gateway concerns: `retry` is for requests-in-flight re-scheduling, `manual` is CLI-triggered, `other` is catch-all. Desktop doesn't need these yet. The five present reasons cover all desktop use cases.
- **Severity**: —

### D2.4: Timer lifecycle (start/stop)
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `start()` / `stop()` methods
- **Upstream reference**: `src/infra/heartbeat-runner.ts`, `scheduleNext()` (L993-1010) + `cleanup()` (L1186-1196)
- **Divergence**: Parallx uses `setInterval` (fixed cadence). Upstream uses `setTimeout` chaining via `scheduleNext()` — one-shot timers re-armed after each execution. Upstream pattern allows adaptive scheduling: the next tick is computed based on the earliest `nextDueMs` across all agents, and intervals can change dynamically via `updateConfig()`.
- **Evidence**: Parallx `start()` calls `setInterval(() => this._tick('interval'), interval)`. Upstream `scheduleNext()` computes `delay = Math.max(0, nextDue - now)` then `setTimeout(() => requestHeartbeatNow({ reason: 'interval' }), delay)`. The upstream pattern is more robust for config changes and drift prevention.
- **Severity**: LOW — `setInterval` is adequate for single-agent desktop with fixed interval. The Parallx runner does re-read config on start, just not dynamically. If dynamic interval changes become needed, this should be refactored to setTimeout chaining.

### D2.5: Event queue (pushEvent)
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `pushEvent()` method
- **Upstream reference**: `src/infra/heartbeat-runner.ts` L562-570 (`peekSystemEventEntries`), `src/infra/system-events.ts`
- **Divergence**: Parallx uses in-memory array with push/drain. Upstream uses persistent session store entries peeked via `peekSystemEventEntries()` and filtered during preflight. Parallx also triggers immediate wake on first event (matching upstream's `exec-event` bypass behavior).
- **Evidence**: `pushEvent` sets `this._pendingEvents.push(event)` then calls `this._tick('system-event')` on first event — this mirrors upstream's pattern where pending system events trigger immediate heartbeat even if the interval hasn't elapsed. Desktop in-memory storage is appropriate since there's no need for cross-restart persistence.
- **Severity**: —

### D2.6: Duplicate suppression
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `pushEvent()` dedup + `pruneSuppressionCache()`
- **Upstream reference**: `src/infra/heartbeat-runner.ts` L798-833 (`isDuplicateMain` check)
- **Divergence**: **Different targets**: Parallx deduplicates at the **input event** level (same `type:payload` within 60s suppression window). Upstream deduplicates at the **output response** level (same `prevHeartbeatText` within 24h, stored in session store). These solve complementary problems. **Different windows**: 60s vs 24h.
- **Evidence**: Parallx: `const payloadKey = '${event.type}:${JSON.stringify(event.payload)}'` checked against `DUPLICATE_SUPPRESSION_WINDOW_MS = 60_000`. Upstream: `normalized.text.trim() === prevHeartbeatText.trim() && startedAt - prevHeartbeatAt < 24 * 60 * 60 * 1000`. Input-level dedup is useful but output-level dedup prevents "nagging" when the model repeats the same alert.
- **Severity**: LOW — Input-level dedup is valid and upstream doesn't have an equivalent (upstream dedup is output-level). For desktop, where the model runs locally and output is internal, 60s event dedup is sufficient. Output-level dedup could be added if heartbeat turns become visible to users.

### D2.7: Wake handler
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `wake()` method
- **Upstream reference**: `src/infra/heartbeat-wake.ts`, `setHeartbeatWakeHandler()` (L80+), `requestHeartbeatNow()` (L237+)
- **Divergence**: Parallx provides a direct `wake(reason)` method on the class instance. Upstream has a globally registered `HeartbeatWakeHandler` with reason coalescing, priority ordering, and separate `requestHeartbeatNow()` API. The upstream wake layer is a separate module (`heartbeat-wake.ts`) with `PendingWakeReason` queue and priority levels.
- **Evidence**: Parallx `wake('cron')` is used by `CronService.ts` L386-388 for `next-heartbeat` mode, matching the upstream contract where cron service calls `requestHeartbeatNow()`. The direct method avoids the complexity of global handler registration needed in multi-module gateway.
- **Severity**: —

### D2.8: Preflight gates
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `_tick()` method gates
- **Upstream reference**: `src/infra/heartbeat-runner.ts` L533-570 (six gates in `runHeartbeatOnce`)
- **Divergence**: Parallx implements 2 gates: (1) enabled check, (2) no-events check for interval ticks. Upstream has 6 gates: (1) `areHeartbeatsEnabled`, (2) `isHeartbeatEnabledForAgent`, (3) interval-ms check, (4) `isWithinActiveHours`, (5) queue-size/requests-in-flight, (6) HEARTBEAT.md content check via `resolveHeartbeatPreflight`.
- **Evidence**: Upstream gates not in Parallx: active hours (documented N/A — desktop always available), per-agent (N/A — single agent), HEARTBEAT.md file gate (workspace-level config, less relevant for desktop where config is in-app), requests-in-flight (could be useful but Parallx's no-events gate serves similar purpose of avoiding noise). The 2 implemented gates are the most essential for desktop.
- **Severity**: — (Documented desktop adaptations for missing gates)

### D2.9: Heartbeat execution error handling
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `_tick()` catch block
- **Upstream reference**: `src/infra/heartbeat-runner.ts` L1122-1147 (runOnce catch in scheduler), L929-955 (catch in runHeartbeatOnce)
- **Divergence**: Parallx re-queues events on failure (`this._pendingEvents.unshift(...events)`) and logs to console. Upstream emits structured telemetry events, formats error messages, and advances the schedule. Parallx's re-queue pattern is a desktop-appropriate addition — events aren't lost on transient failures.
- **Evidence**: The re-queue pattern ensures that if the executor fails (e.g., Ollama connection timeout), the events will be processed on the next tick. Upstream's `advanceAgentSchedule` after error means it won't retry the same events immediately, relying on the normal schedule. Both approaches keep the runner alive.
- **Severity**: —

### D2.10: Disposal & cleanup
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, `dispose()` method
- **Upstream reference**: `src/infra/heartbeat-runner.ts` L1186-1196 (`cleanup()`)
- **Divergence**: Parallx implements `IDisposable.dispose()`: sets `_disposed = true`, calls `stop()`, clears events array and suppression cache. Upstream: sets `stopped = true`, disposes wake handler via `disposeWakeHandler()`, clears timer. Upstream also supports `AbortSignal` for lifecycle management.
- **Evidence**: Both properly terminate the timer and mark the runner as stopped. Parallx additionally clears in-memory data structures (events, suppression cache) which is good practice for desktop memory management. Missing `AbortSignal` support is a minor gap but not needed for desktop lifecycle.
- **Severity**: —

### D2.11: Constants
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`, exported constants
- **Upstream reference**: `src/auto-reply/heartbeat.ts` (DEFAULT_HEARTBEAT_EVERY = "30m"), config schema
- **Divergence**: Parallx: 5min default, 30s min, 1h max, 60s dedup window. Upstream: 30min default (from `DEFAULT_HEARTBEAT_EVERY`), no min/max bounds (config-driven). Parallx's min/max clamping is a desktop guardrail not in upstream. The 60s dedup window vs upstream's 24h output dedup is a different mechanism (see D2.6).
- **Evidence**: `DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000` vs upstream's 30-minute default. The 5-minute default is reasonable for desktop (local Ollama, no token cost, lower latency), but differs from upstream's 30min which accounts for API cost and rate limits.
- **Severity**: LOW — Desktop-appropriate default. The 30s minimum and 1h maximum are sensible guardrails that upstream doesn't need because config validation handles bounds.

### D2.12: Test coverage
- **Classification**: ALIGNED
- **Parallx file**: `tests/unit/openclawHeartbeatRunner.test.ts` (20 tests)
- **Upstream reference**: `src/infra/heartbeat-runner.scheduler.test.ts`, `heartbeat-runner.returns-default-unset.test.ts`, `heartbeat-runner.model-override.test.ts`
- **Divergence**: None — tests cover all implemented surface areas. 20 tests across 8 describe blocks: construction (3), start/stop (2), pushEvent (4), wake (2), state tracking (2), error handling (1), pruneSuppressionCache (1), dispose (1), plus 4 constant validation tests.
- **Evidence**: Tests use `vi.useFakeTimers()` for deterministic timer testing, mock executor for isolation, and verify all key behaviors: state initialization, interval clamping, duplicate suppression, event queue lifecycle, error re-queue, disposal cleanup. All 20 tests pass.
- **Severity**: —

### D2.13: No anti-patterns
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawHeartbeatRunner.ts`
- **Upstream reference**: M41 anti-pattern checklist
- **Divergence**: None — implementation is clean.
- **Evidence**: No heuristic patchwork (pure logic, no regex string matching). No output repair (no post-processing of model output). No pre-classification (executor delegate handles model interaction). No eval-driven patchwork (tests verify real behavior, not synthetic scenarios). No preservation bias (implementation is fresh, derived from upstream contracts). Clear documentation of upstream references and Parallx adaptations in file header comments.
- **Severity**: —

---

## Critical Findings

No HIGH severity issues found. Three LOW severity misalignments:

1. **D2.4 Timer lifecycle** — `setInterval` vs `setTimeout` chaining. Not a correctness issue for desktop. Would matter if dynamic interval changes are needed.

2. **D2.6 Duplicate suppression** — Different dedup target (input events vs output responses) and window (60s vs 24h). Both are valid approaches for their context. Output-level dedup could be added later if heartbeat turns become user-visible.

3. **D2.11 Constants** — 5min vs 30min default interval. Desktop-appropriate but differs from upstream. The min/max clamping is a useful desktop guardrail.

---

## Recommendations

1. **No immediate action required.** The implementation is well-aligned with upstream contracts given the documented desktop adaptations.

2. **Consider setTimeout chaining** if dynamic config updates become a requirement (e.g., user changes heartbeat interval in settings while running).

3. **Consider output-level duplicate suppression** if heartbeat turns become visible to users in the chat panel (matching upstream's 24h `isDuplicateMain` pattern).

4. **Document constant choices** inline — the 5min default and 60s suppression window are deliberate desktop adaptations but the rationale should be in the code comments (currently partially documented).

---

## Methodology

- Read Parallx implementation end-to-end (259 lines).
- Fetched upstream OpenClaw `heartbeat-runner.ts` (~1200 lines), `heartbeat-wake.ts`, `heartbeat-reason.ts`, `heartbeat-summary.ts`, `heartbeat-active-hours.ts` from GitHub.
- Cross-referenced with `docs/Parallx_Milestone_46.md` D2 specification.
- Ran all 20 unit tests — all passing.
- Compared type contracts, control flow, error handling, and lifecycle management.
- Evaluated against M41 anti-pattern checklist.
