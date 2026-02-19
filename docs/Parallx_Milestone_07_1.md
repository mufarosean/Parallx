# Milestone 7.1 — Architectural Hardening & Bug Fixes

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 7.1.
> All implementation must conform to the structures and boundaries defined here.
> Changes MUST preserve all existing user-visible functionality — no breaking changes, no feature removals.
> Every fix includes a dependency map and verification checklist.

---

## Milestone Definition

### Vision

The Parallx workbench reaches **production-grade reliability** across its core architectural systems. Every critical bug, memory leak, race condition, and structural debt item identified in the February 2026 senior architectural review is resolved — without altering the user-facing behavior, tool API contract, or dependency graph topology.

### Purpose

Milestone 7 delivered a Notion-quality Canvas editor through monolith decomposition, a unified interaction model, and block type expansion. But a deep architectural review of the full codebase (all 17 source modules, ~100+ files) revealed:

1. **6 critical bugs** — data loss, zombie models, stale caches, listener leaks, dropped inputs, connection races
2. **4 structural concerns** — a 3,916-line god object, fragile CSS build, async disposal gap, broken event semantics
3. **4 memory/disposal issues** — raw arrays instead of DisposableStore, unbounded subscription growth, GC-dependent cleanup
4. **3 race conditions** — auto-save vs archive, microtask auto-close, multi-IPC transactions
5. **Test coverage gaps** — zero unit tests for Grid, EditorPart, ViewContainer, CommandContribution, FileService, KeybindingService
6. **Build system fragility** — manual CSS concatenation that silently breaks on new files

This milestone addresses all of the above systematically, in dependency order, with verification gates between tiers.

### What Success Looks Like

1. **Zero data loss paths** — auto-save failures retry and notify; no stale cache reads; no zombie models
2. **Clean disposal** — every emitter subscription tracked in DisposableStore; async tool teardown awaited
3. **No race conditions** — database mutex, auto-save cancellation on archive, generation-counted cache
4. **God object decomposed** — `workbench.ts` split into 6+ focused modules, composition root ≤1,800 lines
5. **CSS build automated** — esbuild CSS imports replace manual concatenation
6. **Core systems unit-tested** — Grid, CommandContribution, FileService have targeted unit tests
7. **All existing tests pass** — 67 unit + 41 E2E tests remain green throughout

### Structural Commitments

- **No behavioral changes.** Every fix is internal — no user-visible behavior changes unless explicitly noted.
- **No dependency graph changes.** Module boundaries and import directions remain the same.
- **No new dependencies.** Same TypeScript + esbuild + Electron + Tiptap stack.
- **Incremental and verifiable.** Each fix is independently testable. Build + tests after every change.
- **Tier ordering is mandatory.** Tier 1 (bugs) before Tier 2 (structural) before Tier 3 (hardening) before Tier 4 (polish).

---

## Architecture Context

### Module Dependency Matrix (Relevant Subset)

```
platform/          ← foundation (events, lifecycle, uri, types, storage, fileTypes)
  ↑
services/          ← fileService, textFileModelManager, databaseService, keybindingService,
  ↑                  editorResolverService, layoutService, themeService, etc.
  ↑
layout/            ← grid.ts, gridNode.ts, gridView.ts, layoutModel.ts, layoutRenderer.ts
parts/             ← editorPart.ts, statusBarPart.ts, auxiliaryBarPart.ts
views/             ← viewContainer.ts, viewManager.ts
editor/            ← editorGroup.ts, editorGroupView.ts, editorInput.ts, editorPane.ts
commands/          ← commandRegistry.ts, quickAccess.ts
context/           ← contextKey.ts, focusTracker.ts, whenClause.ts
tools/             ← toolActivator.ts, toolRegistry.ts, toolScanner.ts
api/               ← apiFactory.ts, bridges/*
contributions/     ← commandContribution.ts, viewContribution.ts, menuContribution.ts
configuration/     ← configurationService.ts, configurationRegistry.ts, toolMemento.ts
  ↑
workbench/         ← workbench.ts (composition root — imports from ALL above)
  ↑
main.ts            ← entry point (imports workbench.ts only)
```

### Boot Lifecycle (5 Phases)

| Phase | Name | What Happens |
|-------|------|------------|
| 1 | Services | DI container populated, all service singletons created |
| 2 | Layout | Grid created, root DOM structure built |
| 3 | Parts | EditorPart, StatusBar, Sidebar, AuxiliaryBar initialized |
| 4 | Restore | Last workspace loaded, editor tabs restored, tool activation begins |
| 5 | Ready | Focus set, watermark shown/hidden, app fully interactive |

Teardown reverses phases 5→1.

---

## Tier 1 — Critical Bug Fixes (Do First)

> **Goal:** Eliminate data loss, resource leaks, and broken state bugs.
> **Prerequisite:** None. These are independent fixes.
> **Constraint:** Each fix must be verified in isolation before proceeding.

---

### 1.1 Auto-Save Failure Silently Loses Content

**Severity:** Critical — user data loss
**File:** `src/built-in/canvas/canvasDataService.ts` (~902 lines)
**Location:** The debounced auto-save callback that fires `updatePageContent()` via IPC

**Problem:**
The debounced auto-save fires an IPC call to persist page content to SQLite. If the IPC call fails (Electron crash, SQLite lock contention, disk full), the error is caught and logged — but the dirty content is **discarded with no retry**. The user's edits are silently lost. There is no retry queue, no persistent dirty-flag preservation, and no user notification.

**Current behavior:**
1. User edits content → Tiptap `onUpdate` fires
2. Debounced save schedules `updatePageContent(pageId, json)` via IPC
3. IPC fails → `catch` logs error → **content lost**
4. Next `onUpdate` only saves the *next* edit, not the failed one

**Root cause:** Fire-and-forget IPC with no retry mechanism.

