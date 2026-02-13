# Milestone 5 — Theming Infrastructure and Visual Polish

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 5.
> All implementation must conform to the structures and boundaries defined here.
> VS Code source files are referenced strictly as inspiration and validation, not as scope drivers.
> Referenced material must not expand scope unless a missing core theming interaction is identified.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.
> All VS Code references are filtered through this lens — only structural, shell, and hosting patterns apply.

---

## Milestone Definition

### Vision
Parallx adopts VS Code's proven theming architecture so every pixel of the workbench — titlebar, activity bar, sidebar, editor tabs, panel, status bar, dropdowns, inputs, buttons, notifications — is driven by a centralized color token system and a theme JSON file, exactly as VS Code does it. The app ships with a "Dark Modern" theme using VS Code's actual color values, producing an immediately polished and professional appearance. The architecture supports future light themes, high-contrast themes, and user-contributed themes through the same mechanism.

### Purpose
Milestones 1–4 built a fully functional workbench shell with layout, tools, commands, keyboard routing, filesystem access, and an Explorer. But all visual styling uses hardcoded hex values scattered across 4 CSS files (~250+ color literals). There is no centralized theming system. The result is an app that *works* like VS Code but doesn't *look* like VS Code — it appears flat, inconsistent, and unpolished compared to VS Code's carefully tuned Dark Modern theme.

This milestone closes that gap by building the **theming infrastructure layer** — a color registry, theme service, default theme, and full CSS migration — so that:
1. Every color in the UI comes from a single source of truth (the active theme)
2. The app looks identical to VS Code's Dark Modern theme out of the box
3. Switching themes requires only loading a different JSON file — no CSS changes
4. Tools can consume theme colors through the `parallx.*` API

### Background — What Already Exists

**Infrastructure that M5 builds on top of:**
- **Workbench CSS** — `src/workbench.css` (1445 lines) styles all structural parts. Contains ~170 hardcoded color values covering titlebar, sidebar, activity bar, editor tabs, panel, status bar, dropdown menus, Quick Access, notifications, and placeholder content.
- **UI component CSS** — `src/ui/ui.css` uses `var(--color-*)` pattern for buttons, inputs, tab bars (~20 token references). Good pattern, but the variables are never defined — relies entirely on fallback values.
- **Explorer CSS** — `src/built-in/explorer/explorer.css` uses `var(--color-*)` for tree items, list hover/selection, section headers (~20 token references). Same orphaned pattern.
- **Text editor CSS** — `src/built-in/editor/textEditorPane.css` uses `var(--color-*)` for editor foreground/background. Same orphaned pattern.
- **Status bar CSS** — Uses `var(--vscode-statusBar-*)` naming convention (5 references) — different prefix from the rest of the codebase.
- **Service infrastructure** — DI container (`src/services/serviceCollection.ts`), service interfaces pattern, lifecycle management (`src/platform/lifecycle.ts`), event system (`src/platform/events.ts`).
- **Tool API** — `parallx.*` namespace with bridges for views, editors, commands, workspace, window. M5 adds `parallx.window.activeColorTheme` and theme change events.

**What does NOT exist:**
- No color registry — no central definition of what color tokens exist
- No theme JSON files — no data-driven theme definitions
- No theme service — no runtime system to load themes and inject CSS variables
- No `:root` or `<body>` block defining CSS custom properties — all `var()` references fall back to hardcoded defaults
- No theme change event — tools can't react to theme changes
- No `parallx.window.activeColorTheme` API
- No light theme or high-contrast theme support
- No UI for switching themes
- Inconsistent CSS variable naming: `--vscode-statusBar-*` vs `--color-*` vs raw hex values

### Conceptual Scope

**Originally Planned (Capabilities 1–5)**
- Color token registry (`colorRegistry.ts`) — centralized definition of all workbench color keys with default values per theme type (dark, light, high-contrast)
- Theme data model — typed structure for theme JSON files (colors map, theme type, metadata)
- Theme service — loads theme JSON, resolves all registered colors, injects as CSS custom properties on `document.body`
- Default "Dark Modern" theme JSON — using VS Code's actual Dark Modern color values
- Full CSS migration — replace every hardcoded color in all 4 CSS files with `var(--vscode-*)` references
- Unified CSS variable naming — adopt `--vscode-*` convention throughout (matches VS Code exactly)
- Theme service registration in DI container
- Theme initialization during workbench startup
- Tool API extension: `parallx.window.activeColorTheme`, `parallx.window.onDidChangeActiveColorTheme`
- Theme persistence — remember selected theme across sessions via workspace storage

**Delivered Beyond Original Scope (Capabilities 6–11)**
- Visual polish and VS Code pixel parity — SVG codicons, Dark Modern color corrections, sash gap elimination, active-tab continuity, titlebar border, Open Editors cleanup
- Editor splitting and group management — proportional split sizing, group merge/navigation APIs, Open Editors group headers, empty group auto-close
- Format readers and Markdown live preview — EditorResolverService, MarkdownEditorPane with live preview, ImageEditorPane with zoom, PdfEditorPane
- Editor tab DnD overhaul — precise insertion targeting, thin line indicators, cross-group resolution, scroll-on-drag, editor area restriction
- Breadcrumbs navigation bar — reusable BreadcrumbsWidget, BreadcrumbsBar with workspace root detection, keyboard navigation
- Tab context menu — Close/Close Others/Close Saved/Close All, Copy Path/Copy Relative Path, Reveal in Explorer

**Excluded (Deferred)**
- Theme switching UI / settings panel (deferred — M5 ships one theme, the infrastructure supports switching programmatically)
- Light theme or high-contrast theme JSON files (deferred — easy to add once infrastructure exists)
- Token/syntax coloring (not applicable — Parallx is not a code editor)
- Icon themes / file icon themes (deferred)
- Theme marketplace or remote theme installation (deferred)
- Color customization UI / color picker (deferred)
- `workbench.colorCustomizations` settings equivalent (deferred)
- Theme contribution point for tools (`contributes.themes` in tool manifests, deferred)

### Structural Commitments
- All color values flow from theme JSON → color registry resolution → CSS custom properties on `<body>` → `var()` consumption in CSS. No hardcoded colors remain in any CSS file after migration.
- The CSS variable naming convention is `--vscode-{category}-{property}` (e.g., `--vscode-editor-background`, `--vscode-activityBar-foreground`). This matches VS Code exactly, making it trivial to port VS Code themes.
- The color registry is the single source of truth for what color tokens exist. If a CSS file references a token, that token must be registered.
- The theme service is a standard Parallx service registered in DI — not a global/singleton hack.
- Component CSS files use `var(--vscode-*)` with NO fallback values. If a token is missing, the color registry's default handles it before CSS variable injection. This ensures themes are complete.
- The theme JSON format is a subset of VS Code's theme format — compatible enough that VS Code theme color values can be copy-pasted directly.

### Architectural Principles
- **Single Source of Truth**: One theme JSON defines all colors. One service resolves and injects them. CSS only consumes.
- **VS Code Compatibility**: Token names match VS Code's `workbench.colorCustomizations` keys exactly. A color like `editor.background` becomes `--vscode-editor-background`. This makes porting VS Code themes trivial.
- **Separation of Concerns**: The color registry defines *what tokens exist* (with defaults). Theme JSON defines *what values to use*. The theme service connects them. CSS *consumes* them. No layer does another's job.
- **Progressive Enhancement**: M5 ships one theme. The architecture trivially supports adding themes by dropping new JSON files — no code changes needed.
- **Tool Symmetry**: Tools access theme colors through `parallx.window.activeColorTheme` — same pattern as VS Code extensions using `vscode.window.activeColorTheme`.

### VS Code Reference (Curated)

