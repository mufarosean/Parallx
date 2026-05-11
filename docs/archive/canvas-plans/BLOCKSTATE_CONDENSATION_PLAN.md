# BlockStateRegistry Logic Condensation Plan

> **Milestone:** Transition from structural architecture work to logic refinement.  
> **Scope:** Phase 1 — condense single-block operations. Multi-block selection is Phase 2.  
> **Branch:** `canvas-v2`  
> **Date:** 2026-02-22

---

## Context

BlockStateRegistry (BSR) handles everything related to what we can do to a block:
create, delete, move, duplicate, turn-into, and restyle. After the gate architecture
hardening (commits `b4d62af`–`9ad3c5a`), the structural rules are enforced. Now the
focus shifts to **logic quality** — eliminating duplicate paths, unifying patterns,
and establishing primitives that Phase 2 (multi-block) can build on.

## Problems Found

| # | Problem | Severity | Files |
|---|---------|----------|-------|
| P1 | Two independent "dissolve column when it empties" code paths | High | `blockMovement.ts`, `columnInvariants.ts` |
| P2 | `normalizeColumnList` resets user-resized widths (correct per Notion, but undocumented) | Medium | `columnInvariants.ts` |
| P3 | Two dispatch patterns (raw `tr` vs `editor.chain()`) in same file | Low | `blockLifecycle.ts` |
| P4 | Six independent "find block in container" depth-walk implementations | Medium | `blockMovement.ts`, `columnDropPlugin.ts`, `columnResizePlugin.ts`, `columnInvariants.ts` |
| P5 | ~40 lines of debug logging in production code | Low | `columnCreation.ts` |
| P6 | Five dead backward-compat aliases | Low | `columnInvariants.ts`, `blockRegistry.ts` |

## Steps

### Step 1: Remove backward-compat aliases ✅

- **`columnInvariants.ts`** — delete the 5 alias re-exports at bottom
- **`blockRegistry.ts`** — remove the 4 alias re-exports
- **`columnNodes.ts`** — change `normalizeColumnListAfterMutation` → `normalizeColumnList`
- Update docs that reference old names

### Step 2: Remove debug logging from `turnBlockIntoColumns` ✅

- **`columnCreation.ts`** — strip `console.group`/`console.log`/`requestAnimationFrame` diagnostic code

### Step 3: Extract shared `resolveBlockAncestry` utility ✅

Create a shared exported helper in `columnInvariants.ts`:

```ts
resolveBlockAncestry($pos: ResolvedPos): {
  containerDepth: number;
  containerNode: Node;
  blockDepth: number;
  blockNode: Node;
  columnDepth?: number;
  columnNode?: Node;
  columnListDepth?: number;
  columnListNode?: Node;
}
```

Retarget 6 independent depth-walk implementations:
- `blockMovement.ts` → `findBlockContext`, `moveBlockAcrossColumnBoundary`
- `columnDropPlugin.ts` → `resolveBlockTarget`
- `columnInvariants.ts` → `deleteDraggedSource`

Note: `columnResizePlugin.ts` (`findColumnPos`) and `columnDropPlugin.ts` (`resolveNearestBlockInColumn`) use DOM→position resolution starting from `view.posAtDOM()`, not from an existing `$pos`. They need a DOM element as input, not a resolved position. These stay as-is — they serve a different entry point (DOM coordinates vs. selection).

### Step 4: Unify "column empties after block removal" logic ✅

Consolidate into a single function in `columnInvariants.ts`:

```ts
cleanupAfterBlockRemoval(tr: Transaction, sourcePos: number): void
```

Both `moveBlockAcrossColumnBoundary` and `deleteDraggedSource` use this.

### Step 5: Unify dispatch pattern in `blockLifecycle.ts` ✅

Standardize all 4 functions to: raw `tr` → single `view.dispatch(tr)` → `editor.commands.focus()`.

### Step 6: Document the width redistribution contract ✅

Add JSDoc to `normalizeColumnList` documenting the Notion-aligned equal-distribution behavior.

## Verification

- `node scripts/build.mjs` — clean build
- `npx vitest run` — all tests pass
- Manual: create 3 columns → delete middle → remaining 2 equalize
- Manual: keyboard-move block out of column → columns redistribute
- Manual: DnD block out of column → same behavior

## Decisions

- **Scope:** Condense single-block first; multi-block selection is Phase 2
- **Width redistribution:** Remaining columns always equalize (Notion behavior)
- **Aliases:** Remove all 5 (one consumer migrated, rest docs-only)
- **Position utility:** In `columnInvariants.ts` (not a new file) to respect gate rules
- **Dispatch:** Standardize on raw `tr` + `dispatch` + `focus()`
