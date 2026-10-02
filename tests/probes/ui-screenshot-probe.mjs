// ui-screenshot-probe.mjs — look at the app without showing it.
//
// Launches the real Electron app HIDDEN (PARALLX_HIDDEN_PROBE) against a
// throwaway data root and workspace (PARALLX_APP_ROOT), drives it through a
// few scenes, and writes PNGs. No window ever appears, and the developer's
// real workspace is never opened: the probe's last-workspace.json points at a
// temp folder it creates itself.
//
// Usage:
//   node tests/probes/ui-screenshot-probe.mjs <outDir> [scene ...]
// Scenes: boot welcome watermark chat autonomy dashboard planner settings
// (default: all). Requires `npm run build` first — the app loads dist/.
//
// Why this exists: static analysis and vitest both passed while the mindmap
// board was dead on screen (2026-08-31). UI ships after a capture, not before.

import { _electron as electron, chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-probe-shots'));
const requested = process.argv.slice(3);
const ALL_SCENES = ['boot', 'welcome', 'watermark', 'chrome', 'chat', 'autonomy', 'dashboard', 'planner', 'canvas', 'clip', 'project', 'timelapse', 'image', 'sidebar', 'moaudit', 'motrash', 'mofav', 'mofilters', 'moart', 'pdf', 'settings', 'appearance'];
const scenes = requested.length ? requested : ALL_SCENES;

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  }
  env.PARALLX_TEST_MODE = '1';
  env.PARALLX_RENDERER_PORT = '0';
  env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot;
  env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}

async function makeTempRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-probe-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-probe-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'notes'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Probe workspace\n\nA throwaway folder the screenshot probe made.\n');
  await fs.writeFile(path.join(workspace, 'notes', 'siewert.md'), '# Siewert\n\nExcess loss development notes.\n');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  // Development extensions load from <app root>/ext, so the throwaway root
  // gets a junction to the repo's ext/ (a junction needs no privilege).
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); }
  catch (err) { console.log(`[probe] ext junction failed: ${String(err).split('\n')[0]}`); }
  // A six-second synthetic video with a tone, for the clip editor scene.
  const clip = path.join(workspace, 'probe-clip.mp4');
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip], { windowsHide: true });
  if (ff.status !== 0) console.log(`[probe] synthetic clip failed: ${String(ff.stderr || '').slice(0, 200)}`);
  // A second one for the clip project scene (a different picture and length).
  const clip2 = path.join(workspace, 'probe-session-2.mp4');
  const ff2 = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
    '-t', '9', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip2], { windowsHide: true });
  if (ff2.status !== 0) console.log(`[probe] second clip failed: ${String(ff2.stderr || '').slice(0, 200)}`);
  return { appRoot, workspace, clip, clip2 };
}

// Commands run through the workbench's own command service (main.ts exposes
// the workbench as window.__parallx_workbench__; services are keyed by the
// identifier's id string). Each entry is [commandId, ...args].
async function runCommand(page, entries) {
  for (const entry of entries) {
    const [id, ...args] = Array.isArray(entry) ? entry : [entry];
    const ok = await page.evaluate(async ({ commandId, args }) => {
      const wb = window.__parallx_workbench__;
      const svc = wb?._services?.get?.({ id: 'ICommandService' });
      if (!svc?.executeCommand) return 'no command service';
      try { await svc.executeCommand(commandId, ...args); return true; } catch (err) { return String(err && err.message || err); }
    }, { commandId: id, args });
    if (ok === true) return id;
    console.log(`[probe] ${id}: ${ok}`);
  }
  return null;
}

async function scene(name, fn) {
  try { await fn(); } catch (err) { console.log(`[probe] ${name}: failed (${String(err).split('\n')[0]})`); }
}

async function closeSettings(page) {
  const close = page.locator('.settings-editor__close').first();
  if (await close.count()) await close.click({ timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  // The hidden window makes no new frame while a <video> sits paused, and a
  // screenshot waits for one: paused videos play (muted) for the shot, then
  // pause again at the time they held.
  const held = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map((v, i) => {
    if (!v.paused || v.readyState < 2) return null;
    const st = { i, t: v.currentTime, muted: v.muted };
    v.muted = true; v.play().catch(() => {});
    return st;
  }).filter(Boolean)).catch(() => []);
  // A still page in the hidden window makes no new frame until something
  // changes: nudge a 1 px dot so the screenshot has a frame to take.
  await page.evaluate(() => {
    let d = document.getElementById('__probe_repaint');
    if (!d) { d = document.createElement('div'); d.id = '__probe_repaint'; d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647'; document.body.appendChild(d); }
    d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01';
  }).catch(() => {});
  const file = path.join(outDir, `${name}.png`);
  // A still page in the hidden window sometimes makes no new frame; a missed
  // shot is reported, not a reason to stop the scene.
  let took = await page.screenshot({ path: file, timeout: 8_000 }).then(() => true, () => false);
  // Fallback: the main process captures what the window last drew.
  if (!took && _currentApp) {
    const b64 = await _currentApp.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return null;
      const img = await w.webContents.capturePage();
      return img.toPNG().toString('base64');
    }).catch((e) => { console.log(`[probe] ${name}: capturePage failed (${String(e).split('\n')[0]})`); return null; });
    if (b64) { await fs.writeFile(file, Buffer.from(b64, 'base64')); took = true; }
  }
  if (!took) console.log(`[probe] ${name}: no shot`);
  if (held.length) {
    await page.evaluate((list) => {
      const vids = document.querySelectorAll('video');
      for (const st of list) { const v = vids[st.i]; if (!v) continue; v.pause(); v.muted = st.muted; try { v.currentTime = st.t; } catch { /* ignore */ } }
    }, held).catch(() => {});
    await page.waitForTimeout(150);
  }
  if (took) console.log(`[probe] ${name} -> ${file}`);
}

async function enableMediaOrganizer(page) {
  // External tools start disabled in a fresh data root; enabling one
  // activates it directly.
  const enabled = await page.evaluate(async () => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
    if (!svc) return 'no enablement service';
    try { await svc.setEnablement('parallx-community.media-organizer', true); return true; } catch (err) { return String(err && err.message || err); }
  });
  if (enabled !== true) console.log(`[probe] enable media-organizer: ${enabled}`);
  await page.waitForTimeout(3_000);
}

let _currentApp = null;
// Resize the real window too: the viewport alone does not always follow a second change.
async function resizeWindow(page, width, height) {
  if (_currentApp) await _currentApp.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; if (win) { win.unmaximize(); win.setContentSize(w, h); } }, [width, height]).catch(() => {});
  await page.setViewportSize({ width, height }).catch(() => {});
}
async function launchApp(appRoot, errors) {
  // Software WebGL (SwiftShader): the container has no GPU, and the image
  // editor draws with WebGL.
  const app = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  _currentApp = app;
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(2_500);
  return { app, page };
}

