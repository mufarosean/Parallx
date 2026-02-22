# BSR Interaction Gap Closure Plan

> **Branch:** `bsr-interaction-gaps`  
> **Parent:** `canvas-v2` @ `2175405`  
> **Date:** 2026-02-22  
> **Status:** ✅ All 3 phases complete  

## Commits

| Phase | Commit | Summary |
|-------|--------|---------|
| 1 | `f798471` | Column-aware delete (`deleteBlockAt` + `deleteSelected()`) |
| 2 | `d894675` | Tab indent/outdent into containers (`blockNesting.ts`) |
| 3 | `ac90ce1` | Multi-block selection + DnD (Shift+Arrow, marquee, multi-drag) |

## Gap Audit Summary

Full audit of BlockStateRegistry identified 8 interaction gaps between coded logic
and expected Notion-parity user behavior.

| # | Gap | Decision | Phase |
|---|-----|----------|-------|
| 1 | No lateral column keyboard move | **Skip** — Notion = DnD-only | — |
| 2 | No multi-block selection | **Full Notion-style** (box-drag + Shift+Click + Shift+Arrow) | Phase 3 |
| 3 | No multi-block DnD | **Plan together with Gap 2** as one feature | Phase 3 |
| 4 | `deleteBlockAt` is column-unaware | **Fix now** — synchronous cleanup | Phase 1 |
| 5 | `duplicateBlockAt` is clone-in-place only | **Skip** — matches Notion | — |
| 6 | Cross-page drop appends to end | **Skip** — matches Notion | — |
| 7 | No split-block in BSR | **Not a gap** — ProseMirror handles it | — |
| 8 | No Tab indent/outdent into containers | **Add** — smart merge into adjacent container | Phase 2 |

---

## Phase 1: Column-Aware Delete

**Problem:** `deleteBlockAt` (blockLifecycle.ts) does a blind `tr.delete()` with no
column cleanup. `deleteSelected()` (blockSelection.ts) has the same blind-delete
pattern. Both rely on the async `columnAutoDissolvePlugin` (next tick) to clean up
empty columns — a 1-tick inconsistent state window.

**Contrast:** `moveBlockAcrossColumnBoundary` and `deleteDraggedSource` already do
synchronous column cleanup in the same transaction via `cleanupEmptyColumn`.

### Steps

1. **Modify `deleteBlockAt`** in `blockLifecycle.ts`:
   - Before `tr.delete()`, resolve ancestry via `resolveBlockAncestry(editor.state.doc.resolve(pos))`.
   - After the delete, if the block was in a column, call `cleanupEmptyColumn(tr, mappedColPos, columnListPos)`.
   - Add imports: `resolveBlockAncestry`, `cleanupEmptyColumn` from `./blockStateRegistry.js`.

2. **Consolidate `findBlockContext`** in `blockSelection.ts`:
   - The private `findBlockContext()` at the bottom of the file is a duplicate of
     `resolveBlockAncestry` from columnInvariants.ts.
   - Replace it: re-export `resolveBlockAncestry` through `handleRegistry.ts`,
     import it in `blockSelection.ts`, delete the local duplicate.

3. **Make `deleteSelected()` column-aware** in `blockSelection.ts`:
   - After the reverse-delete loop, add `normalizeAllColumnLists(tr)` as a cleanup pass.
   - Re-export `normalizeAllColumnLists` through `handleRegistry.ts`.

4. **Gate compliance**: `handleRegistry.ts` already imports from BSR
   (`blockStateRegistry.ts`). The new re-exports go through the same edge. Update
   `gateCompliance.test.ts` if the new imports surface as rule violations.

### Verification
- Build clean, 229+ tests pass
- Manual: delete last block in a 2-column layout via block action menu → column
  dissolves synchronously (no 1-tick empty column flash)
- Manual: multi-select 2 blocks in different columns, delete → both columns
  cleaned up correctly

---

## Phase 2: Tab Indent/Outdent

**Problem:** No keyboard shortcut to push a block into an adjacent container
(callout, blockquote, details, toggleHeading) or pull it out.

**Behavior (smart merge into adjacent container):**
- **Tab** at block level: look at the sibling block immediately above. If it's a
  container (callout, blockquote, details, toggleHeading), append the current block
  into that container's content. If no container sibling above, do nothing.
