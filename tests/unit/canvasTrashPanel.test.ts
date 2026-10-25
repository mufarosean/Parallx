// The Trash lists what the user can act on: one row per trashed branch, with
// its sub-pages counted, its origin named, newest first, filed by local day.
import { describe, it, expect } from 'vitest';
import { trashEntries, trashDayGroup, firstWords } from '../../src/built-in/canvas/canvasTrashPanel';
import type { IPageSummary } from '../../src/built-in/canvas/canvasTypes';
import { appTime } from '../../src/platform/localTime';

const page = (id: string, parentId: string | null, updatedAt: string, title = id): IPageSummary =>
  ({ id, parentId, title, icon: null, sortOrder: 0, isArchived: true, createdAt: updatedAt, updatedAt } as unknown as IPageSummary);

describe('trashEntries', () => {
  it('lists only branch roots, counts their trashed sub-pages at any depth, newest first', () => {
    const entries = trashEntries([
      page('a', null, '2026-10-20T10:00:00Z'),
      page('a1', 'a', '2026-10-20T10:00:00Z'),
      page('a2', 'a1', '2026-10-20T10:00:00Z'),
      page('b', 'live', '2026-10-24T10:00:00Z'),
    ], (id) => (id === 'live' ? 'Exam 7 notes' : null));
    expect(entries.map((e) => [e.page.id, e.subPages, e.fromTitle])).toEqual([
      ['b', 0, 'Exam 7 notes'],
      ['a', 2, null],
    ]);
  });

  it('names no origin when the parent is gone', () => {
    expect(trashEntries([page('c', 'deleted', '2026-10-24T10:00:00Z')], () => null)[0].fromTitle).toBeNull();
  });
});

describe('trashDayGroup', () => {
  // Built on the app's clock, so the answer does not depend on the machine's zone.
  const now = appTime(2026, 9, 25, 15, 0);
  const at = (d: number, h: number) => new Date(appTime(2026, 9, d, h, 0)).toISOString();
  it('files by the day on the app clock', () => {
    expect(trashDayGroup(at(25, 0), now)).toBe('Today');
    expect(trashDayGroup(at(24, 23), now)).toBe('Yesterday');
    expect(trashDayGroup(at(19, 1), now)).toBe('Earlier this week');
    expect(trashDayGroup(at(18, 23), now)).toBe('Older');
  });
});

describe('firstWords', () => {
  it('reads the opening text of a page, cut at about sixty characters', () => {
    const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mack 1994 assumptions: independence of accident years and a variance proportional to losses' }] }] });
    expect(firstWords(doc)).toBe('Mack 1994 assumptions: independence of accident years and a…');
    expect(firstWords('')).toBe('');
  });
});
