/**
 * The Colour Study's arithmetic (ext/media-organizer/study-math.js): the
 * light and shadow split, nested colour masses, temperature, intensity and
 * two spots compared, on small made-up pictures.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error plain ES module without types
import * as S from '../../ext/media-organizer/study-math.js';

/** A w x h picture filled by fn(x, y) -> [r, g, b]. */
function picture(w: number, h: number, fn: (x: number, y: number) => number[]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y), i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  return px;
}
const RED = [200, 40, 30], BLUE = [30, 60, 190], CREAM = [235, 225, 200], DARK = [40, 35, 30];

describe('settings', () => {
  it('fills in and clamps a stored study', () => {
    const s = S.moStudyNormalize({ lens: 'masses', masses: { n: 40, method: 'nope' }, keep: -3 });
    expect(s.lens).toBe('masses');
    expect(s.masses.n).toBe(40);
    expect(s.masses.method).toBe('shapes');
    expect(s.keep).toBe(0);
    expect(S.moStudyNormalize(null).lens).toBe('light');
    expect(S.moStudyNormalize(undefined).split).toBeNull();
  });
});

describe('light and shadow', () => {
  const px = picture(40, 20, (x) => (x < 20 ? CREAM : DARK));
  const P = S.moStudyAnalyse(px, 40, 20);
  it('finds the value that splits the two families', () => {
    const light = S.moStudyValue(...CREAM), dark = S.moStudyValue(...DARK);
    expect(P.split).toBeGreaterThan(dark);
    expect(P.split).toBeLessThan(light);
  });
  it('shows each family in its own colour, half the picture each', () => {
    const r = S.moStudyLight(P, P.split, 'colours');
    expect(r.families[0].share).toBeCloseTo(0.5, 5);
    expect(r.families[1].share).toBeCloseTo(0.5, 5);
    expect(Math.abs(r.families[0].rgb[0] - CREAM[0])).toBeLessThan(3);
    expect(r.pixels.length).toBe(40 * 20 * 4);
  });
});

describe('colour masses', () => {
  const px = picture(60, 30, (x, y) => (x < 20 ? RED : x < 40 ? BLUE : y < 15 ? CREAM : DARK));
  it('finds one mass per colour, largest first, in that colour', () => {
    const P = S.moStudyAnalyse(px, 60, 30);
    const r = S.moStudyMasses(P, { n: 4, method: 'colour', colour: 'dominant', amount: 100 });
    expect(r.masses.length).toBe(4);
    for (const want of [RED, BLUE]) expect(r.masses.some((m: { rgb: number[] }) => m.rgb.every((v, i) => Math.abs(v - want[i]) < 4))).toBe(true);
    expect(r.masses[0].share).toBeGreaterThanOrEqual(r.masses[3].share);
  });
  it('raising the count only splits masses: every finer mass lies inside one coarser mass', () => {
    const P = S.moStudyAnalyse(px, 60, 30);
    S.moStudyMasses(P, { n: 4, method: 'colour', colour: 'dominant', amount: 100 });
    const tree = P.cache['m-s0'];
    const two = S.moStudyAtLevel(tree, 2), three = S.moStudyAtLevel(tree, 3);
    const parentOf = new Map<number, number>();
    for (let i = 0; i < two.length; i++) {
      const seen = parentOf.get(three[i]);
      if (seen === undefined) parentOf.set(three[i], two[i]); else expect(seen).toBe(two[i]);
    }
  });
  it('turns the colour down toward grey at the same value', () => {
    const P = S.moStudyAnalyse(px, 60, 30);
    const r = S.moStudyMasses(P, { n: 4, method: 'colour', colour: 'average', amount: 0 });
    for (const m of r.masses) expect(m.intensity).toBeLessThan(0.5);
  });
  it('fades toward the underpainting paint, not grey, when one is chosen', () => {
    const P = S.moStudyAnalyse(px, 60, 30);
    const sienna = [0.47, 0.08, 0.07]; // a burnt sienna in OKLab
    const r = S.moStudyMasses(P, { n: 4, squint: 0, colour: 'average', amount: 0, under: sienna });
    for (const m of r.masses) { expect(m.rgb[0]).toBeGreaterThan(m.rgb[2]); expect(m.intensity).toBeGreaterThan(0.5); }
  });
  it('finds up to 48 masses, and tells warm from cool against the whole picture', () => {
    const many = picture(64, 48, (x, y) => [(x * 4) % 256, (y * 5) % 256, ((x + y) * 3) % 256]);
    const P = S.moStudyAnalyse(many, 64, 48);
    const r = S.moStudyMasses(P, { n: 48, squint: 0, colour: 'average', amount: 100 });
    expect(r.masses.length).toBeGreaterThan(16);
    expect(r.masses.length).toBeLessThanOrEqual(48);
    const two = S.moStudyMasses(S.moStudyAnalyse(px, 60, 30), { n: 4, squint: 0, colour: 'average', amount: 100 });
    const red = two.masses.find((m: { rgb: number[] }) => m.rgb[0] > 150 && m.rgb[2] < 80), blue = two.masses.find((m: { rgb: number[] }) => m.rgb[2] > 150 && m.rgb[0] < 80);
    expect(red.temp).toBe('warm'); expect(blue.temp).toBe('cool');
  });
  it('is the same every time for the same picture', () => {
    const a = S.moStudyMasses(S.moStudyAnalyse(px, 60, 30), { n: 3, method: 'shapes', colour: 'dominant', amount: 100 });
    const b = S.moStudyMasses(S.moStudyAnalyse(px, 60, 30), { n: 3, method: 'shapes', colour: 'dominant', amount: 100 });
    expect(a.masses.map((m: { rgb: number[] }) => m.rgb)).toEqual(b.masses.map((m: { rgb: number[] }) => m.rgb));
  });
});

