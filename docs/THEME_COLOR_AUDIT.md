# Parallx Theme Color Audit

> Comprehensive mapping of every surface, token, and color pathway in the Parallx workbench.
> Generated from full codebase analysis — every CSS `var(--vscode-*)` usage, every registered token,
> every runtime `getColor()` call, and every theme editor surface.

---

## How Theme Colors Reach the Screen

```
┌─────────────────────────────────────────────────────────────────────┐
│ Theme Source (JSON or working copy)                                  │
│  { "sideBar.background": "#14111a", ... }                          │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ColorThemeData.fromSource(source, colorRegistry)                    │
│  — Validates each key against IColorRegistry                        │
│  — Unknown keys → console.warn + skip                               │
│  — Builds: Map<string, string>  (only user-overridden colors)       │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ThemeService.applyTheme(theme)                                      │
│  ① _generateAndInjectCSS()                                          │
│     — Iterates ALL 119 registered tokens from colorRegistry         │
│     — For each: getColor(id) → theme Map value || registry default  │
│     — Emits: body { --vscode-sideBar-background: #14111a; ... }     │
│     — Injected as <style id="parallx-theme-colors"> in <head>      │
│  ② Sets data-vscode-theme-type="dark|light|..." on <body>          │
│  ③ Fires onDidChangeTheme event                                     │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ CSS Files consume variables                                         │
│  .part-workbench-parts-sidebar {                                    │
│    background: var(--vscode-sideBar-background);                    │
│  }                                                                  │
│  CSS var() resolves from the <style> element on body                │
└─────────────────────────────────────────────────────────────────────┘
```

**Key files in the pipeline:**
| File | Role |
|------|------|
| `src/theme/workbenchColors.ts` | Registers all 119 color tokens with defaults per theme type |
| `src/theme/themeData.ts` | `ColorThemeData.fromSource()` — parses theme JSON into Map |
| `src/services/themeService.ts` | `applyTheme()` → generates CSS vars, injects `<style>` |
| `src/theme/themeCatalog.ts` | Enumerates built-in + user themes |
| `src/theme/themes/dark-modern.json` | Default dark theme source (all colors defined) |
| `src/built-in/theme-editor/themeEditorPanel.ts` | Theme editor UI, hover preview, commit, propagation |
| `src/workbench.css` | Main layout surfaces (sidebar, titlebar, panel, etc.) |
| `electron/index.html` | Loads `dist/renderer/main.css`, theme `<style>` appended by JS |

---

## Master Token Table — All 119 Registered Tokens

Every token registered in `src/theme/workbenchColors.ts`. The "Surface/Component" column shows which CSS files consume it, and "CSS Selector" shows the primary selector using that token.

### Layout Surfaces (Backgrounds)

