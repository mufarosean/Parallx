# Milestone 52: Media Organizer Extension

## Reference Project
- **Repository**: https://github.com/stashapp/stash
- **Tech Stack**: Go 56.8% / TypeScript 40.2%, SQLite (goqu query builder), GraphQL (gqlgen), React (Vite, Apollo Client), FFmpeg/FFProbe, vips-tools
- **Architecture Summary**: Stash is a self-hosted media organizer with a Go backend and React SPA. The backend handles file scanning (walker + processor goroutines), metadata extraction (FFProbe), thumbnail generation (vips preferred, FFmpeg fallback), and persistence (SQLite). The frontend uses Apollo Client for GraphQL queries and provides Grid/Wall/List views with a composable card system and sidebar filter architecture. Data models use entity-file separation (join tables) and hierarchical tags with cycle validation.

## Extension Overview
- **Extension ID**: `parallx-community.media-organizer`
- **Extension Directory**: `ext/media-organizer/`
- **Target Parallx API surfaces**: views, editors, commands, database, fs, window, statusBar, configuration

## Vocabulary Mapping (Stash → Media Organizer)

Stash uses adult-content-centric terminology. This extension uses neutral terms:

| Stash Term | Media Organizer Term | Notes |
|------------|---------------------|-------|
| Scene | Video | Video media item |
| Image | Photo | Photo media item |
| Gallery | Album / Collection | Folder-based or curated group |
| Performer | — | Not applicable (removed) |
| Studio | — | Not applicable (removed) |
| Group | — | Not applicable (removed) |
| Organized | Curated | Boolean flag: "has this been tagged/reviewed?" |

## Feature Domains (Execution Order)

### D1: Data Model & Database Schema
- **Features**: Core TypeScript interfaces, SQLite schema, migration system, query layer
- **Depends on**: None
- **Upstream source areas**: `pkg/models/`, `pkg/sqlite/tables.go`, `pkg/sqlite/migrations/`
- **Rationale**: Everything depends on the data model. Must come first.

### D2: Scan Pipeline
- **Features**: Directory scanning, file discovery, metadata extraction (FFProbe + EXIF), fingerprinting, database ingestion
- **Depends on**: D1
- **Upstream source areas**: `pkg/file/scan.go`, `pkg/file/video/scan.go`, `pkg/file/image/scan.go`, `internal/manager/task_scan.go`
- **Rationale**: Cannot browse media without first importing it.

### D3: Thumbnail Generation
- **Features**: Image thumbnails, video cover frames, lazy generation, thumbnail serving
- **Depends on**: D2
- **Upstream source areas**: `pkg/image/thumbnail.go`, `pkg/scene/generate/`, `internal/api/routes_image.go`
- **Rationale**: Grid views are unusable without thumbnails.

### D4: Hierarchical Tags
- **Features**: Tag CRUD, parent/child hierarchy, cycle validation, tag-entity relationships
- **Depends on**: D1
- **Upstream source areas**: `pkg/models/model_tag.go`, `pkg/sqlite/tag.go`, `pkg/tag/update.go`
- **Rationale**: The core organizing mechanism. Can run in parallel with D2/D3 since it only depends on D1.

### D5: Grid Browser View
- **Features**: Thumbnail grid view, display mode switching (Grid/Wall/List), zoom levels, card composition, virtual scrolling
- **Depends on**: D2, D3
- **Upstream source areas**: `ui/v2.5/src/components/Images/`, `ui/v2.5/src/components/Shared/GridCard/`, `ui/v2.5/src/components/Wall/`
- **Rationale**: The primary browsing interface.

### D6: Filter & Search
- **Features**: Sidebar filter panel, tag filtering, date filtering, rating filtering, text search, sort options
- **Depends on**: D4, D5
- **Upstream source areas**: `ui/v2.5/src/models/list-filter/`, `ui/v2.5/src/components/Shared/Sidebar/`, `ui/v2.5/src/components/List/`
- **Rationale**: Grid browser needs filtering to be useful at scale.

### D7: Detail Editor View
- **Features**: Full media detail pane (metadata, tags, rating, notes), EXIF display, tag editor, video playback
- **Depends on**: D5, D4
- **Upstream source areas**: `ui/v2.5/src/components/Images/ImageDetails/`, `ui/v2.5/src/components/Scenes/SceneDetails/`
- **Rationale**: Users need to view and edit individual media items.

