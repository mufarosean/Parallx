# Painting Plans: the artist's flow

Status: **built** (2026-10-15, after the owner said go). Commits 5389c6fc (stage 1), ae6af958 (2),
9156ed39 (3 and 4), 04927b4f (5), and the Transfer and clean-up commit (6). His verdict in the app is owed.
Mock (works on real pictures): https://claude.ai/artifact/QojZqtTazqmoGTLaEfxami

## Why

The plan editor grew tool by tool: Picture, Values, Layout, Compare, Colours, Study, Notes.
The owner judged the result "AI slop". It has too many word buttons, segmented controls
that leave a gap, fixed presets where sliders belong, and no flow. Studying the colours
happened in one tool, while the palette and the mixes lived in another.

This charter replaces the tools with the order an artist actually works in.
That order is: take a photo, crop it to the canvas, enhance it, understand its values,
then its colour, then transfer it to the canvas.

## The five steps

The steps run down the rail, numbered 1 to 5. Each step works on the result of the step before it.

### 1. Compose
- **Canvas size** is typed in inches, or picked from the proportions Photo, 5:4, 4:3, 3:2 and 1:1, in landscape or portrait.
  A new plan starts in the picture's own proportions; cropping is always the user's choice.
- **The crop frame** keeps the canvas proportions. Drag it to move it; Straighten and a free crop sit here as well.
- **Composition guide**, drawn inside the frame:
  - None;
  - Thirds;
  - Golden grid (0.382 / 0.618);
  - Golden spiral (a true golden rectangle, stretched to the frame; Turn the Spiral steps through its four corners);
  - Diagonals (corner to corner plus the baroque and sinister lines);
  - Triangles (one diagonal plus the perpendiculars from the other corners).
- The Transfer grid is a different thing. It stays in step 5.

### 2. Photo
- **Enhance** is at the top and runs on the *cropped* picture. From then on, every edit and every step works on the enhanced copy.
  - If the crop changes after enhancing, the panel says so and offers Enhance Again.
  - This fixes what the owner hit: Enhance read the unedited file because the edits were not saved yet.
- **Below Enhance**, the Image Editor's own sections appear in full, not a cut-down copy:
  Light, Tone Curve, Colour, Colour Mixer, Colour Grading, Effects, Detail and Remove.
  - They are the same panels, built once and shown in both places. The Image Editor stays as it is for people who do not use plans.
  - The plan's recipe is the Image Editor's recipe (moImageEngine), so a plan edit and an editor edit mean the same thing.

### 3. Values
- **Squint** is a slider (0 to 100%).
- **Values** is a slider from 2 to 11; 11 means every value, unbanded.
- **Light and shadow only** splits the picture into two families. "Where light ends" is a slider.
- **Underpainting colour**: Grey, Burnt Sienna, Raw Umber, Burnt Umber, Yellow Ochre, Ultramarine Blue, Payne's Grey or Sap Green, taken from the app's paints.
  - The values are drawn in that one paint, from its darks to its tints, the way a monochrome underpainting is laid in.
  - Saved as a variation (e.g. "Sienna underpainting"), it becomes the base for the painting.

### 4. Colour
Study and Colours become one place. The masses *are* the palette.
- **Mass controls** are sliders:
  - Masses, from 2 to 48 (it was capped at 16);
  - Squint;
  - Colour amount, which fades toward the underpainting colour chosen in Values, or grey when there is none.
- **A mass's colour** is either its local colour (the commonest colour in the shape) or its average.
- **Two switches sit on the masses** instead of standing as separate views:
  - Show warm and cool;
  - Show only strong colour (with a "Stronger than" slider).
- **The palette** lists every mass:
  - each row shows the mass's name, its warm or cool tag, its share of the picture and a mix bar;
  - opening a row shows the recipe in parts, a check of the mix against the colour, and the value and intensity.
- **Clicking a shape on the picture** opens its row in the palette and dims the other shapes. Clicking it again clears that.
- **The eyedropper** adds picked colours to the same list. Its sample size is a slider (1 to 45 px).
- **Shift-click two rows to compare them:** which is darker or lighter, warmer or cooler, which way the hue leans, and which is greyer.

