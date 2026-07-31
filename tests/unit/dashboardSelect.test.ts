// @vitest-environment jsdom
//
// dashboardSelect.test.ts — the dashboard's settings/appearance dropdowns.
//
// `createSelect` in dashboardEditorProvider.ts was a second implementation of the
// workbench's `.ui-dropdown`, and it carried the bugs that come with a copy: a
// capture-phase `window` scroll listener with no containment guard (so any option
// list past its 240px cap dismissed itself on the first wheel tick), and a popup
// left on `document.body` whenever a drawer closed while it was open.
//
// It is now a shim over the shared component. These tests import the REAL
// createSelect rather than rebuilding it, so a future edit that quietly forks the
// component again fails here instead of passing against a stand-in.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSelect } from '../../src/built-in/dashboard/dashboardEditorProvider.js';

const APPEARANCE = [
  { value: 'default', label: 'Theme default' },
  { value: 'transparent', label: 'Transparent' },
  { value: 'custom', label: 'Custom color' },
];

/** An `enum` config field from a contributed widget schema — unbounded in practice. */
const LONG_ENUM = Array.from({ length: 40 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }));

let made: Array<{ dispose(): void }> = [];
const trigger = (s: { el: HTMLElement }) => s.el.querySelector('.ui-dropdown__button') as HTMLButtonElement;
const list = () => document.querySelector('.ui-dropdown__list') as HTMLElement | null;

beforeEach(() => { made = []; });
afterEach(() => {
  for (const m of made) m.dispose();
  document.body.innerHTML = '';
});

function select(options = APPEARANCE, initial = 'default', onChange: (v: string) => void = () => {}) {
  const s = createSelect(options, initial, onChange);
  // createSelect builds its own host but does not attach it — the call sites do.
  document.body.appendChild(s.el);
  made.push(s);
  return s;
}

describe('dashboard select uses the shared component', () => {
  it('renders .ui-dropdown inside the .dashboard-select host', () => {
    const s = select();
    expect(s.el.querySelector('.ui-dropdown')).not.toBeNull();
  });

  it('emits none of the old clone markup', () => {
    const s = select();
    trigger(s).click();
    for (const dead of [
      '.dashboard-select__trigger', '.dashboard-select__popup',
      '.dashboard-select__option', '.dashboard-select__chevron',
    ]) {
      expect(document.querySelector(dead), `${dead} should be gone`).toBeNull();
    }
  });
});

describe('the scroll trap', () => {
  it('a long enum list stays open when scrolled', () => {
    // THE bug. Widget config `enum` options come from a contributed schema, so 40
    // is not a stretch — and past the list's max-height the old select could not
    // be scrolled at all.
    const s = select(LONG_ENUM, 'v0');
    trigger(s).click();
    const l = list()!;
    expect(l).not.toBeNull();
    l.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(list(), 'scrolling the option list dismissed it').not.toBeNull();
  });

  it('stays open when an option row is the scroll target', () => {
    const s = select(LONG_ENUM, 'v0');
    trigger(s).click();
    document.querySelector('.ui-dropdown__item')!.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(list()).not.toBeNull();
  });

  it('still closes when the settings drawer behind it scrolls', () => {
    const s = select();
    trigger(s).click();
    s.el.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(list()).toBeNull();
  });
});

describe('disposal — no orphaned popup over the dashboard', () => {
  it('removes an open list when disposed', () => {
    // The drawers close by removing their overlay. The old select only removed its
    // popup inside close(), so closing a drawer with the list open stranded it on
    // document.body, floating over the dashboard.
    const s = select();
    trigger(s).click();
    expect(list()).not.toBeNull();
    s.dispose();
    expect(list()).toBeNull();
  });

  it('stops reacting to scroll after disposal', () => {
    const s = select();
    s.dispose();
    expect(() => document.dispatchEvent(new Event('scroll'))).not.toThrow();
  });

  it('disposing several selects together is safe', () => {
    // What closeDrawer() does: the appearance drawer holds two.
    const a = select();
    const b = select();
    trigger(a).click();
    expect(() => { a.dispose(); b.dispose(); }).not.toThrow();
    expect(list()).toBeNull();
  });
});

describe('the getValue / setValue contract the call sites use', () => {
  it('reports the initial value', () => {
    expect(select(APPEARANCE, 'transparent').getValue()).toBe('transparent');
  });

  it('reports the picked value and notifies once', () => {
    const seen: string[] = [];
    const s = select(APPEARANCE, 'default', v => seen.push(v));
    trigger(s).click();
    (document.querySelectorAll('.ui-dropdown__item')[2] as HTMLElement).click();
    expect(s.getValue()).toBe('custom');
    expect(seen).toEqual(['custom']);
  });

  it('setValue updates the value WITHOUT firing onChange', () => {
    // Load-bearing: the appearance drawer calls setValue while syncing from a
    // draft it already owns, and a callback there would re-enter preview().
    const seen: string[] = [];
    const s = select(APPEARANCE, 'default', v => seen.push(v));
    s.setValue('custom');
    expect(s.getValue()).toBe('custom');
    expect(seen).toEqual([]);
  });

  it('shows the selected label on the trigger', () => {
    const s = select(APPEARANCE, 'custom');
    expect(trigger(s).textContent).toContain('Custom color');
  });
});
