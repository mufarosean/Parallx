# Design Unification: one app, one way to do each thing

Written 2026-10-01, from a measured pass over the running app (120 screens,
every built-in and all eight extensions; method in `docs/UI_AUDIT.md`).
POLISH tightened the core; ALPHA_UNIFICATION unified menus and tokens. This
charter covers what is left: **where things live, how many things a screen
shows, and making the consistent path the only easy path for extensions.**

---

## The reference app

Pick one north star and copy its discipline, not its look.

**Linear** for feel. One accent; one primary button per view; toolbars are
icon buttons with tooltips; everything else is in a ⋯ menu or the command
palette; a handful of type sizes; the same row, the same header, the same
empty state on every screen. The thing to copy is the restraint: a screen
shows the one thing you came for and hides the rest one click away.

Two rulebooks to borrow alongside it, because Parallx is shaped like them:

- **VS Code's UX guidelines** for placement. The workbench is already VS
  Code's (parts, `--vscode-*`, activity bar, panel). Its rules say what goes
  in each region, and its extension API renders sidebars (TreeView) and
  title-bar actions (`menus`) *from data*, so an extension cannot restyle them.
- **Obsidian's plugin guidelines** for governance. Plugins use the app's
  components and CSS variables, never their own; the review checklist rejects
  plugins that do. Same product shape as Parallx: local workspace, core tools
  plus community tools.

---

## What was measured

| Dimension | Today | Target |
|---|---|---|
| Rendered font sizes, app-wide | **25** (incl. 11.2, 12.8, 15.75, 16.9) | 6 |
| Font sizes on one Settings page | **9** | 4 |
| Text-button heights (170 distinct buttons) | **16**, 46% on the 22/24/28/32 ladder | 2 sizes + icon button |
| Button corner radii | 6 (0, 4, 5, 6, 8, 999) | 1 (+ full for pills) |
| Button styles inside Settings alone | 12 | 3 (primary, secondary, ghost) |
| Button styles inside Planner alone | 7 | 3 |
| Buttons on browser defaults (13.33px, unstyled) | 10 | 0 |
| Distinct icon shapes on screen | 131 | — |
| Sidebar layouts | 7 different shapes | 1 template |
| `api.ui` components offered to extensions | 5 (dropdown, menu, markdown, AI button, rafThrottle) | ~15 |

---

## 1. Where things live

### The rule
Each region has one job. A destination appears in **exactly one**
navigation layer.

| Region | Job | Not for |
|---|---|---|
| Activity bar | Switch between *places* | Actions, settings, status |
| Sidebar | Navigate *inside* the current place: its content (pages, decks, folders, filters) | Page links that duplicate the editor's own tabs; settings; full-width action buttons |
| Editor | The work itself, with one page header | A second navigation menu of the sidebar's items |
| Panel (bottom) | Developer and system output; closed by default | User features |
| Right side (aux) | Chat | A second activity bar |
| Status bar | Ambient state: sync, model connection, indexing | Navigation |
| Settings | Every setting, for every tool, in one place | — |

### What breaks it today, and the move

| Today | Problem | Move |
|---|---|---|
| 13 unlabeled activity icons + Manage + a right-edge bar holding only Chat | Places and management mixed; no grouping; two activity bars | Core places on top (Explorer, Search, Pages, Planner, Dashboard). Tools pinnable below a divider (user chooses which). **Tools** (the extension manager) moves into Settings › Extensions. Right-edge bar goes; Chat is the title bar's right-area toggle and the mark. |
| "Tools" means three things: a title-bar menu, the extension manager, and Settings › AI › Tools | One word, three places | Extension manager → "Extensions" (in Settings). AI section → "AI Tools". Title-bar menu keeps "Tools". |
| Planner: sidebar lists Calendar / Tasks / Scheduled; the editor has the same three tabs | Same destinations in two layers | Editor keeps the tabs. Sidebar shows *content*: Today, This Week, Overdue, tags, calendars. |
| Worksheets: sidebar (Home, Dashboard, Quizzes, Settings) + seven home tiles + each command opens its own tab (six tabs for one tool) | Three layers, tab sprawl | One Worksheets tab with internal tabs. Sidebar lists the problem sets and quizzes themselves. Settings → Settings › Worksheets. |
| Budget: sidebar pages + Plan's five sub-tabs + Settings' five sub-tabs; deep links fail when the tab is open | Two layers, a broken third | Same as Worksheets: one Budget tab, sub-tabs inside, sidebar shows accounts and categories. Fixes the deep-link bug by construction. |
| Tool settings live in the tool's own Settings page *and* Settings › Extensions *and* AI Settings ("Set the API key in AI Settings → Model → Providers", shown inside Settings › AI › Providers) | Three settings systems that point at each other | One Settings. A tool's "Settings" entry opens Settings at its section. |
| Workflows live in the Autonomy Log panel, Planner › Scheduled, and the workflow editor tab | A user feature in the developer panel, three homes | Workflows gets one place (activity bar or Planner). Panel keeps the log only. |
| Panel open on first launch with Terminal, Output, Indexing, Activity, AI Diagnostics, Autonomy Log | Developer tools in the user's face | Closed by default. Activity moves to the status bar's history; AI Diagnostics surfaces through chat's offline state. |
| Model / context / token gauge in the chat composer ("No Model · Ctx: Default · 0%"); chat spins on "Connecting to Ollama…" forever | Status shown as controls; unknown state shown as loading | Status bar shows connection and model; composer shows the model picker only. Offline is a setup state with one button. |
| Primary "New X" sits at the top (Browser, Dashboard), at the bottom as a full-width button (Budget "Sync Now", Creations "New Chat"), or as a header "+" (Canvas, Flashcards) | Users hunt for the same action in three places | Always the header "+" (with a tooltip), plus the command palette. |

