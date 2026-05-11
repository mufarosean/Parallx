# Database Views — Comprehensive Research

> **Purpose**: Deep research on Notion-like databases — data model, property types,
> views, filters, relations, formulas, inline rendering, and how all of this maps
> to Parallx's existing architecture.
>
> **Sources**: Notion Help Center, Thomas Frank's Complete Guide to Notion Databases,
> Notion API Reference (v2025-09-03), and Parallx codebase analysis.

---

## Table of Contents

1. [Core Data Model](#1-core-data-model)
2. [Database ↔ Page Relationship](#2-database--page-relationship)
3. [Full-Page vs Inline Databases](#3-full-page-vs-inline-databases)
4. [Property Types (Complete Catalog)](#4-property-types-complete-catalog)
5. [Views (8 Layout Types)](#5-views-8-layout-types)
6. [Filters](#6-filters)
7. [Sorting & Grouping](#7-sorting--grouping)
8. [Relations & Rollups](#8-relations--rollups)
9. [Formulas](#9-formulas)
10. [Linked Databases](#10-linked-databases)
11. [Database Templates](#11-database-templates)
12. [Forcing Functions](#12-forcing-functions)
13. [Database Locking & Permissions](#13-database-locking--permissions)
14. [Conditional Color](#14-conditional-color)
15. [Notion API Object Model (2025-09-03)](#15-notion-api-object-model-2025-09-03)
16. [Parallx Integration Strategy](#16-parallx-integration-strategy)
17. [Proposed Parallx Data Model](#17-proposed-parallx-data-model)
18. [Persistence & Storage Strategy](#18-persistence--storage-strategy)
19. [Module Architecture](#19-module-architecture)
20. [Implementation Phases](#20-implementation-phases)

---

## 1. Core Data Model

In Notion, a **database** is a structured collection of **pages** that share a
common schema (a set of typed **properties**). Every row in a database IS a page —
the same entity, the same ID. The database merely tracks _property values_ about
each page; the page's rich-text body content is entirely orthogonal and lives in
the page's own content tree.

Key insight: **a database row has no "content field."** The database schema
defines properties (Name, Status, Due Date, Assignee, etc.), and each property
has a value per row. The row's _content_ is accessed by opening the row as a page.

### Hierarchy

```
Database
  └── Data Source(s)        ← schema (properties) + row membership
        └── Page(s)         ← each row is a full page with its own content
```

As of the 2025-09-03 API version, Notion separates **database** from **data
source**. A database contains one or more data sources, each with its own
independent schema. Previously these were a single concept. This allows a single
database to contain multiple independent tables.

### Key Attributes

| Attribute         | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `id`              | UUID of the database                                     |
| `title`           | Rich-text array — the database's display name            |
| `description`     | Rich-text array — optional description shown below title |
| `icon`            | File or emoji object                                     |
| `cover`           | Cover image file object                                  |
| `parent`          | Parent page, workspace, or block                         |
| `is_inline`       | Whether the database is embedded inline within a page    |
| `data_sources`    | Array of data source objects (each with own properties)  |
| `archived`        | Soft-delete flag                                         |
| `in_trash`        | Whether moved to trash                                   |
| `created_time`    | ISO-8601 creation timestamp                              |
| `last_edited_time`| ISO-8601 last-modified timestamp                         |
| `public_url`      | Share-to-web URL if publishing is enabled                |

---

## 2. Database ↔ Page Relationship

This is the single most important concept:

> **A database row IS a page.** Same ID, same entity. The database defines
> metadata properties _about_ the page. The page body (the rich-text blocks) is
> the same page content that exists when the page is not in a database.

Implications:
- Creating a row = creating a page with a `parent` pointing to the database's data source.
- Opening a row = navigating to that page's content. The property values appear
  at the top of the page, above the body content.
- Deleting a row = archiving/trashing the page.
- A page can exist independently (not in any database), or it can be a child of
  a data source (making it a "database row").

### Property Values at Page Top

When a database page is opened, Notion displays a configurable set of properties
at the top of the page, above the body. Three visibility modes per property:
- **Always show** — property always visible at page top
- **Hide when empty** — only appears if it has a value
- **Always hide** — never shown at page top (still visible in the database view)

---

## 3. Full-Page vs Inline Databases

Notion supports two rendering modes for databases:

### Full-Page Database
- The database itself is a top-level page in the sidebar.
- Opening it shows the database view (table/board/etc.) as the entire page content.
- The database's title is the page title.
- Cannot have body content above/below the database.

### Inline Database
- The database is embedded as a **block** within another page's content.
- The parent page can have body content above and below the database block.
- Marked by `is_inline: true` in the API.
- Created by typing `/database` in a page and selecting an inline variant.
- Can be converted to full-page and vice versa.

### How Inline Databases Render

An inline database block renders as:
1. A title row (database name, editable inline)
2. A view selector (tabs for Table, Board, Calendar, etc.)
3. The active view's content (grid, kanban columns, etc.)
4. Optional "New" button to add rows
5. View-specific controls (filters, sorts, grouping, property visibility)

The entire database block is part of the page's Tiptap-style block tree, similar
to how an image or callout block exists as a node in the document.

---

## 4. Property Types (Complete Catalog)

Notion provides 24 property types. Each has a `type` discriminator and a
type-specific configuration object.

### Writable Properties (user-editable values)

| Type           | API type          | Config                                         | Value Shape                    |
| -------------- | ----------------- | ---------------------------------------------- | ------------------------------ |
| **Title**      | `title`           | `{}` (empty)                                   | Rich-text array                |
| **Text**       | `rich_text`       | `{}` (empty)                                   | Rich-text array                |
| **Number**     | `number`          | `{ format: "dollar" \| "percent" \| ... }`     | Number / null                  |
| **Select**     | `select`          | `{ options: [{ id, name, color }] }`           | `{ id, name, color }` / null   |
| **Multi-Select** | `multi_select`  | `{ options: [{ id, name, color }] }`           | `[{ id, name, color }]`       |
| **Status**     | `status`          | `{ options: [...], groups: [...] }`            | `{ id, name, color }` / null   |
| **Date**       | `date`            | `{}` (empty)                                   | `{ start, end?, time_zone? }` |
| **Checkbox**   | `checkbox`        | `{}` (empty)                                   | Boolean                        |
| **URL**        | `url`             | `{}` (empty)                                   | String / null                  |
| **Email**      | `email`           | `{}` (empty)                                   | String / null                  |
| **Phone**      | `phone_number`    | `{}` (empty)                                   | String / null                  |
| **Files**      | `files`           | `{}` (empty)                                   | Array of file objects          |
| **People**     | `people`          | `{}` (empty)                                   | Array of user objects          |
| **Relation**   | `relation`        | `{ data_source_id, synced_property_id/name }`  | Array of page references       |
| **Place**      | `place`           | `{}` (empty)                                   | `{ lat, lon, name?, address? }`|

### Computed / Read-Only Properties

| Type              | API type            | Notes                                       |
| ----------------- | ------------------- | ------------------------------------------- |
| **Formula**       | `formula`           | `{ expression: "..." }` — derived values    |
| **Rollup**        | `rollup`            | Aggregates across a relation                |
| **Created time**  | `created_time`      | Automatic; immutable                        |
| **Created by**    | `created_by`        | Automatic; immutable                        |
| **Last edited time** | `last_edited_time` | Automatic; updated on any edit             |
| **Last edited by** | `last_edited_by`  | Automatic; updated on any edit              |
| **Unique ID**     | `unique_id`         | Auto-incremented; `{ prefix?: "TASK" }`     |
| **Button**        | `button`            | Triggers an action on click                 |
| **Verification**  | `verification`      | Verification status (wiki databases)        |

### Property Configuration Details

**Select / Multi-Select / Status options:**
- Each option: `{ id: string, name: string, color: ColorEnum }`
- Colors: `blue | brown | default | gray | green | orange | pink | purple | red | yellow`
- Names must be unique (case-insensitive)
- Commas are NOT valid in option names

**Status groups:**
- Status has 3 built-in groups: `To-do`, `In progress`, `Complete`
- Each group: `{ id, name, color, option_ids: string[] }`
- Options are assigned to exactly one group
- Groups provide higher-level aggregation (e.g., progress bars)

**Number formats:**
- `number | number_with_commas | percent | dollar | euro | pound | yen | ...`
- 30+ currency formats available

**Title property:**
- Every data source requires EXACTLY ONE `title` property
- Different from the database's own `title` (which is its display name)
- The title property's value becomes the page's name when the row is opened

**Relation config:**
- `data_source_id`: which data source the relation points to
- `synced_property_id` + `synced_property_name`: the reciprocal property on the target
- Relations are always bidirectional — creating one automatically creates a reciprocal

**Rollup config:**
- `relation_property_id` / `relation_property_name`: which relation to traverse
- `rollup_property_id` / `rollup_property_name`: which property to aggregate
- `function`: `sum | average | median | min | max | count | count_values | count_per_group | percent_per_group | empty | not_empty | percent_empty | percent_not_empty | checked | unchecked | percent_checked | percent_unchecked | date_range | earliest_date | latest_date | range | show_original | show_unique | unique`

**Formula config:**
- `expression`: a string containing the formula expression
- Available functions: `prop("Name")`, `if(condition, then, else)`, `dateBetween()`, `format()`, `length()`, `contains()`, `replace()`, `replaceAll()`, `now()`, `formatDate()`, `dateAdd()`, `dateSubtract()`, nested `if-then` chains, arithmetic operators, `toNumber()`, `round()`, `ceil()`, `floor()`, `abs()`, `min()`, `max()`, `concat()`, `join()`, `slice()`, `test()` (regex), `empty()`, `and()`, `or()`, `not()`

---

## 5. Views (8 Layout Types)

A single database can have **multiple views**, each showing the same underlying
data with different layouts, filters, sorts, grouping, and property visibility.
Views are tabs at the top of the database.

### View Types

| View       | Description                                                  | Best For                          |
| ---------- | ------------------------------------------------------------ | --------------------------------- |
| **Table**  | Spreadsheet-like grid with rows and columns                  | Dense data, bulk editing          |
| **Board**  | Kanban columns grouped by a select/status property           | Workflow stages, pipelines        |
| **Timeline** | Gantt-chart with date-range items along a time axis        | Project planning, scheduling      |
| **Calendar** | Monthly calendar placing items by date property            | Events, deadlines                 |
| **List**   | Minimal vertical list with configurable preview properties   | Reading lists, simple inventories |
| **Gallery** | Card grid with cover images and preview properties          | Visual content, portfolios        |
| **Chart**  | Bar, line, donut charts over aggregate data                  | Analytics, reporting              |
| **Form**   | Form input that creates new database rows on submission      | Data collection, surveys          |

### View-Specific Settings

Each view independently stores:
- **Visible properties** (which columns/fields are shown, and in what order)
- **Filters** (per-view filter set)
- **Sorts** (per-view sort rules)
- **Grouping** (per-view group-by property, with optional sub-grouping)
- **Layout-specific options** (e.g., Board's grouping property, Calendar's date property, Timeline's date range properties, Gallery's card size and cover property)

### View Operations

- **Create view**: click `+` next to view tabs, choose layout type
- **Duplicate view**: copies layout, filters, sorts, grouping, property visibility
- **Lock view**: prevents others from modifying the view's configuration
- **Delete view**: removes the view (data is unaffected)
- **Reorder view tabs**: drag to rearrange

---

## 6. Filters

Filters control which rows are visible in a particular view.

### Simple Filters

Quick single-property filter. Example: "Status is In Progress."

Each filter rule has:
- **Property**: which property to filter by
- **Operator**: depends on property type
- **Value**: the comparison target

### Operators by Property Type

| Property Type   | Operators                                                          |
| --------------- | ------------------------------------------------------------------ |
| Text / Title    | is, is not, contains, does not contain, starts with, ends with, is empty, is not empty |
| Number          | =, ≠, >, ≥, <, ≤, is empty, is not empty                         |
| Select          | is, is not, is empty, is not empty                                 |
| Multi-Select    | contains, does not contain, is empty, is not empty                 |
| Status          | is, is not, is empty, is not empty                                 |
| Date            | is, is before, is after, is on or before, is on or after, is within (past week/month/year, next week/month/year), is empty, is not empty |
| Checkbox        | is checked, is not checked                                         |
| Person          | contains, does not contain, is empty, is not empty                 |
| Files           | is empty, is not empty                                             |
| URL / Email / Phone | is, is not, contains, does not contain, is empty, is not empty |
| Relation        | contains, does not contain, is empty, is not empty                 |
| Formula         | depends on the formula's output type (text/number/date/checkbox)   |
| Rollup          | depends on the rollup's output type                                |

### Advanced Filters

Advanced filter mode allows building **compound filter groups** with boolean logic:

```
AND group
  ├── Status is "In Progress"
  ├── OR group
  │     ├── Assignee contains "Alice"
  │     └── Assignee contains "Bob"
  └── Due Date is before "2025-03-01"
```

- Top-level group can be AND or OR
- Groups can be nested (AND groups inside OR groups and vice versa)
- Each leaf rule is a property + operator + value triple
- Filter groups compose arbitrarily deep

### Filter Persistence

Filters are stored **per view**. Different views of the same database can have
completely different filter configurations. When a view is duplicated, its filters
are also duplicated.

---

## 7. Sorting & Grouping

### Sorting

- Multiple sort rules per view, applied in priority order
- Each sort rule: `{ property, direction: "ascending" | "descending" }`
- Default sort is by creation time
- Sorts are per-view (different views can have different sort orders)
- Manual drag-reorder is supported in some views (overrides sort)

### Grouping

- Group rows by a single property (Select, Status, Multi-Select, Date, Person, Checkbox, etc.)
- Each group is a collapsible section
- **Sub-grouping**: a second level of grouping within each group
- Hidden groups: empty groups can be hidden
- Group order: follows the property's option order (for Select/Status) or natural order (for dates, etc.)

### Board-Specific Grouping

The Board view is inherently grouped:
- Primary grouping = the columns (typically Status or Select property)
- Cards within a column can be additionally sorted
- Dragging a card between columns changes the property value
- "No Status" column for items without a value

---

## 8. Relations & Rollups

### Relations

Relations connect items across two databases (or within the same database).

**Creating a relation:**
1. Add a "Relation" property to Database A
2. Choose the target: Database B (or Database A for self-referential)
3. Notion automatically creates a **reciprocal relation** property on Database B

**Behavior:**
- Each cell in the Relation column can contain references to one or more pages from the related database
- Clicking a relation value opens a popup showing the linked pages
- Relations are bidirectional: adding a link in A→B automatically appears in B→A
- A relation's config stores `data_source_id` (target) and `synced_property_id/name` (reciprocal property)

**Self-referential relations:**
- A database can relate to itself (e.g., "Sub-tasks" relation on a Tasks database pointing to the same Tasks database)
- Creates parent/child relationships within the same table

### Rollups

Rollups aggregate property values from related pages across a relation.

**Setup:**
1. Must have an existing Relation property
2. Create a Rollup property
3. Choose: which relation → which property on the related pages → which function

**Aggregation functions (24 total):**

| Category       | Functions                                                      |
| -------------- | -------------------------------------------------------------- |
| Count          | `count`, `count_values`, `count_per_group`, `unique`           |
| Numeric        | `sum`, `average`, `median`, `min`, `max`, `range`              |
| Date           | `earliest_date`, `latest_date`, `date_range`                   |
| Checkbox       | `checked`, `unchecked`, `percent_checked`, `percent_unchecked` |
| Empty          | `empty`, `not_empty`, `percent_empty`, `percent_not_empty`     |
| Percent        | `percent_per_group`                                            |
| Display        | `show_original`, `show_unique`                                 |

**Example:**
- Tasks database has a Relation to Projects database
- Projects database has a Rollup on the Tasks relation → "Status" property → `percent_checked`
- This shows the % of linked tasks that are marked complete

---

## 9. Formulas

Formulas compute values from other properties on the same row.

### Core Functions

```
prop("Property Name")     — reference another property's value
if(condition, then, else) — conditional logic
now()                     — current timestamp
empty(value)              — check if value is empty
```

### Available Operators

| Category    | Functions                                                     |
| ----------- | ------------------------------------------------------------- |
| Arithmetic  | `+`, `-`, `*`, `/`, `%`, `^`, `abs()`, `ceil()`, `floor()`, `round()`, `min()`, `max()`, `sign()`, `sqrt()`, `cbrt()`, `exp()`, `ln()`, `log10()`, `log2()` |
| String      | `length()`, `contains()`, `replace()`, `replaceAll()`, `test()` (regex), `concat()`, `join()`, `slice()`, `format()`, `lower()`, `upper()`, `trim()`, `padStart()`, `padEnd()`, `repeat()`, `link()`, `style()` |
| Date        | `now()`, `today()`, `fromTimestamp()`, `timestamp()`, `dateAdd()`, `dateSubtract()`, `dateBetween()`, `dateRange()`, `dateStart()`, `dateEnd()`, `formatDate()`, `minute()`, `hour()`, `day()`, `date()`, `month()`, `year()` |
| Logical     | `if()`, `ifs()`, `and()`, `or()`, `not()`, `empty()`, `equal()`, `unequal()`, `larger()`, `largerEq()`, `smaller()`, `smallerEq()` |
| Type        | `toNumber()`, `toBoolean()` |
| List        | `at()`, `first()`, `last()`, `filter()`, `find()`, `findIndex()`, `every()`, `some()`, `map()`, `flat()`, `reverse()`, `sort()`, `unique()`, `includes()`, `size()`, `sum()`, `min()`, `max()`, `average()`, `median()` |

### Formula Example

```
if(
  prop("Status") == "Done",
  "✅ Complete",
  if(
    prop("Due Date") < now(),
    "🔴 Overdue",
    "🟡 In Progress"
  )
)
```

Formulas produce **read-only values**. Their output type can be text, number, date,
or boolean — which determines what filter/sort operators are available.

---

## 10. Linked Databases

A **linked database** is a view of an existing database embedded in another page.
It is NOT a copy — it references the original source database.

### Behavior

- Created by typing `/linked view of database` in a page
- Renders as an inline database block
- Shows the source database's data with its own independent view configuration
- Filters, sorts, grouping, and property visibility are LOCAL to the linked view
- Changes to row data propagate to all views (including the source)
- Changes to the source schema (adding/removing properties) propagate to linked views
- Multiple linked views can exist across different pages, each with different filters/layouts

### Use Cases

- **Dashboard pages**: Embed filtered views of multiple databases on a single page
  (e.g., "My Tasks" view filtered to the current user from a team Tasks database)
- **Context-specific views**: A project page embeds a linked view of the global
  Tasks database filtered to that project
- **Report pages**: Combine linked views with different groupings/sorts to create
  analytical dashboards

### Implementation Implication

A linked database does NOT duplicate data. It stores:
- A reference to the source database / data source ID
- Its own view configuration (filter rules, sort rules, visible properties, layout type)

---

## 11. Database Templates

Database templates pre-configure the content and property values of new pages
created in a database.

### Capabilities

- **Multiple templates per database**: Users can create several templates, each
  with different default content and property values
- **Default template**: One template can be set as the default for a view or for
  all views. When set, clicking "New" automatically uses that template.
- **Dynamic properties**: Template pages can use dynamic values:
  - `Now` — current timestamp when the page is created
  - `Today` — current date when created
  - `Me` — the user who creates the page
- **Repeating templates**: Configured to automatically create new pages on a
  schedule (daily, weekly, monthly, yearly)
- **Self-referential filters**: Template filters that reference the template page
  itself (e.g., a linked database in the template filtered to show only items
  related to "this page") — these update dynamically per created instance

### Template Scope

Templates can be scoped to:
- A specific view (only appears as an option in that view)
- All views (appears everywhere)

---

## 12. Forcing Functions

When a database view has active filters, new rows created in that view
automatically conform to the filter criteria. This is called a **forcing function**.

### Example

If a Board view is filtered to `Status = "In Progress"` and `Assignee = "Alice"`:
- Clicking "New" in that view creates a page with:
  - Status = "In Progress"
  - Assignee = "Alice"
- The new row is immediately visible (it matches the filter)

### Rules

- Only applies to "writable" filter conditions (Status, Select, Person, etc.)
- Does not apply to computed filters (formulas, rollups)
- Does not apply to filters using "is not" or "does not contain" operators
- Multiple filter conditions are all applied to the new row

---

## 13. Database Locking & Permissions

### Lock Views

- Any view can be **locked** to prevent other users from modifying its filter,
  sort, grouping, and property visibility settings.
- Locked views still allow data editing — only the view config is locked.
- Useful for protecting curated dashboards.

### Lock Database

- An entire database can be locked to prevent schema changes (adding/removing properties).
- Locked databases still allow editing row values and adding new rows.

### Permission Levels

| Level              | Can edit properties/schema | Can edit row values | Can add rows | Can view |
| ------------------ | :------------------------: | :-----------------: | :----------: | :------: |
| Full access        | ✅                         | ✅                  | ✅           | ✅       |
| Can edit content   | ❌                         | ✅                  | ✅           | ✅       |
| Can edit           | ❌                         | ✅                  | ✅           | ✅       |
| Can comment        | ❌                         | ❌                  | ❌           | ✅       |
| Can view           | ❌                         | ❌                  | ❌           | ✅       |

### Person Property Permissions

People mentioned in a Person or Created By property can be granted granular
access to that specific page, enabling row-level access control.

---

## 14. Conditional Color

Database views support coloring page rows/cards based on property values.

### Configuration

- Set per view (not global to the database)
- Choose a property → define a rule → assign a background color
- Multiple color rules can be stacked
- In table view: color can apply to the entire row or just the triggering property column

### Supported Property Types for Coloring

Select, Multi-Select, Status, Title, Text, Number, Date, Person, Checkbox,
Formulas, Relations, Rollups.

### Behavior

- Color applies at the page level (background color of the row/card)
- Colors from Select/Status options are used by default (can be overridden)
- Duplicating a view copies its color settings
- Requires `Can edit content` access or higher

---

## 15. Notion API Object Model (2025-09-03)

### Database Object

```json
{
  "object": "database",
  "id": "...",
  "data_sources": [
    { "object": "data_source", "id": "...", "properties": { ... } }
  ],
  "title": [ { "type": "text", "text": { "content": "My Database" } } ],
  "description": [],
  "icon": { "type": "emoji", "emoji": "📊" },
  "cover": null,
  "parent": { "type": "page_id", "page_id": "..." },
  "url": "https://www.notion.so/...",
  "archived": false,
  "in_trash": false,
  "is_inline": false,
  "public_url": null,
  "created_time": "2025-01-15T10:00:00.000Z",
  "last_edited_time": "2025-02-20T15:30:00.000Z",
  "created_by": { "object": "user", "id": "..." },
  "last_edited_by": { "object": "user", "id": "..." }
}
```

### Data Source Object

```json
{
  "object": "data_source",
  "id": "...",
  "properties": {
    "Name": { "id": "title", "name": "Name", "type": "title", "title": {} },
    "Status": { "id": "biOx", "name": "Status", "type": "status", "status": { "options": [...], "groups": [...] } },
    "Due Date": { "id": "AJP}", "name": "Due Date", "type": "date", "date": {} },
    "Assignee": { "id": "FlgQ", "name": "Assignee", "type": "people", "people": {} }
  },
  "parent": { "type": "database_id", "database_id": "..." },
  "database_parent": { "type": "page_id", "page_id": "..." },
  "title": [ { "type": "text", "text": { "content": "Main Table" } } ],
  "description": [],
  "icon": null,
  "archived": false,
  "in_trash": false,
  "created_time": "2025-01-15T10:00:00.000Z",
  "last_edited_time": "2025-02-20T15:30:00.000Z"
}
```

### Key Takeaway: Database → Data Source → Page

```
Database (container, identity, is_inline, parent)
  └── Data Source (schema: properties, title, description)
        └── Pages (rows — property values conform to data source schema)
```

Each data source property includes:
- `id` — short string identifier (stable across renames)
- `name` — display name (can be renamed)
- `description` — optional description text
- `type` — the property type discriminator
- `{type}` — type-specific config object (e.g., `"select": { "options": [...] }`)

Maximum recommended schema size: **50KB** (enforced by Notion to maintain performance).

---

## 16. Parallx Integration Strategy

### Current Parallx Architecture

**Pages table** (`001_canvas_schema.sql`):
```sql
CREATE TABLE pages (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT REFERENCES pages(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  icon          TEXT DEFAULT NULL,
  content       TEXT DEFAULT '{}',
  sort_order    REAL NOT NULL DEFAULT 0,
  is_archived   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Additional columns from migrations 002-005: `cover_url`, `cover_y_offset`,
`font_family`, `full_width`, `small_text`, `is_locked`, `is_favorited`,
`content_schema_version`, `revision`.

**IPage interface** (canvasTypes.ts): 19 properties covering identity, content,
presentation settings, timestamps.

**CanvasDataService**: CRUD operations via IPC to SQLite (better-sqlite3 in
Electron main process). Page tree assembly, debounced auto-save, optimistic
concurrency via revision numbers.

### The Critical Insight: Row = Page

A database row in Parallx uses the **same `pages` table and the same `IPage`
interface**. The database does NOT need a separate content storage mechanism.
Instead:

1. **Database metadata** → new `databases` table (id, title, icon, is_inline, etc.)
2. **Database schema** → new `database_properties` table (property definitions per database)
3. **Row property values** → new `page_property_values` table (property values per page per database)
4. **Row content** → existing `pages.content` column (untouched — same as any page)
5. **Database membership** → existing `pages.parent_id` points to a database-page, OR a new `database_pages` junction table

### Integration Points

| Parallx Layer              | Impact                                                  |
| -------------------------- | ------------------------------------------------------- |
| `pages` table              | No schema change. Database rows are pages.              |
| `CanvasDataService`        | Extended with database CRUD methods, or a sibling `DatabaseDataService` |
| `canvasTypes.ts`           | New interfaces: `IDatabase`, `IDataSource`, `IDatabaseProperty`, `IPropertyValue`, `IDatabaseView` |
| Sidebar tree               | Database-parent pages show as databases with a different icon |
| Page view                  | When opening a database row, property values render above body content |
| Inline node                | New Tiptap node for inline database blocks              |
| View renderer              | New view components: table, board, list, gallery, etc.  |
| Menu system                | New slash-menu item: `/database` to create inline databases |

---

## 17. Proposed Parallx Data Model

### New Tables

```sql
-- Database container
CREATE TABLE databases (
  id          TEXT PRIMARY KEY,           -- UUID
  page_id     TEXT REFERENCES pages(id),  -- backing page (for full-page DBs)
  title       TEXT NOT NULL DEFAULT 'Untitled',
  icon        TEXT DEFAULT NULL,
  description TEXT DEFAULT NULL,
  is_inline   INTEGER NOT NULL DEFAULT 0, -- 0 = full-page, 1 = inline
  is_locked   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Property schema (one row per property per database)
CREATE TABLE database_properties (
  id          TEXT NOT NULL,              -- short stable ID
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,              -- 'title','rich_text','number','select',...
  config      TEXT NOT NULL DEFAULT '{}', -- JSON: options, format, expression, etc.
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, database_id)
);

-- Property values (one row per page per property)
CREATE TABLE page_property_values (
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT 'null', -- JSON-encoded value
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id, property_id, database_id),
  FOREIGN KEY (property_id, database_id) REFERENCES database_properties(id, database_id) ON DELETE CASCADE
);

-- Database views (one per view per database)
CREATE TABLE database_views (
  id          TEXT PRIMARY KEY,           -- UUID
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Default view',
  type        TEXT NOT NULL DEFAULT 'table', -- table/board/list/gallery/calendar/timeline/chart/form
  config      TEXT NOT NULL DEFAULT '{}', -- JSON: visible_properties, filters, sorts, grouping, layout-specific options
  sort_order  REAL NOT NULL DEFAULT 0,
  is_locked   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Database membership (which pages belong to which database)
CREATE TABLE database_pages (
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (database_id, page_id)
);

CREATE INDEX idx_db_props ON database_properties(database_id);
CREATE INDEX idx_ppv_page ON page_property_values(page_id);
CREATE INDEX idx_ppv_db ON page_property_values(database_id);
CREATE INDEX idx_db_views ON database_views(database_id);
CREATE INDEX idx_db_pages ON database_pages(database_id);
CREATE INDEX idx_db_pages_page ON database_pages(page_id);
```

### Why a Junction Table?

Using `database_pages` instead of just `pages.parent_id`:
- A page can appear in **multiple databases** (via linked database views)
- A page can be a database row AND have a parent page (nested in the sidebar tree)
- Clean separation: the `pages` table stays purely about page identity/content

### View Config Schema (JSON in `database_views.config`)

```typescript
interface IDatabaseViewConfig {
  visibleProperties: string[];      // property IDs in display order
  filters: IFilterGroup;            // compound AND/OR filter tree
  sorts: ISortRule[];               // ordered sort rules
  groupBy?: string;                 // property ID to group by
  subGroupBy?: string;              // property ID for sub-grouping
  colorRules?: IColorRule[];        // conditional coloring
  cardSize?: 'small' | 'medium' | 'large'; // gallery-specific
  dateProperty?: string;            // calendar/timeline: which property
  dateEndProperty?: string;         // timeline: range end property
  boardGroupProperty?: string;      // board: which Select/Status property for columns
  hideEmptyGroups?: boolean;
}
```

---

## 18. Persistence & Storage Strategy

### SQLite Tables (in existing `.parallx/data.db`)

All database-related tables live in the same SQLite database as the `pages` table.
No separate file needed. Migration files:

```
006_databases.sql          — databases, database_properties, database_views, database_pages tables
007_page_property_values.sql — page_property_values table + indices
```

### Why Same Database?

- Database rows ARE pages — foreign keys between `database_pages` and `pages`
  require the same database file.
- Transactions spanning page creation + property value insertion are atomic.
- No cross-file JOIN complexity.

### Content Schema

Database page content (the rich-text body when you open a row) uses the same
content schema and encoding as regular pages (`contentSchema.ts`,
`CURRENT_CANVAS_CONTENT_SCHEMA_VERSION`). No changes to the content system.

### Property Value Encoding

All property values stored as JSON in `page_property_values.value`:

```json
{ "type": "select", "select": { "id": "abc", "name": "Doing", "color": "blue" } }
{ "type": "number", "number": 42 }
{ "type": "date", "date": { "start": "2025-03-01", "end": "2025-03-15" } }
{ "type": "relation", "relation": [{ "id": "page-uuid-1" }, { "id": "page-uuid-2" }] }
{ "type": "checkbox", "checkbox": true }
{ "type": "rich_text", "rich_text": [{ "type": "text", "content": "Hello" }] }
```

This matches Notion's API format for page property values, making the schema
future-proof and import/export-friendly.

---

## 19. Module Architecture

### Proposed File Structure

```
src/built-in/database/
  ├── databaseTypes.ts           — IDatabase, IDataSource, IDatabaseProperty, IPropertyValue, IDatabaseView, etc.
  ├── databaseDataService.ts     — CRUD for databases, properties, views, property values
  ├── databaseViewRenderer.ts    — Base view renderer (abstract)
  ├── databaseInlineNode.ts      — Tiptap node for inline database blocks
  ├── migrations/
  │     ├── 006_databases.sql
  │     └── 007_page_property_values.sql
  ├── views/
  │     ├── tableView.ts         — Table/spreadsheet layout
  │     ├── boardView.ts         — Kanban board layout
  │     ├── listView.ts          — Minimal list layout
  │     ├── galleryView.ts       — Card gallery layout
  │     ├── calendarView.ts      — Calendar layout
  │     ├── timelineView.ts      — Timeline/Gantt layout
  │     ├── chartView.ts         — Chart layout
  │     └── formView.ts          — Form input layout
  ├── filters/
  │     ├── filterTypes.ts       — IFilterRule, IFilterGroup
  │     ├── filterEngine.ts      — Evaluate filter trees against row data
  │     └── filterUI.ts          — Filter builder UI components
  ├── properties/
  │     ├── propertyEditors.ts   — Cell editors for each property type
  │     ├── propertyRenderers.ts — Read-only cell renderers
  │     └── formulaEngine.ts     — Formula parser + evaluator
  └── relations/
        ├── relationResolver.ts  — Resolve relation/rollup values across databases
        └── rollupEngine.ts      — Compute rollup aggregations
```

### Gate Architecture Decision

The database built-in is a **separate tool** from Canvas, not a child of the
canvas gate architecture. It lives in `src/built-in/database/`, parallel to
`src/built-in/canvas/`. It shares:

- The same SQLite database (same `DatabaseBridge` IPC)
- The same `pages` table (a database row IS a page)
- The same `CanvasDataService` for page CRUD (or calls it via a shared interface)

It does NOT need to go through the canvas 5-registry gate system. The canvas
gate architecture governs canvas editor interactions (blocks, menus, handles,
icons, state). Database views are a different rendering paradigm — they render
property-value grids, not Tiptap block trees.

However, the **inline database node** (Tiptap extension for embedding an inline
database in a canvas page) would be registered through the canvas BlockRegistry,
similar to how `pageBlockNode`, `mediaNodes`, and `bookmarkNode` are registered.

---

## 20. Implementation Phases

### Phase 1 — Data Layer Foundation
- [ ] Create `databaseTypes.ts` with all interfaces
- [ ] Create migration SQL files (`006_databases.sql`, `007_page_property_values.sql`)
- [ ] Create `DatabaseDataService` with database/property/view CRUD
- [ ] Unit tests for data service

### Phase 2 — Table View (MVP)
- [ ] Table view renderer (header row + data rows)
- [ ] Cell renderers for core property types (title, text, number, select, status, date, checkbox)
- [ ] Cell editors for writable properties
- [ ] Property add/remove/reorder in the table header
- [ ] Row creation with forcing functions

### Phase 3 — View System
- [ ] View tabs UI (create, switch, rename, delete, duplicate, reorder)
- [ ] Filter builder (simple + advanced with AND/OR groups)
- [ ] Sort builder (multi-sort)
- [ ] Grouping and sub-grouping
- [ ] Per-view property visibility and order

### Phase 4 — Board View
- [ ] Kanban column layout grouped by Select/Status
- [ ] Card rendering with configurable preview properties
- [ ] Drag-to-change-status (move card between columns)

### Phase 5 — Additional Views
- [ ] List view
- [ ] Gallery view
- [ ] Calendar view
- [ ] Timeline view

### Phase 6 — Inline Databases
- [ ] Tiptap node for inline database blocks
- [ ] Slash-menu integration (`/database`)
- [ ] Full-page ↔ inline conversion
- [ ] Linked database views

### Phase 7 — Relations & Rollups
- [ ] Relation property type (cross-database linking)
- [ ] Reciprocal relation auto-creation
- [ ] Rollup property type (aggregate across relations)
- [ ] Rollup function evaluation engine

### Phase 8 — Formulas
- [ ] Formula parser (expression → AST)
- [ ] Formula evaluator (AST → value, given row context)
- [ ] All Notion formula functions
- [ ] Re-evaluation on dependency change

### Phase 9 — Polish
- [ ] Database templates
- [ ] Conditional color
- [ ] Database/view locking
- [ ] Chart view
- [ ] Form view
- [ ] Template scheduling (repeating templates)

---

## Appendix A — Notion vs Parallx Gap Summary

| Feature                    | Notion | Parallx (current) | Parallx (proposed)       |
| -------------------------- | :----: | :----------------: | :----------------------: |
| Pages with rich content    | ✅     | ✅                 | ✅ (unchanged)           |
| Page tree hierarchy        | ✅     | ✅                 | ✅ (unchanged)           |
| Full-page databases        | ✅     | ❌                 | Phase 1-3                |
| Inline databases           | ✅     | ❌                 | Phase 6                  |
| Table view                 | ✅     | ❌                 | Phase 2                  |
| Board view                 | ✅     | ❌                 | Phase 4                  |
| Calendar view              | ✅     | ❌                 | Phase 5                  |
| Timeline view              | ✅     | ❌                 | Phase 5                  |
| List view                  | ✅     | ❌                 | Phase 5                  |
| Gallery view               | ✅     | ❌                 | Phase 5                  |
| Chart view                 | ✅     | ❌                 | Phase 9                  |
| Form view                  | ✅     | ❌                 | Phase 9                  |
| Views (multi-view per DB)  | ✅     | ❌                 | Phase 3                  |
| Filters (simple)           | ✅     | ❌                 | Phase 3                  |
| Filters (advanced AND/OR)  | ✅     | ❌                 | Phase 3                  |
| Sorting                    | ✅     | ❌                 | Phase 3                  |
| Grouping / sub-grouping    | ✅     | ❌                 | Phase 3                  |
| 24 property types          | ✅     | ❌                 | Phase 2-8                |
| Relations                  | ✅     | ❌                 | Phase 7                  |
| Rollups                    | ✅     | ❌                 | Phase 7                  |
| Formulas                   | ✅     | ❌                 | Phase 8                  |
| Linked databases           | ✅     | ❌                 | Phase 6                  |
| Database templates         | ✅     | ❌                 | Phase 9                  |
| Forcing functions          | ✅     | ❌                 | Phase 2                  |
| Conditional color          | ✅     | ❌                 | Phase 9                  |
| Database locking           | ✅     | ❌                 | Phase 9                  |

---

## Appendix B — Key Insight Summary

1. **Row = Page**: A database row is the same entity as a page. Same ID, same
   content, same table. The database adds structured properties ON TOP of the page.

2. **Database never touches page content**: The database schema defines properties
   (metadata). The page's body (Tiptap block tree) is completely independent and
   accessed by opening the row as a page.

3. **Views are lenses, not copies**: Each view shows the same underlying data with
   different layout/filter/sort/grouping config. Data changes propagate instantly.

4. **Inline databases are blocks**: An inline database is a node in a page's Tiptap
   block tree, similar to an image or callout node. It renders a mini database
   view within the page content.

5. **Linked databases are views, not duplicates**: A linked database is a view
   configuration pointing to an existing database. No data duplication.

6. **Relations are always bidirectional**: Creating a relation from A→B automatically
   creates a reciprocal property on B pointing back to A.

7. **Formulas are local to a row**: They compute values from the same row's properties.
   Cross-row aggregation requires rollups (which depend on relations).

8. **Data Source separation (API 2025-09-03)**: Notion now models databases as
   containers for one or more data sources, each with its own schema. This enables
   multi-table databases. Parallx should adopt this model from the start.
