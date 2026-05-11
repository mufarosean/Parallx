/**
 * Unit tests for markdownImport.ts — Markdown → TipTap JSON converter
 *
 * Verifies parsing of all supported block types (heading, paragraph, lists,
 * tasks, code blocks, tables, callouts, details, images, math) and inline
 * marks (bold, italic, strike, underline, code, link, highlight, inline math).
 *
 * Also verifies the round-trip property `import(export(doc)) ≈ doc` for the
 * core block types, and the unique-id stamping contract.
 */
import { describe, it, expect } from 'vitest';
import {
  markdownToTiptapJson,
  parseInline,
  type TipTapNode,
} from '../../src/built-in/canvas/markdownImport';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert with no id stamping for cleaner equality assertions. */
function parse(md: string): TipTapNode {
  return markdownToTiptapJson(md, { assignBlockIds: false });
}

/** First block of the parsed doc. */
function firstBlock(md: string): TipTapNode {
  const d = parse(md);
  return d.content![0]!;
}

// ═════════════════════════════════════════════════════════════════════════════
// Block-level parsing
// ═════════════════════════════════════════════════════════════════════════════

describe('markdownToTiptapJson — edge cases', () => {
  it('returns a doc with a single empty paragraph for empty input', () => {
    expect(parse('')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });

  it('returns a doc with a single empty paragraph for whitespace-only input', () => {
    expect(parse('   \n\n  ')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });

  it('normalizes CRLF line endings', () => {
    const doc = parse('# H\r\n\r\nbody');
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0]!.type).toBe('heading');
    expect(doc.content![1]!.type).toBe('paragraph');
  });
});

describe('markdownToTiptapJson — headings', () => {
  it('parses # H1 through ###### H6', () => {
    for (let level = 1; level <= 6; level++) {
      const block = firstBlock(`${'#'.repeat(level)} Title`);
      expect(block.type).toBe('heading');
      expect(block.attrs).toMatchObject({ level });
      expect(block.content).toEqual([{ type: 'text', text: 'Title' }]);
    }
  });

  it('does not parse 7+ hashes as heading', () => {
    expect(firstBlock('####### too deep').type).toBe('paragraph');
  });

  it('parses heading with inline marks', () => {
    const block = firstBlock('## Hello **world**');
    expect(block.type).toBe('heading');
    expect(block.content).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
    ]);
  });
});

describe('markdownToTiptapJson — paragraphs', () => {
  it('parses a single paragraph', () => {
    expect(firstBlock('hello world')).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'hello world' }],
    });
  });

  it('joins multi-line paragraphs into one node', () => {
    const block = firstBlock('hello\nworld');
    expect(block.type).toBe('paragraph');
    expect(block.content).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('separates paragraphs on blank lines', () => {
    const d = parse('a\n\nb');
    expect(d.content).toHaveLength(2);
    expect(d.content![0]!.type).toBe('paragraph');
    expect(d.content![1]!.type).toBe('paragraph');
  });
});

describe('markdownToTiptapJson — horizontal rule', () => {
  it('parses ---', () => {
    expect(firstBlock('---')).toEqual({ type: 'horizontalRule' });
  });

  it('parses *** and ___ as horizontal rules', () => {
    expect(firstBlock('***')).toEqual({ type: 'horizontalRule' });
    expect(firstBlock('___')).toEqual({ type: 'horizontalRule' });
  });
});

describe('markdownToTiptapJson — code blocks', () => {
  it('parses fenced code block with language', () => {
    const block = firstBlock('```ts\nconst x = 1;\n```');
    expect(block).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    });
  });

  it('parses fenced code block without language', () => {
    const block = firstBlock('```\nplain\n```');
    expect(block).toEqual({
      type: 'codeBlock',
      content: [{ type: 'text', text: 'plain' }],
    });
  });

  it('preserves multi-line code content', () => {
    const block = firstBlock('```\nline1\nline2\n```');
    expect(block.content).toEqual([{ type: 'text', text: 'line1\nline2' }]);
  });

  it('does not parse markdown inside code', () => {
    const block = firstBlock('```\n**not bold**\n```');
    expect(block.content).toEqual([{ type: 'text', text: '**not bold**' }]);
  });
});

