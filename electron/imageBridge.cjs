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

function setupImageBridge(ipcMain) {
  ipcMain.handle('image:rasterizeMetafile', async (_event, bytes, ext) => rasterizeMetafile(bytes, ext));
}

module.exports = { setupImageBridge, rasterizeMetafile };
