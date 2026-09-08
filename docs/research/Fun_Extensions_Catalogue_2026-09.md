# Fun Extensions Catalogue, September 2026 (raw ideation output)

Generated 2026-09-05 by seven ideation agents, one lens each, in a workflow that was stopped before judging to protect usage limits. This is the unedited catalogue; the synthesis and shortlist live in docs/research/Fun_Extensions_Ideation_2026-09.md. Treat every claim about prior art and licences as unverified until checked.


### Lens: Character and world play


#### 1. Paper Doll Press (week)

**Pitch.** A Picrew-style character maker whose parts library is Mufaro's own pencil drawings. He sketches sheets of eyes, brows, noses, mouths, hair, collars and hats, photographs or scans them into the media organizer, and the extension slices each sheet into transparent parts. A cast member is assembled by tapping through part trays, never sculpted. Every doll prints as a fold-up standee sheet, so the cast can stand on his actual desk.

**What you see.** An editor pane split in two. Left: a large doll on a plain paper-toned ground built from stacked layers (face, eyes, brows, nose, mouth, hair back, hair front, neck, collar, accessory). Right: horizontal trays of thumbnails per layer, drawn in his own line. Hand: click a tray thumbnail and the layer swaps in with a short cross-fade; drag directly on the doll to nudge a part; scroll while hovering a part to scale it; a small tint swatch row (theme-token neutrals plus a few earth pigments he names himself) recolors line art via multiply. A Cut Sheet command opens a scanned drawing, shows a threshold slider (line art becomes alpha), and lets him lasso each part and name it into a tray. The Print Standee command produces a canvas page with the doll front and back, fold lines and a base tab, sized for A4 or Letter. Saved dolls appear in a Cast view in the sidebar with a name and the small portrait, and that portrait replaces the current icon-only avatar on text-generator character cards.

**Why it is fun.** The Koikatsu pleasure is instant recombination: tap, tap, tap and a person appears. Here the surprise is stronger because the parts are his hand, so combinations he never drew on purpose come out looking like him. Cutting a fresh sheet is a weekend drawing session that feeds the toy. Printing the standees turns the screen cast into desk objects.

**Surfaces.** Editor pane (doll maker and cut sheet), sidebar Cast view under a Cast activity-bar container, per-extension SQLite (parts, dolls, layer transforms) with migrations, canvas page for the printable standee sheet (pages must print), media organizer as the source of scanned sheets, text-generator character cards read the portrait. Extension, not a separate app, because the cast table is what every other idea here reads.

**Prior art.** Picrew (picrew.me, proprietary web service, creator-uploaded layered parts); DiceBear avatar library (MIT code, style licences vary); facesjs by zengm-games (Apache-2.0, parametric SVG cartoon faces); Open Peeps by Pablo Stanley (CC0 hand-drawn parts). None of these let the user supply scanned pencil parts or print standees.

**Novelty.** Not the palette lab, not the sketch prompt wall, and not a generated avatar. The earlier ideas asked him to look at or be prompted by art; this one turns his drawings into a toy with mechanical recombination. Nothing built in Parallx assembles characters or prints paper objects, and text-generator characters currently have no portrait at all.


#### 2. Living Sketch (month)

**Pitch.** Draw a figure on paper or on a canvas page, photograph it, and thirty seconds later it is a rigged cutout puppet walking, waving, dancing and jumping on a small stage. Meta's Animated Drawings method (MIT, code and weights) finds the figure, segments it, fits a skeleton and retargets motion capture onto the drawing, without generating any new imagery. The drawing stays exactly his; only the joints move.

**What you see.** An editor pane called the Puppet Stage: a wide, shallow stage with a soft floor shadow and a single drawn figure standing on it. Below, a strip of motion chips in Title Case (Wave, Walk, Jump, Dance, Bow, Idle) and a scrub bar. Hand: drop a photo from the media organizer or pick a canvas page block; a detection outline appears around the figure with a Confirm Figure button; a skeleton overlay shows sixteen joints he can drag to correct (the Animated Drawings pipeline exposes exactly this correction step); press a motion chip and the puppet performs it in a loop; drag the stage light left or right and the floor shadow follows. Export Sprite Sheet writes a PNG strip and a short MP4 into the media organizer; Add To Cast saves the rigged puppet so the Stage idea below can use it as a sprite. A puppet can also be dropped on a dashboard as a small widget that plays one motion on click, and otherwise stands still.

