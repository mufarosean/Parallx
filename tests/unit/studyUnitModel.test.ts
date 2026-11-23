// studyUnitModel.test.ts — a unit's material, the pure part
// (ext/study/src/15-unit-model.js): an entry of the Units' Material cell read
// as a page or a file however it was written, added once, taken off, a file
// that moved followed, a page renamed named again, where an item lives, and
// what Find Matches proposes (the Progress matcher: name and Also Called,
// case, spaces, punctuation and accents aside).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables as T } from '../../ext/study/main.js';

const {
  ST_UNIT_MATERIAL, stUnitParse, stUnitKey, stUnitItems, stUnitAdd, stUnitRemove, stUnitMoved, stUnitRetitled,
  stUnitStem, stUnitProposals, stUnitPageWhere, stUnitFileWhere, stUnitKindOf, stUnitCountsLine, stUnitRelative, stSubjectColumns,
} = T;

const ROOT = '/home/me/Exam 7';
const page = (id: string, name: string) => ({ kind: 'page', id, name });
const file = (rel: string) => ({ kind: 'file', rel, abs: '', name: rel.split('/').pop() });

describe('a Material entry', () => {
  it('is a page by its link, in either form the app writes', () => {
    expect(stUnitParse({ name: 'Mack', src: 'parallx-page:p-1' })).toEqual({ kind: 'page', id: 'p-1', name: 'Mack' });
    expect(stUnitParse('parallx://canvas/page/p-1')).toMatchObject({ kind: 'page', id: 'p-1' });
  });

  it('is a file in the workspace by the canvas\'s file link, a path from the workspace, a whole path or a file:// URI', () => {
    expect(stUnitParse({ name: 'Mack 1993.pdf', src: 'parallx-media://workspace/Readings/Week%201/Mack%201993.pdf' }, ROOT)).toEqual({ kind: 'file', rel: 'Readings/Week 1/Mack 1993.pdf', abs: '', name: 'Mack 1993.pdf' });
    expect(stUnitParse('Readings/Week 1/Mack 1993.pdf', ROOT)).toMatchObject({ rel: 'Readings/Week 1/Mack 1993.pdf' });
    expect(stUnitParse(`${ROOT}/Clark.md`, ROOT)).toMatchObject({ rel: 'Clark.md', name: 'Clark.md' });
    expect(stUnitParse('file:///home/me/Exam%207/Clark.md', ROOT)).toMatchObject({ rel: 'Clark.md' });
    expect(stUnitParse('C:\\Users\\me\\x.pdf', 'C:/Users/ME')).toMatchObject({ rel: 'x.pdf' });
    expect(stUnitParse('/elsewhere/y.pdf', ROOT)).toEqual({ kind: 'file', rel: '', abs: '/elsewhere/y.pdf', name: 'y.pdf' });
  });

  it('is nothing for a web link or an empty entry', () => {
    expect(stUnitParse('https://example.com/a.pdf')).toBeNull();
    expect(stUnitParse({ name: 'x', src: '' })).toBeNull();
    expect(stUnitParse(null)).toBeNull();
  });

  it('reads a cell once per item, whichever way each was written', () => {
    const cell = [{ name: 'Clark.md', src: 'parallx-media://workspace/Clark.md' }, 'Clark.md', { name: 'Mack', src: 'parallx-page:p-1' }];
    expect(stUnitItems(cell, ROOT).map(stUnitKey)).toEqual(['file:Clark.md', 'page:p-1']);
    expect(stUnitItems('Clark.md, parallx-page:p-1', ROOT).map(stUnitKey)).toEqual(['file:Clark.md', 'page:p-1']);
    expect(stUnitItems(null)).toEqual([]);
  });
});

describe('attaching and removing', () => {
  it('adds what is not there yet, as { name, src } the files column shows by name', () => {
    const next = stUnitAdd([], [page('p-1', 'Mack and Clark Compared'), file('Readings/Week 1/Mack 1993.pdf')], ROOT);
    expect(next).toEqual([
      { name: 'Mack and Clark Compared', src: 'parallx-page:p-1' },
      { name: 'Mack 1993.pdf', src: 'parallx-media://workspace/Readings/Week%201/Mack%201993.pdf' },
    ]);
    expect(stUnitAdd(next, [page('p-1', 'Again')], ROOT)).toBeNull();
    expect(stUnitAdd(next, [file('Clark.md')], ROOT)).toHaveLength(3);
  });

  it('removes only the entries for that item, and says when there were none', () => {
    const cell = [{ name: 'A', src: 'parallx-page:a' }, 'Clark.md', { name: 'B', src: 'parallx-page:b' }];
    expect(stUnitRemove(cell, 'file:Clark.md', ROOT)).toEqual([{ name: 'A', src: 'parallx-page:a' }, { name: 'B', src: 'parallx-page:b' }]);
    expect(stUnitRemove(cell, 'page:zzz', ROOT)).toBeNull();
  });
});