| Token ID | CSS Variable | Surface | CSS File(s) | Primary Selector | In Theme Editor Group | In Global Propagation |
|----------|-------------|---------|-------------|------------------|----------------------|----------------------|
| `editor.background` | `--vscode-editor-background` | Body, editor area, editor panes | workbench.css, themeEditor.css, chatWidget.css, settingsEditorPane.css, imageEditorPane.css, pdfEditorPane.css, markdownEditorPane.css, textEditorPane.css, keybindingsEditorPane.css, welcome.css, toolGallery.css, canvas.css, database.css, aiSettings.css, slider.css | `html, body`, `.part-workbench-parts-editor` | **Global** → "Background" | **Source** (propagates TO others) |
| `sideBar.background` | `--vscode-sideBar-background` | Sidebar, active activity-bar item, stacked panels | workbench.css, chatWidget.css, chatView.css, pdfEditorPane.css, aiSettings.css | `.part-workbench-parts-sidebar`, `.activity-bar-item.active` | **Sidebar** → "Background" | ← Target of `editor.background` |
| `titleBar.activeBackground` | `--vscode-titleBar-activeBackground` | Title bar | workbench.css | `.part-workbench-parts-titlebar` | **Title Bar** → "Background" | ← Target of `editor.background` |
| `titleBar.inactiveBackground` | `--vscode-titleBar-inactiveBackground` | Title bar (unfocused) | workbench.css (via JS) | `.part-workbench-parts-titlebar` (blur) | **Title Bar** → "Inactive Background" | ← Target of `editor.background` |
| `activityBar.background` | `--vscode-activityBar-background` | Activity bar | workbench.css | `.activity-bar` | **Activity Bar** → "Background" | ← Target of `editor.background` |
| `panel.background` | `--vscode-panel-background` | Bottom panel (terminal, output, diagnostics) | workbench.css, terminal.css, output.css, diagnostics.css, indexingLog.css | `.part-workbench-parts-panel`, `.panel-views > .view-container` | **Panel** → "Background" | ← Target of `editor.background` |
| `statusBar.background` | `--vscode-statusBar-background` | Status bar | workbench.css, imageEditorPane.css | `.part-workbench-parts-statusbar` | **Status Bar** → "Background" | ← Target of `editor.background` |
| `auxiliaryBar.background` | `--vscode-auxiliaryBar-background` | Secondary sidebar (right) | workbench.css | `.part-workbench-parts-auxiliarybar` | — | ← Target of `editor.background` |
| `editorGroupHeader.tabsBackground` | `--vscode-editorGroupHeader-tabsBackground` | Tab bar row | workbench.css, ui.css | `.editor-group-tabs`, `.tab-bar` | **Tabs** → "Tab Bar Background" | ← Target of `editor.background` |
| `sideBarSectionHeader.background` | `--vscode-sideBarSectionHeader-background` | Section headers in sidebar | workbench.css, pdfEditorPane.css, toolGallery.css | `.view-section-header` | **Sidebar** → "Section Header Background" | ← Target of `editor.background` |
| `editorWidget.background` | `--vscode-editorWidget-background` | Hover widgets, quick input, menus | workbench.css, ui.css, notificationService.css, chatInput.css, chatWidget.css, database.css, dropdown.css, iconPicker.css, toolGallery.css, menuContribution.css | `.quick-input`, `.hover-widget` | **Editor** → "Widget Background" | ← Target of `editor.background` |
| `notifications.background` | `--vscode-notifications-background` | Notification toasts | workbench.css, themeEditor.css | `.notification-toast` | **Notifications** → "Background" | ← Target of `editor.background` |
| `menu.background` | `--vscode-menu-background` | Context menus, dropdowns | workbench.css, ui.css, chatWidget.css, chatTokenStatusBar.css, canvas.css, pdfEditorPane.css, themeEditor.css | `.menu-popup` | **Menus** → "Background" | ← Target of `editor.background` |
| `breadcrumb.background` | `--vscode-breadcrumb-background` | Breadcrumb bar | workbench.css | `.breadcrumb-bar` | — | ← Target of `editor.background` |
| `input.background` | `--vscode-input-background` | All input fields | workbench.css, ui.css, aiSettings.css, chatInput.css, chatWidget.css, database.css, dropdown.css, explorer.css, iconPicker.css, keybindingsEditorPane.css, notificationService.css, pdfEditorPane.css, settingsEditorPane.css, textarea.css, slider.css, segmentedControl.css, themeEditor.css, toggle.css, toolGallery.css | `input, textarea, .input` | **Buttons & Inputs** → "Input Background" | ← Target of `editor.background` |
| `quickInput.background` | `--vscode-quickInput-background` | Command palette | workbench.css | `.quick-input` | — | — |
| `tab.activeBackground` | `--vscode-tab-activeBackground` | Active editor tab | ui.css | `.tab.active` | **Tabs** → "Active Tab" | ← Target of `editor.background` |
| `tab.inactiveBackground` | `--vscode-tab-inactiveBackground` | Inactive editor tabs | ui.css | `.tab:not(.active)` | **Tabs** → "Inactive Tab" | ← Target of `editor.background` |
| `tab.hoverBackground` | `--vscode-tab-hoverBackground` | Tab hover state | ui.css | `.tab:hover` | **Tabs** → "Tab Hover" | ← Target of `editor.background` |
| `button.secondaryBackground` | `--vscode-button-secondaryBackground` | Secondary buttons | ui.css, notificationService.css, chatWidget.css, toolGallery.css | `.btn-secondary` | **Buttons & Inputs** → "Secondary Button" | ← Target of `editor.background` |

