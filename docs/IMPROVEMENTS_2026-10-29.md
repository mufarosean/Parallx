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
3. **No hidden limits.** The 8K Auto context cap was found on Oct 4 and its fix
   was still in progress when that session ended. Study was capped at 64K and the
   context pill went stale (both fixed). Check that nothing else caps context
   or models silently.
   Raised: Light mode (Oct 4), Branch check (Oct 7), Oct 16 and 20. Unclear: the 8K fix.
4. **The UI must not look made by AI.**
   - Word-only buttons and poor icons, across surfaces. The Agents, Browser
     and Planner dialogs are done; a sweep of the rest is open.
   - Cluttered screens from the Oct 1 usability audit (still open):
     - cryptic chat composer controls;
     - jargon on Welcome;
     - 20 entries in the Tools sidebar;
     - about 20 AI pages in Settings;
     - navigation duplicated between sidebar and editor;
     - a right activity bar holding only Chat.
   - A task-based usability audit was proposed, not run.

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
7. **Study that fits how you study.** These were built only in claude.ai
   artifacts and are not in the app yet:
   - mark a problem to return to;
   - a Previous button;
   - tell the AI to write a note;
   - custom quiz types (answers that are lists);
   - the AI edits a card with your approval;
   - cards that look like the app's;
   - tables that never scroll.

   Raised: Exam 7 workspace (Oct 22 and 23), Flashcard artifact (Oct 24 to 27).
8. **Memory you can see and correct.**
   - A Memory tab showing where each lesson came from.
   - "Do Not Remember This".
   - Nightly consolidation.
   - Checkpoint memory writes too.

   Raised: Bad ideas (Sep 5), Good UI (Sep 2), IDEAS. Brief written; open.
9. **The AI writes its own skills, held for your approval.** "We do need a
   self-authoring for skills system."
   Raised: Bad ideas (Sep 5), IDEAS. Brief written; open.
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

  Source: IDEAS, FINISH E, APP 2.3. Open.
- **One model-call ledger** (who called, tokens, cache reads, timings): AI
  quality becomes numbers. IDEAS. Open.
- **PDF Ask sees the whole page**, with the file name and retrieval limited to
  that file; today it gets only the selected sentence. IDEAS. Open.
- **Find in Files reads PDF, Word and Excel.** IDEAS. Open (`.pdf` still binary).
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
- **Chats named by the model**, not by the first 47 characters. IDEAS. Open.
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
  workbook). Practice workbook (Sep 5). Unclear.

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
  and Delete Node are word-only buttons. This session. Open.
- **One "what the AI did" timeline and one stop switch** across Activity,
  Autonomy and Indexing. RESEARCH #10. Open.

### Canvas
- **Paste Markdown as blocks.** IDEAS. Open (a daily hand-fix).
- **Images stored as files, not base64.** IDEAS. Open.
- **Export a page with its sub-pages, and the whole workspace.** IDEAS. Open.
- **Backlinks count both link formats.** IDEAS. Open.
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
  Starts. This session. Open.
- **Navigation in both the sidebar and the editor** (Planner, Flashcards):
  pick one. Oct 1. Your decision.
- **Dashboard shows four controls before anything is added.** Oct 1. Open.
- **Dragging widgets out of a dashboard; merging arrangements.** Backlog
  review (Aug 29). Unclear.

### Atelier
- **Native image generation**, not ComfyUI. Oct 23. Deferred ("resurface later").
- **Enhance stitches tiles out of order**, with CPU and GPU see-sawing. Oct 16.
  Not found yet; reproducing it needs a GPU run.
- **Folder rows:** Rescan, Show in Folder, Remove From Library (a folder cannot
  be removed today). MEDIA_ORGANIZER_AUDIT. Open.
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
- **Confirm before sync**, showing the email count. BUDGET_REVIEW, IDEAS. Open.
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
- **Concept Lab home:** Continue first, then the ladder. IDEAS. Open.
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
- **Version number:** the shell says 0.2.0, `package.json` says 0.1.0. APP. Open.
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
  (Sep 15). Never traced.
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
