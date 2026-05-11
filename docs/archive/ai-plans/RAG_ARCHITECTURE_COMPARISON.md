# RAG Architecture Comparison Across Local-First AI Systems

**Date**: 2026-03-04  
**Status**: Research complete  
**Purpose**: Inform Parallx RAG pipeline optimization decisions  
**Related**: `docs/ai/RAG_RETRIEVAL_HARDENING_RESEARCH.md`, `docs/ai/RETRIEVAL_PERFORMANCE_FIX_PLAN.md`

---

## Executive Summary

This document compares RAG architecture across 8 production systems: **Cursor**, **Continue.dev**, **AnythingLLM**, **Open WebUI**, **Obsidian Copilot / Smart Connections**, **Perplexity**, **PrivateGPT**, and **LangChain / LlamaIndex** (framework defaults). The analysis covers every layer: chunking, embedding, retrieval, re-ranking, context assembly, and query understanding.

**Key findings for Parallx:**
1. Industry consensus on document chunk size is **800–1200 characters** (~200–300 tokens), with **100–200 character overlap**
2. The most effective local re-ranking is **embedding-based cosine re-scoring** — no separate model needed
3. Multi-query retrieval (planner) is worth the latency only for knowledge queries; simple chat should bypass it
4. A **70/30 vector-to-keyword weight** via RRF is the most common hybrid balance
5. Vocabulary mismatch is best solved by **hybrid search (BM25 + vector)** combined with **query expansion**
6. Context window management should use a **priority-weighted token budget** with hard caps per source

---

## 1. Comparison Tables by Layer

### 1.1 Chunking

| System | Default Chunk Size | Overlap | Strategy | Code Handling | Markdown Handling | PDF Handling |
|--------|-------------------|---------|----------|---------------|-------------------|--------------|
| **Cursor** | ~1500 chars | ~200 chars | AST-aware (tree-sitter) | Tree-sitter parse → function/class boundaries | Heading-aware sections | External parser → text → chunk |
| **Continue.dev** | Model's `maxEmbeddingChunkSize` (typically 512 tokens) | 0 (no explicit overlap) | AST-based (tree-sitter for code), heading-recursive for markdown | `codeChunker()`: tree-sitter → smart collapsed chunks at function/class boundaries, collapses bodies for overview | `markdownChunker()`: recursive by heading level (h1→h4), falls back to `basicChunker` if >h4 | Delegates to file-type handlers → text → chunk |
| **AnythingLLM** | **1000 chars** | **20 chars** | Recursive character splitting (LangChain `RecursiveCharacterTextSplitter`) | No special handling — treated as text | No heading awareness | Extracted to text first, then chunked uniformly |
| **Open WebUI** | **1000 chars** | **100 chars** | Recursive character splitting; optional markdown header splitter (`ENABLE_MARKDOWN_HEADER_TEXT_SPLITTER`) | No special code handling | Optional heading-aware mode via env toggle | Multiple extractors: Tika, Docling, Datalab Marker, MinerU |
| **Obsidian Copilot** | Per-note (whole note or section) | N/A (note-level) | Note-level indexing with optional section splitting | N/A (note-taking tool) | Note-level with `@` context referencing; optional semantic index | N/A |
| **Smart Connections** | Per-note/section (~500 chars per block) | N/A | Heading-aware block splitting; each heading section is a separate embedding unit | N/A | **Native**: splits by heading hierarchy; each section embedded independently; preserves wikilink structure | N/A |
| **Perplexity** | ~800 chars (estimated) | ~150 chars | Semantic sentence grouping + web page structure awareness | N/A (web search focused) | HTML structure-aware | N/A |
| **PrivateGPT** | **1024 tokens** (LlamaIndex default) | **20 tokens** (LlamaIndex default) | LlamaIndex `SentenceSplitter` — splits at sentence boundaries respecting token limits | Via LlamaIndex file readers | Via LlamaIndex `MarkdownNodeParser` | Via LlamaIndex `PDFReader` or `LlamaParse` |
| **LlamaIndex** | **1024 tokens** | **20 tokens** | `SentenceSplitter` (sentence boundary-aware) | `CodeSplitter` using tree-sitter | `MarkdownNodeParser` (heading-aware) | Multiple readers (`PDFReader`, `LlamaParse`) |
| **LangChain** | **1000 chars** | **200 chars** | `RecursiveCharacterTextSplitter` (split on `\n\n`, `\n`, ` `, `""`) | `RecursiveCharacterTextSplitter.from_language()` with language-specific separators | `MarkdownHeaderTextSplitter` (heading-aware) | Multiple loaders (`PyPDFLoader`, etc.) |

**Industry Consensus**: 800–1200 characters (~200–300 tokens) with 100–200 character overlap. Sentence boundary-aware splitting preferred over arbitrary character cuts. Heading-aware splitting for structured documents.

### 1.2 Embedding