// A clip project keeps its edits until it is deleted: make one from two
// videos, edit the first, switch videos, quit the app, start it again, and
// read the edits back. Then delete the project.
async function projectScene(appRoot, clip, clip2, errors) {
  const trimState = (page) => page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll('.mo-ce-panel')).find((x) => (x.querySelector('.mo-ce-panel-title')?.textContent || '') === 'Trim');
    const tcs = Array.from(panel ? panel.querySelectorAll('.mo-ce-tcfield') : []).map((i) => i.value);
    const name = document.querySelector('.mo-ce-name')?.textContent || '';
    const badge = document.querySelector('.mo-ce-toolbar .mo-ce-badge')?.textContent || '';
    const rows = Array.from(document.querySelectorAll('.mo-cp-bin .mo-cp-row')).map((r) => `${r.querySelector('.mo-cp-row-name')?.textContent}[${r.querySelector('.mo-cp-row-meta')?.textContent}]${r.classList.contains('mo-cp-row--active') ? '*' : ''}`);
    const sub = document.querySelector('.mo-cp-sub')?.textContent || '';
    const side = Array.from(document.querySelectorAll('.mo-cp-sidebar .mo-sidebar-item-label')).map((x) => x.textContent);
    return `editor=${name} trim=${tcs.join('..')} queue=${badge} bin=${rows.join(' | ')} sub="${sub}" sidebar=${side.join(',')}`;
  });
  const seqState = (page) => page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.mo-cs-row')).map((r) => `${r.querySelector('.mo-cs-num')?.textContent}. ${r.querySelector('.mo-cp-row-name')?.textContent} [${r.querySelector('.mo-cp-row-meta')?.textContent}] ${r.querySelector('.mo-cs-len')?.textContent}`);
    const meta = document.querySelector('.mo-cs .mo-ce-meta')?.textContent || '';
    const btn = document.querySelector('.mo-cs-export')?.textContent || '';
    const st = document.querySelector('.mo-cs-status')?.textContent || '';
    const seqMeta = document.querySelector('.mo-cp-seqrow .mo-cp-row-meta')?.textContent || '';
    return `meta="${meta}" bin="${seqMeta}" button="${btn}" status="${st}" rows=${rows.join(' | ')}`;
  });
  let { app, page } = await launchApp(appRoot, errors);
  try {
    await enableMediaOrganizer(page);
    // New Clip Project… asks for a name first.
    await page.evaluate(({ a, b }) => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
      void svc.executeCommand('media-organizer.newClipProject', [a, b]);
    }, { a: clip, b: clip2 });
    await page.waitForSelector('.parallx-modal-input', { timeout: 10_000 });
    await page.fill('.parallx-modal-input', 'Oil study, October');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.mo-cp .mo-clip-page', { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @open: ${await trimState(page)}`);
    // Edit the first video: In at 2 s, and queue a clip.
    await page.evaluate(() => { const v = document.querySelector('.mo-clip-page video'); v.currentTime = 2; });
    await page.waitForTimeout(400);
    await page.locator('.mo-clip-page').first().focus();
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    await page.keyboard.press('q');
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @edited: ${await trimState(page)}`);
    await shot(page, 'project');
    // The second video opens untouched; the first comes back as it was left.
    await page.locator('.mo-cp-list .mo-cp-row').nth(1).click();
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @second: ${await trimState(page)}`);
    await page.locator('.mo-cp-list .mo-cp-row').nth(0).click();
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @back: ${await trimState(page)}`);
    // A clip from the second video too; both line up in the Sequence.
    await page.locator('.mo-cp-list .mo-cp-row').nth(1).click();
    await page.waitForTimeout(1_500);
    await page.evaluate(() => { const v = document.querySelector('.mo-clip-page video'); v.currentTime = 3; });
    await page.waitForTimeout(400);
    await page.locator('.mo-clip-page').first().focus();
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    await page.keyboard.press('q');
    await page.waitForTimeout(1_500);
    await page.locator('.mo-cp-seqrow').click();
    await page.waitForSelector('.mo-cs', { timeout: 10_000 });
    await page.waitForTimeout(800);
    console.log(`[probe] project @sequence: ${await seqState(page)}`);
    await shot(page, 'project-sequence');
    // Export it for real (the save dialog answers with a path in the workspace).
    const seqOut = path.join(path.dirname(clip), 'probe-sequence.mp4');
    await app.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, seqOut);
    const t0 = Date.now();
    await page.locator('.mo-cs-export').click();
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @exporting: ${await seqState(page)}`);
    await page.waitForFunction(() => /^Exported|failed|cancelled/i.test(document.querySelector('.mo-cs-status')?.textContent || '') && !document.querySelector('.mo-cs-export.mo-ce-busy'), null, { timeout: 180_000 }).catch(() => {});
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', seqOut]);
    let probeText = 'no file';
    try { const j = JSON.parse(String(pr.stdout)); probeText = `duration=${Number(j.format.duration).toFixed(2)} streams=${j.streams.map((x) => x.codec_type + (x.width ? `:${x.width}x${x.height}` : '')).join(',')}`; } catch { /* no file */ }
    console.log(`[probe] project @exported (${((Date.now() - t0) / 1000).toFixed(1)} s): ${await seqState(page)} file: ${probeText}`);
    await shot(page, 'project-sequence-done');
    // Cancel: a heavier second export (1920 × 1080 at 60 fps) is stopped
    // mid-render; ffmpeg must die at once and the partial file go.
    await page.evaluate(async () => {
      const pick = async (aria, value) => {
        const host = Array.from(document.querySelectorAll('.mo-cs-opts .mo-select')).find((h) => h.querySelector(`[aria-label="${aria}"]`));
        if (host) { host.value = value; host.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      await pick('Size', '1920x1080');
      await pick('Frame rate', '60');
    });
    await page.evaluate(() => document.querySelector('.mo-cs-export').click());
    await page.waitForFunction(() => /Rendering clip 2/.test(document.querySelector('.mo-cs-status')?.textContent || ''), null, { timeout: 60_000 }).catch(() => {});
    console.log(`[probe] project @cancel before: ${await seqState(page)}`);
    const tc = Date.now();
    await page.evaluate(() => document.querySelector('.mo-cs-export').click());
    await page.waitForFunction(() => /cancelled/i.test(document.querySelector('.mo-cs-status')?.textContent || '') && !document.querySelector('.mo-cs-export.mo-ce-busy'), null, { timeout: 60_000 }).catch(() => {});
    const stopMs = Date.now() - tc;
    const left = await fs.stat(seqOut).then(() => 'partial file left', () => 'partial file removed');
    const ffLeft = spawnSync('pgrep', ['-f', 'part_001.mp4']).stdout.toString().trim();
    console.log(`[probe] project @cancel: stopped in ${stopMs} ms, status="${await page.evaluate(() => document.querySelector('.mo-cs-status')?.textContent || '')}" ${left}, ffmpeg ${ffLeft ? 'still running' : 'gone'}`);
    // Double-click a clip in the sequence: its video opens with that clip being edited.
    await page.locator('.mo-cs-row').nth(1).dblclick();
    await page.waitForSelector('.mo-cp .mo-clip-page', { timeout: 15_000 });
    await page.waitForTimeout(1_200);
    console.log(`[probe] project @edit clip: ${await trimState(page)} status="${await page.evaluate(() => Array.from(document.querySelectorAll('.mo-clip-page *')).map((e) => e.childElementCount === 0 ? e.textContent : '').find((t) => /^Editing clip/.test(t || '')) || 'no editing note')}"`);
    await page.locator('.mo-cp-list .mo-cp-row').nth(0).click();
    await page.waitForTimeout(1_200);
    // A narrow tab closes the bin to a rail.
    await page.setViewportSize({ width: 820, height: 900 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, 'project-narrow');
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForTimeout(800);
  } finally {
    await app.close().catch(() => {});
  }
  // Start again: the project is in the sidebar and opens where it was left.
  ({ app, page } = await launchApp(appRoot, errors));
  try {
    await page.waitForTimeout(2_000);
    await runCommand(page, [['media-organizer.openClipProject', 1]]);
    await page.waitForSelector('.mo-cp .mo-clip-page', { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @restart: ${await trimState(page)}`);
    await shot(page, 'project-restart');
    await page.locator('.mo-cp-seqrow').click();
    await page.waitForSelector('.mo-cs', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    console.log(`[probe] project @restart sequence: ${await seqState(page)}`);
    await page.locator('.mo-cp-list .mo-cp-row').nth(0).click();
    await page.waitForTimeout(1_200);
    // The Media Organizer sidebar lists the project.
    await page.locator('.activity-bar-item[aria-label="Atelier"]').first().click({ timeout: 3_000 }).catch((e) => console.log(`[probe] project: no Atelier view button (${String(e).split('\n')[0]})`));
    await page.waitForTimeout(1_500);
    await shot(page, 'project-sidebar');
    // Delete it from the project's menu.
    await page.locator('.mo-cp-head [title="Project Actions"]').click();
    await page.waitForTimeout(300);
    await page.getByText('Delete Project\u2026', { exact: true }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Delete Project', exact: true }).first().click();
    await page.waitForTimeout(1_200);
    const after = await page.evaluate(() => `pageOpen=${!!document.querySelector('.mo-cp')} sidebar=${Array.from(document.querySelectorAll('.mo-cp-sidebar .mo-sidebar-item-label')).map((x) => x.textContent).join(',')}`);
    console.log(`[probe] project @deleted: ${after}`);
  } finally {
    await app.close().catch(() => {});
  }
}

// Timelapse tools: three segments with the middle one at 4×, the last frame
// held and a before-and-after still, exported for real and measured.
async function timelapseScene(appRoot, clip2, errors) {
  const { app, page } = await launchApp(appRoot, errors);
  try {
    await enableMediaOrganizer(page);
    await runCommand(page, [['media-organizer.openClipEditor', clip2]]);
    await page.waitForSelector('.mo-clip-page', { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    for (const t of [3, 6]) {
      await page.evaluate((tt) => { const v = document.querySelector('.mo-clip-page video'); v.pause(); v.currentTime = tt; }, t);
      await page.waitForTimeout(400);
      await page.locator('.mo-clip-page').first().focus();
      await page.keyboard.press('s');
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => document.querySelector('.mo-ce-tab[title="Trim"]')?.click());
    await page.waitForTimeout(300);
    const set = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.mo-clip-segrow')).filter((r) => r.querySelector('.mo-ce-segspeed'));
      const sel = rows[1]?.querySelector('.mo-ce-segspeed');
      if (!sel) return `segment rows=${rows.length}, no speed control`;
      sel.value = '4'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return `segment rows=${rows.length}`;
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('.mo-ce-tab[title="Audio"]')?.click());
    await page.waitForTimeout(300);
    const fin = await page.evaluate(() => {
      const holdRow = Array.from(document.querySelectorAll('.mo-clip-row')).find((r) => /Hold the last frame/.test(r.textContent || ''));
      const hold = holdRow?.querySelector('input[type="number"]');
      if (hold) { hold.value = '1.5'; hold.dispatchEvent(new Event('input', { bubbles: true })); }
      const ba = document.getElementById('mo-clip-before-after');
      if (ba && !ba.checked) ba.click();
      const secsRow = Array.from(document.querySelectorAll('.mo-clip-row')).find((r) => /Shown for/.test(r.textContent || ''));
      const secs = secsRow?.querySelector('input[type="number"]');
      if (secs) { secs.value = '2'; secs.dispatchEvent(new Event('input', { bubbles: true })); }
      return `hold=${!!hold} beforeAfter=${!!ba && ba.checked} secs=${!!secs}`;
    });
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const segs = Array.from(document.querySelectorAll('.mo-clip-segrow')).filter((r) => r.querySelector('.mo-ce-segspeed')).map((r) => `${r.querySelector('.mo-clip-queue-meta')?.textContent}@${r.querySelector('.mo-ce-segspeed')?.value}×=${r.querySelector('.mo-ce-seglen')?.textContent}`);
      const blocks = Array.from(document.querySelectorAll('.mo-ce-block-num')).map((b) => b.textContent);
      return `segs=[${segs.join(' | ')}] blocks=[${blocks.join(',')}] readout="${document.querySelector('.mo-ce-readout')?.textContent}" export="${document.querySelector('.mo-ce-split .px-btn--primary')?.textContent}"`;
    });
    console.log(`[probe] timelapse: ${set}; ${fin}; ${state}`);
    await shot(page, 'timelapse');
    const out = path.join(path.dirname(clip2), 'probe-timelapse.mp4');
    await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, out);
    const t0 = Date.now();
    await page.evaluate(() => document.querySelector('.mo-ce-split .px-btn--primary').click());
    await page.waitForFunction(() => document.querySelector('.mo-ce-toast')?.style.display === '' || /failed/i.test(document.querySelector('.mo-clip-status')?.textContent || ''), null, { timeout: 180_000 }).catch(() => {});
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', out]);
    let probeText = 'no file';
    try { const j = JSON.parse(String(pr.stdout)); probeText = `duration=${Number(j.format.duration).toFixed(2)} (want 10.25) streams=${j.streams.map((x) => x.codec_type).join(',')}`; } catch { /* no file */ }
    console.log(`[probe] timelapse export (${((Date.now() - t0) / 1000).toFixed(1)} s): ${probeText}`);
    if (probeText !== 'no file') {
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '7.5', '-i', out, '-frames:v', '1', path.join(outDir, 'timelapse-hold.png')]);
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '9.3', '-i', out, '-frames:v', '1', path.join(outDir, 'timelapse-before-after.png')]);
    }
  } finally {
    await app.close().catch(() => {});
  }
}

// The image editor: a folder of photos is scanned, one opens in Edit Image,
// and each tool is shot (dark, then light, then a narrow window).
// The filter pills: Tags (include, leave out), Favorites, Date (a quick
// choice, then taken), Clear. Logs each pill and the match count.
async function moFiltersScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'filtertest');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=640x480', '-frames:v', '1', '-q:v', '4', path.join(media, 'beach1.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=30', '-frames:v', '1', '-q:v', '4', path.join(media, 'beach2.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=90', '-frames:v', '1', '-q:v', '4', path.join(media, 'sky.jpg')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] filters ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const runSql = (q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.run('media-organizer', q, p); return r.error ? JSON.stringify(r.error) : r.changes; }, { q, p });
  const pills = () => page.evaluate(() => Array.from(document.querySelectorAll('.mo-filter-chip-bar > *')).filter((p) => p.offsetParent).map((p) => `${p.textContent.trim()}${p.classList.contains('is-set') ? '*' : ''}`).join(' | '));
  const count = () => page.evaluate(() => document.querySelector('.mo-page-header .px-page-header__subtitle')?.textContent || '');
  const pill = (k) => page.evaluate((k) => document.querySelector(`.mo-filter-pill[data-pill="${k}"]`)?.click(), k);
  const row = (name) => page.evaluate((n) => Array.from(document.querySelectorAll('.mo-filter-pop .mo-tagpick-row')).find((r) => r.textContent.trim() === n)?.click(), name);
  const opt = (label) => page.evaluate((l) => Array.from(document.querySelectorAll('.mo-filter-pop button')).find((b) => b.textContent.trim() === l)?.click(), label);
  try {
    await enableMediaOrganizer(page);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, media);
    await runCommand(page, ['media-organizer.scan']);
    await page.waitForTimeout(5_000);
    await runSql(`INSERT INTO mo_tags (name) VALUES ('beach'), ('sky')`);
    await runSql(`INSERT INTO mo_photos_tags (photo_id, tag_id, via_parent_id) SELECT pf.photo_id, (SELECT id FROM mo_tags WHERE name = 'beach'), 0 FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename LIKE 'beach%'`);
    await runSql(`INSERT INTO mo_photos_tags (photo_id, tag_id, via_parent_id) SELECT pf.photo_id, (SELECT id FROM mo_tags WHERE name = 'sky'), 0 FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename IN ('sky.jpg', 'beach2.jpg')`);
    await runSql(`UPDATE mo_photos SET rating = 1 WHERE id IN (SELECT pf.photo_id FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'beach1.jpg')`);
    await runSql(`UPDATE mo_photos SET taken_at = '2019-05-04T10:00:00' WHERE id IN (SELECT pf.photo_id FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'sky.jpg')`);
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(3_000);
    await page.evaluate(() => document.querySelector('.mo-segment-btn[title="Grid"]')?.click());
    await page.waitForTimeout(1_500);
    log('start', `${await pills()} / ${await count()}`);
    await shot(page, 'filters-pills');
    await pill('tags');
    await page.waitForTimeout(800);
    await row('beach');
    await page.waitForTimeout(1_200);
    log('include beach', `${await pills()} / ${await count()}`);
    await row('sky');
    await page.waitForTimeout(400);
    await row('sky');
    await page.waitForTimeout(1_200);
    log('beach, not sky', `${await pills()} / ${await count()}`);
    await shot(page, 'filters-tags-pop');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.mo-filter-pill[data-pill="tags"] .mo-filter-pill-x')?.click());
    await page.waitForTimeout(1_000);
    log('tags cleared', `${await pills()} / ${await count()}`);
    await pill('fav');
    await page.waitForTimeout(1_200);
    log('favorites', `${await pills()} / ${await count()}`);
    await pill('fav');
    await page.waitForTimeout(1_000);
    await pill('date');
    await page.waitForTimeout(500);
    await opt('This month');
    await page.waitForTimeout(1_200);
    log('this month (added)', `${await pills()} / ${await count()}`);
    await opt('Taken');
    await page.waitForTimeout(1_200);
    log('this month (taken)', `${await pills()} / ${await count()}`);
    await shot(page, 'filters-date-pop');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.mo-filter-pills-clear')?.click());
    await page.waitForTimeout(1_200);
    log('cleared', `${await pills()} / ${await count()}`);
    // A tag's right-click: New Child Tag… files the new tag under it.
    await page.evaluate(() => { if (!document.querySelector('.mo-sidebar')?.offsetParent) Array.from(document.querySelectorAll('.activity-bar-item')).find((b) => Array.from(b.attributes).some((x) => /media.?organizer/i.test(x.value)))?.click(); });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-browse-segbtn')).find((b) => /Tags/.test(b.textContent))?.click());
    await page.waitForTimeout(1_200);
    // Tags went in by SQL; a filter keystroke reloads the list.
    await page.evaluate(() => { const i = document.querySelector('.mo-tag-search'); if (i) { i.value = 'b'; i.dispatchEvent(new Event('input', { bubbles: true })); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } });
    await page.waitForTimeout(1_200);
    log('tag rows before', await page.evaluate(() => `${document.querySelectorAll('.mo-tag-row').length} rows, sidebar ${document.querySelector('.mo-sidebar')?.offsetParent ? 'shown' : 'hidden'}: ` + Array.from(document.querySelectorAll('.mo-tag-row')).map((r) => r.textContent.trim()).join(', ')));
    await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.mo-tag-row')).find((x) => /beach/i.test(x.textContent)); if (r) { const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 20, clientY: b.top + 5 })); } });
    await page.waitForTimeout(400);
    log('tag menu', await page.evaluate(() => { const m = Array.from(document.querySelectorAll('.context-menu')).pop(); return m ? Array.from(m.querySelectorAll('.context-menu-item-label')).map((x) => x.textContent.trim()).join(' | ') : 'NO MENU'; }));
    await page.evaluate(() => { const m = Array.from(document.querySelectorAll('.context-menu')).pop(); if (m) Array.from(m.querySelectorAll('.context-menu-item')).find((r) => /New Child Tag/.test(r.textContent))?.click(); });
    await page.waitForTimeout(500);
    log('dialog', await page.evaluate(() => document.querySelector('.mo-bulk-dialog h3')?.textContent || 'no dialog'));
    await shot(page, 'filters-child-tag-dialog');
    await page.evaluate(() => { const t = document.querySelector('.mo-bulk-dialog textarea'); t.value = 'Sunset'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-bulk-dialog button')).find((b) => b.textContent === 'Create')?.click());
    await page.waitForTimeout(1_500);
    const sqlAll = (q) => page.evaluate(async (q) => { const r = await window.parallxElectron.extensionDatabase.all('media-organizer', q, []); return r.rows || r.error; }, q);
    log('relation', JSON.stringify(await sqlAll(`SELECT c.name AS child, p.name AS parent FROM mo_tags_relations r JOIN mo_tags c ON c.id = r.child_id JOIN mo_tags p ON p.id = r.parent_id`)));
    log('tag rows', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-tag-row')).map((r) => `${r.querySelector('.mo-sidebar-item-label')?.textContent || r.textContent.trim()}@${r.style.paddingLeft}`).join(' | ')));
    await shot(page, 'filters-child-tag');
  } finally {
    await app.close().catch(() => {});
  }
}

// The video player on a video's page, and the art tools (Daily Study,
// Practice Session, Painting Plans) as they stand, for a UI review.
async function moArtScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'arttest');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=960x720', '-frames:v', '1', '-q:v', '3', path.join(media, 'harbour.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=720x960:rule=30', '-frames:v', '1', '-q:v', '3', path.join(media, 'figure.jpg')]);
  ff(['-f', 'lavfi', '-i', 'life=s=800x600:mold=10:ratio=0.3', '-frames:v', '1', '-q:v', '3', path.join(media, 'still-life.jpg')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(media, 'studio-session.mp4')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] art ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const setCfg = (k, v) => page.evaluate(async ({ k, v }) => { const c = window.__parallx_workbench__?._services?.get?.({ id: 'IConfigurationService' }); await c._updateValue(k, v); }, { k, v });
  const card = (n) => `Array.from(document.querySelectorAll('.mo-card')).find((x) => (x.textContent || '').includes('${n}'))`;
  const menuClick = (re) => page.evaluate((src) => { const m = Array.from(document.querySelectorAll('.context-menu')).pop(); if (m) Array.from(m.querySelectorAll('.context-menu-item')).find((r) => new RegExp(src).test(r.textContent))?.click(); }, re);
  try {
    await enableMediaOrganizer(page);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, media);
    await runCommand(page, ['media-organizer.scan']);
    await page.waitForTimeout(8_000);
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(3_000);
    await page.evaluate(() => document.querySelector('.mo-segment-btn[title="Grid"]')?.click());
    await page.waitForTimeout(1_500);
    // The video's page: the player (filmstrip scrubber, one row of controls).
    await page.evaluate(`(() => { const c = ${card('studio-session')}; c && c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
    await page.waitForTimeout(4_000);
    log('player', await page.evaluate(() => document.querySelector('.mo-detail-preview .mo-player') ? 'found' : 'MISSING'));
    log('header', await page.evaluate(() => `${document.querySelector('.mo-detail-header-meta')?.textContent || 'no meta'} | ${Array.from(document.querySelectorAll('.mo-detail-header-actions button')).map((b) => b.textContent.trim() || b.title).join(' | ')}`));
    log('controls', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-detail-preview .mo-player-row button')).map((b) => b.textContent.trim() || b.title).join(' | ')));
    log('frames', await page.evaluate(() => document.querySelectorAll('.mo-detail-preview .mo-player-strip-frame').length));
    await page.evaluate(() => { const v = document.querySelector('.mo-detail-preview .mo-player-video'); if (v) { v.muted = true; v.currentTime = 2.5; } });
    await page.waitForTimeout(600);
    await page.evaluate(() => { const p = document.querySelector('.mo-detail-preview .mo-player'); p.focus(); });
    await page.keyboard.press('BracketLeft');
    await page.evaluate(() => { const v = document.querySelector('.mo-detail-preview .mo-player-video'); v.currentTime = 7.25; });
    await page.waitForTimeout(600);
    await page.keyboard.press('BracketRight');
    await page.keyboard.press('Period');
    await page.waitForTimeout(500);
    log('marks', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-detail-preview .mo-player-row .px-btn')).filter((b) => /^(In|Out)/.test(b.textContent.trim())).map((b) => b.textContent.trim()).join(' , ') + ' / ' + document.querySelector('.mo-detail-preview .mo-player-readout')?.textContent));
    const sb = await page.evaluate(() => { const r = document.querySelector('.mo-detail-preview .mo-player-strip')?.getBoundingClientRect(); return r ? { x: r.left + r.width * 0.62, y: r.top + r.height / 2 } : null; });
    if (sb) await page.mouse.move(sb.x, sb.y);
    await page.waitForTimeout(900);
    await shot(page, 'art-video-page');
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-detail-preview .mo-player-row .px-btn')).find((b) => b.textContent.trim() === 'Loop')?.click());
    await page.evaluate(() => { const v = document.querySelector('.mo-detail-preview .mo-player-video'); v.currentTime = 7.1; v.play(); });
    await page.waitForTimeout(1_500);
    log('loop wraps to In', await page.evaluate(() => document.querySelector('.mo-detail-preview .mo-player-video').currentTime.toFixed(2)));
    await page.evaluate(() => document.querySelector('.mo-detail-preview .mo-player-video').pause());
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(800);
    await shot(page, 'art-video-page-light');
    await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode'));
    await resizeWindow(page, 900, 800);
    await page.waitForTimeout(1_000);
    await shot(page, 'art-video-page-narrow');
    await resizeWindow(page, 1400, 900);
    await page.waitForTimeout(800);
    // The library viewer: the same player in the viewer's colours.
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(2_000);
    await page.evaluate(`(() => { const c = ${card('studio-session')}; if (c) { const b = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 20, clientY: b.top + 20 })); } })()`);
    await page.waitForTimeout(500);
    await menuClick('View Full Size');
    await page.waitForTimeout(4_000);
    log('viewer', await page.evaluate(() => `${document.querySelector('.mo-lightbox .mo-player') ? 'player' : 'NO PLAYER'} | bar: ${Array.from(document.querySelectorAll('.mo-lightbox-bar button')).filter((b) => b.offsetParent).map((b) => b.textContent.trim()).join(' | ')}`));
    log('viewer playing', await page.evaluate(() => { const v = document.querySelector('.mo-lightbox .mo-player-video'); return v ? `${!v.paused} at ${v.currentTime.toFixed(2)}` : 'none'; }));
    await page.evaluate(() => { const v = document.querySelector('.mo-lightbox .mo-player-video'); if (v) { v.muted = true; } });
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    log('space pauses', await page.evaluate(() => document.querySelector('.mo-lightbox .mo-player-video')?.paused));
    await page.keyboard.press('BracketLeft');
    await page.waitForTimeout(300);
    log('viewer marks', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-lightbox .mo-player-row .px-btn')).map((b) => b.textContent.trim()).filter(Boolean).join(' | ')));
    await page.mouse.move(700, 450);
    await shot(page, 'art-video-viewer');
    await page.locator('.mo-lightbox-nav.prev').screenshot({ path: path.join(outDir, 'art-video-viewer-prev.png'), timeout: 5_000 }).catch((e) => log('prev shot', String(e).split('\n')[0]));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    log('viewer closed', await page.evaluate(() => !document.querySelector('.mo-lightbox')));
    // Art tools on.
    await setCfg('mediaOrganizer.enableArtTools', true);
    await page.waitForTimeout(1_500);
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(2_500);
    await page.evaluate(() => { if (!document.querySelector('.mo-sidebar')?.offsetParent) Array.from(document.querySelectorAll('.activity-bar-item')).find((b) => Array.from(b.attributes).some((x) => /media.?organizer/i.test(x.value)))?.click(); });
    await page.waitForTimeout(1_200);
    log('sidebar', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-sidebar-item-label')).map((x) => x.textContent).join(' | ')));
    await shot(page, 'art-library');
    await page.evaluate(() => document.querySelector('.mo-segment-btn[title="Feed"]')?.click());
    await page.waitForTimeout(1_500);
    await shot(page, 'art-library-feed');
    // Practice Session setup, then a run.
    await runCommand(page, ['media-organizer.practiceSession']);
    await page.waitForTimeout(2_500);
    log('practice setup buttons', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-practice-setup button')).map((b) => b.textContent.trim() || b.title).join(' | ')));
    await shot(page, 'art-practice-setup');
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-practice-setup .mo-practice-start')).find((b) => b.offsetParent)?.click());
    await page.waitForTimeout(3_000);
    await page.mouse.move(800, 450);
    await page.waitForTimeout(150);
    await page.mouse.move(820, 470);
    log('practice player buttons', await page.evaluate(() => Array.from(document.querySelectorAll('[class*="mo-practice"] button')).filter((b) => b.offsetParent).map((b) => b.textContent.trim() || b.title || b.getAttribute('aria-label')).join(' | ')));
    await shot(page, 'art-practice-player');
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.offsetParent && (b.title === 'Stop' || b.getAttribute('aria-label') === 'Stop' || b.textContent.trim() === 'Stop'))?.click());
    await page.waitForTimeout(1_500);
    await shot(page, 'art-practice-after');
    // Daily Study.
    await runCommand(page, ['media-organizer.dailyStudy']);
    await page.waitForTimeout(3_000);
    await page.mouse.move(800, 450);
    await page.waitForTimeout(150);
    await page.mouse.move(820, 470);
    await shot(page, 'art-daily');
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.offsetParent && (b.title === 'Stop' || b.getAttribute('aria-label') === 'Stop' || b.textContent.trim() === 'Stop'))?.click());
    await page.waitForTimeout(1_000);
    // Painting Plans: empty list, then a plan from a photo.
    await runCommand(page, ['media-organizer.paintingPlans']);
    await page.waitForTimeout(2_000);
    await shot(page, 'art-plans-empty');
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(2_000);
    await page.evaluate(() => document.querySelector('.mo-segment-btn[title="Grid"]')?.click());
    await page.waitForTimeout(1_500);
    await page.evaluate(`(() => { const c = ${card('harbour')}; if (c) { const b = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 20, clientY: b.top + 20 })); } })()`);
    await page.waitForTimeout(500);
    await menuClick('Plan Painting');
    await page.waitForTimeout(4_000);
    log('plan tools', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-plan-tool')).map((b) => b.title).join(' | ')));
    await shot(page, 'art-plan-light');
    for (const t of ['Crop', 'Values', 'Composition', 'Palette', 'Compare', 'Process', 'Plan']) {
      await page.evaluate((t) => Array.from(document.querySelectorAll('.mo-plan-tool')).find((b) => b.title === t)?.click(), t);
      await page.waitForTimeout(1_200);
      await shot(page, `art-plan-${t.toLowerCase()}`);
    }
    await runCommand(page, ['media-organizer.paintingPlans']);
    await page.waitForTimeout(2_000);
    await shot(page, 'art-plans-list');
    // A photo's page with the art tools on.
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(2_000);
    await page.evaluate(`(() => { const c = ${card('harbour')}; c && c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
    await page.waitForTimeout(2_500);
    await shot(page, 'art-photo-page');
    await resizeWindow(page, 900, 800);
    await page.waitForTimeout(800);
    await runCommand(page, ['media-organizer.practiceSession']);
    await page.waitForTimeout(1_500);
    await shot(page, 'art-practice-setup-narrow');
  } finally {
    await app.close().catch(() => {});
  }
}

// Favorites in place of star ratings: a card's star, the F key, the menu,
// the Favorites view and filter, the detail page, and old ratings migrated.
// The PDF viewer: a generated four-page PDF with an outline, opened from the
// explorer. Toolbar, thumbnails, outline, find, menus, a highlight and its
// panel, night reading, light mode and a narrow window.
async function pdfScene(appRoot, workspace, errors) {
  const pdfPath = path.join(workspace, 'probe-reading.pdf');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  try {
    const p = await browser.newPage();
    const para = 'Excess loss development follows the reported pattern closely in the early years and then flattens. The tail factor is chosen from the industry curve and checked against the company triangle. ';
    const sec = (n, t) => `<h1>${n}. ${t}</h1><p>${para.repeat(6)}</p><h2>${n}.1 Method</h2><p>${para.repeat(5)}</p><h2>${n}.2 Results</h2><p>${para.repeat(5)}</p>`;
    await p.setContent(`<html><body style="font:12pt Georgia;margin:0">${[['Introduction'], ['Data'], ['Development'], ['Conclusions']].map(([t], i) => `<section style="page-break-after:always">${sec(i + 1, t)}</section>`).join('')}</body></html>`);
    await p.pdf({ path: pdfPath, format: 'Letter', margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' }, tagged: true, outline: true });
  } finally { await browser.close(); }
  const { app, page } = await launchApp(appRoot, errors);
  try {
    const state = () => page.evaluate(() => {
      const tb = document.querySelector('.pdf-toolbar');
      const btns = tb ? Array.from(tb.querySelectorAll('button')).map((b) => `${b.getAttribute('aria-label') || b.title || '?'}${b.disabled ? '(off)' : ''}${b.classList.contains('active') ? '*' : ''}`) : [];
      return `toolbar=${tb?.clientWidth}/${tb?.scrollWidth} page="${document.querySelector('.pdf-toolbar-page-input')?.value}/${document.querySelector('.pdf-toolbar-page-total')?.textContent}" zoom="${document.querySelector('.pdf-toolbar-zoom-input')?.value}" btns=[${btns.join(', ')}] outline=${document.querySelectorAll('.pdf-outline-title').length} thumbs=${document.querySelectorAll('.pdf-thumbnail-item').length} match="${document.querySelector('.pdf-search-match-count')?.textContent || ''}"`;
    });
    await page.evaluate(() => Array.from(document.querySelectorAll('.tree-node, [role="treeitem"], .explorer-item')).find((r) => /README\.md/.test(r.textContent || ''))?.click());
    await page.waitForTimeout(300);
    // A real double-click on the explorer row, the way a person opens it.
    const rowAt = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('[role="treeitem"], .tree-node, .explorer-item')).find((r) => /probe-reading\.pdf/.test(r.textContent || ''));
      if (!row) return null;
      const r = row.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 };
    });
    if (rowAt) await page.mouse.dblclick(rowAt.x, rowAt.y);
    const opened = !!rowAt;
    if (!opened) {
      await page.keyboard.press('Control+P');
      await page.waitForTimeout(600);
      await page.keyboard.type('probe-reading.pdf');
      await page.waitForTimeout(800);
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.pdf-editor-pane .pdfViewer .page canvas', { timeout: 20_000 });
    await page.waitForTimeout(2_500);
    console.log(`[probe] pdf: ${await state()}`);
    console.log(`[probe] pdf focus after open: ${await page.evaluate(() => { const a = document.activeElement; return `${a?.tagName}.${a?.className?.toString().slice(0, 40)} inPane=${!!a?.closest('.pdf-editor-pane')}`; })}`);
    console.log(`[probe] pdf page box: ${await page.evaluate(() => {
      const pg = document.querySelector('.pdfViewer .page'); const cs = getComputedStyle(pg); const r = pg.getBoundingClientRect();
      const cw = pg.querySelector('.canvasWrapper')?.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 4, r.top + 200);
      const ct = document.querySelector('.pdf-viewer-container');
      return `scrollTop=${ct.scrollTop} containerTop=${Math.round(ct.getBoundingClientRect().top)} cwShadow="${cw ? getComputedStyle(pg.querySelector('.canvasWrapper')).boxShadow : ''}" page=${Math.round(r.left)}..${Math.round(r.right)} top=${Math.round(r.top)} border="${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}" bg=${cs.backgroundColor} clip=${cs.backgroundClip} shadow="${cs.boxShadow}" canvas=${Math.round(cw?.left)}..${Math.round(cw?.right)} hitAtBorder=${hit?.className} viewerPad="${getComputedStyle(document.querySelector('.pdfViewer')).padding}" containerBg=${getComputedStyle(document.querySelector('.pdf-viewer-container')).backgroundColor}`;
    })}`);
    await shot(page, 'pdf');
    // The toolbar buttons carry no accessible name (tooltip only): find them by place.
    const clickBtn = async (label) => {
      await page.evaluate((l) => {
        const right = Array.from(document.querySelectorAll('.pdf-toolbar > .pdf-toolbar-cluster')).pop();
        const order = ['Find', 'Outline', 'Thumbnails', 'Night reading (invert colors)', 'More actions'];
        const b = l === 'Zoom presets' ? document.querySelector('.pdf-toolbar-zoom-preset') : right?.querySelectorAll(':scope > button')[order.indexOf(l)];
        b?.click();
      }, label);
      await page.waitForTimeout(900);
    };
    await clickBtn('Thumbnails');
    await page.waitForTimeout(1_200);
    await shot(page, 'pdf-thumbnails');
    await clickBtn('Thumbnails');
    await clickBtn('Outline');
    console.log(`[probe] pdf outline: ${await state()}`);
    await shot(page, 'pdf-outline');
    await clickBtn('Outline');
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(400);
    console.log(`[probe] pdf Ctrl+F without clicking the page: bar shown=${await page.evaluate(() => { const b = document.querySelector('.pdf-search-bar'); return !!b && b.style.display !== 'none' && !!b.offsetParent; })}`);
    // Click into the page (its margin, away from text), then Ctrl+F.
    await page.evaluate(() => { const r = document.querySelector('.pdfViewer .page').getBoundingClientRect(); window.__pdfClick = { x: r.left + 20, y: r.top + 20 }; });
    const pc = await page.evaluate(() => window.__pdfClick);
    await page.mouse.click(pc.x, pc.y);
    await page.waitForTimeout(300);
    console.log(`[probe] pdf focus after clicking the page: ${await page.evaluate(() => { const a = document.activeElement; return `${a?.tagName}.${a?.className?.toString().slice(0, 40)} inPane=${!!a?.closest('.pdf-editor-pane')}`; })}`);
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(400);
    const barUp = await page.evaluate(() => { const b = document.querySelector('.pdf-search-bar'); return !!b && !!b.offsetParent; });
    console.log(`[probe] pdf Ctrl+F after clicking the page: bar shown=${barUp}`);
    if (!barUp) { await clickBtn('Find'); await page.waitForTimeout(400); }
    await page.keyboard.type('tail factor');
    await page.waitForTimeout(1_500);
    console.log(`[probe] pdf find: ${await state()}`);
    console.log(`[probe] pdf find colours: ${await page.evaluate(() => {
      const all = document.querySelector('.textLayer .highlight:not(.selected)'); const sel = document.querySelector('.textLayer .highlight.selected');
      return `match=${all ? getComputedStyle(all).backgroundColor : 'none'} current=${sel ? getComputedStyle(sel).backgroundColor : 'none'} var=${getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-findMatchHighlightBackground')}|${getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-findMatchBackground')}`;
    })}`);
    await shot(page, 'pdf-find');
    await page.keyboard.press('Escape');
    await clickBtn('More actions');
    await shot(page, 'pdf-more');
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 450);
    await clickBtn('Zoom presets');
    await shot(page, 'pdf-zoom-presets');
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 450);
    // Select a line of text on page 1 and open the selection menu.
    const box = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.pdfViewer .page[data-page-number="1"] .textLayer span')).filter((s) => (s.textContent || '').length > 30);
      const s = spans[2]; if (!s) return null;
      const r = s.getBoundingClientRect(); return { x: r.left + 2, y: r.top + r.height / 2, w: r.width };
    });
    if (box) {
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.w * 0.7, box.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(800);
      await shot(page, 'pdf-selection-menu');
      const hl = await page.evaluate(() => { const it = Array.from(document.querySelectorAll('.context-menu .context-menu-item')).find((r) => /^Highlight$/.test(r.querySelector('.context-menu-item-label')?.textContent || '')); if (!it) return false; it.click(); return true; });
      await page.waitForTimeout(900);
      console.log(`[probe] pdf highlight made: ${hl}, boxes=${await page.evaluate(() => document.querySelectorAll('.pdf-highlight-box').length)}`);
      await page.mouse.move(box.x + 40, box.y + 30);
      await page.waitForTimeout(400);
      const tab = await page.evaluate(() => { const t = document.querySelector('.pdf-highlight-tab'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      if (tab) { await page.mouse.click(tab.x, tab.y); await page.waitForTimeout(900); await shot(page, 'pdf-highlight-panel'); await page.mouse.click(700, 120); await page.waitForTimeout(400); }
    }
    await clickBtn('Night reading (invert colors)');
    await shot(page, 'pdf-night');
    await clickBtn('Night reading (invert colors)');
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(800);
    await clickBtn('Outline');
    await shot(page, 'pdf-light');
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(400);
    await page.keyboard.type('zzzz');
    await page.waitForTimeout(1_000);
    await shot(page, 'pdf-light-find-none');
    await page.keyboard.press('Escape');
    await clickBtn('Outline');
    await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode'));
    await resizeWindow(page, 760, 820);
    await page.waitForTimeout(1_200);
    console.log(`[probe] pdf narrow: ${await state()}`);
    await shot(page, 'pdf-narrow');
  } finally {
    await app.close().catch(() => {});
  }
}

async function moFavScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'favtest');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=640x480', '-frames:v', '1', '-q:v', '4', path.join(media, 'alpha.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=30', '-frames:v', '1', '-q:v', '4', path.join(media, 'beta.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=90', '-frames:v', '1', '-q:v', '4', path.join(media, 'gamma.jpg')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] fav ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const sql = (q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.all('media-organizer', q, p); return r.rows || r.error; }, { q, p });
  const runSql = (q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.run('media-organizer', q, p); return r.error ? JSON.stringify(r.error) : r.changes; }, { q, p });
  const ratings = async () => JSON.stringify(await sql(`SELECT f.basename AS f, p.rating AS r FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id ORDER BY f.basename`));
  const menuItems = () => page.evaluate(() => { const m = Array.from(document.querySelectorAll('.context-menu')).pop(); return m ? Array.from(m.querySelectorAll('.context-menu-item-label')).map((x) => x.textContent.trim()).join(' | ') : 'NO MENU'; });
  const card = (n) => `Array.from(document.querySelectorAll('.mo-card')).find((x) => (x.textContent || '').includes('${n}'))`;
  const sideRow = (label) => page.evaluate((l) => Array.from(document.querySelectorAll('.mo-sidebar-item')).find((r) => r.querySelector('.mo-sidebar-item-label')?.textContent === l)?.click(), label);
  try {
    await enableMediaOrganizer(page);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, media);
    await runCommand(page, ['media-organizer.scan']);
    await page.waitForTimeout(5_000);
    // Old star ratings, as a library from before would have them; restart to migrate.
    await runSql(`UPDATE mo_photos SET rating = 4 WHERE id IN (SELECT pf.photo_id FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'gamma.jpg')`);
    await runSql(`DELETE FROM mo_settings WHERE key = 'favorites_from_ratings'`);
    await page.evaluate(async () => { const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' }); await svc.setEnablement('parallx-community.media-organizer', false); });
    await page.waitForTimeout(1_500);
    await enableMediaOrganizer(page);
    await page.waitForTimeout(2_000);
    log('after migration', await ratings());
    await page.evaluate(() => Array.from(document.querySelectorAll('.activity-bar-item')).find((b) => Array.from(b.attributes).some((a) => /media.?organizer/i.test(a.value)))?.click());
    await page.waitForTimeout(1_200);
    await sideRow('Untagged');
    await page.waitForTimeout(2_500);
    // A card's star.
    await page.evaluate(`${card('alpha')}?.querySelector('.mo-card-fav')?.click()`);
    await page.waitForTimeout(800);
    log('after clicking alpha star', `${await ratings()} star on=${await page.evaluate(`${card('alpha')}?.querySelector('.mo-card-fav')?.classList.contains('is-on')`)}`);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await shot(page, 'fav-cards');
    // The F key on the focused card.
    await page.evaluate(`${card('beta')}?.click()`);
    await page.waitForTimeout(300);
    await page.keyboard.press('f');
    await page.waitForTimeout(800);
    log('after F on beta', await ratings());
    // The menu.
    await page.evaluate(`(() => { const c = ${card('beta')}; const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 })); })()`);
    await page.waitForTimeout(400);
    log('menu on beta', await menuItems());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Sidebar count and the Favorites view.
    log('sidebar Favorites count', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-sidebar-item')).find((r) => r.querySelector('.mo-sidebar-item-label')?.textContent === 'Favorites')?.querySelector('.mo-sidebar-item-count')?.textContent || ''));
    await sideRow('Favorites');
    await page.waitForTimeout(2_500);
    log('Favorites view', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-card .mo-card-title, .mo-feed-tile')).map((c) => c.textContent.trim()).join(', ') || Array.from(document.querySelectorAll('.mo-card')).length + ' cards'));
    // Detail page favourite button.
    await page.evaluate(`(() => { const c = ${card('gamma')} || Array.from(document.querySelectorAll('.mo-card'))[0]; c && c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
    await page.waitForTimeout(2_500);
    log('detail header buttons', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-detail-header button, .mo-detail-actions button')).map((b) => `${b.title}${b.classList.contains('mo-active') ? '*' : ''}`).join(' | ')));
    await shot(page, 'fav-detail');
    // Search operator.
    await sideRow('All Media');
    await page.waitForTimeout(2_000);
    await page.evaluate(() => { const i = document.querySelector('.mo-search-wrap input, input.mo-search'); if (i) { i.value = 'is:favorite'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } });
    await page.waitForTimeout(2_000);
    log('is:favorite search subtitle', await page.evaluate(() => document.querySelector('.mo-page-header .px-page-header__subtitle')?.textContent || ''));
  } finally {
    await app.close().catch(() => {});
  }
}

// Delete set to Trash: Delete moves without asking, Trash offers Restore,
// Delete Permanently… and Empty Trash…, and Trash older than 30 days is
// removed with its files (and so is not re-imported by the folder watcher).
async function moTrashScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'trashtest');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=640x480', '-frames:v', '1', '-q:v', '4', path.join(media, 'keep.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=30', '-frames:v', '1', '-q:v', '4', path.join(media, 'bin.jpg')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] trash ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const msgs = async () => page.evaluate(() => { const svc = window.__parallx_workbench__?._services?.get?.({ id: 'INotificationService' }); const out = ((svc && svc.history) || []).map((n) => n.message); if (svc && svc.clearHistory) svc.clearHistory(); return out; });
  const menuItems = () => page.evaluate(() => { const m = Array.from(document.querySelectorAll('.context-menu')).pop(); return m ? Array.from(m.querySelectorAll('.context-menu-item-label')).map((x) => x.textContent.trim()).join(' | ') : 'NO MENU'; });
  const clickMenu = (label) => page.evaluate((l) => { const m = Array.from(document.querySelectorAll('.context-menu')).pop(); const it = m && Array.from(m.querySelectorAll('.context-menu-item')).find((r) => r.querySelector('.context-menu-item-label')?.textContent.trim() === l); if (it) it.click(); return !!it; }, label);
  const rightClick = (name) => page.evaluate((n) => { const c = Array.from(document.querySelectorAll('.mo-card')).find((x) => (x.textContent || '').includes(n)); if (!c) return false; const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 })); return true; }, name);
  const sql = (q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.all('media-organizer', q, p); return r.rows || r.error; }, { q, p });
  const runSql = (q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.run('media-organizer', q, p); return r.error ? JSON.stringify(r.error) : r.changes; }, { q, p });
  const binState = async () => JSON.stringify(await sql(`SELECT p.id, p.deleted_at FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'bin.jpg'`));
  const sideRow = (label) => page.evaluate((l) => Array.from(document.querySelectorAll('.mo-sidebar-item')).find((r) => r.querySelector('.mo-sidebar-item-label')?.textContent === l)?.click(), label);
  try {
    await enableMediaOrganizer(page);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, media);
    await runCommand(page, ['media-organizer.scan']);
    await page.waitForTimeout(5_000);
    await page.evaluate(() => Array.from(document.querySelectorAll('.activity-bar-item')).find((b) => Array.from(b.attributes).some((a) => /media.?organizer/i.test(a.value)))?.click());
    await page.waitForTimeout(1_500);
    log('Trash row with Delete = permanent and Trash empty', await page.evaluate(() => (document.querySelector('.mo-sidebar-foot')?.classList.contains('mo-hidden') ? 'hidden' : 'shown')));
    await page.evaluate(async () => { const c = window.__parallx_workbench__?._services?.get?.({ id: 'IConfigurationService' }); await c._updateValue('mediaOrganizer.deleteMode', 'trash'); });
    await page.waitForTimeout(1_500);
    log('Trash row with Delete = trash', await page.evaluate(() => (document.querySelector('.mo-sidebar-foot')?.classList.contains('mo-hidden') ? 'hidden' : 'shown')));
    await sideRow('Untagged');
    await page.waitForTimeout(2_500);
    await rightClick('bin');
    await page.waitForTimeout(400);
    log('menu on a photo', await menuItems());
    await clickMenu('Move to Trash');
    await page.waitForTimeout(1_500);
    log('after Move to Trash', `${await binState()} ${JSON.stringify(await msgs())}`);
    await sideRow('Trash');
    await page.waitForTimeout(2_500);
    log('Trash header', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-page-header button')).filter((b) => b.offsetParent).map((b) => (b.textContent || b.title || '').trim()).join(' | ')));
    await rightClick('bin');
    await page.waitForTimeout(400);
    log('menu in Trash', await menuItems());
    await shot(page, 'trash-menu');
    await clickMenu('Restore');
    await page.waitForTimeout(1_500);
    log('after Restore', `${await binState()} ${JSON.stringify(await msgs())}`);
    // Again into Trash, by the Delete key this time, then the permanent dialog.
    await sideRow('Untagged');
    await page.waitForTimeout(2_000);
    await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mo-card')).find((x) => (x.textContent || '').includes('bin')); c?.querySelector('.mo-card-check, .mo-card-select, input[type=checkbox]')?.click(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.mo-grid-browser')?.focus());
    await page.keyboard.press('Delete');
    await page.waitForTimeout(1_500);
    log('Delete key (Trash mode)', `${await binState()} dialog=${await page.evaluate(() => !!document.querySelector('.mo-bulk-dialog'))} ${JSON.stringify(await msgs())}`);
    await sideRow('Trash');
    await page.waitForTimeout(2_000);
    await rightClick('bin');
    await page.waitForTimeout(400);
    await clickMenu('Delete Permanently…');
    await page.waitForTimeout(500);
    log('Delete Permanently… opens', await page.evaluate(() => { const d = document.querySelector('.mo-bulk-dialog'); return d ? d.querySelector('h3')?.textContent : 'no dialog'; }));
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-bulk-dialog button')).find((b) => b.textContent === 'Cancel')?.click());
    await page.waitForTimeout(300);
    // Empty Trash… asks (it used to crash before asking).
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-page-header button')).find((b) => /Empty Trash/.test(b.textContent || ''))?.click());
    await page.waitForTimeout(800);
    log('Empty Trash… asks', await page.evaluate(() => Array.from(document.querySelectorAll('.parallx-notification-prompts-container .parallx-notification-message, .parallx-notification-prompts-container button')).map((e) => e.textContent.trim()).join(' | ') || 'nothing'));
    await shot(page, 'trash-empty-prompt');
    await page.evaluate(() => Array.from(document.querySelectorAll('.parallx-notification-prompts-container button')).find((b) => b.textContent.trim() === 'Cancel')?.click());
    await page.waitForTimeout(300);
    // 30 days later: removed with its file, and not re-imported.
    log('backdate', String(await runSql(`UPDATE mo_photos SET deleted_at = datetime('now', '-40 days') WHERE deleted_at IS NOT NULL`)));
    await page.evaluate(async () => { const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' }); await svc.setEnablement('parallx-community.media-organizer', false); });
    await page.waitForTimeout(2_000);
    await enableMediaOrganizer(page);
    await page.waitForTimeout(3_000);
    log('bin.jpg after restart', `${await binState()} on disk=${await fs.stat(path.join(media, 'bin.jpg')).then(() => true).catch(() => false)}`);
    await runCommand(page, ['media-organizer.rescan']);
    await page.waitForTimeout(5_000);
    log('bin.jpg after rescan', `${await binState()} ${JSON.stringify(await msgs())}`);
    log('keep.jpg untouched', JSON.stringify(await sql(`SELECT p.deleted_at FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'keep.jpg'`)));
  } finally {
    await app.close().catch(() => {});
  }
}

