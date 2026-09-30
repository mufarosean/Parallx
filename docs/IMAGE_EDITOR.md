# Image Editor: a Lightroom-style editor inside Media Organizer

Status: built 2026-09-28, not committed. Mufaro's verdict in the app is owed.

Media Organizer could store, tag and upscale a photo, but it could not
change one. A video had a whole editor; a photo had two buttons. This program
gives photos an editor modelled on Lightroom, with two things Mufaro asked for
by name: Upscale moves into it, and a Remove tool erases a mark (a logo, a tag,
a date stamp) and rebuilds the background behind it.

A first version was handed over with only the Light and Colour sliders and was
judged bare bones, rightly: it was one step of seven. This document describes
the whole editor, which is what is in the app now.

## What a user gets

**The screen**
- One Edit Image tab. Edit Image on a photo's tab, in the library's right-click
  menu, or as a command puts that photo in it.
- A histogram at the top of the panel, with a marker at each end that lights
  when shadows or highlights are clipped.
- A tool strip: Edit, Crop And Rotate, Remove, Enhance.
- A presets panel on the left and a filmstrip of the folder's photos along the
  bottom. Both can be hidden.

**Edit**
- Light: Exposure, Contrast, Highlights, Shadows, Whites, Blacks, a Tone Curve
  (all channels, or red, green or blue alone) and Auto.
- Colour: Pick White Balance, Temperature, Tint, Vibrance, Saturation, Black And
  White, a Colour Mixer (eight colours, each with hue, saturation and luminance)
  and Colour Grading (a wheel each for shadows, midtones and highlights).
- Effects: Texture, Clarity, Dehaze, Vignette with Midpoint and Feather, Grain
  with Size.
- Detail: Sharpening with Radius, Noise Reduction, Colour Noise Reduction.
- Every slider moves the picture live. Double-clicking a slider or its name
  returns it to rest, and the number beside it can be typed.
- Each section has an eye, to see the picture without it, and its own reset.

**Crop And Rotate**
- Shapes: Original, Free, 1:1, 4:5, 5:7, 2:3, 3:4, 9:16, and Swap Orientation.
- Straighten, Rotate Left and Right, Flip Horizontal and Vertical.
- The frame is dragged on the photo, with thirds lines. Straightening a crop
  that was as large as the photo allowed keeps it as large as the turned photo
  allows; one drawn smaller is only ever made smaller, to stay on the photo.

**Remove**
- Brush over a mark and it is erased; the background is rebuilt from what
  surrounds it. Each removal can be undone later, on its own.
- It runs on this machine. Nothing is sent anywhere.
- The model is fetched once (198 MB), from the Remove tool.

**Remove From Other Photos**
- A set of photos carries the same logo. Remove it on one, choose Remove From
  Other Photos in the Remove tool, and it is looked for in the photos chosen.
- Choosing the photos: the page lists the rest of the photo's folder, none
  ticked. A click on a photo ticks it, a shift-click ticks the run up to it,
  Select All ticks all. Only the photos ticked are read and searched.
- From the library: select the photos that have the mark, right-click, Remove
  Marks From Selected. The page opens on those photos, ticked. The example is
  the one of them a mark was last removed on; when none has had one removed
  yet, the first opens in the editor on Remove and the selection is kept.
- A mark is found wherever it sits and at whatever size (from 2.5 times
  smaller to 2.5 times larger than on the example, and no smaller than 48
  pixels on the photo), solid or see-through, also where it reaches the
  photo's edge.
- A photo keeps at most six finds a mark. Every find has been looked at
  twice, the second time finer, and is judged on the second look.
- More than one: every mark removed on the example is looked for (each can be
  ticked off), and a mark that is on a photo twice is found twice.
- Find Marks changes nothing. Each photo shows the shape that will be removed,
  where it will be removed. A shape clicked stays in the photo. What the
  finder is unsure of is drawn in another colour, left out until clicked, and
  listed first; photos where nothing was found come next.
