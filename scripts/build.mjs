// scripts/build.mjs — Build renderer bundle with esbuild
//
// CSS is bundled automatically: each .ts file imports its co-located .css,
// and esbuild extracts them into dist/renderer/main.css alongside main.js.
// KaTeX fonts are handled via the 'file' loader so @font-face urls resolve.
//
// Usage:
//   node scripts/build.mjs              → development (no minification, inline sourcemaps)
//   node scripts/build.mjs --production → production  (minified, external sourcemaps)
import { build } from 'esbuild';

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
  },
  assetNames: 'fonts/[name]',
});

console.log(`Build complete (${isProduction ? 'production' : 'development'}).`);
