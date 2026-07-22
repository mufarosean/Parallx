# Milestone 93 — Automations, Print-to-PDF, Flashcards

> **Status: BUILT** (2026-07-22, single autonomous session; tsc + targeted unit
> suites green; verified by static analysis + vitest only — **needs in-app
> verification** for all three features).
>
> Three user ideas, built in priority order:
> 1. **Planner Automations** — user-created AI cron jobs with a friendly UI
> 2. **Canvas PDF export** — a real ctrl+p for canvas pages
> 3. **Flashcards extension** — full spaced-repetition system

---

## 1. Planner Automations (idea 1)

**What it is.** A third planner section (sidebar row + editor tab) where the
user schedules jobs *the app runs for them*: "refresh my dashboard every
morning at 8", "post a daily digest", "review new pages weekly". These are
NOT calendar items and never sync to Google — each automation is a prompt the
AI executes in the background on schedule.

**How it works.** The tab is a human-friendly face over the existing
workspace `CronService` (openclaw D4):

- Creating an automation calls `CronService.addJob` with
  `payload.agentTurn = <prompt>` — the M58 ephemeral-session substrate runs
  it as an isolated agent turn, so the prompt can be *anything the AI can do
  in the app* (widgets, canvas, planner, chat tools, extensions).
- Schedule builder: daily-at-time / weekly / interval / once / raw cron,
  converted by pure helpers in `plannerAutomations.ts`
  (`buildCronSchedule` / `specFromSchedule` / `describeSchedule`).
- **Missed runs**: nothing new was needed — CronService already coalesces
  firings missed while the app was closed into ONE catch-up at next launch
  (`loadFromPersistence` + `_runMissedJobs`). The tab documents this.
- **Autonomy**: nothing new was needed — every cron firing already goes
  through the autonomy dial's cron flag and lands in the Autonomy Log with
  trigger kind `cron`.
- Planner-owned job ids persist in `planner_settings` (`automations.ids`),
  stale-cleaned on render. All OTHER cron jobs (AI `cron_add`, extension
  upserts like budget) appear in a collapsed "Other scheduled jobs" section
  with enable / run-now / delete. The AI Hub "Scheduled jobs" section shows
  the same jobs — both UIs subscribe to `onDidChangeJobs`.
- One-shot automations set `deleteAfterRun`.

Files: `src/built-in/planner/plannerAutomations.ts` (new),
`plannerSidebar/plannerNavState/plannerEditorProvider/main.ts` (tab wiring),
`planner.css`. Tests: `tests/unit/plannerAutomations.test.ts` (23).

