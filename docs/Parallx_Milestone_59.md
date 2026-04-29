# Milestone 59 — Media Organizer: Pro Video, Discovery, AI

**Extension**: `parallx-community.media-organizer`
**File**: `ext/media-organizer/main.js` (+ migrations in `ext/media-organizer/db/migrations/`)
**Created**: 2026-04-29
**Status**: In progress (Phase 1)

---

## Overview

Media Organizer transitions from a "solid local Lightroom-lite" to a feature-complete media tool with a custom video player, GIF/clip workflow that mimics ScreenToGif's quality, full-text search and smart albums, duplicate finder, virtualized grid for large libraries, stacks (RAW + edits), soft-delete trash, timeline / map views, animated WebP migration, drag-into-chat / canvas integration, and a full AI tooling surface (auto-tag, describe, find-similar) gated on extension activation.

This is a multi-phase milestone. Each phase ships independently and is verified before the next begins.

---

## Phase Map

| Phase | Theme | Status |
|-------|-------|--------|
| **P1** | Custom video player + Phase-1 GIF/clip export + WebP convert (manual) | 🚧 In progress |
| **P2** | GIF/clip Phase-2 frame editing + WebP "auto" mode | ⬜ Pending |
| **P3** | Search bar + smart albums + duplicate finder UI + perceptual hash | ⬜ Pending |
| **P4** | Virtualized grid + background thumbnail queue indicator | ⬜ Pending |
| **P5** | Stacks (versions) + soft-delete trash | ⬜ Pending |
| **P6** | Timeline / calendar view + map view | ⬜ Pending |
| **P7** | Drag from grid into chat + canvas, Reveal-in-MO from file tree | ⬜ Pending |
| **P8** | AI tools (image tagging, captioning, find-similar, smart-stack, auto-rate) | ⬜ Pending |

Phases land in order. P3 may be promoted ahead of P2 if the user's libraries grow first.

---

## Decisions made (defaults — flag if you want different)

These are decisions I made when the user said "you pick" or didn't answer:

| # | Decision | Default chosen | Reversible? |
|---|----------|----------------|-------------|
| D1 | First phase order | Video first, then search/discovery | Yes |
| D2 | Frame-strip phase | Phase 2 (after Phase 1 ships) | Yes |
| D3 | "Save frame as photo" linkage | New DB entry **linked to source video** (parent/child) — gives a "frames captured" view per video | Yes |
| D4 | Default export location | Same folder as source, with Settings toggle for `.parallx/extensions/media-organizer/exports/` | Yes |
| D5 | WebP path | **Option A first** (manual review + bulk convert with quarantine). "Auto on scan" added in P2 as a setting. | Yes |
| D6 | Replace-on-disk for converted WebP | **Replace + quarantine original** (`.parallx/extensions/media-organizer/converted-originals/`) for 30 days, then auto-purge | Yes |
| D7 | Default export format | **MP4** (better quality + size than GIF). User picks GIF in dialog if needed. | Yes |
| D8 | YouTube-style J/K/L hotkeys | Yes — they're pro-user friendly and don't conflict with anything | Yes |
| D9 | Destructive on-disk edits scope | Allowed (rotate, rename, move, convert) — always with quarantine for irreversible ops | Yes |

---

## Phase 1 — Custom Video Player + Clip/GIF Export + WebP Convert (Manual)

### F1: Custom Video Player

Replace `buildVideoPlayer()` with a real player. The native `<video>` element is kept underneath; we hide its native controls and draw our own.