- What is removed, a choice on the page:
  - Mark Only (the default): the mark's own shape, the letters of a word and a
    few pixels round them. What lies beside the letters stays as it is. The
    shape is worked out from the photos that have the mark, never reaches
    outside what was brushed on the example, and is shown on the mark and on
    every photo before anything is removed. A mark too few photos have (fewer
    than three good finds) says Whole Area and is removed that way.
  - Whole Brushed Area: all that was brushed on the example.
- Open In Editor on any photo, to look closer or to brush a mark by hand.
- Remove And Save Copies asks once, then removes the shapes shown and writes
  a copy of each photo beside its original. The originals are not changed.
  Each removal is part of that photo's own edit and can be undone there.
- How To Save, beside that button: Save As Copies (as above) or Save Over
  Originals, which replaces each photo's file with the picture without the
  marks. It asks once and says the originals cannot be brought back.
- Stop ends either step after the photo in progress.

**Enhance**
- Upscale lives here: 2x or 4x, Photo or Art model. The enlarging happens when
  the copy is saved, after the rest of the edit.
- The editor cannot show an enlarged picture, so when the copy is done it opens
  in a tab of its own.
- The Upscale button on a photo's tab is gone. The library keeps Upscale in its
  right-click menu, for several photos at once.

**Presets and copying an edit**
- Twelve looks, previewed by pointing at them and applied by clicking.
- Save Preset keeps the current look under a name; right-click one of yours to
  rename, update or delete it.
- Copy Edit and Paste Edit carry a look from one photo to another, in the editor
  or onto photos selected in the library. A look is the sliders, curve, mixer
  and grading; the crop and removals stay with their own photo.

**Comparing**
- Show Original, and Split View with a divider to drag.

**Saving**
- Save As Copy writes `name-edit.jpg` (PNG stays PNG, an enlarged copy is a
  PNG) beside the original at full size and gives it the original's tags,
  albums, rating and details. For a JPEG the camera data is carried over.
- The copy is a photo of its own in the library, beside the original, seen the
  moment it is saved, so the two can be compared and one of them kept. Nothing
  is ever put under another photo: stacks were retired on 2026-09-28 (see
  Stacks retired, below).
