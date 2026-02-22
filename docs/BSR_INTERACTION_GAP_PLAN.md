# BSR Interaction Gap Closure Plan

> **Branch:** `bsr-interaction-gaps`  
> **Parent:** `canvas-v2` @ `2175405`  
> **Date:** 2026-02-22  
> **Status:** Phases 1–3 complete; Phase 4 (column logic hardening) in progress  

## Commits

| Phase | Commit | Summary |
|-------|--------|---------|
| 1 | `f798471` | Column-aware delete (`deleteBlockAt` + `deleteSelected()`) |
| 2 | `d894675` | Tab indent/outdent into containers (`blockNesting.ts`) |
| 3 | `ac90ce1` | Multi-block selection + DnD (Shift+Arrow, marquee, multi-drag) |
| — | `e22bd97` | Remove micro-drag suppression (drag handle fix) |
| — | `0e6974f` | Menu flicker fix (interaction lock only in dragstart) |
| — | `925ba6e` | Click recovery for tremor-drags |

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

---

## Phase 4: Column Logic Hardening (Block Handle ↔ Menu Staleness)

**Symptom:** Cursor snaps to wrong block when using turn-into/color on blocks in
columns, especially after adding blocks via the + button.

**Root Cause Audit (4 Findings):**

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | Dual block resolution: GlobalDragHandle library and `_resolveBlockFromHandle()` resolve independently | Low | Deferred — our code overrides library in both click and drag paths |
| 2 | Stale `_actionBlockPos`: menu stores frozen pos/node snapshot at show() time, never revalidated at action time | **High** | Fix B |
| 3 | Stale `_lastHoverElement`: cached DOM ref never cleared after doc mutations, fast-path resolves to destroyed/repositioned element | **High** | Fix A |
| 4 | Library `calcNodePos` is shallow (`$pos.before($pos.depth)`) — breaks inside nested containers (callouts in columns) | Low | Deferred — our deep resolution compensates |

### Fix A — Stale Hover Invalidation (Finding 3)

**Problem:** `_lastHoverElement` in `blockHandles.ts` is set on `mousemove`, cleared on
`mouseleave`, but never cleared when the document changes. After inserting a block
via the + button (or any other mutation), the cached DOM element may be destroyed or
repositioned — causing `_resolveBlockFromHandle()` to resolve to the wrong block via
the 180px-distance fast path.

**Implementation:**
1. `blockHandles.ts`: Add `notifyDocChanged()` → clears `_lastHoverElement = null`
2. `canvasEditorProvider.ts`: Destructure `transaction` in `onTransaction` callback,
   call `this._blockHandles?.notifyDocChanged()` when `transaction.docChanged`

**Gate compliance:** blockHandles.ts needs no new imports. canvasEditorProvider already
has the `onTransaction` hookpoint and holds a reference to `_blockHandles`.

### Fix B — Action-Time Pos/Node Revalidation (Finding 2)

**Problem:** `_actionBlockPos` and `_actionBlockNode` are frozen at `show()` time. Any
doc mutation between show() and the user clicking an action item makes the stored pos
stale — operations apply to the wrong block or crash.

**Implementation (two layers):**

1. **`onTransaction(editor)` on `BlockActionMenuController`** (implements existing
   `ICanvasMenu.onTransaction` optional method): If the menu is visible and the node
   at `_actionBlockPos` no longer matches `_actionBlockNode.type.name`, hide the menu.
   This auto-closes the menu when external mutations invalidate the target.

2. **`_revalidateActionBlock()` safety net** called at the start of every action method
   (`_turnBlockInto`, `_applyBlockTextColor`, `_applyBlockBgColor`, `_duplicateBlock`,
   `_deleteBlock`): Verifies `editor.state.doc.nodeAt(pos)?.type.name ===
   _actionBlockNode.type.name`. If mismatch → hide + return false. If match → refresh
   `_actionBlockNode` with the current node and return true.

**Gate compliance:** blockActionMenu.ts imports only from canvasMenuRegistry.ts — no
new imports needed.

### Deferred: Fix C — Unify Block Resolution (Findings 1 + 4)

The library's shallow `calcNodePos` only affects the drag handle's visual position.
Our code overrides the library's resolution in both click (`_handleClickAction`) and
drag (`_onDragHandleDragStart`) paths via `_resolveBlockFromHandle()`, which uses the
PAGE_CONTAINERS model for correct depth resolution. With Fix A eliminating stale hover
elements, the functional risk from dual resolution is fully mitigated. Fix C becomes a
cosmetic improvement for a future iteration.

### Fix D — Handle Mousedown Focus Leak (PM blur → menu flicker + cursor jump)

**Symptom:** Clicking the drag handle while typing in a block causes:
1. Menu flicker: menu appears then instantly disappears (~150ms later)
2. Cursor jump: the text cursor moves to an unexpected position

**Root Cause — competing selection systems:**

The drag handle is a `<div>` that lives outside ProseMirror's contenteditable surface.
When the user mousedowns on the handle, the browser transfers focus away from the
contenteditable div. This triggers ProseMirror's `onBlur` callback, which fires a
150ms delayed `menuRegistry.hideAll()`. When the native `click` event fires (~2ms
later), `_handleClickAction()` shows the block-action menu — but at t=150ms the blur
timer fires and `hideAll()` kills it.

The existing `containsFocusedElement()` check in the blur callback cannot save the
menu because the drag handle is a plain `<div>` that never receives `document.activeElement`
focus — the check was designed for menus with `<input>` elements (math editor, etc.).

Separately, PM adjusts its internal selection state on blur, so when focus returns
(e.g., during an action that calls `editor.commands.focus()`), the cursor position
is unpredictable.

**Implementation:**

In `_onDragHandleMouseDown`, add `e.preventDefault()`:
- `preventDefault()` on `mousedown` prevents the browser from transferring focus
  away from the contenteditable → PM never fires blur → no hideAll timer → no flicker
- PM's selection stays in place → no cursor jump
- Drag still works: in Chromium/Electron, `preventDefault()` on mousedown does NOT
  cancel `dragstart` on draggable elements
- Click still fires: the `click` event doesn't depend on focus transfer
- Follows existing pattern: the + button already does `e.preventDefault(); e.stopPropagation();`
  on mousedown (blockHandles.ts setup, line 128)

**Gate compliance:** No new imports. Single-line change in blockHandles.ts.

### Verification
- Build clean, all tests pass
- Manual: in a 2-column layout, click + button to add block, then immediately click
  drag handle → menu targets the correct block (not a neighbor)
- Manual: open turn-into menu on column block, wait, then try another action on a
  different block → stale pos is caught, menu hides gracefully
- Manual: type in a block, then click drag handle → menu appears without flicker,
  cursor does not jump
- Manual: drag a block via handle → block moves correctly (dragstart not suppressed)
