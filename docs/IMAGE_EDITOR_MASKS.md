# Image Editor: masks (local adjustments)

Status: **steps 1 and 2 built** (2026-10-15, each after the owner said yes). Step 1: brush, linear and
radial gradients, Add, Subtract, Intersect and Invert, every local control and Blur, in the Image Editor's
Masks tab and a plan's Photo step, through saves and the 16-bit TIFF. Step 2: Subject, Background, Sky,
Object, Words and Distance, found by models on this computer, and a plan's Ignore Background.
Candidates as tested: https://claude.ai/artifact/BJ6hqVnUkjDtSDDEehWyNr
Mock (works on real photos): https://claude.ai/artifact/9eUmgf1E1f57nfmg5JRbUg

## Why

Every control in the Image Editor changes the whole picture: the engine takes one set of settings
for every pixel. A painter or photographer often wants one part changed. The owner's example: make
the background hazier so it recedes, and leave the subject alone. Today that cannot be done.

## What a user gets

A **Masks** tab beside Edit, Crop, Remove and Enhance. It is the same in the Image Editor and in a
painting plan's Photo step, because both draw their panels from `moEditPanelKit`.

- **Masks**
  - **New Mask** makes one. Each mask has a name, a thumbnail of its shape, an eye that shows or
    hides its edit, and a menu with Rename, Invert, Duplicate and Delete.
  - Masks apply in list order, each on top of what the ones before it did.
- **What the mask covers** is one or more parts:
  - **Brush:** paint the area. Size, Feather and Flow are sliders; Erase is a switch, or hold Alt.
    `[` and `]` change the size.
  - **Linear Gradient:** two lines on the picture, with full effect at the first and none past the
    last. Drag either line, or the middle handle to move both.
  - **Radial Gradient:** an oval with a feathered edge. Drag the centre and the edges; Feather is a
    slider.
  - **Subject, Sky, Background** (step 2): chosen for you by a segmentation model on this computer.
  - **Combining parts:** Add, Subtract or Intersect another part of any kind. For example,
    Background minus a brushed-out tree.
  - Each part can be inverted, and the whole mask can too.
