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
const ALL_SCENES = ['boot', 'welcome', 'watermark', 'chat', 'autonomy', 'dashboard', 'planner', 'canvas', 'clip', 'settings', 'appearance'];
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
  return { appRoot, workspace, clip };
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
      if (!svc?.executeCommand) return false;
      try { await svc.executeCommand(commandId, ...args); return true; } catch { return false; }
    }, { commandId: id, args });
    if (ok) return id;
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
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`[probe] ${name} -> ${file}`);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace, clip } = await makeTempRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}`);

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
        const openSection = async (title) => {
          const head = page.locator('.mo-clip-acc-head', { has: page.locator('.mo-clip-acc-title', { hasText: title }) }).first();
          if (!(await head.count())) { console.log(`[probe] clip: no section ${title}`); return false; }
          const open = await head.evaluate((el) => el.parentElement.classList.contains('mo-open'));
          if (!open) await head.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
          await page.waitForTimeout(300);
          return true;
        };
        const clickBtn = async (text) => {
          const btn = page.locator('.mo-clip-page button', { hasText: text }).first();
          if (!(await btn.count())) { console.log(`[probe] clip: no button ${text}`); return false; }
          await btn.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
          await page.waitForTimeout(400);
          return true;
        };
        // Trim: two segments from the one range.
        await openSection('Trim');
        await clickBtn('Add Segment');
        // Second range via the I/O hotkeys at a later playhead.
        await page.locator('.mo-clip-page').first().focus().catch(() => {});
        await page.evaluate(() => { const v = document.querySelector('.mo-clip-page video'); if (v) v.currentTime = 3; });
        await page.waitForTimeout(300); await page.keyboard.press('i');
        await page.evaluate(() => { const v = document.querySelector('.mo-clip-page video'); if (v) v.currentTime = 5; });
        await page.waitForTimeout(300); await page.keyboard.press('o');
        await page.waitForTimeout(300);
        await clickBtn('Add Segment');
        await shot(page, 'clip-segments'); await stageState('clip-segments');
        // Blur: one region on the stage.
        if (await openSection('Blur')) {
          await clickBtn('Blur Region');
          await page.evaluate(() => { const v = document.querySelector('.mo-clip-page video'); if (v) v.pause(); });
          await page.waitForTimeout(300);
          const d = await page.evaluate(() => { const b = document.querySelector('.mo-blur-rect'); if (!b) return 'none'; const r = b.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)} t=${document.querySelector('.mo-clip-page video')?.currentTime}`; });
          console.log(`[probe] clip blur rect: ${d}`);
          // Oval shape for the shot.
          await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.mo-clip-page .mo-clip-mode-toggle button')).find((x) => x.textContent === 'Oval'); if (b) b.click(); });
          await page.waitForTimeout(300);
          const shapeState = await page.evaluate(() => {
            const active = Array.from(document.querySelectorAll('.mo-clip-page .mo-clip-mode-toggle button.mo-active')).map((b) => b.textContent).join('|');
            const b = document.querySelector('.mo-blur-rect');
            return `active=${active} radius=${b ? getComputedStyle(b).borderRadius : 'none'} mask=${b ? (getComputedStyle(b).maskImage || '').slice(0, 40) : ''}`;
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
          await clickBtn('+ Text');
          const capInput = page.locator('.mo-clip-page .mo-clip-input--grow').first();
          if (await capInput.count()) { await capInput.fill('Excess of loss, explained'); await capInput.dispatchEvent('input'); await page.waitForTimeout(400); }
          // Pause and park the playhead inside the caption's window so the
          // preview on the stage is in the shot.
          await page.evaluate(() => {
            const v = document.querySelector('.mo-clip-page video');
            const sec = Array.from(document.querySelectorAll('.mo-clip-acc')).find((a) => (a.querySelector('.mo-clip-acc-title')?.textContent || '') === 'Text');
            const from = sec?.querySelector('input[type="number"]');
            if (v) { v.pause(); if (from) v.currentTime = parseFloat(from.value) + 0.3; }
          });
          await page.waitForTimeout(600);
          await shot(page, 'clip-text'); await stageState('clip-text');
        }
        // Look: a filter must change the preview; Preview Render must produce a
        // real rendered clip over the stage.
        if (await openSection('Look')) {
          const before = await page.evaluate(() => getComputedStyle(document.querySelector('.mo-clip-page video')).filter);
          await page.evaluate(() => {
            const sel = Array.from(document.querySelectorAll('.mo-clip-page select')).find((s) => Array.from(s.options).some((o) => o.value === 'vivid'));
            if (sel) { sel.value = 'vivid'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
          });
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
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
          }
        }
        // Blur: Follow must track the region across In/Out.
        const trackOn = async () => page.evaluate(() => {
          const chk = document.querySelector('.mo-clip-page .mo-clip-track input');
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
            const btn = Array.from(document.querySelectorAll('.mo-clip-page .mo-clip-mode-toggle button')).find((b) => b.textContent === 'Pixelate');
            if (!btn) return 'no Pixelate button';
            btn.click();
            const oval = Array.from(document.querySelectorAll('.mo-clip-page .mo-clip-mode-toggle button')).find((b) => b.textContent === 'Oval');
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
        // Audio & Finish, then Export, so the whole program is visible.
        if (await openSection('Audio')) await shot(page, 'clip-audio'); await stageState('clip-audio');
        if (await openSection('Export')) await shot(page, 'clip-export'); await stageState('clip-export');
        const summary = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('.mo-clip-acc')).map((a) => {
            const t = a.querySelector('.mo-clip-acc-title')?.textContent || '';
            const s = a.querySelector('.mo-clip-acc-sum')?.textContent || '';
            return `${t}${s ? ' [' + s + ']' : ''}`;
          });
          const segs = document.querySelectorAll('.mo-clip-segrow').length;
          const blurs = document.querySelectorAll('.mo-blur-rect').length;
          const caps = document.querySelectorAll('.mo-caption').length;
          const status = document.querySelector('.mo-clip-status')?.textContent || '';
          const layer = document.querySelector('.mo-caption-layer');
          const capRow = Array.from(document.querySelectorAll('.mo-clip-acc')).find((a) => (a.querySelector('.mo-clip-acc-title')?.textContent || '') === 'Text')?.querySelector('.mo-clip-segrow--stack');
          const nums = capRow ? Array.from(capRow.querySelectorAll('input[type="number"]')).map((i) => i.value).join('..') : 'none';
          const txt = capRow ? (capRow.querySelector('input[type="text"]')?.value || '') : '';
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
