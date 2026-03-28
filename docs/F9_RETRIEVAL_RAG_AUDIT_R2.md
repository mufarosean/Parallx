# F9-R2: Deep Retrieval Parity Audit

**Domain:** F9 Retrieval & RAG  
**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor (R2 deep re-audit)  
**Status:** CRITICAL — Previous audit was superficial. Retrieval service is ~70% invented machinery with no upstream basis.

---

## Executive Summary

The previous F9 audit marked the retrieval surface as "5/5 ALIGNED". That was wrong. `retrievalService.ts` is **1,005 lines** where approximately **700+ lines are Parallx inventions** with zero upstream OpenClaw equivalent. The service implements a complex query analysis pipeline (regex decomposition, query rewriting, identifier extraction, keyword focusing, multi-variant search, explicit source resolution) that upstream doesn't have and doesn't need.

### Upstream OpenClaw Retrieval (Ground Truth)

**Files:** `src/memory/manager.ts`, `src/memory/manager-search.ts`, `src/memory/hybrid.ts`  
**Architecture:**
- `searchVector()` — cosine similarity via sqlite-vec
- `searchKeyword()` — BM25 via FTS5 + `buildFtsQuery()` (simple NLP → FTS5 syntax)
- `mergeHybridResults()` — weighted linear combination: `finalScore = vectorScore * 0.7 + textScore * 0.3`
- **Config knobs:** `query.maxResults` (default 10), `query.minScore` (default 0.35), `query.hybrid.vectorWeight` (0.7), `query.hybrid.textWeight` (0.3), `query.hybrid.candidateMultiplier` (3.0)
- **Optional:** MMR reranking (disabled by default), temporal decay (disabled by default)
- **No** query decomposition
- **No** query rewriting
- **No** identifier extraction
- **No** keyword focusing
- **No** multi-variant query planning
- **No** per-source caps at search layer
- **No** token budget at search layer (context engine handles budget)
- **No** explicit source resolution
- **No** corpus hygiene filtering at search layer
- **No** diagnostic trace types (6 interfaces, ~100 lines of types)

---

## 1. Summary Table — Every Retrieval Component Classified

| Component | Lines | Upstream Equivalent | Classification | Anti-Pattern | Recommendation |
|---|---|---|---|---|---|
| `retrieve()` — main pipeline | 501-617 | `MemoryIndexManager.search()` | **MISALIGNED** | Over-engineering | **SIMPLIFY** |
| `_buildQueryPlan()` | 773-868 | NONE | **INVENTION** | Pre-classification | **REMOVE** |
| `decomposeQuery()` | 215-242 | NONE | **INVENTION** | Pre-classification | **REMOVE** |
| `buildGuardedRewrite()` | 165-173 | NONE | **INVENTION** | Pre-classification | **REMOVE** |
| `buildKeywordFocusedQuery()` | 175-207 | `buildFtsQuery()` (different purpose) | **INVENTION** | Pre-classification | **REMOVE** |
| `extractCriticalIdentifiers()` | 121-155 | NONE | **INVENTION** | Pre-classification | **REMOVE** |
| `stripFormattingRequests()` | 111-117 | NONE | **INVENTION** | Pre-classification | **REMOVE** |
| `stripPromptFiller()` | 157-162 | NONE | **INVENTION** | Pre-classification | **REMOVE** |
| `_collectCandidates()` | 870-914 | Single `search()` call | **INVENTION** | Over-engineering | **REMOVE** |
| `_resolveExplicitSourceIds()` | 932-996 | NONE | **INVENTION** | Pre-classification | **REMOVE** |
| `_applyInternalArtifactHygiene()` | 1023-1055 | NONE (no `.parallx` concept) | **ACCEPTED** | — | **KEEP** (Parallx-specific) |
| `_deduplicateSources()` | 999-1021 | NONE | **INVENTION** | — | **REMOVE** |
| `_applyTokenBudget()` | 1057-1137 | NONE (context engine handles budget) | **INVENTION** | Over-engineering | **REMOVE** |
| `retrieveMulti()` | 694-764 | NONE | **INVENTION** | Over-engineering | **REMOVE** |
| `formatContext()` | 640-685 | NONE (context engine assembles) | **ACCEPTED** | — | **KEEP** (desktop adaptation) |
| `KEYWORD_FOCUS_STOPWORDS` | 38-50 | NONE | **INVENTION** | — | **REMOVE** |
| `EXPLICIT_SOURCE_QUERY_PATTERNS` | 399-406 | NONE | **INVENTION** | Pre-classification | **REMOVE** |
| `SOURCE_MATCH_STOPWORDS` | 408-412 | NONE | **INVENTION** | — | **REMOVE** |
| `cosineSimilarity()` / `dotProduct()` | 77-93 | In sqlite-vec engine | **MISALIGNED** | Dead code? | **AUDIT** |
| Diagnostic trace types | 290-392 | NONE | **INVENTION** | Over-engineering | **SIMPLIFY** |
| Overfetch constants | 31-36 | `candidateMultiplier` (single numeric) | **INVENTION** | Over-engineering | **REMOVE** |

