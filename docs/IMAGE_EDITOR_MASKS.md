# Image Editor: masks (local adjustments)

Status: **proposal, waiting for the owner's yes.** Nothing here is built until he agrees.
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
