// homePage.test.ts — the parts of Home that are plain functions: the greeting
// by the hour, the date line, the ranges of the filter words, the cards a
// tool registers, a page's text read from its stored body, and the moment
// startup is done.

import { describe, expect, it, vi } from 'vitest';
import { greetingFor, dateLine, inRange } from '../../src/built-in/home/homePage';
import { collectHomeCards, onDidChangeHomeCards, registerHomeCard, registerHomeCardProvider, type HomeCard } from '../../src/services/homeSources';
import { createHomeApi } from '../../src/api/homeApi';
import { pageText } from '../../src/built-in/canvas/pageSources';
import { fileOpeningWords } from '../../src/built-in/explorer/homeSource';
import { homeName, homeWidth, opensOnHome, registerHomeSettings, HOME_NAME, HOME_OPEN_ON_START, HOME_WIDTH, type HomeSettingsRegistry } from '../../src/built-in/home/homeSettings';

const at = (hour: number, minute = 0): Date => new Date(2026, 10, 27, hour, minute);
const DAY = 24 * 3600e3;

describe('the greeting, by the hour', () => {
  it('says morning from 5 to noon, afternoon to 6, evening after and through the night', () => {
    expect(greetingFor(at(5))).toBe('Good morning');
    expect(greetingFor(at(8))).toBe('Good morning');
    expect(greetingFor(at(11, 59))).toBe('Good morning');
    expect(greetingFor(at(12))).toBe('Good afternoon');
    expect(greetingFor(at(17, 59))).toBe('Good afternoon');
    expect(greetingFor(at(18))).toBe('Good evening');
    expect(greetingFor(at(23))).toBe('Good evening');
    expect(greetingFor(at(2))).toBe('Good evening');
  });

  it('writes the date as the weekday, the day and the month', () => {
    expect(dateLine(at(9))).toBe('Friday 27 November');
    expect(dateLine(new Date(2027, 0, 1, 9))).toBe('Friday 1 January');
  });
});

describe('the ranges of the filter words', () => {
  const now = at(14).getTime();
  it('this week is the last 7 days, this month the last 30, all is everything', () => {
    expect(inRange(now - 3600e3, 'week', now)).toBe(true);
    expect(inRange(now - 7 * DAY, 'week', now)).toBe(true);
    expect(inRange(now - 7 * DAY - 1, 'week', now)).toBe(false);
    expect(inRange(now - 10 * DAY, 'month', now)).toBe(true);
    expect(inRange(now - 30 * DAY - 1, 'month', now)).toBe(false);
    expect(inRange(now - 4000 * DAY, 'all', now)).toBe(true);
  });
  it('a thing stamped a moment ahead of the clock is still in range', () => {
    expect(inRange(now + 5000, 'week', now)).toBe(true);
  });
});

describe('a tool\'s card', () => {
  const card = (id: string, number: string): HomeCard => ({ id, from: 'Almanac', number, line: 'x', action: { label: 'Open', command: 'a.open' } });

  const numbers = async (): Promise<(string | undefined)[]> => (await collectHomeCards()).map((c) => c.number);

  it('is listed while registered, replaced by the same id, and gone when disposed', async () => {
    const changes = vi.fn();
    const sub = onDidChangeHomeCards(changes);
    const first = registerHomeCard(card('t:one', '7'));
    expect(await numbers()).toEqual(['7']);
    const second = registerHomeCard(card('t:one', '12'));
    expect(await numbers()).toEqual(['12']);
    first.dispose(); // the earlier registration no longer owns the card
    expect(await numbers()).toEqual(['12']);
    second.dispose();
    expect(await numbers()).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(3);
    sub.dispose();
  });

  it('through the API carries the tool\'s id and name, and leaves with the tool', async () => {
    const subscriptions: { dispose(): void }[] = [];
    const api = createHomeApi('probe.almanac', 'Probe Almanac', subscriptions);
    api.registerCard({ id: 'entries', number: '7', unit: 'entries waiting', line: 'x', action: { label: 'Open Entries', command: 'almanac.open' } });
    expect(await collectHomeCards()).toMatchObject([{ id: 'probe.almanac:entries', from: 'Probe Almanac', number: '7' }]);
    for (const d of subscriptions) d.dispose(); // the tool is turned off
    expect(await collectHomeCards()).toEqual([]);
  });

  it('from a provider is read each time Home asks; null is no card; one that throws is left out, not the row', async () => {
    const subscriptions: { dispose(): void }[] = [];
    const api = createHomeApi('probe.almanac', 'Probe Almanac', subscriptions);
    let due = 3;
    api.registerCardProvider({ id: 'today', read: async () => (due ? { id: 'ignored', number: String(due), line: 'x', action: { label: 'Study', command: 'a.study' } } : null) });
    const broken = registerHomeCardProvider({ id: 'x:broken', read: async () => { throw new Error('no database'); } });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await collectHomeCards()).toMatchObject([{ id: 'probe.almanac:today', from: 'Probe Almanac', number: '3' }]);
    due = 5;
    expect(await numbers()).toEqual(['5']);
    due = 0;
    expect(await numbers()).toEqual([]);
    quiet.mockRestore();
    broken.dispose();
    for (const d of subscriptions) d.dispose();
  });
});

