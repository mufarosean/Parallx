# Problem Bank: replacing the ProblemTrack workbook

Charter for turning the Exam 7 practice-problem workbook into a Parallx
surface. Written 2026-09-08 from a copy of
`Exam 7 Workbook - 2026 Fall Locked.xlsm` (Rising Fellow "ProblemTrack",
6.4 MB, 340 sheets); the original was never opened for writing.

## What the workbook is

| Part | Count | What it holds |
| --- | --- | --- |
| Problem sheets | 331 | One problem per sheet, named `Paper.Source_NN`. 207 Rising Fellow problems, 110 past CAS exam problems, 14 essay sheets. 15 papers (Brosius, Clark, Friedland, Hurlimann, Mack 1994, Mack 2000, Marshall, Meyers, Sahasrabuddhe, Shapland, Siewert, Taylor, Teng, Venter, Verrall). |
| Visible control sheets | 3 | Dashboard (charts, paper picker, custom-problem maker, reset), Instructions, Quiz Generator. |
| Hidden machinery | 6 | `Problems` (index of every sheet with derived columns), `Dashboard_Data` (per-paper counts and a daily timeline), `Template` (blank custom problem), `Quiz Template`, `Shapland Q&A`, `Flashcards` (Front, Back, Tags). |

A problem sheet: title in A1, a Self-Rating dropdown in E1 (Unrated, Easy,
Medium, Hard), the question and givens at the left, a `SHOW ALL WORK.` row
under which the student works, and the worked solution with live formulas
to the right of a `Solution ->` marker in row 1.

## How it works (VBA, about 600 lines)

- **Rating is stored as a tab colour.** Changing E1 colours the sheet tab
  (`Workbook_SheetChange`); `CheckSheetTabColors` later reads the tab
  colours of all 331 sheets back into the `Problems` index. Buttons unhide
  sheets by paper, by rating, or by type (`UnhidePaper`, `UnhideByRating`,
  `UnhideByType`).
- **Dashboard refresh is manual.** `DashboardRefresh` re-lists custom
  problems, reads tab colours, and writes today's row of the timeline
  (`UpdateTimeline`), then saves. Per paper: attempted % and a score of
  Easy x 1, Medium x 0.5, Hard x 0 over rated problems, computed by
  COUNTIFS over the index. Nothing moves unless the button is pressed:
  eight snapshots exist since 2026-07-14; the last, 2026-09-06, reads
  18% attempted, score 0.42.
- **Quiz generation is a random draw frozen into a new file.** The Quiz
  Generator sheet holds the filters (include per paper, quantitative or
  qualitative, CAS or Rising Fellow or custom, Easy, Medium, Hard,
  Incomplete) and a count. `Problems!K` is `RAND()` times the filter
  test, `L` ranks it; `CreateCustomQuiz` copies `L` into `M` to freeze the
  draw, then copies the top N sheets into a new workbook, wipes the work
  area and the whole solution column, resets the rating, renames the
  sheets Q1..Qn, and saves `Quiz_<timestamp>.xlsx`. Two such files exist.
  Grades given inside a quiz file never return to the master workbook.
- **Custom problems** clone `Template` as `<Paper>.Custom_NN` and register
  it in the index. **Reset** wipes work or ratings per paper after
  offering a backup copy.
- A 700-line Dictionary class exists only so the macros run on a Mac.

## Why it is slow and lossy

- State lives in 331 tab colours and 331 E1 cells; every metric is a
  COUNTIFS over all of them, plus a `RAND()` per row that recalculates on
  every edit. The calc chain alone is 225 KB.
- Progress is recorded only when the refresh button is pressed, once per
  day at most, and only as two numbers.
- A quiz is a detached file with the solutions stripped; its results are
  lost to the dashboard, so the timeline undercounts real work.
- No notion of "due": a problem rated Hard is never brought back on a
  schedule. No time per problem. No search across problems.
- Single file on OneDrive: a `data-DESKTOP-...` copy already shows a sync
  conflict in this workspace.

## What Parallx has today, and why it went unused

M99 Worksheets (src/built-in/worksheet) has the right engine and the wrong
shape. Mufaro's verdict, 2026-09-08: disjointed, formatting lost on import,
multiple sheets do not work, and he has not been using it.

- **The engine is right.** Univer carries the full Excel style model
  (fonts, fills, borders, number formats, alignment, wrap, merges, hidden
  columns, row heights) and the Pearson function allowlist covers every
  function the solutions use. Presets for floating images, conditional
  formatting and data validation are installed.
