# Canvas Structural Model — "Everything is a Page"

> **Authority:** This document defines the structural model for the Parallx Canvas editor.
> It supersedes the column-centric framing in `BLOCK_INTERACTION_RULES.md` and establishes
> the recursive container abstraction that governs every block-editing interaction.
> All implementation must conform to this model. Read this before `BLOCK_INTERACTION_RULES.md`.

---

## 1. The Core Insight

A **Page** is not a special top-level concept. It is the universal unit of vertical content in Parallx.

Every surface that holds blocks — the top-level document, a column, a toggle's body, a callout's body, a quote block — is structurally identical: **a vertical container of blocks**. The only differences between these surfaces are their _chrome_ (title bar, icon, collapse control, emoji badge, border style) and their _constraints_ (width, nesting rules, collapse state).

This is the "Everything is a Page" principle:

> **A Column is a Page with a width constraint.**
> **A Toggle is a Page with a summary line and collapse control.**
> **A Callout is a Page with an emoji badge and background color.**
> **A Quote is a Page with a left border.**
> **A top-level Page is a Page with a title, icon, and cover.**

Once you see this, the entire interaction model simplifies to a single question:
_"How do blocks behave inside a Page?"_ — answer that once, and it applies everywhere.

---

## 2. Structural Primitives

The canvas editor has exactly **three** structural primitives:

### 2.1 Block (leaf)

A Block is an atomic unit of content. It cannot contain other blocks. It occupies one "row" in its parent Page.

Examples: paragraph, heading, bullet item, numbered item, to-do item, code block, image, divider, block equation, embed, table.

**Properties:**
- Has a drag handle (⋮⋮)
- Has an action menu (Turn into, Color, Duplicate, Delete)
- Can be dragged to any drop zone
- Can be selected (Esc key, click handle)
- Identity and capabilities are **invariant** — a paragraph inside a column is identical to a paragraph at top level

### 2.2 Page (container)

A Page is a **vertical sequence of blocks**. It is the universal container. Every surface that holds content is a Page.

**Properties:**
- Contains 1..N blocks (or other containers) in vertical sequence
- Blocks flow top-to-bottom
- Blocks can be reordered within a Page via drag or keyboard
- Blocks can be moved in or out of a Page via drag
- Supports the full interaction model (drag, drop, action menu, keyboard nav)

**Variants** (same structural behavior, different chrome):

| Variant | Chrome | Width | Collapse | Nesting |
|---------|--------|-------|----------|---------|
| **Top-level page** | Title + icon + cover | Full viewport | No | Root — not nested |
| **Column** | None | Constrained by partition | No | Inside HorizontalPartition only |
| **Toggle** | Summary line + ▶ control | Inherited from parent | Yes | Any depth |
| **Callout** | Emoji badge + background | Inherited from parent | No | Any depth |
| **Quote** | Left border | Inherited from parent | No | Any depth |
| **Synced block** | ↻ indicator | Inherited from parent | No | Any depth |

### 2.3 HorizontalPartition

A HorizontalPartition takes a single "row" in a Page and divides it into 2+ side-by-side Page-containers (columns). It is the **only layout operation** in the system.

**Properties:**
- Contains 2..N columns (each column is a Page)
- Columns sit side by side, each with a width proportion (summing to 100%)
- Columns can be resized by dragging the boundary between them
- Has **no user-facing identity** — no handle, no action menu, no selection
- Created organically (slash menu "N Columns" or drag-to-side)
- Destroyed organically (when ≤1 column remains after a block operation)

**In TipTap/ProseMirror terms:**
- `columnList` node = HorizontalPartition
- `column` node = Page (column variant)
- `columnList` content: `column column+` (2+ columns)
- `column` content: `block+` (1+ blocks)

---

## 3. The Recursive Container Model

The key architectural decision is that **all Page-variants share one interaction model**. We define block behavior once, and it applies recursively at every level of nesting.

### 3.1 Interaction Model (defined once, applied everywhere)

Inside any Page (regardless of variant), blocks behave identically:

