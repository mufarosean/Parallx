# D3 Steer Check — Gap Map

**Domain:** D3 Steer Check  
**Iteration:** 1  
**Date:** 2026-03-28  
**Input:** `D3_STEER_CHECK_AUDIT.md` (Iteration 1)  
**Gap Mapper:** Gap Mapper Agent

---

## Domain Status: **CLOSE**

All 5 capabilities are ALIGNED. Two low-effort documentation corrections are REQUIRED (no code logic changes). One recommendation is DEFERRED.

---

## Capability Overview

| # | Capability | Audit Status | Action |
|---|-----------|-------------|--------|
| D3.1 | `isSteeringTurn` flag propagation (full chain) | ALIGNED | None |
| D3.2 | Steering turns suppress followup continuation | ALIGNED | None |
| D3.3 | Steering progress indicator | ALIGNED | None |
| D3.4 | `ChatRequestQueueKind.Steering` queue priority | ALIGNED | None |
| D3.5 | Cancelled turns preserve the steer flag | ALIGNED | None |

**No code changes needed for any capability.**

---

## Recommendation Assessment

### Recommendation 1: Split gap matrix entry for steer check vs queue policy

- **Classification:** REQUIRED (documentation accuracy)
- **Rationale:** The gap matrix row `Queue policy / steer check (L1)` is marked **N/A** with "Skip — no multi-user concurrency". This was correct before steer check was implemented, but is now factually wrong — steer check IS implemented and ALIGNED. Queue policy remains N/A. The single row conflates two distinct capabilities with different statuses.
- **Impact:** Documentation only. No code changes.

### Recommendation 2: Wire `isSteeringTurn` through workspace/canvas participants

- **Classification:** DEFERRED
- **Rationale:** Workspace and canvas participants are not queue-dispatched, so `isSteeringTurn` has no functional meaning for them. The audit confirms this is acceptable. Only revisit if these participants gain queue dispatch in the future.

### Recommendation 3: Update `openclawTurnRunner.ts` header comment

- **Classification:** REQUIRED (comment accuracy)
- **Rationale:** Line 12 of `openclawTurnRunner.ts` reads `Single-user (no queue/steer from L1)`. Steer check is now fully implemented (D3.1–D3.5). The comment contradicts the actual code and would mislead future readers. Queue policy remains N/A (single-user), so only the steer portion needs correction.
- **Impact:** Single comment line. No logic changes.

---

## Change Plans

### Change 1: Split gap matrix steer check row

- **Status**: N/A → split into N/A (queue) + ALIGNED (steer)
- **Upstream**: `agent-runner.ts:97-140` — queue dispatch + `shouldSteer` flag
- **Parallx file**: `docs/clawrallx/OPENCLAW_GAP_MATRIX.md`
- **Action**: Replace the single row `Queue policy / steer check (L1)` with two rows:
  1. `Queue policy (L1)` — status N/A, rationale "Not needed for single-user desktop app", fix "Skip — no multi-user concurrency"
  2. `Steer check (L1)` — status ALIGNED, location `chatService.ts` (queue priority) + `openclawTurnRunner.ts` (flag extraction) + `openclawFollowupRunner.ts` (suppression), gap "Full chain: flag propagation, queue priority, progress indicator, followup suppression, cancellation preservation", fix "—"
- **Remove**: The combined row
- **Verify**: Gap matrix has two distinct rows; steer row shows ALIGNED
- **Risk**: None — documentation only

### Change 2: Fix `openclawTurnRunner.ts` header comment

- **Status**: Outdated comment → accurate comment
- **Upstream**: `agent-runner.ts` L1 — `shouldSteer: boolean` parameter
- **Parallx file**: `src/openclaw/openclawTurnRunner.ts`, line 12
- **Action**: Change `Single-user (no queue/steer from L1)` to `Single-user (no queue from L1; steer check implemented — see D3 audit)`
- **Remove**: The stale "(no queue/steer from L1)" phrasing
- **Verify**: Comment reflects that steer is implemented while queue remains N/A
- **Risk**: None — comment only

---

## Summary

| Item | Type | Classification | Effort |
|------|------|---------------|--------|
| D3.1–D3.5 (all capabilities) | Code | ALIGNED — no changes | — |
| Rec 1: Split gap matrix row | Documentation | REQUIRED | Trivial |
| Rec 2: Canvas/workspace participant wiring | Future work | DEFERRED | — |
| Rec 3: Header comment fix | Documentation | REQUIRED | Trivial |

**Domain recommendation: CLOSE** — all capabilities at parity, two trivial doc fixes to apply.
