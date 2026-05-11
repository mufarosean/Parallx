# Parallx Database Subsystem — Comprehensive Audit Report

> **Date**: 2025-01-29  
> **Scope**: All files under `src/built-in/canvas/database/`, the inline extension at `src/built-in/canvas/extensions/databaseInlineNode.ts`, and related touch points (`canvasSidebar.ts`, `electron/database.cjs`).  
> **Type**: RESEARCH — no code changes made.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [File Inventory](#2-file-inventory)
3. [Per-File Audit](#3-per-file-audit)
4. [Cross-Cutting Concerns](#4-cross-cutting-concerns)
5. [Inline vs Full-Page Divergences](#5-inline-vs-full-page-divergences)
6. [Hardcoded Icons & Missing Registry Usage](#6-hardcoded-icons--missing-registry-usage)
7. [TODOs, Hacks & Technical Debt](#7-todos-hacks--technical-debt)
8. [CSS Architecture Notes](#8-css-architecture-notes)
9. [Gate Compliance](#9-gate-compliance)
10. [Recommendations](#10-recommendations)

---

## 1. Executive Summary

The database subsystem comprises **22 TypeScript files** + **1 CSS file** inside `src/built-in/canvas/database/`, plus **1 Tiptap extension** in `extensions/databaseInlineNode.ts`. Total source: **~9,700 lines of TypeScript** and **~2,155 lines of CSS**.

The subsystem implements a Notion-style database system with:
- 6 view types (table, board, list, gallery, calendar, timeline)
- 18 property types (including relations, rollups, formulas, unique IDs)
- Compound filter/sort/group pipeline
- Templates with static and dynamic values
- Conditional row coloring
- Database/view locking
- Reciprocal relation sync
- Full formula expression engine (tokenizer → parser → evaluator)
- Both full-page and inline (embedded in canvas) presentation modes

**Key findings**:
- **Icons are hardcoded everywhere** — none use the icon registry
- **`prompt()` used in 2 places** — needs inline editing replacement
- **filterTypes.ts does not exist** — all filter types live in `databaseTypes.ts`
- **The "Search" toolbar button is unimplemented** (placeholder only)
- **Presentation mode divergence** is well-handled via the `'icon' | 'label'` mechanism
- **Gate compliance is clean** — all child files import from `databaseRegistry.js`
- **The inline node** imports from `blockRegistry.js` (the parent canvas gate), not from `databaseRegistry.js` directly — this is correct per the gate hierarchy

---

## 2. File Inventory

### Core (database/)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 1 | `databaseTypes.ts` | 617 | All type definitions |
| 2 | `databaseDataService.ts` | 850 | IPC-bridged CRUD service |
| 3 | `databaseEditorProvider.ts` | 486 | Full-page editor pane |
| 4 | `databaseRegistry.ts` | ~200 | Single import gate |
| 5 | `database.css` | 2,155 | All database CSS |

### Views (database/views/)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 6 | `tableView.ts` | ~500 | Spreadsheet table |
| 7 | `boardView.ts` | 451 | Kanban board |
| 8 | `listView.ts` | 263 | Compact vertical list |
| 9 | `galleryView.ts` | ~260 | Card gallery grid |
| 10 | `calendarView.ts` | 314 | Monthly calendar |
| 11 | `timelineView.ts` | 479 | Gantt-style bars |
| 12 | `viewTabBar.ts` | ~275 | View type tab switching |
| 13 | `databaseToolbar.ts` | 653 | Filter/sort/group/properties toolbar |

### Properties (database/properties/)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 14 | `propertyRenderers.ts` | 469 | Pure cell render functions |
| 15 | `propertyEditors.ts` | 681 | Inline cell editors |
| 16 | `propertyConfig.ts` | ~400 | Property add/rename/type-change UIs |
| 17 | `formulaEngine.ts` | 811 | Formula tokenizer + parser + evaluator |

### Filters (database/filters/)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 18 | `filterEngine.ts` | 583 | Pure filter/sort/group logic |
| 19 | `filterUI.ts` | 458 | FilterPanel with rule editors |

### Relations (database/relations/)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 20 | `relationResolver.ts` | ~310 | Resolution + reciprocal sync |
| 21 | `rollupEngine.ts` | 384 | Rollup aggregation computation |

### Polish (database/polish/)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 22 | `databaseTemplateService.ts` | ~310 | Templates, color rules, locking, unique IDs, visibility |

### Extension (outside database/)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 23 | `extensions/databaseInlineNode.ts` | 620 | Tiptap atom node for inline databases |

### Non-existent file from original list

| File | Status |
|------|--------|
| `filters/filterTypes.ts` | **Does NOT exist** — all filter types live in `databaseTypes.ts` |

---

## 3. Per-File Audit

### 3.1 `databaseTypes.ts` (617 lines)

**Purpose**: All type definitions, interfaces, discriminated unions, and constants for the database subsystem.

**Key exports**:
- `PropertyType` — union of 18 types: `title`, `rich_text`, `number`, `select`, `multi_select`, `status`, `date`, `checkbox`, `url`, `email`, `phone_number`, `files`, `created_time`, `last_edited_time`, `relation`, `rollup`, `formula`, `unique_id`
- `IPropertyValue` — discriminated union (one variant per `PropertyType`)
- `IDatabase` — `{ id, pageId, isLocked, createdAt, updatedAt }` where `id === pageId` (DD-0 constraint)
- `IDatabaseProperty` — `{ id, databaseId, name, type, config, visibility, sortOrder }`
- `IDatabaseRow` — `{ page: IPageReference, sortOrder, values: Record<string, IPropertyValue> }`
- `IDatabaseView` — `{ id, databaseId, name, type, config, isLocked, sortOrder }`
- `IDatabaseViewConfig` — includes `sourceDatabaseId` for linked views, `visibleProperties`, `columnWidths`, `boardGroupProperty`, `dateProperty`, `dateEndProperty`, `cardSize`, `defaultTemplateId`, plus filter/sort/group configs
- `IFilterRule`, `IFilterGroup` — compound filter tree with AND/OR conjunction
- `ISortRule` — `{ propertyId, direction }`
- `DatabaseChangeKind` — enum for change events
- `IDatabaseDataService` — full CRUD interface
- `IDatabaseTemplate`, `TemplatePropertyValue` — template types with `'static' | 'dynamic'` mode
- `PropertyVisibility` — `'always_show' | 'always_hide' | 'hide_when_empty'`
- `IColorRule` — conditional row coloring
- `FILTER_OPERATORS_BY_TYPE` — operators available per property type

**Imports**: Type-only from `platform/events.js` and `canvasTypes.js`.

**Notable design decisions**:
- Database ID always equals page ID (same UUID)
- `sourceDatabaseId` on view config enables "linked views" (view into another db)
- `PropertyVisibility` and `IColorRule` support page-top property bars and conditional coloring
- Templates support dynamic tokens (`'now'` | `'today'`)

**Issues**: None.

---

### 3.2 `databaseDataService.ts` (850 lines)

**Purpose**: Renderer-side CRUD service wrapping Electron IPC calls. Implements `IDatabaseDataService`.

**Key class**: `DatabaseDataService extends Disposable`

**Key exports**:
- `DatabaseDataService` — the main service
- `rowToDatabase()`, `rowToProperty()`, `rowToView()`, `rowToPage()`, `parsePropertyValue()` — marked `@internal`, exported for testing

**Events**: `onDidChangeDatabase`, `onDidChangeProperty`, `onDidChangeRow`, `onDidChangeView`

**IPC bridge**: Private `_db` accessor returns `window.parallxElectron.database` with methods `run()`, `get()`, `all()`, `runTransaction()`.

**Notable implementation details**:
- `createDatabase()` — transaction creating database + default "Name" title property + default "Table" view
- `addRow()` — creates page via IPC if no `pageId` provided, populates default property values, uses `encodeCanvasContentFromDoc`
- `_defaultPropertyValue()` — helper factory for all 18 property types
- `removeRow()` — explicitly deletes `page_property_values` in transaction (SQL CASCADE doesn't cover this join table)
- `getDatabasePageIds()` — used by sidebar for efficient database detection
- `getPropertyValues()` — returns `Record<string, IPropertyValue>` for a single page
- `getDatabaseByPageId()` — lookup by page ID (useful since database.id === pageId)

**Issues**:
- The `removeRow` explicit `page_property_values` cleanup suggests a schema design where CASCADE couldn't be used — worth documenting why.

---

### 3.3 `databaseEditorProvider.ts` (486 lines)

**Purpose**: Full-page database editor pane, registered as editor type `'database'`.

**Key classes**:
- `DatabaseEditorProvider` — factory, creates `DatabaseEditorPane` instances
- `DatabaseEditorPane extends Disposable` — per-tab instance

**DOM layout skeleton**:
```
.database-editor
  ├── .database-editor-page-header
  │     ├── .database-editor-page-icon  →  '🗂️'  (HARDCODED)
  │     └── h1.database-editor-title    →  contenteditable
  ├── .database-editor-toolbar
  │     ├── .db-toolbar-container
  │     └── .db-toolbar-panels
  └── .database-editor-content
        └── (active view: TableView | BoardView | …)
```

**Toolbar creation**: `new DatabaseToolbar(…, undefined, 'label')` — passes `undefined` for custom icons (uses text fallbacks) and `'label'` for presentation mode (full text labels on buttons).

**Hardcoded icon**: `pageIcon.textContent = '🗂️'` — NOT from icon registry.

**View switching**: Supports all 6 view types via `_renderActiveView()`. Uses `applyViewDataPipeline()` for filter → sort → group before passing to views.

**`_getVisibleProperties()`**: Always includes the title property even if not in `visibleProperties` list.

**`setOpenEditor()`**: Injected externally for navigation between pages.

**Live updates**: Listens for `onDidChangeRow`, `onDidChangeProperty`, `onDidChangeView`.

---

### 3.4 `databaseRegistry.ts` (~200 lines)

**Purpose**: Single import gate for the entire database subsystem.

**Re-exports from**:
- `databaseTypes.ts` — all types and constants
- `propertyRenderers.ts` — `renderPropertyValue`
- `propertyEditors.ts` — `createPropertyEditor`, `IRelationCandidate`
- `propertyConfig.ts` — `showPropertyAddMenu`, `showPropertyHeaderMenu`, etc.
- `tableView.ts`, `boardView.ts`, `listView.ts`, `galleryView.ts`, `calendarView.ts`, `timelineView.ts` — view classes
- `viewTabBar.ts` — `ViewTabBar`
- `databaseToolbar.ts` — `DatabaseToolbar`, `DatabaseToolbarPresentation`
- `filterEngine.ts` — `evaluateFilter`, `applySorts`, `groupRows`, `applyViewDataPipeline`
- `filterUI.ts` — `FilterPanel`
- `relationResolver.ts` — `resolveRelation`, `getRelationCandidates`, etc.
- `rollupEngine.ts` — `evaluateRollupFunction`, `computeRollup`, etc.
- `formulaEngine.ts` — `evaluateFormula`, `parseFormula`, `FormulaError`
- `databaseTemplateService.ts` — templates, color rules, locking, unique IDs, visibility

**Gate pattern**: Uses live `export { X } from '…'` syntax for safe circular resolution. Header comment lists all gated children.

---

### 3.5 `database.css` (2,155 lines)

**Purpose**: All database styles in one file.

**Section breakdown** (by line range):

| Lines | Section |
|-------|---------|
| 1–50 | `.database-editor` — full-page layout, page header, title |
| 50–100 | View tab bar |
| 100–450 | Table view — header, body, footer, column resize, cells |
| 450–700 | Cell renderers — all 18 types with pills, colors, truncation |
| 700–900 | Cell editors, property header config, empty state, sidebar icon |
| 900–1000 | Toolbar (`.db-toolbar`), filter panel, sort panel |
| 1000–1100 | Group panel, properties visibility panel |
| 1100–1400 | Board view — columns, cards, cover images, drag states |
| 1400–1500 | Sort/board drag-to-reorder indicators |
| 1500–1650 | List view |
| 1650–1750 | Gallery view — grid, cards, cover, footer |
| 1750–1900 | Calendar view — grid, cells, items, today highlight |
| 1900–2000 | Timeline view — scale toggle, axis, bars, handles |
| 2000–2155 | **Inline database** — wrapper, header, title, toolbar overrides, content, resize handle |

**Inline database CSS overrides** (lines 2000–2155):
- `.db-inline-wrapper` — `position: relative; margin: 8px 0; min-height: 120px`
- `.db-inline-title` — `font-size: 40px` (same as full-page), `contentEditable`, focus ring
- `.db-inline-tab-bar` — `display: none` (tabs hidden in inline mode)
- `.db-inline-toolbar .db-toolbar-btn-label` — `display: none` (hides text labels, icons only)
- `.db-inline-toolbar .db-toolbar-spacer` — `display: none`
- `.db-inline-content` — `max-height: 500px; overflow: auto`
- `.db-inline-content .database-table-wrapper, .db-board-wrapper, …` — `border: none; border-radius: 0; margin: 0` (strips wrapper chrome)
- `.db-inline-resize-handle` — 6px bottom resize handle with focus-border color on hover

---

### 3.6 `views/tableView.ts` (~500 lines)

**Purpose**: Spreadsheet-like table with header row, body rows, footer, and column resize.

**Key class**: `TableView extends Disposable`

**Key behaviors**:
- Column resize → saves widths to `view.config.columnWidths` via `updateView()`
- Title column click → opens canvas editor (not database editor)
- Checkbox → immediate toggle on click (no editor popup)
- Sort indicators → arrows in header cells
- Group rendering → collapsible group headers with color dots, supports sub-groups
- Default column width: **200px** hardcoded
- `"+ Add property"` column always appended
- `"+ New"` footer button for adding rows

---

### 3.7 `views/boardView.ts` (451 lines)

**Purpose**: Kanban board with columns per option value.

**Key class**: `BoardView extends Disposable`

**Group property resolution**: Uses `boardGroupProperty` > `groupBy` > first `select`/`status` property.

**Drag-drop**: Full cross-column drag support — dropping a card into another column updates the group property value via `setPropertyValue()`.

**Card rendering**: Shows cover image (via `--db-cover-url` CSS variable), title, and up to 3 preview properties.

**Column features**: Collapse toggle, card count badge, "+" add-row-to-column button.

**Drop indicators**: `db-board-card--drop-before` / `db-board-card--drop-after` CSS classes.

---

### 3.8 `views/listView.ts` (263 lines)

**Purpose**: Compact vertical list, one row per page.

**Key class**: `ListView extends Disposable`

**Rendering**: Shows title + first 3 non-title properties as inline previews. Supports groups and sub-groups with collapsible headers.

**Interaction**: Click row → opens page in canvas editor via `_openEditor`.

---

### 3.9 `views/galleryView.ts` (~260 lines)

**Purpose**: Card gallery in responsive CSS grid.

**Key class**: `GalleryView extends Disposable`

**Card sizes** (from `view.config.cardSize`):
- `small` → 4 columns
- `medium` → 3 columns (default)
- `large` → 2 columns

**Card content**: Cover image, icon, title, up to 3 preview properties.

**Groups**: Supports collapsible group headers with sub-groups.

---

### 3.10 `views/calendarView.ts` (314 lines)

**Purpose**: Monthly calendar grid (7 columns × 5–6 rows).

**Key class**: `CalendarView extends Disposable`

**Date property resolution**: Uses `view.config.dateProperty` or falls back to first `date` property.

**Features**:
- Month navigation (prev/next/today)
- Up to 3 items per cell, then "+N more" overflow
- Click day → creates new row with that date pre-filled
- Click item → opens page editor
- Other-month cells rendered at 40% opacity

**Hardcoded values**: `DAY_NAMES` starts on Sunday (US locale).

---

### 3.11 `views/timelineView.ts` (479 lines)

**Purpose**: Gantt-style horizontal bars on a time axis.

**Key class**: `TimelineView extends Disposable`

**Scale modes**: `day` (40px/day), `week` (12px/day), `month` (3px/day).

**Date properties**:
- Start date: `view.config.dateProperty` or first date property
- End date: `view.config.dateEndProperty` or second date property

**Features**:
- Drag bar handles to adjust start/end dates → persists via `setPropertyValue()`
- Auto-computed view bounds (3 months centered on today, expanded to fit data)
- Row labels on left side (fixed 200px width)
- Scroll container for the full timeline width

**Hardcoded constants**: `ROW_HEIGHT = 36`, `HEADER_HEIGHT = 50`, `LABEL_WIDTH = 200`.

---

### 3.12 `views/viewTabBar.ts` (~275 lines)

**Purpose**: Tab bar for switching between database views.

**Key class**: `ViewTabBar extends Disposable`

**Wraps**: Generic `TabBar` component from `ui/tabBar.js`.

**Hardcoded view type icons**:
```ts
{ table: '⊞', board: '☰', list: '≡', gallery: '⊟', calendar: '📅', timeline: '⟿' }
```
**NOT from icon registry.**

**Features**:
- Tab reorder via drag
- Double-click to rename → uses `prompt()` (**known polish issue**)
- Right-click context menu: Rename / Duplicate / Delete
- "+" button to create new views (dropdown with type selection)

**Events**: `onDidSelectView`, `onDidCreateView`.

---

### 3.13 `views/databaseToolbar.ts` (653 lines)

**Purpose**: Toolbar row for filter, sort, grouping, property visibility, search, and "New" button.

**Key class**: `DatabaseToolbar extends Disposable`

**Presentation mode**: `DatabaseToolbarPresentation = 'icon' | 'label'`
- `'label'` → used by full-page editor (text labels on buttons)
- `'icon'` → used by inline node (icon-only buttons)

**`IDatabaseToolbarIcons` interface**:
```ts
{ filter?: string, sort?: string, group?: string, search?: string, settings?: string }
```
When custom icons are provided as HTML strings, they're used as `innerHTML`. Otherwise, hardcoded fallbacks:
```
'≡' (filter), '↕' (sort), '⚡' (group), '⌕' (search), '⚙' (settings)
```

**Panels**: 
- Filter → delegates to `FilterPanel`
- Sort → full drag-reorder UI with direction toggle
- Group → group-by + sub-group-by + hide-empty toggle
- Properties → visibility toggles + drag reorder

**Events**: `onDidUpdateView`, `onDidRequestNewRow`.

**`setCollapsed()`**: Applies `db-toolbar--collapsed` class (used by inline mode's collapse toggle).

**Hardcoded groupable types**: `select`, `multi_select`, `status`, `checkbox`, `date`, `created_time`, `last_edited_time`, `number`.

**TODO**: Search button comment: `"Search UI to be wired in a future slice"`.

**"New ▾" button**: Has dropdown indicator but currently just fires `onDidRequestNewRow` with no template selection.

---

### 3.14 `properties/propertyRenderers.ts` (469 lines)

**Purpose**: Pure cell renderer functions — no side effects, no DOM events.

**Key export**: `renderPropertyValue()` — dispatch function by property type.

**Individual renderers**: `renderTitle`, `renderRichText`, `renderNumber`, `renderSelect`, `renderMultiSelect`, `renderStatus`, `renderDate`, `renderCheckbox`, `renderUrl`, `renderEmail`, `renderPhone`, `renderFiles`, `renderTimestamp`, `renderUniqueId`, `renderRelation`, `renderRollup`, `renderFormula`.

**Hardcoded values**:
- `EMPTY_PLACEHOLDER = 'Empty'`
- Title icon: `'📄'` in `renderTitle()`
- Pill color classes: `db-cell-pill--{color}` with 10 Notion-inspired colors

**Number formatting**: Supports `dollar`, `euro`, `pound`, `yen`, `yuan`, `percent`, `with_commas`.

**Date formatting**: Relative time for recent dates (`Just now`, `5m ago`, `3h ago`, `2d ago`), then `en-US` locale string.

**Relation**: Renders pills with resolved page titles or truncated IDs (8 chars).

**Rollup/Formula**: Dispatches rendering based on output type (number → number renderer, date → date renderer, array → comma-joined, etc.).

---

### 3.15 `properties/propertyEditors.ts` (681 lines)

**Purpose**: Inline cell editors for each editable property type.

**IPropertyEditor interface**: `onDidChange`, `onDidDismiss`, `focus()`.

**Editor classes**:
| Class | Type(s) | Widget |
|-------|---------|--------|
| `TextInputEditor` | title, rich_text, url, email, phone | `<input>` with type variant |
| `NumberEditor` | number | `<input type="number">` with step/min/max from config |
| `CheckboxEditor` | checkbox | Immediate toggle, instant dismiss |
| `SelectEditor` | select | ContextMenu dropdown |
| `MultiSelectEditor` | multi_select | ContextMenu with checkmarks |
| `StatusEditor` | status | ContextMenu dropdown |
| `DateEditor` | date | `<input type="date">` with native picker |
| `FilesEditor` | files | URL input, appends `external` file reference |
| `RelationEditor` | relation | ContextMenu of candidate pages with toggle |

**Read-only types** (no editor): `created_time`, `last_edited_time`, `rollup`, `formula`, `unique_id`.

**Dispatch function**: `createPropertyEditor()` — returns `IPropertyEditor | null`.

**Relation editor**: Receives pre-fetched `IRelationCandidate[]` from caller (editor has no data service access).

---

### 3.16 `properties/propertyConfig.ts` (~400 lines)

**Purpose**: Property add/rename/type-change/delete/configuration UIs.

**Key exports**:
- `showPropertyAddMenu()` — context menu for adding a new property
- `showPropertyHeaderMenu()` — right-click menu on column header (rename/type/delete)
- `startPropertyRename()` — inline rename overlay
- `showNumberFormatMenu()` — format picker sub-menu
- `showOptionListEditor()` — add/rename/recolor/delete options for select/multi_select/status
- `PROPERTY_TYPE_LABELS` — display names for all 18 types
- `PROPERTY_TYPE_ICONS` — hardcoded icons for all 18 types

**Hardcoded type icons**:
```ts
{
  title: 'Aa', rich_text: 'T', number: '#', select: '▾', multi_select: '⊞',
  status: '◉', date: '📅', checkbox: '☑', url: '🔗', email: '✉',
  phone_number: '☎', files: '📎', created_time: '↗', last_edited_time: '↗',
  relation: 'Σ', rollup: 'Σ', formula: 'ƒ', unique_id: 'ID'
}
```
**NOT from icon registry.**

**Creatable types** (shown in add menu) exclude: `title`, `relation`, `rollup`, `formula`, `created_time`, `last_edited_time`, `unique_id`.

**`DEFAULT_OPTION_COLORS`**: 10 colors cycled for new options: `blue`, `green`, `orange`, `red`, `purple`, `pink`, `yellow`, `gray`, `brown`, `default`.

**TODO**: `_addNewOption` uses `prompt('Option name:')` with comment `// TODO: replace with inline input overlay`.

---

### 3.17 `properties/formulaEngine.ts` (811 lines)

**Purpose**: Complete formula expression language — tokenizer, recursive-descent parser, evaluator, type inference.

**Grammar** (from code comments):
```
expression     = comparison
comparison     = addition (('==' | '!=' | '<' | '<=' | '>' | '>=') addition)*
addition       = multiplication (('+' | '-') multiplication)*
multiplication = unary (('*' | '/' | '%') unary)*
unary          = ('-' | '+') unary | call
call           = identifier '(' arglist? ')' | primary
primary        = number | string | boolean | '(' expression ')'
```

**Built-in functions** (36 total):
- **Conditional**: `if`, `ifs`
- **Arithmetic**: `abs`, `ceil`, `floor`, `round`, `min`, `max`, `sqrt`
- **String**: `length`, `contains`, `replace`, `replaceall`, `concat`, `join`, `slice`, `lower`, `upper`, `trim`
- **Date**: `now`, `today`, `dateadd`, `datesubtract`, `datebetween`, `formatdate`, `minute`, `hour`, `day`, `month`, `year`
- **Logical**: `and`, `or`, `not`, `empty`, `equal`, `unequal`
- **Type conversion**: `tonumber`, `toboolean`

**Special function**: `prop("PropertyName")` — resolved via `PropertyResolver` callback.

**Public API**:
- `evaluateFormula(expression, rowValues, properties)` → `IFormulaResult`
- `parseFormula(expression)` → `{ ast, outputType }` or `{ error }`
- `extractPropReferences(ast)` → `string[]` (dependency analysis)
- `inferOutputType(ast)` → `FormulaOutputType`

**Error handling**: `FormulaError` class with optional position. Evaluation catches all errors and returns `{ type: 'string', value: null, error: message }`.

---

### 3.18 `filters/filterEngine.ts` (583 lines)

**Purpose**: Pure filter evaluation, sort application, and row grouping. No DOM, no side effects.

**Key exports**:
- `evaluateFilter(row, filterGroup, properties)` → `boolean`
- `applySorts(rows, sorts, properties)` → `IDatabaseRow[]`
- `groupRows(rows, view, properties)` → `IRowGroup[]`
- `applyViewDataPipeline(rows, view, properties)` → `{ sortedRows, groups }`

**IRowGroup**: `{ key, label, color?, rows, subGroups? }`

**Filter evaluation**: Supports compound filter trees (AND/OR conjunction, nested groups). All text comparison is case-insensitive.

**Date operators**: Include `is_within` with relative periods (`past_week`, `this_week`, `next_week`, `past_month`, `next_month`, `past_year`, `next_year`).

**`_startOfWeek()`**: Assumes Sunday as week start (US locale).

**Sort behavior**: Nulls/empty values sort to bottom; stable fallback by `sortOrder`.

**Grouping**: Respects option order for Select/Status types; "No value" group for unset values. Supports sub-groups (group-by + sub-group-by).

---

### 3.19 `filters/filterUI.ts` (458 lines)

**Purpose**: FilterPanel UI widget for building filter rules.

**Key class**: `FilterPanel extends Disposable`

**Events**: `onDidChangeFilter` → fires `IFilterGroup`

**Rendering**: Each rule rendered as a row with property picker, operator picker, and value input. Conjunction selector (AND/OR) at the top.

**Limitations**: Comment in code: `"Flat rules only for now; advanced nesting is Phase 3+ polish"`.

**Helpers**:
- `_isFilterGroup()` — type guard
- `_deepCopyFilter()` — JSON round-trip copy
- `_relativePeriodLabel()` — display labels for relative date periods

---

### 3.20 `relations/relationResolver.ts` (~310 lines)

**Purpose**: Relation property resolution, link mutation, and reciprocal sync.

**Key exports**:
- `resolveRelation(dataService, property, value)` → `IResolvedRelation[]` — expand IDs to page titles
- `getRelationCandidates(dataService, property, currentValue)` → `IRelationCandidate[]` — all pages in target database with `isLinked` flag
- `addRelationLink(currentValue, targetPageId)` → `IPropertyValue`
- `removeRelationLink(currentValue, targetPageId)` → `IPropertyValue`
- `toggleRelationLink(currentValue, targetPageId)` → `{ value, added }`
- `createReciprocalRelation(dataService, sourceProperty, sourceDatabaseId, targetDatabaseId)` — creates mirror property
- `syncReciprocal(dataService, sourceProperty, sourcePageId, targetPageId, added)` — updates reciprocal side
- `setRelationWithSync(…)` — primary entry point for relation mutations
- `isSelfRelation(property)` → `boolean`
- `getSelfRelationCandidates(…)` — excludes current page from self-referential candidates

**Design**: Reciprocal properties reference each other via `syncedPropertyId` in `IRelationPropertyConfig`.

---

### 3.21 `relations/rollupEngine.ts` (384 lines)

**Purpose**: Rollup property aggregation computation.

**Resolution chain** (per row):
1. Read rollup config (relation property → target property → function)
2. Read relation value for this row (linked page IDs)
3. Fetch rows from related database
4. Extract target property value from each linked row
5. Apply aggregation function

**Supported rollup functions** (24 total):
- **Count**: `count`, `count_values`
- **Numeric**: `sum`, `average`, `median`, `min`, `max`, `range`
- **Date**: `earliest_date`, `latest_date`, `date_range`
- **Checkbox**: `checked`, `unchecked`, `percent_checked`, `percent_unchecked`
- **Emptiness**: `empty`, `not_empty`, `percent_empty`, `percent_not_empty`
- **Collection**: `show_original`, `show_unique`, `unique`

**Batch API**: `computeRollups(dataService, databaseId, rows, properties)` → `Map<pageId, Map<propId, IRollupResult>>`

**Conversion**: `rollupResultToPropertyValue(result)` → `IPropertyValue` for storage/display.

---

### 3.22 `polish/databaseTemplateService.ts` (~310 lines)

**Purpose**: Templates, conditional coloring, locking guards, unique ID auto-increment, and property page-top visibility.

**Templates**:
- `resolveTemplateValue(tv)` — resolves `'now'` and `'today'` tokens to `IPropertyValue`
- `applyTemplate(template, properties)` → `Record<string, IPropertyValue>`
- `selectTemplate(templates, view)` — priority: view's default > single template > undefined
- `createTemplate(…)` — in-memory template object factory

**Conditional Color**:
- `evaluateColorRules(colorRules, row, properties)` → `string | undefined` (first matching color name)
- `colorRuleToStyle(color)` → CSS style string using `var(--db-row-color-{color})` with fallbacks
- Fallback colors: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `gray` at 8% opacity

**Locking**:
- `isDatabaseLocked(database)` / `isViewLocked(view)` → `boolean`
- `assertDatabaseNotLocked(database)` / `assertViewNotLocked(view)` — throws if locked

**Unique ID**:
- `computeNextUniqueId(rows, uniqueIdProperty)` — scans all rows, returns max + 1
- `makeUniqueIdValue(nextNumber, prefix)` → `IPropertyValue`
- `formatUniqueId(prefix, num)` → `"TASK-42"` or `"42"`

**Property Visibility**:
- `isPropertyVisibleOnPage(visibility, value)` → `boolean`
- `getPropertyBarData(dataService, pageId)` → `{ properties, values }` for the page-top bar (scans all databases if not a database page itself — noted as expensive)

---

### 3.23 `extensions/databaseInlineNode.ts` (620 lines)

**Purpose**: Tiptap atom node that embeds a database view inline within a canvas page.

**Key class**: `DatabaseInlineNodeView` — Tiptap NodeView implementation.

**Gate**: Imports from `blockRegistry.js` (the **canvas** gate), not from `databaseRegistry.js` directly. This is correct — the inline node is a canvas extension, not a database child.

**Tiptap node definition**:
- Name: `databaseInline`
- Group: `block`, Atom: `true`, Draggable: `true`
- Attributes: `databaseId`, `databaseTitle` (default `'New database'`), `viewId`
- HTML: `<div data-database-id="..." data-database-title="..." [data-view-id="..."]>`

**DOM structure**:
```
.db-inline-wrapper
  ├── .db-inline-header
  │     ├── span.db-inline-title      →  contenteditable, blur saves
  │     ├── .db-inline-toolbar        →  DatabaseToolbar(…, svgIcons, 'icon')
  │     ├── .db-inline-tab-bar        →  ViewTabBar (hidden by CSS)
  │     └── .db-inline-header-actions
  │           ├── .db-inline-toolbar-toggle  →  collapse/expand toolbar
  │           └── .db-inline-expand-btn      →  "Open as full page"
  ├── .db-inline-toolbar-panels       →  filter/sort/group panels expand here
  ├── .db-inline-content              →  active view renders here
  └── .db-inline-resize-handle        →  vertical resize
```

**Toolbar creation** (contrast with full-page):
```ts
new DatabaseToolbar(
  toolbarContainer,
  view,
  this._properties,
  toolbarPanelContainer,
  {
    filter: svgIcon('db-filter'),
    sort: svgIcon('db-sort'),
    group: svgIcon('db-group'),
    search: svgIcon('search'),
    settings: svgIcon('db-settings'),
  },
  'icon',   // ← icon-only presentation
);
```

**Linked views**: Supports `sourceDatabaseId` — loads rows from the source database if the first view has a `sourceDatabaseId` config.

**Inline title editing**: `contentEditable = 'true'`, Enter blurs, blur saves via `_updateNodeAttrs({ databaseTitle: nextTitle })`.

**Resize handle**: Mouse drag on bottom edge, minimum height 120px.

**"Open as full page"**: `_openEditor({ typeId: 'database', title: 'Database', instanceId: this._databaseId })`.

**ProseMirror integration**: `stopEvent()` returns `true` (prevents PM from handling events inside), `ignoreMutation()` returns `true`, `update()` checks for attribute changes.

---

## 4. Cross-Cutting Concerns

### 4.1 Data Flow

```
User interaction
  → View class (TableView/BoardView/etc.)
    → DatabaseDataService.setPropertyValue() / addRow() / etc.
      → window.parallxElectron.database.run() (IPC to main process)
        → SQLite (better-sqlite3)
  ← Change event fires (onDidChangeRow/Property/View)
    ← View re-renders with updated data
```

### 4.2 Filter/Sort/Group Pipeline

```
Raw rows from DB
  → applyViewDataPipeline(rows, view, properties)
    → evaluateFilter() for each row
    → applySorts() on passing rows
    → groupRows() if groupBy configured
  ← { sortedRows, groups }
```

Both the full-page editor and inline node call `applyViewDataPipeline()` before passing data to views.

### 4.3 Shared View Interface

All 6 view classes implement the same informal contract:
```ts
interface IManagedView {
  setRows(rows: IDatabaseRow[], groups?: IRowGroup[]): void;
  setProperties(properties: IDatabaseProperty[]): void;
  dispose(): void;
}
```

This is explicitly typed in `databaseInlineNode.ts` and implicitly followed by `databaseEditorProvider.ts`.

### 4.4 Sidebar Integration

`canvasSidebar.ts` imports `IDatabaseDataService` from the database registry. It:
- Maintains `_databasePageIds: Set<string>` populated via `getDatabasePageIds()`
- Shows "New Database" option in the add-page context menu (icon: `'📊'` — also hardcoded)
- Uses the set for efficient detection of which sidebar pages are databases

---

## 5. Inline vs Full-Page Divergences

| Aspect | Full-Page (`databaseEditorProvider.ts`) | Inline (`databaseInlineNode.ts`) |
|--------|---------------------------------------|----------------------------------|
| **Root class** | `.database-editor` | `.db-inline-wrapper` |
| **Title** | `<h1>` with `contenteditable` | `<span>` with `contenteditable` |
| **Title font** | CSS-controlled (via `.database-editor-title`) | `font-size: 40px` in CSS |
| **Icon** | `'🗂️'` hardcoded emoji | None (no icon in inline header) |
| **Toolbar presentation** | `'label'` (text labels) | `'icon'` (icons only) |
| **Toolbar icons** | `undefined` (uses text fallbacks: `'≡'`, `'↕'`, etc.) | `svgIcon('db-filter')`, `svgIcon('db-sort')`, etc. (SVG icons) |
| **Toolbar collapse** | Not implemented | Toggle button in header actions |
| **Tab bar** | Visible, full ViewTabBar | Tab bar **hidden** by CSS (`display: none`) but still created |
| **"Open as full page"** | N/A (already full page) | Expand button → opens `typeId: 'database'` editor |
| **Resize** | Browser window resize | Bottom drag handle, min 120px |
| **Content overflow** | Browser scroll | `max-height: 500px; overflow: auto` |
| **View wrappers** | Full chrome (borders, border-radius, margin) | Chrome stripped: `border: none; border-radius: 0; margin: 0` |
| **Live updates** | Direct event listeners on data service | Same pattern, in `_loadDatabase()` |
| **Linked views** | Standard view switching | Supports `sourceDatabaseId` for loading rows from another database |
| **ProseMirror** | None | Full atom node integration (`stopEvent`, `ignoreMutation`, `update`) |

**Key divergence detail**: The inline toolbar gets **proper SVG icons** via `svgIcon()` from the icon system, while the full-page editor uses **text fallback characters**. This is inconsistent — the full-page editor should also use SVG icons.

**CSS-level divergences**:
- `.db-inline-toolbar .db-toolbar-btn-label { display: none }` hides text labels
- `.db-inline-toolbar .db-toolbar-spacer { display: none }` hides spacer
- `.db-inline-tab-bar { display: none }` hides the entire tab bar
- `.db-toolbar--collapsed { display: none }` enables the collapse feature

---

## 6. Hardcoded Icons & Missing Registry Usage

Every icon in the database subsystem is hardcoded. None use the icon registry.

| Location | Icon | Context |
|----------|------|---------|
| `databaseEditorProvider.ts` | `'🗂️'` | Full-page editor page header |
| `propertyRenderers.ts` | `'📄'` | Title cell renderer |
| `propertyConfig.ts` | `'Aa'`, `'T'`, `'#'`, `'▾'`, `'⊞'`, `'◉'`, `'📅'`, `'☑'`, `'🔗'`, `'✉'`, `'☎'`, `'📎'`, `'↗'`, `'Σ'`, `'ƒ'`, `'🕐'`, `'ID'` | Property type icons in add/config menus |
| `viewTabBar.ts` | `'⊞'`, `'☰'`, `'≡'`, `'⊟'`, `'📅'`, `'⟿'` | View type tab icons |
| `databaseToolbar.ts` | `'≡'`, `'↕'`, `'⚡'`, `'⌕'`, `'⚙'` | Toolbar button fallbacks |
| `canvasSidebar.ts` | `'📊'` | "New Database" menu item |
| `databaseInlineNode.ts` | `svgIcon('db-collapse')`, `svgIcon('db-expand')`, `svgIcon('open')`, `svgIcon('db-filter')`, `svgIcon('db-sort')`, `svgIcon('db-group')`, `svgIcon('search')`, `svgIcon('db-settings')` | Inline toolbar (uses `svgIcon` but NOT the icon registry) |

**Note**: The inline node uses `svgIcon()` from the block registry, which is the canvas-level SVG icon system. This is different from the Parallx icon registry documented in `ICON_REGISTRY.md`. All other database files use plain text/emoji characters.

---

## 7. TODOs, Hacks & Technical Debt

| File | Issue | Severity |
|------|-------|----------|
| `databaseToolbar.ts` | Search button is a placeholder: `"Search UI to be wired in a future slice"` | Low |
| `viewTabBar.ts` | Rename uses `prompt()` instead of inline tab rename | Medium |
| `propertyConfig.ts` | `_addNewOption` uses `prompt('Option name:')` with `// TODO: replace with inline input overlay` | Medium |
| `databaseToolbar.ts` | "New ▾" button fires event but has no template selection dropdown | Low |
| `filterUI.ts` | `"Flat rules only for now; advanced nesting is Phase 3+ polish"` | Low |
| `databaseEditorProvider.ts` | Full-page toolbar uses text fallbacks instead of SVG icons | Medium |
| `databaseTemplateService.ts` | `getPropertyBarData()` scans ALL databases on page open — noted as expensive | Medium |
| `filterEngine.ts` | `_startOfWeek()` hardcodes Sunday as week start | Low |
| `calendarView.ts` | `DAY_NAMES` hardcodes Sunday-first | Low |
| `databaseDataService.ts` | `removeRow` explicit `page_property_values` cleanup (CASCADE gap) | Low |
| `timelineView.ts` | Drag handle `mouseup` adds/removes listeners on `document` — no cleanup on component dispose mid-drag | Low |
| `databaseInlineNode.ts` | `.db-inline-tab-bar` is created but hidden by CSS — should either be used or not created | Low |

---

## 8. CSS Architecture Notes

- **Single file**: All 2,155 lines in one `database.css` — no CSS modules or scoping
- **Naming**: BEM-lite convention (`db-{component}`, `db-{component}--{modifier}`, `db-{component}-{element}`)
- **Theming**: Consistently uses VS Code CSS variables (`--vscode-foreground`, `--vscode-list-hoverBackground`, etc.) with hardcoded `rgba()` fallbacks
- **Inline section**: Lines 2000–2155 override child component styles when inside `.db-inline-wrapper` / `.db-inline-toolbar`
- **No dark/light split**: Single theme approach via CSS variables (inherits VS Code theme automatically)
- **Custom property**: `--db-cover-url` used for board card and gallery card cover images
- **Color rule variables**: `--db-row-color-{name}` for conditional row coloring
- **Pill colors**: 10 hardcoded colors matching Notion: `default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`

---

## 9. Gate Compliance

**Status: Clean** ✓

All 22 database child files import exclusively from `databaseRegistry.js` (or peer files within the database directory via relative imports).

The inline node (`databaseInlineNode.ts`) imports from `blockRegistry.js` which is the canvas gate — this is correct because the inline node is a canvas extension, not a database child. The block registry re-exports the necessary database symbols.

The gate file (`databaseRegistry.ts`) uses live `export { X } from '…'` syntax for safe circular resolution.

---

## 10. Recommendations

1. **Migrate hardcoded icons to the icon registry** — All 30+ hardcoded icons/emojis should be registered with the icon registry for consistency and theme support. Priority: property type icons (used in menus) and view type icons (used in tab bar).

2. **Replace `prompt()` calls** — Two instances need inline editing: view tab rename and option creation.

3. **Add SVG icons to full-page editor toolbar** — The inline node already uses `svgIcon()` for toolbar buttons. The full-page editor should match.

4. **Implement search** — The search button placeholder in the toolbar should either be implemented or hidden.

5. **Optimize `getPropertyBarData()`** — The "scan all databases" fallback is expensive. Consider a reverse index or caching layer.

6. **Locale-aware week start** — Both `filterEngine.ts` and `calendarView.ts` hardcode Sunday as week start. Should respect user locale.

7. **Consider splitting `database.css`** — At 2,155 lines, consider splitting into per-view CSS files or using CSS modules for better maintainability.

8. **Formalize `IManagedView` interface** — The shared view contract is implicit in the editor provider. Import it from the types file for type safety in both hosts.

9. **Evaluate creation of a `filterTypes.ts`** — The user expected this file to exist. Consider splitting filter-related types out of `databaseTypes.ts` if the file continues to grow.

10. **Wire template selection on "New ▾"** — The toolbar's new-row button shows a dropdown indicator but doesn't offer template selection.
