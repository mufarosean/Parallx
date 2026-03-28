# Audit Report: D1 — Followup Runner

**Date:** 2026-03-28
**Auditor:** AI Parity Auditor
**Parallx file:** `src/openclaw/openclawFollowupRunner.ts` (153 lines)
**Upstream file:** `src/auto-reply/reply/followup-runner.ts` (412 lines)
**Test file:** `tests/unit/openclawFollowupRunner.test.ts` (15 tests, all passing)

---

## Summary

| Metric | Count |
|--------|-------|
| Capabilities audited | 8 |
| **ALIGNED** | 4 |
| **MISALIGNED** | 2 |
| **MISSING** | 2 |
| **HEURISTIC** | 0 |
| **DEFERRED** | 0 |

---

## Per-Capability Findings

### D1.1: `evaluateFollowup()` gate chain

- **Classification**: **ALIGNED**
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts` lines 88-118
- **Upstream reference**: `followup-runner.ts` — `shouldFollowup` evaluation via L1 step 6, queue policy gates
- **Divergence**: None significant. Parallx implements an explicit ordered gate chain: disabled → steer → depth → empty → signals. Upstream gates are distributed across `agent-runner.ts` (steer check at L203, queue policy at L210-244) and queue settings, but the logic is functionally equivalent. Parallx consolidates these into one function which is cleaner for a single-user desktop app.
- **Evidence**: Gate order tested in `openclawFollowupRunner.test.ts` — "gate evaluation order: disabled > steer > depth > empty > signals" passes.
- **Severity**: N/A (aligned)

### D1.2: `createFollowupRunner()` factory pattern

- **Classification**: **MISALIGNED**
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts` lines 133-153
- **Upstream reference**: `followup-runner.ts:42-412` — `createFollowupRunner(params)` returns `(queued: FollowupRun) => Promise<void>`
- **Divergence**: Significant structural difference:
  - **Upstream**: Factory captures runtime context (typing controller, session store, store path, default model, agentCfgContextTokens) in closure. Returns `(queued: FollowupRun) => Promise<void>`. The closure internally calls `runWithModelFallback` → `runEmbeddedPiAgent` to execute the followup turn. It handles payload sanitization, media filtering, reply routing, compaction tracking, usage persistence, typing cleanup, and session refresh — a complete turn execution lifecycle (~370 lines of logic).
  - **Parallx**: Factory takes a `FollowupTurnSender` delegate and options. Returns `(turnResult, currentDepth) => Promise<IFollowupEvaluation>`. The closure only evaluates whether to follow up and optionally calls the sender. It does NOT execute the turn itself — it is purely an evaluation + dispatch function (~20 lines of logic).
  - The Parallx factory is structurally a "should we follow up?" evaluator, not a "execute the followup turn" runner. The upstream factory wraps the entire followup turn execution lifecycle.
- **Evidence**:
  ```typescript
  // Upstream signature (followup-runner.ts:42-53)
  export function createFollowupRunner(params: {
    opts?: GetReplyOptions;
    typing: TypingController;
    typingMode: TypingMode;
    sessionEntry?: SessionEntry;
    sessionStore?: Record<string, SessionEntry>;
    sessionKey?: string;
    storePath?: string;
    defaultModel: string;
    agentCfgContextTokens?: number;
  }): (queued: FollowupRun) => Promise<void>

  // Parallx signature (openclawFollowupRunner.ts:133-146)
  export function createFollowupRunner(
    sender: FollowupTurnSender,
    options?: { maxDepth?: number; followupEnabled?: boolean },
  ): (turnResult: IOpenclawTurnResult, currentDepth: number) => Promise<IFollowupEvaluation>
  ```
- **Severity**: **MEDIUM** — The factory exists and the pattern is correct (factory returning closure), but the scope mismatch means the full turn execution lifecycle is not encapsulated in the runner. This is acceptable if the caller (chat service) handles execution, but it diverges from upstream's self-contained runner pattern.

### D1.3: `MAX_FOLLOWUP_DEPTH` depth limit enforcement