describe('a page\'s text, read from its stored body', () => {
  const doc = { type: 'doc', content: [
    { type: 'paragraph' },
    { type: 'heading', content: [{ type: 'text', text: 'Cape Cod' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Fewer parameters means ' }, { type: 'text', text: 'more degrees of freedom.' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Premium carries information.' }] }] }] },
  ] };

  it('reads the body in its envelope, as the canvas stores it', () => {
    const text = pageText(JSON.stringify({ schemaVersion: 2, doc }));
    expect(text.opening).toBe('Cape Cod Fewer parameters means more degrees of freedom. Premium carries information.');
    expect(text.preview).toBe('Cape Cod\nFewer parameters means more degrees of freedom.\nPremium carries information.');
    expect(text.words).toBe(12);
  });
  it('reads a body stored bare, before the envelope', () => {
    expect(pageText(JSON.stringify(doc)).words).toBe(12);
  });
  it('cuts the opening at a word and says so', () => {
    const opening = pageText(JSON.stringify({ schemaVersion: 2, doc }), 30).opening;
    expect(opening).toBe('Cape Cod Fewer parameters…');
  });
  it('an empty or unreadable body has no words', () => {
    expect(pageText(undefined)).toEqual({ opening: '', preview: '', words: 0 });
    expect(pageText('not json').words).toBe(0);
  });
});

describe('a text file\'s opening words', () => {
  it('drops front matter and markdown marks', () => {
    expect(fileOpeningWords('---\ntitle: x\n---\n# Clark\n\nThe **Cape Cod** method')).toBe('Clark The Cape Cod method');
  });
});

describe('Home\'s settings', () => {
  function registry(): HomeSettingsRegistry & { schemas: Map<string, { key: string; scope: string; default: unknown; type: string }>; values: Map<string, unknown> } {
    const schemas = new Map<string, { key: string; scope: string; default: unknown; type: string }>();
    const values = new Map<string, unknown>();
    return {
      schemas, values,
      register: (s) => { schemas.set(s.key, s); },
      unregister: (k) => { schemas.delete(k); },
      getSchema: (k) => schemas.get(k) as never,
      getValue: <T>(k: string) => (values.has(k) ? values.get(k) : schemas.get(k)?.default) as T,
      setValue: async (k, v) => { values.set(k, v); },
      onDidChange: () => ({ dispose() {} }),
    };
  }

  it('registers a name, opening on Home per workspace and on by default, and a width', () => {
    const reg = registry();
    const d = registerHomeSettings(reg);
    expect(reg.schemas.get(HOME_NAME)).toMatchObject({ type: 'string', scope: 'user', default: '' });
    expect(reg.schemas.get(HOME_OPEN_ON_START)).toMatchObject({ type: 'boolean', scope: 'workspace', default: true });
    expect(reg.schemas.get(HOME_WIDTH)).toMatchObject({ type: 'enum', default: 'medium' });
    expect(opensOnHome(reg)).toBe(true);
    expect(homeWidth(reg)).toBe('medium');
    expect(homeName(reg)).toBe('');
    d.dispose();
    expect(reg.schemas.size).toBe(0);
  });

  it('reads what was set, and falls back when a value is not one it knows', () => {
    const reg = registry();
    registerHomeSettings(reg);
    reg.values.set(HOME_NAME, '  Ada ');
    reg.values.set(HOME_OPEN_ON_START, false);
    reg.values.set(HOME_WIDTH, 'huge');
    expect(homeName(reg)).toBe('Ada');
    expect(opensOnHome(reg)).toBe(false);
    expect(homeWidth(reg)).toBe('medium');
  });
});

