# Parallx duplication audit: one concept, many implementations

> Part of the 2026-10-03 whole-app audit. What was fixed after this report was written is listed in [`docs/APP_AUDIT_2026-10-03.md`](../../APP_AUDIT_2026-10-03.md) §1; read that first. Paths under a `scratchpad/` folder (probe scripts, screenshots) belonged to the audit session and were not kept.

Audited 2026-10-03 against the working tree of `fix/light-mode-and-accent-contrast` (HEAD `b98427ef`). Nothing in the repo was edited. Every count below comes from `rg`/`grep` over `src/`, `ext/` and `electron/`, and every behaviour difference was checked by reading the code.

> **Tooling note for the next auditor.** `rg PATTERN src ext` silently drops every `ext/` hit in this repo, because the root `.gitignore` has `*.js` with a `!ext/**/*.js` negation. `rg PATTERN ext src` works. The safest form is `rg --no-ignore-vcs PATTERN src ext electron`. All counts here were taken with `--no-ignore-vcs`.

Sizes in "Consolidate" are **S** (≤1 day, mechanical), **M** (a few days, touches several features) and **L** (a milestone).

---

## 0. The structural causes (read this first)

1. **The extension API is narrower than the core kit.** `api.ui` now offers 12 functions (`rafThrottle, createDropdown, renderMarkdown, createAiButton, showContextMenu, createButton, createIconButton, createPageHeader, createEmptyState, createSectionLabel, createFilterChip, createSegmented`; `src/api/apiFactory.ts:577-631`). DESIGN_UNIFICATION's "5" is out of date. Several things are still missing from it:
   - toggle, slider, tabs, input/search, progress, badge, card, tree/row, modal, toast-with-action and popover-dismiss;
   - formatting (relative time, dates, durations, bytes, money, tokens, plurals);
   - an event emitter and the user's time zone;
   - settings-panel registration;
   - LM abort, timeout and priority, and model-JSON parsing.

   Every gap shows up as a hand-rolled copy in `ext/`.
2. **Built-ins re-type the API by hand.** `src/built-in/**` has **33** local `interface ParallxApi {…}`-style slices (for example `canvas/main.ts:42`, `planner/main.ts:34`, `worksheet/main.ts:125`, `dashboard/main.ts:43`) instead of importing `ParallxApiObject`. Built-ins therefore cannot see what `api.ui` offers, and they copy the same helpers the extensions copy.
3. **Fixes land in one copy.** Most of the copies below are not just stylistic. A bug fixed in the canonical version is still live in the others:
   - calendar-day "yesterday" and SQLite-UTC parsing;
   - the money guard and the `aligned`/`cases` fixes in math rendering;
   - the first-chunk leash in the LM stall watchdog;
   - stripping `<think>` before parsing model JSON;
   - the durable layer behind `localStorage`.

---

## 1. UI primitives

### 1.1 Kit adoption per extension (raw button and select creation vs kit calls)

| Extension | kit button/icon-button calls | own button families / uses | other kit calls |
|---|---|---|---|
| budget | 38 (`makeButton` wraps kit, `ext/budget/main.js:1465`) | 1 family, 0 uses | segmented 3, chip 3, header 1, empty 2, dropdown 3 |
| media-organizer | 69 | **25 `.mo-*-btn` families** | header 1, empty 2, dropdown 4 |
| creations-ai | 9 (main) / 0 (story, studio, tables) | **16 `.tg-`/`.cr-` families** (+3 in studio) | segmented 3, header 2, empty 7 |
| flashcards | **0** | `.fc-btn*` used **118** times (`ext/flashcards/main.js:4827`) | dropdown 7, renderMarkdown 13, AI button 9, menu 17 |
| browser | 0 | `.br-btn` (`ext/browser/main.js:296`, 28×28, radius `--parallx-radius-md` 6px) | dropdown 1, menu 2 |
| concept-lab | 0 | 16 `createElement('button')`; `.cl-ghost-btn/.cl-scene-btn/.cl-story-btn` | renderMarkdown 2 |
| workspace-graph | 0 | `_iconBtn` styled inline with JS hover (`ext/workspace-graph/main.js:1385`) | dropdown 2 |

Shapes compared:

| | radius | weight | height |
|---|---|---|---|
| `.px-btn` (`src/theme/px-controls.css:189`) | `--px-radius-sm` (4px) | 500 | `--px-control-h` (28px) |
| `.fc-btn` | `--px-radius-md` (6px) | 550 | no height token |
| `.br-btn` | 6px | n/a | 28×28 |

That is three button shapes on the same screen when flashcards and the browser are open side by side.

### 1.2 Duplicates inside `src/ui` itself

| Concept | Implementations | Difference |
|---|---|---|
| Empty state | `emptyStates.ts:117 renderEmptyState` (`.px-empty`; no icon, no action) · `kit.ts:209 createEmptyState` (`.px-empty`, icon and primary action) · `panelSurface.ts:60 createPanelEmptyState` (`.px-panel-empty`, 18px icon) | Same concept, three DOM shapes. Planner and tool-gallery use the first, budget/creations/media the second, panels the third. |
| Icon button | `kit.ts:133 createIconButton` (`.px-btn--icon`, 16px icon) · `panelSurface.ts:23 createPanelToolbarButton` (`.px-panel-toolbar-btn`) | Two hover/size systems. |
| Button CSS | `.px-btn` (17 rules) · `.ui-button` (`src/ui/ui.css:20`, 9 rules) | `.ui-button` has **0** references in TS/JS. It is dead CSS. |
| Filterable list | `src/ui/list.ts FilterableList` | **0 production consumers** (tests only). Meanwhile `commands/quickAccess.ts`, `workbench/workbenchThemePicker.ts`, `ui/iconPicker.ts`, `canvas/menus/slashMenu.ts` and `chat/input/chatMentionAutocomplete.ts` each hand-roll an input, a list, arrow-key navigation and filtering. |
| Textarea | `src/ui/textarea.ts` | **0 production consumers**. |

**Canonical:** `kit.ts`. Fold `renderEmptyState` into `createEmptyState` and keep the voice registry as data. Make panelSurface call kit with a `dense` option. Delete `.ui-button`. Either adopt `FilterableList` in quickAccess and the theme picker or delete it. **S.**

### 1.3 Tab bars and segmented controls

Canonical: `src/ui/tabBar.ts` (editor tab strip; its only consumer is `editor/editorGroupView.ts:247`), `src/ui/segmentedControl.ts` (wrapped by `kit.createSegmented`; used by settingsEditor, pdfExportDialog, pdfEditorPane, worksheet, budget and creations).

Hand-rolled in-page tab strips and segments:
- **canvas popups:** `canvas/menus/imageInsertPopup.ts:34`, `mediaInsertPopup.ts:44`, `coverMenu.ts:110`. These are three separate "Upload / Embed Link" strips with their own `--active` classes.
- **AI settings:** `aiSettings/ui/sections/mcpSection.ts` (`.ai-settings-mcp-tab`).
- **canvas database:** `canvas/database/databaseEditorPane.ts` (`.canvas-db-tab`).
- **other built-ins:** planner pane tabs (`.planner-pane__tab--active`), excel (`.excel-tab.is-active`), theme editor (`.px-pv-tab.is-active`), tool gallery (`.tool-editor-tab-active`), the timer widget's mode tablist (`dashboard/widgets/timerWidget.ts:133`), agents (`.agents-tabs`).
- **flashcards:** nav tablist (`ext/flashcards/main.js:5761`), radiogroups 8451/8602, `.fc-cs__mode--active`.
- **media-organizer:** `mo-browse-seg` 10658, `mo-ce-tabs` 22064, `mo-edit-tabs` 36511, `.mo-segment-btn` 6012 (uses `.active`, not aria).
- **creations-ai:** `cs-mode[aria-pressed]` in `creations-ai/studio.js`.

