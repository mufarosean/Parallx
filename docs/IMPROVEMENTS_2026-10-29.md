# Improvements we have wanted: one list (2026-10-29)

Everything still open that came up in the docs and in our sessions since
mid-August, in one place. Sources:

- the repo's planning and audit docs (`IDEAS_2026-10-23`, `RESEARCH_2026-10-25`,
  `FINISH_PLAN_2026-10-11`, `APP_AUDIT_2026-10-03`, `MODULARITY_AUDIT`, the
  brief and audit docs they point to);
- the cloud and VS Code session transcripts from 2026-08-19 to 2026-10-28;
- this session (2026-10-25 to 10-29).

Status is checked against `dev` where a quick look could settle it. Done items
are left out; a few that shipped this week are listed at the end so they do
not get asked for again. Short source tags: **IDEAS** = `IDEAS_2026-10-23`,
**RESEARCH** = `RESEARCH_2026-10-25`, **FINISH** = `FINISH_PLAN_2026-10-11`,
**APP** = `APP_AUDIT_2026-10-03`; sessions by title and date.

---

## What you asked for most (and is still open)

1. **Chat that keeps up with Claude Code: the right tools and facts at the right time.**
   Done, waiting on a test with your local model:
   - Tool schemas load on demand. Core read/write tools are always loaded;
     the rest are named in one `tool_search` catalog and join the request
     once asked for, and stay for the rest of that chat. Per call, the tools
     cost about a quarter of what they did. Setting: AI settings, Tools,
     `tools.loadOnDemand` (on by default).
   - The prompt says so when it teaches a tool that is not loaded yet, so the
     model loads it rather than saying it cannot.
   Already true when checked (nothing to build):
   - Search tools: the six are now five (`fs_search_knowledge` went into
     `fs_grep_search`). Each one searches a different thing (file names, file
     and document contents, canvas pages, memory, past chats) and points to
     the others; only the first four are always loaded.
   - Link tools: the three do different jobs (a checked citation link, a link
     between two blocks, nesting pages under a hub). Merging would make one
     tool with three modes, which small models pick worse.
   - Skills: the prompt carries only each skill's name, description and
     location; the body is read when one applies.
   - Standing context (plan, retrieved passages, memories) comes after the
     history, so the history stays cached; the clock and scene ride on the
     latest message only.
   - "What changed since your last turn" is sent each turn.

2. **Answers grounded in your own material, with no invention.**
   Done, waiting on a test with your local model:
   - A relevance floor: a passage reaches the AI only when its meaning is
     close enough to the question (cosine similarity, AI Settings, Retrieval,
     `retrieval.minRelevance`, default 0.5). Keyword hits are measured the
     same way, so "nothing in your material covers this" can now happen. The
     relevance the AI sees next to each passage is that similarity, not a
     rank score.
   - One threshold. The old ones were a floor on rank scores that never pass
     0.04; the 0.3 that config.json and the settings page carried retrieved
     nothing at all. They are gone, and memory recall uses the same floor.
   - Keyword search needs every word of the question; the OR fallback is gone.
   - The embedding model stays loaded 30 minutes, like the chat model.
   - To tune: the retrieval trace records the best similarity of each search
     (`bestSimilarity`). If good passages are missed, lower the floor; if
     off-topic ones get through, raise it. 0.5 is a starting point for
     nomic-embed-text, not a measured one.
   Already there: chunks carry their PDF page ("PDF page: page 13 of 30");
   `fs_read_file` with `query` and `fs_grep_search` show whole source blocks
   around a hit (a whole PDF page, a whole Markdown section up to 60 lines),
   read from the file as it is now; citations are checked labels that link to
   the spot.
   Waiting on you: a newer embedding model (qwen3-embedding 0.6B or bge-m3).
   It means downloading the model and re-indexing every workspace (both are
   1024-wide, so the index is rebuilt), and the floor above has to be set
   again for it.

   Raised: Mindmap print calibration (Oct 23), Backlog review (Aug 29), IDEAS.
