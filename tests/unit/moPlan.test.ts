/**
 * Painting-plan math (M104 Part B), extracted verbatim from Media Organizer's
 * @mo-plan-pure region: the recipe defaults, rotation, the canvas-locked
 * crop and its clamp, the transfer grid, k-means swatches and output names.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPure(): Record<string, any> {
  const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  const a = src.indexOf('// @mo-plan-pure-begin');
  const b = src.indexOf('// @mo-plan-pure-end');
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const names = ['MO_PLAN_CANVAS_PRESETS', 'moPlanDefaultRecipe', 'moPlanNormalizeRecipe', 'moPlanRotatedSize', 'moPlanFitCrop', 'moPlanClampCrop',
    'moPlanGridLines', 'moPlanKMeans', 'moPlanHex', 'moPlanOutputName'];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(src.slice(a, b) + `\nreturn { ${names.join(', ')} };`)();
}
const P = loadPure();
const rng = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

describe('recipe', () => {
  it('normalizes a partial stored recipe and wraps rotation', () => {
    const r = P.moPlanNormalizeRecipe({ exposure: 0.5, rotate: 5, overlays: { grid: true }, palette: { swatches: [[1, 2, 3]] } });
    expect(r.exposure).toBe(0.5);
    expect(r.rotate).toBe(1);
    expect(r.overlays.grid).toBe(true);
    expect(r.overlays.thirds).toBe(false);
    expect(r.palette.count).toBe(8);
    expect(r.palette.swatches).toEqual([[1, 2, 3]]);
    expect(r.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it('lists the common canvas sizes', () => {
    expect(P.MO_PLAN_CANVAS_PRESETS).toContainEqual([16, 20]);
  });
});

describe('rotation and crop', () => {
  it('quarter turns swap the sides', () => {
    expect(P.moPlanRotatedSize(3000, 2000, 1)).toEqual({ w: 2000, h: 3000 });
    expect(P.moPlanRotatedSize(3000, 2000, 2)).toEqual({ w: 3000, h: 2000 });
    expect(P.moPlanRotatedSize(3000, 2000, -1)).toEqual({ w: 2000, h: 3000 });
  });
  it('fits the largest centred crop at the canvas proportions', () => {
    // landscape photo, portrait 16x20 canvas: full height, narrower width
    const c = P.moPlanFitCrop(3000, 2000, 16 / 20);
    expect(c.h).toBe(1);
    expect(c.w).toBeCloseTo((0.8 * 2000) / 3000, 6);
    expect(c.x).toBeCloseTo((1 - c.w) / 2, 6);
    // portrait photo, landscape canvas: full width
    const d = P.moPlanFitCrop(2000, 3000, 20 / 16);
    expect(d.w).toBe(1);
    expect(d.h).toBeCloseTo((2000 / 1.25) / 3000, 6);
  });
  it('clamps a crop back inside the image, keeping proportions', () => {
    const c = P.moPlanClampCrop({ x: 0.9, y: 0.5, w: 0.5, h: 0.2 }, 3000, 2000, 0.8);
    expect(c.w).toBeCloseTo(0.5, 6);
    expect(c.h).toBeCloseTo((0.5 * 3000) / (0.8 * 2000), 6);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
    const big = P.moPlanClampCrop({ x: 0, y: 0, w: 5, h: 5 }, 3000, 2000, 0.8);
    const fit = P.moPlanFitCrop(3000, 2000, 0.8);
    expect(big.w).toBeCloseTo(fit.w, 9);
    expect(big.h).toBeCloseTo(fit.h, 9);
    expect(big.x).toBe(0);
  });
});

describe('transfer grid', () => {
  it('lays a line every inch across a 16 x 20 canvas', () => {
    const g = P.moPlanGridLines(16, 20, 1);
    expect(g.xs.length).toBe(15);
    expect(g.ys.length).toBe(19);
    expect(g.xs[0]).toBeCloseTo(1 / 16, 9);
    expect(g.cols).toBe(16);
    expect(g.rows).toBe(20);
  });
  it('spaces at two inches', () => {
    const g = P.moPlanGridLines(16, 20, 2);
    expect(g.xs.length).toBe(7);
    expect(g.ys.length).toBe(9);
  });
});

describe('palette', () => {
  it('finds the dominant colours of a two-tone sample, largest share first', () => {
    const samples: number[][] = [];
    for (let i = 0; i < 300; i++) samples.push([250, 10, 10]);
    for (let i = 0; i < 100; i++) samples.push([10, 10, 250]);
    const sw = P.moPlanKMeans(samples, 2, 8, rng(3));
    expect(sw.length).toBe(2);
    expect(sw[0].rgb).toEqual([250, 10, 10]);
    expect(sw[0].share).toBeCloseTo(0.75, 6);
    expect(sw[1].rgb).toEqual([10, 10, 250]);
  });
  it('never returns more swatches than samples, and formats hex', () => {
    expect(P.moPlanKMeans([[1, 2, 3]], 8, 4, rng(1)).length).toBe(1);
    expect(P.moPlanKMeans([], 8, 4, rng(1))).toEqual([]);
    expect(P.moPlanHex([255, 0, 128])).toBe('#ff0080');
  });
});

describe('output name', () => {
  it('sits beside the original as a numbered jpeg', () => {
    expect(P.moPlanOutputName('boxing.jpg', 1)).toBe('boxing_plan_1.jpg');
    expect(P.moPlanOutputName('IMG_0001.HEIC', 3)).toBe('IMG_0001_plan_3.jpg');
    expect(P.moPlanOutputName('noext', 2)).toBe('noext_plan_2.jpg');
  });
});
