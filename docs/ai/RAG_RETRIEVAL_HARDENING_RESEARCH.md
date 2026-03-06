# RAG Retrieval Hardening — Deep Research Document

**Date**: July 2025
**Branch**: `milestone-15`
**Status**: Research complete, ready for task planning
**Related**: `docs/Parallx_Milestone_10.md` (original RAG implementation research)

---

## Problem Statement

The Parallx AI assistant's RAG retrieval pipeline consistently returns irrelevant context chunks. When a user asks about a specific document (e.g., "What FSI Shona vocabulary items appear on pages 30-50?"), the retrieval returns chunks from completely unrelated sources (EitherOr.pdf, derivatives_markets.pdf, Thus-Spoke-Zarathustra, Introduction to Insurance Mathematics). The AI then hallucinates answers from this garbage context.

**Observed failure rate**: ~90% of knowledge questions receive irrelevant or hallucinated answers.

**Root cause**: Multiple compounding failures across the retrieval pipeline, not a single bug.

---

## Current Pipeline Architecture

```
User Message
    │
    ▼
┌──────────────────────┐
│ Retrieval Planner    │  LLM generates intent + 2-4 search queries
│ (defaultParticipant) │  Uses planAndRetrieve() path
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ RetrievalService     │  retrieveMulti() — parallel per-query retrieval
│ (retrievalService.ts)│  Score threshold: 0.005 (DEFAULT_MIN_SCORE)
│                      │  Source dedup: max 3/source (DEFAULT_MAX_PER_SOURCE)
│                      │  Token budget: 4000 tokens (DEFAULT_TOKEN_BUDGET)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────┐
│ VectorStoreService               │
│ (vectorStoreService.ts)          │
│                                  │
│  _vectorSearch():                │
│    sqlite-vec KNN, k=20          │
│    cosine distance               │
│                                  │
│  _keywordSearch():               │
│    FTS5 BM25 via MATCH           │
│    sanitizeFts5Query() → OR join │ ◀── PRIMARY NOISE SOURCE
│                                  │
│  reciprocalRankFusion():         │
│    RRF k=60                      │
│    Merges vector + keyword       │
│    DEFAULT_MIN_SCORE = 0.0       │
└──────────────────────────────────┘
```

### Key Constants (Current Values)

| Constant | Value | Location | Issue |
|----------|-------|----------|-------|
| `DEFAULT_CANDIDATE_K` | 20 | vectorStoreService.ts | May be too low for large workspaces |
| `DEFAULT_TOP_K` | 10 | vectorStoreService.ts / retrievalService.ts | OK |
| `DEFAULT_MIN_SCORE` (vector store) | 0.0 | vectorStoreService.ts | Filters nothing |
| `DEFAULT_MIN_SCORE` (retrieval) | 0.005 | retrievalService.ts | Essentially filters nothing |
| `DEFAULT_MAX_PER_SOURCE` | 3 | retrievalService.ts | Good but noise fills all 3 slots |
| `DEFAULT_TOKEN_BUDGET` | 4000 | retrievalService.ts | OK |
| `RRF_K` | 60 | vectorStoreService.ts | Standard value, OK |
| `MAX_CHUNK_CHARS` | 2048 | chunkingService.ts | ~512 tokens, OK |
| `MIN_CHUNK_CHARS` | 100 | chunkingService.ts | OK |
| Chunk overlap | **0** | chunkingService.ts | **Missing — M10 recommended 50 tokens** |

---

## Identified Root Causes (7 Failures)

### Failure 1: FTS5 Keyword Search Uses OR (Primary Noise Source)

**What happens**: `sanitizeFts5Query()` splits the user's query into individual words, wraps each in quotes, and joins with `OR`.

```typescript
// Current code (vectorStoreService.ts line ~510):
function sanitizeFts5Query(query: string): string {
  const cleaned = query.replace(/[*"():^~{}[\]]/g, ' ').trim();
  const terms = cleaned.split(/\s+/).filter(Boolean);
  return terms.map((t) => `"${t}"`).join(' OR ');
}
```

**Example**: Query "FSI Shona vocabulary page numbers" becomes:
```
"FSI" OR "Shona" OR "vocabulary" OR "page" OR "numbers"
```

This matches ANY document containing the word "page" or "numbers" — which is virtually every document in a workspace. A derivatives textbook has "page" on every page. An insurance math book has "numbers" throughout.

**Evidence from FTS5 documentation** (sqlite.org/fts5.html, Section 3.7):
- `word1 OR word2` matches documents containing EITHER word
- `word1 word2` (implicit AND) matches documents containing BOTH words
- `word1 AND word2` explicitly requires both
- `NEAR("word1" "word2", 10)` requires words within 10 tokens

