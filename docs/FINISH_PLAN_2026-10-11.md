# The Finish Plan, 2026-10-11

Mufaro's words: the app lacks polish and feels inconsistent; canvas copies
Notion where it didn't need to (favorites, the ⋯ menu); most AI features
perform much worse than the chat; the chat itself feels unoptimized; load-up
has odd dependencies; there is one MCP and skills are underused; every
surface should feel clean and unique. Mufaro asked for a real solution.

This plan comes from looking at the running app rather than from memory:
- 85 surfaces were screenshotted by `tests/ui-polish/app-sweep.mjs`.
- A seeded canvas page was captured with its menus open.
- Boot was timed with no tools on and with every tool on.
- Five code audits were read in full. Each claim used here was checked
  against the code at `ed2979c` and re-checked at `0497b606` (Oct 10).
  Where the newer code changed the answer, this plan says so.

---

## 1. What is actually wrong

### 1.1 The diagnosis has been written four times; the fix never ran

The same findings appear four times:
- UI Slop Audit (Jul 22);
- Polish Charter (Sep 3);
- Design Unification (Oct 1);
- App Audit (Oct 3).

Each one ranks the same step first: **grow the kit, then move every screen
onto it**. Each pass then fixed atoms:
- contrast failures went from 502 to 3;
- labels moved to Title Case;
- buttons moved onto the height ladder;
- confirmations were fixed.

Then feature work resumed:
- The Polish Charter says "No new features ship until this program closes."
- Since Oct 4 there have been 123 commits. 69 are titled as Creations,
  Worksheets, concept map or Study features.
- One of the 123 touched the kit (`kit.ts`, `px-controls.css`,
  `dropdown.ts`, `contextMenu.ts`) or the style ratchet: a keep-open option
  on the menu, added for the model picker.
- Hand-built `<button>`s went *up*: 845 today, +28 since Oct 4, against 274
  kit buttons.

Conformance passes remove wrongness. They cannot create a feeling of one
app, because that feeling lives in the composition layer:
- the page shell;
- the list row;
- the card;
- the settings row;
- where things live.

That layer does not exist in the kit, and no test or token reaches it.

### 1.2 There is no product layer, only tools, each designed alone

The repository holds 16 built-ins and 8 extensions, about 400K lines. Each
tool was shaped after a reference app:
- Canvas after Notion ("Notion" appears 122 times in `src/built-in/canvas`);
- the shell after VS Code;
- Flashcards after Anki;
- Creations after a character-chat app.

Each one holds together inside itself and differs from its neighbours.

**Measured in the running app and the code:**
- **The first screen is VS Code's.** A File/Edit/View menubar; an Explorer
  that shows the internal `.parallx` folder; 13 icon-only activity entries; an
  empty editor offering "Toggle Left Area" and "Toggle Bottom Area". Nothing
  says what Parallx is for.
- **Six tool sidebars, six designs.** Planner, Worksheets, Creations,
  Flashcards, Atelier and Concept Lab each lay out their sidebar differently.
  Five of them are tab bars in disguise (Today/Calendar/Tasks,
  Decks/Study/Create/Import/Stats). Four carry their own Settings row.
- **Six editor home screens, six header styles.** Titles come in 7 sizes and
  3 weights. There are 4 different "back" idioms, 18 different content
  max-widths and 11 sidebar row specs.
- **Two rulebooks contradict each other.** `Parallx_UI_System.md` §4 says
  buttons use sentence case and labels are UPPERCASE micro-labels. CLAUDE.md
  says Title Case actions and no uppercase.
- **Nothing protects a finished screen.** No screenshot baseline exists, and
  the only style ratchet scans `ext/`, not `src/`.

### 1.3 Canvas: Notion's chrome, and the page knows nothing Parallx knows

**What a page shows today** (seeded page, real app):
- The same page appears three times in the Pages sidebar (Recent, Favorites,
  Pages), and again in a tab and the breadcrumb.
- A plain page shows a database-row Properties block (Tags, Created,
  Modified, Add Property) above the first line.
- "Saved" and "Edited just now" sit side by side.
- The slash menu opens on Page, Database and Linked Database.

**The ⋯ menu is Notion's, in Notion's order.** It mixes four kinds of
thing:
- view settings (Font, Full Width, Small Text);
- a state (Lock);
- navigation (Favorites);
- page actions.

It is hand-built on `document.body` rather than on the app's own
`ContextMenu`. The font list even holds two workspace settings.

