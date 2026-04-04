// themeCatalog.ts — enumerates all built-in themes
//
// VS Code reference: src/vs/workbench/services/themes/browser/colorThemeStore.ts
// Provides a catalog of available color themes for the theme picker.

import { ColorThemeData } from './themeData.js';
import type { ThemeSource } from './themeTypes.js';
import type { ThemeCatalogEntry } from './themeTypes.js';
export type { ThemeCatalogEntry } from './themeTypes.js';
import { IColorRegistry } from './colorRegistry.js';
import type { IDesignTokenRegistry } from './designTokenRegistry.js';
import type { IStorage } from '../platform/storage.js';

// ─── Static imports of built-in theme JSON ───────────────────────────────────

import darkModernTheme from './themes/dark-modern.json';
import lightModernTheme from './themes/light-modern.json';
import hcDarkTheme from './themes/hc-dark.json';
import hcLightTheme from './themes/hc-light.json';

// ─── Built-in themes ─────────────────────────────────────────────────────────

const BUILTIN_THEMES: ThemeCatalogEntry[] = [
  { id: darkModernTheme.id, label: darkModernTheme.label, uiTheme: darkModernTheme.uiTheme, source: darkModernTheme as ThemeSource },
  { id: lightModernTheme.id, label: lightModernTheme.label, uiTheme: lightModernTheme.uiTheme, source: lightModernTheme as ThemeSource },
  { id: hcDarkTheme.id, label: hcDarkTheme.label, uiTheme: hcDarkTheme.uiTheme, source: hcDarkTheme as ThemeSource },
  { id: hcLightTheme.id, label: hcLightTheme.label, uiTheme: hcLightTheme.uiTheme, source: hcLightTheme as ThemeSource },
];

// ─── Theme catalog API ───────────────────────────────────────────────────────

/** localStorage key for user-created themes. */
export const USER_THEMES_KEY = 'parallx.userThemes';

// ─── User theme cache (M53 D3) ──────────────────────────────────────────────

/** Module-level cache for user themes, populated at startup from file-backed storage. */
let _userThemesCache: ThemeCatalogEntry[] | undefined;

/**
 * Initialize the user themes cache from storage.
 * Called once during workbench Phase 1 after global storage is ready.
 */
export async function initUserThemesCache(globalStorage: IStorage): Promise<void> {
  try {
    const raw = await globalStorage.get(USER_THEMES_KEY);
    if (!raw) { _userThemesCache = []; return; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { _userThemesCache = []; return; }
    _userThemesCache = parsed
      .filter(
        (t: unknown): t is ThemeSource =>
          typeof t === 'object' && t !== null &&
          typeof (t as ThemeSource).id === 'string' &&
          typeof (t as ThemeSource).label === 'string' &&
          typeof (t as ThemeSource).colors === 'object',
      )
      .map((source: ThemeSource) => ({
        id: source.id,
        label: source.label,
        uiTheme: source.uiTheme,
        source,
      }));
  } catch {
    _userThemesCache = [];
  }
}

/**
 * Update the user themes cache when themes are modified at runtime.
 * Call this after writing user themes to storage.
 */
export function updateUserThemesCache(themes: ThemeSource[]): void {
  _userThemesCache = themes
    .filter(
      (t): t is ThemeSource =>
        typeof t === 'object' && t !== null &&
        typeof t.id === 'string' &&
        typeof t.label === 'string' &&
        typeof t.colors === 'object',
    )
    .map((source) => ({
      id: source.id,
      label: source.label,
      uiTheme: source.uiTheme,
      source,
    }));
}

/**
 * Load user themes from cache (populated at startup).
 */
function loadUserThemes(): ThemeCatalogEntry[] {
  return _userThemesCache ?? [];
}

/**
 * Return raw user theme sources from cache.
 * Used by ThemeEditorPanel for save/load operations.
 */
export function getUserThemeSources(): ThemeSource[] {
  return (_userThemesCache ?? []).map(e => e.source);
}

/**
 * Returns all available theme catalog entries (built-in + user themes).
 */
export function getAvailableThemes(): readonly ThemeCatalogEntry[] {
  return [...BUILTIN_THEMES, ...loadUserThemes()];
}

/**
 * Resolve a catalog entry to a ColorThemeData ready for application.
 */
export function resolveTheme(entry: ThemeCatalogEntry, registry: IColorRegistry, designTokenRegistry?: IDesignTokenRegistry): ColorThemeData {
  return ColorThemeData.fromSource(entry.source, registry, designTokenRegistry);
}

/**
 * Look up a theme by ID. Returns undefined if not found.
 */
export function findThemeById(themeId: string): ThemeCatalogEntry | undefined {
  return getAvailableThemes().find(t => t.id === themeId);
}

/** The default theme ID for fresh installations. */
export const DEFAULT_THEME_ID = 'parallx-dark-modern';

/** localStorage key for persisted theme selection. */
export const THEME_STORAGE_KEY = 'parallx.colorTheme';
