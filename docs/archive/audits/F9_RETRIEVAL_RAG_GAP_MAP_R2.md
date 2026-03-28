# F9-R2: Retrieval Service Gap Map

**Domain:** F9 Retrieval & RAG  
**Source audit:** `docs/F9_RETRIEVAL_RAG_AUDIT_R2.md`  
**Date:** 2026-03-27  
**Mapper:** Gap Mapper  
**Status:** READY FOR EXECUTION

---

## 1. Overview Table

| Gap ID | Description | Primary Files | Risk | Upstream Citation |
|--------|-------------|---------------|------|-------------------|
| G01 | Strip query analysis machinery | `retrievalService.ts` | **MEDIUM** — removes 8 functions, simplifies core pipeline | Upstream `search-manager.ts` has no query analysis; calls `search()` with raw query |
| G02 | Remove token budget from retrieval layer | `retrievalService.ts` | **LOW** — context engine already handles budget in `assemble()` | Upstream context engine owns budget in `assemble()` (context-engine-helpers.ts:52-73) |
| G03 | Remove per-source deduplication | `retrievalService.ts` | **LOW** — upstream has no per-source cap | Upstream `mergeHybridResults()` returns top N globally |
| G04 | Simplify `_collectCandidates` to single search call | `retrievalService.ts` | **LOW** — replaces multi-variant dispatch with single call | Upstream `MemoryIndexManager.search()` runs one search call |
| G05 | Remove `retrieveMulti()` | `retrievalService.ts`, `serviceTypes.ts` | **LOW** — no callers outside retrieval orchestration | Upstream has no multi-query retrieval concept |
| G06 | Remove 4 invented settings from UI + types | `retrievalSection.ts`, `unifiedConfigTypes.ts` | **MEDIUM** — UI change, config schema change, saved presets | No upstream equivalent for decomposition, breadth, per-source, or retrieval token budget |
| G07 | Update tests | `retrievalService.test.ts` | **LOW** — test alignment | Tests must match simplified pipeline |
| G08 | Clean up internal artifact hygiene | `retrievalService.ts` | **NONE** — review only | No upstream equivalent, but legitimate desktop adaptation → **KEEP** |

---

## 2. Per-Gap Change Plans

---

### G01: Strip Query Analysis Machinery

- **Status:** INVENTION → ALIGNED
- **Upstream:** `src/memory/manager-search.ts` `MemoryIndexManager.search()` — receives raw query string, calls `searchVector(query)` + `searchKeyword(query)`, merges via `mergeHybridResults()`. No pre-analysis.
- **Upstream absence:** No functions equivalent to `_buildQueryPlan`, `decomposeQuery`, `buildGuardedRewrite`, `buildKeywordFocusedQuery`, `extractCriticalIdentifiers`, `stripFormattingRequests`, `stripPromptFiller`, `_resolveExplicitSourceIds` exist anywhere in upstream.
- **Parallx file:** `src/services/retrievalService.ts`

#### REMOVE — Functions (8 functions, ~330 lines)

| Function | Lines | Reason |
|----------|-------|--------|
| `_buildQueryPlan()` | L773-868 | Invention: regex query classification |
| `decomposeQuery()` | L215-242 | Invention: query splitting |
| `buildGuardedRewrite()` | L165-173 | Invention: query rewriting |
| `buildKeywordFocusedQuery()` | L175-207 | Invention: custom keyword extraction |
| `extractCriticalIdentifiers()` | L121-155 | Invention: regex identifier detection |
| `stripFormattingRequests()` | L111-117 | Invention: citation-request removal |
| `stripPromptFiller()` | L157-162 | Invention: filler word removal |
| `_resolveExplicitSourceIds()` | L932-996 | Invention: regex source file matching |

#### REMOVE — Constants, types, and helpers (~165 lines)

