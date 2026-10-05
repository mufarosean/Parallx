// Worksheets: the study plan's arithmetic. A plan is imported data: days of
// blocks; draws are deterministic and never repeat within a block; a block is
// done when its quiz finished, its exam was graded, or the journal says so;
// the streak counts full days; XP is the blocks' plus a full-day bonus.
import { describe, it, expect } from 'vitest';
import { parsePlan, drawBlock, drawnOnMap, examItems, planProgress, examSummary, earnedPlanRewards, clockLabel, type BlockState, type ExamGrade, type StudyPlan } from '../../src/built-in/worksheet/plan.js';

const item = (id: number, paper: string, o: Partial<{ source: string; attemptState: string; starred: boolean; attemptCount: number; worked: boolean; title: string; tags: string }> = {}) => ({
  id, title: o.title ?? `P${id}`, paper, source: o.source ?? 'rf', kind: 'quant', quadrant: 0,
  attemptState: o.attemptState ?? '', attemptCount: o.attemptCount ?? (o.attemptState ? 1 : 0), seconds: 0, lastAttemptAt: 0,
  starred: o.starred ?? false, worked: o.worked ?? false, tags: o.tags ?? '',
});
const T = (d: string, h = 9) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00`);

const planJson = JSON.stringify({
  title: 'Final Weeks', examDay: '2026-10-27', fullDayXp: 50,
  days: [
    { day: '2026-10-06', type: 'exam', label: 'Exam 1', blocks: [
      { id: 'exam', start: '5:30', end: '10:00', kind: 'exam', title: 'Practice Exam 1', paper: 'pe1', minutes: 240, xp: 100 },
      { id: 'ev', start: '16:30', end: '18:30', kind: 'session', title: 'Evening flashcards', command: 'flashcards.studyTag', args: ['memorize'], done: { verb: 'finished', object: 'flashcards session #memorize' }, xp: 40 },
    ] },
    { day: '2026-10-07', type: 'grade', label: 'Grade', blocks: [
      { id: 'grade', start: '5:30', end: '7:30', kind: 'grade', title: 'Grade Exam 1', paper: 'pe1', xp: 50 },
      { id: 'old', start: '7:40', end: '9:40', kind: 'quiz', title: 'Old problems', pool: { from: ['misses', 'starred-medium'], count: 3 }, xp: 100 },
      { id: 'new', start: '9:50', end: '10:55', kind: 'quiz', title: 'New problems', pool: { from: ['new'], count: 2 }, xp: 40 },
    ] },
    { day: '2026-10-08', type: 'practice', label: 'Practice', blocks: [
      { id: 'old', start: '6:40', end: '8:40', kind: 'quiz', title: 'Old problems', pool: { from: ['misses', 'starred-hard'], count: 3 }, xp: 100 },
      { id: 'extra', start: '12:00', end: '13:00', kind: 'quiz', title: 'Extra', pool: { from: ['hard'], count: 1 }, xp: 10, required: false },
    ] },
    { day: '2026-10-26', type: 'taper', label: 'Taper', blocks: [{ id: 'fc', start: '5:30', end: '7:30', kind: 'session', title: 'Flashcards', command: 'flashcards.study', xp: 40 }] },
  ],
});

describe('parsePlan', () => {
  it('reads a plan, sorting days and blocks by the clock', () => {
    const { plan, error } = parsePlan(planJson);
    expect(error).toBe('');
    expect(plan!.days.map((d) => d.day)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-26']);
    expect(plan!.days[0].blocks.map((b) => b.id)).toEqual(['exam', 'ev']);
    expect(plan!.days[0].blocks[0]).toMatchObject({ kind: 'exam', paper: 'pe1', minutes: 240 });
    expect(plan!.days[0].blocks[1]).toMatchObject({ command: 'flashcards.studyTag', args: ['memorize'] });
  });
  it('refuses what it cannot run', () => {
    expect(parsePlan('nope').plan).toBeNull();
    expect(parsePlan(JSON.stringify({ examDay: '2026-10-27', days: [{ day: '2026-10-06', blocks: [{ id: 'q', kind: 'quiz', start: '5:30', end: '6:30' }] }] })).error).toMatch(/pool/);
    expect(parsePlan(JSON.stringify({ examDay: '2026-10-27', days: [{ day: '2026-10-06' }, { day: '2026-10-06' }] })).error).toMatch(/twice/);
  });
  it('labels the clock', () => {
    expect(clockLabel('5:30')).toBe('5:30 am');
    expect(clockLabel('16:30')).toBe('4:30 pm');
    expect(clockLabel('12:00')).toBe('12:00 pm');
  });
});

const items = [
  item(1, 'brosius', { starred: true, attemptState: 'hard' }),
  item(2, 'brosius', { starred: true, attemptState: 'medium' }),
  item(3, 'clark', { starred: true, attemptState: 'hard' }),
  item(4, 'clark', { starred: true, attemptState: 'medium' }),
  item(5, 'clark', { attemptState: 'hard' }),
  item(6, 'mack1994', { source: 'custom' }),
  item(7, 'mack1994', { source: 'custom' }),
  item(8, 'clark', { source: 'custom' }),
  item(9, 'pe1', { source: 'exam', title: 'PE 1 · Q #2 · Clark', tags: 'pe1,exam,quant,reading:clark' }),
  item(10, 'pe1', { source: 'exam', title: 'PE 1 · Q #1 · Mack (1994)', tags: 'pe1,exam,quant,reading:mack1994' }),
  item(11, 'pe1', { source: 'exam', title: 'PE 1 · Q #10 · Clark', tags: 'pe1,exam,quant,reading:clark' }),
];
const grades = new Map<number, ExamGrade>([
  [9, { itemId: 9, points: 4, lost: 2, cause: 'did not know', gradedAt: T('2026-10-07', 7) }],
  [10, { itemId: 10, points: 3, lost: 0, cause: '', gradedAt: T('2026-10-07', 7) }],
  [11, { itemId: 11, points: 5, lost: 1, cause: 'knew but slow', gradedAt: T('2026-10-07', 7) }],
]);
const plan = parsePlan(planJson).plan as StudyPlan;

describe('draws', () => {
  it('takes misses first, then the named starred band, never twice', () => {
    const block = plan.days[1].blocks[1];
    const draw = drawBlock('2026-10-07', block, { items, attempts: [], grades, drawnOn: new Map() });
    expect(draw.slice(0, 2).sort((x, y) => x - y)).toEqual([9, 11]);
    expect([2, 4]).toContain(draw[2]);
    expect(new Set(draw).size).toBe(3);
  });
  it('is the same draw every time for a day and block, and different on another day', () => {
    const block = plan.days[2].blocks[0];
    const a = drawBlock('2026-10-08', block, { items, attempts: [], grades, drawnOn: new Map() });
    const b = drawBlock('2026-10-08', block, { items, attempts: [], grades, drawnOn: new Map() });
    expect(a).toEqual(b);
    expect(a.slice(0, 2).sort((x, y) => x - y)).toEqual([9, 11]);
    expect([1, 3]).toContain(a[2]);
  });
  it('new problems come from the custom bank, round robin across papers, never drawn before', () => {
    const block = plan.days[1].blocks[2];
    const first = drawBlock('2026-10-07', block, { items, attempts: [], grades, drawnOn: new Map() });
    expect(first).toHaveLength(2);
    expect(new Set(first.map((id) => items.find((i) => i.id === id)!.paper)).size).toBe(2);
    const states: BlockState[] = [{ day: '2026-10-07', blockId: 'new', draw: first, sessionId: '', doneAt: null }];
    const second = drawBlock('2026-10-08', block, { items, attempts: [], grades, drawnOn: drawnOnMap(states) });
    expect(second.some((id) => first.includes(id))).toBe(false);
    expect(second).toHaveLength(1);
  });
  it('a miss redone once waits behind misses never redone', () => {
    const block = plan.days[2].blocks[0];
    const attempts = [{ itemId: 9, selfGrade: 'medium', at: T('2026-10-07', 12), seconds: 60, imported: false }];
    const draw = drawBlock('2026-10-08', block, { items, attempts, grades, drawnOn: new Map() });
    expect(draw[0]).toBe(11);
    expect(draw[1]).toBe(9);
  });
  it('orders an exam by question number', () => {
    expect(examItems('pe1', items)).toEqual([10, 9, 11]);
  });
});

describe('progress', () => {
  const states: BlockState[] = [
    { day: '2026-10-06', blockId: 'exam', draw: [10, 9, 11], sessionId: 's1', doneAt: null },
    { day: '2026-10-06', blockId: 'ev', draw: [], sessionId: '', doneAt: null },
    { day: '2026-10-07', blockId: 'old', draw: [9, 11, 2], sessionId: 's2', doneAt: null },
    { day: '2026-10-07', blockId: 'new', draw: [6, 8], sessionId: 's3', doneAt: null },
  ];
  const ctx = {
    finishedSessions: new Map([['s1', T('2026-10-06', 10)], ['s2', T('2026-10-07', 9)], ['s3', T('2026-10-07', 11)]]),
    gradedPapers: new Map([['pe1', T('2026-10-07', 7)]]),
    journalHits: new Map([['2026-10-06/ev', T('2026-10-06', 18)]]),
  };
  it('resolves blocks from sessions, grades and the journal, and counts full days, the streak and XP', () => {
    const p = planProgress(plan, states, ctx, T('2026-10-08', 6));
    expect(p.days[0].full).toBe(true);
    expect(p.days[1].full).toBe(true);
    expect(p.days[1].blocks.map((b) => b.done)).toEqual([true, true, true]);
    expect(p.days[2].state).toBe('today');
    expect(p.streak).toBe(2);
    expect(p.fullDays).toBe(2);
    expect(p.xp).toBe(100 + 40 + 50 + 50 + 100 + 40 + 50);
    expect(p.dayIndex).toBe(3);
    expect(p.daysToExam).toBe(19);
  });
  it('an optional block never holds a day back, and a day left undone breaks the streak', () => {
    const later = planProgress(plan, states, ctx, T('2026-10-26', 6));
    expect(later.days[2].state).toBe('missed');
    expect(later.streak).toBe(0);
    const withQuiz = planProgress(plan, [...states, { day: '2026-10-08', blockId: 'old', draw: [1], sessionId: 's4', doneAt: null }], { ...ctx, finishedSessions: new Map([...ctx.finishedSessions, ['s4', T('2026-10-08', 9)]]) }, T('2026-10-08', 10));
    expect(withQuiz.days[2].full).toBe(true);
    expect(withQuiz.streak).toBe(3);
  });
  it('a block started but not finished reads as started', () => {
    const p = planProgress(plan, [{ day: '2026-10-08', blockId: 'old', draw: [1, 3], sessionId: 's9', doneAt: null }], ctx, T('2026-10-08', 7));
    expect(p.days[2].blocks[0]).toMatchObject({ done: false, started: true });
  });
});

describe('exam summary and rewards', () => {
  it('sums points and losses by reading and cause', () => {
    const s = examSummary('pe1', items, grades);
    expect(s).toMatchObject({ questions: 3, graded: 3, points: 12, lost: 3 });
    expect(s.score).toBeCloseTo(0.75);
    expect(s.byReading[0]).toEqual({ reading: 'clark', points: 9, lost: 3 });
    expect(s.causes).toEqual([{ cause: 'did not know', count: 1 }, { cause: 'knew but slow', count: 1 }]);
  });
  it('earns rewards from the progress', () => {
    const states: BlockState[] = [{ day: '2026-10-06', blockId: 'exam', draw: [10, 9, 11], sessionId: 's1', doneAt: null }];
    const ctx = { finishedSessions: new Map([['s1', T('2026-10-06', 10)]]), gradedPapers: new Map<string, number>(), journalHits: new Map<string, number>() };
    const progress = planProgress(plan, states, ctx, T('2026-10-06', 11));
    const ids = earnedPlanRewards({ progress, exams: [], newDone: 0, newTotal: 3, missesRedone: 0, misses: 0 }).map((r) => r.id);
    expect(ids).toEqual(['plan:first-exam']);
  });
});