### Layout Surfaces (Foregrounds)

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group | In Global Propagation |
|----------|-------------|---------|-------------|----------------------|----------------------|
| `foreground` | `--vscode-foreground` | Body text, default text color | workbench.css | **Global** → "Text & Icon Color" | **Source** (propagates TO others) |
| `editor.foreground` | `--vscode-editor-foreground` | Editor text content | workbench.css, chatWidget.css, canvas.css, keybindingsEditorPane.css, markdownEditorPane.css, settingsEditorPane.css, textEditorPane.css | **Editor** → "Text Color" | ← Target of `foreground` |
| `sideBar.foreground` | `--vscode-sideBar-foreground` | Sidebar text | workbench.css, chatView.css | **Sidebar** → "Text Color" | ← Target of `foreground` |
| `sideBarTitle.foreground` | `--vscode-sideBarTitle-foreground` | Sidebar title text | workbench.css | **Sidebar** → "Title Text" | ← Target of `foreground` |
| `sideBarSectionHeader.foreground` | `--vscode-sideBarSectionHeader-foreground` | Section header text | workbench.css, explorer.css, pdfEditorPane.css, chatWidget.css, toolGallery.css | **Sidebar** → "Section Header Text" | ← Target of `foreground` |
| `titleBar.activeForeground` | `--vscode-titleBar-activeForeground` | Title bar text | workbench.css | **Title Bar** → "Text Color" | ← Target of `foreground` |
| `titleBar.inactiveForeground` | `--vscode-titleBar-inactiveForeground` | Title bar inactive text | workbench.css | **Title Bar** → "Inactive Text" | ← Target of `descriptionForeground` |
| `panelTitle.activeForeground` | `--vscode-panelTitle-activeForeground` | Active panel tab | workbench.css | **Panel** → "Active Tab Text" | ← Target of `foreground` |
| `panelTitle.inactiveForeground` | `--vscode-panelTitle-inactiveForeground` | Inactive panel tab | workbench.css | **Panel** → "Inactive Tab Text" | ← Target of `descriptionForeground` |
| `tab.activeForeground` | `--vscode-tab-activeForeground` | Active tab text | ui.css | **Tabs** → "Active Tab Text" | ← Target of `foreground` |
| `tab.inactiveForeground` | `--vscode-tab-inactiveForeground` | Inactive tab text | ui.css, workbench.css | **Tabs** → "Inactive Tab Text" | ← Target of `descriptionForeground` |
| `editorWidget.foreground` | `--vscode-editorWidget-foreground` | Widget text | workbench.css, ui.css | **Editor** → "Widget Text" | ← Target of `foreground` |
| `menu.foreground` | `--vscode-menu-foreground` | Menu text | workbench.css, ui.css, chatWidget.css, pdfEditorPane.css | **Menus** → "Text Color" | ← Target of `foreground` |
| `notifications.foreground` | `--vscode-notifications-foreground` | Notification text | workbench.css, themeEditor.css | **Notifications** → "Text" | ← Target of `foreground` |
| `input.foreground` | `--vscode-input-foreground` | Input text | workbench.css, ui.css, aiSettings.css, chatInput.css, chatWidget.css, database.css, dropdown.css, explorer.css, iconPicker.css, keybindingsEditorPane.css, notificationService.css, pdfEditorPane.css, settingsEditorPane.css, textarea.css, themeEditor.css, toolGallery.css | **Buttons & Inputs** → "Input Text" | ← Target of `foreground` |
| `button.secondaryForeground` | `--vscode-button-secondaryForeground` | Secondary button text | ui.css, notificationService.css, chatWidget.css, toolGallery.css | **Buttons & Inputs** → "Secondary Button Text" | ← Target of `foreground` |
| `statusBar.foreground` | `--vscode-statusBar-foreground` | Status bar text | workbench.css, imageEditorPane.css, textEditorPane.css | **Status Bar** → "Text & Icons" | — |
| `activityBar.foreground` | `--vscode-activityBar-foreground` | Active activity bar icon | workbench.css | **Activity Bar** → "Active Icon" | ← Target of `icon.foreground` |
| `activityBar.inactiveForeground` | `--vscode-activityBar-inactiveForeground` | Inactive activity bar icon | workbench.css | **Activity Bar** → "Inactive Icon" | ← Target of `descriptionForeground` |

