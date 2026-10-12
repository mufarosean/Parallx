# Refactor handoff: for Claude Code on the owner's machine

The cloud session that executed `REFACTOR_AUDIT_2026-10-11.md` stopped at a
clean checkpoint on `dev`. This page is what the local session needs to pick
up: how to get a working checkout, what to verify in the running app (the
cloud container cannot start Electron), and the remaining plan in order.
Treat it as the task list; CLAUDE.md still sets the rules.

## 1. Get a working checkout

```
git checkout dev
git pull
node -v            # the cloud session built and tested on Node 22
npm install        # required: the dependency list changed (see below)
npm run typecheck  # app and tests
npx vitest run     # 546 files pass, 3 skipped, at the handoff commit
npm run build      # renderer bundles into dist/renderer/
npm start          # builds, then opens the app
```

Dependencies and what to do when they fail:

- `npm install` runs `postinstall`: `electron-rebuild` (compiles
  `better-sqlite3` for Electron 40) then `node scripts/patch-deps.mjs`. If
  the rebuild fails, run `npm run rebuild` on its own and read its error;
  a missing C++ toolchain or Python is the usual cause on Windows.
- This session replaced the `codemirror` meta package with the seven
  `@codemirror/*` packages the code imports, and dropped three unused
  `@tiptap/*` packages. A `node_modules` from before 2026-10-11 still
  builds but the editor host and the unit tests may fail until
  `npm install` runs.
- `mermaid` is optional at build time: without it `npm run build` prints a
  warning and diagram blocks say they cannot be drawn. `npm install` adds it.
- `dist/` is generated and ignored by git. `npm run build` writes
  `main.js`, `main.css`, the worksheet and Mermaid bundles, and three new
  vendor bundles (`vendor-pdfjs.js`, `vendor-hljs.js`, `vendor-jszip.js`,
  see `scripts/vendorBundles.mjs`). A stale `dist/` from an older build
  lacks them and the PDF pane, Markdown preview and Excel import fail to
  load their library; rebuild.
