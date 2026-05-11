# D1: Data Model & Database Schema — Tracker

## Status: CLOSED

## Features
| ID | Feature | Iter 1 | Iter 2 | Iter 3 | Status |
|----|---------|--------|--------|--------|--------|
| F1 | Core data model interfaces | ✅ | ✅ | ✅ | COMPLETE |
| F2 | SQLite schema (entity + join tables) | ✅ | ✅ | ✅ | COMPLETE |
| F3 | Migration system | ✅ | ✅ | ✅ | COMPLETE |
| F4 | Query layer (CRUD for all entities) | ✅ | ✅ | ✅ | COMPLETE |

## Iteration Log

### Features F1-F4 — Iteration 1 (Major Implementation)
- **Source analysis**: Deep study of Stash `pkg/models/`, `pkg/sqlite/tables.go`, `pkg/sqlite/migrations/`, `pkg/sqlite/image.go`, `pkg/sqlite/scene.go`, `pkg/sqlite/tag.go`, `pkg/sqlite/gallery.go`, `pkg/sqlite/file.go`
- **Changes made**: Created 3 files:
  - `ext/media-organizer/parallx-manifest.json` (18 lines)
  - `ext/media-organizer/db/migrations/media-organizer_001_initial.sql` (188 lines — 19 tables + 19 indexes)
  - `ext/media-organizer/main.js` (1137 lines — db wrapper, helpers, 9 query objects, activation)
- **Verification**: CONDITIONAL PASS — 0 critical, 4 low-severity items
- **Issues found**: Missing FolderQueries.update, no validation, cycle check exists but not called from update()

### Features F1-F4 — Iteration 2 (Gap Closure)
- **Source analysis**: Re-read Stash for error handling, missing ops, relationship edge cases, query patterns, schema gaps
- **Changes made**: 
  - Created `media-organizer_002_iter2_schema.sql` (28 lines — 5 ALTER + tag_aliases table + 4 indexes)
  - Modified `main.js` (+311 lines → 1448): error classes, validation, FolderQueries.update, count/findManyByIds on all entities, FingerprintQueries.upsert, TagQueries validation+cycle fix, multi-tag AND/OR filtering, date range filters, album position management, findByFileId for Photo/Video
- **Verification**: CONDITIONAL PASS — 2 issues (parentIds dedup, transaction atomicity)
- **Issues found**: parentIds not deduplicated, parent reassignment not in transaction, album ops not in transaction

### Features F1-F4 — Iteration 3 (Final Refinement)
- **Source analysis**: Final review for performance, robustness, D2 readiness
- **Changes made**:
  - Created `media-organizer_003_iter3_polish.sql` (5 lines — compound unique index)
  - Modified `main.js` (+48 lines → 1496): H1 parentIds dedup+transaction, H2 album transaction, H3 CTE depth limit, M1 aliases transaction, M4 double-activation guard, L3 destroyByFileId, L4 ImageFile/VideoFile upsert
- **Verification**: PASS — 0 critical, 0 medium, 1 low (existence check asymmetry — matches upstream)
- **Issues found**: None blocking

## Final Stats
- **Total files**: 5 (manifest, 3 migrations, main.js)
- **main.js**: 1496 lines, 11 sections, 9 query objects
- **Schema**: 20 tables, 27 indexes across 3 migrations
- **Error classes**: NotFoundError, DuplicateError, ValidationError
- **Validation**: ensureExists, ensureNameNotEmpty, ensureUnique
- **Query features**: CRUD, findMany with pagination/sort/filter, multi-tag AND/OR, date ranges, hierarchy CTEs with depth limit, count, findManyByIds, upsert, destroyByFileId
