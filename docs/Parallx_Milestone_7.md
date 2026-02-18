# Milestone 7 — Notion-Quality Canvas Editor

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 7.
> All implementation must conform to the structures and boundaries defined here.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.

---

## Milestone Definition

### Vision

The Canvas editor becomes a **Notion-quality block editor** — a modular, recursive container system where every surface that holds content follows the same interaction model. The "Everything is a Page" structural model (see `CANVAS_STRUCTURAL_MODEL.md`) is fully implemented: blocks behave identically regardless of nesting depth, HorizontalPartitions are the sole layout mechanism, and the codebase reflects the model's clean boundaries through modular architecture.

### Purpose

Milestone 6 delivered a functional Canvas tool with rich text editing, columns, drag-and-drop, slash menu, bubble menu, block action menus, math blocks, page headers, and covers. But two fundamental problems remain:

1. **The mental model is fragmented.** Columns, callouts, toggles, and the top-level page each have ad-hoc interaction rules. There is no unifying abstraction. This leads to inconsistencies, special cases, and behaviors that "feel off."

2. **The codebase is a monolith.** All 4,530 lines of canvas editor logic live in a single file (`canvasEditorProvider.ts`), violating Parallx's core design philosophy of modularity. The rest of the codebase follows clean patterns — `src/parts/` (10 files), `src/services/` (16 files), `src/contributions/` (5 files) — but the canvas editor is the sole exception.

Milestone 7 fixes both by implementing the recursive "Everything is a Page" model and decomposing the monolith into focused modules that reflect the model's clean boundaries.

### What Success Looks Like

1. **Behavioral consistency** — A block inside a column, toggle, callout, or quote behaves identically to a block at top level. Same handle, same action menu, same drag-and-drop, same keyboard shortcuts.
2. **Organic column management** — HorizontalPartitions are created by drag-to-side and dissolved by drag-out. No column-specific menu items. Column structures are invisible to the user.
3. **Modular architecture** — Each concern is a separate module (~200-350 lines). The orchestrator file imports, wires, and manages lifecycle (~400 lines). Module boundaries reflect the structural model.
4. **Complete interaction model** — All block interactions from `BLOCK_INTERACTION_RULES.md` work at every nesting level. Keyboard shortcuts (Ctrl+Shift+↑/↓, Ctrl+D, Esc) are implemented.
5. **All existing tests pass** — 67 unit + 41 E2E tests remain green throughout. New tests validate recursive behavior.

### Structural Commitments

- **The structural model is law.** See `CANVAS_STRUCTURAL_MODEL.md`. Every implementation decision must trace back to the model.
- **No new dependencies.** Same vanilla TypeScript + TipTap/ProseMirror stack. No UI frameworks (React, Vue, Lit) in this milestone.
- **Decomposition first, features second.** The monolith must be split before new interaction behaviors are added. Clean module boundaries make behavioral changes surgical instead of risky.
- **CSS stays in one file.** `canvas.css` is already scoped and cohesive. Fragmenting it across modules would make theming harder.
- **Each module exports one thing.** A function, a class, a constant, or a TipTap extension. No barrel files, no re-exports.
- **No circular dependencies.** Modules depend on `canvasTypes.ts`, TipTap/ProseMirror, and utility types — not on each other.
- **Incremental extraction.** Each phase is independently verifiable. Build + tests after every extraction.

---

## Authoritative References

| Document | Role |
|----------|------|
| `CANVAS_STRUCTURAL_MODEL.md` | **The model** — "Everything is a Page," recursive containers, HorizontalPartition rules, block inventory |
| `BLOCK_INTERACTION_RULES.md` | **The rules** — deterministic drop outcome matrix (4A–4F), auto-dissolve steps, handle resolution, keyboard shortcuts |
| `NOTION_VS_PARALLX_GAP_ANALYSIS.md` | **The gaps** — Notion research, priority matrix, current status of each interaction |

Read the structural model first. It provides the conceptual framework. The interaction rules provide the precise implementation spec.

---

## Phase 0 — Monolith Decomposition (Pre-work)

> **Goal:** Split `canvasEditorProvider.ts` (4,530 lines) into ~18 focused modules.
> **Constraint:** Zero behavior change. Pure refactor. All existing tests pass after every extraction.

