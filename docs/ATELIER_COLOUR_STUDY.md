# Colour Study (Atelier)

The record for Colour Study: what was asked, what was decided, what is built.
The owner asked for this to be kept here and not on the master list
(2026-11-19).

## What it is

A tool in Atelier's Studio section for learning to mix paint. For any colour
it shows how to mix it from the paints the owner has, lets him change the
parts or swap a tube and see the result, and shows how value, intensity and
temperature change. It began as a chat Mini-App ("Painting Color Wheel"),
which stays as it is.

## The owner's decisions (2026-11-19)

- Standalone. "Think of this tool as separate from a painting plan… I don't
  want it dependent on the painting plans. I want it to be standalone, but
  with the ability to come from an image." A picture or a plan can be brought
  in; neither is needed.
- It lives "under the studio section".
- Name: Colour Study ("Mixer sounds lazy").
- One mixing engine for the app: "whichever has the more accurate engine".
  The geometric-mean model of the brief and the Kubelka-Munk model already
  in `colour.js` are to be measured against the brief's tests; the better
  one serves Colour Study, the Colour step and the board.
- No hardcoded notes about one painting. General lessons are in.
- Learning tools in scope: what each tube does, Fix My Mix, value first,
  order of mixing, the limited palette test.
- The set of paints must be easy to change ("I may have more than current
  set").

## Mock-ups and picks

Page: https://claude.ai/artifact/TvyJsCWKjMZCQbN5onj7Ey (four choices, drawn
with real recipes from the current engine and the eight starter paints).

| Choice | Picked | His words |
|---|---|---|
| 1. What the screen is built around | 1A, the wheel leads, everything on one screen | "need 1A" |
| 2. What each tube does | 2A, a row of real swatches | "I'll take your picks" |
| 3. Where the theory lives | 3A, a sentence on each row and a Why to open | "I'll take your picks" |
| 4. From a picture or plan | 4A, the picture comes too | "I'll take your picks" |

What the picks rest on: no product page could be read that day (the cloud
environment's network blocked them). Search summaries of Golden's paint mixer
and Trycolors were used as leads only. 2A and 3A are Claude's judgment.
Still to read, from the Default environment: Golden's mixer, Trycolors,
Mixbox, Gurney's gamut masking, handprint.com, the W3C slider pattern.

Following from 1A: the editable mix (2A) opens in place of the rows on the
right; a picture (4A) takes the wheel's place on the left while it shows.

## What exists in the app before this

- Paints: `plan-colours.js`, "Paints you have", `{ name, hex }`, one list for
  every plan under the setting `plan_paints_v1`, with the mixing rules.
- Engine: `colour.js` (OKLab, painter's value, Kubelka-Munk mixing,
  `moMixRecipes`), used by the Colour step and the plan board.

## What is built (2026-11-19, on `dev`)

All four phases, in one pass at his word ("build all").

- The engine: `paint-wheel.js`, `paint-engine.js` (pure). `colour.js` gained
  an unrounded value, a one-pass mix and a paint's strength.
- The tool: `colour-study.js` (a sheet), `colour-study-home.js` (commands and
  the home), `colour-study-panels.js` (the mix bench and My Paints),
  `colour-study-state.js`, `colour-study-wheel.js`, `colour-lessons.js`,
  `colour-study-styles.js`, `colour-study-host.js` (what it needs from
  Atelier), migration 032 (`mo_colour_sheets`).
- Paints: one list for plans and Colour Study (`plan-colours.js`), each with
  an optional strength, and named sets (`plan_paint_sets_v1`). A set is a copy
  taken when it is saved. Choosing a set asks first when the paints in use
  are in no set and have ever been changed.
- Buttons run `media-organizer.colour.*` commands on the sheet in use;
  dropdowns, switches of a few choices, sliders, the wheel's dots and menu
  rows act through their own callbacks.
- Compare gives the difference in value only.
- From a plan: Open In Colour Study on the plan's menu and on a variation.

How it differs from the brief, and why:

- JavaScript with JSDoc, not TypeScript: extensions load from disk unbuilt.
- Kubelka-Munk, not the geometric mean (measured, above).
- Whole parts up to 8 (two paints), 6 (three), 4 (four), 3 (five), not 1 to 4: closer
  recipes for the same count of mixes (19,713 for the eight starter paints).
- Atelier's closeness words and measure (Very close, Close, Near, Far), not
  the brief's bands; "out of reach" is Far.
- The gamut is built on the main thread after the sheet's first paint (about
  140 to 160 ms here for eight paints), kept per paint list; no Web Worker.
- The ground is a setting of the sheet (Burnt Sienna unless changed).
- No sheets listed under Colour Study in the sidebar (the mock-up drew them);
  the home lists them.

How it was checked:

- `tests/unit/moPaintEngine.test.ts`: 61 tests written from the contract by
  an agent that did not see the engine, before it; all pass.
