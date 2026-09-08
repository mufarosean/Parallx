// worksheet-menu-probe.mjs — the sheet's right-click menu inside the REAL app,
// hidden. Boots Parallx against a throwaway root and workspace (the same
// arrangement as ui-screenshot-probe.mjs), opens the scratch practice sheet,
// right-clicks a cell, then reports every label in the menu with its
// computed colour, size and box, and saves a screenshot. No window appears.
//
// Usage: node tests/probes/worksheet-menu-probe.mjs <outDir>
// Requires `npm run build` (the app loads dist/).
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-menu-probe'));

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
async function makeTempRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-menu-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-menu-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Menu probe workspace\n');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* fine */ }
  return { appRoot, workspace };
}
async function runCommand(page, commandId, ...args) {
  return page.evaluate(async ({ commandId, args }) => {
    const wb = window.__parallx_workbench__;
    const svc = wb?._services?.get?.({ id: 'ICommandService' });
    if (!svc?.executeCommand) return false;
    try { await svc.executeCommand(commandId, ...args); return true; } catch (e) { return String(e); }
  }, { commandId, args });
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace } = await makeTempRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}`);
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 240)}`); });
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(2_500);
    const opened = await runCommand(page, 'worksheet.openScratch');
    console.log(`[probe] worksheet.openScratch -> ${opened}`);
    await page.waitForSelector('.ws-pane__sheet canvas', { state: 'attached', timeout: 60_000 });
    await page.waitForTimeout(3_000);
    const box = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll('.ws-pane__sheet canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
      const r = canvases[0].getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height, appMode: document.documentElement.getAttribute('data-px-mode'), univerDark: document.documentElement.classList.contains('univer-dark') };
    });
    console.log('[probe] sheet canvas:', JSON.stringify(box));
    await page.mouse.click(box.left + 300, box.top + 260, { button: 'right' });
    await page.waitForTimeout(1_200);
    const menu = await page.evaluate(() => {
      const popups = [...document.querySelectorAll('.univer-popup, [data-radix-popper-content-wrapper]')];
      const big = popups.sort((a, b) => b.innerHTML.length - a.innerHTML.length)[0];
      if (!big) return { found: false, bodyLast: [...document.body.children].slice(-4).map((e) => `${e.tagName}#${e.id}.${String(e.className).slice(0, 40)} len=${e.innerHTML.length}`) };
      const r = big.getBoundingClientRect();
      const leaves = [...big.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent || '').trim()).slice(0, 18).map((e) => {
        const cs = getComputedStyle(e); const b = e.getBoundingClientRect();
        return { text: e.textContent.trim().slice(0, 28), color: cs.color, fs: cs.fontSize, ff: cs.fontFamily.slice(0, 30), w: Math.round(b.width), h: Math.round(b.height), vis: cs.visibility, op: cs.opacity, cls: String(e.className).slice(0, 50) };
      });
      // Where does the white come from? Walk up from the first white leaf and report every ancestor whose colour differs from its parent's.
      const white = [...big.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() && getComputedStyle(e).color === 'rgb(255, 255, 255)');
      const chain = [];
      for (let el = white; el && el !== document.body; el = el.parentElement) {
        const c = getComputedStyle(el).color;
        const pc = el.parentElement ? getComputedStyle(el.parentElement).color : '';
        if (c !== pc || el === white) chain.push({ tag: el.tagName, cls: String(el.className).slice(0, 110), color: c, gray900: getComputedStyle(el).getPropertyValue('--univer-gray-900').trim() });
      }
      const rootVar = getComputedStyle(document.documentElement).getPropertyValue('--univer-gray-900').trim();
      const styleTags = [...document.querySelectorAll('style')].map((t, i) => ({ i, id: t.id, len: (t.textContent || '').length, hasGray: (t.textContent || '').includes('--univer-gray-900'), snippet: (t.textContent || '').match(/[^{}]{0,60}\{[^}]*--univer-gray-900:[^;]*;/)?.[0]?.slice(0, 140) || '' })).filter((t) => t.hasGray);
      const inlineVar = document.documentElement.style.getPropertyValue('--univer-gray-900');
      const item = big.querySelector('[role=menuitem], .univer-menu-item, [class*=menu-item]');
      const itemCs = item ? getComputedStyle(item) : null;
      return { found: true, rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, cls: big.className, leaves: leaves.slice(0, 6), chain, rootVar, inlineVar, styleTags, item: item ? { cls: String(item.className).slice(0, 120), color: itemCs.color, bg: itemCs.backgroundColor, fs: itemCs.fontSize } : null };
    });
    console.log('[probe] menu:', JSON.stringify(menu, null, 1));
    const file = path.join(outDir, 'worksheet-menu.png');
    await page.screenshot({ path: file });
    console.log(`[probe] screenshot -> ${file}`);
  } finally {
    if (errors.length) { console.log(`[probe] ${errors.length} renderer errors/warnings:`); for (const e of errors.slice(0, 8)) console.log('  ' + e); }
    await app.close().catch(() => {});
  }
}
main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
