# Block Registry — Architecture & Refactoring Plan

> **Branch:** `canvas-v2`  
> **Date:** 2026-02-20  
> **Status:** Pre-implementation — design document

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current Architecture](#2-current-architecture)
3. [Duplication & Fragmentation Audit](#3-duplication--fragmentation-audit)
4. [Proposed Block Registry](#4-proposed-block-registry)
5. [BlockDefinition Interface](#5-blockdefinition-interface)
6. [Relationship with Tiptap](#6-relationship-with-tiptap)
7. [Refactoring Steps](#7-refactoring-steps)
8. [Dependency Map — Who Depends on What](#8-dependency-map--who-depends-on-what)
9. [Migration Safety Checklist](#9-migration-safety-checklist)
10. [Open Questions](#10-open-questions)

---

## 1. Problem Statement

The canvas tool's block system works — every block type renders, inserts, transforms, and drags correctly. But its metadata is **scattered across 6+ files** with no single source of truth. Adding a new block type requires touching at minimum:

| What needs updating | File |
|---|---|
| Tiptap extension registration | `config/tiptapExtensions.ts` |
| Slash menu entry | `menus/slashMenuItems.ts` |
| Turn-into submenu entry | `handles/blockHandles.ts` (~L800) |
| Block label for action menu header | `handles/blockHandles.ts` `_getBlockLabel()` |
| Column-allowed list | `config/blockCapabilities.ts` `COLUMN_BLOCK_NODE_TYPES` |
| Drag-handle custom nodes | `config/blockCapabilities.ts` `DRAG_HANDLE_CUSTOM_NODE_TYPES` |
| Turn-into execution logic | `mutations/blockMutations.ts` `turnBlockWithSharedStrategy()` |
| PAGE_CONTAINERS set (if container) | 4 separate locations |
| Placeholder text (if applicable) | `config/tiptapExtensions.ts` Placeholder config |
| Bubble menu exclusion (if applicable) | `menus/bubbleMenu.ts` |

This leads to:
- **Forgotten registrations** when new blocks are added
- **Inconsistent capabilities** (e.g. a block appears in slash menu but not turn-into, or vice versa)
- **Duplicated constants** (PAGE_CONTAINERS defined 4 times independently)
- **Difficult onboarding** — no single file tells you "what block types exist and what they can do"

---

## 2. Current Architecture

### 2.1 Three Layers of Block Types

The canvas editor builds on Tiptap, which itself builds on ProseMirror. Block types come from three distinct layers:

#### Layer 1 — StarterKit Built-ins
Blocks inherited from `@tiptap/starter-kit`. These exist as ProseMirror node types the moment StarterKit is loaded. No custom extension file needed.

| Node Type | Notes |
|---|---|
| `paragraph` | Default text block |
| `heading` | Levels 1-3 (configured in tiptapExtensions.ts) |
| `bulletList` / `listItem` | Unordered lists |
| `orderedList` / `listItem` | Ordered lists |
| `blockquote` | Quote blocks |
| `horizontalRule` | Divider |
| `hardBreak` | Inline break |
| `link` | Inline (configured with `openOnClick: false`) |

> **Note:** `codeBlock` is disabled in StarterKit and replaced by `CodeBlockLowlight`.

#### Layer 2 — @tiptap Package Extensions
Third-party Tiptap extensions installed as npm packages. Each registers its own ProseMirror node/mark type.

| Extension | Node Type(s) | Package |
|---|---|---|
| `TaskList` / `TaskItem` | `taskList`, `taskItem` | `@tiptap/extension-task-list`, `@tiptap/extension-task-item` |
| `Image` | `image` | `@tiptap/extension-image` |
| `Details` | `details`, `detailsSummary`, `detailsContent` | `@tiptap/extension-details` |
| `TableKit` | `table`, `tableRow`, `tableCell`, `tableHeader` | `@tiptap/extension-table` |
| `CodeBlockLowlight` | `codeBlock` | `@tiptap/extension-code-block-lowlight` |
| `GlobalDragHandle` | _(no node)_ | `tiptap-extension-global-drag-handle` |
| `InlineMathNode` | `inlineMath` | `@aarkue/tiptap-math-extension` |
| `TextStyle` | _(mark)_ | `@tiptap/extension-text-style` |
| `Color` | _(mark)_ | `@tiptap/extension-color` |
| `Highlight` | _(mark)_ | `@tiptap/extension-highlight` |
| `CharacterCount` | _(plugin)_ | `@tiptap/extension-character-count` |
| `AutoJoiner` | _(plugin)_ | `tiptap-extension-auto-joiner` |
| `Placeholder` | _(plugin)_ | `@tiptap/extension-placeholder` |

#### Layer 3 — Custom Extensions (`extensions/` directory)
Parallx-authored Tiptap extensions defining custom ProseMirror node types.

| File | Node Type(s) | Purpose |
|---|---|---|
| `calloutNode.ts` | `callout` | Info/warning/tip callout box |
| `columnNodes.ts` | `column`, `columnList` | Multi-column layout |
| `mathBlockNode.ts` | `mathBlock` | Block-level KaTeX equation |
| `toggleHeadingNode.ts` | `toggleHeading`, `toggleHeadingText` | Collapsible heading |
| `bookmarkNode.ts` | `bookmark` | URL preview card |
| `pageBlockNode.ts` | `pageBlock` | Reference to a child page |
| `tableOfContentsNode.ts` | `tableOfContents` | Auto-generated heading list |
| `mediaNodes.ts` | `video`, `audio`, `fileAttachment` | Embedded media |
| `blockBackground.ts` | _(node attribute)_ | `backgroundColor` attribute on block nodes |
| `blockKeyboardShortcuts.ts` | _(keybindings)_ | Block-level keyboard shortcuts |
| `detailsEnterHandler.ts` | _(keybinding)_ | Enter behavior inside details |
| `structuralInvariantGuard.ts` | _(plugin)_ | Structural repair after mutations |

### 2.2 Directory Layout (current)

```
src/built-in/canvas/
├── config/
│   ├── blockCapabilities.ts      ← COLUMN_BLOCK_NODE_TYPES, DRAG_HANDLE_CUSTOM_NODE_TYPES
│   └── tiptapExtensions.ts       ← Tiptap extension assembly + Placeholder config
├── extensions/                   ← Custom Tiptap node definitions
│   ├── calloutNode.ts
│   ├── columnNodes.ts
│   ├── mathBlockNode.ts
│   ├── toggleHeadingNode.ts
│   ├── bookmarkNode.ts
│   ├── pageBlockNode.ts
│   ├── tableOfContentsNode.ts
│   ├── mediaNodes.ts
│   ├── blockBackground.ts
│   ├── blockKeyboardShortcuts.ts
│   ├── detailsEnterHandler.ts
│   └── structuralInvariantGuard.ts
├── handles/
│   ├── blockHandles.ts           ← + button, drag-handle click, action menu, turn-into, color
│   └── blockSelection.ts         ← Position-based multi-block selection
├── menus/
│   ├── slashMenuItems.ts         ← 26 slash command definitions
│   └── bubbleMenu.ts             ← Floating format toolbar
├── mutations/
│   └── blockMutations.ts         ← Turn-into dispatcher, move, duplicate, delete, color
├── plugins/
│   └── columnDropPlugin.ts       ← Drop-target resolution for column DnD
└── ...
```

---

## 3. Duplication & Fragmentation Audit

### 3.1 PAGE_CONTAINERS — Defined 4 Times

The set `{ 'column', 'callout', 'detailsContent', 'blockquote' }` identifies which ProseMirror nodes are "page-like containers" (vertical block hosts). It is **independently defined** in:

| Location | Variable Name | Line |
|---|---|---|
| `mutations/blockMutations.ts` | `PAGE_SURFACE_NODES` | L14 |
| `handles/blockHandles.ts` | `BlockHandlesController._PAGE_CONTAINERS` | L385 |
| `handles/blockSelection.ts` | `PAGE_CONTAINERS` | L15 |
| `plugins/columnDropPlugin.ts` | `PAGE_CONTAINERS` | L125 |

If a new container type is added, all four must be updated.

### 3.2 Block Type Strings — Hardcoded Everywhere

Block type names (strings like `'paragraph'`, `'heading'`, `'callout'`, etc.) appear as raw string literals in:

- **`blockCapabilities.ts`** — 20 types in `COLUMN_BLOCK_NODE_TYPES`, 12 in `DRAG_HANDLE_CUSTOM_NODE_TYPES`
- **`slashMenuItems.ts`** — 26 slash items referencing ~20 node types
- **`blockHandles.ts`** — Turn-into submenu (15 items), `_getBlockLabel()` (16 entries), `_isContainerBlockType()` (4 types)
- **`blockMutations.ts`** — `turnBlockWithSharedStrategy()` switch (7 simple targets), `turnBlockViaReplace()`, `buildLeafBlock()` (7 types), `buildContainerBlock()` (4 types)
- **`tiptapExtensions.ts`** — Placeholder config (9 node type name checks)
- **`bubbleMenu.ts`** — Suppresses toolbar inside `codeBlock`

### 3.3 Turn-Into Logic — Three Separate Data Structures

1. **Turn-into submenu items** — 15 hardcoded entries in `blockHandles.ts` `_showTurnIntoSubmenu()`
2. **Turn-into execution** — `turnBlockWithSharedStrategy()` in `blockMutations.ts` with switch-based dispatch
3. **Slash menu items** — 26 entries in `slashMenuItems.ts` that insert blocks from scratch

These three are partially overlapping but independently maintained. The slash menu can insert block types that don't appear in turn-into (e.g. `image`, `bookmark`, `video`, `audio`, `fileAttachment`, `tableOfContents`), and the turn-into menu includes `columnList` variants that aren't in the slash menu's turn-into logic.

### 3.4 Block Labels — One Hardcoded Map

`_getBlockLabel()` in `blockHandles.ts` (L1012) is a 16-entry `Record<string, string>` mapping node type names to display labels. This is the only place labels are defined for the action menu header. The slash menu has its own `label` field per item. These are separate and could drift.

---

## 4. Proposed Block Registry

### 4.1 Core Idea

Create a **single file** — `config/blockRegistry.ts` — that serves as the canonical source of truth for every block type's metadata. All consumers read from the registry instead of maintaining their own hardcoded lists.

### 4.2 What the Registry Owns

| Concern | Currently Owned By | Registry Takes Over |
|---|---|---|
| Block identity (type name) | Tiptap extension files | **No** — Tiptap still owns ProseMirror node registration |
| Display label | `_getBlockLabel()` in blockHandles.ts | **Yes** |
| Icon key | Slash menu items, turn-into items | **Yes** |
| Slash menu entry | `slashMenuItems.ts` hardcoded array | **Yes** — declarative config consumed by slash menu builder |
| Turn-into availability | `blockHandles.ts` hardcoded items array | **Yes** — `turnInto` flag/config per block |
| Turn-into execution | `blockMutations.ts` switch statements | **Partially** — simple transforms become data-driven; complex ones keep custom logic via `turnIntoAction` callback |
| Column-allowed list | `blockCapabilities.ts` `COLUMN_BLOCK_NODE_TYPES` | **Yes** — `capabilities.allowInColumn` flag |
| Drag-handle custom nodes | `blockCapabilities.ts` `DRAG_HANDLE_CUSTOM_NODE_TYPES` | **Yes** — `capabilities.customDragHandle` flag |
| PAGE_CONTAINERS | 4 separate locations | **Yes** — `capabilities.isPageContainer` flag |
| Container classification | `_isContainerBlockType()`, `containerTypes Set` | **Yes** — `kind: 'container' | 'leaf' | 'atom'` |
| Placeholder text | `tiptapExtensions.ts` Placeholder config | **Yes** — `placeholder` field |
| Bubble menu suppression | `bubbleMenu.ts` | **Yes** — `capabilities.suppressBubbleMenu` flag |

### 4.3 What the Registry Does NOT Own

- **ProseMirror schema** — Tiptap extensions still define `Node.create({ name, schema, ... })`. The registry is metadata *about* those nodes, not a replacement for them.
- **Tiptap extension configuration** — `tiptapExtensions.ts` still assembles the Extensions array. The registry doesn't instantiate extensions.
- **DOM rendering** — NodeViews, CSS, and rendering logic stay in their extension files.
- **Complex insertion logic** — Slash menu actions that involve async operations (e.g. `Page` creating a child page) keep their custom action functions. The registry provides a hook point, not a replacement.

---

## 5. BlockDefinition Interface

```typescript
export interface BlockDefinition {
  /** ProseMirror node type name — must match the Tiptap extension's `name`. */
  readonly name: string;

  /** Human-readable label (e.g. 'Bulleted list', 'Heading 1'). */
  readonly label: string;

  /** Icon key consumed by `svgIcon()` or a text glyph (e.g. 'H₁'). */
  readonly icon: string;
  readonly iconIsText?: boolean;

  /** Origin of the node type definition. */
  readonly source: 'starterkit' | 'tiptap-package' | 'custom';

  /** Structural classification. */
  readonly kind: 'leaf' | 'container' | 'atom' | 'inline' | 'structural';

  /** Capabilities — gates which subsystems interact with this block. */
  readonly capabilities: {
    /** Can this block live inside a column? (COLUMN_BLOCK_NODE_TYPES) */
    readonly allowInColumn: boolean;
    /** Does this block need explicit drag-handle registration? */
    readonly customDragHandle: boolean;
    /** Is this node a page-container (column, callout, detailsContent, blockquote)? */
    readonly isPageContainer: boolean;
    /** Should the bubble format toolbar be suppressed when cursor is inside? */
    readonly suppressBubbleMenu: boolean;
    /** Can this block have a background color applied? */
    readonly allowBackgroundColor: boolean;
    /** Can this block have text color applied? */
    readonly allowTextColor: boolean;
  };

  /** Slash menu configuration. Omit to exclude from slash menu. */
  readonly slashMenu?: {
    readonly description: string;
    /** Sort order within the slash menu (lower = higher in list). */
    readonly order: number;
    /** Category for grouping in slash menu UI. */
    readonly category: 'basic' | 'list' | 'rich' | 'media' | 'layout' | 'math' | 'advanced';
    /**
     * Custom insertion action. If omitted, uses default `insertContentAt`
     * with the block's `defaultContent` template.
     */
    readonly action?: (editor: any, range: { from: number; to: number }, context?: any) => void | Promise<void>;
  };

  /** Turn-into configuration. Omit to exclude from turn-into menu. */
  readonly turnInto?: {
    /** Menu sort order. */
    readonly order: number;
    /** Keyboard shortcut hint displayed in the submenu. */
    readonly shortcut?: string;
    /** Default attrs when turning into this block. */
    readonly attrs?: Record<string, any>;
    /**
     * Custom turn-into logic. If omitted, uses `turnBlockWithSharedStrategy`
     * with automatic dispatch based on `kind`.
     */
    readonly action?: (editor: any, pos: number, node: any) => void;
  };

  /** Default JSON content template for insertion (used by slash menu default action). */
  readonly defaultContent?: Record<string, any>;

  /** Placeholder text when the block is empty. */
  readonly placeholder?: string | ((context: { node: any; pos: number; editor: any; hasAnchor: boolean }) => string);
}
```

### 5.1 Registry API

```typescript
/** All registered block definitions, keyed by ProseMirror node type name. */
export const BLOCK_REGISTRY: ReadonlyMap<string, BlockDefinition>;

/** Convenience: ordered array of blocks that appear in the slash menu. */
export function getSlashMenuBlocks(): BlockDefinition[];

/** Convenience: ordered array of blocks that appear in the turn-into submenu. */
export function getTurnIntoBlocks(): BlockDefinition[];

/** The canonical set of page-container node type names. */
export const PAGE_CONTAINERS: ReadonlySet<string>;

/** Node types allowed inside columns. */
export const COLUMN_BLOCK_NODE_TYPES: readonly string[];

/** Node types that need custom drag-handle registration. */
export const DRAG_HANDLE_CUSTOM_NODE_TYPES: readonly string[];
```

The existing constant names (`COLUMN_BLOCK_NODE_TYPES`, `DRAG_HANDLE_CUSTOM_NODE_TYPES`) are preserved as **derived exports** from the registry, so existing imports don't break during migration.

---

## 6. Relationship with Tiptap

### 6.1 No Conflict

The block registry sits **above** Tiptap as a metadata layer. It does not:
- Replace Tiptap's `Node.create()` or `Extension.create()`
- Modify the ProseMirror schema
- Interfere with Tiptap's command chain API
- Touch NodeViews, input rules, or paste rules

Tiptap doesn't know or care that a registry exists. The registry is consumed by **our** code: menus, handles, mutations, plugins.

### 6.2 Extension Files Stay Where They Are

Files in `extensions/` (e.g. `calloutNode.ts`, `columnNodes.ts`) continue to define ProseMirror node types and NodeViews. They don't import from the registry. The registry imports nothing from them — it's a flat data file.

### 6.3 `tiptapExtensions.ts` Still Assembles the Extensions Array

The `createEditorExtensions()` factory continues to import and configure all Tiptap extensions. The only change is that it reads `DRAG_HANDLE_CUSTOM_NODE_TYPES` from the registry export (same name, same shape) instead of from `blockCapabilities.ts`.

---

## 7. Refactoring Steps

> **Status: ✅ Phases 0–9 COMPLETE** (9 commits on `canvas-v2`).
>
> | Phase | Commit | Summary |
> |-------|--------|---------|
> | 0 | `1bc3113` | Baseline — 143 tests, clean `canvas-v2` branch |
> | 1 | `7472a44` | Created `blockRegistry.ts` + 18 parity tests |
> | 2 | `a03fd7b` | `blockCapabilities.ts` → thin re-export shim |
> | 3 | `6a5d5fb` | Single `PAGE_CONTAINERS` (eliminated 4× duplication) |
> | 4 | `2255399` | Block labels from registry (`getBlockLabel`) |
> | 5 | `d8ee883` | Turn-into submenu from registry (`getTurnIntoBlocks`) |
> | 6 | `16df452` | Slash menu items from registry (`getSlashMenuBlocks`) |
> | 7 | `1da60cd` | Placeholder text from registry (`getNodePlaceholder`) |
> | 8 | `714fad4` | Bubble menu suppression from registry |
> | 9 | _pending_ | Cleanup — removed duplicate `isContainerBlockType` in blockHandles/blockMutations |
>
> **Final test count:** 168 tests across 12 files, all passing.
>
> **Remaining hardcoded strings:** ~120 block-type name references remain in
> `blockMutations.ts` (turn-into switch), `markdownExport.ts` (render switch),
> `canvasStructuralInvariants.ts` (validators), and column plugins. These are
> execution-specific per-type dispatch logic that can't be reduced to simple
> registry lookups. Future work may introduce per-block `turnIntoAction`,
> `markdownRenderer`, and `childPlaceholder` callbacks.

### Phase 0 — Preparation

#### Step 0.1: Snapshot Test Baseline
- [ ] Run all existing unit tests (`npx vitest run`) and E2E tests
- [ ] Record baseline pass/fail counts
- [ ] Commit any fixes needed to get a green baseline

**Why:** We need a known-good state to diff against after each phase.

#### Step 0.2: Verify Branch State
- [ ] Confirm we're on `canvas-v2` branch
- [ ] Confirm HEAD matches `master` (clean fork point)

---

### Phase 1 — Create the Registry (additive, no consumers changed)

#### Step 1.1: Create `config/blockRegistry.ts`
- [ ] Define the `BlockDefinition` interface
- [ ] Define the `BLOCK_REGISTRY` Map
- [ ] Register every block type with its complete metadata:
  - StarterKit blocks: `paragraph`, `heading` (×3 levels), `bulletList`, `orderedList`, `blockquote`, `horizontalRule`
  - Tiptap package blocks: `taskList`, `image`, `codeBlock`, `details`, `table`, `inlineMath`
  - Custom blocks: `callout`, `columnList`, `mathBlock`, `toggleHeading` (×3 levels), `bookmark`, `pageBlock`, `tableOfContents`, `video`, `audio`, `fileAttachment`
- [ ] Export derived constants: `PAGE_CONTAINERS`, `COLUMN_BLOCK_NODE_TYPES`, `DRAG_HANDLE_CUSTOM_NODE_TYPES`
- [ ] Export helper functions: `getSlashMenuBlocks()`, `getTurnIntoBlocks()`, `getBlockLabel()`

#### Step 1.2: Add Unit Tests for the Registry
- [ ] Test that `BLOCK_REGISTRY` contains all expected block type names
- [ ] Test that derived constants match current hardcoded values exactly
- [ ] Test that `getSlashMenuBlocks()` returns items sorted by order
- [ ] Test that `getTurnIntoBlocks()` returns items sorted by order
- [ ] Test that `PAGE_CONTAINERS` equals `{ 'column', 'callout', 'detailsContent', 'blockquote' }`

#### Step 1.3: Run Tests — Confirm No Regressions
- [ ] `npx vitest run` — all tests pass
- [ ] The registry is purely additive at this point; nothing imports from it yet

**✅ Commit: "feat(canvas): add block registry — single source of truth for block metadata"**

---

### Phase 2 — Migrate `blockCapabilities.ts` Consumers

#### Step 2.1: Update `blockCapabilities.ts` to Re-export from Registry
- [ ] Change `COLUMN_BLOCK_NODE_TYPES` to re-export from `blockRegistry.ts`
- [ ] Change `DRAG_HANDLE_CUSTOM_NODE_TYPES` to re-export from `blockRegistry.ts`
- [ ] Change `COLUMN_CONTENT_NODE_TYPES` and `COLUMN_CONTENT_EXPRESSION` to derive from registry
- [ ] Keep `blockCapabilities.ts` as a thin re-export module (no breaking import changes)

**Dependency check:** Files importing from `blockCapabilities.ts`:
- `config/tiptapExtensions.ts` → imports `DRAG_HANDLE_CUSTOM_NODE_TYPES` (no change needed)
- `extensions/columnNodes.ts` → imports `COLUMN_CONTENT_EXPRESSION` (no change needed)
- Any other files importing these constants continue to work via re-export

#### Step 2.2: Run Tests
- [ ] `npx vitest run` — confirm pass counts unchanged

**✅ Commit: "refactor(canvas): blockCapabilities re-exports from block registry"**

---

### Phase 3 — Migrate PAGE_CONTAINERS (eliminate 4× duplication)

#### Step 3.1: Export `PAGE_CONTAINERS` from the Registry
- [ ] Already done in Step 1.1 — verify the export exists

#### Step 3.2: Replace in `mutations/blockMutations.ts`
- [ ] Remove local `PAGE_SURFACE_NODES` set (L14-16)
- [ ] Import `PAGE_CONTAINERS` from `../config/blockRegistry.js`
- [ ] Replace all references from `PAGE_SURFACE_NODES` → `PAGE_CONTAINERS`

**Dependency check:** `blockMutations.ts` is imported by:
- `handles/blockHandles.ts` — imports mutation functions, not constants. ✅ No impact.
- `menus/slashMenuItems.ts` — does not import from blockMutations. ✅ No impact.

#### Step 3.3: Replace in `handles/blockHandles.ts`
- [ ] Remove `private static readonly _PAGE_CONTAINERS` set (L385-387)
- [ ] Import `PAGE_CONTAINERS` from `../config/blockRegistry.js`
- [ ] Replace `BlockHandlesController._PAGE_CONTAINERS` → `PAGE_CONTAINERS`

#### Step 3.4: Replace in `handles/blockSelection.ts`
- [ ] Remove local `PAGE_CONTAINERS` set (L15-17)
- [ ] Import `PAGE_CONTAINERS` from `../config/blockRegistry.js`

#### Step 3.5: Replace in `plugins/columnDropPlugin.ts`
- [ ] Remove local `PAGE_CONTAINERS` set (L125-127)
- [ ] Import `PAGE_CONTAINERS` from `../config/blockRegistry.js`

#### Step 3.6: Run Tests
- [ ] `npx vitest run` — confirm pass counts unchanged
- [ ] Grep the codebase for any remaining local PAGE_CONTAINERS definitions

**✅ Commit: "refactor(canvas): single PAGE_CONTAINERS definition via block registry"**

---

### Phase 4 — Migrate Block Labels

#### Step 4.1: Create `getBlockLabel()` utility in the Registry
- [ ] Already done in Step 1.1 — verify function reads from `BLOCK_REGISTRY`

#### Step 4.2: Replace `_getBlockLabel()` in `blockHandles.ts`
- [ ] Remove the private `_getBlockLabel()` method (L1012-1024)
- [ ] Import `getBlockLabel` from `../config/blockRegistry.js`
- [ ] Replace call site in `_showBlockActionMenu()` (L688)

#### Step 4.3: Run Tests
- [ ] `npx vitest run`

**✅ Commit: "refactor(canvas): block labels from registry"**

---

### Phase 5 — Migrate Turn-Into Submenu

#### Step 5.1: Replace Hardcoded Items in `_showTurnIntoSubmenu()`
- [ ] In `blockHandles.ts`, replace the 15-item `items` array with a call to `getTurnIntoBlocks()`
- [ ] Map `BlockDefinition` fields to the existing DOM builder pattern
- [ ] Preserve icon rendering (text vs SVG), shortcut display, and check-mark logic

**Dependency check:** `_showTurnIntoSubmenu()` calls `_turnBlockInto()` which calls `turnBlockWithSharedStrategy()`. The turn-into execution path is unchanged — only the menu data source changes.

#### Step 5.2: Run Tests + Manual Verification
- [ ] `npx vitest run`
- [ ] Launch app, open canvas, click drag handle → Turn into → verify all 15 items present with correct icons

**✅ Commit: "refactor(canvas): turn-into submenu reads from block registry"**

---

### Phase 6 — Migrate Slash Menu

#### Step 6.1: Refactor `slashMenuItems.ts` to Use Registry
- [ ] For simple blocks (heading, lists, quote, code, divider, etc.), generate the `SlashMenuItem.action` from `BlockDefinition.defaultContent`
- [ ] For complex blocks (Page, Image, Video, Audio, File, Bookmark), keep custom action functions but reference them via `slashMenu.action` in the registry definition
- [ ] Build the final `SLASH_MENU_ITEMS` array by mapping `getSlashMenuBlocks()`

**Dependency check:** `slashMenuItems.ts` is imported by:
- `menus/slashMenu.ts` (or equivalent) — imports `SLASH_MENU_ITEMS`. The export name and shape are preserved. ✅

#### Step 6.2: Run Tests + Manual Verification
- [ ] `npx vitest run`
- [ ] Launch app, type `/` in a canvas block → verify all 26 items present, insertion works

**✅ Commit: "refactor(canvas): slash menu driven by block registry"**

---

### Phase 7 — Migrate Placeholder Configuration

#### Step 7.1: Generate Placeholder Config from Registry
- [ ] In `tiptapExtensions.ts`, replace the Placeholder `placeholder` callback with a function that reads `BlockDefinition.placeholder` from the registry
- [ ] For blocks without a `placeholder` field, fall back to the existing depth-walk logic

#### Step 7.2: Run Tests
- [ ] `npx vitest run`
- [ ] Launch app, verify placeholder text appears correctly in empty paragraphs, headings, callouts, toggles, etc.

**✅ Commit: "refactor(canvas): placeholder text from block registry"**

---

### Phase 8 — Migrate Bubble Menu Suppression

#### Step 8.1: Replace `codeBlock` Hardcode in `bubbleMenu.ts`
- [ ] Import registry, check `capabilities.suppressBubbleMenu` instead of `node.type.name === 'codeBlock'`

#### Step 8.2: Run Tests
- [ ] `npx vitest run`

**✅ Commit: "refactor(canvas): bubble menu suppression from block registry"**

---

### Phase 9 — Migrate Turn-Into Execution Logic (Optional — Higher Risk)

This phase makes `turnBlockWithSharedStrategy()` partially data-driven. It's the riskiest phase because turn-into logic has complex edge cases (container↔container, content preservation, cursor placement).

#### Step 9.1: Add `turnInto.action` Callbacks to Registry Definitions
- [ ] For simple transforms (paragraph↔heading↔lists↔blockquote↔codeBlock), use the existing Tiptap chain commands
- [ ] For container transforms (callout↔details↔toggleHeading↔blockquote), keep the existing `swapContainer` / `buildContainerBlock` logic as named action callbacks
- [ ] For column transforms, keep `turnBlockIntoColumns` as a named action

#### Step 9.2: Refactor `turnBlockWithSharedStrategy()` to Dispatch via Registry
- [ ] Look up `targetType` in registry
- [ ] If the definition has `turnInto.action`, call it
- [ ] If not, fall back to the existing switch-case logic (safety net)

#### Step 9.3: Run Full Test Suite
- [ ] `npx vitest run`
- [ ] E2E tests for block transformation
- [ ] Manual testing of every turn-into combination

**✅ Commit: "refactor(canvas): turn-into execution via block registry dispatch"**

---

### Phase 10 — Cleanup

#### Step 10.1: Remove Dead Code
- [ ] Remove `blockCapabilities.ts` if fully superseded (or keep as thin re-export if import paths are widespread)
- [ ] Remove any unused local constants, `Set` definitions, or helper functions that have been replaced by registry queries
- [ ] Search for any remaining hardcoded block type string literals that should reference the registry

#### Step 10.2: Update Codebase Documentation
- [ ] Add JSDoc to `blockRegistry.ts` explaining how to add a new block type
- [ ] Update this document with final status

#### Step 10.3: Final Test Run
- [ ] `npx vitest run` — full pass
- [ ] E2E tests — full pass
- [ ] Manual smoke test of all block operations

**✅ Commit: "chore(canvas): block registry cleanup and documentation"**

---

## 8. Dependency Map — Who Depends on What

This map shows what each file currently imports and from where, so we know what breaks if we change an export.

### `config/blockCapabilities.ts` (current exports)
```
COLUMN_BLOCK_NODE_TYPES ──────►  extensions/columnNodes.ts (COLUMN_CONTENT_EXPRESSION)
COLUMN_CONTENT_EXPRESSION ────►  extensions/columnNodes.ts (column schema content field)
COLUMN_CONTENT_NODE_TYPES ────►  (not imported externally)
DRAG_HANDLE_CUSTOM_NODE_TYPES ►  config/tiptapExtensions.ts (GlobalDragHandle config)
```

### `mutations/blockMutations.ts` (current exports)
```
turnBlockWithSharedStrategy ──►  handles/blockHandles.ts (_turnBlockInto)
duplicateBlockAt ─────────────►  handles/blockHandles.ts (_duplicateBlock)
deleteBlockAt ────────────────►  handles/blockHandles.ts (_deleteBlock)
applyTextColorToBlock ────────►  handles/blockHandles.ts (_applyBlockTextColor)
applyBackgroundColorToBlock ──►  handles/blockHandles.ts (_applyBlockBgColor)
moveBlockUpWithinPageFlow ────►  extensions/blockKeyboardShortcuts.ts
moveBlockDownWithinPageFlow ──►  extensions/blockKeyboardShortcuts.ts
moveBlockAcrossColumnBoundary ►  extensions/blockKeyboardShortcuts.ts
normalizeColumnListAfterMutation ► plugins/columnDropPlugin.ts
isColumnEffectivelyEmpty ─────►  plugins/columnDropPlugin.ts
deleteDraggedSourceFromTransaction ► plugins/columnDropPlugin.ts
resetColumnListWidthsInTransaction ► plugins/columnDropPlugin.ts
turnBlockIntoColumns ─────────►  (not imported externally — internal to module)
```

### `menus/slashMenuItems.ts` (current exports)
```
SLASH_MENU_ITEMS ─────────────►  menus/slashMenu.ts (or main canvas module)
SlashMenuItem (type) ─────────►  menus/slashMenu.ts
SlashActionContext (type) ────►  menus/slashMenu.ts
```

### `handles/blockHandles.ts` (current exports)
```
BlockHandlesController ───────►  canvasEditorProvider.ts
BlockHandlesHost (type) ──────►  canvasEditorProvider.ts
```

### `handles/blockSelection.ts` (current exports)
```
BlockSelectionController ─────►  canvasEditorProvider.ts
                              ►  handles/blockHandles.ts (BlockHandlesHost.blockSelection)
BlockSelectionHost (type) ────►  canvasEditorProvider.ts
```

---

## 9. Migration Safety Checklist

For each phase, verify:

- [ ] **No broken imports.** Run `npx tsc --noEmit` (or the esbuild equivalent) to check.
- [ ] **Unit tests pass.** `npx vitest run` with same pass count as baseline.
- [ ] **No new `any` types.** Registry types should be fully typed.
- [ ] **Derived constants match originals.** Write an assertion test that compares registry-derived arrays against the original hardcoded arrays, then remove the assertion once migration is complete.
- [ ] **Slash menu item count unchanged.** `getSlashMenuBlocks().length === 26`.
- [ ] **Turn-into item count unchanged.** `getTurnIntoBlocks().length === 15`.
- [ ] **PAGE_CONTAINERS membership unchanged.** Set equality check.
- [ ] **No behavioral changes.** Every block type inserts, transforms, drags, selects, and deletes exactly as before.

---

## 10. Open Questions

1. **Should `blockCapabilities.ts` be deprecated or kept as a re-export shim?**  
   Keeping it as a re-export avoids touching import paths in `columnNodes.ts` and `tiptapExtensions.ts`. Deleting it is cleaner but requires updating those imports.

2. **Should heading levels 1/2/3 be separate registry entries or one entry with `attrs.level`?**  
   Separate entries are simpler for slash menu and turn-into (each level has its own display label and icon). One entry is more DRY. Recommendation: **separate entries** — the registry is metadata, not schema.

3. **Should Phase 9 (turn-into execution) be done now or deferred?**  
   It's the highest-risk phase and the existing switch-case logic works. Could be deferred to a follow-up branch while the metadata-only registry ships first.

4. **Should the registry define color palettes?**  
   The text color and background color arrays in `blockHandles.ts` are hardcoded (10+10 colors). These could move to a separate `colorPalette.ts` config or into the registry as a global config. Not block-specific — probably separate.

5. **Should the registry be runtime-extensible (for future plugin blocks)?**  
   For now, no — it's a compile-time constant `Map`. If Parallx later supports user-authored block extensions, the registry would need a `registerBlock()` API. Cross that bridge when we get there.
