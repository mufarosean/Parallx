# UI Slop Audit — 2026-07-22

> Requested by Mufaro after the M93 design pass: find every surface that
> reads as "AI slop" before this app can be marketed. The yardstick is the
> app's OWN system — M83 `--px` tokens + ladders, the M89 voice registry,
> the one-dropdown principle, "system UI never uses emoji", "registered
> Lucide glyphs, never text symbols", motion tokens, and the component
> library (Toggle / SegmentedControl / Dropdown / notification prompts).
> Everything below violates a rule the codebase itself wrote down.
>
> Status: **findings only — nothing fixed yet.** Ranked by marketing damage.

---

## Tier 1 — instant tells (one screenshot = "slop" label)

### 1. Native browser dialogs (`window.confirm` / `window.alert`)
The OS-gray Chromium dialog is the fastest possible "unfinished web app"
tell — and the app already HAS a fully token-native modal/prompt system
(notificationService: elevated cards, severity tiles, blurred backdrop).
These sites bypass it:

- `src/aiSettings/ui/sections/cronSection.ts:420,432` — AI Hub, delete/run
  errors (flagship AI surface)
- `src/built-in/settings/main.ts:180`
- `src/built-in/canvas/database/databaseEditorPane.ts:561` +
  `rowPropertiesSection.ts:193` — property deletion confirms

### 2. Native `<select>` — 13 sites
Violates the one-dropdown principle (core `Dropdown` exists; the Chromium
popup cannot be themed and looks foreign in every screenshot):

- `src/aiSettings/ui/sections/modelSection.ts:112` — **the AI Hub model
  picker**, of all things
- `src/built-in/dashboard/dashboardEditorProvider.ts:445`
- `src/built-in/editor/settingsEditorPane.ts:335` — Settings enum rows
- `src/built-in/planner/plannerSettingsPanel.ts:93,452`
- `src/built-in/planner/plannerEditorProvider.ts:2170,2202,2489,2520` —
  task/event popovers (reminder, calendar, repeat)
- `src/built-in/canvas/database/databaseEditorPane.ts:678,687,714,723` —
  database filter/sort controls

### 3. Emoji as system iconography
Direct violation of the app's own "System UI never uses emoji" rule
(canvasTemplatePicker.ts:13). The link-metadata chips render these in
canvas + chat chrome:

- Fallback/link icons: `📄` (canvas main.ts:673, explorer main.ts:272,
  openclaw participants ×8), `💬` (chat main.ts:2765), `🔗`
  (propertyEditors.ts:494, web-research), `💳💸💰🏦` (budget), `🖼️🎬📁`
  (media-organizer), `🕸️` (workspace-graph) — every link contract should
  return registry icon ids, not emoji
- `ext/text-generator` form labels: "Character prompt 🧠", "Lore 📚",
  "Chat history 💬", "Temperature 🌡️" — textbook LLM-generated form design
- `ext/budget/main.js:4928` — progress detail "Complete 🎉"

### 4. Emoji soup in chat slash-command output
Chat is the demo surface, and the built-in commands answer in LLM-slop
dialect: `✅ Idle / 🔄 In progress` (status), `🧠/💬` (think), `🔍/🔇`
(verbose), `✅🚫🔒` (tools), `🕸️ Mind map`, `🛠️` (init), `🧠 Context
breakdown` (context report). One consistent voice, zero emoji, would read
as designed. Files: `src/openclaw/commands/*.ts`,
`src/openclaw/participants/openclawContextReport.ts`,
`src/built-in/chat/commands/initCommand.ts:166`.

