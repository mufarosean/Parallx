# Milestone 7.2 — Architectural Coherence Audit & Alignment

> **Branch:** `milestone-7.2`
> **Started:** 2026-02-19
> **Goal:** Ensure the Parallx codebase is not patched together from incremental fixes but is a deliberate system that lives into the VS Code vision.

---

## Context

After completing all 24 fixes in Milestone 7.1 (Tiers 1–4), the system builds clean, passes 143/143 tests, and production-bundles to 1.6 MB JS + 152 KB CSS. But is the architecture _coherent_?

This audit compared every major Parallx subsystem against VS Code's actual implementation (via [DeepWiki](https://deepwiki.com/microsoft/vscode) and the [VS Code source](https://github.com/microsoft/vscode)) to separate real architectural debt from cosmetic issues.

---

## VS Code Comparison: Where We Stand

### 1. Workbench Decomposition

| Aspect | VS Code | Parallx | Verdict |
|--------|---------|---------|---------|
| `workbench.ts` size | **462 lines** — thin composition root | **2,801 lines** — 8 concerns inlined | **GAP** |
| Workbench ↔ Layout split | `Workbench extends Layout` (abstract). Layout = grid + state + events. Workbench = bootstrap + restore. | `Workbench extends Layout` — same pattern — but Workbench also inlines service facades, tool contribution wiring, file editor setup, workspace CRUD | **STRUCTURAL DEBT** |
| Service registration | `registerSingleton()` from **feature module files** (e.g., `workbench.common.main.ts`). Workbench just calls `getSingletonServiceDescriptors()`. | ~350 lines of inline `_registerFacadeServices()` inside Workbench | **GAP** |
| Layout actions | Separate file: `actions/layoutActions.ts` | All 1,348 lines in `structuralCommands.ts` — sidebar toggle, split-editor, zen-mode, resize mixed together | **GAP** |
| Context keys | Separate handler: `contextkeys.ts` (`WorkbenchContextKeysHandler`) | Similar — `workbenchContext.ts` + `focusTracker.ts` — **ALIGNED** | **OK** |
| Part creation | Declarative: array of `{ id, role, classes }`, iterated in loop | Same pattern — **ALIGNED** | **OK** |

**Bottom line:** The Workbench class is doing too much. VS Code's `Workbench` is 462 lines because it delegates to `Layout` (grid/state/events), separate `LayoutActions` (toggle commands), separate `WorkbenchContributions` (tool wiring), and singleton-registered services. Parallx inlines all of these.

### 2. Layout System

| Aspect | VS Code | Parallx | Verdict |
|--------|---------|---------|---------|
| `SerializableGrid` in `base/browser/ui/grid/` | Grid lives in foundational UI layer, depends only on `base/` | Parallx `Grid` in `layout/`, depends only on `platform/` — **same pattern** | **ALIGNED** |
| `LayoutStateModel` | Separate class managing persistence of visibility, positions, alignment | Parallx uses `layoutPersistence.ts`, `layoutModel.ts` — split across files — **conceptually aligned** | **OK** |
| `IWorkbenchLayoutService` interface | In `services/layout/browser/layoutService.ts` — interface separate from implementation | Parallx `ILayoutService` in `services/serviceTypes.ts` — **ALIGNED** | **OK** |
| Grid depends on UI? | `base/browser/ui/grid/grid.ts` — yes, grid IS in `base/browser/ui/` | Parallx `layout/grid.ts` imports from `ui/dom.js` — **violation of our own rules** but actually mirrors VS Code's pattern where grid IS a UI component | **ACCEPTABLE — update ARCHITECTURE.md** |

**Bottom line:** Layout system is well-aligned. The `layout/ → ui/` import that our audit flagged as a violation is actually the correct VS Code pattern — grid IS a UI concern in VS Code. We should update `ARCHITECTURE.md` to allow `layout/ → ui/` explicitly.

### 3. Parts + Views + Editor