1. **Vertical flow** — blocks stack top-to-bottom
2. **Drag handle** — every block has a ⋮⋮ handle; containers' handles resolve to the container, not internal blocks
3. **Action menu** — same menu everywhere (Turn into, Color, Duplicate, Delete)
4. **Drop zones** — horizontal guides (above/below) and vertical guides (left/right edge for column creation)
5. **Keyboard movement** — Ctrl+Shift+↑/↓ moves blocks within the Page; at boundary, moves to adjacent container
6. **Empty block deletion** — Backspace in empty block removes it; if this empties a column, auto-dissolve fires

### 3.2 Container Blocks vs Leaf Blocks

Some blocks are containers — they are Pages-with-chrome. When you interact with them from the _outside_ (drag handle, action menu), they behave as a single block. When you interact _inside_ them, you enter a nested Page context where the full interaction model applies.

| Block type | Leaf or Container? | Inner Page variant |
|-----------|-------------------|-------------------|
| Paragraph | Leaf | — |
| Heading (H1-H3) | Leaf | — |
| Bullet list item | Leaf* | — |
| Numbered list item | Leaf* | — |
| To-do list item | Leaf* | — |
| Toggle list | **Container** | Toggle (summary + collapsible body) |
| Code block | Leaf | — |
| Quote | **Container** | Quote (left-bordered Page) |
| Callout | **Container** | Callout (emoji + colored Page) |
| Image | Leaf | — |
| Divider | Leaf | — |
| Block equation | Leaf | — |
| Table | Leaf** | — |
| Embed | Leaf | — |
| Synced block | **Container** | Synced (referenced Page) |
| HorizontalPartition | **Container*** | N/A (invisible, holds columns) |

\* List items can be indented (nested), creating a tree. But each item is a leaf — indentation is list-level nesting, not Page-level nesting.

\** Tables have cells, but cells follow table-editing rules (not the Page interaction model). Tables are treated as leaf blocks from the Page perspective.

\*** HorizontalPartition is a special container — it holds side-by-side Pages, not a vertical sequence. It has no user-facing identity. It is the sole exception to the vertical-flow rule.

### 3.3 The Hierarchy

```
Top-level Page
├── Block (paragraph)
├── Block (heading)
├── Container: Toggle
│   ├── [summary line — not a block, part of chrome]
│   └── Inner Page (toggle body)
│       ├── Block (paragraph)
│       └── Block (paragraph)
├── HorizontalPartition (columnList)
│   ├── Column (Page variant)
│   │   ├── Block (paragraph)
│   │   └── Container: Callout
│   │       └── Inner Page (callout body)
│   │           ├── Block (paragraph)
│   │           └── Block (to-do)
│   └── Column (Page variant)
│       ├── Block (heading)
│       └── Block (paragraph)
├── Block (image)
└── Container: Quote
    └── Inner Page (quote body)
        ├── Block (paragraph)
        └── Block (paragraph)
```

At every level marked "Inner Page," the full interaction model from §3.1 applies.

---

## 4. HorizontalPartition Rules

The HorizontalPartition is the only layout mechanism. Its rules are defined once:

### 4.1 Creation

| Trigger | Result |
|---------|--------|
| Slash menu "N Columns" | Insert a HorizontalPartition with N columns, each containing an empty paragraph. Cursor in first column. |
| Drag block to left/right edge of another block | Create a HorizontalPartition containing both blocks as side-by-side columns. |
| Drag block to left/right edge of a block inside an existing column | Insert a new column adjacent to that column within the existing HorizontalPartition. |

### 4.2 Dissolution

A HorizontalPartition dissolves when it no longer serves a purpose:

| Condition | Result |
|-----------|--------|
| Column becomes empty (last block removed) | Remove the empty column. If 1 column remains → dissolve: replace HorizontalPartition with that column's content. |
| Only 1 column remains after any operation | Dissolve: unwrap the single column's blocks into the parent Page at the HorizontalPartition's position. |
| 0 columns remain | Remove the HorizontalPartition entirely (edge case). |

Dissolution is **always organic** — triggered by user actions on blocks, never by a menu item.

### 4.3 Resize

- Vertical handle appears between adjacent columns on hover
- Drag to resize adjacent columns proportionally
- Minimum width: 10% of HorizontalPartition width
- Double-click handle: reset all columns to equal width
- Widths stored as proportions on column node attributes

