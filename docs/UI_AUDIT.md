# UI Audit — 2026-10-01

Full pass over the running app: every activity-bar sidebar, every built-in
surface, all eight extensions in `ext/`, the bottom panel, settings and the
file viewers. 120 scenes, each captured in dark and light mode (Slate base,
Steel accent), with an automatic contrast check on every visible text node.
Read alongside `docs/POLISH.md` and `docs/ALPHA_UNIFICATION.md`; items those
charters already closed are not repeated here.

**Already fixed on `fix/light-mode-and-accent-contrast`:** the canvas was
white-on-white in light mode (290 hard-coded colours moved onto tokens), and
text on the accent failed contrast on every accent (now picked per accent,
all ≥ 4.5:1). Everything below is still open.

---

## How it was measured

- Real Electron app on a throwaway profile and workspace, every extension
  enabled, 1400×900 window, no Ollama (so AI surfaces show their offline
  state, which is itself a scene worth judging).
- Contrast: for each text node, the effective background is composited from
  its ancestors and the WCAG ratio computed; 4.5:1 for body text, 3:1 for
  large. Placeholders and `<kbd>` are reported separately.
- Static: per-file counts of raw colours, px font sizes, radii, and token use
  in `src/**/*.css` and the extensions' inline styles.
- Zero renderer errors across all 240 captures.

---

## 1. Systemic (fix once, fixes many screens)

| # | Finding | Evidence | Fix |
|---|---|---|---|
| S1 | **The faint-text token fails contrast in both modes.** `--px-text-faint` (`--px-base-40`) is 3.45:1 on the dark ground and 2.98:1 on the light one. It carries timestamps, hints, settings keys, the Welcome page's version/hints/recent paths, log times, flashcard stat labels, code-editor gutter and status items. | 337 of the 502 dark and 395 of the 729 light contrast failures are this one colour. Settings alone: 222 dark / 228 light. | Raise base-40 to ~`#81858e` in dark and lower it to ~`#6b717b` in light (both ≈ 4.5:1). One token, two lines in `src/theme/px-tokens.css`. Check the few places base-40 is used as a line rather than text. |
| S2 | **Accent used as text fails in light mode.** Links (`ollama.com`), the status-bar workspace name, markdown links in the code editor all draw `--px-accent` (60% lightness) on paper: 2.49:1. | 119 instances in light (links, status bar, markdown links). | Add `--px-accent-text` (accent at ~40% lightness in light mode, the accent itself in dark) and point link/status/inline-accent text at it. |
| S3 | **`<kbd>` chips are unreadable.** 1.79:1 dark, 1.67:1 light — the watermark's shortcut list, Welcome, menus. | 75 instances. | `kbd` text to `--px-text-secondary` on `--px-bg-inset`. |
| S4 | **Placeholders are ~2:1.** Every search box, "Ask a question…", "Search nodes…". | 63 dark / 117 light. | Placeholder colour to `--px-text-muted` (still visibly a placeholder at ~4.5:1). |
| S5 | **Explorer folder icons vanish in light mode.** The folder SVGs are hard-coded `fill="#ffffff" stroke="#ffffff"`. | `src/ui/fileTypeIcons.ts:119-122`; visible on every light screenshot. | `currentColor`. |
| S6 | **Off-scale type and radius values.** The type and radius tokens exist, but 191 px font sizes (≈20 distinct values incl. 8, 9.5, 11.5, 12.5) and 12 radius values are still hard-coded. Canvas has 77 of the px font sizes; media-organizer 16 distinct px sizes with 2 tokenised. | static counts | Sweep onto `--px-text-*` and `--px-radius-*`, canvas and media-organizer first. Add a font-size compliance test like the existing `fontCompliance.test.ts`. |
| S7 | **Uppercase tracked micro-labels survive in extensions.** POLISH pass 7 removed them from the core, but budget (INCOME, EXPENSES, BUDGET TOTAL…), flashcards stats (REVIEWS TODAY, RETENTION…), concept-lab's sidebar levels (two-line wrapped "1 · PROBABILITY & RANDOM VARIABLES"), media-organizer's section headers and the canvas sidebar's RECENT/PAGES still use them. | screenshots | Same rule as the core: `--px-text-sm`/600, secondary, no tracking. |
| S8 | **Internal commands leak into the palette and Keyboard Shortcuts.** Raw ids with no title sit beside titled commands: `dashboard.getWorkbenchWidgetHost`, `planner.getRegistry`, `chat.getSelectionActionDispatcher`, `aiSettings.manageAgents`, `ai-settings.scrollToSection`, `autonomy.replay`, `budget.reclassifyUntyped`. | command palette, Keyboard Shortcuts | Hide commands with no title (or mark API-only commands `internal`) from both lists. |
| S9 | **The panel toolbar does not wrap gracefully.** At editor widths under ~650px (chat open), the Autonomy Log toolbar breaks every label onto two lines ("No approved / patterns", "Pause / Autonomy", "Mark All / Read"). Workspace Graph's toolbar does the same and clips "Settings". | panel-autonomy-*, ext-workspace-graph | Icon-only with tooltips below a width, or overflow into a ⋯ menu. |

