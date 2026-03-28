# D3 Steer Check — Parity Audit

**Domain:** D3 Steer Check
**Iteration:** 1
**Date:** 2026-03-28
**Auditor:** AI Parity Auditor

---

## Summary

| # | Capability | Classification | Severity |
|---|-----------|----------------|----------|
| D3.1 | `isSteeringTurn` flag propagation (full chain) | **ALIGNED** | — |
| D3.2 | Steering turns suppress followup continuation | **ALIGNED** | — |
| D3.3 | Steering progress indicator | **ALIGNED** | — |
| D3.4 | `ChatRequestQueueKind.Steering` queue priority | **ALIGNED** | — |
| D3.5 | Cancelled turns preserve the steer flag | **ALIGNED** | — |

**Capabilities audited: 5 | ALIGNED: 5 | MISALIGNED: 0 | HEURISTIC: 0 | MISSING: 0**

---

## Per-Capability Findings

### D3.1: `isSteeringTurn` flag propagation through the full request chain

- **Classification**: ALIGNED
- **Upstream reference**: `agent-runner.ts` L1 signature `shouldSteer: boolean`, propagated through turn context → result
- **Parallx chain** (verified end-to-end):
  1. `chatTypes.ts` — `IChatSendRequestOptions.isSteeringTurn?: boolean`
  2. `chatService.ts` — `participantRequest` built with `isSteeringTurn: options?.isSteeringTurn`
  3. `chatService.ts` — `_processNextPending` sets `isSteeringTurn: true` when `next.kind === ChatRequestQueueKind.Steering`
  4. `chatTypes.ts` — `IChatParticipantRequest.isSteeringTurn?: boolean` with upstream doc
  5. `openclawDefaultParticipant.ts` — passes `request.isSteeringTurn` to `buildOpenclawTurnContext`
  6. `openclawAttempt.ts` — `IOpenclawTurnContext.isSteeringTurn?: boolean`
  7. `openclawTurnRunner.ts` — extracted: `const steered = context.isSteeringTurn === true`
  8. `openclawTurnRunner.ts` — `IOpenclawTurnResult.isSteeringTurn: boolean` (non-optional in result)
- **Test coverage**: 5 tests in `openclawTurnRunner.test.ts`

### D3.2: Steering turns suppress followup continuation

- **Classification**: ALIGNED
- **Upstream reference**: L1 step 6 — if steered, skip followup evaluation
- **Parallx file**: `openclawFollowupRunner.ts`
- **Evidence**: Gate 2 in `evaluateFollowup()`:
  ```ts
  if (turnResult.isSteeringTurn) {
    return { shouldFollowup: false, reason: 'steer-suppressed' };
  }
  ```
  Gate ordering: disabled → steer → depth → empty → signals
- **Test coverage**: 4 tests including gate ordering verification and cross-domain integration

### D3.3: Steering progress indicator

- **Classification**: ALIGNED
- **Upstream reference**: L1 `runReplyAgent` shows progress when processing steering turn
- **Evidence**:
  ```ts
  if (steered) {
    response.progress('Processing steering message...');
  }
  ```
  Fires before context engine bootstrap, matching upstream ordering.
- **Test coverage**: 2 tests (positive + negative)

### D3.4: `ChatRequestQueueKind.Steering` queue priority

- **Classification**: ALIGNED
- **Upstream reference**: L1 `resolveActiveRunQueueAction` — steering gets queue priority
- **Evidence**:
  - `ChatRequestQueueKind.Steering = 1` — distinct from `Queued = 0`
  - Steering requests inserted at front of queue
  - `requestYield()` signals the active request
  - On dequeue, `_processNextPending` adds `isSteeringTurn: true`
- **Test coverage**: 3 tests covering front insertion, FIFO among steers, replay with preserved options

### D3.5: Cancelled turns preserve the steer flag

- **Classification**: ALIGNED
- **Upstream reference**: Turn cancellation metadata preservation in L1
- **Evidence**: `const steered = context.isSteeringTurn === true` captured at function entry, returned in both success and cancellation paths
- **Test coverage**: 1 dedicated test

---

## Cross-Cutting Observations

- Workspace/canvas participants don't propagate `isSteeringTurn` — acceptable since they aren't queue-dispatched
- Gap matrix entry "Queue policy / steer check (L1)" should be split into separate rows

---

## Critical Findings

**None.** No M41 anti-patterns detected:
- No heuristic patchwork
- No output repair
- No pre-classification
- No eval-driven patchwork

---

## Recommendations

1. Split gap matrix entry for steer check vs queue policy
2. Low priority: Wire `isSteeringTurn` through workspace/canvas participants if needed later
3. Update `openclawTurnRunner.ts` header comment (says "no queue/steer" — now outdated)
