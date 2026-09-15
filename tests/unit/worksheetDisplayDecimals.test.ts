// Worksheets: decimals shown for unformatted numbers. The stored value keeps
// full precision; only what a cell without a number format paints changes.
import { describe, it, expect } from 'vitest';
import { roundForDisplay, parseDisplayDecimals, DISPLAY_DECIMALS_CHOICES } from '../../src/built-in/worksheet/displayNumbers.js';

describe('roundForDisplay', () => {
  it('trims a long fraction to the decimals chosen', () => {
    expect(roundForDisplay(1 / 3, 4)).toBe(0.3333);
    expect(roundForDisplay(22 / 7, 2)).toBe(3.14);
    expect(roundForDisplay(142.857142857143, 6)).toBe(142.857143);
    expect(roundForDisplay(0.1 + 0.2, 4)).toBe(0.3);
    expect(roundForDisplay(-7.26, 1)).toBe(-7.3);
  });
  it('leaves integers, short values and full mode alone', () => {
    expect(roundForDisplay(100, 4)).toBe(100);
    expect(roundForDisplay(2.5, 4)).toBe(2.5);
    expect(roundForDisplay(1 / 3, null)).toBe(1 / 3);
    expect(roundForDisplay(Infinity, 4)).toBe(Infinity);
    expect(roundForDisplay(NaN, 4)).toBeNaN();
  });
  it('keeps three significant digits when the rounding would read as zero', () => {
    expect(roundForDisplay(1e-7, 4)).toBe(1e-7);
    expect(roundForDisplay(0.000123456, 2)).toBe(0.000123);
    expect(roundForDisplay(-0.00004, 4)).toBe(-0.00004);
    expect(roundForDisplay(0, 4)).toBe(0);
  });
});

describe('parseDisplayDecimals', () => {
  it('reads the setting, with 4 as the default', () => {
    expect(parseDisplayDecimals('2')).toBe(2);
    expect(parseDisplayDecimals(6)).toBe(6);
    expect(parseDisplayDecimals('full')).toBeNull();
    expect(parseDisplayDecimals(undefined)).toBe(4);
    expect(parseDisplayDecimals('lots')).toBe(4);
    expect(parseDisplayDecimals(99)).toBe(4);
    expect(DISPLAY_DECIMALS_CHOICES).toEqual(['2', '4', '6', '8', 'full']);
  });
});
