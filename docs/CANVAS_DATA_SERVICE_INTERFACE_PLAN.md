# Canvas Data Service Interface Extraction Plan

> **Date:** 2026-02-20  
> **Branch:** `canvas-v2`  
> **Baseline:** 12 files, 182 tests passing (HEAD `0b082cd`)

---

## 1. Problem

`canvasDataService.ts` is a hub in the dependency graph — **8 files** import it directly:

| # | File | Role | Uses |
|---|------|------|------|
| 1 | `main.ts` | Owner — `new CanvasDataService()` | Constructor, `flushPendingSaves()`, `createPage()`, `getPage()` |
| 2 | `canvasEditorProvider.ts` | Wiring — threads to controllers | `scheduleContentSave`, `getPage`, `decodePageContentForEditor`, `onDidSavePage`, `onDidChangePage` |
| 3 | `canvasSidebar.ts` | Direct CRUD (page tree UI) | Full CRUD suite + `onDidChangePage` |
| 4 | `pageChrome.ts` | Direct CRUD (header chrome) | `updatePage`, `getAncestors`, `toggleFavorite`, `duplicatePage`, `archivePage` |
| 5 | **`pageBlockNode.ts`** | Extension — child of blockRegistry | `getPage`, `updatePage`, `decodePageContentForEditor`, `moveBlocksBetweenPagesAtomic`, `appendBlocksToPage`, `onDidChangePage` |
| 6 | **`slashMenu.ts`** | Controller — child of menuRegistry | Pure passthrough (hosts type on `SlashMenuHost`) |
| 7 | **`slashMenuItems.ts`** | Command handlers — child of menuRegistry | `createPage`, `updatePage`, `scheduleContentSave`, `deletePage` |
| 8 | **`blockRegistry.ts`** | Entry point for extensions | Passthrough via `EditorExtensionContext.dataService` |

Files **5–8** are children of entry points (blockRegistry, menuRegistry) that bypass
their entry point by importing the concrete `CanvasDataService` class directly.

This violates the principle established with `CanvasMenuRegistry`:

> **Children of an entry point should receive their dependencies through the entry point,
> not by reaching around it.**

---

## 2. Solution — VS Code Service Interface Pattern

VS Code decouples consumers from concrete service implementations using interfaces
(`IEditorService`, `IWorkspaceContextService`, etc.). Consumers import the interface;
only the composition root imports the concrete class.

We apply the same pattern:

1. **Define `ICanvasDataService`** interface in `canvasTypes.ts` (pure types, no implementation)
2. **Concrete `CanvasDataService`** adds `implements ICanvasDataService`
3. **All consumers** switch from `import type { CanvasDataService }` to `import type { ICanvasDataService }`
4. **Only `main.ts`** keeps the concrete import (it calls `new CanvasDataService()`)

### Dependency graph: before → after

**Before (8 edges to canvasDataService.ts):**
```
main.ts ──────────────────→ canvasDataService.ts
canvasEditorProvider.ts ──→ canvasDataService.ts
canvasSidebar.ts ─────────→ canvasDataService.ts
pageChrome.ts ────────────→ canvasDataService.ts
pageBlockNode.ts ─────────→ canvasDataService.ts  ← bypasses blockRegistry
slashMenu.ts ─────────────→ canvasDataService.ts  ← bypasses menuRegistry
slashMenuItems.ts ────────→ canvasDataService.ts  ← bypasses menuRegistry
blockRegistry.ts ─────────→ canvasDataService.ts  ← entry point importing concrete
```

**After (1 edge to canvasDataService.ts, all others to canvasTypes.ts):**
```
main.ts ──────────────────→ canvasDataService.ts  (only concrete import — construction)
canvasEditorProvider.ts ──→ canvasTypes.ts         (ICanvasDataService interface)
canvasSidebar.ts ─────────→ canvasTypes.ts         (ICanvasDataService interface)
pageChrome.ts ────────────→ canvasTypes.ts         (already imports IPage etc.)
pageBlockNode.ts ─────────→ canvasTypes.ts         (via blockRegistry context type)
slashMenu.ts ─────────────→ canvasTypes.ts         (via SlashMenuHost type)
slashMenuItems.ts ────────→ canvasTypes.ts         (via SlashActionContext type)
blockRegistry.ts ─────────→ canvasTypes.ts         (already imports IPage etc.)
```

The concrete class disappears from the dependency graph for all files except `main.ts`.

---

## 3. Shared Types to Extract

These types are currently defined inline or privately in `canvasDataService.ts` and
need to be shared via `canvasTypes.ts`:

### `PageUpdateData`
The `updates` parameter for `updatePage()`:
```typescript
export type PageUpdateData = Partial<Pick<IPage,
  'title' | 'icon' | 'content' | 'coverUrl' | 'coverYOffset' |
  'fontFamily' | 'fullWidth' | 'smallText' | 'isLocked' | 'isFavorited' |
  'contentSchemaVersion'
>> & { expectedRevision?: number };
```

### `CrossPageMoveParams`
Currently a `private interface` in canvasDataService.ts — used by the public
`moveBlocksBetweenPagesAtomic()` method:
```typescript
export interface CrossPageMoveParams {
  readonly sourcePageId: string;
  readonly targetPageId: string;
  readonly sourceDoc: any;
  readonly appendedNodes: any[];
  readonly expectedSourceRevision?: number;
  readonly expectedTargetRevision?: number;
}
```

