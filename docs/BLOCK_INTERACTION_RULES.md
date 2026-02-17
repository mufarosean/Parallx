# Block Interaction Rules — Deterministic Specification

> **Authority:** This document defines the deterministic rules for how blocks behave in Parallx. Every interaction is governed by these rules. The implementation must follow them exactly. No special-casing by block location.

---

## Core Axioms

### Axiom 1: A block is a block
Every block has the same identity, capabilities, and interaction affordances regardless of where it sits — top-level, inside a column, inside a callout, nested in a list. **Location does not alter what a block is or what actions it supports.**

### Axiom 2: A column is a spatial partition
A column is not a block. It is a partition of horizontal space. It has no drag handle, no action menu, no block identity. Users never "interact with" a column — they interact with the blocks inside it. A `columnList` is the invisible container that holds partitions side by side.

### Axiom 3: Drag-and-drop is spatial
Dragging a block creates or modifies spatial arrangements. The drop position determines the result — not the type of the source or target. The same rules apply whether the user drags from top-level to top-level, top-level into a column, column to column, or column to top-level.

---

## Rule 1: Block Action Menu (⋮⋮ Click)

Every block, when its ⋮⋮ handle is clicked, shows the **same** action menu:

| Item | Behavior |
|------|----------|
| **Turn into** | Submenu: Text, H1, H2, H3, Bullet list, Numbered list, To-do list, Toggle list, Code, Quote, Callout, Block equation |
| **Color** | Text color + background color grid |
| **Duplicate** | Inserts a copy of the block immediately after it (within the same container) |
| **Delete** | Removes the block from its container |

**No location-specific items.** No "Column layout" section. No "Unwrap columns". No "Delete column layout". These do not exist.

**Future additions** (same for all blocks): Copy link to block, Move to, Comment.

---

## Rule 2: Handle Resolution

The ⋮⋮ drag handle appears next to **blocks only**, never next to containers.

| Cursor position | Handle resolves to |
|-----------------|-------------------|
| Next to a top-level block | That block |
| Next to a block inside a column | That block (within the column) |
| Next to a `columnList` element itself | The **first block** inside the **first column** — because the column structure is invisible; the first visible content is the first block |
| Next to a block inside a callout | That block (within the callout) |
| Next to a block inside a toggle | That block (within the toggle content) |

**General rule:** The handle always resolves to the nearest **content block** — the deepest block that the cursor is next to. Never to a structural container (column, columnList, callout wrapper, toggle wrapper).

---

## Rule 3: Drag-and-Drop Zones

When a block is being dragged, every potential drop position shows a **blue guide indicator**. There are exactly two types of guides:

### Horizontal guide (blue line spanning full width of the container)
Meaning: "Drop here — place the block above or below at this position."

Appears:
- Between two top-level blocks → block lands at top level
- Above the first block or below the last block at top level → block lands at top level
- Between two blocks inside a column → block lands inside that column
- Above the first block or below the last block in a column → block lands in that column

### Vertical guide (blue line spanning the height of a block)
Meaning: "Drop here — create or extend a column layout."

Appears:
- On the left edge of a top-level block → create a new columnList: [dragged block | target block]
- On the right edge of a top-level block → create a new columnList: [target block | dragged block]
- On the left edge of a block inside a column → insert a new column to the LEFT of that column in the existing columnList
- On the right edge of a block inside a column → insert a new column to the RIGHT of that column in the existing columnList

---

## Rule 4: Drop Outcomes — Complete Matrix

### 4A. Source: top-level block → Target: top-level block

| Drop zone | Result |
|-----------|--------|
| **Above** target | Block moves above the target. Standard reorder. |
| **Below** target | Block moves below the target. Standard reorder. |
| **Left edge** of target | New columnList created: `[dragged | target]`. Both become columns. |
| **Right edge** of target | New columnList created: `[target | dragged]`. Both become columns. |

### 4B. Source: top-level block → Target: block inside a column

| Drop zone | Result |
|-----------|--------|
| **Above** target (within column) | Block moves into the column, above the target block. |
| **Below** target (within column) | Block moves into the column, below the target block. |
| **Left edge** of target | New column inserted to the LEFT of the target's column in the existing columnList, containing the dragged block. |
| **Right edge** of target | New column inserted to the RIGHT of the target's column in the existing columnList, containing the dragged block. |

### 4C. Source: block inside a column → Target: top-level block

| Drop zone | Result |
|-----------|--------|
| **Above** target | Block moves out of the column to top level, above the target. Source column checks Rule 5 (empty column handling). |
| **Below** target | Block moves out of the column to top level, below the target. Source column checks Rule 5. |
| **Left edge** of target | New columnList created at the target's position: `[dragged | target]`. Source column checks Rule 5. |
| **Right edge** of target | New columnList created at the target's position: `[target | dragged]`. Source column checks Rule 5. |

### 4D. Source: block inside a column → Target: block in the SAME column

| Drop zone | Result |
|-----------|--------|
| **Above** target | Block moves above the target within the same column. Standard reorder within column. |
| **Below** target | Block moves below the target within the same column. Standard reorder within column. |
| **Left edge** of target | New column inserted to the left of the current column. Dragged block moves to the new column. Source column checks Rule 5. |
| **Right edge** of target | New column inserted to the right of the current column. Dragged block moves to the new column. Source column checks Rule 5. |

### 4E. Source: block inside a column → Target: block in a DIFFERENT column (same columnList)

