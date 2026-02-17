# TipTap Multi-Column Layout Extensions — Research Report

> **Research conducted:** July 2025
> **Target framework:** TipTap v3 (`@tiptap/core@3.19.0`)
> **Purpose:** Identify and analyze all existing TipTap/ProseMirror column/multi-column implementations to inform Parallx Canvas tool column layout design.
> **Status:** RESEARCH ONLY — no code written.

---

## Executive Summary

After exhaustive search across GitHub, npm, TipTap discussions, ProseMirror forum, and community extension lists, **exactly ONE significant open-source column layout implementation exists** for TipTap/ProseMirror:

| Implementation | npm Package | Stars | License | Status |
|---|---|---|---|---|
| **GYHHAHA/prosemirror-columns** | `tiptap-extension-multi-column` v0.0.2 | ~10 | MIT | Active (May 2025) |
| **@tiptap-pro/extension-columns** | `@tiptap-pro/extension-columns` | N/A | Proprietary | Behind paywall |

The open-source landscape for TipTap column layouts is **extremely thin**. The GYHHAHA implementation is the only viable reference. It is early-stage (v0.0.2, 42 weekly npm downloads) but has production validation via **Docmost** (19k-star open-source wiki) as its sponsor.

---

## Sources Searched

### Confirmed Hits
| Source | URL | Result |
|---|---|---|
| GYHHAHA/prosemirror-columns | https://github.com/GYHHAHA/prosemirror-columns | ✅ Full source analyzed |
| npm: tiptap-extension-multi-column | https://www.npmjs.com/package/tiptap-extension-multi-column | ✅ v0.0.2, 42 weekly downloads |
| TipTap Discussion #6317 | https://github.com/ueberdosis/tiptap/discussions/6317 | ✅ Community extension announcement (May 2025) |
| Docmost (sponsor) | https://github.com/docmost/docmost | ✅ Uses the extension in production |
| @tiptap-pro/extension-columns | npm registry | ✅ Exists, requires paid subscription |

### Confirmed Non-Hits (404 / Nonexistent)
| Source | URL | Result |
|---|---|---|
| nicepkg/tiptap-column | https://github.com/nicepkg/tiptap-column | ❌ 404 |
| nicepkg/tiptap-table-column | https://github.com/nicepkg/tiptap-table-column | ❌ 404 |
| nicepkg/tiptap-column-layout | https://github.com/nicepkg/tiptap-column-layout | ❌ 404 |
| nicepkg/tiptap-columns | https://github.com/nicepkg/tiptap-columns | ❌ 404 |

