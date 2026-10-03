// @vitest-environment jsdom
// C12 (Canvas assessment 2026-10-03): markdown is how AI writes pages and how
// pages are exported. Export must carry every block and every character, and
// reading it back must give the same page. Text an AI writes must arrive as
// written: dollar amounts, snake_case, `a * b`, Windows paths.
import { describe, it, expect } from 'vitest';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';
import { fixtures, p, t, li, ti, col, cols, mk, strip } from './canvasMatrixHarness';

const schema = mk({ type: 'doc', content: [p()] }).schema;
const norm = (doc: any) => strip(schema.nodeFromJSON(doc).toJSON());

function roundTrip(doc: any): { md: string; back: any } {
  const md = tiptapJsonToMarkdown(doc);
  const back = markdownToTiptapJson(md);
  return { md, back };
}

/** True when the page is one the editor can hold (some blocks are not allowed in columns). */
function fits(doc: any): boolean {
  try { schema.nodeFromJSON(doc).check(); return true; } catch { return false; }
}

function expectSame(doc: any): void {
  if (!fits(doc)) throw new Error('test page is not valid to begin with');
  const { md, back } = roundTrip(doc);
  let parsed: any;
  try { parsed = schema.nodeFromJSON(back); parsed.check(); } catch (e) {
    throw new Error(`invalid page after round trip: ${(e as Error).message}\n--- markdown ---\n${md}`);
  }
  expect(strip(parsed.toJSON()), `--- markdown ---\n${md}`).toEqual(norm(doc));
}

const bold = { type: 'bold' };
const italic = { type: 'italic' };

