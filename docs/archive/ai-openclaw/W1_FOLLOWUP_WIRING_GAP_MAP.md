# W1 — FollowupRunner Wiring: Gap Map

**Date:** 2026-04-22
**Source audit:** `docs/ai/openclaw/W1_FOLLOWUP_WIRING_AUDIT.md`
**Mapper:** Gap Mapper (driven by Parity Orchestrator)

---

## Summary

Wire the existing, audit-closed `createFollowupRunner` into the default
participant's per-turn lifecycle. All changes are additive; no core
execution logic is modified. Depth state is held in the participant closure;
queue dispatch is delegated to the existing chat service queue.

Total files touched: **4**
Total new files: **1** (integration test)
Core-file changes: **0** (all changes are participant-local + adapter
threading + a single new entry in the participant-services wiring site in
`built-in/chat/main.ts`, which follows the same registration pattern as
existing D2/D3/D4/D7/D8 delegates)

---

## Change plan

### G-1. `src/openclaw/openclawTypes.ts`

**Add** to `IDefaultParticipantServices` (line ~185):

```ts
/**
 * W1 (M58): Queue a followup turn for the session via the chat service's
 * pending-request queue. Maps to chatService.queueRequest(sessionId,
 * message, ChatRequestQueueKind.Queued). Undefined in environments where
 * no chat service is wired (e.g. isolated unit tests).
 *
 * Upstream: scheduleFollowupDrain (queue/drain.ts:67) +
 * enqueueFollowupRun (queue/enqueue.ts:44).
 */
queueFollowupRequest?(sessionId: string, message: string): void;
```

**Justification:** single optional bridge. Adapter-level only; does not
alter any existing service contract.

---

### G-2. `src/openclaw/openclawParticipantServices.ts`

**Add** to `IOpenclawDefaultParticipantAdapterDeps`:

```ts
readonly queueFollowupRequest?: IDefaultParticipantServices['queueFollowupRequest'];
```

**Add** to the `buildOpenclawDefaultParticipantServices` return object:

```ts
queueFollowupRequest: deps.queueFollowupRequest,
```

---

### G-3. `src/built-in/chat/main.ts`

Where `openclawDefaultParticipantServices` is constructed (around line 744,
next to `executeCommand` / `getAvailableModelIds`), add:

```ts
queueFollowupRequest: (sessionId: string, message: string) => {
  chatService.queueRequest(sessionId, message, ChatRequestQueueKind.Queued);
},
```

And import `ChatRequestQueueKind` alongside the existing chat-types imports
at the top of the file.

**Justification:** `chatService` is already in scope (line 239). The
registration pattern matches every other delegate (`listModels`,
`checkProviderStatus`, `executeCommand`, etc.). No structural change.

---

### G-4. `src/openclaw/participants/openclawDefaultParticipant.ts`

This is the only substantive change.

**Add imports** at the top:

```ts
import {
  createFollowupRunner,
  type IFollowupEvaluation,
  type IOpenclawFollowupRun,
  type FollowupTurnSender,
} from '../openclawFollowupRunner.js';
```

**Add** a module-level per-session followup state map right above
`createOpenclawDefaultParticipant`:

```ts
/**
 * W1: per-session followup state. Keyed by sessionId because
 * `createOpenclawDefaultParticipant` is instantiated once but dispatches
 * turns for many sessions.
 *
 * The runner is created lazily on first turn per session (sender closure
 * captures sessionId). Depth resets when a turn completes without
 * triggering continuation — this covers both "chain naturally ended"
 * and "new user turn arrived after previous chain finished".
 */
interface IFollowupSessionState {
  readonly runner: ReturnType<typeof createFollowupRunner>;
  depth: number;
}
```

Inside `createOpenclawDefaultParticipant`, after the existing
`commandRegistry` line, add:

```ts
const followupStates = new Map<string, IFollowupSessionState>();

function getFollowupState(sessionId: string): IFollowupSessionState | undefined {
  if (!services.queueFollowupRequest) return undefined;
  let state = followupStates.get(sessionId);
  if (!state) {
    const sender: FollowupTurnSender = async (run: IOpenclawFollowupRun) => {
      services.queueFollowupRequest!(sessionId, run.message);
    };
    state = { runner: createFollowupRunner(sender), depth: 0 };
    followupStates.set(sessionId, state);
  }
  return state;
}
```

