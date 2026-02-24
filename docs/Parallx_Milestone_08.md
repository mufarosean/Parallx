# Milestone 8 — Notion-Like Database System

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 8.
> All implementation must conform to the structures and boundaries defined here.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.
> The Canvas tool is the primary consumer of this milestone's work.

---

## Milestone Definition

### Vision

The Canvas tool gains a **Notion-like database system** — a structured data layer where every database row IS a page, views are lenses over the same data, and inline databases embed as blocks inside canvas pages. Users can create full-page or inline databases with typed properties, multiple view layouts (Table, Board, List, Gallery, Calendar, Timeline), compound filters, multi-sort, grouping, relations, rollups, and formulas.

### Purpose

The Canvas tool is a fully-functional block editor. But it is purely a **document editor** — there is no structured data capability. Notion's competitive advantage comes from the fusion of documents and structured data: every page can be a database row, every database row can hold rich content. This milestone bridges that gap.

The key architectural insight: **a database row has no "content field."** The database schema defines properties (metadata), and each property has a value per row. The row's content is the page's existing Tiptap block tree, accessed by opening the row as a page. This means the database system builds **on top of** the existing page infrastructure without modifying it.

### Structural Commitments

These invariants are non-negotiable. Every implementation decision must preserve them.

- **Row = Page.** A database row is the same entity as a page. Same ID, same `pages` table, same `IPage` interface. The database adds structured properties ON TOP of the page — it never replaces or wraps it.
- **Database never touches page content.** The database schema defines metadata properties. The page's body (Tiptap block tree) is completely independent and accessed by opening the row as a page.
- **Views are lenses, not copies.** Each view shows the same underlying data with different layout/filter/sort/grouping config. Data changes propagate instantly to all views of the same database.
- **Same SQLite database.** All database-related tables live alongside the `pages` table in `.parallx/data.db`. Foreign keys between `database_pages` and `pages` require the same DB file. Transactions spanning page creation + property insertion are atomic.
- **Integrated into canvas, not separate.** The database system lives inside the canvas built-in (`src/built-in/canvas/database/`). It is not a separate tool with its own activation.
- **No new dependencies.** Same vanilla TypeScript + SQLite + Tiptap stack. No UI frameworks (React, Vue). No charting libraries. No new npm packages.
- **Property values as JSON.** All values stored as JSON in `page_property_values.value`, matching Notion's API format for future import/export compatibility.
- **CSS follows existing patterns.** Database view styles go in dedicated `.css` files co-located with their modules, following `src/ui/` conventions — no inline styles for visual properties.

### What Success Looks Like

1. **Full-page databases** — A page can be a database. Opening it shows a view (table, board, etc.) instead of the Tiptap editor. The sidebar shows database pages with a table icon.
2. **Inline databases** — A database block can be embedded within a canvas page's content, rendering a mini view (with tabs, filters, etc.) inline alongside other blocks.
3. **Table view (MVP)** — Spreadsheet-like grid with typed columns, cell editors, row creation, property add/remove/reorder.
4. **Board view** — Kanban columns grouped by a Select or Status property, with drag-to-change-status.
5. **View system** — Multiple views per database with independent filters, sorts, grouping, and property visibility. View tabs for switching.
6. **Core property types** — Title, Text, Number, Select, Multi-Select, Status, Date, Checkbox, URL, Email, Phone.
7. **Filters & Sorting** — Simple filters and advanced compound filter groups (nested AND/OR). Multi-sort with priority ordering.
8. **Grouping** — Group rows by a property, with collapsible sections and optional sub-grouping.
9. **Relations & Rollups** — Cross-database linking with bidirectional relations and rollup aggregation.
10. **Formulas** — Computed read-only properties with expression evaluation.
11. **All existing tests pass** — Canvas editor functionality is unaffected. New tests validate database behavior.

---

## Sub-Milestone Breakdown

This milestone is split into sub-milestones to enable focused delivery and verification:

| Sub-Milestone | Phases | Focus |
|---------------|--------|-------|
| **M8.1** | Phases 1–4 | Data layer + Table view + View system + Board view |
| **M8.2** | Phases 5–6 | Additional views + Inline databases + Linked views |
| **M8.3** | Phases 7–9 | Relations + Rollups + Formulas + Polish |

Each sub-milestone is independently shippable and testable.

---

## Architecture & Design Principles

These principles are restated here from `ARCHITECTURE.md` because they govern every implementation decision in this milestone. They are not optional.

### Parallx Layered Architecture

```
┌─────────────────────────────────────────────────┐
│                   workbench/                     │  ← Composition root
│          (orchestrates everything)               │
├─────────────────────────────────────────────────┤
│                   services/                      │  ← Service layer
│       (interfaces + implementations)             │
├────────┬────────┬────────┬────────┬─────────────┤
│ parts/ │ views/ │editor/ │  dnd/  │  commands/   │  ← Feature modules
│        │        │        │        │  context/    │
│        │        │        │        │  workspace/  │
├────────┴────────┴────────┴────────┴─────────────┤
│                   layout/                        │  ← Layout engine
├─────────────────────────────────────────────────┤
│                  platform/                       │  ← Foundation
│  (events, lifecycle, storage, instantiation)     │
└─────────────────────────────────────────────────┘
```

### Absolute Prohibitions

- **No circular dependencies.** If module A imports from module B, module B must not import from module A (directly or transitively).
- **No upward dependencies.** Lower layers (`platform/`, `layout/`) must never import from higher layers (`workbench/`, `services/` implementations).
- **No cross-peer dependencies unless explicitly allowed.** Per the dependency matrix in `ARCHITECTURE.md`.
- **No concrete service imports outside `services/` and `workbench/`.** All other modules consume services through interfaces only.

### UI Component Rules

- Vanilla TypeScript classes extending `Disposable` (from `platform/lifecycle.ts`). `Emitter<T>` for events. Co-located CSS.
- No frameworks. No web components. No external UI libraries.
- Every `src/ui/` component accepts `(container: HTMLElement, options?: TOptions)` in constructor, fires events via `Emitter<T>`, uses CSS classes from co-located `.css` files — no inline styles for visual properties.
- Components are context-agnostic — a table cell editor must not know whether it's in the sidebar or the editor pane.
- **Check `src/ui/` before implementing any visual element.** Extend or compose existing components — do not duplicate.
- Reusable UI primitives available: `inputBox`, `contextMenu`, `button`, `overlay`, `list`, `breadcrumbs`, `tabBar`, `dialog`, `findReplaceWidget`, `$()` element factory, `addDisposableListener()`.

### Canvas Gate Architecture (for inline database node only)

The database system itself does NOT go through the canvas five-registry gate system. However, the **inline database Tiptap node** (`databaseInlineNode.ts`) is a canvas block extension and must follow gate rules:

- It lives in `src/built-in/canvas/extensions/`
- It imports **only from `BlockRegistry`** — never from CanvasMenuRegistry, IconRegistry, or BlockStateRegistry directly
- If it needs something not yet exported from BlockRegistry, add the export there
- It must be registered in both `gateCompliance.test.ts` GATE_RULES and the block extension set

### Conventions

- **One concern per file.** Each file has a single, clear responsibility described in its header comment.
- **Types files are co-located.** `databaseTypes.ts` holds all shared type definitions for the database domain.
- **Interfaces before implementations.** `IDatabaseDataService` is the interface; `DatabaseDataService` is the concrete class.
- **Test files mirror source structure.** Tests for `src/built-in/canvas/database/tableView.ts` live at `tests/unit/database/tableView.test.ts`.

---

## Existing Infrastructure (What We Build On)

This section documents every component the database system integrates with. Understanding these integration points is essential — the database system extends existing infrastructure, it does not replace or duplicate it.

### 1. SQLite Database Manager (`electron/database.cjs`)

