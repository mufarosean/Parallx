// @vitest-environment jsdom
// conceptMapEditor.test.ts — the in-place box editor's pure engine:
// line-addressed outline edits (a box's identity is its SOURCE LINE,
// so duplicates never cross-edit and a truncated label never eats its
// own tail), normalizeLabel (the one override key), editorTokens and
// editorHtml (live preview: every source char present exactly once,
// math atomic unless the caret is inside), editorSignature (repaint
// only when formatting changes), and the DOM walkers that make the
// overlay honest.

import { describe, expect, it } from 'vitest';
import {
  caretSourceOffset,
  editorHtml,
  editorSignature,
  editorTokens,
  normalizeLabel,
  outlineLineText,
  parseMindMap,
  replaceOutlineLine,
  resolveSourceOffset,
  serializeEditorDom,
} from '../../src/ui/conceptMap';

const SRC = [
  'Reserving',
  '  Chain Ladder',
  '    Mack',
  '  Bornhuetter-Ferguson',
].join('\n');

const fakeMath = (tex: string): string => `<span class="fake-katex">${tex}</span>`;

describe('line-addressed outline edits', () => {
  it('rewrites exactly one line, preserving its indentation', () => {
    const next = replaceOutlineLine(SRC, 2, 'Mack 1994')!;
    expect(next.split('\n')[2]).toBe('    Mack 1994');
    expect(next.split('\n')[0]).toBe('Reserving');
    expect(next.split('\n').length).toBe(4);
  });

  it('DUPLICATE labels never cross-edit: the line is the identity', () => {
    const dup = 'Root\n  Twin\n  Twin';
    // Editing the SECOND Twin box (line 2) must not touch the first.
    expect(replaceOutlineLine(dup, 2, 'Renamed')).toBe('Root\n  Twin\n  Renamed');
    expect(replaceOutlineLine(dup, 1, 'Renamed')).toBe('Root\n  Renamed\n  Twin');
  });

  it('an out-of-range or blank line returns null, never a mangled outline', () => {
    expect(replaceOutlineLine(SRC, 99, 'x')).toBeNull();
    expect(replaceOutlineLine(SRC, -1, 'x')).toBeNull();
    expect(replaceOutlineLine('Root\n\n  Child', 1, 'x')).toBeNull();
  });

  it('a list marker survives the edit; the box seeds without it', () => {
    expect(outlineLineText('Root\n  - Old idea', 1)).toBe('Old idea');
    expect(replaceOutlineLine('Root\n  - Old idea', 1, 'New idea')).toBe('Root\n  - New idea');
    expect(replaceOutlineLine('Root\n  1) Old', 1, 'New')).toBe('Root\n  1) New');
  });

  it('a LONG line seeds its full text, so editing never truncates the outline', () => {
    const long = 'x'.repeat(300);
    const src = `Root\n  ${long}`;
    const drawn = parseMindMap(src)[0].children[0];
    expect(drawn.label.length).toBeLessThan(long.length); // the box shows a cut label
    expect(outlineLineText(src, drawn.line)).toBe(long);  // the editor gets it all
    // Committing an edit of the FULL text keeps every character.
    const next = replaceOutlineLine(src, drawn.line, `${long}y`)!;
    expect(next.split('\n')[1]).toBe(`  ${long}y`);
    expect(next).not.toContain('…');
  });
});

describe('normalizeLabel', () => {
  it('is exactly what the parser will name a line (the override key)', () => {
    const cases = ['- New idea', '* New idea', '• New idea', '1. New idea', '1) New idea', '  New   idea  '];
    for (const raw of cases) {
      const parsed = parseMindMap(`Root\n  ${raw}`)[0].children[0].label;
      expect(normalizeLabel(raw)).toBe(parsed);
    }
    expect(normalizeLabel('- New idea')).toBe('New idea');
  });

  it('truncates like the parser, so long labels key the same override', () => {
    const long = 'y'.repeat(300);
    const parsed = parseMindMap(`Root\n  ${long}`)[0].children[0].label;
    expect(normalizeLabel(long)).toBe(parsed);
  });
});

describe('editorSignature', () => {
  it('is stable while typing plain text (no repaint, so no caret jump)', () => {
    const caret = { start: 3, end: 3 };
    expect(editorSignature('abc', caret)).toBe(editorSignature('abcd', caret));
  });

  it('is stable while typing INSIDE a mark, but changes when one closes', () => {
    expect(editorSignature('**bol**', { start: 5, end: 5 }))
      .toBe(editorSignature('**bold**', { start: 6, end: 6 }));
    expect(editorSignature('*ital', { start: 5, end: 5 }))
      .not.toBe(editorSignature('*ital*', { start: 6, end: 6 }));
  });

  it('changes when the caret leaves a math span (raw TeX becomes rendered)', () => {
    const src = 'a $x^2$ b';
    expect(editorSignature(src, { start: 4, end: 4 })).toContain('math-raw');
    expect(editorSignature(src, { start: 0, end: 0 })).not.toContain('math-raw');
  });
});

