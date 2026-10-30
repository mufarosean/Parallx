// moFolderRows.test.ts — Atelier's folder row menu. Remove From Library takes
// the folder's items out (files untouched), stops a watched root, keeps a
// folder inside a root out of later scans, and Add Folder… brings it back.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { moFolderMenu, moIsExcluded, moLoadExcluded, moPathWithin, moRemoveFolder, moUnexclude } from '../../ext/media-organizer/folder-rows.js';

function fakeDb(files: { folder: string; basename: string }[], folders: string[]) {
  const runs: { sql: string; params: unknown[] }[] = [];
  return {
    runs,
    async all(sql: string) {
      if (sql.includes('FROM mo_files')) return files;
      if (sql.includes('FROM mo_folders')) return folders.map((path, i) => ({ id: i + 1, path }));
      return [];
    },
    async run(sql: string, params: unknown[]) { runs.push({ sql, params }); return {}; },
  };
}

function deps(db: ReturnType<typeof fakeDb>, roots: string[], answer = 'Remove From Library') {
  const out = { stopped: [] as string[], purged: [] as string[], settings: new Map<string, string>(), asked: '' as string, changed: 0 };
  const d = {
    api: { window: { showWarningMessage: async (m: string) => { out.asked = m; return { title: answer }; }, showInformationMessage: async () => undefined } },
    db, sep: '/',
    roots: async () => roots.map((path) => ({ path })),
    stopWatching: (p: string) => out.stopped.push(p),
    syncGate: async () => {},
    purge: async (paths: string[]) => { out.purged.push(...paths); },
    setSetting: async (k: string, v: string) => { out.settings.set(k, v); },
    changed: async () => { out.changed++; },
  };
  return { d, out };
}

describe('Atelier folder rows', () => {
  it('knows a path inside a folder, by either separator, case only on Windows', () => {
    expect(moPathWithin('/p/Trips/2024', '/p/Trips')).toBe(true);
    expect(moPathWithin('/p/Trips', '/p/Trips/')).toBe(true);
    expect(moPathWithin('/p/Trips2', '/p/Trips')).toBe(false);
    expect(moPathWithin('/p/trips/a', '/p/Trips')).toBe(false);
    expect(moPathWithin('C:\\Photos\\Trips', 'c:\\photos')).toBe(true);
  });

  it('offers Open, Rescan, Show in Folder and Remove From Library', () => {
    const menu = moFolderMenu({ open: () => {}, rescan: async () => {}, reveal: async () => {}, removeDeps: {} }, { path: '/p' }, 'p');
    expect(menu.filter((m: { label?: string }) => m.label).map((m: { label: string }) => m.label)).toEqual(['Open', 'Rescan', 'Show in Folder', 'Remove From Library…']);
  });

  it('removes a watched root: asks with the count, stops watching, purges its items and folder records', async () => {
    const db = fakeDb([{ folder: '/p/Trips', basename: 'a.jpg' }, { folder: '/p/Trips/2024', basename: 'b.mp4' }, { folder: '/p/Trips2', basename: 'x.jpg' }], ['/p/Trips', '/p/Trips/2024', '/p/Trips2']);
    const { d, out } = deps(db, ['/p/Trips']);
    expect(await moRemoveFolder(d, '/p/Trips', 'Trips')).toBe(2);
    expect(out.asked).toContain('Its 2 files leave the library');
    expect(out.stopped).toEqual(['/p/Trips']);
    expect(out.purged).toEqual(['/p/Trips/a.jpg', '/p/Trips/2024/b.mp4']);
    expect(db.runs.find((r) => r.sql.includes('DELETE FROM mo_scan_roots'))?.params).toEqual(['/p/Trips']);
    expect(db.runs.find((r) => r.sql.includes('DELETE FROM mo_folders'))?.params).toEqual([1, 2]);
    expect(out.settings.size).toBe(0); // a root is simply no longer watched
    expect(out.changed).toBe(1);
  });

  it('keeps a folder inside a root out of later scans, until it is added again', async () => {
    const db = fakeDb([{ folder: '/p/Trips/junk', basename: 'c.png' }], ['/p/Trips/junk']);
    const { d, out } = deps(db, ['/p']);
    await moRemoveFolder(d, '/p/Trips/junk', 'junk');
    expect(out.stopped).toEqual([]);
    expect(JSON.parse(out.settings.get('excluded_folders')!)).toEqual(['/p/Trips/junk']);
    await moLoadExcluded(async () => out.settings.get('excluded_folders'));
    expect(moIsExcluded('/p/Trips/junk/d.png')).toBe(true);
    expect(moIsExcluded('/p/Trips/keep.png')).toBe(false);
    moUnexclude('/p/Trips', (k: string, v: string) => out.settings.set(k, v));
    expect(moIsExcluded('/p/Trips/junk/d.png')).toBe(false);
    expect(JSON.parse(out.settings.get('excluded_folders')!)).toEqual([]);
  });

  it('does nothing when cancelled', async () => {
    const db = fakeDb([{ folder: '/p/Trips', basename: 'a.jpg' }], ['/p/Trips']);
    const { d, out } = deps(db, ['/p/Trips'], 'Cancel');
    expect(await moRemoveFolder(d, '/p/Trips', 'Trips')).toBeNull();
    expect(out.purged).toEqual([]);
    expect(db.runs).toEqual([]);
  });
});
