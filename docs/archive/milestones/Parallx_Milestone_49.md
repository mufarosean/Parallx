# Milestone 49 — Visual Identity & Design System

**Status:** Planning  
**Branch:** TBD (off `editor-chat-context`)  
**Depends on:** M48 at `bc43ddd`

---

## Vision

Parallx currently looks like a VS Code dark theme clone — same gray backgrounds, same Microsoft blue accent, same uncoordinated icon sources. This milestone transforms the visual identity into something distinctly Parallx: a purple-accented dark palette matching the logo, a unified icon system with no emojis, a governed design token system for typography/spacing/radii, and eventually a user-facing theme editor for full customization.

The workbench layout stays untouched — windows, editors, sidebars, panels, panes, the grid system. Only how they *look* changes: colors, fonts, icons, borders, radii, shadows.

---

## Current State (Audit Findings)

### Colors

| What | Current Value | Problem |
|------|--------------|---------|
| Default theme | `parallx-dark-modern` | Identical to VS Code's Dark Modern palette |
| Accent color | `#0078d4` (Microsoft blue) | No brand identity — same as VS Code |
| Sidebar/panel bg | `#181818` | Pure gray, no warmth or brand tint |
| Editor bg | `#1f1f1f` | Pure gray |
| Borders | `#2b2b2b` | Pure gray |
| Logo color | `#a21caf` (fuchsia-700) | Not reflected anywhere in the UI |
| `--vscode-*` CSS vars | ~1,200 references across 32 CSS files | Good coverage, properly governed |
| `--parallx-*` CSS vars | ~15 references | **Never set by theme service** — always fall to hardcoded hex |
| `--color-*` CSS vars | ~5 references | **Never set by theme service** — dead variables |
| Hardcoded hex colors | ~170 total, **15 critical** (bypass theming) | Canvas CSS, indexingLog, diagnostics use bare hex |

### Typography

| What | Current State | Problem |
|------|--------------|---------|
| UI font-family | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...` | Hardcoded in ~8 files, no token |
| Canvas font-family | `'Inter', 'SF Pro Display', -apple-system, ...` | Different from workbench, hardcoded |
| Mono font-family | `'Cascadia Code', 'Fira Code', 'Consolas', ...` | Hardcoded in ~6 files, no token |
| Canvas heading font | `'Inter', 'SF Pro Display', ...` | Same as body but different from workbench |
| Font sizes | 12 distinct values (9px–16px + em units) | No scale, same semantic uses have different sizes |
| Design tokens | **None** — no `--parallx-font-*` variables | Zero governance |

### Border-Radius

| Value | Usage Count | Context |
|-------|-------------|---------|
| 2px | ~6 | Small pills |
| 3px | ~60 | Buttons, inputs (most common) |
| 4px | ~40 | Cards, menus |
| 6px | ~50 | Panels, sidebar items |
| 8px | ~8 | Canvas menus |
| 10px | ~15 | Canvas slash menu |
| 12px | ~8 | Chat bubbles |
| 16px | ~10 | Chat input, large elements |
| 999px | ~8 | Full-round pills |

**No tokens.** 8 distinct values with no named scale.

### Spacing

Most common pixel values: 4px (~50x), 6px (~40x), 8px (~100x), 12px (~60x), 16px (~80x), 24px, 32px, 64px, 96px scattered across 32 CSS files. No adherence to a spacing scale. No tokens.

### Icons

| Source | Count | Style | Problem |
|--------|-------|-------|---------|
| `src/ui/iconRegistry.ts` | 34 (20 file-type + 12 avatar + 2) | Stroke, 16×16, sw `1.2`, `currentColor` | Good — reference style |
| `src/built-in/canvas/canvasIcons.ts` | ~190 | Stroke, 16×16, **8 different stroke-widths** (0.8–2.5) | Inconsistent weight |
| `src/built-in/chat/chatIcons.ts` | ~45 | Stroke, mixed sizes (12/16/24), sw 1.0–1.4 | Size + weight chaos |
| Inline SVGs (12+ files) | ~50+ | **Fill-based**, hardcoded, duplicates | Totally different rendering style |
| Emoji glyphs (~12+ files) | **62+ instances** | Text chars: 📁 🔍 ✨ 💬 ⚙️ 🧩 📄 📌 ⌨️ 🚫 🔒 🔄 📓 📊 🎨 ✅ ❌ ⚠️ + `\u26A0` | **Must be eliminated** |

**Key problems:**
- **Two rendering approaches** — registries use stroke-based, inline SVGs use fill-based (visually incompatible)
- **8 distinct stroke-width values** in canvas icons alone (0.8, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 2.5)
- **9 distinct rendered sizes** (10px through 96px)
- **Duplicate definitions** — breadcrumbsBar.ts redefines icons that exist in canvasIcons.ts
- **62+ emoji instances** used as icons in production UI across 12+ files (builtinManifests, welcome, placeholderViews, selectionActionHandlers, inlineAIChat, canvasSidebar, tool-gallery, openclawDoctorCommand, openclawStatusCommand, openclawToolsCommand, openclawVerboseCommand, openclawNewCommand, openclawThinkCommand, chatContentParts, agentSection, editorGroupView)
- **No single source of truth** — iconRegistry.ts exists but only canvas and AI settings use it

### Canvas Styling Divergence

Canvas is a Notion-inspired content editor embedded in the workbench. It deliberately diverges:

| Aspect | Workbench | Canvas |
|--------|-----------|--------|
| Menu system | `MenuBuilder` → `ContextMenu` → `.context-menu-*` | Custom DOM: `.canvas-bubble-menu`, `.canvas-slash-menu`, `.block-action-menu` |
| Font | System sans-serif at 13px | Inter at 16px, line-height 1.625 |
| Border-radius | 3–4px | 5–10px |
| Shadows | `0 2px 8px rgba(0,0,0,0.36)` | `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.2)` |
| Text color | Solid hex per token | RGBA opacity tiers (80%/50%/40%/20%) |
| Colors | `var(--vscode-*)` | ~60% hardcoded hex (`#252525`, `#5bbdf5`, etc.) |