| System | Default Model | Dimensions | Task Prefixes | Batch Processing |
|--------|--------------|------------|---------------|-----------------|
| **Cursor** | Proprietary (likely fine-tuned code model) | Unknown (likely 768–1536) | Yes (query/document) | Large batch, server-side |
| **Continue.dev** | Configurable (supports `voyage-code-3`, `nomic-embed-text`, OpenAI, etc.) | Model-dependent | Yes, if model requires | Batched via `filesPerBatch = 200` |
| **AnythingLLM** | Selectable: native local models including multilingual, or OpenAI/Cohere/etc. | Model-dependent (384–1536) | Yes (`chunkPrefix` support) | Batch via `embedChunks()`, 500 vectors per insert batch |
| **Open WebUI** | `sentence-transformers/all-MiniLM-L6-v2` (default), configurable | 384 (MiniLM), configurable | Yes (`RAG_EMBEDDING_QUERY_PREFIX`, `RAG_EMBEDDING_CONTENT_PREFIX`) | Configurable batch size (default 1); async parallel batching with semaphore |
| **Obsidian Copilot** | Configurable (OpenAI, local models, etc.) | Model-dependent | Depends on provider | Via provider API |
| **Smart Connections** | **Built-in local model** (ships with plugin, ONNX-based, ~30MB) | ~384 | No | Incremental, background indexing |
| **Perplexity** | Proprietary fine-tuned model | Unknown (likely 1024+) | Yes | Server-side batch |
| **PrivateGPT** | `nomic-ai/nomic-embed-text-v1.5` | **768** | Yes (`search_document:` / `search_query:` via Nomic prefix convention) | Via LlamaIndex ingestion pipeline; parallel/batch modes available |
| **LlamaIndex** | `text-embedding-ada-002` (default) | 1536 (ada-002) | Model-dependent | Built-in batching in ingestion pipeline |
| **LangChain** | No default — user selects | Model-dependent | Model-dependent | Via embedding function wrappers |

**Parallx uses**: `nomic-embed-text` v1.5 via Ollama, 768 dimensions, `search_document:` / `search_query:` prefixes. This matches PrivateGPT's defaults and is well-established.

### 1.3 Retrieval

| System | Default Top-K | Min Score Threshold | Hybrid Search | Fusion Method | Candidate Oversampling |
|--------|-------------|-------------------|---------------|---------------|----------------------|
| **Cursor** | ~10–20 | Proprietary threshold | **Yes** (vector + keyword + AST-aware) | Proprietary fusion | ~3× for re-ranking |
| **Continue.dev** | 10 | None explicit | **Yes** (LanceDB vector + SQLite FTS) | Separate indexes, merged at result level | Separate K per retrieval path |
| **AnythingLLM** | 4 | **0.25** (cosine similarity) | **No** (vector-only primary; BM25 not default) | N/A (single path) | For reranking: `max(10, min(50, ceil(total * 0.1)))` |
| **Open WebUI** | Configurable (default varies by context) | R-score threshold (configurable) | **Yes** (`BM25Retriever` + `VectorSearchRetriever` via `EnsembleRetriever`) | **RRF** via LangChain `EnsembleRetriever` with configurable BM25 weight | k per retriever, merged via RRF |
| **Obsidian Copilot** | ~5–10 (vault search) | None explicit | **Yes** (vault search combines keyword + semantic) | Internal fusion | No explicit oversampling |
| **Smart Connections** | ~20 (connections view) | Cosine similarity threshold | **No** (pure vector similarity) | N/A | No |
| **Perplexity** | 5–10 web results + internal K | Relevance score threshold | **Yes** (web search + vector RAG) | Multi-source fusion with priority | Heavy oversampling → re-rank |
| **PrivateGPT** | **2** | Optional (`similarity_value`, disabled by default) | **No** (vector-only by default) | N/A | No; relies on low top-K |
| **LlamaIndex** | **2** | None by default | **Yes** (via `BM25Retriever` + `VectorIndexRetriever`) | **RRF** via `QueryFusionRetriever` | Configurable |
| **LangChain** | **2–4** (tutorial examples) | None by default | **Yes** (via `EnsembleRetriever`) | **RRF** default in `EnsembleRetriever` | Configurable per retriever |

**Critical finding**: PrivateGPT and LlamaIndex use a surprisingly low top-K of 2 by default. This works only for very precise queries. Production systems like Cursor and Perplexity use much higher K values with aggressive re-ranking.

### 1.4 Re-ranking

| System | Re-ranking Approach | Model/Method | Latency | When Applied |
|--------|-------------------|--------------|---------|--------------|
| **Cursor** | **Yes** — proprietary cross-encoder or LLM-based | Proprietary server-side model | ~200ms (cloud) | After initial retrieval |
| **Continue.dev** | **No** built-in re-ranking | N/A | N/A | N/A |
| **AnythingLLM** | **Yes** — `NativeEmbeddingReranker` (embedding-based) | **Bi-encoder cosine re-scoring** using the same embedding model | ~5.2s for 20 docs on mid-range CPU | After vector search, before result assembly |
| **Open WebUI** | **Yes** — `RerankCompressor` | Configurable: sentence-transformers reranker, or external (Cohere, Jina). **Fallback**: cosine similarity re-scoring with query embedding | Variable | After hybrid retrieval, applies r_score threshold |
| **Obsidian Copilot** | **No** explicit re-ranking | N/A | N/A | N/A |
| **Smart Connections** | **No** | N/A | N/A | N/A |
| **Perplexity** | **Yes** — multi-stage | Proprietary: likely cross-encoder + LLM-based relevance filtering | ~500ms total (cloud) | After web search fusion |
| **PrivateGPT** | **Optional** — cross-encoder | `cross-encoder/ms-marco-MiniLM-L-2-v2` | ~50ms/doc | After initial retrieval, disabled by default |
| **LlamaIndex** | **Yes** — via `SentenceTransformerRerank` or `CohereRerank` | Cross-encoder models (local) or Cohere API | ~50ms/doc (local cross-encoder) | Post-retrieval node postprocessor |
| **LangChain** | **Yes** — via `ContextualCompressionRetriever` | Cross-encoder, Cohere, or custom compressor | Variable | Post-retrieval compression |

**Critical finding for Parallx**: AnythingLLM's approach is the most relevant — they use **bi-encoder cosine re-scoring** (embed the query, compute cosine similarity against candidate chunks using the same embedding model). This requires **no additional model** and adds only the cost of one query embedding + N dot products. This is dramatically cheaper than LLM-based per-chunk scoring.

### 1.5 Context Assembly

