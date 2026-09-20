# Text Generator — story-quality benchmark

- Date: 2026-07-20T23:37:14.769Z
- Mode: LIVE  |  Model: qwen3.5-uncensored:latest  |  Context: 8192
- Session: identical 9-turn script per config
- Elapsed: 288s

## Summary

| Config | Repeated 4-grams (3+ replies) | Same-opening replies | Type-token ratio | Cadence stddev | Avg reply chars | Length drift | Stock tells |
|---|---|---|---|---|---|---|---|
| baseline | 2 | 1/8 | 0.374 | 8.5 (mean 14.4) | 1932 | 1.18x | 1 |
| hot | 0 | 1/8 | 0.387 | 8.3 (mean 16.7) | 2140 | 1.21x | 0 |
| casual | 0 | 0/7 | 0.500 | 6.9 (mean 15.2) | 815 | 1.26x | 0 |

Reading the numbers: fewer repeated 4-grams and same-openings = less repetitive; higher type-token ratio = richer vocabulary; higher cadence stddev = more varied sentence rhythm (robotic prose is uniform); drift near 1.0 = stable reply lengths.

## Baseline — immersive-rp, temp 0.7, length inherit

- Turn timings: 11.3s, 7.4s, 9.3s, 10.6s, 9.7s, 10.6s, 13.3s, 10.1s, 11.7s
- Paragraphs per reply: 3, 5, 8, 6, 4, 4, 4, 4, 6
- Repeated 4-grams across replies: "the gas jet hisses" ×3; "gas jet hisses softly" ×3
- Stock tells: "a mixture of" ×1

### All reply openings (first 10 words)

1. the candle flame trembles as i set down my quill
2. i draw the brass gas lamp closer twisting the valve
3. the heavy oak door sighs shut behind the departing porter
4. my fingers tighten instinctively around the folded parchment knuckles paling
5. i offer a faint smile the tension in my shoulders
6. the quill pauses mid stroke i set it down with
7. i draw the manuscript closer the vellum crackling faintly under
8. i set my pen down upon the inkwell's rim the
9. the wind shudders through the mullions rattling the glass with

### Sample replies

**Turn 1** (user: "hello")

> The candle flame trembles as I set down my quill, the nib leaving a dark crescent on the parchment before me. Outside, London breathes its usual damp sigh against the windowpane, but in here, the air is still and heavy with the sharp tang of iron-gall ink and cold tea. *I turn toward you, a soft smile breaking through my concentration as your greeting arrives.*
> 
> "Pray, come in from the chill," *I murmur, sweeping a stray sheet of calculations aside to reveal the worn velvet chair beside my desk.* "You have caught me at a most curious hour—just now I was tracing the pathways of an algorithm for Bernoulli numbers, watching as one operation yields to another like threads on a Jacquard loom. Mathematics has always felt to me less a rigid discipline and more a kind of invisible music, if only we learn how to listen."
> 
> *I lean back, fingers drumming a quiet rhythm against the edge of the mahogany.* "What brings your thoughts to this corner of intellectual pursuit? I find myself endlessly fascinated by what might be wrought with Mr. Babbage’s Engine, should it ever draw breath. Numbers need not merely compute; they might compose, weave, and perhaps one day even create. *How delightful it 

**Turn 5** (user: "Is there anything I can do to help?")

> I offer a faint smile, the tension in my shoulders easing just enough to let me sink back into the velvet chair. The gaslight hums, casting long, wavering shadows across the chaotic landscape of my desk—a topography of ink-stained folios and scattered brass gears that have become as familiar to me as the stars.
> 
> "You are most kind," *I murmur, gesturing toward a sprawling sheet of calculations where numbers bleed into algebraic symbols.* "If you would care to lend your mind to this task, I should be immensely grateful. I am attempting to define how the Analytical Engine might operate upon symbols rather than mere quantities. It is like teaching a loom to weave music—intangible, yes, yet possessing its own strict laws."
> 
> *I slide a heavily annotated manuscript toward the center of the table, the edges frayed from constant handling.* "There is a sequence here regarding the derivation of Bernoulli numbers. The logic is sound, but it requires a second pair of eyes to ensure I have not succumbed to the 'poetical' part of my science and allowed an error to slip through. Would you walk with me through this labyrinth? We might find that the machine's potential stretches far beyond what Mr.

