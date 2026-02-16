/**
 * Unit tests for markdownExport.ts — TipTap JSON → Markdown converter
 *
 * Tests all block types (paragraph, heading, lists, code blocks, tables,
 * callouts, details, images, horizontal rules) and inline marks
 * (bold, italic, strike, underline, code, link, highlight).
 */
import { describe, it, expect } from 'vitest';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wrap content nodes in a doc root node */
function doc(...content: Record<string, unknown>[]): unknown {
  return { type: 'doc', content };
}

/** Paragraph with text nodes */
function p(...texts: (string | Record<string, unknown>)[]): Record<string, unknown> {
  return {
    type: 'paragraph',
    content: texts.map(t =>
      typeof t === 'string' ? { type: 'text', text: t } : t
    ),
  };
}

/** Text node with marks */
function text(str: string, marks?: Record<string, unknown>[]): Record<string, unknown> {
  return { type: 'text', text: str, marks };
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('tiptapJsonToMarkdown', () => {

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty string for null input', () => {
      expect(tiptapJsonToMarkdown(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(tiptapJsonToMarkdown(undefined)).toBe('');
    });

    it('returns empty string for non-doc object', () => {
      expect(tiptapJsonToMarkdown({ type: 'paragraph' })).toBe('');
    });

    it('returns H1 title for null input when title provided', () => {
      expect(tiptapJsonToMarkdown(null, 'My Page')).toBe('# My Page\n');
    });

    it('returns H1 title for empty doc when title provided', () => {
      expect(tiptapJsonToMarkdown({ type: 'doc', content: [] }, 'My Page')).toBe('# My Page\n');
    });

    it('handles doc with no content array', () => {
      expect(tiptapJsonToMarkdown({ type: 'doc' })).toBe('');
    });
  });

  // ── Title ────────────────────────────────────────────────────────────────

  describe('title', () => {
    it('prepends H1 title when provided', () => {
      const result = tiptapJsonToMarkdown(doc(p('Hello')), 'My Page');
      expect(result).toContain('# My Page\n');
      expect(result).toContain('Hello');
    });

    it('omits H1 when no title provided', () => {
      const result = tiptapJsonToMarkdown(doc(p('Hello')));
      expect(result).not.toContain('# ');
      expect(result).toBe('Hello\n');
    });
  });

  // ── Paragraphs ──────────────────────────────────────────────────────────

  describe('paragraphs', () => {
    it('renders a simple paragraph', () => {
      const result = tiptapJsonToMarkdown(doc(p('Hello world')));
      expect(result).toBe('Hello world\n');
    });

    it('renders multiple paragraphs', () => {
      const result = tiptapJsonToMarkdown(doc(p('First'), p('Second')));
      expect(result).toBe('First\n\nSecond\n');
    });

    it('renders empty paragraph as blank line', () => {
      const result = tiptapJsonToMarkdown(doc({ type: 'paragraph' }));
      expect(result).toBe('\n');
    });
  });

  // ── Headings ────────────────────────────────────────────────────────────

  describe('headings', () => {
    it('renders H1', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Title' }],
      }));
      expect(result).toBe('# Title\n');
    });

    it('renders H2', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Subtitle' }],
      }));
      expect(result).toBe('## Subtitle\n');
    });

    it('renders H3 through H6', () => {
      for (let level = 3; level <= 6; level++) {
        const result = tiptapJsonToMarkdown(doc({
          type: 'heading',
          attrs: { level },
          content: [{ type: 'text', text: `H${level}` }],
        }));
        expect(result).toBe(`${'#'.repeat(level)} H${level}\n`);
      }
    });

    it('caps at H6 for levels > 6', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'heading',
        attrs: { level: 7 },
        content: [{ type: 'text', text: 'Deep' }],
      }));
      expect(result).toBe('###### Deep\n');
    });

    it('defaults to H1 when level missing', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'heading',
        content: [{ type: 'text', text: 'No Level' }],
      }));
      expect(result).toBe('# No Level\n');
    });
  });

  // ── Inline Marks ───────────────────────────────────────────────────────

  describe('inline marks', () => {
    it('renders bold text', () => {
      const result = tiptapJsonToMarkdown(doc(
        p(text('bold', [{ type: 'bold' }]))
      ));
      expect(result).toBe('**bold**\n');
    });

    it('renders italic text', () => {
      const result = tiptapJsonToMarkdown(doc(
        p(text('italic', [{ type: 'italic' }]))
      ));
      expect(result).toBe('*italic*\n');
    });

    it('renders strikethrough text', () => {
      const result = tiptapJsonToMarkdown(doc(
        p(text('deleted', [{ type: 'strike' }]))
      ));
      expect(result).toBe('~~deleted~~\n');
    });

    it('renders underline text', () => {
      const result = tiptapJsonToMarkdown(doc(
        p(text('underlined', [{ type: 'underline' }]))
      ));
      expect(result).toBe('<u>underlined</u>\n');
    });

    it('renders inline code', () => {
      const result = tiptapJsonToMarkdown(doc(
        p(text('const x', [{ type: 'code' }]))
      ));
      expect(result).toBe('`const x`\n');
    });

    it('renders link text', () => {
      const result = tiptapJsonToMarkdown(doc(
        p(text('click here', [{ type: 'link', attrs: { href: 'https://example.com' } }]))
      ));
      expect(result).toBe('[click here](https://example.com)\n');
    });

    it('renders highlight text', () => {
      const result = tiptapJsonToMarkdown(doc(
        p(text('important', [{ type: 'highlight' }]))
      ));
      expect(result).toBe('==important==\n');
    });

    it('renders multiple marks on same text', () => {
      const result = tiptapJsonToMarkdown(doc(
        p(text('strong emphasis', [{ type: 'bold' }, { type: 'italic' }]))
      ));
      expect(result).toBe('***strong emphasis***\n');
    });

    it('renders mixed text with and without marks', () => {
      const result = tiptapJsonToMarkdown(doc(
        p('Plain ', text('bold', [{ type: 'bold' }]), ' plain again')
      ));
      expect(result).toBe('Plain **bold** plain again\n');
    });
  });

  // ── Bullet Lists ──────────────────────────────────────────────────────

  describe('bullet lists', () => {
    it('renders a simple bullet list', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p('Item 1')] },
          { type: 'listItem', content: [p('Item 2')] },
          { type: 'listItem', content: [p('Item 3')] },
        ],
      }));
      expect(result).toContain('- Item 1');
      expect(result).toContain('- Item 2');
      expect(result).toContain('- Item 3');
    });

    it('renders nested bullet lists', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              p('Parent'),
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', content: [p('Child')] },
                ],
              },
            ],
          },
        ],
      }));
      expect(result).toContain('- Parent');
      expect(result).toContain('  - Child');
    });
  });

  // ── Ordered Lists ─────────────────────────────────────────────────────

  describe('ordered lists', () => {
    it('renders an ordered list with numbered items', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [p('First')] },
          { type: 'listItem', content: [p('Second')] },
          { type: 'listItem', content: [p('Third')] },
        ],
      }));
      expect(result).toContain('1. First');
      expect(result).toContain('2. Second');
      expect(result).toContain('3. Third');
    });
  });

  // ── Task Lists ────────────────────────────────────────────────────────

  describe('task lists', () => {
    it('renders unchecked task items', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: false }, content: [p('Todo')] },
        ],
      }));
      expect(result).toContain('- [ ] Todo');
    });

    it('renders checked task items', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p('Done')] },
        ],
      }));
      expect(result).toContain('- [x] Done');
    });

    it('renders mixed checked/unchecked items', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p('Done')] },
          { type: 'taskItem', attrs: { checked: false }, content: [p('Todo')] },
        ],
      }));
      expect(result).toContain('- [x] Done');
      expect(result).toContain('- [ ] Todo');
    });
  });

  // ── Blockquote ────────────────────────────────────────────────────────

  describe('blockquote', () => {
    it('renders a blockquote', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'blockquote',
        content: [p('Quoted text')],
      }));
      expect(result).toContain('> Quoted text');
    });

    it('renders multi-line blockquote', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'blockquote',
        content: [p('Line 1'), p('Line 2')],
      }));
      expect(result).toContain('> Line 1');
      expect(result).toContain('> Line 2');
    });
  });

  // ── Code Block ────────────────────────────────────────────────────────

  describe('code block', () => {
    it('renders a code block without language', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'codeBlock',
        content: [{ type: 'text', text: 'const x = 1;' }],
      }));
      expect(result).toContain('```\nconst x = 1;\n```');
    });

    it('renders a code block with language', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [{ type: 'text', text: 'const x: number = 1;' }],
      }));
      expect(result).toContain('```typescript\nconst x: number = 1;\n```');
    });

    it('renders empty code block', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'codeBlock',
      }));
      expect(result).toContain('```\n\n```');
    });
  });

  // ── Horizontal Rule ───────────────────────────────────────────────────

  describe('horizontal rule', () => {
    it('renders a horizontal rule', () => {
      const result = tiptapJsonToMarkdown(doc(
        p('Before'),
        { type: 'horizontalRule' },
        p('After')
      ));
      expect(result).toContain('Before');
      expect(result).toContain('---');
      expect(result).toContain('After');
    });
  });

  // ── Callout ───────────────────────────────────────────────────────────

  describe('callout', () => {
    it('renders a callout with icon label prefix', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'callout',
        attrs: { emoji: 'bolt' },
        content: [p('Warning text')],
      }));
      expect(result).toContain('> **Bolt:** Warning text');
    });

    it('renders callout with default lightbulb label when none specified', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'callout',
        content: [p('Info text')],
      }));
      expect(result).toContain('> **Note:** Info text');
    });
  });

  // ── Details ───────────────────────────────────────────────────────────

  describe('details', () => {
    it('renders a details/summary block', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'details',
        content: [
          {
            type: 'detailsSummary',
            content: [{ type: 'text', text: 'Click to expand' }],
          },
          {
            type: 'detailsContent',
            content: [p('Hidden content')],
          },
        ],
      }));
      expect(result).toContain('<details>');
      expect(result).toContain('<summary>Click to expand</summary>');
      expect(result).toContain('Hidden content');
      expect(result).toContain('</details>');
    });

    it('uses "Details" as default summary', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'details',
        content: [
          {
            type: 'detailsContent',
            content: [p('Content')],
          },
        ],
      }));
      expect(result).toContain('<summary>Details</summary>');
    });
  });

  // ── Table ─────────────────────────────────────────────────────────────

  describe('table', () => {
    it('renders a simple table', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [p('Name')] },
              { type: 'tableHeader', content: [p('Value')] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [p('A')] },
              { type: 'tableCell', content: [p('1')] },
            ],
          },
        ],
      }));
      expect(result).toContain('| Name');
      expect(result).toContain('| A');
      expect(result).toContain('---'); // separator
    });

    it('handles empty table', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'table',
        content: [],
      }));
      // Should not crash
      expect(result).toBeDefined();
    });
  });

  // ── Image ─────────────────────────────────────────────────────────────

  describe('image', () => {
    it('renders a block-level image', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'image',
        attrs: { src: 'photo.png', alt: 'My Photo' },
      }));
      expect(result).toBe('![My Photo](photo.png)\n');
    });

    it('renders image with no alt text', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'image',
        attrs: { src: 'pic.jpg' },
      }));
      expect(result).toBe('![](pic.jpg)\n');
    });

    it('renders inline image within paragraph', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'image', attrs: { src: 'img.png', alt: 'screenshot' } },
        ],
      }));
      expect(result).toContain('See ![screenshot](img.png)');
    });
  });

  // ── Hard Break ────────────────────────────────────────────────────────

  describe('hard break', () => {
    it('renders a hard break as newline', () => {
      const result = tiptapJsonToMarkdown(doc({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'hardBreak' },
          { type: 'text', text: 'Line 2' },
        ],
      }));
      expect(result).toContain('Line 1\nLine 2');
    });
  });

  // ── Complex Document ──────────────────────────────────────────────────

  describe('complex document', () => {
    it('renders a document with multiple block types', () => {
      const result = tiptapJsonToMarkdown(doc(
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Features' }],
        },
        p('Here are the features:'),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [p(text('Fast', [{ type: 'bold' }]))] },
            { type: 'listItem', content: [p(text('Reliable', [{ type: 'italic' }]))] },
          ],
        },
        { type: 'horizontalRule' },
        {
          type: 'codeBlock',
          attrs: { language: 'js' },
          content: [{ type: 'text', text: 'console.log("hello");' }],
        },
      ), 'Readme');

      expect(result).toContain('# Readme');
      expect(result).toContain('## Features');
      expect(result).toContain('Here are the features:');
      expect(result).toContain('- **Fast**');
      expect(result).toContain('- *Reliable*');
      expect(result).toContain('---');
      expect(result).toContain('```js');
      expect(result).toContain('console.log("hello");');
    });

    it('collapses excessive blank lines', () => {
      const result = tiptapJsonToMarkdown(doc(
        p('A'),
        { type: 'paragraph' },
        { type: 'paragraph' },
        p('B'),
      ));
      // Should not have more than 2 consecutive newlines
      expect(result).not.toMatch(/\n{3,}/);
    });
  });
});
