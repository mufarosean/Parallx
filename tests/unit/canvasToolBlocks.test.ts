// @vitest-environment jsdom
// canvasToolBlocks.test.ts — blocks that show another tool's data: Agenda
// (planner), Media Gallery (Media Organizer), Practice Problems (Worksheets).
// What each picks and in what order, the real Media Organizer queries on its
// own migrations (moEmbedQueries.test.ts), and each block working in a real editor against fake tools
// (and saying so when the tool is not there).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
import { agendaWindow, buildAgenda, startOfDay, agendaTimeLabel, type AgendaEventLike, type AgendaTaskLike } from '../../src/built-in/canvas/extensions/plannerAgendaNode';
import { clampGalleryLimit, galleryLabel } from '../../src/built-in/canvas/extensions/mediaGalleryNode';
import { PRACTICE_SHOWS, describePractice, practiceTone } from '../../src/built-in/canvas/extensions/practiceProblemsNode';
import { selectEmbedProblems, embedFilterChoices, EMBED_SHOW, clampEmbedLimit, type EmbedItemLike } from '../../src/built-in/worksheet/worksheetEmbed';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';
import type { LiveBlockServices } from '../../src/built-in/canvas/extensions/liveBlock';

const HOUR = 3_600_000;
// Wednesday 2026-10-07, 10:30 local.
const NOW = new Date(2026, 9, 7, 10, 30).getTime();
const TODAY = startOfDay(NOW);
const at = (dayOffset: number, hour: number, min = 0) => new Date(2026, 9, 7 + dayOffset, hour, min).getTime();

const ev = (id: string, startAt: number, endAt: number, allDay = false): AgendaEventLike => ({ id, title: id, startAt, endAt, allDay, color: null });
const task = (id: string, dueAt: number | null, status = 'planned'): AgendaTaskLike => ({ id, title: id, status, dueAt, color: null });

describe('Agenda: the window', () => {
  it('today, tomorrow and the next seven days, from local midnight', () => {
    expect(agendaWindow('today', NOW)).toEqual({ from: TODAY, to: at(1, 0) - 1, days: 1 });
    expect(agendaWindow('tomorrow', NOW)).toEqual({ from: at(1, 0), to: at(2, 0) - 1, days: 1 });
    expect(agendaWindow('week', NOW)).toEqual({ from: TODAY, to: at(7, 0) - 1, days: 7 });
    expect(agendaWindow('nonsense', NOW).days).toBe(1);
  });
});

