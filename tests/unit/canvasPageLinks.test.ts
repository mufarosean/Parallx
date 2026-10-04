// @vitest-environment jsdom
// canvasPageLinks.test.ts — in-app links to a page or a block.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
import { pageLinkHref, parsePageLink } from '../../src/built-in/canvas/pageLinks';

describe('page links', () => {
  it('round-trip a page and a block id', () => {
    expect(parsePageLink(pageLinkHref('p-1', 'b_2'))).toEqual({ pageId: 'p-1', blockId: 'b_2' });
    expect(parsePageLink(pageLinkHref('p-1'))).toEqual({ pageId: 'p-1' });
    expect(parsePageLink('https://example.com')).toBeNull();
    expect(parsePageLink('parallx-page:bad id')).toBeNull();
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
