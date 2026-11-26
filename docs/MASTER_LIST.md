# Master List: app improvements and future extensions

The one place future work is tracked. Started 2026-11-09 as the canon for
the next month. An idea goes here when Mufaro says so, with his words on
it; it leaves when it ships (a line in the doc it shipped into) or when he
drops it. Nothing on this list is agreed to be built until he says go on
that item; the list is the queue, not the plan.

How to read an entry: what it is, what the user gets, what exists today,
and what is unknown (a licence, a size, a bar not yet researched).

The sections, by his rule (2026-11-09): improvements to surfaces that
already exist, UI improvements, and completely new extensions are kept
apart, so a month's plan can be read by kind. Verification he is owed and
ideas he has heard and set aside come last.

## Existing surfaces: improvements

Changes to what is already there: a tool, a pane, a prompt, a pipeline.

### Worksheets: a full redesign, generalized

**His words (2026-11-09):** "a full redesign of worksheets. A lot of what
I built for it, I built specifically for studying for exam 7. we need to
generalize, improve it quite a bit, etc."

**Status (2026-11-10):** agreed, it will be done. His words: "Worksheets
full redesign we will do, but we will not start with it today." Started
2026-11-15: tested, bars read, mock-ups drawn. The first piece (a sheet
of one's own, kept as a file) is built, see "Built 2026-11-15" below;
what is left of the redesign is listed under it.

**His go (2026-11-15):** "let's run worksheets redesign, need several
mockups. need you to test cell interaction logic? etc". The same day, on
the rest of this list: "I feel like the majority of these are not needed
rn." Which entries that parks was proposed to him and is not settled.

**Tested 2026-11-15, on the real sheet in a hidden copy of the app**
(`tests/probes/sheet-cells-probe.mjs`: the mouse on the grid, keys through
the window, the system clipboard, a finger; after each act it reads the
engine and sets what happened beside what Excel does). 121 things tried:
85 the same as Excel, 13 differ, 16 missing, 7 notes.

- *There is no general spreadsheet to keep.* The only free sheet is the
  Scratch Sheet, kept in memory: closed and opened again it came back
  empty. A sheet starts at 150 rows by 40 columns and grows only when a
  row is inserted. An .xlsx in the workspace opens in the core's read-only
  grid; Import Workbook only makes problems. The Direction below ("the
  spreadsheet stays a general tool") describes something to be built.
- *Keys that do nothing:* Home, Ctrl+Home, Ctrl+End, Page Up, Page Down,
  Shift+Space, Ctrl+Space, F5, Ctrl+Shift+Plus, Ctrl+1, Ctrl+Shift+% $ !.
  The engine's shortcut table (`@univerjs/sheets-ui` 0.25) has no entry
  for Home, End, the Page keys, Space or F5.
- *Differs:* an arrow at the edge wraps (Up from A1 lands on AN150);
  typing in the formula bar is lost (four ways tried in the hidden app,
  focus stays in the cell's editor; one try by hand is owed); `=A1+` is
  accepted and shows #VALUE!; a formula that reads itself shows 1 with no
  warning; Ctrl+F opens the app's Find, which finds nothing on a sheet;
  Ctrl+Enter with two areas selected fills the active cell only; no
  completion from the words in a column; a finger dragged up selects
  cells and the sheet does not scroll (a simulated finger).
- *An error in the page:* Shift+Tab and Shift+Enter on a cell that is not
  being edited move as they should and throw "Command handler should not
  return a promise" each time (`univerHost.ts`, the reverse move).
- *Not there:* sort, filter, find and replace, conditional formatting,
  dropdown lists, tables, notes, links, charts. The engine's parts for all
  but charts are in `node_modules/@univerjs` already and not switched on.
  Freeze is in the right-click menu only. The ribbon's Data tab holds one
  control.
- *Already right:* entering (numbers, 5%, $1,234.50, dates, '007, Tab
  runs, F2, Alt+Enter), formulas (pointing by mouse and by arrows, F4, the
  function list, spills, other sheets, XLOOKUP, LET, LAMBDA, FILTER),
  copy and paste in and out of other programs, the fill handle, undo.

**Bars read 2026-11-15** (each vendor's own pages that day, through a
reader that summarises; what failed is said). Excel's and Google Sheets'
help for cell behaviour; Notion, Obsidian Bases, Craft, Anytype, Coda's
grids-and-tables guide, Grist, Quadratic, Rows for a sheet in a notes
app; Anki, RemNote, UWorld, Blueprint, Brilliant for the study half. Not
read: Coda's and Airtable's help centres (404), AMBOSS and Khan Academy
(403), AFFiNE's database page (404). What was taken: Coda keeps free
grids and typed tables as two objects in one doc; RemNote offers a
catch-up period "instead of quietly rearranging" where Blueprint's
Rebalance cannot be undone; UWorld builds a session from pools (unused,
incorrect, marked).

**Mock-ups drawn 2026-11-15**, in the app's tokens and icons, dark and
light: https://claude.ai/artifact/4bCbPziBWCPbjYb7JZjFkP. Five choices,
his picks owed on each; Claude's pick marked on the page:

- 1, where a sheet lives: 1A a file in the workspace, with Edit As Sheet
  on an .xlsx (Claude's pick), 1B a kind of page, 1C Sheets' own list.
- 2, what sits around the grid: 2A the engine's ribbon in the app's
  colours, 2B one toolbar built from the kit (Claude's pick), 2C a bar
  that appears on a selection (kept for touch).
- 3, a sheet in a page: 3A a live range (Claude's pick), 3B a card, 3C
  a cell's value inside a sentence (after 3A).
- 4, where the problem program goes and what it opens on. Where: 4i a
  tool of its own for worked problems, "Practice" in the drawings, the
  name his (Claude's pick), 4ii into the Study extension, 4iii a part of
  Sheets. What it opens on: 4A today (Claude's pick), 4B the items, 4C
  the plan.
- 5, working an item: 5A a study bar over the sheet, 5B the question
  beside the sheet (Claude's pick), 5C the exam surface for a timed
  session, where the exam's limits are rules a set carries.

**His picks (2026-11-15):** "I trust your picks." So the picks are his:
1A, 2B with 2C's bar for touch, 3A then 3C, 4i and 4A, 5B with 5C for
timed sessions. Then: "I am a little confused though, what am I losing
the ability to do". Answered the same day; the answer in short:

- Nothing is meant to go. What changes for him: the exam's limits (white
  sheet, 150 by 40, the exam's function list) stop being true of every
  sheet and hold only where a set carries them; the question moves from
  merged cells on the sheet to a panel beside it; the engine's ribbon
  goes, and what the one toolbar does not show (font and size, rotation,
  strikethrough, format painter, protection, vertical alignment, images,
  the function browser, Text to Number) sits under More; Bank, Dashboard,
  Quizzes and Campaign become views of one tab, so two of them side by
  side needs an Open In Its Own Tab; a sheet's own file opens in Excel
  only through Export, which carries values and formulas, not styling.
- What could be lost by careless building, and is not to be: his bank,
  attempts, quizzes, campaign, roster, study time and rewards when they
  move to another tool's tables; the `worksheet.*` commands his plans and
  the chat call; his daily study tool while the campaign runs.
- Proposed with the answer, his word owed: build Sheets and the new
  program beside Worksheets, and switch only when his own data opens in
  it and he says so.

**His words after the answer (2026-11-15):** "for practice exams, keep it
on the sheet. we need to generalize, a lot of what is currently built for
worksheets was tailored to CAS exam studying and it works. Your
distinction is that we need a generic starting point, I agree. Something
unlimited, cutting edge, but while still having the ability to go into
study mode."

- *Settled by that:* in a practice exam the question stays on the sheet
  (5C as drawn; the panel of 5B is not for practice exams).
- *How Claude reads the rest, his to correct:* the sheet is the starting
  point, generic and without limits, and study is a mode gone into from
  it. That leans away from 4i's separate tool, toward one tool whose
  study side is entered. Nothing has been moved on that reading; the
  first piece built is the same under either.

**Built 2026-11-15, the first piece: a sheet of one's own, kept as a
file.** Reviewed the same day by agents that did not build it (below);
this text is as corrected by that review.

- New Sheet… (Worksheets' sidebar menu, Add on its home, the command
  `worksheet.newSheet`) asks a name, makes `Name.sheet` in the workspace
  folder and opens it. The chat can run the command only when workbench
  control is switched on in the AI settings, and it ships off; that route
  was not run. The pane is its own small file (`panes/sheetFilePane.ts`);
  what it takes from the kit is the notice shown while a file opens or
  is refused. Everything worked with on the sheet (ribbon, formula bar,
  sheet tabs, zoom) is still the engine's own.
- A `.sheet` file opens as a live sheet from the Explorer and Quick Open
  (both seen in the app) and from File > Open (run as its command with a
  path; the file dialog itself was seen by nobody). It starts at 1,000 rows by 52 columns and grows as the
  selection nears its end, so an arrow never wraps. Scrolling alone does
  not grow it: the wheel stops at the last row until the selection goes
  there. It follows the app's light or dark.
- It saves itself: a change is in the file about a second and a half
  later, on leaving the tab, when Worksheets is turned off, and when the
  app closes. What is still being typed in a cell is kept when the tab
  is left or closed. Closed and opened again, it is as it was. Merely
  opening it writes nothing.
- A file that is not a sheet, or whose workbook is damaged, is refused in
  words and left as it is.
- The engine host takes its limits as an option (`SheetLimits` in
  `worksheetConstants.ts`: the function list, the grid, whether it
  grows). Given none, it is the exam tool's sheet. This is the seam study
  mode will use: limits a set carries, not code.
- A contribution point in the core, `api.editors.registerFileEditor`: a
  running tool claims file extensions for one of its editors. The claim
  is an entry in the core's one registry of file types
  (`EditorResolverService`), above the core's own readers; the first
  build kept a second list beside that registry, and the review caught
  it. The core names no tool; with Worksheets off a `.sheet` opens as
  text.
- Changed on the way: File > Open File made a text editor for whatever
  was picked. It now asks for the editor of the file's type first, and
  takes a path so a routine or a probe can call it.

A correction to what he was told twice. First he was told a sheet was
held to "only the exam's functions"; then, on 2026-11-15, that the list
"removes nothing" because all 511 of the engine's functions are on it.
Both were wrong, and the claim checker found it: 31 of the engine's 511
function names are not on the exam's list, and they computed on the
practice sheet anyway. The list was applied before the engine had
registered its functions, so it found nothing to remove (shown by
running: reading more of the engine at that same early moment still
removed nothing; applying the list as the engine starts removed them).
The same code ran at the same point before this piece, so it was so
before it too (read, not run on the older commit).

Fixed in the review. Of the 31: 6 are the engine's own operators (plus,
minus, times, divide, compare, cube) and stay; LET stays, because the
engine reads it in its parser and not as a function, so it still
computes; BAHTTEXT stays (below); the other 23 now answer #NAME? on a
practice sheet:
ARRAYTOTEXT, ARRAY_CONSTRAIN, AVERAGE.WEIGHTED, CELL, EPOCHTODATE,
FLATTEN, FORECAST.LINEAR, IMCOTH, IMLOG, IMTANH, ISBETWEEN, ISDATE,
ISEMAIL, ISURL, MARGINOFERROR, NUMBERSTRING, NUMBERVALUE, REGEXEXTRACT,
REGEXMATCH, REGEXREPLACE, ROUNDBANK, TO_DATE and VALUETOTEXT.
Pearson's comparison workbook marks 20 of those as not
in the exam's tool; EPOCHTODATE, NUMBERSTRING and ROUNDBANK are not in
that workbook at all, so their going is an inference. BAHTTEXT is kept
because the workbook lists it for the exam under a misspelling
("BAHTEXT") and the first fix took it away for the typo; the second
claim check caught that. A sheet of one's own has all of them.

**His answer (2026-11-16): keep it. "okay that's fine; I don't use any
of those."** It was put to him as a change to his practice sheet, which
had been promised untouched. One pane serves a problem, a quiz and the Scratch Sheet, so
all three change. A problem already saved with one of the 23 in a
formula keeps the formula's text, shows #NAME? when it is next opened,
and stores that at its next save. NUMBERVALUE, CELL and FORECAST.LINEAR
are real Excel functions a worked solution brought in from Excel could
use. Nobody checked whether a problem or a solution in his
bank uses one of the 23 names: his bank is not in the repository
(nothing that is in it uses them). Not checked: whether those names
still show in the function list of the fx button.

The audits (2026-11-15). Touch drags: all ok on the second run. The
first run failed, and the probe itself was then changed (its planner
check took the wrapper around a day's chips for the day's cell, so it
dragged left and fell off the calendar on the first day of a week; that
day was a Sunday), so the pass is a pass of the changed probe. Keyboard, on the Worksheets screens
with a sheet file added: 0 everywhere but one kind, a control of the
engine's ribbon that Tab did not reach ("More" in one run, "Panel" and
"More" in the next). It was on the new sheet in both of the builder's runs and on
the Scratch Sheet in one; the reviewer's own run found 0 on both. It
moves as the ribbon folds its overflow away. No run on the commit before
the piece was made, so "the engine's, not this piece's" is a reading of
the code, not a measurement. The toolbar of 2B replaces that ribbon.

**Reviewed 2026-11-15 by agents that did not build it** (the
`review-piece` workflow's first run with real agents: correctness,
modularity, accessibility, a claim checker, then a skeptic on each
finding). 26 findings: 11 on correctness, 3 on accessibility, 12 on what
was claimed, none on modularity. A skeptic ruled on the first 14,
refuted 1 and called 2 minor; the 12 about claims were never challenged,
because the run hit the plan's 5-hour limit before its skeptic for the
claims, its real-app verifier, its fixer and its recheck had finished.
So Claude made the fixes (with a failing test first where a unit test
can reach), and ran the verifier's unfinished probe
(`tests/probes/sheet-file-verify-probe.mjs`) itself: 99 checks, 0
problems on the fixed build, after three edits to it that the commit
names. None of the reviewers above saw the fixes; what did is set out
under "The fixes, checked" below.

Found by the review and fixed:

- A sheet named with a letter outside plain English could not be made
  ("Café": URI malformed) or was made under another name ("Budget —
  2026" became "Budget  14 2026.sheet"), and File > Open File opened the
  wrong path for such a name. The cause was in the core's URI text form,
  which wrote a character's code where its UTF-8 bytes belong; fixed
  there, for every file type (`tests/unit/uriNonAscii.test.ts`).
- A sheet renamed in the Explorer kept its tab under the old name, and
  its next save brought the old file back with the edit in it; a deleted
  sheet's tab stayed open and its next edit brought the file back. Now
  the Explorer closes a file's tabs before it deletes, renames or moves
  it, waits for each one's last save, and after a rename or a move opens
  them again under the new name (every kind of file tab; a tab with
  unsaved changes is left alone by a rename). A sheet whose file was
  taken away by something outside the app is never written back: every
  save asks first whether the file is still there. Work the file does
  not hold is kept as a copy beside where it was, which opens in the
  tab's place; with nothing unsaved the tab closes. Either way it is
  said. Nothing is asked: the first version asked in a dialog, and a
  dialog that appears while a person types is answered by their next
  key or click (in the builder's own run a stray click closed the tab
  without saving).
- The same sheet shown twice (Split Editor) was two engines each writing
  its whole sheet over the other's: the second save erased the first
  pane's entry. Now one sheet is live at a time (below).
- Undo did nothing the first time after the grid grew (it undid the
  growing). Growing is no longer in the undo history.
- An entry made in the last second and a half before the window closed
  was lost. Closing the app now waits for every sheet file to be
  written (the tool settles its files before it is shut down), and a
  reload writes at once.
- An entry still being typed when the tab was left was dropped (found by
  the verifier's probe). It is kept. The practice sheet still drops it;
  not changed, it is not this piece.
- A file in the sheet format whose workbook lists a sheet it does not
  hold was mounted broken, with a stream of engine errors (the
  verifier's probe counted 102). It is refused.
- The Welcome page read "Open New Sheet…": it lists the Tools menu as
  tools to open. New Sheet… is out of the Tools menu, which is for
  opening tools.
- Export Sheet to Excel sat in the sidebar menu always, and answered
  "Open a sheet first" even with a practice sheet on screen. It is in
  the menu and in the command palette only while a sheet file is on
  screen.
- A file tab of a tool's editor was described as "Tool editor:
  worksheet"; it is described by its path, as every file tab is.
- The builder's probe compared paths in a way that fails on Windows with
  the app right. Fixed in the probe.
- In the harness, not the app (the stop hook, `tests/unit/stopHook.test.ts`):
  a check weakened, put back and weakened again was not named the second
  time; a failing test sent Claude back again and again, ending only
  when the runner happened to print the same timing twice; a change of
  more than 40 files could never pass.

**Open when the session stopped (2026-11-16), to be looked at first.** He
stopped the last checks to save tokens. On the newest build (`d84aede`)
the reviewer's probe (`tests/probes/sheet-file-verify-probe.mjs`) showed
10 failures. Two are its old side-by-side check, since rewritten and not
run again. Eight come from one thing: after Tab then Enter the selection
did not go back to the column the run began in, so later entries landed
one cell over. The same keys, run alone, work, and a second test run was
using the machine at that moment, so load is the likely cause; that is
not confirmed. Run that probe alone before anything else. Also not run
on the newest build: the keyboard and touch audits. The unit suite ran
on it and its result was not read. The three newest fixes (one live
sheet at a time, the keyboard left in the Explorer, no question when a
file is gone) were run in the app by Claude only (42 checks, 0
problems), not by anyone who did not write them. The verifier's own
probe (`tests/probes/sheet-file-fixes-probe.mjs`) is as it left it,
written for the first fix commit: some of what it expects no longer
describes the app, and the stop hook names one check in it that cannot
fail.

**The fixes, checked** (2026-11-15, by three more agents that did not
write them: a correctness reviewer on the fix commit, a claim checker on
this text, an app verifier). The first fix commit was itself wrong in
five places, each reproduced in the built app by the reviewer, and in
three more found by the claim checker; all eight are fixed in the
commits that followed, and what is said above is as it stands after
them.

- A sheet renamed or deleted in the Explorer with an entry still being
  typed came back under its old name, holding the entry the renamed
  file lacked: the tab was closed after the rename, and its last save
  went to the old path. The Explorer now closes first and waits.
- Saving on leaving a tab also ran on every save of the workbench's
  state (Ctrl+B, dragging a divider, another tab opening), and ended the
  entry being typed: "Groc", Ctrl+B, "eries" left "eries". An entry is
  now ended only when its pane is going.
- After Worksheets was turned off and on, Export Sheet to Excel never
  came back to the menu until a restart.
- The write on window close was placed where the tools had already been
  shut down, and wrote nothing; closing by the X still saved, but
  through another route. It now runs before the shutdown, and closing
  the app waits for the files.
- A text file in the workspace did not follow its rename (its tab is
  described by its path from the workspace folder, and the first fix
  compared whole paths; its test used whole paths, so it passed).
- The "file is gone" notice was a toast that left after five seconds,
  and the tab stayed open keeping nothing; Save a Copy saved an old
  snapshot. Now nothing is asked and nothing is lost (above).
- BAHTTEXT was taken off the practice sheet for a misspelling in
  Pearson's workbook (above).
- Export was still offered in the command palette when it could not
  work.

The app verifier was cut off by the 5-hour limit a second time, before
it could report. It left a full run of its own probe on the first fix
commit (`tests/probes/sheet-file-fixes-probe.mjs`, 232 checks passed, 28
failed). Most of the 28 are the ones above. Three were new, and are
fixed:

- Two sheets side by side garbled each other's formulas: `=ISEMAIL(…)`
  typed into the right one was stored as `)`, and `=LET(x,1,x)` on a
  sheet file turned to #VALUE! with a practice sheet beside it. The
  engine is built for one live instance in a window, and its formula
  editor and caches are shared. So one sheet is live at a time where a
  sheet file is concerned: a second sheet file (or the same file in
  another group) waits and says so, with a Work on This Sheet button
  that saves the live one and swaps them; a sheet file gives way when a
  practice sheet opens beside it and comes back when that one is closed
  or left. **A limit for him to know: two sheets cannot both be typed
  into side by side.** Two practice sheets side by side are as they
  were before; that pane was not changed.
- A click on a sheet's row in the Explorer put the keyboard in the
  sheet, so F2 edited a cell and Delete emptied the selected cell
  instead of deleting the file. The keyboard now stays where it was
  when a sheet is opened from outside the editor area; a sheet just
  made by New Sheet… takes it, so typing goes straight in.
- Dragging a file onto a folder in the Explorer threw an error after
  the move (the drag's end cleared what the code went on to read). This
  was so for any file, open or not, and before this piece.

Seen by it and left: on a practice sheet the Formulas ribbon's lists
still offer LET, NUMBERVALUE, REGEXEXTRACT, REGEXMATCH, REGEXREPLACE and
VALUETOTEXT, which then answer #NAME? (typing `=LE` no longer suggests
LET); a sheet just made is not in Quick Open's list at once; the
Explorer's menu, left open about three seconds, does nothing when Rename
is then chosen (with no sheet involved, so not this piece).

Found by them and left: a reopened tab comes back as the last tab of the
active group, not where it was, and loses its scroll place; the chat's
"attach the open file" now offers an open sheet and would send its raw
JSON (the chat reading a sheet's cells is not built); redo after the
grid grew was not run; nothing was run on Windows.

Found and left, reported here:

- A file that cannot be opened says so only in the pane, with no
  announcement for a screen reader. The skeptic's control, a broken PDF,
  is just as silent: it is how file editors fail in the app today. One
  fix for all of them is its own piece.
- A sheet file's tab has the same icon as the Worksheets home tab.
- Where Export saves: assumed to be asked by the system (that is what
  the app's shell does with a download nothing claims). The command's
  description said "in the Downloads folder"; corrected to that. Nobody
  has seen the dialog: a hidden run cannot show it.
- From the modularity reviewer, who found no breach of the first
  principle: a tool claims its file type when it starts, so a tool that
  starts only when first used could not claim one until something else
  woke it (Worksheets starts with the app, so it is covered);
  `docs/Parallx_Tool_SDK.md` and the chat's build-extension skill list
  the editors API without the new call; if Worksheets is turned off in
  the few milliseconds a save is on its way, the last write can fail
  without a word.
- Refuted by the skeptic: an entry made in the first moments after a
  sheet appears being lost. 17 timed entries were all saved; it happens
  only before anything is drawn.

Decided by Claude for this piece, for him to overrule:

- The file is the engine's saved workbook in a small JSON envelope
  (`format: parallx-sheet`), on one line. It is not an Excel file; Export
  Sheet to Excel (a command, in Worksheets' sidebar menu while a sheet
  file is on screen, and the palette) makes a copy, values and formulas
  only.
- The sheet has no bar of its own above the engine: the tab carries its
  name.
- A new sheet goes in the workspace's first folder. Choosing the folder
  (New Sheet on a folder in the Explorer) is not built.
- The sheet still wears the engine's ribbon; the toolbar of 2B is the
  next piece. The keys that do nothing and the formula bar are not fixed
  yet either.
- Not handled yet: the file changed by something else while it is open
  (the tab goes on showing its own version; an untouched tab leaves the
  other program's version alone, an edited one saves over it); a text
  file with unsaved changes renamed in the Explorer keeps its old tab;
  a reload of the window (View > Reload) in the second and a half after
  an edit writes at once without asking whether the file is still
  there; growing by scrolling; the search index and the chat reading
  a sheet's cells; an icon of its own; Edit As Sheet on an .xlsx.

**A miss on the first draft of the page, corrected the same day.** Choice
4 was drawn as a new tool called Study. Study exists (`ext/study`, built
2026-10: questions written from a PDF or a bank, mastery per concept; it
already practises this bank's essay problems through the question-provider
seam). Its brief left the sheet problems in Worksheets "where the sheet is
the point", and his bar for it was no mock exams and no point scoring.
That is why Claude's pick is 4i: timers, ratings and rewards stay out of
Study. Not read before that pick: Study's code beyond its manifest, brief
and sidebar sections; the campaign's and the roster's code.

**Proposed by Claude with the mock-ups, none agreed:** in 4A the day's
line from Flashcards and from Study comes through the Planner's day-load
seam, which both already feed; the exam's limits (grid size, function
list, white sheet) leave the code and become rules on a set; a sheet
keeps its own file and exports to .xlsx, since the exporter carries
values and formulas only.

**What exists today (verified from the file list).** `src/built-in/worksheet`
is two things grown together. One is a spreadsheet tool: the Univer host
(lazy bundle, one engine per window), formulas and references, display
numbers, equation images, Excel import and xlsx export, a sidebar, a
worksheet block for pages. The other is a study program built on top of
it for Exam 7: the Problem Bank and its filters, problem import, recipes,
practice sessions and their config and run panes, quizzes, the review
pane, the campaign, the day plan, the roster, rewards and their sync, the
study clock, progress insights, solution visibility, a Generate pane that
writes problems with a model. The manifest's sidebar title is Worksheets;
much of the surface is the bank.

**Direction.** Separate the two along the first principle. The
spreadsheet stays a general tool anyone uses for any table. The study
program becomes what it is, a study tool, generic in its nouns (items,
sets, sessions, a plan, progress) so it serves any exam, course or
skill, and lives where a user can turn it on or off without losing the
spreadsheet. Nothing in either names Exam 7, the CAS or his readings;
his data keeps working through the same generic shapes. The redesign is
the moment to raise the spreadsheet's own quality (he said "improve it
quite a bit").

**Bar to research first.** For the spreadsheet: what a person expects
from a sheet in a notes app (Notion databases, Coda tables, Excel's
core) and where Univer already gets there. For the study program: the
practice tools he rates (his Rising Fellow materials, Anki's sessions)
and the shape of a session, a bank and a plan that is domain-free. Get
his yes on both lists before building; see the research-the-bar rule.

**Unknown.** Whether the study half becomes its own built-in or an
extension; how much of the Exam 7 data model (recipes, roster, campaign)
generalizes and how much is his alone and stays in his workspace; the
migration of his existing banks and sessions.

### Study: rework it into what it was meant to be

**His words, 2026-11-16:** "I want us to focus on the study extension."
"The vision for it was that a person could drop files on any topic and
be able to generate content and study and learn a topic. Think of google
notebooks, but better. Except, it is currently unusable, my attempts at
using it when studying for exam 7 showed big issues." Earlier the same
session: "study is another thing that we need to rework."

**What the record holds** (found 2026-11-16 by reading his cloud session
of 2026-10-12, which quotes his local session of 2026-10-10; that local
session itself cannot be reached from the cloud, and his message in it is
cut off mid-sentence in the quote):

- 2026-10-10, three days after Study was built: "We built the study
  extention, but I think that was a watse of time, it does not work. what
  we do instead is build a canvas database of conceptual questions where
  we track which part of the syllabus the relate to, the apper, and we
  also track the number of times I attempt the conceptual quetsion, and
  the number of times, I go t it corretc, and when reuslt last time. This
  would allow me to discuss actively with Ai as I get things wrong, and
  the Ai can thinka nd know hwo to help me best, using tools to pullr
  eosurces and all. This is teh vision I had for study. Study was
  suppsoed to" (cut off there).
- What he used in its place, and still does: a canvas database, "Exam 7
  Conceptual Questions" (296 questions, 90 flagged as his confusion
  points, each with a model answer or a source), and a chat skill,
  `/concept-quiz`, that asks, grades against the model answer, records
  attempts, correct and last result on the row, and talks it through
  when he is wrong. Built 2026-10-10 to 12. The note left with it said
  not to touch Study without his say, and that his verdict on the quiz
  was owed.
- From his sessions of 2026-10-22 to 27 (`IMPROVEMENTS_2026-10-29`, item
  7): mark a question to come back to; Previous without undoing; a list
  of study notes he can tell the AI to add to, for making cards later;
  quiz answers that are lists.
- Related and unbuilt: the Lesson Builder brief (material turned into
  lessons), which he called "what I actually need" on 2026-09-05.

**Not in the record:** what exactly went wrong when he used Study for
Exam 7. "It does not work" and "big issues" are all there is; the
specifics were either in the cut-off message or said nowhere. To be
asked, not guessed.

**What exists** (`ext/study`, about 10,000 lines, built 2026-10-07 to the
brief in `docs/STUDY_MODES_BRIEF.md` and `docs/STUDY_BUILD_SPEC.md`): it
writes multiple-choice, typed and essay questions from a PDF or his own
bank, anchors each to its page, checks each before keeping it, grades
answers against the text, keeps mastery per concept and draws weak
spots. Its own pane, its own sidebar, its own route to the model.

**Claude's reading, for him to correct, nothing agreed:** what he built
to replace Study is the opposite shape. Study is a machine that writes
questions and scores answers in a pane of its own; what worked for him
is his material, a record of what he knows, and a conversation with the
AI over both. That is also what Google's NotebookLM is at its core:
sources in, a grounded conversation, and study forms made from the
sources on request. So the rework may be less "fix the quiz" and more
"Study is the notebook": the files, what was made from them, what he got
right and wrong, and the chat as the tutor that reads all three. Not
checked against Study's code yet.

**Assessed 2026-11-16** by an agent that used it in the built app as a
newcomer and read its code. No model runs in the cloud, so the app ran
against a scripted one: what is marked "his model" below is read or
counted, not timed on his machine. Study's own probe passed (0 failures),
which is the point: every flow works, and it is still unusable.

Why it could not be used, most likely first:

- Nothing can be answered until all 20 questions exist, and making them
  is about 60 model calls one at a time when nothing is dropped, 108
  when checks drop some (one call to map the chapter, one per concept to
  write, one support check per question, three distractor checks per
  multiple-choice question). At 10 seconds a call that is 10 to 18
  minutes before the first question; at 40 seconds, 40 to 72 minutes.
  The first question exists after 6 or 7 calls and is not shown. Stop at
  "6 of 20 ready" says "Stopped before any question was ready". (Seen in
  the app; the minutes need his model.)
- One unreadable answer from the model on the chapter's first call marks
  the chapter as mapped with no concepts, for good: "No questions could
  be made", and no further call is ever made for it. The only way back
  is to remove the material. (Seen in the app.)
- Every call carried a token cap that counts the thinking, the cap the
  house rule forbids because a thinking model then answers cut-off JSON,
  which feeds the two above. (Read in the code; the effect needs his
  model.) **Removed 2026-11-16**, on his word: "why do we cap the
  thinking? We shouldn't. I have said this again and again and again.
  Why does an extension put a thinking restraint on the model. Why are
  we rebuilding the harness there?" Why it was there: Study was built on
  2026-10-07, before Act broke on the same mistake and the rule was
  written; nobody went back over what was already built, and the rule
  was a sentence that nothing checked. Now a test checks it
  (`tests/unit/modelCapCompliance.test.ts`): no extension and no
  built-in tool may set a token cap or a thinking budget, except to pass
  on a limit the user set. Study was the only one that did. Still there,
  and part of the rework: Study keeps its own call to the model
  (`stChat`), with its own context size chosen call by call, its own
  temperatures and its own thinking switch. That is the harness built a
  second time; it should ask the core for a model answer and leave the
  rest to the core.
- The context size asked for changes on about half the calls, and a
  change makes Ollama load the model again. (Counted in the app; the
  cost needs his model.)
- It is a quiz machine and not a notebook: no asking the sources a
  question, no talking to the AI inside a session (Explain is one shot),
  no summary, guide or notes of his own.
- Sources are PDFs already in the workspace, or canvas pages. A .md,
  .txt or .docx is never offered; there is no drop and no file dialog.
- He cannot correct it: no editing a question, no overruling the grader,
  no Previous, no mark to return to. A failed grade discards the answer.
- The chat sees only concept titles and counts, not the question, his
  answer or the model answer. History is in Study's own database file;
  his 296-question canvas database cannot feed it.
- A 20-question session on a short chapter asks the same few concepts
  three ways, with the concept's name printed above each question.
- Smaller: Enter after Explain runs Explain again; each failed start
  leaves an empty session and a tab; Escape does not close the setup
  sheet; a half-typed answer is lost when the tab closes.

Worth keeping: the quote found on its page and Show Source beside the
question; marking an essay point by point; mastery per concept and the
weak-spot draw; import of past-exam questions and the examiner's report;
resuming at the same question after a restart; turning off and on
cleanly.

Not assessed: the quality of the questions and the fairness of the
grading with his models, real timings, the numeric check, Windows.

**Proposed by Claude, nothing agreed.** Two things are wrong and they
are separate. One is mechanical (the wait, the chapter that dies, the
cap, the reloads) and is why it "does not work". The other is the shape
(a closed quiz machine) and is why, even working, it is not what he
meant. What he built in its place has no wait because its questions were
made beforehand and checked once. So: making questions and studying them
come apart. A bank is built from the sources in the background, or
overnight on his machine, and shown as it grows; a session draws from
what is ready and starts at once. Then the notebook: any file dropped
in, the chat as the tutor inside a session and able to read the
question, his answer and the model answer, his own questions living in
it, and every question his to edit or overrule. First piece proposed: a
first question within a minute, and nothing that can kill a chapter;
without that, nothing else can be judged on his machine.

**Built 2026-11-16: Study made usable** (his ask: "can you run full
assessment and fixes, including ui and functionality"). An acceptance
probe was written first by an agent that did not build
(`tests/probes/study-usable-acceptance.mjs`, 59 checks, 52 failing on the
app as it was); four builders made it pass without editing it; Claude ran
it on the final code: 59 of 59, 0 page errors. Whole unit suite: 9,444
pass. All checked against a scripted model only: nothing here has run
against his models.

- Getting to a first question: the session opens on its first question
  (after about 6 model calls, not 60) and fills while he answers, with
  "N of M ready" and the time; Stop keeps what is ready; a garbled reply
  is asked again and no chapter can die; Auto leaves the context size to
  the core, so the model is not reloaded between calls; no model gives a
  message with Try Again and Open AI Settings, and no stray session.
- In a session: Enter after Explain moves on; Previous; mark to come
  back to, kept, with a Marked set in the sidebar; Mark as Right / Mark
  as Wrong over the grader, the concept following his verdict; Edit
  Question…; a failed grade keeps the answer, with Grade Again; a
  half-typed answer survives closing; Escape closes setup; the concept's
  name hidden until answered; no two questions in a row on one concept;
  Weak Spots in the sidebar.
- The card: every text at 4.5:1 or more (hints and his graded answer
  were 2.8:1, now 8.9:1); one reading measure of about 70 characters;
  after answering, the verdict is the largest thing; Next stays in one
  place; raw values in Study's styles replaced by tokens.
- Sources: `.md`, `.markdown` and `.txt` are material (headings become
  chapters); Study This Document… on them; Show Source scrolls to the
  passage (a core fix: the text editor now scrolls to a revealed
  passage, for every tool).
- The chat: `study_results` and `study_weak_spots` give the question, his
  answer, the right answer, the points missed and the quote; Discuss in
  Chat (key D) stages all of it in the chat with the source attached,
  for him to send.
- Core, generic: text and code editors show tools' `editor/title`
  entries (a More Actions button in their status line, only when some
  tool has one); `when` clauses can read the pane's own file.

Reviewed after the build by agents that did not write it. Modularity:
no breach; the authoring guide was not updated for the new editor
actions (fixed), and Show Editor Actions did nothing silently (fixed).
Correctness: six defects, five reproduced and fixed with a failing test
first: a genuinely empty chapter asked again on every start; one
unreadable chunk making a long chapter re-read in full with duplicate
concepts; an edited notes file moving concepts into the wrong chapters;
a restart mid-making leaving a short session with no way on (now Make
the Rest); feeding after Stop. One (Stop not sticking after a Refresh)
did not reproduce and was not changed.

Decided by Claude, for him to overrule: More Actions on text files sits
in the status line, since those editors have no toolbar; Discuss in
Chat stages the message and waits for him to send it; Auto lets the
core pick the context size (it may choose up to 65,536 for his model).

Left: the Study home page has no kit page header; the results screen's
bar and list disagree in their counts and its dividers vanish in light
mode; Discuss in Chat is not on the Previous view; Quiz This Selection
does not work in text editors; a page left out after two unreadable
starts is retried only when edited. Not done and not agreed: the
notebook shape (a bank built in the background or overnight, summaries,
guides, his own notes), for mock-ups and his pick.

**First thing on his machine:** open Study on a real chapter with his
model and see how long the first question takes, whether the questions
are good, and whether grading is fair. None of that can be judged here.

#### Study as the study system: learning, planning and tracking in one

**His words (2026-11-17, spelling corrected, shortened):** "I want us to
formalize the study extension into something substantive." Coaching
Actuaries "first gathered all the content", and "you could set an exam
date, set a start date, choose the days you want for the learn phase,
practice phase, choose the days you study and the ones you don't, and it
would help you come up with a plan. Since Exam 5 I have had to use other
vendors and have not had this. I believe Parallx can be that." With Rising
Fellow he would download the guides, summaries, the master problem
workbook and the cookbook and load them in, "then use what we already
have, with the study extension as a harness for the study campaign."

- How he studies: "The objective is to see the content as many times as
  possible." His spring sitting failed because he read files and forgot
  them, so with 6 or 7 weeks left he relearned everything and never
  learned "the mechanics of solving problems and pattern recognition in
  problem types". The fall sitting paired conceptual quizzes with the
  practice-problem campaign and "felt a lot calmer". Making Friday a rest
  day was "exactly what I needed"; plans that span weekends with no rest
  ended in reshuffling.
- What he used: Planner for what to study each day, canvas pages for
  notes, Flashcards for cards of sections, Worksheets for problems, the
  PDF editor to read, chat when stuck; flashcards and the conceptual quiz
  ported to a claude.ai artifact to do on the fly. "It is not inventing
  new notes surfaces or pdf surfaces." Think of the campaign dashboards,
  gamifying, tracking.
- Hours: 130 hours of work study time; a full day each sitting spent
  building the plan, counting work and personal hours toward 400 to 500;
  "very bad at tracking how much of that time I actually use". Mornings
  5:30 to 7:30 personal, 7:30 to 9:30 work; an evening hour budgeted
  (flashcards, conceptual questions, discussions) that he rarely keeps
  until the last 6 weeks. "Some days I study more, some less, so we need
  margin of error. Best case, worst case."
- Plans and rewards: a bare minimum plan that still reaches 400 hours, a
  standard plan above it, an ambitious one. "It isn't just about time. We
  have to somehow incentivize studying more. Going above and beyond.
  Currently all my studying has been motivated through will power and
  panic." "A legitimate XP structure, even for the chat discussions."
  Maybe only the standard plan is shown, with review items and questions
  suggested for extra XP, and extra work done unprompted rewarded too.
- Generic: "if I decided to learn more about GLMs (not tied to any exam),
  I would set my start date, end date, how many hours, what days, the
  location of sources and guides, the location of notes (maybe a
  database of notes). We generate a study plan. It automatically creates
  planner tasks, populates a dashboard." The practice problems may be
  the one part that stays exam-shaped. "Before we build anything we plan,
  design."
- Added the same day: "It is likely that I take the week before my exam
  fully off. Generally we are allowed to use the paid study time to get 4
  hours of study per day in the two weeks leading up to our exam. We can
  use a max of 20 hours a week. I will usually pair this with PTO for
  the secondary 20 hours, so my final week I am off from work and the
  week prior to that I am on half days. This has helped me a ton. I
  generally aim for two hours each day otherwise for the work study
  time. I also increase my hours in the last 6 to 8 weeks, including
  more studying in the evening. I want us to do a similar thing to the
  question campaign we did as well."

**What was read for it (2026-11-17).** The app, by an agent: Worksheets'
study program, Planner, Flashcards, Study, the dashboard, chat, canvas
databases, the PDF pane, the Exam 7 handoff. The vendors and the
research, by two agents. This session's network is the Parallx
environment's, so no vendor page, paper or product blog could be opened:
everything about them below is from search excerpts of the URLs named in
this session, and the bar is to be read again from the Default
environment before a surface is drawn.

- *Coaching Actuaries:* the planner (now CheckPoints) takes the exam
  date, study days and rest days and works backward; each lesson carries
  points for its time and its weight (50,000 per course); a daily goal;
  "recalculates instantly" on a missed day, a rest day studied or a goal
  beaten; Learn Pacing shows days left until the practice phase. It plans
  points, not hours, and records no time. Earned Level (0 to 10) moves
  only on scores of its generated practice exams. No badges or streaks.
  No Exam 7 course.
- *Rising Fellow (Exam 7):* video lessons, a guide per topic, summaries
  by paper, the Cookbook (75+ recipes), 500+ problems, past CAS problems
  in Excel, ProblemTrack (a macro workbook that builds quizzes and tracks
  self-graded scores by paper), 450+ cards, 3 practice exams. Everything
  is organised by syllabus paper. No planner: a free hours tracker (20
  weeks, 300+ hours, logged in quarter hours against a plan) and phase
  advice (review and practice from 6 weeks out, a first full exam 4
  weeks out). TIA redistributes missed tasks over study days;
  BattleActs gives hours per article.
- *Hours:* the CAS's own surveys say candidates report 250 to 345; "100
  hours per exam hour" is a rule of thumb in a CAS newsletter, not a CAS
  rule (about 400 for Exam 7).
- *Learning science:* retrieval beats rereading and learners do not feel
  it (Dunlosky 2013; Karpicke 2009); interleaving problem types took a
  4-month classroom trial from 38% to 61% (Rohrer 2020), the direct cure
  for "pattern recognition in problem types"; successive relearning (a
  correct recall in each of 3 to 4 spaced sessions) for concepts, with a
  smaller effect on procedures; worked example, then completion problem,
  then unaided problem, fading.
- *Motivation:* points and levels raise quantity, not mastery (Mekler
  2017); a badge and leaderboard course lowered exam scores (Hanus & Fox
  2015); effects fade after about 4 weeks; reward inputs that are
  learning (Fryer), not time; a broken streak lowers what follows
  (Silverman & Barasch 2023); range goals keep people going (Scott &
  Nowlis 2013); 2 skip days in a 7-day goal beat both a 5-day and a
  strict 7-day goal (Sharif & Shu 2017); a planned weekly lapse kept
  self-control (Coelho do Vale 2016), which is his Friday; fresh starts
  at week and month landmarks (Dai, Milkman & Riis 2014); positive
  feedback on competence raises intrinsic motivation where rewards lower
  it (Deci 1999); people underestimate how long work takes, even in
  their worst case (Buehler 1994).

**What exists (verified in the code 2026-11-17).** Most of a harness is
already built, in the wrong place and shaped to Exam 7:

- Worksheets holds a campaign (problems in N days, rest weekdays, pace,
  a daily draw spread across papers), an imported day-by-day plan (the
  Campaign tab: blocks of quizzes, exams and other tools' commands,
  done when the activity journal shows a line), the roster, XP (10 a
  problem with bonuses for an Easy rating and a full day, XP on each plan
  block, 300 a level, ten titles), 17 milestones (three of them for daily
  streaks), Cash Out at dollars per 100 XP, and an idle-aware study clock
  (`studyClock.ts`) that counts only time on Worksheets' own screens and
  is summed by day and by paper on its dashboard. Flashcards sums review
  time (capped at 60 s an answer) and Study keeps seconds per session.
  Nothing sums time across tools and nothing plans hours: a plan block's
  times only order the day.
- Planner: a route for other tools to make tasks (`planner.getRegistry`
  then `data.createTask`), used by none yet; the day-load badges
  Flashcards and Study feed.
- Flashcards: FSRS-6 per card, a review log with time taken, the
  `parallx:card-rated` event, `flashcards.addCards` and `studyTag`, a
  journal line when a session ends.
- Study: concepts with mastery, the question bank, sessions (a timer
  that is not idle-aware), `study_results` and `study_weak_spots` for the
  chat, the question-provider registry it reads, a weak-spots widget.
  It writes nothing to the journal.
- Missing: a named API for an extension to read the activity journal
  (it can reach the journal's `query` today only as a raw core service,
  `api.services.get`, which no extension does); one ledger of study time
  across tools; a plan or campaign seam other tools register into; any
  word from chat about which topic a conversation was on; a typed
  canvas-database API for extensions (today the raw canvas data service,
  or chat tools behind a permission prompt); any event from the PDF pane
  about pages read (the journal records only a PDF opened, viewed and
  closed).

**Worked out with him, 2026-11-17 (his spring 2027 plan, the first real
run of the arithmetic).** The sheet and the script that makes it are on
`exam7-campaign` in `campaign/spring-2027/` (every day, three plans,
running totals). What he settled in the discussion:

- The exam: the 2027 CAS window for Exams 5 to 9 is April 13 to 20; he
  sat on April 21 in 2026, the last day of that window, so the plan takes
  Tuesday April 20. Start December 7 if results are out, else January 4;
  Christmas week and New Year's week are off.
- Hours goal: "not 400, a more conservative estimate, closer to 500."
- His week: Monday to Thursday 5:30 to 7:30 personal and 7:30 to 9:30
  work; an evening hour, two in the last 8 weeks; Saturday and Sunday 4
  hours each; Friday off, for work study too.
- Work study: 130 hours; 2 a day Monday to Thursday, starting only when
  that can run unbroken to the final two weeks ("acceleration and
  momentum"), which is Thursday January 14; then 4 a day Monday to Friday
  for the last two weeks (20 a week), the first of them on half days with
  PTO, the last fully off at 8 hours a day.
- Phases, as passes over the whole syllabus: read only; read and notes;
  read with that chapter's problems and recipes; every problem mixed; the
  hard ones, with source review "somewhere in the middle toward the end";
  practice exams and mixed quizzes. Fixed day lists early, dynamic
  (quotas over what is left) from the middle to the end.
- Slack, his words: "a plan with no built-in contingencies is built to
  fail." Rest weekends between phases (Friday to Sunday: January 22,
  February 12, March 19), a rest Saturday April 3, a catch-up Thursday at
  the end of each phase, and a range of hours.
- The three plans differ only in personal hours; work study is the same
  in all. Floor 385 (mornings, 3-hour weekends, evenings only from the
  ramp), standard 486, stretch 557 (2-hour evenings, 5-hour weekends).
  Over 97 study days of 134.
- How he wants to see a plan: every day from start to end with its exact
  hours, and a summary of hours per day by number of days. Weeks alone
  hide too much.

**The system, planned (2026-11-18).** His words on the drafts before it:
"No, lets not use dashboard. We want it to live in study. We are
essentially moving the tracking and planning to study extension." "Study
still also keeps the ability to generate questions and study." "Rethink.
Think system." Then: "plan it accordingly." This replaces Claude's
earlier proposals in this entry; the spring 2027 numbers above stand.

*What it is for.* What is known on exam day must cover what the exam
asks. Hours are the input; the stock that matters is what he knows of
each paper, which grows with every time he works the material and leaks
every day he does not. Study runs the loop that keeps it rising with the
time there is: a goal, a plan, the work (in Study and in the other
tools), a measure of what was done and what is known, a comparison, a
correction (catch-up, a replan, weak spots, extras). Each past failure
was a broken link of that loop: spring measured nothing, so the leak
went unseen; hours were never measured; the plan took a day by hand;
nothing corrected a plan but reshuffling; nothing fed back, so it ran on
willpower and panic.

*Four stocks:* time (personal, work study, PTO; a day unused is gone);
material (papers, their sources, the items made from them); knowledge
(his state on each item and paper); energy (rest and the range of plans
keep it, visible progress feeds it).

*Study is both halves, in one tool.* It keeps what it was built for:
sources in, questions made from them and anchored to their page,
sessions graded against the text, mastery by concept, weak spots,
Discuss in Chat. It adds the campaign: the plan, today, progress, hours,
and later rewards, taking over what Worksheets holds now. The other
tools are where the rest of the work is done (reading in the PDF editor,
notes on canvas, cards in Flashcards, problems in Worksheets, chat,
tasks in Planner); Study sends him into them and counts what was done.
No dashboard: Study's own views.

*Subject and campaign.* A subject (Exam 7, GLMs) holds the papers, the
items and the notes, and outlives a sitting. A campaign is one stretch of
time over a subject (spring 2027): its dates, week, phases and days. A
retake is a new campaign on the same subject, with what he knows carried
over.

*Two records, which everything else is read from.*

- Item state: an item is anything he can be tested on, tied to a paper
  and the page it came from: a conceptual question (Study's), a problem
  (Worksheets), a card (Flashcards), and, for the reading phases, a
  section of a guide. Each keeps its latest result where it lives.
  Study's own items keep attempts, correct, last result and last date on
  their row, the shape of his 296-question database. Progress and memory
  are read from item state.
- The work log: one row per stretch of work, not per card (a row per
  review would be some 10,000 rows a campaign, each a page): when, how
  long, which paper, which tool, what kind, how many items, how it went,
  confirmed or not, and whether it came from the app, his hand or the
  artifact. Hours, the plan against what was done, and later rewards are
  read from the work log.

*Where the data lives: canvas databases Study creates and reads, visible
and editable, kept when Study is off.*

| Database | Belongs to | One row per | Holds |
|---|---|---|---|
| Papers | subject | paper | order, weight (exam points), sources, guide pages, card tag, problem paper; counts by kind and colour, last worked (Study's) |
| Items | subject | Study's question | question, model answer, kind, paper, source and page, origin, marked, confusion point, attempts, correct, last result, last date |
| Notes | subject | note | his database, with a Paper relation |
| Campaign | campaign | campaign | subject, exam date, start, hours goal, account rules |
| Week | campaign | block | weekday, start, end, account, floor / standard / stretch hours, the dates it holds |
| Phases | campaign | phase | dates, the rule (which items, in what order, how many passes); hours rolled up from Days |
| Days | campaign | date | phase, type (study, rest, catch-up, holiday, half day, off), planned personal and work hours for each plan, actual hours rolled up from the work log, running totals, kept-as-edited, a note |
| Work log | campaign | stretch of work | as above |

Edit a rule (Week, Phases, rest dates) and the days not edited by him are
worked out again; edit a day and it is kept. Rows rolled up into Days and
Phases move Study's views at once (the databases fire row and cell
changes). Items is his conceptual database adopted, not copied: Study
adds the columns it needs, his 296 keep their history, and
`/concept-quiz` keeps working on them.

*The plan is a schedule of work on items, paid for in hours.* Each of his
phases is a rule over items: read only (every guide section, in order);
read and notes (again, with a note per paper); read with problems and
recipes (each chapter's problems, kept by chapter); every problem mixed
(all of them, shuffled across papers, which is the fall question
campaign as one phase); the hard ones (last result yellow or red); exams
and mixed quizzes. Hours and items meet through his minutes per item,
measured from the work log (and from Worksheets' clock for the fall), so
the plan checks a phase fits before it starts ("560 problems at 9
minutes is 84 hours; the phase has 70"). Early phases give fixed day
lists; later ones a quota, what is left over the study days left. Rest,
catch-up and the three plans sit on top, as in his spring draft.

*Questions are made ahead of the plan, not on demand.* The plan knows the
next paper and how many items it has; what is short is made the night
before on his machine and marked for him to keep or drop. Weak spots ask
for more on the concepts missed. Nothing waits at the start of a
session, which is what made Study unusable.

*What he sees in Study, every day:* what to do now (Today, each block
opening the right tool already set up); whether he is on track (hours
and items against the plan, floor to stretch); what he knows and what is
fading (a bar per paper and kind, green, yellow and red per item, the
counts attempted: the fall dashboard that drove him, made general).

*Built in the core, for any tool:*

1. A door to canvas databases for tools: create one a tool owns by role,
   keep its columns, read and write rows, hear row and cell changes. The
   service exists (`databaseDataService.ts`, with change events and
   roles) and no tool can reach it.
2. Columns a tool computes: marked as that tool's in the column's
   config, read-only to the person, put back if deleted.
3. Study work providers, a contribution point like the question
   providers: a tool answers "the state of this paper's items" and
   reports work done. Worksheets, Flashcards, the PDF editor, canvas and
   chat register; a tool turned off adds nothing and nothing else
   changes.

*Pieces, one to a session, each by the ship-piece order (acceptance
probe first, reviewers who did not build it):*

1. The record: the database door and tool-owned columns; a subject in
   Study (name, sources folder proposing the papers, his notes database
   linked); his conceptual database adopted as Items; Study's sessions
   drawing from Items and writing results back; the work log, written by
   Study's sessions. Done when his 296 keep their history and
   `/concept-quiz` still works, a Study session on a paper writes item
   results and one work row, a deleted owned column comes back, Study off
   leaves every database whole, and 2,000 item rows open in a measured
   time.
2. Progress: providers in Worksheets (Easy, Medium, Hard as green,
   yellow, red) and Flashcards (last rating: Again red, Hard yellow,
   Good or Easy green); the Progress view. Mock-ups first. Done when it
   shows his bank with the counts the Worksheets dashboard shows today, a
   rating moves its bar without a reload, and Worksheets off takes only
   its bars.
3. The plan: the setup form writing Campaign, Week, Phases and Days; the
   three plans; the fit check; the Plan view (every day, and hours per
   day by number of days); edits kept, rules regenerated; Planner tasks
   when Planner is on. Mock-ups first. Done when his spring 2027 draft
   gives 385, 486 and 557 and the same days as the sheet, a new exam
   date reworks it, an edited day survives, and the mixed-problem phase
   is flagged if it does not fit.
4. Today and the loop: Today with the day's items (a list early, a quota
   later), each block opening its tool set up; catch-up days; the Monday
   look back offering ways to absorb what slipped, never re-spreading it
   silently. Mock-ups first.
5. Hours: work rows from every provider, reading in the PDF editor, and
   chat; a session rebuilt with the idle cut-off and confirmed once; the
   accounts and their rules; actual against plan; the artifact's export
   and import (items out, results and time in).
6. Questions ahead of the plan, overnight on his machine.
7. Rewards, after the XP discussion; the chat skill that credits
   discussions.
8. Worksheets hands over: its campaign, dashboard, day plan, roster,
   rewards and clock retire once Study shows his data and he says so;
   the `worksheet.*` commands keep working.

Kept from Study as built: materials and their outline, the question
maker and its checks, grading, mastery by concept, weak spots, examiner's
report import, Discuss in Chat; all pointed at Items. The bar for the
Progress, Plan, Today and setup views is read again from the Default
environment before their mock-ups (this session could read the vendors
and papers only through search excerpts).

*Risks:* each database row is a canvas page, so the size of Items is
measured in piece 1; a rule regenerating days must never overwrite a day
he edited; a PDF's reading is credited to a paper only through the
sources folder's mapping; ratings differ between tools and are mapped,
not compared.

**Settled in the same discussion:** videos are not used; hours per paper
from the guide's length and Rising Fellow's guidance, corrected by his own
pace; what drove him in the fall was the count of questions attempted and
the bars by paper in green, yellow and red, not the XP; XP is "valuable"
and needs its own discussion; chat credit can be a skill that reads the
day's chats and awards it; progress goes back and forth with the claude.ai
artifact he uses at the library (an export and an import, with time);
Worksheets' campaign moves into the harness ("that was then, this is
now"); notes in a canvas database; no log of work hours needed.

**Piece 1 shipped: the record (2026-11-18).** Commits `1c5756a6` (the
acceptance probe, before the build), `5a63c9a9` (the core door),
`81c8f02b` (Study's subjects), `0e81fc13` (what review found, fixed).

*What is built.*
- The core has a door to canvas databases for any tool,
  `api.canvas.databases` (list, get, create, a page, columns, rows,
  changes, open), and a column can be kept by a tool: only that tool
  sets its cells, and the cell says "Kept by" and the tool's name while
  the app knows the tool. The person can still rename or delete such a
  column. Authoring guide §4.17.
- In Study, New Subject… makes a page with three databases: Units,
  Questions and Work Log. An existing questions database is used where
  it is, its columns matched in the same sheet; only columns it lacks
  are added.
- Study reads the questions from the database. A unit's session asks
  that unit's questions; each result is written to its row (Attempts,
  Correct, Last Result, Last Answered); Units carries Questions,
  Answered, Right Last Time and Last Worked, kept by Study; each session
  writes one row in the Work Log.
- Study's sidebar has a Subjects section: each subject and its units
  with "N of M" answered, and Open Units, Open Questions, Open Work Log,
  Study… and Remove Subject….
- With Study off, nothing of it runs and the page and databases stay.

*How it was checked.*
- The acceptance probe `tests/probes/study-record-acceptance.mjs` was
  written from the request before the build and not edited after: 72 of
  72 on the real app. 2,000 questions: counts shown 9.3 s after New
  Subject, an answer on its row in 0.3 s.
- Typecheck, 9,516 unit tests, the build, `study-usable-acceptance` (59
  of 59) and the touch-drag probe pass.
- Four reviewers that did not see the build read or drove it, and a
  skeptic tried to refute the bug findings and could not. Fixed, each
  with a test seen failing first: no write-back from a session over the
  marked set; a unit renamed in Units splitting; a unit named by a page
  id; a mapped column of an adopted database, renamed, getting an empty
  twin; a session finished just
  before quitting never written; a database in the Trash read as empty
  and its questions made new on restore; "Kept by" shown to the mouse
  only; Study's setup sheet letting Tab out and losing focus on Escape.
- After the fixes a verifier drove the eight fixed cases on the real app
  and could not make one fail.
- Grading in every run used a scripted stand-in for the model.

*Found and left.*
- A result is counted twice if the app is killed in the few milliseconds
  between writing the row and noting it.
- A select, status or tags column kept by a tool can still be changed
  through Edit options…, and another tool can add options to it. Study
  keeps only numbers and a date.
- A session already open does not follow edits made to its questions;
  the next session does.
- A unit renamed in Units while Study is off still splits (the rename is
  followed only while Study runs).
- A question with no answer is counted and never asked.
- A question naming two units is counted in both and asked only in the
  first.
- A column renamed in a Questions database Study made, in Units or in
  the Work Log comes back empty under its old name; in Units the renamed
  one keeps its last numbers and is no longer updated.
- Notes in New Subject… is stored and not yet used.
- When a Units row is deleted, its questions sit under no unit in the
  sidebar (the subject's total still counts them) and their Unit cell
  reads "Untitled".
- After a unit is renamed, the old name stays as an unused option in a
  select column.
- The results screen of a marked-set session read "0 of 1 concepts
  clean" straight after a right answer.
- "Kept by" shown on a tap goes after half a second if a mouse pointer
  is resting on another control.
- In a sidebar about 125 px wide, subject names are cut to a letter.
- A session over two subjects puts its whole minutes on each subject's
  Work Log row.
- Work Log's Date, Items and Right are not kept, so dragging a row on a
  calendar re-dates it.
- Removing a subject and adopting its questions again makes a second
  page, Units and Work Log; the first stay.
- The full keyboard audit does not finish in the cloud container. The
  screens it reached read 0 except one missing focus ring on the
  terminal's command input, which this piece did not touch.

*Decided for him to overrule.* The kit dropdown's arrow is drawn in CSS
(every dropdown); the column matching is inline in the one sheet;
Sources folder is a list of the first workspace folder's folders (three
levels, 300 at most), not a typed path; a
unit shows a state icon and no bar (bars are piece 2); a Work Log row
is written at the first answer and updated; a row with no Kind is asked
as a short answer; after Create the subject's page opens.

*Only his machine can show.* His own conceptual database adopted with
its real columns; grading by his model; the full keyboard audit.

**Piece 2 shipped: Progress (2026-11-19).** His word on piece 1's
report: "go ahead. I will check everything at the end." Commits
`cde23e2c` (the acceptance probe, before the build), `74df56d0` (the
core seam), `e96c45ff` (the kit bar), `9fc71afd` and `35cf94ac`
(Worksheets and Flashcards report), `c46f2541`, `8a1f1c97`, `e4e6b07b`
(Study's Progress), `d3637fcc` (two probe checks corrected by the
verifier), `ac54cd16` and `7fd210cd` (what review found, fixed).

*What is built.*
- The core has a registry any tool reports progress into,
  `progress.getRegistry`: a provider names its kind of item, its own
  words for four states, and its groups with counts. It names no tool.
  Authoring guide §4.11c.
- The kit has one stacked bar, `api.ui.createStackedBar` (guide §6.3):
  four states told apart by colour and by texture (solid, hatched,
  ticked, an outline), the whole bar named in full for a screen
  reader, a part with an action a button with its own name.
- Worksheets reports its workbook problems by paper (Easy, Medium,
  Hard, Not rated) from the same function its dashboard uses, so essays,
  custom-bank and practice-exam problems are in no bar, as there.
  Flashcards reports its cards by tag and by deck from each card's last
  rating (Good or Easy, Hard, Again, Not reviewed), leaving out
  suspended cards and archived decks.
- Study has a Progress tab per subject (More Actions > Open Progress,
  or "Study: Open Progress…"): a totals card with a bar and the counts
  in words per kind, then a row per unit with a bar per kind and
  "N of M". Questions are Study's own, by Last Result (Right, Partly,
  Wrong, Not yet).
- A part of a Questions bar starts that unit's setup on just those
  questions; a part of a Problems bar opens Worksheets' quiz builder on
  those problems. Cards parts are plain.
- In Order / Weakest First, remembered. An answer, a database edit, a
  rated problem or a rated card moves an open tab without a reload.
- A tool's group belongs to the unit of the same name (case, spaces,
  punctuation and accents ignored) or one named in the unit's Also
  Called, a column Study adds to Units for him to fill. Groups matching
  no unit are listed under the rows, each with its total.
- Each unit in Study's sidebar carries a thin bar over all kinds.
- A tool turned off takes only its bars, at once.

*How it was checked.*
- `tests/probes/study-progress-acceptance.mjs`, written from the request
  before the build: 87 of 87 on the real app. Two of its checks (9.7,
  9.8) were corrected by the verifier that wrote it, not the builder: a
  click in the window's corner pressed Home, so they measured the wrong
  tab; 9.7 gained an assertion and both fail on a build with the focus
  ring and Enter removed. Piece 1's probe still passes 72 of 72.
- Typecheck, 9,653 unit tests, the build, `study-usable-acceptance` (59
  of 59), the touch-drag probe and the keyboard audit on Study's screens
  pass.
- In the real app the Problems counts equalled Worksheets' dashboard
  after each rating and re-rating; live changes showed in under 0.3 s;
  20 units with three kinds opened in 0.07 s.
- Four reviewers that did not see the build read or drove it; a skeptic
  upheld the count findings. Fixed, each with a test: a card counted
  once per matching tag or deck; a part opening only one of two matched
  papers; Worksheets' open quiz builder ignoring a new selection;
  "Not yet" in his own result column drawn red before any attempt; a
  tool's bars emptied by one failed read; states told apart by hue
  alone and gone in high contrast; a part's word and count shown to the
  mouse only; sidebar names cut to a letter in a narrow sidebar; the
  sidebar's spoken count and tick disagreeing with the visible count;
  parts 23 px tall to a finger when stacked; focus left behind when the
  tab is opened from the palette.
- After the fixes a verifier drove nine fixed cases on the real app:
  eight held; the sidebar still loses its names in a 900 px window at
  200% zoom (below).
- Grading in every run used a scripted stand-in for the model.

*Found and left.*
- The sidebar's "N of M" is questions with an attempt plus each tool's
  rated items, over all of both; its bar and the tab count questions by
  result. They differ where a result was typed without an attempt, and
  where an attempt has no result Study can read; then a unit can show
  the done tick over a bar with a not-yet part. Piece 1's probe pins the
  sidebar's count; which he wants is his call.
- A question naming two units shows in both units' bars and is asked
  only under the first.
- With two subjects, each tab lists the other subject's groups as not
  matched; a catch-all deck is always listed.
- On the thin sidebar bar the texture is a line style (solid, dashed,
  dotted), the weakest of the cues; in a sidebar row of 136 px or less
  the bar is not drawn. In greyscale and in high contrast, partly and
  wrong are hard to tell apart on that thin bar. At 200% zoom the
  subject's own name is cut, and in a 900 px window at 200% the app
  gives the sidebar 53 px, where no unit name shows at all.
- Two units whose names start alike read the same when cut; the full
  name is in the tooltip. The sidebar bar cannot be pressed or asked for its numbers; a
  screen reader is told them.
- Unit rows show per-state numbers only in a part's words (hover,
  focus, tap, long press); for a plain bar (Cards) only hover and tap,
  so a sighted keyboard user cannot read them there. The totals card
  shows them plainly. The legend is in Study's words only; a tool's
  words are on its totals line.
- A provider that forgets to register through its tool's subscriptions
  would outlive its tool; the seam does not tie the two (the question
  providers have the same shape).
- Also Called is added to every subject's Units, of use only with a
  reporting tool on.
- The app's older hand-made bars were not moved to the kit bar.
- The full keyboard audit was not compared with the commit before; on
  Study's screens it reads 0.

*Decided for him to overrule.* No mock-ups were drawn first, on his
"I will check everything at the end"; the look was held to the measured
criteria and the reviewers. Built in the same session as piece 1.
Hatch and ticks as the second cue on the bar. The sidebar bar runs
under the unit's name with the count at its end. Problems parts open
the quiz builder set to those problems, not the quiz itself. A tool's
totals are over its matched units. One sort choice for all subjects.

*Only his machine can show.* His own database, problems and cards
matched to his units; whether the bars feel like the fall dashboard.

**Piece 3 shipped: a unit is one place for all its material
(2026-11-19).** His words: "Think of study as a harness, one stop shop to
access all your study material across all the extensions. A user can
click and the editors open." "Just let me select the files that are my
notes. ... Build something that can handle any and all layouts."
Commits `d34f8e57` (the acceptance probe, before the build), `16a0d4a3`,
`970d0b6c`, `0e505282` and the ones after them.

*What is built.*
- A unit in Study's sidebar opens its tab "<Subject> · <Unit>" (one per
  unit: pressed again after a restart, still one; a tab coming back by
  itself with the app is read in code, not seen); Study… is the tab's main action and the
  unit row's own More Actions. The tab: Notes and files (each item one
  line, its icon, title and where it lives; the row opens it in its own
  editor; Remove takes it off the unit), Questions (counts in his words;
  Study Questions…, Open Questions, a bar whose parts start those
  questions), then one group per tool that reports progress, in its own
  words, whose bar, when the tool can open its items, opens the tool on
  them through its provider.
- What is attached is his: a column Material (files type) in Units,
  which he edits like any column; Study also writes to it on its own (a
  page renamed, a file moved) and adds it back if he deletes it; a page is held by its link (parallx-page:<id>), a file
  by the canvas's workspace link, so the table shows each by name and an
  edit there shows in the tab. A page renamed is named again in the
  tab, and in Material the next time that unit's tab is drawn. A file
  renamed in the Explorer is followed (seen); one moved by its cut and
  paste or drag goes the same way (read in code, not run); a file moved
  while Study is off is not followed and reads Missing. A page in the
  Trash or a file gone says Missing, with Remove.
- Add Notes or Files…: every page (the subject's own Units, Questions
  and Work Log aside) and every workspace file outside hidden and
  machinery folders (up to 20,000; 200 drawn until the search narrows
  them), searched by name and place, several at once. Find Matches… (the subject's More
  Actions) proposes pages and files named like a unit or an Also Called
  of it (Progress's own matcher), all unticked; Attach Selected.
- The core, generic: the quick pick of several (checkboxes, Cancel and a
  confirming button that run quickPick.cancel / quickPick.accept,
  `confirmLabel`, a search over every word); `workspace.listFiles()`;
  `workspace.onDidMoveFiles` (the file service says where a moved file
  went; the Explorer's moves go through it). The Explorer's Rename no
  longer draws its field in a row a refresh replaced.
- New Subject has no Notes choice. A subject made with one keeps its id
  in Study's store, but nothing shows those notes in the unit's tab
  unless they are attached; `study.newSubject` now ignores a `notes`
  argument.

*How it was checked.* The acceptance probe (74 checks) on the real
app (seeded Linux workspace, a scripted model, a stand-in third tool),
unedited: 56 of 74. The verifier measured that with 44 tabs open, 43 of
the probe's tab points land on another tab or nothing, and 10 of 59
choice points miss their box; the 18 pass once the probe re-reads each
point before its click (a patch to `tabs()`, `choices()` and `click()`
waiting on his approval; no assertion changed): 74 of 74, after the
review fixes too. The verifier also drove it with a script of its own
(9 checks, before the review fixes): attach a page and a file, open each
with one press, rename the page (the tab lists the new name, and again
after a relaunch), Flashcards off (its group goes in 0.09 s) and on. Typecheck, 9,795 unit tests and the build
pass; keyboard audit 0 on the unit tab, its picker and Find Matches (the
audit does not measure a box's outline; the 3:1 outline is read from the
tokens for the default dark only). Piece 1's probe builds its workspace
with the Notes choice, so it gives 29 of 72; with only its seed line
changed, 70 of 72, and 1.1 and 2.5 fail because they ask for the Notes
choice this piece removed. He approved both probe changes (2026-11-22,
"approved"); with them, on the final build: unit 74 of 74, record 72 of
72, progress 87 of 87, usable 59 of 59.

*Review* (the reviewers' and skeptic's reports were in the session, not
saved as files). Modularity: no breach (two core comments named Study; reworded).
Correctness: seven findings, six reproduced by the skeptic; fixed the
one he would meet: Add Notes or Files… from the palette opened the
unit's tab instead of the picker (`021b9593`). Left, reproduced but not
met in his use: a file outside the workspace reads Missing (the picker
offers only workspace files; a typed outside path is the only way in);
in a workspace of several folders, files outside the first do not follow
a move; a Material column he retypes to text breaks attaching; a slow
page read can leave the tab without its "where" lines until the next
change; Find Matches stops silently if one attach fails. Not reproduced:
a retitle write can land over a newer edit in the same instant. Access:
fixed a missing item not said to a screen reader, the picker's unticked
box outline under 3:1, and Enter with nothing ticked saying nothing
(`a19fd6b8`). Left: a one-item More Actions menu on a unit row.

*Decided for him to overrule.* The Notes choice in New Subject, which
piece 1's probe asks for, is removed: notes are attached to units from
any layout instead. Material is one files column (pages and
files together) rather than a relation plus a files column. Find
Matches proposes exact name matches only (a title that merely contains a
unit's name is not proposed). Questions has its own Study Questions…
beside the header's Study…. A unit row's More Actions shows on hover,
focus or touch and keeps a slot of its own, so long unit names are cut
a little sooner in a narrow sidebar.

*Only his machine can show.* His Exam 7 workspace's pages and files in
the picker, and Windows paths.

**The plan shipped (2026-11-23).** His words: "a study harness like the
Coaching Actuaries planner: exam date, start date, study days and rest
days, a generated plan." "Three plans: bare minimum, standard,
ambitious." "A plan with no built in contingencies is built to fail."
"Changes made to a database reflect in Study automatically." Commits
`d3d1042d` (the acceptance probe, before the build), `e747e1bb` (the day
arithmetic), `4914e441` (many rows at once in the core), `7915b994`,
`f8f5eee3`, `d6654f73`, `bcb341b6`, `31dbe9a1`, `b813c51b`, `f04097f2`, `1b99f710`, and the review's fixes after them.

*What is built.*
- New Plan… in a subject's More Actions and the palette ("Study: New
  Plan…", `study.newPlan`): a sheet for Name, Exam date, Start date, Hours
  goal, the usual week (a personal and a work field per weekday, in the
  Standard plan's hours) and how many hours less the Floor and more the
  Stretch (both 1). As he types it says the dates in words and what the
  week comes to in each plan. An exam on or before the start is refused in
  words. Create makes a page named for the plan under the subject's page
  with Plan, Week, Phases and Days, one Study phase "Start to exam", works
  out every day and opens the tab.
- The tab "<Plan name>": the exam date and the days left; Open Days, Open
  Week, Open Phases, Open Plan Settings; the three plans as cards side by
  side ("Standard · Following 486 h, 14 under 500"), choosing one writes
  Following; hours per day by number of days with the study days and all
  days counted; the phases in date order (kind, dates, days, hours), and a
  study phase with Items and Minutes per Item says "Needs 84 h, has 72 h"
  or that it fits, its switch "All plans" showing Floor, Standard and
  Stretch; "Rules that disagree" naming a Week block with no days, a span
  that ends before it starts, two Study phases over one date; then every
  day as a table (caption, column headers, a header cell per row), a
  tbody per week, today marked (aria-current), Done beside Total on days
  gone by, Rest italic, Catch-up and Holiday a filled word, rest days and
  holidays on the inset ground; days he edited outside new dates listed
  under "Outside the plan".
- Live: any change to the four databases or the subject's Work Log is read
  again and Days made to agree: the cells that differ in one write, days added or removed in one more each. A day
  whose Type, Phase or hours he changes is ticked Edited and kept; unticked
  it goes back to the rules. A database in the Trash or gone is said in the
  tab and nothing is written. Study off: nothing runs; on again the days
  catch up.
- Under the subject in Study's sidebar, over its units: the plan whose
  exam has not passed and is soonest, with its days left; it opens the
  tab. More Actions has Open Plan once there is one (`study.openPlan`,
  "Open Plan…" in the palette, asks which when there are several).
- The core, generic: `api.canvas.databases.create` takes a `width` per
  column (and for the title column), written into the new table view; the
  plan's databases use it so the cells he types into are on screen. The
  door's `addRows`, `updateRows` and `removeRows` (many rows in one
  write). The kit's segmented control as cards (`detail` under a label).

*How it was checked.* The acceptance probe (92 checks, written before the
build by a verifier) on the real app, Linux, zone America/Chicago, with a
no model (the chat's tools are called directly). Unedited it gave 22 to 32 of 92, by timing. The verifier
traced every failure to the probe, seen on the app: its step that opens
the New Plan sheet took the Explorer's Open Editors row "Exam 7" for the
subject pick and so hid the sheet; 4.6 could not pass on a right app (the
rules gave the hand-typed 5 again); 6.6 found "overlap" in the phase's
own name "Overlapper"; and 1.6 read Week's headings before they were
drawn (1 run in 3). He approved those four changes (2026-11-23, "sure";
`0fb63174`); none loosens a check. With them, the committed probe: 92 of 92 (134 days from Create to
the tab in 1.9 s; a rule change in the Days rows after 0.11 s, the tab
after 0.66 s; Study on again caught up after 0.18 s). Earlier probes on the
final build: record 72 of 72, progress 87 of 87, usable 59 of 59, unit 74
of 74. Typecheck, the build and 9,805 unit tests pass; the builder reports the
new unit tests failed first (no log kept). Keyboard audit 0 on the Plan tab and the New Plan
sheet, with a seeded plan that has a rest span, a catch-up day, a
holiday, a study phase that does not fit and a day he changed. On the final build: touch drag all ok; visual probe on Study nothing
rose against the baseline, and the Plan tab 0 on every count (it has no
baseline of its own yet). The verifier also drove it
with a script of its own, on the build before the access fixes, its log
not kept, its screenshots looked at (seen on the app): New Plan from the palette, a
Week row's hours typed in the database (Days followed in about 0.1 s,
the tab when next looked at, 0.6 s later), a day typed by hand marked Edited and kept through a rule
change, the exam moved later (days added) and earlier (removed, the
edited day kept), unticking Edited, a relaunch.

*Review.* Modularity: no breach (three core comments used the plan as
their example; made neutral). Correctness: eight findings; the skeptic
reproduced and these were fixed: a Days column deleted or renamed marked
every day with hours Edited for good (`28949522`); a sync stopped between
writing Days and saving Study's record froze every changed day as Edited
(`c96e9306`); nothing redrew at local midnight (`09b9359b`). Left,
reproduced but not met in his use: a day he types in the tens of
milliseconds while Study writes that same cell is overwritten; an edited
day counts the followed plan's Work in Floor and Stretch (New Plan always
gives the three plans the same Work); "Its databases could not be read"
shows only at the next redraw, after 30 s of failures; a deleted Planned,
Running or Done column comes back at his next edit. Refuted: a cleared Date doubling every day; but while one row's Date
is empty, that day has a second row beside the dateless one (one again
once the Date is back). Access: fixed (`8b58248e`, `6b058b87`) every
phase's switch named only "All plans"; Edited explained only in a hover
tooltip; the week heading heading no cells; the audit's seeded plan
having no rest, catch-up, holiday, phase that does not fit, or edited day. Left: a hovered Catch-up word
at 4.2:1 in light; the sheet's dates read back in words are not tied to
their fields. Refuted: the chosen card shown by colour alone (it also
says "· Following"); doubled landmarks. A noted gap, not asked for: the
phase "Start to exam" that Create makes keeps its end when the exam moves.

*Decided for him to overrule.* The dates are typed (YYYY-MM-DD, the date
said in words beside), not picked from the kit's month grid. Weekdays
with the same hours share one Week row ("Personal, Mon to Thu"). Days'
first cell is the date in words; Phase is text, not a relation; Planned,
Running and Done are columns Study keeps (read-only to him). A day with no
hours in the plan he follows is Rest (so Type can change with Following). Only the soonest plan shows in the
sidebar. Following is marked on its card with "· Following". New core
options: a column width for tool-made databases, many rows in one
write, and segmented choices as cards.

*Only his machine can show.* Windows' own time zone (the probe sets the
zone on Linux only); his spring plan entered from his real draft; the
tables' widths at his screen and scaling; the speed of his machine.

**After the student walk-through (2026-11-23).** His words: "Have you
tested the full workflow. Think like a student. How else can you make
life easier for them?" "how student sets everything up, and sets up the
plan, and executes it, tracks it, changes it over time. The xp system.
The gamification." On the list below: "fix all. execute."

*What the walk-through saw* (the real app, a new workspace of six papers,
real mouse and keys, a stand-in model, zone America/Chicago): nothing
says what to study today (today's row reads "2 h", no unit, no Start;
Planner's Today is empty); Flashcards and Worksheets time never reaches
the plan's Done, Study's clock counts an idle tab, today's Done shows
only tomorrow; a missed day only recomputes; a Week change rewrites days
gone by; a moved exam leaves the week off behind; New Subject with a
sources folder and a bank made 12 units for 6 papers and the PDF units
did not hold their PDF; Find Matches found nothing for real file names
(about 50 presses to attach by hand); XP lives only in a Worksheets
campaign with its own exam date and plan; Personal, Work, Floor,
Standard, Stretch and the phase kinds are never explained. *What the code
map saw:* time is counted four ways (Worksheets' idle-aware clock,
Study's visible tab, Flashcards per card, the Dashboard timer) and no
tool can read another's; two streaks; a missed day is never stored; no
shared key for a paper.

*The order he said go on:*
A. Fix what shipped: days gone by never rewritten; a phase that follows
   the exam and "Days off before the exam"; units merged by name and
   holding their file, Remove Unit…; Find Matches proposing names that
   hold a unit's name (reverses the unit hub's exact-only choice);
   today's Done today; Study's clock without idle time; the words
   explained; Enter starts a session.
B. One record of study work for every tool: a contribution point where a
   tool reports minutes and items by unit, one idle-aware clock in the
   core (from Worksheets'), Flashcards, Worksheets, Study, PDF reading
   and chat all counting toward Done. Before Today and XP, which read it.
C. Today, made from his state: the day's hours filled with what is red
   or fading from the phase's units, mixed; one Start per block opening
   its tool set up; tomorrow's questions made overnight; a weekly look
   back that offers ways to absorb what slipped and never re-spreads it
   silently.
D. The plan corrected by his pace: the phase fit uses his measured
   minutes per problem, card and question once the record holds them.
E. XP for learning, across tools, shown in Study: a question turned from
   wrong to right, a card kept, a problem worked, a day at Floor or more;
   rest days never break a streak; a chat skill credits discussions;
   Worksheets' campaign, exam date and XP fold in; Cash Out stays.
Set aside: leaderboards, badges for time, strict daily streaks, nagging
reminders, silent re-spreading, an XP per tool.

**A shipped (2026-11-23).** Fix what shipped, the eight points of the
request, in Study alone (no core code changed). Commits `6f6ec764`,
`3a841f70`, `f2693a31`, `3e89321b`; the acceptance probe
`tests/probes/study-walk-acceptance.mjs` was written before the build
(`8ab15202`) and is unedited.

*What shipped.*
1. Days gone by are never rewritten. A Week row, a Phases row or the
   plan's dates changed: today and the days after follow, a day before
   today keeps its Type, Phase and hours, unmarked; Planned, Running and
   Done still follow, and a day he changes is still his (Edited). A past
   row is never removed. A past day with no row (a plan just made, a
   start moved earlier) is worked out once. The tab says "Changes apply
   from today on."
2. Phases has Follows (Whole plan, Before exam). Create's "Start to exam"
   follows Whole plan. The New Plan sheet asks "Days off before the exam"
   (0 to begin with); more makes the Rest phase "Days off" that follows
   Before exam. Study writes a following phase's Start and End when the
   dates move, and keeps what it left there (`st_plans.follows_json`,
   migration `study_007`) to tell that from his own edit. His edit of
   those dates clears Follows (his ruling). Rules that disagree names a
   dated phase the dates leave outside the plan, and the study days from
   today on that no Study phase holds.
3. New Subject with a sources folder and a bank makes one unit per paper
   when the folder holds the files themselves (a folder of subfolders is
   as before: one unit per subfolder, not merged with the bank, holding
   no file):
   the bank's units in its order, then one per file that belongs to none.
   A file whose name holds a bank unit's name as whole words joins it (in
   Material, its name in Also Called); every unit made from a file holds
   that file. A unit row's More Actions has "Remove Unit…": it asks, the
   row goes to the Trash, questions and files stay, and Study keeps the
   name (`st_subjects.removed_units`, migration `study_008`) so the
   questions do not make the row again. A tab of a unit that is gone says
   so after a restart too.
4. Find Matches… also proposes a page or file whose name holds a unit's
   name or an Also Called name as whole words, any letter case, after the
   exact names, unticked, each row with its unit and why ("name holds
   Mack"). It opens whenever there is something to propose.
5. Done shows on today's row; under six minutes it is said in minutes.
6. A session's seconds count only while its tab is showing and he pressed
   a key, clicked, tapped or scrolled in the app within ten minutes; a
   stretch that ends idle is taken back (`16-clock-model.js`, modelled on
   Worksheets' clock; it differs in not counting mouse movement and in a
   fixed ten minutes).
7. One line each for Personal and Work hours, Floor, Standard, Stretch
   (sheet and tab), Rest, Catch-up, Holiday (the tab's Phases), and that
   the hours less and more fill Week's columns once.
8. Enter in the Study setup sheet does what Start does.

*How it was checked, and what kind of seeing each was.*
- Seen on the real app (hidden, real mouse, keys and finger, zone
  America/Chicago, the cloud's Linux): the walk probe in full, 74 checks,
  72 ok. The 18 of the ground hold; of the 56 of the new behaviour 54
  hold. The earlier Study probes, unedited: record 72 of 72, progress 87
  of 87, usable 59 of 59, unit 74 of 74, plan 92 of 92. The keyboard
  audit on Study's seven seeded screens (its home, Progress, a unit, the
  picker, Find Matches, a plan, the New Plan sheet): 0 in every count,
  contrast in dark and light too; its dialog pass was not run (the walk
  probe's 9.2 and 9.3 drive Remove Unit…'s question by keys and finger).
  The touch drags: all ok. The visual probe, `--only=Study`: nothing rose
  against the baseline (Study's front page has no kit page header, as
  before). Screenshots of each changed surface in dark and light were
  looked at.
- Two existing expectations were changed by the build, both named in
  their commits: `studyPlans.test.ts` (Phases gains the column Follows,
  and "Start to exam" has Follows: Whole plan) and
  `studyUnitModel.test.ts` ("Mack and Clark Compared" is now proposed
  for Mack, the exact-only choice reversed on purpose).
- Seen with a stand-in: his edit of a following phase's dates clearing
  Follows, and a plan made before the piece gaining the column, are unit
  tests on the door kept in memory, not checks of the walk probe. Every
  session in the probes is graded by a
  scripted model (the plumbing, never the grading). Idle time and "two
  days on" were seen on the page's own clock moved by the probe
  (Playwright's), not on a real hour. The finger is Chromium's touch
  events. In the unit tests the door is a stand-in kept in memory.
- Read in code only: Enter starting from a single-line field of the
  material setup sheet (the probe's sheets have none); a file that holds
  two units' names joining the longer one, and a comma in a file's name
  (unit tests, not the app); the minimised or hidden window stopping the
  clock (`document.visibilityState`).
- Assumed: that migrations `study_007` and `study_008` run once on his
  real workspace as they did on the probes' (which restart the app on
  the same workspace four times).
- Unit tests: `studyWalkModel` (37), `studyWalkSubjects` (8), six more
  in `studyPlans`, one in `studyPane`, each run on the code before its
  change. Of the 52 new tests, 47 failed on the code before the piece;
  five of the nine for point 1 passed, as they pin
  what must stay (a plan made, the exam date moved, a day he changes,
  Done, no today given). `npm run typecheck`, `npx vitest run`
  (9857 passed, 18 skipped as before) and `npm run build` pass.
- Run again by the session, not by the builder, after the review's
  fixes (`454169c0`): typecheck, the unit tests (9860 passed), the build,
  all six Study probes with the same counts, the keyboard audit on the
  same seven screens (0 in every count, 0 dialogs checked), the touch
  drags (all ok) and the visual probe `--only=Study` (nothing rose).

*The independent review (`454169c0`).* Three reviewers who did not see
the build returned 18 findings (bugs 7, modularity 1, the UI rules 10);
a skeptic was given 11 of them (the 7, the 1, and the UI review's three
rule breaks). Fixed:
- A day gone by he unticked Edited on: Study ticked it again one run
  later. It now stays as he left it, unticked, and the tab's note says
  unticking is for a day still to come. The same cause could mark a day
  Edited that he never touched (a write that did not land before
  midnight); both have a unit test that fails on the code before.
- A session tab closed while it loads left the idle clock's four
  listeners on the window until a reload, Study off or not. Unit test.
- `studyPlans.test.ts` used the machine's date: eight tests would have
  failed from January 2027. Its date is now held; no expectation changed;
  seen passing with the clock at 2027-02-10.
The skeptic ruled only the third as mattering to him; the first two were
fixed as well because the tab's own words were untrue and "off means
off" is the first principle. Left, for him to overrule (the first two
reproduced by running, the other four read in code):
- Remove Unit… on a subject whose questions are in Study's own Questions
  database (Unit is a relation there): a new row of the same name comes
  back with no questions, so the question's words are untrue there. They
  are true for a bank that names units in words, which is his.
- Floor and Stretch totals drift by a day's difference each midnight when
  a Work row's hours differ by plan (the sheet writes them the same; only
  a hand edit of Week makes it), and after Following is switched, past
  days' Planned and Running are off by the same difference. Edited days
  already did this.
- Remove Unit… removes the row before it records the name: the app
  closed between the two makes the unit again.
- The idle stop is not shown or said anywhere, and no line tells him the
  ten-minute rule. Reading for ten minutes with no key, click or scroll
  loses those minutes (a drag of the scrollbar does count). Not
  confirmed: that a screen reader's reading keys, voice control or eye
  gaze send none of the four events, which would lose that reading time.
- Study gives the kit's text field its accent ring inside its sheets, so
  one field focuses two ways in the app; the ring belongs in the kit
  (no written rule forbids it; the style ratchet passes).
- The new explaining lines use the secondary text colour where the hints
  beside them use muted, and a 2px gap off the space scale.
- Not put to the skeptic, from the UI review: Done mixes "4 min" and
  "1.6" under one header; the plan tab's body is redrawn whole when
  today's Done moves; "Rules that disagree" appears unannounced; the Days
  off hint is not tied to its field; Enter does not start from a Mode or
  Answer choice and Start does not name the key; Remove Unit… asks a
  question where the authoring rules call for an undo toast when a
  removal has a way back, and its words do not say that Restore does not
  bring the unit back or what an open tab of the unit then reads; "This
  unit is no longer in Units." is drawn after a wait, unannounced.

*Two probe checks believed wrong, left as they are: 1.5 and 1.7.* Both
fail only on "a row too many" in the tab, while what they are about holds
(no past row changed, went or was marked; the days from today followed).
Check 1.6 changes the day eight days back by hand, the probe then leaves
that day out of what it compares (its line 2033), and the comparison
counts any day of the tab it was not given as a row too many: his own
edited day, which must be in the table. 1.5 also counts the three new
past days of a start moved earlier, which its header says are not
checked. Proposed: one line (1656), compare the tab's past days only on
the dates it was given. With it, phases 0 and 1 are 24 of 24 on the
final build (`454169c0`). The evidence and the
copy are in the session's scratchpad; he decides.

*Decided for him to overrule.*
- A start date moved later leaves the earlier days' rows in Days. They
  are outside the plan: their Planned, Running and Done no longer move,
  and nothing on the tab says they are there (reproduced in review). A
  start moved past today leaves them too, while the days between go. A past day he unticks Edited on stays as it is, unticked.
- A plan made before this piece is not changed: its "Start to exam" keeps
  its dates until he sets its Follows to Whole plan (the column is added).
- "Study days in no Study phase" is said only when the plan has a Study
  phase, and counts from today on. A dated phase is named only when it is
  wholly outside the dates.
- Whole words are matched in any letter case, accents aside, for New
  Subject as for Find Matches. A file that holds two units' names joins
  the longer. Units are ordered bank first, then files by name.
- Remove Unit… removes the row the door's way: its page is in the Trash,
  but its cells (Material, Also Called, Order) are not kept, so the unit
  comes back by adding a row of its name to Units, not by Restore. A row
  put in the Trash in the table itself is still made again from its
  questions, as before.
- An item can be proposed for more than one unit; exact rows now say
  "name is Mack".
- A day with no work reads "0", today too; six minutes or more read as
  hours ("0.1").
- Moving the mouse alone is not being at the desk (the request names a
  key, a click, a tap, a scroll); a scroll the app makes by itself is not
  his. Ten minutes is not a setting.
- A field of a Study sheet reached by the keys shows the accent ring
  besides the kit's border colour, at once. The walk probe's 9.1 asked
  for a ring on the field itself; the kit's text field shows focus by
  its border colour only, which the keyboard audit accepts.
- Days off is a whole number, fewer than the plan's days. The words of
  the explaining lines (nine in `ST_PLAN_WORDS`, with the Days off
  hint and "Changes apply from today on.").

*Only his machine can show.* Windows' own time zone (the probe sets the
zone on Linux only). A real idle hour on the real clock, the lid closed,
the window minimised or behind another program. A pen or a real touch
screen, and what a screen reader says. Real PDFs with long names from his
folders, and his model's grading. His Exam 7 plan after the two
migrations, and its phases once he sets Follows.

**Still open:** closing the 14 hours between the standard and 500 (a
start on November 30, or 5-hour weekends); whether the week off runs
through Monday April 19; the phase lengths once the guides are sized;
XP. Piece 1 was built on two choices his "execute plan" was taken to
approve: his conceptual database adopted rather than copied, and a work
row per session, not per review. It makes subjects only; campaign as a
second level is not built.

**B built (2026-11-24/25): one record of study work for every tool.**
His words on the order: "fix all. execute." Built by a builder agent in
two commits (`ef741159`, `0957c62b`), then checked by Claude directly
after his word of 2026-11-25 ("Build first, test after"): no reviewer
agents, no skeptic, no claim check were run on it.

- *The core:* one idle-aware clock (`src/services/workClock.ts`), one
  setting for the whole app (`clock.idleMinutes`: 5, 10, 15, 30; 10 to
  begin with; its description is the rule), a work-provider point
  (`src/services/workProviders.ts`, `api.work`), a line that says a
  clock stopped and went on again (`src/ui/clockStatus.ts`), and what
  is showing for any tool (`isShowing` on open editors,
  `api.chat.shownSession`). The core names no tool.
- *Worksheets and Flashcards* count on that clock and report their work
  by day and paper or tag. Worksheets' own clock file and setting are
  gone; Flashcards keeps its time in `fc_work_time`, not the gap
  between showing and grading a card.
- *Study* writes one Work Log row per tool, unit and local day (Kind
  Problems, Cards, Reading, Discussion), which grows with the day; a
  row he changes or adds is his. Reading counts for a PDF of a unit's
  Material while it shows; a chat opened from a unit (Discuss in Chat on
  the unit's tab) counts as Discussion. Study's own clock copy is gone.
  The subject's Progress tab has Time worked by kind, today and this
  week.

*Checked (2026-11-25, on `dev` after the look and Home):* the
acceptance probe `study-work-acceptance.mjs`, unedited: 71 of 79. The
eight that fail (2.4, 5.7 and the six that wait on 5.7) fail on two
errors in the probe, read in its code: 2.4 looks for the class
`ws-sessionbar__dot--cur`, and the app's class is, and was before the
probe, `ws-sessionbar__dot--current`; 5.7 reads every visible list
option in the window as the setting's choices, so the Explorer's Open
Editors row ("Welcome ×") is counted as a fifth choice. With those two
lines corrected in a copy (kept in the session's scratchpad, not in the
repository), phases 2 and 5 are 22 of 22. Correcting the probe is his
call. Also: typecheck, the unit suite (9,910), the keyboard audit on
Study's Home, Progress, unit and plan (0, but for one run in two where
Escape did not close what a Progress bar's part opened; not reproduced
alone).

*Decided, for him to overrule:* mouse movement alone is not being
there (Worksheets counted it before); time Worksheets had already
counted on past days appears as rows of those days; work for a paper or
tag that matches no unit is in no Work Log; the Dashboard timer stays
out.

*Not checked:* a Flashcards deck matched by name (only tags were
driven); a Worksheets paper matched through Also Called; a chat beside
a PDF of the same unit; Windows; his model.

### AI chat: message times, model speed, dates on old chats

**His words (2026-11-12, spelling corrected):** "currently AI chat does
not track the times of messages back and forth, this is annoying. There
also is no way for me to see how fast the model responds (tokens per
second). These are improvements we need to make. Also on old chats
instead of saying how far ago they were, after any day before
yesterday, we really should just use the date." He called it "a needed
update". His go (2026-11-13): "start with AI chat times and speed."

**Shipped 2026-11-13** (in the code and its tests; checked in a hidden
copy of the app, `tests/probes/chat-times-probe.mjs`, 0 problems):

- *Times.* Every message he sends shows its time under it. Today it is
  the time alone ("9:14 PM"); then "Yesterday, 9:14 PM"; then "Nov 11,
  9:14 PM"; another year adds the year. The whole date and time, to the
  second, is on hover. The stamps on screen are rewritten when the day
  turns.
- *Speed, under each answer.* Beside Regenerate and Copy, one small line:
  when the answer was finished, how long it took from the moment he sent
  the message, and tokens a second ("9:14 PM · 20 s · 62.2 tokens/s").
  The line is a button. Opened, it lists where the time went: when the
  first word came, the whole answer, the speed and what it is made of
  (tokens written and the time writing them, reasoning included), the
  prompt the engine read and how long that took, a model that had to be
  loaded first (when that took a second or more), the time spent
  reasoning, the model, and the number of model calls when tools were
  used.
- *Where the numbers come from.* Speed is the engine's own figure: Ollama
  reports, at the end of every call, the tokens it wrote and the time it
  spent writing them, and the answer keeps the sum over its calls. The
  times are the app's clock. An engine that reports no writing time (a
  cloud model, another server) shows the times and no speed; none is
  worked out from the app's clock.
- *Kept.* An answer's timing is saved with it (a new `timing_json` on
  `chat_messages`; a database from before is upgraded in place), so the
  line is there after a restart. Answers from before this was built show
  their time alone: nothing more was ever recorded for them.
- *Dates on old chats.* The chat list says how long ago through yesterday
  ("now", "5m ago", "14h ago", "yesterday") and the date for any chat
  older ("Nov 10", "Nov 13, 2025"). The chat's list only, as he settled.

**Decided by Claude while building, for him to overrule:**

- No line is drawn between messages where the day changes. Each stamp
  carries its own day instead. (This was the entry's one unknown.)
- The time on an answer is when it finished, not when it started.
- "First word" is the first thing the model itself writes, reasoning
  included. The app's own status lines ("Searching the workspace") do not
  count.
- The date format is "Nov 12", with the year when it is not this year
  (he said the format does not matter to him).

**Found on the way, and fixed.** The "Thought for 12s" row above an
answer could be opened by the mouse only. It is a button now: in the Tab
order, Enter or Space opens and closes it, and a screen reader hears
whether it is open. The keyboard audit never met it because no audited
chat had an answer; the audit now has a chat with one
(`seed:chat`, `seed:chat.timing`).

**Owed.** His verdict in the app. One real answer through his own model:
every check so far used a stand-in that replies in Ollama's format (the
field names are from Ollama's API reference), so what his Ollama reports
for his models has not been seen in the line yet.

### Enhance for short videos: bigger resolution

**His words (2026-11-12):** "Let's talk about the idea of enhancing
videos." Asked what enhancing means and for what footage: "short videos,
bigger resolution." Then: "add to master list." Later the same day:
"run video enhancement. you have my full permission to use gpu."

**Built (2026-11-12).** Enhance Video… and Enhance GIF… on one item in
the library, at 2x, on the engine photos use: a dialog with what the
clip becomes and about how long it takes, a three-second preview with
the original beside it, the run with Stop, and a stopped run carried on
from its kept frames. The result is a new file beside the original with
its sound and the original's tags, albums, rating and details. How it
works, what was measured on his card and what the measurements decided
are in `docs/ENHANCE.md` (part 3).

**Measured on his 5090.** Ten seconds of 720p became 2560 x 1440 in 10
minutes 41 seconds; five seconds of 360p became 720p in about a minute
and a half. It needs 21 to 24 GB of the card, so the chat model is set
aside for a run (the dialog offers it). By eye the result is clearly
sharper than the original; by the numbers it is sharper than real
footage of that size, which is the model's known over-sharpening.

**Owed.** A run from the dialog on one of his own clips (every run so
far is on public test footage, and the dialog itself was checked with a
stand-in for the model), and his verdict on the look.

**Left, none agreed.** 4x. Several clips in one go. 1080p to 4K (not
measured; the result's long side stops at 2,560 pixels today). Enhance
from the clip editor. Newer engines (FastVR, FlashVSR+) if they come to
Windows; the research is kept below.

**Research (2026-11-12, at his request: "Research the latest enhancement
techniques and find github repositories doing the same thing, I can't be
the only one").** Read: the field's curated paper list, the READMEs of
the main repositories, one independent benchmark on an RTX 5090. Claims
are the authors' unless marked measured; Claude ran nothing.

- The field: SeedVR2 (June 2025) is no longer the newest but is still the
  quality reference; the copy in the extension (v2.5.24, December 2025)
  is upstream's latest. The 2026 wave is one-step streaming models built
  on video generators (Wan 2.1 and 2.2), with flat memory at any length.
- Newer engines, all Apache-2.0 code: FlashVSR+ (October 2026; claims
  whole-frame 4K in 24 GB; Linux only; input sides divisible by 128),
  FastVR (Alibaba, September 2026; any scale; 1080p in about 12 GB; no
  independent test found; Windows not confirmed), ReCaVSR and RelayVSR
  (September 2026; Linux only, 4x only), SoL-Refiner (NVIDIA; made for
  AI-generated drafts, not camera footage). His machine is Windows.
- Measured by others on a 5090 (ai-upscaler-benchmark, June 2026):
  SeedVR2 7B fp8 at 1080p output, groups of 5 frames, 0.35 frames a
  second at about 25 GB: about 85 minutes per minute of 30 fps footage,
  about 15 minutes for a 10-second clip. Groups of 9 at 1080p reach 31
  GB and at 4K run out of memory. Decoding back to pixels took about 73
  of 85 seconds: the slow part is the decode, not the model. The first
  FlashVSR at 2x: 0.80 frames a second at 31 GB; 4x ran out of memory.
- SeedVR2's model card warns it over-sharpens lightly degraded video,
  which is the case of a clean clip made bigger.
- Projects doing the same: VRGDG SeedVR2 TensorRT Studio (closest: a
  local Windows app on SeedVR2, a faster decode, a short preview first,
  a before/after wipe, resumable chunks; an 8-second clip to 2K in about
  8 minutes on a 5090), SeedVR2-Lite (a desktop app, batch and resume,
  newer compressed weights), TE-Speed-SeedVR2 (a streaming decode and
  automatic chunking; a ComfyUI node, so technique only), LocalSR and
  QualityScaler (older frame-by-frame models, sound and timing kept).

## UI improvements

How the app looks and moves: new surfaces, polish of existing ones, the
feel of browsing. His gate for Voice ("improve the surfaces a bit more,
make the app feel more polished") is met by work in this section.

Shipped 2026-11-10, on his picks from the mock-ups (each is in the code
and its tests; nothing more is queued on them):

- **File explorer tree.** The registry chevron in place of the text
  glyph, the folder icon open or closed, faint indent guides, the same
  chevron on the section headers. File-type icons untouched.
- **Three sidebar icons.** Creations AI a storybook, Browser a window,
  Worksheets the calculator.
- **Tools and Search out of the sidebar.** Tools and Extensions is an
  editor tab from the View menu. Ctrl+F is one Find surface: this
  document first (text, PDF, and now canvas pages, databases and any
  tool's editor), with a switch to Workspace that the Search tool adds
  while it runs; results sit under the field. Ctrl+Shift+F opens it on
  Workspace.
- **Home, first version.** The Parallx icon opens it: search, a chip per
  tool and per tag, recent items as cards or a list. Tools feed it
  through `registerHomeSource` (`api.home.registerSource` for
  extensions). Pages and files feed it today. He judged it short of the
  idea; the redesign is the next entry.

### Parallx's own look: a studio, not an editor

**His words (2026-11-24/25):** "I see this cool ui with animation, not
static these other apps are using and feel like parallx falls way short.
even stuff from claude devs feels premium, my app doesn't. It's hard for
me to put my finger on it." Then: "It's not about tokens bro. its abotu
the aesthetic, and that you cannot learn from the existing app. you need
reference." His reference: Open CoDesign
(github.com/OpenCoworkAI/open-codesign), four screenshots ("it feels
good, unique"). Of three directions offered (A close to the reference,
B Parallx's own, C warm dark first) he chose **B**.

**What the reference is, read from its source.** Its token file opens
"Anthropic Claude Design aesthetic: warm cream surfaces, serif display
type, terracotta accent": a copy of Claude's look, which is also the
first cluster Anthropic's frontend-design skill names as generated. So
its qualities are taken, not its palette: warm-tinted everything,
three faces with one job each (serif display, sans interface, mono
meta), 15 px body, air, colour only with meaning, small motion when
something appears (fade, 8 px rise, 0.98 to 1), a frame that steps back.
Its repository (MIT) also holds 26 written brand references (Linear,
Raycast, Notion, Apple, Stripe...) and design guides, readable from a
cloud session.

**What Parallx is today, measured 2026-11-25** (screenshots from
`tests/probes/visual-consistency-probe.mjs`, the tokens, the CSS):
cool blue-grey surfaces a few percent apart, black shadows, Inter 13 px
for every word, 476 transitions nearly all hover tints, no view
transitions or `.animate()`, a tool in about 600 px of a 1400 px window.
It matches several marks the references name as undesigned: Inter for
everything, near-black with one bright accent, icon tiles above
headings, meta joined with middle dots.

**Mock-ups (2026-11-25):** https://claude.ai/artifact/YBHRWdaBctZmYFiYLtNCWs
(Flashcards review, Study plan, Worksheets home; letters switch live).
Claude's picks, not yet his:
- *1 Paper:* 1A linen and indigo (grey-green paper, indigo ink, Payne's
  grey for dark; viridian right, ochre half right, vermilion wrong,
  ultramarine new or now) or 1B sketchbook and graphite.
- *2 Type:* 2A Literata, Atkinson Hyperlegible Next, JetBrains Mono, or
  2B Newsreader, Hanken Grotesk, IBM Plex Mono.
- *3 Frame:* 3A the tool gets the stage (Explorer, tabs and chat step
  back while a tool is open) or 3B today's frame restyled.
- *4 Motion:* 4A quiet settle, or 4B settle plus one moment per tool
  (the card turns, the week fills, attempts land on the spine).

**His picks (2026-11-25, sent as a screenshot of the page's bar, in
Dark):** **1A 2B 3B 4B.** Linen and indigo with Payne's grey for dark;
Newsreader, Hanken Grotesk and IBM Plex Mono; today's frame kept and
restyled (not the stage layout); settle plus one moment per tool.
Nothing was built at that point (the look, Study's Home, the frame and
the tools' lists have been built since, see below). The foundations
discussed the same days (a typed contract for extensions, a view layer
in the kit, writes that tell views) are what list motion and per-tool
redesigns stand on; they are not on this list until he says.

**The plan (2026-11-25).** His words: "plan it all including study. Then
you execute. Build first, test after. Maximize getting to an output
first. we need to move efficiently and cost effectively, while providing
something good at the end of it all." And on Study as built: "there is
no home page or anything"; "where does the user actually see their study
plan? Where can they edit it and shift it as needed? What if they have
several subjects. How do they see what work to do on what day, what
week, what month"; "if I click the extension and have no idea what to
click then this is badly designed."

So the order is the screen first, then the checks, built directly (no
acceptance probe before, no reviewer agents unless he asks):

1. *The look, in the tokens, for the whole app at once.* A Studio
   palette (linen and indigo by day, Payne's grey by night, the four
   pigments as the signal colours, shadows tinted with the ink), the
   default, with Slate, Warm and Ember kept as choices; a state saved
   before it moves to Studio once. Newsreader, Hanken Grotesk and IBM
   Plex Mono vendored; `--px-font-display` for titles and large numbers;
   reading text on a tool's page at 15 px, chrome at 13. Settle
   (`.px-settle`) and fill (`.px-fill-y`, `.px-fill-x`) in px-motion.
2. *Study's front page.* Study opens on Home, not on a list of subjects:
   Today (the work due across every subject, each line opening its tool
   set up), where he stands (days to each exam, this week done against
   planned, the week filling), and the plan as a calendar he can read by
   week and by month with every subject on it and edit in place (move a
   day's work, take a day off, push what follows), by mouse, keys and
   touch. The sidebar keeps the subjects, under Home and Plan.
3. *The tools in the look, one at a time:* Flashcards review (the card
   turns), Worksheets home (attempts land on the spine), then the
   others as he uses them. Hard-coded greens and reds move to the four
   meanings.
4. *Then the checks:* the unit tests and ratchets put right, the
   keyboard, touch and visual probes on what changed, and piece B's
   remaining work (the record of time across tools, half built on `dev`
   at `0957c62b`, unreviewed; it was finished since, see "B built"
   under Study, and is still unreviewed).

**Built so far (2026-11-25), on `dev`, by one hand, the checks after:**

- *Step 1, the look* (`fd3effac`): the Studio palette as the default in
  `px-tokens.css`, dark and light; the three faces vendored;
  `--px-font-display`, `--px-text-read`, `2xl`, `3xl`; `.px-settle` and
  the fills. A saved appearance moves to Studio once (`look: 2`).
  The kit's page header is in the display face, with `front` for a
  tool's front page (34 px).
- *Step 2, Study's Home* (`84f4b147`, `b834b6ef`):
  `ext/study/src/61-home-view.js`. Study opens on it; the sidebar has
  Home first. Today across subjects (hours, phase, done, ahead or
  behind, the three weakest units), the days to the nearest exam, and
  every subject's plan on one calendar by week or month. A day's work
  is a button: move it a day, push it to the next free day, take the
  day off, set its hours; a drag swaps two days. Each change is written
  to the plan's Days database and is his from then on. Commands:
  `study.openHome`, `study.home.show`, `study.home.day`.
- *Step 3, begun:* Flashcards review (`2d22de4c`): the card is the
  theme's paper in the display face (it was fixed white in both modes),
  the answer turns down, the grades are cards. Worksheets' launcher
  (`8b0297dc`): front header, lifted sheets, no icon tiles.

- *C, its first part, on Home:* each subject's card lists what to work
  on today from what he knows: every unit's items that are wrong, then
  half known, then not worked yet, the kinds (questions, problems,
  cards) taking turns, at most five; each line starts that work in its
  tool (a Study session on those questions, or the tool's own items).
  Each block says about how long it takes at his measured pace for
  its kind, once the Work Log holds one.
- *C, the weekly look back:* on a subject's card, while last week has
  half an hour or more slipped: "Last week: 9 h done of 14 h planned.
  5 h slipped." and three choices, Spread Over This Week (equal parts
  on this week's study days still to come), Put on the Next Free Day (a
  catch-up day), Let It Go. Nothing moves by itself; the week answered
  is kept (`st_plans.lookback_week`, migration `study_010`) and not
  asked again. Command `study.home.absorb`.
- *D, the plan corrected by his pace:* `stPlanPace` reads minutes per
  item from the Work Log (rows holding both Minutes and Items), by kind
  and over all, once it holds five items or more. A study phase with
  Items says beside its fit "At your pace (9 min an item, over 100
  items) it needs 90 h, has 56 h."; a phase with Items and no Minutes
  per Item is worked out from the pace. The pace is over all kinds:
  a phase does not say which kind its items are.
  Not built of C: only the current phase's units (a phase names no
  units), tomorrow's questions made overnight.

- *Atelier and Creations, a pass each* (his word, 2026-11-25: "I would
  give those a pass each before moving forward"). Every page of both
  was screenshotted in dark and light (13 of Atelier's, 9 of
  Creations'); none showed a surface or text off the palette. Changed:
  the page titles they draw themselves take the display face (Atelier's
  Colour Study, Painting Plans, Practice Session, Tag Review and a
  colour sheet's name; Creations' character, story, chapter and table
  titles); the library and Creations' home are front pages (34 px);
  Atelier's photo tiles and Creations' start and cast cards settle in,
  and those cards are lifted sheets without icon tiles. Not changed:
  the layouts of the image editor, clip editor, plan tools, colour
  bench, character studio and story page; the hard-coded colours in
  both tools' code, none of which was seen on screen.

*Checked:* typecheck; the unit suite; every ratchet and compliance
test; the keyboard audit on Study's Home and plan (0, contrast in dark
and light included); the visual probe on Study, Flashcards and
Worksheets (nothing rose). Seen on the real app, hidden, with one
seeded subject: Home in dark and light, Take the Day Off and a drag
written and announced; the Flashcards question, answer and next card.

*Not checked or not done:* several subjects on Home (the seed has one);
Push to the Next Free Day and Set Hours… driven on the app; a finger's
drag on Home (its menu works by touch); Study's own session card, still
the white stock; Worksheets' inner pages and a new Worksheets home with
data (its redesign is its own entry above); the other tools' hard-coded
colours; piece B's remainder.

*Decided, for him to overrule:* Flashcards' card follows the theme (the
mock-up he picked shows it so) where it had been white by an earlier
decision; the session sheet's tab is "New Session" so Home can be the
tab named "Study"; Home is opened by the sidebar's first row and by Open Study, not by
itself when the sidebar shows (opening it by itself broke two older
acceptance checks, study-usable 6.3 and study-unit 10.7, which count
Study's tabs and close one; changing them is his call); a day pushed or moved is marked Edited like any day he
changes, so later rule changes leave it alone.

**The window itself: mock-ups (2026-11-25).** His words: "We can start
with the window itself. Mock up some ideas for each of the places you
listed. Then we go down each grouping." The page:
https://claude.ai/artifact/Szge5KKuNZjW7N2VRXNzjH (letters switch each
window live; drawn in his picked look). Six choices, Claude's picks
marked, none his yet:
- *1 Frame:* 1A the editor is the sheet (rail, sidebar and bars step
  back with no lines; tabs as wide as their names, with icons; the
  title bar says where he is and holds the search field; the menu words
  go behind the mark), 1B one desk (sidebar, editor and chat as three
  sheets with gaps, tabs as pills, no status bar), or 1C today's frame
  restyled only.
- *2 Sidebar:* 2A files only in 28 px rows, Open Editors gone and a
  "5 open" list on the tab strip, or 2B open tabs first with a live
  word each (page 214, 24 due), then files.
- *3 Palette and menus:* 3A a centred palette with grouped results and
  menus with icons and shortcuts, or 3B a slim palette dropping from
  the search field.
- *4 Notifications and dialogs:* 4A lifted sheets with one pigment dot
  and at most one action, or 4B a quiet tray in the status bar and
  dialogs sliding from under the tab strip.
- *5 Settings:* 5A a tab like any tool, or 5B the dialog restyled.
- *6 Welcome and Home:* 6A one page that opens with the workspace,
  "pick up where you left off", fed by the tools that are on through
  the Home source point, or 6B a plain Welcome and Home designed later.
**His picks (2026-11-25, a screenshot of the page's bar, in Dark):
2B 3A 4A 5B 6A.** Open tabs first with a live word each, then files; a
centred, grouped palette and menus with icons; notices and dialogs as
lifted sheets with one pigment dot; Settings stays a dialog, restyled;
Welcome and Home become one page that opens with the workspace. On the
frame: "I have made my picks, except for 1. The frame. I did not like
the given options." A second round for the frame is on the same page,
changing how he finds his way, not the surfaces: 1D a rail that names
its tools, 1E one column (the tools by name, then the open tool's own
list), 1F a dock at the foot, 1C today's frame restyled. On 1E
(2026-11-25): "1E seems interesting to me. Feels sleeker, but I am
unsure. Can we do more variations of 1E." A third round, on the same
page, is six ways to do the one column: 1E1 tools on top and the tool's
list under, 1E2 a switcher at the head (1E3 shows it open), 1E4 a strip
of icons then the tool by name, 1E5 the open tool unfolding in the
list, 1E6 the tool's list on top and the tools at the foot. Claude's
pick was 1E2.
**His pick for the frame (2026-11-25): 1E6**, with notes: "I like 1E6,
but did not see the settings icon. Also your mock-ups did not show the
buttons in the top ribbon to show or hide panels/sidebars. And also,
where do notifications go? Also, the command thing, I want it kept as
is for now. It does not need to be in the middle. Maybe we make a
setting eventually that allows the user to choose if they want it
expanded and centered or kept as is." So: one column, the open tool
named at its head with its own list first, the tools by name at the
foot, then Tools and Extensions and Settings; the title bar keeps the
menu words and, at the right, the search button, the three panel
buttons (sidebar, bottom panel, chat) and the bell; a notice arrives as
a sheet at the bottom right of the editor (4A) and the bell counts and
lists them; the command palette stays as it is (this replaces his 3A
for the palette; the centred one may come later as a setting). Open:
whether menus get 3A's icons and shortcuts. Redrawn on the same page
for his yes. **His yes (2026-11-25): "okay, I am aligned now."** The
window group is settled: 1E6 as redrawn, 2B, the palette as it is, 4A,
5B, 6A. Decided by Claude where he did not say, for him to overrule:
menus get the icons and shortcuts of his 3A pick (he kept only "the
command thing" as it is); with the icon rail gone, 2B's "open tabs
first, then files" is the Files tool's own list in the column. Nothing
of this group was built at that point (the frame, 1E6, has been built
since and then restacked, see "The frame as built" and "The column
restacked"; the rest of the group has not).
Claude's first picks were 1A 2A 3A 4A 5A 6A. They rest on what the app measures
today (equal-width tabs, six before the strip scrolls; 22 px Open
Editors rows; Settings as a dialog over what it changes) and on
judgment; no other product was read for the page (the session's network
is limited to the app's build). The groups after this one, in his
order: core tools, built-in tools, extensions.

**The core tools: mock-ups (2026-11-25).** The second group, after his
"okay, I am aligned now" on the window. The page:
https://claude.ai/artifact/4z5oKg22MsdMJafYViGJ8i (every window in the
settled frame, 1E6). Six choices, Claude's picks marked, none his yet:
- *1 Chat:* 1A a reading column (his message a small bubble, the answer
  plain reading text with numbered source marks, one mono line for
  thought, source and speed, the question box one lifted sheet) or 1B a
  transcript (no bubbles, mono labels, hairlines).
- *2 Canvas pages:* 2A the reading face for title and body at 17 px in
  a column of about 66 characters, or 2B a display title with the
  interface face for the body.
- *3 Canvas databases:* 3A a quiet table (34 px rows, lines between
  rows only, a choice as a chip in the pigment that means it) or 3B a
  ledger (a full grid, 28 px rows, plain text).
- *4 PDF viewer:* 4A the page lifted on a darker ground with its
  controls in one floating pill at the foot, or 4B the toolbar on top,
  restyled. The page keeps its own colours in both.
- *5 Markdown and code files:* 5A a .md file opens as a page with Edit
  Source, 5B source and page side by side, or 5C source only as now.
- *6 Tools and Extensions:* 6A a shelf of cards or 6B the list grouped
  On and Off with each tool's own icon and its switch.
Claude's picks: 1A 2A 3A 4A 5A 6B. Find is not in it: its one-surface
shape is his from 2026-11-10 and only takes the new colours and type.
The picks rest on screenshots of the app taken for the page and on
judgment; no other product was read.

**His answers (2026-11-25):** 1A; 4A; 6B ("aligned with this one"); 5
"a combination of A and B, A is default, B is when user hits edit. The
idea here is that if I am editing, I want to see what the rendered
version looks like as I edit. You could do something like the Obsidian
style too, but I do not know if that is harder." On 2: "I am not sure
what the point is. Is the issue with the page title? Canvas has its own
styling settings right? Like a page has its own styling settings for
font, could we use that instead?" On 3: "Not sure what the point here
is as well. Yes, I like a redesign for the overall look, but does the
table require a redesign?"
He is right on 2, and Claude's drawing missed it: a page already has
its own font (the font registry, eleven built-in faces and custom ones,
chosen from the page's menu), Full Width and Small Text. 2A and 2B are
withdrawn. What is left to propose for pages, not yet agreed: the
page's Default font is pinned to Inter in `fontRegistry.ts`, so pages
did not follow the look; make Default follow the app's interface face
and add Newsreader to the page's font list. 3 is withdrawn: the table
takes the palette and nothing else.
**Settled (2026-11-25):** on the two page-font changes, "I am aligned
with this"; on 3, "No need for taller rows, but don't tags already
automatically get colors, you can verify this" (verified: a new option
of a select or tags column takes the next of nine colours,
`NEW_OPTION_COLORS` in `database/bulkRows.ts`, and is drawn as a pill
by `cellRender.ts`; nothing to do); on 5, "Aligned": a .md file opens
as a page, and Edit shows the source beside the live page; the
Obsidian style is looked at afterwards. The core tools group: chat 1A,
pages' Default font follows the app and Newsreader joins the page font
list, databases unchanged, PDF 4A, Markdown as above, Tools and
Extensions 6B. Nothing of it is built.

**The built-in tools: looked at, no mock-ups drawn (2026-11-25).**
Planner (Today, Tasks, Calendar), Agents (Now, Routines, History, Mind,
in the side panel) and the Dashboard were screenshotted in the look
before drawing anything, after two of the core tools' drawings turned
out to redesign what needed none. Found: Planner and Agents were each
designed on purpose (Planner's calendar from its own research in May)
and sit well in the look; the Dashboard's reimagining is its own entry
below and waits on him ("for now, we focus on home"); Worksheets'
redesign is its own entry above, with its mock-ups drawn 2026-11-15.
Proposed to him: no redesign for this group; the Dashboard's large
numbers take the display face, and nothing else.
His answer (2026-11-25): "I still want you to do planner. Do a view of
what you are proposing vs what's there." The page, to be published
with this entry, shows Today, Tasks and Calendar each as a screenshot
of the app as it is (two seeded events, two captured tasks) beside a
drawing of the proposal in the settled frame. The proposal: the view
switch (shown twice today, in Planner's sidebar and as tabs across the
page), the small month and the calendars list live in Planner's column;
Today gets the front-page title, the captured tasks as plain rows
beside the schedule, events as chips in their calendar's colour; Tasks'
six lists hang under Tasks in the column and the page is one list;
Calendar's days are small sheets with today ringed in ink, as on
Study's Home. No behaviour changes (capture, the Review Queue's day
buttons, drag to create and move, the shortcuts). Not looked at: the
week and day views, a crowded day, the popovers. The page:
https://claude.ai/artifact/BjoGr6AY17wjp7iWF5fFSG . **His answer
(2026-11-25): "I am aligned with all proposals."** Planner's three
views are settled as proposed. Nothing of it is built.

**The extensions: what is there beside what is proposed (2026-11-25).**
The same form as Planner's page, to be published with this entry. Every
extension's main screen was screenshotted first (Budget, Workspace
Graph, Concept Lab, Flashcards' Decks, Stats and Create, Study's
Progress, a unit and a plan). Three views have a proposal:
- *Flashcards, Decks:* the page opens on how many cards are due and
  about how long, with one Study button; each deck a row with its counts
  in words and one thin bar of new, learning and review; the five
  making-and-importing buttons fold into one Add menu; Stats, Make
  Cards and Import sit in Flashcards' column with the decks under them.
- *Flashcards, Stats:* four large numbers with their unit in words
  (reviews today, time today, days in a row, share right), then two bar
  charts (reviews done, cards coming due); Cards by stage leaves the
  page.
- *Study, a plan's tab:* the page for the plan's rules, since Home
  shows and moves the days: the days left as the one large number, the
  three plans as cards, the phases as one strip to the exam, hours a
  day, the three rule buttons; the table of every day leaves the tab
  (Open Days and Home's calendar have it).
Nothing proposed for: Study's Progress and unit tab, Concept Lab,
Workspace Graph (they take the look as they are); Budget (seen only
empty; its own redesign document is from October); Atelier and
Creations (their pass was 2026-11-25). Not looked at: the Browser, and
Flashcards' Import, Browse and Custom Study. The page:
https://claude.ai/artifact/RyEQXyrzBzPunoKHoUaJwV . **His answer
(2026-11-25): "Aligned with all proposed."** The three are settled.

**Everything settled across the four groups, in the order to build it
(pieces 1 and 2 are built; the rest is not; each line is one piece, one
to a session):**
1. *The frame, 1E6.* **Built 2026-11-25, see "The frame as built"
   under this list.** One column in place of the icon rail and the
   sidebar: the open tool named at its head with its own list, the
   tools by name at the foot, then Tools and Extensions and Settings.
   The title bar keeps the menu words, the search button, the three
   panel buttons and the bell. Tabs as wide as their names, with the
   tool's icon. Everything below sits inside it, so it is first.
2. *Each tool's list in the column.* **Built 2026-11-26, see "The
   lists as built" under this list.** Files (open tabs first with a
   live word each, then files: his 2B, which needs a small
   contribution point for the word), Planner (Today, Calendar, Tasks
   with its six lists, the small month, the calendars), Flashcards
   (Decks, Stats, Make Cards, Import, the decks), Study (Home, the
   subjects and units, the plan, Progress).
3. *The window's floating parts:* menus with icons and shortcuts;
   notices as lifted sheets with one pigment dot and one action, and
   the bell's list restyled (4A); the Settings dialog restyled (5B).
   The command palette stays as it is.
4. *Home and Welcome as one page* that opens with the workspace (6A),
   fed through the Home source point by the tools that are on.
5. *Chat (1A):* the answer as reading text with numbered source marks,
   one mono line for thought, source and speed, the question box as
   one sheet.
6. *Pages and files:* a page's Default font follows the app's face and
   Newsreader joins the page font list; a .md file opens as a page,
   and Edit shows the source beside the live page (the Obsidian style
   looked at afterwards).
7. *The PDF viewer (4A):* the page lifted on a darker ground, its
   controls in one pill at the foot. **Built 2026-11-26, item 14 under
   "Done from this order".**
8. *Tools and Extensions (6B):* the list grouped On and Off, each tool
   with its own icon and its switch. **Built 2026-11-26, see item 6
   under "Done from this order".**
9. *Planner's three pages* as proposed (no behaviour changes).
10. *Flashcards' Decks and Stats* as proposed.
11. *Study's plan tab* as the page for the plan's rules.
The Dashboard's large numbers take the display face with whichever of
these touches it. Still open with him, unrelated to the look: his
approval for three acceptance-probe corrections (study-work 2.4 and
5.7; study-walk 1.5 and 1.7; study-usable 6.3 and study-unit 10.7 if
Home is to open with Study's icon), and piece E. A fourth, from the
frame: study-record's `point()` (see "The frame as built").

**The frame as built (2026-11-25, piece 1, on `dev`).** His words for
the session: "Build first, test after. Get to something I can see
quickly. Build it yourself." Built by one hand, the checks after; no
acceptance probe before it and no reviewer agents.

- *The column.* The icon rail is gone from the window's left edge. The
  tools list (still `ActivityBarPart`, with the names its tests and
  probes find: `button.activity-bar-item[data-icon-id]`,
  `data-px-id="activitybar.<id>"`) sits at the foot of the sidebar part
  (`SidebarPart.footSlot`), one 28 px row a tool with its icon and its
  name, the open one in ink. The head names the open tool in the
  display face (44 px, `.sidebar-header-label`), with More Actions
  beside it. Each tool's existing sidebar contents sit between the two,
  unchanged: piece 2 replaces them. The foot never takes more than 55%
  of the column and scrolls inside itself past that. Default width 224.
- *The last rows.* Tools and Extensions (`tools.showInstalled`) and
  Settings (`settings.open`) under the tools, as kit buttons
  (`column.toolsAndExtensions`, `column.settings`).
- *Nothing names a tool.* The rows are the view containers the tools
  that are on contributed; a tool turned off loses its row at once
  (checked on the app). Order, Hide (right-click), drag to reorder and
  badges are the rail's, carried over.
- *Keys and touch.* One Tab stop for the tools (arrows, Home and End
  walk them, Enter or Space opens one, Ctrl+Shift+Up and Down move
  one), then Tools and Extensions, then Settings. The arrows now skip
  rows the user hid. Every row has its name and a focus ring; a finger
  gets 36 px rows.
- *Pressing the open tool again* leaves the column open (on the rail it
  hid the sidebar; in the column it would hide the tools too). The
  title bar's button and Ctrl+B hide and show the whole column.
- *The title bar.* Unchanged but for the bell, which moved from the
  rail's foot to the right of the three area buttons, keeping its id
  (`activitybar.notifications`); its list opens under it.
- *Tabs.* As wide as their names (76 to 240 px), the name at the left,
  the icon before it. A tab shows its editor's own icon, else its file
  type's, else the icon of the tool that opened it
  (`src/editor/toolTabIcons.ts`, fed by the view contributions); an
  editor that named a registry icon when it opened (Tools and
  Extensions did, and no tab showed it) now shows that. Welcome names
  `home`.
- *The command palette* is untouched.
- *Files:* `src/workbench/frame.css` (all of the frame's CSS),
  `src/parts/sidebarPart.ts`, `src/parts/activityBarPart.ts`,
  `src/workbench/layout.ts`, `src/workbench/menuBuilder.ts`,
  `tests/probes/frame-probe.mjs` (25 checks on the real app, and the
  screenshots).

*Left as it was, for him to say:* the right-hand ribbon (the icons for
chat and the other right-side containers) is still an icon strip; the
mock-up drew none. The rows carry each container's own title, so the
pages tool reads "Canvas" and the files tool "Explorer" where the
mock-up wrote "Pages" and "Files"; renaming them is the tools' own.
The status bar is untouched.

*Checked (2026-11-25, in the cloud, on the built app run hidden):*
typecheck; the unit suite (9,924 pass, every ratchet and compliance
test, no baseline changed); `frame-probe.mjs` (25 of 25); the visual
probe on every screen; the keyboard audit on all 118 screens (keys,
names, focus rings, contrast in dark), its dialogs, and the touch and
popup passes on the first screen and its 57 sub-screens; all eight
acceptance probes. The frame's own controls came back with nothing.
What the checks found was compared with the app as it was before the
frame (`01d15be9`, built beside it) and was there already:
- the terminal's input has no focus ring (seen on every screen once
  the bottom panel is open);
- the command palette's rows are not Tab stops (5 counted);
- Atelier's New Tags dialog lets Tab leave it and Escape does not
  close it;
- the visual probe's "window frame: small targets" stands at 16
  against a baseline of 11 (17 before the frame): Open Editors' 22 px
  rows, which piece 2 replaces. "Creations: title size 0 to 1" is its
  front page title from the look pass.
None of these is fixed here (his word for the session: only this
piece).

*Not checked:* the keyboard audit's light-mode contrast pass and its
touch and popup passes beyond the first screen (the full audit takes
more than the 50 minutes it was given and was cut off there; the frame
was seen in light in the screenshots); `touch-drag-probe.mjs`; a
finger's drag to reorder the rows (the rows use the browser's own drag,
as the rail did); a column with more tools than fit (the foot's scroll
is written, not driven); the rest of the e2e specs (of the three files
that find these parts, 8 tests fail the same way before and after the
frame, on parts older work moved; the one test about pressing a tool
was rewritten for the column and passes).

*Changed tests, none an acceptance probe:* `workbenchLayout.test.ts`
(the grid has the whole window width, where it had the width less the
48 px rail); `06-views-shortcuts.spec.ts` (pressing the open tool
leaves the column open).

*For his approval, an acceptance-probe correction the frame makes
necessary (not made):* `study-record-acceptance.mjs`, its `point()`
helper (lines 356 to 360). It scrolls a table cell into view only when
the cell is past the window's edge. With the rail gone the questions
table sits about 20 px further left, so the Times Attempted cell is
inside the window but still cut off by the table, and the click lands
outside it: checks 6.2 to 6.7, 9.2 and 9.4 fail (72 of 72 before the
frame). With `point()` also scrolling when the cell is cut off by its
own scroller, a copy of the probe passed 72 of 72 on the frame; the
copy was deleted and the probe is as it was. The other seven
acceptance probes read as before the frame: the two with corrections
already waiting on him (study-walk 1.5 and 1.7; study-work 2.4 and
5.7, with the checks that follow 5.7) and five that pass.

**The lists as built (2026-11-26, piece 2, on `dev`).** His word after
piece 1: "Continue", so it was built in the same session as the frame
(the house rule is one piece to a session; he can say if that was
wrong). Built by one hand, the checks after.

- *The live word, a new contribution point.* `api.editors.setEditorStatus(editor, word)`
  for a tool's own editors (by the id its pane was given, or by the
  type and instance it opened with), and `EditorInput.setStatus` for
  the app's own. Up to 24 characters that say where an open editor
  stands; `openEditors[].status` carries it. The PDF viewer sets its
  page past the first ("p. 214"); Flashcards sets "24 due" on its tab
  while its list is shown. No other tool sets one yet.
- *Files.* The Explorer's list is Open first, then the files (his 2B;
  it turns round the older order, and the unit test that pinned files
  first now pins Open first). An Open row is 26 px: icon, name, the
  editor's live word in the mono face, an ochre dot while unsaved; the
  close mark takes their place while the row is pointed at, focused or
  touched. The Open section is as tall as its rows, up to two fifths
  of the list (`views/fitSection.ts`: any view can mark its element
  `data-section-fit`), and the tree has the rest; a section sized by
  hand with the sash keeps the size given. The tree is unchanged.
- *Planner.* Today, Calendar, Tasks; under Tasks its six lists
  (Review Queue, Today, This Week, Overdue, All Tasks, Completed),
  each with its live count, each opening Tasks on that list; a small
  month (today ringed; arrows, Page Up and Down, Enter) whose day
  opens the calendar on it; the calendars; Settings. The rows are kit
  buttons that run a new command, `planner.show` (a page, a list, a
  day), so the row lit follows the page whoever asked. The six lists
  have one definition (`plannerTaskFilters.ts`) read by the page and
  the column. The month grid of the kit's date field is now one
  function, and `createSmallMonth` (`ui/dateTimeField.ts`) is the
  second thing built on it.
- *Flashcards.* The strip of five tabs at the head of its sidebar is a
  list of named rows with icons: Decks, Study, Stats, Make Cards,
  Import (Up and Down walk them), with Today and the decks under them.
  "Create" is called Make Cards, on the row and as the page's name.
- *Study.* Its list had Home, the subjects, each one's plan and its
  units. Added: a Progress row under each subject's plan.
- *Files:* `src/built-in/explorer/openEditorsView.ts`,
  `src/views/fitSection.ts`, `src/built-in/planner/plannerSidebar.ts`,
  `plannerTaskFilters.ts`, `plannerColumn.css`, `src/ui/dateTimeField.ts`,
  `ext/flashcards/main.js`, `ext/study/src/50-sidebar.js`,
  `tests/probes/column-lists-probe.mjs`.

*Decided, for him to overrule:* Flashcards keeps a Study row (the
settled list has four rows, but until its Decks page opens on what is
due, piece 10, the row is the way to a session beside Today's button);
Planner's page still has its own Today, Tasks, Calendar tabs, its own
month beside Today and its own list of filters on Tasks, so those are
on screen twice until piece 9 takes them off the page; the files
section is titled by the workspace's name, as before, not "Files";
the Open section has no count beside its name.

*Not built of piece 2:* a live word from the other tools (Study,
Worksheets, pages); the count "Open 5" the mock-up drew.

*Checked (2026-11-26, in the cloud, on the built app run hidden):*
typecheck; the unit suite (9,930 pass, every ratchet, no baseline
changed); `column-lists-probe.mjs` (30 of 30: each list used with the
mouse and the keys) and `frame-probe.mjs` again (25 of 25); the visual
probe on every screen (the frame's small targets fell from 16 to 3,
under the baseline of 11, the Open rows being 26 px; nothing rose but
"Creations: title size", there before); the keyboard audit on Files,
Planner and its three pages, Flashcards and Study (keys, names, focus
rings, contrast, touch, popups: 0 from these lists), and its light-mode
contrast pass on 73 screens, which piece 1 had not reached (0 from the
frame or the lists); all eight acceptance probes (as after piece 1:
five pass, study-walk and study-work fail what waits on him,
study-record fails the eight that wait on its `point()`).
Found by the audit in Atelier, in files neither piece touched, and
left: its New Tags dialog (as under piece 1), and in light the names
under the pictures of its grid at 1.26 to 1 (`.mo-feed-cap-title`).

*Caught by an acceptance probe and put right:* the Open row's close
mark was drawn as an icon, so a row's text became the bare name and
study-record's "choose Big Bank" pressed the row in place of the
dropdown's entry (10.1 to 10.3). The mark is the "×" character again,
hidden from screen readers, and the probe passes those as before.

*Not checked:* Flashcards' "24 due" on its tab and the PDF's page word
on the app (the seed has no deck with cards due and no PDF of more
than one page; the word itself was shown by setting one, and the unit
tests cover the row); a finger on the small month (it is the date
field's grid, whose days are buttons); `touch-drag-probe.mjs`; a Files
list with two editor groups; Planner's column with many calendars.

*Changed tests, none an acceptance probe:* `containerRails.test.ts`
(Open above the files, where it pinned the files above);
`plannerNavState.test.ts` (a pending request carries its day);
`flashcards.test.ts` and `flashcardsBehavior.test.ts` (the rows'
order and Make Cards). New: `fitSection.test.ts`, and a case in
`openEditorsView.test.ts` for the live word and the dot.

**The column restacked: his notes on the frame as built, and mock-ups
(2026-11-26).** His words, spelling corrected: "I have an issue with
the stacking of the primary sidebar. I think the tools down to settings
should show first. We also should add a home row that shows up above
all of these things. This home row essentially shows the same page that
gets shown when you hit the Parallx logo." "Underneath the first
section, I think we need to move open editors out of explorer, so they
become a permanent fixture in primary sidebar. They really are an easy
navigational point, and they show all open editors and should not be
limited to just the explorer view." "The name of the extension you are
on, and the sidebar view for that, is then what gets set. I would make
the name smaller than it is now, because the current size looks out of
place and makes it seem like that is the name of the app." "I could
also see a world where tools and extensions, and settings stay fixed
at the bottom. Mock it up for me and we can iterate."
The page: https://claude.ai/artifact/5CUGBe5wsdRH9eLdFa1DfR (one
window that redraws for the letters pressed). Three choices, Claude's
picks marked, none his yet:
- *1 Stacking:* 1A everything in one run (Home, tools, Tools and
  Extensions, Settings, then Open, then the tool's name and list), 1B
  the same with Tools and Extensions and Settings pinned at the foot,
  or 1C 1B with the tools foldable to one strip of icons.
- *2 The tool's name:* 2A a section label like "Open", 2B the display
  face at 16 px, or 2C no name (the lit tool row says it).
- *3 What Home does:* 3A it opens the Home tab and the column stays as
  it was, or 3B Home lights as a place and the tool list steps away.
Claude's picks: 1B 2A 3A. Drawn the same in every option: Open leaves
the Explorer and is one fixture for every tool, as tall as its tabs up
to six rows, folding by its label, with its count. They rest on his
notes, the built app's measured heights (the column is 848 px in a
900 px window; Home and eight tools take 252) and judgment; no other
product was read.
**His picks (2026-11-26, a screenshot of the page's bar): 1B 2A 3A**,
"Let's try this, I will check."

**The column restacked, as built (2026-11-26, on `dev`).** Top to
bottom: a grip, Home, the tools that are on, Open, the open tool's
name as a small label with More Actions, its list, and pinned at the
foot Tools and Extensions and Settings.
- *Home* (`column.home`) runs `home.open`, as the mark in the title bar
  does, and leaves the lit tool and its list as they were (3A).
- *Open* is the column's own (`workbench/columnChrome.ts`;
  `openEditorsView.ts` moved from the Explorer to `src/workbench/`).
  Every open editor, whatever tool is showing; six rows at most, then
  it scrolls, keeping the tab in front in view; its label folds it
  (`workbench.action.toggleOpenEditors`, View: Fold Open Editors, kept
  with the workspace) and carries the count. Its rows are a vertical
  tab list (`role="tab"`), as the strip over the editor is. The
  Explorer's list is the file tree alone, and the fitted section made
  for it in piece 2 (`views/fitSection.ts`) is removed with its one
  user.
- *The tool's name* is 12 px in the interface face, like "Open" (2A).
- *The grip.* His report the same day: "the primary sidebar cannot be
  moved." The move still worked, but only by the name strip, which the
  restack had put in the middle of the column; the top had nothing to
  hold. A 10 px grip at the column's top edge now moves it too (a short
  bar shows while the column is pointed at, focused in or touched), and
  answers a right-click with the placement menu. `frame-probe.mjs`
  drags the column by it to the right edge and back.
- `tests/unit/raw-dom-baseline.json`: the entry for
  `openEditorsView.ts` follows the file to its new path, its count
  (12) unchanged. No other baseline changed.
- Checks changed because what they checked is gone, none to get a
  pass: `containerRails.test.ts` pinned the order of the Explorer's
  two views with two assertions; the Explorer has one view now, and
  one assertion says exactly that. `column-lists-probe.mjs` (written
  in piece 2, not an acceptance probe) lost its checks that the
  Explorer's Open section is named, fitted to its rows and over the
  tree; in their place it checks Open in the column, the same rows
  under three tools' lists, and that the Explorer is the tree alone,
  and `frame-probe.mjs` holds Open to six rows.

*Checked:* typecheck; the unit suite (9,925); `frame-probe.mjs` and
`column-lists-probe.mjs` rewritten for the new order, both with no
problem on the app; the eight acceptance probes. *Not run since the
restack:* the keyboard audit, the visual probe, the touch-drag probe,
the e2e specs.

*What the acceptance probes say after the restack.* Five pass.
study-work reads as before (run alone; beside another probe its clock
checks fail, which is the machine, not the app). study-progress first
failed five checks because it presses a quick-pick entry found by
`[role="option"]` anywhere in the window and the Open rows, now always
on screen, were options too; as tabs they are not, and it passes.
Two have new failures that are the shorter tool list (about 300 px,
where it had the whole column) and are for him to rule on, with the
`point()` correction already waiting:
- study-record 7.3 to 7.5: the session's row in Study's list is below
  the fold; the probe does not scroll the list and falls back to Quick
  Open, which does not find it. (Seen in its screenshot.)
- study-walk 0.9 and 9.3: a finger on a unit row's More Actions opens
  no menu. Not looked into further; likely the same.
The cost is real for a person too: Study's list (subjects with a bar
a unit, Materials, Review, Question banks, sessions) is a long list in
a short box.

**His next proposal: every part of the column its own movable box
(2026-11-26).** His words, spelling corrected: "We should view each
component of the sidebar separately." "We will do it in phases so it
is simple to lay out the logic. First, you have this first box, [the
one that] lists the extensions that are present or enabled in the
workspace. A user should be able to hover at the top of the box, click
and drag to move the whole box of all extensions. Second, within the
box, if a user hovers on an extension and moves it within the box,
this should reorder the list. Third, if a user hovers, clicks and
drags an extension outside of that individual box, this should
actually move it. Hypothetically, a user could allow sidebar views for
two separate extensions to be shown at the same time, if they drag out
of the box. The second phase is the open editors phase. This one we
don't care about within the box, we just care about the box itself.
This means that a user can click and drag it somewhere else. Then you
have the view of whatever extension is selected in the extensions box.
Then at the bottom you have settings and tools and extensions. Another
box that can be moved around. What this means is that it will make our
frame highly modular and customizable, so that I do not have to keep
asking you to mock up a new view."
What the app has already, read from the code (not driven on the app
since the restack): the layout is one grid of movable views
(`layout.ts`, `partDrag.ts`), and anything can be added to it as a
floating view; a tool's row already reorders by drag and by
Ctrl+Shift+Up and Down; a tool's row dragged out of the list already
carries its container, and dropped in the grid it becomes a box of its
own beside whatever is there (`containerBox.ts`), which is "two tools'
views at once". What is missing is only that the tools list, Open and
the two foot rows are slots of the sidebar part and not views of the
grid. A proposed order, not agreed: (1) the tools list as its own grid
view with a grip, the default layout stacking it over the others, and
his three drags checked on the app; (2) Open the same; (3) the foot
rows the same, and the sidebar part left holding only the open tool's
name and list; each saved and restored with the workspace's layout,
each put back by Reset Layout. To settle with him first: what the
title bar's left button hides once the boxes can be apart; whether a
box can be closed and where it comes back from; how a box is moved by
keys and by touch (the parts have a placement menu today).

**His answers, and the first step built (2026-11-26).** His words,
spelling corrected. On what the left button hides: "it hides that
whole panel. Like it currently does. The idea is not to get rid of the
idea of a primary sidebar, it's to modularize what's in it; whatever
sits within the primary sidebar is what gets hidden or unhidden." On
closing a box: "No it can't be closed. In the current system it can't,
so we shouldn't invent logic for it." On moving: "touch is easy, touch,
hold, move, place. Same logic as any other move we have." "You could
have each box have these three dots, but only have them appear when
someone hovers over that section, then that can be used like we
already have items that have options to be moved to certain places."
"We can always restore things to their original place or default
place." "Make sure you are understanding the overall objective so you
don't overcomplicate. The idea is to have modularity." And a fault he
found the same hour: dragging a tool within the list, "there are two
systems clashing" (the layout's dock zone lit over the list).
So the primary sidebar stays one part, hidden and shown as one; what
changed is that its sections can be put in another order inside it.
Built:
- *The clash.* A tool dragged over a tools list is that list's
  business; the layout's drop zones step aside there (`partDrag.ts`).
  Driven on the app: a row dragged within the list reorders it with no
  zone shown, and a row dragged out to the editor's side becomes its
  own box beside the editor, with the first tool's list still showing
  (his "two tools at once"; this was already in the app).
- *Sections that move.* The tools, Open and the two foot rows each
  show, while pointed at, focused in or touched, a grip and three dots
  at their top right. The grip is dragged to another place in the
  column (a line shows where it would land). The dots open Move Up,
  Move Down and Restore Default Places, which is how the keys do it.
  The open tool's list keeps its own header and moves as the others
  move round it. The order is the sidebar part's
  (`SidebarPart.sectionOrder`), kept with the workspace's layout, and
  View: Restore Sidebar Sections puts all four back. Nothing can be
  closed.
- `frame-probe.mjs` drives all of it on the app (46 checks, no
  problem): the reorder with no clash, a section dragged by its grip,
  the menu by keys, the restore, the column moved by its top.
**His reply, and what changed (2026-11-26).** His words, spelling
corrected: "why is that not built yet? also, why do we need two
different ways of dragging? Like why do we have a handle, why can't we
just drag the window physically from the top like we had before? It is
more intuitive and less clunky than adding a new icon that shows on
hover."
- *One way to drag.* The hover grip icon is gone, and so is the thin
  grip that had been put at the sidebar's top. A section (the tools,
  Open, the two foot rows) is taken hold of itself: by its own top, or
  anywhere in it that is not itself something dragged (a tool's row
  still reorders in its list). The open tool's name strip moves the
  whole sidebar with everything in it, as it did before the frame.
- *Out of the sidebar.* A section dropped outside the sidebar becomes
  a box of its own there, through the pipeline a tool's box already
  uses (`containerBox.ts`, under `section:<name>`;
  `workbench/columnSections.ts`). Its box has the box's usual header
  and menu, with Return To Sidebar; dropped back on the sidebar it
  returns to its place in the order. Hiding the sidebar hides what is
  in it and leaves a box that left it. A restart keeps each section
  where it was put.
- *The three dots* stay, on a section while it is pointed at, focused
  in or touched: Move Up, Move Down, Move To Left, Right or Bottom
  Edge, Restore Default Places (or Return To Sidebar, from a box).
  That is the keyboard's way.
- Driven on the app by `frame-probe.mjs` (no problem): Open taken by
  its label to another place in the sidebar, then out beside the
  editor as a box that still opens its tabs, the sidebar hidden and
  shown around it, Restore bringing it back, the whole sidebar moved
  by the name strip. Seen once by hand-written script and not kept as
  a check: the tools section moved by its top edge, and both places
  kept across a restart.
*Not checked:* a finger on any of these drags (they use the browser's
own drag, as every other move in the app does); the keyboard audit
and the visual probe since the restack; the two foot rows in a box.
One thing a person will meet: dragging a row of Open, or a foot row,
moves its whole section, since those rows are not themselves dragged.

**His next reply, and the rule made one (2026-11-26).** His words,
spelling corrected: "there is inconsistency. Why does dragging the
explorer section move the whole sidebar, not just that viewable
section. Really think about the system. There are inconsistencies
everywhere." He was right: the open tool's list was the one section
whose top moved something else. Now all four sections follow one rule:
taken hold of by its top, a section moves; inside the sidebar it takes
the place it is dropped on, outside it becomes a box of its own.
- The list's name strip moves the list. Dropped outside the sidebar it
  leaves as its tool's own box (the box that tool's row dragged out of
  the tools has always made), and the sidebar shows another tool's
  list in its place.
- The sidebar as a whole has no grip. It is moved from any section's
  menu, Whole Sidebar, Move To Left, Right or Bottom Edge (the command
  Move Part to Edge, which was there).
- The list's menu is its More Actions, which gains Move This Section…
  and opens the same menu the other three sections' dots open.
- `frame-probe.mjs` drives it: the name strip dropped over the tools
  makes the list the first section and the sidebar does not move; the
  strip dropped beside the editor makes the tool's own box; the whole
  sidebar goes right and back by the command the menu runs.
*What is still not one rule, for him to say:* a tool's row reorders in
its list, while a row of Open or a foot row moves its whole section
(they have no order of their own to change); the list's menu is
reached through More Actions, the others' through dots that show on
hover; the right-hand side (chat) is one box and still moves by its
header as a whole.

### Home: a redesign, not yet designed

**Status (2026-11-26):** the look's piece 4 settles Home and Welcome as
one page that opens with the workspace (his pick 6A, under "The window
itself"), fed through the Home source point; it is not built. A Home
row that opens the present page is in the sidebar. What follows is the
earlier record.

**Where it stands (2026-11-10).** A first version shipped the same day
(the Parallx icon opens it; pages and files feed it through
`registerHomeSource`). His verdict: "all you built was a recent files
thing." A second mock-up (Continue, Today, Needs You, a stream, a status
line) also missed: it read as an admin page. No third design exists.
The contribution point and `api.home` are in the code and can serve the
redesign; the page itself is to be redrawn.

**His words on what Home is (2026-11-10, spelling corrected):** "My
vision for home is to, in a way, be something that allows the user to
jump into work. To feel inspired. Really, really take inspiration from
the site I linked and how it looks." And earlier the same day: "I think
a unified home is useful, one with standard things on it." "Imagine home
being the default page that gets opened when a user opens a workspace."

**Settled by him:**

- Home is an ordinary tab. "Home is not a fixed tab, it should be able
  to be closed."
- Opening it with the workspace is the user's choice, per workspace.
  "The way we do this is, if the setting is on, we override whatever
  last opened state file to point to the home editor tab."
- Welcome stays for new workspaces. "The welcome page, in my
  experience, only runs on new workspaces, so that is true still. If it
  is a new workspace, we use welcome."
- A width setting. "I also want the setting to allow dynamic width of
  the content on the home tab. I work on a very large monitor sometimes,
  and having dynamic width will be perfect for me."

**The bar.** paperswithcode.co, and this time looked at, not described
from memory: the cloud container could not reach the site on
2026-11-10, so neither mock-up was drawn from it. Before the next
design, see the real pages (his screenshots, or a session that can
reach the site) and show him what was taken from them.

**Unknown.** What "inspired" looks like on the page (a guess, not his:
his own work shown well, visual and browsable, with the day's quote as
the one static piece). Which of the first version's parts survive. The
Daily Brief below is not part of Home (his call, 2026-11-12).

**Still true from the first version, if its stream is kept:** the
extensions do not feed it yet (each needs its own source); a card's
line is the item's opening words, not a summary the model wrote; pages
and files carry no tags.

### Daily Brief: a report a routine writes, in place of a dashboard

**Settled (2026-11-12): separate from Home, and no app work.** His
words: "Let's keep daily brief separate from home. We do not have to do
work for it. It should be something I can set up as a routine." Nothing
is queued here; the entry stays as the record of what the brief is. Home
shows no brief card and no slot for it.

**His words (2026-11-10, spelling corrected):** "I had a dashboard named
home on my personal workspace, and it had the date time widget, and it
also had the AI widget that ran a prompt to research a quote. It also
had news stories. AI runs and looks up top 10 headlines in the city and
summarizes and links them for me. These are static things that should
update daily." "What if instead of a dashboard, I created a report
instead. I think that is smarter. Something that allows more things to
be written. We still create a quote and store it in database, we can
push it to a surface. But then maybe we have a routine that runs after
all the routines, that takes a canvas page template for daily brief,
takes the quote, writes a brief summary/explanation of the quote, then
pulls the top 10 headlines, maybe it does ten local, and another 10
national, and 5 main global, with brief summaries of each and links
directly to the articles. Then we do a brief of new emails, a summary
that just lets me know if there is an unread email, finances summary -
this requires a budget refresh/sync, then pulls info from that."

**What it is.** One canvas page a day, written from a template by a
routine that runs after the day's other routines: the quote with a
short explanation; headlines (ten local, ten national, five global),
each summarised and linked to its article; whether there is unread
email; a finance summary taken after a Budget sync. The quote is also
kept in the database, as it is today.

**How it stays modular.** Each part belongs to the tool that owns the
data (Budget's summary, the mail tool's unread count, web research for
headlines); the brief is a template with slots those tools fill, and a
slot whose tool is off is left out. Nothing in the core names them.

**Unknown.** Which tool owns email (none reads mail today, to verify);
where the routine's order ("after all the routines") is declared; one
page per day or one page rewritten; his city and sources for local
news; what happens to the brief on a day the model or the network is
unavailable.

### Dashboards: reimagined as a place to brainstorm and link work

**His words (2026-11-10, spelling corrected):** "Dashboards were my
attempt at designing custom dashboards for myself." "My current problem
with dashboards is that I really, really do not use them. I want to
reimagine them as a brainstorming space or a place to link different
work. Something to unify the painting plans, the AI workflows, the
mindmaps, etc." "Do you remember how Atelier created the plan
dashboards, think of them that way, but for all pieces of the app. If
what I want is to build a static view, then why not build it into the
app." "I believe the real question is, are we being redundant here?"
"Let's think through that thoroughly. For now, we focus on home."

**What it is.** Not a board of static widgets (a static view worth
having is built into the app; the daily ones become the Daily Brief).
A working surface where pieces from different tools sit side by side
and are linked: a painting plan, an AI workflow, a mind map, pages,
files. Atelier's plan boards are the model, widened to every tool.

**His words (2026-11-12, spelling corrected):** "When it comes to
dashboards, we should research online. I want something that is unique,
robust, while doing all the basic things. Think of a whiteboard, an
online whiteboard."

**Research, first pass (2026-11-12, read from each vendor's own pages
that day; what was not read is said).**

- *The basics, as FigJam, Microsoft Whiteboard and Apple Freeform name
  them:* sticky notes, text, shapes, connector lines (straight, elbow,
  curved), pen and highlighter, images, files, links, tables, sections
  that hold and move what is in them, lock, bring to front and send to
  back, group, align and tidy up, pan and zoom, templates, comments.
  Miro was not read (its help centre refused the fetch). Whether a line
  stays attached when its object moves is not said in the pages read.
- *Boards for linking work (Heptabase, Obsidian Canvas, Scrintal,
  Milanote, Kinopio, AFFiNE):* Heptabase: "The same card can be placed
  on multiple whiteboards at the same time", "Whiteboards do not own
  cards", a card lists the boards it is on and jumps to its place there,
  search within one board, sections, boards inside boards. Scrintal:
  links between items are global, connector lines "only exist on the
  specific board where they're created". Obsidian: a card can be
  narrowed to one heading of a note; lines carry direction, labels and
  colours; zoom to fit; boards are saved in the open JSON Canvas format.
  AFFiNE: a page and its canvas are two views of the same blocks.
  Milanote: boards nest like folders; a copy is the default and syncing
  is opt-in, for notes only.
- *Engines:* tldraw's licence permits "use only in development"; a
  shipped app needs a paid key, or a discretionary hobby key that shows
  a "made with tldraw" watermark. Excalidraw is MIT but a React drawing
  tool; whether app content can live inside one of its elements was not
  found. BlockSuite (AFFiNE's editor) is web components, MPL 2.0 by its
  README, and calls itself early stage. JSON Canvas 1.0 (2024-03-11,
  MIT) is a file format only: text, file, link and group nodes, edges
  with sides, ends, colour and label. Logseq's page was too large to
  read.
- *In the app already:* `src/ui/nodeCanvas.ts`, one pan and zoom surface
  with draggable nodes, labelled edges, selection and the keyboard's way
  to all of it, whose nodes are drawn by whoever uses it. The workflow
  editor is its only user today.

**Proposed bar (2026-11-12). Claude's proposal, shown to him; he said
"document to master list", which records it and agrees nothing.**

- *The floor:* everything in the basics list above. Two of them are in
  question for a one-person app: pen drawing and comments.
- *Taken from the linking boards:* one item on many boards, with a list
  on the item of the boards it is on and a jump to its place
  (Heptabase); links that hold everywhere beside lines that belong to
  one board (Scrintal); a card narrowed to one heading of a long item
  (Obsidian); boards inside boards (Milanote, Heptabase); search within
  one board and zoom to fit.
- *What would make it Parallx's own.* In the products read, a card is a
  note, a file or a web link; none of the pages read shows live items
  from many tools on one board.
  1. A card is the real thing: a page, a database view, a worksheet, a
     painting plan, a workflow, a deck, a PDF at a highlight, a chat. It
     opens in place and is never a copy.
  2. Tools bring their own cards through a contribution point, while
     they run. Turned off, a tool's cards stay in place as placeholders
     and return when it is turned on. The board knows no tool.
  3. The existing widgets (clock, notes, image, AI) become cards, so
     today's dashboards move onto boards and nothing saved is lost.
  4. A board is its own surface, not a kind of canvas page: a page reads
     top to bottom, a board is free space. They share items, not layout.
  5. The model works on the board: select cards and ask; the answer
     lands as a new card that can be deleted.
- *Built on:* the app's own `nodeCanvas`, not an outside engine. A
  board's file shape kept close to JSON Canvas so boards can be
  exported and imported.

**Status.** No design, no build. Owed from him: whether the floor is
right (pen drawing, comments); whether the five points describe the
board he means; whether widget dashboards retire once boards exist.
Owed from research: Miro, and how each product looks, from
screenshots; whether lines stay attached to moved objects in the
products read; how Atelier's plan boards are built
(`ext/media-organizer/plan-shell.js`, not yet read).

### Where tools look unlike each other, measured

**Measured 2026-11-15** by `tests/probes/visual-consistency-probe.mjs` on a
seeded workspace: 23 screens, each held to
`.claude/skills/visual-bar/criteria.md` (WCAG 2.2, the app's own tokens,
the kit's rules). It came from his words that day ("a lot of conjoined
systems that are still not where they need to be visually") and his rule
that style comes from research, not taste. Not raised with him item by
item; nothing here is agreed.

- *What is already even.* No text off the two fonts, no label in capitals,
  no view with two primary buttons, one title size (22 px, 600) on every
  screen with a title but Welcome. The token and kit ratchets did that.
- *Four labels cut off with nothing that gives the whole text:* two on the
  Worksheets home (its cards' second lines) and two in Tools and
  Extensions. Found only after an independent review showed the probe's
  first version could never report this.
- *Eight front pages do not use the kit's page header:* Home, Dashboard,
  Tools and Extensions, Workspace Graph, Flashcards, Concept Lab,
  Creations, Study. Each draws its own, or has none. Worksheets, Planner
  and Budget use the kit's.
- *Rows under the target size.* The Explorer's rows and its Open Editors
  rows are 22 px high and stacked, so each sits inside the 24 px the next
  one should own (WCAG 2.2, 2.5.8). The tab strip's scroll arrows are 20
  px wide. Eleven in the window's frame; none found inside a tool.
- *Off the scales, a handful:* the Welcome title (28 px, weight 300); the
  dashboard timer's face (52 px) and two radii of its widget (8 and 2 px);
  a 3 px badge in the Media Organizer; Home's search field (40 px high);
  fields of 29 and 30 px in Worksheets Settings and in Settings.

What the numbers cannot see, and where the unlikeness he means most
likely is: spacing, alignment, hierarchy, and whether a list row or a
toolbar has one form across tools. That is the `visual-evaluator` agent's
part (screenshots against the same criteria, each finding checked by a
skeptic); it has not been run. The seeded workspace is nearly empty, so
full screens (a real bank, a real library) are not measured either.

### Text arrows elsewhere

**Closed (2026-11-26):** every place below, and three more, draws the
app's chevron icon now; see item 10 under "Done from this order". One
mark is left for the look's piece 3: a menu's submenu mark, "❯".

Found while replacing the explorer's: the same dated text glyphs (▾ ▸ ▼
▶) remain in the dropdown component, the chat's tool-result caret, its
context pills and token bar, the tool detail page's sections and two
canvas property pickers. Not raised with him; recorded so it is not
forgotten.

## New extensions

Completely new tools, each its own extension in `ext/`, on or off by the
user. All four came from the Papers With Code read of 2026-11-09.
Licences are not checked for any of them; that is the first step of each.

### Build plan for the three (proposed 2026-11-12)

**Status (2026-11-26):** his go was owed on each when this was
proposed. Since then Read Anything was built on his go except two
items, Generative edits is partly built, and Voice is gated; each
part below says where it stands.

Each extension starts with a test on his own files outside the app, and
nothing is built before he has seen the result. Each surface is drawn
as mock-ups in the app's own tokens, kit and icons, light and dark, and
he picks before it is built. A step is done when the keyboard and touch
audits report 0 and he has seen it running.

*Order, by his call (2026-11-12):* "I would prioritize the extension
work first then do the chat times and speed at the end."

*His corrections the same day:* the test on twenty of his scanned pages
was Claude's invention and is dropped ("We do not need to test that...
we are adding it for the potential situation, but do not expect that we
will have this issue"); Read Anything is checked on pages Claude makes,
and the reader is Claude's pick (MiniCPM-OCR 1.0 inside Docling).

*Read Anything.* The record of what is built is `docs/READ_ANYTHING.md`.

Shipped 2026-11-12 (in the code and its tests; checked in a hidden copy of
the app):

- The reader as an engine Parallx sets up itself (it was never installed
  on his machine, so every PDF had been read as plain text). It is set
  up on his machine now: about 8 GB under `data/runtimes/docling`.
- Every rich document read with its structure; a scan read from its
  pixels; where everything on the page is kept per document.
- A scan's text reaches search, the chat's reading and the quote
  locator; in the PDF view Find, selection and a citation's highlight
  work on a scan.
- The reader stays on the processor (no graphics memory), one document
  at a time, at low priority. Pictures are never read in the background.

Decided by Claude while building, for him to overrule:

- Formulas are not turned into LaTeX in the background: about 4 seconds
  a formula even on the card. It becomes a request on one document.
- The reader in use is Docling's own, with PP-OCRv6 for scans. The
  heavier vision reader (MiniCPM-OCR) is not wired: the standard one
  read the test scans cleanly and gives a box for every line, which the
  vision readers do not.
- On his next launch the indexer reads every PDF in the open workspace
  again, once, in the background on the processor.

Left, in order (as it stood on 2026-11-12; what has shipped since is
below, and what is left now is at the end of this part):

3. The highlight for a block (a table, a figure) and for a picture of a
   page in the image view. Mock-ups first.
4. The chat sees the page: the Read tool hands over the page image; a
   citation shows a small crop of where it came from.
5. Open As Page: the scan beside the page it became. The largest
   surface; mock-ups first. Formulas as LaTeX belong here, on request.
6. A surface for the reader's state (set up, size, Remove, Read Again
   for one file) in place of the command's notifications. Mock-ups
   first.

Mock-ups drawn 2026-11-13 for the four parts that have a surface, in the
app's own colours, dark and light:
https://claude.ai/artifact/V3TycU5FwkyxBXoLaTjPyM. The options, with
Claude's pick marked on the page. His words on them the same day (2026-11-13):
"I trust your picks." So the picks are his: 3B, 4A, 5A, 6C.

- Item 3, how a cited table or figure lights up: 3A a wash over the
  block, 3B a frame with its name (Claude's pick; a line of text keeps
  today's wash), 3C a spotlight.
- Item 4, where a citation shows the piece of the page it came from: 4A
  on the citation itself, on hover, focus or press (Claude's pick), 4B a
  row of sources under every cited answer.
- Item 5, Open As Page: 5A the scan and the page side by side, linked
  (Claude's pick), 5B the page alone with the scan on demand, 5C a walk
  through the unsure parts first. The products that do this (ABBYY
  FineReader's verification, Mathpix, Acrobat's text correction) were
  not read before drawing; that reading is owed before 5 is built.
- Item 6, where the reader's state lives: 6A in Settings, 6B in the PDF
  view's panel, 6C the reader in Settings and the document's own reading
  in the PDF view's panel (Claude's pick).

Item 4's other half, the Read tool handing the page's picture to a model
that can see, is not built yet, by Claude's call: its whole worth is
what his chat model makes of a page picture, and it changes what every
read of a PDF sends to that model. It starts with one run on his model
(a scanned page with a table and a formula, read as text and read with
its picture), which needs his word that the card is free.

Shipped 2026-11-13, on his go ("read anything"), from that list:

- Item 7, reading a scan when it is opened. A scanned PDF the reader had
  not read yet opened as pictures: nothing to find or select. Now the PDF
  view looks at up to six of its pages, and when most have no text of
  their own it asks the reader for the document, shows one quiet line at
  the bottom of the view while it waits, and gives the pages already on
  screen their text when the reading arrives. The document is not loaded
  again and the place in it is kept. Checked with the real reader on his
  machine, hidden (`tests/probes/read-anything-probe.mjs`, 0 problems):
  a four-page scan nobody had read had its text about 4 seconds after it
  was opened, with the reader already running; the first document after
  the reader starts takes 16 to 20 seconds, most of it the reader loading.

Decided by Claude for item 7, for him to overrule: a document the reader
has read before is never read again on opening, whatever it found; with
no reader set up, nothing is started and nothing is said; a picture of a
page is still not read when it is opened (a photo library would be read
photo by photo), only when it is quoted or handed to the chat.

Shipped 2026-11-13 and 2026-11-14, his picks 3B and 4A:

- A citation carries the words it rests on. A PDF citation could only
  open its page. Now the link holds the line (or two) of that page that
  best supports the sentence, numbers first, and the PDF view opens at
  those words, washed.
- 3B, the frame. When those words sit in a table, or are a figure's
  caption, the table or figure is framed with its name ("Table 3"), its
  caption inside the frame. A line of ordinary text keeps the wash alone.
  A photo of a page lights up the same way in the image view.
- 4A, the card. Pointing at a citation, reaching it with the keyboard, or
  pressing it with a finger shows a card on the citation: the file, the
  page, and the piece of the page with the words washed, at a size to
  read. A table too tall for the card is shown as its heading rows and
  the rows the quote is in, cut between rows. A finger's card carries
  Open At This Place. A screen reader is told the quoted words.
- Where things are comes from the reader's reading (tables, cells,
  captions, lines) or from the page's own text. No model is asked for a
  place.

Checked hidden, with the real reader on his machine and a stand-in in the
chat model's place (`tests/probes/chat-citation-probe.mjs` and
`tests/probes/read-anything-probe.mjs`, 0 problems each): from a question
typed in the chat, through the app's own Read tool and citation check, to
the card and the framed table. Not checked: what his real chat model
writes. A citation exists only when the model cites a source label, and
the words on the link are picked from the page it was shown, so they are
only as good as the sentence they support.

Decided by Claude for 3B and 4A, for him to overrule: a table's caption
is framed with it; the frame goes at the next press in the PDF view; with
a mouse or the keyboard the card only describes (the link itself opens
the place), and only a finger's card has a button; the card is 540 by 420
pixels at most; an answer written before this has no words on its links,
so no card.

Shipped 2026-11-14, his pick 6C, the reader's state in two places:

- In Settings, a Document Reader panel: whether the reader is set up,
  what it takes on disk (7.5 GB on his machine), that it runs on the
  processor, and the buttons for the state it is in (Set Up, Carry On
  Setting Up, Stop, Start, Remove…). A set-up shows its step, a bar and
  the bytes there, and carries on with Settings closed.
- In the PDF view, a third side of the panel, Reading: when this
  document was read, how (from its own text or from its pixels), its
  pages and tables, and Read Again. A document not read yet offers Read
  Now.

Checked hidden (`tests/probes/read-anything-probe.mjs` with the real
reader, `tests/probes/document-reader-probe.mjs` with a stand-in for the
engine so nothing is downloaded: 0 problems each). Remove was run only
against the stand-in; on his real reader it was opened and cancelled.

Decided by Claude for 6C, for him to overrule:

- Set Up Document Reader… now opens Settings on that panel and starts
  nothing itself. The notifications it used to speak through are gone,
  but for one: how a set-up ended, when Settings was closed.
- Beyond the mock-up: the Reading side lists the tables and captioned
  figures the reader found, each a link that goes to its page and frames
  it. A picture with no caption is left out.
- Read Again reads the document the way it was read before. There is no
  choice to read a PDF from its pixels when its own text is bad: every
  other part of the app prefers a PDF's own text, so that choice would
  have to be honoured by the chat's reading, the view and the index
  together. Not built; his call whether it is wanted.
- Read Again replaces the kept reading. The search index keeps its own
  copy of the text and follows its own rules.
- The panel button in the PDF toolbar is named Outline, Pages And
  Reading. Document Reader sits with General in Settings' list.
- Fixed on the way: a Settings panel was torn down only the next time
  Settings opened, not when it closed.

Shipped 2026-11-14, his pick 5A, Open As Page:

- The PDF view's Reading side has Open As Page. It makes a page of the
  app from what the reader read and opens it beside the scan: headings,
  paragraphs and lists, a scanned table as a real table, figures and
  formulas as pictures cut from the scan. The page is an ordinary page.
- The two are linked. The caret in a block (or a press on it) frames
  where it came from on the scan; in a table, the very cell. A press on
  the scan marks the block made from that spot on the page. Either side
  scrolls and the other follows.
- A scan is made into a page once: asking again opens that page.

Checked hidden with the real reader on his machine
(`tests/probes/open-as-page-probe.mjs`, 0 problems), on a four-page scan
Claude drew. On that scan the reader read the bold heading "Paid" as
"pad": the kind of slip the side-by-side view is for. Not seen on one of
his own scans.

The products, read 2026-11-14 from their own pages before building
(the reading that was owed): ABBYY FineReader 16 has Text, Image and
Zoom panes, a click on a word in the text highlights its area on the
image, low-confidence characters are highlighted with next and previous,
and a Verification dialog offers Replace, Skip and Add to Dictionary.
Mathpix Snip keeps the reading position of its converted view in step
with the original PDF. Adobe's help page refused to be fetched: Acrobat
is not verified and was not relied on. Against that, Parallx links both
ways, block by block and cell by cell, and scrolls together. It does not
mark unsure characters and has no walk through them: the reading the
app keeps carries no confidence for a character or a line.

Decided by Claude for 5A, for him to overrule:

- The scan and the page are two tabs in two groups side by side, each
  the real view with all its tools, not one tab holding both as drawn.
  On a narrow window they stay side by side; they do not stack by
  themselves.
- Where each block came from is kept in a small file beside the
  workspace's other files (`.parallx/page-sources`), not in the page.
- A formula is a picture cut from the scan. Turning formulas into LaTeX
  on request (part of item 5 as first written) is not built: on the
  processor it is slow, and on the card it needs his word.
- Running heads and feet are left out of the page. The page opens with
  one line naming the file.
- The two always scroll together while both are open. There is no switch
  to stop it.
- Open As Page is offered for PDFs, from the Reading side. A photo of a
  page has no such button yet (the image view has no Reading side).

Left of Read Anything now: formulas as LaTeX on request, and item 4's
other half; each waits on his word about the card.

*Generative edits.*

Done 2026-11-12:

- The engine is Qwen-Image-2.1, packaged as a tool runtime in the Media
  Organizer (`generate-engine.js`, `engine/generate.py`): packages and
  its 24 model files (33 GB) pinned by hash, a self-test. Nothing in the
  editor calls it yet.
- One test edit, on a 32 megapixel public photo: a hay bale removed with
  no visible seam, 77 seconds at 40 steps, 19 GB at peak. Six more test
  edits are owed; they need the card.
- The layout of the tab: three mock-ups shown; his pick, in his words:
  "I pick B". B is three numbered steps: mark the area (Brush Over It,
  Select Subject, Beyond The Edges, Whole Picture), say what to do there
  (with ready-made starts), pick a result. The states board (working,
  card in use, not set up) goes with it.

Built since his pick (2026-11-12), checked in a hidden copy of the app
with a stand-in engine (`tests/probes/generate-tab-probe.mjs`, 0
problems; no graphics card used):

- The Generate tab, to layout B: mark the area (Brush Over It, Select
  Subject, Whole Picture), say what to do there (an instruction box and
  four ready-made starts), pick a result (three tries as pictures, the
  chosen one laid on the photo, More Tries, Keep). A kept result is
  stored as a patch the way Remove stores one, so undo, the history,
  hiding and saving work on it already.
- The card shared: before a run the tab reads the card's free memory;
  with too little it shows the numbers and one button, Set The Chat
  Model Aside And Generate. Behind it the core has a new call for any
  tool, `parallx.lm.releaseLocalModels()`, only ever run on the user's
  own action.
- The set-up card for the engine, in the tab.

Run on his card on his word (2026-11-12, about 10 minutes of card time):

- The engine is set up on his machine, from the tab, in 3.5 minutes. The
  model and the packages the test had already downloaded were put where
  a stopped download would be, so the app checked each file's SHA-256
  and kept it instead of fetching 39 GB again. The set-up's test edit
  passed on the card.
- All seven test edits are done. The last two (a sunset sky on the hay
  bales, a blue sky at the airport) went through the tab itself: brushed,
  instructed, three tries each, one kept. Three tries took about 250 s:
  about 55 s before the first step (loading the model and reading the
  instruction), then 45 to 55 s generating and 13 to 26 s laying back
  for each try. Peak 19.1 GB.
- Setting the chat model aside works against his Ollama: the app's call
  unloaded gemma4:31b and the card went from 9.7 GB in use to 2.1 GB.
  The button that makes the call is checked with the stand-in engine.
- Pictures for his eyes: `data/generate-test/out/` (before above, after
  below, for every try) and `data/generate-test/out/in-the-app/`.

Built on the way: a set-up whose last step, the test edit, finds the
card in use no longer ends in an error. The tab says "One step left",
shows how much of the card is free, and offers Set The Chat Model Aside
And Finish. (His chat model is usually loaded when he would set this up.)

What the real edits showed, each a proposal, none built:

- A sky marked as a band is the wrong mark. In the blue-sky edit the top
  of the rock, which lay inside the band, came back lit orange while the
  rest of the rock stayed grey, and a line of haze shows where the band
  ended and old sky went on below it. The Masks tab already finds a sky
  (its Sky choice). Proposed: Change The Sky marks the sky by itself
  with that selector, so only sky is replaced and every other pixel stays
  the photo's own. Needs one run on the card to prove.
- Four minutes for three tries is slow where it need not be. The engine
  starts from nothing on every run (about 55 s) and laying a try back
  takes 13 to 26 s on the processor. Proposed: keep the engine loaded
  for a few minutes after a run, the way the document reader stays up,
  released at once when the chat needs the card; and a faster lay-back.
- The sky patch is made 2,048 pixels wide and stretched 4.2 times over
  the 32 MP photo. That is item 5 below; a sky hides it, a detailed area
  would not.
- Ollama can list a model as loaded while Windows has moved most of it
  off the card (seen: 9.7 GB in use with a 23 GB model listed). The tab
  reads free memory on the card, not Ollama's list, and that is the
  right measure.

His verdict on the results (2026-11-13), in his words: "I have seen very
poor results in my tests." Then, on the causes found: "build and fix all".

Rebuilt 2026-11-13 (the engine's script and the tab; no model or package
changed, so nothing is set up again). What was wrong, and what replaced
it:

- *The model never saw the mark.* The mask was used only to cut the patch
  out afterwards, so "Remove what is marked" meant nothing to it. Now the
  engine's own reader (the 8B vision model that is loaded anyway, and
  that can write: its weights include the part that does) is shown the
  area with the mark's edge drawn on it and writes the instruction out:
  what is there, where, what to do with it. No second model on the card.
  The tab shows what it wrote, under the tries. If it cannot, the words
  go as they were written and the tab says so.
- *The photo was read at one size and the answer painted at another.*
  The pipeline read the photo at about 1 megapixel whatever size the
  answer was asked for, and the model places things on a grid counted
  from the middle, so the answer was out of step with the photo (the
  21.5 dB "drift" of the first test). Now both are one size.
- *Nothing held the rest of the picture.* Now, after every step,
  everything outside the marked tiles is put back to the photo, as noisy
  as that step expects (what diffusers' own inpainting does for the Qwen
  edit models, done here for 2.1). The answer lines up by construction.
- *The patch's edge kept half of what was there.* Now the patch is all
  answer everywhere inside the mark and fades over the 16 pixels beside
  it, where the model was free to join its work to the photo.
- *A patch was the model's size, stretched.* Now a patch is made at the
  photo's own pixels, and wherever the answer still shows the photo (a
  change of light or colour, a part of the mark left alone, a flat sky
  that stayed flat) the photo's own fine detail and grain are put back
  over it. The Whole Picture no longer comes back soft. Something new is
  still only as sharp as the model draws it: that part of item 5 stays.
- Smaller: the area is cut out once, not twice; it is the mark and half
  as much again each side (was as much again), so the marked thing is
  most of what the model looks at; laying a try back no longer takes 13
  to 26 s; a run that does not fit the card tries a smaller size by
  itself; More Tries reuses the written instruction.
- The model now works at up to 2 megapixels (was 4): it reads the photo
  at the answer's size, so the two together are its load, and the
  photo's detail no longer depends on the answer's size.

Checked without the card (`tests/probes/generate-engine-check.py`, 0
problems): the patch arithmetic on pictures made for it (an unchanged
answer gives back the photo at 41.6 dB where the answer enlarged gives
33.6; a darkened one keeps its detail; something new gets none of the
old detail; a recoloured sky keeps its grain; strips join); and the
script's own edit run through the real pipeline code on the tiny random
model diffusers tests it with: the photo is read at the answer's size,
every tile outside the mark ends as the photo's own exactly, the reader
writes, the patch lands where the mark is.

His words on that (2026-11-13): "I need evidence on real images." What
could be had without his card, and what could not:

- *The whole model cannot run in the cloud* (33 GB, a graphics card), and
  the cloud session could not reach his computer (no folder shared with
  it). So no edit by the model has been made with the rebuilt engine yet.
- *The model's real picture coder can* (its VAE, 1.3 GB, the same file by
  SHA-256). Real photographs were run through it on the processor, in
  tiles, which his card does not need.
  - A 24 megapixel photo of a cat, the Whole Picture, a change of light
    (the coder's own second pass standing in for the model's answer, the
    colour grade done by arithmetic). Against the photo graded at full
    size: the old lay-back (the answer stretched) 29.7 dB; the patch
    giving back only what the model's size loses 31.0; the patch as it is
    now 36.2. At 100% the eye and the fur are close to the photo's own.
  - That run is why the patch changed the same day: the coder alone
    loses detail (a round trip is 28 to 32 dB on a detailed photo), so
    the patch is now made against the photo as the coder returns it
    (`seen_by` in the script), and gives back all the photo has that
    that picture has not.
  - How far a change inside the mark reaches outside it through the real
    decoder (a 2,201 x 1,541 area of a lake, a boat marked, other water's
    numbers put in its place): against the coder's picture, 22.8 dB in
    the first tile out, 35.9 in the second, 47 and more beyond. The one
    tile the model is given to join in is the tile that reach falls in.
  - How alike "the same thing" and "something else" look to the patch's
    measure, on those pictures: the same content scores above 0.8 on 99%
    of a picture, an unrelated photo below 0.42 on 99%. The measure's two
    thresholds (0.5, 0.8) are set from that.
- *What only his card can show:* what the model paints inside the mark,
  whether its join shows, and what the reader writes. For that there is
  `tests/probes/generate-real-edits.py WORKSPACE`: it finds the jobs
  Generate left in his workspace (each of his own tries: the piece, the
  mark, his words, the patch that came back), runs the engine as it is
  now on the same piece, mark, words and seed, and writes a sheet a
  case, then beside now, whole and at 100% at the mark's edge
  (`data/generate-test/evidence/index.html`). About a minute a try, the
  model loaded once; the chat model set aside first.

Owed, on his card: that run and his verdict; what the reader writes for
his instructions; the time and peak memory at the new sizes.

Left to build, in order:

5. Something new in a large fill at the photo's own sharpness (Enhance
   on the patch) and the check with another try. Needs the card to
   prove. (Done 2026-11-13: the patch at the photo's own pixels, and the
   photo's detail and grain wherever the answer still shows the photo.)
6. Recipes: the photo's generated edits as a list; Render Again, Apply
   To Other Photos.
7. Beyond The Edges (extending the canvas). It is in layout B and is
   not in the tab yet: the editor has no notion of a picture larger
   than the photo, so it is its own piece of work.

Found on the way: `tests/probes/image-editor-probe.mjs` fails 34 checks
because it was written for the editor before the Masks tab (it expects
four tools and older control names). The editor itself was not the
cause in any check read. Bringing that probe up to date is owed.

*Voice (gated).*
1. The listening test on his card.
2. The chat's two new openings (something that fills the input,
   something that reads a reply).
3. In the chat's input: a mic to hold, a sign that it is listening, a
   sign that it is speaking with a way to stop. Mock-ups first.
4. Conversation: it knows when he has finished and when he cuts in.

### Read Anything: a better local reader for scans and photos of pages

**Status (2026-11-26):** built through the build plan above, except
formulas as LaTeX and the page's picture to the model, which wait on
his word about the card. This entry is the earlier record: its "his
yes owed" recommendations and its first step of twenty of his own
pages were overtaken by what shipped.

**His question:** how is this different from nomic? **Answer:**
nomic-embed-text embeds text that already exists so it can be searched;
it cannot read a scan. Reading a scan is extraction, which Parallx does
through Docling, with an optional OCR pipeline (`docling-ocr` in
`documentExtractionService.ts`). So the loop exists. What the new models
add is the quality and the cost of that OCR step: Indra OCR is a
1M-parameter ONNX model that runs on CPU with no PyTorch, reads
handwriting, 80+ languages and pages at any angle, and returns Markdown,
text or JSON with boxes; MiniCPM-OCR 1.0 (1.3B) and Xiaomi-OCR-0 (0.8B)
are the heavier tier for tables, formulas and charts.

**What the user gets.** Any scan or photo of a page becomes searchable
text with boxes that click back to the spot on the page. Handwriting is
not a goal: it was never his ask (it came in with Indra's own claims),
and he questioned it on 2026-11-12. Printed scans and photos of pages
are the job. For him: scanned exam papers, the closing documents. For
another person: receipts into Budget, medical letters, warranties.

**Shape.** An extraction provider the indexing pipeline can prefer over
the Docling OCR pipeline for images and scanned PDFs, plus the box data
kept so a search hit can highlight the page. Measure against Docling's
OCR on his own scans before deciding it replaces anything.

**Research (2026-11-12, each model's own card, repository or licence
page read that day; licence quotes were clipped by the reader, so the
licence files are read in full before anything ships).**

- *All three named models exist.* Indra OCR 1.1 (Datalab), MiniCPM-OCR
  1.0 (OpenBMB), Xiaomi-OCR-0 (Xiaomi).
- *Docling already wraps most of the field.* Its releases of 3 to 8
  November added presets for Surya 2.5, MiniCPM-OCR 1.0, LightOnOCR-3,
  Unlimited-OCR 2 and Nemotron 3.5 Parse, so the heavy candidates can be
  measured inside the pipeline Parallx already runs.
- *Boxes.* No model gives a box per word. A box per line comes only
  from the classic engines (Indra, PP-OCR through RapidOCR, Surya's
  detector); the small vision models give a box per block, or none of
  their own. The open products read (Paperless-ngx, Recoll) write a
  hidden text layer and let the PDF viewer highlight; none keeps its own
  boxes.
- *Handwriting is the weakest-evidenced claim.* Only two publish a
  number: Indra 25.2% ("Handwritten pages read, but not well") and
  PP-OCRv6 about 58 to 61%. The rest claim it or say nothing. The entry
  above promised handwriting from Indra; its authors do not.
- *Licences.* Indra's weights: free for "research, personal use, and
  startups under $20M funding/revenue", not for a product that competes
  with Datalab's, and the restrictions must be passed on to every
  recipient. Surya ($5M) and Chandra ($2M) weights carry the same kind
  of cap. MiniCPM-OCR, Xiaomi-OCR-0, LightOnOCR-3, PP-OCRv6 and RapidOCR
  are Apache 2.0; dots.mocr and GLM-OCR are MIT.
- *The two public rankings disagree* (PaddleOCR-VL-1.6 is fifth on
  OmniDocBench and near the bottom of Datalab's OmniParseBench), which
  is the reason to measure on his own pages.

**Checked against the app (2026-11-12): the recommendation below was
made from the research alone and does not fit; this replaces it where
they differ. Claude's, his yes owed.**

- *What the app has.* Docling is not part of the app for everyone: it
  runs in the user's own Python after `pip install docling`
  (`electron/doclingBridge.cjs`, the Install Docling command), and
  without it extraction falls back to the legacy readers, which get
  nothing from a scan. Its bridge switches OCR on or off and nothing
  more. No page position is kept anywhere in the index today.
- *So "inside Docling, for everyone" was wrong.* A person with only
  pages and PDFs would have to install Python to read a scan.
- *The fit:* run PP-OCRv6's small ONNX models in the app's own model
  runner (`electron/modelBridge.cjs`: any extension, fetched once on a
  click, kept only if the hash matches, off the graphics card when
  idle). No Python, no Docling. Read Anything is an extension that
  registers as a reader for images and scanned PDFs through a
  contribution point on the indexing pipeline, which is still to be
  built. Docling stays as it is for those who have it.
- *The heavy tier is dropped for now.* MiniCPM-OCR through Ollama would
  be called from Docling's Python, past the engine broker
  (`modelEngineBroker.ts`: one loaded shape per engine, a chat turn
  never waits), and could push his chat model off the card. It comes
  back only if the light tier measurably fails on his pages, and then
  through the core's one route.
- *New work this needs:* the detect and recognise steps around the
  models, written for the runner; a place for each line's box in the
  index; the highlight in the PDF and image views.
- *To confirm first:* that the PP-OCRv6 ONNX files run in
  `onnxruntime-node` as shipped, and what PaddleOCR's own JavaScript
  SDK offers.

**Recommendation as first written (2026-11-12, superseded above).** Do not build a
second reading pipeline. Keep Docling and choose the engine inside it,
in two tiers:

- *For everyone, no GPU:* PP-OCRv6 through RapidOCR. Apache 2.0, already
  a Docling engine, Windows listed, and a box per line. Indra is passed over: its weights licence must be
  handed on to every user and its authors have not tested Windows.
  To confirm first: that RapidOCR can load the v6 models.
- *Optional, for a user with a GPU:* MiniCPM-OCR 1.0, for tables,
  formulas and hard pages. Apache 2.0, already a Docling preset, runs
  through Ollama, which the app already talks to. dots.mocr is the
  fallback only if MiniCPM's block boxes prove too coarse.
- *Click-back:* keep each line's box beside its text in the index, so a
  search hit highlights the line on the page (the block, on the heavy
  tier).
- *First step:* measure both tiers against today's Docling OCR on about
  twenty of his own pages (a clean scan, a phone photo, a table, a formula page). The published
  numbers chose the candidates; his pages decide.

**The wider shortlist the research gave:**

1. Light, CPU: Indra OCR 1.1. 76 MB, 6.2 pages a second on 4 cores as
   stated, Markdown with line and block boxes and reading order. Its
   authors have not tested Windows. If the weights licence is not
   acceptable, PP-OCRv6 through RapidOCR (Apache, already a Docling
   engine) takes this seat.
2. Heavy, permissive: MiniCPM-OCR 1.0. Apache 2.0, about 1.5 GB as an
   official GGUF with its projector, runs through Ollama or llama.cpp,
   1.2 pages a second on an RTX 5090 as stated, fourth on OmniDocBench.
   Block boxes come from a separate Paddle layout step.
3. Heavy, own boxes: dots.mocr. MIT, 3B, emits a box, a class and the
   text for every block itself; best text score among the permissive
   models on OmniParseBench.

**Second pass (2026-11-12), for his build.** His words: the app is
personal, never sold or published, so "no Python" and licence filters
were never his constraints; and he asked "Is read anything specifically
for indexing?" It was, only because Claude wrote it that way. Research
read that day:

- *Docling already has the right container.* Its document model keeps,
  for every item, the page and the box, and for every table cell its box
  and its place in the grid. Parallx's bridge asks Docling for Markdown
  and keeps none of that.
- *Readers for his card.* MiniCPM-OCR 1.0: 1.2 pages a second on an RTX
  5090 by its own card, a Docling preset since 8 November. MinerU2.5-Pro:
  runs on Windows as it is, 8 GB, tables 93.4 and formulas 97.5 on
  OmniDocBench. OXR-1.0 tops that table and needs 24 GB to start, so it
  cannot sit beside his chat model. On a harder set (DocParsingBench)
  every reader's tables fall to 75 to 80. None gives a box per word.
- *Asking a model for coordinates fails.* Open models that write a box
  for their evidence are right at most 8.1% of the time; having the
  model quote, then finding the quote in the parser's blocks, reaches 26
  to 47% (Aalto, July 2026, one run).
- *Showing the model the page helps a little.* On hard questions,
  answers from the page image beat answers from its text by 2.4 to 2.8
  points (ViDoRe V3 paper).
- *Searching page images is real, and dear.* The best open model that
  would fit (EVIE-4.5B) needs about 9 GB loaded for every search, and in
  the same paper a text search with a reranker scored above the best
  image search.

**Recommendation, second pass (Claude's; his yes owed).** Read a scan
once, into a structured document with a region for every element; the
index is one user of it among four.

- *Keep what Docling knows.* The bridge returns the document model, not
  only Markdown: text, tables as grids, formulas, figures, each with its
  page and box. Stored once per file.
- *A better reader inside Docling for scans:* MiniCPM-OCR 1.0, run in
  Docling's own process and not through Ollama, so his chat model is
  never unloaded for it. MinerU2.5-Pro is the one to compare it with on
  his pages.
- *Four users of the one result:* the index (text, with its boxes); the
  chat's Read tool, which gets the page image as well as the text, since
  his chat model can see and is already on the card; the viewer, where a
  hit or a citation lights up its block on the scan; and Open As Page,
  where a scanned table becomes a real table or worksheet and a formula
  an equation, each still linked to its place on the scan so a misread
  cell can be checked against the original.
- *Citations by quote, never by coordinates:* the chat quotes, the quote
  is found in the stored blocks, the block's box is what lights up. It
  extends the verified citations the app already has.
- *Set aside, with the reason:* searching page images (9 GB at every
  search for a few points; revisit if his library turns figure-heavy);
  model-written boxes (8%); OXR-1.0 (24 GB); a box per word (no reader
  has one; the block is the unit).
- *First step:* about twenty of his own scanned pages through Docling
  with MiniCPM-OCR and through MinerU2.5-Pro: the tables, the formulas,
  the boxes, the seconds per page, side by side for his eyes.

**Unknown, second pass.** Whether a Docling preset fills the document
model's boxes when a vision reader does the reading; how Docling runs
MiniCPM-OCR without Ollama on Windows; whether his chat model reads a
page image well.

**Unknown.** Windows support for Indra, MiniCPM-OCR and dots.mocr (none
of their pages say); VRAM for the small vision models; handwriting
quality of anything but Indra and PP-OCRv6; whether Docling exposes
word boxes from OCR; CPU time per page on an ordinary desktop.

### Voice, both ways, local (after the surfaces are polished)

**His words:** "I do have interest in adding voice, just not quite yet. I
feel like I need to improve the surfaces a bit more, make the app feel
more polished before going to voice."

**What it is.** Qwen3-ASR (0.6B and 1.7B): speech recognition plus
forced alignment (word timestamps). Qwen3-TTS and Breeze TTS 2: voice
design from a plain description, cloning from a short sample, streaming.
The extension: dictate into a page; read a page or a flashcard deck
aloud; in Creations, give each character a described voice so a chat can
be heard; transcripts of his own recordings linked to the moment.

**Gate.** Polish first, by his call. Not started until he reopens it.

**Research (2026-11-12, each model's own card, repository or licence
page read that day; the two rankings read from their own data).**

- *All three named models exist, and none is the pick.* Qwen3-ASR
  (Apache 2.0) needs a second model for word timings, five minutes at a
  time, and streams only through a Linux-style server. Qwen3-TTS (Apache
  2.0) was measured by a user slower than real time on an RTX 5090 under
  Windows in the official package (issue 89), has no streaming in that
  package, and both issues were closed "not planned". Breeze TTS 2 is
  BreezeBlue's, and its weights are "for research and non-commercial use
  only".
- *Listening.* On the Open ASR Leaderboard (data version 10-11-2026) the
  0.6B Parakeet models now beat Whisper: parakeet-tdt-0.6b-v3 7.04,
  whisper-large-v3 8.24, whisper-large-v3-turbo 8.75. Qwen3-ASR-1.7B is
  6.15; the best open model with timings and speakers built in, NVIDIA
  Nemotron 3.5 Transcribe (6.13), is 34B and will not share a card with
  a chat model.
- *Speaking.* The best-ranked open voices carry strings: Fish Audio
  Drama 3 (35B, free under $500k revenue), Breeze TTS 2 (non-commercial).
  Permissive ones: Kokoro-82M (Apache, runs without a GPU, fixed voices),
  Phonon 31M (Apache, English, 64 MB), VoxCPM2 (Apache, 2B, a voice from
  a written description, cloning, streaming, about 8 GB as stated),
  Ming-3.0-tts (MIT, 0.5B, three weeks old, tested on data-centre cards
  only), the MOSS-TTS family (Apache). Chatterbox was retired by its
  maker in August 2026.
- *Products.* Handy and Superwhisper both ship Parakeet for dictation:
  one shortcut, hold or toggle, the text lands where the cursor is.
  SillyTavern's character voices are a voice map: one voice per
  character from a list, "Only narrate quotes", a play button on each
  message. None of the documented flows makes a voice from a
  description.
- *Runtimes with no Python:* transcribe.cpp (MIT, JavaScript bindings,
  many listening models) and sherpa-onnx (Apache, a Node addon,
  listening and speaking).

**Recommendation (Claude's, 2026-11-12; his yes owed, and the gate
above still holds: this opens nothing).**

- *Scope, by his call (2026-11-12):* "I only care about AI chat for
  voice, not Creations AI characters." Voice is talking to the AI chat
  and hearing it answer. Character voices, voices made from a
  description and cloning are out, and with them VoxCPM2, Ming and the
  consent question. Dictating into a page and reading a page or a deck
  aloud are not asked for either.
- *Speaking to the chat:* Parakeet-TDT-0.6b-v3. Small enough to sit
  beside the chat model or run without a GPU, with punctuation. It is
  push to talk: he holds a key or the mic button, speaks, and the words
  land in the chat box. Words appearing as he speaks, or a hands-free
  conversation that knows when he has stopped, would add the same-size
  NVIDIA streaming model and a voice detector; not asked yet.
- *The chat answering aloud:* Kokoro-82M, off the GPU so it never
  competes with the chat model, speaking the reply sentence by sentence
  while it is still being written, with a way to stop it.
- *How it stays modular:* the chat is core and Voice is an extension, so
  the chat gains two generic contribution points (something that fills
  the input, something that reads a reply) and Voice registers into
  them. Turned off, the mic and the speaker button go.
- *Checked against the app (2026-11-12).* The chat's extension points
  today are tools, drop handlers and answer forms
  (`parallx.chat`); the two points above do not exist and are the first
  build. Both models are small ONNX files, so they belong in the app's
  own model runner (fetched on a click, by hash, no Python), not in a
  new engine. Neither touches Ollama, so the engine broker and his chat
  model are left alone. Kokoro has a JavaScript build (SillyTavern runs
  it in the browser); how Parakeet's decoding runs in the runner is to
  be checked before anything else.
- *Passed over:* the three named models, for the reasons above; Whisper
  (now behind Parakeet); every voice-design and cloning model.
- *First step, when he reopens Voice:* his ear. One chat answer read by
  Kokoro and by Phonon, and his own speech through Parakeet into the
  chat box.

**Second pass (2026-11-12), for his build.** His words: the app is
personal, never sold or published, so decisions are made for his
machine and any licence that allows personal use; and the answer is to
go past the easy one. The recommendation above (push to talk, a plain
reading voice) is the floor, not the aim. Research read that day:

- *Nobody has turn-taking solved.* TurnBench (2026-08-27): "No system
  is simultaneously fast, selective, and high-recall." Kyutai's semantic
  detector catches 77% of turn ends and 90% of interruptions; Pipecat's
  Smart Turn catches 75% of turn ends and 11% of interruptions.
- *No local stack publishes its delay on a consumer card,* and the open
  ones (Kyutai Unmute, LiveKit Agents, Pipecat) are Linux or WSL.
- *The best-sounding voice that fits is Breeze TTS 2,* and it fits
  badly. A user's figures on an RTX 4090: its fast path takes 17 to
  18 GB; its small build takes 5.3 GB and runs at about real time on an
  idle card; and "Sharing the GPU with another heavy job slows speech
  down 3 to 5x." Beside a chat model that is writing, it would stutter.
- *A list of his words helps recognition, if short.* Phrase boosting
  raised key-phrase scores from 42.5 to 70.4 in its paper (not measured
  on Parakeet v3); speech models given long lists get worse.
- *A spoken answer is a different text.* Listeners preferred answers
  written for the ear in 76.2% of comparisons (EMNLP 2024); OpenAI's
  voice guide: one or two short sentences, numbers read out, a short
  line before a tool runs.

**Recommendation, second pass (Claude's; his yes owed; the gate holds).**
A conversation with the chat in which only the voice touches the
graphics card:

- *Everything that listens runs on the processor:* Parakeet v3 (a
  ten-second turn in about a third of a second, on Windows as it is), a
  detector for "he has finished" and one for "he is interrupting". The
  card stays the chat model's.
- *It knows his words:* each turn the recogniser is handed a short list
  taken from the page that is open and the conversation so far.
- *It says a short answer and writes the full one:* the chat model
  writes the cited answer for the screen and one or two sentences for
  the ear, with marks for how to say them.
- *The voice speaks in one burst.* The short spoken text is made into
  sound in one go, when the chat model is not writing, then played. That
  is what lets the best voice (Breeze TTS 2) be used at all on a shared
  card; Kokoro on the processor is the voice when an answer should be
  spoken as it is written.
- *No headphones:* the microphone and the speech both run inside the
  app's window, where Chromium's echo canceller can hear both.
- *Push to talk always works,* because the detectors will be wrong
  sometimes.
- *First step, when he reopens Voice:* on his card, beside his loaded
  chat model, measure the delay from the end of his sentence to the
  first sound for each voice; then his ear on both.

**Unknown, second pass.** Whether he has or wants WSL (Breeze and most
voices are Linux only); the echo canceller with his speakers; whether
his chat model writes good speaking marks; every delay on a 5090.

**Unknown.** Which runtime carries Parakeet and Kokoro inside the app;
whether he wants push to talk only or a hands-free conversation.

### Predict From This Table

**His words:** "This one I find interesting. Forecasting budget or
habits."

**What it is.** TabPFN-3.5, a tabular foundation model that forecasts and
classifies on small tables with no training step. The extension: an
action in Worksheets and Tables that fills a column from the others, or
forecasts the next points of a time series, with the uncertainty shown.
Budget's ledger forecast; habit data; any spreadsheet a person keeps.

**Shape.** One AI tool and one Worksheets action, both through the
extension's single model route; a result lands as a new column or a
block, never silently overwriting data.

**Unknown.** Licence (TabPFN weights have had their own terms before);
size on disk; whether it runs on CPU in acceptable time; how it handles
dates and text columns.

### Generative edits in the Image Editor

**Status (2026-11-26):** partly built, on Qwen-Image-2.1, through the
build plan above (the Generate tab; Recipes, Beyond The Edges, the sky
selector and keeping the engine loaded are not). This entry is the
earlier record: its "No go to build yet" was overtaken.

**His words:** "I like the idea of generative edits."

**What it is.** Qwen-Image-2.1 unifies text-to-image and instruction
image editing in one open model; Iris-3B is pixel-space restoration and
super-resolution. The extension: a Generate step beside Enhance: inpaint
a masked region, edit by instruction, extend a canvas, all local on his
5090. Iris is a comparison against SeedVR2 (the current Enhance winner),
not a replacement until measured.

**Shape.** Reuses the editor's masks (step 2 of the mask work) as the
inpaint region; one model route; results as a new layer or a new copy,
never over the original.

**Research (2026-11-12, each model's own card, repository or licence
page read that day).**

- *Both named models exist, and neither is the pick.* Qwen-Image-2.1
  (7B, 2026-09-20) is licensed "for research or evaluation purposes
  only". Iris-3B is Apache 2.0, and nothing read claims it beats
  SeedVR2.
- *The best open editors are new and carry strings.* On the Artificial
  Analysis editing table (read 2026-11-12, no date shown; cloud models
  hold the top): MiniMax H3-Image 1138 (33B, and its licence excludes
  the US, EU, UK and Korea), Bria Fibo 2.0 1085 (non-commercial, and its
  prompts are written by a Gemini call, so not offline), Qwen-Image-2.1
  1084 (research only), FLUX 3 Image Klein 1069 (free under $5M revenue,
  gated, a clause on filtering or reviewing output; 26 GB stated at
  FP8). The Apache ones: Qwen-Image-Edit-2511 996 (20B), FLUX.2 klein 4B
  942 (about 13 GB).
- *None of the new leaders has a released hard mask.* FLUX 3 Klein's
  boxes "do not hard-constrain pixels". FLUX.1 Fill dev is the one
  dedicated mask model (non-commercial, gated; its authors state "slight
  colour shifts" outside the fill and lines at its edge).
- *No model works at 24 to 60 megapixels.* Every local editor read
  (Krita AI Diffusion, OpenFill for GIMP) crops a padded area around the
  mask, generates near 1 to 2 megapixels, and lays only the masked part
  back; OpenFill says large fills "come back softer".
- *Removal without a prompt:* LaMa (Apache 2.0, holds to about 2K) is
  what OpenFill and IOPaint ship; MI-GAN (MIT) has a ready ONNX file.
- *Runtime without ComfyUI:* diffusers has a pipeline for each;
  stable-diffusion.cpp (MIT, CUDA, Windows) lists nearly all of them and
  SeedVR2, but says nothing on masks.
- *Controls the open editors offer:* the operation (fill, remove,
  expand, edit), an optional prompt, strength, feather and blend of the
  mask edge, how much surrounding area the model sees, expand by
  dragging an edge or picking a ratio, variations, the result on a new
  layer. Adobe's pages refused the fetch and are unread.

**Recommendation (Claude's, 2026-11-12; his words on it the same day: "I think I am aligned." No go to build
yet).** Three tools in
one Generate step, each on Apache weights so the app can fetch them for
anyone:

- *Remove:* already in the editor (docs/IMAGE_EDITOR.md: LaMa, his
  choice of 2026-09-28, run by the app's model runner, each removal kept
  as a patch). The first write-up of this recommendation proposed
  building it; that was a miss, nothing is to be built. The Generate
  tools reuse its patches: a fill is a patch laid over the original.
- *Fill, Expand and Edit:* Qwen-Image-Edit-2511, one model for all
  three. It is the best-ranked Apache editor and diffusers has a mask
  pipeline for the Qwen edit line. A mask is honoured by construction:
  only the masked, feathered part of the crop is laid back, so nothing
  outside it can change whatever the model does. A large fill that comes
  back soft is passed through Enhance, which is already there.
- *How it enters the app:* as a tool runtime, the way Enhance does
  (`electron/runtimeBridge.cjs`): declared by the extension, set up once
  on a click, every file fetched by its hash, the machine checked
  first. It should share Enhance's PyTorch rather than install a second
  copy (3.6 GB); whether one runtime can hold both is to be checked.
- *The graphics card:* Enhance reads the free memory before a run and
  says so when there is too little. A 20B editor needs most of a 32 GB
  card, so with his chat model loaded it will not start. Generate needs
  the same check, and one button that frees the chat model, or it will
  feel broken.
- *FLUX 3 Image Klein is dropped.* Its files are gated behind a
  Hugging Face login, and the runtime fetches by hash with no login.
- *Passed over:* Qwen-Image-2.1 (research only), H3-Image (size,
  territory), Fibo 2.0 (needs Gemini), FLUX.1 Fill (non-commercial, and
  the crop and lay-back does its job), Iris-3B (no claim over SeedVR2;
  Enhance stays as it is).
- *First step:* ten edits on his photos through Qwen-Image-Edit-2511,
  run by hand outside the app, for his eyes, with its memory use and
  seconds per edit measured. Nothing is built on it before that.

**Second pass (2026-11-12), for his build.** His words: the app is
personal, never sold or published, so licence and login were never
filters; and the answer is to go past the easy one. The engine above
(Qwen-Image-Edit-2511) was chosen by licence and is replaced. Research
read that day:

- *The best engine his card runs today is Qwen-Image-2.1.* Quantised,
  its generator is about 7.2 GB beside an 8B encoder; one write-up
  measured about 5.5 seconds an edit on an RTX 5090, with 7 of 23 edits
  needing a second try. It produces up to about 4 megapixels. Its
  licence is "research or evaluation"; whether his own photos count is
  his call. FLUX 3 Image Klein produces up to 4K and takes 25 to 26 GB
  at 1 megapixel, Linux only so far. The model first recorded as
  "MiniMax H3-Image" is Pruna's P-H3-Image; its builds that fit 32 GB
  run in ComfyUI only.
- *No editor gives back the untouched pixels.* Plain Qwen-Image-2.1
  changes 12.8% of the pixels outside the edited object (a community
  add-on brings that to 7.5%), and the round trip through the model
  alone changes about 2%. Fidelity comes only from laying back the
  patch, which the editor already does for Remove.
- *The soft patch is everyone's problem, and nobody open has fixed it.*
  Adobe moved to 2K in January 2026; its own users still write
  "Resolution is too low" and name the mismatch of grain. Research
  (Patch-Adapter, Agent Banana, PixPerfect) shows the cure: structure at
  low resolution, the patch at full resolution, then a pass that fixes
  colour, seam and texture. No open tool restores a generated patch
  with an upscaler using the photo around it. No one has measured grain
  matching.
- *Checking and trying again pays; an elaborate agent does not.* The
  same editor with planning and checking gained 89 points in one arena;
  a NeurIPS 2026 study found a plain retry earns most of that. General
  vision models judge edits poorly by one judge-maker's account; a
  small open judge (EditScore, 4B) exists.
- *No product keeps an edit as a recipe* that a newer model can
  re-render, or re-finds the place to edit in each photo of a set.
- *Painter's studies are not a job for a generator.* A notan or a
  five-value study is arithmetic on the photo and redraws nothing; a
  relight can be kept as a map of brightness changes (PIXLRelight).

**Recommendation, second pass (Claude's; his yes owed).** A Generate
step whose result holds up at 100% on a 60 megapixel raw, which no
editor read does:

- *Engine:* Qwen-Image-2.1, quantised, in the Enhance runtime's Python.
  FLUX 3 Image Klein is the comparison, later, under WSL.
- *The patch is made at the photo's own size:* the area around the mask
  is cropped at native pixels and generated at up to 4 megapixels; a
  larger area is then rebuilt by Enhance (SeedVR2, already installed)
  with the surrounding photo in view; a last pass matches colour, seam
  and grain to the photo. Only the masked patch is laid back.
- *Every edit is checked, then tried again if it failed:* a measured
  check that the patch lines up and its edge matches, and a judge of
  whether it did what was asked (his chat model, or EditScore if his
  model judges poorly), picking the best of a few tries.
- *His chat model writes the long prompt* from his short instruction
  and the photo, as the engines' own makers advise.
- *An edit is kept as a recipe:* instruction, mask, seed, engine, crop.
  It can be re-rendered when a better engine arrives, and applied to a
  set of photos by re-finding the place in each, the way Remove From
  Other Photos does.
- *Set aside, with the reason:* Qwen-Image-Edit-2511 (lower ranked,
  larger); P-H3-Image (ComfyUI only); patches kept in the raw's linear
  light so they follow later exposure changes (no one has shown it, and
  an 8-bit patch holds nothing above white; first to check is where the
  editor applies patches relative to its exposure controls); painter's
  studies (they belong in Atelier as plain image arithmetic, not here).
- *First step, outside the app, on his photos:* ten edits through
  Qwen-Image-2.1; then three large fills taken through Enhance and the
  grain match, shown at 100% beside the plain result. That one
  experiment says whether the native-size patch is real.

**Unknown, second pass.** How Qwen-Image-2.1 takes a mask (its makers
show the mask passed as a second picture; the proper mask code is an
unmerged change to diffusers); its memory on a 5090 beside his chat
model; whether SeedVR2 on a patch invents texture of its own.

**Unknown.** Whether the mask pipeline loads the 2511 weights; VRAM and
seconds per edit for Qwen-Image-Edit-2511 at a quantised size; whether
an instruction editor extends a canvas well (Expand) or FLUX.1 Fill is
needed for that one job; which runtime (diffusers in the app's Python,
or stable-diffusion.cpp); Windows for each. ComfyUI stays off the table
(decided earlier, do not re-raise).

## Order of work (proposed 2026-11-26; items 4 to 23 agreed the same day)

**His go (2026-11-26):** "I agree to that order. Treat items 4 to 23 as
go." One run, one item after another, each its own commit; he set aside
"one piece to a session" for this run. Items 1 to 3 and "Needs him or
his machine" still wait on him. What each item came to is under "Done
from this order", after the list.

His words: "fix findings then propose plan of action to address all
items, prioritize quick wins while maintaining standards."

**Fixed the same day (the four the audits had found and left):**
- The terminal's input: the line it sits in shows a mark while the keys
  are in it. The audit's "no focus ring" there is 0.
- Atelier's New Tags dialog keeps Tab inside it, closes on Escape from
  anywhere in it, and gives focus back to what opened it. The audit's
  popup pass on it is 0.
- Atelier's grid captions sit on the viewer's own scrim and ink
  (`--px-viewer-scrim`, `--px-viewer-ink`) in place of white on a fading
  gradient. The light-mode contrast pass on the grid is 0. The caption
  is a solid bar now where it was a fade; his to overrule.
- The command palette's rows: not a fault in the app. Driven by hand on
  the app, the arrows walk every row from the field and from a row.
  The audit still counts 5 rows as not reached; why it does is not
  found, and the audit was not changed. (Found since, item 5 under
  "Done from this order": the hand run had not gone past the tenth row.)
Also brought up to date: the entries of this list that said "nothing
built" of things since built (Worksheets, the look, the window group,
Home, the build plan for the three, Read Anything, Generative edits).

**The standard for every step below:** one piece to a session; built
on the app and driven by a probe that reads the result back; the
typecheck, the unit suite, the keyboard audit and the visual probe
after; no check weakened; the master list updated; pushed.

**First, his answers (minutes of his time, and they unblock checks):**
1. The acceptance-probe corrections (two more from this run: the plan
   tab's table and list, under item 11, and study-usable 19.1's wait
   for the text editor, under item 17): study-record's `point()` (it does
   not scroll a clipped row into view; this one correction is expected
   to clear 6.2 to 6.7, 7.3 to 7.5, 9.2 and 9.4), study-walk 0.9, 1.5,
   1.7 and 9.3, study-work 2.4 and 5.7, study-usable 6.3 and study-unit
   10.7.
2. Flashcards' Study row (keep until piece 10, or drop now).
3. The two sidebar points left: rows of Open and the foot rows move
   their whole section; the list's menu is under More Actions.

**Quick wins (each an hour or two; one session can take several of the
checks, the builds stay one to a session):**
4. The checks owed since the sidebar was restacked: the full keyboard
   audit, the visual probe, the touch-drag probe, a finger on the new
   drags. Fix what they find. **Done.**
5. Find why the audit miscounts the palette's rows, and put it right in
   the place that is wrong (the palette, or the audit with his say). **Done:
   the palette was wrong, not the audit.**
6. Piece 8, Tools and Extensions as one list grouped On and Off. **Done.**
7. Piece 6, first half: a page's Default font follows the app's face,
   and Newsreader joins the page font list. **Done.**
8. The Dashboard's large numbers in the display face. **Done.**
9. A live word from more tools in Open (Study's session, Worksheets'
   paper), through the point built in piece 2. **Built; not driven on
   the app, see below.**
10. Text arrows elsewhere: check whether any are left, then close the
    entry or fix them. **Done: nine places were left; fixed.**

**Then the settled pieces of the look, smallest first (a session each):**
11. Piece 11, Study's plan tab as the page for the plan's rules. **Part
    built; the rest waits on his word about an acceptance probe.**
12. Piece 10, Flashcards' Decks and Stats (this also settles its Study
    row). **Done; the Study row is his to say.**
13. Piece 9, Planner's three pages (this takes the doubled tabs, month
    and filters off the page). **The doubles are off; the pages'
    redrawing is left.**
14. Piece 7, the PDF viewer. **Done.**
15. Piece 3, menus, notices and the Settings dialog. **Done, but for icons on
    the menu bar's entries.**
16. Piece 5, chat. **The type is done; one meta line is left.**
17. Piece 6, second half: a .md file opens as a page. **Done; one acceptance
    check needs his word.**
18. Piece 4, Home and Welcome as one page (the largest; it has missed
    twice, so it gets the bar read first). **Skipped: the bar cannot
    be read from this environment.**

**Then what is half done elsewhere:**
19. Study piece B: one review pass by agents that did not write it (it
    shipped unreviewed), and name its "remainder" or strike the word.
20. Study piece C's remainder (the current phase's units; tomorrow's
    questions made overnight).
21. Worksheets: the toolbar, then the rest of its list, a piece each;
    and the checks left open when its session stopped on 2026-11-16.
22. Generative edits: Recipes, Beyond The Edges, the two proposals;
    and the image editor probe's 34 failures.
23. "Where tools look unlike each other": measure again now that the
    frame and the look have changed, then raise what is left with him.

**Needs him or his machine, so not scheduled:** his verdicts on chat,
Enhance, the real edits and Style Text on his own model and card;
Read Anything's two items that wait on his word about the card; the
Study plan's three questions (the 14 hours, the week off, the phase
lengths); piece E (XP); the Study notebook shape (mock-ups first);
Dashboards (three answers owed); Voice (gated); Predict From This
Table (never started).

### Done from this order (2026-11-26)

**Item 4, the checks owed since the sidebar was restacked. Done.**
- *The full keyboard audit* (427 screens and sub-screens, the dialogs,
  the touch, popup and light-contrast passes; 65 minutes): nothing from
  the sidebar. Its totals: not focusable 11, every other count 0, and
  48 "stuck dialogs". The 11 were the command palette's rows (10, the
  same 5 on its two screens) and one control of Atelier's Colour Study
  (the wheel's "Screen" choice, on two of its screens), which read 0
  when that screen was audited again alone and is left as a run that
  differed. The palette's rows and the stuck dialogs were real faults
  of the app, older than the restack; they are item 5.
- *The visual probe:* nothing rose but "Creations: title size 0 to 1",
  there before. The window frame's small targets stand at 1 (the tab
  strip's scroll button) against a baseline of 11.
- *The touch-drag probe:* one failure, and a real one: a finger could
  not resize a Dashboard widget by its edge. The widget clips at its
  border and each edge handle was centred on that border, so the outer
  half of every handle was cut off and a press on its centre landed on
  the border. The handles now lie inside the edge (`dashboard.css`);
  the mark shown on hover is the outer 4 px, as it was drawn. Not from
  the restack: the geometry was the same before it, and which side of
  the border the press fell on turned on a fraction of a pixel.
- *A finger on the new drags:* three checks added to
  `touch-drag-probe.mjs` (14 of 14 now): a tool's row, held then moved,
  to another place in the tools; Open taken by its label to under the
  foot rows; Open taken out of the sidebar into a box of its own, and
  Restore Sidebar Sections after.
- *Not run:* the e2e specs.

**Item 5, the palette's rows the audit could not reach. Done: the
fault was in the app, three of them, and the audit was right.**
- *The palette did not keep its highlighted row in view.* It shows ten
  rows of fifteen; Arrow Down past the tenth moved the highlight under
  the fold with the list standing still. The audit counts a row it
  cannot see as not reached, which is where its 5 came from. The list
  now scrolls to the highlighted row.
- *With the pointer resting over the list the arrows jumped back.* Once
  the list scrolled, the row that slid under a still pointer took the
  highlight (11, then 6 again). Only a pointer that itself moved chooses
  a row now.
- *A dialog could lose the keyboard.* The audit's "stuck dialogs" (48:
  Settings 44, the palette 4): with the focus fallen to the window,
  Escape closed nothing and Tab walked the page behind. A person got
  there by one mouse press on a section in Settings' list (the list is
  redrawn, and the pressed entry with it), or by a press on plain words
  in the palette. Fixed in one place for every dialog built on the
  overlay, and for the palette (`keysBackToModal`, `ui/dom.ts`): a key
  pressed while a dialog is in front and nothing has the focus goes
  back into it, and Escape closes it. Settings also keeps the focus on
  the section pressed, and the palette puts the focus back when late
  results redraw a focused row.
- *Checked:* `tests/probes/dialog-keys-probe.mjs` (new, 19 of 19: the
  arrows with the pointer away and resting over the list, each row in
  view, Tab and Escape from the window in the palette and in Settings);
  the keyboard audit on the palette's two screens and Settings and its
  34 sub-screens (not focusable 0, stuck dialogs 0, every count 0).
  The audit itself is unchanged.

**Item 6, the look's piece 8: Tools and Extensions as one list grouped
On and Off (his 6B). Done.**
- *What was there:* the list was already grouped (Enabled, Disabled)
  and already drew each tool's own icon; the mock-up's "one icon for
  all" was an older state. Missing were the title, the group names, what
  a tool adds, and the switch: a tool was turned off by a Disable button
  that showed only on hover.
- *Built:* the page has its title in the display face (the kit's page
  header); the groups read "On, 19" and "Off, 9" in the mono face and
  still fold on a press; each row is the tool's icon, its name, one line
  of description (the whole of it on hover), what it adds counted from
  its manifest in the mono face ("18 commands · 1 view · 5 settings"),
  and a kit switch. A tool the app requires has no switch, as it had no
  button. The switch is named for a screen reader ("Planner: on"), is a
  Tab stop with a focus ring, and its press does not open the tool's
  page. `toolFacts.ts` holds the icon and the count.
- *Differs from the drawing, for him to overrule:* the mock-up counted
  "widgets" and "pages"; a manifest lists commands, views and settings,
  so those are what is counted. The column's list for this page
  (Installed, On, Off with counts) is not built: Tools and Extensions
  is a tab, not a tool with a sidebar list, and the search field's
  `@enabled` and `@disabled` already filter.
- *Checked:* `tests/probes/tools-list-probe.mjs` (new, 18 of 18 on the
  built app: a tool turned off with the mouse and on with Space, read
  back from the app's own services; its row leaves the sidebar's tools
  at once); the visual probe (this screen: clipped 1 and no header 1
  before, nothing found now); the keyboard audit on it (every count 0);
  typecheck; the unit suite.

**Item 7, the look's piece 6, first half: a page's Default font follows
the app's face, and Newsreader is in the page font list. Done.**
- *What was there:* `fontRegistry.ts` pinned Default to Inter, so every
  page stayed in Inter under the new look. Eleven built-in faces, none
  of them the app's own.
- *Built:* Default is the app's interface face by its variable
  (`pageFontCss`), so a page follows the app's font at once when
  Appearance changes it, and falls to Hanken Grotesk, then Inter.
  Newsreader is second in the page's Font menu. Every other id and
  stack is as it was, so no page changes but those on Default.
- *Export, which the item did not name but would have broken:* a
  printed page has none of the app's styles, so a page in Newsreader
  would have printed in Georgia. The print document now carries the
  bundled faces its stack names, from the app's own font files
  (`bundledFontFaceCss`, `printHtml.ts`); Default prints in the app's
  face as it stands when exported.
- *Checked:* `tests/probes/look-details-probe.mjs` part A on the built
  app (a page on Default is in Hanken Grotesk; it changes with the
  app's face without being reopened; Newsreader chosen from the page's
  own menu draws the page in it; a new page is still on Default);
  `pageFonts.test.ts` (7, the list, the fallback and the export's
  rules); the keyboard audit on a page (0); the screenshots.
- *Not checked:* an exported PDF opened and looked at (the rules are in
  the document; the file was not printed here). The app's face was
  changed by setting the one variable Appearance sets, not through the
  Appearance panel.

**Item 8, the Dashboard's large numbers in the display face. Done.**
- *What was there:* four large numbers in the Dashboard's own widgets,
  all in the interface face at weight 600 or 700: the clock's time
  (36 px), the countdown's figures (30), the timer's face (52), the
  year's counts (22).
- *Built:* the four take the display face at weight 500, the sizes as
  they were, with figures of one width so a running clock or timer
  does not shift as its digits change.
- *Left:* the countdown's "done" words (28 px) are words, not a number,
  and stay. Widgets other tools add are theirs.
- *Checked:* `look-details-probe.mjs` part B on the built app (the
  timer's face is Newsreader at 500; "11:11", "00:00" and "88:88" take
  the same room); the screenshot; the visual probe (the Dashboard's
  counts did not move); the keyboard audit on the Dashboard (0). Of
  the four, the seeded Dashboard shows only the timer; the other three
  share its rule and were not on screen.

**Item 9, a live word from more tools in Open. Built for Study's
session and Worksheets' quiz; one of the two driven only in a test.**
- *What was there:* the point from piece 2 (`api.editors.setEditorStatus`),
  used by the PDF viewer and Flashcards and by nothing else.
- *Built:* a Study session's tab says how far it is ("3 of 12", the
  answered of the draw, as its row in Study's list does) and says
  nothing once the session is finished. A Worksheets quiz's tab says
  the problem it is on ("4 of 12") and says nothing on its summary or
  once the quiz is completed. Each tool speaks for its own tab through
  the point; the core names neither.
- *Checked:* Study's in its real bundle (`studyPane.test.ts` 5a: the
  word counts up one answer at a time, never past the draw, and is
  cleared at the results). Typecheck and the unit suite.
- *Not driven on the built app, either of them.* A Study session needs
  questions a model wrote, and a quiz needs a problem bank; no probe in
  the repository seeds either without his own database or a model
  stand-in of several hundred lines. The Open row drawing a word a tool
  set was driven in piece 2. On his machine: start a quiz or a Study
  session and look at its row under Open.
- *Not built:* a word from pages. "Worksheets' paper" was read as the
  quiz in progress; if he meant a sheet file's own tab, that is not
  done.

**Item 10, text arrows elsewhere. Some were left; they are fixed, and
the entry is closed but for one mark.**
- *Found left* (triangle characters drawn as text): the kit's dropdown,
  chat's tool-result caret, its Sources Considered toggle, its context
  button and its token bar, the tool page's sections, AI Settings' tool
  groups, a page property's type picker and its calendar's two month
  buttons, and Workspace Graph's History and community rows.
- *Fixed:* each is the app's chevron icon from the icon registry (an
  extension asks for it through `api.icons`). The calendar's two
  buttons, which had only a triangle for a name, are named Previous
  Month and Next Month.
- *Checked:* `tests/probes/look-details-probe.mjs` part C on the built
  app: no triangle character is drawn as text (in an element or by its
  stylesheet) on the Dashboard, Settings, AI Settings' tools, a tool's
  page, the seeded chat and its timing view, a database, a page and
  Workspace Graph; the dropdown's, the tool groups' and the tool page's
  marks are icons. The keyboard audit on those screens (0). The whole
  probe is 13 of 13.
- *Not seen on screen:* chat's tool-result caret and token bar rows,
  the property type picker and the calendar (none is open on the seeded
  screens); they were changed and typechecked.
- *One mark left, for piece 3:* a menu's submenu mark is the character
  "❯" (seen on the page's menu beside Font and Export). Piece 3 redraws
  the menus with icons and shortcuts, so it goes there.

**Item 11, the look's piece 11: Study's plan tab as the page for the
plan's rules. The part that adds is built; the part that takes away
waits on him, because an acceptance probe reads what it would remove.**
- *What was there:* the tab as its header says: the name, four Open
  buttons, the three plans as cards, hours per day, the phases as a
  list, then every day as a table by week.
- *Built:* the days left are the one large number of the page, in the
  display face at the title's right (the line under the title no
  longer says them a second time). Under the three plans, the phases
  as one strip from the start to the exam: each piece as wide as its
  share of the days, the one today is in filled, one whose work does
  not fit edged in the danger colour with "needs 60 h, has 33 h" in it.
  A piece is a button, named for a screen reader with its kind, dates,
  days and hours; a press, or Enter, goes to that phase's facts in the
  list below. Each piece leads with its kind as an icon (a book for
  Study, a moon for Rest, a turning arrow for Catch-up, a sun for
  Holiday), so a piece too narrow for its name still says what it is.
  The press is the command Open Plan with a phase, not a handler of the
  tab's own (two ratchets, missed when this was first committed and put
  right in the next commit: a kit button's local handler, and a button
  of words with no icon).
- *Not built, and why:* the drawing takes the table of every day off
  the tab, turns the list of phases into the strip alone, and replaces
  the four Open buttons with Week, Phases, Dates and Goal.
  `study-plan-acceptance.mjs` reads exactly those: the table (2.6, 2.7,
  2.9, 2.12, 2.13, 3.1 to 3.9, 4.2 to 4.8, 7.8), the list's rows (2.8,
  5.1 to 5.5) and the four buttons by name (2.10). Built as drawn, about
  thirty of its 92 checks fail. So the strip stands over the list for
  now, and both are on the tab.
- **For him:** may the plan's acceptance probe follow the drawing (read
  the days from Open Days or Home's calendar, the phases from the strip
  and a press on a piece, and the buttons by their new names)? With
  that yes, the table, the list and the four buttons leave the tab.
- *Differs from the drawing:* the strip's part is named "To the exam,
  by phase", not "Phases to the exam": the acceptance probe finds the
  list by a part whose name begins "Phases", and found the strip
  instead (seven checks failed until the name changed; the probe was
  not touched). A piece is one line at a control height (32 px), the
  facts beside the name, where the drawing had two lines: the visual
  probe holds a button to the app's control heights. The cards'
  numbers are still the interface face (they are the kit's segmented
  cards; the drawing has them in the display face).
- *Checked:* `tests/probes/study-plan-tab-probe.mjs` (new, 13 of 13 on
  the built app, mouse and keys); `study-plan-acceptance.mjs` (92 of
  92); the keyboard audit on the plan tab and the New Plan sheet (0);
  the visual probe on Study's four screens (nothing found); Study's
  unit tests; the screenshot.

**Item 12, the look's piece 10: Flashcards' Decks and Stats. Done; its
Study row is still his to settle.**
- *What was there:* Decks was titled "Decks", with three small counts
  beside Study and Custom Study, a row of five buttons (New Deck, New
  Custom Deck, Generate Cards, Import Cards, Exam Dates) and a table of
  decks with three number columns. Stats had ten numbers of one size,
  four of them "Cards by stage", and two charts.
- *Decks, built:* the page's title is the day's work ("30 cards due
  today", or "Nothing due right now") in the display face, with the
  decks and cards counted in the mono face over it and the split in
  words under it ("About 15 min. 3 new, 6 learning, 21 to review."; the
  minutes come from his own pace over the last 30 days and are left
  out until 20 answers have been timed). At its right: Stats, Custom
  Study…, one Add menu holding the five making-and-importing actions,
  and the one primary button, Study N Cards. Each deck is a row: its
  name, its counts in words in the colours they have everywhere in the
  tool, one thin bar of new, learning and review (named for a screen
  reader), and Study with the number due. The bar's colours are named
  under the list. An empty shelf keeps "Decks" and its three ways to a
  first deck in the open.
- *Stats, built:* the title, then four numbers in the display face,
  each with its unit in words (reviews today, minutes today, days in a
  row, share right over 30 days), then the two bar charts with their
  totals, reviews done in the success colour and cards coming due in
  the accent. Cards by stage is off the page (each deck's row on Decks
  has it). The answer mix and the table by deck stay below.
- *Differs from the drawing:* a Stats button stays in the masthead (the
  drawing has none: the page must not be a dead end when the sidebar
  shows another tool's list). Custom decks keep their own three-number
  rows.
- **For him (his item 2):** the sidebar still has its Study row. The
  reason it was kept (the Decks page did not open on what is due) is
  gone; dropping it changes one unit test and one probe, and is a line.
- *Changed tests, none an acceptance probe:* `flashcardsBehavior.test.ts`
  held the Decks page's heading to the word "Decks" in three places;
  the heading is the day's work now, and the test holds it to that, to
  the line under it and to the four buttons of the masthead.
- *Checked:* `tests/probes/flashcards-pages-probe.mjs` (new, 15 of 15
  on the built app, on a deck made through Flashcards' own command);
  the keyboard audit on Flashcards (0); the visual probe (nothing
  rose; "no kit header" on its front page was there before); typecheck
  and the unit suite (9,933); the screenshots.
- *Not seen:* the page with learning and review cards due (the probe's
  deck has three new cards), the minutes line, a long list of decks.

**Item 13, the look's piece 9: Planner's three pages. The doubled
tabs, month and list of lists are off the page; the redrawing of each
page is not done.**
- *What was there:* since piece 2, Planner's sidebar list held Today,
  Calendar, Tasks with its six lists, the small month and the
  calendars, and the page still had its own copy of three of those:
  tabs across its head, a month beside Today, and the six lists as a
  column inside Tasks.
- *Built:* the page's tabs are gone; a page is chosen in the sidebar's
  list or by the command Planner: Show (palette, keys, the model), and
  New Event or New Task stays at the head's right. Today has no month
  of its own. Tasks is the chosen list in one reading column, titled
  with the list's name in the display face and its count under it (an
  empty Tasks page is titled too). No behaviour of capture, the Review
  Queue's day buttons, drag to create and move, or the shortcuts was
  touched.
- *Not built of the drawing:* the capture field as a lifted sheet, the
  schedule starting near now, events as chips in their calendar's
  colour; the Review Queue as a soft band and every task a 36 px row;
  Calendar's days as small sheets with today ringed in ink, and Month,
  Week, Day as one switch. Each is a redrawing of one page and wants
  its own session with the drag checks on the new cells.
- *A cost he agreed to, now real:* with another tool's list in the
  sidebar, Planner's pages are two presses apart (Planner in the tools,
  then the page) or one command. And Planner's list is long: in a 900
  px window its month is cut off above the two foot rows until the
  list is scrolled.
- *Checks changed because what they pressed is gone, none an acceptance
  probe and none to get a pass:* `column-lists-probe.mjs` read the
  page's lit tab and lit list (it reads the page shown and its title
  now, and gains a check that the page has no tabs, list of lists or
  month); `touch-drag-probe.mjs`, `ui-screenshot-probe.mjs` and
  `planner-probe.mjs` pressed a page tab to change page (they run
  Planner: Show); `scene-probe.mjs` listed the three tab ids among
  Planner's controls (it lists the sidebar's three rows). The keyboard
  audit reached Tasks and Calendar as sub-screens through the tabs, so
  the two are named in its list of screens now and are still audited.
- *Checked:* `tests/probes/planner-pages-probe.mjs` (new, 10 of 10 on
  the built app: each page reached by mouse and by keys from the
  sidebar, and by the command with another tool's list showing);
  `column-lists-probe.mjs` (no problem); the keyboard audit on Today,
  Tasks and Calendar (0); the visual probe on Planner (nothing found);
  the touch-drag probe (14 of 14, a planner event moved by finger);
  typecheck; the unit suite (9,933); the screenshots.
- *Left in the stylesheet:* the rules of the page's old month
  (`planner-today__month…`), now unused.

**Item 14, the look's piece 7: the PDF viewer (his 4A). Done.**
- *What was there:* a row of small controls across the top of the
  pane, and the page on the same ground as the rest of the app.
- *Built:* the ground is the window's recessed tone (`--px-window`), so
  the sheet stands off it with a deeper shadow; the page itself stays
  white, as its author made it. The controls are one pill floating at
  the foot of the pane, centred. They are still first in the pane's
  order, so Tab comes to them before the page. The last page scrolls
  clear of the pill; in a pane narrower than the pill, the pill scrolls
  inside itself and never passes the pane. Styles only
  (`pdf/pdfPill.css`); no control or behaviour changed.
- *Checked:* `tests/probes/pdf-viewer-probe.mjs` (new, 10 of 10 on the
  built app: the pill at the foot and centred, every control inside the
  pane, the ground darker than the paper in dark and in light, a focus
  ring by Tab, the zoom menu whole inside the window, Find clear of the
  pill, the end of the document clear of it, a 620 px window); the
  keyboard audit on the PDF and its reading view (0); typecheck; the
  ratchets; the screenshots.
- *Seen and left:* a menu opened from the pill opens upward over the
  pill's other controls (it has no room below). The outline and reading
  panels were not looked at with the pill.
- *Not checked:* a long PDF; a PDF beside a Study session (the pill is
  then centred in its own half).

**Item 15, the look's piece 3: menus, notices and the Settings dialog.
Menus, notices and the bell's list are restyled; Settings already was;
icons on the menu bar's entries are not chosen.**
- *What was there:* a menu was a square-cornered box of flush rows,
  its submenu mark the character "❯". A notice was already a lifted
  rounded sheet, with its kind as an icon in a tinted tile; the bell's
  list drew the same icons. Settings was already a wide rounded sheet
  (980 px) with its title in the display face: his 5B asks no more of
  it, and nothing was changed there.
- *Menus, built:* every menu (the menu bar's, context menus, a tool's)
  is a rounded sheet lifted off the window, its rows inset, rounded
  and at least 28 px, shortcuts in the mono face, a submenu marked by
  the chevron icon. This closes the one mark item 10 left.
- *Notices, built:* a notice's kind is one pigment dot (the success
  colour for done or told, the warning colour for a heads-up, the
  danger colour for failed); the bell's list draws the same dot and
  its time in the mono face.
- *Not built:* an icon on each entry of the menu bar. A menu shows an
  icon wherever its caller gives one (the page's and the tools' menus
  do); the menu bar's entries come from commands, seven of which name
  an icon. Which icon each of some sixty entries takes is a choice for
  him or a drawing, not a guess. "At most one action" on a notice is
  the caller's: nothing enforces it.
- *Decided, for him to overrule:* a plain "information" notice takes
  the success colour (the drawing's "viridian done"); the app has no
  separate kind for "done".
- *Seen and left:* notices stack at the window's bottom left, over the
  sidebar's two foot rows.
- *Checked:* `tests/probes/floating-parts-probe.mjs` (new, 16 of 16 on
  the built app: a menu opened and walked by keys, a context menu, a
  submenu's mark, three notices and the bell's list read back, the
  Settings sheet); the keyboard audit's first screen with its touch,
  popup and dialog passes (0, ten dialogs); the visual probe on the
  frame and Settings (nothing rose); typecheck; the unit suite.

**Item 16, the look's piece 5: chat (his 1A). The type is done; the
one meta line is not.**
- *What was there, against 1A:* his message is already a small bubble
  at the right, the answer already plain reading text, the question
  box already one lifted sheet, and sources already numbered marks.
  What differed: thought, source and speed were three lines in the
  interface face, and a source mark was a filled grey badge.
- *Built (styles only):* the thought line and the time-and-speed line
  are in the mono face, as meta; a numbered source mark is a small
  mono number in an outlined box in the accent's ink.
- *Not built:* thought, source and speed as ONE line. They are three
  controls today (the thought opens the reasoning, Sources Considered
  opens its list, the speed opens where the time went), each above or
  below the answer; making them one line is a change to how an answer
  is put together, with its tests, and wants its own session on his
  model. A mark still reads "[1]" with its brackets, not "1".
- *Checked:* `tests/probes/chat-look-probe.mjs` (new, 5 of 5 on the
  built app's seeded conversation; the thought line still opens by
  Enter); the keyboard audit on the three seeded chat screens (0); the
  visual probe on chat (nothing found); chat's unit tests and the
  ratchets.
- *Not seen:* a numbered source mark on screen (the seeded conversation
  has none; its rule was changed and is unseen), a streaming answer, a
  long answer. His verdict on chat on his own model is still owed
  ("Needs him or his machine").

**Item 17, the look's piece 6, second half: a .md file opens as a
page, and Edit shows the source beside the live page. Done; one
acceptance check needs his word.**
- *What was there:* a .md file opened as its text; a button on that
  text's toolbar opened a rendered preview beside it, which followed
  the typing. The parts existed, the other way round.
- *Built:* a `.md` or `.markdown` file opens as the page it describes
  (Explorer, Quick Open, a link, a tool's open). Its tab carries the
  file's name. The page's head has the file and its folder in the mono
  face, Edit Source, and More Actions. Edit Source (a button, and the
  command Markdown: Edit Source) opens the file's text beside the page;
  the page follows what is typed, before any save; asked again it
  brings the text forward and makes no second copy. The text's own
  toolbar keeps Open Preview to the Side.
- *Two things the page had to keep, found by the Study acceptance
  probe and built:* (1) a passage asked for (a citation, Study's Show
  Source) is brought into view and marked on the page: each block of
  the page knows the line of the file it starts on. (2) What a tool
  offers for the open file (Study This Document…) is offered on the
  page too: its head carries the editor's More Actions, asking as the
  file.
- **For him, an acceptance-probe correction (not made):**
  `study-usable-acceptance.mjs` 19.1 opens a .md and waits for the
  text editor (`.cm-content, .editor-pane textarea`) before it looks
  for Study This Document…; the file opens as its page now, so it
  stops there, and 19.2 (the .txt, unaffected) is "not reached" behind
  it. With the page accepted as the file's editor in that wait
  (`.markdown-content`), both run. The offer itself was driven on the
  page by `markdown-page-probe.mjs`. 18.3 (Show Source opens the .md
  at the passage) passes on the page; 6.3, which waited on him, passes.
- *Differs from the drawing:* the page is in the interface face, as
  the preview was; the drawing set it in the reading face. A page's
  own font setting does not reach a file.
- *Not done:* the Obsidian style (typing in the page itself), which he
  said to look at afterwards. `.mdx` still opens as text.
- *Will fail, not run here:* the e2e spec `03-file-editor.spec.ts`
  opens README.md and expects the text editor.
- *Checked:* `tests/probes/markdown-page-probe.mjs` (new, 10 of 10 on
  the built app, Edit Source by keys); the keyboard audit on a Markdown
  page, which is a new screen of the audit (0); `study-usable-acceptance`
  (57 of 59, the two above); `chat-suggested-file-probe` (a Markdown
  file open is still suggested to chat); typecheck; the unit suite
  (9,933); `docs/reference/commands.md` regenerated for the new
  command.

**Item 18, the look's piece 4: Home and Welcome as one page. Not
started: skipped, with the reason.**
- The order says this one "gets the bar read first", and the entry on
  Home says why it has missed twice: the bar is paperswithcode.co, and
  neither mock-up was drawn from the real pages because the cloud
  could not reach them. This run is in the same place: the site is
  refused by this environment's network (asked on 2026-11-26, the
  proxy answered 403). Building it from the drawing alone would be the
  third try made the same way.
- **For him:** either a session in the Default environment (which can
  read the site), or his screenshots of the pages he means. The Home
  source point and `api.home` are in the code and wait for it.

## Verification owed

Shipped work he has not yet judged, and measurements not yet taken.

- Re-measure on gemma4:31b at 64K, owed since 2026-11-09: the writing
  styles after the room change (words a reply, replies showing a thought),
  and the two knowledge cases (father, daughter, chef; the two strangers).
- His verdict in the app: Style Text and Start Custom From This; the
  per-character direction lists in Chat Settings; a generated sheet on
  Gemma and Qwen.

## Heard, not on the list

Recorded so they are not proposed again as new.

- **Extract To Table (GLiNER2.5):** "Not really sure how useful this one
  is." Off unless he brings it back.
- **Research Desk (Papers With Code inside Parallx):** "I like the idea,
  but not as a native." If it comes, it is an extension, never core.
  The pwc-cli SKILL.md could be loaded as a chat skill with no build.
- **Story tab writing style** (the Story tab uses no writing preset,
  only chats do): removed by him, 2026-11-10.
- **A trash for files, or one Trash for pages and files:** his own
  thought of 2026-11-09, removed by him, 2026-11-10. Files still go to
  the Recycle Bin on the same volume and are deleted in place on another.
- Music generation (ACE-Step 1.5, YuE2): not offered; next to the
  rejected soundscape round of 2026-09.