| Item | Lines | Reason |
|------|-------|--------|
| `SIMPLE_OVERFETCH_FACTOR`, `EXACT_OVERFETCH_FACTOR`, `HARD_OVERFETCH_FACTOR`, `HARD_QUERY_TERM_THRESHOLD`, `MAX_QUERY_VARIANTS`, `MAX_SEARCH_TOP_K` | L32-37 | Drive invented query plan |
| `KEYWORD_FOCUS_STOPWORDS` | L39-45 | Used only by `buildKeywordFocusedQuery()` |
| `NON_IDENTIFIER_UPPERCASE_TOKENS` | L47-49 | Used only by `extractCriticalIdentifiers()` |
| `normalizeLexicalToken()` | L119-124 | Used only by `buildKeywordFocusedQuery()` |
| `normalizeQueryKey()` | L100-102 | Used only by query analysis functions |
| `collapseWhitespace()` | L96-98 | Review — may be used by `formatContext()`. Keep if so; remove if sole consumers are deleted. |
| `matchesAny()` | L250-252 | Used only by `_resolveExplicitSourceIds()` source matching |
| `EXPLICIT_SOURCE_QUERY_PATTERNS` | L399-406 | Invention: regex patterns for source detection. Contains demo-workspace `claims?` pattern. |
| `SOURCE_MATCH_STOPWORDS` | L408-412 | Invention: stopword list for source matching |
| `normalizeSourceMatchText()` | L414-420 | Used only by source resolution |
| `tokenizeSourceMatch()` | L422-426 | Used only by source resolution |
| `shouldAttemptExplicitSourceResolution()` | L428-430 | Used only by source resolution |
| `RetrievalQueryPlanTrace` interface | L294-309 | Traces the invented query plan |
| `RetrievalDiagnosticCandidate` interface | L310-323 | Detailed per-candidate diagnostics for invented pipeline |
| `RetrievalDroppedEvidenceTrace` interface | L325-328 | Dropped-evidence tracking for invented pipeline |
| `PlannedQueryVariant` interface | L364-369 | Internal type for query plan variants |
| `RetrievalQueryPlan` interface | L370-379 | Internal type for the removed `_buildQueryPlan()` |
| `toDiagnosticCandidate()` helper | L423-437 | Builds `RetrievalDiagnosticCandidate` for invented pipeline |
| `summarizeCandidatePreview()` helper | L441-443 | Used only by `toDiagnosticCandidate()` |

#### REMOVE — From `RetrievalOptions` interface

Remove these fields (no upstream equivalent):

| Field | Reason |
|-------|--------|
| `maxPerSource` | Drives per-source dedup (G03) |
| `tokenBudget` | Token budget belongs in context engine (G02) |

Keep these fields:

| Field | Upstream Equivalent |
|-------|---------------------|
| `topK` | `query.maxResults` |
| `sourceFilter` | Platform adaptation — source type filtering |
| `sourceIds` | Platform adaptation — caller can scope search |
| `pathPrefixes` | Platform adaptation — scope filtering |
| `minScore` | `query.minScore` |
| `includeKeyword` | Controls hybrid vs vector-only mode |
| `internalArtifactPolicy` | Platform adaptation — `.parallx` files |

#### REMOVE — From `IRetrievalConfigProvider` interface

Remove these fields (they configure invented machinery):

- `ragDecompositionMode`
- `ragCandidateBreadth`
- `ragMaxPerSource`
- `ragTokenBudget`

Simplified shape:
```typescript
interface IRetrievalConfigProvider {
  getEffectiveConfig(): {
    retrieval: {
      ragTopK: number;
      ragScoreThreshold: number;
    };
  };
}
```

#### SIMPLIFY — `retrieve()` method

**Current:** 7-stage pipeline (~120 lines) with query plan, explicit source resolution, multi-variant collect, corpus hygiene, score filter, source dedup, token budget.

**Target:** 4-stage pipeline (~40 lines):

```
retrieve(query, options):
  1. Embed query
  2. Single hybrid search call (vectorStore.search)
  3. Internal artifact hygiene (.parallx filter)
  4. Score threshold filter
  5. Return top maxResults
```

