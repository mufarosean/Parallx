# Milestone 7 — Canvas Editor Decomposition & Modular Architecture

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 7.
> All implementation must conform to the structures and boundaries defined here.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.

---

## Milestone Definition

### Vision
The Canvas editor becomes a **modular, maintainable system** — a set of focused, single-responsibility modules that compose together, replacing the current 4,530-line monolith (`canvasEditorProvider.ts`). Each module is independently testable, readable, and modifiable. The orchestrator file shrinks to ~400 lines of imports, wiring, and lifecycle management.

### Purpose
Milestone 6 delivered a fully-functional Canvas tool with rich text editing, columns, drag-and-drop, slash menu, bubble menu, block action menus, math blocks, page headers, covers, and auto-save. But all of this was built in a single file — `canvasEditorProvider.ts` at **4,530 lines** — violating Parallx's core design philosophy of modularity.

The rest of the codebase follows clean modular patterns:
- `src/parts/` — 10 files, ~200-400 lines each (one per workbench part)
- `src/services/` — 16 files, one per service
- `src/contributions/` — 5 files, one per contribution type
- `src/layout/` — 6 files, one per layout concern

The Canvas editor is the sole exception. This milestone fixes that by decomposing `canvasEditorProvider.ts` into ~15 focused modules averaging ~200-350 lines each.

### Why This Matters
1. **Readability** — A developer looking for the slash menu implementation should open `menus/slashMenu.ts`, not scroll through 4,530 lines.
2. **Testability** — Individual modules can have focused unit tests. Column plugins can be tested without instantiating the full editor.
3. **Modifiability** — Changing the bubble menu doesn't risk breaking the column resize plugin. Git diffs are scoped to the module that changed.
4. **Onboarding** — New contributors can understand one module at a time instead of parsing a monolith.
5. **Future framework adoption** — If we later adopt Lit or Preact for menu components (discussion from M6 retrospective), modular boundaries make that a surgical change rather than a rewrite.

### Background — What Exists Today

**Single file:** `src/built-in/canvas/canvasEditorProvider.ts` — 4,530 lines containing:

| Section | Lines | Description |
|---------|-------|-------------|
| Imports + type augmentation | 1–73 | TipTap/PM imports, `Commands` augmentation |
| `BlockBackgroundColor` extension | 74–106 | Block-level background color via `GlobalAttributes` |
| `Callout` node | 107–215 | Custom `Node.create()` with emoji, NodeView |
| `Column` + `ColumnList` nodes | 216–630 | Column/ColumnList `Node.create()` with plugins array |
| `columnAutoDissolvePlugin()` | 631–694 | `appendTransaction` to dissolve ≤1-column layouts |
| `columnResizePlugin()` | 695–937 | Pointer-based column resize with undo batching |
| `columnDropPlugin()` | 938–1321 | Full drag-and-drop engine (6 scenarios per Rules 3-4) |
| `DetailsEnterHandler` extension | 1322–1373 | Enter on collapsed toggle → new toggle |
| `MathBlock` node | 1374–1575 | Block equation with KaTeX, click-to-edit NodeView |
| `SLASH_MENU_ITEMS` data | 1576–1805 | Slash command definitions (20 items with actions) |
| `CanvasEditorProvider` class | 1806–1835 | 30-line orchestrator class |
| `CanvasEditorPane` class | 1836–4530 | **2,694-line god class** — editor init, content load, top ribbon, page header, cover, icon picker, cover picker, page menu, inline math editor, bubble menu, slash menu, block handles, block action menu, turn-into submenu, color submenu, block operations, dispose |

**Supporting files (already modular — no changes needed):**
- `canvasDataService.ts` — Data layer (page CRUD, auto-save, IPC)
- `canvasTypes.ts` — Type definitions (`IPage`, etc.)
- `canvasIcons.ts` — SVG icon registry
- `canvasSidebar.ts` — Sidebar tree view
- `canvas.css` — All canvas styles (stays unified)
- `markdownExport.ts` — Markdown export utility

