/**
 * Image editor math (docs/IMAGE_EDITOR.md), extracted verbatim from Media
 * Organizer's @mo-edit-pure region: the recipe and its looks, the tone curve,
 * where each output pixel comes from, the crop and its straightening, zoom
 * and pan, the tiles a full-size save is drawn in, output names, the camera
 * data carried into a saved JPEG, Auto, white balance, Remove's window and
 * finding a removed mark in other photos.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPure(): Record<string, any> {
  const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  const a = src.indexOf('// @mo-edit-pure-begin');
  const b = src.indexOf('// @mo-edit-pure-end');
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const names = ['MO_EDIT_SLIDERS', 'MO_EDIT_SECTIONS', 'MO_EDIT_MIX', 'MO_EDIT_PRESETS', 'MO_EDIT_ASPECTS', 'MO_EDIT_CURVE_N', 'MO_EDIT_MODEL_SIDE',
    'moEditDefaultRecipe', 'moEditNormalizeRecipe', 'moEditNormalizeCurvePoints', 'moEditIsNeutral', 'moEditHasWork', 'moEditLookIsRest', 'moEditSectionIsRest',
    'moEditPickLook', 'moEditApplyLook', 'moEditFormatValue', 'moEditParseValue', 'moEditCurveLut', 'moEditCurveStrip', 'moEditCurveIsRest',
    'moEditEngineLook', 'moEditGradeTint', 'moEditMargin', 'moEditShownRemovals', 'MO_EDIT_PARTS',
    'moAffineMul', 'moAffineApply', 'moAffineInvert', 'moEditViewSize', 'moEditAffine', 'moEditFitZoom', 'moEditClampView', 'moEditViewMap',
    'moEditCropBox', 'moEditCropFromBox', 'moEditCropCorners', 'moEditCropFits', 'moEditCropScaled', 'moEditCropShrink', 'moEditCropIsLargest', 'moEditCropLargest',
    'moEditAspectRatio', 'moEditCropDrag', 'moEditTurn', 'moEditFlip', 'moEditCropView',
    'moEditTiles', 'moEditTileSource', 'moEditOutputExt', 'moEditOutputName', 'moEditSaveOverExt', 'moEditSavingName', 'moEditCarryExif',
    'moEditHistogram', 'moEditPercentile', 'moEditAutoTone', 'moEditWhiteBalance', 'moEditRemovalWindow', 'moEditStrokeBox',
    'moEditUpscalePercent', 'moEditStageSpan', 'moEditStageFraction',
    'MO_FIND_POINTS', 'MO_FIND_CHECK', 'MO_FIND_FEW', 'MO_FIND_LEAST', 'MO_FIND_PEAKS', 'MO_FIND_FOUND', 'MO_FIND_UNSURE', 'MO_FIND_FOUND_ALONE', 'MO_FIND_UNSURE_ALONE', 'MO_FIND_AGAIN',
    'moFindGray', 'moFindField', 'moFindTemplate', 'moFindScoreAt', 'moFindDense', 'moFindPeaks', 'moFindPlan', 'moFindShape', 'moFindCheck', 'moFindConsensus', 'moFindMatte', 'moFindShapeBox', 'moFindShapeRemoval', 'MO_FIND_FINE_NEAR', 'MO_FIND_FINE_REACH', 'moFindOnLevel', 'moFindMargin', 'moFindMerge', 'moFindRange', 'MO_FIND_MOST', 'MO_FIND_SIZE', 'moFindVerdict', 'moFindRemoval', 'moFindResize'];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(src.slice(a, b) + `\nreturn { ${names.join(', ')} };`)();
}
const E = loadPure();
const recipe = (change: Record<string, unknown> = {}) => E.moEditNormalizeRecipe({ ...E.moEditDefaultRecipe(), ...change });

describe('recipe', () => {
  it('starts neutral, with every control at rest', () => {
    const r = E.moEditDefaultRecipe();
    expect(E.moEditIsNeutral(r)).toBe(true);
    expect(E.moEditHasWork(r)).toBe(false);
    for (const [key, , , , rest] of E.MO_EDIT_SLIDERS) expect(r[key]).toBe(rest);
    expect(r.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(E.moEditNormalizeRecipe(null)).toEqual(r);
    expect(E.moEditNormalizeRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it('every slider belongs to exactly one section', () => {
    const inSections = E.MO_EDIT_SECTIONS.flatMap((s: any) => s[2].map((x: any) => x[0]));
    expect(inSections.slice().sort()).toEqual(E.MO_EDIT_SLIDERS.map((x: any) => x[0]).sort());
    expect(new Set(inSections).size).toBe(inSections.length);
  });
  it('fills what a stored recipe lacks and keeps numbers in range', () => {
    const r = E.moEditNormalizeRecipe({ exposure: 9, contrast: -5, shadows: 'x', warmth: 0.25, rotate: -1, crop: { x: 0.9, w: 0.5 }, flipH: 1,
      sharpen: 7, vignetteMid: null, mixer: { red: [2, 'a'] }, grading: { shadows: { h: 1.25, s: 4 } }, enhance: { scale: 3 }, off: ['light', 'nope'],
      removals: [{ file: 'r1.png', x: 1.4, y: 2, w: 10, h: 10 }, { file: '', x: 0, y: 0, w: 1, h: 1 }, { file: 'r2.png', x: 0, y: 0, w: 0, h: 5 }] });
    expect(r.exposure).toBe(2);
    expect(r.contrast).toBe(-1);
    expect(r.shadows).toBe(0);
    expect(r.warmth).toBe(0.25);
    expect(r.sharpen).toBe(1.5);
    expect(r.vignetteMid).toBe(0.5);
    expect(r.rotate).toBe(3);
    expect(r.crop).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(r.flipH).toBe(false);          // only a real true flips
    expect(r.mixer.red).toEqual([1, 0, 0]);
    expect(r.mixer.blue).toEqual([0, 0, 0]);
    expect(r.grading.shadows).toEqual({ h: 0.25, s: 1, l: 0 });
    expect(r.enhance).toEqual({ scale: 0, model: 'photo' });
    expect(r.off).toEqual(['light']);
    expect(r.removals).toEqual([{ file: 'r1.png', x: 1, y: 2, w: 10, h: 10 }]);
  });
  it('a leaning crop keeps its own box; an upright one is held inside the photo', () => {
    expect(E.moEditNormalizeRecipe({ angle: 10, crop: { x: -0.05, y: 0.2, w: 1.02, h: 0.5 } }).crop).toEqual({ x: -0.05, y: 0.2, w: 1.02, h: 0.5 });
    expect(E.moEditNormalizeRecipe({ angle: 0, crop: { x: -0.05, y: 0.2, w: 1.02, h: 0.5 } }).crop).toEqual({ x: 0, y: 0.2, w: 1, h: 0.5 });
  });
  it('is not neutral once anything changes the picture', () => {
    for (const change of [{ exposure: 0.01 }, { saturation: -0.5 }, { rotate: 1 }, { flipV: true }, { angle: 2 }, { crop: { x: 0, y: 0, w: 0.5, h: 1 } },
      { clarity: 0.2 }, { grain: 0.1 }, { sharpen: 0.4 }, { noise: 0.3 }, { bw: true }, { curve: { rgb: [[0, 0.1], [1, 1]] } },
      { mixer: { green: [0, 0.3, 0] } }, { grading: { highlights: { h: 0.1, s: 0.2, l: 0 } } }, { removals: [{ file: 'a.png', x: 0, y: 0, w: 4, h: 4 }] }]) {
      expect(E.moEditIsNeutral(recipe(change))).toBe(false);
    }
  });
  it('a control that only shapes another changes nothing on its own', () => {
    expect(E.moEditIsNeutral(recipe({ vignetteMid: 0.9, vignetteFeather: 0.1, grainSize: 1, sharpenRadius: 3 }))).toBe(true);
  });
  it('Enhance alone is work to save, though it changes no pixel here', () => {
    const r = recipe({ enhance: { scale: 2, model: 'art' } });
    expect(E.moEditIsNeutral(r)).toBe(true);
    expect(E.moEditHasWork(r)).toBe(true);
  });
  it('tells which section is off rest, the curve with Light and the mixer with Colour', () => {
    expect(E.moEditSectionIsRest(recipe({ curve: { r: [[0, 0], [0.5, 0.6], [1, 1]] } }), 'light')).toBe(false);
    expect(E.moEditSectionIsRest(recipe({ mixer: { red: [0.1, 0, 0] } }), 'colour')).toBe(false);
    expect(E.moEditSectionIsRest(recipe({ clarity: 0.3 }), 'light')).toBe(true);
    expect(E.moEditSectionIsRest(recipe({ clarity: 0.3 }), 'effects')).toBe(false);
  });
  it('formats and reads back what is shown beside a slider', () => {
    expect(E.moEditFormatValue('exposure', 0.35)).toBe('+0.35');
    expect(E.moEditFormatValue('exposure', -0.001)).toBe('0.00');
    expect(E.moEditFormatValue('contrast', 0.25)).toBe('+25');
    expect(E.moEditFormatValue('contrast', -1)).toBe('-100');
    expect(E.moEditFormatValue('grain', 0.4)).toBe('40');            // from zero up: no sign
    expect(E.moEditFormatValue('sharpenRadius', 1.25)).toBe('1.3');
    expect(E.moEditParseValue('contrast', '+25')).toBe(0.25);
    expect(E.moEditParseValue('contrast', '400')).toBe(1);
    expect(E.moEditParseValue('exposure', '-0,5')).toBe(-0.5);
    expect(E.moEditParseValue('contrast', 'abc')).toBeNull();
    expect(E.moEditParseValue('contrast', ' ')).toBeNull();
  });
});

describe('looks: presets and Copy Edit', () => {
  it('a look carries the sliders, curve, mixer and grading, not the crop or removals', () => {
    const r = recipe({ exposure: 0.4, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, rotate: 1, removals: [{ file: 'a.png', x: 0, y: 0, w: 4, h: 4 }], mixer: { blue: [0, -0.4, 0] } });
    const look = E.moEditPickLook(r);
    expect(look.exposure).toBe(0.4);
    expect(look.mixer.blue).toEqual([0, -0.4, 0]);
    expect('crop' in look || 'rotate' in look || 'removals' in look).toBe(false);
    look.mixer.blue[1] = 9;                                          // a copy, not the recipe's own
    expect(r.mixer.blue[1]).toBe(-0.4);
  });
  it('pasting replaces the look and leaves the crop, turns and removals', () => {
    const target = recipe({ contrast: 0.5, crop: { x: 0.2, y: 0, w: 0.5, h: 1 }, rotate: 2, removals: [{ file: 'a.png', x: 0, y: 0, w: 4, h: 4 }], off: ['light'] });
    const out = E.moEditApplyLook(target, E.moEditPickLook(recipe({ exposure: 0.4, bw: true })));
    expect(out.exposure).toBe(0.4);
    expect(out.bw).toBe(true);
    expect(out.contrast).toBe(0);                                    // what the look does not set goes to rest
    expect(out.off).toEqual([]);
    expect(out.crop).toEqual({ x: 0.2, y: 0, w: 0.5, h: 1 });
    expect(out.rotate).toBe(2);
    expect(out.removals.length).toBe(1);
  });
  it('ships twelve looks, each changing the picture and each a valid look', () => {
    expect(E.MO_EDIT_PRESETS.length).toBe(12);
    const ids = new Set(E.MO_EDIT_PRESETS.map((p: any) => p[0]));
    expect(ids.size).toBe(12);
    for (const [, label, look] of E.MO_EDIT_PRESETS) {
      expect(label).not.toMatch(/[—&]/);
      const r = E.moEditApplyLook(E.moEditDefaultRecipe(), look);
      expect(E.moEditLookIsRest(r)).toBe(false);
      expect(E.moEditApplyLook(r, E.moEditPickLook(r))).toEqual(r);
    }
  });
});

describe('tone curve', () => {
  it('a straight line gives back what it is given', () => {
    const lut = E.moEditCurveLut([[0, 0], [1, 1]], 256);
    for (const i of [0, 1, 64, 128, 200, 255]) expect(lut[i]).toBeCloseTo(i / 255, 6);
    expect(E.moEditCurveIsRest(E.moEditDefaultRecipe().curve)).toBe(true);
  });
  it('passes through its points and never overshoots them', () => {
    const pts = [[0, 0], [0.25, 0.1], [0.5, 0.8], [0.75, 0.85], [1, 1]];
    const lut = E.moEditCurveLut(pts, 1001);
    for (const [x, y] of pts) expect(lut[Math.round(x * 1000)]).toBeCloseTo(y, 3);
    for (let i = 1; i < lut.length; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1e-6);   // rising points, rising line
    expect(Math.max(...lut)).toBeLessThanOrEqual(1);
  });
  it('keeps points in order, in the square, with the ends on the sides', () => {
    expect(E.moEditNormalizeCurvePoints([[0.7, 2], [0.2, -1], ['x', 1], [0.2, 0.5], [0.9, 0.4]])).toEqual([[0, 0], [0.7, 1], [1, 0.4]]);
    expect(E.moEditNormalizeCurvePoints([[0.5, 0.5]])).toEqual([[0, 0], [1, 1]]);
    expect(E.moEditNormalizeCurvePoints(Array.from({ length: 40 }, (_, i) => [i / 39, i / 39])).length).toBe(16);
  });
  it('the strip applies a channel curve and then the curve for all three', () => {
    const N = E.MO_EDIT_CURVE_N;
    const strip = E.moEditCurveStrip({ rgb: [[0, 0], [1, 0.5]], r: [[0, 1], [1, 0]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });
    expect(strip.length).toBe(N * 4);
    expect(strip[0]).toBe(128);                 // red: 0 -> 1 (inverted) -> 0.5 (halved)
    expect(strip[(N - 1) * 4]).toBe(0);         // red: 1 -> 0 -> 0
    expect(strip[(N - 1) * 4 + 1]).toBe(128);   // green: 1 -> 1 -> 0.5
    expect(strip[3]).toBe(255);
  });
});

describe('what the engine is handed', () => {
  it('Show Original and a hidden section both hand it rest values', () => {
    const r = recipe({ exposure: 1, vibrance: 0.4, clarity: 0.5, bw: true, curve: { rgb: [[0, 0.1], [1, 1]] }, mixer: { red: [0.2, 0, 0] }, grading: { shadows: { h: 0.6, s: 0.5, l: 0 } } });
    const on = E.moEditEngineLook(r, false);
    expect(on.look.exposure).toBe(1);
    expect(on.grey).toBe(true);
    expect(on.curve.length).toBe(E.MO_EDIT_CURVE_N * 4);
    expect(Array.from(on.mix.slice(0, 3))).toEqual([expect.closeTo(0.2, 6), 0, 0]);
    expect(on.grade.blend).toBe(0.5);
    const orig = E.moEditEngineLook(r, true);
    expect(orig.look.exposure).toBe(0);
    expect(orig.look.vignetteMid).toBe(0.5);
    expect(orig.grey).toBe(false);
    expect(orig.curve || orig.mix || orig.grade).toBeUndefined();
    const hidden = E.moEditEngineLook({ ...r, off: ['light', 'colour'] }, false);
    expect(hidden.look.exposure).toBe(0);
    expect(hidden.look.clarity).toBe(0.5);       // Effects is still shown
    expect(hidden.grey).toBe(false);
    expect(hidden.curve || hidden.mix || hidden.grade).toBeUndefined();
  });
  it('a grading colour pushes the channels without changing brightness', () => {
    const t = E.moEditGradeTint({ h: 0.6, s: 0.5, l: 0 });
    expect(0.299 * t[0] + 0.587 * t[1] + 0.114 * t[2]).toBeCloseTo(0, 9);
    expect(E.moEditGradeTint({ h: 0.6, s: 0, l: 0 }).every((v: number) => Math.abs(v) < 1e-12)).toBe(true);
  });
  it('a save reads further past a tile when a control looks at the neighbourhood', () => {
    expect(E.moEditMargin(recipe())).toBe(2);
    expect(E.moEditMargin(recipe({ sharpen: 0.5, sharpenRadius: 3 }))).toBe(5);
    expect(E.moEditMargin(recipe({ noise: 0.5 }))).toBe(6);
    expect(E.moEditMargin(recipe({ clarity: 0.2 }))).toBe(96);
  });
});

// What the plan shader did before the engine took a matrix: the same answers are owed.
function oldShaderMap(r: any, u: number, v: number): [number, number] {
  let px = r.crop.x + u * r.crop.w;
  let py = r.crop.y + v * r.crop.h;
  if (r.flipH) px = 1 - px;
  if (r.flipV) py = 1 - py;
  if (r.rotate === 1) return [py, 1 - px];
  if (r.rotate === 2) return [1 - px, 1 - py];
  if (r.rotate === 3) return [1 - py, px];
  return [px, py];
}

describe('where a pixel comes from', () => {
  it('is the identity for an untouched photo', () => {
    const g = E.moEditAffine(E.moEditDefaultRecipe(), 3000, 2000);
    expect([g.outW, g.outH]).toEqual([3000, 2000]);
    expect(g.m.map((x: number) => Math.round(x * 1e9) / 1e9)).toEqual([1, 0, 0, 0, 1, 0]);
  });
  it('matches the plan shader for every turn, flip and crop', () => {
    const crops = [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }];
    for (const crop of crops) for (let rotate = 0; rotate < 4; rotate++) for (const flipH of [false, true]) for (const flipV of [false, true]) {
      const r = { crop, rotate, flipH, flipV, angle: 0 };
      const g = E.moEditAffine(r, 3000, 2000);
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.7]]) {
        const got = E.moAffineApply(g.m, u, v);
        const want = oldShaderMap(r, u, v);
        expect(got[0]).toBeCloseTo(want[0], 9);
        expect(got[1]).toBeCloseTo(want[1], 9);
      }
    }
  });
  it('a quarter turn swaps the sides of the output; the crop sizes it', () => {
    expect(E.moEditViewSize(3000, 2000, 1)).toEqual({ w: 2000, h: 3000 });
    const g = E.moEditAffine({ ...E.moEditDefaultRecipe(), rotate: 1 }, 3000, 2000);
    expect([g.outW, g.outH]).toEqual([2000, 3000]);
    const c = E.moEditAffine({ ...E.moEditDefaultRecipe(), crop: { x: 0.25, y: 0, w: 0.5, h: 0.5 } }, 4000, 3000);
    expect([c.outW, c.outH]).toEqual([2000, 1500]);
  });
  it('straighten turns about the crop centre, keeping distances true', () => {
    const r = { ...E.moEditDefaultRecipe(), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, angle: 10 };
    const W = 3000; const H = 2000;
    const g = E.moEditAffine(r, W, H);
    const centre = E.moAffineApply(g.m, 0.5, 0.5);
    expect(centre[0]).toBeCloseTo(0.5, 9);
    expect(centre[1]).toBeCloseTo(0.5, 9);
    const a = E.moAffineApply(g.m, 0, 0); const b = E.moAffineApply(g.m, 1, 0);
    expect(Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H)).toBeCloseTo(0.5 * W, 6);
    expect((Math.atan2((b[1] - a[1]) * H, (b[0] - a[0]) * W) * 180) / Math.PI).toBeCloseTo(10, 6);
  });
  it('composes maps in the stated order, and undoes them', () => {
    const shift = [1, 0, 5, 0, 1, 7]; const double = [2, 0, 0, 0, 2, 0];
    expect(E.moAffineApply(E.moAffineMul(double, shift), 1, 1)).toEqual([12, 16]);   // shift first, then double
    expect(E.moAffineApply(E.moAffineMul(shift, double), 1, 1)).toEqual([7, 9]);
    const m = E.moEditAffine({ ...E.moEditDefaultRecipe(), crop: { x: 0.2, y: 0.3, w: 0.4, h: 0.5 }, angle: 12, rotate: 1, flipH: true }, 3000, 2000).m;
    const back = E.moAffineApply(E.moAffineInvert(m), ...(E.moAffineApply(m, 0.3, 0.8) as [number, number]));
    expect(back[0]).toBeCloseTo(0.3, 9);
    expect(back[1]).toBeCloseTo(0.8, 9);
  });
});

describe('crop and rotate', () => {
  const VW = 3000; const VH = 2000;
  it('an upright crop fits when it lies on the photo', () => {
    expect(E.moEditCropFits({ cx: 1500, cy: 1000, w: 3000, h: 2000 }, 0, VW, VH)).toBe(true);
    expect(E.moEditCropFits({ cx: 1500, cy: 1000, w: 3001, h: 2000 }, 0, VW, VH)).toBe(false);
    expect(E.moEditCropFits({ cx: 100, cy: 1000, w: 400, h: 400 }, 0, VW, VH)).toBe(false);
  });
  it('the whole photo no longer fits once it leans, and shrinks to what does', () => {
    const full = { cx: 1500, cy: 1000, w: 3000, h: 2000 };
    expect(E.moEditCropFits(full, 5, VW, VH)).toBe(false);
    const s = E.moEditCropShrink(full, 5, VW, VH);
    expect(E.moEditCropFits(s, 5, VW, VH)).toBe(true);
    expect(s.w / s.h).toBeCloseTo(1.5, 6);                        // same shape
    expect([s.cx, s.cy]).toEqual([1500, 1000]);                   // same middle
    expect(s.w).toBeLessThan(3000);
    expect(E.moEditCropFits({ ...s, w: s.w * 1.01, h: s.h * 1.01 }, 5, VW, VH)).toBe(false);   // and no smaller than it must be
  });
  it('a crop that fits is left alone by shrink, and can grow when asked', () => {
    const small = { cx: 1500, cy: 1000, w: 600, h: 400 };
    expect(E.moEditCropShrink(small, 8, VW, VH)).toBe(small);
    const grown = E.moEditCropScaled(small, 8, VW, VH, true);
    expect(grown.w).toBeGreaterThan(600);
    expect(E.moEditCropFits(grown, 8, VW, VH)).toBe(true);
    expect(E.moEditCropIsLargest(small, 8, VW, VH)).toBe(false);
    expect(E.moEditCropIsLargest(grown, 8, VW, VH)).toBe(true);
    expect(E.moEditCropIsLargest({ cx: 1500, cy: 1000, w: 3000, h: 2000 }, 0, VW, VH)).toBe(true);
  });
  it('the largest crop of a shape fills the photo one way', () => {
    const sq = E.moEditCropLargest(1, 0, VW, VH);
    expect(sq.w).toBeCloseTo(2000, 3);
    expect(sq.h).toBeCloseTo(2000, 3);
    const wide = E.moEditCropLargest(3, 0, VW, VH);
    expect(wide.w).toBeCloseTo(3000, 3);
    expect(wide.h).toBeCloseTo(1000, 3);
    const own = E.moEditCropLargest(0, 0, VW, VH);
    expect([Math.round(own.w), Math.round(own.h)]).toEqual([3000, 2000]);
  });
  it('shapes follow the photo: long side along the long side, until swapped', () => {
    expect(E.moEditAspectRatio(recipe({ aspect: '4:5' }), VW, VH)).toBeCloseTo(1.25, 9);
    expect(E.moEditAspectRatio(recipe({ aspect: '4:5' }), VH, VW)).toBeCloseTo(0.8, 9);
    expect(E.moEditAspectRatio(recipe({ aspect: '4:5', aspectFlip: true }), VW, VH)).toBeCloseTo(0.8, 9);
    expect(E.moEditAspectRatio(recipe({ aspect: 'original' }), VW, VH)).toBeCloseTo(1.5, 9);
    expect(E.moEditAspectRatio(recipe({ aspect: 'free' }), VW, VH)).toBe(0);
  });
  it('boxes and crops convert both ways', () => {
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
    const box = E.moEditCropBox(crop, VW, VH);
    expect(box).toEqual({ cx: 1050, cy: 1000, w: 1500, h: 1200 });
    const back = E.moEditCropFromBox(box, VW, VH);
    for (const k of ['x', 'y', 'w', 'h']) expect(back[k]).toBeCloseTo((crop as any)[k], 9);
  });
  it('dragging a side moves that side and leaves the opposite one where it was', () => {
    const start = { cx: 1500, cy: 1000, w: 1000, h: 800 };
    const e = E.moEditCropDrag(start, 'e', 200, 0, 0, 0, VW, VH);
    expect(e).toEqual({ cx: 1600, cy: 1000, w: 1200, h: 800 });            // west side still at 1000
    const n = E.moEditCropDrag(start, 'n', 0, -100, 0, 0, VW, VH);
    expect(n).toEqual({ cx: 1500, cy: 950, w: 1000, h: 900 });             // south side still at 1400
    const mv = E.moEditCropDrag(start, 'move', -300, 50, 0, 0, VW, VH);
    expect(mv).toEqual({ cx: 1200, cy: 1050, w: 1000, h: 800 });
  });
  it('a held shape is kept while a corner is dragged', () => {
    const start = { cx: 1500, cy: 1000, w: 1000, h: 1000 };
    const se = E.moEditCropDrag(start, 'se', 300, 40, 1, 0, VW, VH);
    expect(se.w).toBeCloseTo(se.h, 9);
    expect(se.w).toBe(1300);
    expect([se.cx - se.w / 2, se.cy - se.h / 2]).toEqual([1000, 500]);     // the opposite corner did not move
  });
  it('a drag that would leave the photo goes as far as it can', () => {
    const start = { cx: 1500, cy: 1000, w: 1000, h: 800 };
    const e = E.moEditCropDrag(start, 'e', 5000, 0, 0, 0, VW, VH);
    expect(e.cx + e.w / 2).toBeCloseTo(3000, 1);
    const mv = E.moEditCropDrag(start, 'move', -9000, 0, 0, 0, VW, VH);
    expect(mv.cx - mv.w / 2).toBeCloseTo(0, 1);
    const lean = E.moEditCropDrag({ cx: 1500, cy: 1000, w: 600, h: 400 }, 'se', 9000, 9000, 1.5, 12, VW, VH);
    expect(E.moEditCropFits(lean, 12, VW, VH)).toBe(true);
    expect(lean.w).toBeGreaterThan(600);
  });
  it('a quarter turn takes the crop with the photo; four bring everything back', () => {
    const r = recipe({ crop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } });
    const cw = E.moEditTurn(r, 1);
    expect(cw.rotate).toBe(1);
    for (const [k, v] of Object.entries({ x: 0.4, y: 0.1, w: 0.4, h: 0.3 })) expect(cw.crop[k]).toBeCloseTo(v, 9);
    // the same source pixel is at the middle of the crop before and after
    const before = E.moAffineApply(E.moEditAffine(r, VW, VH).m, 0.5, 0.5);
    const after = E.moAffineApply(E.moEditAffine(cw, VW, VH).m, 0.5, 0.5);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    let t = r;
    for (let i = 0; i < 4; i++) t = E.moEditTurn(t, 1);
    expect(t.rotate).toBe(0);
    for (const k of ['x', 'y', 'w', 'h']) expect(t.crop[k]).toBeCloseTo(r.crop[k], 9);
    const back = E.moEditTurn(cw, -1);
    for (const k of ['x', 'y', 'w', 'h']) expect(back.crop[k]).toBeCloseTo(r.crop[k], 9);
  });
  it('a mirror keeps the same pixels in the crop and reverses its lean', () => {
    const r = recipe({ crop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, angle: 6 });
    const f = E.moEditFlip(r, 'h');
    expect(f.flipH).toBe(true);
    expect(f.angle).toBe(-6);
    expect(f.crop.x).toBeCloseTo(0.6, 9);
    const before = E.moAffineApply(E.moEditAffine(r, VW, VH).m, 0.5, 0.5);
    const after = E.moAffineApply(E.moEditAffine(f, VW, VH).m, 0.5, 0.5);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    expect(E.moEditFlip(recipe(), 'v').angle).toBe(0);
  });
  it('the crop tool shows the whole photo, with the frame where the crop is', () => {
    const r = recipe({ crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    const v = E.moEditCropView(r, VW, VH, 1600, 1100, 100);
    expect(v.zoom).toBeCloseTo(0.5, 9);                                   // 3000 wide into 1500
    expect(v.frame).toEqual({ x: 425, y: 300, w: 750, h: 500 });
    // the frame's corners are the output's corners
    const tl = E.moAffineApply(v.view, 425 / 1600, 300 / 1100);
    const br = E.moAffineApply(v.view, 1175 / 1600, 800 / 1100);
    expect(tl[0]).toBeCloseTo(0, 9); expect(tl[1]).toBeCloseTo(0, 9);
    expect(br[0]).toBeCloseTo(1, 9); expect(br[1]).toBeCloseTo(1, 9);
    // leaning: the photo needs more room, so it is drawn smaller
    expect(E.moEditCropView({ ...r, angle: 20 }, VW, VH, 1600, 1100, 100).zoom).toBeLessThan(0.5);
  });
});

describe('zoom and pan', () => {
  it('fit shows the whole picture with room to spare', () => {
    const z = E.moEditFitZoom(3000, 2000, 1500, 1500, 100);
    expect(z).toBeCloseTo(1400 / 3000, 9);
    const v = E.moEditClampView(3000, 2000, 1500, 1500, z, 0, 0);
    expect([v.cx, v.cy]).toEqual([1500, 1000]);
  });
  it('the view map puts the middle of the canvas on the centre pixel', () => {
    const m = E.moEditViewMap(3000, 2000, 1500, 1000, 2, 600, 400);
    const mid = E.moAffineApply(m, 0.5, 0.5);
    expect(mid[0] * 3000).toBeCloseTo(600, 9);
    expect(mid[1] * 2000).toBeCloseTo(400, 9);
    const l = E.moAffineApply(m, 0, 0); const r = E.moAffineApply(m, 1, 1);
    expect((r[0] - l[0]) * 3000).toBeCloseTo(750, 9);
    expect((r[1] - l[1]) * 2000).toBeCloseTo(500, 9);
  });
  it('panning stops at the edge of the picture and zoom stays within its limits', () => {
    const v = E.moEditClampView(3000, 2000, 1000, 1000, 1, -500, 99999);
    expect([v.cx, v.cy]).toEqual([500, 1500]);
    expect(E.moEditClampView(100, 100, 100, 100, 1000, 50, 50).zoom).toBe(16);
    expect(E.moEditClampView(100, 100, 100, 100, 0, 50, 50).zoom).toBe(0.02);
  });
});

describe('tiles', () => {
  it('cover the output once, with no overlap', () => {
    const tiles = E.moEditTiles(9000, 5000, 4096);
    expect(tiles.length).toBe(6);
    expect(tiles.reduce((n: number, t: any) => n + t.w * t.h, 0)).toBe(9000 * 5000);
    expect(tiles[tiles.length - 1]).toEqual({ x: 8192, y: 4096, w: 808, h: 904 });
  });
  it('a tile reads the same source pixels the whole picture would', () => {
    const W = 9000; const H = 6000;
    for (const change of [{ rotate: 0 }, { rotate: 1, flipH: true }, { angle: 7, crop: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } }]) {
      const g = E.moEditAffine(recipe(change), W, H);
      for (const tile of E.moEditTiles(g.outW, g.outH, 4096)) {
        const part = E.moEditTileSource(g.m, tile, g.outW, g.outH, W, H, 2);
        expect(part.sx).toBeGreaterThanOrEqual(0);
        expect(part.sy).toBeGreaterThanOrEqual(0);
        expect(part.sx + part.sw).toBeLessThanOrEqual(W);
        expect(part.sy + part.sh).toBeLessThanOrEqual(H);
        for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.25]]) {
          // tile uv -> output uv (the tile's window), then output uv -> the part
          const o = E.moAffineApply(part.view, u, v);
          expect(o[0]).toBeCloseTo((tile.x + u * tile.w) / g.outW, 9);
          expect(o[1]).toBeCloseTo((tile.y + v * tile.h) / g.outH, 9);
          const whole = E.moAffineApply(g.m, o[0], o[1]);
          const local = E.moAffineApply(part.m, o[0], o[1]);
          expect(part.sx + local[0] * part.sw).toBeCloseTo(whole[0] * W, 6);
          expect(part.sy + local[1] * part.sh).toBeCloseTo(whole[1] * H, 6);
        }
      }
    }
  });
  it('an upright tile takes its own pixels plus the margin', () => {
    const g = E.moEditAffine(E.moEditDefaultRecipe(), 9000, 6000);
    expect(E.moEditTileSource(g.m, { x: 4096, y: 0, w: 4096, h: 4096 }, 9000, 6000, 9000, 6000, 2)).toMatchObject({ sx: 4094, sy: 0, sw: 4100, sh: 4098 });
    expect(E.moEditTileSource(g.m, { x: 4096, y: 0, w: 4096, h: 4096 }, 9000, 6000, 9000, 6000, 96)).toMatchObject({ sx: 4000, sy: 0, sw: 4288, sh: 4192 });
  });
});

describe('output names', () => {
  it('adds -edit, keeps PNG as PNG, and says when the picture was enlarged', () => {
    expect(E.moEditOutputName('photo.jpg')).toBe('photo-edit.jpg');
    expect(E.moEditOutputName('photo.JPEG', 2)).toBe('photo-edit (2).jpg');
    expect(E.moEditOutputName('logo.png')).toBe('logo-edit.png');
    expect(E.moEditOutputName('IMG_0042.HEIC')).toBe('IMG_0042-edit.jpg');
    expect(E.moEditOutputName('noext')).toBe('noext-edit.jpg');
    expect(E.moEditOutputName('a.b.tiff', 3)).toBe('a.b-edit (3).jpg');
    expect(E.moEditOutputName('photo.jpg', 1, 2)).toBe('photo-edit-2x.png');
    expect(E.moEditOutputName('photo.jpg', 2, 4, false)).toBe('photo-4x (2).png');
  });

  it('Save writes over a JPEG or a PNG in its own kind, and no other kind of file', () => {
    expect(E.moEditSaveOverExt('photo.jpg')).toBe('jpg');
    expect(E.moEditSaveOverExt('photo.JPEG')).toBe('jpg');
    expect(E.moEditSaveOverExt('logo.PNG')).toBe('png');
    for (const name of ['IMG_0042.HEIC', 'a.webp', 'scan.tiff', 'shot.avif', 'raw.nef', 'loop.gif', 'noext', '', null]) expect(E.moEditSaveOverExt(name)).toBe(null);
  });

  it('what Save writes first carries a name the library turns away', () => {
    const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
    const m = /const MO_TEMP_NAME_RE = (\/.+\/[a-z]*);/.exec(src);
    expect(m).toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const turnedAway: RegExp = new Function(`return ${(m as RegExpExecArray)[1]};`)();
    expect(E.moEditSavingName('photo.jpg', 'k3x9ab')).toBe('photo.saving-k3x9ab.jpg');
    expect(E.moEditSavingName('photo.JPEG', 'K3X9AB')).toBe('photo.saving-k3x9ab.jpg');
    expect(E.moEditSavingName('a.b.png', 'q1')).toBe('a.b.saving-q1.png');
    expect(E.moEditSavingName('photo.jpg', '')).toBe('photo.saving-0.jpg');
    expect(E.moEditSavingName('photo.jpg', '0.123456789abc')).toBe('photo.saving-01234567.jpg');
    for (const name of ['photo.jpg', 'photo.JPEG', 'a.b.png', '0027_26.jpg']) expect(turnedAway.test(E.moEditSavingName(name, 'k3x9ab'))).toBe(true);
    // and a photo's own name is not turned away with it
    for (const name of ['photo.jpg', 'photo-edit.jpg', 'saving-grace.png', 'my.saving.jpg']) expect(turnedAway.test(name)).toBe(false);
  });
});

// A small JPEG header set with a camera data block: orientation, a link to a
// second directory (the thumbnail) and the stored picture size.
function exifSegment(le: boolean, orientation: number, w: number, h: number): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 24 + 4 + 2 + 24 + 4);
  const dv = new DataView(tiff.buffer);
  tiff[0] = tiff[1] = le ? 0x49 : 0x4D;
  dv.setUint16(2, 42, le); dv.setUint32(4, 8, le);
  let o = 8;
  dv.setUint16(o, 2, le); o += 2;
  dv.setUint16(o, 0x0112, le); dv.setUint16(o + 2, 3, le); dv.setUint32(o + 4, 1, le); dv.setUint16(o + 8, orientation, le); o += 12;
  dv.setUint16(o, 0x8769, le); dv.setUint16(o + 2, 4, le); dv.setUint32(o + 4, 1, le); dv.setUint32(o + 8, 38, le); o += 12;
  dv.setUint32(o, 999, le); o += 4;
  dv.setUint16(o, 2, le); o += 2;
  dv.setUint16(o, 0xA002, le); dv.setUint16(o + 2, 4, le); dv.setUint32(o + 4, 1, le); dv.setUint32(o + 8, w, le); o += 12;
  dv.setUint16(o, 0xA003, le); dv.setUint16(o + 2, 3, le); dv.setUint32(o + 4, 1, le); dv.setUint16(o + 8, h, le); o += 12;
  dv.setUint32(o, 0, le);
  const seg = new Uint8Array(4 + 6 + tiff.length);
  const len = 2 + 6 + tiff.length;
  seg.set([0xFF, 0xE1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  seg.set(tiff, 10);
  return seg;
}
const SOI = [0xFF, 0xD8];
const JFIF = [0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
const REST = [0xFF, 0xDB, 0x00, 0x04, 9, 9, 0xFF, 0xDA, 0x00, 0x02, 1, 2, 3, 0xFF, 0xD9];
const bytes = (...parts: (number[] | Uint8Array)[]) => new Uint8Array(parts.flatMap((p) => Array.from(p)));

describe('camera data carried into a saved JPEG', () => {
  for (const le of [true, false]) {
    it(`resets orientation, updates the size and unlinks the thumbnail (${le ? 'little' : 'big'} endian)`, () => {
      const orig = bytes(SOI, JFIF, exifSegment(le, 6, 4000, 3000), REST);
      const fresh = bytes(SOI, JFIF, REST);
      const out: Uint8Array = E.moEditCarryExif(orig, fresh, 1500, 2000);
      expect(out.length).toBe(fresh.length + exifSegment(le, 6, 4000, 3000).length);
      const at = SOI.length + JFIF.length;
      expect(Array.from(out.subarray(0, at))).toEqual([...SOI, ...JFIF]);
      expect(Array.from(out.subarray(out.length - REST.length))).toEqual(REST);
      const seg = out.subarray(at, out.length - REST.length);
      expect(Array.from(seg.subarray(0, 2))).toEqual([0xFF, 0xE1]);
      const dv = new DataView(seg.buffer, seg.byteOffset + 10, seg.length - 10);
      expect(dv.getUint16(8 + 2 + 8, le)).toBe(1);                 // orientation
      expect(dv.getUint32(8 + 2 + 24, le)).toBe(0);                // no second directory
      expect(dv.getUint32(38 + 2 + 8, le)).toBe(1500);             // stored width
      expect(dv.getUint16(38 + 2 + 12 + 8, le)).toBe(2000);        // stored height
      expect(new DataView(orig.buffer, at + 10).getUint16(8 + 2 + 8, le)).toBe(6);   // the original is not written to
    });
  }
  it('goes right after the start marker when the new file has no JFIF header', () => {
    const seg = exifSegment(true, 3, 10, 10);
    const out: Uint8Array = E.moEditCarryExif(bytes(SOI, seg, REST), bytes(SOI, REST), 10, 10);
    expect(Array.from(out.subarray(2, 4))).toEqual([0xFF, 0xE1]);
    expect(out.length).toBe(2 + seg.length + REST.length);
  });
  it('leaves the new file alone when there is nothing to carry or the block is damaged', () => {
    const fresh = bytes(SOI, JFIF, REST);
    expect(E.moEditCarryExif(bytes(SOI, JFIF, REST), fresh, 10, 10)).toBe(fresh);
    expect(E.moEditCarryExif(new Uint8Array([1, 2, 3, 4]), fresh, 10, 10)).toBe(fresh);
    expect(E.moEditCarryExif(null, fresh, 10, 10)).toBe(fresh);
    const bad = exifSegment(true, 6, 10, 10);
    bad[10] = 0x00;
    expect(E.moEditCarryExif(bytes(SOI, bad, REST), fresh, 10, 10)).toBe(fresh);
    const cut = exifSegment(true, 6, 10, 10);
    new DataView(cut.buffer).setUint32(10 + 4, 60000, true);
    expect(E.moEditCarryExif(bytes(SOI, cut, REST), fresh, 10, 10)).toBe(fresh);
  });
});

// A picture of n pixels, each the grey that `level(i)` gives (0..255), as RGBA bytes.
function greys(n: number, level: (i: number) => number, alpha = 255): Uint8Array {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, Math.round(level(i)))); out.set([v, v, v, alpha], i * 4); }
  return out;
}

describe('reading the picture', () => {
  it('counts levels and leaves out see-through pixels', () => {
    const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 10, 10, 10, 255]);
    const h = E.moEditHistogram(px);
    expect(h.n).toBe(3);
    expect(h.r[255]).toBe(1);
    expect(h.g[255]).toBe(1);
    expect(h.b[255]).toBe(0);                  // the blue pixel is see-through
    expect(h.l[10]).toBe(1);
    expect(h.l[76]).toBe(1);                   // red's brightness: 0.299 * 255
  });
  it('finds the level below which a share of the pixels lie', () => {
    const h = E.moEditHistogram(greys(1000, (i) => (i / 999) * 255));
    expect(E.moEditPercentile(h.l, h.n, 0.5)).toBeCloseTo(0.5, 1);
    expect(E.moEditPercentile(h.l, h.n, 0.005)).toBeLessThan(0.03);
    expect(E.moEditPercentile(h.l, 0, 0.5)).toBe(0);
  });
  it('Auto lifts a dark picture and lowers a bright one', () => {
    const dark = E.moEditAutoTone(E.moEditHistogram(greys(2000, (i) => 5 + (i / 1999) * 70)));
    expect(dark.exposure).toBeGreaterThan(0.3);
    expect(dark.shadows).toBeGreaterThanOrEqual(0);
    const bright = E.moEditAutoTone(E.moEditHistogram(greys(2000, (i) => 170 + (i / 1999) * 85)));
    expect(bright.exposure).toBeLessThan(-0.2);
    for (const v of Object.values(dark).concat(Object.values(bright))) { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v as number)).toBeLessThanOrEqual(1.5); }
  });
  it('Auto stretches a flat picture towards black and white and leaves a full one nearly alone', () => {
    const flat = E.moEditAutoTone(E.moEditHistogram(greys(2000, (i) => 100 + (i / 1999) * 50)));
    expect(flat.whites).toBeGreaterThan(0);
    expect(flat.blacks).toBeLessThan(0);
    expect(flat.contrast).toBe(0.15);
    const full = E.moEditAutoTone(E.moEditHistogram(greys(2000, (i) => (i / 1999) * 255)));
    expect(Math.abs(full.exposure)).toBeLessThan(0.15);
    expect(Math.abs(full.whites)).toBeLessThan(0.2);
    expect(Math.abs(full.blacks)).toBeLessThan(0.2);
    expect(E.moEditAutoTone(E.moEditHistogram(new Uint8Array(0))).exposure).toBe(0);
  });
  it('white balance turns the picked colour grey, within what the sliders can do', () => {
    // the engine adds 0.12 * warmth to red, takes it from blue, and takes 0.1 * tint from green
    const after = (r: number, g: number, b: number) => { const w = E.moEditWhiteBalance(r, g, b); return [r + 0.12 * w.warmth, g - 0.1 * w.tint, b - 0.12 * w.warmth]; };
    const c = after(0.5, 0.56, 0.62);          // a bluish, slightly green grey
    expect(c[0]).toBeCloseTo(c[2], 2);
    expect(c[1]).toBeCloseTo(c[0], 2);
    expect(E.moEditWhiteBalance(0.5, 0.5, 0.5)).toEqual({ warmth: 0, tint: 0 });
    expect(E.moEditWhiteBalance(0, 0.5, 1)).toEqual({ warmth: 1, tint: 0 });   // further than the slider goes
  });
});

describe('how far along a save is', () => {
  it('hears the last percentage in what the upscaler says', () => {
    expect(E.moEditUpscalePercent('12.50%\n')).toBeCloseTo(0.125, 9);
    expect(E.moEditUpscalePercent('0.00%\n25.00%\n50.00%\n')).toBeCloseTo(0.5, 9);
    expect(E.moEditUpscalePercent('100.00%')).toBe(1);
    expect(E.moEditUpscalePercent('[0 NVIDIA GeForce RTX 5090]  queueC=2[8]  queueG=0[16]')).toBeNull();
    expect(E.moEditUpscalePercent('')).toBeNull();
    expect(E.moEditUpscalePercent(null)).toBeNull();
    expect(E.moEditUpscalePercent('250%')).toBe(1);
  });
  it('the stages of a save follow each other along the bar and end at the end', () => {
    for (const [enlarging, edited] of [[false, true], [true, true], [true, false]]) {
      let at = 0;
      for (const stage of ['draw', 'write', 'enlarge', 'halve', 'library']) {
        const [a, b] = E.moEditStageSpan(stage, enlarging, edited);
        expect(a).toBeCloseTo(at, 9);
        expect(b).toBeGreaterThanOrEqual(a);
        at = b;
      }
      expect(at).toBe(1);
    }
  });
  it('enlarging takes most of the bar when there is any, drawing when there is none', () => {
    const wide = (stage: string, enlarging: boolean, edited: boolean) => { const [a, b] = E.moEditStageSpan(stage, enlarging, edited); return b - a; };
    expect(wide('enlarge', true, true)).toBeGreaterThan(0.6);
    expect(wide('enlarge', true, false)).toBeGreaterThan(0.8);
    expect(wide('draw', true, false)).toBe(0);
    expect(wide('enlarge', false, true)).toBe(0);
    expect(wide('draw', false, true)).toBeGreaterThan(0.6);
  });
  it('a stage half done is half way along its own part', () => {
    expect(E.moEditStageFraction('enlarge', 0.5, true, false)).toBeCloseTo(0.43, 9);
    expect(E.moEditStageFraction('enlarge', 0, true, true)).toBeCloseTo(0.14, 9);
    expect(E.moEditStageFraction('enlarge', 7, true, true)).toBeCloseTo(0.86, 9);
    expect(E.moEditStageFraction('library', 1, false, true)).toBe(1);
    expect(E.moEditStageFraction('draw', 0.5, false, true)).toBeCloseTo(0.35, 9);
  });
});

describe('remove', () => {
  it('shows the model three times the mark, at least its own size, on the photo', () => {
    const S = E.MO_EDIT_MODEL_SIDE;
    expect(E.moEditRemovalWindow({ x: 1000, y: 1000, w: 100, h: 40 }, 6000, 4000)).toEqual({ x: 794, y: 764, side: S });
    expect(E.moEditRemovalWindow({ x: 1000, y: 1000, w: 400, h: 100 }, 6000, 4000)).toEqual({ x: 600, y: 450, side: 1200 });
    expect(E.moEditRemovalWindow({ x: 5900, y: 3950, w: 80, h: 40 }, 6000, 4000)).toEqual({ x: 6000 - S, y: 4000 - S, side: S });   // at a corner
    expect(E.moEditRemovalWindow({ x: 10, y: 10, w: 50, h: 50 }, 400, 300)).toEqual({ x: 0, y: 0, side: 300 });                    // a small photo
    expect(E.moEditRemovalWindow({ x: 0, y: 0, w: 3000, h: 3000 }, 6000, 4000).side).toBe(4000);                                  // a huge mark
  });
  it('boxes a stroke with its brush and keeps the box on the photo', () => {
    expect(E.moEditStrokeBox([[100, 100], [200, 120]], 10, 6000, 4000)).toEqual({ x: 88, y: 88, w: 124, h: 44 });
    expect(E.moEditStrokeBox([[5, 5]], 20, 6000, 4000)).toEqual({ x: 0, y: 0, w: 27, h: 27 });
    expect(E.moEditStrokeBox([[5995, 3995]], 20, 6000, 4000)).toEqual({ x: 5973, y: 3973, w: 27, h: 27 });
    expect(E.moEditStrokeBox([], 20, 6000, 4000)).toBeNull();
  });
});

// ── Remove From Other Photos: finding a mark ──
// Pictures made here: a background with texture of its own, and a mark (a ring, a slanted
// bar, a block with a hole) laid on at a place, a size and a strength.
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function background(w: number, h: number, seed: number): Float32Array {
  const r = rng(seed);
  const g = new Float32Array(w * h);
  const blobs = Array.from({ length: 40 }, () => ({ x: r() * w, y: r() * h, s: 6 + r() * 30, a: (r() - 0.5) * 120 }));
  const tilt = r() * 0.4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 90 + 60 * (x / w) + 40 * tilt * (y / h);
      for (const b of blobs) { const d = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.s * b.s); if (d < 9) v += b.a * Math.exp(-d); }
      g[y * w + x] = Math.max(0, Math.min(255, v + (r() - 0.5) * 6));
    }
  }
  return g;
}
const MARK_W = 120; const MARK_H = 60;
function inMark(u: number, v: number): boolean {
  if (Math.abs(Math.hypot(u - 28, v - 30) - 18) < 4.5) return true;                        // a ring
  if (u > 50 && u < 78 && Math.abs((v - 8) - (u - 50) * 1.5) < 5) return true;              // a slanted bar
  if (u > 84 && u < 114 && v > 10 && v < 50 && !(u > 93 && u < 105 && v > 20 && v < 40)) return true;   // a block with a hole
  return false;
}
function stamp(g: Float32Array, w: number, h: number, x: number, y: number, scale: number, alpha = 1): { x: number; y: number; w: number; h: number } {
  const bw = Math.round(MARK_W * scale); const bh = Math.round(MARK_H * scale);
  for (let py = y; py < y + bh; py++) {
    for (let px = x; px < x + bw; px++) {
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      let cover = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) if (inMark((px - x + (sx + 0.5) / 3) / scale, (py - y + (sy + 0.5) / 3) / scale)) cover++;
      const a = (cover / 9) * alpha;
      g[py * w + px] = g[py * w + px] * (1 - a) + 245 * a;
    }
  }
  return { x, y, w: bw, h: bh };
}
// What the app does, with the pure pieces: every size in the plan, every position, the check, the merge.
function markOf(g: Float32Array, w: number, h: number, box: { x: number; y: number; w: number; h: number }) {
  const crop = new Float32Array(box.w * box.h);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) crop[y * box.w + x] = g[(box.y + y) * w + box.x + x];
  const variants = new Map<string, any>();
  const at = (size: number) => {
    const s = E.moFindShape(size, box.w / box.h);
    const key = `${s.w}x${s.h}`;
    if (!variants.has(key)) {
      const small = E.moFindResize(crop, box.w, box.h, s.w, s.h);
      variants.set(key, { search: E.moFindTemplate(small, null, s.w, s.h, E.MO_FIND_POINTS), check: E.moFindTemplate(small, null, s.w, s.h, E.MO_FIND_CHECK) });
    }
    return variants.get(key);
  };
  return { share: Math.sqrt(box.w * box.h) / Math.max(w, h), aspect: box.w / box.h, at };
}
function findIn(g: Float32Array, w: number, h: number, mark: ReturnType<typeof markOf>) {
  const long = Math.max(w, h);
  const fields = new Map<number, { f: Uint8Array; W: number; H: number }>();
  const found: any[] = [];
  for (const step of E.moFindPlan(mark.share, long)) {
    if (!fields.has(step.side)) {
      const W = Math.round((w * step.side) / long); const H = Math.round((h * step.side) / long);
      fields.set(step.side, { f: E.moFindField(step.side === long ? g : E.moFindResize(g, w, h, W, H), W, H), W, H });
    }
    const { f, W, H } = fields.get(step.side)!;
    const shape = E.moFindShape(step.size, mark.aspect);
    const level = { field: f, w: W, h: H, ...E.moFindMargin(shape.w, shape.h) };
    const k = long / step.side;
    for (const c of E.moFindOnLevel(level, mark.at, step.size, (s: any) => ({ scores: E.moFindDense(f, W, H, s, level.mx, level.my), stride: 1 }))) found.push({ score: c.score, x: c.x * k, y: c.y * k, w: c.w * k, h: c.h * k });
  }
  return E.moFindMerge(found).map((x: any) => ({ ...x, verdict: E.moFindVerdict(x.score) }));
}
const near = (f: any, box: { x: number; y: number; w: number; h: number }, pad: number) =>
  Math.abs(f.x + f.w / 2 - (box.x + box.w / 2)) < box.w * 0.08 + 2 && Math.abs(f.y + f.h / 2 - (box.y + box.h / 2)) < box.h * 0.12 + 2
  && Math.abs(f.w / (box.w + 2 * pad * (box.w / MARK_W)) - 1) < 0.1;

// These run the real multi-scale search over whole (small) photos: 1 to 3 s
// each on an idle machine, so the 5 s default fails them under a loaded full
// run. The work is the point of the test; the limit fits the work.
describe('finding a mark in other photos', { timeout: 30_000 }, () => {
  const W = 360; const H = 240; const PAD = 8;
  // the example: the mark on one background, brushed a little larger than it is
  const example = background(W, H, 11);
  const put = stamp(example, W, H, 200, 150, 1);
  const brushed = { x: put.x - PAD, y: put.y - PAD, w: put.w + 2 * PAD, h: put.h + 2 * PAD };
  const mark = markOf(example, W, H, brushed);

  it('keeps the strongest edges of what was brushed, spread over it, each with a direction', () => {
    const t = mark.at(64).check;
    expect(t.n).toBeGreaterThan(E.MO_FIND_FEW);
    expect(t.n).toBeLessThanOrEqual(E.MO_FIND_CHECK);
    expect(mark.at(64).search.n).toBeLessThanOrEqual(E.MO_FIND_POINTS);
    for (let j = 0; j < t.n; j++) {
      expect(Math.hypot(t.tx[j], t.ty[j])).toBeCloseTo(1, 5);
      expect(t.dx[j]).toBeGreaterThan(0); expect(t.dx[j]).toBeLessThan(t.w - 1);
      expect(t.dy[j]).toBeGreaterThan(0); expect(t.dy[j]).toBeLessThan(t.h - 1);
    }
    const xs = Array.from(t.dx as Int16Array);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(t.w * 0.6);          // not all from one corner
  });
  it('leaves out what was not brushed, and has nothing to say of a plain patch', () => {
    const s = E.moFindShape(64, brushed.w / brushed.h);
    const crop = new Float32Array(brushed.w * brushed.h);
    for (let y = 0; y < brushed.h; y++) for (let x = 0; x < brushed.w; x++) crop[y * brushed.w + x] = example[(brushed.y + y) * W + brushed.x + x];
    const small = E.moFindResize(crop, brushed.w, brushed.h, s.w, s.h);
    const left = new Uint8Array(s.w * s.h);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w / 2; x++) left[y * s.w + x] = 1;
    const t = E.moFindTemplate(small, left, s.w, s.h, 500);
    expect(t.n).toBeGreaterThan(0);
    for (let j = 0; j < t.n; j++) expect(t.dx[j]).toBeLessThan(s.w / 2);
    expect(E.moFindTemplate(new Float32Array(40 * 40).fill(120), null, 40, 40, 100).n).toBe(0);
  });
  it('scores the mark high where it is and low where it is not, whatever lies behind it', () => {
    const other = background(W, H, 23);
    stamp(other, W, H, 200, 150, 1);
    const f = E.moFindField(other, W, H);
    const t = mark.at(Math.sqrt(brushed.w * brushed.h)).check;
    expect(t.w).toBe(brushed.w);
    expect(Math.abs(E.moFindScoreAt(f, W, H, t, brushed.x, brushed.y))).toBeGreaterThan(0.7);
    expect(Math.abs(E.moFindScoreAt(f, W, H, t, 20, 20))).toBeLessThan(0.3);
    expect(Math.abs(E.moFindScoreAt(f, W, H, t, brushed.x + 9, brushed.y))).toBeLessThan(0.4);
    // every position at once gives the same answer as one at a time
    const s = mark.at(64).search;
    const dense = E.moFindDense(f, W, H, s);
    expect(dense[30 * W + 40]).toBe(Math.min(255, Math.round(Math.abs(E.moFindScoreAt(f, W, H, s, 40, 30)) * 255)));
    const wide = E.moFindDense(f, W, H, s, 10, 6);                                    // with positions past the edge
    expect(wide.length).toBe((W + 20) * (H + 12));
    expect(wide[(30 + 6) * (W + 20) + 40 + 10]).toBe(dense[30 * W + 40]);
  });
  it('learns the mark from several photos: what they agree on is the mark, the rest is background', () => {
    // an example brushed over something with edges of its own: a bright band crossing the mark
    const busy = background(W, H, 71);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs((x - 250) - (y - 150) * 0.8) < 9) busy[y * W + x] = 250;
    stamp(busy, W, H, 200, 150, 1, 0.35);                                              // and the mark faint on it
    const cut = (g: Float32Array) => { const c = new Float32Array(brushed.w * brushed.h); for (let y = 0; y < brushed.h; y++) for (let x = 0; x < brushed.w; x++) c[y * brushed.w + x] = g[(brushed.y + y) * W + brushed.x + x]; return c; };
    const others = [73, 79, 83, 89].map((seed) => { const g = background(W, H, seed); stamp(g, W, H, 200, 150, 1); return cut(g); });
    // how many of a mark's edge points lie on the mark itself (within a pixel and a half of its outline)
    const onMark = (t: any) => {
      let n = 0;
      for (let j = 0; j < t.n; j++) {
        let edge = false;
        for (let dy = -1.5; dy <= 1.5 && !edge; dy += 0.75) for (let dx = -1.5; dx <= 1.5 && !edge; dx += 0.75) {
          const u = t.dx[j] + 0.5 - PAD; const v = t.dy[j] + 0.5 - PAD;
          if (inMark(u, v) !== inMark(u + dx, v + dy)) edge = true;
        }
        if (edge) n++;
      }
      return n / t.n;
    };
    const alone = E.moFindTemplate(cut(busy), null, brushed.w, brushed.h, E.MO_FIND_CHECK);
    const learnt = E.moFindConsensus([cut(busy), ...others], null, brushed.w, brushed.h, E.MO_FIND_CHECK);
    expect(learnt.n).toBeGreaterThan(E.MO_FIND_FEW);
    expect(onMark(alone)).toBeLessThan(0.75);                                          // the band is in it
    expect(onMark(learnt)).toBeGreaterThan(0.95);                                      // the band is not
    for (let j = 0; j < learnt.n; j++) expect(Math.hypot(learnt.tx[j], learnt.ty[j])).toBeCloseTo(1, 5);
    // and it fits the mark better for it, on a photo neither has seen
    const fresh = background(W, H, 97);
    stamp(fresh, W, H, 200, 150, 1);
    const f = E.moFindField(fresh, W, H);
    const a = Math.abs(E.moFindScoreAt(f, W, H, alone, brushed.x, brushed.y));
    const l = Math.abs(E.moFindScoreAt(f, W, H, learnt, brushed.x, brushed.y));
    expect(l).toBeGreaterThan(a + 0.1);
    expect(l).toBeGreaterThan(0.85);
    // photos that agree on nothing teach nothing
    expect(E.moFindConsensus([61, 67, 71, 73].map((seed) => cut(background(W, H, seed + 100))), null, brushed.w, brushed.h, 100).n).toBeLessThan(E.MO_FIND_FEW);
  });
  it('works out the mark\'s own shape from the photos that have it', () => {
    const cut = (g: Float32Array) => { const c = new Float32Array(brushed.w * brushed.h); for (let y = 0; y < brushed.h; y++) for (let x = 0; x < brushed.w; x++) c[y * brushed.w + x] = g[(brushed.y + y) * W + brushed.x + x]; return c; };
    const grays = [101, 103, 107, 109, 113, 127].map((seed) => { const g = background(W, H, seed); stamp(g, W, H, 200, 150, 1); return cut(g); });
    const bits = E.moFindMatte(grays, null, brushed.w, brushed.h, 2);
    expect(bits).not.toBeNull();
    // every pixel of the mark is in the shape, and so is what the mark shuts in (the eye of the block, the middle of the ring)
    let mark = 0; let covered = 0; let area = 0;
    for (let y = 0; y < brushed.h; y++) for (let x = 0; x < brushed.w; x++) {
      const on = inMark(x + 0.5 - PAD, y + 0.5 - PAD);
      if (on) { mark++; if (bits[y * brushed.w + x]) covered++; }
      area += bits[y * brushed.w + x];
    }
    expect(covered).toBe(mark);
    expect(bits[(30 + PAD) * brushed.w + 99 + PAD]).toBe(1);                 // the eye of the block
    expect(bits[(30 + PAD) * brushed.w + 28 + PAD]).toBe(1);                 // the middle of the ring
    // and what was brushed round the mark is not: most of the brushing is spared
    expect(area).toBeLessThan(brushed.w * brushed.h * 0.6);
    expect(bits[2 * brushed.w + 2]).toBe(0);
    expect(bits[(brushed.h - 3) * brushed.w + 60]).toBe(0);
    expect(bits[(52 + PAD) * brushed.w + 66 + PAD]).toBe(0);                 // below the bar, between the ring and the block
    // it keeps a few pixels' reach past the mark's edge, no more
    expect(bits[(30 + PAD) * brushed.w + 28 + 18 + 4 + 3 + PAD]).toBe(1);    // three pixels outside the ring
    expect(bits[(30 + PAD) * brushed.w + 117 + PAD + 7]).toBe(0);            // ten pixels right of the block
    // never outside what was brushed
    const half = new Uint8Array(brushed.w * brushed.h);
    for (let y = 0; y < brushed.h; y++) for (let x = 0; x < 70; x++) half[y * brushed.w + x] = 1;
    const within = E.moFindMatte(grays, half, brushed.w, brushed.h, 2);
    expect(within).not.toBeNull();
    for (let y = 0; y < brushed.h; y++) for (let x = 70; x < brushed.w; x++) expect(within[y * brushed.w + x]).toBe(0);
    // its box, as shares of the brushing
    const box = E.moFindShapeBox(bits, brushed.w, brushed.h);
    expect(box.x).toBeGreaterThan(0.02); expect(box.x).toBeLessThan((PAD + 10) / brushed.w);
    expect(box.x + box.w).toBeGreaterThan((PAD + 114) / brushed.w); expect(box.x + box.w).toBeLessThan(0.98);
    expect(E.moFindShapeBox(new Uint8Array(12), 4, 3)).toBeNull();
    // photos that agree on nothing give no shape
    expect(E.moFindMatte([131, 137, 139, 149, 151, 157].map((seed) => cut(background(W, H, seed))), null, brushed.w, brushed.h, 2)).toBeNull();
  });
  it('removes the shape where the find is, not stretched, a few pixels more each side', () => {
    const part = { x: 0.1, y: 0.2, w: 0.8, h: 0.5 };
    expect(E.moFindShapeRemoval({ x: 1000, y: 500, w: 400, h: 100 }, part, 4000, 3000)).toEqual({ x: 1037, y: 517, w: 326, h: 56, mx: -37, my: -17, mw: 400, mh: 100 });
    // at the photo's corner it stays on the photo, the shape drawn from where the find began
    expect(E.moFindShapeRemoval({ x: -20, y: -10, w: 400, h: 100 }, part, 4000, 3000)).toEqual({ x: 17, y: 7, w: 326, h: 56, mx: -37, my: -17, mw: 400, mh: 100 });
    expect(E.moFindShapeRemoval({ x: -60, y: -30, w: 400, h: 100 }, part, 4000, 3000)).toMatchObject({ x: 0, y: 0, mx: -60, my: -30, mw: 400, mh: 100 });
  });
  it('settles a find to the pixel and to half a percent in size', () => {
    const g = background(W, H, 163);
    stamp(g, W, H, 100, 90, 1.03);
    const f = E.moFindField(g, W, H);
    const size = Math.sqrt(brushed.w * brushed.h);
    // the search put it two pixels off and at the example's size; the check for a search tries sizes 2% apart
    const coarse = E.moFindCheck(f, W, H, (z: number) => mark.at(z).check, size, 100 - PAD + 2, 90 - PAD - 1);
    const fine = E.moFindCheck(f, W, H, (z: number) => mark.at(z).check, size, coarse.x, coarse.y, E.MO_FIND_FINE_NEAR.map((n: number) => n * (coarse.w / brushed.w)), E.MO_FIND_FINE_REACH);
    expect(fine.score).toBeGreaterThanOrEqual(coarse.score);
    const want = brushed.w * 1.03;
    expect(Math.abs(fine.w - want)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(fine.x + fine.w / 2 - (100 + (MARK_W * 1.03) / 2))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(fine.y + fine.h / 2 - (90 + (MARK_H * 1.03) / 2))).toBeLessThanOrEqual(1.5);
  });
  it('finds the mark in another place, over another background', () => {
    const g = background(W, H, 31);
    const at = stamp(g, W, H, 30, 40, 1);
    const found = findIn(g, W, H, mark).filter((f: any) => f.verdict === 'found');
    expect(found).toHaveLength(1);
    expect(near(found[0], at, PAD)).toBe(true);
  });
  it('finds it smaller and larger than on the example', () => {
    for (const [scale, seed] of [[0.7, 41], [1.5, 43]] as const) {
      const g = background(W, H, seed);
      const at = stamp(g, W, H, 60, 70, scale);
      const found = findIn(g, W, H, mark).filter((f: any) => f.verdict === 'found');
      expect(found.length).toBe(1);
      expect(near(found[0], at, PAD)).toBe(true);
    }
  });
  it('finds it in a corner, where what was brushed round it reaches past the photo\'s edge', () => {
    const g = background(W, H, 47);
    const at = stamp(g, W, H, 3, 2, 1);                       // the brushed box would start at -5, -6
    const found = findIn(g, W, H, mark).filter((f: any) => f.verdict === 'found');
    expect(found).toHaveLength(1);
    expect(found[0].x).toBeLessThan(0);
    expect(near(found[0], at, PAD)).toBe(true);
    // what is removed for it stays on the photo, its mask drawn from where the find began
    const r = E.moFindRemoval(found[0], W, H);
    expect(r.x).toBe(0); expect(r.y).toBe(0);
    expect(r.mx).toBeLessThan(0); expect(r.my).toBeLessThan(0);
    // a few points past the edge are left out of the mean; a mark half off the photo is judged on what is left of it
    const t = mark.at(Math.sqrt(brushed.w * brushed.h)).check;
    const f = E.moFindField(g, W, H);
    expect(Math.abs(E.moFindScoreAt(f, W, H, t, 3 - PAD, 2 - PAD))).toBeGreaterThan(0.7);
    const half = background(W, H, 49);
    stamp(half, W, H, -60, 100, 1);
    const cut = Math.abs(E.moFindScoreAt(E.moFindField(half, W, H), W, H, t, -60 - PAD, 100 - PAD));
    expect(cut).toBeGreaterThan(0.3);
    expect(cut).toBeLessThan(0.6);
    const most = background(W, H, 51);
    stamp(most, W, H, -100, 100, 1);
    expect(Math.abs(E.moFindScoreAt(E.moFindField(most, W, H), W, H, t, -100 - PAD, 100 - PAD))).toBeLessThan(0.38);
    expect(E.moFindMargin(100, 40)).toEqual({ mx: 40, my: 16 });
  });
  it('finds it twice when it is there twice, and see-through', () => {
    const g = background(W, H, 53);
    const a = stamp(g, W, H, 20, 20, 0.8);
    const b = stamp(g, W, H, 210, 160, 1.1, 0.5);
    const found = findIn(g, W, H, mark).filter((f: any) => f.verdict === 'found');
    expect(found).toHaveLength(2);
    expect(found.some((f: any) => near(f, a, PAD))).toBe(true);
    expect(found.some((f: any) => near(f, b, PAD))).toBe(true);
  });
  it('finds nothing where the mark is not', () => {
    for (const seed of [61, 67]) expect(findIn(background(W, H, seed), W, H, mark).filter((f: any) => f.verdict === 'found')).toHaveLength(0);
  });
  it('tries sizes from well under to well over the example, each where the mark is large enough to read', () => {
    const plan = E.moFindPlan(0.1, 3000);
    expect(plan[0].share).toBeCloseTo(0.1 / 2.5, 6);
    expect(plan[plan.length - 1].share).toBeGreaterThan(0.1 * 2.5 / 1.07);
    expect(plan[plan.length - 1].share).toBeLessThanOrEqual(0.1 * 2.5 * 1.0001);
    for (const s of plan) {
      expect(s.side).toBeLessThanOrEqual(3000);
      expect(s.size).toBeCloseTo(s.share * s.side, 6);
      expect(s.size).toBeGreaterThanOrEqual(48);
      expect(s.size).toBeLessThan(96);
    }
    for (let i = 1; i < plan.length; i++) expect(plan[i].share / plan[i - 1].share).toBeCloseTo(1.07, 6);
    // A mark is never tried under 48 pixels: a photo is not made larger than it is, so on a small photo
    // the smaller sizes are left out. (They were tried, down to 24 pixels on a large photo searched at
    // 2048: 75 finds a photo, one of them the mark.)
    const small = E.moFindPlan(0.05, 500);
    expect(Math.max(...small.map((s: any) => s.side))).toBe(500);
    expect(Math.min(...small.map((s: any) => s.size))).toBeGreaterThanOrEqual(E.MO_FIND_SIZE - 0.001);
    expect(small[0].share).toBeCloseTo(48 / 500, 6);
    expect(E.moFindPlan(0.02, 500)).toEqual([]);                       // 10 pixels on the photo, 25 at the largest size tried: not looked for
    // a large photo is searched as large as a small mark needs
    const large = E.moFindPlan(0.029, 4800);
    expect(Math.min(...large.map((s: any) => s.size))).toBeGreaterThanOrEqual(E.MO_FIND_SIZE - 0.001);
    expect(Math.max(...large.map((s: any) => s.side))).toBe(4800);
    expect(large[0].share).toBeCloseTo(0.029 / 2.5, 6);
    expect(Math.max(...E.moFindPlan(0.029, 9000).map((s: any) => s.side))).toBe(6144);
    // once the mark has been met, the sizes it was met at
    const narrow = E.moFindPlan(0.029, 4800, E.moFindRange([0.028, 0.03, 0.029]));
    expect(narrow.length).toBeLessThan(large.length / 2);
    expect(narrow[0].share).toBeCloseTo(0.028 / 1.25, 6);
    expect(narrow[narrow.length - 1].share).toBeLessThanOrEqual(0.03 * 1.25 * 1.0001);
    expect(E.moFindRange([0.03, 0.03])).toBeNull();
    expect(E.moFindShape(60, 4)).toEqual({ w: 120, h: 30 });
  });
  it('picks the positions that stand out, best first', () => {
    const s = new Uint8Array(10 * 10 * 4);
    const set = (x: number, y: number, v: number) => { s[(y * 10 + x) * 4] = v; };
    set(2, 2, 200); set(3, 2, 180); set(7, 7, 120); set(8, 1, 60);
    expect(E.moFindPeaks(s, 10, 10, 4, 0.25, 10)).toEqual([{ x: 2, y: 2, score: 200 / 255 }, { x: 7, y: 7, score: 120 / 255 }]);
    expect(E.moFindPeaks(s, 10, 10, 4, 0.25, 1)).toHaveLength(1);
    const flat = new Uint8Array(16).fill(100);                                        // a tie is one peak, not sixteen
    expect(E.moFindPeaks(flat, 4, 4, 1, 0.25, 10)).toHaveLength(1);
  });
  it('keeps the best of finds that lie over each other', () => {
    const kept = E.moFindMerge([{ score: 0.6, x: 10, y: 10, w: 100, h: 40 }, { score: 0.8, x: 14, y: 12, w: 104, h: 42 }, { score: 0.7, x: 300, y: 10, w: 100, h: 40 }]);
    expect(kept.map((f: any) => f.score)).toEqual([0.8, 0.7]);
    // and of one mark's finds on a photo the best few: forty places that look like it are the finder taken in
    const many = Array.from({ length: 40 }, (_, i) => ({ mark: 0, score: 0.5 + i / 100, x: i * 200, y: 0, w: 100, h: 40 }));
    const few = E.moFindMerge(many.concat([{ mark: 1, score: 0.55, x: 0, y: 500, w: 100, h: 40 }]));
    expect(few.filter((f: any) => f.mark === 0)).toHaveLength(E.MO_FIND_MOST);
    expect(few.filter((f: any) => f.mark === 0).map((f: any) => f.score)[0]).toBeCloseTo(0.89, 9);
    expect(few.filter((f: any) => f.mark === 1)).toHaveLength(1);
  });
  it('judges a find on its second, finer look, and asks more of the first where there is no finer one', () => {
    // the first look 0.5, as dozens of look-alikes on a large photo have it: the second look decides
    expect(E.moFindVerdict(0.5, 0.9, true)).toBe('found');
    expect(E.moFindVerdict(0.5, 0.3, true)).toBe('');
    expect(E.moFindVerdict(0.9, 0.3, true)).toBe('');
    expect(E.moFindVerdict(0.5, E.MO_FIND_FOUND, true)).toBe('found');
    expect(E.moFindVerdict(0.5, 0.5, true)).toBe('unsure');
    expect(E.moFindVerdict(0.5, 0.44, true)).toBe('');
    // the mark too small on the photo for a finer look
    expect(E.moFindVerdict(0.8, 0, false)).toBe('found');
    expect(E.moFindVerdict(0.54, 0.54, false)).toBe('');                // the best look-alike measured
    expect(E.moFindVerdict(0.58, 0, false)).toBe('unsure');
    expect(E.moFindVerdict(E.MO_FIND_FOUND_ALONE, 0, false)).toBe('found');
    expect(E.MO_FIND_AGAIN).toBeLessThan(E.MO_FIND_UNSURE);              // what may pass the second look gets to it
  });
  it('removes a little more than it found, on the photo, the mask still in its own shape', () => {
    expect(E.moFindRemoval({ x: 100, y: 200, w: 300, h: 100 }, 2000, 1000)).toEqual({ x: 92, y: 192, w: 316, h: 116, mx: 0, my: 0, mw: 316, mh: 116 });
    // cut by the photo's edge: the box is smaller, the mask is drawn from outside it
    expect(E.moFindRemoval({ x: 2, y: 950, w: 300, h: 100 }, 2000, 1000)).toEqual({ x: 0, y: 942, w: 310, h: 58, mx: -6, my: 0, mw: 316, mh: 116 });
    expect(E.moFindRemoval({ x: 10, y: 10, w: 20, h: 12 }, 2000, 1000).w).toBe(26);      // never less than three pixels more each side
  });
});

describe('editor redesign: hidden removals and seeing without a part', () => {
  it('keeps a hidden removal but does not count it as work', () => {
    const r = recipe({ removals: [{ file: 'a.png', x: 1, y: 2, w: 10, h: 10, hidden: true }] });
    expect(r.removals).toHaveLength(1);
    expect(r.removals[0].hidden).toBe(true);
    expect(E.moEditShownRemovals(r)).toHaveLength(0);
    expect(E.moEditIsNeutral(r)).toBe(true);
    const shown = recipe({ removals: [{ file: 'a.png', x: 1, y: 2, w: 10, h: 10 }] });
    expect(shown.removals[0].hidden).toBeUndefined();
    expect(E.moEditIsNeutral(shown)).toBe(false);
  });
  it('turns off the curve, the mixer or grading on their own', () => {
    const base = { curve: { rgb: [[0, 0.1], [1, 1]] }, mixer: { red: [0.5, 0, 0] }, grading: { shadows: { h: 0.5, s: 0.4, l: 0 } } };
    const on = E.moEditEngineLook(recipe(base), false);
    expect(on.curve).toBeTruthy(); expect(on.mix).toBeTruthy(); expect(on.grade).toBeTruthy();
    const off = E.moEditEngineLook(recipe({ ...base, off: ['curve', 'mixer', 'grading'] }), false);
    expect(off.curve).toBeUndefined(); expect(off.mix).toBeUndefined(); expect(off.grade).toBeUndefined();
    expect(recipe({ off: ['curve', 'nonsense'] }).off).toEqual(['curve']);
    expect(E.MO_EDIT_PARTS).toEqual(['curve', 'mixer', 'grading']);
  });
});
