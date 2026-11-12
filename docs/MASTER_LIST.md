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

### Worksheets: a full redesign, generalized

**His words (2026-11-09):** "a full redesign of worksheets. A lot of what
I built for it, I built specifically for studying for exam 7. we need to
generalize, improve it quite a bit, etc."

**Status (2026-11-10):** agreed, it will be done. His words: "Worksheets
full redesign we will do, but we will not start with it today." Not
started; the bar research below still comes first.

**What exists today (verified from the file list).** `src/built-in/worksheet`
is two things grown together. One is a spreadsheet tool: the Univer host
(lazy bundle, one engine per window), formulas and references, display
numbers, equation images, Excel import and xlsx export, a sidebar, a
worksheet block for pages. The other is a study program built on top of
it for Exam 7: the Problem Bank and its filters, problem import, recipes,
practice sessions and their config and run panes, quizzes, the review
pane, the campaign, the day plan, the roster, rewards and their sync, the
study clock, progress insights, solution visibility, a Generate pane that
writes problems with a model. The manifest's sidebar title is Worksheets;
much of the surface is the bank.

**Direction.** Separate the two along the first principle. The
spreadsheet stays a general tool anyone uses for any table. The study
program becomes what it is, a study tool, generic in its nouns (items,
sets, sessions, a plan, progress) so it serves any exam, course or
skill, and lives where a user can turn it on or off without losing the
spreadsheet. Nothing in either names Exam 7, the CAS or his readings;
his data keeps working through the same generic shapes. The redesign is
the moment to raise the spreadsheet's own quality (he said "improve it
quite a bit").

