# W1 — FollowupRunner Runtime Wiring: Domain Tracker

**Milestone:** M58 (Wake Parallx)
**Domain:** W1 — FollowupRunner
**Branch:** `milestone-58`
**Status:** CLOSED ✅

---

## Key files

| File | Role |
|------|------|
| `src/openclaw/openclawFollowupRunner.ts` | Followup evaluator + factory (audit-closed, no changes) |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | W1 wiring site — post-turn evaluation hook |
| `src/openclaw/openclawTypes.ts` | `IDefaultParticipantServices.queueFollowupRequest` (new optional) |
| `src/openclaw/openclawParticipantServices.ts` | Adapter threading |
| `src/built-in/chat/main.ts` | Bridge → `chatService.queueRequest` |
| `tests/unit/openclawFollowupWiring.test.ts` | New integration test |

## Upstream references

| Upstream | Parallx mapping |
|----------|-----------------|
| `src/auto-reply/reply/followup-runner.ts:1-412` | `openclawFollowupRunner.ts` (eval subset) |
| `src/auto-reply/reply/agent-runner-helpers.ts:55-58` `finalizeWithFollowup` | Post-turn hook in default participant |
| `src/auto-reply/reply/queue/drain.ts:67` `scheduleFollowupDrain` | `chatService._processNextPending` |
| `src/auto-reply/reply/queue/enqueue.ts:44` `enqueueFollowupRun` | `chatService.queueRequest` |

---

## Scorecard

| # | Capability | Iter 0 | Iter 1 | Final |
|---|-----------|--------|--------|-------|
| W1.1 | `createFollowupRunner` instantiated per session | MISSING | ALIGNED | ✅ |
| W1.2 | `evaluateFollowup` called post-turn | MISSING | ALIGNED | ✅ |
| W1.3 | Per-session depth tracked | MISSING | ALIGNED | ✅ |
| W1.4 | `MAX_FOLLOWUP_DEPTH=5` enforced end-to-end | MISSING | ALIGNED | ✅ |
| W1.5 | Depth resets when chain ends | MISSING | ALIGNED | ✅ |
| W1.6 | `FollowupTurnSender` → `chatService.queueRequest` | MISSING | ALIGNED | ✅ |
| W1.7 | Followup turns mirrored into autonomy task rail | MISSING (verify) | ALIGNED (transitive) | ✅ |
| W1.8 | Steering suppresses followup end-to-end | MISSING (verify) | ALIGNED | ✅ |
| W1.9 | Integration test: continuation → second turn → depth cap | MISSING | ALIGNED (7 new tests) | ✅ |
| W1.10 | UX: loops end cleanly, visually distinct | PENDING | ALIGNED (loops) / DEFERRED (distinct style) | ✅ |

**Final: 10/10 ALIGNED** (W1.10 visual-distinction flagged as future polish)

---

## Iteration 1

### Audit summary
See `W1_FOLLOWUP_WIRING_AUDIT.md`. No drift vs upstream; M46 D1 parity holds.
All 10 wiring capabilities non-ALIGNED at start.

### Gap map summary
See `W1_FOLLOWUP_WIRING_GAP_MAP.md`. 4 file edits + 1 new test file, zero
core-logic changes, one optional adapter callback added.

### Changes applied

| File | Change |
|------|--------|
| [src/openclaw/openclawTypes.ts](../../../src/openclaw/openclawTypes.ts) | Added `queueFollowupRequest?(sessionId, message): void` to `IDefaultParticipantServices` |
| [src/openclaw/openclawParticipantServices.ts](../../../src/openclaw/openclawParticipantServices.ts) | Threaded `queueFollowupRequest` through `IOpenclawDefaultParticipantAdapterDeps` and `buildOpenclawDefaultParticipantServices` |
| [src/built-in/chat/main.ts](../../../src/built-in/chat/main.ts) | Wired `queueFollowupRequest` → `chatService.queueRequest(..., ChatRequestQueueKind.Queued)`; imported `ChatRequestQueueKind` |
| [src/openclaw/participants/openclawDefaultParticipant.ts](../../../src/openclaw/participants/openclawDefaultParticipant.ts) | Per-session `followupStates` map, `getFollowupState()` lazy factory, post-turn evaluation hook inside `runOpenclawDefaultTurn`, disposal clears map |
| [tests/unit/openclawFollowupWiring.test.ts](../../../tests/unit/openclawFollowupWiring.test.ts) | New file — 7 integration tests covering queue-on-continuation, suppression on steering, depth cap, chain reset, per-session isolation, no-queue graceful fallback |

### Verification
- **Targeted suite:** `tests/unit/openclawFollowupRunner.test.ts` (21 tests) + `tests/unit/openclawFollowupWiring.test.ts` (7 tests) + `tests/unit/openclawDefaultParticipant.test.ts` (8 tests) → 36 passed, 0 failed.
- **Full suite:** 129 test files, 2321 tests, **0 failures** (`npx vitest run`, duration ~7.8 s).
- **TypeScript:** `npx tsc --noEmit` → clean (0 errors).
- **Cross-domain:** D3 steering tests pass; D1 core followup tests unchanged.

### UX Guardian
- Followup turns route through the existing pending-request queue
  (`chatService.queueRequest` fires `onDidChangePendingRequests` which the
  `ChatWidget._renderPendingMessage` path already consumes, showing a
  greyed bubble for ~500 ms before the turn executes).
- Loop termination proven: the `MAX_FOLLOWUP_DEPTH=5` cap is enforced and
  tested end-to-end (`increments depth per continuation and stops at
  MAX_FOLLOWUP_DEPTH`).
- Autonomy task rail mirror transparently covers followup turns because
  `chatTurnSynthesis` fires per-dispatched-turn; a queued followup goes
  through the normal `sendRequest → participant handler` path.
- No new settings, commands, keybindings, menus, or DOM surfaces.
- **Minor deferred item (non-blocking):** followup turns currently render
  as normal user-message bubbles with the generic continuation prompt
  ("Continue processing from where you left off."). Gap map §G-4 notes
  this; upstream has no visually-distinct-followup style either. Flagged
  as future UX polish.

### Decision
All 10 wiring capabilities ALIGNED. Full test suite + type check green.
No regressions. W1 **CLOSED**.