### Counts
- **ALIGNED:** 0
- **MISALIGNED:** 2 (retrieve pipeline, cosine util)
- **INVENTION:** 16 components with no upstream equivalent
- **ACCEPTED (Parallx-specific):** 2 (corpus hygiene, formatContext)

---

## 2. Component-by-Component Analysis

### 2.1 `retrieve()` — Main Pipeline (L501-617)

**What it does:** Orchestrates a 7-stage retrieval pipeline: query plan → embed → collect candidates (multi-variant) → corpus hygiene → score filter → source dedup → token budget → topK trim.

**Upstream equivalent:** `MemoryIndexManager.search()` which does: embed query → run vector search + keyword search in parallel → `mergeHybridResults()` (weighted combination) → filter by `minScore` → return top `maxResults`. Three steps, not seven.

**Classification:** MISALIGNED

**M41 Anti-patterns:**
- **Over-engineering:** 7 stages where upstream has 3
- **Pre-classification:** Query analysis determines strategy (simple vs hard) before search runs

**Divergences:**
1. Query plan generation adds ~100 lines of regex pre-analysis that upstream doesn't have
2. Source dedup at search layer — upstream returns top N globally, context engine decides what fits
3. Token budget at search layer — upstream context engine handles budget, not search
4. Multi-variant search — upstream runs one search call, not N variants

**Recommendation:** SIMPLIFY to: embed → hybrid search → score filter → return topK. Token budget and source diversity belong in the context engine.

---

### 2.2 `_buildQueryPlan()` (L773-868) — ~95 lines

**What it does:** Regex-analyzes the user's query to classify it as simple/hard, detect cross-source signals, sequential signals, multiple question heads, identifier sensitivity, etc. Generates multiple query variants (raw, rewrite, decomposition, identifier-focus). Controls overfetch multiplier and per-query topK.

**Upstream equivalent:** **NONE**. Upstream calls search with the query as-is. One call. No analysis.

**Classification:** INVENTION

**M41 Anti-patterns:**
- **Pre-classification:** This is the textbook definition. Regex patterns analyze the user's message to decide retrieval strategy before the model sees any of it.
- **Invention:** 95 lines of query analysis that upstream simply doesn't do.

**Evidence:** Lines 780-800 contain regex patterns like:
```typescript
const hasCrossSourceSignal = /\b(across|cross-source|multiple|both|all|workflow|steps|process|follow-up|continue)\b/i.test(analysisQuery);
const hasSequentialSignal = /\b(then|after that|afterwards|next|finally)\b/i.test(analysisQuery);
```
This is exactly "pre-classification" — making retrieval decisions based on keyword matching instead of letting the search engine do its job.

**Recommendation:** REMOVE entirely. Pass query directly to hybrid search.

---

### 2.3 `decomposeQuery()` (L215-242) — ~28 lines

**What it does:** Splits a query on `;`, `?`, and conjunctions like "and also what..." into sub-queries. Filters sub-queries with <4 words.

**Upstream equivalent:** **NONE**

**Classification:** INVENTION

**M41 Anti-patterns:**
- **Pre-classification:** Regex splitting assumes multi-clause queries need separate searches
- **Invention:** Upstream handles multi-part questions with a single search call

**Evidence:**
```typescript
const firstPass = query
    .split(/[;?]+/)
    .flatMap((part) => part.split(/\s+(?:then|after that|afterwards|next|finally)\s+/i))
    .flatMap((part) => part.split(/\s+(?:and|also)\s+(?=(?:how|what|where|...)\b)/i))
```

**Recommendation:** REMOVE. If retrieval quality is insufficient for multi-part questions, the solution is better embeddings or broader topK, not regex query splitting.

