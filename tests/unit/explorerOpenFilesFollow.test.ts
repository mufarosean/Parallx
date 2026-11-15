// explorerOpenFilesFollow.test.ts — an open file follows what the Explorer does to it.
//
// Found by an independent review (2026-11-15), reproduced in the app: a
// sheet renamed in the Explorer kept its tab under the old name and its
// next save brought the old file back; a deleted sheet's tab stayed open.

import { describe, expect, it } from 'vitest';
import { closeEditorsOf, reopenEditorsOf } from '../../src/built-in/explorer/openFilesFollow';

function editors(open: { id: string; description: string; isDirty?: boolean }[]) {
  const log: string[] = [];
  return {
    log,
    api: {
      get openEditors() { return open.map((e) => ({ isDirty: false, ...e })); },
      closeEditor: async (id: string) => { log.push(`close ${id}`); return true; },
      openFileEditor: async (path: string) => { log.push(`open ${path}`); },
    },
  };
}

describe('an open file follows the Explorer', () => {
  it('a renamed file is closed and opened again under its new name', async () => {
    const e = editors([{ id: 'a', description: 'D:\\Work\\Budget.sheet' }, { id: 'b', description: 'D:/Work/Notes.md' }]);
    await reopenEditorsOf(e.api, 'D:/Work/Budget.sheet', 'D:/Work/Costs.sheet', false);
    expect(e.log).toEqual(['close a', 'open D:/Work/Costs.sheet']);
  });

  it('a renamed folder carries every open file under it, and no file that only starts with its name', async () => {
    const e = editors([
      { id: 'a', description: '/w/Plans/2026/Budget.sheet' },
      { id: 'b', description: '/w/Plans Old/x.md' },
      { id: 'c', description: '/w/plans/Notes.md' },
    ]);
    await reopenEditorsOf(e.api, '/w/Plans', '/w/Archive', true);
    expect(e.log).toEqual(['close a', 'open /w/Archive/2026/Budget.sheet', 'close c', 'open /w/Archive/Notes.md']);
  });

  it('a tab with unsaved changes is left as it is', async () => {
    const e = editors([{ id: 'a', description: '/w/Draft.md', isDirty: true }]);
    await reopenEditorsOf(e.api, '/w/Draft.md', '/w/Final.md', false);
    expect(e.log).toEqual([]);
  });

  it('a tab that is not a file (its description is not a path) is never touched', async () => {
    const e = editors([{ id: 'a', description: 'Tool editor: worksheet' }, { id: 'b', description: '' }]);
    await reopenEditorsOf(e.api, '/w/Tool editor: worksheet', '/w/x', false);
    closeEditorsOf(e.api, '/w', true);
    expect(e.log).toEqual([]);
  });

  it('a deleted file\'s tab is closed, and every tab under a deleted folder', () => {
    const e = editors([{ id: 'a', description: '/w/Gone.sheet' }, { id: 'b', description: '/w/Dir/In.md' }, { id: 'c', description: '/w/Kept.md' }]);
    closeEditorsOf(e.api, '/w/gone.sheet', false);
    closeEditorsOf(e.api, '/w/Dir', true);
    expect(e.log).toEqual(['close a', 'close b']);
  });
});