The `retrieve()` method removes:
- Lines reading `decompositionMode`, `candidateBreadth`, `maxPerSource` from config
- Call to `this._buildQueryPlan()`
- Call to `this._resolveExplicitSourceIds()`
- Token budget auto-computation from context window
- Call to `this._collectCandidates()` → replace with direct `this._vectorStore.search()`
- Call to `this._deduplicateSources()`
- Call to `this._applyTokenBudget()`
- All diagnostic trace assembly for removed stages

#### SIMPLIFY — `RetrievalTrace` interface

**Current:** 20+ fields tracking every stage of the invented pipeline, plus nested `diagnostics` object with `generatedQueries`, `firstStageCandidates`, `droppedEvidence`, `finalPackedContext`.

**Target:** Minimal trace used by `chatDataService.ts`:

```typescript
export interface RetrievalTrace {
  query: string;
  topK: number;
  minScore: number;
  candidateCount: number;
  afterCorpusHygieneCount: number;
  afterScoreFilterCount: number;
  finalCount: number;
  finalChunks: Array<{
    sourceType: string;
    sourceId: string;
    score: number;
    tokenCount: number;
  }>;
  vectorStoreTrace?: HybridSearchTrace;
}
```

Removed fields: `maxPerSource`, `tokenBudget`, `afterDedupCount`, `corpusHygieneDrops`, `scoreThresholdDrops`, `dedupDrops`, `tokenBudgetDrops`, `tokenBudgetUsed`, `queryPlan`, `diagnostics`, `vectorStoreTraces`.

#### KEEP — `dotProduct()` / `cosineSimilarity()`

These are exported and used by tests. They are misplaced (upstream does cosine in sqlite-vec), but they are not harmful and removing them is out of scope for this gap. Flag as MINOR for future cleanup — move to test utils or vectorStoreService.

- **Verify:** After removal, `retrieve()` should: (1) call `embedQuery()` once, (2) call `vectorStore.search()` once, (3) filter `.parallx` artifacts, (4) filter by `minScore`, (5) return top `topK` results. No query preprocessing of any kind.
- **Risk:** Tests that assert query plan details will break (handled in G07). No external consumers of removed functions (all module-private or only called internally).

---

### G02: Remove Token Budget From Retrieval Layer

- **Status:** INVENTION → ALIGNED
- **Upstream:** Token budget is owned by the context engine in `assemble()` (context-engine-helpers.ts:52-73). Search returns top N by score — no budget check.
- **Parallx file:** `src/services/retrievalService.ts`

#### REMOVE

| Item | Lines | Reason |
|------|-------|--------|
| `_applyTokenBudget()` method | L1057-1137 | 80 lines of density-packing with diversity bonuses. Upstream doesn't budget at search time. |
| `DEFAULT_TOKEN_BUDGET` constant | L66 | Dead after removal |
| `estimateTokens()` (retrieval-local) | L69-71 | Used only by `_applyTokenBudget()` and diagnostic trace. Context engine has its own `estimateTokens` via `openclawTokenBudget.ts`. |
| Token budget computation in `retrieve()` | L522-528 | `rawBudget`, `tokenBudget`, context window scaling |
| `tokenBudget` field on `RetrievalOptions` | L277 | No callers should pass budget to the search layer |
| `tokenBudget` on `RetrievalTrace` | L338 | Removed from trace |
| `tokenBudgetDrops` / `tokenBudgetUsed` on `RetrievalTrace` | L344-345 | Removed from trace |

#### Context Engine Already Handles Budget

`openclawContextEngine.ts` L209-213:
```typescript
const ragLaneBudget = Math.floor(budget.rag * 0.55);
```
The context engine allocates sub-lane budgets and truncates context to fit. Retrieval does NOT need to pre-truncate.

- **Verify:** After removal, `retrieve()` returns all chunks that pass the score filter, up to `topK`. The context engine trims to fit its budget window.
- **Risk:** LOW. The context engine already enforces budget. If anything, removing retrieval-layer budgeting may increase the candidate set the context engine sees, which is correct behavior (let the context engine decide what fits).

---

### G03: Remove Per-Source Deduplication

