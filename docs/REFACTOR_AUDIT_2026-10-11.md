# The Refactor Audit, 2026-10-11

Mufaro's ask: audit dead code and inefficient code, and plan a refactor where
**the app does exactly what it does today**, but the code is clean, modular
and readable enough that a beginner can open the repo and understand its
structure and what is going on.

This document is the audit and the plan. No code has been changed for it.

**How it was done.** Five read-only audits ran against `dev` at `3d33434c`:
dead code, inefficiency, structure, duplication and readability. They used
real tools rather than grep where it mattered:
- an import graph rooted at every entry point (renderer, side bundles,
  Electron main and preloads, each extension's manifest);
- the TypeScript compiler for unused exports, function sizes and `any`
  counts;
- a minified esbuild metafile for bundle weights;
- 15-line window hashing for copy-paste detection;
- knip, with its false positives checked by hand.

Every bug in §1 was re-checked by hand before writing this.

**The codebase in one table.**

| Part | Lines | Notes |
|---|---|---|
| `src/` (TypeScript) | 248K | 791 files; 508 of them are 300 lines or fewer |
| `ext/` (JavaScript extensions) | 125K | 9 extensions; 4 are single files over 9K lines |
| CSS | 33K | |
| `tests/` | 151K | 519 unit test files in one flat folder |

**The verdict.** The base is better than it feels:
- strict TypeScript, consistent quotes and semicolons, `await` everywhere;
- `ui/` and `platform/` import nothing above them;
- 84% of files open with a purpose header.

What makes it hard to read comes down to six things, and each has a
mechanical fix:
1. **About 15 giant files.** One 3,390-line function (`activate()` in chat);
   one 39,252-line extension (Atelier).
2. **History in comments.** 2,088 comments in `src` carry milestone tags
   ("M58 W4", "D2:", "Phase θ B5") that mean nothing to a new reader.
3. **Names that record where code came from, not what it does.**
   `openclaw` is the chat runtime. `mo*`, `fc*`, `st*`, `cl*` and `tg*` are
   prefixes on thousands of identifiers.
4. **The same job done several ways.**
   - 20 HTML escapers, 12 relative-time formatters, 11 "parse JSON from the
     model" helpers, 11 model pickers, 7 schedulers;
   - Readability pasted into two extensions.
5. **Dead code.** About 3,100 lines are certainly dead and about 5,800 more
   are likely dead, including about 1,300 lines of orphan CSS.
6. **No guard rails.** There is no linter, no formatter and no
   import-direction test. The tests are never type-checked, and
   `ARCHITECTURE.md` was last true in May.

Removing everything removable takes out roughly **8–14K lines** (2–4%).
Shrinking is not the main gain. The main gain is that every folder, file and
function becomes small enough, and named plainly enough, to read.

---

## 1. Bugs the audit found (fix first, on their own)

These are not refactors: fixing them changes behavior from broken to
working. Each one gets its own commit and a test that fails before the fix.

| # | Bug | Where | Effect today |
|---|---|---|---|
| B1 | `const db = _db;`, but `_db` is declared nowhere (only `_dbBridge` exists) | `ext/media-organizer/main.js:17707` | Atelier's selection bar, More Actions › Export… throws a ReferenceError |
| B2 | The packaging script zips only `parallx-manifest.json` and `main.js`, but `main.js` imports 11 sibling modules (`main.js:11-22`) | `scripts/package-creations-ai.mjs:22-23` | A packaged `creations-ai.plx` cannot load. `package-media-organizer.mjs` has the same shape and breaks as soon as Atelier is split |
| B3 | Readability's non-ASCII patterns are mojibake: `Â»`/`Â«` for `»`/`«`, `â€“â€”` for `–—`, and garbled Chinese and Russian in the "Loading…" placeholder check | `ext/browser/main.js` (the copy Browser runs) and `ext/web-research/readability.js` (the "source of truth" file, not run). Web Research runs its own inline copy, which is correct | Browser's reader misses `»`/`«` next/prev links, leaves the site name on titles split by `–`, `—` or `»`, and keeps non-English "Loading…" placeholders |
| B4 | Ctrl+P's page source calls `getPageTree()`, which runs `SELECT *` (every page body) on **every keystroke**. I introduced this in `9c567ad1` | `canvas/main.ts:571-590` → `canvasDataService.ts:352-356` | Quick Open slows down as the workspace grows |
| B5 | Flashcards probes Ollama at a hard-coded `localhost:11434` | `ext/flashcards/main.js:2314` | Ignores the `ollama.baseUrl` setting; a remote Ollama looks "down" to Flashcards |
| B6 | `src/ui/relativeTime.ts` uses the machine's day boundary; Worksheets uses the app Time Zone | `relativeTime.ts` vs `worksheet/main.ts:1572` | "Yesterday" and "Today" disagree between surfaces when the two zones differ |
| B7 | Error swallowing that hides real failures | `openclawCronService.ts:883-890` (`_save` swallows every write error, so schedules can vanish on restart); `agentsRoutines.ts:140,142` (Add and Dismiss fail silently); `creations-ai/main.js:8989,9017` (a failed delete after "cannot be undone" says nothing) | The user is told nothing when something they asked for fails |
| B8 | Stale facts | The `indexing.worker.enabled` description says "Default off", but the default is `true` (`autonomySettingsSchemas.ts:53` vs `autonomyFeatureFlags.ts:113`). `m58RealAutonomy.test.ts:44-46` imports types from modules that don't exist; the imports are type-only, so they are erased and the test still runs | Misleading settings text; a test that type-checks nothing |

---

## 2. What the audit found

### 2.1 Dead code

**Certain (about 3,100 lines).** Nothing imports or calls these; the import
graph and the TypeScript compiler agree.

- **Unused files:**
  - `src/built-in/chat/commands/initCommand.ts`, plus `IInitCommandServices`
    (`chat/chatTypes.ts:394`): 232 lines;
  - `src/built-in/chat/utilities/chatParticipantCommandDispatcher.ts`: 64;
  - `src/editor/editorGroup.ts`, a barrel nobody imports: 25;
  - `src/ui/list.ts`: 278, plus its CSS at `ui.css:442-509`.
- **`executeOpenclawModelTurn`** (`openclawParticipantRuntime.ts:475`):
  marked `@deprecated` and referenced only in comments.
- **46 exported values and 29 exported types nobody references:**
  - the disposal-tracking half of `platform/lifecycle.ts`, behind
    `_trackDisposals`, which nothing turns on;
  - `_leakWarningEnabled` in `events.ts`;
  - `isCompatible` (`apiVersionValidation.ts:37`);
  - the `tokenBudgetService.ts:30-100` types;
  - the `chatIsStreaming` context key, which is never set and never read.
- **Drifted copies:**
  - `keybindingContribution.ts:31-127` duplicates `keybindingUtils.ts`; the
    copy lacks the numpad fix, and every caller already uses the real one;
  - 4 old `chat/skills/*/SKILL.md` files (312 lines) that nothing reads.
- **One-off scripts (about 1,190 lines):**
  - 16 budget/db diagnostics in `scripts/` with hard-coded `D:/Documents/...`
    paths, needing `sql.js`, which isn't installed;
  - `scripts/normalize-icons.mjs`, replaced by `build-icon-registry.mjs`.
- **Orphan CSS** for components deleted on 2026-08-30 (Button, ActionBar,
  CountBadge in `ui.css`) and the theme picker retired on 2026-10-03
  (`workbench.css`).

**Likely (about 5,800 lines).** Dead by every check, but worth one look
before deleting.

- **Test-only modules:**
  - `src/openclaw/commons/*` (experimental federation);
  - `workspace/sessionLogger.ts`;
  - `ui/textarea.ts`;
  - `aiSettings/aiSettingsDefaults.ts`, which is really a test fixture.
- **Test-only helpers:** 234 lines of `chatGroundedResponseHelpers.ts`;
  production uses one function from it.
- **Commands nobody runs:**
  - the 7 suggestion commands (`chat/main.ts:3392-3449`);
  - `chat.addCanvasBlockReference`, replaced by a DOM event;
  - `chat.getArchivedRunSummaries`.
- **IPC nobody calls from the renderer:**
  - `database:dropToolData`;
  - `document:richExtensions`;
  - `browser:revokePermission` and `browser:listDownloads`.
- **`tools/graph-v1`, `graph-v2`, `graph-v3`** (2,350 lines), untouched since
  March.
- **About 900 more lines of orphan CSS,** mostly 122 rules in
  `aiSettings.css` for sections that no longer exist.
- **Unused npm dependencies:**
  - `@tiptap/extension-link` and `@tiptap/extension-underline` (StarterKit v3
    bundles both);
  - `@tiptap/suggestion`;
  - `codemirror`.

**Your call (product decisions, not refactors):**
- **The three suggestion services** (related content, auto-tagging,
  proactive suggestions; about 1,080 lines). Their own setting says "Nothing
  shows the suggestions yet… leave it off", yet they still listen to
  vector-index updates at boot.
- **Settings that do nothing:**
  - `canvas.blockIds.enabled`, `canvas.dataview.enabled`;
  - `persona.*`, `chat.responseLength`, `suggestions.*`;
  - the retired `autonomy.heartbeat.enabled` and `autonomy.rail.enabled`.
- **Old migrations that run on every boot:**
  - the M53 tools-folder move (`main.cjs:892-907`), with no "done" marker;
  - `legacyPropertyMigration.ts`;
  - `_migrateLegacyProfiles`.

  Only you know whether every workspace you care about has been opened since.
- **`mcp.onOauthStderr` and `onOauthUrl`** (`preload.cjs:645-654`). Main sends
  them, but nobody listens. This may be a missing feature rather than dead
  code.

**Knip was wrong about** `electron/recorderFramePreload.cjs` (loaded by path)
and `lucide-static` (read by the icon build). Keep both.

### 2.2 Inefficient code

Ranked by what the user feels. Every fix below keeps the output identical.

| # | What | Where | Fix |
|---|---|---|---|
| 1 | Indexing Log rebuilds its whole list (up to 2,000 rows) for each indexed source | `indexing-log/main.ts:233-248, 388-417` | Append a row, trim past the cap, batch per frame |
| 2 | Output panel rebuilds up to 1,000 rows on every `console.*` call in the renderer | `output/main.ts:90-99, 122-151` | Same |
| 3 | Every canvas page list loads every page body (`SELECT *`): sidebar (4 queries per change), Recents after each pause in typing, Ctrl+P per keystroke (B4), each `@` mention, Workspace Graph | `canvasDataService.ts:352, 1762-1781, 2083` | Select fixed columns without `content`, typed as `IPageSummary` so the compiler flags any reader of the body |
| 4 | Canvas serializes the whole document on every keystroke, before the 500 ms debounce: `getJSON()` twice, stringify, parse and re-stringify, a walk of every node | `canvasEditorProvider.ts:839-860`, `canvasEditorView.ts:171-179` | Mirror only when a second pane shows the page; skip text nodes in the walk; then serialize when the debounce fires |
| 5 | Workspace Graph still rebuilds on every canvas autosave while hidden, and restarts its physics on unchanged graphs | `ext/workspace-graph/main.js:2611, 2799, 306` | Go through the existing shown-check; skip the reset when ids are unchanged |
| 6 | Find in Files re-renders all results repeatedly and reads files one at a time | `search/main.ts:489-588, 705` | Append new groups; read ahead, keeping order |
| 7 | Flashcards scans its vector table once per card | `ext/flashcards/main.js:2287-2290, 2336, 2446, 2550` | Read `rowid, card_id` once; batch in a transaction |
| 8 | Every settings `set` rewrites the whole file, once per queued set, pretty-printed | `platform/fileBackedStorage.ts:97-131` | One pending-flush flag |
| 9 | Worksheets snapshots the whole workbook every 5 s, edited or not | `worksheet/main.ts:421, 3109-3124` | Dirty flag from `host.onEdited` |
| 10–13 | One UPDATE or INSERT per row: Atelier trash and restore, Budget "apply rule", sidebar reorder, Study inserts (outside a transaction) | `media-organizer:29912`, `budget:5034`, `canvasDataService.ts:1401`, `study/src/20-data.js:315,531,693` | One transaction, chunked `IN (…)` |
| 14 | Markdown preview re-renders the whole file per keystroke | `markdownEditorPane.ts:91-116` | Once per frame |
| 15 | The icon registry repeats the same SVG wrapper 2,029 times (262 KB of a 657 KB file) | `iconRegistry.generated.ts` | Generate inner markup only; wrap at seed time (same strings out) |
| 16 | pdf.js (547 KB), highlight.js (304 KB) and jszip (96 KB) are parsed at every boot | `scripts/build.mjs:21-40` (one IIFE) | Own bundles, as `worksheet-univer.js` already does (Finish Plan, Track E) |
| 18 | The chat session list rebuilds every frame while streaming, even hidden | `chatSessionSidebar.ts:256-257` | Return early when hidden |
| 19 | No prepared-statement cache; default SQLite pragmas | `electron/database.cjs:192-216` | Statement LRU; `cache_size`, `mmap_size` |
| 20 | Five `"*"` extensions activate before the loading overlay lifts; the fifth is Study (489 KB), which only registers contributions | `ext/study/parallx-manifest.json` | `onStartupFinished` |

Items 17 and 21–25 (concept clustering, the Mermaid theme observer, the boot
chat-preview query, the Quick Open sort, Planner deletes, an unbounded map)
are small and listed in the raw report. Still open from the
2026-10-03 audit:
- vector-store deletes on unindexed columns;
- chat save rewrites every message;
- retrieval runs twice per turn;
- an unbounded embedding cache;
- Docling detection uses `execSync`.

### 2.3 The same thing written many times

| Helper or system | Copies | Same behavior? |
|---|---|---|
| Readability (the article extractor) | 3 (one file plus two pasted copies, 2,785 lines each) | No: two copies are garbled (B3) |
| HTML escape | 20 | **No:** they escape 3, 4 or 5 characters, and treat null three ways |
| "x minutes ago" | 12 | **No:** some round, some floor ("1h ago" at 31 minutes); B6 |
| Parse JSON from model output | 11 | **No:** the greedy `/\{[\s\S]*\}/` breaks on two objects or braces in prose; think-tag stripping differs |
| Pick a model | 11 | **No:** some throw, some return null; two ignore the model you chose |
| Stream with a stall watchdog | 4 | Close, not identical. The "LM API has no AbortSignal" comments are stale (`languageModelBridge.ts:66` takes one) |
| Debounce | 81 hand-written | No shared `debounce()` exists |
| Bytes, tokens, money, Title Case | 6–12 each | No: decimals and units differ; `\b\w` produces "Don'T" |
| Ollama HTTP client | 4 | Flashcards' copy ignores the setting (B5) |
| Participant service interfaces | 2 (`chat/chatTypes.ts:92-269` vs `openclawTypes.ts:227-520`, both named `IDefaultParticipantServices`) | Drifted |
| Color registry vs design-token registry | 2 (`theme/colorRegistry.ts:31-134` vs `designTokenRegistry.ts:30-129`) | Same class, different prefix |
| Flashcards ↔ Study | 22 function pairs (~414 lines) | 7 identical, the rest drifted |
| Schedulers | 7 clocks (Cron, Workflows, Planner reminders, Planner sync, Dashboard refresh, Heartbeat, Reflection) | Different jobs, same clock problem |
| Registries "Map + Emitter + register/get" | 5 identical modules (`taskSources`, `scheduleSources`, `quickOpenSources`, `questionProviders`, `chatContributions`) | Yes |
| Settings stores | 7 (SettingsRegistry, UnifiedAIConfig, AISettings, ParallxConfig, GlobalStorage, Configuration, raw `localStorage`) | Joined by bridges |
| Events | `Emitter` (319 uses), module-level listener Sets (12), 33 window `CustomEvent`s in three naming styles | No |

**Where differing copies matter:** when copies behave differently, merging
them is a behavior change, however small. Each merge in the plan starts with
a test that pins today's output of every copy; then we pick one behavior on
purpose.

### 2.4 Structure: where a beginner gets lost

- **"Tool" means three things.**
  - `src/tools` is the extension loader;
  - `src/built-in/chat/tools` holds AI tools;
  - root `tools/` holds side programs.
- **Chat lives in four places:**
  - `src/built-in/chat` (UI);
  - `src/openclaw` (the runtime);
  - `src/services/chat*.ts`;
  - `api/bridges/chatBridge.ts`.
- **Agents live in four places:**
  - `src/agent`;
  - `src/services/agent*Service.ts` (9 files);
  - `src/built-in/agents`;
  - `src/openclaw/agents`.
- **AI settings live in two places:** `src/aiSettings` and
  `src/built-in/ai-settings`.
- **`services/` is half utilities.** 56 of its 121 entries are not services;
  `localTime.ts` alone has 60 importers.
- **Duplicate file names:** two `chatTypes.ts`, two `iconRegistry.ts` and two
  `lifecycle.ts` (one is disposables, one is boot phases).
- **The core reaches into a feature.**
  - `services/chatService.ts` imports 8 files from `built-in/chat`.
  - 127 import edges break the `ARCHITECTURE.md` matrix, and no test checks
    it.
- **One unintended import cycle:** `dashboardEditorProvider.ts` ↔ its two
  drawers, only to share `createSelect`. There is also a 42-file type-level
  cycle through `serviceTypes.ts` and the two `chatTypes.ts`.
- **Services are created in 7 places** and wired with 82 `setX()` calls in
  `workbench.ts`. The order rules exist only in comments.
- **Dependency bags of 77 and 76 members**
  (`openclawParticipantServices.ts:8`, `IDefaultParticipantServices`).
- **Giant files:** 15 files over 3,000 lines.

  | File | Lines | Natural seams |
  |---|---|---|
  | `ext/media-organizer/main.js` | 39,252 | Its own 26-section table of contents |
  | `ext/flashcards/main.js` | 12,406 | model, data, ai, styles, one pane per route |
  | `ext/creations-ai/main.js` | 11,410 | Already uses 11 sibling modules; continue |
  | `ext/concept-lab/main.js` | 10,703 | kernel, one file per module, pane |
  | `ext/budget/main.js` | 9,397 | styles, sections, sync, chat tools |
  | `src/workbench/workbench.ts` | 4,268 | `Workbench extends Layout` makes one 6.2K-line class; boot phases are already marked |
  | `src/built-in/worksheet/main.ts` | 4,058 | One `createXPane` per file |
  | `src/built-in/chat/main.ts` | 3,782 | `activate()` alone is 3,390 lines with 9 natural sections |
  | `electron/main.cjs` | 3,273 | 85 IPC handlers into `electron/ipc/<area>.cjs`, shaped like `storageHandlers.cjs` |
  | `src/editor/panes/pdfEditorPane.ts` | 3,265 | A `pdf/` folder like `notebook/` |
  | `plannerEditorProvider.ts`, `canvasDataService.ts` | 3,150, 3,020 | Tabs and popovers; CRUD, autosave, trash, history |

- **Extensions can already be split.** `toolModuleLoader.ts:191-238` rewrites
  relative imports, and Creations AI does this today. Five extension headers
  still say "single-file constraint: blob URLs cannot resolve relative
  imports". That stopped being true on 2026-09-20, and the stale claim is why
  Readability was pasted twice and Atelier is one 39K-line file.

### 2.5 Readability

- **History in comments.**
  - 2,088 `src` comments and 399 `ext` comments carry milestone tags, dates,
    names or "used to".
  - 135 file headers tag a milestone on line 1.
  - Worst offenders: `chat/main.ts` (106), `workbench.ts` (89),
    `flashcards/main.js` (114), `media-organizer/main.js` (112).
  - Example: `chat/main.ts:360` reads "M58 W4 cron ↔ W2 heartbeat
    forward-link", then points to "§3d".
- **Stale pointers:** 7 of the 34 doc paths named in comments have moved.
- **Function size:**
  - 73 functions in `src` are over 200 lines, and 13 are over 500.
  - `budgetSync` (`ext/budget/main.js:7136`) nests 10 levels deep.
  - `executeOpenclawAttempt` is 555 lines with depth 6.
- **Types:**
  - 653 `any`, 196 `as any` and 105 `as unknown as`.
  - 383 inline `import('…').X` type references.
  - The 519 unit test files are never type-checked (tsconfig excludes
    `tests/`, and vitest doesn't check).
  - `ext/` and `electron/` have no type checking at all. That is how B1
    shipped.
- **Tooling:** there is no ESLint, Prettier, Biome or `.editorconfig`. The 12
  `eslint-disable` comments do nothing.
- **What is already good, and copied in the standard below:**
  - `services/deletePolicy.ts:1-14` (what, settings, why; no history);
  - the Creations `*-core.js` headers ("the Story Writer's pure half");
  - consistent quotes, semicolons and indentation everywhere.

---

## 3. Names that must never change

Renaming is safe for folders, files, functions and variables. It is **never**
safe for a string that is stored on disk or typed by a user. Where these
appear in code, the plan renames the constant and keeps the value, and marks
the line `// Persisted: never rename`.

- Command ids, setting keys, storage keys, extension ids and context-menu
  ids. Users' keybindings, button blocks and settings files name them.
  - This includes Creations AI's 9 `textGenerator.*` commands.
  - It includes Atelier's `media-organizer` id, its 30 commands, its settings
    and its data path.
  - It includes the `workflows.showPanel` alias.
- Database tables and migration files:
  - `mo_*` (40 tables), `st_*`, `fc_*`;
  - `flashcards_003_m98.sql` and every migration file name.
- AI config values:
  - `implementation: 'openclaw'` (`unifiedConfigTypes.ts:194, 565`, saved in
    presets);
  - the `'unified-ai.presets'` key;
  - the runtime kinds `'claw'`/`'openclaw'`;
  - the session flags `'openclaw.verboseEnabled'` and
    `'openclaw.reasoningOff'`;
  - `boundaryType: 'openclaw-workspace'`.
- Dashboard widget type ids (e.g. `parallx.dashboard.recent-files`), Routine
  job ids (e.g. `budget.sync.scheduled`), and the format of every generated
  id that is already stored.

**How a rename is proven safe:** the set of string literals in the build
(SQL, command ids, setting keys) is identical before and after.

---

## 4. The plan

Each phase is a run of small commits on `dev`. Every commit passes
`npx tsc --noEmit`, `npx vitest run` and `npm run build`. Each phase also
has its own proof that behavior did not change:

| Kind of change | Proof that nothing changed |
|---|---|
| Comments only | The minified bundle is byte-identical before and after |
| Renames | The set of string literals in the bundle is identical; `tsc` catches every missed import |
| Moving code between files | `tsc`, the full suite, and the `tests/ui-polish` app sweep (85 screenshots) unchanged |
| Merging copies that differ | A characterization test pins every copy's output first; the chosen behavior is named in the commit |
| Speed fixes | A test pins the output; a probe measures before and after |

Phases are ordered safest first, and each one makes the next easier.

### Phase 0: fix the bugs (behavior changes, each on its own)

B1–B8 from §1, one commit each, each with a test that fails first. B4 (my
Ctrl+P query) goes first, because I introduced it this week.

### Phase 1: guard rails first (tests and configs only)

Add the checks before the cleanup, so the cleanup can't slide back. All of
these use the repo's own ratchet pattern (a JSON baseline whose counts may
only fall, as in `extStyleRatchet.test.ts` and `coreToolMentionsRatchet`):
- **File-size ratchet:** 800 lines soft, 1,500 hard for new files; existing
  giants may only shrink.
- **Import-direction ratchet:** encodes the layer matrix, with a baseline of
  127 violations that may only fall.
- **Extension undefined-name check:** runs the TypeScript compiler over
  `ext/` with `checkJs`, keeping only "Cannot find name" errors. It takes
  about 3 seconds per extension and would have caught B1.
- **History-tag ratchet:** milestone tags in comments, per file.
- **`tsconfig.test.json`,** so tests are type-checked (`npx tsc -p
  tsconfig.test.json`). This will surface errors like B8's; fix them in the
  same step.
- **Prettier and ESLint configs that match today's style** (single quotes,
  semicolons, width 120), warn-only. They add dev dependencies, so run
  `npm install` once on your machine after pulling.

