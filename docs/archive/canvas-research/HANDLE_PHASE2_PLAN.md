# Phase 2: Replace GlobalDragHandle with Native Handle Positioning

**Date:** 2026-02-23  
**Branch:** `milestone-8`  
**Status:** In progress

---

## Root Cause Analysis

### The Symptom
Clicking the drag handle next to atom node-view blocks (mathBlock, bookmark, tableOfContents, video, audio, fileAttachment, etc.) inside columns resolves to the **wrong block** — typically the first block in the first column.

### The Root Cause (Two bugs)

**Bug 1 — `_resolveBlockFromDocPos` fails for atom node boundaries:**

ProseMirror positions at atom node boundaries sit at the **parent container depth**, not at `containerDepth + 1`. The function requires `$pos.depth >= containerDepth + 1` to find the block, so it falls through to a fallback that walks up to the `columnList` and returns the first block in the first column.

Concrete example: For a mathBlock inside `doc > columnList > column > mathBlock`:
- `posAtDOM(mathBlockElement, 0)` or `posAtCoords(...)` returns position P
- `resolve(P)` gives `$pos.depth = 2` (column level) — atom has no "inside"
- `containerDepth = 2` (column is a PAGE_CONTAINER), `targetDepth = 3`
- `$pos.depth (2) < targetDepth (3)` → falls to `$pos.before(2)` → column node → returns null
- Walk continues to columnList → `_resolveFirstBlockInsideColumnList` → **wrong block**

**Bug 2 — Dual resolution system:**

The GlobalDragHandle library resolves blocks independently from our `_resolveBlockFromHandle()`. Even when one system is correct, the other can disagree — and it's our resolution that determines what gets selected/dragged.

Phase 1 (the store-and-read bridge) addressed Bug 2 by reading the library's own node, but Bug 1 still caused the stored DOM node to resolve to the wrong ProseMirror position.

### Why Phase 2

Phase 2 eliminates both bugs:
1. **Fix `_resolveBlockFromDocPos`** to handle atom node boundaries via `$pos.nodeAfter`/`$pos.nodeBefore`
2. **Replace GlobalDragHandle entirely** — single resolution at mousemove time, stored position reused at click/drag time. No dual system, no DOM-to-position remapping.

---

## Behavioral Contract (What Must Not Change)

| Behavior | Verification |
|----------|-------------|
| Handle appears to the left of hovered block | Visual — same Y alignment, same X offset |
| Handle hides on keydown, mousewheel, editor leave | Manual test |
| Handle stays visible when mouse moves to handle/+ button | Manual test — handle-area hover |
| Click handle → block action menu opens | Menu shows correct block type |
| Shift+click → extend selection | Selection extends correctly |
| Drag handle → single-block drag | Block moves to drop target |
| Drag with multi-selection → multi-block drag | All selected blocks move |
| + button → inserts paragraph with slash menu | Paragraph inserted at correct position |
| Alt+click + button → inserts above | Paragraph inserted above block |
| Tremor-drag recovery → treated as click | Small/short drags open menu instead |
| Handle hidden during column resize | No interference with resize zones |
| Scroll sync → handle repositions | Handle follows scrolled content |
| `.dragging` class during drag | CSS drag indicators work |

---

## Files Changed

### Modified

| File | What changes |
|------|-------------|
| `src/built-in/canvas/handles/blockHandles.ts` | Core: fix `_resolveBlockFromDocPos`, own handle creation/positioning, replace library dependency |
| `src/built-in/canvas/config/tiptapExtensions.ts` | Remove GlobalDragHandle import and configuration |
| `scripts/patch-deps.mjs` | Remove both library patches (no longer needed) |

### Not Modified

| File | Why |
|------|-----|
| `canvas.css` | `.drag-handle`, `.block-add-btn` styles unchanged — visual parity |
| `handleRegistry.ts` | No new imports needed |
| `blockSelection.ts` | Downstream of resolution — unchanged |
| `blockActionMenu.ts` | Receives `(pos, node)` — unchanged |
| `canvasEditorProvider.ts` | Uses BlockHandlesController API — unchanged |

---

## Implementation Plan

### Part A: Fix `_resolveBlockFromDocPos` (the core resolution bug)

**Location:** `blockHandles.ts`, method `_resolveBlockFromDocPos`

When `$pos.depth < targetDepth`, the current code falls back to `$pos.before($pos.depth)` which returns the parent container — wrong for atom nodes.

**Fix:** Check `$pos.nodeAfter` and `$pos.nodeBefore` at the current position:
```typescript
if ($pos.depth >= targetDepth) {
    blockPos = $pos.before(targetDepth);
} else if ($pos.depth === containerDepth) {
    // Position is at a block boundary inside the container.
    // Common for atom nodes (mathBlock, bookmark, etc.) which have no "inside".
    const after = $pos.nodeAfter;
    if (after && !isStructuralWrapper(after.type.name)) {
        blockPos = $pos.pos;  // position of nodeAfter = the block itself
    } else {
        const before = $pos.nodeBefore;
        if (before && !isStructuralWrapper(before.type.name)) {
            blockPos = $pos.pos - before.nodeSize;
        } else {
            blockPos = $pos.depth >= 1 ? $pos.before($pos.depth) : docPos;
        }
    }
} else {
    blockPos = $pos.depth >= 1 ? $pos.before($pos.depth) : docPos;
}
```

