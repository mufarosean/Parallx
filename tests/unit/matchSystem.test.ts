// matchSystem.test.ts — Settings › Appearance › Mode › Match System.
//
// While following the computer, its light or dark setting drives the mode,
// live, and the code editor's base theme switches with it. Choosing Dark or
// Light, or applying a saved theme, stops following.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAppearance, effectiveMode, readAppearance, savePreset, writeAppearance } from '../../src/theme/pxAppearance';
import { watchSystemMode } from '../../src/theme/systemMode';
import { PxAppearancePanel } from '../../src/built-in/theme-editor/pxAppearancePanel';

let systemDark = true;
const listeners = new Set<() => void>();
const flip = (dark: boolean) => { systemDark = dark; for (const l of listeners) l(); };

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-px-mode');
  systemDark = true;
  listeners.clear();
  (window as any).matchMedia = (query: string) => ({
    get matches() { return systemDark; }, media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  });
});
afterEach(() => { delete (window as any).matchMedia; window.localStorage.clear(); });

const storage = () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => {}), delete: vi.fn(), has: vi.fn(), keys: vi.fn(), clear: vi.fn() }) as never;

describe('Match System', () => {
  it('the mode on screen is the computer\'s while following it', () => {
    expect(effectiveMode({ mode: 'dark', base: 'slate', accent: 'steel', followSystem: true })).toBe('dark');
    systemDark = false;
    expect(effectiveMode({ mode: 'dark', base: 'slate', accent: 'steel', followSystem: true })).toBe('light');
    expect(effectiveMode({ mode: 'dark', base: 'slate', accent: 'steel' })).toBe('dark');
  });

  it('paints the computer\'s mode at once, even before the stored mode catches up', () => {
    systemDark = false;
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel', followSystem: true });
    expect(document.documentElement.getAttribute('data-px-mode')).toBe('light');
  });

  it('follows the computer live, editor theme included', () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', followSystem: true });
    const themeService = { applyTheme: vi.fn() };
    const watch = watchSystemMode(themeService, storage());
    expect(themeService.applyTheme).not.toHaveBeenCalled(); // already dark
    flip(false);
    expect(readAppearance().mode).toBe('light');
    expect(document.documentElement.getAttribute('data-px-mode')).toBe('light');
    expect(themeService.applyTheme).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'parallx-light-modern' }));
    flip(true);
    expect(readAppearance().mode).toBe('dark');
    expect(themeService.applyTheme).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'parallx-dark-modern' }));
    watch.dispose();
  });

  it('changes nothing when not following', () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel' });
    const themeService = { applyTheme: vi.fn() };
    const watch = watchSystemMode(themeService, storage());
    flip(false);
    expect(readAppearance().mode).toBe('dark');
    expect(themeService.applyTheme).not.toHaveBeenCalled();
    watch.dispose();
  });
});

describe('Settings › Appearance › Mode', () => {
  const selected = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.px-mode-btn[data-mode]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.mode);

  it('offers Dark, Light and Match System, and says which the computer chose', () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel' });
    systemDark = false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new PxAppearancePanel(host);
    expect([...host.querySelectorAll('.px-mode-btn[data-mode]')].map((b) => b.textContent)).toEqual(['Dark', 'Light', 'Match System']);
    host.querySelector<HTMLButtonElement>('[data-mode="system"]')!.click();
    expect(readAppearance()).toMatchObject({ followSystem: true, mode: 'light' });
    expect(selected(host)).toEqual(['system']);
    const status = host.querySelector<HTMLElement>('.px-appearance-mode-status')!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Following your computer: light right now.');
    host.querySelector<HTMLButtonElement>('[data-mode="dark"]')!.click();
    expect(readAppearance().followSystem).toBeUndefined();
    expect(selected(host)).toEqual(['dark']);
    expect(status.hidden).toBe(true);
    panel.dispose();
  });

  it('the page follows a switch the computer makes while it is open', () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', followSystem: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new PxAppearancePanel(host);
    const watch = watchSystemMode({ applyTheme: vi.fn() }, storage());
    flip(false);
    expect(host.querySelector('.px-appearance-mode-status')!.textContent).toBe('Following your computer: light right now.');
    watch.dispose();
    panel.dispose();
  });

  it('applying a saved theme sets its mode and stops following', () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', followSystem: true });
    savePreset('Paper', { mode: 'light', base: 'warm', accent: 'sage' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new PxAppearancePanel(host);
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.title === 'Apply Paper')!.click();
    expect(readAppearance()).toMatchObject({ mode: 'light', base: 'warm' });
    expect(readAppearance().followSystem).toBeUndefined();
    panel.dispose();
  });
});