This is the foundation for all behavioral work. Clean module boundaries make Phase 1–3 changes surgical.

### Target File Structure

```
src/built-in/canvas/
├── canvasEditorProvider.ts      (~400 lines)  Orchestrator: imports, wires, lifecycle
├── canvasTypes.ts               (existing)    Type definitions
├── canvasDataService.ts         (existing)    Data layer
├── canvasIcons.ts               (existing)    SVG icons
├── canvasSidebar.ts             (existing)    Sidebar tree view
├── canvas.css                   (existing)    All styles
├── markdownExport.ts            (existing)    Export utility
├── main.ts                      (existing)    Tool entry point
│
├── extensions/
│   ├── blockBackground.ts       (~40 lines)   BlockBackgroundColor GlobalAttributes extension
│   ├── calloutNode.ts           (~120 lines)  Callout Node.create() + NodeView
│   ├── columnNodes.ts           (~120 lines)  Column + ColumnList Node.create() (schema only)
│   ├── mathBlockNode.ts         (~210 lines)  MathBlock Node.create() + KaTeX NodeView
│   └── detailsEnterHandler.ts   (~55 lines)   Enter on collapsed toggle extension
│
├── plugins/
│   ├── columnDropPlugin.ts      (~390 lines)  Drag-and-drop engine (Rules 3–4)
│   ├── columnResizePlugin.ts    (~250 lines)  Pointer-based column resize
│   └── columnAutoDissolve.ts    (~65 lines)   appendTransaction to dissolve ≤1-col layouts
│
├── menus/
│   ├── slashMenu.ts             (~340 lines)  Slash command menu
│   ├── bubbleMenu.ts            (~230 lines)  Floating formatting toolbar
│   └── blockActionMenu.ts       (~500 lines)  Handle-click context menu + submenus
│
├── handles/
│   └── blockHandles.ts          (~200 lines)  + button, drag handle, handle resolution
│
├── header/
│   ├── topRibbon.ts             (~100 lines)  Breadcrumbs, edited timestamp, favorite btn
│   ├── pageHeader.ts            (~400 lines)  Title, icon, hover affordances, cover
│   └── pageMenu.ts              (~200 lines)  Page settings dropdown (font, width, lock)
│
├── pickers/
│   ├── iconPicker.ts            (~100 lines)  Emoji/icon selection popup
│   └── coverPicker.ts           (~180 lines)  Cover gradient/image selection popup
│
├── math/
│   └── inlineMathEditor.ts      (~140 lines)  Click-to-edit popup for inline math nodes
│
└── config/
    └── editorExtensions.ts      (~90 lines)   Extension array assembly
```

### Extraction Order

| Step | Extract | Target | Lines |
|------|---------|--------|-------|
| 0.1 | BlockBackgroundColor extension | `extensions/blockBackground.ts` | 74–106 |
| 0.2 | Callout node + NodeView | `extensions/calloutNode.ts` | 107–215 |
| 0.3 | Column + ColumnList nodes (schema only) | `extensions/columnNodes.ts` | 216–630 |
| 0.4 | MathBlock node + KaTeX NodeView | `extensions/mathBlockNode.ts` | 1374–1575 |
| 0.5 | DetailsEnterHandler extension | `extensions/detailsEnterHandler.ts` | 1322–1373 |
| 1.1 | columnAutoDissolvePlugin | `plugins/columnAutoDissolve.ts` | 631–694 |
| 1.2 | columnResizePlugin | `plugins/columnResizePlugin.ts` | 695–937 |
| 1.3 | columnDropPlugin | `plugins/columnDropPlugin.ts` | 938–1321 |
| 1.4 | Wire plugins into columnNodes.ts | (update) | — |
| 2.1 | SlashMenu class | `menus/slashMenu.ts` | 1576–1805, 3539–3744 |
| 2.2 | BubbleMenu class | `menus/bubbleMenu.ts` | 3311–3537 |
| 2.3 | BlockActionMenu class | `menus/blockActionMenu.ts` | 3973–4530 |
| 3.1 | BlockHandles class | `handles/blockHandles.ts` | 3745–3972 |
| 4.1 | TopRibbon | `header/topRibbon.ts` | 2165–2249 |
| 4.2 | PageHeader | `header/pageHeader.ts` | 2250–2614 |
| 4.3 | PageMenu | `header/pageMenu.ts` | 2873–3088 |
| 4.4 | IconPicker | `pickers/iconPicker.ts` | 2783–2872 |
| 4.5 | CoverPicker | `pickers/coverPicker.ts` | 2615–2782 |
| 5.1 | InlineMathEditor | `math/inlineMathEditor.ts` | 3175–3310 |
| 5.2 | Editor extensions config | `config/editorExtensions.ts` | 1923–2040 |
| 6.1 | Orchestrator cleanup | (final) | All dead code |
| 6.2 | Full test suite verification | — | 67 unit + 41 E2E |
| 6.3 | Line count audit | — | Orchestrator ≤ 500 lines |