**Decision:** Canvas keeps its content-area styling (larger font, reading-optimized line-height) — that's a deliberate UX choice. But its menus, controls, and chrome should share the unified design tokens so they respond to theme changes. Hardcoded hex values in canvas CSS get replaced with `var()` references.

---

## Logo Color Reference

The Parallx logo (`src/assets/parallx-logo.svg`) uses **`#a21caf`** (Tailwind fuchsia-700) — two overlapping skewed rectangles, one at 45% opacity. This is the brand anchor.

---

## Phase Plan

### Phase 1: Design Token Infrastructure

**Goal:** Register design tokens for spacing, border-radius, typography, and shadows. Make them governable by the theme system alongside color tokens.

#### 1.1 Create Design Token Registry

**Decision:** Create a new `src/theme/designTokenRegistry.ts` parallel to `colorRegistry.ts` (do NOT extend colorRegistry — separation of concerns). The design token registry handles non-color tokens (fonts, radius, spacing, shadow). The `ThemeService` merges both registries into one CSS injection.

Required changes:
- New `src/theme/designTokenRegistry.ts` — mirrors `IColorRegistry` pattern but for string tokens with `--parallx-*` prefix
- New `src/theme/workbenchDesignTokens.ts` — bulk-registers all design tokens (parallel to `workbenchColors.ts`)
- Extend `ThemeSource` in `themeTypes.ts` — add optional `designTokens?: Record<string, string>` field
- Extend `ColorThemeData` in `themeData.ts` — add design token resolution alongside color resolution
- Update `ThemeService._generateAndInjectCSS()` in `themeService.ts` — inject design token CSS variables in the same `body {}` rule block after color variables

Tokens to register:

| Token Category | Tokens | Default Values (Dark) |
|---------------|--------|----------------------|
| **Font family** | `fontFamily.ui`, `fontFamily.editor`, `fontFamily.mono` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` / `'Inter', -apple-system, ...` / `'Cascadia Code', 'Fira Code', 'Consolas', monospace` |
| **Font size** | `fontSize.xs`, `fontSize.sm`, `fontSize.base`, `fontSize.md`, `fontSize.lg`, `fontSize.xl`, `fontSize.2xl`, `fontSize.3xl` | `10px`, `11px`, `12px`, `13px`, `14px`, `16px`, `24px`, `36px` |
| **Border-radius** | `radius.none`, `radius.sm`, `radius.md`, `radius.lg`, `radius.xl`, `radius.full` | `0`, `3px`, `6px`, `8px`, `12px`, `999px` |
| **Spacing** | `spacing.1`, `spacing.2`, `spacing.3`, `spacing.4`, `spacing.6`, `spacing.8`, `spacing.12`, `spacing.16` | `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px` |
| **Shadow** | `shadow.sm`, `shadow.md`, `shadow.lg` | `0 1px 3px rgba(0,0,0,0.3)`, `0 2px 8px rgba(0,0,0,0.36)`, `0 4px 16px rgba(0,0,0,0.5)` |

These tokens get injected as CSS custom properties alongside color tokens:
```css
body {
  /* existing color tokens */
  --vscode-editor-background: #1a1625;
  /* new design tokens */
  --parallx-font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --parallx-font-mono: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  --parallx-radius-md: 6px;
  --parallx-spacing-4: 16px;
  --parallx-shadow-md: 0 2px 8px rgba(0,0,0,0.36);
}
```

#### 1.2 Replace Hardcoded Values in CSS

Sweep **all 40+ CSS files** across `src/`. Replace:
- Hardcoded `font-family` declarations → `var(--parallx-font-ui)` or `var(--parallx-font-mono)`
- Hardcoded `border-radius` values → `var(--parallx-radius-*)` using the closest scale step
- Hardcoded `font-size` values → `var(--parallx-fontSize-*)` where semantically appropriate

**Not in scope for Phase 1:** Spacing tokens (too many instances, high regression risk, deferred to Phase 1b or after stabilization).

**Complete CSS file list** (ensures nothing is missed):

| Directory | Files |
|-----------|-------|
| `src/` | `workbench.css` |
| `src/aiSettings/ui/` | `aiSettings.css` |
| `src/api/` | `notificationService.css` |
| `src/built-in/canvas/` | `canvas.css` |
| `src/built-in/canvas/database/` | `database.css` |
| `src/built-in/chat/` | `chat.css` |
| `src/built-in/chat/input/` | `chatInput.css` |
| `src/built-in/chat/widgets/` | `chatTokenStatusBar.css` |
| `src/built-in/diagnostics/` | `diagnostics.css` |
| `src/built-in/editor/` | Various editor CSS, `pdfEditorPane.css` |
| `src/built-in/indexing-log/` | `indexingLog.css` |
| `src/built-in/search/` | `search.css` |
| `src/built-in/terminal/` | `terminal.css` |
| `src/built-in/tool-gallery/` | `toolGallery.css` |
| `src/built-in/welcome/` | `welcome.css` |
| `src/contributions/` | `menuContribution.css`, `viewContribution.css` |
| `src/dnd/` | `dropOverlay.css` |
| `src/ui/` | `toggle.css`, `textarea.css`, `slider.css`, `dropdown.css`, `segmentedControl.css`, `findReplaceWidget.css`, etc. |
| `src/layout/` | Layout CSS files |
| `src/parts/` | Titlebar, statusbar, etc. |
| `src/views/` | Various view CSS |

#### 1.3 Clean Up Rogue CSS Variables

| Variable Namespace | Files | Action |
|-------------------|-------|--------|
| `--parallx-success-fg`, `--parallx-error-fg`, `--parallx-warning-fg` | diagnostics.css, diagnostics/main.ts | Register in colorRegistry or replace with existing `--vscode-*` equivalents |
| `--parallx-token-*` | chatTokenStatusBar.css | Register in colorRegistry or inline as `--vscode-*` references |
| `--color-bg-*`, `--color-fg-*` | iconPicker.css, workbench.css | Replace with `--vscode-*` equivalents — these are fully dead |

#### 1.4 Canvas Hardcoded Colors → Token References

Replace the 15 critical hardcoded hex values in `canvas.css` with `var(--vscode-*)` references:

| Hardcoded | Replacement |
|-----------|-------------|
| `#252525` | `var(--vscode-editor-background)` or new token |
| `#fff` / `#000` | `var(--vscode-foreground)` / inherit from token |
| `#5bbdf5`, `#2383e2` | `var(--vscode-focusBorder)` or accent token |
| `#4ec9b0`, `#f14c4c` | `var(--vscode-testing-iconPassed)` / `var(--vscode-errorForeground)` |
| `#151515` | `var(--vscode-sideBar-background)` darkened |

