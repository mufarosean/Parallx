// scripts/build.mjs — Build renderer bundle with esbuild
import { build } from 'esbuild';
import { cpSync, readFileSync, writeFileSync, existsSync } from 'fs';

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

// Concatenate CSS: workbench base + ui component styles
const workbenchCss = readFileSync('src/workbench.css', 'utf-8');
const uiCssPath = 'src/ui/ui.css';
const uiCss = existsSync(uiCssPath) ? readFileSync(uiCssPath, 'utf-8') : '';
writeFileSync('dist/renderer/workbench.css', workbenchCss + '\n' + uiCss);

console.log('Build complete.');
