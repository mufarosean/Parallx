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

### AI chat: message times, model speed, dates on old chats

**His words (2026-11-12, spelling corrected):** "currently AI chat does
not track the times of messages back and forth, this is annoying. There
also is no way for me to see how fast the model responds (tokens per
second). These are improvements we need to make. Also on old chats
instead of saying how far ago they were, after any day before
yesterday, we really should just use the date." He called it "a needed
update".

**What exists today (verified in the code).** Every message already
carries its time (`timestamp` in `chatTypes.ts`); the chat does not
show it. Ollama already reports, with each answer, how many tokens it
wrote and how long that took (`eval_count`, `eval_duration`, read in
`ollamaProvider.ts`); nothing shows it. The chat list shows a relative
time for every chat however old (`chatSessionSidebar.ts`, the shared
`ui/relativeTime`).

**Scope.**

- *Times:* each message shows when it was sent, and an answer shows how
  long it took. Quiet by default (small, beside the message's actions),
  with the full date and time on hover and for a screen reader.
- *Speed:* each answer shows tokens per second, with time to the first
  word; thinking counted apart from the answer if the engine reports
  it. A cloud model shows what its provider reports, or nothing.
- *Dates on old chats:* today and yesterday stay relative ("2h ago",
  "Yesterday"); anything older shows its date. The chat's list only.

**Settled by him (2026-11-12).** Done after the extension work. Speed
sits under each AI response. The date format "does not matter to me"
(Claude's pick: Nov 12, with the year when it is not this year). The
date rule is for the AI chat's list only; no other list changes.

**Unknown.** Whether the day a conversation moved to is marked between
messages.

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

**Proposed bar (2026-11-12). Claude's proposal, shown to him; he said
"document to master list", which records it and agrees nothing.**

- *The floor:* everything in the basics list above. Two of them are in
  question for a one-person app: pen drawing and comments.
- *Taken from the linking boards:* one item on many boards, with a list
  on the item of the boards it is on and a jump to its place
  (Heptabase); links that hold everywhere beside lines that belong to
  one board (Scrintal); a card narrowed to one heading of a long item
  (Obsidian); boards inside boards (Milanote, Heptabase); search within
  one board and zoom to fit.
- *What would make it Parallx's own.* In the products read, a card is a
  note, a file or a web link; none of the pages read shows live items
  from many tools on one board.
  1. A card is the real thing: a page, a database view, a worksheet, a
     painting plan, a workflow, a deck, a PDF at a highlight, a chat. It
     opens in place and is never a copy.
  2. Tools bring their own cards through a contribution point, while
     they run. Turned off, a tool's cards stay in place as placeholders
     and return when it is turned on. The board knows no tool.
  3. The existing widgets (clock, notes, image, AI) become cards, so
     today's dashboards move onto boards and nothing saved is lost.
  4. A board is its own surface, not a kind of canvas page: a page reads
     top to bottom, a board is free space. They share items, not layout.
  5. The model works on the board: select cards and ask; the answer
     lands as a new card that can be deleted.
- *Built on:* the app's own `nodeCanvas`, not an outside engine. A
  board's file shape kept close to JSON Canvas so boards can be
  exported and imported.

**Status.** No design, no build. Owed from him: whether the floor is
right (pen drawing, comments); whether the five points describe the
board he means; whether widget dashboards retire once boards exist.
Owed from research: Miro, and how each product looks, from
screenshots; whether lines stay attached to moved objects in the
products read; how Atelier's plan boards are built
(`ext/media-organizer/plan-shell.js`, not yet read).

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

### Build plan for the three (proposed 2026-11-12; his go owed on each)

Each extension starts with a test on his own files outside the app, and
nothing is built before he has seen the result. Each surface is drawn
as mock-ups in the app's own tokens, kit and icons, light and dark, and
he picks before it is built. A step is done when the keyboard and touch
audits report 0 and he has seen it running.

*Order, by his call (2026-11-12):* "I would prioritize the extension
work first then do the chat times and speed at the end."

*His corrections the same day:* the test on twenty of his scanned pages
was Claude's invention and is dropped ("We do not need to test that...
we are adding it for the potential situation, but do not expect that we
will have this issue"); Read Anything is checked on pages Claude makes,
and the reader is Claude's pick (MiniCPM-OCR 1.0 inside Docling).

*Read Anything.* The record of what is built is `docs/READ_ANYTHING.md`.

Shipped 2026-11-12 (in the code and its tests; checked in a hidden copy of
the app):

- The reader as an engine Parallx sets up itself (it was never installed
  on his machine, so every PDF had been read as plain text). It is set
  up on his machine now: about 8 GB under `data/runtimes/docling`.
- Every rich document read with its structure; a scan read from its
  pixels; where everything on the page is kept per document.
- A scan's text reaches search, the chat's reading and the quote
  locator; in the PDF view Find, selection and a citation's highlight
  work on a scan.
- The reader stays on the processor (no graphics memory), one document
  at a time, at low priority. Pictures are never read in the background.

Decided by Claude while building, for him to overrule:

- Formulas are not turned into LaTeX in the background: about 4 seconds
  a formula even on the card. It becomes a request on one document.
- The reader in use is Docling's own, with PP-OCRv6 for scans. The
  heavier vision reader (MiniCPM-OCR) is not wired: the standard one
  read the test scans cleanly and gives a box for every line, which the
  vision readers do not.
- On his next launch the indexer reads every PDF in the open workspace
  again, once, in the background on the processor.

Left, in order:

3. The highlight for a block (a table, a figure) and for a picture of a
   page in the image view. Mock-ups first.
4. The chat sees the page: the Read tool hands over the page image; a
   citation shows a small crop of where it came from.
5. Open As Page: the scan beside the page it became. The largest
   surface; mock-ups first. Formulas as LaTeX belong here, on request.
6. A surface for the reader's state (set up, size, Remove, Read Again
   for one file) in place of the command's notifications. Mock-ups
   first.
7. Reading a scan when it is opened, if it has not been read yet.

*Generative edits.*

Done 2026-11-12:

- The engine is Qwen-Image-2.1, packaged as a tool runtime in the Media
  Organizer (`generate-engine.js`, `engine/generate.py`): packages and
  its 24 model files (33 GB) pinned by hash, a self-test. Nothing in the
  editor calls it yet.
- One test edit, on a 32 megapixel public photo: a hay bale removed with
  no visible seam, 77 seconds at 40 steps, 19 GB at peak. Six more test
  edits are owed; they need the card.
- The layout of the tab: three mock-ups shown; his pick, in his words:
  "I pick B". B is three numbered steps: mark the area (Brush Over It,
  Select Subject, Beyond The Edges, Whole Picture), say what to do there
  (with ready-made starts), pick a result. The states board (working,
  card in use, not set up) goes with it.

Built since his pick (2026-11-12), checked in a hidden copy of the app
with a stand-in engine (`tests/probes/generate-tab-probe.mjs`, 0
problems; no graphics card used):

- The Generate tab, to layout B: mark the area (Brush Over It, Select
  Subject, Whole Picture), say what to do there (an instruction box and
  four ready-made starts), pick a result (three tries as pictures, the
  chosen one laid on the photo, More Tries, Keep). A kept result is
  stored as a patch the way Remove stores one, so undo, the history,
  hiding and saving work on it already.
- The card shared: before a run the tab reads the card's free memory;
  with too little it shows the numbers and one button, Set The Chat
  Model Aside And Generate. Behind it the core has a new call for any
  tool, `parallx.lm.releaseLocalModels()`, only ever run on the user's
  own action.
- The set-up card for the engine, in the tab.

Run on his card on his word (2026-11-12, about 10 minutes of card time):

- The engine is set up on his machine, from the tab, in 3.5 minutes. The
  model and the packages the test had already downloaded were put where
  a stopped download would be, so the app checked each file's SHA-256
  and kept it instead of fetching 39 GB again. The set-up's test edit
  passed on the card.
- All seven test edits are done. The last two (a sunset sky on the hay
  bales, a blue sky at the airport) went through the tab itself: brushed,
  instructed, three tries each, one kept. Three tries took about 250 s:
  about 55 s before the first step (loading the model and reading the
  instruction), then 45 to 55 s generating and 13 to 26 s laying back
  for each try. Peak 19.1 GB.
- Setting the chat model aside works against his Ollama: the app's call
  unloaded gemma4:31b and the card went from 9.7 GB in use to 2.1 GB.
  The button that makes the call is checked with the stand-in engine.
- Pictures for his eyes: `data/generate-test/out/` (before above, after
  below, for every try) and `data/generate-test/out/in-the-app/`.

Built on the way: a set-up whose last step, the test edit, finds the
card in use no longer ends in an error. The tab says "One step left",
shows how much of the card is free, and offers Set The Chat Model Aside
And Finish. (His chat model is usually loaded when he would set this up.)

What the real edits showed, each a proposal, none built:

- A sky marked as a band is the wrong mark. In the blue-sky edit the top
  of the rock, which lay inside the band, came back lit orange while the
  rest of the rock stayed grey, and a line of haze shows where the band
  ended and old sky went on below it. The Masks tab already finds a sky
  (its Sky choice). Proposed: Change The Sky marks the sky by itself
  with that selector, so only sky is replaced and every other pixel stays
  the photo's own. Needs one run on the card to prove.
- Four minutes for three tries is slow where it need not be. The engine
  starts from nothing on every run (about 55 s) and laying a try back
  takes 13 to 26 s on the processor. Proposed: keep the engine loaded
  for a few minutes after a run, the way the document reader stays up,
  released at once when the chat needs the card; and a faster lay-back.
- The sky patch is made 2,048 pixels wide and stretched 4.2 times over
  the 32 MP photo. That is item 5 below; a sky hides it, a detailed area
  would not.
- Ollama can list a model as loaded while Windows has moved most of it
  off the card (seen: 9.7 GB in use with a 23 GB model listed). The tab
  reads free memory on the card, not Ollama's list, and that is the
  right measure.

Owed: his verdict on the results.

Left to build, in order:

5. The native-size patch for large fills (Enhance on the patch, grain
   matched) and the check with another try. Needs the card to prove.
6. Recipes: the photo's generated edits as a list; Render Again, Apply
   To Other Photos.
7. Beyond The Edges (extending the canvas). It is in layout B and is
   not in the tab yet: the editor has no notion of a picture larger
   than the photo, so it is its own piece of work.

Found on the way: `tests/probes/image-editor-probe.mjs` fails 34 checks
because it was written for the editor before the Masks tab (it expects
four tools and older control names). The editor itself was not the
cause in any check read. Bringing that probe up to date is owed.

*Voice (gated).*
1. The listening test on his card.
2. The chat's two new openings (something that fills the input,
   something that reads a reply).