Similarly fix `indexingLog.css` (3 hardcoded hex) and `diagnostics/main.ts` (hardcoded fallbacks).

**Verification:**
- `tsc --noEmit` — 0 errors
- All existing tests pass
- Visual inspection: app looks identical (dark-modern.json values unchanged)
- Grep confirms zero `--color-*` and reduced `--parallx-*` ungoverned references

---

### Phase 2: Palette & Visual Identity

**Goal:** Replace the VS Code color palette with a Parallx-native purple-accented dark theme. The app should look distinctly like Parallx, not a VS Code clone.

#### 2.1 New Dark Modern Palette

Update `src/theme/themes/dark-modern.json` with the Parallx palette:

| Role | Old (VS Code) | New (Parallx) |
|------|--------------|---------------|
| **Accent** | `#0078d4` | `#a855f7` (purple-400) |
| **Accent hover** | `#026ec1` | `#9333ea` (purple-600) |
| **Sidebar/panel bg** | `#181818` | `#14111a` (purple-tinted near-black) |
| **Editor bg** | `#1f1f1f` | `#1a1625` (purple-tinted dark) |
| **Titlebar bg** | `#181818` | `#110e17` (deepest purple-black) |
| **Border** | `#2b2b2b` | `#2a2535` (purple-tinted border) |
| **Surface hover** | `#2a2d2e` | `#2d2640` (purple-tinted hover) |
| **Active selection** | `#37373d` | `#322850` (purple selection) |
| **Selection bg** | `#264f78` | `#3b2660` (purple highlight) |
| **Focus outline** | `#0078d4` | `#a855f7` |
| **Button bg** | `#0078d4` | `#9333ea` (purple-600 for buttons) |
| **Button hover** | `#026ec1` | `#7e22ce` (purple-700) |
| **Badge bg** | `#4d4d4d` | `#7e22ce` (purple-700) |
| **Tab active border-top** | `#0078d4` | `#a855f7` |
| **Activity bar active** | `#0078d4` | `#a855f7` |
| **Links** | `#2aaaff` | `#c084fc` (purple-300) |
| **Foreground** | `#cccccc` | `#e2dce8` (slightly warm/purple-tinted) |
| **Muted text** | `#9d9d9d` | `#9990a8` (purple-tinted gray) |
| **Input bg** | `#313131` | `#241f30` |
| **Quick input bg** | `#222222` | `#1e1928` |
| **Error** | `#f85149` | `#f85149` (keep — red is universal) |
| **Warning** | `#cca700` | `#cca700` (keep — amber is universal) |
| **Success** | `#4ec9b0` | `#4ec9b0` (keep — teal is universal) |

#### 2.2 Update Light Modern Theme

