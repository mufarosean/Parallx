# Clips: the recorder and the clip editor

Media Organizer's clip feature stored, tagged and trimmed well, but a take was one
continuous range, three of the soft looks did nothing, the recorder could not be
moved or paused, and there was no way to hide, label or finish a clip. This is the
program that turned a trimmer into a small editor and the recorder into a camera.

## What a user gets

**Recording**
- Recording starts the instant you press Record. An optional countdown (3, 5 or 10 s)
  inside the frame is there for anyone who wants time to switch windows first.
- Pause and resume. A pause is a marker: the take keeps running so audio and video
  stay aligned, and the paused stretches open in the editor already cut out. Deleting
  a cut brings the footage back.
- App-wide hotkeys while the frame is open: Ctrl+Alt+R starts and stops, Ctrl+Alt+P
  pauses. They work from whatever app is being recorded.
- Follow the box (setting): drag the frame around while recording and the clip
  follows it like a camera. The whole display is captured; the editor opens already
  cropped to the path you made, with keyframes you can correct.
- Hide the cursor (setting) for clean product clips. The cursor path is still
  tracked so Smart Zoom still works.
- Audio: off, system, microphone, or both mixed into one track.
- Real timestamps. The capture keeps every frame at its wall-clock instant and the
  file carries its own start time, so a take always plays at real speed, short takes
  included, audio lines up from the file rather than a guess, finalize is a plain
  copy, and files are smaller (no duplicated frames).

**Editing**
- Segments: several In/Out ranges export as one clip, in list order, with reorder
  and remove. Cut Dead Air finds where the picture froze and the sound went quiet
  inside the range and keeps the rest.
- Blur or pixelate regions, drawn on the video, limited in time. Blur | Pixelate and
  Box | Rounded | Oval are visible buttons on each region; rounded and oval regions
  have a feathered edge, in the preview and in the export. Each region has a Track
  switch: on, the box follows what is under it through the clip (the existing
  tracker); off, it stays still. The preview shows a real blur or a real mosaic.
  The active region carries a selection frame with eight handles (corners and
  edges) on its bounding box, the shape drawn inside it; any region moves by
  dragging its box.
- Text: title cards, lower thirds and captions with a style, a time window and a
  colour, previewed on the video and burned in on export.
- Audio finish: fade in, fade out, loudness normalise, denoise.
- End card: a title and a line on a plain background for a few seconds.
- Smart Zoom: from a screen recording's cursor path, a camera that zooms to where
  you dwelt and pans between dwells.
- Preview Render: three real seconds through ffmpeg, so the look, blur and text you
  see are the ones you get.
- Destination presets (Slack, GitHub, Twitter/X, Discord, Email, Custom) set format,
  size and fps in one click. After an export: Reveal and Copy Path.
- The Pastel, Fade and Vintage looks now change the picture. They were lifting the
  input floor (crushing blacks) instead of the output floor.

## The editor's layout (redesign 2026-10-01)

Built to the approved mockups, `docs/mockups/clip-editor-redesign.html`. The editor
is a page, not a dialog in a tab. It opens on the whole video.

- **Toolbar**: file name, length and size; Undo and Redo (Ctrl+Z, Ctrl+Shift+Z: every
  settled edit is a snapshot); Queue with a count; Export, whose button carries the
  format and the size estimate and, while a clip renders, the progress and Cancel.
- **Stage**: the video fills the left side, with chips for the source (size and frame
  rate) and, while cropping with keys, which key the playhead is on. The crop frame
  shows its size. On the Crop tab the aspect ratios and Preview Crop float on the
  video; on the Text and Blur tabs, Add Text (T) and Add Blur Region. Text and blur
  boxes are objects: click selects (and opens their tab), drag moves.
- **Transport**: Set In, frame back, play, frame forward, Set Out, timecode, the clip's
  length (and after speed), loop (on: wraps; off: stops at Out), mute, Save Frame (the
  frame under the playhead as a photo, cropped when the crop is on).
- **Inspector**, six tabs with an in-use dot:
  - *Trim*: Range (In, Out, Length in timecode; it edits the selected segment), the
    segments (drag the grip to reorder, Delete removes), Split at Playhead (S) and Cut
    Dead Air, Speed (0.5×, 1×, 1.5×, 2×, and Fit… for Fit To Length and any speed up
    to 64×), Reverse.
  - *Crop*: Crop with its switch (Aspect, Output size, Reset to Full Frame), Motion
    (Add Keyframe K, Clear Keys), Follow a Subject (Auto-Track, Point Track), Smart
    Zoom (screen recordings only).
  - *Look*: swatches of the current frame in each look; Preview Render.
  - *Blur*: the selected region (effect, shape, strength, Shows from–to, Track) and
    the list.
  - *Text*: the selected text (Text i of n with a ⋯ menu, a box where a second line
    sits under the first, Style, colour swatches, Shows from–to) and the list.
  - *Audio*: fade in and out (slider and field), Even Out Volume, Reduce Noise; the End
    Card as its own group.