### Accent / Focus

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group | In Global Propagation |
|----------|-------------|---------|-------------|----------------------|----------------------|
| `focusBorder` | `--vscode-focusBorder` | Focus outlines globally | workbench.css | **Global** → "Accent / Focus Color" | **Source** (propagates TO others) |
| `activityBar.activeBorder` | `--vscode-activityBar-activeBorder` | Active activity bar indicator | workbench.css | **Activity Bar** → "Active Indicator" | ← Target of `focusBorder` |
| `tab.activeBorderTop` | `--vscode-tab-activeBorderTop` | Active tab accent line | ui.css | **Tabs** → "Active Tab Accent" | ← Target of `focusBorder` |
| `panelTitle.activeBorder` | `--vscode-panelTitle-activeBorder` | Active panel tab indicator | workbench.css | **Panel** → "Active Tab Indicator" | ← Target of `focusBorder` |
| `list.focusOutline` | `--vscode-list-focusOutline` | List focus outline | workbench.css | **Sidebar** → "Focus Outline" | ← Target of `focusBorder` |
| `sash.hoverBorder` | `--vscode-sash-hoverBorder` | Resize handle hover | workbench.css, chatWidget.css, pdfEditorPane.css | — | ← Target of `focusBorder` |
| `button.background` | `--vscode-button-background` | Primary buttons | ui.css, aiSettings.css, chatInput.css, chatWidget.css, database.css, notificationService.css, settingsEditorPane.css, slider.css, themeEditor.css, toggle.css, toolGallery.css | **Accent Colors** → "Primary Button" | — |
| `button.foreground` | `--vscode-button-foreground` | Primary button text | ui.css, aiSettings.css, chatInput.css, chatWidget.css, database.css, notificationService.css, settingsEditorPane.css, themeEditor.css, toggle.css, toolGallery.css | **Buttons & Inputs** → "Button Text" | — |
| `button.hoverBackground` | `--vscode-button-hoverBackground` | Primary button hover | ui.css, aiSettings.css, chatInput.css, chatWidget.css, database.css, notificationService.css, settingsEditorPane.css, themeEditor.css, toolGallery.css | **Buttons & Inputs** → "Button Hover" | — |
| `textLink.foreground` | `--vscode-textLink-foreground` | Hyperlinks | workbench.css, aiSettings.css, chatInput.css, chatWidget.css, explorer.css, markdownEditorPane.css, toolGallery.css, welcome.css | **Accent Colors** → "Link Color" | — |
| `textLink.activeForeground` | `--vscode-textLink-activeForeground` | Link hover state | canvas.css, chatWidget.css, explorer.css | — | — |

### Borders

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `sideBar.border` | `--vscode-sideBar-border` | Sidebar right border | workbench.css | **Sidebar** → "Border" |
| `titleBar.border` | `--vscode-titleBar-border` | Title bar bottom border | workbench.css | **Title Bar** → "Border" |
| `activityBar.border` | `--vscode-activityBar-border` | Activity bar right shadow | workbench.css | **Activity Bar** → "Border" |
| `panel.border` | `--vscode-panel-border` | Panel top border | workbench.css, diagnostics.css, indexingLog.css, output.css, terminal.css, themeEditor.css, welcome.css, toolGallery.css | **Panel** → "Top Border" |
| `auxiliaryBar.border` | `--vscode-auxiliaryBar-border` | Auxiliary bar left border | workbench.css | — |
| `editorGroup.border` | `--vscode-editorGroup-border` | Editor split border | workbench.css, keybindingsEditorPane.css, markdownEditorPane.css, settingsEditorPane.css | — |
| `editorGroupHeader.border` | `--vscode-editorGroupHeader-border` | Tab bar bottom border | workbench.css | — |
| `editorGroupHeader.tabsBorder` | `--vscode-editorGroupHeader-tabsBorder` | Tab row border | ui.css | — |
| `editorWidget.border` | `--vscode-editorWidget-border` | Widget border | workbench.css, ui.css, chatInput.css, chatWidget.css, menuContribution.css, toolGallery.css | **Editor** → "Widget Border" |
| `sideBarSectionHeader.border` | `--vscode-sideBarSectionHeader-border` | Section header divider | workbench.css, chatWidget.css | **Sidebar** → "Section Header Border" |
| `notifications.border` | `--vscode-notifications-border` | Notification border | workbench.css | — |
| `notificationToast.border` | `--vscode-notificationToast-border` | Toast border | workbench.css | — |
| `input.border` | `--vscode-input-border` | Input field border | workbench.css, ui.css, aiSettings.css, chatInput.css, chatWidget.css, database.css, dropdown.css, keybindingsEditorPane.css, output.css, settingsEditorPane.css, textarea.css, themeEditor.css, toggle.css, toolGallery.css | **Buttons & Inputs** → "Input Border" |
| `menu.border` | `--vscode-menu-border` | Menu/dropdown border | workbench.css, ui.css, canvas.css, chatTokenStatusBar.css, chatWidget.css, pdfEditorPane.css | **Menus** → "Border" |
| `tab.border` | `--vscode-tab-border` | Tab separator | ui.css | **Tabs** → "Tab Separator" |
| `statusBar.border` | `--vscode-statusBar-border` | Status bar top border | workbench.css | — (UNREGISTERED in registry!) |
| `widget.shadow` | `--vscode-widget-shadow` | Widget drop shadows | workbench.css, ui.css, chatInput.css, chatWidget.css, database.css, dropdown.css, iconPicker.css, menuContribution.css, notificationService.css, pdfEditorPane.css | — |