- **Status:** INVENTION → ALIGNED
- **Upstream:** `mergeHybridResults()` returns top N globally by `finalScore = vectorScore * 0.7 + textScore * 0.3`. No per-source cap. Upstream `query.maxResults` is the only limit.
- **Parallx file:** `src/services/retrievalService.ts`

#### REMOVE

| Item | Lines | Reason |
|------|-------|--------|
| `_deduplicateSources()` method | L999-1021 | Per-source cap invention |
| `DEFAULT_MAX_PER_SOURCE` constant | L61 | Dead after removal |
| `maxPerSource` reads in `retrieve()` | L510 | No longer needed |
| Step 5 (source dedup) in `retrieve()` pipeline | L558-560 | Removed stage |
| `afterDedupCount` / `dedupDrops` on `RetrievalTrace` | L340, L343 | Removed from trace |

- **Verify:** If a single source dominates results because it's most relevant, all its chunks appear. The context engine decides what fits in the token budget.
- **Risk:** LOW. If a source monopolizes results, it's because it scored highest — that's correct behavior.

---

### G04: Simplify `_collectCandidates` to Single Search Call

- **Status:** INVENTION → ALIGNED
- **Upstream:** `MemoryIndexManager.search()` runs one `searchVector()` + one `searchKeyword()` (via `hybridSearch()`), merges once. No multi-variant dispatch.
- **Parallx file:** `src/services/retrievalService.ts`

#### REMOVE

| Item | Lines | Reason |
|------|-------|--------|
| `_collectCandidates()` method | L870-921 | Multi-variant parallel search dispatch |
| `_runSingleSearch()` method | L923-948 | Helper for `_collectCandidates` |

#### REPLACE WITH

Inline search call in `retrieve()`:

```typescript
const searchOptions: SearchOptions = {
  topK: topK,     // Direct, no overfetch multiplier
  sourceFilter: options?.sourceFilter,
  sourceIds: options?.sourceIds,
  pathPrefixes: options?.pathPrefixes,
  minScore: 0,    // We apply our own minScore filter
  includeKeyword: options?.includeKeyword ?? true,
};

const candidateResults = await this._vectorStore.search(
  queryEmbedding,
  query,
  searchOptions,
);

const vectorStoreTrace = (this._vectorStore as IVectorStoreTraceAccessor)
  .getLastSearchTrace?.();
```

Note: the `IVectorStoreTraceAccessor` interface and its use are fine — it's a legitimate debug accessor on the vector store, not part of the invented machinery.

- **Verify:** `vectorStore.search()` called exactly once per `retrieve()` call.
- **Risk:** LOW. The single search call is what upstream does.

---

### G05: Remove `retrieveMulti()`

- **Status:** INVENTION → ALIGNED (by removal)
- **Upstream:** No multi-query retrieval concept exists upstream. `MemoryIndexManager.search()` takes one query.
- **Parallx file:** `src/services/retrievalService.ts`, `src/services/serviceTypes.ts`

#### REMOVE

| Item | File | Lines | Reason |
|------|------|-------|--------|
| `retrieveMulti()` method | `retrievalService.ts` | L694-764 | 70 lines, no upstream equivalent |
| `retrieveMulti` on `IRetrievalService` | `serviceTypes.ts` | ~L1535-1538 | Interface method for removed function |

- **Verify:** `grep -r "retrieveMulti" src/` returns zero hits after removal (excluding the service definition itself).
- **Risk:** LOW. Check for callers first. If any external caller uses `retrieveMulti`, it must be refactored to call `retrieve()` once (possibly with a broader `topK`).

---

### G06: Remove 4 Invented Settings From UI + Types

- **Status:** INVENTION → ALIGNED (by removal)
- **Upstream:** Only two retrieval config knobs exist upstream: `query.maxResults` (maps to `ragTopK`) and `query.minScore` (maps to `ragScoreThreshold`). Plus optional hybrid weights and candidate multiplier — but these are not user-facing settings.
- **Parallx files:**
  - `src/aiSettings/ui/sections/retrievalSection.ts`
  - `src/aiSettings/unifiedConfigTypes.ts`

#### REMOVE — From `IUnifiedRetrievalConfig` type (unifiedConfigTypes.ts)

