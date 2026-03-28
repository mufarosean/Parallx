# D3: Doctor/Diagnostics — Iteration 1 Structural Audit

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-28  
**Baseline:** D2 /doctor command exists with 8 inline checks, no reusable service

---

## 1. Summary Table

| ID | Capability | Status | Notes |
|----|-----------|--------|-------|
| D3-1 | Diagnostic service interface | **MISSING** | No IDiagnosticsService exists |
| D3-2 | Check registry | **MISSING** | IDiagnosticCheck is local to /doctor handler |
| D3-3 | Core checks extracted from D2 | **MISSING** | All 8 checks are inline procedural code |
| D3-4 | Extended checks | **MISSING** | No embedding, sqlite-vec, docling, memory checks |
| D3-5 | Panel view | **MISSING** | No view.diagnostics, no built-in/diagnostics/ |
| D3-6 | Auto-run on startup | **MISSING** | /doctor only runs on demand |
| D3-7 | Re-run command | **MISSING** | No diagnostics.runChecks command |
| D3-8 | /doctor delegates to service | **MISSING** | Inline checks, no service delegation |
| D3-9 | Status indicators | **PARTIAL** | Has pass/fail/warn emoji, no timestamps |
| D3-10 | Panel refresh | **MISSING** | No panel exists |

**Score: 0/10 ALIGNED, 1/10 PARTIAL, 9/10 MISSING**

---

## 2. Architecture

### Service Layer
- `src/services/serviceTypes.ts` — IDiagnosticsService token + interface
- `src/services/diagnosticsService.ts` — Implementation with check registry, runChecks(), event emitter
- `src/services/diagnosticChecks.ts` — All check producers (core 8 + extended 5)

### Panel Layer
- `src/tools/builtinManifests.ts` — DIAGNOSTICS_MANIFEST
- `src/built-in/diagnostics/main.ts` — activate(), view provider, re-run command
- `src/built-in/diagnostics/diagnostics.css` — Panel styling
- `src/workbench/workbench.ts` — Import + register in builtins array

### Integration Layer
- `src/openclaw/commands/openclawDoctorCommand.ts` — Delegate to IDiagnosticsService
- `src/workbench/workbenchServices.ts` — Instantiate + register service

### Data Flow
```
activate() → diagnosticsService.runChecks() → check producers execute → results stored
                                                                       ↓
panel subscribes to onDidChange ←──────────────────────────────────── emit
                                                                       ↓
/doctor handler calls diagnosticsService.getLastResults() ────────── format markdown
```

---

## 3. Gap Map

| Priority | Gap | Files | Effort |
|----------|-----|-------|--------|
| P0 | IDiagnosticsService interface + DI token | serviceTypes.ts | Small |
| P0 | DiagnosticsService implementation | New: diagnosticsService.ts | Medium |
| P0 | Extract 8 core check producers + 5 extended | New: diagnosticChecks.ts | Medium |
| P0 | Register service in DI | workbenchServices.ts | Small |
| P1 | DIAGNOSTICS_MANIFEST | builtinManifests.ts | Small |
| P1 | Panel module | New: built-in/diagnostics/main.ts | Medium |
| P1 | Panel CSS | New: built-in/diagnostics/diagnostics.css | Small |
| P1 | Register in workbench builtins | workbench.ts | Small |
| P2 | Auto-run on startup | built-in/diagnostics/main.ts | Small |
| P2 | /doctor delegates to service | openclawDoctorCommand.ts | Small |
| P2 | Timestamps on results | IDiagnosticResult type | Small |

---

## 4. Iteration 2 — Refinement Audit (2026-03-28)

### Findings

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| R1 | **CRITICAL** | 9 of 14 IDiagnosticCheckDeps fields not wired in workbenchServices.ts — checks return 'warn' fallbacks | Added `updateDeps()` to DiagnosticsService + IDiagnosticsService; chat/main.ts supplements deps once OllamaProvider + dataService are available |
| R2 | **MEDIUM** | Unused `_IDiagnosticResult` import alias in diagnosticChecks.ts | Cleaned up — import only `IDiagnosticCheckProducer` |
| R3 | **LOW** | `parameterSize` (string) → `size` (number) type mismatch in listModels mapping | Added parseInt coercion with fallback |

### Changes Made
- `src/services/diagnosticsService.ts` — Added `updateDeps(patch: Partial<IDiagnosticCheckDeps>)`, changed `_deps` from `readonly` to mutable
- `src/services/serviceTypes.ts` — Added `updateDeps` to `IDiagnosticsService` interface
- `src/built-in/chat/main.ts` — After participant services build, calls `diagSvc.updateDeps()` with 9 remaining deps (checkProviderStatus, getActiveModel, listModels, isRAGAvailable, isIndexing, getFileCount, existsRelative, getModelContextLength, checkDocumentExtraction); added `IDocumentExtractionService` import
- `src/services/diagnosticChecks.ts` — Removed unused `_IDiagnosticResult` alias
- `tests/unit/diagnosticsService.test.ts` — Added 3 tests: updateDeps merging, updateDeps preserve, dispose behavior

### Verification
- **TypeScript:** 0 errors
- **Tests:** 142 files, 2757 tests, 0 failures (37 D3 tests)
- **Dep Coverage:** 14/14 IDiagnosticCheckDeps now wired (5 at construction + 9 via updateDeps)

---

## 5. Iteration 3 — Final Parity Check (2026-03-28)

### Per-Capability Verification

| ID | Capability | Status | Verification |
|----|-----------|--------|-------------|
| D3-1 | Diagnostic service interface | **ALIGNED** | runChecks(), getLastResults(), updateDeps(), onDidChange in IDiagnosticsService + DI token |
| D3-2 | Check registry | **ALIGNED** | Constructor accepts checks array, Promise.all execution, per-check error containment |
| D3-3 | Core checks extracted | **ALIGNED** | 9 core checks as pure functions in diagnosticChecks.ts |
| D3-4 | Extended checks | **ALIGNED** | 4 extended checks (embedding, vector store, docling, memory) |
| D3-5 | Panel view | **ALIGNED** | view.diagnostics registered, HTML table rendering, manifest in builtins |
| D3-6 | Auto-run on startup | **ALIGNED** | onStartupFinished activation, immediate runChecks() |
| D3-7 | Re-run command | **ALIGNED** | diagnostics.runChecks command in manifest + handler |
| D3-8 | /doctor delegates to service | **ALIGNED** | Service delegation with inline fallback |
| D3-9 | Status indicators | **ALIGNED** | SVG icons in panel, emoji in /doctor, timestamps on all results |
| D3-10 | Panel refresh | **ALIGNED** | Refresh button with spinning animation, onDidChange subscription |

### M41 Compliance: CLEAN
### Cross-Domain Readiness: PASS (D7 can subscribe to onDidChange)
### Final Score: 10/10 ALIGNED
