// @vitest-environment jsdom
// canvasToolBlocks.test.ts — blocks other tools bring to pages.
//
// The canvas knows none of them: a tool registers a block while it runs
// (api.canvas.registerBlock) and it leaves the / menu when the tool stops;
// pages keep the block (one generic `toolBlock` node) and say which tool is
// needed. Then the Planner's Agenda and Worksheets' Practice Problems, each
// against fake data. (Atelier's gallery queries: moEmbedQueries.test.ts.)

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
import { CanvasBlocksBridge, getContributedBlocks, type CanvasBlockRegistration } from '../../src/api/bridges/canvasBlocksBridge';
import { CanvasMenuRegistry } from '../../src/built-in/canvas/menus/canvasMenuRegistry';
import { missingToolNote } from '../../src/built-in/canvas/extensions/toolBlockNode';
import { agendaWindow, buildAgenda, startOfDay, agendaTimeLabel, agendaBlock, type AgendaEventLike, type AgendaTaskLike } from '../../src/built-in/planner/plannerAgendaBlock';
import { describePractice, practiceTone, practiceBlock } from '../../src/built-in/worksheet/worksheetPracticeBlock';
import { selectEmbedProblems, embedFilterChoices, clampEmbedLimit, type EmbedItemLike } from '../../src/built-in/worksheet/worksheetEmbed';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';

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
  it('summary and tones', () => {
    expect(describePractice({ show: 'needsWork', paper: 'clark', tag: 'LDF' }, 'Clark')).toBe('Needs work · Clark · #LDF');
    expect(describePractice({ show: 'all' })).toBe('Problems');
    expect(practiceTone('Hard')).toBe('hard');
    expect(practiceTone('Not tried')).toBe('new');
  });
});


// ── The contribution hub ──

const subs: Array<{ dispose(): void }> = [];
function bridge(toolId = 'acme.tool', name = 'Acme') { const b = new CanvasBlocksBridge(toolId, name, subs); return b; }

function fakeBlock(over: Partial<CanvasBlockRegistration> = {}) {
  const calls = { render: 0, update: [] as unknown[], dispose: 0 };
  const reg: CanvasBlockRegistration = {
    typeId: 'acme.tool.list',
    label: 'Acme List',
    description: 'Things from Acme',
    icon: 'list',
    defaultConfig: { size: 'small' },
    settings: { title: 'Acme list', fields: { size: { type: 'enum', label: 'Size', options: [{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }] } } },
    readable: (c) => `[Acme list: ${String(c.size)}]`,
    render(body, ctx) {
      calls.render++;
      ctx.setTitle(`Acme (${String(ctx.config.size)})`);
      ctx.setActions([{ label: 'Open Acme', run: () => {} }]);
      body.textContent = `size=${String(ctx.config.size)}`;
      return { update: (c) => { calls.update.push(c); body.textContent = `size=${String(c.size)}`; }, dispose: () => { calls.dispose++; } };
    },
    ...over,
  };
  return { reg, calls };
}

afterEach(() => { for (const s of subs.splice(0)) s.dispose(); });

describe('blocks a tool registers', () => {
  it('must be named under the tool and complete', () => {
    const b = bridge();
    expect(() => b.registerBlock({ ...fakeBlock().reg, typeId: 'other.tool.list' })).toThrow(/must start with "acme.tool."/);
    expect(() => b.registerBlock({ ...fakeBlock().reg, label: '' })).toThrow(/needs a label/);
  });
  it('exist while the tool runs and go when it stops', () => {
    const b = bridge();
    const d = b.registerBlock(fakeBlock().reg);
    expect(getContributedBlocks().map((c) => [c.registration.typeId, c.ownerName])).toEqual([['acme.tool.list', 'Acme']]);
    d.dispose();
    expect(getContributedBlocks()).toEqual([]);
    b.registerBlock(fakeBlock().reg);
    b.dispose(); // the tool deactivated
    expect(getContributedBlocks()).toEqual([]);
  });
  it('another tool cannot take a block id', () => {
    bridge().registerBlock(fakeBlock().reg);
    const thief = new CanvasBlocksBridge('acme', 'Thief', subs);
    expect(() => thief.registerBlock({ ...fakeBlock().reg, typeId: 'acme.tool.list' })).toThrow(/already registered/);
  });
  it('the / menu lists them under "From your tools" only while the tool runs', () => {
    const menus = new CanvasMenuRegistry(() => null);
    const has = () => menus.getSlashMenuBlocks().some((b) => b.id === 'tool:acme.tool.list');
    expect(has()).toBe(false);
    const d = bridge().registerBlock(fakeBlock().reg);
    expect(has()).toBe(true);
    expect(menus.getSlashMenuBlocks().find((b) => b.id === 'tool:acme.tool.list')?.slashMenu?.category).toBe('tools');
    d.dispose();
    expect(has()).toBe(false);
    menus.dispose();
  });
  it('core canvas offers no block of any optional tool', () => {
    const menus = new CanvasMenuRegistry(() => null);
    const labels = menus.getSlashMenuBlocks().map((b) => b.label);
    for (const l of ['Agenda', 'Media Gallery', 'Practice Problems']) expect(labels).not.toContain(l);
    menus.dispose();
  });
});

