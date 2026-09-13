# Parallx Milestone 104 — Reference Practice and Painting Planning (Media Organizer)

> **Status: DESIGN COMPLETE** (discussed 2026-09-10, decisions settled
> 2026-09-12). Nothing built, no branch. This file records what is decided, what is proposed, and what is
> still open, so the build can start from it without re-deriving anything.
> Source of truth for this work; the memory note points here.

## What this is

Three connected systems inside **Media Organizer**, for drawing and painting:

1. **A reference library.** Mufaro's own reference photos, of any subject,
   organised and searchable.
2. **Timed practice.** A daily study picture and on-demand practice
   sessions, drawn at random from the library, on a clock.
3. **Painting planning.** The step before the canvas: crop, light, colour,
   values, composition and palette worked out on the reference photo, the
   way Mark Maggiori refines a design in Photoshop before he paints.

A fourth thread joins them to what already exists: recorded drawing and
painting sessions go through the Media Organizer clip editor to become
clips for posting.

**In Mufaro's words** (lightly edited for typos, 2026-09-10):

- "Think about how Mark Maggiori uses Photoshop to build his painting idea
  before he even puts it on canvas, that's the system I want to build: the
  ability to crop, adjust lighting, colour, saturation, hue, play with the
  palette, play with the composition, maybe have some grids for different
  compositions to try out."
- "The UI would be minimalistic, not busy."
- "Reference photos are not just people."
- "We are building systems here, not just features."

**Who it is for.** Mufaro draws and paints (self-taught portrait drawing,
more recently oil painting). Assume strong fundamentals, sessions of about an
hour, and that he stays the author. This is not an AI art generator; any AI
here serves his own making.

**Not derived from** the 2026-09-05 fun-extension round
(docs/research/Fun_Extensions_*), which Mufaro rejected wholesale. This is
his own idea and starts from his spec.

**Context.** The workspace that will host this lives on his external SSD.
Nothing in this milestone depends on that.

## Decisions (settled with Mufaro 2026-09-10)

- **D1 — It lives inside Media Organizer, not in a separate extension.**
  "Having an extension that is reliant on another so much leads to
  ambiguity." One owner for the photos, tags, practice history, plans and
  clips.
- **D2 — References are any subject.** Landscapes, objects, animals, skies,
  people, master works. Never frame the system around poses; "pose" is just
  one tag a user might filter by.
- **D3 — Practice is one system with two uses.**
  - **Daily Study:** automated. One picture per day, from anything in the
    library, for a time the user sets.
  - **Practice Session:** the same mechanism on a set the user chooses (for
    example photos tagged pose), sized either by **number of pictures and
    time per picture**, or by **total time and time per picture**, in which
    case the number of pictures is calculated. A random sample of that many
    pictures is drawn from the set.
- **D4 — Systems, not features.** Shared engine, shared rules, one record.
  Both practice uses are configurations of the same engine.
- **D5 — Minimal UI.** The picture is the interface; controls stay small and
  out of the way.
- **D6 — Clips reuse the existing clip editor** (docs/CLIPS.md) for drawing
  and painting videos.
- **D7 — Everything art-specific sits behind one Media Organizer setting**
  (Mufaro, 2026-09-12). One boolean, default off, workspace scope, declared
  in the manifest the way `mediaOrganizer.enableScreenRecorder` is. Off hides
  practice, Daily Study, plans and their commands, Home cards and automation;
  it never deletes data, and migrations still run. The Part C clip-editor
  fixes (timelapse speeds, HEVC preview, HEIC import, missing files marked
  offline) are general library improvements and are not gated.

## Research base (verified 2026-09-10)

**New Masters Academy** (what exists to learn from):

- A reference library of 35,000 to 40,000 images (the figure differs by page)
  plus 3D models, downloadable at high resolution for offline use.
- Filters and range: clothed or nude, more than 60 models, ages and
  ethnicities. Categories include full-body poses, facial expressions, hands
  and feet, locations, animals, famous works of art, and simple shapes and
  shadows.
- **Daily Life Drawing Sessions:** poses of 1, 2, 5 and 10 minutes, selected
  from the library. When the time is up a chime sounds and the pose changes.
- A 3D viewer where the camera, the lighting setup, the scene and material
  properties can be changed.

What this milestone takes from NMA: the timed session with a chime, and a
library you filter by what you want to practise. Out of scope unless asked:
courses, the 3D viewer.

**Mark Maggiori** (Southwest Art, 2018):

- Photographs Americana and Western landscapes on trips, and sets up
  organised photo sessions with models in authentic dress.
- "I go through my photos and start sketching."
- Uses Photoshop to refine his designs before heading to the canvas, then
  quickly transcribes the composition with pencil or charcoal.
- Most works take two to three weeks including drying time. He keeps his
  cloud-painting technique private.

What this milestone takes from Maggiori: the order of work. Gather photos,
refine the design digitally, transfer it to the canvas.

## What Media Organizer already gives this milestone (verified 2026-09-10)