**Theme infrastructure:**
- `src/vs/platform/theme/common/colorRegistry.ts` — `ColorRegistry` class: central registry of all workbench color keys. Each registration specifies `id`, `description`, `defaults` (per theme type: dark, light, hcDark, hcLight). ~700+ registrations.
- `src/vs/platform/theme/common/themeService.ts` — `IThemeService` interface, `IColorTheme` with `getColor(id)`, theme type enum (`ColorSchemeType.DARK | LIGHT | HIGH_CONTRAST_DARK | HIGH_CONTRAST_LIGHT`).
- `src/vs/workbench/services/themes/browser/workbenchThemeService.ts` — `WorkbenchThemeService`: loads theme JSON, resolves colors through registry, fires theme change events.
- `src/vs/platform/theme/browser/defaultStyles.ts` — Default style functions that reference color registry tokens for UI components.

**CSS variable injection:**
- `src/vs/platform/theme/common/colorUtils.ts` — `asCssVariableName(color)` converts `editor.background` → `--vscode-editor-background`. Used by the theme service to generate the CSS rule that's injected on `<body>`.
- `src/vs/workbench/services/themes/browser/workbenchThemeService.ts` — `applyTheme()` method generates a `<style>` element with all `--vscode-*` custom properties and applies it.

**Theme data model:**
- `src/vs/workbench/services/themes/common/colorThemeData.ts` — `ColorThemeData` class: parsed theme with resolved colors, supports theme inheritance (`include` field).
- `src/vs/workbench/services/themes/common/themeConfiguration.ts` — Settings integration: `workbench.colorTheme`, `workbench.colorCustomizations`.

**Color registrations (sampling of key areas):**
- `src/vs/editor/common/core/editorColorRegistry.ts` — Editor-specific colors
- `src/vs/workbench/browser/parts/editor/editorGroupView.ts` — Editor tab colors registered inline
- `src/vs/workbench/browser/parts/activitybar/activitybarPart.ts` — Activity bar colors
- `src/vs/workbench/browser/parts/statusbar/statusbarPart.ts` — Status bar colors

