# Enhance on SeedVR2

The image editor's Enhance, and the library's Upscale, move from Real-ESRGAN
(2021 model, 2022 build) to **SeedVR2** (ByteDance, 2025, Apache-2.0): a
diffusion restorer that keeps skin, fur, fabric and stone looking real where
Real-ESRGAN repainted them smooth. The old engine is removed.

This charter is the plan. Each decision below says who made it.

## What was found

- Real-ESRGAN failed on camera-sized photos: a 24 MP photo at 2x took about
  11 minutes, past the 10-minute limit, then retried at smaller tiles, each
  with another 10 minutes. It always ran at 4x, even for 2x. It reported
  success even when it wrote nothing. Its output smoothed texture and shifted
  tone.
- SeedVR2 on the RTX 5090, full photos enlarged 2x: the 7B "sharp" model
  kept skin, fur, fabric and seeds natural; the 3B model smeared, worse than
  the old engine. About 26 s per 2400 x 1600 photo with the model loaded.
- A whole 24 MP photo at 2x does not fit in 32 GB of graphics memory. In
  overlapping pieces (12 of them, 2048 px each, 192 px overlap, feathered
  joins) it took 4 min 22 s plus 10 s to join, with no visible joins at
  100%.
- On a soft input the model invents texture (a lioness's nose grew fur).
  The model that ships is 7B sharp (fp8, 8.5 GB): the one he looked at
  and was fine with.

## The parts

### 1. Tool runtimes (core)

A tool that needs a heavy local engine declares it; the core installs it
once for the whole machine, on the user's click, and runs it. The core
knows no tool by name: Enhance is the first to declare one.

A declaration (the tool's manifest, `contributes.runtimes`) names:

- the Python version, run by uv, both pinned;
- a lock file in the tool's folder: every package at an exact version with
  its hash;
- large files (model weights): address, size, SHA-256;
- what the machine needs: system, graphics card, graphics memory, driver,
  disk space.

Where it lives: `<app data>/runtimes/<id>/`, outside every workspace, so one
copy serves them all. Inside: uv, its Python, the environment, the files, a
state file. Nothing is written anywhere else: uv runs with `--no-bin` and
`--no-registry` (by default it puts a shortcut in the user's folder and
registers itself in the Windows registry; a test on 2026-10-14 showed both,
and both were removed).

Setup, step by step, each step checked and able to resume:

1. Check the machine against the declaration, and say plainly what is
   missing (no NVIDIA card, too little memory, an old driver, no disk room).
2. uv, at a pinned version, checked against its published SHA-256.
3. Python from uv (`--no-bin --no-registry`, inside the runtime folder).
4. The environment, packages installed only from the lock file with hashes
   required. `--native-tls` uses the system's certificates: security
   software that inspects HTTPS (Norton, on this machine) breaks uv's own
   certificate check, and with the system's it works.
5. Large files through the app's own downloader (it already fetches the
   Remove model this way), resumable, kept only if the SHA-256 matches.
6. A short self-test on the card. Only then is the runtime ready.

Running: the environment's Python, argv form, never a shell, with a rebuilt
environment (no user site packages, no inherited PYTHONPATH, temp inside the
runtime folder, UTF-8 output). Progress comes back as JSON lines. Cancel
ends the process and everything it started.

Off means off: declaring a runtime runs nothing and downloads nothing. A
tool that is turned off keeps its installed runtime (data is kept); the
settings show its size and a Remove button.

Network: only the hosts setup needs (GitHub for uv and Python, PyPI, the
PyTorch index, Hugging Face), only during setup.

### 2. Enhance (Media Organizer)

- A Python driver of our own (`enhance.py`) loads SeedVR2 once, cuts the
  picture into overlapping pieces sized to the free graphics memory,
  enlarges each, joins them with feathered edges, keeps colour true to the
  original (SeedVR2's lab correction), and reports progress per piece.
- SeedVR2's code (3.5 MB, Apache-2.0, pinned at commit 4490bd1) ships inside
  the extension with its licence, so setup fetches nothing from GitHub but
  uv and Python.
- The Enhance panel: a setup card when the engine is not installed (what it
  needs, the download size, Set Up Enhance), progress through setup, then
  2x and 4x as now, with the estimate measured on this machine.
- Before each run: the free graphics memory is read, and it sets the size
  of the pieces. Measured on the RTX 5090 with the model loaded: a 4096 px
  enlarged piece peaks at 19.4 GB, a 2048 px piece at 11.5 GB. So 21 GB
  free means large pieces, 13 GB free small ones (slower), and with less
  Enhance says what it needs; it never stops another program (an Ollama
  model shares the card). The smallest card it sets up on: 16 GB.
- Where two pieces overlap, each pixel takes its detail from one piece, with
  a narrow feathered hand-over (192 px on a 2048 px piece) in the middle of
  the overlap. Feathering across the whole overlap averaged two pieces'
  detail and visibly softened skin; the narrow hand-over kept it, and no
  join showed at 100% (a portrait; a 24 MP photo with a smooth dark ground).
- SeedVR2's image reading and writing are changed to work on paths with any
  characters (OpenCV's imread and imwrite fail on Windows outside ASCII);
  engine/seedvr2/NOTICE lists the changes.
- The library's Upscale uses the same engine. Several photos go through one
  run (`enhance.py --jobs`, `engine/enhance_batch.py`), so the model loads
  once for the batch, not once a photo (about 10 s each): `engine/enlarge_many.py`
  runs SeedVR2's own per-file step with the cache its command line keeps for
  a folder, taking every photo's pieces in turn (pieces of different photos
  differ in size, which one command-line run cannot take). A photo is cut
  while the one before it is enlarged; each is joined and written as soon
  as its pieces are back, under `.part` and then renamed, so Stop keeps the
  photos already done and leaves no half picture. A failure in one photo is
  reported for that photo and the rest go on. One photo still goes through
  the single-picture run. Files the engine cannot read (HEIC) become a PNG
  first, through the bundled ImageMagick.
- Removed: Real-ESRGAN, its setup dialog and script, the tile-size setting,
  the Photo / Art model choice.

### 3. Video and GIFs (2026-11-12)

His words: "short videos, bigger resolution", then "run video
enhancement". The same engine and the same model: SeedVR2 is a video
model, and for a clip it reads frames in groups, so fine detail holds
from frame to frame where a picture-at-a-time enlargement shimmers.

What the user gets: Enhance Video… or Enhance GIF… on one item in the
library (its menu, and the viewer's bar). One dialog says what the clip
becomes and about how long it takes, offers a three-second preview with
the original beside it and a line between them that a slider moves, and
runs the clip with its progress. The result is a new file beside the
original (`name-2x.mp4`; a GIF stays a GIF) with the original's sound,
tags, albums, rating and details. The original is never changed.

How a clip goes through (`engine/enhance_video.py`):

1. ffmpeg, the machine's own, makes a plain copy of the part asked for:
   a steady frame rate, even sides, no sound, no loss. The engine then
   reads one kind of file whatever the original was.
2. SeedVR2 enlarges it in chunks of 80 frames, in groups of 9 that share
   one frame with the next, and each frame is written as a PNG in a work
   folder in the workspace. A stopped run keeps its whole chunks; Enhance
   on the same unchanged clip carries on from there.
3. ffmpeg joins the frames (H.264) with the original's sound, copied as
   it is when an MP4 can carry it, re-encoded to AAC when not. The result
   is written in the work folder and moved beside the original when
   whole, so a stopped run leaves nothing there.

Measured on his RTX 5090, 5 seconds (120 frames) of a street scene:

| From, to | Groups | Time | Peak graphics memory |
|---|---|---|---|
| 360p to 720p | 5, nothing shared | 80 s | 17 GB |
| 360p to 720p | 5, sharing 2 | 132 s | not read |
| 360p to 720p | 9, sharing 1 | 84 s | 21 GB |
| 720p to 1440p, in tiles | 5, nothing shared | 291 s | 16 GB |
| 720p to 1440p, in tiles | 9, sharing 1 | 305 s | 24 GB |
| 720p to 1440p, not in tiles | 5 | stopped: turning the frames back to pictures filled all 32 GB and one group had not finished in 80 s | 32 GB |

Ten seconds of the 720p clip (Theora, Vorbis) through the real script:
2560 x 1440, 240 frames, AAC sound, 10 minutes 41 seconds. About 0.6
seconds for each frame of one megapixel, which is what the dialog's
estimate uses.

What the measurements decided:

- Groups of 9 sharing 1 frame. With groups of 5 and nothing shared, fine
  detail jumped at every group's edge (1.6 times the change inside a
  group); sharing removed it. Groups of 9 sharing 1 cost no more time
  than groups of 5 sharing nothing; groups of 5 sharing 2 cost 1.6 times.
  The price is memory: 21 to 24 GB, so the chat model has to be off the
  card. The dialog reads the card's free memory first and, short of it,
  offers Set The Chat Model Aside (the core's `releaseLocalModels`).
- Results above 1.3 megapixels a frame go through in tiles. Whole, a
  1440p frame fills the card at the last step.
- Chunks meet with a small jump too (1.6 times the usual change, the
  same for a carried-on run as for an unbroken one), so they are long:
  80 frames. That is what a stopped run can lose.
- A result's long side is at most 2,560 pixels and a clip at most 3,600
  frames. 1080p to 4K was not measured.

Against the real thing (the 360p clip was made from the 720p one, so the
720p frames are the truth): the enhanced frames are sharper than the
real 720p (fine detail 10.2 against 8.7; plain stretching gives 8.0),
and further from it pixel for pixel than plain stretching is (mean
error 6.0 against 2.5 of 255). It draws detail that looks right; it
does not recover what was there. By eye, faces, cloth and paving are
clearly better than the stretched clip. The model's card warns that it
over-sharpens clean footage, and the numbers agree.

A stopped run's work folder (`.enhance-video-…` beside the thumbnails)
is kept until the clip is finished or Start Over is chosen. A finished
folder's state file is removed at once, its files are erased the user's
way (Eraser works on after the dialog closes), and the next start
removes the folder. A preview's folder goes when the dialog closes.

Checks: `tests/unit/moEnhanceVideo.test.ts`;
`tests/probes/enhance-video-probe.mjs` runs the real script in a hidden
copy of the app with a stand-in for the model (the menu, the dialog,
the keyboard, the preview, stop and carry on, the card in use, the
result's size, frames and sound, the library, a GIF).

The core gained `api.ui.keepTabInside` for extensions: a modal dialog an
extension builds keeps Tab inside it, as the core's own do.

Left: a real run from the dialog on one of his own clips, and his
verdict; 4x; several clips in one go; the Enhance button in the clip
editor.

## Platforms

Windows and Linux with an NVIDIA card. SeedVR2 needs PyTorch with CUDA;
other cards and Macs get a plain message that Enhance needs an NVIDIA card,
until there is a way that is good enough on them.

## Checks before it is called done

- Unit tests: declarations, the lock (hashes required), every path stays in
  the runtime folder, the piece plan and its blending weights, progress.
- A full setup on this machine into an empty runtime folder, with the system
  Python hidden from the path, as on a machine that has never had Python.
  Before and after: nothing new outside the folder (user folder, registry,
  uv's default caches).
- A setup stopped half-way resumes; a damaged file is refused.
- In the app, hidden: Enhance on a 24 MP photo, Preview, Cancel, the
  library's Upscale on several photos, an error when the card is too full.
- The accessibility audit on the new panels reads 0.

## Decisions

| Decision | Who |
|---|---|
| SeedVR2 replaces Real-ESRGAN ("seedvr2 is the clear choice") | Mufaro, 2026-10-14 |
| Set up well, no mistakes; another user must get it running with no hassle | Mufaro, 2026-10-14 |
| One copy per machine, installed by the app on the user's click | Claude, to meet the line above; the app used to refuse to download programs itself, and this replaces that rule for declared runtimes |
| uv with pinned hashes and system certificates | Claude |
| Big photos in overlapping pieces | Claude, from the out-of-memory test |
| SeedVR2's code ships in the extension | Claude |
| The model: SeedVR2 7B sharp, fp8 (8.5 GB), the one he looked at and was fine with; 3B rejected (smears) | Mufaro, 2026-10-14 |
