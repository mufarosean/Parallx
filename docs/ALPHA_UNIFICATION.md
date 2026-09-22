# The Alpha Unification Charter: one app, not a federation of tools

Branch `alpha-unification`, opened 2026-09-22 from master `be39f4db`. The app functions but does not feel like one thing: the core got the Polish Program (docs/POLISH.md, 2026-09-03) and the extensions never did, so every seam between a built-in surface and an extension surface shows two eras. This charter closes those seams before the alpha.

## The governing principle: the workbench owns the chrome

An extension supplies content and actions. The workbench supplies every menu, dropdown, dialog, token, control height and empty-state shape. When an extension needs something the workbench does not offer, the workbench grows through `api.ui`; the extension never clones. A capability the shared component lacks is a capability that gets reimplemented badly somewhere else, and every clone carries its own dismissal, positioning, keyboard and z-index bugs that no core fix ever reaches.

## Decisions

- **D1 (open, Mufaro): the alpha surface.** Which extensions ship. Cutting is the cheapest unification. Candidates for a flag or the door: workspace-graph (inline-style era, untouched since 2026-08-03) and creations-ai (two days old at branch time). Until decided, every extension is treated as shipping.
- **D2 (closed 2026-09-22): one menu system.** Extensions and built-ins alike use THE context menu (`src/ui/contextMenu.ts`), THE dropdown (`src/ui/dropdown.ts`) and THE confirm modal (`notificationService.showConfirmModal`). The shared components grew instead of being cloned: the context menu learned checked rows (a mark column on every row once any item is checkable) and tooltips; the extension API accepts element anchors, nested submenus and an on-close hook. The mapping lives beside the component (`showExtensionContextMenu`) so a test exercises exactly what an extension gets.
- **D3 (open, Mufaro): which menus misbehave in daily use.** Right-click menus, dropdowns, the canvas page menu, sidebar section menus. Until named, the pass fixes the systemic cause (four implementations) rather than symptoms.

## Verified findings (grep audit and probes, 2026-09-22)

**The refined-versus-raw split is the Polish scope.** The Polish ledger touched chat, planner, canvas, dashboard, autonomy log, settings, welcome and the tool gallery. Nothing in `ext/` beyond flashcards' em dashes and one worksheet pill.

**Four private menu systems existed beside the workbench's.**

| Surface | What it carried | Why it failed |
|---|---|---|
| media-organizer | own context menu (`mo-context-menu`, April 2026, predates the API of 2026-07-22), own dropdown (`moDropdown`), a styled popup bound over 12 native selects (`moBindCustomSelect`) | menu at z-index 10000 and the dropdown list at 1000, both under the app's popup floor (10001 and up); the list was `position: absolute` inside the wrapper, so any scrolling ancestor clipped it |
| browser | own menu (`br-menu`, 2026-09-07, two months after the API offered one) | separate dismissal and clamping code |
| workspace-graph | native `<select>` in an inline-HTML row; three `window.confirm` dialogs | Chromium-drawn, unthemeable |
| budget, creations-ai | already on `api.ui.createDropdown` | the `<select>` mentions in the audit were comments |

**Native dialogs.** `confirm()` in workspace-graph (3), media-organizer (1) and the autonomy log (3): Chromium's dialog over a themed app.

**Token vocabulary is split.** flashcards, concept-lab and worksheet are pure `--px`; media-organizer leans on 694 `--vscode-` references with 41 z-index declarations; budget 315 `--vscode-` with 45 inline styles; workspace-graph is 79 inline `style=` attributes and 6 tokens. The bare hex in chat, planner and dashboard CSS are mostly VS Code dark-theme fallbacks behind tokens (low priority); budget's bare hex are category colours (data, not styling).

**The extension API is used unevenly.** flashcards makes 36 `api.ui` calls; media-organizer (31k lines) used one helper; web-research and workspace-graph none.

**Twenty milestones on the memory index are "verdict owed".** Built in separate sessions, never seen side by side. Unification is judged eyes-on, and that sitting has not happened.

**Found by the pass-1 probe, not by the audit.** The Tag Review row renderer read a variable it never declared since the multi-parent commit `3019f3b2` (2026-09-21): every row threw and Tag Review stayed empty. Fixed here. The same commit removed `moTagAncestorIds` and `moExpandWithAncestors`, which `tests/unit/moAiTagging.test.ts` still extracts by name, so that suite has failed at file level since 2026-09-21; its ancestor cases need rewriting for the sense-on-assignment model (owed with the AI tagging verdict, not part of this pass). Two probes were stale against the one-view grid redesign of 2026-09-16: tag-review-probe waited for `.mo-card` (now `.mo-feed-card`, fixed); practice-probe runs `media-organizer.openHome`, a command that no longer exists (still stale, its surfaces moved to `practiceSession`, `dailyStudy`, `paintingPlans`).