### Structural Commitments

- **Zero behavior change.** This is a pure refactor. All 41 E2E tests and 67 unit tests must pass identically before and after.
- **No new dependencies.** No frameworks, no new npm packages. Same vanilla TypeScript + TipTap/ProseMirror stack.
- **CSS stays in one file.** `canvas.css` is already scoped and cohesive. Fragmenting it across modules would make theming harder.
- **Each module exports one thing.** A function, a class, a constant, or a TipTap extension. No barrel files, no re-exports.
- **No circular dependencies.** Modules depend on `canvasTypes.ts`, TipTap/ProseMirror, and utility types — not on each other.
- **`canvasEditorProvider.ts` becomes the orchestrator.** It imports modules, wires them together, and manages the editor pane lifecycle. Target: ~400 lines.
- **Incremental extraction.** Each capability extracts one logical group. Build is verified after each extraction. Tests run after each extraction.

### Architectural Principles

- **Single Responsibility.** Each module handles one concern: one extension, one plugin, one menu, one UI component.
- **Explicit Dependencies.** Each module imports exactly what it needs. No implicit globals, no `window` state sharing between modules.
- **Interface Boundaries.** Where a module needs to communicate with the editor pane (e.g., slash menu needs the TipTap `Editor` instance), it accepts the dependency via constructor/function parameter — not by reaching into a parent class.
- **Testable in Isolation.** A column plugin module can be unit-tested by constructing a minimal TipTap editor with just that plugin. A menu module can be tested by calling its render function with mock data.

---

## Target File Structure

```
src/built-in/canvas/
├── canvasEditorProvider.ts      (~400 lines)  Orchestrator: imports, wires, lifecycle
├── canvasTypes.ts               (existing)    Type definitions
├── canvasDataService.ts         (existing)    Data layer
├── canvasIcons.ts               (existing)    SVG icons
├── canvasSidebar.ts             (existing)    Sidebar tree view
├── canvas.css                   (existing)    All styles
├── markdownExport.ts            (existing)    Export utility
├── main.ts                      (existing)    Tool entry point
│
├── extensions/
│   ├── blockBackground.ts       (~40 lines)   BlockBackgroundColor GlobalAttributes extension
│   ├── calloutNode.ts           (~120 lines)  Callout Node.create() + NodeView
│   ├── columnNodes.ts           (~120 lines)  Column + ColumnList Node.create() (schema only)
│   ├── mathBlockNode.ts         (~210 lines)  MathBlock Node.create() + KaTeX NodeView
│   └── detailsEnterHandler.ts   (~55 lines)   Enter on collapsed toggle extension
│
├── plugins/
│   ├── columnDropPlugin.ts      (~390 lines)  Drag-and-drop engine (Rules 3-4)
│   ├── columnResizePlugin.ts    (~250 lines)  Pointer-based column resize
│   └── columnAutoDissolve.ts    (~65 lines)   appendTransaction to dissolve ≤1-col layouts
│
├── menus/
│   ├── slashMenu.ts             (~340 lines)  Slash command menu (items, filtering, keyboard nav, rendering)
│   ├── bubbleMenu.ts            (~230 lines)  Floating formatting toolbar
│   └── blockActionMenu.ts       (~500 lines)  Handle-click context menu + turn-into + color submenus
│
├── handles/
│   └── blockHandles.ts          (~200 lines)  + button, drag handle, handle resolution, keyboard movement
│
├── header/
│   ├── topRibbon.ts             (~100 lines)  Breadcrumbs, edited timestamp, favorite btn
│   ├── pageHeader.ts            (~400 lines)  Title, icon, hover affordances, cover
│   └── pageMenu.ts              (~200 lines)  Page settings dropdown (font, width, lock)
│
├── pickers/
│   ├── iconPicker.ts            (~100 lines)  Emoji/icon selection popup
│   └── coverPicker.ts           (~180 lines)  Cover gradient/image selection popup
│
├── math/
│   └── inlineMathEditor.ts      (~140 lines)  Click-to-edit popup for inline math nodes
│
└── config/
    └── editorExtensions.ts      (~90 lines)   Extension array assembly (StarterKit + all configs)
```