### List / Selection

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `list.hoverBackground` | `--vscode-list-hoverBackground` | List item hover | workbench.css, ui.css, aiSettings.css, chatInput.css, chatWidget.css, database.css, diagnostics.css, dropdown.css, explorer.css, iconPicker.css, indexingLog.css, keybindingsEditorPane.css, menuContribution.css, pdfEditorPane.css, themeEditor.css, toolGallery.css, welcome.css | **Sidebar** → "Item Hover" |
| `list.activeSelectionBackground` | `--vscode-list-activeSelectionBackground` | Selected list item | workbench.css, aiSettings.css, chatInput.css, chatWidget.css, dropdown.css, explorer.css, pdfEditorPane.css | **Sidebar** → "Selected Item Background" |
| `list.activeSelectionForeground` | `--vscode-list-activeSelectionForeground` | Selected item text | workbench.css, aiSettings.css, chatInput.css, chatWidget.css, dropdown.css | **Sidebar** → "Selected Item Text" |
| `selection.background` | `--vscode-selection-background` | Text selection highlight | workbench.css, textEditorPane.css | **Global** → "Selection Highlight" |

### Badges

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `badge.background` | `--vscode-badge-background` | Generic badges | workbench.css, aiSettings.css, canvas.css, chatInput.css, chatWidget.css, toolGallery.css | **Accent Colors** → "Badge Background" |
| `badge.foreground` | `--vscode-badge-foreground` | Badge text | workbench.css, aiSettings.css, canvas.css, chatInput.css, chatWidget.css | **Accent Colors** → "Badge Text" |
| `activityBarBadge.background` | `--vscode-activityBarBadge-background` | Activity bar badge | workbench.css, ui.css | **Accent Colors** → "Badge Accent" |
| `activityBarBadge.foreground` | `--vscode-activityBarBadge-foreground` | Activity bar badge text | workbench.css, ui.css | — |

### Scrollbar

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `scrollbar.shadow` | `--vscode-scrollbar-shadow` | Scrollbar shadow | workbench.css | — |
| `scrollbarSlider.background` | `--vscode-scrollbarSlider-background` | Scrollbar thumb | workbench.css, chatInput.css, database.css, iconPicker.css, terminal.css, textEditorPane.css | — |
| `scrollbarSlider.hoverBackground` | `--vscode-scrollbarSlider-hoverBackground` | Scrollbar thumb hover | workbench.css, chatInput.css, textEditorPane.css | — |
| `scrollbarSlider.activeBackground` | `--vscode-scrollbarSlider-activeBackground` | Scrollbar thumb active | workbench.css, textEditorPane.css | — |

### Editor-Specific

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `editorLineNumber.foreground` | `--vscode-editorLineNumber-foreground` | Line numbers | workbench.css, chatWidget.css, textEditorPane.css | **Editor** → "Line Numbers" |
| `editorLineNumber.activeForeground` | `--vscode-editorLineNumber-activeForeground` | Active line number | textEditorPane.css | **Editor** → "Active Line Number" |
| `editor.findMatchHighlightBackground` | `--vscode-editor-findMatchHighlightBackground` | Search match highlight | workbench.css, explorer.css | **Editor** → "Find Match Highlight" |
| `editorIndentGuide.background` | `--vscode-editorIndentGuide-background` | Indent guides | textEditorPane.css | — |

### Breadcrumb

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `breadcrumb.background` | `--vscode-breadcrumb-background` | Breadcrumb bar bg | workbench.css | — |
| `breadcrumb.foreground` | `--vscode-breadcrumb-foreground` | Breadcrumb text | workbench.css | — |
| `breadcrumb.focusForeground` | `--vscode-breadcrumb-focusForeground` | Breadcrumb hover text | workbench.css | — |
| `breadcrumb.activeSelectionForeground` | `--vscode-breadcrumb-activeSelectionForeground` | Breadcrumb selected | workbench.css | — |

