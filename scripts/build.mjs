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
import { addIgnoreList } from './sourceMapIgnoreList.mjs';
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { VENDOR_BUNDLES, lazyVendorPlugin } from './vendorBundles.mjs';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';

// `import text from './guide.md?raw'`: a file's text as a string (vitest reads
// ?raw the same way). The assistant's built-in skills are written as .md files.
const rawTextPlugin = {
  name: 'raw-text',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: nodePath.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw-text' }));
    b.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text', watchFiles: [a.path] }));
  },
};

const isProduction = process.argv.includes('--production');

const assetLoaders = {
  '.woff2': 'file',
  '.woff': 'file',
  '.ttf': 'file',
  '.svg': 'dataurl',
  '.gif': 'dataurl',
  '.cur': 'dataurl',
};

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
  loader: assetLoaders,
  assetNames: 'fonts/[name]',
  plugins: [lazyVendorPlugin(), rawTextPlugin],
});
// DevTools links each console message to the code that logged it, not to the
// recent-error log's console wrapper (scripts/sourceMapIgnoreList.mjs).
addIgnoreList('dist/renderer/main.js');

// ── Vendor bundles ─────────────────────────────────────────────────────────
// pdf.js, highlight.js and JSZip are parsed when something first needs them
// (a PDF, a Markdown preview, an Excel import), not at every boot. Each is
// its own ESM bundle; the main bundle's imports of src/vendor/* became
// requests for these files (lazyVendorPlugin, scripts/vendorBundles.mjs).
for (const { name, entry } of VENDOR_BUNDLES) {
  await build({
    entryPoints: [entry],
    bundle: true,
    outfile: `dist/renderer/vendor-${name}.js`,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: isProduction ? 'external' : true,
    minify: isProduction,
    logLevel: 'info',
    loader: assetLoaders,
    assetNames: 'fonts/[name]',
  });
}

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

// ── Mermaid bundle (canvas Mermaid diagram blocks) ──────────────────────────
// Like the worksheet engine: several MB, loaded by the block on first use
// (extensions/mermaidNode.ts), never inlined into main.js.
//
// Optional for starting the app: a checkout pulled without `npm install`
// lacks the package, and a failed build here stopped `npm start` before the
// window opened. Without it, diagram blocks say they cannot be drawn.
const require = createRequire(import.meta.url);
let hasMermaid = true;
try { require.resolve('mermaid'); } catch { hasMermaid = false; }
if (hasMermaid) {
  await build({
    entryPoints: ['src/built-in/canvas/extensions/mermaidHost.ts'],
    bundle: true,
    outfile: 'dist/renderer/canvas-mermaid.js',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: isProduction ? 'external' : false,
    minify: true,
    logLevel: 'info',
  });
} else {
  console.warn('\n⚠ The "mermaid" package is not installed: Mermaid diagram blocks will not draw.\n  Run `npm install` to add it. The rest of the app is built.\n');
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
