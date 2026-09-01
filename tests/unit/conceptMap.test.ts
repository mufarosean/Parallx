// conceptMap.test.ts — the shared concept-map core (ui/conceptMap): the
// chat mind map's proven semantics plus the promoted powers. Pins:
// vertical layout geometry, branch colour classes, math-aware labels
// (foreignObject only when a renderer is injected), fence-info parsing,
// and the fallback that never dies.

import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  layoutMindMap,
  measureLabel,
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

describe('rich labels', () => {
  it('long labels wrap: capped width, multi-line height', () => {
    const long = 'incremental capping ratio applied to the loss cost format across every accident year in the triangle';
    const m = measureLabel(long);
    expect(m.lines.length).toBeGreaterThan(1);
    expect(m.width).toBeLessThanOrEqual(242 + 20);
    const single = measureLabel('short');
    expect(m.height).toBeGreaterThan(single.height);
  });

  it('truncation never cuts through a math span', () => {
    const tex = String.raw`\frac{CL_n - CL_{n-1}}{L_n - L_{n-1}} \cdot L_{ultimate}`;
    const label = 'x'.repeat(200) + ' $' + tex + '$';
    const roots = parseMindMap(label);
    const dollars = (roots[0].label.match(/\$/g) ?? []).length;
    expect(dollars % 2).toBe(0); // never an unmatched $
  });

  it('markdown tokens render as real elements in the foreignObject', () => {
    const svg = renderMindMapSvg('Root\n  **capping** ratio times *LCF* and `TM`', {
      renderMath: (tex) => tex,
    });
    expect(svg).toContain('<b>capping</b>');
    expect(svg).toContain('<i>LCF</i>');
    expect(svg).toContain('<code>TM</code>');
  });

  it('a wrapped multi-line label renders per-line divs', () => {
    const svg = renderMindMapSvg('Root\n  a very long branch label that certainly exceeds the wrap width of the box by a lot', {});
    expect(svg).toContain('parallx-mindmap__line');
    expect((svg.match(/parallx-mindmap__line/g) ?? []).length).toBeGreaterThan(1);
  });
});

describe('layout overrides (user moves and resizes)', () => {
  it('dx/dy move a box; bounds re-normalise so nothing goes negative', () => {
    const base = layoutMindMap(parseMindMap(SRC), 'right');
    const moved = applyOverrides(base, { 'Mack': { dx: -500, dy: -300 } });
    const mack = moved.nodes.find((n) => n.label === 'Mack')!;
    const baseMack = base.nodes.find((n) => n.label === 'Mack')!;
    expect(mack.x).not.toBe(baseMack.x);
    for (const n of moved.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y - n.height / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(moved.width);
    }
  });

  it('an explicit width re-wraps the text: narrower box, taller box', () => {
    const src = 'Root\n  a fairly long label that will surely need to wrap when narrowed';
    const base = layoutMindMap(parseMindMap(src), 'right');
    const label = 'a fairly long label that will surely need to wrap when narrowed';
    const resized = applyOverrides(base, { [label]: { w: 120 } });
    const before = base.nodes.find((n) => n.label === label)!;
    const after = resized.nodes.find((n) => n.label === label)!;
    expect(after.width).toBe(120);
    expect(after.height).toBeGreaterThan(before.height);
  });

  it('an override for a renamed (unknown) label is ignored, not fatal', () => {
    const base = layoutMindMap(parseMindMap(SRC), 'right');
    const out = applyOverrides(base, { 'No Longer Exists': { dx: 999 } });
    expect(out.nodes.map((n) => n.x)).toEqual(base.nodes.map((n) => n.x));
  });

  it('renderMindMapSvg applies overrides to the emitted geometry', () => {
    const plain = renderMindMapSvg(SRC);
    const shifted = renderMindMapSvg(SRC, { overrides: { 'Mack': { dy: 200 } } });
    expect(shifted).not.toBe(plain);
    expect(shifted).toContain('data-mindmap-label="Mack"');
  });
});

describe('the fallback never dies', () => {
  it('an unlayoutable block degrades to the readable outline', () => {
    expect(renderMindMapSvg('')).toContain('parallx-mindmap-fallback');
    expect(renderMindMapSvg('   \n  \n')).toContain('parallx-mindmap-fallback');
  });
});
