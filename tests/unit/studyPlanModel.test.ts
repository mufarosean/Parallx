// studyPlanModel.test.ts — a Study plan, the pure part (ext/study/src/13-plan-model.js).
//
// The dates without a clock; his spring 2027 draft (10 Week rows, 15 Phases
// rows) worked out day for day against the output of his own sheet
// (campaign/spring-2027/plan_days.py on exam7-campaign: per day the work
// hours and the personal hours of Floor, Standard and Stretch) with its
// totals 385, 486 and 557; the plan the New Plan sheet makes; a day he
// changed kept, unticked, and kept outside new dates; Done by local date;
// the phases that do not fit; the goal; the contradictions; and the same
// answers under two time zones.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
// @ts-expect-error — JS module with no types
import { __testables as T } from '../../ext/study/main.js';

const {
  stPlanDayNumber, stPlanDateOfNumber, stPlanDateOf, stPlanAddDays, stPlanDaysBetween, stPlanWeekday, stPlanDateWords, stPlanSpanWords,
  stPlanWeekdaysOf, stPlanRules, stPlanDays, stPlanTotals, stPlanGoalWords, stPlanHoursPerDay, stPlanPhases, stPlanFitWords,
  stPlanContradictions, stPlanReconcile, stPlanWrittenOfAdds, stPlanDoneByDate, stPlanView,
} = T;

// His sheet's output: four digits a day from Dec 7, 2026 (work, Floor, Standard, Stretch).
const REFERENCE = '02340234023402340000034503450234023402340234000003450345000000000000000000000000000000000000000000000000000000000234023402340234000003450345023402340234223400000345034522342234223422340000000000002234223422342234000003450345223422342234223400000345034522342234223422340000000000002344234423442344000003450345234423442344234400000345034523442344234423440000034503452344234423442344000003450345234423442344234400000000000023442344234423440000034503452344234423442344000000000345434643464346434640020345034542444244424442444244068804480000';
const reference = Array.from({ length: REFERENCE.length / 4 }, (_, i) => ({
  date: stPlanAddDays('2026-12-07', i), work: Number(REFERENCE[4 * i]), floor: Number(REFERENCE[4 * i + 1]), standard: Number(REFERENCE[4 * i + 2]), stretch: Number(REFERENCE[4 * i + 3]),
}));

let n = 0;
const row = (title: string, values: Record<string, unknown>) => ({ pageId: `row-${++n}`, title, values });
const MON_THU = ['Mon', 'Tue', 'Wed', 'Thu']; const MON_FRI = [...MON_THU, 'Fri'];
const wk = (name: string, days: string[], account: string, from: string, until: string, floor: number, standard: number, stretch: number) =>
  row(name, { Days: days, Account: account, ...(from ? { From: from } : {}), ...(until ? { Until: until } : {}), Floor: floor, Standard: standard, Stretch: stretch });
