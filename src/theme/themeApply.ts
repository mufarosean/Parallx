// themeApply.ts — switch the active VS Code base theme by id, and persist it.
//
// The --px token system skins the app chrome, but the editor / terminal /
// syntax colors come from a VS Code base theme loaded via the theme catalog.
// This is the one-liner both the theme picker and the Appearance panel use to
// flip that base theme (e.g. dark-modern ↔ light-modern) and remember the
// choice across relaunch. Factored out so the resolve→apply→persist sequence
// lives in exactly one place.

import { colorRegistry } from './colorRegistry.js';
import { designTokenRegistry } from './designTokenRegistry.js';
import { findThemeById, resolveTheme, THEME_STORAGE_KEY } from './themeCatalog.js';
import type { ColorThemeData } from './themeData.js';
import type { IStorage } from '../platform/storage.js';

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
}
