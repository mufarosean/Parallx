// scripts/build.mjs — Build renderer bundle with esbuild
//
// CSS is bundled automatically: each .ts file imports its co-located .css,
// and esbuild extracts them into dist/renderer/main.css alongside main.js.
// KaTeX fonts are handled via the 'file' loader so @font-face urls resolve.
//
// After bundling, the PDF.js web-worker is copied to dist/renderer/ so
// the PdfEditorPane can load it at runtime via GlobalWorkerOptions.workerSrc.
//
// Usage:
//   node scripts/build.mjs              → development (no minification, inline sourcemaps)
//   node scripts/build.mjs --production → production  (minified, external sourcemaps)
import { build } from 'esbuild';
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const isProduction = process.argv.includes('--production');

// Bundle the renderer entry point (JS + CSS)
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/renderer/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: isProduction ? 'external' : true,
  minify: isProduction,
  logLevel: 'info',
  loader: {
    '.woff2': 'file',
    '.woff': 'file',
    '.ttf': 'file',
    '.svg': 'dataurl',
    '.gif': 'dataurl',
    '.cur': 'dataurl',
  },
  assetNames: 'fonts/[name]',
});

// ── Worksheet engine bundle (M99) ──────────────────────────────────────────
// The Univer spreadsheet engine is several MB and used only by the Worksheets
// surface, so it builds as its OWN esm bundle that the pane dynamic-imports on
// first open. Statically importing src/built-in/worksheet/univerHost.ts from
// the main tree would inline all of it into main.js — never do that.
await build({
  entryPoints: ['src/built-in/worksheet/univerHost.ts'],
  bundle: true,
  outfile: 'dist/renderer/worksheet-univer.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: isProduction ? 'external' : true,
  minify: isProduction,
  logLevel: 'info',
  loader: {
    '.woff2': 'file',
    '.woff': 'file',
    '.ttf': 'file',
    '.svg': 'dataurl',
    '.gif': 'dataurl',
    '.cur': 'dataurl',
    '.png': 'dataurl',
  },
  assetNames: 'fonts/[name]',
});

// ── Mindmap board engine bundle ────────────────────────────────────────────
// Excalidraw + React serve only the board surface, so they build as their
// OWN esm bundle the pane dynamic-imports on first open — the exact Univer
// discipline above. Statically importing boardHost.ts from the main tree
// would inline React and the whole engine into main.js — never do that.
await build({
  entryPoints: ['src/built-in/canvas/mindmap/boardHost.ts'],
  bundle: true,
  outfile: 'dist/renderer/mindmap-board.js',
  format: 'esm',
  // Excalidraw's package exports gate `.` and `./index.css` behind
  // development/production conditions with no default — without the extra
  // condition esbuild cannot resolve the stylesheet at all.
  conditions: [isProduction ? 'production' : 'development'],
  platform: 'browser',
  target: 'es2022',
  sourcemap: isProduction ? 'external' : true,
  minify: isProduction,
  logLevel: 'info',
  // The engine registers its font faces during (hoisted) module evaluation,
  // so the local asset path must exist BEFORE any module code — a banner is
  // the only spot early enough. Without it fonts fall back to the esm.sh
  // CDN, which the app CSP blocks.
  banner: {
    js: "window.EXCALIDRAW_ASSET_PATH = new URL('dist/renderer/excalidraw-assets/', document.baseURI).href;",
  },
  define: {
    'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
    // MathJax's version.js falls back to eval('require') when this build-time
    // global is missing — and the app CSP has no unsafe-eval, so that eval
    // THROWS AT MODULE SCOPE and kills the whole bundle import (found
    // 2026-08-31: every board failed to load). Defining it makes the eval
    // branch dead code. Keep in sync with the installed mathjax-full version.
    PACKAGE_VERSION: '"3.2.1"',
  },
  loader: {
    '.woff2': 'file',
    '.woff': 'file',
    '.ttf': 'file',
    '.svg': 'dataurl',
    '.gif': 'dataurl',
    '.cur': 'dataurl',
    '.png': 'dataurl',
  },
  assetNames: 'fonts/[name]',
});

// ── Copy Excalidraw font assets to dist ────────────────────────────────────
// The engine registers its fonts AT RUNTIME via window.EXCALIDRAW_ASSET_PATH
// (set in boardHost.ts before mount); without a local copy it falls back to
// the esm.sh CDN, which the app CSP blocks (font-src 'self' data: blob:).
{
  const src = 'node_modules/@excalidraw/excalidraw/dist/prod/fonts';
  const dst = 'dist/renderer/excalidraw-assets/fonts';
  if (existsSync(src)) {
    await cp(src, dst, { recursive: true });
    console.log('Copied Excalidraw fonts → dist/renderer/excalidraw-assets/fonts');
  } else {
    console.warn('⚠ Excalidraw fonts not found — board text will use fallback fonts.');
  }
}

// ── Copy PDF.js runtime assets to dist ─────────────────────────────────────
const workerSrc = 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
const workerDst = 'dist/renderer/pdf.worker.min.mjs';
const pdfAssetDirs = [
  ['node_modules/pdfjs-dist/cmaps', 'dist/renderer/pdfjs/cmaps'],
  ['node_modules/pdfjs-dist/standard_fonts', 'dist/renderer/pdfjs/standard_fonts'],
  ['node_modules/pdfjs-dist/wasm', 'dist/renderer/pdfjs/wasm'],
];

if (existsSync(workerSrc)) {
  await mkdir('dist/renderer', { recursive: true });
  await copyFile(workerSrc, workerDst);
  console.log('Copied pdf.worker.min.mjs → dist/renderer/');
} else {
  console.warn('⚠ pdf.worker.min.mjs not found — PDF viewer may not work.');
}

for (const [srcDir, dstDir] of pdfAssetDirs) {
  if (!existsSync(srcDir)) {
    console.warn(`⚠ ${srcDir} not found — PDF rendering fidelity may degrade.`);
    continue;
  }

  await cp(srcDir, dstDir, { recursive: true, force: true });
  console.log(`Copied ${srcDir} → ${dstDir}`);
}

console.log(`Build complete (${isProduction ? 'production' : 'development'}).`);
