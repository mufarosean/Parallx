# Core UI audit (2026-10-03)

> Part of the 2026-10-03 whole-app audit. What was fixed after this report was written is listed in [`docs/APP_AUDIT_2026-10-03.md`](../../APP_AUDIT_2026-10-03.md) §1; read that first. Paths under a `scratchpad/` folder (probe scripts, screenshots) belonged to the audit session and were not kept.

**Branch:** `fix/light-mode-and-accent-contrast` at `a768e071`, working tree clean. No repo file was edited.

**Scope:** `src/built-in/*` (canvas, chat, dashboard, planner, worksheet, settings, ai-settings, agents, explorer, search, welcome, tool-gallery, theme-editor, indexing-log, activity-log, diagnostics, output, terminal), `src/workbench` plus `src/workbench.css`, `src/parts`, `src/ui`, `src/views`, `src/aiSettings`, and the chrome of `src/editor`. Extensions (`ext/`) are out of scope.

**Rules used:** `docs/DESIGN_UNIFICATION.md`, `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md` §6, `src/theme/px-tokens.css`, `src/ui/kit.ts` plus `src/theme/px-controls.css`, and the CLAUDE.md copy rules. The prior audits (`UI_AUDIT.md`, `UI_Slop_Audit_2026-07-22.md`, `POLISH.md`, `ALPHA_UNIFICATION.md`) were checked item by item against the code (§5).

**Method:** static only. I wrote a scanner (`scratchpad/scan.py`, `heights.py`) that strips comments and counts each pattern per area. I then ran targeted `grep`s and read the main files: `settingsEditor.ts`, `chatWidget.ts`, `chatModePicker.ts`, `chatTokenStatusBar.ts`, `dashboardEditorProvider.ts`, `plannerEditorProvider.ts`, `plannerSidebar.ts`, `canvasSidebar.ts`, `pageChrome.ts`, `welcome/main.ts`, `aiSettingsPanel.ts`, `toolsSection.ts`, `worksheet/main.ts`, `emptyStates.ts`, `panelSurface.ts`, `kit.ts` and `px-controls.css`. I did not run the app, so findings that depend on rendering are marked "verify".

---

## 0. The short version

- **The core no longer has the obvious tells.** In scope there are 0 native `confirm`/`alert`/`<select>`, 0 emoji link icons and 0 marketing words (Seamless, Unlock, Powerful, AI-powered and similar all grep clean). The faint-text and placeholder contrast fixes, the S8 palette leak, the chat that waited forever, the open panel on first launch, the cover gradients and the duplicate workspace name in Explorer are all fixed.
- **The kit exists but the main screens don't use it.** I count 382 hand-built `<button>`s against about 92 kit calls. `createPageHeader` is called 13 times, all in Worksheets plus the Planner Today header. Chat, Canvas, Dashboard, Settings, Welcome, AI Settings, Appearance, Tool Gallery and the Planner tabs each draw their own header, buttons, chips, tabs, empty state and menus.
- **The type-scale debt is hidden, not gone.** Only 59 `font-size: Npx` literals remain, but there are **378 uses of `--parallx-fontSize-*`**, a second token family that is **one step smaller** than `--px-text-*`: its `base` is 12px, not 13; `md` is 13, not 15; `lg` is 14, which is off the scale. There are also 146 uses of `--parallx-radius-*`, whose `sm` is 3px, not 4.
- **Nothing guards `src/`.** `extStyleRatchet.test.ts` scans `ext/` only. `copyCompliance.test.ts` only checks object-literal `title:`, `label:` and `placeholder:` values, so `.title = '…'`, `.textContent = '…'` and `.placeholder = '…'` all escape it. Every new leak listed below gets past the existing tests.
- **Debt by area.** Canvas chrome, chat, dashboard, planner chrome and the AI Settings plus Settings pair hold most of it. Worksheets and Agents are the closest to the kit.

---

## 1. Where the debt is: counts per area

Comments are stripped and test files excluded. "Raw colours" counts only literals outside a `var()` fallback. The note below the table says which of those are data palettes.

| Area | Hand-built buttons / kit calls | `--vscode-*` refs | `--parallx-` size+radius | Raw colours (bare) | px font literal (off-scale) | Weights not 400/600 | Raw px radii | Inline `<svg>` in TS | Glyph-as-icon | Private menus | Page header (kit) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| canvas (chrome + db + props) | **110 / 2** | 356 | **161** | 139 (≈66 chrome) | 23 (18) | 26 | 97 | 1 | 5 | 3 (+ page menu) | 2 (own `_createPageHeader`) |
| chat | **50 / 0** | **414** | 68 | 17 | 6 (3) | 16 | 35 | 6 | 9 | 2 | — |
| dashboard | **34 / 0** | 201 | 0 | 18 | 6 (5) | 8 | 52 | **40** | 1 | 1 | no |
| planner | **62 / 9** | 199 | 0 | 45 (≈23 chrome) | 0 | 12 | 42 | **39** | 0 | **4** | Today only |
| worksheet | 17 / **33** | 0 | 0 | 3 | 1 (1) | 10 | 4 | 2 | 0 | 0 | **12** |
| agents (incl. workflow editor) | 11 / **42** | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | no (sidebar) |
| settings (+ shortcuts, python) | 11 / 0 | 36 | 4 | 1 | 1 (1) | 3 | 1 | 0 | 2 | 0 | no |
| aiSettings | 19 / 0 | 240 | **120** | 3 | 1 (1) | 14 | 20 | 0 | 6 | 0 | no |
| tool-gallery | 7 / 0 | 75 | 28 | 0 | 1 (1) | 10 | 0 | 0 | 2 | 0 | no |
| theme-editor (Appearance) | 9 / 0 | 0 | 0 | 26 (theme swatches, data) | 0 | 6 | 5 | 2 | 0 | 0 | no |
| welcome | 0 (rows are clickable `div`s) | 0 | 0 | 0 | 1 (28px) | 1 (300) | 0 | 0 | 0 | 0 | no |
| explorer + search | 6 / 0 | 25 | 14 | 0 | 0 | 3 | 2 | 3 | 0 | 0 | — |
| panels (indexing, activity, diagnostics, output, terminal) | 2 / 0 (use `panelSurface`) | 6 | 0 | 2 (ANSI) | 0 | 3 | 1 | 0 | 0 | 0 | — |
| workbench + css + parts + views | 12 / 0 | 147 | 49 | 1 | 1 (9px) | 5 | 10 | 11 | 1 | 0 | — |
| ui (excluding kit itself) | 15 / 6 | 136 | 43 | 65 (48 file-type icons) | 18 (8) | 10 | 20 | (registry) | 2 | 0 | — |
| editor chrome (pdf, notebook, md…) | 22 / 0 | 129 | 36 | 18 | 0 | 7 | 19 | 3 | 3 | 0 | — |
| **Total** | **≈382 / ≈92** | **1,963** | **≈524** | 338 | 59 (40) | 135 | 308 | 129 | ≈30 | ≈10 | 13 calls |

Other app-wide counts:

- **Colour fallbacks.** 1,583 hex fallbacks sit inside `var(--vscode-*, #…)`. They are dead weight once bridged, and some are wrong: `var(--px-space-8, 48px)` resolves to 32px.
- **Shadows.** 37 raw `rgba(0,0,0,…)` shadows against 42 `--px-shadow-*` uses.
- **Z-index.** 37 distinct z-index values, from 0 to 100000, and no ladder token.
- **Container queries.** Only planner (5), worksheet (1) and the dashboard grid (1) use them. Dashboard (3), canvas (2) and epub (1) size by the window with `@media`.
- **Native inputs.** 6 `type=date|time`, 3 `type=color`, 3 `type=range` (bypassing `ui/slider.ts`) and 22 native checkboxes, while `ui/toggle.ts` exists.
- **Font weights.** `500` appears 85 times, `700` 26, `650` 13, `550` 6, `bold` 4 and `300` once (Welcome).
- **Raw colours that are data, not chrome.** `fileTypeIcons.ts` (48), canvas colour menu (20), PDF export (23), cover gallery (12), legacy property migration (8), planner Google palette (11) plus calendar palette (8), PDF highlight colours (5), theme preview swatches (8) and terminal ANSI (2).
- **Raw colours that are chrome.** Shadows and scrims (≈45), the chat token ring (9), the canvas image-overlay controls (10), the `propertyBar.css` pastel signal colours (3), `aiSettings.css` error tint (3) and the markdown highlight.js colours (4).

---

## 2. Systemic findings (fix once, many screens change)

Ranked by user-visible reach.

### S-1. Main screens bypass the kit: buttons, headers, empty states, chips, tabs

**Evidence:**
- **Buttons.** 382 hand-built against ≈92 kit calls (table above). Every main screen has its own button family:
  - `.dashboard-btn` with `--primary`, `--ghost`, `--small`, `--icon-only` and `--active` (`dashboard.css:154-217`)
  - `.wfe__btn` (`workflowEditor.css:69-92`)
  - `.planner-settings__btn--primary`
  - `.parallx-chat-offline-action` (`chatWidget.ts:1561`)
  - `.canvas-empty-action--primary` (`canvasSidebar.ts:482`)
  - `.tool-gallery-install-btn` and `.settings-editor__reset`
  - 23 button classes in `aiSettings.css`, 28 in canvas and 26 in chat
- **Page headers.** `createPageHeader` is used 13 times: Worksheets 12 and Planner Today 1 (`plannerToday.ts:210`). These draw their own:
  - Dashboard: `dashboardEditorProvider.ts:258-342`, an `h1` plus 2 text buttons plus 2 icon buttons
  - Welcome: `welcome/main.ts:163`, 28px weight 300
  - Settings: `settingsEditor.ts:178`, `h2` plus a "×" glyph
  - Appearance: `pxAppearancePanel.ts:86`, `h1` at weight 650 with a subtitle
  - Tool detail: `.tool-editor-header`
  - Planner Tasks and Calendar: tabs only, no title
  - Workflow editor: `wfe` toolbar
- **Chip, pill and badge families in core CSS: 25.**
  - Canvas: `.canvas-db-chip`, `.canvas-db-pill`
  - Chat: `.parallx-chat-context-chip`, `-context-pill`, `-command-pill`, `-engine-chip`
  - Planner: `.planner-month__chip`, `.planner-today__allday-chip`, `.pl-cal__weekchip`
  - Theme editor: `.px-font-chip`, `.px-preset-chip`, `.px-accent-chip`, `.px-pv-chip`
  - Others: `.ws-chip`, `.dtracker__chip`, `.agents-rt__chip` and more
  - Kit `createFilterChip` call sites: 0 outside Worksheets and Agents.
- **In-page tab families: 10.** `.planner-pane__tab`, `.agents-tabs`, `.ai-settings-mcp-tabs`, `.canvas-cover-picker-tabs`, `.canvas-image-insert-tabs`, `.canvas-media-insert-tabs` (near-duplicates of each other), `.canvas-db-tabs`, `.excel-tabs`, `.tool-editor-tab` and `.px-pv-tab`. The kit has no tabs component.

**Fix:** migrate in this order: Chat composer and messages, Dashboard, Settings plus AI Settings, Planner chrome, Canvas sidebar and toolbars, Welcome, Tool Gallery. Use `createButton`, `createIconButton`, `createPageHeader` and `createEmptyState`. Grow the kit for what it lacks (S-4). This is the same plan DESIGN_UNIFICATION §6 step 3 wrote for extensions, applied to the core.

### S-2. A second type and radius scale, one step off, used 524 times

**Evidence:** `src/theme/workbenchDesignTokens.ts:43-59` registers `--parallx-fontSize-*` and `--parallx-radius-*`:

| `--parallx-` token | Value | Same-named `--px-` token |
|---|---|---|
| `fontSize-xs` | 10 | `--px-text-xs` 11 |
| `fontSize-sm` | 11 | `--px-text-sm` 12 |
| `fontSize-base` | 12 | `--px-text-base` 13 |
| `fontSize-md` | 13 | `--px-text-md` 15 |
| `fontSize-lg` | **14** | `--px-text-lg` 18 |
| `fontSize-xl` | **16** | `--px-text-xl` 22 |
| `radius-sm` | 3 | `--px-radius-sm` 4 |
| `radius-lg` | 8 | `--px-radius-lg` 10 |
| `radius-xl` | 12 | `--px-radius-xl` 14 |

- **Use counts.** Font size 378 (base 106, sm 102, md 96, lg 41, xs 30, xl 2) and radius 146 (sm 82).
- **Where.** aiSettings 120, canvas 161, chat 68, workbench.css 49, ui 43, editor 36, tool-gallery 28, explorer 14.
- **What it does on screen.** 43 uses of `lg`/`xl` render 14px or 16px, which are off the six-step scale (canvas 24, workbench.css 8, editor 6). Examples: canvas code blocks use `--parallx-fontSize-lg` (`canvas.css:2574`), and every `--parallx-fontSize-base` "body" text renders 12px, not 13.
- **Why it survived.** The static px-font count looks healthy (40 off-scale), but this family carries the real drift. The canvas sidebar section labels are 11px (`canvas.css:3924`) while the kit's are 12px.

**Fix:** a codemod by **pixel value**, so nothing moves:

| From (`--parallx-`) | To |
|---|---|
| `fontSize-sm` (11) | `--px-text-xs` |
| `fontSize-base` (12) | `--px-text-sm` |
| `fontSize-md` (13) | `--px-text-base` |
| `fontSize-xs` (10) | `--px-text-2xs` (badges only; review each) |
| `fontSize-lg` (14) | per site: 13 or 15 |
| `radius-sm` (3) | `--px-radius-sm` (4) |

Then alias the `--parallx-` family to `--px-` in `workbenchDesignTokens.ts` and ban new uses in a compliance test.

Same pass, bigger diff: the 1,963 `--vscode-*` references and 1,583 dead hex fallbacks. These are bridged, so there is no visual change, but rule 6.9 forbids them where a `--px-*` token exists. Do it file by file, starting with the 2 files that are mostly `--vscode-*`: `aiSettings.css` (239) and `chatWidget.css` plus `chatInput.css` (413).

### S-3. Nothing enforces the rules on `src/`; the copy test misses most strings

**Evidence:**
- **Style ratchet.** `extStyleRatchet.test.ts:44` globs `ext/*/parallx-manifest.json` only.
- **Font test.** `fontCompliance.test.ts` checks `font-family` only.
- **Copy test.** `copyCompliance.test.ts:23` checks `title:`, `label:`, `placeholder:`, `aiDescription:` and `actionLabel:` object properties only. Leaks it cannot see:
  - `"Type '/' for commands..."`: the empty-block placeholder on every canvas page (`tiptapExtensions.ts:479,481`)
  - `'Add tags...'` (`propertyEditors.ts:289`)
  - `'Additional instructions for this agent...'` (`agentSection.ts:204`)
  - `'...'` as the Explorer loading row (`explorer/main.ts:604`)
  - `'Scanning workspace...'` and `'Generating AGENTS.md...'` (`initCommand.ts:52,76`)
  - `'Copied!'` (`chatWidget.ts:1434`)
  - the em dash in AI › Tools rows (`toolsSection.ts:329`)
  - about 30 glyph icons (S-8)
  - about 75 sentence-case action tooltips (S-12)

**Fix:**
1. Extend `extStyleRatchet` to the core with a per-area baseline (`src/built-in/<x>`, `src/ui`, `src/editor`, `src/aiSettings`, `src/workbench*`).
2. Add these rules:
   - `var(--parallx-(fontSize|radius)`, `var(--vscode-`, a raw px `font-size`
   - `font-weight` other than 400/600
   - `createElement('button')` or `el('button'` outside `src/ui`, and inline `<svg` in TS
   - `type = 'date'|'time'|'color'|'range'`, and `z-index:` literals
   - the glyph set `✕✓✗↺↩↗▶▼▸▾❯✦×`
3. Extend the copy test to `.title =`, `.textContent =`, `.placeholder =`, `setAttribute('title'|'aria-label', …)` and `$('tag', 'text')`.

Counts may only fall.

### S-4. The kit breaks its own rules and is missing pieces, so the core clones

**Evidence:**
- **Weight.** `.px-btn { font-weight: 500 }` (`px-controls.css:201`), while the rule is 400 and 600 only. The other 85 uses of 500 mirror it.
- **Two primaries.** `createEmptyState` always renders its action as `kind: 'primary'` (`kit.ts:229`). Any page whose header has a primary then shows two. Live case: **Worksheets › Quizzes**, where the header primary "New Quiz" (`worksheet/main.ts:1570`) sits above an empty state whose action is also "New Quiz" (`main.ts:1581-1586`). Dashboard avoids it only with a CSS hide rule (`dashboard.css:2533`).
- **Opacity hack.** `.px-empty__headline` uses `opacity: 0.85` plus `#ddd`/`#999` fallbacks (`ui.css:875-885`). ALPHA pass 3 removed "opacity hacks" from extensions but not from the kit.
- **Header padding.** Both page-header consumers override the kit's padding (20/24/16): `.planner-today__main > .px-page-header { padding: 0 }` (`planner.css:293`) and `.ws-pane .px-page-header { padding: 0 0 var(--px-space-4) }` (`worksheet.css:482`). Nobody agrees whether the header or the page owns the gutter (see §4 L-1).
- **Missing pieces, and their clones:**

| Missing from kit / `api.ui` | Clones in core |
|---|---|
| Tabs | 10 families (S-1) |
| Toggle | 22 native checkboxes, while `ui/toggle.ts` exists but is not in the kit |
| Menu button (header secondary that opens a menu) | Worksheets reaches into the header DOM with `querySelector('.px-page-header__actions .px-btn--secondary')` and appends a chevron (`worksheet/main.ts:925-934`) |
| Date/time picker | native inputs in Planner task and event popovers (`plannerEditorProvider.ts:2387-2711`, 6), Worksheets (`main.ts:1072,1136`), Agents routine time (`agentsRoutine.ts:107`), Dashboard schedule (`dashboardEditorProvider.ts:432`) |
| Slider | native `range` in `chatEngineChip.ts:224`, `pdfExportDialog.ts:233`, `pxAppearancePanel.ts:323` |
| Modal shell | 11 scrims (S-10) |
| Toolbar with overflow | none |

**Fix:**
1. Weight 600 (or 400) on `.px-btn`.
2. Add `kind` to the empty-state action, default `'secondary'`, and recommend dropping the header primary when the view is empty.
3. Pick one gutter owner: the page header gets padding 0 and the page body gets `--px-space-6`.
4. Add `createTabs`, `createToggle`, `createMenuButton` (or `menu` on a header secondary), `createDatePicker`/`createTimePicker`, `createSlider` and `createModal` to `kit.ts`, then expose them on `api.ui`.

### S-5. Three empty-state builders, two icon-button builders, and a "cute" voice

**Evidence:**
- **Three empty-state builders:**
  - kit `createEmptyState` (`kit.ts:208`): icon, headline, hint and action
  - `renderEmptyState` (`emptyStates.ts:117`): same `.px-empty` class but **no icon and no action**, used by Planner (`plannerEditorProvider.ts:621,670`) and Tool Gallery (`main.ts:374`)
  - `createPanelEmptyState` (`panelSurface.ts:60`): `.px-panel-empty`
- **Two icon-button builders.** `createPanelToolbarButton` (`panelSurface.ts:23`) duplicates `createIconButton`.
- **Registry strings drawn in custom DOM.** Chat (`chatWidget.ts:1470`), canvas sidebar (`canvasSidebar.ts:470-512`), Welcome (`welcome/main.ts:312`), Search (`search/main.ts:457`) and the chat model picker (`chatModelPicker.ts:107`, which concatenates headline and hint with ". " and shows literal backticks around `ollama pull llama3.2`).
- **Registry voice** (`emptyStates.ts`): "Make this yours", "Start your knowledge base", "Extensions live here", "Your chats live here", "All quiet so far", "A fresh start", "Bring a model online", "What's open is in reach", "…the receipts appear here".
  - The hint rule "ALWAYS names the next action" produces two-sentence hints. Example: "Capture a task with Create, or ask the AI in chat. New tasks land in the review queue so you never break flow to plan."
  - `planner.scheduled` points at "the Workflows panel", which no longer exists (it is Agents › Routines, `agents/main.ts:99`), and nothing renders that entry any more.

**Fix:** `renderEmptyState(id)` becomes a thin call to `createEmptyState` with the registry entry's icon, plus an optional `action`. Fold `panelSurface` onto the kit (`createIconButton` at size `xs` 22, `createEmptyState`). Rewrite the registry plainly: headline = the state ("No pages yet"), hint = one sentence with the way out. Delete dead entries.

### S-6. Private menus and dropdowns still in the core (ALPHA D2's "still to verify")

**Evidence.** These are clones, not THE context menu or dropdown:

| Clone | Where | Notes |
|---|---|---|
| Chat mode picker | `chatModePicker.ts:132-134` | `parallx-chat-picker-dropdown`, `zIndex '100'`, rows are `div`s; the main chat surface |
| Chat context-pill menu | `chatContextPills.ts:105-123` | |
| Dashboard sidebar right-click menu | `dashboardSidebar.ts:297-330` | its own overlay; icons are inline SVG path strings |
| Planner task menu | `plannerEditorProvider.ts:861` | |
| Planner view menu | `plannerEditorProvider.ts:1058` | |
| Planner scope menu | `plannerEditorProvider.ts:1274` | |
| Planner calendars menu | `plannerEditorProvider.ts:2946` | |
| Canvas database row, view and add-view popovers | `databaseEditorPane.ts:524,647,658,764` | `position: fixed; z-index: 1000` (`database.css:181`), **below the app's popup floor (10001)** |

- **Leftovers.** The old chat model and context-window pickers (also clones) are still mounted and hidden with `display: none !important` (`chatWidget.css:3045-3047`).
- **Z-index.** 37 distinct values (1, 2, 3, 4, 5, 10, 50, 55, 56, 100, 1000-1200, 2575, 3000, 9000, 9500, 10000, 15000, 20000, 99999, 100000) and no `--px-z-*` ladder.

**Fix:** route all of these through `contextMenu.ts` and `dropdown.ts`, as was done for extensions. Delete the hidden pickers. Add a z ladder (`--px-z-raised / -sticky / -overlay / -popup / -modal / -toast`) and ratchet literal `z-index`.

### S-7. Destructive confirmations are toasts; two deletes have no confirmation

**Evidence:** `showWarningMessage(msg, {title:'Delete'}, {title:'Cancel'})` goes to `notify()`, a toast (`windowBridge.ts:34-37`). Ten destructive confirmations use it:

- `explorer/main.ts:1697` (Move to Trash)
- `canvasSidebar.ts:688` (Delete), `:1219` (Delete All), `:1447` (Move to Trash), `:1481`
- `canvas/main.ts:1273,1303` (delete template)
- `agentsRoutines.ts:182,210`
- `dashboardSidebar.ts:279`

`showConfirmModal` is used 20 times elsewhere, so there are two confirmation styles. Planner "Delete Forever" (`plannerEditorProvider.ts:877`) and database "Delete row" (`databaseEditorPane.ts:772`) delete with no confirmation.

**Fix:** one helper, `confirmDestructive({message, detail, confirmLabel})`, over `showConfirmModal({danger:true})`. Replace all ten and add it to the two that lack one.

### S-8. Icons: inline SVG, text glyphs, and the AI sign

**Evidence:**
- **Inline `<svg>` in TS: 129.** Dashboard 40, planner 39, chat 6, workbench and parts 11, explorer 3, editor 3. Examples: the dashboard header (`dashboardEditorProvider.ts:280-333`), the planner ⋯ drawn as **vertical** dots (`plannerEditorProvider.ts:852`, while the dictionary says `ellipsis`), and the dashboard context-menu path strings.
- **Text glyphs as icons, about 30.** Kit icons should replace these:

| Glyph use | Where |
|---|---|
| ✕ close | `chatWidget.ts:1140`, `inlineAIChat.ts:90`, `findReplaceWidget.ts:135`, `agentSection.ts:153`, `notebookEditorPane.ts:636,1153` |
| × close | Settings (`settingsEditor.ts:199`) |
| ✓/✗ prefixes | "✓ Accept", "✗ Reject", "✓ Applied" (`chatContentParts.ts:1517,1562`, `chatDiffViewer.ts:119`), "✓ Saved" (`sectionBase.ts:24`), "✓ Key saved" (`modelSection.ts:302`), "✓ Replace" (`inlineAIChat.ts:360`), bubble menu ✓ (`bubbleMenu.ts:201`) |
| ↺ reset | `keyboardShortcutsPanel.ts:134`, `sectionBase.ts:99` |
| ↩ restore, "Workspace ↩" | `chatContextPills.ts:385`, `sectionBase.ts:80` |
| ↗ | "↗ Open in canvas" (`notesWidget.ts:85`), "Docs ↗" (`mcpSection.ts:300`) |
| ▶/▼ | Tool Gallery (`main.ts:979,1008`) |
| ▸/▾ | chat (`chatContentParts.ts:1361`, `chatTokenStatusBar.ts:511`) |
| ❯ | submenu arrow (`contextMenu.ts:316`) |
| ↕ ↑ ↓ | sort chip (`databaseEditorPane.ts:213`) |
| ⚙ | in a tooltip (`chatInputPart.ts:147`) |

- **AI-sign violations.** Rule: the mark is the only sign of AI. Violations:
  - Notebook "Rewrite this cell with AI" is a **✦ sparkle glyph** (`notebookEditorPane.ts:625`).
  - Worksheets uses **`sparkles`** for Generate Items (`main.ts:931,1316,3511`).
  - Worksheets uses `message-square` for "Discuss Notes in Chat" (`main.ts:479,920`).
- **Dictionary collisions still open:**
  - `trash` vs `trash-2`: Worksheets ×3, PDF ×1.
  - `gear` vs `settings`: Welcome ×2, `menuBuilder.ts:177`, `chatIcons.ts:24`.
  - The semantic names (`action.delete`, `nav.settings`, `ai`) from DESIGN §3 do not exist in `iconRegistry.ts`.

**Fix:** a ratchet on `<svg` in TS and on the glyph set. Codemod the glyphs to `x`, `check`, `rotate-ccw`, `undo-2`, `external-link`, `chevron-right`/`chevron-down`. Use `px-ai-mark` for the two AI actions and the mark for Discuss in Chat. Add semantic aliases to the registry.

### S-9. Internal IDs and engine words shown to users

**Evidence:**
- **Settings rows.** Every row prints its raw key in mono (`settingsEditor.ts:548`, for example `canvas.versionHistory.maxPerPage`) plus a scope badge ("user"/"workspace", capitalised by CSS) (`:533`). Toggles, inputs and dropdowns use the raw key as their `aria-label` (4 sites), so screen readers read the key. The search placeholder says "key, description, category" (`:210`).
- **Keyboard Shortcuts.** Every row shows the command id (`keyboardShortcutsPanel.ts:104`).
- **AI › Tools.** Rows show snake_case tool ids in mono (`app__find_commands`, `fs_read_file`) followed by "— " and the **LLM-facing tool description** (`toolsSection.ts:325-329`). These descriptions are prompt prose, for example "reader = read-only tools (research, digest — default choice); worker = …". Native checkboxes are used, not Toggle.
- **Chat token popover:**
  - "Skills XML (N entries)" (`chatTokenStatusBar.ts:319`)
  - "Estimated (chars ÷ 4)" (`:466-467`)
  - "Overall context-window usage and token pressure live in the status bar." (`chatContextPills.ts:345`)
  - `~N tok` (`chatDiffViewer.ts:65`)
  - "[Unsupported content part: kind]"
- **Tool detail.** Tabs read "Feature Contributions" and "Runtime Status"; tables show "Command ID", "View ID", "Activation Events" and "Activation Took" (`tool-gallery/main.ts:596-903`).
- **Other.** Indexing "Docling failed, fell back to the legacy extractor" (`indexing-log/main.ts:475`). Mode tooltip "Agent mode: awake, action-capable, approval-aware" (`chatModePicker.ts:44`). AI panel search "Search managers…" (`aiSettingsPanel.ts:84`). Workflow status "Armed" (`workflowEditorPane.ts:517`). Planner settings asks the user to save to `~/.parallx/google/oauth-client.json` (`plannerSettingsPanel.ts:251`).

**Fix:** hide keys and ids unless searching, or behind a "Show IDs" developer setting. Give every tool a `displayName` and a one-line `userDescription` (separate from the model's description). Rename the jargon. Put developer tables behind a disclosure.

### S-10. Eleven modal scrims, six values

**Evidence.** `position: fixed; inset: 0` scrims:
- `canvas.css:345,538,4986` and `pdfExport.css:1` at `rgba(0,0,0,.55)`
- `dashboard.css:698,1293` at `rgba(8,12,16,.5)` with **blur 4px**
- `notificationService.css:21,247` at `.5` with blur 3px
- `ui.css:411` at `.4`
- `workbench.css:1482,2455` at `.3`
- `chatWidget.css:2714` at `.5`

The dashboard picker and settings drawer, the canvas template picker and shortcuts overlay, and the PDF export dialog each own their modal.

**Fix:** a `--px-scrim` token plus one `createModal` in the kit, built on `ui/overlay.ts`. Pick blur or no blur once.

### S-11. Seven section-label styles

**Evidence:**

| Label | Style |
|---|---|
| kit `.px-section-label` | 12/600, secondary |
| canvas sidebar | 11/600 **faint** (`canvas.css:3924`) |
| settings nav group | 11/600 faint (`settings.css:140`) |
| tool gallery group header | 11/600 (`toolGallery.css:110`) |
| icon picker | 11/600, `--vscode-descriptionForeground` |
| chat sessions | 12/600, `--vscode-sideBarSectionHeader-foreground` |
| dashboard picker | 12/600, muted |

`createSectionLabel` is used in 4 places in the core. Faint is the timestamp colour, not the section-label colour.

**Fix:** `createSectionLabel` everywhere. The two sidebars (canvas, settings nav) first, because they sit beside each other.

### S-12. Copy: split casing, three-dot leaks, naming drift

**Evidence:**
- **Action tooltip casing.** About 75 action tooltips are sentence case while the kit and planner use Title Case: "More actions" (`canvasSidebar.ts:610,756`, `dashboardSidebar.ts:151`) against the kit's "More Actions"; "New page" (`canvasSidebar.ts:444`) against "New Page" (Welcome, palette); "New dashboard" (`dashboardSidebar.ts:77`, also the **visible label**); "Copy code", "Regenerate response", "Stop generation", "Change colour", "Delete calendar", "Apply link", "Re-run checks" and "Hide header".
- **Same thing, two casings.** "Add Widget" (button) and "Add a widget" (picker title, `dashboardEditorProvider.ts:1084`).
- **Mixed case in one dropdown.** "Every Hour" and "Every 4 hours" (`dashboardEditorProvider.ts:420-421`).
- **Title Case on option labels.** "Number At The End" and "Endpoints And Counts" (year-progress widget).
- **Sentence-case section labels written as Title.** Dashboard picker: "At a Glance", "Workspace Activity", next to "AI-backed".
- **Spelling.** "colour" in Planner (4) against "color" elsewhere (72).
- **Naming drift:**
  - AI settings: "AI settings" (5), "AI Settings" (8), "AI & Models" (3) and "Overview" (the nav override) for one place.
  - "Workflows panel" (empty state and the AI's `workflowTools.ts:107,195` output to the user) for what the UI calls Agents › Routines; the coach card says "Build your routine" inside the workflow editor.
  - "Tools" still means the activity-bar extension manager (`builtinManifests.ts:293,307`), Settings › AI › Tools and the title-bar menu.
- **Glyph prefixes in labels.** "+ Blank Page" (`canvasSidebar.ts:482`) and "+ Add calendar" (`plannerSettingsPanel.ts:132`, also sentence case).
- **Exclamation.** "Copied!" (`chatWidget.ts:1434`).
- **Mobile wording.** "Tap" ×3 in the decision-coin widget (desktop app).
- **Placeholder leak.** "Upcoming events for the next **N** days." (`calendarAgendaWidget.ts:44`).

**Fix:** a casing pass driven by the extended copy test (S-3) and a glossary in `docs/` (AI Settings → "AI" in Settings; Workflows → Routines; Tools → Extensions for the manager).

### S-13. Accent used as text in 20 places; 6 undefined tokens

**Evidence:**
- **Accent as text.** `color: var(--vscode-button-background | --vscode-focusBorder | --px-accent)` or `rgba(var(--px-accent-rgb), .9)` as **text** in 20 places:
  - dashboard ×8, including the page title hover (`dashboard.css:88`) and empty-state art
  - planner ×3, including the today date and task-title hover (`planner.css:50,715,1583`)
  - canvas inline AI title ×3 (`canvas.css:4680,4734,4860`)
  - aiSettings ×2, chat ×2, PDF ×1, agents ×1

  These fail 4.5:1 in light mode (UI_AUDIT S2). `--px-accent-text` exists.
- **Undefined tokens:**

| Token | Uses | Effect |
|---|---|---|
| `--px-surface` | `workbench.css:261` (title-bar seal), `codeEditorPane.css:29`, `chatWidget.css:3041` | no fallback in the first two, so a transparent background |
| `--px-space-7` | `pxAppearance.css:15,38,41` | falls back to 32px |
| `--px-dur-normal` | `dashboard.css:2462-2491` | |
| `--px-fg-muted` | `workbench.css:933,1033` | |
| `--px-code-size` | `codeEditor.ts:142` | |
| `--px-accent-on` | `pxAppearance.css:305` | |

**Fix:** sed to `--px-accent-text`. Define or replace the six tokens. Add "every `var(--px-…)` is defined" to the token-bridge compliance test.

### S-14. Chat's "AI is thinking" styling: glows, orbs, shimmer text

**Evidence:**
- **Radial-gradient orbs with accent glow.** `box-shadow: 0 0 7–14px accent` at `chatWidget.css:515-522,605-613,640-663,1187-1194,1702-1709`.
- **Animated gradient-clipped "shimmer" text.** Presence label (`chatWidget.css:665-680`) and thinking label (`:1350-1362`). This is the stock look of generated AI UIs.
- **Planner now-line glow.** `box-shadow: 0 0 8px rgba(232,90,90,.35)` (`planner.css:1292,1426`).

**Fix:** flat 6–8px accent dots with the existing breathe animation, no glow. Text in `--px-text-muted` with a subtle opacity pulse in place of the background-clip shimmer.

### S-15. Window-width media queries inside panes

**Evidence:**
- **Dashboard.** Gutters `32px 40px 64px` shrink only when the **window** is under 800px (`dashboard.css:34-41`). A narrow dashboard pane with chat open keeps 40px gutters.
- **Canvas.** `@media (max-width:768px)` and `(min-width:1441px)` (`canvas.css:3872,3882`).
- **Epub.** `(max-width:820px)`.

**Fix:** `container-type: inline-size` on each pane host, with `@container` as the planner does (`planner.css:262-282`).

---

## 3. Main screens: local findings, ranked by user-visible impact

### Chat (right side, always visible)

1. **Composer controls are off the ladder.** Attach 26px, submit **30px** and stop 26px (`chatInput.css:138,173,213`); the textarea min-height is 44.
2. **The mode picker is a private dropdown** (S-6) with jargon tooltips (S-9).
3. **The context ring and popover bar draw VS Code's palette.** `#4ec9b0`, `#cca700`, `#f14c4c` on a `#3c3c3c` track (`chatTokenStatusBar.ts:367-373,566-572`) do not adapt to light mode or the accent. The popover note is `style.cssText = 'font-size:10px;color:#888'` (`:468`). Use `--px-success`, `--px-warning`, `--px-danger` and `--px-divider`.
4. **The offline state is better (it stalls after 6s into "Ollama isn't running"), but:**
   - Its button is bespoke (`.parallx-chat-offline-action`, `chatWidget.ts:1561`) where kit primary fits.
   - The spinner stays in the DOM in the stalled state (verify).
   - Three sentences of prose plus a link.
5. **Glyph buttons** (✕, ✓/✗ Accept/Reject, ↩, ▸) and the S-14 glows and shimmer.
6. **Engine chip shows "No Model"** in Title Case as if it were a label (`chatEngineChip.ts:77`). It is a state: "No model".
7. **About 50 hand-built buttons and 0 kit calls**; 414 `--vscode-*` references.

### Settings, including AI and Appearance (where every preference lives)

1. **Raw key under every row**, a scope badge on every row and raw keys as aria-labels (S-9).
2. **Appearance says everything twice.** The Settings `h3` "Appearance" and description "Base palette, accent color, and your saved themes." (`theme-editor/main.ts:51-55`, `settingsEditor.ts:429-436`) are followed by the panel's own `h1` "Appearance" at 22px weight 650 and the subtitle "Tune the palette and accent. Changes apply instantly across the workbench and every extension." (`pxAppearancePanel.ts:86-92`). That is two titles and two descriptions; the second subtitle restates the obvious.
3. **Settings › AI › Overview nests navigation.** A 200px Settings nav plus a 200px inner AI nav (Model / Agent / Tools / MCP Servers / Web Research) inside a `min(980px, 94vw)` overlay leaves about 540px of content (`aiSettings.css:16-18`, `settings.css:7,97`). Model, Agent, Tools and Web Research also appear in the outer nav, so the same destinations sit in two layers.
4. **Stale and self-referencing copy:**
   - "Set the API key in AI Settings → Model → Providers." shows inside Settings › AI › Providers (`chat/main.ts:430`); still open from UI_AUDIT.
   - The "AI & Models" description lists "scheduled jobs", which moved to Agents › Routines (`ai-settings/main.ts:143`).
5. **The close button is a "×" text glyph** (`settingsEditor.ts:199`). A Reset text button sits on every row (`.settings-editor__reset`).
6. **AI › Tools uses native checkboxes** and LLM descriptions (S-9).

### Dashboard (a main editor surface)

1. **Bespoke header** (`dashboardEditorProvider.ts:258-342`). Two text buttons ("Add Widget" primary, "Refresh All") plus two icon buttons; all four are hand-built with inline SVG. The title turns accent-coloured on hover as a rename affordance (`dashboard.css:88-90`; accent-as-text, S-13).
2. **Bespoke `.dashboard-btn` family** at weight 500 with `letter-spacing: .01em`; primary is `--vscode-button-background` (`dashboard.css:170-215`).
3. **Empty state** (`dashboardEditorProvider.ts:347-366`):
   - a 16px-radius dashed card, an 80px tinted rounded icon tile (`dashboard.css:254-300`), the headline "Make this yours" and a 21-word body
   - a 32px CTA, the only `-lg` button on a non-hero surface
   - the duplicate primary is hidden by CSS (`dashboard.css:2533`), so UI_AUDIT's "two primaries" is fixed, but the empty state is not `.px-empty`
4. **Widget picker:**
   - Title "Add a widget" against the button's "Add Widget".
   - The hint restates the title ("Choose what to surface on this dashboard.").
   - Section labels: "At a Glance" / "Workspace Activity" / "AI-backed".
   - 36px tinted icon tiles.
   - An own modal with blur (S-10).
5. **The page schedule dropdown mixes casing** and offers "Custom Cron…", a raw cron field (the slop audit's #12 pattern, now here).
6. **Display numerals off the scale.** 28/30/36/52px in clock, timer and tracker widgets (`dashboard.css:865,1835,1858,1925`), plus `52px/700` on the timer face. Name a `--px-text-display` step or two, as the slop audit asked.
7. **Raw shadows ×9 and scrims ×3**; the "running" widget has a sweeping gradient bar (`dashboard.css:322-330`).
8. **Sidebar.** A full-width "New dashboard" text button at the top (`dashboardSidebar.ts:74-79`) where the rule asks for a "+" in the section-label row, as Canvas has. Its right-click menu is private (S-6).

### Planner

1. **The sidebar duplicates the editor's tabs and has a Settings row.** Today / Calendar / Tasks / Settings (`plannerSidebar.ts:64-90`) against the pane tabs Today / Tasks / Calendar (`plannerEditorProvider.ts:453-457`). Still open from DESIGN_UNIFICATION §1 and authoring §6.6.2.
2. **Four private menus and 39 inline SVGs** (S-6, S-8). The task row's ⋯ is vertical dots.
3. **Native date/time inputs** in the task and event popovers (6 sites) and a native colour input for calendars (`plannerSettingsPanel.ts:147`).
4. **Uppercase micro-labels survive in the core.** Agenda day labels, month weekday header and week header (`planner.css:1551,1577,1593`; `uppercase` plus 0.08em tracking on 1551). POLISH pass 7 said the core had none.
5. **An empty Tasks tab shows the "A clear day" day-view copy** (`plannerEditorProvider.ts:621` uses `planner.day`), which talks about Create and the review queue. It renders through `renderEmptyState`, so there is no action and no icon.
6. **"Delete Forever" has no confirmation** (S-7). The now-line glow is S-14.
7. **Good:** container queries, `--px` tokens throughout, kit buttons for New Task and New Event, a kit page header on Today.

### Canvas chrome (sidebar, ribbon, menus, database; not document styling)

1. **The sidebar empty state is a wall** (`canvasSidebar.ts:466-512`). "Start your knowledge base", a two-sentence hint, **two** actions ("+ Blank Page" primary and "Use a Template…") and three `kbd` hint rows, all bespoke DOM. Use `createEmptyState`: one headline, one sentence, one action ("New Page").
2. **Section labels are 11px faint** (S-11). "Trash" is a full-width bottom button (`canvas.css:56-72`), against the rule "never a full-width button at the bottom".
3. **"Type '/' for commands..."** with three dots shows on every empty line (`tiptapExtensions.ts:479,481`).
4. **The slash menu puts Database between the headings.** Database has `order: 1`, the same as Heading 1 (`blockRegistry.ts:895`). Still open from UI_AUDIT.
5. **Database editor:** private popovers at z 1000 (S-6). "Delete row" has no confirmation. Tag colour pills are raw `rgba` (`database.css:144-152`, a data palette, but duplicated in `propertyEditors.ts:38-47`). There is a "+" text tab.
6. **Inline AI panel:**
   - Title in accent-as-text with `letter-spacing: .3px` (`canvas.css:4676-4681`).
   - "✓ Replace" and ✕ glyphs.
   - The tooltip "Send selection + conversation to main chat" uses "+" as a word.
7. **Image overlay controls** use raw white and black alphas (`canvas.css:2850-2898`). The `--px-viewer-*` tokens exist for this.
8. **The Edited stamp is `role="button"` on a `span` with no `tabindex`**, so the keyboard cannot reach Version History (`pageChrome.ts:376-381`).
9. **Counts:** 110 hand-built buttons, 161 `--parallx-` size/radius uses, 26 off weights (700 on the title is content and exempt; 500 ×15 is chrome).

### Welcome (first launch)

1. **The version is still "v0.2.0" while `package.json` says 0.1.0.** `PARALLX_VERSION = '0.2.0'` (`src/tools/toolValidator.ts:19`) feeds `api.env.appVersion` (`welcome/main.ts:170`).
2. **Title off the scale and weight.** 28px at **weight 300** with 0.2px tracking (`welcome.css:45-47`).
3. **Every action row is a clickable `div`**, with no `button` role or keyboard focus (`welcome/main.ts:197-214`, `_createRecentRow`).
4. **"AI Quick Start" carries developer rows.** "Set Up Workspace AI" has the hint "/init". "Workspace AI Config" has the hint ".parallx/" and opens `.parallx/ai-config.json`. "AI User Guide" quick-opens `docs/ai/AI_USER_GUIDE.md`, a path in **this repo, not the user's workspace**, so it probably does nothing (verify). Two rows use the `gear` icon (dictionary: `settings`).
5. **Partly fixed since the slop audit:** Start is now New Page / Open Planner / New Dashboard / Open Folder.

### Worksheets (the most kit-compliant core surface)

1. **Quizzes shows two primaries** for the same action (S-4).
2. **`sparkles` and `message-square` icons** (S-8).
3. **Native date inputs** (`main.ts:1072,1136`); still open from UI_AUDIT.
4. **Worksheets Settings is the "Budget problem".** A full-width header over a body capped at `max-width: 880px` and left-aligned (`worksheet.css:613`).
5. **Off weights and size.** 650/700 ×7 and a 40px/700 "big number" (`worksheet.css:389-399`).
6. **The header DOM hack** for the Add menu (S-4).

### Agents, Workflow editor, Tool Gallery, panels

- **Agents:** good kit adoption (42 calls). Two delete confirmations are toasts (S-7). Copy: "The heartbeat noticed something", "needs your OK", a tab named "Mind".
- **Workflow editor:**
  - Its own `.wfe__btn` family; dropdowns are now THE dropdown (fixed).
  - Statuses "Armed" and "Ready, not enabled"; the coach card says "Build your routine" and "Got It".
  - The editor opens from Agents › Routines (`agents/main.ts:99`), so Routines is the place and "Workflows panel" is a dead name.
- **Tool Gallery** (still the "Tools" activity entry, not Settings › Extensions):
  - ▶/▼ glyphs (`main.ts:979,1008`); open since 2026-07-22.
  - A 26px install button (`toolGallery.css:58`).
  - "Tool installed successfully. Enable it to start using it." is a toast, so a second step where the install could just enable.
  - Developer tabs and tables (S-9).
  - The detail body is left-capped at 600px and 500px under a full-width header (`toolGallery.css:424,530`).
- **Panels:** consistent among themselves through `panelSurface`, but a parallel kit (S-5). "Re-run checks" is a sentence-case action title (`diagnostics/main.ts:118`). Indexing pipeline badges are tracked at weight 500 with "docling"/"legacy" jargon (`indexingLog.css:95-101`).

### Workbench chrome

1. **The right-edge activity bar still exists** and now holds Chat and Agents (`builtinManifests.ts:281,354`, `workbench.ts:2708`). DESIGN §1 moves Chat to a title-bar toggle.
2. **The aux-bar header label is uppercased at runtime.** `(view?.name ?? 'SECONDARY SIDE BAR').toUpperCase()` (`workbench.ts:3005`), with a "Secondary Side Bar" placeholder label (`:2999`). The contribution handler path does not uppercase (`workbenchContributionHandler.ts:385`), so which path a view hits decides its casing.
3. **The title-bar seal pill** uses undefined `--px-surface` (transparent) and 0.2px tracking (`workbench.css:250-262`).
4. **Off-ladder heights:** the search input and replace toggle are 26px (`workbench.css:1982,2028`); window controls are 30px (OS convention, fine). Tab bars at 35px are VS Code's; no token, but consistent.

---

## 4. Layout

**L-1. Page gutters differ on every surface:**

| Surface | Top / sides / bottom | Column |
|---|---|---|
| Kit page header | 20 / 24 / 16 | — |
| Worksheets | 24 all round (header padding zeroed) | centred, max 1120 |
| Planner body | 20 / 24 / 48 (12 on compact) | Today centred, max 1180 |
| Dashboard | **32 / 40 / 64** (24/20 below an 800px **window**) | full width |
| Welcome | 32 / 24 | centred, max 720 |
| Appearance | 24 / **32** (undefined `--px-space-7`) / 32 | left, max 920 |
| Tool detail | 20 / 24 | left, max 600 / 500 |
| Settings overlay | own | `min(980px, 94vw)` |
| Agents (sidebar) | 12 | `run` cards centred, max 680 |

Fix: one rule, page body `--px-space-6` sides and `--px-space-5` top, header padding 0, as authoring §6.6.1 says. Add a shared `.px-page` with `container-type: inline-size` and an optional centred max-width (`--px-page-max: 1120px`) that **both** the header and the body sit inside, so the header never runs wider than the column (the Budget fix, generalised).

**L-2. Full-width header over a narrow left-aligned column.** Same shape as the Budget problem:
- Tool detail: Details 600px, Runtime Status 500px.
- Worksheets Settings: 880px.
- Appearance: 920px. Mostly moot today because it renders inside the 980px Settings overlay, but it appears if Appearance opens as a tab.

**L-3. Navigation crushes content** in Settings › AI (S-section 3, item 3).

**L-4. Viewport media queries in panes** (S-15). Only planner, worksheet and the dashboard grid react to their own width.

**L-5. Inconsistent "new" placement across adjacent sidebars:**
- Canvas: "+" plus a chevron split button in the section-label row.
- Dashboard: a full-width text button at the top.
- Planner: no sidebar "new"; the primary sits in the tab actions.
- Worksheets: header primary.

DESIGN §1 says always the header "+" plus the palette.

---

## 5. Prior audits: what is fixed and what is still open (verified in code)

### UI_AUDIT.md (2026-10-01)

| Item | Status | Evidence |
|---|---|---|
| S1 faint text contrast | **Fixed** | `--px-base-40: #838893` dark, `#656c78` light (`px-tokens.css:59,405`) |
| S2 accent as text | **Partly fixed** | `--px-accent-text` exists and links are bridged; 20 sites still colour text with the accent (S-13) |
| S3 `<kbd>` contrast | **Fixed** | `kbd` is `--px-text-secondary` on a base-20/15 cap (`px-controls.css:138-165`) |
| S4 placeholders | **Fixed** (via S1) | placeholder = faint, now ≥ 4.5:1 |
| S5 folder icons white | **Fixed** | `currentColor` (`fileTypeIcons.ts:118-123`) |
| S6 off-scale type and radius | **Partly fixed, partly hidden** | 59 px literals left (40 off-scale), but 378 `--parallx-fontSize` and 146 `--parallx-radius` uses on a shifted scale (S-2); 308 raw radii; still no font-size compliance test for `src/` |
| S7 uppercase micro-labels | **Core: open in Planner** | `planner.css:1551,1577,1593`; the canvas sidebar is no longer uppercase but is 11px faint |
| S8 internal commands in palette and shortcuts | **Fixed** | palette skips untitled (`quickAccess.ts:262`); shortcuts filter (`keyboardShortcutsPanel.ts:60`); shortcuts still print the id under each title (S-9) |
| S9 panel toolbar wrap (Autonomy Log) | **Fixed by retirement** | Autonomy Log moved into Agents › History and Mind |
| Shell: two activity bars | **Open** | right rail now holds Chat and Agents |
| Shell: panel open at first launch | **Fixed** | Panel part constructed hidden (`panelPart.ts:36-39`) |
| Chat waits forever without Ollama | **Fixed** | stalls into a setup state after 6s (`chatWidget.ts:1571-1579`) |
| Composer "No Model · Ctx: Default · 0%" | **Partly fixed** | one engine chip; old pickers hidden but mounted; "No Model" casing; the ring uses VS Code colours |
| Explorer shows the workspace twice | **Fixed** | single root not drawn (`explorer/main.ts:485-490`) |
| Welcome v0.2.0 against 0.1.0 | **Open** | `toolValidator.ts:19` |
| Canvas Properties block above every page | **Fixed** | legacy property bar retired; properties only on database rows (`canvasEditorProvider.ts:786`) |
| "• Saved" next to "Edited just now" | **Mostly fixed** | Saved fades after 1.5s (`pageChrome.ts:317-328`) |
| Code blocks `padding: 0` | **Fixed** | `canvas.css:2570` |
| Slash menu: Database between headings | **Open** | Database `order: 1` ties Heading 1 (`blockRegistry.ts:895`) |
| Dead `.drag-handle` CSS | **Finding withdrawn** | the class is live, used by `blockHandles.ts:100` |
| Dashboard: two primaries when empty | **Fixed** (by CSS hide) | `dashboard.css:2533`; the empty state is still bespoke |
| Planner New Task popover position | **Fixed** (verify) | anchored to the button rect (`plannerEditorProvider.ts:611`) |
| Planner "A clear day" top-aligned without action | **Partly fixed** | now `.px-empty`, but no action, and reused wrongly on the Tasks tab |
| Worksheets Start Quiz on an empty bank | **Fixed** | header primary becomes "Import Workbook…" when empty (`main.ts:917`) |
| Worksheets seven tiles | **Fixed** | three cards (`main.ts:937-951`) |
| Worksheets six tabs | **Kept by decision** (2026-10-02) | — |
| Worksheets native date inputs | **Open** | `main.ts:1072,1136` |
| Settings General = rollback flag | **Fixed** | `hidden: true` (`settingsRegistryBootstrap.ts:56`) |
| Settings raw key on every row | **Open** | `settingsEditor.ts:548` |
| Providers "AI Settings → Model → Providers" | **Open** | `chat/main.ts:430` |
| Workflow editor native-looking selects | **Fixed** | `createDropdownHandle` (`workflowEditorPane.ts:205,221`) |
| Workflow status green pill | **Fixed** | hairline ink (`workflowEditor.css:45-59`) |

### UI_Slop_Audit_2026-07-22.md

| # | Item | Status |
|---|---|---|
| 1 | Native `confirm`/`alert` | **Fixed** in core (0); note the new toast-confirmation pattern (S-7) |
| 2 | Native `<select>` | **Fixed** in core (0) |
| 3 | Emoji as system icons | **Fixed** in core; only 💡 as a default callout icon in a canvas template (content, `canvasTemplates.ts:215`) |
| 4 | Emoji in slash-command output | **Fixed**; one ✓ prefix left in `/rewind` (`openclawRewindCommand.ts:67`) |
| 5, 6, 11 | Extension items | out of scope |
| 7 | AI cover gradient `#667eea → #764ba2` | **Fixed**; identity-derived gallery (`blockRegistry.ts:1403-1417`) |
| 8 | Planner and dashboard off-ladder type | **Planner fixed** (0 px sizes); **dashboard** has 5 display sizes left with no display token |
| 9 | Status colours bypass signal tokens | **Fixed** for MCP dots and badges (`aiSettings.css:1211-1260`), cron pills (removed) and canvas `#c79dff`; **new** case in the chat token ring (§3 Chat 3) |
| 10 | GitHub alert palette duplicated | **Fixed** on signal tokens; still duplicated in 2 files (`chatWidget.css:948-983`, `markdownEditorPane.css:183-238`); markdown highlight.js still `#d7ba7d`/`#c586c0` (`:310,314`) |
| 12 | AI Hub cron UX | **Fixed** by moving to Agents › Routines; the "Custom Cron…" pattern lives on in the Dashboard schedule |
| 13 | Flat empty states | **Partly fixed.** Tool Gallery uses the registry; chat mention "No matches" (`chatMentionAutocomplete.ts:292`), timer "No matching tasks." (`timerWidget.ts:292-293`) and the chat model picker's concatenated string are still flat; three builders now (S-5) |
| 14 | ▶/▼ glyphs in Tool Gallery | **Open** (`main.ts:979,1008`), plus about 30 more glyphs app-wide (S-8) |
| 15 | "Loading..." three dots | **Fixed** in epub; six new three-dot leaks (S-3) |
| 16 | Welcome is a VS Code clone | **Partly fixed**; Start now sells the product, but version, Help kbd rows and developer AI rows remain |
| 17 | `#fff` on accent | **Fixed**; `--vscode-button-foreground` is bridged to `--px-text-on-accent` |

### POLISH.md (2026-09-03)

| Item | Status |
|---|---|
| One identity, the mark as the only AI sign | **Regressed in two places:** notebook ✦ and Worksheets `sparkles` and `message-square` (S-8); chat itself is clean (`chatIcons.ts:37-58`) |
| Pass 3 Title Case labels | **Regressing.** About 75 sentence-case action tooltips in canvas, chat and dashboard (S-12) |
| Pass 4 control-height ladder | **Mostly holds.** Exceptions: chat composer 26/30, tool gallery and PDF toolbar 26, search 26 (§3) |
| Pass 7 pills as ink, no uppercase | Pills OK; uppercase back in Planner (S-1, §3 Planner 4) |

### ALPHA_UNIFICATION.md (2026-09-22)

| Item | Status |
|---|---|
| D2 one menu system | Done for extensions; **"still to verify: the built-ins' own contextmenu listeners" is now verified, and the answer is no:** about 10 private menus remain in the core (S-6) |
| Pass 2 vocabulary | The bridge covers every `--vscode-*` name; the core still writes 1,963 of them (S-2) |

### DESIGN_UNIFICATION.md (2026-10-01)

| Item | Status |
|---|---|
| §1 Planner sidebar duplicates tabs | **Open** |
| §1 "Tools" means three things | **Open** |
| §1 Tool manager into Settings › Extensions | **Open** |
| §1 Workflows in three homes | **Mostly fixed** (Agents is the home); the name "Workflows panel" lingers in copy |
| §1 Panel closed by default | **Fixed** |
| §1 Right-edge bar | **Open** |
| §1 "New X" in one place | **Open** (L-5) |
| §2 rule 1, one primary per view | Two violations: Quizzes, and the Dashboard header plus empty state (hidden by CSS) |
| §2 rule 2, toolbars ≤ 3 icon actions | The Dashboard header has 4 (2 with text) |
| §2 rule 6, empty = one sentence and one action | Canvas sidebar, Dashboard, Planner, Welcome and Chat violate it |
| §2 rule 7, no uppercase | Planner violates it |
| §3 six sizes and two weights | Hidden debt (S-2), and the kit itself uses 500 |
| §3 one radius | 308 raw plus 146 `--parallx-radius` uses |
| §3 icon dictionary | `trash-2`, `gear`; no semantic names |
| §5 lever 3, expose the kit | 7 kit components plus dropdown and menu now on `api.ui` (was 5); tabs, toggle, input, toolbar, modal, date, slider, badge and stat still missing |
| §5 lever 4, ratchet | `ext/` only (S-3) |
| §5 lever 5, UI gallery page | **Not built** (no "Design System" surface in `src/`) |

---

## 6. AI slop check (3): what was searched and what came back

| Pattern | Result |
|---|---|
| Marketing words (seamless, unlock, powerful, effortless, AI-powered, supercharge, magic, elevate, empower, streamline, boost, cutting-edge, "at your fingertips") | **0 hits in UI strings.** Only code identifiers (`unlockRewards`) and an enum value `streamlined` |
| Lorem, "Coming soon", "not implemented" | 0 in UI. One dead end: "This kind of change cannot be applied from the chat yet." (`chat/main.ts:335`), a toast after clicking Apply |
| Exclamation marks | 1: "Copied!" |
| Emoji | 0 in system UI (💡 is template content) |
| Sparkle, robot, wand icons for AI | ✦ (notebook) and `sparkles` (Worksheets ×3). No `bot` or `wand` |
| Gradients, glows, glass | Chat orbs and glows ×5, shimmer text ×2, planner now-line glow ×2, dashboard and notification blur scrims, dashboard sweeping "running" bar. Theme swatches and cover gallery are legitimate |
| Hints that restate the obvious | Appearance subtitle; Dashboard picker hint; Quizzes subtitle "A quiz stays open until you complete it from its summary."; New Quiz tooltip "The quiz builder: papers, sources, kinds, a rating band, a length, a name."; Welcome footer |
| Walls of text | Planner day empty state (2 sentences); companion widget description (one 40-word sentence); canvas sidebar empty state (headline, 2 sentences, 2 buttons, 3 kbd rows); chat offline (3 sentences); Agents empty hint (1 long sentence); token popover notes |
| Cute or anthropomorphic voice | the empty-state registry (S-5); "The coin has spoken."; "The heartbeat noticed something"; "Mind" and "beliefs"; "Armed"; "awake, action-capable, approval-aware" |
| Decorative tinted icon tiles | Dashboard empty (80px), picker tiles (36px) |
| Cards inside cards | Not verified statically; check Dashboard empty (dashed card inside the grid area) and Planner Today side cards in the probe |
| Inconsistent naming | S-12 |
| Placeholder leak | "next N days" (`calendarAgendaWidget.ts:44`) |
| Fake metrics | None found |

---

## 7. Ranked top 20

| # | Finding | Kind | Fix |
|---|---|---|---|
| 1 | Main screens bypass the kit: 382 hand-built buttons against about 92 kit calls; `createPageHeader` only in Worksheets and Planner Today; 25 chip families, 10 tab families | Systemic | Migrate Chat, Dashboard, Settings, Planner, Canvas and Welcome onto the kit; grow the kit (tabs, toggle, date/time, slider, modal, menu button) |
| 2 | A second token family `--parallx-fontSize/radius` is one step smaller than `--px-*` (base 12, md 13, lg 14, radius-sm 3); 524 uses, 43 off-scale | Systemic | Pixel-preserving codemod to `--px-*`, alias, ban |
| 3 | No ratchet on `src/`; the copy test misses `.title =`, `.textContent =` and placeholders | Systemic | Extend `extStyleRatchet` to core areas with baselines; widen copyCompliance |
| 4 | Settings: raw key, scope badge and key-as-aria-label on every row; Appearance title and description twice; AI nav nested in Settings nav (about 540px content); stale "AI Settings → Model → Providers" and "scheduled jobs" copy | Local, main screen | Hide ids; drop the panel's own `h1` and subtitle; flatten AI into the Settings nav; fix copy |
| 5 | Chat: private mode-picker dropdown (z 100); token ring in VS Code colours; composer buttons 26/30px; glow orbs and shimmer text; glyph buttons; "Copied!"; "No Model"; jargon in the token popover and mode tooltip | Local, main screen | THE dropdown; signal tokens; ladder; flat dots; kit icon buttons; copy |
| 6 | About 10 private menus and popovers (Planner ×4, DB ×3, Dashboard, Chat ×2) at z 100 to 1000 under the popup floor; 37 z-index values, no ladder | Systemic | Route to `contextMenu`/`dropdown`; add a `--px-z-*` ladder |
| 7 | 10 destructive confirmations are toasts; Planner "Delete Forever" and DB "Delete row" have none | Systemic | One `confirmDestructive` over `showConfirmModal` |
| 8 | Dashboard: bespoke header (4 buttons, inline SVG), `.dashboard-btn` family on `--vscode-button-*`, bespoke empty state ("Make this yours", 80px tile), accent title hover, "Custom Cron…", mixed-case dropdown, blur modals, viewport-only gutters | Local, main screen | `createPageHeader` (primary Add Widget, ⋯ for the rest), `createEmptyState`, kit modal, container query |
| 9 | Planner: sidebar repeats the tabs and has a Settings row; 39 inline SVGs; native date/time ×6; uppercase weekday labels ×3; "A clear day" on an empty Tasks tab | Local, main screen | Sidebar shows content (Today, Overdue, calendars); registry icons; kit date/time; sentence-case labels; a Tasks-specific empty state |
| 10 | Kit self-violations: `.px-btn` weight 500; `createEmptyState` forces primary (Quizzes shows two "New Quiz" primaries); `.px-empty` opacity hack; header padding overridden by both consumers | Systemic | Weight 600; action `kind` default secondary; one gutter owner |
| 11 | Icons: 129 inline `<svg>` in TS, about 30 text glyphs (✕ ✓ ✗ ↺ ↩ ↗ ▶ ▼ ▸ ❯ ×); AI-sign breaks (notebook ✦, Worksheets `sparkles` ×3, `message-square` for chat); `trash-2`/`gear` collisions; no semantic icon names | Systemic | Registry icons only; glyph ratchet; mark for AI; semantic aliases |
| 12 | Internal ids and engine words shown: AI › Tools snake_case ids plus LLM prompt text after "—"; shortcut command ids; "Skills XML", "chars ÷ 4", "tok"; tool detail "Activation Events" and "Command ID" | Systemic | `displayName` and `userDescription`; ids behind search or a developer toggle |
| 13 | Canvas sidebar and chrome: empty state with 2 actions and 3 kbd hints; 11px faint section labels; full-width bottom Trash; "Type '/' for commands..."; Database ties Heading 1 in the slash menu; Edited stamp not keyboard-reachable | Local | `createEmptyState`; `createSectionLabel`; trash as a row or icon; `…`; `order: 4`; `tabindex=0` |
| 14 | Empty states split across 3 builders; registry voice is cute and wordy; `renderEmptyState` has no icon or action; dead "Workflows panel" entry | Systemic | One builder; plain one-sentence copy; delete dead entries |
| 15 | Welcome: v0.2.0 vs 0.1.0; 28px weight 300 title; rows are clickable `div`s; developer AI rows (`/init`, `.parallx/`); "AI User Guide" opens a repo path (probably dead); `gear` icon | Local, first launch | Read the version from `package.json`; `--px-text-xl` at 600; buttons; trim AI Quick Start to Open Chat |
| 16 | Copy: about 75 sentence-case action tooltips ("More actions" vs the kit's "More Actions", "New page", "New dashboard"); "Add a widget" vs "Add Widget"; "Every Hour" vs "Every 4 hours"; colour/color; AI Settings named 4 ways; "+ Blank Page" and "+ Add calendar" glyph prefixes; "Tap"; "next N days" | Systemic | Casing pass plus test; glossary |
| 17 | Accent used as text in 20 places (fails light mode); 6 undefined tokens (`--px-surface` makes the title-bar seal transparent, `--px-space-7`, `--px-dur-normal`, `--px-fg-muted`, `--px-code-size`, `--px-accent-on`) | Systemic | `--px-accent-text`; define or replace; a test that every `var(--px-*)` is defined |
| 18 | Eleven modal scrims with six values and two blur radii (Dashboard, Canvas, PDF export and Chat each own a modal) | Systemic | `--px-scrim` plus kit `createModal` on `ui/overlay` |
| 19 | Layout: page gutters differ everywhere (Dashboard 32/40/64, Appearance 24/32, kit 20/24); Budget-shaped full-width header over left-capped bodies (Tool detail 600/500, Worksheets Settings 880); viewport `@media` in panes; "new" placed four different ways | Systemic plus local | Shared `.px-page` container (header and body in one max-width column, container queries); "+" in the section-label row |
| 20 | Tool Gallery still "Tools" in the activity bar (not Settings › Extensions); ▶/▼ glyphs (open since July); 26px install button; "Tool installed successfully" toast instead of enabling; developer tabs; right-edge activity bar still exists (Chat and Agents) | Local, placement | Execute DESIGN §1 moves; kit components |