### 4.4 Nesting Constraint

**HorizontalPartitions cannot be nested inside columns.** This matches Notion's behavior and prevents the complexity explosion of recursive side-by-side layouts.

Enforcement:
1. **Schema**: `column` content spec does not allow `columnList`
2. **Slash menu**: Column items check ancestors and abort if cursor is inside a column
3. **Drag-and-drop**: Dragging a HorizontalPartition into a column is rejected
4. **Paste**: HorizontalPartition content is flattened when pasted inside a column

**Note:** The structural model _could_ support deeper nesting (it's just Pages inside Pages). The constraint is a UX decision, not a model limitation. It can be relaxed in the future if needed.

### 4.5 Container blocks inside columns

**Container blocks (toggle, callout, quote) CAN be nested inside columns.** A callout inside a column is just a Page-inside-a-Page — the interaction model recurses naturally. Only HorizontalPartitions themselves are restricted from nesting.

---

## 5. The Single Interaction Model — Complete Specification

This section defines how blocks behave inside **any** Page-container. It applies identically at the top level, inside a column, inside a toggle, inside a callout, inside a quote, or at any depth of nesting.

### 5.1 Handle Resolution

The ⋮⋮ drag handle appears next to **blocks** and **container blocks**. Never next to invisible structural containers (HorizontalPartition/columnList).

| Cursor position | Handle resolves to |
|-----------------|-------------------|
| Next to a leaf block | That block |
| Next to a container block (toggle, callout, quote) | The container block as a whole |
| Next to a HorizontalPartition | The **first block** inside the **first column** — because HorizontalPartitions are invisible |

### 5.2 Action Menu

Every block and container block shows the same action menu:

| Item | Behavior |
|------|----------|
| **Turn into** | Type conversion submenu (Text, H1–H3, Bullet, Numbered, To-do, Toggle, Code, Quote, Callout, Block equation) |
| **Color** | Text color + background color grid |
| **Duplicate** | Insert copy immediately after, within the same parent Page |
| **Delete** | Remove from parent Page |

No location-specific items. A block inside a column gets the exact same menu as a block at top level.

### 5.3 Drag-and-Drop

#### Drop Zones

| Guide type | Visual | Meaning |
|-----------|--------|---------|
| **Horizontal** | Blue line spanning full width of the parent Page | "Drop here — insert above or below at this position" |
| **Vertical** | Blue line spanning the height of a block | "Drop here — create or extend a HorizontalPartition" |

#### Drop Outcome Matrix

The outcome depends only on drop zone position, not on source or target type. See `BLOCK_INTERACTION_RULES.md` Rules 4A–4F for the complete matrix. The key principle:

- **Above/below a block** → move/insert at that position within the target's parent Page
- **Left/right of a block at top level** → create a new HorizontalPartition
- **Left/right of a block inside a column** → add a new column to the existing HorizontalPartition
- **Moving out of a column** → source column checks auto-dissolve rules

### 5.4 Keyboard Navigation

| Shortcut | Behavior |
|----------|----------|
| **Ctrl+Shift+↑** | Move block up within its parent Page. At top → move to previous container. |
| **Ctrl+Shift+↓** | Move block down within its parent Page. At bottom → move to next container. |
| **Ctrl+D** | Duplicate block within the same parent Page. |
| **Esc** | Select the current block. |
| **Tab** | Indent (for list items). |
| **Shift+Tab** | Un-indent (for list items). |

### 5.5 Empty Block / Empty Container

- Backspace in an empty block removes the block from its parent Page
- If removing a block empties a column → auto-dissolve fires (§4.2)
- Delete key at the end of a column's last block → blocked (no cross-column content merging)

---

## 6. Block Inventory — Notion Reference

This section catalogs every block type that Notion supports, grouped by category. This serves as the feature target for Parallx's canvas editor.

### 6.1 Text Blocks (Leaf)

| Block | Notion | Parallx Status | Notes |
|-------|--------|----------------|-------|
| Text (paragraph) | ✅ | ✅ | Base block |
| Heading 1 | ✅ | ✅ | |
| Heading 2 | ✅ | ✅ | |
| Heading 3 | ✅ | ✅ | |
| Bulleted list | ✅ | ✅ | Via TipTap BulletList |
| Numbered list | ✅ | ✅ | Via TipTap OrderedList |
| To-do list | ✅ | ✅ | Via TipTap TaskList |
| Toggle list | ✅ | ✅ | Container — summary + collapsible body |
| Code block | ✅ | ✅ | Via TipTap CodeBlockLowlight |
| Quote | ✅ | ✅ | Container — left-bordered Page |
| Callout | ✅ | ✅ | Container — emoji + background |
| Divider | ✅ | ✅ | Via TipTap HorizontalRule |

### 6.2 Inline Content (within text blocks)

| Inline | Notion | Parallx Status | Notes |
|--------|--------|----------------|-------|
| Bold | ✅ | ✅ | Via TipTap Bold |
| Italic | ✅ | ✅ | Via TipTap Italic |
| Underline | ✅ | ✅ | Via TipTap Underline |
| Strikethrough | ✅ | ✅ | Via TipTap Strike |
| Code | ✅ | ✅ | Via TipTap Code |
| Link | ✅ | ✅ | Via TipTap Link |
| Inline math | ✅ | ✅ | Custom inline node with KaTeX |
| Text color | ✅ | ✅ | Via TextStyle + Color |
| Highlight/background | ✅ | ✅ | Via Highlight |
| Mention (@page) | ✅ | ❌ | Requires page reference system |
| Mention (@person) | ✅ | ❌ | N/A for single-user v1 |
| Mention (@date) | ✅ | ❌ | Requires date picker |
| Comment | ✅ | ❌ | Requires comment system |

### 6.3 Media Blocks (Leaf)

| Block | Notion | Parallx Status | Notes |
|-------|--------|----------------|-------|
| Image | ✅ | ✅ | Via TipTap Image |
| Video | ✅ | ❌ | Embed with video player |
| Audio | ✅ | ❌ | Embed with audio player |
| File | ✅ | ❌ | File attachment block |
| Bookmark | ✅ | ❌ | URL preview card |
| Embed | ✅ | ❌ | Generic iframe embed |

### 6.4 Advanced Blocks (Leaf)

| Block | Notion | Parallx Status | Notes |
|-------|--------|----------------|-------|
| Block equation | ✅ | ✅ | Custom node with KaTeX |
| Table | ✅ | ✅ | Via TipTap Table |
| Table of contents | ✅ | ❌ | Auto-generated from headings |
| Breadcrumb | ✅ | ❌ | Page hierarchy display |
| Template button | ✅ | ❌ | Insert predefined content |
| Link to page | ✅ | ❌ | Internal page reference |
| Synced block | ✅ | ❌ | Shared block across pages |
| Toggle heading | ✅ | ❌ | Heading that collapses |

### 6.5 Layout (Structural)

| Structure | Notion | Parallx Status | Notes |
|-----------|--------|----------------|-------|
| Columns (HorizontalPartition) | ✅ | ✅ | 2–N columns, slash menu + drag |
| Column resize | ✅ | ✅ | Drag boundary between columns |

### 6.6 Database Blocks (Deferred)

Notion databases (Table view, Board view, Gallery, List, Calendar, Timeline) are a major feature category. These are deferred — they represent a separate milestone, not part of the canvas block editor.

---

## 7. Relationship to Existing Documents

### `BLOCK_INTERACTION_RULES.md`
The interaction rules document remains **valid and authoritative** for its specific scope (the deterministic drop outcome matrix, auto-dissolve steps, keyboard shortcuts, handle resolution). This structural model document provides the _conceptual framework_ that the interaction rules implement. Read this document first for the "why," then the interaction rules for the "what exactly happens."

The key reframing: where `BLOCK_INTERACTION_RULES.md` says "column," this document says "Page (column variant)." Where it says "columnList," this document says "HorizontalPartition." The behavior is identical; the mental model is more general.

### `NOTION_VS_PARALLX_GAP_ANALYSIS.md`
The gap analysis remains valid as a Notion-research reference. The structural model incorporates its findings into a unified framework. The priority matrix from the gap analysis (§10) should be read through the lens of this structural model — every fix is about making the single interaction model work correctly, not about "adding column features."

---

## 8. Design Principles

### 8.1 One Model, Not Many Special Cases

The old mental model had three competing concepts:
- "Blocks on a page" (top-level behavior)
- "Columns as spatial partitions" (a different kind of thing)
- "Container blocks" (toggle, callout — yet another kind of thing)

Each required its own interaction rules, its own edge cases, its own menu items. This led to column-specific menu items ("Unwrap columns," "Delete column layout"), special-cased handle resolution, and inconsistent behavior between nesting levels.

The new model has **one concept**: Page. Everything is a vertical container of blocks. The differences are chrome and constraints, not behavior.

### 8.2 Chrome is Decoration, Not Structure

A toggle's collapse control, a callout's emoji badge, a quote's left border — these are _decorations_ on a Page. They do not change how blocks inside that Page behave. The interaction model (drag, drop, action menu, keyboard) is defined on the Page abstraction, and every variant inherits it.

### 8.3 HorizontalPartition is the Sole Layout Exception

The only thing that breaks the simple "vertical stack of blocks" model is side-by-side layout. This is handled by exactly one structural primitive (HorizontalPartition), with exactly one nesting constraint (depth ≤ 1). Everything else is vertical.

### 8.4 Constraints are UX Decisions, Not Model Limitations

The structural model supports arbitrary nesting: a column could theoretically contain another HorizontalPartition, which contains columns, each containing callouts with toggles inside quotes. The model doesn't break.

We _choose_ to constrain nesting (no columns inside columns) because Notion does, and because deeply nested side-by-side layouts are confusing. But the model is ready for relaxing these constraints if the UX supports it.

---

## 9. Implementation Implications

### 9.1 Single Block-Container Interface

Implementation should define a single interface (or abstract class) for "a vertical container of blocks" — the Page abstraction. All container types (top-level editor, column, toggle body, callout body, quote body) implement this interface. Interaction logic (drag-and-drop handling, keyboard movement, action menu) is written against the interface, not against specific container types.

### 9.2 HorizontalPartition as Orthogonal Concern

Column management (creation, dissolution, resize) is orthogonal to block interaction. It should be implemented as a separate module that hooks into the Page interface at well-defined points:
- "A block was dropped on the left/right edge" → create/extend HorizontalPartition
- "A block was removed from a column" → check auto-dissolve
- "The user is hovering between columns" → show resize handle

### 9.3 Decomposition Aligns with Model

When decomposing the monolith (`canvasEditorProvider.ts`), the module boundaries should reflect this structural model:
- **Block extensions** → one module per block type (leaf or container)
- **Page interaction model** → drag-and-drop, keyboard movement, action menu
- **HorizontalPartition** → column creation, dissolution, resize
- **Chrome** → page header, toggle controls, callout badges (per-variant decoration)
- **Menus** → slash menu, bubble menu, block action menu (UI that triggers model operations)

### 9.4 Testing Strategy

Tests should be written against the Page abstraction:
- "Block X inside [top-level | column | toggle | callout] behaves the same" → parameterized tests
- HorizontalPartition tests are separate (creation, dissolution, resize, nesting prevention)
- Chrome tests are separate (page header rendering, toggle collapse, callout emoji)

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **Block** | An atomic unit of content (paragraph, heading, image, etc.). Cannot contain other blocks. |
| **Page** | A vertical container of blocks. The universal structural primitive. All containers are Pages. |
| **Page variant** | A Page with specific chrome: top-level (title/icon/cover), column (width constraint), toggle (summary/collapse), callout (emoji/color), quote (border). |
| **Container block** | A block that is itself a Page — it can be dragged as a unit from outside, but contains a vertical sequence of blocks inside. |
| **HorizontalPartition** | The sole layout operation: splits a row into 2+ side-by-side Pages (columns). Implemented as `columnList` + `column` nodes. |
| **Chrome** | The decorative/interactive elements that distinguish Page variants: title bars, emoji badges, collapse controls, borders, covers. |
| **Interaction model** | The set of behaviors (drag, drop, action menu, keyboard nav) that apply identically inside every Page. |
| **Auto-dissolve** | The process by which a HorizontalPartition removes itself when it contains ≤1 column. |
