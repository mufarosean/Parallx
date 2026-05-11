# Phase 1 Cleanup — Bottom-Up Refactor Plan

> **Branch:** `phase1-cleanup` (from `milestone-3` @ `4358c1e`)
>
> **Principle:** Clean bottom-up following the dependency graph. Verify (`tsc --noEmit` + `node scripts/build.mjs`) after every layer. One commit per layer. No functional changes — only dead code removal, deduplication, naming, and structure.

---

## Progress Tracker

| # | Layer | Status | Commit |
|---|-------|--------|--------|
| 1 | `platform/` | ✅ Done | `bfa99f4` |
| 2 | `layout/` | ✅ Clean — no changes needed | — |
| 3 | `context/` + `configuration/` | ✅ Clean — no changes needed | — |
| 4 | `dnd/` + `ui/` | ✅ Clean — no changes needed | — |
| 5 | `commands/` + `contributions/` | ✅ Clean — no changes needed | — |
| 6 | `editor/` | ✅ Clean — no changes needed | — |
| 7 | `parts/` | ✅ Clean — no changes needed | — |
| 8 | `services/` | ✅ Clean — no changes needed | — |
| 9 | `views/` + `tools/` | ✅ Clean — no changes needed | — |
| 10 | `api/` | ✅ Clean — no changes needed | — |
| 11 | `built-in/` | ✅ Clean — no changes needed | — |
| 12 | `workbench/` | ✅ Clean — no changes needed | — |
| 13 | `electron/` | ✅ Clean — no changes needed | — |
| 14 | Top-level (config, docs, CSS) | ✅ Clean — no changes needed | — |

---

### Cleanup Philosophy

> **Rule:** Anything currently unused but part of VS Code's structural patterns is **kept** —
> these are pre-positioned for future milestones. Only remove true dead code: duplicates,
> redundancies, deprecated wrappers, and generic fluff with no VS Code lineage.

## Layer 1 — `src/platform/` (7 files, ~1,820 lines)

Foundation layer. 176 imports reference `platform/` from the rest of the codebase.

### Issues Found & Resolved

#### 1.1 — `types.ts`: Duplicate URI interface ✅ REMOVED
- **Problem:** `types.ts` defined a `URI` interface that duplicates the `URI` class in `uri.ts`. Never imported.
- **Fix:** Removed the interface. The class in `uri.ts` is the canonical type.

#### 1.2 — `types.ts`: Unused generic utility types ✅ REMOVED
- **Problem:** `VoidFunction` (shadows global), `MaybePromise<T>`, `Optional<T>`, `Constructor<T>` — generic convenience types, not VS Code patterns, never imported.
- **Fix:** Removed all four.

#### 1.3 — `events.ts`: Deprecated legacy helpers ✅ REMOVED
- **Problem:** `onceEvent()`, `debounceEvent()`, `listenTo()` — explicitly `@deprecated`, redundant wrappers around `EventUtils.*`, never imported.
- **Fix:** Removed all three.

#### 1.4 — `lifecycle.ts`: Unused VS Code pattern utilities ⏭️ KEPT
- `MutableDisposable`, `RefCountDisposable`, `AsyncDisposable`, `AsyncDisposableStore`, `combinedDisposable`, `safeDispose`, `isDisposable`, `markAsDisposed`, disposal tracking — all VS Code patterns for future milestones.

#### 1.5 — `storage.ts`: Unused VS Code pattern classes ⏭️ KEPT
- `InMemoryStorage`, `IndexedDBStorage`, `NamespacedSyncStorage`, `ISyncStorage`, `migrateStorage` — all VS Code patterns.

#### 1.6 — `uri.ts`: `uriCompare()` ⏭️ KEPT
- Common VS Code sorting utility. Trivially small.

#### 1.7 — No structural/naming issues
- File naming consistent, exports consistent, JSDoc good, no circular imports.

---

## Layer 2 — `src/layout/` (7 files, ~1,800 lines)

Grid layout engine: types, serialization model, tree nodes, views, grid, renderer, persistence.

### Export Audit (31 exports across 7 files)

