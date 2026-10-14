// moTagClipboard.test.ts — Copy Tags takes one item's tags with the sense each
// was given; Paste Tags adds them to every target and removes nothing.

import { describe, it, expect } from 'vitest';
// @ts-expect-error plain ES module without types
import { moCopyTags, moPasteTags, moTagClip } from '../../ext/media-organizer/tag-clipboard.js';

type Op = { sql: string; params: unknown[] };
function fakeDb(rows: Record<string, { tagId: number; via: number; name: string }[]>) {
  const ops: Op[] = [];
  return {
    ops,
    async all(sql: string, params: unknown[]) { return rows[`${sql.includes('mo_videos_tags') ? 'video' : 'photo'}:${params[0]}`] ?? []; },
    async transaction(list: Op[]) { ops.push(...list); },
  };
}

describe('copy and paste tags', () => {
  it('copies one item and adds its tags, with their sense, to each target', async () => {
    const db = fakeDb({ 'photo:1': [{ tagId: 5, via: 0, name: 'CAT' }, { tagId: 9, via: 3, name: 'JAGUAR' }] });
    expect(await moCopyTags(db, 'photo:1')).toBe(2);
    expect(moTagClip().names).toEqual(['CAT', 'JAGUAR']);
    const done = await moPasteTags(db, ['photo:2', 'video:4', 'photo:2']);
    expect(done).toEqual({ items: 2, tagIds: [5, 9] });
    expect(db.ops).toHaveLength(4);
    expect(db.ops.every((o) => o.sql.startsWith('INSERT OR IGNORE'))).toBe(true);
    expect(db.ops[1].params).toEqual([2, 9, 3]);
    expect(db.ops[2].sql).toContain('mo_videos_tags (video_id, tag_id, via_parent_id)');
  });
  it('an item without tags copies nothing and keeps the last copy', async () => {
    const db = fakeDb({});
    expect(await moCopyTags(db, 'photo:7')).toBe(0);
    expect(moTagClip().names).toEqual(['CAT', 'JAGUAR']);
  });
});