---

## 2. Core surfaces

### First run and shell
- **Crowded first screen.** Two activity bars (the right one holds only the chat mark), 13 unlabeled activity icons once extensions are on, the terminal panel open by default showing "Terminal ready", and six bottom tabs including developer tools (Indexing, AI Diagnostics, Output). The editor gets about half the window.
- **Chat waits forever without Ollama.** "Connecting to Ollama…" with a spinner, indefinitely. AI Diagnostics already knows the answer (Fail: Ollama Connection, No model selected); the chat should show that as a setup state with a next step. The composer's "No Model · Ctx: Default · 0%" reads as jargon.
- **Explorer shows the workspace twice** (section header and a root folder of the same name).
- **The browser extension creates `Downloads/` inside the user's workspace** (`electron/browserBridge.cjs:499`) on first run, before anything is downloaded.
- **Welcome** shows `v0.2.0` while `package.json` says `0.1.0`; the last AI Quick Start row sits under the panel.

### Canvas
- Fixed on the branch: light mode.
- **Properties block outweighs the page.** Tags/Created/Modified render at body size on every new page, above the content. The page name appears four times (tab, breadcrumb, sidebar, title).
- **"• Saved" and "Edited just now" side by side** say the same thing.
- **Code blocks have `padding: 0`** (`canvas.css` `.canvas-tiptap-editor pre`): a one-line block is a pill with text touching its edges.
- **Slash menu** order puts Database between Heading 1 and Heading 2, and the menu runs under the bottom panel instead of flipping upward.
- **Dead CSS:** `.drag-handle` (handles moved to BlockHandlesController) still ships with its data-URI icons.

### Dashboard
- Two primary CTAs at once on an empty dashboard ("+ Add widget" and "Add Your First Widget"), in different cases.
- Widget chrome is inconsistent: the clock has no card, the task list has a card; the task list's title is indented 18px further than its body.
- Widget picker: template cards run off the right edge with no scroll cue; "Templates" and "At a Glance" sections are indented differently; tile descriptions are 2.94:1 dark / 2.18:1 light; the section title 2.45:1.

### Planner
- New Task opens as a popover pinned to the top-left of the editor, over the menu bar, not centred and not anchored to Create.
- Fields inside the dialog are double-boxed (a bordered row around a bordered dropdown).
- Empty "A clear day" state is top-aligned small text with no action, unlike the dashboard's centred empty state with a button.
- The Calendar tab could not be reached by its visible label in the probe (click timed out) — worth a manual check that the tab is a real button.