Apply corresponding light-mode Parallx palette to `light-modern.json`:
- Light accent: `#9333ea` (purple-600) or `#7e22ce` (purple-700)
- Light backgrounds: warm white/lavender tints instead of pure gray
- Maintain WCAG AA contrast ratios

#### 2.3 Update High Contrast Themes

HC Dark and HC Light get the purple accent but must maintain WCAG AAA contrast (7:1 minimum):
- HC accent: `#c084fc` (purple-300 for dark, high visibility)
- All other tokens maintain existing high contrast ratios

#### 2.4 Design Token Defaults Update

Update all design token defaults registered in Phase 1 to match the new visual direction. Ensure `shadow` tokens use purple-tinted shadows where appropriate.

**Verification:**
- Visual inspection across all 4 themes
- Tab active indicator is purple, not blue
- Activity bar badge is purple
- Buttons are purple
- Sidebar has a purple warmth, not gray
- Text is readable (contrast checker)
- Canvas editor inherits new token values through `var()` references (Phase 1.4 work)
- All tests pass

---

### Phase 3: Unified Icon System

**Goal:** One consistent icon set for the entire app. No emojis. No fill/stroke style clash. Clean stroke-based SVGs matching the Untitled UI / Lucide aesthetic at consistent weight.

#### 3.1 Icon Design Standards

Codify the standard based on the existing canvas icons (which the user likes):

| Property | Standard |
|----------|----------|
| **ViewBox** | `0 0 24 24` (modern standard, allows both 16px and 24px rendering) |
| **Stroke-width** | `1.5` (universal — clear at 16px, crisp at 24px) |
| **Stroke-linecap** | `round` |
| **Stroke-linejoin** | `round` |
| **Fill** | `none` (stroke-only; some icons may use `fill="currentColor"` for solid shapes like dots, but the primary approach is stroke) |
| **Color** | `currentColor` only (never hardcoded hex or `var()` in SVG) |
| **Explicit sizing** | Via CSS, not SVG `width`/`height` attributes |
| **Naming** | Kebab-case, descriptive: `chevron-right`, `file-text`, `settings-gear` |

#### 3.2 Icon Categorization

Two conceptual buckets, same set of icons:

| Category | Purpose | Examples | Count Needed |
|----------|---------|----------|-------------|
| **UI icons** | Workbench chrome — menus, toolbars, sidebar, status bar, buttons, navigation | chevrons, close, settings, search, plus, trash, send, attach, copy, edit, split-pane, maximize, minimize, bell, filter, sort, grip | ~80 |
| **Content icons** | Canvas pages, block types, database properties, file types | page, folder, database, bookmark, lightbulb, calendar, checklist, tag, code, rocket, image, video, link, heading, list, quote, divider, callout | ~100 |
| **Branding** | Logo, watermark | Parallx logo variants | ~3 |

**Total:** ~180 comprehensive icons covering every current usage plus gaps.

#### 3.3 Icon Registry Consolidation

**Current state:** 4 separate icon sources + inline SVGs + emojis.

**Target state:** ONE central registry used by everything.

```
src/ui/iconRegistry.ts          ← single source of truth
  ├── UI icons (~80)
  ├── Content icons (~100)
  └── Branding icons (~3)
```

Changes:
1. **Migrate all canvas icons** from `canvasIcons.ts` into `iconRegistry.ts` — normalize to standard stroke-width `1.5`, viewBox `0 0 24 24`
2. **Migrate all chat icons** from `chatIcons.ts` into `iconRegistry.ts` — normalize same standards
3. **Keep `canvasIcons.ts` as re-export wrapper** — the canvas gate architecture (`config/iconRegistry.ts`) requires that canvas code imports icons through the gate, not directly from `src/ui/iconRegistry.ts`. So `canvasIcons.ts` becomes a thin re-export layer: it imports from the central registry and re-exports with canvas-prefixed names. Same for `chatIcons.ts` → re-export wrapper. **Do not delete** — the gate compliance pattern depends on these files existing.
4. **Replace all inline SVGs** in 12+ consumer files with registry lookups
5. **Replace all emoji usage** (62+ instances across 12+ files) with SVG icon references
6. **Remove duplicate definitions** (breadcrumbsBar.ts folder/file icons → registry lookup)
7. **The canvas gate** (`config/iconRegistry.ts`) keeps its gate semantics — it pulls from `canvasIcons.ts` (the re-export wrapper), which pulls from `src/ui/iconRegistry.ts`. Gate compliance tests must verify this chain.

#### 3.4 Icon Rendering Helpers

Ensure a single helper function for rendering icons:

```typescript
// src/ui/iconRegistry.ts
function createIconElement(iconId: string, size?: number): HTMLElement
```

All consumers call this. No more inline SVG string concatenation.

#### 3.5 New Icons Needed

Based on audit, these icons are currently emojis or missing and need proper SVGs:

| Current | Replacement Icon | Used In |
|---------|-----------------|---------|
| 📁 (emoji) | `folder` (SVG) | builtinManifests, welcome, placeholderViews |
| 🔍 (emoji) | `search` (SVG) | builtinManifests |
| 🧩 (emoji) | `puzzle` (SVG) | builtinManifests, tool-gallery |
| 💬 (emoji) | `message-circle` (SVG) | builtinManifests, selectionActionHandlers |
| ✨ (emoji) | `sparkle` (SVG) | inlineAIChat, welcome |
| ⚙️ / ⚙ (emoji) | `settings` (SVG) | welcome, agentSection |
| 📄 (emoji) | `file-text` (SVG) | welcome, placeholderViews, canvasSidebar |
| 📊 (emoji) | `bar-chart` (SVG) | canvasSidebar |
| 📌 (emoji) | `pin` (SVG) | editorGroupView |
| 🎨 (emoji) | `palette` (SVG) | selectionActionHandlers, placeholderViews |
| ✅/❌/⚠️ (emoji) | `check-circle`/`x-circle`/`alert-triangle` (SVG) | openclawDoctorCommand, openclawStatusCommand |
| 🔄 (emoji) | `refresh-cw` (SVG) | openclawStatusCommand |
| 📓 (emoji) | `notebook` (SVG) | workbenchContributionHandler |
| ⌨️ (emoji) | `keyboard` (SVG) | welcome |
| 🚫 (emoji) | `slash-circle` (SVG) | openclawToolsCommand |
| 🔒 (emoji) | `lock` (SVG) | openclawToolsCommand |
| 🔍 (emoji) | `search` (SVG) | openclawVerboseCommand |
| ⚠️ (emoji) | `alert-triangle` (SVG) | openclawNewCommand, openclawThinkCommand |
| `\u26A0` (unicode escape) | `alert-triangle` (SVG) | chatContentParts |
| ✓ (char) | `check` (SVG) | chatContentParts, inlineAIChat |

#### 3.6 Inline SVG Replacement Map

| File | Current | Action |
|------|---------|--------|
| `pdfEditorPane.ts` (16 fill icons) | Fill-based inline SVGs | Replace with stroke-based registry icons |
| `diagnostics/main.ts` (4 icons) | Fill-based with hardcoded color vars | Replace with registry icons + `currentColor` + CSS coloring |
| `indexing-log/main.ts` (7 icons) | Fill-based inline SVGs | Replace with registry icons |
| `editorGroupView.ts` (2 icons) | Fill-based inline SVGs | Replace with registry icons |
| `workbench.ts` (2 activity bar icons) | 24×24 fill-based | Replace with registry icons |
| `workbenchContributionHandler.ts` (6 emoji→SVG) | Mixed emoji/fill map | Replace with clean registry lookups |
| `statusBarController.ts` (2 icons) | Fill-based with complex paths | Replace with registry icons |
| `tool-gallery/main.ts` (5 icons, 3 sizes) | Fill-based at 16/28/14px | Replace with registry icons at CSS-controlled sizes |
| `findReplaceWidget.ts` (1 icon) | Fill-based 14×14 | Replace with registry icon |
| `search/main.ts` (1 icon) | Fill-based 16×16 | Replace with registry icon |
| `breadcrumbsBar.ts` (2 duplicates) | Stroke-based but duplicated | Replace with registry lookups |
| `blockActionMenu.ts` (2 unregistered) | Stroke-based but not in registry | Move to registry |
| `titlebarPart.ts` (window controls) | Platform-specific 10×10 | **Keep separate** — these are OS chrome, not application icons |
| `welcome/main.ts` (logo) | 96×96 branding | **Keep separate** — branding asset |
| `workbenchWatermark.ts` (watermark) | 64×64 branding | **Keep separate** — branding asset |

**Verification:**
- Zero emoji characters in UI rendering (grep for emoji unicode ranges)
- All icons render from `iconRegistry.ts` (except branding + window controls)
- Visual inspection: consistent stroke weight across entire app
- `canvasIcons.ts` and `chatIcons.ts` are either deleted or reduced to re-export wrappers
- No inline `<svg` strings in consumer files (except the 3 exempt branding/OS chrome cases)
- All tests pass

---

### Phase 4: Theme Editor UI

**Goal:** A user-facing settings panel where users can customize colors, fonts, and spacing with real-time preview, and save/load custom themes.

#### 4.1 Theme Editor View

Create a new editor pane (`src/built-in/theme-editor/`) that provides:

| Section | Controls | Token Binding |
|---------|----------|--------------|
| **Colors** | Color pickers grouped by surface (Sidebar, Editor, Tabs, Activity Bar, Buttons, etc.) | Maps to `--vscode-*` color tokens |
| **Typography** | Font family dropdowns (UI / Editor / Mono), font size slider + preset buttons | Maps to `--parallx-font-*`, `--parallx-fontSize-*` tokens |
| **Shape** | Border-radius slider (compact→rounded→pill), shadow intensity slider | Maps to `--parallx-radius-*`, `--parallx-shadow-*` tokens |
| **Preview** | Live mini-preview pane showing how choices look on a sample workbench layout | Real-time `applyTheme()` calls |

#### 4.2 Custom Theme Model

Extend `ThemeSource` to support user themes:

```typescript
interface UserThemeSource extends ThemeSource {
  readonly isUserTheme: true;
  readonly designTokens?: Record<string, string>; // non-color tokens
  readonly createdAt: string;
}
```