- `tests/probes/colour-study-acceptance.mjs`: written by a verifier before
  the tool's screen was built (the engine was already committed), corrected once by the same verifier after the first real runs
  (its commit says what and why: frames read after two animation frames; the
  check that a double-clicked cell also joins the palette dropped, since his
  words give that to Put on Palette; a paint is removed in My Paints, not by
  the per-sheet switch; one check added for a dialog left open); 73 of 73 on the built app, hidden, again
  after the review's fixes.
- `keyboard-audit-probe.mjs` on the five Colour Study screens (added to its
  seeds): 0. `touch-drag-probe.mjs`: all ok.
- Found on the way and fixed in the core: Enter in the app's input box
  pressed the button that opened it a second time (`notificationService.ts`,
  with a test seen to fail first).

Review (agents that did not see the build; a skeptic tried each finding):

- Fixed, reproduced or plain in the code: choosing a set replaced paints that
  were in no set without asking (now asked); Fix My Mix could say a paint
  "warms" a mix it barely moved, could suggest black against the no-black
  rule, and said "follow with white" with no white (now only a change a
  person would name counts); focus alone on a wheel dot chose that colour and
  dropped an edited mix; the warm and cool row's base cell was not the base;
  open boards and plans did not hear of changed paints; a mix with water lost
  it when edited; the mix's drift and the advice were silent to a screen
  reader; a removed tube left the focus nowhere; each row is one Tab stop
  with arrow keys; the base cell has a mark, not only an outline; the
  lightness bars are taller for a finger; copy (joining words lower case, no
  ellipsis where no dialog opens).
