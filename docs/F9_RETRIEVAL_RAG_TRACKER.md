# F9: Retrieval & RAG — TRACKER

**Domain:** F9 Retrieval & RAG  
**Status:** CLOSED ✅  
**Date opened:** 2026-03-27  
**Date closed:** 2026-03-27

---

## Scorecard

| Capability | Status |
|---|---|
| Hybrid search (RRF) | **ALIGNED** ✅ |
| No heuristic post-processing | **ALIGNED** ✅ |
| Token budget for RAG | **ALIGNED** ✅ |
| Evidence quality assessment | **ALIGNED** ✅ |
| Re-retrieval on insufficient evidence | **ALIGNED** ✅ |

**Result:** 5/5 ALIGNED

---

## Key Files

| File | Role |
|---|---|
| `src/services/retrievalService.ts` | Platform retrieval service — hybrid RRF, 1138 lines |
| `src/openclaw/openclawContextEngine.ts` | RAG budget lanes, evidence assessment, re-retrieval |
| `src/openclaw/openclawTokenBudget.ts` | Elastic token budget with RAG ceiling redistribution |
| `src/openclaw/openclawResponseValidation.ts` | `assessEvidence()` + `buildEvidenceConstraint()` |

---

## Upstream References

| Pattern | Upstream | Parallx |
|---|---|---|
| Hybrid search | Simple RRF (vector + keyword, k=60) | `_vectorStore.search()` with RRF k=60 |
| No post-processing | Model decides relevance | All 8+ heuristic stages deleted in Phase 4 |
| Token budget | Context assembly within budget | Elastic budget with 5 sub-lane allocation |
| Input shaping | Prompt adjustment based on retrieval quality | `assessEvidence()` → `buildEvidenceConstraint()` → `systemPromptAddition` |

---

## Iteration Log

### Iteration 1 — Structural Audit (2026-03-27)

**Auditor:** AI Parity Auditor  
**Scope:** Full F9 domain (5 capabilities)

**Findings:** 5/5 ALIGNED. 2 LOW cleanup items (stale comment, dead utilities).  
**Actions:** Fixed stale `cosineRerank` reference in `dotProduct()` JSDoc.  
**Verification:** 0 TS errors, 130 files, 2436 tests, 0 failures.

### Iteration 2 — Refinement (2026-03-27) [SUPERSEDED]

**Auditor:** Parity Orchestrator (rubber-stamped — superseded by 2b)

### Iteration 2b — Deep Refinement Audit (2026-06-25)

**Auditor:** AI Parity Auditor (substantive re-audit)  
**Scope:** All 5 capabilities, code-level trace

**Findings:**

| ID | Finding | Classification | Severity |
|----|---------|---------------|----------|
| F9-R2-01 | RRF k=60 two-path fusion, no post-RRF manipulation | ALIGNED | — |
| F9-R2-02 | Density-based budget packing (Parallx adaptation) | ACCEPTED | LOW |
| F9-R2-03 | Pre-retrieval multi-variant query planning | ACCEPTED | LOW |
| F9-R2-04 | Re-retrieval on insufficient evidence | ALIGNED | — |
| F9-R2-05 | Sub-lane budget 55/15/15/10/5% enforced | ALIGNED | — |
| F9-R2-06 | computeElasticBudget edge cases | ALIGNED | — |
| F9-R2-07 | trimTextToBudget correct | ALIGNED | — |
| F9-R2-08 | Re-retrieval path: ZERO test coverage | GAP → FIXED | MEDIUM |
| F9-R2-09 | dotProduct/cosineSimilarity unused utilities | ACCEPTED | LOW |
| F9-R2-10 | assessEvidence pre-model input shaping | ACCEPTED | LOW |

**Fix:** Added 4 tests for re-retrieval path (insufficient→re-retrieve, sufficient→no call, URI dedup, failure handling)

**Verification:** 132 files, 2506 tests, 0 failures, 0 TS errors

### Iteration 3 — Confirmation (2026-03-27) [SUPERSEDED]

**Auditor:** Parity Orchestrator (rubber-stamped — superseded by 3b)

### Iteration 3b — Confirmation Audit (2026-06-25)

**Auditor:** AI Parity Auditor (independent verification)  
**Verdict:** **PASS**

| ID | Fix | Classification |
|----|-----|---------------|
| F9-R2-08 | 4 re-retrieval tests genuine and exercising real paths | VERIFIED |

**Additional checks:**
- All 9 deleted heuristic methods confirmed absent
- RRF fusion unchanged, sub-lane budget unchanged
- 45/45 context engine tests passing
- Full suite: 132 files, 2506 tests, 0 failures

---

## Documentation Checklist

- [x] `docs/F9_RETRIEVAL_RAG_AUDIT.md`
- [x] `docs/F9_RETRIEVAL_RAG_GAP_MAP.md`
- [x] `docs/F9_RETRIEVAL_RAG_TRACKER.md`