**Fix:**
1. Add a retry queue: `Map<string, { content: JSONContent; retries: number; timer: ReturnType<typeof setTimeout> }>`
2. On IPC failure: re-queue with exponential backoff (1s → 2s → 4s), max 3 retries
3. On final failure: set `SaveStateKind.Failed` on the page model and fire `INotificationService.warn()` so the user sees the failure
4. On next successful save for that page: drain any queued content
5. Ensure the retry queue is flushed during `dispose()` (best-effort final save attempt)

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/built-in/canvas/canvasEditorProvider.ts` | Consumes `canvasDataService` | `onUpdate` callback still works; no changes to editor→service contract |
| `src/built-in/canvas/canvasTypes.ts` | Type definitions | `SaveStateKind` enum may need a new `Retrying` state |
| `src/built-in/canvas/contentSchema.ts` | Content validation | Retry queue content must pass schema validation before re-save |
| `tests/unit/canvasSaveState.test.ts` | Existing tests | Must continue passing; add new retry-specific tests |
| `tests/unit/canvasDataService.test.ts` | Existing tests | Must continue passing |

**Verification:**
- [ ] Unit test: simulate IPC failure → verify content queued for retry
- [ ] Unit test: simulate 3 failures → verify `SaveStateKind.Failed` + notification
- [ ] Unit test: simulate failure then success → verify queued content saved
- [ ] `npm run build` — zero errors
- [ ] All 67 unit tests pass
- [ ] Manual test: quick edits while Electron IPC is delayed — no content loss

---

### 1.2 Half-Initialized TextFileModel Left in Map

**Severity:** Critical — corrupted state leading to broken editor tabs
**File:** `src/services/textFileModelManager.ts` (~352 lines)
**Location:** `createModel()` method

**Problem:**
When `createModel()` is called, a new `TextFileModel` instance is created and inserted into the `_models: Map<string, TextFileModel>` **before** `resolve()` is awaited. If `resolve()` fails (file deleted between open and read, permission denied, IPC timeout), a zombie model with no content sits in the map. Subsequent `getModel(uri)` calls return this broken instance, and the editor shows empty/broken content.

**Current behavior:**
```typescript
const model = new TextFileModel(uri, this._fileService);
this._models.set(uri.toString(), model);  // ← inserted BEFORE resolve
await model.resolve();                     // ← can fail, leaving zombie
```

**Root cause:** Map insertion before async initialization completes.

**Fix:**
Use a two-phase creation pattern:
1. Store a `Promise<TextFileModel>` in a pending map: `_pendingModels: Map<string, Promise<TextFileModel>>`
2. `createModel()` creates the promise, stores it, awaits it
3. On success: move from `_pendingModels` to `_models`
4. On failure: remove from `_pendingModels`, dispose the partial model, throw
5. `getModel()` checks `_models` first, then `_pendingModels` (for concurrent callers)

**Alternative (simpler):** Keep the current map structure but wrap the resolve in a try/catch that removes the entry on failure:
```typescript
const model = new TextFileModel(uri, this._fileService);
this._models.set(key, model);
try {
    await model.resolve();
} catch (e) {
    this._models.delete(key);
    model.dispose();
    throw e;
}
```

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/services/serviceTypes.ts` | Interface `ITextFileModelManager` | Interface contract unchanged |
| `src/workbench/workbenchServices.ts` | Instantiates `TextFileModelManager` | No change needed |
| `src/built-in/editor/fileEditorInput.ts` | Calls `getModel()` / `createModel()` | Must handle thrown errors gracefully |
| `src/services/fileService.ts` | `TextFileModel` depends on `IFileService.readFile()` | readFile failures must be catchable |

**Verification:**
- [ ] Unit test: `createModel()` with non-existent file → verify model NOT in map after error
- [ ] Unit test: concurrent `createModel()` calls for same URI → no duplicate creation
- [ ] Unit test: `getModel()` after failed creation → returns `undefined`
- [ ] `npm run build` — zero errors
- [ ] All 67 unit tests pass

---

### 1.3 TOCTOU Race Condition in FileService Cache

**Severity:** High — stale data served to editors indefinitely
**File:** `src/services/fileService.ts` (~396 lines)
**Location:** LRU content cache population in `readFile()` and invalidation in `writeFile()`

**Problem:**
The LRU content cache has a time-of-check/time-of-use (TOCTOU) race:
1. Caller A calls `readFile(uri)` → IPC to main process fires (async)
2. Caller B calls `writeFile(uri, newContent)` → IPC fires, cache key invalidated
3. Caller A's IPC returns with the **old** content → cache populated with stale data

All subsequent `readFile(uri)` calls return stale content until the 20-entry LRU evicts it.

**Current behavior:**
- `readFile()`: check cache → miss → IPC → **set cache with result**
- `writeFile()`: invalidate cache → IPC → set cache with new content
- No coordination between concurrent read and write

**Root cause:** No generation tracking between cache invalidation and cache population.

**Fix:**
Add a per-URI generation counter:
```typescript
private _cacheGeneration = new Map<string, number>();

async readFile(uri: URI): Promise<string> {
    const key = uri.toString();
    // ... cache hit path unchanged ...
    const gen = (this._cacheGeneration.get(key) ?? 0);
    const content = await this._ipc.readFile(uri.path);
    // Only cache if no write happened during our read
    if ((this._cacheGeneration.get(key) ?? 0) === gen) {
        this._cache.set(key, content);
    }
    return content;
}

async writeFile(uri: URI, content: string): Promise<void> {
    const key = uri.toString();
    this._cacheGeneration.set(key, (this._cacheGeneration.get(key) ?? 0) + 1);
    this._cache.delete(key);
    await this._ipc.writeFile(uri.path, content);
    this._cache.set(key, content);
}
```

~15 lines of code. No behavioral change — just correctness.

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/services/serviceTypes.ts` | Interface `IFileService` | Public API unchanged |
| `src/workbench/workbenchServices.ts` | Instantiates `FileService` | No change needed |
| `src/services/textFileModelManager.ts` | Calls `readFile()` / `writeFile()` | Still gets correct content |
| `src/built-in/explorer/main.ts` | Uses `IFileService` for file tree | No API change |
| `src/api/bridges/fileSystemBridge.ts` | Bridges `IFileService` to tool API | No API change |

**Verification:**
- [ ] Unit test: concurrent read + write → verify cache contains new content
- [ ] Unit test: read during write → verify stale content NOT cached
- [ ] `npm run build` — zero errors
- [ ] All 67 unit tests pass
- [ ] Manual test: edit file externally while open in editor → correct content shown

---

### 1.4 Notification Center Listener Leak

**Severity:** High — memory leak, growing event listener count
**File:** `src/workbench/workbench.ts` (~3,916 lines)
**Location:** Notification center overlay show/hide logic

**Problem:**
When the notification center overlay is shown, a `document.addEventListener('keydown', handler)` is added to detect Escape-to-close. This listener is **only removed when Escape is pressed**. If the user dismisses the overlay by clicking the backdrop (overlay click handler), the keydown listener **remains attached to the document** indefinitely. Each open-then-click-dismiss cycle adds another dangling `keydown` listener.

**Current behavior:**
```typescript
// On show:
const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
        document.removeEventListener('keydown', handler);
        this._hideNotificationCenter();
    }
};
document.addEventListener('keydown', handler);

// On backdrop click:
this._hideNotificationCenter();  // ← handler NOT removed!
```

**Root cause:** Listener cleanup only in Escape path, not in all dismiss paths.

**Fix:**
Store the handler reference and remove it in `_hideNotificationCenter()` itself, so every dismiss path cleans up:
```typescript
// On show:
this._notificationKeydownHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
        this._hideNotificationCenter();
    }
};
document.addEventListener('keydown', this._notificationKeydownHandler);

