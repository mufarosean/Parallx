/**
 * Colour Study's paint engine, tested from its contract
 * (docs/ATELIER_COLOUR_STUDY.md, "The contract the tests and the probe are
 * written to", Engine) and the owner's acceptance list. Written before the
 * engine, by someone who did not build it.
 *
 * No test here measures time: speed is held by the size of the gamut and by
 * the same input giving back the same object.
 */

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — JS module with no types
import { MO_STARTER_PAINTS, MO_COMMON_PAINTS, MO_MIX_RULES, moHexRgb, moOklab, moCloseness } from '../../ext/media-organizer/colour.js';
// @ts-expect-error — JS module with no types
import { moWheelHue, moWheelAngle, MO_HARMONIES, moHarmonyHues, moHslRgb, moRgbHsl } from '../../ext/media-organizer/paint-wheel.js';
// @ts-expect-error — JS module with no types
import { moValue, moOklch, moFromOklch, moDeltaE, moColourAtValue, MO_MIX_KM, MO_MIX_GEOMETRIC, MO_MIX_MODEL, moMixRgb, moGamut, moRecipe, moReach, moDrift, moTubeNudges, moSubstitutes, moFixMix, moMixOrder, moVariationRows } from '../../ext/media-organizer/paint-engine.js';

// Building a gamut is real work; a slow machine must not fail a test for it.
vi.setConfig({ testTimeout: 120_000 });

type Rgb = [number, number, number];
type Paint = { name: string; hex: string };
type Cell = { rgb: Rgb; value: number; base?: boolean };

const OLIVE: Rgb = [93, 111, 60];
const BLUE: Rgb = [70, 110, 150];
const ORANGE: Rgb = [196, 122, 84];
const BASES: [string, Rgb][] = [['olive', OLIVE], ['blue', BLUE], ['orange', ORANGE]];
const TURQUOISE: Rgb = [0, 200, 220];

const STARTER: Paint[] = MO_STARTER_PAINTS;
const paint = (name: string): Paint => {
  const p = MO_COMMON_PAINTS.find((x: Paint) => x.name === name);
  if (!p) throw new Error(`no paint called ${name}`);
  return p;
};
const rgbOf = (name: string): Rgb => moHexRgb(paint(name).hex);
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const isBytes = (rgb: unknown) => Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
const hexOf = (rgb: Rgb) => rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const bareHex = (hex: string) => String(hex).replace(/^#/, '').toLowerCase();

// CIE L* / 10, worked here on its own so moValue is checked against the definition.
function valueRef(rgb: Rgb): number {
  const lin = rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return (Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y) / 10;
}

// About thirty colours spread over the cube, the same on every run.
function spread(n: number): Rgb[] {
  let s = 20261119;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s >>> 24; };
  return Array.from({ length: n }, () => [next(), next(), next()] as Rgb);
}
const SPREAD = spread(30);

// ── paint-wheel.js ───────────────────────────────────────────────────────────