- **Library model:** photos with tags (and tag aliases/relations), albums
  with hierarchy, smart albums, custom fields, colour labels, ratings,
  stacks, trash, full-text search, perceptual hashes.
- **Surfaces:** sidebar with quick filters, the Home feed (masonry, shuffle),
  grid, lightbox, detail editor with Similar Photos, drop-to-import.
- **Upscale** (Real-ESRGAN, bundled tool): writes a new file beside the
  original and stacks it under it. The same pattern suits plan outputs.
- **Clip editor and screen recorder** (docs/CLIPS.md): trim, segments, crop
  with aspect presets including 9:16, blur, text, looks, audio finish.
- **Storage:** one SQLite database per workspace at
  `<workspace>/.parallx/extensions/media-organizer/data.db`, migrations in
  `ext/media-organizer/db/migrations/`.
- **Code shape:** one hand-authored `ext/media-organizer/main.js`, validated
  with `node --check`. Extensions load as single-file modules, so all new
  code lands in main.js. Pure logic goes between `// @mo-pure-begin` and
  `// @mo-pure-end`, where unit tests extract it verbatim
  (tests/unit/moClipGraph.test.ts is the precedent).

**Gaps found that this milestone must close:**

- Clip speed options stop at 4x, and a painting session needs timelapse
  speeds.
- The in-app player refuses HEVC, the usual phone video codec.
- Chromium cannot decode HEIC, RAW, AVIF or TIFF thumbnails, so phone photos
  in HEIC need conversion on import.
- The startup sweep (`moPurgeMissingFiles`) deletes the records of any file
  it cannot find, taking its tags, albums and ratings with it. That is
  harmless for a healthy library, but a reference library carries a lot of
  hand-made tagging, so the sweep should mark missing files instead of
  deleting them.

---

## Part A — The practice system

### The engine (decided shape)

One engine, four parts. Every practice run, daily or chosen, is this engine
with different settings.

| Part | What it is |
|---|---|
| **Pool** | Where pictures come from: the whole reference library, a tag, an album, a smart album or a search. Stored as the question, not a list, so new photos join automatically. |
| **Picker** | Draws a random sample of a given size from the pool, with no repeats inside one run. |
| **Clock** | Time per picture. When it runs out the player says so and moves on. Pause, skip and previous; the user can return to any picture at any time. |
| **Log** | One row per picture shown: which picture, when, the time planned and spent, finished or skipped. |

### Daily Study (decided: one picture per day, anything, user-set time)

- Pool: everything in the workspace. The workspace is the reference
  library (O1); nothing is marked as a reference.
- One picture per day, chosen on the first open of the day and stored, so it
  is the same picture however often the app is reopened that day.
- Duration: the user's daily time setting.
- Surface: a quiet card at the top of Media Organizer's Home with the
  picture and a Start button.

### Practice Session (decided: chosen set, two ways to size it)

- **Pool:** chosen by the user, for example the pose tag, an album, a smart
  album or a search.
- **Sizing, either way:**
  - Number of pictures and time per picture. Total time is shown.
  - Total time and time per picture. The number is calculated and rounded
    down, and the spare time is shown.

    ```
    45 minutes at 2 minutes each = 22 pictures, 1 minute to spare
    ```

- **Presets:** a setup can be saved and named, so a warm-up is one click.
- **Proposed:** if the pool holds fewer pictures than requested, the setup
  says so and offers to shorten the session to the pool size.

### Shared rules (proposed)

- **One history feeds one picker.** Across both uses, the picker favours
  pictures not drawn for the longest time, choosing at random among equals.
  Never-drawn pictures count as the oldest. Result: the whole library is
  worked through before anything repeats, and practising a picture in a
  session also pushes it back in the daily queue.
- **The log is the single record.** Time totals, "not drawn in months" and
  per-picture history are all read from it; nothing keeps a second tally.
  There is no streak (O2).
- **Per-picture history.** A photo's detail view shows when it was drawn,
  oldest to newest.
- **Pools reuse smart-album criteria** so any saved smart album can serve as
  a pool (to verify against `mo_smart_albums` before building).
- **Settings go through the Settings registry** under `mediaOrganizer.*`:
  daily time, daily pool, chime on or off, default mirror and greyscale.

### The session player (proposed)

- The picture fills the tab. A small timer sits in a corner.
- Controls: pause, skip, previous, stop. Options per run: mirror, greyscale.
- When a picture's time is up the player says so, nothing more (O3). The
  user can go back to any picture in the run at any time.
- The end screen shows the pictures drawn as a strip. No photos of drawings
  are attached (O4).

### Data (proposed, new migrations in Media Organizer)

- `mo_practice_presets`: name, pool criteria, sizing mode, time per picture,
  count or total time, options.
- `mo_practice_sessions`: kind (daily or practice), preset, pool criteria,
  started and ended, planned and spent seconds.
- `mo_practice_draws`: session, photo, position, planned and spent seconds,
  outcome (done, skipped, overtime), time.
- `mo_practice_daily`: day, chosen photo, session once started.