describe('temperature and intensity', () => {
  it('a flat grey picture has nothing warmer or cooler and no strong colour', () => {
    const px = picture(30, 20, () => [128, 128, 128]);
    const P = S.moStudyAnalyse(px, 30, 20);
    const t = S.moStudyTemperature(P, 'near', 25);
    const i = S.moStudyIntensityLens(P, 4);
    expect(i.keptShare).toBe(0);
    for (let k = 0; k < t.pixels.length; k += 4) expect(t.pixels[k]).toBe(t.pixels[k + 2]);   // grey: red equals blue
  });
  it('keeps colour only where it is stronger than the level', () => {
    const px = picture(40, 20, (x) => (x < 10 ? RED : [128, 128, 128]));
    const r = S.moStudyIntensityLens(S.moStudyAnalyse(px, 40, 20), 4);
    expect(r.keptShare).toBeCloseTo(0.25, 5);
  });
  it('orange marks what is warmer than its surroundings, blue what is cooler', () => {
    const px = picture(60, 20, (x) => (x < 30 ? [200, 120, 60] : [70, 110, 190]));
    const r = S.moStudyTemperature(S.moStudyAnalyse(px, 60, 20), 'all', 0);
    const at = (x: number) => { const i = (10 * 60 + x) * 4; return [r.pixels[i], r.pixels[i + 1], r.pixels[i + 2]]; };
    expect(at(5)[0]).toBeGreaterThan(at(5)[2]);    // left: warm
    expect(at(55)[2]).toBeGreaterThan(at(55)[0]);  // right: cool
  });
});

describe('two spots', () => {
  it('says B is darker and greyer, as a shadow side is', () => {
    const px = picture(40, 20, (x) => (x < 20 ? [230, 200, 60] : [110, 100, 70]));
    const P = S.moStudyAnalyse(px, 40, 20);
    const lines = S.moStudyCompare(S.moStudySpot(P, 5, 10), S.moStudySpot(P, 35, 10));
    expect(lines[0]).toMatch(/^B is \d+\.\d values darker/);
    expect(lines.join(' ')).toMatch(/greyer/);
    expect(lines[lines.length - 1]).toMatch(/shadow side/);
  });
  it('says so when two spots are the same', () => {
    const P = S.moStudyAnalyse(picture(20, 20, () => [120, 140, 90]), 20, 20);
    expect(S.moStudyCompare(S.moStudySpot(P, 3, 3), S.moStudySpot(P, 15, 15))).toEqual(expect.arrayContaining(['About the same value.', 'About the same temperature.', 'About the same intensity.']));
  });
});