### D8: Album & Collection Management
- **Features**: Auto-albums from directories, manual collections, album views, bulk operations
- **Depends on**: D5, D4
- **Upstream source areas**: `pkg/models/model_gallery.go`, `ui/v2.5/src/components/Galleries/`
- **Rationale**: After individual media is browsable, organize into groups.

## Feature Inventory

| ID | Feature | Domain | Classification | Upstream Reference |
|----|---------|--------|----------------|--------------------|
| F1 | Core data model interfaces (MediaItem, Photo, Video, Tag, Album, File) | D1 | ESSENTIAL | `pkg/models/model_image.go`, `model_scene.go`, `model_tag.go`, `model_gallery.go`, `model_file.go` |
| F2 | SQLite schema (entity tables, join tables, tag hierarchy, custom fields) | D1 | ESSENTIAL | `pkg/sqlite/tables.go`, schema patterns |
| F3 | Migration system (versioned schema upgrades) | D1 | ESSENTIAL | `pkg/sqlite/migrations/` |
| F4 | Query layer (CRUD for all entities) | D1 | ESSENTIAL | `pkg/sqlite/image.go`, `scene.go`, `tag.go`, `gallery.go` |
| F5 | Directory scanner (walk filesystem, discover media files) | D2 | ESSENTIAL | `pkg/file/scan.go` — Scanner struct, walker goroutine |
| F6 | File type detection & filtering (image vs video vs skip) | D2 | ESSENTIAL | `pkg/file/scan.go` — FilteredDecorator pattern |
| F7 | Metadata extraction: dimensions, codec, duration (FFProbe) | D2 | ESSENTIAL | `pkg/file/video/scan.go`, `pkg/file/image/scan.go` |
| F8 | EXIF extraction: GPS, camera, lens, aperture, ISO, date | D2 | ESSENTIAL | *No upstream analog* — extension must implement independently |
| F9 | Fingerprinting (MD5 for exact dedup) | D2 | IMPORTANT | `pkg/models/fingerprint.go`, `pkg/hash/` |
| F10 | Scan progress reporting (status bar, progress indicator) | D2 | IMPORTANT | `internal/manager/task_scan.go` — progress callbacks |
| F11 | Image thumbnail generation | D3 | ESSENTIAL | `pkg/image/thumbnail.go` — ThumbnailEncoder |
| F12 | Video cover frame extraction | D3 | ESSENTIAL | `pkg/scene/generate/` — screenshot at configurable timestamp |
| F13 | Lazy/on-demand thumbnail generation | D3 | IMPORTANT | `internal/api/routes_image.go` — serve pre-generated or generate on-the-fly |
| F14 | Thumbnail cache management | D3 | IMPORTANT | `pkg/models/paths/paths.go` — Generated paths structure |
| F15 | Tag CRUD (create, read, update, delete) | D4 | ESSENTIAL | `pkg/sqlite/tag.go` — TagStore |
| F16 | Tag hierarchy (parent/child relationships) | D4 | ESSENTIAL | `tags_relations` table, `FindAllAncestors()`, `FindAllDescendants()` |
| F17 | Tag cycle validation | D4 | ESSENTIAL | `pkg/tag/update.go` — ValidateHierarchyNew/Existing |
| F18 | Tag-media relationships (apply tags to photos/videos) | D4 | ESSENTIAL | `images_tags`, `scenes_tags` join tables |
| F19 | Thumbnail grid view (card-based media browser) | D5 | ESSENTIAL | `ui/v2.5/src/components/Shared/GridCard/`, `ImageCard` composition |
| F20 | Zoom levels for grid cards | D5 | IMPORTANT | Stash `zoomWidths = [280, 340, 480, 640]` |
| F21 | Virtual scrolling for large collections | D5 | IMPORTANT | List component patterns in Stash |
| F22 | Display mode switching (Grid / Wall / List) | D5 | NICE-TO-HAVE | `DisplayMode` enum, conditional rendering |
| F23 | Sidebar filter panel (tags, date, rating, curated status) | D6 | ESSENTIAL | `ui/v2.5/src/components/Shared/Sidebar/`, `SidebarPane` |
| F24 | Text search across titles, descriptions, file paths | D6 | ESSENTIAL | Stash filter criteria system |
| F25 | Sort options (date, name, rating, added date) | D6 | ESSENTIAL | Stash `SortBy` enum patterns |
| F26 | Media detail editor pane | D7 | ESSENTIAL | `ui/v2.5/src/components/Images/ImageDetails/` |
| F27 | EXIF metadata display (camera info, GPS, settings) | D7 | ESSENTIAL | *No upstream analog* — based on F8 data |
| F28 | Inline tag editor (add/remove tags with autocomplete) | D7 | ESSENTIAL | Stash tag editing components |
| F29 | Rating widget (star or numeric rating) | D7 | IMPORTANT | Stash `Rating` component |
| F30 | Video playback in detail view | D7 | IMPORTANT | Stash scene player patterns |
| F31 | Auto-albums from directory structure | D8 | ESSENTIAL | `model_gallery.go` — `FolderID` based galleries |
| F32 | Manual collection creation & editing | D8 | IMPORTANT | Gallery CRUD without folder binding |
| F33 | Bulk tagging (tag multiple items at once) | D8 | IMPORTANT | Stash `useBulkImageUpdate` mutation pattern |
| F34 | Bulk operations toolbar (select multiple, tag, delete, move) | D8 | NICE-TO-HAVE | Stash `EditableTextUtils`, bulk mutation patterns |
| F35 | Perceptual hash for visual similarity detection | D2 | NICE-TO-HAVE | `pkg/hash/videophash/`, `corona10/goimagehash` |
| F36 | Sprite sheets for video scrubbing | D3 | NICE-TO-HAVE | `pkg/scene/generate/sprite.go` |
| F37 | Map view (GPS-based photo location display) | D7 | NICE-TO-HAVE | *No upstream analog* — novel feature for landscape photography |
| F38 | Export/import (backup library metadata to JSON) | D8 | NICE-TO-HAVE | `internal/manager/task_export.go`, `task_import.go` |
| F39 | `.mediaignore` files for directory exclusion | D2 | NICE-TO-HAVE | `.stashignore` pattern in Stash |
| F40 | Custom fields (extensible per-entity metadata) | D1 | NICE-TO-HAVE | `*_custom_fields` tables in Stash |

