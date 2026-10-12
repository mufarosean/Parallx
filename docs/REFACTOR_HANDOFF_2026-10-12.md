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

### First, the dead-code sweep (done 2026-10-12)

Done, one commit per group (34a938c5, fb98f8b3, 69d786c1, 728f472b,
6127278a); the sweep now prints only the eight `_...ForTest` hooks. Two
things it turned up: the chat list showed archived autonomous runs
(`loadSessionMetas` had lost the filter the dead `loadSessions` kept;
fixed in c823cb60), and the `customDragHandle` capability on canvas
block definitions has no reader now (left for the canvas split). What
follows is the plan as it was written.

The cloud sessions removed what the audit named. They did not sweep the
whole code base for unused code, and a sweep run afterwards still finds
some. `node scripts/dead-code-sweep.mjs` lists it by name in five groups:

- `exports`: an export in `src/` nothing references, its own file included
  (23 at the time of writing: helpers left behind when their last caller
  was rewritten, such as `getBuiltinFonts`, `uriCompare`, `boxWidth`).
- `testOnly`: an export only tests reference (30). The `_...ForTest` hooks
  are meant to be; the rest (`cosineSimilarity`, `loadSessions`,
  `isParallxUri`, ...) are production code with no production caller, so
  delete the function and its test together, or find the caller it was
  meant for.
- `ext`: a top-level function or const in `ext/` referenced nowhere (21:
  ten `budgetTool*` handlers in Budget that no tool registers, three
  Study data helpers, two in Media Organizer, three in Creations).
- `settings`: a declared setting nothing reads (0 after the AI Settings
  work on 2026-10-12).
- `css`: a stylesheet nothing imports (1: `settingsEditorPane.css`, whose
  pane was removed on 2026-10-01).

Every hit is a candidate: read the file first, since a name reached only
through a string or the extension API also shows up. Delete in one commit
per group, run the four checks, and re-run the sweep until it prints only
the test hooks. Do this before the splits: it is small, and the splits
move the same code.

### Phase 6, the splits

1. **PDF pane collaborators** (done 2026-10-12, 2a20d0cc to 896ee7e3). The
   pane is 1,000 lines; each section is a module in `pdf/`: pdfThumbnails,
   pdfOutline, pdfSearchBar, pdfHighlightStore and pdfHighlightPopover,
   pdfSelectionOverlay, pdfSelectionMenu and pdfSelectionActions,
   pdfToolbar and pdfToolbarMenus, pdfViewState, pdfDebugHook (pdfButtons
   is their shared button helper). Two bugs went with it: the outline's
   arrow keys moved one row more per PDF opened in the same pane, and
   undo crossed from one PDF to the next. What is left in the pane is its
   own work (its DOM, loading pdf.js, the side panel, keys, layout); taking
   it under 800 lines would mean splitting `renderInput`, which the plan
   did not list. `tests/probes/refactor-verify-probe.mjs pdf` drives
   every section hidden. The plan as written:
   `src/editor/panes/pdf/pdfEditorPane.ts`
   (3,139 lines) by its sections: highlights and margin notes (lines
   ~850 to 1,640), the outline sidebar, the search bar, the toolbar and
   overflow menu, thumbnails, the text-selection menu, view-state
   persistence. Each becomes a class in its own file taking the pane's DOM
   and pdf.js objects through a small host interface; the pane constructs
   them. The pure parts (icons, types, highlight model) are already out.
2. **Worksheets panes** (done 2026-10-12). `main.ts` is the activation
   (about 200 lines). Each `create*Pane` is in `panes/<name>Pane.ts`, with
   `dashboardPane` and `planPane` moved beside them; `state.ts` holds the
   shared state (one `state` object for the api, the running quiz, the
   review walk, the builder preset and the import hooks; the caches,
   listener sets and settings beside it), `widgets.ts` the buttons and
   `el`, `actions.ts` the moves between tabs (open a tab, start or reopen
   a quiz, import a plan, the plan pane's actions), `chatReview.ts` the
   chat hand-off. No pane imports another except the sheet pane (the quiz
   and review panes embed it) and the bank pane (the sidebar draws its
   snapshot, the import pane calls its recipe reader). The split was mechanical, verified by
   typecheck and build; the app has not been run since, so walk the
   section 2 Worksheets rows first. The plan as written:
   `src/built-in/worksheet/main.ts` (4,020 lines):
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

## 5. The owner's decisions, made and shipped

The audit left four product calls to the owner. They were answered on
2026-10-12 and are done, one commit each:

| Decision | Answer | Commit |
|---|---|---|
| 5.1 The three suggestion services (related pages, tag suggestions, proactive prompts): started at every boot, nothing showed them | Delete | 113188fa |
| 5.2 Settings nothing read: `persona.*` (SOUL.md is the persona), `chat.responseLength`, the six `suggestions.*` keys | Remove all | 0b25b020 |
| 5.2 Flags nothing read: `canvas.blockIds.enabled`, `canvas.dataview.enabled`, `autonomy.heartbeat.enabled`, `autonomy.rail.enabled` (the heartbeat is switched in Agents › Heartbeat, with the global pause) | Remove all | 86332df6 |
| 5.3 The three one-time migrations (the tools folder move, April; canvas properties into databases, June; AI profiles in the old format, March) | Delete | 5bc6128f |
| 5.4 MCP sign-in events nobody listened to | Finish the feature | c836435a |

Two things worth knowing from the work:

- The Finance Focus preset differed from Default only in the persona and
  suggestion values that are gone; it is now the same as Default except
  its name. Creative Mode still differs (temperature 0.9). Whether Finance
  Focus should go, or get something of its own, is a small open question.
- A saved preset, flag store or workspace that still carries the removed
  keys loads as before; the keys are ignored. A workspace never opened
  since the migrations shipped keeps its old data on disk and starts from
  defaults.

## 6. Where to read

- `REFACTOR_AUDIT_2026-10-11.md`: the findings and the plan.
- `git log c715e0e4..dev`: every step of this session, one commit each,
  with the reasoning in the message.
- `ARCHITECTURE.md`: the folder map, the layers and what the tests enforce,
  updated as the splits landed.
