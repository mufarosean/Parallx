// themeService.ts — runtime theme application service
//
// Loads a color theme, resolves all registered tokens through the color
// registry, generates CSS custom properties, and injects them as a <style>
// element. This is the runtime engine connecting theme data to visual output.
//
// VS Code reference: WorkbenchThemeService in
// src/vs/workbench/services/themes/browser/workbenchThemeService.ts

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { IColorRegistry } from '../theme/colorRegistry.js';
import type { IDesignTokenRegistry } from '../theme/designTokenRegistry.js';
import { IColorTheme, ColorThemeData } from '../theme/themeData.js';
import { $ } from '../ui/dom.js';
import type { IThemeService } from './serviceTypes.js';

// ─── Style element ID ────────────────────────────────────────────────────────

const THEME_STYLE_ID = 'parallx-theme-colors';

/**
 * M83 — VS Code → Parallx token bridge.
 *
 * The app's 38 CSS files reference `var(--vscode-*)`. Rather than edit all
 * of them, we remap the character-defining VS Code tokens to the new
 * Parallx semantic tokens (`--px-*`, defined statically in
 * src/theme/px-tokens.css). These lines are appended to the SAME generated
 * `body {}` rule, AFTER the resolved hex values, so they win the cascade
 * with no `!important`. Result: the whole app picks up the new palette and
 * re-hues with the active `--px-*` theme — without touching surface CSS.
 *
 * Only the high-impact, identity-defining tokens are bridged. Anything not
 * listed keeps its theme-resolved value. Surfaces migrate to native
 * `--px-*` over the course of M83; this bridge shrinks as they do.
 */