### 5. Media Organizer runs on Tailwind purple
`ext/media-organizer/main.js:4947` — `--mo-accent: #9333ea` (literally
Tailwind purple-600, the color family px-tokens.css calls out as "slop
purple"). A flagship extension detached from the Appearance system: the
user re-hues the whole app and the media library stays purple. 65 bare hex
values total (the Lightroom-parity color LABELS are legitimate domain
colors; the accent + chrome grays are not).

### 6. Text Generator's green primary buttons
`ext/text-generator/main.js:1555-1922` — save/generate buttons hardcode
`#388a34` (VS Code's git-green) instead of the accent. The M92-polished
extension with off-identity CTAs.

## Tier 2 — identity erosion (generic on inspection)

### 7. Canvas default cover gallery leads with THE AI gradient
`src/built-in/canvas/header/pageChrome.ts:20` — `#667eea → #764ba2` is the
most recognizable "AI-generated landing page" gradient on the internet,
first in the gallery (repeated at :27), plus more of the same family.
Covers appear in every canvas screenshot. Fix: replace the gallery with a
palette derived from the three Parallx moods (Slate/Warm/Ember tints,
paper grains, quiet duotones) so even cover art carries the identity.

### 8. The two biggest surfaces ignore the type ladder
Off-ladder `font-size` counts (ladder = 11/12/13/15/18/22):
- `planner.css` — **52** (8.5px, 9.5px, 10.5px, 12.5px, 13.5px… the
  half-pixel tell)
- `dashboard.css` — **45** (plus display sizes 28–40 that should be named
  display tokens)
- canvas.css 13, database.css 7, propertyBar.css 5, media-organizer 29,
  budget 17
These predate M83; the ladders exist but the flagship planner + dashboard
never migrated.

### 9. Status signals bypass the signal tokens
- MCP status dots/badges: `aiSettings.css:1205-1272` — `#73c991 / #e5c07b /
  #f14c4c` (VS Code terminal palette) instead of
  `--px-success/warning/danger`; will not adapt in light mode
- Cron source pills: `aiSettings.css:1738-1746` — raw `#5599ff` blue /
  `#c79dff` purple
- Canvas AI/version badges: `canvas.css:428,4628` — `#c79dff` purple again

### 10. GitHub-alert palette duplicated raw, twice
`chatWidget.css:948-961` and `markdownEditorPane.css:206-234` — the same
five hardcoded GitHub colors (note/tip/important/warning/caution) in two
files; `#986ee2` purple among them; light-mode contrast unverified. Should
derive from signal tokens in ONE place.

### 11. Data-viz palettes not theme-derived
- `ext/workspace-graph/main.js:516-534` — node/extension colors hardcoded;
  graph readability in light mode unowned
- `ext/budget/main.js:142-153` — category palette (defensible as user data
  colors, but should at least verify light-mode contrast and re-derive
  chrome from tokens; 58 bare hex total)

### 12. AI Hub "Scheduled jobs" section is dev-tool UX
`cronSection.ts` — beyond the native dialogs: schedule editing is a raw
text field with `cron:0 9 * * *` syntax help, enable is a bare checkbox +
"Enabled" text (core Toggle exists), source inferred from name shape. M93
built the humane version of this exact UI (Planner → Automations schedule
builder + cards); the AI Hub section should reuse those pieces or embed a
link to the Automations tab.

## Tier 3 — voice + polish

### 13. Flat empty states outside the M89 registry
The registry exists so blank surfaces speak with one voice; these bypass
it: `chatSessionSidebar.ts:217,364` "No sessions yet",
`tool-gallery/main.ts:375` "No tools registered" / "No matching tools",
`chatModelPicker.ts:104` "No models available",
`chatMentionAutocomplete.ts:292` "No matches", `welcome/main.ts:284` "No
recent items yet.", `timerWidget.ts:137`, `pdfEditorPane.ts:2181`.

### 14. Text-symbol glyphs instead of Lucide
`tool-gallery/main.ts:346` — `▶` / `▼` collapse arrows (the notification
CSS states the rule: "registered Lucide glyphs, never text symbols").
Sweep for other `▶▼▾◀`+`textContent` pairings.

### 15. Loading-copy inconsistency
`epubEditorPane.ts:104,230` uses ASCII `Loading...` (three dots) while the
rest of the app uses `…`; generic "Loading…" lines could take the voiced
form the autonomy log already uses ("Loading the agent's beliefs…").

### 16. The welcome screen is a VS Code clone
Visually token-clean (M86), but the IA is an IDE welcome page: Start =
New File / Open File / Open Folder, a version line, "Tip: press
Ctrl+Shift+P". Nothing sells what Parallx IS (canvas, planner, chat,
dashboards, automations). This is the single highest-leverage marketing
surface: first-run should open the product's loops, not file operations.

### 17. Small `#fff`-on-accent scatter
`canvas.css` (7 sites), various — should be `--px-text-on-accent` so
accent hue changes keep contrast guarantees.

(Also noting my own: `ext/flashcards` widget numeral is 26px — should join
whatever display-size token step 8 introduces.)

---

## Suggested fix order

1. **Dialogs + selects + Toggle in cron section** (Tier 1 #1, #2, #12) —
   mechanical swaps to existing components; highest tell-per-hour.
2. **Emoji purge** (#3, #4) — link contracts return icon ids; slash
   commands get one plain voice.
3. **Extension accents** (#5, #6) — media-organizer + text-generator
   adopt `--px-accent`; keep only domain data colors.
4. **Signal-token sweep** (#9, #10, #17) — one grep-driven pass.
5. **Cover gallery** (#7) — design task, small surface, big screenshot
   impact.
6. **Type-ladder migration for planner + dashboard** (#8) — biggest diff,
   schedule as its own pass.
7. **Voice sweep** (#13, #14, #15) — registry entries + Lucide glyphs.
8. **Welcome redesign** (#16) — product decision first: what should the
   first five minutes feel like?
