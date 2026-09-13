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
  }
  return { appRoot, workspace };
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
    const sec = document.querySelector('[data-mo-section="practice"]');
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
  const { appRoot, workspace } = await makeRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}`);
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  APP = app;
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
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

    // Detail: the Practice history strip on a drawn picture.
    const drawnId = await page.evaluate(() => {
      const end = Array.from(document.querySelectorAll('.mo-practice-end-item'))[0];
      return end ? 'via-end' : 'none';
    });
    log('detail via', drawnId);
    log('openGrid', await runCommand(page, 'media-organizer.openGrid'));
    await page.waitForSelector('.mo-card', { timeout: 15_000 });
    await page.locator('.mo-card').first().dblclick();
    await page.waitForSelector('.mo-detail-main', { timeout: 10_000 });
    await page.waitForTimeout(1_500);
    log('detail practice strip', await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.mo-detail-main .mo-similar-title')).map((t) => t.textContent);
      const rows = Array.from(document.querySelectorAll('.mo-practice-history-row')).map((r) => r.textContent);
      const btn = document.querySelector('.mo-practice-history-head button')?.textContent;
      return `titles=${titles.join(' | ')} rows=${rows.join(' | ') || '(none)'} button=${btn}`;
    }));
    await shot(page, 'practice-detail');

    // Gate off again: everything hides without a reload.
    await page.evaluate(async () => {
      await window.__parallx_workbench__._services.get({ id: 'IConfigurationService' }).getConfiguration('mediaOrganizer').update('enableArtTools', false);
    });
    await page.waitForTimeout(1_000);
    log('sidebar gate off again', await practiceSidebar(page));
    await runCommand(page, 'media-organizer.openHome');
    await page.waitForTimeout(1_000);
    log('daily card gate off again', await dailyCard(page));
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