---

## 2. Screens that look busy

**Rules**

1. **One primary button per view.** Everything else is secondary, ghost, or
   in ⋯. (Dashboard empty state today: two primaries for the same action.)
2. **Toolbars: at most 3 visible actions**, icon-only with tooltips; the rest
   in ⋯. Workspace Graph shows 7 text buttons that wrap to three lines; the
   Autonomy Log toolbar wraps every label at normal widths.
3. **Labels or icons, not both, in toolbars.** Text buttons are for the page
   header's primary and secondary action only.
4. **Metadata is quiet.** Properties, timestamps and keys sit below the
   content at caption size, or behind a disclosure. Canvas shows Properties
   at body size above every page; Settings shows each raw key on every row.
5. **Say each thing once.** "• Saved" next to "Edited just now"; the page
   name four times on a canvas page; "Add widget" twice.
6. **Empty means one sentence and one action**, in the shared `.px-empty`
   shape, centred in the area it describes.
7. **No uppercase tracked micro-labels.** Section labels are sentence-case
   `--px-text-sm`/600 secondary (POLISH pass 7), including budget,
   flashcards stats, concept-lab, media-organizer, the canvas sidebar.

---

## 3. The visual system (small enough to remember)

### Type: six sizes (already defined; not yet used)
`px-tokens.css` already carries exactly this scale (plus `--px-text-2xs` 10px for
dense badges). The 25 rendered sizes come from code that bypasses it.

| Token | Size | Use |
|---|---|---|
| `--px-text-xs` | 11 | Captions, timestamps, counts |
| `--px-text-sm` | 12 | Secondary text, section labels, buttons, tabs |
| `--px-text-base` | 13 | Body, rows, inputs |
| `--px-text-md` | 15 | Dialog titles, card titles |
| `--px-text-lg` | 18 | Section titles inside a page |
| `--px-text-xl` | 22 | Page titles |

Canvas *content* (the document a user writes) keeps its own reading scale;
this is the chrome scale. Weights: 400 and 600 only.

### Buttons: three kinds, two sizes
| Kind | Look | When |
|---|---|---|
| Primary | Accent fill | The one main action of a view |
| Secondary | Neutral fill or hairline | Other actions with words |
| Ghost / icon | No fill until hover | Toolbars, rows, headers |

Sizes: **28** (default) and **24** (dense: rows, panels, sidebars). Icon
buttons are 24 or 28 square. One radius (`--px-radius-sm`, 4px); full
radius only for counts and avatars. Today: 16 heights, 6 radii.

### Icons: a dictionary, enforced
One concept → one icon; one icon → one concept. Today's collisions:

| Icon | Means today | Fix |
|---|---|---|
| Parallx mark | AI (correct) and also "Browse Cards", "Cooldown", "Find Duplicates" | Mark only where clicking calls the AI |
| `eraser` | Clear (4 places) and "Insert Column Right" | Column icon for the table action |
| `target` | Budgets, Transactions, a statistics module, a template | One meaning; pick others for the rest |
| `trash` / `trash-2` | Both mean delete | One |
| `message-circle` vs mark | Both mean chat | Mark (per POLISH identity rule) |
| `layout-dashboard` / `px-dashboard` | Dashboard vs Overview | One |
| `layers`, `repeat`, `trending-up` | 3–5 unrelated labels each | Dictionary entries |

