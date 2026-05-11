# blockStateRegistry — Refactor Plan

> Single authority for block state operations: lifecycle, transforms, and movement.
> Replaces the `mutations/blockMutations.ts` junk drawer and unifies keyboard + DnD movement.
> Created 2026-02-20 during architecture review.

---

## Problem

`blockMutations.ts` (719 lines) accumulated 5+ unrelated responsibilities behind one vague name:
block movement, type transforms, lifecycle (delete/duplicate), styling, and column utilities.
Meanwhile, drag-and-drop movement logic lives in `columnDropPlugin.ts` — a completely separate
location from the keyboard movement logic in blockMutations. Two independent codepaths for the
same operation (block relocation) is a consistency and maintenance hazard.

---

## Solution

Create a `config/blockStateRegistry/` directory with focused, single-responsibility files
and a facade. Delete `mutations/blockMutations.ts`. Extract DnD movement primitives from
`columnDropPlugin.ts` into the shared movement module.

### New Directory Structure

```
config/
  blockRegistry.ts                    ← existing (block type metadata + re-exports)
  blockStateRegistry/
    blockStateRegistry.ts             ← facade: re-exports everything
    blockLifecycle.ts                 ← deletion, duplication, styling
    blockTransforms.ts                ← "turn into" type conversions
    blockMovement.ts                  ← ALL position changes + column utils
```

### Deleted

```
mutations/blockMutations.ts           ← replaced entirely
mutations/                            ← directory removed (was sole file)
```

---

## File Breakdown

### blockLifecycle.ts — Block Lifecycle Operations

Functions that create, destroy, or restyle a block without changing its position or type.

| Function | Purpose |
|----------|---------|
| `deleteBlockAt` | Remove a block |
| `duplicateBlockAt` | Clone a block in-place |
| `applyTextColorToBlock` | Set text color on a block's content |
| `applyBackgroundColorToBlock` | Set background color via node attr |

Dependencies: `@tiptap/core` (Editor), `@tiptap/pm/state` (TextSelection).

### blockTransforms.ts — Block Type Conversions

Functions that change a block's type (e.g. paragraph → heading, paragraph → columns).

| Function | Visibility | Purpose |
|----------|-----------|---------|
| `turnBlockWithSharedStrategy` | **public** | Entry point for "turn into" |
| `turnBlockIntoColumns` | **public** | Special case: block → columnList |
| `turnBlockViaReplace` | private | Generic type swap via editor chain |
| `extractContainerBlocks` | private | Pull blocks from details/toggleHeading |
| `unwrapContainer` | private | Container → flat blocks |
| `swapContainer` | private | Container → different container |
| `buildContainerBlock` | private | Build container JSON |
| `buildLeafBlock` | private | Build leaf block JSON |
| `extractInlineContent` | private | Extract inline content from nested JSON |
| `extractBlockContent` | private | Extract first textblock content |

Dependencies: `@tiptap/core` (Editor), `blockRegistry` (isContainerBlockType).

### blockMovement.ts — Unified Block Movement

ALL positional changes consolidated into one file. Both keyboard-triggered and DnD-triggered
movement share the same primitives.

| Function | Visibility | Trigger | Purpose |
|----------|-----------|---------|---------|
| **Column Utilities** ||||
| `isColumnEffectivelyEmpty` | **public** | both | Check if column has meaningful content |
| `normalizeColumnListAfterMutation` | **public** | both | Dissolve 0/1-column lists, equalize widths |
| `normalizeAllColumnListsAfterMutation` | private | keyboard | Batch normalize all columnLists in doc |
| `resetColumnListWidthsInTransaction` | **public** | DnD | Set all column widths to null (equalize) |
| `deleteDraggedSourceFromTransaction` | **public** | DnD | Remove drag source + clean empty columns |
| `findBlockContext` | private | keyboard | Resolve container/block depth from $pos |
| `nodeHasMeaningfulContent` | private | both | Recursive meaningful-content check |
| **Keyboard Movement** ||||
| `moveBlockUpWithinPageFlow` | **public** | keyboard | Reorder one step up in current container |
| `moveBlockDownWithinPageFlow` | **public** | keyboard | Reorder one step down in current container |
| `moveBlockAcrossColumnBoundary` | **public** | keyboard | Extract from column above/below columnList |
| **DnD Movement Primitives** ||||
| `moveBlockAboveBelow` | **public** | DnD | Insert content above/below target, delete source |
| `createColumnLayoutFromDrop` | **public** | DnD | Wrap target + content in new columnList |
| `addColumnToLayoutFromDrop` | **public** | DnD | Insert new column into existing columnList |
| **Type** ||||
| `BlockMoveResult` | **public** | keyboard | Return type: `{ handled, moved }` |

Dependencies: `@tiptap/core` (Editor), `@tiptap/pm/state` (TextSelection),
`@tiptap/pm/model` (Fragment), `blockRegistry` (PAGE_CONTAINERS).

### blockStateRegistry.ts — Facade

Re-exports everything from all three children. Single import point for blockRegistry.

```typescript
export * from './blockLifecycle.js';
export * from './blockTransforms.js';
export * from './blockMovement.js';
```

---

## Gating Chain (After Refactor)

```
blockStateRegistry/
  blockLifecycle.ts
  blockTransforms.ts
  blockMovement.ts
       ↑
  blockStateRegistry.ts (facade)
       ↑
blockRegistry.ts                (re-exports from blockStateRegistry)
       ↑                              ↑
  extensions/                   canvasMenuRegistry.ts
  plugins/                            ↑
                                   menus/
```

columnDropPlugin.ts imports DnD primitives from blockStateRegistry/blockMovement.ts
directly (not through blockRegistry) because blockRegistry re-exports the plugin itself
— importing through blockRegistry would create a circular dependency.

---

## Consumer Impact

| Consumer | Before | After |
|----------|--------|-------|
| blockRegistry.ts | `export { } from '../mutations/blockMutations.js'` | `export { } from './blockStateRegistry/blockStateRegistry.js'` |
| canvasMenuRegistry.ts | imports from blockRegistry (unchanged) | unchanged |
| blockActionMenu.ts | imports from canvasMenuRegistry (unchanged) | unchanged |
| columnNodes.ts | imports from blockRegistry (unchanged) | unchanged |
| pageBlockNode.ts | imports from blockRegistry (unchanged) | unchanged |
| columnDropPlugin.ts | imports from blockRegistry | imports from blockStateRegistry/blockMovement.ts |

Only two import paths change:
1. blockRegistry's source switches from `blockMutations` → `blockStateRegistry`
2. columnDropPlugin's source switches from `blockRegistry` → `blockMovement` (for movement functions)

---

## Execution Steps

1. ✅ Research — mapped all functions, consumers, and dependencies
2. ✅ Document — this file
3. Create `blockLifecycle.ts` — move 4 functions
4. Create `blockTransforms.ts` — move 2 public + 8 private functions
5. Create `blockMovement.ts` — move 7 existing functions + extract 3 DnD primitives from plugin
6. Create `blockStateRegistry.ts` — facade re-exports
7. Extract DnD primitives from columnDropPlugin → thin shell calling blockMovement
8. Rewire blockRegistry re-exports → point to blockStateRegistry
9. Delete `mutations/blockMutations.ts` and `mutations/` directory
10. Build + test (182 tests must pass)