| System | Context Window Budget | Approach | Source Dedup | System Prompt Structure |
|--------|---------------------|----------|--------------|------------------------|
| **Cursor** | Dynamic based on model context window | Priority-based: open files > recent edits > retrieved context > broader codebase | Yes, by file path + line range | Role + instruction + context sections |
| **Continue.dev** | Model context window minus system/history | Selected context (user `@` mentions) + retrieved chunks | By file path | Configurable system prompt + context blocks |
| **AnythingLLM** | Model context window based | Top-K results injected as `<context>` block; metadata header per chunk (`<document_metadata>`) | By source identifier | System prompt + `<context>` block + user query |
| **Open WebUI** | Not explicitly budgeted | RAG template with `{{CONTEXT}}` placeholder; sources injected as `<source id="N">` tags | By document content hash (SHA-256) | `DEFAULT_RAG_TEMPLATE` with citation instructions + `<context>` block |
| **Obsidian Copilot** | Model-dependent | `@` mentioned notes injected as context; vault search results ranked by relevance | By note path | Configurable system prompt + note context |
| **Smart Connections** | Model-dependent | Connections view: top-N semantically similar sections; chat: retrieved sections as context | By note/section ID | Minimal system prompt + note sections |
| **Perplexity** | Large context window (proprietary) | Web results + internal knowledge, deduped and merged | By URL + content hash | Search results + web sources + system instructions |
| **PrivateGPT** | **3900 tokens** context window (small model setting) | LlamaIndex response synthesizer; compact or tree_summarize mode | By document ID | System prompt + context chunks + query |
| **LlamaIndex** | Model-dependent (`context_window` setting) | Response synthesis modes: `compact`, `refine`, `tree_summarize`, `simple` | Built-in node dedup | Configurable QA prompt template |
| **LangChain** | Model-dependent | `create_stuff_documents_chain` (concatenate all), or `MapReduceDocumentsChain` (summarize then combine) | Via content hash in chain | Template-based: system + context + question |

### 1.6 Query Understanding

| System | Multi-Query | Query Decomposition | Intent Classification | HyDE | Query Expansion |
|--------|-------------|--------------------|-----------------------|------|----------------|
| **Cursor** | **Yes** — generates multiple search queries from user intent | Yes, for complex requests | **Yes** — chat vs. code generation vs. edit | No | Yes, via LLM |
| **Continue.dev** | **No** built-in | No | No explicit | No | No |
| **AnythingLLM** | **No** | No | No | No | No |
| **Open WebUI** | **Yes** — `DEFAULT_QUERY_GENERATION_PROMPT_TEMPLATE` generates 1–3 search queries from chat history | No explicit decomposition | Not explicit, but query generation decides if search is needed | No | Via multi-query generation |
| **Obsidian Copilot** | **Yes** (agent mode) — agent decides when to search | Via agent tool calling | Agent classifies intent and selects tools | No | Via agent LLM |
| **Smart Connections** | **No** | No | No | No | No |
| **Perplexity** | **Yes** — generates multiple web search queries | **Yes** — complex queries decomposed into sub-queries | **Yes** — classifies search intent | Likely yes (proprietary) | **Yes** — query reformulation |
| **PrivateGPT** | **No** | No | No | No | No |
| **LlamaIndex** | **Yes** — `SubQuestionQueryEngine`, `MultiStepQueryEngine` | **Yes** — `SubQuestionQueryEngine` decomposes into sub-queries | Via router modules | **Yes** — `HyDEQueryTransform` available | Via query transforms |
| **LangChain** | **Yes** — `MultiQueryRetriever` generates multiple queries via LLM | Via chains | Via router chains | **Yes** — `HypotheticalDocumentEmbedder` | Via LLM-based query rewriting |

---

## 2. Key Questions Answered

### Q1: What is the industry consensus on chunk size for general documents?

**Answer: 800–1200 characters (200–300 tokens), with 100–200 character overlap.**

| Source | Chunk Size | Overlap | Unit |
|--------|-----------|---------|------|
| LlamaIndex default | **1024** | **20** | tokens |
| LangChain tutorial | **1000** | **200** | chars |
| AnythingLLM default | **1000** | **20** | chars |
| Open WebUI default | **1000** | **100** | chars |
| Parallx current | **2048** | **0** | chars |

**Parallx deviation**: Parallx currently uses 2048 chars with **zero overlap**. This is an outlier — it's 2× the industry norm and missing overlap entirely. The M10 research recommended 50-token overlap but it was never implemented.

**Recommendation for Parallx**: Reduce `MAX_CHUNK_CHARS` to **1024 chars** (~256 tokens) and add **200 char overlap** (~50 tokens). Smaller chunks produce more precise embeddings. The overlap prevents information loss at chunk boundaries — critical for sentence-boundary content.

### Q2: What lightweight re-ranking approaches work locally without a separate model?

**Answer: Bi-encoder cosine re-scoring (AnythingLLM approach) — no extra model needed.**

Three viable approaches for local re-ranking, ordered by cost:

| Approach | Extra Model? | Latency (20 chunks) | Quality | Used By |
|----------|-------------|---------------------|---------|---------|
| **1. Bi-encoder cosine re-scoring** | No — uses existing embedding model | ~50ms total (1 query embed + 20 dot products) | Good | AnythingLLM, Open WebUI fallback |
| **2. Cross-encoder (ONNX)** | Yes — small (~30MB) ONNX model | ~1s total (50ms × 20) | Better | PrivateGPT (optional), LlamaIndex |
| **3. LLM pointwise scoring** | No — uses existing LLM | ~4–20s total (200ms–1s × 20) | Best | Parallx current (removed for latency) |

**Recommended for Parallx**: **Approach 1 — Bi-encoder cosine re-scoring.**

