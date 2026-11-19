// @vitest-environment jsdom
// stackedBar.test.ts — the kit's stacked bar (src/ui/stackedBar.ts, api.ui.createStackedBar).
//
// One bar of up to four parts in one order (good, middling, poor, rest), with
// a name a screen reader speaks in full. A part with nothing in it is not
// drawn; a part given an action is a button with its own name, reachable by
// keyboard; a bar with no action is one picture. The styles keep the contrast
// rule without colour alone: a gap between parts, an outline on the rest.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStackedBar, createSurface, installKitCommands } from '../../src/ui/kit.js';
import { scene } from '../../src/ui/scene.js';
import { createUiApi } from '../../src/api/bridges/uiBridge.js';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  scene.reset();
  host = document.createElement('div');
  document.body.appendChild(host);
  createSurface(host, { id: 'test', owner: 'core', label: 'Test' });
});

const partsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-state]')];
const NAME = 'Mack, Questions: 3 right, 1 partly, 2 wrong, 2 not yet';

describe('createStackedBar', () => {
  it('is one named picture when no part has an action', () => {
    const bar = createStackedBar(host, { label: NAME, parts: [
      { state: 'good', count: 3, label: 'Right: 3' }, { state: 'middling', count: 1, label: 'Partly: 1' },
      { state: 'poor', count: 2, label: 'Wrong: 2' }, { state: 'rest', count: 2, label: 'Not yet: 2' },
    ] });
    expect(bar.element.parentElement).toBe(host);
    expect(bar.element.classList.contains('px-stacked-bar')).toBe(true);
    expect(bar.element.getAttribute('role')).toBe('img');
    expect(bar.element.getAttribute('aria-label')).toBe(NAME);
    const parts = partsOf(bar.element);
    expect(parts.map((p) => p.dataset.state)).toEqual(['good', 'middling', 'poor', 'rest']);
    expect(parts.map((p) => p.style.flexGrow)).toEqual(['3', '1', '2', '2']);
    expect(parts.every((p) => p.tagName !== 'BUTTON' && p.tabIndex < 0 && !p.hasAttribute('role'))).toBe(true);
    expect(parts.map((p) => p.title)).toEqual(['Right: 3', 'Partly: 1', 'Wrong: 2', 'Not yet: 2']);
  });

  it('keeps one order whatever order the parts are given in, and leaves out a part with nothing in it', () => {
    const bar = createStackedBar(host, { label: 'x', parts: [
      { state: 'rest', count: 4, label: 'd' }, { state: 'poor', count: 0, label: 'c' },
      { state: 'good', count: 2, label: 'a' }, { state: 'middling', count: -3, label: 'b' },
    ] });
    expect(partsOf(bar.element).map((p) => p.dataset.state)).toEqual(['good', 'rest']);
  });

  it('a part with an action is a button with its own name, in the tab order; the bar is then a group', () => {
    const clicked: string[] = [];
    const bar = createStackedBar(host, { label: NAME, parts: [
      { state: 'good', count: 3, label: 'Mack, Questions, right: 3. Study these', onClick: () => clicked.push('good') },
      { state: 'poor', count: 2, label: 'Mack, Questions, wrong: 2. Study these', onClick: () => clicked.push('poor') },
      { state: 'rest', count: 2, label: 'Not yet: 2' },
    ] });
    expect(bar.element.getAttribute('role')).toBe('group');
    const [good, poor, rest] = partsOf(bar.element);
    expect(good.tagName).toBe('BUTTON');
    expect((good as HTMLButtonElement).type).toBe('button');
    expect(good.getAttribute('aria-label')).toBe('Mack, Questions, right: 3. Study these');
    expect(good.tabIndex).toBe(0);
    expect(rest.tagName).not.toBe('BUTTON');
    poor.click();
    expect(clicked).toEqual(['poor']);
  });

  it('a part\'s tooltip is its name, or the shorter title it is given; the spoken name stays whole', () => {
    const bar = createStackedBar(host, { label: NAME, parts: [
      { state: 'good', count: 3, label: 'Mack, Questions, right: 3. Study these', title: 'Right: 3. Study these', onClick: () => {} },
      { state: 'rest', count: 2, label: 'Mack, Questions, not yet: 2', title: 'Not yet: 2' },
      { state: 'poor', count: 1, label: 'Wrong: 1' },
    ] });
    const [good, poor, rest] = partsOf(bar.element);
    expect([good.title, poor.title, rest.title]).toEqual(['Right: 3. Study these', 'Wrong: 1', 'Not yet: 2']);
    expect(good.getAttribute('aria-label')).toBe('Mack, Questions, right: 3. Study these');
  });

  describe('a part\'s words for whoever has no hover', () => {
    const tip = () => { const t = document.querySelector<HTMLElement>('.parallx-tooltip'); return t && t.style.display !== 'none' ? t.textContent : null; };
    const make = (onClick = vi.fn()) => ({ onClick, bar: createStackedBar(host, { label: NAME, parts: [
      { state: 'good', count: 3, label: 'Mack, Questions, right: 3. Study these', title: 'Right: 3. Study these', onClick },
      { state: 'poor', count: 2, label: 'Mack, Questions, wrong: 2', title: 'Wrong: 2' },
    ] }) });
    beforeEach(() => { document.documentElement.dataset.inputModality = 'keyboard'; });

    it('show when the keyboard\'s focus arrives on a part, and go when it leaves', () => {
      const { bar } = make();
      const [good] = partsOf(bar.element);
      expect(tip()).toBeNull();
      good.focus();
      expect(tip()).toBe('Right: 3. Study these');
      good.blur();
      expect(tip()).toBeNull();
      bar.dispose();
    });

    it('do not show for a focus the mouse gave: that press is about to run the part', () => {
      document.documentElement.dataset.inputModality = 'pointer';
      const { bar } = make();
      partsOf(bar.element)[0].focus();
      expect(tip()).toBeNull();
      bar.dispose();
    });

    it('show on a tap or click of a part that does nothing else; a part that acts runs its action instead', () => {
      const { bar, onClick } = make();
      const [good, poor] = partsOf(bar.element);
      poor.click();
      expect(tip()).toBe('Wrong: 2');
      document.dispatchEvent(new Event('pointerdown'));
      expect(tip()).toBeNull();
      good.click();
      expect(onClick).toHaveBeenCalledOnce();
      expect(tip()).toBeNull();
      bar.dispose();
    });

    it('show on a long press by finger or pen of a part that acts, and that press does not run it; a tap still does', () => {
      vi.useFakeTimers();
      try {
        const { bar, onClick } = make();
        const [good] = partsOf(bar.element);
        const fire = (type: string, pointerType: string) => { const e = new MouseEvent(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'pointerType', { value: pointerType }); good.dispatchEvent(e); return e; };
        // A tap: down, up before the half second, click.
        fire('pointerdown', 'touch'); vi.advanceTimersByTime(120); fire('pointerup', 'touch'); good.click();
        vi.advanceTimersByTime(1000);
        expect(onClick).toHaveBeenCalledOnce();
        expect(tip()).toBeNull();
        // A long press: the words show while the finger rests, and the click that ends it is not the part's.
        fire('pointerdown', 'touch'); vi.advanceTimersByTime(499);
        expect(tip()).toBeNull();
        vi.advanceTimersByTime(2);
        expect(tip()).toBe('Right: 3. Study these');
        expect(fire('contextmenu', 'touch').defaultPrevented).toBe(true);
        fire('pointerup', 'touch'); good.click();
        expect(onClick).toHaveBeenCalledOnce();
        expect(tip()).toBe('Right: 3. Study these');
        // The next tap is a tap again; a mouse held down is not a long press, and its right click is left alone.
        fire('pointerdown', 'touch'); fire('pointerup', 'touch'); good.click();
        expect(onClick).toHaveBeenCalledTimes(2);
        fire('pointerdown', 'mouse'); vi.advanceTimersByTime(800);
        expect(fire('contextmenu', 'mouse').defaultPrevented).toBe(false);
        fire('pointerup', 'mouse'); good.click();
        expect(onClick).toHaveBeenCalledTimes(3);
        bar.dispose();
      } finally { vi.useRealTimers(); }
    });

    it('are taken down when the bar is drawn again, and put back on the part that keeps the focus', () => {
      const { bar } = make();
      partsOf(bar.element)[0].focus();
      bar.update({ label: NAME, parts: [{ state: 'good', count: 4, label: 'Right: 4', onClick: () => {} }] });
      expect(tip()).toBe('Right: 4');
      bar.update({ label: NAME, parts: [{ state: 'rest', count: 4, label: 'Not yet: 4' }] });
      expect(tip()).toBeNull();
      bar.dispose();
    });
  });

  it('a part can run a command, and with an id it is in the scene', async () => {
    const run = vi.fn(async () => undefined);
    installKitCommands({ executeCommand: run } as never);
    const bar = createStackedBar(host, { label: NAME, parts: [
      { id: 'test.bar.poor', state: 'poor', count: 2, label: 'Wrong: 2. Study these', command: 'demo.study', args: [7, 'Mack', 'wrong'] },
    ] });
    const [poor] = partsOf(bar.element);
    expect(poor.getAttribute('data-px-id')).toBe('test.bar.poor');
    const entry = scene.find('test.bar.poor')[0];
    expect(entry.kind).toBe('button');
    expect(entry.command).toBe('demo.study');
    poor.click();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith('demo.study', 7, 'Mack', 'wrong');
  });

  it('the small bar is a thin line in a row: never pressable, whatever its parts say', () => {
    const bar = createStackedBar(host, { label: 'Mack: 3 right, 0 partly, 0 wrong, 5 not yet', size: 'sm', parts: [
      { state: 'good', count: 3, label: 'a', onClick: () => { throw new Error('pressed'); } }, { state: 'rest', count: 5, label: 'b' },
    ] });
    expect(bar.element.classList.contains('px-stacked-bar--sm')).toBe(true);
    expect(bar.element.getAttribute('role')).toBe('img');
    expect(partsOf(bar.element).every((p) => p.tagName !== 'BUTTON')).toBe(true);
  });

  it('update redraws in place, keeps the focus on the same state, and dispose takes the bar away', () => {
    const part = (count: number) => ({ id: 'test.bar.good', state: 'good' as const, count, label: `Right: ${count}`, onClick: () => {} });
    const bar = createStackedBar(host, { label: 'one', parts: [part(1), { state: 'rest', count: 3, label: 'r' }] });
    const element = bar.element;
    partsOf(element)[0].focus();
    bar.update({ label: 'two', parts: [part(2), { state: 'rest', count: 2, label: 'r' }] });
    expect(bar.element).toBe(element);
    expect(element.getAttribute('aria-label')).toBe('two');
    expect(partsOf(element).map((p) => p.style.flexGrow)).toEqual(['2', '2']);
    expect(document.activeElement).toBe(partsOf(element)[0]);
    expect(scene.find('test.bar.good')).toHaveLength(1);
    bar.dispose();
    expect(element.isConnected).toBe(false);
    expect(scene.find('test.bar.good')).toHaveLength(0);
  });

  it('a bar with nothing in any part draws nothing', () => {
    const bar = createStackedBar(host, { label: 'none', parts: [{ state: 'good', count: 0, label: 'a' }] });
    expect(partsOf(bar.element)).toHaveLength(0);
    expect(bar.element.hidden).toBe(true);
  });

  it('is what api.ui hands an extension', () => {
    const ui = createUiApi();
    const bar = ui.createStackedBar(host, { label: NAME, parts: [{ state: 'good', count: 1, label: 'a' }] });
    expect(bar.element.classList.contains('px-stacked-bar')).toBe(true);
  });
});

