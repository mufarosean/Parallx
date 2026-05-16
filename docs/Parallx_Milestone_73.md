# Milestone 73 - EPUB Reader and Indexing Support

> **Status:** Implemented.

## Why

Workspace files can already flow through Parallx's indexing pipeline, and M21
listed `.epub` as a rich document extension. The missing pieces were practical:
the fallback Electron extractor did not know how to unpack EPUB files, and the
workbench opened EPUBs through the generic text editor instead of a reader.

The goal for this pass was deliberately small: make EPUB files readable from
Explorer and make their text available to the existing chunking/indexing path
without changing the embedding model, Ollama behavior, or core AI settings.

## What Changed

- Added `.epub` to the Electron rich document extractor.
- Implemented a lightweight EPUB fallback extractor using the existing
  `adm-zip` dependency.
- Followed the EPUB OPF spine order so extracted text matches the intended
  reading order.
- Stripped EPUB XHTML to plain text before rendering or indexing.
- Added a built-in `EpubEditorInput` and `EpubEditorPane`.
- Registered `.epub` with the file editor resolver so Explorer opens EPUBs in
  the reader.
- Added EPUB deserialization so reopened workspaces restore the reader tab,
  scroll position, and text size.
- Updated tool descriptions so chat-facing file/knowledge tools mention EPUB
  support.

## Guardrails

- No changes to Ollama integration.
- No changes to embedding model selection, embedding generation, or vector
  store behavior.
- No changes to chat model routing or core AI settings.
- EPUB content is rendered as plain text via `textContent`; book HTML is not
  executed or injected into the DOM.

## Verification

- `node --check electron/documentExtractor.cjs`
- `npx.cmd tsc --noEmit`
- `npx.cmd vitest run tests/unit/editorPersistence.test.ts tests/unit/epubDocumentExtractor.test.ts tests/unit/indexingPipeline.test.ts`
- `node scripts/build.mjs`
- `git diff --check`

The renderer build passed with two pre-existing CSS warnings in
`src/built-in/canvas/properties/propertyBar.css`.
