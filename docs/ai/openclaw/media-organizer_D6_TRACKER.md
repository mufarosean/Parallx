# D6: Filter & Search — Tracker

## Status: CLOSED

## Features
| ID  | Feature               | Iter 1 | Iter 2 | Iter 3 | Status   |
|-----|-----------------------|--------|--------|--------|----------|
| F23 | Sidebar filter panel  | ✅     | ✅     | ✅     | COMPLETE |
| F24 | Text search           | ✅     | ✅     | ✅     | COMPLETE |
| F25 | Sort options          | ✅     | ✅     | ✅     | COMPLETE |

## Iteration Log

### Feature F23 — Sidebar Filter Panel

#### Iteration 1
- **Source analysis**: Studied stash CriterionModifier enum, criterion_handlers.go, SidebarTagsFilter, SidebarRatingFilter, hierarchical tag filtering with CTE
- **Changes made**: Added `state.filters` object (tagIds, excludeTagIds, tagDepth, ratingMin, dateFrom, dateTo). Built full filter panel DOM: tag include/exclude with pills, dropdown, depth checkbox, 5-star rating bar, date range inputs, clear all button. Created `applyFilterCriteria()` shared function, `loadFilterTags()`, `refreshTagDropdown()`, `renderTagPills()`, `updateStarBar()`, filter panel event handlers. Added CSS for all filter components.
- **Verification**: FAIL — 3 CRITICAL (rating scale mismatch, tag JOIN duplicates, filter panel display toggle), 2 HIGH (taken_at on videos, double-join). All fixed immediately.

#### Iteration 2
- **Source analysis**: Re-read stash for edge cases — CombineExcludes normalization, Includes vs IncludesAll semantics, rating GreaterThan is strict `>`, hierarchical tag values always include parent, exclude needs OR IS NULL fallback, file_mod_time via files JOIN
- **Changes made**: Tag AND semantics via GROUP BY/HAVING COUNT(DISTINCT tag_id). Added file_mod_time sort option with JOIN to mo_files table. Fixed rating star rendering (removed /20 division).
- **Verification**: FAIL — 1 CRITICAL (rating star display still divided by 20 in card/list views). Fixed.

#### Iteration 3
- **Source analysis**: Reviewed stash for sort stability (secondary sort), search debounce (500ms), filter count badge (FilterButton.tsx), filter state reset, keyboard shortcuts
- **Changes made**: Added secondary sort tie-breaking (COALESCE(title,'') COLLATE NOCASE ASC, id ASC). Increased search debounce to 500ms. Added filter count badge with `updateFilterBadge()`. Fixed UX Guardian issues: star bar accessibility (role, aria-label, aria-checked, tabindex), tag pill remove button accessibility, focus-visible states on filter controls, tokenized remaining hardcoded font-sizes.
- **Verification**: PASS — 1 LOW (NULL title inconsistency in single-type query COALESCE) fixed.
- **UX Guardian**: 2 HIGH accessibility, 3 MEDIUM (aria-labels, font tokens), 2 LOW — all fixed.

### Feature F24 — Text Search

#### Iteration 1
- **Changes made**: Search input already existed from D5. Added `title LIKE ?` clause to both `buildUnifiedQuery()` and `buildSingleTypeQuery()` for all filter paths (folder, tag, favorites, all).
- **Verification**: PASS

#### Iteration 2
- **Changes made**: No additional changes needed — search was already integrated into filter pipeline.

#### Iteration 3
- **Changes made**: Increased debounce from 300ms to 500ms (matching stash's main search timing).

### Feature F25 — Sort Options

#### Iteration 1
- **Changes made**: Extended `MO_SAFE_SORT_COLUMNS` with `taken_at`. Added Date Taken option to sort dropdown. Added `taken_at` fallback for videos (uses created_at since videos lack taken_at column).
- **Verification**: PASS (taken_at fallback validated)

#### Iteration 2
- **Changes made**: Added `file_mod_time` sort option. Modified both query builders to JOIN mo_files when sorting by file modification time. UNION ALL query selects mod_time column conditionally. Alias detection avoids double-joining when folder filter already provides files JOIN.
- **Verification**: PASS — UNION ALL column balance verified, alias resolution correct, SQL injection safe via allowlist.

#### Iteration 3
- **Changes made**: Added sort stability with secondary sort (COALESCE + id) to both query builders. Unified query uses `COALESCE(title, '') COLLATE NOCASE ASC, id ASC`. Single-type query uses `COALESCE(alias.title, '') COLLATE NOCASE ASC, alias.id ASC`.

## Key Decisions
- **Tag semantics**: AND (IncludesAll) — media must have ALL selected tags. Matches stash's default sidebar behavior.
- **Rating scale**: 0-5 integers (schema CHECK constraint), no conversion needed. Stash uses 0-100 internally but our schema is simpler.
- **Date filtering**: Filters on `created_at` (system timestamp), not `taken_at` (photo-specific). Future improvement could filter on the appropriate field per media type.
- **file_mod_time**: Comes from `mo_files.mod_time` via JOIN. INNER JOIN means items without file records are excluded (acceptable — these are scan artifacts).
- **Saved filters**: Deferred to future milestone. Each sidebar navigation creates fresh filter state.
