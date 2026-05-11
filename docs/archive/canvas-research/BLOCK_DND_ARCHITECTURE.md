# Block Drag-and-Drop Architecture

> Research document for the canvas block manipulation system.
> Created 2026-02-20 during architecture review of blockMutations, column plugins, and registry gating.

---

## Registry Gating (Current State)

All block manipulation flows through a strict registry chain. No child file reaches across to a sibling — it imports from its parent registry only.

```
blockMutations.ts          (shared ProseMirror transaction helpers)
       ↑
blockRegistry.ts           (re-exports mutations, plugins, icons, block metadata)
       ↑                         ↑
  extensions/              canvasMenuRegistry.ts  (re-exports mutations for menus)
  plugins/                        ↑
                              menus/
```

**Rules enforced:**
- Extensions (columnNodes, pageBlockNode) import from blockRegistry only
- Plugins (columnDropPlugin) import from blockRegistry only
- Menus (blockActionMenu) import from canvasMenuRegistry only
- canvasMenuRegistry imports from blockRegistry (registry-to-registry)
- blockRegistry imports from blockMutations, plugins/, iconRegistry
- Only blockRegistry imports blockMutations directly

---

## The Three Column Plugins

Registered on the `ColumnList` extension via `addProseMirrorPlugins()`. All three factory functions are re-exported through blockRegistry so columnNodes never imports plugins/ directly.

### columnDropPlugin (592 lines)
**Scope:** ALL block drag-and-drop in the canvas — not just columns.  
**Identity:** Despite the name, this is the complete block drop engine. Column creation is one possible outcome of a drop, not the plugin's sole purpose.

### columnResizePlugin (326 lines)
**Scope:** Exclusively column boundary resizing.  
Detects pointer proximity to column edges, enables drag-to-resize between two adjacent columns. Double-click resets to equal widths. Never creates, destroys, or moves content.

### columnAutoDissolvePlugin
**Scope:** Automatically removes empty columns and dissolves single-column columnLists after content is deleted.

**Lifecycle:** drop creates columns → resize adjusts widths → autoDissolve cleans up empties.

---

## Block Drag-and-Drop Flow (Start to Finish)

### Phase 1 — Drag Initiation (blockHandles.ts)

1. User grabs the drag handle (the ⠿ grip next to a block)
2. `_onDragHandleDragStart` fires:
   - Resolves which ProseMirror block the handle belongs to (DOM → PM position mapping)
   - Sets a `NodeSelection` on that block so PM knows what's being dragged
   - Writes payload to `dataTransfer`:
     - `text/plain`: `'parallx-canvas-block-drag'`
     - `CANVAS_BLOCK_DRAG_MIME`: JSON with `{ sourcePageId, from, to, nodes, startedAt }`
   - Sets `view.dragging = { slice, move, from, to }` — PM's native drag state
   - Stores a `CanvasDragSession` in `dnd/dragSession.ts` (global singleton for cross-page drops)
   - Adds `'dragging'` CSS class to `view.dom`

### Phase 2 — Drag Over (columnDropPlugin `dragover` handler)

Fires on every mouse-move while dragging. Determines what visual feedback to show.

1. **Bail** if `!view.dragging` (not our drag)
2. **Find target block** via `findTarget(view, x, y)`:
   - Calls `document.elementsFromPoint(x, y)`
   - For each hit element, walks up the DOM tree looking for a block-level element whose parent is a "page container" (doc root, column, callout, detailsContent, blockquote)
   - If inside a `.canvas-column`, uses `resolveNearestBlockInColumn` to find the closest child block by vertical distance
   - Maps the DOM element to ProseMirror coordinates via `resolveBlockTarget`
   - **Fallback:** if cursor is in empty space, finds nearest top-level block within 100px
