// studyWalkModel.test.ts — the pure parts of the fixes after the student
// walk-through (2026-11-23), through the generated ext/study/main.js.
//
// What is held here: a day gone by is never rewritten (a rule changed, the
// dates moved), unmarked, while Running and Done follow and a day he changes
// is still his; a phase that follows the exam gets its dates from the plan's,
// a hand edit of its dates is told from the exam moving; a dated phase left
// outside the plan and study days in no Study phase are named; a file joins
// the bank's unit whose name it holds as whole words; Find Matches proposes
// names that hold a unit's name; Done under 0.1 h is said in minutes; the
// session clock leaves out idle time.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables as T } from '../../ext/study/main.js';

const { stPlanRules, stPlanReconcile, stPlanWrittenOfAdds, stPlanAddDays } = T;

let n = 0;
const row = (title: string, values: Record<string, unknown>) => ({ pageId: `w-${++n}`, title, values });
const wk = (name: string, days: string[], account: string, floor: number, standard: number, stretch: number) => row(name, { Days: days, Account: account, Floor: floor, Standard: standard, Stretch: stretch });
const ph = (name: string, kind: string, start: string, end: string, extra: Record<string, unknown> = {}) => row(name, { Kind: kind, Start: start, End: end, ...extra });
const ALL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const START = '2027-01-04'; const EXAM = '2027-02-01'; const TODAY = '2027-01-14';
const rulesOf = (extra: { week?: any[]; phases?: any[]; plan?: Record<string, unknown> } = {}) => stPlanRules({
  plan: { 'Start Date': START, 'Exam Date': EXAM, Following: 'Standard', ...(extra.plan || {}) },
  week: extra.week || [wk('Every day', ALL, 'Personal', 1, 2, 3), wk('Work', ALL, 'Work', 1, 1, 1)],
  phases: extra.phases || [ph('Start to exam', 'Study', START, stPlanAddDays(EXAM, -1))],
});

/** The Days rows as the door would list them after a reconcile was written. */
function apply(rows: any[], r: any) {
  let out = rows.filter((x) => !r.removes.includes(x.pageId)).map((x) => ({ ...x, values: { ...x.values } }));
  for (const u of r.updates) { const x = out.find((y) => y.pageId === u.pageId); for (const [k, v] of Object.entries(u.values)) { if (v === null) delete x.values[k]; else x.values[k] = v; } }
  const made = r.adds.map((a: any) => ({ pageId: `day-${++n}`, title: a.title, values: Object.fromEntries(Object.entries(a.values).filter(([, v]) => v !== null)) }));
  out = [...out, ...made];
  return { rows: out, written: { ...r.written, ...stPlanWrittenOfAdds(r.adds, made) } };
}
type State = { rows: any[]; written: any };
const sync = (rules: any, state: State, today = TODAY, done: any = null) => { const r = stPlanReconcile({ rules, rows: state.rows, written: state.written, done, today }); return { r, ...apply(state.rows, r) }; };
const dayOf = (rows: any[], date: string) => rows.find((x) => x.values.Date === date);
const CELLS = ['Type', 'Phase', 'Work', 'Floor', 'Standard', 'Stretch'];
const cellsOf = (rows: any[], before: string) => rows.filter((x) => x.values.Date < before).sort((a, b) => (a.values.Date < b.values.Date ? -1 : 1)).map((x) => [x.values.Date, ...CELLS.map((c) => x.values[c] ?? ''), x.values.Edited === true]);