The main process hosts a singleton `DatabaseManager` using `better-sqlite3` with:
- **WAL mode** + foreign key enforcement enabled on open
- Database file at `<workspacePath>/.parallx/data.db`
- Methods: `open(dbPath)`, `close()`, `migrate(dir)`, `run(sql, params)`, `get(sql, params)`, `all(sql, params)`, `runTransaction(operations[])`
- `runTransaction()` uses `IMMEDIATE`-level transactions for atomicity
- Migration tracking via `_migrations` table — lexicographic file ordering (`001_xxx.sql`, `002_xxx.sql`)

**Integration:** Database tables for the new system go in the same `.parallx/data.db` file. Migrations continue the canvas sequence (006, 007, ...). No separate database file.

### 2. IPC Bridge (`electron/preload.cjs` → `window.parallxElectron.database`)

The preload bridge exposes these methods to the renderer process:

| Method | IPC Channel | Returns |
|--------|------------|---------|
| `open(workspacePath, migrationsDir?)` | `database:open` | `{ error, dbPath }` |
| `migrate(migrationsDir)` | `database:migrate` | `{ error }` |
| `close()` | `database:close` | `{ error }` |
| `run(sql, params?)` | `database:run` | `{ error, changes, lastInsertRowid }` |
| `get(sql, params?)` | `database:get` | `{ error, row }` |
| `all(sql, params?)` | `database:all` | `{ error, rows }` |
| `isOpen()` | `database:isOpen` | `{ isOpen }` |
| `runTransaction(operations[])` | `database:runTransaction` | `{ error, results[] }` |

**Error shape:** `{ code: string, message: string }` or `null` on success.

**Integration:** The `DatabaseDataService` (new) uses the exact same `window.parallxElectron.database` bridge that `CanvasDataService` uses. No new IPC channels needed — we use `run`, `get`, `all`, and `runTransaction` with SQL targeting the new tables.

### 3. Canvas Data Service Pattern (`canvasDataService.ts`)

The `CanvasDataService` class is the proven pattern for renderer-side data services:
- Extends `Disposable` for lifecycle cleanup
- Private `_db` accessor to `window.parallxElectron.database` (throws if not available)
- `Emitter<T>` events: `onDidChangePage`, `onDidSavePage`, `onDidChangeSaveState`
- `rowToPage()` helper maps raw DB rows to typed `IPage` objects
- Debounced auto-save with retry logic (`_pendingSaves`, `_retryQueue`)
- Optimistic concurrency via `revision` column

**Integration:** The new `DatabaseDataService` follows the same pattern — extends `Disposable`, uses the same `_db` bridge accessor, fires events via `Emitter<T>`, maps raw rows to typed interfaces.

### 4. Canvas Activation Pattern (`canvas/main.ts`)

The canvas tool's `activate(api, context)` function follows this sequence:
1. Run migrations via `electron.database.migrate(migrationsDir)`
2. Create `CanvasDataService` instance
3. Register sidebar view: `api.views.registerViewProvider('view.canvas', ...)`
4. Restore state from `context.workspaceState`
5. Register editor provider: `api.editors.registerEditorProvider('canvas', ...)`
6. Register commands: `api.commands.registerCommand(...)`
7. Track/restore last-opened page

**Integration:** The database system is **integrated into the canvas built-in** — it extends `canvas/main.ts`'s activation, not a separate tool. Database migrations run in the same `_runMigrations()` call. The `DatabaseDataService` is created **eagerly** alongside `CanvasDataService` (step 2b) — not lazily on first use. This avoids null-check branching and matches the proven activation pattern. The database editor provider is registered as a second editor type (e.g., `api.editors.registerEditorProvider('database', ...)`).

### 5. Editor Provider Pattern (`canvasEditorProvider.ts`)

Canvas pages open via:
1. `api.editors.openEditor({ typeId: 'canvas', title, icon, instanceId: pageId })`
2. Workbench creates a `ToolEditorInput` with `typeId: 'canvas'`
3. `ToolEditorPane` delegates to `provider.createEditorPane(container, input)`
4. Input `instanceId` carries the page ID

**Integration:** Database views open via the same mechanism with `typeId: 'database'`:
1. `api.editors.openEditor({ typeId: 'database', title, icon, instanceId: databaseId })`
2. A `DatabaseEditorProvider` handles `createEditorPane()`, creating the view tab bar + active view renderer
3. The sidebar decides which typeId to use based on whether a page is a database or a regular page

### 6. Sidebar Tree (`canvasSidebar.ts`)

The `CanvasSidebar` renders a tree from `IPageTreeNode[]` with:
- Expand/collapse, click-to-open, inline rename, drag-and-drop reorder/reparent
- Icon display per page (emoji or default)
- Context menu (New subpage, Rename, Delete, Duplicate)
- Favorites and Trash sections

**Integration:** The sidebar must be extended to:
- Detect which pages are databases (via a flag on `IPage` or a lookup from `DatabaseDataService`)
- Show a table/grid icon for database pages instead of the default page icon
- Open database pages with `typeId: 'database'` instead of `typeId: 'canvas'`
- Add "New Database" to the context menu and "+ New" actions

### 7. Existing Migration Files (`canvas/migrations/`)

| File | Content |
|------|---------|
| `001_canvas_schema.sql` | Core `pages` table with tree structure |
| `002_page_properties.sql` | `page_properties` key-value table |
| `003_page_settings.sql` | ALTER TABLE: cover, font, width, text, lock, favorite |
| `004_content_schema_version.sql` | ALTER TABLE: `content_schema_version` |
| `005_block_graph_and_page_revision.sql` | `revision` column + `canvas_blocks` table |

**Integration:** New migrations are `006_databases.sql` and `007_page_property_values.sql`, placed in the same `canvas/migrations/` directory.

### 8. Pages Table Schema (Current)