**Why it is fun.** The gap between a three-minute doodle and a character that walks is where wonder lives. It rewards bad drawing as much as good drawing (the original paper was about children's drawings), which makes it a zero-pressure way to warm up before a serious portrait session. Correcting the skeleton by hand is a small, satisfying puppetry act.

**Surfaces.** Editor pane (Puppet Stage), media organizer for input photos and output sprite sheets and clips, canvas page blocks as an input source, Cast table shared with Paper Doll Press, optional dashboard widget (static category, one motion on click). Needs a Python sidecar: the documented extension API exposes no workspace-Python or process spawn, so this either ships as an MCP tool server the extension calls through api.mcp, or waits for a small core hook. The Python side (torch plus the detector and pose models) runs comfortably on the 5090.

**Prior art.** facebookresearch/AnimatedDrawings (MIT, code, weights and dataset; github.com/facebookresearch/AnimatedDrawings); the Sketch.metademolab.com demo of the same method; Draw a Stickman (proprietary game) for the drawing-becomes-actor feeling.

**Novelty.** This is the sketch-to-character promise done without image generation, which is the one form of AI in art he has said he wants. It is not a desk pet: nothing idles, nags, or emotes on its own, and the point is the asset he made. Not built anywhere in Parallx; the companion widget and text-generator have no bodies.


#### 3. The Green Room (week)

**Pitch.** A backstage room where 3D characters made in VRoid Studio (the closest modern heir to the Koikatsu creator: sliders and presets, no sculpting, free) live inside Parallx as VRM files. Drop a .vrm in and the character stands in a lit room; while a text-generator roleplay streams, the model emits short emotion tags that drive the VRM's blendshapes, so the speaking character actually looks happy, wary, or surprised. A golden-hour dial swings the sun from noon to dusk, the exact light he wants to study in Maggiori, and a Snapshot command drops a reference still into the media organizer.

**What you see.** An editor pane showing a room: a single character on a plain floor, a soft dome light and one directional sun. A vertical dial on the right labelled Sun runs from noon at the top to dusk at the bottom; dragging it shifts the key light warm and low and lengthens the floor shadow. A row of expression chips (Neutral, Joy, Sorrow, Anger, Surprise, Relaxed, the standard VRM set) plus a Pose dropdown (one dropdown component) listing loaded VRMA clips. Hand: orbit with drag, zoom with scroll, click a chip to see the face change with a short blend, drag the Sun dial, press Snapshot to save a still. Open a text-generator chat beside it and the character's face follows the conversation: the extension asks the streaming model to end each reply with a bracketed tag from the fixed set, strips it from the visible text, and blends the matching expression. The character's rendered head becomes the portrait on its text-generator card and on its voice persona.

**Why it is fun.** It is the Koikatsu scene room again: dress a character elsewhere, then pose, light and photograph them here. Watching a face you chose react to a story you are writing is the Perchance character-chat feeling with an actual face. The Sun dial is a toy that also happens to be a lighting study.

**Surfaces.** Editor pane (the room), text-generator chat (expression tags via the existing streaming pipeline and api.lm), voice registry personas (portrait), media organizer (snapshots), Cast table, per-extension SQLite for character-to-vrm bindings and light presets, settings registry for tag vocabulary and default sun angle. Extension; character creation happens in VRoid Studio, which the extension does not try to replace.

**Prior art.** VRoid Studio by pixiv (free, proprietary, exports the open VRM format); @pixiv/three-vrm and @pixiv/three-vrm-animation (MIT, VRM and .vrma loading on three.js); three.js (MIT); SillyTavern Extension-VRM (AGPL-3.0) which already does text-driven VRM expressions for roleplay chat and proves the loop works; Koikatsu Studio (proprietary).

**Novelty.** Different from the weak idle gallery and palette lab: this is a character room, not a viewer of his paintings. Different from what is built: text-generator characters are icon-only cards, voice personas have no faces, and nothing in the app renders 3D. Uses an open format, so no external whiteboard-style engine embedding, just a loader library.


#### 4. Stage (month)

**Pitch.** A visual-novel stage rendered from a canvas page. He writes a scene as ordinary blocks with light stage directions (who is present, where they stand, what the backdrop is, time of day, weather) and the Stage pane paints it: his own photo or painting as backdrop, cast sprites from Paper Doll Press or Living Sketch at their marks, a dusk or rain layer, and a text box at the bottom. When a text-generator roleplay is attached, its replies play out on this stage, speaker by speaker, with expressions swapped from the emotion tags. The page prints as a screenplay.

**What you see.** An editor pane in cinema proportion: backdrop image, two or three cast sprites at left, center and right marks, a subtle vignette, an optional rain layer at low opacity, and a wide text box along the bottom showing the current speaker's name and line (a text box, not speech bubbles). Hand: type in the page on the left, for example a line beginning with a name followed by a colon for dialogue and bracketed directions like [Mara, left, worried] or [dusk] or [rain]; the stage on the right updates on every keystroke, deterministically, no model involved. Drag a sprite on the stage and the page's direction updates its mark. Press Play and the attached text-generator chat advances one reply at a time; each reply lands in the text box while the speaking sprite steps slightly forward and swaps expression. Export Clip records a run through the existing CLIPS recorder. Print Page yields a clean script with scene headings and dialogue.

**Why it is fun.** This is the Perchance experience with his own backdrops and his own drawn cast, and the Koikatsu Studio experience of arranging figures in a scene, without any generated pictures. Writing a stage direction and watching the set dress itself is pure play. Running a live roleplay across it makes reading the story feel like watching one.

**Surfaces.** Canvas page (scene source, printable script), editor pane (the stage), text-generator chat (attached thread, expression tags), media organizer (backdrops, and CLIPS for recording), Cast table (sprites and expression sets), settings registry for direction grammar and default marks. Extension.

**Prior art.** Ren'Py (MIT, the sprite-plus-backdrop-plus-textbox grammar); Monogatari (MIT, the same model on the web); Koikatsu Studio and Honey Select Studio (proprietary, scene arrangement); Perchance AI character chat (proprietary, the live-roleplay-with-scene feeling).

**Novelty.** Not the rejected ink story runner: nothing is pre-authored or branching, the stage renders a live roleplay and a page he is writing now. Not a toy block inside a canvas page: the page stays plain printable text, the stage is a separate pane reading it. Not an external engine embed: the grammar and renderer are small and native to Parallx.


#### 5. Face Mirror (week)

**Pitch.** Point the webcam at himself and a cast member's face follows his: brows, eye openness, mouth shape, head tilt. Make the face you want the character to make, press Capture, and it becomes a named expression preset for that character. Ten captures make an expression sheet, the reference artists draw before a comic or portrait series. The sheet is saved to the media organizer and prints as a page.

**What you see.** A pane split into a small mirror (his webcam, mirrored, with a faint landmark overlay) and a large character face beside it, either a Paper Doll Press doll (layered 2D, with eye, brow and mouth layers driven by parameters) or a Green Room VRM head (blendshapes). Hand: he acts; the character copies with a slight smoothing so it feels puppeted rather than tracked. A Capture button and a name field; each capture adds a tile to a grid at the bottom. Arrange Sheet lays out the tiles three by four with names beneath and saves a PNG to the media organizer and a printable canvas page. Act The Line: in an attached text-generator chat, when a reply arrives with an emotion tag the character has no preset for, the mirror pane asks him to act it once, and from then on that character owns that face.

**Why it is fun.** Puppeteering your own character with your face is the VTuber joke made private: nobody watches, so he can pull ridiculous faces for a character who is supposed to be dignified. Building an expression sheet is a classic art-school exercise turned into a game of gurning.

**Surfaces.** Editor pane (mirror and face), media organizer (expression sheets), canvas page (printable sheet), Cast table (expression presets shared with Stage and The Green Room), text-generator chat (Act The Line hook via emotion tags). Extension; all inference is local and in-process (WASM), no Python.

**Prior art.** MediaPipe Face Landmarker (Apache-2.0, 52 blendshape scores and head pose from a webcam, WASM build); Kalidokit (MIT, maps face landmarks to VRM blendshapes); VTube Studio and Animaze (proprietary); Live2D Cubism (proprietary) and Inochi2D (BSD-2) for the layered-2D-face-with-parameters model.

**Novelty.** Nothing in the earlier list touched the webcam or the artist's own face. Not a desk pet: the character only moves while he is deliberately acting, and the output is a reference sheet. Not built: no Parallx surface uses face tracking or expression presets.


#### 6. Atlas (month)

**Pitch.** A world map bound to the text-generator lorebooks. Each lorebook place gets a pin on a hand-drawn-looking map; each roleplay scene is set at a place, so the cast leaves a travel trail across the continent over weeks of play. The map is generated once from a seed he can reroll until it feels right, then it is his world and he edits names, borders and biomes by hand. It prints as a two-page spread.

**What you see.** An editor pane showing a parchment-toned map (theme tokens, with paper texture in a warm neutral) with coastlines, rivers, mountains drawn as small hatched marks, biome tints, and place labels in the app font. Hand: drag to pan, scroll to zoom, press Reroll to regenerate from a new seed with a short fade, click a location to place a pin and type a name, drag a pin to move it. A lorebook entry with a place heading gets a pin automatically; clicking a pin opens that lorebook section in a side view. When a text-generator scene is set at a place (a chosen dropdown at the top of the chat, the one dropdown component), a small cast marker moves there and a faint line joins it to the previous scene; the trail accumulates. A dashboard widget shows the current location and the last three legs of the journey, and clicking it opens the map. Print Map yields a canvas page spread with a legend and the trail.

**Why it is fun.** Rolling a new world until one looks like a place you want to visit is the oldest wonder in fantasy fandom, and a map that remembers where your characters have been makes the roleplay feel lived rather than logged. It is also the world-building half of character play that Perchance never had.

**Surfaces.** Editor pane (map), text-generator lorebooks (places from headings) and chat (scene location, trail), dashboard widget (current location, a door into the map), canvas page (printable spread), per-extension SQLite (seed, edits, pins, trail). Extension. A small native generator (Voronoi cells via d3-delaunay, ISC; noise heightmap; simple biome rules) rather than embedding the full Azgaar app, so it looks like Parallx and stays light.

**Prior art.** Azgaar's Fantasy Map Generator (MIT, the reference for procedural continent, river and state generation and .map export); Watabou's Medieval Fantasy City Generator (free, proprietary); Inkarnate and Wonderdraft (proprietary hand-drawn map tools); d3-delaunay (ISC).

**Novelty.** Lorebooks exist but have no geography; the workspace graph is a graph of workspace items, not a world. Not a gamified tracker: the trail is a memory of scenes, with no goals or rewards. Not an external engine embed: the generator is written for Parallx, with Azgaar cited for the algorithms.


### Lens: The painter's studio


#### 7. The Glass Palette (month)

**Pitch.** A sheet of glass where tubes of his actual oils mix like paint, every mix becomes a recipe in parts he can print, and a photo of the painted chart calibrates the model to the tubes he really owns.

**What you see.** An editor pane: the top two thirds is a grey glass slab (surface token), a column of tube caps down the left labelled with his configured set (Titanium White, Cad Yellow Light, Yellow Ochre, Cad Red Light, Alizarin Permanent, Ultramarine, Cobalt, Burnt Sienna, Ivory Black). Hand: drag a cap onto the glass and a dollop lands; drag a second dollop into it and stroke, and a palette-knife smear mixes proportionally along the stroke with real subtractive results (Ultramarine into Cad Yellow gives a dull olive, not grey; white into Alizarin cools toward pink). Right rail shows the live recipe as parts ('3 Titanium White, 1 Cad Orange, touch Ultramarine') with a slider per part; 'Keep' drops a swatch on the strip along the bottom. Match This: drop any image (a Maggiori sky, a photo from the organizer), click a point, a target chip sits beside a mixing well; you mix by hand until the ring around the well closes (the ring is the colour distance, no number, no score), then Reveal shows the solver's own recipe from his tubes only. Paint-Out Chart: pick 6 to 12 tubes and a canvas page is generated with the predicted mixing grid and tint rows; print it, paint it for real, photograph it, drop the photo back and each cell shows predicted beside actual while the per-tube coefficients correct themselves, so recipes now match his brand of paint.

**Why it is fun.** It is finger-painting on glass with paint that behaves, plus the small thrill of mixing toward a target by eye and then seeing the machine's answer. The chart loop is a ritual: print, paint, photograph, watch the model learn your tubes.

**Surfaces.** Editor pane (the glass); dashboard widget 'Today's Palette' (current swatch strip and recipes); canvas pages that print (recipe cards, paint-out charts); settings registry (tube inventory, brand); per-extension SQLite (tubes, recipes, calibration coefficients); media organizer photo as a colour source through a lightbox command; api.lm not required.

**Prior art.** spectral.js by Ronald van Wijnen (MIT, Kubelka-Munk over seven base reflectance curves) as the mixing core; Mixbox by Secret Weapons (CC BY-NC 4.0, commercial licence required, used by Rebelle) as the reference for pigment-true feel; Roy Berns' RIT Artist Paint Spectral Database (measured K/S data for real artist paints) for per-pigment curves; Golden Artist Colors' online virtual paint mixer for the recipe-in-parts idea. None of these owns a calibration loop through a printed chart.

**Novelty.** The earlier palette lab was a harmony picker over RGB light. This is paint: subtractive mixing, his real tube inventory, recipes in parts, and a physical loop through a printed and repainted chart. Nothing in Parallx mixes pigment or knows what tubes he owns.


#### 8. Dusk Engine (month)

**Pitch.** A physically modelled sky he can drag the sun through, laid over a Mark Maggiori painting so the pane shows exactly where the painter obeyed the atmosphere and where he pushed it.

**What you see.** A split editor pane. Left: a live sky dome (Hosek-Wilkie model on WebGL) above a horizon with three stacked landscape silhouettes (foreground scrub, mesa, far range) that take aerial perspective from the same model. Hand: drag the sun disk along its arc; pull it below the horizon and the glow band forms while the zenith deepens; scrub Haze and watch the horizon's chroma climb; drag the far mesa back and it dissolves into sky colour. Right: the painting opened from the media organizer, with a vertical strip extracted from its sky column (rows averaged) beside the model's strip at the same height. Fit solves sun elevation, haze and exposure to the painting's strip, then paints the residual as a heat band down the side with painter's captions ('+18 chroma orange at the horizon, zenith cooled 12 degrees'). Gamut toggles a hue-chroma wheel where the painting's colours and the model's colours sit together, with a draggable Gurney-style gamut mask that snaps to the painting's hull. Click any band on the strip and the Glass Palette hands back a recipe. Study Sheet prints a canvas page with both strips, the wheel and five recipe swatches. Dashboard widget 'Tonight's Dusk' renders this evening's sky for his location and the day's haze so he can step outside at the right minute and check the model against the real thing.

**Why it is fun.** Dragging the sun below the horizon and watching a dusk assemble itself is pure spectacle, and the residual heat band is the moment of insight: the glow is not physics, it is a decision, and you can see the size of it.

**Surfaces.** Editor pane; media organizer lightbox command 'Open In Studio'; canvas page (study sheet, prints); dashboard widget (Tonight's Dusk); settings registry (location); optional chat tool 'Explain This Sky' that narrates only the fitted numbers via api.lm; shares recipes with the Glass Palette and the sky dome with Lay Figure.

**Prior art.** ArHosekSkyModel by Lukas Hosek and Alexander Wilkie (BSD-3); three.js Sky (Preetham model, MIT) for a weekend-grade dome; Eric Bruneton's clear-sky-models (BSD) for comparison; James Gurney's gamut mapping from Color and Light; Richard Robinson's free web Gamut Mask Tool; Krita's gamut masks (GPL-3). No tool fits a sky model to a painting and shows the painter's deviation.

**Novelty.** Not a palette tool at all: it is a light and atmosphere instrument. The palette lab had no sky, no physics, no master comparison. Weather and countdown widgets exist, but nothing in the app renders a sky or reads a painting.


#### 9. Lay Figure (quarter)

**Pitch.** The wooden mannequin every studio has, made posable with character-creator sliders instead of sculpting, lit by the Dusk Engine's sky, and frozen to a printable pose card.

**What you see.** A 3D editor pane (three.js) with a neutral grey figure on a ground plane. Left rail: sliders in the Koikatsu spirit but for proportion, not faces (height in heads, shoulder width, limb length, torso, hand size, age silhouette, build) that rescale bones live. A costume shelf of simple forms: wide hat brim, duster or cape cloth plane, staff, rifle rod, bedroll cylinder, and a saddle-height 'horse block'. Hand: grab a wrist or ankle and drag, the IK chain follows; grab the pelvis to shift weight and the contrapposto appears; scroll to orbit. Pose chips: Standing Rest, Leaning On Fence, Seated Cross-Legged, In The Saddle, Reaching Up. Light: a sun handle on an arc plus the Dusk Engine dome as the environment. Render chips: Planes (flat four-value cel), Value (grey), Line (contour and crease), Shadow Only. Pose From Words: type 'cowboy leaning back on his elbows looking up at the sky' and the local model returns joint angles as JSON that the rig applies deterministically; no image is generated. Freeze writes a canvas page with three views (line, planes, value) at print size and the light angle noted in the margin.

**Why it is fun.** It is the part of a character creator he actually loved: making a figure exist without sculpting, then dressing and lighting it for a scene. Watching the cast shadow of a hat brim slide across a face as you drag the dusk sun is the kind of thing you play with for the whole hour.

**Surfaces.** Editor pane; canvas page (pose card, prints); settings registry (default figure); per-extension SQLite (saved figures, poses); api.lm (Pose From Words); reuses the Dusk Engine sky dome; command and keybinding for Freeze.

**Prior art.** MakeHuman (code AGPL-3, exported assets CC0) for parametric bodies; three.js CCDIKSolver (MIT) for the IK; Mixamo rigs (Adobe, free with account, redistribution restricted) or his own Blender Rigify rig exported as glTF (Blender is GPL, exported models are his); JustSketchMe, Magic Poser and DesignDoll (all proprietary) as the pose-app category.

**Novelty.** This is the character-creator wish answered as a painter's reference tool: no faces, no avatars, no generation. Nothing in Parallx renders 3D, and no earlier idea touched figure or light staging. Honest note: skinned bone scaling and cloth forms make this the slowest build on the list.


#### 10. The Long Sitting (month)

**Pitch.** Every phone photo he takes of a painting in progress becomes a frame of that painting's life, aligned and colour-corrected, so he can scrub a work from first wipe-in to varnish and see his own gamut grow against a master's.

**What you see.** In the media organizer an album marked as a painting ('Mesa Dusk, 24 x 36') gains a Sitting view: a filmstrip of sessions along the bottom, and above it the painting with every photo warped onto the same rectangle (corner homography) and white-balanced against the unpainted canvas edge or a grey card. Hand: drag the scrubber and the painting evolves under the cursor; hold Shift and the previous sitting ghosts at forty percent over the current one; What Changed lays a heat overlay of where paint moved between two sittings; a small hue-chroma wheel in the corner fills in as the sessions advance. Fingerprint: across all his painting albums, his lifetime gamut on the wheel, then a chosen master's painting from the Dusk Engine analysis overlaid so 'my blues stop here, his reach here' is visible. Sit Down: one command that sets the room, opening this painting's Sitting view, its reference, last recipes from the Glass Palette, and starting his rain plus low boom-bap at the saved volume. Dashboard widget 'On The Easel' shows the latest aligned frame and the date of the last sitting, no counter, no streak. A progress sheet page of eight frames prints.

**Why it is fun.** Watching your own painting assemble itself under your thumb is the time-lapse pleasure digital painters get for free and oil painters never do. The gamut overlay is a quiet, slightly humbling toy: you see your habits as a shape.

**Surfaces.** Media organizer (album role and Sitting view); editor pane; workflow node 'When Photo Added To Painting Album, Align And Measure'; dashboard widget; canvas page (progress sheet, prints); per-extension SQLite (alignments, per-session stats); command and keybinding (Sit Down); soundscape hook.

**Prior art.** OpenCV.js (Apache-2.0) for ORB feature matching and findHomography; Procreate and Krita time-lapse recording (digital only, no alignment problem); James Gurney's gamut mapping of finished paintings; Color Thief (MIT) for quick palette extraction.

**Novelty.** The idle gallery was a passive slideshow of finished work. This makes his own paintings the raw material: a moving object built from messy phone photos plus a personal gamut set against Maggiori's. No XP, no streak, the widget shows a date and a picture.


#### 11. The Squint Glass (month)

**Pitch.** An easel that puts his reference and his wet painting under one glass with the studio tricks locked together (squint, flip, notan, edges), and a persona that speaks only from what the instrument measured.

**What you see.** An editor pane with two panels under one frame: Reference on the left, Painting (a phone photo) on the right. A chip row on top: Squint (one slider blurs both equally), Flip, Grey, Notan 2/3/5, Edges (hard edges glow, soft edges fade), Across The Room (both render two centimetres wide inside a drawn frame on a far wall). Hand: hover any point and a crosshair mirrors to the same relative spot on the other image; the readout gives value step, hue angle and chroma for both and the delta in painter's words ('your sky is 1.5 values lighter and 14 degrees warmer'). Click to pin a comparison; pins stack as cards in the rail. Ask The Easel sends the pinned deltas and the two thumbnails to a local vision model speaking through a voice-registry persona ('The Atelier', terse, Sargent-ish); it may only speak to value grouping, edges, focal read and temperature, and it is forbidden from proposing or producing a repaint. Everything pinned prints as a critique sheet page.

**Why it is fun.** Flipping and squinting are the oldest studio games and doing them to both pictures at once is instantly addictive. The crosshair that mirrors across the frame turns comparison into a hunt; the persona gives the hunt a voice without taking the brush.

**Surfaces.** Editor pane; voice persona (M89 registry); chat tool 'Ask The Easel'; local vision model via api.lm (Ollama qwen-vl or llava); media organizer for picking reference and painting; canvas page (critique sheet, prints); recipes from the Glass Palette on click.

**Prior art.** PureRef (proprietary) and BeeRef by Rebecca Breu (GPL-3) for the reference board and grey filter; Notanizer (iOS) for value posterization; the Photoshop gaussian-blur squint ritual; Value Viewer app. None mirror a crosshair between reference and painting or speak the delta.

**Novelty.** Not a sketch-prompt wall and not a reference board: it is a measuring instrument for comparing two pictures, and the AI narrates measurements in a persona instead of judging or generating. Deterministic toys ship in a week; the persona and vision model are the second half.


#### 12. The Pigment Cabinet (week)

**Pitch.** A drawer of real pigments as spectral objects with their stories: pour any tube under any light and watch what it actually does.

**What you see.** A sidebar view under the Studio activity-bar container: drawers by hue slide out into cards. Each card: pigment name and Colour Index (PB29 Ultramarine, PY35 Cadmium Yellow, PR83 Alizarin, PBr7 Burnt Sienna), a masstone chip beside a five-step tint ladder to white, its reflectance curve drawn as a glowing ribbon across the visible band, a lightfastness dot, and two lines of story (lapis from Afghanistan and Vermeer; Indian Yellow; Mummy Brown). Hand: drag the light chip along the top through North Daylight, Tungsten Studio Bulb, and the current Dusk Engine sky, and every chip in the cabinet re-renders under that illuminant; metamerism shows live as two greys that match in daylight split apart under tungsten. Drag two cards together and the mixing line between them appears as a gradient with the greying point marked. Tube Twin: pick a colour from any painting and the tubes that can reach it light up while the ones that cannot go dim (an opaque cadmium versus a transparent lake). Add a card to My Tubes and it appears as a cap on the Glass Palette.

**Why it is fun.** It is a cabinet of curiosities you can touch: glowing curves, tubes with histories, a light switch that quietly rearranges every colour in the room. The metamerism trick is a small magic show that also explains why his studio bulb lies to him at night.

**Surfaces.** Sidebar view and activity-bar container; per-extension SQLite (pigment data, My Tubes); settings registry; media organizer colour pick; canvas page (printable pigment sheet); feeds the Glass Palette inventory and takes the Dusk Engine's sky as an illuminant.

**Prior art.** handprint.com by Bruce MacEvoy (the definitive pigment guide, watercolour); Color of Art Pigment Database (artiscreation.com); WebExhibits 'Pigments Through the Ages' for the stories; Roy Berns' RIT Artist Paint Spectral Database and CHSOS Pigments Checker for measured reflectance; spectral.js (MIT) for the Kubelka-Munk maths under the illuminant switch.

**Novelty.** The palette lab had no pigments, no reflectance, no illuminants and no history; this is a wunderkammer rather than a colour wheel, and it is the data spine the other rooms borrow from. A curated set of 24 common oil tubes ships in a week; the illuminant switch and Tube Twin stretch it toward a month.


### Lens: The toy box


#### 13. The Pour (month)

**Pitch.** A shelf of paint cups over a shallow tray. Tilt a cup with the hand and thick paint pours; pigments mix like real oil paint (spectral, so yellow plus blue makes green, not grey); swirl with a finger, shake the tray to marble it, scrape with a knife to reveal cells. Nothing is measured and nothing is kept unless you say so.

**What you see.** A 4x3 dashboard card holds a shallow tray that fills the body; on a shelf above it sit four cups labelled with real pigment names (Cadmium Yellow Light, Ultramarine, Alizarin Crimson, Titanium White; the shelf is chosen through the one dropdown component in the settings drawer). The hand: press a cup and drag it over the tray; past the rim angle it tips and a viscous stream pours, pooling and spreading with a GPU Navier-Stokes solver (high viscosity, so it moves like paint, not water). Drag a finger through the pool and the swirl carries pigment with it. Grab the tray edge and jerk it left-right: the pool sloshes and marbles. Double-click for the palette knife: one straight drag scrapes the top layer and cells bloom underneath (the acrylic swipe effect). Sound is synthesized from the sim, a low glug proportional to pour rate (noise through a low-pass filter), a wet slap on shake. Clicking the card opens the full-size tray in an editor pane. Two actions only: Keep This (saves a PNG into a Pours album in the media organizer) and Empty Tray (a drain opens at a corner and the whole pool spirals out over three seconds).

**Why it is fun.** It is the mess before painting, without the cleanup. Real pigment behaviour makes it uncanny: Alizarin into Titanium White goes to that exact cold pink, and a swipe reveals cells you cannot predict. Shaking a window and hearing paint slap is the kind of thing you do again for no reason.

**Surfaces.** Dashboard widget (door) plus an editor pane for the full tray; media organizer (Keep This saves into an album; pours later appear in the slideshow like any photo); per-extension SQLite (shelf, saved pours); settings registry (viscosity, shelf pigments); one command, Open The Pour. No local model.

**Prior art.** PavelDoGreat/WebGL-Fluid-Simulation (MIT) for the GPU solver; Mixbox by Secret Weapons, scrtwpns/mixbox (CC BY-NC 4.0, free for non-commercial; licence check needed if Parallx is ever sold) for spectral pigment mixing, with Kubelka-Munk as the fallback; David Li's Fluid Paint (MIT); Sandspiel by Max Bittker (MIT) for the pour-and-watch feel; the acrylic dirty-pour and swipe video genre.

**Novelty.** The palette lab (liked, to grow into art study) reads a painting and mixes deliberately with ratios and swatches. The Pour measures nothing, names no ratios and is not about any painting; it is a physics toy with paint in it. It is not the pixel-art pane (no grid, no pixels) and not the image widget (it makes, not shows). It shares pigment math the palette lab can borrow later, which is the only link.


#### 14. Punch Card Music Box (month)

**Pitch.** A brass-cranked music box that plays paper strips you punch. Wind it by dragging the crank in circles and it plays only as long as you wound; slows in the last turn like the real thing. Strips print at the true pitch of a 15-note DIY music box so you can punch them with a real hole punch, and the webcam reads a hand-punched strip back into the machine. A new folded strip is lying in the drawer each morning.

**What you see.** A 3x2 card: a small wooden box, a steel comb with 15 teeth under a glass lid, a paper strip with holes feeding through, a brass crank on the right. The hand: press the crank and drag in a circle; each full turn adds about four seconds of spring and you hear the ratchet. Release and the strip advances, pins pluck teeth (plucked-metal Karplus-Strong tones plus the mechanical tick of the gear), the tempo sags in the last turn and stops mid-phrase if you underwound. Click the strip to open the Strip Editor pane: a long paper grid, columns are beats, rows are the comb notes; click a cell to punch a hole with a paper-punch snap, and the punched chad falls into a pile at the bottom of the pane that you sweep away with a drag. Print Strip prints the strip on a canvas page at the real Kikkerland strip pitch with registration marks; Read Strip From Camera shows the webcam feed (or an imported phone photo from the media organizer), dewarps by the marks, thresholds the holes and loads the melody, with a green outline on each hole it found so you can see it reading. A small drawer under the box holds strips; at six each morning a folded new one appears, composed procedurally from the date (pentatonic, 32 beats), so anyone with the extension hears the same tune that day. A strip is a 1 KB JSON or the printed PNG, so friends can post you one.

**Why it is fun.** Winding is the whole thing: the hand works, the spring holds it, and the machine gives back exactly what you put in. Punching a hole and hearing the note is immediate making. Then it leaves the screen: the same strip goes through a hole punch and a real music box on the desk.

**Surfaces.** Dashboard widget (door) plus editor pane (Strip Editor); canvas page for Print Strip (pages must print); media organizer (import a phone photo of a strip); cron (the daily strip); per-extension SQLite (strips, drawer); settings (comb 15/20/30 notes, tuning); webcam via getUserMedia, which needs an Electron permission handler added in main. No local model.

**Prior art.** bryanbraun/music-box-fun (MIT), the open-source web punch-strip editor; Kikkerland Make Your Own Music Box kit (real 15-note punchable paper strips); Wintergatan Marble Machine for the spectacle; Tone.js (MIT) for synthesis; OpenCV.js (Apache-2.0) for reading the card from camera.

**Novelty.** The soundscape idea played other people's audio at low volume; this is a machine you compose on and wind, and the paper leaves the room. Not the timer or countdown (nothing counts down for you; the spring runs out because you stopped winding). The daily strip is a surprise, not a streak: skip a week and nothing is lost.


#### 15. Exquisite Corpse (month)

**Pitch.** The surrealists' fold-over drawing game as a slow-mail toy for two. You draw a head on a tall sheet, fold it so only two guide lines cross the crease, and send the folded sheet to a friend through a synced folder; they draw the torso blind and fold again. The last person unfolds it panel by panel. Solo: fold it for tomorrow's you.

**What you see.** An activity-bar container with a Corpse view listing sheets in play, each drawn as a folded paper with a wax seal in the friend's colour. Open a sheet: an editor pane shows a tall paper folded in three; only the top panel is open, the others physically folded behind with a crease shadow. Tools are one pencil, one ink brush with pressure from a pen tablet, one eraser: graphite and ink only, like the parlour game, no colour picker. When done, drag the panel's bottom edge upward; the paper folds over with a crease animation and a paper sound, and exactly two short neck lines cross the fold. Send To picks a friend. Transport is a folder both sides keep synced (Dropbox, Syncthing, OneDrive); the extension watches it and the sheet travels as one .corpse file (zip of PNG panels plus JSON). When a friend's part arrives, the status bar shows a folded-paper glyph and the seal turns. Unfold plays top to bottom, one panel at a time, and there is your monster. Print puts the finished corpse on a canvas page at A4 with the creases marked, for the wall. Fold For Tomorrow locks a solo sheet until the next day so you draw the torso having forgotten the head; Pass The Sheet hides the screen behind a paper cover for a partner sitting next to you.

**Why it is fun.** It is the not-knowing. The reveal is a real surprise every time, including to the people who drew it, and the constraint (graphite, ink, two guide lines) makes anyone's drawing work. For a portrait drawer it is the one drawing game where being good at heads is a joke on you.

**Surfaces.** Activity bar container plus sidebar view (sheets), editor pane (drawing), canvas page (Print), api.workspace file watcher on the shared folder, per-extension SQLite (sheets, friends, seals), cron (unlock tomorrow), status bar item (waiting sheet). No local model.

**Prior art.** Cadavre exquis (Breton, Tanguy, Miro, 1925); Drawception and Gartic Phone (proprietary online variants); Broken Picture Telephone; perfect-freehand by Steve Ruiz (MIT) for pressure ink strokes; Slowly (letters that take real time) for the slow-mail feel.

**Novelty.** Not the sketch prompt and wall: no prompt, no AI, no wall of results. The mechanic is the fold and a second person (or a delayed self), which nothing already built has. Not gamification: nobody wins, nothing is scored, the corpse is the point. Two-person and local-first without a server.


#### 16. The Sky Dial (month)

**Pitch.** A window onto a physically simulated sky with one heavy brass knob. At rest it shows the real sky outside right now, at your latitude with today's haze. Turn the knob and you scrub the sun through the afternoon into dusk and night; let go and it drifts back to now. Bind a real MIDI knob and the sky follows your hand on the desk.

**What you see.** A 4x2 wide card: a horizon, atmosphere rendered with real scattering (Rayleigh blue thinning to Mie orange as the sun drops), a sun disc, a couple of procedural cloud layers lit by the sky. Bottom right, a brass knob with a pointer, a shadow, and a thin arc of 24 hour ticks. The hand: grab the knob and drag around it; it has inertia, a soft click at each hour detent, a small overshoot on release, and then it eases back to now over eight seconds unless you press the tiny latch under it (Hold). Scroll on the knob for minutes. Two smaller knobs: haze (turbidity) and cloud. Learn Knob: turn any hardware knob once (Korg nanoKONTROL, Arturia, a cheap USB MIDI pot) and it is mapped; from then on the sun lives in your hand and the detents are the knob's own. At the real sunset the card rings one bell and the horizon glow peaks; the weather widget's already-fetched conditions seed the day's haze, so no two evenings look alike. Click the sky for the pane: full-bleed sky, knobs in a row, and Print Sky, which prints a six-frame strip of the current hour in ten-minute steps on a canvas page.

**Why it is fun.** It is a thing you turn to make the sun go down. The spring return means you are always fighting the actual time of day, which is oddly moving at 4 pm in winter. Watching the exact moment the sky turns from blue to gold, and being able to hold it there, is the wonder; that it happens to be the Maggiori dusk glow is a bonus he can chase later or never.

**Surfaces.** Dashboard widget (door) plus editor pane; settings (location, shared with the weather widget; haze default; MIDI mapping); status bar item (sunset in 42 min); Web MIDI via navigator.requestMIDIAccess (plain MIDI works in Chromium without a prompt; sysex would need the permission handler); canvas page (Print Sky); cron (sunset bell). No local model.

**Prior art.** three.js Sky example (Preetham model, MIT); Eric Bruneton's precomputed atmospheric scattering (BSD-3, with a WebGL demo); Hosek-Wilkie ArHosekSkyModel reference code (BSD-style); suncalc (BSD-2) for sun position; Cyberpunk 2077 photo mode's time-of-day slider for the scrub feel; Dyson and Panasonic sun-tracking lamps as the physical cousins.

**Novelty.** The weather widget is a number and an icon; this is the sky as an object with weight and a spring. Not the palette lab: no palette, no extraction, nothing to study unless he chooses to. The physical-world piece is the MIDI knob, which no Parallx surface has ever read.


#### 17. The Jumping Jack (quarter)

**Pitch.** Cut a figure into parts from your own drawing, painting or a game screenshot, pin the joints with brass fasteners, and it becomes a jointed paper puppet with weight that hangs on a string on the dashboard. Pull the string and it jumps; flick a limb and it swings; hold a hand up to the webcam and it becomes a shadow puppet that follows your fingers. Print the cut-out and build the real one.

**What you see.** Puppet Workshop pane: a source image from the media organizer lies on a cutting mat. The hand: lasso a part (head, torso, upper arm) and it lifts off with a paper-tear sound onto a parts tray on the right. Drag a brass split pin onto two overlapping parts to make a joint; a small arc handle on each pin sets its rotation limit. Hang It drops the assembly onto a 2D rigid-body ragdoll hanging from a hook in a 2x3 dashboard card; it sways under gravity and jolts when you drag a sash or resize the window. A string hangs below the feet: pull it down and arms and legs fly up together with a wooden clack (the Hampelmann mechanism, strings rigged to the limbs behind the body). Flick a hand and it swings and settles; drag the head and the whole body follows and dangles. Shadow Play turns the card into a backlit screen: the webcam tracks your hand, the wrist moves the body, thumb and index drive the arms, and you perform with your actual hand in the room, the puppet rendered as a rim-lit silhouette. Print Cut-Out prints the parts flat on a canvas page with pin holes marked, so a cardboard jumping jack with real brads is twenty minutes away. Puppets save as cards you can swap on the hook.

**Why it is fun.** It is the character-creator itch answered from the other side: you do not sculpt, you cut, and the character is already yours because it came from your own picture. A ragdoll with a pull string is compulsively pokeable, and it has no needs, so it never asks anything of you. The shadow screen is spectacle: your hand becomes the thing.

**Surfaces.** Editor pane (Puppet Workshop), dashboard widget (hanging puppet and shadow screen), media organizer (source images; saved puppet cards), canvas page (Print Cut-Out), per-extension SQLite (puppets, pins), settings (gravity, string length), webcam via getUserMedia, which needs an Electron permission handler in main. No generative model; MediaPipe is a tracking model only.

**Prior art.** Hampelmann and jumping-jack toys (18th century); wayang kulit shadow puppetry; Inochi2D (BSD-2) and Live2D (commercial) for 2D jointed puppets; matter.js (MIT) or planck.js (MIT Box2D port) for constraints; MediaPipe Hands (Apache-2.0) for hand tracking; Photoshop and After Effects Puppet Warp; Koikatsu and Honey Select 2 as the creator itch this answers by papercraft instead of sliders.

**Novelty.** Not a desk pet: it has no moods, no idle animation, no hunger, and it only moves when moved. It is the character-creator-like thing he still wants, starting from his own image instead of a slider sheet, and it ends as a physical cut-out rather than a render. Nothing built today cuts, pins or hangs anything.


#### 18. Phenakistoscope (week)

**Pitch.** Draw twelve frames on a disc, or pull them from a CLIP, flick the disc and watch it animate through the slits as it slows and dies. Then print the disc, push a pencil through the centre, and film it with a phone at 1/60 to see the same animation in the room.

**What you see.** A 3x3 card: a disc with twelve wedge frames around a hub and twelve slits at the rim, seen against a mirror the way Plateau built it. The hand: flick the rim with a quick drag and the disc spins with angular momentum and bearing friction (a whirr that rises then fades). At the right speed the frames fuse and the figure walks or the blob turns; as it slows the motion stutters and stops, so you flick again. Click the disc for the Disc Editor pane: the twelve wedges laid out, draw in one with onion-skin ghosts of the previous and next frame, or From Clip picks a CLIPS recording or any video in the media organizer and masks twelve evenly spaced frames into the wedges. Print Disc prints a 20 cm disc on a canvas page with slits marked for cutting and a centre hole; the footer reads: spin in front of a mirror and look through the slits, or film at 1/60 s. A Turntable option prints for a record player, computing the frame count for the chosen rpm and phone frame rate (45 rpm with a 30 fps phone wants 40 frames per turn) so the animation plays when filmed. Save As GIF drops a loop into the media organizer.

**Why it is fun.** Flicking a thing and watching it come alive, then die as it slows, is the oldest animation toy and it still works on adults. Twelve frames is exactly the size a one-hour session can finish, and drawing them with onion skin is the Blender muscle from the pre-Eevee years. The printed disc on a pencil is the payoff: a moving drawing on the desk with no screen.

**Surfaces.** Dashboard widget (spinning disc, door) plus editor pane (Disc Editor), media organizer (CLIPS recordings and videos as frame sources; GIF saved back), canvas page (Print Disc), per-extension SQLite (discs), one command, New Disc. No local model.

**Prior art.** Joseph Plateau's phenakistoscope (1832); the Richard Balzer collection of animated discs; Drew Tetz's turntable phenakistoscopes filmed on phones; phenakistoscope maker web tools; Blender Grease Pencil onion skinning for the drawing model; the same frame-extraction path CLIPS already uses for its video.

**Novelty.** Not the video widget or the slideshow: those play files; this is a mechanical object you flick, built from your own twelve drawings, and it goes to paper. Not the pixel-art pane (wedges and spin, no grid). The phone-camera trick is a genuinely physical loop no existing surface offers.


### Lens: Generative and living visuals


#### 19. Skyglass (month)

**Pitch.** The real sky over his desk, right now, rendered from physics instead of a photo. Sun altitude from his location and the clock, haze and cloud cover from the weather feed, so at 7:40pm the widget is doing exactly what Mark Maggiori's skies do: a cyan zenith falling through green-grey into a saturated orange band, with purple cloud bellies lit from below. It is the thing you point a palette lab at. It also exports an HDRI for Blender.

**What you see.** Dashboard widget: a wide card that is only sky, no chrome, no numbers, live and slow (the sun actually moves; over an hour session the palette drifts warm). Click it and the Skyglass pane opens full-bleed. Along the bottom a single hairline is the day; drag the sun bead along it to scrub from nautical dawn to full dark and watch the glow build and collapse. Two small dials: Haze (turbidity) and Cloud. A vertical sampling rule stands on the sky; dragging it left or right and pressing Pull Palette drops seven swatches from zenith to horizon into a strip under the sky, each with an approximate oil mix beneath it from a lookup table (Cad Yellow Light + Titanium, Ultramarine + a touch of Alizarin) which the local model may refine, marked with the Parallx mark. Send To Page writes the sky frame plus the swatch strip into a canvas page as an image block so it prints as a study sheet. Save HDRI writes an equirectangular .hdr into the workspace for Blender's World shader. If the weather says rain, droplets run down the glass in front of the sky (his focus ritual, seen not heard). A nightly cron captures the dusk gradient as a thin vertical strip; the Almanac tab lays the strips side by side into one long band, every dusk of the year, which exports as a 100 x 15 cm print.

**Why it is fun.** It is a window that is always more beautiful than the real one, and it teaches by being scrubbable: he can hold the sun at the exact minute where Maggiori paints and stare at how the gradient is actually built. Pull Palette turns wonder into pigment on his real palette. The Blender HDRI ties his old life to his new one with one button.

**Surfaces.** Dashboard widget (DOM createWidget with a WebGL canvas), editor pane, canvas page image block for print (pages must print), workspace fs for .hdr, cron for the nightly dusk capture, per-extension SQLite for the Almanac strips, settings registry for location and default haze, weather data via the existing weather widget feed or a direct Open-Meteo fetch (no key), palette lab as consumer of Pull Palette.

**Prior art.** Preetham et al. 1999 sky model (three.js Sky example, MIT); Hosek and Wilkie 2012 analytic sky (reference code under a permissive BSD-style licence); Bruneton and Neyret precomputed atmospheric scattering (github ebruneton/precomputed_atmospheric_scattering, BSD-3); Blender's Nishita sky texture (GPL); Shadertoy Clouds by iq (CC BY-NC-SA, reference only); Codrops RainEffect (MIT) and Shadertoy Heartfelt by BigWings (CC BY-NC-SA) for rain on glass; Terragen and the Cyberpunk 2077 sky as aesthetic references.

**Novelty.** The palette lab was judged weak because a colour picker has nothing to look at; Skyglass is the subject the palette lab lacked, and the lab becomes its consumer. It is not the weather widget (an icon and a number) and not the soundscape re-skinned: the rain is optional and silent, the sky is the point. Nothing built in Parallx renders a physically based image of anything.


#### 20. Long Exposure (month)

**Pitch.** One painting per year, made from his own brush marks. He paints twenty or thirty real marks with real oil brushes on paper, photographs them into the media organizer, and the extension cuts them into a mark alphabet. Then every semantic event in the activity journal lays one of his marks along a flow field that turns with the season. His hand, the machine's patience. In December he prints it at A2 and hangs it.

**What you see.** Setup once: an album called Marks in the media organizer; the extension thresholds paper-white away and shows the alphabet as a row of cut-outs he can delete or keep. He picks a ground colour (a warm raw umber, a cold grey) and the year begins as an empty primed canvas in the pane. From then on each journal event places one mark: his marks for user events, and for assistant and system events only transparent glazes (thin washes over what is already there), so the machine is visible in the painting but never makes a mark of its own. Colour temperature of a mark comes from that day's Skyglass dusk strip or, without Skyglass, from the weather (overcast cools, clear warms). Direction follows a flow field whose angle drifts with the sun's declination, so spring marks lean one way and autumn marks lean the other, and the painting has a season you can feel but not read. Dashboard widget: a slow drifting close-up of the region painted this week, wet-looking. Pane: the whole canvas; hover a mark and a small caption gives the journal line behind it (user viewing canvas page Exam 7 Reserving, 14 March). The hand: Varnish a region to lock it forever; Scrape Back to bare ground where he regrets a week; swap the alphabet mid-year so a new brush enters the painting. Export at 300 dpi with a colophon line (year, workspace, number of marks) as PNG or PDF, or drop it into a canvas page so it prints with the page.

**Why it is fun.** Seeing your own brush marks accumulate into something you never painted but recognise as yours is the exact kind of authorship he wants from AI: it accelerates his making without generating art for him. The glaze rule is a small poem about the assistant's place. And it is a thing to hang.

**Surfaces.** Media organizer (album of photographed marks; its chat tools already exist), editor pane, dashboard widget, per-extension SQLite for placed marks and gestures (stored as vectors plus mark ids so it re-renders at print resolution), nightly cron, canvas page image block for printing, settings registry for ground and export size. Needs one small core addition: an extension-facing journal read (api.activity.recent), which the journal doc already earmarks (renderRecent is available for further surfaces such as dashboard widgets).

**Prior art.** Tyler Hobbs Fidenza and his 2020 essay Flow Fields; Anders Hoff / inconvergent sand splines (MIT); Generative Design (Bohnacker et al., Processing sources, Apache 2.0); Laurie Frick's hand-made data self-portraits (the spirit exactly); Harold Cohen's AARON and Simon Colton's The Painting Fool for machine painting; Krita and Corel Painter image-stamp brush tips for the mark alphabet technique.

**Novelty.** Not the idle gallery (which showed finished paintings): this makes a new painting from his physical marks. Not a tracker board or a chart: no axis, no grid, no legend, and nothing can be read back except by hovering one mark. The mark alphabet from photographed oil strokes is what makes it his rather than generic Fidenza.


#### 21. Blackout (week)

**Pitch.** Erasure poems from his own notes. A canvas page, a flashcard deck, or a chapter he is studying appears typeset; a slow tide of ink blacks it out word by word, leaving an erasure poem that a local model proposed and his hand finishes. The Friedland reserving chapter has poems in it. Printable as black pages with white islands.

**What you see.** Pane: the source text set in the editor font on a plain sheet. Press Erase and ink advances line by line over sixty seconds, a soft-edged brush stroke crossing each line and skipping the words the model chose to keep (twelve or fewer, in original order, so the poem reads down the page as poems of this kind do). The proposal carries the Parallx mark in the corner and nothing else; there is no chat. Then his hand: click a blacked word and it surfaces back into the poem; click a kept word and it drowns. Drag across a run of words to keep or drown them together. A Pencil variant greys instead of blacks for printer-friendly output. Save stores the poem with its source page ref; the Book tab flips through the year's poems. Dashboard widget: the latest poem shown as its source text, then the blackout tide runs once when the dashboard opens and rests on the poem. Print: the finished sheet becomes an image block in a canvas page (prints), or exports as PDF from the pane. Weekly cron: propose one new erasure from a page he edited that week and leave it unfinished in the widget as an invitation.

**Why it is fun.** It is the opposite of a digest: it destroys information to find something surprising in his own words, and the surprise is in a reserving paper or a half-finished note. Correcting the model's choice is the pleasure; the poem is his when he saves it. The slow ink animation is genuinely lovely to watch.

**Surfaces.** Editor pane, dashboard widget, api.workspace.getCanvasPages plus page read for sources, flashcards SQLite or its chat tools for deck text, api.lm streaming with a local Ollama model (constrained output: word indices only), per-extension SQLite for poems, weekly cron, canvas page image block for print.

**Prior art.** Tom Phillips, A Humument (1966 onward); Austin Kleon, Newspaper Blackout (2010); Mary Ruefle's erasures; Jen Bervin, Nets; Ronald Johnson, Radi os; Jonathan Safran Foer, Tree of Codes (die-cut); assorted web blackout poetry makers as the interaction reference.

**Novelty.** Not the sketch prompt (which asked him to make something from nothing) and not the rejected press (a generated digest adds text; erasure removes it). Not a notes widget. The visual object is his own text, so no AI art is generated; the model only points at words, and every choice can be overruled by a click.


#### 22. Bonsai (month)

**Pitch.** A bonsai grows from his days and is shaped by his hand. Each journal event adds a little growth to the branch that belongs to that kind of activity; he prunes it with a snip, wires it by dragging a tip, turns the pot. Rendered as sumi-e ink. It never dies, never asks for anything, and prints as a hanging scroll.

**What you see.** Dashboard widget: a pot on a shelf, a small tree in ink, leaves the colour of the real season (bare in January, red in October if he set maple; snow on the pads if it snowed). Growth happens overnight via cron and is never rewarded or announced. Pane: the pot large, a turntable ring beneath it to rotate the view, and three tools at the side: Snip (drag a short line across a branch; it drops to the tray with a small ink splash), Wire (drag a branch tip; it bends and holds the curve), Pinch (click a foliage pad to compact it). Hover a branch and a faint caption names what grew it (reading and PDFs, painting and media, building Parallx), derived from the first weeks of journal events that seeded three to five leaders; after that, every event extends its family's branch a little toward the light, and the light is the Skyglass sun if installed, otherwise a fixed window. He chooses species (pine, maple, juniper) and pot. Ink render: brush-textured strokes for bark, wash blobs for pads, everything drawn in the theme's foreground ink on the theme's paper so it looks the same product in light and dark. Export Scroll writes a tall kakemono composition (tree, pot, a blank margin for his own seal) as PDF or as an image block in a canvas page for printing.

**Why it is fun.** Pruning is a hand pleasure (Prune the game proved it), and here the material being pruned is his own months. The tree is not a pet: nothing happens if he ignores it, and a heavy winter prune is as good an authorial act as any. Stretching a wired branch and watching a year's growth follow it is quietly thrilling.

**Surfaces.** Dashboard widget, editor pane, nightly cron, per-extension SQLite for the branch graph and every cut and bend (so the tree replays deterministically), journal read bridge (same small core addition as Long Exposure), weather for season and snow, optional Skyglass sun, canvas page image block for the scroll print, settings registry for species and pot.

**Prior art.** Prune (Joel McDonald, 2015; swipe to cut, grow toward light); Viridi (Ice Water Games, 2015; a succulent you tend slowly with no goals); cbonsai (GPL-3.0 terminal bonsai generator); Prusinkiewicz and Lindenmayer, The Algorithmic Beauty of Plants (free PDF); Runions et al. 2007, Modeling Trees with a Space Colonization Algorithm; Jason Webb's space colonization sketches (MIT).

**Novelty.** Not a desk pet: no face, no hunger, no death, no notifications. Not the generic garden of the month: the tree is one continuous object over years and the shape is authored by his cuts, so two people with identical journals would grow different trees. No growth streaks; missing days simply add nothing.


#### 23. Atlas (month)

**Pitch.** His workspace drawn as an old hand-inked map. Page clusters become islands and regions, pages become towns that thicken into walled cities the more they are visited, links become roads, PDFs become libraries, workflows become mills on rivers. Regions he has not touched in months sink into sea fog and the margin reads Here Be Dragons. A new edition is drawn every month and prints at A2 with a cartouche.

**What you see.** Pane: pan and zoom over ink on the theme's paper (foreground ink only, so it belongs to the product in both themes). Coastlines are generated from a heightmap laid over the workspace graph's layout, so tight clusters of pages rise as highland and orphans sit on skerries. Towns are small pictograms that grow from hamlet to town to walled city with visit count; a library glyph marks a PDF, a watchtower a flashcard deck, a mill a workflow. Roads are drawn along real journal transitions (he went from the Reserving page to the Friedland PDF often, so a road runs there). Region names are lettered in a chosen toponymic style by the local model (Latin, Old English, Tolkien, or one he types), each with the Parallx mark faint beside it until he double-clicks to rename in his own hand. Hover a town and its page title floats up; click and the page opens. Untouched regions lose their ink to fog over weeks. Redraw Edition bakes this month's map; the Editions tab flips through dated editions to watch a continent change shape. Print: an A2 SVG with compass rose, scale bar in Pages, and a cartouche with the workspace name and month, via PDF or an image block in a canvas page. Dashboard widget: a small vignette of the district he worked in this week, ink slowly settling.

**Why it is fun.** It is a place, not a diagram: you look for where you live in it, and the fog and dragons at the edges make the unexplored parts of your own work feel like a coastline you have not sailed. Monthly editions turn the workspace into a country with a history. It is the best-looking thing he could hang from this list.

**Surfaces.** Editor pane, dashboard widget, workspace graph data and api.workspace.getCanvasPageTree, journal read bridge for roads and fog, api.lm local model for toponyms, monthly cron for editions, per-extension SQLite for editions and hand-renamed labels, canvas page image block or PDF export for print.

**Prior art.** Martin O'Leary, Generating fantasy maps (2016; github mewo2/terrain, MIT); Azgaar's Fantasy Map Generator (MIT); Scott Turner's Here Dragons Abound blog; Watabou's Medieval Fantasy City Generator; Dwarf Fortress legends maps; the software-as-city lineage (Wettel's CodeCity, Gource GPL) as the ancestor this deliberately leaves behind; Townscaper as an aesthetic reference.

**Novelty.** The workspace graph is a force layout of dots and lines and is already built; Atlas hides the graph inside terrain, toponyms, and fog so it reads as land, not data. It is not the cliché code-city (skyscrapers from file sizes): it is a cartographic print with a monthly edition series, and he can rename the whole country by hand.


#### 24. Endpaper (week)

**Pitch.** Comb the day. At the end of a session a tray of water appears and the day's journal events fall into it as drops of ink, in time order, sized by how long they lasted. Then his hand rakes and swirls them into marbled paper (suminagashi or Turkish ebru) with closed-form mathematical marbling, instant at 60 fps. Every day gets an endpaper; twelve of them make a wall.

**What you see.** Pane: a rectangular tray the colour of the theme's paper with a faint meniscus. Press Drop The Day and the drops fall one after another with soft rings: his own events in the pigment he chose for himself (say a deep ultramarine), assistant events in a second pigment, system events in a neutral grey, each drop's size from its coalesced count, spacing along the tray from time of day, so a long study afternoon reads as a dense run of blue that no one but him would know how to read. Then the tools: Stylus (a single tine dragged anywhere pulls every drop into the classic suminagashi swirl), Rake (a row of tines; drag down for nonpareil), Comb (wavy path for bouquet), and Ring (a circular stir). Each gesture deforms every existing shape exactly, no fluid sim, so the sheet is crisp at any resolution. He can add drops by clicking. Lift Sheet saves it as vector operations, so Print renders at 300 dpi to A4 or A3 from the same data. The Book Of Days tab flips through the year's sheets. Dashboard widget: today's sheet with one slow ambient tine drifting through it, forever, until he lifts it. Any sheet can be set as a canvas page cover image (and prints with the page).

**Why it is fun.** The pleasure is in the pull: one drag and the whole day's ink stretches into a feather. It takes forty seconds and ends every session with an object. The data is literally pigment and the pattern is entirely his hand, which is the cleanest expression of this lens.

**Surfaces.** Editor pane, dashboard widget, journal read bridge for the day's drops, per-extension SQLite for drops and gestures as vectors, canvas page cover image and print at 300 dpi, settings registry for his two pigments, optional command bound to a key to summon the tray at session end, api.activity.note to narrate Lift Sheet.

**Prior art.** Aubrey Jaffer, Mathematical Marbling (IEEE Computer Graphics and Applications 2007; also Lu, Jaffer, Jin, Mao 2012); Amanda Ghassaei's web marbling simulator (MIT); The Coding Train, Paper Marbling coding challenge (Daniel Shiffman, MIT); physical suminagashi (12th-century Japan) and Turkish ebru for the tool vocabulary.

**Novelty.** Not the palette lab (colour is fixed by two settings; the comb is the point), not a chart (nothing is legible, by design), not the tracker board or notes widget. Nothing in Parallx is a physical-material toy driven by the hand; this is the smallest one on the list and the fastest to ship, and it produces a printable object every day.


### Lens: Character and world play


#### 25. The Sitter (month)

**Pitch.** A standalone phone web app you prop on the easel. It shows your reference portrait, and the person in it talks back while you paint: a fictional sitter played by the local model who gossips, shifts in the chair, gets bored after twenty minutes and asks for a break, and eventually asks to see the painting. You photograph the wet canvas with the phone and the photo lands in Parallx as a numbered state in a Sitting album. Nothing is painted by AI. The AI is company, the way Freud's sitters were company for hundreds of hours.

**What you see.** On the phone: the reference photo full-bleed, a thin strip at the bottom with the sitter's latest line, a Speak toggle. Hold the screen to talk (phone speech recognition), release and the sitter answers in the phone's voice. Two buttons only: Show Them The Painting (opens the camera; the sitter reacts in character to the wet canvas: 'you have made my nose too long, everyone does') and Take A Break (the screen dims to the reference in greyscale and the sitter stops talking). On the PC: a Sitting pane with a QR code to connect, the live transcript, and at the end a printable session page laying the sitter's remarks beside your progress shots like a chapter of a sitting diary.

**Why it is fun.** Portrait painting is lonely and the sitter is the missing half of it. A fictional person with a life you did not write, complaining about the pose, is theatre in your studio; and the photograph of the wet painting is the one moment the model sees your work and says something a sitter would, not a critic.

**Surfaces.** Standalone: a tiny Node or Bun server (its own repo) serving a PWA over the LAN, calling Ollama directly (text first; qwen2.5-vl or gemma3 for the wet-canvas reaction) and using the phone's SpeechSynthesis and SpeechRecognition. Parallx side: an extension with an editor pane (QR, transcript, print stylesheet), a media organizer album of states (dropped in via api.workspace.fs, or fetched through api.mcp.invokeTool from a small MCP server the standalone exposes), a text-generator lorebook holding the sitter's invented life, extension SQLite for sittings. Feasibility note: text-only sitter plus album is two weeks; vision and print sheet make it a month.

**Prior art.** Martin Gayford, Man with a Blue Scarf (2010, Thames and Hudson), a sitter's diary of posing for Lucian Freud; Perchance AI character chat (the user's own habit); Ollama vision models qwen2.5-vl, llava, gemma3 (Apache-2.0 / Llama licence / Gemma terms); Web Speech API in Android Chrome for STT and TTS; JustSketchMe and Magic Poser (proprietary) for the phone-at-the-easel form factor.

**Novelty.** Not a character generator (the reference is his own photo and the output is his painting), not the desk pet (no persistent presence; it exists only during a sitting and then leaves), not sketch prompt (it never tells him what to draw). It is the concrete answer to the separate-app question: a phone app whose only job is the easel, and Parallx is the archive it posts to.


#### 26. The Night Desk (week)

**Pitch.** A tuner widget. Drag the needle past static and you land on a late-night talk show broadcasting from inside your own workspace. The host is a character played by the local model, and tonight's guest is one of your pages, personified: 'Budget March, you have been through a lot.' Listeners call in (other personas). It sits at low volume under your rain and boom-bap and never summarizes anything: it is theatre built from your file names and your journal, and it is mostly dead air.

**What you see.** A widget shaped like a radio: a horizontal frequency band, a brass needle you drag with the mouse, procedural static between stations, an ON AIR lamp lit with the accent token when a show is live, and a single subtitle line under the band for what is being said (text only if you keep speech off). Stations: 88.1 The Night Desk (the show, on a cron schedule, silence outside it); 91.5 Request Line (a status bar item lets you leave ten words; the host reads them on air five to forty minutes later, to nobody); 94.7 Rain (a procedurally generated rain loop, no video tab needed). Turn the dial off and it is just a wooden box on the dashboard.

**Why it is fun.** Absurd dignity. A host who seriously interviews 'Untitled 14' about its abandonment is funny every time, and the delay on the request line is the pleasure: you leave a line, forget it, and twenty minutes later hear it read out with gravity. It also makes his existing focus ritual diegetic: the show is what the station plays under the boom-bap.

**Surfaces.** Dashboard widget (sandboxed HTML iframe with Web Audio for static and rain), status bar item (Request Line), api.cron for show times, activity journal read-only for 'news from the region', api.workspace.getCanvasPages for the guest list, api.lm streaming for the script, extension SQLite for the episode archive. Speech via renderer SpeechSynthesis first; a Kokoro or Piper sidecar later if the Windows voices grate. Feasibility note: static, dial, text subtitles and one show are a week; neural voices and call-in cast a month.

**Prior art.** Fallout 3, Galaxy News Radio (Three Dog reacts to what the player did; Bethesda, proprietary); Welcome to Night Vale (Night Vale Presents, podcast); Nothing, Forever (Mismatch Media, the endless AI sitcom on Twitch); Kentucky Route Zero's WEVP-TV (Cardboard Computer); Web Audio noise and rain generators (many public domain snippets).

**Novelty.** The rejected press was a digest of his activity; this never digests, it invents a show whose guests are pages and whose news is nonsense. The weak soundscape was two audio loops; this has a dial, dead air, a request line and a cast, and the rain is one station among others rather than the point.


#### 27. Sunday Letters (week)

**Pitch.** A correspondent who writes to you once a week, Sunday at seven, and never sooner. He is a fictional old painter in a fictional town, writing in the register of Vincent's letters to Theo: his week, the light, money, and then yours. He has read the activity journal and asks after the Maggiori study, or why the Exam 7 pages went quiet. You may write back on a page; he reads it before next Sunday. There is no chat. There is mail.

**What you see.** A sidebar view called Letters, a column of dated envelopes. Open one and an editor pane lays it out as a letter: dateline, salutation, two or three paragraphs in the editor font, a postscript, and an enclosed drawing described in words ('I enclose the mill at dusk; you will have to imagine it'). A print stylesheet prints it on A5 with a wide left margin. One button, Write Back, opens a blank reply page in your own canvas; its content is what he reads next. When a letter is waiting, a quiet status bar item says 1 Letter until Monday, then goes away whether you opened it or not.

**Why it is fun.** Slowness, and a voice that owes you nothing and cannot be hurried. Because his town, his mill and his debts live in a lorebook, he is an unreliable narrator who is internally consistent: the mill he bought in March is flooded in June. Reading him with the rain on, once a week, is a ritual rather than a feature.

**Surfaces.** api.cron (weekly), sidebar view plus editor pane with print CSS, activity journal read for the last seven days (actor-filtered so his own replies do not echo back), api.workspace.getCanvasPages to find the reply page, text-generator lorebook for the town, extension SQLite for the archive, api.lm for the letter. Letters as real canvas pages would need the small core bridge that exposes canvasDataService.createPage; the pane-with-print-CSS route needs no core change.

**Prior art.** Vincent van Gogh's letters (vangoghletters.org, Van Gogh Museum; texts public domain); Kind Words (Popcannibal, 2019; letters written to lo-fi beats); Animal Crossing villager letters (Nintendo); the slow-mail genre generally (Pen Pal, Mail Time).

**Novelty.** Not the press (a letter from a character about his invented week, not a digest of yours); not a desk pet (no face, no presence, one appearance a week); not story runner (no branching engine); not gamification (a missed reply changes nothing except that he asks after you). It is the model as a slow character, which nothing in the app does.


#### 28. Very Slow Painting (weekend)

**Pitch.** Your own painting sessions, played back so slowly you cannot see them move. A CLIPS recording of a digital study, or the sequence of progress photos of an oil painting, plays on the dashboard at one frame a minute, so a three-hour session takes a working week to arrive. You glance at it between exam problems and the sky has changed. Optional twin: the same player on a small e-ink panel by the easel.

**What you see.** A widget with a matte frame and no controls. Inside, one frame. Hover and a hairline caption fades in: 'Dusk sky study, 12 Aug. Frame 412 of 10,800. Arrives Friday.' Right-click: Choose A Recording, Set The Tempo (a frame a minute, a frame an hour), and Show Today's Strokes, which overlays a faint difference mask of what changed since morning so you can see the day's decisions as ghosts. The e-ink twin is a Raspberry Pi running the SlowMovie script pointed at a folder of frames the extension exports.

**Why it is fun.** Wonder for a tired brain: nothing to do. You watch yourself make something at the speed of a plant growing, and you notice decisions you never noticed making. When it finally arrives at the last frame it sits there for a day like a finished thing should.

**Surfaces.** Dashboard widget (a video element with currentTime stepping, or an image sequence), media organizer as the source (CLIPS recordings, albums of progress photos including the states posted by The Sitter), api.cron for the tick, extension SQLite for the playhead, api.workspace.fs to export frames for the e-ink twin.

**Prior art.** Bryan Boyer, Very Slow Movie Player (2018 essay and hardware); Tom Whitwell's SlowMovie (GitHub, MIT, licence to confirm); NRK Slow TV; Douglas Gordon, 24 Hour Psycho (1993).

**Novelty.** The weak idle gallery showed finished paintings; this shows the making, and only at a pace where you cannot watch it. CLIPS is already built and is used here as a source, not re-proposed. No AI is involved at all, which is the point after a week of exams.


#### 29. The Dusk Stand (month)

**Pitch.** The character creator you wanted, turned toward the painter: a posable mannequin on a turntable under a physically simulated sky. Drag the sun to two degrees above the horizon, raise the turbidity, and the mannequin's shoulder takes exactly the rim of gold Maggiori puts on his riders while the shadow side goes to that violet. Then you draw it. The sky is math, the figure is a mannequin, the drawing is yours. Each sampled patch can be turned into an oil recipe by a pigment-mixing model.

**What you see.** An editor pane, three quarters of it viewport: a grey mannequin standing on a plane, a sky dome with a real sun disc and horizon haze, and a hat if you want a hat. You pose it by dragging limbs directly and spin the turntable with the wheel. A right rail of five sliders: Sun Elevation, Sun Azimuth, Turbidity, Ground Albedo, Time Of Day (which drives the first two). Along the bottom a Palette Strip fills with the eight colours that matter on the lit figure, in the order a painter would lay them out; click one and it reads 'Cadmium Yellow Medium 62, Titanium White 30, Alizarin Crimson 8'. Print: a study sheet with the render, the strip, the recipes and the sun numbers, so it goes in the sketchbook.

**Why it is fun.** It is the Koikatsu pleasure, a figure without sculpting, aimed at the one thing he actually wants to learn. Turning the sun by hand and watching the whole world go to dusk is a toy in itself, and it is a Blender-era pleasure (light rigs, HDRIs) with no Blender.

**Surfaces.** Editor pane (WebGL via three.js, loaded lazily like Univer so main.js stays light), dashboard widget On The Stand showing the current pose and light as a still, printable study sheet (as a canvas page once createPage is exposed to extensions; as a pane with print CSS until then), extension SQLite for saved poses and skies, settings registry for default pigments and sun. Feasibility note: mannequin plus sky is a week, palette extraction and recipes a second week, print and polish the rest of the month.

**Prior art.** mannequin.js (Pavel Boytchev, MIT), a posable three.js mannequin with direct limb dragging; three.js Sky (Preetham model, MIT) and the Hosek-Wilkie 2012 sky model (reference code under a permissive licence, to confirm); Mixbox (Secret Weapons, free for non-commercial use, paid licence otherwise) for pigment-true mixing and recipes; Blender's Nishita sky (GPL, reference only); Design Doll and JustSketchMe (proprietary); MakeHuman (AGPL code, CC0 meshes) if a fuller figure is ever wanted.

**Novelty.** The weak palette lab was a colour picker; here the palette is derived from a simulated light source falling on a form, which is how a painter actually learns a sky. Not a character generator: it produces a lit pose to draw from and never an image to keep. Nothing already built does WebGL, sky simulation or pigment mixing.


#### 30. The Clue Table (week)

**Pitch.** Dixit with your own photographs and no score. Six photos from the media organizer are dealt face up. The storyteller, a persona using a local vision model, gives one oblique clue ('the year we almost moved') and you tap the photo you think it means. Reveal, groan, next hand. Swap roles: you write the clue and the model guesses, then explains its wrong guess in character. With a friend over, the phone from The Sitter becomes a second hand.

**What you see.** A widget, or a pane on bigger nights: a felt-toned table (a surface token, not a green hex), six photos fanned in a shallow arc, a card in the centre with the clue in the editor font, and the Parallx mark in the corner as the only sign the storyteller is not a person. Tap a photo and it slides to the card; the other five flip to show the storyteller's one-line reason for each ('the light in this one is an ending'). Two buttons: Next Hand and Keep This Hand, which saves the six photos plus the clue as an album. No tally anywhere, ever.

**Why it is fun.** The clue is the art form. Watching a model be oblique about your own 2019 is strange and lovely, and being oblique back at it is better. Solitary on weeknights, social when someone is over, and it ends whenever you stand up.

**Surfaces.** Dashboard widget or editor pane, media organizer (random draw across albums, EXIF year as flavour for the storyteller), local vision model (qwen2.5-vl or gemma3 through Ollama), a storyteller persona held as the extension's own system prompt, the phone PWA from The Sitter as an optional second player. Caveat from the docs: api.lm messages are text-only today while the core ollamaProvider already accepts images, so this needs a two-line core bridge (or a vision MCP tool) before an extension can do it; after that it is a weekend.

**Prior art.** Dixit (Libellud, 2008, proprietary board game; the clue mechanic itself is not protectable); Codenames: Pictures (Czech Games Edition); Mysterium (Libellud).

**Novelty.** Chess was rejected for competition and for feeling bad at it; this has no score, no winner and no openings to know. Not gamification: nothing accrues between hands. The photographs are his and untouched, the AI contributes one sentence, and it is the only idea in the set that is social without a network.


### Lens: The night desk


#### 31. The Window (week)

**Pitch.** A window onto a real sky. Sun and moon position computed for a place he picks, the actual weather there, rendered as a physically based gradient behind a window frame. At 11pm in his city it is night; a second window hung on Santa Fe or Cody, Wyoming shows Maggiori country still in dusk. Rain streaks the glass when it is raining there. He can wipe the fog with his hand and sample the sky into a page.

**What you see.** A colSpan 4 widget whose body is a window: two mullions and a sill in --px-bg-elevated, glass showing a sky computed by an analytic Preetham/Hosek-Wilkie style model in a WebGL fragment shader for the exact sun elevation at that place and minute; below the horizon a flat dark land line and nothing else (no scenery, no generated imagery). Stars fade in as the sun drops past minus six degrees, placed from a bright-star catalogue for that latitude and time; the moon has the correct phase and position. Cloud cover from Open-Meteo softens the gradient; precipitation puts drops on the glass that run down under gravity. A thin scrubber under the sill lets him drag the hour and watch the whole dusk pass in twenty seconds, then release to snap back to now. Hover shows place and local time in --px-text-muted. Hand: drag on the glass to wipe condensation (clear streaks show a sharper sky and re-fog over ten minutes); click the sill to open the pane. The pane is the same window full size with a Place dropdown (the one dropdown component), a Sample Sky button that drops five OKLCH stops of the current gradient into a swatch strip, and Pin To Page, which writes the strip plus place and time into the active canvas page as ordinary blocks so it prints. Optional, off by default: Describe This Sky asks the local model to phrase the sampled stops in painter's language from the numbers alone, so he can hold a real dusk next to his Maggiori notes. Status bar door: $(cloud-moon) Santa Fe 18:42.

**Why it is fun.** Wonder and place. It is the most room-like thing possible: a window that is truthfully somewhere else. Watching a real dusk assemble in the corner while he studies how a painter faked one is the whole point, and the fog wipe is a toy the hand reaches for without thinking.

**Surfaces.** Dashboard widget (createWidget mounts its own sandboxed iframe on the sandboxedHtml.ts pattern; WebGL runs jailed; refresh() runs host-side, fetches Open-Meteo, computes sun/moon, and packs JSON into cachedOutput so the frame needs no network); editor pane (full-size window with Place dropdown); settings registry (saved places, fog on/off); canvas page (Pin To Page blocks); status bar item; optional chat tool sky_describe and local model via api.lm; cron to refresh weather hourly.

**Prior art.** WindowSwap (window-swap.com, 2020, strangers' real windows in a browser). Hosek and Wilkie analytic sky model (2012, reference C code, BSD-3 as I recall; verify). three.js Sky example (Preetham model, MIT). suncalc by Vladimir Agafonkin (BSD-2). astronomy-engine by Don Cross (MIT). Yale Bright Star Catalogue (open data). Shadertoy 'Heartfelt' by Martijn Steinrucken for rain on glass (CC BY-NC-SA, reference only, write our own). Open-Meteo (free API, no key, data CC BY 4.0). Apple TV Aerials and NRK Slow TV for the pacing.

**Novelty.** The existing weather widget is an AI-written text report; this renders something physically true about the world outside, with no model in the loop. Not the soundscape, not an idle gallery. Sample Sky and Pin To Page point toward the art-study extension he wants without being the palette lab (no mixing, no wheel; it is an instrument for looking at a real sky).


#### 32. The Crate (week)

**Pitch.** A boom-bap instrument, not a playlist. He builds his own late-night beat from a crate of stems (his samples or the bundled kit), sets swing and a Rhodes progression by hand, and the room keeps it going at six percent all night with rain synthesized in the browser and ducked by the work itself. He is the author of the sound in the room.

**What you see.** An activity-bar container and sidebar view named Crate. Top: a three-lane by sixteen-step pad grid (kick, snare, hat); pads are --px-bg-inset squares that light --px-accent-soft when armed, and the playhead is a thin --px-accent line sweeping left to right. Below: a Swing knob (0 to 70 percent), a Tempo readout from 80 to 92, and a chord wheel with eight positions, each a named jazz voicing (ii V I in Eb, a minor 9 vamp, and so on) as text; he clicks four to set the progression and a sampled Rhodes plays it with a slow tremolo. Right column: four layer faders, Drums, Keys, Rain, Crackle, drawn as thin vertical tracks with --px-text-faint ticks. Bottom: a Master fader whose whole scale is 0 to 15 percent because that is the range he actually uses; the value shows in the status bar as $(volume-1) 6% and scrolls with the wheel from anywhere in the app. Rain is not a file: pink noise through two band-passes plus a random droplet grain scheduler, with density driven by The Window's precipitation when that widget exists and by the Rain fader otherwise. Crackle is a looped vinyl noise buffer. Hand: tap pads to build the pattern, drag the swing knob, drop a .wav from the workspace onto a lane to replace a kit sound. A Follow The Work toggle reads the activity journal: three minutes with no user events and the drums fade, leaving rain; the next canvas save brings them back over eight bars. The pattern is saved per workspace so the room sounds the same tomorrow. Build note: grid, sampler, synthesized rain and status-bar volume are the first weekend; the voicings and Follow The Work are the rest of the week; making the kit sound good is the long tail.

**Why it is fun.** Making. He placed every hit, and the app plays his beat back at a level you feel more than hear, with rain that is actually raining in the window. Watching the playhead cross pads you set is a different pleasure from a muted YouTube tab, and no one else's taste is in the room.

**Surfaces.** Activity-bar container + sidebar view (Web Audio runs in the main renderer, not a sandbox, so it keeps playing when the dashboard is closed); status bar item (volume, click to pause); settings registry (kit folder, Follow The Work, quiet hours); per-extension SQLite with migrations (patterns per workspace); activity journal via journal.onDidAppend (user actor only); workspace files through api.workspace for his own samples; commands and keybindings (Crate: Play, Crate: Pause); reads The Window's cachedOutput for precipitation if present.

**Prior art.** Tone.js (MIT). generative.fm and Alex Bainter's generative-music libraries (MIT, verified today). myNoise.net by Stephane Pigeon (calibrated noise mixer, proprietary). A Soft Murmur and Noisli (layer mixers, proprietary). Ableton Learning Music (free web sequencer). Teenage Engineering Pocket Operator PO-33 K.O. (hardware; the pad-grid feel). Strudel (live-coding patterns, AGPL-3.0, reference not dependency).

**Novelty.** The earlier soundscape idea was a player for his existing rain video and a music tab. This is an instrument: he authors the beat, the rain is synthesized and weather-true, and the mix responds to the journal. No music is generated by a model; procedural rain and a hand-set sequence keep him the author.


#### 33. Desk Foley (weekend)

**Pitch.** The workbench gets a body. Tiny recorded sounds for semantic events, never keystrokes: a page save is a pencil set down, a tab opening is a paper slide, the assistant streaming is a pencil scratch that stops when the answer does, a workflow run is a drawer closing. At four percent, under the rain. He can record his own desk with his phone and make it the pack.

**What you see.** Almost nothing, which is the point. A Desk Foley category in Settings with one row per event class (page saved, editor opened, editor closed, assistant writing, tool ran, workflow finished, planner reminder, desk closed), each with a Sound dropdown (the one dropdown component) and a Preview button, plus a master level whose scale tops out at ten percent. The status bar shows $(ear) Foley when on; clicking toggles it. Sound packs are folders in the workspace: .wav files plus a pack.json mapping journal verbs to files, so his actual pencil and his actual drawer can become the app's sounds. The assistant's pencil scratch is the only sound tied to the AI, and it is a sound, not a visual, so the Parallx mark stays the one sign. Bursts coalesce the way the journal already does (ten saves in a minute play one sound, not ten), and a quiet-hours setting keeps it silent by day if he wants the night only. Hand: none; his hands do their work and the room answers.

**Why it is fun.** The pleasure of foley in games and film, applied to the app as a place. Spectacle at a whisper. Hearing the assistant scratch away while you keep painting a paragraph is the kind of detail that makes a tool feel inhabited.

**Surfaces.** Activity journal (journal.onDidAppend is the only input, so 'semantic events only, never raw input' is inherited for free); settings registry (per-event sounds, level, quiet hours); status bar item; workspace folders for packs via api.workspace; Web Audio in the renderer; command Desk Foley: Toggle with a keybinding; api.activity.note is not used (it consumes, never narrates).

**Prior art.** Mechvibes by hainguyents13 (MIT, verified today) and Klack (macOS, paid) play keystroke sounds. Noisy Typer by Theo Watson (2012, typewriter sounds). Windows Sounds control panel event sounds and the Nintendo Switch system UI sounds are the ancestors. Papers, Please and Return of the Obra Dinn for desk foley as design.

**Novelty.** Not the soundscape (no music), not the companion (no face). Mechvibes maps raw keys, which the journal deliberately never records; nobody has mapped an app's semantic activity stream to foley. Uses no model.


#### 34. The Room (month)

**Pitch.** The workbench drawn as a place. One ink-line room in the same pen weight as the companion character, where every object is live state: the lamp is on when an editor has focus, the books on the desk are his open tabs with titles on the spines, the record spins while The Crate plays, the window is The Window, the easel holds whatever Slow Reveal is showing, and Mochi sits in the chair. Nothing decorative that is not true.

**What you see.** An editor pane (also usable as the Zen Mode backdrop) holding a single wide SVG scene in --px-text on --px-bg, a room in one-point perspective: desk, lamp, window, shelf, chair, turntable, easel, a radiator with a coat on it. The lamp casts a soft --px-accent-soft ellipse on the desk while an editor is focused and drops to --px-surface-hover when the app window loses focus. Each open tab is a book lying on the desk with its title lettered along the spine; the active tab lies open; closing a tab slides the book onto the shelf using the px motion tokens. A planner event within the hour is a note pinned under the lamp. A running workflow is a kettle on the radiator with a slight line wobble. When the heartbeat runs a review, the Parallx mark on the wall clock face pulses once (the mark stays the one sign of AI). Hand: click a book to switch tab; click the lamp to toggle Zen Mode; click the turntable to open The Crate; click the easel to open Slow Reveal's pane; drag the window blind down to dim the whole scene. Right-click an empty wall for the standard context menu with Add Object, which offers only objects that bind to real state. A small Room door card (colSpan 3) on the dashboard shows the lamp state and the window sky and opens the pane. Optional text-generator hook: after ten pm a roster character can visit as an ink silhouette in the second chair; clicking opens that character's chat with scene memory set to late night, rain.

**Why it is fun.** The app as a place. Late at night, seeing your open work as books under a lamp is a small real wonder, and it makes the disparate tools read as one product instead of a collection of toys. It is also where the other night ideas live together.

**Surfaces.** Editor pane (main renderer SVG, not sandboxed, because it needs api.editors and api.window active-editor events); activity journal for recent verbs; planner via command for the pinned note; dashboard widget door card; commands for each door (tab switch, Zen Mode, Crate, Slow Reveal); settings for which objects appear; optional text-generator command textGenerator.newChat with a scene hint; heartbeat status via parallx.heartbeat.status for the clock pulse.

**Prior art.** Spirit City: Lofi Sessions (Mooncube Games, Steam, 2024: a customizable lo-fi room with weather and a focus timer). Virtual Cottage (DU&I, free on Steam). Lofi Girl stream. Rusty's Retirement (Mister Morris Games, 2024; an idle world along the bottom of the screen). Inside this repo, the companion widget v2 ink-line style is the visual precedent.

**Novelty.** Not a desk pet (Mochi already exists and merely sits here), not an idle gallery, not a toy scene. Spirit City and Virtual Cottage decorate beside your work; here every object is bound to something true in the workbench and is a door into it, which is the dashboard's own rule (a widget is a door, not a poster) applied to a whole room. Uses no model.


#### 35. Slow Reveal (week)

**Pitch.** A painting from his own library rebuilt in front of him over ten minutes, the way a painter builds it: two values, then three, then five, then the colour masses, then the finished picture. Slow TV for one image, on the easel of the room or as a widget, ending in a study card that prints. It answers his Maggiori question (how is the glow built) by showing the construction instead of the result.

**What you see.** He points it at an album or folder from the media organizer (Maggiori studies, photos of his own oil paintings, a Cyberpunk screenshot). The widget starts as a near-black rectangle. Over the first two minutes a two-value notan emerges (luminance clustered by k-means in OKLab, drawn in --px-text on --px-bg so it is theme-true); at four minutes three values; at six, five; at eight the value shapes take their average hue and chroma as flat masses, the big-shapes stage; at ten the full image fades in. A thin progress line under the image in --px-divider. Hand: press and hold anywhere to peek at the finished painting, release to fall back; scroll the wheel to scrub stages. Click to open the pane, where the stages sit side by side and Make Study Card writes canvas blocks: the notan, the five-value map, six swatches with OKLCH numbers, and the vertical gradient stops of the sky sampled along a column he drags across the image. Plain blocks, so the page prints. A Nightly toggle uses cron at his desk hour to advance to the next image in the album, so the easel changes each night.

**Why it is fun.** Wonder without a lesson plan. Watching a dusk arrive as two shapes, then five, then colour, is beautiful even when the picture is a photo of his own dog, and for a Maggiori sky it is exactly the slow looking he wants to do and never has time for.

**Surfaces.** Dashboard widget (sandboxed iframe; refresh() passes the image as a data URL and k-means runs in a worker inside the frame); editor pane (stages side by side, column sampler); media organizer (album or folder picker via its commands or a workspace folder); canvas page (study card blocks); cron (nightly rotation); settings (album, minutes per reveal, stage count).

**Prior art.** Notanizer (iOS) and Photoshop posterize actions for value studies. Color Thief (MIT) and node-vibrant (MIT) for palette extraction; culori (MIT) for OKLab and OKLCH. James Gurney's value-study posts on Gurney Journey for the pedagogy. NRK Slow TV for the pacing.

**Novelty.** The earlier idle gallery showed finished paintings; this shows the construction of one, slowly, and ends in a printable card. Not the palette lab (no mixing, no wheel). It is the observation instrument the art-study extension he wants would be built around, arriving through the night lens. Uses no model; k-means is arithmetic.


#### 36. Lights Down (weekend)

**Pitch.** One key to arrive and one key to leave. Arriving: the chrome dims to a saved night appearance over twenty seconds, the Window lights, the Crate resumes last night's mix, the page he was on opens. Leaving: the lamp clicks off, the tabs fold shut one by one, the rain fades over thirty seconds, and the window stays lit with tonight's moon until he quits. No timer, no count, no streak.

**What you see.** A command Lights Down (default Ctrl+Alt+N, rebindable) and a status-bar item $(moon) Lights Down that only appears after his chosen hour (a cron arms the offer; it never fires by itself). Pressing it: a twenty-second crossfade of the px appearance to a preset he saved in Appearance (say Ember base with a low-saturation accent), Zen Mode on, The Room pane (or just The Window widget if the Room is not installed) fills the editor area, The Crate fades from zero to his last level, and the canvas page from yesterday's session opens as a tab. The word Evening sits under the window sill in --px-text-muted for a few seconds and goes. Pressing again, Close The Desk: editors close with the rise and fade motion tokens in reverse, books slide to the shelf if the Room is open, the appearance goes darker still, the Crate ducks to rain only and then to nothing, and the window remains with the real moon. The activity journal gets one line, closed the desk. Next launch the app is normal again and the day appearance is restored. Hand: one key, twice a night.

**Why it is fun.** Ritual and spectacle. His rain video plus boom-bap tabs already are a ritual; this turns the parts above into a place you enter and leave, remembers the mix, and gives the night an ending with a little theatre instead of alt-F4.

**Surfaces.** Command + keybinding; status bar item; cron (arms the offer at his hour); px appearance presets (the M83 Appearance system, localStorage presets); workbench.action.toggleZenMode; api.editors to open last night's page and close the set; api.activity.note for the single closing line; settings registry (hour, day and night presets, what to open); coordinates The Window, The Crate and The Room through their commands, each optional, degrading to appearance plus Zen if none are installed.

**Prior art.** f.lux (proprietary) and Redshift (GPL-3) for time-driven warmth; Apple Night Shift and iOS StandBy; the Nintendo Switch sleep chime as an ending sound; Spirit City's session start and end.

**Novelty.** Not a focus mode (it hides nothing for productivity's sake; it dims and stages a room) and not a timer (the existing timer widget is untouched). No duration is shown, nothing is counted, so it stays clear of the gamification he cut. The departure choreography is the part no productivity app has. Uses no model.


### Lens: The gamer with a 5090


#### 37. Raking Light (month)

**Pitch.** Photo Mode for your own oil paintings. Photograph a painting four times with the phone torch held at the four sides (phone propped, painting still), drop the four photos on an album, and the extension solves a true normal map of the paint surface by photometric stereo (Woodham least squares per pixel, done in a WebGL2 fragment shader; four lights suffice). The pane then relights the painting live: drag a sun handle across the canvas and the impasto ridges catch and lose the light exactly as they do when you tilt the canvas under a lamp. For a single image (a Cyberpunk screenshot, a Maggiori plate from a book) the second path is neural: Depth Anything V2 Small runs on WebGPU through transformers.js in about a second on the 5090, normals come from the depth, and the same light rig works. The geometry is approximate the way DLSS geometry is approximate, and the eye forgives it. That is the screenshot-to-painting-study bridge: watch the Cyberpunk screenshots folder, Open In Photo Mode, re-sun the scene, read what the light did.

**What you see.** An editor pane, the painting edge to edge on a neutral token ground, no chrome. A small sun disc you drag anywhere over or beyond the image; a faint ring shows elevation; scroll wheel lowers the light to grazing angle and the brushwork turns into a landscape of ridges. Right rail, four groups ordered like Cyberpunk's Photo Mode tabs: Light (azimuth, elevation, warmth, a second fill), Camera (a slight 2.5D parallax orbit from the height field, aperture, click to focus), Film (grain, vignette, tone curve), Frame (mat and gallery frame). One dropdown for presets: Gallery, Studio Lamp, Late Window, Grazing. Space flips between original and relit. Snapshot writes a PNG into a Photo Mode album with the light settings in a sidecar. Save Study Sheet prints a canvas page: original, three relit angles, the normal map, light angles in the captions. When the neural depth path is in use, the only sign of it is the Parallx mark beside the word Depth in the status bar. Dashboard tile: the last relit painting with the sun sweeping across it over an hour, click to open the pane.

**Why it is fun.** Your own painting behaves like an object in a game engine. You find brushstrokes you forgot you made. Grazing light on impasto is the museum raking-light rig nobody gets to play with, and rack-focusing across a canvas you painted is pure spectacle with your name on it.

**Surfaces.** Editor pane (WebGL2 for the solve and relight, WebGPU for the depth network); Media Organizer (four-photo album as input, Photo Mode album as output, watched screenshot folder, Open In Photo Mode action on any image); canvas page (Save Study Sheet, prints); dashboard widget (sun-sweep tile); chat tool photo_mode.relight(imageId, azimuth, elevation) so a chat can ask for a variant; status bar item; local model: Depth Anything V2 Small via transformers.js, not Ollama.

**Prior art.** RelightLab, Relight.js and OpenLIME by CNR-ISTI Visual Computing Lab (RTI and photometric stereo for cultural heritage; licence to verify before borrowing code, the maths is Woodham 1980 and is public); Cultural Heritage Imaging RTIBuilder/RTIViewer; Depth Anything V2 Small (Apache-2.0; Base and Large are CC-BY-NC-4.0, so stay on Small) via transformers.js (Apache-2.0) on WebGPU; Cyberpunk 2077 Photo Mode 2.2 (Lighting tab with spawnable lights, DoF, Effect Intensity) for the control layout; Immersity AI / LeiaPix depth parallax; Facebook 3D Photos.

**Novelty.** The palette lab read flat swatches off a flat image; this treats the painting as a lit surface with real measured normals. Slideshow and lightbox show pixels as they are; this changes the light. Immersity and LeiaPix do depth wobble on any photo but never real photometric normals of your own paint, and none of them print a study sheet. It is also the first thing in Parallx that runs a neural network on the GPU for perception rather than text.


#### 38. Sky (month)

**Pitch.** A physically based sky that fills the pane and does nothing: Bruneton precomputed atmospheric scattering ported to WebGL2, volumetric raymarched clouds, a night sky from the Yale Bright Star Catalog with the Milky Way, sun and moon placed by real astronomy for his location and the real clock, so the pane is the sky outside right now without the buildings. Scrub the whole day in three seconds and watch the clouds stream and the horizon go from blue hour to gold. One button gives it teeth: Match a Painting. Pick a Maggiori sky from the Media Organizer, drag a rectangle over its sky, and the extension samples the vertical gradient strip and fits sun elevation, turbidity and exposure to it by least squares, then shows the physical sky beside the painting with a delta strip: exactly where Maggiori pushed the yellow warmer and higher than physics allows. Works on a Cyberpunk sunset screenshot too, to see how far REDengine strays.

**What you see.** Full pane, no chrome, sky to the edges with a razor-thin dark horizon. An almost invisible sun handle; horizontal drag scrubs time of day, vertical drag scrubs day of year; wheel over the horizon changes haze, wheel over the clouds changes coverage. A time ruler fades in along the bottom on hover. One dropdown of presets: Now, Golden Hour, Blue Hour, Monsoon, High Desert, Night. Match a Painting opens the painting on the left, the fitted sky on the right, two gradient strips and a delta strip between them, fitted numbers underneath; Save Study Sheet prints that as a canvas page. Dashboard tile Sky Now: a 4x2 live sky at his location at a few frames per second, click opens the pane. A workflow node Render Sky Frame saves a PNG at a given time into an album, so a daily sunset frame accumulates into a year of sunsets the existing slideshow can play.

**Why it is fun.** The Firewatch and RDR2 sky pleasure, on his own hardware, silent, at 3440x1440. Scrubbing dusk back and forth is hypnotic. Real stars come out at night. And the moment the fit shows how far a painter you love departs from physics is a small revelation you cannot get from a book.

**Surfaces.** Editor pane (WebGL2 or WebGPU shaders); dashboard widget (Sky Now tile, fps-capped); Media Organizer (source paintings and screenshots for Match a Painting, rendered frames as output); canvas page (Match study sheet, prints); workflow node (Render Sky Frame on a schedule); settings registry (location shared with the weather widget); one dropdown for presets.

**Prior art.** ebruneton/precomputed_atmospheric_scattering (BSD-3-Clause); ArHosekSkyModel by Hosek and Wilkie (BSD-3-Clause) as the cheap analytic fallback; Sebastien Hillaire, A Scalable and Production Ready Sky and Atmosphere Rendering Technique (EGSR 2020, shaders on GitHub); Guerrilla's Nubis cloud talks and Maxime Heckel's volumetric raymarching write-up; three.js Sky example (MIT); suncalc (BSD-2) for sun and moon position; Yale Bright Star Catalog (public domain); Stellarium (GPL) as the night-sky reference; Firewatch and Red Dead Redemption 2 for the feeling.

**Novelty.** Not the weather widget (numbers and icons), not the palette lab (swatches), not the soundscape. It is the exact question he asked about Maggiori's dusk glow answered with a physical sky model and a delta strip rather than with vibes, wrapped in a pane whose main job is to be beautiful and useless.


#### 39. Set (month)

**Pitch.** A dollhouse for light. A tiny stage rendered by a GPU path tracer and lit by Sky's atmosphere as the environment. A shelf of dumb primitives: box, sphere, cylinder, cone, plane, plus a rider silhouette and a horse silhouette made of eight primitives, a mesa, a saguaro. Each takes a matte paint colour and a roughness. Set the sky to 6:48 pm in Arizona and the tracer converges in two seconds on the 5090 into real bounced light: warm ground bounce under the horse's belly, cool sky fill on the top planes, rim from the low sun. This is what DLSS taught him: the geometry is rubbish, the light is real, and the eye reads a scene. Hover any pixel and a probe shows its rendered colour next to the same material's local colour in flat light, so you see exactly what the light did to the paint. Pin Swatch collects them; Save Study Sheet prints render, swatch strip (local against lit) and sun parameters.

**What you see.** Pane split: left, the path-traced view resolving from noise to image over a second, the way a Cycles render finishes; right, a shelf of primitive thumbnails to drag onto the ground, and the same sun handle as Sky in a ribbon. G, R, S grab, rotate and scale, because he lived in Blender; middle-drag orbits. Alt-drag on the sun ribbon scrubs time and the shadows sweep across the ground live at low sample count, then settle when you let go. The colour probe is a big swatch pair that follows the cursor. One dropdown chooses the ground: sand, sage, snow, asphalt, water.

**Why it is fun.** Playing god with a Maggiori scene made of cubes. Watching a path tracer converge is one of the great small pleasures of owning a big GPU, and sweeping the sun over a mesa to see the shadow colour flip from violet to blue is a toy first and a lesson only if you want it to be.

**Surfaces.** Editor pane (WebGL2 path tracer via three-gpu-pathtracer); shares Sky's atmosphere module for the environment light; Media Organizer (snapshot renders into an album); canvas page (Save Study Sheet, prints); per-extension SQLite (saved sets); commands and keybindings (G, R, S, orbit); one dropdown for grounds. No AI, so no Parallx mark appears.

**Prior art.** Colour Constructor by Murry Lancashire (proprietary, cubebrush; light plus local colour swatches over simple 3D previews, the closest cousin); gkjohnson/three-gpu-pathtracer (MIT) on three-mesh-bvh; Blender Cycles and Eevee (GPL) for the converge-and-orbit feel; James Gurney's physical maquettes in Color and Light; Marco Bucci's blockout lighting studies.

**Novelty.** Colour Constructor is a standalone app with rasterised lighting and no physical sky or time of day; this is path traced under a real atmosphere at a real minute, snapshots into his media, and prints. The palette lab read colours off a finished image; this constructs colours from light before anything is painted. Nothing in it scores or tracks.


#### 40. Cast (month)

**Pitch.** The character-creator-like thing, done the way the web can actually do it: VRM avatars (the open format VRoid Studio exports from sliders in ten minutes, with thousands more on VRoid Hub) rendered in three-vrm with MToon toon shading, which is the Koikatsu look. Parallx becomes the studio where the character lives: a pose library (VRMA clips and Mixamo retargets plus drag-the-bone IK), expression sliders (joy, angry, sorrow, fun, blink), the MToon knobs that make anime shading (shade colour, shade shift, rim, outline width), a three-point light rig as draggable spheres, a camera with focal length and depth of field, and backdrops from a flat colour to any Media Organizer photo to Sky's live atmosphere. Snapshot renders at 4K, supersampled on the 5090, into an album. The bridge nobody else has: a character can be Cast as a text-generator persona, so the render becomes her portrait, and her expression rig follows the roleplay's scene memory, angry when the scene says angry. Perchance character chat meets Koikatsu Studio.

**What you see.** A pane with a stage and a soft ground shadow, the character standing in it. Left rail groups: Character, Pose (a grid of pose thumbnails), Face (expression sliders), Look (MToon sliders), Light (three coloured spheres you drag around the stage), Camera, Backdrop. One dropdown for aspect ratio. Middle-drag orbits, a bone handle drags a limb, clicking a pose snaps to it with a short blend, holding a light sphere and circling the character changes the whole mood live. A sidebar view lists the cast and which text-generator persona each is bound to. Snapshot puts a 4K PNG in the Media Organizer under the character's name.

**Why it is fun.** The dress-up, pose, light loop that made Koikatsu Studio addictive, without sculpting and without the adult baggage. Turning a cel-shaded figure under a warm key light is pleasure in itself, and giving the characters you already talk to a body you lit yourself is the part he asked for and never got.

**Surfaces.** Editor pane (three.js and three-vrm, WebGPU renderer path available in three-vrm v3); sidebar view (the cast list); Media Organizer (snapshots out, backdrop photos in); text-generator bridge (portrait and expression from scene memory; a small hook in ext/text-generator); per-extension SQLite (poses, light rigs, bindings); commands and keybindings; settings registry (render size, default rig).

**Prior art.** Koikatsu and Honey Select 2 Studio (Illusion, proprietary) for the loop; VRoid Studio (pixiv, free, proprietary) and VRoid Hub for making and finding avatars; pixiv/three-vrm and three-vrm-materials-mtoon (MIT); VRM Posing Desktop (Steam, proprietary) and Magic Poser and JustSketchMe (proprietary pose reference apps); Mixamo (Adobe, free with account) and VRMA for animation clips; MakeHuman (AGPL app, CC0 exported meshes) if he later wants body sliders inside Parallx.

**Novelty.** The text-generator has characters and lorebooks but no body, no face and no render; this gives them one and binds the two. It is not a desk pet (nothing lives on the desk; it is a stage you direct) and not the idle gallery. Pose apps exist but none have the toon look, the 5090-grade render, or a roleplay to drive the face.


#### 41. Speedpaint (week)

**Pitch.** He already photographs paintings in progress with his phone, at odd angles and in bad light. Drop those into an album per painting and the extension aligns every photo to the latest one (ORB features and a RANSAC homography via OpenCV.js, cropped to the canvas rectangle, white-balanced against the canvas edge), then plays the painting emerging: not a slideshow but a cross-dissolve with an optical-flow warp so strokes seem to arrive, over twenty quiet seconds at 179 Hz. A Changes lens shows what moved between two sessions as a heat overlay, so you see the exact passage you worked on last night. Export Clip hands the sequence to the CLIPS exporter that already exists (ffmpeg, mp4/webm/gif, target size, end card), the speedpaint video without the camera rig.

**What you see.** A pane with the painting large; a filmstrip of session thumbnails with dates along the bottom; a thin scrub ruler. Horizontal drag over the image scrubs time, hold to hold, vertical drag fades in Onion Skin (the previous session ghosted over the current). Onion Skin and Changes are visible buttons; one dropdown sets playback length. In the Media Organizer the album gets a Speedpaint badge and the lightbox gains Play Sessions. Dashboard tile On the Easel: the current painting morphing slowly through its sessions, click opens the pane.

**Why it is fun.** Watching your own painting appear out of white canvas like the speedpaint videos he watches, from photos taken badly, and it not mattering. The Changes lens is a small wonder every time. And there is a clip at the end to send a friend.

**Surfaces.** Media Organizer (album as input, watched import, lightbox action, CLIPS exporter for output); editor pane (WebGL for the warp and dissolve, OpenCV.js WASM for alignment); dashboard widget (On the Easel tile); workflow trigger (new photo lands in the album, realign and refresh the tile); activity journal (one event per session, nothing counted).

**Prior art.** Procreate time-lapse export (proprietary); MTL moving time-lapse and IMAlign (Python, OpenCV homography alignment for hand-held time-lapses); Eyelign (portrait time-lapse alignment); Hugin align_image_stack (GPL); OpenCV.js (Apache-2.0) with ORB, findHomography and DIS optical flow; Google Photos Cinematic photo for the dissolve-warp feel; the Speedpaint genre on YouTube.

**Novelty.** Slideshow and lightbox show photos as they are; nothing in Parallx aligns, warps, or diffs images. The idle gallery looped finished paintings; this is the unfinished ones becoming finished. No streaks, no session counts, just frames. Alignment and dissolve with export through the existing CLIPS pipeline is a week; the optical-flow morph is the second week.


#### 42. Churn (weekend)

**Pitch.** Pure spectacle, no purpose. Butterchurn, the WebGL port of Winamp's MilkDrop, fed by the same system-audio capture the CLIPS recorder already uses for System audio takes, so it reacts to his rain tab and the 5 percent boom-bap without any wiring. Full pane, 3440x1440, 179 Hz, thousands of classic presets. The twist that makes it his: MilkDrop presets can sample custom textures, so a Paintings preset family swirls, feedback-blurs and refracts his own oil paintings and the day's Cyberpunk screenshots to the beat. It asks for nothing and it is the one toy that should exist on a 5090.

**What you see.** A black pane that fills with liquid light a second after the music starts. Preset name fades in bottom-left for two seconds. Left and right arrows change preset with a two-second blend, Space holds the current one, dragging stirs it (mouse position feeds the preset's mouse variables), Ctrl+S drops a still into a Churn album. A status bar item reads Churn: System Audio and clicking it mutes the capture. Dashboard tile: a small version capped at 30 fps and a fixed size so the GPU stays free while the pane is closed; one dropdown in its settings drawer chooses the preset pack (Classic, Paintings, Screenshots). CLIPS records the pane like any window if he wants a clip.

**Why it is fun.** The Winamp 2001 ritual reborn on a 5090. The music he already plays too quietly to hear becomes visible. His own paintings dissolving in a feedback loop is a strange kind of self-portrait, and nothing about it wants anything from him.

**Surfaces.** Editor pane (WebGL); dashboard widget (sandboxed HTML iframe with WebGL, fps-capped); Media Organizer (paintings and screenshots as preset textures, stills saved to an album); the existing system-audio capture path in the CLIPS recorder (electron/recorderFrame.html System audio mode); status bar item; CLIPS for recording. No AI, no Parallx mark.

**Prior art.** jberg/butterchurn (MIT) and butterchurn-presets (MilkDrop presets converted; projectM's licence notes treat the historical presets as effectively public domain); projectM (LGPL-2.1); MilkDrop by Ryan Geiss for Winamp; Webamp (MIT), which embeds Butterchurn; the loadExtraImages texture path in Butterchurn.

**Novelty.** Not the soundscape idea, which proposed playing rain and music; this plays nothing and listens to what he already plays. Not the image or video widget. No Butterchurn build feeds a user's own paintings in as preset textures. Weekend for pane plus presets; a week with the Paintings family and the tile.
