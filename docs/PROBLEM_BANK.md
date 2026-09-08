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

## What Parallx already has (M99 Worksheets)

- An exam-faithful sheet engine with the Pearson function allowlist; every
  function seen in the solutions (SLOPE, INTERCEPT, LINEST, NORMSINV,
  GAMMALN, MMULT, SUMPRODUCT) is available.
- An Excel importer written against this very workbook. Run over the copy
  today: **316 of 331 problem sheets import cleanly** as question-plus-
  solution items (the `Solution ->` split), with the paper as the tag. The
  15 that do not are the 14 essay sheets and one sheet without a work
  marker. 66 solutions are text-only (qualitative answers), which is
  correct, not a defect. One sheet carries prior work below the marker.
- Attempts with autosave, self-grade (Nailed It, Partially, Missed It,
  which is the same three-level scale as Easy, Medium, Hard), AI review of
  the student's cells, practice sessions with tag, state, count and
  shuffle filters, and chat tools over the bank.
- The workspace holds 19 items today (cookbook and PDF generated); nothing
  from this workbook has been imported yet.

## The build, in order of value before the exam (2026-10-27)

1. **Import that keeps his progress.** Tags carry paper, source (rf, cas,
   custom) and type (quant, qual, essay) so every filter ProblemTrack had
   exists as a chip. His 62 ratings (13 Easy, 26 Medium, 23 Hard) become
   completed attempts with the matching grade, dated from the workbook.
   Work below `SHOW ALL WORK.` is dropped at import. The 14 essay sheets
   and the `Flashcards` sheet go to the flashcards extension as a deck
   (Front, Back, Tags is already its import shape).
2. **Dashboard that never needs a button.** Per paper: attempted %, the
   same weighted score so his numbers stay comparable, time spent, and a
   timeline drawn from every attempt. Missed and partial problems come
   back on a short schedule (3 and 7 days) so "due" exists.
3. **Quiz mode.** A practice session with the ProblemTrack filters plus a
   timer per problem, results landing on the same items. Nothing is
   exported; the existing per-sheet export to .xlsx stays for when he
   wants real Excel.

Not built: the reset feature (attempts are history, not state to wipe),
the custom-problem template (Generate Items and the scratch sheet cover
it), Mac shims.

## Verified

- VBA extracted with olevba from the copy; every procedure read.
- Sheet inventory, formulas of the index, dashboard data, quiz template and
  a problem sheet read with openpyxl.
- Importer run: `detectExcelItems` over the copy through the same grid
  builder as `electron/documentExtractor.cjs` (316 split items, 24
  leftovers).