**Navigation has three overlaps:**
- **Two meanings of "Recent":** pages edited in the canvas sidebar, items
  opened in `recentsService`.
- **Three ways to keep something handy:** page favorites, pinned tabs (in
  the model, never called) and a dashboard pin.
- **Ctrl+P can't find pages** (`commands/quickAccess.ts` has no page source).

**The page points at nothing Parallx knows about it.** Flashcards records
which page each card came from; Worksheets reads pages; Workspace Graph
computes related pages. The page shows none of it. `api.canvas` has exactly
one contribution point, `registerBlock`, so a tool can add a block to a page
but nothing to the page's chrome.

**There are two link formats for a page** (`parallx-page:` and
`parallx://canvas/page/`). Backlinks count only the first.

**There are two AIs on a selection:**
- the bubble menu's floating "AI" mini-chat, a Notion "Ask AI" clone;
- "Send to Chat", which sends live block references to the real chat, with
  edits coming back as Keep/Undo marks. That one is genuinely Parallx.

### 1.4 AI features run outside the AI runtime

The chat runs every request through a harness:
- an assembled system prompt;
- retrieval, memory and transcript recall fitted to a token budget;
- a tool loop;
- compaction and retries;
- one request policy (`think`, `numCtx` sized to the budget).

**32 feature call sites skip all of it** (23 in extensions, 9 in core). Each
is a bare `sendChatRequest` with its own prompt, model choice and parser.
That is why they perform worse. The mechanisms, all checked in code:

1. **Reasoning eats the answer.**
   - When a call leaves `think` unset, thinking models reason by default
     (`ollamaProvider.ts:557-566` says so itself).
   - The output cap counts reasoning tokens.
   - So the 30- and 200-token calls very likely spend their whole budget
     thinking and return nothing: cluster naming, Creations turn order,
     lineage. Their fallbacks then fire silently.
   - Canvas inline AI, PDF Ask and Notebook discard the reasoning, so the
     user stares at an empty bubble.
2. **The context window is unsized.**
   - Calls that omit `numCtx` get whatever window is loaded. Worksheets
     sends up to 60K characters into it.
   - An overflowing prompt is cut from the top, which deletes the system
     prompt and its JSON rules. The Flashcards and Creations code each
     comment on this.
3. **Free-text JSON goes through 11 parsers.**
   - Only Atelier sends a JSON schema to Ollama's `format`.
   - Five call sites send a bare `'json'`.
   - The rest scan the reply for braces.
4. **Features use different models.**
   - There are 8 model pickers.
   - Creations never reads the chat model and falls back to `models[0]`, now
     at 8 sites. That list can include an embedding model.
   - Loading a second model can evict the chat model, so the next chat turn
     cold-loads.
5. **`api.lm` has no priority or timeout.**
   - Cancel was fixed on Oct 10: the signal now reaches the model
     (`api/apiFactory.ts:1115`).
   - Bulk jobs (Budget sync, card scoring, photo tagging) still run at chat
     priority and compete with chat for the GPU.
   - Three hand-rolled stall watchdogs exist because of this.
6. **One parser flag is shared by every stream.** `_inThinkTag` is per
   provider, not per stream (`ollamaProvider.ts:246`). A feature streaming
   while the chat streams can very likely misfile reply text as reasoning.

### 1.5 The chat and boot

**The chat is slow in ways you can feel.** In order of impact:

1. **The answer doesn't stream.** `executeModelStream` adds the answer to a
   buffer and streams only the reasoning (`openclawAttempt.ts:952-997`). The
   answer is sent in one piece after the model finishes (`:905`). The first
   word of an answer arrives when the whole answer is done; until then you
   watch "thinking".
2. **Reasoning is always on.**
   - `think: true` is hard-set (`openclawAttempt.ts:471`).
   - The session flag is only a `??` fallback behind it
     (`openclawDefaultParticipant.ts:724`), so `/think` cannot turn it off.
   - Together with (1), a one-line question waits for full reasoning plus a
     full answer before any answer text appears.
3. **A fixed prefix of about 15–20K tokens goes out on every turn.**
   - It is 10–15K of tool schemas plus a system prompt of about 5–6K.
   - The schemas are not counted in the token budget at all.
   - When the system prompt runs over its share, workspace files are cut
     silently (`openclawSystemPrompt.ts:322-329`).
