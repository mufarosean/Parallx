// scripts/build.mjs — Build renderer bundle with esbuild
import { build } from 'esbuild';
import { cpSync } from 'fs';

// Bundle the renderer entry point
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
});

// Copy CSS to dist
cpSync('src/workbench.css', 'dist/renderer/workbench.css');

console.log('Build complete.');
