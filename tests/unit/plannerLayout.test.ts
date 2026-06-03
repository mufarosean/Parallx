import { describe, it, expect } from 'vitest';
import { packLanes, type TimeSpan } from '../../src/built-in/planner/plannerLayout.js';

const span = (startMs: number, endMs: number, id?: string): TimeSpan & { id?: string } => ({ startMs, endMs, id });

describe('packLanes', () => {
  it('returns [] for no items', () => {
    expect(packLanes([])).toEqual([]);
  });

  it('a single item gets lane 0 of 1', () => {
    const [a] = packLanes([span(0, 10)]);
    expect(a).toMatchObject({ lane: 0, laneCount: 1 });
  });

  it('two overlapping items split into two lanes', () => {
    const res = packLanes([span(0, 20), span(10, 30)]);
    expect(res.map(r => r.lane)).toEqual([0, 1]);
    expect(res.every(r => r.laneCount === 2)).toBe(true);
  });

  it('sequential (non-overlapping) items each take the full width', () => {
    const res = packLanes([span(0, 10), span(10, 20), span(20, 30)]);
    expect(res.every(r => r.lane === 0 && r.laneCount === 1)).toBe(true);
  });

  it('back-to-back items (end == next start) do not overlap', () => {
    const res = packLanes([span(0, 10), span(10, 20)]);
    expect(res.every(r => r.laneCount === 1)).toBe(true);
  });

  it('A and C reuse a column when they do not overlap each other', () => {
    // A(0-2) and B(1-3) overlap; C(2-4) overlaps B but not A → C reuses A's column.
    const res = packLanes([span(0, 2, 'A'), span(1, 3, 'B'), span(2, 4, 'C')]);
    const byId = new Map(res.map(r => [(r.item as { id?: string }).id, r]));
    expect(byId.get('A')).toMatchObject({ lane: 0 });
    expect(byId.get('B')).toMatchObject({ lane: 1 });
    expect(byId.get('C')).toMatchObject({ lane: 0 });
    expect(res.every(r => r.laneCount === 2)).toBe(true);
  });

  it('a long item spanning shorter ones keeps them all in one cluster', () => {
    // A(0-10) spans B(2-4) and C(6-8); B and C do not overlap → 2 lanes total.
    const res = packLanes([span(0, 10, 'A'), span(2, 4, 'B'), span(6, 8, 'C')]);
    expect(res.every(r => r.laneCount === 2)).toBe(true);
    const byId = new Map(res.map(r => [(r.item as { id?: string }).id, r]));
    expect(byId.get('A')).toMatchObject({ lane: 0 });
    expect(byId.get('B')).toMatchObject({ lane: 1 });
    expect(byId.get('C')).toMatchObject({ lane: 1 });
  });

  it('three mutually-overlapping items need three lanes', () => {
    const res = packLanes([span(0, 30), span(5, 25), span(10, 20)]);
    expect(res.map(r => r.lane).sort()).toEqual([0, 1, 2]);
    expect(res.every(r => r.laneCount === 3)).toBe(true);
  });

  it('is order-independent (input order does not change the packing)', () => {
    const a = packLanes([span(0, 2, 'A'), span(1, 3, 'B'), span(2, 4, 'C')]);
    const b = packLanes([span(2, 4, 'C'), span(0, 2, 'A'), span(1, 3, 'B')]);
    const norm = (r: typeof a) => r.map(x => ({ id: (x.item as { id?: string }).id, lane: x.lane, laneCount: x.laneCount }));
    expect(norm(a)).toEqual(norm(b));
  });
});
