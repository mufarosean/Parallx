// textSize.test.ts — Settings › Appearance › Text size, Ctrl+= / Ctrl+- / Ctrl+NumPad0.
//
// The window's zoom, five steps from 90% to 150%. A comfort setting: saved
// themes never carry it and applying one leaves it alone. The keys yield to
// a surface with its own zoom (the worksheet's sheet), and the number pad
// is told apart from the top row so Ctrl+NumPad0 can reset while Ctrl+0
// still focuses the side bar.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_CHANGED_EVENT, PX_TEXT_SIZES, applyAppearance, readAppearance, savePreset, setTextSize, stepTextSize, writeAppearance,
} from '../../src/theme/pxAppearance';
import { keyFromEvent, normalizeKeybinding } from '../../src/services/keybindingUtils';
import { CTX_FOCUS_OWNS_ZOOM, DATA_OWNS_ZOOM, FocusTracker } from '../../src/context/focusTracker';
import { PxAppearancePanel } from '../../src/built-in/theme-editor/pxAppearancePanel';
import { ALL_TEXT_SIZE_COMMANDS, TEXT_SIZE_EXTRA_KEYBINDINGS } from '../../src/commands/textSizeCommands';

let zoomCalls: number[];
beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  zoomCalls = [];
  (window as any).parallxElectron = { setZoomFactor: (f: number) => zoomCalls.push(f) };
});
afterEach(() => { delete (window as any).parallxElectron; window.localStorage.clear(); });

describe('text size state', () => {
  it('offers 90, 100, 110, 125 and 150 percent', () => {
    expect(PX_TEXT_SIZES).toEqual([0.9, 1, 1.1, 1.25, 1.5]);
  });

  it('steps to the next size each way and stops at the ends', () => {
    expect(stepTextSize(undefined, 1)).toBe(1.1);
    expect(stepTextSize(1.1, 1)).toBe(1.25);
    expect(stepTextSize(1.5, 1)).toBe(1.5);
    expect(stepTextSize(1.25, -1)).toBe(1.1);
    expect(stepTextSize(0.9, -1)).toBe(0.9);
    expect(stepTextSize(1.17, 1)).toBe(1.25); // between steps: the next one up
  });

  it('keeps only a size on offer; 100% is stored as no override', () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', textSize: 1.25 });
    expect(readAppearance().textSize).toBe(1.25);
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', textSize: 1.3 });
    expect(readAppearance().textSize).toBeUndefined();
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', textSize: 1 });
    expect(readAppearance().textSize).toBeUndefined();
  });

  it('applying the appearance sets the window zoom, 1 when unset', () => {
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel' });
    applyAppearance({ mode: 'dark', base: 'slate', accent: 'steel', textSize: 1.5 });
    expect(zoomCalls).toEqual([1, 1.5]);
  });

  it('setTextSize changes only the size, saves it and announces it', () => {
    writeAppearance({ mode: 'light', base: 'warm', accent: 'sage', font: 'georgia' });
    const heard: unknown[] = [];
    const listener = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener(APPEARANCE_CHANGED_EVENT, listener);
    try {
      expect(setTextSize(1.25)).toBe(1.25);
    } finally {
      window.removeEventListener(APPEARANCE_CHANGED_EVENT, listener);
    }
    expect(readAppearance()).toMatchObject({ mode: 'light', base: 'warm', accent: 'sage', font: 'georgia', textSize: 1.25 });
    expect(zoomCalls.at(-1)).toBe(1.25);
    expect(heard).toHaveLength(1);
  });

  it('a saved theme never carries the text size', () => {
    const preset = savePreset('Big', { mode: 'dark', base: 'slate', accent: 'steel', textSize: 1.5 });
    expect(preset.textSize).toBeUndefined();
  });
});