### Quick Input (Command Palette)

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `quickInput.background` | `--vscode-quickInput-background` | Command palette bg | workbench.css | — |
| `quickInput.foreground` | `--vscode-quickInput-foreground` | Command palette text | workbench.css | — |
| `quickInputList.focusBackground` | `--vscode-quickInputList-focusBackground` | Focused item bg | workbench.css, ui.css, notificationService.css | — |
| `quickInputList.focusForeground` | `--vscode-quickInputList-focusForeground` | Focused item text | workbench.css | — |
| `quickInputTitle.background` | `--vscode-quickInputTitle-background` | Command palette title bg | — | — |

### Input Options

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `inputOption.activeBackground` | `--vscode-inputOption-activeBackground` | Toggle active bg | workbench.css, ui.css | — |
| `inputOption.activeBorder` | `--vscode-inputOption-activeBorder` | Toggle active border | ui.css | — |
| `inputOption.activeForeground` | `--vscode-inputOption-activeForeground` | Toggle active text | workbench.css, ui.css | — |
| `input.placeholderForeground` | `--vscode-input-placeholderForeground` | Placeholder text | workbench.css, ui.css, aiSettings.css, chatInput.css, chatWidget.css, keybindingsEditorPane.css, settingsEditorPane.css, terminal.css, textarea.css, toolGallery.css | **Buttons & Inputs** → "Placeholder Text" |

### Toolbar

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `toolbar.hoverBackground` | `--vscode-toolbar-hoverBackground` | Toolbar button hover | workbench.css, ui.css, canvas.css, chatInput.css, chatWidget.css, diagnostics.css, explorer.css, indexingLog.css, output.css, pdfEditorPane.css, terminal.css, toolGallery.css | — |
| `toolbar.activeBackground` | `--vscode-toolbar-activeBackground` | Toolbar button active | ui.css, indexingLog.css, pdfEditorPane.css | — |

### Notifications

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `notificationsErrorIcon.foreground` | `--vscode-notificationsErrorIcon-foreground` | Error icon | workbench.css, diagnostics.css, indexingLog.css, notificationService.css, output.css | — |
| `notificationsWarningIcon.foreground` | `--vscode-notificationsWarningIcon-foreground` | Warning icon | workbench.css, diagnostics.css, indexingLog.css, notificationService.css, output.css | — |
| `notificationsInfoIcon.foreground` | `--vscode-notificationsInfoIcon-foreground` | Info icon | workbench.css, notificationService.css | — |
| `notificationLink.foreground` | `--vscode-notificationLink-foreground` | Notification link | — | — |

### Minimap

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `minimapSlider.hoverBackground` | `--vscode-minimapSlider-hoverBackground` | Minimap slider hover | textEditorPane.css | — |
| `minimapSlider.activeBackground` | `--vscode-minimapSlider-activeBackground` | Minimap slider active | textEditorPane.css | — |

### Miscellaneous

