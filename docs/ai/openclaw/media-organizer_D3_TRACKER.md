# D3: Thumbnail Generation — Tracker

## Status: CLOSED

## Features
| ID | Feature | Iter 1 | Iter 2 | Iter 3 | Status |
|----|---------|--------|--------|--------|--------|
| F11 | Image thumbnail generation (S18-S19) | ✅ | ✅ | ✅ | COMPLETE |
| F12 | Video cover frame extraction (S18-S19) | ✅ | ✅ | ✅ | COMPLETE |
| F13 | Lazy/on-demand thumbnails (S20) | ✅ | ✅ | ✅ | COMPLETE |
| F14 | Thumbnail cache management (S21) | ✅ | ✅ | ✅ | COMPLETE |

## Iteration Log

### Feature F11 — Image Thumbnail Generation

#### F11 — Iteration 1 (Major Implementation)
- **Source analysis**: Studied Stash `internal/manager/task_generate_image_thumbnail.go`, `pkg/image/thumbnail.go`, `pkg/image/vips.go`
- **Changes made**: Added Section 18 (Thumbnail Configuration — ~95 lines) and Section 19 (Thumbnail Service — ~400 lines) to main.js
  - Constants: THUMB_MAX_SIZE=640, THUMB_QUALITY_VIPS=80, THUMB_QUALITY_FFMPEG=2, THUMB_QUALITY_CANVAS=0.85
  - Sharded directory layout: `{thumbDir}/{first2}/{checksum}_{size}.jpg`
  - `uriToFsPath()`, `getThumbDir()`, `getIntraDir()`, `getThumbnailPath()`
  - `isAnimatedGif()`, `isWebPAnimated()` (binary header check)
  - `isThumbnailRequired()` — skip small/animated, match Stash's `required()` pattern
  - `generateThumbVips()`, `generateThumbFfmpeg()`, `generateThumbCanvas()` — 3-tier fallback
  - `validateThumbnailFile()` — stat check post-generation
  - `generateImageThumbnail()` — orchestrator with vips→ffmpeg→canvas chain
  - `generateAllThumbnails()` — batch with bounded concurrency (4 workers)
  - `cleanOrphanThumbnails()` — orphan detection via checksum→DB lookup
- **Verification**: PASS — 0 critical, 2 LOW items

#### F11 — Iteration 2 (Gap Closure)
- **Source analysis**: Re-read upstream for edge cases: animated detection, transparency, EXIF rotation, concurrency
- **Fixes applied**:
  - WebP animated detection via binary ANIM chunk header parsing (no external tool)
  - Concurrency bounded to `Math.max(2, cpuCount/4 + 1)` matching Stash's auto-detect
  - Status bar progress in `generateAllThumbnails()` with percentage
  - Fixed cleanOrphanThumbnails regex to match both `_640.jpg` and `_cover.jpg` patterns
- **Verification**: PASS — 0 issues

#### F11 — Iteration 3 (Final Refinement)
- **Source analysis**: Final review for code quality, consistency, documentation
- **Fixes applied**: Minor JSDoc improvements, consistent error logging
- **Verification**: PASS

### Feature F12 — Video Cover Frame Extraction

#### F12 — Iteration 1 (Major Implementation)
- **Source analysis**: Studied Stash `internal/manager/task_generate.go` (GenerateCoverTask), `pkg/scene/screenshot.go` (Screenshot(), ScreenshotTime()), ffmpeg args construction
- **Changes made**: Added to S18+S19:
  - Constants: COVER_TIMESTAMP_PERCENT=0.2, COVER_QUALITY_FFMPEG=2, COVER_SEEK_FALLBACK=5
  - `getCoverFramePath()` — `{thumbDir}/{first2}/{checksum}_cover.jpg`
  - `generateVideoCoverFrame()` — ffmpeg `-ss` seek, `-vframes 1`, quality ladder
  - Integration into `generateAllThumbnails()` — videos processed after photos
  - Updated `cleanOrphanThumbnails()` regex for `_cover.jpg` pattern
- **Verification**: PASS — 3 LOW items (hide_banner, vframes, stale comment)

#### F12 — Iteration 2 (Gap Closure)
- **Source analysis**: Found HIGH (partial write risk), MEDIUM (audio-only detection), LOW (zero-duration clamp, timestampOverride)
- **Fixes applied**:
  - Temp file + atomic rename pattern (write to `.tmp`, validate, `readFile`→`writeFile`→`delete` move)
  - Audio-only file skip: `videoWidth === 0 && videoHeight === 0` → `skip_no_video_stream`
  - Zero-duration clamp: `seekSec = 0` instead of fallback constant (matches Stash: 0.2 * 0 = 0)
  - Added `timestampOverride` parameter for custom seek position
  - Fixed `-vframes` → `-frames:v`, added `-hide_banner`
  - Fixed coverPath not cleaned on writeFile failure
  - Fixed JSDoc "photos" → "photos or videos"
- **Verification**: PASS after fixes

#### F12 — Iteration 3 (Final Refinement)
- **Source analysis**: Only timeout/process-kill documentation gap found
- **Fixes applied**: Added documentation comment about ffmpeg timeout behavior
- **Verification**: PASS — F12 COMPLETE

### Feature F13 — Lazy/On-demand Thumbnails

