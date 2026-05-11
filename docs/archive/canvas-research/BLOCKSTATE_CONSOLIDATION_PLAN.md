# blockStateRegistry Consolidation Plan

> **Date:** 2026-02-20  
> **Branch:** `canvas-v2`  
> **Scope:** Decompose the 653-line `blockMovement.ts` mega-file into focused,
> single-responsibility children. Eliminate duplicated column-normalization
> logic. Ground every function in exactly one file.

---

## 1  Problem Statement

`blockMovement.ts` currently contains **7 distinct concerns** in 653 lines:

| Concern | Lines | Why it doesn't belong here |
|---------|-------|---------------------------|
| Drag session state (get/set/clear) | 24–48 | Shared infrastructure — not movement |
| Column utilities (empty-check, normalize, width reset) | 57–147 | Structural invariants consumed by 3+ callers |
| Source deletion (`deleteDraggedSourceFromTransaction`) | 149–218 | Cleanup after any mutation — not only movement |
| Keyboard movement (up/down/across-column) | 222–377 | ✅ Belongs here |
| DnD movement primitives (above/below/left/right) | 391–530 | ✅ Belongs here |
| Cross-page interfaces | 536–560 | Persistence orchestration types |
| Cross-page movement (`moveBlockToLinkedPage`) | 571–653 | Async persistence — not ProseMirror transactions |

### Bugs and conflicts found

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| B1 | **Duplicate column normalization** — `columnAutoDissolve` and `normalizeColumnListAfterMutation` both dissolve 1-column lists. Both fire on the same transaction chain (explicit call → appendTransaction safety net). Wasteful, fragile. | blockMovement + columnAutoDissolve | Medium |
| B2 | **Dead code** — `return false` after an unconditional `return true` in `moveBlockAcrossColumnBoundary` | blockMovement L376–377 | Low |
| B3 | **`deleteDraggedSourceFromTransaction` fallback** — 25-line heuristic (lines 193–218) exists as a bug workaround for mid-transaction position drift. Only handles 2-column lists. | blockMovement L193–218 | Medium |
| B4 | **columnAutoDissolve re-implements** what `normalizeColumnListAfterMutation` already does — no shared code. Schema change = two places to update. | columnAutoDissolve vs blockMovement | Medium |

---

## 2  Target Architecture

### 2.1  New file structure

```
config/blockStateRegistry/
├── blockStateRegistry.ts      # Two-way gate facade (unchanged role)
├── blockLifecycle.ts          # ✅ Unchanged — clean, focused
├── blockTransforms.ts         # ✅ Unchanged — clean, focused
├── columnInvariants.ts        # NEW — structural rules for column layouts
├── dragSession.ts             # NEW — shared drag state channel
├── blockMovement.ts           # SLIMMED — in-page movement only (~380 lines)
└── crossPageMovement.ts       # NEW — async persistence orchestration (~120 lines)
```

### 2.2  File responsibilities

#### `columnInvariants.ts` (NEW, ~110 lines)
Single source of truth for column structural rules.

**Exports:**
- `isColumnEffectivelyEmpty(columnNode): boolean`
- `normalizeColumnList(tr, columnListPos): void` (renamed for clarity)
- `normalizeAllColumnLists(tr): void`
- `resetColumnListWidths(tr, columnListPos): void` (shortened name)
- `deleteDraggedSource(tr, dragFrom, dragTo): void` (moved from blockMovement)

**Private:**
- `nodeHasMeaningfulContent(node): boolean`

**Consumed by:** blockMovement, columnAutoDissolve, columnNodes (Backspace handler), columnDropPlugin (via facade).

**Imports from facade:** nothing (pure ProseMirror transaction logic, no registry deps).

#### `dragSession.ts` (NEW, ~30 lines)
Shared state channel between drag-start (blockHandles) and drop handlers.

**Exports:**
- `CanvasDragSession` (interface)
- `CANVAS_BLOCK_DRAG_MIME` (const)
- `setActiveCanvasDragSession(session): void`
- `getActiveCanvasDragSession(): CanvasDragSession | null`
- `clearActiveCanvasDragSession(): void`

**Consumed by:** blockHandles (set), columnDropPlugin (read — indirectly), pageBlockNode (read via blockRegistry), crossPageMovement (read + clear).

**Imports from facade:** nothing (pure state, no ProseMirror deps).

#### `blockMovement.ts` (SLIMMED, ~380 lines)
In-page positional changes — keyboard and DnD.

**Exports (kept):**
- `BlockMoveResult` (interface)
- `moveBlockUpWithinPageFlow(editor): BlockMoveResult`
- `moveBlockDownWithinPageFlow(editor): BlockMoveResult`
- `moveBlockAcrossColumnBoundary(editor, direction): boolean`
- `moveBlockAboveBelow(tr, content, insertPos, dragFrom, dragTo, isDuplicate): void`
- `createColumnLayoutFromDrop(tr, schema, content, ...): boolean`
- `addColumnToLayoutFromDrop(tr, doc, schema, content, ...): boolean`

**Private (kept):**
- `findBlockContext($pos)`

**Imports from facade:**
- `PAGE_CONTAINERS` (inward gate, already wired)
- `isColumnEffectivelyEmpty` (from columnInvariants via facade)
- `normalizeColumnList` (from columnInvariants via facade)
- `normalizeAllColumnLists` (from columnInvariants via facade)
- `resetColumnListWidths` (from columnInvariants via facade)
- `deleteDraggedSource` (from columnInvariants via facade)