| Token ID | CSS Variable | Surface | CSS File(s) | In Theme Editor Group |
|----------|-------------|---------|-------------|----------------------|
| `icon.foreground` | `--vscode-icon-foreground` | Generic icons | workbench.css, canvas.css, chatWidget.css, diagnostics.css, explorer.css, iconPicker.css, terminal.css | **Global** → "Icon Color" |
| `descriptionForeground` | `--vscode-descriptionForeground` | Secondary text globally | workbench.css | **Global** → "Secondary Text" |
| `errorForeground` | `--vscode-errorForeground` | Error text | — | **Global** → "Error Color" |
| `tab.modifiedBorder` | `--vscode-tab-modifiedBorder` | Modified tab indicator | ui.css, explorer.css | — |
| `tab.activeBorder` | `--vscode-tab-activeBorder` | Active tab bottom border | — | — |
| `textBlockQuote.border` | `--vscode-textBlockQuote-border` | Blockquote border | aiSettings.css, chatWidget.css, markdownEditorPane.css | — |
| `textBlockQuote.foreground` | `--vscode-textBlockQuote-foreground` | Blockquote text | markdownEditorPane.css | — |
| `textCodeBlock.background` | `--vscode-textCodeBlock-background` | Code block bg | canvas.css, chatWidget.css, markdownEditorPane.css | — |
| `editorGroup.dropBackground` | `--vscode-editorGroup-dropBackground` | Editor drop indicator bg | workbench.css, dropOverlay.css | — |
| `editorGroup.dropBorder` | `--vscode-editorGroup-dropBorder` | Editor drop indicator border | workbench.css, dropOverlay.css | — |
| `menu.selectionBackground` | `--vscode-menu-selectionBackground` | Menu hover bg | workbench.css, ui.css, chatWidget.css, pdfEditorPane.css | **Menus** → "Hover / Selected" |
| `menu.selectionForeground` | `--vscode-menu-selectionForeground` | Menu hover text | workbench.css, ui.css, chatWidget.css, pdfEditorPane.css | **Menus** → "Selected Text" |
| `menu.separatorBackground` | `--vscode-menu-separatorBackground` | Menu divider | workbench.css, ui.css, chatTokenStatusBar.css, menuContribution.css | **Menus** → "Separator" |
| `statusBarItem.hoverBackground` | `--vscode-statusBarItem-hoverBackground` | Status bar item hover | workbench.css | **Status Bar** → "Item Hover" |
| `statusBarItem.activeBackground` | `--vscode-statusBarItem-activeBackground` | Status bar item click | workbench.css | — |
| `statusBarItem.hoverForeground` | `--vscode-statusBarItem-hoverForeground` | Status bar item hover text | workbench.css | — |
| `editorHoverWidget.background` | `--vscode-editorHoverWidget-background` | Hover tooltip bg | workbench.css | — (UNREGISTERED) |
| `editorHoverWidget.border` | `--vscode-editorHoverWidget-border` | Hover tooltip border | workbench.css | — (UNREGISTERED) |
| `editorHoverWidget.foreground` | `--vscode-editorHoverWidget-foreground` | Hover tooltip text | workbench.css | — (UNREGISTERED) |

---

## CSS Variables Used But NOT Registered (55 tokens)

These CSS variables appear in `.css` files but have NO corresponding `reg()` call in `workbenchColors.ts`.
They **will not** receive theme-injected values — they rely entirely on CSS fallbacks (e.g., `var(--vscode-foo, #default)`).

| Unregistered Token | Used In |
|---|---|
| `button.border` | chatWidget.css, settingsEditorPane.css |
| `checkbox.background` | chatInput.css |
| `debugTokenExpression.*` (5 tokens) | canvas.css |
| `diffEditor.*` (5 tokens) | chatWidget.css |
| `dropdown.background`, `.border`, `.foreground`, `.listBackground` | dropdown.css |
| `editor.findMatchBackground` | pdfEditorPane.css |
| `editor.hoverHighlightBackground` | pdfEditorPane.css |
| `editor.inactiveSelectionBackground` | chatWidget.css |
| `editor.selectionBackground` | canvas.css, database.css |
| `editorCursor.foreground` | canvas.css, chatWidget.css |
| `editorHoverWidget.background`, `.border`, `.foreground` | workbench.css |
| `editorInfo.foreground` | aiSettings.css |
| `editorWarning.foreground` | aiSettings.css, chatWidget.css, indexingLog.css, toolGallery.css |
| `gitDecoration.addedResourceForeground` | chatWidget.css |
| `gitDecoration.deletedResourceForeground` | chatWidget.css |
| `gitDecoration.modifiedResourceForeground` | chatWidget.css |
| `inputValidation.errorBackground`, `.errorBorder` | aiSettings.css, chatWidget.css, database.css, dropOverlay.css, pdfEditorPane.css, toolGallery.css |
| `inputValidation.warningBackground`, `.warningBorder` | chatWidget.css |
| `keybindingLabel.background`, `.foreground` | keybindingsEditorPane.css |
| `list.dropBackground` | canvas.css |
| `list.hoverForeground` | pdfEditorPane.css |
| `progressBar.background` | chatWidget.css |
| `statusBar.border` | workbench.css |
| `symbolIcon.functionForeground` | canvas.css |
| `terminal.ansiBlue`, `.ansiBrightWhite`, `.ansiCyan`, `.ansiGreen`, `.ansiMagenta`, `.ansiRed`, `.ansiYellow` | terminal.css |
| `terminal.foreground`, `terminalCursor.foreground` | terminal.css |
| `testing.iconFailed`, `.iconPassed` | canvas.css, chatWidget.css, diagnostics.css, indexingLog.css, toolGallery.css |
| `textBlockQuote.background` | aiSettings.css, chatWidget.css |
| `textPreformat.foreground` | chatInput.css, chatWidget.css |
| `titleBar.closeForeground` | workbench.css |
| `widget.border` | aiSettings.css, chatInput.css, database.css, dropdown.css, iconPicker.css, keybindingsEditorPane.css, segmentedControl.css, themeEditor.css |