| ID | Task |
|----|------|
| F1.1 | New `mo-player` root: 16:9 letterbox, click-to-pause, double-click fullscreen |
| F1.2 | Top bar: filename, resolution, codec, duration, file size |
| F1.3 | Custom progress bar with mouse-hover preview thumbnail |
| F1.4 | Lazy preview-frame generator: extract 1 frame per N seconds (N = ceil(duration/120) so max 120 thumbs per video), cache to `.parallx/extensions/media-organizer/preview-strips/<checksum>/<idx>.jpg`, ffmpeg `-skip_frame nokey -ss <t> -frames:v 1` |
| F1.5 | Time display, click for direct timecode entry |
| F1.6 | Control row: play/pause, frame ±1 (`,` `.`), skip ±5s / ±1s (`←` `→` and `Shift+←/→`) |
| F1.7 | Volume + mute (`M`), with vertical slider on hover |
| F1.8 | Speed picker (0.5/0.75/1/1.25/1.5/2/4) |
| F1.9 | A-B loop toggle — uses in/out markers |
| F1.10 | Audio track picker (when ffprobe shows >1 track) |
| F1.11 | Subtitle picker (when present, uses `<track>` if extractable) |
| F1.12 | Settings cog: PiP, quality, "show video info overlay" toggle |
| F1.13 | Fullscreen button (`F`) |
| F1.14 | Right-side action rail: Capture frame, Set as cover, Trim → export |
| F1.15 | Keyboard map: Space, J/K/L, `,` `.`, `[` `]` (set in/out), `M`, `F`, `0-9` jump-to-% |
| F1.16 | "Capture frame" → ffmpeg `-ss <t> -frames:v 1`, write next to source as `<name>_frame_<HHMMSS>.jpg`, insert as new photo entry linked to parent video via new `mo_video_frames` join table |
| F1.17 | "Set as cover" → overwrite cover frame at current timestamp |
| F1.18 | All controls auto-hide after 3s of mouse idle, reappear on move |
| F1.19 | Loading spinner while preview-frame extraction in progress |

### F2: Clip/GIF Export Dialog (Phase 1)

Triggered by "Trim → export" button on the player or the bulk action bar.

| ID | Task |
|----|------|
| F2.1 | Modal dialog with: live preview (looping) of current trim region |
| F2.2 | In/out timecode entry + drag handles on dialog's own timeline |
| F2.3 | Crop rectangle drawn over preview (drag corners); aspect-ratio lock toggle (free / 1:1 / 16:9 / 9:16 / 4:3) |
| F2.4 | FPS slider: 10 / 15 / 24 / 30 / 60 |
| F2.5 | Output size: pixels (W×H) or percent of source, with "fit/fill" if crop set |
| F2.6 | Speed: 0.5×–4× |
| F2.7 | Reverse toggle |
| F2.8 | Loop count (GIF only): 0 (infinite), 1, 2, 3 |
| F2.9 | Format picker: **MP4 / WebM / GIF** |
| F2.10 | GIF quality: dither (none / Bayer / Floyd-Steinberg), palette size (64 / 128 / 256) |
| F2.11 | MP4/WebM quality: CRF slider (15–35), preset (ultrafast → veryslow) |
| F2.12 | Live file-size estimate (rough: `bitrate * duration / 8` for video; pixel-count-based for GIF) |
| F2.13 | Output path: same folder as source (default) or browse — remembers last choice |
| F2.14 | Two-pass GIF: `palettegen → paletteuse` for proper quality |
| F2.15 | Progress bar with cancel during export; uses ffmpeg `-progress` pipe |
| F2.16 | On success: open exported file in OS default app (configurable), show "Reveal in folder" link |
| F2.17 | Persist last-used preset (per format) in extension config |

### F3: WebP → MP4/GIF Convert (Manual — Option A)

| ID | Task |
|----|------|
| F3.1 | Migration `005_webp_conversion.sql`: add `mo_files.needs_conversion INTEGER DEFAULT 0`, `mo_files.conversion_target TEXT NULL` |
| F3.2 | During scan/incremental-create, detect animated webp (use existing `isWebPAnimated()`), set `needs_conversion = 1` |
| F3.3 | Sidebar badge: "N animated WebP — review", click opens conversion review pane |
| F3.4 | Review pane: list of pending webp files with thumbnail, file size, dimensions; per-row format toggle (MP4 / GIF / skip) |
| F3.5 | "Convert all" action: bulk-convert with progress, originals moved to `.parallx/extensions/media-organizer/converted-originals/<YYYY-MM-DD>/`, DB row updated to point at new path |
| F3.6 | After 30 days, quarantine purge job runs on activate (`Date.now() - 30*86400_000` cutoff) |
| F3.7 | "Restore original" action on a converted file (within 30-day window) |
| F3.8 | Static (non-animated) webp NEVER triggers conversion flag — only animated |