| Aspect | VS Code | Parallx | Verdict |
|--------|---------|---------|---------|
| Part base class | `Part extends Component` in `part.ts` | `Part extends Disposable` — **same role** | **OK** |
| `EditorPart` contains `EditorGroupView[]` via `Grid<IEditorGroupView>` | Yes — nested grid inside the editor part | Same — `EditorPart` hosts `EditorGroupView` instances | **ALIGNED** |
| `EditorGroupView` has `model`, `titleControl`, `editorPane` | Three responsibilities: state model, tab UI, content pane | Similar structure — model + tabs + pane | **ALIGNED** |
| `EditorInput + EditorPane` pattern | Abstract `EditorInput` (document identity) + `EditorPane` (rendering) | Same pattern — `EditorInput` + `EditorPane` abstract classes | **ALIGNED** |
| View containers as composite parts | `CompositePart` base, tabbed view containers | `ViewContainer` with tab bar — **ALIGNED** | **OK** |
| `EditorPart → EditorGroupView` is runtime import in `parts/` | Yes — `editorPart.ts` imports `editorGroupView.ts` at runtime | Same — our audit flagged this but it **matches VS Code** | **ACCEPTABLE** |

**Bottom line:** The editor/part/view system is the strongest area of VS Code alignment. The `parts/ → editor/` runtime imports we flagged are correct — they match VS Code's `EditorPart` which also runtime-imports `EditorGroupView`.

### 4. Extension/Tool API

| Aspect | VS Code | Parallx | Verdict |
|--------|---------|---------|---------|
| API factory pattern | `createApiFactoryAndRegisterActors()` returns a factory function. Per-extension: `factory(extension, registries, config) → vscode` namespace | `createToolApi(toolId, services)` — per-tool scoped API — **same pattern** | **ALIGNED** |
| Error handling wrapper | `_asExtensionEvent()` wraps every listener with try/catch + `onUnexpectedExternalError()` | `toolErrorIsolation.ts` provides error boundaries — **same intent, lighter implementation** | **OK** |
| Bridge/adapter modules | `ExtHostLanguageFeatures`, `MainThreadLanguageFeatures` bridge RPC to services | `bridges/` folder (workspaceBridge, viewsBridge) connects API calls to services — **same pattern**, single-process since no RPC needed | **ALIGNED** |
| API types separate from internal types | `vscode.d.ts` for extensions, internal types in `editor/common/` | `parallx.d.ts` for tools, internal types in module `*Types.ts` files — **ALIGNED** | **OK** |
| Activation events | `onCommand:`, `onLanguage:`, `*` etc. | `activationEventService.ts` with `onCommand:`, `onView:`, `*` — **ALIGNED** | **OK** |

**Bottom line:** Tool API system is well-aligned with VS Code's extension API pattern. The key difference (single-process vs RPC) is a deliberate simplification that matches our use case.

### 5. Disposal, Event, and Lifecycle Patterns

| Aspect | VS Code | Parallx | Verdict |
|--------|---------|---------|---------|
| `Disposable` base + `_register()` | Universal — every class wraps listeners via `_register()`, `DisposableStore`, `toDisposable()` | **Same infrastructure** — but 14+ untracked `addEventListener` calls found in our code | **GAP** |
| `Emitter<T>` naming | `_onDid*` / `onDid*` (past tense, consistent) | 11 emitters don't follow this — `_onDragStart`, `_onPhaseStarted`, `_onError` etc. | **GAP** |
| Event listener cleanup | VS Code wraps ALL DOM listeners via `addDisposableListener()` from `dom.ts`; NO raw `addEventListener` in `Disposable` classes | Parallx has 14 untracked raw `addEventListener` calls | **GAP** |
| `LifecyclePhase` sequencing | `Starting → Ready → Restored → Eventually` with `ILifecycleService` | Same phases — `_onPhaseStarted` / `_onPhaseCompleted` tracking | **ALIGNED (naming needs fix)** |