- `better-sqlite3` is built for Electron's Node, so `node -e
  "require('./electron/database.cjs')"` fails outside Electron on a
  rebuilt checkout; that is expected. The unit tests use `node:sqlite`.

## 2. Verify this session's changes in the running app

Everything below passed the unit suite, the typecheck and the build, but
none of it ran in Electron. Open the app and walk this list once; a fault
here is the first thing to fix.

| Area | What to do | What should happen | Commit |
|---|---|---|---|
| PDF | Open a PDF; use the outline, search (Ctrl+F), the overflow menu's spread and scroll modes, add a highlight and undo it | pdf.js loads on the first PDF (the pane shows it within a second), everything as before | f8d22513, 2fc61901 |
| Markdown preview | Open a .md with fenced code | Code is coloured from the first paint; preview updates as you type | f8d22513 |
| Worksheets | Import an .xlsx; edit cells, wait 5 s, close and reopen; Export to Excel | Import works (JSZip loads on first use); edits persist; export writes the file | f8d22513, bbacc86c |
| Creations | Start a roleplay turn with no standing note; then add the standing note "Write Ada's thoughts in italics" | No line of italic thoughts by default; with the note, thoughts appear in italics | 28a851c7 |
| Find in Files | Search a large folder | Results appear file by file while the search runs; counts update | bbacc86c |
| Workspace Graph | Ask AI about a node | The summary renders (JSON parsed by `api.lm.parseJson`) | 0fcde169 |
| Mermaid | Switch light and dark with a diagram open | The diagram redraws once per switch | 2e9c6bae |
| Quick Open | Ctrl+P with no query | Recent files first, in recency order | 2e9c6bae |
| Chat | Restart the app with several chats | The list shows previews; opening a chat loads its messages | 2e9c6bae |
| Docling | Settings → Documents (or first PDF extraction) | Python detection does not freeze the window | d98d726e |
| Flashcards | Add cards, run Find Duplicates and the deck sweep | Works; no errors in the console | bbacc86c |
| Atelier | Trash several items, restore them | Works in one step each | bbacc86c |
| Budget | Apply a category rule to many transactions | All matched rows change | bbacc86c |
| Study | Generate questions for a material | Concepts and questions are inserted (batched); bank import still assigns concepts | bbacc86c |
| Dashboard | Open a widget's settings and the appearance drawer | The dropdowns work (now `.ui-select`) | 88a86d66 |
| Icons | Any screen | Icons render (the registry adds the `<svg>` wrapper at load) | bbacc86c |
| Tools | Tool Gallery lists all built-ins; each turns off and on | Manifests load from their folders | 5a88bb8f |

Open the developer tools console while doing this; the ratchets catch
structure, not runtime errors.

## 3. Rules while continuing

- Work on `dev`, pull first, commit and push after each finished step
  (CLAUDE.md). One section per commit for the splits.
- `npm run typecheck`, `npx vitest run`, `npm run build` pass before every
  commit. A failing test is the app's problem; fix the cause.
- The ratchets (`tests/unit/*Ratchet.test.ts`) only let counts fall: files
  over 800 lines may not grow, imports may not point up the layers, and
  comments may not add history. When one fails, move code into a new
  module rather than adding to the giant. Refresh a baseline only when a
  count fell or a file moved: `UPDATE_FILE_SIZE_BASELINE=1`,
  `UPDATE_IMPORT_DIRECTION_BASELINE=1`, `UPDATE_HISTORY_TAG_BASELINE=1`,
  each with `npx vitest run tests/unit/<ratchet>.test.ts`.
- After editing `ext/study/src/*.js`, run `node scripts/bundle-study.mjs`;
  after changing icons, `node scripts/build-icon-registry.mjs`.
- Extensions are plain JavaScript: `tests/unit/extUndefinedNames.test.ts`
  catches a name that does not exist; run it after any extension edit.
- Names that must never change are listed in the audit, §3 (settings keys,
  commands, table names, manifest ids).

## 4. What remains, in order

Each item below is a class or a file taken apart. Do one per session, run
the app after it (the row above that matches, plus the feature itself),
then commit.

### Phase 6, the splits

1. **PDF pane collaborators.** `src/editor/panes/pdf/pdfEditorPane.ts`
   (3,139 lines) by its sections: highlights and margin notes (lines
   ~850 to 1,640), the outline sidebar, the search bar, the toolbar and
   overflow menu, thumbnails, the text-selection menu, view-state
   persistence. Each becomes a class in its own file taking the pane's DOM
   and pdf.js objects through a small host interface; the pane constructs
   them. The pure parts (icons, types, highlight model) are already out.
2. **Worksheets panes.** `src/built-in/worksheet/main.ts` (4,020 lines):
   each `create*Pane` function into `panes/<name>Pane.ts`, with the module
   state they share (`_practice`, listener sets, caches) in a `state.ts`
   they import. Keep `main.ts` as the activation that registers them.
3. **Planner pane.** `plannerEditorProvider.ts` (3,015 lines): the task
   list, the day, week and month grids and the event popover into files;
   the pure helpers are already in `plannerDates.ts` and `plannerLinks.ts`.
4. **Canvas data service.** `canvasDataService.ts` (3,045 lines, one
   class): delegates per area (pages and tree, blocks, versions and
   history, trash, properties), each a class the service constructs with
   the database bridge; the service keeps its public interface.
5. **`electron/main.cjs` into `electron/ipc/*.cjs`.** Group the
   `ipcMain.handle` registrations by prefix (`database:`, `ext-database:`,
   `docling:`, `fs:`, ...) into modules exporting `register(ipcMain, deps)`;
   `main.cjs` builds `deps` and calls each. Verify by starting the app and
   using each area; there are no unit tests for the main process.
6. **Chat `activate()`** (`src/built-in/chat/main.ts`, 3,751 lines) into
   `activation/wire*.ts` steps that receive one context object.
7. **Workbench boot phases** (`src/workbench/workbench.ts`, 4,268 lines)
   into `shell/boot/*.ts`.
8. **Extensions as real modules.** Leaf code first (CSS strings, SQL, pure
   logic), then UI areas with shared state in a `state.js`. Atelier along
   its 26-section table of contents; its `@mo-*-pure` regions, which tests
   cut out of the file with `new Function`, become modules the tests
   import. Then Flashcards, Creations, Concept Lab, Budget. The loader
   resolves relative imports and `collectExtensionFiles` packages every
   top-level module, so a split needs no build step.

### Phase 4 leftovers

- **Flashcards and Study shared assessment.** Their eight copied functions
  (rubric normalising and serialising, verdict normalising and scoring,
  rating, LaTeX escape repair, the JSON array and object extractors) have
  drifted. Pin today's output of both copies in tests, choose one
  behaviour per pair on purpose, put it in `ext/_shared/assessment.js`,
  copied into each at build time like `bundle-study.mjs`, with a staleness
  test. Only `NormalizeFormula` is still identical.
- `api.lm.pickModel` and `api.lm.stream` (with the stall watchdog), then
  move the extensions' copies onto them.
- The shared `debounce` from `platform/timing.ts` in the 35 files with
  hand-written timers; check each timer is a debounce before replacing it.
- A `newId()` in platform, keeping every stored id format.

### Phase 5 leftovers

- The chat save still deletes and rewrites every message of a session on
  each save. Changing it needs a design that cannot lose history (which
  messages are persisted, how edits and regenerations are reconciled).
- "Retrieval runs twice per turn" from the 2026-10-03 audit does not
  match the current code; confirm against a live turn with logging before
  spending time on it.

### Phases 7 to 10

As the audit lays them out: renames one per commit, Prettier once, errors
that say what went wrong, one way per structural job.

## 5. Decisions for the owner

These are product calls the audit found and the refactor left alone, since
each removes or changes something a user could notice. Decide each one;
the local session then does the work in one commit per decision. The
recommendation is mine; the choice is yours.

### 5.1 The three suggestion services

What they are: `relatedContentService.ts`, `autoTaggingService.ts` and
`proactiveSuggestionsService.ts` (934 lines) compute related pages, tag
suggestions and proactive prompts from the vector index.

What happens today: all three are constructed at every boot and listen to
index updates. Their setting, `suggestions.enabled` in AI Settings, says
"Nothing shows the suggestions yet, so this only costs embedding work;
leave it off." The only things that reach them are seven chat commands
(`chat/main.ts` around line 3378) that no menu, button or shortcut runs.
Nothing in the UI shows a suggestion.

Options:
- **A. Delete them** (the three services, their service interfaces, the
  seven commands, the `suggestions.*` settings). About 1,100 lines less,
  no boot work, nothing a user loses because nothing shows them.
- **B. Keep them and build the surface** that shows suggestions (a panel
  or a page side rail). This is a feature, not a cleanup.
- **C. Keep the code but stop constructing them at boot** until the
  surface exists. Cheapest, but the dead code stays.

Recommendation: A. If you want suggestions later, the git history keeps
the code, and the vector index they read from is still there.

### 5.2 Settings that do nothing

Each of these appears in Settings or AI Settings, saves a value, and
changes nothing:

- `canvas.blockIds.enabled` and `canvas.dataview.enabled`
  (`autonomySettingsSchemas.ts`): declared as feature flags; no code
  reads them.
- `persona.name`, `persona.description`, `persona.avatar` (AI Settings,
  profile section): stored in the profile; no prompt or screen reads them.
- `chat.responseLength` (AI Settings): stored in the profile; the chat
  never applies it (the Creations extension has its own, working one).
- `suggestions.*` (six keys): see 5.1.
- `autonomy.heartbeat.enabled` and `autonomy.rail.enabled`: already
  retired from the settings screen (`NO_ROW`), still in the schema and
  the flag list.

Options, per setting:
- **Remove it** from the schema and the screen. A saved value in an
  existing workspace is ignored, as it is today.
- **Make it work.** `chat.responseLength` is the one with an obvious
  meaning: a length hint in the chat prompt, as Creations does. `persona.*`
  could go into the chat's system prompt. The two canvas flags and the
  two autonomy flags have no feature behind them to turn on.

Recommendation: remove the canvas flags, the autonomy flags and the
`suggestions.*` keys now; decide `persona.*` and `chat.responseLength`
together, since both are "how the assistant presents itself", and either
wire both into the chat prompt or remove both.

### 5.3 Migrations that run on every boot

Three one-time migrations have no "done" marker, so they run each start:

- **The tools folder move** (`electron/main.cjs`, the block after
  `setupMediaStreamBridge`): copies any folder from `~/.parallx/tools/`
  into the user extensions folder if it is not there yet. Cost: one
  directory read per boot once the old folder is gone.
- **Legacy canvas properties** (`legacyPropertyMigration.ts`, started
  from `canvas/main.ts`): moves pre-database page properties into the
  database, writing a JSON backup first; returns "nothing-to-migrate"
  when the old tables are empty. Cost: a query per boot.
- **Legacy AI profiles** (`_migrateLegacyProfiles` in
  `unifiedAIConfigService.ts`): reshapes profiles saved in the old format
  when the settings file loads.

Only you know whether every workspace you still open has been through
these at least once. The question for each: has every workspace you care
about been opened since the migration shipped?

Options:
- **Delete the migration** (yes to the question above).
- **Keep it, add a done marker** so it runs once per workspace, not per
  boot. Small code; keeps safety for an old backup you might restore.
- **Keep it as is.** Costs a little each boot, forever.

Recommendation: delete the tools folder move (it is a year-old layout,
and copying a folder you can copy by hand is not worth code on the boot
path); keep the other two with a done marker, because a restored backup
of an old workspace would otherwise lose its properties or profiles.

### 5.4 MCP sign-in events nobody listens to

What they are: when you sign in to an MCP server (`oauthBootstrap` in AI
Settings → MCP), the main process already opens the sign-in URL in your
browser, and also sends two events to the window, `mcp:oauth-url` and
`mcp:oauth-stderr` (the URL, and the helper's log lines). The preload
exposes them as `mcp.onOauthUrl` and `mcp.onOauthStderr`; nothing in the
renderer subscribes, so the MCP section waits silently until sign-in
finishes.

Options:
- **Finish the feature:** the MCP section shows "Opened your browser to
  sign in" with the URL (so a blocked popup can be copied) and the
  helper's log lines while it waits.
- **Remove the two events** from the preload and the main process; the
  browser still opens.

Recommendation: finish it. It is a small UI change, and a sign-in that
sits silent for a minute is the kind of thing that reads as broken.

### 5.5 How to hand a decision to the local session

One line per decision is enough, for example: "5.1 A; 5.2 remove the
canvas and autonomy flags, wire persona and responseLength into the chat
prompt; 5.3 delete the tools move, done markers for the other two; 5.4
finish it." The session makes one commit per decision, with a test
where the behaviour is visible (a setting gone from the schema, a
migration that runs once, the MCP section showing the URL).

## 6. Where to read

- `REFACTOR_AUDIT_2026-10-11.md`: the findings and the plan.
- `git log c715e0e4..dev`: every step of this session, one commit each,
  with the reasoning in the message.
- `ARCHITECTURE.md`: the folder map, the layers and what the tests enforce,
  updated as the splits landed.
