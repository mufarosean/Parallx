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
