// pageRecents.test.ts — Start's recent list follows the pages: a rename
// renames the entry in place, a page moved to Trash or deleted (each
// sub-page fires its own event) leaves it, and other pages' entries stay.
import { describe, it, expect } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { RecentsService } from '../../src/services/recentsService';
import { registerPageRecents } from '../../src/built-in/canvas/pageRecents';
import { PageChangeKind, type PageChangeEvent, type IPage } from '../../src/built-in/canvas/canvasTypes';

const page = (id: string, title: string, isArchived = false) => ({ id, title, isArchived }) as unknown as IPage;

function setup() {
  const recents = new RecentsService(undefined);
  const changes = new Emitter<PageChangeEvent>();
  const sub = registerPageRecents(changes.event, recents);
  recents.recordOpen({ key: 'page:a', kind: 'page', title: 'Untitled', target: 'a' });
  recents.recordOpen({ key: 'file:x', kind: 'file', title: 'x.md', target: 'file:///x.md' });
  recents.recordOpen({ key: 'page:b', kind: 'page', title: 'Notes', target: 'b' });
  return { recents, changes, sub };
}
const titles = (r: RecentsService) => r.getRecentOpens().map((o) => o.title);

describe('the recent list follows the pages', () => {
  it('a rename renames the entry and keeps its place', () => {
    const { recents, changes } = setup();
    let fired = 0;
    recents.onDidChangeOpens(() => fired++);
    changes.fire({ kind: PageChangeKind.Updated, pageId: 'a', page: page('a', 'Clark notes'), changedFields: ['title'] });
    expect(titles(recents)).toEqual(['Notes', 'x.md', 'Clark notes']);
    expect(fired).toBe(1);
    // Another field changing leaves the title alone.
    changes.fire({ kind: PageChangeKind.Updated, pageId: 'a', page: page('a', 'Other'), changedFields: ['icon'] });
    expect(titles(recents)).toEqual(['Notes', 'x.md', 'Clark notes']);
  });

  it('a page moved to Trash or deleted leaves the list; files and other pages stay', () => {
    const { recents, changes } = setup();
    changes.fire({ kind: PageChangeKind.Deleted, pageId: 'a', archived: true });
    expect(titles(recents)).toEqual(['Notes', 'x.md']);
    changes.fire({ kind: PageChangeKind.Updated, pageId: 'b', page: page('b', 'Notes', true), changedFields: ['isArchived'] });
    expect(titles(recents)).toEqual(['x.md']);
  });

  it('an event for a page not in the list changes nothing, and dispose stops it', () => {
    const { recents, changes, sub } = setup();
    let fired = 0;
    recents.onDidChangeOpens(() => fired++);
    changes.fire({ kind: PageChangeKind.Deleted, pageId: 'zz' });
    changes.fire({ kind: PageChangeKind.Updated, pageId: 'zz', page: page('zz', 'New'), changedFields: ['title'] });
    expect(fired).toBe(0);
    sub.dispose();
    changes.fire({ kind: PageChangeKind.Deleted, pageId: 'a' });
    expect(titles(recents)).toContain('Untitled');
  });

  it('without a recent list it does nothing', () => {
    const changes = new Emitter<PageChangeEvent>();
    expect(() => registerPageRecents(changes.event, undefined).dispose()).not.toThrow();
  });
});