- **Classification**: **ALIGNED**
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts` line 31 (`MAX_FOLLOWUP_DEPTH = 5`)
- **Upstream reference**: `followup-runner.ts` — depth is implicitly bounded by queue processing capacity; `run.ts:879` has `MAX_RUN_LOOP_ITERATIONS` as upper bound
- **Divergence**: Parallx uses an explicit `MAX_FOLLOWUP_DEPTH = 5` constant. Upstream doesn't have a named max depth constant — depth is bounded by queue cap and iteration limits instead. Parallx's explicit limit is a reasonable adaptation for a single-user desktop app where unbounded followup chains would freeze the UI.
- **Evidence**: Tested — "suppresses followup when depth limit is reached" passes. Gate correctly fires when `currentDepth >= maxDepth`.
- **Severity**: N/A (aligned — explicit constant is a justified Parallx adaptation)

### D1.4: `FOLLOWUP_DELAY_MS` between followup turns

- **Classification**: **MISSING**
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts` line 37 (`FOLLOWUP_DELAY_MS = 500`)
- **Upstream reference**: `followup-runner.ts` — natural delay from queue debounce (`DEFAULT_QUEUE_DEBOUNCE_MS = 1000` in `queue/state.ts:18`) + drain processing
- **Divergence**: The constant is **declared** but **never used**. No code in `openclawFollowupRunner.ts`, `openclawTurnRunner.ts`, or any caller applies a delay between consecutive followup turns. The constant is exported and tested for range validity (`FOLLOWUP_DELAY_MS >= 100 && <= 5000`) but has no behavioral effect.
  - Upstream achieves this via queue debounce and drain scheduling in `queue/drain.ts` (`waitForQueueDebounce`).
  - Parallx has no queue drain mechanism — followup turns are dispatched immediately by the sender delegate.
- **Evidence**: `FOLLOWUP_DELAY_MS` appears only in the constant declaration (line 37) and the constant-range test. `grep` for `FOLLOWUP_DELAY_MS` shows no usage outside declaration and tests.
- **Severity**: **LOW** — For a single-user desktop app, rapid followup dispatch is acceptable. But the dead constant creates false confidence in test coverage.

### D1.5: `isFollowupTurn` and `followupDepth` propagation in turn context and result

- **Classification**: **ALIGNED**
- **Parallx file**: `src/openclaw/openclawAttempt.ts` lines 89-94 (`IOpenclawTurnContext` fields) + `src/openclaw/openclawTurnRunner.ts` lines 63-67 (`IOpenclawTurnResult` fields) + lines 100-102 (reading from context) + lines 183-185 (result propagation)
- **Upstream reference**: `agent-runner.ts:67-97` — `followupRun` parameter in `runReplyAgent`; `followup-runner.ts` — followup metadata flows through the entire L1→L4 chain
- **Divergence**: None. Both `isFollowupTurn` and `followupDepth` are:
  1. Declared on `IOpenclawTurnContext` (attempt.ts:89-94)
  2. Read at the start of `runOpenclawTurn` (turnRunner.ts:100-102)
  3. Propagated to `IOpenclawTurnResult` on both success path (turnRunner.ts:183-185) and cancellation path (turnRunner.ts:261-263)
- **Evidence**:
  ```typescript
  // IOpenclawTurnContext (openclawAttempt.ts:89-94)
  readonly isFollowupTurn?: boolean;
  readonly followupDepth?: number;

  // IOpenclawTurnResult (openclawTurnRunner.ts:63-67)
  readonly isFollowupTurn: boolean;
  readonly followupDepth: number;

  // Propagation in both return paths (turnRunner.ts:183-185, 261-263)
  isFollowupTurn: isFollowup,
  followupDepth,
  ```
- **Severity**: N/A (aligned)

### D1.6: `FollowupTurnSender` delegate pattern for executing followup turns

- **Classification**: **ALIGNED**
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts` line 62 (`FollowupTurnSender` type)
- **Upstream reference**: `followup-runner.ts:42-412` — the runner IS the executor; `agent-runner.ts:219-228` — the factory is created with runtime context; `agent-runner-helpers.ts:55-58` — `finalizeWithFollowup` schedules the drain
- **Divergence**: Parallx separates evaluation from execution via a `FollowupTurnSender` delegate type. Upstream inlines execution inside the factory closure. The Parallx approach is actually cleaner for a platform-integrated model where the chat service owns turn execution:
  ```typescript
  // Parallx: delegate separates concerns
  export type FollowupTurnSender = (followup: IOpenclawFollowupRun) => Promise<void>;
  ```
  The chat service provides the sender that maps to `chatService.sendRequest()` or `chatService.queueRequest()`. This is a valid Parallx adaptation — the platform handles turn execution, the runner handles evaluation.
- **Evidence**: Type declaration at line 62, used as first parameter of `createFollowupRunner` at line 134.
- **Severity**: N/A (aligned — clean adaptation)

### D1.7: Tool signal detection for triggering followups

- **Classification**: **MISSING**
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts` lines 113-118
- **Upstream reference**: `agent-runner.ts` L1 step 6 — tool results are checked for continuation signals; `followup-runner.ts:139-156` — preflightCompaction, model fallback decisions
- **Divergence**: `evaluateFollowup()` has NO signal detection logic. After passing the 4 gates (disabled, steer, depth, empty), it always returns `{ shouldFollowup: false, reason: 'turn-complete' }`. There is no mechanism to detect:
  - Tool results requesting continuation (e.g., a tool that says "I need to do more work")
  - Model responses with continuation markers
  - Incomplete task signals from the execution pipeline
  The function is a pure suppression gate — it can only say "no", never "yes". This means followup turns can never actually be triggered.