3. **No hidden limits.** Audited on Oct 29: every place a context window, an
   output limit or a model is chosen. Fixed:
   - Auto ran the first turn after launch or a model switch at 8K (the 8K
     cap from Oct 4, still live in the main chat), and every turn on a
     Claude model;
   - a routine's Context was capped by the chat on screen;
   - any settings change reset the chat's picked size;
   - a call naming no size inherited the last size of any call to any model
     (a 2K marking call shrank the next inline-AI call);
   - a reply cut off at the length limit read as finished: it now says so,
     and the background output cap is 16K;
   - a run set to an uninstalled model ran on the chat's model unseen.
   Waiting on you:
   - Creations' Acts panel caps its planner at 1800 and 600 output tokens
     with thinking on, so a reasoning model can spend it all thinking. A
     Creations model call, so yours to change (add 4096 to each).
   - The model's length is read generously: qwen3:8b declares 40,960 but is
     listed at 128K (from its RoPE base), so Auto can ask past what the model
     was trained on. Prefer the declared length, or keep the larger one?

4. **The UI must not look made by AI.**
   Done (Oct 29):
   - Word-only buttons: icons across Agents, chat permissions, canvas trash,
     notifications, Worksheets, answer forms and Atelier's editors; the
     routine editor's Enable/Disable became an On switch. The rule is in the
     authoring guide (6.3) and `wordButtonRatchet.test.ts` holds the count:
     79 left (Atelier plans, Study, Budget), and it can only fall.
   - The routine editor no longer opens zoomed far out.
   - Welcome lost its developer rows (/init, .parallx/).
   - Already fixed since the Oct 1 audit: chat without Ollama shows a setup
     state with a way forward; the right bar holds Chat and Agents.
   Waiting on you (layout decisions, best mocked first):
   - Settings has nine AI pages and four Agents pages. Merge them (e.g.
     Model with Providers, Retrieval with Indexing)?
   - The Tools sidebar's length, and navigation repeated between a tool's
     sidebar and its editor.
   - A task-based usability audit (needs you at the keyboard).

   Raised: Good UI (Sep 1), Claude design app improvement (Oct 1), this session (Oct 28).
5. **Test with your real model before calling an AI feature done.** Act in
   Creations has never run on a real model: its planner call has no reasoning
   budget and drops thinking chunks. This waits on you picking the model and
   allowing GPU use.
   Raised: Act test (Oct 24), the Oct 4 regression.
6. **The AI's voice.** Workspaces sound bland and alike. Proposed:
   - a real default voice;
   - one personal default;
   - a Voice section in AI Settings, with versions and a preview;
   - a propose-only "shape the voice" skill.

   The open questions were never answered.
   Raised: Colour 560 (Oct 16), System prompt (Oct 20). Not built.
7. **Study that fits how you study.** Checked against the two sessions they
   came from (Exam 7 workspace, Oct 22 and 23; Flashcard artifact, Oct 24 to
   27). Most are in the app already:
   - Mark a problem to return to: Worksheets has Mark For Later and Next
     Marked; Flashcards has flags, with a flag filter in custom study.
   - Previous: Worksheets' quiz and review have Previous Problem. Flashcards
     has Undo (Z), which takes the grade back and returns to that card.
   - Cards that look like the app's: the artifact copied the app's own card.
   - The AI edits a card with your approval: Flashcards' chat tool edits
     cards and asks you to confirm each change.
   - Tables that never scroll: done in Flashcards (Oct 29). A table fills the
     card and keeps words whole; one too wide is scaled to fit.
   Waiting on you:
   - Flashcards Previous without undoing: look back at the last card, its
     answer shown, without taking back its grade (the artifact's way)?
   - Study notes: "a way to tell the ai to write a note", kept in one list
     for making cards later. Flashcards drafts a card's own notes with AI;
     a separate list of study notes is not in the app. Where should it live?
   - Custom quiz types (answers that are lists): asked for the Concept Quiz,
     which is your canvas database and skill, not an app surface.

8. **Memory you can see and correct.** Built Oct 29 on the brief's
   recommended answers (docs/MEMORY_BRIEF.md: files stay the truth, the view
   sits beside Mind, nothing is hard-deleted):
   - every lesson records the chat and day it came from;
   - Agents › Mind › What it has written down: each lesson, where it came
     from, Open, Wrong (archives it and tells the agent) and Archive;
   - Do Not Remember This on a reply's right-click menu: the exchange stays
     in the chat, the chat is never summarised into memory, and the model is
     told not to record it;
   - a Tidy Memory routine in Agents › Routines (installed off): promote
     recurring facts, merge duplicates, archive stale lessons.
   Open: the memory token meter in the chat header, and checkpointing
   memory writes. Brief decisions D1 to D5 were taken as recommended; say
   if any should go the other way.

9. **The AI writes its own skills, held for your approval.** "We do need a
   self-authoring for skills system." Built Oct 29 (docs/SKILL_AUTHORING_BRIEF.md
   steps 1 and 2, on its recommended answers K1 and K3):
   - the AI's `skill_draft` tool writes a draft into .parallx/skills/_drafts,
     marked as the agent's and from which chat; the loader never loads a draft;
   - Agents › Mind › Skills it has drafted: Review, Add (it becomes a skill
     the AI can use), Dismiss (to the trash). The AI never adds its own.
   Open: drafting by itself after a long task (step 3), logging how a skill
   did and proposing fixes as drafts (step 4).

