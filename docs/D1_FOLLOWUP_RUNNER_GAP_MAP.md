# Change Plan: D1 — Followup Runner

**Date:** 2026-03-28
**Input:** D1_FOLLOWUP_RUNNER_AUDIT.md (Iteration 1)
**Capabilities addressed:** D1.7 (HIGH), D1.4 (LOW), D1.2 (MEDIUM)
**Capabilities skipped:** D1.1, D1.3, D1.5, D1.6, D1.8 (all ALIGNED)

---

## Change Order & Dependencies

```
D1.7a (add continuationRequested to attempt result type)
  → D1.7b (propagate through turn result type)
    → D1.7c (add positive path in evaluateFollowup)
      → D1.7d (add positive-path tests)
        → D1.4 (wire FOLLOWUP_DELAY_MS into runner closure)
          → D1.2 (document factory scope adaptation)
```

D1.7a-b are type changes that D1.7c depends on. D1.4 depends on D1.7c
because the delay only matters once followups can actually fire. D1.2 is
documentation-only and goes last.

---

## D1.7a: Add `continuationRequested` to `IOpenclawAttemptResult`

- **Status**: MISSING → ALIGNED
- **Upstream**: `agent-runner.ts:538` — `finalizeWithFollowup` is called unconditionally after every turn. The decision to drain the followup queue is structural, not heuristic. The signal that work remains comes from the queue having items (`enqueueFollowupRun` at `agent-runner.ts:236-244`). In upstream's L4 (`attempt.ts`), the Pi Agent runtime's tool loop runs until the model stops requesting tools or hits `MAX_RUN_LOOP_ITERATIONS` (`run.ts:215+`). When the loop caps out, the turn ends with work potentially unfinished — this is the structural equivalent of "queue has items".
- **Parallx file**: `src/openclaw/openclawAttempt.ts`
- **Action**:
  1. Add `readonly continuationRequested: boolean` to `IOpenclawAttemptResult` (after `toolCallCount`, line ~130)
  2. In `executeOpenclawAttempt`, track whether the tool loop exited because the model was still requesting tools. Currently the `while` loop at line ~248 exits in 3 ways:
     - `toolCalls.length === 0` → model naturally completed → `continuationRequested = false`
     - `iterations >= maxToolIterations + 1` → iteration cap reached → `continuationRequested = true`
     - `loopBlocked === true` → safety stopped the loop → `continuationRequested = false` (safety block is intentional)
  3. Add a `let lastHadToolCalls = false` tracker before the loop. Set it `true` after tool calls are processed, reset to `false` when `toolCalls.length === 0`. After the loop, `continuationRequested = lastHadToolCalls && !loopBlocked`.
  4. Include `continuationRequested` in the return object (line ~387).
- **Remove**: Nothing — this is a new field.
- **Verify**:
  - TypeScript compiles (0 errors)
  - Existing attempt tests still pass (the field defaults won't break anything since it's a new `boolean` on a new return path)
  - `IOpenclawAttemptResult` now carries the signal downstream
- **Risk**: LOW — additive change to a result type. No existing code reads this field yet.

---

## D1.7b: Propagate `continuationRequested` through `IOpenclawTurnResult`

- **Status**: MISSING → ALIGNED
- **Upstream**: `agent-runner.ts:538-563` — after `runAgentTurnWithFallback` returns, L1 calls `finalizeWithFollowup(runOutcome.payload, queueKey, runFollowupTurn)`. The run outcome carries the full turn result including whether tools were used. In Parallx, `IOpenclawTurnResult` is the equivalent carrier.
- **Parallx file**: `src/openclaw/openclawTurnRunner.ts`
- **Action**:
  1. Add `readonly continuationRequested: boolean` to `IOpenclawTurnResult` (after `followupDepth`, line ~75)
  2. In the success return path (`runOpenclawTurn`, line ~178-186), the result already spreads `...result` from `IOpenclawAttemptResult`, which will include `continuationRequested` after D1.7a. Verify the spread picks it up — it should since `IOpenclawTurnResult` accepts all `IOpenclawAttemptResult` fields.
  3. In the cancellation return path (line ~252-264), set `continuationRequested: false` (cancelled turns never continue).
- **Remove**: Nothing — additive.
- **Verify**:
  - TypeScript compiles
  - `IOpenclawTurnResult` now has `continuationRequested`
  - Both return paths set the field
