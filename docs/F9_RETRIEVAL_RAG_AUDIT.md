# F9: Retrieval & RAG — AUDIT

**Domain:** F9 Retrieval & RAG  
**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor (iter 1), Parity Orchestrator (iter 2 refinement, iter 3 confirmation)  
**Status:** 5/5 ALIGNED ✅

---

## Summary Table

| Capability | Status | Evidence |
|---|---|---|
| Hybrid search (RRF) | **ALIGNED** ✅ | `retrievalService.ts` — embed → hybrid RRF → basic filtering. No post-retrieval score manipulation. |
| No heuristic post-processing | **ALIGNED** ✅ | All 8+ heuristic stages confirmed absent. Phase 4 of M41 removed them. |
| Token budget for RAG | **ALIGNED** ✅ | Context engine allocates sub-lane budgets. Elastic redistribution from underused lanes. |
| Evidence quality assessment | **ALIGNED** ✅ | `assessEvidence()` → input shaping only. Never post-generation. |
| Re-retrieval on insufficient evidence | **ALIGNED** ✅ | Context engine reformulates query and retries on insufficient evidence. |

---

## Per-Capability Findings

### 1. Hybrid Search (Vector + Keyword, RRF) — ALIGNED ✅

**Upstream pattern:** Simple RRF (vector + keyword, k=60). Model decides relevance.

**Parallx state:** `RetrievalService.retrieve()` performs: embed query → hybrid search via `_vectorStore.search()` (RRF k=60) → basic filtering (corpus hygiene, score threshold, dedup, token budget). Multi-variant query plans merge by max score — no heuristic score manipulation.

### 2. No Heuristic Post-Processing — ALIGNED ✅

**Upstream pattern:** No post-retrieval score manipulation.

**Parallx state:** All 8+ deleted heuristic methods confirmed absent from `retrievalService.ts`:
- ~~`_applyLexicalFocusBoost`~~ ✓
- ~~`_applyIntentAwareSourceBoost`~~ ✓
- ~~`_applySecondStageRerank`~~ ✓
- ~~`_scoreLateInteractionMatch`~~ ✓
- ~~`_applyDiversityReordering`~~ ✓
- ~~`_applyEvidenceRoleBalancing`~~ ✓
- ~~`_applyStructureAwareExpansion`~~ ✓
- ~~`_shouldExpandStructure`~~ ✓
- ~~`_cosineRerank`~~ ✓

Also absent: `extractFocusTerms`, `collectRerankFocusTerms`, `isInsuranceCorpusCandidate`, `EvidenceRole`.

**Note:** `_applyTokenBudget()` uses density-based packing (`densityScore = score / sqrt(tokens)`) which is a budget-packing optimization, NOT relevance re-ranking. Base score ordering preserved. Acceptable.

### 3. Token Budget for RAG — ALIGNED ✅

**Upstream pattern:** Context engine assembles content within token budget.

**Parallx state:** Context engine at `openclawContextEngine.ts` allocates sub-lane budgets:
- Primary retrieval: 55%
- Open page: 15%
- Recalled memories: 15%
- Transcripts: 10%
- Concepts: 5%

Elastic budget in `openclawTokenBudget.ts` redistributes surplus from underused lanes to RAG. Each section checked against lane budget before inclusion.

### 4. Evidence Quality Assessment — ALIGNED ✅

**Upstream pattern:** Adjust prompt context based on retrieval quality.

**Parallx state:** `assessEvidence()` called only from `assemble()` in context engine. Result feeds `buildEvidenceConstraint()` which produces `systemPromptAddition` — a pre-model prompt constraint. Never used post-generation. Insurance-domain hardcoding removed in F6 audit.

### 5. Re-Retrieval on Insufficient Evidence — ALIGNED ✅

**Upstream pattern:** Context engine supports re-retrieval.

**Parallx state:** When `evidence.status === 'insufficient'`, context engine calls `buildRetrieveAgainQuery()` to reformulate, fires second `retrieveContext()`, merges by URI dedup, re-assesses evidence. Clean re-retrieval pattern.

### 6. Parallel Context Loading — ALIGNED ✅

All five retrieval services fired concurrently via `Promise.all()`: `retrieveContext`, `recallMemories`, `recallConcepts`, `getCurrentPageContent`, `recallTranscripts`. Each guarded by readiness check and `.catch(() => undefined)` for fault isolation.

---

## Cleanup Items (LOW severity)

| Item | Status |
|---|---|
| Stale comment on `dotProduct()` referencing deleted `cosineRerank` | FIXED ✅ |
| `dotProduct()` and `cosineSimilarity()` have no production callers | ACCEPTED — tested utilities, may be useful in future |

---

## Iteration History

| Iter | Type | Findings | Actions |
|---|---|---|---|
| 1 | Structural | 5/5 ALIGNED. 2 LOW cleanup items. | Fixed stale comment on `dotProduct()`. |
| 2 | Refinement | Confirmed no orphaned heuristic references. | None |
| 3 | Confirmation | 5/5 ALIGNED. All 8+ deleted stages confirmed absent. | None |
