# Panel and Flashcards visual checks

Run from the repository root using installed dependencies:

```powershell
node tests/ui-polish/prepare.mjs
node tests/ui-polish/probe.mjs
node ext/flashcards/test/run-navigation-probe.mjs
```

For this session's retained baseline, `node tests/ui-polish/review.mjs`
generates an interactive before/after page at
`test-results/agent-reliability/ui-review.html`. It requires the original
baseline artifacts; the main probe does not.

Preparation archives the current tracked source into a new code snapshot,
overlays the UI files under review, and builds there. It does not rebuild the
shared checkout. Each probe creates a new owned app profile and workspace,
installs only the repository's Flashcards extension into that profile, and
seeds six synthetic decks through its real database bridge. No user profile,
decks, or workspace contents are copied. Inference and terminal execution are
not needed; the shared isolation guard disables unrelated capabilities.

The probe enables Flashcards in the new profile and reloads after database
seeding so the cached sidebar also reads the fixture. Sidebar checks cover
search, no-match feedback, keyboard tabs, keyboard deck menus, counts on
hover, and narrow/wide layouts. Native captures include the actual sidebar
at 202px and approximately 792px widths.

The probe uses production views and services. It checks deck filtering and
no-match feedback, responsive layout, timestamp toggling, reveal, visible
rating controls, keyboard grading, Undo, and scrolling the end of an answer
above its controls. Screenshots cover dark/light tokens and 1280×800 / 900×720
windows. A successful run writes `evidence/result.json` beside its images.
The study checks also cover the four direct flag circles, icon-only actions,
matching icon-only Reveal/Skip controls with hover descriptions,
the card actions menu, notes hidden before reveal, Add notes, explicit saving,
Markdown and KaTeX rendering, and notes restored after grading and Undo.
Additional 1280×1000 captures
show the complete study column and custom-session toolbar.

Artifacts and the `ui-prepared.json` build pointer live under
`test-results/agent-reliability/`, reusing the existing owned-root launcher.
Failed attempts remain available. The hidden Electron capture warms the
compositor and waits for frames and finite animations before saving, avoiding
the stale images returned by a single capture of a hidden window.

Terminal commands are disabled in this fixture; its startup message is a
fixture limitation. These tests verify the terminal's shared chrome, not shell
execution. There are no Problem Bank or Worksheet fixtures or changes.

## Chat table layout

Run `node tests/ui-polish/chat-tables.mjs` for a focused browser check using
the production chat renderer and stylesheet. It verifies prose comparisons
at 920px and 320px, long inline code, explicit column alignment, and scrolling
to the final column of a wide numeric table. Each run saves before/after
screenshots and a verdict under `test-results/ui-polish/chat-tables-*`.
It uses a fresh browser context with network access blocked and opens no
app workspace or profile. The before image uses the stylesheet from HEAD.

## Timer task budgets

Run `node tests/ui-polish/timer-budget.mjs` to mount the production timer
with synthetic Planner tasks in a fresh browser context. It checks task
search, explicit selection, budget editing, and narrow layout, and verifies
that calendar events are never requested. Screenshots are retained under
`test-results/ui-polish/timer-budget-*`; no existing workspace is opened.

Run `node node_modules/vitest/vitest.mjs run tests/unit/timerWidgetLogic.test.ts tests/unit/timerWidgetBudget.test.ts`
for arithmetic, budget limits, pause/resume/reload, task switching, settings
changes during an interval, and retention of previous calendar imports.
Budgets include focus and break time; pauses and gaps between intervals do
not consume them. The final interval is shortened to fit. Reaching a budget
stops the timer without marking the Planner task done. Old calendar entries
remain stored for history but are excluded from the task queue; an already
running calendar interval can finish before the timer switches away from it.

Budget editing is hidden until the time value on a task is clicked. Saving,
Cancel, Escape, or starting the timer closes it. The focused browser check
also captures the running view at 300px tall and checks a 320px-wide widget.

## Flag interaction crash regression

After `node tests/ui-polish/prepare.mjs`, run
`node tests/ui-polish/flashcards-flag.mjs`. It launches a fresh isolated
Electron profile with one synthetic card. Before revealing the answer, it
repeats clicks above, beside, below, and on the flag circles, plus Escape and
Tab navigation (40 interactions total). It verifies keyboard flag selection
and clearing in the database, renderer responsiveness, then answer reveal. Native
renderer failures and click coordinates are retained in the run's evidence
directory; a watchdog bounds hangs after a renderer crash.

`PARALLX_FLAG_CODE_ROOT` can select a retained build snapshot for comparison.
The harness also supports the previous disclosure UI: the original
`ui-code-dHdQc4` crashes on the first above-swatch padding click, while the
fixed `ui-code-gX6LIx` passes. Current code exposes circles directly and no
longer has that disclosure or its focusout handler. No user workspace is loaded.

## Study notes drafts

Run `node node_modules/vitest/vitest.mjs run tests/unit/flashcardsStudyNotes.test.ts tests/unit/flashcardsBehavior.test.ts`.
The component checks saving, preview, discard, AI draft acceptance, cancelled
and detached requests, and model/storage failures. The model bridge test uses
a deterministic reply to verify grounded context and Markdown/LaTeX preservation;
it is not a live model quality evaluation. The Electron probe above verifies
the actual rendered Markdown and KaTeX and persistence through grade/Undo.
