# Accessibility: audit and fixes

The goal: Parallx is fully usable from the keyboard alone and by a screen
reader. This page holds the audit that measures it and the list of what
it found, worked through in order. An item is ticked only when the audit
(or the named check) shows it fixed in the running app.

## How it is measured

- `tests/probes/keyboard-audit-probe.mjs` runs the app hidden and muted.
  On every screen (each built-in, each extension, and the sub-screens
  their navigation opens: 71 in the first run) it does one unbroken Tab
  run from the top of the window, F6 through the window's areas, Alt for
  the menu bar, and the arrow keys inside every list, tab strip, tree,
  toolbar and radio group. It reads the accessibility tree (what a screen
  reader reads) for nameless controls, measures text contrast in dark and
  light mode (WCAG AA: 4.5:1, 3:1 for large text), and opens each kind of
  dialog from the keyboard to check focus goes in, stays in (modal),
  Escape closes it, and focus comes back. A report, not a gate.
  `node tests/probes/keyboard-audit-probe.mjs [outDir] [screen filter…]`
  (`dialogs` or `light` run just those passes).
- `tests/probes/scene-coverage-probe.mjs`: every visible interactive
  element is in the scene (0 undeclared of what Parallx draws).
- Drag interactions: a code inventory of every pointer drag and whether
  a keyboard way to do the same exists (listed below).
- Not automated: listening with a real screen reader (NVDA, Narrator).
  The accessibility tree the audit reads is what those read; a listen-
  through is the owner's to do once the list below is clear.
- Third-party: the spreadsheet engine (Univer) draws its own toolbar,
  sheet tabs and grid; its own keyboard model is not Parallx's to change.
  Parallx owns getting in and out of it.

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

### 2. Keyboard reach
- [ ] Editor tabs (none focusable): the active tab in the Tab order, arrows move, Enter opens.
- [ ] Bottom panel's view tabs: the same.
- [ ] Welcome page's 12 action cards.
- [ ] Open Editors list: focusable, arrows move, Enter opens.
- [ ] Status bar: every item reachable (arrows from the one F6 lands on).
- [ ] Segmented switches (Agents' Now / Routines / History and every other): arrows move.
- [ ] Right activity bar (Chat, Agents): in F6's cycle, and its icons reachable.
- [ ] Canvas page's Version History stamp.
- [ ] Chat's scroll-to-bottom button.
- [ ] Planner's month calendar cells (31, mouse-only): a grid the arrow keys move in, Enter opens the day.
- [ ] Canvas block "+", table Add Row / Add Column: confirm the keyboard ways and make them findable.
- [ ] Tab-order holes: chat view (7), auxiliary bar header (4), routine editor fields (5), diagnostics' Re-run (1).
- [ ] Spreadsheet: F6 (and Escape) leave the sheet.
- [ ] Planner's task popover: F6 still moves between areas, or Escape first.

### 3. Names for a screen reader
- [ ] Dropdowns whose role sits on a wrapper (routine editor's three, Budget's account): role and name on the focusable button.
- [ ] Title bar menu bar: a name.
- [ ] The unnamed button in the editor tab strip.
- [ ] Canvas page title and page body: names.

### 4. Visible focus (45)
- [ ] Fields (search boxes, inputs, text areas), Appearance's buttons and switches, AI settings' switches and nav, activity bar icons, panel tabs, the tab strip's scroll button, Creations' cast card, the chat's offline link, the explorer tree.

### 5. Contrast
- [ ] Concept Lab's paper lines and guide title (4.26:1 dark, 4.47:1 light).
- [ ] Light mode: title bar menu (1.60:1), sidebar section titles (2.62:1), status bar text (2.32:1), the dashboard's "Click to rename" (1.10:1).

### 6. Drags with no keyboard way (39), and partial ones (19)
Each gets a keyboard way that does the same thing (keys on the focused
item, a menu item, or a field), listed with the inventory below.
- Workbench: part sash resize; view section sash; PDF sidebar sash; chat
  history sash; activity bar icon reorder and dock; view tab reorder and
  detach; editor tab reorder; editor tab to another group (partial);
  part, floating container and widget "beside another part" (partial).
- Canvas: drop into a column layout; move a block into a page card;
  table column width; layout column width; cover reposition; concept-map
  box resize and frame selection (partial); database column width;
  database board card (partial); sidebar page reorder among siblings
  (partial).
- Dashboard: widget move; widget resize.
- Planner: event bars, all-day bars and month chips are click-only (partial).
- Routine editor: node move; port connect; pan.
- Media Organizer: album reorder; detail, lightbox, compare, image editor
  and enlarged preview pan; blur box move and resize; trim segment
  reorder; crop keyframe retime; export queue reorder; plan crop box;
  image editor split bar, Remove brush, tone curve points, colour wheels
  (role slider with no keys); caption position, timeline block trim,
  clip crop window, image crop frame, tag nesting, album re-parenting,
  drag-out to the OS (partial).
- Concept Lab: MeanMachine's bar heights.
- Workspace Graph: node move (editor and sidebar); pan (partial).
- File drops with no button: worksheet Generate (paste only), Media
  Organizer single files (folders only).

### 7. Done when
The audit reports 0 in every kind, every dialog passes, every drag has a
keyboard way, the scene coverage probe reports 0 undeclared, and the
checks pass.