- **The import is the gap.** It reads through SheetJS community edition,
  which drops every style. The problem sheets are ALL style: 2,899 cell
  styles, 115 fonts, 62 borders, 57 number formats, every one of the 7,000
  cells on a typical sheet styled, 2,144 merges, 2,079 custom row heights,
  527 hidden columns. It also drops the 383 text boxes (208 carry the
  problem's equations, set in Unicode maths) and the 45 pictures on 30
  sheets. Run today it detects 316 of 331 problems, then flattens them.
- **The item model fights the material.** Import splits each sheet into a
  givens workbook and a solution workbook; Reveal Solution REPLACES the
  mounted sheet with the solution snapshot, so the student's own work
  vanishes at the moment it should sit beside the answer. Generated items
  put question text in a merged block and cells on separate tabs; imported
  ones do not. Two models, one surface, neither the workbook's.
- **Navigation is a home page with buttons** (Practice Items, Generate,
  Import, Start Practice Session), not the bank.

## The redesign: Problem Bank

One rule: a problem in Parallx is the sheet from the workbook, pixel for
pixel, worked the way the workbook is worked. Everything else hangs off
that.

1. **One sheet per problem, as it is.** The problem's own sheet, with its
   styles, merges, widths, heights, hidden columns, pictures, and its text
   boxes written into their anchor cells (Univer has no text boxes). The
   solution columns to the right of the "Solution" marker are hidden until
   Reveal, which unhides them next to the student's work, exactly like the
   workbook. The work area is the region under the "Show All Work" row. No
   givens-versus-solution split, no tabs. The Self-Rating cells and their
   validation and conditional format are the only things stripped.
2. **Our own OOXML reader.** SheetJS cannot carry styles, so the importer
   reads the xlsm parts directly (the app already ships jszip): styles.xml
   (cellXfs, fonts, fills, borders, numFmts) into Univer style objects,
   sheet XML into cells, merges, column and row data, drawings into images
   and anchored text. Pure, unit-tested against the copied workbook.
3. **ProblemTrack's vocabulary, kept.** Ratings are Easy, Medium, Hard.
   Filters are paper, source (Rising Fellow, CAS, custom), type
   (quantitative, qualitative, essay), rating, and incomplete. Quadrant
   (the vendor's Easy/Difficult x Likely/Unlikely priority) is imported
   from the index and is a filter too. His 62 existing ratings come over.
4. **Quizzes are sessions, and they feed the dashboard.** A quiz is N
   problems drawn by those filters, worked in order with a timer, each
   rated at the end; ratings and times land on the problems, so the
   dashboard moves without a refresh button. Export to .xlsx stays
   available for the day he wants real Excel.
5. **Dashboard as an editor tab.** Per paper: attempted %, the workbook's
   weighted score (Easy 1, Medium 0.5, Hard 0) so his numbers stay
   comparable, time spent, a timeline drawn from every rating, and a due
   list (Hard back in 3 days, Medium in 7).
6. **Sidebar is the bank.** Papers with counts and rating colours (the
   workbook's tab colours), search across problem text, and a custom
   problem is a copy of the workbook's Template sheet.

Generation from PDFs stays as a way to add problems to the same bank; it
adopts the one-sheet model.

## Build order

1. DONE 2026-09-08: OOXML reader and the one-sheet model
   (src/built-in/worksheet/ooxml.ts), verified on all 331 sheets by
   tests/probes/problem-bank-reader-probe.mjs and rendered through the real
   engine by tests/probes/problem-bank-render-probe.mjs (hidden, offscreen).
2. DONE 2026-09-08: import with paper, source, kind, quadrant and the
   student's ratings carried over (problemImport.ts, the Import Workbook
   pane); the sidebar is the bank (papers, rating bars, filters, search);
   the problem tab keeps the solution hidden until Reveal, rates Easy,
   Medium, Hard, times the attempt, resets work. Quiz filters gained
   rating bands and Incomplete.
2b. DONE 2026-09-08 (after his first import): rich text inside cells,
   equation text boxes as floating images with their runs, pictures
   rendered (drawing preset), the solution hidden only to its last column
   so he can work beside it, the rating cell kept and rewritten with the
   current rating, the sheet menu readable (color-scheme pinned; see
   tests/probes/worksheet-menu-probe.mjs).
3. DONE 2026-09-08: the Dashboard tab (dashboardPane.ts, arithmetic in
   progressInsights.ts, unit-tested): attempted %, the weighted score,
   time studied, ratings this week; Work On Next as four lists that open
   the problem or start a quiz (Due Now: Hard back after 3 days, Medium
   after 7; Keeps Going Wrong: rated Hard twice and not Easy; Weakest
   Papers with a Quiz button that presets the quiz builder; Quick Wins:
   the vendor's Easy & Likely never tried); Progress By Paper as stacked
   bars weakest first; Progress Over Time as two small multiples
   (Attempted, Score) with the workbook's own Dashboard_Data history
   dashed ahead of every rating given here (ws_progress, imported by
   Import Workbook, also when nothing new is selected). Rendered hidden
   in both themes by tests/probes/worksheet-dashboard-probe.mjs.
3b. Quiz sessions with a timer per problem and a session id.
4. Essay sheets and the Flashcards sheet into a flashcards deck. Pictures
   need the engine's drawing preset in the host; EMF/WMF pictures (16 of
   45) cannot be shown at all and are counted at import.

## Verified

- VBA extracted with olevba from the copy; every procedure read.
- Sheet inventory, formulas of the index, dashboard data, quiz template and
  a problem sheet read with openpyxl; styles.xml, drawings and sheet XML
  measured directly.
- Importer run: detectExcelItems over the copy through the same grid
  builder as electron/documentExtractor.cjs (316 split items, 24
  leftovers).