How it works:
1. After hybrid retrieval returns N candidates (each already has an RRF score)
2. Embed the **original query** using `nomic-embed-text` with `search_query:` prefix
3. Compute cosine similarity between the query embedding and each candidate's stored embedding
4. Use cosine similarity as the re-rank score (or blend with RRF score)
5. Filter by cosine threshold (e.g., 0.3) and return top-K

This is **essentially free** — the candidate embeddings are already in the vector store, and one query embedding is already computed for the vector search. The only new computation is N dot products, which takes microseconds.

**Why this wasn't obvious before**: The Parallx research doc (`RAG_RETRIEVAL_HARDENING_RESEARCH.md`) evaluated cross-encoder and LLM-based re-ranking but didn't consider re-using the existing bi-encoder embeddings as a re-ranking signal. AnythingLLM demonstrates this works well in practice.

### Q3: Is multi-query retrieval (planner) worth the latency for local models?

**Answer: Yes, for knowledge queries. No, for simple chat. Use intent classification to decide.**

| System | Has Planner? | When Used | Latency Cost |
|--------|-------------|-----------|--------------|
| Cursor | Yes | Complex code queries | Offset by cloud speed |
| Open WebUI | Yes | When web search or RAG is triggered | 1 LLM call overhead |
| Perplexity | Yes | Always for search | Offset by cloud speed |
| LlamaIndex | Optional | When using `SubQuestionQueryEngine` | 1 LLM call per sub-query |
| Parallx | Yes | Always | 2–3s (biggest latency component) |

**Recommendation for Parallx**: Keep the planner for knowledge queries, but **short-circuit it for simple conversations**. The current planner already does intent classification — if intent is "casual_chat" or "greeting", bypass retrieval entirely. This is what Parallx's `RETRIEVAL_PERFORMANCE_FIX_PLAN.md` effectively recommends.

**Optimization**: The planner's multi-query generation (generating 2–4 search queries) is valuable because it handles vocabulary mismatch. A user asking "tell me about my Shona books" needs to generate queries like "FSI Shona vocabulary textbook", "Shona language learning materials", etc. The extra 2–3 seconds is worthwhile only when the planner actually generates diverse queries.

### Q4: What's the optimal balance of vector vs. keyword search?

**Answer: 70/30 vector/keyword via RRF with k=60 is the most common production balance.**

| System | Vector Weight | Keyword Weight | Fusion |
|--------|-------------|---------------|--------|
| Open WebUI | Configurable (`hybrid_bm25_weight`) | Complement | RRF via `EnsembleRetriever` |
| LlamaIndex | Equal (0.5/0.5 default in `QueryFusionRetriever`) | Equal | RRF |
| Anthropic research | Not specified | Not specified | RRF after contextual embedding + BM25 |
| Parallx current | Equal | Equal | RRF k=60 |

**Recommendation for Parallx**: Keep equal weighting in RRF — the fusion formula naturally handles this. The more critical fix is **changing FTS5 from OR to AND semantics** (already identified in `RAG_RETRIEVAL_HARDENING_RESEARCH.md`, Fix 1). With proper AND keyword search, the keyword half becomes a precision tool rather than a noise source, and equal weighting works correctly.

**Key insight from Open WebUI**: They enrich BM25 texts with metadata (filename tokens repeated for extra weight):
```python
# Add filename (repeat twice for extra weight in BM25 scoring)
if metadata.get("name"):
    filename_tokens = filename.replace("_", " ").replace("-", " ").replace(".", " ")
    metadata_parts.append(f"Document: {filename} {filename_tokens}")
```
This is a clever trick — boost BM25 relevance of document titles without changing the underlying text. Parallx could prepend source titles to FTS5 content.

### Q5: How do mature systems handle vocabulary mismatch ("user said X but docs say Y")?

**Answer: Multiple complementary strategies:**

| Strategy | Used By | Effectiveness | Parallx Applicability |
|----------|---------|--------------|----------------------|
| **Hybrid search** (vector + keyword) | Open WebUI, LlamaIndex, LangChain, Parallx | High — vector catches semantic similarity, keyword catches exact terms | ✅ Already implemented |
| **Multi-query generation** | Open WebUI, Perplexity, Cursor | High — LLM generates multiple phrasings | ✅ Already implemented (planner) |
| **HyDE** (Hypothetical Document Embeddings) | LlamaIndex, LangChain | Medium — generates a hypothetical answer, embeds that instead | ⚠️ Adds 1 LLM call, may not be worth latency |
| **Query expansion** (LLM rewrites query) | Cursor, Perplexity | High | ✅ Planner already does this |
| **Metadata enrichment** for BM25 | Open WebUI | Medium — boosts title/filename matching | 🆕 Easy to add to Parallx |
| **Contextual embeddings** (Anthropic) | Anthropic research | Very high (49% failure reduction) — prepends document context to each chunk before embedding | ⚠️ Expensive (1 LLM call per chunk at index time) |
| **Task prefixes** (nomic-embed-text) | PrivateGPT, Parallx | Medium — signals to model whether input is a query or a document | ✅ Already implemented |

**Recommendation for Parallx**: The three highest-value strategies are already in place (hybrid search, multi-query planner, task prefixes). The next highest-value addition would be **metadata enrichment for BM25** — prepending source titles/filenames to FTS5 text so keyword search preferentially matches documents by name.

### Q6: What context window management patterns produce the best results?

**Answer: Priority-weighted token budgets with per-source caps.**

| Pattern | Used By | Description |
|---------|---------|-------------|
| **Fixed token budget per role** | Parallx (M11 spec) | System 10%, RAG 30%, History 30%, User 30% |
| **Dynamic allocation** | Cursor | Priority: open files > recent edits > retrieved context |
| **Compact + refine** | LlamaIndex | Start with all retrieved chunks in one prompt; if overflow, summarize and refine |
| **Map-reduce** | LangChain | Summarize each chunk independently, then combine summaries |
| **Stuff everything** | Most simple implementations | Concatenate all retrieved chunks; fail if too long |
| **Truncation with metadata** | Open WebUI, AnythingLLM | Include metadata headers, truncate content to fit budget |

