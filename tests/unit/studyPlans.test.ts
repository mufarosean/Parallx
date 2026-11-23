// studyPlans.test.ts — a plan kept in canvas databases (ext/study/src/29-plans.js),
// through the generated main.js against SQLite with every migration and the
// in-memory door of tests/unit/fixtures/studyDoor.ts, which counts every write.
//
// What is held here: New Plan makes a page under the subject's page with the
// four databases and their columns, fills Plan, Week and Phases from the form
// and works out Days; a run over them then writes nothing; a rule changed in a
// database reaches Days as one write of only the cells that differ; a day he
// changed is ticked Edited and kept, and back to the rules when unticked; Done
// is the Work Log's; a database in the Trash or gone stops every write and is
// said; and once Study is off nothing is written, on again the days catch up.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { studyHarness, type Study } from './fixtures/studyDoor';

const NAMES = ['__testables', '_stSubjects', '_stPlans', 'stRouteInstanceId', 'stRouteFromInstanceId', 'stSubjectMenuItems', 'stSubjectsShown', 'stCreateSubject', 'stCreatePlan', 'stPlanEnqueue', 'stPlanFlush', 'stPlansOfSubject', 'stPlanSetFollowing', 'stSubjectsReset', 'stPlansReset', 'registerPlans', 'deactivate', 'stRemoveSubject'];

let live: Study | null = null;
afterEach(() => { live?.stPlansReset(); live?.stSubjectsReset(); live = null; });

const week7 = (monThu: number, fri: number, sat: number, sun: number) => ({ Mon: monThu, Tue: monThu, Wed: monThu, Thu: monThu, Fri: fri, Sat: sat, Sun: sun });
const BASIC = { name: 'Winter Block', start: '2027-01-04', exam: '2027-03-01', goal: 200, personal: week7(2, 0, 4, 0), work: week7(1, 2, 0, 0) };

async function planned() {
  const h = studyHarness(NAMES);
  live = h.S;
  const settle = async () => {
    for (let i = 0; i < 4; i++) for (const st of [...h.S._stPlans.values()]) await h.S.stPlanEnqueue(st, () => h.S.stPlanFlush(st));
  };
  const subject = await h.S.stCreateSubject({ name: 'Exam 7' });
  const plan = await h.S.stCreatePlan({ subjectId: subject.id, ...BASIC });
  await settle();
  const db = (t: string) => [...h.dbs.values()].find((d) => d.title === t && d.parentPageId === plan.pageId)!;
  const days = () => db('Days').rows.slice().sort((a, b) => (String(a.values.Date) < String(b.values.Date) ? -1 : 1));
  const day = (date: string) => db('Days').rows.find((r) => r.values.Date === date)!;
  const total = () => days().reduce((t, d) => t + Number(d.values.Planned || 0), 0);
  return { ...h, settle, subject, plan, db, days, day, total };
}

