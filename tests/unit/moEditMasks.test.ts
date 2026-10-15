// moEditMasks.test.ts — masks' arithmetic (ext/media-organizer/edit-masks.js):
// what a stored mask becomes, where a gradient covers the photo, how parts
// combine, and the passes the engine is handed.
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain JS module of the extension
import * as M from '../../ext/media-organizer/edit-masks.js';

const linear = (o = {}) => ({ kind: 'linear', op: 'add', invert: false, x0: 0.5, y0: 0, x1: 0.5, y1: 1, ...o });
const radial = (o = {}) => ({ kind: 'radial', op: 'add', invert: false, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, feather: 0, ...o });
const mask = (parts: unknown[], o = {}) => M.moMasksNormalize([{ name: 'm', parts, adjust: { exposure: 1 }, ...o }])[0];
const at = (f: Float32Array, w: number, x: number, y: number) => f[y * w + x];

describe('what a stored mask becomes', () => {
  it('keeps what it can, drops what it cannot, and keeps settings in range', () => {
    const list = M.moMasksNormalize([
      { name: 'Far hills', parts: [linear(), { kind: 'lasso' }], adjust: { exposure: 9, dehaze: -0.4, nonsense: 3 } },
      { name: 'no parts', parts: [] }, null,
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].parts).toHaveLength(1);
    expect(list[0].adjust.exposure).toBe(2);
    expect(list[0].adjust.dehaze).toBeCloseTo(-0.4);
    expect(list[0].adjust.nonsense).toBeUndefined();
    expect(list[0].show).toBe(true);
    expect(typeof list[0].id).toBe('string');
  });
});

describe('where a mask covers the photo', () => {
  it('a linear gradient is full at its first line and gone past its last', () => {
    const f = M.moMaskField(mask([linear({ y0: 0.25, y1: 0.75 })]), 10, 20);
    expect(at(f, 10, 5, 0)).toBe(1);
    expect(at(f, 10, 5, 19)).toBe(0);
    expect(at(f, 10, 5, 10)).toBeGreaterThan(0.3);
    expect(at(f, 10, 5, 10)).toBeLessThan(0.7);
  });
  it('a radial gradient is full inside its oval and gone outside it', () => {
    const f = M.moMaskField(mask([radial()]), 20, 20);
    expect(at(f, 20, 10, 10)).toBe(1);
    expect(at(f, 20, 0, 0)).toBe(0);
  });
  it('adds, takes away, intersects and inverts', () => {
    const top = linear({ y0: 0.45, y1: 0.55 });               // the top half
    const middle = radial({ rx: 0.3, ry: 0.3 });              // a disc in the middle
    const w = 20, h = 20;
    const sub = M.moMaskField(mask([top, { ...middle, op: 'sub' }]), w, h);
    expect(at(sub, w, 10, 2)).toBe(1);                        // top edge, outside the disc
    expect(at(sub, w, 10, 7)).toBe(0);                        // in the top half, inside the disc
    const and = M.moMaskField(mask([top, { ...middle, op: 'and' }]), w, h);
    expect(at(and, w, 10, 7)).toBe(1);
    expect(at(and, w, 10, 2)).toBe(0);
    const inv = M.moMaskField(mask([top], { invert: true }), w, h);
    expect(at(inv, w, 10, 2)).toBe(0);
    expect(at(inv, w, 10, 18)).toBe(1);
  });
});

describe('the passes the engine is handed', () => {
  const engine = () => { const held = new Map<string, number>(); return { held, setMask(id: string, d: Uint8Array) { held.set(id, d.length); }, dropMasks(keep: Set<string>) { for (const k of [...held.keys()]) if (!keep.has(k)) held.delete(k); } }; };
  it('sends each visible mask with settings once, and adds its settings to the look', () => {
    const e = engine();
    const list = [mask([linear()], { id: 'a', adjust: { exposure: 0.5, blurAmount: 0.3 } }), mask([radial()], { id: 'b', adjust: {} }), mask([radial()], { id: 'c', show: false, adjust: { exposure: 1 } })];
    const passes = M.moMaskPasses(e, list, { exposure: 0.25 }, 400, 300);
    expect(passes.map((p: { id: string }) => p.id)).toEqual(['a']);
    expect(passes[0].look.exposure).toBeCloseTo(0.75);
    expect(passes[0].look.blurAmount).toBeCloseTo(0.3);
    expect([...e.held.keys()]).toEqual(['a']);
    expect(e.held.get('a')).toBe(400 * 300);
  });
  it('works a large photo’s masks at 2048 on the long side', () => {
    expect(M.moMaskSize(6000, 4000)).toEqual({ w: 2048, h: 1365 });
    expect(M.moMaskSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
});
