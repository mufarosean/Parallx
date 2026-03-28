# F8 Context Engine / Memory — Iteration 1 Audit

**Auditor:** AI Parity Auditor  
**Date:** 2026-03-27  
**Domain:** F8 — Context Engine / Memory  
**Upstream baseline:** OpenClaw commit e635cedb  
**Iteration:** 1 (Structural)

---

## Summary

| Metric | Value |
|--------|-------|
| Capabilities audited | 15 |
| ALIGNED | 11 |
| MISALIGNED | 2 |
| MISSING | 1 |
| N/A | 1 |

---

## Per-Capability Findings

### F8-1: IOpenclawContextEngine interface matches upstream ContextEngine contract shape
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 40-46
- **Upstream reference:** `context-engine/types.ts` lines 104-230
- **Evidence:** Parallx defines `IOpenclawContextEngine` with:
  - `bootstrap?()` — matches upstream `bootstrap`
  - `assemble()` — matches upstream `assemble`
  - `compact()` — matches upstream `compact`
  - `afterTurn?()` — matches upstream `afterTurn`
- **Adaptation:** Lines 29-38 document which upstream methods are NOT adopted:
  - `maintain` → handled by compact
  - `ingest/ingestBatch` → platform handles message persistence
  - `prepareSubagentSpawn/onSubagentEnded` → no subagents in Parallx (N/A)
  - `dispose` → engine is per-turn, not long-lived
- **AssembleResult comparison:** Upstream returns `{ messages, estimatedTokens, systemPromptAddition? }`. Parallx extends with `ragSources` and `retrievedContextText` — Parallx-specific additions that don't conflict with upstream contract.

### F8-2: bootstrap() checks service readiness before assemble()
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 148-160
- **Upstream reference:** `attempt.context-engine-helpers.ts` — `runAttemptContextEngineBootstrap`
- **Evidence:** `bootstrap()` checks existence of all 5 service methods, sets internal flags (`_ragReady`, `_memoryReady`, `_conceptsReady`, `_transcriptsReady`, `_pageReady`). The turn runner calls `engine.bootstrap()` before the retry loop (openclawTurnRunner.ts lines 93-98). `assemble()` guards all service calls with the respective readiness flags.
- **Lifecycle:** bootstrap called once → flags persist for all assemble/compact calls within the turn.

### F8-3: assemble() builds messages under token budget
- **Classification:** MISALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 162-270, `src/openclaw/openclawAttempt.ts` lines 178-190
- **Upstream reference:** `assembleAttemptContextEngine` — builds messages to fit within token budget
- **Evidence:** Within `assemble()`, the budget computation is correct:
  - `computeTokenBudget(params.tokenBudget)` splits 10/30/30/30
  - History is trimmed to `budget.history` via `trimHistoryToBudget()`
  - RAG sub-lanes are capped within `budget.rag` internally
- **Divergence (CRITICAL):** All retrieval results (RAG, memory, concepts, transcripts, page content) are accumulated into `systemPromptAddition`. This string flows through `buildOpenclawPromptArtifacts()` → `buildOpenclawSystemPrompt()` → concatenated into the system prompt alongside identity, skills, tools, workspace digest, preferences, and overlay. In `openclawAttempt.ts` lines 178-190, the combined system prompt is then truncated to **10% of total context** (`Math.floor(context.tokenBudget * 0.10)`). This means RAG content (budgeted at 30% within assemble) competes with bootstrap content for a 10% slot. With an 8192-token context, the system prompt gets ~819 tokens — not enough for base prompt + 30% worth of RAG. The 30% RAG allocation is effectively lost to truncation.
- **Severity:** HIGH — This is the root cause of why RAG content may be heavily truncated in practice.

### F8-4: assemble() fires parallel retrieval (RAG + memory + concepts + transcripts + page)
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 171-193
- **Upstream reference:** Context engine parallel loading pattern
- **Evidence:** `Promise.all()` fires all 5 services concurrently:
  1. `retrieveContext` (RAG)
  2. `recallMemories`
  3. `recallConcepts`
  4. `getCurrentPageContent`
  5. `recallTranscripts`
- Each guarded by bootstrap readiness flag and wrapped in `.catch(() => undefined)` for fault isolation.