- **Timeline**: ruler, Video (thumbnails; what exports is bright; segments are blocks
  that trim from their ends and slide; cuts are hatched, labelled Cut or Paused, and
  come back on a click), Audio (a peak envelope), Motion (keys, the glide between
  them, zoom stretches in amber), Blur and Text (bars that drag in time). Snap (on by
  default) settles drags on the playhead, In/Out, edges and keys. Zoom by slider,
  buttons or Ctrl+scroll. For a GIF the video lane shows the frames over the range
  (click for a delay, right-click to drop) and the timeline zooms to it.
- **Export menu**: presets (Slack, GitHub, X, Discord, Email, Messages, Chat GIF,
  Custom), format, frame rate (or Source), size, mute; encoding (GIF: loop, dither
  with Sierra, Max Size, the frames summary and Reverse; MP4/WebM: quality or target
  size, GPU); Name; Add to Queue (Q) and Export.
- **Queue panel**: clips with a thumbnail, name and summary, and a ⋯ menu (Rename,
  Format, Duplicate, Remove); Save as Preset…; Update Clip while editing one; Export
  All.
- **Narrow panes**: below 900 px the inspector is a sheet over the timeline, opened
  from the tabs as icons under the transport; below 640 px the timeline keeps Video
  and Audio, with crop keys, blur and text as marks on the video lane.
- **?** opens the keyboard sheet.

Text on the video exports where it is drawn: `moCaptionLayout` places each line (the
export draws one drawtext per line) and the preview uses the same layout; a dragged
text carries its centre (`cx`, `cy`).

Also changed: the player's Capture Frame saves the frame at once (a JPEG next to the
video, added to the library, with Reveal); the old Capture Frame dialog (its own
preview and crop box) is gone, since the editor's Save Frame does the cropped,
choose-where version. Fixed on the way: a single export ignored Fit To Length; the
Smart Zoom hint showed without a cursor path; one remaining segment exported the stale
In/Out instead of itself (a lone segment now folds back into the range).

## How it fits together

Everything beyond one plain range is ASSEMBLED first: the kept segments, each with
its own crop keys, blur regions and look, are cut together (plus the end card) into
one near-lossless temp file, and that temp goes through the unchanged single-range
exporter. So mp4/webm/gif, target size, GIF frame edits and hardware encoders keep
working without a second code path. Captions and the audio finish are applied in
that final pass because they live on the output timeline.

The pure builders (filter graphs, escaping, dead-air parsing, zoom keys, follow
keys) sit between `@mo-pure-begin` and `@mo-pure-end` in the extension and are
extracted verbatim by the unit test and by the ffmpeg probe.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Pure clip math | `npx vitest run tests/unit/moClipGraph.test.ts` | 28 pass (timecode, split, captions per line and placed, project "edited" check, sequence order, clip length, join graph, speed-aware time mapping, split keeps speed, atempo steps) |
| Timelapse in the editor | `node tests/probes/ui-screenshot-probe.mjs <out> timelapse` | three segments, the middle at 4× (row 0:00.75, block "2 · 4×", readout "Clip 0:06.75 · then 0:03.50 of finish"); hold 1.5 s and before and after 2 s; a real export is 10.27 s for 10.25 s wanted, with sound; frames from the hold and the before and after checked by eye |
| Real ffmpeg graphs | `node tests/probes/clip-graph-probe.mjs` | 44/44 (incl. segments at 1×, 2×, 8× and 32× with crop, blur, a 1.5 s hold, before and after and an end card: length exact, sound throughout, held frames identical (PSNR 70 dB); before and after on a tall picture; and a sequence of 640×360 sound, 360×640 silent and 1280×720 60 fps parts: even size, sound throughout, length = sum) |
| Editor on screen | `node tests/probes/ui-screenshot-probe.mjs <out> clip` | split, cut, bring back, undo; blur, follow, pixelate; text dragged; a real MP4 export and a cancelled one (partial file removed); narrow sheet and tiny pane; 20 shots reviewed |
| Clip projects | `node tests/probes/ui-screenshot-probe.mjs <out> project` | a project from two videos; In moved and a clip queued on the first; the second opens untouched; the first comes back as left; the app quit and started again: the project is in the sidebar and opens with the same In, Out and queued clip; a clip queued on each video lines up in the Sequence; a real export of both (9.36 s file = the two clips); a heavier export cancelled mid-render stops in about a second with ffmpeg gone and the partial file removed; double-click opens a clip for editing; Delete Project closes the tab and empties the list |
| Media stream | `npx vitest run tests/unit/mediaStreamBridge.test.ts` | 9 pass |
| Whole suite | `npx vitest run` | green apart from the four failures CLAUDE.md lists |
| Recorder timing | hidden 2 s capture through the recorder's own argv + finalize | duration = wall clock within 40 ms |

