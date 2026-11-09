# Master List: app improvements and future extensions

The one place future work is tracked. Started 2026-11-09 as the canon for
the next month. An idea goes here when Mufaro says so, with his words on
it; it leaves when it ships (a line in the doc it shipped into) or when he
drops it. Nothing on this list is agreed to be built until he says go on
that item; the list is the queue, not the plan.

How to read an entry: what it is, what the user gets, what exists today,
and what is unknown (a licence, a size, a bar not yet researched).

The sections, by his rule (2026-11-09): improvements to surfaces that
already exist, UI improvements, and completely new extensions are kept
apart, so a month's plan can be read by kind. Verification he is owed and
ideas he has heard and set aside come last.

## Existing surfaces: improvements

Changes to what is already there: a tool, a pane, a prompt, a pipeline.

- **Story tab writing style.** The Story tab (`story-core.js`,
  buildBeatMessages) uses no writing preset; only chats do. Not raised
  with him yet; recorded here so it is not forgotten.

## UI improvements

How the app looks and moves: new surfaces, polish of existing ones, the
feel of browsing. His gate for Voice ("improve the surfaces a bit more,
make the app feel more polished") is met by work in this section.

### File explorer: the tree's look

**His words (2026-11-09):** "we need to change the UI of file explorer.
particularly the little arrows, they feel dated, not modern enough."

**What it is.** The explorer tree draws a small filled triangle before
every folder (collapsed pointing right, open pointing down), with the
folder icon after it. That twisty is the dated part. The modern tree
(Finder, the GitHub file tree, Linear, Notion's sidebar) uses a thin
chevron that appears on hover or focus and turns on open, or folds the
open state into the folder icon itself and shows no twisty at all;
rows breathe more, indent guides are faint lines, selection is a soft
pill.

**What exists today (verified).** The explorer draws its own tree in
`src/built-in/explorer/main.ts`: the arrow is a text glyph, "▾" or "▸",
in a `tree-node-chevron` span, which is why it reads as dated; the font
draws it, not the icon registry. The canvas sidebar already uses the
registry's `chevron-right` icon turned by a class. There is no shared
tree control in the kit yet.

**Scope.** Replace the glyph with the registry chevron, drawn and turned
the way the canvas sidebar does it, and decide hover-reveal against
always-shown on the real tree. If a second tree wants the same look, that
is the moment to lift it into the kit, not before. Keyboard behaviour
(Left and Right to fold and unfold, the names the probes read) stays as
it is.

**Unknown.** Which of the two directions he wants (chevron on hover, or
no twisty): show both on the real tree and let him pick. Whether the
indent and row height change with it.

### Home: one front door for everything recent

**His words (2026-11-09):** "a sort of home ... navigated to by hitting
the Parallx icon in the top left of the app ... a home dashboard page,
mimicking Papers With Code, but not exactly, where extensions can push the
recent files there ... a unified navigation of recent files, user can
search across the different extensions they have installed."

**What it is.** Parallx holds several kinds of thing a person comes back
to: files in the explorer, canvas pages, and what tools keep for
themselves (Creations' characters, chats, lorebooks and tables; the Media
Organizer's library; Budget's ledger). Today each lives behind its own
tool. Home is a page, opened from the Parallx icon, that shows them as
one stream: recent items across every kind, each as a card with a title,
an automatic one-line summary, its tags, where it lives and when it was
touched; a search box that searches across all of them; browsing by kind
and by tag, quick enough to flick through.

**The bar.** paperswithcode.co: fast page-to-page browsing, a summary
written for every item, tags shown on the card, search that is the first
thing on the page, trends and recents as the default view. Not a copy;
the feel of it.

**How it stays modular (the first principle).** The core defines one
contribution point, a recents-and-search provider: a tool registers "here
are my recent items, here is how to search them, here is how to open
one". Canvas and the explorer register as built-ins; every extension
registers while it runs and vanishes from Home when turned off. Home
itself knows no tool by name. The summary comes from the same provider
(a tool knows how to describe its own items) or, when a tool gives none,
from the core's language-models service over the item's text.

**What exists today.** The Welcome page (`src/built-in/welcome`, command
`welcome.openWelcome`): recent workspaces and recent files, first-launch
only. The dashboard with its widgets. Neither spans tools, neither
searches. Home is the successor to the Welcome page's recent rows, not a
third thing beside them.

**Unknown.** What the Parallx icon does today on click (nothing bound, to
verify); where the summaries are stored so they are written once; how
the provider reports changes without a timer per tool.

## New extensions

Completely new tools, each its own extension in `ext/`, on or off by the
user. All four came from the Papers With Code read of 2026-11-09.
Licences are not checked for any of them; that is the first step of each.

### Read Anything: a better local reader for scans and photos of pages

**His question:** how is this different from nomic? **Answer:**
nomic-embed-text embeds text that already exists so it can be searched;
it cannot read a scan. Reading a scan is extraction, which Parallx does
through Docling, with an optional OCR pipeline (`docling-ocr` in
`documentExtractionService.ts`). So the loop exists. What the new models
add is the quality and the cost of that OCR step: Indra OCR is a
1M-parameter ONNX model that runs on CPU with no PyTorch, reads
handwriting, 80+ languages and pages at any angle, and returns Markdown,
text or JSON with boxes; MiniCPM-OCR 1.0 (1.3B) and Xiaomi-OCR-0 (0.8B)
are the heavier tier for tables, formulas and charts.

**What the user gets.** Any scan or photo of a page becomes searchable
text with boxes that click back to the spot on the page; handwriting
included. For him: scanned exam papers, the closing documents. For
another person: receipts into Budget, medical letters, warranties.

**Shape.** An extraction provider the indexing pipeline can prefer over
the Docling OCR pipeline for images and scanned PDFs, plus the box data
kept so a search hit can highlight the page. Measure against Docling's
OCR on his own scans before deciding it replaces anything.

**Unknown.** Licences; whether Indra's quality on his scans beats
Docling's; the CPU time per page.

### Voice, both ways, local (after the surfaces are polished)

**His words:** "I do have interest in adding voice, just not quite yet. I
feel like I need to improve the surfaces a bit more, make the app feel
more polished before going to voice."

**What it is.** Qwen3-ASR (0.6B and 1.7B): speech recognition plus
forced alignment (word timestamps). Qwen3-TTS and Breeze TTS 2: voice
design from a plain description, cloning from a short sample, streaming.
The extension: dictate into a page; read a page or a flashcard deck
aloud; in Creations, give each character a described voice so a chat can
be heard; transcripts of his own recordings linked to the moment.

**Gate.** Polish first, by his call. Not started until he reopens it.

**Unknown.** Licences; VRAM beside a loaded chat model; which TTS reads
best in his ear (his real-model rule applies).

### Predict From This Table

**His words:** "This one I find interesting. Forecasting budget or
habits."

**What it is.** TabPFN-3.5, a tabular foundation model that forecasts and
classifies on small tables with no training step. The extension: an
action in Worksheets and Tables that fills a column from the others, or
forecasts the next points of a time series, with the uncertainty shown.
Budget's ledger forecast; habit data; any spreadsheet a person keeps.

**Shape.** One AI tool and one Worksheets action, both through the
extension's single model route; a result lands as a new column or a
block, never silently overwriting data.

**Unknown.** Licence (TabPFN weights have had their own terms before);
size on disk; whether it runs on CPU in acceptable time; how it handles
dates and text columns.

### Generative edits in the Image Editor

**His words:** "I like the idea of generative edits."

**What it is.** Qwen-Image-2.1 unifies text-to-image and instruction
image editing in one open model; Iris-3B is pixel-space restoration and
super-resolution. The extension: a Generate step beside Enhance: inpaint
a masked region, edit by instruction, extend a canvas, all local on his
5090. Iris is a comparison against SeedVR2 (the current Enhance winner),
not a replacement until measured.

**Shape.** Reuses the editor's masks (step 2 of the mask work) as the
inpaint region; one model route; results as a new layer or a new copy,
never over the original.

**Unknown.** Licences; VRAM at his image sizes; speed per edit; ComfyUI
stays off the table (decided earlier, do not re-raise).

## Verification owed

Shipped work he has not yet judged, and measurements not yet taken.

- Re-measure on gemma4:31b at 64K, owed since 2026-11-09: the writing
  styles after the room change (words a reply, replies showing a thought),
  and the two knowledge cases (father, daughter, chef; the two strangers).
- His verdict in the app: Style Text and Start Custom From This; the
  per-character direction lists in Chat Settings; a generated sheet on
  Gemma and Qwen.

## Heard, not on the list

Recorded so they are not proposed again as new.

- **Extract To Table (GLiNER2.5):** "Not really sure how useful this one
  is." Off unless he brings it back.
- **Research Desk (Papers With Code inside Parallx):** "I like the idea,
  but not as a native." If it comes, it is an extension, never core.
  The pwc-cli SKILL.md could be loaded as a chat skill with no build.
- Music generation (ACE-Step 1.5, YuE2): not offered; next to the
  rejected soundscape round of 2026-09.