**Impact**: HIGH — the keyword half of hybrid search is fundamentally broken for multi-word queries. It returns noise that gets fused into the final results via RRF.

### Failure 2: Score Threshold Is Effectively Zero

**What happens**: `DEFAULT_MIN_SCORE = 0.005` in retrievalService.ts. Given the RRF formula `1/(k + rank + 1)` with k=60, even the 55th-ranked result scores `1/(60 + 55 + 1) = 0.00862`, which passes the threshold. Practically speaking, no results are filtered.

**Reference**: The M10 milestone document (Task 3.1) specified a score threshold of 0.5 for cosine similarity. The implementation used 0.005 for RRF scores — a different scale but equally ineffective.

**Impact**: MEDIUM — allows low-relevance results to consume token budget.

### Failure 3: No Re-Ranking Step After Initial Retrieval

**What happens**: Initial retrieval (vector KNN + FTS5 BM25) returns approximate matches. These are fused via RRF and directly returned. There is no secondary scoring pass that evaluates query-chunk relevance more carefully.

**Evidence from Anthropic Contextual Retrieval research** (anthropic.com/news/contextual-retrieval):
- Without re-ranking: 2.9% retrieval failure rate (with contextual embedding + BM25)
- With re-ranking (Cohere): **1.9%** retrieval failure rate — a **34% further reduction**
- Anthropic's approach: Retrieve top-150 → rerank → select top-20

**Evidence from Galileo research** (galileo.ai/blog):
- Cross-encoders outperform most LLMs for reranking while being more efficient
- Pointwise LLM reranking: score each (query, chunk) pair independently
- Adding Cohere rerank to a RAG pipeline: +10% attribution accuracy, +5% context adherence

**Reranking approaches relevant to Parallx** (local-first, Ollama-only):

| Approach | Latency | Quality | Feasibility |
|----------|---------|---------|-------------|
| **LLM pointwise scoring** (Ollama chat model) | ~200ms/chunk × 20 = 4s | Good | ✅ Our best option |
| Cross-encoder (ONNX Runtime) | ~50ms/chunk | Great | ⚠️ Needs ONNX in Electron |
| ColBERT late interaction | ~10ms/chunk | Good | ⚠️ Needs custom model |
| Cohere/Jina API | ~500ms total | Best | ❌ Requires internet |

**Recommended approach for Parallx**: LLM pointwise re-ranking via Ollama. Score each candidate chunk with a prompt like:

```
Given this search query: "{query}"
Rate the relevance of this text passage on a scale of 0-10:
"{chunk_text}"
Reply with ONLY a number 0-10.
```

Process top-20 candidates → score each → keep top-10 with score ≥ 5. With batched Ollama calls this adds ~2-4 seconds but dramatically improves precision.

**Impact**: HIGH — the single most impactful quality improvement based on Anthropic's research.

### Failure 4: No Source-Scoped Conversation Tracking

**What happens**: When a user asks "What vocabulary items are on pages 30-50?" after discussing Shona textbooks, the retrieval planner generates queries like "vocabulary page numbers" without scoping to the specific document the conversation is about. The planner's LLM call correctly identifies the intent (the planner thinking showed it understood "FSI Shona vocabulary") but the generated queries lack source specificity.

**Impact**: MEDIUM — follow-up questions lose context about which source they refer to.

### Failure 5: No Chunk Overlap (Boundary Context Loss)

**What happens**: When chunking files and pages, each chunk gets non-overlapping text. If important information spans a chunk boundary, neither chunk captures the full context.

**Evidence from M10 research** (Parallx_Milestone_10.md, DR-8):
> "Text files: chunk by paragraph/section, 256-512 token target, **50-token overlap**"

This was explicitly recommended in the M10 research but **not implemented** in chunkingService.ts. The `MAX_CHUNK_CHARS = 2048` and `MIN_CHUNK_CHARS = 100` constants exist, but there is no overlap logic.

**Evidence from Anthropic** (contextual-retrieval blog):
> "Chunk boundaries: Consider how you split your documents into chunks. The choice of chunk size, chunk boundary, and **chunk overlap** can affect retrieval performance."

**Impact**: LOW-MEDIUM — primarily affects long documents where context spans boundaries.

### Failure 6: Source Dedup Allows 3 Chunks Per Irrelevant Source

**What happens**: `DEFAULT_MAX_PER_SOURCE = 3` limits each source to 3 chunks. But when 7 irrelevant sources each contribute 3 chunks, that's 21 noise chunks consuming the entire token budget before any relevant chunks appear.

**Impact**: LOW — this is a symptom of Failures 1-3, not a root cause. Fixing keyword search and adding re-ranking will naturally reduce noise sources.