---

### 2.4 `buildGuardedRewrite()` (L165-173) — ~9 lines

**What it does:** Strips filler ("please can you...", "show me...") from the query and appends any identifiers missing from the rewritten version.

**Upstream equivalent:** **NONE**

**Classification:** INVENTION — Pre-classification that assumes certain words hurt search quality.

**Recommendation:** REMOVE.

---

### 2.5 `buildKeywordFocusedQuery()` (L175-207) — ~33 lines

**What it does:** Tokenizes query, removes stopwords (from a 70+ word list), filters short tokens, builds a keyword-only string for the lexical (FTS5) search path.

**Upstream equivalent:** `buildFtsQuery()` in `src/memory/hybrid.ts` — converts NLP query to FTS5 syntax. But upstream's version is FTS5 syntax conversion, not semantic keyword extraction with a custom stopword list.

**Classification:** INVENTION — The custom stopword list and duplicate lexical query are Parallx constructions.

**Recommendation:** REMOVE. If FTS5 query formatting is needed, it belongs in `vectorStoreService.ts` (where the actual FTS5 interaction happens), not as a retrieval-layer invention.

---

### 2.6 `extractCriticalIdentifiers()` (L121-155) — ~35 lines

**What it does:** Regex patterns extract quoted phrases, dollar amounts, percentages, phone numbers, uppercase tokens (acronyms), filenames from the query.

**Upstream equivalent:** **NONE**

**Classification:** INVENTION

**M41 Anti-patterns:**
- **Pre-classification:** Regex analysis of query content to detect "identifiers" that influence search strategy
- **Invention:** Upstream has no concept of "critical identifiers" that change search behavior

**Evidence:** Regex patterns include phone numbers `(\([0-9]{3}\)\s*[0-9]{3}-[0-9]{4}\b)`, dollar amounts `(\$\d[\d,]*(?:\.\d+)?)`, and filenames `(\b[a-zA-Z0-9_-]+\.[a-z0-9]{1,8}\b)`. This is the retrieval service making assumptions about what's "important" in a query.

**Recommendation:** REMOVE.

---

### 2.7 `stripFormattingRequests()` (L111-117)

**What it does:** Removes "please cite your sources", "with citations" from queries.

**Upstream equivalent:** **NONE**

**Classification:** INVENTION — Assumes citation requests confuse search.

**Recommendation:** REMOVE.

---

### 2.8 `_collectCandidates()` (L870-914 ) — ~45 lines

**What it does:** Runs multiple query variants through hybrid search, each with separate embedding. Merges results by highest score, deduplicates by rowid.

**Upstream equivalent:** **NONE**. Upstream runs ONE search call.

**Classification:** INVENTION

**Recommendation:** REMOVE. With query planning removed, this becomes a single search call (which is what upstream does).

---

### 2.9 `_resolveExplicitSourceIds()` (L932-996) — ~65 lines

**What it does:** Detects "according to [document]" patterns via regex, then fuzzy-matches query tokens against indexed source filenames to restrict search to specific documents.

**Upstream equivalent:** **NONE**. Upstream's `memory_search` tool takes a `query` parameter. The model decides what to search for.

**Classification:** INVENTION

**M41 Anti-patterns:**
- **Pre-classification:** Regex patterns analyze query intent before model sees it
- **Invention:** Contains patterns like `\b(?:workflow|system|claims?)\s+architecture\b` — the `claims?` pattern is demo-workspace-flavored

**Evidence:** `EXPLICIT_SOURCE_QUERY_PATTERNS` at L399-406 includes `claims?` which is auto-insurance-demo specific.

**Recommendation:** REMOVE.

---

### 2.10 `_applyInternalArtifactHygiene()` (L1023-1055) — ~33 lines

**What it does:** Excludes `.parallx/` internal files (config, permissions, memory) from generic retrieval unless the user explicitly mentions them.

**Upstream equivalent:** **NONE** — upstream memory is in a separate directory, not mixed with user content. Desktop workbench needs this because all content is in one workspace.

**Classification:** **ACCEPTED** (Parallx-specific)

**Recommendation:** KEEP. This is a legitimate desktop adaptation — preventing config files from leaking into retrieval.

---

### 2.11 `_deduplicateSources()` (L999-1021)

**What it does:** Caps chunks per source to prevent one file from monopolizing context.

