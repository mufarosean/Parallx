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
const settingsCssPath = 'src/built-in/editor/settingsEditorPane.css';
const settingsCss = existsSync(settingsCssPath) ? readFileSync(settingsCssPath, 'utf-8') : '';
const keybindingsCssPath = 'src/built-in/editor/keybindingsEditorPane.css';
const keybindingsCss = existsSync(keybindingsCssPath) ? readFileSync(keybindingsCssPath, 'utf-8') : '';
const welcomeCssPath = 'src/built-in/welcome/welcome.css';
const welcomeCss = existsSync(welcomeCssPath) ? readFileSync(welcomeCssPath, 'utf-8') : '';
const outputCssPath = 'src/built-in/output/output.css';
const outputCss = existsSync(outputCssPath) ? readFileSync(outputCssPath, 'utf-8') : '';
const toolGalleryCssPath = 'src/built-in/tool-gallery/toolGallery.css';
const toolGalleryCss = existsSync(toolGalleryCssPath) ? readFileSync(toolGalleryCssPath, 'utf-8') : '';
const notificationCssPath = 'src/api/notificationService.css';
const notificationCss = existsSync(notificationCssPath) ? readFileSync(notificationCssPath, 'utf-8') : '';
const menuCssPath = 'src/contributions/menuContribution.css';
const menuCss = existsSync(menuCssPath) ? readFileSync(menuCssPath, 'utf-8') : '';
writeFileSync('dist/renderer/workbench.css', workbenchCss + '\n' + uiCss + '\n' + explorerCss + '\n' + editorCss + '\n' + markdownCss + '\n' + imageCss + '\n' + pdfCss + '\n' + settingsCss + '\n' + keybindingsCss + '\n' + welcomeCss + '\n' + outputCss + '\n' + toolGalleryCss + '\n' + notificationCss + '\n' + menuCss);

console.log('Build complete.');