- **Risk**: LOW — cross-file type propagation. Tests that create mock `IOpenclawTurnResult` objects will need `continuationRequested` added to helpers (see D1.7d).

---

## D1.7c: Add positive path in `evaluateFollowup()`

- **Status**: MISSING → ALIGNED
- **Upstream**: `agent-runner-helpers.ts:55-58` — `finalizeWithFollowup` always calls `scheduleFollowupDrain(queueKey, runFollowupTurn)`, which processes queued work after each turn. `queue/drain.ts:152-180` — `scheduleFollowupDrain` defers drain with debounce. The pattern: every completed turn triggers a drain attempt; if there's queued work, it runs.

  Parallx adaptation: instead of a persistent queue, the turn result itself carries the continuation signal (`continuationRequested`). After the suppression gates pass, check this field. This maps to upstream's "drain finds items in queue" being equivalent to "turn result says work remains".
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts`
- **Action**: Replace the terminal `return` at lines 113-118:

  **Old (lines 113-118):**
  ```typescript
  // No followup signals detected — model completed normally
  return { shouldFollowup: false, reason: 'turn-complete' };
  ```

  **New:**
  ```typescript
  // Signal 1: Tool loop was capped — model was still requesting tools when
  // the iteration limit stopped execution.
  // Upstream: finalizeWithFollowup (agent-runner-helpers.ts:55-58) always
  // schedules a drain after each turn. If the queue has items (from
  // enqueueFollowupRun at agent-runner.ts:236-244), the drain executes them.
  // Parallx adaptation: continuationRequested on the turn result is the
  // single-user equivalent of "queue has pending items".
  if (turnResult.continuationRequested) {
    return {
      shouldFollowup: true,
      message: 'Continue processing from where you left off.',
      reason: 'tool-continuation',
    };
  }

  // No followup signals detected — model completed normally
  return { shouldFollowup: false, reason: 'turn-complete' };
  ```
- **Remove**: The dead `return { shouldFollowup: false, reason: 'turn-complete' }` as the ONLY exit path is the anti-pattern. The new code adds a positive path before it, making the dead-code path an intentional "model naturally finished" path instead.
- **Verify**:
  - `evaluateFollowup` now has a `shouldFollowup: true` path
  - Gate order preserved: disabled → steer → depth → empty → **continuation signal** → turn-complete
  - Existing gate tests unchanged (they test suppression, not signals)
  - New tests verify the positive path (see D1.7d)
- **Risk**: MEDIUM — this activates the followup runner. If `continuationRequested` is incorrectly set to `true` on normal turns, followup spam could occur. Mitigated by:
  - D1.7a's precise tracking (only `true` when iteration cap reached AND model was still requesting tools)
  - Gate 3 (depth limit) caps infinite chains
  - Gate 1 (`followupEnabled`) provides a kill switch

---

## D1.7d: Add positive-path tests

- **Status**: Test gap (coverage existed only for suppression)
- **Upstream**: Test coverage for both paths is standard practice.
- **Parallx file**: `tests/unit/openclawFollowupRunner.test.ts`
- **Action**:
  1. Update `createTurnResult` helper to include `continuationRequested: false` in the default (line ~17 area)
  2. Add test: `'triggers followup when continuationRequested is true'` — create turn result with `continuationRequested: true`, assert `shouldFollowup === true`, `reason === 'tool-continuation'`, `message` is defined
  3. Add test: `'does not trigger followup when continuationRequested is false'` — verify normal turns still return `turn-complete`
  4. Add test: `'gates still suppress even with continuationRequested true'` — verify `followupEnabled: false` + `continuationRequested: true` still returns `followup-disabled`
  5. Add test: `'depth limit suppresses even with continuationRequested'` — verify gate 3 still fires
  6. Add runner test: `'runner calls sender when followup is triggered'` — create runner, pass turn result with `continuationRequested: true`, assert sender was called with correct `IOpenclawFollowupRun`
  7. Update gate order test (line ~101) to include `continuationRequested: true` and verify disabled still takes precedence
- **Remove**: Nothing — additive test expansion.
- **Verify**: All tests pass. Coverage includes both positive and negative paths.
- **Risk**: LOW — test-only changes.

---

## D1.4: Wire `FOLLOWUP_DELAY_MS` into the runner closure

- **Status**: MISSING → ALIGNED
- **Upstream**: `queue/state.ts:18` — `DEFAULT_QUEUE_DEBOUNCE_MS = 1000`. `queue/drain.ts:152-180` — `scheduleFollowupDrain` uses `waitForQueueDebounce` which delays by `queue.debounceMs` before pulling the next item. This prevents rapid-fire followup turns from overwhelming the model or causing race conditions.

  Parallx adaptation: since there's no queue drain with built-in debounce, apply `FOLLOWUP_DELAY_MS` as an explicit delay in the runner closure before calling the sender. This is the single-user desktop equivalent of the queue debounce.
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts`
- **Action**: In the `createFollowupRunner` closure (lines ~156-175), add a delay before calling `sender`:

  **Old (lines ~163-170):**
  ```typescript
  if (evaluation.shouldFollowup && evaluation.message) {
    const followupRun: IOpenclawFollowupRun = {
      message: evaluation.message,
      reason: evaluation.reason,
      depth: currentDepth + 1,
    };

    await sender(followupRun);
  }
  ```

  **New:**
  ```typescript
  if (evaluation.shouldFollowup && evaluation.message) {
    // Upstream: queue debounce via DEFAULT_QUEUE_DEBOUNCE_MS (queue/state.ts:18)
    // and waitForQueueDebounce in drain.ts prevents rapid-fire followup turns.
    // Parallx: explicit delay since we have no queue drain mechanism.
    await new Promise<void>(resolve => setTimeout(resolve, FOLLOWUP_DELAY_MS));

    const followupRun: IOpenclawFollowupRun = {
      message: evaluation.message,
      reason: evaluation.reason,
      depth: currentDepth + 1,
    };

    await sender(followupRun);
  }
  ```