describe('New Plan', () => {
  it('makes a page under the subject\'s page with Plan, Week, Phases and Days, their columns, and the rows of the form', async () => {
    const h = await planned();
    expect(h.writes.filter((w) => w.startsWith('page ')).slice(-1)).toEqual(['page Winter Block']);
    expect(['Plan', 'Week', 'Phases', 'Days'].map((t) => h.db(t).columns.map((c) => c.name))).toEqual([
      ['Exam Date', 'Start Date', 'Hours Goal', 'Following'],
      ['Days', 'Account', 'From', 'Until', 'Floor', 'Standard', 'Stretch'],
      ['Kind', 'Start', 'End', 'Items', 'Minutes per Item'],
      ['Date', 'Type', 'Phase', 'Work', 'Floor', 'Standard', 'Stretch', 'Planned', 'Running', 'Done', 'Edited', 'Note'],
    ]);
    expect(h.db('Days').columns.filter((c) => c.config.computedBy).map((c) => c.name)).toEqual(['Planned', 'Running', 'Done']);
    expect(h.db('Plan').rows.map((r) => r.values)).toEqual([{ 'Start Date': '2027-01-04', 'Exam Date': '2027-03-01', 'Hours Goal': 200, Following: 'Standard' }]);
    expect(h.db('Week').rows.map((r) => [r.title, r.values.Days, r.values.Account, r.values.Floor, r.values.Standard, r.values.Stretch])).toEqual([
      ['Personal, Mon to Thu', ['Mon', 'Tue', 'Wed', 'Thu'], 'Personal', 1, 2, 3],
      ['Personal, Sat', ['Sat'], 'Personal', 3, 4, 5],
      ['Work, Mon to Thu', ['Mon', 'Tue', 'Wed', 'Thu'], 'Work', 1, 1, 1],
      ['Work, Fri', ['Fri'], 'Work', 2, 2, 2],
    ]);
    expect(h.db('Phases').rows.map((r) => [r.title, r.values])).toEqual([['Start to exam', { Kind: 'Study', Start: '2027-01-04', End: '2027-02-28' }]]);
    expect(h.days().length).toBe(56);
    expect([h.days()[0].title, h.days()[0].values.Type, h.days()[0].values.Running, h.days()[55].values.Running]).toEqual(['Mon, Jan 4, 2027', 'Study', 3, 144]);
    expect(h.writes.filter((w) => w.startsWith('add 56 to Days'))).toHaveLength(1);
  });

  it('refuses an exam on or before the start, in words, and makes nothing', async () => {
    const h = studyHarness(NAMES); live = h.S;
    const subject = await h.S.stCreateSubject({ name: 'Exam 7' });
    const before = h.dbs.size;
    await expect(h.S.stCreatePlan({ subjectId: subject.id, ...BASIC, exam: '2027-01-04' })).rejects.toThrow('The exam date must be after the start date.');
    await expect(h.S.stCreatePlan({ subjectId: subject.id, ...BASIC, exam: '2027-01-01' })).rejects.toThrow('The exam date must be after the start date.');
    expect(h.dbs.size).toBe(before);
  });

  it('then reads again and writes nothing more', async () => {
    const h = await planned();
    const n = h.writes.length;
    await h.settle();
    expect(h.writes.slice(n)).toEqual([]);
  });
});

describe('a rule changed in a database', () => {
  it('reaches Days in one write of only what differs', async () => {
    const h = await planned();
    const n = h.writes.length;
    h.person.edit(h.db('Week'), 'Personal, Sat', { values: { Standard: 6 } });
    await h.settle();
    // From the first Saturday on: that day's Standard, Planned and Running, then Running alone.
    expect(h.writes.slice(n)).toEqual([expect.stringMatching(/^update 51 in Days: Standard,Planned,Running Running /)]);
    expect(h.day('2027-01-09').values.Standard).toBe(6);
    expect(h.total()).toBe(160);
  });

  it('a later exam adds days, an earlier one removes them; Following changes Planned and Running', async () => {
    const h = await planned();
    h.person.edit(h.db('Plan'), 'Winter Block', { values: { 'Exam Date': '2027-03-08' } });
    await h.settle();
    expect(h.days().length).toBe(63);
    h.person.edit(h.db('Plan'), 'Winter Block', { values: { 'Exam Date': '2027-02-22' } });
    await h.settle();
    expect([h.days().length, h.days()[48].values.Date]).toEqual([49, '2027-02-21']);
    await h.S.stPlanSetFollowing(h.plan.id, 'Stretch');
    await h.settle();
    expect(h.db('Plan').rows[0].values.Following).toBe('Stretch');
    expect(h.days()[48].values.Running).toBe(161);
  });
});

describe('a day he changed', () => {
  it('is ticked Edited and kept; Running follows; unticked it goes back to the rules', async () => {
    const h = await planned();
    h.person.edit(h.db('Days'), 'Wed, Jan 13, 2027', { values: { Standard: 5 } });
    await h.settle();
    expect([h.day('2027-01-13').values.Edited, h.day('2027-01-13').values.Planned, h.days()[55].values.Running]).toEqual([true, 6, 147]);
    h.person.add(h.db('Week'), 'Every Day Extra', { Days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], Account: 'Personal', Floor: 1, Standard: 1, Stretch: 1 });
    await h.settle();
    expect([h.day('2027-01-13').values.Standard, h.day('2027-01-12').values.Standard]).toEqual([5, 3]);
    h.person.edit(h.db('Days'), 'Wed, Jan 13, 2027', { values: { Edited: false } });
    await h.settle();
    expect([h.day('2027-01-13').values.Standard, h.day('2027-01-13').values.Edited]).toEqual([3, false]);
    expect(h.days().filter((d) => d.values.Edited).length).toBe(0);
  });
});

