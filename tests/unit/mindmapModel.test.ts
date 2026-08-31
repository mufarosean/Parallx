// mindmapModel.test.ts — behavioural pins for the mindmap document module.
//
// The invariant that matters most (MINDMAP_BRIEF: "the AI drafts, the human
// shapes"): layoutNewNodes NEVER moves an existing node. autoLayout is the
// only repositioner and runs on user request only — these tests hold that
// boundary, plus parse hygiene and outline merging.

import { describe, expect, it } from 'vitest';
import {
  assignBranchColors,
  autoLayout,
  childrenOf,
  docToOutlineText,
  emptyMindmapDoc,
  estimateNodeSize,
  layoutNewNodes,
  mergeOutline,
  parseMindmapDoc,
  placeChild,
  primaryParent,
  rootOf,
  serializeMindmapDoc,
  type MindmapDoc,
} from '../../src/built-in/canvas/mindmap/mindmapModel';
import { renderMindmapSvg } from '../../src/built-in/canvas/mindmap/mindmapSvg';
import { extractOutlineJson } from '../../src/built-in/canvas/ai/mindmapTools';

function doc(nodes: Array<[string, string, number, number]>, edges: Array<[string, string]> = []): MindmapDoc {
  return {
    version: 1,
    nodes: nodes.map(([id, label, x, y]) => ({ id, label, x, y, color: 'neutral' as const, ref: null })),
    edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to, label: null })),
  };
}

describe('parse hygiene', () => {
  it('round-trips a document', () => {
    const d = doc([['a', 'Root', 0, 0], ['b', 'Child', 100, 50]], [['a', 'b']]);
    expect(parseMindmapDoc(serializeMindmapDoc(d))).toEqual(d);
  });

  it('drops dangling and self-loop edges, keeps first duplicate id', () => {
    const parsed = parseMindmapDoc(JSON.stringify({
      nodes: [
        { id: 'a', label: 'One', x: 0, y: 0 },
        { id: 'a', label: 'Dup', x: 9, y: 9 },
        { id: 'b', label: 'Two', x: 1, y: 1 },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'a', to: 'missing' },
        { id: 'e3', from: 'b', to: 'b' },
      ],
    }));
    expect(parsed.nodes.map((n) => n.label)).toEqual(['One', 'Two']);
    expect(parsed.edges).toHaveLength(1);
  });

  it('clamps unknown colors and non-finite positions', () => {
    const parsed = parseMindmapDoc(JSON.stringify({
      nodes: [{ id: 'a', label: 'X', x: 'nope', y: null, color: 'chartreuse' }],
    }));
    expect(parsed.nodes[0]).toMatchObject({ x: 0, y: 0, color: 'neutral' });
  });

  it('garbage yields a one-node map, never a throw', () => {
    const parsed = parseMindmapDoc('{{{not json');
    expect(parsed.nodes).toHaveLength(1);
  });
});

describe('structure', () => {
  it('rootOf picks the parentless node that reaches the most descendants', () => {
    const d = doc(
      [['iso', 'Island', 0, 0], ['r', 'Root', 0, 0], ['c1', 'A', 0, 0], ['c2', 'B', 0, 0]],
      [['r', 'c1'], ['c1', 'c2']],
    );
    expect(rootOf(d)).toBe('r');
    expect(primaryParent(d, 'c1')).toBe('r');
    expect(childrenOf(d, 'r')).toEqual(['c1']);
  });
});

