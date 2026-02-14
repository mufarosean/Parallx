# Parallx Full Codebase Audit

> **Date:** 2025-07-11 · **Branch:** `milestone-5` · **Commit:** `b5d01ff`
>
> This audit catalogues the current state of the codebase — redundancies,
> inefficiencies, architectural violations, dead exports, theme gaps, and
> large-file hotspots. **Nothing was fixed; this is a diagnostic snapshot.**
>
> Code that is scaffolded for future features (tool API types, context keys,
> placeholder views, DI decorators) is flagged as *infrastructure-ahead-of-usage*
> rather than dead code.

---

## Table of Contents

1. [Codebase Overview](#1-codebase-overview)
2. [Inline Style Violations](#2-inline-style-violations)
3. [Raw DOM Violations](#3-raw-dom-violations)
4. [Hardcoded Colors](#4-hardcoded-colors)
5. [Theme System Gaps](#5-theme-system-gaps)
6. [Unused `ui/` Components](#6-unused-ui-components)
7. [Duplicate Logic Patterns](#7-duplicate-logic-patterns)
8. [Dead & Unused Exports](#8-dead--unused-exports)
9. [Large Files (> 500 lines)](#9-large-files--500-lines)
10. [CSS Audit](#10-css-audit)
11. [Service & DI Audit](#11-service--di-audit)
12. [Context Keys Audit](#12-context-keys-audit)
13. [Tests & Build Config](#13-tests--build-config)
14. [Architecture Compliance](#14-architecture-compliance)
15. [Prioritised Fix List](#15-prioritised-fix-list)

---

## 1. Codebase Overview

| Metric | Value |
|--------|-------|
| `.ts` source files | 134 |
| Total source lines | ~27,400 |
| `.css` files | 9 |
| Total CSS lines | ~3,189 |
| E2E test files | 8 (+1 fixture) |
| E2E test cases | 53 |
| Unit test files | **0** |
| npm dependencies | 0 runtime, 7 dev |
| Registered services | 22 |
| Registered theme tokens | 119 |
| Theme files | 4 (dark-modern, light-modern, hc-dark, hc-light) |

### Module breakdown (lines)

| Module | Files | Lines |
|--------|------:|------:|
| `workbench/` | 3 | 4,253 |
| `built-in/` | 19 | 3,484 |
| `commands/` | 4 | 2,510 |
| `parts/` | 10 | 2,468 |
| `editor/` | 7 | 2,335 |
| `services/` | 15 | 2,355 |
| `tools/` | 8 | 2,065 |
| `ui/` | 12 | 2,064 |
| `api/` | 10 | 1,957 |
| `contributions/` | 5 | 1,675 |
| `platform/` | 7 | 1,645 |
| `layout/` | 7 | 1,559 |
| `views/` | 5 | 1,524 |
| `context/` | 4 | 1,182 |
| `workspace/` | 4 | 841 |
| `configuration/` | 4 | 798 |
| `theme/` | 4 | 406 |

---

## 2. Inline Style Violations

**Rule:** *"No inline `element.style.*` for visual properties. Only computed
dimensions (layout-driven width/height) may be inline."*

**Total `element.style.*` usages:** ~460 across 34 files.

### Critical — entire UIs built with inline JS styles

| File | Count | Notes |
|------|------:|-------|
| `src/api/notificationService.ts` | 125 | Toast, input modal, quick-pick — all inline. 20+ hardcoded colors. |
| `src/built-in/welcome/main.ts` | 35 | Welcome page entirely `.style.cssText`. No CSS file. |
| `src/contributions/viewContribution.ts` | 25 | Placeholder views use inline flexbox + colors. |
| `src/built-in/tool-gallery/main.ts` | 24 | Gallery UI 100% JS-styled. No CSS file. |
| `src/dnd/dropOverlay.ts` | 19 | Drop zone colors hardcoded (`rgba(0,120,212,…)`). |
| `src/editor/editorPane.ts` | 17 | Placeholder and tool panes use inline flex + colors. |
| `src/built-in/editor/textEditorPane.ts` | 16 | Mix of CSS file + inline overrides. |
| `src/contributions/menuContribution.ts` | 12 | Menu bar buttons + dropdown menus. |
| `src/built-in/output/main.ts` | 10 | Output panel fully inline-styled. No CSS file. |
| `src/layout/gridNode.ts` | 13 | Sash elements: cursor, width, height, flex, z-index. |

### Anti-patterns

| Pattern | Count | Notes |
|---------|------:|-------|
| `style.display = 'none'` / `''` toggle | 44 | Should use `hide()`/`show()` from `ui/dom.ts` (exported, never imported). |
| `style.cssText` bulk assignment | 57 | Entire multi-property blocks as strings. Should be CSS classes. |
| Hardcoded color literals in styles | 50+ | See §4 below. |

---

## 3. Raw DOM Violations

**Rule:** *"No raw `document.createElement` for standard widgets. Use `src/ui/`
components."*

**Total raw `createElement` in feature code:** ~280 calls outside `src/ui/`.

### Worst offenders

| File | Calls | Should use |
|------|------:|------------|
| `src/built-in/search/main.ts` | 30 | `InputBox`, `Button`, `FilterableList` |
| `src/workbench/workbench.ts` | 29 | `Overlay`, `InputBox`, `Button`, list elements |
| `src/built-in/welcome/main.ts` | 27 | `Button`, heading/row components |
| `src/built-in/editor/settingsEditorPane.ts` | 22 | `InputBox`, `FilterableList` |
| `src/built-in/explorer/main.ts` | 21 | `FilterableList`, `ContextMenu` |
| `src/built-in/tool-gallery/main.ts` | 19 | `FilterableList`, `Button`, `CountBadge` |
| `src/api/notificationService.ts` | 19 | `Overlay`, `InputBox`, `Button` |
| `src/built-in/editor/keybindingsEditorPane.ts` | 18 | `InputBox`, list/table elements |
| `src/commands/quickAccess.ts` | 15 | `Overlay`, `InputBox`, `FilterableList` |
| `src/editor/editorGroupView.ts` | 15 | `TabBar` (which exists in `ui/`!) |
| `src/views/viewContainer.ts` | 13 | Section headers, chevrons, sash elements |
| `src/parts/titlebarPart.ts` | 12 | Window control buttons |
| `src/parts/activityBarPart.ts` | 10 | Activity bar buttons + badges |

---

## 4. Hardcoded Colors

### CSS files — clean ✔

All hex colors in `.css` files are inside `var(--vscode-*, fallback)` expressions.
Two standalone `rgba()` values are acceptable (modal backdrop, box-shadow).
One platform color (`#e81123` — Windows close-button red) is documented.

### TypeScript files — significant violations ✘

| File | Hardcoded colors | Examples |
|------|-----------------:|---------|
| `src/api/notificationService.ts` | 20 | `#252526`, `#cccccc`, `#0e639c`, `#f14c4c`, `#3794ff`, `#cca700` |
| `src/contributions/menuContribution.ts` | 7 | `#ccc`, `#252526`, `#3c3c3c`, `#2a2d2e`, `rgba(255,255,255,0.1)` |
| `src/dnd/dropOverlay.ts` | 4 | `rgba(0,120,212,0.15/0.6)`, `rgba(220,38,38,0.08/0.4)` |
| `src/contributions/viewContribution.ts` | 1 | `#6a6a6a` |
| `src/editor/editorPane.ts` | 2 | `#888` (×2) |

**Impact:** These files render incorrectly in Light and High Contrast themes
because they assume a dark background. The theme system has registered tokens
for all of these use cases (`notifications.*`, `menu.*`, `editorGroup.drop*`)
but the code doesn't consume them.

---

## 5. Theme System Gaps

### Registered tokens: 119 · Consumed in CSS/TS: 42 (35%)

**77 tokens (65%) are injected as CSS variables but never read** by any
stylesheet or TypeScript code. Root cause: Part classes apply colors via inline
`element.style.*` using `getComputedStyle()` or direct values instead of CSS
classes referencing `var(--vscode-*)`.

### Tokens missing from theme JSON files

| Theme file | Present | Missing |
|------------|--------:|--------:|
| dark-modern.json | 90 | **29** |
| light-modern.json | 94 | **25** |
| hc-dark.json | 91 | **28** |
| hc-light.json | 91 | **28** |

#### 25 tokens missing from ALL 4 themes

| Category | Tokens |
|----------|--------|
| Badge | `badge.background`, `badge.foreground` |
| Breadcrumbs | `breadcrumb.activeSelectionForeground`, `.background`, `.focusForeground`, `.foreground` |
| Editor | `editor.findMatchHighlightBackground`, `editorIndentGuide.background`, `editorLineNumber.activeForeground`, `editorLineNumber.foreground` |
| Editor Groups | `editorGroup.border`, `editorGroupHeader.border` |
| Editor Widgets | `editorWidget.background`, `.border`, `.foreground` |
| Inputs | `inputOption.activeBackground`, `.activeBorder`, `.activeForeground` |
| Minimap | `minimapSlider.activeBackground`, `.hoverBackground` |
| Quick Input | `quickInputList.focusForeground` |
| Text | `textBlockQuote.border`, `.foreground`, `textCodeBlock.background` |
| Toolbar | `toolbar.activeBackground` |

#### 4 additional tokens missing from dark-modern.json only

`scrollbarSlider.activeBackground`, `.background`, `.hoverBackground`, `titleBar.border`

---

## 6. Unused `ui/` Components

These `src/ui/` components exist and are exported but **never consumed** by
feature code:

| Component | Potential consumers |
|-----------|-------------------|
| `hide()` / `show()` from `dom.ts` | 44 locations that toggle `style.display` directly |
| `TabBar` | `editorGroupView.ts` (builds its own tab bar manually) |
| `Overlay` | `notificationService.ts`, `quickAccess.ts`, `workbench.ts` (theme picker, notification center, workspace transition) |
| `InputBox` | `search/main.ts`, `settingsEditorPane.ts`, `notificationService.ts`, `quickAccess.ts` |
| `Button` | `welcome/main.ts`, `tool-gallery/main.ts`, `notificationService.ts` |
| `FilterableList` | `search/main.ts`, `explorer/main.ts`, `tool-gallery/main.ts`, `quickAccess.ts` |
| `ActionBar` | `editorGroupView.ts` toolbar, sidebar headers |
| `CountBadge` | `activityBarPart.ts`, `tool-gallery/main.ts` |
| `ContextMenu` | `explorer/main.ts` (builds its own), `menuContribution.ts` |

---

## 7. Duplicate Logic Patterns

### Pattern 1: Drag cursor/userSelect guard

Identical `document.body.style.cursor` / `userSelect` toggle on mousedown/mouseup:
- `src/layout/grid.ts` (L497–504)
- `src/views/viewContainer.ts` (L654–661)

**Fix:** Extract `startDrag(cursor)` / `endDrag()` utility.

### Pattern 2: `style.display` toggle (44 sites)

Used in 15+ files instead of `hide()` / `show()` from `ui/dom.ts`.

### Pattern 3: Fill-container sizing

`width: 100%; height: 100%; overflow: hidden; position: relative` repeated inline in:
- `src/layout/layoutRenderer.ts` (L193–196)
- `src/layout/gridNode.ts` (L185–190)
- `src/layout/gridView.ts` (L78–79)
- `src/editor/editorPane.ts` (L86–89)
- `src/contributions/viewContribution.ts` (L456–459)
- `src/api/bridges/viewsBridge.ts` (L164–166)

**Fix:** Single CSS class `.fill-container`.

### Pattern 4: Hover highlight via mouseenter/mouseleave (10 sites)

JS-based `el.style.background = '#2a2d2e'` on mouseenter, `'transparent'` on
mouseleave:
- `src/built-in/welcome/main.ts` (×3)
- `src/built-in/tool-gallery/main.ts`
- `src/workbench/workbench.ts` (theme picker)
- `src/commands/quickAccess.ts`
- `src/contributions/menuContribution.ts` (×2)
- `src/ui/contextMenu.ts`

**Fix:** CSS `:hover` rule on a shared class, or `hoverable()` DOM helper.

### Pattern 5: Modal overlay construction (4 sites)

Creating `position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: …`
overlay divs:
- `src/api/notificationService.ts` (L609–616)
- `src/workbench/workbench.ts` — theme picker (L398), notification center
  (L4098), workspace transition (L4417)

**Fix:** Use existing `ui/overlay.ts`.

### Pattern 6: `.style.cssText` bulk style blocks

Entire components styled via JS string concatenation instead of CSS files:
- `src/built-in/welcome/main.ts` — 21 `.cssText` assignments
- `src/built-in/tool-gallery/main.ts` — 20
- `src/built-in/output/main.ts` — 7
- `src/contributions/menuContribution.ts` — 6

---

## 8. Dead & Unused Exports

~130 exported symbols are never imported by any other file in `src/`.

### Genuinely dead (safe to remove)

| File | Symbols |
|------|---------|
| `platform/lifecycle.ts` | `AsyncDisposable`, `AsyncDisposableStore`, `combinedDisposable`, `disableDisposalTracking`, `enableDisposalTracking`, `getUndisposedCount`, `getUndisposedTraces`, `IAsyncDisposable`, `isDisposable`, `markAsDisposed`, `MutableDisposable`, `RefCountDisposable`, `safeDispose`, `toAsyncDisposable`, `disableLeakWarnings`, `enableLeakWarnings` |
| `platform/events.ts` | `fromDOMEvent`, `fromPromise`, `throttle` |
| `platform/storage.ts` | `IndexedDBStorage`, `InMemoryStorage`, `ISyncStorage`, `NamespacedSyncStorage`, `StorageError` |
| `layout/` | `GridChangeEvent`, `BaseGridView`, `GridViewFactory`, `SerializedPartState`, `SerializedViewAssignment`, `GridEventType`, `SashEdge` |
| `editor/` | `EditorCloseResult`, `EditorMoveTarget`, `SerializedEditorGroupLayout`, `SerializedEditorPartLayout`, `EditorDropEvent`, `ToolEditorPane`, `FileElement` |
| `views/` | `TabInfo`, `ViewContainerMode`, `SerializedViewDescriptor`, `serializeViewDescriptor` |
| `services/` | `EditorResolution`, `EditorResolverRegistration`, `CircularDependencyError`, `ServiceNotFoundError`, `MissingDependencyError`, `createInstance`, `injectOptional`, `ServiceDependency` |
| `context/` | `clearWhenClauseCache`, `WhenClauseNode`, `WhenClauseParseError`, `FocusChangeEvent` |
| `tools/` | `ToolScanFailure`, `ToolScanner`, `ToolScanResult`, `ValidationWarning`, `LoadModuleResult` |
| `theme/` | `ColorDefault`, `ColorRegistration` |
| `ui/` | `FindReplaceWidgetOptions` |

### Infrastructure-ahead-of-usage (keep)

| Category | Count | Rationale |
|----------|------:|-----------|
| `parallx.d.ts` API types (`CancellationToken`, `MessageAction`, `MessageSeverity`, `QuickPickItem`, etc.) | 8 | Public tool API surface; tools will consume these. |
| `CTX_*` context key constants | 17 | All 22 keys are set at runtime; tools will use them in `when` clauses. |
| Placeholder views (`ExplorerPlaceholderView`, `SearchPlaceholderView`, etc.) | 8 | Registered for tool-contributed view fallbacks. |
| DI decorators (`@inject`, `ServiceDescriptor`) | 3 | Infrastructure for lazy DI adoption. |
| Tool manifest types (`IManifestEngines`, `IManifestViewDescriptor`, etc.) | 5 | Used by tool validation at runtime. |
| `apiVersionValidation.ts` exports (`isCompatible`, `VersionCompatibilityResult`) | 2 | Future API version gating. |

---

## 9. Large Files (> 500 lines)

| File | Lines | Concern |
|------|------:|---------|
| **`workbench/workbench.ts`** | **3,933** | **God file.** Layout wiring, theme picker, zen mode, notification center, sidebar/panel setup, tab management, context menus, workspace transitions. Should be split into 10+ focused modules. |
| `commands/structuralCommands.ts` | 1,190 | All structural commands. Split by category (layout, editor, view). |
| `commands/quickAccess.ts` | 1,058 | Widget + all providers. Widget rendering → `ui/`. |
| `built-in/explorer/main.ts` | 1,005 | File explorer. Tree rendering, DnD, context menus, breadcrumbs. |
| `editor/editorGroupView.ts` | 781 | Editor group + manual tab bar. Use `ui/TabBar`. |
| `built-in/search/main.ts` | 717 | Search UI. Use `ui/` components. |
| `views/viewContainer.ts` | 695 | View container. Section management extractable. |
| `layout/grid.ts` | 591 | Grid layout engine. Algorithmic — acceptable. |
| `built-in/editor/textEditorPane.ts` | 590 | Text editor + find/replace. |
| `services/serviceTypes.ts` | 585 | Type declarations only — acceptable. |
| `parts/titlebarPart.ts` | 550 | Titlebar + menu bar + window controls. Menu bar extractable. |
| `api/notificationService.ts` | 531 | Notification system. Inline-styled throughout. |
| `api/parallx.d.ts` | 514 | API type declarations — acceptable. |
| `parts/editorPart.ts` | 509 | Editor part management. |

---

## 10. CSS Audit

### Files

| File | Lines |
|------|------:|
| `src/workbench.css` | 1,774 |
| `src/ui/ui.css` | 541 |
| `src/built-in/explorer/explorer.css` | 224 |
| `src/built-in/editor/textEditorPane.css` | 186 |
| `src/built-in/editor/settingsEditorPane.css` | 139 |
| `src/built-in/editor/markdownEditorPane.css` | 137 |
| `src/built-in/editor/keybindingsEditorPane.css` | 104 |
| `src/built-in/editor/imageEditorPane.css` | 53 |
| `src/built-in/editor/pdfEditorPane.css` | 31 |

### Missing co-located CSS files

These built-in tools / features have **no CSS file** — all styling is inline JS:

- `src/built-in/welcome/` — Welcome page
- `src/built-in/output/` — Output panel
- `src/built-in/tool-gallery/` — Tool gallery
- `src/built-in/search/` — Search (partial — has some inline)
- `src/api/notificationService.ts` — Notification system
- `src/contributions/menuContribution.ts` — Menu bar

### Unused CSS classes

None. Every class in `.css` files is referenced by at least one `.ts` file.

### Duplicate CSS selectors

None. Each selector block appears exactly once.

### Minor redundancy

`ui/ui.css` L40 and L44 — `.px-button:hover` and `.px-button:active` both set
`background-color: var(--vscode-button-hoverBackground)`. The `:active` state
should have a distinct pressed style.

---

## 11. Service & DI Audit

### Registration completeness

All 22 registered services are consumed. No orphan registrations.

| Registration site | Services |
|-------------------|---------|
| `workbenchServices.ts` — core | `ILifecycleService`, `IContextKeyService`, `ICommandService`, `IToolRegistryService`, `INotificationService`, `IActivationEventService`, `IToolErrorService`, `IFileService`, `ITextFileModelManager` |
| `workbenchServices.ts` — deferred | `IConfigurationService`, `ICommandContributionService`, `IKeybindingContributionService`, `IMenuContributionService`, `IKeybindingService`, `IViewContributionService` |
| `workbench.ts` — late-bound | `IWindowService`, `IThemeService`, `IEditorGroupService`, `IEditorService`, `ILayoutService`, `IViewService`, `IWorkspaceService`, `IToolActivatorService` |

### DI pattern issues

1. **All registrations use `registerInstance()` with pre-built objects.** The
   decorator-based lazy DI (`@inject`, `ServiceDescriptor`) in
   `platform/instantiation.ts` is fully implemented but unused.

2. **Pervasive `as any` casts** in `workbenchServices.ts` and `workbench.ts`
   bypass the typed DI system (e.g., `services.registerInstance(IFileService,
   fileService as any)`).

### Contribution system

All 4 contribution processors (command, keybinding, menu, view) are implemented,
registered as services, and wired into the workbench lifecycle for both initial
and dynamic tool registration. **Fully functional.**

---

## 12. Context Keys Audit

22 `CTX_*` keys declared in `workbenchContext.ts`. **All 22 are created and
updated at runtime** — no orphan declarations.

**However, only 1 key is consumed in when-clause expressions:**
- `activeEditor` — used in `structuralCommands.ts` L682

The remaining 21 keys are set but never referenced. They exist as infrastructure
for tool extensions to consume via `when` clauses in their manifests.

---

## 13. Tests & Build Config

### Tests

| Type | Files | Cases | Status |
|------|------:|------:|--------|
| E2E (Playwright) | 8 | 53 | Configured and runnable |
| Unit (Jest) | 0 | 0 | **No test files exist** despite Jest being configured |

### Unused npm packages

| Package | Why unused |
|---------|-----------|
| `jest` | No unit test files |
| `ts-jest` | No unit test files |
| `@types/jest` | No unit test files |

### TypeScript config

| Setting | Value | Note |
|---------|-------|------|
| `strict` | `true` | ✔ |
| `noImplicitReturns` | `true` | ✔ |
| `noFallthroughCasesInSwitch` | `true` | ✔ |
| `noUnusedLocals` | **`false`** | Could be enabled to catch dead code |
| `noUnusedParameters` | **`false`** | Could be enabled |
| `experimentalDecorators` | `true` | For `@inject` (currently unused in production) |

---

## 14. Architecture Compliance

`ARCHITECTURE.md` defines a layered architecture. Compliance status:

| Rule | Status |
|------|--------|
| `platform/` has no upward deps | ✔ Compliant |
| `services/` contains interfaces + implementations | ✔ Compliant |
| `workbench/` is composition root | ✔ Compliant |
| `layout/` depends only on `platform/` | ✔ Compliant |
| `contributions/` uses `type` imports from `tools/` | ✔ Compliant |
| DI via `ServiceIdentifier` + `@inject` + `ServiceCollection` | ⚠ Partially — `@inject` unused, `as any` bypasses |
| Co-located `*Types.ts` files per module | ✔ Compliant |
| Unit tests at `tests/{module}/{file}.test.ts` | ✘ **No unit tests exist** |
| No inline styles for visual properties | ✘ **~460 violations** |
| No raw `createElement` for standard widgets | ✘ **~280 violations** |

---

## 15. Prioritised Fix List

### P0 — Critical (theme-breaking / god-file)

| # | Issue | Scope | Action |
|---|-------|-------|--------|
| 1 | `workbench.ts` is 3,933 lines | 1 file | Extract theme picker, zen mode, notification center, sidebar/panel setup, workspace transitions into separate modules |
| 2 | `notificationService.ts` — 20 hardcoded dark-theme colors | 1 file | Move styling to CSS file using `var(--vscode-notifications-*)` tokens |
| 3 | `dropOverlay.ts` — hardcoded drop colors | 1 file | Use registered `editorGroup.dropBackground` / `dropBorder` tokens |

### P1 — High (code quality / consistency)

| # | Issue | Scope | Action |
|---|-------|-------|--------|
| 4 | 6 built-in tools have no CSS file | 6 files | Create co-located CSS files for welcome, output, tool-gallery, search, notification, menu |
| 5 | `editorGroupView.ts` builds tab bar manually | 1 file | ✅ Refactored to use `ui/TabBar`. Enhanced TabBar with scroll overflow, positional DnD, cross-bar drops, context menu, middle-click, actions slot. editorGroupView: 905→570 lines. Bundle: 913.6→870.2kb. |
| 6 | 44 `style.display` toggles instead of `hide()`/`show()` | 15+ files | Adopt `ui/dom.ts` utilities |
| 7 | 57 `.style.cssText` bulk assignments | 10+ files | Move to CSS classes |
| 8 | `menuContribution.ts` uses custom CSS vars instead of `--vscode-*` | 1 file | Switch to standard theme tokens |
| 9 | 25 registered theme tokens missing from all 4 theme files | 4 JSON files | Add missing token values |
| 10 | 65% of registered theme tokens never consumed | CSS + TS | Migrate Part classes from inline styles to CSS `var(--vscode-*)` |

### P2 — Medium (dead code / duplication)

| # | Issue | Scope | Action |
|---|-------|-------|--------|
| 11 | ~60 genuinely dead exports | 15+ files | Remove after confirming not needed |
| 12 | 5 duplicate logic patterns (~70 sites) | Codebase-wide | Extract shared utilities |
| 13 | 3 unused npm packages (Jest infra) | `package.json` | Remove or implement unit tests |
| 14 | All service registrations use `as any` casts | 2 files | Fix typed DI or remove decorator infra |
| 15 | 280 raw `createElement` calls in feature code | 15+ files | Migrate to `ui/` components |

### P3 — Low (nice-to-have)

| # | Issue | Scope | Action |
|---|-------|-------|--------|
| 16 | Enable `noUnusedLocals` / `noUnusedParameters` | `tsconfig.json` | Catch dead code at compile time |
| 17 | `.px-button:active` same as `:hover` | `ui/ui.css` | Add distinct pressed state |
| 18 | 21 context keys set but unused in when-clauses | — | No action needed until tools consume them |
| 19 | `@inject` DI infra unused | `platform/instantiation.ts` | Keep for future adoption |