const ph = (name: string, kind: string, start: string, end: string, extra: Record<string, unknown> = {}) => row(name, { Kind: kind, Start: start, End: end, ...extra });
const SPRING_WEEK = [
  wk('Mornings', MON_THU, 'Personal', '2026-12-07', '2027-04-11', 2, 2, 2),
  wk('Evenings before the ramp', MON_THU, 'Personal', '2026-12-07', '2027-02-14', 0, 1, 2),
  wk('Evenings from the ramp', MON_THU, 'Personal', '2027-02-15', '2027-04-11', 1, 2, 2),
  wk('Weekends', ['Sat', 'Sun'], 'Personal', '2026-12-07', '2027-04-11', 3, 4, 5),
  wk('Half days, extra', MON_FRI, 'Personal', '2027-04-05', '2027-04-11', 0, 0, 2),
  wk('Off work, weekdays', MON_FRI, 'Personal', '2027-04-12', '2027-04-16', 2, 4, 4),
  wk('Off work, Saturday', ['Sat'], 'Personal', '2027-04-17', '2027-04-17', 6, 8, 8),
  wk('Off work, Sunday', ['Sun'], 'Personal', '2027-04-18', '2027-04-18', 4, 4, 8),
  wk('Work study', MON_THU, 'Work', '2027-01-14', '2027-04-04', 2, 2, 2),
  wk('Work study, last two weeks', MON_FRI, 'Work', '2027-04-05', '2027-04-16', 4, 4, 4),
];
const SPRING_PHASES = [
  ph('Read only', 'Study', '2026-12-07', '2026-12-20'),
  ph('Read and notes', 'Study', '2027-01-04', '2027-01-24'),
  ph('Read, problems, recipes', 'Study', '2027-01-25', '2027-02-14'),
  ph('Every problem, mixed', 'Study', '2027-02-15', '2027-03-21'),
  ph('Hard ones + source review', 'Study', '2027-03-22', '2027-04-04'),
  ph('Practice exams + mixed quizzes', 'Study', '2027-04-05', '2027-04-18'),
  ph('Holidays', 'Holiday', '2026-12-21', '2027-01-03'),
  ph('Rest, January', 'Rest', '2027-01-22', '2027-01-24'),
  ph('Rest, February', 'Rest', '2027-02-12', '2027-02-14'),
  ph('Rest, March', 'Rest', '2027-03-19', '2027-03-21'),
  ph('Rest, April 3', 'Rest', '2027-04-03', '2027-04-03'),
  ph('Catch-up, January', 'Catch-up', '2027-01-21', '2027-01-21'),
  ph('Catch-up, February', 'Catch-up', '2027-02-11', '2027-02-11'),
  ph('Catch-up, March', 'Catch-up', '2027-03-18', '2027-03-18'),
  ph('Catch-up, April', 'Catch-up', '2027-04-01', '2027-04-01'),
];
const springPlan = (following = 'Standard') => ({ 'Start Date': '2026-12-07', 'Exam Date': '2027-04-20', 'Hours Goal': 500, Following: following });
const spring = (following = 'Standard') => stPlanRules({ plan: springPlan(following), week: SPRING_WEEK, phases: SPRING_PHASES });

// The plan of the New Plan sheet: Mon to Thu 2 personal and 1 work, Fri 2 work, Sat 4 personal; the Floor one less, the Stretch one more.
const BASIC_WEEK = [
  ...MON_THU.map((d) => wk(`${d} personal`, [d], 'Personal', '', '', 1, 2, 3)),
  ...MON_THU.map((d) => wk(`${d} work`, [d], 'Work', '', '', 1, 1, 1)),
  wk('Fri work', ['Fri'], 'Work', '', '', 2, 2, 2),
  wk('Sat personal', ['Sat'], 'Personal', '', '', 3, 4, 5),
];
const basic = (extra: { phases?: any[]; plan?: Record<string, unknown> } = {}) => stPlanRules({
  plan: { 'Start Date': '2027-01-04', 'Exam Date': '2027-03-01', 'Hours Goal': 200, Following: 'Standard', ...(extra.plan || {}) },
  week: BASIC_WEEK, phases: extra.phases || [ph('Winter Block', 'Study', '2027-01-04', '2027-02-28')],
});

