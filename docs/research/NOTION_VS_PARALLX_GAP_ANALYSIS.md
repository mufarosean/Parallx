# Notion vs Parallx — Gap Analysis

> **Purpose:** Honest, research-backed comparison of how Notion handles blocks, columns, and interactions versus what Parallx currently implements. Every claim about Notion is sourced from official documentation (notion.com/help, developers.notion.com/reference).

---

## 1. The Block Handle (⋮⋮)

### Notion
Every line/block gets a **⋮⋮** handle that appears in the left margin **on hover**.
The handle does **two things**:
1. **Click** → opens action menu (Turn into, Color, Copy link to block, Duplicate, Move to, Delete, Comment)
2. **Click-drag** → moves the block (drag-and-drop reorder)

There is also a **+** icon that appears to the left of ⋮⋮ on hover. Clicking it opens the block insertion menu (same as typing `/`).

**Source:** [notion.com/help/writing-and-editing-basics](https://notion.com/help/writing-and-editing-basics)

### Parallx
- ⋮⋮ handle appears on hover — ✅ matches
- Click opens action menu — ✅ matches
- Click-drag moves block — ✅ matches
- + button appears and triggers slash menu — ✅ matches (with `/` text insertion)
- Blocks inside columns get their own ⋮⋮ handles — ✅ matches (fixed in db7a157)

### Gap: None for handle basics

---

## 2. Action Menu Items

### Notion
When you click ⋮⋮ on **any block**, the menu shows:

| Item | Behavior |
|------|----------|
| **Turn into** | Submenu: Text, H1, H2, H3, Bullet list, Numbered list, To-do list, Toggle list, Code, Quote, Callout, Block equation |
| **Color** | Text color + background color grid |
| **Copy link to block** | Copies a URL anchor to this specific block |
| **Duplicate** | Duplicates the block |
| **Move to** | Moves the block to another page |
| **Delete** | Deletes the block |
| **Comment** | Adds a comment thread to the block |

The menu is the **same** whether the block is at the top level or inside a column. There is **no special "Column layout" section**. Columns are invisible containers — the user interacts with blocks, not with the column structure.

**Source:** [notion.com/help/writing-and-editing-basics](https://notion.com/help/writing-and-editing-basics)

### Parallx

| Item | Status |
|------|--------|
| Turn into | ✅ Present (same options except Suggest edits, Ask AI — acceptable omissions) |
| Color | ✅ Present (text + background) |
| Copy link to block | ❌ Missing |
| Duplicate | ✅ Present |
| Move to | ❌ Missing |
| Delete | ✅ Present |
| Comment | ❌ Missing |

**Additional non-Notion items in Parallx:**

For **columnList blocks**, the menu shows:
- "Unwrap columns" — ❌ **not a Notion concept**

For **blocks inside a column**, the menu shows an extra section:
- "Column layout" header — ❌ **not a Notion concept**
- "Unwrap columns" — ❌ **not a Notion concept**
- "Duplicate column layout" — ❌ **not a Notion concept**
- "Delete column layout" — ❌ **not a Notion concept**

### Gaps
1. **Missing:** Copy link to block, Move to, Comment
2. **Extra (remove):** "Unwrap columns", "Column layout" section, "Duplicate column layout", "Delete column layout"
3. **Wrong behavior for columnList:** Notion does NOT show a special menu for column containers. The ⋮⋮ handle targets individual blocks inside columns, never the column structure itself.

### Fix
- Remove the entire "Column layout" section from the action menu
- Remove the "Unwrap columns" item that appears when clicking on a columnList
- The ⋮⋮ handle on a columnList should resolve to the first block inside the first column (same as Notion — you interact with blocks, not containers)
- Add: Copy link to block, Move to, Comment (can be deferred to later milestone)

---

## 3. Column Creation

### Notion
Columns are created through **two methods**:

1. **Slash menu** — Notion has column items in the slash menu (e.g., "2 columns", "3 columns", etc.) that insert empty column structures.
2. **Drag-and-drop** — Dragging a block to the left/right edge of another block creates a new column layout wrapping both.

> *"Click and drag the text you want to put in another column. The ⋮⋮ symbol in the left margin is your handle for drag and drop. Follow the blue guides that appear. Drop it where you want it. You just created a new column!"*

**Key rules:**
- Both slash menu AND drag-and-drop create columns
- Blue guides during drag show: horizontal line = above/below, vertical line = create/join column
- You can add more columns by dragging more blocks to the side of existing columns

**Source:** [notion.com/help/columns-headings-and-dividers](https://notion.com/help/columns-headings-and-dividers)

### Parallx
Two creation methods:

1. **Slash menu** — "2 Columns", "3 Columns", "4 Columns" items that insert empty columnList structures ✅
2. **columnDropPlugin** — drag a block to the left/right edge of another top-level block to create columns ✅ (partially)

### Gaps
1. **Slash menu column items are correct** — keep them.
2. **columnDropPlugin is partially correct** but limited:
   - ✅ Dragging a block to the side of another block creates columns
   - ❌ Only works with top-level blocks — cannot drag a block to join an **existing** column layout
   - ❌ Cannot drag a block **out** of a column to dissolve the column structure
   - ❌ Blue guides are partial (vertical indicator only, no horizontal placement guides)
   - ❌ Cannot drag a block from one column to another within the same layout

### Fix
- **Keep** slash menu column items (they are valid)
- **Enhance columnDropPlugin** to support:
  - Dragging into existing column layouts (adding a block to a column, or adding a new column to an existing layout)
  - Dragging blocks out of columns (to top-level)
  - Dragging between columns
- **Improve drag indicators** — show clear horizontal/vertical blue guides during drag

---

## 4. Column Removal

### Notion
Columns are removed by manipulating the blocks **inside** them:

> *"Click the ⋮⋮ icon and hold to drag the content in your right-hand column back under or above the content in the left-hand column. When you see the blue guide span the width of the page, drop it and the columns should disappear."*

For empty columns:
> *"Click the ⋮⋮ icon and select Delete"*

**Key rules:**
- There is **no "Unwrap columns" menu item** in Notion
- There is **no "Delete column layout" menu item** in Notion
- Column structures dissolve **organically** when blocks are dragged out
- If a column becomes empty, you delete **the empty column placeholder** (via the ⋮⋮ Delete option on the empty paragraph), not a "column layout"

**Source:** [notion.com/help/columns-headings-and-dividers](https://notion.com/help/columns-headings-and-dividers)

### Parallx
Three removal mechanisms:

1. **columnAutoDissolvePlugin** — auto-dissolves columnList when ≤1 column remains ✅ correct concept
2. **Backspace handler** — pressing Backspace in empty column deletes the column or dissolves the structure ✅ correct concept
3. **Action menu items** — "Unwrap columns", "Delete column layout" ❌ not Notion behavior

### Gaps
1. **"Unwrap columns" and "Delete column layout" shouldn't exist** — Notion users remove columns by dragging blocks out, not by clicking menu items on the column structure
2. **No drag-out support** — The primary Notion removal mechanism (drag block out to full-width) is not implemented
3. **Auto-dissolve is correct** but only triggers from backspace, not from drag-out

### Fix
- Remove "Unwrap columns" and "Delete column layout" from the action menu
- Implement drag-out-of-column: when a block inside a column is dragged to a full-width position (blue horizontal guide spans page width), it should be moved to top level. If this leaves only one column, auto-dissolve kicks in.
- The `columnAutoDissolvePlugin` is already correct — it just needs to be triggered by drag operations, not only by backspace

---

## 5. Column Resize

### Notion
> *"Hover over the edges they share with other content and dragging the gray vertical guides that appear left or right."*

**Key rules:**
- Resize handle appears between adjacent columns on hover
- It's a subtle gray vertical line
- Drag left/right to resize
- Proportional resizing of adjacent columns

**Source:** [notion.com/help/columns-headings-and-dividers](https://notion.com/help/columns-headings-and-dividers)

### Parallx
- `columnResizePlugin` detects boundaries between adjacent columns (12px tolerance)
- Hover shows `column-resize-hover` cursor
- Drag resizes adjacent columns proportionally
- Double-click resets to equal widths
- Widths stored as percentage on column node attributes
- Minimum 10%, maximum 90%

### Gap: Mostly aligned
- ✅ Resize on hover between columns
- ✅ Drag to resize
- ✅ Proportional resize
- ✅ Double-click to reset (bonus feature — Notion may or may not have this)
- Minor: Notion uses a gray guide, Parallx uses a blue gradient indicator — cosmetic difference

### Fix
- Consider making the resize indicator gray instead of blue (matches Notion's description)
- Otherwise this is functionally correct

---

## 6. Column Data Model

### Notion API
From [developers.notion.com/reference/block#column-list-and-column](https://developers.notion.com/reference/block#column-list-and-column):

- **`column_list`** — parent block, contains columns. No properties of its own.
- **`column`** — child of column_list. Has `width_ratio` (number between 0 and 1). Contains child blocks (any type except columns).
- Must have **at least 2 columns**, each with **at least 1 child block**.
- Columns **cannot be nested** inside other columns.

### Parallx
- `columnList` node — `group: 'block'`, content: `'column column+'` (2+ columns) ✅
- `column` node — `group: 'columnChild'`, content: `'block+'` (1+ blocks) ✅
- Width stored as percentage attribute ✅ (Notion uses ratio 0-1, we use percentage — functionally equivalent)
- Nesting prevention in slash menu via depth walk ✅
- Nesting prevention in columnDropPlugin via type check ✅

### Gap: Aligned
The data model is correct. No changes needed.

---

## 7. Keyboard Shortcuts

### Notion
| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Shift + ↑/↓` | Move selected block up/down |
| `Cmd/Ctrl + D` | Duplicate block |
| `Esc` | Select the block the cursor is in |
| `Cmd/Ctrl + /` | Edit or change current block |
| `Cmd/Ctrl + Shift + H` | Toggle last text/highlight color used |
| `Tab` | Indent / nest block |
| `Shift + Tab` | Un-indent / unnest block |

**Source:** [notion.com/help/keyboard-shortcuts](https://notion.com/help/keyboard-shortcuts)

### Parallx
| Shortcut | Status |
|----------|--------|
| Cmd/Ctrl + Shift + ↑/↓ | ❌ Not implemented |
| Cmd/Ctrl + D | ✅ Duplicate works (action menu shortcut label shows it) |
| Esc to select block | ❌ Not implemented |
| Cmd/Ctrl + / | ❌ Not implemented |
| Cmd/Ctrl + Shift + H | ❌ Not implemented |
| Tab to indent | Partially (works for lists via TipTap) |
| Shift+Tab to un-indent | Partially (works for lists via TipTap) |

### Gaps
- Block selection (Esc key) is not implemented
- Block movement (Cmd+Shift+Arrows) is not implemented
- These are important for keyboard-centric users and affect column interaction (moving blocks between columns)

### Fix
- Implement Cmd/Ctrl + Shift + ↑/↓ for block movement
- Implement Esc to select block, arrow keys to navigate between blocks
- Implement Cmd/Ctrl + D as a keyboard handler (not just menu label)
- These can be phased — they're important but less critical than the column creation/removal fixes

---

## 8. The + Button

### Notion
Clicking + opens the same block insertion menu as typing `/`. It appears to the left of the ⋮⋮ handle.

### Parallx
Clicking + inserts a paragraph containing "/" which triggers the slash menu. Alt-click inserts above instead of below.

### Gap: Functionally equivalent
The slash-trigger approach is a reasonable implementation. Notion's + button opens a floating menu directly without creating a paragraph first, but the end result (user sees the block type menu) is the same.

### Minor improvement
- Could open the slash menu as a floating panel directly rather than inserting a "/" paragraph, to avoid the brief flash of "/" text on screen. Low priority.

---

## 9. Drag-and-Drop Interaction (Biggest Gap)

### Notion
Drag-and-drop is the **primary interaction model** for structural operations:

1. **Reorder blocks** — drag ⋮⋮ to move above/below other blocks
2. **Create columns** — drag ⋮⋮ to the left/right edge of another block
3. **Add to existing columns** — drag ⋮⋮ into an existing column
4. **Remove from columns** — drag ⋮⋮ out to full-width position
5. **Duplicate via drag** — hold Alt/Option while dragging to copy instead of move

Blue guides during drag:
- **Horizontal line spanning page width** — "drop here as a top-level block"
- **Horizontal line within a column** — "drop here inside this column"
- **Vertical line between blocks** — "create a new column here"

### Parallx
1. **Reorder blocks** — ✅ handled by GlobalDragHandle library
2. **Create columns** — ✅ `columnDropPlugin` handles top-level drag-to-side
3. **Add to existing columns** — ❌ Not supported (plugin only targets top-level blocks)
4. **Remove from columns** — ❌ Not supported (no drag-out logic)
5. **Duplicate via drag** — ❌ Not supported (no Alt+drag behavior)

### Gaps
This is the **single largest gap** between Notion and Parallx. The drag-and-drop system needs significant enhancement:

| Capability | Notion | Parallx | Priority |
|-----------|--------|---------|----------|
| Drag block to create columns | ✅ | ✅ (top-level only) | Fix: extend to all contexts |
| Drag block into existing column | ✅ | ❌ | **High** |
| Drag block out of column | ✅ | ❌ | **High** |
| Drag block between columns | ✅ | ❌ | **High** |
| Alt+drag to duplicate | ✅ | ❌ | Medium |
| Blue guides (horizontal + vertical) | ✅ | Partial (vertical only) | **High** |

### Fix
The `columnDropPlugin` needs a major rewrite to support:
1. Drop targets inside existing columns (not just top-level blocks)
2. Drag-out detection (full-width horizontal guide = top-level drop)
3. Between-column drops
4. Proper blue guide rendering for all drop positions

---

## 10. Summary — Priority Matrix

### Must Fix (Core behavior is wrong)

| # | Issue | What to change |
|---|-------|---------------|
| 1 | **Slash menu "2/3/4 Columns"** | ✅ Keep — Notion has slash menu column creation too. No change needed. |
| 2 | **Action menu has "Column layout" section** | Remove "Unwrap columns", "Duplicate column layout", "Delete column layout" from `_showBlockActionMenu()`. Blocks inside columns should have the same menu as any other block. |
| 3 | **Action menu for columnList shows "Unwrap columns"** | Remove. The ⋮⋮ handle should never target a columnList — it should resolve to the first block inside the first column. Users interact with blocks, not containers. |
| 4 | **Cannot drag blocks into existing columns** | Extend `columnDropPlugin` to allow drops into existing columns. |
| 5 | **Cannot drag blocks out of columns** | Implement drag-out detection: when a block from inside a column is dragged to a full-width position, move it to top level. |

### Should Fix (Interaction quality)

| # | Issue | What to change |
|---|-------|---------------|
| 6 | **Blue guides are incomplete** | Show horizontal guide for above/below positions AND vertical guide for column creation. Currently only vertical indicator exists. |
| 7 | **Cannot drag between columns** | Allow moving a block from one column to another within the same column layout. |
| 8 | **Missing: Cmd+Shift+↑/↓ to move blocks** | Implement keyboard block movement. Notion users expect this. |
| 9 | **Missing: Esc to select block** | Implement block selection via Esc key. |

### Nice to Have (Completeness)

| # | Issue | What to change |
|---|-------|---------------|
| 10 | **Missing: Copy link to block** | Add to action menu. |
| 11 | **Missing: Move to** | Add to action menu (requires page picker). |
| 12 | **Missing: Comment** | Add to action menu (requires comment system). |
| 13 | **Missing: Alt+drag to duplicate** | Hold Alt while dragging to copy instead of move. |
| 14 | **Resize indicator color** | Change from blue gradient to gray (matches Notion's description). |

---

## 11. Current Test Impact

The existing 31 column E2E tests include tests for:
- Slash menu column creation → ✅ **these stay valid** (slash menu columns are correct)
- Action menu "Column layout" section → **these assertions need to be removed/rewritten**
- Block handles inside columns → ✅ these stay valid
- Column resize → ✅ these stay valid  
- Auto-dissolve behavior → ✅ these stay valid (but may need new triggers via drag)
- Backspace protection → ✅ stays valid

A realistic test rewrite will be needed alongside the code changes.

---

## 12. Implementation Order

Based on the priority matrix, recommended order:

**Phase 1 — Remove wrong patterns (clean up)**
1. Remove "Column layout" section from action menu (blocks are blocks regardless of location)
2. Remove special "Unwrap columns" from columnList action menu
3. Make ⋮⋮ handle never target columnList — resolve to first block inside first column
4. Update/remove affected tests

**Phase 2 — Enhance drag-and-drop (core Notion interaction)**
5. Extend columnDropPlugin: drag blocks into existing columns
6. Implement drag-out-of-column to top level
7. Implement drag between columns within same layout
8. Improve blue guide rendering (horizontal + vertical)
9. Write new E2E tests for drag-based column creation/removal

**Phase 3 — Keyboard and polish**
10. Implement Cmd+Shift+↑/↓ block movement
11. Implement Esc to select block
12. Implement Cmd+D as keyboard handler
13. Alt+drag to duplicate
14. Action menu additions (Copy link, Move to, Comment)
