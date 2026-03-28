# D3: Doctor/Diagnostics — Gap Map

**Created:** 2026-03-28  
**Source:** D3 Iteration 1 Structural Audit

---

## Change Plan Overview

| # | Change | Target Files | Dependencies |
|---|--------|-------------|--------------|
| 1 | IDiagnosticsService interface + types | serviceTypes.ts | None |
| 2 | DiagnosticsService implementation | New: diagnosticsService.ts | serviceTypes.ts |
| 3 | Check producers (13 total) | New: diagnosticChecks.ts | IDefaultParticipantServices |
| 4 | Service DI registration | workbenchServices.ts | diagnosticsService.ts |
| 5 | DIAGNOSTICS_MANIFEST | builtinManifests.ts | None |
| 6 | Diagnostics panel module | New: built-in/diagnostics/main.ts | IDiagnosticsService |
| 7 | Panel CSS | New: built-in/diagnostics/diagnostics.css | None |
| 8 | Register built-in tool | workbench.ts | manifest + module |
| 9 | /doctor delegates to service | openclawDoctorCommand.ts + openclawTypes.ts | IDiagnosticsService |
| 10 | Unit tests | New: diagnosticsService.test.ts | All above |

---

## Per-Change Details

### Change 1: IDiagnosticsService Interface

**File:** `src/services/serviceTypes.ts`

```typescript
export interface IDiagnosticResult {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn';
  readonly detail: string;
  readonly timestamp: number;
  readonly category?: 'connection' | 'model' | 'rag' | 'config' | 'workspace';
}

export interface IDiagnosticsService {
  runChecks(): Promise<readonly IDiagnosticResult[]>;
  getLastResults(): readonly IDiagnosticResult[];
  readonly onDidChange: Event<readonly IDiagnosticResult[]>;
}

export const IDiagnosticsService = createServiceId<IDiagnosticsService>('IDiagnosticsService');
```

### Change 2: DiagnosticsService Implementation

**File:** `src/services/diagnosticsService.ts` (NEW)

- Holds a check producer registry: `IDiagnosticCheckProducer = () => Promise<IDiagnosticResult>`
- `runChecks()` executes all producers in parallel, stores results, fires event
- `getLastResults()` returns cached results
- `onDidChange` event emitter

### Change 3: Check Producers

**File:** `src/services/diagnosticChecks.ts` (NEW)

Core 8 (extracted from D2 /doctor):
1. Ollama Connection
2. Active Model
3. Model Available
4. RAG Engine
5. File Index
6. Workspace
7. Bootstrap (AGENTS.md)
8. Context Window
9. Configuration

Extended 5:
10. Embedding Model — can IEmbeddingService produce embeddings?
11. Vector Store — is sqlite-vec responsive?
12. Document Extraction — is docling bridge available?
13. Memory Service — is IMemoryService functional?
14. Config Validation — does effective config pass schema validation?

Each producer is a plain function taking a services object and returning Promise<IDiagnosticResult>.

### Change 4: Service Registration

**File:** `src/workbench/workbenchServices.ts`

Add `IDiagnosticsService` to the service container. Instantiate `DiagnosticsService` with required service dependencies.

### Change 5-8: Panel Built-in Tool

Follow indexing-log pattern exactly:
- Manifest with view contribution to panel
- Module with activate/deactivate
- View provider rendering check results as a table
- Auto-run on activate

### Change 9: /doctor Delegation

Refactor openclawDoctorCommand.ts to call `diagnosticsService.runChecks()` instead of inline checks. Add `diagnosticsService` as optional on IDefaultParticipantServices.

### Change 10: Tests

Unit tests for:
- DiagnosticsService (runChecks, getLastResults, onDidChange)
- Each check producer in isolation
- /doctor command delegation
- Panel activation
