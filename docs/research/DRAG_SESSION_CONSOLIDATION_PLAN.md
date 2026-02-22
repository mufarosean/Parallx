# Drag Session → blockMovement Consolidation Plan

**Date:** 2026-02-20  
**Status:** Ready for execution  
**Scope:** Absorb `dnd/dragSession.ts` into `blockMovement.ts`, extract pageBlock drop logic into a movement primitive

---

## Problem Statement

`dnd/dragSession.ts` is a 25-line file that holds the active drag session — a global singleton tracking which block(s) are being dragged. Two children (`pageBlockNode.ts`, `blockHandles.ts`) consume it through blockRegistry re-exports.

Additionally, `pageBlockNode.ts` contains ~90 lines of inline movement logic in its `drop` event handler: resolving drag sources, computing positions, deleting source blocks, and calling `dataService.moveBlocksBetweenPagesAtomic()`. This is **Scenario 4D: cross-page block movement** — it belongs in `blockMovement.ts` alongside the other DnD primitives.

### Current state

```
blockHandles.ts ──→ blockRegistry ──→ dnd/dragSession.ts (set/clear session)
pageBlockNode.ts ──→ blockRegistry ──→ dnd/dragSession.ts (get/clear session)
pageBlockNode.ts — 90 lines of inline movement logic in drop handler
```

### Problems
1. **dnd/dragSession.ts** is drag-movement shared state — it belongs in blockMovement.ts where all movement concerns live
2. **pageBlockNode.ts drop handler** has 90 lines of movement logic inline — same problem columnDropPlugin had before extraction
3. **dnd/ directory** contains only dragSession.ts — will be empty after the move

---

## Execution Steps

### Step 1: Move drag session primitives into `blockMovement.ts`

Move these into blockMovement.ts (above the DnD Movement Primitives section):
- `CanvasDragSession` interface
- `CANVAS_BLOCK_DRAG_MIME` constant
- `setActiveCanvasDragSession()` function
- `getActiveCanvasDragSession()` function
- `clearActiveCanvasDragSession()` function

These are movement infrastructure — the shared state channel between drag-start (blockHandles) and drop (pageBlockNode, columnDropPlugin).

### Step 2: Extract `moveBlockToLinkedPage()` primitive

Extract the ~90-line drop handler from pageBlockNode.ts into a new function in blockMovement.ts:

```typescript
export interface CrossPageMoveParams {
  readonly editor: Editor;
  readonly event: DragEvent;
  readonly targetPageId: string;
  readonly currentPageId: string;
  readonly dataService: {
    moveBlocksBetweenPagesAtomic(params: {
      sourcePageId: string;
      targetPageId: string;
      sourceDoc: any;
      appendedNodes: any[];
    }): Promise<any>;
    appendBlocksToPage(targetPageId: string, appendedNodes: any[]): Promise<any>;
  };
}

export async function moveBlockToLinkedPage(params: CrossPageMoveParams): Promise<boolean>
```

This function:
1. Resolves dragged nodes from editor.view.dragging / drag session / DataTransfer payload
2. Determines if move or copy (alt-key)
3. Deletes source using `deleteDraggedSourceFromTransaction()` (already in blockMovement)
4. Calls dataService for cross-page persistence
5. Clears the drag session

### Step 3: Thin-shell the pageBlockNode drop handler

Replace the ~90-line inline handler with delegation to `moveBlockToLinkedPage()`:

```typescript
dom.addEventListener('drop', (event) => {
  dom.classList.remove('canvas-page-block--drop-target');
  const pageId = attrs.pageId;
  if (!pageId || !dataService || !this.options.currentPageId) return;
  if (pageId === this.options.currentPageId) return;
  event.preventDefault();
  event.stopPropagation();
  suppressOpenUntil = Date.now() + 350;
  void moveBlockToLinkedPage({ editor, event, targetPageId: pageId, currentPageId: this.options.currentPageId, dataService });
});
```

### Step 4: Update blockRegistry re-exports

Change the drag session re-export block to point to blockStateRegistry instead of dnd/dragSession:

**Before:**
```typescript
export { CANVAS_BLOCK_DRAG_MIME, setActiveCanvasDragSession, ... } from '../dnd/dragSession.js';
```

**After:**
```typescript
export { CANVAS_BLOCK_DRAG_MIME, setActiveCanvasDragSession, ... } from './blockStateRegistry/blockStateRegistry.js';
```

Also add `moveBlockToLinkedPage` to blockRegistry re-exports.

### Step 5: Delete `dnd/dragSession.ts` and `dnd/` directory

The file is fully absorbed. The directory will be empty.

---

## Affected Files

| File | Action | Detail |
|---|---|---|
| `config/blockStateRegistry/blockMovement.ts` | **MODIFY** | Add drag session primitives + `moveBlockToLinkedPage()` |
| `extensions/pageBlockNode.ts` | **MODIFY** | Replace ~90-line drop handler with thin delegation |
| `config/blockRegistry.ts` | **MODIFY** | Re-point drag session re-exports, add moveBlockToLinkedPage re-export |
| `dnd/dragSession.ts` | **DELETE** | Fully absorbed into blockMovement |
| `dnd/` directory | **DELETE** | Now empty |

No changes needed to `blockHandles.ts` — it already imports through blockRegistry.

---

## Before/After Logic Comparison

### Drag session (set/get/clear)
- **Before:** Module-scoped `let activeSession` in dnd/dragSession.ts
- **After:** Module-scoped `let activeSession` in blockMovement.ts
- **Logic change:** None — identical singleton pattern, same variable, same 3 functions

### pageBlockNode drop handler
- **Before:** ~90 lines inline in the `drop` event listener
- **After:** ~10 lines delegating to `moveBlockToLinkedPage()`
- **Logic change:** None — same resolution order (dragging.slice → DataTransfer payload → drag session), same alt-key check, same deleteDraggedSourceFromTransaction call, same dataService calls

---

## Validation

- `npm run build` passes (tsc + esbuild)
- `npx vitest run` — all 182 tests pass
- `grep -r "dragSession" src/` returns zero hits outside blockMovement.ts
- No file imports from `dnd/` directory
