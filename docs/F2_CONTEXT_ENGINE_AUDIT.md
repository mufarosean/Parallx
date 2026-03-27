# Audit Report: F2 — Context Engine (Iteration 1 of 3)

**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor  
**Baseline commit:** Post-F1 iterations 2+3  

---

## Summary

- **Capabilities audited:** 6
- **ALIGNED:** 3
- **MISALIGNED:** 2
- **HEURISTIC:** 0
- **MISSING:** 1

This domain has significantly improved since the original gap matrix was written. The context engine now has:
- A proper interface (`IOpenclawContextEngine`) with lifecycle methods
- A working implementation (`OpenclawContextEngine`)
- Token budget management with the correct 10/30/30/30 split
- Integration into the execution pipeline via `runOpenclawTurn` and `executeOpenclawAttempt`
- 24 passing unit tests

**Previous gap matrix status:** 0 ALIGNED, 1 MISALIGNED, 5 MISSING  
**Revised status:** 3 ALIGNED, 2 MISALIGNED, 1 MISSING

---

## Per-Capability Classification Table

| ID | Capability | Original Status | Revised Status | Severity |
|----|-----------|----------------|----------------|----------|
| F2-01 | ContextEngine interface | MISSING | **ALIGNED** | — |
| F2-02 | Context engine init | MISSING | **ALIGNED** | — |
| F2-03 | Context engine registry | MISSING | **ALIGNED** (N/A adaptation) | — |
| F2-04 | Context maintenance | MISSING | **MISALIGNED** | MEDIUM |
| F2-05 | Per-attempt helpers | MISSING | **MISALIGNED** | LOW |
| F2-06 | Token budget management | MISALIGNED | **MISALIGNED** | MEDIUM |

---

## Per-Capability Findings

### F2-01: ContextEngine Interface

- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 40-47
- **Upstream reference:** `context-engine/types.ts:74-231`, `ContextEngine` interface
- **Divergence:** None significant. Interface is structurally correct.
- **Evidence:**

Parallx defines `IOpenclawContextEngine` with 4 lifecycle methods:
```ts
export interface IOpenclawContextEngine {
  bootstrap?(params: IOpenclawBootstrapParams): Promise<IOpenclawBootstrapResult>;
  assemble(params: IOpenclawAssembleParams): Promise<IOpenclawAssembleResult>;
  compact(params: IOpenclawCompactParams): Promise<IOpenclawCompactResult>;
  afterTurn?(params: IOpenclawAfterTurnParams): Promise<void>;
}
```

Upstream `ContextEngine` has: `maintain`, `bootstrap`, `assemble` (plus optional: `ingest`, `ingestBatch`, `prepareSubagentSpawn`, `onSubagentEnded`, `dispose`).

**Mapping:**
| Upstream | Parallx | Status |
|----------|---------|--------|
| `bootstrap` | `bootstrap` | ✓ Present |
| `assemble` | `assemble` | ✓ Present |
| `maintain` | `compact` | ✓ Renamed — documented rationale |
| N/A | `afterTurn` | Parallx-specific extension (correct adaptation) |
| `ingest/ingestBatch` | — | Skipped — platform handles persistence |
| `prepareSubagentSpawn/onSubagentEnded` | — | Skipped — no subagents |
| `dispose` | — | Skipped — engine is per-turn |

The omissions are document with clear rationale (`maintain → compact` is documented in the interface comment). The added `afterTurn` hook is a clean Parallx adaptation. **ALIGNED.**

---

### F2-02: Context Engine Init

- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/participants/openclawDefaultParticipant.ts` line 263
- **Upstream reference:** `context-engine/init.ts` → `ensureContextEnginesInitialized`
- **Divergence:** Upstream uses a standalone init function + registry. Parallx instantiates the engine directly in the participant turn context builder.
- **Evidence:**

In `buildOpenclawTurnContext()`:
```ts
const engine = new OpenclawContextEngine(services);
```

Then in `runOpenclawTurn()` (the turn runner), bootstrap is called:
```ts
if (context.engine.bootstrap) {
  await context.engine.bootstrap({
    sessionId: context.sessionId,
    tokenBudget: context.tokenBudget,
  });
}
```

This is the Parallx-appropriate equivalent of `ensureContextEnginesInitialized`: the engine is created per-turn with the current services, and `bootstrap()` is called once before the retry loop begins. For a single-user desktop app with one engine type, this is the correct simplification. **ALIGNED.**

---

### F2-03: Context Engine Registry

- **Classification:** ALIGNED (N/A adaptation)
- **Parallx file:** `src/openclaw/participants/openclawDefaultParticipant.ts` line 263
- **Upstream reference:** `context-engine/registry.ts` → `resolveContextEngine`
- **Divergence:** No registry exists; single engine instantiated directly.
- **Evidence:**

Upstream has `resolveContextEngine` to select from registered engine implementations by agent config. Parallx has exactly one engine (`OpenclawContextEngine`), instantiated directly. This is explicitly called out as acceptable in the gap matrix: *"For Parallx, a single workspace-aware engine is sufficient. No registry needed initially."*

If Parallx later needs multiple engine types (e.g., a coding-focused engine vs. a document-focused engine), a registry could be added. For now, direct instantiation is the correct simplification. **ALIGNED.**

---

### F2-04: Context Maintenance (Transcript Rewrite/Compaction)

- **Classification:** MISALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 343-414 (`compact` method)
- **Upstream reference:** `context-engine-maintenance.ts` → `runContextEngineMaintenance`, `buildContextEngineMaintenanceRuntimeContext`; also `compact.ts` → `compactEmbeddedPiSessionDirect`
- **Divergence:** Two structural issues.
- **Severity:** MEDIUM

**Issue 1: Upstream separates maintenance from compaction. Parallx merges them.**

Upstream has two distinct operations:
1. **Context maintenance** (`runContextEngineMaintenance`): Periodic transcript rewrite — can rewrite/edit/remove messages for quality. Returns `TranscriptRewriteResult`. Called via `maintain()` on the context engine interface.
2. **Context compaction** (`compactEmbeddedPiSessionDirect`): Emergency token reduction — summarizes old messages when context window is full. Triggered by overflow errors.

Parallx has only `compact()`, which conflates both roles. The `compact()` method does summarization + memory flush but has no transcript rewrite/edit capability (dropping individual messages, editing content, etc.).

**Impact:** Low for current use. Maintenance is an optimization feature — compaction handles the critical path (overflow recovery). Transcript rewrite would improve quality for long sessions but isn't blocking.

**Issue 2: Compaction doesn't use configurable model override.**

Upstream allows a different (cheaper) model for compaction via `agents.defaults.compaction.model`. Parallx uses `sendSummarizationRequest` from services, which may or may not be a different model. The service layer determines this, not the engine.

**Impact:** Low — the service adapter pattern is acceptable. The engine doesn't need to know about model selection.

---

### F2-05: Per-Attempt Helpers

- **Classification:** MISALIGNED
- **Parallx file:** `src/openclaw/openclawTurnRunner.ts` lines 87-98 (bootstrap), `executeOpenclawAttempt` in `openclawAttempt.ts`
- **Upstream reference:** `attempt.context-engine-helpers.ts` → `runAttemptContextEngineBootstrap`, `assembleAttemptContextEngine`
- **Divergence:** Helpers are inlined rather than factored into separate functions.
- **Severity:** LOW

**Evidence:**

Upstream has two named helper functions:
1. `runAttemptContextEngineBootstrap()` — standalone function in `attempt.context-engine-helpers.ts`
2. `assembleAttemptContextEngine()` — standalone function that takes token budget, messages, model ID

Parallx inlines both:
- Bootstrap is called inline in `runOpenclawTurn()` (3 lines)
- Assembly is called inline in `runOpenclawTurn()` via `context.engine.assemble()` (5 lines)

The BEHAVIOR is functionally equivalent:
- Bootstrap is called once before the retry loop ✓
- Assemble is called at the top of each retry iteration ✓
- Compact is called on overflow, then re-assemble ✓

**Impact:** This is a code organization issue, not a behavioral one. The calls happen in the right order. Factoring into named helpers would improve readability and testability but doesn't affect runtime behavior. LOW priority.

---

### F2-06: Token Budget Management

- **Classification:** MISALIGNED
- **Parallx file:** `src/openclaw/openclawTokenBudget.ts` lines 38-51 (`computeTokenBudget`), `src/services/tokenBudgetService.ts`
- **Upstream reference:** `attempt.context-engine-helpers.ts:52-73` — token budget passed to assemble
- **Divergence:** Two-layer budget system with potential conflict.
- **Severity:** MEDIUM

**Evidence:**

Parallx has **two** token budget systems:

1. **`openclawTokenBudget.ts`** (`computeTokenBudget`): Fixed 10/30/30/30 percentage split. Used by the OpenClaw context engine.
   ```ts
   export function computeTokenBudget(contextWindow: number): IOpenclawTokenBudget {
     return {
       total: clamped,
       system: Math.floor(clamped * 0.10),
       rag: Math.floor(clamped * 0.30),
       history: Math.floor(clamped * 0.30),
       user: Math.floor(clamped * 0.30),
     };
   }
   ```

2. **`services/tokenBudgetService.ts`** (`TokenBudgetService`): Elastic demand-driven allocation (M20 Phase G). Uses trim priorities instead of fixed percentages.

**Problem:** The OpenClaw pipeline uses `computeTokenBudget` for its fixed 10/30/30/30 split, but the `estimateTokens` function is imported from `tokenBudgetService.ts` (the elastics service). The two systems are partially coupled but conceptually different:

- `openclawTokenBudget.computeTokenBudget()` → fixed percentages → used by context engine's `assemble()` to determine lane budgets
- `tokenBudgetService.allocateBudget()` → elastic demand-driven → used by built-in chat

**Is this a problem?** The OpenClaw engine consistently uses `computeTokenBudget`, and the shared `estimateTokens` function (chars/4 heuristic) is identical in both. The two systems don't conflict at runtime — they serve different code paths. However, there's a conceptual drift: the "official" budget system has moved to elastic allocation, but the OpenClaw engine still uses fixed percentages.

**What upstream does:** Upstream passes the token budget as a single number to `assembleAttemptContextEngine()`, which then delegates budget management to the context engine implementation. The engine decides internally how to split. This is closer to what Parallx's `OpenclawContextEngine.assemble()` does — it receives `tokenBudget` (total) and internally computes lane splits via `computeTokenBudget`.

**Gap:** The fixed 10/30/30/30 split doesn't adapt to actual content. If the system prompt only uses 3% of budget, the remaining 7% is wasted instead of being redistributed to RAG or history. The elastic service solves this, but the OpenClaw engine doesn't use it.

**Impact:** MEDIUM — budget waste reduces effective context window for local models that already have limited context. A 4096-token model loses meaningful capacity from fixed splits.

---

## Anti-Patterns Check

| Anti-Pattern | Found? | Location | Details |
|-------------|--------|----------|---------|
| Output repair | **YES** (minor) | `openclawContextEngine.ts` lines 304-307 | `assessEvidence` + `buildEvidenceConstraint` inject systemPromptAddition when evidence is insufficient. This is borderline — it's adding instructions to the prompt, not rewriting model output. However, the re-retrieval query reformulation (`buildRetrieveAgainQuery`) uses heuristic string manipulation. |
| Pre-classification (regex routing) | No | — | Not present in context engine |
| Heuristic patchwork | **YES** (minor) | `openclawContextEngine.ts` line 482 | `buildRetrieveAgainQuery` strips question framing via regex: `.replace(/^(?:what|how|where|...)`. This is a heuristic for query reformulation. |
| Over-engineering | No | — | Implementation is appropriately scoped |

---

## Test Coverage Assessment

### Existing Coverage (24 tests, all passing)

| Area | Tests | Coverage Quality |
|------|-------|-----------------|
| `computeTokenBudget` | 3 | ✓ Good — basic split + edge cases |
| `estimateMessagesTokens` | 2 | ✓ Good — normal + empty |
| `trimTextToBudget` | 2 | ✓ Good — within budget + over budget |
| `OpenclawContextEngine.bootstrap()` | 2 | ✓ Good — all ready + partial |
| `OpenclawContextEngine.assemble()` | 8 | ✓ Good — parallel retrieval, message delivery, memory, concepts, transcripts, budget limits, sources, history trimming, service failures |
| `OpenclawContextEngine.compact()` | 6 | ✓ Good — min messages guard, simple trim, summarization, memory flush, failure resilience, assemble-compact-reassemble cycle |

### Missing Coverage (needs tests)

1. **`afterTurn()` method** — no tests. Currently a no-op, but should have at least a smoke test.
2. **Evidence assessment integration** — `assessEvidence` and re-retrieval (`buildRetrieveAgainQuery`) are called in `assemble()` but not directly tested via the context engine tests (they may have separate tests).
3. **Sub-lane budget boundary conditions** — the 55/15/15/10/5 RAG sub-lane split isn't tested at exact boundaries.
4. **`computeTokenBudget` partitioning accuracy** — `10 + 30 + 30 + 30 = 100`, but `Math.floor` means they sum to less than total. No test verifies the sum.
5. **Page content integration** — page content is mocked but the page-budget gate isn't tested at the boundary.
6. **`tokenBudgetService.estimateTokens` re-export** — no test verifies that the re-export from `openclawTokenBudget.ts` is the same function as `tokenBudgetService.estimateTokens`.
7. **Integration with turn runner** — no integration test verifying the full `bootstrap → assemble → compact → re-assemble` cycle through `runOpenclawTurn`.

---

## Critical Findings

### CRITICAL: None

There are no critical findings. The context engine is structurally sound and the core lifecycle works correctly.

### HIGH: None

### MEDIUM: Two findings

1. **F2-04: No transcript maintenance (separate from compaction)**  
   Parallx conflates maintenance with compaction. Upstream has separate `maintain` (editorial transcript rewrite) and `compact` (emergency summarization). This limits Parallx's ability to do quality improvements to conversation context between turns.

2. **F2-06: Fixed-percentage budget doesn't adapt to actual demand**  
   The 10/30/30/30 split wastes budget when slots are underutilized. Small system prompts waste their 10% allocation. The elastic `TokenBudgetService` (M20 Phase G) already solves this but isn't wired into the OpenClaw engine.

### LOW: One finding

3. **F2-05: Per-attempt helpers inlined rather than factored**  
   Bootstrap and assembly are inlined in `runOpenclawTurn` rather than being named helper functions. Functionally correct but reduces testability and readability.

---

## Summary: Capability Status

| Status | Count | Capabilities |
|--------|-------|-------------|
| ALIGNED | 3 | F2-01 (Interface), F2-02 (Init), F2-03 (Registry) |
| MISALIGNED | 2 | F2-04 (Maintenance), F2-06 (Token Budget) |
| HEURISTIC | 0 | — |
| MISSING | 0 | — |
| N/A | 1 | F2-03 (Registry — acceptable as N/A for desktop) |

**Net assessment:** F2 is in much better shape than the original gap matrix indicated. The core architecture is sound. The two MISALIGNED findings are optimization opportunities, not structural defects. The context engine correctly implements the upstream lifecycle pattern (bootstrap → assemble → compact → afterTurn) and is properly integrated into the execution pipeline.

---

## Gap Matrix Updates Needed

| ID | Old Status | New Status | Notes |
|----|-----------|-----------|-------|
| F2-01 | MISSING | **ALIGNED** | Interface implemented with correct lifecycle methods |
| F2-02 | MISSING | **ALIGNED** | Init handled by direct instantiation + bootstrap() |
| F2-03 | MISSING | **ALIGNED** | Single engine, no registry needed for desktop |
| F2-04 | MISSING | **MISALIGNED** | compact() exists but no separate maintain() |
| F2-05 | MISSING | **MISALIGNED** | Helpers inlined, functionally correct |
| F2-06 | MISALIGNED | **MISALIGNED** | Fixed 10/30/30/30 works but doesn't adapt to demand |
