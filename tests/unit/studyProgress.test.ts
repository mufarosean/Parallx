// @vitest-environment jsdom
// studyProgress.test.ts — Study's Progress over the generated main.js: the
// providers as they are now (ext/study/src/28-progress.js), a session limited
// to one last result (27-subjects.js), the tab (63-progress-view.js) and the
// sidebar's thin bar, against SQLite with every migration, a stand-in for the
// core's door that keeps its databases in memory, the core's own progress
// registry, and the kit as the app has it.
//
// What is held here: Study reads no provider until something shows progress,
// reads one again when it says its counts changed, drops one whose tool went,
// and listens to none once it is off; a unit's bar per kind with the names a
// screen reader speaks; a part of a Questions bar runs the unit's setup on
// that state and a tool's part its own open; the tab follows a change
// without being reopened; and the cases with nothing to draw say what is so.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { progressProviderRegistry, type IProgressGroup, type IProgressProvider } from '../../src/services/progressProviders.js';
import { createUiApi } from '../../src/api/bridges/uiBridge.js';
import { installKitCommands } from '../../src/ui/kit.js';
import { scene } from '../../src/ui/scene.js';

// Node's built-in SQLite through require: the jsdom environment does not bundle node: modules.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const NAMES = [
  '__testables', '_stSubjects', 'stCreateSubject', 'stSubjectEnqueue', 'stSubjectFlush', 'stSubjectsReset', 'stSubjectScope', 'stFixedScopeQuestions', 'stCountScopeQuestions',
  'registerProgress', 'stProgressReset', 'stProgressWant', 'stProgressProviders', 'stProgressOfSubject', 'stProgressOpenItems', 'stCmdOpenProgress', 'stCmdStudySubject',
  'createEditorPane', 'createSidebarView', 'stSubjectMenuItems', 'stSubjectsShown', 'stRouteFromInstanceId', 'stRouteInstanceId', 'stRouteTitle', 'bus',
];
const MIGRATIONS = join(__dirname, '../../ext/study/db/migrations');
const MANIFEST = JSON.parse(readFileSync(join(__dirname, '../../ext/study/parallx-manifest.json'), 'utf8'));

type Row = { pageId: string; title: string; values: Record<string, unknown> };
type Col = { id: string; name: string; type: string; config: Record<string, unknown> };
type Db = { id: string; title: string; columns: Col[]; rows: Row[]; trashed?: boolean };
type Any = Record<string, any>;

/** The core's door for canvas databases, in memory: values by column name, a change event after every write. */
function fakeDoor() {
  const dbs = new Map<string, Db>();
  const listeners = new Map<string, Set<(e: { kind: string }) => void>>();
  let n = 0;
  const id = (p: string) => `${p}-${String(++n).padStart(6, '0')}`;
  const fire = (dbId: string, kind: string) => { for (const l of [...(listeners.get(dbId) || [])]) l({ kind }); };
  const need = (dbId: string) => { const d = dbs.get(dbId); if (!d) throw new Error(`Database not found: ${dbId}`); return d; };
  const nameOf = (d: Db, name: string) => { const c = d.columns.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!c) throw new Error(`no column ${name}`); return c.name; };
  const TITLE: Col = { id: 'title', name: 'Name', type: 'title', config: {} };
  const door = {
    list: async () => [...dbs.values()].filter((d) => !d.trashed).map((d) => ({ id: d.id, title: d.title })),
    get: async (dbId: string) => { const d = dbs.get(dbId); return d ? { id: d.id, title: d.title, pageId: d.id, parentPageId: null, columns: [TITLE, ...d.columns.map((c) => ({ ...c }))], trashed: !!d.trashed } : null; },
    create: async (o: { title: string; columns?: Any[] }) => {
      const d: Db = { id: id('db'), title: o.title, columns: (o.columns || []).map((s) => ({ id: id('col'), name: s.name, type: s.type, config: { ...(s.config || {}) } })), rows: [] };
      dbs.set(d.id, d);
      return door.get(d.id);
    },
    createPage: async () => ({ id: id('page') }),
    ensureColumns: async (dbId: string, specs: Any[]) => {
      const d = need(dbId);
      for (const s of specs) if (!d.columns.some((c) => c.name.toLowerCase() === String(s.name).toLowerCase())) { d.columns.push({ id: id('col'), name: s.name, type: s.type, config: { ...(s.config || {}) } }); fire(dbId, 'columns'); }
      return [TITLE, ...d.columns];
    },
    listRows: async (dbId: string) => (need(dbId).trashed ? [] : need(dbId).rows).map((r) => ({ pageId: r.pageId, title: r.title, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== null && v !== undefined && v !== '')) })),
    addRow: async (dbId: string, row: { title: string; values?: Record<string, unknown> }) => {
      const d = need(dbId); const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row.values || {})) values[nameOf(d, k)] = v;
      const made = { pageId: id('row'), title: row.title, values };
      d.rows.push(made); fire(dbId, 'rows');
      return { ...made, values: { ...values } };
    },
    updateRow: async (dbId: string, pageId: string, patch: { title?: string; values?: Record<string, unknown> }) => {
      const d = need(dbId); const r = d.rows.find((x) => x.pageId === pageId);
      if (!r) throw new Error('Row not found');
      for (const [k, v] of Object.entries(patch.values || {})) r.values[nameOf(d, k)] = v;
      if (patch.title !== undefined) r.title = patch.title;
      fire(dbId, 'cells');
    },
    onDidChange: (dbId: string, l: (e: { kind: string }) => void) => { if (!listeners.has(dbId)) listeners.set(dbId, new Set()); listeners.get(dbId)!.add(l); return { dispose: () => listeners.get(dbId)!.delete(l) }; },
    open: vi.fn(async () => {}),
  };
  /** What the person does in a table: the same store, the same events. */
  const person = {
    database: (title: string, columns: { name: string; type: string }[], rows: { title: string; values: Record<string, unknown> }[]) => {
      const d: Db = { id: id('db'), title, columns: columns.map((c) => ({ id: id('col'), name: c.name, type: c.type, config: {} })), rows: rows.map((r) => ({ pageId: id('row'), title: r.title, values: { ...r.values } })) };
      dbs.set(d.id, d);
      return d;
    },
    edit: (d: Db, title: string, values: Record<string, unknown>) => { Object.assign(d.rows.find((x) => x.title === title)!.values, values); fire(d.id, 'cells'); },
    add: (d: Db, title: string, values: Record<string, unknown>) => { d.rows.push({ pageId: id('row'), title, values }); fire(d.id, 'rows'); },
    trash: (d: Db) => { d.trashed = true; fire(d.id, 'rows'); },
  };
  return { door, person, byTitle: (t: string) => [...dbs.values()].find((d) => d.title === t)! };
}