### Worksheets
- Home shows "The bank is empty. Import a workbook to begin." as a headline next to an enabled **Start Quiz** button that has nothing to quiz.
- Seven same-weight navigation tiles; the sidebar is a plain text list with no icons, unlike every other sidebar.
- Each command opens a new tab (Worksheets, Dashboard, Problem Bank, Quizzes, Quiz, Settings) — six tabs for one tool.
- Settings uses native date inputs (`mm/dd/yyyy` with Chromium's calendar glyph) and 10px pill chips for days and decimals.

### Settings
- The General page's only setting is an internal rollback flag ("Enable the unified settings editor (M60 §3.8 rollback flag)") with its raw key.
- Every row shows its raw key (`settings.editor.enabled`) at 3.45/2.98:1 — 105 instances. Consider hiding keys unless searching.
- 20+ sections, 14 under AI; Providers says "Set the API key in AI Settings → Model → Providers" while the user is already in Settings › AI › Providers — two settings systems referring to each other.

### Workflow editor
- Header uses native-looking `Class`/`View` selects next to THE dropdown for Model — two dropdown styles in one toolbar (D2 in ALPHA_UNIFICATION covers this).
- Status is a filled green pill ("Ready, not enabled"), against the pass-7 rule that informational labels are ink.
- Coach card "Got It" and node kind label are ~2.7:1 in light.

### Bottom panel
- Logs (Output, Indexing, Activity) put timestamps in faint text (S1).
- Autonomy Log toolbar wraps (S9); the Patterns empty state is an italic paragraph rather than the shared `.px-empty`.

---

## 3. Extensions

| Extension | State | Findings |
|---|---|---|
| **Budget** | Solid structure, oldest styling | **Bug:** palette deep links (`budget.openCashFlow`, `openRecurring`, `openReconcile`, `openReports`, `openCategories`, `openRules`…) do nothing once the Plan or Settings tab is already open. `_navState.planTab/settingsTab` is only read when the wrapper first renders (`ext/budget/main.js:10029`); a reused editor never re-reads it. Uppercase tracked card labels; monospace money; 3-card overview grid leaves a hole; "Last sync 3/31/2026" on a profile that never synced. 18 references to the old purple (`#9333ea` / `139,92,246`). 349 raw colours (mostly category palette data, per ALPHA_UNIFICATION). Open-editor rows use the generic file icon. 29 light-mode contrast failures. |
| **Browser** | Good | New tab, bookmarks, history and shields read well. Small page titles; Shields' three buttons are tiny. Creates `Downloads/` in the workspace (above). 8 light-mode failures (faint captions). |
| **Concept Lab** | Good | Fully tokenised. Sidebar level headers are uppercase tracked and wrap to two lines; guide title 2.91:1. |
| **Creations AI** | Good, naming drift | The tool is "Creations AI" in the sidebar and home page but its tab is "Text Generator" and its commands are `textGenerator.*`. Emoji in a system label ("User message ✍️", `main.js:8310`) despite the no-emoji rule. Model dropdown truncates to "No Models Av…". Mode chip "From A Concept" 2.33:1 in light. |
| **Flashcards** | Best in class | 108 token font sizes, 0 px. Stats page uses uppercase tracked labels at 3.45/2.98:1. The "Generate Cards" AI button label is 2.2:1 in light. |
| **Media Organizer** | Largest, least unified | Practice Session, Daily Study and Painting Plans commands just show the Library plus a toast ("Turn on Drawing And Painting Tools in Media Organizer settings first.") — a command that cannot run should not be listed, or should open the setting. Title Case applied to a sentence in that toast. Sidebar: "Duplicates" row clipped under the Folders header; four section-header styles (with icon, without, different indents). 645 `--vscode-` references, 2 token font sizes, 117 white literals. |
| **Web Research** | No UI | Settings only. |
| **Workspace Graph** | Weakest | Toolbar of seven tiny buttons wraps to three lines and clips "Settings"; graph nodes are unlabeled dots at rest; the legend is hard-coded `rgba(30,30,30,.85)` (`main.js:1970`) and stays dark in light mode. Inline-style era (ALPHA_UNIFICATION D1 lists it as a cut candidate). |

---

## 4. Platform

- **The app does not start on Linux or macOS.** `electron/main.cjs:650` calls `mainWindow.setAppDetails` (Windows-only API) and `setIcon` with a `.ico`, both unguarded; the first throws inside `createWindow` and no window is ever shown. Guard both with `process.platform === 'win32'`. (The audit ran with a local stub.)

---

## 5. Suggested order

1. **One-token fixes (an afternoon):** S1 faint text, S2 accent-as-text, S3 kbd, S4 placeholders, S5 folder icons. Together they account for 95% of the measured contrast failures in dark mode and 97% in light.
2. **Bugs:** budget deep links; media-organizer commands that can't run; `Downloads/` creation; Linux/macOS launch guard; hide untitled internal commands (S8).
3. **Consistency sweep:** S6 and S7 across budget, media-organizer, concept-lab, flashcards stats, canvas sidebar; Creations AI naming; worksheet tab sprawl.
4. **Design decisions (mock up first):** first-run shell (#2 Shell), chat's offline state, canvas page header and Properties, settings structure, Workspace Graph's future (ALPHA_UNIFICATION D1).