### F8-5: assemble() applies per-lane token budget limits
- **Classification:** MISALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 196-260
- **Upstream reference:** Token budget per context lane
- **Evidence:** Sub-lane limits are computed within `assemble()`:
  - Page: `budget.rag * 0.3` (30% of RAG = 9% of total)
  - RAG: `budget.rag` (100% of RAG = 30% of total)
  - Memory: `budget.rag * 0.2` (20% of RAG = 6% of total)
  - Concepts: `budget.rag * 0.1` (10% of RAG = 3% of total)
  - Transcripts: `budget.rag * 0.15` (15% of RAG = 4.5% of total)
  - History: `budget.history` (30% of total)
- **Divergence:** Two issues:
  1. **Sub-lane overflow:** The sub-lane caps sum to 175% of RAG budget. If all fire successfully, aggregate `systemPromptAddition` can exceed the 30% RAG allocation.
  2. **Downstream truncation:** Same issue as F8-3 — the aggregate `systemPromptAddition` is then truncated to 10% by the attempt's system prompt budget, not 30%.
- **Severity:** HIGH — Per-lane limits exist but don't compose correctly. No aggregate cap on combined retrieval output.

### F8-6: compact() uses summarization to reduce history (upstream pattern)
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 300-370
- **Upstream reference:** `compactEmbeddedPiSession` — summarization-based context compaction
- **Evidence:** `compact()` builds a transcript from `_lastHistory`, sends to `sendSummarizationRequest` model service with a proper summarization prompt. Replaces internal history with `[summary_message, ack_message, ...last_exchange]`. Uses a real model call (not heuristic).

### F8-7: compact() fallback when summarization fails (simple trim)
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 347-351
- **Evidence:** When `!summaryText` (model unavailable or call failed), falls back to keeping the most recent half of history: `history.slice(history.length - keepCount)` where `keepCount = Math.max(2, Math.floor(history.length / 2))`. Graceful degradation.

### F8-8: compact() flushes summary to long-term memory
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 361-370
- **Upstream reference:** Compaction → memory flush cycle
- **Evidence:** After successful summarization, calls `services.storeSessionMemory(params.sessionId, summaryText, messageCount)`. Wrapped in try/catch (non-fatal). Only fires when a real summary was generated.

### F8-9: afterTurn() hook exists for post-turn finalization
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 372-377
- **Upstream reference:** Context engine finalization step
- **Evidence:** `afterTurn()` is defined, implemented (no-op body), and called from `openclawAttempt.ts` line 357. Comment documents that the platform handles message persistence, making the hook an extension point for future use (e.g., concept extraction). The upstream equivalent commits context mutations; in Parallx, the platform fulfills this responsibility.
- **Note:** Acceptable Parallx adaptation since the platform handles persistence.

### F8-10: Turn runner calls engine lifecycle correctly
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawTurnRunner.ts` lines 86-185
- **Upstream reference:** L2 `runAgentTurnWithFallback`, L3 retry constants
- **Evidence:** Full lifecycle wired:
  1. `engine.bootstrap()` — called once before retry loop (line 93)
  2. `engine.assemble()` — called at top of each iteration (line 106)
  3. `executeOpenclawAttempt()` — calls model (line 132)
  4. On overflow: `engine.compact()` → continue loop (line 151)
  5. On timeout: `engine.compact(force)` → continue loop (line 167)
  6. On transient: exponential backoff delay → continue (line 179)
  7. `engine.afterTurn()` — called at end of attempt (openclawAttempt.ts line 357)
- **Constants match upstream:** `MAX_OVERFLOW_COMPACTION=3`, `MAX_TIMEOUT_COMPACTION=2`, `TRANSIENT_BASE_DELAY=2500ms`
- **Bonus:** Pre-model auto-compact when assembled context > 80% of budget (line 118).

### F8-11: Token budget computation matches M11 spec (10/30/30/30)
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawTokenBudget.ts` lines 48-55
- **Evidence:** `computeTokenBudget()` returns:
  - `system: Math.floor(clamped * 0.10)` — 10%
  - `rag: Math.floor(clamped * 0.30)` — 30%
  - `history: Math.floor(clamped * 0.30)` — 30%
  - `user: Math.floor(clamped * 0.30)` — 30%