The active state is expressed four ways: `--active`, `.is-active`, `.active` and `[aria-pressed]`. `aria-selected` and `aria-pressed` appear in only about 15 files.

**Consolidate:** add a `createTabs` (content tabs, roving focus, `aria-selected`) beside `createSegmented` in kit and `api.ui`, then migrate the roughly 15 strips. **M.** It buys one keyboard model, one active look, and accessibility for free.

### 1.4 Toggles and switches

| Impl | Size | Where |
|---|---|---|
| `src/ui/toggle.ts` (`.ui-toggle`) **canonical** | 36×20 | used by only 3 files (settingsEditor, pythonSettingsPanel, aiSettings webResearchSection); **not in `api.ui`** |
| `.br-switch` | 34×18 | `ext/browser/main.js:343` |
| `.canvas-page-menu-switch` | 32×18 | `src/built-in/canvas/canvas.css:3312` |
| `.tg-cs-toggle-track` | 36×18 | `ext/creations-ai/main.js:1337` |
| raw checkbox in a label | n/a | `aiSettings/ui/sections/modelSection.ts:236-241` (the provider enable toggle) |

That is four switch sizes. **Consolidate:** expose `api.ui.createToggle`, and point the canvas and AI-settings switches at `Toggle`. **S.**

### 1.5 Sidebars and sidebar rows (the "7 sidebar shapes")

No tree or row API exists; `api.views.createTree` is still a proposal. Measured row specs:

| Row class | file:line | height | radius | font |
|---|---|---|---|---|
| `.budget-nav-row` | ext/budget/main.js:388 | 28 (`--px-control-h`) | sm | (inherit) |
| `.planner-sidebar__row` | built-in/planner/planner.css:82 | 28 | sm | — |
| `.dashboard-sidebar__row` | built-in/dashboard/dashboard.css:1456 | **26** | **5px** | — |
| `.mo-sidebar-item` | ext/media-organizer/main.js:5742 | min 28 | sm | — |
| `.cl-side-row` | ext/concept-lab/main.js:5593 | padding-driven (~26) | **md** | 12 |
| `.tg-nav-item` | ext/creations-ai/main.js:149 | padding 7px 12px (~30) | — | 13 (`--parallx-fontSize-md`) |
| `.ws-nav__item` | built-in/worksheet/worksheet.css:423 | padding 5px (~26) | sm | 12 |
| canvas page tree | built-in/canvas/canvas.css:640 | 28 | — | 13 (`--parallx-fontSize-md`) |
| `.tree-node` (explorer) | built-in/explorer/explorer.css:64 | **24** | sm | 13 |
| flashcards decks | ext/flashcards/main.js:4783 | **30** | sm | 13 |
| browser rows | ext/browser/main.js:364 | ~22 | **4px literal** | **12/11 literal** |

Rows run from 22 to 30px high, use 4 radii, and use 12 or 13px type. Trees are hand-built in explorer, the canvas page tree, the AI-settings tools tree, the chat tool-picker tree, the PDF outline, the media-organizer albums and tags, and search results. Search results are styled in **two** stylesheets; see 1.9.

**Consolidate:** a `createTree({sections, rows, actions})` or at least a `createRow` in the kit, then migrate. **L.** It buys the single biggest visual-consistency win.

### 1.6 Page headers

`kit.createPageHeader` is adopted by worksheet (11 calls), creations-ai (2), budget (1) and media-organizer (1, with `.mo-page-header` mobile overrides at 8663-8665). Hand-built headers remain in:
- extensions: flashcards (`fc-pane__header`), browser (`br-page-head`), creations (`cr-hero` alongside the kit);
- built-ins: planner (`planner-pane__header`), the theme editor (its own `h1.px-appearance-title`, `pxAppearancePanel.ts:84-90`), the AI settings panel and the settings editor.

**M.**

### 1.7 Chips, pills, badges, cards and progress bars (no kit equivalent except `.px-chip`)

- **Chips:** about 45 root chip classes across 14 files. media-organizer alone has 15 (`mo-ce-chip`, `mo-edit-chip`, `mo-filter-chip`, `mo-home-chip`, …), creations 3, concept-lab 3, budget 3, theme editor 5. The kit has one (`.px-chip`).
- **Pills:** 22 families (media 6, chat 5, canvas 2, PDF 1, budget 1).
- **Badges:** about 25 families. `ui.css` has `.ui-count-badge`, but there is no kit badge.
- **Cards:** about 40 root card classes across 15 files (budget 9, creations 7, media 5, chat 4, …). There is no kit card.
- **Progress bars: about 15 implementations, 0 shared:**
  - budget: `.bar-track/.bar-fill`, `.budget-glance-fill`, `.budget-goal-fill`, `.budget-ov-fill`
  - agents: `.agents-progress__fill`, `.agents-mind__fill`
  - dashboard: `.ypw__fill`, `.vw__fill`
  - worksheet: `.ws-bar__fill`, `.ws-quizrow__progress`
  - flashcards: `.fc-study__progress-fill`
  - concept-lab: `.cl-meter-fill`
  - media-organizer: `.mo-edit-progress-fill`, `.mo-tr-progress-fill`
  - others: `.ai-settings-memory-mastery-fill`, `.br-progress`, `.cs-progress`, `.parallx-chat-plan-progress`

**Consolidate:** kit `createBadge`, `createProgress` and `createCard`. **M.**

### 1.8 Sliders

`src/ui/slider.ts` has **one** consumer (`aiSettings/ui/sections/agentSection.ts:45`). Raw `input[type=range]`:
- workspace-graph 12;
- media-organizer 9, with 7 custom thumb-CSS blocks;
- creations studio 2;
- concept-lab 1, with 4 CSS blocks;
- theme editor, chat engine chip, the PDF export dialog, and `contributions/editableContextMenu.ts`.

**S–M.** Expose it in the kit.

### 1.9 Inputs and search boxes

`InputBox` (src/ui) has 9 consumers. There are about 35 search/filter inputs with their own classes (`canvas-sidebar-search-input`, `parallx-chat-session-sidebar-filter-input`, `tool-gallery-search-input`, `keybindings-search-input`, …). A global element style in `px-controls.css:97-131` gives a baseline.

**Concrete duplication:** the Search view is styled in **both** `src/workbench.css` and `src/built-in/search/search.css`. **27 selectors** are defined in both, for example:
- `.search-filter-input` at `workbench.css:2119` uses `--parallx-fontSize-base`;
- the same selector at `search.css:131` uses `--px-*`.

Which one wins depends on CSS load order. **S:** delete the workbench.css copy.

### 1.10 Modals, toasts, popovers, drawers and split panes

- **Modals:** `src/ui/overlay.ts` (1 consumer) and `notificationService` `.parallx-modal` (behind `showConfirmModal`) are canonical. There are about 15 more:
  - media-organizer 6+ (`mo-modal`, `mo-bulk-dialog`, `mo-dup-dialog`, `mo-cheat-modal`, `mo-lightbox`, `mo-plan-overlay`);
  - canvas (`canvas-shortcuts-modal`, `canvas-vh-modal`, `canvas-pdf-dialog`);
  - chat (`parallx-system-prompt-modal`, `parallx-chat-tool-picker-dialog`);
  - `ai-settings-confirm-dialog`, despite `showConfirmModal`;
  - `tg-modal` (creations), `fc-datedlg-overlay` (flashcards).
