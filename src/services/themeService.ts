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
import { IColorTheme, ColorThemeData } from '../theme/themeData.js';

// ─── Style element ID ────────────────────────────────────────────────────────

const THEME_STYLE_ID = 'parallx-theme-colors';

// ─── IThemeService ───────────────────────────────────────────────────────────

/**
 * Service interface for theme management.
 */
export interface IThemeService {
  /** The currently applied color theme. */
  readonly activeTheme: IColorTheme;

  /** Fired when the active theme changes. */
  readonly onDidChangeTheme: Event<IColorTheme>;

  /**
   * Resolves a color from the active theme, falling back to the
   * registry default if the theme does not specify it.
   */
  getColor(colorId: string): string;

  /**
   * Apply a theme by providing its parsed data.
   * Generates and injects CSS custom properties.
   */
  applyTheme(theme: ColorThemeData): void;
}

// ─── ThemeService Implementation ─────────────────────────────────────────────

/**
 * Loads, resolves, and injects color themes as CSS custom properties.
 *
 * VS Code reference: WorkbenchThemeService.applyTheme()
 */
export class ThemeService extends Disposable implements IThemeService {
  private _activeTheme: ColorThemeData;
  private readonly _registry: IColorRegistry;
  private readonly _onDidChangeTheme = this._register(new Emitter<IColorTheme>());
  readonly onDidChangeTheme: Event<IColorTheme> = this._onDidChangeTheme.event;
  private _styleElement: HTMLStyleElement | null = null;

  constructor(registry: IColorRegistry, initialTheme: ColorThemeData) {
    super();
    this._registry = registry;
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

    const css = `body {\n${lines.join('\n')}\n}`;

    // Create or update the style element
    if (!this._styleElement) {
      this._styleElement = document.createElement('style');
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
