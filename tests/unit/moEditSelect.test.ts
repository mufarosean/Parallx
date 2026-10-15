// moEditSelect.test.ts — masks a model finds (ext/media-organizer/edit-select.js, edit-masks.js) and a plan's
// Ignore Background (plan-isolate.js, study-math.js): the arithmetic around the models, not the models.
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain JS module of the extension
import * as S from '../../ext/media-organizer/edit-select.js';
// @ts-expect-error a plain JS module of the extension
import * as M from '../../ext/media-organizer/edit-masks.js';
// @ts-expect-error a plain JS module of the extension
import { moStudyAnalyse, moStudyLight, moStudyMasses } from '../../ext/media-organizer/study-math.js';
// @ts-expect-error a plain JS module of the extension
import { moPlanIsolateNormalize } from '../../ext/media-organizer/plan-isolate.js';

describe('a model’s answer on the photo', () => {
  it('is resampled smoothly to the size asked', () => {
    const a = S.moFieldResize(new Float32Array([0, 1, 0, 1]), 2, 2, 4, 2);
    expect(a).toHaveLength(8);
    expect(a[0]).toBeCloseTo(0);
    expect(a[3]).toBeCloseTo(1);
    expect(a[1]).toBeGreaterThan(0); expect(a[1]).toBeLessThan(1);
  });
  it('snaps a coarse mask to the photo’s own edge (guided filter)', () => {
    const w = 40, h = 10, I = new Float32Array(w * h), p = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { I[y * w + x] = x < 20 ? 0.9 : 0.1; p[y * w + x] = Math.max(0, Math.min(1, (26 - x) / 12)); } // the mask fades across the edge
    const out = S.moGuidedFilter(I, p, w, h, 4, 1e-4);
    expect(out[5 * w + 17]).toBeGreaterThan(p[5 * w + 17]); // inside the edge, firmer
    expect(out[5 * w + 23]).toBeLessThan(p[5 * w + 23]);    // past it, weaker
  });
  it('knows plain words and refuses ones it does not', () => {
    const vocab = new Map([['sky', 2390], ['blue', 1746]]);
    expect(S.moClipTokens('Sky', vocab)).toEqual([49406, 2390, 49407]);
    expect(S.moClipTokens('blue sky!', vocab)).toEqual([49406, 1746, 2390, 49407]);
    expect(S.moClipTokens('skyscraper', vocab)).toBeNull();
    expect(S.moClipTokens('  ', vocab)).toBeNull();
  });
  it('pins every model file to a hash and a size, and counts what a way downloads', () => {
    for (const way of Object.keys(S.MO_SELECT_MODELS)) for (const f of S.MO_SELECT_MODELS[way].files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
      expect(f.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//);
    }
    expect(S.moSelectBytes('words')).toBeGreaterThan(S.moSelectBytes('object'));
  });
});

describe('a model’s part of a mask', () => {
  const file = 'abcdef0123456789abcdef01.png';
  it('is kept with its image and its own settings, and named for what it is', () => {
    const [m] = M.moMasksNormalize([{ name: 'x', parts: [{ kind: 'subject', invert: true, file }, { kind: 'words', text: 'sky', file: '../evil.png', op: 'sub' }, { kind: 'object', clicks: [[0.2, 0.3, 1], [2, 0.5, 0], 'bad'], box: [0, 0, 1, 1] }, { kind: 'distance', from: 3 }], adjust: {} }]);
    expect(m.parts.map((p: { kind: string }) => p.kind)).toEqual(['subject', 'words', 'object', 'distance']);
    expect(m.parts[0].file).toBe(file);
    expect(m.parts[1].file).toBe('');
    expect(m.parts[2].clicks).toEqual([[0.2, 0.3, 1], [1, 0.5, 0]]);
    expect(m.parts[3].from).toBe(1);
    expect(M.moPartLabel(m.parts[0])).toBe('Background');
    expect(M.moPartLabel(m.parts[1])).toBe('Sky');
    expect(M.moMaskFiles([m])).toEqual([file]);
  });
  it('covers the photo as its image says; Distance takes what is farther than its point', () => {
    const near = new Float32Array([1, 0.6, 0.4, 0]); // left near, right far
    M.moMaskImagePut('00000000000000000000000a.png', { w: 4, h: 1, a: new Float32Array([0, 0, 1, 1]) });
    M.moMaskImagePut('00000000000000000000000b.png', { w: 4, h: 1, a: near });
    const subject = M.moMaskField({ invert: false, parts: [{ kind: 'subject', op: 'add', invert: false, file: '00000000000000000000000a.png' }] }, 4, 1);
    expect(Array.from(subject)).toEqual([0, 0, 1, 1]);
    const far = M.moMaskField({ invert: false, parts: [{ kind: 'distance', op: 'add', invert: false, file: '00000000000000000000000b.png', from: 0.5, soft: 0.1 }] }, 4, 1);
    expect(far[0]).toBe(0);
    expect(far[3]).toBe(1);
  });
  it('covers nothing until its image is there', () => {
    const f = M.moMaskField({ invert: false, parts: [{ kind: 'subject', op: 'add', invert: false, file: '' }] }, 3, 1);
    expect(Array.from(f)).toEqual([0, 0, 0]);
  });
});

describe('a plan that ignores its background', () => {
  // a 40 x 1 picture: twenty red pixels (the subject), then twenty clear blue (the background)
  const px = new Uint8ClampedArray(40 * 4);
  for (let i = 0; i < 40; i++) px.set(i < 20 ? [200 - (i % 3) * 5, 30, 30, 255] : [30, 30, 220, 0], i * 4);
  it('studies only what the picture keeps', () => {
    const P = moStudyAnalyse(px, 40, 1);
    expect(P.kept).toBe(20);
    const L = moStudyLight(P, 0, 'colours');
    expect(L.families[0].share + L.families[1].share).toBeCloseTo(1);
    const m = moStudyMasses(P, { n: 2, squint: 0, amount: 100, colour: 'average' });
    expect(m.masses.every((x: { rgb: number[] }) => x.rgb[0] > x.rgb[2])).toBe(true); // no blue from the background
    expect(Array.from(m.labels.slice(20)).every((l) => l === -1)).toBe(true);
    expect(Array.from(m.pixels.slice(30 * 4, 30 * 4 + 3))).toEqual([128, 128, 128]); // shown flat grey
  });
  it('keeps the switch and a mask image name, and nothing else', () => {
    expect(moPlanIsolateNormalize({ on: 1, file: 'abcdef0123456789abcdef01.png' })).toEqual({ on: true, file: 'abcdef0123456789abcdef01.png' });
    expect(moPlanIsolateNormalize({ on: true, file: 'C:/x.png' })).toEqual({ on: true, file: '' });
    expect(moPlanIsolateNormalize(undefined)).toEqual({ on: false, file: '' });
  });
});