10. **An app that knows itself, and builds itself.**
    - A registry of what is on, activation telemetry, self-diagnosis.
    - Later: the AI notices repeated asks and builds a mini-app or extension for them.

    Raised: Study this card (Aug 25), AI chat rich output (Oct 17), Bad ideas (Sep 5).
    Mini-apps shipped; the rest is open.

---

## By area

### AI, chat and retrieval
- **Chat speed bundle.** Every turn would feel these:
  - one embedding per turn, not two;
  - RAG on as soon as the index has rows;
  - sessions saved by upsert, not delete-and-reinsert;
  - Active Rules moved out of the system prompt so the cache holds.

  Source: IDEAS, FINISH E, APP 2.3. Done Oct 29 (all four). Found on the
  way: renaming a chat before opening it deleted its messages; fixed.
- **One model-call ledger** (who called, tokens, cache reads, timings): AI
  quality becomes numbers. IDEAS. Open.
- **PDF Ask sees the whole page**, with the file name and retrieval limited to
  that file; it got only the selected sentence. IDEAS. Done Oct 30: Ask on a
  highlight gets the file name, the page number, the whole page (cut around
  the passage past 8,000 characters) and the passages of the same file that
  bear on the question, and is told to say when the paper does not answer.
  Not tried on a real model here (no Ollama in the cloud container).
- **Find in Files reads PDF, Word and Excel.** IDEAS. Done Oct 29: documents
  are searched through the same text extraction the AI uses, a PDF's matches
  say and open their page; each document is read again only when it changes.
- **Modern local model defaults chosen by GPU memory** (today a 2024 32B model).
  RESEARCH #2. Open.
- **Warn when a context size leaves too little GPU memory.** Mindmap (Sep 15).
  Offered.
- **Cut Claude API spend:**
  - the cache split logged per feature;
  - a setting for which model runs background jobs;
  - effort levels;
  - a 1-hour cache.

  Source: System prompt (Oct 20). Proposed.
- **System-prompt rework:**
  - a fixed "what Parallx is" section;
  - one short default SOUL.md;
  - prompt files capped at 60K;
  - a capped skills list;
  - `/init` as a short interview.

  Source: Oct 20. Parked.
- **Chats named by the model**, not by the first 47 characters. IDEAS. Done
  Oct 30: after a chat's first answer its own model writes a 2-to-6-word
  name in the background (waiting while you chat); a chat keeps its first
  words until then, and keeps them if the model cannot answer. Routines'
  and heartbeats' runs are not renamed. Setting `chat.nameWithModel` (on).
  Not tried on a real model here.
- **`api.ai.runTask`:** one task call, parser and watchdog for every tool's AI
  work, then move Flashcards, Worksheets, Atelier tagging and Budget onto it.
  The generic `api.ai.embed` hook for extensions is the same idea (Creations
  RAG needs it). FINISH B, APP, Oct 24. Open.
- **JSON schema instead of `format:'json'`** (10 callers). RESEARCH #5. Open.
- **Claude provider options:** effort per task, refusal handling, context
  editing, the model list from the API. RESEARCH #4, IDEAS. Open.