**Module count:** ~18 new modules + orchestrator
**Average module size:** ~200 lines
**Orchestrator size:** ~400 lines

---

## Capability 0 — TipTap Extensions Extraction

### Capability Description
Extract all custom TipTap extensions and ProseMirror nodes from `canvasEditorProvider.ts` into the `extensions/` directory. Each extension becomes its own module exporting a single TipTap `Node` or `Extension`.

### Goals
- `BlockBackgroundColor` → `extensions/blockBackground.ts`
- `Callout` (Node + NodeView) → `extensions/calloutNode.ts`
- `Column` + `ColumnList` (Node definitions, schema only — plugins stay separate) → `extensions/columnNodes.ts`
- `MathBlock` (Node + KaTeX NodeView) → `extensions/mathBlockNode.ts`
- `DetailsEnterHandler` → `extensions/detailsEnterHandler.ts`
- All imports in `canvasEditorProvider.ts` updated to reference new modules
- Build passes, all tests pass

### Dependencies
- `@tiptap/core` (Extension, Node, mergeAttributes)
- `@tiptap/pm/model` (Fragment — used by Column/ColumnList)
- `katex` (used by MathBlock)
- `canvasIcons.ts` (used by Callout for emoji rendering)

#### Tasks

**Task 0.1 — Extract BlockBackgroundColor**
- **Source lines:** 74–106 of `canvasEditorProvider.ts`
- **Target:** `src/built-in/canvas/extensions/blockBackground.ts`
- **Export:** `const BlockBackgroundColor: Extension`
- **Completion Criteria:**
  - Module exports the extension, self-contained
  - `canvasEditorProvider.ts` imports from new module
  - Build passes, grep confirms no duplicate definition

**Task 0.2 — Extract Callout Node**
- **Source lines:** 107–215
- **Target:** `src/built-in/canvas/extensions/calloutNode.ts`
- **Export:** `const Callout: Node`
- **Completion Criteria:**
  - Node definition + full NodeView (emoji picker, contentDOM) in one module
  - `canvasIcons.ts` import for emoji SVGs
  - Build passes, Callout slash menu action still works

**Task 0.3 — Extract Column + ColumnList Nodes**
- **Source lines:** 216–630 (schema definitions only — the `addProseMirrorPlugins()` array stays until Capability 1)
- **Target:** `src/built-in/canvas/extensions/columnNodes.ts`
- **Export:** `const Column: Node`, `const ColumnList: Node`
- **Decision:** The `addProseMirrorPlugins()` method on ColumnList currently returns `[columnResizePlugin(), columnDropPlugin(), columnAutoDissolvePlugin()]`. After Capability 1 extracts the plugins, this method will import them from `plugins/`. The column node schema and the plugin wiring stay together in this module since TipTap couples them via `addProseMirrorPlugins()`.
- **Completion Criteria:**
  - Column schema (attributes, parseHTML, renderHTML) exported
  - ColumnList schema + `addProseMirrorPlugins()` exported
  - Plugin functions imported from `plugins/` (after Capability 1)
  - Build passes, column creation via slash menu works

**Task 0.4 — Extract MathBlock Node**
- **Source lines:** 1374–1575
- **Target:** `src/built-in/canvas/extensions/mathBlockNode.ts`
- **Export:** `const MathBlock: Node`
- **Completion Criteria:**
  - Full NodeView (KaTeX render, click-to-edit textarea, auto-resize) self-contained
  - `katex` import stays with this module
  - Build passes, math block creation + editing works