// Media Organizer audit: every menu on a photo, a GIF, a video and a
// selection; the page ⋯ and View; what Delete and the Delete key do; Trash;
// commands run from the palette without arguments; the shortcuts sheet.
// Logs each menu's items and each message the app shows.
async function moAuditScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'audit');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=800x600', '-frames:v', '1', '-q:v', '4', path.join(media, 'one.jpg')]);
  ff(['-f', 'lavfi', '-i', 'gradients=s=800x600:speed=0', '-frames:v', '1', '-q:v', '4', path.join(media, 'two.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=800x600:rule=30', '-frames:v', '1', '-q:v', '4', path.join(media, 'three.jpg')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=s=320x240:d=1:r=10', path.join(media, 'loop.gif')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=s=640x360:d=2:r=25', '-pix_fmt', 'yuv420p', path.join(media, 'clip.mp4')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] audit ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const msgs = async () => page.evaluate(() => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'INotificationService' });
    const h = (svc && svc.history) || [];
    const out = h.map((n) => n.message + (n.actions && n.actions.length ? ` [${n.actions.map((a) => a.title || a).join(' | ')}]` : ''));
    if (svc && svc.clearHistory) svc.clearHistory();
    return out;
  });
  const menuItems = () => page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('.context-menu')).filter((m) => m.offsetParent || m.getBoundingClientRect().width);
    const m = menus[menus.length - 1];
    if (!m) return 'NO MENU';
    return Array.from(m.children).map((r) => {
      if (r.classList.contains('context-menu-separator') || /separator/.test(r.className)) return '—';
      const l = r.querySelector('.context-menu-item-label')?.textContent || r.textContent || '';
      const k = r.querySelector('.context-menu-item-keybinding, .context-menu-item-key')?.textContent || '';
      return `${l.trim()}${r.classList.contains('context-menu-item--disabled') ? ' (off)' : ''}${k ? ` <${k.trim()}>` : ''}${r.querySelector('.context-menu-item-submenu, .context-menu-submenu-indicator') ? ' ›' : ''}`;
    }).join(' | ');
  });
  const prompts = () => page.evaluate(() => Array.from(document.querySelectorAll('.parallx-notification-prompts-container *, .parallx-notifications-container .parallx-notification-message, .parallx-modal-box')).filter((e) => e.offsetParent && e.children.length === 0 && (e.textContent || '').trim()).map((e) => e.textContent.trim()).join(' | '));
  const closeMenus = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
  const rightClickCard = async (name) => {
    const ok = await page.evaluate((n) => {
      const card = Array.from(document.querySelectorAll('.mo-card, .mo-list-row')).find((c) => (c.textContent || '').includes(n));
      if (!card) return false;
      const r = card.getBoundingClientRect();
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
      return true;
    }, name);
    await page.waitForTimeout(400);
    return ok;
  };
  try {
    await enableMediaOrganizer(page);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, media);
    await runCommand(page, ['media-organizer.scan']);
    await page.waitForTimeout(6_000);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.activity-bar-item')).find((b) => Array.from(b.attributes).some((a) => /media.?organizer/i.test(a.value)));
      if (btn) btn.click();
    });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-sidebar-item')).find((r) => r.querySelector('.mo-sidebar-item-label')?.textContent === 'All Media')?.click());
    await page.waitForTimeout(3_000);
    log('All Media opens as', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-segment-btn')).filter((b) => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true').map((b) => b.title).join(',') + (document.querySelector('.mo-feed:not([hidden])') && document.querySelector('.mo-feed').offsetParent ? ' (feed visible)' : '')));
    log('messages after scan', await msgs());
    // Grid layout, then each kind of card.
    await page.evaluate(() => document.querySelector('.mo-segment-btn[title="Grid"]')?.click());
    await page.waitForTimeout(2_000);
    log('cards', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-card')).map((c) => (c.querySelector('.mo-card-title')?.textContent || '').trim()).join(', ')));
    for (const name of ['one', 'loop', 'clip']) {
      const ok = await rightClickCard(name);
      log(`menu on ${name}`, ok ? await menuItems() : 'card not found');
      if (name === 'one') await shot(page, 'audit-menu-photo');
      await closeMenus();
    }
    // Page ⋯ and View.
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-page-header button')).find((b) => /More/.test(b.title || b.getAttribute('aria-label') || ''))?.click());
    await page.waitForTimeout(400);
    log('page ⋯', await menuItems());
    await closeMenus();
    await page.evaluate(() => document.querySelector('.mo-toolbar-btn[title="View options"]')?.click());
    await page.waitForTimeout(400);
    log('View popover', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-view-pop .mo-view-row')).map((r) => r.textContent.trim()).join(' | ')));
    await page.mouse.click(700, 700);
    await page.waitForTimeout(300);
    // Select all, then the selection's right-click and bar.
    await page.evaluate(() => document.querySelector('.mo-card')?.click());
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(600);
    log('selection bar', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-selection-bar button, .mo-sel-bar button, [class*="mo-sel"] button')).filter((b) => b.offsetParent).map((b) => (b.getAttribute('aria-label') || b.textContent || b.title || '').trim()).filter(Boolean).join(' | ')));
    await shot(page, 'audit-selection');
    await rightClickCard('one');
    log('menu on selection', await menuItems());
    await shot(page, 'audit-menu-selection');
    await closeMenus();
    // The Delete key with the selection (keys go to the focused grid).
    await page.evaluate(() => { const g = document.querySelector('.mo-grid-browser'); if (g) g.focus(); });
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(400);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    log('Delete key opens', await page.evaluate(() => { const d = document.querySelector('.mo-bulk-dialog'); return d ? `${d.querySelector('h3')?.textContent} / ${d.querySelector('.mo-bulk-dialog-warn')?.textContent} / checkbox checked=${d.querySelector('input[type=checkbox]')?.checked}` : 'no dialog'; }));
    await shot(page, 'audit-delete-dialog');
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-bulk-dialog button')).find((b) => b.textContent === 'Cancel')?.click());
    await page.waitForTimeout(300);
    // The palette's Move Selected to Trash on one item, then the Trash view.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mo-card')).find((x) => (x.textContent || '').includes('three')); c?.querySelector('.mo-card-check, .mo-card-select, input[type=checkbox]')?.click(); });
    await page.waitForTimeout(300);
    const selN = await page.evaluate(() => document.querySelectorAll('.mo-card.selected, .mo-card.is-selected, .mo-card[aria-selected="true"]').length);
    log('selected before moveToTrash', String(selN));
    await runCommand(page, ['media-organizer.moveToTrash']);
    await page.waitForTimeout(1_200);
    log('messages after moveToTrash', await msgs());
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-sidebar-item')).find((r) => r.querySelector('.mo-sidebar-item-label')?.textContent === 'Trash')?.click());
    await page.waitForTimeout(2_500);
    log('Trash view cards', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-card, .mo-feed-tile')).filter((c) => c.offsetParent).map((c) => (c.textContent || '').trim().slice(0, 20)).join(', ') || 'none'));
    log('Trash view buttons', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-page-header button')).filter((b) => b.offsetParent).map((b) => (b.textContent || b.title || '').trim()).join(' | ')));
    if (await rightClickCard('three')) { log('menu in Trash', await menuItems()); await closeMenus(); }
    else log('menu in Trash', 'no card (Trash view may be a feed or empty)');
    // Folder row right-click in the sidebar.
    await page.evaluate(() => { const r = document.querySelector('[data-mo-browse="folders"] .mo-sidebar-item'); if (r) { const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 10, clientY: b.top + 5 })); } });
    await page.waitForTimeout(400);
    log('folder row right-click', await menuItems());
    await closeMenus();
    // Commands from the palette, no arguments.
    for (const c of ['revealInMO', 'openClipEditor', 'editImage', 'createAlbum', 'openSmartAlbum', 'cacheStats', 'emptyTrash']) {
      await runCommand(page, [`media-organizer.${c}`]);
      await page.waitForTimeout(900);
      log(`palette ${c}`, `${JSON.stringify(await msgs())} on screen: ${await prompts()}`);
      if (c === 'editImage' || c === 'emptyTrash') await shot(page, `audit-palette-${c}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    // Trash older than 30 days: backdate the trashed photo, restart the tool
    // (the purge runs on activation), then rescan the folder.
    const sql = (q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.all('media-organizer', q, p); return r.rows || r.error; }, { q, p });
    const runSql = (q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.run('media-organizer', q, p); return r.error ? JSON.stringify(r.error) : r.changes; }, { q, p });
    const photoState = async () => JSON.stringify(await sql(`SELECT p.id, f.basename, p.deleted_at FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'three.jpg'`));
    log('three.jpg before', await photoState());
    log('backdate', String(await runSql(`UPDATE mo_photos SET deleted_at = datetime('now', '-40 days') WHERE deleted_at IS NOT NULL`)));
    await page.evaluate(async () => { const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' }); await svc.setEnablement('parallx-community.media-organizer', false); });
    await page.waitForTimeout(2_000);
    await enableMediaOrganizer(page);
    log('three.jpg after restart (auto-purge)', await photoState());
    log('three.jpg on disk', String(await fs.stat(path.join(media, 'three.jpg')).then(() => true).catch(() => false)));
    await runCommand(page, ['media-organizer.rescan']);
    await page.waitForTimeout(6_000);
    log('three.jpg after rescan', await photoState());
    log('messages', await msgs());
    // The shortcuts sheet.
    await runCommand(page, ['media-organizer.showShortcuts']);
    await page.waitForTimeout(600);
    log('shortcuts sheet', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-cheat-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /Delete|sash|Save|filter/i.test(t)).join(' | ')));
    await page.keyboard.press('Escape');
  } finally {
    await app.close().catch(() => {});
  }
}

// The Media Organizer sidebar: the places to look, To sort, Collections,
// Studio and Browse (Folders | Tags), in dark and light, with a view open.
async function sidebarScene(appRoot, workspace, errors) {
  const photos = path.join(workspace, 'photos');
  await fs.mkdir(photos, { recursive: true });
  for (const [name, lav] of [['a.jpg', 'mandelbrot=s=800x600'], ['b.jpg', 'gradients=s=800x600:speed=0'], ['c.jpg', 'cellauto=s=800x600:rule=110']]) {
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', lav, '-frames:v', '1', '-q:v', '4', path.join(photos, name)]);
  }
  const { app, page } = await launchApp(appRoot, errors);
  try {
    await enableMediaOrganizer(page);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, photos);
    await runCommand(page, ['media-organizer.scan']);
    await page.waitForTimeout(4_000);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.activity-bar-item')).find((b) => Array.from(b.attributes).some((a) => /media.?organizer/i.test(a.value)));
      if (btn) btn.click();
    });
    await page.waitForSelector('.mo-sidebar-item', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    const state = () => page.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('.mo-sidebar-section-header')).map((h) => `${h.querySelector('.mo-sidebar-section-title')?.textContent}${h.classList.contains('collapsed') ? '(folded)' : ''}`);
      const rows = Array.from(document.querySelectorAll('.mo-sidebar .mo-sidebar-item')).filter((r) => r.offsetParent).map((r) => `${r.querySelector('.mo-sidebar-item-label')?.textContent}${r.querySelector('.mo-sidebar-item-count')?.textContent ? '=' + r.querySelector('.mo-sidebar-item-count').textContent : ''}${r.classList.contains('is-current') ? '*' : ''}${r.classList.contains('is-quiet') ? '~' : ''}`);
      const seg = Array.from(document.querySelectorAll('.mo-browse-segbtn')).map((b) => `${b.textContent}${b.classList.contains('is-on') ? '*' : ''}`);
      const hints = Array.from(document.querySelectorAll('.mo-sidebar-hint')).filter((h) => h.offsetParent).map((h) => h.textContent);
      return `heads=[${heads}] seg=[${seg}] rows=[${rows.join(', ')}] hints=[${hints.join(' / ')}]`;
    });
    console.log(`[probe] sidebar: ${await state()}`);
    await shot(page, 'sidebar');
    // Studio's +: New Clip Project… and Record Screen….
    await page.evaluate(() => { const h = Array.from(document.querySelectorAll('.mo-sidebar-section-header')).find((x) => x.querySelector('.mo-sidebar-section-title')?.textContent === 'Studio'); h?.querySelector('.mo-sidebar-header-btns button')?.click(); });
    await page.waitForTimeout(400);
    console.log(`[probe] sidebar Studio +: ${await page.evaluate(() => { const m = Array.from(document.querySelectorAll('.context-menu')).pop(); return m ? Array.from(m.querySelectorAll('.context-menu-item')).map((r) => `${r.querySelector('.context-menu-item-label')?.textContent}${r.classList.contains('context-menu-item--disabled') ? ' (off)' : ''}`).join(' | ') : 'NO MENU'; })}`);
    await shot(page, 'sidebar-studio-menu');
    await page.keyboard.press('Escape');
    console.log(`[probe] settings hub: ${await page.evaluate(() => { const r = window.__parallx_workbench__?._services?.get?.({ id: 'ISettingsRegistryService' }); const sc = r && r.getSchema && r.getSchema('mediaOrganizer.deleteMode'); return sc ? `${sc.key} ${sc.type} [${(sc.enumValues || sc.enum || []).join(',')}]` : 'not registered'; })}`);
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-sidebar-item')).find((r) => r.querySelector('.mo-sidebar-item-label')?.textContent === 'All Media')?.click());
    await page.waitForTimeout(2_500);
    await page.mouse.move(150, 300);
    console.log(`[probe] sidebar, All Media open: ${await state()}`);
    await shot(page, 'sidebar-current');
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-browse-segbtn')).find((b) => /Tags/.test(b.textContent))?.click());
    await page.waitForTimeout(800);
    console.log(`[probe] sidebar, tags: ${await state()}`);
    await shot(page, 'sidebar-tags');
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(800);
    await shot(page, 'sidebar-light');
  } finally {
    await app.close().catch(() => {});
  }
}

async function imageScene(appRoot, workspace, errors) {
  const photos = path.join(workspace, 'photos');
  await fs.mkdir(photos, { recursive: true });
  const srcs = [
    ['studio.jpg', 'gradients=s=1600x1067:c0=0x2b4a6f:c1=0xd99a5b:c2=0x7a3b2e:x0=0:y0=0:x1=1600:y1=1067:speed=0,noise=alls=12:allf=t'],
    ['garden.jpg', 'mandelbrot=s=1600x1067:maxiter=200'],
    ['portrait.jpg', 'gradients=s=900x1200:c0=0x1d2b24:c1=0xe8d7b0:x0=0:y0=1200:x1=900:y1=0:speed=0,noise=alls=10:allf=t'],
    ['sketch.jpg', 'cellauto=s=1600x1067:rule=110,negate'],
    ['dusk.jpg', 'gradients=s=1600x1067:c0=0x0b0d26:c1=0xff7a3d:c2=0x6a2c70:speed=0'],
  ];
  for (const [name, lav] of srcs) {
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', lav, '-frames:v', '1', '-q:v', '3', path.join(photos, name)]);
  }
  const { app, page } = await launchApp(appRoot, errors);
  try {
    await enableMediaOrganizer(page);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, photos);
    await runCommand(page, ['media-organizer.scan']);
    await page.waitForTimeout(4_000);
    await runCommand(page, [['media-organizer.editImage', 1]]);
    await page.waitForSelector('.mo-edit', { timeout: 20_000 });
    await page.waitForTimeout(3_000);
    const tool = async (label) => { await page.evaluate((l) => document.querySelector(`.mo-edit-tab[title="${l}"]`)?.click(), label); await page.waitForTimeout(1_200); };
    const scrollPanel = async (frac) => { await page.evaluate((f) => { const b = document.querySelector('.mo-edit-panel-body'); if (b) b.scrollTop = (b.scrollHeight - b.clientHeight) * f; }, frac); await page.waitForTimeout(400); };
    const openAll = async () => {
      for (let i = 0; i < 10; i++) {
        const n = await page.evaluate(() => { const f = document.querySelector('.mo-edit-panel .mo-edit-section.is-shut .mo-edit-section-fold'); if (!f) return 0; f.click(); return 1; });
        if (!n) break;
        await page.waitForTimeout(150);
      }
    };
    const setSlider = async (id, value) => page.evaluate(({ id, value }) => {
      const el = document.querySelector(`.mo-edit-range[data-slider="${id}"]`);
      if (!el) return false;
      el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, { id, value });
    const state = async () => page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.mo-edit-tab')).map((t) => `${t.textContent.trim()}${t.classList.contains('is-on') ? '*' : ''}${t.classList.contains('is-used') ? '•' : ''}`).join(' ');
      const secs = Array.from(document.querySelectorAll('.mo-edit-section')).map((x) => `${x.querySelector('.mo-edit-section-title')?.textContent}${x.querySelector('.mo-edit-section-dot') ? '•' : ''}`).join(', ');
      const changed = Array.from(document.querySelectorAll('.mo-edit-slider.is-changed')).map((x) => `${x.querySelector('.mo-edit-slider-name')?.textContent}=${x.querySelector('.mo-edit-value')?.textContent}`).join(', ');
      const top = Array.from(document.querySelectorAll('.mo-edit-topbar button')).filter((b) => b.offsetParent).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()).join(' | ');
      const presets = document.querySelectorAll('.mo-edit-ptile').length + ' tiles, ' + document.querySelectorAll('.mo-edit-ptile img:not(.mo-hidden)').length + ' pictures, on: ' + Array.from(document.querySelectorAll('.mo-edit-ptile.is-on')).map((t) => t.textContent).join(',');
      const root = document.querySelector('.mo-edit'); const tb = document.querySelector('.mo-edit-topbar'); const pn = document.querySelector('.mo-edit-panel');
      const geo = `win=${window.innerWidth} root=${root?.clientWidth} rootR=${Math.round(root?.getBoundingClientRect().right || 0)} topbar=${tb?.clientWidth}/${tb?.scrollWidth} panelR=${Math.round(pn?.getBoundingClientRect().right || 0)}`;
      return `${geo} tabs=[${tabs}] sections=[${secs}] changed=[${changed}] top=[${top}] presets=[${presets}] hist="${document.querySelector('.mo-edit-histcap')?.textContent}" size="${document.querySelector('.mo-edit-dim')?.textContent}" edited=${!document.querySelector('.mo-edit-edited')?.classList.contains('mo-hidden')}`;
    });
    const shots = async (suffix) => {
      await tool('Edit');
      await scrollPanel(0);
      await page.waitForTimeout(1_500);
      await shot(page, `image-edit${suffix}`);
      await openAll();
      await scrollPanel(0.5);
      await shot(page, `image-edit-colour${suffix}`);
      await scrollPanel(1);
      await shot(page, `image-edit-bottom${suffix}`);
      await scrollPanel(0);
      await tool('Crop And Rotate');
      await shot(page, `image-crop${suffix}`);
      await tool('Remove');
      await shot(page, `image-remove${suffix}`);
      await tool('Enhance');
      await shot(page, `image-enhance${suffix}`);
      await tool('Edit');
    };
    // A few changes, so the marks show: Exposure, Contrast, Highlights, Vibrance, and Clarity (in Effects, closed).
    await tool('Edit');
    for (const [id, v] of [['exposure', 0.35], ['contrast', 0.12], ['highlights', -0.4], ['vibrance', 0.18], ['clarity', 0.3]]) await setSlider(id, v);
    await page.waitForTimeout(800);
    console.log(`[probe] image state: ${await state()}`);
    // Point at a preset: the stage previews it and says so.
    await page.locator('.mo-edit-ptile', { hasText: 'Golden Hour' }).first().hover().catch(() => {});
    await page.waitForTimeout(800);
    console.log(`[probe] image hover chip: "${await page.evaluate(() => document.querySelector('.mo-edit-stagechip--top:not(.mo-hidden)')?.textContent || 'none')}"`);
    await shot(page, 'image-preset-hover');
    await page.mouse.move(700, 300);
    // Split compare and the highlight clipping shown on the photo.
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-edit-segbtn')).find((b) => /Split/.test(b.textContent))?.click());
    await page.evaluate(() => document.querySelector('.mo-edit-clip--hi')?.click());
    await page.waitForTimeout(1_200);
    console.log(`[probe] image split: ${await page.evaluate(() => `bar=${!document.querySelector('.mo-edit-splitbar')?.classList.contains('mo-hidden')} clipLayer=${!document.querySelector('.mo-edit-cliplayer')?.classList.contains('mo-hidden')} hist="${document.querySelector('.mo-edit-histcap')?.textContent}"`)}`);
    await shot(page, 'image-split');
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-edit-segbtn')).find((b) => /Split/.test(b.textContent))?.click());
    await page.evaluate(() => document.querySelector('.mo-edit-clip--hi')?.click());
    // Crop 4:5 and straighten a little with the dial.
    await tool('Crop And Rotate');
    await page.evaluate(() => Array.from(document.querySelectorAll('.mo-edit-chipbtn')).find((b) => b.textContent.trim() === '4:5')?.click());
    await page.waitForTimeout(600);
    const dialBox = await page.locator('.mo-edit-dial').boundingBox().catch(() => null);
    if (dialBox) {
      await page.mouse.move(dialBox.x + dialBox.width / 2, dialBox.y + 10);
      await page.mouse.down(); await page.mouse.move(dialBox.x + dialBox.width / 2 + 25, dialBox.y + 10, { steps: 5 }); await page.mouse.up();
    }
    await page.waitForTimeout(800);
    console.log(`[probe] image crop: size="${await page.evaluate(() => document.querySelector('.mo-edit-cropsize')?.textContent)}" dial="${await page.evaluate(() => document.querySelector('.mo-edit-dial-value')?.textContent)}" ${await state()}`);
    await shot(page, 'image-crop-45');
    // The ⋯ and Save menus.
    await page.evaluate(() => document.querySelector('.mo-edit-topbar [aria-label="More"]')?.click());
    await page.waitForTimeout(400);
    console.log(`[probe] image more menu: ${await page.evaluate(() => Array.from(document.querySelectorAll('.context-menu-item')).map((x) => x.textContent.trim()).join(' | '))}`);
    await shot(page, 'image-more-menu');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('.mo-edit-split-menu')?.click());
    await page.waitForTimeout(400);
    console.log(`[probe] image save menu: ${await page.evaluate(() => Array.from(document.querySelectorAll('.context-menu-item')).map((x) => x.textContent.trim()).join(' | '))}`);
    await page.keyboard.press('Escape');
    // Undo the crop so the rest of the shots show the whole photo.
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    await shots('');
    // Light mode (Appearance's data-px-mode, which the --px-* tokens follow).
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(800);
    await shots('-light');
    // A narrow window.
    await resizeWindow(page, 1000, 760);
    await page.waitForTimeout(1_000);
    await tool('Edit');
    await scrollPanel(0);
    console.log(`[probe] image narrow: ${await state()}`);
    await shot(page, 'image-narrow-light');
    await resizeWindow(page, 860, 700);
    await page.waitForTimeout(1_000);
    console.log(`[probe] image narrower: ${await state()}`);
    await shot(page, 'image-narrower-light');
  } finally {
    await app.close().catch(() => {});
  }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace, clip, clip2 } = await makeTempRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}`);
  if (scenes.includes('image')) {
    const errs = [];
    await scene('image', () => imageScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] image: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('mofilters')) {
    const errs = [];
    await scene('mofilters', () => moFiltersScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] mofilters: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('moart')) {
    const errs = [];
    await scene('moart', () => moArtScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] moart: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('pdf')) {
    const errs = [];
    await scene('pdf', () => pdfScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] pdf: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('mofav')) {
    const errs = [];
    await scene('mofav', () => moFavScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] mofav: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('motrash')) {
    const errs = [];
    await scene('motrash', () => moTrashScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] motrash: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('moaudit')) {
    const errs = [];
    await scene('moaudit', () => moAuditScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] moaudit: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('sidebar')) {
    const errs = [];
    await scene('sidebar', () => sidebarScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] sidebar: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('timelapse')) {
    const errs = [];
    await scene('timelapse', () => timelapseScene(appRoot, clip2, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] timelapse: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('project')) {
    const errs = [];
    await scene('project', () => projectScene(appRoot, clip, clip2, errs));
    if (errs.length) { console.log(`[probe] project: ${errs.length} renderer error(s)`); for (const e of errs) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  _currentApp = app;
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(2_500);

    if (scenes.includes('boot')) await shot(page, 'boot');

    if (scenes.includes('welcome')) {
      await runCommand(page, ['welcome.openWelcome']);
      await page.waitForTimeout(800);
      await shot(page, 'welcome');
    }

    // The chrome at a glance: the empty editor's hints, the settings (gear)
    // menu against its icon, the status bar, and a file's breadcrumbs.
    if (scenes.includes('chrome')) {
      await scene('chrome', async () => {
        for (let i = 0; i < 6; i++) await runCommand(page, ['workbench.action.closeActiveEditor']);
        await page.waitForTimeout(600);
        await shot(page, 'chrome-empty');
        const gear = page.locator('.activity-bar-manage-gear').first();
        await gear.click({ timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(500);
        const gap = await page.evaluate(() => {
          const g = document.querySelector('.activity-bar-manage-gear')?.getBoundingClientRect();
          const m = Array.from(document.querySelectorAll('.context-menu, .parallx-context-menu, [role="menu"]')).map((x) => x.getBoundingClientRect()).find((r) => r.width > 0);
          if (!g || !m) return 'no gear or menu';
          return `gear=${Math.round(g.left)},${Math.round(g.top)} ${Math.round(g.width)}x${Math.round(g.height)} menu=${Math.round(m.left)},${Math.round(m.top)} ${Math.round(m.width)}x${Math.round(m.height)} menuBottom-gearBottom=${Math.round(m.bottom - g.bottom)} menuLeft-gearRight=${Math.round(m.left - g.right)}`;
        });
        console.log(`[probe] gear menu: ${gap}`);
        await shot(page, 'chrome-gear');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const sb = await page.evaluate(() => {
          const bar = document.querySelector('.part-workbench-parts-statusbar');
          if (!bar) return 'no status bar';
          const items = Array.from(bar.querySelectorAll('.statusbar-item-label')).filter((x) => x.offsetParent).map((x) => { const r = x.getBoundingClientRect(); return `"${x.textContent.trim().slice(0, 20)}" h=${Math.round(r.height)} fs=${getComputedStyle(x).fontSize}`; });
          return `bar h=${Math.round(bar.getBoundingClientRect().height)} fs=${getComputedStyle(bar).fontSize}; ${items.join('; ')}`;
        });
        console.log(`[probe] status bar: ${sb}`);
        // A file one folder down, so the path has a folder, a chevron and the file.
        const node = (name) => Array.from(document.querySelectorAll('.tree-node')).find((n) => n.querySelector('.tree-node-label')?.textContent === name);
        await page.evaluate(() => { const n = Array.from(document.querySelectorAll('.tree-node')).find((x) => x.querySelector('.tree-node-label')?.textContent === 'notes'); if (n) n.click(); });
        await page.waitForTimeout(800);
        const opened = await page.evaluate(async () => {
          const row = Array.from(document.querySelectorAll('.tree-node')).find((n) => n.querySelector('.tree-node-label')?.textContent === 'siewert.md');
          if (!row) return 'no siewert.md row';
          row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          return 'ok';
        });
        void node;
        await page.waitForTimeout(1_500);
        // Each crumb's icon, label and chevron: their vertical centres should agree.
        const bc = await page.evaluate(() => {
          const c = document.querySelector('.breadcrumbs-control:not(.hidden)');
          if (!c) return 'no breadcrumbs';
          const r = c.getBoundingClientRect();
          const mid = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.height ? +(b.top + b.height / 2).toFixed(1) : null; };
          const glyph = (el) => { if (!el) return null; const rg = document.createRange(); rg.selectNodeContents(el); const b = rg.getBoundingClientRect(); return b.height ? +(b.top + b.height / 2).toFixed(1) : null; };
          const items = Array.from(c.querySelectorAll('.parallx-breadcrumb-item')).map((it) => {
            const svg = it.querySelector('.breadcrumb-icon svg');
            const sep = it.querySelector('.breadcrumb-separator svg');
            return `${it.querySelector('.breadcrumb-label')?.textContent} icon=${mid(svg)} text=${glyph(it.querySelector('.breadcrumb-label'))} sep=${mid(sep)}`;
          });
          const item = c.querySelector('.parallx-breadcrumb-item');
          return `bar h=${Math.round(r.height)} mid=${(r.top + r.height / 2).toFixed(1)} fs=${item ? getComputedStyle(item).fontSize : '-'}; ${items.join('; ')}`;
        });
        console.log(`[probe] file breadcrumbs (${opened}): ${bc}`);
        await shot(page, 'chrome-file');
        const tbar = await page.evaluate(() => {
          const b = document.querySelector('.titlebar-search-btn');
          const center = document.querySelector('.titlebar-center');
          return `search=${b ? `"${b.title}" ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}` : 'none'} centre="${(center?.textContent || '').trim()}"`;
        });
        console.log(`[probe] title bar: ${tbar}`);
      });
    }
    if (scenes.includes('watermark')) {
      for (let i = 0; i < 4; i++) await runCommand(page, ['workbench.action.closeActiveEditor']);
      await page.waitForTimeout(600);
      const wm = await page.evaluate(() => {
        const el = document.querySelector('.editor-watermark');
        if (!el) return 'no .editor-watermark element';
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return `class="${el.className}" display=${cs.display} opacity=${cs.opacity} rect=${Math.round(r.width)}x${Math.round(r.height)} covered-by=${top ? top.tagName + '.' + top.className : 'none'} text="${(el.textContent || '').trim().slice(0, 40)}"`;
      });
      console.log(`[probe] watermark: ${wm}`);
      await shot(page, 'watermark');
    }

    if (scenes.includes('chat')) {
      const shown = await runCommand(page, ['chat.show']);
      if (!shown) await page.keyboard.press('Control+Shift+i');
      await page.waitForSelector('.parallx-chat-widget', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800);
      await shot(page, 'chat');
    }

    if (scenes.includes('autonomy')) {
      // The autonomy log lives in the bottom panel; its tab is the door.
      await scene('autonomy', async () => {
        const tab = page.locator('[data-part-id="workbench.parts.panel"] :text-is("AUTONOMY LOG"), [data-part-id="workbench.parts.panel"] :text-is("Autonomy Log")').first();
        await tab.click({ timeout: 5_000, force: true });
        await page.waitForTimeout(800);
        await shot(page, 'autonomy');
      });
    }

    if (scenes.includes('dashboard')) {
      const ok = await runCommand(page, ['dashboard.newPage']);
      if (ok) {
        const header = await page.waitForSelector('.dashboard-header__title', { timeout: 15_000 }).catch(() => null);
        console.log(`[probe] dashboard header ${header ? 'mounted' : 'NOT mounted'}`);
        await page.waitForTimeout(1_000);
        await shot(page, 'dashboard');
        // The editor listens for this document event to open its widget picker.
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('parallx.dashboard.addWidget')));
        await page.waitForSelector('.dashboard-picker', { timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(600);
        await shot(page, 'dashboard-picker');
        await page.keyboard.press('Escape');
      } else console.log('[probe] dashboard: no command matched, skipped');
    }

    if (scenes.includes('planner')) {
      await scene('planner', async () => {
        const ok = await runCommand(page, ['planner.open']);
        if (!ok) throw new Error('planner.open not available');
        await page.waitForTimeout(1_200);
        await shot(page, 'planner');
        const tab = page.locator('.planner-pane__tab', { hasText: 'Scheduled' }).first();
        await tab.click({ timeout: 5_000 });
        await page.waitForTimeout(900);
        await shot(page, 'planner-scheduled');
      });
    }

    if (scenes.includes('canvas')) {
      await scene('canvas', async () => {
        const ok = await runCommand(page, ['canvas.newPage']);
        if (!ok) throw new Error('canvas.newPage not available');
        await page.waitForSelector('.canvas-top-ribbon', { timeout: 15_000 });
        await page.waitForTimeout(1_000);
        // Focus the editor first: unfocused typing lands on document.body.
        await page.locator('.canvas-tiptap-editor').first().click({ timeout: 5_000 }).catch(() => {});
        // Type a heading and a few lines so the page looks like a page.
        await page.keyboard.type('Siewert');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Excess losses above a per-occurrence deductible or an aggregate limit.');
        await page.waitForTimeout(1_200);
        await shot(page, 'canvas');
        // Which element paints each horizontal hairline near the tab strip.
        const edges = await page.evaluate(() => {
          const out = [];
          for (const y of [70, 71, 72, 73, 74]) {
            const els = document.elementsFromPoint(600, y).slice(0, 3).map((el) => {
              const cs = getComputedStyle(el);
              return `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}[bb=${cs.borderBottomColor} bt=${cs.borderTopColor} bg=${cs.backgroundColor}]`;
            });
            out.push(`y=${y}: ${els.join(' > ')}`);
          }
          return out.join(' || ');
        });
        console.log(`[probe] canvas edges: ${edges}`);
        // The page menu (⋯) with the font section.
        const menuBtn = page.locator('.canvas-top-ribbon-menu').first();
        if (await menuBtn.count()) {
          const diag = await page.evaluate(() => {
            const btn = document.querySelector('.canvas-top-ribbon-menu');
            if (!btn) return 'no button';
            const r = btn.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return `rect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} top=${top ? top.tagName + '.' + String(top.className).slice(0, 60) : 'none'}`;
          });
          console.log(`[probe] canvas menu button: ${diag}`);
          await menuBtn.click({ timeout: 3_000 });
          await page.waitForSelector('.canvas-page-menu', { timeout: 5_000 });
          await page.waitForTimeout(500);
          await shot(page, 'canvas-page-menu');
          const fontListState = await page.evaluate(() => {
            const list = document.querySelector('.canvas-page-menu-font-list');
            return list ? `hidden=${list.hidden} display=${getComputedStyle(list).display}` : 'no list';
          });
          console.log(`[probe] font list (collapsed): ${fontListState}`);
          // The font row opens the font list inside the menu.
          const fontRow = page.locator('.canvas-page-menu-font-current').first();
          if (await fontRow.count()) {
            await fontRow.click({ timeout: 3_000 });
            await page.waitForTimeout(400);
            await shot(page, 'canvas-page-menu-fonts');
          }
          await page.keyboard.press('Escape');
        }
        // The sidebar's trash popup (empty in a fresh workspace, which is
        // still a state worth seeing).
        const trashBtn = page.locator('.canvas-sidebar-trash-btn').first();
        if (await trashBtn.count()) {
          await runCommand(page, [['workbench.view.show', 'view.canvas']]);
          await page.waitForTimeout(400);
          await trashBtn.click({ timeout: 3_000 });
          await page.waitForSelector('.canvas-trash-panel', { timeout: 5_000 });
          await page.waitForTimeout(400);
          await shot(page, 'canvas-trash');
          await page.keyboard.press('Escape');
        }
      });
    }
    if (scenes.includes('clip')) {
      await scene('clip', async () => {
        // External tools start disabled in a fresh data root; enabling one
        // activates it directly.
        const enabled = await page.evaluate(async () => {
          const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
          if (!svc) return 'no enablement service';
          try { await svc.setEnablement('parallx-community.media-organizer', true); return true; } catch (err) { return String(err && err.message || err); }
        });
        if (enabled !== true) console.log(`[probe] enable media-organizer: ${enabled}`);
        await page.waitForTimeout(3_000);
        const ok = await runCommand(page, [['media-organizer.openClipEditor', clip]]);
        if (!ok) throw new Error('media-organizer.openClipEditor not available (extension not loaded?)');
        await page.waitForSelector('.mo-clip-page', { timeout: 20_000 });
        await page.waitForTimeout(1_500);
        await shot(page, 'clip');
        // Where the stage sits at each shot: it must stay on screen while the
        // controls scroll (blur boxes and text live on the video).
        const stageState = async (label) => {
          const d = await page.evaluate(() => {
            const st = document.querySelector('.mo-clip-stage');
            if (!st) return 'no stage';
            const r = st.getBoundingClientRect();
            return `top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} visible=${r.bottom > 80 && r.top < window.innerHeight - 80}`;
          });
          console.log(`[probe] clip stage @${label}: ${d}`);
        };
        // The inspector's tabs (Trim, Crop, Look, Blur, Text, Audio); 'Export'
        // opens the toolbar's Export menu.
        const openSection = async (title) => {
          if (title === 'Export') {
            const open = await page.evaluate(() => { const b = document.querySelector('.mo-ce-split-menu'); const pop = document.querySelector('.mo-ce-pop'); if (!b || !pop) return false; if (pop.style.display === 'none') b.click(); return true; });
            await page.waitForTimeout(300);
            return open;
          }
          const tab = page.locator(`.mo-ce-tab[title="${title}"]`).first();
          if (!(await tab.count())) { console.log(`[probe] clip: no tab ${title}`); return false; }
          await tab.evaluate((el) => el.click());
          await page.waitForTimeout(300);
          return true;
        };
        const prompts = () => page.evaluate(() => Array.from(document.querySelectorAll('.parallx-notification-prompts-container *, .parallx-notifications-container .parallx-notification-message, .parallx-modal-box')).filter((e) => e.offsetParent && e.children.length === 0 && (e.textContent || '').trim()).map((e) => e.textContent.trim()).join(' | '));
  const closeMenus = async () => page.evaluate(() => {
          const pop = document.querySelector('.mo-ce-pop'); if (pop && pop.style.display !== 'none') document.querySelector('.mo-ce-split-menu')?.click();
          const q = document.querySelector('.mo-ce-queue'); if (q && q.style.display !== 'none') q.querySelector('[title="Close the queue"]')?.click();
        });
        const clickBtn = async (text) => {
          const btn = page.locator('.mo-clip-page button', { hasText: text }).first();
          if (!(await btn.count())) { console.log(`[probe] clip: no button ${text}`); return false; }
          await btn.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
          await page.waitForTimeout(400);
          return true;
        };
        // Trim: split twice, delete the middle segment (a cut), bring it back
        // from the timeline, then undo that.
        await openSection('Trim');
        const focusPage = async () => page.locator('.mo-clip-page').first().focus().catch(() => {});
        const seekTo = async (t) => { await page.evaluate((tt) => { const v = document.querySelector('.mo-clip-page video'); if (v) { v.pause(); v.currentTime = tt; } }, t); await page.waitForTimeout(300); };
        const laneState = () => page.evaluate(() => `blocks=${document.querySelectorAll('.mo-ce-block').length} cuts=[${Array.from(document.querySelectorAll('.mo-ce-dim')).map((d) => d.textContent).join(', ')}] segrows=${document.querySelectorAll('.mo-ce .mo-clip-segrow').length} range=${document.querySelector('.mo-ce-tcfield')?.value}..${document.querySelectorAll('.mo-ce-tcfield')[1]?.value} undo=${!document.querySelector('[title^="Undo"]')?.disabled}`);
        await seekTo(2); await focusPage(); await page.keyboard.press('s');
        await seekTo(4); await focusPage(); await page.keyboard.press('s');
        await page.evaluate(() => document.querySelectorAll('.mo-ce .mo-clip-segrow')[1]?.click());
        await page.waitForTimeout(300); await focusPage(); await page.keyboard.press('Delete');
        await page.waitForTimeout(500);
        console.log(`[probe] clip cut: ${await laneState()}`);
        await shot(page, 'clip-segments'); await stageState('clip-segments');
        await page.evaluate(() => Array.from(document.querySelectorAll('.mo-ce-dim')).find((d) => /Cut/.test(d.textContent))?.click());
        await page.waitForTimeout(500);
        console.log(`[probe] clip brought back: ${await laneState()}`);
        await focusPage(); await page.keyboard.press('Control+z');
        await page.waitForTimeout(600);
        console.log(`[probe] clip undo: ${await laneState()}`);
        const lanes = await page.evaluate(() => `thumbs=${document.querySelectorAll('.mo-ce-thumb').length} wave=${document.querySelector('.mo-ce-wave')?.style.display !== 'none'} ticks=${document.querySelectorAll('.mo-ce-tick').length} status="${document.querySelector('.mo-clip-status')?.textContent || ''}"`);
        console.log(`[probe] clip timeline: ${lanes}`);
        await shot(page, 'clip-split');
        // Blur: one region on the stage.
        if (await openSection('Blur')) {
          await clickBtn('Blur Region');
          await page.evaluate(() => { const v = document.querySelector('.mo-clip-page video'); if (v) v.pause(); });
          await page.waitForTimeout(300);
          const d = await page.evaluate(() => { const b = document.querySelector('.mo-blur-rect'); if (!b) return 'none'; const r = b.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)} t=${document.querySelector('.mo-clip-page video')?.currentTime}`; });
          console.log(`[probe] clip blur rect: ${d}`);
          // Oval shape for the shot.
          await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.mo-clip-page .mo-ce-seg button')).find((x) => x.textContent === 'Oval'); if (b) b.click(); });
          await page.waitForTimeout(300);
          const shapeState = await page.evaluate(() => {
            const active = Array.from(document.querySelectorAll('.mo-clip-page .mo-ce-seg button.mo-active')).map((b) => b.textContent).join('|');
            // The shape lives on the inner fill; the box stays rectangular so
            // its outline and handles are never masked away.
            const b = document.querySelector('.mo-blur-rect .mo-blur-fill');
            const handles = document.querySelectorAll('.mo-blur-rect.mo-active .mo-blur-handle').length;
            return `active=${active} radius=${b ? getComputedStyle(b).borderRadius : 'none'} mask=${b ? (getComputedStyle(b).maskImage || '').slice(0, 40) : ''} handles=${handles}`;
          });
          console.log(`[probe] clip blur shape: ${shapeState}`);
          await shot(page, 'clip-blur'); await stageState('clip-blur');
          // The same frame with the box hidden, for a pixel comparison.
          await page.evaluate(() => { document.querySelector('.mo-blur-layer').style.visibility = 'hidden'; });
          await shot(page, 'clip-blur-ref');
          await page.evaluate(() => { document.querySelector('.mo-blur-layer').style.visibility = ''; });
        }
        // Text: one caption.
        if (await openSection('Text')) {
          await clickBtn('Add Text');
          const capInput = page.locator('.mo-clip-page .mo-ce-textarea').first();
          if (await capInput.count()) { await capInput.fill('Excess of loss, explained\nA second line'); await capInput.dispatchEvent('input'); await page.waitForTimeout(400); }
          // Pause and park the playhead inside the caption's window so the
          // preview on the stage is in the shot.
          await page.evaluate(() => {
            const v = document.querySelector('.mo-clip-page video');
            const textPanel = Array.from(document.querySelectorAll('.mo-ce-panel')).find((x) => (x.querySelector('.mo-ce-panel-title')?.textContent || '') === 'Text');
            const from = textPanel?.querySelector('.mo-ce-timerow .mo-ce-tcfield');
            const parse = (t) => t.split(':').reduce((acc, p) => acc * 60 + parseFloat(p), 0);
            if (v) { v.pause(); if (from) v.currentTime = parse(from.value) + 0.3; }
          });
          await page.waitForTimeout(600);
          await shot(page, 'clip-text'); await stageState('clip-text');
        }
        // Look: a filter must change the preview; Preview Render must produce a
        // real rendered clip over the stage.
        if (await openSection('Look')) {
          const before = await page.evaluate(() => getComputedStyle(document.querySelector('.mo-clip-page video')).filter);
          await page.evaluate(() => { document.querySelector('.mo-ce-look[title="Vivid"]')?.click(); });
          await page.waitForTimeout(400);
          const after = await page.evaluate(() => getComputedStyle(document.querySelector('.mo-clip-page video')).filter);
          console.log(`[probe] clip filter preview: before="${before}" after="${after}"`);
          await shot(page, 'clip-look');
          if (await clickBtn('Preview Render')) {
            const t0 = Date.now();
            let rendered = 'timeout';
            while (Date.now() - t0 < 40_000) {
              const st = await page.evaluate(() => ({
                overlay: !!document.querySelector('.mo-render-preview video'),
                status: document.querySelector('.mo-clip-status')?.textContent || '',
              }));
              if (st.overlay) { rendered = 'overlay video present'; break; }
              if (/fail|error|could not/i.test(st.status)) { rendered = 'status: ' + st.status; break; }
              await page.waitForTimeout(500);
            }
            console.log(`[probe] clip preview render: ${rendered} (${Math.round((Date.now() - t0) / 1000)}s)`);
            await shot(page, 'clip-render');
            await page.evaluate(() => { document.querySelector('.mo-render-preview-bar button')?.click(); });
            await page.waitForTimeout(300);
          }
        }
        // Blur: Follow must track the region across In/Out.
        const trackOn = async () => page.evaluate(() => {
          const chk = document.querySelector('.mo-clip-page #mo-ce-blurtrack');
          if (!chk) return false;
          chk.click();
          return true;
        });
        if (await openSection('Blur') && await trackOn()) {
          const t0 = Date.now();
          let res = 'timeout';
          while (Date.now() - t0 < 60_000) {
            const st = await page.evaluate(() => document.querySelector('.mo-clip-status')?.textContent || '');
            if (/Follow done|failed|error|Low lock|tighten/i.test(st)) { res = st; break; }
            await page.waitForTimeout(500);
          }
          console.log(`[probe] clip blur follow: ${res} (${Math.round((Date.now() - t0) / 1000)}s)`);
          await shot(page, 'clip-follow');
          // Pixelate must preview as a real mosaic (a canvas inside the box).
          const mosaic = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('.mo-clip-page .mo-ce-seg button')).find((b) => b.textContent === 'Pixelate');
            if (!btn) return 'no Pixelate button';
            btn.click();
            const oval = Array.from(document.querySelectorAll('.mo-clip-page .mo-ce-seg button')).find((b) => b.textContent === 'Oval');
            if (oval) oval.click();
            const cv = document.querySelector('.mo-blur-mosaic');
            if (!cv) return 'no mosaic canvas';
            const r = cv.getBoundingClientRect();
            const ctx = cv.getContext('2d'); const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
            let nonBlack = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) nonBlack++;
            return `canvas ${cv.width}x${cv.height} cells, shown ${Math.round(r.width)}x${Math.round(r.height)}px, ${nonBlack}/${cv.width * cv.height} cells carry picture`;
          });
          console.log(`[probe] clip pixelate preview: ${mosaic}`);
          await shot(page, 'clip-pixelate');
        }
        // Crop: on, a 9:16 window, the floating bar on the stage.
        if (await openSection('Crop')) {
          await page.evaluate(() => { const c = document.querySelector('#mo-clip-crop'); if (c && !c.checked) c.click(); });
          await page.waitForTimeout(300);
          await page.evaluate(() => { Array.from(document.querySelectorAll('.mo-ce-float-btn')).find((b) => b.textContent === '9:16')?.click(); });
          await page.waitForTimeout(300);
          await shot(page, 'clip-crop');
        }
        // Audio, then the Export menu (MP4, then GIF with its frames row).
        if (await openSection('Audio')) await shot(page, 'clip-audio'); await stageState('clip-audio');
        if (await openSection('Export')) {
          await shot(page, 'clip-export'); await stageState('clip-export');
          await page.evaluate(() => { Array.from(document.querySelectorAll('.mo-ce-pop .mo-ce-seg button')).find((b) => b.textContent === 'GIF')?.click(); });
          await page.waitForTimeout(2_500);
          await shot(page, 'clip-export-gif');
          await clickBtn('Add to Queue');
          await page.waitForTimeout(800);
        }
        await closeMenus();
        await page.evaluate(() => Array.from(document.querySelectorAll('.mo-ce-toolbar .px-btn')).find((x) => /Queue/.test(x.textContent))?.click());
        await page.waitForTimeout(400);
        await shot(page, 'clip-queue');
        await closeMenus();
        // Text on the video: park inside the text's window, drag it, check it moved.
        const capCheck = await page.evaluate(async () => {
          const v = document.querySelector('.mo-clip-page video');
          v.pause(); v.currentTime = 4.5; // segment 2 starts at 4 → output 2.5, inside 2..5
          await new Promise((r) => setTimeout(r, 500));
          const cap = document.querySelector('.mo-ce-caption');
          if (!cap) return 'no caption on the video';
          const r0 = cap.getBoundingClientRect();
          const lines = cap.querySelectorAll('.mo-ce-caption-line').length;
          const opts = { bubbles: true, clientX: r0.left + r0.width / 2, clientY: r0.top + r0.height / 2, button: 0 };
          cap.dispatchEvent(new MouseEvent('mousedown', opts));
          window.dispatchEvent(new MouseEvent('mousemove', { ...opts, clientX: opts.clientX - 120, clientY: opts.clientY - 80 }));
          window.dispatchEvent(new MouseEvent('mouseup', opts));
          await new Promise((r) => setTimeout(r, 300));
          const cap2 = document.querySelector('.mo-ce-caption');
          const r1 = cap2 ? cap2.getBoundingClientRect() : null;
          return `lines=${lines} moved=${r1 ? Math.round(r1.left - r0.left) + ',' + Math.round(r1.top - r0.top) : 'gone'}`;
        });
        console.log(`[probe] clip text object: ${capCheck}`);
        await shot(page, 'clip-text-moved');
        // The ? sheet.
        await page.locator('.mo-clip-page').first().focus().catch(() => {}); await page.keyboard.press('?');
        await page.waitForTimeout(300); await shot(page, 'clip-keys'); await page.keyboard.press('Escape');
        // Exports through the real pipeline, the save dialog answered with a
        // workspace path: one to the end, one cancelled half way.
        // The renderer's bridge is frozen; the native dialog is answered in
        // the main process instead.
        const stub = await app.evaluate(({ dialog }, ws) => {
          let n = 0;
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${ws}/probe-export-${++n}.mp4` });
          return 'stubbed';
        }, workspace).catch((e) => 'failed: ' + String(e).slice(0, 80));
        console.log(`[probe] clip save dialog: ${stub}`);
        if (stub === 'stubbed') {
          await page.evaluate(() => { const q = Array.from(document.querySelectorAll('.mo-ce-queue .mo-ce-qtext')); void q; });
          // Empty the queue so Export is the single-clip path, pick MP4.
          await page.evaluate(async () => {
            for (let i = 0; i < 5; i++) { const b = document.querySelector('.mo-ce-queue .mo-clip-queue-row [title="More"]'); if (!b) break; b.click(); await new Promise((r) => setTimeout(r, 200)); const rm = Array.from(document.querySelectorAll('.context-menu *')).find((x) => x.textContent.trim() === 'Remove'); rm?.click(); await new Promise((r) => setTimeout(r, 200)); }
            Array.from(document.querySelectorAll('.mo-ce-pop .mo-ce-seg button')).find((b) => b.textContent === 'MP4')?.click();
          });
          await page.waitForTimeout(500);
          const exportBtnSel = '.mo-ce-split .px-btn--primary';
          await page.locator(exportBtnSel).first().evaluate((el) => el.click());
          const t0 = Date.now(); let st = '';
          while (Date.now() - t0 < 60_000) {
            st = await page.evaluate(() => `${document.querySelector('.mo-ce-toast')?.style.display !== 'none' ? 'toast: ' + document.querySelector('.mo-ce-toast-text')?.textContent : ''}|${document.querySelector('.mo-clip-status')?.textContent}`);
            if (/^toast/.test(st) || /failed/i.test(st)) break;
            await page.waitForTimeout(500);
          }
          const f1 = await fs.stat(path.join(workspace, 'probe-export-1.mp4')).then((x) => x.size).catch(() => 0);
          console.log(`[probe] clip export: ${st} · file ${f1} bytes (${Math.round((Date.now() - t0) / 1000)}s)`);
          await shot(page, 'clip-exported');
          // Second export, cancelled on its first progress.
          await page.locator(exportBtnSel).first().evaluate((el) => el.click());
          let sawBusy = false;
          for (let i = 0; i < 100; i++) {
            const busy = await page.evaluate((sel) => document.querySelector(sel)?.classList.contains('mo-ce-busy'), exportBtnSel);
            if (busy) { sawBusy = true; await page.locator(exportBtnSel).first().evaluate((el) => el.click()); break; }
            await page.waitForTimeout(50);
          }
          await page.waitForTimeout(3_000);
          const after = await page.evaluate((sel) => `${document.querySelector('.mo-clip-status')?.textContent} · button "${document.querySelector(sel)?.textContent}"`, exportBtnSel);
          const f2 = await fs.stat(path.join(workspace, 'probe-export-2.mp4')).then(() => 'left behind').catch(() => 'removed');
          console.log(`[probe] clip cancel: saw progress=${sawBusy} · ${after} · partial file ${f2}`);
        }
        // A narrow pane: the inspector is a sheet over the timeline.
        await page.setViewportSize({ width: 820, height: 900 }).catch(() => {});
        await page.waitForTimeout(600);
        await shot(page, 'clip-narrow');
        await page.evaluate(() => document.querySelector('.mo-ce-stagecol .mo-ce-tab[title="Text"]')?.click());
        await page.waitForTimeout(500);
        await shot(page, 'clip-narrow-sheet');
        await page.setViewportSize({ width: 620, height: 900 }).catch(() => {});
        await page.waitForTimeout(600);
        await shot(page, 'clip-tiny');
        await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
        await page.waitForTimeout(400);
        const summary = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('.mo-ce-panel, .mo-ce-popgroup')).map((a) => {
            const t = a.querySelector('.mo-ce-panel-title')?.textContent || '';
            const s = a.querySelector('.mo-ce-sum')?.textContent || '';
            return `${t}${s ? ' [' + s + ']' : ''}`;
          });
          const segs = document.querySelectorAll('.mo-clip-segrow').length;
          const blurs = document.querySelectorAll('.mo-blur-rect').length;
          const caps = document.querySelectorAll('.mo-ce-caption').length;
          const status = document.querySelector('.mo-clip-status')?.textContent || '';
          const layer = document.querySelector('.mo-caption-layer');
          const textPanel = Array.from(document.querySelectorAll('.mo-ce-panel')).find((x) => (x.querySelector('.mo-ce-panel-title')?.textContent || '') === 'Text');
          const nums = Array.from(textPanel ? textPanel.querySelectorAll('.mo-ce-timerow .mo-ce-tcfield') : []).map((i) => i.value).join('..') || 'none';
          const txt = document.querySelector('.mo-ce-textarea')?.value || '';
          const vt = document.querySelector('.mo-clip-page video')?.currentTime;
          const capDiag = `layer=${layer ? getComputedStyle(layer).display + '/' + layer.children.length : 'none'} window=${nums} text="${txt}" vt=${vt}`;
          return `sections=${rows.join(' | ')} segrows=${segs} blurrects=${blurs} captions=${caps} ${capDiag} status="${status}"`;
        });
        console.log(`[probe] clip: ${summary}`);
        // Close the editor tab so later scenes start clean.
        await page.locator('.mo-clip-page .mo-modal-close').first().evaluate((el) => el.click()).catch(() => {});
        await page.waitForTimeout(300);
      });
    }
    if (scenes.includes('settings')) {
      const ok = await runCommand(page, ['settings.open']);
      if (ok) { await page.waitForTimeout(1_000); await shot(page, 'settings'); await closeSettings(page); }
      else console.log('[probe] settings: no command matched, skipped');
    }

    if (scenes.includes('appearance')) {
      await scene('appearance', async () => {
        const ok = await runCommand(page, ['settings.openAppearance']);
        if (!ok) throw new Error('settings.openAppearance not available');
        await page.waitForSelector('.px-appearance', { timeout: 10_000 });
        await page.waitForTimeout(800);
        await shot(page, 'appearance');
        await closeSettings(page);
      });
    }

  } finally {
    if (errors.length) {
      console.log(`[probe] ${errors.length} uncaught renderer error(s):`);
      for (const e of errors) console.log(`  ${e}`);
    }
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
