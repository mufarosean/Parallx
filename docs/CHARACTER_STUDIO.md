# Character Studio: a realistic character creator (extension)

A Daz3D-style creator for realistic people, inside Parallx as an extension:
a live 3D figure shaped by named sliders, dressed, posed and animated, with
AI steps that run on the local graphics card (RTX 5090, 32 GB).

This charter is the plan. Each decision below says who made it.

## Decisions

- Realistic, not stylized. (He, 2026-11-06.)
- An extension first, `ext/character-studio`, so it follows the first
  principle: turned off, nothing of it runs. (He, 2026-11-06.)
- For his own use; built as the best version regardless of licence.
  Non-commercial research parts are allowed. If it is ever shared, the
  non-commercial parts are rebuilt then. (He, 2026-11-06.)
- Licensed parts that need an account (SMPL-X, FLAME and the like) are
  downloaded by him from their sites; the app takes the files from where
  he puts them and never redistributes them.

## What was found (research, 2026-11-06)

- **Body: Anny** (NAVER Labs, github.com/naver/anny, v0.6.2, code Apache,
  assets CC0). Infant to elder from named sliders (age, weight, muscle,
  height, proportions), local morphs, FACS-style face actions, a 163-bone
  MakeHuman rig. The closest open match to a Daz figure. SMPL-X has the
  larger research ecosystem but unnamed shape numbers, so it is not the
  base; Anny can use its topology where a tool needs it.
- **Face rig: MHR** (Meta, Apache): 72 sculpted expressions, pose
  correctives. Used if Anny's face actions fall short.
- **Shared skeleton: SOMA-X** (NVIDIA, Apache): one skeleton for Anny, MHR,
  SMPL-X and GarmentCode's body; the bridge between body, motion and cloth.
- **Photo to character:** Anny-Fit (photo straight to Anny, NAVER
  non-commercial), Pixel3DMM (sharper face, non-commercial), SAM 3D Body
  (Meta).
- **Motion:** Kimodo (NVIDIA, text to motion, all variants), FlowHMR (copy
  motion from a video, non-commercial weights, needs SMPL-H).
- **Clothing:** GarmentCode (MIT): sewing patterns sized to the body,
  draped by simulation. Research grade, the least mature part.
- **Hair:** DiffLocks (realistic strands from a photo, research licence);
  MakeHuman's CC0 hair cards for real time.
- **Skin:** no AI model makes realistic skin maps. MakeHuman's CC0 skins
  plus a skin shader (subsurface scattering) and detail maps, built here.
- **Rendering:** three.js (WebGPU) in the panel: good game quality for one
  figure. Finished pictures close to Daz: Blender Cycles, headless, a
  separate download run as its own process.
- No open project already joins these; MPFB2 (Blender) is the reference
  for materials and assets.

## The steps

Each step is finished, checked and committed before the next.

1. **The figure.** The Character Studio editor: a live 3D figure, named
   slider groups (body, proportions, face), realistic skin, eyes, brows and
   lashes, a few hairstyles, orbit and zoom by mouse, touch and keys.
   Characters saved in the workspace with a thumbnail; export to GLB with
   shape and rig. Setup on one click through the core's tool runtimes
   (`contributes.runtimes`, as Enhance): Anny and its assets are fetched
   and converted once into a figure with blend shapes, so moving a slider
   needs no Python; the panel blends the shapes live.
2. **Describe a character.** "A tall, weathered sailor in his fifties":
   the local model, through the core's one route, sets the sliders, skin
   tone and hair, shown as a change he can keep or undo.
3. **Face and pose.** Expression sliders, a pose library, posing by
   dragging joints (and by keys), motion from text with Kimodo.
4. **Photo to character.** Anny-Fit for body and head, Pixel3DMM for the
   face; motion copied from a video with FlowHMR.
5. **Clothing.** GarmentCode patterns sized to the figure, draped on it.
6. **Hair.** DiffLocks strands from a photo, turned into cards for the
   live view; strands kept for the finished render.
7. **Finished render.** Blender Cycles for a picture of the posed,
   dressed character.

## Known risks

- Realism lives in hand-built work: the skin shader, hair rendering and
  materials. The live view will look like a good game, not a Daz render;
  step 7 closes that gap for still pictures.
- Research code is Linux-first and joins between body models lose detail;
  each join is real engineering, checked by eye on his card.
- Clothing draping is the least mature part and may need the most time.

## Checks before a step is called done

- `npm run typecheck`, `npx vitest run`, `npm run build` pass.
- The keyboard audit and touch-drag probes report 0.
- Off means off: turned off, nothing of it runs, loads or downloads.
- A hidden probe opens the editor, moves every slider and exports a GLB
  that opens in a standard viewer.
- His eyes on the figure: the step is his verdict, not the tests'.
