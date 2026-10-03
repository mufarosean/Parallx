# Audit: dropdowns, menus, popovers, dialogs (2026-10-03)

> Part of the 2026-10-03 whole-app audit. What was fixed after this report was written is listed in [`docs/APP_AUDIT_2026-10-03.md`](../../APP_AUDIT_2026-10-03.md) §1; read that first. Paths under a `scratchpad/` folder (probe scripts, screenshots) belonged to the audit session and were not kept.

Scope: every "choose from a list / pop something up" control in `src/`, `ext/` and `electron/*.html`, on
`fix/light-mode-and-accent-contrast`. Nothing in the repo was edited.

**The tree moved during the audit.** HEAD went from `a768e071` to `f9ce86f3`. Those three commits did not touch the
files cited here except `settingsEditor.ts`, which was read after the change, and the extension files, where lines
were replaced one for one so the numbers still hold. Line numbers are against the **committed HEAD `f9ce86f3`**.
The working tree also had **uncommitted edits in progress** in four files: `plannerEditorProvider.ts`, `planner.css`,
`databaseEditorPane.ts` and `canvas/main.ts`. They move the planner task ⋯ menu and Month/Week/Day menu onto THE
context menu, add a confirm to "Delete Forever…", and add a confirm to database "Delete Row…". Where those edits
change a finding, it is marked *(in progress)*. They do not touch the planner dialogs' key handling (#3), the
recurrence prompt, or the calendars popover. The new confirms use `showConfirmModal`, so they inherit #2.

Method: grep sweeps (`document.body.appendChild` gives 92 body-level floating surfaces; `layoutPopup` 25 call sites;
`attachPopupDismiss` 20 files; `z-index`; `type = 'date'|'time'|'color'`; `show*Message(..., {title})`), a full read
of the canonical files (`src/ui/dropdown.ts|.css`, `contextMenu.ts`, `tooltip.ts`, `overlay.ts`, `kit.ts`,
`interactionMode.ts`, `dom.ts` `layoutPopup`/`attachPopupDismiss`, `api/notificationService.ts|.css`,
`commands/quickAccess.ts`), then a read of each clone. Five throwaway Playwright probes ran against the built app
(`dist/` from today) under `xvfb-run`, with a temp profile and workspace. The probes live in the scratchpad
(`verify-*.mjs`) and screenshots are in `scratchpad/shots/`. Findings marked **[probe]** were seen in the
running app, and everything else was verified by reading the code.

---

## 0. Top 15, ranked by user-visible impact