describe('startup done', () => {
  it('runs what waited when the tabs are back, and at once after that', async () => {
    vi.resetModules();
    const { afterStartup, markStartupDone } = await import('../../src/services/startupDone');
    const ran: string[] = [];
    afterStartup(() => ran.push('waited'));
    expect(ran).toEqual([]);
    markStartupDone();
    expect(ran).toEqual(['waited']);
    afterStartup(() => ran.push('late'));
    expect(ran).toEqual(['waited', 'late']);
  });
});

describe('the Planner\'s card for today', () => {
  const NOW = new Date(2026, 10, 27, 14, 0).getTime();
  const DAY_START = new Date(2026, 10, 27).getTime();
  const event = (title: string, hour: number) => ({ kind: 'event' as const, at: DAY_START + hour * 3600e3, end: DAY_START + (hour + 1) * 3600e3, event: { title } as never, past: DAY_START + (hour + 1) * 3600e3 <= NOW });
  const task = (title: string, hour: number, status = 'planned') => ({ kind: 'task' as const, at: DAY_START + hour * 3600e3, task: { title, status } as never, past: DAY_START + hour * 3600e3 <= NOW });
  const model = (over: Partial<import('../../src/built-in/planner/plannerToday').TodayModel>): import('../../src/built-in/planner/plannerToday').TodayModel =>
    ({ dayStart: DAY_START, allDay: [], schedule: [], nowIndex: 0, anytime: [], overdue: [], review: [], ...over });

  it('has no card on a day that holds nothing', async () => {
    const { plannerHomeCard } = await import('../../src/built-in/planner/plannerHomeCard');
    expect(plannerHomeCard(model({}), NOW)).toBeNull();
  });

  it('counts the events and names the next thing with its time', async () => {
    const { plannerHomeCard } = await import('../../src/built-in/planner/plannerHomeCard');
    const card = plannerHomeCard(model({ schedule: [event('Standup', 9), event('Study block', 18), event('Dinner', 20)] }), NOW);
    expect(card).toMatchObject({ number: '3', unit: 'events today', action: { label: 'Open Today', command: 'planner.show', args: ['today'] } });
    expect(card?.line).toMatch(/^Next: Study block, \d/);
  });

  it('counts open tasks due today with the events, and leaves done ones out', async () => {
    const { plannerHomeCard } = await import('../../src/built-in/planner/plannerHomeCard');
    const card = plannerHomeCard(model({
      schedule: [event('Standup', 9), task('Send report', 16), task('Filed', 10, 'done')],
      anytime: [{ title: 'Read Clark', status: 'planned' } as never, { title: 'Done already', status: 'done' } as never],
    }), NOW);
    expect(card).toMatchObject({ number: '3', unit: 'for today' });
    expect(card?.line).toMatch(/^Next: Send report, /);
  });

  it('with only tasks says tasks due, in the singular for one', async () => {
    const { plannerHomeCard } = await import('../../src/built-in/planner/plannerHomeCard');
    expect(plannerHomeCard(model({ anytime: [{ title: 'Read Clark', status: 'planned' } as never] }), NOW)).toMatchObject({ number: '1', unit: 'task due', line: 'Nothing more on the schedule today.' });
  });

  it('says what is overdue when nothing comes next, and stands on it alone when today is empty', async () => {
    const { plannerHomeCard } = await import('../../src/built-in/planner/plannerHomeCard');
    const overdue = [{ title: 'Late', status: 'planned' } as never, { title: 'Later', status: 'planned' } as never];
    expect(plannerHomeCard(model({ schedule: [event('Standup', 9)], overdue }), NOW)).toMatchObject({ number: '1', unit: 'event today', line: '2 tasks are overdue.' });
    expect(plannerHomeCard(model({ overdue }), NOW)).toMatchObject({ number: '2', unit: 'overdue', line: 'Nothing else is planned for today.' });
  });
});

describe('Worksheets\' card for the quiz left open', () => {
  it('says which problem it stands on, the quiz by name, and resumes it', async () => {
    const { quizHomeCard } = await import('../../src/built-in/worksheet/homeCard');
    expect(quizHomeCard({ id: 'q1', name: 'Day 8 Draw', problems: 6, position: 1 })).toEqual({
      id: 'quiz', icon: 'calculator', number: '2 of 6', line: 'Day 8 Draw, the quiz you left open.',
      action: { label: 'Resume', icon: 'arrow-right', command: 'worksheet.openQuiz', args: ['q1'] },
    });
  });
  it('stays on the last problem when the quiz is on its summary, and has no card without a quiz', async () => {
    const { quizHomeCard } = await import('../../src/built-in/worksheet/homeCard');
    expect(quizHomeCard({ id: 'q1', name: '', problems: 6, position: 6 })).toMatchObject({ number: '6 of 6', line: 'Quiz, the quiz you left open.' });
    expect(quizHomeCard(null)).toBeNull();
    expect(quizHomeCard({ id: 'q2', name: 'Empty', problems: 0, position: 0 })).toBeNull();
  });
});