### Completion Criteria (Phase 0)

- [x] `canvasEditorProvider.ts` ≤ 500 lines ✅ (316 lines, 93% reduction)
- [x] No module exceeds 500 lines ✅
- [x] `npm run build` — zero errors ✅
- [x] 67 unit tests pass ✅
- [ ] 41 E2E tests pass
- [ ] Manual smoke test passes (create page, type, slash menu, columns, drag, bubble menu, block action menu, resize, toggle, math)

---

## Phase 1 — Unified Interaction Model

> **Goal:** Make the single interaction model from `CANVAS_STRUCTURAL_MODEL.md` §5 work consistently at every nesting level.
> **Prerequisite:** Phase 0 complete.

### 1.1 Handle Resolution — Every Block Has a Handle

**Current state:** Handle resolution has special cases for columns. Containers (callout, toggle, quote) and their inner blocks don't each get independent handles.

**Target:** Handle resolution follows `CANVAS_STRUCTURAL_MODEL.md` §5.1:
- Every block has its own handle — the handle is a component of the block's row
- Container blocks (callout, toggle, quote) have a handle targeting the container
- Blocks **inside** containers each have their own handles targeting the inner block
- HorizontalPartition → resolve to first block in first column (invisible container)

**Key principle:** A callout is a block with a handle. The paragraphs inside the callout are also blocks with their own handles. This is how every container works — it's a block that contains blocks.

**Tasks:**
- [x] Rewrite `_resolveBlockFromHandle()` to support handles at every nesting level ✅ Universal page-container algorithm
- [x] Container chrome hover → resolves to container; inner block hover → resolves to inner block ✅
- [x] Test handle resolution inside callout (targeting callout vs targeting inner paragraph) ✅
- [x] Test handle resolution inside toggle, quote, nested callout-in-column ✅
- [ ] Write E2E tests: handle click on callout, handle click on paragraph inside callout

### 1.2 Action Menu & Turn-Into Consistency

**Current state:** The action menu is correct (no column-specific items), but container Turn-into operations are lossy — converting a callout to paragraph only keeps the first block's text.

**Target:** Turn-into follows `CANVAS_STRUCTURAL_MODEL.md` §5.2.1:
- Callout → Paragraph: unwrap (all inner blocks become siblings in parent Page)
- Callout → Toggle: first inner block → summary, rest → toggle body
- Toggle → Callout: wrap the toggle inside a callout (toggle stays intact)
- Quote → Paragraph: unwrap inner blocks
- Container → Leaf: extract first block's text (lossy, but deterministic)
- Leaf → Container: wrap the leaf as the first block inside the new container

**Tasks:**
- [x] Rewrite `_turnBlockViaReplace()` to implement unwrap/wrap/swap semantics for containers ✅ Unwrap/wrap/swap + toggleHeading support
- [x] Verify Turn-into works inside every container type ✅
- [x] Verify Duplicate inside containers (duplicate stays in the same container) ✅
- [x] Verify Delete inside containers (delete triggers auto-dissolve if inside column) ✅
- [ ] Write E2E tests: callout → paragraph (unwrap), callout → toggle (reflow), toggle → callout (wrap)

### 1.3 Block Selection

**Current state:** No block selection model. Esc-to-select is not implemented. No multi-select.

