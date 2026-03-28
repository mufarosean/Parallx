# D4 Runtime Hooks — Tracker

**Created:** 2026-03-28  
**Status:** CLOSED ✅ — 8/8 ALIGNED, M41 CLEAN

## Capability Tracker

| # | Capability | Iter 1 | Iter 2 | Iter 3 | Status |
|---|-----------|--------|--------|--------|--------|
| D4-1 | Tool Observer Wiring | ✅ ALIGNED | | | G4 resolved |
| D4-2 | Before-Tool Hook | ✅ ALIGNED | | | Wired at both call sites |
| D4-3 | After-Tool Hook | ✅ ALIGNED | | | Wired at both call sites |
| D4-4 | Hook Registration | ✅ ALIGNED | | | G1 resolved — RuntimeHookRegistry |
| D4-5 | Message Hook | ✅ ALIGNED | | | G6 resolved — before/after model call |
| D4-6 | Hook Composition | ✅ ALIGNED | | | G2 resolved — composite pattern |
| D4-7 | Hook Error Isolation | ✅ ALIGNED | | | G3 resolved — try/catch per callback |
| D4-8 | Participant Integration | ✅ ALIGNED | | | G5 resolved — all 3 participants |

## Iteration Log

### Iteration 1 — Structural Audit + Implementation (2026-03-28)
- **Deliverables:** AUDIT, GAP_MAP, TRACKER, full implementation
- **Gaps resolved:** G1-G6 (all 6)
- **Implementation:**
  - **G1 (Registry):** Created `RuntimeHookRegistry` class with Set-based storage, register/deregister returning IDisposable
  - **G2 (Composition):** Composite pattern — getCompositeToolObserver + getCompositeMessageObserver fan out to all registered
  - **G3 (Error Isolation):** Every callback in composite wrapped in try/catch with console.warn
  - **G4 (Wiring):** toolObserver wired at both call sites:
    - `openclawAttempt.ts`: context.toolObserver passed as 4th arg to invokeToolWithRuntimeControl
    - `openclawReadOnlyTurnRunner.ts`: manual onValidated/onExecuted hooks around tool invocation
  - **G5 (Participant Integration):** runtimeHookRegistry added to all 3 participant service interfaces + adapter deps + builder functions + DI registration + main.ts wiring
  - **G6 (Message Hooks):** messageObserver added to IOpenclawTurnContext + IReadOnlyTurnOptions, wired before/after executeModelStream in both runners
- **Tests added:** 12 (runtimeHookRegistry.test.ts)
- **Test baseline:** 144 files, 2801 tests, 0 failures, 0 tsc errors

### Files Modified (Iteration 1)

| File | Changes |
|------|---------|
| `src/services/serviceTypes.ts` | Added IChatRuntimeMessageObserver, IRuntimeHookRegistry + service ID |
| `src/services/runtimeHookRegistry.ts` | NEW — RuntimeHookRegistry class |
| `src/openclaw/openclawAttempt.ts` | Added toolObserver + messageObserver to IOpenclawTurnContext, wired hooks |
| `src/openclaw/openclawReadOnlyTurnRunner.ts` | Added toolObserver + messageObserver to IReadOnlyTurnOptions, wired hooks |
| `src/openclaw/openclawTypes.ts` | Added runtimeHookRegistry to all 3 participant service interfaces |
| `src/openclaw/openclawParticipantServices.ts` | Added runtimeHookRegistry to all 3 adapter deps + builder functions |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Wired toolObserver + messageObserver |
| `src/openclaw/participants/openclawWorkspaceParticipant.ts` | Wired toolObserver + messageObserver + modelName |
| `src/openclaw/participants/openclawCanvasParticipant.ts` | Wired toolObserver + messageObserver + modelName |
| `src/workbench/workbenchServices.ts` | Instantiate + register RuntimeHookRegistry in DI |
| `src/built-in/chat/main.ts` | Wire runtimeHookRegistry into all 3 participant service builders |
| `tests/unit/runtimeHookRegistry.test.ts` | NEW — 12 tests |
| `tests/unit/openclawAttempt.test.ts` | Updated test for 4th arg to invokeToolWithRuntimeControl |

### Iteration 2 — Refinement (2026-03-28)
- **Findings:** 9 (R1 HIGH, R3-R5 MEDIUM, R2/R6-R9 LOW)
- **Resolved:** R1 (observer forwarding), R3 (invariant comment), R4 (logging), R5 (snapshot reuse), R9 (explanatory comment)
- **Deferred:** R2 (no-op), R6 (no consumer), R7-R8 (trivially correct)
- **Test fix:** openclawDefaultParticipant.test.ts updated for 4th arg
- **Baseline:** 144 files, 2801 tests, 0 failures, 0 tsc errors

### Iteration 3 — Final Parity Check (2026-03-28)
- **Result:** 8/8 ALIGNED, M41 CLEAN
- **Verdict:** All capabilities verified at code level. No anti-patterns detected.
- **Domain status:** CLOSED ✅

## Closure Summary

| Metric | Value |
|--------|-------|
| Capabilities | 8/8 ALIGNED |
| Iterations | 3 |
| Tests added | 12 (runtimeHookRegistry.test.ts) |
| Test baseline | 144 files, 2801 tests, 0 failures |
| TypeScript | 0 errors |
| M41 anti-patterns | CLEAN |
| Files created | 2 (runtimeHookRegistry.ts, runtimeHookRegistry.test.ts) |
| Files modified | 11 (see Iter 1 file table) |
