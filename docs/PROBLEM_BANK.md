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

## Stars (2026-09-15)

A star is the student's own bookmark on a problem. It is stored on the
problem (`ws_star`, migration 008), not on a quiz, so it survives the quiz
it was set in. Set or cleared from the sheet header, the quiz overview
rows and the Problem Bank rows (Starred filter chip). Spent from three
places: the Quiz Starred tile on Home (every starred problem, bank order),
the Starred card under Work On Next on the Dashboard, and the Starred and
Not Starred chips in the quiz builder (Starred also sets the length to the
count, so the other chips can narrow it further).

## Quizzes are saved things (2026-09-17)

Mufaro, after losing a campaign quiz: he rates every problem in the first
minutes, before working any, and the quiz was marked complete under him,
so the Dashboard offered no resume, and the campaign button made a new
quiz of his starred problems instead. One button started, finished and
replaced. The rule now:

- A quiz has a NAME (ws_quiz_session.name; migration 009 adds name and
  touched_at). Home, the Dashboard and the builder name them (Starred, Due
  Problems, Day N Draw, the builder's filters or a typed name); Rename on
  the overview changes it. Home lists every quiz under its name with its
  status: in progress and where, at the summary, or completed when.
- Several quizzes may be open at once. Starting one never closes another.
- COMPLETE QUIZ, on the summary screen, is the only way a quiz finishes.
  Rating every problem does not; the last Next does not (it opens the
  summary, labelled Quiz Summary); nothing else does. finishQuizSession has
  one caller.
- REOPEN QUIZ makes a completed quiz open again, at its last problem.
- COPY QUIZ makes a new open quiz over the same problems in the same order.
- Resume on the Dashboard is the open quiz used last (touched_at), at
  whatever step it stands, the summary included.
- The overview head carries the name, Rename, Copy Quiz and Quiz Summary
  (or Reopen Quiz); the summary carries Complete Quiz / Back To Quiz (or
  Reopen Quiz), Copy Quiz, Quiz Overview, New Quiz, Dashboard, Home.
- The QUIZZES TAB (sidebar Quizzes, Home tile and All Quizzes, command
  worksheet.quizzes) lists every quiz, open first, with the ratings so far
  and, on each row: Resume or Review, Rename, Copy Quiz, Reopen Quiz (when
  completed) and Delete Quiz (confirmed; ratings stay on the problems).
  Complete Quiz is deliberately not there: it lives on the summary.

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
   rating bands and Incomplete. Reveal and Hide flip the solution columns
   on the live engine (Univer facade hideColumns/showColumns, 2026-09-08);
   the earlier remount on an edited snapshot redrew the whole sheet, the
   flash, and stays only as the fallback. Keyboard as Excel (2026-09-08):
   Shift+Tab and Shift+Enter move left and up whether idle or mid-edit (an
   edit commits first). Univer 0.25 itself dropped the selection on idle
   Shift+Tab and ignored Shift while editing; the host registers a
   higher-priority reverse-move shortcut and catches the editing case on the
   container (univerHost.ts). The floating cell editor follows the sheet
   while a formula is typed (2026-09-08): Univer 0.25 fixed the box on
   screen when editing began, so scrolling away to pick a reference and
   coming back to any other offset left it over the wrong cell; on every
   scroll the host refreshes the engine's cell position and translates the
   box by the same delta, DOM only (writing the engine's editor state, or
   calling its resize routine, left Enter, Escape and reference clicks dead;
   probe-verified). Review in Chat (2026-09-08, was a one-shot
   panel): the cells and the solution go to the chat as an attached context
   chip with the review brief as the message, so follow-up questions have
   the work in front of them; the panel remains only as the fallback when
   the chat surface is absent.
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
3b. DONE 2026-09-14 (after a bad first live morning): the quiz is a stored
   session (ws_quiz_session, migration 006: item_ids, position, skipped,
   started_at, finished_at; one open at a time). The Quiz tab restores it
   after an app restart or tool reload at the same item; Previous Item /
   Previous / Item n of N / Next together on the left, Quiz Overview / End Quiz / Skip Item on the right; a skip is forgotten the moment the problem is rated or worked, and skipping a problem already done marks nothing; rated problems stay in the list so you
   can go back; attempts rated inside carry session_id. Today's campaign
   quiz is the WHOLE draw (rated included) opened at the first unrated one,
   and the Dashboard shows Resume Quiz (i of n) while one is open. Lesson:
   a study session must never be held only in memory, and never rebuild the
   list under the user.
3h. DONE 2026-09-14: the solution span is measured by CONTENT. readPristine
   counted every cell in cellData, styled empties included, and the
   workbook's banner rows are styled out to BL, so the solution span became
   K..BL and the only work room was BM onward. Mufaro revealed the solution,
   worked beside it (W..AC), rated, reopened: hidden again with his work
   inside ("my work is not persisted"). solutionVisibility.ts (pure, tested):
   span = marker..last cell with a value/formula/rich text (merges only when
   they start in the span); a column the student wrote in is never hidden;
   visibility is rebuilt from the marker on at every mount, so stale hd flags
   in a snapshot cannot hide work; the in-place Reveal/Hide toggles the same
   segments. Verified over his real attempts 93-104: no work column hidden.
3i. DONE 2026-09-14: Enter after a Tab run. Univer 0.25 records the run's
   start cell on the first Tab (ShortcutExperienceService, not exported) and
   forgets it only when Enter consumes it, so a click or arrow move followed
   by typing and Enter jumped back to the old column. univerHost finds the
   service in the injector by shape (remove/getCurrentBySearch/addOrUpdate)
   and clears the TAB memory on every SetSelectionsOperation that is not
   inside a Tab step (MoveSelectionEnterAndTabCommand with TAB, or our
   Shift+Tab reverse move). probeState().tabRunMemory reports the lookup.
   OPEN: dragging a reference highlight in the formula editor can rewrite
   every reference from the drawn selections (sheets-formula-ui rebuild
   branch), dropping $ on references that did not move; engine bug, needs a
   keyboard/pointer harness to reproduce and a host-side restore of the
   untouched tokens.
3j. DONE 2026-09-14 (morning, after his go-ahead): the quiz as a study
   surface. Quiz Overview (list icon in the quiz bar): every problem of the
   quiz with Not Started / Attempted / Skipped / the rating, time spent, a
   note per problem (ws_problem_note, migration 007, kept across quizzes),
   click to jump. Home lists Quizzes (ws_quiz_session, newest first, rating
   counts); a finished one reopens in review (Reviewing chip, no End Quiz),
   an open one resumes. Rewards (rewards.ts pure + rewardsSync.ts; table
   ws_reward): 17 milestones with XP bonuses added to the campaign's XP
   (campaignProgress bonusXp) so they move the level; Dashboard Rewards
   section, earned first with dates and a New badge for the last 10 min.
   Formula failures: NOT reproduced by the engine in Node, the facade, typed
   input (webContents.insertText + Return; sendInputEvent keys never reach
   Univer), nine mount/dispose cycles, or three live hosts. Instrumented:
   univerHost reports every error value with formula text and engine health
   (executors, MULTIPLY/SUM present, hosts alive, seconds since mount) via
   opts.onFormulaError -> activity journal verb 'formula error'.
   2026-09-17 (Mufaro: #NAME? that returns on Enter for the same text, gone
   after a restart): the engine's parsed-formula cache is module-level, keyed
   by unit id + formula text, shared by every live instance, each node bound
   to the services of the instance that parsed it; a problem mounted twice
   under its stored id resolved references against the other instance's
   unit data (zero rows -> #NAME?). FIX: every mount gets its own engine
   unit id (univerHost withUnitId; stored id put back on every snapshot,
   drawings' unitId rewritten both ways); a teardown that throws is
   journaled as 'engine fault' instead of swallowed.
   2026-09-17 (afternoon, Mufaro: text typed into a cell shows in the
   formula bar but not in the cell, Enter does nothing, a click on the
   formula bar brings it back; and his rule: no edge cases, fix the system).
   SYSTEM CHANGE: one live engine per window. The engine is built for one
   instance per page (module-level caches, activeElement-derived focus
   contexts, window-level listeners, a render loop each); retained hidden
   tabs held up to seven of them. Sheet panes now answer retainOnHide:
   false (IEditorPaneViewStateProvider, honoured by editorGroupView on
   tab switch): torn down on switch-away (work persists to SQLite and a
   working cache read first on return), rebuilt on return with the active
   cell and scroll restored (host getViewState/restoreViewState). The
   Engine.prototype.resize patch for hidden panes is gone with the hidden
   panes.
3k. DONE 2026-09-14 (late morning): dollar signs survive a reference drag.
   Reproduced in a hidden host probe (scratch drag-probe: probeStartEditing
   + webContents.insertText, then a mouse drag on the highlighted box's top
   edge = move, bottom edge = resize): the editor rewrites every reference
   from the drawn boxes and $A$1 became A1. Fix in univerHost: around each
   ReplaceTextRunsCommand on the cell/formula-bar editor, read the text
   before and after; formulaRefs.ts (pure) restores markers on references
   that lost them when a reference moved, when every reference lost them,
   or when the pointer was pressed while editing (a drag dropped in place);
   the corrected body is written back with getBodySlice. F4 and typing are
   left alone. Quiz flows re-verified in the real app hidden over a copy of
   his DB (tests/probes/worksheet-quiz-flow-probe.mjs): zero renderer
   errors. Render races fixed with a render sequence guard (Home,
   Dashboard); the overview shows ratings given before the quiz as
   "<grade> earlier".
3l. DONE 2026-09-14: spills survive a reopen. An array formula such as
   =B7:B9 keeps its spilled cells in the engine's array-formula data, which
   the saved snapshot does not carry (no formula resource in getSnapshot),
   so every remount showed only the first cell with its cached value. The
   host now runs a full recalculation once the engine reaches the Rendered
   lifecycle stage (a 0 ms call did nothing; a 1500 ms timer is the
   fallback). Probe: scratch spill-probe3 (type, snapshot, remount, read).
3m. DONE 2026-09-14: Reveal Solution follows the sheet. The button kept its
   own flag, so unhiding the solution columns by hand and then clicking
   Reveal redid the work. univerHost.onColumnsVisibilityChanged (the
   engine's hide/show column mutations) drives syncRevealFromSheet in the
   problem tab: revealed = no solution-segment column hidden; the header
   repaints and the attempt is saved. Verified in worksheet-quiz-flow-probe.
3c. DONE 2026-09-08: the Campaign (campaign.ts, pure, unit-tested; tables
   ws_campaign and ws_daily_draw, migration 004). Every problem in the bank
   in N days: a daily quota, a draw fixed per day across all papers
   (never-attempted first, round robin), Start Today's Quiz over what the
   quota still needs, pace against the plan, a streak of full days, XP
   (10 a problem, 5 more for Easy, 50 for a full day) with ten level titles,
   one square per day, papers cleared, and Review Due Flashcards as the
   day's other quest. Sits at the top of the Dashboard tab.
3d. DONE 2026-09-14: rest days (migration 005, ws_campaign.rest_days as a
   JSON weekday array). Chosen as weekday chips on the Settings tab, with a
   Last Day date field that edits the day count. The daily target is set
   over working days; rest squares are hollow, never full or missed; the
   streak and the pace step over them. On a rest day the card reads Rest,
   draws nothing, and offers Quiz Due Problems (the repeats) plus Draw
   Anyway. Unit tests: tests/unit/worksheetCampaignRestDays.test.ts.
3e. DONE 2026-09-14: essay sheets (kind 'essay', the X.RF_Essay sheets, one
   per paper) are not campaign problems: isCampaignProblem in campaign.ts
   keeps them out of the total, the draw, XP and paper clearing. They stay
   in the bank and the custom quiz's Essay chip; their questions are
   flashcards already.
3f. DONE 2026-09-14: the quota follows the bank. campaignProgress derives the
   target from the campaign's problems over the planned working days (the
   stored daily_target is the plan as it was started); a saved daily draw is
   filtered to current campaign problems and topped up to the target on the
   next Dashboard open. Both came from the first live run: the campaign was
   started before the essay exclusion shipped, so its stored 18 a day and
   saved draw carried three essay sheets.
3g. DONE 2026-09-14: decimals shown. Univer paints an unformatted number
   with ~12 significant digits (0.333333333333), and Mufaro was reformatting
   cells by hand. Setting worksheet.displayDecimals ('2' | '4' | '6' | '8' |
   'full', default '4', chips on the Settings tab under Decimals Shown). The
   engine host registers a CELL_CONTENT interceptor (priority 20) that
   rounds the painted value of a number whose style has no number format
   (or the 'General' pattern); the stored value, formulas, the editor, the
   snapshot and exports keep full precision; an explicit format always wins.
   Pure rounding in displayNumbers.ts (tests/unit/worksheetDisplayDecimals
   .test.ts); a change repaints open sheets via SheetSkeletonManagerService
   .reCalculate(). Verified with a hidden engine render (scratch probe).
3h. DONE 2026-09-15: the day's story on the campaign card (dayStory in
   campaign.ts, tests/unit/worksheetCampaignStory.test.ts). Under the quota
   line: today's Easy/Medium/Hard split, minutes, papers and XP while the
   day is on; yesterday's tally first thing in the morning; the week's
   (Monday through today) on a rest day. Quota met reads "Day N done", and
   "Your best day yet" when today beats every day before it. A problem
   counts on its first campaign day only; time counts on the day worked.
3i. DONE 2026-09-20: work counts, not only the rating (migration 010,
   ws_attempts.worked_at). A problem imported with its workbook self-rating
   already on it read as rated everywhere it appeared, so the quiz lit the
   grade button, the problem looked finished, and the work done on it was
   never credited: a day closed 16 of 17 with every problem in it gone over,
   and the streak broke. An attempt is now worked the moment a cell on its
   sheet changes (host.onEdited over the engine's editing commands, armed
   after the mount settles, the rating cell's own write excluded); worked_at
   is that first moment and never moves. The campaign credits a problem on
   the earlier of its worked day and its rated day, so a day that read full
   stays full and work done the day before a rating counts on the day it
   was done. The rating still decides the score, the Easy bonus and when a
   problem comes back; a worked problem left unrated is never scheduled as
   a repeat, which is the one thing the rating alone still buys. A workbook
   rating never lights a Rate button: the header says "Medium In Your
   Workbook", or "Worked, Not Rated" in the accent once it has been touched;
   the bank draws an untouched workbook rating as a ring; the quiz overview
   puts work ahead of an old rating and calls a sheet saved without an edit
   (a Reveal Solution) "Opened"; Complete Quiz counts out loud anything
   neither worked nor rated before it closes; the campaign card offers Rate
   Worked Problems (n) so the tally's chip is never a dead end. Revealing
   the solution no longer writes an attempt on a sheet with no work.
   Backfill: every attempt already holding the student's own cells counts as
   worked, a rated one at its rating's moment (no day already seen changes),
   an open one at the moment its cells were first saved; a sheet that was
   only revealed before this date is indistinguishable from one worked and
   is credited too.
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