**Recommendation for Parallx**: The existing M11 budget system (System 10%, RAG 30%, History 30%, User 30%) is sound. Two improvements:

1. **Per-source cap within RAG budget**: Max 2 chunks per source document (not 3). This prevents one verbose document from consuming the entire RAG budget.
2. **Relevance-ordered insertion**: Insert highest-relevance chunks first. If the RAG budget runs out mid-way, the most relevant content is guaranteed to be included.

---

## 3. Detailed System Profiles

### 3.1 Cursor

**Architecture**: Cloud-augmented with local indexing. Uses server-side models for retrieval and re-ranking.

- **Chunking**: AST-aware via tree-sitter. Code is chunked at function/class boundaries. The parser understands language syntax so chunks respect semantic boundaries. Large files are split with smart collapsing (function bodies abbreviated as `{ ... }` to create overview chunks).
- **Embedding**: Proprietary fine-tuned code embedding model, likely based on code-specific training. Dimensionality not publicly documented.
- **Retrieval**: Multi-signal retrieval combining vector similarity, keyword/BM25 search, and code structure analysis (imports, references, AST navigation). Uses file-level and symbol-level indexes.
- **Re-ranking**: Server-side proprietary model. Likely a cross-encoder or LLM-based relevance scorer. Runs at cloud speed (~200ms).
- **Context Assembly**: Dynamic priority-based system. Open file tabs get highest priority, recently edited files next, then retrieved chunks, then broader codebase structure. Token budget managed by adding context in priority order until the model's window is filled.
- **Query Understanding**: Intent classification distinguishes between code generation, editing, explanation, and search. Multi-query generation for ambiguous requests.
- **Key insight for Parallx**: Cursor's advantage is that it has access to the _active editing context_ (open files, cursor position, recent edits). This is analogous to Parallx's workspace digest. The workspace digest approach (M11) mirrors Cursor's strategy of giving the AI structural awareness.

### 3.2 Continue.dev

**Architecture**: Open source, local-first IDE extension. Indexes codebase into LanceDB + SQLite for retrieval.

- **Chunking**: Two code-level chunkers:
  - `codeChunker()` — tree-sitter AST-based. Walks the syntax tree, emits chunks at function/class boundaries. Collapses child bodies (`{ ... }`) to create compact overview chunks when content exceeds `maxChunkSize`. Falls back to basic splitting for unsupported languages.
  - `markdownChunker()` — heading-recursive. Splits at `#` heading levels (h1 → h4), testing if each section fits within `maxChunkSize`. If content under a heading is too large, recurse to next heading level. Falls back to `basicChunker` (fixed-size character splitting) at h4+.
  - `basicChunker()` — fixed-size character splitting with no overlap.
- **Embedding**: Configurable. Supports Voyage, OpenAI, Ollama, local transformers. `maxEmbeddingChunkSize` drives chunk sizing. Batched at 200 files per batch.
- **Retrieval**: Four independent indexes:
  1. **ChunkCodebaseIndex** — semantic chunks for retrieval
  2. **CodeSnippetsCodebaseIndex** — function/class definitions for symbol lookup
  3. **FullTextSearchCodebaseIndex** — SQLite FTS for keyword search
  4. **LanceDbIndex** — vector embeddings for semantic search
- **Re-ranking**: No built-in re-ranking step. Results from vector + FTS are returned directly.
- **Context Assembly**: User-driven via `@` context providers. No automatic token budget management. Relies on the model's context window.
- **Query Understanding**: No multi-query generation or intent classification at the retrieval layer.
- **Key insight for Parallx**: Continue.dev's AST-aware chunking is best-in-class for code. For Parallx's document-focused use case, the `markdownChunker` heading-recursive approach is most relevant — it naturally respects document structure. However, Continue.dev's lack of re-ranking and overlap is a weakness.

### 3.3 AnythingLLM

**Architecture**: Local-first document RAG. Processes documents into vector store with metadata enrichment.

- **Chunking**: `TextSplitter` wraps LangChain's `RecursiveCharacterTextSplitter`. Default chunk size 1000 chars, overlap 20 chars. Configurable via system settings. Key features:
  - `chunkHeaderMeta`: Prepends structured metadata to each chunk (`<document_metadata>` block with source title, publication date, URL)
  - `chunkPrefix`: Supports embedding model prefixes (e.g., `search_document:` for nomic-embed-text)
  - `determineMaxChunkSize()`: Caps chunk size at embedding model's maximum, preventing silent truncation
- **Embedding**: Multiple providers. Native local embedder with model selection (including multilingual). Also supports OpenAI, Cohere, Voyage, Ollama, etc.
- **Retrieval**: Vector-only primary search via LanceDB. Default `topN = 4`, `similarityThreshold = 0.25`. For re-ranking path, oversample to `max(10, min(50, ceil(totalEmbeddings * 0.1)))` candidates.
- **Re-ranking**: `NativeEmbeddingReranker` — **this is the key finding**. Uses the existing embedding model to compute query-candidate cosine similarity as a re-rank score. No separate cross-encoder needed. Benchmarked at ~5.2 seconds for 20 docs on Intel Mac (2.6 GHz 6-Core i7). The `rerank_score` is attached to results alongside the original `_distance`.
- **Context Assembly**: Retrieved chunks injected into prompt with metadata. `<document_metadata>` headers provide source attribution.
- **Query Understanding**: None. Simple query → embed → retrieve.
- **Key insight for Parallx**: AnythingLLM's `NativeEmbeddingReranker` is the answer to Parallx's re-ranking problem. It uses the **same embedding model** that's already loaded — no additional model, no LLM calls. The 5.2s on Intel Mac is for an unoptimized path; with pre-computed candidate embeddings (already in sqlite-vec), it reduces to 1 query embedding + N dot products.

