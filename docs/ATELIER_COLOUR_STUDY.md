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

## Phases (none started; each needs his go)

1. Engine and tests: gamut, reach, recipes, role hints, the variation rows,
   forward mixing from edited parts, the drift in words, substitutes, what
   each tube does.
2. Colour Study in Studio: wheel, palette, colour card, editable mix, sheets
   in their own table, changing the paints.
3. The rows (value, intensity, warm and cool, value twins), Compare, the
   lessons.
4. Bringing in a picture or a plan; Open In Colour Study from a plan; the
   limited palette test.

## Open

- The widget's source file (`painting-color-wheel.txt`) has not reached the
  repo or a session; it is needed for phase 2.

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
