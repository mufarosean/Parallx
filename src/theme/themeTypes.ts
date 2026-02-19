// themeTypes.ts — central type definitions for the theme subsystem
//
// All theme-related interfaces, types, and enums live here.
// Implementation files import types from this module and re-export
// for backward compatibility.

// ─── Theme Type ──────────────────────────────────────────────────────────────

/**
 * The type of a color theme, matching VS Code's ColorSchemeType.
 */
export enum ThemeType {
  DARK = 'dark',
  LIGHT = 'light',
  HIGH_CONTRAST_DARK = 'hc-dark',
  HIGH_CONTRAST_LIGHT = 'hc-light',
}

// ─── Theme Source ────────────────────────────────────────────────────────────

/**
 * The raw structure of a theme JSON file.
 * Compatible subset of VS Code's theme format.
 */
export interface ThemeSource {
  readonly id: string;
  readonly label: string;
  readonly uiTheme: 'vs-dark' | 'vs' | 'hc-black' | 'hc-light';
  readonly colors: Record<string, string>;
}

// ─── Color Theme ─────────────────────────────────────────────────────────────

/**
 * A resolved color theme.
 */
export interface IColorTheme {
  readonly id: string;
  readonly label: string;
  readonly type: ThemeType;

  /**
   * Returns the theme's value for a color, or undefined if not specified.
   */
  getColor(colorId: string): string | undefined;
}

// ─── Theme Catalog ───────────────────────────────────────────────────────────

export interface ThemeCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly uiTheme: string;
  readonly source: ThemeSource;
}