describe('days gone by', () => {
  it('are worked out once when the plan is made with a start in the past', () => {
    const first = sync(rulesOf(), { rows: [], written: {} });
    expect(first.r.adds.length).toBe(28);
    expect(cellsOf(first.rows, TODAY).length).toBe(10);
    expect(dayOf(first.rows, '2027-01-05').values).toMatchObject({ Type: 'Study', Phase: 'Start to exam', Work: 1, Standard: 2, Planned: 3, Running: 6 });
  });

  it('keep their Type, Phase and hours when a Week row changes, unmarked; today and the days after follow', () => {
    const s = sync(rulesOf(), { rows: [], written: {} });
    const past = cellsOf(s.rows, TODAY);
    const later = sync(rulesOf({ week: [wk('Every day', ALL, 'Personal', 4, 5, 6), wk('Work', ALL, 'Work', 2, 2, 2)] }), s);
    expect(cellsOf(later.rows, TODAY)).toEqual(past);
    expect(later.r.updates.every((u: any) => !('Edited' in u.values))).toBe(true);
    expect(dayOf(later.rows, TODAY).values).toMatchObject({ Work: 2, Standard: 5, Planned: 7 });
    // Running still follows: ten days at 3, then today at 7.
    expect(dayOf(later.rows, TODAY).values.Running).toBe(37);
    expect(dayOf(later.rows, '2027-01-13').values.Running).toBe(30);
    // And a run over them writes nothing.
    const again = sync(rulesOf({ week: [wk('Every day', ALL, 'Personal', 4, 5, 6), wk('Work', ALL, 'Work', 2, 2, 2)] }), later);
    expect([again.r.adds.length, again.r.updates.length, again.r.removes.length]).toEqual([0, 0, 0]);
  });

  it('keep their Type and Phase when Phases rows are added over them', () => {
    const s = sync(rulesOf(), { rows: [], written: {} });
    const past = cellsOf(s.rows, TODAY);
    const later = sync(rulesOf({ phases: [ph('Start to exam', 'Study', START, '2027-01-31'), ph('Long Weekend', 'Rest', '2027-01-10', '2027-01-16'), ph('Warm Up', 'Study', '2027-01-01', '2027-01-19')] }), s);
    expect(cellsOf(later.rows, TODAY)).toEqual(past);
    expect([dayOf(later.rows, TODAY).values.Type, dayOf(later.rows, TODAY).values.Phase, dayOf(later.rows, TODAY).values.Planned]).toEqual(['Rest', 'Warm Up', 0]);
    expect([dayOf(later.rows, '2027-01-18').values.Type, dayOf(later.rows, '2027-01-18').values.Phase]).toEqual(['Study', 'Warm Up']);
  });

  it('stay in Days as they were when the start date moves later, come back when it moves earlier, and new past days are worked out once', () => {
    const s = sync(rulesOf(), { rows: [], written: {} });
    const past = cellsOf(s.rows, TODAY);
    const later = sync(rulesOf({ plan: { 'Start Date': '2027-01-11' }, phases: [ph('Start to exam', 'Study', '2027-01-11', '2027-01-31')] }), s);
    expect(later.r.removes).toEqual([]);
    expect(cellsOf(later.rows, TODAY)).toEqual(past);
    expect(later.r.days[0].date).toBe('2027-01-11');
    expect(dayOf(later.rows, '2027-01-11').values.Running).toBe(3);
    // Earlier than it ever was: the three new days are made from the rules, the old ones are as they were.
    const earlier = sync(rulesOf({ plan: { 'Start Date': '2027-01-01' }, week: [wk('Every day', ALL, 'Personal', 4, 5, 6)], phases: [ph('Start to exam', 'Study', '2027-01-01', '2027-01-31')] }), later);
    expect(earlier.r.adds.map((a: any) => a.date)).toEqual(['2027-01-01', '2027-01-02', '2027-01-03']);
    expect(cellsOf(earlier.rows, TODAY).filter((c) => c[0] >= START)).toEqual(past);
    expect(dayOf(earlier.rows, '2027-01-02').values).toMatchObject({ Standard: 5, Planned: 5 });
    // Back to where it began: the three stay in Days, outside the plan, and nothing is removed.
    const back = sync(rulesOf(), earlier);
    expect(back.r.removes).toEqual([]);
    expect(back.rows.length).toBe(31);
    expect(back.r.outside).toEqual([]);
  });

  it('stay when the exam date moves earlier than today or later: only days after today are added or taken away', () => {
    const s = sync(rulesOf(), { rows: [], written: {} });
    const past = cellsOf(s.rows, TODAY);
    const shorter = sync(rulesOf({ plan: { 'Exam Date': '2027-01-20' } }), s);
    expect(shorter.r.removes.length).toBe(12);
    expect(cellsOf(shorter.rows, TODAY)).toEqual(past);
    const longer = sync(rulesOf({ plan: { 'Exam Date': '2027-02-08' } }), shorter);
    expect(longer.r.adds.length).toBe(19);
    expect(cellsOf(longer.rows, TODAY)).toEqual(past);
  });

  it('are still his when he changes one: Edited ticked, Running of every day after following', () => {
    const s = sync(rulesOf(), { rows: [], written: {} });
    dayOf(s.rows, '2027-01-06').values.Standard = 9;
    const later = sync(rulesOf(), s);
    expect(dayOf(later.rows, '2027-01-06').values).toMatchObject({ Standard: 9, Planned: 10, Edited: true });
    expect(dayOf(later.rows, '2027-01-07').values.Running).toBe(19);
    expect(dayOf(later.rows, '2027-01-07').values.Edited).toBeUndefined();
  });

  it('take Done from the Work Log like any day', () => {
    const s = sync(rulesOf(), { rows: [], written: {} });
    const later = sync(rulesOf(), s, TODAY, new Map([['2027-01-12', 2], [TODAY, 0.07]]));
    expect(dayOf(later.rows, '2027-01-12').values.Done).toBe(2);
    expect(dayOf(later.rows, TODAY).values.Done).toBe(0.07);
  });

  it('are the days before the day of the change: two days on, what was today is kept too', () => {
    const s = sync(rulesOf(), { rows: [], written: {} });
    const before = cellsOf(s.rows, '2027-01-16');
    const later = sync(rulesOf({ week: [wk('Every day', ALL, 'Personal', 4, 5, 6)] }), s, '2027-01-16');
    expect(cellsOf(later.rows, '2027-01-16')).toEqual(before);
    expect(dayOf(later.rows, '2027-01-16').values).toMatchObject({ Work: 0, Standard: 5 });
  });

  it('a day gone by he unticked Edited on stays as he left it, and Study does not tick it again', () => {
    let s = sync(rulesOf(), { rows: [], written: {} });
    dayOf(s.rows, '2027-01-10').values.Standard = 5;
    s = sync(rulesOf(), s);
    expect(dayOf(s.rows, '2027-01-10').values.Edited).toBe(true);
    dayOf(s.rows, '2027-01-10').values.Edited = false;
    for (let i = 0; i < 3; i++) {
      s = sync(rulesOf(), s);
      expect([i, dayOf(s.rows, '2027-01-10').values.Standard, dayOf(s.rows, '2027-01-10').values.Edited, s.r.updates]).toEqual([i, 5, false, []]);
    }
    // And a change he makes there afterwards is still seen as his.
    dayOf(s.rows, '2027-01-10').values.Standard = 6;
    s = sync(rulesOf(), s);
    expect(dayOf(s.rows, '2027-01-10').values.Edited).toBe(true);
  });

  it('a day whose last write never landed, then gone by, is not marked Edited at a later run', () => {
    const s = sync(rulesOf(), { rows: [], written: {} });
    const rules2 = rulesOf({ week: [wk('Every day', ALL, 'Personal', 1, 4, 5)] });
    const r = stPlanReconcile({ rules: rules2, rows: s.rows, written: s.written, today: TODAY });
    // The record as it is kept before the writes (29-plans.js): the new cells, with what was there before.
    const attempt: any = {};
    for (const [id, w] of Object.entries<any>(r.written)) {
      const { prev: _p, ...was } = s.written[id] || {};
      attempt[id] = s.written[id] && JSON.stringify(was) !== JSON.stringify(w) ? { ...w, prev: was } : w;
    }
    let t: any = { rows: s.rows, written: attempt };   // the Days write did not land
    for (let i = 0; i < 3; i++) {
      t = sync(rules2, t, '2027-01-15');
      expect([i, dayOf(t.rows, TODAY).values.Standard, dayOf(t.rows, TODAY).values.Edited === true]).toEqual([i, 2, false]);
    }
  });

  it('with no today given, nothing is held back (the plan as the rules give it)', () => {
    const s = sync(rulesOf(), { rows: [], written: {} }, '');
    const later = sync(rulesOf({ week: [wk('Every day', ALL, 'Personal', 4, 5, 6)] }), s, '');
    expect(dayOf(later.rows, '2027-01-05').values.Standard).toBe(5);
  });
});

