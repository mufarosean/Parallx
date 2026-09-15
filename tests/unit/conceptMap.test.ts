// conceptMap.test.ts — the shared concept-map core (ui/conceptMap): the
// chat mind map's proven semantics plus the promoted powers. Pins:
// vertical + radial layout geometry, colour-by-level classes, math-aware labels
// (foreignObject only when a renderer is injected), fence-info parsing,
// and the fallback that never dies.

import { describe, expect, it } from 'vitest';
import {
  appendChildAtLine,
  applyOverrides,
  cardTilt,
  hubPathsFor,
  layoutMindMap,
  measureLabel,
  parseMindMap,
  parseMindMapInfo,
  renderMindMapSvg,
  splitLabel,
  tokenizeLabel,
} from '../../src/ui/conceptMap';

const SRC = [
  'Reserving',
  '  Chain Ladder',
  '    Mack',
  '  Bornhuetter-Ferguson',
].join('\n');

describe('parseMindMapInfo', () => {
  it('reads the direction from the fence info', () => {
    expect(parseMindMapInfo('mindmap').dir).toBe('radial'); // bare = radial
    expect(parseMindMapInfo('mindmap tree').dir).toBe('right');
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

describe('card colours: one paper per level', () => {
  it('a card wears its LEVEL: index card, note, slip', () => {
    const layout = layoutMindMap(parseMindMap(SRC), 'right');
    const root = layout.nodes.find((n) => n.label === 'Reserving')!;
    const cl = layout.nodes.find((n) => n.label === 'Chain Ladder')!;
    const mack = layout.nodes.find((n) => n.label === 'Mack')!;
    const bf = layout.nodes.find((n) => n.label === 'Bornhuetter-Ferguson')!;
    expect(root.branch).toBe(0);
    expect(cl.branch).toBe(1);
    expect(mack.branch).toBe(2);
    expect(bf.branch).toBe(1); // same level as Chain Ladder, same paper
  });

  it('level and kind classes reach the SVG; the note carries its fold', () => {
    const svg = renderMindMapSvg(SRC);
    expect(svg).toContain('parallx-mindmap__node--d0 parallx-mindmap__node--card');
    expect(svg).toContain('parallx-mindmap__node--d1 parallx-mindmap__node--note');
    expect(svg).toContain('parallx-mindmap__node--d2 parallx-mindmap__node--slip');
    expect(svg).toContain('parallx-mindmap__edge--d0');
    expect(svg).toContain('parallx-mindmap__fold');
    expect(svg).toContain('parallx-mindmap__strip');
    expect(svg).not.toContain('parallx-mindmap__node--b');
  });

  it('the index card never tilts; notes and slips keep a stable, small tilt', () => {
    expect(cardTilt('Reserving', 0)).toBe(0);
    const t1 = cardTilt('Chain Ladder', 1);
    expect(Math.abs(t1)).toBeLessThanOrEqual(1.3);
    expect(cardTilt('Chain Ladder', 1)).toBe(t1); // hashed from the label
    expect(Math.abs(cardTilt('Mack', 2))).toBeLessThanOrEqual(0.7);
    const svg = renderMindMapSvg(SRC);
    expect(svg).toMatch(/data-mm-line="1"[^>]*data-mm-tilt="-?[\d.]+" transform="rotate\(/);
    expect(svg).not.toMatch(/data-mm-line="0"[^>]*transform=/);
  });
});

describe('radial layout', () => {
  const RADIAL = ['Centre', '  One', '  Two', '  Three', '    Three a', '  Four'].join('\n');

  it('a single branching root sits between its branches, both sides used', () => {
    const layout = layoutMindMap(parseMindMap(RADIAL), 'radial');
    expect(layout.dir).toBe('radial');
    const root = layout.nodes.find((n) => n.label === 'Centre')!;
    const kids = layout.nodes.filter((n) => n.depth === 1);
    expect(kids.length).toBe(4);
    const right = kids.filter((n) => n.x >= root.x + root.width);
    const left = kids.filter((n) => n.x + n.width <= root.x);
    expect(right.length + left.length).toBe(4);
    expect(right.length).toBeGreaterThan(0);
    expect(left.length).toBeGreaterThan(0);
    // The first branches read on the right, in order.
    expect(right.map((n) => n.label)).toEqual(['One', 'Two']); // right fills to half the leaves
    // A slip sits outboard of its note on the same side.
    const three = layout.nodes.find((n) => n.label === 'Three')!;
    const threeA = layout.nodes.find((n) => n.label === 'Three a')!;
    if (three.x >= root.x + root.width) expect(threeA.x).toBeGreaterThanOrEqual(three.x + three.width);
    else expect(threeA.x + threeA.width).toBeLessThanOrEqual(three.x); // left side grows leftward
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(layout.width);
      expect(n.y - n.height / 2).toBeGreaterThanOrEqual(0);
    }
  });

  it('several roots, or a root with one child, draw as the tree', () => {
    const forest = layoutMindMap(parseMindMap(SRC + '\nPricing\n  Rate'), 'radial');
    const roots = forest.nodes.filter((n) => n.depth === 0);
    expect(roots.length).toBe(2);
    for (const n of forest.nodes) expect(n.x).toBeGreaterThanOrEqual(roots[0].x);
    const chain = layoutMindMap(parseMindMap('A\n  B\n    C'), 'radial');
    const a = chain.nodes.find((n) => n.label === 'A')!;
    const b = chain.nodes.find((n) => n.label === 'B')!;
    expect(b.x).toBeGreaterThan(a.x);
  });

  it('left-side cards get a backward hub from the centre, still one exit per side', () => {
    const svg = renderMindMapSvg(RADIAL, { dir: 'radial' });
    const stems = svg.match(/data-mm-hub="0" d="M[^"]*"/g) ?? [];
    // A stem and a spine per side (two sides), plus one arm per branch.
    const arms = svg.match(/marker-end="[^"]+" data-mm-hub="0" data-mm-to="\d+"/g) ?? [];
    expect(arms.length).toBe(4);
    expect(stems.length).toBe(4);
    expect(svg).toContain('data-mindmap-dir="radial"');
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
  it('intraword underscores are subscripts, never italics', () => {
    const segs = tokenizeLabel('q=1: ÷√C_ik, C_ik-weighted and E[C_i,k+1 | C_ik] = C_ik · f_k');
    expect(segs.every((seg) => seg.kind === 'text')).toBe(true);
    expect(segs.map((seg) => seg.value).join('')).toContain('C_ik, C_ik-weighted');
    const italic = tokenizeLabel('a _real_ emphasis');
    expect(italic.some((seg) => seg.kind === 'italic' && seg.value === 'real')).toBe(true);
  });

  it('long labels wrap: capped width, multi-line height', () => {
    const long = 'incremental capping ratio applied to the loss cost format across every accident year in the triangle';
    const m = measureLabel(long);
    expect(m.lines.length).toBeGreaterThan(1);
    expect(m.width).toBeLessThanOrEqual(200 + 12 + 28); // note wrap width + padding
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
    // The spine stops where the elbows begin (radius 8 each end).
    expect(hub.spine).toBe('M230 48 V 152');
    // Each arm leaves the spine through a rounded elbow, then runs straight in.
    expect(hub.arms.map((a) => a.d)).toEqual([
      'M230 48 Q 230 40 238 40 H 300',
      'M230 152 Q 230 160 238 160 H 300',
    ]);
    expect(hub.arms.map((a) => a.color)).toEqual([1, 2]); // arrows = CHILD level
    expect(hub.stem).not.toContain('Q'); // the stem itself is straight
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
    expect(hubs[0].spine).toBe('M98 125 H 262');
    expect(hubs[0].arms.map((a) => a.d)).toEqual([
      'M98 125 Q 90 125 90 133 V 189',
      'M262 125 Q 270 125 270 133 V 189',
    ]);
  });

  it('an arm level with its parent stays straight: no elbow to draw', () => {
    const parent = { x: 40, y: 100, width: 120, height: 22 };
    const kids = [{ x: 300, y: 100, width: 100, height: 22, label: 'A', color: 1 }];
    const hubs = hubPathsFor(parent, kids, 'right');
    expect(hubs[0].spine).toBeNull();
    expect(hubs[0].arms[0].d).toBe('M230 100 H 300');
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
    // Reserving is d0 at line 0: its whole hub is addressed by LINE.
    const hubPaths = svg.match(/data-mm-hub="0"/g) ?? [];
    expect(hubPaths.length).toBe(4); // stem + spine + 2 arms, nothing more
    expect(svg).not.toContain('data-mm-from='); // no per-edge lines remain
    // The arm into Chain Ladder (line 1, level 1) carries the d1 arrowhead.
    expect(svg).toMatch(/marker-end="url\(#mm\d+-arrow-d1\)" data-mm-hub="0" data-mm-to="1"/);
    // Chain Ladder's own hub is d1 and its arm into Mack wears Mack's d2 arrow.
    expect(svg).toMatch(/marker-end="url\(#mm\d+-arrow-d2\)" data-mm-hub="1" data-mm-to="2"/);
    expect(svg).toContain('<defs>');
    expect(svg).toContain('parallx-mindmap__arrow');
  });

  it('DUPLICATE labels each keep their own arm and arrowhead', () => {
    // Two unrenamed "New idea" boxes: line is identity, so neither arm
    // may collapse onto the other (the vanished-arrow bug).
    const svg = renderMindMapSvg('Root\n  New idea\n  New idea');
    expect(svg).toMatch(/marker-end="url\(#mm\d+-arrow-d\d\)" data-mm-hub="0" data-mm-to="1"/);
    expect(svg).toMatch(/marker-end="url\(#mm\d+-arrow-d\d\)" data-mm-hub="0" data-mm-to="2"/);
  });

  it('a freshly added box keeps its arm after a SIBLING is moved', () => {
    const src = 'Root\n  Premium\n  Term 1\n  New idea';
    const svg = renderMindMapSvg(src, { overrides: { 'Premium': { dx: -160, dy: 90 } } });
    // Every child line still has exactly one marker-carrying arm.
    for (const line of [1, 2, 3]) {
      const arms = svg.match(new RegExp(`marker-end="[^"]+" data-mm-hub="0" data-mm-to="${line}"`, 'g')) ?? [];
      expect(arms.length).toBe(1);
    }
  });

  it('appendChildAtLine inserts under that line, two deeper; a bad index is null', () => {
    const next = appendChildAtLine(SRC, 1, 'New idea')!; // line 1 = Chain Ladder
    const lines = next.split('\n');
    expect(lines[2]).toBe('    New idea');
    const roots = parseMindMap(next);
    expect(roots[0].children[0].children.map((n) => n.label)).toEqual(['New idea', 'Mack']);
    expect(appendChildAtLine(SRC, 99, 'x')).toBeNull();
  });

  it('nodes carry their source line, and the SVG stamps it', () => {
    const roots = parseMindMap('Root\n\n  Child');
    expect(roots[0].line).toBe(0);
    expect(roots[0].children[0].line).toBe(2); // blank lines still count
    expect(renderMindMapSvg(SRC)).toContain('data-mm-line="2"');
  });
});

describe('the fallback never dies', () => {
  it('an unlayoutable block degrades to the readable outline', () => {
    expect(renderMindMapSvg('')).toContain('parallx-mindmap-fallback');
    expect(renderMindMapSvg('   \n  \n')).toContain('parallx-mindmap-fallback');
  });
});