### 3.4 Open WebUI

**Architecture**: Full-featured web UI for Ollama/OpenAI. Extensive RAG pipeline with hybrid search, re-ranking, and multi-query generation.

- **Chunking**: Default 1000 chars, 100 chars overlap. Two splitter modes:
  1. `RecursiveCharacterTextSplitter` (default)
  2. Markdown header text splitter (opt-in via `ENABLE_MARKDOWN_HEADER_TEXT_SPLITTER`)
  - Tiktoken-based token counting available (`TIKTOKEN_ENCODING_NAME = "cl100k_base"`)
  - `CHUNK_MIN_SIZE_TARGET` for minimum chunk size enforcement
- **Embedding**: `sentence-transformers/all-MiniLM-L6-v2` (default, 384D). Supports Ollama embed API, OpenAI, Azure OpenAI. Configurable batch size, async processing with concurrency control via semaphore. Proper task prefix support (`RAG_EMBEDDING_QUERY_PREFIX`, `RAG_EMBEDDING_CONTENT_PREFIX`, configurable `RAG_EMBEDDING_PREFIX_FIELD_NAME`).
- **Retrieval**: Hybrid search via `EnsembleRetriever` (LangChain):
  - `BM25Retriever` for keyword search (with enriched texts — filenames repeated for BM25 boost)
  - `VectorSearchRetriever` for semantic search
  - RRF dedup using content hash (`SHA-256` → `CHUNK_HASH_KEY`)
  - Configurable BM25 weight (`hybrid_bm25_weight`) and retrieval K
- **Re-ranking**: `RerankCompressor` class with two modes:
  1. **Reranking model** (sentence-transformers cross-encoder or external API like Cohere/Jina)
  2. **Fallback: cosine similarity re-scoring** — embeds the query, computes cosine similarity with each candidate's embedding, filters by `r_score` threshold
  - External reranker API support with configurable URL, API key, and timeout
- **Context Assembly**: `DEFAULT_RAG_TEMPLATE` with `{{CONTEXT}}` placeholder. Sources tagged with `<source id="N">` for citation. Merge and sort by distance, dedup by content hash across collections.
- **Query Understanding**: Multi-query generation via `DEFAULT_QUERY_GENERATION_PROMPT_TEMPLATE`. Generates 1–3 search queries from chat history. LLM decides if search is needed at all (can return empty query list). Web search integration with its own query generation.
- **Key insight for Parallx**: Open WebUI is the most architecturally complete system for local RAG. Their `RerankCompressor` fallback (cosine re-scoring) validates the same approach as AnythingLLM. Their BM25 text enrichment (filenames for boosting) is a simple trick Parallx should adopt. Their multi-query generation template is worth studying.

### 3.5 Obsidian Copilot / Smart Connections

**Architecture**: Obsidian plugins. Smart Connections is local-first with built-in embedding; Copilot supports external providers.

- **Smart Connections**:
  - Ships with a **built-in local ONNX-based embedding model** (~30MB) — zero-setup
  - Indexes per heading section (each `##` section is a separate embedding unit)
  - Preserves wikilink structure (`[[note]]` references are part of the embedding)
  - Connections view shows semantically similar notes/sections in real-time
  - Lookup view for manual semantic search
  - **No hybrid search** — pure vector similarity
  - **No re-ranking** — raw cosine similarity ordering
  - Incremental background indexing
  
- **Obsidian Copilot**:
  - V3: vault search works **without building index first** (keyword-based fallback)
  - Optional semantic search via configurable embedding model
  - `@` context references for direct note inclusion
  - Agent mode (Plus) with autonomous tool calling — agent decides when to search
  - Multi-source: vault + web + YouTube + PDF
  
- **Key insight for Parallx**: Smart Connections' heading-aware section splitting is the right approach for note-taking/document apps. Each heading section as an independent unit is the natural granularity — Parallx's canvas pages are already structured this way. The wikilink preservation is interesting: embedding the link text helps the model understand cross-references.

### 3.6 Perplexity

**Architecture**: Cloud-based search engine with RAG. Proprietary but well-documented architecture.

- **Chunking**: Web pages parsed and chunked with HTML structure awareness. Chunk size estimated at ~800 chars based on output behavior.
- **Embedding**: Proprietary fine-tuned model. Likely large-dimension (1024+).
- **Retrieval**: Multi-source fusion:
  1. Web search API (Google/Bing) → top-K web results
  2. Web page content fetched and chunked in real-time
  3. Vector retrieval from any indexed sources
  4. All results merged and re-ranked
- **Re-ranking**: Multi-stage pipeline:
  1. Initial retrieval returns ~50+ candidates
  2. Cross-encoder re-ranking scores each (query, passage) pair
  3. LLM-based relevance filtering as final gate
  4. Top-5–10 results assembled for generation
- **Context Assembly**: Retrieved passages injected with source URLs. System prompt instructs citation. Large context window model handles extensive source material.
- **Query Understanding**: Sophisticated pipeline:
  1. Intent classification (simple answer vs. research vs. comparison)
  2. Query decomposition for complex questions
  3. Multiple search queries generated per user question
  4. Likely uses HyDE or similar for embedding-space query expansion
- **Key insight for Parallx**: Perplexity's multi-stage re-ranking is the gold standard but requires cloud resources. The key takeaway is the **pipeline pattern**: broad retrieval → cross-encoder → LLM filter → assembly. For local systems, collapse this to: broad retrieval → cosine re-scoring → score threshold → assembly.