### Phase 2: delete dead code

In the dead-code audit's order, safest first:
1. One-off scripts and `normalize-icons.mjs`.
2. The four orphan files, the dead SKILL.md copies, and `IInitCommandServices`.
3. Unreferenced exports and the drifted keybinding copies.
4. CSS for deleted components, then the `aiSettings.css` orphans. Check these
   with the compliance tests and the app sweep.
5. Test-only modules, together with their tests.
6. Uncalled commands and IPC.

Then your product decisions from §2.1, and the npm dependencies on your
machine. That removes **about 3,100 lines for certain, up to 8,900 with the
likely ones.**

### Phase 3: make the docs and comments tell the truth

- **Rewrite `ARCHITECTURE.md`:** today's folder map, the layer rules (now
  enforced by Phase 1), a glossary (Routine = cron job = workflow, Atelier =
  media-organizer, Creations AI = text-generator), and "where to start
  reading".
- **A README in every top-level folder,** 20 lines or fewer: what is here, the
  entry file, what it may import, and what it may not.
- **Fix the stale facts:**
  - the five "single-file constraint" headers;
  - the 7 moved doc paths;
  - the stale "no AbortSignal" comments;
  - the duplicate paragraph at `chat/main.ts:372-385`;
  - core comments that name optional tools.
