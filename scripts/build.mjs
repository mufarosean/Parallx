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

// Concatenate CSS: workbench base + ui component styles + built-in tool styles
const workbenchCss = readFileSync('src/workbench.css', 'utf-8');
const uiCssPath = 'src/ui/ui.css';
const uiCss = existsSync(uiCssPath) ? readFileSync(uiCssPath, 'utf-8') : '';
const explorerCssPath = 'src/built-in/explorer/explorer.css';
const explorerCss = existsSync(explorerCssPath) ? readFileSync(explorerCssPath, 'utf-8') : '';
const editorCssPath = 'src/built-in/editor/textEditorPane.css';
const editorCss = existsSync(editorCssPath) ? readFileSync(editorCssPath, 'utf-8') : '';
const markdownCssPath = 'src/built-in/editor/markdownEditorPane.css';
const markdownCss = existsSync(markdownCssPath) ? readFileSync(markdownCssPath, 'utf-8') : '';
const imageCssPath = 'src/built-in/editor/imageEditorPane.css';
const imageCss = existsSync(imageCssPath) ? readFileSync(imageCssPath, 'utf-8') : '';
const pdfCssPath = 'src/built-in/editor/pdfEditorPane.css';
const pdfCss = existsSync(pdfCssPath) ? readFileSync(pdfCssPath, 'utf-8') : '';
writeFileSync('dist/renderer/workbench.css', workbenchCss + '\n' + uiCss + '\n' + explorerCss + '\n' + editorCss + '\n' + markdownCss + '\n' + imageCss + '\n' + pdfCss);

console.log('Build complete.');
