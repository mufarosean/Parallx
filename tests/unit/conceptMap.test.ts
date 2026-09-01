// conceptMap.test.ts — the shared concept-map core (ui/conceptMap): the
// chat mind map's proven semantics plus the promoted powers. Pins:
// vertical layout geometry, branch colour classes, math-aware labels
// (foreignObject only when a renderer is injected), fence-info parsing,
// and the fallback that never dies.

import { describe, expect, it } from 'vitest';
import {
  appendChildToOutline,
  applyOverrides,
  hubPathsFor,
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

describe('box colours', () => {
  it('every box wears its OWN hue, cycling in placement order', () => {
    const layout = layoutMindMap(parseMindMap(SRC), 'right');
    const root = layout.nodes.find((n) => n.label === 'Reserving')!;
    const cl = layout.nodes.find((n) => n.label === 'Chain Ladder')!;
    const mack = layout.nodes.find((n) => n.label === 'Mack')!;
    const bf = layout.nodes.find((n) => n.label === 'Bornhuetter-Ferguson')!;
    expect(root.branch).toBe(0);
    expect(cl.branch).toBe(1);
    expect(mack.branch).toBe(2); // its own colour, never the parent's
    expect(bf.branch).toBe(3);
  });

  it('hue classes reach the SVG; no neutral root special case', () => {
    const svg = renderMindMapSvg(SRC);
    expect(svg).toContain('parallx-mindmap__node--b0');
    expect(svg).toContain('parallx-mindmap__node--b1');
    expect(svg).toContain('parallx-mindmap__edge--b0');
    expect(svg).not.toContain('parallx-mindmap__node--root');
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

describe('hub connectors and outline growth', () => {
  it('ONE exit per box: stem to a vertex, spine, one arm per child', () => {
    const parent = { x: 40, y: 100, width: 120, height: 22 };
    const kids = [
      { x: 300, y: 40, width: 100, height: 22, label: 'A', color: 1 },
      { x: 300, y: 160, width: 100, height: 22, label: 'B', color: 2 },
    ];
    const hubs = hubPathsFor(parent, kids, 'right');
    expect(hubs.length).toBe(1); // one exit, both kids on one side
    const hub = hubs[0];
    expect(hub.stem).toBe('M160 100 H 230'); // exit at the box edge, one line
    expect(hub.spine).toBe('M230 40 V 160'); // the vertex line the arms leave
    expect(hub.arms.map((a) => a.d)).toEqual(['M230 40 H 300', 'M230 160 H 300']);
    expect(hub.arms.map((a) => a.color)).toEqual([1, 2]); // arrows = CHILD hue
    expect(hub.stem + hub.spine).not.toContain('C'); // straight, square corners
  });

  it('vertical: same law, axes swapped', () => {
    const parent = { x: 100, y: 50, width: 120, height: 22 };
    const kids = [
      { x: 40, y: 200, width: 100, height: 22, label: 'A', color: 1 },
      { x: 220, y: 200, width: 100, height: 22, label: 'B', color: 2 },
    ];
    const hubs = hubPathsFor(parent, kids, 'down');
    expect(hubs.length).toBe(1);
    expect(hubs[0].stem).toBe('M160 61 V 125');
    expect(hubs[0].spine).toBe('M90 125 H 270');
    expect(hubs[0].arms.map((a) => a.d)).toEqual(['M90 125 V 189', 'M270 125 V 189']);
  });

  it('a child dragged to the other side gets its own exit, not a backwards loop', () => {
    const parent = { x: 200, y: 100, width: 120, height: 22 };
    const kids = [
      { x: 500, y: 100, width: 100, height: 22, label: 'R', color: 1 },
      { x: -100, y: 100, width: 100, height: 22, label: 'L', color: 2 },
    ];
    const hubs = hubPathsFor(parent, kids, 'right');
    expect(hubs.length).toBe(2); // one hub per side after the drag
  });

  it('the SVG draws lines in the PARENT hue and arrows in the CHILD hue', () => {
    const svg = renderMindMapSvg(SRC);
    // Reserving is b0: its whole hub (stem, spine, arms) is edge--b0.
    const hubPaths = svg.match(/data-mm-hub="Reserving"/g) ?? [];
    expect(hubPaths.length).toBe(4); // stem + spine + 2 arms, nothing more
    expect(svg).not.toContain('data-mm-from='); // no per-edge lines remain
    // The arm into Chain Ladder (b1) carries the b1 arrowhead.
    expect(svg).toMatch(/marker-end="url\(#mm\d+-arrow-b1\)" data-mm-hub="Reserving" data-mm-to="Chain Ladder"/);
    // Chain Ladder's own hub is b1 and its arm into Mack wears Mack's b2 arrow.
    expect(svg).toMatch(/marker-end="url\(#mm\d+-arrow-b2\)" data-mm-hub="Chain Ladder" data-mm-to="Mack"/);
    expect(svg).toContain('<defs>');
    expect(svg).toContain('parallx-mindmap__arrow');
  });

  it('appendChildToOutline inserts under the parent, two deeper; unknown parent is null', () => {
    const next = appendChildToOutline(SRC, 'Chain Ladder', 'New idea')!;
    const lines = next.split('\n');
    const i = lines.findIndex((l) => l.trim() === 'Chain Ladder');
    expect(lines[i + 1]).toBe('    New idea');
    const roots = parseMindMap(next);
    expect(roots[0].children[0].children.map((n) => n.label)).toEqual(['New idea', 'Mack']);
    expect(appendChildToOutline(SRC, 'Ghost', 'x')).toBeNull();
  });
});

describe('the fallback never dies', () => {
  it('an unlayoutable block degrades to the readable outline', () => {
    expect(renderMindMapSvg('')).toContain('parallx-mindmap-fallback');
    expect(renderMindMapSvg('   \n  \n')).toContain('parallx-mindmap-fallback');
  });
});