**Removed from this file:**
- Drag session (→ dragSession.ts)
- Column utilities (→ columnInvariants.ts)
- `deleteDraggedSourceFromTransaction` (→ columnInvariants.ts)
- Cross-page interfaces and `moveBlockToLinkedPage` (→ crossPageMovement.ts)

#### `crossPageMovement.ts` (NEW, ~120 lines)
Async persistence orchestration for cross-page block transfers.

**Exports:**
- `ICrossPageMoveDataAccess` (interface)
- `CrossPageMoveParams` (interface)
- `moveBlockToLinkedPage(params): Promise<boolean>`

**Imports from facade:**
- `getActiveCanvasDragSession` (from dragSession via facade)
- `clearActiveCanvasDragSession` (from dragSession via facade)
- `CANVAS_BLOCK_DRAG_MIME` (from dragSession via facade)
- `deleteDraggedSource` (from columnInvariants via facade)

### 2.3  Updated facade (`blockStateRegistry.ts`)

```typescript
// ── Inward gate ─────────────────────────────────────────────────────────
export { PAGE_CONTAINERS, isContainerBlockType } from '../blockRegistry.js';

// ── Outward gate: children ──────────────────────────────────────────────
export * from './columnInvariants.js';
export * from './dragSession.js';
export * from './blockLifecycle.js';
export * from './blockTransforms.js';
export * from './blockMovement.js';
export * from './crossPageMovement.js';

// ── Column plugins ──────────────────────────────────────────────────────
export { columnResizePlugin } from '../../plugins/columnResizePlugin.js';
export { columnDropPlugin } from '../../plugins/columnDropPlugin.js';
export { columnAutoDissolvePlugin } from '../../plugins/columnAutoDissolve.js';
```

### 2.4  Updated columnAutoDissolve

Rewired to import `normalizeAllColumnLists` from the facade instead of
re-implementing the logic inline:

```typescript
import { normalizeAllColumnLists } from '../config/blockStateRegistry/blockStateRegistry.js';

appendTransaction(transactions, _oldState, newState) {
  if (!transactions.some(tr => tr.docChanged)) return null;
  const { tr } = newState;
  normalizeAllColumnLists(tr);
  return tr.docChanged ? tr : null;
}
```

This eliminates the duplicate implementation (Bug B4) and makes the
safety-net plugin a one-liner that delegates to the canonical invariant
enforcement function.

### 2.5  Bug fixes included

| Bug | Fix |
|-----|-----|
| B1 | columnAutoDissolve delegates to `normalizeAllColumnLists` — one implementation |
| B2 | Dead `return false` removed from `moveBlockAcrossColumnBoundary` |
| B3 | `deleteDraggedSource` fallback preserved but now lives in columnInvariants where it can be tested independently |
| B4 | Same as B1 — no more re-implementation |

---

## 3  Execution Plan

### Phase 1: Create new files (no breaking changes)

1. **Create `columnInvariants.ts`** — move column utilities + `deleteDraggedSourceFromTransaction` (renamed `deleteDraggedSource`) + private helpers.
2. **Create `dragSession.ts`** — move drag session interface, MIME constant, singleton state.
3. **Create `crossPageMovement.ts`** — move cross-page interfaces + `moveBlockToLinkedPage`. Import drag session + column invariants from facade.

### Phase 2: Rewrite existing files

4. **Rewrite `blockMovement.ts`** — remove extracted code, import from facade.
5. **Rewrite `columnAutoDissolve.ts`** — delegate to `normalizeAllColumnLists`.
6. **Fix dead code** — remove unreachable `return false` in `moveBlockAcrossColumnBoundary`.

### Phase 3: Update wiring

7. **Update `blockStateRegistry.ts`** — add `export *` for new children.
8. **Update `blockRegistry.ts`** re-exports — ensure all renamed symbols are re-exported.
9. **Update consumer imports** — `columnNodes.ts`, `columnDropPlugin.ts`, `pageBlockNode.ts` may need symbol name adjustments.

### Phase 4: Verify

10. `tsc --noEmit` — zero errors.
11. `npm run build` — clean esbuild.
12. `npx vitest run` — 182/182 tests pass.

---

## 4  Symbol Rename Map

| Old name | New name | Rationale |
|----------|----------|-----------|
| `normalizeColumnListAfterMutation` | `normalizeColumnList` | Shorter, the "after mutation" context is obvious |
| `resetColumnListWidthsInTransaction` | `resetColumnListWidths` | Shorter, `tr` param already signals "in transaction" |
| `deleteDraggedSourceFromTransaction` | `deleteDraggedSource` | Same reasoning |
| `normalizeAllColumnListsAfterMutation` | `normalizeAllColumnLists` | Same reasoning |

All old names will be re-exported as aliases from `columnInvariants.ts` during
the transition to avoid breaking consumers. These aliases can be removed later.

---

## 5  Verification Criteria

- [ ] `tsc --noEmit` — zero errors
- [ ] `npm run build` — clean
- [ ] `npx vitest run` — 182/182 pass
- [ ] No file in `blockStateRegistry/` imports from `../blockRegistry.js` (only facade)
- [ ] `columnAutoDissolve` contains zero ProseMirror tree-walking logic
- [ ] `blockMovement.ts` < 400 lines
- [ ] No dead code (`return` after `return`)
- [ ] Graph visualization shows clean parent→child edges
