// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { _markdownToHtml, _postProcessMathFallbacksForTest, renderContentPart } from '../../src/built-in/chat/rendering/chatContentParts';

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
    expect(html).toMatch(/<p>Line one<br>\s*Line two<\/p>/);
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
    expect(html).toMatch(/<ul>\s*<li>One<\/li>\s*<li>Two<\/li>\s*<\/ul>/);
  });

  it('renders unordered list with + marker', () => {
    const html = _markdownToHtml('+ Alpha\n+ Beta');
    expect(html).toMatch(/<ul>\s*<li>Alpha<\/li>\s*<li>Beta<\/li>\s*<\/ul>/);
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
    expect(html).toMatch(/<li>\s*<p>First<\/p>\s*<\/li>/);
    expect(html).toMatch(/<li>\s*<p>Second<\/p>\s*<\/li>/);
    expect(html).toMatch(/<li>\s*<p>Third<\/p>\s*<\/li>/);
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
    expect(html).toContain('<pre><code class="language-js">const x = 1;\n</code></pre>');
  });

  it('escapes HTML inside code blocks', () => {
    const html = _markdownToHtml('```\n<div>test</div>\n```');
    expect(html).toContain('&lt;div&gt;test&lt;/div&gt;');
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
    expect(html).toContain('<s>deleted</s>');
  });

  it('renders links', () => {
    const html = _markdownToHtml('Visit [Example](https://example.com)');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener">Example</a>');
  });

  it('renders inline math with \\(...\\)', () => {
    const html = _markdownToHtml(String.raw`The factor is \(f_j = 1.08\).`);
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('\\(');
    expect(html).not.toContain('\\)');
  });

  it('renders inline math with $...$', () => {
    const html = _markdownToHtml('Use $f_j^*=1.12$ for the estimate.');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('$f_j^*=1.12$');
  });

  it('renders display math with \\[...\\]', () => {
    const md = [String.raw`\[`, String.raw`f_j = \frac{a}{b}`, String.raw`\]`].join('\n');
    const html = _markdownToHtml(md);
    expect(html).toContain('class="parallx-chat-math-block"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('\\[');
    expect(html).not.toContain('\\]');
  });

  it('does not render math syntax inside fenced code blocks', () => {
    const html = _markdownToHtml(`\`\`\`tex\n${String.raw`\[f_j = \frac{a}{b}\]`}\n\`\`\``);
    expect(html).toContain(String.raw`\[f_j = \frac{a}{b}\]`);
    expect(html).not.toContain('class="katex"');
  });

  it('strips stray delimiter text nodes around rendered math', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>$<span class="katex">rendered math</span>$</p>';
    _postProcessMathFallbacksForTest(container);
    expect(container.innerHTML).toBe('<p><span class="katex">rendered math</span></p>');
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
    expect(html).toMatch(/<ul>\s*<li>Point one<\/li>\s*<li>Point two<\/li>\s*<\/ul>/);
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
    expect(html).toMatch(/<li>\s*<p><strong>Contents:<\/strong><\/p>\s*<\/li>/);
    expect(html).toMatch(/<li>\s*<p>Contact Information:<\/p>\s*<\/li>/);
    expect(html).toMatch(/<li>\s*<p>Name: Sarah Chen<\/p>\s*<\/li>/);
    // All items in one <ul>, not split into multiple
    expect(html.match(/<ul>/g)?.length).toBe(1);
  });

  it('preserves ordered list start values when numbering resumes after a block', () => {
    const md = [
      '1. Estimate Age-to-Age Factors:',
      '',
      '- Compute the age-to-age factors.',
      '',
      String.raw`\[`,
      String.raw`f_j = \frac{C_{i,j+1}}{C_{i,j}}`,
      String.raw`\]`,
      '',
      '2. Calculate Volume-Weighted Factors:',
      '',
      '- Use the weighted average.',
    ].join('\n');
    const html = _markdownToHtml(md);
    expect(html).toContain('<ol>');
    expect(html).toContain('<ol start="2">');
    expect(html).toContain('class="parallx-chat-math-block"');
  });

  it('renders the chain-ladder style finance answer without resetting numbering to 1', () => {
    const md = [
      '1. Estimate Age-to-Age Factors:',
      '',
      '- Compute the age-to-age factors (LDFs) for each development period.',
      String.raw`- Let \(C_{i,j}\) be the cumulative losses at the end of accident year \(i\) and development period \(j\).`,
      String.raw`- The age-to-age factor \(f_j\) for development period \(j\) is given by:`,
      '',
      String.raw`\[`,
      String.raw`f_j = \frac{\sum_{i=1}^{n-j} C_{i,j+1}}{\sum_{i=1}^{n-j} C_{i,j}}`,
      String.raw`\]`,
      '',
      '2. Calculate Volume-Weighted Factors:',
      '',
      String.raw`- Compute the volume-weighted factors: \(f_j^*\):`,
      '',
      String.raw`\[`,
      String.raw`f_j^* = \frac{\sum_{i=1}^{n-j} C_{i,j} \cdot f_j}{\sum_{i=1}^{n-j} C_{i,j}}`,
      String.raw`\]`,
    ].join('\n');

    const html = _markdownToHtml(md);
    expect(html).toContain('<ol start="2">');
    expect(html.match(/class="parallx-chat-math-block"/g)?.length).toBe(2);
    expect(html.match(/class="katex"/g)?.length).toBeGreaterThan(1);
    expect(html).not.toContain('>1. Calculate Volume-Weighted Factors');
  });

  it('renders plain bracketed display math in the screenshot-style answer flow', () => {
    const part = {
      kind: 'markdown',
      content: [
        '1. Estimate Age-to-Age Factors (LDFs):',
        '',
        String.raw`- For each development period \(j\), calculate the age-to-age factors \(f_j\):`,
        '',
        '[',
        String.raw`f_j = \frac{\sum_{i=1}^{n-j} C_{i,j+1}}{\sum_{i=1}^{n-j} C_{i,j}}`,
        ']',
        '',
        String.raw`where \(C_{i,j}\) is the cumulative loss amount for accident year \(i\).`,
      ].join('\n'),
    } as any;

    const element = renderContentPart(part);
    expect(element.querySelectorAll('.parallx-chat-math-block')).toHaveLength(1);
    expect(element.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(element.textContent || '').not.toContain('[\nf_j');
  });

  it('normalizes standalone bracket math lines into a rendered display equation', () => {
    const html = _markdownToHtml([
      '3. Calculate the Weighted Residuals:',
      '',
      '- The weighted residual for each cell can be calculated using the formula:',
      '',
      '[',
      String.raw`\text{Weighted Residual} = \frac{\text{Actual Loss} - \text{Predicted Loss}}{\sqrt{\text{Prior Cumulative Loss}}}`,
      ']',
    ].join('\n'));

    expect(html).toContain('class="parallx-chat-math-block"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('<p>[</p>');
    expect(html).not.toContain('Weighted Residual} = \\frac');
  });

  it('converts aligned loss triangles into markdown tables', () => {
    const html = _markdownToHtml([
      'Given the following cumulative losses:',
      '',
      'Year 12 months 24 months 36 months',
      '2010 1,200 1,700',
      '2011 500 2,600 3,000',
      '2012 2,600 3,000 4,680',
      '2013 700 2,100 1,260',
    ].join('\n'));

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Year</th>');
    expect(html).toContain('<th>12 months</th>');
    expect(html).toContain('<td>2011</td>');
    expect(html).toContain('<td>3,000</td>');
  });
});
