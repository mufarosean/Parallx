// systemMode.ts — Settings › Appearance › Mode › Match System.
//
// While the appearance follows the computer, its light or dark setting
// drives the mode, live: the --px chrome and the code editor's base theme
// switch together, as they do when Dark or Light is chosen by hand.
// Started once by the workbench, after the theme service exists.

import type { IDisposable } from '../platform/lifecycle.js';
import type { IStorage } from '../platform/storage.js';
import type { ColorThemeData } from './themeData.js';
import { EDITOR_THEME_FOR_MODE, applyThemeById } from './themeApply.js';
import { applyAppearance, readAppearance, systemPrefersDark, writeAppearance } from './pxAppearance.js';

interface ThemeApplier { applyTheme(theme: ColorThemeData): void }

/**
 * Bring the stored mode and the editor theme in line with the computer, when
 * following it. Returns true when anything changed.
 */
export function syncSystemMode(themeService: ThemeApplier, globalStorage: IStorage): boolean {
  const state = readAppearance();
  if (!state.followSystem) return false;
  const mode = systemPrefersDark() ? 'dark' : 'light';
  if (state.mode === mode) return false;
  const next = { ...state, mode } as const;
  applyAppearance(next);
  writeAppearance(next);
  applyThemeById(EDITOR_THEME_FOR_MODE[mode], themeService, globalStorage);
  return true;
}

export function watchSystemMode(themeService: ThemeApplier, globalStorage: IStorage): IDisposable {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const onChange = (): void => { syncSystemMode(themeService, globalStorage); };
  onChange();
  query?.addEventListener('change', onChange);
  return { dispose: () => query?.removeEventListener('change', onChange) };
}