3. **Nesting prevention:** if dragged content is a `columnList`, abort (can't nest columnLists)
4. **Self-drop guard:** if hovering over the source block, abort
5. **Compute zone** via `getZone(blockEl, x, y, isColumnList)`:
   - Left/right edges (50px or 20% for narrow blocks) → column creation zone
   - Center area → above/below by Y midpoint
   - If target IS a columnList → left/right disabled (nesting prevention)
   - If `rx < 0` (cursor on drag handle, outside block bounds) → left/right skipped
6. **Show indicator:**
   - `left`/`right` → vertical blue line at block edge
   - `above`/`below` → horizontal blue line spanning container width
7. Set `activeTarget` for the drop handler to consume

### Phase 3 — Drop (columnDropPlugin `drop` handler)

Reads `activeTarget` and `view.dragging.slice`, builds a ProseMirror transaction.

**Three execution paths:**

#### Path A — Above/Below (block reorder)
- Insert dragged content at `target.blockPos` (above) or `target.blockPos + nodeSize` (below)
- Delete source via `deleteDraggedSourceFromTransaction(tr, dragFrom, dragTo)`
- Works at any nesting depth (top-level, inside columns, inside callouts, etc.)

#### Path B — Left/Right on top-level block (new columnList)
- Creates two `column` nodes:
  - One wrapping the existing target block
  - One containing the dragged content
- Order depends on `left` vs `right` zone
- Wraps both in a new `columnList`
- Replaces the target block with the columnList
- Deletes source via `deleteDraggedSourceFromTransaction`

#### Path C — Left/Right on block inside a column (extend columnList)
- Adds a new `column` to the existing `columnList`
- **Width math (Notion-style):**
  - Computes target column's effective percentage width
  - Splits it in half
  - Assigns half to target, half to new column
  - Other sibling columns keep their current widths
- Inserts the new column at the correct position (before target for `left`, after for `right`)
- Deletes source via `deleteDraggedSourceFromTransaction`
- **Fallback:** if source was removed from the same columnList (column count changed unexpectedly), equalizes all column widths via `resetColumnListWidthsInTransaction`

### Phase 4 — Drag End (blockHandles.ts + columnDropPlugin)

- `columnDropPlugin.dragend`: hides indicators
- `blockHandles._onDragHandleDragEnd`:
  - Clears `view.dragging`
  - Removes `'dragging'` CSS class
  - Clears the `CanvasDragSession`
  - Releases the interaction lock (re-enables handle hover)

### Alt+Drag = Duplicate

All three drop paths check `event.altKey`. If true, `deleteDraggedSourceFromTransaction` is skipped — the source block remains, and a copy is placed at the drop target.

---

## blockMutations.ts — Function Inventory (719 lines)

All functions are ProseMirror transaction-level helpers. They operate on `Editor` or raw `tr` objects.

### Block Move
| Function | Used by | Purpose |
|----------|---------|---------|
| `moveBlockUpWithinPageFlow(editor)` | columnNodes (keyboard shortcut) | Move block up one position in its container |
| `moveBlockDownWithinPageFlow(editor)` | columnNodes (keyboard shortcut) | Move block down one position in its container |
| `moveBlockAcrossColumnBoundary(editor, direction)` | columnNodes (keyboard shortcut) | Move block out of a column (above/below the columnList) |

### Block Transform
| Function | Used by | Purpose |
|----------|---------|---------|
| `turnBlockWithSharedStrategy(editor, pos, node, targetType, attrs)` | blockActionMenu (turn-into) | Convert a block to another type, handling all edge cases |
| `turnBlockIntoColumns(editor, pos, node, columnCount)` | turnBlockWithSharedStrategy | Convert a single block into a columnList |
| `turnBlockViaReplace(editor, pos, node, targetType, attrs)` | turnBlockWithSharedStrategy | Fallback: replace block node with new type |

### Block CRUD
| Function | Used by | Purpose |
|----------|---------|---------|
| `duplicateBlockAt(editor, pos, node, options?)` | columnNodes (Mod-d), blockActionMenu | Clone a block after its current position |
| `deleteBlockAt(editor, pos, node)` | blockActionMenu | Delete a block by range |

### Color
| Function | Used by | Purpose |
|----------|---------|---------|
| `applyTextColorToBlock(editor, pos, node, color)` | blockActionMenu | Apply/remove text color mark across block content |
| `applyBackgroundColorToBlock(editor, pos, node, color)` | blockActionMenu | Set/clear backgroundColor attr on block node |

### Column Normalization
| Function | Used by | Purpose |
|----------|---------|---------|
| `normalizeColumnListAfterMutation(tr, columnListPos)` | columnNodes (Backspace), deleteDraggedSource, moveBlockAcrossColumnBoundary | After removing a column: if 0 columns → delete columnList; if 1 column → unwrap; if 2+ → equalize widths |
| `resetColumnListWidthsInTransaction(tr, columnListPos)` | columnDropPlugin, normalizeColumnList | Set all column widths to `null` (equal via flex) |
| `isColumnEffectivelyEmpty(columnNode)` | columnNodes (Backspace), deleteDraggedSource, moveBlockAcrossColumnBoundary | Check if a column has no meaningful content (empty paragraphs, whitespace, hardBreaks don't count) |

### Drag Cleanup
| Function | Used by | Purpose |
|----------|---------|---------|
| `deleteDraggedSourceFromTransaction(tr, dragFrom, dragTo)` | columnDropPlugin, pageBlockNode | Delete the original block after a move. Handles position mapping through prior transaction steps. If removal empties a column, removes the column and normalizes the columnList. |

### Internal Helpers (not exported)
| Function | Purpose |
|----------|---------|
| `nodeHasMeaningfulContent(node)` | Recursive check for real content (used by `isColumnEffectivelyEmpty`) |
| `normalizeAllColumnListsAfterMutation(tr)` | Normalize every columnList in the doc (used by `moveBlockAcrossColumnBoundary`) |
| `extractBlockContent(node)` | Extract inline content from a block for turn-into |
| `extractContainerBlocks(node)` | Extract child blocks from a container (details, toggleHeading, callout) |
| `unwrapContainer(editor, pos, node, innerBlocks)` | Replace a container with its inner blocks |
| `swapContainer(editor, pos, node, targetType, innerBlocks, attrs)` | Convert one container type to another |
| `buildContainerBlock(targetType, inlineContent, attrs)` | Build a container block JSON |
| `buildLeafBlock(targetType, inlineContent, textContent, attrs)` | Build a leaf block JSON |
| `extractInlineContent(blockJson)` | Dig into nested JSON to find inline content |
| `findBlockContext($pos)` | Find the container depth and block depth for a resolved position |

---

## Key Observation: Naming

`columnDropPlugin` is misleadingly named. It handles **all** block drag-and-drop — above/below reorder, column creation, column extension, cross-column transfer, cross-page transfer cleanup. Column creation is one of six drop scenarios.

The name was kept for now during this review, but the mental model should be: **this is the block drop engine, and columns are one possible outcome.**

---

## Files Changed During This Review

| File | Change |
|------|--------|
| `config/blockRegistry.ts` | Added re-exports: 12 mutation functions + 3 plugin factories |
| `menus/canvasMenuRegistry.ts` | Added re-exports: 5 mutation functions for menu children |
| `extensions/columnNodes.ts` | Rewired: mutations + plugins now imported from blockRegistry |
| `extensions/pageBlockNode.ts` | Rewired: `deleteDraggedSourceFromTransaction` from blockRegistry |
| `menus/blockActionMenu.ts` | Rewired: 5 mutation functions from canvasMenuRegistry |
| `plugins/columnDropPlugin.ts` | Rewired: mutations + PAGE_CONTAINERS from blockRegistry |

**Result:** Only blockRegistry imports blockMutations. Only blockRegistry imports plugin factories. Only canvasMenuRegistry imports blockRegistry for menu needs. Zero cross-reach from any child file.
