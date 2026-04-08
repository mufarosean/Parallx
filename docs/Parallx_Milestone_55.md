# Milestone 55 — Canvas Page Properties (Obsidian-Style)

**Date:** 2026-04-08  
**Status:** Planning  
**Branch:** `canvas-properties` (create from `ui-updates`)

## Vision

Every canvas page can have **typed properties** displayed in a collapsible bar
below the page title — mirroring Obsidian's property system. Properties are
workspace-global in type (a property named "status" is always a `select`
everywhere) and page-local in value. No database containers, no Notion-style
views, no relation/rollup/formula machinery.

The AI can read, write, and query properties via tool calls. Visual views
(board, calendar, table) are deferred — they can be built later as saved
queries over the flat property model.

## Reference

- **Obsidian Properties:** https://obsidian.md/help/Editing+and+formatting/Properties
- **User screenshot:** Obsidian daily journal entry with Properties section
  showing Created (datetime), Date (date), tags (multi-select chips),
  Growth Plan (select/relation), and "+ Add property" button.

## Current State (Pre-Cleanup)

### What exists and STAYS

| Asset | Purpose | Status |
|-------|---------|--------|
| `pages` table (001) | All canvas pages — id, parent_id, title, icon, content (Tiptap JSON), sort_order, revision, cover, font, etc. | Untouched |
| `page_properties` table (002) | Per-page key-value store: `(id, page_id, key, value_type, value)` | Exists but never wired to UI |
| `canvas_blocks` table (005) | Block-graph foundation (future use) | Untouched |
| `vec_embeddings` / `fts_chunks` (008) | RAG / search indexes | Untouched |
| `canvasDataService.ts` | Page CRUD, auto-save, revision control | Untouched |
| `canvasEditorProvider.ts` | Page editor creation and lifecycle | Cleanup: remove `IDatabaseDataService` import (line 32), constructor param `_databaseDataService` (line 68), `databaseDataService` getter on provider class (lines 147-149) and pane class (line 193), `databaseDataService` from `createEditorExtensions()` context (line 256) |
| `canvasSidebar.ts` | Page tree sidebar | **HEAVY cleanup: ~170 lines.** Remove `IDatabaseDataService`/`IDatabaseView` imports, 3 private fields, constructor param, database event subs, tree refresh database detection, `_filterOutDatabaseRows()`, `_getDatabaseViews()`, `_renderDatabaseViewNode()`, `_selectAndOpenDatabaseView()`, `_createDatabase()`, `_appendDatabaseInlineToParent()`, database icon rendering in both `_renderFavoriteRow()` and `_renderNode()`, "New Database" menu entries, `VIEW_TYPE_ICON_IDS` constant |
| `src/services/databaseService.ts` | Renderer-side SQLite IPC wrapper | Untouched — this is the generic DB bridge, not the Notion system |
| `electron/database.cjs` | Main-process SQLite manager | Untouched |
| All migrations `001–005`, `008` | Schema for pages, properties, blocks, revisions, vectors | Untouched |

### What gets REMOVED (the Notion database overlay)