### Failure 7: Vector Candidate K May Be Too Low

**What happens**: `DEFAULT_CANDIDATE_K = 20` means the vector search only returns 20 nearest neighbors. In a large workspace with thousands of chunks, the 20 closest by cosine distance may not include the most relevant ones (especially if the query is broad).

**Impact**: LOW — vector search generally works better than keyword search for semantic matching. Increased K would help if combined with re-ranking (Anthropic used top-150 → rerank → top-20).

---

## Proposed Fixes (Ordered by Impact)

### Fix 1: Harden FTS5 Keyword Search (OR → AND with Stopword Filtering)

**Research basis**: SQLite FTS5 documentation (sqlite.org/fts5.html, Section 3.7)

**Change**: Modify `sanitizeFts5Query()` to:
1. Filter out common English stopwords ("the", "a", "is", "on", "page", "what", "how", etc.)
2. Join remaining terms with implicit AND (FTS5 treats space-separated terms as AND)
3. Fall back to OR only if AND produces zero results (two-pass approach) or if only 1 term remains

```typescript
// Proposed new implementation:
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'after', 'before', 'up', 'down', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'it', 'its', 'i', 'me', 'my', 'we', 'our',
  'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them',
  'their', 'page', 'pages', 'number', 'numbers', 'chapter', 'section',
]);

function sanitizeFts5Query(query: string): string {
  const cleaned = query.replace(/[*"():^~{}[\]]/g, ' ').trim();
  if (!cleaned) return '';

  const allTerms = cleaned.split(/\s+/).filter(Boolean);
  // Filter stopwords but keep at least content words
  const contentTerms = allTerms.filter(t => !STOPWORDS.has(t.toLowerCase()));

  // If all terms were stopwords, use original terms
  const terms = contentTerms.length > 0 ? contentTerms : allTerms;
  if (terms.length === 0) return '';

  // Use AND (implicit) — FTS5 treats "word1 word2" as "word1 AND word2"
  return terms.map(t => `"${t}"`).join(' ');
}
```

**Why AND is correct**: A query about "FSI Shona vocabulary" should only match documents containing ALL three terms. With AND: only the Shona textbook matches. With OR: every document with "vocabulary" OR any common word matches.

**Expected impact**: Eliminates the primary noise source. Keyword search will return far fewer, far more relevant results.

### Fix 2: LLM Re-Ranking via Ollama

**Research basis**: Anthropic Contextual Retrieval research (+34% quality improvement with re-ranking), Galileo research (cross-encoders and pointwise LLM reranking are both effective)

**Architecture**: Add a `rerankChunks()` function in retrievalService.ts that:
1. Takes the top-N candidates from hybrid search (increase N from 20 to 40-50)
2. Scores each (query, chunk) pair using a lightweight Ollama model call
3. Returns only chunks scoring above a relevance threshold

**Prompt design** (pointwise scoring):
```
Rate the relevance of this passage to the query. Reply with ONLY a number 0-10.

Query: {query}
Passage: {chunk_text_first_500_chars}

Score:
```

**Implementation considerations**:
- Use the same chat model already configured for the AI assistant
- Process chunks in parallel (Ollama handles concurrent requests)
- Set a timeout (e.g., 5s total) — if re-ranking times out, fall back to RRF-only results
- Cache re-ranking scores per session to avoid re-scoring the same chunks
- Only re-rank when planner path is active (not for simple tool calls)

**Performance estimate**:
- 20 chunks × ~200ms each = ~4 seconds total
- Acceptable for knowledge questions (user expects some processing time)
- Can optimize by only re-ranking top-20 instead of all 40-50

**Alternative considered**: Using Ollama's `/api/embed` with a cross-encoder model. Ollama currently supports embedding models but not cross-encoder scoring. The pointwise LLM approach is the only viable local option.

### Fix 3: Raise Score Threshold + Confidence Gating

**Research basis**: Direct pipeline analysis — current threshold of 0.005 is meaningless for RRF scores.

**Change**: Raise `DEFAULT_MIN_SCORE` from 0.005 to a meaningful value. Need to calibrate:

With RRF k=60:
- Rank 1 in both lists: score ≈ 0.0328 (1/61 + 1/61)
- Rank 1 in one list only: score ≈ 0.0164 (1/61)
- Rank 10 in both lists: score ≈ 0.0282 (1/71 + 1/71)
- Rank 10 in one list only: score ≈ 0.0141

**Proposed threshold**: 0.012 — this requires a chunk to appear in at least one list within the top ~20 positions. Chunks ranked beyond ~23 in a single list score below 0.012.

**Confidence gating addition**: After re-ranking (Fix 2), add a secondary gate — chunks with LLM relevance score < 5/10 are dropped regardless of RRF score.