4. **Work before the first token.**
   - Retrieval runs twice and the query is embedded twice
     (`openclawContextEngine.ts:362-372`).
   - MEMORY.md is read twice.
   - Up to three daily memory files are read in full, one after another.
5. **RAG stays off until this launch's full index walk finishes**
   (`chatDataService.ts:1003`). Chatting early delays the walk further.
6. **Two things break the prompt cache** and force a re-read of the whole
   conversation: attachment guidance and "Active Rules" (which follows the
   active editor). Both sit in the system prompt, before history.
7. **Rendering does too much on every frame.** The session sidebar is
   rebuilt even when hidden, the task rail is replaced, and the whole
   markdown part is re-parsed.
8. **Saving rewrites everything.** Every turn deletes and re-inserts every
   message of the session (`chatSessionPersistence.ts:248-263`). One SQLite
   worker serves every database, with no statement cache.

**Boot: the "weird load-up dependencies."**

In this container, with an empty workspace, the app reaches ready in
0.6–1.3 s, even with every tool on. What makes it slow on a real machine
scales with the machine and the data. The loading overlay waits on:

- **Docling detection,** run as `execSync` in the main process
  (`doclingBridge.cjs:103,136`). It stalls every IPC call while it runs.
- **17 built-ins awaited one after another.** Built-ins treat
  `onStartupFinished` as "activate now and block".
- **The four `"*"` extensions.** Media Organizer, for one, scans its database
  during activation.
- **Editor restore.**

Also during boot:
- About 20 AI services are constructed, and MCP servers auto-connect.
- All 18 built-ins are parsed whether they are on or off, from a 12.9 MB
  unminified bundle: `npm start` builds the dev bundle.
- Six tool icons pop into the activity bar about 140 ms after ready
  (measured).

### 1.6 MCP and skills

**MCP: client only, over stdio only.**
- Parallx cannot be an MCP server. HTTP transport, OAuth, resources,
  prompts and roots are all missing.
- "The one MCP" is the bundled Gmail server. It has a single tool and its
  special cases are hardcoded in the core Electron bridge.
- **4 of the 9 catalog entries are dead or deprecated** on npm (Fetch 404;
  GitHub, Slack and Brave Search deprecated). Filesystem's root variable is
  read by nothing.

**Two privacy bugs:**
- **Secrets are stored in plain text.** MCP server configs, including
  tokens typed into secret fields, are saved as plain JSON in workspace
  storage (`mcpClientService.ts:121`). `secret: true` only masks the input
  box.
- **The seal does not cover MCP.** It hides only tools that declare
  `reachesNetwork` (`languageModelToolsService.ts:234`), and MCP tools never
  declare it. A sealed workspace still offers Gmail, Fetch and GitHub.

**Every tool schema is sent on every turn.** That is about 10–12K tokens by
default, and each MCP server adds roughly 200 tokens per tool. Tool deferral
(`HARNESS.md` 3.3) never shipped. Small models and Edit mode never see MCP
tools at all.

**Skills: the design is already right, the plumbing isn't.**
- Discovery is already Anthropic-style: names and descriptions sit in the
  prompt, and the body loads on demand.
- **Skills are seeded as files** into every workspace.
- **Invalid kinds are silently coerced.** `kind: prompt` and
  `permission: auto-allow` are not valid, so the explain and summarize
  skills need approval just to be read.
- **There is no UI** to list, edit or install skills.
- **Budget writes its skill into the workspace,** where it stays after
  Budget is turned off.
- **No non-chat AI feature uses a skill.** Each has its own hand-written
  prompt constants.

---

## 2. What is good, and why this is fixable

The deep layers are real and hard-won:
- an agent runtime with compaction and recovery;
- a block editor that survived a data-loss audit (C1–C16);
- a tool system that loads and unloads cleanly (Modularity Audit: 32 rows,
  all fixed or ok);
- contrast and tokens that hold in both themes;
- a boot that reaches ready in 0.6–1.3 s even with every tool on (measured).

What is missing is the thin layer on top:
- one surface template;
- one AI task runtime;
- one navigation model;
- a page that knows the workspace.

That layer is small compared to what sits under it. It only pays off if it
is built **before** the next feature, because every feature built without it
adds to the drift.

---

## 3. The change in how work is done

1. **Depth-first on a launch set.**
   - Pick the surfaces a launch user sees.
   - Finish each one to a written bar before touching the next.
   - Tools outside the set stay optional and off by default, and wait.