| Asset | Lines | Why |
|-------|-------|-----|
| `src/built-in/canvas/database/` (24 files) | ~12,000 | Entire Notion database system: views, formulas, rollups, relations, filters, templates, toolbar, registry |
| `src/built-in/canvas/extensions/databaseInlineNode.ts` | ~400 | Tiptap extension for inline database embed |
| `src/built-in/canvas/extensions/databaseFullPageNode.ts` | ~200 | Tiptap extension for full-page database block |
| `src/built-in/canvas/database/databaseEditorProvider.ts` | ~600 | Full-page database editor (counted in the 24 files above) |
| Block registry entries for `databaseInline`, `databaseFullPage`, `linkedView` | ~80 | Slash-menu and block definitions |
| Block registry database re-exports | ~30 | Type and value re-exports from `databaseRegistry.js` at bottom of `blockRegistry.ts` |
| `tiptapExtensions.ts` entries | 2 lines | `'databaseInline'`/`'databaseFullPage'` in `UNIQUE_ID_BLOCK_TYPES` |
| `canvas/main.ts` database wiring | ~30 | `DatabaseDataService` + `DatabaseEditorProvider` imports, instantiation, registration, duplicate-page database detection |
| `canvas.css` database rules | ~12 | `.canvas-node--database-view` CSS rules |
| `tests/unit/databaseInlineNode.test.ts` | ~80 | Tests for removed extension |
| `tests/unit/databaseDataService.test.ts` | ~150 | Tests for removed data service |
| `tests/unit/databaseTextEntryDialog.test.ts` | ~50 | Tests for removed dialog |
| Migrations `006_databases.sql`, `007_page_property_values.sql` | ~80 | Tables stay in schema (SQLite can't drop), code stops using them |

**Critical constraint:** The `databases`, `database_properties`, `database_views`,
`database_pages`, and `page_property_values` (007) **tables stay in the SQLite
schema** — SQLite doesn't support DROP TABLE in migrations cleanly, and leaving
dormant tables is harmless. The code simply stops referencing them.

### What gets ADDED

| Asset | Purpose |
|-------|---------|
| `property_definitions` table (new migration 009) | Workspace-global property type registry: `(name PK, type, config JSON, created_at, updated_at)` |
| `src/built-in/canvas/properties/` directory | New property system: types, bar UI, editors, service |
| Property bar component | Obsidian-style collapsible section below page title with typed property rows |
| "+ Add property" picker | Shows existing definitions or creates new ones |
| AI tool calls | `list_properties`, `get_page_properties`, `set_property`, `find_pages_by_property` |

## Property Types

| Type | UI | Value Format | Config |
|------|-----|-------------|--------|
| `text` | Single-line input | `string` | — |
| `number` | Numeric input | `number \| null` | `{ format?: 'number' \| 'percent' \| 'currency' }` |
| `checkbox` | Toggle switch | `boolean` | — |
| `date` | Date picker | `string` (ISO date) | — |
| `datetime` | Date + time picker | `string` (ISO datetime) | — |
| `tags` | Colored tag chips with × | `string[]` | `{ options?: { value: string; color: string }[] }` |
| `select` | Dropdown / pill | `string` | `{ options: { value: string; color: string }[] }` |
| `url` | Input with link icon | `string` | — |

### Workspace-global type rule

Once a property name is assigned a type, all pages using that name share the
type. Example: if "status" is created as `select` with options ["To-do",
"In Progress", "Done"], every page that adds "status" gets those same options.

This matches Obsidian's behavior exactly.

### Default properties

These are pre-created in every workspace (users can remove them):

| Name | Type | Purpose |
|------|------|---------|
| `tags` | `tags` | General-purpose categorization |
| `created` | `datetime` | Auto-set on page creation (read-only) |

## Schema Design

### Migration 009: `property_definitions`

```sql
CREATE TABLE IF NOT EXISTS property_definitions (
  name       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Existing: `page_properties` (migration 002, already exists)

```sql
-- Already exists, no migration needed:
-- page_properties (id, page_id, key, value_type, value)
-- key references property_definitions.name by convention (not FK — allows ad-hoc)
-- value stores JSON-encoded property value
```

## Page Relationships

Three mechanisms, no relation-type property needed:

1. **Parent-child** — `pages.parent_id` (structural hierarchy, already works)
2. **Shared tags** — Pages with same tag values are implicitly linked
3. **Inline links** — `[[Page Name]]` references in Tiptap content

AI can query all three: "find child pages of X", "find pages tagged Y",
"find pages linking to Z".

## Property Bar UI Design

Rendered below the page title, above page content. Obsidian-style:

```
┌─────────────────────────────────────────────────────┐
│ Properties                                      [▾] │
│ ┌─────────────┬───────────────────────────────────┐ │
│ │ ⏱ Created   │ 📅 04/08/2026 10:30 AM            │ │
│ │ 📅 Date     │ 📅 04/08/2026  🔗                  │ │
│ │ 🏷 tags     │ [Daily ×] [Emotional ×] [Work ×]  │ │
│ │ ≡ Category  │ Journal Entry                      │ │
│ └─────────────┴───────────────────────────────────┘ │
│ + Add property                                      │
└─────────────────────────────────────────────────────┘
```

- Collapsible via chevron button
- Property name on the left with type icon
- Property value editor on the right (type-specific)
- "+ Add property" at bottom opens a picker (existing definitions + "Create new")
- Tag chips use colored backgrounds with × dismiss buttons
- Keyboard: Cmd+; to add property, arrow keys to navigate, Tab between name/value

## AI Integration

Four tool calls for the `@canvas` participant:

| Tool | Parameters | Returns |
|------|-----------|---------|
| `list_property_definitions` | — | All workspace property definitions |
| `get_page_properties` | `pageId` | All property values for a page |
| `set_page_property` | `pageId, propertyName, value` | Updated property value |
| `find_pages_by_property` | `propertyName, operator, value` | Matching pages |

Operators for `find_pages_by_property`: `equals`, `contains`, `is_empty`,
`is_not_empty`, `greater_than`, `less_than` (type-dependent).

## Execution Plan

### Agent Architecture

| Agent | Role |
|-------|------|
| **Property Orchestrator** | Master agent. Owns the vision, runs workers through task→verify→advance cycles. Maintains this doc. 3 full iterations. |
| **Database Cleanup Agent** | Removes the Notion database overlay. Surgical precision — must preserve all page CRUD, page tree, sidebar, editor functionality. |
| **Property Builder Agent** | Adds property_definitions table, builds property bar UI, wires property CRUD, adds AI tool calls. |
| **Property Verifier** | Runs after each agent. Validates: all pages load, content intact, properties work end-to-end, no regressions. |

### Domain Execution Order

**Domain 1: Database Cleanup** (Cleanup Agent)
- Remove all 24 files in `src/built-in/canvas/database/`
- Remove `databaseInlineNode.ts` extension
- Remove database block registry entries from `blockRegistry.ts`
- Remove database imports from `canvas/main.ts`, `canvasEditorProvider.ts`, `canvasSidebar.ts`
- Remove database test files
- Verify: `tsc --noEmit` clean, production build succeeds, all remaining tests pass, canvas pages still load/save/navigate

**Domain 2: Property System Backend** (Builder Agent)
- Create migration `009_property_definitions.sql`
- Create `src/built-in/canvas/properties/propertyTypes.ts` (type definitions)
- Create `src/built-in/canvas/properties/propertyDataService.ts` (CRUD for definitions + values)
- Wire into canvas `main.ts`
- Auto-create default properties (`tags`, `created`) on workspace init
- Verify: property CRUD works via data service, types compile

**Domain 3: Property Bar UI** (Builder Agent)
- Create `src/built-in/canvas/properties/propertyBar.ts` (main component)
- Create `src/built-in/canvas/properties/propertyBar.css` (Obsidian-style)
- Create type-specific editors (text, number, checkbox, date, datetime, tags, select, url)
- Create "+ Add property" picker
- Wire into `canvasEditorProvider.ts` (render below title)
- Verify: property bar renders, values persist, all types work

**Domain 4: AI Tool Integration** (Builder Agent)
- Register 4 AI tools: `list_property_definitions`, `get_page_properties`, `set_page_property`, `find_pages_by_property`
- Wire through canvas tool skill
- Verify: AI can query and set properties via chat

### Iteration Cycle (per domain)

| Iteration | Focus |
|-----------|-------|
| 1 | Major implementation — get it working |
| 2 | Gap closure — catch errors, fix edge cases |
| 3 | Refinement — polish, test coverage, UX review |

### Verification Criteria (per domain)

- `npx tsc --noEmit` — zero errors
- `node scripts/build.mjs` — production build succeeds
- `npx vitest run` — all tests pass, zero regressions
- Domain-specific checks listed in each domain section above

## Files Inventory (Expected Final State)

### New files
```
src/built-in/canvas/migrations/009_property_definitions.sql
src/built-in/canvas/properties/propertyTypes.ts
src/built-in/canvas/properties/propertyDataService.ts
src/built-in/canvas/properties/propertyBar.ts
src/built-in/canvas/properties/propertyBar.css
src/built-in/canvas/properties/propertyEditors.ts
src/built-in/canvas/properties/propertyPicker.ts
tests/unit/propertyDataService.test.ts
tests/unit/propertyBar.test.ts
```

### Modified files
```
src/built-in/canvas/main.ts              — remove database wiring (imports, instantiation, editor registration, duplicate command), add property wiring
src/built-in/canvas/config/blockRegistry.ts — remove database imports (DatabaseInline, DatabaseFullPage, IDatabaseDataService), remove 3 block definitions, remove interface fields, remove all database re-exports (~30 lines)
src/built-in/canvas/config/tiptapExtensions.ts — remove 'databaseInline' + 'databaseFullPage' from UNIQUE_ID_BLOCK_TYPES
src/built-in/canvas/canvasEditorProvider.ts — remove IDatabaseDataService import/param/accessors/context, add property bar
src/built-in/canvas/canvasSidebar.ts     — HEAVY: remove ~170 lines of database logic (imports, fields, methods, event subs, menu entries, icon rendering)
src/built-in/canvas/canvas.css           — remove 3 .canvas-node--database-view CSS rules
```

### Documentation (optional cleanup)
```
docs/canvas/DATABASE_AUDIT_REPORT.md              — now obsolete
docs/canvas/research/DATABASE_VIEWS_RESEARCH.md   — now obsolete
docs/canvas/research/DATABASE_FULL_PAGE_CHROME_INTEGRATION_PLAN.md — now obsolete
```

### Deleted files
```
src/built-in/canvas/database/            — entire directory (24 files)
src/built-in/canvas/extensions/databaseInlineNode.ts
src/built-in/canvas/extensions/databaseFullPageNode.ts
tests/unit/databaseInlineNode.test.ts
tests/unit/databaseDataService.test.ts
tests/unit/databaseTextEntryDialog.test.ts
```
