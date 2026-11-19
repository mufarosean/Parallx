// moLightRow.test.ts — Colour Study's Light to Shadow row (paint-engine.js,
// moVariationRows). The owner's point: "A cool dark and a warm dark are
// different." Warm light gives cool shadows and cool light gives warm ones,
// so switching the light changes the dark end of the row as much as the
// light end, for every hue, including one near the shadow's opposite (a
// yellow under warm light, whose blue violet shadow is nearly across the wheel).
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { moVariationRows } from '../../ext/media-organizer/paint-engine.js';
// @ts-expect-error — JS module with no types
import { moOklab } from '../../ext/media-organizer/colour.js';

type Rgb = [number, number, number];
type Cell = { rgb: Rgb; value: number };
const BASES: [string, Rgb][] = [
  ['yellow ochre', [200, 160, 40]],
  ['olive', [93, 111, 60]],
  ['teal', [73, 140, 138]],
  ['red', [190, 50, 45]],
  ['violet', [110, 70, 140]],
];
// How warm a colour is: its OKLab colour along the direction of orange (60°) against blue.
const warmth = (rgb: Rgb) => { const [, a, b] = moOklab(rgb[0], rgb[1], rgb[2]); return a * Math.cos(Math.PI / 3) + b * Math.sin(Math.PI / 3); };
const dist = (p: Rgb, q: Rgb) => { const x = moOklab(...p), y = moOklab(...q); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const rows = (base: Rgb) => ({ warm: moVariationRows(base, { light: 'warm' }).light as Cell[], cool: moVariationRows(base, { light: 'cool' }).light as Cell[] });

describe('Light to Shadow, warm light and cool light', () => {
  it('the shadows under warm light are cooler than the shadows under cool light', () => {
    for (const [name, base] of BASES) {
      const { warm, cool } = rows(base);
      for (const i of [0, 1, 2]) expect(warmth(warm[i].rgb), `${name}, cell ${i + 1}`).toBeLessThan(warmth(cool[i].rgb));
    }
  });

  it('the lights under warm light are warmer than the lights under cool light', () => {
    for (const [name, base] of BASES) {
      const { warm, cool } = rows(base);
      for (const i of [7, 8]) expect(warmth(warm[i].rgb), `${name}, cell ${i + 1}`).toBeGreaterThan(warmth(cool[i].rgb));
    }
  });

  it('switching the light changes the dark end visibly, not only the light end', () => {
    for (const [name, base] of BASES) {
      const { warm, cool } = rows(base);
      expect(dist(warm[1].rgb, cool[1].rgb), name).toBeGreaterThan(0.02);
    }
  });

  it('the light does not move the values: each cell keeps its place from dark to light', () => {
    for (const [name, base] of BASES) {
      const { warm, cool } = rows(base);
      warm.forEach((c, i) => expect(Math.abs(c.value - cool[i].value), `${name}, cell ${i + 1}`).toBeLessThan(0.15));
    }
  });
});
