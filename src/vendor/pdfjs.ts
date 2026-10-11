// vendor/pdfjs.ts — pdf.js as its own bundle, parsed on the first PDF.
//
// esbuild builds this file to dist/renderer/vendor-pdfjs.js, and in the main
// bundle an `import('../vendor/pdfjs.js')` stays a request for that file at
// run time (scripts/vendorBundles.mjs). So pdf.js, 1.4 MB of source, is
// parsed when a PDF opens, not at every boot. Under vitest the same import
// loads the package.
//
// Order matters: pdf_viewer.mjs reads `globalThis.pdfjsLib` as it loads, so
// pdfjsBootstrap.ts sets it, in a module of its own, before the viewer
// layer is imported.

import './pdfjsBootstrap.js';

export * as pdfjsLib from 'pdfjs-dist';
export { AnnotationMode } from 'pdfjs-dist';
export * from 'pdfjs-dist/web/pdf_viewer.mjs';