Where `isStructuralWrapper(name)` checks for `columnList`, `column`.

### Part B: Replace GlobalDragHandle with native handle positioning

#### B1. Handle element creation (`setup()`)

Create the drag handle element ourselves instead of querying for the library-created one:
```typescript
this._dragHandleEl = document.createElement('div');
this._dragHandleEl.draggable = true;
this._dragHandleEl.dataset.dragHandle = '';
this._dragHandleEl.classList.add('drag-handle', 'hide');
ec.appendChild(this._dragHandleEl);
```

All existing CSS (`.drag-handle`, `.drag-handle.hide`, etc.) applies automatically.

#### B2. Block resolution and handle positioning (`_onEditorMouseMove`)

On every editor mousemove:
1. Call `view.posAtCoords({ left: clientX, top: clientY })` for ProseMirror position
2. Resolve to block boundary via `_resolveBlockFromDocPos` (now fixed for atoms)
3. Get block DOM element via `view.nodeDOM(resolvedPos)`
4. Position handle using the **exact same formula** as the library:
   ```
   top = rect.top + (lineHeight - 24) / 2 + paddingTop
   left = rect.left - dragHandleWidth
   (list items: left -= dragHandleWidth)
   ```
5. Position + button: `top = handle.top`, `left = handle.left - 22`
6. Remove `.hide` from both elements
7. Store `_resolvedBlockPos = resolvedPos` for click/drag use

#### B3. Handle hiding

Add listeners (replacing the library's ProseMirror `handleDOMEvents`):
- **keydown** on `view.dom` → `_hideHandle()`
- **wheel** on `view.dom` → `_hideHandle()`
- **mouseleave** on editor container (existing) → `_hideHandle()` (unless moving to menu)

`_hideHandle()`:
```typescript
this._dragHandleEl.classList.add('hide');
this._blockAddBtn.classList.add('hide');
this._resolvedBlockPos = null;
```

#### B4. Simplify `_resolveBlockFromHandle()`

Primary path becomes trivial:
```typescript
if (this._resolvedBlockPos != null) {
    const node = view.state.doc.nodeAt(this._resolvedBlockPos);
    if (node) return { pos: this._resolvedBlockPos, node };
}
```
Existing `elementsFromPoint` fallback scan retained for robustness.

#### B5. `notifyDocChanged()`

Clear `_resolvedBlockPos` and hide handle (doc mutation may have invalidated the position).

#### B6. Remove MutationObserver

No longer needed — we position both handle and + button directly in our mousemove handler.

#### B7. Cleanup `_onEditorMouseOut`

Simplify — no longer needs to intercept events for the library's hideHandleOnEditorOut.

### Part C: Remove GlobalDragHandle from extensions

In `tiptapExtensions.ts`:
- Remove `import GlobalDragHandle from 'tiptap-extension-global-drag-handle'`
- Remove `GlobalDragHandle.configure(...)` from the extensions array
- Remove `DRAG_HANDLE_CUSTOM_NODE_TYPES` import (no longer needed here)

### Part D: Clean up patch-deps.mjs

Remove both patches:
- Patch 1 (column paragraph selectors) — no longer needed, library removed
- Patch 2 (node bridge) — no longer needed, library removed

Keep the file structure intact (it may be used for other patches in the future).

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Handle positioning differs from library | Copy exact formula: `absoluteRect`, lineHeight, paddingTop, list-item offset |
| `posAtCoords` returns null in margin areas | Fall back to `elementFromPoint` + `_resolveBlockFromDomElement` |
| `nodeDOM` returns null for some positions | Skip positioning if DOM element unavailable |
| Scroll sync stops working | Synthetic mousemove dispatch still triggers our `_onEditorMouseMove` |
| Handle stays visible when it shouldn't | `_hideHandle` on keydown, wheel, mouseleave, doc change |
| Handle hidden when moving to menu | Check `relatedTarget` for menu elements in mouseleave |
| MutationObserver removal breaks + button | Direct positioning in mousemove replaces observer logic |

---

## Verification

1. `npx tsc --noEmit` — zero type errors
2. `npx vitest run tests/unit/gateCompliance.test.ts` — all gates pass
3. Manual: hover over blocks in columns → handle aligns correctly
4. Manual: click handle on atom node in column → correct block type in menu
5. Manual: drag atom node → correct block moves
6. Manual: keyboard → handle hides, scroll → handle hides
7. Manual: + button → paragraph inserted at correct block position
