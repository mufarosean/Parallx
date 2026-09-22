// tag-review-probe.mjs: Tag Review in the real app, never on screen (docs/AI_TAGGING.md).
//
// Seeds a throwaway workspace with four real images and a Media Organizer
// database holding a tag tree and one review row in each state (pending,
// No Match, Failed, queued), launches the app HIDDEN (PARALLX_HIDDEN_PROBE),
// and drives Tag Review: add a tag through the suggestion list, remove a
// chip, Approve, Resume (a real run when the chat model can see images; its
// error otherwise), the sidebar count, the grid menu and the selection bar.
// After the app closes it reads the database back.
//
// Usage: node tests/probes/tag-review-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/).

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-tag-review-shots'));
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(__dirname, 'tag-review-seed.cjs');
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

// The extension's database folder is named after the extension; seed both
// spellings so the one the app opens is the seeded one.
const dbPaths = (ws) => ['media-organizer', 'parallx-community.media-organizer']
  .map((id) => path.join(ws, '.parallx', 'extensions', id, 'data.db'));

async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-tagreview-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-tagreview-ws-${stamp}`);
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

async function runCommand(page, entries) {
  for (const entry of entries) {
    const [id, ...args] = Array.isArray(entry) ? entry : [entry];
    const ok = await page.evaluate(async ({ commandId, args }) => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
      if (!svc?.executeCommand) return false;
      try { await svc.executeCommand(commandId, ...args); return true; } catch { return false; }
    }, { commandId: id, args });
    if (ok) return id;
  }
  return null;
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  const file = path.join(outDir, `${name}.png`);
  let how = 'playwright';
  try {
    await page.screenshot({ path: file, timeout: 8_000 });
  } catch {
    // A hidden window may never hand Playwright a new frame; ask Electron for one.
    how = 'capturePage';
    const out = await APP.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      if (!w) return null;
      const img = await w.webContents.capturePage();
      return { b64: img.toPNG().toString('base64'), size: img.getSize() };
    });
    if (!out || !out.b64) { console.log(`[probe] ${name}: no frame`); return; }
    await fs.writeFile(file, Buffer.from(out.b64, 'base64'));
    how += ` ${out.size.width}x${out.size.height}`;
  }
  console.log(`[probe] ${name} -> ${file} (${how})`);
}

async function reviewState(page, label) {
  const d = await page.evaluate(() => {
    const sub = document.querySelector('.mo-tr-sub')?.textContent || '';
    const head = Array.from(document.querySelectorAll('.mo-tr-actions-bar button'))
      .filter((b) => b.style.display !== 'none').map((b) => b.textContent + (b.disabled ? '(off)' : '')).join('/');
    const rows = Array.from(document.querySelectorAll('.mo-tr-row')).map((r) => {
      const name = r.querySelector('.mo-tr-name')?.textContent || '';
      const badge = r.querySelector('.mo-tr-status')?.textContent || 'ready';
      const chips = Array.from(r.querySelectorAll('.mo-tr-chip')).map((c) => c.textContent.replace('×', '').trim()).join(' | ');
      const img = r.querySelector('.mo-tr-thumb img');
      const btns = Array.from(r.querySelectorAll('.mo-tr-row-actions button')).map((b) => b.textContent + (b.disabled ? '(off)' : '')).join('/');
      const notes = Array.from(r.querySelectorAll('.mo-tr-note, .mo-tr-error')).map((n) => n.textContent).join(' ; ');
      return `${name} [${badge}] chips={${chips}} thumb=${img && img.naturalWidth ? img.naturalWidth + 'px' : 'none'} buttons=${btns}${notes ? ' notes=' + notes : ''}`;
    });
    return `sub="${sub}" head=${head}\n      ${rows.join('\n      ') || '(no rows)'}`;
  });
  console.log(`[probe] tag review @${label}: ${d}`);
}

const rowOf = (page, basename) => page.locator('.mo-tr-row', { has: page.locator('.mo-tr-name', { hasText: basename }) }).first();

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

    // A fresh app root has the Media Organizer disabled (a newly found
    // external extension), and a disabled extension does not run. Enable it
    // the way the Tools view does; that activates it.
    await page.evaluate(async () => {
      await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.media-organizer', true);
    });
    await page.waitForTimeout(3_000);

    if (!(await runCommand(page, ['media-organizer.openTagReview']))) throw new Error('media-organizer.openTagReview not available');
    await page.waitForSelector('.mo-tr-row', { timeout: 20_000 });
    await page.waitForTimeout(2_500);   // thumbnails
    await reviewState(page, 'open');
    await shot(page, 'tag-review');

    // Add a tag to the No Match photo through the suggestion list.
    const input = rowOf(page, 'card.jpg').locator('.mo-tr-add-input');
    await input.click();
    await input.pressSequentially('test', { delay: 30 });
    await page.waitForSelector('.mo-tr-suggest', { timeout: 5_000 });
    const pop = await page.evaluate(() => {
      const p = document.querySelector('.mo-tr-suggest');
      const r = p.getBoundingClientRect();
      const typed = document.activeElement;
      return `items=[${Array.from(p.children).map((c) => c.textContent).join(' | ')}] z=${getComputedStyle(p).zIndex} parent=${p.parentElement.tagName} ` +
        `rect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} ` +
        `input value="${typed && typed.value}" shown as ${typed ? getComputedStyle(typed).textTransform : '?'}`;
    });
    console.log(`[probe] suggestions: ${pop}`);
    await shot(page, 'tag-review-suggest');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);

    // Remove CROWD from the boxing photo.
    await rowOf(page, 'boxing.jpg').locator('.mo-tr-chip', { hasText: 'CROWD' }).locator('button').click();
    await page.waitForTimeout(900);
    await reviewState(page, 'edited');
    await shot(page, 'tag-review-edited');

    // Approve the boxing photo.
    await rowOf(page, 'boxing.jpg').locator('.mo-tr-row-actions button', { hasText: 'Approve' }).click();
    await page.waitForTimeout(1_200);
    await reviewState(page, 'approved');

    // Resume the queued photo.
    const resume = page.locator('.mo-tr-actions-bar button', { hasText: 'Resume' }).first();
    if (await resume.isVisible()) {
      await resume.click();
      const t0 = Date.now();
      let res = 'timeout';
      while (Date.now() - t0 < 150_000) {
        const s = await page.evaluate(() => {
          const bars = Array.from(document.querySelectorAll('.mo-tr-row')).find((r) => (r.querySelector('.mo-tr-name')?.textContent || '') === 'bars.jpg');
          return { sub: document.querySelector('.mo-tr-sub')?.textContent || '', cls: bars ? bars.className : 'gone' };
        });
        if (!/is-queued|is-running/.test(s.cls)) { res = `bars row now "${s.cls}" | ${s.sub}`; break; }
        if (/cannot see|No chat model|not available|Stopped/i.test(s.sub)) { res = `refused: ${s.sub}`; break; }
        await page.waitForTimeout(1_000);
      }
      console.log(`[probe] resume: ${res} (${Math.round((Date.now() - t0) / 1000)}s)`);
    } else console.log('[probe] resume: button not shown');
    await reviewState(page, 'after-resume');
    await shot(page, 'tag-review-after');

    // Sidebar: Library > Tag Review with its count. The Media Organizer
    // opens from its activity bar button (labelled with the container title).
    // A fresh app root treats a newly found external extension as disabled:
    // it still activates, but its manifest contributions (the sidebar
    // container among them) wait until it is enabled. Enable it the way the
    // Tools view does, which re-processes the manifest.
    const enabled = await page.evaluate(async () => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
      if (!svc?.setEnablement) return 'no enablement service';
      try { await svc.setEnablement('parallx-community.media-organizer', true); } catch (e) { return 'enable failed: ' + e.message; }
      return `enabled=${svc.isEnabled('parallx-community.media-organizer')}`;
    });
    await page.waitForSelector('.activity-bar-item[data-icon-id="media-organizer-container"]', { timeout: 10_000 }).catch(() => {});
    console.log(`[probe] media organizer tool: ${enabled}`);
    const rail = await page.evaluate(() => Array.from(document.querySelectorAll('.activity-bar-item')).map((b, i) =>
      `#${i} ${Array.from(b.attributes).filter((a) => a.name !== 'class' && a.name !== 'style').map((a) => `${a.name}="${a.value.slice(0, 40)}"`).join(' ')} visible=${b.offsetParent !== null}`).join('\n      '));
    console.log(`[probe] activity bar:\n      ${rail}`);
    const opened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.activity-bar-item'))
        .find((b) => Array.from(b.attributes).some((a) => /media.?organizer/i.test(a.value)));
      if (btn) { btn.click(); return `clicked ${btn.getAttribute('aria-label') || '(no label)'}`; }
      const wb = window.__parallx_workbench__;
      for (const id of ['mediaOrganizer.browser', 'media-organizer-container']) {
        try { wb?.showSidebarView?.(id); } catch { /* next */ }
        if (document.querySelector('.mo-sidebar-item')) return `showSidebarView(${id})`;
      }
      return 'no way in';
    });
    await page.waitForSelector('.mo-sidebar-item', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    console.log(`[probe] sidebar opened via: ${opened}; .mo-sidebar-item rows: ${await page.locator('.mo-sidebar-item').count()}`);
    const side = await page.evaluate(() => {
      const item = Array.from(document.querySelectorAll('.mo-sidebar-item')).find((el) => (el.querySelector('.mo-sidebar-item-label')?.textContent || '') === 'Tag Review');
      if (!item) return 'no Tag Review item';
      const count = item.querySelector('.mo-sidebar-item-count');
      return `count="${count ? count.textContent : ''}" countDisplay=${count ? getComputedStyle(count).display : '-'} icon=${item.querySelector('.mo-icon-wrap svg') ? 'svg' : 'none'}`;
    });
    console.log(`[probe] sidebar Tag Review: ${side}`);
    await shot(page, 'tag-review-sidebar');

    // The grid: right-click menu and selection bar.
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForSelector('.mo-card, .mo-feed-card', { timeout: 15_000 });
    await page.waitForTimeout(1_200);
    const card = page.locator('.mo-card, .mo-feed-card').first();
    await card.click({ button: 'right' });
    await page.waitForSelector('.context-menu', { timeout: 5_000 });
    const menu = await page.evaluate(() => Array.from(document.querySelectorAll('.context-menu .context-menu-item')).map((i) => i.textContent).join(' | '));
    console.log(`[probe] grid menu: ${menu}`);
    await shot(page, 'tag-review-grid-menu');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await card.click({ modifiers: ['Control'] });
    await page.waitForTimeout(700);
    const bar = await page.evaluate(() => Array.from(document.querySelectorAll('.mo-selection-bar button')).map((b) => b.textContent).join(' | '));
    console.log(`[probe] selection bar: ${bar}`);
    await shot(page, 'tag-review-selection');
  } finally {
    if (errors.length) {
      console.log(`[probe] ${errors.length} renderer error(s):`);
      for (const e of errors) console.log(`  ${e}`);
    }
    await app.close().catch(() => {});
    for (const db of dbPaths(workspace)) {
      const r = spawnSync(ELECTRON, [SEED, 'verify', db], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
      console.log(`[probe] db ${path.basename(path.dirname(db))}: ${(r.stdout || r.stderr || '').trim()}`);
    }
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