3. In the chat's input: a mic to hold, a sign that it is listening, a
   sign that it is speaking with a way to stop. Mock-ups first.
4. Conversation: it knows when he has finished and when he cuts in.

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
text with boxes that click back to the spot on the page. Handwriting is
not a goal: it was never his ask (it came in with Indra's own claims),
and he questioned it on 2026-11-12. Printed scans and photos of pages
are the job. For him: scanned exam papers, the closing documents. For
another person: receipts into Budget, medical letters, warranties.

**Shape.** An extraction provider the indexing pipeline can prefer over
the Docling OCR pipeline for images and scanned PDFs, plus the box data
kept so a search hit can highlight the page. Measure against Docling's
OCR on his own scans before deciding it replaces anything.

**Research (2026-11-12, each model's own card, repository or licence
page read that day; licence quotes were clipped by the reader, so the
licence files are read in full before anything ships).**

- *All three named models exist.* Indra OCR 1.1 (Datalab), MiniCPM-OCR
  1.0 (OpenBMB), Xiaomi-OCR-0 (Xiaomi).
- *Docling already wraps most of the field.* Its releases of 3 to 8
  November added presets for Surya 2.5, MiniCPM-OCR 1.0, LightOnOCR-3,
  Unlimited-OCR 2 and Nemotron 3.5 Parse, so the heavy candidates can be
  measured inside the pipeline Parallx already runs.
- *Boxes.* No model gives a box per word. A box per line comes only
  from the classic engines (Indra, PP-OCR through RapidOCR, Surya's
  detector); the small vision models give a box per block, or none of
  their own. The open products read (Paperless-ngx, Recoll) write a
  hidden text layer and let the PDF viewer highlight; none keeps its own
  boxes.
- *Handwriting is the weakest-evidenced claim.* Only two publish a
  number: Indra 25.2% ("Handwritten pages read, but not well") and
  PP-OCRv6 about 58 to 61%. The rest claim it or say nothing. The entry
  above promised handwriting from Indra; its authors do not.
- *Licences.* Indra's weights: free for "research, personal use, and
  startups under $20M funding/revenue", not for a product that competes
  with Datalab's, and the restrictions must be passed on to every
  recipient. Surya ($5M) and Chandra ($2M) weights carry the same kind
  of cap. MiniCPM-OCR, Xiaomi-OCR-0, LightOnOCR-3, PP-OCRv6 and RapidOCR
  are Apache 2.0; dots.mocr and GLM-OCR are MIT.
- *The two public rankings disagree* (PaddleOCR-VL-1.6 is fifth on
  OmniDocBench and near the bottom of Datalab's OmniParseBench), which
  is the reason to measure on his own pages.

**Checked against the app (2026-11-12): the recommendation below was
made from the research alone and does not fit; this replaces it where
they differ. Claude's, his yes owed.**

- *What the app has.* Docling is not part of the app for everyone: it
  runs in the user's own Python after `pip install docling`
  (`electron/doclingBridge.cjs`, the Install Docling command), and
  without it extraction falls back to the legacy readers, which get
  nothing from a scan. Its bridge switches OCR on or off and nothing
  more. No page position is kept anywhere in the index today.
- *So "inside Docling, for everyone" was wrong.* A person with only
  pages and PDFs would have to install Python to read a scan.
- *The fit:* run PP-OCRv6's small ONNX models in the app's own model
  runner (`electron/modelBridge.cjs`: any extension, fetched once on a
  click, kept only if the hash matches, off the graphics card when
  idle). No Python, no Docling. Read Anything is an extension that
  registers as a reader for images and scanned PDFs through a
  contribution point on the indexing pipeline, which is still to be
  built. Docling stays as it is for those who have it.
- *The heavy tier is dropped for now.* MiniCPM-OCR through Ollama would
  be called from Docling's Python, past the engine broker
  (`modelEngineBroker.ts`: one loaded shape per engine, a chat turn
  never waits), and could push his chat model off the card. It comes
  back only if the light tier measurably fails on his pages, and then
  through the core's one route.
- *New work this needs:* the detect and recognise steps around the
  models, written for the runner; a place for each line's box in the
  index; the highlight in the PDF and image views.
- *To confirm first:* that the PP-OCRv6 ONNX files run in
  `onnxruntime-node` as shipped, and what PaddleOCR's own JavaScript
  SDK offers.

**Recommendation as first written (2026-11-12, superseded above).** Do not build a
second reading pipeline. Keep Docling and choose the engine inside it,
in two tiers:

- *For everyone, no GPU:* PP-OCRv6 through RapidOCR. Apache 2.0, already
  a Docling engine, Windows listed, and a box per line. Indra is passed over: its weights licence must be
  handed on to every user and its authors have not tested Windows.
  To confirm first: that RapidOCR can load the v6 models.
- *Optional, for a user with a GPU:* MiniCPM-OCR 1.0, for tables,
  formulas and hard pages. Apache 2.0, already a Docling preset, runs
  through Ollama, which the app already talks to. dots.mocr is the
  fallback only if MiniCPM's block boxes prove too coarse.
- *Click-back:* keep each line's box beside its text in the index, so a
  search hit highlights the line on the page (the block, on the heavy
  tier).
- *First step:* measure both tiers against today's Docling OCR on about
  twenty of his own pages (a clean scan, a phone photo, a table, a formula page). The published
  numbers chose the candidates; his pages decide.

**The wider shortlist the research gave:**

1. Light, CPU: Indra OCR 1.1. 76 MB, 6.2 pages a second on 4 cores as
   stated, Markdown with line and block boxes and reading order. Its
   authors have not tested Windows. If the weights licence is not
   acceptable, PP-OCRv6 through RapidOCR (Apache, already a Docling
   engine) takes this seat.
2. Heavy, permissive: MiniCPM-OCR 1.0. Apache 2.0, about 1.5 GB as an
   official GGUF with its projector, runs through Ollama or llama.cpp,
   1.2 pages a second on an RTX 5090 as stated, fourth on OmniDocBench.
   Block boxes come from a separate Paddle layout step.
3. Heavy, own boxes: dots.mocr. MIT, 3B, emits a box, a class and the
   text for every block itself; best text score among the permissive
   models on OmniParseBench.

**Second pass (2026-11-12), for his build.** His words: the app is
personal, never sold or published, so "no Python" and licence filters
were never his constraints; and he asked "Is read anything specifically
for indexing?" It was, only because Claude wrote it that way. Research
read that day:

- *Docling already has the right container.* Its document model keeps,
  for every item, the page and the box, and for every table cell its box
  and its place in the grid. Parallx's bridge asks Docling for Markdown
  and keeps none of that.
- *Readers for his card.* MiniCPM-OCR 1.0: 1.2 pages a second on an RTX
  5090 by its own card, a Docling preset since 8 November. MinerU2.5-Pro:
  runs on Windows as it is, 8 GB, tables 93.4 and formulas 97.5 on
  OmniDocBench. OXR-1.0 tops that table and needs 24 GB to start, so it
  cannot sit beside his chat model. On a harder set (DocParsingBench)
  every reader's tables fall to 75 to 80. None gives a box per word.
- *Asking a model for coordinates fails.* Open models that write a box
  for their evidence are right at most 8.1% of the time; having the
  model quote, then finding the quote in the parser's blocks, reaches 26
  to 47% (Aalto, July 2026, one run).
- *Showing the model the page helps a little.* On hard questions,
  answers from the page image beat answers from its text by 2.4 to 2.8
  points (ViDoRe V3 paper).
- *Searching page images is real, and dear.* The best open model that
  would fit (EVIE-4.5B) needs about 9 GB loaded for every search, and in
  the same paper a text search with a reranker scored above the best
  image search.

**Recommendation, second pass (Claude's; his yes owed).** Read a scan
once, into a structured document with a region for every element; the
index is one user of it among four.

- *Keep what Docling knows.* The bridge returns the document model, not
  only Markdown: text, tables as grids, formulas, figures, each with its
  page and box. Stored once per file.
- *A better reader inside Docling for scans:* MiniCPM-OCR 1.0, run in
  Docling's own process and not through Ollama, so his chat model is
  never unloaded for it. MinerU2.5-Pro is the one to compare it with on
  his pages.
- *Four users of the one result:* the index (text, with its boxes); the
  chat's Read tool, which gets the page image as well as the text, since
  his chat model can see and is already on the card; the viewer, where a
  hit or a citation lights up its block on the scan; and Open As Page,
  where a scanned table becomes a real table or worksheet and a formula
  an equation, each still linked to its place on the scan so a misread
  cell can be checked against the original.
- *Citations by quote, never by coordinates:* the chat quotes, the quote
  is found in the stored blocks, the block's box is what lights up. It
  extends the verified citations the app already has.
- *Set aside, with the reason:* searching page images (9 GB at every
  search for a few points; revisit if his library turns figure-heavy);
  model-written boxes (8%); OXR-1.0 (24 GB); a box per word (no reader
  has one; the block is the unit).
- *First step:* about twenty of his own scanned pages through Docling
  with MiniCPM-OCR and through MinerU2.5-Pro: the tables, the formulas,
  the boxes, the seconds per page, side by side for his eyes.

**Unknown, second pass.** Whether a Docling preset fills the document
model's boxes when a vision reader does the reading; how Docling runs
MiniCPM-OCR without Ollama on Windows; whether his chat model reads a
page image well.

**Unknown.** Windows support for Indra, MiniCPM-OCR and dots.mocr (none
of their pages say); VRAM for the small vision models; handwriting
quality of anything but Indra and PP-OCRv6; whether Docling exposes
word boxes from OCR; CPU time per page on an ordinary desktop.

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

**Research (2026-11-12, each model's own card, repository or licence
page read that day; the two rankings read from their own data).**

- *All three named models exist, and none is the pick.* Qwen3-ASR
  (Apache 2.0) needs a second model for word timings, five minutes at a
  time, and streams only through a Linux-style server. Qwen3-TTS (Apache
  2.0) was measured by a user slower than real time on an RTX 5090 under
  Windows in the official package (issue 89), has no streaming in that
  package, and both issues were closed "not planned". Breeze TTS 2 is
  BreezeBlue's, and its weights are "for research and non-commercial use
  only".
- *Listening.* On the Open ASR Leaderboard (data version 10-11-2026) the
  0.6B Parakeet models now beat Whisper: parakeet-tdt-0.6b-v3 7.04,
  whisper-large-v3 8.24, whisper-large-v3-turbo 8.75. Qwen3-ASR-1.7B is
  6.15; the best open model with timings and speakers built in, NVIDIA
  Nemotron 3.5 Transcribe (6.13), is 34B and will not share a card with
  a chat model.
- *Speaking.* The best-ranked open voices carry strings: Fish Audio
  Drama 3 (35B, free under $500k revenue), Breeze TTS 2 (non-commercial).
  Permissive ones: Kokoro-82M (Apache, runs without a GPU, fixed voices),
  Phonon 31M (Apache, English, 64 MB), VoxCPM2 (Apache, 2B, a voice from
  a written description, cloning, streaming, about 8 GB as stated),
  Ming-3.0-tts (MIT, 0.5B, three weeks old, tested on data-centre cards
  only), the MOSS-TTS family (Apache). Chatterbox was retired by its
  maker in August 2026.
- *Products.* Handy and Superwhisper both ship Parakeet for dictation:
  one shortcut, hold or toggle, the text lands where the cursor is.
  SillyTavern's character voices are a voice map: one voice per
  character from a list, "Only narrate quotes", a play button on each
  message. None of the documented flows makes a voice from a
  description.
- *Runtimes with no Python:* transcribe.cpp (MIT, JavaScript bindings,
  many listening models) and sherpa-onnx (Apache, a Node addon,
  listening and speaking).

**Recommendation (Claude's, 2026-11-12; his yes owed, and the gate
above still holds: this opens nothing).**

- *Scope, by his call (2026-11-12):* "I only care about AI chat for
  voice, not Creations AI characters." Voice is talking to the AI chat
  and hearing it answer. Character voices, voices made from a
  description and cloning are out, and with them VoxCPM2, Ming and the
  consent question. Dictating into a page and reading a page or a deck
  aloud are not asked for either.
- *Speaking to the chat:* Parakeet-TDT-0.6b-v3. Small enough to sit
  beside the chat model or run without a GPU, with punctuation. It is
  push to talk: he holds a key or the mic button, speaks, and the words
  land in the chat box. Words appearing as he speaks, or a hands-free
  conversation that knows when he has stopped, would add the same-size
  NVIDIA streaming model and a voice detector; not asked yet.
- *The chat answering aloud:* Kokoro-82M, off the GPU so it never
  competes with the chat model, speaking the reply sentence by sentence
  while it is still being written, with a way to stop it.
- *How it stays modular:* the chat is core and Voice is an extension, so
  the chat gains two generic contribution points (something that fills
  the input, something that reads a reply) and Voice registers into
  them. Turned off, the mic and the speaker button go.
- *Checked against the app (2026-11-12).* The chat's extension points
  today are tools, drop handlers and answer forms
  (`parallx.chat`); the two points above do not exist and are the first
  build. Both models are small ONNX files, so they belong in the app's
  own model runner (fetched on a click, by hash, no Python), not in a
  new engine. Neither touches Ollama, so the engine broker and his chat
  model are left alone. Kokoro has a JavaScript build (SillyTavern runs
  it in the browser); how Parakeet's decoding runs in the runner is to
  be checked before anything else.
- *Passed over:* the three named models, for the reasons above; Whisper
  (now behind Parakeet); every voice-design and cloning model.
- *First step, when he reopens Voice:* his ear. One chat answer read by
  Kokoro and by Phonon, and his own speech through Parakeet into the
  chat box.

**Second pass (2026-11-12), for his build.** His words: the app is
personal, never sold or published, so decisions are made for his
machine and any licence that allows personal use; and the answer is to
go past the easy one. The recommendation above (push to talk, a plain
reading voice) is the floor, not the aim. Research read that day:

- *Nobody has turn-taking solved.* TurnBench (2026-08-27): "No system
  is simultaneously fast, selective, and high-recall." Kyutai's semantic
  detector catches 77% of turn ends and 90% of interruptions; Pipecat's
  Smart Turn catches 75% of turn ends and 11% of interruptions.
- *No local stack publishes its delay on a consumer card,* and the open
  ones (Kyutai Unmute, LiveKit Agents, Pipecat) are Linux or WSL.
- *The best-sounding voice that fits is Breeze TTS 2,* and it fits
  badly. A user's figures on an RTX 4090: its fast path takes 17 to
  18 GB; its small build takes 5.3 GB and runs at about real time on an
  idle card; and "Sharing the GPU with another heavy job slows speech
  down 3 to 5x." Beside a chat model that is writing, it would stutter.
- *A list of his words helps recognition, if short.* Phrase boosting
  raised key-phrase scores from 42.5 to 70.4 in its paper (not measured
  on Parakeet v3); speech models given long lists get worse.
- *A spoken answer is a different text.* Listeners preferred answers
  written for the ear in 76.2% of comparisons (EMNLP 2024); OpenAI's
  voice guide: one or two short sentences, numbers read out, a short
  line before a tool runs.

**Recommendation, second pass (Claude's; his yes owed; the gate holds).**
A conversation with the chat in which only the voice touches the
graphics card:

- *Everything that listens runs on the processor:* Parakeet v3 (a
  ten-second turn in about a third of a second, on Windows as it is), a
  detector for "he has finished" and one for "he is interrupting". The
  card stays the chat model's.
- *It knows his words:* each turn the recogniser is handed a short list
  taken from the page that is open and the conversation so far.
- *It says a short answer and writes the full one:* the chat model
  writes the cited answer for the screen and one or two sentences for
  the ear, with marks for how to say them.
- *The voice speaks in one burst.* The short spoken text is made into
  sound in one go, when the chat model is not writing, then played. That
  is what lets the best voice (Breeze TTS 2) be used at all on a shared
  card; Kokoro on the processor is the voice when an answer should be
  spoken as it is written.
- *No headphones:* the microphone and the speech both run inside the
  app's window, where Chromium's echo canceller can hear both.
- *Push to talk always works,* because the detectors will be wrong
  sometimes.
- *First step, when he reopens Voice:* on his card, beside his loaded
  chat model, measure the delay from the end of his sentence to the
  first sound for each voice; then his ear on both.

**Unknown, second pass.** Whether he has or wants WSL (Breeze and most
voices are Linux only); the echo canceller with his speakers; whether
his chat model writes good speaking marks; every delay on a 5090.

**Unknown.** Which runtime carries Parakeet and Kokoro inside the app;
whether he wants push to talk only or a hands-free conversation.

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

**Research (2026-11-12, each model's own card, repository or licence
page read that day).**

- *Both named models exist, and neither is the pick.* Qwen-Image-2.1
  (7B, 2026-09-20) is licensed "for research or evaluation purposes
  only". Iris-3B is Apache 2.0, and nothing read claims it beats
  SeedVR2.
- *The best open editors are new and carry strings.* On the Artificial
  Analysis editing table (read 2026-11-12, no date shown; cloud models
  hold the top): MiniMax H3-Image 1138 (33B, and its licence excludes
  the US, EU, UK and Korea), Bria Fibo 2.0 1085 (non-commercial, and its
  prompts are written by a Gemini call, so not offline), Qwen-Image-2.1
  1084 (research only), FLUX 3 Image Klein 1069 (free under $5M revenue,
  gated, a clause on filtering or reviewing output; 26 GB stated at
  FP8). The Apache ones: Qwen-Image-Edit-2511 996 (20B), FLUX.2 klein 4B
  942 (about 13 GB).
- *None of the new leaders has a released hard mask.* FLUX 3 Klein's
  boxes "do not hard-constrain pixels". FLUX.1 Fill dev is the one
  dedicated mask model (non-commercial, gated; its authors state "slight
  colour shifts" outside the fill and lines at its edge).
- *No model works at 24 to 60 megapixels.* Every local editor read
  (Krita AI Diffusion, OpenFill for GIMP) crops a padded area around the
  mask, generates near 1 to 2 megapixels, and lays only the masked part
  back; OpenFill says large fills "come back softer".
- *Removal without a prompt:* LaMa (Apache 2.0, holds to about 2K) is
  what OpenFill and IOPaint ship; MI-GAN (MIT) has a ready ONNX file.
- *Runtime without ComfyUI:* diffusers has a pipeline for each;
  stable-diffusion.cpp (MIT, CUDA, Windows) lists nearly all of them and
  SeedVR2, but says nothing on masks.
- *Controls the open editors offer:* the operation (fill, remove,
  expand, edit), an optional prompt, strength, feather and blend of the
  mask edge, how much surrounding area the model sees, expand by
  dragging an edge or picking a ratio, variations, the result on a new
  layer. Adobe's pages refused the fetch and are unread.

**Recommendation (Claude's, 2026-11-12; his words on it the same day: "I think I am aligned." No go to build
yet).** Three tools in
one Generate step, each on Apache weights so the app can fetch them for
anyone:

- *Remove:* already in the editor (docs/IMAGE_EDITOR.md: LaMa, his
  choice of 2026-09-28, run by the app's model runner, each removal kept
  as a patch). The first write-up of this recommendation proposed
  building it; that was a miss, nothing is to be built. The Generate
  tools reuse its patches: a fill is a patch laid over the original.
- *Fill, Expand and Edit:* Qwen-Image-Edit-2511, one model for all
  three. It is the best-ranked Apache editor and diffusers has a mask
  pipeline for the Qwen edit line. A mask is honoured by construction:
  only the masked, feathered part of the crop is laid back, so nothing
  outside it can change whatever the model does. A large fill that comes
  back soft is passed through Enhance, which is already there.
- *How it enters the app:* as a tool runtime, the way Enhance does
  (`electron/runtimeBridge.cjs`): declared by the extension, set up once
  on a click, every file fetched by its hash, the machine checked
  first. It should share Enhance's PyTorch rather than install a second
  copy (3.6 GB); whether one runtime can hold both is to be checked.
- *The graphics card:* Enhance reads the free memory before a run and
  says so when there is too little. A 20B editor needs most of a 32 GB
  card, so with his chat model loaded it will not start. Generate needs
  the same check, and one button that frees the chat model, or it will
  feel broken.
- *FLUX 3 Image Klein is dropped.* Its files are gated behind a
  Hugging Face login, and the runtime fetches by hash with no login.
- *Passed over:* Qwen-Image-2.1 (research only), H3-Image (size,
  territory), Fibo 2.0 (needs Gemini), FLUX.1 Fill (non-commercial, and
  the crop and lay-back does its job), Iris-3B (no claim over SeedVR2;
  Enhance stays as it is).
- *First step:* ten edits on his photos through Qwen-Image-Edit-2511,
  run by hand outside the app, for his eyes, with its memory use and
  seconds per edit measured. Nothing is built on it before that.

**Second pass (2026-11-12), for his build.** His words: the app is
personal, never sold or published, so licence and login were never
filters; and the answer is to go past the easy one. The engine above
(Qwen-Image-Edit-2511) was chosen by licence and is replaced. Research
read that day:

- *The best engine his card runs today is Qwen-Image-2.1.* Quantised,
  its generator is about 7.2 GB beside an 8B encoder; one write-up
  measured about 5.5 seconds an edit on an RTX 5090, with 7 of 23 edits
  needing a second try. It produces up to about 4 megapixels. Its
  licence is "research or evaluation"; whether his own photos count is
  his call. FLUX 3 Image Klein produces up to 4K and takes 25 to 26 GB
  at 1 megapixel, Linux only so far. The model first recorded as
  "MiniMax H3-Image" is Pruna's P-H3-Image; its builds that fit 32 GB
  run in ComfyUI only.
- *No editor gives back the untouched pixels.* Plain Qwen-Image-2.1
  changes 12.8% of the pixels outside the edited object (a community
  add-on brings that to 7.5%), and the round trip through the model
  alone changes about 2%. Fidelity comes only from laying back the
  patch, which the editor already does for Remove.
- *The soft patch is everyone's problem, and nobody open has fixed it.*
  Adobe moved to 2K in January 2026; its own users still write
  "Resolution is too low" and name the mismatch of grain. Research
  (Patch-Adapter, Agent Banana, PixPerfect) shows the cure: structure at
  low resolution, the patch at full resolution, then a pass that fixes
  colour, seam and texture. No open tool restores a generated patch
  with an upscaler using the photo around it. No one has measured grain
  matching.
- *Checking and trying again pays; an elaborate agent does not.* The
  same editor with planning and checking gained 89 points in one arena;
  a NeurIPS 2026 study found a plain retry earns most of that. General
  vision models judge edits poorly by one judge-maker's account; a
  small open judge (EditScore, 4B) exists.
- *No product keeps an edit as a recipe* that a newer model can
  re-render, or re-finds the place to edit in each photo of a set.
- *Painter's studies are not a job for a generator.* A notan or a
  five-value study is arithmetic on the photo and redraws nothing; a
  relight can be kept as a map of brightness changes (PIXLRelight).

**Recommendation, second pass (Claude's; his yes owed).** A Generate
step whose result holds up at 100% on a 60 megapixel raw, which no
editor read does:

- *Engine:* Qwen-Image-2.1, quantised, in the Enhance runtime's Python.
  FLUX 3 Image Klein is the comparison, later, under WSL.
- *The patch is made at the photo's own size:* the area around the mask
  is cropped at native pixels and generated at up to 4 megapixels; a
  larger area is then rebuilt by Enhance (SeedVR2, already installed)
  with the surrounding photo in view; a last pass matches colour, seam
  and grain to the photo. Only the masked patch is laid back.
- *Every edit is checked, then tried again if it failed:* a measured
  check that the patch lines up and its edge matches, and a judge of
  whether it did what was asked (his chat model, or EditScore if his
  model judges poorly), picking the best of a few tries.
- *His chat model writes the long prompt* from his short instruction
  and the photo, as the engines' own makers advise.
- *An edit is kept as a recipe:* instruction, mask, seed, engine, crop.
  It can be re-rendered when a better engine arrives, and applied to a
  set of photos by re-finding the place in each, the way Remove From
  Other Photos does.
- *Set aside, with the reason:* Qwen-Image-Edit-2511 (lower ranked,
  larger); P-H3-Image (ComfyUI only); patches kept in the raw's linear
  light so they follow later exposure changes (no one has shown it, and
  an 8-bit patch holds nothing above white; first to check is where the
  editor applies patches relative to its exposure controls); painter's
  studies (they belong in Atelier as plain image arithmetic, not here).
- *First step, outside the app, on his photos:* ten edits through
  Qwen-Image-2.1; then three large fills taken through Enhance and the
  grain match, shown at 100% beside the plain result. That one
  experiment says whether the native-size patch is real.

**Unknown, second pass.** How Qwen-Image-2.1 takes a mask (its makers
show the mask passed as a second picture; the proper mask code is an
unmerged change to diffusers); its memory on a 5090 beside his chat
model; whether SeedVR2 on a patch invents texture of its own.

**Unknown.** Whether the mask pipeline loads the 2511 weights; VRAM and
seconds per edit for Qwen-Image-Edit-2511 at a quantised size; whether
an instruction editor extends a canvas well (Expand) or FLUX.1 Fill is
needed for that one job; which runtime (diffusers in the app's Python,
or stable-diffusion.cpp); Windows for each. ComfyUI stays off the table
(decided earlier, do not re-raise).

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
