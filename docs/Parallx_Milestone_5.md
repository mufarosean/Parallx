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

**Included**
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

**Excluded**
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

## Implementation Order

The capabilities must be implemented in this order due to dependencies:

```
Capability 1 (Color Registry)
    ↓
Capability 2 (Theme Data + Dark Modern JSON)
    ↓
Capability 3 (Theme Service)
    ↓
Capability 4 (CSS Migration)  ←  Can partially overlap with Cap 3
    ↓
Capability 5 (Tool API Extension)
```

Each capability is independently committable — the app works after each commit (though colors are still hardcoded until Capability 4 completes).

---

## Completion Criteria (Milestone-Level)

- [x] All ~70+ workbench color tokens are registered in the color registry
- [x] Dark Modern theme JSON exists with complete coverage of all registered tokens
- [x] Theme service loads at startup and injects all CSS custom properties before first render
- [x] All 4 CSS files migrated to `var(--vscode-*)` with zero hardcoded colors (except `transparent`, `inherit`, `currentColor`, close button red, and placeholder semantic syntax colors)
- [x] Visual appearance matches VS Code's Dark Modern theme
- [x] `tsc --noEmit` clean, `build.mjs` clean, app launches without errors
- [x] `parallx.window.activeColorTheme` returns correct theme kind
- [x] `parallx.window.onDidChangeActiveColorTheme` fires correctly (tested by switching theme programmatically)
- [ ] Theme persistence: selected theme survives app restart *(deferred — only one theme ships in M5)*
- [ ] No regression in any M1–M4 functionality *(requires visual launch test)*
