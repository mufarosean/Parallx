/**
 * moTagDrag.test.ts — dropping a branch of the tag tree on items stores
 * exactly that branch: every tag on its path, each in the sense of the one
 * above it, never a tag's other parents. As before the multi-parent change
 * (3019f3b2), which had cut it down to the leaf alone. The extension's own
 * two functions, extracted verbatim, on a real SQLite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../ext/media-organizer/main.js'), 'utf8');
/** One top-level function's source, by name. */
function fn(name: string): string {
  const start = src.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  expect(start).toBeGreaterThan(0);
  const end = src.indexOf('\n}\n', start) >= 0 ? src.indexOf('\n}\n', start) : src.indexOf('\r\n}\r\n', start);
  return src.slice(start, end + 3);
}

describe('dropping a tag branch on items', () => {
  it('stores the whole dragged path, each tag in the sense of the one above it', async () => {
    const sql = new DatabaseSync(':memory:');
    sql.exec(`CREATE TABLE mo_photos_tags (photo_id INTEGER, tag_id INTEGER, via_parent_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (photo_id, tag_id, via_parent_id));
              CREATE TABLE mo_videos_tags (video_id INTEGER, tag_id INTEGER, via_parent_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (video_id, tag_id, via_parent_id));`);
    const db = { transaction: async (ops: { sql: string; params: unknown[] }[]) => { for (const o of ops) sql.prepare(o.sql).run(...(o.params as never[])); } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const m = new Function('db', `${fn('moTagPicksFromChain')}\n${fn('moApplyTagsToKeys')}\nreturn { moTagPicksFromChain, moApplyTagsToKeys };`)(db);
    // PETS(5) › DOG(2) › CORGI(3), dragged from the PETS branch, onto a photo and a video.
    const picks = m.moTagPicksFromChain(['5', '2', '3']);
    expect(picks).toEqual([{ tagId: 5, via: 0 }, { tagId: 2, via: 5 }, { tagId: 3, via: 2 }]);
    expect(await m.moApplyTagsToKeys(picks, ['photo:1', 'video:7'])).toBe(2);
    expect(sql.prepare('SELECT tag_id, via_parent_id AS via FROM mo_photos_tags ORDER BY tag_id').all()).toEqual([{ tag_id: 2, via: 5 }, { tag_id: 3, via: 2 }, { tag_id: 5, via: 0 }]);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM mo_videos_tags').get()).toEqual({ n: 3 });
    // A top-level tag on its own is just itself.
    expect(m.moTagPicksFromChain(['9'])).toEqual([{ tagId: 9, via: 0 }]);
  });
});