The recorder changes (countdown, pause, hotkeys, follow, telemetry, mixed audio)
run in the Electron main process and the frame window, which the hidden probe cannot
drive. They are syntax-checked and code-reviewed, and need one real recording to
confirm on this machine.

## Ledger

| Slice | What changed | Status |
| --- | --- | --- |
| 1 Looks | Pastel/Fade/Vintage lift the output floor | shipped 98c505c5 |
| 1 Builders | captions, blur graph, audio finish, dead air, smart zoom, follow keys, assembly graph | shipped 98c505c5 |
| 2 Pipeline | assemble-then-export front door, captions and audio finish in the final pass | shipped |
| 2 Editor | segments, blur, text, audio & finish, end card, preview render, destinations, reveal/copy | shipped |
| 3 Recorder | countdown (opt-in), pause, hotkeys, hide cursor, mic+system, follow the box, cursor telemetry | shipped, needs one real take |
| 6 Shapes | oval and rounded regions through a feathered alpha mask (geq on the patch), Blur/Pixelate and shape as buttons; exported pixels checked: outside the oval untouched, inside blurred | shipped |
| 5 Fixes | real-timestamp capture (short takes played fast), app dropdowns everywhere, Track switch on blur regions, real blur and mosaic previews, look previews matched to the export | shipped |
| 4 Probe | clip scene in the screenshot probe, open-clip-editor command | shipped |
| 13 Timelapse | speed per segment (row control, timeline label, per-segment audition, lengths everywhere); Finish: hold the last frame, before and after; the assembly graph samples sped segments at fps/speed before crop and blur, stretches sound to 4× and silences beyond | shipped |
| 12 Sequence | the project's Sequence: queued clips from every video in order, reorder, leave out, edit; Export Sequence… renders, joins and encodes as one video with progress and Cancel; projects keep exported clips. Cancel now kills the running ffmpeg (editor and sequence): the bridge's promise.cancel never crossed the context bridge, so a long render used to run to its end; `terminal.cancelStream(streamId)` with a caller-named stream replaces it | shipped |
| 11 Projects | Clip Projects in the sidebar; a project page with a bin of videos (library thumbnail or a frame from the stream, drag to reorder, remove) beside the editor; each video's edits and queued clips saved to the database as they settle and on leaving, until the project is deleted; Add to Clip Project in the library's right-click menu; New Clip Project… and Open Clip Project… commands; migration 029 | shipped |
| 10 Mockup | everything the approved mockups show: undo/redo, loop, stage chips and floating bars, text as objects (multi-line, placed), split/cut/bring-back on the timeline, snap, selected-segment range, crop groups, text and blur editors, audio sliders, export presets/Source fps/loop/Sierra/max size/name, progress and Cancel on Export, queue ⋯ menu, GIF frames on the video lane, narrow sheet; Capture Frame without the old dialog; editor opens on the whole video | shipped |
| 9 Streaming | parallx-media:// with range requests; video and audio stream from disk in every Media Organizer surface | shipped |
| 8 Layout | page layout: toolbar, transport, tabbed inspector, zoomable lane timeline, Export menu, Queue panel; timecode fields; split at playhead; look swatches | shipped |
| 7 Handles | oval and rounded regions could not be resized (the soft-edge mask hid the one corner handle and the outline); shape moved to an inner fill, active region gets an eight-handle frame; move + 4 resize directions measured on all three shapes with real mouse input | shipped |

## Known limits


- Follow the box captures the whole display, so long takes are larger on disk until
  the editor crops them.
- Per-frame GIF edits are skipped when segments are joined; the frame strip belongs
  to the single-range path.
- The player does not show the finish (hold, before and after, end card); the
  readout says how long it adds, and the export renders it.
