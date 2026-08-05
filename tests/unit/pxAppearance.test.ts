// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyAppearance,
  readAppearance,
  writeAppearance,
  healAppearanceFromDurable,
  savePreset,
  type PxAppearanceState,
} from '../../src/theme/pxAppearance';

type BridgeCall = { file: string; data: Record<string, unknown> };
function installStorageBridge(durable: Record<string, unknown> | null): { writes: BridgeCall[] } {
  const writes: BridgeCall[] = [];
  (window as any).parallxElectron = {
    appPath: '/app',
    storage: {
      readJson: async () => ({ data: durable }),
      writeJson: async (file: string, data: Record<string, unknown>) => { writes.push({ file, data }); return {}; },
    },
  };
  return { writes };
}

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

// ─── Durable persistence (2026-08-06) ───────────────────────────────────────
//
// Regression pin for "my accent sometimes doesn't stick": Chromium flushes
// localStorage lazily, so a quit shortly after picking an accent lost the
// write. Every write now lands in BOTH layers with a savedAt stamp, and boot
// heals whichever layer is older.

describe('appearance durable layer', () => {
  afterEach(() => { delete (window as any).parallxElectron; });

  it('writeAppearance stamps savedAt and mirrors to the durable file', () => {
    const { writes } = installStorageBridge(null);
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'amber' });
    expect(writes).toHaveLength(1);
    expect(writes[0].file).toBe('/app/data/appearance.json');
    expect(writes[0].data.accent).toBe('amber');
    expect(typeof writes[0].data.savedAt).toBe('number');
    const raw = JSON.parse(window.localStorage.getItem('px-appearance') ?? '{}');
    expect(typeof raw.savedAt).toBe('number');
  });

  it('heal applies the durable state when it is newer (the lost-flush case)', async () => {
    window.localStorage.setItem('px-appearance',
      JSON.stringify({ mode: 'dark', base: 'slate', accent: 'steel', savedAt: 100 }));
    installStorageBridge({ mode: 'dark', base: 'slate', accent: 'amber', savedAt: 200 });
    await healAppearanceFromDurable();
    expect(readAppearance().accent).toBe('amber');
  });

  it('heal re-seeds the file when the fast layer is newer (kill mid-IPC)', async () => {
    window.localStorage.setItem('px-appearance',
      JSON.stringify({ mode: 'dark', base: 'slate', accent: 'coral', savedAt: 300 }));
    const { writes } = installStorageBridge({ mode: 'dark', base: 'slate', accent: 'steel', savedAt: 100 });
    await healAppearanceFromDurable();
    expect(readAppearance().accent).toBe('coral');
    expect(writes).toHaveLength(1);
    expect(writes[0].data.accent).toBe('coral');
  });

  it('heal seeds the durable file on first run and leaves the applied state alone', async () => {
    window.localStorage.setItem('px-appearance',
      JSON.stringify({ mode: 'light', base: 'warm', accent: 'moss', savedAt: 400 }));
    const { writes } = installStorageBridge(null);
    await healAppearanceFromDurable();
    expect(readAppearance().accent).toBe('moss');
    expect(writes).toHaveLength(1);
    expect(writes[0].data.accent).toBe('moss');
  });

  it('no bridge (browser/test context): write and heal are safe no-ops beyond localStorage', async () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'iris' });
    await healAppearanceFromDurable();
    expect(readAppearance().accent).toBe('iris');
  });
});
