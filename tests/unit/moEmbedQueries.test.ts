// moEmbedQueries.test.ts — the queries behind Atelier's Media Gallery page
// block, run on Atelier's own migrations.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('Media Organizer embed queries (real SQLite)', () => {
  const src = readFileSync(join(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  const start = src.indexOf('export const MO_EMBED_SQL = {');
  const end = src.indexOf('\n};', start);
  // eslint-disable-next-line no-new-func
  const SQL = new Function(`return ${src.slice(start + 'export const MO_EMBED_SQL = '.length, end + 2)}`)() as Record<string, string>;

  async function moDb() {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const dir = join(__dirname, '../../ext/media-organizer/db/migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      try { db.exec(readFileSync(join(dir, f), 'utf8')); } catch { /* FTS / extension-only tables */ }
    }
    return db;
  }

  it('an album lists its photos and videos in album order, never the Trash', async () => {
    const db = await moDb();
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown }>);
    // Insert with only the columns that must be set.
    const insert = (t: string, values: Record<string, unknown>) => {
      const need = cols(t).filter((c) => c.notnull && c.dflt_value === null && c.name !== 'id' && !(c.name in values));
      const all = { ...values, ...Object.fromEntries(need.map((c) => [c.name, c.name.endsWith('_at') ? '2026-01-01' : 'x'])) };
      const keys = Object.keys(all);
      db.prepare(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...(Object.values(all) as any[]));
    };
    insert('mo_photos', { id: 1, title: 'one', created_at: '2026-01-01' });
    insert('mo_photos', { id: 2, title: 'two', created_at: '2026-03-01' });
    insert('mo_photos', { id: 3, title: 'binned', created_at: '2026-04-01', deleted_at: '2026-05-01' });
    insert('mo_videos', { id: 1, title: 'clip', created_at: '2026-02-01' });
    insert('mo_albums', { id: 9, title: 'Studies' });
    insert('mo_albums', { id: 8, title: 'allegro' });
    db.prepare('INSERT INTO mo_albums_photos (album_id, photo_id, position) VALUES (9, 2, 0), (9, 1, 2), (9, 3, 1)').run();
    db.prepare('INSERT INTO mo_albums_videos (album_id, video_id, position) VALUES (9, 1, 1)').run();

    const album = db.prepare(SQL.albumItems).all(9, 9, 10) as Array<{ type: string; id: number }>;
    expect(album.map((r) => `${r.type}:${r.id}`)).toEqual(['photo:2', 'video:1', 'photo:1']);
    expect(db.prepare(SQL.albumItems).all(9, 9, 2)).toHaveLength(2);

    const recent = db.prepare(SQL.recentItems).all(10) as Array<{ type: string; id: number }>;
    expect(recent.map((r) => `${r.type}:${r.id}`)).toEqual(['photo:2', 'video:1', 'photo:1']);

    expect((db.prepare(SQL.albums).all() as Array<{ title: string }>).map((a) => a.title)).toEqual(['allegro', 'Studies']);
  });
});

