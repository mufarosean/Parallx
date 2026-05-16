# Milestone 74 - Rendered EPUB Reader

> **Status:** Implemented.

## Why

M73 made EPUBs openable and indexable, but the editor showed only extracted
plain text. That was useful for the embedding pipeline, but not enough for a
reader: EPUBs are packaged XHTML/CSS/image documents, so the editor should look
more like an ebook surface while keeping the text extractor simple and safe.

## What Changed

- Added a dedicated `document.readEpub` bridge for rendered reader data.
- Kept `document.extractText` as the indexing and chat read path.
- Reused the EPUB OPF/spine parser so rendered chapters follow the same reading
  order as indexed text.
- Sanitized chapter XHTML by allowing only safe structural tags and attributes.
- Inlined local EPUB images as `data:image/*` URLs with a small resource cap.
- Removed scripts, styles, nav, event attributes, external URLs, and unsafe
  link targets before rendering.
- Updated the EPUB editor to render chapter HTML with a chapter navigation rail
  and ebook-oriented typography.

## Guardrails

- No changes to embeddings, vector search, Ollama, or model loading.
- No new runtime dependency.
- EPUB HTML is sanitized in the Electron document bridge before the renderer
  inserts it.
- The reader is still intentionally lighter than a full Readium/Foliate-class
  engine: it preserves structure and images, but does not yet apply arbitrary
  book CSS or implement paginated reflow.

## Verification

- `node --check electron/documentExtractor.cjs`
- `npx.cmd tsc --noEmit`
- `npx.cmd vitest run tests/unit/epubDocumentExtractor.test.ts tests/unit/editorPersistence.test.ts tests/unit/indexingPipeline.test.ts`
- `node scripts/build.mjs`
- `git diff --check`