// ── The block in a page ──

const lowlight = createLowlight(common);
let editors: Editor[] = [];
function mount(content: unknown[]): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = new Editor({ element, extensions: createEditorExtensions(lowlight, {}), content: { type: 'doc', content } });
  editors.push(ed);
  return ed;
}
afterEach(() => { for (const e of editors) e.destroy(); editors = []; document.body.innerHTML = ''; });
const settle = async (ms = 0) => { await new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const acmeNode = { type: 'toolBlock', attrs: { blockType: 'acme.tool.list', config: { size: 'small' }, from: 'Acme' } };

describe('a tool block in a page', () => {
  it('the tool draws the body; the canvas draws title, actions and Edit…', () => {
    const { reg, calls } = fakeBlock();
    bridge().registerBlock(reg);
    const ed = mount([acmeNode]);
    const dom = ed.view.dom;
    // ProseMirror may redraw the view once as the editor starts: every draw but the live one is disposed.
    expect(calls.render - calls.dispose).toBe(1);
    expect(dom.querySelector('.canvas-toolblock__title')?.textContent).toBe('Acme (small)');
    expect(dom.querySelector('.canvas-toolblock__body')?.textContent).toBe('size=small');
    expect([...dom.querySelectorAll('.canvas-toolblock__bar button')].map((b) => b.textContent)).toEqual(['Open Acme', 'Edit…']);
  });

  it('Edit… shows the tool\'s settings and stores the choice in the page (undoable)', async () => {
    const { reg, calls } = fakeBlock();
    bridge().registerBlock(reg);
    const ed = mount([acmeNode]);
    ed.view.dom.querySelector<HTMLButtonElement>('.canvas-toolblock__bar > button')!.click();
    await settle();
    const select = document.querySelector<HTMLSelectElement>('.canvas-live-popover select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Small', 'Large']);
    select.value = 'large';
    document.querySelector<HTMLButtonElement>('.canvas-live-popover__primary')!.click();
    expect((ed.getJSON().content![0] as any).attrs.config).toEqual({ size: 'large' });
    expect(calls.update).toEqual([{ size: 'large' }]);
    ed.commands.undo();
    expect((ed.getJSON().content![0] as any).attrs.config).toEqual({ size: 'small' });
  });

  it('with the tool turned off, the page keeps the block and says which tool it needs; on again, it is back', () => {
    const { reg, calls } = fakeBlock();
    const ed = mount([acmeNode, { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }]);
    const dom = ed.view.dom;
    expect(dom.querySelector('.canvas-toolblock__note')?.textContent).toBe(missingToolNote('Acme'));
    expect(dom.querySelector<HTMLElement>('.canvas-toolblock__bar > button')!.hidden).toBe(true);

    const d = bridge().registerBlock(reg); // the tool is turned on
    expect(calls.render - calls.dispose).toBe(1);
    expect(dom.querySelector('.canvas-toolblock__body')?.textContent).toBe('size=small');

    d.dispose(); // and off again
    expect(calls.render - calls.dispose).toBe(0);
    expect(dom.querySelector('.canvas-toolblock__note')?.textContent).toContain('Acme, which is turned off');
    expect(ed.getJSON().content![0]).toMatchObject(acmeNode); // nothing lost
  });

  it('a block that fails to draw says so instead of breaking the page', () => {
    bridge().registerBlock(fakeBlock({ render: () => { throw new Error('boom'); } }).reg);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ed = mount([acmeNode]);
    expect(ed.view.dom.querySelector('.canvas-toolblock__note')?.textContent).toBe('Acme could not show this block.');
    spy.mockRestore();
  });

  it('Markdown export and import keep it whole; readers see the tool\'s words, or which tool it needs', () => {
    const doc = { type: 'doc', content: [acmeNode] };
    const back = markdownToTiptapJson(tiptapJsonToMarkdown(doc)) as any;
    expect(back.content[0]).toMatchObject(acmeNode);
    expect(tiptapJsonToMarkdown(doc, undefined, { forReading: true })).toContain('[Block from Acme]');
    bridge().registerBlock(fakeBlock().reg);
    expect(tiptapJsonToMarkdown(doc, undefined, { forReading: true })).toContain('[Acme list: small]');
  });

  it('copy and paste carries the block and its settings', () => {
    const ed = mount([acmeNode]);
    const html = ed.getHTML();
    const ed2 = mount([{ type: 'paragraph' }]);
    ed2.commands.setContent(html);
    expect(ed2.getJSON().content![0]).toMatchObject(acmeNode);
  });
});