**DeepWiki:**
- [Theming System](https://deepwiki.com/microsoft/vscode/4.5-theming-system) — Color themes, icon themes, theme resolution pipeline
- [Color Registry](https://deepwiki.com/microsoft/vscode/4.5-theming-system#color-registry) — Registration pattern, defaults, theme type resolution

### VS Code Alignment Audit

**✅ Aligned — following VS Code's proven approach:**
- Color registry pattern with per-theme-type defaults
- CSS variable injection on `<body>` element via `<style>` tag
- `--vscode-*` naming convention for CSS custom properties
- `asCssVariableName()` conversion: `editor.background` → `--vscode-editor-background`
- Theme data model with `colors` map and `type` field
- Theme service as proper DI-registered service
- Extension API: `activeColorTheme` + `onDidChangeActiveColorTheme`

**⚠️ Intentional deviations (acceptable for M5 scope):**
- **No theme inheritance/include** — VS Code themes support `"include": "./base-theme.json"` for theme composition. M5 themes are flat (all colors in one file). Straightforward to add later.
- **No tokenColors** — VS Code themes define syntax highlighting scopes. Not applicable to Parallx (not a code editor).
- **~70 color tokens vs ~700** — VS Code registers ~700 color keys. Parallx M5 registers only the ~70 actually used by workbench CSS. More can be added incrementally as features grow.
- **No settings integration** — VS Code allows `workbench.colorCustomizations` to override individual theme colors. Deferred.
- **No theme auto-detection** — VS Code detects OS dark/light mode. Deferred.
- **Single theme ships** — Only "Dark Modern" included. Light/HC themes are future JSON files with zero code changes.

---

## Capability 1 — Color Token Registry

### Capability Description
A centralized registry that defines every color token used by the Parallx workbench. Each registration declares the token's key (matching VS Code's naming), a description, and default values for dark, light, and high-contrast theme types. This is the definitive catalog of "what colors exist" — CSS files reference only registered tokens.

### Goals
- Single source of truth for all workbench color token definitions
- Each token has a VS Code-compatible key (e.g., `editor.background`, `activityBar.foreground`)
- Default values per theme type enable graceful fallback when a theme JSON omits a color
- Registration API allows future modules to register additional tokens (e.g., tools adding custom colors)
- Auditable: you can enumerate all registered tokens programmatically

### Dependencies
- `src/platform/lifecycle.ts` (Disposable base)
- `src/platform/events.ts` (Emitter for registry change events)

### VS Code Reference
- `src/vs/platform/theme/common/colorRegistry.ts` — `registerColor()` function, `ColorDefaults` interface, theme type resolution

### Inventory of Required Color Tokens

> Derived from auditing all 4 CSS files in the codebase. Every hardcoded color and every orphaned `var()` reference maps to one of these tokens.

**Core / Shared (~12 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `foreground` | Default foreground color | `#cccccc` |
| `focusBorder` | Border color for focused elements | `#007fd4` |
| `widget.shadow` | Shadow color for widgets (dropdowns, dialogs) | `rgba(0, 0, 0, 0.5)` |
| `selection.background` | Background of selected text/items | `#04395e` |
| `descriptionForeground` | Foreground for descriptions/secondary text | `#999999` |
| `icon.foreground` | Default icon foreground | `#c5c5c5` |
| `errorForeground` | Foreground for error text | `#f14c4c` |
| `sash.hoverBorder` | Sash/resize handle color on hover | `#007acc` |
| `toolbar.hoverBackground` | Background when hovering toolbar items | `rgba(255, 255, 255, 0.1)` |

**Titlebar (~8 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `titleBar.activeBackground` | Titlebar background when window is active | `#323233` |
| `titleBar.activeForeground` | Titlebar foreground when active | `rgba(255, 255, 255, 0.7)` |
| `titleBar.inactiveBackground` | Titlebar background when inactive | `#323233` |
| `titleBar.inactiveForeground` | Titlebar foreground when inactive | `rgba(255, 255, 255, 0.5)` |
| `menu.foreground` | Menu item foreground | `#cccccc` |
| `menu.background` | Menu/dropdown background | `#252526` |
| `menu.selectionBackground` | Menu item hover/selection background | `#04395e` |
| `menu.border` | Menu/dropdown border | `#454545` |
| `menu.separatorBackground` | Menu separator color | `rgba(255, 255, 255, 0.1)` |

**Activity Bar (~6 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `activityBar.background` | Activity bar background | `#333333` |
| `activityBar.foreground` | Active icon foreground | `#ffffff` |
| `activityBar.inactiveForeground` | Inactive icon foreground | `rgba(255, 255, 255, 0.4)` |
| `activityBar.border` | Activity bar right border | `#3c3c3c` |
| `activityBar.activeBorder` | Active item indicator border | `#ffffff` |
| `activityBarBadge.background` | Badge background color | `#007acc` |
| `activityBarBadge.foreground` | Badge foreground color | `#ffffff` |

**Sidebar (~6 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `sideBar.background` | Sidebar background | `#252526` |
| `sideBar.foreground` | Sidebar foreground | `#cccccc` |
| `sideBar.border` | Sidebar border | `#3c3c3c` |
| `sideBarTitle.foreground` | Sidebar title text | `rgba(255, 255, 255, 0.6)` |
| `sideBarSectionHeader.background` | Section header background | `#252526` |
| `sideBarSectionHeader.foreground` | Section header foreground | `#cccccc` |
| `sideBarSectionHeader.border` | Section header border | `#3c3c3c` |

**Editor / Editor Groups (~10 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `editor.background` | Editor background | `#1e1e1e` |
| `editor.foreground` | Editor foreground | `#d4d4d4` |
| `editorGroupHeader.tabsBackground` | Editor tab bar background | `#252526` |
| `editorGroupHeader.tabsBorder` | Editor tab bar bottom border | `#1e1e1e` |
| `tab.activeBackground` | Active tab background | `#1e1e1e` |
| `tab.activeForeground` | Active tab foreground | `#ffffff` |
| `tab.activeBorderTop` | Active tab top accent border | `transparent` |
| `tab.activeBorder` | Active tab bottom border | `#007acc` |
| `tab.inactiveBackground` | Inactive tab background | `#2d2d2d` |
| `tab.inactiveForeground` | Inactive tab foreground | `rgba(255, 255, 255, 0.5)` |
| `tab.border` | Tab right separator border | `#1e1e1e` |
| `tab.modifiedBorder` | Dirty indicator on modified tabs | `#e8e8e8` |

**Panel (~4 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `panel.background` | Panel background | `#1e1e1e` |
| `panel.border` | Panel top border | `#3c3c3c` |
| `panelTitle.activeForeground` | Active panel tab foreground | `#ffffff` |
| `panelTitle.inactiveForeground` | Inactive panel tab foreground | `rgba(255, 255, 255, 0.5)` |
| `panelTitle.activeBorder` | Active panel tab bottom border | `#007acc` |

**Auxiliary Bar (~3 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `auxiliaryBar.background` | Auxiliary sidebar background | `#252526` |
| `auxiliaryBar.border` | Auxiliary sidebar border | `#3c3c3c` |
| `auxiliaryBar.headerForeground` | Auxiliary bar header text | `rgba(255, 255, 255, 0.6)` |

**Status Bar (~5 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `statusBar.background` | Status bar background | `#007acc` |
| `statusBar.foreground` | Status bar foreground | `#ffffff` |
| `statusBarItem.hoverBackground` | Status bar item hover | `rgba(255, 255, 255, 0.12)` |
| `statusBarItem.hoverForeground` | Status bar item hover foreground | `inherit` |
| `statusBarItem.activeBackground` | Status bar item active/pressed | `rgba(255, 255, 255, 0.18)` |

**Lists and Trees (~5 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `list.hoverBackground` | List/tree item hover background | `rgba(255, 255, 255, 0.04)` |
| `list.activeSelectionBackground` | Selected item background | `rgba(255, 255, 255, 0.1)` |
| `list.activeSelectionForeground` | Selected item foreground | `#ffffff` |
| `list.focusOutline` | Focus border for list items | `#007acc` |

**Inputs (~5 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `input.background` | Text input background | `#3c3c3c` |
| `input.foreground` | Text input foreground | `#cccccc` |
| `input.border` | Text input border | `#474747` |
| `input.placeholderForeground` | Placeholder text | `#888888` |

**Buttons (~5 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `button.background` | Primary button background | `#0e639c` |
| `button.foreground` | Primary button foreground | `#ffffff` |
| `button.hoverBackground` | Primary button hover | `#1177bb` |
| `button.secondaryBackground` | Secondary button background | `#3a3d41` |
| `button.secondaryForeground` | Secondary button foreground | `#cccccc` |
| `button.secondaryHoverBackground` | Secondary button hover | `#45494e` |

**Notifications (~5 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `notifications.background` | Notification toast background | `#252526` |
| `notifications.foreground` | Notification text color | `#cccccc` |
| `notifications.border` | Notification border | `#3c3c3c` |
| `notificationLink.foreground` | Notification link color | `#3794ff` |
| `notificationToast.border` | Notification toast outer border | `#3c3c3c` |
| `notificationsInfoIcon.foreground` | Info icon color | `#3794ff` |
| `notificationsWarningIcon.foreground` | Warning icon color | `#cca700` |
| `notificationsErrorIcon.foreground` | Error icon color | `#f14c4c` |

**Quick Access (~4 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `quickInput.background` | Quick access background | `#252526` |
| `quickInput.foreground` | Quick access text | `#cccccc` |
| `quickInputList.focusBackground` | Focused item in quick access | `#04395e` |
| `quickInputTitle.background` | Quick access header background | `#3c3c3c` |

**Drop Targets (~2 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `editorGroup.dropBackground` | Editor group drop target overlay | `rgba(0, 120, 212, 0.18)` |
| `editorGroup.dropBorder` | Editor group drop target border | `rgba(0, 120, 212, 0.5)` |

**Links (~2 tokens)**
| Token Key | Description | Dark Modern Default |
|-----------|-------------|-------------------|
| `textLink.foreground` | Link color | `#3794ff` |
| `textLink.activeForeground` | Active/hovered link color | `#3794ff` |

#### Tasks

**Task 1.1 — Define ColorRegistration Types and ThemeType Enum** ✅
- **Task Description:** Create `src/theme/colorRegistry.ts` with the core type definitions.
- **Output:** `ThemeType` enum (`DARK`, `LIGHT`, `HIGH_CONTRAST_DARK`, `HIGH_CONTRAST_LIGHT`), `ColorDefault` interface (values per theme type), `ColorRegistration` interface (`id`, `description`, `defaults`), `IColorRegistry` interface.
- **Completion Criteria:**
  - `ThemeType` enum with 4 values matching VS Code's `ColorSchemeType`
  - `ColorDefault` type: `{ dark: string; light: string; hcDark: string; hcLight: string }` — each is a CSS color string
  - `ColorRegistration`: `{ id: string; description: string; defaults: ColorDefault }`
  - `IColorRegistry` interface with `registerColor()`, `getRegisteredColor()`, `getRegisteredColors()`, `resolveColor(id, themeType)`
  - All types exported

**Task 1.2 — Implement ColorRegistry Class** ✅
- **Task Description:** Implement the `ColorRegistry` singleton that stores all registered color tokens.
- **Output:** `ColorRegistry` class implementing `IColorRegistry`.
- **Completion Criteria:**
  - `registerColor(id, description, defaults)` — registers a color token; throws if duplicate ID
  - `getRegisteredColor(id)` — returns `ColorRegistration | undefined`
  - `getRegisteredColors()` — returns all registrations as `ReadonlyArray<ColorRegistration>`
  - `resolveColor(id, themeType)` — returns the default value for the given theme type; returns `undefined` if not registered
  - `asCssVariableName(id)` — converts `editor.background` → `--vscode-editor-background` (replace `.` with `-`)
  - Exported singleton instance: `export const colorRegistry = new ColorRegistry()`
  - Registration count is queryable for diagnostics

**Task 1.3 — Register All Workbench Color Tokens** ✅
- **Task Description:** Create `src/theme/workbenchColors.ts` that imports the registry and registers every token from the inventory above.
- **Output:** All ~70+ color tokens registered with proper defaults.
- **Completion Criteria:**
  - One `registerColor()` call per token from the inventory table above
  - Dark defaults match the values currently hardcoded in CSS files
  - Light defaults use reasonable light-theme values (can reference VS Code's Light Modern theme)
  - HC defaults use high-contrast values (white/black with clear borders)
  - File is imported during workbench startup to ensure registrations happen before theme application
  - Registrations are organized by category (core, titlebar, activity bar, sidebar, editor, panel, status bar, lists, inputs, buttons, notifications, quick access)
- **Notes / Constraints:**
  - Light and HC defaults are best-effort for M5 — they enable future themes but only the dark theme ships
  - Token count may grow slightly during CSS migration if additional colors are discovered

---

## Capability 2 — Theme Data Model and Default Theme

### Capability Description
The theme data model defines the JSON format for theme files and provides a parser. The default "Dark Modern" theme JSON uses VS Code's actual color values to produce an immediately professional appearance.

### Goals
- Theme JSON format is a compatible subset of VS Code's theme format
- Theme data is parsed into a typed `ColorThemeData` object
- Default "Dark Modern" theme provides complete coverage of all registered tokens
- Theme files are static JSON — no code execution, safe to load

### Dependencies
- Capability 1 (Color Token Registry)

### VS Code Reference
- `src/vs/workbench/services/themes/common/colorThemeData.ts` — `ColorThemeData` class, parsing logic
- VS Code's built-in dark modern theme: `extensions/theme-defaults/themes/dark_modern.json`

#### Tasks

**Task 2.1 — Define Theme Data Types** ✅
- **Task Description:** Create `src/theme/themeData.ts` with the theme data model.
- **Output:** `IColorTheme` interface, `ColorThemeData` class, `ThemeSource` type.
- **Completion Criteria:**
  - `IColorTheme` interface: `{ id: string; label: string; type: ThemeType; getColor(colorId: string): string | undefined }`
  - `ColorThemeData` class: holds parsed theme data, implements `IColorTheme`
  - `ColorThemeData.colors` — `Map<string, string>` of color ID → resolved CSS color value
  - `ColorThemeData.getColor(id)` — returns the theme's value for a color, or `undefined` if not specified (letting the registry default handle it)
  - `ThemeSource` type: `{ id: string; label: string; uiTheme: 'vs-dark' | 'vs' | 'hc-black' | 'hc-light'; colors: Record<string, string> }`
  - Static factory: `ColorThemeData.fromSource(source: ThemeSource, registry: IColorRegistry): ColorThemeData` — parses a theme source, validates color keys against registry
- **Notes / Constraints:**
  - `uiTheme` field maps to `ThemeType` enum: `'vs-dark'` → `DARK`, `'vs'` → `LIGHT`, `'hc-black'` → `HIGH_CONTRAST_DARK`, `'hc-light'` → `HIGH_CONTRAST_LIGHT`
  - Unknown color keys in theme JSON are logged as warnings but not rejected (forward compatibility)

**Task 2.2 — Create Dark Modern Theme JSON** ✅
- **Task Description:** Create `src/theme/themes/dark-modern.json` containing VS Code's Dark Modern color palette.
- **Output:** Complete theme JSON file with ~70+ color entries.
- **Completion Criteria:**
  - `id`: `"parallx-dark-modern"`
  - `label`: `"Dark Modern"`
  - `uiTheme`: `"vs-dark"`
  - `colors` object contains an entry for every token registered in Capability 1
  - Color values match VS Code's Dark Modern theme (sourced from `extensions/theme-defaults/themes/dark_modern.json` and `dark_defaults.json`)
  - File is valid JSON, human-readable with consistent formatting
  - File can be loaded and parsed by `ColorThemeData.fromSource()` without errors
- **Notes / Constraints:**
  - VS Code's Dark Modern inherits from dark_defaults, which inherits from dark_vs. We flatten the inheritance — our JSON has all final resolved values.
  - Some colors in VS Code are computed (e.g., `transparent(focusBorder, 0.6)`). We pre-compute these to static values.

---

## Capability 3 — Theme Service

### Capability Description
The theme service loads a theme (currently the built-in Dark Modern), resolves all color tokens through the color registry, generates CSS custom properties, and injects them as a `<style>` element on `document.body`. It is the runtime engine that connects theme data to the visual output.

### Goals
- Loads and applies a color theme at workbench startup
- Generates CSS custom properties matching `--vscode-{category}-{property}` naming
- Injects styles via a managed `<style>` element (not inline styles on `<body>`)
- Fires events when theme changes (for future theme switching)
- Registered in DI container as a standard service
- Persists active theme selection across sessions

### Dependencies
- Capability 1 (Color Token Registry — registered colors, defaults)
- Capability 2 (Theme Data Model — parsed theme, color resolution)
- `src/services/serviceCollection.ts` (DI container)
- `src/platform/storage.ts` (persistence for active theme ID)
- `src/platform/events.ts` (Emitter for theme change events)

### VS Code Reference
- `src/vs/workbench/services/themes/browser/workbenchThemeService.ts` — `WorkbenchThemeService`, `applyTheme()`, CSS variable generation

#### Tasks

**Task 3.1 — Define IThemeService Interface** ✅
- **Task Description:** Create `src/services/themeService.ts` with the service interface and service identifier.
- **Output:** `IThemeService` interface, `IThemeServiceKey` service identifier.
- **Completion Criteria:**
  - `IThemeService` interface:
    - `readonly activeTheme: IColorTheme` — currently applied theme
    - `readonly onDidChangeTheme: Event<IColorTheme>` — fired when theme changes
    - `getColor(colorId: string): string` — resolves a color from active theme, falling back to registry default
    - `applyTheme(themeId: string): void` — loads and applies a theme by ID
  - `IThemeServiceKey` service identifier string for DI registration
  - Import types from Capability 1 and 2

**Task 3.2 — Implement ThemeService Class** ✅
- **Task Description:** Implement the theme service that resolves colors and injects CSS variables.
- **Output:** `ThemeService` class implementing `IThemeService`.
- **Completion Criteria:**
  - Constructor accepts `IColorRegistry` and an initial `ColorThemeData`
  - `applyTheme()`:
    1. Iterates all registered colors from the registry
    2. For each color: checks theme data first, falls back to registry default for the theme's type
    3. Generates a CSS rule: `body { --vscode-editor-background: #1e1e1e; --vscode-editor-foreground: #d4d4d4; ... }`
    4. Creates/updates a `<style id="parallx-theme-colors">` element in `<head>`
    5. Sets `data-vscode-theme-type` attribute on `<body>` (value: `dark`, `light`, `hc-dark`, `hc-light`) — enables CSS selectors like `body[data-vscode-theme-type="dark"]`
    6. Fires `onDidChangeTheme` event
  - `getColor(id)` — returns resolved color string for current theme
  - CSS variable name conversion: `editor.background` → `--vscode-editor-background` (dots to hyphens, category separator preserved)
  - Extends `Disposable` — cleans up `<style>` element and event subscriptions on dispose
- **Notes / Constraints:**
  - The `<style>` element approach (vs inline style on body) matches VS Code and avoids CSP issues
  - CSS variable generation must handle all registered colors — missing theme values use registry defaults
  - Performance: generating ~70 CSS properties is trivial, but the approach should scale to 700+ without lag

**Task 3.3 — Register ThemeService in DI and Initialize at Startup** ✅
- **Task Description:** Wire the theme service into the workbench startup sequence.
- **Output:** Theme service available via DI container, theme applied before first render.
- **Completion Criteria:**
  - `ThemeService` is registered in `ServiceCollection` during workbench initialization
  - Built-in Dark Modern theme JSON is imported and parsed during startup
  - `workbenchColors.ts` is imported to ensure all tokens are registered before theme application
  - `applyTheme()` is called before any part renders (theme CSS variables available for initial paint)
  - Theme service is accessible to other services and via `services.get(IThemeServiceKey)`
  - Active theme ID is persisted to storage; on next launch, the persisted theme is loaded
- **Notes / Constraints:**
  - For M5, there's only one theme — but the persistence mechanism is in place for future themes
  - Theme must be applied early in startup — before `LayoutRenderer.render()` — to avoid a flash of unstyled content

---

## Capability 4 — CSS Migration

### Capability Description
Migrate all 4 CSS files from hardcoded colors and orphaned `var()` references to the unified `var(--vscode-*)` convention. After this capability, no CSS file contains a hardcoded color value (except for truly structural values like `transparent`, `inherit`, and `currentColor`).

### Goals
- Every hardcoded hex, rgb, and rgba color in CSS is replaced with a `var(--vscode-*)` reference
- The inconsistent `--color-*` convention is replaced with `--vscode-*` throughout
- The existing `--vscode-statusBar-*` references are kept (already correct)
- After migration, changing the theme JSON changes every color in the app

### Dependencies
- Capability 1 (Color Token Registry — token names to reference)
- Capability 3 (Theme Service — CSS variables are injected at runtime)

### Files to Migrate

| File | Hardcoded Colors | Orphaned `var()` | Total Replacements |
|------|-----------------|------------------|-------------------|
| `src/workbench.css` | ~160 | ~18 (mixed `--vscode-*` / `--color-*`) | ~170 |
| `src/ui/ui.css` | ~0 | ~20 (`--color-*` to rename) | ~20 |
| `src/built-in/explorer/explorer.css` | ~0 | ~20 (`--color-*` to rename) | ~20 |
| `src/built-in/editor/textEditorPane.css` | ~2 | ~3 (`--color-*` to rename) | ~5 |
| **Total** | **~162** | **~61** | **~215** |

#### Tasks

**Task 4.1 — Migrate workbench.css — Core Layout and Parts** ✅
- **Task Description:** Replace all hardcoded colors in `src/workbench.css` with `var(--vscode-*)` references. This is the largest migration (~170 replacements across titlebar, sidebar, activity bar, editor tabs, panel, status bar, dropdowns, Quick Access, notifications, and structural styles).
- **Output:** `workbench.css` with zero hardcoded color values (except `transparent`, `inherit`, `currentColor`, `none`).
- **Completion Criteria:**
  - Every `#hex`, `rgb()`, and `rgba()` color value is replaced with a `var(--vscode-*)` reference
  - Existing `var(--vscode-statusBar-*)` references are unchanged (already correct convention)
  - Existing `var(--color-*)` references are renamed to `var(--vscode-*)` equivalents
  - No `var()` fallback values — the theme service guarantees all variables are set
  - `html, body` background/color use theme tokens: `var(--vscode-editor-background)` and `var(--vscode-foreground)`
  - Close button red (`#e81123`) is kept as-is — it's a platform convention, not a theme color
  - Box-shadow values that use rgba for opacity may reference a shadow-specific token or keep the structural shadow pattern with a themed color component
  - CSS file compiles and renders correctly when theme service is active
- **Notes / Constraints:**
  - This is mechanical but large — work through the file section by section (titlebar → sidebar → activity bar → editor → panel → status bar → etc.)
  - Some rgba values with opacity are hover/active states — these may need dedicated tokens or use the base color with opacity in the CSS (`color-mix()` or token with built-in opacity)
  - Test visually after migration: every part should look identical to pre-migration

**Task 4.2 — Migrate ui.css — UI Components** ✅
- **Task Description:** Rename all `var(--color-*)` references in `src/ui/ui.css` to `var(--vscode-*)` equivalents and remove fallback values.
- **Output:** `ui.css` using only `var(--vscode-*)` convention with no fallbacks.
- **Completion Criteria:**
  - `--color-button-foreground` → `--vscode-button-foreground`
  - `--color-button-background` → `--vscode-button-background`
  - `--color-button-hover-background` → `--vscode-button-hoverBackground`
  - `--color-button-active-background` → `--vscode-button-activeBackground` (or keep as hover)
  - `--color-focus-border` → `--vscode-focusBorder`
  - `--color-button-secondary-*` → `--vscode-button-secondary*`
  - `--color-border` → `--vscode-sideBar-border` (or context-appropriate token)
  - `--color-text-muted` → `--vscode-descriptionForeground`
  - `--color-hover` → `--vscode-toolbar-hoverBackground`
  - `--color-input-*` → `--vscode-input-*`
  - `--color-error` → `--vscode-errorForeground`
  - `--color-tab-bar-background` → `--vscode-editorGroupHeader-tabsBackground`
  - All fallback values removed from `var()` calls
  - Comment header updated to reference `--vscode-*` convention

**Task 4.3 — Migrate explorer.css — Explorer View** ✅
- **Task Description:** Rename all `var(--color-*)` references in `src/built-in/explorer/explorer.css` to `var(--vscode-*)` equivalents and remove fallback values.
- **Output:** `explorer.css` using only `var(--vscode-*)` convention with no fallbacks.
- **Completion Criteria:**
  - `--color-section-header-foreground` → `--vscode-sideBarSectionHeader-foreground`
  - `--color-description-foreground` → `--vscode-descriptionForeground`
  - `--color-link-foreground` → `--vscode-textLink-foreground`
  - `--color-link-active-foreground` → `--vscode-textLink-activeForeground`
  - `--color-foreground` → `--vscode-foreground`
  - `--color-list-hover-background` → `--vscode-list-hoverBackground`
  - `--color-list-active-selection-background` → `--vscode-list-activeSelectionBackground`
  - `--color-focus-border` → `--vscode-focusBorder`
  - `--color-input-*` → `--vscode-input-*`
  - `--color-editor-dirty-foreground` → `--vscode-tab-modifiedBorder` (or appropriate token)
  - `--color-icon-foreground` → `--vscode-icon-foreground`
  - `--color-toolbar-hover-background` → `--vscode-toolbar-hoverBackground`
  - All fallback values removed
  - Comment header updated

**Task 4.4 — Migrate textEditorPane.css — Text Editor** ✅
- **Task Description:** Rename `var(--color-*)` references in `src/built-in/editor/textEditorPane.css` to `var(--vscode-*)` equivalents.
- **Output:** `textEditorPane.css` using only `var(--vscode-*)` convention.
- **Completion Criteria:**
  - `--color-editor-foreground` → `--vscode-editor-foreground`
  - `--color-editor-background` → `--vscode-editor-background`
  - Any hardcoded colors replaced with appropriate tokens
  - All fallback values removed
  - Comment header updated

**Task 4.5 — Visual Verification and Token Audit** ✅
- **Task Description:** Verify that the migrated CSS renders identically to pre-migration and that every `var(--vscode-*)` reference in CSS maps to a registered token.
- **Output:** Confirmed visual parity; any missing tokens registered.
- **Completion Criteria:**
  - `tsc --noEmit` passes (no TypeScript errors)
  - `node scripts/build.mjs` succeeds
  - App launches and all parts render with correct colors
  - No unstyled/transparent areas caused by missing CSS variables
  - All `var(--vscode-*)` references in CSS files have corresponding `registerColor()` calls
  - Side-by-side comparison with pre-migration screenshot shows identical appearance
  - grep confirms zero hardcoded hex/rgb/rgba values in CSS (except allowed: `transparent`, `inherit`, `currentColor`, `none`, and close button red `#e81123`)

---

## Capability 5 — Tool API Extension

### Capability Description
Extend the `parallx.*` tool API to expose the active color theme and theme change events, allowing tools to adapt to the current theme (e.g., rendering charts with themed colors, adjusting canvas backgrounds).

### Goals
- Tools can read the current theme type (dark/light/hc)
- Tools can read specific color values from the active theme
- Tools are notified when the theme changes
- API mirrors VS Code's `vscode.window.activeColorTheme`

### Dependencies
- Capability 3 (Theme Service)
- `src/api/apiFactory.ts` (API creation for tools)
- `src/api/parallx.d.ts` (type definitions)

### VS Code Reference
- `vscode.window.activeColorTheme` — `ColorTheme { kind: ColorThemeKind }`
- `vscode.window.onDidChangeActiveColorTheme` — event fired on theme change
- `vscode.ColorThemeKind` — enum: `Dark = 2`, `Light = 1`, `HighContrast = 3`, `HighContrastLight = 4`

#### Tasks

**Task 5.1 — Add Theme Types to parallx.d.ts** ✅
- **Task Description:** Extend the `parallx.*` type definitions with theme-related types.
- **Output:** Updated `src/api/parallx.d.ts` with `ColorTheme`, `ColorThemeKind`, and API surface.
- **Completion Criteria:**
  - `ColorThemeKind` enum: `Light = 1`, `Dark = 2`, `HighContrast = 3`, `HighContrastLight = 4` (matches VS Code exactly)
  - `ColorTheme` interface: `{ kind: ColorThemeKind }`
  - `parallx.window.activeColorTheme: ColorTheme` property
  - `parallx.window.onDidChangeActiveColorTheme: Event<ColorTheme>` event
  - JSDoc documentation on all new types matching VS Code API docs style

**Task 5.2 — Implement Theme API Bridge** ✅
- **Deviation:** Rather than creating a separate `themeBridge.ts`, the theme API was wired directly in `apiFactory.ts` following the same inline pattern used by the `statusBarItem` implementation. A `_themeTypeToKind()` helper maps internal `ThemeType` to public `ColorThemeKind` values.
- **Task Description:** Wire the theme service into the API factory so tools can access theme information.
- **Output:** Working `parallx.window.activeColorTheme` and `parallx.window.onDidChangeActiveColorTheme`.
- **Completion Criteria:**
  - `apiFactory.ts` creates `activeColorTheme` getter that reads from theme service
  - `onDidChangeActiveColorTheme` wraps the theme service's `onDidChangeTheme` event, mapped to `ColorTheme` type
  - Theme kind is derived from `IColorTheme.type`: `DARK` → `ColorThemeKind.Dark`, etc.
  - API is available to all tools immediately after workbench startup

---

## Capability 6 — Visual Polish and VS Code Pixel Parity *(Beyond Original Scope)*

### Capability Description
After the theming infrastructure landed, a series of targeted visual-polish fixes were made to close the remaining pixel-level gaps between Parallx and VS Code's Dark Modern appearance. These fixes span SVG icon replacement, border alignment, sash gap elimination, active-tab continuity, and titlebar refinement.

### Goals
- Replace all emoji-based icons with proper SVG codicons matching VS Code's icon set
- Eliminate visual gaps at pane junctions (sash handles consuming flex space)
- Achieve seamless active-tab-to-editor connection (no visible separator line)
- Ensure titlebar border matches VS Code

### Implementation Summary

**Task 6.1 — SVG Codicon Icons** ✅
- Activity bar: replaced emoji icons (📁, 🔍, etc.) with VS Code codicon-style SVGs
- `ActivityBarIconDescriptor`: added `isSvg` flag for SVG icon rendering
- CSS: `activity-bar-icon-label` now flex-centered with 24×24 SVG sizing
- Tools icon: emoji puzzle piece → SVG codicon via `resolveCodiconSvg()` map supporting contributed containers (`codicon-extensions`, etc.)
- **Files:** `src/parts/activityBarPart.ts`, `src/workbench/workbench.ts`, `src/workbench.css`
- **Commits:** `91ae839`, `a822a6d`

**Task 6.2 — Dark Modern Color Corrections** ✅
- `dark-modern.json`: replaced stale Dark+ values with actual VS Code Dark Modern colors (e.g., statusBar `#007acc` → `#181818`, sidebar `#252526` → `#181818`, borders `#3c3c3c` → `#2b2b2b`)
- `workbenchColors.ts`: updated all dark-theme defaults to match Dark Modern
- **Files:** `src/theme/themes/dark-modern.json`, `src/theme/workbenchColors.ts`
- **Commit:** `91ae839`

**Task 6.3 — Border and Gap Alignment** ✅
- Sidebar/panel margins zeroed to eliminate junction gaps
- Grid sashes (4 px resize handles): negative margins (−2 px each side) so sashes overlap adjacent panes and consume 0 net flex space while remaining fully functional for drag-resize
- **Files:** `src/workbench.css`
- **Commits:** `a822a6d`, `c94d7bf`

**Task 6.4 — Active Tab Seamless Connection** ✅
- Tab bar: `align-items: stretch` (tabs fill full height, no background gap)
- Removed tab bar `border-bottom` entirely
- Active tab: blue top accent via `border-top` (`tab.activeBorderTop`)
- No visible line between active tab and editor content — matches VS Code exactly
- **Files:** `src/workbench.css`
- **Commit:** `fe2d1c4`

**Task 6.5 — Titlebar Border** ✅
- Added `border-bottom` to titlebar matching VS Code's `titleBar.border` token
- **Files:** `src/workbench.css`
- **Commit:** `c1581b8`

**Task 6.6 — Open Editors Cleanup** ✅
- Emoji file icons → minimal text glyphs (TS, JS, `{}`, etc.)
- Dirty dot: CSS circle instead of text emoji
- 22 px row height, removed bold on active, smaller close button
- **Files:** `src/built-in/explorer/explorer.css`, `src/built-in/explorer/main.ts`
- **Commit:** `a822a6d`

---

## Capability 7 — Editor Splitting and Group Management *(Beyond Original Scope)*

### Capability Description
Align editor splitting, group management, and Open Editors rendering with VS Code's architecture. Fixes proportional splitting, adds group merge/navigation, and introduces group headers in the Explorer's Open Editors section.

### Goals
- Split size uses source view's actual size, not container size
- New split copies the active editor (VS Code parity: both sides show the same file)
- Group merge, directional navigation, and alias APIs
- Open Editors shows group headers when multiple groups exist
- Empty groups auto-close when their last editor is closed

### Implementation Summary

**Task 7.1 — Editor Splitting Logic Alignment** ✅
- Fix split size calculation: use source view's size, not container size (was giving new groups half the entire container)
- Copy active editor from source group into new split (both sides show same file)
- Added `mergeGroup()`: moves editors from source to target, removes empty source
- Added `addGroup()` as VS Code-style alias for `splitGroup()`
- Added `findGroup()` for directional group navigation
- Improved `removeGroup()` to merge editors into nearest group before removal
- Fixed grid `splitView` same-orientation case: clamp new view size so it never exceeds the space the existing view can give
- **Files:** `src/layout/grid.ts`, `src/parts/editorPart.ts`, `src/services/editorGroupService.ts`, `src/services/serviceTypes.ts`
- **Commit:** `d1b6a06`

**Task 7.2 — Editor Toolbar Cleanup** ✅
- Removed redundant close-group button (each tab already has its own close button)
- Replaced text split icon with SVG split-editor codicon
- Updated toolbar button CSS for flex-centered SVG layout
- **Files:** `src/editor/editorGroupView.ts`, `src/workbench.css`
- **Commit:** `d3052c4`

**Task 7.3 — Open Editors Group Headers** ✅
- Group editors by `groupId` in `renderOpenEditors()`
- Show "Group N" headers (bold, uppercase, 11 px) when 2+ groups exist
- Indent editor items under group headers for visual hierarchy
- Single group keeps flat list (unchanged behavior)
- **Files:** `src/built-in/explorer/explorer.css`, `src/built-in/explorer/main.ts`
- **Commit:** `01898c6`

**Task 7.4 — Auto-Close Empty Editor Groups** ✅
- Match VS Code's `workbench.editor.closeEmptyGroups` default (`true`)
- When `EditorClose` fires and group becomes empty with other groups remaining, remove via `queueMicrotask`
- Remaining groups resize automatically to fill freed space
- Last group is never auto-closed (at least one group always alive)
- **Files:** `src/parts/editorPart.ts`
- **Commit:** `500c95a`

---

## Capability 8 — Format Readers and Markdown Live Preview *(Beyond Original Scope)*

### Capability Description
Introduce an editor resolver service that maps file extensions to specialized read-only editor panes, plus a live-updating Markdown preview pane. This enables Parallx to open images, PDFs, and Markdown files with native renderers instead of raw text, matching VS Code's format reader behavior.

### Goals
- EditorResolverService: priority-sorted registry mapping file extensions to editor types
- Markdown opens in text editor by default; `Open Preview to the Side` (`Ctrl+K V`) shows live-updating rendered preview in a split pane
- Image files render with checkerboard background, zoom, and info bar
- PDF files render via Chromium's built-in embed element
- Clean separation between text editing and read-only preview

### Implementation Summary

**Task 8.1 — EditorResolverService** ✅
- Priority-sorted registry mapping file extensions to editor types
- Resolves which editor pane to instantiate for a given `EditorInput`
- **Files:** `src/services/editorResolverService.ts`
- **Commit:** `577969b`

**Task 8.2 — Markdown Editor Pane and Preview** ✅
- `MarkdownEditorPane`: lightweight MD-to-HTML renderer supporting headings, lists, tables, code blocks, links, images, and blockquotes
- `MarkdownPreviewInput`: read-only input wrapping `FileEditorInput` for live preview
- Preview toolbar button appears in editor group toolbar for `.md` files
- `Ctrl+K V` command opens preview to the side
- Fixed infinite loop in markdown parser (blockquote handler mismatch)
- **Files:** `src/built-in/editor/markdownEditorPane.ts`, `src/built-in/editor/markdownEditorPane.css`, `src/built-in/editor/markdownPreviewInput.ts`, `src/commands/structuralCommands.ts`, `src/editor/editorGroupView.ts`
- **Commit:** `577969b`

**Task 8.3 — Image Editor Pane** ✅
- Image viewer with checkerboard background for transparent images
- `Ctrl+scroll` zoom support
- Info bar showing image dimensions and file size
- **Files:** `src/built-in/editor/imageEditorPane.ts`, `src/built-in/editor/imageEditorPane.css`, `src/built-in/editor/imageEditorInput.ts`
- **Commit:** `577969b`

**Task 8.4 — PDF Editor Pane** ✅
- PDF viewer using Chromium's built-in `<embed>` element
- CSP updated for `data:` URIs (images, PDFs)
- **Files:** `src/built-in/editor/pdfEditorPane.ts`, `src/built-in/editor/pdfEditorPane.css`, `src/built-in/editor/pdfEditorInput.ts`, `index.html`
- **Commit:** `577969b`

---

## Capability 9 — Editor Tab Drag-and-Drop Overhaul *(Beyond Original Scope)*

### Capability Description
Overhaul the editor tab DnD system to achieve VS Code parity across insertion targeting, visual feedback, cross-group drops, scroll-on-drag, and area restriction. Fixes 8 of 10 identified VS Code DnD parity gaps.

### Goals
- Left/right half detection on tabs for precise insertion position
- Thin insertion-line indicator (CSS `::before`/`::after`) between tabs instead of whole-tab highlight
- Cross-group drops resolved by `inputId` instead of stale `editorIndex`
- Tab overflow scrollable with scroll-on-drag near edges
- Editor drop overlay switches between groups during drag
- Drops restricted to the editor area only — sidebar/panel reject editor-tab drags

### Implementation Summary

**Task 9.1 — VS Code Parity DnD** ✅
- Left/right half detection on tabs for precise insertion position
- Thin insertion line indicator between tabs matching VS Code's visual feedback
- Tab bar wrapper accepts drops in gap area (append to end)
- Custom drag image showing editor label via `setDragImage()`
- Tab overflow scrollable (`overflow-x: auto`) with scroll-on-drag near edges
- Cross-group drop resolves by `inputId` instead of stale `editorIndex`
- `EditorDropTarget` switches overlay between groups during drag
- Empty groups accept drops on their tab bar area
- All drop indicators cleared on `dragend` for clean state
- **Files:** `src/editor/editorDropTarget.ts`, `src/editor/editorGroupView.ts`, `src/parts/editorPart.ts`, `src/workbench.css`
- **Commit:** `a7b6e41`

**Task 9.2 — Editor Area Restriction** ✅
- Tab drops only snap to actual tabs (before/after), not gap area
- Editor drop overlay dismisses when cursor leaves editor container (document-level `dragover` bounds check)
- View container tabs reject editor-tab drags (MIME type guard)
- Editor group container uses CSS isolation to contain overlay `z-index`
- Removed debug logging and DevTools auto-open
- **Files:** `src/editor/editorDropTarget.ts`, `src/editor/editorGroupView.ts`, `src/views/viewContainer.ts`, `src/workbench.css`
- **Commit:** `1204d46`

---

## Capability 10 — Breadcrumbs Navigation Bar *(Beyond Original Scope)*

### Capability Description
Add a breadcrumbs navigation bar below the editor tab bar, replicating VS Code's breadcrumb trail that shows the file path from workspace root to the active file. Includes a reusable `BreadcrumbsWidget` UI component and a feature-level `BreadcrumbsBar` controller.

### Goals
- Path segments from workspace root to active file, clickable and keyboard-navigable
- 22 px fixed height matching VS Code's `BreadcrumbsControl.HEIGHT`
- Chevron separators, folder icons, focus/selection states
- Auto-hides when editor has no URI (e.g., welcome tab)
- Horizontal scrollbar for long paths

### Implementation Summary

**Task 10.1 — BreadcrumbsWidget** ✅
- Reusable UI component with items, separators, keyboard navigation, focus/select tracking, and horizontal scrollbar
- Mirrors VS Code's `breadcrumbsWidget.ts` architecture
- **Files:** `src/ui/breadcrumbs.ts`, `src/ui/index.ts`
- **Commit:** `db393cc`

**Task 10.2 — BreadcrumbsBar** ✅
- Feature-level controller building path segments from file URI to workspace root
- 22 px fixed height matching VS Code's `BreadcrumbsControl.HEIGHT`
- Workspace folder wiring through `editorPart` → `workbench` for longest-prefix workspace root detection
- **Files:** `src/editor/breadcrumbsBar.ts`, `src/parts/editorPart.ts`, `src/workbench/workbench.ts`
- **Commit:** `db393cc`

**Task 10.3 — Editor Group Integration** ✅
- Breadcrumbs bar inserted between tab bar and pane container in `editorGroupView`
- Updates on active editor change, auto-hides when editor has no URI
- Full CSS styling with focus/selection states, chevron separators, folder icons, and thin scrollbar
- **Files:** `src/editor/editorGroupView.ts`, `src/workbench.css`
- **Commit:** `db393cc`

---

## Capability 11 — Tab Context Menu *(Beyond Original Scope)*

### Capability Description
Add a right-click context menu on editor tabs matching VS Code's `MenuId.EditorTitleContext` layout, with close actions, clipboard operations, and Explorer reveal.

### Goals
- Grouped context menu actions matching VS Code's layout
- Bulk close operations: Close Others, Close to the Right, Close Saved, Close All
- Clipboard operations: Copy Path, Copy Relative Path
- Reveal in Explorer integration
- Disabled states matching VS Code (e.g., Close Others disabled on single tab)

### Implementation Summary

**Task 11.1 — EditorGroupModel Bulk Close Methods** ✅
- Added `closeOthers()`, `closeToTheRight()`, `closeSaved()` to `EditorGroupModel`
- Matches VS Code's tab context menu command set
- **Files:** `src/editor/editorGroupModel.ts`
- **Commit:** `ae77932`

**Task 11.2 — Tab Context Menu UI** ✅
- `EditorGroupView._showTabContextMenu()` builds `IContextMenuItem[]` with grouped actions:
  - **Close group:** Close, Close Others, Close to the Right, Close Saved, Close All
  - **Clipboard group:** Copy Path, Copy Relative Path (via `navigator.clipboard`)
  - **Explorer group:** Reveal in Explorer (fires command via `editorPart` event)
- Disabled states: Close Others disabled when single tab, Close to the Right disabled for last tab
- Groups match VS Code's `MenuId.EditorTitleContext` layout
- **Files:** `src/editor/editorGroupView.ts`, `src/parts/editorPart.ts`, `src/workbench/workbench.ts`
- **Commit:** `ae77932`

---

## Implementation Order

The capabilities were implemented in this order:

```
Capability 1 (Color Registry)                        ← bafc2f1
    ↓
Capability 2 (Theme Data + Dark Modern JSON)          ← bafc2f1
    ↓
Capability 3 (Theme Service)                          ← bafc2f1
    ↓
Capability 4 (CSS Migration)                          ← bafc2f1
    ↓
Capability 5 (Tool API Extension)                     ← bafc2f1
    ↓
Capability 6 (Visual Polish + Pixel Parity)           ← 91ae839, a822a6d, c94d7bf, fe2d1c4, c1581b8
    ↓
Capability 7 (Editor Splitting + Group Management)    ← d3052c4, d1b6a06, 01898c6, 500c95a
    ↓
Capability 8 (Format Readers + Markdown Preview)      ← 577969b
    ↓
Capability 9 (DnD Overhaul)                           ← a7b6e41, 1204d46
    ↓
Capability 10 (Breadcrumbs Navigation Bar)            ← db393cc
    ↓
Capability 11 (Tab Context Menu)                      ← ae77932
```

Capabilities 1–5 were the originally planned scope. Capabilities 6–11 emerged during implementation as natural extensions to close remaining VS Code parity gaps revealed by visual testing.

---

## Commit History

| # | SHA | Type | Summary |
|---|-----|------|---------|
| 1 | `bafc2f1` | feat | Theming infrastructure — color registry, theme service, CSS migration, tool API (Caps 1–5) |
| 2 | `91ae839` | fix | Correct Dark Modern colors + replace emoji icons with SVG codicons |
| 3 | `a822a6d` | fix | SVG tools icon, border alignment, Open Editors cleanup |
| 4 | `c94d7bf` | fix | Eliminate sash gap between panes with negative margins |
| 5 | `fe2d1c4` | fix | Active tab seamlessly connects to editor, VS Code parity |
| 6 | `c1581b8` | fix | Add border-bottom to titlebar |
| 7 | `d3052c4` | fix | Clean up editor toolbar: remove redundant close button, SVG split icon |
| 8 | `d1b6a06` | feat | Align editor splitting logic with VS Code architecture |
| 9 | `01898c6` | fix | Add GROUP headers to Open Editors when multiple groups exist |
| 10 | `500c95a` | fix | Auto-close empty groups when last editor is closed |
| 11 | `577969b` | feat | Format readers + markdown live preview |
| 12 | `a7b6e41` | fix | VS Code parity for editor tab drag-and-drop |
| 13 | `1204d46` | fix | Restrict editor tab DnD to editor area only |
| 14 | `db393cc` | feat | Add breadcrumbs navigation bar (VS Code parity) |
| 15 | `ae77932` | feat | Add tab context menu (VS Code parity) |

**Stats:** 15 commits, ~50 files changed, ~5,000+ lines added

---

## Completion Criteria (Milestone-Level)

### Originally Planned (Capabilities 1–5)
- [x] All ~70+ workbench color tokens are registered in the color registry
- [x] Dark Modern theme JSON exists with complete coverage of all registered tokens
- [x] Theme service loads at startup and injects all CSS custom properties before first render
- [x] All 4 CSS files migrated to `var(--vscode-*)` with zero hardcoded colors (except `transparent`, `inherit`, `currentColor`, close button red, and placeholder semantic syntax colors)
- [x] Visual appearance matches VS Code's Dark Modern theme
- [x] `tsc --noEmit` clean, `build.mjs` clean, app launches without errors
- [x] `parallx.window.activeColorTheme` returns correct theme kind
- [x] `parallx.window.onDidChangeActiveColorTheme` fires correctly (tested by switching theme programmatically)
- [ ] Theme persistence: selected theme survives app restart *(deferred — only one theme ships in M5)*

### Visual Polish (Capability 6)
- [x] All activity bar icons are SVG codicons (no emoji)
- [x] Dark Modern color values match VS Code exactly
- [x] No visible gaps at pane junctions (sash handles overlap via negative margins)
- [x] Active tab seamlessly connects to editor content (no separator line)
- [x] Titlebar has bottom border matching VS Code
- [x] Open Editors uses text glyphs and CSS dirty indicators (no emoji)

### Editor Splitting and Groups (Capability 7)
- [x] Split size uses source view's actual dimension (not container)
- [x] New split copies the active editor from source group
- [x] `mergeGroup()`, `addGroup()`, `findGroup()` APIs available
- [x] Open Editors shows group headers when 2+ groups exist
- [x] Empty groups auto-close when last editor is closed (last group exempt)
- [x] Editor toolbar uses SVG split icon with no redundant close button

### Format Readers (Capability 8)
- [x] EditorResolverService maps extensions to editor pane types
- [x] Markdown files open in text editor with toolbar preview button
- [x] `Ctrl+K V` opens live-updating Markdown preview in split pane
- [x] Image files render with checkerboard background and zoom support
- [x] PDF files render via Chromium embed element

### DnD Overhaul (Capability 9)
- [x] Left/right half detection for precise tab insertion
- [x] Thin insertion-line indicator between tabs (not whole-tab highlight)
- [x] Cross-group drops resolve by `inputId`
- [x] Tab overflow scrollable with scroll-on-drag near edges
- [x] Drops restricted to editor area — sidebar/panel reject editor-tab drags

### Breadcrumbs (Capability 10)
- [x] Breadcrumbs bar shows file path from workspace root to active file
- [x] 22 px fixed height matching VS Code
- [x] Keyboard navigation, focus/selection states, chevron separators
- [x] Auto-hides when editor has no URI

### Tab Context Menu (Capability 11)
- [x] Right-click on tab shows grouped context menu
- [x] Close, Close Others, Close to the Right, Close Saved, Close All
- [x] Copy Path, Copy Relative Path via clipboard
- [x] Reveal in Explorer fires explorer command
- [x] Disabled states match VS Code (single tab, last tab)

### VS Code Parity Reconciliation (Capability 12)
- [x] Explorer context menu: Open to the Side, New File/Folder on file nodes, Copy Relative Path, Reveal in File Explorer, keybinding hints, root folder rename/delete protection
- [x] Ctrl+P file search: fuzzy match character highlighting, relative-path fallback matching
- [x] Electron IPC `shell:showItemInFolder` for OS file reveal

---

## Future Improvements Backlog

The following features have been identified as high-impact GUI improvements.
Items are grouped by category and ordered roughly by impact within each group.
Checked items are already implemented; unchecked items remain as future work.

### Tab & Editor UX
- [x] Tab context menu (Capability 11)
- [x] Breadcrumbs bar (Capability 10)
- [x] Tab close button on hover — Close button hidden on inactive tabs, shown on hover; dirty tabs swap dot for close on hover
- [x] Tab dirty (unsaved) indicator dot — Dot indicator on tabs with `editor-tab--dirty` class + dirty dot element
- [x] Pin tab support — Double-click to pin preview tabs; pinned tabs rendered with pin icon, prevented from preview replacement
- [x] Tab scroll buttons — Left/right chevron arrows at the edges of the tab bar when tabs overflow, with auto-hide based on scroll position

### Explorer & Navigation
- [x] File search / Go to File (Ctrl+P) — Quick-pick file opener with fuzzy name matching
- [x] Explorer context menu — New File, New Folder, Rename, Delete, Copy Path, Copy Relative Path, Reveal in File Explorer, Open to the Side
- [x] Find in Files (Ctrl+Shift+F) — A search view in the sidebar for workspace-wide text search with results list

### Editor Features
- [x] Find & Replace bar (Ctrl+F / Ctrl+H) — Inline find/replace within the active editor with match highlighting
- [ ] Go to Line (Ctrl+G) — Command to jump to a specific line number in the active editor
- [ ] Line numbers + gutter — Clickable line numbers in the text editor for selection and future breakpoint support
- [ ] Minimap — A scaled-down overview of the document on the right edge of the editor
- [ ] Word wrap toggle — Status bar button or command to toggle word wrap on/off per editor

### Layout & Panels
- [ ] Drag sash resize feedback — Highlight sashes on hover so users discover they can resize panels/sidebar
- [ ] Panel maximize/restore — Double-click panel title bar to maximize the panel to full height, double-click again to restore
- [ ] Sidebar collapse animation — Smooth animated transition when toggling sidebar visibility
- [ ] Zen Mode (Ctrl+K Z) — Hide all chrome (sidebar, panel, status bar, activity bar) to focus on the editor

### Status Bar & Feedback
- [ ] Cursor position — Status bar showing Ln X, Col Y — clickable to "Go to Line"
- [ ] Editor language indicator — Status bar item showing the file type (TypeScript, Markdown, etc.) — clickable to change language mode
- [ ] Encoding selector — Status bar item showing file encoding (UTF-8, etc.) — clickable to change
- [ ] Indentation indicator — Status bar item showing indent style/size (Spaces: 2, Tabs, etc.) — clickable to change
- [ ] Notification toasts — Slide-in notifications in the bottom-right for save confirmations, errors, tool activation feedback

### Quality of Life
- [ ] Keyboard shortcut hints — Show keybinding next to command names in menus and command palette entries
- [ ] Keyboard shortcut viewer — Dedicated UI for browsing and customizing all keybindings
- [ ] Unsaved changes indicator on window close — Prompt "You have unsaved changes" before closing the window
- [ ] Recent files / workspaces — Welcome tab showing recently opened files and folders for quick re-entry
- [ ] Settings UI — A visual settings editor (like VS Code's gear icon) instead of requiring manual JSON editing
