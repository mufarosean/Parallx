# Milestone 75 - EPUB Reader Page Frame

> **Status:** Implemented.

## Why

The rendered EPUB reader had ebook-like structure, but the page surface was not
visually clear. Zoom also only changed text size inside a fixed-width reader,
which made zoom feel cramped instead of changing the reading measure.

## What Changed

- Added a bordered page surface around EPUB chapter content.
- Added a subtle page shadow so the reading area separates from the workbench
  background.
- Tied EPUB page width to reader zoom, so zooming expands or contracts the page
  surface as well as text size.
- Kept the width responsive so it still respects the available editor viewport.

## Guardrails

- No changes to EPUB extraction, indexing, embeddings, Ollama, or AI routing.
- The change is limited to the built-in EPUB editor presentation layer.

## Verification

- `npx.cmd tsc --noEmit`
- `node scripts/build.mjs`
- `git diff --check`
