// workflowRunner.test.ts — the run semantics. What these pins hold, in
// order of importance: the cooldown ledger stamps ONLY on delivered
// success (a failure must retry next firing), destructive workflows
// never act without an approver, an error skips its own downstream but
// not parallel branches, notify is never gated, and every node leaves a
// trace no matter what happened.

import { describe, expect, it, vi } from 'vitest';
import { executeWorkflowRun, type CooldownLedger, type WorkflowExecutionDeps } from '../../src/services/workflows/workflowRunner';
import type { WorkflowDoc, WorkflowNode, WorkflowEdge, WorkflowClass } from '../../src/services/workflows/workflowTypes';

function doc(nodes: WorkflowNode[], edges: WorkflowEdge[], cls: WorkflowClass = 'quiet'): WorkflowDoc {
  return { id: 'wf-1', name: 'Test Flow', class: cls, enabled: true, nodes, edges, source: 'user', createdAt: 0, updatedAt: 0 };
}

const trigger: WorkflowNode = { id: 't', label: 'Manual', kind: 'trigger.manual' };
const ctx = { kind: 'trigger.manual', summary: 'run now' };

function makeDeps(over: Partial<WorkflowExecutionDeps> = {}): WorkflowExecutionDeps {
  return {
    runAgentTurn: vi.fn(async () => 'the model answered'),
    runCommand: vi.fn(async () => undefined),
    runTool: vi.fn(async () => ({ content: 'tool ok' })),
    notify: vi.fn(),
    ...over,
  };
}

function makeLedger(initial: Record<string, number> = {}): CooldownLedger & { stamps: string[] } {
  const at = new Map(Object.entries(initial));
  const stamps: string[] = [];
  return {
    stamps,
    sinceStamp: (k) => (at.has(k) ? Date.now() - at.get(k)! : null),
    stamp: (k) => { stamps.push(k); at.set(k, Date.now()); },
  };
}

describe('the canonical two-node run', () => {
  it('schedule → notify delivers and records a full trace', async () => {
    const deps = makeDeps();
    const run = await executeWorkflowRun(
      doc([trigger, { id: 'n', label: 'Tell me', kind: 'action.notify', message: 'Fired: {{trigger.summary}}' }],
        [{ from: 't', to: 'n' }]),
      trigger, ctx, deps, makeLedger(),
    );
    expect(run.status).toBe('ok');
    expect(deps.notify).toHaveBeenCalledWith('Fired: run now', { id: 'wf-1', name: 'Test Flow' });
    expect(run.nodes).toHaveLength(1);
    expect(run.nodes[0]).toMatchObject({ nodeId: 'n', status: 'ok' });
  });
});

describe('cooldown semantics (the heartbeat ledger, generalised)', () => {
  const graph = (): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => ({
    nodes: [
      trigger,
      { id: 'c', label: 'Cool', kind: 'control.cooldown', hours: 24 },
      { id: 'n', label: 'Notify', kind: 'action.notify', message: 'hi' },
    ],
    edges: [{ from: 't', to: 'c' }, { from: 'c', to: 'n' }],
  });

  it('inside the window: downstream held, run status = cooldown, no re-stamp', async () => {
    const { nodes, edges } = graph();
    const ledger = makeLedger({ 'wf-1:default': Date.now() - 3_600_000 }); // 1h ago, 24h window
    const deps = makeDeps();
    const run = await executeWorkflowRun(doc(nodes, edges), trigger, ctx, deps, ledger);
    expect(run.status).toBe('cooldown');
    expect(deps.notify).not.toHaveBeenCalled();
    expect(ledger.stamps).toEqual([]);
    expect(run.nodes.find((n) => n.nodeId === 'c')!.status).toBe('gated');
    expect(run.nodes.find((n) => n.nodeId === 'n')!.status).toBe('skipped');
  });

  it('open window: action delivers and the ledger is stamped', async () => {
    const { nodes, edges } = graph();
    const ledger = makeLedger();
    const run = await executeWorkflowRun(doc(nodes, edges), trigger, ctx, makeDeps(), ledger);
    expect(run.status).toBe('ok');
    expect(ledger.stamps).toEqual(['wf-1:default']);
  });

  it('a FAILED delivery never stamps — next firing retries', async () => {
    const nodes: WorkflowNode[] = [
      trigger,
      { id: 'c', label: 'Cool', kind: 'control.cooldown', hours: 24 },
      { id: 'a', label: 'Tool', kind: 'action.tool', toolName: 'broken_tool' },
    ];
    const edges = [{ from: 't', to: 'c' }, { from: 'c', to: 'a' }];
    const ledger = makeLedger();
    const deps = makeDeps({ runTool: vi.fn(async () => { throw new Error('boom'); }) });
    const run = await executeWorkflowRun(doc(nodes, edges), trigger, ctx, deps, ledger);
    expect(run.status).toBe('error');
    expect(ledger.stamps).toEqual([]);
  });
});