const { stPlanFollow, stPlanFollowSettled, stPlanContradictions, stPlanDays, stPlanView, stPlanDaysOff, ST_PLAN_WORDS } = T;

describe('a phase that follows the exam', () => {
  const phases = () => [
    ph('Start to exam', 'Study', START, '2027-01-31', { Follows: 'Whole plan' }),
    ph('Days off', 'Rest', '2027-01-29', '2027-01-31', { Follows: 'Before exam' }),
    ph('Mock Sitting', 'Catch-up', '2027-01-20', '2027-01-20'),
  ];
  const written = (list: any[], f: any) => list.map((p) => { const u = f.updates.find((x: any) => x.pageId === p.pageId); return u ? { ...p, values: { ...p.values, ...u.values } } : p; });

  it('is left alone when its dates are already the plan\'s, and recorded', () => {
    const list = phases();
    const f = stPlanFollow(rulesOf({ phases: list }), {});
    expect(f.updates).toEqual([]);
    expect(f.seen).toEqual({ [list[0].pageId]: { follows: 'Whole plan', start: START, end: '2027-01-31' }, [list[1].pageId]: { follows: 'Before exam', start: '2027-01-29', end: '2027-01-31' } });
  });

  it('moves with the exam date: Whole plan to the day before it, Before exam with its length kept; a dated phase stays', () => {
    const list = phases();
    const seen = stPlanFollow(rulesOf({ phases: list }), {}).seen;
    const f = stPlanFollow(rulesOf({ phases: list, plan: { 'Exam Date': '2027-02-06' } }), seen);
    expect(f.updates).toEqual([
      { pageId: list[0].pageId, values: { Start: START, End: '2027-02-05' } },
      { pageId: list[1].pageId, values: { Start: '2027-02-03', End: '2027-02-05' } },
    ]);
    expect(f.rules.phases.map((p: any) => [p.name, p.start, p.end])).toEqual([['Start to exam', START, '2027-02-05'], ['Days off', '2027-02-03', '2027-02-05'], ['Mock Sitting', '2027-01-20', '2027-01-20']]);
    // The days are worked out from the phases as they will be: the last three rest.
    expect(stPlanDays(f.rules).slice(-3).map((d: any) => [d.type, d.planned])).toEqual([['Rest', 0], ['Rest', 0], ['Rest', 0]]);
    // Until the write has landed the record holds the dates before it too; a row as either one is Study's.
    expect(f.seen[list[1].pageId]).toEqual({ follows: 'Before exam', start: '2027-02-03', end: '2027-02-05', prev: { start: '2027-01-29', end: '2027-01-31' } });
    const half = stPlanFollow(rulesOf({ phases: list, plan: { 'Exam Date': '2027-02-06' } }), f.seen);
    expect(half.updates.length).toBe(2);
    expect(half.updates.some((u: any) => 'Follows' in u.values)).toBe(false);
    // Written, a run over them writes nothing.
    const after = written(list, f);
    const again = stPlanFollow(rulesOf({ phases: after, plan: { 'Exam Date': '2027-02-06' } }), stPlanFollowSettled(f.seen));
    expect(again.updates).toEqual([]);
  });

  it('moves with the start date: Whole plan starts there, Before exam stays', () => {
    const list = phases();
    const seen = stPlanFollow(rulesOf({ phases: list }), {}).seen;
    const f = stPlanFollow(rulesOf({ phases: list, plan: { 'Start Date': '2027-01-08' } }), seen);
    expect(f.updates).toEqual([{ pageId: list[0].pageId, values: { Start: '2027-01-08', End: '2027-01-31' } }]);
  });

  it('takes the plan\'s dates when Follows is set on a row he added', () => {
    const list = [...phases(), ph('Final Push', 'Study', '2027-01-06', '2027-01-10', { Follows: 'Before exam' }), ph('All Through', 'Catch-up', '2027-01-13', '2027-01-13', { Follows: 'Whole plan' })];
    const f = stPlanFollow(rulesOf({ phases: list }), stPlanFollow(rulesOf({ phases: phases() }), {}).seen);
    expect(f.updates.map((u: any) => u.values)).toEqual([{ Start: '2027-01-27', End: '2027-01-31' }, { Start: START, End: '2027-01-31' }]);
  });

  it('is his from then on when he edits its Start or End by hand: its Follows is cleared and the dates stay', () => {
    const list = phases();
    const seen = stPlanFollow(rulesOf({ phases: list }), {}).seen;
    list[0].values.End = '2027-01-24';
    const f = stPlanFollow(rulesOf({ phases: list }), seen);
    expect(f.updates).toEqual([{ pageId: list[0].pageId, values: { Follows: null } }]);
    expect(f.rules.phases[0]).toMatchObject({ follows: '', start: START, end: '2027-01-24' });
    expect(Object.keys(f.seen)).toEqual([list[1].pageId]);
    // And the exam moved after that leaves it where he put it.
    const after = written(list, f).map((p) => ({ ...p, values: Object.fromEntries(Object.entries(p.values).filter(([, v]) => v !== null)) }));
    const later = stPlanFollow(rulesOf({ phases: after, plan: { 'Exam Date': '2027-02-06' } }), f.seen);
    expect(later.updates.map((u: any) => u.pageId)).toEqual([list[1].pageId]);
  });

  it('moves nothing while the dates make no stretch, and a Before exam phase without dates has no length to keep', () => {
    const list = phases();
    const seen = stPlanFollow(rulesOf({ phases: list }), {}).seen;
    expect(stPlanFollow(rulesOf({ phases: list, plan: { 'Exam Date': START } }), seen).updates).toEqual([]);
    const bare = [ph('Taper', 'Rest', '', '', { Follows: 'Before exam' })];
    expect(stPlanFollow(rulesOf({ phases: bare }), {}).updates).toEqual([]);
  });
});

