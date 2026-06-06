// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyAppearance,
  readAppearance,
  writeAppearance,
  savePreset,
  type PxAppearanceState,
} from '../../src/theme/pxAppearance';

beforeEach(() => {
  window.localStorage.clear();
  const root = document.documentElement;
  root.removeAttribute('data-px-mode');
  root.removeAttribute('data-px-theme');
  root.style.colorScheme = '';
});
afterEach(() => window.localStorage.clear());

describe('readAppearance — mode axis', () => {
  it('defaults mode to dark when nothing is stored', () => {
    expect(readAppearance().mode).toBe('dark');
  });

  it('round-trips mode through write/read', () => {
    const state: PxAppearanceState = { mode: 'light', base: 'warm', accent: 'amber' };
    writeAppearance(state);
    const read = readAppearance();
    expect(read.mode).toBe('light');
    expect(read.base).toBe('warm');
    expect(read.accent).toBe('amber');
  });

  it('falls back to dark for an unknown/invalid mode', () => {
    window.localStorage.setItem('px-appearance', JSON.stringify({ mode: 'sepia', base: 'slate' }));
    expect(readAppearance().mode).toBe('dark');
  });
});

describe('applyAppearance — mode → :root', () => {
  it('sets data-px-mode="light" and color-scheme for light', () => {
    applyAppearance({ mode: 'light', base: 'slate', accent: 'steel' });
    const root = document.documentElement;
    expect(root.getAttribute('data-px-mode')).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });

  it('clears data-px-mode for dark (bare :root default) and sets color-scheme dark', () => {
    // First go light, then back to dark, to prove it clears.
    applyAppearance({ mode: 'light', base: 'slate', accent: 'steel' });
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel' });
    const root = document.documentElement;
    expect(root.hasAttribute('data-px-mode')).toBe(false);
    expect(root.style.colorScheme).toBe('dark');
  });

  it('keeps the mood on data-px-theme independent of mode', () => {
    applyAppearance({ mode: 'light', base: 'ember', accent: 'steel' });
    expect(document.documentElement.getAttribute('data-px-theme')).toBe('ember');
    // slate is the bare default — no mood attribute.
    applyAppearance({ mode: 'light', base: 'slate', accent: 'steel' });
    expect(document.documentElement.hasAttribute('data-px-theme')).toBe(false);
  });
});

describe('savePreset — carries mode', () => {
  it('persists the mode into the saved look', () => {
    const preset = savePreset('Paper', { mode: 'light', base: 'warm', accent: 'sage' });
    expect(preset.mode).toBe('light');
  });
});
