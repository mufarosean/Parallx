// workflowThumbnail.ts — a workflow's graph as a miniature SVG.
//
// The gallery's cards show the REAL shape of what you're installing —
// the template's actual nodes and edges scaled down, families colored —
// because a picture of the graph explains "workflow" faster than any
// sentence. Pure DOM construction; colors come from CSS classes so the
// tokens own them.

import type { WorkflowEdge, WorkflowNode } from '../../services/workflows/workflowTypes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Un-scaled node box (matches the editor's card proportions, roughly). */
const NODE_W = 96;
const NODE_H = 34;
const PAD = 14;

function familyOf(kind: WorkflowNode['kind']): 'trigger' | 'context' | 'control' | 'action' {
  if (kind.startsWith('trigger.')) return 'trigger';
  if (kind.startsWith('context.')) return 'context';
  if (kind.startsWith('control.')) return 'control';
  return 'action';
}

/**
 * Render nodes+edges into an SVG that fills its container (viewBox-scaled).
 * Never throws on degenerate input; an empty graph yields an empty svg.
 */
export function renderWorkflowThumbnail(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'wf-thumb');
  if (nodes.length === 0) {
    svg.setAttribute('viewBox', '0 0 100 40');
    return svg;
  }

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    pos.set(n.id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + NODE_W);
    maxY = Math.max(maxY, y + NODE_H);
  }
  svg.setAttribute('viewBox', `${minX - PAD} ${minY - PAD} ${maxX - minX + 2 * PAD} ${maxY - minY + 2 * PAD}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Edges under nodes — soft cubic curves between box centers' facing sides.
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const bend = Math.max(18, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'wf-thumb__edge');
    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    svg.appendChild(path);
  }

  for (const n of nodes) {
    const p = pos.get(n.id)!;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', `wf-thumb__node is-${familyOf(n.kind)}`);
    rect.setAttribute('x', String(p.x));
    rect.setAttribute('y', String(p.y));
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', '6');
    svg.appendChild(rect);
    // One "text" bar suggests the label without unreadable 6px type.
    const bar = document.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('class', 'wf-thumb__bar');
    bar.setAttribute('x', String(p.x + 10));
    bar.setAttribute('y', String(p.y + NODE_H / 2 - 2.5));
    bar.setAttribute('width', String(NODE_W - 34));
    bar.setAttribute('height', '5');
    bar.setAttribute('rx', '2.5');
    svg.appendChild(bar);
  }
  return svg;
}