// In _hideNotificationCenter():
if (this._notificationKeydownHandler) {
    document.removeEventListener('keydown', this._notificationKeydownHandler);
    this._notificationKeydownHandler = null;
}
```

Better yet, use a `DisposableStore` scoped to the overlay's visible lifetime (matches the project's disposal pattern).

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/workbench/workbench.ts` | Self-contained change | No external API changes |
| `src/api/notificationService.ts` | Fires notification events | Not affected — fix is in DOM layer only |

**Verification:**
- [ ] Manual test: open notification center → click backdrop → open again → verify only 1 keydown listener
- [ ] Manual test: open notification center → press Escape → verify listener removed
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

### 1.5 Canvas Editor Async `init()` Fire-and-Forget

**Severity:** High — editor pane returned before initialization completes, inputs can be dropped
**File:** `src/built-in/canvas/canvasEditorProvider.ts` (~348 lines)
**Location:** `createEditorPane()` and `init()` method

**Problem:**
`createEditorPane()` calls `init()` (async) without awaiting the returned promise. The editor pane is returned to `EditorGroupView` immediately — before Tiptap is initialized, before content is loaded from SQLite, before event listeners are wired. If `EditorGroupView` calls `setInput()` before `init()` resolves, the editor silently drops the input because the Tiptap instance doesn't exist yet.

**Current behavior:**
```typescript
createEditorPane(): EditorPane {
    const pane = new CanvasEditorPane(...);
    pane.init();  // ← async, NOT awaited
    return pane;  // ← returned before ready
}
```

**Root cause:** Async initialization called fire-and-forget.

**Fix:**
Implement a ready-gate pattern (already proven in other parts of the codebase):
```typescript
class CanvasEditorPane extends EditorPane {
    private _whenReady: Promise<void>;
    private _resolveReady!: () => void;

    constructor(...) {
        super(...);
        this._whenReady = new Promise(resolve => { this._resolveReady = resolve; });
    }

    async init(): Promise<void> {
        // ... existing init logic ...
        this._resolveReady();
    }

    async setInput(input: EditorInput): Promise<void> {
        await this._whenReady;  // ← gate on init completion
        // ... existing setInput logic ...
    }
}
```

