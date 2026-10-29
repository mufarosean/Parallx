// memoryLessons.test.ts — the agent's lessons, seen and corrected
// (docs/MEMORY_BRIEF.md step 2): the core commands, and the words the Mind
// tab says about where a lesson came from.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { registerMemoryCommands, registerOffRecordCommand } from '../../src/built-in/chat/utilities/memoryCommands';
import { offRecordRule } from '../../src/openclaw/participants/openclawDefaultParticipant';
import { lessonOrigin } from '../../src/built-in/agents/agentsLessons';
import { createRow, createSection } from '../../src/ui/kit';
import { URI } from '../../src/platform/uri';

function memory() {
  const lessons = new Map<string, string>([
    ['clark-tail', '---\nsources:\n  - 2026-10-20 chat-a\n---\nTail factor via truncation.'],
    ['old-one', '# Old\n\nNo source.'],
  ]);
  let index = [{ slug: 'clark-tail', description: 'Clark tail factor', path: 'lessons/clark-tail.md' }];
  const archived: string[] = [];
  const daily: string[] = [];
  return {
    archived, daily,
    memoryRoot: URI.parse('file:///ws/.parallx/memory'),
    parseMemoryIndex: vi.fn(async () => index),
    listLessons: vi.fn(async () => [...lessons.keys()]),
    readLessonFile: vi.fn(async (slug: string) => lessons.get(slug) ?? ''),
    archiveLessonFile: vi.fn(async (slug: string) => { archived.push(slug); return lessons.delete(slug); }),
    removeMemoryIndexEntry: vi.fn(async (slug: string) => { index = index.filter((e) => e.slug !== slug); }),
    appendDailyMemory: vi.fn(async (text: string) => { daily.push(text); }),
  };
}

function commands() {
  const map = new Map<string, (...a: unknown[]) => unknown>();
  return { map, registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { map.set(id, fn); return { dispose() {} }; } };
}

describe('the agent\'s lessons', () => {
  it('lists them with where each came from, indexed ones first, a file the index misses after', async () => {
    const m = memory(); const c = commands();
    registerMemoryCommands(c, m as never);
    const r = await c.map.get('parallx.memory.lessons')!() as { lessons: { slug: string; description: string; sources: unknown[] }[] };
    expect(r.lessons).toEqual([
      { slug: 'clark-tail', description: 'Clark tail factor', sources: [{ date: '2026-10-20', session: 'chat-a' }] },
      { slug: 'old-one', description: '', sources: [] },
    ]);
  });

  it('Wrong archives the lesson and tells the agent, in today\'s file, not to rely on it; nothing is deleted', async () => {
    const m = memory(); const c = commands();
    registerMemoryCommands(c, m as never);
    expect(await c.map.get('parallx.memory.lessonWrong')!('clark-tail')).toBe(true);
    expect(m.archived).toEqual(['clark-tail']);
    expect(m.daily[0]).toMatch(/marked the lesson "Clark tail factor" wrong.*do not rely on it/);
  });

  it('Open opens the lesson\'s own file', async () => {
    const m = memory(); const c = commands(); const open = vi.fn();
    registerMemoryCommands(c, m as never, open);
    await c.map.get('parallx.memory.openLesson')!({ slug: 'clark-tail' });
    expect(open).toHaveBeenCalledWith('file:///ws/.parallx/memory/lessons/clark-tail.md');
  });

  it('says where a lesson came from in words', () => {
    expect(lessonOrigin([])).toBe('Written before sources were kept');
    expect(lessonOrigin([{ date: '2026-10-20', session: 'a' }])).toMatch(/^From a chat on /);
    expect(lessonOrigin([{ date: '2026-10-20' }, { date: '2026-10-28' }])).toMatch(/^From 2 chats, .+ to .+/);
  });

  it('the kit draws a section and a row', () => {
    const host = document.createElement('div');
    const sec = createSection(host, 'What it has written down', 'agents-section');
    const row = createRow(sec, { name: 'Clark tail factor', detail: 'From a chat on 20 Oct', detailTitle: 'chat-a' });
    expect(sec.className).toBe('px-section agents-section');
    expect(sec.querySelector('.px-section-label')?.textContent).toBe('What it has written down');
    expect(row.querySelector('.px-row__name')?.textContent).toBe('Clark tail factor');
    expect((row.querySelector('.px-row__detail') as HTMLElement).title).toBe('chat-a');
  });

  it('Do Not Remember This: the command marks the exchange in its own chat', () => {
    const c = commands();
    const set = vi.fn(() => true);
    registerOffRecordCommand(c, { getSessions: () => [{ id: 's1', messages: [{ request: { requestId: 'r1' } }] }, { id: 's2', messages: [{ request: { requestId: 'r2' } }] }], setRequestOffRecord: set });
    expect(c.map.get('chat.setOffRecord')!('r2', true)).toBe(true);
    expect(set).toHaveBeenCalledWith('s2', 'r2', true);
    expect(c.map.get('chat.setOffRecord')!('nowhere', true)).toBe(false);
  });

  it('the marked exchanges become a rule for later turns: write nothing from them to memory', () => {
    expect(offRecordRule([{ request: { text: 'hello' } }])).toBeUndefined();
    const rule = offRecordRule([{ request: { text: 'My salary is 90k' } }, { request: { text: 'Plan my week', offRecord: false } }, { request: { text: 'I am  moving\nto Denver', offRecord: true } }])!;
    expect(rule).toMatch(/Write nothing from them to memory/);
    expect(rule).toContain('"I am moving to Denver"');
    expect(rule).not.toContain('salary');
  });
});