const THEME_VSCODE_BRIDGE: ReadonlyArray<readonly [string, string]> = [
  // Core surfaces
  ['--vscode-editor-background', 'var(--px-bg)'],
  ['--vscode-editorGroupHeader-tabsBackground', 'var(--px-bg)'],
  // Internal separators (within a surface) use the quieter --px-divider so they
  // read one step below a floating-surface outline. Co-planar workbench-part
  // edges are handled directly in CSS via --px-chrome-line (lighter still).
  ['--vscode-editorGroup-border', 'var(--px-divider)'],
  ['--vscode-editorGroupHeader-tabsBorder', 'var(--px-divider)'],
  ['--vscode-sideBar-background', 'var(--px-bg)'],
  ['--vscode-sideBar-border', 'var(--px-divider)'],
  ['--vscode-sideBarSectionHeader-background', 'var(--px-bg)'],
  ['--vscode-sideBarSectionHeader-border', 'var(--px-divider)'],
  ['--vscode-activityBar-background', 'var(--px-bg)'],
  ['--vscode-panel-background', 'var(--px-bg)'],
  ['--vscode-panel-border', 'var(--px-border)'],
  ['--vscode-titleBar-activeBackground', 'var(--px-bg)'],
  ['--vscode-titleBar-inactiveBackground', 'var(--px-bg)'],
  ['--vscode-menu-background', 'var(--px-bg-elevated)'],
  ['--vscode-editorWidget-background', 'var(--px-bg-elevated)'],
  ['--vscode-quickInput-background', 'var(--px-bg-elevated)'],
  ['--vscode-dropdown-background', 'var(--px-bg-elevated)'],
  ['--vscode-input-background', 'var(--px-bg-inset)'],

  // Text
  ['--vscode-editor-foreground', 'var(--px-text)'],
  ['--vscode-foreground', 'var(--px-text)'],
  ['--vscode-sideBar-foreground', 'var(--px-text-secondary)'],
  ['--vscode-descriptionForeground', 'var(--px-text-muted)'],
  ['--vscode-disabledForeground', 'var(--px-text-faint)'],
  ['--vscode-icon-foreground', 'var(--px-text-muted)'],

  // Tabs
  ['--vscode-tab-activeBackground', 'var(--px-bg)'],
  ['--vscode-tab-inactiveBackground', 'var(--px-bg)'],
  ['--vscode-tab-activeForeground', 'var(--px-text)'],
  ['--vscode-tab-inactiveForeground', 'var(--px-text-muted)'],
  ['--vscode-tab-border', 'var(--px-divider)'],

  // Accent / interactive
  ['--vscode-button-background', 'var(--px-accent)'],
  ['--vscode-button-hoverBackground', 'var(--px-accent-hover)'],
  ['--vscode-button-foreground', 'var(--px-text-on-accent)'],
  ['--vscode-focusBorder', 'var(--px-accent)'],
  ['--vscode-textLink-foreground', 'var(--px-accent)'],
  ['--vscode-progressBar-background', 'var(--px-accent)'],

  // Lists / selection — neutral selection, accent reserved for focus.
  ['--vscode-list-hoverBackground', 'var(--px-surface-hover)'],
  ['--vscode-list-activeSelectionBackground', 'var(--px-surface-selected)'],
  ['--vscode-list-activeSelectionForeground', 'var(--px-text)'],
  ['--vscode-list-inactiveSelectionBackground', 'var(--px-surface-active)'],

  // Inputs / borders
  ['--vscode-input-border', 'var(--px-border-strong)'],
  ['--vscode-input-foreground', 'var(--px-text)'],
  ['--vscode-input-placeholderForeground', 'var(--px-text-faint)'],
  ['--vscode-contrastBorder', 'var(--px-border)'],
  ['--vscode-widget-border', 'var(--px-border)'],

  // Signals
  ['--vscode-errorForeground', 'var(--px-danger)'],
  ['--vscode-editorError-foreground', 'var(--px-danger)'],
  ['--vscode-editorWarning-foreground', 'var(--px-warning)'],

  // Scrollbar
  ['--vscode-scrollbarSlider-background', 'rgba(var(--px-accent-rgb), 0.18)'],
  ['--vscode-scrollbarSlider-hoverBackground', 'rgba(var(--px-accent-rgb), 0.30)'],
  ['--vscode-scrollbarSlider-activeBackground', 'rgba(var(--px-accent-rgb), 0.45)'],

  // Elevation
  ['--vscode-widget-shadow', 'rgba(0, 0, 0, 0.40)'],

  // Resize sashes — a handle is neutral chrome, never brand-colored. Was
  // showing the old purple because sash-hoverBorder was unbridged.
  ['--vscode-sash-hoverBorder', 'var(--px-border-strong)'],
  ['--vscode-sash-border', 'var(--px-border)'],

  // ── Surfaces the first pass missed ──────────────────────────────────────
  // Activity bar (far-left icon rail)
  ['--vscode-activityBar-foreground', 'var(--px-text)'],
  ['--vscode-activityBar-inactiveForeground', 'var(--px-text-faint)'],
  ['--vscode-activityBar-activeBorder', 'var(--px-accent)'],
  ['--vscode-activityBar-border', 'var(--px-border)'],
  ['--vscode-activityBarBadge-background', 'var(--px-accent)'],
  ['--vscode-activityBarBadge-foreground', 'var(--px-text-on-accent)'],
  // Status bar (thin bottom bar)
  ['--vscode-statusBar-background', 'var(--px-bg)'],
  ['--vscode-statusBar-foreground', 'var(--px-text-muted)'],
  ['--vscode-statusBar-border', 'var(--px-border)'],
  ['--vscode-statusBar-noFolderBackground', 'var(--px-bg)'],
  // Generic badges (counts, etc.)
  ['--vscode-badge-background', 'var(--px-surface-active)'],
  ['--vscode-badge-foreground', 'var(--px-text)'],
  // Section / pane headers
  ['--vscode-sideBarTitle-foreground', 'var(--px-text-muted)'],
  ['--vscode-panelTitle-activeForeground', 'var(--px-text)'],
  ['--vscode-panelTitle-inactiveForeground', 'var(--px-text-muted)'],
  ['--vscode-panelTitle-activeBorder', 'var(--px-accent)'],
  // Breadcrumbs
  ['--vscode-breadcrumb-foreground', 'var(--px-text-muted)'],
  ['--vscode-breadcrumb-focusForeground', 'var(--px-text)'],
  ['--vscode-breadcrumb-background', 'var(--px-bg)'],
  // Auxiliary bar (the AI chat panel lives here) — was missed first pass,
  // so the chat panel + its "CHAT" header kept the old VS Code grays.
  ['--vscode-auxiliaryBar-background', 'var(--px-bg)'],
  ['--vscode-auxiliaryBar-foreground', 'var(--px-text-secondary)'],
  ['--vscode-auxiliaryBar-border', 'var(--px-border)'],
  ['--vscode-auxiliaryBarTitle-background', 'var(--px-bg)'],
  ['--vscode-editorGroupHeader-noTabsBackground', 'var(--px-bg)'],
  ['--vscode-editorGroupHeader-border', 'var(--px-divider)'],
  // Tab active border accent
  ['--vscode-tab-activeBorderTop', 'var(--px-accent)'],
  ['--vscode-tab-activeBorder', 'var(--px-accent)'],
  // Selection / find
  ['--vscode-selection-background', 'var(--px-accent-soft)'],
  ['--vscode-editor-selectionBackground', 'var(--px-accent-soft)'],
  // Checkbox / radio
  ['--vscode-checkbox-background', 'var(--px-bg-inset)'],
  ['--vscode-checkbox-border', 'var(--px-border-strong)'],
  // Notifications
  ['--vscode-notifications-background', 'var(--px-bg-elevated)'],
  ['--vscode-notifications-border', 'var(--px-border)'],
  // Terminal
  ['--vscode-terminal-background', 'var(--px-bg)'],
  ['--vscode-terminal-foreground', 'var(--px-text-secondary)'],
  // Secondary button
  ['--vscode-button-secondaryBackground', 'var(--px-surface-active)'],
  ['--vscode-button-secondaryForeground', 'var(--px-text)'],
  ['--vscode-button-secondaryHoverBackground', 'var(--px-surface-hover)'],
  // Text block / preformatted
  ['--vscode-textBlockQuote-background', 'var(--px-bg-inset)'],
  ['--vscode-textBlockQuote-border', 'var(--px-border-strong)'],
  ['--vscode-textCodeBlock-background', 'var(--px-bg-inset)'],

  // ── Interactive / hover / active states (so nothing flashes an old gray) ──
  ['--vscode-tab-hoverBackground', 'var(--px-surface-hover)'],
  ['--vscode-menu-selectionBackground', 'var(--px-surface-selected)'],
  ['--vscode-menu-selectionForeground', 'var(--px-text)'],
  ['--vscode-menu-separatorBackground', 'var(--px-divider)'],
  ['--vscode-menu-foreground', 'var(--px-text-secondary)'],
  ['--vscode-quickInputList-focusBackground', 'var(--px-surface-selected)'],
  ['--vscode-quickInputList-focusForeground', 'var(--px-text)'],
  ['--vscode-statusBarItem-hoverBackground', 'var(--px-surface-hover)'],
  ['--vscode-statusBarItem-activeBackground', 'var(--px-surface-active)'],
  ['--vscode-toolbar-hoverBackground', 'var(--px-surface-hover)'],
  ['--vscode-toolbar-activeBackground', 'var(--px-surface-active)'],
  ['--vscode-dropdown-listBackground', 'var(--px-bg-elevated)'],
  ['--vscode-dropdown-foreground', 'var(--px-text)'],
  ['--vscode-dropdown-border', 'var(--px-border-strong)'],
  ['--vscode-editorHoverWidget-background', 'var(--px-bg-elevated)'],
  ['--vscode-editorHoverWidget-border', 'var(--px-border)'],
  ['--vscode-inputOption-activeBackground', 'var(--px-accent-soft)'],
  ['--vscode-inputOption-activeForeground', 'var(--px-text)'],
  ['--vscode-keybindingLabel-background', 'var(--px-bg-inset)'],
  ['--vscode-keybindingLabel-foreground', 'var(--px-text-secondary)'],
  ['--vscode-keybindingLabel-border', 'var(--px-border)'],
];

