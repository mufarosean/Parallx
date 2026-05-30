# Milestone 83 — Visual Identity & the Parallx Design System

> **Status:** Identity locked = **Slate** (cool graphite, steel-blue accent).
> Foundation + craft pass shipped on branch `m83-visual-identity`. This is a
> **look-and-feel** milestone — no functional/behavioral changes, only how
> surfaces are configured, styled, themed. The icon system is out of scope.
>
> **Done so far:**
> - Three-tier `--px-*` token system (`px-tokens.css`); Slate the canonical
>   default, Warm/Ember as `:root[data-px-theme]` alternates.
> - `themeService` bridge: ~160 `--vscode-*` + the `--parallx-*` type/radius/
>   font tokens remap to `--px-*`, so the whole app + extensions re-skin.
> - Global base layer (`px-base.css`): text rendering, selection, section
>   headers, flattened title/activity-bar chrome.
> - Tactile controls (`px-controls.css`): press feel, one accent focus ring,
>   crafted native form controls, **keycap-styled `<kbd>`**, links.
> - Workbench chrome craft: activity-bar signature accent indicator, content-
>   style editor tabs, status-bar chips, rounded-inset Explorer rows.
> - Motion (`px-motion.css`): overlay pop/rise entrances + reduced-motion.
> - Consistency: planner/dashboard signal colors → tokens; media-organizer /
>   text-generator / workspace-graph extension chrome grays → tokens.
> - **Working Appearance editor** (`pxAppearancePanel`, replacing the broken
>   per-color theme editor): base palette (Slate/Warm/Ember) + accent (7
>   curated + custom hue) + **save/recall named custom themes**, persisted to
>   localStorage, applied on boot (`applySavedAppearance` in `main.ts`),
>   reachable from View menu + Manage gear + Ctrl+Shift+T.
> - **Three-tier line system**: `--px-chrome-line` (translucent hairline
>   between co-planar workbench parts), `--px-divider` (within-surface
>   separations — bridge now routes all internal `*-border` here and the two
>   previously-unbridged ones), `--px-border` (floating-surface outlines).
>   Kills the gridded "VS Code box" look.
> - **Consistency sweep**: audited every `--vscode-*` referenced in CSS vs the
>   bridge; the 46 unbridged chrome tokens (title-bar text, menu/widget
>   borders, quick-input/notification/hover text, validation, git decoration,
>   drag-drop) now map to `--px-*`. The ~47 that remain are intentional
>   content colors (terminal/diff/syntax/charts/icons/fonts).
> - Chat composer: auto-grow smoothed + fully tokenized; dashboard widgets →
>   tactile token cards (`--px-radius-xl`); aux-bar header redesigned.
>
> **Remaining (next sessions):**
> - Per-surface deep polish of canvas chrome + settings (both already
>   theme-consistent via the bridge; structural polish optional).
> - Budget extension token migration (was being actively edited; deferred).
> - Eventually retire the VS Code theme registry once nothing depends on the
>   bridge; collapse dead `#hex` fallbacks.

## Why

Parallx is ambitious and functionally successful, but it has **no
character**. Open Notion and it feels like Notion; open Obsidian and it
feels like Obsidian. Open Parallx and it feels like… VS Code's default
dark theme, because that's literally what it's wearing. The app reads as
"AI slop": generic, inconsistent, assembled rather than designed.

The audit (below) proves this isn't a vibe — it's measurable. The fix is
not more CSS. It's **less, standardized**: one design-token system, one
restrained palette with a point of view, applied uniformly, replacing
thousands of ad-hoc values.

The target feeling is a **mix of Obsidian and Notion, leaning Obsidian**:
information-dense and calm like Obsidian, warm and polished like Notion.
A tool that feels like nothing else — not a toy, not a template.

## What "AI slop" means here (the things we are removing)

Catalogued from real feedback during M71/M82:

- **Accent-color spray** — the brand color on every active state, pill,
  chip, indicator. Identity comes from *restraint*, not saturation.
- **Pill-everything** — `border-radius: 999px` as a default. Pills are a
  specific signal (counts, tags), not a universal chrome.
- **Chunky decorative chrome** — filled icon tiles, two-line nav rows,
  gratuitous chevrons, floating accent lines that don't connect to
  anything.
- **Gradient / glassmorphism for no reason.**
- **Inconsistent everything** — see audit. Twelve font sizes, four
  blues, scattered hardcoded hex.
- **Emoji as UI.**

## The audit — current state (measured)

- **38 CSS files** reference `var(--vscode-*)`. The app is built on VS
  Code's color tokens; it has no palette of its own.
- **Four+ competing "accent" blues** in hardcoded fallbacks:
  `#0e639c` (88×), `#007fd4` (25×), `#3794ff` (10×), `#5b9bd5` (13×).
- **Hardcoded hex fallbacks scattered everywhere** — `#d4d4d4` appears
  201×, `#cccccc` 69×, plus many one-off grays serving the same
  semantic role. Recent surfaces (planner) invented their own
  `#e85a5a` / `#d2a64f` with no system behind them.