describe('Agenda: what shows, in what order', () => {
  it('all-day events, then timed by start, then tasks; overdue tasks first among tasks', () => {
    const days = buildAgenda(
      [ev('lunch', at(0, 12), at(0, 13)), ev('standup', at(0, 9), at(0, 9, 15)), ev('holiday', TODAY, at(1, 0), true)],
      [task('report', at(0, 17)), task('late', at(-2, 9)), task('tomorrow-task', at(1, 9))],
      'today', 'all', NOW,
    );
    expect(days).toHaveLength(1);
    expect(days[0].items.map((i) => i.id)).toEqual(['holiday', 'standup', 'lunch', 'late', 'report']);
    const late = days[0].items.find((i) => i.id === 'late')!;
    expect(late.kind === 'task' && late.overdue).toBe(true);
    expect(agendaTimeLabel(late)).toMatch(/^Due /);
  });

  it('done tasks stay (ticked) on their day; overdue done, cancelled and undated ones do not show', () => {
    const days = buildAgenda([], [
      task('done-today', at(0, 9), 'done'), task('done-late', at(-1, 9), 'done'),
      task('cancelled', at(0, 11), 'cancelled'), task('undated', null),
    ], 'today', 'all', NOW);
    expect(days[0].items.map((i) => i.id)).toEqual(['done-today']);
    const it0 = days[0].items[0];
    expect(it0.kind === 'task' && it0.done).toBe(true);
  });

  it('overdue tasks are not carried into Tomorrow', () => {
    const days = buildAgenda([], [task('late', at(-2, 9)), task('t', at(1, 8))], 'tomorrow', 'all', NOW);
    expect(days.flatMap((d) => d.items.map((i) => i.id))).toEqual(['t']);
  });

  it('a week groups by day, leaves empty days out, and a multi-day event shows on each day', () => {
    const days = buildAgenda(
      [ev('trip', at(2, 8), at(4, 18)), ev('outside', at(9, 8), at(9, 9))],
      [task('fri', at(2, 12)), task('far', at(12, 9))],
      'week', 'all', NOW,
    );
    expect(days.map((d) => d.start)).toEqual([at(2, 0), at(3, 0), at(4, 0)]);
    expect(days[0].items.map((i) => i.id)).toEqual(['trip', 'fri']);
    expect(days[1].items.map((i) => i.id)).toEqual(['trip']);
    expect(days[2].items.map((i) => i.id)).toEqual(['trip']);
  });

  it('an event ending exactly at midnight does not spill onto the next day', () => {
    const days = buildAgenda([ev('late-show', at(0, 22), at(1, 0))], [], 'week', 'all', NOW);
    expect(days.map((d) => d.start)).toEqual([TODAY]);
  });

  it('an event that began before the window shows from its first day', () => {
    const days = buildAgenda([ev('course', at(-3, 9), at(1, 17))], [], 'today', 'all', NOW);
    expect(days[0].items.map((i) => i.id)).toEqual(['course']);
  });

  it('Include: events only / tasks only', () => {
    const events = [ev('e', at(0, 9), at(0, 10))];
    const tasks = [task('t', at(0, 12))];
    expect(buildAgenda(events, tasks, 'today', 'events', NOW)[0].items.map((i) => i.id)).toEqual(['e']);
    expect(buildAgenda(events, tasks, 'today', 'tasks', NOW)[0].items.map((i) => i.id)).toEqual(['t']);
    expect(buildAgenda([], [], 'today', 'all', NOW)).toEqual([]);
  });

  it('time labels: all day, or start to end', () => {
    expect(agendaTimeLabel({ kind: 'event', id: 'a', title: 'a', allDay: true, startAt: TODAY, endAt: TODAY + 24 * HOUR, color: null })).toBe('All day');
    expect(agendaTimeLabel({ kind: 'event', id: 'a', title: 'a', allDay: false, startAt: at(0, 9), endAt: at(0, 10), color: null })).toMatch(/9.*–.*10/);
  });
});

const item = (id: number, over: Partial<EmbedItemLike> = {}): EmbedItemLike => ({
  id, title: `P${id}`, paper: 'clark', tags: '', attemptState: '', attemptCount: 0, lastAttemptAt: 0, starred: false, ...over,
});