/**
 * M83 — Parallx design-token (type / radius / font) refinement bridge.
 *
 * The app uses a second token namespace, `--parallx-fontSize-*` /
 * `--parallx-radius-*` / `--parallx-fontFamily-*`, ~600 references across
 * the CSS. We remap those to the refined M83 scales (six-step type ladder,
 * consistent radii) so typography and rounding transform app-wide — the
 * structural change beyond color. Appended after the design-token lines so
 * these win.
 */
const THEME_PX_DESIGN_BRIDGE: ReadonlyArray<readonly [string, string]> = [
  // Type ladder — nudge toward the refined six-step scale. 10px micro-text
  // bumps to 11 (Notion/Obsidian floor); section headers grow slightly.
  ['--parallx-fontSize-xs',   'var(--px-text-xs)'],    // 10 → 11
  ['--parallx-fontSize-sm',   'var(--px-text-sm)'],    // 11 → 12
  ['--parallx-fontSize-base', 'var(--px-text-base)'],  // 12 → 13
  ['--parallx-fontSize-md',   'var(--px-text-base)'],  // 13 → 13 (collapse onto base)
  ['--parallx-fontSize-lg',   'var(--px-text-md)'],    // 14 → 15
  ['--parallx-fontSize-xl',   'var(--px-text-lg)'],    // 16 → 18
  // 2xl/3xl (canvas headings) left near current — refined lightly.
  ['--parallx-fontSize-2xl',  '24px'],
  ['--parallx-fontSize-3xl',  '34px'],

  // Radius — modest, consistent step up from the sharp 3/6/8 toward a
  // deliberate 5/8/10. Obsidian-leaning (not bubbly).
  ['--parallx-radius-sm', 'var(--px-radius-sm)'],   // 3 → 4
  ['--parallx-radius-md', 'var(--px-radius-md)'],   // 6 → 6
  ['--parallx-radius-lg', 'var(--px-radius-lg)'],   // 8 → 10
  ['--parallx-radius-xl', 'var(--px-radius-xl)'],   // 12 → 14
  ['--parallx-radius-full', 'var(--px-radius-full)'],

  // UI font — a refined modern sans stack. Inter if present, else the OS
  // variable sans (Segoe UI Variable on Win, SF on macOS) — both excellent.
  ['--parallx-fontFamily-ui',
   "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"],
];

