# Accessibility: audit and fixes

The goal: Parallx is fully usable from the keyboard alone and by a screen
reader. This page holds the audit that measures it and the list of what
it found, worked through in order. An item is ticked only when the audit
(or the named check) shows it fixed in the running app.

## How it is measured

Three people are the measure: someone who cannot see and uses a screen
reader, someone who uses only a keyboard, and someone who uses only a
finger or a pen. Each must be able to do everything.

- `tests/probes/keyboard-audit-probe.mjs` runs the app hidden and muted,
  in a seeded workspace (`audit-seed.mjs`: a page with every common block
  and a cover, a concept map, a database, planner events, dashboard
  widgets, a photo library and a clip), so the controls an empty
  workspace never shows are on screen too. On every screen (each built-in,
  each extension, each seeded place, and the sub-screens their navigation
  opens) it does one unbroken Tab run, F6 through the window's areas, Alt
  for the menu bar, and the arrow keys inside every list, tab strip, tree,
  toolbar and radio group. It reads the accessibility tree (what a screen
  reader reads) for nameless controls and measures text contrast in dark
  and light mode (WCAG AA). Then its passes: dialogs (each kind opened
  from the keyboard: focus goes in, stays in when modal, Escape closes it,
  focus comes back); touch (every drag handle dragged by a finger, and by
  the mouse when the finger did nothing: touchDead); popups (on every
  screen each button that is not destructive is pressed from the
  keyboard, and whatever opens, with its submenus, gets the dialog checks
  and the name check).
  `node tests/probes/keyboard-audit-probe.mjs [outDir] [screen filter…]`
  (`dialogs`, `light`, `touch` or `popups` run just that pass).
- `tests/probes/touch-drag-probe.mjs`: a finger test for each way a drag
  starts (divider, tab, table grip, cover, planner event, concept map box,
  widget corner, Straighten dial) and that a swipe still scrolls a page.
- `tests/probes/scene-coverage-probe.mjs`: every visible interactive
  element is in the scene (0 undeclared of what Parallx draws).
- Fast gates in the unit tests (`npx vitest run`): `mousePressRatchet`
  (no new mouse-only press listener: a drag starts with `onDragPress`),
  `hoverRevealCompliance` (what `:hover` reveals, keyboard focus and touch
  reveal too), and the kit, raw DOM and style ratchets.
- The spreadsheet engine (Univer) ships inside Parallx, so it is held to
  the same standard (section 9): its grid speaks the active cell, and its
  own controls are named and reachable.

## First run, 2026-10-13

