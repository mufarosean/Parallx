// increaseContrast.test.ts — Settings › Appearance › Increase Contrast.
//
// One switch: data-px-contrast="more" on :root, and px-tokens.css mixes six
// tokens toward the text colour (borders 3:1 or better in every palette and
// mode, measured in the app by tests/probes/contrast-probe.mjs). Focus rings
// read one width token, which the switch thickens; a ring with a literal
// width would not follow, so none may have one.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { applyAppearance, readAppearance, savePreset, writeAppearance } from '../../src/theme/pxAppearance';
import { PxAppearancePanel } from '../../src/built-in/theme-editor/pxAppearancePanel';

const ROOT = resolve(__dirname, '../..');

beforeEach(() => { window.localStorage.clear(); document.body.replaceChildren(); document.documentElement.removeAttribute('data-px-contrast'); });
afterEach(() => window.localStorage.clear());

describe('Increase Contrast state', () => {
  it('sets and clears data-px-contrast on :root', () => {
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel', increaseContrast: true });
    expect(document.documentElement.getAttribute('data-px-contrast')).toBe('more');
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel' });
    expect(document.documentElement.hasAttribute('data-px-contrast')).toBe(false);
  });

  it('keeps only true', () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', increaseContrast: true });
    expect(readAppearance().increaseContrast).toBe(true);
    window.localStorage.setItem('px-appearance', JSON.stringify({ mode: 'dark', base: 'slate', accent: 'steel', increaseContrast: 'yes' }));
    expect(readAppearance().increaseContrast).toBeUndefined();
  });

  it('a saved theme never carries it, and applying one leaves it on', () => {
    expect(savePreset('Paper', { mode: 'light', base: 'warm', accent: 'sage', increaseContrast: true }).increaseContrast).toBeUndefined();
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', increaseContrast: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new PxAppearancePanel(host);
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.title === 'Apply Paper')!.click();
    expect(readAppearance()).toMatchObject({ mode: 'light', base: 'warm', increaseContrast: true });
    panel.dispose();
  });

  it('the Appearance page switch turns it on and off', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new PxAppearancePanel(host);
    const toggle = host.querySelector<HTMLElement>('[role="switch"][aria-label="Increase Contrast"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();
    expect(readAppearance().increaseContrast).toBe(true);
    expect(document.documentElement.getAttribute('data-px-contrast')).toBe('more');
    toggle.click();
    expect(readAppearance().increaseContrast).toBeUndefined();
    expect(document.documentElement.hasAttribute('data-px-contrast')).toBe(false);
    panel.dispose();
  });
});

describe('Increase Contrast tokens', () => {
  const tokens = readFileSync(resolve(ROOT, 'src/theme/px-tokens.css'), 'utf8');

  it('mixes the six tokens toward the text colour and thickens focus', () => {
    const block = tokens.slice(tokens.indexOf(':root[data-px-contrast="more"]'));
    for (const [token, base, share] of [['divider', '20', '71'], ['chrome-line', '20', '71'], ['border', '25', '57'], ['border-strong', '30', '47'], ['text-muted', '60', '73'], ['text-secondary', '70', '51']]) {
      expect(block).toMatch(new RegExp(`--px-${token}:\\s*color-mix\\(in srgb, var\\(--px-base-${base}\\) ${share}%, var\\(--px-text\\)\\);`));
    }
    expect(block).toMatch(/--px-focus-width:\s*3px;/);
  });

  it('comes after the light block, so it wins at equal specificity', () => {
    expect(tokens.lastIndexOf(':root[data-px-mode="light"]')).toBeLessThan(tokens.indexOf(':root[data-px-contrast="more"]'));
  });

  it('every focus ring reads the width token', () => {
    const literal: string[] = [];
    for (const file of globSync('src/**/*.css', { cwd: ROOT }).sort()) {
      const src = readFileSync(resolve(ROOT, file), 'utf8');
      for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (!/:focus/.test(m[1].replace(/\/\*[\s\S]*?\*\//g, ''))) continue;
        for (const o of m[2].matchAll(/outline:\s*(\d+px)\s+solid/g)) literal.push(`${file}: ${m[1].trim().slice(-60)} → ${o[1]}`);
      }
    }
    expect(literal, literal.join('\n')).toEqual([]);
  });
});
