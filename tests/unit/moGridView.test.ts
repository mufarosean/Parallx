/**
 * The grid view's pure logic (ext/media-organizer/main.js, between
 * `@mo-grid-pure-begin` and `@mo-grid-pure-end`, extracted verbatim): how a
 * tab's instance id becomes scope, media filter and layout; what a
 * media-type filter asks of the photos query; the Shuffled sort's ORDER BY.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadRegion(): string {
  const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  const a = src.indexOf('// @mo-grid-pure-begin');
  const b = src.indexOf('// @mo-grid-pure-end');
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

const NAMES = ['moGridInstance', 'moKindForMediaType', 'moShuffleOrderExpr'];
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const P: Record<string, any> = new Function(loadRegion() + `\nreturn { ${NAMES.join(', ')} };`)();

describe('the pure region', () => {
  it('touches no DOM, app API or database', () => {
    expect(loadRegion()).not.toMatch(/\b(document|window|_api|db)\s*\./);
  });
});

describe('moGridInstance', () => {
  it('reads a scope, a tag branch path, and an album', () => {
    expect(P.moGridInstance('grid:all')).toEqual({ filterType: 'all', filterId: null, filterTagPath: null, mediaType: null, displayMode: null });
    expect(P.moGridInstance(undefined).filterType).toBe('all');
    expect(P.moGridInstance('grid:untagged').filterType).toBe('untagged');
    const tag = P.moGridInstance('grid:tag:5-12');
    expect(tag.filterType).toBe('tag');
    expect(tag.filterTagPath).toEqual([5, 12]);
    expect(tag.filterId).toBe(12);
    expect(P.moGridInstance('grid:album:7')).toMatchObject({ filterType: 'album', filterId: 7, filterTagPath: null });
    expect(P.moGridInstance('grid:album:x').filterId).toBeNull();
  });
  it('opens the retired ids as Library with the matching filter or layout, so saved tabs restore', () => {
    // Home was the feed; Photos, GIFs and Videos were sidebar entries and are filters now.
    expect(P.moGridInstance('grid:home')).toMatchObject({ filterType: 'all', displayMode: 'feed', mediaType: null });
    expect(P.moGridInstance('grid:photos')).toMatchObject({ filterType: 'all', mediaType: 'photos', displayMode: null });
    expect(P.moGridInstance('grid:gifs')).toMatchObject({ filterType: 'all', mediaType: 'gifs' });
    expect(P.moGridInstance('grid:videos')).toMatchObject({ filterType: 'all', mediaType: 'videos' });
  });
});

describe('moKindForMediaType', () => {
  it('narrows the photos query to stills or GIFs, and not at all for videos or everything', () => {
    expect(P.moKindForMediaType('photos')).toBe('still');
    expect(P.moKindForMediaType('gifs')).toBe('gif');
    expect(P.moKindForMediaType('videos')).toBeNull();
    expect(P.moKindForMediaType('all')).toBeNull();
    expect(P.moKindForMediaType(undefined)).toBeNull();
  });
});

describe('moShuffleOrderExpr', () => {
  it('orders by a seeded scramble of the id, on the alias it is given', () => {
    expect(P.moShuffleOrderExpr(42)).toBe('((((id + 42) * 1103515245) % 1000003) * 22695477) % 2147483647');
    expect(P.moShuffleOrderExpr(42, 'p.id')).toContain('(p.id + 42)');
  });
  it('accepts only a number it drew: anything else is seed 0, and the seed is bounded', () => {
    expect(P.moShuffleOrderExpr('1 OR 1=1')).toContain('(id + 0)');
    expect(P.moShuffleOrderExpr(-7)).toContain('(id + 7)');
    expect(P.moShuffleOrderExpr(2147483647 + 5)).toContain('(id + 5)');
  });
  it('gives a different order for a different seed, not a rotation of the same one', () => {
    // Evaluate the expression the way SQLite does (64-bit integers) for a run of ids and compare rank order.
    const rank = (seed: number) => {
      const key = (id: number) => Number(((((BigInt(id) + BigInt(seed)) * 1103515245n) % 1000003n) * 22695477n) % 2147483647n);
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].sort((a, b) => key(a) - key(b)).join(',');
    };
    const a = rank(1);
    const b = rank(2);
    const c = rank(99991);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    // Not merely rotated: the same neighbours would follow each other after rotation.
    const rot = (x: string) => { const p = x.split(','); return p.map((_, i) => p.slice(i).concat(p.slice(0, i)).join(',')); };
    expect(rot(a)).not.toContain(b);
  });
});