// ── A fake canvas frame for drawing a tool's block alone ──
function frame(config: Record<string, unknown>) {
  const body = document.createElement('div');
  const state = { title: '', actions: [] as string[], note: '' };
  const ctx = {
    config, editable: true, setConfig: vi.fn(),
    setTitle: (t: string) => { state.title = t; },
    setActions: (a: readonly { label: string }[]) => { state.actions = a.map((x) => x.label); },
    showNote: (t: string) => { state.note = t; body.textContent = t; },
  };
  return { body, ctx, state };
}

describe('Agenda (the Planner\'s block)', () => {
  it('lists today, ticks a task done in the planner, and redraws when the planner changes', async () => {
    const sod = startOfDay(Date.now());
    let tasks: AgendaTaskLike[] = [task('Write report', sod + 23 * HOUR)];
    const listeners = new Set<() => void>();
    const data = {
      listEvents: vi.fn(async () => [ev('Standup', sod + 1, sod + 2)]),
      listTasks: vi.fn(async (q: { dueTo?: number }) => tasks.filter((t) => t.dueAt !== null && t.dueAt <= (q.dueTo ?? Infinity) && t.dueAt >= sod)),
      updateTask: vi.fn(async (id: string, patch: { status?: string }) => { tasks = tasks.map((t) => (t.id === id ? { ...t, status: patch.status! } : t)); }),
      onDidChange: (fn: () => void) => { listeners.add(fn); return { dispose: () => { listeners.delete(fn); } }; },
    };
    const open = vi.fn();
    const reg = agendaBlock(data, open);
    expect(reg.typeId).toBe('parallx.planner.agenda');
    const { body, ctx, state } = frame({ range: 'today', show: 'all' });
    const handle = reg.render(body, ctx)!;
    await settle();
    expect(state.title).toBe('Today');
    expect(state.actions).toEqual(['Open Planner']);
    expect([...body.querySelectorAll('.planner-agenda__name')].map((n) => n.textContent)).toEqual(['Standup', 'Write report']);

    const box = body.querySelector<HTMLInputElement>('.planner-agenda__check')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(data.updateTask).toHaveBeenCalledWith('Write report', expect.objectContaining({ status: 'done' }));

    for (const l of listeners) l();
    await settle(300);
    expect(body.querySelector('.planner-agenda__item--done .planner-agenda__name')?.textContent).toBe('Write report');
    body.querySelector<HTMLButtonElement>('.planner-agenda__name')!.click();
    expect(open).toHaveBeenCalled();

    handle.update!({ range: 'tomorrow', show: 'all' });
    await settle();
    expect(state.title).toBe('Tomorrow');
    handle.dispose!();
    expect(listeners.size).toBe(0);
    expect(reg.readable!({ range: 'week' })).toBe('[Agenda: Next 7 days]');
  });
});

describe('Practice Problems (Worksheets\' block)', () => {
  it('lists problems with their state, opens one, and follows Worksheets changes', async () => {
    let items: EmbedItemLike[] = [
      item(3, { title: 'Mack reserve', paper: 'mack1994', attemptState: 'hard', starred: true }),
      item(2, { title: 'Clark LDF', attemptState: 'medium' }),
    ];
    const listeners = new Set<() => void>();
    const openProblem = vi.fn();
    const reg = practiceBlock({
      listItems: async () => items,
      onDidChange: (fn) => { listeners.add(fn); return { dispose: () => { listeners.delete(fn); } }; },
      openProblem, openBank: vi.fn(),
    });
    expect(reg.typeId).toBe('parallx.worksheet.practice');
    const { body, ctx, state } = frame({ show: 'needsWork', paper: '', tag: '', limit: 5 });
    const handle = reg.render(body, ctx)!;
    await settle();
    expect(state.title).toBe('Needs work');
    const rows = [...body.querySelectorAll<HTMLButtonElement>('.ws-practice__row')];
    expect(rows.map((r) => r.querySelector('.ws-practice__name')?.textContent)).toEqual(['★ Mack reserve', 'Clark LDF']);
    expect(rows[0].querySelector('.ws-practice__state--hard')?.textContent).toBe('Hard');
    rows[1].click();
    expect(openProblem).toHaveBeenCalledWith(2, 'Clark LDF');

    const paperField = reg.settings!.fields.paper.options as () => Promise<Array<{ label: string }>>;
    expect((await paperField()).map((o) => o.label)).toEqual(['Any paper', 'Clark', 'Mack (1994)']);

    items = [];
    for (const l of listeners) l();
    await settle(450);
    expect(state.note).toBe('Nothing needs work here. Well done.');
    handle.dispose!();
    expect(listeners.size).toBe(0);
  });
});
