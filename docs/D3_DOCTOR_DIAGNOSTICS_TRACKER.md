# D3: Doctor/Diagnostics — Implementation Tracker

**Created:** 2026-03-28  
**Status:** CLOSED ✅

## Iteration 1 — Structural Implementation

### Phase 1: Service Layer
- [x] IDiagnosticsService interface + IDiagnosticResult types in serviceTypes.ts
- [x] DiagnosticsService implementation (diagnosticsService.ts)
- [x] Check producers — 13 total (diagnosticChecks.ts)
- [x] DI registration in workbenchServices.ts

### Phase 2: Panel Built-in Tool
- [x] DIAGNOSTICS_MANIFEST in builtinManifests.ts
- [x] Panel module (built-in/diagnostics/main.ts)
- [x] Panel CSS (built-in/diagnostics/diagnostics.css)
- [x] Register in workbench.ts builtins array

### Phase 3: Integration
- [x] /doctor delegates to IDiagnosticsService
- [x] Add diagnosticsService to IDefaultParticipantServices

### Phase 4: Tests
- [x] diagnosticsService.test.ts — 34 tests

**Iteration 1 Result:** 0 tsc errors, 142 files, 2754 tests, 0 failures

---

## Iteration 2 — Refinement

### Findings & Fixes
- [x] R1 (CRITICAL): 9/14 deps not wired → added updateDeps() pattern, chat/main.ts supplements deps
- [x] R2 (MEDIUM): Unused _IDiagnosticResult alias → cleaned import
- [x] R3 (LOW): parameterSize string→number type mismatch → parseInt coercion

### New Tests
- [x] updateDeps merges new deps (+1)
- [x] updateDeps preserves existing deps (+1)
- [x] dispose behavior (+1)

**Iteration 2 Result:** 0 tsc errors, 142 files, 2757 tests, 0 failures (37 D3 tests)

---

## Score

| Metric | Iter 1 | Iter 2 |
|--------|--------|--------|
| D3-1 Diagnostic service interface | ALIGNED | ALIGNED |
| D3-2 Check registry | ALIGNED | ALIGNED |
| D3-3 Core checks extracted | ALIGNED | ALIGNED |
| D3-4 Extended checks | ALIGNED | ALIGNED |
| D3-5 Panel view | ALIGNED | ALIGNED |
| D3-6 Auto-run on startup | ALIGNED | ALIGNED |
| D3-7 Re-run command | ALIGNED | ALIGNED |
| D3-8 /doctor delegates to service | ALIGNED | ALIGNED |
| D3-9 Status indicators | ALIGNED | ALIGNED |
| D3-10 Panel refresh | ALIGNED | ALIGNED |
| **Total** | **10/10** | **10/10** |

---

## Iteration 3 — Final Parity Check

- [x] Full 7-axis audit (interface, implementation, registration, integration, tests, M41, cross-domain)
- [x] All 10 capabilities verified ALIGNED
- [x] M41 compliance: CLEAN
- [x] Cross-domain readiness: PASS (D7 can subscribe to onDidChange)
- [x] 37 tests across 5 describe blocks

**Iteration 3 Result:** 10/10 ALIGNED, 0 tsc errors, 142 files, 2757 tests, 0 failures

---

## Documentation Files
- [x] D3_DOCTOR_DIAGNOSTICS_AUDIT.md — 3 iterations documented
- [x] D3_DOCTOR_DIAGNOSTICS_GAP_MAP.md — Implementation plan
- [x] D3_DOCTOR_DIAGNOSTICS_TRACKER.md — This file (CLOSED)
