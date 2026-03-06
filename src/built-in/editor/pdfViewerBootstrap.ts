// pdfViewerBootstrap.ts — PDF.js Viewer layer bootstrap
//
// The PDF.js Viewer layer (pdf_viewer.mjs) destructures from
// `globalThis.pdfjsLib` at the top scope.  This module MUST be
// imported before any `pdfjs-dist/web/pdf_viewer.mjs` import so
// that globalThis.pdfjsLib is set when the viewer module initializes.
//
// esbuild preserves import order within a file, so importing this
// module first in pdfEditorPane.ts guarantees correct initialization.

import * as pdfjsLib from 'pdfjs-dist';

// The viewer layer reads these at module init time.
(globalThis as any).pdfjsLib = pdfjsLib;

// Configure the web-worker path (copied to dist/renderer/ by build.mjs).
pdfjsLib.GlobalWorkerOptions.workerSrc = './dist/renderer/pdf.worker.min.mjs';