The dictionary lives in `src/ui/iconRegistry.ts` as *semantic* names
(`action.delete`, `action.new`, `nav.settings`, `ai`), which extensions use
instead of raw Lucide names.

---

## 4. Logic that surprises

- A command that runs and does nothing visible (budget deep links into an open tab).
- Commands listed that cannot run (Media Organizer practice/daily/plans → a toast).
- An enabled action with nothing to act on (Worksheets "Start Quiz" on an empty bank).
- Loading that never ends (chat without Ollama).
- Internal API commands in the command palette and Keyboard Shortcuts, by raw id.
- The browser extension creates `Downloads/` in the user's workspace on first launch.
- New Task opens over the menu bar instead of near Create.

Rule: **every visible control works now or says why not, in place.**
Disabled with a tooltip beats a toast after the click.

---

## 5. Making extensions unable to invent a style

The root cause is structural. The core has a component library in `src/ui/`
(button styles, toggle, segmented control, tab bar, list, input, textarea,
slider, empty state, panel surface), but `api.ui` exposes five functions. So
every extension builds its own buttons, tabs, chips and headers: media-organizer
carries 22 button classes, 26 tab/chip/pill classes and 16 empty-state classes;
creations-ai 20, 13 and 5. And the authoring guide teaches the old system
(next item).

Five levers, strongest first:

1. **Rewrite Section 6 of `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`.**
   It is the spec AI follows when it writes an extension, and today it says
   the brand is purple `#9333ea`, tells authors to use `--vscode-*` colours,
   documents a second token family (`--parallx-*`) beside `--px-*`, routes
   confirmations through notifications (contradicting ALPHA_UNIFICATION D2),
   and its own example hand-builds a button with `font-size:13px`,
   `border-radius:3px`, `padding:4px 10px`. Replace it with: "use `api.ui`
   components; you may not write CSS for chrome."

2. **Render chrome from data, like VS Code.** Extensions *declare* and the
   workbench *draws*:
   - Sidebars: `api.views.createTree({ sections, rows, actions })` — the
     workbench renders the header, "+", search and rows. This alone removes
     the seven sidebar shapes.
   - Page headers: `api.ui.pageHeader(el, { title, primary, secondary, more })`
     with a hard limit of one primary and two secondary.
   - Toolbars: `api.ui.toolbar(el, actions)` that overflows into ⋯ by itself.

3. **Expose the kit.** `api.ui.button` (kind, size), `iconButton`, `input`,
   `toggle`, `segmented`, `tabs`, `emptyState`, `section`, `row`, `badge`,
   `stat`, `card`, `confirm`. All thin wrappers over `src/ui/`. If the kit
   lacks something, the kit grows (ALPHA_UNIFICATION's rule); the extension
   never clones.

4. **Ratchet tests over `ext/`.** Extend the existing compliance tests
   (font, motion, copy, bridge) from `src/` to `ext/`:
   no hex/rgb outside an allowlisted data palette, no px font-size,
   radius or height, no font-family, no `z-index`, no `createElement('button'|'select')`
   outside the kit, no emoji, no `confirm(`. Start from a baseline file of
   today's violations; the count may only go down. New extensions start at zero.

5. **A UI gallery page.** A built-in "Design System" tab that renders every
   kit component in every state. It is the reference for humans, the thing
   the screenshot probe compares against, and the page that shows when the
   kit changed.

---

## 6. Order

0. **Decisions** (below).
1. **Guide + tests** (lever 1 and 4): stops new drift today; nothing on screen changes.
2. **Tokens** (UI_AUDIT S1–S5) and the 6-size type scale, 2-size button scale.
3. **Kit + page header + tree view** (levers 2, 3, 5), then migrate one
   extension end-to-end as the template — flashcards is closest already;
   budget is the most valuable.
4. **Placement moves** (section 1), one region at a time, each screenshot-checked.
5. **Remaining extensions** onto the kit, ratchet to zero.

## Decisions (open, Mufaro)

- **D1** North star: Linear (recommended), or another app you'd rather match.
- **D2** Activity bar: core places fixed + tools pinnable below a divider? Extension manager into Settings?
- **D3** Workflows' one home: its own activity entry, or inside Planner?
- **D4** Panel closed by default, Activity and AI Diagnostics moved out of it?
- **D5** Tool settings only in Settings (tools lose their own Settings pages)?