### F4: Photo Lightbox Improvements (small adds — fits in P1)

| ID | Task |
|----|------|
| F4.1 | Mouse-wheel zoom + click-drag pan when zoomed |
| F4.2 | Keyboard `+` `-` `0` for zoom in/out/reset |
| F4.3 | EXIF overlay toggle (`I` key) — semi-transparent panel with shutter, ISO, lens, GPS |
| F4.4 | Quick rotate `R` (90° CW) / `Shift+R` (90° CCW) — non-destructive (writes to `mo_photos.rotation` field; new migration column) |
| F4.5 | Migration adds `mo_photos.rotation INTEGER DEFAULT 0` (degrees) |

### Phase 1 Verification gates

- All keyboard shortcuts documented in player help overlay (`?` key)
- No regression on existing scan / thumbnail / detail editor
- Manual test: scan a folder with 1 animated webp + 5 mp4s, verify badge appears, convert one mp4 to GIF
- Trim a 60-second video to a 5-second 30fps GIF; verify dither options visibly differ
- All ffmpeg/sharp errors surfaced via `api.window.showErrorMessage` with retry
- Existing tests pass (no unit tests in extension, but tsc clean + manual smoke)

---

## Phase 2 — Frame Editing + Auto WebP

| ID | Task |
|----|------|
| F5.1 | Frame strip below dialog timeline: every Nth frame as 64×36 thumb |
| F5.2 | Right-click frame → Delete |
| F5.3 | Click frame → set per-frame delay (ms), shown as overlay number |
| F5.4 | Audio waveform on the timeline (use ffmpeg `astats` filter for amplitude curve) |
| F5.5 | Reverse-individual-frames toggle |
| F5.6 | "Auto WebP" mode setting: Off / Suggest / Auto |
| F5.7 | Auto mode: on scan, animated webp converted in-place to MP4 (default) with quarantine |

---

## Phase 3 — Search & Discovery

| ID | Task |
|----|------|
| F6.1 | Migration `006_search.sql`: FTS5 virtual table over (title, description, tag-names, folder-name) |
| F6.2 | Background indexer keeps FTS in sync with mutations |
| F6.3 | Search bar in grid header with query syntax: `tag:cat rating:>=4 taken:2024 folder:beach` |
| F6.4 | Query parser → SQL with proper escaping and FTS5 MATCH for free text |
| F6.5 | "Save as smart album" — new table `mo_smart_albums(id, name, query_json, created_at)` |
| F6.6 | Smart albums in sidebar, evaluated on open |
| F6.7 | Migration `007_phash.sql`: `mo_image_files.phash INTEGER` (64-bit dHash) |
| F6.8 | Background pHash indexer for existing photos |
| F6.9 | Duplicate Finder view: groups photos by exact hash AND clusters by Hamming distance ≤ 8 on pHash |
| F6.10 | Per-group: pick keeper, send rest to trash; bulk "keep newest / largest / highest-rated" |

---

## Phase 4 — Performance

| ID | Task |
|----|------|
| F7.1 | Replace card paging with virtualized grid (`IntersectionObserver` + windowed render) |
| F7.2 | Card recycling — reuse DOM nodes as user scrolls |
| F7.3 | Background thumbnail queue indicator in status bar (% complete) |
| F7.4 | Settings: items-per-page → "auto" (virtualization) vs fixed |

---

## Phase 5 — Stacks + Trash

| ID | Task |
|----|------|
| F8.1 | Migration `008_stacks.sql`: `mo_stacks(id, primary_photo_id, created_at)` + `mo_stack_members(stack_id, photo_id, video_id, role)` |
| F8.2 | "Stack selected" command — promotes one as primary, others as members |
| F8.3 | Grid shows stack as one card with badge "+3"; click expands |
| F8.4 | Auto-stack heuristics: same basename across extensions (`.NEF` + `.jpg` + `_edited.jpg`) |
| F8.5 | Migration `009_trash.sql`: `mo_files.deleted_at INTEGER NULL` (soft delete) |
| F8.6 | All queries except trash view filter `deleted_at IS NULL` |
| F8.7 | "Empty Trash" command — move files to OS recycle bin via `shell:trashItem`, then hard-delete DB rows |
| F8.8 | Auto-empty after N days (default 30, configurable) |