**Bottom line:** The infrastructure is correct (Disposable, Emitter, lifecycle phases). The gaps are in consistent application — some code was written before the patterns were established and never retrofitted.

### 6. Service Abstraction

| Aspect | VS Code | Parallx | Verdict |
|--------|---------|---------|---------|
| `serviceTypes.ts` with `I*` interfaces | Interfaces in `common/` files (e.g., `services/editor/common/editorService.ts`), implementations in `browser/` | `serviceTypes.ts` central file — **acceptable variant** | **OK** |
| Every module imports interface only | Strict — feature modules never import concrete service classes | 5 violations: `apiFactory.ts` imports concrete `StatusBarPart`; `commandRegistry.ts` imports `ServiceCollection`; `workspaceBridge.ts` imports from `workspace/` etc. | **GAP** |
| DI container | `IInstantiationService` + `ServiceCollection` + `registerSingleton()` | `ServiceCollection` + manual wiring in Workbench — **simpler but functional** | **OK** |
| `window.parallxElectron` in feature code | VS Code: `ipcRenderer` only in preload; main process access via injected `IHostService` | `canvasDataService.ts` directly accesses `window.parallxElectron.database` — bypasses `DatabaseService` | **GAP** |

**Bottom line:** Service layer is sound. The few violations are concentrated in `apiFactory.ts` (5 issues) and `canvasDataService.ts` (1 critical abstraction leak).

### 7. UI Component Pattern

| Aspect | VS Code | Parallx | Verdict |
|--------|---------|---------|---------|
| `base/browser/ui/` reusable components | Extensive: `inputBox`, `contextview`, `actionbar`, `tree`, `list`, `selectBox`, `dropdown`, `splitview` etc. | `src/ui/` has `inputBox`, `contextMenu`, `button`, `overlay`, `list`, `breadcrumbs`, `tabBar`, `dialog` | **ALIGNED** |
| Feature code uses components | Strict — widgets come from `base/browser/ui/`, no raw `document.createElement` for standard patterns | 6 High violations: raw inputs, duplicate icon pickers, raw context menu in canvasSidebar | **GAP** |
| inline `element.style.*` | Avoided — VS Code uses CSS classes. Only computed layout dimensions inline. | 6 High/Medium inline style violations | **GAP** |

**Bottom line:** Component library exists and is used, but the canvas built-in has accumulated raw DOM patterns, especially the icon picker (duplicated 3x) and inline search inputs.

---

## Audit Findings: Full Inventory

### Category A — Disposal & Lifecycle Bugs (Tier 2 fixes — prevents runtime leaks)

| # | Finding | File | Severity |
|---|---------|------|----------|
| A.1 | 14 untracked `addEventListener` in Disposable classes | editorGroupView, viewContainer, workbench, titlebarPart, statusBarPart, activityBarPart | HIGH |
| A.2 | `_turnIntoHideTimer` / `_colorHideTimer` not cleared in `dispose()` | blockHandles.ts:1060 | HIGH |
| A.3 | `_saverListeners` DisposableStore not registered with `_register()` | workbench.ts:226 | MEDIUM |
| A.4 | `WorkspaceFileScanner._onDidScan` emitter — no `dispose()` method | quickAccess.ts:569 | MEDIUM |
| A.5 | `Workspace` class has 2 emitters, never disposed (no Disposable base) | workspace.ts:44-46 | MEDIUM |
| A.6 | 6+ orphaned emitters in bridge modules, local adapters | viewsBridge, workspaceBridge, viewContribution, layout.ts | LOW |

### Category B — Dependency Violations (Tier 1 — enforces architecture)

