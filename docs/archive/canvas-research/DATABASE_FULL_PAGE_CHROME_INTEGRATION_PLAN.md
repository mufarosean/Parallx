# Database Full-Page Chrome Integration Plan (Iteration)

**Date:** 2026-02-26  
**Branch:** `milestone-8`  
**Scope:** Full-page database rendering only (not inline database rendering)

---

## 1) Problem Summary

Current full-page database rendering (`databaseEditorProvider.ts`) behaves like a standalone surface rather than a first-class canvas page:

- It bypasses page chrome primitives used by normal canvas pages.
- Cover / icon / title behavior does not match normal page interaction contracts.
- Ribbon parity is incomplete (normal page affordances and positioning are not reused).
- Database page identity (`Row = Page`) is not reflected in full-page shell composition.

This creates visual and behavioral drift from Notion and from Parallx’s own page system.

---

## 2) Research Findings (Codebase)

### A. Normal page chrome already exists and is centralized

`src/built-in/canvas/header/pageChrome.ts` (`PageChromeController`) already owns:

- top ribbon
- cover rendering and reposition flow
- icon picker flow
- editable title flow
- page menu lifecycle

This is the correct reuse point rather than rebuilding page shell behavior in the database provider.

### B. Database full-page provider currently builds its own shell

`src/built-in/canvas/database/databaseEditorProvider.ts` currently creates a custom page header and directly mounts `DatabaseViewHost` slots. It does not reuse `PageChromeController`.

### C. Data/UI contract supports integration

- Database identity is page identity (`databaseId === pageId`) per Milestone DD-0.
- `CanvasDataService` already owns page fields needed by chrome (`title`, `icon`, `coverUrl`, `coverYOffset`, etc.).
- `DatabaseViewHost` cleanly renders database UI independently of page shell. This separation is good and should be preserved.

### D. CSS contract needed

- Normal page chrome classes live in `canvas.css` (`.canvas-top-ribbon`, `.canvas-page-cover`, `.canvas-page-header`, `.canvas-page-icon`, `.canvas-page-title`).
- Database surface classes live in `database.css` (`.db-host-*`, `.db-view-*`, `.db-table-*`, etc.).

The integration should compose both: page chrome above, database host shell below.

---

## 3) Notion Parity Targets (Full Database Page)

1. **Page-like shell** with tab + ribbon + cover/icon/title behavior.
2. **Ribbon parity** with normal page visuals, but database-specific actions.
3. **Shared editing logic** for cover/icon/title with normal pages.
4. **Database-specific title layout:** icon and title on same row for database pages.
5. **Database UI continuity:** database view tabs/toolbar/content directly below page chrome.

---

## 4) Architecture Decisions

### Decision 1 — Reuse `PageChromeController` with variants

Add options to `PageChromeController` so database page can configure:

- hide favorites star in ribbon
- use database menu variant
- render title row as inline icon+title (database style)

Default behavior remains unchanged for normal canvas pages.

### Decision 2 — Keep `DatabaseViewHost` as data-view engine

No rewrite of database view pipeline. `DatabaseViewHost` remains responsible for:

- loading database/views/properties/rows
- applying filters/sorts/grouping
- rendering selected view type

Only shell/chrome composition changes.

### Decision 3 — Integrate via `DatabaseEditorProvider`

`DatabaseEditorProvider` will compose:

1. page chrome (from `CanvasDataService` + page identity)
2. database content shell (`DatabaseViewHost` slots)

This preserves modularity and avoids coupling database view internals to page shell internals.

---

## 5) Execution Plan

### Phase A — Shared chrome variants

- Extend `PageChromeController` with optional behavior flags:
  - `titleLayout: 'stacked' | 'inline'`
  - `hideFavoriteButton: boolean`
  - `menuKind: 'page' | 'database'`
- Keep existing defaults for normal pages.

### Phase B — Database provider composition

- Inject `CanvasDataService` into `DatabaseEditorProvider`.
- Load page data using `databaseId` as `pageId`.
- Mount page chrome first, then database host shell below.
- Subscribe to page-change events for live sync.

### Phase C — Full-page database style alignment

- Add database-specific overrides for inline icon/title row and content spacing.
- Ensure database shell feels like a page, not a separate app panel.

### Phase D — Validation

- `npx tsc --noEmit`
- targeted unit tests (database and gate compliance)
- manual visual validation for:
  - no-cover state
  - cover add/change/remove/reposition
  - icon add/change/remove
  - title edit + tab/title sync
  - ribbon parity (no favorite, database menu)

---

## 6) Risks & Mitigations

- **Risk:** Regress normal canvas page chrome behavior.  
  **Mitigation:** Variant options default to current behavior; only database provider opts in.

- **Risk:** CSS collision between `canvas.css` and `database.css`.  
  **Mitigation:** Scope overrides via `.db-host--fullpage` and explicit modifier classes.

- **Risk:** Database menu behavior drift.  
  **Mitigation:** Start with minimal, explicit database menu variant and evolve incrementally.

---

## 7) Out of Scope (This Iteration)

- Inline database node shell changes
- Board/List/Gallery/Calendar/Timeline feature logic
- Formula/relations/rollup correctness changes
- Re-architecting ribbon at workbench-level API

---

## 8) Expected Outcome

After this iteration, full-page databases will feel native to the canvas/page system:

- same cover/icon/title mechanics as pages
- ribbon parity with controlled database differences
- stronger Notion-like full-page behavior
- no forked shell logic