const extraBlocks: Record<string, any> = {
  dollars: p('It costs $5 and $10 today'),
  underscore: p('call my_func_name now'),
  star: p('a * b * c'),
  hashPara: p('# not a heading'),
  numberPara: p('1. not a list'),
  numberParen: p('2) not a list'),
  dashPara: p('- not a list'),
  plusPara: p('+ not a list'),
  quotePara: p('> not a quote'),
  rulePara: p('---'),
  fencePara: p('```js'),
  mathPara: p('$$'),
  detailsPara: p('<details>'),
  tagPara: p('x < y and <b>not bold</b> <u>nor this</u> <br> <!-- nor this -->'),
  bracketPara: p('[!note] not a callout, [x](y) not a link, ![a](b) not an image'),
  backslashPara: p('C:\\Users\\me\\* and \\\\ and a\\'),
  tildePara: p('~~not struck~~ and ==not marked=='),
  pipePara: p('a | b | c'),
  leadingSpaces: p('   indented text'),
  emptyPara: p(),
  hardBreaks: p('one', { type: 'hardBreak' }, 'two', { type: 'hardBreak' }, { type: 'hardBreak' }, 'three'),
  colored: { type: 'paragraph', attrs: { backgroundColor: 'red' }, content: [t('red bg')] },
  coloredHeading: { type: 'heading', attrs: { level: 2, backgroundColor: 'blue' }, content: [t('blue heading')] },
  colorText: p(t('blue text', [{ type: 'textStyle', attrs: { color: '#00f' } }])),
  highlightColor: p(t('marked', [{ type: 'highlight', attrs: { color: 'yellow' } }])),
  highlightPlain: p(t('marked', [{ type: 'highlight' }])),
  marks: p(
    t('b', [bold]), t('i', [italic]), t('bi', [bold, italic]), t(' s ', [{ type: 'strike' }]),
    t('u', [{ type: 'underline' }]), t('code`tick', [{ type: 'code' }]), t(' '), t('`', [{ type: 'code' }]),
    t('link (x)', [{ type: 'link', attrs: { href: 'https://e.com/a b_(c)' } }]),
    t(' spaced italic ', [italic]), t('end'),
  ),
  adjacentMarks: p(t('a', [bold]), t('b', [italic]), t('c', [bold]), t('d', [bold, italic]), t('e', [italic])),
  wordMarks: p('in', t('side', [italic]), 'word', t('bold', [bold]), 'more'),
  inlineMathOdd: p('x ', { type: 'inlineMath', attrs: { latex: 'a $ b', display: 'no' } }, ' y ', { type: 'inlineMath', attrs: { latex: 'z', display: 'yes' } }),
  codeInList: { type: 'bulletList', content: [li(p('row'), { type: 'codeBlock', attrs: { language: 'js' }, content: [t('x = 1\n\n  y')] }), li(p('next row'))] },
  quoteInList: { type: 'orderedList', content: [li(p('one'), { type: 'blockquote', content: [p('q1'), p('q2')] }, p('after quote')), li(p('two'))] },
  deepList: { type: 'bulletList', content: [li(p('a'), { type: 'orderedList', content: [li(p('b'), { type: 'taskList', content: [ti(true, p('c'), { type: 'bulletList', content: [li(p('d'))] })] })] })] },
  emptyListItem: { type: 'bulletList', content: [li(p()), li(p('x'))] },
  coloredListItem: { type: 'bulletList', content: [{ type: 'listItem', attrs: { backgroundColor: 'red' }, content: [p('x')] }, li(p('y'))] },
  pipeCell: { type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('h | 1')] }, { type: 'tableHeader', content: [p('h2')] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [p('a | b')] }, { type: 'tableCell', content: [p('c', { type: 'hardBreak' }, 'd')] }] },
  ] },
  richCell: { type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('h')] }, { type: 'tableHeader', attrs: { colwidth: [120] }, content: [p('h2')] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [p('a'), { type: 'bulletList', content: [li(p('b'))] }] }, { type: 'tableCell', content: [p('c')] }] },
  ] },
  calloutTypes: { type: 'callout', attrs: { emoji: 'note' }, content: [p('n')] },
  calloutOddIcon: { type: 'callout', attrs: { emoji: 'rocket' }, content: [p('r')] },
  quoteLikeLegacyCallout: { type: 'blockquote', content: [p(t('Note:', [bold]), ' just bold')] },
  openDetails: { type: 'details', attrs: { open: true }, content: [{ type: 'detailsSummary', content: [t('sum ', []), t('bold', [bold])] }, { type: 'detailsContent', content: [p('x')] }] },
  emptySummary: { type: 'details', content: [{ type: 'detailsSummary' }, { type: 'detailsContent', content: [p('x')] }] },
  nestedDetails: { type: 'details', content: [{ type: 'detailsSummary', content: [t('outer')] }, { type: 'detailsContent', content: [
    { type: 'details', content: [{ type: 'detailsSummary', content: [t('inner')] }, { type: 'detailsContent', content: [p('deep')] }] }, p('outer body'),
  ] }] },
  plainCode: { type: 'codeBlock', content: [t('no language')] },
  emptyCode: { type: 'codeBlock', attrs: { language: 'python' } },
  fenceInCode: { type: 'codeBlock', attrs: { language: 'md' }, content: [t('```\ninner\n```\n<!-- parallx:close -->')] },
  imageFull: { type: 'image', attrs: { src: 'img://a b(1).png', alt: 'alt [x]', title: 'T', width: 300 } },
  mathMulti: { type: 'mathBlock', attrs: { latex: 'a\n$$\nb' } },
  colsWide: cols({ type: 'column', attrs: { width: 30 }, content: [p('left'), { type: 'bulletList', content: [li(p('l1'))] }] }, { type: 'column', attrs: { width: 70 }, content: [{ type: 'heading', attrs: { level: 2 }, content: [t('right')] }, { type: 'codeBlock', content: [t('code')] }] }),
  colsInCols: cols(col(p('a'), cols(col(p('b')), col(p('c')))), col(p('d'))),
  toggleRich: { type: 'toggleHeading', attrs: { level: 3 }, content: [{ type: 'toggleHeadingText', content: [t('title '), t('b', [bold])] }, { type: 'detailsContent', content: [p('body'), { type: 'codeBlock', content: [t('c')] }] }] },
  dataview: { type: 'dataview', attrs: { query: 'from "x" where a > 1' } },
  conceptMapMulti: { type: 'conceptMap', attrs: { src: 'Root\n  child --> x\n  other', dir: 'left', overrides: { a: { color: 'red' } } } },
  // Found by a randomized sweep (2026-10-03):
  adjacentItalics: p(t('a', [italic, { type: 'highlight' }]), t('b', [italic]), t('c', [bold, italic]), t('d', [italic])),
  bangBeforeLink: p('wow!', t('link', [{ type: 'link', attrs: { href: 'https://e.com' } }])),
  edgeSpacesInSummaryAndCell: { type: 'details', content: [{ type: 'detailsSummary', content: [t('  spaced summary  ')] }, { type: 'detailsContent', content: [
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p('  padded  ')] }] }] },
  ] }] },
  twoListsInARow: { type: 'bulletList', content: [li(p('row'), { type: 'bulletList', content: [li(p('a'))] }, { type: 'bulletList', content: [li(p('b'))] })] },
  bookmarkFull: { type: 'bookmark', attrs: { url: 'https://e.com', title: 'Title -- with dashes -->', description: 'D', favicon: 'f', image: 'i' } },
};

