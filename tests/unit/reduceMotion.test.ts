// reduceMotion.test.ts — Settings › Appearance › Reduce Motion.
//
// One attribute (data-px-motion="reduced") stills every CSS animation and
// transition, as the computer's own reduced-motion setting already did;
// code that animates by hand asks ui/motionPreference.ts, which answers for
// either. A comfort setting: saved themes neither carry nor change it.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { applyAppearance, readAppearance, savePreset, writeAppearance } from '../../src/theme/pxAppearance';
import { motionReduced } from '../../src/ui/motionPreference';
import { PxAppearancePanel } from '../../src/built-in/theme-editor/pxAppearancePanel';

const ROOT = resolve(__dirname, '../..');
let systemReduce = false;
beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-px-motion');
  systemReduce = false;
  (window as any).matchMedia = (q: string) => ({ matches: q.includes('reduced-motion') ? systemReduce : false, media: q, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { delete (window as any).matchMedia; window.localStorage.clear(); });

describe('Reduce Motion', () => {
  it('sets and clears data-px-motion on :root', () => {
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel', reduceMotion: true });
    expect(document.documentElement.getAttribute('data-px-motion')).toBe('reduced');
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel' });
    expect(document.documentElement.hasAttribute('data-px-motion')).toBe(false);
  });

  it('motion is reduced by the switch or by the computer', () => {
    expect(motionReduced()).toBe(false);
    systemReduce = true;
    expect(motionReduced()).toBe(true);
    systemReduce = false;
    document.documentElement.setAttribute('data-px-motion', 'reduced');
    expect(motionReduced()).toBe(true);
  });

  it('px-motion.css stills everything under the attribute, as under the media query', () => {
    const css = readFileSync(resolve(ROOT, 'src/theme/px-motion.css'), 'utf8');
    const block = css.slice(css.indexOf(':root[data-px-motion="reduced"] *,'));
    expect(block).toMatch(/animation-duration:\s*0\.001ms !important;/);
    expect(block).toMatch(/transition-duration:\s*0\.001ms !important;/);
    expect(block).toMatch(/animation-iteration-count:\s*1 !important;/);
  });

  it('code asks motionPreference.ts, never the media query itself', () => {
    const direct = globSync('src/**/*.ts', { cwd: ROOT })
      .filter((f) => !f.endsWith('motionPreference.ts'))
      .filter((f) => /matchMedia\(\s*['"]\(prefers-reduced-motion/.test(readFileSync(resolve(ROOT, f), 'utf8')));
    expect(direct).toEqual([]);
  });

  it('the switch turns it on and off; a saved theme neither carries nor changes it', () => {
    expect(savePreset('Calm', { mode: 'dark', base: 'slate', accent: 'steel', reduceMotion: true }).reduceMotion).toBeUndefined();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new PxAppearancePanel(host);
    const toggle = host.querySelector<HTMLElement>('[role="switch"][aria-label="Reduce Motion"]')!;
    toggle.click();
    expect(readAppearance().reduceMotion).toBe(true);
    expect(document.documentElement.getAttribute('data-px-motion')).toBe('reduced');
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.title === 'Apply Calm')!.click();
    expect(readAppearance().reduceMotion).toBe(true);
    toggle.click();
    expect(readAppearance().reduceMotion).toBeUndefined();
    panel.dispose();
  });

  it('keeps only true', () => {
    window.localStorage.setItem('px-appearance', JSON.stringify({ mode: 'dark', base: 'slate', accent: 'steel', reduceMotion: 1 }));
    expect(readAppearance().reduceMotion).toBeUndefined();
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', reduceMotion: true });
    expect(readAppearance().reduceMotion).toBe(true);
  });
});
