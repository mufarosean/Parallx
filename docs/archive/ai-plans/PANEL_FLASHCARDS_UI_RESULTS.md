# Panel and Flashcards UI refinement

Completed 2026-09-08. The workbench layout and major destinations are preserved.

The Panel uses sentence-case tabs, a clearer selected state, and a compact
action row above the content. Clear, Restart, and Timestamps have visible
labels. Output timestamps recede behind the messages, warnings/errors have
an edge marker, and empty states use a small left-aligned explanation.

Flashcards' deck library now aligns New / Due / Cards in shared columns and
provides case-insensitive deck search with explicit no-match feedback. Deck
actions remain visible. At narrower widths the creation controls form a
deliberate row and deck actions wrap without squeezing names or counts.

The follow-up addresses the sidebar itself: compact section tabs replace
five stacked navigation rows, Today totals stay grouped, and Study is sized
to its label. The deck navigator has search and labelled New/Due columns.
Below 300px each name gets a separate line above its counts. Counts stay
visible on hover; New Deck and deck menus remain discoverable. Arrow keys,
Home, and End navigate the section tabs, and keyboard menu activation no
longer also triggers the parent deck row.

The study view retains white paper and serif content. On reveal, the question
contracts and the answer continues the same sheet. Rating controls stay
within reach, show their keyboard numbers, and allow the answer to scroll
fully above them. Notes, editing, Undo, scheduling, and existing navigation
remain on their established paths.

## Verification

- TypeScript and the production build passed in a separate code snapshot.
- 376 tests passed across Flashcards logic, behavior, imports, recall,
  container sizing, and workbench layout.
- The existing Flashcards navigation probe passed.
- A real Electron UI probe passed search/no-match/clear, responsive library,
  timestamp toggling, reveal, visible grading controls, keyboard grading,
  Undo, narrow answer scrolling, and empty output.
- Inspected actual captures at 1280×800 and 900×720, with light and dark
  tokens. Capture waits for a fresh compositor frame and finite animations.

All UI probes used newly generated app profiles and workspaces, with six
synthetic decks. The Flashcards extension was installed only in those test
profiles. Existing user workspaces and decks were not opened or copied.
Terminal execution was disabled by the fixture; its shell-error message in
the images is expected. This pass validates its chrome, not shell execution.
Browser and Workflows received no dedicated redesign. Problem Bank and
Worksheets were excluded from changes and fixtures.

## Review and reproduction

[Interactive before/after review](../../../test-results/agent-reliability/ui-review.html)

[Final run verdict](../../../test-results/agent-reliability/ui-panel-flashcards-DAqWHY/evidence/result.json)

[Compact sidebar](../../../test-results/agent-reliability/ui-panel-flashcards-DAqWHY/evidence/sidebar-compact.png)
and [wide sidebar](../../../test-results/agent-reliability/ui-panel-flashcards-DAqWHY/evidence/sidebar-wide.png).

[Harness commands](../../../tests/ui-polish/README.md)

The final build is `ui-code-jV9Fc1`, based on tracked revision `ec23de9c`
with the reviewed source overlaid. The original visual baseline is
`ui-panel-flashcards-1oMLeC`; its answer image was captured during reveal,
which is labelled in the comparison. Final screenshots and checks are in
`ui-panel-flashcards-DAqWHY`. This run also passed sidebar search/no-match,
keyboard tab and deck menu navigation, hover count visibility, and compact
and wide layout checks. The separate navigation probe passed again after
the sidebar changes. All of these are under
`test-results/agent-reliability/`. No shared build output was replaced.

## Study toolbar and notes — 2026-09-09

The study surface now uses a single column, up to 920px wide. Session mode,
progress, and card position share the toolbar with labelled Shuffle, Undo,
and Edit actions. Flags open from a labelled disclosure; Delete is in More
card actions. The custom-session label no longer occupies a separate strip.

Notes follow the answer and rating controls. Existing notes open on reveal;
empty notes stay collapsed as Add notes. The writing surface uses the page
background and grows with the text, capped at 220px. Notes remain hidden
before reveal, and autosave and keyboard grading are preserved.

25 Flashcards behavior tests and the navigation probe passed. The isolated
production build and Electron probe passed flag selection, the Delete menu,
toolbar/card alignment, notes placement and database persistence, grading
and Undo, and narrow scrolling with reachable rating controls. No existing
workspace or deck was opened.

[Study and notes](../../../test-results/agent-reliability/ui-panel-flashcards-7nJ3Pu/evidence/study-balanced.png)
· [Custom-session toolbar](../../../test-results/agent-reliability/ui-panel-flashcards-7nJ3Pu/evidence/study-custom-toolbar.png)
· [Run verdict](../../../test-results/agent-reliability/ui-panel-flashcards-7nJ3Pu/evidence/result.json)