describe('Practice Problems: which problems', () => {
  const bank = [
    item(1, { attemptState: 'hard', lastAttemptAt: 300, tags: 'LDF, Reserving' }),
    item(2, { attemptState: 'medium', lastAttemptAt: 100 }),
    item(3, { attemptState: 'hard', lastAttemptAt: 50, paper: 'mack1994' }),
    item(4, { attemptState: 'easy', starred: true, tags: 'reserving' }),
    item(5, { attemptState: 'open' }),
    item(6, { title: '' }),
  ];

  it('Needs work: Hard before Medium, longest untouched first', () => {
    expect(selectEmbedProblems(bank, { show: 'needsWork' }).map((p) => p.id)).toEqual([3, 1, 2]);
  });
  it('Not tried yet excludes worked and in-progress problems', () => {
    expect(selectEmbedProblems(bank, { show: 'new' }).map((p) => p.id)).toEqual([6]);
  });
  it('Starred, paper and tag (any case, whole tag) narrow the list', () => {
    expect(selectEmbedProblems(bank, { show: 'starred' }).map((p) => p.id)).toEqual([4]);
    expect(selectEmbedProblems(bank, { paper: 'MACK1994' }).map((p) => p.id)).toEqual([3]);
    expect(selectEmbedProblems(bank, { tag: 'Reserving' }).map((p) => p.id)).toEqual([1, 4]);
    expect(selectEmbedProblems(bank, { tag: 'Reserv' })).toEqual([]);
  });
  it('states read as words, papers by name, untitled problems get a name', () => {
    const all = selectEmbedProblems(bank, { show: 'all', limit: 10 });
    expect(all.map((p) => p.state)).toEqual(['Hard', 'Medium', 'Hard', 'Easy', 'In progress', 'Not tried']);
    expect(all[2].paper).toBe('Mack (1994)');
    expect(all[5].title).toBe('Untitled problem');
  });
  it('limit: default 5, at most 25', () => {
    expect(selectEmbedProblems(bank, {}).length).toBe(5);
    expect(clampEmbedLimit(1000)).toBe(25);
    expect(clampEmbedLimit('x')).toBe(5);
  });
  it('the Edit… choices: papers by name and every tag once', () => {
    const c = embedFilterChoices(bank);
    expect(c.papers).toEqual([{ value: 'clark', label: 'Clark' }, { value: 'mack1994', label: 'Mack (1994)' }]);
    expect(c.tags).toEqual(['LDF', 'reserving', 'Reserving']);
  });
  it('the block offers the same Show choices Worksheets answers', () => {
    expect(PRACTICE_SHOWS).toEqual(EMBED_SHOW);
  });
  it('summary and tones', () => {
    expect(describePractice({ show: 'needsWork', paper: 'clark', tag: 'LDF' }, 'Clark')).toBe('Needs work · Clark · #LDF');
    expect(describePractice({ show: 'all' })).toBe('Problems');
    expect(practiceTone('Hard')).toBe('hard');
    expect(practiceTone('Not tried')).toBe('new');
  });
});

describe('Media Gallery: helpers', () => {
  it('limit and label', () => {
    expect(clampGalleryLimit(undefined)).toBe(12);
    expect(clampGalleryLimit(500)).toBe(60);
    expect(galleryLabel('', null)).toBe('Newest photos and videos');
    expect(galleryLabel('7', [{ id: '7', title: 'Studies' }])).toBe('Studies');
  });
});

// ── The blocks in a real editor, against fake tools ──
const lowlight = createLowlight(common);

function fakeLive(commands: Record<string, (...args: any[]) => unknown>): LiveBlockServices & { calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  return {
    calls,
    onDidChangeWorkspace: () => ({ dispose() {} }),
    openPage: () => {},
    async executeCommand(id: string, ...args: unknown[]) {
      calls.push([id, args]);
      const fn = commands[id];
      if (!fn) throw new Error(`Unknown command: ${id}`);
      return fn(...args);
    },
  };
}

let editors: Editor[] = [];
function mount(live: LiveBlockServices, node: unknown): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = new Editor({ element, extensions: createEditorExtensions(lowlight, { live } as any), content: { type: 'doc', content: [node] } });
  editors.push(ed);
  return ed;
}
afterEach(() => { for (const e of editors) e.destroy(); editors = []; document.body.innerHTML = ''; vi.useRealTimers(); });
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