```sql
pages (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  icon TEXT DEFAULT NULL,
  content TEXT DEFAULT '{}',
  sort_order REAL NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  cover_url TEXT DEFAULT NULL,
  cover_y_offset REAL DEFAULT 0.5,
  font_family TEXT DEFAULT 'default',
  full_width INTEGER DEFAULT 0,
  small_text INTEGER DEFAULT 0,
  is_locked INTEGER DEFAULT 0,
  is_favorited INTEGER DEFAULT 0,
  content_schema_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

**Integration:** The `pages` table is NOT modified. Database rows are pages. A page is recognized as a "database page" by having a corresponding entry in the new `databases` table where `databases.page_id = pages.id`.

---

## Authoritative References

| Document | Role |
|----------|------|
| `docs/research/DATABASE_VIEWS_RESEARCH.md` | **The research** — Complete Notion database analysis: data model, 24 property types, 8 view layouts, filters, relations, formulas, API object model, Parallx integration strategy |
| `ARCHITECTURE.md` | **The architecture** — Module responsibility, dependency matrix, canvas gate architecture, layered model, absolute prohibitions |
| `docs/PARALLX_WORKSPACE_SCHEMA.md` | **The schema** — Workspace file format, storage topology, canvas DB strategy |
| `src/built-in/canvas/canvasTypes.ts` | **The page model** — `IPage` (19 fields), `IPageTreeNode`, `ICanvasDataService` interface (30+ methods) |
| `src/built-in/canvas/canvasDataService.ts` | **The data service pattern** — `DatabaseBridge` interface, `rowToPage()`, auto-save lifecycle, event emission |
| `src/built-in/canvas/main.ts` | **The activation pattern** — Migration running, service creation, view/editor registration, command registration |
| `electron/database.cjs` | **The storage layer** — `DatabaseManager` class, WAL mode, transaction support, migration runner |

---

## Design Decisions

These decisions were made during planning and are binding for implementation. They are recorded here to prevent future re-litigation.

### DD-0: `databases.id` = `page_id`

**Decision:** The `databases.id` column always equals the `page_id` of the page it represents. They are the same UUID.

**Rationale:** Having two different UUIDs for the same logical entity (database = page) creates mapping overhead and confusion. Every lookup would need a join or double-ID tracking. Since a page can only be one database, there's no cardinality reason for separate IDs. Using the same UUID means `databases.id` is both the database identity AND the page identity — consumers never need to translate between them. The `page_id` column is kept for the explicit foreign key to `pages(id)`, but its value always equals `id`.

**Notion divergence note:** Notion's API uses separate UUIDs for databases and their parent pages (database object has `"id": "248104cd-..."` with `"parent": { "page_id": "255104cd-..." }`). This is because Notion databases are a distinct object class (`"object": "database"`) — not pages. In Parallx, a database IS a page variant (same entity, different behavior), so sharing the UUID is an intentional simplification that eliminates translation overhead. (Source: [Notion Database Reference](https://developers.notion.com/reference/database))

### DD-1: Eager `DatabaseDataService` Creation

**Decision:** `DatabaseDataService` is created eagerly during `canvas/main.ts` activation, immediately after `CanvasDataService` — not lazily on first database access.

**Rationale:** This matches the `CanvasDataService` lifecycle pattern. Eager creation means every consumer can assume the service exists (no null checks, no lazy-init branching). The service is lightweight — it holds a reference to the IPC bridge and nothing else until queries are made. Notion also initializes its database engine at startup, not on first use.

### DD-2: Wrapper Component for Row Property Display

**Decision:** When opening a database row as a page, property values are rendered above the Tiptap editor by a new `DatabaseRowPropertyBar` wrapper component — not by modifying `CanvasEditorProvider`.

**Rationale:** The `CanvasEditorProvider` must remain unaware of database concepts. If it started detecting "is this page a database row?" it would create a dependency from the canvas editor into the database module, violating separation of concerns. The wrapper component sits between the editor pane and the page content, queries `DatabaseDataService` for the page's database membership and property values, and renders conditionally. If the page is not a database row, the wrapper is invisible — zero overhead.

### DD-3: No Title/Icon on `databases` Table

**Decision:** The `databases` table does NOT have `title` or `icon` columns. The page's `title` and `icon` (from the `pages` table) are the single source of truth.

**Rationale:** Duplicating `title` and `icon` on both `pages` and `databases` creates a sync problem — which one wins? Notion solves this by making the database title BE the page title. Since our database IS a page (`databases.id = page_id`), the page's fields are canonical. The `databases` table only adds database-specific fields that pages don't have: `description` and `is_locked`.

**Notion divergence note:** Notion's database object does carry `title`, `icon`, and `cover` fields directly — because in their model databases are standalone objects that need those fields. In their 2025-09-03 API, they further split into database → data_source, each with its own title. Our architecture avoids this complexity: the page IS the database, so the page's fields are the single source of truth. No duplication, no sync problem. (Source: [Notion Database Reference](https://developers.notion.com/reference/database))

### DD-4: Denormalized View Config Columns

**Decision:** Frequently-queried view fields (`group_by`, `sub_group_by`, `board_group_property`, `hide_empty_groups`, `filter_config`, `sort_config`) are stored as dedicated columns on `database_views` rather than inside the JSON `config` blob.

**Rationale:** SQLite cannot index inside JSON blobs. Queries like "find all views grouped by property X" or "find all views with active filters" require full-table scans with `json_extract()` if everything is in a single JSON column. Denormalizing the most-queried fields enables standard `WHERE` clauses and indexed lookups. The remaining config (visibleProperties, colorRules, cardSize, dateProperty, columnWidths) stays in the JSON `config` column because it's only read after loading a specific view — never queried across views.

### DD-5: Strictly Sequential Phase Execution

**Decision:** All 9 phases execute in strict sequence: Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. No parallel execution of phases.

**Rationale:** Each phase's completion criteria must be fully verified (code merged, all tests green) before the next phase begins. Parallel phase execution risks incomplete foundations and hard-to-debug integration issues. Strict sequencing ensures each layer is rock-solid before the next layer builds on it. This was proven effective in previous milestones.

---

## Data Model

### New Tables

```sql
-- 006_databases.sql

-- Database container — links a page to a database identity.
-- id = page_id (same UUID, see DD-0). page_id kept for explicit FK.
-- No title/icon columns — the page's title and icon are canonical (see DD-3).
CREATE TABLE IF NOT EXISTS databases (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  description TEXT DEFAULT NULL,
  is_locked   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (id = page_id)
);

CREATE INDEX IF NOT EXISTS idx_databases_page ON databases(page_id);

-- Property schema (one row per property per database)
CREATE TABLE IF NOT EXISTS database_properties (
  id          TEXT NOT NULL,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  config      TEXT NOT NULL DEFAULT '{}',
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, database_id)
);

CREATE INDEX IF NOT EXISTS idx_db_props ON database_properties(database_id);