- **Shift+Tab** at block level: if the block is inside a container (containerDepth > 0
  and the container isn't doc root or column), lift the block out to the parent level.
- **List items:** Tab/Shift+Tab must NOT be intercepted — let Tiptap's built-in list
  indent/outdent handle those.

### Steps

1. **Create `blockNesting.ts`** in `config/blockStateRegistry/`:
   - `indentBlock(editor, pos, node)` — finds preceding sibling, checks if it's a
     container type, appends block into its content via raw `tr`.
   - `outdentBlock(editor, pos, node)` — resolves ancestry, if inside a container
     (not column/doc), lifts block out via `tr.replaceWith`.
   - Both follow unified dispatch pattern: raw `tr` → `dispatch` → `focus()`.

2. **Re-export** through `blockStateRegistry.ts` → `export * from './blockNesting.js'`.
   Re-export through `blockRegistry.ts` for extension consumers.

3. **Wire keyboard** in `columnNodes.ts` (or new extension):
   - `Tab` → check if cursor is in listItem/taskItem. If yes, passthrough. Otherwise,
     resolve block at cursor, call `indentBlock`.
   - `Shift-Tab` → same guard for lists, then call `outdentBlock`.

4. **Gate compliance**: register `blockNesting.ts` as BSR child in `gateCompliance.test.ts`.

### Verification
- Build clean, all tests pass
- Manual: paragraph below a callout → Tab → moves inside callout
- Manual: paragraph inside callout → Shift+Tab → extracts to top level
- Manual: list item → Tab → normal list indent (not intercepted)

---

## Phase 3: Multi-Block Selection + Multi-Block DnD

**Problem:** Every BSR operation takes a single `(pos, node)`. No box-drag-select,
no Shift+Arrow, DnD only carries one block.

### 3A. Shift+Arrow block selection extend

1. Add `Shift-ArrowUp` / `Shift-ArrowDown` handlers in `blockKeyboardShortcuts.ts`
   or `columnNodes.ts`.
2. On trigger: if no selection, `selectAtCursor()` first. Then resolve adjacent block
   pos via `resolveBlockAncestry`, call `extendTo(adjacentPos)`.
3. Uses existing `BlockSelectionController.extendTo()`.

### 3B. Box-drag-select (marquee)

1. Add marquee controller — new `blockMarquee.ts` in `handles/`, gated through
   handleRegistry. Or extend `BlockSelectionController` with
   `startMarquee` / `updateMarquee` / `endMarquee`.
2. Event wiring: `mousedown` on `.ProseMirror` background (not on block content)
   starts marquee. `mousemove` updates rectangle overlay. `mouseup` finalizes.
3. Per-frame: iterate all block DOM elements, check bounding rect intersection
   with marquee. Selected blocks get added to `_selected`.
4. CSS: semi-transparent blue overlay div (absolute positioned in editor container).
5. Must not conflict with text selection — only trigger on editor background targets.

### 3C. Multi-block DnD — initiation

1. Modify `_onDragHandleDragStart` in `blockHandles.ts`:
   - If `blockSelection.hasSelection` AND dragged block is in selection:
     - Collect all selected nodes. Build `Fragment.from(nodes)`.
     - Set `dataTransfer` with all nodes.
     - Set `view.dragging` with multi-node `Slice`.
     - Set `CanvasDragSession.nodes` to full array.
     - Set `from`/`to` to encompass full range.
   - If dragged block NOT in selection: clear selection, single-block drag.

### 3D. Multi-block DnD — drop handling

1. `moveBlockAboveBelow` — `content: Fragment` already supports multi-node.
   `tr.insert` inserts all nodes. Works without changes.
2. `createColumnLayoutFromDrop` / `addColumnToLayoutFromDrop` — `content: Fragment`
   already supports multiple children. New column wraps all of them.
3. **`deleteDraggedSource`** — needs extension. If selected blocks span multiple
   containers (one in column 1, one top-level), a single `dragFrom→dragTo` range
   won't cover both. Extend to accept optional `positions: number[]`. When provided,
   iterate each in reverse, delete each, run column cleanup after each. Fallback to
   range-delete when positions aren't provided (backward compat).

### 3E. Visual polish

1. During multi-block drag: `.block-drag-source` class on all selected DOM elements.
2. Drop indicators already work — verify they make sense for multi-block drops.

### Verification
- Build clean, all tests pass
- New unit tests: multi-block selection extend, deleteSelected with column cleanup
- Manual: Shift+ArrowDown × 3 → 3 blocks highlighted
- Manual: Click-drag marquee over 4 blocks → 4 highlighted
- Manual: Drag handle of selected block (3 selected) → all move as group
- Manual: Alt+drag multi-selection → duplicates all at target
- Manual: Drop multi-selection to left edge → new column with all blocks

---

## Execution Order

```
Phase 1  →  Phase 2  →  Phase 3
(prerequisite: deleteSelected    (independent,     (largest effort,
 must be column-aware before      small)            depends on Phase 1
 multi-block delete)                                for column cleanup)
```

Each phase gets its own commit. All commits on `bsr-interaction-gaps` branch.
