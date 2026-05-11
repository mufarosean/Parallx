# Milestone 57 — Media Organizer Grid UX

**Extension**: `parallx-community.media-organizer`  
**File**: `ext/media-organizer/main.js`  
**Created**: 2026-04-15

---

## Overview

Grid view power-user features: context menus, keyboard navigation, star rating shortcuts, drag-to-album, duplicate detection, lightbox/slideshow, reveal-in-explorer, and batch export.

---

## Pre-existing (completed before this milestone)

| ID | Feature | Status |
|----|---------|--------|
| Pre-1 | Ctrl+click toggle selection on card bodies | ✅ Done |
| Pre-2 | Shift+click range selection on card bodies | ✅ Done |
| Pre-3 | Drag-to-select rubber band | ✅ Done |
| Pre-4 | Bulk delete with confirmation dialog | ✅ Done |
| Pre-5 | Delete/Backspace keyboard shortcut | ✅ Done |
| Pre-6 | Ctrl+I invert selection shortcut | ✅ Done |
| Pre-7 | Ctrl+A select all shortcut | ✅ Pre-existing |
| Pre-8 | Escape deselect all shortcut | ✅ Pre-existing |

---

## Features

### F1: Right-click Context Menu

**Priority**: High  
**Complexity**: Medium  
**Dependencies**: None

Right-click on a card or list row shows a context menu with actions for that item. If the item is part of a multi-selection, actions apply to all selected items.

| Task | Description |
|------|-------------|
| F1.1 | Create `moContextMenu(items, position, actions)` renderer — absolute positioned menu with action rows |
| F1.2 | Add `contextmenu` event listener to cards and list rows |
| F1.3 | Single-item actions: Open, Tag..., Rate (1-5 submenu), Open File Location, Copy Path |
| F1.4 | Multi-item actions (when right-clicked item is in selection): Tag..., Rate..., Add to Album..., Delete... |
| F1.5 | CSS styling — matches `.mo-bulk-dialog` color tokens, shadow, border-radius |
| F1.6 | Dismiss on click-outside, Escape, or scroll |

**Context menu items (single item)**:
- Open → opens detail editor
- Tag... → opens bulk tag dialog with 1 item
- Rate → submenu: ☆ (clear), ★, ★★, ★★★, ★★★★, ★★★★★
- Add to Album... → opens album dialog
- Open File Location → `shell:showItemInFolder`
- Copy File Path → clipboard
- Delete... → confirmation dialog

**Context menu items (multi-selection)**:
- Tag... / Rate... / Add to Album... / Delete... (same as toolbar actions)
- All apply to entire selection

---

### F2: Keyboard Arrow Navigation

**Priority**: High  
**Complexity**: Medium  
**Dependencies**: None

Arrow keys move a visible focus indicator between cards. Space toggles selection. Enter opens the focused card.

| Task | Description |
|------|-------------|
| F2.1 | Track `state.focusedIndex` (null = no focus, 0-based into `state.items`) |
| F2.2 | Arrow key handler: Up/Down move by row (detect columns from grid layout), Left/Right move by 1 |
| F2.3 | Home/End jump to first/last item on page |
| F2.4 | Space toggles selection on focused item |
| F2.5 | Enter opens detail editor for focused item |
| F2.6 | Shift+Arrow extends selection range |
| F2.7 | Add `.mo-focused` CSS class with visible outline (distinct from `.mo-selected` border) |
| F2.8 | Scroll focused card into view (`scrollIntoView({ block: 'nearest' })`) |
| F2.9 | Focus indicator survives grid refresh (re-apply after `cardGrid.refresh()`) |

**Column detection**: Read the grid container's computed `grid-template-columns` to determine the number of columns, then Up/Down moves by that count.

---

### F3: Star Rating via Number Keys

**Priority**: High  
**Complexity**: Low  
**Dependencies**: F2 (uses focused item) or existing selection

