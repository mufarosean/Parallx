// conceptMap.test.ts — the shared concept-map core (ui/conceptMap): the
// chat mind map's proven semantics plus the promoted powers. Pins:
// vertical layout geometry, branch colour classes, math-aware labels
// (foreignObject only when a renderer is injected), fence-info parsing,
// and the fallback that never dies.

import { describe, expect, it } from 'vitest';
import {
  layoutMindMap,
  parseMindMap,
  parseMindMapInfo,
  renderMindMapSvg,
  splitLabel,
} from '../../src/ui/conceptMap';

const SRC = [
  'Reserving',
  '  Chain Ladder',
  '    Mack',
  '  Bornhuetter-Ferguson',
].join('\n');

describe('parseMindMapInfo', () => {
  it('reads the direction from the fence info', () => {
    expect(parseMindMapInfo('mindmap').dir).toBe('right');
    expect(parseMindMapInfo('mindmap vertical').dir).toBe('down');
    expect(parseMindMapInfo('concept-map down').dir).toBe('down');
  });
});

describe('vertical layout', () => {
  it('depth picks the row; siblings spread across without overlap', () => {
    const layout = layoutMindMap(parseMindMap(SRC), 'down');
    const byLabel = (l: string) => layout.nodes.find((n) => n.label === l)!;
    const root = byLabel('Reserving');
    const cl = byLabel('Chain Ladder');
    const bf = byLabel('Bornhuetter-Ferguson');
    const mack = byLabel('Mack');
    expect(cl.y).toBeGreaterThan(root.y);
    expect(mack.y).toBeGreaterThan(cl.y);
    expect(cl.y).toBe(bf.y); // same depth, same row
    // Siblings never overlap horizontally.
    expect(cl.x + cl.width).toBeLessThanOrEqual(bf.x + 0.001);
    // The parent centres over its children's span.
    expect(root.x + root.width / 2).toBeGreaterThan(cl.x);
    expect(root.x + root.width / 2).toBeLessThan(bf.x + bf.width);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
  });

  it('horizontal stays the classic left-to-right tree', () => {
    const layout = layoutMindMap(parseMindMap(SRC), 'right');
    const root = layout.nodes.find((n) => n.label === 'Reserving')!;
    const mack = layout.nodes.find((n) => n.label === 'Mack')!;
    expect(mack.x).toBeGreaterThan(root.x);
  });
});

describe('branch colours', () => {
  it('each top-level branch keeps one hue down its subtree; roots stay neutral', () => {
    const layout = layoutMindMap(parseMindMap(SRC), 'right');
    const root = layout.nodes.find((n) => n.label === 'Reserving')!;
    const cl = layout.nodes.find((n) => n.label === 'Chain Ladder')!;
    const mack = layout.nodes.find((n) => n.label === 'Mack')!;
    const bf = layout.nodes.find((n) => n.label === 'Bornhuetter-Ferguson')!;
    expect(root.branch).toBe(-1);
    expect(cl.branch).toBe(0);
    expect(mack.branch).toBe(0); // inherits the branch, not a new hue
    expect(bf.branch).toBe(1);
  });

  it('branch classes reach the SVG on nodes and their inbound edges', () => {
    const svg = renderMindMapSvg(SRC);
    expect(svg).toContain('parallx-mindmap__node--b0');
    expect(svg).toContain('parallx-mindmap__node--b1');
    expect(svg).toContain('parallx-mindmap__edge--b0');
    expect(svg).toContain('parallx-mindmap__node--root');
  });
});

describe('math-aware labels', () => {
  it('splitLabel finds $…$ spans and leaves unmatched $ as text', () => {
    expect(splitLabel('Variance $\\sigma^2$ grows')).toEqual([
      { kind: 'text', value: 'Variance ' },
      { kind: 'math', value: '\\sigma^2' },
      { kind: 'text', value: ' grows' },
    ]);
    expect(splitLabel('costs $5')).toEqual([{ kind: 'text', value: 'costs $5' }]);
  });

  it('with a math renderer, math labels become foreignObject HTML', () => {
    const svg = renderMindMapSvg('Root\n  $E=mc^2$', {
      renderMath: (tex) => `<b class="fake-katex">${tex}</b>`,
    });
    expect(svg).toContain('foreignObject');
    expect(svg).toContain('fake-katex');
    expect(svg).toContain('E=mc^2');
  });

  it('without a renderer, math stays literal text and nothing breaks', () => {
    const svg = renderMindMapSvg('Root\n  $E=mc^2$');
    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('$E=mc^2$');
  });
});

describe('the fallback never dies', () => {
  it('an unlayoutable block degrades to the readable outline', () => {
    expect(renderMindMapSvg('')).toContain('parallx-mindmap-fallback');
    expect(renderMindMapSvg('   \n  \n')).toContain('parallx-mindmap-fallback');
  });
});
