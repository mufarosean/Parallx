// practice-probe.mjs: Practice (M104) in the real app, never on screen.
//
// Seeds a throwaway workspace with four real images (the Tag Review seed,
// which also gives a PATTERNS tag on fractal.jpg), launches the app HIDDEN
// (PARALLX_HIDDEN_PROBE), and drives the practice surfaces:
//   gate off: no Practice section, no Daily Study card, the command is refused
//   gate on:  the section and card appear without a reload
//   setup:    pool count, tag suggestions (a popup above everything), sizing
//             chips and the summary sentence, Start
//   player:   picture, clock, counter, strip, skip, pause, stop, end screen
//   daily:    one picture, stop, the card reads "Drawn today"
//   detail:   the Practice history strip
// After the app closes it reads the practice tables back.
//
// Usage: node tests/probes/practice-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/).
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-practice-shots'));
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(__dirname, 'tag-review-seed.cjs');
const VERIFY = path.join(__dirname, 'practice-verify.cjs');
const OFFLINE_SEED = path.join(__dirname, 'practice-offline-seed.cjs');
const BOXING = path.join(PROJECT_ROOT, 'data', 'dashboard-assets', 'aa21bc3e-d260-41ac-8bcf-ab5efe10d0cb.jpg');
let APP = null;

function nodeEnv() { return { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; }
function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1';
  env.PARALLX_RENDERER_PORT = '0';
  env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot;
  env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
const dbPaths = (ws) => ['media-organizer', 'parallx-community.media-organizer']
  .map((id) => path.join(ws, '.parallx', 'extensions', id, 'data.db'));

async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-practice-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-practice-ws-${stamp}`);
  const photos = path.join(workspace, 'photos');
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(photos, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.copyFile(BOXING, path.join(photos, 'boxing.jpg'));
  const gen = [['card.jpg', 'testsrc2=size=2400x1600', 2400, 1600], ['fractal.jpg', 'mandelbrot=size=1800x1200', 1800, 1200], ['bars.jpg', 'smptehdbars=size=1920x1080', 1920, 1080]];
  for (const [name, src] of gen) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)], { windowsHide: true });
    if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${String(r.stderr).slice(0, 200)}`);
  }
  const spec = [{ basename: 'boxing.jpg', width: 564, height: 846 }, ...gen.map(([basename, , width, height]) => ({ basename, width, height }))];
  const specPath = path.join(appRoot, 'spec.json');
  await fs.writeFile(specPath, JSON.stringify(spec));
  for (const db of dbPaths(workspace)) {
    const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
    const o = spawnSync(ELECTRON, [OFFLINE_SEED, db], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
    if (o.status !== 0) throw new Error(`offline seed failed: ${o.stderr || o.stdout}`);
  }
  // A 30 s painting-session stand-in, HEVC when the encoder is there (the phone case).
  const enc = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true });
  const hevc = /libx265/.test(String(enc.stdout));
  const videoPath = path.join(photos, 'session.mp4');
  const v = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '30',
    '-c:v', hevc ? 'libx265' : 'libx264', '-preset', 'ultrafast', '-tag:v', hevc ? 'hvc1' : 'avc1', '-pix_fmt', 'yuv420p', videoPath], { windowsHide: true });
  if (v.status !== 0) throw new Error(`ffmpeg video: ${String(v.stderr).slice(0, 200)}`);
  console.log(`[probe] test video ${hevc ? 'HEVC' : 'H.264 (no libx265)'} at ${videoPath}`);
  return { appRoot, workspace, videoPath, hevc };
}