describe('text size keys', () => {
  const key = (init: KeyboardEventInit) => keyFromEvent(new KeyboardEvent('keydown', init));

  it('tells the number pad from the top row', () => {
    expect(key({ key: '0', code: 'Numpad0', ctrlKey: true })).toBe('ctrl+numpad0');
    expect(key({ key: '0', code: 'Digit0', ctrlKey: true })).toBe('ctrl+0');
    expect(key({ key: '+', code: 'NumpadAdd', ctrlKey: true })).toBe('ctrl+numpadadd');
    expect(key({ key: '-', code: 'NumpadSubtract', ctrlKey: true })).toBe('ctrl+numpadsubtract');
    // Num Lock off: the pad's 0 is Insert, and stays Insert.
    expect(key({ key: 'Insert', code: 'Numpad0', ctrlKey: true })).toBe('ctrl+insert');
  });

  it('names "+" plus, so Ctrl+Shift+= and a "+" key can be bound', () => {
    expect(key({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true })).toBe('ctrl+shift+plus');
    expect(key({ key: '=', code: 'Equal', ctrlKey: true })).toBe('ctrl+=');
    expect(key({ key: '-', code: 'Minus', ctrlKey: true })).toBe('ctrl+-');
  });

  it('every text size binding normalizes to what the keyboard produces', () => {
    const produced = new Set([
      key({ key: '=', code: 'Equal', ctrlKey: true }), key({ key: '-', code: 'Minus', ctrlKey: true }),
      key({ key: '0', code: 'Numpad0', ctrlKey: true }), key({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }),
      key({ key: '+', code: 'BracketRight', ctrlKey: true }), key({ key: '+', code: 'NumpadAdd', ctrlKey: true }),
      key({ key: '-', code: 'NumpadSubtract', ctrlKey: true }),
    ]);
    const bound = [...ALL_TEXT_SIZE_COMMANDS.map((c) => c.keybinding!), ...TEXT_SIZE_EXTRA_KEYBINDINGS.map((b) => b.key)].map(normalizeKeybinding);
    for (const b of bound) expect(produced, b).toContain(b);
  });

  it('the keys yield while focus is inside a surface with its own zoom', () => {
    const set = vi.fn();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const tracker = new FocusTracker(root, { setContext: set } as never);
    const sheet = document.createElement('div');
    sheet.setAttribute(DATA_OWNS_ZOOM, '');
    const cell = document.createElement('input');
    sheet.appendChild(cell);
    const outside = document.createElement('input');
    root.append(sheet, outside);
    cell.focus();
    expect(set).toHaveBeenLastCalledWith(CTX_FOCUS_OWNS_ZOOM, true);
    outside.focus();
    expect(set).toHaveBeenLastCalledWith(CTX_FOCUS_OWNS_ZOOM, false);
    for (const c of ALL_TEXT_SIZE_COMMANDS) expect(c.keybindingWhen).toBe(`!${CTX_FOCUS_OWNS_ZOOM}`);
    expect(ALL_TEXT_SIZE_COMMANDS.every((c) => c.when === undefined)).toBe(true); // menus and palette always work
    tracker.dispose();
  });
});

describe('Settings › Appearance › Text size', () => {
  const pressed = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[data-text-size]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

  it('lists the five sizes, picks one, and follows a change made by the keys', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new PxAppearancePanel(host);
    expect([...host.querySelectorAll('[data-text-size]')].map((b) => b.textContent)).toEqual(['90%', '100%', '110%', '125%', '150%']);
    expect(pressed(host)).toEqual(['100%']);
    host.querySelector<HTMLButtonElement>('[data-text-size="1.25"]')!.click();
    expect(readAppearance().textSize).toBe(1.25);
    expect(zoomCalls.at(-1)).toBe(1.25);
    setTextSize(1.5);
    expect(pressed(host)).toEqual(['150%']);
    panel.dispose();
  });

  it('applying a saved theme leaves the text size alone', () => {
    writeAppearance({ mode: 'dark', base: 'slate', accent: 'steel', textSize: 1.25 });
    savePreset('Paper', { mode: 'light', base: 'warm', accent: 'sage' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new PxAppearancePanel(host);
    const apply = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.title === 'Apply Paper')!;
    apply.click();
    expect(readAppearance()).toMatchObject({ mode: 'light', base: 'warm', accent: 'sage', textSize: 1.25 });
    panel.dispose();
  });
});
