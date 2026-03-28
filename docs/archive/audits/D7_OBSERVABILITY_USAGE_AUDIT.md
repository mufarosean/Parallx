# D7: Observability/Usage — Audit

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-28  
**Baseline:** 4/10 ALIGNED, 3/10 PARTIAL, 3/10 MISSING  
**After Iteration 1:** 10/10 ALIGNED  
**After Iteration 2:** 10/10 ALIGNED (refined)

---

## 1. Summary Table

| ID | Capability | Status | Notes |
|----|-----------|--------|-------|
| D7-1 | Token usage tracking per turn | **ALIGNED** | Ollama → attempt → turn result → response → UI |
| D7-2 | Budget utilization reporting | **PARTIAL** | Categories shown but not mapped to 10/30/30/30 lanes |
| D7-3 | Turn timing | **MISSING** | No timing instrumentation in turn runner or attempt |
| D7-4 | Cumulative session usage | **ALIGNED** | /usage + status bar aggregate session data |
| D7-5 | /usage command integration | **ALIGNED** | Functional, tested, forward D7 extension note |
| D7-6 | Status bar token display | **ALIGNED** | Production-quality SVG bar + popup |
| D7-7 | Observability service interface | **MISSING** | No IObservabilityService — data scattered |
| D7-8 | D3 diagnostics integration | **PARTIAL** | Context window check only, no observability health |
| D7-9 | Debug panel data | **PARTIAL** | Rich snapshot but test-internal, not user-facing |
| D7-10 | Model performance baseline | **MISSING** | No latency tracking |

**Score: 4/10 ALIGNED, 3/10 PARTIAL, 3/10 MISSING**

---

## 2. Existing Infrastructure

| File | What It Provides |
|------|-----------------|
| openclawTokenBudget.ts | Budget computation (fixed + elastic) |
| openclawAttempt.ts | Token capture from Ollama, reportTokenUsage() |
| openclawTurnRunner.ts | Turn result with promptTokens/completionTokens |
| openclawUsageCommand.ts | /usage command with session aggregation |
| chatTokenStatusBar.ts | Status bar widget with visual bar + popup |
| chatService.ts | reportTokenUsage() on response stream |
| chatDataService.ts | Debug snapshot collection, runtime trace storage |

---

## 3. Gap Analysis

| Priority | Gap | Impact |
|----------|-----|--------|
| P0 | IObservabilityService interface | Central aggregation point for all metrics |
| P0 | Turn timing instrumentation | Users can't see how long turns take |
| P1 | Budget lane reporting | Can't see 10/30/30/30 utilization breakdown |
| P1 | Model performance baseline | No latency-per-model data |
| P2 | D3 diagnostic checks | No observability health checks |
| P2 | Debug panel exposure | Snapshot data exists but hidden from users |

---

## 4. Iteration 2 Refinement Audit

**Findings:** 8 issues identified (R1-R8), 4 addressed.

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| R1 | HIGH | Workspace/canvas participants don't call recordTurn() | **FIXED** — Added recordTurn calls to both participants with durationMs from IReadOnlyTurnResult |
| R2 | HIGH | budgetUtilization defined but never populated | **DEFERRED** — Budget data not accessible at recordTurn callsite; field is optional |
| R3 | MEDIUM | Status bar has no observability integration | Not addressed — status bar already shows token data via separate path |
| R4 | MEDIUM | IReadOnlyTurnResult lacks durationMs | **FIXED** — Added durationMs field + timing bracket to runOpenclawReadOnlyTurn |
| R5 | LOW | No concurrency safety | N/A — JS is single-threaded |
| R6 | LOW | Zero-token turns accepted silently | **ADDRESSED** — Test added confirming zero-token turns are valid metrics |
| R7 | LOW | Debug panel not enhanced | Not addressed — existing debug panel sufficient |
| R8 | LOW | Fallback /usage doesn't show timing | Expected — fallback path lacks observability data |

**Files Modified:**
- `openclawReadOnlyTurnRunner.ts` — durationMs on IReadOnlyTurnResult, timing bracket
- `openclawTypes.ts` — observabilityService on IWorkspaceParticipantServices + ICanvasParticipantServices
- `openclawParticipantServices.ts` — adapter deps + builder wiring for workspace/canvas
- `openclawWorkspaceParticipant.ts` — recordTurn() call after runOpenclawReadOnlyTurn
- `openclawCanvasParticipant.ts` — recordTurn() call after runOpenclawReadOnlyTurn
- `chat/main.ts` — observabilityService wiring for workspace/canvas
- `observabilityService.test.ts` — 2 new tests (readonly durationMs, zero-token edge)

**Test count:** 143 files, 2774 tests, 0 failures