- **A generic OpenAI-compatible provider.** RESEARCH #14. Open.
- **Reasoning-effort control** in chat. Roleplay (Sep 15). Deferred by you.
- **Evals:** a chat eval suite runnable on Claude, a judge, a retrieval golden
  set (recall@10). IDEAS, RESEARCH #8. Open.
- **Index enrichment:** a situating note per chunk, an abstract per file, an
  outline for PDFs that have none, in-process ONNX embeddings, a reranker.
  IDEAS, RESEARCH #9. Open.
- **Selection actions on EPUB, Word and Excel; highlights across every paper.**
  IDEAS. Open.
- **AI edits arrive as proposals everywhere; untrusted content cannot drive
  actions.** RESEARCH #11/#12. Partly done.
- **MCP:**
  - current spec (Streamable HTTP, OAuth, `mcp.json` import, per-tool toggles);
  - Parallx as a read-only MCP server.

  Source: FINISH D. Open (stdio only).
- **Stop the edit tool writing text over binary files** (it corrupted a
  workbook). Practice workbook (Sep 5). Done Oct 29: fs_edit_file and
  fs_write_file refuse Word, Excel, PDF, slides, images and archives (and any
  file read as an extracted document), and say to write a new text file.

### Agents, heartbeat and routines
- **Heartbeat notices page edits**, not only source files. IDEAS. Open.
- **Standing watches shown in Routines** (they live only in
  `.parallx/HEARTBEAT.md`). IDEAS. Open.
- **Watch a routine run as it streams.** IDEAS. Open.
- **Routines start with the day's facts**, from sources tools register. IDEAS. Open.
- **A fully headless heartbeat** for when chat was never opened. HEARTBEAT. Open.
- **The AI drafts workflows from habits it notices**, for your approval. Bad
  ideas (Sep 5). Suggested workflows shipped; drafting is open.
- **Named agents:** a Team tab, an editor, hand-offs, per-agent memory.
  AGENTS_PROPOSAL. Open.
- **Per-routine "ask me first".** MOTION_AND_AGENTS. Open.
- **Step editor:** the graph opens zoomed far out, and Preview Compiled Prompt
  and Delete Node are word-only buttons. Done Oct 29 (icons, an On switch, a
  fit once the editor has its size).
- **One "what the AI did" timeline and one stop switch** across Activity,
  Autonomy and Indexing. RESEARCH #10. Open.

