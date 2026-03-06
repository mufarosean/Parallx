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
import { copyFile, mkdir } from 'node:fs/promises';
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

// ── Copy PDF.js web-worker to dist ────────────────────────────────────────
const workerSrc = 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
const workerDst = 'dist/renderer/pdf.worker.min.mjs';

if (existsSync(workerSrc)) {
  await mkdir('dist/renderer', { recursive: true });
  await copyFile(workerSrc, workerDst);
  console.log('Copied pdf.worker.min.mjs → dist/renderer/');
} else {
  console.warn('⚠ pdf.worker.min.mjs not found — PDF viewer may not work.');
}

console.log(`Build complete (${isProduction ? 'production' : 'development'}).`);