describe('markdownToTiptapJson — math blocks', () => {
  it('parses $$ latex $$', () => {
    const block = firstBlock('$$\nE = mc^2\n$$');
    expect(block).toEqual({
      type: 'mathBlock',
      attrs: { latex: 'E = mc^2' },
    });
  });
});

describe('markdownToTiptapJson — bullet lists', () => {
  it('parses a flat bullet list', () => {
    const block = firstBlock('- one\n- two\n- three');
    expect(block.type).toBe('bulletList');
    expect(block.content).toHaveLength(3);
    expect(block.content![0]).toEqual({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
    });
  });

  it('parses nested bullet lists', () => {
    const block = firstBlock('- a\n  - b\n  - c\n- d');
    expect(block.type).toBe('bulletList');
    expect(block.content).toHaveLength(2);
    const firstItem = block.content![0]!;
    expect(firstItem.content).toHaveLength(2);
    expect(firstItem.content![1]!.type).toBe('bulletList');
  });

  it('accepts * and + as bullet markers', () => {
    expect(firstBlock('* a').type).toBe('bulletList');
    expect(firstBlock('+ a').type).toBe('bulletList');
  });
});

describe('markdownToTiptapJson — ordered lists', () => {
  it('parses 1. 2. 3.', () => {
    const block = firstBlock('1. one\n2. two');
    expect(block.type).toBe('orderedList');
    expect(block.content).toHaveLength(2);
  });
});

describe('markdownToTiptapJson — task lists', () => {
  it('parses unchecked and checked items', () => {
    const block = firstBlock('- [ ] todo\n- [x] done');
    expect(block.type).toBe('taskList');
    expect(block.content![0]).toMatchObject({
      type: 'taskItem',
      attrs: { checked: false },
    });
    expect(block.content![1]).toMatchObject({
      type: 'taskItem',
      attrs: { checked: true },
    });
  });

  it('accepts X (uppercase) as checked', () => {
    const block = firstBlock('- [X] done');
    expect(block.content![0]!.attrs).toEqual({ checked: true });
  });
});

describe('markdownToTiptapJson — blockquotes & callouts', () => {
  it('parses a plain blockquote', () => {
    const block = firstBlock('> quoted text');
    expect(block.type).toBe('blockquote');
    expect(block.content).toHaveLength(1);
    expect(block.content![0]!.type).toBe('paragraph');
  });

  it('parses a multi-line blockquote', () => {
    const block = firstBlock('> line one\n> line two');
    expect(block.type).toBe('blockquote');
    // Two consecutive `>` lines without a blank between → single joined paragraph
    expect(block.content).toHaveLength(1);
  });

  it('parses GitHub-style [!NOTE] callout', () => {
    const block = firstBlock('> [!note] Heads up\n> body content');
    expect(block.type).toBe('callout');
    expect(block.attrs).toMatchObject({ emoji: 'note' });
    // Title is rendered as the first paragraph with bold text
    expect(block.content![0]!.type).toBe('paragraph');
    expect(block.content![0]!.content![0]!.marks).toEqual([{ type: 'bold' }]);
  });

  it('maps callout types to emojis', () => {
    expect(firstBlock('> [!warning] hi').attrs).toMatchObject({ emoji: 'warning' });
    expect(firstBlock('> [!tip] hi').attrs).toMatchObject({ emoji: 'lightbulb' });
    expect(firstBlock('> [!important] hi').attrs).toMatchObject({ emoji: 'alert' });
  });

  it('parses legacy **Note:** export form as callout', () => {
    const block = firstBlock('> **Info:** something');
    expect(block.type).toBe('callout');
    expect(block.attrs).toMatchObject({ emoji: 'info' });
  });
});

describe('markdownToTiptapJson — images', () => {
  it('parses image alone on a line as block image', () => {
    const block = firstBlock('![alt text](https://x.com/y.png)');
    expect(block).toEqual({
      type: 'image',
      attrs: { alt: 'alt text', src: 'https://x.com/y.png' },
    });
  });

  it('parses image with surrounding text as inline image', () => {
    const block = firstBlock('see ![alt](url) here');
    expect(block.type).toBe('paragraph');
    const img = block.content!.find((n) => n.type === 'image');
    expect(img).toBeDefined();
    expect(img!.attrs).toEqual({ alt: 'alt', src: 'url' });
  });
});

