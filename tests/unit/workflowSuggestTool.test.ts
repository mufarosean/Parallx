/**
 * workflow_suggest: the agent files a disabled suggested workflow instead of
 * offering it in prose. Dedupe on the key, dismissed keys stay dismissed, a
 * daily cap, never enabled, and every trigger shape validated.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_SUGGESTION_PREFIX,
  agentSuggestionKey,
  createWorkflowSuggestTool,
  type IWorkflowSuggestionSink,
} from '../../src/built-in/chat/tools/workflowTools';
import type { WorkflowDoc } from '../../src/services/workflows/workflowTypes';
import type { ICancellationToken } from '../../src/services/chatTypes';

const TOKEN = {} as ICancellationToken;
const NOON = new Date(2026, 8, 6, 12, 0, 0).getTime();

function fakeSink(opts: { dismissed?: string[]; now?: () => number } = {}) {
  const docs: WorkflowDoc[] = [];
  const dismissed = new Set(opts.dismissed ?? []);
  let id = 1;
  const sink: IWorkflowSuggestionSink = {
    get workflows() { return docs; },
    addWorkflow(doc) {
      if (doc.source === 'suggested' && doc.suggestedFrom && dismissed.has(doc.suggestedFrom)) throw new Error('dismissed');
      const t = (opts.now ?? (() => NOON))();
      const full: WorkflowDoc = { ...doc, id: `wf-${id++}`, createdAt: t, updatedAt: t };
      docs.push(full);
      return full;
    },
    isSuggestionDismissed: (key) => dismissed.has(key),
  };
  return { sink, docs };
}

const ASK = {
  key: 'Weekly Budget Summary',
  name: 'Weekly Budget Summary',
  why: 'You asked for a spending summary three Fridays in a row.',
  mission: 'Summarise the week of spending from the budget ledger on a canvas page titled "Week in Money".',
};

describe('workflow_suggest', () => {
  it('files a disabled suggested workflow with a manual trigger by default', async () => {
    const { sink, docs } = fakeSink();
    const res = await createWorkflowSuggestTool(() => sink).handler(ASK, TOKEN);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('Weekly Budget Summary');
    expect(docs).toHaveLength(1);
    const wf = docs[0];
    expect(wf.enabled).toBe(false);
    expect(wf.source).toBe('suggested');
    expect(wf.class).toBe('quiet');
    expect(wf.description).toBe(ASK.why);
    expect(wf.suggestedFrom).toBe(`${AGENT_SUGGESTION_PREFIX}weekly budget summary`);
    expect(wf.nodes.map((n) => n.kind)).toEqual(['trigger.manual', 'context.facts', 'action.agentTurn']);
    expect((wf.nodes[2] as { prompt: string }).prompt).toBe(ASK.mission);
    expect(wf.edges).toEqual([{ from: 't', to: 'c' }, { from: 'c', to: 'g' }]);
  });

  it('normalises the key: spacing and case never make a second idea', () => {
    expect(agentSuggestionKey('  Weekly   Budget summary ')).toBe('agent:weekly budget summary');
  });

  it('never files the same key twice, whether it is still waiting or already adopted', async () => {
    const { sink, docs } = fakeSink();
    const tool = createWorkflowSuggestTool(() => sink);
    await tool.handler(ASK, TOKEN);
    const again = await tool.handler({ ...ASK, key: 'weekly  budget SUMMARY' }, TOKEN);
    expect(again.isError).toBeFalsy();
    expect(again.content).toContain('Do not suggest it again');
    expect(docs).toHaveLength(1);
    // The user pressed Add: source becomes user, the key stays as the memory.
    docs[0] = { ...docs[0], source: 'user', enabled: true };
    const adopted = await tool.handler(ASK, TOKEN);
    expect(adopted.content).toContain("already one of the user's workflows");
    expect(docs).toHaveLength(1);
  });

  it('a dismissed key is refused without touching the service', async () => {
    const { sink, docs } = fakeSink({ dismissed: ['agent:weekly budget summary'] });
    const res = await createWorkflowSuggestTool(() => sink).handler(ASK, TOKEN);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('dismissed');
    expect(docs).toHaveLength(0);
  });

  it('stops after the daily cap and starts again tomorrow', async () => {
    let now = NOON;
    const { sink, docs } = fakeSink({ now: () => now });
    const tool = createWorkflowSuggestTool(() => sink, { maxPerDay: 2, now: () => now });
    expect((await tool.handler({ ...ASK, key: 'a' }, TOKEN)).isError).toBeFalsy();
    expect((await tool.handler({ ...ASK, key: 'b' }, TOKEN)).isError).toBeFalsy();
    const third = await tool.handler({ ...ASK, key: 'c' }, TOKEN);
    expect(third.content).toContain('Enough suggestions for today');
    expect(docs).toHaveLength(2);
    now = NOON + 24 * 60 * 60 * 1000;
    expect((await tool.handler({ ...ASK, key: 'c' }, TOKEN)).isError).toBeFalsy();
    expect(docs).toHaveLength(3);
  });

  it('builds every trigger shape and rejects malformed ones', async () => {
    const { sink, docs } = fakeSink();
    const tool = createWorkflowSuggestTool(() => sink, { maxPerDay: 10 });
    await tool.handler({ ...ASK, key: 'd', trigger: { kind: 'daily', time: '08:05' } }, TOKEN);
    await tool.handler({ ...ASK, key: 'w', trigger: { kind: 'weekly', day: 5, time: '17:30' } }, TOKEN);
    await tool.handler({ ...ASK, key: 'i', trigger: { kind: 'interval', every: '2h' } }, TOKEN);
    await tool.handler({ ...ASK, key: 'e', trigger: { kind: 'event', source: 'canvas', verb: 'created' } }, TOKEN);
    expect(docs.map((d) => d.nodes[0])).toMatchObject([
      { kind: 'trigger.schedule', spec: { kind: 'daily', time: '08:05' } },
      { kind: 'trigger.schedule', spec: { kind: 'weekly', day: 5, time: '17:30' } },
      { kind: 'trigger.schedule', spec: { kind: 'interval', every: '2h' } },
      { kind: 'trigger.event', source: 'canvas', verb: 'created' },
    ]);
    expect((await tool.handler({ ...ASK, key: 'x1', trigger: { kind: 'daily', time: '8am' } }, TOKEN)).isError).toBe(true);
    expect((await tool.handler({ ...ASK, key: 'x2', trigger: { kind: 'weekly', day: 9, time: '08:00' } }, TOKEN)).isError).toBe(true);
    expect((await tool.handler({ ...ASK, key: 'x3', trigger: { kind: 'interval', every: 'sometimes' } }, TOKEN)).isError).toBe(true);
    expect((await tool.handler({ ...ASK, key: 'x4', trigger: { kind: 'event' } }, TOKEN)).isError).toBe(true);
    expect((await tool.handler({ ...ASK, key: 'x5', trigger: { kind: 'yearly' } }, TOKEN)).isError).toBe(true);
    expect(docs).toHaveLength(4);
  });

  it('attention: true files an attention-class draft, still disabled', async () => {
    const { sink, docs } = fakeSink();
    await createWorkflowSuggestTool(() => sink).handler({ ...ASK, attention: true }, TOKEN);
    expect(docs[0].class).toBe('attention');
    expect(docs[0].enabled).toBe(false);
  });

  it('requires key, name, why and mission', async () => {
    const { sink, docs } = fakeSink();
    const tool = createWorkflowSuggestTool(() => sink);
    for (const missing of ['key', 'name', 'why', 'mission'] as const) {
      const args: Record<string, unknown> = { ...ASK };
      delete args[missing];
      const res = await tool.handler(args, TOKEN);
      expect(res.isError).toBe(true);
      expect(res.content).toContain(missing);
    }
    expect(docs).toHaveLength(0);
  });

  it('explains itself when workflows are unavailable', async () => {
    const res = await createWorkflowSuggestTool(() => null).handler(ASK, TOKEN);
    expect(res.isError).toBe(true);
    expect(res.content).toContain('not available');
  });
});