function loadStudy(): Any {
  const src = readFileSync(join(__dirname, '../../ext/study/main.js'), 'utf8').replace(/^export\s+(?=(?:async\s+)?function|const|let)/gm, '');
  return new Function(`'use strict';\n${src}\nreturn { ${NAMES.map((x) => `${x}: typeof ${x} === 'undefined' ? undefined : ${x}`).join(', ')} };`)() as Any;
}

/** A tool's provider the test holds the strings of: its groups, its event, how often it was read. */
function tool(id: string, kind: string, groups: IProgressGroup[], { open = false } = {}) {
  const listeners = new Set<() => void>();
  const state = { groups, reads: 0, opened: [] as unknown[][] };
  const provider: IProgressProvider = {
    id, displayName: kind, toolId: 'test.tool',
    words: { good: 'Easy', middling: 'Medium', poor: 'Hard', rest: 'Not rated' },
    groups: async () => { state.reads += 1; return state.groups.map((g) => ({ ...g })); },
    onDidChange: (l) => { listeners.add(l); return { dispose: () => { listeners.delete(l); } }; },
    ...(open ? { open: async (group: string, s: string) => { state.opened.push([group, s]); return true; } } : {}),
  };
  return { provider, state, listeners, set(next: IProgressGroup[]) { state.groups = next; for (const l of [...listeners]) l(); } };
}
const g = (label: string, total: number, good = 0, middling = 0, poor = 0, group = label.toLowerCase()): IProgressGroup => ({ group, label, total, good, middling, poor });

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, what: string, ms = 5000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(10);
  }
}

let cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.reverse()) { try { fn(); } catch { /* already gone */ } } cleanup = []; document.body.innerHTML = ''; scene.reset(); });