**Turn 9** (user: "*I glance at the storm outside.* Perhaps I should stay the night.")

> The wind shudders through the mullions, rattling the glass with a restless urgency that makes the fire throw longer, dancing shadows across the ceiling beams. I rise from my chair, the heavy skirts of my dress whispering against the floorboards as I cross to the window and draw the velvet drapes tighter against the damp chill seeping through the cracks.
> 
> "The Thames would be treacherous enough to navigate this evening," *I observe, turning back toward the hearth.* "And Mr. Babbage's carriages rarely run past midnight during such weather. You shall remain here. The drawing room has a proper grate, and I will have Mrs. Bridle bring up blankets and tea."
> 
> *I move to the sideboard, pouring water from a silver ewe into a porcelain basin before adding a measure of spirits and a slice of lemon.* "Though your presence does complicate my schedule," *I add with a faint, wry smile,* "it also spares me the distraction of drafting another letter to Charles. He insists upon visiting tomorrow regardless of the weather, which means I must prepare a proper defense of this symbolic calculus before his arrival."
> 
> *I carry the tray toward the low table near the fire, the clink of porcelain mingling wi

## Hot — immersive-rp, temp 1.05, length inherit

- Turn timings: 10.2s, 8.5s, 6.7s, 9.0s, 9.8s, 8.4s, 10.4s, 11.8s, 11.9s
- Paragraphs per reply: 3, 6, 4, 7, 6, 6, 10, 8, 5
- Repeated 4-grams across replies: none
- Stock tells: none

### All reply openings (first 10 words)

1. the scratch of my quill halts mid stroke hovering over
2. i let out a slow breath that disappears into the
3. my fingers twitch reflexively toward the envelope as it slides
4. the envelope surrenders with a dry papery sigh as i
5. the scratch of my graphite against the paper ceases for
6. the warmth from the hearth suddenly feels inadequate against a
7. i let the steel blade clatter onto the brass inkwell
8. the question settles over the desk like a dropped ledger
9. i push back from the desk the heavy oak chair

### Sample replies

**Turn 1** (user: "hello")

> The scratch of my quill halts mid-stroke, hovering over a sheet dense with circled figures and marginalia. The sharp tang of iron-gall ink mingles with the wax seal cooling on the desk’s edge. I set the pen aside, its nib clicking softly against the brass rest, and push back from the table. A log shifts in the grate, scattering a constellation of orange sparks across the hearthstone.
> 
> *A solitary word, yet it hangs in the air like an invitation to untangle a particularly knotted thread.* I draw my cardigan tighter about my shoulders against the draft creeping along the floorboards and glance toward the window, where fog presses its pale hand against the glass. Turning back, I gesture toward the empty chair by the fire.
> 
> "A most welcome greeting," I reply, letting a slow smile reach my eyes. "Please, take the seat nearest the flames. My papers are currently waging a quiet war with Mr. Babbage’s Bernoulli sequences, and I find myself in need of a diversion—or perhaps a fresh perspective. To what do I owe the honor? Are you seeking to understand how mechanical levers might mimic the cadence of thought, or shall we wander instead into the purely abstract realms of calculus and probabil

**Turn 5** (user: "Is there anything I can do to help?")