### Confirmed Irrelevant
| Source | URL | Result |
|---|---|---|
| HMarzban/extension-hypermultimedia | GitHub | Multimedia embeds only, not columns |
| phyohtetarkar/tiptap-block-editor | GitHub | Block editor, no column support |
| namesakefyi/tiptap-extensions | GitHub | Steps + Disclosures only |
| Novel (steven-tey) | GitHub | Notion-like editor, no columns |
| Umo Editor (umodoc) | GitHub | Word-like editor, uses TipTap Pro for columns |
| awesome-tiptap list | GitHub | No column extension listed (PR #43 pending) |

### Forums Searched
| Forum | Query | Result |
|---|---|---|
| ProseMirror discuss | "columns layout" | 5 results, all tangential (table columns, backspace in wrappers) |
| TipTap GitHub Issues | "columns" | Mostly table column issues, not layout columns |
| TipTap GitHub Discussions | community-extensions category | Found #6317 (the key hit) |
| GitHub Topics | tiptap-extension | 21 repos, none column-related |

---

## Implementation #1: GYHHAHA/prosemirror-columns (DETAILED ANALYSIS)

### Overview
- **Repository:** https://github.com/GYHHAHA/prosemirror-columns
- **npm package:** `tiptap-extension-multi-column` v0.0.2
- **Published:** May 2025
- **License:** MIT
- **Size:** 64.8 kB unpacked
- **Weekly downloads:** 42
- **Architecture inspiration:** `prosemirror-tables` (same Plugin + State + decoration pattern)
- **Sponsor:** Docmost (https://docmost.com, 19k GitHub stars)
- **TipTap Discussion:** https://github.com/ueberdosis/tiptap/discussions/6317

### Schema (ProseMirror NodeSpecs)

Two nodes in a parent-child relationship:

```typescript
// columnNodes() returns { column, column_container }

column_container: {
  group: 'block',
  content: 'column+',          // Must contain 1+ columns
  isolating: true,
  parseDOM: [{ tag: 'div.prosemirror-column-container' }],
  toDOM: () => ['div', { class: 'prosemirror-column-container' }, 0]
}

column: {
  group: 'block',               // NOT in 'block' group of container — only in column_container
  content: 'block+',            // Any block content inside columns
  attrs: {
    colWidth: { default: 200 }  // Pixel width
  },
  isolating: true,
  parseDOM: [{
    tag: 'div.prosemirror-column',
    getAttrs: (dom) => {
      const width = (dom as HTMLElement).style.width;
      return { colWidth: width ? parseInt(width) : 200 };
    }
  }],
  toDOM: (node) => [
    'div',
    {
      class: 'prosemirror-column',
      style: `width: ${node.attrs.colWidth}px`
    },
    0
  ]
}
```

**Key observations:**
- Uses **pixel-based widths** (`colWidth` default: 200px), NOT percentage-based
- Width is stored as a node attribute and serialized as inline `style="width: Xpx"`
- Both nodes have `isolating: true` — prevents cursor from escaping column boundaries
- Content model is `block+` — any block-level node can go inside a column
- Container requires `column+` — minimum one column, no other node types allowed

### TipTap Extension Wrapper

Three TipTap entities:

```typescript
// 1. Column node
const Column = Node.create({
  name: 'column',
  group: 'block',
  content: 'block+',
  isolating: true,
  addAttributes() {
    return {
      colWidth: {
        default: 200,
        parseHTML: (el) => parseInt(el.style.width) || 200,
        renderHTML: (attrs) => ({ style: `width: ${attrs.colWidth}px` })
      }
    };
  },
  parseHTML: () => [{ tag: 'div.prosemirror-column' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes({ class: 'prosemirror-column' }, HTMLAttributes), 0]
});

// 2. ColumnContainer node
const ColumnContainer = Node.create({
  name: 'column_container',
  group: 'block',
  content: 'column+',
  isolating: true,
  parseHTML: () => [{ tag: 'div.prosemirror-column-container' }],
  renderHTML: () => ['div', { class: 'prosemirror-column-container' }, 0]
});

// 3. ColumnsExtension (bundles everything)
const ColumnsExtension = Extension.create({
  name: 'columns',
  addExtensions() {
    return [Column, ColumnContainer];
  },
  addProseMirrorPlugins() {
    return [
      gridResizingPlugin({ handleWidth: 2, columnMinWidth: 50 }),
      columnsKeymap
    ];
  }
});
```

**Key observations:**
- Single `ColumnsExtension` entry point bundles both nodes and plugins
- No TipTap commands defined — no `setColumns()`, `addColumn()`, `removeColumn()` etc.
- Column creation is handled entirely by the resize plugin's "+" button decoration
- Plugin options: `handleWidth: 2` (resize handle width in px), `columnMinWidth: 50`

### Resize System (ProseMirror Plugin)

Architecture mirrors `prosemirror-tables`:

```
gridResizingPlugin (Plugin<GridResizeState>)
  ├── GridResizeState (PluginKey state)
  │   ├── activeHandle: number (-1 = none)
  │   └── dragging: { startX, startWidth } | false
  ├── Props
  │   ├── attributes: adds 'resize-cursor' class to editor
  │   ├── handleDOMEvents: mousemove, mouseleave, mousedown, mouseup
  │   └── decorations: renders resize handle widgets
  └── Meta actions (via tr.setMeta)
      ├── setHandle(activeHandle)
      └── setDragging(dragging)
```

#### State Management (`state.ts`)

```typescript
class GridResizeState {
  activeHandle: number;      // Index of active column boundary (-1 = none)
  dragging: Dragging | false; // { startX: number, startWidth: number }

  apply(tr: Transaction): GridResizeState {
    const action = tr.getMeta(gridResizingPluginKey);
    if (action?.setHandle !== undefined) return new GridResizeState(action.setHandle, false);
    if (action?.setDragging !== undefined) return new GridResizeState(this.activeHandle, action.setDragging);
    if (this.activeHandle > -1 && tr.docChanged) return new GridResizeState(-1, false);
    return this;
  }
}
```

#### Mouse Event Handlers (`dom.ts`)

**`handleMouseMove`:**
- Calls `findBoundaryPosition()` to detect if cursor is near a column's right edge
- If near edge (within `handleWidth` pixels): dispatches `setHandle` meta
- If not near edge: clears handle if one was active

**`handleMouseDown`:**
- When `activeHandle > -1`: records `startX` and `startWidth`, attaches **window-level** `mousemove` and `mouseup` listeners
- During drag (window mousemove): calculates new width via `draggedWidth()`, dispatches `updateColumnNodeWidth()` transaction
- On window mouseup: dispatches `setDragging(false)`, removes window listeners

**`handleMouseUp`:**
- Handles clicks on the "+" circle button decoration
- On click: inserts a new `column` node with `colWidth: 100` containing an empty paragraph
- Uses `tr.insert(insertPos, columnNode)` to add adjacent to the clicked boundary

**`handleMouseLeave`:**
- Clears active handle when cursor leaves editor

#### Utility Functions (`utils.ts`)

```typescript
// Detects if mouse is near a column's right edge
findBoundaryPosition(view, containerPos, event, handleWidth): number | null

// Calculates new width from drag offset, enforcing minimum
draggedWidth(startWidth: number, offset: number, minWidth: number): number

// Dispatches transaction to update column width
updateColumnNodeWidth(view, pos, width): void
// Implementation: tr.setNodeMarkup(pos, undefined, { ...attrs, colWidth: width - 12 * 2 })
// Note: subtracts 24px (12px padding on each side)

// Resolves position to column node and DOM element
getColumnInfoAtPos(view, pos): { node, dom, pos } | null
```

**Critical detail:** `updateColumnNodeWidth` subtracts `12 * 2 = 24` from the width to account for column padding. This hardcodes the padding value — if CSS padding changes, this function must be updated.

### Keymap (`keymap.ts`)

```typescript
const columnsKeymap = keymap({
  'Enter': chainCommands(
    newlineInCode,
    createParagraphNear,
    customLiftEmptyBlock,  // Modified: prevents lifting node out of column
    splitBlock
  ),
  'Mod-a': selectAllInColumn  // Selects all content within parent column only
});
```

**`customLiftEmptyBlock`:**
- Modified version of ProseMirror's `liftEmptyBlock`
- Checks if the grandparent is a `column` node — if so, prevents the lift
- This prevents pressing Enter on an empty block from "escaping" the column container

**`selectAllInColumn` (Mod-a / Cmd-a):**
- Finds the nearest `column` ancestor
- Creates a `TextSelection` from column start to column end
- Prevents selecting the entire document when inside a column

### CSS Layout (`column.css`)

```css
/* Container: flexbox row */
.prosemirror-column-container {
  display: flex;
  flex-direction: row;
  width: calc(100% - 8px);
  gap: 12px;
  margin: 16px 0;
}

/* Column: relative positioned for resize handle */
.prosemirror-column {
  position: relative;
  border-radius: 8px;
  min-width: 50px;
  padding: 12px;                    /* This matches the 12*2 hardcoded in utils.ts */
  background-color: transparent;
}

/* Hover state on container */
.prosemirror-column-container:hover .prosemirror-column,
.prosemirror-column-container:focus-within .prosemirror-column {
  background-color: rgba(100, 106, 115, 0.05);
}

/* Resize handle: absolute positioned between columns */
.grid-resize-handle {
  position: absolute;
  right: -7px;
  top: 0;
  bottom: 0;
  width: 2px;
  z-index: 20;
  background-color: #336df4;       /* Hardcoded blue */
}

/* "Add column" circle button on resize handle */
.grid-resize-handle .circle-button {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: #336df4;
  border: 1px solid white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.grid-resize-handle .circle-button:hover {
  transform: translateX(-50%) scale(1.35);  /* Grows on hover */
}

/* Plus icon via CSS pseudo-elements */
.circle-button .plus::before {  /* horizontal bar */  }
.circle-button .plus::after {   /* vertical bar */    }
```

**Key CSS observations:**
- **Flexbox layout**, not CSS Grid or CSS Columns
- Container is `calc(100% - 8px)` wide with `12px` gap between columns
- Column widths are pixel-based via inline `style` attribute, not flex percentages
- Minimum width enforced at both CSS (`min-width: 50px`) and JS (`columnMinWidth` option) levels
- Resize handle colors are hardcoded (`#336df4` blue) — no CSS custom properties
- No dark mode support in the CSS
- Hover effect only appears on the container hover/focus-within state

### Serialization

**HTML output:**
```html
<div class="prosemirror-column-container">
  <div class="prosemirror-column" style="width: 300px">
    <p>Column 1 content</p>
  </div>
  <div class="prosemirror-column" style="width: 300px">
    <p>Column 2 content</p>
  </div>
</div>
```

**JSON output (TipTap `.getJSON()`):**
```json
{
  "type": "column_container",
  "content": [
    {
      "type": "column",
      "attrs": { "colWidth": 300 },
      "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "Column 1 content" }] }
      ]
    },
    {
      "type": "column",
      "attrs": { "colWidth": 300 },
      "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "Column 2 content" }] }
      ]
    }
  ]
}
```

### What's NOT Implemented

| Feature | Status | Notes |
|---|---|---|
| **TipTap commands** | ❌ Missing | No `setColumns()`, `addColumn()`, `removeColumn()` commands. Column creation only via "+" button decoration. |
| **Drag-and-drop** | ❌ Missing | Cannot drag content between columns. Cannot drag columns to reorder. |
| **Percentage widths** | ❌ Missing | Only pixel-based widths. No responsive layout. |
| **Column count presets** | ❌ Missing | No "2 columns", "3 columns" quick actions. |
| **Remove column** | ❌ Missing | No UI to remove a column (only add via "+" button). User must manually select and delete. |
| **Keyboard resize** | ❌ Missing | Resize is mouse-only. No keyboard shortcuts for adjusting widths. |
| **Dark mode** | ❌ Missing | Colors hardcoded. No CSS custom properties. |
| **Accessibility** | ❌ Missing | No ARIA roles, no keyboard navigation between columns. |
| **Undo integration** | ⚠️ Partial | Resize dispatches individual transactions per mouse movement. Could be many undos for a single drag. No `appendTransaction` grouping. |
| **Mobile/touch** | ❌ Missing | Mouse events only. No touch event handlers. |
| **Markdown serialization** | ❌ Missing | No Markdown input/output rules for columns. |
| **Max column count** | ❌ Missing | No limit on how many columns can be added. |
| **Equal distribution** | ❌ Missing | No "distribute columns equally" action. |

### Known Issues & Risks

1. **Hardcoded padding math:** `updateColumnNodeWidth` subtracts `12 * 2` for padding. If CSS padding changes, widths break silently.
2. **Pixel-only widths:** Columns won't reflow when the editor container resizes. Content may overflow or be clipped.
3. **No transaction batching:** Resize drag creates many individual transactions (one per mousemove). This could cause performance issues with collaborative editing and creates noisy undo history.
4. **Window-level event listeners:** `mousedown` attaches `mousemove`/`mouseup` to `window`. If the listener cleanup fails (e.g., exception during drag), events leak.
5. **v0.0.2:** Very early version. API may change significantly.
6. **42 weekly downloads:** Minimal community adoption and testing.
7. **No test suite visible:** No tests found in the repository.
8. **Inline styles for widths:** Width stored as `style="width: Xpx"` in HTML. This could conflict with CSS frameworks or content security policies that restrict inline styles.

---

## Implementation #2: @tiptap-pro/extension-columns (PAYWALLED)

### Overview
- **npm packages:** `@tiptap-pro/extension-columns`, `@tiptap-pro/extension-column`
- **Access:** Requires TipTap Pro subscription (starts at $49/mo for Start plan)
- **Documentation:** Not publicly accessible (requires login to https://cloud.tiptap.dev)
- **Source:** Not viewable without subscription

### What We Know
- Two separate npm packages (container + child column pattern, same as GYHHAHA)
- Part of the "Pro extensions" tier, alongside features like AI and documents
- Used by major companies (LinkedIn, Thomson Reuters, BCG, KPMG per TipTap pricing page)
- No public API documentation, examples, or source code available
- Likely the most battle-tested implementation given TipTap's enterprise customer base
- TipTap pricing page mentions "Pro extensions" require an active subscription for verification

### What We Don't Know
- Schema design (pixel vs percentage widths)
- Available commands
- Resize behavior
- Drag-and-drop support
- Responsive behavior
- Content model details
- Serialization format
- Integration with TipTap collaboration

---

## Implementation #3: Umo Editor (Indirect — Uses TipTap Pro)

### Overview
- **Repository:** https://github.com/umodoc/editor (1.4k stars)
- **Description:** Open-source document editor based on Vue3 and TipTap (Word-like)
- **Column support:** Via TipTap Pro subscription (`.npmrc` references "tiptap pro private repo token")
- **Not a standalone implementation** — depends on `@tiptap-pro/extension-columns`

### Relevance
Confirms that even large open-source TipTap projects (1.4k stars) use the Pro extension rather than building their own column implementation. This validates the difficulty of building production-quality columns.

---

## Production Usage: Docmost

### Overview
- **Repository:** https://github.com/docmost/docmost (19k stars)
- **Description:** Open-source collaborative wiki software
- **Column support:** Uses `tiptap-extension-multi-column` (GYHHAHA's package)
- **Relationship:** Sponsors the prosemirror-columns project

### Integration Pattern
- Docmost has its own `packages/editor-ext/` with 17+ custom TipTap extensions (callout, details, table, math, etc.)
- Columns are the ONLY feature imported from an external package rather than built in-house
- This suggests columns are hard enough that even a well-resourced project (19k stars) prefers to use a dedicated package

### Docmost's Extensions (for reference)
Built internally: attachment, callout, comment, custom-code-block, details, heading, image, markdown, math, recreate-transform, search-and-replace, shared-storage, subpages, table, unique-id, video, drawio, embed.

NOT built internally (uses external): columns (`tiptap-extension-multi-column`).

---

## ProseMirror Forum Analysis

### Relevant Discussions Found

**"Multi-column layouts" (2015)** — Very early ProseMirror discussion about finding node instances. Not about implementing column layouts. Predates modern ProseMirror schema design.

**"Skip deleting wrapper element when pressing backspace"** — About preventing backspace from deleting layout column wrapper nodes. Relevant pattern for our keymap customization — confirms that column containers need special keyboard handling to prevent users from accidentally destroying the column structure.

### Gap
No comprehensive ProseMirror column implementation discussion exists on the forum. The `prosemirror-tables` package is the closest architectural reference (and is what GYHHAHA explicitly modeled after).

---

## Architecture Comparison: prosemirror-columns vs prosemirror-tables

Since GYHHAHA's implementation is modeled after `prosemirror-tables`, here's how they compare:

| Aspect | prosemirror-tables | prosemirror-columns |
|---|---|---|
| **Parent node** | `table` → `table_row` → `table_cell` | `column_container` → `column` |
| **Nesting depth** | 3 levels | 2 levels |
| **Width attribute** | `colwidth: number[]` on cells | `colWidth: number` on columns |
| **Resize plugin** | `columnResizing()` | `gridResizingPlugin()` |
| **State class** | `ResizeState` | `GridResizeState` |
| **Plugin key** | `columnResizingPluginKey` | `gridResizingPluginKey` |
| **Decoration type** | Widget decorations for handles | Widget decorations for handles |
| **Mouse events** | Same pattern (document-level) | Same pattern (window-level) |
| **Add functionality** | Commands: `addColumnBefore`, `addColumnAfter`, etc. | "+" button decoration only |
| **Delete functionality** | Commands: `deleteColumn`, `deleteRow`, etc. | None |
| **Selection** | Custom `CellSelection` class | No custom selection |
| **Maturity** | ~8 years, 500+ stars, widely used | ~2 months, v0.0.2, 42 downloads |

---

## Recommendations for Parallx Implementation

Based on this research, here are recommendations for building column layout support in the Canvas tool:

### 1. Schema Design
- **Follow the dual-node pattern** (`column_container` + `column`). Both implementations and prosemirror-tables use this.
- **Consider percentage widths** instead of pixels for responsive behavior. Store as e.g., `colWidth: '50%'` or a fractional value.
- **Use CSS custom properties** for theming (not hardcoded colors).
- **Set `isolating: true`** on both nodes (confirmed as important by GYHHAHA's implementation).

### 2. Commands (Gap to Fill)
GYHHAHA's biggest gap is the lack of proper TipTap commands. Parallx should implement:
- `setColumns(count)` — Insert a column container with N equal columns
- `addColumn()` — Add a column to existing container
- `removeColumn()` — Remove the focused column
- `distributeColumnsEvenly()` — Reset all columns to equal width
- These should be slash-command accessible in the Canvas editor

### 3. Resize System
- The prosemirror-tables Plugin pattern works. Adopt it.
- **Batch resize transactions** — Use `appendTransaction` or debounce to avoid per-mousemove transactions.
- **Add keyboard resize** — Arrow keys while handle is focused.
- **Add touch support** — Touch events for mobile/tablet.

### 4. CSS Approach
- **Flexbox is correct** — No need for CSS Grid or CSS Columns for this use case.
- **Use CSS custom properties** for all colors and spacing.
- **Support dark mode** from day one.
- **Consider `flex-grow`/`flex-basis`** instead of inline pixel widths for more natural flexbox behavior.

### 5. Keyboard Handling
- The custom Enter and Cmd-A handling in GYHHAHA is essential. Copy this pattern.
- **Add Tab** — Tab to move between columns.
- **Add Backspace protection** — Prevent backspace at column start from merging/destroying columns.
- **Add arrow key navigation** — Left/Right at column edges should move to adjacent column.

### 6. Undo/Redo
- Group resize operations into a single undo step.
- The current GYHHAHA implementation creates many tiny undos during a drag — this is a poor UX.

### 7. Accessibility
- Add `role="grid"` or similar ARIA roles to the container.
- Add `role="gridcell"` to individual columns.
- Provide screen reader announcements for column creation, deletion, and resize.

### 8. Drag-and-Drop
- Neither existing implementation supports drag between columns.
- This is complex but important for a Notion-like experience.
- Consider using ProseMirror's built-in drag handling with custom drop target logic.

---

## File Inventory: GYHHAHA/prosemirror-columns

For reference, here is every file in the repository with its purpose:

| File | Purpose | Lines (approx) |
|---|---|---|
| `src/schema.ts` | ProseMirror NodeSpecs for `column` and `column_container` | ~50 |
| `src/tiptap.ts` | TipTap `Node.create()` wrappers + `Extension.create()` bundle | ~80 |
| `src/resize.ts` | ProseMirror Plugin factory with GridResizeState | ~50 |
| `src/state.ts` | GridResizeState class with apply/init | ~40 |
| `src/dom.ts` | Mouse event handlers + decoration builders | ~120 |
| `src/utils.ts` | Boundary detection, width calculation, node updates | ~80 |
| `src/keymap.ts` | Custom Enter and Cmd-A keybindings | ~60 |
| `src/column.css` | Flexbox layout + resize handle styles | ~80 |
| `src/index.ts` | Re-exports | ~10 |

---

## Conclusion

The TipTap column layout ecosystem is nascent. There is effectively one open-source implementation (GYHHAHA/prosemirror-columns) and one proprietary one (@tiptap-pro). The open-source version is architecturally sound (mirrors prosemirror-tables patterns) but lacks commands, accessibility, responsive design, and drag-and-drop. It provides an excellent starting point for understanding the ProseMirror primitives needed (dual-node schema, Plugin with state, decorations for handles, custom keymap) but Parallx will need to build a more complete implementation.

The strongest signal from this research: **even Docmost (19k stars) doesn't build columns in-house.** Column layout in a ProseMirror editor is a non-trivial engineering challenge. The prosemirror-tables architecture is the proven pattern to follow, adapted for the simpler 2-level column hierarchy instead of 3-level table hierarchy.
