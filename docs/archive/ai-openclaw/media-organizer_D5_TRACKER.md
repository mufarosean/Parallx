# D5: Grid Browser View — Tracker

## Status: CLOSED

## Features
| ID  | Feature               | Iter 1 | Iter 2 | Iter 3 | Status   |
|-----|-----------------------|--------|--------|--------|----------|
| F19 | Grid view             | ✅     | ✅     | ✅     | COMPLETE |
| F20 | Zoom levels           | ✅     | ✅     | ✅     | COMPLETE |
| F21 | Server-side pagination| ✅     | ✅     | ✅     | COMPLETE |
| F22 | Display modes         | ✅     | ✅     | ✅     | COMPLETE |

## Iteration Log

### Features F19-F22 — Iteration 1
- **Source analysis**: Studied Stash GridCard, zoom system, pagination, display modes. Key: flow layout (not CSS Grid), calculateCardWidth with ResizeObserver, 4 zoom levels [280,340,480,640], server-side pagination, card DOM structure (thumbnail-section + card-section).
- **Architecture**: S22 (UI Helpers & Styles), S23 (Grid Card Rendering), S24 (Sidebar View), S25 (Grid Browser Editor). Manifest v0.2.0 with viewContainers, views, editors, openGrid command.
- **Changes made**: ~940 lines added to main.js. moEl/moIcon/MO_CSS/moInjectStyles helpers, calculateCardWidth, formatDuration, formatShortDate, renderMediaCard, renderCardGrid (ResizeObserver + debounce), renderBrowserSidebar (collapsible sections with folders/tags), renderGridBrowser (toolbar + pagination + loadPage). Manifest updated with viewContainers, views, editors, new command.
- **Verification**: PASS with 1 HIGH (pagination 2x items for "all" mode), 1 MED (search ignored in folder/tag paths), 2 LOW.

### Features F19-F22 — Iteration 2
- **Source analysis**: Re-read upstream for gap closure — identified UNION ALL as correct multi-type pagination approach.
- **Changes made**: Introduced `buildUnifiedQuery()` with UNION ALL across photo+video tables for correct pagination. Added `buildSingleTypeQuery()` for single-type paths. Both add `title LIKE ?` when search text present. Added `rowToMediaItem()` helper. Removed unused `api` from renderCardGrid destructuring.
- **Verification**: PASS — all HIGH/MED issues resolved. 1 LOW (dead `api` in call site) fixed.

### Features F19-F22 — Iteration 3
- **Source analysis**: Final review of Stash React frontend — display mode switching (Grid/List enum), loading indicators (spinner with 200ms fade-in), empty states, card hover effects, performance patterns (ensureValidPage, scrollToTop).
- **Architecture**: 4 targeted refinements — display mode toggle (Grid/List), loading spinner overlay, ensureValidPage guard, scroll-to-top on page change.
- **Changes made**:
  - Added `renderMediaListRow()` — compact list rows with 40×40 thumb, title, type, rating, date
  - Modified `renderAll()` to branch on `displayMode` (grid cards vs list rows)
  - Added Grid/List toggle buttons to toolbar with active state styling
  - Added loading overlay with 200ms CSS fade-in animation
  - Added `ensureValidPage` with recursion guard after loadPage count
  - Added scroll-to-top after cardGrid.refresh()
  - Added `refreshOpts()` helper — replaced all inline option objects
  - UX polish: tokenized all font-sizes (→ parallx-fontSize-*), border-radius (→ parallx-radius-*), replaced hardcoded colors with CSS variables, added :focus-visible states, added aria-labels to icon-only buttons, added --mo-rating-color custom property
- **Verification**: PASS — all 8 checks clean
- **UX Guardian**: PASS — 0 BLOCKERS, 0 HIGH. All MEDIUM items (tokenization, focus-visible, aria-labels) fixed in same iteration.

## Sections Added
- **S22** (~L3780): UI Helpers — moEl, moIcon, MO_CSS (full tokenized CSS), moInjectStyles
- **S23** (~L4115): Grid Card Rendering — zoom constants, calculateCardWidth, formatDuration, formatShortDate, renderMediaCard, renderMediaListRow, renderCardGrid (with displayMode branching)
- **S24** (~L4395): Sidebar View — renderBrowserSidebar with collapsible sections
- **S25** (~L4480): Grid Browser Editor — renderGridBrowser with toolbar, UNION ALL queries, loading spinner, pagination, display mode toggle

## Manifest Changes (v0.2.0)
- Added `viewContainers.sidebar`: media-organizer-container
- Added `views`: mediaOrganizer.browser
- Added `editors`: media-organizer-grid
- Added command: mediaOrganizer.openGrid
