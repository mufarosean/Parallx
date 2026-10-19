import { describe, it, expect } from 'vitest';
import { rosterItems, rosterProgress, rosterTitle, shuffled, type RosterItem, type RosterAttempt, type StarChange } from '../../src/built-in/worksheet/roster';

const at = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime();
const spec = { tag: 'final-roster', startDay: '2026-10-21', endDay: '2026-10-25' };

function items(): RosterItem[] {
  return [
    { id: 1, paper: 'clark', tags: 'clark,rf,final-roster', starred: false },
    { id: 2, paper: 'clark', tags: 'clark,rf,final-roster', starred: true },
    { id: 3, paper: 'mack1994', tags: 'mack1994,final-roster', starred: false },
    { id: 4, paper: 'mack1994', tags: 'mack1994,final-roster', starred: true },
    { id: 9, paper: 'clark', tags: 'clark,rf', starred: true },
  ];
}

describe('roster', () => {
  it('names itself from its tag and holds only tagged problems', () => {
    expect(rosterTitle('final-roster')).toBe('Final Roster');
    expect(rosterItems(items(), 'Final-Roster').map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(rosterItems(items(), '')).toEqual([]);
  });

  it('counts each day: done once per problem, unstarred, and what was left', () => {
    const attempts: RosterAttempt[] = [
      { itemId: 1, selfGrade: 'easy', at: at('2026-10-21', 9), imported: false },
      { itemId: 1, selfGrade: 'easy', at: at('2026-10-21', 10), imported: false },
      { itemId: 2, selfGrade: 'hard', at: at('2026-10-21', 11), imported: false },
      { itemId: 9, selfGrade: 'hard', at: at('2026-10-21', 11), imported: false },
      { itemId: 3, selfGrade: 'easy', at: at('2026-10-21', 12), imported: true },
      { itemId: 3, selfGrade: 'easy', at: at('2026-10-22', 9), imported: false },
      { itemId: 4, selfGrade: '', at: at('2026-10-22', 9), imported: false },
    ];
    const changes: StarChange[] = [
      { itemId: 1, starred: false, at: at('2026-10-21', 9) },
      { itemId: 3, starred: false, at: at('2026-10-22', 9) },
      { itemId: 9, starred: false, at: at('2026-10-21', 11) },
    ];
    const p = rosterProgress(spec, items(), attempts, changes, at('2026-10-22', 15));
    expect(p.total).toBe(4);
    expect(p.left).toBe(2);
    expect(p.leftIds).toEqual([2, 4]);
    expect(p.dayIndex).toBe(2);
    expect(p.length).toBe(5);
    expect(p.days[0]).toMatchObject({ day: '2026-10-21', done: 2, unstarred: 1, left: 3, state: 'past' });
    expect(p.days[1]).toMatchObject({ day: '2026-10-22', done: 1, unstarred: 1, left: 2, state: 'today' });
    expect(p.days[2]).toMatchObject({ state: 'future' });
    expect(p.doneToday).toBe(1);
    expect(p.unstarredToday).toBe(1);
    expect(p.papers).toEqual([
      { paper: 'clark', total: 2, left: 1 },
      { paper: 'mack1994', total: 2, left: 1 },
    ]);
  });

  it('a star taken off and put back the same day is not unstarred', () => {
    const list: RosterItem[] = [{ id: 1, paper: 'clark', tags: 'final-roster', starred: true }];
    const changes: StarChange[] = [
      { itemId: 1, starred: false, at: at('2026-10-21', 9) },
      { itemId: 1, starred: true, at: at('2026-10-21', 10) },
    ];
    const p = rosterProgress(spec, list, [], changes, at('2026-10-21', 12));
    expect(p.days[0]).toMatchObject({ unstarred: 0, left: 1 });
  });

  it('before the first day and after the last', () => {
    expect(rosterProgress(spec, items(), [], [], at('2026-10-20', 12)).dayIndex).toBe(0);
    expect(rosterProgress(spec, items(), [], [], at('2026-10-26', 12)).dayIndex).toBe(6);
  });

  it('shuffles into a new order of the same problems', () => {
    let seed = 1;
    const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    const out = shuffled(ids, rng);
    expect(out).not.toEqual(ids);
    expect([...out].sort((a, b) => a - b)).toEqual(ids);
  });
});
