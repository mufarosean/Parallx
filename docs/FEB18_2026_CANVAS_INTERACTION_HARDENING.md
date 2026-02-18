# Canvas Interaction Hardening — February 18, 2026

This document captures the full implementation batch completed for Canvas interaction consistency, column behavior hardening, and callout icon editing.

## Goals Covered

- Enforce universal, structure-first block behavior across text and non-text block types.
- Eliminate drag/drop target ambiguity in columns for callout/image/math/video and similar node-views.
- Fix visual quality issues for horizontal drop guides and image sizing inside columns.
- Make callout icons user-editable from the block itself.
- Make slash-created bookmark/video/audio/file blocks complete end-to-end (menu-driven upload/link flows) instead of placeholder/no-op behavior.
- Add targeted E2E coverage for all newly hardened behaviors.

## Code Changes

### 1) Centralized capability registry

- Added `src/built-in/canvas/config/blockCapabilities.ts`.
- Centralized:
  - `COLUMN_CONTENT_EXPRESSION`
  - `DRAG_HANDLE_CUSTOM_NODE_TYPES`
- Replaced duplicated hard-coded node lists in:
  - `src/built-in/canvas/extensions/columnNodes.ts`
  - `src/built-in/canvas/config/editorExtensions.ts`

### 2) Column mutation correctness and non-destructive normalization

Updated `src/built-in/canvas/mutations/blockMutations.ts`:

- `normalizeColumnListAfterMutation` now performs structural normalization only:
  - remove invalid/empty container states
  - dissolve only when one column remains
  - reset widths for valid multi-column states
- Removed meaningful-content pruning that caused over-eager collapse in multi-column layouts.
- Hardened mapped-position handling (`tr.mapping.map(..., 1)` where appropriate) during move/extract flows.
- Hardened drag source deletion path:
  - resolves source from initial doc snapshot
  - preserves behavior when mapping shifts
  - conservative fallback for 2-column cleanup when one empty sibling remains

### 3) Column drop target resolution and indicator behavior

Updated `src/built-in/canvas/plugins/columnDropPlugin.ts`:

- Added robust target resolution helpers:
  - `resolveBlockTarget(...)`
  - `resolveNearestBlockInColumn(...)`
- `findTarget(...)` now prioritizes in-column nearest block resolution for non-text and nested node-view DOM.
- Added dragover re-resolution when initial target is `columnList` but pointer is inside a concrete column.
- Prevented premature target-detection aborts on unmapped inner DOM during walk-up.
- Horizontal drop guide geometry now distinguishes top-level vs nested:
  - top-level unsplit block: guide spans target block width
  - nested page container (column/callout/details/blockquote): guide spans local container width

### 4) Non-text drag ownership policy for math block

Updated `src/built-in/canvas/extensions/mathBlockNode.ts`:

- Enforced handle-only drag policy:
  - `dom.draggable = false`
  - body `dragstart` prevented/stopped

### 5) Callout icon editing from block UI

Updated `src/built-in/canvas/extensions/calloutNode.ts`:

- Added clickable callout icon affordance (`title="Change icon"`).
- Implemented in-node icon picker using existing icon primitives:
  - searchable icon grid
  - uses `PAGE_ICON_IDS` + `svgIcon(...)`
  - updates callout `emoji` attr via transaction
  - closes on outside click / Escape / selection
- Added cleanup in `destroy()` for picker listeners/DOM.

### 6) Visual styling polish

Updated `src/built-in/canvas/canvas.css`:

- Image sizing fix inside columns:
  - removed over-wide image sizing (`calc(100% + 12px)`)
  - normalized to `width: 100%; max-width: 100%`
- Callout icon affordance styling:
  - pointer cursor
  - subtle hover background

### 7) Slash media/bookmark insertion completeness

Updated `src/built-in/canvas/menus/slashMenuItems.ts` and added popup controllers:

- Added `src/built-in/canvas/menus/mediaInsertPopup.ts`.
  - Used by slash `Video`, `Audio`, and `File` actions.
  - Presents Upload / Embed link tabs (same insertion model as image popup).
  - Upload path uses Electron file dialog + base64 read to produce deterministic data URLs.
  - Link path inserts direct URL-backed embeds/attachments.
  - Cancel path restores the slash paragraph to a plain paragraph.
- Added `src/built-in/canvas/menus/bookmarkInsertPopup.ts`.
  - Used by slash `Bookmark` action.
  - Prompts for URL with explicit `Create bookmark` action.
  - Inserts a bookmark card node with deterministic attrs (`url`, derived `title`, etc.).
  - Cancel path restores the slash paragraph to a plain paragraph.