- **Edit inside the mask**
  - The Edit tab's own controls, applied only where the mask is:
    - Light (exposure, contrast, highlights, shadows, whites, blacks);
    - Colour (temperature, tint, vibrance, saturation);
    - Effects (dehaze, clarity, texture);
    - Detail (sharpness, noise);
    - Blur, for a mask only.
  - Starting points: **Recede** (haze, softer, cooler: the owner's example), Darken Sky, Lift Subject.
- **Seeing the mask:** Show Mask (`O`) tints the selected mask red while you work. Hold For Before
  (`\`) shows the photo without any mask's edit.
- **Accessibility:**
  - every handle is reachable by keyboard and moves with the arrow keys;
  - the brush has a keyboard way: a point moved with the arrows and painted with Enter, as the
    picker does;
  - drags start with `onDragPress`, so they work by touch as well.

## How it works

- **The recipe** gains `masks`: a list of `{ name, show, invert, parts, adjust }`.
  - A part is `{ kind, op, invert, ... }`:
    - a brush keeps its strokes (points, size, feather, flow, erase);
    - a gradient keeps its handles;
    - a Subject, Sky or Background part names a mask image the model made. That image is kept
      beside the photo's removal patches and is swept away when no recipe names it.
  - Masks are non-destructive and undoable like every other control. Copy Edit and presets leave
    masks out, because a mask belongs to one photo.
- **Drawing**
  - Each mask is turned into a mask texture at the photo's working size:
    - gradients are computed on the GPU;
    - brushes are painted into a canvas;
    - model masks are loaded from their files.
  - The engine draws the global look, then one pass per visible mask with that mask's settings,
    blended in through the mask texture.
  - A raw is drawn at full depth (RGBA16F) in every pass, so local edits keep raw's latitude.
  - Saves and the 16-bit TIFF go through the same tiles, with each tile cut from each mask.
- **Neighbourhood controls** (clarity, texture, dehaze, blur) already read blurred copies of the
  source. A mask's pass reads the same copies.

## As built (step 1)

- `edit-masks.js` holds the masks: the recipe's shape (`moMasksNormalize`), how much of each pixel a
  mask covers (`moMaskField`, worked at 2048 pixels on the long side), the engine's passes
  (`moMaskPasses`), and the Masks tool: its panel, built from the editor's own sections and sliders, and
  its layer over the picture (handles, the brush and its cursor).
- The engine's GLSL moved to `engine-shaders.js`. A mask is a single-channel texture over the source
  picture. Each pass draws the recipe with the mask's settings and lays it over the picture so far through
  the mask. Passes ping-pong between half-float targets on screen and float targets for a 16-bit save.
  Show Mask is a pass of its own.
- A save's tiles each map their part of the mask (`maskM`). A plan drawn from its enhanced copy maps the
  copy's uv back to the photo's the same way.
- Each Masks tool (the editor's, a plan's) names itself in its buttons' commands, so the one clicked
  answers.
- In a mask, settings add to the global look; overlapping masks lay over each other in order.

## As built (step 2)

- `edit-select.js` holds the models and what is done around them. Each was chosen by running
  candidates on the same photos (the page above):
  - **Subject** (Background is the same part inverted): BiRefNet, half precision, MIT, 490 MB. It runs
    on the processor (about 7.5 s on the owner's PC, more the first time while it loads): this runtime's
    WebGPU refuses one of its layers (17 buffers, 16 allowed).
  - **Object**: SAM 2.1 small, Apache 2.0, 183 MB. A click selects what is under it, Shift-click takes
    away, a drag draws a box. The photo is read once (0.3 s), then each click is 0.05 s. The keyboard way:
    the arrows move a point, Enter selects, Shift+Enter takes away.
  - **Words and Sky**: CLIPSeg (Apache 2.0, 545 MB) says roughly where the words are; SAM draws the
    edge from points at its strongest places; too weak a match says nothing was found. The words it
    knows are in `clip-words.js` (whole words from its vocabulary).
  - **Distance**: Depth Anything V2 small, Apache 2.0, 99 MB. "Farther than" and "Softness" make the
    part from the depth; Invert this part takes what is nearer.
  - SAM's answer is 256 pixels across; a guided filter snaps it to the photo's own edges.
- Every file is pinned to the commit tested and kept only if its SHA-256 matches. SAM and CLIPSeg's
  exports keep weights in a file of their own: the model runner fetches and hands those over too.
- A model's part keeps its result as a grey PNG named by its content, in
  `.parallx/extensions/media-organizer/masks/`, shared by the editor, plans, the board and saves.
  Images no stored edit, plan or variation names are deleted when the extension starts.
- **Ignore Background** (`plan-isolate.js`): one switch, in Values and in Colour. Values and Colour show
  the background flat grey (the renderer's matte); the masses, palette and light and shadow leave it out
  (the picture is read with the background clear, and study-math skips clear pixels). It reuses a Subject
  mask from the Photo step when there is one.
- DirectML is never used: tried on BiRefNet, it reset the graphics driver.

## Build stages

Each stage is finished, checked (typecheck, vitest, build, hidden probes, keyboard and touch audits
at 0) and committed before the next one starts.

1. **Masks with brush and gradients.**
   - The Masks tab, the recipe, the engine's mask passes and the overlay.
   - Brush, Linear and Radial; Add, Subtract, Intersect and Invert.
   - Every Edit control inside a mask, plus Blur, and the three starting points.
   - The same tab in a plan's Photo step. Saves and the 16-bit TIFF.
2. **Subject, Sky, Background.**
   - Choose the segmentation model by testing candidates on real photos, not on paper.
   - It is set up once like Remove's model: a model card, a download, a check.
   - It runs on the working picture and saves the mask image beside the photo.