| Category | Count | Examples |
|----------|:-----:|---------|
| **Actively used outside layout/** | 12 | `Orientation`, `SizeConstraints`, `Dimensions`, `IGridView`, `Grid`, `LayoutRenderer`, `LayoutPersistence`, `SerializedLayoutState`, `createDefaultLayoutState`, `DEFAULT_SIZE_CONSTRAINTS`, `LAYOUT_SCHEMA_VERSION` |
| **Used internally within layout/** | 11 | `SerializedNodeType`, `SerializedBranchNode`, `SerializedLeafNode`, `SerializedGridNode`, `SerializedGrid`, `GridNodeType`, `GridNode`, `GridBranchNode`, `GridLeafNode`, `SizingMode`, `GridLocation` |
| **Transitively used** (nested in `SerializedLayoutState`) | 2 | `SerializedPartState`, `SerializedViewAssignment` |
| **VS Code forward-looking patterns** | 6 | `Position`, `Box`, `SashEdge`, `GridEventType`, `GridViewFactory`, `BaseGridView`, `GridChangeEvent` |

### Issues Found

#### 2.1 — `GridNodeType` vs `SerializedNodeType` — identical values ⏭️ KEPT
- Both enums have `Branch = 'branch'` and `Leaf = 'leaf'`, but serve different purposes (runtime tree discrimination vs serialization format). Valid VS Code pattern — they could diverge in future migrations.

#### 2.2 — Forward-looking layout primitives ⏭️ KEPT
- `Position`, `Box`, `SashEdge`, `GridEventType`, `GridViewFactory`, `BaseGridView`, `GridChangeEvent` — VS Code grid layout contracts pre-positioned for future milestones. Previously flagged as intentionally preserved in M2 audit.

#### 2.3 — Internal serialization types ⏭️ KEPT
- `SerializedPartState`, `SerializedViewAssignment`, `SerializedBranchNode`, `SerializedLeafNode`, `SerializedGridNode`, `SerializedGrid` — transitively consumed through `SerializedLayoutState`, used by `workspaceTypes.ts`, `workspaceSaver.ts`, `workspace.ts`, `workbench.ts`. Already correctly exported.

#### 2.4 — No dead code, no redundancy, no naming issues
- File naming consistent, exports clean, JSDoc present, no circular imports. Zero changes needed.

---

## Layer 3 — `src/context/` (4 files, ~1,350 lines) + `src/configuration/` (4 files, ~1,120 lines)

Context key system and configuration/settings system.

### Export Audit

**context/** — 24 exports; 5 actively used outside, 19 module-internal or VS Code forward-looking:
- `ContextKeyService`, `FocusTracker`, `WorkbenchContextManager`, `ContextKeyValue`, `IContextKey`, `ContextKeyChangeEvent`, `ContextKeyLookup` — actively used
- 16 `CTX_*` constants — VS Code canonical key-name pattern, consumed internally by `WorkbenchContextManager`, exported for future command/menu when-clause references
- `WhenClauseNodeType`, `WhenClauseNode`, `WhenClauseParseError`, `parseWhenClause`, `evaluateWhenClause`, `testWhenClause` — VS Code when-clause public API, consumed internally by `ContextKeyService`
- `clearWhenClauseCache()` — testing utility (3 lines), needed once test suite exists
- `FocusChangeEvent`, `TrackablePart`, `TrackableViewManager` — VS Code event/interface patterns

**configuration/** — 10 exports; 8 actively used outside, 2 module-internal:
- `ConfigurationService`, `ConfigurationRegistry`, `ToolMemento`, `IWorkspaceConfiguration`, `IConfigurationChangeEvent`, `IConfigurationPropertySchema`, `IRegisteredConfigurationSection`, `IConfigurationServiceShape` — actively used
- `ConfigurationValueType` — internal to configuration module
- `ConfigurationSchemaChangeEvent` — internal event forwarded by `ConfigurationService`

### Issues Found

#### 3.1 — All CTX_* constants ⏭️ KEPT
- VS Code's context key naming pattern. 4 of 21 already imported externally (by `workbench.ts`). The rest are pre-positioned for future commands/menus that reference keys symbolically.

#### 3.2 — When-clause AST + evaluator ⏭️ KEPT
- `parseWhenClause`, `evaluateWhenClause`, `testWhenClause` only used within `context/` today, but are VS Code's public when-clause API. Future tools/integration may invoke them directly.

#### 3.3 — `clearWhenClauseCache()` ⏭️ KEPT
- Zero callers today, but explicitly designed for test infrastructure (3 lines, clear purpose).

#### 3.4 — `ConfigurationValueType` vs `ContextKeyValue` — not duplicates ⏭️ KEPT
- Look superficially similar but serve different domains with intentionally different type shapes.

#### 3.5 — No dead code, no redundancy, no naming issues
- Both modules are clean. Zero changes needed.

---

## Layer 4 — `src/dnd/` (4 files) + `src/ui/` (11 files)

Drag-and-drop system and reusable UI component library.

### Export Audit

**dnd/** — 6 exports; 2 actively used outside (`DragAndDropController`, `DropResult`), 4 module-internal:
- Internal types (`DropPosition`, `VIEW_DRAG_MIME`, `DragPayload`, `IDropTarget`) consumed by dnd/ module files. VS Code DnD patterns.
- `DropOverlay`, `DropZone` — internal implementation classes, only consumed within dnd/.

**ui/** — 33 exports; 2 actively used outside (`ContextMenu`, `IContextMenuItem`), rest are library components:
- DOM utilities (`$`, `append`, `clearNode`, `addDisposableListener`, `toggleClass`, `hide`, `show`, `isAncestorOfActiveElement`) — VS Code `base/browser/dom.ts` utilities. `hide`/`show`/`isAncestorOfActiveElement` have zero callers but are standard VS Code DOM utils.
- Components (`ActionBar`, `Button`, `CountBadge`, `InputBox`, `FilterableList`, `Overlay`, `TabBar`) — Pre-built library per project instructions: *"All reusable primitives live in `src/ui/`"*.
- Barrel (`index.ts`) re-exports all components for convenient consumption.

### Issues Found

#### 4.1 — `hide()`, `show()`, `isAncestorOfActiveElement()` — zero callers ⏭️ KEPT
- VS Code `base/browser/dom.ts` standard utilities. Part of the UI toolkit. Awaiting adoption by future feature code.

#### 4.2 — UI component library entirely unused outside `ui/` ⏭️ KEPT
- `Button`, `TabBar`, `ActionBar`, `FilterableList`, `CountBadge`, `Overlay`, etc. are the `src/ui/` component library mandated by the project's component architecture. Pre-positioned for future milestones.

#### 4.3 — `DropOverlay` (dnd/) vs `EditorDropOverlay` (editor/) — similar but separate ⏭️ NOTED
- ~70% logic overlap (zone-based DnD feedback). Different thresholds (25% vs 33%) and different DOM coupling. VS Code keeps them separate. Will revisit in Layer 6 (editor).

#### 4.4 — No dead code, no redundancy requiring action
- All exports are either actively used, module-internal, or VS Code structural patterns. Zero changes needed.

---

## Layer 5 — `src/commands/` + `src/contributions/` (~9 files)

### Export Audit

All exports actively used or VS Code structural patterns. Notable:

#### 5.1 — `formatKeybindingForDisplay` in `keybindingContribution.ts` ⏭️ KEPT
- Exported, never called outside its file. However, M2 milestone doc marks it ✅ and documents its use by CommandPalette for displaying keybinding labels. VS Code keybinding display pattern. Wiring incomplete but function is correct and needed.

#### 5.2 — No dead code, no redundancy
- Zero changes needed.

---

## Layer 6 — `src/editor/` (7 files)

### Export Audit

#### 6.1 — Unused editor types in `editorTypes.ts` ⏭️ KEPT
- `EditorCloseResult`, `EditorMoveTarget`, `SerializedEditorPartLayout`, `SerializedEditorGroupLayout` — never imported outside `editorTypes.ts`. All are VS Code editor group patterns pre-positioned for future editor features (close confirmation, editor movement, layout serialization).

#### 6.2 — `EditorDropOverlay` vs `DropOverlay` overlap ⏭️ NOTED
- Confirmed ~70% logic overlap with `dnd/dropOverlay.ts`. Different edge thresholds and DOM coupling. VS Code keeps them as separate implementations. Not actionable now.

#### 6.3 — No dead code
- Zero changes needed.

---

## Layer 7 — `src/parts/` (10 files)

### Export Audit

#### 7.1 — Error classes (DuplicatePartError, PartNotFoundError) ⏭️ KEPT
- Exported but only used internally. VS Code pattern — error classes are exported for type-catching in consuming code.

#### 7.2 — No dead code
- All part classes and their types are actively used by workbench.ts and services. Zero changes needed.

---

## Layer 8 — `src/services/` (~13 files)

### Export Audit

#### 8.1 — Error classes (CircularDependencyError, ServiceNotFoundError) ⏭️ KEPT
- Same VS Code pattern as Layer 7.

#### 8.2 — No dead code
- All services actively used. Zero changes needed.

---

## Layer 9 — `src/views/` + `src/tools/`

### Export Audit

#### 9.1 — `serializeViewDescriptor` in `viewDescriptor.ts` ⏭️ KEPT
- Never called. VS Code view state persistence utility — will be needed for view layout serialization.

#### 9.2 — `toolScanner.ts` — entire module unwired ⏭️ KEPT
- Implements dynamic tool discovery (scanning directories for manifest files). VS Code extension discovery pattern. Awaiting proper tool packaging story.

#### 9.3 — No dead code
- Zero changes needed.

---

## Layer 10 — `src/api/`

### Export Audit

#### 10.1 — `isCompatible` + `VersionCompatibilityResult` in `apiVersionValidation.ts` ⏭️ KEPT
- Never called. M2 milestone marks it ✅. VS Code engine version validation pattern — will be needed when tool activator does proper semver gating.

#### 10.2 — `fileSystemBridge.ts` — entire module unwired ⏭️ KEPT
- Bridges `parallx.workspace.fs` to `IFileService`. Awaiting filesystem API exposure to tools.

#### 10.3 — No dead code
- Zero changes needed.

---

## Layer 11 — `src/built-in/` | Clean — no issues found

All built-in tools are actively wired and functional. Zero changes needed.

---

## Layer 12 — `src/workbench/` | Clean — no issues found

`workbench.ts` and `workbenchServices.ts` are the top-level composition root. Everything is actively used. Zero changes needed.

---

## Layer 13 — `electron/` | Clean — no issues found

`main.cjs` and `preload.cjs` are minimal Electron bootstrap files. Zero changes needed.

---

## Layer 14 — Top-level | Clean — no issues found

Config files (`package.json`, `tsconfig.json`, `playwright.config.ts`, `index.html`), build scripts, and docs are all correctly structured. Zero changes needed.
