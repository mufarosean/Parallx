// @vitest-environment jsdom
//
// layoutPopup.test.ts — popup placement (shared by every menu and popover)
//
// Written after a real, visible bug: the activity-bar gear menu positioned
// itself from a GUESSED height (`items.length * 28 + 24`) and passed a fixed
// point anchor, bypassing this function entirely. The guess counted rows but
// not the separators between groups or the menu's own padding, so the menu
// floated well above the gear with an obvious gap.
//
// The lesson these tests encode: placement must be derived from the MEASURED
// element, and callers should hand over a rect plus a preferred side rather
// than doing the arithmetic themselves.
//
// jsdom performs no layout, so offsetWidth/offsetHeight are 0 unless stubbed —
// which is also precisely why a DOM-level test of the menu could not have
// caught this, and why the check belongs here.

import { describe, it, expect, beforeEach } from 'vitest';
import { layoutPopup } from '../../src/ui/dom.js';

const GAP = 4;      // layoutPopup's default
const MARGIN = 8;   // layoutPopup's default viewport margin

function popup(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  document.body.appendChild(el);
  return el;
}

function viewport(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}

const top = (el: HTMLElement) => parseFloat(el.style.top);
const left = (el: HTMLElement) => parseFloat(el.style.left);

beforeEach(() => {
  document.body.replaceChildren();
  viewport(1280, 800);
});

describe('layoutPopup — anchored above (the gear-menu case)', () => {
  it('sits FLUSH above the anchor, using the measured height', () => {
    // The bug in one assertion: with a 260px-tall menu and a gear at y=700,
    // the top must be 700 - 4 - 260 = 436. A guessed height of 248 would have
    // produced 448 — a 12px gap, visible on screen.
    const el = popup(220, 260);
    const anchor = new DOMRect(48, 700, 0, 24);

    layoutPopup(el, anchor, { position: 'above' });

    expect(top(el)).toBe(700 - GAP - 260);
  });

  it('tracks the real height rather than any fixed assumption', () => {
    // Same anchor, three different menu heights — each must land flush.
    for (const h of [120, 260, 401]) {
      const el = popup(220, h);
      layoutPopup(el, new DOMRect(48, 700, 0, 24), { position: 'above' });
      expect(top(el), `height ${h}`).toBe(700 - GAP - h);
    }
  });

  it('takes its horizontal origin from the rect, so it can clear the activity bar', () => {
    // The gear menu passes a zero-width rect at the bar's right edge; the
    // popup must start there rather than over the bar.
    const el = popup(220, 260);
    layoutPopup(el, new DOMRect(52, 700, 0, 24), { position: 'above' });
    expect(left(el)).toBe(52);
  });

  it('flips below when there is no room above', () => {
    const el = popup(220, 300);
    const anchor = new DOMRect(48, 40, 0, 24); // near the top of the screen
    layoutPopup(el, anchor, { position: 'above' });
    expect(top(el)).toBe(40 + 24 + GAP);
  });

  it('stays on screen when it fits neither above nor below', () => {
    viewport(1280, 400);
    const el = popup(220, 380);
    layoutPopup(el, new DOMRect(48, 200, 0, 24), { position: 'above' });
    expect(top(el)).toBeGreaterThanOrEqual(MARGIN);
    expect(top(el) + 380).toBeLessThanOrEqual(400);
  });

  it('caps the height and scrolls rather than clipping', () => {
    viewport(1280, 300);
    const el = popup(220, 600);
    layoutPopup(el, new DOMRect(48, 250, 0, 24), { position: 'above' });
    expect(el.style.maxHeight).toBeTruthy();
    expect(el.style.overflowY).toBe('auto');
  });
});

describe('layoutPopup — other placements', () => {
  it('places below by default, flush under the anchor', () => {
    const el = popup(200, 150);
    layoutPopup(el, new DOMRect(100, 100, 80, 30));
    expect(top(el)).toBe(130 + GAP);
    expect(left(el)).toBe(100);
  });

  it('flips above when it would overflow the bottom', () => {
    const el = popup(200, 300);
    layoutPopup(el, new DOMRect(100, 700, 80, 30), { position: 'below' });
    expect(top(el)).toBe(700 - GAP - 300);
  });

  it('places to the right, and flips left when it would overflow', () => {
    const wide = popup(400, 100);
    layoutPopup(wide, new DOMRect(1000, 300, 40, 24), { position: 'right' });
    expect(left(wide)).toBe(1000 - GAP - 400);

    const narrow = popup(100, 100);
    layoutPopup(narrow, new DOMRect(200, 300, 40, 24), { position: 'right' });
    expect(left(narrow)).toBe(240 + GAP);
  });

  it('clamps a point anchor into the viewport', () => {
    const el = popup(300, 200);
    layoutPopup(el, { x: 1270, y: 790 });
    expect(left(el) + 300).toBeLessThanOrEqual(1280 - MARGIN + 1);
    expect(top(el) + 200).toBeLessThanOrEqual(800 - MARGIN + 1);
  });

  it('honours a custom gap', () => {
    const el = popup(200, 150);
    layoutPopup(el, new DOMRect(100, 400, 80, 30), { position: 'above', gap: 12 });
    expect(top(el)).toBe(400 - 12 - 150);
  });
});