- **Toasts:** the core `.notification-toast` vs `canvas-sidebar-toast`, creations `showToastLite` (2909) **and** `showToast` (5491) in the same file, and media-organizer `mo-ce-toast`, `mo-edit-toast` and `showToast` at 37978.
- **Popover dismiss:** `src/ui/dom.ts:333 attachPopupDismiss` exists but is not in `api.ui`. As a result, 12 `document.addEventListener('keydown')` handlers in budget (1782, 3565, 3909), flashcards (6236) and media-organizer (10378, 12085, 12237, 12368, 14382, 15368, 17344, 17607) re-implement Escape and click-outside.
- **Sashes:** the workbench grid sash, `.view-section-sash`, `.pdf-outline-sash`, `.parallx-chat-sidebar-sash` (chatWidget.ts:204) and `.mo-sidebar-sash` (MO 5687). Four drag-resize implementations, no shared `Sash`.
- **Drawers:** `dashboard/settingsDrawer.ts:34`, `dashboard/appearanceDrawer.ts:43`, `.budget-drawer`, and the creations `tg-drawer` / chat drawer (7666).

### 1.11 Icon buttons and icon sizes

There are eight local icon-button helpers despite `api.ui.createIconButton`:
- `browser/main.js:214`;
- `creations-ai/story.js:338`, `studio.js:379` and `tables.js:268`. These three are copy-pasted, and `tables.js` lacks the `stopPropagation` the other two have;
- `flashcards/main.js:8425`;
- `workspace-graph/main.js:1385` (inline styles with JS hover, so no `:focus-visible`);
- `budget makeIcon` (1161, an icon only).

Glyph sizes are **14** (browser, creations), **15** (flashcards, workspace-graph) and **16/14** (kit md/sm). **S.**

### 1.12 Element factories

There are 32 local `el()`/`h()`/`_el()`/`moEl()` helpers, more than 20 of them in `src/built-in` (for example `planner/plannerEditorProvider.ts:108`, `dashboard/dashboardEditorProvider.ts:84`, `worksheet/main.ts:440`, `canvas/database/databaseEditorPane.ts:68`), even though `src/ui/dom.ts:24 $()` exists. The third argument means `text`, `attrs` or `style` depending on the copy. The drift risk is low, but it marks where a kit call should have been.

---

## 2. Formatting helpers

### 2.1 Relative time ("3 days ago")

**Canonical:** `src/ui/relativeTime.ts:42 formatRelativeTime` (long and short styles). It counts calendar days so that "yesterday" means yesterday, and it parses SQLite UTC strings through `platform/storedTime.ts parseStoredTime`. It has only **3 consumers** (`canvas/header/pageChrome.ts:446`, `canvas/canvasSidebar.ts:667`, `chat/widgets/chatSessionSidebar.ts:66`), and it is **not exposed to extensions**.

**12 other implementations:**

| file:line | Words | Bug vs canonical |
|---|---|---|
| `commands/quickAccess.ts:571` | `5m ago`, `3d ago`, then locale date at 30d | `new Date(iso)` (SQLite strings read as local); 24h buckets |
| `chat/widgets/autonomyActivityWidget.ts:75` | `5m ago … 40d ago` (never switches to a date) | `Date.parse`; **Math.round** (89 s → "1m", 90 min → "2h") |
| `canvas/canvasVersionHistoryPanel.ts:175` | `5 min ago`, `3 h ago`, `2 d ago` | 24h buckets; differs from the canvas ribbon on the same page ("5 minutes ago") |
| `planner/plannerSettingsPanel.ts:515` | identical copy of the above | — |
| `agents/agentsRoutines.ts:28` | identical copy (`min`/`h`/`d`, rounds) | — |
| `explorer/recentItemsWidget.ts:145` | `5m ago`, `2d ago` | 24h buckets |
| `dashboard/dashboardEditorProvider.ts:865` | `5m ago … 400d ago` | rounds; never a date |
| `worksheet/main.ts:1497 when()` | `today`/`yesterday`/`N days ago` | **24h floor: 11pm yesterday seen at 8am reads "today"** |
| `worksheet/dashboardPane.ts:78 daysAgoLabel` | same words, second copy in the same tool | — |
| `ext/creations-ai/main.js:4980 formatTimeAgo` | `now`, `5m`, `3h`, `2d` (no "ago") | — |
| `ext/creations-ai/main.js:8269 formatAgoWords` | `5 minutes ago`, `yesterday` = 24–48h | second copy in the same file; 24h "yesterday" |
| `ext/workspace-graph/main.js:931` | `5 min ago`, `3 hr ago`, then a date **in America/Chicago** | hardcoded zone |

The same idea is written five ways ("5m ago", "5 min ago", "5 minutes ago", "5m", "5 hr ago"). **Consolidate:** expose `api.format.relativeTime` (or `api.ui.formatRelativeTime`) and replace all 12. **S.** It fixes the yesterday and UTC bugs everywhere at once.

### 2.2 Absolute dates, time of day and the time zone

- There are about 40 date and time formatter functions (full list in `scratchpad/datefns.txt`) and 76 inline `toLocale*String` calls. Only 26 calls pass `'en-US'`; the rest use the OS locale. Inside canvas alone:
  - version history prints `YYYY-MM-DD HH:mm` (`canvasVersionHistoryPanel.ts:186`, 24h, with its own inline Z fix);
  - row properties print "Sep 3, 2026, 1:05 PM" (`rowPropertiesSection.ts:46`);
  - date properties force `'en-US'` (`propertyEditors.ts:524`).
- **12h vs 24h** clocks:
  - 24h: agents (`agentsModel.ts:122 formatWhen`), timer (`timerLogic.ts:315`), the activity log (`activity-log/main.ts:76`), the habit detector;
  - OS locale (12h in the US): planner (three identical `fmtTime` at `calendarAgendaWidget.ts:36`, `calendarViewWidget.ts:36`, `plannerEditorProvider.ts:3104`), browser and canvas;
  - the only user-settable 12/24h choice is in the dashboard clock widget (`clockAndLinksWidget.ts:18`).
- **Time zone: two systems.**
  - Core has `chat.timeZone` (`aiSettings/aiProfileSettingsSchemas.ts:105`, resolved by `services/localTime.ts`).
  - Four extensions hardcode **`America/Chicago`** at 8 literal sites:
    - budget `BUDGET_TZ` (`ext/budget/main.js:1589`, used by `ctParts`/`localYmd`/`todayYmd`);
    - web-research `_todayKey` (157) and 637;
    - media-organizer 9258, 16008, 16419, 16433;
    - workspace-graph 945.
  - Budget is not even internally consistent: `describeWhen` (`3222`) uses the machine zone (`toDateString()`) beside the CT "today".
  - A user outside Central time sees month buckets, daily budgets and "Today" roll over at the wrong midnight, and the Settings value does nothing for these tools.
- **Today/Yesterday grouping**, five versions:
  - chat sessions: "Last 7 Days" (`chatSessionSidebar.ts:52`);
  - media-organizer feed: "Earlier this week", calendar week (`ext/media-organizer/main.js:11826`);
  - media-organizer grid: month names (9941);
  - browser history: weekday (`ext/browser/main.js:227`);
  - worksheet: "N days ago".

**Consolidate:** `api.time.zone()` plus `formatDate`/`formatTime` that honour `chat.timeZone` and a clock-format setting. **M.**

### 2.3 Durations

15 helpers, including **six inside media-organizer**:
- `formatDuration` 9245 (floor, `''` for 0);
- `moHomeDuration` 15133 (**round**);
- `moTimeStr` 15494 (floor);
- `moPracticeFormatDuration` 31289 ("1 h 5 min");
- `moPracticeClock` 31314 (ceil);
- `moEditDuration` 36427 ("1 min 5 s").

**Visible bug:** a 59.6-second video shows `0:59` on the grid tile (9524 → `formatDuration`) and in the info panel (16498), but `1:00` on the feed badge (13623 → `moHomeDuration`).