---

## Global Propagation Map

When a **Global** section color is changed in the theme editor, these targets are cascaded:

| Global Token (Source) | Target Tokens |
|----------------------|---------------|
| `editor.background` → | `sideBar.background`, `sideBarSectionHeader.background`, `panel.background`, `editorGroupHeader.tabsBackground`, `tab.activeBackground`, `tab.hoverBackground`, `tab.inactiveBackground`, `titleBar.activeBackground`, `titleBar.inactiveBackground`, `activityBar.background`, `auxiliaryBar.background`, `statusBar.background`, `editorWidget.background`, `notifications.background`, `menu.background`, `breadcrumb.background`, `input.background`, `button.secondaryBackground` |
| `foreground` → | `editor.foreground`, `sideBar.foreground`, `sideBarTitle.foreground`, `sideBarSectionHeader.foreground`, `panelTitle.activeForeground`, `tab.activeForeground`, `titleBar.activeForeground`, `editorWidget.foreground`, `menu.foreground`, `notifications.foreground`, `input.foreground`, `button.secondaryForeground` |
| `focusBorder` → | `activityBar.activeBorder`, `tab.activeBorderTop`, `panelTitle.activeBorder`, `list.focusOutline`, `sash.hoverBorder` |
| `descriptionForeground` → | `tab.inactiveForeground`, `titleBar.inactiveForeground`, `panelTitle.inactiveForeground`, `activityBar.inactiveForeground`, `breadcrumb.foreground`, `input.placeholderForeground` |
| `icon.foreground` → | `activityBar.foreground` |
| `selection.background` → | `list.activeSelectionBackground` |

---

## Programmatic (JS) Color Access

Only two places read colors at runtime via JavaScript (everything else is pure CSS):

| File | Code | Purpose |
|------|------|---------|
| `src/services/themeService.ts` L82 | `this.getColor(reg.id)` inside `_generateAndInjectCSS()` | Generate CSS custom properties for ALL registered tokens |
| `src/built-in/theme-editor/themeEditorPanel.ts` L1211 | `this._themeService.activeTheme.getColor(colorId)` | Read current theme value for resolving editor display hex |

No layout part (sidebar, titlebar, panel, status bar, activity bar) reads colors via JS. They are 100% CSS-variable driven.

---

## Style Injection Points

| Source | Element | Where | Notes |
|--------|---------|-------|-------|
| `ThemeService._generateAndInjectCSS()` | `<style id="parallx-theme-colors">` | `<head>` | The ONE authoritative source for all `--vscode-*` CSS variables |
| `electron/index.html` | `<link rel="stylesheet" href="dist/renderer/main.css" />` | `<head>` | All CSS files bundled by esbuild; consumes the CSS variables |
| `electron/index.html` | `<style>` (inline) | `<head>` | Loading overlay only — `#parallx-loading-overlay` styling |

There is only ONE theme style injection. No competing injectors.

---

## Known Issues

### 1. Hover Preview Does NOT Propagate Global Colors
**`_startHoverPreview(colorId, hex)`** only modifies the single `colorId` in `_workingColors` and applies the theme. It does NOT run `GLOBAL_PROPAGATION`. During hover in the swatch popup, only `editor.background` changes; all other surfaces remain at their previous values. The user sees the editor/theme-editor pane turn yellow but the sidebar, titlebar, etc. stay dark — making it APPEAR that propagation doesn't work.

**`_commitColor(colorId, hex)`** DOES propagate, but only fires on swatch click or hex input change — NOT during hover. If the user evaluates the result based on hover behavior (which is the natural UX), they see broken behavior.

**Fix needed:** Add propagation to `_startHoverPreview` and `_endHoverPreview` so the user can see the global effect during hover.

### 2. 55 Unregistered Tokens
CSS files reference 55 `--vscode-*` variables that are not registered in `workbenchColors.ts`. These tokens never receive theme-injected values and rely entirely on CSS fallback values. Notably: `statusBar.border`, `editorHoverWidget.*`, `editorWarning.foreground`, all terminal ANSI colors, git decoration colors, dropdown colors, and validation colors.
