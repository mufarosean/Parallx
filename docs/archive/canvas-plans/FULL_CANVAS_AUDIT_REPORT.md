# Full-Scale Canvas Audit Report

**Branch:** `cleanup`  
**Date:** 2025-06-14  
**Scope:** All files under `src/built-in/canvas/` (~53 TypeScript files + canvas.css + 5 SQL migrations)

---

## Table of Contents

1. [File Inventory](#1-file-inventory)
2. [Gate Compliance Audit](#2-gate-compliance-audit)
3. [Dead Code & Unused Exports](#3-dead-code--unused-exports)
4. [Redundancy & Efficiency](#4-redundancy--efficiency)
5. [CSS Audit](#5-css-audit)
6. [Actionable Summary](#6-actionable-summary)

---

## 1. File Inventory

### Directory Structure

```
canvas/
├── main.ts                              (tool entry point)
├── canvasEditorProvider.ts              (editor lifecycle, plugin wiring)
├── canvasDataService.ts                 (persistence layer)
├── canvasSidebar.ts                     (sidebar tree view)
├── canvasTypes.ts                       (shared interfaces)
├── canvasIcons.ts                       (SVG icon definitions)
├── contentSchema.ts                     (envelope encode/decode)
├── markdownExport.ts                    (markdown serialization)
├── canvas.css                           (~3645 lines)
├── config/
│   ├── blockRegistry.ts                 (GATE — block metadata, capabilities)
│   ├── iconRegistry.ts                  (GATE — SVG/icon access)
│   ├── tiptapExtensions.ts              (extension aggregator)
│   └── blockStateRegistry/
│       ├── blockStateRegistry.ts        (GATE — barrel re-export)
│       ├── blockLifecycle.ts            (create/delete/duplicate)
│       ├── blockTransforms.ts           (turn-into, attribute changes)
│       ├── blockMovement.ts             (move up/down/indent)
│       ├── columnCreation.ts            (column wrapping/splitting)
│       ├── columnInvariants.ts          (column backfill/normalize)
│       ├── crossPageMovement.ts         (cross-page drag)
│       └── dragSession.ts              (drag state machine)
├── extensions/
│   ├── blockBackground.ts              (pure leaf)
│   ├── blockKeyboardShortcuts.ts       (selection shortcuts)
│   ├── bookmarkNode.ts
│   ├── calloutNode.ts
│   ├── columnNodes.ts
│   ├── detailsEnterHandler.ts
│   ├── mathBlockNode.ts
│   ├── mediaNodes.ts
│   ├── pageBlockNode.ts
│   ├── structuralInvariantGuard.ts     (⚠ gate violation)
│   ├── tableOfContentsNode.ts
│   └── toggleHeadingNode.ts
├── handles/
│   ├── handleRegistry.ts               (GATE)
│   ├── blockHandles.ts
│   ├── blockSelection.ts
│   └── blockMarquee.ts
├── menus/
│   ├── canvasMenuRegistry.ts            (GATE)
│   ├── slashMenu.ts
│   ├── bubbleMenu.ts
│   ├── blockActionMenu.ts
│   ├── iconMenu.ts
│   ├── coverMenu.ts
│   ├── imageInsertPopup.ts
│   ├── mediaInsertPopup.ts
│   └── bookmarkInsertPopup.ts
├── plugins/
│   ├── structuralInvariantPlugin.ts
│   ├── columnResizePlugin.ts
│   ├── columnHoverPlugin.ts
│   └── placeholderPlugin.ts
├── header/
│   └── pageChrome.ts
├── math/
│   └── inlineMathEditor.ts
├── invariants/
│   └── canvasStructuralInvariants.ts
├── pickers/                             (⚠ empty directory)
└── migrations/
    ├── 001_initial.sql
    ├── 002_add_cover.sql
    ├── 003_add_softdelete.sql
    ├── 004_add_icon.sql
    └── 005_add_workspace_id.sql
```

**Totals:** ~53 .ts files, 1 .css file, 5 .sql files, 1 empty directory

---

## 2. Gate Compliance Audit

### Methodology

Every `.ts` file under `canvas/` was checked for adherence to the Five-Registry Gate Architecture as defined in `ARCHITECTURE.md` and enforced by `gateCompliance.test.ts`.

### Gate-to-Gate Edges

All 5 gates follow the allowed edge rules:

| Gate | Allowed Deps | Status |
|------|-------------|--------|
| **IconRegistry** | (leaf — none) | ✅ |
| **BlockRegistry** | IconRegistry, BlockStateRegistry | ✅ |
| **CanvasMenuRegistry** | BlockRegistry, IconRegistry, BlockStateRegistry | ✅ |
| **BlockStateRegistry** | BlockRegistry | ✅ |
| **HandleRegistry** | BlockRegistry, IconRegistry, BlockStateRegistry, CanvasMenuRegistry | ✅ |

### Per-File Compliance

| Domain | Files | Pass | Fail |
|--------|-------|------|------|
| Extensions (→ BlockRegistry) | 12 | 11 | 1 |
| Menus (→ CanvasMenuRegistry) | 9 | 9 | 0 |
| Handles (→ HandleRegistry) | 3 | 3 | 0 |
| BSR children (→ blockStateRegistry.ts) | 8 | 8 | 0 |
| Gates (inter-gate) | 5 | 5 | 0 |
| Non-gated root files | 16 | 16 | 0 |
| **Total** | **53** | **52** | **1** |

### Violations

#### V1: `structuralInvariantGuard.ts` bypasses BlockRegistry

**File:** `extensions/structuralInvariantGuard.ts` line 4  
**Import:** `import { structuralInvariantPlugin } from '../plugins/structuralInvariantPlugin.js'`  
**Rule broken:** Extensions must import only from `blockRegistry.ts`. This reaches into `plugins/` (BlockStateRegistry domain).  
**Fix:** Inline the 5-line wrapper into `tiptapExtensions.ts` (its only consumer). Eliminates the file and the violation. See §4 for details.

### Suspicious (not violations, but worth noting)

- `pageBlockNode.ts` uniquely imports `layoutPopup` from `ui/dom.js`. Platform imports are exempt from gate rules, but this is the only extension that reaches outside canvas for a UI utility.

---

## 3. Dead Code & Unused Exports

### 3.1 Unused Exports by Gate

#### `config/iconRegistry.ts`

| Export | Status | Action |
|--------|--------|--------|
| `ALL_ICON_IDS` | **DEAD** | Never imported. Remove export (keep local if needed). |
| `isBlockIconSelectable` | **DEAD** | Never imported. Remove export and function. |

#### `config/blockRegistry.ts`

| Export | Status | Action |
|--------|--------|--------|
| `ShowIconPickerOptions` | **DEAD** | Only used internally. Remove `export` keyword. |
| `BlockCapabilities` | **DEAD** | Only used internally in `BlockDefinition`. Remove `export`. |
| `SlashMenuConfig` | **DEAD** | Only used internally. Remove `export`. |
| `TurnIntoConfig` | **DEAD** | Only used internally. Remove `export`. |
| `BlockDefinition` | **DEAD** | Never imported externally. Remove `export`. |
| `COLUMN_BLOCK_NODE_TYPES` | **DEAD** | Only used to derive `COLUMN_CONTENT_NODE_TYPES` internally. Remove `export`. |
| `COLUMN_CONTENT_NODE_TYPES` | **DEAD** | Only used to derive `COLUMN_CONTENT_EXPRESSION` internally. Remove `export`. |

#### `config/blockStateRegistry/blockMovement.ts` (via barrel)

| Export | Status | Action |
|--------|--------|--------|
| `BlockMoveResult` | **DEAD** | Never imported externally. Remove `export`. |

#### `menus/canvasMenuRegistry.ts`

| Export | Status | Action |
|--------|--------|--------|
| `CanvasMenuHost` | **DEAD** | Only used internally as param type. Remove `export`. |
| `MenuBlockInfo` | **DEAD** | Only used internally. Remove `export`. |

#### `contentSchema.ts`

| Export | Status | Action |
|--------|--------|--------|
| `CanvasContentEnvelope` | **DEAD** | Only used internally in `satisfies`. Remove `export`. |
| `DecodeCanvasContentResult` | **DEAD** | Only used as internal return type. Remove `export`. |

#### `canvasIcons.ts`

| Export | Status | Action |
|--------|--------|--------|
| `renderIconInto` | **DEAD** | Zero consumers. Remove export and function. |

**Total dead exports: 16**

### 3.2 Dead Files

| Path | Status | Action |
|------|--------|--------|
| `pickers/` | **Empty directory** — 0 files | Remove (icon picker migrated to `menus/iconMenu.ts`). |

All other files verified alive via import tracing.

### 3.3 TODO / FIXME / HACK Inventory

**Zero** matches found across all canvas files. Codebase is clean of orphaned markers.

### 3.4 Debug Logging

**42 `console.*` statements** total across canvas files. 39 are tagged `console.error` or `console.warn` in production error-handling paths — intentional.

**3 candidates for removal** (debug-level `console.log`):

| File | Line | Statement | Action |
|------|------|-----------|--------|
| `main.ts` | ~141 | `console.log('[Canvas] Tool activated')` | Remove or gate behind `DEV` |
| `main.ts` | ~155 | `console.log('[Canvas] Tool deactivated')` | Remove or gate behind `DEV` |
| `main.ts` | ~182 | `console.log('[Canvas] Migrations applied from:', migrationsDir)` | Remove or gate behind `DEV` |

### 3.5 Commented-Out Code

**None found.** No substantive commented-out code blocks in any canvas file.

---

## 4. Redundancy & Efficiency

### 4.1 Triplicated Dev-Mode Detection

Three files independently define the same IIFE for dev-mode checking:

| File | Variable |
|------|----------|
| `plugins/structuralInvariantPlugin.ts` | `IS_DEV_MODE` |
| `invariants/canvasStructuralInvariants.ts` | `CANVAS_DEV_MODE` |
| `handles/blockSelection.ts` | `_DEV_MODE` |

All three use identical logic:
```ts
(() => {
  if (typeof window !== 'undefined' && (window as any).parallxElectron?.testMode) return true;
  const proc = (globalThis as any).process;
  if (proc?.env?.NODE_ENV) return proc.env.NODE_ENV !== 'production';
  return true;
})();
```

**Fix:** Extract `isDevMode` to `src/platform/devMode.ts` (pure leaf utility, no gate needed) and import everywhere. Removes ~30 lines of duplication.

### 4.2 Gate Violation: `structuralInvariantGuard.ts`

The file is a trivial 13-line wrapper around `Extension.create()` + the structural invariant plugin. It exists only to be imported by `tiptapExtensions.ts`.

**Fix:** Inline the 5 lines of logic directly into `tiptapExtensions.ts`. This eliminates both the file and the gate violation.

### 4.3 `CrossPageMoveParams` — Misleading Name Duplication

| File | Fields |
|------|--------|
| `canvasTypes.ts` | `sourcePageId`, `targetPageId`, `sourceDoc`, `appendedNodes`, `expectedSourceRevision`, `expectedTargetRevision` |
| `crossPageMovement.ts` | `editor`, `event`, `currentPageId`, `targetPageId`, `dataService` |

These are **not duplicates** — they represent different layers (persistence vs. runtime orchestration). The shared name is confusing.

**Fix:** Rename the `crossPageMovement.ts` version to `CrossPageDropParams` to disambiguate.

### 4.4 `duplicateSelected()` Reimplements `duplicateBlockAt()`

`blockSelection.ts` clones blocks via `schema.nodeFromJSON(node.toJSON())` — the same pattern as `blockLifecycle.duplicateBlockAt()`. The selection version batches multiple blocks in reverse order, so it's not a direct call-through, but the core clone logic is duplicated.

**Fix (low priority):** Could delegate to `duplicateBlockAt()` per block, but the batching strategy differs. Note for future consolidation.

### 4.5 SVG Icon Sizing — Repeated querySelector Pattern

~10 sites across extensions, handles, and menus do:
```ts
const svg = el.querySelector('svg');
if (svg) { svg.setAttribute('width', 'N'); svg.setAttribute('height', 'N'); }
```

**Fix:** Add `svgIconSized(id: string, size: number): string` to `iconRegistry.ts` that injects width/height at creation time. Eliminates querySelector + setAttribute at each call site.

### 4.6 `layoutPopup` Import Pattern

`pageBlockNode.ts` is the only extension importing `layoutPopup` from `ui/dom.js`. All 7 menu files also import `$` and `layoutPopup` from `ui/dom.js` directly.

These are platform-level imports (outside canvas boundary), so not true gate violations. However, for consistency:
- **Extensions:** Re-export `layoutPopup` through `blockRegistry.ts` so `pageBlockNode.ts` uses the gate.
- **Menus:** Optionally re-export `$` and `layoutPopup` through `canvasMenuRegistry.ts`. Low priority.

### 4.7 Performance: `blockHandles._resolveBlockFallback`

The fallback path in `blockHandles.ts` calls `querySelectorAll('*')` on the ProseMirror DOM and filters every element. For large documents, this is O(n) over every DOM node. It only runs when primary `elementsFromPoint()` resolution fails, so the impact is rare but potentially heavy.

**Fix (low priority):** Cache block-level DOM references or limit the scan to the visible viewport.

---

## 5. CSS Audit

### 5.1 Dead Selectors

#### A. Old Icon Picker — `canvas-icon-*` (~106 lines)

Lines 2383–2488. The canvas-specific icon picker was replaced by the generic `IconPicker` (`src/ui/iconPicker.ts`) using `ui-icon-picker-*` classes. These 13 rules are entirely dead:

- `.canvas-icon-picker`, `.canvas-icon-search`, `.canvas-icon-search:focus`
- `.canvas-icon-remove`, `.canvas-icon-remove:hover`
- `.canvas-icon-content`, `.canvas-icon-grid`
- `.canvas-icon-btn`, `.canvas-icon-btn:hover`
- `.canvas-icon-empty`
- Scrollbar rules for `.canvas-icon-content`

#### B. Old Page Block Icon Picker — `canvas-page-block-icon-*` (~34 lines)

Lines 1535–1568. Page block icon picking now delegates to the registry-managed `showIconPicker()`. 6 dead rules:

- `.canvas-page-block-icon-picker`, `.canvas-page-block-icon-remove`
- `.canvas-page-block-icon-remove:hover`, `.canvas-page-block-icon-grid`
- `.canvas-page-block-icon-option`, `.canvas-page-block-icon-option:hover`

#### C. Dead Context Menu Children — `canvas-context-menu-item*` (~34 lines)

Lines 3285–3318. The sidebar uses the generic `ContextMenu.show()` which renders with `context-menu-item` (no `canvas-` prefix). 5 dead rules:

- `.canvas-context-menu-item`, `.canvas-context-menu-item:hover`
- `.canvas-context-menu-item--danger`, `.canvas-context-menu-item--danger:hover`
- `.canvas-context-menu-divider`

> **E2E test impact:** `tests/e2e/09-canvas.spec.ts` (lines 148/168/187) still query `.canvas-context-menu-item`. These selectors are likely broken — update to `.canvas-context-menu .context-menu-item`.

#### D. Dead Media Caption (~4 lines)

Line 1694. `.canvas-media-caption` is never referenced in any TS file.

**Total dead CSS: ~178 lines across 25 rules.**

### 5.2 Duplicate Selectors

#### True Redundancies (first definition entirely superseded)

| Selector | First Def | Second Def | Action |
|----------|----------|------------|--------|
| `.canvas-tiptap-editor pre` | L491 | L1800 | Delete L491–497 (6 lines) |
| `.canvas-tiptap-editor pre code` | L499 | L1815 | Delete L499–505 (6 lines) |

#### Mergeable Overrides

| Selector | First Def | Second Def | Action |
|----------|----------|------------|--------|
| `.canvas-page-menu-action` | L2348 | L3322 | Merge into single rule |
| `.canvas-page-menu-toggle-label` | L2306 | L3328 | Merge into single rule |

### 5.3 Redundant Properties Within Same Block

| Location | Issue |
|----------|-------|
| L1802–1805 | `padding: 20px 24px` immediately overridden by `padding: 0` two lines later |
| L1803–1804 | `margin-inline: 0` made pointless by `margin: 8px 0` shorthand |
| L1804–1805 | `padding-inline: 0` redundant after `padding: 0` |

### 5.4 `!important` Usage

15 instances found — all reviewed and **all necessary**:
- 2 for ProseMirror override (`outline: none !important` on `ProseMirror-selectednode`)
- 8 for drag handle/add-button opacity state machine (`.hide`, `:hover`, `.handle-area-hovered`)
- 2 for column-resize cursor locking
- 3 for column resize hover suppression

No unnecessary `!important` usage found.

### 5.5 Stale Comments

| Location | Issue |
|----------|-------|
| L2375–2377 | Empty "Emoji Picker (Cap 7 — Task 7.4)" section header, no rules. Vestigial. |
| L3334 | `/* (callout-emoji styles consolidated at line ~833) */` — line 833 doesn't contain callout-emoji styles. Stale reference. |
| L3285–3340 | Context menu + page menu override block appended at file end. Should be merged into original sections. |

---

## 6. Actionable Summary

### High Priority

| # | Category | File(s) | Action | Lines Saved |
|---|----------|---------|--------|-------------|
| 1 | Gate violation | `structuralInvariantGuard.ts` | Inline into `tiptapExtensions.ts`, delete file | ~13 |
| 2 | Dead CSS | `canvas.css` L2383–2488 | Remove old icon picker styles | ~106 |
| 3 | Dead CSS | `canvas.css` L1535–1568 | Remove old page block icon picker styles | ~34 |
| 4 | Dead CSS | `canvas.css` L3285–3318 | Remove dead context menu item styles | ~34 |
| 5 | Dead CSS | `canvas.css` L1694 | Remove `.canvas-media-caption` | ~4 |
| 6 | Duplicate CSS | `canvas.css` L491–505 | Remove superseded `pre`/`pre code` rules | ~12 |
| 7 | E2E tests | `09-canvas.spec.ts` L148/168/187 | Fix `.canvas-context-menu-item` → `.canvas-context-menu .context-menu-item` | — |

### Medium Priority

| # | Category | File(s) | Action | Lines Saved |
|---|----------|---------|--------|-------------|
| 8 | Duplication | 3 files | Extract `isDevMode` to `src/platform/devMode.ts` | ~30 |
| 9 | Dead exports | `iconRegistry.ts` | Remove `ALL_ICON_IDS`, `isBlockIconSelectable` | ~10 |
| 10 | Dead exports | `blockRegistry.ts` | Remove `export` from 7 internal types/constants | — |
| 11 | Dead exports | `canvasMenuRegistry.ts` | Remove `export` from `CanvasMenuHost`, `MenuBlockInfo` | — |
| 12 | Dead exports | `contentSchema.ts` | Remove `export` from `CanvasContentEnvelope`, `DecodeCanvasContentResult` | — |
| 13 | Dead exports | `blockMovement.ts` | Remove `export` from `BlockMoveResult` | — |
| 14 | Dead export | `canvasIcons.ts` | Remove `renderIconInto` (function + export) | ~15 |
| 15 | Pattern dup | `iconRegistry.ts` + ~10 sites | Add `svgIconSized()` helper | ~40 |
| 16 | Naming | `crossPageMovement.ts` | Rename `CrossPageMoveParams` → `CrossPageDropParams` | — |

### Low Priority

| # | Category | File(s) | Action |
|---|----------|---------|--------|
| 17 | Consistency | `pageBlockNode.ts` | Re-export `layoutPopup` through `blockRegistry.ts` |
| 18 | Consistency | 7 menu files | Optionally re-export `$`/`layoutPopup` through `canvasMenuRegistry.ts` |
| 19 | Overlap | `blockSelection.ts` | Delegate `duplicateSelected()` to `duplicateBlockAt()` |
| 20 | Debug logs | `main.ts` | Remove 3 `console.log` statements or gate behind `DEV` |
| 21 | Empty dir | `pickers/` | Remove empty directory |
| 22 | CSS merge | `canvas.css` L3322/3328 | Merge overrides into original selector blocks |
| 23 | CSS cleanup | `canvas.css` | Remove 3 redundant properties in Tier 2 `pre` block |
| 24 | CSS cleanup | `canvas.css` | Remove 2 stale comments |
| 25 | Performance | `blockHandles.ts` | Limit `_resolveBlockFallback` DOM scan scope |

### Metrics

| Category | Count |
|----------|-------|
| Gate violations | 1 |
| Dead exports | 16 |
| Dead CSS rules | 25 |
| Dead CSS lines | ~178 |
| Duplicate CSS rules | 2 true + 2 mergeable |
| Dead files/directories | 1 (empty `pickers/`) |
| Debug log candidates | 3 |
| Triplicated code patterns | 1 (dev-mode IIFE) |
| Total removable lines (est.) | ~300+ |
