// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { _markdownToHtml } from '../../src/built-in/chat/rendering/chatContentParts';

describe('_markdownToHtml — block-level parser', () => {

  // ── Headings ──

  it('renders h1, h2, h3 headings', () => {
    const html = _markdownToHtml('# Title\n## Subtitle\n### Section');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h2>Subtitle</h2>');
    expect(html).toContain('<h3>Section</h3>');
  });

  it('applies inline formatting inside headings', () => {
    const html = _markdownToHtml('## **Bold** and `code` heading');
    expect(html).toContain('<h2><strong>Bold</strong> and <code>code</code> heading</h2>');
  });

  // ── Paragraphs ──

  it('wraps plain text in <p>', () => {
    const html = _markdownToHtml('Hello world');
    expect(html).toContain('<p>Hello world</p>');
  });

  it('joins consecutive lines with <br>', () => {
    const html = _markdownToHtml('Line one\nLine two');
    expect(html).toContain('<p>Line one<br>Line two</p>');
  });

  it('separates paragraphs on blank lines', () => {
    const html = _markdownToHtml('Paragraph one\n\nParagraph two');
    expect(html).toContain('<p>Paragraph one</p>');
    expect(html).toContain('<p>Paragraph two</p>');
  });

  // ── Unordered Lists ──

  it('renders unordered list with - marker', () => {
    const html = _markdownToHtml('- Apple\n- Banana\n- Cherry');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Apple</li>');
    expect(html).toContain('<li>Banana</li>');
    expect(html).toContain('<li>Cherry</li>');
    expect(html).toContain('</ul>');
  });

  it('renders unordered list with * marker', () => {
    const html = _markdownToHtml('* One\n* Two');
    expect(html).toContain('<ul><li>One</li><li>Two</li></ul>');
  });

  it('renders unordered list with + marker', () => {
    const html = _markdownToHtml('+ Alpha\n+ Beta');
    expect(html).toContain('<ul><li>Alpha</li><li>Beta</li></ul>');
  });

  it('handles indented list items (spaces before marker)', () => {
    const html = _markdownToHtml('  - Indented one\n  - Indented two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Indented one</li>');
    expect(html).toContain('<li>Indented two</li>');
  });

  it('keeps list together across blank lines when next item continues', () => {
    const html = _markdownToHtml('- First\n\n- Second\n\n- Third');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>First</li>');
    expect(html).toContain('<li>Second</li>');
    expect(html).toContain('<li>Third</li>');
    expect(html).toContain('</ul>');
    // Should be ONE list, not three
    expect(html.match(/<ul>/g)?.length).toBe(1);
  });

  it('applies inline formatting inside list items', () => {
    const html = _markdownToHtml('- **Bold item**\n- `code item`\n- *italic*');
    expect(html).toContain('<li><strong>Bold item</strong></li>');
    expect(html).toContain('<li><code>code item</code></li>');
    expect(html).toContain('<li><em>italic</em></li>');
  });

  // ── Ordered Lists ──

  it('renders ordered list', () => {
    const html = _markdownToHtml('1. First\n2. Second\n3. Third');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>First</li>');
    expect(html).toContain('<li>Second</li>');
    expect(html).toContain('<li>Third</li>');
    expect(html).toContain('</ol>');
  });

  it('handles ordered list with ) delimiter', () => {
    const html = _markdownToHtml('1) First\n2) Second');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>First</li>');
    expect(html).toContain('<li>Second</li>');
  });

  // ── Code Blocks ──

  it('renders fenced code block', () => {
    const html = _markdownToHtml('```js\nconst x = 1;\n```');
    expect(html).toContain('<pre data-lang="js"><code>const x = 1;</code></pre>');
  });

  it('escapes HTML inside code blocks', () => {
    const html = _markdownToHtml('```\n<div>test</div>\n```');
    expect(html).toContain('&lt;div&gt;');
  });

  it('does not process markdown inside code blocks', () => {
    const html = _markdownToHtml('```\n# Not a heading\n**not bold**\n```');
    expect(html).not.toContain('<h1>');
    expect(html).not.toContain('<strong>');
  });

  // ── Inline Formatting ──

  it('renders bold text', () => {
    const html = _markdownToHtml('This is **bold** text');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders bold with __ syntax', () => {
    const html = _markdownToHtml('This is __bold__ text');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders italic text', () => {
    const html = _markdownToHtml('This is *italic* text');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders inline code', () => {
    const html = _markdownToHtml('Use `console.log()` for debugging');
    expect(html).toContain('<code>console.log()</code>');
  });

  it('renders strikethrough', () => {
    const html = _markdownToHtml('This is ~~deleted~~ text');
    expect(html).toContain('<del>deleted</del>');
  });

  it('renders links', () => {
    const html = _markdownToHtml('Visit [Example](https://example.com)');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener">Example</a>');
  });

  // ── Blockquotes ──

  it('renders blockquote', () => {
    const html = _markdownToHtml('> This is a quote');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a quote');
    expect(html).toContain('</blockquote>');
  });

  it('renders multi-line blockquote', () => {
    const html = _markdownToHtml('> Line 1\n> Line 2');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('Line 1');
    expect(html).toContain('Line 2');
  });

  // ── Horizontal Rule ──

  it('renders horizontal rule from ---', () => {
    const html = _markdownToHtml('Above\n\n---\n\nBelow');
    expect(html).toContain('<hr>');
  });

  it('renders horizontal rule from ***', () => {
    const html = _markdownToHtml('***');
    expect(html).toContain('<hr>');
  });

  // ── HTML Escaping ──

  it('escapes HTML entities in text', () => {
    const html = _markdownToHtml('Use <div> & "quotes"');
    expect(html).toContain('&lt;div&gt;');
    expect(html).toContain('&amp;');
  });

  // ── Mixed Content (realistic LLM output) ──

  it('handles heading followed by list', () => {
    const md = '## Files\n\n- README.md\n- package.json';
    const html = _markdownToHtml(md);
    expect(html).toContain('<h2>Files</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>README.md</li>');
    expect(html).toContain('<li>package.json</li>');
    // No <br> between heading and list  
    expect(html).not.toMatch(/<\/h2>\s*<br>/);
  });

  it('handles paragraph → heading → list → paragraph flow', () => {
    const md = 'Here is a summary:\n\n## Overview\n\n- Point one\n- Point two\n\nThat covers it.';
    const html = _markdownToHtml(md);
    expect(html).toContain('<p>Here is a summary:</p>');
    expect(html).toContain('<h2>Overview</h2>');
    expect(html).toContain('<ul><li>Point one</li><li>Point two</li></ul>');
    expect(html).toContain('<p>That covers it.</p>');
  });

  it('does not inject <br> inside list items', () => {
    const html = _markdownToHtml('- Alpha\n- Beta\n- Gamma');
    expect(html).not.toContain('<br>');
  });

  it('does not wrap block elements in <p> tags', () => {
    const md = '## Heading\n\n- Item\n\nParagraph';
    const html = _markdownToHtml(md);
    // No <p><h2>...</h2></p> or <p><ul>...</ul></p>
    expect(html).not.toMatch(/<p>\s*<h[123]/);
    expect(html).not.toMatch(/<p>\s*<ul/);
  });

  it('handles LLM workspace summary pattern', () => {
    const md = [
      '## Agent Contacts.md',
      '',
      '- **Contents:**',
      '',
      '- Contact Information:',
      '- Name: Sarah Chen',
      '- Phone Number: (555) 234-5678',
    ].join('\n');
    const html = _markdownToHtml(md);
    expect(html).toContain('<h2>Agent Contacts.md</h2>');
    expect(html).toContain('<li><strong>Contents:</strong></li>');
    expect(html).toContain('<li>Contact Information:</li>');
    expect(html).toContain('<li>Name: Sarah Chen</li>');
    // All items in one <ul>, not split into multiple
    expect(html.match(/<ul>/g)?.length).toBe(1);
  });
});
