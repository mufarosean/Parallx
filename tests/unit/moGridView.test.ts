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

const NAMES = ['moGridInstance', 'moKindForMediaType', 'moMediaTypeSet', 'moMediaTypeValue', 'moMediaTypeQuery', 'moShuffleOrderExpr', 'moScopeTitle', 'moFolderName', 'moFolderParent', 'moActiveFilterCount', 'moFeedGroupKey', 'moFeedGroupLabel'];
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
  it('opens a smart album as the whole library in a grid, carrying its id', () => {
    expect(P.moGridInstance('grid:smart:4')).toEqual({ filterType: 'all', filterId: null, filterTagPath: null, mediaType: null, displayMode: 'grid', smartId: 4 });
    expect(P.moGridInstance('grid:smart:x').smartId).toBeUndefined();
  });
});

describe('media type pills', () => {
  it('all three is the default and reads back as all', () => {
    expect([...P.moMediaTypeSet('all')]).toEqual(['photos', 'gifs', 'videos']);
    expect([...P.moMediaTypeSet(null)]).toEqual(['photos', 'gifs', 'videos']);
    expect(P.moMediaTypeValue(new Set(['videos', 'photos', 'gifs']))).toBe('all');
    expect(P.moMediaTypeValue(new Set(['videos', 'photos']))).toBe('photos,videos');
    expect([...P.moMediaTypeSet('gifs')]).toEqual(['gifs']);
  });
  it('maps any subset onto the photos query, the videos query or both, with the photo kind', () => {
    expect(P.moMediaTypeQuery('all')).toEqual({ effective: 'all', kind: null });
    expect(P.moMediaTypeQuery('photos')).toEqual({ effective: 'photos', kind: 'still' });
    expect(P.moMediaTypeQuery('gifs')).toEqual({ effective: 'photos', kind: 'gif' });
    expect(P.moMediaTypeQuery('photos,gifs')).toEqual({ effective: 'photos', kind: null });
    expect(P.moMediaTypeQuery('videos')).toEqual({ effective: 'videos', kind: null });
    expect(P.moMediaTypeQuery('photos,videos')).toEqual({ effective: 'all', kind: 'still' });
    expect(P.moMediaTypeQuery('gifs,videos')).toEqual({ effective: 'all', kind: 'gif' });
  });
  it('a narrowed type counts as an active filter', () => {
    const base = { tagIds: [], excludeTagIds: [], ratingMin: null, dateFrom: null, dateTo: null };
    expect(P.moActiveFilterCount({ filters: base, mediaType: 'all' })).toBe(0);
    expect(P.moActiveFilterCount({ filters: base, mediaType: 'photos,videos' })).toBe(1);
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

describe('library page header', () => {
  it('titles each scope, and names a folder by its last segment', () => {
    expect(P.moScopeTitle('all')).toBe('All Media');
    expect(P.moScopeTitle('favorites')).toBe('Favorites');
    expect(P.moScopeTitle('nonsense')).toBe('All Media');
    expect(P.moFolderName('C:\\Users\\me\\Pictures\\Lisbon')).toBe('Lisbon');
    expect(P.moFolderName('/home/me/Travel/Kyoto/')).toBe('Kyoto');
    expect(P.moFolderParent('/home/me/Travel/Kyoto')).toBe('Travel');
    expect(P.moFolderParent('Kyoto')).toBe('');
  });

  it('counts every pill that narrows the view, the media type included', () => {
    const f = { tagIds: [1, 2], excludeTagIds: [], ratingMin: 3, dateFrom: '2026-01-01', dateTo: '2026-02-01' };
    expect(P.moActiveFilterCount({ filters: f, mediaType: 'videos' })).toBe(4);
    expect(P.moActiveFilterCount({ filters: f, mediaType: 'all' })).toBe(3);
    expect(P.moActiveFilterCount({ filters: { tagIds: [], excludeTagIds: [], ratingMin: null, dateFrom: null, dateTo: null } })).toBe(0);
  });
});

describe('feed date groups', () => {
  // Thursday, October 1 2026 (local): the week began on Sunday, September 27.
  const NOW = new Date(2026, 9, 1, 15, 0).getTime();
  const at = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 09:00:00`;

  it('buckets today, yesterday, earlier this week, then by month', () => {
    const key = (d: string) => P.moFeedGroupKey({ createdAt: d }, 'created_at', NOW);
    expect(key(at(2026, 10, 1))).toBe('today');
    expect(key(at(2026, 9, 30))).toBe('yesterday');
    expect(key(at(2026, 9, 27))).toBe('week');
    expect(key(at(2026, 9, 26))).toBe('m:2026-09');
    expect(key(at(2025, 12, 31))).toBe('m:2025-12');
    expect(P.moFeedGroupKey({ createdAt: null }, 'created_at', NOW)).toBe('none');
  });

  it('follows Date Taken when that is the sort, falling back to Date Added', () => {
    const item = { createdAt: at(2026, 10, 1), takenAt: at(2026, 8, 3) };
    expect(P.moFeedGroupKey(item, 'taken_at', NOW)).toBe('m:2026-08');
    expect(P.moFeedGroupKey({ createdAt: at(2026, 10, 1), takenAt: null }, 'taken_at', NOW)).toBe('today');
  });

  it('labels in sentence case', () => {
    expect(P.moFeedGroupLabel('today')).toBe('Today');
    expect(P.moFeedGroupLabel('week')).toBe('Earlier this week');
    expect(P.moFeedGroupLabel('none')).toBe('No date');
    expect(P.moFeedGroupLabel('m:2026-09')).toMatch(/2026/);
  });
});
