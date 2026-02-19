// scripts/build.mjs — Build renderer bundle with esbuild
//
// CSS is bundled automatically: each .ts file imports its co-located .css,
// and esbuild extracts them into dist/renderer/main.css alongside main.js.
// KaTeX fonts are handled via the 'file' loader so @font-face urls resolve.
import { build } from 'esbuild';

// Bundle the renderer entry point (JS + CSS)
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/renderer/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  loader: {
    '.woff2': 'file',
    '.woff': 'file',
    '.ttf': 'file',
  },
  assetNames: 'fonts/[name]',
});

console.log('Build complete.');