async function runCommand(page, id, ...args) {
  return page.evaluate(async ({ commandId, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    if (!svc?.executeCommand) return 'no command service';
    try { await svc.executeCommand(commandId, ...args); return 'ok'; } catch (e) { return 'failed: ' + (e && e.message); }
  }, { commandId: id, args });
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 8_000 });
  } catch {
    const out = await APP.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      if (!w) return null;
      const img = await w.webContents.capturePage();
      return { b64: img.toPNG().toString('base64') };
    });
    if (!out || !out.b64) { console.log(`[probe] ${name}: no frame`); return; }
    await fs.writeFile(file, Buffer.from(out.b64, 'base64'));
  }
  console.log(`[probe] ${name} -> ${file}`);
}

const log = (label, value) => console.log(`[probe] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

async function practiceSidebar(page) {
  return page.evaluate(() => {
    const sec = document.querySelector('[data-mo-section="drawing-and-painting"]');
    if (!sec) return 'no section';
    const items = Array.from(sec.querySelectorAll('.mo-sidebar-item-label')).map((l) => l.textContent);
    return `display=${getComputedStyle(sec).display} items=${items.join(' | ')}`;
  });
}
async function dailyCard(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.mo-daily');
    if (!el) return 'no card';
    const cs = getComputedStyle(el);
    const img = el.querySelector('img');
    return `display=${cs.display} bg=${cs.backgroundColor} border=${cs.borderTopColor} sub="${el.querySelector('.mo-daily-sub')?.textContent}" button="${el.querySelector('button')?.textContent}" thumb=${img && img.naturalWidth ? img.naturalWidth + 'px' : 'none'}`;
  });
}
async function playerState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.mo-practice');
    if (!root) return 'no player';
    const img = root.querySelector('.mo-practice-img');
    const end = root.querySelector('.mo-practice-end');
    const pause = root.querySelector('.mo-practice-btn[aria-label="Pause"], .mo-practice-btn[aria-label="Resume"]');
    return {
      clock: root.querySelector('.mo-practice-clock')?.textContent,
      counter: root.querySelector('.mo-practice-counter')?.textContent,
      img: img ? `${img.naturalWidth}x${img.naturalHeight} mirror=${img.classList.contains('is-mirror')} grey=${img.classList.contains('is-grey')}` : 'none',
      strip: root.querySelectorAll('.mo-practice-strip-item').length,
      current: Array.from(root.querySelectorAll('.mo-practice-strip-item')).findIndex((c) => c.classList.contains('is-current')),
      pause: pause ? pause.getAttribute('aria-label') : 'none',
      controls: Array.from(root.querySelectorAll('.mo-practice-controls .mo-practice-btn')).map((b) => b.getAttribute('aria-label')).join('/'),
      hudBg: getComputedStyle(root.querySelector('.mo-practice-hud')).backgroundColor,
      end: end && !end.classList.contains('mo-hidden')
        ? `${end.querySelector('.mo-practice-end-title')?.textContent} | ${end.querySelector('.mo-practice-end-sub')?.textContent} | items=${end.querySelectorAll('.mo-practice-end-item').length} | buttons=${Array.from(end.querySelectorAll('button')).map((b) => b.textContent).join('/')}`
        : 'hidden',
    };
  });
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace, videoPath, hevc } = await makeRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}`);
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  APP = app;
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
    page.on('console', (m) => { if (m.text().includes('startup sweep')) console.log(`[probe] ${m.text()}`); });
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => {
      await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.media-organizer', true);
    });
    await page.waitForTimeout(3_000);

    // Sidebar and Home with the gate OFF.
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.activity-bar-item')).find((b) => Array.from(b.attributes).some((a) => /media.?organizer/i.test(a.value)));
      if (btn) btn.click();
    });
    await page.waitForSelector('.mo-sidebar-item', { timeout: 10_000 });
    await page.waitForTimeout(800);
    log('sidebar gate off', await practiceSidebar(page));
    log('folders', await page.evaluate(() => Array.from(document.querySelectorAll('[data-mo-section="folders"] .mo-sidebar-item')).map((i) => `${i.querySelector('.mo-sidebar-item-label')?.textContent}:${i.querySelector('.mo-sidebar-item-count')?.textContent || ''}${i.classList.contains('is-offline') ? '(offline)' : ''}`).join(' | ')));
    log('openHome', await runCommand(page, 'media-organizer.openHome'));
    await page.waitForSelector('.mo-home', { timeout: 15_000 });
    await page.waitForTimeout(1_500);
    log('daily card gate off', await dailyCard(page));
    log('practiceSession gate off', await runCommand(page, 'media-organizer.practiceSession'));
    await page.waitForTimeout(500);
    log('setup tab gate off', await page.evaluate(() => document.querySelector('.mo-practice-setup') ? 'opened (WRONG)' : 'not opened'));
    await shot(page, 'practice-gate-off');

    // Turn the gate on through the configuration service, the path Settings uses.
    const turnedOn = await page.evaluate(async () => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IConfigurationService' });
      if (!svc?.getConfiguration) return 'no configuration service';
      try { await svc.getConfiguration('mediaOrganizer').update('enableArtTools', true); } catch (e) { return 'update failed: ' + (e && e.message); }
      return 'value=' + svc.getConfiguration('mediaOrganizer').get('enableArtTools');
    });
    log('gate on', turnedOn);
    await page.waitForTimeout(1_200);
    log('sidebar gate on', await practiceSidebar(page));
    log('exists checks', await page.evaluate(async () => `root=${await window.parallxElectron.fs.exists('Q:\parallx-offline-root')} file=${await window.parallxElectron.fs.exists('Q:\parallx-offline-root\gone.jpg')}`));
    log('folders after gate on', await page.evaluate(() => Array.from(document.querySelectorAll('[data-mo-section="folders"] .mo-sidebar-item')).map((i) => `${i.querySelector('.mo-sidebar-item-label')?.textContent}:${i.querySelector('.mo-sidebar-item-count')?.textContent || ''}${i.classList.contains('is-offline') ? '(offline)' : ''}`).join(' | ')));
    await page.waitForFunction(() => document.querySelector('.mo-daily') && getComputedStyle(document.querySelector('.mo-daily')).display !== 'none', null, { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    log('daily card gate on', await dailyCard(page));
    await shot(page, 'practice-home-daily');

    // Setup tab.
    log('practiceSession', await runCommand(page, 'media-organizer.practiceSession'));
    await page.waitForSelector('.mo-practice-setup', { timeout: 10_000 });
    await page.waitForFunction(() => /picture/.test(document.querySelector('.mo-practice-poolcount')?.textContent || ''), null, { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800);
    log('setup', await page.evaluate(() => {
      const root = document.querySelector('.mo-practice-setup');
      return {
        labels: Array.from(root.querySelectorAll('.mo-practice-label')).map((l) => l.textContent).filter(Boolean).join(' | '),
        chips: Array.from(root.querySelectorAll('.mo-home-chip')).map((c) => c.textContent + (c.classList.contains('active') ? '*' : '')).join(' | '),
        dropdowns: root.querySelectorAll('.mo-dropdown').length,
        nativeSelects: root.querySelectorAll('select').length,
        poolCount: root.querySelector('.mo-practice-poolcount')?.textContent,
        summary: root.querySelector('.mo-practice-summary')?.textContent,
        neglected: root.querySelectorAll('.mo-practice-thumb').length,
        neglectedCaptions: Array.from(root.querySelectorAll('.mo-practice-thumb span')).map((s) => s.textContent).join(' | '),
        sessions: root.querySelector('.mo-practice-list')?.textContent,
      };
    }));
    await shot(page, 'practice-setup');

    // Pool: Tag with the suggestion popup.
    await page.locator('.mo-practice-setup .mo-dropdown').nth(1).locator('button, .mo-dropdown__button').first().click();
    await page.waitForTimeout(300);
    await page.locator('.mo-dropdown__item', { hasText: 'Tag' }).first().click();
    await page.waitForSelector('.mo-practice-pooldetail input', { timeout: 5_000 });
    await page.locator('.mo-practice-pooldetail input').fill('PAT');
    await page.waitForSelector('.mo-practice-suggest', { timeout: 5_000 });
    log('tag suggest', await page.evaluate(() => {
      const pop = document.querySelector('.mo-practice-suggest');
      const cs = getComputedStyle(pop);
      return `z=${cs.zIndex} position=${cs.position} bg=${cs.backgroundColor} items=${Array.from(pop.children).map((c) => c.textContent).join(' | ')}`;
    }));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^1 picture$/.test(document.querySelector('.mo-practice-poolcount')?.textContent || ''), null, { timeout: 8_000 }).catch(() => {});
    log('tag pool', await page.evaluate(() => `input="${document.querySelector('.mo-practice-pooldetail input')?.value}" count="${document.querySelector('.mo-practice-poolcount')?.textContent}" popup=${document.querySelector('.mo-practice-suggest') ? 'still open' : 'closed'}`));

    // Sizing: Total Time reads back as the spec sentence; then Pictures And Time, 3 × 30 s.
    await page.locator('.mo-practice-setup .mo-home-chip', { hasText: 'Total Time' }).click();
    await page.waitForTimeout(200);
    log('summary total', await page.evaluate(() => document.querySelector('.mo-practice-summary')?.textContent));
    await page.locator('.mo-practice-setup .mo-home-chip', { hasText: 'Pictures And Time' }).click();
    await page.locator('.mo-practice-setup input[type="number"]').fill('3');
    await page.locator('.mo-practice-setup input[type="number"]').dispatchEvent('input');
    // Time Per Picture: the last dropdown in the form.
    const perDrop = page.locator('.mo-practice-form .mo-dropdown').last();
    await perDrop.locator('button, .mo-dropdown__button').first().click();
    await page.waitForTimeout(300);
    await page.locator('.mo-dropdown__item', { hasText: /^30 s$/ }).first().click();
    await page.waitForTimeout(200);
    log('summary count', await page.evaluate(() => document.querySelector('.mo-practice-summary')?.textContent));
    // Back to Everything so the 3-picture run has 4 candidates.
    await page.locator('.mo-practice-setup .mo-dropdown').nth(1).locator('button, .mo-dropdown__button').first().click();
    await page.waitForTimeout(300);
    await page.locator('.mo-dropdown__item', { hasText: /^Everything$/ }).first().click();
    await page.waitForFunction(() => /^4 pictures$/.test(document.querySelector('.mo-practice-poolcount')?.textContent || ''), null, { timeout: 8_000 }).catch(() => {});
    await page.locator('.mo-practice-setup .mo-practice-start').click();

    // Player.
    await page.waitForSelector('.mo-practice-img', { timeout: 10_000 });
    await page.waitForFunction(() => (document.querySelector('.mo-practice-img')?.naturalWidth || 0) > 0, null, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(600);
    log('player open', await playerState(page));
    await shot(page, 'practice-player');
    await page.locator('.mo-practice').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    log('player after skip', await playerState(page));
    await page.keyboard.press(' ');
    await page.waitForTimeout(300);
    const pausedClock = await page.evaluate(() => document.querySelector('.mo-practice-clock')?.textContent);
    await page.waitForTimeout(1_500);
    log('player paused', `${await page.evaluate(() => document.querySelector('.mo-practice-btn[aria-label="Resume"]') ? 'Resume shown' : 'no Resume')} clock ${pausedClock} -> ${await page.evaluate(() => document.querySelector('.mo-practice-clock')?.textContent)}`);
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    // The controls fade after 2.5 s without the mouse; a person moves it first.
    await page.locator('.mo-practice').first().hover();
    await page.locator('.mo-practice-btn[aria-label="Stop"]').click();
    await page.waitForSelector('.mo-practice-end:not(.mo-hidden)', { timeout: 10_000 });
    await page.waitForTimeout(1_200);
    log('player end', await playerState(page));
    await shot(page, 'practice-end');

    // Daily Study.
    log('dailyStudy', await runCommand(page, 'media-organizer.dailyStudy'));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.mo-practice')).some((r) => r.querySelector('.mo-practice-counter')?.textContent === '1 / 1'), null, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const dailyRoot = page.locator('.mo-practice', { has: page.locator('.mo-practice-counter', { hasText: '1 / 1' }) }).first();
    log('daily player', await dailyRoot.evaluate((root) => `clock=${root.querySelector('.mo-practice-clock')?.textContent} counter=${root.querySelector('.mo-practice-counter')?.textContent} img=${root.querySelector('.mo-practice-img')?.naturalWidth || 0}px`));
    await page.waitForTimeout(1_500);
    await dailyRoot.hover();
    await page.waitForTimeout(200);
    await dailyRoot.locator('.mo-practice-btn[aria-label="Stop"]').click();
    await page.waitForTimeout(1_200);
    log('daily end', await dailyRoot.evaluate((root) => `${root.querySelector('.mo-practice-end-title')?.textContent} | ${root.querySelector('.mo-practice-end-sub')?.textContent} | buttons=${Array.from(root.querySelectorAll('.mo-practice-end button')).map((b) => b.textContent).join('/')}`));
    log('openHome again', await runCommand(page, 'media-organizer.openHome'));
    await page.waitForTimeout(1_500);
    log('daily card after', await dailyCard(page));
    await shot(page, 'practice-home-after');

    // Detail of the daily picture (it has been drawn): the history strip and its buttons.
    await page.locator('.mo-daily img').click();
    await page.waitForSelector('.mo-detail-main', { timeout: 10_000 });
    await page.waitForSelector('.mo-practice-history-row', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    log('detail strip', await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.mo-detail-main .mo-similar-title')).map((t) => t.textContent);
      const rows = Array.from(document.querySelectorAll('.mo-practice-history-row')).map((r) => r.textContent);
      const btns = Array.from(document.querySelectorAll('.mo-practice-history-actions button')).map((b) => b.textContent);
      return `titles=${titles.join(' | ')} rows=${rows.join(' | ') || '(none)'} buttons=${btns.join('/')}`;
    }));
    await shot(page, 'practice-detail');

    // Plan Painting from the strip: the editor renders the recipe on the GPU.
    await page.locator('.mo-practice-history-actions button', { hasText: 'Plan Painting' }).click();
    await page.waitForSelector('.mo-plan-canvas', { timeout: 15_000 });
    await page.waitForFunction(() => (document.querySelector('.mo-plan-canvas')?.width || 0) > 10, null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    const planState = () => page.evaluate(() => {
      const root = document.querySelector('.mo-plan');
      const cv = root.querySelector('.mo-plan-canvas');
      const ov = root.querySelector('.mo-plan-overlay');
      let overlayPixels = 0;
      try { const d = ov.getContext('2d').getImageData(0, 0, ov.width, ov.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) overlayPixels++; } catch { /* none */ }
      let sum = 0; let total = 0;
      try { const c = document.createElement('canvas'); c.width = 16; c.height = 16; const x = c.getContext('2d'); x.drawImage(cv, 0, 0, 16, 16); const d = x.getImageData(0, 0, 16, 16).data; for (let i = 0; i < d.length; i += 4) { total++; sum += d[i] + d[i + 1] + d[i + 2]; } } catch { /* none */ }
      return {
        title: root.querySelector('.mo-plan-title')?.textContent, size: root.querySelector('.mo-plan-topbar-left .mo-practice-dim')?.textContent,
        tools: root.querySelectorAll('.mo-plan-tool').length, activeTool: root.querySelector('.mo-plan-tool.is-on')?.getAttribute('aria-label'),
        canvas: `${cv.width}x${cv.height} css=${cv.style.width}`, brightness: total ? Math.round(sum / total / 3) : 'n/a',
        sliders: root.querySelectorAll('.mo-plan-panel input[type="range"]').length,
        cropbox: root.querySelector('.mo-plan-cropbox')?.classList.contains('mo-hidden') ? 'hidden' : 'shown',
        overlayPixels, variants: root.querySelectorAll('.mo-plan-variant').length, swatches: root.querySelectorAll('.mo-plan-swatch').length,
        nativeSelects: root.querySelectorAll('select').length,
      };
    });
    log('plan open', await planState());
    await shot(page, 'plan-light');
    const before = await planState();
    await page.locator('.mo-plan-panel input[type="range"]').first().evaluate((el) => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction((b) => { const cv = document.querySelector('.mo-plan-canvas'); const c = document.createElement('canvas'); c.width = 16; c.height = 16; const x = c.getContext('2d'); x.drawImage(cv, 0, 0, 16, 16); const d = x.getImageData(0, 0, 16, 16).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; return Math.round(sum / 256 / 3) > b; }, before.brightness, { timeout: 10_000 }).catch(() => {});
    log('plan exposure', `brightness ${before.brightness} -> ${(await planState()).brightness}`);
    await page.locator('.mo-plan-tool[aria-label="Crop"]').click();
    await page.waitForFunction(() => !document.querySelector('.mo-plan-cropbox').classList.contains('mo-hidden'), null, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);
    log('plan crop', await planState());
    await shot(page, 'plan-crop');
    await page.locator('.mo-plan-tool[aria-label="Composition"]').click();
    await page.waitForTimeout(300);
    await page.locator('.mo-plan-panel .mo-practice-check', { hasText: 'Grid In Inches' }).locator('input').check();
    await page.waitForFunction(() => { const ov = document.querySelector('.mo-plan-overlay'); const d = ov.getContext('2d').getImageData(0, 0, ov.width, ov.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true; return false; }, null, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);
    log('plan grid', await planState());
    await shot(page, 'plan-grid');
    await page.locator('.mo-plan-tool[aria-label="Palette"]').click();
    await page.waitForTimeout(300);
    await page.locator('.mo-plan-panel button', { hasText: 'Pull From Picture' }).click();
    await page.waitForTimeout(800);
    log('plan palette', await planState());
    await page.locator('.mo-plan-variant-actions button', { hasText: 'Add Variation' }).click();
    await page.waitForTimeout(800);
    log('plan variants', await planState());
    await page.locator('.mo-plan-topbar-right button', { hasText: 'Export Plan' }).click();
    await page.waitForTimeout(7_000);
    await page.locator('.mo-plan-tool[aria-label="Process"]').click();
    await page.waitForTimeout(800);
    log('plan shelf', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-plan-shelf-item span')).map((s) => s.textContent).join(' | ') || '(empty)'));
    await shot(page, 'plan-export');
    log('paintingPlans', await runCommand(page, 'media-organizer.paintingPlans'));
    await page.waitForSelector('.mo-plans-card', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    log('plans list', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-plans-card')).map((c) => c.textContent).join(' | ') || '(none)'));

    // Part C: the video comes in through a rescan, plays from a preview copy
    // when it is HEVC, and the clip editor offers timelapse speeds and Fit To Length.
    log('rescan', await runCommand(page, 'media-organizer.rescan'));
    await page.waitForTimeout(10_000);
    await runCommand(page, 'media-organizer.openHome');
    await page.waitForTimeout(1_200);
    await page.locator('.mo-home-chip', { hasText: 'Videos' }).first().click();
    await page.waitForSelector('.mo-home-card', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    log('video cards', await page.locator('.mo-home-card').count());
    // This machine may decode HEVC itself; force the preview-copy path so it is exercised.
    await page.evaluate(() => { window.__moForcePreviewCopy = true; });
    await page.locator('.mo-home-card').first().dblclick();
    await page.waitForSelector('.mo-detail-main video', { timeout: 15_000 }).catch(() => {});
    await page.waitForFunction(() => { const v = document.querySelector('.mo-detail-main video'); return v && v.videoWidth > 0; }, null, { timeout: 120_000 }).catch(() => {});
    log(`player (${hevc ? 'HEVC' : 'H.264'})`, await page.evaluate(() => {
      const v = document.querySelector('.mo-detail-main video');
      const err = document.querySelector('.mo-player-error');
      return `video=${v ? v.videoWidth + 'x' + v.videoHeight : 'none'} src=${v && v.src ? 'set' : 'none'} error=${err ? err.textContent.slice(0, 80) : 'none'} note=${document.querySelector('.mo-player-preview-note') ? 'shown' : 'gone'} speeds=${Array.from(document.querySelectorAll('.mo-player-speed-item')).map((b) => b.textContent).join('/')}`;
    }));
    await shot(page, 'video-player');
    log('openClipEditor', await runCommand(page, 'media-organizer.openClipEditor', videoPath));
    await page.waitForSelector('.mo-clip-preview', { timeout: 20_000 });
    await page.waitForFunction(() => { const v = document.querySelector('.mo-clip-preview'); return v && v.videoWidth > 0; }, null, { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const findSel = `(text) => Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.textContent === text))`;
    log('clip speeds', await page.evaluate(`(() => { const f = ${findSel}; const speed = f('64×'); const fit = f('5 min'); const v = document.querySelector('.mo-clip-preview'); return 'speed=' + (speed ? Array.from(speed.options).map((o) => o.textContent).join('/') : 'none') + ' fit=' + (fit ? Array.from(fit.options).map((o) => o.textContent).join('/') : 'none') + ' preview=' + (v ? v.videoWidth + 'x' + v.videoHeight : 'none'); })()`));
    await page.evaluate(`(() => { const f = ${findSel}; const fit = f('5 min'); fit.value = '15'; fit.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.waitForTimeout(600);
    log('clip fit', await page.evaluate(`(() => { const f = ${findSel}; const fit = f('5 min'); const speed = f('64×'); const v = document.querySelector('.mo-clip-preview'); return 'note="' + (fit.closest('.mo-clip-row').querySelector('.mo-clip-hint')?.textContent || '') + '" speedDisabled=' + speed.disabled + ' previewRate=' + v.playbackRate; })()`));
    await shot(page, 'clip-fit');

    // Gate off again: everything hides without a reload.
    await page.evaluate(async () => {
      await window.__parallx_workbench__._services.get({ id: 'IConfigurationService' }).getConfiguration('mediaOrganizer').update('enableArtTools', false);
    });
    await page.waitForTimeout(1_000);
    log('sidebar gate off again', await practiceSidebar(page));
    await runCommand(page, 'media-organizer.openHome');
    await page.waitForTimeout(1_000);
    log('daily card gate off again', await dailyCard(page));
    log('folders at end', await page.evaluate(() => Array.from(document.querySelectorAll('[data-mo-section="folders"] .mo-sidebar-item')).map((i) => `${i.querySelector('.mo-sidebar-item-label')?.textContent}:${i.querySelector('.mo-sidebar-item-count')?.textContent || ''}${i.classList.contains('is-offline') ? '(offline)' : ''}`).join(' | ')));
  } finally {
    if (errors.length) {
      console.log(`[probe] ${errors.length} renderer error(s):`);
      for (const e of errors) console.log(`  ${e}`);
    } else {
      console.log('[probe] no renderer errors');
    }
    await app.close().catch(() => {});
    for (const db of dbPaths(workspace)) {
      const r = spawnSync(ELECTRON, [VERIFY, db], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
      console.log(`[probe] db ${path.basename(path.dirname(db))}: ${(r.stdout || r.stderr || '').trim()}`);
    }
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