describe('rules that disagree, after the walk-through', () => {
  it('names a dated phase the plan\'s dates leave outside, not one that follows and not one partly inside', () => {
    const rules = rulesOf({ plan: { 'Exam Date': '2027-01-18' }, phases: [
      ph('Start to exam', 'Study', START, '2027-01-17', { Follows: 'Whole plan' }),
      ph('Mock Sitting', 'Catch-up', '2027-01-20', '2027-01-20'),
      ph('Warm Up', 'Rest', '2027-01-01', '2027-01-05'),
    ] });
    expect(stPlanContradictions(rules).map((c: any) => c.text)).toEqual(['Mock Sitting (Jan 20) is outside the plan\'s dates, so it holds no day. Give it new dates, or set its Follows.']);
  });

  it('names the study days from today on that no Study phase holds: how many, and the first', () => {
    const rules = rulesOf({ plan: { 'Exam Date': '2027-02-08' }, week: [wk('Six days', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], 'Personal', 1, 2, 3)] });
    const days = stPlanDays(rules);
    expect(stPlanContradictions(rules, { days, today: TODAY }).map((c: any) => c.text)).toEqual(['6 study days are in no Study phase, the first on Mon, Feb 1. Give a Study phase those dates, or set its Follows to Whole plan.']);
    expect(stPlanView(rules, days, { today: TODAY }).contradictions.length).toBe(1);
    // A plan with no Study phase at all is not told so.
    expect(stPlanContradictions(rulesOf({ phases: [] }), { days: stPlanDays(rulesOf({ phases: [] })), today: TODAY })).toEqual([]);
    // Days gone by are not counted: nothing can be done about them.
    const gap = rulesOf({ phases: [ph('Late Start', 'Study', '2027-01-10', '2027-01-31')] });
    expect(stPlanContradictions(gap, { days: stPlanDays(gap), today: TODAY })).toEqual([]);
  });
});

