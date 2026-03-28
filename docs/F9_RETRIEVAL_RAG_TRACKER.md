# F9: Retrieval & RAG — TRACKER

**Domain:** F9 Retrieval & RAG  
**Status:** RE-CLOSED ✅ (Iteration 4)  
**Date opened:** 2026-03-27  
**Date re-opened:** 2026-06-26  
**Date re-closed:** 2026-06-26

---

## Scorecard (Current — Iteration 4)

| Capability | Status |
|---|---|
| F9.1 Hybrid search (RRF) | **ALIGNED** ✅ |
| F9.2 No heuristic post-processing | **ALIGNED** ✅ |
| F9.3 Score threshold filter | **ALIGNED** ✅ |
| F9.4 Config knobs match upstream | **ALIGNED** ✅ |
| F9.5 Token budget absent at retrieval layer | **ALIGNED** ✅ |
| Internal artifact hygiene (.parallx) | **ACCEPTED** (desktop adaptation) |

**Result:** 4/5 ALIGNED + 1 ACCEPTED = CLOSED ✅

### Previous Scorecard (Iterations 1–3b — SUPERSEDED)

The prior closure was incorrect: 5/5 ALIGNED was based on a shallow audit that
classified 16 Parallx inventions as "acceptable." The re-audit (Iteration 4)
found the file was 80% invented code with zero upstream basis. See Iteration 4
for the full accounting.

---

## Key Files

| File | Role |
|---|---|
| `src/services/retrievalService.ts` | Platform retrieval service — 291 lines, upstream-aligned |
| `src/openclaw/openclawContextEngine.ts` | RAG budget lanes, evidence assessment, re-retrieval |
| `src/openclaw/openclawTokenBudget.ts` | Elastic token budget with RAG ceiling redistribution |
| `src/openclaw/openclawResponseValidation.ts` | `assessEvidence()` + `buildEvidenceConstraint()` |
| `src/aiSettings/ui/sections/retrievalSection.ts` | Retrieval settings UI (3 controls) |
| `src/aiSettings/unifiedConfigTypes.ts` | Config types (3 retrieval settings) |

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

- [x] `docs/F9_RETRIEVAL_RAG_AUDIT.md` (original)
- [x] `docs/F9_RETRIEVAL_RAG_AUDIT_R2.md` (re-audit)
- [x] `docs/F9_RETRIEVAL_RAG_GAP_MAP.md` (original)
- [x] `docs/F9_RETRIEVAL_RAG_GAP_MAP_R2.md` (re-audit gap map)
- [x] `docs/F9_RETRIEVAL_RAG_TRACKER.md`

---

## Iteration 4 — Full Retrieval Rewrite (2026-06-26)

**Trigger:** User identified that 7 retrieval settings in AI Settings panel are Parallx
inventions that compromise parity. Re-audit confirmed: 0 ALIGNED, 2 MISALIGNED,
16 INVENTION, 2 ACCEPTED. Previous "5/5 ALIGNED" was incorrect.

**Auditor:** AI Parity Auditor (deep re-audit)  
**Scope:** Full `retrievalService.ts` + config types + UI settings

### Audit Findings (Iteration 4a — Pre-fix)

| ID | Finding | Classification |
|----|---------|---------------|
| F9-R2-A01 | 6 regex query analysis functions | INVENTION — pre-classification anti-pattern |
| F9-R2-A02 | Query decomposition pipeline | INVENTION — no upstream basis |
| F9-R2-A03 | Query rewriting (buildGuardedRewrite) | INVENTION — no upstream basis |
| F9-R2-A04 | Candidate breadth modes (simple/exact/hard) | INVENTION — no upstream basis |
| F9-R2-A05 | Per-source deduplication caps | INVENTION — no upstream basis |
| F9-R2-A06 | Token budget at retrieval layer | INVENTION — duplicates context engine |
| F9-R2-A07 | Multi-variant parallel search | INVENTION — upstream does single search |
| F9-R2-A08 | 4 invented settings (decomposition, breadth, maxPerSource, tokenBudget) | INVENTION — upstream has 2 knobs |
| F9-R2-A09 | Explicit source resolution (regex pattern matching) | INVENTION — pre-classification |
| F9-R2-A10 | 12 invented constants (overfetch factors, stopwords, etc.) | INVENTION |

### Changes Applied

| Gap | Change | Lines |
|-----|--------|-------|
| G01 | Removed 14 query analysis functions + 12 constants + 5 types | −495 |
| G02 | Removed `_applyTokenBudget()` | −80 |
| G03 | Removed `_deduplicateSources()` | −25 |
| G04 | Replaced `_collectCandidates`/`_runSingleSearch` with single `vectorStore.search()` | −80 |
| G05 | Removed `retrieveMulti()` (zero callers) + removed from IRetrievalService | −74 |
| G06 | Removed 4 settings from UI + config types | −132 |
| G07 | Updated tests for simplified pipeline | −120 |
| G08 | KEPT `_applyInternalArtifactHygiene()` (desktop adaptation) | 0 |

**Net:** 1,005 → 291 lines (−714 lines)

### Re-Audit Findings (Iteration 4b — Post-fix)

| Capability | Status |
|---|---|
| F9.1 Hybrid RRF ranking | **ALIGNED** ✅ |
| F9.2 No heuristic post-processing | **ALIGNED** ✅ |
| F9.3 Score threshold filter | **ALIGNED** ✅ |
| F9.4 Config knobs match upstream (topK + minScore) | **ALIGNED** ✅ |
| F9.5 Token budget absent at retrieval layer | **ALIGNED** ✅ |
| Internal artifact hygiene | **ACCEPTED** (desktop adaptation) |

Anti-pattern scan: ALL CLEAN.

### Verification

- **TypeScript:** 0 errors (`tsc --noEmit`)
- **Tests:** 134 files, 2,516 tests, 0 failures
- **UX Guardian:** ✅ CLEAR — 3 remaining settings render correctly, no broken surfaces