| # | Violation | Count | Files | Fix Strategy |
|---|-----------|-------|-------|-------------|
| B.1 | `layout/` → `ui/` | 2 | grid.ts, gridView.ts | **RECLASSIFY** — matches VS Code pattern. Update ARCHITECTURE.md to allow `layout/ → ui/` |
| B.2 | `parts/` → `editor/` runtime imports | 4 | editorPart.ts | **RECLASSIFY** — matches VS Code's EditorPart. Update ARCHITECTURE.md to note this is an allowed runtime dependency |
| B.3 | `commands/` → `editor/`, `built-in/`, `parts/` | 6 | structuralCommands.ts, commandRegistry.ts | **FIX** — Commands should use service interfaces, not import concrete types from editor/built-in/parts |
| B.4 | `workspace/` → runtime imports (should be type-only) | 5 | workspaceTypes.ts, workspaceSaver.ts | **FIX** — Convert to `import type` where possible; move shared types to workspaceTypes.ts |
| B.5 | `contributions/` → `layout/` | 1 | viewContribution.ts | **FIX** — Move `DEFAULT_SIZE_CONSTRAINTS` to `services/serviceTypes.ts` or `layout/layoutTypes.ts` re-exported by service |
| B.6 | `configuration/` → `tools/` | 1 | toolMemento.ts | **FIX** — Move `Memento` type to `configurationTypes.ts` |
| B.7 | `api/` → `parts/`, `workspace/`, concrete services | 5 | apiFactory.ts, workspaceBridge.ts | **FIX** — API must import from service interfaces only |
| B.8 | `window.parallxElectron` outside services layer | 3 | main.ts (2), canvasDataService.ts (1) | **FIX** main.ts (move to bootstrap); canvasDataService (inject DatabaseService) |

**After reclassification: 27 violations → 6 real violations to fix (21 issues) + 6 reclassified as acceptable**

### Category C — Convention Alignment (Tier 3 — coherence)

| # | Finding | Count | Severity |
|---|---------|-------|----------|
| C.1 | Missing `*Types.ts` files: `tools/` (26 scattered types), `views/` (6 types) | 2 HIGH | HIGH |
| C.2 | Missing `*Types.ts` files: `context/`, `theme/` | 2 MEDIUM | MEDIUM |
| C.3 | Duplicate `IThemeService` — serviceTypes.ts has `IThemeServiceShape`, themeService.ts has local `IThemeService` | 1 | HIGH |
| C.4 | `IDatabaseService` / `IWorkspaceBoundaryService` are type aliases to concrete classes, not proper interfaces | 2 | MEDIUM |
| C.5 | `EditorResolverService` has no interface in serviceTypes.ts | 1 | MEDIUM |
| C.6 | 11 event emitters don't follow `_onDid*` / `_onWill*` naming | 11 | MEDIUM |
| C.7 | `structuralCommands.ts` — 1,348 lines mixing unrelated command families | 1 | HIGH |

### Category D — Structural Decomposition (Tier 1 — biggest win, biggest effort)

| # | Finding | Severity |
|---|---------|----------|
| D.1 | `Workbench` class = 2,600 lines, 8 concerns. VS Code: 462 lines. | CRITICAL |
| D.2 | Inline facade services (~350 lines) should be extracted | HIGH |
| D.3 | Tool contribution wiring (~350 lines) should be extracted | HIGH |
| D.4 | File editor resolver + quick access file picker (~180 lines) should be extracted | MEDIUM |
| D.5 | Workspace CRUD (~150 lines) should delegate to WorkspaceService | MEDIUM |

### Category E — UI Component Rules (Tier 4 — polish)

| # | Finding | File(s) | Severity |
|---|---------|---------|----------|
| E.1 | Icon picker widget duplicated in 3 files | calloutNode, pageBlockNode, pageChrome | HIGH |
| E.2 | Raw `<input>` elements instead of InputBox | canvasSidebar.ts (×2) | HIGH |
| E.3 | Raw context menu bypasses `ContextMenu` component | canvasSidebar.ts | HIGH |
| E.4 | `.style.cssText` with color/font/padding inline | editorPane.ts:240 | HIGH |
| E.5 | Inline `display`/`flex`/`alignment` styles | canvasIcons.ts:172 | MEDIUM |
| E.6 | Inline `fontWeight`/`fontSize` | blockHandles.ts:827 | MEDIUM |
| E.7 | inline `cursor: pointer` in multiple files | statusBarPart, mediaNodes | LOW |