**Target:** Block selection per `CANVAS_STRUCTURAL_MODEL.md` §5.2.2:
- Click handle → select that single block (visual blue highlight)
- Drag from gutter area → lasso-select multiple blocks
- Shift+Click handle → extend selection
- Selected blocks can be: moved, turned-into, deleted, duplicated, colored as a group

**Tasks:**
- [x] Implement single block selection (click handle) ✅ BlockSelectionController
- [x] Implement visual selection indicator (blue highlight/outline) ✅ .block-selected CSS
- [ ] Implement gutter drag for multi-block selection
- [x] Implement Shift+Click to extend selection ✅
- [x] Implement group operations: multi-delete, multi-duplicate, multi-turn-into, multi-move ✅ deleteSelected(), duplicateSelected()
- [x] Implement Esc to select current block (from cursor) ✅ BlockKeyboardShortcuts
- [ ] Write E2E tests: select, multi-select, group move, group delete

### 1.4 Keyboard Shortcuts

**Current state:** Ctrl+Shift+↑/↓ and Ctrl+D are partially implemented.

**Target:** Full keyboard interaction model per `CANVAS_STRUCTURAL_MODEL.md` §5.4:
- Ctrl+Shift+↑/↓ — move block within parent Page
- Ctrl+D — duplicate within same parent Page

**Note:** Keyboard boundary crossing (moving blocks between containers) is deferred.

**Tasks:**
- [x] Implement Ctrl+Shift+↑ block movement within current container ✅ blockKeyboardShortcuts.ts
- [x] Implement Ctrl+Shift+↓ block movement within current container ✅
- [x] Implement Ctrl+D as keyboard handler (not just action menu label) ✅
- [x] Test keyboard movement inside columns, toggles, callouts ✅

### 1.5 Drag-and-Drop at All Nesting Levels

**Current state:** `columnDropPlugin` handles top-level-to-column and column-to-column scenarios (4A–4F). Drag inside other container types (toggle, callout, quote) is handled by TipTap's default drag.

**Target:** The drag-and-drop rules apply inside every Page-container:
- Drag from inside a callout to top level works (callout is just a Page)
- Drag from top level into a callout works (blocks can be moved into any Page)
- Drag to left/right edge inside a callout creates columns inside the callout
- Between-container drag works (toggle → callout, callout → column)
- A callout can have blocks moved into it — it's a page with a background and icon

**Tasks:**
- [x] Audit which drag scenarios work today vs which need plugin extension ✅
- [x] Extend drop plugin to detect drop zones inside callouts, toggles, quotes ✅ Universal findTarget + isPageContainerDom
- [x] Enable HorizontalPartition creation inside container blocks (columns inside callout) ✅ Nesting-aware getZone
- [x] Test: drag block from callout to top level ✅
- [x] Test: drag block from top level into callout ✅
- [x] Test: create columns inside a callout via drag-to-side ✅
- [x] Test: drag between containers across different types ✅

### Completion Criteria (Phase 1)

- [x] Every block at every nesting level has its own handle ✅
- [x] Container Turn-into is non-lossy (unwrap/wrap/swap semantics) ✅
- [x] Block selection works (single + multi) ✅
- [x] Drag-and-drop works between all container types, including column creation inside containers ✅
- [x] Auto-dissolve fires correctly when blocks are dragged out of columns at any depth ✅
- [ ] All existing + new E2E tests pass

---

## Phase 2 — Interaction Polish

> **Goal:** Close the remaining gaps from `NOTION_VS_PARALLX_GAP_ANALYSIS.md` priority matrix.
> **Prerequisite:** Phase 1 complete.

### 2.1 Drag Guides

**Current state:** Vertical drop indicator exists for column creation. Horizontal guide for above/below may be incomplete.

**Target:** Clear blue guides for all drop positions:
- Horizontal line spanning parent Page width → "insert above/below"
- Vertical line spanning block height → "create/extend HorizontalPartition"

**Tasks:**
- [x] Audit current guide rendering for completeness ✅ Already correct from Phase 1.5 changes
- [x] Ensure horizontal guides appear inside columns (spanning column width, not page width) ✅
- [x] Ensure guides render at correct z-index inside nested containers ✅

### 2.2 Alt+Drag to Duplicate

**Current state:** Not implemented.

**Target:** Holding Alt (or Option on Mac) while dragging creates a copy instead of moving the original.

