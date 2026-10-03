// themeApply.ts — switch the active VS Code base theme by id, and persist it.
//
// The --px token system skins the app chrome, but the editor / terminal /
// syntax colors come from a VS Code base theme loaded via the theme catalog.
// This is the one-liner the Appearance panel uses to flip that base theme
// (dark-modern ↔ light-modern) and remember the choice across relaunch. Factored out so the resolve→apply→persist sequence
// lives in exactly one place.

import { colorRegistry } from './colorRegistry.js';
import { designTokenRegistry } from './designTokenRegistry.js';
import { findThemeById, resolveTheme, THEME_STORAGE_KEY } from './themeCatalog.js';
import type { ColorThemeData } from './themeData.js';
import type { IStorage } from '../platform/storage.js';
import { applyAppearance, readAppearance, writeAppearance } from './pxAppearance.js';

/** Minimal surface needed to apply a theme — both ThemeService and IThemeService satisfy it. */
interface ThemeApplier {
  applyTheme(theme: ColorThemeData): void;
}

/**
 * Resolve a built-in/user theme by id, apply it, and persist the selection.
 * No-op if the id isn't found. Persistence is fire-and-forget (matches the
 * theme picker), so a slow storage write never blocks the visual switch.
 */
export function applyThemeById(
  themeId: string,
  themeService: ThemeApplier,
  globalStorage: IStorage,
): void {
  const entry = findThemeById(themeId);
  if (!entry) return;
  const td = resolveTheme(entry, colorRegistry, designTokenRegistry);
  themeService.applyTheme(td);
  void globalStorage.set(THEME_STORAGE_KEY, themeId);
  // Light or dark is stored twice: this editor theme, and the --px chrome's
  // mode (Settings › Appearance). Whatever sets the editor theme, the chrome
  // follows its kind, so the two can never disagree (the retired Ctrl+T
  // picker once set only this one and left the chrome dark).
  const mode = entry.uiTheme === 'vs' || entry.uiTheme === 'hc-light' ? 'light' : 'dark';
  const current = readAppearance();
  if (current.mode !== mode) {
    const next = { ...current, mode } as const;
    applyAppearance(next);
    writeAppearance(next);
  }
}

/**
 * The High Contrast themes (retired 2026-10-03) changed nothing on screen:
 * the --px palette paints the app and they only fed the old colour
 * registry. Someone who picked one asked for contrast, so a stored choice
 * becomes its mode with Increase Contrast on, once, and the matching editor
 * theme is stored in its place. Returns the theme id to restore.
 */
export const RETIRED_CONTRAST_THEMES: Readonly<Record<string, { mode: 'dark' | 'light'; editorTheme: string }>> = {
  'parallx-hc-dark': { mode: 'dark', editorTheme: 'parallx-dark-modern' },
  'parallx-hc-light': { mode: 'light', editorTheme: 'parallx-light-modern' },
};

export function migrateRetiredTheme(themeId: string, globalStorage: Pick<IStorage, 'set'>): string {
  const retired = RETIRED_CONTRAST_THEMES[themeId];
  if (!retired) return themeId;
  const next = { ...readAppearance(), mode: retired.mode, increaseContrast: true };
  applyAppearance(next);
  writeAppearance(next);
  void globalStorage.set(THEME_STORAGE_KEY, retired.editorTheme);
  return retired.editorTheme;
}