describe('autoLayout', () => {
  const sample = (): MindmapDoc => {
    const base = doc(
      [['r', 'Mind Mapping', 0, 0], ['a', 'Habits', 0, 0], ['b', 'Goals', 0, 0],
       ['a1', 'Plan', 0, 0], ['a2', 'Study', 0, 0], ['b1', 'Research', 0, 0]],
      [['r', 'a'], ['r', 'b'], ['a', 'a1'], ['a', 'a2'], ['b', 'b1']],
    );
    return base;
  };

  it('is deterministic and separates every node box', () => {
    const l1 = autoLayout(sample());
    const l2 = autoLayout(sample());
    expect(l1).toEqual(l2);
    for (let i = 0; i < l1.nodes.length; i++) {
      for (let j = i + 1; j < l1.nodes.length; j++) {
        const a = { ...l1.nodes[i], ...estimateNodeSize(l1.nodes[i].label) };
        const b = { ...l1.nodes[j], ...estimateNodeSize(l1.nodes[j].label) };
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap, `${l1.nodes[i].label} overlaps ${l1.nodes[j].label}`).toBe(false);
      }
    }
  });

  it('balances branches onto both sides of the root', () => {
    const laid = autoLayout(sample());
    const root = laid.nodes.find((n) => n.id === 'r')!;
    const branches = laid.nodes.filter((n) => ['a', 'b'].includes(n.id));
    const sides = new Set(branches.map((n) => Math.sign(n.x - root.x)));
    expect(sides.size).toBe(2); // one left, one right
  });
});

describe('layoutNewNodes — the no-clobber rule', () => {
  it('positions only the listed nodes; every other node stays exactly put', () => {
    const base = autoLayout(doc(
      [['r', 'Root', 0, 0], ['a', 'One', 0, 0], ['b', 'Two', 0, 0]],
      [['r', 'a'], ['r', 'b']],
    ));
    // The user drags a node somewhere deliberate.
    const userMoved: MindmapDoc = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === 'a' ? { ...n, x: 555, y: -321 } : n)),
    };
    const withNew: MindmapDoc = {
      ...userMoved,
      nodes: [...userMoved.nodes, { id: 'n1', label: 'New Idea', x: 0, y: 0, color: 'neutral', ref: null }],
      edges: [...userMoved.edges, { id: 'en', from: 'a', to: 'n1', label: null }],
    };
    const laid = layoutNewNodes(withNew, new Set(['n1']));
    for (const n of userMoved.nodes) {
      const after = laid.nodes.find((x) => x.id === n.id)!;
      expect({ x: after.x, y: after.y }).toEqual({ x: n.x, y: n.y });
    }
    const placed = laid.nodes.find((n) => n.id === 'n1')!;
    expect(placed.x !== 0 || placed.y !== 0).toBe(true);
  });

  it('placeChild never lands on an existing node box', () => {
    let d = autoLayout(doc([['r', 'Root', 0, 0], ['a', 'A', 0, 0]], [['r', 'a']]));
    for (let i = 0; i < 5; i++) {
      const spot = placeChild(d, 'r');
      const size = estimateNodeSize('');
      for (const n of d.nodes) {
        const b = { ...n, ...estimateNodeSize(n.label) };
        const overlap = spot.x < b.x + b.w && spot.x + size.w > b.x && spot.y < b.y + b.h && spot.y + size.h > b.y;
        expect(overlap).toBe(false);
      }
      d = {
        ...d,
        nodes: [...d.nodes, { id: `k${i}`, label: `Kid ${i}`, x: spot.x, y: spot.y, color: 'neutral', ref: null }],
        edges: [...d.edges, { id: `ek${i}`, from: 'r', to: `k${i}`, label: null }],
      };
    }
  });
});

