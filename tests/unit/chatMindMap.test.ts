// M102 — concept maps in chat replies.
//
// Parsing and layout are pure, so they are pinned directly. The properties
// that matter are robustness (a model's indentation is never consistent) and
// graceful failure (a mangled block must still be readable, which is the
// whole reason the syntax is an outline rather than mermaid).

import { describe, it, expect } from 'vitest';
import {
  parseMindMap,
  layoutMindMap,
  renderMindMapSvg,
  renderMindMapFallback,
  type MindMapNode,
} from '../../src/built-in/chat/rendering/chatMindMap.js';

const labels = (nodes: readonly MindMapNode[]): string[] => nodes.map((n) => n.label);

describe('parseMindMap', () => {
  it('builds a tree from indentation', () => {
    const roots = parseMindMap('A\n  B\n    C\n  D');
    expect(labels(roots)).toEqual(['A']);
    expect(labels(roots[0].children)).toEqual(['B', 'D']);
    expect(labels(roots[0].children[0].children)).toEqual(['C']);
  });

  it('supports several roots', () => {
    const roots = parseMindMap('A\n  a1\nB\n  b1');
    expect(labels(roots)).toEqual(['A', 'B']);
  });

  it('treats 2-space, 4-space and tab indentation identically', () => {
    // A model's indentation is never consistent, and depth comes from a stack
    // comparison rather than dividing by a fixed step precisely so it does
    // not have to be.
    const two = parseMindMap('A\n  B\n    C');
    const four = parseMindMap('A\n    B\n        C');
    const tabs = parseMindMap('A\n\tB\n\t\tC');
    for (const tree of [two, four, tabs]) {
      expect(labels(tree)).toEqual(['A']);
      expect(labels(tree[0].children)).toEqual(['B']);
      expect(labels(tree[0].children[0].children)).toEqual(['C']);
    }
  });

  it('survives inconsistent indentation within one map', () => {
    const roots = parseMindMap('A\n   B\n      C\n  D');
    // D is indented less than B, so it rejoins A rather than vanishing.
    expect(labels(roots[0].children)).toEqual(['B', 'D']);
  });

  it('strips bullet and number markers', () => {
    const roots = parseMindMap('- A\n  * B\n  1. C\n  • D');
    expect(labels(roots)).toEqual(['A']);
    expect(labels(roots[0].children)).toEqual(['B', 'C', 'D']);
  });

  it('ignores blank lines', () => {
    const roots = parseMindMap('A\n\n  B\n\n\n  C\n');
    expect(labels(roots[0].children)).toEqual(['B', 'C']);
  });

  it('returns nothing for empty or whitespace input', () => {
    expect(parseMindMap('')).toEqual([]);
    expect(parseMindMap('   \n\n  ')).toEqual([]);
  });

  it('caps node count', () => {
    const src = Array.from({ length: 90 }, (_, i) => `node ${i}`).join('\n');
    expect(parseMindMap(src)).toHaveLength(40);
  });

  it('reparents past the depth cap instead of dropping the node', () => {
    // Losing the connection is worse than losing the nesting.
    const src = ['L0', ' L1', '  L2', '   L3', '    L4', '     L5', '      L6'].join('\n');
    const roots = parseMindMap(src);
    const flatten = (n: MindMapNode): string[] => [n.label, ...n.children.flatMap(flatten)];
    expect(roots.flatMap(flatten)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  });

  it('clips an over-long label rather than the box clipping it later', () => {
    expect(parseMindMap('x'.repeat(300))[0].label).toHaveLength(64);
  });
});

describe('layoutMindMap', () => {
  it('places depth on the x axis, strictly increasing', () => {
    const l = layoutMindMap(parseMindMap('A\n  B\n    C'));
    const [a, b, c] = l.nodes;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
  });

  it('never lets a column start before the previous column ends', () => {
    // Otherwise an edge runs backwards underneath a node box.
    const l = layoutMindMap(parseMindMap('a very long root label indeed\n  child'));
    const [root, child] = l.nodes;
    expect(child.x).toBeGreaterThanOrEqual(root.x + root.width);
  });

  it('stacks leaves down the page without overlapping', () => {
    const l = layoutMindMap(parseMindMap('A\n  B\n  C\n  D'));
    const ys = l.nodes.filter((n) => n.depth === 1).map((n) => n.y);
    expect(ys).toHaveLength(3);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });

  it('centres a parent on its children', () => {
    const l = layoutMindMap(parseMindMap('A\n  B\n  C'));
    const [a, b, c] = l.nodes;
    expect(a.y).toBeCloseTo((b.y + c.y) / 2);
  });

  it('emits one edge per parent-child link, parent index first', () => {
    const l = layoutMindMap(parseMindMap('A\n  B\n    C\n  D'));
    expect(l.edges).toHaveLength(3);
    for (const e of l.edges) expect(e.from).toBeLessThan(e.to);
  });

  it('reports a canvas big enough for every node', () => {
    const l = layoutMindMap(parseMindMap('A\n  B\n  C\n    D\n  E'));
    for (const n of l.nodes) {
      expect(n.x + n.width).toBeLessThanOrEqual(l.width);
      expect(n.y).toBeLessThanOrEqual(l.height);
    }
  });

  it('handles a single node', () => {
    const l = layoutMindMap(parseMindMap('Alone'));
    expect(l.nodes).toHaveLength(1);
    expect(l.edges).toHaveLength(0);
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
  });
});

describe('renderMindMapSvg', () => {
  it('renders an svg with a node per line', () => {
    const html = renderMindMapSvg('A\n  B\n  C');
    expect(html).toContain('<svg');
    expect(html.match(/parallx-mindmap__node /g) ?? []).toHaveLength(3);
  });

  it('emits no colour — the theme owns it', () => {
    // Colour in the markup would freeze the diagram to one theme.
    const html = renderMindMapSvg('A\n  B');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/\b(?:fill|stroke)="(?!none)/);
  });

  it('escapes markup in labels', () => {
    const html = renderMindMapSvg('<script>alert(1)</script>\n  a & b');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('falls back to a readable outline when nothing parses', () => {
    // The reason the syntax is an outline: a mangled block still reads.
    const html = renderMindMapSvg('   \n  ');
    expect(html).toContain('parallx-mindmap-fallback');
    expect(html).not.toContain('<svg');
  });

  it('keeps the fallback escaped too', () => {
    expect(renderMindMapFallback('<b>x</b>')).toContain('&lt;b&gt;');
  });

  it('tags every node with its label for the click handler', () => {
    const html = renderMindMapSvg('Parameter risk\n  does not diversify');
    expect(html).toContain('data-mindmap-label="Parameter risk"');
    expect(html).toContain('data-mindmap-label="does not diversify"');
  });

  it('marks nodes as keyboard-reachable buttons', () => {
    const html = renderMindMapSvg('A\n  B');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });
});
