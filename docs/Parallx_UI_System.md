# The Parallx UI System

> The one-page constitution for every pixel in this app. If a surface follows
> this document it feels like Parallx; if it doesn't it feels like a template.
> Written 2026-07-22 during the slop audit (see `UI_Slop_Audit_2026-07-22.md`)
> after fixing all 17 findings. **New code follows this from the first draft.**

## 1. Color — semantic tokens only

Component CSS consumes **Tier-2 `--px-*` semantic tokens** from
`src/theme/px-tokens.css`. Never Tier-1 primitives, never `--vscode-*` in new
code (the bridge exists for legacy files, not new ones), never raw hex/rgba.

- Surfaces: `--px-bg` → `--px-bg-elevated` → `--px-bg-inset`;
  `--px-surface-hover/active/selected`; `--px-window` for recessed backdrops
  (the PDF-preview desk).
- Text: `--px-text` / `-secondary` / `-muted` / `-faint`; `--px-text-on-accent`
  on any accent or danger fill (never `#fff`).
- Lines (three roles, don't mix): `--px-border` outlines floating surfaces,
  `--px-divider` separates within a surface, `--px-chrome-line` is the
  workbench hairline.
- Accent: `--px-accent` (+`-hover/-strong/-soft/-faint`). The accent is
  **scarce** — one primary action per surface, selection tints, focus rings,
  presence dots. When everything is accented, nothing is.
- Signals: `--px-success` / `--px-warning` / `--px-danger` / `--px-info`
  (+ soft variants). Status dots, stage chips, alerts ALWAYS come from these —
  never per-surface palettes.
- Legitimate hardcodes: content art (cover gallery — but it must be curated to
  the moods), print/export documents, code-syntax colors, always-dark scrims.

Extensions get the same tokens (same document): use them. An extension may
keep **domain data colors** (photo labels, budget categories) but its chrome
and accent follow the app.

## 2. Type — the ladder, nothing else

`--px-text-2xs` 10 · `xs` 11 · `sm` 12 · `base` 13 · `md` 15 · `lg` 18 ·
`xl` 22. That is the whole ladder.

- `2xs` is for DENSE CHROME only (calendar cell meta, count badges) — body
  copy never drops below `xs`.
- Display numerals (dashboard stats, hero titles) may exceed the ladder but
  are component-scoped and even (28/34/40) — never 13.5px "designed by
  nudging".
- One UI family: `--parallx-fontFamily-ui` (inherit). `mono` only for code
  and genuinely tabular technical text. Serif only in reading surfaces
  (canvas serif page mode, EPUB reader) — never in chrome.
- Numbers that update (counts, times, stats): `font-variant-numeric:
  tabular-nums`.

## 3. Space, radius, elevation, motion

- Spacing on the 4px grid via `--px-space-*`. Radius from the five steps
  (`xs` 2 / `sm` 4 / `md` 6 / `lg` 10 / `xl` 14) + `full` for real pills.
  `xs` is reserved for workbench chrome cards (sidebar/aux rails) that
  should read crisp and architectural; content cards (editor, panel,
  widgets) use `sm` and up. Over-rounding chrome reads as generic.
- Borders carry structure; **shadows only for true float** (menus, dialogs,
  drag ghosts) and always paired with `--px-edge-light`.
- Motion only via `--px-dur-*` + `--px-ease*` (enforced by
  `motionTokenCompliance.test.ts`). Press feel on every button:
  `:active { transform: var(--px-press); }`. Focus:
  `:focus-visible { box-shadow: var(--px-ring-accent); }`.

## 4. Casing — three registers

| Register | Rule | Examples |
| --- | --- | --- |
| Commands & menu items (palette, menu bar, context menus) | **Title Case** | "Split Editor Right", "Export as PDF" |
| Surface UI — buttons, tab labels, headers, hints, empty states, tooltips | **Sentence case** | "New automation", "Show answer", "Export failed" |
| Micro-labels (uppercase field/section labels) | **UPPERCASE** at `xs`/`2xs` + letter-spacing 0.05–0.06em | "PAPER SIZE", "SCHEDULE" |

Never mix registers inside one surface. Product nouns (Canvas, Planner,
Automations) are capitalized as names in prose; features are not ("export as
PDF", not "Export As PDF" mid-sentence).

## 5. Voice

- Every blank surface speaks through the **M89 registry**
  (`src/ui/emptyStates.ts`): headline ≤ 6 warm words, no period; hint names
  the next action. Never "Nothing here" / "No data" / bare "No X".
- Errors say what to DO: "quit and relaunch Parallx to finish enabling it",
  not `Error invoking remote method`.
- Ellipsis is `…` (never `...`). No exclamation marks in chrome. **No emoji
  anywhere in system UI** — including chat slash-command output, link chips,
  form labels, and progress text.
- **No em dashes (`—`) in user-facing copy.** They are an AI-writing tell.
  Use a period for two clauses, a colon before a list, or parentheses for an
  aside. (The `—` glyph as a bare empty-value placeholder — a cell with no
  value — is fine; that is data, not prose.) The AI generation and discussion
  prompts also instruct the model never to emit them.

## 6. Glyphs & icons

- All glyphs come from the icon registry (`getIcon`/`createIconElement`).
  Never text symbols (`▶ ▼ ✕ ●`), never inline one-off SVGs in new code,
  never emoji-as-icon.
- **Brand icons** (`src/ui/brandIcons.ts`, ids `px-*`): the product's core
  nouns — activity-bar rail, primary surfaces — use Parallx-original marks
  drawn on the logo's leaning-parallelogram plate (`M7 4 L20 4 L17 20 L4 20 Z`,
  24×24, stroke 2, round caps). This is what makes the rail
  screenshot-identifiable as Parallx and no one else.
- **Lucide** stays for universal verbs and objects (search, folder, trash,
  chevrons) — genericness is correct there.
- Adding a brand icon: draw inside the plate's leaned bounds
  (left edge x = 7 − 3(y−4)/16), one strong inner mark, no fills.
- `LinkMetadata.icon` is a registry icon id — renderers resolve it; emoji
  never crosses the contract.
- **The lean is scarce.** The parallelogram skew lives ONLY in the logo
  marks (`px-mark`, `px-ai-mark`). Noun icons stand upright — a rail of
  same-direction leaning glyphs reads as misalignment, not a motif
  (learned 2026-07-22).
- **The AI never wears the sparkle.** `sparkles`, `sparkle`, `wand`, and
  `wand-sparkles` are BANNED for AI affordances — they are the most
  recycled glyphs in every AI product shipped since 2023. Parallx's AI
  mark is `px-ai-mark` (the logo, small-proportioned): the assistant IS
  the app, so the brand mark appearing means "the assistant is acting" —
  generate buttons, the chat hero, AI section labels, autonomy surfaces.
  Send is `arrow-up`, not the paper plane.
- **Stroke weights are a three-tier system**, not a per-author choice
  (normalized 2026-07-22 — 40 drifting icons were at 1.8/2.2/2.5/2.6):

  | Tier | Size | Stroke |
  | --- | --- | --- |
  | Micro marks (task dots, tool-node check/x, tiny chevrons) | ≤ 12px | 2.4 (up to 3 for 2-point marks) |
  | Standard icons — everything else | 13–24px | **2** (the registry weight) |
  | Display / hero icons | ≥ 32px | 1.5 |

  Deliberate chrome exceptions: titlebar window controls (1.4), status-bar
  glyphs (1.2). Inline SVG is allowed only for micro-glyphs and one-off
  compositions; anything a registry id covers uses `getIcon`.

## 7. Components — never rebuild these

| Need | Use | Never |
| --- | --- | --- |
| Single-select | `ui/dropdown.ts` (`api.ui.createDropdown` in extensions) | native `<select>` |
| On/off | `ui/toggle.ts` | checkbox + "Enabled" text |
| 2–4 exclusive options | `ui/segmentedControl.ts` | hand-rolled button pairs |
| Confirm / alert | `showConfirmModal` (notificationService) | `window.confirm/alert/prompt` |
| Text input / textarea | `ui/inputBox.ts` / `ui/textarea.ts` | bare styled inputs where the component fits |
| Empty state | `renderEmptyState` + registry entry | inline "No X" strings |
| Toasts/prompts | NotificationService | custom toast divs |
| Shortcuts | KeybindingService + when-clauses | document keydown listeners |
| Hot-path handlers | `rafThrottle` | raw mousemove/scroll handlers |
| AI action button | `ui/aiButton.ts` (`api.ui.createAiButton`) | per-surface AI buttons/icons |
| Rich text / math body | `ui/renderMarkdown.ts` (`api.ui.renderMarkdown`) | hand-rolled markdown, raw `innerHTML` |

**One AI face.** Every "the assistant acts here" affordance is the same
`px-ai-btn` — the brand mark in an accent pill. Surfaces do not invent their
own AI buttons or pick their own AI icon; when the logo changes, all of them
follow because the mark is one registry entry.

Popover-scoped components (Dropdowns in popovers) register document-level
listeners — every close path must dispose them.

## 8. Enforcement

Guarded by tests: motion tokens (`motionTokenCompliance`), empty-state voice
+ anti-voice canary (`emptyStates`), canvas import gates (`gateCompliance`).
When adding a rule here, add its test. The audit doc records what violating
this looked like — read it before arguing for an exception.