describe('a file that moved, a page renamed', () => {
  it('follows a file renamed, and every file under a folder renamed', () => {
    const cell = [{ name: 'Clark.md', src: 'parallx-media://workspace/Clark.md' }, { name: 'My name', src: 'parallx-media://workspace/Readings/a.pdf' }, { name: 'P', src: 'parallx-page:p' }];
    expect(stUnitMoved(cell, 'Clark.md', 'Clark Notes.md', ROOT)![0]).toEqual({ name: 'Clark Notes.md', src: 'parallx-media://workspace/Clark%20Notes.md' });
    const moved = stUnitMoved(cell, 'Readings', 'Old Readings', ROOT)!;
    expect(moved[1]).toEqual({ name: 'My name', src: 'parallx-media://workspace/Old%20Readings/a.pdf' });
    expect(moved[0]).toBe(cell[0]);
    expect(stUnitMoved(cell, 'Read', 'X', ROOT)).toBeNull();
  });

  it('names a page entry as the page is titled now', () => {
    const cell = [{ name: 'Old', src: 'parallx-page:p' }, { name: 'Same', src: 'parallx-page:q' }];
    expect(stUnitRetitled(cell, (id: string) => (id === 'p' ? 'New' : id === 'q' ? 'Same' : undefined))).toEqual([{ name: 'New', src: 'parallx-page:p' }, cell[1]]);
    expect(stUnitRetitled(cell, () => undefined)).toBeNull();
  });
});

describe('where an item lives, and its kind', () => {
  it('a page lives under the pages above it; a file in its folders', () => {
    const byId = new Map([['log', { id: 'log', parentId: null, title: 'Reading Log' }], ['f', { id: 'f', parentId: 'log', title: 'Fried-Land' }], ['top', { id: 'top', parentId: null, title: 'Mack' }]]);
    expect(stUnitPageWhere('f', byId)).toBe('Reading Log');
    expect(stUnitPageWhere('top', byId)).toBe('');
    expect(stUnitFileWhere(file('Readings/Week 1/Mack 1993.pdf'))).toBe('Readings › Week 1');
    expect(stUnitFileWhere(file('Clark.md'))).toBe('');
    expect(['page', 'pdf', 'image', 'text', 'file'].every((k, i) => stUnitKindOf([page('p', 'x'), file('a.PDF'), file('b.png'), file('c.md'), file('d.xlsx')][i]) === k)).toBe(true);
  });

  it('a path from the workspace only under its folder, whatever the case on Windows', () => {
    expect(stUnitRelative('/home/me/Exam 7/a/b.md', ROOT)).toBe('a/b.md');
    expect(stUnitRelative('/home/me/Exam 70/b.md', ROOT)).toBe('');
    expect(stUnitRelative('c:\\Users\\Me\\a.md', 'C:/Users/me')).toBe('a.md');
  });
});

describe('Find Matches', () => {
  const units = [{ name: 'Mack', also: 'Mack 1993, Chain Ladder', attached: new Set<string>() }, { name: 'Hürlimann', also: '', attached: new Set<string>() }, { name: 'Friedland', also: '', attached: new Set(['page:fl']) }];
  const cand = (key: string, label: string) => ({ key, label });
  it('proposes what is named like a unit or an Also Called of it, then what holds such a name as whole words, and nothing else', () => {
    const out = stUnitProposals(units, [cand('page:m', 'Mack'), cand('file:Readings/Mack 1993.pdf', stUnitStem('Mack 1993.pdf')), cand('page:c', 'chain-ladder'), cand('page:h', 'hurlimann'), cand('page:x', 'Mack and Clark Compared'), cand('page:g', 'Grocery List')]);
    // Since the student walk-through (2026-11-23) a name that holds a unit's name is proposed too, after the exact ones: "Mack and Clark Compared" for Mack.
    expect(out.map((p: { unit: string; candidate: { key: string } }) => `${p.candidate.key} → ${p.unit}`)).toEqual(['page:m → Mack', 'file:Readings/Mack 1993.pdf → Mack', 'page:c → Mack', 'page:h → Hürlimann', 'page:x → Mack']);
    expect(out.map((p: { exact: boolean }) => p.exact)).toEqual([true, true, true, true, false]);
  });
  it('leaves out what the unit already has', () => {
    expect(stUnitProposals(units, [cand('page:fl', 'Fried-Land')])).toEqual([]);
    expect(stUnitProposals(units, [cand('page:fl', 'Friedland - my notes')])).toEqual([]);
  });
});

describe('the column and the words', () => {
  it('Units has a Material files column, his (not kept by Study)', () => {
    const c = stSubjectColumns('u').units.find((x: { name: string }) => x.name === ST_UNIT_MATERIAL);
    expect(c).toEqual({ name: 'Material', type: 'files' });
  });
  it('counts in his words', () => {
    expect(stUnitCountsLine([3, 1, 2, 2], { good: 'Right', middling: 'Partly', poor: 'Wrong', rest: 'Not yet' })).toBe('3 right · 1 partly · 2 wrong · 2 not yet');
  });
});