---

## Phase 6 — Timeline + Map

| ID | Task |
|----|------|
| F9.1 | Timeline view: vertical scroll grouped by year → month → day, with sticky headers |
| F9.2 | Year scrubber on right edge for fast jumping |
| F9.3 | Map view: pull GPS from `mo_photos` EXIF (already extracted), render with Leaflet (or vanilla canvas for offline) |
| F9.4 | Map clustering at zoom-out, click cluster → grid filtered by bounds |

---

## Phase 7 — Parallx Integration

| ID | Task |
|----|------|
| F10.1 | Drag photo card → drops as image attachment in chat input (uses chat attachment service) |
| F10.2 | Drag photo/video card → drops as block on canvas page |
| F10.3 | "Open in Media Organizer" command in regular file tree context menu |
| F10.4 | Reveal-in-MO from any image/video file path |

---

## Phase 8 — AI Tools

Tools registered only when extension is active. All gated behind a check that the user has an image-capable model configured.

| ID | Task |
|----|------|
| F11.1 | New `api.tools.registerTool(...)` extension API (or use existing if present) |
| F11.2 | Tool: `mediaOrganizer.tagUntagged(folderId? | albumId? | smartAlbumId?, limit?)` — finds untagged photos in scope, sends each to vision model with prompt "list 3-7 lowercase tags for this image, comma-separated", parses, applies via existing tag system |
| F11.3 | Tool: `mediaOrganizer.describePhoto(photoId)` — generates caption, writes to `description` field |
| F11.4 | Tool: `mediaOrganizer.findSimilar(photoId, limit=20)` — uses pHash + optional CLIP embedding, returns photo IDs |
| F11.5 | Tool: `mediaOrganizer.suggestStacks(folderId)` — uses pHash + filename heuristics, returns proposed stacks for user confirmation |
| F11.6 | Tool: `mediaOrganizer.autoRate(photoIds, criteria)` — vision model rates 1-5 based on user-supplied criteria, writes ratings |
| F11.7 | Tool: `mediaOrganizer.searchByDescription(text)` — embeds query, returns photos by CLIP similarity (requires F11.8) |
| F11.8 | Optional: CLIP embedding pipeline using local ONNX model (deferred — only if user wants it) |
| F11.9 | All tools batch with progress + cancel; never modify >50 items without user confirmation |
| F11.10 | All AI tool results go through a "review" gate by default — user can toggle "auto-apply" per tool |

---

## Files touched

- `ext/media-organizer/main.js` — primary
- `ext/media-organizer/db/migrations/005_webp_conversion.sql` — new (P1)
- `ext/media-organizer/db/migrations/006_search.sql` — new (P3)
- `ext/media-organizer/db/migrations/007_phash.sql` — new (P3)
- `ext/media-organizer/db/migrations/008_stacks.sql` — new (P5)
- `ext/media-organizer/db/migrations/009_trash.sql` — new (P5)
- `ext/media-organizer/db/migrations/010_video_frames.sql` — new (P1, for F1.16)
- `ext/media-organizer/db/migrations/011_rotation.sql` — new (P1, for F4.5)
- `ext/media-organizer/parallx-manifest.json` — new commands per phase
- `scripts/package-media-organizer.mjs` — bump version per phase

---

## Open questions (waiting on user)

These are decisions I'd like answered before they're locked:

1. **Subtitle support (F1.11)** — should we extract burned-in subtitles? (Not just attached `.srt`.) Lower priority.
2. **PiP (F1.12)** — picture-in-picture works in Electron but is rarely useful. Cut?
3. **CLIP embeddings (F11.8)** — adds ~500MB ONNX model + onnxruntime dep. Worth it? Or stick to pHash + LLM-based search?
4. **Map tile source** — offline (vanilla canvas, no map background, just GPS pin chart) or online (Leaflet + OpenStreetMap, requires network)?

---

## Status log

- **2026-04-29** — Doc created. Phase 1 starting.