**Task 0.5 — Extract DetailsEnterHandler**
- **Source lines:** 1322–1373
- **Target:** `src/built-in/canvas/extensions/detailsEnterHandler.ts`
- **Export:** `const DetailsEnterHandler: Extension`
- **Completion Criteria:**
  - Extension self-contained with keyboard shortcut handler
  - Build passes, Enter on collapsed toggle creates new toggle

---

## Capability 1 — ProseMirror Plugins Extraction

### Capability Description
Extract all three column-related ProseMirror plugins into the `plugins/` directory. Each plugin becomes its own module exporting a factory function that returns a `Plugin` instance.

### Goals
- `columnAutoDissolvePlugin()` → `plugins/columnAutoDissolve.ts`
- `columnResizePlugin()` → `plugins/columnResizePlugin.ts`
- `columnDropPlugin()` → `plugins/columnDropPlugin.ts`
- `columnNodes.ts` imports plugin factories from `plugins/`
- Build passes, all 41 E2E column tests pass

### Dependencies
- `@tiptap/pm/state` (Plugin, PluginKey)
- `@tiptap/pm/model` (Fragment — used by drop plugin)
- `docs/BLOCK_INTERACTION_RULES.md` (behavioral specification for drop plugin)

#### Tasks

**Task 1.1 — Extract columnAutoDissolvePlugin**
- **Source lines:** 631–694
- **Target:** `src/built-in/canvas/plugins/columnAutoDissolve.ts`
- **Export:** `function columnAutoDissolvePlugin(): Plugin`
- **Completion Criteria:**
  - Self-contained `appendTransaction` plugin
  - Build passes, columns auto-dissolve when ≤1 column remains

**Task 1.2 — Extract columnResizePlugin**
- **Source lines:** 695–937
- **Target:** `src/built-in/canvas/plugins/columnResizePlugin.ts`
- **Export:** `function columnResizePlugin(): Plugin`
- **Completion Criteria:**
  - Pointer tracking, undo batching, cursor management self-contained
  - Build passes, column resize works with undo

**Task 1.3 — Extract columnDropPlugin**
- **Source lines:** 938–1321
- **Target:** `src/built-in/canvas/plugins/columnDropPlugin.ts`
- **Export:** `function columnDropPlugin(): Plugin`
- **Completion Criteria:**
  - All 6 drop scenarios (4A–4F) preserved
  - Drop indicators (vertical + horizontal) self-contained
  - Build passes, all 41 column E2E tests pass

**Task 1.4 — Wire plugins into columnNodes.ts**
- **Update:** `extensions/columnNodes.ts` `addProseMirrorPlugins()` imports from `plugins/`
- **Completion Criteria:**
  - `import { columnAutoDissolvePlugin } from '../plugins/columnAutoDissolve.js'`
  - `import { columnResizePlugin } from '../plugins/columnResizePlugin.js'`
  - `import { columnDropPlugin } from '../plugins/columnDropPlugin.js'`
  - Build passes

---

## Capability 2 — Menus Extraction

### Capability Description
Extract all three menu systems (slash menu, bubble menu, block action menu) from the `CanvasEditorPane` class into the `menus/` directory. Each menu becomes a class or set of functions that accepts the TipTap `Editor` instance and a container element.

### Goals
- Slash menu (items data + trigger detection + menu UI + keyboard nav + item execution) → `menus/slashMenu.ts`
- Bubble menu (creation + positioning + active state tracking + link input) → `menus/bubbleMenu.ts`
- Block action menu (menu creation + show/hide + turn-into submenu + color submenu + block operations) → `menus/blockActionMenu.ts`
- `CanvasEditorPane` creates menu instances and delegates to them
- Build passes, all menu interactions work identically

### Interface Design