- **Strip history tags from comments,** headers first, then the files with
  the most tags. A comment says what the code does now and why; history
  lives in git. Proof: the minified bundle is byte-identical.

### Phase 4: one shared helper per job

Start with characterization tests, because the copies differ.
- **Core:**
  - a `src/ui/format.ts` for escape, bytes, tokens, Title Case and money;
  - `relativeTime` with a "day" style, on the app Time Zone;
  - `debounce()` and `sleep()` in `platform/`;
  - `newId()`, keeping today's stored formats;
  - `modelJson.ts`, generalizing Flashcards' bracket scanner, which is the
    one that handles two objects correctly.
- **For extensions:**
  - `api.ui.escapeHtml`, `formatRelativeTime`, `formatBytes` and `debounce`;
  - `api.env.dayKey` and `startOfDay`;
  - `api.lm.pickModel`, `stream` (with the stall watchdog and abort) and
    `parseJson`.

  Then move one extension at a time onto them. These are contribution-point
  style helpers, so the core still names no tool.
- **Merge the twins:**
  - the participant interfaces and the 276-line adapter that copies them
    field by field;
  - the color and design-token registries;
  - the semver check;
  - the `agentTaskStore` loader (5 copies);
  - one generic `createSourceRegistry<T>()` for the 5 identical registries.
