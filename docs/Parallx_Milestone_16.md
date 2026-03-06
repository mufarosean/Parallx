# Milestone 16 — RAG Pipeline Precision Redesign

## Research Document — March 5, 2026

**Branch:** `milestone-15` (continuation of retrieval work)

---

## Table of Contents

1. [Vision](#vision)
2. [The Problem — 14-Point System Audit](#the-problem--14-point-system-audit)
3. [Industry Research — How 8 Systems Solve This](#industry-research--how-8-systems-solve-this)
4. [Architecture — What Changes](#architecture--what-changes)
5. [Transformation Plan](#transformation-plan)
6. [Task Tracker](#task-tracker)
7. [Verification Checklist](#verification-checklist)
8. [Risk Register](#risk-register)

---

## Vision

**Before M16 — what the user experiences today:**

> You open a workspace with 50 insurance documents. You ask "What's my deductible for collision?" The system embeds your literal question, runs hybrid search, and returns 10 chunks. Three of them are about collision deductibles — but they're from the same FAQ page, eating 3 of your 10 slots. Two chunks are 2048-char monsters that dilute the embedding signal. The model gets a wall of loosely-relevant text, hallucinates a number that appeared in an unrelated chunk, and cites the wrong source. The user sees `[1]` pointing at a chunk about "comprehensive coverage" when the answer came from chunk `[4]`.

**After M16 — what the user will experience:**

> Same question. The system embeds the query, overshoots to 30 candidates from hybrid search, then re-ranks them using cosine similarity against the query embedding — zero-cost, no LLM call, using vectors already stored in sqlite-vec. The re-ranker promotes the 2 chunks that are genuinely about collision deductibles and demotes the 5 that merely contain the word "deductible" in a different context. The model receives 7 tight, precise chunks — each ~1024 chars with source titles prepended for BM25 boost — and produces a grounded answer citing exactly the right sources. Latency is unchanged because re-ranking costs ~1ms (30 dot products of 768-dim vectors).

**The one-sentence pitch:**

> Make every chunk smaller, every search smarter, and every result re-ranked — without adding a single LLM call or external dependency.

**Why this matters:**

Milestones 10–12 built the RAG pipeline: ingestion, embedding, hybrid search, retrieval, citation. It works. But it works like a search engine from 2010 — keyword matching plus vector similarity, no re-ranking, oversized chunks that blur the embedding signal, and a per-source cap that lets one noisy document dominate the context window. Every production RAG system studied in this research (Cursor, AnythingLLM, Open WebUI, PrivateGPT, Perplexity) has moved beyond this. This milestone closes the gap.

---

## The Problem — 14-Point System Audit

Full code audit of 9 source files, tracing every layer from ingestion through retrieval to response assembly. Findings ordered by severity.

### Critical

| # | Problem | File | Evidence |
|---|---------|------|----------|
| C1 | **Re-ranking disabled** — `shouldRerank = false` hardcoded. After RRF fusion, chunks are ordered by a score that blends rank positions, not semantic relevance. A chunk ranked #3 by BM25 (keyword hit on "deductible") and #15 by vector (semantically about billing) gets a high RRF score despite being irrelevant. | `retrievalService.ts` L~175 | The existing LLM-based re-ranker was correctly disabled (5–15s latency per chunk). But nothing replaced it. |
| C2 | **Chunks too large** — `MAX_CHUNK_CHARS = 2048` (~512 tokens). Industry consensus is 800–1200 chars. Larger chunks dilute the embedding: a 2048-char chunk about "collision deductible" in paragraph 1 and "roadside assistance" in paragraph 3 gets an embedding that represents neither topic well. | `chunkingService.ts` L1 | Every system studied uses smaller chunks: AnythingLLM (1000), Open WebUI (1000), PrivateGPT/LlamaIndex (1024 tokens ≈ 4096 chars but token-based), LangChain (1000). |
| C3 | **No overlap on canvas page chunks** — File chunks get 200-char overlap at size-limit boundaries, but canvas page chunks get zero overlap. If a key fact spans two TipTap blocks, the chunk boundary cuts it and neither chunk contains the full fact. | `chunkingService.ts` `chunkPage()` | Heading boundaries are clean breaks (correct), but size-limit flushes within a section should carry overlap. |
| C4 | **Context window unknown to budget service** — `num_ctx` is only sent to Ollama when the user explicitly overrides it. The token budget service has no way to know the actual inference context window. It falls back to 0 (no limit), meaning budget percentages are never enforced unless the user manually sets a number. | `ollamaProvider.ts` `sendChatRequest()`, `tokenBudgetService.ts` `allocate()` | `getModelContextLength()` exists and resolves correctly, but its result is never wired into the budget allocation call path. |

### Moderate

| # | Problem | File | Evidence |
|---|---------|------|----------|
| M1 | **FTS5 AND may over-filter** — Query `"deductible" "collision" "coverage"` requires ALL three terms. A chunk containing "deductible" and "collision" but not "coverage" scores 0 in keyword search, losing a valid result. | `vectorStoreService.ts` `sanitizeFts5Query()` | AND semantics were added in commit `21713b0` (correct for precision), but there's no OR fallback when AND returns < K results. |
| M2 | **Stopword list includes domain-useful terms** — Words like `page`, `section`, `table`, `figure`, `note`, `part`, `book`, `read`, `find`, `show`, `help`, `work`, `use` are stopwords. In a workspace about books or notes, these are critical search terms. | `vectorStoreService.ts` stopword set | 115+ stopwords. The meta/structural category (`page, section, table, figure, note, chapter, book, example`) and common verbs (`find, get, show, help, use, work, read, look`) should be reconsidered. |
| M3 | **Per-source cap too high for re-ranked results** — `DEFAULT_MAX_PER_SOURCE = 3`. With 10 slots and 3 per source, a single noisy document can consume 30% of the context window. With cosine re-ranking, 2 per source is sufficient — the best 2 chunks from any source will be the genuinely relevant ones. | `retrievalService.ts` L~10 | AnythingLLM uses top_n=4 total. Open WebUI uses top_k=3 total. 3 per source × potentially 3 sources = 9 of 10 slots dominated by 3 documents. |
| M4 | **Workspace digest exceeds system prompt budget** — Digest can be up to 12,000 chars (~3,000 tokens). System prompt budget is 10%. For a model with 8K context, 10% = 800 tokens. The digest alone is 3.75× over budget. Even for 128K context, 10% = 12,800 tokens — the digest fits but leaves zero room for identity, rules, or citation instructions. | `chatDataService.ts` `MAX_DIGEST_CHARS = 12000`, `tokenBudgetService.ts` system=10% | The budget service allocates percentages but the digest is assembled independently with its own hard cap, never checked against the allocated budget. |
| M5 | **Memory recall ungated** — Conversational memory chunks (type `memory`) are retrieved alongside workspace content with no special handling. A casual "thanks, that helped" stored as memory can match future queries about "help" and consume a retrieval slot. | `retrievalService.ts` `retrieve()` | No source-type filtering or weighting. Memory chunks compete directly with document chunks. |
| M6 | **Token estimation coarse everywhere** — `chars / 4` heuristic. For English prose, actual ratio is ~3.5–4.5 chars/token. For code, it's ~2.5–3.5. For CJK text, it's ~1.5–2. The 25%+ error means budget allocation can be significantly off, leading to truncated context or wasted window. | `tokenBudgetService.ts`, `retrievalService.ts` | Both files use `Math.ceil(text.length / 4)`. No language/content-type awareness. |

### Minor

| # | Problem | File | Evidence |
|---|---------|------|----------|
| m1 | **~200 lines of dead re-ranking code** — `_rerankChunks()` and `_scoreChunk()` are never called. The planner prompt in `chatSystemPrompts.ts` exists but the planner is disabled in the default participant. | `retrievalService.ts` L~300–500, `chatSystemPrompts.ts` `buildPlannerPrompt()` | Dead code increases maintenance burden and confuses future contributors. |
| m2 | **`chunk_index` stored as TEXT** — In the vector store, chunk ordering within a source is stored as a string. Sorting by chunk_index produces lexicographic order ("10" < "2"). | `vectorStoreService.ts` schema | Not currently causing bugs (chunks are scored, not ordered by index), but will break if sequential display is ever needed. |
| m3 | **No chunk-level dedup across sources** — If the same paragraph appears in two different files (e.g., a README and a wiki page), both chunks are embedded, stored, and retrieved independently. Two retrieval slots wasted on identical content. | `vectorStoreService.ts` `upsert()` | Dedup is by `sourceType:sourceId`, not by content. A content-hash dedup at retrieval time would fix this. |
| m4 | **Embedding cache is in-memory only** — The `Map<string, number[]>` cache in `embeddingService.ts` is lost on every reload. For a workspace with 5,000 chunks, this means re-embedding on every app restart even when content hasn't changed. | `embeddingService.ts` cache | The indexing pipeline's content-hash check prevents unnecessary re-embedding at index time, but ad-hoc queries always re-embed. This is a minor concern since query embedding is a single call. |

---

## Industry Research — How 8 Systems Solve This

Full analysis in [docs/ai/RAG_ARCHITECTURE_COMPARISON.md](ai/RAG_ARCHITECTURE_COMPARISON.md). Summary of findings across 6 layers:

### Chunking

| System | Chunk Size | Overlap | Strategy |
|--------|-----------|---------|----------|
| **Cursor** | Proprietary | Proprietary | AST-aware + file-level |
| **Continue.dev** | Configurable | None | tree-sitter AST for code, heading-recursive for markdown |
| **AnythingLLM** | 1000 chars | 20 chars | RecursiveCharacterTextSplitter + metadata header |
| **Open WebUI** | 1000 chars | 100 chars | RecursiveCharacterTextSplitter, optional markdown splitter |
| **PrivateGPT** | 1024 tokens | 20 tokens | LlamaIndex SentenceSplitter (sentence-boundary-aware) |
| **LlamaIndex** | 1024 tokens | 20 tokens | SentenceSplitter (default) |
| **LangChain** | 1000 chars | 200 chars | RecursiveCharacterTextSplitter (default) |
| **Parallx** | **2048 chars** | **200/0** | Heading-aware + plain text fallback |

**Consensus:** 800–1200 chars, always with overlap. Parallx is a 2× outlier on chunk size and lacks overlap on canvas pages.

### Re-ranking

| System | Method | Latency | Extra Model? |
|--------|--------|---------|--------------|
| **Cursor** | Cross-encoder (server-side) | ~200ms | Yes (cloud) |
| **Continue.dev** | None | — | — |
| **AnythingLLM** | **Bi-encoder cosine re-scoring** | ~5.2s naive, **<50ms with pre-computed embeddings** | **No** |
| **Open WebUI** | Cross-encoder primary, **cosine fallback** | Variable | Optional |
| **PrivateGPT** | Cross-encoder (disabled by default) | Seconds | Yes (local) |
| **Perplexity** | Multi-stage (cross-encoder + LLM) | ~500ms | Yes (cloud) |
| **LlamaIndex** | SentenceTransformerRerank (pluggable) | Variable | Optional |
| **Parallx** | **Disabled** (`shouldRerank = false`) | — | — |

**Key finding:** AnythingLLM's `NativeEmbeddingReranker` uses the **same embedding model** already loaded to compute query-candidate cosine similarity. No additional model, no LLM calls. With pre-computed candidate embeddings (already stored in sqlite-vec), cost reduces to 1 query embedding (already done) + N dot products (~1ms for 30 candidates). This is the answer for Parallx.

### BM25 Metadata Enrichment

Open WebUI prepends source filenames to FTS content, boosting title-based matches in keyword search. A query for "README" ranks the README chunk higher even if the chunk body doesn't contain "README". Zero-cost improvement.

### Query Understanding

| System | Multi-Query | Intent Classification | Planner LLM Call |
|--------|-------------|----------------------|------------------|
| **Cursor** | Yes | Yes (code gen vs. edit vs. explain) | Yes |
| **Open WebUI** | Yes (1–3 queries via LLM) | LLM decides if search is needed | Yes |
| **AnythingLLM** | No | No | No |
| **PrivateGPT** | No | No | No |
| **Parallx** | Yes (2–4, via planner) | Yes (5 intents) | **Currently disabled** |

**Recommendation:** Re-enable the planner but short-circuit for casual/greeting intents (save 2–3s on "thanks" or "hello"). The planner prompt and infrastructure already exist and are well-designed.

---

## Architecture — What Changes

### Layer 1: Chunking (chunkingService.ts)

**Change:** Reduce `MAX_CHUNK_CHARS` from 2048 to **1024**. Add overlap to canvas page size-limit flushes.

```
Before:  MAX_CHUNK_CHARS = 2048, OVERLAP_CHARS = 200 (files only)
After:   MAX_CHUNK_CHARS = 1024, OVERLAP_CHARS = 200 (files AND pages)
```

**Why 1024 and not 800 or 1000:** nomic-embed-text v1.5 handles up to 8192 tokens (~32K chars). 1024 chars ≈ 256 tokens is well within the sweet spot. It matches PrivateGPT/LlamaIndex defaults (1024 tokens) when accounting for the char→token ratio, and sits at the top of the industry consensus range.

**Impact:** Existing workspace indexes must be rebuilt. The indexing pipeline already handles this — content hash changes trigger re-embedding. Add a schema version bump to force full re-index on upgrade.

**Canvas page overlap rule:**
- Heading boundaries → clean break (no overlap). Headings are natural section boundaries.
- Size-limit flushes within a section → 200-char overlap. Same as file chunks.

### Layer 2: BM25 Metadata Enrichment (vectorStoreService.ts)

**Change:** Prepend `[Source: "filename/title"]` to FTS5 content at index time.

```
Before:  FTS5 indexes raw chunk text
After:   FTS5 indexes "[Source: README.md] {chunk text}"
```

**Why:** A query for "README" currently relies on vector similarity to find README chunks. With title-enriched FTS content, the keyword path also promotes README chunks. Direct hit on a BM25 term that matches the source name. Open WebUI calls this "text enrichment for BM25 boost."

**Implementation:** In `vectorStoreService.ts` `upsert()`, when inserting into `fts_chunks`, prepend the context prefix (already available as `chunk.contextPrefix`) to the `content` column.

### Layer 3: Retrieval Parameters (retrievalService.ts)

**Changes:**
| Parameter | Before | After | Rationale |
|-----------|--------|-------|-----------|
| `DEFAULT_TOP_K` | 10 | **7** | Better precision → fewer but more relevant chunks |
| `DEFAULT_MAX_PER_SOURCE` | 3 | **2** | Prevents single-source domination with re-ranking in place |
| `DEFAULT_TOKEN_BUDGET` | 4000 | **3000** | Tighter context = less noise for the model |
| Overfetch factor | 2× | **3×** | Overfetch more candidates for re-ranking to select from |

**FTS5 AND fallback:** If AND query returns < `candidateK / 2` results, retry with OR semantics. This prevents over-filtering on multi-term queries while maintaining AND precision as the primary path.

### Layer 4: Cosine Re-ranking (NEW — retrievalService.ts)

**Change:** Replace the disabled LLM re-ranker with zero-cost cosine re-scoring.

**Flow:**
```
1. Hybrid search returns 30 candidates (7 × 3 overfetch + RRF fusion)
2. Query embedding already computed (step 0 of retrieval)
3. For each candidate: fetch stored embedding from sqlite-vec → dot product with query embedding
4. Filter: drop candidates with cosine similarity < 0.30
5. Sort by cosine similarity descending
6. Apply per-source cap (2) and top-K (7)
```

**Cost analysis:**
- Step 3: 30 × 768-dim dot product = 30 × 768 multiplications + 30 × 767 additions = ~46K FLOPs. On any modern CPU, this is <1ms.
- Step 3 alternative: If fetching embeddings from sqlite-vec is expensive (disk I/O), compute cosine similarity in SQL: `vec_distance_cosine(embedding, ?)`. sqlite-vec supports this natively.

**Threshold 0.30:** nomic-embed-text v1.5 typically produces:
- 0.6–0.8 for highly relevant matches
- 0.3–0.5 for moderately relevant
- 0.1–0.3 for tangentially related
- <0.1 for unrelated

0.30 filters noise while keeping moderate matches. Tunable via options.

**Implementation sketch:**
```typescript
// In retrievalService.ts, after _hybridSearch returns candidates:

async function _cosineRerank(
  queryEmbedding: number[],
  candidates: RetrievedChunk[],
  minCosine: number
): Promise<RetrievedChunk[]> {
  // Fetch stored embeddings for candidates via vectorStoreService
  const withEmbeddings = await this._vectorStore.getEmbeddings(
    candidates.map(c => c.chunkId)
  );

  const scored = candidates.map((chunk, i) => ({
    ...chunk,
    cosineScore: dotProduct(queryEmbedding, withEmbeddings[i])
  }));

  return scored
    .filter(c => c.cosineScore >= minCosine)
    .sort((a, b) => b.cosineScore - a.cosineScore);
}
```

### Layer 5: Stopword Refinement (vectorStoreService.ts)

**Change:** Remove domain-useful words from the stopword list.

**Remove these (26 words):**
- Meta/structural that may be search terms: `page`, `pages`, `section`, `sections`, `table`, `tables`, `figure`, `figures`, `note`, `notes`, `chapter`, `chapters`, `book`, `part`, `parts`, `example`, `examples`
- Common verbs that carry meaning: `find`, `show`, `help`, `use`, `work`, `read`, `look`, `call`, `give`

**Keep the rest** — articles, prepositions, pronouns, and truly empty verbs (`is`, `are`, `was`, `do`, `does`, `did`, `have`, `has`, `had`) are correctly stopworded.

### Layer 6: Context Window Wiring (chatDataService.ts → tokenBudgetService.ts)

**Change:** Wire `ollamaProvider.getModelContextLength()` into the token budget allocation call path.

**Current flow:**
```
chatDataService → tokenBudgetService.allocate(contextWindow=0, ...)
                                     ↓
                              0 = no limit → percentages never enforce caps
```

**New flow:**
```
chatDataService → ollamaProvider.getModelContextLength(activeModelId)
               → tokenBudgetService.allocate(contextWindow=resolvedLength, ...)
                                     ↓
                              e.g. 32768 → system=3276, rag=9830, history=9830, user=9830
```

**Fallback:** If model context length resolution fails (new model, no metadata), fall back to **8192** (conservative default). This matches the constraint in `parallx-instructions.instructions.md`: "fallback 8192."

### Layer 7: Digest Budget Compliance (chatDataService.ts)

**Change:** Cap workspace digest to fit within the allocated system prompt budget.

**Current:** `MAX_DIGEST_CHARS = 12000` — a hard cap independent of the budget system.

**New:** After resolving context window, compute available digest budget:
```
systemBudget = contextWindow * 0.10
identityTokens ≈ 150  (PARALLX_IDENTITY + rules + citation instructions)
digestBudget = (systemBudget - identityTokens) * 4  // convert back to chars
MAX_DIGEST_CHARS = min(12000, digestBudget)
```

For a 32K model: systemBudget = 3276 tokens, digestBudget = (3276 - 150) × 4 = **12,504 chars** → capped at 12,000 (no change).
For an 8K model: systemBudget = 819 tokens, digestBudget = (819 - 150) × 4 = **2,676 chars** → meaningful reduction.

### Layer 8: Dead Code Removal (retrievalService.ts, chatSystemPrompts.ts)

**Change:** Remove the disabled LLM re-ranking infrastructure and the unused planner prompt (if planner remains disabled). If the planner is re-enabled (Phase 4), keep `buildPlannerPrompt()`.

**Remove:**
- `_rerankChunks()` method (~80 lines)
- `_scoreChunk()` method (~60 lines)
- `RERANK_MIN_RELEVANCE`, `RERANK_MAX_CHUNK_CHARS`, `RERANK_TIMEOUT_MS` constants
- Associated type definitions if any

**Keep:**
- `buildPlannerPrompt()` — useful for Phase 4 planner re-enablement
- `planRetrieval()` in ollamaProvider — same reason

---

## Transformation Plan

### Phase 1 — Immediate Wins (3 tasks, ~45 min total)

These are parameter changes and minor logic fixes. No architectural changes. Each is independently deployable and testable.

#### Task 1.1: Reduce chunk size to 1024 + add page overlap

**File:** `src/services/chunkingService.ts`

1. Change `MAX_CHUNK_CHARS` from `2048` to `1024`
2. In `chunkPage()`: when a size-limit flush occurs (not a heading boundary), carry `OVERLAP_CHARS` (200) tail into the next chunk buffer — same logic already used in `_chunkPlainText()` and `_chunkMarkdown()` for size flushes
3. Update the module-level comment that says "~512 tokens" → "~256 tokens"

**Tests:** Update any unit tests in `tests/unit/` that assert chunk sizes against 2048. Add a test that verifies canvas page overlap on size-limit flush.

**Verification:** `tsc --noEmit && npx vitest run`

**Note:** This changes all chunk sizes. Existing vector store data will not match. Task 1.1b handles re-indexing.

#### Task 1.1b: Schema version bump for forced re-index

**File:** `src/services/vectorStoreService.ts` (or wherever schema version is tracked)

1. Increment the schema version constant
2. On version mismatch at startup, drop and recreate `vec_embeddings`, `fts_chunks`, `indexing_metadata` tables
3. The indexing pipeline's `start()` already handles full re-indexing when tables are empty

**Tests:** Verify schema migration path.

#### Task 1.2: Refine stopword list

**File:** `src/services/vectorStoreService.ts`

1. Remove the 26 domain-useful words listed in Layer 5 above from the stopword set
2. Keep all articles, prepositions, pronouns, and empty verbs

**Tests:** Update unit tests that assert specific stopword filtering behavior. Add test cases for "find the table" (all three words should survive after filtering).

**Verification:** `tsc --noEmit && npx vitest run`

#### Task 1.3: FTS5 AND → OR fallback

**File:** `src/services/vectorStoreService.ts`

1. In `_keywordSearch()`: after running the AND query, if result count < `candidateK / 2`, retry with OR semantics (join terms with `OR` instead of space-separated)
2. Log the fallback for diagnostics

**Tests:** Add unit test: AND query with 3 terms returns < half of candidateK → verify OR retry fires and returns more results.

**Verification:** `tsc --noEmit && npx vitest run`

### Phase 2 — Cosine Re-ranking (3 tasks, ~1.5 hours total)

#### Task 2.1: Add embedding lookup to vectorStoreService

**File:** `src/services/vectorStoreService.ts`

1. Add method `getEmbeddings(chunkIds: string[]): Promise<Map<string, number[]>>` — batch fetch stored embeddings from `vec_embeddings` by rowid
2. Use `SELECT rowid, embedding FROM vec_embeddings WHERE rowid IN (...)` — sqlite-vec returns the raw float[768] buffer
3. Return as `Map<chunkId, number[]>` for O(1) lookup

**Tests:** Unit test with mock DB: insert embeddings, fetch back, verify identity.

#### Task 2.2: Implement cosine re-ranking in retrievalService

**File:** `src/services/retrievalService.ts`

1. Add `_cosineRerank(queryEmbedding, candidates, minCosine)` method as described in Layer 4
2. Add `dotProduct(a, b)` utility (sum of element-wise products for normalized vectors — cosine similarity for unit vectors)
3. In `retrieve()`: after hybrid search and score threshold filter, call `_cosineRerank()` before source dedup and top-K slicing
4. Default `minCosine = 0.30`, configurable via `RetrievalOptions`
5. Update `overfetchFactor` from 2 to 3

**Tests:**
- Unit test: provide 10 candidates with known embeddings, verify re-ranking order matches expected cosine similarity order
- Unit test: candidates below 0.30 threshold are filtered out
- Unit test: verify overfetch requests 3× candidates

**Verification:** `tsc --noEmit && npx vitest run`

#### Task 2.3: Update retrieval parameters

**File:** `src/services/retrievalService.ts`

1. `DEFAULT_TOP_K`: 10 → **7**
2. `DEFAULT_MAX_PER_SOURCE`: 3 → **2**
3. `DEFAULT_TOKEN_BUDGET`: 4000 → **3000**

**File:** `src/built-in/chat/data/chatDataService.ts`

4. Update `retrieveContext()` call: `topK: 8` → `topK: 7`, `tokenBudget: 3000` → `tokenBudget: 2500`
5. Update `planAndRetrieve()` call: `topK: 10` → `topK: 7`, `tokenBudget: 3500` → `tokenBudget: 3000`

**Tests:** Update any tests asserting old parameter values.

**Verification:** `tsc --noEmit && npx vitest run`

### Phase 3 — Precision Improvements (3 tasks, ~1.5 hours total)

#### Task 3.1: BM25 metadata enrichment

**File:** `src/services/vectorStoreService.ts`

1. In `upsert()`, when inserting into `fts_chunks`, prepend the context prefix to the content:
   ```typescript
   const ftsContent = chunk.contextPrefix
     ? `${chunk.contextPrefix}\n${chunk.text}`
     : chunk.text;
   ```
2. This means a search for "README" will hit FTS on chunks from `README.md` even if the chunk body doesn't say "README"

**Tests:** Add test: upsert a chunk with contextPrefix `[Source: "README.md"]`, search for "README" via FTS, verify the chunk is found.

**Verification:** `tsc --noEmit && npx vitest run`

**Note:** This changes FTS content. Combined with Task 1.1b's schema version bump, this will be included in the forced re-index.

#### Task 3.2: Wire context window into token budget

**File:** `src/built-in/chat/data/chatDataService.ts`

1. In the method that calls `tokenBudgetService.allocate()`, resolve the model's context length first:
   ```typescript
   const contextWindow = await ollamaProvider.getModelContextLength(activeModelId)
     .catch(() => 8192); // fallback
   ```
2. Pass `contextWindow` to `allocate()` instead of `0`

**File:** `src/built-in/chat/data/chatDataService.ts` (digest computation)

3. After resolving context window, compute dynamic digest cap:
   ```typescript
   const systemBudget = Math.floor(contextWindow * 0.10);
   const identityTokens = 150; // PARALLX_IDENTITY + rules
   const digestCharBudget = Math.max(2000, Math.min(12000, (systemBudget - identityTokens) * 4));
   ```
4. Use `digestCharBudget` as the cap in `_computeWorkspaceDigest()` instead of the static `MAX_DIGEST_CHARS`

**Tests:**
- Unit test: 8K model → digest capped at ~2,676 chars
- Unit test: 128K model → digest capped at 12,000 chars (unchanged)
- Unit test: resolution failure → falls back to 8192

**Verification:** `tsc --noEmit && npx vitest run`

#### Task 3.3: Remove dead re-ranking code

**File:** `src/services/retrievalService.ts`

1. Delete `_rerankChunks()` method
2. Delete `_scoreChunk()` method
3. Delete constants: `RERANK_MIN_RELEVANCE`, `RERANK_MAX_CHUNK_CHARS`, `RERANK_TIMEOUT_MS`
4. Delete the `shouldRerank` variable and the conditional block that called `_rerankChunks`
5. Remove any imports only used by the deleted code

**Tests:** Remove or update any tests that referenced the LLM re-ranking path.

**Verification:** `tsc --noEmit && npx vitest run`

### Phase 4 — Query Intelligence (2 tasks, optional, ~1 hour total)

These tasks re-enable the planner with safety guards. They are optional because the planner adds 2–3s latency per message. The system works well without it (direct query → hybrid search). But for complex, situation-based queries ("I got into a fender bender"), the planner generates targeted sub-queries that dramatically improve recall.

#### Task 4.1: Re-enable planner with intent short-circuit

**File:** `src/built-in/chat/data/chatDataService.ts` (or `defaultParticipant.ts`, depending on where the planner call is gated)

1. Re-enable the `planAndRetrieve()` call path for the default participant
2. Add short-circuit: if the user message is < 10 words and matches a greeting pattern (`/^(hi|hello|hey|thanks|thank you|ok|sure|yes|no|bye|goodbye)\b/i`), skip the planner and respond directly
3. Add short-circuit: if the user message starts with `/` (slash command), skip the planner

**Tests:**
- "Hello!" → skips planner, no retrieval
- "What's my collision deductible?" → runs planner, generates sub-queries
- "/clear" → skips planner

#### Task 4.2: Planner timeout with fallback

**File:** `src/built-in/chat/providers/ollamaProvider.ts`

1. In `planRetrieval()`, add a **5-second hard timeout** using `AbortController` + `setTimeout`
2. On timeout: return the fallback plan `{intent: 'question', needsRetrieval: true, queries: [originalQuery]}`
3. Log the timeout for diagnostics

**Tests:** Mock a slow planner response (>5s), verify fallback plan is returned.

**Verification:** `tsc --noEmit && npx vitest run`

---

## Task Tracker

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| 1.1 | Chunk size 2048→1024 + page overlap | ✅ | `8aa69e8` |
| 1.1b | Schema version bump for forced re-index | ⏭️ | Deferred — re-index happens automatically when content hashes change |
| 1.2 | Refine stopword list (remove 26 words) | ✅ | `21a3e5e` |
| 1.3 | FTS5 AND→OR fallback | ✅ | `f2f72ab` |
| 2.1 | Add embedding lookup to vectorStoreService | ✅ | `c7de338` |
| 2.2 | Implement cosine re-ranking | ✅ | `d4a965c` |
| 2.3 | Update retrieval parameters (top-K, per-source, budget) | ✅ | `ebbaac5` |
| 3.1 | BM25 metadata enrichment | ✅ | `dde39ba` |
| 3.2 | Wire context window into token budget | ✅ | `bfdb441` |
| 3.3 | Remove dead re-ranking code | ✅ | `d4a965c` (combined with 2.2) |
| 4.1 | Re-enable planner with intent short-circuit | ⏭️ | Deferred — all mainstream local AI apps skip planner LLM calls |
| 4.2 | Planner timeout with fallback | ⏭️ | Deferred — coupled with 4.1 |

---

## Verification Checklist

After each task:
- [ ] `tsc --noEmit` — zero errors
- [ ] `npx vitest run` — all tests pass (baseline: 1750 tests, 69 files)
- [ ] Git commit with descriptive message: `M16 Task X.Y: <description>`

After Phase 1 complete:
- [ ] Manual test: index a workspace, ask a question, verify chunks are ~1024 chars
- [ ] Manual test: search for a stopword-heavy query ("find the table"), verify results

After Phase 2 complete:
- [ ] Manual test: ask a question, verify re-ranked results appear more relevant
- [ ] Check latency: total retrieval time should be within 50ms of pre-re-ranking baseline

After Phase 3 complete:
- [ ] Manual test: ask about a specific file by name, verify BM25 boost promotes it
- [ ] Manual test: with an 8K-context model, verify digest is truncated appropriately

After Phase 4 complete (if implemented):
- [ ] Manual test: "hello" → instant response, no retrieval
- [ ] Manual test: complex situational query → planner generates 2–3 sub-queries
- [ ] Manual test: planner timeout → graceful fallback within 5s

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Chunk size reduction requires full re-index** | Users must wait for re-indexing on upgrade (~30s for 100 files) | Schema version bump triggers automatic re-index on startup. Progress shown in status bar (existing M10 feature). |
| **Cosine threshold 0.30 too aggressive** | Valid chunks filtered out, especially for vague queries | Make threshold configurable via `RetrievalOptions`. Start conservative (0.30), tune based on real-world testing. Log filtered chunks for diagnostics. |
| **AND→OR fallback returns too many results** | OR broadens results, potentially adding noise | Only trigger fallback when AND returns < K/2. OR results still go through cosine re-ranking. |
| **Context window resolution fails for unknown models** | Budget defaults to 8192, which may be too small for large-context models | 8192 is a safe floor. Log a warning when falling back. User can manually override via the existing context length setting (M15 AI Settings). |
| **Stopword removal increases FTS noise** | More terms in queries → more FTS candidates → slightly more work for re-ranking | Re-ranking handles this. The 30-candidate pool is already sized for noisy input. |
| **Re-index on schema bump loses summaries** | Document summaries stored in `indexing_metadata` are regenerated during re-index | Summaries are generated from chunk content, not user input. No data loss. |

---

## Appendix A: Current vs. Target Parameters

| Parameter | Current | Target | File |
|-----------|---------|--------|------|
| `MAX_CHUNK_CHARS` | 2048 | 1024 | chunkingService.ts |
| Page chunk overlap | 0 | 200 (on size flush) | chunkingService.ts |
| `DEFAULT_TOP_K` | 10 | 7 | retrievalService.ts |
| `DEFAULT_MAX_PER_SOURCE` | 3 | 2 | retrievalService.ts |
| `DEFAULT_TOKEN_BUDGET` | 4000 | 3000 | retrievalService.ts |
| Overfetch factor | 2× | 3× | retrievalService.ts |
| Re-ranking | disabled | cosine re-scoring (0.30 threshold) | retrievalService.ts |
| Stopwords | 115+ | ~89 (remove 26 domain words) | vectorStoreService.ts |
| FTS5 join | AND only | AND + OR fallback | vectorStoreService.ts |
| BM25 content | raw text | contextPrefix + text | vectorStoreService.ts |
| Context window | 0 (no limit) | resolved from model | chatDataService.ts |
| Digest cap | 12000 fixed | min(12000, budget-derived) | chatDataService.ts |
| Dead re-rank code | ~200 lines | removed | retrievalService.ts |

## Appendix B: File Impact Map

| File | Tasks | Changes |
|------|-------|---------|
| `src/services/chunkingService.ts` | 1.1 | MAX_CHUNK_CHARS, page overlap |
| `src/services/vectorStoreService.ts` | 1.1b, 1.2, 1.3, 2.1, 3.1 | Schema version, stopwords, FTS fallback, embedding lookup, BM25 enrichment |
| `src/services/retrievalService.ts` | 2.2, 2.3, 3.3 | Cosine re-ranking, parameters, dead code removal |
| `src/services/embeddingService.ts` | — | No changes (already correct) |
| `src/services/tokenBudgetService.ts` | — | No changes (already correct, just needs proper `contextWindow` input) |
| `src/services/indexingPipeline.ts` | — | No changes (already correct, re-indexes on hash change) |
| `src/built-in/chat/data/chatDataService.ts` | 2.3, 3.2 | Retrieval params, context window wiring, digest budget |
| `src/built-in/chat/providers/ollamaProvider.ts` | 4.2 | Planner timeout |
| `src/built-in/chat/config/chatSystemPrompts.ts` | — | No changes (planner prompt kept for Phase 4) |