### Fix 4: Add Chunk Overlap

**Research basis**: M10 milestone recommended 50-token overlap (DR-8), Anthropic notes chunk overlap affects retrieval performance.

**Change**: In `chunkingService.ts`, when splitting text content into chunks:
1. After creating a chunk, carry forward the last ~200 characters (~50 tokens) as a prefix for the next chunk
2. Only apply to file chunks (not canvas page blocks, which have natural boundaries)
3. Mark overlap text so it's not double-counted in search results

```typescript
const OVERLAP_CHARS = 200; // ~50 tokens

// When splitting file text into chunks:
for (let i = 0; i < sections.length; /* ... */) {
  const chunk = sections.slice(i, i + chunkSize);
  chunks.push(chunk);
  // Next chunk starts OVERLAP_CHARS before the end of this chunk
  i += chunkSize - OVERLAP_CHARS;
}
```

### Fix 5: Increase Vector Candidate K (If Re-Ranking Added)

**Research basis**: Anthropic uses top-150 → rerank → top-20. Current system uses top-20 → no rerank → top-10.

**Change**: If Fix 2 (re-ranking) is implemented, increase `DEFAULT_CANDIDATE_K` from 20 to 50. The re-ranker will filter out irrelevant candidates, so over-fetching is safe.

**If Fix 2 is NOT implemented**: Keep K at 20 to avoid adding more noise.

### Fix 6: Source-Aware Query Enhancement

**Research basis**: VS Code @workspace generates context-aware queries from conversation history.

**Change**: In the retrieval planner prompt, include recent conversation context so the LLM generates source-scoped queries. For example, if the user has been discussing "FSI Shona textbook", the planner should generate queries like `"FSI Shona vocabulary"` not just `"vocabulary page numbers"`.

**Implementation**: Pass the last 2-3 user messages (not just the current one) to `buildPlannerPrompt()`. The planner already receives conversation history but may not be using it effectively for query generation.

---

## Implementation Priority & Dependencies

```
Fix 1 (FTS5 AND)        ──┐
                           │
Fix 3 (Score threshold)  ──┼──▶ Phase A: Quick wins (~30 min total)
                           │
Fix 4 (Chunk overlap)    ──┘

Fix 2 (LLM Re-ranking)  ──┬──▶ Phase B: Major quality upgrade (~2 hours)
                           │
Fix 5 (Increase K)       ──┘    (depends on Fix 2)

Fix 6 (Source-aware)     ──────▶ Phase C: Conversation context (~1 hour)
```

**Phase A** is independent, fast, and eliminates the primary noise source.
**Phase B** provides the biggest quality jump per Anthropic's research.
**Phase C** addresses follow-up question quality.

---

## Sources & References

1. **Anthropic, "Introducing Contextual Retrieval"** (2024-09-19) — https://www.anthropic.com/news/contextual-retrieval
   - Contextual Embeddings + BM25 reduces retrieval failure by 49%
   - Adding reranking reduces failure by 67%
   - Top-150 → rerank → top-20 architecture
   - Chunk boundaries and overlap affect performance

2. **SQLite FTS5 Documentation** — https://www.sqlite.org/fts5.html
   - Section 3.7: AND/OR/NOT boolean operators
   - Implicit AND: `"word1" "word2"` = `"word1" AND "word2"`
   - NEAR queries: `NEAR("word1" "word2", 10)` for proximity matching
   - `rank` column returns negative BM25 scores

3. **Gao et al., "Retrieval-Augmented Generation for Large Language Models: A Survey"** (2024) — https://arxiv.org/abs/2312.10997
   - Advanced RAG: pre-retrieval optimization, post-retrieval re-ranking
   - Modular RAG: composable retrieval → re-ranking → generation pipeline

4. **Galileo, "Mastering RAG: How to Select a Reranking Model"** (2024) — https://www.galileo.ai/blog/mastering-rag-how-to-select-a-reranking-model
   - Cross-encoders outperform LLMs for reranking (except GPT-4)
   - Pointwise LLM reranking: score each (query, chunk) independently
   - +10% attribution, +5% context adherence with Cohere reranking

5. **Parallx M10 Milestone Research** — `docs/Parallx_Milestone_10.md`
   - DR-5: RRF implementation with k=60
   - DR-6: Contextual Retrieval with structural context prefixes
   - DR-8: Recommended 50-token overlap (not implemented)
   - Task 3.1: Originally specified 0.5 cosine similarity threshold

6. **Cormack, Clarke & Butt, "Reciprocal Rank Fusion"** (2009), SIGIR
   - RRF formula: `score(d) = Σ 1/(k + rank(d))`
   - k=60 standard smoothing constant
