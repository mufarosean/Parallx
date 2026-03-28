# D7: Observability/Usage — Gap Map

**Created:** 2026-03-28  
**Source:** D7_OBSERVABILITY_USAGE_AUDIT.md

---

## Change Plan Overview

| # | Change | Files | Upstream Citation |
|---|--------|-------|-------------------|
| 1 | IObservabilityService interface + types | serviceTypes.ts | OpenClaw runtime health contracts |
| 2 | ObservabilityService implementation | NEW: observabilityService.ts | Centralized metric aggregation |
| 3 | Turn timing in openclawTurnRunner.ts | openclawTurnRunner.ts | Bracket runOpenclawTurn with Date.now() |
| 4 | Turn timing in openclawAttempt.ts | openclawAttempt.ts | Bracket executeOpenclawAttempt |
| 5 | Budget lane reporting | /usage command, status bar | Surface 10/30/30/30 lane actuals |
| 6 | Model performance tracking | observabilityService.ts | Per-model latency accumulation |
| 7 | D3 diagnostic checks | diagnosticChecks.ts | Observability health checks |
| 8 | /usage command extension | openclawUsageCommand.ts | Render timing + budget lanes |
| 9 | DI wiring | workbenchServices.ts, main.ts | Service registration + consumer injection |
| 10 | Tests | NEW: observabilityService.test.ts | Full coverage |

---

## Per-Gap Change Plans

### Gap 1: IObservabilityService Interface (D7-7)
**File:** src/services/serviceTypes.ts  
**Change:** Add ITurnMetrics (promptTokens, completionTokens, totalTokens, durationMs, model, budgetUtilization), IObservabilityService (recordTurn, getSessionMetrics, getModelMetrics, onDidRecordTurn), service identifier.

### Gap 2: ObservabilityService Implementation (D7-7)
**File:** NEW src/services/observabilityService.ts  
**Change:** Class implementing IObservabilityService. Internal arrays for turn metrics. Aggregation methods for session totals, per-model averages. Event emitter for real-time subscribers.

### Gap 3: Turn Timing — Turn Runner (D7-3)
**File:** src/openclaw/openclawTurnRunner.ts  
**Change:** Add `const turnStart = Date.now()` before turn execution, `durationMs: Date.now() - turnStart` on IOpenclawTurnResult.

### Gap 4: Turn Timing — Attempt (D7-3)
**File:** src/openclaw/openclawAttempt.ts  
**Change:** Add timing bracket around executeOpenclawAttempt. Propagate durationMs.

### Gap 5: Budget Lane Reporting (D7-2)
**File:** openclawUsageCommand.ts, chatTokenStatusBar.ts  
**Change:** /usage reports actual vs budget per lane (system 10%, RAG 30%, history 30%, user 30%). Status bar popup shows lane breakdown.

### Gap 6: Model Performance Tracking (D7-10)
**File:** observabilityService.ts  
**Change:** getModelMetrics(model) returns { avgDurationMs, totalTokens, turnCount }. recordTurn includes model + duration.

### Gap 7: D3 Integration (D7-8)
**File:** src/services/diagnosticChecks.ts  
**Change:** Add 2 observability checks: token tracking health (real vs estimated), response time alert (>30s avg).

### Gap 8: /usage Extension (D7-5)
**File:** openclawUsageCommand.ts  
**Change:** Add timing column, budget lane section, model comparison section.

### Gap 9: DI Wiring (D7-7)
**File:** workbenchServices.ts, chat/main.ts  
**Change:** Instantiate ObservabilityService, register with DI. Wire into participant services.

### Gap 10: Tests
**File:** NEW tests/unit/observabilityService.test.ts  
**Change:** recordTurn, getSessionMetrics, getModelMetrics, event emission, budget lane calculation.