describe('C12: export then import gives back the same page', () => {
  const blocks = { ...fixtures(), ...extraBlocks };

  for (const [name, block] of Object.entries(blocks)) {
    it(`${name} at the top level`, () => {
      expectSame({ type: 'doc', content: [p('before'), block, p('after')] });
    });
    const inColumn = { type: 'doc', content: [cols(col(p('l'), block, p('l2')), col(p('r')))] };
    // Columns hold most blocks, not all (a dataview, for one).
    it.skipIf(!fits(inColumn))(`${name} inside a column`, () => {
      expectSame(inColumn);
    });
    it(`${name} inside a list item, a quote, a callout and a toggle`, () => {
      expectSame({ type: 'doc', content: [
        { type: 'bulletList', content: [li(p('row'), block, p('tail'))] },
        { type: 'blockquote', content: [p('q'), block] },
        { type: 'callout', attrs: { emoji: 'info' }, content: [block, p('c')] },
        { type: 'details', content: [{ type: 'detailsSummary', content: [t('s')] }, { type: 'detailsContent', content: [block] }] },
      ] });
    });
  }

  it('two lists of the same kind next to each other stay two lists', () => {
    expectSame({ type: 'doc', content: [
      { type: 'bulletList', content: [li(p('a'))] }, { type: 'bulletList', content: [li(p('b'))] },
      { type: 'orderedList', content: [li(p('c'))] }, { type: 'orderedList', content: [li(p('d'))] },
      { type: 'taskList', content: [ti(false, p('e'))] }, { type: 'taskList', content: [ti(true, p('f'))] },
    ] });
  });

  it('an unknown block type is carried through unchanged', () => {
    const doc = { type: 'doc', content: [p('a'), { type: 'futureBlock', attrs: { x: 1 }, content: [p('inner')] }, p('b')] };
    const back = markdownToTiptapJson(tiptapJsonToMarkdown(doc), { assignBlockIds: false });
    expect(back.content![1]).toEqual({ type: 'futureBlock', attrs: { x: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }] });
  });

  it('random text with random marks survives', () => {
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const alphabet = ['a', 'b', ' ', '*', '_', '`', '$', '\\', '[', ']', '(', ')', '<', '>', '#', '-', '+', '|', '~', '=', '!', '1', '.', '&', ':', '"', '\''];
    const markSets = [[], [bold], [italic], [bold, italic], [{ type: 'strike' }], [{ type: 'code' }], [{ type: 'underline' }], [{ type: 'highlight' }],
      [{ type: 'link', attrs: { href: 'https://x.y/(z)' } }], [bold, { type: 'strike' }], [italic, { type: 'link', attrs: { href: 'u' } }]];
    for (let n = 0; n < 400; n++) {
      const parts: any[] = [];
      const count = 1 + rnd(4);
      for (let k = 0; k < count; k++) {
        let s = '';
        const len = 1 + rnd(6);
        for (let c = 0; c < len; c++) s += alphabet[rnd(alphabet.length)];
        const marks = markSets[rnd(markSets.length)];
        parts.push(marks.length ? t(s, marks) : t(s));
      }
      const blockKind = rnd(4);
      const block = blockKind === 0 ? p(...parts)
        : blockKind === 1 ? { type: 'heading', attrs: { level: 2 }, content: parts }
          : blockKind === 2 ? { type: 'bulletList', content: [li(p(...parts))] }
            : { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p(...parts)] }] }] };
      expectSame({ type: 'doc', content: [block] });
    }
  });
});

