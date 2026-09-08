# Fun Extensions, September 2026 — shortlist, the Studio direction, Maggiori notes

Written 2026-09-05. Mufaro's ask, after the productive briefs: *what about
fun extensions?* His reaction to the first round: the palette lab should
grow into an art-study extension (colour, hue, saturation, how to mix
paint for an effect, how Mark Maggiori builds his dusk glow); the
soundscape idea is right because his ritual is a rain video plus boom-bap
at five to ten percent; the character-creator wish still stands; the rest
was weak and unimaginative.

## How this was made, honestly

Seven ideation agents, one lens each, produced 42 ideas (the raw output
is docs/research/Fun_Extensions_Catalogue_2026-09.md). The plan had
three judges, research agents and a critic behind them. That run hit the
session limit, and when it was resumed Mufaro stopped it to protect his
weekly limit. So there was no judge panel and no research sweep. The
shortlist below is one reader's judgment, and the Maggiori notes come
from three web searches and one article read, with confidence marked.
Licences quoted from the catalogue are unverified until checked.

Status: research only. The Polish Charter (docs/POLISH.md) is in force.

## Three ideas from the first round already exist

- The desk pet is the companion widget: an ink-line character whose
  pupils follow the cursor, blinks, breathes, and drowses when you stop.
- The character forge and story runner are the text-generator extension:
  roleplay characters, lorebooks, scene memory, an inspectable prompt.
- The idle gallery overlaps the media organizer's lightbox and slideshow.
  The toy box already has the breathe circle, decision coin and quote.

## The pattern the lenses converged on

Five of seven lenses, working blind to each other, proposed the same
object: a physically simulated sky you drag the sun through, aimed at
the Maggiori question. Dusk Engine, Sky Dial, Skyglass, The Window, Sky,
The Dusk Stand, Set, and the Green Room's sun dial are all the same
module wearing different clothes. When independent angles agree this
hard, that is the thing to build, once, and let everything else borrow
it:

- **As a widget**: a window onto the real sky at his location right now,
  sun and moon from astronomy, haze and cloud from the weather feed.
- **As a pane**: drag the sun along its arc, scrub the day, watch the
  glow band form and the zenith deepen, hold it at the minute a painter
  works.
- **As an instrument**: Match A Painting. Open a Maggiori from the media
  organizer, sample the vertical strip of its sky, fit sun elevation,
  haze and exposure to it, and show the residual: exactly where the
  painter pushed the yellow warmer and higher than physics allows. Save
  as a printable study sheet.
- **As a light**: the same dome lights a posable mannequin (The Dusk
  Stand) or a cel-shaded VRM character (Cast), so the rim of gold on a
  rider's shoulder and the violet on the shadow side come from the sky
  he set.

Prior art in the catalogue: Preetham (three.js Sky, MIT) for a weekend
version, Hosek and Wilkie (BSD-3) for a better analytic sky, Bruneton's
precomputed scattering (BSD-3) for the full thing. His 5090 makes the
full thing free.

## The Studio direction for art study

Mufaro asked whether art study should be a canvas page or an extension.
Both, split by nature: the curriculum, the study sheets and the notes are
canvas pages because they must print and be edited; the instruments are
an extension because they compute. One extension, one activity-bar
container, rooms that share the sky and the pigment data:

| Room | What it does | From the catalogue | Effort |
| --- | --- | --- | --- |
| Sky | The module above, with Match A Painting and Pull Palette (seven swatches zenith to horizon, each with an approximate oil mix) | 8, 16, 19, 31, 38 | month |
| Slow Reveal | A painting from his library rebuilt over ten minutes as a painter builds it: two values, three, five, colour masses, then the picture. Ends in a study card | 35 | week |
| Squint Glass | Reference and wet painting under one glass: squint, flip, notan, edges, a crosshair that mirrors across both, a readout in painter's words ("1.5 values lighter, 14 degrees warmer"), and an Ask The Easel persona that speaks only from what was measured | 11 | month |
| Glass Palette | His actual tubes mixed on glass with subtractive colour (spectral.js, MIT), every mix a printable recipe in parts, a photographed paint-out chart calibrating the model to his real paint | 7 | month |
| Pigment Cabinet | Real pigments as spectral objects with reflectance curves, tint ladders, lightfastness and their stories, re-rendered under daylight, tungsten, or tonight's sky | 12 | week |
| Speedpaint | Phone photos of a painting in progress aligned and colour-corrected, played as the painting emerging, a Changes lens between sessions, exported through the CLIPS exporter | 41, 10 | week to month |
| Raking Light | Four torch-lit photos solve a normal map of the paint surface; drag a light and the impasto catches it. Single images get approximate depth from a small network on the GPU | 37 | month |
| Dusk Stand | A posable mannequin on a turntable under the Sky, with a palette strip of the eight colours that matter on the lit figure and their recipes | 29 | month |