- Added popup styles in `src/built-in/canvas/canvas.css` for both new popup types.

### 8) Versatile video embed parity (provider-aware)

Updated `src/built-in/canvas/extensions/mediaNodes.ts` + `canvas.css`:

- Video node view now resolves URL type at render time:
  - **Direct file URLs** (`.mp4`, `.webm`, `.ogg`, `.mov`, etc.) render native `<video controls>`
  - **Provider links** render responsive iframe embeds
- Added provider-aware embed transforms for major video platforms:
  - YouTube (`watch`, `youtu.be`, `shorts`) → `youtube-nocookie` embed
  - Vimeo, Dailymotion, Loom, Wistia
  - Fallback to generic iframe for other valid HTTP(S) video-host links
- Added responsive iframe shell styles (`.canvas-video-embed`, `.canvas-video-embed-frame`) to match block layout behavior.
- Extended slash insertion E2E assertion in `tests/e2e/12-columns.spec.ts` to verify pasted YouTube links render as iframe embeds (`youtube-nocookie`) instead of being treated as file URLs.

## Test Additions and Updates

### `tests/e2e/11-block-handles.spec.ts`

- Added: `callout icon is clickable and updates icon selection`
  - verifies icon click opens picker
  - verifies icon selection mutates callout `attrs.emoji`

### `tests/e2e/12-columns.spec.ts`

Added/updated for robustness and real usage:

- Explicit cursor placement for keyboard-driven movement/duplicate scenarios.
- Added image-focused regressions:
  - image bounds remain inside column
  - image can be turned into nested columns
  - backspace behavior with image+empty column combinations
- Added math policy regression:
  - body dragstart blocked; handle path remains authoritative

### `tests/e2e/13-column-drag-drop.spec.ts`

Added/updated:

- New image move-in and move-out drag/drop regressions.
- New regression: below-drop indicator and insertion under non-text blocks inside columns (`callout`, `image`, `mathBlock`, `video`).
- New guide-geometry assertions:
  - top-level above/below horizontal guide width matches target block width.

### Slash insertion E2E hardening

Updated `tests/e2e/12-columns.spec.ts`:

- Replaced placeholder-only assertion with true end-to-end slash coverage:
  - slash item selection opens the correct insert popup (`bookmark` vs `media/file`)
  - URL submission creates the expected block type
  - inserted node attrs reflect submitted links (`bookmark.url`, `video/audio.src`, `fileAttachment.src/filename`)

### `tests/e2e/14-column-integration.spec.ts`

- Aligned dissolve expectation with structural-only normalization contract.

## Validation Runs During This Batch

Validated repeatedly with focused runs and full-spec reruns across touched behavior:

- `npm run build` (multiple passes)
- `npm run test:unit` and targeted unit subsets
- `npm run test:e2e -- tests/e2e/11-block-handles.spec.ts --grep "callout icon is clickable and updates icon selection"`
- `npm run test:e2e -- tests/e2e/11-block-handles.spec.ts --grep "paragraph.*callout"`
- `npm run test:e2e -- tests/e2e/12-columns.spec.ts` (targeted grep runs for keyboard/image regressions)
- `npm run test:e2e -- tests/e2e/13-column-drag-drop.spec.ts`
- `npm run test:e2e -- tests/e2e/12-columns.spec.ts --grep "slash menu opens media/bookmark insert menus and creates blocks from links"`
- `npm run test:e2e -- tests/e2e/12-columns.spec.ts` (full suite)
- `npm run test:e2e -- tests/e2e/14-column-integration.spec.ts` (targeted expectations and consistency checks)
- Additional targeted reruns of `15`, `16`, and `17` interaction/arbitration paths as part of stabilization checks.

## User-Visible Outcomes

- Drag/drop below non-text blocks in columns now behaves like regular text blocks.
- Horizontal blue drop guide no longer overextends across full canvas for unsplit blocks.
- Image blocks respect column bounds and no longer visually overspill width.
- Backspace/remove in mixed image+empty column scenarios no longer cascades incorrectly.
- Math block body drag no longer triggers implicit duplicate/move side effects.
- Callout icon can now be changed directly from the callout block itself.
- Slash `Bookmark`, `Video`, `Audio`, and `File` now open completion popups and create actual usable blocks via upload/link flows instead of non-deterministic prompt/no-op behavior.

## Notes

- This batch intentionally preserves structural model rules and avoids block-type special-casing in core mutation paths.
- Any behavior updates are reflected via focused regressions to avoid reintroducing deterministic failures.
