// @vitest-environment jsdom
// Shared Markdown + KaTeX renderer — the math-before-markdown contract.
// User report: advanced LaTeX (especially aligned multi-formula blocks)
// did not render; markdown was eating `\\` row separators and `_`/`*`
// inside math before KaTeX ever saw them.

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../src/ui/renderMarkdown.js';

const text = (el: HTMLElement) => el.textContent ?? '';

describe('renderMarkdown — math protection', () => {
  it('renders a $$ display block spanning multiple lines', () => {
    const el = renderMarkdown('Before\n\n$$\nMSE = Var + Bias^2\n$$\n\nAfter');
    expect(el.querySelectorAll('.katex').length).toBe(1);
    expect(el.querySelector('.px-markdown__math--display')).toBeTruthy();
    expect(text(el)).toContain('Before');
    expect(text(el)).toContain('After');
  });

  it('renders an aligned block with \\\\ row separators intact', () => {
    const src = '$$\\begin{aligned} a &= b + c \\\\ d &= e \\times f \\end{aligned}$$';
    const el = renderMarkdown(src);
    expect(el.querySelectorAll('.katex').length).toBe(1);
    // Both rows survived: the aligned environment produces one row per \\.
    expect(el.querySelectorAll('.katex .vlist > span').length).toBeGreaterThan(1);
    // No parse failure (KaTeX marks failures with .katex-error; note that
    // textContent ALWAYS contains the raw source via the a11y MathML).
    expect(el.querySelector('.katex-error')).toBeNull();
  });

  it('renders a BARE \\begin{aligned} block (no $$ wrapper) as display math', () => {
    const el = renderMarkdown('\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}');
    expect(el.querySelectorAll('.katex').length).toBe(1);
    expect(el.querySelector('.px-markdown__math--display')).toBeTruthy();
  });

  it('maps align/gather (unsupported top-level) onto aligned/gathered', () => {
    const el = renderMarkdown('\\begin{align} a &= b \\\\ c &= d \\end{align}');
    expect(el.querySelectorAll('.katex').length).toBe(1);
    // Without the mapping KaTeX rejects top-level align → .katex-error.
    expect(el.querySelector('.katex-error')).toBeNull();
  });

  it('underscores and asterisks inside math never open markdown emphasis', () => {
    const el = renderMarkdown('The weights $w_i$ and $w_j$ satisfy $a * b$ where *this* is emphasis.');
    expect(el.querySelectorAll('.katex').length).toBe(3);
    // The real emphasis outside math still works.
    expect(el.querySelector('em')?.textContent).toBe('this');
    // No math source leaked as italics.
    expect(text(el)).not.toContain('$');
  });

  it('multiple formulas in one sentence all render', () => {
    const el = renderMarkdown('$\\phi_{ind}^2$, then $\\phi_{int}^2$, then $\\sigma^2 = \\ln(1+\\phi^2)$.');
    expect(el.querySelectorAll('.katex').length).toBe(3);
  });

  it('dollars inside code stay literal', () => {
    const el = renderMarkdown('Use `awk $1 $2` and:\n\n```\nprice = $100\n```');
    expect(el.querySelectorAll('.katex').length).toBe(0);
    expect(el.querySelector('code')?.textContent).toContain('$1 $2');
    expect(el.querySelector('pre')?.textContent).toContain('$100');
  });

  it('money amounts are not mistaken for math', () => {
    const el = renderMarkdown('It costs $5 and then $10 more.');
    expect(text(el)).toContain('$5');
    expect(text(el)).toContain('$10');
  });

  it('plain markdown still renders (bold, lists)', () => {
    const el = renderMarkdown('**Key term**\n\n- one\n- two');
    expect(el.querySelector('strong')?.textContent).toBe('Key term');
    expect(el.querySelectorAll('li').length).toBe(2);
  });

  it('unsupported macros leave the raw source visible, never throw', () => {
    const el = renderMarkdown('$\\notarealmacro{x}$');
    expect(el).toBeTruthy(); // no throw; KaTeX renders an error-colored span
  });
});