### 5. Transfer
- The inch grid (1, 2 or 3 in), with optional square numbers and letters, drawn on the sharp picture.
- Export With Grid and Print With Grid are under Export.

## Everywhere

- **Zoom and move:** scroll zooms around the pointer at every step, dragging moves the picture, and double-click (or Fit) fits it again.
  - Keyboard: the same zoom from keys.
  - Touch: pinch and drag.
- **Before and after** is a toggle in the top bar. Its line is dragged on the picture itself, works the same at every step after Compose, and moves with the arrow keys.
- **Top bar:** undo, redo, Before and After, Mirror, Notes, Board, and an Export split button (Export Plan, Export With Grid, Print With Grid…).
  These are icons with names and tooltips, not word buttons.
- **Variations strip** along the bottom: the saved variations, + to save a new one, save changes to the current one, and a menu with Start Over, Add To Board, Rename and Remove.
  This keeps the variations system as built in 8629dba4.
- **Segmented controls** fill their row: every option takes an equal share, so there is no gap at the end.
- **Accessibility:**
  - every control comes from the kit and has a name;
  - the crop frame and the before/after line move by keys and by touch (onDragPress);
  - keyboard-audit-probe and touch-drag-probe stay at 0.

## What happens to the current tools

| Now | Becomes |
|---|---|
| Picture (crop, light, colour) | Compose + Photo |
| Values | Values (sliders, underpainting colour) |
| Study | split into Values (light and shadow) and Colour (masses, warm/cool, intensity, compare) |
| Colours (palette, picker, mixing) | Colour |
| Layout (thirds, inch grid) | composition guides go to Compose, the inch grid to Transfer |
| Compare | the Before and After toggle (already moved) |
| Notes | the Notes icon in the top bar |

Saved plans keep working: old recipes map onto the new steps, and nothing a user saved is dropped.

## As built

- Each module owns its step: `plan-shell.js` (rail, top bar, view), `plan-compose.js` (Compose and
  Transfer), `plan-photo.js` (Photo), `plan-colours.js` (Values, the eyedropper, My Paints),
  `plan-study.js` (Colour), with `plan-kit.js` for the panels' sliders, choices and switches.
- A variation remembers the view it was saved from (`show`: photo, values or colour). Its
  thumbnail, the board and the export show that view, and opening it goes to that step.
  Transfer's "Under the grid" chooses the view for the working picture.
- Values are drawn in perceptual lightness (OKLab), in the underpainting paint or grey; the
  Image Editor's Black And White is untouched.
- Remove needs its model; when it is missing the panel sends the painter to the Image
  Editor's Remove tool to set it up.
- Older plans open as they were: their crop, their three guide switches (now one guide),
  their light and colour (now the editor's look) and their values.

## Build stages

Each stage is finished, checked (typecheck, vitest, build, hidden probes, keyboard and touch audits at 0) and committed before the next one starts.

1. **Frame and navigation.**
   - The five-step rail, the icon top bar, the variations strip and full-width segmented controls.
   - Scroll zoom and pan at every step.
   - Before and After working on every step. This includes finding why it fails on some screens today.
2. **Compose.** Canvas size and proportions, the movable crop frame, and the six composition guides.
3. **Photo.**
   - Lift the Image Editor's panels into one shared component and show it in the plan.
   - Enhance on the crop, with the enhanced working copy and the Enhance Again state.
4. **Values.** The squint and values sliders, light and shadow, and the underpainting colour.
5. **Colour.**
   - Masses up to 48, with squint, colour amount toward the underpainting, and local or average colour.
   - Warm and cool and strong colour as switches; the palette with inline recipes.
   - Click a shape to find its row; the eyedropper size slider; compare two.
6. **Transfer and clean-up.**
   - The inch grid on the sharp picture.
   - Retire the old tool modules, move old plans over to the new steps, and update the docs and the reference.
