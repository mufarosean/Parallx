# Extension UI audit, 2026-10-03

> Part of the 2026-10-03 whole-app audit. What was fixed after this report was written is listed in [`docs/APP_AUDIT_2026-10-03.md`](../../APP_AUDIT_2026-10-03.md) §1; read that first. Paths under a `scratchpad/` folder (probe scripts, screenshots) belonged to the audit session and were not kept.

Scope: the eight extensions in `ext/` (browser, budget, concept-lab, creations-ai, flashcards,
media-organizer "Atelier", web-research, workspace-graph), judged against
`docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md` §6 (the spec), `docs/DESIGN_UNIFICATION.md`
(§1 placement, §5 levers) and the 2026-10-01 findings in `docs/UI_AUDIT.md`.

Snapshot: branch `fix/light-mode-and-accent-contrast` at `1229cffa`. Two commits landed
while this audit ran (`4cf4e2f1`, `1229cffa`). Inside `ext/` they changed only three
manifests (budget, creations-ai and workspace-graph command titles), and this report reflects
those changes. No repo file was edited.

Method: everything is static. I read the code and ran scanners (scratchpad `scan.mjs`,
`scan2.mjs`, `copy.mjs`, `glyph.mjs`). The scanners strip comments the same way the
ratchet does, and they skip `ext/*/test/**` and the vendored `web-research/readability.js`.
`tests/unit/extStyleRatchet.test.ts` passes (9/9). Rendered contrast, wrapping and clipping
can't be checked statically. Where a UI_AUDIT finding depends on those, I say so.

---

## 0. Ranking: distance from the rules, and the one migration that helps most

| Rank | Extension | Ratchet total | Uncounted kinds total¹ | Per 1k lines | Kit calls² | The single migration that helps most |
|---|---|---:|---:|---:|---:|---|
| 1 | media-organizer (Atelier) | 246 | 1,436 | 45 | 113 | Move its ~11 hand-built modal dialogs and 3 body-level popovers (all on `document.body`, own scrims and z-index) onto kit surfaces. That means growing the kit with a form dialog. Then replace the 167 `moEl('button')` with `createButton`/`createIconButton`. |
| 2 | creations-ai | 40 | 900 | 71 | 41 | Retire the legacy `tg-*` stylesheet (`main.js:54–~2000`: VS Code blue `#0e639c` buttons, own modal/toast, 331 `--vscode-*`, 147 `--parallx-*`). In the same pass, turn the sidebar into a chat list with `+` in its label row and move Settings into the app's Settings. |
| 3 | workspace-graph | 98 | 269 | 133 (worst density) | 4 | Theme the canvas from tokens (labels, edges and the selected node are hard-coded white, so they vanish in light mode). Replace the inline-HTML Graph Settings panel and Inspector with kit controls, and move settings into app Settings. |
| 4 | browser | 47 | 157 | 44 | 2 | Put the internal pages (New Tab, Bookmarks, History, Blocked Trackers) on `createPageHeader`/`createEmptyState`/`createButton`. Use `showConfirmModal` for its 5 confirmations. |
| 5 | flashcards | 26 | 219 | 22 | 23 | Replace the `fc-btn` clone (103 hand-built buttons) with `api.ui.createButton`, and give every route a `createPageHeader` in place of the breadcrumb plus ad-hoc titles. |
| 6 | concept-lab | 10 | 45 | 5 | 0 | Use `createPageHeader` for Home and for each module (with `back`), and kit buttons for the scene and story controls. It is fully tokenised but uses none of the kit. |
| 7 | budget | 43 | 320³ | 40³ | 47 | Move the three body-mounted drawers (transaction, balance, goal: `position: fixed; z-index: 1000`) into the editor, which needs a kit side sheet. Then convert Import / Export, the last page still on `--vscode-*` inline styles. |
| 8 | web-research | 0 | 0 | 0 | 0 | No UI. Only its Settings copy needs work (§9). |

¹ Sum of the uncounted kinds in §2 (hand-built buttons, `--vscode-*`, `--parallx-*`, colours hidden in `var()` fallbacks, px heights and radii, font-family, off-scale weights, letter-spacing, z-index, `position: fixed`, body mounts, inline styles, notification confirms, AI-icon misuse).
² `createButton`/`IconButton`/`AiButton`/`PageHeader`/`EmptyState`/`SectionLabel`/`FilterChip`/`Segmented`/`Dropdown`/`showContextMenu`/`showConfirmModal` calls. Budget also has 19 `makeButton(` calls, which wrap the kit.
³ Budget's number is inflated by defensive chains such as `var(--px-x, var(--vscode-y, #hex))` and by the `--vscode-charts-*` chart palette. Only **20** `var(--vscode-…)` uses are real drift: 10 on Import / Export, 1 inline on Trends, 9 in CSS (some of it dead). See §8.

---

## 1. The ratchet's baseline, per extension (today vs `ext-style-baseline.json`)

| Extension | rawColor | pxFontSize | uppercase | emoji | nativeConfirm | nativeSelect | retiredPurple |
|---|---:|---:|---:|---:|---:|---:|---:|
| browser | 9 / 9 | 38 / 38 | 0 | 0 | 0 | 0 | 0 |
| budget | 30 / 30 | **10 / 12** | 0 | 3 / 3 | 0 | 0 | 0 |
| concept-lab | 6 / 6 | 4 / 4 | 0 | 0 | 0 | 0 | 0 |
| creations-ai | 12 / 12 | 27 / 27 | 0 | 1 / 1 | 0 | 0 | 0 |
| flashcards | 24 / 24 | 0 | 0 | 2 / 2 | 0 | 0 | 0 |
| media-organizer | 129 / 129 | 113 / 113 | 2 / 2 | 2 / 2 | 0 | 0 | 0 |
| web-research | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| workspace-graph | 49 / 49 | 45 / 45 | 0 | 4 / 4 | 0 | 0 | 0 |

(today / baseline)

- **The baseline is stale for budget.** pxFontSize is now 10 against a baseline of 12. Refresh it with `UPDATE_EXT_STYLE_BASELINE=1 npx vitest run tests/unit/extStyleRatchet.test.ts` so the gain is locked in.
- What the counts are made of:
  - budget rawColor: 13 default category colours (`main.js:146–158`) and 6 chart inks (`351–356`), which is data. Real drift: the drawer scrim `rgba(0,0,0,.5)` (999), a raw shadow (1009), `#fff` in dead CSS (1052), and about 7 data fallbacks.
  - budget emoji: the three `'✕'` fallbacks for drawer close buttons (1797, 3572, 3916). They only render if the icon registry fails, so they are trivial to drop.
  - flashcards rawColor 24: the deliberate "white paper" study card (5266–5340).
  - concept-lab rawColor 6: chart inks.