describe('the New Plan sheet\'s days off, and the words', () => {
  it('reads a whole number of days, nothing as none, and refuses the rest', () => {
    expect([stPlanDaysOff('0'), stPlanDaysOff(''), stPlanDaysOff(' 3 '), stPlanDaysOff(2), stPlanDaysOff('1.5'), stPlanDaysOff('-1'), stPlanDaysOff('two')]).toEqual([0, 0, 3, 2, null, null, null]);
  });
  it('says each term in one line that begins with it', () => {
    expect(ST_PLAN_WORDS.accounts.map((l: string) => l.split(' ')[0])).toEqual(['Personal', 'Work']);
    expect(ST_PLAN_WORDS.plans.map((l: string) => l.split(' ')[0])).toEqual(['Floor', 'Standard', 'Stretch']);
    expect(ST_PLAN_WORDS.kinds.map((l: string) => l.split(':')[0])).toEqual(['Rest', 'Catch-up', 'Holiday']);
    expect(ST_PLAN_WORDS.kinds.every((l: string) => /\bhours\b/.test(l))).toBe(true);
    expect(ST_PLAN_WORDS.once).toMatch(/\bonce\b/);
  });
});

describe('a day\'s Done as it is read', () => {
  it('is hours, in minutes under a tenth of an hour, and never 0 when there was work', () => {
    const { stPlanDoneWords, stPlanDoneByDate } = T;
    expect([0, 0.02, 0.03, 0.05, 0.07, 0.08, 0.1, 0.12, 1.5, 1.57, 2].map((h) => stPlanDoneWords(h))).toEqual(['0', '1 min', '2 min', '3 min', '4 min', '5 min', '0.1', '0.1', '1.5', '1.6', '2']);
    // From the Work Log's own minutes, through Days' hours: one minute to five read as they were logged.
    for (const m of [1, 2, 3, 4, 5]) expect(stPlanDoneWords(stPlanDoneByDate([{ values: { Date: '2027-01-14T08:00', Minutes: m } }]).get('2027-01-14'))).toBe(`${m} min`);
    expect(stPlanDoneWords(0.004)).toBe('1 min');
  });
});