function harness() {
  const S = loadStudy();
  const sql = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) sql.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  const wrap = (fn: () => object) => { try { return { error: null, ...fn() }; } catch (e: any) { return { error: { message: e.message } }; } };
  const fake = fakeDoor();
  const settings: Record<string, unknown> = {};
  const calls = { commands: [] as { id: string; args: unknown[] }[], opened: [] as Any[], focused: [] as string[], picks: [] as Any[] };
  const editors: Any[] = [];
  const handlers = new Map<string, (...a: any[]) => any>();
  const api: Any = {
    database: {
      get: async (q: string, p: unknown[] = []) => wrap(() => ({ row: sql.prepare(q).get(...(p as any[])) ?? null })),
      all: async (q: string, p: unknown[] = []) => wrap(() => ({ rows: sql.prepare(q).all(...(p as any[])) })),
      run: async (q: string, p: unknown[] = []) => wrap(() => { const r = sql.prepare(q).run(...(p as any[])); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }),
    },
    workspace: {
      getConfiguration: () => ({ get: (k: string, f: unknown) => (k in settings ? settings[k] : f), update: async (k: string, v: unknown) => { settings[k] = v; } }),
      workspaceFolders: [{ uri: 'file:///ws', name: 'ws' }], fs: { readdir: async () => [] },
    },
    canvas: { databases: fake.door },
    commands: {
      executeCommand: async (id: string, ...args: unknown[]) => {
        calls.commands.push({ id, args });
        if (id === 'progress.getRegistry') return progressProviderRegistry;
        const h = handlers.get(id);
        return h ? h(...args) : undefined;
      },
    },
    editors: {
      get openEditors() { return editors; },
      openEditor: async (o: Any) => { calls.opened.push(o); editors.push({ id: `parallx-community.study:study:${o.instanceId}`, ...o }); },
      focusEditor: async (id: string) => { calls.focused.push(id); },
      closeEditor: async () => {},
    },
    window: {
      showQuickPick: async (items: Any[], opts: Any) => { calls.picks.push({ items, opts }); return items[1]; },
      showInformationMessage: async () => undefined, showWarningMessage: async () => undefined,
    },
    icons: { hasIcon: () => true, createIconHtml: () => '' },
    ui: createUiApi(),
  };
  installKitCommands({ executeCommand: (id: string, ...args: unknown[]) => api.commands.executeCommand(id, ...args) });
  S.__testables.__setApi(api);
  const context = { subscriptions: [] as { dispose(): void }[] };
  cleanup.push(() => { for (const d of context.subscriptions) d.dispose(); S.stProgressReset(); S.stSubjectsReset(); });
  const settle = async () => { for (let i = 0; i < 4; i++) for (const st of [...S._stSubjects.values()]) await S.stSubjectEnqueue(st, () => S.stSubjectFlush(st)); };
  const register = (t: ReturnType<typeof tool>) => { const d = progressProviderRegistry.register(t.provider); cleanup.push(() => d.dispose()); return d; };
  return { S, api, calls, settings, context, handlers, settle, register, ...fake };
}

