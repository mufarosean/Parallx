# M58-real Retrofit Tracker

**Status:** CLOSED ✅
**Closed:** 2026-04-22
**Parent milestone:** M58 (before master-merge)

---

## Scorecard

| ID | Task | Status | Tests | Notes |
|----|------|--------|-------|-------|
| W2-real.1 | Reason→behavior matrix in heartbeat executor | ✅ | 14 | `openclawHeartbeatExecutorRealTurn.test.ts` |
| W2-real.2 | Real turn via `createEphemeralSession` for system-event/wake/hook | ✅ | — | covered above |
| W2-real.3 | 30s per-key debounce on system-event | ✅ | 3 | same-path, diff-path, window-expire |
| W2-real.4 | `ORIGIN_HEARTBEAT` stamp + `heartbeatResult: true` metadata | ✅ | 2 | |
| W2-real.5 | Purge-on-finally + error card on failure | ✅ | 2 | |
| W2-real.6 | No-session clean skip | ✅ | 1 | |
| W4-real.1 | Real turn via substrate when `payload.agentTurn` set | ✅ | 8 | `openclawCronExecutorRealTurn.test.ts` |
| W4-real.2 | Thin path preserved when `agentTurn` unset | ✅ | 2 | |
| W4-real.3 | `contextLines` seeded into user message | ✅ | 1 | |
| W4-real.4 | Status flash before real turn completes | ✅ | 1 | |
| W4-real.5 | Error rethrown so CronService records failure | ✅ | 1 | |
| Task C | Integration scenarios (file-save, cron, no pollution, depth safety) | ✅ | 4 | `m58RealAutonomy.test.ts` |

**Test delta:** +26 new tests (14 + 8 + 4).
**Test baseline after:** 137 files / 2420 tests / 0 failures.
**Type-check:** `npx tsc --noEmit` clean.

---

## Files touched

| File | Change |
|------|--------|
| `src/openclaw/openclawHeartbeatExecutor.ts` | Rewrite — real-turn retrofit |
| `src/openclaw/openclawCronExecutor.ts` | Rewrite — real-turn retrofit |
| `src/built-in/chat/main.ts` | Wire `realTurnDeps` into both executor constructors |
| `tests/unit/openclawHeartbeatExecutorRealTurn.test.ts` | NEW — 14 tests |
| `tests/unit/openclawCronExecutorRealTurn.test.ts` | NEW — 8 tests |
| `tests/unit/m58RealAutonomy.test.ts` | NEW — 4 scenarios |
| `docs/ai/openclaw/M58_REAL_RETROFIT_AUDIT.md` | NEW |
| `docs/ai/openclaw/M58_REAL_RETROFIT_GAP_MAP.md` | NEW |
| `docs/ai/openclaw/M58_REAL_RETROFIT_TRACKER.md` | NEW |

## Files explicitly NOT touched

- `src/openclaw/openclawHeartbeatRunner.ts` — debounce fits cleanly inside the executor; runner API untouched.
- `src/openclaw/openclawCronService.ts` — existing `success`/`error` fields in `ICronRunResult` are adequate; executor rethrows on failure so the scheduler records it.
- `src/services/chatService.ts` / `chatSessionPersistence.ts` — W5 substrate used as-is.
- `src/services/surfaceRouterService.ts` — `sendWithOrigin` unchanged.
- `src/aiSettings/unifiedConfigTypes.ts` — heartbeat config unchanged (`enabled: false` default retained).

---

## Deferred / follow-on

1. `ICronRunResult` does not yet include a `realTurnRan` flag. Outcome (success/error) is recorded; whether a real turn fired is inferable from `job.payload.agentTurn`. Extend if the UI later needs richer history.
2. `IEphemeralSessionSeed` does not currently support prior-message pairs. Cron context lines are folded into the first user message under a "Previous chat context:" header. A future substrate widening (prior-messages field) + a 5-line executor change would move them to proper prior-message seeding.

## Safety invariants preserved

- `heartbeat.enabled = false` by default.
- System-event debounced 30s per event key.
- Origin tagging on every delivery (ORIGIN_HEARTBEAT / ORIGIN_CRON).
- Event sources do not read router history — feedback loops structurally impossible.
- Tool calls inside real turns still pass through the normal approval gates (pipeline reused verbatim).
- Ephemeral sessions purge in `finally` even on error.
- `getSessions()` filters ephemeral ids — no session-list pollution.