describe('mergeOutline', () => {
  it('resolves parents by outline id, existing id, then existing label', () => {
    const base = doc([['r', 'Reserving', 0, 0]]);
    const merged = mergeOutline(base, [
      { id: 'odp', label: 'ODP Models', parent: 'Reserving' },
      { label: 'Mack', parent: 'odp' },
      { label: 'Cross', parent: 'r' },
    ]);
    expect(merged.newNodeIds).toHaveLength(3);
    const d = merged.doc;
    const byLabel = (l: string) => d.nodes.find((n) => n.label === l)!.id;
    expect(primaryParent(d, byLabel('ODP Models'))).toBe('r');
    expect(primaryParent(d, byLabel('Mack'))).toBe(byLabel('ODP Models'));
    expect(primaryParent(d, byLabel('Cross'))).toBe('r');
  });

  it('never modifies existing nodes and reports collisions as skipped', () => {
    const base = doc([['r', 'Root', 7, 8]]);
    const merged = mergeOutline(base, [
      { id: 'r', label: 'Impostor Root' },
      { label: 'Fresh', parent: 'Root' },
    ]);
    expect(merged.skipped).toEqual(['r']);
    expect(merged.doc.nodes.find((n) => n.id === 'r')).toMatchObject({ label: 'Root', x: 7, y: 8 });
  });

  it('dedupes edges and drops self-loops', () => {
    const base = doc([['a', 'A', 0, 0], ['b', 'B', 0, 0]], [['a', 'b']]);
    const merged = mergeOutline(base, [], [
      { from: 'A', to: 'B' },
      { from: 'a', to: 'a' },
    ]);
    expect(merged.doc.edges).toHaveLength(1);
  });
});

describe('branch colors', () => {
  it('colors each root branch and its subtree, but never a chosen color', () => {
    const base = doc(
      [['r', 'Root', 0, 0], ['a', 'A', 0, 0], ['a1', 'A1', 0, 0], ['b', 'B', 0, 0]],
      [['r', 'a'], ['a', 'a1'], ['r', 'b']],
    );
    const withChoice: MindmapDoc = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === 'b' ? { ...n, color: 'blue' as const } : n)),
    };
    const colored = assignBranchColors(withChoice);
    const get = (id: string) => colored.nodes.find((n) => n.id === id)!.color;
    expect(get('r')).toBe('accent');
    expect(get('a')).not.toBe('neutral');
    expect(get('a')).toBe(get('a1')); // subtree inherits the branch color
    expect(get('b')).toBe('blue');    // user/AI-chosen color untouched
  });
});

describe('outline text & SVG snapshot', () => {
  it('docToOutlineText nests by primary parent and lists cross-links', () => {
    const d = doc(
      [['r', 'Root', 0, 0], ['a', 'A', 0, 0], ['b', 'B', 0, 0]],
      [['r', 'a'], ['r', 'b'], ['a', 'b']],
    );
    const text = docToOutlineText(d);
    expect(text).toContain('- Root');
    expect(text).toContain('  - A');
    expect(text).toContain('Cross-links:');
    expect(text).toContain('A → B');
  });

  it('renderMindmapSvg emits every node label, escaped', () => {
    const d = autoLayout(doc([['r', 'A<B & "C"', 0, 0], ['x', 'Child', 0, 0]], [['r', 'x']]));
    const svg = renderMindmapSvg(d);
    expect(svg).toContain('<svg');
    expect(svg).toContain('A&lt;B &amp; &quot;C&quot;');
    expect(svg).toContain('Child');
    expect((svg.match(/<rect/g) ?? [])).toHaveLength(2);
    expect((svg.match(/<path/g) ?? [])).toHaveLength(1);
  });
});

describe('emptyMindmapDoc', () => {
  it('seeds one accent root', () => {
    const d = emptyMindmapDoc('Exam 7');
    expect(d.nodes).toHaveLength(1);
    expect(d.nodes[0]).toMatchObject({ label: 'Exam 7', color: 'accent' });
  });
});

describe('extractOutlineJson (the Draft With AI parser)', () => {
  it('pulls the outline out of a fenced, chatty response', () => {
    const out = extractOutlineJson(
      'Sure! Here is the map:\n```json\n{"nodes":[{"label":"Root"},{"label":"Kid","parent":"Root"}],"edges":[]}\n```\nHope that helps.',
    );
    expect(out?.nodes).toHaveLength(2);
    expect(out?.nodes[1]).toMatchObject({ label: 'Kid', parent: 'Root' });
  });

  it('returns null for prose with no usable object', () => {
    expect(extractOutlineJson('I cannot do that.')).toBeNull();
    expect(extractOutlineJson('{"nodes": []}')).toBeNull();
  });
});