- **Readability:**
  - Web Research imports its own `./readability.js` (fixed in Phase 0)
    instead of carrying a pasted copy.
  - Browser imports its own copy of the same fixed file. Net, that removes
    about 2,800 lines and leaves one source to update.
- **Flashcards and Study share an `ext/_shared/assessment.js`,** copied into
  each at build time like `bundle-study.mjs` (a plain `../_shared` import
  breaks once each is installed as its own `.plx`). A staleness test guards
  it.

### Phase 5: the speed fixes

§2.2 in order, #1–#20, each with its output pinned by a test and measured
by a probe before and after. Most are 10–40 line changes.

### Phase 6: split the giants (moving code, not changing it)

- **TypeScript first:**
  - `serviceTypes.ts` into `services/types/<area>.ts` behind the same barrel,
    so none of its 112 importers change;
  - move `createSelect` out, which ends the dashboard cycle;
  - each built-in's manifest into its own folder (all 18 sit in one 710-line
    file today).
- **Then by seams:**
  - worksheet panes;
  - a `pdf/` folder;
  - the planner tabs;
  - `canvasDataService` helpers;
  - `electron/main.cjs` into `electron/ipc/*.cjs`.
- **Then the two big activations:**
  - chat's `activate()` into `activation/wire*.ts` steps;
  - `Workbench` boot phases into `shell/boot/*.ts`.

  One section per commit.
