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

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-probe-shots'));
const requested = process.argv.slice(3);
const ALL_SCENES = ['boot', 'welcome', 'watermark', 'chat', 'autonomy', 'dashboard', 'planner', 'canvas', 'clip', 'project', 'timelapse', 'settings', 'appearance'];
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
  const file = path.join(outDir, `${name}.png`);
  // A still page in the hidden window sometimes makes no new frame; a missed
  // shot is reported, not a reason to stop the scene.
  const took = await page.screenshot({ path: file, timeout: 15_000 }).then(() => true, (e) => { console.log(`[probe] ${name}: no shot (${String(e).split('\n')[0]})`); return false; });
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

async function launchApp(appRoot, errors) {
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
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
    await page.locator('.activity-bar-item[aria-label="Media Organizer"]').first().click({ timeout: 3_000 }).catch((e) => console.log(`[probe] project: no Media Organizer view button (${String(e).split('\n')[0]})`));
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

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace, clip, clip2 } = await makeTempRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}`);
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