---

## Implementation Plan

### Phase A — Disposal & Lifecycle Bugs (Category A)
**Risk: LOW | Impact: Prevents runtime memory leaks | Effort: SMALL**

- [ ] A.1 — Wrap all 14 untracked `addEventListener` calls with `_register(addDisposableListener(...))` or equivalent
- [ ] A.2 — Clear `_turnIntoHideTimer` and `_colorHideTimer` in `BlockHandlesController.dispose()`
- [ ] A.3 — Register `_saverListeners` with `this._register()` in Workbench
- [ ] A.4 — Add `dispose()` to `WorkspaceFileScanner`
- [ ] A.5 — Add lifecycle management to `Workspace` class emitters
- [ ] A.6 — Track orphaned emitters in bridge modules

### Phase B — Dependency Violation Fixes (Category B)
**Risk: LOW | Impact: Enforces architectural boundaries | Effort: MEDIUM**

- [ ] B.0 — **Update ARCHITECTURE.md**: Allow `layout/ → ui/` and `parts/ → editor/` (matches VS Code)
- [ ] B.3 — Decouple `structuralCommands.ts` from `editor/`, `built-in/`, `parts/` — use service interfaces
- [ ] B.4 — Convert `workspace/` imports to type-only where needed
- [ ] B.5 — Move `DEFAULT_SIZE_CONSTRAINTS` out of `layout/`
- [ ] B.6 — Move `Memento` type to `configurationTypes.ts`
- [ ] B.7 — Decouple `apiFactory.ts` from concrete service imports
- [ ] B.8 — Inject `DatabaseService` into `canvasDataService.ts`

### Phase C — Workbench Decomposition (Category D)
**Risk: MEDIUM | Impact: Largest structural improvement | Effort: LARGE**

Following VS Code's pattern where `Workbench extends Layout` is thin:

- [ ] D.1 — Extract `WorkbenchContributionHandler`: tool container/view contribution wiring
- [ ] D.2 — Extract `WorkbenchFacadeFactory`: facade service registration
- [ ] D.3 — Extract `WorkbenchFileEditorSetup`: file editor resolver + quick access file picker
- [ ] D.4 — Move workspace CRUD to `WorkspaceService`
- [ ] D.5 — Split `structuralCommands.ts` by command family

### Phase D — Convention Alignment (Category C)
**Risk: LOW | Impact: Naming coherence, discoverability | Effort: MEDIUM**

- [ ] C.1 — Create `toolTypes.ts`, `viewTypes.ts`
- [ ] C.2 — Create `contextTypes.ts`, `themeTypes.ts`
- [ ] C.3 — Resolve duplicate `IThemeService` interfaces
- [ ] C.4 — Create proper `IDatabaseService` / `IWorkspaceBoundaryService` interfaces
- [ ] C.5 — Add `IEditorResolverService` to serviceTypes.ts
- [ ] C.6 — Rename 11 emitters to `_onDid*` / `_onWill*` pattern
- [ ] C.7 — Split `structuralCommands.ts` by command family (shared with D.5)

### Phase E — UI Component Rules (Category E)
**Risk: LOW | Impact: Consistent component usage | Effort: SMALL**

- [ ] E.1 — Create `src/ui/iconPicker.ts` — extract shared icon picker widget
- [ ] E.2 — Replace raw `<input>` with `InputBox` in canvasSidebar
- [ ] E.3 — Replace raw context menu with `ContextMenu` component
- [ ] E.4 — Replace `.style.cssText` with CSS classes in editorPane
- [ ] E.5 — Move inline visual styles to CSS classes in canvasIcons
- [ ] E.6 — Move inline `fontWeight`/`fontSize` to CSS in blockHandles