**Dispose:** update `dispose` to `() => { followupStates.clear(); }`.

**Post-turn hook** — inside `runOpenclawDefaultTurn`, after the successful
`try { ... return {...} }` path succeeds. The cleanest insertion is right
before the `return { metadata: ... };` at the end of the try block's happy
path (after memory writeback, before the return). We need to evaluate
*after* we have `result: IOpenclawTurnResult`, but ONLY if the turn was
not cancelled and not in error.

Add right before `lifecycle.recordCompleted();`:

```ts
// W1 (M58): Self-continuation — evaluate whether to queue a followup turn.
// If the tool loop hit the iteration cap with pending tool calls,
// continuationRequested=true triggers a queued followup (up to
// MAX_FOLLOWUP_DEPTH). Depth resets whenever a chain ends.
const followupState = getFollowupState(context.sessionId);
if (followupState) {
  try {
    const evaluation = await followupState.runner(result, followupState.depth);
    if (evaluation.shouldFollowup) {
      followupState.depth += 1;
    } else {
      followupState.depth = 0;
    }
  } catch (err) {
    console.warn('[OpenClaw:W1] Followup evaluation failed:', err);
    followupState.depth = 0;
  }
}
```

**Note on ordering:** the runner is invoked *after* `response.setCitations`
and citation metadata emit but *before* the returned metadata; the
500ms `FOLLOWUP_DELAY_MS` inside the runner runs before the runner calls
`sender`, so the queued followup lands in the chat-service queue ~500ms
after the current turn returns, which gives `_processNextPending` room to
dispatch normally (no race).

---

### G-5. `tests/unit/openclawFollowupWiring.test.ts` (NEW)

Integration test proving:

1. `continuationRequested=true` on turn N → a followup message is queued
   on the chat service with `ChatRequestQueueKind.Queued`.
2. Depth increments each continuation; at `MAX_FOLLOWUP_DEPTH` no further
   queue call is made.
3. A turn with `isSteeringTurn=true` never queues a followup even if
   `continuationRequested=true`.
4. A non-continuation turn after a continuation chain resets the depth.

Test harness approach: drive the turn runner directly via a fake
`runOpenclawTurn` (mock with `vi.mock`) that returns controllable
`IOpenclawTurnResult` values. Assert on the provided `queueFollowupRequest`
mock.

Adding this as a separate file keeps `openclawDefaultParticipant.test.ts`
focused on bootstrap/prompt behavior.

---

## Non-changes — explicitly kept out of scope

| Item | Why excluded |
|------|-------------|
| Modifying `IChatSendRequestOptions` / `IChatParticipantRequest` with an `isFollowupTurn` flag | Not needed — depth-reset-on-non-continuation makes this unnecessary; avoids core-file change |
| Modifying `chatSessionPersistence` or the session model | Followup turns reuse the normal sendRequest path — they persist like any other assistant turn |
| Modifying `openclawFollowupRunner.ts` itself | Module is 8/8 ALIGNED; no drift found |
| Modifying `openclawTurnRunner.ts` | Already propagates `continuationRequested` |
| Autonomy mirror wiring | Already covers every turn via `chatTurnSynthesis`; followup turns are normal turns from its perspective |
| W2–W6 wiring | Separate domains, separate orchestrator runs |

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| Runaway queue if `continuationRequested` stays stuck true after a bug elsewhere | `MAX_FOLLOWUP_DEPTH=5` cap; depth resets on any non-continuation outcome |
| Followup fires while user sends a new message (race) | `chatService.queueRequest` uses the same pending queue that already handles this; a new user message becomes the next queued or steering request |
| Evaluator throws | Wrapped in try/catch; logs and resets depth rather than masking the original turn result |
| Session leak in `followupStates` map | Map holds at most one entry per session; session deletion is handled externally and the entry becomes orphaned but is GC-eligible once `createOpenclawDefaultParticipant` is disposed. For the desktop single-user case this is acceptable. |

---

## Ready for execution

All design decisions resolved. Proceed to code execution with the Parity
Code Executor.