| Field | Line | Reason |
|-------|------|--------|
| `ragDecompositionMode: 'auto' \| 'off'` | L108 | Configures removed `_buildQueryPlan()` |
| `ragCandidateBreadth: 'balanced' \| 'broad'` | L110 | Configures removed overfetch strategy |
| `ragMaxPerSource: number` | L114 | Configures removed `_deduplicateSources()` |
| `ragTokenBudget: number` | L116 | Configures removed `_applyTokenBudget()` |

#### REMOVE — From `DEFAULT_UNIFIED_CONFIG` (unifiedConfigTypes.ts)

| Field | Line | Reason |
|-------|------|--------|
| `ragDecompositionMode: 'auto'` | L406 | Default for removed setting |
| `ragCandidateBreadth: 'balanced'` | L407 | Default for removed setting |
| `ragMaxPerSource: 5` | L409 | Default for removed setting |
| `ragTokenBudget: 0` | L410 | Default for removed setting |

#### REMOVE — From `RetrievalSection` UI (retrievalSection.ts)

Remove the following UI control blocks:

| UI Block | Approx Lines | Description |
|----------|-------------|-------------|
| `_decompositionModeDropdown` field + Decomposition Mode row | L27, L66-87 | Dropdown for auto/off decomposition mode |
| `_candidateBreadthDropdown` field + Candidate Breadth row | L28, L89-111 | Dropdown for balanced/broad candidate breadth |
| `_maxPerSourceSlider` + `_maxPerSourceValue` fields + Max Per Source row | L31-32, L129-152 | Slider for max chunks per source |
| `_tokenBudgetSlider` + `_tokenBudgetValue` fields + Token Budget row | L33-34, L154-179 | Slider for retrieval token budget |

Also remove from `update()` method:
- `this._decompositionModeDropdown` sync block
- `this._candidateBreadthDropdown` sync block
- `this._maxPerSourceSlider` sync block
- `this._tokenBudgetSlider` sync block

#### KEEP — In UI

| UI Block | Reason |
|----------|--------|
| Auto-RAG toggle | Desktop-specific toggle (ACCEPTED) |
| Top K Results slider | Maps to upstream `query.maxResults` |
| Score Threshold slider | Maps to upstream `query.minScore` |

#### Downstream Impact — Cross-file References

Any code reading `config.retrieval.ragDecompositionMode`, `config.retrieval.ragCandidateBreadth`, `config.retrieval.ragMaxPerSource`, or `config.retrieval.ragTokenBudget` must be updated. Based on grep results, these are only read by:
1. `retrievalService.ts` `retrieve()` — removed as part of G01
2. `retrievalSection.ts` UI — removed in this gap
3. `unifiedConfigTypes.ts` defaults — removed in this gap

#### Migration Note — Saved Presets

Existing saved presets in user config may contain `ragDecompositionMode`, `ragCandidateBreadth`, `ragMaxPerSource`, `ragTokenBudget`. The preset loader should silently ignore unknown keys (standard practice). If not, add a migration pass in the config loader to strip removed keys.

- **Verify:** Settings panel shows only: Auto-RAG, Top K Results, Score Threshold. No JavaScript errors when opening settings.
- **Risk:** MEDIUM. UI change visible to users. Saved presets with removed keys must not cause errors.

---

### G07: Update Tests

- **Status:** Must align with simplified pipeline
- **Parallx file:** `tests/unit/retrievalService.test.ts`

#### REMOVE — Tests for Deleted Machinery

| Test | Approx Lines | Reason |
|------|-------------|--------|
| `'decomposes hard multi-clause queries and merges candidates'` | ~L370-395 | Tests `_buildQueryPlan` decomposition |
| `'keeps identifier-heavy queries on the single-query fast path'` | ~L397-418 | Tests identifier extraction |
| `'uses a keyword-focused lexical query for simple non-identifier prompts'` | ~L420-442 | Tests `buildKeywordFocusedQuery()` |
| `'keeps short what-about follow-ups on the simple keyword-focused path'` | ~L444-462 | Tests compact follow-up classification |
| `'widens hard-query candidate breadth when broad mode is enabled'` | ~L464-490 | Tests `candidateBreadth` setting |
| `'keeps hard queries on a single-query plan when decomposition mode is off'` | ~L492-510 | Tests `decompositionMode` setting |
| `'captures developer-facing retrieval diagnostics...'` | ~L512-550 | Tests invented diagnostic trace (queryPlan, droppedEvidence details) |