```typescript
// menus/slashMenu.ts
export class SlashMenu {
  constructor(container: HTMLElement, editor: Editor);
  check(editor: Editor): void;       // called on editor update
  show(editor: Editor): void;
  hide(): void;
  get isVisible(): boolean;
  dispose(): void;
}

// menus/bubbleMenu.ts
export class BubbleMenu {
  constructor(container: HTMLElement, editor: Editor);
  update(editor: Editor): void;      // called on selection change
  hide(): void;
  dispose(): void;
}

// menus/blockActionMenu.ts
export class BlockActionMenu {
  constructor(container: HTMLElement, editor: Editor);
  show(blockPos: number, blockNode: any, anchorEl: HTMLElement): void;
  hide(): void;
  dispose(): void;
}
```

### Dependencies
- `@tiptap/core` (Editor)
- `canvasIcons.ts` (menu item icons)

#### Tasks

**Task 2.1 — Extract SlashMenu**
- **Source lines:** 1576–1805 (SLASH_MENU_ITEMS data) + 3539–3744 (CanvasEditorPane methods: `_createSlashMenu`, `_checkSlashTrigger`, `_showSlashMenu`, `_hideSlashMenu`, `_getFilteredItems`, `_renderSlashMenuItems`, `_executeSlashItem`)
- **Target:** `src/built-in/canvas/menus/slashMenu.ts`
- **Export:** `class SlashMenu` + `SLASH_MENU_ITEMS` (exported for potential testing)
- **Completion Criteria:**
  - All slash menu state (`_slashMenuVisible`, `_slashFilterText`, `_slashSelectedIndex`) moves into the class
  - Keyboard navigation (arrow keys, Enter, Escape) self-contained
  - `/` trigger detection self-contained
  - `CanvasEditorPane` creates `SlashMenu` instance in `init()`, calls `check()` on editor update
  - Build passes, slash menu works identically

**Task 2.2 — Extract BubbleMenu**
- **Source lines:** 3311–3537 (CanvasEditorPane methods: `_createBubbleMenu`, `_toggleLinkInput`, `_updateBubbleMenu`, `_refreshBubbleActiveStates`, `_hideBubbleMenu`)
- **Target:** `src/built-in/canvas/menus/bubbleMenu.ts`
- **Export:** `class BubbleMenu`
- **Completion Criteria:**
  - Bubble menu DOM creation, positioning, button state management self-contained
  - Link input toggle self-contained
  - `CanvasEditorPane` creates `BubbleMenu` instance, calls `update()` on selection change
  - Build passes, bubble menu works on text selection

**Task 2.3 — Extract BlockActionMenu**
- **Source lines:** 3973–4530 (CanvasEditorPane methods: `_createBlockActionMenu`, `_showBlockActionMenu`, `_hideBlockActionMenu`, `_createActionItem`, `_showTurnIntoSubmenu`, `_hideTurnIntoSubmenu`, `_showColorSubmenu`, `_hideColorSubmenu`, `_turnBlockInto`, `_turnBlockViaReplace`, `_extractBlockContent`, `_isCurrentBlockType`, `_getBlockLabel`, `_applyBlockTextColor`, `_applyBlockBgColor`, `_duplicateBlock`, `_deleteBlock`)
- **Target:** `src/built-in/canvas/menus/blockActionMenu.ts`
- **Export:** `class BlockActionMenu`
- **Completion Criteria:**
  - All block operations (turn into, duplicate, delete, color) self-contained
  - Turn-into and color submenus self-contained with hover delay timers
  - `CanvasEditorPane` creates `BlockActionMenu` instance, calls `show()`/`hide()` from handle click
  - Build passes, block action menu works identically

---

## Capability 3 — Block Handles Extraction

### Capability Description
Extract block handle setup (+ button, drag handle click, handle resolution, keyboard block movement) into its own module.

### Goals
- `_setupBlockHandles`, `_resolveBlockFromHandle`, `_resolveBlockFallback`, keyboard movement handlers → `handles/blockHandles.ts`
- `CanvasEditorPane` creates handle manager after editor init
- Build passes, drag handles and keyboard movement work