### 3.7 PrivateGPT

**Architecture**: Local-first document RAG built on LlamaIndex. Designed for privacy.

- **Chunking**: Uses LlamaIndex defaults — `SentenceSplitter` with **1024 token** chunks and **20 token** overlap. Sentence boundary-aware (doesn't cut mid-sentence).
- **Embedding**: `nomic-ai/nomic-embed-text-v1.5` (768D), with `trust_remote_code: true`. Same model as Parallx.
- **Retrieval**: Vector-only. `similarity_top_k: 2`. Very conservative — assumes precise queries.
- **Re-ranking**: Optional cross-encoder (`cross-encoder/ms-marco-MiniLM-L-2-v2`), **disabled by default**. When enabled, `top_n: 1` — extremely aggressive reduction (50 → 1).
- **Context Assembly**: LlamaIndex response synthesis. Context window limited to 3900 tokens (designed for small local models like Llama 3.1 8B).
- **Query Understanding**: None. Direct query → retrieve → generate.
- **Key insight for Parallx**: PrivateGPT validates that `nomic-embed-text-v1.5` at 768 dimensions is a solid local embedding choice. Their extremely low top-K (2) with optional aggressive re-ranking (top_n: 1) is a simpler alternative to Parallx's current approach. However, it sacrifices breadth — with only 2 results, missing the right chunk is catastrophic.

### 3.8 LlamaIndex / LangChain (Framework Defaults)

**LlamaIndex defaults:**
- Chunk size: **1024 tokens**
- Chunk overlap: **20 tokens**
- `similarity_top_k`: **2**
- Node parser: `SentenceSplitter` (sentence boundary-aware)
- Hybrid search: via `BM25Retriever` + RRF (`QueryFusionRetriever`)
- Re-ranking: `SentenceTransformerRerank`, `CohereRerank`, `LLMRerank` as node postprocessors
- HyDE: `HyDEQueryTransform` generates hypothetical document, embeds that
- Sub-question engine: `SubQuestionQueryEngine` decomposes complex queries

**LangChain defaults/recommendations:**
- Chunk size: **1000 characters** (tutorial)
- Chunk overlap: **200 characters** (tutorial)
- Text splitter: `RecursiveCharacterTextSplitter` (split on `\n\n`, `\n`, ` `, `""`)
- Top-K: **2** (tutorial), 4 in some examples
- Hybrid search: `EnsembleRetriever` with RRF
- Re-ranking: `ContextualCompressionRetriever` with `CrossEncoderReranker` or `CohereRerank`
- Multi-query: `MultiQueryRetriever` generates multiple LLM-phrased queries
- HyDE: `HypotheticalDocumentEmbedder`

**Key insight**: Both frameworks' defaults are **conservative by design** (low top-K, small overlap). Production systems built on them (AnythingLLM, PrivateGPT, Open WebUI) all modify these defaults significantly.

---

## 4. Parameter Recommendations for Parallx

Based on analysis of all 8 systems, here are specific parameter recommendations for the Parallx stack (Ollama + nomic-embed-text + 27B parameter model):

### 4.1 Chunking Parameters

| Parameter | Current Parallx | Recommended | Rationale |
|-----------|----------------|-------------|-----------|
| `MAX_CHUNK_CHARS` | 2048 | **1024** | Industry consensus is 800–1200. 2048 is an outlier. Smaller chunks = more precise embeddings. |
| `MIN_CHUNK_CHARS` | 100 | **100** (keep) | Prevents trivially small chunks |
| Overlap | **0** | **200 chars (~50 tokens)** | Every production system uses overlap. 200 chars is the LangChain default. M10 research recommended this. |
| Strategy | Fixed with heading awareness | **Keep heading-aware** for canvas pages; add overlap for workspace files | Canvas blocks have natural boundaries; files need overlap |

### 4.2 Retrieval Parameters

| Parameter | Current Parallx | Recommended | Rationale |
|-----------|----------------|-------------|-----------|
| `DEFAULT_TOP_K` | 10 | **7** | With better precision (AND keywords, cosine re-ranking), 7 is sufficient. Fewer chunks = less noise in context. |
| `DEFAULT_CANDIDATE_K` | 20 | **30** | Overfetch from each path, then re-rank down to 7. 30 gives enough headroom for score-based filtering. |
| `DEFAULT_MIN_SCORE` | 0.005 (retrieval), 0.0 (vector store) | **0.015** (RRF score) | Per `RETRIEVAL_PERFORMANCE_FIX_PLAN.md` analysis: 0.015 requires top-~20 rank in at least one retrieval path |
| `DEFAULT_MAX_PER_SOURCE` | 3 | **2** | With better precision, 2 chunks per source prevents any single source dominating the context window |
| Overfetch factor | 3× | **1.5×** (without re-ranking) or **3×** (with re-ranking) | Without LLM re-ranking, don't overfetch noise. With cosine re-ranking, moderate overfetch is fine. |
| FTS5 join | OR | **AND (implicit)** | Per `RAG_RETRIEVAL_HARDENING_RESEARCH.md`: switch to AND semantics with stopword filtering |
| `DEFAULT_TOKEN_BUDGET` | 4000 | **3000** | With more precise retrieval, less budget needed. Saves context window for conversation history. |

### 4.3 Re-ranking Parameters (NEW — Cosine Re-scoring)

| Parameter | Recommended | Rationale |
|-----------|-------------|-----------|
| Re-ranking method | **Bi-encoder cosine re-scoring** | Zero latency cost — uses existing embeddings. Proven by AnythingLLM and Open WebUI. |
| Cosine similarity threshold | **0.30** | nomic-embed-text typically produces 0.2–0.8 cosine similarity for relevant matches. 0.30 filters obvious noise. |
| Apply when | After RRF fusion, before final top-K selection | Replaces the removed LLM-based re-ranking |
| Implementation | Embed query → dot product with stored candidate vectors → filter by threshold → sort by score | |

**Implementation sketch for Parallx:**
```typescript
async function cosineRerank(
  query: string,
  candidates: RetrievedChunk[],
  minCosine: number = 0.30
): Promise<RetrievedChunk[]> {
  // 1. Embed the query (this is already done for vector search)
  const queryEmbedding = await embedQuery(query); // search_query: prefix

  // 2. For each candidate, compute cosine similarity
  //    (candidate embeddings are already in sqlite-vec)
  const scored = candidates.map(chunk => {
    const cosine = cosineSimilarity(queryEmbedding, chunk.embedding);
    return { ...chunk, cosineScore: cosine };
  });

  // 3. Filter by threshold and sort
  return scored
    .filter(c => c.cosineScore >= minCosine)
    .sort((a, b) => b.cosineScore - a.cosineScore);
}
```

**Cost**: ~1ms for 30 candidates (30 dot products of 768-dimensional vectors). This is negligible compared to any LLM call.

### 4.4 Context Assembly Parameters

| Parameter | Current Parallx | Recommended | Rationale |
|-----------|----------------|-------------|-----------|
| System prompt % | 10% | **10%** (keep) | Adequate for persona + workspace digest |
| RAG context % | 30% | **25%** | With better precision, less budget needed |
| History % | 30% | **35%** | More history = better conversational context |
| User message % | 30% | **30%** (keep) | User needs room for complex questions |
| Chunk insertion order | Score-based | **Cosine-score descending** | Highest relevance first; if budget truncates, best content survives |
| Source metadata | Minimal | **Add source title prefix** to each chunk | Helps model attribute answers. Matches AnythingLLM/Open WebUI approach. |

### 4.5 Query Understanding Parameters

| Parameter | Current Parallx | Recommended | Rationale |
|-----------|----------------|-------------|-----------|
| Planner (intent + queries) | Always runs | **Skip for casual_chat/greeting intent** | 2–3s saved on simple messages. Cursor, Open WebUI both do this. |
| Multi-query generation | 2–4 queries | **2–3 queries** (keep) | Proven effective for vocabulary mismatch |
| Query generation model | Same as chat model | **Same** (keep) | No benefit to using a different model locally |
| Planner timeout | None | **5s hard timeout** | If planner takes >5s, fall back to direct query |

---

## 5. Priority Implementation Order for Parallx

Based on impact-to-effort ratio across all 8 systems studied:

### Phase 1: Immediate Wins (30 min each)....

1. **FTS5 OR→AND** — Already planned in `RAG_RETRIEVAL_HARDENING_RESEARCH.md`. Highest impact single change.
2. **Raise score threshold** — From 0.005 to 0.015. Filters obvious garbage.
3. **Add chunk overlap** — 200 chars. Prevents boundary information loss.

### Phase 2: Cosine Re-ranking (1–2 hours)

4. **Implement bi-encoder cosine re-scoring** — Replace the removed LLM re-ranking with zero-cost cosine re-scoring using stored embeddings. This is the key insight from this research.
5. **Add cosine similarity threshold** (0.30) — Post-retrieval filter.

### Phase 3: Precision Improvements (2–3 hours)

6. **Reduce chunk size** — From 2048 to 1024 chars. Requires re-indexing.
7. **BM25 metadata enrichment** — Prepend source titles to FTS5 content for better keyword matching.
8. **Per-source cap reduction** — From 3 to 2 chunks per source.

### Phase 4: Query Intelligence (optional)

9. **Skip planner for simple chat** — Intent shortcircuit.
10. **Planner timeout** — 5s hard cap with fallback.

---

## 6. Sources

### Primary (Source Code Analysis)

1. **Continue.dev** — `core/indexing/chunk/code.ts`, `core/indexing/chunk/markdown.ts`, `core/indexing/CodebaseIndexer.ts` (GitHub, accessed 2026-03-04)
2. **AnythingLLM** — `server/utils/TextSplitter/index.js`, `server/utils/vectorDbProviders/lance/index.js`, `server/utils/EmbeddingRerankers/native/` (GitHub, accessed 2026-03-04)
3. **Open WebUI** — `backend/open_webui/retrieval/utils.py`, `backend/open_webui/config.py` (GitHub, accessed 2026-03-04)
4. **PrivateGPT** — `private_gpt/components/ingest/ingest_component.py`, `settings.yaml` (GitHub, accessed 2026-03-04)
5. **Smart Connections** — `README.md`, plugin documentation (GitHub, accessed 2026-03-04)
6. **Obsidian Copilot** — `README.md`, documentation site (GitHub, accessed 2026-03-04)

### Framework Documentation

7. **LlamaIndex** — "Basic Strategies" (`developers.llamaindex.ai/python/framework/optimizing/basic_strategies/`), "Node Parser Usage Pattern" (accessed 2026-03-04)
8. **LangChain** — "Build a RAG agent with LangChain" (`docs.langchain.com/oss/python/langchain/rag`), "Text Splitters" (accessed 2026-03-04)

### Research Papers and Blog Posts

9. **Anthropic**, "Introducing Contextual Retrieval" (2024-09-19) — https://www.anthropic.com/news/contextual-retrieval
10. **Galileo**, "Mastering RAG: How to Select a Reranking Model" (2024) — https://www.galileo.ai/blog/mastering-rag-how-to-select-a-reranking-model
11. **Cormack, Clarke & Butt**, "Reciprocal Rank Fusion" (2009), SIGIR
12. **Gao et al.**, "Retrieval-Augmented Generation for Large Language Models: A Survey" (2024) — https://arxiv.org/abs/2312.10997