## The passes

0. **Alpha surface (D1).** Decide what ships. Everything below is scoped to that list.
1. **One menu system (D2).** Delete the private menus, dropdowns, select popups and native confirms; route everything through `api.ui.showContextMenu`, `api.ui.createDropdown` and `api.window.showConfirmModal`. Then "menus unreliable" is one implementation to fix. Still to verify: the built-ins' own `contextmenu` listeners (canvas 6, dashboard 3, chat 1, explorer 1) open the core menu rather than a clone.
2. **One vocabulary.** media-organizer and workspace-graph onto `--px` tokens and the z-index ladder; then the Polish passes the core already had (Title Case labels, the 22/24/28/32 control-height ladder, informational pills as ink not buttons) swept across `ext/`.
3. **One chrome pattern.** One shape for an extension tab: header, toolbar, empty state, status pill, sidebar as navigation (Home, Settings, one snapshot that opens as a tab).
4. **Eyes-on.** A hidden probe scene per extension (`tests/probes/menus-probe.mjs` is the first), then one verdict sitting for the owed milestones.

**Pass 2 measured before acting (2026-09-22).** The bridge (THEME_VSCODE_BRIDGE) already resolves 142 names, so the `--vscode-` vocabulary in extensions is not a theme break in itself: `var(--vscode-focusBorder)` and `var(--px-accent)` are the same colour. The break is the names the bridge did not know: 36 in the core (testing icons, JSON-viewer syntax names, diff backgrounds, line numbers, chart series) and 15 in extensions (budget's chart series, 83 references). Each drew VS Code's palette from its hex fallback on every theme. Bare hex in extensions is almost all data (budget and concept-lab category palettes, workspace-graph cluster colours, flashcards' deliberate white index card); nothing there to tokenise. No extension used the control-height ladder; the only off-ladder controls were the Media Organizer's 26px toolbar and two 26px close buttons. Fifty-six action labels across the extensions were sentence case.

## Ledger

| Date | Pass | Shipped | Verified |
|---|---|---|---|
| 2026-09-22 | 2 Vocabulary | The bridge grows by 42 rows so every `--vscode-*` name the app or an extension references resolves to a `--px-*` token: chart series onto the signal colours (budget's ledger and pies re-hue with the theme), JSON-viewer names onto `--px-syntax-*`, diff backgrounds onto the green and red rgb tokens, line numbers, cursor, find highlights, drop targets, minimap, modified-tab border; `--vscode-font-size` and `--vscode-editor-font-size` aliased to the type scale in px-tokens.css. `tests/unit/themeBridgeCompliance.test.ts` fails the build on any future unbridged name and on any bridge row pointing at a token that does not exist. Media Organizer toolbar (buttons, search, layout segment, selection bar) onto `--px-control-h`; budget drawer close and creations-ai rows onto the ladder. Title Case on 46 action labels across budget, creations-ai, flashcards, media-organizer, web-research, workspace-graph and browser (small joining words lowercase, as the core writes them); concept-lab's ten mathematical labels left as written. | tsc; vitest (bridge compliance, font and motion compliance, appearance, creations panes, flashcards, budget, browser: 231 tests; flashcards study notes after its pins moved); hidden menus probe 8/8 after rebuild, no renderer errors |
| 2026-09-22 | 1 Menus | Core: `IContextMenuItem.checked` (mark column on every row of a checkable menu, `menuitemcheckbox` role) and `tooltip`; `showExtensionContextMenu` beside the component, `api.ui.showContextMenu(anchor, items, options)` accepts a point, rect or element, `submenu`, `checked`, `tooltip`, `onClose`, `anchorPosition`. media-organizer: private context menu, `moDropdown` clone, `moBindCustomSelect` and 12 native selects replaced by thin adapters over THE menu and THE dropdown (`moSelect` keeps `.value`, `.disabled`, `.options`, `change` events for the clip and export forms); 340 lines of clone CSS removed; Replace confirmation is the app's modal; Tag Review `picks` bug fixed. browser: `showMenu` is THE menu with the element as anchor. workspace-graph: merge target is THE dropdown, three confirms are the app's modal. autonomy log: three confirms are the app's modal. Probes: tag-review and practice selectors updated where the code had moved; new `menus-probe.mjs`. | tsc; vitest `extensionContextMenu.test.ts` (9 cases) + interactionMode, budgetDropdown, flashcardsBehavior, creations panes, media-organizer, browser (223 tests); hidden menus probe 8/8 (card right-click opens `.context-menu` at z 10002 with no clone DOM, sort menu shows the mark column with the checked rows, per-page dropdown list at body level z 10005 over the panel below, no renderer errors); tag-review probe through review, approve and resume |