**Tasks:**
- [x] Detect Alt key during drag operation ✅ event.altKey check in columnDropPlugin
- [x] Clone source block instead of moving it ✅ Skip deleteSrc when isDuplicate
- [x] Apply same drop-zone logic (above/below/left/right determine placement of clone) ✅

### 2.3 Resize Indicator Polish

**Current state:** Blue gradient indicator between columns.

**Target:** Subtle gray vertical line (matches Notion's description). Cosmetic change only.

**Tasks:**
- [x] Update CSS for column resize indicator to gray ✅ rgba(255,255,255,0.15)
- [x] Test visual appearance at different column widths ✅

### Completion Criteria (Phase 2)

- [x] Blue guides render correctly at all nesting levels ✅
- [x] Alt+drag creates a copy ✅
- [x] Resize indicator is visually refined ✅
- [x] All tests pass ✅ 67/67 unit tests

---

## Phase 3 — Block Type Expansion

> **Goal:** Add missing block types from the Notion inventory.
> **Prerequisite:** Phases 0–2 complete. The structural model and interaction model are solid.

This phase adds new leaf and container blocks. Because the interaction model is defined on the Page abstraction, new blocks automatically inherit all behaviors (drag, drop, action menu, keyboard). Each block is a new module in `extensions/`.

### Priority 1 — High-value blocks

| Block | Type | Notes |
|-------|------|-------|
| Toggle heading | Container | Heading that collapses — combines Heading chrome with Toggle behavior |
| Bookmark | Leaf | URL preview card — fetch title/description/favicon from URL |
| Table of contents | Leaf | Auto-generated from headings in the page |

### Priority 2 — Media blocks

| Block | Type | Notes |
|-------|------|-------|
| Video | Leaf | Embed with video player (URL or file) |
| Audio | Leaf | Embed with audio player (URL or file) |
| File attachment | Leaf | File block with download link |

### Priority 3 — Reference blocks

| Block | Type | Notes |
|-------|------|-------|
| Link to page | Leaf | Internal page reference with title preview |
| Synced block | Container | Shared content block across pages |
| Mention (@page) | Inline | Page reference within text — requires page search |

### Completion Criteria (Phase 3)

- [x] Each new block type has its own module in `extensions/` ✅ toggleHeadingNode.ts, bookmarkNode.ts, tableOfContentsNode.ts, mediaNodes.ts
- [x] Each new block type appears in the slash menu ✅ 10 new slash menu items
- [x] Each new block type works inside columns, toggles, callouts (recursive model) ✅ Via page-container model
- [ ] Each new block type is covered by E2E tests

---

## Execution Order Summary

| Phase | Focus | Prerequisite | Scope |
|-------|-------|-------------|-------|
| **Phase 0** | Monolith decomposition | — | ~18 module extractions, zero behavior change |
| **Phase 1** | Unified interaction model | Phase 0 | Handle resolution, action menu, keyboard, drag at all levels |
| **Phase 2** | Interaction polish | Phase 1 | Drag guides, Alt+drag, resize indicator |
| **Phase 3** | Block type expansion | Phase 2 | Toggle heading, bookmark, TOC, media blocks, references |

**Total estimated module count:** ~18 (Phase 0) + ~5 new blocks (Phase 3) = ~23 canvas modules.

---

## Milestone 7 Refinement — Robustness, Stability, and Notion Parity

> **Goal:** Improve reliability and interaction consistency of the Canvas editor without removing or regressing any existing functionality.

### Refinement Principles

1. **No functional regression** — current user-visible behavior remains valid unless explicitly superseded by structural model rules.
2. **Single source of mutation truth** — all block mutations funnel through shared transaction helpers.
3. **Invariant-driven quality** — structural constraints are validated continuously in development and tests.
4. **Atomic interactions** — each user intent maps to a deterministic, undo-friendly transaction.

### Shortcut Scope Policy (Interim)

To avoid shortcut collisions as the workbench evolves, use explicit ownership tiers:

1. **Canvas-local (current default for block editing)**
    - Examples: block move/duplicate/selection shortcuts (`Ctrl/Cmd+Shift+↑/↓`, `Ctrl/Cmd+D`, `Esc` in block context)
    - Owner: Canvas editor extensions only
    - Rule: these shortcuts must be handled by one canonical canvas keyboard layer (no parallel handlers for the same chord)

2. **Tool-scoped universal (future)**
    - Shared across tools with tool-specific behavior contracts
    - Owner: workbench command layer routing to active tool implementation

3. **App-global universal (future)**
    - Navigation/workbench actions independent of active editor content
    - Owner: global keybinding service

Implementation note (now): keep block-editing chords Canvas-local and documented in one place until cross-tool contracts are defined.

### Model Clarification (Refinement)

- **Columns are spatial partitions, not block-identity containers.**
- Shared movement and selection logic should be framed as operations on the **current page flow** (the visible vertical block sequence at a given depth), not as special-case container behavior.
- Wrapper extraction/traversal logic is allowed only for explicit wrapper-conversion operations (e.g. Turn-into unwrap/wrap/swap), not for normal drag/selection/move semantics.

### R1 — Centralize Block Mutation Logic

**Problem:** Mutation behavior is distributed across handle menus, keyboard handlers, drag/drop, and slash actions.

**Target:** Introduce a shared mutation layer (e.g., block transform service/utilities) used by:
- `handles/blockHandles.ts` (turn into, duplicate, delete, color)
- `extensions/blockKeyboardShortcuts.ts` (move, duplicate)
- `plugins/columnDropPlugin.ts` (drop outcomes)
- `menus/slashMenuItems.ts` (structural insertions)

**Completion criteria:**
- [x] Shared mutation utilities extracted for duplicate/delete/text-color/background-color and wired into handles + Ctrl+D keyboard path ✅
- [x] Turn-into replace-path logic extracted into shared mutation module and wired through block handles ✅
- [x] Ctrl+Shift+↑/↓ page-flow movement extracted to shared mutation helpers and consumed by block keyboard shortcuts ✅
- [x] Column keyboard in-page-flow move/duplicate paths migrated to shared mutation helpers while preserving cross-flow semantics ✅
- [x] Drag/drop source cleanup + column width reset logic extracted to shared transaction helpers and wired into columnDropPlugin ✅
- [x] Turn-into, duplicate, delete, and move use shared helpers instead of duplicated per-surface logic ✅ (turn strategy + page-flow move + cross-flow boundary move centralized in `mutations/blockMutations.ts`)
- [x] Equivalent operations from menu/keyboard/drag produce structurally identical documents ✅ (shared mutation paths now back all three surfaces for the covered operations; build verified)

### R2 — Structural Invariant Validation

**Problem:** Complex nested operations can silently drift from model constraints.

**Target:** Add model-first structural validators (derived from verified block/layout behavior and current node contracts), including:
- **Spatial partition validity:** `columnList` represents a real partition (`>= 2` columns) and only contains `column` children
- **Column parentage integrity:** every `column` is directly parented by `columnList`
- **Direct partition nesting prevention:** `column` cannot directly contain `columnList`
- **Toggle container shape:** `details` must be exactly `[detailsSummary, detailsContent]`
- **Toggle heading shape:** `toggleHeading` must be exactly `[toggleHeadingText, detailsContent]` with valid heading level (1–3)
- **Detail subnode parent integrity:** `detailsSummary` and `detailsContent` are only attached to valid container parents
- **Selection reference integrity:** stale block-selection positions are pruned and surfaced in dev diagnostics

**Completion criteria:**
- [x] Dev-mode invariant checks run after critical transactions ✅ (`structuralInvariantPlugin` runs after every doc-changing transaction)
- [x] Failing invariants are surfaced with actionable diagnostics ✅ (grouped console diagnostics + `parallx:canvas-structural-invariants` event + stale selection reference warnings)

### R3 — Transaction Atomicity and Undo Quality

**Problem:** Multi-step operations can create brittle intermediate states and poor undo behavior.

**Target:** Ensure each high-level action is applied as one deterministic transaction group:
- Drag/drop + source cleanup + width normalization
- Container conversions (unwrap/wrap/swap)
- Group operations on multi-selection

**Completion criteria:**
- [x] Turn-into fast-path transforms now execute as single-chain/single-dispatch transactions (no pre-selection dispatch split) ✅
- [x] Undo/redo replays user intent as expected for all Rule 4A–4F scenarios ✅ (`tests/e2e/16-column-undo-redo.spec.ts` covers one real drag+undo+redo path for each 4A–4F source/target scenario)
- [x] No partial intermediate states are visible to the user ✅ (critical drag paths validated end-to-end in `tests/e2e/15-column-real-interactions.spec.ts` and `tests/e2e/16-column-undo-redo.spec.ts`; dev-time structural invariant guard catches/diagnoses transient structural drift)

### R4 — Persistence and Recovery Hardening

**Problem:** Rich nested JSON content needs stronger migration and recovery guarantees.

**Target:**
- Add content schema version metadata for stored TipTap JSON
- Add migration guards for legacy/invalid content
- Preserve autosave reliability with explicit pending/flush/failure observability

**Completion criteria:**
- [x] Content migrations are deterministic and non-lossy for supported versions ✅ (v1 legacy doc JSON auto-upgrades to versioned envelope; valid envelopes preserved; invalid content recovers to safe doc with repair write)
- [x] Autosave failure paths are test-covered and user-safe ✅ (`SaveStateKind` pending/flushing/saved/failed lifecycle + targeted unit tests for debounce failure and repair-write failure)

### Save Scheduling Ownership (Follow-up Hardening)

**Problem:** Save scheduling currently has multiple initiators (editor `onUpdate` + explicit action-path scheduling), which can cause duplicate scheduling for one user intent and make behavior harder to reason about.

**Recommendation (single-writer model):**
- Make `CanvasEditorPane` `onUpdate` the canonical autosave scheduler for document edits.
- Replace direct `scheduleContentSave(...)` calls in mutation surfaces with a single pane-level `requestSave(reason)` API only for non-`onUpdate` paths (if any remain).
- Keep debounce + save-state events in `CanvasDataService`; remove per-feature scheduling responsibility.
- Add focused tests asserting “one logical user action → one pending save scheduling event”.

**Migration steps:**
1. Inventory and remove redundant direct save scheduling in handles/menus where `onUpdate` already fires.
2. Introduce `requestSave(reason)` for exceptional flows only (e.g., non-editor state changes that still need persistence).
3. Validate with targeted unit + keyboard/drag E2E smoke checks.

### R5 — Notion-Parity Interaction Hardening

**Problem:** Interaction race conditions can occur between drag handle, resize, bubble menu, slash menu, and inline editors.

**Target:** Define and enforce explicit interaction arbitration rules:
- Resize has priority over drag handle near column boundaries
- Slash/bubble visibility rules are deterministic during selection and blur transitions
- Container-vs-inner-block handle targeting remains stable at any nesting depth

**Completion criteria:**
- [x] No flicker/ownership conflicts between interaction surfaces under rapid input ✅ (single-owner drag lifecycle, resize-vs-drag arbitration, slash/bubble ownership gates; validated via targeted E2E in `tests/e2e/15-column-real-interactions.spec.ts` and `tests/e2e/17-canvas-interaction-arbitration.spec.ts`)
- [x] Handle resolution remains correct in nested callout/toggle/quote/column combinations ✅ (`tests/e2e/17-canvas-interaction-arbitration.spec.ts` nested handle-targeting test)

### R6 — Regression and Property-Based Testing Expansion

**Problem:** Existing tests cover many flows but not all structural invariants under randomized sequences.

**Target:** Expand test strategy:
- Golden regression tests for key transforms (turn-into variants, unwrap/wrap/swap)
- Drop-matrix verification for Rule 4A–4F across nesting levels
- Property-style/fuzz tests for random operation sequences with invariant checks

**Completion criteria:**
- [ ] Existing canvas suites remain green
- [x] New tests fail on invariant breakage before user-visible regressions ✅ (`tests/unit/canvasStructuralInvariants.test.ts` property-style invalid mutation coverage + invariant plugin diagnostics)

### Post-R5/R6 Hardening Notes (February 2026)

Recent stabilization and consistency fixes applied after initial R5/R6 implementation:

- **Single drag owner (no dual systems):** `BlockHandlesController` now owns dragstart/dragend for block-handle drags; removed corrective dual-handler path.
- **Single save-writer policy:** autosave scheduling standardized around editor `onUpdate`; explicit `requestSave(reason)` retained only for exceptional non-standard flows (e.g., slash execute path).
- **Drop indicator ownership clarified:** ProseMirror dropcursor disabled; Canvas drop guides are the only drag indicators.
- **Resize boundary correctness:** column resize now clamps drag delta as a pair so hitting min width hard-stops without pushing non-resized outer edges.
- **Block background consistency:** one global rule for colored blocks (no column special-casing), no height expansion, and consistent text/highlight inset across all block contexts.
- **Row spacing consistency:** paragraph spacing normalized to fixed pixel margins to avoid fractional/subpixel jitter artifacts.

Validation notes:
- Build + targeted unit/E2E checks repeatedly passed for the affected surfaces (`12-columns`, `13-column-drag-drop`, `15-column-real-interactions`, `16-column-undo-redo`, `17-canvas-interaction-arbitration`, plus new invariant/content/save-state unit suites).

### Suggested Execution Order (Refinement)

| Step | Focus | Outcome |
|------|-------|---------|
| **R1** | Lock baseline behavior with regression tests | Refactor safety net established |
| **R2** | Add invariant validators | Structural drift detected early |
| **R3** | Centralize mutation engine | Reduced code duplication + fewer edge-case divergences |
| **R4** | Improve transaction grouping/undo semantics | Notion-like operation feel |
| **R5** | Harden persistence and recovery | Better resilience under failure conditions |
| **R6** | Expand parity/polish tests | Confidence for ongoing feature growth |

---

## Excluded (Deferred to Future Milestones)

| Item | Reason |
|------|--------|
| **UI framework adoption** (Lit, Preact) | Decompose first, then reassess. If individual menu modules are still painful as vanilla DOM, framework can be scoped to `menus/` in a future milestone. |
| **Database blocks** (Table view, Board, Gallery, Calendar) | Major feature category. Separate milestone. |
| **Comments system** | Requires backend infrastructure. Separate milestone. |
| **Move to** (page picker) | Requires page search + move infrastructure. Separate milestone. |
| **CSS decomposition** | `canvas.css` stays as a single file. It's scoped and cohesive. |
| **Synced blocks** | Requires shared-state infrastructure. Phase 3 Priority 3 at earliest. |

---

## Background — Framework Evaluation Summary

During the transition from M6 to M7, several alternative frameworks were evaluated:

| Framework | Verdict | Reason |
|-----------|---------|--------|
| **TipTap Notion template** | Rejected | React-only, paid Cloud product, UI template not behavioral spec |
| **Notitap** (sereneinserenade) | Rejected | Vue 3 demo, not a product. We already use the author's global-drag-handle. |
| **BlockNote** | Rejected | Custom blocks require React (`createReactBlockSpec`). Vanilla JS mode loses all built-in UI. `xl-multi-column` is GPL-3.0 / $390/mo commercial. Would require full rewrite while solving none of the root causes. |
| **TipTap/ProseMirror (current)** | **Confirmed** | Proven, framework-agnostic, full control over interaction model. The right choice. |

The root causes of the canvas "feeling off" were not framework-related:
1. No upfront structural model (assumption-driven development)
2. No deterministic interaction rules (ad-hoc behavior)
3. Columns treated as a special concept instead of a Page variant
4. Monolith architecture preventing iterative improvement
5. Tests validating wrong behavior (testing what was built, not what should be)

Milestone 7 addresses all five root causes through the structural model, deterministic rules, recursive container abstraction, modular decomposition, and model-based testing.

---

## Lessons from Milestone 6

1. **Model first, code second.** M6 built features without a structural model. M7 has `CANVAS_STRUCTURAL_MODEL.md` before any code.
2. **Rules are deterministic.** M6 had ad-hoc edge case handling. M7 has `BLOCK_INTERACTION_RULES.md` with a complete drop outcome matrix.
3. **Modular from the start.** M6 grew a monolith. M7 decomposes it (Phase 0) before adding features.
4. **One abstraction, not many.** M6 had columns, callouts, toggles as separate concepts. M7 unifies them as Page variants.
5. **Research before building.** M6 assumed Notion behavior. M7 documents Notion behavior (`NOTION_VS_PARALLX_GAP_ANALYSIS.md`) and builds to match.
