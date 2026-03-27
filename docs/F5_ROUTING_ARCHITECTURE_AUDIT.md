# F5 Routing Architecture — Parity Audit

**Domain:** F5 — Routing Architecture  
**Iteration:** 1 (Structural)  
**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor  

---

## Per-Capability Classification

| ID | Capability | Original Status | Revised Status | Severity |
|----|-----------|----------------|----------------|----------|
| F5-01 | Route resolution | HEURISTIC | **ALIGNED** | — |
| F5-02 | Off-topic detection | HEURISTIC | **ALIGNED** | — |
| F5-03 | Conversational detection | HEURISTIC | **ALIGNED** | — |
| F5-04 | Product semantics Q&A | HEURISTIC | **ALIGNED** | — |
| F5-05 | Broad workspace summary | HEURISTIC | **HEURISTIC** | MEDIUM |

**Summary:** 4 ALIGNED, 1 HEURISTIC

---

## Key Findings

1. F5-01 through F5-04 are all ALIGNED — the regex routing cascades, off-topic detection,
   conversational detection, and product semantics Q&A have all been removed.

2. F5-05 remains HEURISTIC — `BROAD_WORKSPACE_PATTERNS` (4 regexes) + `isBroadWorkspaceSummaryPrompt()` 
   + `detectSemanticFallback()` still pre-classify user input via regex before the model runs.

3. Additional finding (F5-adjacent): `isWorkspaceDocumentListingQuery()` in 
   `openclawWorkspaceDocumentListing.ts` is a regex model-bypass heuristic.

4. Dead type debt: `IChatTurnRoute.kind` union still contains stale values from removed heuristics.

5. Test coverage for F5 surfaces is essentially zero.

---

## Anti-Pattern Assessment

- `BROAD_WORKSPACE_PATTERNS` — pre-classification anti-pattern (regex routing before model)
- `isWorkspaceDocumentListingQuery()` — model-bypass anti-pattern
- Dead type literals in `IChatTurnRoute.kind` — preservation bias
