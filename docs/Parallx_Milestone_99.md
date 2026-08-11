# Parallx Milestone 99 — Worksheets (Exam-Faithful Practice Sheets)

> **Status: BUILT** (2026-08-11, branch `m99-exam-sheet`, through 02d3a321).
> tsc clean, build clean, engine-isolation verified (0 Univer bytes in
> main.js), full suite green, 13 item-format tests + review-fix pass done.
> PENDING: in-app verification by Mufaro (never rendered on screen), and the
> review items below.
> Research base: docs/research/CAS_Pearson_Spreadsheet_Environment.md
> (captured 2026-07-27 — Athena anatomy, constraints, screenshots, function list).

## Review triage (2026-08-11)

Adversarial review: 5 of 7 finders ran (worksheet-engine + integration
finders AND all verifiers died on session usage limits — findings were
triaged inline instead). 59 findings: the critical (runTransaction ops
missing type:'run') and ~12 majors are FIXED (commit 02d3a321). Deferred,
recorded honestly:
- saveAttemptCells is get-then-write, not atomic (single-pane usage makes
  collisions unlikely; two split panes on one item could interleave).
- deleteItem does not close open panes on that item; a late autosave can
  recreate an attempt row for a deleted item (FK cascade removes on next
  delete; cosmetic).
- Migrations path joins appPath + src/built-in/... — breaks under a packaged
  asar build. SAME pattern as planner; belongs to the packaging milestone.
- deckSchedOpts snapshot taken at study-session start (exam date edited
  mid-session applies next session).
- ~40 minor findings (naming, comments, cosmetic edge cases) unaddressed;
  full list in the session scratchpad (m98m99-findings.json).

A practice surface that mimics the Pearson VUE Athena spreadsheet used on CAS
upper-level exams: work constructed-response items under the REAL tool's
constraints instead of desktop-Excel muscle memory. Generic substrate surface
("Worksheets": bounded sheet items with givens + solutions, any drill domain);
Exam 7 is the first user via AI generation from the user's own materials.