**Bar to research first.** For the spreadsheet: what a person expects
from a sheet in a notes app (Notion databases, Coda tables, Excel's
core) and where Univer already gets there. For the study program: the
practice tools he rates (his Rising Fellow materials, Anki's sessions)
and the shape of a session, a bank and a plan that is domain-free. Get
his yes on both lists before building; see the research-the-bar rule.

**Unknown.** Whether the study half becomes its own built-in or an
extension; how much of the Exam 7 data model (recipes, roster, campaign)
generalizes and how much is his alone and stays in his workspace; the
migration of his existing banks and sessions.

### Enhance for short videos: bigger resolution

**His words (2026-11-12):** "Let's talk about the idea of enhancing
videos." Asked what enhancing means and for what footage: "short videos,
bigger resolution." Then: "add to master list."

**What it is.** The Media Organizer's Enhance, which enlarges photos
today, also enlarges a short video. Not noise removal, not rescue of old
footage, not smoother motion (more frames a second needs another engine).

**What the user gets.** An Enhance action on a video in the library; the
result is a new, larger video beside the original, with the original's
sound and frame rate, and the original untouched.

**What exists today (verified in the code).** SeedVR2, the engine behind
Enhance and the library's Upscale, is a video model that the app feeds
one picture at a time (`engine/enhance.py` runs with `--batch_size 1`).
The copy shipped in the extension already takes a video file, frames in
groups (5, 9, 13...), an overlap between groups and work in chunks
(`engine/seedvr2/inference_cli.py`). The runtime and the 8.5 GB model are
the ones photos use, so nothing more is downloaded. A video's menu offers
no edit or upscale (`item-menu.js`). ffmpeg is the machine's own; the
extension does not ship one.

**Research (2026-11-12, at his request: "Research the latest enhancement
techniques and find github repositories doing the same thing, I can't be
the only one").** Read: the field's curated paper list, the READMEs of
the main repositories, one independent benchmark on an RTX 5090. Claims
are the authors' unless marked measured; Claude ran nothing.

- The field: SeedVR2 (June 2025) is no longer the newest but is still the
  quality reference; the copy in the extension (v2.5.24, December 2025)
  is upstream's latest. The 2026 wave is one-step streaming models built
  on video generators (Wan 2.1 and 2.2), with flat memory at any length.
- Newer engines, all Apache-2.0 code: FlashVSR+ (October 2026; claims
  whole-frame 4K in 24 GB; Linux only; input sides divisible by 128),
  FastVR (Alibaba, September 2026; any scale; 1080p in about 12 GB; no
  independent test found; Windows not confirmed), ReCaVSR and RelayVSR
  (September 2026; Linux only, 4x only), SoL-Refiner (NVIDIA; made for
  AI-generated drafts, not camera footage). His machine is Windows.
- Measured by others on a 5090 (ai-upscaler-benchmark, June 2026):
  SeedVR2 7B fp8 at 1080p output, groups of 5 frames, 0.35 frames a
  second at about 25 GB: about 85 minutes per minute of 30 fps footage,
  about 15 minutes for a 10-second clip. Groups of 9 at 1080p reach 31
  GB and at 4K run out of memory. Decoding back to pixels took about 73
  of 85 seconds: the slow part is the decode, not the model. The first
  FlashVSR at 2x: 0.80 frames a second at 31 GB; 4x ran out of memory.
- SeedVR2's model card warns it over-sharpens lightly degraded video,
  which is the case of a clean clip made bigger.
- Projects doing the same: VRGDG SeedVR2 TensorRT Studio (closest: a
  local Windows app on SeedVR2, a faster decode, a short preview first,
  a before/after wipe, resumable chunks; an 8-second clip to 2K in about
  8 minutes on a 5090), SeedVR2-Lite (a desktop app, batch and resume,
  newer compressed weights), TE-Speed-SeedVR2 (a streaming decode and
  automatic chunking; a ComfyUI node, so technique only), LocalSR and
  QualityScaler (older frame-by-frame models, sound and timing kept).

**Shape (proposed by Claude, not agreed).** SeedVR2 for the first
version: it is installed, runs on Windows, and nothing newer is
independently shown to beat it. 2x, with a ceiling on the output size in
place of cutting frames into pieces. Groups of 5 frames. A preview of a
few seconds and a before/after comparison before the whole clip, then
the clip in chunks that Stop keeps, so a run resumes. A limit on length,
with the time estimate shown first. Sound copied over untouched. Effort
on speed goes to the decode step.

**First step.** A measurement on his 5090, as `docs/ENHANCE.md` did for
photos: a 10-second clip of his at 2x, recording time, peak graphics
memory and whether detail flickers between frames; one clean clip among
them, for the over-sharpening. FastVR on the same clips, if it runs on
Windows.

**Unknown.** His own numbers (the ones above are another machine's); the
ceiling on output size; the length limit; whether FastVR runs on Windows
and how it compares; what a machine without ffmpeg gets (a plain
message, or a bundled ffmpeg of about 100 MB); what his clips are (their
resolution now, their length).

## UI improvements

How the app looks and moves: new surfaces, polish of existing ones, the
feel of browsing. His gate for Voice ("improve the surfaces a bit more,
make the app feel more polished") is met by work in this section.

Shipped 2026-11-10, on his picks from the mock-ups (each is in the code
and its tests; nothing more is queued on them):

- **File explorer tree.** The registry chevron in place of the text
  glyph, the folder icon open or closed, faint indent guides, the same
  chevron on the section headers. File-type icons untouched.
- **Three sidebar icons.** Creations AI a storybook, Browser a window,
  Worksheets the calculator.
- **Tools and Search out of the sidebar.** Tools and Extensions is an
  editor tab from the View menu. Ctrl+F is one Find surface: this
  document first (text, PDF, and now canvas pages, databases and any
  tool's editor), with a switch to Workspace that the Search tool adds
  while it runs; results sit under the field. Ctrl+Shift+F opens it on
  Workspace.
- **Home, first version.** The Parallx icon opens it: search, a chip per
  tool and per tag, recent items as cards or a list. Tools feed it
  through `registerHomeSource` (`api.home.registerSource` for
  extensions). Pages and files feed it today. He judged it short of the
  idea; the redesign is the next entry.

### Home: a redesign, not yet designed

**Where it stands (2026-11-10).** A first version shipped the same day
(the Parallx icon opens it; pages and files feed it through
`registerHomeSource`). His verdict: "all you built was a recent files
thing." A second mock-up (Continue, Today, Needs You, a stream, a status
line) also missed: it read as an admin page. No third design exists.
The contribution point and `api.home` are in the code and can serve the
redesign; the page itself is to be redrawn.

**His words on what Home is (2026-11-10, spelling corrected):** "My
vision for home is to, in a way, be something that allows the user to
jump into work. To feel inspired. Really, really take inspiration from
the site I linked and how it looks." And earlier the same day: "I think
a unified home is useful, one with standard things on it." "Imagine home
being the default page that gets opened when a user opens a workspace."

**Settled by him:**

- Home is an ordinary tab. "Home is not a fixed tab, it should be able
  to be closed."
- Opening it with the workspace is the user's choice, per workspace.
  "The way we do this is, if the setting is on, we override whatever
  last opened state file to point to the home editor tab."
- Welcome stays for new workspaces. "The welcome page, in my
  experience, only runs on new workspaces, so that is true still. If it
  is a new workspace, we use welcome."
- A width setting. "I also want the setting to allow dynamic width of
  the content on the home tab. I work on a very large monitor sometimes,
  and having dynamic width will be perfect for me."

**The bar.** paperswithcode.co, and this time looked at, not described
from memory: the cloud container could not reach the site on
2026-11-10, so neither mock-up was drawn from it. Before the next
design, see the real pages (his screenshots, or a session that can
reach the site) and show him what was taken from them.

**Unknown.** What "inspired" looks like on the page (a guess, not his:
his own work shown well, visual and browsable, with the day's quote as
the one static piece). Which of the first version's parts survive. The
Daily Brief below is not part of Home (his call, 2026-11-12).

**Still true from the first version, if its stream is kept:** the
extensions do not feed it yet (each needs its own source); a card's
line is the item's opening words, not a summary the model wrote; pages
and files carry no tags.

### Daily Brief: a report a routine writes, in place of a dashboard

**Settled (2026-11-12): separate from Home, and no app work.** His
words: "Let's keep daily brief separate from home. We do not have to do
work for it. It should be something I can set up as a routine." Nothing
is queued here; the entry stays as the record of what the brief is. Home
shows no brief card and no slot for it.

**His words (2026-11-10, spelling corrected):** "I had a dashboard named
home on my personal workspace, and it had the date time widget, and it
also had the AI widget that ran a prompt to research a quote. It also
had news stories. AI runs and looks up top 10 headlines in the city and
summarizes and links them for me. These are static things that should
update daily." "What if instead of a dashboard, I created a report
instead. I think that is smarter. Something that allows more things to
be written. We still create a quote and store it in database, we can
push it to a surface. But then maybe we have a routine that runs after
all the routines, that takes a canvas page template for daily brief,
takes the quote, writes a brief summary/explanation of the quote, then
pulls the top 10 headlines, maybe it does ten local, and another 10
national, and 5 main global, with brief summaries of each and links
directly to the articles. Then we do a brief of new emails, a summary
that just lets me know if there is an unread email, finances summary -
this requires a budget refresh/sync, then pulls info from that."

**What it is.** One canvas page a day, written from a template by a
routine that runs after the day's other routines: the quote with a
short explanation; headlines (ten local, ten national, five global),
each summarised and linked to its article; whether there is unread
email; a finance summary taken after a Budget sync. The quote is also
kept in the database, as it is today.

**How it stays modular.** Each part belongs to the tool that owns the
data (Budget's summary, the mail tool's unread count, web research for
headlines); the brief is a template with slots those tools fill, and a
slot whose tool is off is left out. Nothing in the core names them.

**Unknown.** Which tool owns email (none reads mail today, to verify);
where the routine's order ("after all the routines") is declared; one
page per day or one page rewritten; his city and sources for local
news; what happens to the brief on a day the model or the network is
unavailable.

### Dashboards: reimagined as a place to brainstorm and link work

**His words (2026-11-10, spelling corrected):** "Dashboards were my
attempt at designing custom dashboards for myself." "My current problem
with dashboards is that I really, really do not use them. I want to
reimagine them as a brainstorming space or a place to link different
work. Something to unify the painting plans, the AI workflows, the
mindmaps, etc." "Do you remember how Atelier created the plan
dashboards, think of them that way, but for all pieces of the app. If
what I want is to build a static view, then why not build it into the
app." "I believe the real question is, are we being redundant here?"
"Let's think through that thoroughly. For now, we focus on home."

**What it is.** Not a board of static widgets (a static view worth
having is built into the app; the daily ones become the Daily Brief).
A working surface where pieces from different tools sit side by side
and are linked: a painting plan, an AI workflow, a mind map, pages,
files. Atelier's plan boards are the model, widened to every tool.

**His words (2026-11-12, spelling corrected):** "When it comes to
dashboards, we should research online. I want something that is unique,
robust, while doing all the basic things. Think of a whiteboard, an
online whiteboard."

**Research, first pass (2026-11-12, read from each vendor's own pages
that day; what was not read is said).**

- *The basics, as FigJam, Microsoft Whiteboard and Apple Freeform name
  them:* sticky notes, text, shapes, connector lines (straight, elbow,
  curved), pen and highlighter, images, files, links, tables, sections
  that hold and move what is in them, lock, bring to front and send to
  back, group, align and tidy up, pan and zoom, templates, comments.
  Miro was not read (its help centre refused the fetch). Whether a line
  stays attached when its object moves is not said in the pages read.
- *Boards for linking work (Heptabase, Obsidian Canvas, Scrintal,
  Milanote, Kinopio, AFFiNE):* Heptabase: "The same card can be placed
  on multiple whiteboards at the same time", "Whiteboards do not own
  cards", a card lists the boards it is on and jumps to its place there,
  search within one board, sections, boards inside boards. Scrintal:
  links between items are global, connector lines "only exist on the
  specific board where they're created". Obsidian: a card can be
  narrowed to one heading of a note; lines carry direction, labels and
  colours; zoom to fit; boards are saved in the open JSON Canvas format.
  AFFiNE: a page and its canvas are two views of the same blocks.
  Milanote: boards nest like folders; a copy is the default and syncing
  is opt-in, for notes only.
- *Engines:* tldraw's licence permits "use only in development"; a
  shipped app needs a paid key, or a discretionary hobby key that shows
  a "made with tldraw" watermark. Excalidraw is MIT but a React drawing
  tool; whether app content can live inside one of its elements was not
  found. BlockSuite (AFFiNE's editor) is web components, MPL 2.0 by its
  README, and calls itself early stage. JSON Canvas 1.0 (2024-03-11,
  MIT) is a file format only: text, file, link and group nodes, edges
  with sides, ends, colour and label. Logseq's page was too large to
  read.
- *In the app already:* `src/ui/nodeCanvas.ts`, one pan and zoom surface
  with draggable nodes, labelled edges, selection and the keyboard's way
  to all of it, whose nodes are drawn by whoever uses it. The workflow
  editor is its only user today.

**Status.** Research shown to him 2026-11-12 with a proposed bar; his
yes on the bar is owed. No design, no build. Still open: what becomes
of the existing dashboards and their widgets, and how a board differs
from a canvas page that embeds blocks.

### Text arrows elsewhere

Found while replacing the explorer's: the same dated text glyphs (▾ ▸ ▼
▶) remain in the dropdown component, the chat's tool-result caret, its
context pills and token bar, the tool detail page's sections and two
canvas property pickers. Not raised with him; recorded so it is not
forgotten.

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
- **Story tab writing style** (the Story tab uses no writing preset,
  only chats do): removed by him, 2026-11-10.
- **A trash for files, or one Trash for pages and files:** his own
  thought of 2026-11-09, removed by him, 2026-11-10. Files still go to
  the Recycle Bin on the same volume and are deleted in place on another.
- Music generation (ACE-Step 1.5, YuE2): not offered; next to the
  rejected soundscape round of 2026-09.