- Ratchet "emoji" really means dingbat glyphs: ✓ ✕ ✎ ✦ ★ ⚠ ✗ (workspace-graph 1734/1736/1812/2214, MO 17501/33467, FC 1815, creations 6144). Arrow glyphs used as icons are **not** counted: ⟳ ⤢ ↗ ↺ → ▸ (§2).

## 2. What the ratchet does not count (measured today)

| Kind (method) | browser | budget | concept-lab | creations-ai | flashcards | media-org | web-res | ws-graph |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Hand-built `<button>`: `createElement`/`el`/`moEl('button')`, `<button` in templates | 28 | 9 | 16 | 75 | 103 | 167 | 0 | 16 |
| Kit button calls (`createButton`/`IconButton`/`AiButton`) | 0 | 18 (+19 `makeButton`) | 0 | 9 | 5 | 69 | 0 | 0 |
| `createPageHeader` calls | 0 | 1 (shared by all sections) | 0 | 2 | 0 | 1 | 0 | 0 |
| Hand-built empty states (own class or hand-assembled `.px-empty`) | 10 | 19 | 0 | 24 | 21 | 37 | 0 | 2 |
| `createEmptyState` calls | 0 | 2 | 0 | 7 | 0 | 2 | 0 | 0 |
| `--vscode-*` references | 73 | 83 | 0 | 331 | 0 | 505 | 0 | 68 |
| `--parallx-*` references | 5 | 0 | 5 | 147 | 0 | 115 | 0 | 6 |
| Raw colour inside a `var()` fallback (`var(--x, #hex)`; the ratchet's lookbehind skips these) | 8 | 94 | 0 | 106 | 0 | 189 | 0 | 62 |
| `font-family` set | 2 | 3 | 5 | 50 | 2 | 30 | 0 | 6 |
| Off-scale weight (500/550/650/700/bold) | 0 | 10 | 2 | 11 | 32 | 3 | 0 | 0 |
| `letter-spacing` other than normal | 2 | 7 | 5 | 10 | 17 | 10 | 0 | 0 |
| px heights (controls and layout) | 11 | 36 | 8 | 48 | 50 | 164 | 0 | 2 |
| px radii (not `--px-radius-*`) | 19 | 18 | 1 | 64 | 5 | 134 | 0 | 8 |
| Distinct px radii | 2,4,6,7,9 | 1,2,3 | 1 | 2,3,4,6,8,9,10,12,14 | 2 | 1,2,3,4,7,8,10,11 | – | 2,4 |
| `z-index` | 3 | 2 | 0 | 5 | 3 | 50 | 0 | 2 |
| `position: fixed` | 0 | 1 | 0 | 2 | 1 | 9 | 0 | 0 |
| `vh`/`vw` | 0 | 1 | 0 | 1 | 2 | 6 | 0 | 0 |
| DOM mounted on `document.body` (outside the container) | 0 | 3 | 0 | 7 | 1 | 18 | 0 | 0 |
| Inline style setting look (`style=`, `cssText`, `.style.color/background/fontSize/…`) | 1 | 52 | 3 | 24 | 0 | 26 | 0 | 99 |
| Confirmation via `showWarningMessage` buttons (not `showConfirmModal`) | 5 | 0 | 0 | 8 | 2 | 6 | 0 | 0 |
| `showConfirmModal` calls | 0 | 1 | 0 | 0 | 2 | 4 | 0 | 3 |
| Toasts (`show{Information,Warning,Error}Message`) | 18 | 45 | 0 | 12 | 43 | 206 | 0 | 0 |
| Native `date`/`color`/`range`/`checkbox`/`radio` inputs (kit gaps) | 1 | 7 | 1 | 5 | 5 | 40 | 0 | 22 |
| AI icon misuse (`sparkles`, `wand-sparkles`, `brain`) | 0 | 2 | 0 | 11 | 1 | 5 | 0 | 0 (plus ✦ glyph) |
| `message-circle` for chat (the mark is the rule) | 0 | 0 | 0 | 14 | 0 | 0 | 0 | 0 |
| Unicode glyphs as icons (arrows ⟳ ⤢ ↗ ↺ ▸ ← →) | 0 | 23 (mostly prose →) | 9 | 2 | 3 | 31 | 2 | 14 |
| `--px-*` tokens that don't exist in core | `--px-surface` ×5 | 0 | 0 | 0 | 5 kinds (below) | `--px-surface` ×13 | 0 | 0 |
| `window.parallxElectron` used directly | 4 | 0 | 0 | 0 | 0 | 222 | 0 | 0 |

Escapes worth closing in the ratchet:
- `el('select', …)` / `moEl('select')` isn't matched by `nativeSelect`. creations-ai `tgSelect` falls back to a native `<select>` (`main.js:4777`).
- Colours behind `var()` fallbacks: 459 in total.
- Hand-built buttons: 414 in total, against 101 kit button calls.
- Dialogs on `document.body`: 29.
- Confirms through notifications: 21.
- `--vscode-*`: 1,060. `--parallx-*`: 278.

DESIGN_UNIFICATION §5 lever 4 asked for radius/height/font-family/z-index and `createElement('button'|'select')` rules. None of them were added.

## 3. UI_AUDIT 2026-10-01: which extension findings are still open

| Extension | Finding (UI_AUDIT §3/§1) | Status today |
|---|---|---|
| Budget | Palette deep links do nothing when the tab is open | **Fixed.** `openBudgetSection` drives the live editor through `_liveEditorShow` (`main.js:323–328`). There is one Budget tab and `COMMAND_ROUTES`. |
| Budget | Uppercase tracked card labels (S7) | **Fixed.** uppercase is 0. Leftover `letter-spacing:-0.02em` on the 34px net-worth number (1059). |
| Budget | Monospace money | **Fixed.** Uses `tabular-nums` (476 and others). |
| Budget | 3-card overview grid with a hole | **Fixed.** The old dashboard was removed in the redesign. |
| Budget | "Last sync 3/31/2026" on a profile that never synced | **Fixed.** `readSyncStatus` returns "Not synced yet". |
| Budget | 18 old-purple refs | **Fixed.** retiredPurple is 0. |
| Budget | 349 raw colours | **Mostly fixed.** 30 counted (data palette). 94 sit in uncounted fallbacks, about 25 of them in dead CSS. |
| Budget | Open-editor rows use the generic file icon | **Fixed.** Tab opens with `icon: 'wallet'` (327). |
| Budget | 29 light-mode contrast failures | Not verifiable statically. |
| Browser | Small page titles | **Open.** `.br-page-head h2 { font-size: 18px }` (283), a hand-built `pageShell` (1526). |
| Browser | Shields' three buttons are tiny | **Partly fixed.** The panel buttons are now `--px-control-h-sm`. The Blocked Trackers page still has three same-weight hand-built buttons (Refresh, Refresh Lists, Clear Log). |
| Browser | Creates `Downloads/` in the workspace on first launch | **Fixed.** `electron/browserBridge.cjs:496–504` creates it only when a download happens. |
| Browser | 8 light-mode failures (faint captions) | Not verifiable statically. Captions are dimmed with `opacity` (16 rules, e.g. 312, 362, 367, 383), not tokens, which is the likely cause. |
| Concept Lab | Sidebar level headers uppercase tracked, wrapping | **Uppercase fixed** (`.cl-side-level` uses `text-transform:none`, 5585). Wrapping not verifiable. |
| Concept Lab | Guide title 2.91:1 | **Likely fixed by S1.** `--px-base-40` was raised to `#838893` in `px-tokens.css:59`. It is still tracked: `letter-spacing:.06em` (5406–5413). |
| Creations AI | Tool is "Text Generator" in its tab | **Fixed in UI.** Home tab is "Creations". Command titles lost the doubled "Creations AI:" prefix in `1229cffa`. The `textGenerator.*` ids remain (internal). |
| Creations AI | Emoji "User message ✍️" (8310) | **Fixed.** Now `formGroup('User message', …)` (8821). |
| Creations AI | Model dropdown truncates "No Models Av…" | **Fixed.** Label is now "No Models" (7642). |
| Creations AI | "From A Concept" chip 2.33:1 in light | Contrast not verifiable. The label still breaks Title Case ("A") (`studio.js:253`). |
| Flashcards | Stats uppercase tracked labels (3.45/2.98:1) | **Uppercase fixed.** Labels are still weight 700 in `--px-text-faint` (5586, 5604). |
| Flashcards | "Generate Cards" AI button 2.2:1 in light | Core `createAiButton`. Not verifiable here. |
| Media Organizer | Practice/Daily/Plans commands only toast; Title Case in a sentence | **Mostly fixed.** `moArtGate` (31394) now offers **Turn On** and retries, in sentence case. It is still a notification after the click, not a disabled entry with the fix in place. |
| Media Organizer | Sidebar: Duplicates clipped; four section-header styles | **Header styles fixed.** There is one `sidebarSection()` (10456). Clipping not verifiable. |
| Media Organizer | 645 `--vscode-`, 2 token font sizes, 117 white literals | **Improving.** 505 `--vscode-`, 148 token font sizes, 72 white literals. Still 113 px font sizes at 11 distinct values (9–28). |
| Media Organizer | `mo-context-menu` clone (ALPHA_UNIFICATION) | **Fixed.** `showContextMenu` (17671) is a shim over `api.ui.showContextMenu`. |
| Web Research | No UI | Still none. |
| Workspace Graph | Toolbar of seven tiny buttons wraps and clips "Settings" | **Partly fixed.** Five hand-built icon buttons plus two text buttons (`main.js:1443–1452`), with `overflow:hidden`, so it may clip rather than wrap. Not on the kit. |
| Workspace Graph | Nodes are unlabeled dots at rest | **Open.** Labels appear only on hover/selection or at zoom ≥ `labelZoomStart` 4.0 (1333–1355). |
| Workspace Graph | Legend hard-coded `rgba(30,30,30,.85)`, dark in light mode | **Fixed.** `color-mix(var(--px-bg-elevated)…)` (1989). **New:** the canvas itself is still dark-only: label ink `rgba(220,221,222,a)` (1354), edges `rgba(255,255,255,.12)` (195), selected node `#ffffff` (1301), pin dot `rgba(255,255,255,.5)` (1323), font `-apple-system,"Segoe UI"` (1351). |
| (S8) Internal commands in the palette | | **Fixed in core.** `src/commands/quickAccess.ts:262` skips untitled commands. Side effect: Budget's Reprocess toast tells users to "Use Reclassify untyped" (`main.js:8575`), and that command is now unreachable (dead end, §8). |

## 4. DESIGN_UNIFICATION status (extension-relevant rows)

| §1/§5 item | Status |
|---|---|
| Budget: sidebar pages + Plan sub-tabs + Settings sub-tabs; deep links fail | **Fixed.** One tab, one kit page header, Plan views on `createSegmented` (8443), settings in app Settings (`Budget Settings…` in ⋯). Unlike the target ("sidebar shows accounts and categories"), the sidebar lists the editor's sections. That isn't a duplicate, because the editor has no tab strip. |
| "New X" as a full-width bottom button (Budget Sync Now, Creations New Chat) | **Budget fixed.** Sync is an icon button beside the status (1218). **Creations open.** `tg-new-chat-btn` is full-width, VS Code blue, at the sidebar foot (`main.js:4875`, CSS 249–267). **Browser** puts a full-width primary "New Tab" at the sidebar top (1759, CSS 372–373). |
| Tool settings live in their own pages | **Budget fixed.** **Creations open:** own Settings editor (8733) and Chat Info editor (9464), 0 app Settings contributions, a Settings row in the sidebar (4854). **Workspace Graph open:** own Graph Settings panel (1472–1600), 0 contributions. |
| Toolbars ≤ 3 visible actions, icon-only (§2) | **Open.** Flashcards Decks home has search plus 5 text buttons (6697–6732). Workspace Graph has 5 icons and 2 text buttons plus search. MO grid toolbar and Creations chat toolbar (Model, Ctx, 3+ icon buttons) also exceed it. |
| Media-organizer "22 button classes, 26 tab/chip/pill, 16 empty-state"; creations "20, 13, 5" (§5) | **Not reduced.** MO has about 23 live button classes, 49 chip/pill/badge, 9 tab and 21 empty-state classes. Creations has about 20 button classes across three families (`tg-*`, `cr-*`, `cs-*`). |
| Icon dictionary (§3): mark only where clicking calls the AI | **Open.** See §6 per extension. |

---

## 5. Media Organizer ("Atelier"): rank 1, farthest from the rules

**Scorecard** (method §2): 37,241 code lines, 4,000 of them CSS (`MO_CSS`, `main.js:5151–9150`, 948 classes). Ratchet: 129 raw colours, 113 px font sizes, 2 uppercase, 2 emoji. Uncounted:
- 167 hand-built buttons against 69 kit button calls
- 505 `--vscode-*` and 115 `--parallx-*`
- 189 fallback colours
- 134 px radii at 8 distinct values
- 164 px heights (28 off-ladder control heights such as 18/20/26/30/34–40)
- 50 z-index, 9 `position:fixed`, 18 body mounts
- 6 notification confirms, 206 toasts
- 40 native inputs, 222 `window.parallxElectron` calls
- 1 page header across 9 editor views

About 25–30 classes appear dead: `mo-filter-panel`, `mo-filters-btn`, `mo-filter-section*`, `mo-filter-badge`, `mo-detail-nav-btn`, `mo-detail-star`, `mo-list-star`, `mo-clip-mode-toggle`, `mo-clip-track`, `mo-ce-estimate`, and others.

**Worst screens and components**
1. **Modal and overlay family on `document.body`.** Shortcuts cheat sheet (`moShowShortcutsCheatSheet`, 10257→10369), bulk tag (18053→18490), add to album (18498→18554), bulk delete (18560→18651), create tag (18670→18802), optimize GIF (18812→19028), upscale (27899→28153), upscale setup (28159→28203), duplicate finder (28697→28782), practice setup (31705→31829), plan editor (33088→33578), save-edit prompt (35328→35356). Plus full-screen lightbox (17345) and compare view (17621). Each has its own scrim, z-index and close button.
2. **Grid browser toolbar.** Three popovers mounted on body (search help 12079, view 12240, filter 12345), hand-built filter pills, a 2-line operator tooltip (12025).
3. **Clip editor** (`moBuildClipEditor`, 21729 on). Its own tab bar (`mo-ce-tabs`), toasts (`mo-ce-toast`), banners, sheet bar, split menus and swatches. A `conic-gradient` colour wheel (7884–7885). "Add Smart Zoom" uses `sparkles` but is not AI (22895, 24635).
4. **Image editor** (`renderImageEditor`, 36447). Own tool tabs (`mo-edit-tabs`), own toasts, an 'Enhance' tool with a `wand-sparkles` icon (36443), "Auto" with `sparkles` (37218).
5. **Eight of nine views have no kit page header:**
   - Practice (`mo-home-title`, 31712)
   - Plans (32575)
   - Tag Review and Remove From Other Photos (`mo-tr-head`, 30697, 35905)
   - Detail (`mo-detail-header`, 15204)
   - Album (`mo-album-header` h2, 16661)
   - Clip project (`mo-cp-head`, 19794)
   - Clip and image editors

   Only the grid uses `createPageHeader` (11970).

**Chrome clones with file:line**
- Buttons: `.mo-btn-primary/.mo-btn-secondary/.mo-toolbar-btn/.mo-segment-btn/.mo-menu-btn` and others in MO_CSS, `moEl('button', …)` ×167.
- Segmented and tabs: sidebar Browse Folders|Tags is `mo-browse-segbtn role="tab"` (10660), and `.mo-segment` exists too.
- Empty states: `mo-empty`, `mo-empty-rich*` and 19 more classes, 37 constructions, 2 kit calls (19861, 20184).
- Section headers: `sidebarSection()` (10456) rather than `createSectionLabel`.
- Toasts and banners: `mo-ce-toast`, `mo-edit-toast`, `mo-ce-banner`.

**Copy**
- Title Case with capitalised small words, 29 of them: "Tag With AI"/"Retag With AI" (14523, 14524, 14588, 17817), "Save As Smart Album" (11980; it also opens a prompt but has no "…"), "Remove From Other Photos" (35852), "Save As Copy" (36625), "What To Remove"/"How To Save"/"Photos To Look In" (35912–35917), "Show Tags On Cards" (12247), "Group By Date" (12171), "Update With This Edit" (37894).
- Inconsistent forms: "Add To Chat" (16385) vs "Add to Chat" (14542, 14619).
- Manifest: "Set Up The Upscaler", "Paste Edit Onto Selected Photos", "Remove Marks From …", "Build Perceptual Hashes (find near-duplicates)".
- Three dots instead of …: "Loading..." (15214), "Add tag..." (16094), "Select an album..." (18512).
- Ampersands in labels: "Clear Search & Filters" (12677), "Favorite & label" and others in the cheat sheet (10280–10298).
- 17 tooltips of 100+ characters. Example: the Remove From Other Photos "what" dropdown (35915): "Mark Only removes the mark's own shape, worked out from …".
- A toast names a command that doesn't exist: "use "Save Smart Album"" (28482).

**Dead or misleading controls**
- Palette commands that can only toast:
  - Edit Image: "Select one photo in the library, then choose Edit Image."
  - Paste Edit Onto Selected Photos
  - Remove Marks From Selected Photos
  - Remove Marks From Other Photos
  - Open Clip Editor (38788)
  - Save Current Search as Smart Album (38848)
  - Reveal in Atelier, whose toast reads "Reveal in Atelier: no path provided." (38888)
- **Move Selected to Trash** with nothing selected toasts "Moved 0 items to trash." (38870). With no library open it does nothing.
- Maintenance commands in the user palette: Generate Thumbnails, Clean Orphan Thumbnails, Show Thumbnail Cache Stats, Rebuild Search Index, Build Perceptual Hashes.
- Tag Review uses the mark in the sidebar (10512) but its tab opens with `sparkles` (30460).

**Placement**
- The sidebar follows the "+" rule (Collections, Studio and Folders have `+` in their header), with Trash as a foot row.
- Studio's Daily Study, Practice Session and Painting Plans rows open editors, which is fine.
- No Settings row.

**AI-generated look**
- Gradients are functional (skeleton shimmer, caption scrim, slider tracks, progress). None are decorative.
- `sparkles` is used for non-AI "smart" features, which breaks the one-concept-one-icon rule.

**Single best migration:** the dialog family. It holds the body mounts, z-index, scrims, raw shadows and many of the button clones. The kit needs a form dialog for it (§11). After that, the buttons.

---

## 6. Creations AI: rank 2

**Scorecard:** 13,308 lines. Ratchet: 12 raw colours, 27 px font sizes (10–24, including 11.5), 1 emoji (`'⚠ '` 6144). Uncounted:
- 75 hand-built buttons against 9 kit
- 331 `--vscode-*`, 147 `--parallx-*`, 106 fallback colours
- 50 `font-family`, 64 px radii (2,3,4,6,8,9,10,12,14px)
- 7 body mounts, 8 notification confirms
- 11 sparkles/wand/brain icons, 14 `message-circle`
- 2 page headers across 8 editor types

Three button families: `tg-*` (legacy), `cr-*` (new home), `cs-btn` (`studio.js:369`, `story.js:333`, `tables.js:263`).

**Worst screens and components**
1. **Chat editor** (`renderChatEditor`, 4996).
   - Toolbar labels "Model" and "Ctx" (5012, 5026), with an "Ollama num_ctx … VRAM" tooltip (5030). This is the jargon UI_AUDIT flagged in core chat.
   - Empty state "Error: missing workspace or thread." (5007, 9476, 8987).
   - Five hand-built modals: `tg-modal-overlay` at 5797, 5838, 5911, 6026, 6125, mounted on body; CSS 1158–1175 has `position:fixed; z-index:1000; rgba(0,0,0,.5)`, `80vh`, and a raw shadow.
   - Two hand-built toasts (2909, 5493; CSS 1030–1046 has `position:fixed; z-index:1000`).
   - `brain` icon for Memory (5059, 5075).
2. **Sidebar** (`renderSidebar`, 4817). It breaks all three placement rules:
   - Home/Characters/Stories/Tables rows open the editors that the Home page also launches (4850–4853).
   - A **Settings row** (4854).
   - A **full-width bottom "New Chat"** in VS Code blue `#0e639c` (4875; CSS 249–267).
   - Also: own section header with `message-circle` (4864), own search, a text-only empty state without a period ("No conversations yet"), and delete confirmed by notification with no Cancel (4925).
3. **Home** (`renderHomePage`, 8057). No page header. AI-landing look:
   - Question hero "Who do you want to meet?" (8069) with a `sparkles` prompt icon (8071) and a `wand-sparkles` primary "Make Character" (8079), plus "Surprise Me" and "Try" suggestion pills.
   - Four quick-start cards with tinted icon tiles (8110–8115) that repeat the sidebar.
   - Continue cards whose first "Continue" is painted as a second accent fill (CSS 2042), so there are two primaries.
   - Six-column cast cards. Five card styles on one page.
4. **Settings pages**: Creations Settings (8733, kit header) and Chat Info (9464, hand-built header). Settings stay in a tool page, not app Settings.
5. **Studio, Stories, Tables**: `cs-btn` buttons; `sparkles` on Generate (`studio.js:319`), Continue (`story.js:308`), Raise The Stakes (316) and Rewrite (485); `brain` on Update Memory (292). Their list rails are list → detail, which is allowed.

**Chrome clones**
- Toggle `tg-cs-toggle*`, drawer `tg-drawer-*`, modal `tg-modal*`, toast `tg-toast*`, chips `tg-cs-chip*`/`tg-drawer-chip*`.
- Empty states `tg-empty`, `tg-cc-empty`, `tg-cc-list-empty`, `tg-ce-lore-empty`, `cr-memory-empty`, `st-empty`, and `tg-welcome` (centred, 24px, opacity .5, CSS 776–790).
- `tgSelect` native `<select>` fallback (4777, uncounted).

**Copy**
- "Saved!" ×3 (8895, 9297, 9539).
- Title Case small words: "Use As A Concept" (8164), "Start A Chat" (8407), "Back To Studio" (8392), "Export As Markdown…" (8410), "From The Name" (`studio.js:421`), "From A Concept" (`studio.js:253`), "Roll A Table" (`tables.js:384`), "Raise The Stakes" (`story.js:316`).
- Mixed case inside one dropdown: "Replace existing reply box text (if any)" / "Append on New Line" (5955–5957).
- Parenthetical labels: "Keep the memory file and quote earlier turns (recommended)" (8885, 9243), "Inherit (character / global default)" (7814).
- Placeholder with three dots: `'e.g. "Type your reply to {{char}} here..."'` (9284).
- Lowercase action labels: "add a character shortcut" / "add a custom shortcut" (5808, 5812).

**Icons:** chat tabs use `message-circle` (8054, 10089, 10171). The Character Studio tab uses `sparkles` (10120). The Home tab uses `px-ai-mark` (10099), but opening Home doesn't call the AI.

**Dead or misleading:** New Chat with no workspace gives a bare "No workspace open." error toast (10046).

**Single best migration:** retire the `tg-*` legacy stylesheet in favour of the kit and tokens (chat editor, sidebar, modals, toasts), together with the sidebar and settings placement fix.

---

## 7. Workspace Graph: rank 3, worst density (133 violations per 1k lines)

**Scorecard:** 2,769 lines.
- Ratchet: 49 raw colours (file-type and domain palettes 516–543 and 811–814 are data), 45 px font sizes, 4 emoji (✓ ✕ ✎ ✦).
- Uncounted: 16 hand-built buttons (13 `<button` in template strings), 68 `--vscode-*`, 62 fallback colours, 99 inline style attributes, 22 native range/checkbox inputs, 14 arrow glyphs used as icons.
- Kit use: only `createDropdown` (1871) and `showConfirmModal` ×3.

**Worst screens and components**
1. **Canvas in light mode.** Label ink `rgba(220,221,222,a)` (1354), edges `rgba(255,255,255,.12)` (195), selected node `#ffffff` (1301), pin dot (1323) and canvas font `-apple-system,"Segoe UI"` (1351) are all fixed. The pane background follows the theme (1430), so labels and edges wash out on paper.
2. **Graph Settings panel** (`_buildSettingsPanel`, 1476–1600). Inline HTML with `--vscode-*` and `#hex` fallbacks, 2px radii, 11px text. The primary is VS Code-blue "Refresh mind map" (1515). It also has "Force full re-cluster" (1527), "History ▸", ten native checkboxes, seven native range sliders, and `z-index:10` (1472). It is a settings surface inside the tool, not app Settings.
3. **Inspector** (2187–2500).
   - "Ask AI" is a hand-built button with `#1a1a2e` fallbacks (2210–2212) and no mark. The disabled variant is "✦ Ask AI" in `#555` (2214).
   - "↺ Re-ask AI" / "→ Add to Chat" (2478).
   - "Thinking" plus animated dots (2451).
   - Errors in `#a55` (2335, 2432, 2441).
   - `↗` and `×` glyph buttons (2191–2192).
4. **Toolbar** (1438–1452). Hand-built `_btn`/`_iconBtn` (1372, 1385) with `font-family:var(--parallx-fontFamily-ui)` and hover set in JS.
5. **Sidebar mini-graph overlay** (2640–2648). Glyph buttons `⟳` and `⤢` (`_miniBtn` 2606, 14px), `z-index:2`.

**Copy**
- Sentence-case actions: "Refresh mind map", "Cancel refresh", "Force full re-cluster".
- Title Case field labels in the settings panel ("Edge Width", "Label Zoom Start").
- The re-cluster confirm detail exposes "DBSCAN output" (1755).

**Dead or misleading:** **Workspace Graph: Refresh** only opens the editor (2794–2799). Rebuild Conceptual Links silently returns when the service is missing (2802).

**Single best migration:** theme-aware canvas colours read from `--px-*` tokens, plus moving Graph Settings into `contributes.configuration` (app Settings). The toolbar and inspector can then use `createIconButton`/`createAiButton`.

---

## 8. Budget: rank 7, close after the 10-02/03 rework (what remains)

**What is now right**
- Every section starts with one kit page header carrying its primary and ⋯ (1370–1373).
- `makeButton` is the kit button (1465).
- Kit dropdown, segmented control, filter chips and context menu are used.
- Settings are in app Settings.
- The deep-link bug is gone.
- The sidebar is glance, sections and a sync status with an icon button.

**Remaining scorecard**
- 9 hand-built buttons: nav rows (1188), drawer close ×3 (1796/3571/3915), Review queue rows, the goal card. Rows are acceptable.
- 19 hint-only empty states. `emptyState()` (1476) builds `.px-empty` by hand with no headline or action.
- 3 body-mounted drawers.
- 20 real `--vscode-*` uses and 52 inline style settings.
- About 25 dead CSS classes still carrying old fallbacks: `budget-heatmap-cell`, `budget-status-chip*`, `budget-pill`, `budget-trend-delta`, `budget-insight-*`, `budget-account-card`, `budget-catrow-*`, `budget-row-*`, `budget-btn-danger`, `budget-select`, `budget-hero-cards`, `budget-donut-wrap`, `budget-month-picker`, and others.

**Worst remaining**
1. **Drawers** for the transaction editor (1761), manual balance (3552) and goal (3897). Each is `document.body.appendChild` (1952, 3666, 3981) with `.budget-drawer-overlay { position:fixed; z-index:1000; background: rgba(0,0,0,.5) }` (997–1001), a raw shadow fallback (1009), `92vw`, and a `'✕'` fallback close button.
2. **Import / Export** (5163–5316), the last unconverted page:
   - 10 inline `--vscode-descriptionForeground`/`--vscode-errorForeground` colours with `#888`/`#f87171`/`#6ec77a` fallbacks
   - inline `fontFamily` (5195)
   - an over-explaining blurb ("…Imports dedupe against your CSV history…", 5168)
   - two primaries, "Import" (5207) and "Export Now" (5290)
3. **Trends** (`renderCashFlowSection` 4021, `renderReportsSection` 4120):
   - Title Case `h3` section headings: "Income vs Expenses" (4077), "Net Savings" (4092), "Top Merchants (3 Months)" (4146), "Expenses by Category (3 Months)" (4177), "Monthly Expense Trend" (4219)
   - inline `--vscode` colour and `font-size:10px` (4169–4170)
   - a donut (4199) that the redesign doc says was retired with the dashboard
4. **Net Worth hero** `.budget-networth-value { font-size:34px; font-weight:700 }` (1059, used at 3732).
5. **Month-to-date dashboard widget**: px fonts 26/11/12 and weight 700 (8153–8159), and a hand-written inline SVG icon instead of the registry (8170).

**Copy and controls**
- **Reprocess History…** (manifest and ⋯ 1354) runs immediately, with no dialog and no confirmation, over the whole history (`reprocessHistory`, 8572). The "…" promises a dialog that never appears. Its result toast says "…row(s)… Use Reclassify untyped to ask the AI." (8575), but `budget.reclassifyUntyped` has no title and is hidden from the palette (`quickAccess.ts:262`). That is a dead end.
- **Sync Now** without MCP or LM toasts "Budget sync requires capabilities not available: api.mcp, api.lm." (8561–8566). That is developer jargon with no fix offered.
- Empty states expose raw errors: "Query error: …" (2880, 2945).
- AI provenance uses `sparkles` ("The AI read it as …", 1999, 2016). The rule says the mark, or no icon.
- **One primary** is broken on Plan › Bills, where each unconfirmed bill row has a primary "Confirm" (4686–4688), and on Import / Export.
- Mixed case in the drawer footers: "Add Transaction" (1948) vs "Add holding" (3663) and "Create goal" (3979). Placeholder "Statement Balance ($)" (5102).

**Ratchet:** refresh the stale baseline (pxFontSize 12 → 10). Drop the three `'✕'` fallbacks (emoji → 0).

**Single best migration:** the three drawers. They need a kit side sheet or form dialog. Quick wins alongside: convert Import / Export, delete the dead CSS, and replace `emptyState()` with `api.ui.createEmptyState`.

---

## 9. Browser: rank 4

**Scorecard:** 4,608 lines.
- Ratchet: 9 raw colours, 38 px font sizes (11 distinct, 9–28).
- Uncounted: 28 hand-built buttons and **0** kit buttons, page headers, empty states or section labels; 73 `--vscode-*`; 19 px radii (`--parallx-radius-md` 6px on buttons, 297); 5 notification confirms; 16 opacity-dimmed text rules; undefined `--px-surface` ×5.

**Worst screens and components**
1. **Internal pages** (1462–1700). The hand-built `pageShell` (1526) uses an 18px `h2` (283) and a 12px body. Text-only `br-empty` lines appear 10 times. Subtitles over-explain: "Everything you starred. Click a title to open it here." and "Every request the shields refused … Nothing here ever reached the network." Blocked Trackers has three equal text buttons (Refresh, Refresh Lists, Clear Log). History and Clear Log confirm through `showWarningMessage` (1604, 1687).
2. **Sidebar** (1754–1890).
   - A full-width primary "New Tab" at the top, plus private and history icon buttons (1759–1773). It should be a `+` in a section label row.
   - Own collapsible section heads at 11px (1783–1810, CSS 375).
   - A **"Site Settings"** section with the settings icon (1865).
   - A "Clear List" text button inside Downloads (1846).
   - An over-long empty hint: "No site has custom settings. Shields are up, third-party cookies blocked, HTTPS upgraded everywhere." (1873)
3. **Shields popover** (`br-panel`, CSS 333: `z-index:6`, raw shadow `rgba(0,0,0,.3)`). It has its own toggle `br-switch` (343) and Title Case field labels "Block Trackers And Ads", "Upgrade Connections To HTTPS", "Allow Redirects To Other Sites" (1025–1027).
4. **Address suggestions** `br-suggest` (308: `z-index:5`, raw shadow). This is a reasonable special case, but it is a dropdown clone.

**Copy**
- "Find In Page" (1165 and manifest), "Open In System Browser" (1172), "Open Link In New Tab" (1181), "Open Image In New Tab" (1186), "Show In Folder" (1855), "Send Page To Chat" (manifest).
- Section labels in Title Case: "Recently Visited" (1482), "Most Blocked" (1669), table header "On Page".
- A toast on every finished download (1948).

**Placement:** a full-width primary in the sidebar and a settings-like section, as listed above. The browser chrome inside a page (back, forward, address bar) is domain UI and acceptable. It should still use `createIconButton`.

**Single best migration:** internal pages on the kit (header, empty state, buttons, section labels), plus `showConfirmModal` for the five confirms (1407, 1424, 1442, 1604, 1687).

---

## 10. Flashcards: rank 5

**Scorecard:** 11,163 lines.
- Ratchet: 24 raw colours (the white paper card, deliberate), 0 px font sizes, 2 emoji (✓ ✗ point glyphs 1815).
- Uncounted: **103 hand-built buttons** (`fc-btn` clone, CSS 4827–4848 plus `--ghost/--icon/--small/--primary`) against 5 kit AI buttons; 0 page headers across about 11 routes; 32 off-scale weights (550 on every button 4831; 650 on titles 4971/5018/5080; 700 on labels 5586/5604); 17 letter-spacing values, including the tracked 0.05em leech chip (5317); 1 body-mounted dialog; 2 notification confirms.
- **Five tokens that don't exist:** `--px-text-disabled` ×6 (4742, 4802, 4872, 4913, 4972, 5573), `--px-bg-raised` (5217), `--px-surface-raised` (5412), `--px-border-subtle` (5451), `--px-leading-relaxed` (5405). So zero counts aren't dimmed, and those borders and backgrounds don't render.

**Worst screens and components**
1. **Decks home** (6610–6735).
   - Hand-built masthead (`h1` with letter-spacing −0.02em) and a Stats button that repeats the sidebar's Stats (6637–6641).
   - CTA row with a primary "Study N Cards", or a **disabled primary reading "Nothing Due Right Now"** (6666–6672), plus Memorize and Custom Study.
   - An action row of search plus **five text buttons**: New Deck, New Custom Deck, Generate Cards (accent AI pill, so a second accent fill), Import Cards, Exam Dates.
2. **Routes without a title**: Stats (10888), Create (10128), Import (10528). A breadcrumb only; the other routes use ad-hoc `fc-view__title`.
3. **Exam-date dialog** (6223→6240; CSS 5004: `position:fixed; z-index:10010; rgba(0,0,0,.5); backdrop-filter:blur(3px)`, `vw`/`vh`).
4. **Study card** (5266–5340). Fixed white paper with hex inks and a serif font-family stack (5329). Deliberate and documented, but it ignores the theme and sets a font-family.

**Copy**
- Manifest: "Custom Study (Work Ahead)", "Generate Cards from Source (AI)", "Show Progress & Stats".
- Menu: "Score Importance (AI)" and "Classify Recall Modes (AI)" next to the mark icon (1418–1419), which is redundant.
- Mixed case section labels: "Source Material", "Coverage Report", "Recall Mode", "Days Ahead", "Edit This Card" vs "New card", "Into deck".
- Title Case small words: "Merge Into Another Deck…" (1420), "Write The Formula" (8920).
- Caps emphasis "that is NOT a duplicate verdict" (7961).
- Em dash in toasts (6098, 6121).
- Long import hint (10530).

**Dead or misleading:** **New Card** (`flashcards.newCard`) just opens Flashcards on Decks and shows no card form (`main.js:11864`: `['flashcards.newCard', () => openFlashcards()]`).

**Placement:** the sidebar is the best of the eight. It has a `+` in the Decks section label row (5809–5815) and no Settings row. The rail is `role="tablist"` (5761), which looks like tabs. The "Create" rail item uses the mark (5699) on a navigation entry rather than an AI call.

**Single best migration:** `fc-btn` to `api.ui.createButton` (103 sites), plus a `createPageHeader` per route (title, one primary, ⋯ for the rest). That also fixes the six-button toolbar.

---

## 11. Concept Lab: rank 6

**Scorecard:** 10,423 lines.
- Ratchet: 6 raw colours (chart inks), 4 px font sizes (SVG text 9.5/10/11px, 5299–5330).
- Uncounted: 16 hand-built buttons and **zero kit calls of any kind**; 5 font-family declarations; weight 700 on level numbers (5503) and 500 on scene buttons; tracked `.cl-guide-title` (0.06em).

**Worst screens and components**
1. **Home** (`renderHomeView`, 9913).
   - Hand-built title and a 60-word intro paragraph (9921).
   - A guide panel "How To Use The Lab" (9929) with six icon tips in a feature grid. The tips use caps emphasis ("COMMIT", "SHOWN", 9936–9939), and "Ask The Instructor" uses the `message-square` icon.
   - Numbered "01"–"07" level headings at weight 700.
   - Cards fade in with a staggered `animationDelay` (9991).

   Together these read as a marketing landing page.
2. **Module header** (10031–10070). A hand-built `cl-header` with a `cl-back` button (CSS 4952: 28px, `--px-radius-md`) and a pill source chip. It should be `createPageHeader({ back })`.
3. **Rail and scenes.** Pill-shaped buttons: `cl-scene-btn` (5070, `--px-radius-full`, 2xs text, weight 500), `cl-preset-chip`, `cl-ghost-btn`, `cl-ghost-chip`. Rail labels are hand-built (`cl-rail-label`) rather than `createSectionLabel`.

**Copy**
- 71 of 407 parameter labels capitalise small words, for example "Variance Of Hypothetical Means" and "Paid To Date (% Of Premium)". Field labels should be sentence case.
- 10 labels write the acronym as "**Sd**", for example "Sd Of True Ultimate" (1046–1047).
- Rail labels in Title Case: "Worked Examples", "Builds On", "Where The Exam Uses This".
- Tooltips "Back To Modules" and "Remove This Ghost".
- Caps emphasis in prose: "the SECOND moment", "HOW FAST", "EXACTLY" (3442, 4188, 4645).
- Ampersands in level titles (812–817).

**Placement:** the sidebar is content (modules by level), which is fine. Uppercase is fixed. "All Modules" opens the editor home, which is acceptable.

**Single best migration:** `createPageHeader` on Home and Module (`back`), plus kit buttons and section labels. It is already fully on tokens, so this is purely structural.

---

## 12. Web Research: rank 8

No views, editors or commands. All findings are in the Settings copy (`parallx-manifest.json`):
- The extension description says "Implements the M65 seven-layer trifecta defense", an internal milestone in user-facing text.
- `webResearch.hubPageId` describes itself as "Canvas page id … the research-topic skill reads this via getResearchHub and writes it via setResearchHub". That is API jargon on a raw-id setting a user shouldn't edit.

---

## 13. Cross-cutting: why clones persist (kit gaps)

The extensions clone the same missing pieces. Per §6.3 ("the kit grows"), these should be added to `src/ui/kit.ts` before extensions are migrated:

| Missing kit piece | Cloned by |
|---|---|
| Form dialog / side sheet | budget ×3 drawers; MO ~11 dialogs; creations ×5 modals; flashcards date dialog |
| Toast with an action | creations `tg-toast`; MO `mo-ce-toast`/`mo-edit-toast`; budget Review undo bar (documented) |
| Toggle switch | browser `br-switch`; creations `tg-cs-toggle` |
| Tabs | MO `mo-ce-tabs`/`mo-edit-tabs`; MO sidebar segmented tabs; flashcards rail |
| Popover | browser `br-panel`; MO view, filter and search-help popovers |
| Search input | every sidebar has its own |
| Slider, date and colour inputs | 76 native inputs across extensions |
| Stat tile | flashcards `fc-stat`, budget glance, browser `br-panel-count` |

A `createTree`-style sidebar (DESIGN_UNIFICATION §5 lever 2) would remove the seven sidebar shapes in one move.

---

## 14. Top 20, ranked (impact = how visible × how widespread × how hard the rule is)

1. **MO dialog family on `document.body`.** About 11 hand-built modals plus 3 popovers, lightbox and compare, each with its own scrim and z-index (§5). Needs a kit form dialog.
2. **The ratchet's blind spots let most drift through.** Uncounted: 414 hand-built buttons (vs 101 kit), 1,060 `--vscode-*`, 278 `--parallx-*`, 459 colours in `var()` fallbacks, 29 body mounts, 21 notification confirms, and `el('select')`. Add these kinds to `extStyleRatchet.test.ts` with today's counts as the baseline. Also refresh budget's stale pxFontSize baseline (12 → 10).
3. **Creations sidebar breaks all three placement rules.** Page links that duplicate the Home launchers (`main.js:4850–4853`), a Settings row (4854), and a full-width VS Code-blue New Chat at the bottom (4875). The tool also has its own Settings and Chat Info pages and contributes 0 app settings.
4. **Workspace Graph canvas is dark-only.** White labels (1354), edges (195) and selected node (1301) wash out in light mode. Labels are still hidden at rest (UI_AUDIT open).
5. **Page headers are almost never used.** 4 `createPageHeader` calls across all extensions. About 30 views or routes hand-build a header or have none: flashcards 11, MO 8, creations 6, browser 4, concept-lab 2, workspace-graph 1.
6. **Creations' legacy `tg-*` stylesheet** (`main.js:54–~2000`): `#0e639c` buttons, `position:fixed` toast and modal at `z-index:1000`, 50 font-family declarations, 27 px font sizes, radii 2–14px.
7. **AI iconography.** 19 `sparkles`/`wand`/`brain` icons: creations 11, MO 5 (including non-AI Smart Zoom and Auto), budget 2, flashcards 1. Workspace Graph's "✦ Ask AI" glyph and plain "Ask AI" button have no mark. Creations chat tabs use `message-circle` ×14. Creations' Studio tab is `sparkles` (10120); MO's Tag Review tab is `sparkles` (30460).
8. **Confirmations through notifications** (21: browser 5, creations 8, flashcards 2, MO 6), against 10 `showConfirmModal` calls. Creations, flashcards, story and tables deletes offer no Cancel. Budget's **Reprocess History…** rewrites all history with no confirmation at all.
9. **Commands that only toast or mislead:**
   - MO: Edit Image, Paste Edit, Remove Marks ×2, Open Clip Editor, Save Smart Album, Reveal ("no path provided"), and Move to Trash ("Moved 0 items to trash.").
   - Flashcards: New Card opens Decks.
   - Workspace Graph: Refresh only opens the editor.
   - Budget: the Reclassify dead end (8575) and the "api.mcp, api.lm" jargon toast (8563).
10. **Hand-built buttons in the tokenised extensions:** flashcards `fc-btn` ×103 and concept-lab ×16, with zero kit buttons.
11. **Hand-built empty states (~113) vs 11 kit calls.** Budget's 19 are hint-only with no headline or action, and two expose "Query error:".
12. **Nonexistent tokens:** flashcards uses 5 (`--px-text-disabled` ×6, `--px-bg-raised`, `--px-surface-raised`, `--px-border-subtle`, `--px-leading-relaxed`). Browser and MO use undefined `--px-surface` (×5, ×13). These silently render wrong.
13. **One primary per view is broken:**
    - Creations Home: "Make Character" plus an accent "Continue" (CSS 2042).
    - Flashcards Decks: "Study" plus the accent "Generate Cards" pill, with five text buttons in the toolbar.
    - Budget: a per-row "Confirm" primary on Bills (4688); "Import" and "Export Now" on one page.
    - Browser: sidebar primary "New Tab".
14. **Title Case misuse:**
    - Concept-lab: 71 parameter labels capitalise small words, and 10 read "Sd".
    - MO: 29, e.g. "Tag With AI", "Save As Copy", "What To Remove".
    - Browser: "Find In Page" and the Shields switches.
    - Creations: "Use As A Concept", "From A Concept".
    - Section labels in Title Case: budget Trends `h3`, browser "Recently Visited", concept-lab "How To Use The Lab", flashcards "Source Material".
15. **Off-scale type and weight.** 237 px font sizes: MO 113 at 11 distinct sizes, workspace-graph 45, browser 38, creations 27, budget 10, concept-lab 4. 58 off-scale weights (flashcards 32 at 550/650/700). Budget's net-worth figure is 34px/700. 51 letter-spacing declarations.
16. **Own tab bars, toggles and popovers:** MO clip and image editor tabs and the Folders|Tags `role=tab`; flashcards `tablist` rail; browser `br-switch` and `br-panel`; creations `tg-cs-toggle`. Kit gaps (§13).
17. **Concept-lab Home reads like an AI landing page:** a long intro, a six-tip feature grid in a box, caps emphasis, "01"–"07" numbers at weight 700, and staggered card animation. Also no kit at all.
18. **Budget's remaining legacy:** three body-mounted drawers (`z-index:1000`), Import / Export with 10 inline `--vscode` colours, the Trends donut and Title Case `h3`s, about 25 dead CSS classes, `sparkles` on AI provenance, and px fonts in the MTD widget.
19. **Browser internal pages and sidebar:** a hand-built `pageShell` (18px `h2`), text-only empty states, over-explaining subtitles, three equal buttons on Blocked Trackers, a "Site Settings" sidebar section, and a toast on every download.
20. **API boundary and palette hygiene:**
    - MO calls `window.parallxElectron` 222 times, browser 4 (§7.1–7.6 say the only surface is `api`).
    - MO lists five maintenance commands in the user palette.
    - Three-dot ellipses: MO "Loading...", "Add tag...", "Select an album..."; creations placeholder.
    - "Saved!" ×3 in creations.
    - Web Research's Settings copy exposes "M65 seven-layer trifecta" and a raw page-id setting.
