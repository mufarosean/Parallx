// workflowGraph.test.ts — the pure graph semantics under the workflows
// program (docs/WORKFLOWS_BRIEF.md). Everything the runner trusts is
// pinned here: validation catches every malformed shape, execution order
// is deterministic, gates know their downstream, and placeholders never
// silently vanish.

import { describe, expect, it } from 'vitest';
import {
  describeTriggerNode,
  downstreamOf,
  executionOrder,
  interpolate,
  validateWorkflow,
} from '../../src/services/workflows/workflowGraph';
import type { WorkflowDoc, WorkflowNode, WorkflowEdge } from '../../src/services/workflows/workflowTypes';

function doc(nodes: WorkflowNode[], edges: WorkflowEdge[] = [], name = 'Test'): WorkflowDoc {
  return {
    id: 'wf-1', name, class: 'quiet', enabled: true,
    nodes, edges, source: 'user', createdAt: 0, updatedAt: 0,
  };
}

const trigger = (id = 't1'): WorkflowNode => ({ id, label: 'Daily', kind: 'trigger.schedule', spec: { kind: 'daily', time: '08:00' } });
const notify = (id = 'a1', message = 'Hello'): WorkflowNode => ({ id, label: 'Notify', kind: 'action.notify', message });
const cooldown = (id = 'c1', hours = 24): WorkflowNode => ({ id, label: 'Cooldown', kind: 'control.cooldown', hours });

describe('validateWorkflow', () => {
  it('accepts the canonical two-node graph (schedule → notify)', () => {
    const v = validateWorkflow(doc([trigger(), notify()], [{ from: 't1', to: 'a1' }]));
    expect(v.ok).toBe(true);
    expect(v.isDraft).toBe(false);
  });

  it('a workflow with no trigger is a DRAFT, not an error', () => {
    const v = validateWorkflow(doc([notify()], []));
    expect(v.isDraft).toBe(true);
  });

  it('rejects edges into a trigger', () => {
    const v = validateWorkflow(doc([trigger(), notify()], [{ from: 'a1', to: 't1' }]));
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('trigger');
  });

  it('rejects cycles', () => {
    const v = validateWorkflow(doc(
      [trigger(), notify('a1'), notify('a2')],
      [{ from: 't1', to: 'a1' }, { from: 'a1', to: 'a2' }, { from: 'a2', to: 'a1' }],
    ));
    expect(v.errors.join(' ')).toContain('cycle');
  });

  it('duplicate ids and unknown edge endpoints are ERRORS; empty payloads WARN', () => {
    // The split is the editing contract: structural corruption blocks the
    // save; a half-filled node is normal mid-edit truth and must store.
    const v = validateWorkflow(doc(
      [trigger(), notify('a1', '  '), { ...notify('a1'), id: 'a1' }],
      [{ from: 't1', to: 'ghost' }],
    ));
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('Duplicate');
    expect(v.errors.join(' ')).toContain('ghost');
    expect(v.warnings.join(' ')).toContain('empty message');
    expect(v.errors.join(' ')).not.toContain('empty message');
  });

  it('nodes unreachable from any trigger WARN (you add, then connect)', () => {
    const v = validateWorkflow(doc([trigger(), notify('a1'), notify('a2')], [{ from: 't1', to: 'a1' }]));
    expect(v.errors).toEqual([]);
    expect(v.warnings.join(' ')).toContain('never run');
  });

  it('an unfiltered event trigger WARNS — it would match everything', () => {
    const v = validateWorkflow(doc(
      [{ id: 't1', label: 'Any', kind: 'trigger.event' }, notify()],
      [{ from: 't1', to: 'a1' }],
    ));
    expect(v.errors).toEqual([]);
    expect(v.warnings.join(' ')).toContain('filter');
  });

  it('a durationless cooldown WARNS and reads as an open gate', () => {
    const v = validateWorkflow(doc([trigger(), cooldown('c1', 0), notify()],
      [{ from: 't1', to: 'c1' }, { from: 'c1', to: 'a1' }]));
    expect(v.errors).toEqual([]);
    expect(v.warnings.join(' ')).toContain('always open');
  });
});

describe('executionOrder', () => {
  it('walks breadth-first in edge order, each node once', () => {
    const d = doc(
      [trigger(), notify('a1'), notify('a2'), notify('a3')],
      [
        { from: 't1', to: 'a1' },
        { from: 't1', to: 'a2' },
        { from: 'a1', to: 'a3' },
        { from: 'a2', to: 'a3' }, // diamond — a3 visited once
      ],
    );
    expect(executionOrder(d, 't1')).toEqual(['a1', 'a2', 'a3']);
  });

  it('ignores nodes hanging off other triggers', () => {
    const d = doc(
      [trigger('t1'), { id: 't2', label: 'Manual', kind: 'trigger.manual' }, notify('a1'), notify('a2')],
      [{ from: 't1', to: 'a1' }, { from: 't2', to: 'a2' }],
    );
    expect(executionOrder(d, 't1')).toEqual(['a1']);
    expect(executionOrder(d, 't2')).toEqual(['a2']);
  });

  it('downstreamOf a gate covers exactly what the gate protects', () => {
    const d = doc(
      [trigger(), cooldown(), notify('a1'), notify('a2')],
      [{ from: 't1', to: 'c1' }, { from: 'c1', to: 'a1' }, { from: 't1', to: 'a2' }],
    );
    const down = downstreamOf(d, 'c1');
    expect(down.has('a1')).toBe(true);
    expect(down.has('a2')).toBe(false); // parallel branch is NOT gated
  });
});

describe('interpolate', () => {
  const ctx = { kind: 'trigger.event', summary: 'Planner task added', event: { verb: 'created', actor: 'user', count: 3 } };

  it('fills trigger and event placeholders', () => {
    expect(interpolate('{{trigger.summary}} by {{event.actor}} ({{event.count}})', ctx))
      .toBe('Planner task added by user (3)');
  });

  it('leaves unknown placeholders VERBATIM — typos stay visible', () => {
    expect(interpolate('{{event.nope}} and {{garbage}}', ctx)).toBe('{{event.nope}} and {{garbage}}');
  });

  it('handles a context with no event payload', () => {
    expect(interpolate('{{trigger.kind}}: {{event.x}}', { kind: 'trigger.manual', summary: 's' }))
      .toBe('trigger.manual: {{event.x}}');
  });
});

describe('describeTriggerNode', () => {
  it('speaks human for every trigger shape', () => {
    expect(describeTriggerNode(trigger())).toBe('Every day at 08:00');
    expect(describeTriggerNode({ id: 't', label: 'M', kind: 'trigger.manual' })).toBe('Run manually');
    expect(describeTriggerNode({ id: 't', label: 'E', kind: 'trigger.event', source: 'planner', verb: 'created' }))
      .toBe('On planner · created');
  });
});