**Answer to the related question** ("Autonomy creates planner tasks — how
does a user activate these?"): heartbeat follow-ups are captured as planner
tasks with status `reviewing` (`captureHeartbeatTask`, tag `heartbeat`,
`parallx-heartbeat://` sourceUri). They surface in **Planner → Tasks →
Review queue**; the user "activates" one by giving it a real date (status
`planned`) or completes/cancels it there.

## 2. Canvas print-style PDF export (idea 2)

**What it is.** `Ctrl+P` in a canvas editor (or page ⋯ menu → Export PDF)
opens an export dialog: paper size (A4/Letter/Legal/A3/A5/Tabloid),
orientation, margin presets + custom per-side mm, scale 40–200%, page
numbers, include-title, print-backgrounds. The right side is a REAL
preview — every change re-renders the actual PDF and paints its pages with
pdf.js, so preview and saved file are byte-identical.

**Pipeline (the "no cutoff" contract).**

1. Clone the LIVE `.ProseMirror` DOM — rendered KaTeX, highlighted code,
   checkbox state, columns all come along for free.
2. `sanitizeContentHtml`: strip editor chrome (drag handles, gap cursors,
   math editors, hover previews), freeze checkbox state into attributes,
   force-open `<details>` (collapsed content must print), drop scripts /
   iframes / event handlers.
3. `buildPrintHtml`: standalone light print document; katex + highlight.js
   light theme linked from `node_modules` when available (graceful without).
4. Main process `pdfExport:render`: hidden **sandboxed** BrowserWindow
   (no node, no preload, navigation denied), waits for fonts + image decode,
   then `webContents.printToPDF` — Chromium paginates.
5. Print CSS: `overflow-wrap: anywhere`, `pre-wrap` code, `max-width:100%`
   images, `thead { display: table-header-group }` (headers repeat across
   pages), `break-inside: avoid` on callouts/images/math/page-chips.

Keybinding goes through the ONE KeybindingService with
`when: "activeEditor == 'canvas'"` — Quick Open keeps Ctrl+P everywhere
else (Ctrl+P is not reserved; last-registered + when-scoped wins).

Files: `electron/main.cjs` (`pdfExport:render`), `electron/preload.cjs`,
`src/built-in/canvas/export/{printHtml.ts,pdfExportDialog.ts,pdfExport.css}`,
`pageChrome.ts` (menu + `exportPdf()`), `canvasEditorProvider.ts` (handler
routing), `canvas/main.ts` (command + keybinding). Tests:
`tests/unit/canvasPdfExport.test.ts` (27).

## 3. Flashcards extension (idea 3)

**What it is.** `ext/flashcards/` — a full spaced-repetition system:

- **Create**: manual (deck browser inline form), or AI-generated from a
  **canvas page** (new cross-extension command `canvas.getPageMarkdown`),
  a **PDF/document** (`document.extractText`), a **photo**
  (Docling OCR, `docling.convert {ocr:true}`), or pasted text. Generated
  cards land in an editable review list — nothing saves until "Import".
- **Study**: SM-2 scheduler, Anki-flavoured — learning steps 1m/10m,
  graduate 1d (Easy 4d), review growth by ease, Hard 1.2x / ease −0.15,
  lapse → relearning with halved interval + ease −0.2 (floor 1.3). Queue:
  due learning → due reviews (most overdue first) → new, with daily
  new/review limits from settings. Grade buttons show interval previews;
  keyboard: Space reveal, 1–4 grade (container-scoped, no global listener).
- **Discuss with AI**: side panel on any revealed card — streams the
  configured/active local model with the card as system context.
- **Resurfacing**: due-count badges in the sidebar; a `Flashcards due`
  dashboard widget (query category, 15-min refresh, "Study now" button);
  chat tools `flashcards.createCards` / `flashcards.getDue` /
  `flashcards.getStats` so the AI can make cards from any conversation and
  nudge about workload; optional **daily reminder** setting that upserts an
  autonomy-gated cron job (`flashcards.daily-reminder`) whose agent turn
  calls `flashcards.getDue` and nudges via chat.
- **Progress**: stats view — reviews today + correctness, 30-day retention
  (review-state reviews only; learning failures excluded), stage counts,
  30-day bar chart. Append-only `fc_reviews` log is the source.
- **Links**: `parallx://flashcards/deck/<id>` and `parallx://flashcards/study`
  registered through the links contract → citable everywhere.

Storage: per-extension SQLite (`fc_decks` / `fc_cards` / `fc_reviews`,
migration `flashcards_001_initial.sql`); SM-2 state inline on the card row.
Settings via manifest configuration schema (daily limits, model override,
reminder toggle + time). Pure logic exported via `__testables` (budget
pattern). Tests: `tests/unit/flashcards.test.ts` (32).

## Verification

- `tsc --noEmit` clean; `node scripts/build.mjs` clean (renderer bundles,
  CSS imports, dynamic imports all resolve).
- 94 new unit tests across the three features; full suite green (4405).
- `tests/unit/flashcardsBehavior.test.ts` — headless BEHAVIORAL suite in the
  M92 harness spirit: drives the REAL ext/flashcards/main.js (activate →
  sidebar → deck browse → add card → study/grade with SM-2 persistence →
  canvas-source AI generation → editable review → import → chat tools →
  reminder cron sync) against a faithful bridge fake whose database runs the
  real migration SQL on in-memory node:sqlite.
- **Not yet verified in-app** (no visible probes policy): planner tab
  rendering, actual PDF output fidelity, extension activation. First manual
  pass should check: (1) Automations tab lists/creates jobs and the AI Hub
  mirrors them; (2) Ctrl+P in canvas → preview renders → exported PDF has
  correct margins and no clipped content (test a page with a wide table,
  code block, KaTeX, columns, and a collapsed toggle); (3) flashcards
  end-to-end: generate from a canvas page → review/import → study →
  stats move.
