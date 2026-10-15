// moRawDeep.test.ts — a camera raw at full depth (ext/media-organizer/raw-deep.js):
// half floats, the 16-bit PPM LibRaw writes, a save's tile, removal patches, and
// the 16-bit PPM a 16-bit TIFF is written from.
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain JS module of the extension
import * as D from '../../ext/media-organizer/raw-deep.js';

const ppm16 = (w: number, h: number, px: number[][]) => {
  const head = new TextEncoder().encode(`P6\n# from LibRaw\n${w} ${h}\n65535\n`);
  const out = new Uint8Array(head.length + w * h * 6);
  out.set(head);
  let o = head.length;
  for (const p of px) for (const v of p) { out[o++] = v >> 8; out[o++] = v & 0xff; }
  return out;
};

describe('half floats', () => {
  it('round-trip the numbers a picture holds, to a half float’s precision', () => {
    for (const v of [0, 1, 0.5, 0.25, 0.1, 1 / 65535, 0.999, 0.0001]) {
      expect(Math.abs(D.moHalfValue(D.moHalfOf(v)) - v)).toBeLessThanOrEqual(Math.max(v * 0.001, 6e-8));
    }
    expect(D.moHalfOf(1)).toBe(0x3c00);
    expect(D.moHalfOf(0)).toBe(0);
  });
  it('keep levels apart that 8 bits would merge', () => {
    // Two shadow levels one 16-bit step apart stay apart; in 8 bits they are the same.
    const a = 1000 / 65535, b = 1001 / 65535;
    expect(D.moHalfOf(a)).not.toBe(D.moHalfOf(b));
    expect(Math.round(a * 255)).toBe(Math.round(b * 255));
  });
});

describe('the 16-bit picture LibRaw writes', () => {
  it('reads a 16-bit PPM, comments and all, as RGBA halves with opaque alpha', () => {
    const d = D.moDeepFromPpm(ppm16(2, 1, [[65535, 0, 32768], [1000, 1001, 0]]));
    expect(d.width).toBe(2); expect(d.height).toBe(1);
    expect(D.moHalfValue(d.half[0])).toBe(1);
    expect(D.moHalfValue(d.half[1])).toBe(0);
    expect(Math.abs(D.moHalfValue(d.half[2]) - 0.5)).toBeLessThan(0.001);
    expect(D.moHalfValue(d.half[3])).toBe(1);
    expect(d.half[4]).not.toBe(d.half[5]);
  });
  it('turns away what is not a binary PPM', () => {
    expect(D.moDeepFromPpm(new TextEncoder().encode('P3\n1 1\n255\n0 0 0'))).toBeNull();
    expect(D.moDeepFromPpm(ppm16(4, 4, [[1, 2, 3]]).slice(0, 40))).toBeNull(); // cut short
  });
});

describe('pieces and patches', () => {
  const d = D.moDeepFromPpm(ppm16(3, 2, [[0, 0, 0], [65535, 0, 0], [0, 65535, 0], [0, 0, 65535], [65535, 65535, 65535], [100, 200, 300]]));
  it('cuts a save’s tile out of the picture', () => {
    const t = D.moDeepCrop(d, 1, 0, 2, 2);
    expect([t.width, t.height]).toEqual([2, 2]);
    expect(D.moHalfValue(t.half[0])).toBe(1);          // (1,0) red
    expect(D.moHalfValue(t.half[4 + 1])).toBe(1);      // (2,0) green
    expect(D.moHalfValue(t.half[8 + 0])).toBe(1);      // (1,1) white
  });
  it('lays a patch over a copy and leaves the picture as it was', () => {
    const out = D.moDeepWithBoxes(d, [{ x: 0, y: 0, w: 1, h: 1, data: new Uint8ClampedArray([255, 128, 0, 255]) }]);
    expect(D.moHalfValue(out.half[0])).toBe(1);
    expect(Math.abs(D.moHalfValue(out.half[1]) - 128 / 255)).toBeLessThan(0.001);
    expect(D.moHalfValue(d.half[0])).toBe(0);
  });
});

describe('the 16-bit file a TIFF is written from', () => {
  it('writes 16-bit big-endian samples LibRaw’s reader reads back', () => {
    const f = new Float32Array([1, 0.5, 0, 1, 0.25, 0.75, 1, 1]);
    const back = D.moDeepFromPpm(D.moPpm16(f, 2, 1));
    expect(back.width).toBe(2);
    expect(Math.abs(D.moHalfValue(back.half[1]) - 0.5)).toBeLessThan(0.001);
    expect(Math.abs(D.moHalfValue(back.half[5]) - 0.75)).toBeLessThan(0.001);
  });
});
