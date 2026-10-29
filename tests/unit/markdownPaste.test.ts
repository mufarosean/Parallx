// markdownPaste.test.ts — Markdown pasted as plain text becomes blocks; a
// rich paste, plain prose and a paste into code are left alone.
import { describe, it, expect } from 'vitest';
import { looksLikeMarkdown, markdownPasteContent } from '../../src/built-in/canvas/extensions/markdownPaste';

describe('pasting Markdown into a page', () => {
  it('a chat answer copied as Markdown becomes a heading, a list and a table', () => {
    const md = '## Clark\n\n- LDF method\n- Cape Cod method\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    const nodes = markdownPasteContent(['text/plain'], md)!;
    expect(nodes.map((n) => n.type)).toEqual(['heading', 'bulletList', 'table']);
  });

  it('one line of inline Markdown joins the line as text with its marks', () => {
    const nodes = markdownPasteContent(['text/plain'], 'The **tail factor** is `1.05`')!;
    expect(nodes.every((n) => n.type === 'text')).toBe(true);
    expect(nodes.find((n) => n.text === 'tail factor')?.marks?.[0]?.type).toBe('bold');
  });

  it('leaves alone a rich copy, and plain prose', () => {
    expect(markdownPasteContent(['text/plain', 'text/html'], '## Heading')).toBeNull();
    expect(markdownPasteContent(['text/plain'], 'Just a sentence, nothing more.')).toBeNull();
    expect(looksLikeMarkdown('')).toBe(false);
  });

  it('a code editor\'s copy counts as plain text (its HTML is only colouring)', () => {
    expect(markdownPasteContent(['text/plain', 'text/html', 'vscode-editor-data'], '# Notes\n\n- one')?.map((n) => n.type)).toEqual(['heading', 'bulletList']);
  });
});
