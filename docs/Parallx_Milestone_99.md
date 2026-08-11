# Parallx Milestone 99 — Worksheets (Exam-Faithful Practice Sheets)

> **Status: IN PROGRESS** (started 2026-08-11, branch `m99-exam-sheet`)
> Research base: docs/research/CAS_Pearson_Spreadsheet_Environment.md
> (captured 2026-07-27 — Athena anatomy, constraints, screenshots, function list).

A practice surface that mimics the Pearson VUE Athena spreadsheet used on CAS
upper-level exams: work constructed-response items under the REAL tool's
constraints instead of desktop-Excel muscle memory. Generic substrate surface
("Worksheets": bounded sheet items with givens + solutions, any drill domain);
Exam 7 is the first user via AI generation from the user's own materials.

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
4. **Function allowlist:** parse Pearson XLSX (checked into docs/research/
   assets), disable/flag non-Athena functions.
5. **AI generation:** create-from-source tab (PDF/canvas/paste), structured
   item JSON, review-before-save.
6. **AI Review My Work:** serialize attempt cells + solution → LM critique
   (stall-guarded, M98 pattern).

## Landmines (from memory)

- npm on this machine: `NODE_OPTIONS=--use-system-ca npm install --ignore-scripts`
  (Norton TLS). Univer is pure JS — skipping scripts is safe.
- Editor panes REBUILD on every tab switch — Univer instance must dispose
  cleanly and restore via view-state hooks or it will leak/flash.
- Settings via schema registry; Title Case action labels; --px tokens; ONE
  dropdown primitive; no em dashes in UI copy.
- Do not touch ext/media-organizer (concurrent session).