2. **Feature freeze outside this plan, held this time.** A new idea goes in
   a parking list in this file.
3. **Design before code.**
   - Each surface gets a mock (HTML in `docs/mockups/`, rendered with the
     probe) that Mufaro approves.
   - The code then matches the mock.
4. **Done means protected.** A surface is done when:
   - it is built from the shared primitives only (zero hand-built buttons,
     headers or empty states);
   - its screenshot baselines (dark and light) are approved and checked by a
     test;
   - its ratchet count is lowered so it cannot drift back.

---

## 4. Decisions for Mufaro (one sitting)

| # | Decision | Recommendation |
|---|---|---|
| **F1** | Launch set | Canvas, Chat, Flashcards, Worksheets, Dashboard, plus Explorer, Search, Settings and Welcome. Everything else stays optional, off by default, and outside the bar until migrated. |
| **F2** | North star for feel | Linear's restraint, as DESIGN_UNIFICATION D1 proposed: one header, one row, one empty state everywhere. |
| **F3** | One rulebook | CLAUDE.md and authoring §6 win. `Parallx_UI_System.md` §4 is rewritten to match: Title Case actions, sentence-case labels, no uppercase. |
| **F4** | Favorites become Pin | A workbench-wide Pin for anything that opens in an editor. Pinned items appear first in Explorer. The existing favorites column seeds it once. |
| **F5** | Pages and Explorer | Keep Pages as its own place for now. Decide after F4 ships and Ctrl+P finds pages. |
| **F6** | Tool settings | Only in Settings: tools lose their sidebar Settings rows (DESIGN_UNIFICATION D5). |
| **F7** | The freeze | Holds until Tracks A, B and C are done. |

**Decided 2026-10-11.** Mufaro: "Do not touch AI for Creations AI, but the
rest is fair game." So:
- The plan goes ahead as recommended.
- Creations AI's prompts, model calls, model choice and request settings
  stay as they are. That covers its chat, Studio, Story, memory and
  Directions.
- Track B and the request policy leave Creations AI out.
- Core changes must not alter what Creations AI's calls send or receive.
- Creations AI's UI still migrates onto the shared pieces with every other
  tool (Track F).

---

## 5. This week: quick wins you will feel

Each is small, contained and testable.

1. **The chat answer streams.**
   - Answer text streams into a provisional part as it is generated;
     citations are checked at the end and the part is replaced in place.
   - Per-round narration is already flushed before tool calls, so the
     original reason for buffering is gone.
   - `/think` and a setting decide reasoning: `auto` by default, with short
     turns not reasoning.
   - This is the single most noticeable change to the chat.
2. **Privacy (two bugs):**
   - MCP env values marked `secret` move to safeStorage and old plaintext
     entries migrate.
   - A sealed workspace neither spawns nor offers network MCP servers.
3. **A request policy for every non-chat call except Creations AI's:**
   - `think` is set explicitly, off unless the feature needs reasoning.
   - `numCtx` is sized to prompt plus output.
   - It is applied per feature, not as a bridge-wide default, because a
     bridge default would change what Creations AI sends.
   - `_inThinkTag` becomes per-stream: a provider correctness fix that
     changes no request.
   - Leaving embedding models out of `api.lm.getModels` is held, because it
     would change which model Creations AI falls back to.
   - This alone should make several features stop returning empty or
     truncated results.
4. **Dead MCP catalog entries** are removed or replaced with the current
   packages.
5. **Ctrl+P finds pages.**
6. **The Properties block** on plain pages shows only once a property is
   added.

---

## 6. The tracks

### Track A: Primitives, gallery, guards

This is the work every audit put first.

**In `kit.ts` and `api.ui`:**
- `createSurface({ header, toolbar?, width: narrow|wide|full, body })`:
  - owns gutter and width tokens;
  - one back/breadcrumb idiom;
  - a toolbar slot holding search, filter chips, **tabs**, and actions that
    overflow into ⋯;
  - a dense variant for sidebar and panel views.
- **List row and tree:** icon, label, caption, count, hover actions,
  selected state, indent. One row height (28 px; 24 px dense).
- **Card,** with a stat variant.
- **One empty state:** secondary action by default; the two other builders
  fold into it.
- **Settings row:** label, description and control, with Reset only when
  changed. Toggle, Slider and InputBox get exposed for it.
- **Dialog / side sheet,** plus an **action toast with Undo**.
- **Dropdown gains** icons, descriptions, separators, disabled items,
  typeahead and a real chevron.