**Upstream equivalent:** **NONE**. Upstream returns top `maxResults` globally. Context assembly handles what goes to the model.

**Classification:** INVENTION

**Recommendation:** REMOVE. If source diversity matters, it belongs in context engine assembly, not retrieval-layer dedup. Upstream solves this with `maxResults` + `minScore`.

---

### 2.12 `_applyTokenBudget()` (L1057-1137) — ~80 lines

**What it does:** Token budget enforcement with diversity-bonus packing: `score / sqrt(tokens) + source diversity bonus(0.004) + heading diversity bonus(0.002)`. Can reorder results relative to raw search scores.

**Upstream equivalent:** **NONE at the search layer.** Upstream's context engine handles token budgets. Search returns top N by score — that's it.

**Classification:** INVENTION

**M41 Anti-patterns:**
- **Over-engineering:** 80 lines of pack-scoring algorithm that reorders search results based on heuristic diversity bonuses
- **Layer violation:** Token budget belongs in context engine, not retrieval service

**Recommendation:** REMOVE. Token budget is enforced by `openclawContextEngine.ts` which allocates sub-lane budgets (55/15/15/10/5%). Having it ALSO in retrieval creates duplicate budgeting.

---

### 2.13 `retrieveMulti()` (L694-764)

**What it does:** Parallel multi-query retrieval with merge, source dedup, and token budget.

**Upstream equivalent:** **NONE**

**Classification:** INVENTION

**Recommendation:** REMOVE. With query decomposition removed, multi-query retrieval has no caller.

---

### 2.14 `formatContext()` (L640-685)

**What it does:** Formats retrieved chunks as `[Retrieved Context]` blocks with citation numbers and source attribution.

**Upstream equivalent:** **NONE** — upstream context engine assembles messages differently.

**Classification:** **ACCEPTED** (Parallx-specific). The desktop workbench needs to format retrieval results for the prompt.

**Recommendation:** KEEP but consider moving to context engine.

---

### 2.15 Diagnostic Trace Types (L290-392) — ~100 lines

**What it does:** Six interface definitions: `RetrievalQueryPlanTrace`, `RetrievalDiagnosticCandidate`, `RetrievalDroppedEvidenceTrace`, `RetrievalTrace`, `PlannedQueryVariant`, `RetrievalQueryPlan`.

**Upstream equivalent:** **NONE** — upstream has no retrieval diagnostic infrastructure.

**Classification:** INVENTION

**Recommendation:** SIMPLIFY dramatically. Most of these trace the invented query plan machinery. If that's removed, `RetrievalTrace` shrinks to: query, topK, minScore, candidateCount, finalCount, finalChunks.

---

### 2.16 Overfetch Constants (L31-36)

```typescript
const SIMPLE_OVERFETCH_FACTOR = 3;
const EXACT_OVERFETCH_FACTOR = 2;
const HARD_OVERFETCH_FACTOR = 5;
const HARD_QUERY_TERM_THRESHOLD = 12;
const MAX_QUERY_VARIANTS = 4;
const MAX_SEARCH_TOP_K = 60;
```

**Upstream equivalent:** `candidateMultiplier: 3.0` (single numeric config knob).

**Classification:** INVENTION — five constants to solve a problem upstream solves with one.

**Recommendation:** REMOVE all but a single `candidateMultiplier`, or remove entirely if topK from config is sufficient.

---

### 2.17 `cosineSimilarity()` / `dotProduct()` (L77-93)

**What it does:** Pure math utilities exported from the retrieval service.

**Upstream equivalent:** Cosine similarity is computed in sqlite-vec (native extension), not in JS.

**Classification:** MISALIGNED — These are used by tests and possibly other code. Not wrong, but misplaced (should be in vectorStoreService if needed).

**Recommendation:** AUDIT usage. If only used in tests, move to test utils.

---

## 3. Settings Audit