describe('dates, without a clock', () => {
  it('count whole days from 1970-01-01 and back, across leap years and centuries', () => {
    expect(stPlanDayNumber('1970-01-01')).toBe(0);
    expect(stPlanDayNumber('2000-03-01') - stPlanDayNumber('2000-02-28')).toBe(2);
    expect(stPlanDayNumber('1900-03-01') - stPlanDayNumber('1900-02-28')).toBe(1);
    for (const d of ['1969-12-31', '2024-02-29', '2026-12-07', '2027-04-19', '2100-12-31']) expect(stPlanDateOfNumber(stPlanDayNumber(d))).toBe(d);
  });
  it('add days, count between, and name the weekday', () => {
    expect(stPlanAddDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(stPlanAddDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(stPlanDaysBetween('2026-12-07', '2027-04-20')).toBe(134);
    expect(['2026-12-07', '2027-01-10', '2027-04-17'].map(stPlanWeekday)).toEqual(['Mon', 'Sun', 'Sat']);
  });
  it('take a date or the date of a date-time, and refuse what is not a calendar date', () => {
    expect(['2027-04-20', '2027-01-13T23:30', ' 2027-02-28 '].map(stPlanDateOf)).toEqual(['2027-04-20', '2027-01-13', '2027-02-28']);
    expect(['2027-02-30', '20270420', '', null, 5].map(stPlanDateOf)).toEqual(['', '', '', '', '']);
  });
  it('are said in words', () => {
    expect(stPlanDateWords('2027-01-04')).toBe('Mon, Jan 4');
    expect(stPlanDateWords('2027-04-20', { year: true })).toBe('Tue, Apr 20, 2027');
    expect(stPlanDateWords('2027-04-20', { year: true, long: true })).toBe('Tuesday, April 20, 2027');
    expect(stPlanSpanWords('2027-01-04', '2027-01-31')).toBe('Jan 4 – Jan 31');
    expect(stPlanSpanWords('2026-12-21', '2027-01-03')).toBe('Dec 21, 2026 – Jan 3, 2027');
    expect(stPlanSpanWords('2027-04-03', '2027-04-03')).toBe('Apr 3');
  });
});

describe('reading the rules', () => {
  it('takes weekdays as tags or words, an account, and an empty end as open', () => {
    expect(stPlanWeekdaysOf(['Thu', 'monday', 'Mon'])).toEqual(['Mon', 'Thu']);
    expect(stPlanWeekdaysOf('Sat, Sunday')).toEqual(['Sat', 'Sun']);
    const r = stPlanRules({ plan: { 'Start Date': '2027-01-04', 'Exam Date': '2027-03-01', Following: 'stretch' }, week: [row('W', { Days: ['Mon'], Account: 'work', Standard: '2.5' })], phases: [row('P', { Kind: 'catch up', Start: '2027-01-05', End: '2027-01-05' })] });
    expect([r.following, r.goal, r.week[0].account, r.week[0].standard, r.week[0].from, r.phases[0].kind]).toEqual(['Stretch', 0, 'Work', 2.5, '', 'Catch-up']);
    expect(stPlanRules({ plan: {}, week: [], phases: [] }).following).toBe('Standard');
  });
});

describe('his spring 2027 draft', () => {
  it('gives his sheet day for day: 134 days, work and the personal hours of all three plans', () => {
    const days = stPlanDays(spring());
    expect(days.length).toBe(134);
    expect([days[0].date, days[133].date]).toEqual(['2026-12-07', '2027-04-19']);
    const diff = days.filter((d: any, i: number) => {
      const r = reference[i];
      return d.date !== r.date || d.work !== r.work || d.floor !== r.floor || d.standard !== r.standard || d.stretch !== r.stretch;
    });
    expect(diff).toEqual([]);
  });
  it('totals 385, 486 and 557 hours, with 97 days of study in the Standard plan', () => {
    const days = stPlanDays(spring());
    expect(stPlanTotals(days)).toEqual({ Floor: 385, Standard: 486, Stretch: 557 });
    expect(days.filter((d: any) => d.planned > 0).length).toBe(97);
    expect(days[133].running).toBe(486);
  });
  it('types the days: 14 holidays, rest by span and by no hours, 4 catch-up days, and the rest study', () => {
    const days = stPlanDays(spring());
    const count = (t: string) => days.filter((d: any) => d.type === t).length;
    expect({ Study: count('Study'), Rest: count('Rest'), Holiday: count('Holiday'), 'Catch-up': count('Catch-up') }).toEqual({ Study: 93, Rest: 23, Holiday: 14, 'Catch-up': 4 });
    const on = (date: string) => days.find((d: any) => d.date === date);
    expect([on('2027-01-21').type, on('2027-01-21').planned, on('2027-01-22').type, on('2027-01-22').planned, on('2026-12-25').type]).toEqual(['Catch-up', 5, 'Rest', 0, 'Holiday']);
    // A rest day inside a study phase keeps that phase; a holiday outside every study phase has none.
    expect([on('2027-01-22').phase, on('2026-12-25').phase, on('2027-04-19').phase]).toEqual(['Read and notes', '', '']);
  });
  it('counts hours per day for the plan he follows', () => {
    expect(stPlanHoursPerDay(stPlanDays(spring()))).toEqual([{ hours: 0, days: 37 }, { hours: 3, days: 15 }, { hours: 4, days: 27 }, { hours: 5, days: 17 }, { hours: 6, days: 28 }, { hours: 8, days: 10 }]);
  });
  it('follows Floor and Stretch too: Running ends at 385 and at 557', () => {
    expect(stPlanDays(spring('Floor'))[133].running).toBe(385);
    expect(stPlanDays(spring('Stretch'))[133].running).toBe(557);
  });
  it('gives each study phase its days and hours (the sums of his sheet over each span)', () => {
    const phases = stPlanPhases(spring(), stPlanDays(spring()));
    expect(phases.filter((p: any) => p.kind === 'Study').map((p: any) => [p.name, p.days, p.hours])).toEqual([
      ['Read only', 14, 40], ['Read and notes', 21, 62], ['Read, problems, recipes', 21, 76], ['Every problem, mixed', 35, 152], ['Hard ones + source review', 14, 60], ['Practice exams + mixed quizzes', 14, 96],
    ]);
    expect(phases[0].name).toBe('Read only');
    expect(stPlanContradictions(spring())).toEqual([]);
  });
});

describe('the plan the sheet makes', () => {
  it('has 56 days, 104, 144 and 184 hours, and the goal said for each', () => {
    const days = stPlanDays(basic());
    expect(days.length).toBe(56);
    const totals = stPlanTotals(days);
    expect(totals).toEqual({ Floor: 104, Standard: 144, Stretch: 184 });
    expect(['Floor', 'Standard', 'Stretch'].map((p) => stPlanGoalWords(totals[p], 200))).toEqual(['96 under 200', '56 under 200', '16 under 200']);
    expect(stPlanGoalWords(557, 500)).toBe('57 over 500');
    expect(stPlanGoalWords(500, 500)).toBe('on 500');
    expect(stPlanGoalWords(500, 0)).toBe('');
    expect(stPlanHoursPerDay(days)).toEqual([{ hours: 0, days: 8 }, { hours: 2, days: 8 }, { hours: 3, days: 32 }, { hours: 4, days: 8 }]);
  });
  it('has no days when the exam is on or before the start, and says so', () => {
    for (const exam of ['2027-01-04', '2027-01-01']) {
      const rules = basic({ plan: { 'Exam Date': exam } });
      expect(stPlanDays(rules)).toEqual([]);
      expect(stPlanContradictions(rules).map((c: any) => c.text)).toEqual(['The exam date is on or before the start date, so the plan has no days.']);
    }
  });
});

describe('a phase that does not fit', () => {
  const phases = (minutes: number) => [ph('Winter Block', 'Study', '2027-01-04', '2027-01-31', { Items: 560, 'Minutes per Item': minutes }), ph('Second Half', 'Study', '2027-02-01', '2027-02-28')];
  it('needs items times minutes: said for each plan, and nothing for a phase without the numbers', () => {
    const rules = basic({ phases: phases(9) });
    const [first, second] = stPlanPhases(rules, stPlanDays(rules));
    expect(first.per).toEqual({ Floor: 52, Standard: 72, Stretch: 92 });
    expect(first.fit).toEqual({ needs: 84, short: ['Floor', 'Standard'], given: true, measured: null });
    expect(['Floor', 'Standard', 'Stretch'].map((p) => stPlanFitWords(first.fit, first.per[p]))).toEqual(['needs 84 h, has 52 h', 'needs 84 h, has 72 h', 'fits: 84 h of work in 92 h']);
    expect(second.fit).toBe(null);
  });
  it('fits at 43 minutes for 100 items, not at 45', () => {
    const at = (minutes: number) => { const r = basic({ phases: [ph('W', 'Study', '2027-01-04', '2027-01-31', { Items: 100, 'Minutes per Item': minutes })] }); const p = stPlanPhases(r, stPlanDays(r))[0]; return stPlanFitWords(p.fit, p.hours); };
    expect([at(45), at(43)]).toEqual(['needs 75 h, has 72 h', 'fits: 71.7 h of work in 72 h']);
  });
});

describe('contradictions', () => {
  it('name a Week block with no days, a span that ends before it starts, and two Study phases over one date', () => {
    const rules = stPlanRules({
      plan: { 'Start Date': '2027-01-04', 'Exam Date': '2027-03-01' },
      week: [...BASIC_WEEK, row('Ghost Block', { Account: 'Personal', Floor: 9, Standard: 9, Stretch: 9 })],
      phases: [ph('Winter Block', 'Study', '2027-01-04', '2027-02-28'), ph('Backwards', 'Rest', '2027-02-10', '2027-02-05'), ph('Overlapper', 'Study', '2027-02-15', '2027-03-10')],
    });
    expect(stPlanContradictions(rules).map((c: any) => c.text)).toEqual([
      'Ghost Block has no days, so it gives no hours.',
      'Backwards ends before it starts, so it holds no day.',
      'Overlapper overlaps Winter Block from Feb 15 – Feb 28: those days stay in Winter Block, which starts first.',
    ]);
    const days = stPlanDays(rules);
    // No hours from the block, no rest from the span, the shared days in the phase that starts first.
    expect(stPlanTotals(days)).toEqual({ Floor: 104, Standard: 144, Stretch: 184 });
    expect(days.filter((d: any) => d.date >= '2027-02-15').every((d: any) => d.phase === 'Winter Block')).toBe(true);
  });
});

/** The Days rows as the door would list them after a reconcile was written. */
function apply(rows: any[], r: any) {
  let out = rows.filter((x) => !r.removes.includes(x.pageId)).map((x) => ({ ...x, values: { ...x.values } }));
  for (const u of r.updates) { const x = out.find((y) => y.pageId === u.pageId); for (const [k, v] of Object.entries(u.values)) { if (v === null) delete x.values[k]; else x.values[k] = v; } }
  const made = r.adds.map((a: any) => ({ pageId: `day-${++n}`, title: a.title, values: Object.fromEntries(Object.entries(a.values).filter(([, v]) => v !== null)) }));
  out = [...out, ...made];
  return { rows: out, written: { ...r.written, ...stPlanWrittenOfAdds(r.adds, made) } };
}
const sync = (rules: any, state: { rows: any[]; written: any }, done: any = null) => { const r = stPlanReconcile({ rules, rows: state.rows, written: state.written, done }); return { r, ...apply(state.rows, r) }; };
const dayOf = (rows: any[], date: string) => rows.find((x) => x.values.Date === date);

describe('the Days rows', () => {
  it('are made once, then a run over them writes nothing', () => {
    const rules = basic();
    const first = sync(rules, { rows: [], written: {} });
    expect([first.r.adds.length, first.r.updates.length, first.r.removes.length]).toEqual([56, 0, 0]);
    expect(new Set(first.rows.map((x: any) => x.title)).size).toBe(56);
    expect(first.rows[0].title).toBe('Mon, Jan 4, 2027');
    const again = sync(rules, first);
    expect([again.r.adds.length, again.r.updates.length, again.r.removes.length]).toEqual([0, 0, 0]);
  });

  it('write only what a rule change changes', () => {
    const s = sync(basic(), { rows: [], written: {} });
    const later = sync(basic({ phases: [ph('Winter Block', 'Study', '2027-01-04', '2027-02-28'), ph('Day Off', 'Rest', '2027-02-24', '2027-02-24')] }), s);
    // The day itself, and the Running of the four days after it.
    expect(later.r.updates.map((u: any) => Object.keys(u.values).join(','))).toEqual(['Type,Work,Floor,Standard,Stretch,Planned,Running', 'Running', 'Running', 'Running', 'Running']);
  });

  it('keep a day he changed: Edited ticked by Study, never worked out again, Running still following', () => {
    let s: any = sync(basic(), { rows: [], written: {} });
    const x = dayOf(s.rows, '2027-01-13');
    x.values.Standard = 5;
    s = sync(basic(), s);
    expect(s.r.updates.find((u: any) => u.pageId === x.pageId).values).toEqual({ Planned: 6, Running: 30, Edited: true });
    expect(dayOf(s.rows, '2027-01-13').values.Edited).toBe(true);
    expect(s.rows.filter((r: any) => r.values.Edited).length).toBe(1);
    expect(dayOf(s.rows, '2027-02-28').values.Running).toBe(147);
    // A rule that adds an hour every day leaves his day as it is.
    const more = stPlanRules({ plan: { 'Start Date': '2027-01-04', 'Exam Date': '2027-03-01', 'Hours Goal': 200 }, week: [...BASIC_WEEK, wk('Every Day Extra', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], 'Personal', '', '', 1, 1, 1)], phases: [ph('Winter Block', 'Study', '2027-01-04', '2027-02-28')] });
    s = sync(more, s);
    expect([dayOf(s.rows, '2027-01-13').values.Standard, dayOf(s.rows, '2027-01-12').values.Standard, dayOf(s.rows, '2027-01-14').values.Standard]).toEqual([5, 3, 3]);
    // Unticked, the day goes back to the rules.
    dayOf(s.rows, '2027-01-13').values.Edited = false;
    s = sync(more, s);
    expect([dayOf(s.rows, '2027-01-13').values.Standard, dayOf(s.rows, '2027-01-13').values.Edited]).toEqual([3, false]);
    s = sync(more, s);
    expect([s.r.adds.length, s.r.updates.length, s.r.removes.length]).toEqual([0, 0, 0]);
  });

  it('keep a day he changed outside new dates, listed as outside, and take it back when the dates come back', () => {
    let s: any = sync(basic(), { rows: [], written: {} });
    const y = dayOf(s.rows, '2027-02-25');
    y.values.Type = 'Catch-up';
    s = sync(basic(), s);
    expect(dayOf(s.rows, '2027-02-25').values.Edited).toBe(true);
    s = sync(basic({ plan: { 'Exam Date': '2027-02-22' } }), s);
    expect(s.rows.filter((r: any) => r.values.Date >= '2027-02-22').map((r: any) => r.values.Date)).toEqual(['2027-02-25']);
    expect(s.r.outside.map((o: any) => [o.date, o.type])).toEqual([['2027-02-25', 'Catch-up']]);
    expect(s.rows.length).toBe(50);
    s = sync(basic(), s);
    expect(s.r.outside).toEqual([]);
    expect(s.rows.length).toBe(56);
    expect([dayOf(s.rows, '2027-02-25').values.Type, dayOf(s.rows, '2027-02-25').values.Edited, dayOf(s.rows, '2027-02-25').pageId]).toEqual(['Catch-up', true, y.pageId]);
  });

  it('take a later start by removing the first days, Running starting anew', () => {
    let s: any = sync(basic(), { rows: [], written: {} });
    s = sync(basic({ plan: { 'Start Date': '2027-01-11' } }), s);
    const rows = s.rows.slice().sort((a: any, b: any) => (a.values.Date < b.values.Date ? -1 : 1));
    expect([rows.length, rows[0].values.Date, rows[0].values.Running]).toEqual([49, '2027-01-11', 3]);
  });

  it('leave alone a row Study never wrote outside the plan, and Done as it is when the Work Log cannot be read', () => {
    let s: any = sync(basic(), { rows: [], written: {} }, new Map([['2027-01-05', 1.5]]));
    expect(dayOf(s.rows, '2027-01-05').values.Done).toBe(1.5);
    s.rows.push(row('His own', { Date: '2027-06-01', Note: 'later' }));
    s = sync(basic(), s);
    expect(s.r.removes).toEqual([]);
    expect(s.r.updates).toEqual([]);
    expect(dayOf(s.rows, '2027-01-05').values.Done).toBe(1.5);
  });
});

describe('Done', () => {
  it('is the Work Log\'s minutes on each local date, in hours, late evening included', () => {
    const done = stPlanDoneByDate([row('a', { Date: '2027-01-13T23:30', Minutes: 90 }), row('b', { Date: '2027-01-13T10:00', Minutes: 30 }), row('c', { Date: '2027-01-14', Minutes: 0 }), row('d', { Minutes: 60 })]);
    expect([...done.entries()]).toEqual([['2027-01-13', 2]]);
    // A moment with a zone is turned into the person's date by the caller.
    expect([...stPlanDoneByDate([row('z', { Date: '2027-01-14T05:30:00Z', Minutes: 60 })], () => '2027-01-13').entries()]).toEqual([['2027-01-13', 1]]);
  });
});

describe('the view', () => {
  it('groups the days by week, Monday to Sunday, marks today and counts the days left', () => {
    const rules = spring();
    const v = stPlanView(rules, stPlanDays(rules), { today: '2027-01-13' });
    expect([v.weeks.length, Math.max(...v.weeks.map((w: any) => w.days.length)), v.weeks[19].days.length]).toEqual([20, 7, 1]);
    expect(v.daysLeft).toBe(97);
    expect(v.weeks.flatMap((w: any) => w.days).filter((d: any) => d.today).map((d: any) => d.date)).toEqual(['2027-01-13']);
    expect(v.weeks.flatMap((w: any) => w.days).filter((d: any) => d.past).length).toBe(37);
    expect(v.plans.map((p: any) => [p.plan, p.total, p.goal, p.following])).toEqual([
      ['Floor', 385, { word: 'under', by: 115 }, false], ['Standard', 486, { word: 'under', by: 14 }, true], ['Stretch', 557, { word: 'over', by: 57 }, false],
    ]);
    expect([v.studyDays, v.allDays]).toEqual([97, 134]);
  });
});

describe('time zones', () => {
  it('give the same plan under any zone: nothing reads the clock or a moment', () => {
    const main = join(__dirname, '../../ext/study/main.js').replace(/\\/g, '/');
    const script = `const { __testables: T } = await import('file://${main}'); const rules = T.stPlanRules(JSON.parse(process.argv[1])); const days = T.stPlanDays(rules); console.log(JSON.stringify(T.stPlanView(rules, days, { today: '2027-01-13' })));`;
    const input = JSON.stringify({ plan: springPlan(), week: SPRING_WEEK, phases: SPRING_PHASES });
    const run = (TZ: string) => execFileSync(process.execPath, ['--input-type=module', '-e', script, input], { env: { ...process.env, TZ }, encoding: 'utf8' }).trim();
    const east = run('Pacific/Kiritimati'); const west = run('Pacific/Pago_Pago');
    expect(east).toBe(west);
    expect(JSON.parse(east).weeks[0].days[0].date).toBe('2026-12-07');
    expect(JSON.parse(east).plans[1].total).toBe(486);
  });
});