- **Then extensions as real ES modules,** leaf code first (CSS strings, SQL,
  pure logic), then UI areas with shared state in a `state.js`.
  - Atelier goes along its own 26-section table of contents. Its six
    `@mo-*-pure` regions, which tests cut out of the file with
    `new Function`, become real modules the tests import.
  - Then Flashcards, Creations, Concept Lab, Budget.
  - B2 is fixed first, so packaging includes every file.

### Phase 7: rename for meaning (one rename per commit)

- `openclaw/` → `chat-runtime/`, and the `openclaw*` prefixes → plain names
  (`runDefaultTurn`, `turnAttempt.ts`). Persisted values stay (§3).
- Utilities out of `services/` into `platform/` (`localTime` and friends),
  so `services/` holds only services.
- One home each for chat, agents and AI settings. One spelling per folder.
- `m70CommandPolicy.ts` → `aiCommandDenylist.ts`. Milestone-named tests are
  renamed by subject. The duplicate file names get distinct names.
- Extension prefixes (`mo`, `fc`, `st`, `cl`, `tg`) → plain names, using the
  language-service rename. Proof: the set of string literals is identical.

### Phase 8: format once

Prettier, one folder per commit, with each commit listed in
`.git-blame-ignore-revs` so `git blame` skips them.

### Phase 9: errors that say what went wrong (visible change)