- **Evidence**:
  ```typescript
  // evaluateFollowup always returns false after gates (lines 113-118)
  // No followup signals detected — model completed normally
  return { shouldFollowup: false, reason: 'turn-complete' };
  ```
  No `shouldFollowup: true` path exists in the entire file.
- **Severity**: **HIGH** — Without signal detection, the followup runner is structurally inert. The factory, evaluation, depth tracking, and delay constant are all dead code because no turn will ever trigger a followup.

### D1.8: Followup reason tracking

- **Classification**: **ALIGNED**
- **Parallx file**: `src/openclaw/openclawFollowupRunner.ts` — `IOpenclawFollowupRun.reason` (line 53), `IFollowupEvaluation.reason` (line 71)
- **Upstream reference**: `queue/types.ts:23-52` — `FollowupRun` type has metadata fields; various test assertions check reasons
- **Divergence**: Parallx tracks descriptive reasons for followup decisions: `'followup-disabled'`, `'steer-suppressed'`, `'depth-limit-reached'`, `'empty-response'`, `'turn-complete'`. This matches upstream's pattern of tracking why a followup was or wasn't triggered. Upstream encodes the reason in the queue routing decision (steer vs collect vs interrupt) rather than as a string field, but the intent is equivalent.
- **Evidence**: All gates set explicit reason strings. `IOpenclawFollowupRun.reason` (line 53) carries the reason into the queued request.
- **Severity**: N/A (aligned)

---

## Critical Findings (M41 Anti-Patterns)

### 1. Structurally Inert Runner (D1.7 — HIGH)

The `evaluateFollowup()` function has no path that returns `shouldFollowup: true`. The entire followup runner module is dead code — types are defined, gates are implemented, tests pass, but **no followup turn can ever be triggered**.

This is the **eval-driven patchwork** anti-pattern: tests pass because they test gate suppression behavior (which works), but the positive path (a followup is actually triggered) is completely missing. Test coverage creates false confidence.

### 2. Dead Constant (D1.4 — LOW)

`FOLLOWUP_DELAY_MS = 500` is declared, exported, and tested for range validity, but never consumed by any runtime code. This is a documentation lie — it suggests timing behavior that doesn't exist.

### 3. Factory Scope Mismatch (D1.2 — MEDIUM)

The Parallx factory is an evaluation function, not a turn executor. Upstream's factory wraps the entire lifecycle (model call, retry, payload sanitization, routing, usage tracking, typing cleanup). Parallx delegates execution to the caller via `FollowupTurnSender`. This isn't wrong — it's a valid platform adaptation — but it means the runner doesn't own execution lifecycle, and the caller must handle all of that correctly.

---

## Recommendations

### Immediate (before closing D1)

1. **D1.7 — Add tool signal detection**: Implement at least one positive path in `evaluateFollowup()`. Minimum viable: check `turnResult.toolCallCount > 0` combined with a model-provided continuation signal (e.g., a structured output field or specific tool result). Without this, the entire module is dead code.

2. **D1.4 — Either use or remove `FOLLOWUP_DELAY_MS`**: If delay between followup turns is desired, add a `setTimeout(FOLLOWUP_DELAY_MS)` in the runner or sender. If not, remove the constant to avoid dead code.

### Next iteration

3. **D1.2 — Document the factory scope decision**: Add a comment in `openclawFollowupRunner.ts` explicitly noting that Parallx delegates turn execution to the platform chat service via `FollowupTurnSender`, unlike upstream which self-contains execution. This is a valid adaptation but should be documented as such.

4. **Add positive-path test coverage**: Currently all tests verify suppression (followup NOT triggered). Add tests that verify the positive path once D1.7 signal detection is implemented.

---

## Upstream Source Citations

| Citation | Location |
|----------|----------|
| `createFollowupRunner` factory | `src/auto-reply/reply/followup-runner.ts:42-412` |
| `runReplyAgent` — followupRun parameter | `src/auto-reply/reply/agent-runner.ts:67-97` |
| `runReplyAgent` — steer + followup gates | `src/auto-reply/reply/agent-runner.ts:203-244` |
| `FollowupRun` type | `src/auto-reply/reply/queue/types.ts:23-52` |
| `resolveActiveRunQueueAction` | `src/auto-reply/reply/queue-policy.ts:0-21` |
| `enqueueFollowupRun` | `src/auto-reply/reply/queue/enqueue.ts:64-80` |
| `scheduleFollowupDrain` | `src/auto-reply/reply/queue/drain.ts:152-180` |
| `finalizeWithFollowup` | `src/auto-reply/reply/agent-runner-helpers.ts:55-58` |
| Queue debounce (`DEFAULT_QUEUE_DEBOUNCE_MS`) | `src/auto-reply/reply/queue/state.ts:18` |