### `ICanvasDataService`
Full public method surface:
```typescript
export interface ICanvasDataService {
  // Events
  readonly onDidChangePage: Event<PageChangeEvent>;
  readonly onDidSavePage: Event<string>;
  // CRUD
  createPage(parentId?: string | null, title?: string): Promise<IPage>;
  getPage(pageId: string): Promise<IPage | null>;
  getRootPages(): Promise<IPage[]>;
  getChildren(parentId: string): Promise<IPage[]>;
  getPageTree(): Promise<IPageTreeNode[]>;
  updatePage(pageId: string, updates: PageUpdateData): Promise<IPage>;
  deletePage(pageId: string): Promise<void>;
  // Content operations
  appendBlocksToPage(targetPageId: string, appendedNodes: any[]): Promise<IPage>;
  moveBlocksBetweenPagesAtomic(params: CrossPageMoveParams): Promise<{ sourcePage: IPage; targetPage: IPage }>;
  decodePageContentForEditor(page: IPage): Promise<{ doc: any; recovered: boolean }>;
  // Tree operations
  movePage(pageId: string, newParentId: string | null, afterSiblingId?: string): Promise<void>;
  reorderPages(parentId: string | null, orderedIds: string[]): Promise<void>;
  getAncestors(pageId: string): Promise<IPage[]>;
  // Auto-save
  scheduleContentSave(pageId: string, content: string): void;
  flushPendingSaves(): Promise<void>;
  hasPendingSave(pageId: string): boolean;
  readonly pendingSaveCount: number;
  // Favorites / Archive
  toggleFavorite(pageId: string): Promise<IPage>;
  getFavoritedPages(): Promise<IPage[]>;
  archivePage(pageId: string): Promise<void>;
  restorePage(pageId: string): Promise<IPage>;
  permanentlyDeletePage(pageId: string): Promise<void>;
  getArchivedPages(): Promise<IPage[]>;
  // Duplication
  duplicatePage(pageId: string): Promise<IPage>;
}
```

`SaveStateKind`, `SaveStateEvent`, and `onDidChangeSaveState` stay in
`canvasDataService.ts` — they're internal observability details not consumed
by any external file.

---

## 4. Execution Steps

| Step | File(s) | Change |
|------|---------|--------|
| 1 | `canvasTypes.ts` | Add `Event`/`IDisposable` imports, define `PageUpdateData`, `CrossPageMoveParams`, `ICanvasDataService` |
| 2 | `canvasDataService.ts` | Import shared types from canvasTypes, add `implements ICanvasDataService`, remove inline `CrossPageMoveParams`, use `PageUpdateData` in `updatePage` signature |
| 3 | `blockRegistry.ts` | `import type { ICanvasDataService }` from `canvasTypes.ts`, remove import from `canvasDataService.ts`, change `EditorExtensionContext.dataService` type |
| 4 | `pageBlockNode.ts` | `import type { ICanvasDataService }` from `canvasTypes.ts`, remove import from `canvasDataService.ts`, change `PageBlockOptions.dataService` type |
| 5 | `slashMenuItems.ts` | `import type { ICanvasDataService }` from `canvasTypes.ts`, remove import from `canvasDataService.ts`, change `SlashActionContext.dataService` type |
| 6 | `slashMenu.ts` | `import type { ICanvasDataService }` from `canvasTypes.ts`, remove import from `canvasDataService.ts`, change `SlashMenuHost.dataService` type |
| 7 | `pageChrome.ts` | `import type { ICanvasDataService }` from `canvasTypes.ts`, remove import from `canvasDataService.ts`, change host type |
| 8 | `canvasSidebar.ts` | `import type { ICanvasDataService }` from `canvasTypes.ts`, remove import from `canvasDataService.ts`, change constructor param type |
| 9 | `canvasEditorProvider.ts` | `import type { ICanvasDataService }` from `canvasTypes.ts`, remove import from `canvasDataService.ts`, change all `CanvasDataService` references |
| 10 | Tests | Test files that use the concrete class (`canvasSaveState.test.ts`) keep concrete imports — they test the implementation. `canvasDataService.test.ts` imports `rowToPage` (a function, not the class) — unchanged. |
| 11 | Verify | `get_errors` on all changed files, `npx vitest run` — 182 tests pass |

---

## 5. Files NOT Changed

- **`main.ts`** — Only file that calls `new CanvasDataService()`. Keeps concrete import.
- **Test files** — Tests that subclass or directly exercise the concrete class keep their imports.
- **`canvasDataService.ts`** itself — Keeps all implementation. Gains `implements ICanvasDataService`.

---

## 6. Design Principles Applied

| Principle | How it's applied |
|-----------|-----------------|
| VS Code service interface pattern | `ICanvasDataService` mirrors `IEditorService` pattern — interface in types, concrete in impl |
| Entry-point routing | blockRegistry and menuRegistry children no longer bypass their entry point |
| Single source of types | `canvasTypes.ts` is the canonical home for all canvas data model types |
| Minimal disruption | Pure `import type` swaps — no runtime changes, no behavioral changes |