-- Database views (one per view per database)
-- Frequently-queried fields are denormalized into columns for query performance.
-- `config` holds the remaining per-view JSON (visibleProperties, colorRules, cardSize, etc.).
CREATE TABLE IF NOT EXISTS database_views (
  id                   TEXT PRIMARY KEY,
  database_id          TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL DEFAULT 'Default view',
  type                 TEXT NOT NULL DEFAULT 'table',
  group_by             TEXT DEFAULT NULL,
  sub_group_by         TEXT DEFAULT NULL,
  board_group_property TEXT DEFAULT NULL,
  hide_empty_groups    INTEGER NOT NULL DEFAULT 0,
  filter_config        TEXT NOT NULL DEFAULT '{"conjunction":"and","rules":[]}',
  sort_config          TEXT NOT NULL DEFAULT '[]',
  config               TEXT NOT NULL DEFAULT '{}',
  sort_order           REAL NOT NULL DEFAULT 0,
  is_locked            INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_db_views ON database_views(database_id);

-- Database membership (which pages/rows belong to which database)
CREATE TABLE IF NOT EXISTS database_pages (
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (database_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_db_pages ON database_pages(database_id);
CREATE INDEX IF NOT EXISTS idx_db_pages_page ON database_pages(page_id);
```

```sql
-- 007_page_property_values.sql

-- Property values (one row per page per property)
CREATE TABLE IF NOT EXISTS page_property_values (
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT 'null',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id, property_id, database_id),
  FOREIGN KEY (property_id, database_id)
    REFERENCES database_properties(id, database_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ppv_page ON page_property_values(page_id);
CREATE INDEX IF NOT EXISTS idx_ppv_db ON page_property_values(database_id);
```

### Why a Junction Table (`database_pages`)?

Using `database_pages` instead of just `pages.parent_id`:
- A page can appear in **multiple databases** (via linked database views)
- A page can be a database row AND have a parent page (nested in the sidebar tree)
- Clean separation: the `pages` table stays purely about page identity/content
- Membership is decoupled from the page tree — deleting a database doesn't orphan child pages

### How a Page Becomes a Database

A page is a database when a row exists in `databases` with `page_id = pages.id`. The `databases` table is the source of truth for "is this page a database?":
- `databases.id` = `databases.page_id` = `pages.id` — always the same UUID (enforced by CHECK constraint, see DD-0)
- The page's `title`, `icon`, and tree position come from the `pages` table — there are no duplicate title/icon columns on `databases` (see DD-3)
- The `databases` row adds only database-specific metadata: `description`, `is_locked`

### Property Value Encoding

All property values stored as JSON in `page_property_values.value`:

```json
{ "type": "select", "select": { "id": "abc", "name": "Doing", "color": "blue" } }
{ "type": "number", "number": 42 }
{ "type": "date", "date": { "start": "2025-03-01", "end": "2025-03-15" } }
{ "type": "relation", "relation": [{ "id": "page-uuid-1" }, { "id": "page-uuid-2" }] }
{ "type": "checkbox", "checkbox": true }
{ "type": "rich_text", "rich_text": [{ "type": "text", "content": "Hello" }] }
{ "type": "files", "files": [{ "name": "spec.pdf", "type": "external", "external": { "url": "https://example.com/spec.pdf" } }] }
```

### View Config Schema

Frequently-queried fields are **denormalized into `database_views` columns** for query performance (e.g., `WHERE group_by = ?`). The TypeScript interface splits into two layers:

```typescript
// Denormalized columns on database_views table — queried by SQL directly
interface IDatabaseViewColumns {
  groupBy: string | null;           // property ID to group by (column: group_by)
  subGroupBy: string | null;        // property ID for sub-grouping (column: sub_group_by)
  boardGroupProperty: string | null;// board: which Select/Status property for columns (column: board_group_property)
  hideEmptyGroups: boolean;         // column: hide_empty_groups
  filterConfig: IFilterGroup;       // compound AND/OR filter tree (column: filter_config)
  sortConfig: ISortRule[];          // ordered sort rules (column: sort_config)
}

// Remaining config stored in JSON `config` column
interface IDatabaseViewConfig {
  visibleProperties: string[];      // property IDs in display order
  colorRules?: IColorRule[];        // conditional coloring
  cardSize?: 'small' | 'medium' | 'large'; // gallery-specific
  dateProperty?: string;            // calendar/timeline: which property
  dateEndProperty?: string;         // timeline: range end property
  columnWidths?: Record<string, number>; // table: per-column width in px
}

// Combined interface — what consumers receive from DatabaseDataService.getViews()
interface IDatabaseView {
  id: string;
  databaseId: string;
  name: string;
  type: 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline';
  sortOrder: number;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  // Denormalized columns (IDatabaseViewColumns)
  groupBy: string | null;
  subGroupBy: string | null;
  boardGroupProperty: string | null;
  hideEmptyGroups: boolean;
  filterConfig: IFilterGroup;
  sortConfig: ISortRule[];
  // JSON config (IDatabaseViewConfig)
  config: IDatabaseViewConfig;
}
```

---

## Module Architecture

### Where Database Code Lives

The database system is **integrated into the canvas built-in**, not a separate tool. All files live under `src/built-in/canvas/database/`:

```
src/built-in/canvas/
  ├── main.ts                         (MODIFIED — adds database activation)
  ├── canvasTypes.ts                  (MODIFIED — adds IPage.isDatabase or lookup)
  ├── canvasSidebar.ts                (MODIFIED — database icons, open behavior)
  ├── canvasDataService.ts            (UNCHANGED — pages stay pages)
  │
  ├── database/
  │     ├── databaseTypes.ts          IDatabase, IDatabaseProperty, IPropertyValue,
  │     │                             IDatabaseView, IDatabaseViewConfig, etc.
  │     ├── databaseDataService.ts    CRUD for databases, properties, views, values
  │     ├── databaseEditorProvider.ts EditorProvider for database views
  │     ├── databaseRowPropertyBar.ts Property display above Tiptap editor for db rows
  │     ├── database.css              All database view styles
  │     │
  │     ├── views/
  │     │     ├── viewRenderer.ts     Base view renderer (abstract)
  │     │     ├── viewTabs.ts         View tab bar (create, switch, rename, ...)
  │     │     ├── tableView.ts        Table/spreadsheet layout
  │     │     ├── boardView.ts        Kanban board layout
  │     │     ├── listView.ts         Minimal list layout
  │     │     ├── galleryView.ts      Card gallery layout
  │     │     ├── calendarView.ts     Calendar layout
  │     │     └── timelineView.ts     Timeline/Gantt layout
  │     │
  │     ├── filters/
  │     │     ├── filterTypes.ts      IFilterRule, IFilterGroup, operators
  │     │     ├── filterEngine.ts     Evaluate filter trees against row data
  │     │     └── filterUI.ts         Filter builder UI components
  │     │
  │     ├── properties/
  │     │     ├── propertyRenderers.ts  Read-only cell renderers per type
  │     │     ├── propertyEditors.ts    Cell editors per property type
  │     │     ├── propertyConfig.ts     Property add/remove/reorder/rename
  │     │     └── formulaEngine.ts      Formula parser + evaluator
  │     │
  │     └── relations/
  │           ├── relationResolver.ts   Resolve relations across databases
  │           └── rollupEngine.ts       Compute rollup aggregations
  │
  ├── extensions/
  │     └── databaseInlineNode.ts     (NEW — Tiptap node, imports from BlockRegistry only)
  │
  └── migrations/
        ├── 001_canvas_schema.sql     (existing)
        ├── 002_page_properties.sql   (existing)
        ├── 003_page_settings.sql     (existing)
        ├── 004_content_schema_version.sql (existing)
        ├── 005_block_graph_and_page_revision.sql (existing)
        ├── 006_databases.sql         (NEW)
        └── 007_page_property_values.sql (NEW)
```

### Dependency Rules for Database Code

The `database/` directory is **not a gate** — it does not have gate-level import rules. However:

- **Database files may import from:** `platform/` (events, lifecycle, types), `src/ui/` (reusable primitives), `canvasTypes.ts` (page model), `databaseTypes.ts` (database model)
- **Database files may NOT import from:** canvas registries (BlockRegistry, CanvasMenuRegistry, etc.), canvas extensions, canvas menus, canvas handles
- **The one exception:** `extensions/databaseInlineNode.ts` is a canvas block extension and follows BlockRegistry gate rules — it imports only from `BlockRegistry`
- **Database files may use** `window.parallxElectron.database` for IPC (same bridge as `CanvasDataService`)

### Integration Points Summary

| Existing File | Change | Reason |
|--------------|--------|--------|
| `canvas/main.ts` | Add `DatabaseDataService` creation, register `database` editor provider, add `canvas.newDatabase` command | Database activation wired into canvas lifecycle |
| `canvas/canvasSidebar.ts` | Add database detection + icon + open-as-database logic | Sidebar shows databases in same tree |
| `canvas/migrations/` | Add `006_databases.sql`, `007_page_property_values.sql` | Schema evolution for database tables |
| `canvas/config/blockRegistry.ts` | Add `databaseInlineNode` to block extensions list | Inline database block registration (Phase 6) |
| `tests/unit/gateCompliance.test.ts` | Add `databaseInlineNode.ts` to block extension set | Gate compliance for inline node (Phase 6) |

---

## M8.1 — Data Layer + Table View + View System + Board View

### Phase 1 — Data Layer Foundation

> **Vision:** Establish the database data model in the existing SQLite database, create a typed data service that follows the `CanvasDataService` pattern, and verify every CRUD path with unit tests. At the end of this phase, we have no UI — but a rock-solid, fully-tested foundation that all subsequent phases build on.

#### 1.1 Database Types (`database/databaseTypes.ts`)

**Tasks:**
- [x] Create `databaseTypes.ts` with all interfaces:
  - `IDatabase` — database identity and metadata (id, pageId, description, isLocked)
  - `IDatabaseProperty` — property schema (id, name, type, config, sort_order)
  - `IPropertyValue` — typed property value (discriminated union by property type)
  - `IDatabaseView` — view identity, type, denormalized columns + JSON config
  - `IDatabaseViewColumns` — denormalized fields (groupBy, subGroupBy, boardGroupProperty, hideEmptyGroups, filterConfig, sortConfig)
  - `IDatabaseViewConfig` — remaining JSON config (visibleProperties, colorRules, cardSize, dateProperty, columnWidths)
  - `IDatabaseView` = view identity + `IDatabaseViewColumns` + `IDatabaseViewConfig` (combined interface for consumers)
  - `IFilterRule`, `IFilterGroup` — compound filter tree model
  - `ISortRule` — sort property + direction
  - `IColorRule` — conditional color rule
  - `IDatabaseRow` — a page + its property values in a database context
- [x] Define property type discriminator union: `'title' | 'rich_text' | 'number' | 'select' | 'multi_select' | 'status' | 'date' | 'checkbox' | 'url' | 'email' | 'phone_number' | 'files' | 'relation' | 'rollup' | 'formula' | 'created_time' | 'last_edited_time' | 'unique_id'`
- [x] Define filter operator maps per property type (which operators for which types)
- [x] Define `IDatabaseDataService` interface (all CRUD methods)
- [x] Define change event types: `DatabaseChangeKind`, `DatabaseChangeEvent`, `PropertyChangeEvent`, `RowChangeEvent`

**How it integrates:** Types are co-located in `database/databaseTypes.ts`. They import `IPage` from `canvasTypes.ts` for the row model. No runtime coupling — type-only imports.

#### 1.2 Migration SQL

**Tasks:**
- [x] Create `migrations/006_databases.sql` — `databases`, `database_properties`, `database_views`, `database_pages` tables with all indices
- [x] Create `migrations/007_page_property_values.sql` — `page_property_values` table with indices and composite foreign key
- [x] Verify both migrations apply cleanly on an existing workspace with pages data
- [x] Verify `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` for idempotency

**How it integrates:** Files go in `src/built-in/canvas/migrations/`. The existing `_runMigrations()` in `canvas/main.ts` calls `electron.database.migrate(migrationsDir)` which picks up `006_*.sql` and `007_*.sql` automatically via lexicographic ordering. The `_migrations` table tracks them. No code changes to the migration runner.

#### 1.3 Database Data Service (`database/databaseDataService.ts`)

**Tasks:**
- [x] Create `DatabaseDataService` class extending `Disposable`
- [x] Private `_db` accessor to `window.parallxElectron.database` (same pattern as `CanvasDataService._db`)
- [x] Row mapper: `rowToDatabase()`, `rowToProperty()`, `rowToView()`, `rowToPropertyValue()`
- [x] **Database CRUD:**
  - `createDatabase(pageId)` → creates a `databases` row (id = pageId) + default "Title" property + default "Table" view
  - `getDatabase(databaseId)` → single database with properties and views
  - `getDatabaseByPageId(pageId)` → lookup database from page ID (for sidebar detection)
  - `updateDatabase(databaseId, updates)` → update description, is_locked
  - `deleteDatabase(databaseId)` → cascading delete of properties, views, values, membership (the page itself is deleted separately via `CanvasDataService.deletePage()` — `ON DELETE CASCADE` on `databases.page_id` handles the FK)
- [x] **Property CRUD:**
  - `addProperty(databaseId, name, type, config?)` → insert with next sort_order
  - `updateProperty(databaseId, propertyId, updates)` → rename, change config
  - `removeProperty(databaseId, propertyId)` → delete property + all its values
  - `reorderProperties(databaseId, orderedIds)` → bulk sort_order update
- [x] **Row membership:**
  - `addRow(databaseId, pageId?)` → create a new page + add to `database_pages` + create default property values (uses `runTransaction` for atomicity)
  - `removeRow(databaseId, pageId)` → remove from `database_pages` + delete property values (page itself is NOT deleted — it's still a page)
  - `getRows(databaseId)` → all pages in database with their property values, ordered by sort_order
  - `reorderRows(databaseId, orderedPageIds)` → bulk sort_order update in `database_pages`
- [x] **Property value CRUD:**
  - `setPropertyValue(databaseId, pageId, propertyId, value)` → upsert
  - `getPropertyValues(databaseId, pageId)` → all values for a page in a database
  - `batchSetPropertyValues(databaseId, pageId, values[])` → transactional multi-set
- [x] **View CRUD:**
  - `createView(databaseId, name, type, config?)` → insert with next sort_order (filters/sorts go in denormalized columns; rest in `config` JSON)
  - `getViews(databaseId)` → all views for database, ordered (maps denormalized columns + JSON to `IDatabaseView`)
  - `updateView(viewId, updates)` → name, type, denormalized columns, config JSON, is_locked
  - `deleteView(viewId)` → delete (prevent deleting last view)
  - `duplicateView(viewId)` → deep-copy all columns + config into new view
  - `reorderViews(databaseId, orderedIds)` → bulk sort_order update
- [x] **Events:** `onDidChangeDatabase`, `onDidChangeProperty`, `onDidChangeRow`, `onDidChangeView` — each fires with the appropriate change event type

**How it integrates:** Created **eagerly** in `canvas/main.ts` alongside `CanvasDataService` during activation — not lazily on first database access. This matches the `CanvasDataService` lifecycle pattern: the service exists for the entire session, avoids null-check branching throughout the codebase, and keeps the activation sequence predictable. Both services share the same `window.parallxElectron.database` IPC bridge. The `DatabaseDataService` constructor takes no arguments. It's passed to the `DatabaseEditorProvider` and to the sidebar for database detection.

#### 1.4 Unit Tests

**Tasks:**
- [x] Unit tests for `DatabaseDataService` — all CRUD paths
  - Create database → verify default property + default view created
  - Add/update/remove properties → verify schema changes
  - Add/remove rows → verify page creation + membership + value cleanup
  - Set/get property values → verify JSON encoding round-trip
  - Create/update/delete/duplicate views → verify config persistence
  - Delete database → verify cascading cleanup
- [x] Unit tests for row mapper functions
- [x] Unit tests for migration idempotency (run migrations twice — no errors)

**How it integrates:** Tests live in `tests/unit/database/`. They use the same test harness and vitest config as existing canvas unit tests.

#### Completion Criteria (Phase 1)

- [x] All database types defined and exported in `databaseTypes.ts`
- [x] Both migration files apply cleanly on existing workspaces
- [x] `DatabaseDataService` CRUD works via IPC round-trip
- [x] Unit tests cover all CRUD paths + edge cases
- [x] `npm run build` — zero errors
- [x] Existing unit tests unaffected
- [x] Existing E2E tests unaffected

---

### Phase 2 — Table View (MVP)

> **Vision:** Deliver the first visual database rendering: a spreadsheet-like Table view where users can see rows and columns, edit cell values inline, add/remove properties, and create new rows. Opening a database page in the sidebar shows this view instead of the Tiptap editor. Clicking a row's title opens that row as a regular canvas page in the editor.

#### 2.1 Database Editor Provider (`database/databaseEditorProvider.ts`)

**Tasks:**
- [ ] Create `DatabaseEditorProvider` class following the `CanvasEditorProvider` pattern
- [ ] Constructor takes `DatabaseDataService` + `openEditor` callback (for navigating to row pages)
- [ ] `createEditorPane(container, input)` — extracts `databaseId` from `input.instanceId`, creates a `DatabaseEditorPane`
- [ ] `DatabaseEditorPane` lifecycle: load database → render view tab bar → render active view
- [ ] Register in `canvas/main.ts`: `api.editors.registerEditorProvider('database', ...)`

**How it integrates:** Follows the exact pattern of `CanvasEditorProvider`. The workbench's editor system routes `typeId: 'database'` inputs to this provider. The `CanvasSidebar` opens databases with `api.editors.openEditor({ typeId: 'database', instanceId: databaseId })`.

#### 2.2 Sidebar Changes (`canvasSidebar.ts` modifications)

**Tasks:**
- [ ] Add `DatabaseDataService` as a second constructor parameter
- [ ] On tree render, check each page: call `databaseDataService.getDatabaseByPageId(pageId)` to detect databases
- [ ] For database pages: show table icon (📊 or SVG equivalent) instead of default page icon
- [ ] For database pages: click opens with `typeId: 'database'` instead of `typeId: 'canvas'`
- [ ] Add "New Database" to the `+` button dropdown and context menu
- [ ] "New Database" creates a page (via `CanvasDataService.createPage()`) + a database record (via `DatabaseDataService.createDatabase(pageId)`) + opens it

**How it integrates:** `CanvasSidebar` constructor signature changes. `canvas/main.ts` passes both services. The sidebar's `_renderTreeItem()` method gains a database detection branch.

#### 2.3 Table View Renderer (`database/views/tableView.ts`)

**Tasks:**
- [ ] Create `TableView` class extending `Disposable`
- [ ] Constructor: `(container: HTMLElement, databaseDataService: DatabaseDataService, database: IDatabase, view: IDatabaseView, openEditor: (opts) => Promise<void>)`
- [ ] Header row: property name cells + type indicators + column resize handles + "+" add-column button
- [ ] Data rows: one row per database page, cells render property values
- [ ] Row hover: subtle highlight
- [ ] Click cell → activate cell editor (inline)
- [ ] Click title cell → open page in canvas editor via `openEditor({ typeId: 'canvas', instanceId: pageId })`
- [ ] "+ New" button at bottom → creates new row via `databaseDataService.addRow()`
- [ ] Column resize: drag column borders to adjust width (stored in view config)
- [ ] Reactive updates: listen to `databaseDataService.onDidChangeRow` and re-render affected rows

#### 2.4 Cell Renderers (`database/properties/propertyRenderers.ts`)

**Tasks:**
- [ ] Create renderer functions (pure DOM creation, no side effects):
  - `renderTitle(value, container)` — bold text, clickable
  - `renderRichText(value, container)` — plain text display
  - `renderNumber(value, config, container)` — formatted with number format
  - `renderSelect(value, container)` — colored pill badge
  - `renderMultiSelect(values, container)` — multiple colored pills
  - `renderStatus(value, container)` — colored pill with group context
  - `renderDate(value, container)` — formatted date string, optional range
  - `renderCheckbox(value, container)` — checkbox element
  - `renderUrl(value, container)` — clickable link with truncation
  - `renderEmail(value, container)` — clickable mailto link
  - `renderPhone(value, container)` — plain text
  - `renderFiles(value, container)` — list of linked file names (external URLs, clickable)
  - `renderTimestamp(value, container)` — relative or absolute formatted time
- [ ] Null/empty value rendering (gray placeholder text)
- [ ] Renderer dispatch: `renderPropertyValue(type, value, config, container)` — routes to correct renderer

#### 2.5 Cell Editors (`database/properties/propertyEditors.ts`)

**Tasks:**
- [ ] Create editor classes (each extends `Disposable`, accepts container + current value, fires `onDidChange`):
  - `TitleEditor` — inline text input, Enter to confirm, Escape to cancel
  - `TextEditor` — inline text input
  - `NumberEditor` — number input with validation
  - `SelectEditor` — dropdown with option list, search, "Create option" at bottom (uses `src/ui/contextMenu` or `src/ui/overlay`)
  - `MultiSelectEditor` — multi-select dropdown with pill display
  - `StatusEditor` — dropdown grouped by status groups (To-do, In progress, Complete)
  - `DateEditor` — date picker popup with optional end date and time zone
  - `CheckboxEditor` — no popup — click toggles value immediately
  - `UrlEditor`, `EmailEditor`, `PhoneEditor` — text input with type-specific validation
  - `FilesEditor` — add/remove external file URLs; each entry has a name + URL (file upload deferred — external links only for M8)
- [ ] Editor dispatch: `createPropertyEditor(type, container, value, config)` → returns editor instance

#### 2.6 Property Configuration (`database/properties/propertyConfig.ts`)

**Tasks:**
- [ ] Property add menu: click "+" on header → popup with property type list → creates property
- [ ] Property rename: double-click header cell → inline text edit
- [ ] Property type change: header context menu → "Change type" → migrate values where possible (e.g., Number→Text preserves string representation)
- [ ] Property delete: header context menu → "Delete property" with confirmation
- [ ] Property reorder: drag column headers to reorder
- [ ] Property-specific config popup:
  - Number: format selector (plain, comma, percent, currency)
  - Select/Multi-Select: option list editor (add, rename, recolor, delete options)
  - Status: option + group management (assign options to groups)

#### Completion Criteria (Phase 2)

- [ ] Full-page database opens in Table view with typed columns
- [ ] All core property types render correctly (Title, Text, Number, Select, Multi-Select, Status, Date, Checkbox, URL, Email, Phone, Files, timestamps)
- [ ] All writable property types are editable inline
- [ ] New rows created with "+ New"
- [ ] Properties can be added, renamed, reordered, deleted
- [ ] Clicking a row title opens the page in the canvas editor
- [ ] Sidebar shows database pages with table icon
- [ ] `npm run build` — zero errors
- [ ] Unit tests for table view rendering logic, cell renderers, cell editors
- [ ] Existing tests unaffected

---

### Phase 3 — View System

> **Vision:** Transform a database from a single-view table into a multi-view workspace. Users create, switch, rename, duplicate, and delete views — each with its own filter, sort, grouping, and property visibility config. This phase establishes the universal "view layer" that all subsequent view types (Board, Gallery, Calendar, Timeline) plug into.

#### 3.1 View Tabs (`database/views/viewTabs.ts`)

**Tasks:**
- [ ] Create `ViewTabBar` class extending `Disposable` — renders a horizontal tab strip
- [ ] Uses `src/ui/tabBar` if compatible, otherwise a new database-specific tab bar
- [ ] Tab per view: icon (view type) + name
- [ ] Click tab → switch active view
- [ ] "+" button → dropdown: choose view type (Table, Board, List, Gallery, Calendar, Timeline) → creates new view via `databaseDataService.createView()`
- [ ] Double-click tab → inline rename
- [ ] Right-click tab → context menu: Duplicate, Delete, Lock/Unlock
- [ ] Drag tabs to reorder → `databaseDataService.reorderViews()`
- [ ] Active view indicator (underline or highlight)

#### 3.2 Filter System

**Tasks:**
- [ ] Create `filters/filterTypes.ts`:
  - `IFilterRule` — `{ propertyId, operator, value }`
  - `IFilterGroup` — `{ conjunction: 'and' | 'or', rules: (IFilterRule | IFilterGroup)[] }` (recursive)
  - Operator enum per property type (see research doc §6 for complete operator lists)
- [ ] Create `filters/filterEngine.ts`:
  - `evaluateFilter(row: IDatabaseRow, filter: IFilterGroup, properties: IDatabaseProperty[])` → boolean
  - Handles nested AND/OR groups recursively
  - Type-specific comparison logic (string contains, number ≥, date is before, etc.)
- [ ] Create `filters/filterUI.ts`:
  - Simple mode: one-line filter bar (Property → Operator → Value)
  - Advanced mode: nested group builder with add/remove/regroup
  - Toggle between simple and advanced
- [ ] Filter state stored in `database_views.filter_config` denormalized column (not inside the JSON `config` blob)
- [ ] Active filter count indicator on view tab / filter button

#### 3.3 Sort System

**Tasks:**
- [ ] Sort builder popup: add sort rules (property + ascending/descending)
- [ ] Multiple sort rules with priority (first rule is primary sort)
- [ ] Drag rules to reorder priority
- [ ] Sort state stored in `database_views.sort_config` denormalized column (not inside the JSON `config` blob)
- [ ] Sort logic in `filterEngine.ts` or co-located: `applySorts(rows, sorts, properties)` → sorted rows
- [ ] Visual indicator: sort arrow on column header in table view

#### 3.4 Grouping

**Tasks:**
- [ ] Group-by selector: choose property from dropdown
- [ ] Rows organized into collapsible sections, one section per unique value
- [ ] Section header: group label + row count + collapse/expand toggle
- [ ] Sub-grouping: second level within each group (choose a second property)
- [ ] "Hide empty groups" checkbox
- [ ] Group ordering: Select/Status groups follow option order; other types use natural sort
- [ ] Group state stored in denormalized `database_views` columns: `group_by`, `sub_group_by`, `hide_empty_groups`

#### 3.5 Property Visibility

**Tasks:**
- [ ] Per-view visible properties list (stored in `IDatabaseViewConfig.visibleProperties`)
- [ ] "Properties" button → panel showing all properties with show/hide checkboxes
- [ ] Drag to reorder visible properties (changes display order, not schema order)
- [ ] Title property always visible (cannot be hidden)

#### Completion Criteria (Phase 3)

- [ ] Multiple views per database, each with independent config
- [ ] Simple and advanced filters evaluate correctly
- [ ] Multi-sort with priority ordering
- [ ] Grouping and sub-grouping render correctly in table view
- [ ] Property visibility is per-view and persists
- [ ] View config round-trips correctly — denormalized columns match `IDatabaseViewColumns`, JSON `config` matches `IDatabaseViewConfig`
- [ ] Unit tests for filter engine, sort logic, grouping, view config serialization (both column and JSON paths)

---

### Phase 4 — Board View

> **Vision:** A Kanban-style board where cards are grouped into columns by a Select or Status property. Dragging a card between columns changes its property value — the most intuitive way to update item status. This phase proves the view system is extensible beyond tables.

#### 4.1 Board Renderer (`database/views/boardView.ts`)

**Tasks:**
- [ ] Create `BoardView` class extending `Disposable`
- [ ] Constructor: same shape as `TableView` (container, service, database, view, openEditor)
- [ ] Board layout: horizontal scrollable row of columns
- [ ] Column per option of the grouping property (Select or Status)
- [ ] "No value" column for rows without a value for the grouping property
- [ ] Column header: option name + colored dot + row count
- [ ] Cards within each column: title + configurable preview properties (from view config)
- [ ] Card cover image: from page cover URL if available
- [ ] "+ New" button at bottom of each column → creates row with that column's property value

#### 4.2 Board Interactions

**Tasks:**
- [ ] Drag card between columns → updates the grouping property value via `databaseDataService.setPropertyValue()`
- [ ] Drag to reorder within a column → updates sort order in `database_pages`
- [ ] Click card → open page in canvas editor
- [ ] Column header click → collapse/expand column
- [ ] Board view respects active filters, sorts (within columns), and property visibility (for card preview)
- [ ] "Hide empty columns" option in view config

#### 4.3 Board View Registration

**Tasks:**
- [ ] Register `BoardView` in the view renderer dispatch (view type `'board'`)
- [ ] View tab "+" menu shows "Board" as a layout option
- [ ] Board-specific config: `database_views.board_group_property` denormalized column (which property determines columns)
- [ ] Default: use first Status or Select property found in schema

#### Completion Criteria (Phase 4)

- [ ] Board view renders with correct column grouping
- [ ] Drag between columns updates the property value
- [ ] Cards display configured preview properties
- [ ] New rows created in a column inherit that column's value (forcing function)
- [ ] Board view respects filters, sorts, and grouping from the view system
- [ ] Unit tests for board layout logic, drag-to-change-status

---

## M8.2 — Additional Views + Inline Databases + Linked Views

### Phase 5 — Additional Views

> **Vision:** Complete the view type catalog with List, Gallery, Calendar, and Timeline layouts. Each plugs into the view system established in Phase 3, automatically gaining filters, sorts, grouping, and property visibility.

#### 5.1 List View (`database/views/listView.ts`)

**Tasks:**
- [ ] Minimal vertical list with one row per database page
- [ ] Each row: title + 2–3 configurable preview properties inline
- [ ] Compact styling (less padding than table, no grid lines)
- [ ] Click row → open page

#### 5.2 Gallery View (`database/views/galleryView.ts`)

**Tasks:**
- [ ] Card grid layout (CSS grid, responsive column count)
- [ ] Card sizes: small, medium, large (stored in view config `cardSize`)
- [ ] Cover image: from page `coverUrl`
- [ ] Card body: title + configurable preview properties
- [ ] Click card → open page

#### 5.3 Calendar View (`database/views/calendarView.ts`)

**Tasks:**
- [ ] Monthly calendar grid (7 columns × 5–6 rows)
- [ ] Configurable date property (`dateProperty` in view config) determines placement
- [ ] Day cells: show page titles that fall on that date
- [ ] Click day → create new row with that date pre-filled
- [ ] Click item → open page
- [ ] Month navigation: prev/next/today buttons

#### 5.4 Timeline View (`database/views/timelineView.ts`)

**Tasks:**
- [ ] Gantt-style horizontal timeline
- [ ] Config: `dateProperty` (start) + `dateEndProperty` (end)
- [ ] Horizontal bars spanning date ranges on a time axis
- [ ] Time scale: day/week/month zoom toggle
- [ ] Drag bar edges to adjust dates
- [ ] Click bar → open page
- [ ] Responsive scrolling with time scale labels

#### Completion Criteria (Phase 5)

- [ ] All four view types render correctly
- [ ] Each view respects filters, sorts, grouping from the view system
- [ ] Per-view property visibility works
- [ ] Unit tests for each view's layout logic

---

### Phase 6 — Inline Databases & Linked Views

> **Vision:** Databases escape the editor pane and embed directly inside canvas page content. Users can create inline databases from the slash menu and create linked views that show another database's data with independent filtering. This bridges the document ↔ structured-data gap at the content level.

#### 6.1 Inline Database Node (`extensions/databaseInlineNode.ts`)

**Tasks:**
- [ ] Create Tiptap node extension: `databaseInline` with attrs `{ databaseId: string, viewId?: string }`
- [ ] NodeView renders: view tab bar + active view (compact mode)
- [ ] Resizable height (drag bottom edge)
- [ ] Import only from `BlockRegistry` (canvas gate rules)
- [ ] Add to `gateCompliance.test.ts` GATE_RULES as a block extension

#### 6.2 Slash Menu Integration

**Tasks:**
- [ ] `/database` → creates a new inline database (creates page + database record + inserts Tiptap node)
- [ ] `/linked view` → popup to search existing databases → creates inline node pointing to selected database with local view config
- [ ] Register both items in the slash menu (via `BlockRegistry`'s `getSlashMenuBlocks()`)

#### 6.3 Linked Database Views

**Tasks:**
- [ ] Linked view: an `IDatabaseView` with a `sourceDatabaseId` reference
- [ ] Source schema changes (add/remove properties) propagate to linked views
- [ ] Row data changes propagate instantly (linked view reads from source database's rows)
- [ ] Independent filters, sorts, grouping, property visibility per linked view

#### 6.4 Full-Page ↔ Inline Conversion

**Tasks:**
- [ ] Convert inline database to full-page: extract from page content, ensure database page exists in sidebar
- [ ] Convert full-page database to inline: embed into a target page as a Tiptap node

#### Completion Criteria (Phase 6)

- [ ] Inline database blocks render inside canvas pages
- [ ] Slash menu creates both new and linked inline databases
- [ ] Linked views show source data without duplication
- [ ] Conversion works both directions
- [ ] `gateCompliance.test.ts` passes with inline node in block extension set

---

## M8.3 — Relations + Rollups + Formulas + Polish

### Phase 7 — Relations & Rollups

> **Vision:** Databases become interconnected. A "Tasks" database can link to a "Projects" database — and a rollup on Projects can compute "% of linked tasks completed". This is the feature that transforms isolated databases into a relational knowledge system.
>
> **Prerequisite:** Phase 6 complete (all view types + inline databases shipped).

#### 7.1 Relation Property Type (`database/relations/relationResolver.ts`)

**Tasks:**
- [ ] Relation property config: choose target database
- [ ] Automatic reciprocal relation creation on target database
- [ ] Cell renderer: list of linked page titles (clickable, opens page)
- [ ] Cell editor: search and select pages from related database (uses `src/ui/overlay` or `src/ui/list`)
- [ ] Self-referential relations (database relating to itself for parent/child)
- [ ] Adding/removing a link on one side updates the reciprocal

#### 7.2 Rollup Property Type (`database/relations/rollupEngine.ts`)

**Tasks:**
- [ ] Rollup property config: select relation → select property on related pages → select aggregation function
- [ ] Full aggregation function set: `count`, `sum`, `average`, `median`, `min`, `max`, `range`, `earliest_date`, `latest_date`, `date_range`, `checked`, `unchecked`, `percent_checked`, `percent_unchecked`, `empty`, `not_empty`, `percent_empty`, `percent_not_empty`, `show_original`, `show_unique`, `unique`
- [ ] Re-evaluation when source data changes (listen to `onDidChangeRow` on related database)
- [ ] Cell renderer appropriate to output type (number, date, text, percentage)

#### Completion Criteria (Phase 7)

- [ ] Relations link pages across databases bidirectionally
- [ ] Reciprocal relations auto-created and auto-synced
- [ ] Rollups compute aggregate values correctly
- [ ] Rollups re-evaluate on source data change
- [ ] Unit tests for relation resolution, reciprocal sync, all rollup functions

---

### Phase 8 — Formulas

> **Vision:** Users define computed properties using expressions that reference other properties in the same row. Formulas are the SQL `SELECT` expressions of the database world — they derive new information without storing it.
>
> **Prerequisite:** Phase 7 complete (relations and rollups shipped).

#### 8.1 Formula Engine (`database/properties/formulaEngine.ts`)

**Tasks:**
- [ ] Expression tokenizer: source string → token stream
- [ ] Expression parser: token stream → AST (recursive descent)
- [ ] Expression evaluator: AST + row property values → computed value
- [ ] Core functions:
  - `prop("PropertyName")` — row property reference
  - `if(condition, then, else)`, `ifs()` — conditional
  - Arithmetic: `+`, `-`, `*`, `/`, `%`, `abs()`, `ceil()`, `floor()`, `round()`, `min()`, `max()`, `sqrt()`
  - String: `length()`, `contains()`, `replace()`, `replaceAll()`, `concat()`, `join()`, `slice()`, `lower()`, `upper()`, `trim()`
  - Date: `now()`, `today()`, `dateAdd()`, `dateSubtract()`, `dateBetween()`, `formatDate()`, `minute()`, `hour()`, `day()`, `month()`, `year()`
  - Logical: `and()`, `or()`, `not()`, `empty()`, `equal()`, `unequal()`
  - Type: `toNumber()`, `toBoolean()`
- [ ] Output type detection: formula expression → inferred output type (text, number, date, boolean)
- [ ] Error handling: parse errors, runtime errors (division by zero, type mismatch) surfaced with clear messages

#### 8.2 Formula UI

**Tasks:**
- [ ] Formula property config: expression editor with syntax error indication
- [ ] Error display: inline error message below expression input
- [ ] Cell renderer: dispatches to appropriate renderer based on output type
- [ ] Re-evaluation when any dependency property changes (track `prop()` references in AST)

#### Completion Criteria (Phase 8)

- [ ] Formulas compute derived values from row properties
- [ ] All documented functions implemented
- [ ] Parse and runtime errors shown clearly
- [ ] Re-evaluation on dependency change
- [ ] Unit tests for tokenizer, parser, evaluator, every function category

---

### Phase 9 — Polish & Advanced Features

> **Vision:** Close the remaining Notion parity gaps with templates, conditional coloring, locking, and property enhancements. These features make the system feel complete and professional.
>
> **Prerequisite:** Phase 8 complete (formulas shipped).

#### 9.1 Database Templates

**Tasks:**
- [ ] Multiple templates per database (pre-configured page content + property values)
- [ ] Default template per view (creating a row in this view uses this template)
- [ ] Dynamic values in templates: `Now`, `Today`
- [ ] Template picker UI when creating new rows (if multiple templates exist)

#### 9.2 Conditional Color

**Tasks:**
- [ ] Per-view color rules: `{ propertyId, operator, value, color }` → row/card background color
- [ ] Color rule builder UI (add/remove/edit rules)
- [ ] Apply to Table (row background) and Board (card background)
- [ ] Colors stored in `IDatabaseViewConfig.colorRules`

#### 9.3 Database & View Locking

**Tasks:**
- [ ] Lock database: `databases.is_locked = 1` → prevents property add/remove/rename
- [ ] Lock view: `database_views.is_locked = 1` → prevents filter/sort/grouping/visibility changes
- [ ] Lock indicators: 🔒 icon in sidebar and view tab
- [ ] Locked state enforced in data service (reject mutations) + UI (disable controls)

#### 9.4 Sidebar Polish

**Tasks:**
- [ ] Context menu additions for database pages: "Open as database" / "Open as page"
- [ ] "Open as page" opens the database page's content in the Tiptap editor (for editing description/body)
- [ ] Database creation from "+" dropdown: "New Database" command
- [ ] Duplicate database (copies schema + views, optionally copies rows)

#### 9.5 Property Enhancements

**Tasks:**
- [ ] Unique ID property: auto-incremented integer with optional prefix (e.g., "TASK-123")
- [ ] Property page-top visibility: "Always show" / "Hide when empty" / "Always hide" (per property, stored in config)
- [ ] When opening a database row as a page, show its property values above the content body via a **`DatabaseRowPropertyBar` wrapper component** — this is a new component that wraps the existing `CanvasEditorPane` output. The `CanvasEditorProvider` remains unaware of database concepts. The wrapper detects "this page is a database row" via `DatabaseDataService`, queries the page's property values, and renders the property bar above the Tiptap editor. Visibility per property: "Always show" / "Hide when empty" / "Always hide" (stored in property config).

#### Completion Criteria (Phase 9)

- [ ] Templates work for new row creation
- [ ] Conditional coloring renders in Table and Board views
- [ ] Locking prevents config changes (UI + data service enforcement)
- [ ] Sidebar context menu supports dual open modes
- [ ] Property page-top display works when viewing rows as pages
- [ ] All polish features unit tested

---

## Execution Order Summary

| Sub-Milestone | Phase | Focus | Prerequisite |
|---------------|-------|-------|-------------|
| **M8.1** | Phase 1 | Data layer foundation | — |
| **M8.1** | Phase 2 | Table view (MVP) | Phase 1 |
| **M8.1** | Phase 3 | View system (filters, sorts, grouping) | Phase 2 |
| **M8.1** | Phase 4 | Board view | Phase 3 |
| **M8.2** | Phase 5 | Additional views (List, Gallery, Calendar, Timeline) | Phase 4 |
| **M8.2** | Phase 6 | Inline databases & linked views | Phase 5 |
| **M8.3** | Phase 7 | Relations & rollups | Phase 6 |
| **M8.3** | Phase 8 | Formulas | Phase 7 |
| **M8.3** | Phase 9 | Polish (templates, color, locking, property enhancements) | Phase 8 |

**Execution is strictly sequential.** Each phase must be fully complete — code merged, tests passing — before the next phase begins. No parallel phase execution.

---

## Excluded (Out of Scope for Milestone 8)

These items are explicitly NOT part of this milestone. They are listed here to prevent scope creep.

| Item | Reason |
|------|--------|
| **Chart view** | Requires charting library evaluation. Separate milestone. |
| **Form view** | Public form submission requires auth/sharing infrastructure not yet built. |
| **Repeating templates** | Requires background scheduling (cron-like). |
| **Real-time collaboration** | Requires sync infrastructure (CRDT/OT). |
| **Import/export (Notion CSV, Notion API)** | Separate data migration milestone after database system is stable. |
| **API surface (`parallx.databases.*`)** | Tool API for databases deferred until the database system is stable and proven. |
| **Cross-workspace databases** | Current architecture is workspace-scoped. |
| **Database permissions / sharing** | Single-user app — permissions require multi-user infrastructure. |
| **People property type** | Requires user identity system not yet built. |
| **Automations / button triggers** | Requires automation engine. Separate milestone. |
