// browser-scrollbar-probe.mjs — what a web page's scrollbar looks like in a
// page view under each of Chromium's scrollbar modes, captured in a HIDDEN
// window. The page is unstyled on purpose: this is the scrollbar every site
// gets unless it draws its own.
//
// Run (Electron, not Node):
//   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/probes/browser-scrollbar-probe.mjs <out.png> [--overlay | --fluent] [--no-hover]
//   --overlay  OverlayScrollbar + FluentOverlayScrollbar (no layout gutter, thin, fades)
//   --fluent   FluentScrollbar (the Windows 11 look, keeps its gutter)
//   --no-hover scroll a little instead of hovering the bar, to see it at rest
import { app, BrowserWindow, nativeTheme } from 'electron';
import fs from 'node:fs';

const [outPng] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const overlay = process.argv.includes('--overlay');
const fluent = process.argv.includes('--fluent');
const hover = !process.argv.includes('--no-hover');
if (!outPng) { console.error('usage: electron browser-scrollbar-probe.mjs <out.png> [--overlay | --fluent] [--no-hover]'); app.exit(2); }
// Must be set before the app is ready: the same switch main.cjs applies.
if (overlay) app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,FluentOverlayScrollbar');
else if (fluent) app.commandLine.appendSwitch('enable-features', 'FluentScrollbar');

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><style>body{margin:0;background:#1b1c1f;color:#ddd;font:14px system-ui}p{margin:16px}</style></head><body>${'<p>Result row. The scrollbar on the right is the one to look at.</p>'.repeat(80)}</body></html>`;
  const win = new BrowserWindow({ show: false, width: 520, height: 400, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
  win.webContents.setFrameRate(30);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 900));
  if (hover) win.webContents.sendInputEvent({ type: 'mouseMove', x: 512, y: 120 });
  else win.webContents.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: -240 });
  await new Promise((r) => setTimeout(r, 350));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(outPng, image.toPNG());
  const width = await win.webContents.executeJavaScript('window.innerWidth - document.documentElement.clientWidth');
  const mode = overlay ? 'overlay' : fluent ? 'fluent' : 'classic';
  console.log(`${mode} ${hover ? 'hovered' : 'at rest'}: scrollbar takes ${width}px of layout width -> ${outPng}`);
  app.exit(0);
}).catch((err) => { console.error('probe error:', err && err.stack || err); app.exit(2); });