describe('failure isolation', () => {
  it('an error skips ITS downstream; the parallel branch still delivers', async () => {
    const nodes: WorkflowNode[] = [
      trigger,
      { id: 'bad', label: 'Broken', kind: 'action.tool', toolName: 'x' },
      { id: 'after', label: 'After Broken', kind: 'action.notify', message: 'never' },
      { id: 'side', label: 'Side', kind: 'action.notify', message: 'still here' },
    ];
    const edges = [
      { from: 't', to: 'bad' }, { from: 'bad', to: 'after' }, { from: 't', to: 'side' },
    ];
    const deps = makeDeps({ runTool: vi.fn(async () => ({ content: 'nope', isError: true })) });
    const run = await executeWorkflowRun(doc(nodes, edges), trigger, ctx, deps, makeLedger());
    expect(run.status).toBe('error');
    expect(run.nodes.find((n) => n.nodeId === 'after')!.status).toBe('skipped');
    expect(run.nodes.find((n) => n.nodeId === 'side')!.status).toBe('ok');
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith('still here', expect.anything());
  });
});

describe('the destructive class', () => {
  const graph = (): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => ({
    nodes: [trigger, { id: 'a', label: 'Delete Things', kind: 'action.command', commandId: 'x.y' }],
    edges: [{ from: 't', to: 'a' }],
  });

  it('without an approver every action is GATED — never silently run', async () => {
    const { nodes, edges } = graph();
    const deps = makeDeps();
    const run = await executeWorkflowRun(doc(nodes, edges, 'destructive'), trigger, ctx, deps, makeLedger());
    expect(run.status).toBe('gated');
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('an approver saying yes lets the action run; saying no gates it', async () => {
    const { nodes, edges } = graph();
    const yes = makeDeps({ requestApproval: vi.fn(async () => true) });
    const yesRun = await executeWorkflowRun(doc(nodes, edges, 'destructive'), trigger, ctx, yes, makeLedger());
    expect(yesRun.status).toBe('ok');
    expect(yes.runCommand).toHaveBeenCalledWith('x.y', [], 'workflow:wf-1');

    const no = makeDeps({ requestApproval: vi.fn(async () => false) });
    const noRun = await executeWorkflowRun(doc(nodes, edges, 'destructive'), trigger, ctx, no, makeLedger());
    expect(noRun.status).toBe('gated');
    expect(no.runCommand).not.toHaveBeenCalled();
  });

  it('notify is NEVER approval-gated — telling the user is always allowed', async () => {
    const nodes: WorkflowNode[] = [trigger, { id: 'n', label: 'Tell', kind: 'action.notify', message: 'heads up' }];
    const deps = makeDeps(); // no approver
    const run = await executeWorkflowRun(
      doc(nodes, [{ from: 't', to: 'n' }], 'destructive'), trigger, ctx, deps, makeLedger());
    expect(run.status).toBe('ok');
    expect(deps.notify).toHaveBeenCalled();
  });
});

describe('budgets and interpolation', () => {
  it('the agent-turn budget stops a runaway graph', async () => {
    const nodes: WorkflowNode[] = [trigger];
    const edges: WorkflowEdge[] = [];
    for (let i = 0; i < 5; i++) {
      nodes.push({ id: `g${i}`, label: `Turn ${i}`, kind: 'action.agentTurn', prompt: 'go' });
      edges.push({ from: i === 0 ? 't' : `g${i - 1}`, to: `g${i}` });
    }
    const deps = makeDeps();
    const run = await executeWorkflowRun(doc(nodes, edges), trigger, ctx, deps, makeLedger());
    expect(deps.runAgentTurn).toHaveBeenCalledTimes(3);
    expect(run.status).toBe('error');
    expect(run.nodes.find((n) => n.nodeId === 'g3')!.error).toContain('budget');
  });

  it('agent-turn prompts carry interpolated trigger context', async () => {
    const deps = makeDeps();
    await executeWorkflowRun(
      doc([trigger, { id: 'g', label: 'Ask', kind: 'action.agentTurn', prompt: 'Handle: {{trigger.summary}}' }],
        [{ from: 't', to: 'g' }]),
      trigger, ctx, deps, makeLedger(),
    );
    expect(deps.runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Handle: run now' }));
  });
});