describe('Agenda block in the editor', () => {
  it('lists today, ticks a task done through the planner, and redraws when the planner changes', async () => {
    const now = Date.now();
    const sod = startOfDay(now);
    let tasks: AgendaTaskLike[] = [task('Write report', sod + 23 * HOUR)];
    const listeners = new Set<() => void>();
    const data = {
      listEvents: vi.fn(async () => [ev('Standup', sod + 1, sod + 2)]),
      listTasks: vi.fn(async (q: { dueTo?: number }) => tasks.filter((t) => t.dueAt !== null && t.dueAt <= (q.dueTo ?? Infinity) && t.dueAt >= sod)),
      updateTask: vi.fn(async (id: string, patch: { status?: string }) => { tasks = tasks.map((t) => (t.id === id ? { ...t, status: patch.status! } : t)); }),
      onDidChange: (fn: () => void) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
    };
    const live = fakeLive({ 'planner.getRegistry': () => ({ data }), 'planner.open': () => {} });
    const ed = mount(live, { type: 'plannerAgenda', attrs: { range: 'today', show: 'all' } });
    await settle();
    const dom = ed.view.dom;
    expect([...dom.querySelectorAll('.canvas-agenda__name')].map((n) => n.textContent)).toEqual(['Standup', 'Write report']);
    expect(dom.querySelector('.canvas-agenda__title')?.textContent).toBe('Today');

    const box = dom.querySelector<HTMLInputElement>('.canvas-agenda__check')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(data.updateTask).toHaveBeenCalledWith('Write report', expect.objectContaining({ status: 'done' }));

    // The planner announces the change; the block re-reads (after a short settle).
    const before = data.listTasks.mock.calls.length;
    for (const l of listeners) l();
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(data.listTasks.mock.calls.length).toBeGreaterThan(before);
    expect(dom.querySelector('.canvas-agenda__item--done .canvas-agenda__name')?.textContent).toBe('Write report');

    dom.querySelector<HTMLButtonElement>('.canvas-agenda__name')!.click();
    await settle();
    expect(live.calls.some(([id]) => id === 'planner.open')).toBe(true);

    // Removing the block stops listening.
    ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(listeners.size).toBe(0);
  });

  it('says so when there is no planner', async () => {
    const ed = mount(fakeLive({}), { type: 'plannerAgenda', attrs: { range: 'week', show: 'all' } });
    await settle();
    expect(ed.view.dom.querySelector('.canvas-agenda__note')?.textContent).toBe('The planner is not available.');
  });

  it('survives Markdown export and import with its settings', () => {
    const doc = { type: 'doc', content: [{ type: 'plannerAgenda', attrs: { range: 'week', show: 'tasks' } }] };
    const md = tiptapJsonToMarkdown(doc);
    expect(tiptapJsonToMarkdown(doc, undefined, { forReading: true })).toContain('[Agenda: Next 7 days]');
    const back = markdownToTiptapJson(md) as any;
    expect(back.content[0]).toMatchObject({ type: 'plannerAgenda', attrs: { range: 'week', show: 'tasks' } });
  });
});

describe('Media Gallery block in the editor', () => {
  const items = [
    { type: 'photo', id: 1, title: 'Sketch', thumbUrl: 'blob:one' },
    { type: 'video', id: 2, title: 'Timelapse', thumbUrl: null },
  ];
  it('shows thumbnails, names the album, and opens the clicked one in the viewer', async () => {
    const live = fakeLive({
      'media-organizer.embed.listAlbums': () => [{ id: '9', title: 'Studies' }],
      'media-organizer.embed.listItems': () => items,
      'media-organizer.embed.open': () => {},
    });
    const ed = mount(live, { type: 'mediaGallery', attrs: { albumId: '9', limit: 6 } });
    await settle();
    const dom = ed.view.dom;
    expect(live.calls.find(([id]) => id === 'media-organizer.embed.listItems')?.[1][0]).toEqual({ albumId: '9', limit: 6 });
    expect(dom.querySelector('.canvas-gallery__title')?.textContent).toBe('Studies');
    const tiles = [...dom.querySelectorAll<HTMLButtonElement>('.canvas-gallery__tile')];
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector('img')?.getAttribute('src')).toBe('blob:one');
    expect(tiles[1].textContent).toContain('Video');
    tiles[1].click();
    await settle();
    expect(live.calls.find(([id]) => id === 'media-organizer.embed.open')?.[1][0]).toEqual({ items: [{ type: 'photo', id: 1 }, { type: 'video', id: 2 }], index: 1 });
  });

  it('a deleted album, an empty library, and no Media Organizer each say so', async () => {
    const gone = mount(fakeLive({ 'media-organizer.embed.listAlbums': () => [], 'media-organizer.embed.listItems': () => [] }), { type: 'mediaGallery', attrs: { albumId: '4', limit: 12 } });
    const empty = mount(fakeLive({ 'media-organizer.embed.listAlbums': () => [], 'media-organizer.embed.listItems': () => [] }), { type: 'mediaGallery', attrs: { albumId: '', limit: 12 } });
    const none = mount(fakeLive({}), { type: 'mediaGallery', attrs: { albumId: '', limit: 12 } });
    await settle();
    expect(gone.view.dom.querySelector('.canvas-gallery__note')?.textContent).toContain('album was deleted');
    expect(empty.view.dom.querySelector('.canvas-gallery__note')?.textContent).toBe('No photos or videos yet.');
    expect(none.view.dom.querySelector('.canvas-gallery__note')?.textContent).toBe('Media Organizer is not available.');
  });

  it('a tool that starts after the page is opened is picked up', async () => {
    vi.useFakeTimers();
    const commands: Record<string, (...a: any[]) => unknown> = {};
    const ed = mount(fakeLive(commands), { type: 'mediaGallery', attrs: { albumId: '', limit: 12 } });
    await vi.advanceTimersByTimeAsync(10);
    expect(ed.view.dom.querySelector('.canvas-gallery__note')?.textContent).toBe('Media Organizer is not available.');
    commands['media-organizer.embed.listAlbums'] = () => [];
    commands['media-organizer.embed.listItems'] = () => items;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ed.view.dom.querySelectorAll('.canvas-gallery__tile')).toHaveLength(2);
  });
});