const BANK_COLUMNS = [{ name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select' }, { name: 'Times Attempted', type: 'number' }, { name: 'Times Correct', type: 'number' }, { name: 'Last Result', type: 'select' }];
type BankRow = { title: string; values: Record<string, unknown> };
const q = (paper: string, n: number, result = ''): BankRow => ({ title: `Q${n} about ${paper}?`, values: { 'Model Answer': `A${n}`, Paper: paper, ...(result ? { 'Times Attempted': 1, 'Last Result': result } : {}) } });
// Mack: 2 right, 1 partly, 1 wrong, 1 not yet. Clark: 1 wrong, 1 not yet. Venter: 2 right.
const BANK_ROWS = [q('Mack', 1, 'Right'), q('Mack', 2, 'Right'), q('Mack', 3, 'Partly'), q('Mack', 4, 'Wrong'), q('Mack', 5), q('Clark', 6, 'Wrong'), q('Clark', 7), q('Venter', 8, 'Right'), q('Venter', 9, 'Right')];

async function subject(rows: BankRow[] = BANK_ROWS) {
  const h = harness();
  const bank = h.person.database('Conceptual Questions', BANK_COLUMNS, rows);
  const made = await h.S.stCreateSubject({ name: 'Exam 7', questionsDb: bank.id });
  await h.settle();
  return { ...h, bank, subject: made, units: h.byTitle('Units') };
}
async function started(h: Awaited<ReturnType<typeof subject>>) {
  h.S.registerProgress(h.context);
  await until(() => h.calls.commands.some((c) => c.id === 'progress.getRegistry'), 'the registry request');
  await wait(0);
}
function tab(h: Awaited<ReturnType<typeof subject>>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const pane = h.S.createEditorPane(host, { instanceId: `progress-${h.subject.id}`, id: `parallx-community.study:study:progress-${h.subject.id}` });
  cleanup.push(() => pane.dispose());
  return Object.assign(host, { close: () => { pane.dispose(); host.remove(); } });
}
const barsIn = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.px-stacked-bar')].map((b) => b.getAttribute('aria-label') || '');
const rowNames = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.st-prog__row:not(.st-prog__row--head) .st-prog__name')].map((b) => b.textContent!.trim());
const part = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLElement>('.px-stacked-bar__part')].find((p) => (p.getAttribute('aria-label') || p.title) === name);

describe('the providers as they are now', () => {
  it('reads no provider until something shows progress, then each once', async () => {
    const h = await subject();
    const problems = tool('test.problems', 'Problems', [g('Clark', 10, 3, 1, 2)]);
    h.register(problems);
    await started(h);
    expect(problems.listeners.size).toBe(1);
    await wait(40);
    expect(problems.state.reads).toBe(0);
    expect(h.S.stProgressProviders()).toEqual([{ id: 'test.problems', kind: 'Problems', words: problems.provider.words, canOpen: false, groups: [] }]);
    h.S.stProgressWant();
    h.S.stProgressWant();
    await until(() => h.S.stProgressProviders()[0].groups.length, 'the groups');
    expect(problems.state.reads).toBe(1);
    expect(h.S.stProgressProviders()[0].groups).toEqual([g('Clark', 10, 3, 1, 2)]);
  });

  it('reads a provider again when it says its counts changed, and tells whoever shows progress', async () => {
    const h = await subject();
    const problems = tool('test.problems', 'Problems', [g('Clark', 10, 3, 1, 2)]);
    h.register(problems);
    await started(h);
    h.S.stProgressWant();
    await until(() => problems.state.reads === 1, 'the first read');
    const heard = vi.fn();
    cleanup.push(h.S.bus.on('progress', heard));
    problems.set([g('Clark', 10, 4, 1, 2)]);
    await until(() => h.S.stProgressProviders()[0].groups[0].good === 4, 'the new counts');
    expect(problems.state.reads).toBe(2);
    expect(heard).toHaveBeenCalled();
  });

  it('takes in a provider registered later, and drops one whose tool went, with its listener', async () => {
    const h = await subject();
    await started(h);
    h.S.stProgressWant();
    const cards = tool('test.cards', 'Cards', [g('mack', 5, 2, 1, 1)]);
    const reg = h.register(cards);
    await until(() => h.S.stProgressProviders().some((p: Any) => p.id === 'test.cards' && p.groups.length), 'the new provider read');
    expect(cards.listeners.size).toBe(1);
    reg.dispose();
    expect(h.S.stProgressProviders()).toEqual([]);
    expect(cards.listeners.size).toBe(0);
  });

  it('a provider that throws, or lists what is not a group, shows nothing and breaks nothing', async () => {
    const h = await subject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cleanup.push(() => warn.mockRestore());
    const broken = tool('test.broken', 'Broken', []);
    broken.provider.groups = async () => { throw new Error('no'); };
    const odd = tool('test.odd', 'Odd', []);
    odd.provider.groups = async () => [null, 'x', { label: 'Mack', total: '4', good: 9 }] as never;
    h.register(broken); h.register(odd);
    await started(h);
    h.S.stProgressWant();
    await until(() => h.S.stProgressProviders()[1].groups.length, 'the odd provider read');
    await wait(20);
    expect(h.S.stProgressProviders()[0].groups).toEqual([]);
    expect(h.S.stProgressProviders()[1].groups).toEqual([{ group: '', label: 'Mack', total: '4', good: 9, middling: undefined, poor: undefined }]);
    const row = h.S.stProgressOfSubject(h.subject.id).rows.find((r: Any) => r.name === 'Mack');
    expect(row.kinds.map((k: Any) => [k.kind, k.counts])).toEqual([['Questions', [2, 1, 1, 1]], ['Odd', [4, 0, 0, 0]]]);
  });

  it('once Study is off, listens to no provider and reads none, whatever they say', async () => {
    const h = await subject();
    const problems = tool('test.problems', 'Problems', [g('Clark', 10, 3, 1, 2)]);
    h.register(problems);
    await started(h);
    h.S.stProgressWant();
    await until(() => problems.state.reads === 1, 'the first read');
    for (const d of h.context.subscriptions) d.dispose();
    h.S.stProgressReset();
    expect(problems.listeners.size).toBe(0);
    problems.set([g('Clark', 10, 10)]);
    const late = tool('test.late', 'Late', [g('Mack', 1)]);
    h.register(late);
    await wait(120);
    expect(problems.state.reads).toBe(1);
    expect(late.state.reads).toBe(0);
    expect(late.listeners.size).toBe(0);
    expect(h.S.stProgressProviders()).toEqual([]);
  });

  it('opens a tool on a part: the provider\'s own open, on the unit\'s group with the most in that state', async () => {
    const h = await subject();
    const drills = tool('test.drills', 'Drills', [g('Mack', 9, 4, 2, 1), g('Mack 1994', 7, 1, 0, 5, 'mack1994')], { open: true });
    h.register(drills);
    await started(h);
    h.S.stProgressWant();
    await until(() => drills.state.reads === 1, 'the read');
    await wait(0);
    expect(await h.S.stProgressOpenItems('test.drills', ['mack', 'mack1994'], 'poor')).toBe(true);
    expect(await h.S.stProgressOpenItems('test.drills', ['mack'], 'good')).toBe(true);
    expect(drills.state.opened).toEqual([['mack1994', 'poor'], ['mack', 'good']]);
    expect(await h.S.stProgressOpenItems('test.drills', ['mack'], 'sideways')).toBe(false);
    expect(await h.S.stProgressOpenItems('test.nobody', ['mack'], 'good')).toBe(false);
  });
});

describe('a subject\'s progress', () => {
  it('has the units in the Units order, each with its questions by last result, and reads Also Called', async () => {
    const h = await subject();
    const problems = tool('test.problems', 'Problems', [g('Clark', 10, 3, 1, 2), g('Mack (1994)', 7, 4, 1, 1, 'mack1994'), g('Brosius', 6, 2, 2, 1)]);
    h.register(problems);
    await started(h);
    h.S.stProgressWant();
    await until(() => problems.state.reads === 1, 'the read');
    await wait(0);
    let view = h.S.stProgressOfSubject(h.subject.id);
    expect(view.rows.map((r: Any) => [r.name, r.kinds.map((k: Any) => `${k.kind} ${k.counts.join('/')}`)])).toEqual([
      ['Mack', ['Questions 2/1/1/1']], ['Clark', ['Questions 0/0/1/1', 'Problems 3/1/2/4']], ['Venter', ['Questions 2/0/0/0']],
    ]);
    expect(view.unmatched[0].groups.map((x: Any) => x.label)).toEqual(['Mack (1994)', 'Brosius']);
    expect(h.units.columns.find((c) => c.name === 'Also Called')).toMatchObject({ type: 'text' });

    h.person.edit(h.units, 'Mack', { 'Also Called': 'Mack 1994, something else' });
    h.person.edit(h.units, 'Venter', { Order: 0 });
    await wait(250);
    await h.settle();
    view = h.S.stProgressOfSubject(h.subject.id);
    expect(view.rows.map((r: Any) => r.name)).toEqual(['Venter', 'Mack', 'Clark']);
    expect(view.rows[1].kinds.map((k: Any) => `${k.kind} ${k.counts.join('/')}`)).toEqual(['Questions 2/1/1/1', 'Problems 4/1/1/1']);
    expect(view.unmatched[0].groups.map((x: Any) => x.label)).toEqual(['Brosius']);
    // His column is never written by Study.
    expect(h.units.rows.find((r) => r.title === 'Mack')!.values['Also Called']).toBe('Mack 1994, something else');
    expect(h.units.rows.filter((r) => r.title !== 'Mack').every((r) => !('Also Called' in r.values))).toBe(true);
  });

  it('is nothing to show while the database is in the Trash', async () => {
    const h = await subject();
    h.person.trash(h.bank);
    await wait(250);
    await h.settle();
    expect(h.S.stProgressOfSubject(h.subject.id)).toBeNull();
    expect(h.S.stProgressOfSubject(999)).toBeNull();
  });
});

describe('a session limited to one last result', () => {
  it('is the unit\'s scope with a filter: only the questions whose row is in that state now', async () => {
    const h = await subject();
    const scope = (unit: string, result?: string) => ({ ...h.S.stSubjectScope(h.subject, unit), ...(result ? { result } : {}) });
    const stems = async (s: Any) => (await h.S.stFixedScopeQuestions(s)).map((x: Any) => x.stem).sort();
    expect(await stems(scope('Mack'))).toHaveLength(5);
    expect(await stems(scope('Mack', 'good'))).toEqual(['Q1 about Mack?', 'Q2 about Mack?']);
    expect(await stems(scope('Mack', 'middling'))).toEqual(['Q3 about Mack?']);
    expect(await stems(scope('Mack', 'poor'))).toEqual(['Q4 about Mack?']);
    expect(await stems(scope('Mack', 'rest'))).toEqual(['Q5 about Mack?']);
    expect(await stems(scope('Venter', 'poor'))).toEqual([]);
    expect(await h.S.stCountScopeQuestions(scope('Clark', 'poor'))).toBe(1);

    h.person.edit(h.bank, 'Q4 about Mack?', { 'Last Result': 'Right' });
    await wait(250);
    await h.settle();
    expect(await stems(scope('Mack', 'poor'))).toEqual([]);
    expect(await stems(scope('Mack', 'good'))).toHaveLength(3);
  });

  it('Study a Subject… takes the state as its third argument and opens the setup on it', async () => {
    const h = await subject();
    await h.S.stCmdStudySubject(h.subject.id, 'mack', 'poor');
    expect(h.calls.opened.at(-1)).toMatchObject({ instanceId: 'setup' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pane = h.S.createEditorPane(host, { instanceId: 'setup' });
    cleanup.push(() => pane.dispose());
    await until(() => host.querySelector('.st-sheet__count'), 'the setup sheet');
    expect(host.querySelector('.st-sheet')!.textContent).toContain('Exam 7 · Mack · Wrong');
    expect(host.querySelector('.st-sheet__count')!.textContent).toMatch(/^1 question\b/);
  });
});

describe('Open Progress', () => {
  it('is a command of the manifest, first in a subject\'s menu, and opens one tab per subject titled "<Subject> Progress"', async () => {
    const h = await subject();
    expect(MANIFEST.contributes.commands.find((c: Any) => c.id === 'study.openProgress')).toEqual({ id: 'study.openProgress', title: 'Open Progress…', category: 'Study' });
    const shown = h.S.stSubjectsShown()[0];
    expect(h.S.stSubjectMenuItems(shown)[0].label).toBe('Open Progress');
    await h.S.stCmdOpenProgress(h.subject.id);
    expect(h.calls.opened).toHaveLength(1);
    expect(h.calls.opened[0]).toMatchObject({ typeId: 'study', title: 'Exam 7 Progress', instanceId: `progress-${h.subject.id}` });
    await h.S.stCmdOpenProgress('Exam 7');
    expect(h.calls.opened).toHaveLength(1);
    expect(h.calls.focused).toEqual([`parallx-community.study:study:progress-${h.subject.id}`]);
    expect(h.S.stRouteFromInstanceId(`progress-${h.subject.id}`)).toEqual({ view: 'progress', subjectId: h.subject.id });
  });

  it('asks which subject when there is more than one', async () => {
    const h = await subject();
    const second = await h.S.stCreateSubject({ name: 'GLMs' });
    await h.settle();
    await h.S.stCmdOpenProgress();
    expect(h.calls.picks[0].items.map((i: Any) => i.label)).toEqual(['Exam 7', 'GLMs']);
    expect(h.calls.opened.at(-1)).toMatchObject({ title: 'GLMs Progress', instanceId: `progress-${second.id}` });
  });
});

describe('the Progress tab', () => {
  async function open(tools: ReturnType<typeof tool>[] = [], rows: BankRow[] = BANK_ROWS) {
    const h = await subject(rows);
    for (const t of tools) h.register(t);
    await started(h);
    const host = tab(h);
    await until(() => host.querySelector('.px-page-header__title'), 'the tab');
    return { ...h, host };
  }

  it('shows the totals, a row per unit in order, and a bar per kind with its name and "N of M"', async () => {
    const problems = tool('test.problems', 'Problems', [g('Clark', 10, 3, 1, 2), g('Brosius', 6, 2, 2, 1), g('Hürlimann', 3, 0, 0, 3)], { open: true });
    const h = await open([problems]);
    await until(() => barsIn(h.host).some((n) => n.startsWith('Clark, Problems')), 'the tool\'s bar');
    expect(h.host.querySelector('.px-page-header__title')!.textContent).toBe('Exam 7 Progress');
    expect(barsIn(h.host)).toEqual([
      'All units, Questions: 4 right, 1 partly, 2 wrong, 2 not yet',
      'All units, Problems: 3 easy, 1 medium, 2 hard, 4 not rated',
      'Mack, Questions: 2 right, 1 partly, 1 wrong, 1 not yet',
      'Clark, Questions: 0 right, 0 partly, 1 wrong, 1 not yet',
      'Clark, Problems: 3 easy, 1 medium, 2 hard, 4 not rated',
      'Venter, Questions: 2 right, 0 partly, 0 wrong, 0 not yet',
    ]);
    expect(rowNames(h.host)).toEqual(['Mack', 'Clark', 'Venter']);
    expect([...h.host.querySelectorAll('.st-prog__cell:not(.st-prog__cell--none) .st-prog__n')].map((n) => n.textContent)).toEqual(['7 of 9', '6 of 10', '4 of 5', '1 of 2', '6 of 10', '2 of 2']);
    expect([...h.host.querySelectorAll('.st-prog__key')].map((n) => n.textContent)).toEqual(['Right', 'Partly', 'Wrong', 'Not yet']);
    expect([...h.host.querySelectorAll('.st-prog__row--head > span')].map((n) => n.textContent)).toEqual(['Unit', 'Questions', 'Problems']);
    // A unit with nothing in a kind has no bar for it: an empty cell keeps the columns in line.
    expect(h.host.querySelectorAll('.st-prog__cell--none')).toHaveLength(2);
    expect([...h.host.querySelectorAll('.st-prog__loose')].map((n) => n.textContent)).toEqual(['Problems not matched to a unit: Brosius 6, Hürlimann 3']);
    expect(h.host.querySelector('.st-prog__hint')!.textContent).toMatch(/Also Called in Units/);
    // The totals are read, not pressed; every bar is the kit's.
    expect([...h.host.querySelectorAll('.st-prog__totals .px-stacked-bar')].map((b) => b.getAttribute('role'))).toEqual(['img', 'img']);
  });

  it('a part of a Questions bar is a button that runs the unit\'s setup on that state; the unit\'s name runs it on the unit', async () => {
    const h = await open();
    await until(() => part(h.host, 'Mack, Questions, wrong: 1. Study these'), 'the bar');
    const mack = [...h.host.querySelectorAll<HTMLElement>('.px-stacked-bar')].find((b) => b.getAttribute('aria-label')!.startsWith('Mack, Questions'))!;
    expect(mack.getAttribute('role')).toBe('group');
    expect([...mack.querySelectorAll<HTMLElement>('[data-state]')].map((p) => [p.tagName, p.dataset.state, p.getAttribute('aria-label')])).toEqual([
      ['BUTTON', 'good', 'Mack, Questions, right: 2. Study these'], ['BUTTON', 'middling', 'Mack, Questions, partly: 1. Study these'],
      ['BUTTON', 'poor', 'Mack, Questions, wrong: 1. Study these'], ['BUTTON', 'rest', 'Mack, Questions, not yet: 1. Study these'],
    ]);
    // A part with nothing in it is not there.
    const venter = [...h.host.querySelectorAll<HTMLElement>('.px-stacked-bar')].find((b) => b.getAttribute('aria-label')!.startsWith('Venter, Questions'))!;
    expect([...venter.querySelectorAll<HTMLElement>('[data-state]')].map((p) => p.dataset.state)).toEqual(['good']);
    h.calls.commands.length = 0;
    part(h.host, 'Mack, Questions, wrong: 1. Study these')!.click();
    [...h.host.querySelectorAll<HTMLElement>('.st-prog__name')].find((b) => b.textContent!.trim() === 'Clark')!.click();
    expect(h.calls.commands).toEqual([
      { id: 'study.studySubject', args: [h.subject.id, 'Mack', 'poor'] },
      { id: 'study.studySubject', args: [h.subject.id, 'Clark'] },
    ]);
  });

  it('a part of a tool\'s bar opens the tool when it offers that, and is plain when it does not', async () => {
    const drills = tool('test.drills', 'Drills', [g('Mack', 9, 4, 2, 1)], { open: true });
    const reps = tool('test.reps', 'Reps', [g('clark', 6, 1, 2, 3)]);
    const h = await open([drills, reps]);
    h.handlers.set('study.openProgress', (s: unknown, where: unknown) => h.S.stCmdOpenProgress(s, where));
    const blank = await until(() => part(h.host, 'Mack, Drills, hard: 1. Open these'), 'the tool\'s part');
    expect(blank.tagName).toBe('BUTTON');
    blank.click();
    await until(() => drills.state.opened.length, 'the tool opened');
    expect(drills.state.opened).toEqual([['mack', 'poor']]);
    expect(h.calls.opened).toHaveLength(0);
    const plain = [...h.host.querySelectorAll<HTMLElement>('.px-stacked-bar')].find((b) => b.getAttribute('aria-label') === 'Clark, Reps: 1 easy, 2 medium, 3 hard, 0 not rated')!;
    expect(plain.getAttribute('role')).toBe('img');
    expect([...plain.querySelectorAll<HTMLElement>('[data-state]')].map((p) => [p.tagName, p.tabIndex, p.title])).toEqual([['SPAN', -1, 'Easy: 1'], ['SPAN', -1, 'Medium: 2'], ['SPAN', -1, 'Hard: 3']]);
    // A part that acts says so in its tooltip too; its spoken name stays whole.
    expect([blank.title, blank.getAttribute('aria-label')]).toEqual(['Hard: 1. Open these', 'Mack, Drills, hard: 1. Open these']);
  });

  it('In Order and Weakest First: the rows move, and the choice is kept in the setting study.progressSort', async () => {
    const h = await open();
    await until(() => rowNames(h.host).length === 3, 'the rows');
    const choice = (label: string) => [...h.host.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent!.trim() === label)!;
    expect([choice('In Order').getAttribute('aria-checked'), choice('Weakest First').getAttribute('aria-checked')]).toEqual(['true', 'false']);
    choice('Weakest First').click();
    // Clark has none right of 2, Mack 2 of 5, Venter 2 of 2.
    expect(rowNames(h.host)).toEqual(['Clark', 'Mack', 'Venter']);
    expect(choice('Weakest First').getAttribute('aria-checked')).toBe('true');
    await until(() => h.settings.progressSort === 'weakest', 'the setting');
    expect(MANIFEST.contributes.configuration[0].properties['study.progressSort']).toMatchObject({ type: 'string', default: 'order' });
    choice('In Order').click();
    expect(rowNames(h.host)).toEqual(['Mack', 'Clark', 'Venter']);
    choice('Weakest First').click();
    await until(() => h.settings.progressSort === 'weakest', 'the setting again');
    // The tab closed and opened again starts as he left it.
    h.host.close();
    const again = tab(h);
    await until(() => rowNames(again).length === 3, 'the tab opened again');
    expect(rowNames(again)).toEqual(['Clark', 'Mack', 'Venter']);
    expect([...again.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent!.trim() === 'Weakest First')!.getAttribute('aria-checked')).toBe('true');
  });

  it('follows a change without being reopened: a row edited, a provider\'s event, a tool turned off', async () => {
    const problems = tool('test.problems', 'Problems', [g('Clark', 10, 3, 1, 2)]);
    const h = await open([problems]);
    const reg = progressProviderRegistry.register(problems.provider);
    await until(() => barsIn(h.host).includes('Clark, Problems: 3 easy, 1 medium, 2 hard, 4 not rated'), 'the tool\'s bar');
    h.person.edit(h.bank, 'Q4 about Mack?', { 'Last Result': 'Right' });
    await until(() => barsIn(h.host).includes('Mack, Questions: 3 right, 1 partly, 0 wrong, 1 not yet'), 'the edited row in the bar');
    problems.set([g('Clark', 10, 4, 1, 2)]);
    await until(() => barsIn(h.host).includes('Clark, Problems: 4 easy, 1 medium, 2 hard, 3 not rated'), 'the provider\'s new counts');
    reg.dispose();
    await until(() => !barsIn(h.host).some((n) => /Problems/.test(n)), 'the tool\'s bars gone');
    expect(barsIn(h.host)).toContain('Mack, Questions: 3 right, 1 partly, 0 wrong, 1 not yet');
    expect([...h.host.querySelectorAll('.st-prog__row--head > span')].map((n) => n.textContent)).toEqual(['Unit', 'Questions']);
  });

  it('keeps the focus on the part he was on when the counts change', async () => {
    const h = await open();
    const wrong = await until(() => part(h.host, 'Mack, Questions, wrong: 1. Study these'), 'the part');
    wrong.focus();
    h.person.edit(h.bank, 'Q5 about Mack?', { 'Last Result': 'Wrong', 'Times Attempted': 1 });
    const now = await until(() => part(h.host, 'Mack, Questions, wrong: 2. Study these'), 'the new count');
    expect(document.activeElement).toBe(now);
  });

  it('says "No questions yet." with the way to add them, and draws no bar', async () => {
    const h = await open([], []);
    const headline = await until(() => h.host.querySelector('.px-empty__headline'), 'the empty state');
    expect(headline.textContent).toBe('No questions yet.');
    expect(barsIn(h.host)).toEqual([]);
    expect((h.host.querySelector('.st-prog__bar') as HTMLElement).hidden).toBe(true);
    h.calls.commands.length = 0;
    [...h.host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent!.trim() === 'Open Questions')!.click();
    expect(h.calls.commands).toEqual([{ id: 'canvas.openPage', args: [h.bank.id] }]);
    // The first question added draws the bars, in the same tab.
    h.person.add(h.bank, 'Q1 about Mack?', { 'Model Answer': 'A', Paper: 'Mack' });
    await until(() => barsIn(h.host).includes('Mack, Questions: 0 right, 0 partly, 0 wrong, 1 not yet'), 'the first bar');
    expect(h.host.querySelector('.px-empty')).toBeNull();
  });

  it('says the database is in the Trash in place of bars', async () => {
    const h = await open();
    await until(() => barsIn(h.host).length, 'the bars');
    h.person.trash(h.bank);
    const headline = await until(() => h.host.querySelector('.px-empty__headline'), 'the Trash state');
    expect(headline.textContent).toBe('Its questions database is in the Trash.');
    expect(barsIn(h.host)).toEqual([]);
  });

  it('says how many questions name no unit', async () => {
    const h = await open([], [...BANK_ROWS, { title: 'Loose?', values: { 'Model Answer': 'A' } }]);
    await until(() => barsIn(h.host).length, 'the bars');
    expect([...h.host.querySelectorAll('.st-prog__loose')].map((n) => n.textContent)).toEqual(['1 question names no unit. Give each its unit in Questions and it joins that unit\'s bar.']);
    expect(barsIn(h.host)[0]).toBe('All units, Questions: 4 right, 1 partly, 2 wrong, 3 not yet');
  });
});

describe('the sidebar', () => {
  it('gives each unit a thin bar over every kind together, beside its "N of M", and follows a provider', async () => {
    const h = await subject();
    const problems = tool('test.problems', 'Problems', [g('Clark', 10, 3, 1, 2)]);
    h.register(problems);
    await started(h);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = h.S.createSidebarView(host);
    cleanup.push(() => view.dispose());
    await until(() => barsIn(host).includes('Clark: 3 right, 1 partly, 3 wrong, 5 not yet'), 'the bars with the tool\'s counts');
    expect(barsIn(host)).toEqual(['Mack: 2 right, 1 partly, 1 wrong, 1 not yet', 'Clark: 3 right, 1 partly, 3 wrong, 5 not yet', 'Venter: 2 right, 0 partly, 0 wrong, 0 not yet']);
    const units = [...host.querySelectorAll<HTMLElement>('.st-sb__unit')];
    expect(units.map((u) => u.querySelector('.st-sb__r')!.textContent)).toEqual(['4 of 5', '7 of 12', '2 of 2']);
    // The subject's own count is every kind's total: 7 of 9 questions and 6 of 10 problems.
    expect(host.querySelector('.st-sb__subj .st-sb__r')!.textContent).toBe('13 of 19');
    // The bar is the kit's small one, beside the button, never inside it, and nothing in it can be pressed.
    expect(units.every((u) => u.querySelector(':scope > .px-stacked-bar.px-stacked-bar--sm') && !u.querySelector('button .px-stacked-bar') && !u.querySelector('.px-stacked-bar button'))).toBe(true);
    expect(units[0].querySelector('.px-stacked-bar')!.getAttribute('role')).toBe('img');
    problems.set([g('Clark', 10, 10)]);
    await until(() => barsIn(host).includes('Clark: 10 right, 0 partly, 1 wrong, 1 not yet'), 'the provider\'s change in the sidebar');
  });
});