describe('C12: markdown an AI writes reads as written', () => {
  const read = (md: string) => schema.nodeFromJSON(markdownToTiptapJson(md)).firstChild!;
  const textOf = (md: string) => read(md).textContent;
  const hasMath = (md: string) => { let found = false; read(md).descendants((n) => { if (n.type.name === 'inlineMath') found = true; }); return found; };
  const hasMark = (md: string, mark: string) => { let found = false; read(md).descendants((n) => { if (n.marks.some((m) => m.type.name === mark)) found = true; }); return found; };

  it('dollar amounts stay text', () => {
    expect(textOf('It costs $5 and $10 today')).toBe('It costs $5 and $10 today');
    expect(hasMath('It costs $5 and $10 today')).toBe(false);
    expect(textOf('Pay $5, $6, or $7.')).toBe('Pay $5, $6, or $7.');
  });
  it('real inline math still works', () => {
    expect(hasMath('Area is $\\pi r^2$ here')).toBe(true);
    expect(hasMath('$x$')).toBe(true);
  });
  it('snake_case stays plain', () => {
    expect(textOf('call my_func_name now')).toBe('call my_func_name now');
    expect(hasMark('call my_func_name now', 'italic')).toBe(false);
    expect(hasMark('this is _real_ emphasis', 'italic')).toBe(true);
  });
  it('a lone star is not emphasis', () => {
    expect(textOf('a * b * c')).toBe('a * b * c');
    expect(textOf('2 * 3 = 6 and 4 * 5 = 20')).toBe('2 * 3 = 6 and 4 * 5 = 20');
    expect(hasMark('some *em* text', 'italic')).toBe(true);
  });
  it('backslashes that escape nothing stay', () => {
    expect(textOf('C:\\Users\\me')).toBe('C:\\Users\\me');
    expect(textOf('a \\* b')).toBe('a * b');
  });
  it('a code block inside a list item keeps the list and the text after it', () => {
    const doc = markdownToTiptapJson('- row\n\n  ```js\n  x = 1\n  ```\n- next row\n\nafter', { assignBlockIds: false });
    const node = schema.nodeFromJSON(doc);
    node.check();
    expect(node.childCount).toBe(2);
    expect(node.firstChild!.type.name).toBe('bulletList');
    expect(node.firstChild!.childCount).toBe(2);
    expect(node.firstChild!.firstChild!.child(1).type.name).toBe('codeBlock');
    expect(node.lastChild!.textContent).toBe('after');
  });
  it('a loose list (blank lines between items) is one list', () => {
    const node = schema.nodeFromJSON(markdownToTiptapJson('- a\n\n- b\n\n- c'));
    expect(node.childCount).toBe(1);
    expect(node.firstChild!.childCount).toBe(3);
  });
  it('an image inside a callout or list makes a valid page', () => {
    for (const md of ['> [!note]\n> text ![a](img://x) more', '- row ![a](img://x)', '# Title ![a](img://x)', '| h |\n| --- |\n| ![a](img://x) |', '<details>\n<summary>s $x$ ![a](b)</summary>\n\nbody\n</details>']) {
      expect(() => schema.nodeFromJSON(markdownToTiptapJson(md)).check(), md).not.toThrow();
    }
  });
  it('a numbered list keeps its first number', () => {
    expect(read('3. a\n4. b').attrs.start).toBe(3);
  });
});

describe('C12: reading output (dashboard embed, AI context) is plain', () => {
  it('has no carriers and no escapes, and keeps every word', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', attrs: { backgroundColor: 'red' }, content: [t('It costs $5 and my_func * 2 [x]')] },
      cols(col(p('left side')), col({ type: 'bookmark', attrs: { url: 'https://e.com', title: 'Example' } })),
      { type: 'toggleHeading', attrs: { level: 2 }, content: [{ type: 'toggleHeadingText', content: [t('Toggle title')] }, { type: 'detailsContent', content: [p('hidden body')] }] },
      p(t('blue', [{ type: 'textStyle', attrs: { color: 'blue' } }]), { type: 'hardBreak' }, 'next line'),
      p(),
    ] };
    const md = tiptapJsonToMarkdown(doc, 'Title', { forReading: true });
    expect(md).not.toContain('<!--');
    expect(md).not.toContain('\\');
    expect(md).not.toContain('<span');
    for (const word of ['It costs $5 and my_func * 2 [x]', 'left side', '[Example](https://e.com)', '## Toggle title', 'hidden body', 'blue\nnext line']) {
      expect(md).toContain(word);
    }
    expect(md).not.toMatch(/\n{3,}/);
  });
});
