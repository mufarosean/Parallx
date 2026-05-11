# M58-real Retrofit Audit — Heartbeat + Cron real-turn execution

**Scope:** Corrective scope added to M58 on 2026-04-22 (Parallx_Milestone_58.md §6.5 superseded).
**Task:** Replace thin (status-only) executors in W2 and W4 with real LLM turns via the W5 ephemeral-session substrate.
**Reference:** `openclawSubagentExecutor.ts` (W5 15/15 ALIGNED) is the proven local implementation.

---

## Capability scorecard

| Capability | Before | After | Notes |
|------------|--------|-------|-------|
| Heartbeat `interval` → status pulse | ALIGNED | ALIGNED | Unchanged — token-burn guard |
| Heartbeat `cron` → no-op | MISSING | ALIGNED | Cron is delegated; heartbeat now stays silent on this reason |
| Heartbeat `system-event` → real turn | HEURISTIC (status only) | ALIGNED | Real turn via `createEphemeralSession` |
| Heartbeat `system-event` → per-path debounce (30s) | MISSING | ALIGNED | New in-executor Map<key, timestamp> cache |
| Heartbeat `wake` → real turn | HEURISTIC (status only) | ALIGNED | Real turn |
| Heartbeat `hook` → real turn | HEURISTIC (status only) | ALIGNED | Real turn |
| Heartbeat result card on chat surface | MISSING | ALIGNED | `metadata.heartbeatResult = true` |
| Heartbeat origin stamp on deliveries | ALIGNED | ALIGNED | ORIGIN_HEARTBEAT retained |
| Heartbeat no-session fallback | MISSING | ALIGNED | Skip real turn, still flash status |
| Heartbeat error → cleanly delivered | MISSING | ALIGNED | Error card + `metadata.error = true` |
| Heartbeat purge-on-finally | MISSING | ALIGNED | `finally { purge }` mirrors subagent executor |
| Cron `agentTurn` set → real turn | MISSING | ALIGNED | New path |
| Cron `agentTurn` unset → thin path | ALIGNED | ALIGNED | Unchanged |
| Cron `contextLines` seeded into turn | MISSING | ALIGNED | Folded into user message under "Previous chat context:" |
| Cron result card on chat surface | MISSING | ALIGNED | `metadata.cronResult = true` |
| Cron origin stamp | ALIGNED | ALIGNED | ORIGIN_CRON retained |
| Cron error → `cron_runs` records failure | MISSING | ALIGNED | Executor rethrows after delivering error card |
| Cron status flash at fire time | ALIGNED | ALIGNED | Fires BEFORE real turn completes (early visibility) |
| No session pollution | N/A (thin never created sessions) | ALIGNED | `getSessions()` filters ephemeral ids; purge in finally |
| Depth safety (no heartbeat feedback loops) | ALIGNED | ALIGNED | Event sources don't read router history — structural |

**Net:** 10 new ALIGNED capabilities, 10 unchanged, 0 regressions.

---

## Before (ship-thin state, pre-2026-04-22)

`openclawHeartbeatExecutor.ts`
- Signature: `createHeartbeatTurnExecutor(router, getConfig): HeartbeatTurnExecutor`
- Behavior: on every allowed reason, flash `⏺ heartbeat · <reason>` to status surface then reset to idle. No LLM call.

`openclawCronExecutor.ts`
- Signature: `createCronTurnExecutor(router): CronTurnExecutor`
- Behavior: on every fire, flash status + info notification + reset. `payload.agentTurn` preserved in metadata only, never executed.

---

## After (M58-real, this patch)

`openclawHeartbeatExecutor.ts`
- New optional param `realTurnDeps: IHeartbeatRealTurnDeps` with `chatService` + `getParentSessionId` + `debounceMs` + `now`.
- Reason matrix enforced inside executor. `interval` → status-only. `cron` → no-op. `system-event` / `wake` / `hook` → real turn through `createEphemeralSession` + `sendRequest` + `getSession` + `purgeEphemeralSession`.
- Per-event-key debounce for `system-event` (30s default).
- Delivers final text to `SURFACE_CHAT` with `metadata.heartbeatResult = true` stamped with `ORIGIN_HEARTBEAT`.
- `finally { purge }` mirrors subagent executor.
- Fallback (no deps / no parent) keeps status-only behavior.

`openclawCronExecutor.ts`
- New optional param `realTurnDeps: ICronRealTurnDeps` with `chatService` + `getParentSessionId`.
- Status flash ALWAYS fires first (early visibility).
- If `payload.agentTurn` set AND deps available AND parent session exists: real turn, context lines folded into user message, result card to `SURFACE_CHAT` with `metadata.cronResult = true`, rethrow on error so CronService records failure.
- Otherwise: legacy status flash + info notification + idle reset.

`src/built-in/chat/main.ts`
- Heartbeat + cron executors now constructed with `realTurnDeps` wired to the live ChatService ephemeral substrate + `_activeWidget?.getSession()?.id` as parent resolver.

---

## Pressure points resolved

1. **Session resolution for cron/heartbeat result delivery.** Required a `getParentSessionId` closure. Picked the same resolution subagent uses: the active chat widget's session id. When no widget is active, executors skip the real turn (heartbeat) or fall back to thin notification (cron). Debug log noted, no error raised.
2. **Seeding prior chat context into an ephemeral session.** `IEphemeralSessionSeed` does not support prior messages. Cron real turn folds `contextLines` into the first user message under a "Previous chat context:" header. The intent is preserved; future substrate widening can move this into proper prior-message seeding without executor API changes.
3. **Debounce location.** Kept inside the heartbeat executor (closure-local `Map<key, timestamp>`) so the runner is unaware. Placing it on the runner would have required touching `openclawHeartbeatRunner.ts` which is outside the approved scope.

## Deferred / follow-on items

1. `ICronRunResult` does not currently distinguish real-turn vs thin-path outcomes — the spec asked for "whether a real turn ran" in `cron_runs` history. Extending `ICronRunResult` would require editing `openclawCronService.ts`, which is not in M58-real's approved core file list. Success/error is recorded correctly either way; the distinction is derivable from `job.payload.agentTurn`. Flag for future milestone if UI needs richer history.
2. Heartbeat real turn on `system-event` currently uses the executor's own clock for debounce. In production this is `Date.now()`; tests inject a virtual clock via `realTurnDeps.now`.