- Reported and left: the one-pass mix differs from the old by rounding, which
  changed the recipe in about 2 of 100 random cases (never the closeness
  word); after Atelier is turned off its paint tables stay in memory until
  restart (about 10 MB, nothing runs); the dot rings and lightness bar use the
  named colours black and white (no token fits; a pair for marks on pictures
  should be registered); the top bar is hand-laid, not the kit's page header;
  dropdowns carry their scene id by hand (the kit's dropdown takes none).
- Not done: the visual-consistency probe does not list Colour Study (nor
  Painting Plans); the bar was not read from primary sources.

## A calmer sheet (asked 2026-11-19, waiting on his picks)

His words: "Instead of having explainer text underneath, put it to the right,
use more space. The UI currently has too many words. Feels too busy."

Mock-ups: https://claude.ai/artifact/4Gkd9PUyTKF6CGrsWzGczD, drawn on the
colour from his screenshot with the engine's real rows, recipe and reach.

| Choice | Options | Claude's pick |
|---|---|---|
| 1. Where each row's words go | 1A a short note beside each row, Why as a pop-up · 1B one guide column for the row you are on · 1C no words until Notes is on | 1A |
| 2. How the card shows the recipe | 2A a small list (parts, paint, two or three word role), three secondary actions as icons · 2B a bar of the proportions, roles on hover | 2A |

All options drop the 1,100 px width cap and shorten the copy; the page lists
every sentence before and after. The picks are judgment: no source could be
read from this environment.

## Open

- The widget's source file (`painting-color-wheel.txt`) never reached the repo
  or a session: the tool was built from the brief and the picked mock-ups, not
  from the widget's code.
- Paint colours and strengths are estimates until he sets them from his tubes.
- Only his machine can show: how it feels to drag at full frame rate, and the
  recipes against real paint.

## Later decisions (2026-11-19)

- "build all": the four phases are to be built.
- Named paint sets: "yes named sets are good".
- Mixing model measured: the Kubelka-Munk model in `colour.js` makes green
  from Ultramarine Blue and Yellow Ochre (103,119,79); the geometric mean
  makes a muted blue (70,81,108). Kubelka-Munk is the engine; the geometric
  mean stays behind the same interface for comparison.

## The contract the tests and the probe are written to

Written before the build, for the agents who write the tests without seeing
the code.

### Engine (`ext/media-organizer/paint-wheel.js`, `paint-engine.js`; pure, no DOM)

Colours are `[r, g, b]` bytes. A paint is `{ name, hex, strength? }` (hex with
or without the hash). Rules are Atelier's mixing rules (`MO_MIX_RULES`).

`paint-wheel.js`
- `moWheelHue(angle, model = 'painter')` → screen hue in [0, 360);
  `moWheelAngle(hue, model = 'painter')` → wheel angle in [0, 360). Models:
  `'painter'` (RYB: angles 0, 60, 120, 180, 240, 300, 360 are hues 0, 30, 60,
  120, 240, 285, 360, linear between) and `'screen'` (identity).
- `MO_HARMONIES`: `complementary [0,180]`, `splitComplementary [0,150,210]`,
  `triadic [0,120,240]`, `tetradic [0,60,180,300]`, `square [0,90,180,270]`,
  `analogous [0,-30,30]` (wheel-angle offsets).
- `moHarmonyHues(type, baseHue, model)` → screen hues, the base first.
- `moHslRgb(h, s, l)` (s, l in 0..1) → rgb; `moRgbHsl(rgb)` → `[h, s, l]`.

`paint-engine.js`
- `moValue(rgb)` → painter's value, CIE L* / 10, not rounded.
- `moOklch(rgb)` → `[L, C, hDegrees]`; `moFromOklch(L, C, h)` → rgb, chroma
  reduced until it fits sRGB. `moDeltaE(a, b)` → distance in OKLab.
- `moColourAtValue(h, C, value)` → rgb at that painter's value.
- `MO_MIX_KM`, `MO_MIX_GEOMETRIC`, `MO_MIX_MODEL` (the one in use): each
  `{ name, prep(paint), mix(prepared[], parts[]) → linear rgb 0..1 }`.
- `moMixRgb(paints, parts, model?)` → rgb of `parts[i]` of `paints[i]`.
- `moGamut(paints, rules?, model?)` → every mix the paints reach under the
  rules: `{ size, paints, ... }`. The same input returns the same object.
- `moRecipe(gamut, rgb)` → `{ paints: [{ name, hex, parts, role }], rgb, hex,
  de, closeness, reachable }`; `closeness` is `moCloseness`'s word, `de` its
  measure (OKLab with hue and chroma counted twice).
- `moReach(gamut, rgb)` → 0 (out of reach) to 1 (within reach), smooth.
- `moDrift(fromRgb, toRgb)` → `{ dValue, dChroma, dHue, de, closeness, text }`.
- `moTubeNudges(paints, mix, add = 1, model?)` with `mix` as
  `[{ name, parts }]` → for every paint `{ name, hex, rgb, drift }`.
- `moSubstitutes(paints, rules, rgb, without, model?)` → recipes without
  that paint, closest first (at most three).
- `moFixMix(paints, mix, problem, model?)`, problem one of `bright`, `dull`,
  `dark`, `light`, `warm`, `cool` → `{ name, action: 'add' | 'less', rgb,
  drift, text }` or null.
- `moMixOrder(recipePaints, paints)` → `{ order: [names], text }`.
- `moVariationRows(rgb, { cells = 10, light = 'warm' })` → `{ value, light,
  tone, temp, twins }`, each a list of `{ rgb, value, base? }`.

### The tool in the app

- Command `media-organizer.colourStudy` opens the Colour Study home (editor
  `media-organizer-grid`, instance `colour:list`); the Studio section of
  Atelier's sidebar has the item "Colour Study". A sheet is instance
  `colour:sheet:<id>`. Commands `media-organizer.colour.newSheet` (returns the
  new sheet's id and opens it), `.rename`, `.remove`.
- Sheets are rows of `mo_colour_sheets (id, title, state_json, created_at,
  updated_at)`. Paint sets are the setting `plan_paint_sets_v1`; the paints
  in use stay in `plan_paints_v1`, so plans and Colour Study share them.
- The sheet's root is `.mo-cs`; `root.__moColourStudy.state()` returns what
  is on screen: `{ sheetId, title, wheel, harmony, colours: [hex], active,
  base, light, valueCheck, hatch, source, paints: [names], paintSet, mix:
  [{ name, parts }] | null, recipe: { paints, hex, de, closeness }, drift,
  rows: { value: [hex], light, tone, temp, twins } }`.
- Controls, by `data-px-id`: `media-organizer.colour.wheelModel` (Painter,
  Screen), `.harmony`, `.valueCheck`, `.hatch`, `.myPaints`, `.paintSet`,
  `.source` (Wheel, Picture), `.editMix`, `.copyRecipe`, `.studyThis`,
  `.putOnPalette`, `.lightKind` (Warm Light, Cool Light), `.twinsGrey`,
  `.addPaintToMix`, `.resetMix`, `.less.<paint-slug>`, `.more.<paint-slug>`,
  `.swap.<paint-slug>`, `.dropPaint.<paint-slug>`, `.fix.<problem>`,
  `.choosePicture`, `.choosePlan`, `.tubeOn.<paint-slug>`.
- Parts of the page: the wheel `.mo-cs-wheel` with one `.mo-cs-dot` per
  palette colour (role slider, arrow keys turn the set and change its
  strength, keys 1 to 9 choose a colour); palette rows `.mo-cs-pal-row` each
  with a lightness bar `.mo-cs-vbar` (role slider); the card `.mo-cs-card`
  with `.mo-cs-target` and `.mo-cs-mix` on `.mo-cs-ground`; rows
  `.mo-cs-row[data-row]` (`value`, `light`, `tone`, `temp`, `twins`) of
  `.mo-cs-cell` buttons, each row with a sentence `.mo-cs-row-note` and a
  Why disclosure `.mo-cs-why`; the bench `.mo-cs-bench` with a
  `.mo-cs-tube[data-paint]` per paint (its parts in `.mo-cs-parts`), the
  drift sentence `.mo-cs-drift`, the row `.mo-cs-nudges` of
  `.mo-cs-nudge[data-paint]` buttons, and the advice `.mo-cs-fix-advice`;
  the picture `.mo-cs-picture` and its colours `.mo-cs-mass`; Compare
  `.mo-cs-compare` with `.mo-cs-verdict`.
- From a plan: command `media-organizer.plan.openInColourStudy` on the open
  plan's variation makes a sheet with the variation's picture and colours.