describe('a name that holds a unit\'s name as whole words', () => {
  const { stUnitHolds } = T;
  it('holds it between characters that are not letters or digits, in any letter case, accents aside', () => {
    expect(stUnitHolds('Mack 1994 - Measuring the Variability of Chain Ladder Reserve Estimates', 'Mack')).toBe(true);
    expect(stUnitHolds('mack summary', 'Mack')).toBe(true);
    expect(stUnitHolds('CLARK - outline', 'Clark')).toBe(true);
    expect(stUnitHolds('chain ladder worked example', 'Chain Ladder')).toBe(true);
    expect(stUnitHolds('Bornhuetter_Ferguson 1972', 'Bornhuetter Ferguson')).toBe(true);
    expect(stUnitHolds('Notes on Hurlimann (2009)', 'Hürlimann')).toBe(true);
    expect(stUnitHolds('Mack', 'Mack')).toBe(true);
  });
  it('does not hold it inside a longer word, across other words, or when there is no name', () => {
    expect(stUnitHolds('Mackenzie 2001 - Notes', 'Mack')).toBe(false);
    expect(stUnitHolds('Unmacked thoughts', 'Mack')).toBe(false);
    expect(stUnitHolds('Chain of the Ladder', 'Chain Ladder')).toBe(false);
    expect(stUnitHolds('Mack1994', 'Mack')).toBe(false);
    expect(stUnitHolds('Grocery list', '')).toBe(false);
    expect(stUnitHolds('Grocery list', ' - ')).toBe(false);
    expect(stUnitHolds('', 'Mack')).toBe(false);
  });
});