#### Tasks

**Task 3.1 — Extract BlockHandles**
- **Source lines:** 3745–3972
- **Target:** `src/built-in/canvas/handles/blockHandles.ts`
- **Export:** `class BlockHandles`
- **Completion Criteria:**
  - `+ button` click → insert paragraph or show slash menu
  - Drag handle click → show block action menu (delegates to `BlockActionMenu`)
  - `_resolveBlockFromHandle()` logic (including column-drill-through per Axiom 2) self-contained
  - `_resolveBlockFallback()` self-contained
  - Keyboard movement (Ctrl+Shift+↑/↓, Ctrl+D) self-contained
  - Build passes, all handle interactions work

---

## Capability 4 — Page Header, Ribbon & Pickers Extraction

### Capability Description
Extract the page chrome (top ribbon, page header with title/icon/cover, page menu, icon picker, cover picker) into the `header/` and `pickers/` directories.

### Goals
- Top ribbon (breadcrumbs, timestamp, favorite) → `header/topRibbon.ts`
- Page header (title, icon, hover affordances, cover) → `header/pageHeader.ts`
- Page menu (font, width, lock settings) → `header/pageMenu.ts`
- Icon picker → `pickers/iconPicker.ts`
- Cover picker → `pickers/coverPicker.ts`
- `CanvasEditorPane` creates these components and delegates page data updates to them

#### Tasks

**Task 4.1 — Extract TopRibbon**
- **Source lines:** 2165–2249
- **Target:** `src/built-in/canvas/header/topRibbon.ts`
- **Export:** `class TopRibbon`
- **Completion Criteria:**
  - Breadcrumbs, favorite button, edited timestamp self-contained
  - `refresh(page)` method updates display from page data
  - Build passes

**Task 4.2 — Extract PageHeader**
- **Source lines:** 2250–2614
- **Target:** `src/built-in/canvas/header/pageHeader.ts`
- **Export:** `class PageHeader`
- **Completion Criteria:**
  - Title (contenteditable), icon display, hover affordances, cover creation/display
  - Cover reposition (drag-to-reposition) self-contained
  - `refresh(page)` method updates all elements from page data
  - Build passes

**Task 4.3 — Extract PageMenu**
- **Source lines:** 2873–3088
- **Target:** `src/built-in/canvas/header/pageMenu.ts`
- **Export:** `class PageMenu`
- **Completion Criteria:**
  - Font family, full width, page lock settings UI
  - Applies settings to page via data service callback
  - Build passes

**Task 4.4 — Extract IconPicker**
- **Source lines:** 2783–2872
- **Target:** `src/built-in/canvas/pickers/iconPicker.ts`
- **Export:** `class IconPicker`
- **Completion Criteria:**
  - Emoji/icon grid selection popup
  - Fires selection callback, self-positions near anchor
  - Build passes

**Task 4.5 — Extract CoverPicker**
- **Source lines:** 2615–2782
- **Target:** `src/built-in/canvas/pickers/coverPicker.ts`
- **Export:** `class CoverPicker`
- **Completion Criteria:**
  - Gradient swatches, solid colors, image URL input
  - Remove cover action
  - Fires selection callback
  - Build passes

---

## Capability 5 — Inline Math Editor & Editor Config Extraction

### Capability Description
Extract the inline math click-to-edit popup and the TipTap extension configuration array into their own modules.

### Goals
- Inline math editor → `math/inlineMathEditor.ts`
- Extension array assembly → `config/editorExtensions.ts`

#### Tasks

**Task 5.1 — Extract InlineMathEditor**
- **Source lines:** 3175–3310
- **Target:** `src/built-in/canvas/math/inlineMathEditor.ts`
- **Export:** `class InlineMathEditor`
- **Completion Criteria:**
  - Popup DOM (textarea + preview + done button) self-contained
  - `show(pos, latex, anchorEl)` / `hide()` / `commit()` interface
  - Build passes, inline math click-to-edit works