### Canvas
- **Paste Markdown as blocks.** IDEAS. Done Oct 29: Markdown copied as plain
  text (a chat's Copy button, a .md file, a code editor) pastes as headings,
  lists, tables and formatting; a rich copy and a paste into code stay as they were.
- **Images stored as files, not base64.** IDEAS. Done Oct 30: a pasted,
  dropped or uploaded picture is written once to the workspace's
  `.parallx/media/<hash>.<ext>` and the page keeps a short
  `parallx-media://workspace/…` link, served from the open workspace (so it
  moves with the folder) and printed by PDF export; Export With Sub-Pages
  puts the pictures in the .zip's `media/`. SVGs, a page with no workspace
  folder, or a failed write keep the data URL as before. Pages written
  before keep their data URLs (they still show); nothing converts them yet.
  Stored files are never deleted with a page (its trash and history still
  show them). Found on the way: the AI's page-cover tool got the workspace
  root as a `file://` URI, so a cover from a workspace path could not be
  read; it gets the path now.
- **Export a page with its sub-pages, and the whole workspace.** IDEAS. Done
  Oct 30: page menu › Export › Markdown With Sub-Pages…, the sidebar's page
  menu › Export With Sub-Pages…, and Canvas: Export All Pages as Markdown…
  in the palette. One .zip: `Name.md` beside a `Name/` folder of its
  sub-pages; sub-page blocks and links between exported pages point at their
  files (Obsidian reads it); each file still reads back into a page.
- **Backlinks count both link formats.** IDEAS. Done Oct 29, with two bugs
  found on the way: a parallx:// link (what the chat and its citations write)
  lost its target in a page, and clicking one said "only http links".
- **Slash menu leads with text**, with mid-line `/` and aliases. IDEAS. Partly done.
- **Page chrome contribution points:** badges, a Connections panel, a page menu
  location. FINISH C. Partly done.
- **One AI on a selection:** retire the inline mini-chat. FINISH B. Open.
- **A wiki the AI keeps current from your sources.** Oct 24. Idea.
- **Mind maps:**
  - open in their own tab with pan and zoom;
  - collapse and expand branches;
  - "expand this node" with AI;
  - export as PNG or PDF;
  - shape checks for logical maps.

  Source: Mindmap (Sep 15), Good UI (Sep 1). Deferred.
- **Database depth:** relation, formula and status properties; gallery,
  calendar and list views; CSV import and export. CANVAS_ASSESSMENT. Open.
- **Database dates in the app time zone.** You parked it on Oct 4.
- **Architecture:**
  - `canvasDataService` is still 3,045 lines;
  - the page hierarchy is stored twice;
  - there are five document-to-text converters.

  Source: CANVAS_ASSESSMENT. Open.
- **Ctrl+N makes a New Page?** Oct 1. Your decision.

### Planner and Dashboard
- **Planner reminders on the one scheduler** (the cron clock). REFACTOR_AUDIT. Open.
- **Planner Calendars menu and the repeat-scope dialog** still use the old
  hand-built styles; in the event dialog, the Ends row does not line up with
  Starts. The alignment is fixed (Oct 29: All day has its own line, time
  fields fit "10:00 AM"); the two dialogs read cleanly and pass the keyboard
  audit, so their rebuild is low priority.
- **Navigation in both the sidebar and the editor** (Planner, Flashcards):
  pick one. Oct 1. Your decision.
- **Dashboard shows four controls before anything is added.** Oct 1. Done
  Oct 30: an empty page shows the kit's empty state with one Add Widget and
  no header buttons at all (the lone chevron went too); the title no longer
  turns accent on hover (it failed contrast in light themes), it underlines.
- **Dragging widgets out of a dashboard; merging arrangements.** Backlog
  review (Aug 29). Unclear.

### Atelier
- **Native image generation**, not ComfyUI. Oct 23. Deferred ("resurface later").
- **Enhance stitches tiles out of order**, with CPU and GPU see-sawing. Oct 16.
  Not found yet; reproducing it needs a GPU run.
- **Folder rows:** Rescan, Show in Folder, Remove From Library (a folder cannot
  be removed today). MEDIA_ORGANIZER_AUDIT. Done Oct 30: a folder row's
  right-click menu has Open, Rescan, Show in Folder and Remove From
  Library…, which asks with the file count, takes the folder's items out of
  the library (files on disk untouched), stops watching it if it is a
  watched folder, or keeps it out of later scans if it is inside one. Add
  Folder… on it brings it back.
- **One Duplicates page; albums as a library scope; menus in one order.**
  MEDIA_ORGANIZER_AUDIT. Open.
- **Search photos by what is in them** (CLIP). IDEAS. Open.
- **Masks by light and colour range; name the masses with AI; paint mixes from
  measured pigments.** IDEAS. Open.
- **Upscale loads its engine once per batch.** IDEAS. Open.
- **Clips code split out of `main.js` and loaded on demand.** IDEAS. Open.
- **The image-pull script as an extension with a UI.** Sep 18 idea. Open.
- **Eraser leftovers:** the 30-day trash purge leaves files on disk;
  thumbnails are deleted without Eraser. Roleplay (Sep 15). Your decision.
- **Combine several photos into one painting plan; smart albums as a practice
  pool.** Browser_agent (Sep 13). Not built.

### Budget
- **Confirm before sync**, showing the email count. BUDGET_REVIEW, IDEAS. Done
  Oct 30 for Sync Now and Run First Sync: once Gmail's list is in, it asks
  "N new emails … <model> reads each one", Sync N Emails or Cancel; Cancel
  reads nothing and leaves the last-sync time as it was; nothing new, no
  question. The chat tool `budget.runSync` still runs without asking (the
  chat's own tool permission covers it, and a routine has nobody to ask).
- **The categorizer sees your past choices.** IDEAS. Open.
- **Sync in the background lane.** IDEAS, FINISH B. Open.
- **Pending to posted updates one row; counterparty accounts for transfers;
  issuer presets; a monthly amount per goal.** BUDGET_REVIEW and REDESIGN. Open.
- **The Gmail filter defaults to your bank.** Oct 1. Your decision.

### Browser and Web Research
- **Clip from the browser into a page.** IDEAS. Open.
- **Web search without an API key** (a DuckDuckGo fallback). IDEAS. Open.
- **Save-for-later inbox.** GitHub_Landscape. Open.
- **The browser agent benchmarked on Claude and on local models; a Choose File
  control for uploads; a redirect check on every download hop.**
  BROWSER_AGENT reviews. Open.
- **The AI adds items to a store cart, built generically.** Google token (Aug 21). Unclear.

### Creations
(Your rule: Creations AI's prompts and model calls are not changed without you.)
- **Act on a real model** (see the top list, item 5).
- **Regenerating one box honours the boxes you edited.** Oct 8. Fix designed, deferred.
- **World state kept in data, the model only narrating; adventure-tuned
  models.** Oct 24. Idea.
- **The AI writes the lorebook from a guide.** Oct 9 and 16. Not built.
- **Lorebook matching by meaning** (needs `api.ai.embed`). CREATIONS_AI. Open.
- **Proposals shown as a kept, changed and added diff; a consistency check
  against Facts.** CREATIONS_AI. Open.
- **Directions card says who is missing and why.** HANDOFF. Offered.
- **The roleplay writing guide** (dialogue, no abstractions, never write your
  character). You copied it on Sep 15; it is not in the app.
- **`build-character` skill; Atelier photos by id.** On hold (yours).

### Study, Worksheets, Flashcards, Concept Lab
- The quiz and flashcard features (see the top list, item 7).
- **Build a question bank unattended** from a long manual. IDEAS. Open.
- **Variants of a problem with fresh numbers; verify generated items before
  they land.** IDEAS. Open.
- **Edit or regenerate a question; discuss a question in Chat; a "Stuck?"
  nudge before the reveal.** IDEAS. Open.
- **Audit the bank with a stronger model; calibrate the typed-answer grader;
  rubrics for a deck in one pass.** IDEAS. Open.
- **A recall forecast for exam day per deck; FSRS fitted to your own
  reviews.** IDEAS, RESEARCH. Open.
- **Change a card's type through the AI.** Mindmap (Sep 14). Not covered.
- **Lesson Builder:** material turned into lessons (OpenMAIC style). You
  called it "what I actually need" (Sep 5). Brief only.
- **Concept Lab home:** Continue first, then the ladder. IDEAS. Done Oct 30:
  the module you were last in comes first, with its step and Resume; each
  module card says where it stands ("Step 3 of 9, 1 of 2 predictions
  answered", or Done with a check); the step and answers are kept with the
  workspace, so they survive a restart and Resume lands on that step. The
  heavy 01 to 07 became "Level 1: …"; the six tips moved, in sentence case,
  into a closed "How the lab works" after the ladder.
- **Flashcards on by default?** Oct 1. Your decision.

### Workbench and design system
- **A first run that asks three things:** what for, which tools, which AI.
  FINISH F1 and four others. Open.
- **Kit gaps:**
  - card and stat tiles;
  - a dialog or side sheet;
  - an Undo toast;
  - a colour picker;
  - a Kit Gallery page with screenshot baselines.

  Source: FINISH A. Open.
- **Old size variables** (`--parallx-fontSize`, `--parallx-radius`, about 400
  uses) moved onto `--px-*`. FINISH A. Open.
- **Settings, Chat (about 50 hand-built buttons), Flashcards and Worksheets
  onto the kit.** FINISH F. Partly done.
- **Explorer:** how files should look (your question from Oct 25, still
  open). This session.
- **The Tools page as cards with categories; the empty editor shows Start;
  Ctrl+P finds settings, tools and themes.** IDEAS. Open.
- **Activity bar redesign:** 7 mockups, none chosen. Oct 17.
- **Version number:** the shell says 0.2.0, `package.json` says 0.1.0. APP.
  Done Oct 29: the shell is package.json's version, held by a test.
- **Twenty shipped themes, contrast-checked.** IDEAS. Open.

### Accessibility
- **A real listen-through with NVDA or Narrator.** ACCESSIBILITY ("still the
  owner's"). Open. The Orca cloud run (Oct 13 to 16) result is unclear.

### Platform, performance and architecture
- **Electron 40 is out of support:** move to a supported line. RESEARCH #3. Open.
- **Startup:**
  - Atelier, Browser, Flashcards and Web Research start on `*`;
  - the boot overlay should lift after Chat;
  - built-ins should load as lazy chunks;
  - three database round trips per unchanged file on relaunch.

  Source: APP 2.3, FINISH E. Open.
- **Indexing in a utility process; one SQLite worker.** RESEARCH #7, APP. Partly done.
- **Crash dumps, Copy Diagnostics, timing budgets.** RESEARCH. Open. Long
  probe runs here hit an intermittent Electron crash (this session); untraced.
- **An embedding call every 30 seconds from an unknown source.** Mindmap
  (Sep 15). Not traced (needs your setup). Since Oct 29 a question asked
  again (a dashboard saved query, say) reuses its vector instead of calling
  Ollama, which removes one likely cause.
- **The GPU driver reset that crashed the whole PC.** Mindmap (Sep 15).
  Suggestions made; unclear.
- **Splits:**
  - `electron/main.cjs` into `ipc/*`;
  - chat `activate()`;
  - the workbench boot phases;
  - extensions as real modules.

  Source: REFACTOR_HANDOFF. Open.
- **Signing, auto-update, a cross-platform pass; portable USB packaging.**
  RESEARCH; Study this card (Aug 25, "some other time").

### Pet and delight
- **The Parallx pet:** designed in `PET_DESIGN_2026-10-25.md`, not built. Your
  three questions are open:
  - a status bar walker only, or a dashboard habitat too;
  - which animals;
  - naming.
- **The heartbeat-driven character widget** (Aug 26) ended with no art
  approach you liked. Sprite sheets were the last suggestion.

---

## Waiting on a decision from you

- Act testing: which local model, and when the GPU can be used.
- The AI voice questions (default voice, personal voice, a Voice settings section).
- Ctrl+N for New Page.
- Navigation in the sidebar or in the editor (Planner, Flashcards).
- Flashcards on by default.
- The Gmail filter default.
- Eraser leftovers: the trash purge and thumbnails.
- How Explorer files should look.
- The pet's three questions.
- The activity bar mockups.
- Whether to run the task-based usability audit.

## Decided against (so they do not come back)

- Curved mind-map connectors; the pin, red rule and tape on cards.
- The 42 "fun extension" ideas: Sky module, Studio, Slow Reveal, Squint Glass,
  Glass Palette, Speedpaint, Cast and the night-desk trio ("all bad ideas").
  The first 14 ComfyUI-scale ideas, too.
- The paid Rive editor and hand-drawn SVG for the character widget.
- Ollama KV-cache quantisation (reverted).
- Lowering the 160K context to stop crashes.
- The recording countdown on by default.
- Planner tasks pulled into the timer automatically.
- Hiding transcripts from search.
- The four-level autonomy dial.
- A prescriptive Voice for Creations ("keep voice general").
- Editing a direction before sending it.
- Dedicated RAG per Creations chat (for now).
- The money-per-question incentive.
- An HS2-style character creator ("just an idea").

## Shipped this week (do not ask for again)

- **Planner:**
  - Today's schedule is a true time grid;
  - the Overdue count opens every overdue task;
  - the task and event dialogs are rebuilt, with the app's own date and time fields;
  - New Event opens one dialog.
- **Background runs:**
  - they finish instead of being paused into a 15-minute failure;
  - routines and scheduled jobs are read back after a restart.
- **Flashing:** the dashboard and Agents panel no longer rebuild on every change.
- **Ribbon:** it follows what is on, and hidden icons are per workspace.
- **Sidebars:** every More Actions menu does something.
- **Menus:** three sizes.
- **Text areas:** they grow instead of having a resize handle.
- **Agents:** runs show their names, with switches instead of word buttons.
- **Canvas:**
  - the breadcrumb border;
  - the page menu;
  - Trash;
  - version history;
  - covers from Atelier.
- **Notifications:** moved to the ribbon.
- **Explorer:** multi-select and Properties.
- **Atelier:** Preview Render keeps the clip playing.
- **Creations:** loads again (an import cycle from a file split).

## Not read

Three sessions have no stored events (Oct 14 and 15, Oct 25, Oct 28: VS Code
sessions kept only on your machine). Several long sessions were read only from
their later turns; their opening requests may hold more.