This ensures `setInput()` always waits for initialization without changing the factory return type.

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/editor/editorPane.ts` | Base class | `setInput()` signature compatibility — base may need to be async or already is |
| `src/editor/editorGroupView.ts` | Calls `setInput()` on the pane | Must `await` the result if not already |
| `src/built-in/canvas/main.ts` | Registers the `CanvasEditorProvider` | Not affected |
| `src/built-in/canvas/canvasDataService.ts` | Provides data to the pane | Not affected |
| `src/built-in/canvas/config/editorExtensions.ts` | Provides Tiptap extensions | Not affected |
| `src/built-in/canvas/menus/*.ts` | Initialized inside `init()` | Must still be initialized before setInput — guaranteed by ready-gate |

**Verification:**
- [ ] Unit test: `setInput()` called before `init()` completes → verify input is processed (not dropped)
- [ ] Unit test: `setInput()` called after `init()` completes → verify no delay
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass
- [ ] Manual test: open canvas page rapidly → page content always loads

---

### 1.6 Database `openForWorkspace()` Race Condition

**Severity:** Medium — connection leak under concurrent workspace open
**File:** `src/services/databaseService.ts` (~200 lines)
**Location:** `openForWorkspace()` method

**Problem:**
There is no mutex on `openForWorkspace()`. If two callers invoke it concurrently (e.g., workspace restore fires in parallel with an eager tool activation that queries the database), both fire the `database:open` IPC call to the main process. The second response overwrites the `_db` handle, potentially leaving the first connection leaked in the main process. Additionally, `dispose()` calls `close()` as fire-and-forget (async, not awaited), which may not guarantee SQLite journal cleanup.

**Current behavior:**
```typescript
async openForWorkspace(path: string): Promise<void> {
    this._db = await this._ipc.invoke('database:open', path);
    // ← concurrent call overwrites _db
}
```

**Root cause:** No concurrent-call gating.

**Fix:**
Gate with a single promise field:
```typescript
private _openPromise: Promise<void> | null = null;

async openForWorkspace(path: string): Promise<void> {
    if (this._openPromise) {
        return this._openPromise;
    }
    this._openPromise = this._doOpen(path);
    try {
        await this._openPromise;
    } finally {
        this._openPromise = null;
    }
}

private async _doOpen(path: string): Promise<void> {
    if (this._db) {
        await this._close();
    }
    this._db = await this._ipc.invoke('database:open', path);
}
```

Also, ensure `dispose()` awaits `close()`:
```typescript
dispose(): void {
    // Fire-and-forget is necessary since dispose() is sync,
    // but at minimum, null out _db to prevent post-dispose usage
    this._close();
    this._db = null;
    super.dispose();
}
```

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/workbench/workbench.ts` | Creates and calls `openForWorkspace()` during Phase 4 | Ensure only one call path exists during restore |
| `src/built-in/canvas/canvasDataService.ts` | Uses database service for page CRUD | Not affected — uses query methods, not open |
| `electron/database.cjs` | Main process SQLite handler | Verify IPC handler is idempotent for same path |
| `electron/main.cjs` | Registers IPC handlers | Verify no double-registration |

**Verification:**
- [ ] Unit test: two concurrent `openForWorkspace()` calls → only one IPC fires
- [ ] Unit test: `openForWorkspace()` while already open → old connection closed first
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

## Tier 2 — Structural Improvements (Do Next)

> **Goal:** Reduce complexity, improve maintainability, fix architectural patterns.
> **Prerequisite:** All Tier 1 fixes complete and verified.
> **Constraint:** Same dependency graph, same external behavior.

---

### 2.1 Decompose `workbench.ts` (3,916 → ~1,800 lines)

**Severity:** High structural debt — composition root does 10+ jobs
**File:** `src/workbench/workbench.ts`

**Problem:**
`workbench.ts` is the composition root, menu system, SVG icon registry, notification center DOM builder, status bar manager, tool lifecycle coordinator, workspace switcher, editor manager, and more. It violates the Single Responsibility Principle severely. At 3,916 lines, it's the largest file in the codebase by 3x and makes every change risky.

**Current responsibilities to extract:**

| # | Extract To | Responsibility | Est. Lines | Key Methods to Move |
|---|-----------|---------------|-----------|-------------------|
| A | `workbench/menuBuilder.ts` | Menu bar templates, `_buildMenuBar()`, `_createMenu()`, `_buildContextMenu()`, all menu item handlers | ~600 | `_buildMenuBar`, `_createMenu`, `_handleMenuAction`, `_buildRecentWorkspacesMenu` |
| B | `workbench/iconRegistry.ts` | SVG icon map + `_createIconElement()` utility | ~200 | `_ICON_MAP`, `_createIconElement` |
| C | `workbench/notificationCenter.ts` | Overlay DOM construction, show/hide, keydown listener lifecycle | ~250 | `_showNotificationCenter`, `_hideNotificationCenter`, `_buildNotificationOverlay` |
| D | `workbench/statusBarController.ts` | Status bar initial setup, workspace indicator, tool status items | ~300 | `_setupStatusBar`, `_updateWorkspaceIndicator`, `_setupToolStatusItems` |
| E | `workbench/toolLifecycleController.ts` | Tool install/uninstall/activate/deactivate orchestration, built-in tool registration | ~400 | `_initializeToolLifecycle`, `_registerBuiltInTools`, `_activateTool`, `_deactivateTool` |
| F | `workbench/workspaceSwitcher.ts` | Workspace open/close/restore/rebuild, recent workspaces management | ~350 | `_openWorkspace`, `_rebuildWorkspaceContent`, `_restoreEditors`, `_closeWorkspace` |

**After extraction, `workbench.ts` retains:**
- DI container setup (ServiceCollection wire-up)
- 5-phase boot orchestration (`_initServices`, `_initLayout`, `_initParts`, `_restoreWorkspace`, `_markReady`)
- Phase teardown (`dispose()`)
- Module imports and wiring of extracted controllers
- ~1,800 lines (54% reduction)

**Extraction pattern:**
Each extracted module is a class that:
1. Receives dependencies via constructor (services collection or specific service interfaces)
2. Exposes a `create()` or `initialize()` method called by workbench during the appropriate phase
3. Extends `Disposable` for cleanup
4. Does NOT import from `workbench.ts` (no circular dependency)

**Extraction order and dependency chain:**
```
B (iconRegistry) ← no dependencies on other extractions
    ↓
C (notificationCenter) ← may use iconRegistry
    ↓
D (statusBarController) ← may use iconRegistry
    ↓
A (menuBuilder) ← uses iconRegistry, notificationCenter, workspaceSwitcher
    ↓
F (workspaceSwitcher) ← uses statusBarController
    ↓
E (toolLifecycleController) ← uses statusBarController, workspaceSwitcher
```

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/main.ts` | Imports `Workbench` class | Constructor signature unchanged |
| `src/workbench/workbenchServices.ts` | Service wire-up | Not affected — stays in workbench.ts |
| `src/services/serviceTypes.ts` | Service interfaces | Not affected |
| `src/workbench/lifecycle.ts` | Lifecycle phases | Not affected |
| `scripts/build.mjs` | CSS list | New CSS files (if any) must be added — or better, this fix lands after 2.2 |

**Verification per extraction:**
- [ ] `npm run build` — zero errors after each extraction
- [ ] All 67 unit tests pass after each extraction
- [ ] All E2E tests pass after each extraction
- [ ] Manual smoke test: app launches, menus work, notifications work, tools activate, workspace switching works
- [ ] Final line count: `workbench.ts` ≤ 1,800 lines
- [ ] No extracted module exceeds 600 lines
- [ ] No circular dependencies between extracted modules

---

### 2.2 Migrate CSS Build to esbuild Imports

**Severity:** Medium — silent style breakage on any new CSS file
**File:** `scripts/build.mjs` (~70 lines)
**Current:** Manual concatenation of 18 CSS files via `readFileSync` + string join

**Problem:**
The build script manually lists 18 CSS file paths, reads each with `readFileSync`, concatenates them, and writes the result. Every new CSS file requires editing the build script (adding a path variable, a `readFileSync` call, and appending to the concatenation). If a developer adds a new `.css` file and forgets to register it in `build.mjs`, styles silently break — no error, no warning, the build succeeds.

The `existsSync` guard on each file makes accidentally deleting a CSS file also silently succeed.

**Current CSS files concatenated (in order):**
1. `src/workbench.css`
2. `src/parts/titleBar.css`
3. `src/parts/sideBar.css`
4. `src/parts/auxiliaryBar.css`
5. `src/parts/panel.css`
6. `src/contributions/menuContribution.css`
7. `src/contributions/viewContribution.css`
8. `src/views/viewContainer.css`
9. `src/dnd/dropOverlay.css`
10. `src/commands/quickAccess.css`
11. `src/layout/grid.css`
12. `src/api/notificationService.css`
13. `src/ui/contextMenu.css`
14. `src/ui/filterableList.css`
15. `src/ui/tabBar.css`
16. `src/ui/treeView.css`
17. `src/built-in/canvas/canvas.css`
18. `node_modules/katex/dist/katex.min.css`

**Fix:**
Migrate to esbuild's native CSS import support:

1. In each `.ts` module that owns a CSS file, add `import './component.css';`
   - `src/main.ts` → `import './workbench.css';`
   - `src/parts/titleBar.ts` → `import './titleBar.css';`
   - (etc. for all 17 project CSS files)
   - `src/main.ts` → `import 'katex/dist/katex.min.css';` (for KaTeX)

2. Remove the entire CSS concatenation block from `build.mjs`

3. esbuild with `bundle: true` automatically:
   - Discovers all CSS imports from the TS entry point graph
   - Bundles them into a single `main.css` output
   - Handles deduplication and ordering (import order = output order)
   - Supports `minify: true` for production

4. Update `index.html` if the output CSS filename changes

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `scripts/build.mjs` | Build script | Remove CSS concatenation block; verify esbuild config |
| `index.html` | CSS `<link>` tag | Update `href` to match esbuild output path |
| `tsconfig.json` | TypeScript config | May need `"allowArbitraryExtensions": true` or CSS module declaration |
| All `.ts` files with CSS | Need `import './x.css'` | One import per CSS file in the owning module |
| `src/api/parallx.d.ts` | Module declarations | May need `declare module '*.css';` |

**Verification:**
- [ ] `npm run build` — produces bundled CSS identical to current manual concatenation
- [ ] Visual comparison: open app before and after — no style differences
- [ ] Add a new test CSS file, don't register it anywhere except an import → verify it IS bundled
- [ ] Remove the manual CSS block from build.mjs entirely
- [ ] All existing tests pass

---

### 2.3 Async Tool Disposal via `disposeAsync()`

**Severity:** Medium — resource leaks on app shutdown
**File:** `src/tools/toolActivator.ts` (~565 lines)
**Location:** `dispose()` method

**Problem:**
`dispose()` is synchronous (per the `Disposable` base class contract) but calls `deactivate()` on each active tool — which may be async (tools' `deactivate()` handlers can return `Promise<void>`). The returned promises are silently dropped. Tools that need to flush state to disk, close network connections, or perform async cleanup during deactivation **will leak resources** on app shutdown.

**Current behavior:**
```typescript
dispose(): void {
    for (const tool of this._activatedTools.values()) {
        tool.deactivate();  // ← async return value dropped
    }
    super.dispose();
}
```

**Root cause:** Synchronous disposal pattern cannot await async tool teardown.

**Fix:**
Add a `disposeAsync()` method alongside the synchronous `dispose()`:

```typescript
async disposeAsync(): Promise<void> {
    const deactivations = Array.from(this._activatedTools.values()).map(
        tool => tool.deactivate().catch(err => {
            console.error(`[ToolActivator] Failed to deactivate ${tool.id}:`, err);
        })
    );
    await Promise.allSettled(deactivations);
    this.dispose();  // synchronous cleanup of emitters, maps, etc.
}

dispose(): void {
    // Synchronous-only cleanup (for cases where disposeAsync wasn't called)
    this._activatedTools.clear();
    super.dispose();
}
```

Wire the workbench's shutdown path to call `await toolActivator.disposeAsync()` before proceeding with synchronous service disposal:

```typescript
// In workbench.ts Phase 5→1 teardown:
async shutdown(): Promise<void> {
    await this._toolActivator.disposeAsync();
    // ... then synchronous dispose of services ...
}
```

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/workbench/workbench.ts` | Calls `toolActivator.dispose()` during teardown | Change to `await toolActivator.disposeAsync()` |
| `src/tools/toolActivator.ts` | Self — `dispose()` and `_activatedTools` map | `dispose()` remains safe to call without `disposeAsync()` |
| `src/tools/toolRegistry.ts` | Stores tool metadata | Not affected |
| `src/api/apiFactory.ts` | Creates per-tool API | Per-tool `DisposableStore` cleanup happens in `toolActivator` — verify order |
| `src/platform/lifecycle.ts` | `Disposable` base class | No change needed — `disposeAsync` is additive |
| `electron/main.cjs` | App lifecycle — `before-quit` handler | Verify it awaits renderer shutdown signal |

**Verification:**
- [ ] Unit test: tool with async `deactivate()` → verify awaited during `disposeAsync()`
- [ ] Unit test: tool `deactivate()` throws → verify other tools still deactivated (allSettled)
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass
- [ ] Manual test: quit app with active tools → verify no "unfinished async" warnings

---

### 2.4 Fix Per-Tool Event Emitters to Global Semantics

**Severity:** Medium — incorrect API behavior, tools can't observe global lifecycle events
**File:** `src/api/apiFactory.ts` (~560 lines)
**Location:** `parallx.tools.onDidInstallTool` / `onDidUninstallTool` emitter creation

**Problem:**
`parallx.tools.onDidInstallTool` and `parallx.tools.onDidUninstallTool` are created as **per-tool emitters** — each tool's API instance gets its own `Emitter`. When Tool B is installed, Tool A's `onDidInstallTool` listener never fires, because it's subscribed to a different emitter. This contradicts the expected global semantics where tools observe *all* tool lifecycle events.

**Current behavior:**
```typescript
// In createToolAPI(toolId):
const onDidInstallTool = new Emitter<ToolInstallEvent>();
// ← per-tool instance! Only fires for this tool's own events.
```

**Expected behavior:** Any tool's `parallx.tools.onDidInstallTool` should fire when *any* tool is installed globally.

**Fix:**
1. Create shared global emitters in `apiFactory.ts` (one pair, not per-tool):
   ```typescript
   private _globalOnDidInstallTool = new Emitter<ToolInstallEvent>();
   private _globalOnDidUninstallTool = new Emitter<ToolUninstallEvent>();
   ```
2. Each tool's API references the shared emitter's `.event`:
   ```typescript
   onDidInstallTool: this._globalOnDidInstallTool.event,
   onDidUninstallTool: this._globalOnDidUninstallTool.event,
   ```
3. When any tool lifecycle event fires, fire on the global emitter.
4. Keep per-tool scoped events (like `onDidChangeConfiguration`) as-is — those are correctly tool-scoped.

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/api/apiFactory.ts` | Self — emitter creation | Replace per-tool with shared |
| `src/tools/toolActivator.ts` | Fires tool lifecycle events | Verify it fires on the global emitters |
| `src/api/parallx.d.ts` | Type definitions | `ToolsNamespace` types unchanged |
| `src/tools/toolRegistry.ts` | Tool install/uninstall state | Verify event data shape matches |
| Any installed third-party tools | Consumers of `parallx.tools.onDidInstallTool` | Behavior change: they now receive ALL tool events (breaking if tools filter by own ID — but that's the correct semantic) |

**Verification:**
- [ ] Unit test: Tool A subscribes to `onDidInstallTool` → Tool B installed → Tool A's listener fires
- [ ] Unit test: `onDidChangeConfiguration` remains tool-scoped (NOT global)
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

## Tier 3 — Hardening (Do When Stable)

> **Goal:** Eliminate remaining memory issues, race conditions, and coverage gaps.
> **Prerequisite:** All Tier 1 and Tier 2 fixes complete and verified.

---

### 3.1 Replace Raw `_saverListeners` Array with DisposableStore

**Severity:** Low — inconsistent pattern, minor leak risk
**File:** `src/workbench/workbench.ts`

**Problem:**
Multiple `onDid*` event subscriptions are pushed into a plain `IDisposable[]` array and manually iterated in teardown. The rest of the codebase consistently uses `DisposableStore` (which provides `add()`, `clear()`, and automatic tracking). This inconsistency could lead to missed disposal if a new listener is added but the teardown loop isn't updated.

**Fix:**
Replace `private _saverListeners: IDisposable[] = []` with `private _saverListeners = new DisposableStore()`. Replace `.push()` calls with `.add()`. Remove manual iteration in teardown — `DisposableStore.dispose()` handles it.

**Dependencies:** Self-contained in `workbench.ts`. If 2.1 lands first, apply in the appropriate extracted module.

**Verification:**
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

### 3.2 Fix StatusBar Item Subscription Growth

**Severity:** Low — memory growth under rapid show/hide cycling
**File:** `src/api/apiFactory.ts`

**Problem:**
Calling `show()` / `hide()` on a status bar item created via `parallx.window.createStatusBarItem()` grows an internal subscriptions array without cleanup. Each `show()` call adds a new subscription. Rapid show/hide toggling (e.g., a tool polling a status indicator) accumulates listeners.

**Fix:**
Store a single subscription reference; dispose before re-subscribing:
```typescript
private _statusItemDisposable: IDisposable | null = null;

show(): void {
    this._statusItemDisposable?.dispose();
    this._statusItemDisposable = this._statusBar.addItem(...);
}

hide(): void {
    this._statusItemDisposable?.dispose();
    this._statusItemDisposable = null;
}
```

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/api/apiFactory.ts` | Self — status bar item factory | Internal change only |
| `src/parts/statusBarPart.ts` | `addItem()` / remove API | Not affected |
| `src/api/parallx.d.ts` | `StatusBarItem` interface | Not affected |

**Verification:**
- [ ] Unit test: 100 show/hide cycles → subscription count stays at 1
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

### 3.3 ViewContainer Section Header Listener Cleanup

**Severity:** Low — relies on GC instead of explicit cleanup
**File:** `src/views/viewContainer.ts` (~835 lines)

**Problem:**
Section headers in stacked mode get `click` and `keydown` listeners that are never explicitly removed. Cleanup relies on DOM element detachment + garbage collection. While not technically a leak (elements become unreferenced after removal), explicit cleanup aligns with the project's disciplined disposal patterns and prevents issues if references are accidentally retained.

**Fix:**
Track section header listeners in a per-section `DisposableStore`:
```typescript
// When creating section:
const sectionDisposables = new DisposableStore();
sectionDisposables.add(dom.addDisposableListener(header, 'click', ...));
sectionDisposables.add(dom.addDisposableListener(header, 'keydown', ...));
this._sectionDisposables.set(viewId, sectionDisposables);

// When removing section:
this._sectionDisposables.get(viewId)?.dispose();
this._sectionDisposables.delete(viewId);
```

**Dependencies:** Self-contained in `viewContainer.ts`. No external API changes.

**Verification:**
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass
- [ ] Manual test: switch between tabbed and stacked modes repeatedly → no leaked listeners

---

### 3.4 Canvas `_saveDisposables` → DisposableStore

**Severity:** Low — inconsistent pattern
**File:** `src/built-in/canvas/canvasEditorProvider.ts`

**Problem:** Same pattern as 3.1 — `_saveDisposables` is a plain array instead of `DisposableStore`.

**Fix:** Replace with `DisposableStore`. Same mechanical change as 3.1.

**Dependencies:** Self-contained in `canvasEditorProvider.ts`.

**Verification:**
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

### 3.5 Bundle Canvas Transactions as Single IPC Call

**Severity:** Medium — multi-IPC transaction window
**File:** `src/built-in/canvas/canvasDataService.ts`
**Location:** `moveBlocksBetweenPagesAtomic()` method

**Problem:**
`moveBlocksBetweenPagesAtomic()` correctly uses `BEGIN IMMEDIATE TRANSACTION` / `COMMIT`, but sends them as **separate IPC calls** from the renderer to the main process. If the renderer crashes between `BEGIN` and `COMMIT`, the main process's SQLite connection holds an uncommitted transaction. While SQLite's journal-based recovery should handle rollback on connection close, the current `databaseService.dispose()` fires `close()` as fire-and-forget.

**Fix:**
Create a single `database:transaction` IPC handler in the main process that accepts an array of SQL statements and executes them within a single `BEGIN IMMEDIATE` / `COMMIT` block:

```javascript
// electron/database.cjs
ipcMain.handle('database:transaction', (event, statements) => {
    db.exec('BEGIN IMMEDIATE');
    try {
        for (const { sql, params } of statements) {
            db.prepare(sql).run(...params);
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
});
```

Then `moveBlocksBetweenPagesAtomic()` sends a single IPC with all statements.

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `electron/database.cjs` | Main process SQLite handler | Add `database:transaction` IPC handler |
| `electron/preload.cjs` | IPC bridge | Expose `database:transaction` if not already covered by generic invoke |
| `src/services/databaseService.ts` | Service layer | Add `transaction(statements)` method |
| `src/built-in/canvas/canvasDataService.ts` | Consumer | Refactor to use single `transaction()` call |

**Verification:**
- [ ] Unit test: transaction with intentional mid-point failure → verify rollback
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

### 3.6 Cancel Auto-Save on Archive/Reorder

**Severity:** Medium — stale writes to archived pages
**File:** `src/built-in/canvas/canvasDataService.ts`

**Problem:**
A debounced auto-save can fire *after* a page has been archived or reordered, potentially writing stale content to an archived page or overwriting a sort-order change.

**Fix:**
In `archivePage()` and `reorderPages()`:
1. Cancel the pending debounce timer for the affected page(s)
2. If a save is in-flight, mark the result as stale (generation counter per page)

```typescript
archivePage(pageId: string): void {
    this._cancelPendingSave(pageId);  // ← new
    // ... existing archive logic ...
}
```

**Dependencies:** Self-contained in `canvasDataService.ts`. The `_cancelPendingSave` helper already manages the debounce timer map.

**Verification:**
- [ ] Unit test: schedule save → archive page → verify save does NOT fire
- [ ] Unit test: schedule save → reorder → verify save does NOT fire with old order
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

### 3.7 EditorPart `queueMicrotask` Auto-Close — Add Editor Check

**Severity:** Low — theoretical race, mitigated by existing guard
**File:** `src/parts/editorPart.ts` (~622 lines)

**Problem:**
When the last editor in a non-last group closes, group removal is deferred via `queueMicrotask`. If the user opens a new editor in that group during the same microtask turn, the group is still removed — taking the newly opened editor with it. The `if (!group) return` guard prevents double-removal but not loss of the new editor.

**Fix:**
Inside the microtask callback, check if the group has editors before proceeding:
```typescript
queueMicrotask(() => {
    if (!group || group.count > 0) return;  // ← added count check
    this.removeGroup(group);
});
```

**Dependencies:** Self-contained in `editorPart.ts`.

**Verification:**
- [ ] `npm run build` — zero errors
- [ ] All existing tests pass

---

### 3.8 Add Unit Tests for Core Architectural Systems

**Severity:** High coverage gap — complex systems with zero unit tests
**Files:** New test files in `tests/unit/`

**Problem:**
The most complex architectural systems have zero unit tests. All current unit tests focus on the canvas/workspace domain layer. E2E tests provide integration coverage but cannot pinpoint regressions in specific algorithms.

**Priority test targets:**

| System | File | Test Focus | Priority |
|--------|------|-----------|----------|
| Grid `_distributeSizes` | `src/layout/grid.ts` | Multi-child proportional clamping at min/max boundaries | P1 |
| Grid sash resize | `src/layout/grid.ts` | Two-pass clamping, zero-sum invariant, snap detection | P1 |
| FileService cache | `src/services/fileService.ts` | TOCTOU race (after fix 1.3), LRU eviction, boundary checking | P1 |
| CommandContribution wire | `src/contributions/commandContribution.ts` | Proxy→real handler replay, 10s timeout, cleanup on disable | P1 |
| KeybindingService | `src/services/keybindingService.ts` | Chord resolution, editable target exclusion, last-wins | P2 |
| EditorPart group lifecycle | `src/parts/editorPart.ts` | Create/remove/merge groups, microtask auto-close | P2 |
| ViewContainer modes | `src/views/viewContainer.ts` | Tab/stack switching, DnD reorder, state save/restore | P3 |

**New test files:**
- `tests/unit/grid.test.ts`
- `tests/unit/fileService.test.ts`
- `tests/unit/commandContribution.test.ts`
- `tests/unit/keybindingService.test.ts`

**Dependencies:** Tests only — no production code changes. Tests will need mock implementations of services (`IFileService`, `ICommandService`, etc.).

**Verification:**
- [ ] Each new test file runs independently via `npx vitest run tests/unit/<file>`
- [ ] All new tests pass
- [ ] All existing 67 unit tests still pass

---

## Tier 4 — Polish (Final)

> **Goal:** Clean up code smells, remove dead code, add production build support.
> **Prerequisite:** All Tier 1–3 fixes complete and verified.

---

### 4.1 Extract Magic Numbers to Named Constants

**File:** `src/workbench/workbench.ts` (and extracted modules after 2.1)

**Problem:** Magic numbers scattered throughout:
- `35` — header height (px)
- `300` — debounce delay (ms)
- `150` — blur delay for menu dismissal (ms)
- `7` — menu item height multiplier
- `20` — LRU cache max entries (in `fileService.ts`)
- `1500` — chord timeout (ms) (in `keybindingService.ts`)
- `10000` — command proxy timeout (ms) (in `commandContribution.ts`)

**Fix:** Extract to named constants at module scope:
```typescript
const HEADER_HEIGHT_PX = 35;
const DEBOUNCE_DELAY_MS = 300;
const MENU_BLUR_DELAY_MS = 150;
```

**Verification:** `npm run build` — zero errors. No behavioral change.

---

### 4.2 Remove Redundant Dynamic Import of URI

**File:** `src/workbench/workbench.ts`
**Location:** ~line 575

**Problem:** `const { URI } = await import(...)` dynamically imports `URI`, which is already statically imported at line 15 of the same file. Dead code.

**Fix:** Remove the dynamic import. Use the existing static `URI` reference.

**Verification:** `npm run build` — zero errors. No behavioral change.

---

### 4.3 Deduplicate Container Lookup Chains

**File:** `src/workbench/workbench.ts` (and extracted modules after 2.1)

**Problem:** `document.querySelector('#workbench-grid .grid-branch-node')` and similar selector chains are duplicated 4+ times. Fragile — if DOM structure changes, every instance must be updated.

**Fix:** Extract to a utility:
```typescript
function queryWorkbenchElement(selector: string): HTMLElement | null {
    return document.querySelector(`#workbench-grid ${selector}`);
}
```

Or better, cache element references during layout phase and pass them to consumers.

**Verification:** `npm run build` — zero errors. No behavioral change.

---

### 4.4 Move `EXT_TO_LANGUAGE` Map Out of Composition Root

**File:** `src/workbench/workbench.ts`

**Problem:** A 40+ entry map for syntax highlighting language detection from file extensions is embedded in the composition root. This data belongs in the editor subsystem.

**Fix:** Move to `src/built-in/editor/languageDetection.ts` or `src/services/editorResolverService.ts`. Export and import where needed.

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/workbench/workbench.ts` | Source — remove map | Import from new location |
| `src/services/editorResolverService.ts` | Potential new home | Add `getLanguageForExtension()` method |

**Verification:** `npm run build` — zero errors. Same file-to-language mapping.

---

### 4.5 Eliminate Dual Layout Event Emission

**File:** `src/services/layoutService.ts` (~87 lines)

**Problem:** When layout changes, both the `LayoutService` and the layout host fire separate events. Subscribers to both get duplicate notifications, leading to redundant re-renders.

**Fix:** Pick one source — either the service fires or the host fires. The service is the appropriate single source for consumers. Remove the duplicate from the host (or have the host delegate to the service).

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `src/services/layoutService.ts` | Event source | Keep this as the single event source |
| `src/workbench/workbench.ts` | Layout host | Remove duplicate event firing |
| `src/layout/grid.ts` | Grid resize events | Should fire through layoutService, not directly |
| All consumers of `ILayoutService.onDidLayout` | Subscribers | Verify they still receive exactly one event per layout change |

**Verification:** `npm run build` — zero errors. All existing tests pass. Manual test: resize window → verify no double-render flicker.

---

### 4.6 Add Production Build Mode

**File:** `scripts/build.mjs`

**Problem:** There is no separate production build. `minify: false` is hardcoded. No CSS minification. No separate source map control for production.

**Fix:** Add a `--production` flag:
```javascript
const isProduction = process.argv.includes('--production');

await esbuild.build({
    // ... existing config ...
    minify: isProduction,
    sourcemap: isProduction ? 'external' : 'inline',
});
```

Add an `npm run build:prod` script in `package.json`.

**Dependencies to check:**
| File | Relationship | What to verify |
|------|-------------|---------------|
| `scripts/build.mjs` | Build script | Add flag handling |
| `package.json` | Scripts | Add `build:prod` |
| `electron/main.cjs` | Loads bundle | Verify external source maps are found if present |

**Verification:**
- [ ] `npm run build` — still works (development mode, no minification)
- [ ] `npm run build:prod` — produces minified output
- [ ] App runs correctly from production build

---

## Execution Summary

| Tier | # Fixes | Focus | Prerequisite |
|------|---------|-------|-------------|
| **Tier 1** | 6 | Critical bugs — data loss, zombies, races, leaks | None |
| **Tier 2** | 4 | Structural — god object, CSS build, async disposal, event semantics | Tier 1 complete |
| **Tier 3** | 8 | Hardening — disposal patterns, races, auto-save, unit tests | Tier 2 complete |
| **Tier 4** | 6 | Polish — constants, dead code, deduplication, production build | Tier 3 complete |
| **Total** | **24** | | |

### Completion Tracking

**Tier 1 — Critical Bug Fixes** ✅ COMPLETE
- [x] 1.1 Auto-save retry queue — `canvasDataService.ts`: added `SaveStateKind.Retrying`, `_retryQueue` map, `_scheduleRetry()` with exponential backoff (1s→2s→4s, max 3), `_cancelRetry()` on archive/delete, dispose cleanup
- [x] 1.2 TextFileModel zombie cleanup — `textFileModelManager.ts`: try/catch around `model.resolve()`, removes from map and disposes on failure
- [x] 1.3 FileService cache generation counter — `fileService.ts`: per-URI `_cacheGeneration` map, read captures gen before IPC and only caches if unchanged after
- [x] 1.4 Notification center listener cleanup — `workbench.ts`: stored keydown handler reference in `centerKeyHandler`, cleanup in `hideCenter()` for all dismiss paths
- [x] 1.5 Canvas editor ready-gate — `canvasEditorProvider.ts`: `_initComplete` flag guards `requestSave()`, `.catch()` on fire-and-forget `init()`, `_disposed` bail-out after async `_loadContent()`, null-safe `?.` on all controllers in `dispose()`
- [x] 1.6 Database open mutex — `databaseService.ts`: `_openPromise` mutex on `openForWorkspace()`, extracted `_doOpenForWorkspace()`, immediate state reset in `dispose()` before fire-and-forget close

**Tier 2 — Structural Improvements** ✅ COMPLETE
- [x] 2.1 Decompose workbench.ts (partial — 2 of 6 extractions) — extracted `menuBuilder.ts` (~297 lines: menu bar registration, manage gear icon, manage menu popup) and `statusBarController.ts` (~310 lines: status bar setup, editor tracking indicators, notification badge, window title). workbench.ts reduced 3,920→3,275 lines (~17% reduction). Remaining methods (tool lifecycle ~1,027 lines, workspace switching, view contribution events) required 15+ dependencies each — deferred to avoid regression risk.
- [x] 2.2 Migrate CSS to esbuild imports — added co-located `import './component.css'` to 15 .ts files (16 total with 2 existing). KaTeX CSS imported via `canvas/main.ts`, fonts handled by esbuild `file` loader with `assetNames: 'fonts/[name]'`. Removed 60-line manual CSS concatenation + KaTeX font copy from `build.mjs`. `index.html` now loads esbuild-produced `main.css` (181KB). New CSS files are automatically bundled — no manual build.mjs edits needed.
- [x] 2.3 Async tool disposal — `toolActivator.ts`: added `disposeAsync()` that calls `await this.deactivateAll()` then `this.dispose()`. Simplified synchronous `dispose()` to iterate remaining tools, dispose subscriptions + API, set state to Deactivated, clear map — no fire-and-forget `deactivate()` calls.
- [x] 2.4 Fix global event emitters — `apiFactory.ts`: moved `_toolInstallEmitter` and `_toolUninstallEmitter` to module-level singletons (`_globalToolInstallEmitter`, `_globalToolUninstallEmitter`). All tool instances share a single emitter pair. Per-tool subscriptions pushed to cleanup array and disposed on tool deactivation.

**Tier 3 — Hardening**
- [ ] 3.1 `_saverListeners` → DisposableStore
- [ ] 3.2 StatusBar subscription growth fix
- [ ] 3.3 ViewContainer section listener cleanup
- [ ] 3.4 Canvas `_saveDisposables` → DisposableStore
- [ ] 3.5 Bundle canvas transactions as single IPC
- [ ] 3.6 Cancel auto-save on archive/reorder
- [ ] 3.7 EditorPart microtask editor check
- [ ] 3.8 Add unit tests for core systems

**Tier 4 — Polish**
- [ ] 4.1 Extract magic numbers to constants
- [ ] 4.2 Remove redundant dynamic URI import
- [ ] 4.3 Deduplicate container lookup chains
- [ ] 4.4 Move EXT_TO_LANGUAGE map
- [ ] 4.5 Eliminate dual layout events
- [ ] 4.6 Add production build mode

---

## Dependency Quick-Reference

### Files Modified Per Fix

| Fix | Files Modified | Files to Re-test |
|-----|---------------|-----------------|
| 1.1 | `canvasDataService.ts`, `canvasTypes.ts` | `canvasSaveState.test.ts`, `canvasDataService.test.ts` |
| 1.2 | `textFileModelManager.ts` | `fileEditorInput.ts` (caller) |
| 1.3 | `fileService.ts` | `textFileModelManager.ts`, `fileSystemBridge.ts` |
| 1.4 | `workbench.ts` | Self-contained |
| 1.5 | `canvasEditorProvider.ts`, possibly `editorPane.ts` | Canvas E2E tests |
| 1.6 | `databaseService.ts` | `workbench.ts` (caller), `electron/database.cjs` |
| 2.1 | `workbench.ts` → 6 new files | `main.ts`, all E2E tests |
| 2.2 | `build.mjs`, 18 `.ts` files, `index.html`, `tsconfig.json` | Full build, visual regression |
| 2.3 | `toolActivator.ts`, `workbench.ts` | Tool lifecycle E2E tests |
| 2.4 | `apiFactory.ts`, `toolActivator.ts` | Tool install/uninstall tests |
| 3.1 | `workbench.ts` (or extracted module) | Self-contained |
| 3.2 | `apiFactory.ts` | Self-contained |
| 3.3 | `viewContainer.ts` | View switching E2E tests |
| 3.4 | `canvasEditorProvider.ts` | Self-contained |
| 3.5 | `canvasDataService.ts`, `databaseService.ts`, `electron/database.cjs`, `electron/preload.cjs` | Canvas CRUD tests |
| 3.6 | `canvasDataService.ts` | `canvasDataService.test.ts` |
| 3.7 | `editorPart.ts` | Tab management E2E tests |
| 3.8 | New test files only | No production changes |
| 4.1 | Multiple files | Self-contained per file |
| 4.2 | `workbench.ts` | Self-contained |
| 4.3 | `workbench.ts` (or extracted modules) | Self-contained |
| 4.4 | `workbench.ts`, `editorResolverService.ts` | File editor tests |
| 4.5 | `layoutService.ts`, `workbench.ts` | Layout E2E tests |
| 4.6 | `build.mjs`, `package.json` | Full build |

### Cross-Fix Dependencies

```
1.4 (notification listener) ──→ should land BEFORE 2.1 (workbench decomposition)
1.1 (auto-save retry)       ──→ independent of all others
1.2 (model creation)        ──→ independent of all others
1.3 (cache race)            ──→ independent, but 3.8 tests validate it
1.5 (canvas ready-gate)     ──→ independent of all others
1.6 (database mutex)        ──→ 3.5 (IPC transaction) builds on same file

2.1 (decompose workbench)   ──→ 3.1, 4.1, 4.2, 4.3 apply to extracted modules
2.2 (CSS build)             ──→ should land AFTER 2.1 (new modules may add CSS)
2.3 (async disposal)        ──→ independent
2.4 (global emitters)       ──→ independent

3.5 (IPC transactions)      ──→ depends on 1.6 (database service already modified)
3.6 (cancel auto-save)      ──→ benefits from 1.1 (retry queue in place)
3.8 (unit tests)            ──→ benefits from 1.3 (cache fix testable)
```