- **A 7-file, ~1028-line theme TS system** (`colorRegistry`,
  `designTokenRegistry`, `workbenchColors`, `workbenchDesignTokens`,
  `themeCatalog`, `themeData`, `themeTypes`) + 4 theme JSONs — the
  "too complex" system. It faithfully reproduces VS Code's theming model
  but that model is the problem: it gives us VS Code's *look*.
- **Font sizes in use**: 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14,
  15, 18, 22 — a dozen sizes, no ladder.
- **Radii**: 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 999 — no scale.

## Architecture: a three-tier token system (Obsidian's model)

Obsidian's CSS variables are organized foundation → semantic → component,
where everything derives from a small set of foundation values
([Obsidian color reference](https://docs.obsidian.md/Reference/CSS+variables/Foundations/Colors)).
We adopt the same shape, namespaced `--px-*`.

**Tier 1 — Primitives** (`px-tokens.css :root`). Raw, theme-specific.
- A warm-neutral base scale `--px-base-00 … --px-base-100`
  (00 = app background, 100 = strongest text), mirroring Obsidian's
  `--color-base-XX`.
- Accent as **HSL components** `--px-accent-h / -s / -l`, so hover/active
  variants are computed and the whole identity re-hues from one number —
  exactly how we'll prototype different looks.
- Eight signal colors (red…pink) with `-rgb` variants for opacity.

**Tier 2 — Semantic** (`px-tokens.css :root`). What components reference.
- Surfaces: `--px-bg`, `--px-bg-elevated`, `--px-bg-inset`,
  `--px-surface-hover`, `--px-surface-active`, `--px-surface-selected`.
- Text: `--px-text`, `--px-text-muted`, `--px-text-faint`,
  `--px-text-on-accent`.
- Lines: `--px-border`, `--px-border-strong`, `--px-divider`.
- Accent: `--px-accent`, `--px-accent-hover`, `--px-accent-soft`.
- Signals: `--px-danger`, `--px-success`, `--px-warning`, `--px-info`.
- Scales: spacing `--px-space-1…8` (4px grid), radius
  `--px-radius-sm/md/lg`, type `--px-text-xs…2xl`, shadows
  `--px-shadow-sm/md/lg`, motion `--px-ease`, `--px-dur-fast/base`.

**Tier 3 — Component** (optional, per surface as we migrate).

## The bridge (why the whole app re-skins at once)

`themeService` injects `body { --vscode-editor-background: #1e1e1e; … }`
at runtime. We append a fixed **bridge block** to that same generated
`body {}` rule that remaps the character-defining `--vscode-*` tokens to
`var(--px-*)` semantic tokens. Because the bridge lines are emitted
*after* the hex lines in the same selector, they win the cascade with no
`!important`. Result: every one of the 38 existing CSS files immediately
picks up the new palette **without being edited**. The hardcoded `#hex`
fallbacks become dead code (only used if a var is ever missing) and get
cleaned up per-surface over time.

This is the key move: re-skin globally on day one, migrate surfaces to
native `--px-*` incrementally, delete the VS Code theme machinery once
nothing depends on it.

## Plan / phases

1. **Foundation (this session)** — `px-tokens.css`, the first
   Obsidian-leaning theme, the themeService bridge. Whole app re-skins.
2. **Prototype palettes** — 2–4 candidate identities via `[data-px-theme]`
   (swap Tier-1 primitives only). Pick one with the user.
3. **Type ladder + spacing + radius pass** — collapse the dozen font
   sizes to a 6-step ladder; snap radii to sm/md/lg; spacing to the 4px
   grid. Done globally via the tokens, then surface cleanup.
4. **Per-surface migration** — convert each built-in's CSS from
   `var(--vscode-*, #hex)` to native `--px-*`; remove dead hardcoded
   values; kill pills/slop per surface.
5. **Retire the VS Code theme system** — once no surface depends on the
   `--vscode-*` bridge, delete the 7-file registry or reduce it to a
   thin compat shim.

## Out of scope

- **The icon system** — app icons, canvas-loaded icons, and explorer
  file-type icons are off-limits this milestone.
- **Any functional/behavioral change.** Pure presentation.
- **Light theme polish** beyond keeping it working — dark is the hero;
  light follows once the dark identity is locked.

## Principles (the standard we hold every surface to)

1. **One scale per dimension.** One type ladder, one spacing grid, one
   radius set, one elevation set. If a value isn't a token, it's a bug.
2. **Accent is earned.** The brand color marks the single primary action
   or the focused element — not every active state. Neutral selection
   treatment for everything else.
3. **Borders over shadows** for structure (Obsidian); shadows only for
   true elevation (popovers, menus).
4. **Density with air.** Obsidian's information density, Notion's
   breathing room. Compact rows, generous section spacing.
5. **Motion is a whisper.** Short, eased, purposeful. No bounce, no
   gratuitous reveal.