// ─── ThemeService Implementation ─────────────────────────────────────────────

/**
 * Loads, resolves, and injects color themes as CSS custom properties.
 *
 * VS Code reference: WorkbenchThemeService.applyTheme()
 */
export class ThemeService extends Disposable implements IThemeService {
  private _activeTheme: ColorThemeData;
  private readonly _registry: IColorRegistry;
  private readonly _designTokenRegistry: IDesignTokenRegistry | undefined;
  private readonly _onDidChangeTheme = this._register(new Emitter<IColorTheme>());
  readonly onDidChangeTheme: Event<IColorTheme> = this._onDidChangeTheme.event;
  private _styleElement: HTMLStyleElement | null = null;

  constructor(registry: IColorRegistry, initialTheme: ColorThemeData, designTokenRegistry?: IDesignTokenRegistry) {
    super();
    this._registry = registry;
    this._designTokenRegistry = designTokenRegistry;
    this._activeTheme = initialTheme;
  }

  get activeTheme(): IColorTheme {
    return this._activeTheme;
  }

  getColor(colorId: string): string {
    // Theme value takes priority
    const themeColor = this._activeTheme.getColor(colorId);
    if (themeColor !== undefined) {
      return themeColor;
    }
    // Fall back to registry default for the theme type
    const defaultColor = this._registry.resolveDefault(colorId, this._activeTheme.type);
    if (defaultColor !== undefined) {
      return defaultColor;
    }
    // Ultimate fallback
    return 'inherit';
  }

  applyTheme(theme: ColorThemeData): void {
    this._activeTheme = theme;
    this._generateAndInjectCSS();
    this._setThemeTypeAttribute();
    this._onDidChangeTheme.fire(theme);
  }

  /**
   * Generate CSS custom properties for all registered colors and inject
   * them as a <style> element in <head>.
   *
   * VS Code reference: applyTheme() → generates CSS rule on <body>
   */
  private _generateAndInjectCSS(): void {
    const colors = this._registry.getRegisteredColors();
    const lines: string[] = [];

    for (const reg of colors) {
      const varName = this._registry.asCssVariableName(reg.id);
      const value = this.getColor(reg.id);
      lines.push(`  ${varName}: ${value};`);
    }

    // Design tokens (fonts, radius, spacing, shadows)
    if (this._designTokenRegistry) {
      const tokens = this._designTokenRegistry.getRegisteredTokens();
      for (const reg of tokens) {
        const varName = this._designTokenRegistry.asCssVariableName(reg.id);
        const themeValue = this._activeTheme.getDesignToken(reg.id);
        const value = themeValue ?? this._designTokenRegistry.resolveDefault(reg.id, this._activeTheme.type) ?? 'inherit';
        lines.push(`  ${varName}: ${value};`);
      }
    }

    // M83 bridge — appended LAST inside the same body{} rule so these
    // remaps override the resolved hex values above (later wins on equal
    // specificity). This is what makes the whole app pick up the --px-*
    // palette without editing surface CSS.
    for (const [vscodeVar, pxRef] of THEME_VSCODE_BRIDGE) {
      lines.push(`  ${vscodeVar}: ${pxRef};`);
    }
    for (const [parallxVar, pxRef] of THEME_PX_DESIGN_BRIDGE) {
      lines.push(`  ${parallxVar}: ${pxRef};`);
    }

    const css = `body {\n${lines.join('\n')}\n}`;

    // Create or update the style element
    if (!this._styleElement) {
      this._styleElement = $('style');
      this._styleElement.id = THEME_STYLE_ID;
      this._styleElement.setAttribute('type', 'text/css');
      document.head.appendChild(this._styleElement);
    }

    this._styleElement.textContent = css;
  }

  /**
   * Set data-vscode-theme-type on <body> for CSS selectors.
   * e.g., body[data-vscode-theme-type="dark"]
   */
  private _setThemeTypeAttribute(): void {
    document.body.setAttribute('data-vscode-theme-type', this._activeTheme.type);
  }

  override dispose(): void {
    if (this._styleElement && this._styleElement.parentNode) {
      this._styleElement.parentNode.removeChild(this._styleElement);
      this._styleElement = null;
    }
    super.dispose();
  }
}