Press 1-5 to set rating on focused/selected items. Press 0 to clear rating.

| Task | Description |
|------|-------------|
| F3.1 | Add keydown handler: keys `0`-`5` (not in input/textarea) |
| F3.2 | If items are selected → bulk rate all selected items |
| F3.3 | If no selection but focused item → rate the focused item |
| F3.4 | Use existing `PhotoQueries.update(id, { rating })` / `VideoQueries.update(id, { rating })` |
| F3.5 | Show brief status bar notification: "Rated N items ★★★" |
| F3.6 | Refresh grid after rating update |

---

### F4: Thumbnail Regeneration (force overwrite)

**Priority**: Medium  
**Complexity**: Low — already 90% implemented  
**Dependencies**: None

The existing `generateAllThumbnails(api)` command already accepts an `overwrite` parameter. Currently the command palette entry calls it with `overwrite = false` (skip existing). We just need a second command that passes `overwrite = true`.

| Task | Description |
|------|-------------|
| F4.1 | Register `media-organizer.regenerateThumbnails` command that calls `generateAllThumbnails(api, true)` |
| F4.2 | Add to manifest `commands` array with title "Media Organizer: Regenerate All Thumbnails" |
| F4.3 | Confirmation prompt before starting ("This will re-generate all thumbnails. Continue?") |

**Note**: Re-scanning (`runScan`) re-imports metadata and creates thumbnails for NEW files only (skips unchanged files via fingerprint match). `generateAllThumbnails(overwrite=true)` regenerates the JPEG thumbnail for every existing file at the current `THUMB_MAX_SIZE` — that's what you want after bumping the size cap.

---

### F5: Drag Items to Album Sidebar

**Priority**: Medium  
**Complexity**: Medium-High  
**Dependencies**: None

Drag selected cards from the grid onto an album entry in the sidebar to add them.

| Task | Description |
|------|-------------|
| F5.1 | Make selected cards draggable: set `draggable="true"`, populate `dataTransfer` with item keys |
| F5.2 | Add `dragover`/`drop` handlers to album entries in `renderBrowserSidebar` |
| F5.3 | Visual feedback: highlight album entry on dragover (`.mo-drop-target` class) |
| F5.4 | On drop: parse transferred keys, call `AlbumQueries.updatePhotos/updateVideos` |
| F5.5 | Show notification on success |
| F5.6 | Prevent dropping onto non-album sidebar items (e.g. "All Photos", folder entries) |

---

### F6: Duplicate Detection View

**Priority**: Medium  
**Complexity**: Medium  
**Dependencies**: None

**How it works**: The fingerprint system already computes **MD5 checksums** for every file during scan (stored in `mo_fingerprints` with `type = 'md5'`). Videos also get **oshash** (64KB head+tail hash). Two files with the same MD5 are content-identical duplicates — not just same name, same actual byte content.

The query is straightforward:
```sql
SELECT value, COUNT(*) AS cnt
FROM mo_fingerprints
WHERE type = 'md5'
GROUP BY value
HAVING cnt > 1
```

| Task | Description |
|------|-------------|
| F6.1 | Add "Duplicates" entry to sidebar navigation (under "All Photos" / "All Videos") |
| F6.2 | Create `DuplicateQueries.findGroups()` — returns groups of items sharing the same MD5 |
| F6.3 | Render duplicate groups in grid: group header with file count + size, then cards side-by-side |
| F6.4 | Per-group actions: "Keep Best" (highest resolution), "Keep Newest", "Keep Oldest", "Select All But First" |
| F6.5 | Delete action removes DB records (and optionally moves file to trash via `shell:trashItem`) |
| F6.6 | Show total duplicate count and reclaimable disk space in header |

**Detection tiers**:
- **Exact duplicates**: Same MD5 hash (byte-identical files, possibly different names/folders)
- **Near-duplicates** (future): Would require perceptual hashing (pHash) — not currently computed. Could be a follow-up.