- **Remove**: The dead constant illusion is resolved — `FOLLOWUP_DELAY_MS` now has a runtime consumer.
- **Verify**:
  - `FOLLOWUP_DELAY_MS` grep shows usage in both declaration and the runner closure
  - Existing constant-range test still passes
  - Runner tests with delay: use `vi.useFakeTimers()` to verify the delay fires
- **Risk**: LOW — 500ms delay between followup turns is conservative. Won't affect user-initiated turns (those don't go through the followup runner). The `setTimeout` runs in the async closure, so it won't block the event loop.

---

## D1.2: Document the factory scope adaptation

- **Status**: MISALIGNED → ALIGNED (documentation only)
- **Upstream**: `followup-runner.ts:42-412` — `createFollowupRunner` returns `(queued: FollowupRun) => Promise<void>`. The factory captures full runtime context (typing controller, session store, store path, default model, agentCfgContextTokens) and the closure internally calls `runWithModelFallback` → `runEmbeddedPiAgent` to execute the followup turn. It handles payload sanitization, media filtering, reply routing, compaction tracking, usage persistence, typing cleanup, and session refresh — a complete turn execution lifecycle (~370 lines of logic).

  Parallx adaptation: the factory takes a `FollowupTurnSender` delegate and returns `(turnResult, currentDepth) => Promise<IFollowupEvaluation>`. The closure only evaluates and dispatches. Turn execution is owned by the chat service, not the runner. This is valid for VS Code architecture where the participant runtime owns turn execution, but needs explicit documentation.
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts`
- **Action**: Replace the existing JSDoc on `createFollowupRunner` (lines ~126-142) with:

  ```typescript
  /**
   * Create a followup runner that evaluates and dispatches followup turns.
   *
   * Upstream: createFollowupRunner (followup-runner.ts:42-412)
   * Upstream factory captures full runtime context and self-contains the
   * entire followup turn execution lifecycle (~370 lines): model call with
   * fallback, payload sanitization, reply routing, compaction tracking,
   * usage persistence, typing cleanup, and session refresh.
   *
   * Parallx adaptation — evaluation + dispatch, not execution:
   * The Parallx factory returns an evaluator, not an executor. Turn execution
   * is delegated to the platform via FollowupTurnSender, which maps to
   * chatService.sendRequest() or chatService.queueRequest(). This separation
   * is intentional for VS Code architecture where the participant runtime owns
   * turn execution. The runner owns the decision (should we follow up?) and the
   * caller owns the execution (how to send the turn).
   *
   * The upstream pattern inlines execution because it owns the full gateway
   * stack (typing, routing, session persistence). Parallx delegates these to
   * the VS Code chat participant API.
   *
   * @param sender Delegate that sends the followup turn to the chat service
   * @param options Configuration for followup behavior
   * @returns Async function that evaluates and optionally queues a followup
   */
  ```
- **Remove**: The existing terse JSDoc that doesn't explain the structural difference.
- **Verify**: No runtime change. Read the comment and confirm it accurately describes the adaptation.
- **Risk**: NONE — documentation only.

---

## Cross-File Impact Summary

| File | Changes | Type |
|------|---------|------|
| `src/openclaw/openclawAttempt.ts` | Add `continuationRequested` to `IOpenclawAttemptResult`, track in loop, include in return | Type + logic |
| `src/openclaw/openclawTurnRunner.ts` | Add `continuationRequested` to `IOpenclawTurnResult`, set in cancellation path | Type |
| `src/openclaw/openclawFollowupRunner.ts` | Add positive path in `evaluateFollowup`, wire delay, update factory JSDoc | Logic + docs |
| `tests/unit/openclawFollowupRunner.test.ts` | Update helper, add positive-path tests, add runner sender tests | Tests |

### Files NOT modified (checked for impact):
- `src/openclaw/openclawAttempt.ts` types are consumed only by `openclawTurnRunner.ts` (which we update)
- `IOpenclawTurnResult` is consumed by `openclawFollowupRunner.ts` (which we update) and by test files (which we update)
- No other files import from `openclawFollowupRunner.ts` beyond the test file — the runner is currently not wired into the chat service (that's a separate future integration task)

---

## Before-Writing Checklist

| # | Check | D1.7 | D1.4 | D1.2 |
|---|-------|------|------|------|
| 1 | Upstream citation provided? | Yes — `agent-runner.ts:538-563`, `agent-runner-helpers.ts:55-58`, `run.ts:215+` (MAX_RUN_LOOP_ITERATIONS), `queue/state.ts:18`, `queue/drain.ts:152-180` | Yes — `queue/state.ts:18` (DEFAULT_QUEUE_DEBOUNCE_MS), `queue/drain.ts:152-180` (scheduleFollowupDrain) | Yes — `followup-runner.ts:42-412` |
| 2 | Read Parallx file before proposing? | Yes — all 3 source files read end-to-end | Yes — runner closure read | Yes — factory JSDoc read |
| 3 | Code to remove identified? | Yes — dead "always false" exit path replaced with signal check before it | Yes — dead constant becomes live | Yes — terse JSDoc replaced |
| 4 | No heuristic/regex/output repair? | Yes — `continuationRequested` is a structural signal from the tool loop, not text analysis | N/A | N/A |
| 5 | No pre-classification? | Yes — no keyword detection | N/A | N/A |
| 6 | Changes ordered by dependency? | Yes — type → propagation → logic → tests | Depends on D1.7c | Standalone |
| 7 | Cross-file impacts considered? | Yes — 4 files, all listed | 1 file | 1 file |
| 8 | Platform adaptation documented? | Yes — queue drain → turn result signal noted in comments | Yes — queue debounce → explicit delay noted | Yes — full adaptation rationale in JSDoc |

---

## Upstream Citation Index

| Citation | Location | Used by |
|----------|----------|---------|
| `finalizeWithFollowup` | `agent-runner-helpers.ts:55-58` | D1.7c — positive path rationale |
| `scheduleFollowupDrain` | `queue/drain.ts:152-180` | D1.7c, D1.4 — debounce pattern |
| `DEFAULT_QUEUE_DEBOUNCE_MS` | `queue/state.ts:18` (1000ms) | D1.4 — delay justification |
| `enqueueFollowupRun` | `agent-runner.ts:236-244` | D1.7c — queue trigger pattern |
| `MAX_RUN_LOOP_ITERATIONS` | `run.ts:215+` (min 32, max 160) | D1.7a — iteration cap pattern |
| `createFollowupRunner` factory | `followup-runner.ts:42-412` | D1.2 — scope comparison |
| `runWithModelFallback` in runner | `followup-runner.ts:174-190` | D1.2 — execution lifecycle |

---

## Uncertainty Flags

None. All upstream patterns are documented in local reference docs or verified
via direct GitHub source reading. No NEEDS_UPSTREAM_VERIFICATION items.