Picker state is derived from `mo_practice_draws` (last drawn, times drawn);
no counters stored separately.

---

## Part B — Painting planning (proposed, not yet decided)

The Maggiori step: work the design out on the photo before the canvas.

- **A plan is one painting.** It holds the canvas size in inches, the source
  photo, a list of adjustments, overlays, a palette, variations and notes.
- **The original photo is never changed.** Adjustments are a recipe applied
  on top and can be changed or undone at any time.
- **Layout:** the picture fills the tab. A thin tool strip at the side opens
  one tool at a time.
- **Tools (version one):**
  - **Crop:** locked to the canvas proportions; rotate and flip.
  - **Light:** exposure, contrast, highlights, shadows, warmth, tint.
  - **Colour:** hue and saturation.
  - **Values:** greyscale, reduce to 2, 3 or 5 values, notan, squint blur.
  - **Composition overlays:** thirds, golden section, diagonals, and a
    transfer grid sized to the canvas in inches.
  - **Palette:** swatches pulled from the picture, and a preview of the
    picture in a limited palette.
  - **Compare:** before and after, and a mirror check.
- **Variations** side by side; keep the one that works.
- **Output:** the finished plan is written as a new picture beside the
  original and stacked under it, the way Upscale already does, for a tablet
  at the easel or printing with the grid.
- **Version two:** combining several photos into one plan (a figure from one
  photo under the sky of another), which needs layers, masks and cut-outs.
  Maggiori works this way, but it is the largest piece and follows version
  one.
- **Process shelf:** each plan can collect its progress photos and clips, so
  one painting's story sits in one place.
- **Data (proposed):** `mo_plans`, `mo_plan_variants`, `mo_plan_media`.
- **Rendering (proposed):** adjustments previewed live on the GPU at full
  resolution; the export renders the same recipe.

## Part C — Clips for posting (proposed)

- Drawing and painting videos (phone or camera) import into Media Organizer
  and go through the existing clip editor.
- Close the gaps listed above: timelapse speeds, including a fit-to-length
  option such as one minute; a preview copy for HEVC footage, with the
  export made from the original; HEIC photos converted on import.
- A clip can be attached to a plan's process shelf.

---

## Principles and gates

- **Ship complete:** every slice lands with its UI and its settings in the
  Settings registry, in the same commit.
- **Design gates before commit:** tokens not hex; one dropdown
  (`moBindCustomSelect` or `moDropdown`, never a bare native select); Title
  Case labels; no em dashes in UI strings; minimal, quiet surfaces.
- **Sidebar is navigational:** Practice and Plans are entries that open
  tabs; actions live on those tabs, hints are tooltips.
- **Never touch the original file.** Plans and practice read photos; outputs
  are new files.
- **Pure logic is unit-tested:** picker, sizing arithmetic, daily pick and
  history live in the pure region with vitest coverage.
- **Verified before claimed:** hidden probe runs against the real app for
  every UI slice.

## Proposed slices (order only; not scheduled)

1. **Engine:** pool criteria, picker, sizing arithmetic, daily pick and
   history as pure functions with unit tests.
2. **Practice Session:** setup tab with both sizing modes, presets, the
   session player, log writes, settings.
3. **Daily Study:** Home card, stored daily pick, settings.
4. **History:** per-picture drawings in the detail view, a neglected list.
5. **Plans, version one:** the planning tab with the tools and overlays,
   variations.
6. **Plan output:** export, print with the transfer grid, stacking under the
   original, process shelf.
7. **Clips for painting videos:** timelapse speeds, HEVC preview copies,
   HEIC import conversion; missing files marked instead of deleted.
8. **Plans, version two:** combining photos.

## Open decisions (all settled by Mufaro 2026-09-12)

| # | Question | Decision |
|---|---|---|
| O1 | What counts as the reference library? | The whole workspace. The user keeps a dedicated art workspace; anything added to it is a reference. No album, no marking. |
| O2 | What happens to a missed day's picture? | It goes back into the queue. No streak, nothing tracked. |
| O3 | What happens when the timer ends? | Tell the user time is up, nothing fancy. The user can still go back to any picture. |
| O4 | Are photos of drawings attached to sessions? | No. |
| O5 | Pool smaller than the requested number of pictures? | A notification; the run uses the pictures there are. |
| O6 | Plans: one photo first, combining photos second? | Yes. Single-photo plans are version one; combining photos is version two. |
| O7 | Where are plan outputs written on disk? | Beside the original, stacked under it, as Upscale does. |

## Sources

- New Masters Academy, FAQ: https://www.nma.art/faq/
- New Masters Academy, Daily Life Drawing Sessions:
  https://www.nma.art/videolessons/daily-life-drawing-sessions/
- Concept Art Empire, New Masters Academy review:
  https://conceptartempire.com/new-masters-academy-review/
- Southwest Art, "Mark Maggiori | Lightning Strike" (August 2018):
  https://www.southwestart.com/featured/maggiori_m_aug2018