| Setting | Parallx Default | Upstream Equivalent | Upstream Default | Can Be Removed? |
|---|---|---|---|---|
| `autoRag` | `true` | NONE (context engine always runs if registered) | N/A | **KEEP** — Desktop toggle for empty workspaces |
| `ragDecompositionMode` | `'auto'` | **NONE** | N/A | **REMOVE** — Controls invented query decomposition |
| `ragCandidateBreadth` | `'balanced'` | **NONE** (loosely: `candidateMultiplier: 3.0`) | N/A | **REMOVE** — Controls invented overfetch modes |
| `ragTopK` | `20` | `query.maxResults` | `10` | **KEEP** — Maps to upstream concept (different default) |
| `ragMaxPerSource` | `5` | **NONE** | N/A | **REMOVE** — Per-source cap is an invention |
| `ragTokenBudget` | `0` (auto) | **NONE** at search layer | N/A | **REMOVE** — Token budget belongs in context engine |
| `ragScoreThreshold` | `0.01` | `query.minScore` | `0.35` | **KEEP** — Maps to upstream concept (value diverges significantly: 0.01 vs 0.35) |

### Settings that should remain: 3
- `autoRag` (desktop-specific toggle)
- `ragTopK` (maps to `query.maxResults`)
- `ragScoreThreshold` (maps to `query.minScore`) — but default should be reassessed

### Settings that should be removed: 4
- `ragDecompositionMode` — configures invented machinery
- `ragCandidateBreadth` — configures invented machinery
- `ragMaxPerSource` — no upstream equivalent
- `ragTokenBudget` — budget belongs in context engine, not retrieval layer

---

## 4. Critical Findings

### Finding 1: RetrievalService is 70% invented machinery
Of ~1,005 lines, approximately 700 lines implement features that upstream doesn't have:
- Query planning and analysis (~95 lines)
- Query decomposition (~28 lines)
- Query rewriting (~9 lines)
- Keyword focusing (~33 lines + 70-word stopword list)
- Identifier extraction (~35 lines)
- Multi-variant candidate collection (~45 lines)
- Explicit source resolution (~65 lines + regex patterns)
- Per-source dedup (~23 lines)
- Token budget packing with diversity bonuses (~80 lines)
- Multi-query retrieval (~70 lines)
- Diagnostic trace types (~100 lines)
- Supporting helpers and constants (~50 lines)

### Finding 2: Query analysis is textbook pre-classification
`_buildQueryPlan()`, `decomposeQuery()`, `extractCriticalIdentifiers()`, `buildGuardedRewrite()`, `buildKeywordFocusedQuery()`, `stripFormattingRequests()`, `stripPromptFiller()`, and `_resolveExplicitSourceIds()` all regex-analyze the user's query to make retrieval decisions. This is the M41 "pre-classification" anti-pattern: making decisions about content before the model or even the search engine sees it.

### Finding 3: Token budget is enforced in TWO places
Both `retrievalService._applyTokenBudget()` and `openclawContextEngine.assemble()` enforce token budgets. Upstream has budget enforcement in ONE place: the context engine. Having it in both layers means:
1. Retrieval may discard relevant chunks that the context engine would have included
2. Context engine may see fewer candidates than it expects
3. Budget parameters must stay synchronized across two layers

### Finding 4: Previous audit was wrong
The R1 audit classified everything as ALIGNED because it saw "hybrid search" and said "matches upstream." It didn't read the 700 lines of query planning, rewriting, decomposition, identifier extraction, multi-variant search, source dedup, token budget packing, and explicit source resolution. None of those exist in upstream.

### Finding 5: Search scoring differs from upstream
- **Upstream:** `finalScore = vectorScore * vectorWeight + textScore * textWeight` (weighted linear combination, default 0.7/0.3)
- **Parallx:** RRF (Reciprocal Rank Fusion) with k=60 in `vectorStoreService.ts`

This is in `vectorStoreService.ts` not `retrievalService.ts`, so it's out of scope for this audit, but it should be noted. RRF is a defensible alternative to weighted scoring, but it's not what upstream does.

### Finding 6: Demo-workspace-flavored patterns
`EXPLICIT_SOURCE_QUERY_PATTERNS` includes `/\b(?:workflow|system|claims?)\s+architecture\b/i` — the `claims?` pattern is specific to the auto-insurance demo workspace.

### Finding 7: Tests predominantly test invented machinery
Of ~20 test cases in `retrievalService.test.ts`:
- 4 test query planning (decomposition, identifier bias, keyword focus, broad mode)
- 2 test internal artifact hygiene (corpus hygiene)
- 1 tests diagnostic trace
- 1 tests decomposition off mode

**7 of 20 tests (35%)** test features that have no upstream equivalent.

---

## 5. Recommended Approach: Simplify to Match Upstream

### Target State
`retrievalService.ts` should be **~200 lines** doing:

```
retrieve(query, options):
  1. embed(query)                              // same as now
  2. hybridSearch(embedding, query, options)    // single search call
  3. filter by minScore                         // upstream: query.minScore
  4. filter internal artifacts (.parallx)       // Parallx-specific, KEEP
  5. return top maxResults                      // upstream: query.maxResults
```

No query planning. No decomposition. No rewriting. No identifier extraction. No keyword focusing. No source dedup. No token budget. No multi-variant search. No explicit source resolution.

### What stays
1. `retrieve()` — simplified to 5 stages (embed, search, score filter, corpus hygiene, topK)
2. `formatContext()` — desktop-specific formatting
3. `_applyInternalArtifactHygiene()` — desktop-specific safety
4. Basic types: `RetrievalOptions` (simplified), `RetrievedContext`, minimal `RetrievalTrace`
5. `KEYWORD_FOCUS_STOPWORDS` → REMOVE
6. `dotProduct()` / `cosineSimilarity()` → move to test utils or vectorStoreService if needed

### What goes
1. `_buildQueryPlan()` — entire function
2. `decomposeQuery()` — entire function
3. `buildGuardedRewrite()` — entire function
4. `buildKeywordFocusedQuery()` — entire function
5. `extractCriticalIdentifiers()` — entire function
6. `stripFormattingRequests()` — entire function
7. `stripPromptFiller()` — entire function
8. `_collectCandidates()` — replace with single search call
9. `_resolveExplicitSourceIds()` — entire function
10. `_deduplicateSources()` — entire function
11. `_applyTokenBudget()` — token budget moves to context engine only
12. `retrieveMulti()` — entire function
13. All overfetch constants and query plan types
14. `EXPLICIT_SOURCE_QUERY_PATTERNS`, `SOURCE_MATCH_STOPWORDS`, source matching helpers
15. `RetrievalQueryPlanTrace`, `RetrievalDiagnosticCandidate`, `RetrievalDroppedEvidenceTrace` types

### Settings changes
- Remove `ragDecompositionMode`, `ragCandidateBreadth`, `ragMaxPerSource`, `ragTokenBudget`
- Keep `autoRag`, `ragTopK`, `ragScoreThreshold`
- Reassess `ragScoreThreshold` default: 0.01 is 35x lower than upstream's 0.35

### Context engine changes
- `openclawContextEngine.ts` already enforces token budgets via sub-lane allocation. With retrieval-layer budgeting removed, context engine becomes the single budget authority (which is the upstream pattern).

---

## 6. Correction to Gap Matrix

The gap matrix at `docs/clawrallx/OPENCLAW_GAP_MATRIX.md` line 70 states:

> | Hybrid search | memory/search-manager.ts | **ALIGNED** | RAG via `services.retrieveContext` | Vector + keyword search via platform. Documented Parallx adaptation — platform handles hybrid search. |

This is **WRONG**. The hybrid search in `vectorStoreService.ts` (RRF fusion) is acceptable as a Parallx adaptation, but the `retrievalService.ts` layer built on top of it is **MISALIGNED** due to 700+ lines of invented query analysis, decomposition, multi-variant search, source dedup, and token budget enforcement that have no upstream equivalent.

**Corrected classification:** MISALIGNED (retrieval service layer) / ACCEPTED (underlying vector store hybrid search)

---

## Appendix: Line Count Breakdown

| Category | Lines | % of File |
|---|---|---|
| Imports + constants + utility functions | 1-120 | 12% |
| Invented query analysis functions | 121-248 | 13% |
| Types (many for invented trace) | 251-480 | 23% |
| `retrieve()` (over-engineered) | 501-617 | 12% |
| `formatContext()` (KEEP) | 640-685 | 5% |
| `retrieveMulti()` (INVENTION) | 694-764 | 7% |
| `_buildQueryPlan()` (INVENTION) | 773-868 | 10% |
| `_collectCandidates()` + search helpers | 870-996 | 13% |
| `_deduplicateSources()` (INVENTION) | 999-1021 | 2% |
| `_applyInternalArtifactHygiene()` (KEEP) | 1023-1055 | 3% |
| `_applyTokenBudget()` (INVENTION) | 1057-1137 | 8% |
| **KEEP/SIMPLIFY** | **~200 lines** | **~20%** |
| **REMOVE/INVENTION** | **~800 lines** | **~80%** |