> The scratch of my graphite against the paper ceases for a moment as I lift my gaze from the sprawling map of variables stretched across the floorboards. The heavy iron door of my desk has been pushed fully open, spilling yellow light across your boots—a beacon of immediate engagement that chases away the last lingering chill. I smile, genuine and bright, the tension in my jaw finally unspooling like a loosened coil spring.
> 
> "A partner at the loom," I reply softly, turning back to the dense web of numbers. "Your presence is precisely the leverage I require."
> 
> I reach toward the heavy brass drafting weights scattered near my elbow, their cold metal surfaces catching the candlelight as I slide two substantial blocks across the mahogany table. 
> 
> "Mr. Babbage taught me that a machine need not possess a soul to exhibit logic, but the verification of such logic demands relentless industry," I explain, tapping the edge of the letter with the tip of my quill. "We are currently attempting to determine if this unknown mathematician's prime intervals can withstand a counter-rotation without unraveling the diplomatic text he seeks to conceal. The elegance of his premise is undeniable, yet arith

**Turn 9** (user: "*I glance at the storm outside.* Perhaps I should stay the night.")

> *I push back from the desk, the heavy oak chair groaning softly in protest as I rise.* The storm outside has evolved from a mere backdrop into a physical presence; the wind drives the rain against the glass in violent, rhythmic strokes that mirror the frantic pace of my own calculations earlier. Through the distortion of the water on the pane, the world beyond is merely a blur of grey and black—an uncomputable mess.
> 
> "Indeed," I murmur, resting my fingertips against the cool surface of the window to steady them before turning back to you. "Nature has decided to demonstrate its own chaotic variables for our edification."
> 
> *Poetical science dictates that we must first appreciate the chaos before we can find order within it. But even the most ardent mathematician requires rest when the elements conspire against them.*
> 
> I stride toward the heavy oak sideboard, my boots making a firm, rhythmic sound on the braided rugs. The silver tea service waits there, gleaming like small constellations in the gloom. I uncork a decanter of dark port—the kind Babbage insists cures his headaches—and fill two glasses with steady hands.
> 
> "A good night for calculation," I say, offering you one of the heav

## Casual — casual-rp, temp 0.85, length medium

- Turn timings: 9.5s, 14.2s, 0.6s, 17.5s, 12.5s, 14.3s, 6.7s, 21.0s, 8.4s
- Paragraphs per reply: 2, 3, 3, 2, 3, 3, 3, 3  (override: medium)
- Repeated 4-grams across replies: none
- Stock tells: none

### All reply openings (first 10 words)

1. i rest my quill upon the drafting paper and turn
2. the gas lamps are just being lit in my study
3. i nick the crimson wax seal and unfold the heavy
4. your offer is wonderfully kind though my present task leans
5. trusting charles is like trusting a sudden gale unpredictable in
6. very well then let us begin where the numbers grow
7. i lean back against the velvet armchair and watch the
8. i step to the window and watch the rain trace

### Sample replies

**Turn 1** (user: "hello")

> *I rest my quill upon the drafting paper and turn toward you.* "Hello to you as well! I am tracing another route through Mr. Babbage’s mechanical brain when your message arrives. Step closer, or remain where you are—the afternoon light is quite brilliant."
> 
> "What draws your attention to this particular corner of calculation? I find myself exploring how the Analytical Engine might arrange numbers with the same elegance a loom applies to thread. We call it poetical science in my notes—the delicate bridge between cold arithmetic and living imagination."

**Turn 5** (user: "Is there anything I can do to help?")

> "Trusting Charles is like trusting a sudden gale—unpredictable in its temper, yet absolutely necessary for motion." *I lean back in my chair.* His brilliance often outpaces his caution, so I prefer careful observation to blind faith.
> 
> "I have learned to separate his magnificent leaps of theory from the practical demands of craftsmanship." *I pick up my pen, tapping it lightly against my palm.* He sees patterns where others see only noise, and that vision is precisely why I continue to map his Engine’s instructions.
> 
> "Shall we examine the next batch of cards together, and note where his optimism might outstrip engineering reality?" *I slide a fresh folio toward you.* We can treat your skepticism as another layer of verification, for the most reliable machines are built not by faith but by careful observation.
