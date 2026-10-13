// @vitest-environment jsdom
// viewSectionResize.test.ts — stacked sections resize, and view tabs reorder, from the keyboard the
// way their sash drag does: zero-sum against the neighbour, never below the
// minimum body height. docs/ACCESSIBILITY.md, section 6.

import { describe, it, expect, afterEach } from 'vitest';
import { ViewContainer } from '../../src/views/viewContainer.js';

const fakeView = (id: string) => ({
  id, name: id,
  element: document.createElement('div'),
  createElement(parent: HTMLElement) { parent.appendChild(this.element); return this.element; },
  layout() {}, setVisible() {}, focus() {},
  saveState() { return {}; }, restoreState() {},
  dispose() {},
  minimumWidth: 0, maximumWidth: Infinity, minimumHeight: 0, maximumHeight: Infinity,
});

afterEach(() => { document.body.innerHTML = ''; });

describe('stacked section resize', () => {
  it('grows a section from its neighbour, the last one from the one above, within the minimum', () => {
    const c = new ViewContainer('sidebar');
    document.body.appendChild(c.element);
    c.setMode('stacked');
    for (const id of ['a', 'b']) c.addView(fakeView(id) as never);
    // jsdom lays nothing out: give each section body a height of 200.
    for (const body of c.element.querySelectorAll<HTMLElement>('.view-section-body')) Object.defineProperty(body, 'offsetHeight', { value: 200 });
    const basis = (id: string) => c.element.querySelector<HTMLElement>(`.view-section[data-view-id="${id}"]`)!.style.flex;
    expect(c.resizeSection('a', 24)).toBe(true);
    const a = parseInt(basis('a').split(' ')[2], 10), b = parseInt(basis('b').split(' ')[2], 10);
    expect(a - b).toBe(48);
    // The last section grows by shrinking the one above.
    expect(c.resizeSection('b', 24)).toBe(true);
    expect(parseInt(basis('a').split(' ')[2], 10)).toBe(parseInt(basis('b').split(' ')[2], 10));
    // Never past the neighbour's minimum.
    expect(c.resizeSection('a', 10_000)).toBe(true);
    expect(c.resizeSection('a', 24)).toBe(false);
    expect(c.resizeSection('missing', 24)).toBe(false);
    c.dispose();
  });
});

describe('view tab reorder from the keyboard', () => {
  it('moves the focused tab with Ctrl+Shift+Left/Right and keeps focus on it', () => {
    const c = new ViewContainer('panel');
    document.body.appendChild(c.element);
    for (const id of ['a', 'b', 'c']) c.addView(fakeView(id) as never);
    const order = () => Array.from(c.element.querySelectorAll<HTMLElement>('.view-tab')).map((t) => t.dataset.viewId);
    const tabA = c.element.querySelector<HTMLElement>('.view-tab[data-view-id="a"]')!;
    tabA.focus();
    const press = (key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    press('ArrowRight');
    expect(order()).toEqual(['b', 'a', 'c']);
    press('ArrowRight');
    expect(order()).toEqual(['b', 'c', 'a']);
    press('ArrowRight');
    expect(order()).toEqual(['b', 'c', 'a']);
    press('ArrowLeft');
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(document.activeElement).toBe(tabA);
    expect(c.saveContainerState().tabOrder).toEqual(['b', 'a', 'c']);
    c.dispose();
  });
});