- Every swallowed error in a user action or a write either shows the user or
  logs with context.
- Every remaining empty `catch` says why it is safe.
- A ratchet keeps new bare catches out.

This changes what the user sees when something fails. That is the point,
but it is called out here because it is not "no change".

### Phase 10: one way to do each structural job (riskiest, last)

Each of these is its own decision:
- **Events:** `Emitter` everywhere; window `CustomEvent`s become typed
  service events or commands.
- **Logging:** a `createLogger('Prefix')` replaces 792 `console.*` calls with
  147 different prefixes.
- **Schedulers:** one clock in CronService. Planner reminders subscribe as a
  contribution, so they stop when Planner is off. That also serves the first
  principle.
- **Settings:** one registry; the other stores become adapters; `localStorage`
  goes through storage.
- **Service wiring:** created in one place, in named phases, instead of 7
  places and 82 setters.

---

## 5. The standard every file follows afterwards

This is short enough to keep in `docs/CODE_STYLE.md` and to check in review.

- **File header:**
  `// <file> — <what it is for>.` followed by 2–6 lines covering who uses it,
  what it owns and its rules, in present tense. Optionally one
  `Modeled on: <project>/<path>` line. Add a `Persisted ids:` line when it
  has any.
- **Comments:** what the code does now and why. No milestone tags, dates,
  names or "used to"; that history goes in commit messages. Doc links must
  exist, and a test checks them.
