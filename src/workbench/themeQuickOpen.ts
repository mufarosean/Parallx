// themeQuickOpen.ts — Ctrl+P finds themes.
//
// The look of the app is core (src/theme): light or dark, the palette, the
// accent and the user's saved themes. This source lists each of them, and
// choosing one applies it the way Settings › Appearance does: the --px
// chrome repaints, the choice is saved, and the code editor's base theme
// follows the mode. Comfort settings (text size, contrast, motion) are not
// part of a look and are left alone.

import { registerQuickOpenSource, type QuickOpenSourceItem } from '../services/quickOpenSources.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { IStorage } from '../platform/storage.js';
import type { ColorThemeData } from '../theme/themeData.js';
import {
  PX_ACCENTS, PX_BASE_THEMES, DEFAULT_FONT_ID, applyAppearance, readAppearance, readPresets,
  systemPrefersDark, writeAppearance, type PxAppearanceState, type PxThemePreset,
} from '../theme/pxAppearance.js';
import { EDITOR_THEME_FOR_MODE, applyThemeById } from '../theme/themeApply.js';

/**
 * Every look on offer, each with the state choosing it leads to. `prefersDark`
 * is the computer's setting, for Match System.
 */
export function themeQuickOpenItems(
  state: PxAppearanceState,
  presets: readonly PxThemePreset[],
  prefersDark: boolean,
  apply: (next: PxAppearanceState) => void,
): QuickOpenSourceItem[] {
  const inUse = (detail: string, current: boolean): string => (current ? `${detail}, in use` : detail);
  const items: QuickOpenSourceItem[] = [];
  const modes = [
    { id: 'dark', label: 'Dark', next: { ...state, followSystem: undefined, mode: 'dark' as const }, current: !state.followSystem && state.mode === 'dark' },
    { id: 'light', label: 'Light', next: { ...state, followSystem: undefined, mode: 'light' as const }, current: !state.followSystem && state.mode === 'light' },
    { id: 'system', label: 'Match System', next: { ...state, followSystem: true, mode: prefersDark ? 'dark' as const : 'light' as const }, current: !!state.followSystem },
  ];
  for (const m of modes) {
    items.push({ id: `mode:${m.id}`, label: m.label, detail: inUse('Mode', m.current), keywords: 'mode light dark', open: () => apply(m.next) });
  }
  for (const base of PX_BASE_THEMES) {
    items.push({
      id: `palette:${base.id}`, label: base.label, detail: inUse('Palette', state.base === base.id), keywords: base.desc,
      open: () => apply({ ...state, base: base.id }),
    });
  }
  for (const accent of PX_ACCENTS) {
    items.push({
      id: `accent:${accent.id}`, label: accent.label, detail: inUse('Accent', state.accent === accent.id), keywords: 'accent colour color',
      open: () => apply({ ...state, accent: accent.id }),
    });
  }
  for (const preset of presets) {
    // As the Appearance page applies a saved theme: the look, not the comfort settings.
    const font = preset.font ?? state.font;
    items.push({
      id: `saved:${preset.id}`, label: preset.name, detail: 'Saved theme', keywords: 'saved custom theme',
      open: () => apply({
        ...state, mode: preset.mode, followSystem: undefined, base: preset.base, accent: preset.accent,
        customHue: preset.customHue, font: font === DEFAULT_FONT_ID ? undefined : font,
      }),
    });
  }
  return items;
}

interface ThemeApplier { applyTheme(theme: ColorThemeData): void }

/** Apply a look: repaint, save, and bring the editor's base theme in line. */
export function applyLook(next: PxAppearanceState, themeService: ThemeApplier, globalStorage: IStorage): void {
  applyAppearance(next);
  writeAppearance(next);
  applyThemeById(EDITOR_THEME_FOR_MODE[next.mode], themeService, globalStorage);
}

/** Register the themes source; it lists nothing until the user types. */
export function registerThemeQuickOpen(themeService: ThemeApplier, globalStorage: IStorage): IDisposable {
  return registerQuickOpenSource({
    id: 'workbench.themes',
    group: 'themes',
    kind: 'Theme',
    onlyWhenQueried: true,
    listItems: async () => themeQuickOpenItems(readAppearance(), readPresets(), systemPrefersDark(), (next) => applyLook(next, themeService, globalStorage)),
  });
}