#### KEEP — Tests (Updated)

| Test | Update Needed |
|------|--------------|
| `'returns empty array for blank query'` | No change |
| `'embeds query and calls hybrid search'` | Update: assert `vectorStore.search` called with `topK` (not 60 overfetch), remove keyword query variant assertions |
| `'filters out results below minScore'` | No change |
| `'respects custom minScore option'` | No change |
| `'deduplicates sources — max 5 chunks per source by default'` | **REMOVE** — dedup is deleted |
| `'respects custom maxPerSource option'` | **REMOVE** — `maxPerSource` is deleted |
| `'enforces token budget'` | **REMOVE** — token budget moved to context engine |
| `'always includes at least one chunk even if it exceeds budget'` | **REMOVE** — token budget is deleted |
| `'passes sourceFilter to VectorStoreService'` | No change |
| `'respects topK option'` | No change |
| `'includes tokenCount in results'` | No change |
| `'does not apply drop-off filter when only one result'` | Verify still passes after simplification |
| `'excludes .parallx internal artifacts from generic grounded retrieval by default'` | No change (tests KEEP'd `_applyInternalArtifactHygiene`) |
| `'can include .parallx artifacts when a caller explicitly opts in'` | No change |
| `formatContext()` tests | No change |
| `dotProduct()` / `cosineSimilarity()` tests | No change |

#### ADD — New Tests

| Test | Purpose |
|------|---------|
| `'calls vectorStore.search exactly once with topK'` | Verify single search call, no overfetch multiplier |
| `'passes raw query to vectorStore.search without modification'` | Verify no query rewriting or keyword extraction |
| `'does not read decompositionMode or candidateBreadth from config'` | Verify config simplification |

- **Verify:** All tests pass with simplified pipeline. No tests reference deleted functions.
- **Risk:** LOW.

---

### G08: Review Internal Artifact Hygiene

- **Status:** ACCEPTED — **KEEP**
- **Upstream:** No equivalent — upstream memory is a separate directory, not mixed with user content in a workspace.
- **Parallx file:** `src/services/retrievalService.ts`

#### KEEP — `_applyInternalArtifactHygiene()` (L1023-1055)

**Justification:** Desktop workbench stores `.parallx/` config files (ai-config.json, permissions.json, memory.md) alongside user files. Without this filter, retrieval would inject AI configuration JSON into the prompt context, which is both irrelevant and a potential information leak.

#### KEEP — Supporting helpers

| Item | Lines | Reason |
|------|-------|--------|
| `isInternalArtifactPath()` | L254-256 | Used by `_applyInternalArtifactHygiene()` |
| `queryExplicitlyTargetsInternalArtifacts()` | L258-268 | Allows explicit opt-in for `.parallx` queries |

These two helpers are ~15 lines total and serve a clear desktop-specific purpose.

#### Platform Adaptation Note

| Upstream Pattern | Parallx Adaptation | Reason |
|-----------------|-------------------|--------|
| Separate memory directory | `.parallx/` files in workspace | Desktop workbench stores everything in one workspace directory tree. Artifact hygiene prevents config leaking into RAG results. |

- **Verify:** `.parallx` artifacts excluded by default; included when query explicitly mentions `.parallx`, memory, or config.
- **Risk:** NONE. No code change needed.

---

## 3. Execution Order

Dependencies dictate this order:

```
Phase 1 (independent, can be parallel):
  G06 — Remove settings from types + UI
         (no code in retrievalService.ts depends on this,
          but G01's config simplification removes the same fields)

Phase 2 (core retrieval simplification — sequential):
  G01 — Strip query analysis machinery from retrieve()
         (this is the largest change; removes 8 functions + constants + types)
  G04 — Simplify _collectCandidates to single search call
         (DEPENDS ON G01: query plan is gone, so _collectCandidates loses its input)
  G02 — Remove token budget from retrieval layer
         (can happen with G01 since both modify retrieve(), but logically separate)
  G03 — Remove per-source deduplication
         (can happen with G01/G02, shares retrieve() modification)

Phase 3 (cleanup — depends on Phase 2):
  G05 — Remove retrieveMulti()
         (depends on G01-G04: with simplified retrieve(), retrieveMulti() has no purpose)

Phase 4 (tests — depends on Phase 2 + 3):
  G07 — Update tests

Phase 5 (no-op):
  G08 — KEEP, no changes
```

**Recommended approach:** Since G01, G02, G03, G04 all modify `retrieve()` and the class, they should be done as a SINGLE pass rewrite of `retrievalService.ts` to avoid conflicting edits. G06 can happen in parallel since it touches different files. G05 occurs in the same file but is a simple deletion. G07 follows last.

**Practical execution order:**

1. **G06** — Remove settings from `unifiedConfigTypes.ts` and `retrievalSection.ts`
2. **G01 + G02 + G03 + G04 + G05** — Rewrite `retrievalService.ts` (all retrieval changes as one pass)
3. **G05 (interface)** — Remove `retrieveMulti` from `serviceTypes.ts`
4. **G07** — Update tests

---

## 4. Risk Assessment

### What Could Break

| Risk | Severity | Mitigation |
|------|----------|------------|
| Saved user presets contain removed config keys | MEDIUM | Config loader should ignore unknown keys. If not, add a migration strip. |
| `chatDataService.ts` reads `RetrievalTrace` fields that no longer exist | MEDIUM | Update `RetrievalTrace` type. `chatDataService.ts` uses optional chaining — verify no hard crashes. |
| Fewer results returned (no overfetch multiplier) | LOW | `topK` goes directly to vectorStore. If users need more results, increase `ragTopK`. This is the correct upstream behavior. |
| Source monopolization (no per-source cap) | LOW | Upstream behavior — top results by score. Context engine controls budget. |
| `dotProduct` / `cosineSimilarity` imported externally | LOW | Grep confirms they're only imported in tests. Keep exported. |

### What Won't Break

| Area | Reason |
|------|--------|
| Context engine | Already owns token budget. Retrieval just provides candidates. |
| Vector store service | Untouched. `search()` API unchanged. |
| Embedding service | Untouched. `embedQuery()` API unchanged. |
| `formatContext()` | Untouched. KEEP'd as desktop adaptation. |
| `.parallx` artifact filtering | Untouched. KEEP'd as desktop adaptation. |

### Net Result

| Metric | Before | After |
|--------|--------|-------|
| `retrievalService.ts` lines | ~1,005 | ~200 |
| Functions in retrieval service | 15+ | 4 (`retrieve`, `formatContext`, `getLastTrace`, `_applyInternalArtifactHygiene`) |
| Settings knobs | 7 | 3 (`autoRag`, `ragTopK`, `ragScoreThreshold`) |
| Pipeline stages | 7 | 4 (embed → search → hygiene → score filter → topK) |
| M41 anti-patterns | 3 (pre-classification, over-engineering, layer violation) | 0 |

---

## 5. Files Changed Summary

| File | Action | Lines Removed (est.) | Lines Added (est.) |
|------|--------|---------------------|-------------------|
| `src/services/retrievalService.ts` | REWRITE (simplify) | ~800 | ~0 (net reduction) |
| `src/services/serviceTypes.ts` | EDIT (remove `retrieveMulti`) | ~4 | 0 |
| `src/aiSettings/unifiedConfigTypes.ts` | EDIT (remove 4 settings + defaults) | ~12 | 0 |
| `src/aiSettings/ui/sections/retrievalSection.ts` | EDIT (remove 4 UI controls) | ~120 | 0 |
| `tests/unit/retrievalService.test.ts` | EDIT (remove/update tests) | ~150 | ~30 |
| **Total** | | **~1,086** | **~30** |