- **The menu gains** ArrowRight/Left submenus, header rows and swatch rows,
  so canvas can retire its second menu system.

**Kit Gallery:** a page (developer command) that renders every primitive in
both themes.

**Guards:**
- a per-area `src/` ratchet counting hand-built buttons, headers, empty
  states and `document.body` mounts;
- Playwright screenshot baselines (`toHaveScreenshot`) for the gallery and
  one scene per launch surface;
- a type codemod: `--parallx-fontSize/radius` (527 uses in `src/`) onto
  `--px-*`, pixel values kept.

**Done when:** the gallery is approved, baselines run in `vitest`/Playwright,
and the ratchet fails on a new hand-built button anywhere.

### Track B: One AI runtime

**`api.ai.runTask(spec)` in core:**
- `instructions`, `input`;
- `schema` (sent to `format`, validated, one repair retry);
- `context: { page?, selection?, retrieval?, memory? }`;
- `model: 'chat' | { needs: ['vision'] }`;
- `think: 'off' | 'auto'`;
- `maxTokens`;
- `priority: interactive | background`;
- `signal`, `timeoutMs`.

**It is built on what exists:**
- the model engine broker, for priority, preemption and cancel;
- the token budget, for sizing;
- the context engine, for retrieval;
- the read-only turn runner, for tasks that need tools.

**Each feature becomes:**
- a task definition (prompt and schema);
- a skill it registers, so a workspace can override "how my cards are
  written" and chat can call the same task.

**Order:**
1. Canvas inline AI, folded into the main chat with live references and
   Keep/Undo marks. One AI on the page.
2. Flashcards generation and judges.
3. Worksheets generate and review.
4. Atelier tagging.
5. Budget sync (background priority, still single calls with a schema; not
   the tool loop, which did worse on local models).

Creations AI is out of scope (decided 2026-10-11): it keeps its own calls.

**It replaces** about 900–1,100 lines in ~12 files: 3 watchdogs, 11 parsers,
8 pickers, the context planners, and the inline-provider facade with its
adapters.

**Done when:** every feature has a scenario in `tests/ai-eval`, run with the
same model the chat uses, and its pass rate is recorded before and after.
Bulk jobs then queue behind an active chat.

### Track C: Canvas, Parallx-native

**Top bar, left to right:**
- breadcrumbs (the shared `ui/breadcrumbs.ts`);
- Edited, which opens Version History;
- **page badges contributed by tools** (for example "12 cards · 3 due",
  "Practice 4/10");
- a lock icon, only while locked;
- an **Aa** view popover (Font, Full Width, Small Text);
- **Connections**;
- **Pin**;
- ⋯.

**The ⋯ menu** runs on `ContextMenu`, built from one page-actions list
(`header/pageActions.ts`) that also drives the sidebar row menu and the tab
menu:
1. Open to the Side, Reveal in Pages, Copy Link.
2. **Ask About This Page.**
3. Tool items via a new `canvas/page` menu location (Make Cards From Page…,
   Practice From Page…, Show in Graph).
4. Duplicate, Move To…, Save as Template…, Export ▸.
5. Lock Page.
6. Move to Trash.

**Connections panel:** a right-hand view that follows the active page.
- Core sections: Outline, Links Here (both link formats), Sub-pages.
- Tools contribute sections: cards from this page, practice drawn from it,
  related pages.
- Turning a tool off removes its section.

**New contribution points:**
- `menus['canvas/page']`;
- `menus['editor/tab/context']`;
- `api.canvas.registerPageBadge`;
- `api.canvas.registerPageSection`;
- `OpenEditorOptions.toSide`;
- a quick-open source for pages.

**Navigation:**
- Pin (F4).
- One Recent (`recentsService`).
- The slash menu leads with text blocks; databases sit further down.
- One page link format, with backlinks counting both.

**Done when:** the page and its menus match the approved mock, the old
page-menu CSS is deleted, and no core canvas file names a tool.

### Track D: MCP and skills as the extension backbone

**Protocol:**
- Streamable HTTP (legacy SSE as fallback) through the main-process egress
  point, so the seal applies.
- The current spec version.
- Roots (this fixes Filesystem), resources, prompts, logging and server
  instructions.
- OAuth 2.1 with PKCE, tokens in secret storage.
- The Gmail special-casing leaves the core.

