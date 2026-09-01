// @vitest-environment jsdom
//
// workflowThumbnail.test.ts — the gallery's miniature graphs. Pins: real
// nodes and edges become rects and paths with finite geometry, families
// carry their class, unknown edge endpoints are skipped (never a throw),
// and a degenerate graph still yields a valid svg.

import { describe, expect, it } from 'vitest';
import { renderWorkflowThumbnail } from '../../src/built-in/autonomy-log/workflowThumbnail';
import { WORKFLOW_TEMPLATES } from '../../src/services/workflows/workflowLibrary';
import type { WorkflowNode } from '../../src/services/workflows/workflowTypes';

describe('renderWorkflowThumbnail', () => {
  it('renders every template as nodes + edges with a finite viewBox', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const svg = renderWorkflowThumbnail(t.nodes, t.edges);
      expect(svg.querySelectorAll('.wf-thumb__node').length).toBe(t.nodes.length);
      expect(svg.querySelectorAll('.wf-thumb__edge').length).toBe(t.edges.length);
      const vb = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
      expect(vb).toHaveLength(4);
      for (const v of vb) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('families carry their class for the token colors', () => {
    const nodes: WorkflowNode[] = [
      { id: 't', label: 'T', kind: 'trigger.manual', x: 0, y: 0 },
      { id: 'c', label: 'C', kind: 'control.cooldown', hours: 1, x: 100, y: 0 },
      { id: 'a', label: 'A', kind: 'action.notify', message: 'x', x: 200, y: 0 },
    ];
    const svg = renderWorkflowThumbnail(nodes, []);
    expect(svg.querySelector('.wf-thumb__node.is-trigger')).toBeTruthy();
    expect(svg.querySelector('.wf-thumb__node.is-control')).toBeTruthy();
    expect(svg.querySelector('.wf-thumb__node.is-action')).toBeTruthy();
  });

  it('unknown edge endpoints are skipped; an empty graph is a valid svg', () => {
    const nodes: WorkflowNode[] = [{ id: 'a', label: 'A', kind: 'trigger.manual', x: 0, y: 0 }];
    const svg = renderWorkflowThumbnail(nodes, [{ from: 'a', to: 'ghost' }]);
    expect(svg.querySelectorAll('.wf-thumb__edge').length).toBe(0);
    const empty = renderWorkflowThumbnail([], []);
    expect(empty.getAttribute('viewBox')).toBeTruthy();
  });
});
