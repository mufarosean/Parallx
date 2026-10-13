/**
 * moParentTags.test.ts — applying a tag in Media Organizer applies its parents.
 * The extension's helper (ext/media-organizer/parentTags.js) on a real SQLite
 * with the tables it touches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

// @ts-expect-error: the extension is plain JavaScript
import { moApplyParentTags } from '../../ext/media-organizer/parentTags.js';

let sql: InstanceType<typeof DatabaseSync>;
let apply: (kind: string, ids: number[]) => Promise<number[]>;

const tags = ['ANIMALS', 'DOG', 'CORGI', 'PETS', 'CARS', 'JAGUAR', 'SKY'];
const id = (name: string) => tags.indexOf(name) + 1;
const tagsOf = (table: string, col: string, item: number) =>
  (sql.prepare(`SELECT t.name, ${table === 'mo_albums_tags' ? '0' : 'x.via_parent_id'} AS via FROM ${table} x JOIN mo_tags t ON t.id = x.tag_id WHERE x.${col} = ? ORDER BY t.name`).all(item) as { name: string; via: number }[])
    .map((r) => (r.via ? `${r.name} via ${tags[r.via - 1]}` : r.name));

beforeEach(() => {
  sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE mo_tags (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE mo_tags_relations (parent_id INTEGER, child_id INTEGER, PRIMARY KEY (parent_id, child_id));
    CREATE TABLE mo_photos_tags (photo_id INTEGER, tag_id INTEGER, via_parent_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (photo_id, tag_id, via_parent_id));
    CREATE TABLE mo_videos_tags (video_id INTEGER, tag_id INTEGER, via_parent_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (video_id, tag_id, via_parent_id));
    CREATE TABLE mo_albums_tags (album_id INTEGER, tag_id INTEGER, PRIMARY KEY (album_id, tag_id));
  `);
  tags.forEach((n, i) => sql.prepare('INSERT INTO mo_tags VALUES (?, ?)').run(i + 1, n));
  // ANIMALS › DOG › CORGI; DOG also under PETS; JAGUAR under ANIMALS and CARS.
  for (const [p, c] of [['ANIMALS', 'DOG'], ['DOG', 'CORGI'], ['PETS', 'DOG'], ['ANIMALS', 'JAGUAR'], ['CARS', 'JAGUAR']]) {
    sql.prepare('INSERT INTO mo_tags_relations VALUES (?, ?)').run(id(p), id(c));
  }
  const db = {
    all: async (q: string, p: unknown[] = []) => sql.prepare(q).all(...(p as never[])),
    transaction: async (ops: { sql: string; params: unknown[] }[]) => { for (const o of ops) sql.prepare(o.sql).run(...(o.params as never[])); },
  };
  apply = (kind, ids) => moApplyParentTags(db, kind, ids);
});

const put = (photo: number, tag: string, via = '') => sql.prepare('INSERT INTO mo_photos_tags VALUES (?, ?, ?)').run(photo, id(tag), via ? id(via) : 0);

describe('applying a tag applies its parents', () => {
  it('a tag with one parent brings the chain to the top, each in its own sense', async () => {
    sql.exec(`DELETE FROM mo_tags_relations WHERE parent_id = ${id('PETS')}`);
    put(1, 'CORGI');
    expect(await apply('photo', [1])).toEqual(expect.arrayContaining([id('DOG'), id('ANIMALS')]));
    expect(tagsOf('mo_photos_tags', 'photo_id', 1)).toEqual(['ANIMALS', 'CORGI', 'DOG via ANIMALS']);
  });

  it('applied under a parent, that parent comes; a parent filed under several comes bare and stops', async () => {
    put(1, 'CORGI', 'DOG');
    await apply('photo', [1]);
    expect(tagsOf('mo_photos_tags', 'photo_id', 1)).toEqual(['CORGI via DOG', 'DOG']);
  });

  it('a tag filed under several parents, applied bare, brings none (which one is unknown)', async () => {
    put(1, 'JAGUAR');
    expect(await apply('photo', [1])).toEqual([]);
    put(2, 'JAGUAR', 'CARS');
    await apply('photo', [2]);
    expect(tagsOf('mo_photos_tags', 'photo_id', 2)).toEqual(['CARS', 'JAGUAR via CARS']);
  });

  it('leaves a parent the item already carries, in any sense, as it is', async () => {
    sql.exec(`DELETE FROM mo_tags_relations WHERE parent_id = ${id('PETS')}`);
    put(1, 'CORGI');
    put(1, 'DOG');
    await apply('photo', [1]);
    expect(tagsOf('mo_photos_tags', 'photo_id', 1)).toEqual(['ANIMALS', 'CORGI', 'DOG']);
  });

  it('works for videos and albums too, and for many items at once', async () => {
    sql.exec(`DELETE FROM mo_tags_relations WHERE parent_id = ${id('PETS')}`);
    sql.prepare('INSERT INTO mo_videos_tags VALUES (?, ?, 0)').run(7, id('CORGI'));
    sql.prepare('INSERT INTO mo_albums_tags VALUES (?, ?)').run(3, id('CORGI'));
    for (let p = 1; p <= 450; p++) put(p, 'DOG');
    await apply('video', [7]);
    await apply('album', [3]);
    await apply('photo', Array.from({ length: 450 }, (_, i) => i + 1));
    expect(tagsOf('mo_videos_tags', 'video_id', 7)).toEqual(['ANIMALS', 'CORGI', 'DOG via ANIMALS']);
    expect(tagsOf('mo_albums_tags', 'album_id', 3)).toEqual(['ANIMALS', 'CORGI', 'DOG']);
    expect(tagsOf('mo_photos_tags', 'photo_id', 450)).toEqual(['ANIMALS', 'DOG']);
  });
});
