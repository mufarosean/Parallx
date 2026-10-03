// colorThemeRetired.test.ts — the Ctrl+T Color Theme picker is retired.
//
// Its light and dark were Appearance's mode under another name, and its
// High Contrast themes changed nothing on screen (two screenshots, Dark
// Modern and High Contrast Dark, were byte-identical). The command opens
// Settings › Appearance; Ctrl+T is free; a stored High Contrast choice
// becomes its mode with Increase Contrast on, once.
//
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateRetiredTheme } from '../../src/theme/themeApply';
import { findThemeById, THEME_STORAGE_KEY } from '../../src/theme/themeCatalog';
import { readAppearance, writeAppearance } from '../../src/theme/pxAppearance';

beforeEach(() => window.localStorage.clear());

describe('retired High Contrast themes', () => {
  it('a stored High Contrast Dark becomes dark with Increase Contrast, once', () => {
    writeAppearance({ mode: 'light', base: 'warm', accent: 'sage', font: 'georgia' });
    const storage = { set: vi.fn(async () => {}) };
    expect(migrateRetiredTheme('parallx-hc-dark', storage)).toBe('parallx-dark-modern');
    expect(readAppearance()).toMatchObject({ mode: 'dark', base: 'warm', accent: 'sage', font: 'georgia', increaseContrast: true });
    expect(storage.set).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'parallx-dark-modern');
    expect(document.documentElement.getAttribute('data-px-contrast')).toBe('more');
  });

  it('a stored High Contrast Light becomes light with Increase Contrast', () => {
    const storage = { set: vi.fn(async () => {}) };
    expect(migrateRetiredTheme('parallx-hc-light', storage)).toBe('parallx-light-modern');
    expect(readAppearance()).toMatchObject({ mode: 'light', increaseContrast: true });
  });

  it('any other theme passes through untouched', () => {
    const storage = { set: vi.fn(async () => {}) };
    expect(migrateRetiredTheme('parallx-dark-modern', storage)).toBe('parallx-dark-modern');
    expect(storage.set).not.toHaveBeenCalled();
    expect(readAppearance().increaseContrast).toBeUndefined();
  });

  it('the catalog no longer offers them', () => {
    expect(findThemeById('parallx-hc-dark')).toBeUndefined();
    expect(findThemeById('parallx-hc-light')).toBeUndefined();
    expect(findThemeById('parallx-dark-modern')).toBeDefined();
  });

  it('Preferences: Color Theme… opens Appearance and no longer claims Ctrl+T', async () => {
    const { ALL_BUILTIN_COMMANDS } = await import('../../src/commands/structuralCommands');
    const cmd = ALL_BUILTIN_COMMANDS.find((c) => c.id === 'workbench.action.selectTheme')!;
    expect(cmd.title).toBe('Color Theme…');
    expect(cmd.keybinding).toBeUndefined();
    expect(ALL_BUILTIN_COMMANDS.some((c) => c.keybinding?.toLowerCase() === 'ctrl+t')).toBe(false);
    const selectColorTheme = vi.fn();
    await cmd.handler({ workbench: { selectColorTheme } } as never);
    expect(selectColorTheme).toHaveBeenCalled();
    const wb = readFileSync(resolve(__dirname, '../../src/workbench/workbench.ts'), 'utf8');
    const method = wb.slice(wb.indexOf('  selectColorTheme(): void {'), wb.indexOf('  }', wb.indexOf('  selectColorTheme(): void {')));
    expect(method).toContain("executeCommand('settings.openAppearance')");
  });
});