describe('New Subject with a sources folder and a question bank', () => {
  const { stSubjectUnitsFromFolder, stSubjectUnitsFromListing } = T;
  const FILE = 1, DIR = 2;
  const listing = [
    'Mack 1994 - Measuring the Variability of Chain Ladder Reserve Estimates.pdf', 'Clark 2003 - LDF Curve Fitting and Stochastic Reserving.pdf', 'Venter 1998 - Testing the Assumptions of Age-to-Age Factors.pdf',
    'Bornhuetter Ferguson 1972 - The Actuary and IBNR.pdf', 'Brosius 1993 - Loss Development Using Credibility.pdf', 'Mackenzie 2001 - Notes.pdf', 'cover.png', '.hidden.md',
  ].map((name) => ({ name, type: FILE }));
  const BANK = ['Mack', 'Clark', 'Venter', 'Friedland', 'Bornhuetter Ferguson'];

  it('makes one unit per paper: a file joins the bank unit whose name it holds, any other file is its own unit', () => {
    const units = stSubjectUnitsFromFolder(listing, BANK);
    expect(units.map((u: any) => u.name)).toEqual([...BANK, 'Brosius 1993 - Loss Development Using Credibility', 'Mackenzie 2001 - Notes']);
    expect(units.find((u: any) => u.name === 'Mack')).toEqual({ name: 'Mack', bank: true, files: ['Mack 1994 - Measuring the Variability of Chain Ladder Reserve Estimates.pdf'], also: ['Mack 1994 - Measuring the Variability of Chain Ladder Reserve Estimates'] });
    expect(units.find((u: any) => u.name === 'Friedland')).toEqual({ name: 'Friedland', bank: true, files: [], also: [] });
    expect(units.find((u: any) => u.name === 'Mackenzie 2001 - Notes')).toEqual({ name: 'Mackenzie 2001 - Notes', bank: false, files: ['Mackenzie 2001 - Notes.pdf'], also: [] });
  });

  it('joins a file named exactly as the unit without another name for it, two files of one paper to one unit, and the longest name a file holds', () => {
    const units = stSubjectUnitsFromFolder([{ name: 'mack.pdf', type: FILE }, { name: 'Mack - my notes.md', type: FILE }, { name: 'Mack and Clark Compared.txt', type: FILE }, { name: 'Brosius.pdf', type: FILE }, { name: 'Brosius.md', type: FILE }], ['Mack', 'Clark', 'Mack and Clark']);
    expect(units).toEqual([
      { name: 'Mack', bank: true, files: ['mack.pdf', 'Mack - my notes.md'], also: ['Mack - my notes'] },
      { name: 'Clark', bank: true, files: [], also: [] },
      { name: 'Mack and Clark', bank: true, files: ['Mack and Clark Compared.txt'], also: ['Mack and Clark Compared'] },
      { name: 'Brosius', bank: false, files: ['Brosius.pdf', 'Brosius.md'], also: [] },
    ]);
  });

  it('with no bank, every file is its own unit and holds its file; the names are the ones a listing proposed before', () => {
    const units = stSubjectUnitsFromFolder(listing, []);
    expect(units.map((u: any) => u.name)).toEqual(stSubjectUnitsFromListing(listing));
    expect(units.every((u: any) => u.files.length === 1 && !u.bank && !u.also.length)).toBe(true);
  });

  it('with subfolders, one unit per subfolder as before, holding no file', () => {
    expect(stSubjectUnitsFromFolder([{ name: 'B Clark', type: DIR }, { name: 'A Mack', type: DIR }, { name: 'syllabus.txt', type: FILE }], ['Mack'])).toEqual([{ name: 'A Mack', bank: false, files: [], also: [] }, { name: 'B Clark', bank: false, files: [], also: [] }]);
  });

  it('writes a file\'s name into Also Called without the commas that would split it', () => {
    const units = stSubjectUnitsFromFolder([{ name: 'Mack, 1994; variability.pdf', type: FILE }], ['Mack']);
    expect(units[0].also).toEqual(['Mack 1994 variability']);
  });
});

describe('Find Matches, after the walk-through', () => {
  const { stUnitProposals } = T;
  const units = [{ name: 'Mack', also: 'Chain Ladder', attached: new Set<string>() }, { name: 'Clark', also: '', attached: new Set<string>() }, { name: 'Venter', also: '', attached: new Set(['page:v']) }];
  const cand = (key: string, label: string) => ({ key, label });
  const said = (list: any[]) => list.map((p) => `${p.candidate.key} → ${p.unit}: ${p.why}`);

  it('proposes exact names first, then the names that hold a unit\'s name or an Also Called name, each saying why', () => {
    const out = stUnitProposals(units, [cand('file:mack summary.md', 'mack summary'), cand('page:m', 'Mack'), cand('page:c', 'chain ladder worked example'), cand('file:Clark.md', 'Clark'), cand('file:CLARK - outline.txt', 'CLARK - outline'), cand('page:x', 'Mackenzie review'), cand('page:u', 'Unmacked thoughts')]);
    expect(said(out)).toEqual([
      'page:m → Mack: name is Mack',
      'file:Clark.md → Clark: name is Clark',
      'file:mack summary.md → Mack: name holds Mack',
      'page:c → Mack: name holds Chain Ladder',
      'file:CLARK - outline.txt → Clark: name holds Clark',
    ]);
    expect(out.map((p: any) => p.exact)).toEqual([true, true, false, false, false]);
  });

  it('proposes an item once for a unit (its own name before an Also Called name), for each unit whose name it holds, and never what the unit has', () => {
    const out = stUnitProposals(units, [cand('file:Mack 1994 - Chain Ladder.pdf', 'Mack 1994 - Chain Ladder'), cand('page:mc', 'Mack and Clark Compared'), cand('page:v', 'Venter - my notes'), cand('page:cl', 'Chain-Ladder')]);
    expect(said(out)).toEqual([
      'page:cl → Mack: name is Chain Ladder',
      'file:Mack 1994 - Chain Ladder.pdf → Mack: name holds Mack',
      'page:mc → Mack: name holds Mack',
      'page:mc → Clark: name holds Clark',
    ]);
  });
});

