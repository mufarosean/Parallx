# A pet that lives in Parallx, design, 2026-10-25

## Where the idea comes from

- **VS Code Pets** is a community extension (`vscode-pets`), not a built-in VS Code feature. As of v1.34 (October 2025) it has about 24 pets. They wander a side panel or an editor tab. Hovering shows a speech bubble, and a ball thrown from the panel bar gets chased.
- **VS Pets for Visual Studio** (April 2026) took the idea to the status bar. The pet walks, runs and sleeps there, celebrates a passing build and droops at a failing one.

What works in both: the pet is small, out of the way, and reacts to what you are doing. Parallx can do one better, because it knows more about the day than a code editor does: pages written, cards reviewed, problems worked, an exam date.

## The one rule it must keep

The pet is a tool like any other: off by default, all of it gone when turned off, nothing running while off (CLAUDE.md, "the app is only what the user turned on"). It lives in `ext/companion/`. The core never names it, and no other tool names it either.

So the pet cannot "know" about Flashcards. Tools announce **moments** through a new generic contribution point, and whoever listens reacts:

```ts
// Any tool, when something worth a small reaction happens:
api.moments.announce({ kind: 'celebrate', text: 'Deck finished: 40 cards' });
// kinds: 'celebrate' | 'progress' | 'rest' | 'trouble'
```

With no listener, an announcement costs nothing and goes nowhere. The pet is the first listener. A future focus timer or a "today" widget could listen too. The core adds `api.moments` (one emitter, about 40 lines). Flashcards, Worksheets, Canvas and the routines each add a line or two where a moment happens. If the pet is off, nothing changes for anyone.

## Where it lives

| Place | What it is | Verdict |
|---|---|---|
| The status bar | A 22px strip the pet walks along, between the left and right items. Always visible, never in the way. | **v1**, where it belongs: VS Pets proved the spot |
| A dashboard widget | A "habitat" card: the pet larger, its name, today's moments, a ball to throw. | **v1**, through `api.dashboard.registerWidgetType` |
| A side view | VS Code Pets' panel. It costs a whole view for a pet. | No |
| Over the page | Walking across the editor. | No: it would cover text and steal clicks |

## What it does

- **Idles:** walks a few steps, sits, looks around. It turns at the ends of its strip.
- **Sleeps** after 10 minutes of no input, and wakes on the next key or click. While asleep the animation loop stops (zzz is drawn once).
- **Reacts to moments:**
  - celebrate: a hop and a small burst
  - progress: a nod
  - rest: a stretch and a yawn, at the end of a long session
  - trouble: ears down, for a sync that failed or an index that broke
- **Responds to you:**
  - Click: a heart.
  - Right-click: a kit menu with Rename…, Throw Ball, Change Pet ▸, Hide for Today, Pet Settings…
  - Throw Ball: it chases the ball along the strip.

### Tone: kind, never a nag

This is the part to get right. Studying for a hard exam is anxious enough. So the pet:
- never counts streaks;
- never looks sad that you skipped a day;
- never mentions the exam or a deadline;
- never interrupts with words you didn't ask for.

It is glad when things go well and quiet otherwise. Hover shows at most one short line ("Nice, 40 cards!"). If you ignore it, it naps. Tools announce moments; the pet decides how big its reaction is, and the default is small.

## How it looks

- **v1:** three pets drawn in-house as sprite sheets (cat, fox, owl). Each is 16×16 pixel art scaled ×2, with 4–6 frames per action (walk, sit, sleep, hop, nod), in PNG atlases in the extension. Pixel art reads clearly at 32px and is cheap to draw.
- **v2: your own pet.** You paint in Atelier. "Make a Pet From This…" in Atelier's menu turns one of your drawings into a pet: one pose, with a gentle bob as its walk. This needs Atelier on; the pet tool asks for the image through the cover-source style contribution point, so neither tool names the other.

## Accessibility and comfort

- The pet is decorative to a screen reader (`aria-hidden`), with one exception: a named button, "Pet: Miso (Sleeping)", reachable by Tab, whose menu is the right-click menu. That covers keyboard and touch too (a tap is the click, a long press the menu).
- `prefers-reduced-motion` keeps it still: it sits, and reactions change its pose only.
- It never covers a status-bar item. Its strip is the space between them, and it hides when the bar is too narrow.
- Hide for Today and a Pet Settings toggle ("Show the pet") work without turning the tool off.

## Performance budget

- One `requestAnimationFrame` loop at 8 frames per second, running only while the pet is visible, awake and the window focused.
- Sprites are drawn with CSS `background-position` steps, with no canvas and no layout per frame.
- Target: under 0.3% CPU awake and 0% asleep, measured with a timing probe (`performance.mark` around the loop) in the probe suite.
- No network. Its name, chosen pet and settings live in the extension's storage.

## Build order

| Step | What | Effort |
|---|---|---|
| 1 | `api.moments` contribution point in core, with tests (announce with no listener is a no-op; listeners leave when their tool stops) | S |
| 2 | `ext/companion`: status-bar walker, idle, sleep, click heart, right-click menu, one pet (cat) | M |
| 3 | Moments from Flashcards (deck finished), Worksheets (paper scored), Canvas (500 words in a page today), routines (one ran) | S |
| 4 | Dashboard habitat widget; fox and owl | S–M |
| 5 | "Make a Pet From This…" from Atelier | M |

Steps 1–3 make a pet that feels alive in about two days. The art is the long pole. Placeholder shapes can stand in until the sprites are drawn.

## Open questions for the owner

1. Status bar only, or the dashboard habitat in v1 too?
2. The three starter pets: cat, fox and owl, or others?
3. Should the pet have a name you give it on first run, or a default you can change?

Sources: [forest.watch.impress.co.jp on vscode-pets 1.34](https://forest.watch.impress.co.jp/docs/news/2052151.html), [Visual Studio Magazine on VS Pets for Visual Studio 2026](https://visualstudiomagazine.com/articles/2026/04/03/10-new-tools-for-visual-studio-2026-from-mads-kristensen.aspx).
