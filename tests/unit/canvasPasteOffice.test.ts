// @vitest-environment jsdom
// canvasPasteOffice.test.ts — a paste from Excel or Word (text and HTML plus a
// rendered picture) pastes the text, not the picture; a copied image still
// pastes as an image.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';

function paste(ed: Editor, data: Record<string, string>, withImage: boolean): boolean {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'clip.png', { type: 'image/png' });
  const event = {
    clipboardData: {
      getData: (type: string) => data[type] ?? '',
      items: withImage ? [{ type: 'image/png', getAsFile: () => file }] : [],
    },
    preventDefault() { /* */ },
  } as unknown as ClipboardEvent;
  let handled = false;
  ed.view.someProp('handlePaste', (f) => { if (f(ed.view, event, null as never)) { handled = true; return true; } return false; });
  return handled;
}

describe('paste from Office', () => {
  const make = () => new Editor({ element: document.createElement('div'), extensions: createEditorExtensions(createLowlight(common), {}), content: '<p>x</p>' });

  it('a picture next to text is left to the normal paste (the table/text)', () => {
    const ed = make();
    try {
      expect(paste(ed, { 'text/plain': 'A\tB\n1\t2', 'text/html': '<table><tr><td>A</td><td>B</td></tr></table>' }, true)).toBe(false);
    } finally { ed.destroy(); }
  });

  it('an image with no text is still an image paste', () => {
    const ed = make();
    try {
      expect(paste(ed, {}, true)).toBe(true);
    } finally { ed.destroy(); }
  });
});
