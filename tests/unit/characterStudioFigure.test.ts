import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error plain ESM extension module
import { Figure, cornerWeights, interpolationCoefficients, smoothNormals } from '../../ext/character-studio/figure.js';

const DIR = join(__dirname, '..', '..', 'ext', 'character-studio', 'figure');
let fig: any;
const base = { gender: 0.5, age: 2 / 3, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5 };
const heightOf = (p: Float32Array) => Figure.heightOf(p).height;

beforeAll(() => {
  const meta = JSON.parse(readFileSync(join(DIR, 'figure.json'), 'utf8'));
  const b = readFileSync(join(DIR, 'figure.bin'));
  fig = new Figure(meta, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

describe('Character Studio figure', () => {
  it('interpolates like Anny and its corner weights sum to one', () => {
    expect(interpolationCoefficients(0.25, [0, 0.5, 1])).toEqual([0.5, 0.5, 0]);
    expect(interpolationCoefficients(2, [0, 1])).toEqual([0, 1]);
    const w = cornerWeights(fig.meta.features, { gender: 0.3, age: 0.5, muscle: 0.7, weight: 0.2, height: 0.6, proportions: 0.1 });
    expect(w.length).toBe(64);
    expect(w.reduce((s: number, c: any) => s + c.weight, 0)).toBeCloseTo(1, 10);
  });

  it('makes adult bodies of human height, and the sliders move them the right way', () => {
    const adult = heightOf(fig.compute({ body: base }).positions);
    expect(adult).toBeGreaterThan(1.5); expect(adult).toBeLessThan(1.9);
    const tall = heightOf(fig.compute({ body: { ...base, height: 1 } }).positions);
    const short = heightOf(fig.compute({ body: { ...base, height: 0 } }).positions);
    expect(tall).toBeGreaterThan(adult); expect(short).toBeLessThan(adult);
    const male = heightOf(fig.compute({ body: { ...base, gender: 0 } }).positions);
    const female = heightOf(fig.compute({ body: { ...base, gender: 1 } }).positions);
    expect(male).toBeGreaterThan(female);
    const baby = heightOf(fig.compute({ body: { ...base, age: 0 } }).positions);
    expect(baby).toBeLessThan(1); expect(baby).toBeGreaterThan(0.4);
  });

  it('a detail slider moves only its region, both ways', () => {
    const plain = fig.compute({ body: base }).positions.slice();
    const d = fig.detailByLabel.get('nose-scale-horiz-incr');
    expect(d).toBeTruthy();
    const wide = fig.compute({ body: base, details: { 'nose-scale-horiz-incr': 1 } }).positions;
    const narrow = fig.compute({ body: base, details: { 'nose-scale-horiz-incr': -1 } }).positions;
    let moved = 0;
    for (let i = 0; i < plain.length; i++) if (Math.abs(wide[i] - plain[i]) > 1e-6 || Math.abs(narrow[i] - plain[i]) > 1e-6) moved++;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(plain.length / 10);
  });

  it('fits the eyes to the head and the hair above them', () => {
    const { positions } = fig.compute({ body: base });
    const { hi } = Figure.heightOf(positions);
    const centre = (p: Float32Array) => { let y = 0; for (let i = 1; i < p.length; i += 3) y += p[i]; return y / (p.length / 3); };
    const eyes = fig.proxyPositions(fig.itemById.get('eyes/high-poly'), positions);
    const hair = fig.proxyPositions(fig.itemById.get('hair/short02'), positions);
    expect(hi - centre(eyes)).toBeGreaterThan(0.05); expect(hi - centre(eyes)).toBeLessThan(0.2);
    expect(centre(hair)).toBeGreaterThan(centre(eyes));
  });

  it('gives every GPU vertex a unit normal', () => {
    const { positions } = fig.compute({ body: base });
    const n = smoothNormals(positions, fig.sourceTriangles, fig.gpuSource);
    for (let g = 0; g < n.length; g += 3 * 97) expect(Math.hypot(n[g], n[g + 1], n[g + 2])).toBeCloseTo(1, 4);
  });

  it('skins every proxy vertex to bones whose weights sum to one', () => {
    const { weight } = fig.proxySkin(fig.itemById.get('hair/long01'));
    for (let i = 0; i < weight.length; i += 4 * 31) expect(weight[i] + weight[i + 1] + weight[i + 2] + weight[i + 3]).toBeCloseTo(1, 5);
  });
});