Other copies:
- `openclaw/commands/openclawUsageCommand.ts:120`
- `settings/pythonSettingsPanel.ts:41`
- `chat/widgets/autonomyActivityWidget.ts:89`
- `editor/panes/notebook/notebookModel.ts:444`
- `dashboard/widgets/timerLogic.ts:309,319`
- `worksheet/main.ts:692`
- `worksheet/dashboardPane.ts:61`
- `ext/workspace-graph/main.js:948`

**S.**

### 2.4 File sizes

Seven copies, each with a different empty output and precision:

| Helper | file:line | Empty output | KB precision | Notes |
|---|---|---|---|---|
| `formatBytes` | `settings/pythonSettingsPanel.ts:33` | `'0 MB'` | MB only | |
| `formatSize` | `chat/tools/fileTools.ts:481` | | 1 decimal | no GB |
| `humanSize` | `canvas/menus/mediaInsertPopup.ts:117` | | 1 decimal | rounds by /102.4 |
| `fmtBytes` | `ext/browser/main.js:220` | `''` | 0 decimals | |
| `formatFileSize` | `ext/media-organizer/main.js:16511` | `'0 B'` | 1 decimal | |
| `fmtBytes` (nested) | `ext/media-organizer/main.js:18875` | `'—'` | 1 decimal | |
| `fmtBytes` (nested) | `ext/media-organizer/main.js:26051` | `'—'` | 1 decimal | |

Media-organizer also has inline MB math at 5003 and 36844. **S.**

### 2.5 Token counts: a user-visible inconsistency inside the chat composer

Five functions and about 8 inline sites:

| Formatter | file:line | Divisor and output |
|---|---|---|
| `formatTokens` | `chat/widgets/chatEngineChip.ts:69` | **/1024**, "128K" |
| `_formatTokens` | `chat/pickers/chatContextWindowPicker.ts:181` | /1024, **no M branch**: 1M becomes "976.6K" |
| `_formatContextLength` | `chat/pickers/chatModelPicker.ts:172` | /1024 |
| `_formatTokens` | `chat/widgets/chatTokenStatusBar.ts:580` | **/1000**, "131.1K" |
| `_formatTokenCount` | `chat/input/chatContextPills.ts:414` | /1000, **lowercase "k"** |

Inline sites: `openclaw/commands/openclawUsageCommand.ts:48,60,83,97` (/1024, 0 decimals), `openclawStatusCommand.ts:37` (/1024, 1 decimal), `openclawModelsCommand.ts:49`, and `services/diagnosticChecks.ts:105,152`.

**Bug:** the engine chip labels a 131,072-token window "128K". Its "Details" link opens `tokenBar.openDetails` (`chatWidget.ts:398`), which prints the same window as "131.1K" (`chatTokenStatusBar.ts:452`). Commit `088e0cb8` ("the engine chip says one size everywhere") fixed the chip but not the details panel.

Related duplication: `ChatModelPicker`, `ChatContextWindowPicker` and `ChatTokenStatusBar` are still instantiated, hidden, under the chip as state holders (`chatWidget.ts:344-398`: "keep running underneath … but are not shown"). The context-window override therefore lives in a hidden picker **and** on the session.

**S** to unify the formatter; **M** to retire the hidden pickers.

### 2.6 Money

- budget `fmtMoney` (`ext/budget/main.js:1443`, 77 uses; USD and `en-US` hardcoded);
- `fmtMoneyShort` 5637, which drops the sign and rounds $1,500 to "$2K";
- an ad-hoc `fmtMoney(…).replace(/\.00$/, '')` at 1288;
- worksheet `$${(cents/100).toFixed(2)}` with no thousands separator (`worksheet/dashboardPane.ts:532,533,592`, `worksheet/main.ts:3609`).

**S** (an `api.format.money(cents)`). It matters once a dashboard widget shows budget and worksheet money side by side.

### 2.7 Plurals and numbers

There are about 280 inline `n === 1 ? '' : 's'` ternaries (src 99 across 43 files; ext: media-organizer 84, flashcards 57, budget 21, creations 11, workspace-graph 4). There are also 4 helpers: `planner/plannerToday.ts:142 plural`, `ui/relativeTime.ts:22` (private), `ext/media-organizer/main.js:35943` (local closure) and `ext/creations-ai/tables-core.js:295 pluralForm`. Low drift risk; **S** to add `api.format.count(n, 'card')`.

### 2.8 Title-casing and humanising

- `ext/budget/main.js:185 titleCaseToken` lowercases the tail.
- `ext/creations-ai/main.js:4975 capitalize` and `8264 titleCaseName`.
- `ext/creations-ai/tables-core.js:291 titleCase` and `292 sentenceCase`.
- `services/workflows/workflowSuggestions.ts:51 titleCase`.
- `settings/settingsEditor.ts:117 humanizeSettingKey`.
- **Two identical `humanizeSlug`:** `chat/tools/memoryTools.ts:273` (its comment says it "mirrors") and `services/workspaceMemoryService.ts:117`. One of them should be exported.

**S.**

### 2.9 HTML escaping

There are 16 copies: `ext/browser`, `ext/budget` (two: `esc` and `escHtml`), creations, workspace-graph, `canvas/export/printHtml.ts`, `chat/rendering/chatContentParts.ts` (escapes `&<>` only), dashboard ×2, planner ×2, `ui/ansiToHtml.ts`, `ui/conceptMap.ts`, `worksheet/ooxml.ts`, `openclaw/openclawSystemPrompt.ts`, `editor/panes/markdownEditorPane.ts` and `electron/documentExtractor.cjs`. Some escape quotes and some do not. It is safe at the current call sites, but it should be a single `escapeHtml` in `src/ui/dom.ts` and in `api.ui`. **S.**

---

## 3. Markdown, math and syntax highlighting

### 3.1 Renderers

| # | Renderer | file:line | Engine | Used by |
|---|---|---|---|---|
| 1 | `renderMarkdown` **(canonical for embedded rich text, `api.ui.renderMarkdown`)** | `src/ui/renderMarkdown.ts:138` | markdown-it (`html:false`, `breaks:false`) and KaTeX, math extracted before parsing | flashcards (13), concept-lab (`clMd` 5650, `clTex` 5638) |
| 2 | Chat transcript | `chat/rendering/chatContentParts.ts:769` | markdown-it (`breaks:true`) with mark, GitHub alerts, KaTeX token rules, mind-map fence and link targets | chat |
| 3 | Markdown file preview | `editor/panes/markdownEditorPane.ts:240` | markdown-it (`breaks:true`, `linkify:true`) with highlight.js and KaTeX rules **copied from #2** (same rule names `parallx_math_block`/`parallx_math_inline`, line 271) | `.md` editor |
| 4 | Dashboard AI widgets | `dashboard/widgets/markdownRenderer.ts:10` | hand-rolled subset (headings, lists, emphasis, links); **no math, no code, no tables** | market, weather, custom-AI widgets, settings drawer, dashboard editor (6 importers) |
| 5 | Creations chat | `ext/creations-ai/main.js:5461 renderMessageMarkup` | regex `**`/`*` → `<strong>`/`<em>` | role-play chat |
| 6 | Chat user bubble | `chat/rendering/chatListRenderer.ts:194 renderUserSafeMarkdown` | hand parser (code blocks, inline) | chat user messages |
| 7 | Concept-map labels | `src/ui/conceptMap.ts:155 splitInline` **and** `:825 editorTokens` | two regex grammars in one file | mind maps |

**Fixes that live in one copy only:**