#### F13 — Iteration 1 (Major Implementation)
- **Source analysis**: Studied Stash `internal/api/routes_image.go` (serveThumbnail), `internal/manager/running_streams.go` (ServeScreenshot). Key finding: Stash uses synchronous on-demand generation in HTTP handlers. Since Parallx has no HTTP server, adapted to function-call API.
- **Changes made**: Added Section 20 (Lazy/On-demand Resolution — ~180 lines):
  - `_thumbSemaphore` — queue-based concurrency limiter (max = cpuCount/4 + 1)
  - `resolvePhotoThumbnail(photoId, api)` — DB lookup, cache check, lazy generate under semaphore with double-check
  - `resolveVideoThumbnail(videoId, api)` — same pattern for video cover frames
  - `resolveThumbnail(entityType, entityId, api)` — dispatcher
  - `resolveThumbnailBatch(entities, api)` — batch resolver for grid views
- **Verification**: PASS — 1 MEDIUM (uncaught exceptions), 1 LOW (stale JSDoc), 1 LOW (batch windowing) — all deferred to Iter 2

#### F13 — Iteration 2 (Gap Closure)
- **Fixes applied**:
  - Added `catch(err)` blocks to both `resolvePhotoThumbnail` and `resolveVideoThumbnail` — log warning, return `{ path: null, status: 'failed' }`
  - Removed stale `@param {boolean} [overwrite=false]` from `resolvePhotoThumbnail` JSDoc
  - Batch windowing inefficiency deferred to Iter 3
- **Verification**: PASS — all 5 verification points confirmed

#### F13 — Iteration 3 (Final Refinement)
- **Source analysis**: Studied Stash `sizedwaitgroup` (worker-pool), `pkg/utils/mutex.go` (MutexManager dedup pattern), frontend lazy loading
- **Fixes applied**:
  - Replaced fixed-window batch with Promise-pool worker pattern (N workers pulling from shared cursor) — matches Stash's `sizedwaitgroup` behavior
  - Added `_thumbInflight` Map for in-flight deduplication — prevents redundant generation during rapid scrolling
  - Added `_thumbInflight.clear()` to `deactivate()` for clean teardown
- **Verification**: PASS — 1 MINOR (`_thumbInflight.clear()` in deactivate — fixed immediately). F13 COMPLETE.

### Feature F14 — Thumbnail Cache Management

#### F14 — Iteration 1 (Major Implementation)
- **Source analysis**: Studied Stash `pkg/models/paths/paths.go`, `paths_generated.go`, `internal/manager/task/clean_generated.go` (CleanGeneratedOptions, dry-run, per-type cleaning), `pkg/image/delete.go` (MarkGeneratedFiles), config storage. Key finding: Stash has NO cache disk usage stats — our `getCacheStats` is a value-add.
- **Architecture plan**: Section 21 (Cache Management) with 5 new functions + modifications to existing functions:
  - `hexPrefixProgress()` — progress estimation from shard dir name
  - `getCacheStats(api)` — walk + stat for disk usage reporting
  - Enhanced `cleanOrphanThumbnails(api, options)` — selective per-type, dry-run, progress
  - `deleteEntityThumbnails(api, checksum)` — entity-specific cleanup
  - `validateCachedThumbnail(thumbPath)` — size > 0 validation for resolvers
  - Modify resolvers to use `validateCachedThumbnail()` instead of bare `fs.exists()`
  - 2 new commands: `cacheStats`, `cleanThumbnailsAdvanced`
- **Changes made**: Added Section 21 (Cache Management — ~140 lines) with 4 new functions:
  - `hexPrefixProgress(hexChar)` — hex→0.0-1.0 progress for shard-walk estimation
  - `validateCachedThumbnail(thumbPath)` — exists + size>0, auto-deletes corrupt zero-byte files
  - `getCacheStats(api)` — recursive walk, classify photo/video/unknown, status bar + notification
  - `deleteEntityThumbnails(api, checksum)` — removes both photo thumb + video cover by checksum
  Enhanced `cleanOrphanThumbnails(api, options)` — added selective per-type, dry-run, hex-prefix progress
  Modified resolvers to use `validateCachedThumbnail()` at fast-path + double-check
  Added `cacheStats` command to manifest
- **Verification**: PASS with issues — MEDIUM: validateCachedThumbnail lacks try/catch, MEDIUM: skippedByFilter unreported, LOW: dry-run status bar wording

#### F14 — Iteration 2 (Gap Closure)
- **Fixes applied**:
  - Wrapped `validateCachedThumbnail` in outer try/catch returning false on error
  - Added `skippedByFilter` count to cleanup info message when > 0
  - Fixed status bar text: "found" for dry-run, "removed" for live (was "removed" in both)
- **Verification**: PASS — 1 LOW (wording inconsistency "removed" vs "deleted")

#### F14 — Iteration 3 (Final Refinement)
- **UX Guardian validation**: PASS with 3 non-blocking polish items
- **Fixes applied**:
  - Added status bar loading indicator to `getCacheStats` (spin → check → auto-hide 5s)
  - Fixed partial stats: show warning instead of info when walk errors occur
  - Unified status bar wording: "Cleaning thumbnails…" consistently (removed stale "orphan" word in progress text)
  - Unified "removed" verb in both status bar and notification
- **Verification**: F14 COMPLETE

## Section Summary (main.js after D3)
| Section | Lines (approx) | Description |
|---------|----------------|-------------|
| S18 | ~95 | Thumbnail configuration — constants, path helpers, sharding |
| S19 | ~615 | Thumbnail service — generation (vips/ffmpeg/canvas), batch, orphan cleanup |
| S20 | ~200 | Lazy/on-demand resolution — semaphore, resolvers, dedup, batch pool |
| S21 | ~140 | Thumbnail cache management — stats, validation, entity delete |