describe('the session clock', () => {
  const { stClockState, stClockAdvance, ST_CLOCK_IDLE_MS } = T;
  const MIN = 60_000;
  /** Run the clock a second at a time from `from` to `to`; `inputs` are the moments he touched the app, `hidden` the spans its tab was not showing. */
  function run(state: any, from: number, to: number, inputs: number[] = [], hidden: [number, number][] = [], start = 0) {
    let total = start; let last = Math.max(from, ...inputs.filter((t) => t <= from), state.inputSeen);
    for (let t = from + 1000; t <= to; t += 1000) {
      for (const i of inputs) if (i <= t && i > last) last = i;
      total += stClockAdvance(state, t, !hidden.some(([a, b]) => t > a && t <= b), last);
    }
    return total;
  }

  it('is ten minutes without input before a stretch stops being study', () => {
    expect(ST_CLOCK_IDLE_MS).toBe(10 * MIN);
  });

  it('counts while the tab is showing and he is there', () => {
    const s = stClockState(0);
    expect(run(s, 0, 6 * MIN, [1, 2, 3, 4, 5, 6].map((m) => m * MIN))).toBe(6 * MIN);
  });

  it('takes a stretch that ends idle back, once, and keeps what came before it', () => {
    const s = stClockState(0);
    const inputs = [1, 2, 3, 4, 5, 6].map((m) => m * MIN);
    // Six minutes at the desk, then thirty with no input: the ten counted after the last key come back.
    expect(run(s, 0, 36 * MIN, inputs)).toBe(6 * MIN);
    expect(s.idle).toBe(true);
    // Back at the desk: it counts again from there.
    expect(run(s, 36 * MIN, 40 * MIN, [36 * MIN + 500, 38 * MIN])).toBe(4 * MIN - 1000);
  });

  it('writes no hour for an hour with no input', () => {
    const s = stClockState(0);
    expect(run(s, 0, 61 * MIN)).toBe(0);
  });

  it('draws the line at ten minutes: an input every 11 counts nothing, one every 9 counts everything', () => {
    expect(run(stClockState(0), 0, 33 * MIN, [11, 22, 33].map((m) => m * MIN))).toBe(0);
    expect(run(stClockState(0), 0, 36 * MIN, [9, 18, 27, 36].map((m) => m * MIN))).toBe(36 * MIN);
  });

  it('counts nothing while the tab is not showing, whatever he does elsewhere in the app', () => {
    const s = stClockState(0);
    const inputs = Array.from({ length: 14 }, (_, i) => (i + 1) * MIN);
    expect(run(s, 0, 14 * MIN, inputs, [[1 * MIN, 13 * MIN]])).toBe(2 * MIN);
  });

  it('credits at most five seconds for one look, so a machine asleep does not count its nap', () => {
    const s = stClockState(0);
    expect(stClockAdvance(s, 8 * 60 * MIN, true, 8 * 60 * MIN)).toBe(5000);
  });
});

describe('the New Plan sheet\'s sum, with days off', () => {
  it('counts the days off before the exam at no hours', () => {
    const { stPlanFormTotals } = T;
    const form = { start: '2027-01-04', exam: '2027-01-18', personal: { Mon: 2, Tue: 2, Wed: 2, Thu: 2, Fri: 2, Sat: 2, Sun: 2 }, work: {}, less: 1, more: 1, off: '0' };
    expect(stPlanFormTotals(form)).toEqual({ Floor: 14, Standard: 28, Stretch: 42, days: 14, off: 0 });
    expect(stPlanFormTotals({ ...form, off: '3' })).toEqual({ Floor: 11, Standard: 22, Stretch: 33, days: 14, off: 3 });
    // What cannot be days off (not a number, the whole plan) leaves the sum as it was; Create says what is wrong.
    expect(stPlanFormTotals({ ...form, off: 'two' })).toMatchObject({ Standard: 28, off: 0 });
    expect(stPlanFormTotals({ ...form, off: '14' })).toMatchObject({ Standard: 28, off: 0 });
    expect(stPlanFormTotals({ ...form, exam: '' })).toBeNull();
  });
});
