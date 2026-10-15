/**
 * Painting-plan math (M104 Part B), extracted verbatim from Media Organizer's
 * @mo-plan-pure region: the recipe defaults, rotation, the canvas-locked
 * crop and its clamp, the transfer grid and output names; palette and colour
 * science from colour.js.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error a plain JS module of the extension
import { moSquintAt, moSquintPos } from '../../ext/media-organizer/plan-kit.js';
// @ts-expect-error a plain JS module of the extension
import { moPlanIsolateNormalize } from '../../ext/media-organizer/plan-isolate.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain ES module without types
import { moValueSwatches, moPalette, moOklab, moFromOklab, moColourName, moMixRecipes, moMixLinear, moPaintPrep, MO_COMMON_PAINTS, MO_STARTER_PAINTS } from '../../ext/media-organizer/colour.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPure(): Record<string, any> {
  const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  const a = src.indexOf('// @mo-plan-pure-begin');
  const b = src.indexOf('// @mo-plan-pure-end');
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const names = ['MO_PLAN_CANVAS_PRESETS', 'moPlanDefaultRecipe', 'moPlanNormalizeRecipe', 'moPlanRotatedSize', 'moPlanFitCrop', 'moPlanCanvasFor', 'moPlanClampCrop',
    'moPlanGridLines', 'moPlanHex', 'moPlanOutputName'];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  // the block's one import comes in as a parameter
  return new Function('moPlanIsolateNormalize', src.slice(a, b) + `\nreturn { ${names.join(', ')} };`)(moPlanIsolateNormalize);
}
const P = loadPure();
const pixels = (...runs: [number, number[]][]) => { const out: number[] = []; for (const [n, c] of runs) for (let i = 0; i < n; i++) out.push(c[0], c[1], c[2], 255); return new Uint8Array(out); };

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
  it('gives a new plan a canvas in the proportions of its picture, so the whole picture fits uncropped', () => {
    expect(P.moPlanCanvasFor(3000, 2000)).toEqual({ canvas_w: 20, canvas_h: 13.3 });
    expect(P.moPlanCanvasFor(2000, 3000)).toEqual({ canvas_w: 13.3, canvas_h: 20 });
    expect(P.moPlanCanvasFor(4000, 4000)).toEqual({ canvas_w: 20, canvas_h: 20 });
    const c = P.moPlanCanvasFor(4032, 3024);
    const fit = P.moPlanFitCrop(4032, 3024, c.canvas_w / c.canvas_h);
    expect(fit.w * fit.h).toBeGreaterThan(0.99);
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
  it('finds the dominant colours of a two-tone picture, largest share first', () => {
    const sw = moPalette(pixels([300, [250, 10, 10]], [100, [10, 10, 250]]), 2);
    expect(sw.length).toBe(2);
    expect(sw[0].rgb).toEqual([250, 10, 10]);
    expect(sw[0].share).toBeCloseTo(0.75, 6);
    expect(sw[1].rgb).toEqual([10, 10, 250]);
  });
  it('keeps a small accent colour apart from a large field of near shades', () => {
    const sw = moPalette(pixels([2000, [40, 90, 40]], [2000, [46, 98, 44]], [2000, [52, 104, 50]], [60, [230, 200, 20]]), 3);
    expect(sw.some((s: { rgb: number[] }) => s.rgb[0] > 200 && s.rgb[2] < 60)).toBe(true);
  });
  it('merges swatches the eye would call the same, and is the same every time', () => {
    const px = pixels([500, [120, 60, 30]], [500, [121, 60, 31]]);
    expect(moPalette(px, 8).length).toBe(1);
    expect(moPalette(px, 8)).toEqual(moPalette(px, 8));
  });
  it('never returns more swatches than colours, skips transparent pixels, and formats hex', () => {
    expect(moPalette(pixels([1, [1, 2, 3]]), 8).length).toBe(1);
    expect(moPalette(new Uint8Array([9, 9, 9, 0]), 8)).toEqual([]);
    expect(moPalette(new Uint8Array(0), 8)).toEqual([]);
    expect(P.moPlanHex([255, 0, 128])).toBe('#ff0080');
  });
  it('round-trips sRGB through OKLab', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [200, 40, 90], [12, 140, 220]]) expect(moFromOklab(...(moOklab(c[0], c[1], c[2]) as [number, number, number]))).toEqual(c);
    expect(moOklab(255, 255, 255)[0]).toBeCloseTo(1, 4);
  });
});

describe('colour names and paint mixing', () => {
  const paint = (n: string) => moPaintPrep(MO_COMMON_PAINTS.find((p: { name: string }) => p.name === n));
  const hue = (lin: number[]) => { const c = moOklab(...(lin.map((v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055))) as [number, number, number])); return ((Math.atan2(c[2], c[1]) * 180) / Math.PI + 360) % 360; };
  it('names colours the way a painter would, with a value step', () => {
    expect(moColourName([93, 111, 60]).name).toBe('Olive green');
    expect(moColourName([245, 245, 245]).name).toBe('White');
    expect(moColourName([20, 20, 20])).toMatchObject({ name: 'Black', value: 1 });
    expect(moColourName([74, 47, 34]).name).toMatch(/brown/i);
  });
  it('mixes like pigment: blue and yellow make green, white lightens', () => {
    const g = moMixLinear([paint('Cadmium Yellow Light'), paint('Ultramarine Blue')], [1, 1]);
    expect(hue(g)).toBeGreaterThan(115);
    expect(hue(g)).toBeLessThan(165);
    const pale = moMixLinear([paint('Titanium White'), paint('Ultramarine Blue')], [1, 1]);
    expect(pale[2]).toBeGreaterThan(moMixLinear([paint('Ultramarine Blue')], [1])[2]);
    expect(moMixLinear([paint('Yellow Ochre')], [1]).map((v: number) => Math.round(v * 1000))).toEqual(moMixLinear([paint('Yellow Ochre')], [1]).map((v: number) => Math.round(v * 1000)));
  });
  it('finds a close recipe in whole parts within the rules', () => {
    const { best, simpler } = moMixRecipes([93, 111, 60], MO_STARTER_PAINTS, { max: 3 });
    expect(best.de).toBeLessThan(0.045);
    expect(best.paints.filter((p: { name: string }) => p.name !== 'Titanium White').length).toBeLessThanOrEqual(3);
    for (const p of best.paints) expect(p.touch || Number.isInteger(p.parts)).toBe(true);
    if (simpler) expect(simpler.paints.length).toBeLessThan(best.paints.length + 1);
    const two = moMixRecipes([93, 111, 60], MO_STARTER_PAINTS, { max: 2, whiteFree: false });
    expect(two.best.paints.length).toBeLessThanOrEqual(2);
    const noBlack = moMixRecipes([40, 40, 40], [...MO_STARTER_PAINTS, MO_COMMON_PAINTS[1]], { noBlack: true });
    expect(noBlack.best.paints.some((p: { name: string }) => p.name === 'Ivory Black')).toBe(false);
  });
});

describe('output name', () => {
  it('sits beside the original as a numbered jpeg', () => {
    expect(P.moPlanOutputName('boxing.jpg', 1)).toBe('boxing_plan_1.jpg');
    expect(P.moPlanOutputName('IMG_0001.HEIC', 3)).toBe('IMG_0001_plan_3.jpg');
    expect(P.moPlanOutputName('noext', 2)).toBe('noext_plan_2.jpg');
  });
});

describe('a values palette', () => {
  it('is the values the picture is laid in, darkest first: its bands, or light and shadow', () => {
    const five = moValueSwatches(5, 0, '');
    expect(five).toHaveLength(5);
    expect(five.every((c: number[]) => c[0] === c[1] && c[1] === c[2])).toBe(true);
    expect(five.map((c: number[]) => c[0])).toEqual([...five.map((c: number[]) => c[0])].sort((a, b) => a - b));
    expect(moValueSwatches(0, 0.6, '')).toHaveLength(2);
    expect(moValueSwatches(0, 0, '')).toHaveLength(9);
  });
  it('in an underpainting paint, keeps the paint’s hue', () => {
    const [, mid] = moValueSwatches(3, 0, 'Burnt Sienna');
    expect(mid[0]).toBeGreaterThan(mid[2]);
  });
});

describe('the squint slider', () => {
  it('gives the first half of its travel to 0 to 10%, and reaches 100% at the end', () => {
    expect(moSquintAt(0)).toBe(0);
    expect(moSquintAt(50)).toBe(10);
    expect(moSquintAt(100)).toBe(100);
    expect(moSquintAt(25)).toBeLessThan(3);
    for (const pct of [0, 1, 2.5, 5, 10, 30, 100]) expect(Math.abs(moSquintAt(moSquintPos(pct)) - pct)).toBeLessThanOrEqual(Math.max(0.2, pct * 0.05));
  });
});