describe('the painter’s wheel', () => {
  it('RYB mapping round-trips (angle → hue → angle) within 0.01°, across 0..359.5', () => {
    for (let a = 0; a <= 359.5; a += 0.5) {
      const hue = moWheelHue(a, 'painter');
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      const back = moWheelAngle(hue, 'painter');
      expect(back).toBeGreaterThanOrEqual(0);
      expect(back).toBeLessThan(360);
      expect(hueGap(back, a), `angle ${a}`).toBeLessThanOrEqual(0.01);
    }
  });

  it('the complement of Ultramarine’s hue in RYB (wheel angle + 180) lands in the orange range', () => {
    const [hue] = moRgbHsl(rgbOf('Ultramarine Blue'));
    const complement = moWheelHue((moWheelAngle(hue, 'painter') + 180) % 360, 'painter');
    expect(complement).toBeGreaterThanOrEqual(15);
    expect(complement).toBeLessThanOrEqual(45);
  });

  it('the painter model puts the contract’s hues at the contract’s angles, linear between', () => {
    const stops: [number, number][] = [[0, 0], [60, 30], [120, 60], [180, 120], [240, 240], [300, 285]];
    for (const [angle, hue] of stops) expect(moWheelHue(angle, 'painter')).toBeCloseTo(hue, 6);
    expect(moWheelHue(30, 'painter')).toBeCloseTo(15, 6);
    expect(moWheelHue(210, 'painter')).toBeCloseTo(180, 6);
    expect(moWheelHue(330, 'painter')).toBeCloseTo(322.5, 6);
    expect(moWheelHue(90)).toBeCloseTo(moWheelHue(90, 'painter'), 9); // painter is the default
  });

  it('the screen model is the identity', () => {
    for (const a of [0, 17.5, 120, 240, 359.5]) {
      expect(moWheelHue(a, 'screen')).toBeCloseTo(a, 9);
      expect(moWheelAngle(a, 'screen')).toBeCloseTo(a, 9);
    }
  });

  it('lists the harmonies as wheel-angle offsets', () => {
    expect(MO_HARMONIES.complementary).toEqual([0, 180]);
    expect(MO_HARMONIES.splitComplementary).toEqual([0, 150, 210]);
    expect(MO_HARMONIES.triadic).toEqual([0, 120, 240]);
    expect(MO_HARMONIES.tetradic).toEqual([0, 60, 180, 300]);
    expect(MO_HARMONIES.square).toEqual([0, 90, 180, 270]);
    expect(MO_HARMONIES.analogous).toEqual([0, -30, 30]);
  });

  it('complementary of a base hue in the painter model gives 2 hues, base first', () => {
    for (const base of [0, 47, 200, 310]) {
      const hues = moHarmonyHues('complementary', base, 'painter');
      expect(hues).toHaveLength(2);
      expect(hueGap(hues[0], base)).toBeLessThanOrEqual(0.01);
    }
  });

  it('every harmony gives one hue per offset, each in [0, 360), the base first', () => {
    for (const type of Object.keys(MO_HARMONIES)) {
      for (const model of ['painter', 'screen']) {
        const hues: number[] = moHarmonyHues(type, 75, model);
        expect(hues).toHaveLength(MO_HARMONIES[type].length);
        expect(hueGap(hues[0], 75)).toBeLessThanOrEqual(0.01);
        for (const h of hues) { expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(360); }
      }
    }
  });

  it('painter complements: red↔green, blue↔orange, yellow↔violet', () => {
    const comp = (hue: number): number => moHarmonyHues('complementary', hue, 'painter')[1];
    const within = (h: number, lo: number, hi: number) => { expect(h).toBeGreaterThanOrEqual(lo); expect(h).toBeLessThanOrEqual(hi); };
    within(comp(0), 90, 150); // red → green
    expect(hueGap(comp(120), 0)).toBeLessThanOrEqual(15); // green → red
    within(comp(240), 15, 45); // blue → orange
    within(comp(30), 210, 250); // orange → blue
    within(comp(60), 260, 300); // yellow → violet
    within(comp(285), 45, 75); // violet → yellow
  });

  it('screen complements sit opposite on the screen’s wheel', () => {
    expect(hueGap(moHarmonyHues('complementary', 240, 'screen')[1], 60)).toBeLessThanOrEqual(0.01);
    const triad: number[] = moHarmonyHues('triadic', 10, 'screen');
    expect(hueGap(triad[1], 130)).toBeLessThanOrEqual(0.01);
    expect(hueGap(triad[2], 250)).toBeLessThanOrEqual(0.01);
  });

  it('moHslRgb gives the colours everyone knows', () => {
    expect(moHslRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(moHslRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
    expect(moHslRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
    expect(moHslRgb(0, 0, 1)).toEqual([255, 255, 255]);
    expect(moHslRgb(200, 0.6, 0)).toEqual([0, 0, 0]);
    const [h, s, l] = moRgbHsl([0, 0, 255]);
    expect(h).toBeCloseTo(240, 6);
    expect(s).toBeCloseTo(1, 6);
    expect(l).toBeCloseTo(0.5, 6);
  });

  it('moHslRgb and moRgbHsl round-trip', () => {
    for (let h = 0; h < 360; h += 30) {
      for (const s of [0.25, 0.5, 1]) {
        for (const l of [0.25, 0.5, 0.75]) {
          const rgb: Rgb = moHslRgb(h, s, l);
          expect(isBytes(rgb), `hsl ${h} ${s} ${l}`).toBe(true);
          const hsl = moRgbHsl(rgb);
          expect(hueGap(hsl[0], h)).toBeLessThanOrEqual(2);
          expect(Math.abs(hsl[1] - s)).toBeLessThanOrEqual(0.02);
          expect(Math.abs(hsl[2] - l)).toBeLessThanOrEqual(0.01);
          expect(moHslRgb(hsl[0], hsl[1], hsl[2])).toEqual(rgb);
        }
      }
    }
  });
});

// ── paint-engine.js: colour ──────────────────────────────────────────────────

describe('value and OKLCH', () => {
  it('moValue is CIE L* / 10, not rounded', () => {
    expect(moValue([0, 0, 0])).toBeCloseTo(0, 6);
    expect(moValue([255, 255, 255])).toBeCloseTo(10, 4);
    for (const rgb of [OLIVE, BLUE, ORANGE, ...SPREAD.slice(0, 8)]) expect(moValue(rgb)).toBeCloseTo(valueRef(rgb), 4);
    expect(Number.isInteger(moValue(OLIVE))).toBe(false);
  });

  it('moOklch is OKLab in polar form, hue in degrees', () => {
    for (const rgb of [OLIVE, BLUE, ORANGE]) {
      const [L, a, b] = moOklab(rgb[0], rgb[1], rgb[2]);
      const [l, c, h] = moOklch(rgb);
      expect(l).toBeCloseTo(L, 6);
      expect(c).toBeCloseTo(Math.hypot(a, b), 6);
      expect(hueGap(h, (Math.atan2(b, a) * 180) / Math.PI + 360)).toBeLessThanOrEqual(0.001);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('moFromOklch brings an in-range colour back', () => {
    for (const rgb of [OLIVE, BLUE, ORANGE]) {
      const [L, C, h] = moOklch(rgb);
      const back: Rgb = moFromOklch(L, C, h);
      for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - rgb[i])).toBeLessThanOrEqual(1);
    }
  });

  it('moFromOklch returns in-range bytes for an out-of-gamut request and keeps hue within a few degrees', () => {
    for (const h of [30, 90, 150, 210, 270, 330]) {
      const rgb: Rgb = moFromOklch(0.7, 0.4, h);
      expect(isBytes(rgb), `hue ${h}`).toBe(true);
      const [, C, back] = moOklch(rgb);
      expect(C).toBeLessThan(0.4); // chroma was given up
      expect(C).toBeGreaterThan(0.02); // not all of it
      expect(hueGap(back, h), `hue ${h}`).toBeLessThanOrEqual(5);
    }
  });

  it('moDeltaE is the distance in OKLab', () => {
    expect(moDeltaE(OLIVE, OLIVE)).toBe(0);
    const p = moOklab(OLIVE[0], OLIVE[1], OLIVE[2]), q = moOklab(BLUE[0], BLUE[1], BLUE[2]);
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    expect(moDeltaE(OLIVE, BLUE)).toBeCloseTo(d, 6);
    expect(moDeltaE(BLUE, OLIVE)).toBeCloseTo(d, 6);
  });

  it('moColourAtValue hits the value within 0.1', () => {
    for (const [name, base] of BASES) {
      const [, C, h] = moOklch(base);
      for (const value of [1.5, 3, 4.5, 6, 7.5, 9]) {
        const rgb: Rgb = moColourAtValue(h, C, value);
        expect(isBytes(rgb), `${name} at ${value}`).toBe(true);
        expect(Math.abs(moValue(rgb) - value), `${name} at ${value}`).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it('moColourAtValue keeps the hue it was asked for', () => {
    for (const [name, base] of BASES) {
      const [, C, h] = moOklch(base);
      const [, , back] = moOklch(moColourAtValue(h, C, 6));
      expect(hueGap(back, h), name).toBeLessThanOrEqual(5);
    }
  });
});

// ── paint-engine.js: variation rows ──────────────────────────────────────────

describe('variation rows', () => {
  it('value-scale cells hit their target values within ±0.15', () => {
    for (const [name, base] of BASES) {
      const row: Cell[] = moVariationRows(base).value;
      expect(row).toHaveLength(10);
      row.forEach((cell, i) => {
        const target = 1 + (i * (9.5 - 1)) / (row.length - 1);
        expect(Math.abs(moValue(cell.rgb) - target), `${name} cell ${i}`).toBeLessThanOrEqual(0.15);
      });
    }
  });

  it('tone and warm↔cool cells stay within ±0.15 of the base value', () => {
    for (const [name, base] of BASES) {
      const rows = moVariationRows(base);
      const v = moValue(base);
      (rows.tone as Cell[]).forEach((cell, i) => expect(Math.abs(moValue(cell.rgb) - v), `${name} tone ${i}`).toBeLessThanOrEqual(0.15));
      (rows.temp as Cell[]).forEach((cell, i) => expect(Math.abs(moValue(cell.rgb) - v), `${name} temp ${i}`).toBeLessThanOrEqual(0.15));
    }
  });

  it('value twins stay within ±0.2 of the base value', () => {
    for (const [name, base] of BASES) {
      const v = moValue(base);
      (moVariationRows(base).twins as Cell[]).forEach((cell, i) => expect(Math.abs(moValue(cell.rgb) - v), `${name} twin ${i}`).toBeLessThanOrEqual(0.2));
    }
  });

  it('returns five rows of the asked cell count', () => {
    for (const cells of [6, 10]) {
      const rows = moVariationRows(OLIVE, { cells });
      expect(Object.keys(rows).sort()).toEqual(['light', 'temp', 'tone', 'twins', 'value']);
      for (const key of ['value', 'light', 'tone', 'temp', 'twins']) {
        expect(rows[key], key).toHaveLength(cells);
        for (const cell of rows[key] as Cell[]) {
          expect(isBytes(cell.rgb), key).toBe(true);
          expect(typeof cell.value).toBe('number');
        }
      }
    }
  });

  it('gives ten cells to a row when none are asked for', () => {
    const rows = moVariationRows(BLUE);
    for (const key of ['value', 'light', 'tone', 'temp', 'twins']) expect(rows[key], key).toHaveLength(10);
  });

  it('the value row ascends, dark to light', () => {
    for (const [name, base] of BASES) {
      const row: Cell[] = moVariationRows(base, { cells: 8 }).value;
      for (let i = 1; i < row.length; i++) {
        expect(moValue(row[i].rgb), `${name} cell ${i}`).toBeGreaterThan(moValue(row[i - 1].rgb));
        expect(row[i].value, `${name} cell ${i}`).toBeGreaterThan(row[i - 1].value);
      }
    }
  });

  it('the value row has exactly one base cell', () => {
    for (const [name, base] of BASES) {
      const row: Cell[] = moVariationRows(base).value;
      expect(row.filter((cell) => cell.base), name).toHaveLength(1);
    }
  });

  it('the twins row’s first cell is the base', () => {
    for (const [, base] of BASES) expect(moVariationRows(base).twins[0].rgb).toEqual(base);
  });

  it('the light row differs between warm and cool light', () => {
    const warm: Cell[] = moVariationRows(OLIVE, { light: 'warm' }).light;
    const cool: Cell[] = moVariationRows(OLIVE, { light: 'cool' }).light;
    expect(warm.map((c) => c.rgb)).not.toEqual(cool.map((c) => c.rgb));
    expect(moVariationRows(OLIVE).light.map((c: Cell) => c.rgb)).toEqual(warm.map((c) => c.rgb)); // warm is the default
  });
});

// ── paint-engine.js: mixing ──────────────────────────────────────────────────

describe('mixing', () => {
  it('Ultramarine + Yellow Ochre gives a dull green-grey', () => {
    const rgb: Rgb = moMixRgb([paint('Ultramarine Blue'), paint('Yellow Ochre')], [1, 1], MO_MIX_MODEL);
    expect(isBytes(rgb)).toBe(true);
    expect(rgb[1]).toBeGreaterThanOrEqual(rgb[0]);
    expect(moOklch(rgb)[1]).toBeLessThan(0.1);
  });

  it('White + Cadmium Red Light gives a pink with higher value than the red', () => {
    const red = rgbOf('Cadmium Red Light');
    const rgb: Rgb = moMixRgb([paint('Titanium White'), paint('Cadmium Red Light')], [1, 1], MO_MIX_MODEL);
    expect(moValue(rgb)).toBeGreaterThan(moValue(red));
    expect(rgb[0]).toBeGreaterThan(rgb[1]); // still a red, lightened
    expect(rgb[0]).toBeGreaterThan(rgb[2]);
    expect(Math.min(rgb[1], rgb[2])).toBeGreaterThan(Math.min(red[1], red[2])); // with white in it
  });

  it('moMixRgb uses the model in use when none is named', () => {
    const pair = [paint('Ultramarine Blue'), paint('Yellow Ochre')];
    expect([MO_MIX_KM, MO_MIX_GEOMETRIC]).toContain(MO_MIX_MODEL);
    expect(moMixRgb(pair, [2, 1])).toEqual(moMixRgb(pair, [2, 1], MO_MIX_MODEL));
  });

  it('one paint alone mixes to its own colour', () => {
    for (const p of STARTER) {
      const rgb: Rgb = moMixRgb([p], [1]);
      const own: Rgb = moHexRgb(p.hex);
      for (let i = 0; i < 3; i++) expect(Math.abs(rgb[i] - own[i]), p.name).toBeLessThanOrEqual(2);
    }
  });

  it('a paint’s hex works with or without the hash', () => {
    const withHash = [paint('Ultramarine Blue'), paint('Cadmium Yellow Light')];
    const without = withHash.map((p) => ({ name: p.name, hex: bareHex(p.hex) }));
    expect(moMixRgb(without, [1, 2])).toEqual(moMixRgb(withHash, [1, 2]));
  });

  it('each mixing model has a name, a prep and a mix that returns linear rgb in 0..1', () => {
    for (const model of [MO_MIX_KM, MO_MIX_GEOMETRIC, MO_MIX_MODEL]) {
      expect(typeof model.name).toBe('string');
      expect(model.name.length).toBeGreaterThan(0);
      const prepared = [paint('Alizarin Crimson'), paint('Sap Green')].map((p) => model.prep(p));
      const lin: number[] = model.mix(prepared, [1, 2]);
      expect(lin).toHaveLength(3);
      for (const v of lin) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    expect(MO_MIX_KM.name).not.toBe(MO_MIX_GEOMETRIC.name);
  });

  it('MO_MIX_GEOMETRIC.mix of Ultramarine + white is a blue lighter than Ultramarine', () => {
    const lum = (l: number[]) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    const blue = MO_MIX_GEOMETRIC.prep(paint('Ultramarine Blue'));
    const white = MO_MIX_GEOMETRIC.prep(paint('Titanium White'));
    const alone: number[] = MO_MIX_GEOMETRIC.mix([blue], [1]);
    const tint: number[] = MO_MIX_GEOMETRIC.mix([blue, white], [1, 1]);
    expect(tint[2]).toBeGreaterThan(tint[0]);
    expect(tint[2]).toBeGreaterThan(tint[1]);
    expect(lum(tint)).toBeGreaterThan(lum(alone));
    const tintRgb: Rgb = moMixRgb([paint('Ultramarine Blue'), paint('Titanium White')], [1, 1], MO_MIX_GEOMETRIC);
    expect(moValue(tintRgb)).toBeGreaterThan(moValue(rgbOf('Ultramarine Blue')));
  });
});

// ── paint-engine.js: gamut, recipe, reach ────────────────────────────────────

describe('gamut and recipe', () => {
  it('moGamut for the 8 starter paints has a size between 2,000 and 60,000', () => {
    const gamut = moGamut(STARTER);
    expect(gamut.size).toBeGreaterThanOrEqual(2000);
    expect(gamut.size).toBeLessThanOrEqual(60000);
    expect(gamut.paints.map((p: Paint) => p.name)).toEqual(STARTER.map((p) => p.name));
  });

  it('moGamut with an equal-but-not-identical paint array returns the very same object', () => {
    const first = moGamut(STARTER);
    const copy = STARTER.map((p) => ({ name: p.name, hex: p.hex }));
    expect(copy).not.toBe(STARTER);
    expect(moGamut(copy)).toBe(first);
    expect(moGamut(STARTER.map((p) => ({ ...p })), { ...MO_MIX_RULES }, MO_MIX_MODEL)).toBe(moGamut(STARTER, MO_MIX_RULES, MO_MIX_MODEL));
  });

  it('moRecipe twice for the same colour returns equal results', () => {
    const gamut = moGamut(STARTER);
    for (const rgb of [OLIVE, BLUE, ORANGE, TURQUOISE]) expect(moRecipe(gamut, [...rgb])).toEqual(moRecipe(gamut, rgb));
  });

  it('a recipe for an exact two-paint mix returns that mix (or one within ΔE 0.01)', () => {
    const gamut = moGamut(STARTER);
    const mixes: [string, string, number[]][] = [
      ['Ultramarine Blue', 'Cadmium Yellow Light', [1, 2]],
      ['Cadmium Red Light', 'Yellow Ochre', [2, 1]],
      ['Alizarin Crimson', 'Sap Green', [1, 1]],
      ['Burnt Umber', 'Ultramarine Blue', [1, 1]],
    ];
    for (const [a, b, parts] of mixes) {
      const target: Rgb = moMixRgb([paint(a), paint(b)], parts);
      const recipe = moRecipe(gamut, target);
      expect(moDeltaE(recipe.rgb, target), `${a} + ${b}`).toBeLessThanOrEqual(0.01);
    }
  });

  it('removing Sap Green from the paint list makes a mid-value olive less reachable', () => {
    const withGreen = moRecipe(moGamut(STARTER), OLIVE);
    const withoutGreen = moRecipe(moGamut(STARTER.filter((p) => p.name !== 'Sap Green')), OLIVE);
    // `nearest` is the smallest distance any mix reaches; `de` is the chosen
    // recipe's, which may be a simpler mix a little further off.
    expect(withoutGreen.nearest).toBeGreaterThan(withGreen.nearest);
    expect(moReach(moGamut(STARTER.filter((p) => p.name !== 'Sap Green')), OLIVE)).toBeLessThanOrEqual(moReach(moGamut(STARTER), OLIVE));
  });

  it('the chosen recipe is never nearer than the nearest mix', () => {
    const gamut = moGamut(STARTER);
    for (const rgb of [...SPREAD, OLIVE, BLUE, ORANGE, TURQUOISE]) {
      const recipe = moRecipe(gamut, rgb);
      expect(recipe.nearest).toBeGreaterThanOrEqual(0);
      expect(recipe.de, `colour ${rgb.join(',')}`).toBeGreaterThanOrEqual(recipe.nearest - 1e-6); // the two may be held at different float widths
    }
  });

  it('adding a paint never makes anything less reachable', () => {
    const eight = moGamut(STARTER);
    for (const extra of ['Cerulean Blue', 'Cadmium Orange']) {
      const nine = moGamut([...STARTER, paint(extra)]);
      for (const rgb of [...SPREAD, OLIVE, BLUE, ORANGE]) {
        const at = `${extra}, colour ${rgb.join(',')}`;
        expect(moRecipe(nine, rgb).nearest, at).toBeLessThanOrEqual(moRecipe(eight, rgb).nearest + 1e-9);
        expect(moReach(nine, rgb), at).toBeGreaterThanOrEqual(moReach(eight, rgb) - 1e-6);
      }
    }
  });

  it('a recipe’s paints each have a role and whole parts of at least 1', () => {
    const gamut = moGamut(STARTER);
    for (const rgb of [OLIVE, BLUE, ORANGE, TURQUOISE]) {
      const recipe = moRecipe(gamut, rgb);
      expect(recipe.paints.length).toBeGreaterThanOrEqual(1);
      const names = recipe.paints.map((p: Paint) => p.name);
      expect(new Set(names).size).toBe(names.length);
      for (const p of recipe.paints) {
        expect(typeof p.role).toBe('string');
        expect(p.role.trim().length).toBeGreaterThan(0);
        expect(Number.isInteger(p.parts)).toBe(true);
        expect(p.parts).toBeGreaterThanOrEqual(1);
        const tube = STARTER.find((x) => x.name === p.name);
        expect(tube, p.name).toBeTruthy();
        expect(bareHex(p.hex)).toBe(bareHex(tube!.hex));
      }
    }
  });

  it('a recipe carries its colour, its distance and the word for it', () => {
    const gamut = moGamut(STARTER);
    for (const rgb of [OLIVE, BLUE, ORANGE, TURQUOISE]) {
      const recipe = moRecipe(gamut, rgb);
      expect(isBytes(recipe.rgb)).toBe(true);
      expect(bareHex(recipe.hex)).toBe(hexOf(recipe.rgb));
      expect(recipe.de).toBeGreaterThanOrEqual(0);
      expect(recipe.closeness).toBe(moCloseness(recipe.de));
      expect(typeof recipe.reachable).toBe('boolean');
    }
  });

  it('a recipe’s colour is what its paints mix to', () => {
    const recipe = moRecipe(moGamut(STARTER), OLIVE);
    const mixed: Rgb = moMixRgb(recipe.paints.map((p: Paint) => paint(p.name)), recipe.paints.map((p: { parts: number }) => p.parts));
    for (let i = 0; i < 3; i++) expect(Math.abs(mixed[i] - recipe.rgb[i])).toBeLessThanOrEqual(1);
  });

  it('a recipe follows the mixing rules: no more paints than allowed besides free white', () => {
    const gamut = moGamut(STARTER);
    for (const rgb of [OLIVE, BLUE, ORANGE, ...SPREAD.slice(0, 10)]) {
      const coloured = moRecipe(gamut, rgb).paints.filter((p: Paint) => p.name !== 'Titanium White');
      expect(coloured.length).toBeLessThanOrEqual(MO_MIX_RULES.max);
    }
  });

  it('reachable is true for an easy colour and false for a saturated turquoise', () => {
    const gamut = moGamut(STARTER);
    expect(moRecipe(gamut, rgbOf('Yellow Ochre')).reachable).toBe(true);
    expect(moRecipe(gamut, OLIVE).reachable).toBe(true);
    expect(moRecipe(gamut, TURQUOISE).reachable).toBe(false);
  });

  it('moReach is in [0, 1], near 1 for a paint’s own colour and near 0 for cyan', () => {
    const gamut = moGamut(STARTER);
    for (const rgb of [...SPREAD, OLIVE, BLUE, ORANGE, TURQUOISE]) {
      const reach = moReach(gamut, rgb);
      expect(reach).toBeGreaterThanOrEqual(0);
      expect(reach).toBeLessThanOrEqual(1);
    }
    for (const p of STARTER) expect(moReach(gamut, moHexRgb(p.hex)), p.name).toBeGreaterThanOrEqual(0.9);
    expect(moReach(gamut, [0, 255, 255])).toBeLessThanOrEqual(0.1);
  });

  it('moReach agrees with the recipe: a nearer colour is not less within reach', () => {
    const gamut = moGamut(STARTER);
    expect(moReach(gamut, OLIVE)).toBeGreaterThan(moReach(gamut, TURQUOISE));
  });
});

// ── paint-engine.js: the bench ───────────────────────────────────────────────

describe('drift, nudges and fixes', () => {
  const DARK_GREEN = [{ name: 'Sap Green', parts: 2 }, { name: 'Ultramarine Blue', parts: 1 }];
  const BRIGHT_ORANGE = [{ name: 'Cadmium Red Light', parts: 1 }, { name: 'Cadmium Yellow Light', parts: 2 }];
  const mixRgb = (mix: { name: string; parts: number }[]): Rgb => moMixRgb(mix.map((m) => paint(m.name)), mix.map((m) => m.parts));
  const WORDS = ['Very close', 'Close', 'Near', 'Far'];

  it('moDrift of a colour to a darker one reports negative dValue and says "darker"', () => {
    const drift = moDrift([150, 160, 120], [80, 90, 60]);
    expect(drift.dValue).toBeLessThan(0);
    expect(drift.dValue).toBeCloseTo(moValue([80, 90, 60]) - moValue([150, 160, 120]), 4);
    expect(drift.text).toContain('darker');
    expect(drift.de).toBeGreaterThan(0);
    expect(WORDS).toContain(drift.closeness);
    for (const key of ['dValue', 'dChroma', 'dHue', 'de']) expect(Number.isFinite(drift[key]), key).toBe(true);
  });

  it('moDrift of a colour to a lighter one reports positive dValue and does not say "darker"', () => {
    const drift = moDrift([80, 90, 60], [150, 160, 120]);
    expect(drift.dValue).toBeGreaterThan(0);
    expect(drift.text).not.toContain('darker');
  });

  it('moDrift to a duller colour of the same value reports negative dChroma', () => {
    const [, C, h] = moOklch(ORANGE);
    const duller: Rgb = moColourAtValue(h, C / 3, moValue(ORANGE));
    expect(moDrift(ORANGE, duller).dChroma).toBeLessThan(0);
  });

  it('moDrift of a colour to itself is no drift', () => {
    const drift = moDrift(OLIVE, OLIVE);
    expect(drift.dValue).toBeCloseTo(0, 9);
    expect(drift.dChroma).toBeCloseTo(0, 9);
    expect(drift.de).toBeCloseTo(0, 9);
    expect(drift.closeness).toBe('Very close');
    expect(typeof drift.text).toBe('string');
  });

  it('moTubeNudges returns one entry per paint and adding Titanium White raises value', () => {
    const nudges = moTubeNudges(STARTER, DARK_GREEN, 1);
    expect(nudges).toHaveLength(STARTER.length);
    expect(nudges.map((n: Paint) => n.name).sort()).toEqual(STARTER.map((p) => p.name).sort());
    for (const n of nudges) {
      expect(isBytes(n.rgb), n.name).toBe(true);
      expect(bareHex(n.hex)).toBe(bareHex(paint(n.name).hex));
      expect(Number.isFinite(n.drift.dValue)).toBe(true);
    }
    const white = nudges.find((n: Paint) => n.name === 'Titanium White');
    expect(white.drift.dValue).toBeGreaterThan(0);
    expect(moValue(white.rgb)).toBeGreaterThan(moValue(mixRgb(DARK_GREEN)));
  });

  it('a nudge shows the mix with one more part of that paint', () => {
    const nudges = moTubeNudges(STARTER, DARK_GREEN); // add = 1 by default
    const umber = nudges.find((n: Paint) => n.name === 'Burnt Umber');
    const expected = mixRgb([...DARK_GREEN, { name: 'Burnt Umber', parts: 1 }]);
    for (let i = 0; i < 3; i++) expect(Math.abs(umber.rgb[i] - expected[i])).toBeLessThanOrEqual(1);
    const green = nudges.find((n: Paint) => n.name === 'Sap Green');
    const more = mixRgb([{ name: 'Sap Green', parts: 3 }, { name: 'Ultramarine Blue', parts: 1 }]);
    for (let i = 0; i < 3; i++) expect(Math.abs(green.rgb[i] - more[i])).toBeLessThanOrEqual(1);
  });

  it('moSubstitutes returns recipes none of which use the paint left out', () => {
    const subs = moSubstitutes(STARTER, MO_MIX_RULES, OLIVE, 'Sap Green');
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs.length).toBeLessThanOrEqual(3);
    for (const recipe of subs) {
      expect(recipe.paints.length).toBeGreaterThanOrEqual(1);
      expect(recipe.paints.map((p: Paint) => p.name)).not.toContain('Sap Green');
      expect(isBytes(recipe.rgb)).toBe(true);
    }
    for (let i = 1; i < subs.length; i++) expect(subs[i].de).toBeGreaterThanOrEqual(subs[i - 1].de); // closest first
  });

  it('moFixMix "dark" on a dark green mix suggests something whose result is lighter', () => {
    const fix = moFixMix(STARTER, DARK_GREEN, 'dark');
    expect(fix).not.toBeNull();
    expect(fix.drift.dValue).toBeGreaterThan(0);
    expect(moValue(fix.rgb)).toBeGreaterThan(moValue(mixRgb(DARK_GREEN)));
    expect(['add', 'less']).toContain(fix.action);
    expect(STARTER.map((p) => p.name)).toContain(fix.name);
    expect(fix.text.trim().length).toBeGreaterThan(0);
  });

  it('moFixMix "bright" gives a result with lower chroma', () => {
    const fix = moFixMix(STARTER, BRIGHT_ORANGE, 'bright');
    expect(fix).not.toBeNull();
    expect(moOklch(fix.rgb)[1]).toBeLessThan(moOklch(mixRgb(BRIGHT_ORANGE))[1]);
    expect(fix.drift.dChroma).toBeLessThan(0);
    expect(['add', 'less']).toContain(fix.action);
  });

  it('moFixMix answers every problem with a paint of the list or with null', () => {
    for (const problem of ['bright', 'dull', 'dark', 'light', 'warm', 'cool']) {
      const fix = moFixMix(STARTER, DARK_GREEN, problem);
      if (fix === null) continue;
      expect(['add', 'less'], problem).toContain(fix.action);
      expect(STARTER.map((p) => p.name), problem).toContain(fix.name);
      expect(isBytes(fix.rgb), problem).toBe(true);
      expect(typeof fix.text, problem).toBe('string');
      if (fix.action === 'less') expect(DARK_GREEN.map((m) => m.name), problem).toContain(fix.name);
    }
  });

  it('moFixMix "light" on a pale mix suggests something whose result is darker', () => {
    const pale = [{ name: 'Titanium White', parts: 3 }, { name: 'Yellow Ochre', parts: 1 }];
    const fix = moFixMix(STARTER, pale, 'light');
    expect(fix).not.toBeNull();
    expect(fix.drift.dValue).toBeLessThan(0);
  });

  it('moMixOrder returns every paint of the recipe once', () => {
    const gamut = moGamut(STARTER);
    for (const rgb of [OLIVE, BLUE, ORANGE]) {
      const recipe = moRecipe(gamut, rgb);
      const order = moMixOrder(recipe.paints, STARTER);
      expect([...order.order].sort()).toEqual(recipe.paints.map((p: Paint) => p.name).sort());
      expect(typeof order.text).toBe('string');
      expect(order.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('moMixOrder orders a mix written by hand, too', () => {
    const mix = [{ name: 'Titanium White', hex: paint('Titanium White').hex, parts: 3 }, { name: 'Ultramarine Blue', hex: paint('Ultramarine Blue').hex, parts: 1 },
      { name: 'Burnt Umber', hex: paint('Burnt Umber').hex, parts: 1 }];
    const order = moMixOrder(mix, STARTER);
    expect([...order.order].sort()).toEqual(['Burnt Umber', 'Titanium White', 'Ultramarine Blue']);
  });
});
