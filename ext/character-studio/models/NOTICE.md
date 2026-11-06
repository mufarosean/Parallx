# The characters

The eight `.vrm` files are the VRoid Project's sample characters (pixiv),
from https://opengameart.org/content/vroid-studio-cc0-models, copied by
`scripts/bake-character-models.mjs` with their textures re-encoded as WebP.
Each file keeps its own VRM licence, read from the file itself:

- Shibu (AvatarSample_D), Bibi (E), Vita (F), Victoria (G), Fumiriya
  (Sakurada Fumiriya), Shino (Sendagaya Shino): the VRoid Hub licence with
  use by everyone, modification and redistribution allowed, credit not
  required, commercial use allowed.
- Hana (HairSample_Female), Haru (HairSample_Male): CC0, with the same
  VRoid Hub permissions.

`portraits/` holds the pictures the part pickers show, rendered from these
characters by `tests/probes/character-studio-probe.mjs` (CS_PORTRAITS=1).