**Product framing (Mufaro, 2026-08-11):** "We are building a unique app here.
The base of which is the CAS thing, but the final product will be very
Parallx. A tool to generate, create, practice material, practice it, track it
cleanly, with the full backing of AI." Worksheets is that loop end to end:
generate (AI from your materials) → create (review-and-edit before save) →
practice (exam-faithful surface) → track (attempts, grades, per-tag progress)
→ AI backing (generation, review-my-work, chat tools that SEE the bank and
the user's actual cells). Keep every layer generic — CAS is the first tenant,
never the product.

## Decisions (settled with Mufaro 2026-08-11)

- **Formula engine: Univer (`@univerjs/presets`, Apache-2.0).** Never hand-roll
  a formula engine. License permissive → packaging-safe. Pure JS → runs on
  every device Parallx runs on.
- **Items are AI-generated** from past exams / Rising Fellow cookbooks (reuse
  the flashcards generation pattern: source loaders, page-tagged prompting,
  review-before-save). Items + solutions live in the app (SQLite).
- **No automatic grading.** CAS grades method + answer; auto-scoring would be
  false precision. Flow: work the item → reveal model solution → self-assess.
  Plus "AI Review My Work": sheet cells + model solution → AI critique as
  FEEDBACK, explicitly never a score.

## Architecture

- **Built-in tool `src/built-in/worksheet/`** — NOT an ext/. Verified: external
  tools load as single-file blob-URL modules (src/tools/toolModuleLoader.ts:70-84,
  blob imports cannot resolve relative/npm specifiers), so a bundled engine
  can only ride the main esbuild pipeline. Built-ins get full npm imports.
- Univer loaded lazily when a worksheet pane first opens (dynamic import;
  enable esbuild code-splitting if the current single-file output allows,
  else accept main-bundle growth).
- **Athena fidelity constraints** applied over Univer: 150 rows × 40 cols,
  single sheet, no tabs, function ALLOWLIST validated against Pearson's
  "Athena Spreadsheet Function Comparison" XLSX (link in research doc),
  fenced given-data region (protected ranges + heavy border), question text
  above the grid, Reset Sheet (restore item snapshot; confirm dialog),
  no file ops, default font Aptos Narrow 11 (fallback stack).
- **Item schema (SQLite, per-workspace like flashcards):** ws_items(id, title,
  question_md, givens_json (cell grid snapshot), solution_json (solved grid),
  solution_notes_md, source_uri/source_label/source_page (M98 provenance
  pattern), tags, created_at) + ws_attempts(item_id, started_at, cells_json,
  self_grade, ai_review_md).
- **Generation:** source loaders reused conceptually from flashcards (PDF
  page-tagged extraction); model emits question + givens layout + solution
  steps as structured JSON; review-before-save like the flashcards Create tab.
- **Connective tissue:** planner day-load provider (M98 seam) can later report
  practice sessions; "send stumble to flashcards" via flashcards.captureSelection.

## Slices

1. **Engine embed — BUILT.** @univerjs/presets 0.25.1; the engine builds as
   its own lazily-imported esm bundle (dist/renderer/worksheet-univer.js,
   16.8mb dev — verified ZERO Univer bytes in main.js). Constrained preset:
   single sheet, no tab footer, no statistics strip, ribbon + formula bar on.
   150×40 blank sheets. Scratch snapshots survive pane rebuilds via cache.
2. **Item store + player — BUILT.** ws_items/ws_attempts in the workspace
   SQLite (migrations/worksheet_001_initial.sql, planner pattern); home
   browser (instanceId 'home') with state chips; player (instanceId
   `item:<id>`): question above the grid, open-attempt restore, 5s autosave +
   capture on dispose, confirmed Reset Sheet. Fidelity note: Athena does NOT
   lock given cells — neither do we; borders fence, Reset recovers.
3. **Solution flow — BUILT.** Reveal Solution swaps the sheet to the model
   solution (work persisted first), Show My Work swaps back; first reveal
   asks Nailed It / Partially / Missed It and closes the attempt; Try Again
   starts a fresh attempt from the givens. Attempt history accrues.
4. **Function allowlist — BUILT.** Pearson workbook downloaded + checked in;
   scripts/generate-athena-allowlist.mjs emits athenaFunctions.ts (523
   functions; refuses <200 if the layout shifts). Host unregisters non-Athena
   executors AND descriptions → real #NAME? + no autocomplete temptation.
   Degrades to extra-functions-available, never a broken sheet.
5. **AI generation — BUILT.** Models emit a flat cell format (A1 refs,
   values/formulas, bold flags) — never raw IWorkbookData; itemFormat.ts
   validates refs against the grid, strips formulas from givens, tints the
   given region, layers the solution. Generate pane: PDF drop (page-tagged →
   per-item page attribution) or paste, guidance + count, review-and-edit
   before save. 13 pure-logic tests.
6. **AI Review My Work — BUILT.** Attempt + solution serialize to A1 lines;
   method-level critique streamed into the solution view and saved on the
   attempt. Feedback, never a score.
7. **Workbook model — BUILT (2026-08-11, Mufaro's redesign).** Items are
   WORKBOOKS: `GeneratedItem.parts[]`, one sheet TAB per part ((a), (b)...),
   footer tab bar ON (deliberate deviation from tabless Athena — his call:
   "treat more as workbooks with questions on different tabs"). Part
   questions are written ONTO the sheet (merged wrap block rows 1-4, plain
   text, height estimated from length; cells reserved to row 6+, violators
   dropped) — "better to have them directly on the page". The pane header
   question renders only for legacy items (workbookHasOnSheetQuestion).
   Generation prompt emits the parts shape; extraction folds the legacy
   flat shape into one part. serializeWorkbookCells labels tabs; Export to
   Excel writes every tab with merges. Explorer drag FIXED: the tree sets
   effectAllowed='move' and the drop zones answered 'copy' — Chromium
   refuses that pairing and never fires drop (also fixed in flashcards'
   two drop zones). e2e: real tree-node drag + multipart-tabs test; the
   grid right-click bug stopped reproducing (test.fail() pin flipped loud,
   now asserts the menu opens).
8. **Sheet theme + AI visibility + journal — BUILT (2026-08-11).**
   - `worksheet.sheetAppearance` setting ('light'|'dark'|'app', default
     LIGHT — Athena is always white; Mufaro: "user may want dark mode for
     UI, but worksheet as light mode"). The PANE owns theme now: univerHost
     takes explicit `darkMode` + exposes `setDarkMode`, its app-observer
     moved pane-side (fires only in 'app' mode). A Sheet Theme button on the
     scratch bar and item header flips light↔dark live across every open
     pane (module-level listener set) and persists via the config registry.
   - Chat tools (worksheetChat.ts, registered via api.chat.registerTool,
     flashcards pattern): `worksheet.getProgress` (bank listing + per-tag
     rollups of attempted counts and latest grades) and
     `worksheet.getUserWork` (question + the user's ACTUAL cells via
     serializeWorkbookCells + model solution + prior AI review; lookup by id
     or fuzzy title). Both read-only, no confirmation. 5 pure-logic tests
     on the report builders.
   - Activity journal: api.activity.note on the three meaningful events —
     'generated' N items (source label), 'practiced' item (self-grade),
     'reviewed' attempt (AI feedback saved). Heartbeat/wake context now sees
     practice activity like any other organ.

## Fidelity backlog (screenshot comparison vs pearson_sheet_item5.png, 2026-08-12)

Compared the live item player against the real Athena item capture:
1. Question block: Athena carries a POINT VALUE ("2.25 total points") and
   structured given-prose above the task. Add `points` to ws_items +
   generation prompt; render under the title.
2. Givens INSIDE the sheet are bordered TABLE BLOCKS (header row, label/value
   pairs, right-aligned FORMATTED values: 10.0%, 40,000, July 1 2023) with a
   heavy vertical rule fencing the work area. itemFormat needs: block border
   styles around contiguous given regions, number-format hints per cell
   (percent/comma/date), column-width hints. Currently: tint + bold only.
3. ~~Athena's sheet is ALWAYS WHITE~~ RESOLVED 2026-08-11: per-surface
   `worksheet.sheetAppearance` setting (default light for exam fidelity)
   with a Sheet Theme toggle on every sheet — see slice 7.
4. Ribbon label "Start" vs Athena "HOME"; tab set differs (no Insert/View).
   Univer menu config could rename/extend later; low priority.
   ALIGNMENT fixed 2026-08-11 (user report): Univer's classic ribbon centers
   the tab + icon rows; scoped worksheet.css overrides left-align both.
5. ~~Grid right-click menu does not open~~ FIXED 2026-08-11 as a side
   effect of the CSS/config fixes (exact trigger not isolated; the pinned
   test.fail() flipped loud and now asserts the menu opens).
6. FIXED 2026-08-11 (user screenshot: phantom dark mini-toolbar over the
   sheet): Univer tooltips are body-portaled, dismiss ONLY via the trigger's
   mouseleave, and strand with pointer-events:auto when ribbon relayout
   unmounts the trigger. univerHost now tracks the pointer and hides any
   tooltip >64px from it on a 700ms interval, plus hides leaked body portals
   when univer.dispose() throws during pane teardown.

## Next feature: practice sessions (ADAPT-style)

Settled direction: Start Practice Session → filters (tags, source, state,
difficulty) + count + shuffle → serve items sequentially → session summary
with per-tag breakdown. Difficulty: AI-estimated at generation + earned from
attempt outcomes. Chat tools (worksheet.listItems/getProgress) expose the
bank to the AI the way flashcards.getDue does.

## Landmines (from memory)

- npm on this machine: `NODE_OPTIONS=--use-system-ca npm install --ignore-scripts`
  (Norton TLS). Univer is pure JS — skipping scripts is safe.
- Editor panes REBUILD on every tab switch — Univer instance must dispose
  cleanly and restore via view-state hooks or it will leak/flash.
- Settings via schema registry; Title Case action labels; --px tokens; ONE
  dropdown primitive; no em dashes in UI copy.
- Do not touch ext/media-organizer (concurrent session).
