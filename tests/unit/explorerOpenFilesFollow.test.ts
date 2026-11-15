// explorerOpenFilesFollow.test.ts — an open file follows what the Explorer does to it.
//
// Found by an independent review (2026-11-15), reproduced in the app: a
// sheet renamed in the Explorer kept its tab under the old name and its
// next save brought the old file back; a deleted sheet's tab stayed open.
// The recheck of the first fix found two more: a tab closed AFTER the
// rename still wrote its last entry to the old path, and a text file in the
// workspace was never matched, because its tab is described by its path
// relative to the workspace folder.

import { describe, expect, it } from 'vitest';
import { withOpenFilesFollowing } from '../../src/built-in/explorer/openFilesFollow';

function scene(open: { id: string; description: string; isDirty?: boolean }[], roots = ['/w']) {
  const log: string[] = [];
  let tabs = open.map((e) => ({ isDirty: false, ...e }));
  return {
    log,
    follow: {
      roots,
      editors: {
        get openEditors() { return tabs; },
        closeEditor: async (id: string) => { log.push(`close ${id}`); tabs = tabs.filter((t) => t.id !== id); return true; },
        openFileEditor: async (path: string) => { log.push(`open ${path}`); },
      },
    },
    work: (name = 'work') => async () => { log.push(name); },
  };
}

describe('an open file follows the Explorer', () => {
  it('a renamed file is closed before the rename and opened again under its new name after it', async () => {
    const s = scene([{ id: 'a', description: 'D:\\Work\\Budget.sheet' }, { id: 'b', description: 'D:/Work/Notes.md' }], ['D:/Work']);
    await withOpenFilesFollowing(s.follow, 'D:/Work/Budget.sheet', 'D:/Work/Costs.sheet', s.work('rename'));
    expect(s.log).toEqual(['close a', 'rename', 'open D:/Work/Costs.sheet']);
  });

  it('a text file in the workspace, whose tab is described by its path from the workspace folder, follows too', async () => {
    const s = scene([{ id: 'a', description: 'notes.md' }, { id: 'b', description: 'sub/deep.md' }, { id: 'c', description: 'other.md' }]);
    await withOpenFilesFollowing(s.follow, '/w/notes.md', '/w/renamed.md', s.work('rename'));
    await withOpenFilesFollowing(s.follow, '/w/sub', '/w/moved', s.work('move'));
    expect(s.log).toEqual(['close a', 'rename', 'open /w/renamed.md', 'close b', 'move', 'open /w/moved/deep.md']);
  });

  it('a renamed folder carries every open file under it, and no file that only starts with its name', async () => {
    const s = scene([
      { id: 'a', description: '/w/Plans/2026/Budget.sheet' },
      { id: 'b', description: '/w/Plans Old/x.md' },
      { id: 'c', description: '/w/plans/Notes.md' },
    ]);
    await withOpenFilesFollowing(s.follow, '/w/Plans', '/w/Archive', s.work('rename'));
    expect(s.log).toEqual(['close a', 'close c', 'rename', 'open /w/Archive/2026/Budget.sheet', 'open /w/Archive/Notes.md']);
  });

  it('a tab with unsaved changes is left as it is by a rename', async () => {
    const s = scene([{ id: 'a', description: '/w/Draft.md', isDirty: true }]);
    await withOpenFilesFollowing(s.follow, '/w/Draft.md', '/w/Final.md', s.work('rename'));
    expect(s.log).toEqual(['rename']);
  });

  it('a tab that is not a file is never touched', async () => {
    const s = scene([{ id: 'a', description: 'Tool editor: worksheet' }, { id: 'b', description: '' }]);
    await withOpenFilesFollowing(s.follow, '/w/Tool editor: worksheet/x', '/w/y', s.work('rename'));
    await withOpenFilesFollowing(s.follow, '/elsewhere', null, s.work('delete'));
    expect(s.log).toEqual(['rename', 'delete']);
  });

  it('a deleted file\'s tab is closed before the delete, unsaved or not, and every tab under a deleted folder', async () => {
    const s = scene([{ id: 'a', description: '/w/Gone.sheet' }, { id: 'b', description: 'Dir/In.md', isDirty: true }, { id: 'c', description: '/w/Kept.md' }]);
    await withOpenFilesFollowing(s.follow, '/w/gone.sheet', null, s.work('delete 1'));
    await withOpenFilesFollowing(s.follow, '/w/Dir', null, s.work('delete 2'));
    expect(s.log).toEqual(['close a', 'delete 1', 'close b', 'delete 2']);
  });

  it('when the rename or the delete fails, the tabs come back where they were and the failure is passed on', async () => {
    const s = scene([{ id: 'a', description: '/w/Budget.sheet' }]);
    const fail = async () => { s.log.push('rename'); throw new Error('in use'); };
    await expect(withOpenFilesFollowing(s.follow, '/w/Budget.sheet', '/w/Costs.sheet', fail)).rejects.toThrow('in use');
    await expect(withOpenFilesFollowing(scene([{ id: 'z', description: '/w/Budget.sheet' }]).follow, '/w/Budget.sheet', null, async () => { throw new Error('denied'); })).rejects.toThrow('denied');
    expect(s.log).toEqual(['close a', 'rename', 'open /w/Budget.sheet']);
  });

  it('gives back what the work returned', async () => {
    const s = scene([]);
    expect(await withOpenFilesFollowing(s.follow, '/w/a', '/w/b', async () => 7)).toBe(7);
  });
});
