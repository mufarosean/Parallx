# CAS / Pearson VUE Exam Spreadsheet Environment

**Status: RESEARCH ONLY — nothing scheduled.** Captured 2026-07-27 while exploring
whether Parallx could host an exam-faithful practice surface for the CAS Exam 7
restudy. Documented for a future decision; no milestone attached.

## What it is

CAS upper-level exams (5, 6, 7, 8, 9 — plus MAS-I/II and PCPA item samples) are
delivered at Pearson VUE test centers on Pearson's **Athena** test driver. All
calculation work and answer entry for constructed-response items happens in a
**spreadsheet embedded inside the test item interface** — not a standalone app.
The test driver owns saving and response state.

The spreadsheet component was significantly upgraded for the **April/May 2024
sitting**: a full Excel-style ribbon replaced the earlier stripped-down grid that
candidates complained about.

## Interface anatomy (from live captures, 2026-07-27)

Screenshots in `assets/cas-pearson/` — taken headlessly from the public
Sample Item Types Demo (no login required):

- `pearson_sheet_item5.png` — a real Spreadsheet item (Exam 5 credibility-weighted
  rate change; identical item type appears on Exam 7). Shows the full anatomy.
- `pearson_navigator.png` — the Navigator dialog listing all demo items with type,
  point value, and seen/unseen status.
- `pearson_demo_2.png` — a Multiple Selection item showing the general exam chrome.
- `cas_spreadsheet.pdf` — the CAS's official functionality doc (their annotated
  screenshot + feature list).

Anatomy of a Spreadsheet item:

- **Exam shell chrome**: title bar + item counter ("5 of 25"); tools row with
  Symbol palette, Highlight (yellow), Strikethrough, basic Calculator; Flag for
  Review; bottom bar with End Exam, Previous/Next, Navigator. Constructed-response
  items add **Explain Answer** and **Scratch Pad** buttons above the question.
- **Question text sits above the grid**; the givens are pre-populated *inside*
  the sheet (e.g. "Prior Rate Review" block, normal-distribution lookup table),
  with a heavy border fencing the given-data region from the working area.
- **Ribbon tabs**: HOME / INSERT / FORMULAS / DATA / VIEW.
  - HOME: **Reset Sheet** (restores the item's original state; guarded by a
    confirm; cannot be undone), Undo/Redo, clipboard w/ paste options, fonts
    (default **Aptos Narrow 11**), alignment incl. Wrap Text + Merge & Center,
    number formatting (%, comma, decimals), conditional formatting / table
    formatting / cell styles, insert-delete-format cells, Editing group (Sum,
    Fill, Clear, Sort & Filter, Find).
  - INSERT: tables, **charts** (column/line/bar/pie/area/scatter/radar/funnel +
    sparklines), shapes/lines.
  - FORMULAS: categorized function library (AutoSum, Financial, Logical,
    DateTime, Lookup/Ref, Math & Trig, Statistical, Engineering, Information,
    Database) + formula auditing.
  - DATA: sort & filter, data tools, outline.
  - VIEW: show/hide headers/gridlines, zoom presets, freeze panes.
- **Name box + real formula bar** with an `fx` insert-function dialog
  (tooltips give syntax; there is no searchable help library).

## Constraints that matter for practice fidelity

- **Grid size: ~150 rows × 40 columns per item.** The public blank practice
  sheet has 500 rows so multiple items can be worked in one sheet.
- **One worksheet per item** — no workbook, no tabs, no cross-sheet references.
- **No File menu** — no import/export, no save; the driver persists state.
- **No macros/VBA, no add-ins.**
- **Function coverage ≈ Excel 2016.** Nearly all Excel 2016 functions work;
  a handful of obscure ones and newer functions (e.g. `XMATCH`) do not. The
  authoritative list is Pearson's "Athena Spreadsheet Function Comparison" XLSX
  (link below). Exam items that expect a specific function provide usage
  instructions or input/output definitions.
- MAS-I/II (multiple choice) get **one blank scratch spreadsheet** for the whole
  sitting rather than per-item sheets.

## Resources

- Demo launcher (public, no login): Pearson VUE CAS page → "Sample Item Types Demo"
  — https://www.pearsonvue.com/us/en/cas.html
  (redirect: https://www.pearsonvue.com/us/en/redirects/cas/sample-exam/new-item-type.html)
  The demo has 25 items incl. **six Spreadsheet items and a Blank Spreadsheet**
  (items 5, 10, 14, 19, 20, 23, 25 at capture time).
- Supported function list (XLSX):
  https://www.pearsonvue.com/content/dam/VUE/vue/en/documents/clients/cas/Athena-Spreadsheet-Function-Comparison.xlsx
- CAS functionality doc (PDF, local copy in assets):
  https://www.casact.org/sites/default/files/2024-04/New_Spreadsheet_Functionality_for_CAS_Exams_at_Pearson_Vue.pdf
- CAS sample questions page: https://www.casact.org/exams-admissions/resources/pearson-sample-questions
- Item-type FAQ: https://www.casact.org/sites/default/files/2024-03/CAS_Exam_New_Item_Types_FAQ_03_2024.pdf
- Tutorial videos: CBT tutorial https://www.youtube.com/watch?v=KDiH0kGKxXo ·
  written response https://www.youtube.com/watch?v=bV-a23whiqY

## Capture method (reproducible)

Headless Playwright Chromium (repo devDependency) → demo redirect URL →
`waitUntil: 'domcontentloaded'` (the page never reaches network-idle) → the
Navigator dialog ("select a question to go to it") navigates by clicking the
item's `td`; sequential Next-walking stalls at item 4. Sheet content does NOT
appear in DOM innerText (canvas/custom rendering) — detect items via the
Navigator, not text sniffing.

## Parallx idea (unscheduled)

An exam-faithful practice surface: bounded 150×40 grid, Excel-2016-era function
subset (validate against the Athena XLSX), single sheet per question, Reset-sheet
semantics, givens pre-populated with a fenced work area — wired to the planner
(study sessions) and flashcards (post-question review). Value proposition:
practicing Exam 7 calcs under the real tool's constraints instead of desktop
Excel muscle memory. **Deliberately not committed** — revisit when the Exam 7
study workflow demands it.