Build snapshot: `ui-code-dHdQc4`.

## Pre-reveal flag crash — 2026-09-10

The new flag disclosure introduced a renderer crash. Clicking the empty
popup padding immediately above a swatch, while the question was still
showing, caused its synchronous focusout handler to collapse native details
during Chromium's focus transfer. Electron reported `reason: crashed` with
exit code `-2147483645`. This was reproduced twice in isolated profiles;
clicking above the trigger itself remained responsive.

Popup padding now preserves focus on mousedown, and focusout dismissal is
deferred until the focus transfer finishes. The deferred handler checks the
final active element and whether the disclosure is still connected.

The same real Electron regression script fails against the original build
and passes against the fixed build. The fixed run covers 40 pre-reveal
interactions, including the crashing padding coordinates, outside clicks,
swatch selection, Escape, and Tab. Answer reveal still works afterward.

[Original native crash](../../../test-results/agent-reliability/ui-flashcards-flag-5x7q0L/evidence/renderer-crash.json)
· [Fixed run verdict](../../../test-results/agent-reliability/ui-flashcards-flag-iENnx2/evidence/result.json)

Fixed build snapshot: `ui-code-gX6LIx`. All data was synthetic; no existing
profile or workspace was touched.

## Timer simplification — 2026-09-10

The running view no longer displays the budget form or its explanatory text.
Clicking a task's time value opens the editor; Save, Cancel, Escape, and Start
close it. The task header shows remaining time, with the estimated finish in
its tooltip. The redundant session number and empty task prompt were removed.

25 timer tests, TypeScript checking, and the isolated browser probe passed.
The probe verifies Planner task selection, budget editing, collapse after
Save and Start, and narrow layout. Screenshots were reviewed at 300px tall.

[Running timer](../../../test-results/ui-polish/timer-budget-N6vxXA/running.png)
· [Narrow timer](../../../test-results/ui-polish/timer-budget-N6vxXA/narrow.png)

## Minimal toolbar and rendered notes — 2026-09-10

Toolbar actions are icons with accessible names and hover descriptions.
Four flag circles are directly visible again; the flag disclosure and its
focus handling are removed. The shortcut footer is removed; keyboard
shortcuts remain operational.

Notes are a rendered document beneath the answer and ratings. Empty cards
offer + Add notes. The editor supports Markdown source, Preview, Save notes,
and Discard; saved notes render through the existing Markdown/KaTeX renderer.
There is no disclosure. Notes remain hidden until answer reveal.

The shared AI action drafts notes from the card and its stored source
excerpt through the configured model. Drafts can be edited, saved, or
discarded; existing notes are not overwritten automatically. Generation
results are ignored after cancellation or leaving the card. Model and
storage errors retain existing notes, and save failures retain the draft.
This is a Markdown/LaTeX document, not an embedded Canvas editor.

32 behavior/component tests passed, including the model bridge with a
deterministic reply (not a live model quality evaluation). Navigation and
the isolated production Electron probe passed. Electron verified icon-only
actions, direct flags, Markdown and KaTeX rendering, notes saved in the
database and restored after grading/Undo, and narrow/light/dark layouts.
The direct-circle regression probe also passed 40 pre-answer interactions
plus keyboard flag selection/clearing and subsequent answer reveal.

[Study and rendered notes](../../../test-results/agent-reliability/ui-panel-flashcards-7YmYyG/evidence/study-balanced.png)
· [Electron verdict](../../../test-results/agent-reliability/ui-panel-flashcards-7YmYyG/evidence/result.json)
· [Flag regression verdict](../../../test-results/agent-reliability/ui-flashcards-flag-bM6B7M/evidence/result.json)

Final build snapshot: `ui-code-4kj9DV`. The flag regression used
`ui-code-vBcmuE`, before switching the notes AI icon to the shared app button;
the flag implementation is identical. All test data and profiles were isolated.

## Reveal and Skip controls — 2026-09-10

Recognition cards now use a matched pair of 40×36px icon buttons: a card-turn
symbol for Reveal and skip-forward for Skip. Reveal retains the accent fill;
Skip uses the secondary outline. Accessible names, hover descriptions, and
Space/S shortcuts remain. Skip still moves the card without grading it.

27 behavior tests passed. The isolated Electron fixture checks equal button
dimensions, SVG-only contents, hover descriptions, and the usual reveal,
grade, Undo, notes persistence, and responsive study behavior.

[Updated controls](../../../test-results/agent-reliability/ui-panel-flashcards-J7svUs/evidence/study-front.png)

Build snapshot: `ui-code-ft09Z6`.
