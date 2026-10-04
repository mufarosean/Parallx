// @vitest-environment jsdom
// canvasPageTreeBlocks.test.ts — Breadcrumb and Sub-page List blocks.

import { describe, it, expect, vi } from 'vitest';
import { renderBreadcrumb, renderSubpages } from '../../src/built-in/canvas/extensions/pageTreeBlocks';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';

const p = (id: string, title: string) => ({ id, title, icon: null });

describe('Breadcrumb block', () => {
  it('shows the path, ancestors open their page, the page itself is not a link', () => {
    const el = document.createElement('div');
    const open = vi.fn();
    renderBreadcrumb(el, [p('a', 'Work'), p('b', 'Projects')], p('c', 'Launch'), open);
    const steps = [...el.querySelectorAll<HTMLButtonElement>('.canvas-crumbs-block__step')];
    expect(steps.map((s) => s.textContent)).toEqual(['Work', 'Projects']);
    expect(el.querySelector('[aria-current="page"]')?.textContent).toBe('Launch');
    steps[1]!.click();
    expect(open).toHaveBeenCalledWith('b');
  });
  it('a top-level page shows only itself', () => {
    const el = document.createElement('div');
    renderBreadcrumb(el, [], p('c', ''));
    expect(el.querySelectorAll('.canvas-crumbs-block__step')).toHaveLength(0);
    expect(el.querySelector('[aria-current="page"]')?.textContent).toBe('Untitled');
  });
});

describe('Sub-page List block', () => {
  it('lists sub-pages in order and opens them', () => {
    const el = document.createElement('div');
    const open = vi.fn();
    renderSubpages(el, [p('x', 'Notes'), p('y', 'Plan')], open);
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.canvas-subpages-block__page')];
    expect(rows.map((r) => r.textContent)).toEqual(['Notes', 'Plan']);
    rows[0]!.click();
    expect(open).toHaveBeenCalledWith('x');
  });
  it('says how to add one when there are none', () => {
    const el = document.createElement('div');
    renderSubpages(el, []);
    expect(el.textContent).toContain('No sub-pages yet');
  });
});

describe('both survive Markdown export and import', () => {
  it('round trip keeps the blocks in place', () => {
    const doc = { type: 'doc', content: [
      { type: 'pageBreadcrumb' },
      { type: 'paragraph', content: [{ type: 'text', text: 'between' }] },
      { type: 'subpageList' },
    ] };
    const back = markdownToTiptapJson(tiptapJsonToMarkdown(doc)) as any;
    expect(back.content.map((n: any) => n.type)).toEqual(['pageBreadcrumb', 'paragraph', 'subpageList']);
  });
});
