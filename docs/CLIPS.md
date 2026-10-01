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

Mockups: `docs/mockups/clip-editor-redesign.html`. The editor is a page, not a dialog
in a tab:

- **Toolbar**: file name, length and size; the estimate (format and size); Queue
  (with a count); Export, with a menu for format, size and quality.
- **Stage**: the video fills the left side. Under it the transport: Set In, frame
  back, play, frame forward, Set Out, timecode, the clip's length (and its length
  after speed), mute. On the Crop tab the aspect ratios and Preview Crop float on the
  video.
- **Inspector**: six tabs (Trim, Crop, Look, Blur, Text, Audio). A dot marks a tab
  whose settings are in use. Trim holds the range in timecode (In, Out and an
  editable Length), the segments, and Timing (Speed, Fit To Length, Reverse). Look is
  a grid of swatches of the current frame.
- **Timeline**: a ruler, the Video lane (thumbnails over the whole source; what
  exports is bright, the rest dimmed; segments as numbered blocks), the Audio lane
  (a peak envelope), and lanes for crop keyframes, blur windows and text windows.
  Drag anywhere to scrub; drag bars to move them in time; S splits at the playhead.
  Zoom with the slider or Ctrl+scroll; Fit shows everything. The ruler draws only
  the ticks in view, and thumbnails come from key frames only on videos over two
  minutes, so a two-hour session opens in seconds.
- **Export menu**: preset chips, format, frame rate, size, mute; then encoding
  (quality or target size, GPU; for GIF dither, loop, frame order, auto-optimize);
  Add to Queue (Q) and Export. A GIF also gets the GIF frames row under the timeline
  for per-frame delays and drops.
- **Queue panel**: the batch, presets, Stop Editing. After an export a toast offers
  Reveal and Copy Path.
- Below 860px wide the inspector moves under the video; below 560px the timeline
  keeps the Video and Audio lanes.

The state, tracker and export pipeline are unchanged by the redesign. Fixed on the
way: a single export ignored Fit To Length (only queued clips honoured it); the Smart
Zoom hint showed on videos with no cursor path.

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
| Pure clip math | `npx vitest run tests/unit/moClipGraph.test.ts` | 13 pass |
| Real ffmpeg graphs | `node tests/probes/clip-graph-probe.mjs` | 34/34 |
| Editor on screen | `node tests/probes/ui-screenshot-probe.mjs <out> clip` | 6 scenes captured, reviewed |
| Whole suite | `npx vitest run` | green |
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
| 9 Streaming | parallx-media:// with range requests; video and audio stream from disk in every Media Organizer surface | shipped |
| 8 Layout | page layout: toolbar, transport, tabbed inspector, zoomable lane timeline, Export menu, Queue panel; timecode fields; split at playhead; look swatches | shipped |
| 7 Handles | oval and rounded regions could not be resized (the soft-edge mask hid the one corner handle and the outline); shape moved to an inner fill, active region gets an eight-handle frame; move + 4 resize directions measured on all three shapes with real mouse input | shipped |

## Known limits


- Follow the box captures the whole display, so long takes are larger on disk until
  the editor crops them.
- Per-frame GIF edits are skipped when segments are joined; the frame strip belongs
  to the single-range path.
- Hotkeys are fixed combinations. If another program owns one, the toolbar still
  works and nothing is reported.

## Phase 2: Clip Editor as a place of its own (planned)

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
2. **Clip Editor in the sidebar.** Opens an empty editor with a media bin: pick
   videos (and clips already exported) from the library.
3. **Many sources.** A segment carries its source path. The assembly step already
   cuts segments into one near-lossless temp file, so the change is per-segment
   `-i` inputs plus normalising size and frame rate before concat. Crop keys, blur
   regions and text stay per segment or on the output timeline as today.
4. **Timelapse tools for paintings.** Speed per segment (ramp through the slow
   parts, linger on the reveal), a "finished painting" hold at the end, and a
   before/after split.
5. **Projects that persist.** The editor's state saved to the database so an edit
   survives closing the app (today it lives in memory and the tab's view state).
