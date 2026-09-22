// Hidden-window probe for the Alpha Unification menu pass (docs/ALPHA_UNIFICATION.md).
// Seeds a throwaway workspace with the Tag Review seed (four real photos), launches
// the app HIDDEN (PARALLX_HIDDEN_PROBE), opens the Media Organizer grid and checks
// that its menus are THE workbench menus: right-click on a card opens `.context-menu`
// (not a private clone), the sort menu shows checked rows with a mark column, and the
// per-page dropdown opens the body-level `.ui-dropdown__list` at the popup floor.
// Usage: node tests/probes/menus-probe.mjs <outDir>
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-menus-shots'));
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
const dbPaths = (ws) => ['media-organizer', 'parallx-community.media-organizer']
  .map((id) => path.join(ws, '.parallx', 'extensions', id, 'data.db'));

async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-menus-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-menus-ws-${stamp}`);
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
    try { await svc.executeCommand(commandId, ...args); return 'ok'; } catch (e) { return `failed: ${String(e).slice(0, 160)}`; }
  }, { commandId: id, args });
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${name}.png`);
  let how = 'playwright';
  try {
    await page.screenshot({ path: file, timeout: 8_000 });
  } catch {
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

// What a menu looks like from the DOM: THE .context-menu, its rows, mark column, z-index.
const menuState = (page) => page.evaluate(() => {
  const menus = Array.from(document.querySelectorAll('.context-menu'));
  const clones = document.querySelectorAll('.mo-context-menu, .br-menu, .mo-select-popup, .mo-dropdown__list').length;
  return {
    menus: menus.length,
    clones,
    items: menus.map((m) => Array.from(m.querySelectorAll('.context-menu-item')).map((r) => {
      const check = r.querySelector('.context-menu-item-check');
      return (check ? (check.textContent ? '[x] ' : '[ ] ') : '') + (r.querySelector('.context-menu-item-label')?.textContent || r.textContent)
        + (r.classList.contains('context-menu-item--disabled') ? '(off)' : '') + (r.classList.contains('context-menu-item--danger') ? '(danger)' : '');
    }).join(' | ')),
    hasChecks: menus.map((m) => m.classList.contains('context-menu--has-checks')),
    z: menus.map((m) => getComputedStyle(m).zIndex),
    parent: menus.map((m) => m.parentElement?.tagName),
  };
});

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace } = await makeRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}`);
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  APP = app;
  const errors = [];
  const checks = [];
  const check = (ok, label) => { checks.push([!!ok, label]); console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${label}`); };
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

    // ── The grid ──
    console.log(`[probe] openGrid: ${await runCommand(page, 'media-organizer.openGrid')}`);
    const gotCards = await page.waitForSelector('.mo-card, .mo-feed-card', { timeout: 20_000 }).then(() => true).catch(() => false);
    if (!gotCards) {
      const diag = await page.evaluate(() => ({
        editorTabs: Array.from(document.querySelectorAll('.editor-tab, [class*="tab-label"]')).map((t) => t.textContent.trim()).filter(Boolean).slice(0, 8),
        moRoots: Array.from(document.querySelectorAll('[class^="mo-"]')).slice(0, 6).map((e) => e.className.split(' ')[0]),
        gridText: (document.querySelector('.mo-grid, .mo-grid-empty, .mo-empty')?.textContent || '').slice(0, 160),
      }));
      console.log(`[probe] no cards; diag: ${JSON.stringify(diag)}`);
      await shot(page, 'menus-no-cards');
    }
    check(gotCards, 'grid shows cards');
    await page.waitForTimeout(800);

    if (gotCards) {
      // Right-click a card: THE context menu, no clone.
      const card = page.locator('.mo-card, .mo-feed-card').first();
      await card.click({ button: 'right' });
      const opened = await page.waitForSelector('.context-menu', { timeout: 5_000 }).then(() => true).catch(() => false);
      const st = opened ? await menuState(page) : null;
      console.log(`[probe] card menu: ${JSON.stringify(st)}`);
      check(opened && st.menus === 1 && st.clones === 0, 'card right-click opens THE .context-menu and no clone');
      check(opened && st.items[0].includes('|'), 'card menu has items');
      check(opened && Number(st.z[0]) >= 10001, `card menu z-index at the popup floor (${st && st.z[0]})`);
      await shot(page, 'menus-card-context');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      check((await menuState(page)).menus === 0, 'Escape closes the card menu');

      // The sort menu (checked rows) from the toolbar, if the button is there.
      const sortBtn = page.locator('button.mo-menu-btn[title="Sort and group"]').first();
      if (await sortBtn.count()) {
        await sortBtn.click().catch(() => {});
        const opened2 = await page.waitForSelector('.context-menu', { timeout: 4_000 }).then(() => true).catch(() => false);
        const st2 = opened2 ? await menuState(page) : null;
        console.log(`[probe] sort menu: ${JSON.stringify(st2)}`);
        if (opened2) {
          check(st2.hasChecks[0] && /\[x\]/.test(st2.items[0]), 'sort menu reserves the mark column and shows the checked row');
          await shot(page, 'menus-sort-checked');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        } else {
          console.log('[probe] sort button found but no menu opened (skipped)');
        }
      } else {
        console.log('[probe] no sort button found by label (skipped)');
      }

      // The per-page dropdown: THE dropdown, list at body level. The feed layout
      // has no pagination bar, so switch to the grid layout first.
      await page.locator('button.mo-segment-btn[title="Grid"]').first().click().catch(() => {});
      await page.waitForSelector('.mo-pagination', { state: 'visible', timeout: 5_000 }).catch(() => {});
      const perPage = page.locator('.mo-pagination .mo-dd .ui-dropdown__button').first();
      if (await perPage.count() && await perPage.isVisible()) {
        await perPage.click();
        const listOpen = await page.waitForSelector('.ui-dropdown__list', { state: 'visible', timeout: 4_000 }).then(() => true).catch(() => false);
        const dd = listOpen ? await page.evaluate(() => {
          const l = Array.from(document.querySelectorAll('.ui-dropdown__list')).find((x) => getComputedStyle(x).display !== 'none');
          return l ? { parent: l.parentElement?.tagName, z: getComputedStyle(l).zIndex, items: Array.from(l.querySelectorAll('.ui-dropdown__item')).map((i) => i.textContent).join(' | '), clones: document.querySelectorAll('.mo-dropdown__list, .mo-select-popup').length } : null;
        }) : null;
        console.log(`[probe] per-page dropdown: ${JSON.stringify(dd)}`);
        check(listOpen && dd && dd.parent === 'BODY' && Number(dd.z) >= 10005 && dd.clones === 0, 'per-page dropdown opens THE body-level list at the popup floor');
        await shot(page, 'menus-per-page-dropdown');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else {
        check(false, 'per-page dropdown (.mo-pagination .mo-dd) is present');
      }
    }

    // Any private menu DOM left anywhere after the pass?
    const leftovers = await page.evaluate(() => document.querySelectorAll('.mo-context-menu, .mo-dropdown, .mo-select-popup, .br-menu, select.mo-clip-input').length);
    check(leftovers === 0, `no private menu DOM anywhere (${leftovers})`);
  } finally {
    if (errors.length) {
      console.log(`[probe] ${errors.length} renderer error(s):`);
      for (const e of errors) console.log(`  ${e}`);
    } else {
      console.log('[probe] no renderer errors');
    }
    const failed = checks.filter(([ok]) => !ok).length;
    console.log(`[probe] ${checks.length - failed}/${checks.length} checks passed`);
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    if (failed || errors.length) process.exitCode = 1;
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
