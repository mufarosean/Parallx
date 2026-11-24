// flashcardsWork.test.ts — Flashcards' time and cards as work any tool can read.
//
// ext/flashcards/work.js: a card's groups are its tags and its deck (the keys
// progress.js gives); an entry is one day and one set of groups, with minutes
// from the clock's seconds, the cards graded that day and how many were right
// (their last grade of the day Good or Easy). The session's clock is the
// app's: a card left up for an hour is not an hour.
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — JS module with no types
import { fcWorkGroups, fcWorkEntries, fcWorkGraded, fcWorkProvider, fcStudyWork, FC_WORK_SQL } from '../../ext/flashcards/work.js';
import { createWorkApi } from '../../src/api/bridges/workBridge.js';

describe('fcWorkGroups', () => {
  it('names each tag once (keyed in lower case, labelled as written), then the deck', () => {
    expect(fcWorkGroups({ tags: 'Chain-Ladder, clark,CLARK, ', deckId: 3 }, 'Exam 7 Cards')).toEqual([
      { group: 'tag:chain-ladder', label: 'Chain-Ladder' }, { group: 'tag:clark', label: 'clark' }, { group: 'deck:3', label: 'Exam 7 Cards' },
    ]);
    expect(fcWorkGroups({ tags: ['zeta'], deckId: 1 }, 'D')).toEqual([{ group: 'tag:zeta', label: 'zeta' }, { group: 'deck:1', label: 'D' }]);
  });
});

describe('fcWorkEntries', () => {
  it('turns seconds into minutes, keeps the groups, and never says more right than graded', () => {
    const groups = JSON.stringify([{ group: 'tag:clark', label: 'clark' }, { group: 'deck:1', label: 'Exam 7 Cards' }]);
    expect(fcWorkEntries([
      { day: '2026-03-10', groups, seconds: 300, items: 3, was_right: 2 },
      { day: '2026-03-10', groups: '[]', seconds: 0, items: 0, was_right: 0 },
      { day: '2026-03-11', groups: 'not json', seconds: 90, items: 1, was_right: 4 },
    ])).toEqual([
      { day: '2026-03-10', groups: [{ group: 'tag:clark', label: 'clark' }, { group: 'deck:1', label: 'Exam 7 Cards' }], minutes: 5, items: 3, right: 2 },
      { day: '2026-03-11', groups: [], minutes: 1.5, items: 1, right: 1 },
    ]);
    expect(FC_WORK_SQL).toMatch(/GROUP BY day, groups/);
  });
});

describe('fcWorkGraded', () => {
  it('says for each day and card whether it was graded and whether its last grade of the day was Good or Easy', () => {
    const dayOf = (ms: number) => (ms < 1000 ? 'd1' : 'd2');
    const got = fcWorkGraded([
      { card_id: 1, reviewed_at: 100, rating: 1 }, { card_id: 1, reviewed_at: 200, rating: 3 },
      { card_id: 2, reviewed_at: 300, rating: 4 }, { card_id: 2, reviewed_at: 400, rating: 1 },
      { card_id: 3, reviewed_at: 500, rating: 2 },
      { card_id: 1, reviewed_at: 1500, rating: 1 },
    ], dayOf);
    expect(Object.fromEntries(got)).toEqual({
      'd1\u00001': { reviewed: 1, right: 1 }, 'd1\u00002': { reviewed: 1, right: 0 }, 'd1\u00003': { reviewed: 1, right: 0 }, 'd2\u00001': { reviewed: 1, right: 0 },
    });
  });
});

describe('fcWorkProvider', () => {
  it('reports what the table holds and says when it changed', async () => {
    const p = fcWorkProvider({ all: async () => [{ day: '2026-03-10', groups: '[]', seconds: 60, items: 1, was_right: 1 }] });
    expect([p.id, p.displayName, p.kind]).toEqual(['flashcards.cards', 'Flashcards', 'Cards']);
    expect(await p.work()).toEqual([{ day: '2026-03-10', groups: [], minutes: 1, items: 1, right: 1 }]);
  });
});