- Save As Copy never changes the original file.
- Save (Ctrl+S) writes the edit over the original, which it replaces. It asks
  first and says the original cannot be brought back. The photo stays the
  same item in the library, with its tags, albums and rating; its record,
  thumbnail and look-alike hash are brought up to date; the edit is cleared,
  since the file holds it now, and the editor opens the saved file afresh.
  The picture is written beside the original under a name the library turns
  away (`name.saving-k3x9ab.jpg`) and takes the original's name in one step,
  so a save that fails leaves the original as it was. A JPEG stays a JPEG
  and a PNG a PNG, enlarged or not; any other kind of file (HEIC, WebP, TIFF,
  a camera's raw file) can only be saved as a copy, and Save says so.
  Asked for by Mufaro on 2026-09-28: "we cannot just have save as copy".
- Save does not wipe the old picture from the disk: what it held stays in
  freed space until the disk reuses it, as after any ordinary save.
- Paste Edit onto photos in the library asks how to save them: Save As Copy,
  Save Over Original, or Not Now.
- While a copy is being saved a bar says what is going on (Drawing the edit,
  Enlarging, Bringing it to size, Adding it to the library), how far along it
  is, and for how many seconds.
- A plain save leaves the editor in front and offers Open in its notice.
- The edit is remembered per photo. Reopening the photo shows every control
  where it was left. Photos with an edit carry a dot in the filmstrip.
- The library shows what is on disk: an edit appears there when it is saved as
  a copy.

**Shortcuts** (while the Edit Image tab is the active one)

| Keys | Does |
| --- | --- |
| Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z | Undo, redo |
| `\` | Show Original |
| Shift+`\` | Split View |
| Ctrl+0, Ctrl+1 | Fit, 100% |
| Ctrl+Shift+C, Ctrl+Shift+V | Copy Edit, Paste Edit |
| Page Up, Page Down | Previous photo, next photo |
| `[`, `]` | Smaller brush, larger brush |
| Ctrl+Shift+S | Save As Copy |
| Ctrl+S | Save, over the original |

**Settings**
- JPEG quality for Save As Copy (default 92).

**Stacks retired (2026-09-28)**

A stack kept several photos under one card. Upscale, Painting Plans and the
first Save As Copy each put their copy under the original. A stack could be
filled but never opened or undone, and when the photo on top was deleted the
copy under it stayed out of every view for good, which is how a saved copy went
missing from the library. Mufaro's rule: a copy is its own file, shown beside
the original. So stacking is gone everywhere: the setting, the Upscale box,
Stack Selected Items, Auto-Stack by Filename, the `+2` count on a card and the
rule that hid stacked photos. Migration 028 releases whatever was in a stack.
An upscaled copy now carries the original's tags, albums, rating and details,
as a copy saved from the editor does.

## What is left out

- Masking: editing only part of a photo.
- Lens corrections and raw files.
- Layers, brushes, selections, text. That is the paint-and-layers kind of editor,
  a separate and much larger program.
- Blur or pixelate regions on photos. Mufaro judged blur the wrong answer for
  hiding a mark; Remove is the answer.

## Known limits

- Remove guesses, it does not know. Over a wall, sky, floor or fabric the result
  is clean. Over a face, a hand or a body it paints something plausible that is
  not what was there.
- Remove shows the model a window of at most 512 pixels a side. A small mark on
  a large photo is repaired at full detail; a very large mark is repaired
  softer than its surroundings.
- Colours outside sRGB (some phone photos) are brought into sRGB on the way in,
  as everywhere else in the app, so the copy is an sRGB picture.
- A result above 268 megapixels, or 32,767 pixels on a side, is refused with a
  message. That is the ceiling of the canvas the picture is assembled on.
- The shortcuts are fixed and are not yet listed in the Keyboard Shortcuts panel.
- Remove From Other Photos finds a mark by its shape. It finds a stamp: the
  same artwork laid on each photo. It does not find a logo that is part of the
  scene (on a shirt, a sign), turned, or bent; that needs a model that has
  learnt what logos look like.
- Mark Only needs the mark on at least three of the photos looked in, found
  well. With fewer, all that was brushed is removed (the mark says Whole
  Area). A soft shadow or glow round a mark is not part of the shape the
  photos agree on; if one is left behind, Whole Brushed Area takes it.
- Whole Brushed Area rebuilds whatever lay under the brush (a rock in a
  river) with the rest, and over fine texture the rebuilt band is softer than
  its surroundings, the wider the mark the more so.
- One brush stroke is one removal, and each removal on the example is a mark
  of its own to look for. A word brushed letter by letter is ten marks.
- A mark that is white on a near-white sky is found only when enough of its
  outline can be read. It was found in the test set; it is the hardest case.
- A mark smaller than 48 pixels on a photo (the root of its area: a word of
  110 by 21 pixels) is not looked for, and one that small on the example
  says Too Small. At that size anything looks like it.
- A mark between 48 and about 100 pixels on a photo cannot be looked at
  finer than it was found, so it is judged on the first look alone and must
  score higher there (0.62). A faint mark of that size may go unfound.

## Decisions

| Decision | Source |
| --- | --- |
| Adjust-and-crop kind, not paint-and-layers | Mufaro, 2026-09-28 |
| Copy a known editor instead of inventing one | Mufaro, 2026-09-28 |
| The editor to copy is Lightroom | Claude's recommendation; Mufaro held Claude to it ("you promised me that you were copying light room") |
| Upscale moves into the editor | Mufaro, 2026-09-28 |
| Remove uses the LaMa model, run locally | Mufaro, 2026-09-28 |
| No blur for hiding marks | Mufaro, 2026-09-28 |
| The whole editor in one delivery, not a step at a time | Mufaro, 2026-09-28 ("what you built feels very bare bones") |
| A progress bar while saving and enlarging | Mufaro, 2026-09-28 ("It's hard to know that it is still running") |
| The enlarged copy opens in a new tab when it finishes | Mufaro, 2026-09-28 |
| No button of its own in the Enhance panel | Mufaro, 2026-09-28 (offered, "not necessary") |
| Save As Copy always, original untouched | Claude; told to Mufaro, not answered. Overruled 2026-09-28: he asked for Save over the original as well |
| Save asks before it replaces the original; Ctrl+S; JPEG and PNG only | Claude; told to Mufaro |
| The photo tab's Upscale button gives way to Edit Image; the library keeps Upscale | Claude; told to Mufaro, not answered |
| One editor tab with a filmstrip, not a tab per photo | Claude |
| The model is fetched by the app, on the user's click, and kept only if its hash matches | Claude; differs from the upscaler, which is fetched by a script the user runs |
| Marks removed in bulk across a set, not needing to sit in the same place | Mufaro, 2026-09-28 |
| Bulk works through Remove, not blur | Mufaro, 2026-09-28 ("yes, I meant remove") |
| More than one mark a photo | Mufaro, 2026-09-28 |
| The finder matches the mark's shape (a stamp), not a detection model | Claude. Mufaro was asked whether his logos are stamps or part of the scene and did not say |
| The mark is learnt from the photos that have it, before the search proper | Claude |
| What is found is shown and agreed to before anything is removed | Claude; described to Mufaro before building, not objected to |
| A copy is written for every photo a mark is removed from | Claude |
| Remove only the mark's own shape, worked out from the photos, shown first, never outside what was brushed, with Whole Brushed Area to fall back on | Claude's proposal; Mufaro, 2026-09-28 ("go ahead") |
| The photos to look in are chosen by the user, not the whole folder searched | Mufaro, 2026-09-28 ("just let us select the photos with the marks so we save resources") |
| On the page nothing is ticked to begin with; photos selected in the library come ticked | Claude |
| A way in from the library's selection (Remove Marks From Selected) | Claude; the library's menu for several photos had no way to the editor |

## How it fits together

**One engine, two users.** `moImageEngine` in `ext/media-organizer/main.js` is
one WebGL program driven by a recipe. Painting Plans draws with it through
`moPlanRenderer`. Every control is skipped when it is at rest, so Painting Plans
draws exactly what it drew before the editor existed; that was checked pixel by
pixel (see Verification).

**Geometry is two maps.** Canvas to output (zoom and pan, the crop tool's
window, or one tile of a save) and output to source (crop, straighten, quarter
turns, flips). Both are small matrices built by pure functions.

**Neighbourhood controls read blurred copies.** Texture, Clarity and Dehaze read
two blurred copies of the source, made once per source by halving it and
blurring the small copy. Sharpening and Noise Reduction read the pixels around
each pixel directly.

**The recipe is the edit.** Slider values, the curve, the mixer, the grading, the
crop and the list of removals, stored per photo (`mo_photo_edits`, migration
026). The picture on screen and the saved file both come from running the
recipe through the engine, so what is seen is what is saved. Presets are looks
in `mo_edit_presets` (migration 027).

**Saving is drawn in tiles.** Each tile reads its own part of the source, with a
margin wide enough for the neighbourhood controls, so neither the size of the
photo nor the graphics card's texture limit changes a pixel. The rest reuses the
Upscale path: `moIngestNewImage`, `moTransferPhotoMetadata`.

**Removals are patches.** A removal is a small PNG (the model's pixels where the
brush was, fading out at its edge) kept in the workspace at
`.parallx/extensions/media-organizer/edits/<photo id>/`, and a line in the
recipe saying where it goes. The photo with its patches laid over it is what
the recipe is drawn from. Patches no recipe or undo step names are deleted when
the photo is next opened.

**The model runner is part of Parallx.** `electron/modelBridge.cjs` and
`electron/modelWorker.cjs`, reached from an extension as
`window.parallxElectron.models`. It is general: any extension can run any ONNX
model through it.
- A model is named by the SHA-256 of its file. The file on disk is
  `<models>/<sha256>.onnx`, so a caller cannot point the runner at another path.
- Models live in `data/models` under the app's folder.
- Downloads are https, from huggingface.co only, refused while the workspace is
  sealed, and kept only if the size and the hash both match.
- It runs in a worker thread and lets go of the model after two minutes without
  a run, so it does not sit on graphics memory a chat model needs.
- The graphics card is reached through the runtime's WebGPU provider. Its
  DirectML provider fails on this model. A model that will not run on the card
  falls back to the processor.
- The runtime is the npm package `onnxruntime-node` (1.30.0), which ships ready
  built.

**House rules kept.** Colours from tokens (the exceptions are colours that are
data: the histogram's channels, the slider tracks for temperature and tint, the
grading wheels, the lines drawn over a photo), Title Case labels, no em dashes
in UI text, the shared dropdown and context menu, flush layout, shortcuts
through the keybinding service, settings through the manifest.

**Finding a mark.** `moFind*` in the pure region. A photo is turned into a
field of edge directions (Sobel, two bytes a pixel). A mark is a few hundred
edge points, each with the direction its edge faces, taken from under the
brush on the example. A position is scored by how far the photo's edges under
those points face the same way (Steger's measure): brightness, contrast and
the background do not enter into it. Every position is scored on the graphics
card (`moFindEngine`, WebGL 2, the same sum in JavaScript where there is
none), for each size in `moFindPlan`, the photo shrunk so the mark is 48 to
96 pixels (a photo is searched at up to 6144 pixels on its long side, so a
small mark on a large photo is still 48); positions that stand out are checked
in JavaScript on the full set of points, at sizes and places close by
(`moFindCheck`). That is the first look. Up to 24 places a mark that pass it
(0.38) are looked at again with the mark 128 pixels large (`moFindSettle`),
and a find is judged on that second look: 0.6 is the mark, 0.45 may be. Where
the mark is too small on the photo for a finer look, the first look must be
0.62. Finds lying over each other are merged, and the best six a mark are
kept. The first photos are searched with the example alone; the finds that
score 0.7 or better, up to eight a mark, are what the mark is then learnt from
(`moFindConsensus`): an edge most of them have along one line is the mark's,
one only the example has is the example's background. Once learnt, a mark is
looked for at the sizes it was met at (`moFindRange`), and at every size
again on a photo where that finds nothing.

Settled by measurement, on real and generated photos with a logo stamped on:
searched at 20 pixels a mark, look-alikes scored as high as the mark (0.5);
at 48, marks checked at 0.56 to 0.88 and the best look-alike at 0.44. A
forgiving search (each pixel taking the direction of the strongest edge near
it) lost faint marks to stronger edges beside them, and was dropped. A
gradient floor of 6 of 255 left a white mark on a bright sky unread; 3 reads
it and raises no look-alike.

**Thousands of finds where 18 were due** (Mufaro, 2026-09-28, on his own
photos; reproduced on test photos, his were not looked at). Two causes, both
from large photos with a small mark, a case no test had:
- A photo was searched at 2048 pixels at most. A mark of 210 pixels on a
  photo of 4800 was 90 pixels there, and the smaller sizes tried for it went
  down to 24: 75 to 81 finds a photo, one of them the mark, the wrong ones
  scoring up to 0.83. Now a mark is never tried under 48 pixels, and the
  photo is searched larger instead: one find a photo, the mark.
- With that mended, a mark of 360 pixels and a tag of 270 on photos of 4800
  still gave 58 finds for 9 marks. A large photo has six times the places of
  a photo of 1600, and its best look-alikes scored 0.46 to 0.54 at the first
  look, where the pass mark was 0.5. At the second look the marks scored 0.87
  to 0.99 and those look-alikes 0.17 to 0.31. The verdict is now the second
  look's: 9 finds for 9 marks.

**The mark's own shape.** A find is first settled (`moFindSettle`): the search
places a mark to within two or three pixels and a percent or two in size on
the photo, too coarse for a shape cut to the letters, so the place is looked
at again with the mark 128 pixels large and sizes half a percent apart. The
finds a mark is learnt from are cut from settled places, so they lie over each
other. The shape (`moFindMatte`): the edges the photos agree on, small breaks
closed, whatever they shut in filled (the body of a thick letter, the eye of an
O), the rim grown by 2% of the mark's size for the fringe a JPEG leaves, the
whole kept inside what was brushed. It is laid on each photo at the find's own
place and size, not stretched. A shape under 3% or over 92% of what was
brushed is no shape: the brushing is used.

## Verification

Measured 2026-09-28 on Mufaro's machine (RTX 5090). The app was never shown on
screen: the probes run it hidden, on a throwaway workspace of seed pictures.

| Check | Command | Result |
| --- | --- | --- |
| Recipe, looks, tone curve, geometry, crop, tiles, names, camera data, Auto, white balance, Remove's window | `npx vitest run tests/unit/moImageEdit.test.ts` | 58 of 58 pass |
| What the model runner fetches, keeps and refuses | `npx vitest run tests/unit/modelBridge.test.ts` | 11 of 11 pass |
| Painting Plans maths | `npx vitest run tests/unit/moPlan.test.ts` | 10 of 10 pass |
| The editor in the real app | `node tests/probes/image-editor-probe.mjs <outDir>` | 72 of 72 checks pass, no renderer errors |
| Every slider changes the picture | same probe | all 18, the fine ones judged at 100% |
| What is seen is what is saved | same probe | the saved file differs from the screen by 1.12 of 255 on average |
| Remove | same probe | the mark stood 110.1 of 255 from the photo that never had one; the repair stands 2.3; the rest of the photo moved 0.15 |
| Enhance | same probe | 1920 × 1080 became 3840 × 2160 in 10 to 15 s; nothing temporary left beside the photo |
| The progress bar | same probe | seen at 0, 43 and 94 percent, naming each stage, never moving back |
| The enlarged copy opens in its own tab | same probe | it does, in front |
| The original is never written to | same probe | size unchanged after every save |
| Painting Plans draws the same on the shared engine | one-off comparison against the last commit, 13 recipes | identical, 0 values differ |
| Set Up Remove from an empty folder | one-off, in the real app | 198 MB fetched in 7 s, hash matches, no part file left |
| The model itself | one-off, outside the app | 0.08 s a removal on the graphics card once warm, 1.0 s on the processor, about 6 s to load |

Remove From Other Photos, measured the same day:

| Check | Command | Result |
| --- | --- | --- |
| The finder's maths: edge points, the score, sizes tried (never under 48 pixels, a large photo searched larger), a mark elsewhere, smaller, larger, twice, see-through, in a corner, learnt from several photos, its shape, a find settled, the verdict of the second look, the best few kept, none where there is none | `npx vitest run tests/unit/moImageEdit.test.ts` | 77 of 77 pass (17 of them the finder's) |
| The whole flow in the real app, hidden: a logo and a tag brushed on one photo, photos chosen, searched (9 marks stamped on 7 of 13, at other places and sizes, one see-through, one in a corner over a bright sky), removed, copies checked | `node tests/probes/bulk-remove-probe.mjs <outDir>` with `PROBE_PHOTOS` set to a folder of real photos | 52 of 52 checks pass, no renderer errors |
| The same on large photos with small marks: photos of 4800 x 3201, the logo 357 pixels wide, the tag 270 | the same with `PROBE_LONG=4800 PROBE_MARK=1` | 52 of 52 checks pass; before the verdict was the second look's, 42 of 52 |
| Choosing | same probe | nothing ticked to begin with; a click ticks, a shift-click ticks the run, Select All and Select None; with 4 of 13 ticked only those 4 were looked in |
| From the library | same probe | the photos selected open ticked; with no mark removed on any of them the first opens in the editor on Remove |
| Marks found | both | 9 of 9 where they were put, scoring 0.73 to 0.99; 9 finds in all on 13 photos, at most 2 on one; nothing else called a mark; nothing left to decide |
| Time to look | both | 13 photos, two marks, on the graphics card: at 1600 x 1067, 4 s to learn and 10 s to search; at 4800 x 3201, 14 s and 31 s |
| Time to remove and save | both | 6 photos in 23 s at 1600, 33 s at 4800 |
| The mark is gone from each copy | same probe | of the 7 solid marks removed, 6 leave none of their colour behind; the seventh (white on a bright sky) leaves 22 pixels more than the photo has of its own, of 4,774. The see-through mark is judged by looking again |
| Mark Only leaves what lay beside the letters | same probe | in the mark's box, further than 14 pixels from any letter, at most 0.4% of pixels changed. Whole Brushed Area on the photo kept back: 82.8% |
| Closer to the photo that never had the mark | same probe | over water, the place stood 15.4 and 20.8 of 255 from that photo with all that was brushed removed; 4.7 and 8.4 with Mark Only |
| Looking again | same probe | nothing found, in the copies or in the photos they were made from |
| No original written to | same probe | sizes unchanged |

Not covered by a check: Mufaro's own set (the thousands of finds were
reproduced and mended on test photos), a set of hundreds of photos (the time
is measured on 13), photos of very different sizes in one set, a mark between
48 and 100 pixels on the photo, Stop, a mark with a shadow or glow.

`PROBE_ONLY=enhance,remove` runs just those parts of the probe. Remove is checked
only when the model is on disk (`PARALLX_MODELS_DIR`, or `data/models`), Enhance
only when the upscaler is installed; the probe says so when it skips one.

Found and fixed on the way:
- The library's folder watcher took in the upscaler's half-way picture (the 4x
  file a 2x request is made from). Hashing and thumbnailing that file made a 2x
  enlargement take about five minutes and left the temporary file in the
  library. `classifyFile` now turns such names away. This also affected the
  Upscale that was already in the library's menu.

Not covered by a check:
- A photo larger than the graphics card's texture limit (the tile path is unit
  tested for where it reads from, not rendered at that size).
- A real camera JPEG's data block (unit tested on built blocks).
- Pick White Balance, Save Preset's name prompt, renaming and deleting a preset,
  and Paste Edit onto several photos from the library with copies written: the
  maths and the menu entries are checked, the clicks are not driven.
- A mark over a face, a hand or a body. One was tried by accident (the first
  test mark lay across a fallen boxer): the repair was plausible, not true.

Two older test files are not in working order, neither touched here:
`tests/probes/practice-probe.mjs` calls `media-organizer.openHome`, a command
that is gone, and `tests/unit/moAiTagging.test.ts` fails on a missing function.

## Later, not part of this program

- **Generative fill** for cases where Remove has too little to go on (a mark over
  a face or a hand).
- **Wide marks rebuilt in parts**, each at full detail, so a wide logo's band
  is as sharp as its surroundings.
- **Logos that are part of the scene**: a detection model in place of the shape
  matching. Not asked for.
- **A ComfyUI extension.** Raised by Mufaro 2026-09-28 and held off by him the
  same day. Not agreed, not planned.