71 screens, 8 dialog kinds, light mode, 90 drags. Distinct findings:
44 controls no key reaches, 19 focusable controls the Tab order skips,
45 with no visible focus, 7 nameless, 35 mouse-only, contrast 26 (dark)
and 9 (light, after excluding the probe's own mistakes), 1 keyboard
trap, 7 of 8 dialog kinds with a problem, 39 drags with no keyboard way
and 19 with only part of one.

## The list, in the order it is fixed

### 1. Dialogs (done 2026-10-13: the dialog pass reports 0 of 8)
- [x] Command palette and quick open: already a modal dialog; the field is now a combobox naming the highlighted result (aria-activedescendant).
- [x] Context menu: opened from a focused control, focus moves to its first row and follows the arrows; Tab closes it; focus returns to the opener. Opened while typing, or with nothing focused, focus stays put (the Enter-passes-through contract).
- [x] Dropdown: the button names the highlighted option and the list it drives; Home and End jump; Tab closes; focus stays on the button.
- [x] Settings (every Overlay): a named modal dialog; focus returns to where it was on close.
- [x] Input box: a named modal dialog; Tab cycles the field and the two buttons; Escape closes from anywhere in it; focus returns.
- [x] Prompt toast: a named modal alert dialog that takes focus (Cancel first on a warning), keeps Tab on its buttons and gives focus back; ordinary toasts sit in a polite live region (errors as alerts).
- [x] Quick pick: a modal dialog; the field names the highlighted row; Tab stays on the field; focus returns.
- Found on the way: Enter on the activity bar's gear clicked the last view icon instead (the bar activated its tracked icon, not the focused button). Fixed.
- The confirm modal, input box and quick pick focus at once instead of on the next frame, so focus is never left on the opener.

### 2. Keyboard reach (done 2026-10-13)
- [x] Editor tabs (none focusable): the active tab in the Tab order, arrows move, Enter opens.
- [x] Bottom panel's view tabs: the same.
- [x] Welcome page's 12 action cards.
- [x] Open Editors list: focusable, arrows move, Enter opens.
- [x] Status bar: every item reachable (arrows from the one F6 lands on).
- [x] Segmented switches (Agents' Now / Routines / History and every other): arrows move.
- [x] Right activity bar (Chat, Agents): in F6's cycle, and its icons reachable.
- [x] Canvas page's Version History stamp.
- [x] Chat's scroll-to-bottom button.
- [x] Planner's month calendar cells (31, mouse-only): a grid the arrow keys move in, Enter opens the day.
- [x] Canvas block "+", table Add Row / Add Column: confirm the keyboard ways and make them findable.
- [x] Tab-order holes: chat view (7), auxiliary bar header (4), routine editor fields (5), diagnostics' Re-run (1).
- [x] Spreadsheet: F6 (and Escape) leave the sheet.
- [x] Planner's task popover: F6 still moves between areas, or Escape first.

### 3. Names for a screen reader (done 2026-10-13)
- [x] Dropdowns whose role sits on a wrapper (routine editor's three, Budget's account): role and name on the focusable button.
- [x] Title bar menu bar: a name.
- [x] The unnamed button in the editor tab strip.
- [x] Canvas page title and page body: names.

### 4. Visible focus (45) (done 2026-10-13)
- [x] Fields (search boxes, inputs, text areas), Appearance's buttons and switches, AI settings' switches and nav, activity bar icons, panel tabs, the tab strip's scroll button, Creations' cast card, the chat's offline link, the explorer tree.

### 5. Contrast (done 2026-10-13)
- [x] Concept Lab's paper lines and guide title (4.26:1 dark, 4.47:1 light).
- [x] Light mode: title bar menu (1.60:1), sidebar section titles (2.62:1), status bar text (2.32:1), the dashboard's "Click to rename" (1.10:1).

### 6. Drags with no keyboard way (39), and partial ones (19) (done 2026-10-13)
Each has a keyboard way that does the same thing (keys on the focused
item, a menu item, or a field), through the same save the drag uses.
- [x] Workbench: every divider (part sashes, view sections, the PDF
  outline, chat history) with View: Make Focused Area Wider / Narrower /
  Taller / Shorter (Ctrl+Alt+Shift+arrows; extensions join through
  `api.ui.registerKeyboardResize`). Activity bar icons Ctrl+Shift+Up/Down;
  view tabs and editor tabs Ctrl+Shift+Left/Right. Docking, floating,
  "beside another part" and edges: the layout commands, which ask which
  area and where when run bare. An editor tab to another group: the tab
  menu's Move to Previous / Next Group (Shift+F10 on the tab) and the two
  palette commands; next with none splits one off.
- [x] Canvas: the block menu's Move Beside Block Above (the column drop)
  and Move Into Page… (the page-card drop). Table and layout column
  widths, and database column widths from the header: Wider / Narrower.
  The cover: the reposition overlay is a slider (arrows, Page keys, Home,
  End; Enter saves). Sidebar pages: Ctrl+Shift+Up/Down among siblings,
  Right into the page above, Left out after the parent. Board cards:
  Enter opens, Ctrl+Shift+Left/Right move a column. Concept maps: Page
  Down / Up pick a box (Shift adds: the frame), Ctrl+Left/Right resize.
- [x] Dashboard: Alt+arrows move a widget a cell, Alt+Shift+arrows size it.
- [x] Planner: Enter or Space edits an event; Alt+arrows move it (15
  minutes or a day in week and day views, a day or a week in month view,
  a day for all-day bars); Alt+Shift+arrows move only its end.
- [x] Routine editor: the graph is a list of its nodes (arrows walk,
  Enter edits, Alt+arrows move, + - 0 zoom and fit, arrows pan from the
  canvas); the inspector's Connect To makes an edge.
- [x] Media Organizer: viewers zoom and pan with + - 0 and the arrows
  (compare picks its pane with 1-4); blur boxes, captions, the clip crop
  window, the image crop frame and the plan crop box move with the arrows
  and size with Alt; timeline segments and export rows are focusable
  (Enter, Delete, Ctrl+Shift+Up/Down); crop keyframes retime with the
  arrows; the export queue menu has Move Up / Down; the image editor's
  split bar and Straighten are sliders, the Remove brush moves with the
  arrows (Enter removes), tone-curve points are picked with Page keys,
  the grading wheels turn with the arrows; albums reorder with
  Ctrl+Shift+Left/Right; Move Into Album… and File Under Tag… nest; Apply
  To N Selected Items applies a tag branch. Drag-out to the OS: Open File
  Location (Ctrl+Shift+E) selects the file in the system's file manager,
  where Ctrl+C copies it for any app.
- [x] Concept Lab: the Mean Machine chart is a slider (Left/Right pick a
  bar, Up/Down set its mass).
- [x] Workspace Graph (editor and sidebar): the canvas takes focus; Page
  Down / Up pick a node, the arrows move it (or pan with none picked),
  Enter opens, Space pins, + - 0 zoom and fit.
- [x] File drops: Worksheet Generate's Choose File… (Worksheets: Generate
  Items From a File…); Media Organizer's Import Files… for single files.
- Not Parallx's: moving the window by its title bar is the system's
  (Win+arrows, or Alt+Space then Move).
- Proof in the hidden app: `mo-keys-probe.mjs`, `mo-parent-tags-probe.mjs`
  and `a11y-drags-probe.mjs`; unit tests beside each.

### 8. Touch and pen (done 2026-10-13)
- [x] The browser's drag and drop (tabs, tree rows, cards, extension items)
  answers a finger: hold a moment, then move (`installTouchDragAndDrop`,
  src/ui/touchDrag.ts, installed once for the window).
- [x] Every drag the app tracks starts on any pointer (`onDragPress`;
  `api.ui.onDragPress` for extensions). On a surface a finger scrolls (a
  page, a calendar, a board, a photo grid) a finger holds first and a
  swipe still scrolls; a tap is still a tap. Handles and canvases claim
  the finger.
- [x] Dividers take a finger (touch-action), on their own hit area. A 24px
  hit area on a touchscreen was tried and taken out (2026-10-16): the media
  query `any-pointer: coarse` is true on any computer with a touchscreen or
  pen, so with a mouse too, and the wider area lay over the editor's
  scrollbar beside the chat divider and took its drags
  (`sashHitArea.test.ts`).
- [x] Whatever a hover reveals (widget handles, row actions, block grips)
  a finger and the keyboard reveal too (`data-input-modality`,
  src/ui/inputModality.ts; 79 rules fixed).

### 9. The spreadsheet (done 2026-10-14)
The engine (Univer) ships inside Parallx, so the audit holds its own DOM
to every check (KB_SKIP_THIRD=1 sets it aside), and it passes:
- [x] The grid is a canvas a screen reader cannot read: the sheet speaks
  the active cell as the selection moves ("B7, =A1*2, 42") through a
  polite live region beside it (src/built-in/worksheet/univerA11y.ts).
- [x] Names: toolbar controls by their command (Font family, Add decimal),
  the cell reference box and its named-range list, Insert function,
  Expand formula bar, the bottom row (Add sheet, All sheets, Gridlines,
  Zoom out, Zoom in, Zoom 100%).
- [x] Reach and order: Tab goes through the toolbar, the formula bar's
  controls, then into the grid (Tab there moves cells, as in Excel); F6
  from the grid goes to the bottom row, Shift+F6 back; Tab steps through
  the bottom row and leaves the sheet; the arrows move between sheet tabs.
  The engine's buttons keep focus when the keyboard brings it (a click
  still hands it back to the grid).