- **Names:** whole words, no module prefixes. Name folders and files for
  what they do, never for a milestone or a source project. One idea, one
  word, kept in the glossary. A persisted value is never renamed; only its
  constant is.
- **Size:** a file stays under 800 lines (1,500 at most) and a function under
  80. Nesting goes at most 4 deep, lines at most 120 characters. CSS lives in
  its own module.
- **Errors:** catch only what you expect, and say why a swallowed error is
  safe. Failures of something the user asked for are shown to them.
- **Types:** no new `any` or `as unknown as`. Extensions get `// @ts-check`
  plus JSDoc on exports, file by file, starting with the pure `*-core.js`
  files.
- **One way to do each job:** `Emitter` for events, `Disposable` +
  `_register` for cleanup, `createSourceRegistry` for registries, the
  settings registry for settings, `createLogger` for logs.

---

## 6. Size and order of work

| Phase | Risk | Rough size | Behavior change? |
|---|---|---|---|
| 0 Bugs | Low | 8 commits | Yes: broken → working |
| 1 Guard rails | None | 5–6 commits | No |
| 2 Dead code | Low | 8–10 commits | No |
| 3 Docs and comments | None | ~15 commits | No (bundle byte-identical) |
| 4 Shared helpers | Low–medium | ~25 commits | Only where copies differed, by choice |
| 5 Speed | Low–medium | ~20 commits | No (faster) |
| 6 Split giants | Medium | ~60 commits | No |
| 7 Renames | Low (mechanical) | ~15 commits | No |
| 8 Format | None | ~20 commits | No |
| 9 Errors | Low | ~10 commits | Yes: failures become visible |
| 10 One way per job | Medium–high | Per decision | No, if done right |

**Recommended start:** Phases 0–2 in one session. They fix real bugs, put
the guard rails in, and take out the dead weight. Every later phase gets
easier and safer because of them.

The raw audit reports (with every file:line) were written during the audit
session; anything in them not listed here was judged too small to plan for.
