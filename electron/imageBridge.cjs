// Windows metafiles (EMF/WMF) to PNG for the worksheet importer.
//
// Excel stores pasted equations and figures as metafiles, which Chromium
// cannot draw, so every Rising Fellow workbook lost them on import. GDI+ can
// draw them: on Windows the bytes go through a PowerShell script using
// System.Drawing at 2x and come back as PNG. Elsewhere, or on any failure,
// the handler returns null and the importer keeps counting the picture as
// skipped, which is what it did before.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// No `${` below: this is a JS template literal holding PowerShell.
const SCRIPT = `
param([string]$In, [string]$Out, [int]$Scale)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($In)
try {
  $w = [Math]::Max(1, [int]($img.Width * $Scale))
  $h = [Math]::Max(1, [int]($img.Height * $Scale))
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.DrawImage($img, 0, 0, $w, $h)
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ("" + $img.Width + "x" + $img.Height)
} finally { $img.Dispose() }
`;

/**
 * @param {Uint8Array|Buffer} bytes the metafile
 * @param {'emf'|'wmf'} ext
 * @param {number} scale device pixels per metafile pixel
 * @returns {Promise<{ png: Uint8Array, width: number, height: number, scale: number } | null>}
 */
async function rasterizeMetafile(bytes, ext, scale = 2) {
  if (process.platform !== 'win32' || !bytes || !bytes.length) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'parallx-metafile-'));
  const inFile = path.join(dir, `in.${ext === 'wmf' ? 'wmf' : 'emf'}`);
  const outFile = path.join(dir, 'out.png');
  const ps1 = path.join(dir, 'convert.ps1');
  try {
    await fs.writeFile(inFile, Buffer.from(bytes));
    await fs.writeFile(ps1, SCRIPT, 'utf8');
    const result = await new Promise((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-In', inFile, '-Out', outFile, '-Scale', String(scale)], { windowsHide: true });
      let out = '';
      p.stdout.on('data', (d) => { out += String(d); });
      p.stderr.on('data', () => {});
      const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } resolve({ ok: false, out }); }, 30_000);
      p.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out }); });
      p.on('error', () => { clearTimeout(timer); resolve({ ok: false, out }); });
    });
    if (!result.ok) return null;
    const png = await fs.readFile(outFile);
    const m = /(\d+)x(\d+)/.exec(result.out || '');
    return { png: new Uint8Array(png), width: m ? Number(m[1]) : 0, height: m ? Number(m[2]) : 0, scale };
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Equations (LaTeX) to PNG, in an offscreen window that loads KaTeX from
// node_modules over file://. The renderer cannot do this itself: an SVG with
// HTML inside taints any canvas it is drawn on, so its PNG export throws.
// One hidden window renders the whole batch at 2x and captures each equation
// at its own size. Anything that fails returns null for that item.
const EQ_HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="KATEX_CSS"><script src="KATEX_JS"></script>
<style>html,body{margin:0;background:transparent}#eq{position:absolute;left:0;top:0;display:inline-block;padding:2px 4px;color:#000;white-space:nowrap;line-height:1.2}</style>
</head><body><div id="eq"></div></body></html>`;

async function renderEquations(app, items, scale = 2) {
  if (!Array.isArray(items) || !items.length) return [];
  const { BrowserWindow } = require('electron');
  const base = app.getAppPath();
  const css = pathToFileURL(path.join(base, 'node_modules', 'katex', 'dist', 'katex.min.css')).href;
  const js = pathToFileURL(path.join(base, 'node_modules', 'katex', 'dist', 'katex.min.js')).href;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'parallx-equation-'));
  const page = path.join(dir, 'equation.html');
  const out = items.map(() => null);
  let win = null;
  try {
    await fs.writeFile(page, EQ_HTML.replace('KATEX_CSS', css).replace('KATEX_JS', js), 'utf8');
    win = new BrowserWindow({
      show: false, width: 1600, height: 400, transparent: true, frame: false,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win.webContents.setZoomFactor(scale);
    await win.loadFile(page);
    for (let i = 0; i < items.length; i++) {
      const { latex, fontPx } = items[i] || {};
      if (typeof latex !== 'string' || !latex.trim()) continue;
      try {
        const size = await win.webContents.executeJavaScript(`(async () => {
          const el = document.getElementById('eq');
          el.style.fontSize = ${Number(fontPx) > 0 ? Number(fontPx) : 15} + 'px';
          katex.render(${JSON.stringify(latex)}, el, { throwOnError: false, output: 'html', strict: 'ignore' });
          await document.fonts.ready;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const b = el.getBoundingClientRect();
          return { w: Math.ceil(b.width), h: Math.ceil(b.height) };
        })()`, true);
        if (!size || !size.w || !size.h) continue;
        const image = await win.webContents.capturePage({ x: 0, y: 0, width: Math.ceil(size.w * scale), height: Math.ceil(size.h * scale) });
        if (image.isEmpty()) continue;
        out[i] = { png: new Uint8Array(image.toPNG()), width: size.w, height: size.h };
      } catch { /* this equation stays a text box */ }
    }
  } catch {
    /* no window, no equations */
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return out;
}

function setupImageBridge(ipcMain, app) {
  ipcMain.handle('image:rasterizeMetafile', async (_event, bytes, ext) => rasterizeMetafile(bytes, ext));
  ipcMain.handle('image:renderEquations', async (_event, items) => renderEquations(app, items));
}

module.exports = { setupImageBridge, rasterizeMetafile, renderEquations };