- [x] Menus: a sheet tab's menu opens on Shift+F10 or the menu key, focus
  goes in, the arrows move, Escape closes it and returns to the tab. The
  engine's parked menus and its closed side panel are inert and hidden
  from a screen reader until they open.

### 10. What keeps it so
- The house rule in CLAUDE.md, and the gates above: the ratchets fail a
  change that adds a mouse-only drag or a hover-only control; the audit
  (keyboard, names, focus, contrast in both modes, dialogs, touch, popups,
  the spreadsheet engine included) and the probes (touch-drag-probe.mjs,
  a11y-drags-probe.mjs) must read 0 after any UI work.
- Found on the way and fixed: a plain web link navigated the app's own
  window, which shuts the app down (externalLinks.ts now sends every such
  link outside); the chat's model picker opened without taking focus;
  accent text on its own tint fell under 4.5:1 in light mode.

### 7. Done when
The audit reports 0 in every kind, every dialog passes, every drag has a
keyboard way, the scene coverage probe reports 0 undeclared, and the
checks pass.

Met again 2026-10-14, with the wider audit: 279 screens (every built-in,
every extension, the seeded places and their navigation; dark and light),
the spreadsheet engine's own UI included, and the touch and popup passes:
0 not focusable, 0 Tab holes, 0 areas F6 misses, 0 without visible focus,
0 nameless, 0 mouse-only, 0 dead to a finger, 0 popup problems, 0 low
contrast in either mode, 0 traps, 0 incomplete runs; dialogs 8 of 8.
touch-drag-probe.mjs (10 finger drags and a swipe) and a11y-drags-probe.mjs
(keyboard ways, the sheet's voice and menu, links) pass; typecheck, vitest,
build and the scene probe pass.

The last run's findings and their fixes: Planner's task and event
popovers said they were modal but let Tab out (they keep it inside now,
by the Settings overlay's rule, shared as `keepTabInside`); an
overflowing tab strip's scroll buttons took a Tab stop inside the tab
list (pointer helpers now; the arrows reach every tab); the routine
editor's graph was not declared (it is a list now, its nodes rows).

Still the owner's: a listen-through with a real screen reader (NVDA or
Narrator), which no probe replaces.