describe('editorTokens', () => {
  it('every source character appears exactly once, in order', () => {
    const src = 'Mack $\\sigma^2$ **bold** *i* `c` and $5 loose';
    expect(editorTokens(src).map((t) => t.text).join('')).toBe(src);
  });

  it('kinds and inners match the render grammar, markers kept', () => {
    const toks = editorTokens('a $x^2$ **b** `c`');
    expect(toks.map((t) => t.kind)).toEqual(['text', 'math', 'text', 'bold', 'text', 'code']);
    const math = toks[1];
    expect(math.text).toBe('$x^2$');
    expect(math.inner).toBe('x^2');
    expect(toks[3].text).toBe('**b**');
    expect(toks[3].inner).toBe('b');
  });

  it('an unmatched $ stays literal text', () => {
    const toks = editorTokens('costs $5');
    expect(toks).toEqual([{ kind: 'text', text: 'costs $5', inner: 'costs $5' }]);
  });
});

describe('editorHtml', () => {
  const src = 'Mack $\\sigma^2$ **bold**';
  // token spans: text 0..5, math 5..15, text 15..16, bold 16..24

  it('math renders ATOMIC when the caret is outside the span', () => {
    const html = editorHtml(src, { start: 0, end: 0 }, fakeMath);
    expect(html).toContain('data-src="$\\sigma^2$"');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('fake-katex');
  });

  it('math shows raw TeX while the caret sits strictly inside', () => {
    const html = editorHtml(src, { start: 8, end: 8 }, fakeMath);
    expect(html).not.toContain('data-src');
    expect(html).toContain('parallx-mindmap__edmathsrc');
    expect(html).toContain('\\sigma^2');
  });

  it('a boundary caret keeps the formula rendered (typing the closing $ formats instantly)', () => {
    expect(editorHtml(src, { start: 5, end: 5 }, fakeMath)).toContain('data-src');
    expect(editorHtml(src, { start: 15, end: 15 }, fakeMath)).toContain('data-src');
  });

  it('without a math renderer, TeX stays raw and editable', () => {
    expect(editorHtml(src, null, undefined)).not.toContain('data-src');
  });

  it('markdown markers are present but dimmed; content is formatted', () => {
    const html = editorHtml(src, null, fakeMath);
    expect(html).toContain('<span class="parallx-mindmap__edsyn">**</span><b>bold</b>');
  });

  it('markup in the label is escaped, never executed', () => {
    const html = editorHtml('<img src=x onerror=alert(1)>', null, fakeMath);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('the editor DOM walkers', () => {
  const src = 'Mack $\\sigma^2$ **bold** x';
  const mount = (caret: { start: number; end: number } | null): HTMLElement => {
    const el = document.createElement('div');
    el.innerHTML = editorHtml(src, caret, fakeMath);
    return el;
  };

  it('serialize is the exact inverse of editorHtml, atomic math included', () => {
    expect(serializeEditorDom(mount(null))).toBe(src);
    expect(serializeEditorDom(mount({ start: 8, end: 8 }))).toBe(src); // raw math too
  });

  it('a <br> serialises as a newline', () => {
    const el = document.createElement('div');
    el.innerHTML = 'a<br>b';
    expect(serializeEditorDom(el)).toBe('a\nb');
  });

  it('caret offsets roundtrip through the DOM outside atomic spans', () => {
    const el = mount(null);
    const mathStart = src.indexOf('$');
    const mathEnd = src.indexOf('$', mathStart + 1) + 1;
    for (let o = 0; o <= src.length; o++) {
      const pos = resolveSourceOffset(el, o);
      const back = caretSourceOffset(el, pos.node, pos.offset);
      if (o > mathStart && o < mathEnd) {
        // Inside rendered math the caret cannot land; it snaps to an edge.
        expect([mathStart, mathEnd]).toContain(back);
      } else {
        expect(back).toBe(o);
      }
    }
  });

  it('with the math raw, every offset roundtrips exactly', () => {
    const el = mount({ start: 8, end: 8 });
    for (let o = 0; o <= src.length; o++) {
      const pos = resolveSourceOffset(el, o);
      expect(caretSourceOffset(el, pos.node, pos.offset)).toBe(o);
    }
  });
});
