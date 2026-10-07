// pdfFindReveal.test.ts — a citation's quote survives the PDF's first render.
//
// A link that opens a PDF at a quote dispatches a 'find' as soon as the pages
// are laid out. pdf.js's viewer gives the find controller its document only
// after the first page has rendered, and that setDocument() resets the
// controller when it already has one. The pane used to give it the document
// early as well, so the second call wiped the quote's find: the page turned,
// nothing was highlighted. The pane must leave that call to the viewer.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

describe('PDF find controller document', () => {
  it('the pane never gives the find controller its document', () => {
    const pane = readFileSync(resolve(root, 'src/editor/panes/pdfEditorPane.ts'), 'utf8');
    expect(pane).toMatch(/findController:\s*this\._findController/);
    expect(pane).not.toMatch(/_findController\??\.setDocument\(/);
  });

  it('pdf.js still gives it the document after the first render, resetting a controller that has one', () => {
    const viewer = readFileSync(resolve(root, 'node_modules/pdfjs-dist/web/pdf_viewer.mjs'), 'utf8');
    expect(viewer).toMatch(/#onePageRenderedOrForceFetch\(signal\)\.then\(async \(\) => \{[\s\S]{0,200}this\.findController\?\.setDocument\(pdfDocument\)/);
    expect(viewer).toMatch(/setDocument\(pdfDocument\) \{\s*if \(this\._pdfDocument\) \{\s*this\.#reset\(\);/);
  });
});
