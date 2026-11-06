# Character Studio: an anime character creator (extension)

A character creator in the anime genre, inside Parallx as an extension
(`ext/character-studio`): characters mixed from parts, shaped with
sliders, coloured, given a mood, saved, and pictured. Our own tool and
style built on open samples; it copies no game's models, art or look.

This charter is the plan. Each decision below says who made it.

## Decisions

- An extension, turned off by default; turned off, nothing of it runs.
  (He, 2026-11-06.)
- For his own use; built as the best version regardless of licence. (He,
  2026-11-06.)
- **Anime, not realism.** The first attempt (realistic, on MakeHuman via
  Anny) looked low-poly with poor hair and lashes and a clunky panel; he
  judged it underwhelming. The anime genre was his call: "plan it, execute
  it; if it does not work, we erase both attempts." (He, 2026-11-06.)
- My tests and screenshots only ever show clothed characters; the app
  itself is not limited by that. (He, 2026-11-06.)

## How it is built

- **Characters:** the eight VRoid Project sample characters (VRM 0.x;
  free to modify and redistribute; `models/NOTICE.md`). Textures re-encoded
  as WebP: 42 MB in all.
- **Rendering:** three.js with pixiv's three-vrm (MIT): toon shading
  (MToon), outlines, hair and cloth physics, expressions, eyes that follow
  the camera. Bundled into `vendor/three.min.js`.
- **Mixing:** the body character is the rig; a face or hair from another
  character is grafted on: its bones matched to the rig's by name, its own
  hair bones moved under the rig's head, its hair physics kept.
- **Proportions** (height, head, legs, arms, shoulders, neck) are bone
  scales, so outfits and hair follow by construction.
- **Build** (bust, waist, hips, thighs, calves, upper arms) and **face
  shape** (eye size, spacing, height, face width, jaw, chin, mouth) are
  smooth deformations of the rest-pose meshes, by skin weights and by
  landmarks found in the face itself. Skin and outfit deform together, so
  nothing pokes through.
- **Colour:** skin tone, hair, eyes, top, bottom; textures recoloured
  keeping their shading.
- **Life:** a relaxed stance, breathing, blinking, swinging hair, while
  the view is on screen; off screen, nothing runs.

## The panel

Parts (body and outfit, face, hair: portrait grids), Body, Face, Colour
(swatches), Mood (live portraits of each expression). Randomise and Save
Picture… in the header; Undo and Redo; characters listed in their own
sidebar with a face picture; every change saved on its own.

## Next, if he wants it

1. Poses beyond the relaxed stance; a pose library.
2. More hair and outfits (HairDeck makes anime hair from a picture; VRoid
   Studio makes parts).
3. Describe a character in words; the local model sets parts, sliders and
   colours.
4. Export to VRM for other programs (VTuber apps, Blender).

## Checks before a step is called done

- `npm run typecheck`, `npx vitest run`, `npm run build` pass.
- The keyboard audit and touch-drag probes report 0.
- `tests/probes/character-studio-probe.mjs` passes: every tab, mixing,
  sliders, colours, moods, saving and reopening, draw time.
- His eyes on it: the step is his verdict, not the tests'.
