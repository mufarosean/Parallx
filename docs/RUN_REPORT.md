# Overnight Run Report: Polish Iterations

Branch: `fix/light-mode-and-accent-contrast` (pushed, no PR opened).
Companion documents:
- `docs/UI_AUDIT.md`: the original findings.
- `docs/DESIGN_UNIFICATION.md`: the charter for placement, busyness and extension governance.
- `docs/LAUNCH_READINESS.md`: audience, positioning, and what must be true to not fail at launch.

Screenshots: `docs/run-report/`.
- `after-dark/` and `after-light/`: the final build, the same 12 screens in each mode:
  - Welcome
  - a Canvas page with tags
  - the File and Tools menus
  - the activity-bar menu
  - Chat with no AI configured
  - Dashboard
  - Planner
  - Flashcards
  - Budget's first run
  - Settings → Appearance
  - Tools
- `before/`: the same harness on the first audit, for comparison.

## The Short Version

I audited the whole running app: 120 scenes, each in dark and light mode, every extension switched on. Then I fixed, re-audited and fixed again: 18 fix commits and five full audits. Every number below comes from the same automated harness on the same 120 scenes, so before and after are directly comparable.

| Measure | Start | After iter 2 | Final | |
|---|---|---|---|---|
| Text failing WCAG contrast, dark | 502 | 103 | **3** | 2 are disabled buttons (exempt under WCAG); 1 is a 4.26:1 near-miss |
| …of which below 3:1 | 156 | 14 | 2 | both disabled buttons |
| Text failing WCAG contrast, light | 729 | 153 | **13** | 2 disabled; the rest 3.9–4.47:1 near-misses, 3 of them code-editor syntax colours |
| …of which below 3:1 | 682 | 24 | 2 | both disabled buttons |
| Distinct rendered font sizes | 25 | 16 | 16 | all chrome text is on the 7-step scale; the rest are document content (canvas headings, code editor), hero numbers and glyphs |
| Distinct button heights | 16 | 13 | 5 | |
| Buttons on the 22/24/28/32 ladder | 46% | 74% | 99% | the one exception is the tab bar's scroll arrow, which is full bar height |
| Text rendered in ALL CAPS (CSS) | 590 | 0 | 0 | plus the JS-uppercased panel titles, now gone |
| Renderer errors across 240 captures | 0 | 0 | 0 | |
| Unit tests | 6 failing | same | same 6 | identical on the commit before this branch (verified in a clean worktree): a perf-timing test, a rounding test, two date-dependent web-research tests, and `moAiTagging` (its harness references a helper, `moTagAncestorIds`, that it doesn't load). Not caused or touched by this work. |

## What Changed, Iteration by Iteration

**Iteration 0: your two asks** (`cb8cc97`)
- The canvas was white-on-white in light mode: 290 hard-coded white-alpha colours moved onto text tokens.
- Text on the accent colour is now picked per accent, so it is ≥ 4.5:1 on all of them.

**Iteration 1: tokens and dead ends** (`b362752`)
- The faint-text token was the single biggest contrast failure (two-thirds of all failures). It was raised to AA in every palette.
- New `--px-accent-text` for links and accent-coloured words. Light-mode signal colours were darkened to AA. Placeholders were unified.
- **The app now launches on Linux and macOS.** It crashed on Windows-only calls (`setAppDetails`, the `.ico`).
- Removed five dead ends:
  - Budget deep links did nothing when Budget was already open.
  - Media Organizer's AI tagging gate had no way to turn it on.
  - Commands without a title rendered as blank menu rows.
  - The browser created a Downloads folder just by being looked at.
  - An empty Worksheets bank had no primary action.

**Iterations 2–4: one look** (`8ef477c`)
- **One button system:**
  - 22 button classes normalized to the 22/24/28/32 height ladder.
  - A shared kit (`.px-btn` with primary, secondary, ghost, danger, small and icon variants).
  - Primary buttons limited to one per surface.
- **One type scale:** 104 hard-coded font sizes mapped onto the seven tokens (10/11/12/13/15/18/22).
- **No shouting:** 109 uppercase rules removed and emoji removed from labels.
- **Calmer layout:**
  - The bottom panel is hidden by default.
  - A single-root Explorer no longer shows a redundant root row.
  - Tool Gallery rows dropped their version, publisher and badge clutter; required tools have no toggle.
  - Dashboard templates live in the grid instead of a separate picker.
  - Chat no longer spins forever without Ollama: after 6 seconds it says so and offers AI Settings.
- **Governance, so extensions stop inventing their own style:**
  - `api.ui.createButton`, `createIconButton`, `createPageHeader` (it enforces one primary and two secondary actions, and moves the rest into ⋯), `createEmptyState` and `createSectionLabel`.
  - The extension authoring guide was rewritten around the kit.
  - **A ratchet test:** each extension's count of raw colours, px font sizes, caps, emoji, native `confirm()`, native `<select>` and the retired purple may only go down.

**Iteration 5: menus as one system** (`b0c53a8`). See "Menus" below.

**Iteration 6** (`22065d6`)
- Budget's three heading styles became one.
- Sync and Refresh no longer share an icon.
- One label for Export as Markdown.
- The launch-readiness review.

**Iteration 7** (`f3b7308`)
- Panel titles show "Canvas", not "CANVAS", in one size and colour.
- **Canvas properties are aligned:** tag values started 7px left of the date values, and now all start on one line (measured, not eyeballed).
- Tag chips no longer vanish in light mode.
- The command-center hint uses the same shortcut format as menus.
- "Add to/Remove from Favorites" is worded the same in both page menus.

**Iteration 8** (`8f10ac5`): the last real contrast failures.
- Search toggles, Keyboard Shortcuts ids and Budget's status pills.
- Flashcards' "Exam Dates" is hidden until a deck exists, instead of sitting disabled.

**Iteration 9** (`5928561`): the last controls off the height ladder.
- Settings nav, Planner rows, the Light/Dark switch, notification actions and autonomy log chips.

**Iteration 10: a launch blocker** (`0036b79`)
- Chat decided "offline" by asking Ollama alone. A user who set up Claude and never installed Ollama saw "Ollama isn't running" with the **input disabled**.
- Availability now counts every provider, and re-checks every 5s while nothing is usable, so saving a key unblocks chat without a restart.
- Covered by unit tests. I could not try it with a real Claude key in this environment.

**Iterations 11–15: from looking at the final screenshots**

The numbers were nearly clean by now, so I reviewed every final screen by eye, the way a new user would see it. That found more than the metrics did.
- **Budget told new users they had synced on 3/31/2026** (`ee38ca1`). A one-off repair migration for one ledger set a sync cursor in *every* workspace. That fake cursor:
  - showed a sync that never happened;
  - made the first sync ignore the user's `syncStartDays`/`syncStartDate` settings;
  - **hid Budget's own "Set up in three steps" welcome card from every new user.**

  A new migration removes the cursor only where Budget has provably never run. I checked it against the real migration chain in three scenarios. The welcome card now shows (`0d6cd33`), with one primary action.
- **The tag field lost the cursor after each tag** (`6ff71e1`). After adding one tag, typing went to the page body. Fixed, with a regression test that fails on the old code. Uncoloured tags were also invisible in light mode.
- **Dashboard** (`95f397c`): new widgets fill the first free spot instead of stacking in one column.
- **Welcome** (`58e34c0`): Start links use the menu names ("New Page"). The redundant tip became one honest line: your pages are saved in this workspace folder, on your computer.
- **Iteration 11** (`63e0cc8`):
  - A legacy duplicate CSS rule dimmed the search toggles to 3.1:1.
  - The Flashcards "Decks" breadcrumb repeated the "Decks" heading.
  - The Autonomy Log summary was cut to "No a…"; it now hides when there's no room.
  - "Reveal in File Explorer" became "Reveal in Finder" / "Open Containing Folder" on Mac and Linux.
- **Iteration 12** (`5a3a7c2`):
  - Each tool shows its own icon, instead of 20 identical boxes.
  - The empty-editor watermark uses the menu vocabulary and the shared shortcut formatter (it pointed at a command that doesn't exist).
  - Settings buttons are in Title Case.
- Planner's task list labels are left-aligned; a `<button>` had centred them.
- **The app now ships its own typeface** (`f34276a`). Inter was the default font in Appearance and first in every font stack, but it was never bundled, so most people saw Segoe UI, the Mac system font or DejaVu. It's now vendored (OFL, ~270 KB). Verified rendering as Inter by measurement, not by eye.
- **Dashboard in a narrow pane** (`0eda647`). With Chat open, widgets were ~170px wide and a note wrapped one letter per line. Below 640px, widgets now take the full row.

## Menus: Treated as One System

I opened every menu in the app (title bar, submenus, and right-click on files, folders, empty space, text, tabs, activity bar, status bar, panel tabs and Canvas pages) and judged them as a set rather than one by one.

**What was wrong:**
1. **An empty menu.** "Selection" opened to nothing.
2. **Menus that only repeated the palette.** "Go" had two items, both available elsewhere. "Help" offered "Show All Commands".
3. **A menu with one item.** "Tools" held only "Tool Gallery", while Planner, Dashboard and Worksheets had no menu home.
4. **No New Page in File**, in a notes app.
5. **Three names for the same areas:** Sidebar, Panel and Auxiliary Bar, versus the Left, Bottom and Right areas in the layout buttons.
6. **Four ways of writing shortcuts:** `Ctrl+k s`, `Alt+f4`, `Ctrl + ⇧ + P`, with modifiers in any order.
7. **The activity bar had no right-click menu**, so 14 icons could not be trimmed.
8. **The Manage (gear) menu linked to things that don't exist** (Profiles, Extensions, Tasks, Check for Updates).
9. **Labels mixed sentence and Title Case** ("Paste as plain text" next to "Select All").

**What it is now:**
- File, Edit, View, Tools, Help.
  - File starts with New Page.
  - Tools lists Planner, Dashboard, Worksheets and Manage Tools….
  - Help has Welcome, Command Palette… and Keyboard Shortcuts.
- View uses one vocabulary: Toggle Left / Bottom / Right Area, Maximize Bottom Area.
- One shortcut formatter is used everywhere (menus, palette, title bar):
  - `Ctrl+K S`, `Alt+F4`, `Ctrl+Shift+P`;
  - modifiers always in the order Ctrl, Shift, Alt, Win;
  - Mac glyphs on a Mac.
  - Covered by `tests/unit/keybindingDisplay.test.ts`.
- **Right-click the activity bar** to hide an icon or bring them all back. The choice persists. Verified in the app: 14 → 13 visible, still 13 after reload.
- The gear only lists things that open something.
- Title Case for every menu label.

**Systems principle for later menu work:** every command has exactly one *home* menu, chosen by what it acts on:
- File for documents and workspaces;
- Edit for the current selection;
- View for layout;
- Tools for tools.

Every other surface (palette, right-click, ⋯) is a *shortcut* to that home, using the same label and the same shortcut text. A new command that doesn't fit one of the five homes is a sign it belongs inside a tool, not in the menu bar.

## Things I Checked and Found Were Not Problems

I checked each of these three times, because the user asked for exactly that:
- *"Dedup and coverage misuse the AI mark."* They genuinely call the AI. Kept.
- *"Insert Column Right uses the eraser icon."* It uses arrow-right. The audit misread a crop.
- *"A tooltip gets stuck."* It's an artefact of the harness's static mouse; real hover clears it.
- *"Saved appears twice."* The first one fades after 1.5s.
- *"Exam Dates and Create environment fail contrast."* Both were disabled, and WCAG exempts disabled controls. I still hid Exam Dates when there is nothing to date.
- *"Canvas sidebar right-click is empty."* It uses its own popup, which works.
- *"Typing created a page called Tags."* No: the first tag on a page creates a workspace "Tags" database by design. The real bug nearby was the lost cursor, which is fixed.
- *"A single-root Explorer still shows the root row."* That row is the section header naming the folder, as in VS Code. The folder's own row is hidden.
- *"Budget, Creations AI and others clutter the default install."* They don't: extensions are **off by default**. This corrected my own first draft of the launch review.

## Decisions Left to You

I didn't make these, because they change what the product is rather than how it looks:
- **D1: the default tool set.** I recommend turning Flashcards on by default; it is the core of the study pitch and is currently off. See LAUNCH_READINESS §3.2.
- **D5: one home for Flashcards' and Planner's tabs.** Today they show in both the sidebar and the editor.
- **Ctrl+N.** It means New Text File globally and New Page inside Canvas. For a notes product, it should be New Page everywhere.
- **The version number.** Help shows the API version (v0.2.0); package.json says 0.1.0.
- **The right-edge activity bar** holds only Chat. Either move Chat's icon to the left bar, or give the right bar a purpose.
- **Budget's Gmail filter** defaults to `from:chase.com`.
- **What "Tools" lists.** It shows 20 enabled tools, including infrastructure (Output, Indexing, Diagnostics, Autonomy Log, Settings, Welcome). A user-facing list would show the things people choose to use, with the plumbing in a collapsed group.

## What Is Still Open (Known, Not Fixed)

- **Near-misses at 3.9–4.47:1** in light mode, which come from compositing (opacity or tinted parents) on a few chips and labels rather than from a token, plus CodeMirror's syntax colours. Each needs a look of its own; the syntax theme deserves its own pass.
- **Not every extension header is on `api.ui.createPageHeader` yet.** The ratchet stops new drift; migration happens as each one is touched.
- **Chat's model and connection state should move to the status bar.**
- **An existing e2e test** (`tests/e2e/93-activity-journal.spec.ts`) types "Toggle Sidebar" into the palette. That command was renamed "Toggle Left Area" before this branch, so the test needs updating. I didn't run the e2e suite.

## How to Reproduce the Numbers

```
node scripts/build.mjs
cd test-results/audit && ./runall.sh <tag>      # 120 scenes × dark/light + design probe
python3 metrics.py out-design out-<tag>-design   # buttons, type, caps
```
The harness (`test-results/audit/*.mjs`) is uncommitted scaffolding, since test-results is gitignored. The numbers it produced, and the screenshots, are in this report.