describe('Done', () => {
  it('is the hours of the subject\'s Work Log on each local date', async () => {
    const h = await planned();
    const log = [...h.dbs.values()].find((d) => d.title === 'Work Log')!;
    h.person.add(log, 'Late reading', { Date: '2027-01-13T23:30', Minutes: 60 });
    h.person.add(log, 'Morning', { Date: '2027-01-13T08:00', Minutes: 30 });
    await h.settle();
    expect([h.day('2027-01-13').values.Done, h.day('2027-01-14').values.Done]).toEqual([1.5, 0]);
  });
});

describe('the Trash, and Study off', () => {
  it('a database in the Trash stops every write and is said; restored, the days follow', async () => {
    const h = await planned();
    h.person.trash(h.db('Days'));
    await h.settle();
    const n = h.writes.length;
    h.person.edit(h.db('Week'), 'Personal, Sat', { values: { Standard: 6 } });
    await h.settle();
    expect(h.writes.slice(n)).toEqual([]);
    expect([...h.S._stPlans.values()][0].problem).toMatch(/Days database is in the Trash/);
    h.person.restore(h.db('Days'));
    await h.settle();
    expect(h.day('2027-01-09').values.Standard).toBe(6);
    expect([...h.S._stPlans.values()][0].problem).toBe('');
  });

  it('a Plan row with no dates writes nothing: the days stay as they are', async () => {
    const h = await planned();
    const n = h.writes.length;
    h.person.edit(h.db('Plan'), 'Winter Block', { values: { 'Exam Date': '' } });
    await h.settle();
    expect(h.writes.slice(n)).toEqual([]);
    expect(h.days().length).toBe(56);
  });

  it('once Study is off nothing is written; on again the days catch up with what changed meanwhile', async () => {
    const h = await planned();
    const n = h.writes.length;
    await h.S.deactivate();
    h.person.add(h.db('Week'), 'While Off', { Days: ['Sun'], Account: 'Work', Floor: 3, Standard: 3, Stretch: 3 });
    await new Promise((r) => setTimeout(r, 120));
    expect(h.writes.slice(n)).toEqual([]);
    h.S.__testables.__setApi(h.api);
    h.S.registerPlans({ subscriptions: [] });
    await vi.waitFor(() => { expect(h.S._stPlans.size).toBe(1); });
    await h.settle();
    expect(h.day('2027-01-10').values.Work).toBe(3);
    expect(h.days().every((d) => !d.values.Edited)).toBe(true);
  });

  it('Remove Subject forgets its plans and leaves their databases', async () => {
    const h = await planned();
    await h.S.stRemoveSubject(h.subject.id);
    expect(h.S._stPlans.size).toBe(0);
    expect(h.one('SELECT COUNT(*) AS n FROM st_plans').n).toBe(0);
    expect(h.days().length).toBe(56);
  });

  it('the sidebar\'s plan is the soonest exam that has not passed', async () => {
    const h = await planned();
    const near = await h.S.stCreatePlan({ subjectId: h.subject.id, ...BASIC, name: 'Mock Exam', exam: '2027-02-01' });
    await h.settle();
    expect(h.S.stPlansOfSubject(h.subject.id, '2027-01-10').shown.plan.name).toBe('Mock Exam');
    expect(h.S.stPlansOfSubject(h.subject.id, '2027-02-02').shown.plan.name).toBe('Winter Block');
    expect(h.S.stPlansOfSubject(h.subject.id, '2027-03-02').shown).toBe(null);
    expect(near.name).toBe('Mock Exam');
  });
});