## Execution Plan
- **Domain order**: D1 → D2 → D3 → D4 (can overlap with D2/D3) → D5 → D6 → D7 → D8
- **Each domain**: 3 iterations per feature (major implementation → gap closure → final refinement)
- **Total features**: 40
  - ESSENTIAL: 22
  - IMPORTANT: 10
  - NICE-TO-HAVE: 8

## Final Status: COMPLETE

All 8 domains closed. 34 features implemented (F1-F34). 6 NICE-TO-HAVE features (F35-F40) deferred to future milestones.

| Domain | Features | Status | Commit |
|--------|----------|--------|--------|
| D1: Data Model & Database Schema | F1-F4 | ✅ CLOSED | — |
| D2: Scan Pipeline | F5-F10 | ✅ CLOSED | — |
| D3: Thumbnail Generation | F11-F14 | ✅ CLOSED | 14405c0 |
| D4: Hierarchical Tags | F15-F18 | ✅ CLOSED | e6defed |
| D5: Grid Browser View | F19-F22 | ✅ CLOSED | f06f011 |
| D6: Filter & Search | F23-F25 | ✅ CLOSED | — |
| D7: Detail Editor View | F26-F30 | ✅ CLOSED | — |
| D8: Albums & Collections | F31-F34 | ✅ CLOSED | d55a490 |

### Deferred Features (Future Milestones)
| ID | Feature | Reason |
|----|---------|--------|
| F35 | Perceptual hash for visual similarity | Requires additional hash library integration |
| F36 | Sprite sheets for video scrubbing | Enhancement — basic video playback sufficient |
| F37 | Map view (GPS-based) | Novel feature not in upstream — needs mapping library |
| F38 | Export/import JSON backup | Utility feature — low priority |
| F39 | `.mediaignore` directory exclusion | Enhancement to scan pipeline |
| F40 | Custom fields | Schema extension — deferred to avoid over-engineering |

## Notes

1. **EXIF extraction is the biggest gap** — Stash doesn't do it. The extension needs a JavaScript EXIF library (e.g., `exifr` or `exif-reader`) since this needs to run in the Electron renderer/Node context.

2. **No FFmpeg dependency assumed** — The extension should check whether FFmpeg is available on the system. If not, video thumbnails and metadata gracefully degrade (show placeholder, use file stats only). Image thumbnails can use canvas-based resizing without FFmpeg.

3. **Thumbnail storage** — Generated thumbnails should go in `.parallx/extensions/media-organizer/thumbnails/` to keep them workspace-local and cleanly separated.

4. **The `Curated` flag** — Adapted from Stash's `Organized`. Marks whether a media item has been reviewed and tagged. Essential for workflow: "show me unreviewed photos from last trip."