describe('markdownToTiptapJson — tables', () => {
  it('parses a 2-column table with header', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const block = firstBlock(md);
    expect(block.type).toBe('table');
    // header row + 2 body rows
    expect(block.content).toHaveLength(3);
    expect(block.content![0]!.content![0]!.type).toBe('tableHeader');
    expect(block.content![1]!.content![0]!.type).toBe('tableCell');
  });

  it('pads short rows to the header column count', () => {
    const md = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |';
    const block = firstBlock(md);
    expect(block.content![1]!.content).toHaveLength(3);
  });
});

describe('markdownToTiptapJson — details', () => {
  it('parses <details><summary>…</summary>body</details>', () => {
    const md = '<details>\n<summary>Click me</summary>\n\nhidden content\n\n</details>';
    const block = firstBlock(md);
    expect(block.type).toBe('details');
    expect(block.content![0]!.type).toBe('detailsSummary');
    expect(block.content![1]!.type).toBe('detailsContent');
    expect(block.content![0]!.content).toEqual([{ type: 'text', text: 'Click me' }]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Inline parsing
// ═════════════════════════════════════════════════════════════════════════════

describe('parseInline — text marks', () => {
  it('parses **bold**', () => {
    expect(parseInline('**hi**')).toEqual([
      { type: 'text', text: 'hi', marks: [{ type: 'bold' }] },
    ]);
  });

  it('parses *italic* and _italic_', () => {
    expect(parseInline('*hi*')).toEqual([
      { type: 'text', text: 'hi', marks: [{ type: 'italic' }] },
    ]);
    expect(parseInline('_hi_')).toEqual([
      { type: 'text', text: 'hi', marks: [{ type: 'italic' }] },
    ]);
  });

  it('parses ~~strike~~', () => {
    expect(parseInline('~~x~~')).toEqual([
      { type: 'text', text: 'x', marks: [{ type: 'strike' }] },
    ]);
  });

  it('parses ==highlight==', () => {
    expect(parseInline('==x==')).toEqual([
      { type: 'text', text: 'x', marks: [{ type: 'highlight' }] },
    ]);
  });

  it('parses <u>underline</u>', () => {
    expect(parseInline('<u>x</u>')).toEqual([
      { type: 'text', text: 'x', marks: [{ type: 'underline' }] },
    ]);
  });

  it('parses `code`', () => {
    expect(parseInline('`x`')).toEqual([
      { type: 'text', text: 'x', marks: [{ type: 'code' }] },
    ]);
  });

  it('parses [text](url) as link mark', () => {
    const nodes = parseInline('[click](https://x.com)');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.text).toBe('click');
    expect(nodes[0]!.marks).toEqual([{ type: 'link', attrs: { href: 'https://x.com' } }]);
  });

  it('combines nested marks (bold + italic)', () => {
    const nodes = parseInline('**bold *both* end**');
    // Expect: text "bold " bold, text "both" bold+italic, text " end" bold
    expect(nodes).toHaveLength(3);
    expect(nodes[0]!.marks!.map((m) => m.type)).toContain('bold');
    expect(nodes[1]!.marks!.map((m) => m.type).sort()).toEqual(['bold', 'italic']);
  });

  it('handles plain text alongside marks', () => {
    const nodes = parseInline('plain **bold** more');
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toEqual({ type: 'text', text: 'plain ' });
    expect(nodes[1]).toEqual({ type: 'text', text: 'bold', marks: [{ type: 'bold' }] });
    expect(nodes[2]).toEqual({ type: 'text', text: ' more' });
  });

  it('parses backslash escapes', () => {
    expect(parseInline('\\*literal\\*')).toEqual([
      { type: 'text', text: '*literal*' },
    ]);
  });

  it('leaves unmatched delimiters as literal text', () => {
    expect(parseInline('half **open')).toEqual([
      { type: 'text', text: 'half **open' },
    ]);
  });
});

describe('parseInline — inline images and math', () => {
  it('parses inline image as an image node', () => {
    expect(parseInline('![a](u)')).toEqual([
      { type: 'image', attrs: { alt: 'a', src: 'u' } },
    ]);
  });

  it('parses $latex$ as inline math', () => {
    expect(parseInline('$x^2$')).toEqual([
      { type: 'inlineMath', attrs: { latex: 'x^2', display: 'no' } },
    ]);
  });

  it('parses $$latex$$ within line as display math', () => {
    expect(parseInline('see $$x^2$$ here')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'inlineMath', attrs: { latex: 'x^2', display: 'yes' } },
      { type: 'text', text: ' here' },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Unique-id stamping
// ═════════════════════════════════════════════════════════════════════════════

describe('markdownToTiptapJson — unique id stamping', () => {
  it('assigns ids to paragraph, heading, listItem by default', () => {
    let counter = 0;
    const doc = markdownToTiptapJson('# H\n\nbody\n\n- item', {
      idGenerator: () => `id-${counter++}`,
    });
    const heading = doc.content![0]!;
    const para = doc.content![1]!;
    const list = doc.content![2]!;
    expect(heading.attrs).toMatchObject({ id: expect.any(String) });
    expect(para.attrs).toMatchObject({ id: expect.any(String) });
    expect(list.attrs).toMatchObject({ id: expect.any(String) });
    expect(list.content![0]!.attrs).toMatchObject({ id: expect.any(String) });
  });

  it('does not assign ids when assignBlockIds=false', () => {
    const doc = markdownToTiptapJson('# H', { assignBlockIds: false });
    expect(doc.content![0]!.attrs).toEqual({ level: 1 });
  });

  it('uses the provided idGenerator', () => {
    let n = 0;
    const doc = markdownToTiptapJson('one\n\ntwo', {
      idGenerator: () => `gen-${++n}`,
    });
    const ids = doc.content!.map((b) => b.attrs!['id']);
    expect(ids).toEqual(['gen-1', 'gen-2']);
  });

  it('does not assign ids to inline text nodes', () => {
    const doc = markdownToTiptapJson('hello **world**');
    const para = doc.content![0]!;
    for (const child of para.content ?? []) {
      expect(child.attrs?.['id']).toBeUndefined();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Round-trip property
// ═════════════════════════════════════════════════════════════════════════════

describe('markdown round-trip (import ∘ export)', () => {
  /** Strip ids and remove empty content arrays for structural comparison. */
  function stripIds(node: TipTapNode): TipTapNode {
    const next: TipTapNode = { type: node.type };
    if (node.text !== undefined) next.text = node.text;
    if (node.marks) next.marks = node.marks;
    if (node.attrs) {
      const { id: _id, ...rest } = node.attrs as Record<string, unknown>;
      if (Object.keys(rest).length > 0) next.attrs = rest;
    }
    if (node.content) {
      next.content = node.content.map(stripIds);
    }
    return next;
  }

  const cases: { name: string; md: string }[] = [
    { name: 'heading', md: '# Hello' },
    { name: 'paragraph', md: 'A simple paragraph.' },
    { name: 'bold + italic', md: '**bold** and *italic* text.' },
    { name: 'bullet list', md: '- one\n- two\n- three' },
    { name: 'ordered list', md: '1. one\n2. two' },
    { name: 'task list', md: '- [ ] todo\n- [x] done' },
    { name: 'horizontal rule', md: '---' },
    { name: 'fenced code', md: '```ts\nconst x = 1;\n```' },
    { name: 'block image', md: '![alt](https://x.com/y.png)' },
  ];

  for (const { name, md } of cases) {
    it(`round-trips ${name}`, () => {
      const doc = markdownToTiptapJson(md, { assignBlockIds: false });
      const remitted = tiptapJsonToMarkdown(doc);
      const reparsed = markdownToTiptapJson(remitted, { assignBlockIds: false });
      expect(stripIds(reparsed)).toEqual(stripIds(doc));
    });
  }
});