Storage:
- Built-in themes: stay in `src/theme/themes/*.json` (compiled in)
- User themes: stored in localStorage as JSON under `parallx.userThemes` key
- Active theme persisted at `parallx.colorTheme` (existing key)

#### 4.3 Theme Catalog Extension

Update `themeCatalog.ts` to merge built-in + user themes:
- `getAvailableThemes()` returns both
- User themes appear after built-ins in the picker
- Users can edit, duplicate, rename, delete their themes
- Cannot modify built-in themes (duplicate first)

#### 4.4 Import / Export

- **Export:** Download theme as `.parallx-theme.json` file
- **Import:** Drag-and-drop or file picker to load a `.parallx-theme.json`
- JSON schema validation on import

#### 4.5 Quick Presets

Offer 3–5 one-click palette presets as starting points:
- **Parallx Dark** (the default new purple palette from Phase 2)
- **Parallx Light** (light variant)
- **Midnight** (deeper, more saturated purple)
- **Warm Dark** (amber/orange accent variant)
- **Monochrome** (pure grayscale, no accent color)

Users can start from a preset and customize from there.

**Verification:**
- Theme editor opens from settings
- Color pickers update the live app in real-time
- Saving persists to localStorage
- Reloading app restores custom theme
- Export produces valid JSON
- Import applies the theme
- Built-in themes remain immutable
- All tests pass

---

## Icon Style Reference

The target icon style matches **Untitled UI Icons** (1,171 icon set) and Parallx's existing canvas icon aesthetic:

- Clean stroke-based outlines
- Consistent stroke-width across all icons
- Rounded line caps and joins
- No fills except for small semantic details (dots, play triangles)
- `currentColor` for theming
- Works at both 16px (compact UI) and 24px (spacious contexts)
- Geometric, minimal, modern — Notion/Linear/Figma aesthetic