describe('finding a plan', () => {
  it('the sheet and the tab have their own tabs, and a tab that comes back with the app knows its route', async () => {
    const h = await planned();
    const tab = h.S.stRouteInstanceId({ view: 'plan', planId: h.plan.id });
    expect([h.S.stRouteInstanceId({ view: 'newPlan', subjectId: h.subject.id }), tab]).toEqual([`new-plan-${h.subject.id}`, `plan-${h.plan.id}`]);
    expect(h.S.stRouteFromInstanceId(tab)).toEqual({ view: 'plan', planId: h.plan.id });
    expect(h.S.stRouteFromInstanceId(`new-plan-${h.subject.id}`)).toEqual({ view: 'newPlan', subjectId: h.subject.id });
  });

  it('a subject\'s More Actions has New Plan…, and Open Plan once it has a plan', async () => {
    const h = studyHarness(NAMES); live = h.S;
    const subject = await h.S.stCreateSubject({ name: 'Exam 7' });
    const labels = () => h.S.stSubjectMenuItems(h.S.stSubjectsShown().find((s: any) => s.id === subject.id)).map((i: any) => i.label).filter(Boolean);
    expect(labels()).toContain('New Plan…');
    expect(labels()).not.toContain('Open Plan');
    await h.S.stCreatePlan({ subjectId: subject.id, ...BASIC });
    expect(labels()).toEqual(expect.arrayContaining(['Open Plan', 'New Plan…']));
  });
});

describe('a Days column deleted or renamed', () => {
  const edited = (h: Awaited<ReturnType<typeof planned>>) => h.days().filter((d) => d.values.Edited).length;
  it('is no edit of his: no day is marked Edited, and once it is put back its cells are worked out again', async () => {
    const h = await planned();
    h.person.dropColumn(h.db('Days'), 'Standard');
    await h.settle();
    expect(edited(h)).toBe(0);
    h.person.edit(h.db('Week'), 'Personal, Sat', { values: { Standard: 6 } });
    await h.settle();
    expect(h.db('Days').columns.some((c) => c.name === 'Standard')).toBe(true);
    expect([edited(h), h.day('2027-01-09').values.Standard, h.day('2027-01-05').values.Standard, h.total()]).toEqual([0, 6, 2, 160]);
  });

  it('renamed: no day is marked Edited', async () => {
    const h = await planned();
    h.person.renameColumn(h.db('Days'), 'Work', 'Work Hours');
    await h.settle();
    expect(edited(h)).toBe(0);
  });

  it('Date deleted and put back: the days keep their rows, dated again from their titles, no second set', async () => {
    const h = await planned();
    h.person.dropColumn(h.db('Days'), 'Date');
    await h.settle();
    h.person.edit(h.db('Week'), 'Personal, Sat', { values: { Standard: 6 } });
    await h.settle();
    expect([h.days().length, h.days().filter((d) => !d.values.Date).length, edited(h), h.day('2027-01-09').values.Standard]).toEqual([56, 0, 0, 6]);
  });
});

describe('the record of what Study wrote', () => {
  it('a sync stopped half way (a write refused after the cells were changed) marks no day Edited', async () => {
    const h = await planned();
    const addRows = h.door.addRows; let once = true;
    (h.door as any).addRows = async (...a: any[]) => { if (once) { once = false; throw new Error('refused'); } return (addRows as any)(...a); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.person.edit(h.db('Week'), 'Personal, Sat', { values: { Standard: 6 } });
    h.person.edit(h.db('Plan'), 'Winter Block', { values: { 'Exam Date': '2027-03-08' } });
    await h.settle();
    warn.mockRestore();
    expect([h.days().length, h.days().filter((d) => d.values.Edited).length, h.day('2027-01-09').values.Standard]).toEqual([63, 0, 6]);
  });

  it('Study off between the writes and the record: on again, no day is marked Edited', async () => {
    const h = await planned();
    const updateRows = h.door.updateRows;
    (h.door as any).updateRows = async (...a: any[]) => { const r = await (updateRows as any)(...a); await h.S.deactivate(); return r; };
    h.person.edit(h.db('Week'), 'Personal, Sat', { values: { Standard: 6 } });
    await h.settle();
    (h.door as any).updateRows = updateRows;
    h.S.__testables.__setApi(h.api);
    h.S.registerPlans({ subscriptions: [] });
    await vi.waitFor(() => { expect(h.S._stPlans.size).toBe(1); });
    await h.settle();
    expect([h.days().filter((d) => d.values.Edited).length, h.day('2027-01-09').values.Standard]).toEqual([0, 6]);
  });
});