| Behaviour | renderMarkdown (#1) | chat (#2) | md preview (#3) |
|---|---|---|---|
| Money guard ("costs $5 and $10 more" stays text) | yes (`renderMarkdown.ts:77-86`) | **no**: `$5 and $` renders as math | **no** |
| Bare `\begin{aligned}` / `cases` / `matrix` without `$$` | yes (`:73`) | **no** | **no** |
| `align` → `aligned` normalisation, nested-placeholder unstash (user reports cited in comments) | yes (`:47-71`) | **no** | **no** |
| `\(…\)` and `\[…\]` delimiters | **no** | yes | yes |
| Loose `[` … `]` LaTeX blocks, aligned-text tables | **no** | yes (`_normalizeChatMarkdown` :346) | no |
| Inline `$$…$$` mid-line | yes | **no** (block rule needs `$$` on its own line) | no |

Because #1 lacks `\(…\)`, the Anki importer pre-converts `\( \)` and `\[ \]` to `$` (`electron/ankiWorker.cjs:85-88`): a downstream workaround for the renderer gap. In `conceptMap.ts`, the render grammar (:155) has the intraword-underscore fix (`C_ik` stays a subscript) but the editor tokeniser (:825), commented "the render grammar, but markers are KEPT", does not. Editing a label therefore treats `C_ik` as italics.

**Consolidate:** one markdown-it factory, `createMarkdownRenderer({breaks, linkify, highlight, fences})`, with **one** math pre-pass (the #1 extraction plus the `\(` and `\[` delimiters and chat's loose-block normaliser). Chat and the md preview become configurations of it, the dashboard subset is deleted, and creations calls `api.ui.renderMarkdown`. **M.** It buys identical math in chat, flashcards, worksheets, widgets and `.md` files, which matters for an exam-study app.

### 3.2 KaTeX call sites

`katex.render`/`renderToString` is called in 7 places:
- canvas: `math/inlineMathEditor.ts:85,128`, `extensions/mathBlockNode.ts:82`, `extensions/conceptMapNode.ts:46`;
- chat: `chatContentParts.ts:802,932`;
- `renderMarkdown.ts:97`;
- `markdownEditorPane.ts:345`;
- `electron/imageBridge.cjs:106` (offscreen render).

Only `renderMarkdown` normalises environments. The canvas math block will refuse `\begin{align}` that a flashcard renders fine. **S** (export `renderTex(src, display)` from one module).

### 3.3 Syntax highlighting

- Canvas: lowlight with `createLowlight(common)` instantiated **twice** (`canvas/canvasEditorView.ts:35` and `canvas/canvasEditorProvider.ts:44`).
- Markdown preview: highlight.js `common` (`markdownEditorPane.ts:16,245`).
- Code editor and notebooks: CodeMirror (`src/ui/codeEditor.ts`).
- Chat code blocks: **no highlighting** (`chatContentParts.ts` `_renderCodeBlock`).

The same snippet therefore looks different in chat, canvas and an `.md` preview. **S–M:** share the lowlight instance and use it for chat code blocks.

---

## 4. Charts

There is no chart helper in `src/ui` and no `--px-chart-*` palette; budget relies on `--vscode-charts-*`, which `themeService.ts:110-117` bridges to `--px-*`. Hand-rolled implementations:

| Chart code | file:line | Notes |
|---|---|---|
| budget `buildDonut`, `buildBar`, `buildLine`, `niceCeil`, `fmtMoneyShort` | `ext/budget/main.js:5366, 5459, 5541, 5623, 5637` | SVG, 25 `--vscode-charts-*` refs with hex fallbacks |
| budget Overview pace sparkline | `ext/budget/main.js:3263` | separate SVG code from `buildLine` |
| concept-lab mini chart library: `svgEl`, `clScale`, `clNiceTicks`, `createAxes` | `ext/concept-lab/main.js:5808, 5815, 5822, 5841` | **the most complete**; 171 `svgEl` shape calls |
| worksheet dashboard line chart | `src/built-in/worksheet/dashboardPane.ts:222` | own scale and axes |
| flashcards review history and forecast (CSS div bars) | `ext/flashcards/main.js:10916, 10933` (CSS 5587) | |
| flashcards due-bars widget | `ext/flashcards/main.js:5675` | |
| chat ring gauges ×2 | `chat/widgets/chatTokenStatusBar.ts:373` (hardcoded `#3c3c3c` track: wrong in light mode) and `chat/widgets/chatEngineChip.ts:107` (CSS tokens) | two rings for the same usage number |
| dashboard year-progress and video bars | `ypw__fill`, `vw__fill` | |
| media-organizer histogram | `ext/media-organizer/main.js:34294` | canvas element |

That is about 10 implementations, three "nice tick" algorithms (budget `niceCeil`, concept-lab `clNiceTicks`, worksheet inline) and two ring gauges. **Consolidate:**
1. Promote concept-lab's `svgEl`/`clScale`/`clNiceTicks`/`createAxes` into `src/ui/chart.ts` (bar, line, donut, sparkline, ring) with a `--px-chart-1..6` palette, and expose it in `api.ui`. **M.**
2. Fix the `#3c3c3c` ring track now. **S.**

---

## 5. Settings: where each piece of data lives

| Store | File on disk | Holds | Written by |
|---|---|---|---|
| ConfigurationService (`config:` keys) | `<ws>/.parallx/workspace-state.json` (`workbench.ts:943`, `configurationService.ts:27`) | every manifest `contributes.configuration` key; `getConfiguration()` | extensions, and the hub through `manifestSettings.ts` bindings |
| SettingsRegistry overrides | user: `<data>/data/global-storage.json`; workspace: workspace-state.json (`settingsRegistryBootstrap.ts:38-40`) | built-in schema settings | Settings hub |
| UnifiedAIConfigService | presets: workspace-state.json `unified-ai.presets` (`unifiedAIConfigService.ts:32`); override: `.parallx/ai-config.json` (:148); legacy `.parallx/config.json` (:149) and `.parallx/ai-settings.json` | model, persona, chat (incl. `timeZone`), retrieval, agent, heartbeat | AI & Models panel **and** 25 schema rows (`aiProfileSettingsSchemas.ts`) |
| Language models | global-storage.json `languageModels.activeModelId` (`languageModelsService.ts:36`, bound at `workbench.ts:1032`) | the active chat model | model picker and engine chip |
| Appearance | `localStorage['px-appearance']` **and** `<data>/data/appearance.json` (`pxAppearance.ts:12,98-160`) | light/dark mode, base, accent | Appearance panel |
| Color theme | global-storage.json `parallx.colorTheme` (`themeCatalog.ts:104`) | VS Code editor theme, light or dark | theme picker (Ctrl+T), Appearance panel |
| Keybinding overrides | storage, migrated from localStorage (`keybindingOverrides.ts:24`) | shortcuts | Keyboard Shortcuts |
| localStorage only | Chromium profile | activity-bar hidden icons (`activityBarPart.ts:724`), canvas menu recents (`canvasMenuRegistry.ts:199`), icon-picker recents (`iconPicker.ts:62`), property-bar collapsed (`rowPropertiesSection.ts:30`), **flashcards steering text** (`ext/flashcards/main.js:10302`), creations memory panel (5090) | — |
| Extension private | `.parallx/extensions/text-generator/settings.json` (creations, `ext/creations-ai/main.js:8718`); `.parallx/extensions/workspace-graph/settings.json` (`ext/workspace-graph/main.js:12`); `mo_settings` table (media-organizer migration 011); `planner_settings` table (planner migration 002) | per-tool preferences, some of them model choices | tool-local settings pages |
| Tool permissions | `.parallx/permissions.json` **or** globalState `PERMS_GLOBAL_KEY` as a fallback (`chat/main.ts:3560-3575`) | always-allow / deny | approval UI |

**Settings held by two systems (bugs):**

1. **Web Research: two UIs, two stores, one dead.**
   - The manifest declares `webResearch.dailyBudget`, `.ambientEnabled`, `.hubPageId` and `.hubPageTitle` (`ext/web-research/parallx-manifest.json`). They appear in the Settings hub bound to `config:` keys in workspace-state.json.
   - The extension never calls `getConfiguration`. It forges `{id:'IGlobalStorageService'}` (`ext/web-research/main.js:922-931`) and reads the same key names from **global-storage.json** (164-201, 568-595).
   - AI & Models › Web Research (`aiSettings/ui/sections/webResearchSection.ts:16-20,104,181`) also writes global-storage.json.
   - Result: editing these settings in the hub's Web Research rows does nothing. **`webResearch.ambientEnabled` is written by both UIs and read by nobody.**
   - This is exactly the defect `manifestSettings.ts:9-17` says it fixed.
2. **AI settings are edited from two places inside one Settings window.**
   - `registerAIProfileSettings` (`chat/main.ts:452`) registers 25 keys under the categories Chat, Model, Persona, Retrieval, Suggestions, Indexing, Agent and Tools.
   - The "AI & Models" panel (`ai-settings/main.ts:139`) edits the same fields with different controls and copy:
     - "Default Model" dropdown (`modelSection.ts:101`) vs the `model.defaultModel` row (`aiProfileSettingsSchemas.ts:119`);
     - "Max Iterations" **Slider** with the description "How many steps the agent can take…" (`agentSection.ts:38-45`) vs the `agent.maxIterations` **number box** with "Maximum tool-loop iterations… before the runner refuses" (`aiProfileSettingsSchemas.ts:349`).
   - `settingsEditor.ts:331` folds a schema category into a panel only when the labels match; "AI & Models" matches none of the eight categories, so all of them show as extra nav entries.
3. **Light/dark mode is stored twice.**
   - `px-appearance.mode` (localStorage plus `appearance.json`) drives the `--px-*` chrome.
   - `parallx.colorTheme` (global-storage.json) drives the `--vscode-*`/editor theme.
   - The Appearance panel syncs both (`pxAppearancePanel.ts:32-35,73-76`). **The Color Theme picker (`workbench.action.selectTheme`, Ctrl+T, AI-invocable, `structuralCommands.ts:278-287`) writes only `parallx.colorTheme`** (`workbenchThemePicker.ts:179-180`).
   - Picking "Light Modern" there leaves the `--px` chrome dark, and the reverse. This is directly on the current branch's subject (light mode and accent contrast).
4. **The active chat model has four homes:** the global `languageModels.activeModelId`; the preset `model.defaultModel` (workspace), which overrides it via `setDefaultModel` (`languageModelsService.ts:224`); `flashcards.aiModel` (manifest); and creations `settings.defaultModel` (private JSON). See also the model pickers in §10.
5. **The Ollama base URL** (`chat.ollama.baseUrl`, `tools/builtinManifests.ts:370`) is read once, at activation, by the chat `OllamaProvider` only (`chat/main.ts:701,721`). These ignore it:
   - `EmbeddingService` (constructed with the default at `workbenchServices.ts:307`, no setter);
   - `embeddingWorker.ts:74`;
   - `indexingPipeline.ts:429`;
   - flashcards (`ext/flashcards/main.js:2278`, hardcoded `http://localhost:11434/api/version`).

   The renderer CSP also only allows `connect-src http://localhost:11434` (`electron/index.html:7`), so a non-local URL cannot work even for chat.
6. **The time zone** is the `chat.timeZone` preset value versus the `America/Chicago` literals (§2.2).
7. **"Global preset"** is the UI's term (`aiSettings/ui/sectionBase.ts:83`, `ai-settings/main.ts:264`), but presets are stored per workspace (`registerUnifiedAIConfigService(this._services, this._storage)`, `workbench.ts:1026`; confirmed in `aiProfileSettingsSchemas.ts:8-11`). That is a copy and model mismatch rather than a crash.
8. **localStorage-only preferences** do not have the durable-layer fix that `pxAppearance.ts:98-106` added for the documented "Chromium flushes localStorage lazily; quit soon after and the write is lost" bug. The flashcards steering text is user-authored prose with only that protection.

**Consolidate:**
1. **S:** have web-research read through `getConfiguration`, delete `webResearchSection` or bind it, and drop the dead `ambientEnabled` or wire it.
2. **S:** make the theme picker set `px-appearance.mode` from the theme's base.
3. **M:** give the AI panel `absorbedCategory` for its eight categories or drop the duplicate rows; route per-tool model choice through one `api.lm.pickModel({purpose})`.
4. **M:** pass the Ollama URL to EmbeddingService and the worker and widen the CSP from the setting; give extensions a settings-panel registration so creations and workspace-graph stop keeping private settings files.

It buys settings that do what they say, in one place.

---

## 6. Scheduling and background work

| Scheduler | file | Timer | Persistence | Delivers |
|---|---|---|---|---|
| Cron | `openclaw/openclawCronService.ts` | own | `.parallx/cron.json` | agent turn (`payload.agentTurn`) |
| Workflows ("Routines") | `services/workflows/workflowService.ts` | own setInterval ("Lifecycle follows CronService exactly", :4) | `.parallx/workflows.json` (documents, schedule state, cooldown ledger, run ring) | steps; `notify` → AutonomyLog (`chat/main.ts:1831`) |
| Heartbeat | `openclaw/openclawHeartbeatRunner.ts` | own | AI config | isolated turn |
| Mind reflection | `openclaw/mind/reflectionScheduler.ts` | daily | MindService | ledger |
| Dashboard refresh | `dashboard/dashboardRefreshScheduler.ts` | own (its header explains why it does not use ICronService) | widget rows | callbacks |
| Planner reminders | `planner/plannerReminderScheduler.ts` | 60 s setInterval | `reminder_fired` column | `showInformationMessage` toast with Snooze |
| Planner sync | `planner/sync/plannerSyncOrchestrator.ts` | own setInterval | `planner_settings` KV | pull and push |
| workspace-graph periodic refresh | `ext/workspace-graph/main.js:2846` | 30 s setInterval | — | refresh |

Schedule parsing is shared (`computeNextRun`/`parseCronField` from the cron service; good). The timers, catch-up, run history and persistence are not: there are three JSON-snapshot schedulers and three ad-hoc intervals.

**Two reminder systems:**
- Planner reminders are a cheap toast with Snooze.
- The flashcards daily reminder is a cron **agent turn** (`ext/flashcards/main.js:11720-11731`). It spends an LLM call to post a nudge and cannot fire when no model is loaded.

`agentsRoutines.ts` already presents cron jobs and workflows in one list ("Every routine is a workflow … the only other entries are jobs an extension or Chat scheduled on the internal scheduler").

**Consolidate:**
1. **M:** move cron jobs onto the workflow store (one JSON, one timer, one run ring), make the dashboard refresh and planner reminders workflow triggers or a shared `ITimerService`, and give reminders a `notify` step that needs no model.
2. **L:** fold the heartbeat in as well.

---

## 7. Logs and journals

| Log | file | Storage | Retention | Shown in |
|---|---|---|---|---|
| Activity journal | `services/activityJournalService.ts` | SQLite `activity_log` (:181) | ring + flush | Activity panel (`activity-log/main.ts`, 800 rows), heartbeat context, `activity_log` tool |
| Autonomy log | `services/autonomyLogService.ts` | **in memory, no persistence** (:12) | 200 (:70) | Agents view, `autonomy_log` tool |
| Autonomy event log | `services/autonomyEventLog.ts` | `data/autonomy-events.<day>.ndjson` | 90 days | replay command, rail |
| Autonomy task rail | `services/autonomyTaskRailService.ts` | view model **that exists to merge the two logs above** (:1-8; its header still points at the deleted `src/built-in/autonomy-log/main.ts`) | — | Agents |
| Action ledger | `openclaw/mind/actionLedger.ts` | hash-chained JSON blob in storage | 1000 (:116) | Mind |
| Cron and workflow run history | `cron.json`, `workflows.json` | JSON | rings | Agents › Routines |
| Indexing log | `indexing-log/main.ts` | in memory | 2000 (:44) | panel |
| Output channels | `api.window.createOutputChannel` | in memory | — | Output panel; **0 extension callers** (282 `console.*` calls in `ext/` instead) |
| Agent trace / observability / diagnostics | `agentTraceService.ts`, `observabilityService.ts`, `diagnosticsService.ts` | in memory | — | AI diagnostics |
| Workspace transcripts | `.parallx/sessions/*.jsonl` | files | — | chat history |
| budget `sync_log` | budget DB | SQLite | — | Budget › Sync |

One autonomous run is written to up to four of these (the autonomy log ring, ndjson, the ledger via MindService, and the run ring). Their retention differs, so the Agents view's history comes back after a restart while the live list (the in-memory ring) starts empty.

The extension-facing narration APIs are nearly unused:
- `api.activity.note` has **1** extension call (budget);
- `api.autonomy.signal` has **0** (its own doc example is "a budget exceeded");
- `createOutputChannel` has **0**.

**Consolidate:**
1. **M:** make AutonomyLogService a view over AutonomyEventLog (persist, then delete the rail's merge logic).
2. **S:** route budget sync events through `api.activity.note`/`api.autonomy.signal`.
3. **S:** give extensions an output channel by default.

---

## 8. Storage: the same data in two places

- **Autonomy runs:** ring + ndjson + ledger + run rings (§7).
- **Embeddings:** the core vector store in the workspace DB (`vectorStoreService`) plus flashcards' own `fc_card_embeddings` vec0 table in the extension DB (`ext/flashcards/main.js:2246-2262`). The 768 dimension is duplicated as a constant (`FC_EMB_DIMS` 2228 vs `embeddingService.ts:29 EXPECTED_DIMENSIONS`). Flashcards obtains the service by forging `{id:'IEmbeddingService'}` (2239).
- **The `/api/embed` fetch** exists three times: `embeddingService.ts:277,368` (main thread), `embeddingWorker.ts:74` (worker, behind a feature flag) and the `ollamaProvider.ts:370` warm-up.
- **Settings:** see §5. Web-research keys and the active model each have two homes; permissions are in a workspace file or globalState; appearance is in localStorage and `appearance.json` (intentional, healed); light/dark is also in `colorTheme`.
- **Recent-item lists ("MRU"):** `canvasMenuRegistry.ts:199 createRecentList` (localStorage), `iconPicker.ts:62 loadRecentIcons` (localStorage) and `services/recentsService.ts` (workspace storage). Three implementations of the same small idea.
- **SQLite:** workspace DB `.parallx/data.db` plus per-extension DBs `.parallx/extensions/<id>/data.db` (`electron/database.cjs:364-379`). Each extension carries its own migrations folder (browser, budget, flashcards, media-organizer). That is clean. No IndexedDB is used anywhere, and sessionStorage only in `main.ts:117`.

---

## 9. Event buses, commands and icons

**Event buses: three styles.**
1. The core `Emitter` (`src/platform/events.ts`) is canonical and is **not exposed to extensions**.
2. Module-level listener Sets:
   - budget `_syncListeners` (40), `_sectionListeners` (305) and `_ledgerListeners` (317);
   - flashcards `_routeListeners` and `_dataListeners` (1239-1240) and `_navListeners` (5739);
   - browser `_sidebarListeners` (64);
   - also in core bridges: `dashboardBridge.ts:326` and `workspaceGraphBridge.ts:70` use `Set<() => void>` instead of `Emitter`.
3. Global DOM `CustomEvent`s used as a hidden bus:
   - media-organizer: **24 distinct `mo:*` events, 46 dispatches, 34 listeners**, all on `document`;
   - `parallx.flashcards.route` (1458/6530) and `parallx:pdf-reveal` on `window` (1398);
   - `parallx.dashboard.addWidget` and `refreshAll` (`dashboard/main.ts:641-646` → `dashboardEditorProvider.ts:242`);
   - `parallx:canvas-run-legacy-migration`, `parallx:capture-to-canvas`, `parallx:canvas-reveal-block` (canvas);
   - `parallx-edit-apply` (`chat/main.ts:344`);
   - `parallx-selection-action`, dispatched by both `commands/editorCommands.ts:256` and `ext/workspace-graph/main.js:2297`.

   These cross extension and core boundaries untyped and undiscoverable.

**Consolidate:** `api.events.createEmitter()` plus a typed `api.events.publish/subscribe(namespaced)`, then replace the document events. **M.**

**Command and action registries** (five ways to declare "an action"):
1. core `CommandDescriptor` (`src/commands/*`, 93 marked `aiInvocable`);
2. `api.commands.registerCommand` (136 calls in built-ins, 75 in extensions);
3. manifest `contributes.commands`;
4. chat slash commands (`src/openclaw/commands/*`, 9 files);
5. AI tools (`api.chat.registerTool`, 26 calls in extensions).

media-organizer registers about 55 command ids against 30 declared. The m70 policy already gates which commands are AI-invocable. Leave as is, but declare palette visibility in one place. **M.**

**Icons:**
- **Canonical:** `src/ui/iconRegistry.ts` (+ generated Lucide), `brandIcons.ts` and `fileTypeIcons.ts`.
- **Thin wrappers (fine):** `chat/chatIcons.ts` and `canvas/canvasIcons.ts` → `canvas/config/iconRegistry.ts`.
- **Inline copies:** **117 inline `<svg` literals in 48 `src/` files**, including:
  - `planner/plannerEditorProvider.ts`: **31** hand-copied Feather-style icons (75-90: calendar-check, repeat, link, file, palette, refresh), with stroke widths 2 and 2.4;
  - `dashboard/dashboardEditorProvider.ts`: 14;
  - **22** dashboard and planner widgets with `const ICON_SVG = '<svg…'`, because widget registration takes raw SVG instead of a registry id;
  - `parts/titlebarPart.ts` 5, `workbench/workbench.ts:244 PART_ICONS` 4, `statusBarController` 2.
- Extensions have no inline SVG; they all go through `api.icons`. They do pass 14, 15 or 16 as the size (§1.11).

**Consolidate:** **S–M.** Make widget registration take `icon: '<registry id>'` and swap the planner constants for registry ids.

---

## 10. LLM access paths

**Ways code talks to a model:**
1. The chat turn pipeline: openclaw participants → `openclawTurnRunner`/`openclawAttempt` → `languageModelsService` → provider.
2. **`api.lm.sendChatRequest`**: `languageModelBridge.ts:66-73` → `sendChatRequestForModel`. **No `AbortSignal`, no timeout and no priority class** are passed through, so every extension call is "interactive" in the broker (`modelEngineBroker.ts:6-12`), including a 100-email budget sync.
3. The **`chat.getInlineAIProvider` command** (`chat/main.ts:3123`), a second facade over the same service that adds `retrieveContext`. Used by `canvas/main.ts:661`, `workbenchFileEditorSetup.ts:137` (notebook), `pdfEditorPane.ts:1494` and **workspace-graph** (`ext/workspace-graph/main.js:2425`, which falls back to `api.lm`).
4. Submitting a prompt into the active chat session (`chat/main.ts:3135+`), used by dashboard widgets and automations.
5. Isolated autonomous turns: cron `agentTurn`, heartbeat, workflow steps, `openclawReadOnlyTurnRunner` and subagents.
6. Direct HTTP:
   - Ollama: `ollamaProvider.ts` (chat, warm-up, version), `embeddingService.ts` and `embeddingWorker.ts` (embed), and flashcards `fetch('http://localhost:11434/api/version')` (2278);
   - `electron/anthropicBridge.cjs:22` (Anthropic, main process);
   - `electron/modelBridge.cjs` (ONNX image models; a separate concern, fine).

**Helpers duplicated because of the gaps in #2:**

- **Stall watchdogs: 3 copies.**
  - `fcStreamWithStall` (`ext/flashcards/main.js:3612`) has a 240 s first-chunk leash for cold model loads, orphan-rejection handling and generator `return()`.
  - `budgetStreamWithStall` (`ext/budget/main.js:6501`) has the same leash (6478-6482).
  - `worksheet/worksheetAi.ts:36 streamWithStall` has **none of these**. It times out after 90 s while a 17–20 GB model is still loading, which is exactly the failure flashcards' comment describes.
  - media-organizer, creations-ai and workspace-graph have no watchdog at all and can hang indefinitely.
- **Model pickers: 6.**
  - `pickModelId` (budget 6853) throws when nothing is found;
  - `fcPickModel` (flashcards 3385) prefers the `aiModel` setting;
  - `pickModel` (`worksheetAi.ts:20`) returns null;
  - `moTagModel` (media-organizer 30358) requires vision and does not fall back;
  - workspace-graph takes `models[0]` inline (2429-2436);
  - creations uses its own `settings.defaultModel` (9406).

  Their error messages differ: "Install or start Ollama first", "Configure a model in AI settings", "Pick one in the chat panel first", "Open a chat session or configure a model in AI Settings" (the last in inline `color:#a55`).
- **Model-JSON extraction: about 12 copies.**
  - budget `tryParseModelJson` 6451;
  - media-organizer `moParseTagReply` 30167;
  - flashcards 790, 871, 2957 (three inside one file);
  - creations main 4625, `studio-core.js:285 parseJsonLoose`, `story-core.js:167`;
  - workspace-graph 2473;
  - `worksheet/itemFormat.ts:214`;
  - `services/lineageClassifierService.ts:480`;
  - `openclaw/openclawDefaultRuntimeSupport.ts:553`.

  Only flashcards and media-organizer strip `<think>` blocks before scanning for `{`/`[`, and only flashcards repairs LaTeX backslashes (733). The others will grab braces from a thinking model's reasoning.
- **Material and prompt builders: 2 diverged copies.**
  - `fcBuildMaterial` and `fcBuildMaterialDocs` (flashcards 3653/3688) add `[...material truncated...]` markers and keep a partial page.
  - `worksheetAi.ts:92 buildItemMaterial` (a "Same LM discipline as M98 flashcards" copy) truncates **silently**, so the model does not know the material was cut.

**Consolidate:**
1. **M:** add `signal`, `timeoutMs`/`stallMs` and `priority` to `api.lm.sendChatRequest`. That retires all three watchdogs and lets background extension work yield to chat.
2. **S:** add `api.lm.pickModel({ need: ['vision'] })` with one error string.
3. **S:** export `parseModelJson(text, { shape: 'object' | 'array' })` (with think-strip and LaTeX repair) and `buildPagedMaterial` through `api.lm`.
4. **S:** delete the flashcards hardcoded probe and use `IEmbeddingService.isAvailable()`.

---

## 11. Extension API surface vs what extensions actually do

**Reaching around `api`:**
- **Forged service ids:**
  - flashcards → `IEmbeddingService` (2239);
  - web-research → `IGlobalStorageService` (922-931, with the comment "we can't import it… re-create a matching id object");
  - workspace-graph → `ISemanticGraphService` and `IMindMapRefreshOrchestrator` (918-959).

  These are internal services with no contract.
- **DOM:**
  - 10 `<style>` injectors (`injectStyles` in browser, budget ×2, concept-lab, creations ×4, flashcards, media-organizer);
  - 29 `document.body.append` calls (media-organizer 18, creations 7, budget 3, flashcards 1) for overlays and menus;
  - `document.body.classList` toggled by creations (`applyFeel`);
  - 12 document `keydown` handlers (§1.10). Only media-organizer uses `api.keybindings.register` (2 calls).
- **Re-implementing what `api` provides:** buttons (flashcards, browser, concept-lab, creations story/studio/tables), icon buttons (8 helpers), context-menu-style menus (media-organizer `mo-menu-btn`), modals (when `showConfirmModal` exists), toasts (when `showInformationMessage` exists) and LM timeouts (§10).
- **Using API surface not in the public typings:** `api.lm.getActiveModel` is used by budget, flashcards, media-organizer and worksheet but is missing from `src/api/parallx.d.ts` (present only in `apiFactory.ts`/`languageModelBridge.ts:54`). creations-ai calls `parallx.lm.listModels`, which does not exist (`main.js:8926`, guarded by `?.`).
- **API offered but unused:** `api.autonomy.signal` (0 calls), `api.activity.note` (1), `createOutputChannel` (0), `api.ui.createPageHeader` (adopted by 4 files), `api.ui.createSegmented` (2 extensions: budget and creations; worksheet is a built-in).

**Consolidate:**
1. **M:** promote the four forged services to real `api.*` namespaces, or block them.
2. **S:** add `getActiveModel` to `parallx.d.ts`.
3. **S:** add `api.ui.attachPopupDismiss`, `api.ui.showModal`, and `api.ui.toast` with an action.
4. **M:** extend `extStyleRatchet.test.ts` to count `document.body.append`, document `keydown` and `services.get({id:` in `ext/`.

---

## 12. Consolidation plan, in order of payoff

1. **Quick bug fixes from duplication (S each, ship first):**
   - web-research settings read path and the dead `ambientEnabled`;
   - the Ctrl+T theme picker updating `px-appearance.mode`;
   - `worksheetAi` stall watchdog → copy the flashcards version (better: §10 API);
   - the token formatter /1024 vs /1000 in the details panel;
   - the media-organizer duration floor vs round;
   - the `conceptMap.ts:825` underscore rule;
   - the flashcards hardcoded Ollama probe;
   - the `#3c3c3c` ring track;
   - the duplicate search CSS;
   - dead `.ui-button`, `FilterableList` and `Textarea`.
2. **`api.format` (S–M):** `relativeTime`, `date`, `time` (zone and 12/24h from settings), `duration`, `bytes`, `tokens`, `money`, `count`, `escapeHtml`, in one module under `src/ui/format.ts`, re-exported to `api.ui`. Retires about 60 helpers across 2.1–2.9.
3. **One time zone (M):** `api.time.zone()` from `chat.timeZone`; remove the 8 `America/Chicago` literals.
4. **One markdown and math pipeline (M):** §3.1/3.2. Chat, md preview, flashcards, worksheets and widgets render math identically.
5. **`api.lm` v2 (M):** signal, timeout, priority, `pickModel`, `parseModelJson`, `buildPagedMaterial`. Retires about 20 helpers and makes background extension work broker-aware.
6. **Settings single-homing (M):** the AI panel/schema overlap, the model's four homes, extension settings panels in the hub, the Ollama URL everywhere, and a durable layer for the localStorage preferences.
7. **Kit completion (M–L):** toggle, slider, tabs, input/search, badge, progress, card, modal, toast, popover dismiss, chart, then `createTree`/`createRow` for sidebars, followed by per-extension migration with the ratchet extended to `ext/`. This removes the 4 switch sizes, about 15 progress bars, about 45 chip classes and the 22–30px sidebar rows.
8. **Logs and schedulers (M–L):** one persisted autonomy log with views, cron folded into workflows, reminders without an LLM.
9. **Events (M):** an extension emitter and namespaced pub/sub; retire the 24 `mo:*` document events and the `parallx-*` DOM events.
