# Canvas Subpage System — Audit Fixes

Branch: `milestone-58`. Scope: `src/built-in/canvas/`. No changes outside the canvas surface.

## Architecture recap

Two parallel representations of hierarchy:

1. **Authoritative** — `pages.parent_id` column. Source of truth. Drives sidebar tree, breadcrumbs, archive cascade, FK cascade-delete.
2. **Visual** — `pageBlock` TipTap atom embedded in the parent's doc. `attrs.pageId/title/icon/parentPageId`. Drives the in-canvas card.

Per the existing comment in `canvasDataService.ts`, `parent_id` is the single source of truth and pageBlock content is a *visual subsystem that follows parentId, not the other way around*. The fixes below close every gap where that contract is currently violated.

## Issues found and fixes

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | High | `movePage` accepts a target inside the moved subtree → cycles, invisible orphan trees, potential infinite recursion | Reject moves whose `newParentId` is a descendant of `pageId` (ancestor walk + self-check) |
| 2 | High | Deleting a `pageBlock` node in the editor leaves the linked page row intact (orphaned, but still nested in sidebar) | Diff pageBlock IDs across transactions in `canvasEditorProvider`. Removed → `archivePage`. Re-added (e.g. undo) → `restorePage` |
| 3 | High | `_removePageBlockFromParent` only walks `doc.content` top-level. pageBlocks inside columns/callouts/details survive a reparent | Recursive walk reusing the same shape as `_pruneLinkedBlocks` |
| 4 | High | `restorePage` flips a single row. Subtree stays archived; pruned pageBlock cards are never re-inserted | Cascade restore over the subtree via recursive CTE; for each restored child whose parent is not archived, idempotently re-append its pageBlock card |
| 5 | High | `deletePage` / `permanentlyDeletePage` cancel pending saves for the root only — descendants' debounced timers fire against deleted rows | Iterate `deletedIds`; cancel pending + retry for every descendant |
| 6 | High | `moveBlockToLinkedPage` does two independent writes (append target, then dispatch source-delete). Failure between them = duplicated blocks | Route through `moveBlocksBetweenPagesAtomic` — compute source doc post-delete in JSON, persist atomically, then apply the matching editor transaction |
| 7 | High | Cross-page append fires `onDidChangePage(content)` but the editor only reloads on `onRequestContentReload`. Target page open in another pane stays stale | `fireContentReload(targetPageId)` after cross-page persistence |
| 8 | Medium | `pageBlock.attrs.title/icon` is denormalized cache. Renames while parent is closed leave persistent stale attrs in stored content | Add `_updateLinkedBlocksForPageId(pageId, {title, icon})`; call from `updatePage` when title/icon changes. Walk all pages (incl. archived) |
| 9 | Medium | `_appendPageBlockToParent` doesn't dedupe — retries / races can produce duplicate cards | Skip append if a pageBlock referencing `childPage.id` already exists anywhere in the parent's doc |
| 10 | Medium | `_removeLinkedBlocksForPageId` filters `WHERE is_archived = 0`, leaving dangling references in archived parents | Drop the filter — prune everywhere |
| 11 | Medium | `_duplicateRecursive` has no depth cap. With #1 fixed cycles can't be created via `movePage`, but residual corruption from prior versions can still loop | `MAX_DEPTH = 64` guard + visited-id set |
| 12 | Low | `pageBlockNode.attrs.parentPageId` is set but never read | Remove from schema + insertion sites |
| 13 | Low | `restorePage` fires `PageChangeKind.Created` (not "restored") | Change to `Updated` with explicit changedFields |
| 14 | Low | Orphan nodes in `_assembleTree` are silently rerouted to root | `console.warn` once per orphan |
| 15 | Low | Dead-reference resilience in node-view: shows "Untitled" forever if linked page is gone | Render a clearly-broken state and allow removing the orphan card via icon picker remove (already exists) |

## Order of work

1. **Data integrity** (1, 5, 11, 14) — pure data-service, no UI surface.
2. **Recursive prune / dedupe** (3, 9, 10) — sidebar + data-service helper alignment.
3. **Restore symmetry** (4) — data-service.
4. **Cross-page atomicity** (6, 7) — `crossPageMovement.ts` + data-service.
5. **Denormalized attrs reconciler** (8, 12, 13) — data-service + pageBlockNode + invariants test.
6. **Editor-side pageBlock deletion hook** (2) — `canvasEditorProvider.ts`.
7. **Validate** — typecheck, build, full test suite.

## Acceptance

- Every change keeps `parent_id` as the single source of truth.
- Every cross-page write goes through the atomic API or one explicit single-row update.
- Every code path that mutates the page set or the embedded pageBlock graph is reflected in both layers (DB row + parent doc) within a single async chain that either fully succeeds or rolls back / surfaces an error.
- All existing tests pass; new behavior is covered by the existing structural invariants where applicable.

## Status — completed

All 15 issues landed.

| # | Status | Where |
|---|---|---|
| 1 | ✅ | `canvasDataService.ts` `movePage` — descendant-cycle guard + self-parent guard |
| 2 | ✅ | `canvasEditorProvider.ts` — `_pageBlockIds` snapshot + `_reconcilePageBlockHierarchy` on every doc-changed transaction |
| 3 | ✅ | `canvasDataService.ts` — public `removePageBlockFromParent` (recursive prune); `canvasSidebar.ts` calls it instead of its old shallow filter |
| 4 | ✅ | `canvasDataService.ts` `restorePage` — recursive-CTE subtree unarchive + idempotent re-append of cards under non-archived parents |
| 5 | ✅ | `canvasDataService.ts` `deletePage` / `permanentlyDeletePage` — iterate subtree IDs and cancel pending + retry saves for every descendant |
| 6 | ✅ | `crossPageMovement.ts` — single atomic `moveBlocksBetweenPagesAtomic` write computed from `removeNodesByIds(editor.getJSON(), idSet)`; editor delete dispatched after success |
| 7 | ✅ | `crossPageMovement.ts` — `dataService.fireContentReload(targetPageId)` after every cross-page persistence path |
| 8 | ✅ | `canvasDataService.ts` — new `_updateLinkedBlocksForPageId` reconciler + `_retitleLinkedBlocks` walker; called from `updatePage` whenever `title` or `icon` changes |
| 9 | ✅ | `canvasDataService.ts` — public `ensurePageBlockOnParent` (idempotent, guarded by `_docContainsPageBlock`); `canvasSidebar.ts` uses it everywhere |
| 10 | ✅ | `canvasDataService.ts` `_removeLinkedBlocksForPageId` — `WHERE is_archived = 0` filter dropped |
| 11 | ✅ | `canvasDataService.ts` `_duplicateRecursive` — `MAX_TREE_DEPTH = 64` + visited-set cycle break |
| 12 | ✅ | `pageBlockNode.ts` schema — `parentPageId` attr removed; `blockRegistry.ts` slash insert no longer writes it; `canvasSidebar` no longer writes it |
| 13 | ✅ | `canvasDataService.ts` `restorePage` — fires `PageChangeKind.Updated` with `changedFields: ['isArchived']`. Added `PageMutationField` type and propagated through main.ts/canvasTypes.ts |
| 14 | ✅ | `canvasDataService.ts` `_assembleTree` — orphan branch now logs `console.warn` |
| 15 | ✅ | `pageBlockNode.ts` `syncLinkedPageMeta` — broken state ("(deleted page)" + `canvas-page-block--broken` class). CSS rule added in `canvas.css` |

Validation: `tsc --noEmit` clean, `vitest run` 2486/2486 tests passing.