describe('the pages on Home', () => {
  const body = (text: string): string => JSON.stringify({ schemaVersion: 2, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
  const listener = () => ({ dispose() {} });

  it('are the pages a person opened, by when, not the pages a tool wrote last; one in Trash is left out', async () => {
    const { registerCanvasPageSources } = await import('../../src/built-in/canvas/pageSources');
    const { getHomeSources } = await import('../../src/services/homeSources');
    const pages: Record<string, { id: string; title: string; updatedAt: string; content: string; isArchived: boolean }> = {
      notes: { id: 'notes', title: 'Reserving Notes', updatedAt: '2026-11-20T10:00:00.000Z', content: body('Fewer parameters.'), isArchived: false },
      old: { id: 'old', title: 'Old Page', updatedAt: '2026-11-01T10:00:00.000Z', content: body('Old words.'), isArchived: false },
      binned: { id: 'binned', title: 'Binned', updatedAt: '2026-11-26T10:00:00.000Z', content: body('Gone.'), isArchived: true },
      // Written by a tool a minute ago and never opened: a plan's day.
      day: { id: 'day', title: 'Fri, Nov 27, 2026', updatedAt: '2026-11-27 13:59:00', content: body(''), isArchived: false },
    };
    const getRecentPages = vi.fn(async () => []);
    const data = { getPage: async (id: string) => pages[id] ?? null, getRecentPages, getPageSummaryTree: async () => [], getRootPages: async () => [], getChildren: async () => [], onDidChangePage: listener };
    const opened = Date.parse('2026-11-27T09:00:00.000Z');
    const recents = { whenReady: Promise.resolve(), onDidChangeOpens: listener, getRecentOpens: () => [
      { key: 'page:old', kind: 'page', title: 'Old Page', target: 'old', ts: opened },
      { key: 'file:x', kind: 'file', title: 'x.md', target: 'file:///x.md', ts: opened - 1 },
      { key: 'page:binned', kind: 'page', title: 'Binned', target: 'binned', ts: opened - 2 },
      { key: 'page:notes', kind: 'page', title: 'Reserving Notes', target: 'notes', ts: opened - 3 },
      { key: 'page:deleted', kind: 'page', title: 'Deleted', target: 'deleted', ts: opened - 4 },
    ] };
    const subscriptions: { dispose(): void }[] = [];
    registerCanvasPageSources({ services: { registerInstance: () => {} } }, subscriptions, data as never, async () => {}, recents as never);
    const source = getHomeSources().find((s) => s.id === 'canvas.pages')!;
    const items = await source.listRecent(10);
    expect(items.map((i) => i.title)).toEqual(['Old Page', 'Reserving Notes']);
    expect(items[0]).toMatchObject({ kind: 'Page', summary: 'Old words.', touchedAt: opened, stat: { value: '2', unit: 'words' } });
    // Opened after its last edit: it goes by when it was opened.
    expect(items[1].touchedAt).toBe(opened - 3);
    expect(getRecentPages).not.toHaveBeenCalled();
    // A pinned page that is no longer among the opened ones is found by id; one in Trash or deleted is not.
    const found = await source.find!(['day', 'binned', 'deleted']);
    expect(found.map((i) => i.title)).toEqual(['Fri, Nov 27, 2026']);
    // Found that way it goes by when it last changed, read as the UTC time the canvas stores.
    expect(found[0].touchedAt).toBe(Date.parse('2026-11-27T13:59:00.000Z'));
    for (const d of subscriptions) d.dispose();
    expect(getHomeSources().some((s) => s.id === 'canvas.pages')).toBe(false);
  });
});

describe('the files on Home', () => {
  const recentsOf = (opens: { target: string; title: string; ts: number }[]) => ({ whenReady: Promise.resolve(), onDidChangeOpens: () => ({ dispose() {} }), getRecentOpens: () => opens.map((o) => ({ ...o, key: `file:${o.target}`, kind: 'file' as const })) });

  it('show an image as itself, a text file by its words, read again only when the file changed on disk', async () => {
    const { registerExplorerHomeSource } = await import('../../src/built-in/explorer/homeSource');
    const files: Record<string, { content: string; encoding: string; mtime: number }> = {
      'file:///w/Readings/notes.md': { content: '# Clark\n\nThe Cape Cod method', encoding: 'utf-8', mtime: 100 },
      'file:///w/photos/chart.png': { content: 'aGVsbG8=', encoding: 'base64', mtime: 50 },
    };
    const readFile = vi.fn(async (uri: string) => files[uri]);
    const api = { workspace: { workspaceFolders: [{ uri: 'file:///w', name: 'w' }], fs: { readFile, stat: async (uri: string) => { if (!files[uri]) throw new Error('gone'); return { mtime: files[uri].mtime }; } } } };
    let opens = [{ target: 'file:///w/Readings/notes.md', title: 'notes.md', ts: 1000 }, { target: 'file:///w/photos/chart.png', title: 'chart.png', ts: 900 }];
    const reg = registerExplorerHomeSource(api, { ...recentsOf([]), getRecentOpens: () => recentsOf(opens).getRecentOpens() } as never);
    const { getHomeSources } = await import('../../src/services/homeSources');
    const source = getHomeSources().find((s) => s.id === 'explorer.files')!;
    let items = await source.listRecent(10);
    expect(items[0]).toMatchObject({ title: 'notes.md', where: 'Readings', summary: 'Clark The Cape Cod method', touchedAt: 1000, stat: { value: '5', unit: 'words' } });
    expect(items[1]).toMatchObject({ title: 'chart.png', where: 'photos', image: 'data:image/png;base64,aGVsbG8=' });
    expect(readFile).toHaveBeenCalledTimes(2);
    // Its tab activated again (a new open time), the file unchanged: nothing is read again.
    opens = opens.map((o) => ({ ...o, ts: o.ts + 5000 }));
    await source.listRecent(10);
    expect(readFile).toHaveBeenCalledTimes(2);
    // Edited and saved, the open time the same: its new words are on Home.
    files['file:///w/Readings/notes.md'] = { content: 'Mack assumes independence between accident years', encoding: 'utf-8', mtime: 200 };
    items = await source.listRecent(10);
    expect(items[0].summary).toBe('Mack assumes independence between accident years');
    expect(readFile).toHaveBeenCalledTimes(3);
    // A pinned file found by id goes by when it changed; one that is gone from disk is left out.
    const found = await source.find!(['file:///w/Readings/notes.md', 'file:///w/gone.md']);
    expect(found.map((i) => [i.title, i.touchedAt])).toEqual([['notes.md', 200]]);
    reg.dispose();
  });

  it('place a file by the folder it is in, not by a folder whose name only starts the same', async () => {
    const { registerExplorerHomeSource } = await import('../../src/built-in/explorer/homeSource');
    const api = { workspace: { workspaceFolders: [{ uri: 'file:///C%3A/work', name: 'work' }], fs: { readFile: async () => ({ content: 'x', encoding: 'utf-8' }), stat: async () => ({ mtime: 1 }) } } };
    const reg = registerExplorerHomeSource(api, recentsOf([{ target: 'file:///C%3A/work2/sub/b.md', title: 'b.md', ts: 2 }, { target: 'file:///C%3A/work/sub/a.md', title: 'a.md', ts: 1 }]) as never);
    const { getHomeSources } = await import('../../src/services/homeSources');
    const items = await getHomeSources().find((s) => s.id === 'explorer.files')!.listRecent(10);
    expect(items.map((i) => [i.title, i.where])).toEqual([['b.md', undefined], ['a.md', 'sub']]);
    reg.dispose();
  });
});

describe('what Home reads from its sources', () => {
  it('says how many could not be read, and finds pinned things by id from the sources that can', async () => {
    const { registerHomeSource, readHomeEntries, findHomeEntries } = await import('../../src/services/homeSources');
    const thing = (id: string) => ({ id, title: id, kind: 'Entry', touchedAt: 1, open: () => {} });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = registerHomeSource({ id: 't:a', label: 'A', listRecent: async () => [thing('one')], find: async (ids) => ids.filter((id) => id !== 'gone').map(thing) });
    const b = registerHomeSource({ id: 't:b', label: 'B', listRecent: async () => { throw new Error('no database'); } });
    const read = await readHomeEntries('');
    expect(read.entries.map((e) => e.item.id)).toEqual(['one']);
    expect(read.failed).toBe(1);
    const found = await findHomeEntries([{ sourceId: 't:a', itemId: 'old' }, { sourceId: 't:a', itemId: 'gone' }, { sourceId: 't:b', itemId: 'x' }]);
    expect(found.map((e) => `${e.source.id}/${e.item.id}`)).toEqual(['t:a/old']);
    quiet.mockRestore();
    a.dispose(); b.dispose();
  });
});
