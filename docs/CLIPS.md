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

**Editing**
- Segments: several In/Out ranges export as one clip, in list order, with reorder
  and remove. Cut Dead Air finds where the picture froze and the sound went quiet
  inside the range and keeps the rest.
- Blur or pixelate regions, drawn on the video, limited in time, and optionally
  following a moving subject with the existing tracker.
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
| Pure clip math | `npx vitest run tests/unit/moClipGraph.test.ts` | 12 pass |
| Real ffmpeg graphs | `node tests/probes/clip-graph-probe.mjs` | 32/32 |
| Editor on screen | `node tests/probes/ui-screenshot-probe.mjs <out> clip` | 6 scenes captured, reviewed |
| Whole suite | `npx vitest run` | green |

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
| 3 Recorder | countdown, pause, hotkeys, hide cursor, mic+system, follow the box, cursor telemetry | shipped, needs one real take |
| 4 Probe | clip scene in the screenshot probe, open-clip-editor command | shipped |

## Known limits

- Follow the box captures the whole display, so long takes are larger on disk until
  the editor crops them.
- Per-frame GIF edits are skipped when segments are joined; the frame strip belongs
  to the single-range path.
- Hotkeys are fixed combinations. If another program owns one, the toolbar still
  works and nothing is reported.
