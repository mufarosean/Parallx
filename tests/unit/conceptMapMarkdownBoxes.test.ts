// A concept-map box holds markdown: `\n` in its outline line breaks it into
// rows (paragraphs, lists, headings, quotes, display math), long text is
// never cut short of the cap, and the editor round-trips the breaks.

import { describe, expect, it } from 'vitest';
import {
  decodeBreaks,
  encodeBreaks,
  measureLabel,
  normalizeLabel,
  parseMindMap,
  renderMindMapSvg,
  splitBreaks,
  tokenizeLabel,
} from '../../src/ui/conceptMap';

const BOX = String.raw`**Three checks**\n- means add\n  - exactly\n1. SE between floor and sum\n\n> a reviewer's view\n$$\sigma^2 = \sum v_i$$`;

describe('markdown boxes', () => {
  it('a break inside $…$ is TeX, not a new line', () => {
    expect(splitBreaks(String.raw`a\nb $\nu$ c`)).toEqual(['a', String.raw`b $\nu$ c`]);
    expect(decodeBreaks(String.raw`one\ntwo`)).toBe('one\ntwo');
    expect(encodeBreaks('one\r\ntwo')).toBe(String.raw`one\ntwo`);
  });

  it('a box keeps its lines and their nesting, and the whole of a long text', () => {
    const [root] = parseMindMap(`- ${BOX}`);
    expect(root.label).toBe(BOX);
    const long = 'word '.repeat(300).trim();
    expect(normalizeLabel(long)).toBe(long);
  });

  it('rows: bullets, nested bullets, numbers, a gap, a quote and display math', () => {
    const m = measureLabel(BOX, undefined, 1);
    const kinds = m.rows!.map((r) => `${r.kind}:${r.marker}`);
    expect(kinds).toEqual(['text:', 'text:•', 'text:◦', 'text:1.', 'gap:', 'quote:', 'math:']);
    const [, top, nested] = m.rows!;
    expect(nested.indent).toBeGreaterThan(top.indent);
    expect(m.height).toBeGreaterThan(measureLabel('one line', undefined, 1).height);
  });

  it('draws each row, markers and all, in the box', () => {
    const svg = renderMindMapSvg(`Root\n  ${BOX}`, { renderMath: (tex) => `[${tex}]` });
    expect(svg).toContain('parallx-mindmap__flabel--rows');
    expect(svg).toContain('<b>Three checks</b>');
    expect(svg).toContain('>•</span>means add');
    expect(svg).toContain('>◦</span>exactly');
    expect(svg).toContain('parallx-mindmap__line--quote');
    expect(svg).toContain(String.raw`[\sigma^2 = \sum v_i]`);
  });

  it('strike and links are inline marks', () => {
    expect(tokenizeLabel('~~old~~ and [the paper](https://x.org)')).toEqual([
      { kind: 'strike', value: 'old' },
      { kind: 'text', value: ' and ' },
      { kind: 'link', value: 'the paper' },
    ]);
  });
});