What the AI does in every room: solve a recipe, fit a sky, narrate a
measured delta, turn words into a pose. It never emits an image. That is
the line Mufaro drew.

Licence note: Mixbox (the best-known pigment mixer) is CC BY-NC and would
need a commercial licence if Parallx is ever sold; spectral.js is MIT and
does Kubelka-Munk mixing. Use spectral.js.

## Maggiori, what the sources support

Verified by reading the Flaunt interview
(https://www.flaunt.com/blog/cloudscapes-mark-maggiori):

- His way into Western painting was Frederic Remington's *The Stampede*
  (1908), seen at the National Cowboy and Western Heritage Museum in
  Oklahoma City in 2013.
- Southwest Art calls his manner "luminous realism"; the article calls it
  "almost photo realist". A gallerist's assessment (paraphrased there) is
  that he uses colours and techniques from his photography and film years
  to make scenes more dramatic.
- Clouds are the subject he cares about most; he began painting them at
  the Academie Julian in Paris, and speaks of a desert thunderhead as
  "sudden, thrilling, and amazing".
- He has said he studied Remington, Maynard Dixon and the Taos Society
  more than Farny, Frank Tenney Johnson or Howard Post
  (https://www.cowboysindians.com/2022/12/a-guy-a-horse-a-hat-a-sunset-mark-maggiori-on-painting-the-west/).

From search snippets only (the Cowboys and Indians page refused the
fetch), medium confidence:

- He designs in Photoshop, then transfers the composition in pencil or
  charcoal; most paintings take two to three weeks including drying.
- Clouds are blended for hours with a small bristle brush; cloud
  highlights carry heavy impasto and visible palette-knife work while
  the desert floor is painted much thinner, so texture itself carries
  the hierarchy.

Low confidence, from a site that reads as generated
(https://shortcutstohappiness.store/vestibulum-sapin-prin-quam/): a
palette of Cadmium Yellow Light and Naples Yellow for sunlit edges,
Ultramarine, Cerulean and Prussian Blue for shadow, Cadmium Red and
Alizarin for sunset underpainting, Raw Umber, Burnt Sienna and Yellow
Ochre for the desert. Treat this as a hypothesis for the Glass Palette to
test against his actual paintings, not as fact.

Colour principles that apply, from James Gurney's *Color and Light* and
his gamut-masking posts
(http://gurneyjourney.blogspot.com/2011/09/part-1-gamut-masking-method.html):
chroma is the strength of a surface colour relative to white; a glow is
a chroma peak set against a compressed, desaturated surround; adding
white or black usually weakens chroma or shifts hue, so tints and shades
that hold chroma must be mixed deliberately; a gamut mask limits the
palette to a shape on the wheel and that limit is where harmony comes
from. Match A Painting is the tool that turns these into something you
can see on a Maggiori instead of read.

## The shortlist, one reader's ranking

1. **Sky, as one module** (ideas 8, 16, 19, 31, 38 merged). The widget
   is a weekend on Preetham; the pane and Match A Painting are the month.
   Everything else in the Studio borrows it.
2. **Slow Reveal** (35). A week, existing surfaces only, and it answers
   the glow question by showing construction instead of result.
3. **Speedpaint** (41, with 10). His own progress photos, badly taken,
   aligned into the painting emerging. The CLIPS exporter already exists.
4. **Squint Glass** (11). The oldest studio games, done to both pictures
   at once, and the cleanest example of AI as instrument.
5. **Glass Palette with the Pigment Cabinet** (7, 12). The "how do I mix
   this" question answered with paint that behaves.
6. **Cast, The Dusk Stand, The Green Room** (40, 29, 3). The character
   creator answer, see below.
7. **The night desk trio**: The Crate (32), Desk Foley (33), Lights Down
   (36). The ritual he already has, made of things he authored: his own
   beat at six percent, a pencil-scratch while the assistant writes, one
   key to arrive and one to leave.
8. **Raking Light** (37). Photo mode for his own oil paintings; grazing
   light on impasto is the museum rig nobody gets to play with.

Wildcards worth keeping alive: **Sunday Letters** (27, a weekly letter
from a fictional old painter who has read the journal; no chat, only
mail), **The Night Desk** radio (26, a late show broadcast from inside the
workspace, mostly dead air), **The Sitter** (25, a phone app on the easel
where a fictional sitter talks while you paint), **Blackout** (21, erasure
poems from his own notes), **Endpaper** (24, the day's events marbled by
hand), **Phenakistoscope** (18), **Paper Doll Press** (1, a Picrew maker
whose parts are his own drawings), **Living Sketch** (2, Meta's Animated
Drawings, MIT, makes a doodle walk), and **Churn** (42, MilkDrop on a
5090 fed by the system audio CLIPS already captures; a weekend).

Set aside, with the reason: Bonsai and the workspace Atlas grow from
journal data and edge toward tracking; Exquisite Corpse needs a friend
and a synced folder; The Pour wants Mixbox and a GPU fluid solver; the
Punch Card Music Box and Jumping Jack are charming but quarter-scale;
Lay Figure is superseded by The Dusk Stand; Set (a path tracer) and The
Room are lovely second-year additions once the parts they display exist;
Face Mirror, Stage, the lorebook Atlas and The Clue Table are good but
not first.

## The character creator, plainly

I was never against it. I was against building the creator itself, which
VRoid Studio already does from sliders in ten minutes and exports as the
open VRM format. The catalogue's answer is the studio around the
character, which is the part Koikatsu Studio got right: Cast (40) loads a
VRM into a stage with three-vrm (MIT) and MToon toon shading, which is
the Koikatsu look, gives it a pose library, expression sliders, three
draggable lights, a camera, backdrops from the media organizer or the
live Sky, and 4K snapshots; and it binds a character to a text-generator
persona so the render is her portrait and her face follows the scene.
The Dusk Stand (29) is the same idea for the painter: a grey mannequin,
not a character, under the sky he set, with the palette strip. Both
share the Sky module. Build the Dusk Stand first because it serves the
study; Cast follows when the stage exists.

## Something separate from Parallx?

The honest answer is that a separate app would rebuild what the Studio
gets free: canvas pages that print, the media organizer for his
photographs, the voice registry, local models, the CLIPS exporter, the
dashboard for widgets. If the wish for something separate is about the
work, the Studio extension is the better deal. If the wish is about a
fresh start with nothing owed to the existing code, two catalogue ideas
are designed to stand alone and still talk to Parallx: The Sitter (a
phone web app on the easel with Ollama behind it) and a standalone Sky
page. Either is a weekend to a week and would tell him quickly whether
the pleasure is in the new thing or in the break.

## Decisions (Mufaro's)

**F1 — One Studio extension with rooms, or several small extensions?**
Recommendation: one, because the sky and the pigment data are shared.

**F2 — Curriculum as canvas pages?** Recommendation: yes; the extension
holds instruments only.

**F3 — Pigment mixing library.** Recommendation: spectral.js (MIT), not
Mixbox (CC BY-NC).

**F4 — Break the polish freeze for Slow Reveal (a week)?** His call. It
is the smallest thing here that would change an evening.

**F5 — Build order.** Recommendation: Sky widget, Slow Reveal,
Speedpaint, Sky pane with Match A Painting, Squint Glass, Glass Palette
and Cabinet, Dusk Stand, the night desk trio, Cast, Raking Light.

## The 42, by lens

Character and world play: Paper Doll Press (week), Living Sketch
(month), The Green Room (week), Stage (month), Face Mirror (week), Atlas
(month).

The painter's studio: The Glass Palette (month), Dusk Engine (month), Lay
Figure (quarter), The Long Sitting (month), The Squint Glass (month), The
Pigment Cabinet (week).

The toy box: The Pour (month), Punch Card Music Box (month), Exquisite
Corpse (month), The Sky Dial (month), The Jumping Jack (quarter),
Phenakistoscope (week).

Generative and living visuals: Skyglass (month), Long Exposure (month),
Blackout (week), Bonsai (month), Atlas (month), Endpaper (week).

The wildcard: The Sitter (month), The Night Desk (week), Sunday Letters
(week), Very Slow Painting (weekend), The Dusk Stand (month), The Clue
Table (week).

The night desk: The Window (week), The Crate (week), Desk Foley
(weekend), The Room (month), Slow Reveal (week), Lights Down (weekend).

The gamer with a 5090: Raking Light (month), Sky (month), Set (month),
Cast (month), Speedpaint (week), Churn (weekend).

## Sources

- https://www.flaunt.com/blog/cloudscapes-mark-maggiori
- https://www.cowboysindians.com/2022/12/a-guy-a-horse-a-hat-a-sunset-mark-maggiori-on-painting-the-west/
- https://www.southwestart.com/featured/maggiori_m_aug2018
- https://glasstire.com/2020/12/18/the-briscoe-is-trying-to-update-how-we-visualize-the-american-west/
- http://gurneyjourney.blogspot.com/2011/09/part-1-gamut-masking-method.html
- http://gurneyjourney.blogspot.com/2011/09/part-3-gamut-masking-method.html
- https://linesandcolors.com/2011/09/19/james-gurney-on-gamut-masking/
- https://shortcutstohappiness.store/vestibulum-sapin-prin-quam/ (low confidence)
