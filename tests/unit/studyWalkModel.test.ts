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
