# The Polish Charter: stop adding, start tightening

Written 2026-09-03. Mufaro's call: the app benefits more from a cleanup
and consistency pass than from more half-baked features. No new features
ship until this program closes. The custom-block brief is parked.

Every row below was verified in code on 2026-09-03 (file references are
for the implementer; the "you notice" column is the acceptance test).
Every UI change is screenshot-checked with the hidden Electron probe
before it is shown to Mufaro. Blind CSS is how slop happens.

---

## The governing principle: one identity

The Parallx mark is the ONE sign of AI. A user who sees it knows that
clicking it triggers the AI. Nothing else carries that meaning: no
sparkle, no robot, no speech bubble, no one-off drawings. The codebase
already says so (`src/ui/brandIcons.ts:44-48`, "Parallx does not wear
the sparkle") and then ignores itself in five icon families.

Everything else in the program follows from the same instinct: one scale
of buttons, one scale of type, one voice in labels, one accent role.

---

## Decisions (closed 2026-09-03)

- **D1 Welcome page** stays first-launch only. There is no landing page
  on every visit, by design; the app opens to the last open thing.
- **D2 Planner Automations tab** is removed. In its place, scheduled
  workflows show up inside the planner as their own list (not on the
  calendar), filterable, with a User vs AI label. Workflows are the one
  automation surface.
- **D3 App font** becomes a user setting in Appearance. Consistency is
  fixed first so the setting changes one thing, not twenty.

---

## Verified findings

### Bugs that change daily use

| You notice | Cause | Where |
|---|---|---|
| "This page was changed elsewhere. Reload?" while you are the only one typing; Reload would discard your keystrokes | Title and body saves race each other (300 ms vs 500 ms debounce), every save bumps the revision, and the warning is a string-match on the failed save's error text. No writer identity exists to tell "me" from "elsewhere". | `canvas/main.ts:770-795`, `canvasDataService.ts:423,1438,1451`, `pageChrome.ts:532-544` |
| Colouring a block at the top scrolls you to the bottom | The block menu never moves the caret to the block you acted on; the lifecycle helpers end with `focus()`, whose default scrolls the stale caret into view | `blockLifecycle.ts:134,228,271`, `blockActionMenu.ts:613` |
| Sidebars keep their old pixel width when the window moves to a different screen | Sizes are stored and restored as pixels; window resize gives all slack to the editor on purpose; the proportional path exists and nothing calls it | `workbench/layout.ts:53-55,564-589`, `layout/grid.ts:419-459` |
| Breadcrumb bar height jumps, content touches the top, then fixes itself | The canvas reserves a 28 px placeholder for a 32 px ribbon; a ResizeObserver corrects it a frame later | `canvasEditorProvider.ts:193`, `canvas.css:2666`, `editorGroupView.ts:219-234,477` |
| No resize cursor on table column edges | prosemirror-tables signals hover with a class its own stylesheet styles; that stylesheet is never loaded | `canvas.css:2400-2410`, `blockRegistry.ts:506-508` |
| A session near full context dies on a big tool result and every later turn fails | The "too big" classifier matches four phrases Ollama never sends, so the existing compact-and-retry never fires; transient errors retry the same oversized prompt three times; several results in one round can sum past the window; the last exchange is never shrunk; one path silently drops all history | `openclawErrorClassification.ts:46-64`, `openclawTurnRunner.ts:170-188,215-234,260`, `openclawAttempt.ts:415,545,697-726`, `openclawContextEngine.ts:577,591,955-978` |

### Identity and chrome

| You notice | Cause | Where |
|---|---|---|
| Twenty ways to say "AI" | Five live icon families: the mark, Lucide `message-circle`/`comment`, `agent` (bot), `sparkles`, plus six unregistered inline drawings (dashboard widgets, notebook spark) | `brandIcons.ts`, `chatIcons.ts`, `customAiWidget.ts:37`, `liveWidget.ts:41`, `companionWidget.ts:32`, `autonomyActivityWidget.ts:37`, `dashboardEditorProvider.ts:614`, `notebookEditorPane.ts:1131` |
| "Two loading screens" | One overlay, then the empty-editor watermark, then the title bar: the logo three times in three sizes and two colours. The logo path is copy-pasted in five places; the registry entry meant to own it (`px-mark`) is unused; no monochrome file exists | `electron/index.html:40`, `workbenchWatermark.ts:73`, `titlebarPart.ts:650`, `welcome/main.ts:154`, `assets/parallx-logo.svg` |
| Leftover notes in the UI ("Missed runs catch up at the next launch…") | Empty-state copy written as commentary | autonomy-log and planner empty states |
| Lowercase, unpunctuated labels; no helper text; pills everywhere | No language pass was ever run app-wide; the design gates were applied per-milestone | app-wide sweep |

### Activity log: what is already recorded vs the gaps

Already recorded: window focus and blur, which view you focused, every
context-menu choice, every command, settings changes, tool enable and
disable, page edits (per save), editor open/close/switch, AI tool runs
with intent. That is how the AI deduced a tool had just been enabled.

Not recorded: dashboard widget add/remove/move, planner task
create/edit/move/complete, sidebar and panel drags, AI-profile and
autonomy toggles, plain button clicks that do not route through a
command, block-level canvas operations. (`activityTaps.ts`,
`dashboardEditorProvider.ts:1029,1187`, `plannerEditorProvider.ts:2455`,
`workbench/layout.ts:611`)

### Behaviour: habits should become suggested workflows

The AI does not create planner tasks from habits. It detects a repeated
action and is told to OFFER a scheduled job in chat
(`mind/habitDetector.ts`, `openclawHeartbeatContext.ts:103-110`). The
better product, Mufaro's: the offer lands as a Suggested Workflow in the
Workflows panel, approved or dismissed there. A redirect, not a feature.

---

## The six passes

Each pass ships on its own, screenshot-verified, tsc and vitest green.

1. **Identity.** One logo owned once (`px-mark` becomes the source; the
   five copies go), a monochrome variant, the mark on everything AI,
   the sparkle and the six drawings deleted, the boot sequence reduced
   to one calm logo.
2. **Stability.** The six bugs above. Context recovery ships behind the
   existing reversible pattern: classifier fixed, per-round cap,
   last-exchange shrink, no silent history wipe, an error that tells
   you to run /compact or /new.
3. **Language and chrome.** Title Case labels, punctuation, helper text
   where a control is not self-explanatory, leftover notes removed,
   pills and accents thinned to one accent role.
4. **Consistency.** One button scale, one UI type scale across tools,
   settings rows aligned, the Edited stamp restyled, the context picker
   condensed to sizes only, the chat session list redesigned. Then the
   app-font setting (D3).
5. **Canvas.** Fonts as one dropdown, Version History behind the Edited
   stamp, trash popup redesigned, Notion-style callouts, hide items from
   the primary sidebar.
6. **Planner, autonomy log, activity.** Automations tab removed and the
   scheduled-workflows list added (D2), planner tightened, autonomy
   ribbon restructured with readable type, activity gaps closed,
   Suggested Workflows.

---

## Ledger

| Date | Pass | Shipped | Verified |
|---|---|---|---|
| 2026-09-03 | 2 Stability | Page writes serialized (no more self-inflicted "changed elsewhere"); block colour/delete/duplicate no longer scroll to a stale caret; ribbon reserves its real height; table column edges show a resize cursor; sidebars rescale on a screen change; context recovery: overflow classifier matches real provider wording, per-round tool-result cap, in-turn argument elision, shrunk retained exchange, no silent history wipe, proactive loop stops on no-op, /compact capped + num_ctx + guarded, overflow error carries advice | tsc, 5891 vitest, build |
| 2026-09-03 | 1 Identity | One logo drawing (`px-mark`) owned in brandIcons and used by the title bar, welcome page, watermark and boot overlay (monochrome, was magenta); the AI mark IS the logo; sparkle/robot/speech-bubble/six inline drawings replaced across chat, canvas menus, PDF pane, dashboard widgets, notebook, autonomy log, workflow palette, welcome; chat rail icon; watermark lifted above the empty pane (it was fully covered); Welcome opens once (fixed instance id); dead icons removed | hidden-probe screenshots reviewed (boot, welcome, watermark, chat, autonomy, dashboard, picker) |
| 2026-09-03 | 3 Language | Title Case sweep across ~110 action labels (chat, planner, canvas incl. 22 colour entries, autonomy log, workflows, dashboard, settings, others); hints and empty states end in periods; middle-dot key legends became sentences; lowercase status notes capitalized | tsc, vitest (3 pins updated) |
| 2026-09-03 | 4 Consistency | Control-height ladder (22/24/28/32) in tokens and every surface button re-pointed to it (planner, dashboard, chat, canvas, ui, workbench, appearance); timer widget buttons equalized; settings nav one indent; autonomy ribbon at the app's type scale with a 34px strip; chat session rows (title base, time caption); one shared clock `ui/relativeTime` ("Edited 14 hours ago" / "14h ago"); Edited stamp is the Version History door (menu entry removed), tokens instead of hardcoded white; context picker shows sizes only, "Ctx: Default"; app font in Appearance (six stacks, previewing chips), D3 | tsc, 5896 vitest, probe |
| 2026-09-03 | 6 Planner, autonomy, activity | Planner Automations tab REMOVED (D2); a Scheduled tab reads the workflow service: every scheduled workflow, All/User/AI filter, next and last run, On/Off, a door to the editor and to the Workflows panel (`workflows.showPanel`); a confirmed habit becomes a SUGGESTED workflow (disabled, source 'suggested', one per habit) shown first in the Workflows panel with Review/Add/Dismiss, never a chat offer or a planner task; activity log now records planner task create/edit/complete/reopen/plan/move/cancel/delete and event moves, dashboard widget add/remove/move/resize, sidebar and panel drags, AI settings section changes, and any control marked `data-activity` | tsc, vitest, probe |
| 2026-09-03 | Chat additions | Attachments in past messages are doors: a canvas-block chip opens its page and reveals the block (link contract, with a warning if the page is gone); an image chip opens the image viewer (file-backed by path, pasted from memory via `ImageEditorInput.createFromData`); right-click in a reply uses THE context menu with Copy, Copy All and "Ask Parallx About This", which attaches the selected excerpt and focuses the composer | tsc, vitest |
| 2026-09-03 | 6 Planner, autonomy, activity | Planner Automations tab removed (D2); a Scheduled tab reads the workflow service (All/User/AI filter, next and last run, On/Off, doors to the editor and the Workflows panel via `workflows.showPanel`); confirmed habits become SUGGESTED workflows (disabled, one per habit, Review/Add/Dismiss in the Workflows panel) instead of chat offers; the activity log now records planner task gestures, dashboard widget add/remove/move/resize, sash drags, AI settings section changes, and any `data-activity` control; chat attachments in past messages open (canvas block reveals its block, images open in the viewer, pasted images from memory); right-click in a reply is THE context menu with "Ask Parallx About This" | tsc, 5883 vitest, build, probe |
| 2026-09-03 | 5 Canvas | Page menu font section is one row that opens a list (was half the menu); Version History moved to the Edited stamp (pass 4); trash popup rebuilt on tokens (header with count, search, "Deleted 2 days ago" captions, Restore as a word, one destructive action in the footer); callouts on tokens with a hover ring on the changeable icon; "Hide <Section>" and "Show Hidden Sections" on every sidebar section header (stacked mode now honours hidden sections, persisted); Properties rows read "Created"/"Modified" | tsc, 5883 vitest, build, probe |
| 2026-09-03 | 7 Pills and accents | Informational labels stop wearing button clothes: template-card pills, autonomy-log origin badges (all six variants), tool-gallery membership badge, Scheduled-tab origin chip, tracker chips, version-history AI badge, cron-job source, worksheet status, chat canvas-block and command pills are now neutral inset or accent-as-ink hairlines; dashboard widget titles and outcome labels drop uppercase tracking; picker tile icons and template cards on neutral grounds. Along the way: the widget picker closes on Escape; the Appearance tool wakes with the workbench, so Settings › Appearance exists before anyone runs its command; the planner's letter shortcuts no longer fire when nothing is focused and the pointer last touched another surface (a canvas page beside a planner tab was handing "n" to a task popover); flashcards UI strings lose their em dashes | tsc, vitest, build, probe (15 scenes) |
| 2026-09-03 | Probe | `tests/probes/ui-screenshot-probe.mjs`: real app, hidden window (PARALLX_HIDDEN_PROBE), throwaway data root (PARALLX_APP_ROOT) and workspace, scenes as PNGs; preload now separates `dataRoot` from `appPath` (migrations, katex, tools stay on the checkout) | used for every UI row above |
