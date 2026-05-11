# D4: Hierarchical Tags — Tracker

## Status: CLOSED

## Features
| ID | Feature | Iter 1 | Iter 2 | Iter 3 | Status |
|----|---------|--------|--------|--------|--------|
| F15 | Tag hierarchy (parent/child operations) | ✅ | ✅ | ✅ | COMPLETE |
| F16 | Tag alias cross-uniqueness | ✅ | ✅ | ✅ | COMPLETE |
| F17 | Cycle validation (bidirectional) | ✅ | ✅ | ✅ | COMPLETE |
| F18 | Tag merge, bulk operations, reverse lookups | ✅ | ✅ | ✅ | COMPLETE |

## Iteration Log

### F15-F18 — Iteration 1 (ESSENTIAL Gaps)
- **Source analysis**: Gap inventory against Stash's full tag system — identified 5 ESSENTIAL, 5 IMPORTANT, 5 NICE-TO-HAVE gaps
- **Changes made**:
  - `ensureAliasesUnique()` helper — cross-checks aliases vs tag names and other aliases
  - `wouldCreateCycle()` — made bidirectional (ancestor + descendant checks)
  - `create()` — alias cross-check after ensureUnique
  - `update()` — alias cross-check on rename + childIds handling with cycle validation
  - `updateAliases()` — calls ensureAliasesUnique before transaction
  - `findMany()` — hierarchy filters: parentId, childId, hasParents, hasChildren
  - `findByNames()` — bulk lookup by name array
  - `destroyMany()` — batch delete with existence checks
  - `addChild()` / `removeChild()` / `updateChildTags()` — child-side hierarchy operations
- **Verification**: PASS with 2 MEDIUM (ensureExists gaps in update()), 3 LOW (addParent inconsistency, destroyMany dedup, wouldCreateCycle redundancy)

### F15-F18 — Iteration 2 (IMPORTANT Gaps + Iter 1 Fixes)
- **Source analysis**: Re-read Stash for merge, bulk update, reverse lookups, count helpers
- **Fixes applied**:
  - ensureExists for parentIds/childIds in update()
  - addParent() harmonized with ValidationError + ensureExists
  - destroyMany() deduplicates ids
  - wouldCreateCycle() belt-and-suspenders comment
- **New features**:
  - `merge(sourceIds, destinationId)` — full reassignment transaction
  - `bulkUpdate(ids, input)` — scalar + relation modes (add/remove/set)
  - `findByPhotoId(photoId)` / `findByVideoId(videoId)` — reverse lookups
  - `countParents(tagId)` / `countChildren(tagId)` — count helpers
- **Verification**: PASS with 1 MEDIUM (bulkUpdate values guard), 2 LOW (empty transaction, post-merge cycle)

### F15-F18 — Iteration 3 (Final Refinement)
- **Fixes applied**:
  - bulkUpdate: `values = []` default + `if (values.length > 0)` guard (prevents TypeError)
  - bulkUpdate: `if (ops.length > 0)` before transaction (skips empty transaction)
  - Fixed `continue` bug that would skip childIds processing when parentIds values empty
- **Verification**: PASS — all checklist items green, no remaining issues
- **UX Guardian**: Skipped — D4 is all database/query infrastructure with no user-facing surfaces

## Summary
D4 added 14 new/modified TagQueries methods covering the full Stash tag hierarchy feature set:
- **Validation**: ensureAliasesUnique, wouldCreateCycle (bidirectional), name↔alias cross-checks
- **CRUD**: findByNames, destroyMany, merge, bulkUpdate
- **Hierarchy**: addChild, removeChild, updateChildTags, childIds in update()
- **Query**: findMany hierarchy filters, findByPhotoId, findByVideoId, countParents, countChildren