describe('fcStudyWork', () => {
  afterEach(() => { vi.useRealTimers(); });
  /** A table of fc_work_time and fc_reviews kept in memory, behind the SQL the module sends. */
  function fakeDb() {
    const time = new Map<string, { day: string; card_id: number; groups: string; seconds: number; reviewed: number; was_right: number }>();
    const reviews: { card_id: number; reviewed_at: number; rating: number }[] = [];
    return {
      time, reviews,
      async all(sql: string, params: unknown[] = []) {
        if (/FROM fc_reviews/.test(sql)) { const ids = params.slice(1).map(Number); return reviews.filter((r) => r.reviewed_at >= Number(params[0]) && ids.includes(r.card_id)); }
        if (/FROM fc_work_time WHERE day IN/.test(sql)) { const days = params.slice(0, 2); const ids = params.slice(2).map(Number); return [...time.values()].filter((r) => days.includes(r.day) && ids.includes(r.card_id)); }
        throw new Error(`unexpected read: ${sql}`);
      },
      async run(sql: string, params: unknown[] = []) {
        if (/^INSERT INTO fc_work_time \(day, card_id, groups, seconds\)/.test(sql)) {
          const [day, id, groups, seconds] = params as [string, number, string, number];
          const key = `${day}|${id}`; const had = time.get(key);
          if (had) { had.seconds = Math.max(0, had.seconds + seconds); had.groups = groups; } else time.set(key, { day, card_id: id, groups, seconds: Math.max(0, seconds), reviewed: 0, was_right: 0 });
        } else if (/^UPDATE fc_work_time SET reviewed/.test(sql)) {
          const [reviewed, right, day, id] = params as [number, number, string, number];
          const row = time.get(`${day}|${id}`)!; row.reviewed = reviewed; row.was_right = right;
        } else if (/^INSERT INTO fc_work_time \(day, card_id, groups, seconds, reviewed, was_right\)/.test(sql)) {
          const [day, id, groups, reviewed, right] = params as [string, number, string, number, number];
          const key = `${day}|${id}`; const had = time.get(key);
          if (had) { had.reviewed = reviewed; had.was_right = right; } else time.set(key, { day, card_id: id, groups, seconds: 0, reviewed, was_right: right });
        } else throw new Error(`unexpected write: ${sql}`);
      },
    };
  }
  function setup() {
    vi.useFakeTimers({ now: new Date(2026, 2, 10, 12, 0, 0).getTime() });
    const subscriptions: { dispose(): void }[] = [];
    const api = { work: createWorkApi('parallx-community.flashcards', subscriptions) };
    const pane: { work: null | { dispose(): void; takeCardMs(): number } } = { work: null };
    const paneEl = document.createElement('div'); const host = document.createElement('div'); const view = document.createElement('div');
    document.body.appendChild(paneEl); paneEl.appendChild(host); host.appendChild(view);
    // jsdom lays nothing out: a view that is in the document is one that shows.
    view.getClientRects = () => [{}] as never;
    const session = { queue: [{ id: 7, tags: 'clark', deckId: 1 }, { id: 8, tags: 'zeta', deckId: 1 }], index: 0, waitTimer: null as unknown };
    const db = fakeDb();
    const listeners = new Set<() => void>();
    const onData = (l: () => void) => { listeners.add(l); return { dispose: () => { listeners.delete(l); } }; };
    const work = fcStudyWork({ api, db, pane, host, view, session, deckNames: new Map([[1, 'Exam 7 Cards']]), onData });
    const settle = async () => { for (let i = 0; i < 2000; i++) await Promise.resolve(); };
    return { api, pane, paneEl, host, view, session, db, work, listeners, settle, subscriptions };
  }

  it('a card left up for an hour is the minutes at the desk, not the hour: seven minutes with a key each minute, then 61 away', async () => {
    const t = setup();
    for (let m = 0; m < 7; m++) { vi.advanceTimersByTime(60_000); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); }
    vi.advanceTimersByTime(61 * 60_000);
    const ms = t.work.takeCardMs();
    await t.settle();
    const day = t.api.work.dayOf();
    expect(t.db.time.get(`${day}|7`)?.seconds).toBe(420);
    expect(ms).toBe(420_000);
    expect(JSON.parse(t.db.time.get(`${day}|7`)!.groups)).toEqual([{ group: 'tag:clark', label: 'clark' }, { group: 'deck:1', label: 'Exam 7 Cards' }]);
    t.work.dispose();
  });
  it('counts each card in its own row, and marks a card graded and right from its reviews; an undone grade takes the mark back', async () => {
    const t = setup();
    vi.advanceTimersByTime(60_000);
    t.db.reviews.push({ card_id: 7, reviewed_at: Date.now(), rating: 3 });
    t.session.index = 1;
    for (const l of t.listeners) l();
    vi.advanceTimersByTime(30_000);
    await t.settle();
    const day = t.api.work.dayOf();
    expect(t.db.time.get(`${day}|7`)).toMatchObject({ seconds: 60, reviewed: 1, was_right: 1 });
    expect(t.db.time.get(`${day}|8`)).toMatchObject({ seconds: 30, reviewed: 0 });
    t.db.reviews.length = 0;
    for (const l of t.listeners) l();
    await t.settle();
    expect(t.db.time.get(`${day}|7`)).toMatchObject({ seconds: 60, reviewed: 0, was_right: 0 });
    t.work.dispose();
  });
  it('says the stop across the top of the pane, and stops by itself when the view is gone, keeping what it counted', async () => {
    const t = setup();
    vi.advanceTimersByTime(11 * 60_000);
    const status = t.paneEl.querySelector('.px-clock-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toMatch(/Paused/);
    expect(status.nextElementSibling).toBe(t.host);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    vi.advanceTimersByTime(20_000);
    t.view.remove();
    vi.advanceTimersByTime(2000);
    await t.settle();
    expect(t.pane.work).toBeNull();
    expect(t.paneEl.querySelector('.px-clock-status')).toBeNull();
    expect(t.db.time.get(`${t.api.work.dayOf()}|7`)?.seconds).toBe(20);
  });
  it('does nothing on a host that has no clock', () => {
    expect(fcStudyWork({ api: {}, db: {}, pane: { work: null }, host: document.createElement('div'), view: document.createElement('div'), session: { queue: [], index: 0 }, deckNames: new Map(), onData: () => ({ dispose() {} }) })).toBeNull();
  });
});