---

### F7: Lightbox / Slideshow Mode

**Priority**: Medium  
**Complexity**: Medium  
**Dependencies**: None

Fullscreen overlay that shows one image at a time with left/right navigation through the current page.

| Task | Description |
|------|-------------|
| F7.1 | Create `renderLightbox(items, startIndex, api)` — fullscreen overlay with image display |
| F7.2 | Navigation: Left/Right arrow keys, on-screen prev/next buttons |
| F7.3 | Close: Escape key, click outside image, close button |
| F7.4 | Load full-resolution image (not thumbnail) via `localFileToUrl` on the original file path |
| F7.5 | Preload adjacent images (index ± 1) for instant transitions |
| F7.6 | Show filename, rating stars, and index counter ("3 of 47") in an info bar |
| F7.7 | Video items play inline via `<video>` element |
| F7.8 | Auto-slideshow mode: optional timer (3s/5s/10s) with play/pause button |
| F7.9 | CSS: dark backdrop, centered image with `object-fit: contain`, smooth fade transitions |
| F7.10 | Wire trigger: double-click card, or toolbar "Slideshow" button, or keyboard shortcut (F11 or S) |

---

### F8: Open File Location

**Priority**: Low  
**Complexity**: Low  
**Dependencies**: F1 (context menu) or standalone

| Task | Description |
|------|-------------|
| F8.1 | Utility function `revealFileInExplorer(item)` — resolves file path from DB, calls `shell:showItemInFolder` |
| F8.2 | Wire into context menu (F1.3) |
| F8.3 | Wire into detail editor toolbar (add "Reveal in Explorer" icon button) |
| F8.4 | Wire into keyboard shortcut: Ctrl+Shift+E when item is focused |

---

### F9: Batch File Export / Copy

**Priority**: Low  
**Complexity**: Medium  
**Dependencies**: None

Copy selected original files to a user-chosen destination folder.

| Task | Description |
|------|-------------|
| F9.1 | Add "Export..." button to selection toolbar (after "Add to Album...") |
| F9.2 | Open folder picker dialog for destination |
| F9.3 | Resolve source paths for all selected items from DB (join through files + folders tables) |
| F9.4 | Copy files via IPC (`fs.copyFile` or Node.js child process) with progress |
| F9.5 | Handle naming conflicts: skip, rename with suffix, or overwrite (user choice) |
| F9.6 | Show completion summary: "Exported N files to /path/to/dest" |

---

## Execution Order

| Phase | Features | Rationale |
|-------|----------|-----------|
| **Phase 1** | F1, F2, F3 | Core interaction — makes existing features accessible via keyboard and right-click |
| **Phase 2** | F4, F7, F8 | Quick wins — F4 is one line, F8 is one utility, F7 is self-contained |
| **Phase 3** | F5, F6 | Data features — drag-to-album and duplicate detection need sidebar/grid coordination |
| **Phase 4** | F9 | File operations — lower priority, most complex IPC surface |

---

## Technical Notes

- **Context menu**: Must dismiss before any other pointer interaction. Use `document.addEventListener('pointerdown', dismiss, { once: true })` with a `setTimeout(0)` guard to avoid dismissing on the same click that opened it.
- **Arrow navigation column count**: `getComputedStyle(grid).gridTemplateColumns.split(' ').length` returns the current column count from CSS Grid auto-fill.
- **Lightbox**: Render as a direct child of the root container (`root`) to avoid overflow clipping. Use `z-index: 9999`.
- **Duplicate query performance**: The MD5 GROUP BY + HAVING query is fast (fingerprints table is indexed). Joining back to files/photos/videos for display is the heavier part — use a CTE or temp table.
- **`shell:showItemInFolder`**: Already wired in `electron/preload.cjs` → `window.parallxElectron.shell.showItemInFolder(path)`. No core changes needed.
- **All changes are in `ext/media-organizer/main.js`** — no core file modifications required.
