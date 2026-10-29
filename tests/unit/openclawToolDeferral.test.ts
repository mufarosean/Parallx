// openclawToolDeferral.test.ts — a long tool list goes behind tool_search.
import { describe, it, expect } from 'vitest';
import type { IToolDefinition } from '../../src/services/chatTypes';
import { DEFER_ABOVE_TOKENS, TOOL_SEARCH_NAME, catalogLine, loadedTools, planToolSurface, runToolSearch, toolTokens } from '../../src/openclaw/openclawToolDeferral';

const tool = (name: string, description: string, extra: Partial<IToolDefinition> = {}): IToolDefinition => ({
  name, description, parameters: { type: 'object', properties: { text: { type: 'string', description: 'x'.repeat(400) } } }, ...extra,
});
/** Enough tools to pass the deferral line, a few always loaded. */
function bigList(): IToolDefinition[] {
  const list = [
    tool('fs_read_file', 'Read a file.', { alwaysLoad: true }),
    tool('canvas_read_page', 'Read a canvas page.', { alwaysLoad: true }),
    tool('planner_captureEvent', 'Create a calendar event on the planner with a start and end time.'),
    tool('budget_summary', 'Summarise spending by category for a month.', { displaySummary: 'Spending by category for a month.' }),
    tool('cron_add', 'Schedule a recurring job that runs an agent turn.'),
  ];
  for (let i = 0; list.length < 60; i++) list.push(tool(`extra_tool_${i}`, `Does extra thing number ${i} for testing.`));
  return list;
}

describe('which tools a model call carries', () => {
  it('sends everything while the list is small', () => {
    const small = [tool('a', 'A.'), tool('b', 'B.')];
    expect(toolTokens(small)).toBeLessThan(DEFER_ABOVE_TOKENS);
    const s = planToolSurface(small, new Set());
    expect(s.send).toEqual(small);
    expect(s.deferred).toEqual([]);
  });

  it('defers a long list: the always-loaded tools, then tool_search naming the rest', () => {
    const list = bigList();
    expect(toolTokens(list)).toBeGreaterThan(DEFER_ABOVE_TOKENS);
    const s = planToolSurface(list, new Set());
    expect(s.send.map((d) => d.name)).toEqual(['fs_read_file', 'canvas_read_page', TOOL_SEARCH_NAME]);
    expect(s.deferred).toHaveLength(list.length - 2);
    const catalog = s.send[2].description;
    expect(catalog).toContain('planner_captureEvent: Create a calendar event on the planner with a start and end time.');
    expect(catalog).toContain('budget_summary: Spending by category for a month.'); // its own short summary
    expect(toolTokens(s.send)).toBeLessThan(toolTokens(list) / 2);
  });

  it('sends everything when deferral is off', () => {
    const list = bigList();
    expect(planToolSurface(list, new Set(), false).send).toEqual(list);
  });

  it('a loaded tool rides along from then on', () => {
    const list = bigList();
    const s = planToolSurface(list, new Set(['cron_add']));
    expect(s.send.map((d) => d.name)).toContain('cron_add');
    expect(s.deferred.map((d) => d.name)).not.toContain('cron_add');
  });
});

describe('tool_search', () => {
  it('loads tools by exact name and says what they do', () => {
    const { deferred } = planToolSurface(bigList(), new Set());
    const loaded = new Set<string>();
    const r = runToolSearch({ names: ['Planner_CaptureEvent', 'nope_tool'] }, deferred, loaded);
    expect(r.loaded).toEqual(['planner_captureEvent']);
    expect([...loaded]).toEqual(['planner_captureEvent']);
    expect(r.content).toContain('planner_captureEvent: Create a calendar event');
    expect(r.content).toContain('Not found: nope_tool.');
  });

  it('finds tools by what they do, names counting most', () => {
    const { deferred } = planToolSurface(bigList(), new Set());
    const r = runToolSearch({ query: 'schedule a recurring job' }, deferred, new Set());
    expect(r.loaded[0]).toBe('cron_add');
    expect(runToolSearch({ query: 'add an event to my calendar' }, deferred, new Set()).loaded[0]).toBe('planner_captureEvent');
  });

  it('says so when nothing matches', () => {
    const { deferred } = planToolSurface(bigList(), new Set());
    const r = runToolSearch({ query: 'zzz qqq' }, deferred, new Set());
    expect(r.loaded).toEqual([]);
    expect(r.content).toMatch(/No tool matched/);
  });

  it('remembers what each chat loaded, separately', () => {
    loadedTools('chat-a').add('cron_add');
    expect(loadedTools('chat-a').has('cron_add')).toBe(true);
    expect(loadedTools('chat-b').has('cron_add')).toBe(false);
  });

  it('a catalog line is one short sentence', () => {
    const line = catalogLine(tool('x_tool', `${'Long words here. '.repeat(3)}And then a second sentence that should not appear.`));
    expect(line).toBe('x_tool: Long words here.');
  });
});
