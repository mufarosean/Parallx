// vendor/lazy.ts — one loader per vendor bundle, each fetched once a session.
//
// The main bundle's `import()` of a file in this folder stays a run-time
// request for dist/renderer/vendor-<name>.js (scripts/vendorBundles.mjs);
// the promise is kept, so a bundle is fetched and parsed once.

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load());
}

/** pdf.js: the display layer as `pdfjsLib`, the viewer classes and enums. */
export const loadPdfjs = once(() => import('./pdfjs.js'));
/** highlight.js with the common languages, as `default`. */
export const loadHljs = once(() => import('./hljs.js'));
/** JSZip, as `default`. */
export const loadJsZip = once(() => import('./jszip.js'));
