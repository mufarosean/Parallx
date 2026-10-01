// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyAppearance,
  readAppearance,
  writeAppearance,
  healAppearanceFromDurable,
  savePreset,
  onAccentInk,
  accentTextLightness,
  ON_ACCENT_DARK,
  PX_ACCENTS,
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

describe('text on accent', () => {
  function contrast(hex: string, h: number, s: number, l: number): number {
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const sN = s / 100, lN = l / 100, k = (n: number) => (n + h / 30) % 12;
    const a = sN * Math.min(lN, 1 - lN);
    const f = (n: number) => 255 * (lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
    const accent = lum([f(0), f(8), f(4)]);
    const ink = lum([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
    const [hi, lo] = accent > ink ? [accent, ink] : [ink, accent];
    return (hi + 0.05) / (lo + 0.05);
  }

  it('every curated accent gets ink that meets WCAG AA (4.5:1)', () => {
    for (const a of PX_ACCENTS) {
      expect(contrast(onAccentInk(a.h, a.s, a.l), a.h, a.s, a.l), a.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every custom hue gets the better of white or dark ink', () => {
    for (let h = 0; h < 360; h += 5) {
      const ink = onAccentInk(h, 58, 62);
      const other = ink === ON_ACCENT_DARK ? '#ffffff' : ON_ACCENT_DARK;
      expect(contrast(ink, h, 58, 62)).toBeGreaterThanOrEqual(contrast(other, h, 58, 62));
    }
  });

  it('applyAppearance sets the ink inline with the accent', () => {
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel' } as PxAppearanceState);
    expect(document.documentElement.style.getPropertyValue('--px-text-on-accent')).toBe(ON_ACCENT_DARK);
  });
});

describe('accent as text in light mode', () => {
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const hsl = (h: number, s: number, l: number) => {
    const sN = s / 100, lN = l / 100, k = (n: number) => (n + h / 30) % 12, a = sN * Math.min(lN, 1 - lN);
    const f = (n: number) => 255 * (lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
    return [f(0), f(8), f(4)];
  };

  it('every accent (curated and custom hue) reads at 4.5:1 on paper, sidebar and card', () => {
    const grounds = [[0xf4, 0xf5, 0xf7], [0xec, 0xee, 0xf1], [0xff, 0xff, 0xff]];
    const cases = [...PX_ACCENTS.map(a => [a.h, a.s, a.l]), ...Array.from({ length: 72 }, (_, i) => [i * 5, 58, 62])];
    for (const [h, s, l] of cases) {
      const L = accentTextLightness(h, s, l);
      const ink = lum(hsl(h, s, L));
      for (const g of grounds) expect((lum(g) + 0.05) / (ink + 0.05)).toBeGreaterThanOrEqual(4.45);
    }
  });

  it('keeps as much of the accent as it can (never darker than it needs to be)', () => {
    const steel = PX_ACCENTS.find(a => a.id === 'steel')!;
    const L = accentTextLightness(steel.h, steel.s, steel.l);
    expect(L).toBeLessThan(steel.l);
    expect(L).toBeGreaterThan(30);
  });
});
