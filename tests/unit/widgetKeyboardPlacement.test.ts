// widgetKeyboardPlacement.test.ts — Alt+arrows move a dashboard widget a
// cell, Alt+Shift+arrows size it, inside the grid and its size bounds.
// docs/ACCESSIBILITY.md, section 6.

import { describe, it, expect } from 'vitest';
import { placementForKey } from '../../src/built-in/dashboard/widgetKeyboardPlacement.js';

const at = { col: 2, row: 1, colSpan: 4, rowSpan: 2 };
const key = (k: string, shift = false) => ({ key: k, altKey: true, shiftKey: shift, ctrlKey: false, metaKey: false });

describe('placementForKey', () => {
  it('moves a cell at a time and stops at the grid edges', () => {
    expect(placementForKey(at, key('ArrowRight'), undefined, 12)).toEqual({ ...at, col: 3 });
    expect(placementForKey(at, key('ArrowUp'), undefined, 12)).toEqual({ ...at, row: 0 });
    expect(placementForKey({ ...at, col: 0 }, key('ArrowLeft'), undefined, 12)).toBeNull();
    expect(placementForKey({ ...at, col: 8 }, key('ArrowRight'), undefined, 12)).toBeNull();
  });

  it('sizes within the type bounds and the grid', () => {
    expect(placementForKey(at, key('ArrowRight', true), undefined, 12)).toEqual({ ...at, colSpan: 5 });
    expect(placementForKey(at, key('ArrowDown', true), undefined, 12)).toEqual({ ...at, rowSpan: 3 });
    expect(placementForKey(at, key('ArrowLeft', true), { minColSpan: 4 }, 12)).toBeNull();
    expect(placementForKey({ ...at, col: 8 }, key('ArrowRight', true), undefined, 12)).toBeNull();
  });

  it('leaves other keys alone', () => {
    expect(placementForKey(at, { ...key('ArrowRight'), altKey: false }, undefined, 12)).toBeNull();
    expect(placementForKey(at, { ...key('ArrowRight'), ctrlKey: true }, undefined, 12)).toBeNull();
    expect(placementForKey(at, key('Enter'), undefined, 12)).toBeNull();
  });
});