- A segment faster than 16× auditions at 16× (the browser's limit); its export
  runs at the chosen speed. Its sound is silent beyond 4×.
- Hotkeys are fixed combinations. If another program owns one, the toolbar still
  works and nothing is reported.

## Phase 2: Clip Editor as a place of its own (done 2026-10-01)

The owner records drawing and painting sessions and wants Media Organizer to be
where they become content. Today the editor opens on one video and cuts it into
clips. Phase 2 makes it a third Media Organizer surface:

1. **Streaming video (done 2026-10-01).** `electron/mediaStreamBridge.cjs` serves
   `parallx-media://file/<encoded absolute path>` with HTTP range requests, media
   file types only, under the same roots as `fs:readFile` (never spending a dialog
   grant). `localFileToUrl` returns these URLs for video and audio, so nothing reads
   a whole video into memory any more (it used to go over IPC as base64 and was
   refused past 512 MB). Video elements set `crossOrigin = 'anonymous'` and the
   protocol sends CORS headers, so frames still draw to readable canvases.
   Measured on a 2-hour, 1.2 GB file in the app: seek to 1:02:05 in 13 ms, 34 MB JS
   heap, timeline thumbnails and envelope in 35 s in the background.
2. **Clip projects in the sidebar (done 2026-10-01).** Media Organizer's sidebar
   lists clip projects (in Studio since 2026-10-01, see
   MEDIA_ORGANIZER_SIDEBAR.md): + makes a project, a click opens it, right-click
   renames or deletes it. A project opens as a page with a bin of its videos down
   the left and the editor on the one that is open. Videos come from Add Videos…
   (a file dialog) or the library's right-click menu (Add to Clip Project, one
   video or a selection). Only videos in the workspace are taken, as for Open
   Clip Editor. The bin closes to a rail on a narrow tab or on request.
3. **Many sources: the project's Sequence (done 2026-10-01).** Above the videos in
   the bin sits the Sequence: every clip queued on any of the project's videos, in
   order (bin order, then queue order, until rearranged). Rows drag to reorder, a
   switch leaves a clip out, double-click (or Edit Clip) opens its video with that
   clip loaded for Update Clip. Format, size (as the first clip, 1080p, 720p,
   square, vertical), frame rate and quality are kept with the project.
   Export Sequence… renders each clip through the queue's own path
   (`moExportClipPipeline`: cuts, crop and motion, look, blur, text, speed, audio
   finish) to a near-lossless part at the sequence's frame rate, joins the parts
   with `moSequenceGraph` (fitted inside the size with black bars, never
   stretched; stereo 48 kHz; silence where a part has none; audio cut or padded to
   each part's video so nothing drifts), and encodes the result through
   `moExportClip`. Progress and Cancel sit on the button; an export keeps running
   if the view changes and the view that comes back shows it. In a project,
   exported clips stay in their queue (`opts.keepQueue`): they are the sequence.
   The order and settings live in `mo_clip_projects.sequence_json`.
4. **Timelapse tools for paintings (done 2026-10-01).** Each segment in the Trim
   tab has its own speed (0.5× to 64×): race through the slow parts, linger on
   the reveal. The timeline marks a sped segment ("2 · 8×"), the player auditions
   each segment at its speed (up to the browser's 16×), and every length (row,
   readout, estimate, Fit To Length, the project sequence) counts it. Splitting a
   segment keeps its speed on both halves. The Audio tab's Finish group adds
   Hold the last frame (0 to 10 s) and Before and after (the first kept frame
   beside the last, labelled, side by side for a wide picture and one above the
   other for a tall one; 1 to 10 s), played after the last segment and before
   the end card. In `moSegmentsGraph` a sped segment samples the source at
   fps/speed before crop and blur (they run only on kept frames) and then plays
   at fps; its sound is time-stretched (`atempo`) up to 4× and silent beyond;
   the hold is `tpad` clone on the last segment; before and after is two
   one-frame stills through the same crop, blur and look, stacked and held. The
   clip's overall speed still applies on top.
5. **Projects keep their edits; quick clips do not.** Two kinds of work, saved
   differently on purpose. A quick clip (take a video, cut a GIF) stays as it is
   today: its edits live in memory and go when the tab closes, nothing to manage. A
   project (the Clip Editor opened from the sidebar, built from several videos)
   saves its edits to the database and keeps them until the project is deleted.
   **Done 2026-10-01** (`db/migrations/media-organizer_029_clip_projects.sql`):
   `mo_clip_projects` holds the name and the video last open;
   `mo_clip_project_sources` holds each video's path, length, bin position, the
   editor's snapshot (the same object the queue stores, plus the playhead) and
   its queued clips. The editor saves through `opts.onPersist` 600 ms after an
   edit settles, after any queue change, and when it closes (tab switch, video
   switch, app quit); a write-through cache covers a pane rebuilt before the
   database write lands. A project's editor keys its queue per project and
   video, so a quick clip of the same file never shares it. Delete Project
   removes these rows and closes the tab; videos and exported files stay.