describe('the bar\'s styles', () => {
  const css = readFileSync(resolve(__dirname, '../../src/ui/stackedBar.css'), 'utf8');
  const tokens = readFileSync(resolve(__dirname, '../../src/theme/px-tokens.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `a rule for ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('colours the three states from the signal tokens, and each part carries its own background', () => {
    expect(rule('.px-stacked-bar__part[data-state="good"]')).toMatch(/background-color:\s*var\(--px-success\)/);
    expect(rule('.px-stacked-bar__part[data-state="middling"]')).toMatch(/background-color:\s*var\(--px-warning\)/);
    expect(rule('.px-stacked-bar__part[data-state="poor"]')).toMatch(/background-color:\s*var\(--px-danger\)/);
  });

  it('never tells two parts apart by colour alone: a gap of the surface between them, and an outline on the rest', () => {
    expect(rule('.px-stacked-bar')).toMatch(/gap:\s*2px/);
    expect(rule('.px-stacked-bar')).not.toMatch(/background/);
    expect(rule('.px-stacked-bar__part[data-state="rest"]')).toMatch(/border:\s*1px solid var\(--px-bar-rest\)/);
    expect(tokens).toMatch(/--px-bar-rest:\s*var\(--px-base-50\)/);
  });

  it('never tells the three tones apart by hue alone: middling is hatched and poor is ticked, each cut in the surface\'s colour; good stays solid', () => {
    const image = (r: string) => (/background-image:\s*([^;]+);/.exec(r) || [])[1] || '';
    const [good, middling, poor] = ['good', 'middling', 'poor'].map((s) => rule(`.px-stacked-bar__part[data-state="${s}"]`));
    expect(image(good)).toBe('');
    expect(image(middling)).toMatch(/^repeating-linear-gradient\(135deg, transparent [^)]*var\(--px-bar-cut\)/);
    expect(image(poor)).toMatch(/^repeating-linear-gradient\(90deg, transparent [^)]*var\(--px-bar-cut\)/);
    expect(image(middling)).not.toBe(image(poor));
    // The cut is the surface the bar lies on, which the tones are 3:1 against (measured below).
    expect(tokens).toMatch(/--px-bar-cut:\s*var\(--px-bg\)/);
  });

  it('the thin bar has a line\'s textures: middling dashed, poor dotted, each its own', () => {
    const image = (r: string) => (/background-image:\s*([^;]+);/.exec(r) || [])[1] || '';
    const [middling, poor] = ['middling', 'poor'].map((s) => image(rule(`.px-stacked-bar--sm .px-stacked-bar__part[data-state="${s}"]`)));
    expect(middling).toMatch(/^repeating-linear-gradient\(90deg, transparent [^)]*var\(--px-bar-cut\)/);
    expect(poor).toMatch(/^repeating-linear-gradient\(90deg, transparent [^)]*var\(--px-bar-cut\)/);
    expect(middling).not.toBe(poor);
  });

  it('a legend\'s swatch is the bar\'s own tone and texture: the same rule draws both', () => {
    for (const s of ['good', 'middling', 'poor', 'rest']) expect(css).toContain(`.px-stacked-bar-key[data-state="${s}"],\n.px-stacked-bar__part[data-state="${s}"] {`);
  });

  it('under forced colours the parts keep their own paint, in the system\'s colours, with the textures', () => {
    const at = css.indexOf('@media (forced-colors: active)');
    expect(at).toBeGreaterThan(0);
    const forced = css.slice(at);
    expect(forced).toMatch(/\.px-stacked-bar__part\[data-state\], \.px-stacked-bar-key\[data-state\] \{[^}]*forced-color-adjust:\s*none;[^}]*border:\s*1px solid CanvasText;[^}]*background-color:\s*CanvasText/);
    expect(forced).toMatch(/--px-bar-cut:\s*Canvas/);
    expect(forced).toMatch(/\[data-state="rest"\][^{]*\{[^}]*background-color:\s*Canvas;/);
    expect(forced).toMatch(/:focus-visible \{ outline-color:\s*Highlight/);
    // The textures are background images, which forced colours leave alone once the part opts out.
    expect(forced).not.toMatch(/background-image:\s*none/);
  });

  it('a pressable part is wide enough for a finger and shows the keyboard\'s focus', () => {
    expect(rule('button.px-stacked-bar__part')).toMatch(/min-width:\s*24px/);
    expect(rule('button.px-stacked-bar__part:focus-visible')).toMatch(/outline:\s*var\(--px-focus-width\) solid var\(--px-accent\)/);
  });

  it('uses no colour of its own', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

describe('the rest tone against every surface of every palette', () => {
  const tokens = readFileSync(resolve(__dirname, '../../src/theme/px-tokens.css'), 'utf8');
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };

  it('is 3 to 1 or more (WCAG 1.4.11), like the three signal tones', () => {
    let palettes = 0;
    for (const block of tokens.matchAll(/:root[^{]*\{([^}]*)\}/g)) {
      const base = Object.fromEntries([...block[1].matchAll(/--px-base-(\d+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
      if (!base['50']) continue;
      palettes += 1;
      for (const ground of ['00', '05', '10', '15']) expect(ratio(base['50'], base[ground]), `base-50 on base-${ground}`).toBeGreaterThanOrEqual(3);
      const signal = [...block[1].matchAll(/--px-(red|green|yellow)-rgb:\s*(\d+),\s*(\d+),\s*(\d+)/g)];
      for (const [, name, r, g, b] of signal) {
        const hex = `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
        for (const ground of ['00', '05', '10', '15']) expect(ratio(hex, base[ground]), `${name} on base-${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(palettes).toBeGreaterThanOrEqual(6);
  });
});