**Task 5.2 — Extract EditorExtensions config**
- **Source lines:** 1923–2040 (the `extensions: [...]` array inside `new Editor({...})`)
- **Target:** `src/built-in/canvas/config/editorExtensions.ts`
- **Export:** `function createEditorExtensions(): Extension[]`
- **Completion Criteria:**
  - All extension imports (StarterKit, Placeholder, TaskList, etc.) move to this module
  - Placeholder configuration (per-node-type logic) stays with this module
  - `CanvasEditorPane` calls `createEditorExtensions()` when constructing the Editor
  - Build passes, all block types work

---

## Capability 6 — Orchestrator Cleanup & Verification

### Capability Description
Final cleanup of `canvasEditorProvider.ts`. Remove all extracted code, verify imports, run full test suite, measure final line count.

### Goals
- `canvasEditorProvider.ts` contains only: imports, `CanvasEditorProvider` class (~30 lines), `CanvasEditorPane` class with `init()`, `_loadContent()`, page change subscription, event wiring, `dispose()` (~370 lines)
- Total orchestrator: ~400 lines
- All 41 E2E tests pass
- All 67 unit tests pass
- Build passes with zero warnings

#### Tasks

**Task 6.1 — Remove dead code from orchestrator**
- **Completion Criteria:**
  - No extension definitions remain in `canvasEditorProvider.ts`
  - No plugin functions remain
  - No menu rendering code remains
  - No block operation methods remain
  - All functionality delegated to imported modules

**Task 6.2 — Full test suite verification**
- **Completion Criteria:**
  - `npm run build` — zero errors
  - 67 unit tests pass
  - 41 E2E column tests pass
  - Manual smoke test: create page, type content, use slash menu, create columns, drag blocks, use bubble menu, right-click block, resize columns, toggle list, math blocks

**Task 6.3 — Line count audit**
- **Completion Criteria:**
  - `canvasEditorProvider.ts` ≤ 500 lines
  - No module exceeds 500 lines
  - Total line count across all canvas modules approximately equals the original 4,530 (accounting for new import/export boilerplate)
  - Document final line counts in this section

---

## Execution Order

The capabilities must be executed in order because later extractions depend on earlier ones:

1. **Capability 0** (Extensions) — Extracts standalone TipTap Node/Extension definitions first because they have zero dependencies on the CanvasEditorPane class.
2. **Capability 1** (Plugins) — Extracts ProseMirror plugins, then wires them back into the column extension module from Capability 0.
3. **Capability 2** (Menus) — The largest extraction. Requires defining class interfaces for slash/bubble/block-action menus that communicate with the editor.
4. **Capability 3** (Block Handles) — Depends on Capability 2 because handles trigger the block action menu.
5. **Capability 4** (Page Header/Pickers) — Independent of menus but done later because it's cosmetic, not behavioral.
6. **Capability 5** (Math Editor + Config) — Small cleanup extractions.
7. **Capability 6** (Verification) — Final cleanup and full test suite run.

**Estimated scope:** ~18 new files, 0 new dependencies, 0 behavior changes, 0 new tests (existing tests validate the refactor).

---

## Excluded (Deferred)

- **UI framework adoption** (Lit, Preact, etc.) — Evaluated during M6 retrospective. Decision: decompose first, then reassess. If individual menu modules are still painful as vanilla DOM, framework can be scoped to `menus/` in a future milestone.
- **New canvas features** — No new block types, no new interactions, no new slash menu items. This milestone is refactor-only.
- **CSS decomposition** — `canvas.css` stays as a single file. It's already scoped and cohesive. Per-module CSS would complicate theming.
- **Unit tests for individual modules** — The existing 41 E2E tests and 67 unit tests validate behavior. Per-module unit tests are a nice-to-have for a future milestone.
- **canvasSidebar.ts decomposition** — Already a reasonable single module (~400 lines). Not in scope.