describe('Practice Problems block in the editor', () => {
  it('lists problems with their state, opens one, and follows Worksheets changes', async () => {
    let problems = [
      { id: 3, title: 'Mack reserve', paper: 'Mack (1994)', state: 'Hard', starred: true },
      { id: 2, title: 'Clark LDF', paper: 'Clark', state: 'Medium', starred: false },
    ];
    const listeners = new Set<() => void>();
    const live = fakeLive({
      'worksheet.embed.listProblems': () => problems,
      'worksheet.embed.filterChoices': () => ({ papers: [{ value: 'clark', label: 'Clark' }], tags: [] }),
      'worksheet.embed.onDidChange': (fn: () => void) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
      'worksheet.openProblem': () => {},
    });
    const ed = mount(live, { type: 'practiceProblems', attrs: { show: 'needsWork', paper: 'clark', tag: '', limit: 5 } });
    await settle();
    const dom = ed.view.dom;
    expect(live.calls.find(([id]) => id === 'worksheet.embed.listProblems')?.[1][0]).toEqual({ show: 'needsWork', paper: 'clark', tag: '', limit: 5 });
    expect(dom.querySelector('.canvas-practice__title')?.textContent).toBe('Needs work · Clark');
    const rows = [...dom.querySelectorAll<HTMLButtonElement>('.canvas-practice__row')];
    expect(rows.map((r) => r.querySelector('.canvas-practice__name')?.textContent)).toEqual(['★ Mack reserve', 'Clark LDF']);
    expect(rows[0].querySelector('.canvas-practice__state--hard')?.textContent).toBe('Hard');
    rows[1].click();
    await settle();
    expect(live.calls.find(([id]) => id === 'worksheet.openProblem')?.[1]).toEqual([2]);

    expect(listeners.size).toBe(1);
    problems = [];
    for (const l of listeners) l();
    await new Promise((r) => setTimeout(r, 450));
    await settle();
    expect(dom.querySelector('.canvas-practice__note')?.textContent).toBe('Nothing needs work here. Well done.');

    ed.destroy();
    editors = editors.filter((e) => e !== ed);
    expect(listeners.size).toBe(0);
  });

  it('says so when Worksheets is not there', async () => {
    const ed = mount(fakeLive({}), { type: 'practiceProblems', attrs: { show: 'all', paper: '', tag: '', limit: 5 } });
    await settle();
    expect(ed.view.dom.querySelector('.canvas-practice__note')?.textContent).toBe('Worksheets is not available.');
  });
});