**Config:**
- a user-level `mcp.json` in the `mcpServers` format other apps use;
- "Import From Claude Desktop/VS Code…";
- a per-workspace on/off overlay;
- Disconnect is saved.

**Contribution:** `contributes.mcpServers`. Budget declares the Gmail server
it needs; the core catalog stops naming it.

**Surfacing:**
- Tool annotations drive policy: `readOnlyHint` is auto-allowed,
  `openWorldHint` means reachesNetwork.
- Per-tool toggles under each server.
- A logs pane.

**`tool_search`:**
- Past a budget, extension and MCP tools are listed by name only and their
  schemas load on demand.
- This cuts the default prompt and makes many servers affordable. It is the
  one change that makes "more MCPs" sane.

**Skills:**
- One kind: metadata in the prompt, body on demand.
- A core `skill_read` tool.
- `user-invocable` skills become slash commands.
- Skills ship read-only; nothing is seeded into the workspace, and
  "Customize" copies one in.
- Tools register folder skills.
- A **Skills** section in AI Settings: list by source, toggle, New, Edit,
  Install From Folder. Anthropic-format folders import as they are.

**Later, opt-in:** Parallx as an MCP server (read-only canvas, search and
flashcards), for Claude Desktop and Claude Code.

### Track E: Chat and boot

**The chat** (the answer stream and the think policy ship in §5):
1. **One embedding per turn,** shared by both lanes.
   - The memory lane scores by path, without a second search.
   - There is no durable-memory read when the bootstrap already has it.
2. **RAG gated on "the index has rows",** not on this launch's walk.
3. **The schema budget:**
   - schemas are counted in the token budget;
   - tool families load on demand (`tool_search`, shared with Track D);
   - no silent cut of workspace files.
4. **Cache breakers** (attachment guidance, Active Rules) move after the
   history.
5. **Render:**
   - re-parse only the trailing markdown block;
   - rebuild the sidebar only when the list changes;
   - add a signature check to the task rail.
6. **Persistence:**
   - sessions save by upsert;
   - an LRU statement cache and SQLite pragmas;
   - a separate worker for extension databases.

**Boot:**
1. The overlay lifts after layout and Chat. Everything else continues
   behind it.
2. Built-in `onStartupFinished` stops blocking, and the four `"*"` manifests
   move to `onStartupFinished`.
3. Docling detection runs as async `execFile`, its result is cached on disk,
   and the server starts on first use.
4. Optional built-ins load as their own chunks, only when turned on. That
   applies the first principle to code loading.
5. The production bundle is used for daily runs, served with validators.

**Done when:** a scripted probe records boot-to-ready, time to first
answer token and per-turn prefix tokens, and a test keeps each number under
its budget.

### Track F: Move the launch surfaces onto the primitives

In order of visibility, each to its own done bar:
1. Welcome and first run (purpose, then tools, then AI provider; no
   developer rows).
2. Settings, with AI Settings collapsed. Today it has **15 AI pages**:
   Overview, Providers, Model, Agent, Chat, Persona, Retrieval, Indexing,
   Suggestions, Tools, Integrations, General, Heartbeat, Routines and
   Helpers.
3. Dashboard.
4. Chat (50 hand-built buttons, 0 kit).
5. Flashcards.
6. Worksheets.

Tools outside the launch set follow after launch: Creations, Atelier,
Planner, Concept Lab, Budget and Browser.

The audit's estimate for the whole migration is 11–17K lines across ~55
files, about 60% of it deletion.

---

## 7. Order and how it will feel

| Step | What you will notice |
|---|---|
| Quick wins (§5) | Chat answers appear as they are written. Flashcards and worksheet generation stop coming back empty or cut off. Ctrl+P opens pages. Sealed means sealed. |
| A | Nothing on screen yet. From here on, every new screen comes out consistent by default. |
| C | The page feels like Parallx: it shows its cards, practice and links, and one menu works everywhere. |
| B | Every AI feature is as good as the chat, can be stopped, and stays out of the chat's way. |
| E | The app is usable as soon as it shows, the chat answers sooner and stays fast deep into a long conversation, and turned-off tools cost nothing at load. |
| F | Every launch surface has the same header, rows, empty states and settings. |
| D | Real MCP servers in a click, without a bloated prompt. Skills you can see and edit. |

Tracks A and B can run side by side. C needs A's menu and row primitives.
F needs A. D can start after the quick wins.

---

## Parking list (ideas that wait for the freeze to lift)

*(empty)*
