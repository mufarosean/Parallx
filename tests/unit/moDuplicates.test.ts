// moDuplicates.test.ts — the Duplicate Finder's grouping (duplicates.js):
// Exact groups byte-identical files by item, Look-alike groups photos whose
// hashes differ by a few bits and leaves one file's copies to Exact.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { MO_LOOKALIKE_MAX, moGroupExact, moGroupLookAlikes, moHashDistance, moHashParts, moSizeText } from '../../ext/media-organizer/duplicates.js';

describe('moGroupExact', () => {
  it('groups by hash, one entry per item, the most space to free first', () => {
    const groups = moGroupExact([
      { hash: 'a', type: 'photo', id: 1, size: 100 },
      { hash: 'a', type: 'photo', id: 2, size: 100 },
      { hash: 'b', type: 'video', id: 3, size: 5000 },
      { hash: 'b', type: 'video', id: 4, size: 5000 },
      { hash: 'c', type: 'photo', id: 5, size: 10 },
      { hash: 'c', type: 'photo', id: 5, size: 10 }, // one item's two files: not a duplicate
      { hash: 'd', type: 'photo', id: 6, size: 1 },
    ]);
    expect(groups.map((g: { id: number }[]) => g.map((r) => r.id))).toEqual([[3, 4], [1, 2]]);
  });
});

describe('look-alike hashes', () => {
  const h = (n: bigint) => moHashParts(n);

  it('splits a 64-bit hash, negative (as SQLite stores it) or not, and counts differing bits', () => {
    expect(h(0n)).toEqual({ hi: 0, lo: 0 });
    expect(h(-1n)).toEqual({ hi: 0xffffffff, lo: 0xffffffff });
    expect(moHashDistance(h(0n), h(-1n))).toBe(64);
    expect(moHashDistance(h(0b1011n), h(0n))).toBe(3);
    expect(moHashDistance(h(1n << 40n), h(0n))).toBe(1);
  });

  it('groups photos within the limit, and leaves one file\'s copies to Exact', () => {
    const near = (1n << 7n) - 1n; // 7 bits from 0
    const far = (1n << 9n) - 1n; // 9 bits from 0
    const row = (id: number, hash: bigint, md5?: string) => ({ id, md5, ...h(hash) });
    const groups = moGroupLookAlikes([
      row(1, 0n, 'x'), row(2, near, 'y'), row(3, far << 20n, 'z'),
      row(4, -1n, 'm'), row(5, -1n, 'm'), // the same file twice
    ]);
    expect(MO_LOOKALIKE_MAX).toBe(8);
    expect(groups.map((g: { id: number }[]) => g.map((r) => r.id))).toEqual([[1, 2]]);
  });
});

describe('moSizeText', () => {
  it('reads as a person would say it', () => {
    expect(moSizeText(512)).toBe('512 B');
    expect(moSizeText(812 * 1024)).toBe('812 KB');
    expect(moSizeText(2.4 * 1024 * 1024)).toBe('2.4 MB');
  });
});
