# Milestone 21 — Intelligent Document Ingestion (Docling Integration)

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 21.
> All implementation must conform to the structures and boundaries defined here.
> Milestones 1–20 established the workbench shell, tool system, local AI chat,
> RAG pipeline, session memory, workspace session isolation, AI personality
> settings, cross-cutting polish, and unified AI configuration hub. This
> milestone **replaces the naive document extraction layer** with an intelligent
> ingestion pipeline powered by Docling, enabling accurate parsing of PDFs,
> Office documents, and scanned images into structured Markdown.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Research: MarkItDown vs Docling](#research-markitdown-vs-docling)
3. [Vision](#vision)
4. [Architecture](#architecture)
5. [Design Principles](#design-principles)
6. [Phase A — Docling Bridge Service](#phase-a--docling-bridge-service)
7. [Phase B — Document Classifier](#phase-b--document-classifier)
8. [Phase C — Pipeline Integration](#phase-c--pipeline-integration)
9. [Phase D — Content-Aware Chunking Improvements](#phase-d--content-aware-chunking-improvements)
10. [Phase E — Fallback & Resilience](#phase-e--fallback--resilience)
11. [Phase F — Observability & User Feedback](#phase-f--observability--user-feedback)
12. [Migration & Backward Compatibility](#migration--backward-compatibility)
13. [Task Tracker](#task-tracker)
14. [Verification Checklist](#verification-checklist)
15. [Risk Register](#risk-register)

---

## Problem Statement

### What happens today

Parallx's indexing pipeline extracts text from rich documents (PDF, DOCX, XLSX)
using basic rule-based libraries:

| Format | Library | Method |
|--------|---------|--------|
| PDF | `pdf-parse` (pdf.js) | Linear text stream extraction |
| Word | `mammoth` | `extractRawText()` — all formatting discarded |
| Excel | SheetJS | CSV text per sheet |

**All output is flattened to plain text.** No page numbers, no table structure,
no heading hierarchy, no reading order, no layout awareness.

The chunker then splits this flat text using a one-size-fits-all strategy:

- **Canvas pages**: TipTap JSON AST-aware splitting (good)
- **Markdown files**: Heading-aware splitting (decent)
- **Everything else** (PDF, DOCX, code, spreadsheets): Line-based splitting at
  blank lines or hard 1024-char limits (poor)

### The result

- **PDFs with complex layouts** (multi-column, tables, figures, headers/footers)
  produce garbage text. Chunks don't correspond to meaningful content units.
- **Scanned documents** produce empty or near-empty text — no OCR capability.
- **Tables in PDFs** become jumbled text blobs — row/column structure is lost.
- **All document types use the same chunk size** (1024 chars) regardless of
  content density. Code, prose, and tabular data have different optimal sizes.
- **No structural metadata survives extraction.** A PDF's chapter/section
  hierarchy is lost before it ever reaches the chunker.

### Evidence: Books workspace failure

A workspace of book PDFs demonstrated the full failure mode. Complex layouts
were linearized into incoherent text streams. The chunker split these at
arbitrary points. The resulting embeddings had low semantic coherence. The AI
could not reliably answer questions about content it had indexed — the
knowledge was present but unintelligible.

### What this milestone fixes

Replace the extraction layer with **Docling** — an ML-powered document
understanding system that produces structured Markdown with correct heading
hierarchy, recovered table structure, proper reading order, and OCR for
scanned content. Add a **document classifier** that routes files to the
appropriate processing pipeline. Keep the rest of the stack (chunking,
embedding, vector storage, retrieval) intact, with targeted improvements to
chunking that leverage Docling's richer output.

---

## Research: MarkItDown vs Docling

Two Python packages were evaluated as replacements for the current extraction
layer. Both convert documents to Markdown. Their approaches differ
fundamentally.

### MarkItDown (Microsoft)

- **Repository**: https://github.com/microsoft/markitdown
- **Stars**: 90.2k | **License**: MIT | **Latest**: v0.1.5 (Feb 2026)
- **Maintained by**: Microsoft AutoGen team

**Architecture**: Rule-based converters per format. No ML models required for
basic operation. Each format has a dedicated converter that produces Markdown
using the source library's text extraction capabilities.

**Supported formats**: PDF, Word (.docx), PowerPoint (.pptx), Excel
(.xlsx/.xls), HTML, images (EXIF + OCR), audio (transcription), CSV, JSON,
XML, ZIP, YouTube URLs, EPubs.

**PDF extraction**: Uses `pdfminer`/`pdf-parse` under the hood — the same
tier of text extraction as our current `pdf-parse` implementation. Multi-column
layouts, complex tables, and reading order remain problematic.

**Optional enhancements**:
- Azure Document Intelligence for high-quality PDF layout analysis (cloud)
- LLM-based image descriptions via `llm_client` parameter (cloud)

**Strengths**:
- Lightweight install (~50 MB)
- Fast execution (rule-based, no model inference)
- Broad format coverage (YouTube, audio, ZIP)
- Simple API: `md.convert("file.pdf")` → `result.text_content`
- Plugin system for third-party format extensions
- Modular optional dependencies (`pip install 'markitdown[pdf, docx]'`)

**Weaknesses**:
- PDF quality without Azure Doc Intelligence is no better than current solution
- No layout model — cannot detect columns, reading order, or figure regions
- No local OCR (requires external services)
- No table structure recovery from PDFs
- Essentially a better-packaged version of what we already have

### Docling (IBM Research)

- **Repository**: https://github.com/docling-project/docling
- **Stars**: 55.1k | **License**: MIT | **Latest**: v2.77.0 (active daily releases)
- **Maintained by**: IBM Research Zurich, hosted by LF AI & Data Foundation

**Architecture**: ML-powered document understanding pipeline with configurable
stages. Uses trained models for layout analysis, table structure recognition,
and reading order detection.

**Supported formats**: PDF, DOCX, PPTX, XLSX, HTML, images (PNG, TIFF, JPEG),
LaTeX, WAV, MP3, WebVTT, XBRL, USPTO patents, JATS articles.

**PDF extraction**: This is where Docling fundamentally differs:
- **Layout model** ("Heron"): Detects page regions — titles, text, tables,
  figures, code blocks, formulas, captions
- **Table structure recognition**: Recovers row/column structure, not just text
- **Reading order detection**: Correct sequence for multi-column layouts
- **Formula recognition**: Extracts mathematical formulas
- **Image classification**: Identifies and labels figure regions

**Output model**: DoclingDocument — a structured intermediate representation
preserving all detected elements. Exports to Markdown, HTML, DocTags, or
lossless JSON.

**OCR**: Built-in, configurable. Works on scanned PDFs and images without
external services.

**Visual Language Models**: Optional GraniteDocling (258M params) for enhanced
understanding. Uses MLX acceleration on Apple Silicon.

**Strengths**:
- Solves the actual problem (layout understanding, table recovery, reading order)
- Produces structurally rich Markdown that feeds directly into heading-aware chunking
- Runs fully locally — no cloud dependency, matches Parallx's local-first architecture
- Built-in OCR for scanned documents
- Configurable pipeline stages (enable/disable OCR, swap models)
- MCP server for agent integration
- Active development (156 releases, 190 contributors)

**Weaknesses**:
- Heavy install (~1+ GB with ML models)
- Slower execution (ML inference per page vs rule-based extraction)
- Requires Python 3.10+ runtime alongside Electron
- First-run model download adds latency
- More complex integration (Python bridge needed)

### Decision: Docling

**Rationale**: MarkItDown's PDF extraction is fundamentally the same tier as
our current `pdf-parse` implementation. It would not fix the books workspace
failure or any complex-layout PDF issue. Docling solves the actual problem —
it understands document layout, recovers table structure, detects reading
order, and produces structured Markdown that our heading-aware chunker can
split into semantically meaningful units.

The weight and speed costs are acceptable: Parallx already requires Ollama with
multi-GB LLM and embedding models. Adding ~1 GB of document understanding
models is proportionally small. Document indexing is a background process where
correctness matters more than speed.

---

## Vision

### Before M21

> You add a folder of PDF research papers to your workspace. Parallx indexes
> them. You ask the AI about a table from one of the papers — it can't answer
> or gives a wrong answer. The table was destroyed during extraction, split
> across chunks at arbitrary points. Multi-column papers have interleaved
> columns. Scanned documents produce empty indexes. You have no visibility into
> what went wrong.

### After M21

> You add the same folder. Parallx detects the PDFs, classifies them (digital
> vs scanned), and routes them through Docling. The layout model identifies
> columns, tables, headings, and figures. Tables are recovered as Markdown
> tables. Multi-column text flows in correct reading order. Scanned pages go
> through OCR. The chunker splits at the heading boundaries Docling detected.
>
> You ask the AI about the table — it finds the correctly structured chunk and
> gives an accurate answer. In the Indexing Log, you can see which pipeline
> each file used and how long extraction took. If Docling isn't available
> (Python not installed), the system falls back to the existing extractors
> and shows a notification suggesting Docling installation for better results.

---

## Architecture

### End-to-End Ingestion Flow

```
File arrives (workspace open / file change / manual re-index)
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Document Classifier (TypeScript, renderer)      │
│                                                  │
│  Examines extension, MIME type, file header      │
│  Routes to appropriate pipeline:                 │
│                                                  │
│  ┌─ plain text / code / markdown ─────────┐     │
│  │  Read directly (existing path)          │     │
│  │  → chunkFile() / _chunkMarkdown()       │     │
│  └─────────────────────────────────────────┘     │
│                                                  │
│  ┌─ canvas page ──────────────────────────┐     │
│  │  TipTap JSON → chunkPage() (existing)   │     │
│  └─────────────────────────────────────────┘     │
│                                                  │
│  ┌─ rich document (PDF/DOCX/PPTX/XLSX/img)┐     │
│  │  → Docling Bridge Service               │     │
│  │    ├─ standard pipeline (digital docs)  │     │
│  │    ├─ OCR pipeline (scanned/image-heavy)│     │
│  │    └─ fallback: legacy extractors       │     │
│  └─────────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
    │
    ▼
Structured Markdown output
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Content-Aware Chunker (improved chunkingService)│
│                                                  │
│  Docling output → _chunkMarkdown() path          │
│  (headings, tables, code blocks preserved)       │
│  Chunk size: 1024 chars (configurable future)    │
│  Overlap: 200 chars at size boundaries           │
│  Clean breaks at headings (no overlap)           │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Embedding (unchanged)                           │
│  nomic-embed-text via Ollama                     │
│  "search_document: <prefix>\n<chunk>"            │
│  768-dim float vectors, batch size 64            │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Storage (unchanged)                             │
│  sqlite-vec (vec0 cosine) + FTS5 (porter stem)  │
│  Dual write: vec_embeddings + fts_chunks         │
│  indexing_metadata for change detection          │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Retrieval (unchanged)                           │
│  Hybrid: vector KNN + FTS5 BM25 → RRF merge     │
│  Score filter → cosine re-rank → dedup → budget  │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Local Chat Model (unchanged)                    │
│  Ollama (qwen2.5:32b-instruct or configured)     │
│  Elastic token budget (M20 Phase G)              │
└─────────────────────────────────────────────────┘
```

### Docling Bridge Architecture

Docling is a Python package. Parallx is Electron/TypeScript. The bridge
connects them:

```
Electron Main Process
    │
    │  IPC: 'document:extract-rich'
    ▼
┌──────────────────────────────────────────────┐
│  Docling Bridge (main.cjs / doclingBridge.cjs)│
│                                               │
│  Manages a local Python subprocess/service:   │
│                                               │
│  Option A — Subprocess per document:          │
│    python -m parallx_docling <file> [--ocr]   │
│    → stdout: Markdown string                  │
│    → stderr: progress/diagnostics             │
│                                               │
│  Option B — Persistent HTTP service:          │
│    POST http://localhost:<port>/convert        │
│    Body: { path, options }                    │
│    → JSON: { markdown, metadata, diagnostics }│
│                                               │
│  Option C — Docling MCP server:               │
│    Use Docling's built-in MCP protocol        │
│    → Structured document output               │
│                                               │
│  Health check / availability detection:       │
│    - Is Python 3.10+ available?               │
│    - Is docling installed?                    │
│    - Are models downloaded?                   │
│    → Falls back to legacy extractors if not   │
└──────────────────────────────────────────────┘
```

**Selected approach**: To be determined during Phase A implementation. Option B
(persistent HTTP service) is the leading candidate — it avoids Python startup
overhead per document and supports batch processing. Option C (MCP server) is
an attractive alternative since Docling ships one natively.

### Integration Points (Existing Code)

| File | Current Role | M21 Change |
|------|-------------|------------|
| `electron/documentExtractor.cjs` | PDF/DOCX/XLSX extraction | Becomes **fallback** extractor; primary path routes to Docling bridge |
| `electron/main.cjs` | IPC handler for `document:extract-rich` | Adds Docling bridge orchestration + classifier dispatch |
| `src/services/indexingPipeline.ts` | Orchestrates file → chunk → embed → store | Adds classifier step before extraction; supports Markdown-as-extraction-output |
| `src/services/chunkingService.ts` | Splits text into chunks | Docling output routed through `_chunkMarkdown()` path; potential improvements to table/code handling |
| `src/services/embeddingService.ts` | nomic-embed-text via Ollama | **Unchanged** |
| `src/services/vectorStoreService.ts` | sqlite-vec + FTS5 storage | **Unchanged** |
| `src/services/retrievalService.ts` | Hybrid search + RRF | **Unchanged** |
| `src/built-in/indexing-log/` | Indexing progress UI | Enhanced to show pipeline type + extraction diagnostics |

---

## Design Principles

1. **Surgical replacement.** Only the extraction layer changes. Embedding,
   storage, and retrieval stay the same. The chunker gets targeted improvements
   to leverage Docling's richer output, but its core algorithm doesn't change.

2. **Graceful degradation.** If Docling is not installed, Python is not
   available, or models haven't downloaded, the system falls back to the
   existing extractors. The user gets a notification suggesting installation
   for better results, but nothing breaks.

3. **Structured Markdown as the interface.** Docling outputs Markdown. The
   chunker already has a heading-aware Markdown path. By standardizing on
   Markdown as the extraction output format, all document types automatically
   benefit from the best chunking strategy.

4. **Classify first, process second.** A lightweight classifier examines each
   file before extraction to route it to the cheapest sufficient pipeline. Text
   files never touch Docling. Digital PDFs skip OCR. Only scanned/image-heavy
   documents pay the OCR cost.

5. **Local-first.** Docling runs entirely on the user's machine. No cloud APIs,
   no API keys, no data leaving the device. Consistent with Parallx's existing
   Ollama-based architecture.

6. **Observable.** The user can see which pipeline each file used, how long
   extraction took, and what the extraction quality was. The Indexing Log
   becomes a diagnostic tool, not just a progress bar.

---

## Phase A — Docling Bridge Service

> **Goal**: Create the Python-side service and Electron-side bridge that
> lets the indexing pipeline send a file path and receive structured Markdown.

### A.1 — Python wrapper package

Create a minimal Python package (`tools/docling-bridge/`) that:

- Installs Docling as a dependency (`pip install docling`)
- Exposes a FastAPI HTTP service with endpoints:
  - `GET /health` — returns `{ status: "ok", docling_version, models_ready }`
  - `POST /convert` — accepts `{ path: string, ocr: boolean }`, returns
    `{ markdown: string, page_count: number, tables_found: number, diagnostics: string[] }`
  - `POST /convert/batch` — accepts array of paths, returns array of results
- Configures Docling pipeline options:
  - Standard: `PipelineOptions(do_ocr=False)` for digital documents
  - OCR: `PipelineOptions(do_ocr=True)` for scanned content
- Handles model download on first run with progress reporting
- Binds to `localhost` only (security: no network exposure)
- Logs to stderr for Electron to capture

**Estimated effort**: 4h

### A.2 — Electron bridge module

Create `electron/doclingBridge.cjs` that:

- Manages the Python subprocess lifecycle (start, health check, stop)
- Auto-detects Python 3.10+ installation (`python --version` / `python3 --version`)
- Checks if `docling` package is installed (`python -c "import docling"`)
- Starts the FastAPI service on a random available port
- Provides `convertDocument(filePath, options)` → `Promise<DoclingResult>`
- Implements health check polling with timeout
- Handles graceful shutdown on app exit
- Emits availability status events (available / unavailable / downloading-models)

**Estimated effort**: 4h

### A.3 — IPC integration

Wire the Docling bridge into `main.cjs` IPC handlers:

- New IPC channel: `docling:convert` — sends file to Docling bridge
- New IPC channel: `docling:status` — returns bridge availability status
- New IPC channel: `docling:install` — triggers guided installation flow
- Update `document:extract-rich` — tries Docling first, falls back to legacy

**Estimated effort**: 2h

### A.4 — Renderer-side service interface

Add to `src/services/serviceTypes.ts`:

```typescript
interface IDocumentExtractionService extends IDisposable {
  /** Whether Docling is available on this system. */
  readonly isDoclingAvailable: boolean;
  /** Event fired when availability changes. */
  readonly onDidChangeAvailability: Event<boolean>;
  /** Extract structured Markdown from a rich document. */
  extractDocument(filePath: string, options?: {
    ocr?: boolean;
  }): Promise<{
    markdown: string;
    pageCount: number;
    tablesFound: number;
    diagnostics: string[];
    pipeline: 'docling' | 'docling-ocr' | 'legacy';
  }>;
}
```

**Estimated effort**: 2h

---

## Phase B — Document Classifier

> **Goal**: Route each file to the cheapest sufficient extraction pipeline.

### B.1 — Classifier service

Create `src/services/documentClassifier.ts`:

```typescript
type DocumentClass =
  | 'text'           // .md, .ts, .py, .json, etc. — read directly
  | 'canvas'         // TipTap JSON — existing chunkPage() path
  | 'digital-doc'    // Clean PDF, DOCX, PPTX, XLSX — Docling standard
  | 'scanned-doc'    // Scanned PDF, image-heavy — Docling + OCR
  | 'image'          // .png, .jpg, .tiff — Docling OCR
  | 'unsupported';   // Unknown format — skip

interface ClassificationResult {
  documentClass: DocumentClass;
  confidence: number;
  reason: string;
}
```

Classification logic:

1. **Extension check** — route `.md`, `.ts`, `.py`, etc. to `'text'`
2. **Rich document extensions** — `.pdf`, `.docx`, `.pptx`, `.xlsx` → further analysis
3. **PDF sub-classification** (for PDFs only):
   - Read first N bytes to check for text layer presence
   - Heuristic: if extractable text / page count < threshold → `'scanned-doc'`
   - Otherwise → `'digital-doc'`
4. **Image extensions** — `.png`, `.jpg`, `.tiff`, `.bmp` → `'image'`
5. **PowerPoint** — `.pptx` → `'digital-doc'` (new format support via Docling)
6. **Everything else** → `'unsupported'`

**Estimated effort**: 3h

### B.2 — PDF scan detection heuristic

For PDF classification, implement a lightweight pre-check:

- Use existing `pdf-parse` to extract text from first 3 pages
- Compute text density: `extractedChars / pageCount`
- Threshold: if density < 100 chars/page → likely scanned → `'scanned-doc'`
- If density >= 100 → `'digital-doc'`
- Store classification result in `indexing_metadata` for diagnostics

This avoids sending every PDF through OCR (which is expensive) when most
digital PDFs extract text perfectly fine.

**Estimated effort**: 2h

---

## Phase C — Pipeline Integration

> **Goal**: Wire the classifier and Docling bridge into the indexing pipeline
> so rich documents produce structured Markdown before chunking.

### C.1 — Update indexing pipeline extraction step

Modify `indexingPipeline.ts` `_indexFile()`:

1. Before extraction, classify the file via `IDocumentClassifier`
2. Route based on classification:
   - `'text'` → existing `readFile()` path (unchanged)
   - `'canvas'` → existing `chunkPage()` path (unchanged)
   - `'digital-doc'` → `IDocumentExtractionService.extractDocument(path, { ocr: false })`
   - `'scanned-doc'` → `IDocumentExtractionService.extractDocument(path, { ocr: true })`
   - `'image'` → `IDocumentExtractionService.extractDocument(path, { ocr: true })`
   - `'unsupported'` → skip with warning
3. Docling returns Markdown → store as `language: 'markdown'` so the chunker
   uses `_chunkMarkdown()` instead of `_chunkPlainText()`
4. Record pipeline type in `IndexingSourceResult` for observability

**Estimated effort**: 4h

### C.2 — Extended format support

With Docling handling extraction, add newly supported extensions to
`RICH_DOCUMENT_EXTENSIONS` in `indexingPipeline.ts`:

- `.pptx` — PowerPoint (not currently supported)
- `.ppt` — Legacy PowerPoint (if Docling supports it)
- `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp` — Images (OCR)
- `.epub` — E-books (if Docling supports it)

Update `INDEXABLE_EXTENSIONS` accordingly.

**Estimated effort**: 1h

### C.3 — Batch processing optimization

For initial workspace indexing with many rich documents:

- Group documents by classification
- Send digital docs as a batch to Docling (fewer Python round-trips)
- Process scanned docs individually (OCR is memory-intensive)
- Report per-file progress to the Indexing Log

**Estimated effort**: 2h

---

## Phase D — Content-Aware Chunking Improvements

> **Goal**: Improve the chunker to take better advantage of Docling's
> structured Markdown output.

### D.1 — Table-aware chunk boundaries

Currently, the Markdown chunker splits at headings and size limits. A large
Markdown table can be split mid-row. Add logic to:

- Detect Markdown table blocks (lines starting with `|`)
- Keep entire tables in a single chunk when possible (up to 2× max chunk size)
- If a table exceeds 2× max, split at row boundaries (never mid-row)
- Prefix split table chunks with the table header row for context

**Estimated effort**: 3h

### D.2 — Code block integrity

Docling detects code blocks and outputs them as fenced Markdown (` ``` `).
Add logic to:

- Detect fenced code blocks in Markdown
- Keep entire code blocks in a single chunk when possible
- If a code block exceeds max chunk size, split at blank lines within the block
- Preserve the language tag and fence markers in each split chunk

**Estimated effort**: 2h

### D.3 — Structural context from Docling output

Docling's Markdown output preserves heading hierarchy. Improve the
`contextPrefix` generation to include parent headings:

- Current: `[Source: "paper.pdf" | Section: "3.2 Results"]`
- Improved: `[Source: "paper.pdf" | Section: "3. Methods > 3.2 Results"]`

Track a heading stack as the chunker processes the Markdown. When entering a
new section, build a breadcrumb from the stack.

**Estimated effort**: 2h

---

## Phase E — Fallback & Resilience

> **Goal**: Ensure the system works when Docling is unavailable and handles
> errors gracefully.

### E.1 — Graceful fallback to legacy extractors

When Docling is unavailable (Python not installed, package not installed,
models not downloaded, service crashed):

- Route rich documents through existing `documentExtractor.cjs`
- Log a warning per session (not per file) to avoid spam
- Show a non-blocking notification: "Install Docling for better document
  indexing. Run: pip install docling"
- Store `pipeline: 'legacy'` in indexing metadata

**Estimated effort**: 2h

### E.2 — Per-document error handling

When Docling fails on a specific document but the service is running:

- Catch the error and retry with legacy extractor for that document
- Record the failure and fallback in `IndexingSourceResult`
- Continue processing remaining documents (don't fail the batch)

**Estimated effort**: 2h

### E.3 — Docling service lifecycle management

Handle edge cases in the Python service lifecycle:

- Service process dies unexpectedly → detect via health check, restart once
- Port conflict on startup → try next available port
- Model download interrupted → detect incomplete models, re-trigger download
- App exit → graceful shutdown of Python process (SIGTERM, then SIGKILL after 5s)
- Multiple Parallx windows → share a single Docling service instance via port file

**Estimated effort**: 3h

---

## Phase F — Observability & User Feedback

> **Goal**: Give the user visibility into the ingestion pipeline and its
> quality.

### F.1 — Indexing Log enhancements

Extend the Indexing Log built-in to show:

- **Pipeline column**: Which pipeline processed each file (`Docling` / `Docling+OCR` / `Legacy` / `Text`)
- **Extraction time**: How long the extraction step took (separate from embedding time)
- **Quality indicators**: Tables found, pages processed, OCR pages
- **Warnings**: Files that fell back to legacy, files that failed extraction

**Estimated effort**: 3h

### F.2 — Docling status in status bar

Add a status bar indicator:

- Green: Docling available and healthy
- Yellow: Docling available but models downloading
- Gray: Docling not installed (click to see installation instructions)
- Red: Docling service error (click to see diagnostics)

**Estimated effort**: 2h

### F.3 — Installation guide command

Add a command `Parallx: Install Docling` that:

- Detects current Python version and pip availability
- Shows a step-by-step guide in a panel or notification
- Optionally runs `pip install docling` with user confirmation
- Verifies installation and triggers model download
- Reports success/failure

**Estimated effort**: 2h

---

## Migration & Backward Compatibility

### Existing indexes are preserved

No migration is needed for existing indexed content. When Docling becomes
available, rich documents will be re-indexed on the next incremental pass
(content hash will differ because Markdown output ≠ old plain text output).

### Re-index trigger

After Docling is first installed and models are ready, the system should:

1. Detect that Docling is newly available
2. Mark all rich-document entries in `indexing_metadata` as stale
3. Trigger a background re-index for those documents
4. Notify the user: "Docling is ready. Re-indexing documents for better quality."

### Legacy extractors remain

`electron/documentExtractor.cjs` is not deleted. It becomes the fallback path.
All existing extraction tests continue to pass. The fallback is always available.

### Configuration

No new user-facing settings are required. Docling is used automatically when
available. The document classifier runs internally. The user doesn't need to
know or care about pipeline routing — they just get better results.

Future consideration: an advanced setting to force legacy extraction for
specific files or disable OCR for performance-sensitive workspaces.

---

## Task Tracker

| Task | Description | Est. | Depends On | Status |
|------|-------------|------|------------|--------|
| **A.1** | Python wrapper package (FastAPI + Docling) | 4h | — | ✅ |
| **A.2** | Electron bridge module (subprocess management) | 4h | A.1 | ✅ |
| **A.3** | IPC integration (main.cjs channels) | 2h | A.2 | ✅ |
| **A.4** | Renderer-side service interface | 2h | A.3 | ✅ |
| **B.1** | Document classifier service | 3h | — | ✅ |
| **B.2** | PDF scan detection heuristic | 2h | B.1 | ✅ |
| **C.1** | Update indexing pipeline extraction step | 4h | A.4, B.1 | ✅ |
| **C.2** | Extended format support (PPTX, images, etc.) | 1h | C.1 | ✅ |
| **C.3** | Batch processing optimization | 2h | C.1 | ✅ |
| **D.1** | Table-aware chunk boundaries | 3h | C.1 | ✅ |
| **D.2** | Code block integrity in chunker | 2h | C.1 | ✅ |
| **D.3** | Structural context breadcrumbs | 2h | C.1 | ✅ |
| **E.1** | Graceful fallback to legacy extractors | 2h | C.1 | ✅ |
| **E.2** | Per-document error handling | 2h | E.1 | ✅ |
| **E.3** | Docling service lifecycle management | 3h | A.2 | ✅ |
| **F.1** | Indexing Log enhancements | 3h | C.1 | ✅ |
| **F.2** | Docling status in status bar | 2h | A.2 | ✅ |
| **F.3** | Installation guide command | 2h | A.2 | ✅ |

**Total estimated: ~43 hours across 18 tasks**

---

## Verification Checklist

### Phase A
- [ ] Docling FastAPI service starts and responds to `/health`
- [ ] `POST /convert` with a digital PDF returns structured Markdown
- [ ] `POST /convert` with `ocr: true` on a scanned PDF returns OCR'd Markdown
- [ ] Electron bridge detects Python availability and Docling installation
- [ ] Bridge starts/stops the Python service cleanly on app lifecycle
- [ ] IPC channels work end-to-end (renderer → main → bridge → Docling → back)
- [ ] Service interface is registered in DI and accessible from pipeline

### Phase B
- [ ] Text files classified as `'text'` — never sent to Docling
- [ ] Digital PDFs classified as `'digital-doc'`
- [ ] Scanned PDFs (low text density) classified as `'scanned-doc'`
- [ ] Images classified as `'image'`
- [ ] Unknown extensions classified as `'unsupported'`

### Phase C
- [ ] Digital PDF indexed through Docling → Markdown → heading-aware chunks
- [ ] Scanned PDF indexed through Docling + OCR → Markdown → chunks
- [ ] PPTX files now indexable (new format)
- [ ] Images now indexable via OCR (new capability)
- [ ] Pipeline type recorded in IndexingSourceResult
- [ ] Batch processing works for multi-document workspace indexing

### Phase D
- [ ] Markdown tables stay in a single chunk (up to 2× max size)
- [ ] Oversized tables split at row boundaries with header repeated
- [ ] Code blocks stay in a single chunk (up to max size)
- [ ] Context prefix includes heading breadcrumb (parent > child)

### Phase E
- [ ] If Docling unavailable, system falls back to legacy extractors silently
- [ ] If Docling fails on one file, that file uses legacy, others continue
- [ ] Notification shown once per session suggesting Docling installation
- [ ] Service restarts after unexpected crash
- [ ] Graceful shutdown on app exit (no orphan Python processes)

### Phase F
- [ ] Indexing Log shows pipeline type per file
- [ ] Indexing Log shows extraction time and quality indicators
- [ ] Status bar shows Docling availability
- [ ] `Parallx: Install Docling` command works end-to-end

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Python not installed on user's machine | High | Graceful fallback to legacy extractors. Clear installation guide. Status bar indicator. |
| Docling models are large (~1 GB) and first download is slow | Medium | Background download with progress reporting. Don't block indexing while downloading — use legacy extractors until ready. |
| Docling extraction is slow for large PDFs (ML inference per page) | Medium | Background processing with progress. Batch optimization. Consider caching extracted Markdown alongside source file. |
| Python service process management complexity (ports, crashes, shutdown) | Medium | Health check polling. Automatic restart (once). Port file for sharing across windows. SIGTERM/SIGKILL shutdown sequence. |
| Docling output format changes between versions | Low | Pin Docling version in requirements.txt. Markdown output is stable across versions. |
| Scanned PDF OCR quality varies by document quality | Low | OCR is best-effort. Fallback to legacy if OCR produces worse results than expected. User can see diagnostics in Indexing Log. |
| Memory usage: Docling + Ollama + Electron all running simultaneously | Medium | Docling service is idle when not indexing — low baseline memory. Consider starting/stopping service on demand rather than keeping it persistent. |
| Security: Python subprocess with file path access | Low | Binds to localhost only. Validates file paths against workspace root. No network exposure. |