| # | Finding | Where | Fix |
|---|---|---|---|
| 1 | **Every dropdown and right-click menu inside Settings opens behind the Settings dialog.** Settings is an `Overlay` at z 20000. THE dropdown list is at 10005 and THE context menu at 10002, and both mount on `body`. Settings has 14 dropdowns in 8 sections: Planner 1, AI Overview 1, Chat 2, Suggestions 2, Agents › Heartbeat 1, Atelier 3, Browser 2, Worksheets 2. None can be picked with the mouse, because a click lands on Settings and closes the list. Right-click Cut/Copy/Paste in any Settings field opens an invisible menu that still takes arrow keys. Escape with a list open closes **all of Settings**. | `src/ui/ui.css:417-426` (`.ui-overlay` z 20000), `src/ui/dropdown.css:94`, `src/contributions/menuContribution.css:41`, `src/built-in/settings/settingsEditor.ts:179,671` | Add a z-index ladder as tokens (`--px-z-modal` < `--px-z-popup` < `--px-z-tooltip`) so popups always sit above every modal tier. Put Settings on the modal tier. Move the Dropdown onto `interactionMode` (see #3). Add a probe that opens one dropdown per Settings section. **[probe]**: `elementFromPoint` at the list centre returns `planner-settings__field`; screenshot `shots/settings-dropdown.png`; `settingsStillOpenAfterEscape: false`. |
| 2 | **Destructive confirms run on Enter even when Cancel has focus.** `showConfirmModal` handles Enter in a document-capture handler (`interactionMode`) and calls `finish(true)` whatever is focused. That defeats its own "focus the SAFE button on danger" rule. There is also no focus trap (Tab walks into the workbench behind), no `aria-modal` or `aria-labelledby`, and `exitOnWindowBlur` defaults to true, so Alt-Tab silently cancels the dialog. | `src/api/notificationService.ts:477-490`, `src/ui/interactionMode.ts:76,241-247` | Enter confirms only when focus is on the confirm button or the box itself, and is otherwise left to the focused button. Trap Tab inside the box. Pass `exitOnWindowBlur: false`. Add `aria-modal="true"` and `aria-labelledby`. **[probe]**: focus on Cancel + Enter in `workspace.resetConfig` logged `[workspace.resetConfig] reset 115 keys`, and two Tabs left the dialog. |
| 3 | **THE dropdown lets its keys through to whatever hosts it.** It has its own document listeners and is not an `interactionMode` mode. Enter and Escape call `preventDefault` but never stop propagation, so the host's Enter and Escape fire as well. Effects: in Planner's New Task and Edit Event dialogs, pressing Enter on Remind, Calendar or Repeat **saves and closes the dialog** instead of opening the list. Escape in an open list closes the whole budget transaction drawer (4 dropdowns), the PDF export dialog (capture-phase Escape), the planner dialogs, and Settings (#1). Dashboard drawers already work around this by treating `.ui-dropdown__list` as inside. | `src/ui/dropdown.ts:146-198,352-385`; hosts: `src/built-in/planner/plannerEditorProvider.ts:2591-2597,2913-2919`; `ext/budget/main.js:1779-1782,3562-3565`; `src/built-in/canvas/export/pdfExportDialog.ts:125-132`; workarounds at `src/built-in/dashboard/appearanceDrawer.ts:70`, `settingsDrawer.ts:56` | Make the open list an `enterMode({ ownedRoots: [wrapper, list], onKeydown })` like `ContextMenu`. That gives a stack, topmost-first Escape, blur, and one document listener set instead of three per instance. **[probe]**: Planner New Task, Enter on the focused Remind dropdown, gave `popoverStillOpen: false, listOpen: false`. |
| 4 | **Danger rows in THE context menu are not red.** `.context-menu*` is defined twice, in `src/ui/ui.css:587-700` and again in `src/contributions/menuContribution.css:20-70`, which loads later. The second copy wins and resets the item colour, padding (12 instead of 8), background (`editorWidget` instead of `menu`), separators (full-bleed) and z-index (10002 instead of 2575). In `ui.css`, `.context-menu-item--danger:hover` also comes before the generic `:hover`, so hover drops the danger fill even without the second file. This affects every Delete, Move to Trash and Remove row in the app (explorer, flashcards, budget, atelier, canvas tabs…). | `src/contributions/menuContribution.css:33-62`; `src/ui/ui.css:641-653` | Delete the `.context-menu*` rules in `menuContribution.css` (keep `.menu-action-btn`) and put the danger rules after the hover and selected rules. **[probe]**: danger row computed colour is `rgb(232,234,238)` (the same as a normal row), while `--px-danger` is `rgb(224,108,102)`. |
| 5 | **Confirmations come in two looks.** 51 notification calls pass action buttons. Any action turns a toast into the centred "prompt" card (20vh, severity icon tile, z 10000, its own Escape). 31 of those are plain "X / Cancel" confirms, against 16 `showConfirmModal` calls. Both looks appear inside one tool: Agents Routines uses prompts (`agentsRoutines.ts:182,210`) while Agents Mind and History use the modal (`agentsMind.ts:95,154`, `agentsHistory.ts:122`). Canvas page delete is a prompt (`canvasSidebar.ts:688,1219,1447,1481`, `canvas/main.ts:1273,1303`) and database delete is the modal (`databaseEditorPane.ts`). Explorer, dashboard sidebar, browser (5), media-organizer (13) and flashcards also use prompts. | full list in §4.3 | Migrate the 31 to `showConfirmModal`, after #2 is fixed. Add a lint or ratchet that rejects `show*Message(…{title:'Cancel'})`. |
| 6 | **Canvas has a second menu system.** It covers the block-handle menu on every block (Turn Into, Color, Duplicate, Send to Chat, Delete), the page ⋯ menu, right-click in the Pages sidebar (a "page options" popup), and the database row, view and header menus. They use rounded inset rows, radius 10/8/6 against THE menu's 4, z 1000-1010, and their own submenu hover logic. The block menu has **no keyboard support at all** and survives Escape and Alt-Tab (`tableActionMenu.ts:74-77` says so). The page ⋯ menu's toggles are non-focusable `div`s. Database "Delete row" deletes with no confirm *(a fix is in progress, uncommitted)*. ALPHA_UNIFICATION's open question "do the canvas contextmenu listeners open the core menu?" is answered: **no**. | `src/built-in/canvas/menus/blockActionMenu.ts:160,246`; `canvas/header/pageChrome.ts:916-972`; `canvas/canvasSidebar.ts:639,794→824`; `canvas/database/databaseEditorPane.ts:524,543,658,764`; CSS `canvas.css:1392-1405,3113-3124,3981-3995`, `database.css:181-184` | The kit grows first: a menu **header slot** (title or count), an **inline input row** (rename), a **toggle row**, and **colour-swatch rows**. Then move each surface onto `ContextMenu`. Until then, put the block menu on `attachPopupDismiss` the way the table menu is. |
| 7 | **The chat composer's mode picker is a hand-rolled dropdown**, and it is on screen all the time. It has no keyboard support (no arrows, Enter or Escape), sits at z 100, opens upward with `bottom` and never flips, and has no right-edge clamp. Its hidden siblings (model picker, context picker) are still built every time (`chatWidget.css:3045-3047` hides them). Picking a model has **four UIs**: the engine-chip popover, AI Settings › Model `Dropdown`, the palette command "Chat: Select Model" (a quick pick that shows a literal **`$(check) active`** and drops its placeholder and title), and the per-tool dropdowns (creations, workflow editor). | `src/built-in/chat/pickers/chatModePicker.ts:126-220`; `chatModelPicker.ts:86-152`; `chatContextWindowPicker.ts:101-160`; `src/built-in/chat/main.ts:3018-3025` | THE dropdown needs **icon + description per item** (and a non-selectable status row for "Careful"). Then the mode picker becomes `Dropdown` or `ContextMenu` with `checked`. Delete the two hidden pickers. Make `chat.selectModel` open the engine chip, or fix the quick pick (#15). |
| 8 | **THE dropdown is missing what its clones exist to provide.** The trigger arrow is a text glyph `▾` (`dropdown.ts:122`), while the chat pickers, page menu and kit use SVG chevrons. There is only one height (28), so media-organizer forces 26px and 22px (`main.js:7431,8087`) and dashboard forces padding 8/10 and radius 6 (`dashboard.css:1372`). Items cannot be disabled, have no separators or groups, no icons, no descriptions, no check mark (selection is a filled row), no typeahead, no Home/End and no search, which hurts budget's long category lists. The list radius is 4px where §6.5 says popovers use `md` 6. The list has **no entrance motion** because `px-motion.css:27-28` targets `.ui-dropdown-list` and `.ui-dropdown__menu`, which do not exist. Keyboard focus draws a double indicator (the 1px outline plus the global `button:focus-visible` ring). Hover paints an accent border whose fallback is the retired `#9333ea`. `_renderItems` registers listeners into the instance store on every `items =` and never frees them. There is no `aria-activedescendant`. | `src/ui/dropdown.ts`, `src/ui/dropdown.css`, `src/theme/px-motion.css:25-33` | Add `size: 'md'\|'sm'\|'xs'`, `IDropdownItem.{icon, description, disabled}`, a separator item, a check column, typeahead with Home/End, and a `searchable` option above N items. Draw the chevron from the icon registry, use radius `--px-radius-md` and `--px-shadow-md`, fix the motion selector, and render items into a per-render `DisposableStore`. |
| 9 | **THE context menu cannot reach submenus from the keyboard.** There is no ArrowRight or ArrowLeft, and Enter on a submenu row calls `_select(parent)`, which closes the menu and does nothing. Unreachable by keyboard: media-organizer card "Color Label" and "Add to Clip Project", PDF "Two-page spread" and "Highlight", view-container "hidden views", widget-box submenus. The menu has no typeahead, draws its marks as text glyphs (`✓`, `❯`), has 23.6px rows (off the ladder), and its rows have no description line. **Point** anchors only clamp and never flip, so ⋯ menus that pass `{x: r.left, y: r.bottom}` (flashcards `main.js:5992,6808,6914`; media-organizer `main.js:10542,10603,12165,17754 (menuAt),19799`) cover their own trigger near the bottom edge. The canvas slash menu has the same problem (UI_AUDIT item still open: `slashMenu.ts:126-129`). | `src/ui/contextMenu.ts:223-260,293,316`; `src/ui/dom.ts:254-273` | Handle ArrowRight (open submenu, focus its first row), ArrowLeft (close it) and Enter on a parent (open). Add first-letter typeahead. Draw marks from icons, set rows to `--px-control-h-sm`. Pass a rect when the anchor is an element, and give the slash menu the caret rect. |
| 10 | **Tooltip: long text spills out of the box.** It uses `white-space: nowrap` with `max-width: 400px` and no wrap or overflow rule, so engine-chip tooltips, disabled-reason tooltips and mode descriptions run past the border. Tooltips also never show on keyboard focus (the icon-only kit buttons depend on them), never hide on scroll, Escape or blur (the header comment claims scroll), and get stuck when the hovered element is re-rendered, because nothing hides them on a mouseover of an untitled element. Radius is 3px, the shadow is a hard-coded rgba, and the rule sets a font-family. There is **one** tooltip system (the `title` delegate and `setupTooltip` share one element), which is good. | `src/workbench.css:2562-2578`; `src/ui/tooltip.ts:15-16,148-153,203-236` | `white-space: normal; overflow-wrap: anywhere`; show on `focusin` with `:focus-visible`; hide on scroll, Escape, blur and `mouseover` of untitled elements; use radius `--px-radius-sm` and `--px-shadow-md`. **[probe]**: a sample tooltip measured `scrollWidth 605` against `clientWidth 398`. |
| 11 | **Planner's menus and dialogs are hand-rolled.** *(Task ⋯ and view menus are in progress, uncommitted, see the header.)* The task ⋯ menu is plain buttons with no icons. Its "Delete Forever" runs with no confirm, and its trigger is a vertical-dots SVG where everywhere else uses `ellipsis`. The calendar view menu draws its own check SVG, though THE menu has `checked`. The recurrence-scope prompt (3 choices, "Delete recurring event" in sentence case) and the calendars popover (no Escape at all) are custom. The task and event dialogs listen on the document for keys (bug #3) and mix "New task", "Edit Task", "New event" and "Edit event" casing. | `src/built-in/planner/plannerEditorProvider.ts:861,1058,1261,2363,2679,2943` | Use `ContextMenu` for the task and view menus, add a 3-choice confirm (kit gap, see §6), move the dialogs onto a kit dialog shell, and put titles in Title Case. |
| 12 | **The Pages sidebar right-click opens a 280px "page options" card** (title input, icon button, action buttons) instead of THE menu. It uses radius 10 and z 1005, has no arrow keys, and a "Delete 3 pages" label in sentence case. The **dashboard sidebar** menu is a clone ("no dependency on workbench-level menu services", with raw SVG paths in place of the registry). The dashboard **refresh-schedule popover** handles outside clicks only (no Escape, no flip). | `canvasSidebar.ts:824-1105`; `dashboardSidebar.ts:297-345`; `dashboardEditorProvider.ts:406-527` | `ContextMenu` once it has an input-row and header slot (#6); the dashboard sidebar can move today. |
| 13 | **Dates and colours: 22 native pickers and 2 custom calendars.** Native `<input type=date>` appears 11 times: Planner task and event dialogs (`plannerEditorProvider.ts:2387,2700,2711`), Worksheets settings (`worksheet/main.ts:1072,1136`, still open from UI_AUDIT), budget forms (`ext/budget/main.js:1817,3605,3936,5101`) and media-organizer filters (`main.js:12438,12440`). Native `time` appears 5 times (planner 2391/2703/2708, dashboard 432, `agentsRoutine.ts:107`). Native `color` appears 6 times (planner settings 147, dashboard appearance 95/121, budget 2973, media-organizer 23148/23358). These open Chromium's popups. The 2 custom calendars are the canvas property `_buildCalendar` (`propertyEditors.ts:559`) and flashcards `fcCalendarEl` (`main.js:6159`). That makes three date-picker looks. | as listed | Kit: `api.ui.createDatePicker` (built from the canvas calendar, which already handles date and datetime) and a colour-swatch picker (build from canvas `renderColorPalette`). Add `type=date\|time\|color` to the ratchet. |
| 14 | **Extensions ship their own modals, drawers and toasts.** creations-ai has 5 `tg-modal` dialogs with **no Escape handling** (`main.js:5797,5838,5911,6026,6125`). One of them is a menu dressed as a modal ("Manage shortcut buttons"). It also has a `tg-drawer` (`7673`) and two `tg-toast` implementations (`2909,5491`, 13px raw, z 1000). media-organizer has two dialog families: `mo-modal` (`10369,28782`) and `mo-bulk-dialog` (`18498,28159,35328`…), both z 9999. Its Library filter, view and search-help popovers (`12343,12214,12055`) and two typeahead lists (`30852,31820`) all position and dismiss themselves. budget has 3 drawers on `document.body` with a bubble Escape (`1774,3560,3904`). flashcards has `fcDateDialog` at z 10010 with an em dash in its title (`6221,6251`). The browser shields panel has no Escape (`main.js:992`). | as listed | Kit gaps first: `api.ui.showDialog({title, body, actions})`, `api.ui.showDrawer`, `api.ui.showPopover(anchor, build)` (`layoutPopup`, `attachPopupDismiss`, the token surface and focus-in on open), and `api.window.showToast(msg, {action})` that does **not** turn into a modal. Then ratchet `document.body.appendChild` and `z-index` in `ext/`. |
| 15 | **`showQuickPick` and `showInputBox` (the extension API) are thin, and there are three quick-pick implementations.** `showQuickPickModal` is not an interaction mode, does not return focus, ignores mouse hover, does not scroll the highlighted row into view, ignores `detail`, `title` and `picked`, shows **no selected state for `canPickMany`**, prints `$(icon)` literally, and its placeholder is "Select an item..." with three dots. Callers that pass VS Code's `placeHolder` lose it silently (`chat/main.ts:3024`, `ext/budget/main.js:2915`, media-organizer `11635,31760,32543`). `showInputBoxModal` has fixed "OK" and "Cancel" labels, no role, and no focus return. **Ctrl+T "Color Theme"** opens a third quick-pick clone (`workbenchThemePicker.ts:48`, z 1000) with the legacy theme list, while Settings › Appearance is meant to be the only appearance surface. The command palette (`quickAccess.ts`) is the good one: focus trap, `aria-modal`, scroll, keyboard. | `src/api/notificationService.ts:503-725`; `src/workbench/workbenchThemePicker.ts`; `src/commands/structuralCommands.ts:278-287` | Rebuild `showQuickPick` and `showInputBox` on `QuickAccessWidget`'s list and an interaction mode. Accept `placeHolder` as an alias. Retire the Ctrl+T picker or point it at Appearance. |

---

## 0.1 Status of items from the earlier audits

| Source | Item | Status now |
|---|---|---|
| ALPHA D2 / pass 1 | media-organizer private context menu (`mo-context-menu`) | **Fixed**: `showContextMenu` wraps `api.ui.showContextMenu` (`ext/media-organizer/main.js:17646-17680`, 24 call sites) |
| ALPHA | media-organizer `moDropdown` clone, `moBindCustomSelect` and 12 native selects | **Fixed**: `moDropdown` and `moSelect` wrap THE dropdown (`5104,5124`; 35 uses). A stale doc comment for the deleted `moBindCustomSelect` remains at `5088-5094` |
| ALPHA | browser `br-menu` | **Fixed**: `showMenu` wraps THE menu (`ext/browser/main.js:246`) |
| ALPHA | workspace-graph native `<select>` and 3 `window.confirm` | **Fixed** (`ext/workspace-graph/main.js:1870`; 3 `showConfirmModal`) |
| ALPHA | autonomy log `confirm()` ×3 | **Fixed**. No `confirm(`, `alert(` or `prompt(` remains in `src/`, `ext/` or `electron/` |
| ALPHA | "Still to verify: the built-ins' own contextmenu listeners (canvas 6, dashboard 3, chat 1, explorer 1)" | Chat (`chatListRenderer.ts:289`), explorer, the timer widget, tab bar, activity bar and status bar all open THE menu. **Canvas does not**: the Pages sidebar opens the page-options card, and database rows, cards and view tabs open hand-rolled popovers. The input-paste menu is dead code (see §2.2). **The dashboard sidebar does not** either (`dashboardSidebar.ts:173→297`) |
| UI_AUDIT (workflow editor) | native-looking Class and View selects next to THE dropdown | **Fixed**: both are `createDropdownHandle` (`workflowEditorPane.ts:205,221`) |
| UI_AUDIT (canvas) | slash menu runs under the panel instead of flipping up | **Still open**: point anchor, so it clamps and does not flip (`slashMenu.ts:126-129`) |
| UI_AUDIT / DESIGN §4 (planner) | New Task opens over the menu bar | **Mostly fixed**: the command and button anchor to the Create button (`plannerEditorProvider.ts:321-330,611`). The keyboard `C` path still uses a fixed rect at y=100 (`:384`) |
| UI_AUDIT (worksheets) | native date inputs in Worksheets settings | **Still open** (`worksheet/main.ts:1072,1136`) |
| AUTHORING §6.2 rule 10 | no `position: fixed` or `z-index` in extensions | **Still violated**: media-organizer 52 z-index declarations, creations 4 (modals, toasts, drawer), budget drawers, flashcards date dialog, browser panels |
| AUTHORING §6.2 rule 1 | confirmations through `api.window.showConfirmModal` | **Mostly not followed in ext**: 26 notification-prompt confirms against 10 modal confirms (see §4.3) |

---

## 1. Choosing from a list: dropdowns, pickers, autocomplete

### 1.1 Canonical: `Dropdown` (`src/ui/dropdown.ts`, `dropdown.css`; `api.ui.createDropdown`)

Who uses it: 17 `new Dropdown` in src (planner 6, database 4, PDF export 2, dashboard 2, settings 1, AI model 1, planner
settings 2) plus 7 `createDropdownHandle` (workflow editor) plus the dashboard `createSelect` shim (4). In
extensions: budget `makeDropdown` (18 uses), media-organizer `moDropdown`/`moSelect` (35), flashcards (7),
creations `tgSelect` (27, with a native `<select>` fallback that is only reached on hosts without the API,
`ext/creations-ai/main.js:4777`), browser (1), workspace-graph (1).

What it gets right: the list mounts on `body` with `position: fixed`, so scrolling ancestors no longer clip it. It
flips and clamps through `layoutPopup`. It has a scroll guard plus `overscroll-behavior: contain`, it closes on
focus loss, `mousedown` `preventDefault` keeps the click from being lost, it has colour swatches, `setItems(items, selected)`,
and the trigger height is `--px-control-h` (28) with radius `--px-radius-sm`.

What is wrong or missing:

- **Not an interaction mode** (`dropdown.ts:146-198`). It keeps its own `mousedown`, `scroll` and `resize` listeners
  installed for the instance's whole life, including while closed, and adds a wrapper `keydown`. Keys propagate to the
  host (#3), there is no window-blur exit, and a menu over a dropdown does not stack.
- **z-index 10005 is below the modal tier** (20000: `.ui-overlay`, `.parallx-modal-overlay`), so the list is invisible in
  Settings (#1).
- **Trigger glyph** is the text `▾` at `--parallx-fontSize-xs`, opacity .7 (`dropdown.ts:122`, `dropdown.css:42-47`).
  Other "opens a list" triggers use the SVG `chevron-down` (chat pickers via `chatIcons.chevronDown`, the canvas page menu
  font button), and the canvas property type picker uses text `▾` too (`propertyPicker.ts:146`).
- **One size only.** No `sm` (24) or `xs` (22), so consumers override it: media-organizer `.mo-player-speed
  .ui-dropdown__button { height: 26px }` (`main.js:7431`), `.mo-ce-segspeed … min-height: 22px` (`8087`);
  dashboard `.dashboard-select .ui-dropdown__button { padding: 8px 10px; border-radius: 6px; }` (`dashboard.css:1372`).
- **Item model is too thin:** `IDropdownItem` is `{value, label, color?}`. No `disabled`, `icon`, `description`,
  separators or group headers, and no check mark (selection is a filled `activeSelectionBackground` row; THE menu
  uses `✓`, the engine chip uses `✓` plus `aria-pressed`, the planner view menu uses an SVG check).
- **Keyboard:** ArrowUp, ArrowDown, Enter, Space and Escape only. No Home/End, PageUp/PageDown or typeahead. No
  search for long lists (budget categories, Atelier lists). No `aria-activedescendant` or `aria-controls`, so
  screen readers do not hear the moving option.
- **Look:** list radius `--parallx-radius-sm` (4px, legacy alias) where §6.5 says popovers use `md` (6). Shadow is a
  hard-coded `0 2px 8px` rather than `--px-shadow-md`. Hover paints the trigger border with `--vscode-focusBorder`, whose
  fallback is the retired `#9333ea` (`dropdown.css:32-40`). On keyboard focus the trigger gets two indicators: its own
  1px outline plus the global `button:focus-visible` ring (`px-controls.css:48-56`).
- **Motion:** `px-motion.css:26-29` gives `.context-menu` a pop-in but names `.ui-dropdown-list` and `.ui-dropdown__menu`,
  which do not exist, so the dropdown list appears with no motion. **[probe]**: `animationName: none`.
  `.parallx-chat-context-menu` in the same rule is the trigger wrapper, not the panel.
- **Leak:** `_renderItems` (`dropdown.ts:270-302`) adds two listeners per item to the instance's `_register` store on
  every `items =`, and they are freed only when the dropdown is disposed.

### 1.2 Every other "choose from a list" implementation

| Where | What | How it differs from THE dropdown | Impact | Fix |
|---|---|---|---|---|
| `src/built-in/chat/pickers/chatModePicker.ts:126-220` | Chat mode (Edit/Agent) plus the Careful toggle row, **always visible** in the composer | Absolute list on `body` at z 100. Opens upward with `bottom`, with no flip and no right clamp. Mouse only: no arrows, Enter or Escape. Own `mousedown` listener. Items have icon and description (THE dropdown cannot). Selection is a filled row | High | Dropdown with icon and description, or `ContextMenu` with `checked` and a status row |
| `chatModelPicker.ts:86-152`, `chatContextWindowPicker.ts:101-160` | Model and context-size pickers | Same clone, z 100; **hidden** whenever the engine chip mounts (`chatWidget.css:3045-3047`, `chatWidget.ts:402`), but still built and wired | Dead UI | Delete |
| `src/built-in/chat/widgets/chatEngineChip.ts:155-172` | Model list, context slider and usage in one popover | Correct primitives (`layoutPopup` and `attachPopupDismiss`), z 1000, radius 10. Model rows are buttons with a text `✓`. Focus is not moved into the popover on open, so Tab from the chip skips it. Off-scale 10px and 10.5px text (`chatWidget.css:3099,3107`), weight 500 | Medium | Focus the active row on open; scale tokens |
| `src/built-in/chat/input/chatInputPart.ts:614-795` | Add Context file picker (search plus multi-select checkboxes) | Absolute on body, z 100, fixed 340px wide from the attach button's left, opens upward with no flip, clamp or arrow keys; native checkboxes | Medium | Kit multi-select or searchable list (quick-pick style) |
| `chatMentionAutocomplete.ts:442-456` | `@` and `/` autocomplete | Keyboard is fine (arrows, Enter/Tab, Escape). z 200, `bottom`-anchored with no flip or right clamp; closes on textarea blur after 150ms | Low–Med | Shared anchored-list primitive |
| `chatContextPills.ts:105-170` | Context menu panel | `layoutPopup`, but its own permanent document `mousedown`, `keydown` (Escape, not stack-aware), resize and scroll listeners; trigger arrow is text `▴`/`▾` (`:246`) | Low | `attachPopupDismiss`; icon chevron |
| `src/built-in/canvas/properties/propertyEditors.ts:390-470` | Page-property **select** value picker (colour swatch, "Clear") | Div rows, `mousedown` only, **no keyboard**. Positioned `rect.bottom+2` with no flip; z 2575; radius 4. "Clear" colour inlined with an rgba fallback. THE dropdown already has swatches | Medium (every database or page property) | Dropdown with a "Clear" item |
| `propertyEditors.ts:300-335` | Tag autocomplete | Own list, no flip, z 2575 | Low | Shared anchored list |
| `src/built-in/canvas/properties/propertyPicker.ts:131-190` | Property **type** picker inside "Add property" | Nested hand-rolled dropdown "so icons render"; text `▾` | Low | Dropdown with icons |
| `src/built-in/canvas/header/pageChrome.ts:1091-1140` | Font picker inside the page ⋯ menu | Collapsible list, self-previewing rows, radius md; a second font-picker design next to Appearance's chip row (`pxAppearancePanel.ts:112-145`) | Low | Pick one |
| `src/built-in/planner/plannerEditorProvider.ts:1058-1092` | Calendar view (Month/Week/Day) | Hand-rolled menu with an inline check SVG and its own positioning | Medium | `ContextMenu` with `checked`, *(in progress in the working tree)* |
| `src/workbench/workbenchThemePicker.ts:48` | Ctrl+T Color Theme | Quick-pick clone, z 1000, legacy theme catalogue | Medium | Retire or route to Appearance |
| `ext/media-organizer/main.js:12343` (+CSS `5955-5979`) | Library **tag filter popover** (search, include/exclude tri-state, depth) | Own positioning and dismissal (capture `mousedown`/`keydown`), z 1000, radius lg | Medium (Atelier's main screen) | Kit popover; tri-state is a legitimate need |
| `ext/media-organizer/main.js:12214` | Library view popover | Same pattern | Medium | Kit popover |
| `ext/media-organizer/main.js:30852,31820` | Typeahead suggestion lists | Own lists; second one flips manually | Low | Shared anchored list |
| `ext/browser/main.js:308,930` | Address-bar suggestions | Absolute inside the container (rule 10 compliant), arrows, Escape; 12px raw | Low | Fine; tokens |
| `electron/recorderFrame.html:61-71` | Recorder size panel (separate window) | Hard-coded dark colours, an uppercase 10px header, hover `#3b82f6`, text caret | Low (separate window, cannot load the kit) | Tokens copied in |

### 1.3 Native and custom date, time and colour pickers

22 native inputs (11 date, 5 time, 6 colour) are listed in #13, plus 2 custom calendars (canvas property
`propertyEditors.ts:559`, flashcards `fcCalendarEl` `main.js:6159`). There is no kit date or colour picker.

---

## 2. Menus: context, overflow, menubar, quick pick

### 2.1 Canonical: `ContextMenu` (`src/ui/contextMenu.ts`; `api.ui.showContextMenu`; kit header ⋯)

Who uses it: 22 `ContextMenu.show` call sites in src (titlebar menubar, Manage, explorer, editors, PDF, view
containers, status bar, layout, widgets, worksheet, timer widget, chat list, editable-field menu) plus extensions
through the API (media-organizer 24, flashcards 9, budget 3, browser 1, creations 1).

Good: it is an interaction mode (Escape, outside press, blur and anchored scroll, stack-aware, focus return),
`layoutPopup` flips rect anchors, it skips disabled rows, has a `checked` mark column, tooltips, keybinding hints,
icons, submenus on hover, danger rows, and a single selection tap for the activity journal.

Problems:
- **Two CSS definitions** (#4): `ui.css:587-700` and `menuContribution.css:20-70`. The later one wins on z-index (10002),
  background, item padding, separator and item colour, and **erases the danger colour**.
- **Keyboard:** no ArrowRight or ArrowLeft into or out of submenus. Enter on a submenu parent fires `_select(parent)`
  (`:246-251`), so submenus are mouse-only. No typeahead or mnemonics.
- **Glyphs:** check `✓` (`:293`) and submenu `❯` (`:316`) are text characters, not registry icons.
- **Metrics:** rows are 23.6px (padding 4 at 13px; **[probe]**), not set to `--px-control-h-sm`; container radius 4
  (popovers are `md` 6 per §6.5); padding-left 12 (from the duplicate rule) where 8 was intended.
- **Missing slots** that the clones exist for: header line (block menu "Paragraph" / "3 blocks selected"), inline
  input (rename), toggle row, swatch row, description line under a label.
- **Placement:** point anchors only clamp (`dom.ts:254-273`), so button menus passed as points (flashcards,
  media-organizer `menuAt`) do not flip.
- **A11y:** the menu never takes focus and there is no `aria-activedescendant`.

### 2.2 Every other menu implementation

| Where | What | Differs how | Impact | Fix |
|---|---|---|---|---|
| `src/built-in/canvas/menus/blockActionMenu.ts:160,246` (+ Turn Into and Color submenus at `388,441`) | Block-handle menu on **every canvas block** | Own DOM and submenu hover handoff, radius `--parallx-radius-lg` (10), z 1002, inset rows, header line, "Turn into" in sentence case. **No keyboard, no Escape, no blur exit** (only the canvas registry's outside `mousedown`) | High | Kit header slot, swatch rows, then `ContextMenu` |
| `tableActionMenu.ts:91,169` | Table grip menu | Own DOM, but on `attachPopupDismiss` (Escape and blur); no arrows | Medium | `ContextMenu` |
| `canvas/header/pageChrome.ts:916-1000` | Canvas page ⋯ menu (font, Full Width, Small Text, Lock Page, Favorites, Duplicate…) | Radius 10, z 1002; toggles are **non-focusable `div` rows** with a custom switch (not `src/ui/toggle.ts`); point anchor computed by hand, so it does not flip | High | `ContextMenu` with `checked` (or a toggle row) |
| `canvas/canvasSidebar.ts:639,794 → 824-1105` | Pages sidebar right-click and row ⋯ | 280px card: title `InputBox`, `IconPicker`, action buttons; radius 10, z 1005, rows radius lg; "Delete 3 pages" | High | Kit input-row and header slot, then `ContextMenu` |
| `canvas/database/databaseEditorPane.ts:524,543,549,647,658,696,730,764` | Database header, view, add-view, row menus and filter/sort popovers | `_menuItem` buttons in a generic popover; radius 6, z 1000; `rect.bottom+4` with no flip; "Delete row" runs with no confirm *(a confirm is in progress in the working tree)*; the row menu creates a temporary fixed `span` anchor | Medium | `ContextMenu` for menus; kit popover for filter and sort |
| `src/built-in/planner/plannerEditorProvider.ts:861-900` | Task ⋯ menu | Buttons, no icons, radius 8, z 1100 overlay, vertical-dots SVG trigger, "Delete Forever" with no confirm | Medium | `ContextMenu` with danger and confirm, *(in progress in the working tree; trigger is still the vertical-dots SVG)* |
| `src/built-in/dashboard/dashboardSidebar.ts:297-345` | Dashboard page right-click | Clone with raw SVG `path` strings for icons, radius 8, own overlay | Medium | `ContextMenu` (can move today) |
| `src/built-in/canvas/menus/inputPasteContextMenu.ts:83` | Right-click "Paste" in canvas insert-popup URL fields | **Dead**: `EditableContextMenu` (`src/contributions/editableContextMenu.ts:248-292`, installed at `workbench.ts:872`) catches `contextmenu` in the document capture phase and calls `stopPropagation`, so the input's own listener never runs and THE editable menu shows instead | Dead code | Delete the file and the `.canvas-input-paste-menu` CSS |
| `canvas.css:4283` `.canvas-context-menu` | CSS for a canvas menu | No TS uses it | Dead CSS | Delete |
| `canvasSidebar.ts:23,96,1123` | `ContextMenu` import and field | Never assigned | Dead code | Delete |
| `ext/creations-ai/main.js:5796` | "Manage shortcut buttons" | A 3-choice **menu built as a modal** | Low | `showContextMenu` |
| Canvas bubble menu and PDF selection bubble | Formatting and selection toolbars | Toolbars, not menus: a legitimate separate pattern. The PDF bubble's "Ask AI" uses the mark (correct) | n/a | n/a |

### 2.3 Menubar and quick pick

- Menubar (`src/parts/titlebarPart.ts:292-400`) uses THE menu, with lateral arrow navigation between menus. Good.
- Quick pick has **three** implementations: `QuickAccessWidget` (`src/commands/quickAccess.ts:977-1040`: focus trap,
  `aria-modal`, the best of the three), `showQuickPickModal` (API, #15) and `workbenchThemePicker` (Ctrl+T, #15). The
  palette overlay sits at **z 1000** (`workbench.css:1488`), below toasts and prompts (10000), the quick-pick modal
  (20000) and Settings (20000).

---

## 3. Popovers, hover cards and tooltips

### 3.1 Tooltip (`src/ui/tooltip.ts`; `.parallx-tooltip` in `workbench.css:2562-2578`)

There is **one** system: the global `title` delegate and `setupTooltip` share a singleton at z 100000. It has
problems (#10): nowrap overflow **[probe]**, no keyboard focus trigger, no scroll, Escape or blur hide (the
comment at `:15-16` says scroll), it can stick on re-render, the delegate always places on top, radius 3px, a hard-coded
rgba shadow, and it sets a font-family. No second tooltip system was found in `src/` or `ext/`. Charts use `title`.

### 3.2 Popovers

The kit has **no popover component**. The shared primitives are `layoutPopup` (25 call sites) and `attachPopupDismiss`
(20 files). Popovers that skip one or both: chat mode, model and context pickers, the Add Context file picker,
mention autocomplete, context pills, dashboard schedule popover (`dashboardEditorProvider.ts:406-527`, outside
`mousedown` only), planner menus, dialogs and calendars popover (`:2943`, no Escape), media-organizer search-help, view and
filter popovers (`12055,12214,12343`), media-organizer suggestions, browser shields (`main.js:992`, no Escape),
`IconPicker` (`src/ui/iconPicker.ts:278-335`, its own capture `mousedown` and `keydown`, not stack-aware: Escape inside it
closes the page-options card around it too), and the property select and tag lists.

Popover radii in use: 3 (tooltip), 4 (THE menu, THE dropdown, property lists), 6 (database, chat picker), 8 (planner,
dashboard, media-organizer search help), 10 (canvas menus, engine chip, icon picker, media-organizer filter). §6.5 says `md` (6).

---

## 4. Modals, dialogs, drawers and toasts

### 4.1 Canonical pieces and their faults

- `showConfirmModal` (`notificationService.ts:414-499`): #2 (Enter, focus trap, blur, ARIA). There are only
  **two buttons**, which is why media-organizer `moEditAskSave` (`35328`, 3 choices), planner `_askSeriesScope` (`1261`,
  3 choices) and the save-on-close prompts use native OS boxes (`workbench.ts:2495`, `fileEditorInput.ts:156`,
  `untitledEditorInput.ts:153`, `notebookEditorInput.ts:137`: "Save / Don't Save / Cancel"). It needs an `actions[]`
  form. Labels at call sites drift: "Reset all" (`settings/main.ts:195`), "OK" by default.
- Notification prompts (`notify()` with any action, `notificationService.ts:166-200`, CSS `:29-46`): the second confirm look (#5). Any action
  makes the toast **modal**, so there is no non-blocking "Undo" toast. That is why canvas has its own undo toast
  (`canvasSidebar.ts:1906`, text `×` close), creations has `tg-toast` with an action (`5491`), plus media-organizer `mo-ce-toast`
  (`22179`), `mo-edit-toast` (`36505`) and the keyboard-shortcuts `kbs__toast` (`keyboardShortcutsPanel.ts:256`).
  Prompt Escape is its own document-capture listener, not an interaction mode. Notification action buttons use
  radius `md` while modal buttons use `sm` (`notificationService.css:171,333`).
- `showInputBoxModal` and `showQuickPickModal`: #15.
- `Overlay` (`src/ui/overlay.ts`): used only by Settings. No focus trap. Escape is bound on the overlay element
  (`overlay.ts:90-97`), so it only works while focus is inside it, and it is not an interaction mode.
- No generic **dialog** (title, body, actions), **drawer** or **sheet** component exists.

### 4.2 Hand-rolled modals, drawers and sheets

| Where | What | Escape / focus / z | Notes |
|---|---|---|---|
| `plannerEditorProvider.ts:2340-2600, 2650-2925` | Task and event dialogs | document bubble `keydown` (Enter saves, Escape closes; #3); z 1150; focus on title | `color-mix(... , white)` surface instead of `--px-bg-elevated` (`planner.css:771`); casing drift |
| `plannerEditorProvider.ts:1261-1320` | Recurrence scope prompt | document `keydown` Escape | 3-choice confirm |
| `plannerEditorProvider.ts:2943-3060` | Calendars popover (colour swatches, new calendar) | **No Escape**; overlay click only | |
| `canvas/export/pdfExportDialog.ts:105-132` | Export as PDF | capture Escape closes even over an open dropdown | hosts 2 Dropdowns |
| `canvasTemplatePicker.ts:154-167`, `canvasShortcutsOverlay.ts:161-170`, `canvasVersionHistoryPanel.ts:144-149` | Template picker, shortcuts sheet, version history | own Escape | separate shells |
| `dashboardEditorProvider.ts:1062-1182` | Widget picker sheet | capture Escape | |
| `dashboard/appearanceDrawer.ts`, `settingsDrawer.ts` | Drawers | `attachPopupDismiss` with the `.ui-dropdown__list` exception | drawer #1 and #2 |
| `chat/widgets/chatWidget.ts:1390-1443` | System Prompt viewer | `attachPopupDismiss` | "Copied!" with an exclamation mark |
| `ext/budget/main.js:1774,3560,3904` (CSS `997-1030`) | Transaction, holding and goal drawers | bubble Escape (closes over an open dropdown), z 1000, `document.body` | drawer #3 |
| `ext/creations-ai/main.js:5797,5838,5911,6026,6125` (CSS `1158-1170`) | Five modals | **No Escape** | |
| `ext/creations-ai/main.js:7673` (CSS `~1620-1631`) | Drawer, z 40 | | drawer #4 |
| `ext/media-organizer/main.js:10369,28782` (`mo-modal`, z 9999) and `18498,18554,18651,28159,35328` (`mo-bulk-dialog`, z 9999) | Two dialog families | overlay-scoped Escape on some | `aria-modal` on `moEditAskSave` only |
| `ext/flashcards/main.js:6221` (CSS `5004`, z 10010) | Exam-date dialog | capture Escape | title "Exam Date — {deck}" (em dash) |
| `ext/browser/main.js:1117` | HTTP auth prompt | own | |
| `ext/workspace-graph/main.js:1472` | Settings side panel (inline styles, z 10) | | |

### 4.3 Confirm-shaped notification prompts (should be `showConfirmModal`)

There are 31 calls of the form `show*Message(msg, {title:'X'}, {title:'Cancel'})`. In `src/`: explorer
`main.ts:1697`; agents `agentsRoutines.ts:182,210`; canvas `canvasEditorProvider.ts:414`,
`canvasSidebar.ts:688,1219,1447,1481`, `canvas/main.ts:1273,1303`; dashboard `dashboardSidebar.ts:279`. In `ext/`:
media-organizer `11179,11413,11434,11661,14460,16688,19619,20025,25694,25746,28826,29946,30788,38566`; browser
`1407,1424,1442,1604,1687`; flashcards `3145`; creations-ai `10055`. A further 20 action prompts are informational
choices.

---

## 5. Cross-cutting

### 5.1 The z-index "ladder" as it actually is (no tokens exist)

| z | Surface |
|---|---|
| 100000 | tooltip |
| 20000 | `.ui-overlay` (**Settings**), `.parallx-modal-overlay` (confirm, input box, quick pick) |
| 10010 | flashcards date dialog |
| 10005 | **THE dropdown list** |
| 10002 | **THE context menu** (from the duplicate rule; `ui.css` says 2575) |
| 10000 | toasts, notification prompts, token popup |
| 9998–9999 | media-organizer search help, `mo-modal`, `mo-bulk-dialog` |
| 2575–2576 | canvas property popovers |
| 1100–1200 | planner menu and popover overlays, dashboard modal |
| 1000–1010 | slash, bubble, block, page menu, page options, icon picker, engine chip, **command palette**, theme picker, database popover, budget drawer, creations modal and toast, media-organizer filter popover |
| 100–200 | chat mode, model and context pickers, Add Context, mention autocomplete |
| 40 | creations drawer |

Consequences: popups sit below the modal tier (#1). Toasts and prompts (10000) render under Settings (20000). The
command palette (1000) sits below the canvas menus. Fix: `--px-z-*` tokens with one rule, *popup > modal > page
chrome*, and a compliance test that rejects raw `z-index` in `src/**/*.css` and `ext/`.

### 5.2 Dismissal contracts in use

1. `interactionMode` (THE menu, confirm modal, `attachPopupDismiss` users): correct and stack-aware.
2. Own document listeners: THE dropdown, `IconPicker`, chat pickers, context pills, notification prompts, planner, budget,
   creations, media-organizer, flashcards, browser.
3. None or partial: the canvas block menu (outside `mousedown` only), planner calendars popover, creations modals,
   browser shields.

Contract 2 is what produces #1's Escape and #3. THE dropdown and `IconPicker` both live in `src/ui/`, so moving them
onto contract 1 fixes every host at once.

### 5.3 Row heights and glyphs

Menu and list row heights: THE menu 23.6, THE dropdown 28, canvas block menu about 32, chat picker about 30, planner menu
about 27, dashboard menu 26/28, database about 27. Text glyphs where the registry has icons: `▾` (THE dropdown, property type
picker, context pills `▾`/`▴`, workspace-graph "History ▾" `main.js:1725`), `✓` (THE menu, engine chip), `❯` (THE menu
submenu), `×` (Settings close `settingsEditor.ts:197`, canvas toast close).

### 5.4 Light mode

The canonical components and most clones take colour from bridged `--vscode-*` or `--px-*` tokens, so none of these
surfaces is hard-coded dark in the main window. Risks are limited to literal fallbacks and shadows (`tooltip`
`rgba(0,0,0,.36)`, `tg-toast` `rgba(0,0,0,.3)`, budget and media-organizer backdrops `rgba(0,0,0,.5)` like the core) and the recorder frame,
which is fully hard-coded dark.

---

## 6. What the kit needs first (so migrations are possible)

1. **Z-ladder tokens** with popups above modals. This alone fixes #1.
2. **Dropdown on `interactionMode`**, plus `size`, item `icon`/`description`/`disabled`, separators, check column,
   typeahead/Home/End, `searchable`, and a registry chevron. That retires the chat clones, the property pickers and the media-organizer and dashboard overrides.
3. **ContextMenu keyboard submenus and typeahead**, registry glyphs, rows on the 24 ladder, plus **header, input-row, toggle-row
   and swatch-row** slots. That retires the canvas, planner, dashboard and database menus.
4. **`showConfirmModal` fixes and an `actions[]` form**. That retires the notification-prompt confirms, the 3-choice dialogs and the native save boxes.
5. **`api.ui.showPopover(anchor, build)`, `showDialog`, `showDrawer`, and `showToast({action})`** that stays non-modal.
6. **Date picker and colour-swatch picker** in the kit.
7. **Tooltip**: wrap, keyboard focus, scroll and Escape hide.
8. **Quick pick and input box** rebuilt on `QuickAccessWidget`.

## 7. Ratchet additions (extend `tests/unit/extStyleRatchet.test.ts`, and add an `src/` sibling)

- `bodyOverlay: /document\.body\.append(Child)?\(/`
- `zIndex: /z-index\s*:|zIndex\s*=/`
- `nativePicker: /type\s*=\s*['"](date|time|datetime-local|color|month)['"]|type:\s*['"](date|time|color)['"]/`
- `promptConfirm`: a `show(Warning|Information|Error)Message` call whose arguments contain `title:'Cancel'`
- `nativeSelect` should also match `el('select'` (creations' fallback escapes the current regex)
- A probe that opens one dropdown and one right-click menu in **every Settings section and every modal**, and asserts that
  `elementFromPoint` hits the popup.