**Not acceptable:**
- Emoji characters as icons (📁 ✨ 💬 etc.)
- Fill-based icon style (solid shapes)
- Codicons (VS Code's font-based icon set)
- Mixed stroke-weights within a single icon
- Hardcoded colors in SVG markup

---

## Canvas Architecture Note

Canvas is a built-in tool/extension with its own styling — larger fonts, reading-optimized line-height, Notion-style menus, and content blocks. This is by design.

**What stays canvas-specific:**
- Content area typography (16px Inter at 1.625 line-height for reading)
- Block-level layout (content width, paragraph spacing)
- Drag handles, slash menu UX, block add button interaction

**What gets unified:**
- Canvas menu/chrome colors → theme token references (no more hardcoded `#252525`)
- Canvas menu border-radius → `var(--parallx-radius-*)` tokens
- Canvas icons → pulled from central `iconRegistry.ts` (same set, same weight)
- Canvas shadows → `var(--parallx-shadow-*)` tokens
- Canvas control fonts (menu items, toolbar text) → `var(--parallx-font-ui)` where appropriate

**Icon distinction:** Content icons (page types, block types, database properties) and UI icons (menu controls, toolbar actions, navigation) come from the same central icon set. The difference is *where* they're used, not *how* they're defined. A `bookmark` icon can appear as a page icon in canvas AND as a favorites button in the sidebar — same SVG, same registry, different rendering size via CSS.

---

## File Impact Map

### Phase 1 — Design Token Infrastructure

| File | Change |
|------|--------|
| `src/theme/designTokenRegistry.ts` (new) | Non-color token registry — fonts, radius, spacing, shadow |
| `src/theme/workbenchDesignTokens.ts` (new) | Bulk-registers all design tokens (parallel to `workbenchColors.ts`) |
| `src/services/themeService.ts` | Extend `_generateAndInjectCSS()` to inject design tokens alongside color tokens |
| `src/theme/themeTypes.ts` | Add `designTokens?: Record<string, string>` to `ThemeSource` interface |
| `src/theme/themeData.ts` | Extend `ColorThemeData` to resolve design tokens alongside colors |
| `src/theme/themes/dark-modern.json` | Add `designTokens` section |
| `src/theme/themes/light-modern.json` | Add `designTokens` section |
| `src/theme/themes/hc-dark.json` | Add `designTokens` section |
| `src/theme/themes/hc-light.json` | Add `designTokens` section |
| 40+ CSS files across `src/` | Replace hardcoded font-family, border-radius, font-size with `var()` |
| `src/ui/toggle.css`, `textarea.css`, `slider.css`, `dropdown.css`, `segmentedControl.css` | UI component CSS — hardcoded font-family, radius |
| `src/contributions/menuContribution.css`, `viewContribution.css` | Contribution CSS — hardcoded values |
| `src/built-in/terminal/terminal.css` | Terminal-specific fonts |
| `src/dnd/dropOverlay.css` | Drag-drop overlay styling |
| `src/built-in/editor/pdfEditorPane.css` | PDF viewer styling |
| `src/built-in/diagnostics/diagnostics.css` | Fix `--parallx-*` → registered tokens |
| `src/built-in/chat/widgets/chatTokenStatusBar.css` | Fix `--parallx-*` → registered tokens |
| `src/built-in/canvas/canvas.css` | Replace 15 hardcoded hex → `var(--vscode-*)` |
| `src/built-in/indexing-log/indexingLog.css` | Replace 3 hardcoded hex → `var(--vscode-*)` |

### Phase 2 — Palette & Visual Identity

| File | Change |
|------|--------|
| `src/theme/themes/dark-modern.json` | New purple palette (~40 token values) |
| `src/theme/themes/light-modern.json` | Corresponding light palette |
| `src/theme/themes/hc-dark.json` | Purple accent, maintained AAA contrast |
| `src/theme/themes/hc-light.json` | Purple accent, maintained AAA contrast |

### Phase 3 — Unified Icon System

| File | Change |
|------|--------|
| `src/ui/iconRegistry.ts` | Expand from ~34 to ~180 icons; add `createIconElement()` helper |
| `src/built-in/canvas/canvasIcons.ts` | Convert to re-export wrapper (imports from central registry, re-exports for gate compliance) |
| `src/built-in/chat/chatIcons.ts` | Convert to re-export wrapper (imports from central registry) |
| `src/built-in/canvas/config/iconRegistry.ts` | Update passthrough to pull from central registry |
| `src/built-in/editor/pdfEditorPane.ts` | Replace 16 inline fill SVGs → registry lookups |
| `src/built-in/diagnostics/main.ts` | Replace 4 inline fill SVGs → registry lookups |
| `src/built-in/indexing-log/main.ts` | Replace 7 inline fill SVGs → registry lookups |
| `src/editor/editorGroupView.ts` | Replace 2 inline fill SVGs + 📌 emoji → registry |
| `src/editor/breadcrumbsBar.ts` | Replace 2 duplicate SVGs → registry lookups |
| `src/workbench/workbench.ts` | Replace 2 activity bar fill SVGs → registry |
| `src/workbench/workbenchContributionHandler.ts` | Replace emoji→SVG map → registry lookups |
| `src/workbench/statusBarController.ts` | Replace 2 fill SVGs → registry |
| `src/workbench/menuBuilder.ts` | Replace 1 fill SVG → registry |
| `src/tools/builtinManifests.ts` | Replace 4 emojis → SVG icon IDs |
| `src/built-in/welcome/main.ts` | Replace 5 emojis → registry (keep logo SVG) |
| `src/views/placeholderViews.ts` | Replace 3 emojis → registry |
| `src/services/selectionActionHandlers.ts` | Replace 2 emojis → registry |
| `src/built-in/canvas/menus/inlineAIChat.ts` | Replace ✨ 💬 emojis → registry |
| `src/built-in/canvas/canvasSidebar.ts` | Replace 📄 📊 emojis → registry |
| `src/built-in/tool-gallery/main.ts` | Replace 🧩 emoji + 5 inline SVGs → registry |
| `src/built-in/canvas/menus/blockActionMenu.ts` | Move 2 unregistered SVGs → registry |
| `src/ui/findReplaceWidget.ts` | Replace 1 fill SVG → registry |
| `src/built-in/search/main.ts` | Replace 1 fill SVG → registry |
| `src/aiSettings/ui/sections/agentSection.ts` | Replace ⚙ emoji → registry |
| `src/openclaw/commands/openclawDoctorCommand.ts` | Replace ✅❌⚠️ emojis → SVG icon IDs |
| `src/openclaw/commands/openclawStatusCommand.ts` | Replace ✅❌🔄🔍 emojis → SVG icon IDs |
| `src/openclaw/commands/openclawToolsCommand.ts` | Replace ✅🚫🔒 emojis → SVG icon IDs |
| `src/openclaw/commands/openclawVerboseCommand.ts` | Replace 🔍 emoji → SVG icon ID |
| `src/openclaw/commands/openclawNewCommand.ts` | Replace ⚠️ emoji → SVG icon ID |
| `src/openclaw/commands/openclawThinkCommand.ts` | Replace ⚠️ emoji → SVG icon ID |
| `src/built-in/chat/rendering/chatContentParts.ts` | Replace ✓ char + `\u26A0` unicode escape → registry |

### Phase 4 — Theme Editor UI

| File | Change |
|------|--------|
| `src/built-in/theme-editor/` (new) | Theme editor pane — color pickers, font controls, preview |
| `src/theme/themeCatalog.ts` | Merge user themes with built-in themes |
| `src/theme/themeTypes.ts` | `UserThemeSource` type with `designTokens` field |
| `src/services/themeService.ts` | Support applying user themes with design tokens |
| `src/workbench/workbenchThemePicker.ts` | Updated picker showing user themes + "Customize..." entry |

---

## Testing Strategy

### Phase 1 Tests

| Test File | Tests |
|-----------|-------|
| `tests/unit/designTokenRegistry.test.ts` (new) | Token registration, resolution by theme type, CSS variable name generation (`designToken.radius.md` → `--parallx-radius-md`), duplicate ID rejection |
| `tests/unit/themeService.test.ts` (new) | Color + design token CSS injection, verifies both `--vscode-*` and `--parallx-*` variables appear in generated CSS, theme switching re-generates all tokens |
| Regression | All existing 2855 tests pass, `tsc --noEmit` clean |

### Phase 2 Tests

| Test File | Tests |
|-----------|-------|
| `tests/unit/themeService.test.ts` (extend) | Verify new palette values applied correctly, accent color is purple not blue |
| Manual | Visual inspection across all 4 themes, WCAG contrast checker on key foreground/background pairs |
| Regression | All existing tests pass |

### Phase 3 Tests

| Test File | Tests |
|-----------|-------|
| `tests/unit/iconRegistry.test.ts` (new) | Every registered icon ID returns valid SVG, `createIconElement()` returns HTMLElement with correct class, all ~180 icons registered without duplicates |
| `tests/unit/gateCompliance.test.ts` (update) | Canvas gate still enforced — canvas code imports from `canvasIcons.ts` (re-export wrapper), not directly from `src/ui/iconRegistry.ts` |
| `tests/unit/builtInTools.test.ts` (update) | Update mock data that uses emoji strings to use icon IDs instead |
| Grep verification | `grep -rP '[\x{1F300}-\x{1F9FF}]' src/` returns zero results (no emoji in source). `grep -r '<svg' src/ --include='*.ts'` only matches exempt files (titlebarPart, welcome logo, watermark). |
| Regression | All existing tests pass |

### Phase 4 Tests

| Test File | Tests |
|-----------|-------|
| `tests/unit/themeCatalog.test.ts` (new) | Built-in + user theme merging, user theme CRUD (create/read/update/delete from localStorage) |
| `tests/unit/themeEditor.test.ts` (new) | Color picker value changes trigger `applyTheme()`, theme export produces valid JSON, import validates schema |
| `tests/integration/themeCustomization.test.ts` (new) | Create theme → save → reload app → theme persists → export → re-import → matches original |
| Regression | All existing tests pass |

---

## Execution Order

```
Phase 1 (Design Token Infrastructure)
  ├── 1.1 Token registry
  ├── 1.2 CSS hardcoded → var() sweep
  ├── 1.3 Rogue variable cleanup
  └── 1.4 Canvas hardcoded colors → tokens
          │
Phase 2 (Palette & Visual Identity)
  ├── 2.1 Dark Modern palette
  ├── 2.2 Light Modern palette
  ├── 2.3 HC themes
  └── 2.4 Design token defaults
          │
Phase 3 (Unified Icon System)
  ├── 3.1 Standards codified
  ├── 3.2 Icon categorization
  ├── 3.3 Registry consolidation (~180 icons)
  ├── 3.4 Rendering helper
  ├── 3.5 New icons (emoji replacements)
  └── 3.6 Inline SVG replacement
          │
Phase 4 (Theme Editor UI)
  ├── 4.1 Editor view
  ├── 4.2 Custom theme model
  ├── 4.3 Catalog extension
  ├── 4.4 Import/export
  └── 4.5 Presets
```

Phase 1 → Phase 2 is the critical path (tokens must exist before the palette can reference them). Phase 3 can begin in parallel with Phase 2 (icon work is independent of color changes). Phase 4 depends on both Phase 1 (needs tokens) and Phase 2 (needs palette to exist).

---

## Success Criteria

- [ ] App loads with purple-accented Parallx palette by default — not Microsoft blue
- [ ] Zero emoji characters rendered as icons anywhere in the UI
- [ ] All icons come from one central registry with consistent stroke style
- [ ] All border-radius values use `var(--parallx-radius-*)` tokens
- [ ] All font-family declarations use `var(--parallx-font-*)` tokens
- [ ] No ungoverned `--parallx-*` or `--color-*` CSS variables remain
- [ ] No hardcoded hex colors in canvas CSS bypass theming
- [ ] Theme editor allows users to create, save, and export custom themes
- [ ] Real-time preview works when adjusting any theme value
- [ ] All 4 built-in themes (dark, light, hc-dark, hc-light) use the Parallx palette
- [ ] 2855+ tests pass, 0 type errors
- [ ] WCAG AA contrast maintained on dark/light themes, AAA on HC themes
- [ ] Canvas gate compliance maintained — canvas icons route through `canvasIcons.ts` re-export wrapper
- [ ] Zero unicode escape emoji sequences (`\u26A0` etc.) used as icons
- [ ] All openclaw command output uses SVG icon rendering, not emoji text
- [ ] All 40+ CSS files use `var()` design tokens for font-family, border-radius, and font-size

---

## Scope Clarification: Markdown-Output Emojis

The openclaw commands (`/doctor`, `/status`, `/tools`, `/verbose`, `/new`, `/think`) render markdown-formatted text into the chat panel. Emojis in these outputs (✅, ❌, ⚠️, etc.) are currently embedded as text characters in markdown strings.

**Decision:** These are **in scope** for emoji elimination. The chat rendering pipeline supports inline SVG/HTML, so these commands should use rendered SVG icons instead of emoji text characters. This ensures the app has zero emoji rendering anywhere — UI or content output.

For commands that build markdown table strings, the replacement approach is:
1. Emit a status icon ID alongside the text
2. The chat content renderer maps icon IDs to inline SVG elements during rendering
3. Fallback: if rendering as plain markdown (non-Parallx context), use text like `[PASS]`, `[FAIL]`, `[WARN]` instead of emoji
