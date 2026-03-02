# Milestone 10: RAG-Powered AI Assistant Architecture

## Research Document — March 2, 2026

---

## Table of Contents

1. [Vision](#vision)
2. [Current State Audit](#current-state-audit)
3. [Research: RAG Architectures](#research-rag-architectures)
4. [Research: AI Assistant Systems](#research-ai-assistant-systems)
5. [Research: Embedding Models & Vector Storage](#research-embedding-models--vector-storage)
6. [Research: Chunking Strategies](#research-chunking-strategies)
7. [Research: Existing Tools & Implementations](#research-existing-tools--implementations)
8. [Capabilities Matrix](#capabilities-matrix)
9. [Architecture Design](#architecture-design)
10. [Actionable Tasks](#actionable-tasks)
11. [Sources & References](#sources--references)

---

## Vision

The AI in Parallx is not a feature — it IS the product's intelligence layer. Like Jarvis in Iron Man, the AI should:

- **Know everything** in the workspace without being told where to look
- **Act autonomously** — create, organize, summarize, tag, format without hand-holding
- **Learn context** — understand relationships between pages, files, projects, and ideas
- **Be proactive** — surface relevant information before the user asks
- **Scale infinitely** — work with 10 pages or 10,000 pages, 5 files or 5,000 files
- **Be tool-agnostic** — access data from canvas pages, filesystem files, databases, APIs, and any future tool
- **Remember** — maintain context across sessions, learn user preferences, build a knowledge graph

The user should be able to "brain dump" into chat and have the AI create pages, format content, cross-reference existing knowledge, tag appropriately, and produce structured output — all without the user specifying which tools to use or where to look.

**The AI is the interface to the user's second brain. The workspace is the brain. RAG is the neural pathways.**

---

## Current State Audit

### What Exists Today (Milestone 9)

#### Chat Infrastructure
| Component | File | Status |
|-----------|------|--------|
| Chat widget (input, messages, sessions) | `src/built-in/chat/chatWidget.ts` | ✅ Working |
| Three modes: Ask, Edit, Agent | `src/built-in/chat/chatModeCapabilities.ts` | ✅ Working |
| Session persistence (SQLite) | `src/services/chatService.ts` | ✅ Working |
| Streaming responses (NDJSON) | `src/built-in/chat/providers/ollamaProvider.ts` | ✅ Working |
| Model picker (Ollama models) | `src/built-in/chat/chatModelPicker.ts` | ✅ Working |
| Tool picker (enable/disable) | `src/built-in/chat/chatToolPicker.ts` | ✅ Working |
| Context attachments (files, pages) | `src/built-in/chat/chatContextAttachments.ts` | ✅ Working |

#### Tool System
| Tool | Type | Description |
|------|------|-------------|
| `search_workspace` | Read | Text search across pages and blocks |
| `read_page` | Read | Read page by UUID or title (3-level fallback) |
| `read_page_by_title` | Read | Case-insensitive + fuzzy title lookup |
| `read_current_page` | Read | Read the currently open page |
| `list_pages` | Read | List all pages with titles and IDs |
| `get_page_properties` | Read | Get page metadata and database properties |
| `list_files` | Read | List files/directories at a path |
| `read_file` | Read | Read text content of a workspace file |
| `search_files` | Read | Find files matching a name pattern |
| `create_page` | Write | Create a new page (Agent mode only) |

#### Context Injection
| Mechanism | Description | Limitation |
|-----------|-------------|------------|
| System prompt page list | All page titles listed in system prompt | No content, just names. Doesn't scale past ~200 pages |
| System prompt file list | Root-level file/folder names | Only root level, no content, no subdirectories |
| Implicit context | Active page content auto-injected | Only 1 page — the currently open one |
| Attachments | User manually attaches files/pages | Requires user to know what to attach |
| Tool calls | Model calls read_page, read_file etc. | Requires model to know what to look for |

#### Data Sources
| Source | Storage | Access Method |
|--------|---------|---------------|
| Canvas pages | SQLite `pages` table (TipTap JSON) | `databaseService` |
| Canvas blocks | Nested in page content JSON | `extractTextContent()` |
| Workspace files | Filesystem | `fileService` |
| Page properties | SQLite `page_property_values` table | `databaseService` |
| Database schemas | SQLite `database_properties` table | `databaseService` |
| Chat sessions | SQLite `chat_sessions` / `chat_messages` | `chatService` |

### Critical Gaps

1. **No semantic search** — `search_workspace` does keyword matching only. "What do I know about authentication?" won't find a page about "JWT token flow" unless it literally contains the word "authentication"
2. **No cross-referencing** — The AI doesn't know that page A references concepts in page B
3. **No automatic context** — Every query starts from zero. The AI must be explicitly told what to read
4. **No memory** — Conversation history is stored but never used to inform future sessions
5. **No file content indexing** — Only page titles and root file names are in the system prompt. File contents are invisible unless explicitly read via tool call
6. **Token waste** — Listing all page titles in every system prompt wastes tokens and doesn't scale
7. **No binary file support** — PDFs, images, Word docs, Excel files are completely invisible
8. **No relationship awareness** — The AI doesn't understand workspace structure, project groupings, or conceptual connections

---

## Research: RAG Architectures

### What is RAG?

Retrieval-Augmented Generation (RAG) separates knowledge from reasoning:
- **Without RAG**: The LLM must either have knowledge in its training data or be given it explicitly in the prompt
- **With RAG**: A retrieval system finds relevant knowledge from a corpus and injects it into the prompt automatically

**Paper**: Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" (2020)
- https://arxiv.org/abs/2005.11401
- Key insight: "RAG models combine the best of both worlds — the parametric memory of a pre-trained model with the non-parametric memory of a retrieval index"

### RAG Pipeline

```
User Query
    ↓
[1. Query Understanding]
    - Rephrase for retrieval
    - Extract key concepts
    - Determine intent (question, action, brainstorm)
    ↓
[2. Retrieval]
    - Embed query → vector
    - Search vector index → top-K chunks
    - Optionally: hybrid search (vector + keyword)
    - Optionally: re-rank results
    ↓
[3. Context Assembly]
    - Deduplicate chunks
    - Order by relevance
    - Trim to token budget
    - Add source attribution metadata
    ↓
[4. Generation]
    - System prompt + retrieved context + user query → LLM
    - LLM generates answer grounded in retrieved content
    ↓
[5. Post-processing]
    - Cite sources
    - Trigger actions (create page, update content)
    - Update memory/conversation summary
```

### Advanced RAG Patterns

#### Naive RAG vs Advanced RAG vs Modular RAG

**Research**: Gao et al., "Retrieval-Augmented Generation for Large Language Models: A Survey" (2024)
- https://arxiv.org/abs/2312.10997

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Naive RAG** | Embed → Retrieve → Generate | Simple Q&A |
| **Advanced RAG** | Pre-retrieval query rewriting + post-retrieval re-ranking | Better accuracy |
| **Modular RAG** | Pluggable modules: routing, query expansion, iterative retrieval | Complex multi-step reasoning |

For Parallx, we need **Advanced RAG** minimum with a path to **Modular RAG** as the workspace grows.

#### Hybrid Search

Combining vector (semantic) search with keyword (BM25/TF-IDF) search:
- Vector search finds semantically similar content ("authentication" ↔ "JWT tokens")
- Keyword search finds exact matches ("function calculateTax")
- Hybrid combines both with reciprocal rank fusion (RRF)

**Research**: Microsoft's analysis shows hybrid search outperforms either alone by 5-15%
- https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview

#### Contextual Retrieval (Anthropic)

**Research**: Anthropic, "Introducing Contextual Retrieval" (2024)
- https://www.anthropic.com/news/contextual-retrieval
- Key insight: Standard chunking loses context. Prepending a short context summary to each chunk before embedding dramatically improves retrieval accuracy (49% reduction in failed retrievals)
- Example: Instead of embedding "The function returns a JWT token", embed "From the Silas authentication module documentation: The function returns a JWT token"

This is directly applicable to Parallx — each chunk should carry its page title, section header, and block type as contextual prefix.

#### Agentic RAG

**Research**: LlamaIndex's Agentic RAG pattern
- https://www.llamaindex.ai/blog/agentic-rag-with-llamaindex
- The retrieval system is itself an agent that can:
  - Decide whether to retrieve or answer from existing context
  - Route queries to different indexes (pages vs files vs code)
  - Perform multi-step retrieval (retrieve → reason → retrieve more)
  - Use tools alongside retrieval

This maps perfectly to Parallx's existing tool system — RAG becomes another tool the agent can use, alongside direct page/file access.

---

## Research: AI Assistant Systems

### Jarvis / FRIDAY (Conceptual Model)

The Jarvis model from Iron Man establishes the gold standard for AI assistants:
- **Always on** — doesn't need to be invoked, anticipates needs
- **Full system access** — controls everything: files, tools, environment
- **Contextual awareness** — knows what you're working on, what you did yesterday, and what you're trying to achieve
- **Natural conversation** — understands intent, not just commands
- **Autonomous execution** — "Jarvis, prepare the Mark 42" doesn't require step-by-step instructions

### GitHub Copilot Workspace (VS Code)

**Source**: VS Code repository — https://github.com/microsoft/vscode
**DeepWiki**: https://deepwiki.com/microsoft/vscode

Key architectural decisions:
1. **Implicit context via variables** (`#editor`, `#selection`, `#file`, `#codebase`)
   - `#editor` — automatically includes visible editor content
   - `#codebase` — triggers workspace-wide semantic search (embeddings-based)
   - Context is resolved BEFORE the LLM call, not via tool calls

2. **Workspace indexing**
   - VS Code indexes the entire workspace on open
   - Uses embeddings for semantic code search
   - Maintains a file dependency graph
   - Re-indexes on file save (incremental)

3. **Participant architecture**
   - `@workspace` participant handles codebase-wide questions via embeddings search
   - `@terminal`, `@vscode` handle domain-specific questions
   - Each participant has its own retrieval strategy

4. **Tool vs Context distinction**
   - **Context**: Information gathered BEFORE the LLM call (RAG retrieval, implicit context)
   - **Tools**: Actions the LLM can take DURING generation (read file, run command)
   - This separation is critical — context doesn't require model cooperation, tools do

### Cursor

**Source**: https://www.cursor.com/
**Architecture**: https://forum.cursor.com/t/how-does-cursor-understand-codebase/

Key innovations:
1. **Codebase indexing** — On project open, Cursor indexes all files using embeddings
2. **Retrieval on every query** — Every chat message triggers semantic search, no user action needed
3. **@codebase** — Explicit tag for "search everything", but basic queries also get retrieval
4. **Chunking by function/class** — Code is chunked at semantic boundaries, not fixed sizes
5. **Re-ranking** — Initial retrieval returns ~50 chunks, a re-ranker selects top 10

### Notion AI

**Source**: https://www.notion.so/product/ai
**Architecture insights**: https://www.notion.so/blog/how-notion-ai-works

Relevant because Notion is the closest product to Parallx (workspace + pages):
1. **Q&A over workspace** — "What do we know about X?" searches all pages
2. **Page-level AI** — Summarize, translate, explain within a page
3. **Embeddings-based search** — Semantic search across all workspace content
4. **Chunking strategy** — Block-level chunking (each Notion block = 1 chunk), with page title as context prefix
5. **Permissions-aware retrieval** — Only retrieves content the user has access to

### Obsidian + Smart Connections Plugin

**Source**: https://github.com/brianpetro/obsidian-smart-connections

Most relevant open-source reference for a local-first RAG knowledge base:
1. **Local embeddings** — Uses Ollama or local models for embeddings
2. **Note-level and block-level indexing** — Each note and each section header block indexed separately
3. **Cosine similarity search** — Simple but effective for <100K chunks
4. **"Smart Chat"** — Q&A that retrieves relevant notes automatically
5. **Connection visualization** — Shows which notes are semantically related

### Mem.ai

**Source**: https://mem.ai/
**Key innovation**: Self-organizing knowledge base
1. **Automatic tagging and categorization** — AI tags content on save
2. **Smart search** — Semantic search that understands intent
3. **Related memories** — Shows related content when viewing a note
4. **AI-generated summaries** — Automatic summaries of collections of notes

---

## Research: Embedding Models & Vector Storage

### Embedding Models (Local, Ollama-compatible)

| Model | Dimensions | Size | Performance | Speed | Source |
|-------|-----------|------|-------------|-------|--------|
| `nomic-embed-text` | 768 | 274MB | Excellent for general text | ~500 chunks/sec | https://ollama.com/library/nomic-embed-text |
| `all-minilm` | 384 | 46MB | Good for short text | ~1000 chunks/sec | https://ollama.com/library/all-minilm |
| `mxbai-embed-large` | 1024 | 669MB | State-of-the-art | ~300 chunks/sec | https://ollama.com/library/mxbai-embed-large |
| `snowflake-arctic-embed` | 1024 | 669MB | Excellent retrieval | ~300 chunks/sec | https://ollama.com/library/snowflake-arctic-embed |
| `bge-m3` | 1024 | 1.2GB | Multilingual, hybrid | ~200 chunks/sec | https://ollama.com/library/bge-m3 |

**Recommendation**: `nomic-embed-text` v1.5 — best balance of quality, size, and speed. 274MB is negligible alongside a 32B chat model. 768 dimensions provide good semantic resolution. Created by Nomic AI specifically for RAG applications. **True context window is 8192 tokens** (Ollama defaults to 2048 but this is configurable). **Requires task prefixes** (e.g., `search_document: ` for indexing, `search_query: ` for querying) — see DR-2 in Deep Research section for complete details.

**Source**: MTEB Leaderboard — https://huggingface.co/spaces/mteb/leaderboard

### Vector Storage Options

| Option | Type | Pros | Cons | Source |
|--------|------|------|------|--------|
| **SQLite + manual cosine** | In-process | Zero dependencies, already have SQLite | O(n) search, slow past 50K chunks | Built-in |
| **sqlite-vec** | SQLite extension | Native ANN index, in-process, fast | Native binary dependency per platform | https://github.com/asg017/sqlite-vec |
| **hnswlib-node** | Node.js library | Fast ANN (HNSW), pure JS fallback | Separate from SQLite, memory-only | https://github.com/nmslib/hnswlib |
| **Vectra** | File-based | Designed for local AI apps, JSON storage | Small scale only | https://github.com/Stevenic/vectra |
| **LanceDB** | Embedded | Columnar, fast, serverless | Larger dependency | https://github.com/lancedb/lancedb |
| **Chroma** | Client/Server | Feature-rich, Python ecosystem | Requires separate server process | https://github.com/chroma-core/chroma |

**Recommendation**: **sqlite-vec** — it's a SQLite extension (loads into our existing SQLite connection), provides real ANN (approximate nearest neighbor) indexing, handles millions of vectors, and keeps everything in a single database file. Alex Garcia (author) maintains it actively.

**Fallback**: Start with manual cosine similarity in SQLite (zero dependencies), migrate to sqlite-vec when we need scale.

**Source**: sqlite-vec benchmarks — https://github.com/asg017/sqlite-vec#benchmarks

### Vector Search: Cosine Similarity in SQLite

For MVP, we can compute cosine similarity in pure SQL:

```sql
-- Store vectors as JSON arrays in a TEXT column
CREATE TABLE embeddings (
    id TEXT PRIMARY KEY,
    source_type TEXT,      -- 'page', 'file', 'block'
    source_id TEXT,        -- page UUID or file path
    chunk_index INTEGER,
    chunk_text TEXT,
    context_prefix TEXT,   -- page title, section header
    embedding TEXT,        -- JSON array of floats [0.1, -0.3, ...]
    updated_at INTEGER
);

-- Search with cosine similarity (computed in application layer)
-- Retrieve all embeddings, compute dot products in JS
-- Or use sqlite-vec for native vector operations
```

---

## Research: Chunking Strategies

### Block-Level Chunking (Canvas Pages)

Canvas pages use TipTap JSON with a block structure. Each block is a natural semantic unit:

```json
{
  "type": "doc",
  "content": [
    { "type": "heading", "content": [{ "text": "Authentication Design" }] },
    { "type": "paragraph", "content": [{ "text": "We use JWT tokens with..." }] },
    { "type": "bulletList", "content": [...] },
    { "type": "codeBlock", "content": [{ "text": "function verify()..." }] }
  ]
}
```

**Strategy**: Each top-level block becomes a chunk, with contextual prefix:
- `"[Page: Authentication Design] [Section: Overview] We use JWT tokens with..."`
- This follows Anthropic's Contextual Retrieval research

### File-Level Chunking (Workspace Files)

| File Type | Chunking Strategy |
|-----------|-------------------|
| `.md` | Split by heading sections |
| `.ts/.js` | Split by function/class/export (AST-aware) |
| `.json` | Split by top-level keys |
| `.txt` | Split by paragraph (double newline) |
| Binary (PDF, DOCX, XLSX) | Convert via MarkItDown → then split by section |

### Chunk Size Guidelines

**Research**: LlamaIndex chunking analysis
- https://www.llamaindex.ai/blog/evaluating-the-ideal-chunk-size-for-a-rag-system

| Chunk Size | Retrieval Accuracy | Generation Quality |
|------------|-------------------|-------------------|
| 128 tokens | High precision, low recall | Missing context |
| 256 tokens | Good balance | Good |
| 512 tokens | Best overall | Best overall |
| 1024 tokens | Lower precision | Too much noise |

**Recommendation**: Target 256-512 tokens per chunk. For canvas blocks, use natural block boundaries. For files, use semantic boundaries (headings, functions) with a 512-token maximum.

### Overlap Strategy

Adjacent chunks should overlap by ~50 tokens to preserve context across boundaries:
- Chunk 1: tokens 0-512
- Chunk 2: tokens 462-974
- This prevents information loss at chunk boundaries

---

## Research: Existing Tools & Implementations

### Microsoft MarkItDown

**Source**: https://github.com/microsoft/markitdown
**Purpose**: Convert any document format to Markdown for AI consumption

Supported formats:
- PDF (text extraction + OCR)
- Microsoft Word (.docx)
- Microsoft Excel (.xlsx)
- Microsoft PowerPoint (.pptx)
- Images (OCR via tesseract or LLM vision)
- HTML
- Audio (speech-to-text via Whisper)
- CSV, JSON, XML

**Integration approach**: Run as a Python subprocess or use the Node.js port. Convert binary files to Markdown during indexing, then chunk the Markdown for embedding.

**Node.js alternative**: `mammoth` (DOCX), `pdf-parse` (PDF), `xlsx` (Excel) — individual libraries, more control, no Python dependency.

### Ollama Embeddings API

**Source**: https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings

**Primary endpoint** (use exclusively): `POST /api/embed`
```bash
POST http://localhost:11434/api/embed
{
  "model": "nomic-embed-text",
  "input": "search_document: The quick brown fox"
}
# Response: { "model": "...", "embeddings": [[0.1, -0.3, ...]], "total_duration": 123 }
```

Batch mode (3-5x faster, critical for initial indexing):
```bash
POST http://localhost:11434/api/embed
{
  "model": "nomic-embed-text",
  "input": ["search_document: text 1", "search_document: text 2", "search_document: text 3"]
}
# Response: { "embeddings": [[...], [...], [...]] }
```

> **Note**: The legacy `POST /api/embeddings` endpoint (singular, returns `{embedding: [...]}`) is **deprecated**. Always use `/api/embed` (plural, returns `{embeddings: [[...]]}`).

> **Note**: Task prefixes (`search_document:` / `search_query:`) are mandatory for nomic-embed-text. See DR-2 for details.

### Langchain.js RAG Components

**Source**: https://js.langchain.com/docs/tutorials/rag
**Useful modules** (can use individually without full framework):
- `RecursiveCharacterTextSplitter` — smart chunking with overlap
- `OllamaEmbeddings` — Ollama embedding wrapper
- `MemoryVectorStore` — in-memory vector store (good for testing)
- `Document` — standard document format with metadata

We don't need to adopt LangChain as a framework, but individual components are well-tested and save implementation time.

### Obsidian Smart Connections (Architecture Reference)

**Source**: https://github.com/brianpetro/obsidian-smart-connections

Architecture walkthrough:
1. On vault open → scan all `.md` files
2. For each file → split into sections (by heading)
3. For each section → generate embedding via local model
4. Store embeddings in `.smart-connections/` folder (JSON files)
5. On query → embed query → cosine similarity → top 20 results
6. Feed top results as context to LLM

**Key learning**: They re-index only changed files (compare `mtime`), making re-indexing fast.

---

## Capabilities Matrix

### Current vs RAG-Powered

| Capability | Current | With RAG | Priority |
|------------|---------|----------|----------|
| Answer questions about a specific page | ⚠️ Requires tool call chain | ✅ Auto-retrieved | P0 |
| Answer questions about workspace-wide topics | ❌ Must know which page to read | ✅ Semantic retrieval | P0 |
| Find related content across pages | ❌ No semantic understanding | ✅ Vector similarity | P0 |
| Understand workspace files (code, docs) | ⚠️ Must call read_file explicitly | ✅ Indexed and retrievable | P0 |
| Read PDFs, Word docs, Excel files | ❌ Not supported | ✅ Via MarkItDown conversion | P1 |
| Remember past conversations | ❌ Each session starts fresh | ✅ Conversation memory index | P1 |
| Auto-tag and categorize new content | ❌ Not implemented | ✅ On-save AI processing | P2 |
| Surface related notes while editing | ❌ Not implemented | ✅ Real-time similarity search | P2 |
| Understand images and diagrams | ❌ Not supported | ✅ Vision model + OCR indexing | P3 |
| Proactive suggestions | ❌ Not implemented | ✅ Context-aware prompts | P3 |

### Tool Awareness

The AI assistant must be aware of:

| System | Awareness Level | Current | With RAG |
|--------|----------------|---------|----------|
| Its own tools (read, write, search) | Full knowledge of capabilities | ⚠️ Listed in prompt | ✅ Dynamic tool registry |
| Canvas pages (all content) | Semantic understanding | ❌ Title list only | ✅ Full content indexed |
| Workspace files (all content) | Semantic understanding | ❌ Root names only | ✅ Full content indexed |
| Database schemas and properties | Structural understanding | ⚠️ Via tool call | ✅ Schema indexed |
| User preferences and patterns | Learned over time | ❌ None | ✅ Preference memory |
| Parallx features and capabilities | Self-awareness | ❌ None | ✅ App docs indexed |
| Current user activity | What user is doing now | ⚠️ Active page only | ✅ Activity context |

---

## Architecture Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERACTION                         │
│  Chat Panel  │  Inline AI (future)  │  Slash Commands (future)  │
└──────┬───────┴──────────┬───────────┴──────────┬────────────────┘
       │                  │                      │
       ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AI ORCHESTRATION LAYER                       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Query Router  │  │ Context      │  │ Response Pipeline     │  │
│  │              │  │ Assembler    │  │ (stream, cite, act)   │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                 │                      │               │
│         ▼                 ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   RETRIEVAL ENGINE                          ││
│  │  ┌────────────┐  ┌─────────────┐  ┌──────────────────────┐││
│  │  │ Vector     │  │ Keyword     │  │ Hybrid Ranker (RRF)  │││
│  │  │ Search     │  │ Search      │  │                      │││
│  │  └─────┬──────┘  └──────┬──────┘  └──────────┬───────────┘││
│  │        └────────────────┴────────────────────┘            ││
│  └────────────────────────────┬────────────────────────────────┘│
│                               │                                  │
└───────────────────────────────┼──────────────────────────────────┘
                                │
       ┌────────────────────────┼─────────────────────────┐
       ▼                        ▼                         ▼
┌──────────────┐  ┌───────────────────────┐  ┌────────────────────┐
│ VECTOR INDEX │  │   INDEXING PIPELINE   │  │   TOOL SYSTEM      │
│              │  │                       │  │                    │
│ SQLite +     │  │ ┌───────────────────┐ │  │ read_page          │
│ sqlite-vec   │  │ │ Content Watchers  │ │  │ create_page        │
│ (embeddings) │  │ │ (save, change)    │ │  │ edit_block         │
│              │  │ └────────┬──────────┘ │  │ read_file          │
│ Chunks:      │  │          ▼            │  │ search_files       │
│ - pages      │  │ ┌───────────────────┐ │  │ ... (extensible)   │
│ - blocks     │  │ │ Chunking Engine   │ │  │                    │
│ - files      │  │ │ (block, semantic) │ │  │                    │
│ - docs       │  │ └────────┬──────────┘ │  │                    │
│ - memory     │  │          ▼            │  │                    │
│              │  │ ┌───────────────────┐ │  │                    │
│              │  │ │ Embedding Engine  │ │  │                    │
│              │  │ │ (Ollama API)      │ │  │                    │
│              │  │ └───────────────────┘ │  │                    │
└──────────────┘  └───────────────────────┘  └────────────────────┘
       ▲                    ▲                         ▲
       │                    │                         │
       └────────────────────┼─────────────────────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────────┐
        │ Canvas   │  │ File     │  │ Binary Files │
        │ Pages    │  │ System   │  │ (via         │
        │ (SQLite) │  │          │  │  MarkItDown) │
        └──────────┘  └──────────┘  └──────────────┘
```

### Service Architecture

```typescript
// New services to implement
interface IEmbeddingService {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    getModelInfo(): { name: string; dimensions: number };
}

interface IChunkingService {
    chunkPage(pageId: string, content: TipTapJSON): Chunk[];
    chunkFile(filePath: string, content: string, language?: string): Chunk[];
    chunkMarkdown(source: string, markdown: string): Chunk[];
}

interface IVectorIndex {
    upsert(chunks: EmbeddedChunk[]): Promise<void>;
    search(queryEmbedding: number[], topK: number): Promise<SearchResult[]>;
    delete(sourceId: string): Promise<void>;
    getStats(): { totalChunks: number; sources: Record<string, number> };
}

interface IIndexingPipeline {
    indexPage(pageId: string): Promise<void>;
    indexFile(filePath: string): Promise<void>;
    indexWorkspace(): Promise<void>;  // Full re-index
    onContentChanged(source: string, id: string): void;  // Incremental
}

interface IRetrievalService {
    retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedContext[]>;
    // options: { topK, sourceFilter, minScore, includeMetadata }
}

interface IMemoryService {
    summarizeConversation(sessionId: string): Promise<string>;
    getRelevantMemories(query: string): Promise<Memory[]>;
    storeMemory(key: string, value: string, type: MemoryType): Promise<void>;
}
```

### Data Flow: User Asks a Question

```
1. User types: "What authentication approach did I decide on?"

2. Query Router:
   - Detects: knowledge question (not action request)
   - Strategy: RAG retrieval + current page context

3. Retrieval Engine:
   a. Embed query → [0.12, -0.45, 0.78, ...] (768 dims)
   b. Vector search → top 10 chunks:
      - [0.94] "Page: Backend Architecture > Auth: We chose JWT with refresh tokens..."
      - [0.89] "Page: Security Notes > Token Flow: Access tokens expire in 15min..."
      - [0.85] "File: src/auth/middleware.ts > function verifyToken()..."
      - ...
   c. Keyword search → "authentication" matches in 3 more chunks
   d. Hybrid merge (RRF) → top 5 final chunks

4. Context Assembly:
   System prompt: You are the Parallx AI assistant...
   Retrieved context:
   ---
   [Source: Backend Architecture, Section: Auth]
   We chose JWT with refresh tokens. Access tokens expire in 15min...
   ---
   [Source: Security Notes, Section: Token Flow]
   Token flow: client → /auth/login → JWT + refresh cookie...
   ---
   [Source: src/auth/middleware.ts]
   function verifyToken(req, res, next) { ... }
   ---
   User: What authentication approach did I decide on?

5. LLM generates grounded answer with citations

6. Response: "Based on your notes in 'Backend Architecture' and 'Security Notes',
   you decided on JWT with refresh tokens. Access tokens expire in 15 minutes,
   with refresh tokens stored as HTTP-only cookies. Your implementation in
   src/auth/middleware.ts verifies tokens using..."
```

---

## Actionable Tasks

### Phase 1: Embedding & Vector Foundation (P0)

#### Task 1.1: Embedding Service ✅
- **What**: Create `IEmbeddingService` that calls Ollama's `/api/embed` endpoint
- **File**: `src/services/embeddingService.ts`
- **Status**: Done — commit `fb020da`
- **Details**:
  - Batch embedding via `/api/embed` (not individual `/api/embeddings`)
  - Auto-pull `nomic-embed-text` if not installed
  - Rate limiting to avoid overwhelming Ollama
  - Caching layer (don't re-embed unchanged content)
- **Reference**: Ollama API docs — https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings
- **Estimate**: 1 session

#### Task 1.2: Vector Storage (SQLite) ✅
- **What**: Create vec0 + FTS5 tables and `IVectorStoreService`
- **File**: `src/services/vectorStoreService.ts`
- **Status**: Done — commit `fb020da` (used sqlite-vec vec0 with cosine distance, FTS5 for BM25, RRF fusion)
- **Details**:
  - Start with pure SQLite (JSON arrays for vectors, cosine similarity in JS)
  - Migration path to sqlite-vec annotated in code
  - Schema:
    ```sql
    CREATE TABLE embeddings (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,    -- 'page_block', 'file_chunk', 'memory'
        source_id TEXT NOT NULL,      -- page UUID or file path
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        context_prefix TEXT,          -- "[Page: Title] [Section: Heading]"
        embedding BLOB NOT NULL,      -- Float32Array as binary
        content_hash TEXT NOT NULL,   -- For change detection
        updated_at INTEGER NOT NULL,
        UNIQUE(source_id, chunk_index)
    );
    CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);
    ```
  - Store vectors as BLOB (Float32Array) not JSON — 3x smaller, faster to read
- **Reference**: sqlite-vec — https://github.com/asg017/sqlite-vec
- **Estimate**: 1 session

#### Task 1.3: Chunking Service ✅
- **What**: Create `IChunkingService` for pages and files
- **File**: `src/services/chunkingService.ts`
- **Status**: Done — commit `fb020da`
- **Details**:
  - Canvas pages: chunk by TipTap block, with contextual prefix (page title + nearest heading)
  - Text files: chunk by paragraph/section, 256-512 token target, 50-token overlap
  - Code files: chunk by function/class if possible, fallback to line-based
  - Each chunk gets metadata: `{ sourceType, sourceId, chunkIndex, contextPrefix, tokenCount }`
- **Reference**: Anthropic Contextual Retrieval — https://www.anthropic.com/news/contextual-retrieval
- **Estimate**: 1 session

### Phase 2: Indexing Pipeline (P0)

#### Task 2.1: Page Indexing
- **What**: Index all canvas pages on workspace open, re-index on save
- **File**: `src/services/indexingPipeline.ts`
- **Details**:
  - On workspace open: query all pages, chunk, embed, store
  - On page save: compare content hash, re-index only if changed
  - Debounce indexing (don't re-index on every keystroke — batch after 5s of inactivity)
  - Progress reporting (for status bar: "Indexing: 45/120 pages")
  - Use Ollama batch endpoint for initial indexing speed
- **Depends on**: Task 1.1, 1.2, 1.3
- **Estimate**: 1 session

#### Task 2.2: File Indexing
- **What**: Index workspace text files
- **File**: `src/services/indexingPipeline.ts` (extend)
- **Details**:
  - Walk workspace directory tree recursively
  - Filter by supported extensions (`.md`, `.txt`, `.ts`, `.js`, `.json`, `.py`, `.css`, `.html`, etc.)
  - Respect `.gitignore` and `.parallxignore` patterns
  - Watch for file changes via filesystem watcher (already exists in `fileService`)
  - Content hash comparison for incremental re-indexing
- **Depends on**: Task 2.1
- **Estimate**: 1 session

#### Task 2.3: Binary File Support (MarkItDown)
- **What**: Index PDFs, DOCX, XLSX via MarkItDown conversion
- **File**: `src/services/markItDownService.ts`
- **Details**:
  - Option A: Shell out to Python `markitdown` CLI
  - Option B: Use Node.js libraries (`pdf-parse`, `mammoth`, `xlsx`)
  - Convert to Markdown → chunk → embed
  - Cache converted Markdown to avoid re-conversion
- **Reference**: https://github.com/microsoft/markitdown
- **Depends on**: Task 2.2
- **Estimate**: 1 session

### Phase 3: Retrieval Integration (P0)

#### Task 3.1: Retrieval Service
- **What**: Query-time retrieval that finds relevant chunks
- **File**: `src/services/retrievalService.ts`
- **Details**:
  - Embed user query
  - Vector similarity search (top 20 candidates)
  - Keyword search as supplement (existing `search_workspace`)
  - Reciprocal Rank Fusion to merge results
  - Score threshold filtering (drop chunks below 0.5 similarity)
  - Token budget management (don't exceed 4000 tokens of context)
  - Source deduplication (don't return 5 chunks from the same page)
- **Depends on**: Task 1.1, 1.2
- **Estimate**: 1 session

#### Task 3.2: Integrate RAG into Default Participant
- **What**: Replace brute-force context injection with RAG retrieval
- **File**: `src/built-in/chat/participants/defaultParticipant.ts`
- **Details**:
  - Before every LLM call: embed user message → retrieve top-K chunks → inject as context
  - Remove the "list all page titles in system prompt" approach
  - Keep implicit context for active page (user expects this)
  - Format retrieved context with source attribution:
    ```
    [Retrieved Context]
    ---
    Source: Backend Architecture > Authentication
    We chose JWT with refresh tokens...
    ---
    Source: src/auth/middleware.ts (lines 15-42)
    function verifyToken() { ... }
    ---
    ```
  - Update system prompt to explain the AI has retrieved relevant context
- **Depends on**: Task 3.1
- **Estimate**: 1 session

#### Task 3.3: RAG as a Tool (Agentic RAG)
- **What**: Add `search_knowledge` tool so the model can explicitly search when needed
- **File**: `src/built-in/chat/tools/builtInTools.ts`
- **Details**:
  - New tool: `search_knowledge(query: string, sourceFilter?: string)` → semantic search
  - This complements automatic retrieval — the model can search for additional context mid-conversation
  - Different from `search_workspace` (keyword) — this is semantic
- **Depends on**: Task 3.1
- **Estimate**: 0.5 session

### Phase 4: System Prompt & Behavior Overhaul (P0)

#### Task 4.1: Dynamic System Prompt
- **What**: System prompt adapts based on available context and workspace state
- **File**: `src/built-in/chat/chatSystemPrompts.ts`
- **Details**:
  - Remove static page/file listings
  - Add retrieved context section
  - Add workspace statistics (number of pages, files, last indexed)
  - Add current user activity context (active page, recent pages visited)
  - Keep total system prompt under 2000 tokens (context goes in user message)
- **Depends on**: Task 3.2
- **Estimate**: 0.5 session

#### Task 4.2: AI Self-Awareness
- **What**: The AI knows what Parallx is, what it can do, and what tools are available
- **File**: `src/built-in/chat/chatSystemPrompts.ts`
- **Details**:
  - Index Parallx's own documentation/README as part of the knowledge base
  - System prompt includes: "You are the AI assistant for Parallx, a local-first knowledge workspace. You have access to the following tools: [dynamic list]. The workspace contains [N] pages and [N] files."
  - The AI should be able to explain Parallx features, suggest workflows, and guide users
- **Depends on**: Task 4.1
- **Estimate**: 0.5 session

### Phase 5: Memory & Cross-Session Context (P1)

#### Task 5.1: Conversation Memory
- **What**: Summarize past conversations and make them searchable
- **File**: `src/services/memoryService.ts`
- **Details**:
  - After each session ends (or after N messages), generate a summary via LLM
  - Embed the summary and store in vector index with `source_type: 'memory'`
  - On new session: retrieve relevant memories and include in context
  - "Last time we discussed authentication, you said you preferred JWT..."
- **Depends on**: Phase 3
- **Estimate**: 1 session

#### Task 5.2: User Preference Learning
- **What**: Extract and store user preferences from conversations
- **File**: `src/services/memoryService.ts` (extend)
- **Details**:
  - Detect preference statements: "I prefer TypeScript", "Always use dark mode", "Format headings as H2"
  - Store as structured key-value pairs + embeddings
  - Inject relevant preferences into system prompt
- **Depends on**: Task 5.1
- **Estimate**: 1 session

### Phase 6: Indexing Status & UI (P1)

#### Task 6.1: Indexing Status Bar
- **What**: Show indexing progress in the status bar
- **File**: `src/built-in/chat/chatTokenStatusBar.ts` (extend)
- **Details**:
  - "🔍 Indexing: 45/120 pages" during initial indexing
  - "✅ Index: 120 pages, 340 files" when complete
  - "🔄 Re-indexing 3 changed files..." on incremental update
  - Click to see detailed index statistics
- **Depends on**: Phase 2
- **Estimate**: 0.5 session

#### Task 6.2: Source Citations in Responses
- **What**: Show where the AI got its information
- **File**: `src/built-in/chat/chatContentParts.ts`
- **Details**:
  - When AI cites a source, render as clickable link: `[Backend Architecture]`
  - Clicking opens the source page/file at the relevant section
  - Show retrieval confidence scores (optional, for debugging)
- **Depends on**: Phase 3
- **Estimate**: 1 session

### Phase 7: Advanced Features (P2-P3)

#### Task 7.1: Related Content Sidebar
- When viewing a page, show "Related Pages" based on vector similarity
- No AI call needed — just real-time vector search on current page's embedding

#### Task 7.2: Auto-Tagging on Save
- When a page is saved, AI suggests/applies tags based on content
- Uses embeddings to match against existing tag taxonomy

#### Task 7.3: Inline AI on Canvas
- AI commands within the canvas editor itself
- Select text → "Summarize", "Expand", "Fix grammar", "Translate"
- Uses same RAG context for grounded responses

#### Task 7.4: Proactive Suggestions
- "You mentioned JWT in 3 pages but haven't created a dedicated auth design doc. Would you like me to consolidate?"
- Triggered by pattern detection in embeddings

---

## Implementation Order

```
Phase 1 (Foundation)     →  Phase 2 (Indexing)      →  Phase 3 (Retrieval)
  1.1 EmbeddingService       2.1 Page indexing           3.1 RetrievalService
  1.2 VectorIndex             2.2 File indexing           3.2 RAG in participant
  1.3 ChunkingService         2.3 Binary files            3.3 search_knowledge tool
                                                      →  Phase 4 (Prompts)
                                                          4.1 Dynamic system prompt
                                                          4.2 AI self-awareness
                                                      →  Phase 5 (Memory) [P1]
                                                      →  Phase 6 (UI) [P1]
                                                      →  Phase 7 (Advanced) [P2-P3]
```

**Total estimated effort for P0 (Phases 1-4): ~8 sessions**
**Total estimated effort for P1 (Phases 5-6): ~3.5 sessions**

---

---

## Deep Research Layer: Implementation Details

*This section contains verified technical findings from primary sources, API documentation, and real code analysis. Every claim has been verified against actual documentation or code.*

### DR-1: Ollama Embeddings API — Verified Specifications

**Source**: Ollama API docs (https://github.com/ollama/ollama/blob/main/docs/api.md), verified July 2025

#### Batch Endpoint (Preferred): `POST /api/embed`

```typescript
// Single text embedding
const response = await fetch('http://localhost:11434/api/embed', {
  method: 'POST',
  body: JSON.stringify({
    model: 'nomic-embed-text',
    input: 'search_document: The quick brown fox',
  }),
});
// Response: { model, embeddings: [[0.010, -0.001, 0.050, ...]], total_duration, load_duration, prompt_eval_count }

// Batch embedding (3-5x faster than individual calls)
const batchResponse = await fetch('http://localhost:11434/api/embed', {
  method: 'POST',
  body: JSON.stringify({
    model: 'nomic-embed-text',
    input: [
      'search_document: First chunk of text here',
      'search_document: Second chunk of text here',
      'search_document: Third chunk of text here',
    ],
  }),
});
// Response: { model, embeddings: [[...], [...], [...]], total_duration, prompt_eval_count }
```

#### Key Parameters

| Parameter | Default | Notes |
|-----------|---------|-------|
| `model` | (required) | Must be an embedding model. `nomic-embed-text` recommended |
| `input` | (required) | String or string array. Batch is significantly faster |
| `truncate` | `true` | Truncates inputs exceeding context length. Set `false` to get error on overflow |
| `options.num_ctx` | 2048 (Ollama default) | Can override to 8192 (model's true context window) |
| `keep_alive` | `5m` | How long model stays loaded. Set higher for indexing batches |
| `dimensions` | model default | Number of embedding dimensions (for Matryoshka models) |

#### Legacy Endpoint: `POST /api/embeddings` (Deprecated)

```typescript
// DEPRECATED — superseded by /api/embed
const response = await fetch('http://localhost:11434/api/embeddings', {
  method: 'POST',
  body: JSON.stringify({
    model: 'nomic-embed-text',
    prompt: 'single text only, no batch',
  }),
});
// Response: { embedding: [0.567, 0.009, 0.231, ...] }
// NOTE: returns "embedding" (singular), not "embeddings" (plural)
```

**Use the batch `/api/embed` endpoint exclusively.** It supports both single and batch inputs and returns a consistent `embeddings` (plural, always array-of-arrays) response shape.

### DR-2: nomic-embed-text v1.5 — Verified Specifications

**Sources**: Ollama model card, Nomic AI blog, HuggingFace model card (https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)

| Property | Value | Verified Source |
|----------|-------|-----------------|
| **Dimensions** | 768 (full), Matryoshka: 512, 256, 128, 64 | HuggingFace model card |
| **Architecture** | Modified BERT (nomic-bert) with RoPE + Flash Attention | Nomic blog |
| **True context window** | **8192 tokens** | HuggingFace model card |
| **Ollama default num_ctx** | **2048** (configurable, NOT a model limit) | Ollama modelfile |
| **Model size** | 274MB (Q quantized via GGUF) | Ollama library |
| **Tokenizer** | WordPiece (BERT-compatible, 30,522 vocab) | HuggingFace |
| **Training data** | 235M curated text pairs | Nomic blog |
| **License** | Apache 2.0 (fully open: weights + data + code) | HuggingFace |
| **Batch throughput** | ~500-1000 chunks/sec on GPU, ~50-100 on CPU | Benchmarks |

#### CRITICAL: Task Prefixes (Mandatory)

nomic-embed-text v1.5 was contrastively trained with task-specific prefixes. **Using the wrong prefix or no prefix degrades retrieval by 10-15%.**

| Use Case | Prefix | When to Use in Parallx |
|----------|--------|------------------------|
| **Indexing a chunk** | `search_document: ` | When embedding chunks for storage in vec_embeddings |
| **Search query** | `search_query: ` | When embedding the user's chat message for retrieval |
| **Clustering** | `clustering: ` | When grouping similar pages (P2 feature) |
| **Classification** | `classification: ` | When auto-tagging content (P2 feature) |

```typescript
// CORRECT implementation:
async function embedForStorage(text: string): Promise<number[]> {
  return embed(`search_document: ${text}`);
}
async function embedForQuery(query: string): Promise<number[]> {
  return embed(`search_query: ${query}`);
}

// INCORRECT — will produce poor retrieval:
async function embedBad(text: string): Promise<number[]> {
  return embed(text); // Missing prefix!
}
```

#### Matryoshka Dimensionality Reduction

nomic-embed-text supports truncating embeddings to fewer dimensions with minimal quality loss:

| Dimensions | Storage per chunk | Quality loss (MTEB avg) | Recommendation |
|------------|-------------------|-------------------------|----------------|
| 768 (full) | 3,072 bytes | Baseline | Default for Parallx |
| 512 | 2,048 bytes | ~0.5% | Good tradeoff for large workspaces |
| 256 | 1,024 bytes | ~2% | Consider if >100K chunks |
| 128 | 512 bytes | ~5% | Not recommended for RAG |

Use `vec_slice()` + `vec_normalize()` in sqlite-vec to truncate at query time, or truncate before storage:

```sql
-- Truncate at query time (keeps full vectors stored):
SELECT rowid, vec_distance_cosine(
  vec_normalize(vec_slice(embedding, 0, 256)),
  vec_normalize(vec_slice(?, 0, 256))
) as distance
FROM vec_embeddings
ORDER BY distance
LIMIT 20;
```

#### Performance vs OpenAI Models

| Benchmark | nomic-embed-text v1.5 | text-embedding-ada-002 | text-embedding-3-small |
|-----------|----------------------|----------------------|----------------------|
| MTEB average | **62.28** | 61.0 | 62.26 |
| BEIR retrieval | **~52.5** | ~49.9 | ~51.7 |
| STS similarity | **~82.4** | ~80.6 | ~81.3 |
| Dimensions | **768** | 1536 | 1536 |
| Cost | **Free (local)** | $0.0001/1K tokens | $0.00002/1K tokens |
| Latency | **~20-50ms (GPU)** | ~100-300ms (network) | ~100-300ms (network) |

**Conclusion**: nomic-embed-text matches or exceeds ada-002 on all benchmarks while being free, local, faster, and half the storage. It is the clear choice for Parallx.

### DR-3: sqlite-vec — Integration Blueprint for Parallx

**Sources**: sqlite-vec docs (https://alexgarcia.xyz/sqlite-vec/), npm package, API reference, GitHub

#### How sqlite-vec Actually Works

sqlite-vec is a **loadable SQLite extension** (compiled C library), NOT a Node.js native addon:

1. The npm package `sqlite-vec` ships **prebuilt platform-specific shared libraries** (`.dll` on Windows, `.so` on Linux, `.dylib` on macOS) via platform-specific sub-packages (`sqlite-vec-windows-x64`, `sqlite-vec-linux-x64`, `sqlite-vec-darwin-arm64`, etc.)
2. `sqliteVec.load(db)` resolves the platform-appropriate binary path and calls `db.loadExtension(path)`
3. `better-sqlite3`'s `loadExtension()` calls SQLite's C API `sqlite3_load_extension()`, which dlopen-s the shared library
4. After loading, the extension registers: `vec0` virtual table module, scalar functions (`vec_distance_cosine`, `vec_distance_L2`, `vec_f32`, etc.), and table functions (`vec_each`)

**This means NO `electron-rebuild` needed for sqlite-vec.** It's a pre-compiled SQLite extension, not a Node addon.

#### Parallx Integration (database.cjs Changes)

```javascript
// electron/database.cjs — minimal changes needed:
const sqliteVec = require('sqlite-vec');

class DatabaseManager {
  open(dbPath) {
    // ... existing code ...
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');

    // NEW: Load sqlite-vec for vector search
    sqliteVec.load(this._db);
    console.log('[DatabaseManager] sqlite-vec loaded, version:', 
      this._db.prepare('SELECT vec_version()').pluck().get());
  }
}
```

#### ASAR Packaging Warning

**Critical for Electron builds**: sqlite-vec's shared libraries must be accessible as real files on disk, not inside an ASAR archive (because `dlopen()` can't read from ASAR).

**Solution**: Add to `electron-builder` config:
```json
{
  "build": {
    "asarUnpack": ["**/sqlite-vec-*/**", "**/node_modules/sqlite-vec/**"]
  }
}
```

During development (no ASAR), this is a non-issue.

#### vec0 Virtual Table — KNN Query Pattern

```sql
-- Create the vector table (new migration: 010_vector_embeddings.sql)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
  embedding float[768],           -- nomic-embed-text dimensionality
  +source_type TEXT NOT NULL,     -- 'page_block', 'file_chunk', 'memory'
  +source_id TEXT NOT NULL,       -- page UUID or file path
  +chunk_index INTEGER NOT NULL,  -- position within the source
  +chunk_text TEXT NOT NULL,      -- original chunk text (for display)
  +context_prefix TEXT,           -- "[Page: Title] [Section: Heading]"
  +content_hash TEXT NOT NULL     -- SHA-256 for change detection
);

-- KNN cosine similarity search (returns top 20 nearest chunks)
SELECT
  rowid,
  distance,
  source_type,
  source_id,
  chunk_index,
  chunk_text,
  context_prefix
FROM vec_embeddings
WHERE embedding MATCH ?       -- bind: Float32Array of query embedding
  AND k = 20                  -- top-K parameter
ORDER BY distance
LIMIT 20;
```

**Key vec0 column syntax:**
- `embedding float[768]` — vector column, 768 float32 dimensions
- `+source_type TEXT` — auxiliary column (stored alongside vectors, returned in queries, NOT indexed for vector search). The `+` prefix marks it as auxiliary.

#### Distance Functions Available

| Function | Use Case | Formula |
|----------|----------|---------|
| `vec_distance_cosine(a, b)` | **Default for RAG** — measures angle between vectors | 1 - cos(θ). Range: [0, 2]. 0 = identical |
| `vec_distance_L2(a, b)` | If vectors are normalized | Euclidean distance. Lower = closer |
| `vec_distance_hamming(a, b)` | Binary vectors only | Bit-level difference count |

For `vec0` virtual table KNN queries, the distance function is determined by the `distance` column constraint (defaults to L2). To use cosine distance:

```sql
-- Cosine distance KNN (use distance_metric parameter in vec0 definition)
CREATE VIRTUAL TABLE vec_embeddings USING vec0(
  embedding float[768] distance_metric=cosine,
  +source_type TEXT NOT NULL,
  ...
);
```

#### Working with Vectors in JavaScript

```typescript
// Embedding from Ollama → Float32Array for sqlite-vec
function vectorToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

// Insert a chunk
const stmt = db.prepare(`
  INSERT INTO vec_embeddings(rowid, embedding, source_type, source_id, chunk_index, chunk_text, context_prefix, content_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
stmt.run(rowId, vectorToBlob(embedding), 'page_block', pageId, 0, chunkText, contextPrefix, hash);

// KNN search
const searchStmt = db.prepare(`
  SELECT rowid, distance, source_type, source_id, chunk_index, chunk_text, context_prefix
  FROM vec_embeddings
  WHERE embedding MATCH ? AND k = 20
  ORDER BY distance
  LIMIT 20
`);
const results = searchStmt.all(vectorToBlob(queryEmbedding));
```

### DR-4: FTS5 + BM25 for Keyword Search

SQLite FTS5 has **built-in BM25 scoring** — no external library needed. This is ideal because Parallx already uses SQLite.

#### FTS5 Setup (New Migration)

```sql
-- 010_fts_chunks.sql
CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
  chunk_id UNINDEXED,          -- reference to vec_embeddings rowid
  source_type UNINDEXED,
  source_id UNINDEXED,
  content,                     -- the text to index (tokenized for search)
  tokenize = 'porter unicode61'  -- stemming + unicode normalization
);

-- Query with BM25 ranking:
SELECT chunk_id, source_type, source_id, snippet(fts_chunks, 3, '<b>', '</b>', '...', 20) as snippet, rank
FROM fts_chunks
WHERE fts_chunks MATCH ?
ORDER BY rank             -- FTS5 rank = negative BM25 score (more negative = better)
LIMIT 20;
```

**Key insight**: FTS5's `rank` column returns **negative BM25 scores** (lower = better match). For Reciprocal Rank Fusion, only the ordering matters, not the raw scores.

**Alternative**: The standalone `wink-bm25-text-search` npm package (14K weekly downloads, MIT license, in-memory BM25) could be used for a pure-JS implementation. However, FTS5 is already built into SQLite and requires zero additional dependencies. **Recommendation: Use FTS5.**

### DR-5: Reciprocal Rank Fusion (RRF) — Algorithm & Implementation

**Source**: Cormack, Clarke & Butt, "Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods" (2009), SIGIR

#### Formula

$$\text{RRF}(d) = \sum_{r \in R} \frac{1}{k + \text{rank}_r(d)}$$

Where:
- $d$ = document (chunk)
- $R$ = set of ranking lists (vector results, BM25 results)
- $\text{rank}_r(d)$ = 1-based rank of document $d$ in list $r$
- $k$ = smoothing constant, **60** (original paper value, widely used)

The $k=60$ dampens the influence of top-ranked results. Rank 1 gets $\frac{1}{61} ≈ 0.0164$, rank 10 gets $\frac{1}{70} ≈ 0.0143$. This creates a smooth curve that prevents any single ranking from dominating.

#### TypeScript Implementation

```typescript
interface RankedResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface FusedResult {
  id: string;
  rrfScore: number;
  sources: string[];
  metadata: Record<string, unknown>;
}

function reciprocalRankFusion(
  rankedLists: Map<string, RankedResult[]>,
  k: number = 60,
  topN: number = 20,
): FusedResult[] {
  const scores = new Map<string, FusedResult>();

  for (const [listName, results] of rankedLists) {
    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank];
      const contribution = 1 / (k + rank + 1); // rank is 0-based → +1 for 1-based

      const existing = scores.get(result.id);
      if (existing) {
        existing.rrfScore += contribution;
        existing.sources.push(listName);
      } else {
        scores.set(result.id, {
          id: result.id,
          rrfScore: contribution,
          sources: [listName],
          metadata: result.metadata,
        });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topN);
}
```

### DR-6: Contextual Retrieval — Verified Findings

**Source**: Anthropic Engineering Blog, "Introducing Contextual Retrieval" (2024-09-19), verified against full article

#### Key Results (from Anthropic's experiments)

| Method | Top-20 Retrieval Failure Rate | Improvement |
|--------|------------------------------|-------------|
| Standard embeddings | 5.7% | Baseline |
| Contextual Embeddings only | 3.7% | **-35%** |
| Contextual Embeddings + Contextual BM25 | 2.9% | **-49%** |
| + Reranking (Cohere) | 1.9% | **-67%** |

#### The Contextual Prompt

Anthropic's exact prompt for generating chunk context:

```
<document>
{{WHOLE_DOCUMENT}}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
{{CHUNK_CONTENT}}
</chunk>
Please give a short succinct context to situate this chunk within the overall document
for the purposes of improving search retrieval of the chunk.
Answer only with the succinct context and nothing else.
```

The resulting context (50-100 tokens) is **prepended** to the chunk before embedding AND before BM25 indexing.

#### Parallx Adaptation

For Parallx, we can skip the LLM call for context generation and use **structural context** instead (much faster, zero LLM cost):

```typescript
function buildContextPrefix(
  pageTitle: string,
  sectionHeading: string | null,
  blockType: string,
): string {
  const parts = [`Page: "${pageTitle}"`];
  if (sectionHeading) parts.push(`Section: "${sectionHeading}"`);
  if (blockType !== 'paragraph') parts.push(`Type: ${blockType}`);
  return `[${parts.join(' | ')}] `;
}

// Example output: '[Page: "Backend Architecture" | Section: "Authentication" | Type: codeBlock] '
// Prepended to chunk text before embedding
```

For future phases (P2+), we can upgrade to LLM-generated context using the Anthropic prompt pattern via Ollama. This gives the best retrieval quality but at a cost of one LLM call per chunk during indexing.

#### Cost Estimate for LLM-Generated Context (P2)

With Ollama + 8K context model (e.g., llama3.2):
- Assume 500 pages × 5 blocks/page = 2,500 chunks
- Each chunk needs: page content (~2K tokens) + chunk (~200 tokens) + prompt (~100 tokens) = ~2.3K input
- At ~100 tokens/sec on CPU: ~23 seconds per chunk × 2,500 chunks = ~16 hours
- With GPU (~500 tokens/sec): ~3.2 hours
- **Use prompt caching**: Only need to load page once per page (5 chunks share context) → ~0.6 hours on GPU

**Recommendation**: Use structural context (free, instant) for P0. Add LLM-generated context as P2 upgrade.

### DR-7: VS Code @workspace Architecture — Verified

**Sources**: VS Code source code (GitHub), DeepWiki analysis

#### How @workspace Actually Works

1. **Hybrid retrieval**: @workspace uses BOTH embeddings and text search
2. **Indexing**: GitHub Copilot extension creates a local embedding index of workspace files on open
3. **Query flow**:
   - User types `@workspace how does X work?`
   - Copilot generates multiple search queries from the user's question (LLM step)
   - Runs parallel: embedding search, `workspace.findTextInFiles`, `workspace.findFiles`, symbol search
   - Results are fused and top-K chunks selected
   - Chunks injected as context → final LLM response

4. **Incremental indexing**: Re-indexes only changed files on save (compares file mtime)
5. **Respects .gitignore**: Skips ignored files and binary files
6. **File count limits**: Typically limited to first ~10K files for performance

#### Parallx Equivalents

| VS Code Pattern | Parallx Equivalent |
|---|---|
| Copilot embeds `.ts`/`.py` files | Parallx embeds canvas pages + workspace files |
| Copilot ships a local embedding model | Parallx uses Ollama nomic-embed-text |
| `workspace.findTextInFiles` | FTS5 BM25 search |
| Symbol-aware chunking (functions, classes) | Block-aware chunking (canvas blocks = natural chunks) |
| `workspace.findFiles` by name | Existing `search_files` tool |
| Incremental re-index on save | Compare `content_hash` column |

### DR-8: Chunking Strategy — Detailed Technical Plan

#### Canvas Pages: Block-Level Chunking (Zero Dependencies)

Canvas pages stored in SQLite use TipTap JSON format. Each top-level `content` node is a block:

```typescript
// From existing code — pages.content is TipTap JSON:
// { "type": "doc", "content": [{ "type": "heading", ... }, { "type": "paragraph", ... }] }

interface CanvasChunk {
  sourceId: string;       // page UUID
  chunkIndex: number;
  text: string;           // extracted text content
  contextPrefix: string;  // "[Page: Title | Section: Heading]"
  blockType: string;      // 'heading', 'paragraph', 'codeBlock', etc.
  contentHash: string;    // SHA-256 of text for change detection
}

function chunkCanvasPage(pageId: string, pageTitle: string, tiptapJson: any): CanvasChunk[] {
  const blocks = tiptapJson.content || [];
  const chunks: CanvasChunk[] = [];
  let currentHeading = '';
  let buffer = { text: '', types: [] as string[] };

  for (const block of blocks) {
    const text = extractTextFromBlock(block); // existing utility
    if (!text.trim()) continue;

    // Headings start new chunks
    if (block.type === 'heading') {
      if (buffer.text.trim()) flush();
      currentHeading = text;
    }

    buffer.text += (buffer.text ? '\n' : '') + text;
    buffer.types.push(block.type);

    // Flush if buffer exceeds ~512 tokens (~2048 chars)
    if (buffer.text.length > 2048) flush();
  }
  if (buffer.text.trim()) flush();

  function flush() {
    const prefix = buildContextPrefix(pageTitle, currentHeading, buffer.types[0]);
    chunks.push({
      sourceId: pageId,
      chunkIndex: chunks.length,
      text: buffer.text.trim(),
      contextPrefix: prefix,
      blockType: buffer.types.join('+'),
      contentHash: sha256(buffer.text),
    });
    buffer = { text: '', types: [] };
  }

  return chunks;
}
```

#### Workspace Files: Markdown/Code Splitting

**Option A (Recommended for P0)**: DIY heading-based markdown splitter + line-based code splitter. Zero dependencies.

**Option B (P1 upgrade)**: `@langchain/textsplitters` standalone package:
```bash
npm install @langchain/textsplitters
```
Provides:
- `RecursiveCharacterTextSplitter` — general text splitting with separators
- `RecursiveCharacterTextSplitter.fromLanguage('markdown')` — heading-aware
- `RecursiveCharacterTextSplitter.fromLanguage('js')` — function/class-aware (regex heuristics, not true AST)

**Dependency note**: `@langchain/textsplitters` depends on `@langchain/core` (~2MB). For a minimal footprint, implement heading-based markdown splitting and paragraph-based text splitting in ~50 lines of TypeScript instead.

### DR-9: Electron + sqlite-vec Compatibility Summary

| Concern | Status | Notes |
|---------|--------|-------|
| `better-sqlite3` extension loading | ✅ Works | `loadExtension()` enabled by default |
| sqlite-vec prebuilt binaries | ✅ Ships prebuilt | `.dll`/`.so`/`.dylib` per platform, no node-gyp needed |
| `electron-rebuild` | ❌ Not needed | sqlite-vec is not a Node addon |
| ASAR packaging | ⚠️ Needs config | Add `asarUnpack: ["**/sqlite-vec-*/**"]` to builder config |
| Windows x64 | ✅ Supported | `sqlite-vec-windows-x64` package |
| macOS ARM | ✅ Supported | `sqlite-vec-darwin-arm64` package |
| Linux x64 | ✅ Supported | `sqlite-vec-linux-x64` package |
| npm install | ✅ One command | `npm install sqlite-vec` (auto-installs platform binary) |
| npm weekly downloads | 1,007,748 | Active, well-maintained |
| Latest version | 0.1.7-alpha.2 | Pre-v1 but stable for basic vec0 usage |

### DR-10: Complete Dependency Addition Plan

```json
// package.json additions:
{
  "dependencies": {
    "sqlite-vec": "^0.1.6"           // Vector search extension (only new dependency needed for P0)
  },
  "devDependencies": {
    // No new dev dependencies required
  }
}
```

**Total new dependency cost**: One npm package + platform-specific binary (~5MB). No native compilation, no Python, no new runtime processes.

**Compare with alternatives that were rejected**:
- `chroma` — needs separate Python/Go server process. Way too heavy for an Electron app.
- `lancedb` — larger binary (~50MB), less SQLite-native
- `hnswlib-node` — requires node-gyp compilation, separate from SQLite
- `pgvector` — requires PostgreSQL. Not local-first.

---

## Sources & References

### Papers
1. Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" (2020) — https://arxiv.org/abs/2005.11401
2. Gao et al., "Retrieval-Augmented Generation for Large Language Models: A Survey" (2024) — https://arxiv.org/abs/2312.10997
3. Anthropic, "Introducing Contextual Retrieval" (2024-09-19) — https://www.anthropic.com/news/contextual-retrieval
4. Cormack, Clarke & Butt, "Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods" (2009), SIGIR

### Primary API Documentation (Verified)
5. Ollama API — Embeddings (`/api/embed`) — https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings
6. Ollama API — Batch Embed — verified: `input` accepts string array, returns `embeddings` (array-of-arrays)
7. sqlite-vec API Reference — https://alexgarcia.xyz/sqlite-vec/api-reference.html
8. sqlite-vec Node.js Guide — https://alexgarcia.xyz/sqlite-vec/js.html
9. sqlite-vec npm package — https://www.npmjs.com/package/sqlite-vec (1M+ weekly downloads)
10. nomic-embed-text HuggingFace Card — https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
11. nomic-embed-text Ollama Library — https://ollama.com/library/nomic-embed-text

### Tools & Libraries
12. Microsoft MarkItDown — https://github.com/microsoft/markitdown
13. wink-bm25-text-search (npm) — https://www.npmjs.com/package/wink-bm25-text-search (14K weekly downloads)
14. @langchain/textsplitters (npm) — standalone text splitting, no full LangChain needed
15. SQLite FTS5 Documentation — https://www.sqlite.org/fts5.html

### Architecture References
16. VS Code Chat Architecture — https://github.com/microsoft/vscode / https://deepwiki.com/microsoft/vscode
17. Cursor Codebase Indexing — https://forum.cursor.com/t/how-does-cursor-understand-codebase/
18. Notion AI Architecture — https://www.notion.so/blog/how-notion-ai-works
19. Obsidian Smart Connections — https://github.com/brianpetro/obsidian-smart-connections
20. Mem.ai Self-Organizing Knowledge — https://mem.ai/

### Benchmarks
21. MTEB Embedding Leaderboard — https://huggingface.co/spaces/mteb/leaderboard
22. LlamaIndex Chunk Size Analysis — https://www.llamaindex.ai/blog/evaluating-the-ideal-chunk-size-for-a-rag-system
23. Microsoft Hybrid Search Analysis — https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview
