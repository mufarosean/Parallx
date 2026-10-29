// @vitest-environment jsdom
// canvasPageLinks.test.ts — in-app links to a page or a block.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
import { pageLinkForms, pageLinkHref, parsePageLink } from '../../src/built-in/canvas/pageLinks';

describe('page links', () => {
  it('round-trip a page and a block id', () => {
    expect(parsePageLink(pageLinkHref('p-1', 'b_2'))).toEqual({ pageId: 'p-1', blockId: 'b_2' });
    expect(parsePageLink(pageLinkHref('p-1'))).toEqual({ pageId: 'p-1' });
    expect(parsePageLink('https://example.com')).toBeNull();
    expect(parsePageLink('parallx-page:bad id')).toBeNull();
  });

  it('the app-wide form the chat and citations write opens the page too, and both count as backlinks', () => {
    expect(parsePageLink('parallx://canvas/page/p-9')).toEqual({ pageId: 'p-9' });
    expect(parsePageLink('parallx://canvas/page/p-9#b1')).toEqual({ pageId: 'p-9', blockId: 'b1' });
    expect(parsePageLink('parallx://explorer/file?path=a.pdf')).toBeNull();
    expect(pageLinkForms('p-9')).toEqual(['parallx-page:p-9', 'parallx://canvas/page/p-9']);
  });

  it('a parallx:// link keeps its href in the editor', () => {
    const ed = new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions(createLowlight(common), {}),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'cited', marks: [{ type: 'link', attrs: { href: 'parallx://canvas/page/p3' } }] },
      ] }] },
    });
    try {
      expect(ed.view.dom.querySelector('a')?.getAttribute('href')).toBe('parallx://canvas/page/p3');
    } finally { ed.destroy(); }
  });

  it('keep their href in the editor (the link extension allows the scheme)', () => {
    const ed = new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions(createLowlight(common), {}),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'target', marks: [{ type: 'link', attrs: { href: 'parallx-page:p2#t1' } }] },
      ] }] },
    });
    try {
      const a = ed.view.dom.querySelector('a');
      expect(a?.getAttribute('href')).toBe('parallx-page:p2#t1');
      // And survive a paste of the editor's own HTML.
      ed.commands.setContent(ed.getHTML());
      expect(JSON.stringify(ed.getJSON())).toContain('parallx-page:p2#t1');
    } finally { ed.destroy(); }
  });
});