---

## VS Code Comparison Summary

### Where Parallx Matches VS Code (strong alignment)

1. **Layout system** — `SerializableGrid` → Parts hierarchy → grid-based arrangement ✅
2. **Part/View/Editor model** — `Part` base → `ViewContainer` → `EditorGroupView` → `EditorInput`/`EditorPane` ✅
3. **Tool API** mirrors Extension API — per-tool scoped namespace, factory pattern, bridge modules ✅
4. **Context key system** — `ContextKey` + `WhenClause` evaluation ✅
5. **Lifecycle phases** — `Starting → Ready → Restored → Eventually` ✅
6. **Disposable infrastructure** — `Disposable`, `DisposableStore`, `Emitter<T>`, `_register()` ✅
7. **Configuration system** — schema registry, hierarchical merge, `onDidChangeConfiguration` ✅
8. **UI component library** — `src/ui/` mirroring `base/browser/ui/` ✅

### Where Parallx Diverges (needs work)

1. **Workbench god-object** — 2,801 lines vs VS Code's 462. VS Code delegates to Layout (abstract), separate action files, WorkbenchContributions, and registerSingleton. Parallx inlines everything.
2. **Untracked DOM listeners** — VS Code uses `addDisposableListener()` universally. Parallx has 14 raw `addEventListener` calls.
3. **Event naming** — VS Code is consistent with `_onDid*` / `_onWill*`. Parallx has 11 violations.
4. **Service abstraction leaks** — `canvasDataService.ts` directly accesses `window.parallxElectron`, bypassing DI.
5. **Missing Types files** — `tools/` has 26 types scattered across 8 files with no central `toolTypes.ts`.
6. **UI component bypasses** — Canvas built-in has accumulated raw DOM patterns (icon picker ×3, raw inputs, raw context menu).

### Where Parallx Intentionally Differs (acceptable)

1. **Single-process** — No RPC/IPC for tool API (vs VS Code's extension host process). Correct for our use case.
2. **Centralized `serviceTypes.ts`** — VS Code scatters interfaces across `common/` files per service. Our central file is a pragmatic choice for the current scale.
3. **esbuild IIFE bundle** — vs VS Code's Gulp+Webpack. Correct for our build complexity level.
4. **No multi-window support** — VS Code has auxiliary windows. Not needed for Parallx's current scope.

---

## Success Criteria

- [ ] All Phase A disposal bugs fixed — zero untracked listeners
- [ ] Dependency violations reduced from 27 to 0 (including ARCHITECTURE.md updates for acceptable patterns)
- [ ] `workbench.ts` reduced from 2,801 to <1,000 lines via extraction
- [ ] All modules have co-located `*Types.ts` files
- [ ] All emitters follow `_onDid*` / `_onWill*` naming
- [ ] Icon picker extracted to `src/ui/`; zero duplicate widget implementations
- [ ] 143+ tests passing, build clean
- [ ] VS Code comparison table shows GREEN on all critical items

---

## References

- [DeepWiki — VS Code Overview](https://deepwiki.com/microsoft/vscode/1-overview)
- [DeepWiki — Layout System and Parts](https://deepwiki.com/microsoft/vscode/4.1-layout-system-and-parts)
- [DeepWiki — Workbench Architecture](https://deepwiki.com/microsoft/vscode/4-workbench-architecture)
- [DeepWiki — Extension API Implementation](https://deepwiki.com/microsoft/vscode/5.2-extension-api-implementation)
- [VS Code `workbench.ts` — 462 lines](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/workbench.ts)
- [VS Code `layout.ts` — abstract Layout class](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/layout.ts)
- [VS Code `layoutActions.ts` — separate action file](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/layoutActions.ts)
- [Parallx ARCHITECTURE.md](../ARCHITECTURE.md)
- [Parallx Instructions](../.github/instructions/parallx-instructions.instructions.md)