- Token estimation: `Math.ceil(text.length / 4)` — chars/4 heuristic from M9 spec.
- **Note:** Computation is correct. The issue is in how the budget is *applied* (see F8-3, F8-5).

### F8-12: Evidence assessment + re-retrieval on insufficient evidence
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawResponseValidation.ts` lines 201-262 (assessEvidence), `src/openclaw/openclawContextEngine.ts` lines 234-260 (re-retrieval)
- **Upstream reference:** Evidence quality constraints pattern
- **Evidence:** Three-stage flow:
  1. `assessEvidence()` classifies as sufficient/weak/insufficient using query-term overlap, source count, section count, coverage focus terms
  2. On insufficient: `buildRetrieveAgainQuery()` reformulates, calls `retrieveContext()` again, merges results, deduplicates sources, re-assesses
  3. On still-insufficient/weak: `buildEvidenceConstraint()` adds model prompt constraint
- Implementation is thorough with specific domain-aware coverage focus detection.

### F8-13: History trimming respects budget (most recent kept, oldest dropped)
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 380-400
- **Evidence:** `trimHistoryToBudget()` iterates from end to beginning (most recent first). Accumulates token estimates (`4 + estimateTokens(msg.content)` per message, with 4 for role overhead). Breaks when budget exceeded. Returns messages in original order via `result.unshift(msg)`.

### F8-14: Engine services type includes all needed platform services
- **Classification:** ALIGNED
- **Parallx file:** `src/openclaw/openclawContextEngine.ts` lines 108-119
- **Evidence:** `IOpenclawContextEngineServices` picks from `IDefaultParticipantServices`:
  - `retrieveContext` — RAG ✓
  - `recallMemories` — memory recall ✓
  - `recallConcepts` — concept recall ✓
  - `recallTranscripts` — transcript recall ✓
  - `getCurrentPageContent` — current page ✓
  - `storeSessionMemory` — memory flush on compact ✓
  - `storeConceptsFromSession` — concept storage ✓
  - `sendSummarizationRequest` — model call for compaction ✓
- All 8 services are used by the engine implementation.

### F8-15: Unit tests exist for context engine
- **Classification:** MISSING
- **Evidence:** Searched all test files in `tests/unit/`:
  - No file named `openclawContextEngine.test.ts` or `openclawTokenBudget.test.ts`
  - Grep for `contextEngine|ContextEngine|openclawContextEngine|openclawTokenBudget` in `tests/unit/` returned zero matches
  - `chatGroundedResponseHelpers.test.ts` tests the OLD legacy `assessEvidenceSufficiency`, not the OpenClaw engine's `assessEvidence`
  - `chatService.test.ts` has evidence-related tests but for the old chat service, not the OpenClaw pipeline
- **Severity:** HIGH — No unit test coverage for the context engine, token budget, compact logic, parallel retrieval, or history trimming.

---

## Cross-Domain Observations

### Budget Architecture Mismatch (affects F1 Execution Pipeline, F3 System Prompt)
The most significant finding is the **budget lane collision** between the context engine and the system prompt builder:

1. The context engine's `assemble()` correctly computes and applies a 30% RAG budget for retrieval content
2. This content is packaged as `systemPromptAddition`
3. The system prompt builder (`openclawSystemPrompt.ts`) concatenates it into the system prompt alongside identity, skills, tools, workspace digest, preferences, and overlay
4. The attempt (`openclawAttempt.ts`) then truncates the combined system prompt to 10% of total context

This means the **30% RAG allocation is compressed into a 10% slot** shared with all other system prompt content. For an 8192-token model, the system prompt gets ~819 tokens — insufficient for base prompt + any meaningful amount of RAG content.

**Root cause:** The upstream architecture likely keeps retrieval content separate from the base system prompt, or doesn't cap the system prompt at a fixed percentage. Parallx conflated "system prompt" (base instructions) with "context engine additions" (RAG results) in a single message.

**Fix direction:** Either:
- (a) Put RAG content in a separate `user` message between system and history (preserves audience isolation), or
- (b) Raise the system message budget to `system + rag` (40%) when assembling messages, or
- (c) Remove the system prompt truncation in attempt.ts and let the total budget cap govern behavior

### Evidence Assessment (affects F6 Response Quality)
The `assessEvidence` function in `openclawResponseValidation.ts` contains domain-specific heuristics (insurance-focused coverage terms like "collision coverage", "uninsured motorist"). While functional, this couples the evidence assessment to a specific demo domain. The upstream pattern would be domain-agnostic. This should be flagged when F6 is audited.

### Extractive Fallback (affects F6 Response Quality)
`buildExtractiveFallback()` in `openclawResponseValidation.ts` is a response repair function that reconstructs answers from RAG content when the model returns empty. This is an **output repair anti-pattern** — exactly what M41 identifies as a root cause of poor AI quality. Should be flagged during F6 audit.

---

## Recommendations (Priority Order)

### P1: Fix Budget Lane Collision (F8-3, F8-5) — HIGH
The RAG content must not be truncated to fit within the 10% system prompt budget. Options:
1. **Preferred:** Separate RAG content into its own message role. Instead of merging into `systemPromptAddition`, return it as additional messages in the `assemble()` result. The attempt then places these between the system message and history.
2. **Alternative:** In attempt.ts, apply a combined budget of `system.budget + rag.budget` (40% of total) to the system prompt when it includes systemPromptAddition.
3. **Minimum:** Remove the 10% truncation in attempt.ts line 178 and let the natural context overflow → compact cycle handle oversized prompts.

### P2: Add Context Engine Unit Tests (F8-15) — HIGH
Create `tests/unit/openclawContextEngine.test.ts` covering:
- `computeTokenBudget` with various context windows
- `estimateMessagesTokens` accuracy
- `trimHistoryToBudget` preserves recency
- `OpenclawContextEngine.bootstrap()` sets readiness flags
- `OpenclawContextEngine.assemble()` parallel retrieval and budget compliance
- `OpenclawContextEngine.compact()` summarization path and trim fallback
- `OpenclawContextEngine.compact()` memory flush

### P3: Add Aggregate RAG Budget Cap (F8-5) — MEDIUM
Within `assemble()`, add an aggregate cap on total `systemPromptAddition` size after all retrieval lanes contribute. Currently sub-lane limits sum to 175% of RAG budget. Add a final truncation step that ensures total retrieval content ≤ `budget.rag * 4` chars.

### P4: Remove Domain-Specific Evidence Heuristics — LOW (defer to F6)
The `extractCoverageFocusTerms` function and insurance-specific scoring in `buildExtractiveFallback` should be generalized or removed. Defer detailed treatment to the F6 (Response Quality) audit.

---

## Files Read

| File | Lines Read | Purpose |
|------|-----------|---------|
| `src/openclaw/openclawContextEngine.ts` | 1-430 (full) | Main context engine |
| `src/openclaw/openclawTokenBudget.ts` | 1-150 (full) | Token budget computation |
| `src/openclaw/openclawResponseValidation.ts` | 1-400 (full) | Evidence assessment |
| `src/openclaw/openclawTurnRunner.ts` | 1-195 (full) | Turn runner |
| `src/openclaw/openclawAttempt.ts` | 1-445 (full) | Attempt execution |
| `src/openclaw/openclawTypes.ts` | 1-400 (full) | Type definitions |
| `src/openclaw/openclawErrorClassification.ts` | 1-90 (full) | Error classifiers |
| `src/openclaw/openclawSystemPrompt.ts` | 85-120 | System prompt builder |
| `src/openclaw/openclawPromptArtifacts.ts` | 1-80 | Prompt artifact builder |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | 220-310 | Turn context builder |
| `src/services/tokenBudgetService.ts` | 140-160 | Shared token estimator |
| `docs/clawrallx/OPENCLAW_REFERENCE_SOURCE_MAP.md` | 1-250 | Upstream source reference |
| `docs/clawrallx/OPENCLAW_PIPELINE_REFERENCE.md` | 60-165 | Pipeline control flow |
| `docs/clawrallx/OPENCLAW_GAP_MATRIX.md` | 44-65 | Prior gap classifications |
