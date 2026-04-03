# D8: Albums & Collections — Tracker

## Status: CLOSED

## Features
| ID | Feature | Iter 1 | Iter 2 | Iter 3 | Status |
|----|---------|--------|--------|--------|--------|
| F31 | Auto-Album Creation | ✅ | ✅ | ✅ | COMPLETE |
| F32 | Album Editor View | ✅ | ✅ | ✅ | COMPLETE |
| F33 | Bulk Operations | ✅ | ✅ | ✅ | COMPLETE |
| F34 | Selection System | ✅ | ✅ | ✅ | COMPLETE |

## Iteration Log

### Feature F31 — Auto-Album Creation

#### Iteration 1 (Major Implementation)
- **Source analysis**: Adapted from stash `pkg/image/scan.go` gallery association pattern
- **Changes made**: `getOrCreateFolderAlbum()` with in-memory cache + `_folderAlbumInflight` Map for concurrent dedup, `associateWithFolderAlbum()` called from `processFile()`. Albums sidebar section with item counts via SQL.
- **Verification**: PASS after fixing race condition via inflight Map
- **Issues found**: Race condition with concurrent folder scans creating duplicate albums — fixed with inflight promise dedup

#### Iteration 2 (Gap Closure)
- **Source analysis**: Re-read stash for album count efficiency, CSS inline style audit
- **Changes made**: Album sidebar item counts via efficient SQL (`COUNT(*) from mo_albums_photos UNION mo_albums_videos`), inline styles → CSS classes (5 replacements)
- **Verification**: PASS
- **Issues found**: None

#### Iteration 3 (Final Refinement)
- **Changes made**: No additional changes needed — feature stable
- **Verification**: PASS
- **UX Guardian**: PASS — album sidebar uses tokens, counts display correctly

### Feature F32 — Album Editor View

#### Iteration 1 (Major Implementation)
- **Source analysis**: Adapted from stash scene/gallery detail pages
- **Changes made**: `renderAlbumEditor()`, `buildAlbumUI()` with title/description/rating/tags editing (debounced save), delete with confirmation dialog, contents mini-grid with remove buttons, editor provider dispatch for `album:` prefix
- **Verification**: PASS after fixing `buildTagEditor` to support `'album'` entity type
- **Issues found**: Tag editor missing album support — added `'album'` entity type

#### Iteration 2 (Gap Closure)
- **Changes made**: Bulk dialog overlay focus fix (tabindex='-1' + overlay.focus() for Escape key)
- **Verification**: PASS
- **Issues found**: None

#### Iteration 3 (Final Refinement)
- **Changes made**: No additional structural changes
- **Verification**: PASS
- **UX Guardian**: Found CRITICAL star class mismatch (`active` vs `filled`) — fixed by adding CSS alias `.mo-star.active`

### Feature F33 — Bulk Operations

#### Iteration 1 (Major Implementation)
- **Source analysis**: Adapted from stash `EditGalleriesDialog`, `MultiSet/BulkUpdateIdMode` patterns
- **Changes made**: `showBulkTagDialog()` (Add/Remove modes), `showBulkRatingDialog()` (5-star bar), `showAddToAlbumDialog()` (album dropdown), `parseSelectedIds()`. All with Escape/click-outside close, overlay focus.
- **Verification**: PASS
- **Issues found**: Album deletion needed confirmation dialog — added

#### Iteration 2 (Gap Closure)
- **Changes made**: Ctrl+A select all shortcut, bulk dialog focus improvements
- **Verification**: PASS
- **Issues found**: Overlay not focused on open (Escape key didn't work) — fixed

#### Iteration 3 (Final Refinement)
- **Changes made**: `isUpdating` button-disable pattern added to all 3 bulk dialogs (Apply/Cancel disabled during async operation, text changed to "Applying…"/"Adding…", re-enabled on error). Added `role="dialog"`, `aria-modal="true"`, `aria-label` to all 3 dialog elements. Added disabled button CSS (opacity 0.4, pointer-events none). Added button hover states. Added `:focus-visible` outlines.
- **Verification**: PASS — all patterns correct, no double-submit possible
- **UX Guardian**: Found HIGH (no disabled CSS, missing star accessibility) and MEDIUM (no focus-visible, no role=dialog) — all fixed

### Feature F34 — Selection System

#### Iteration 1 (Major Implementation)
- **Source analysis**: Adapted from stash `useListSelect.multiSelect` pattern
- **Changes made**: Card checkbox (always rendered, visible on hover or selecting), shift-click range selection, `buildSelectionToolbar()` with count display and action buttons (Select All, Deselect All, Invert, Tag, Rate, Add to Album)
- **Verification**: PASS
- **Issues found**: None

#### Iteration 2 (Gap Closure)
- **Changes made**: Ctrl+A keyboard shortcut for select all, Escape to deselect
- **Verification**: PASS
- **Issues found**: None

#### Iteration 3 (Final Refinement)
- **Changes made**: Focus-visible outlines on selection bar buttons
- **Verification**: PASS
- **UX Guardian**: PASS

## UX Guardian Final Assessment
- ✅ All CSS uses `--vscode-*` / `--parallx-*` tokens (overlay backdrop rgba acceptable)
- ✅ All classes use `mo-` prefix
- ✅ Dialog modals have `role="dialog"`, `aria-modal="true"`, `aria-label`
- ✅ Focus-visible outlines on all interactive buttons
- ✅ Disabled buttons have visual indication (opacity + pointer-events)
- ✅ Star rating color works with both `.filled` and `.active` classes
- ⚠️ LOW: Album editor/bulk dialog stars use `<span>` not `<button>` (acceptable for current scope)
- ⚠️ LOW: Album remove button uses text `×` instead of icon (functional)