| Drop zone | Result |
|-----------|--------|
| **Above** target | Block moves into the target's column, above the target. Source column checks Rule 5. |
| **Below** target | Block moves into the target's column, below the target. Source column checks Rule 5. |
| **Left edge** of target | New column inserted to the left of the target's column. Dragged block moves to new column. Source column checks Rule 5. |
| **Right edge** of target | New column inserted to the right of the target's column. Dragged block moves to new column. Source column checks Rule 5. |

### 4F. Source: block inside a column → Target: block in a DIFFERENT columnList

Same as 4B (top-level → column). The source column checks Rule 5.

---

## Rule 5: Empty Column Handling (Auto-Dissolve)

When a block is removed from a column (by drag, delete, or cut), the column and its parent columnList are checked:

### Step 1: Is the column now empty?
- **No** → done. No structural change.
- **Yes** → proceed to Step 2.

### Step 2: Remove the empty column. How many columns remain in the columnList?
- **0 columns** → Delete the entire columnList. (Edge case — shouldn't happen in practice because Step 3 catches it first.)
- **1 column** → **Dissolve the columnList.** Replace the columnList with the single remaining column's content. Those blocks become top-level (or whatever nesting level the columnList was at). The spatial partition is no longer needed.
- **2+ columns** → The columnList stays. The empty column is simply removed. The remaining columns adjust widths proportionally.

### Step 3: What about backspace in an empty column?
When the cursor is at the start of the first (and only) block in a column, and that block is an empty paragraph:
- **Backspace** → Same as "delete the block" → triggers Step 1 above.
- This means backspace in an empty column removes that column and potentially dissolves the layout.

### Step 4: What about Delete key at end of column?
When the cursor is at the end of the last block in a column:
- **Delete key** → Blocked. Does nothing. This prevents merging content across column boundaries, which would be structurally incorrect.

---

## Rule 6: Keyboard Block Movement

| Shortcut | Behavior |
|----------|----------|
| **Ctrl+Shift+↑** | Move the current block up one position within its container. If already at the top of a column, move to the previous container (above the columnList, or into the previous column's last position). |
| **Ctrl+Shift+↓** | Move the current block down one position within its container. If already at the bottom of a column, move to the next container (below the columnList, or into the next column's first position). |
| **Ctrl+D** | Duplicate the current block immediately after it within the same container. |
| **Esc** | Select the current block (visual block selection). |

Block movement follows the same empty-column rules (Rule 5) when a block moves out of a column.

---

## Rule 7: Column Creation via Slash Menu

Slash menu items "2 Columns", "3 Columns", "4 Columns":
- Insert a columnList with N columns, each containing an empty paragraph.
- The cursor is placed in the first column's first paragraph.
- **Nesting prevention:** If the cursor is already inside a column, the slash menu column items do nothing (columns cannot be nested).

This is valid and correct.

---

## Rule 8: Column Resize

- Hovering between two adjacent columns shows a vertical resize handle (gray line).
- Dragging the handle resizes the two adjacent columns proportionally.
- Each column has a minimum width (10% of the columnList width).
- Double-clicking the resize handle resets both columns to equal width.
- Resize does not affect the content inside columns — it only changes the spatial partition.

---

## Rule 9: Nesting Prevention

Columns cannot be nested inside other columns. This is enforced at multiple levels:

1. **Schema level:** The `column` node's content spec (`block+`) does not include `columnList` as a valid child.
2. **Slash menu:** Column items check ancestor nodes and abort if cursor is inside a column.
3. **Drag-and-drop:** Dragging a columnList into a column is rejected. The drop indicator does not appear.
4. **Paste:** If pasted content contains a columnList and the cursor is inside a column, the columnList content is flattened (columns' content is pasted sequentially).

---

## Rule 10: What a columnList Is and Isn't

**Is:** An invisible structural container holding 2+ columns side by side.
**Isn't:** A block. It has no handle, no action menu, no user-visible identity.

A columnList:
- Has no ⋮⋮ drag handle of its own
- Cannot be "selected" as a unit by the user
- Cannot be "turned into" anything
- Cannot be duplicated/deleted via action menu
- Is created organically (slash menu or drag-and-drop)
- Is destroyed organically (when ≤1 column remains, it dissolves)
- The only user-facing evidence of its existence is the visual side-by-side layout of its children

---

## Edge Cases

### Q: What if you drag the only block in a column to above the columnList?
A: The block moves to top level above the columnList. The source column is now empty → Rule 5 fires → if 1 column remains, columnList dissolves. If 2+ remain, empty column is removed.

### Q: What if you drag a block to the right edge of a block in the rightmost column?
A: A new column is created to the right of the rightmost column in the same columnList. The dragged block is placed in this new column.

### Q: What if you drag a block to the left edge of a block in the leftmost column?
A: A new column is created to the left of the leftmost column in the same columnList. The dragged block is placed in this new column.

### Q: What if there are already 4 columns and you drag to create a 5th?
A: It works. There is no hard cap on column count. However, minimum column width (10%) naturally limits practical column count. The UI should not artificially restrict this.

### Q: What if you Ctrl+Z (undo) after column creation by drag?
A: The entire operation (block move + columnList creation) is undone as a single atomic transaction. The block returns to its original position, the columnList is removed.

### Q: What if you drag a block from one columnList into another columnList?
A: Same rules as 4B/4E. The block lands at the indicated position. Source column checks Rule 5.

### Q: What happens to column widths when a column is added or removed?
A: When a column is **added** (by drag), all columns in the layout reset to equal widths (`100% / N`). When a column is **removed** (by drag-out or empty column removal), remaining columns redistribute to equal widths.

### Q: Can you drag a block into an empty column (a column that only has an empty paragraph)?
A: Yes. The dragged block replaces the empty paragraph (or is inserted above/below it depending on drop zone). Standard above/below rules apply.
