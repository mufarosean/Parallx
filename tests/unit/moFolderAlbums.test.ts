// moFolderAlbums.test.ts — one album per folder on disk: spellings of one
// folder are one key, and duplicates merge into the oldest album.

import { describe, it, expect } from 'vitest';
// @ts-expect-error plain ES module without types
import { moFolderKey, moFindFolderAlbum, moMergeDuplicateFolderAlbums } from '../../ext/media-organizer/folder-albums.js';

const fakeDb = (rows: { id: number; path: string }[]) => {
  const ops: { sql: string; params: unknown[] }[] = [];
  return { ops, async all() { return rows; }, async transaction(list: typeof ops) { ops.push(...list); } };
};

describe('folder albums', () => {
  it('reads one folder in any spelling on Windows, and keeps case elsewhere', () => {
    expect(moFolderKey('D:\\Work\\Gallery\\', true)).toBe(moFolderKey('d:/work/gallery', true));
    expect(moFolderKey('/home/a/Gallery', false)).not.toBe(moFolderKey('/home/a/gallery', false));
  });
  it('finds the album made by another spelling of the folder', async () => {
    expect(await moFindFolderAlbum(fakeDb([{ id: 4, path: 'D:\\Work\\Gallery' }]), 'd:/work/gallery/', true)).toBe(4);
    expect(await moFindFolderAlbum(fakeDb([{ id: 4, path: 'D:\\Work\\Gallery' }]), 'D:\\Work\\Other', true)).toBe(null);
  });
  it('merges duplicates into the oldest, moving photos, videos, tags and children first', async () => {
    const db = fakeDb([{ id: 1, path: 'D:\\Work\\Gallery' }, { id: 2, path: 'D:\\Work\\Gallery' }, { id: 3, path: 'd:/work/GALLERY' }, { id: 5, path: 'D:\\Work\\Other' }]);
    expect(await moMergeDuplicateFolderAlbums(db, true)).toBe(2);
    const deletes = db.ops.filter((o) => o.sql.startsWith('DELETE'));
    expect(deletes.map((o) => o.params)).toEqual([[2], [3]]);
    expect(db.ops.filter((o) => o.sql.includes('mo_albums_photos')).every((o) => o.params[0] === 1)).toBe(true);
    const lastMove = db.ops.findIndex((o) => o.sql.startsWith('UPDATE mo_albums SET parent_album_id') && o.params[1] === 3);
    expect(lastMove).toBeLessThan(db.ops.findIndex((o) => o.sql.startsWith('DELETE') && o.params[0] === 3));
  });
});
