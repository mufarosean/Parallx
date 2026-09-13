// disabled-builtin-probe.mjs: a disabled built-in leaves no dead sidebar icon.
//
// Launches the app HIDDEN on a fresh app root whose workspace state already
// lists parallx.worksheet (Worksheets, a non-required built-in) as disabled,
// and checks three states: booted disabled (no activity bar icon, no view, not
// activated, no command), enabled live (icon back, the view renders real
// content rather than the "Waiting for view provider" placeholder, activated,
// command present), and disabled live again (all gone).
//
// Usage: node tests/probes/disabled-builtin-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/).

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-disabled-builtin'));
const TOOL = 'parallx.worksheet';
const CONTAINER = 'worksheet-container';
const VIEW = 'view.worksheet';
const COMMAND = 'worksheet.open';

let APP = null;

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

async function shot(page, name) {
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${name}.png`);
  try { await page.screenshot({ path: file, timeout: 8_000 }); } catch {
    const out = await APP.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : null;
    });
    if (out) await fs.writeFile(file, Buffer.from(out, 'base64'));
  }
  console.log(`[probe] ${name} -> ${file}`);
}

async function state(page, label) {
  const s = await page.evaluate(({ TOOL, CONTAINER, VIEW, COMMAND }) => {
    const wb = window.__parallx_workbench__;
    const get = (id) => wb?._services?.get?.({ id });
    const cmds = get('ICommandService');
    const enable = get('IToolEnablementService');
    const el = document.querySelector(`[data-view-id="${VIEW}"]`);
    const hasCmd = !!(cmds?.getCommands?.()?.has?.(COMMAND) ?? cmds?.hasCommand?.(COMMAND));
    return {
      enabled: enable?.isEnabled?.(TOOL),
      activated: !!wb?._toolActivator?.isActivated?.(TOOL),
      icon: !!document.querySelector(`.activity-bar-item[data-icon-id="${CONTAINER}"]`),
      icons: document.querySelectorAll('.activity-bar-item').length,
      view: !!el,
      placeholder: !!el?.querySelector?.('.contributed-view-placeholder'),
      viewText: (el?.textContent ?? '').trim().slice(0, 80),
      command: hasCmd,
    };
  }, { TOOL, CONTAINER, VIEW, COMMAND });
  console.log(`[probe] ${label}: enabled=${s.enabled} activated=${s.activated} icon=${s.icon} (of ${s.icons}) view=${s.view} placeholder=${s.placeholder} command=${s.command} text="${s.viewText}"`);
  return s;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-disabled-builtin-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-disabled-builtin-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  // The workspace arrives with Worksheets already disabled, as a user's
  // earlier Gallery toggle would leave it.
  await fs.writeFile(path.join(workspace, '.parallx', 'workspace-state.json'),
    JSON.stringify({ version: 1, 'tool-enablement:disabled': JSON.stringify([TOOL]) }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  APP = app;
  const errors = [];
  const logs = [];
  const checks = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { const t = m.text(); if (/worksheet/i.test(t) && /Workbench|ToolActivator|ViewContribution/.test(t)) logs.push(t.slice(0, 200)); });
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(5_000);

    const off = await state(page, 'booted disabled');
    await shot(page, 'booted-disabled');
    checks.push([off.enabled === false, 'boot: the stored disable is honoured']);
    checks.push([off.activated === false, 'boot: the tool did not activate']);
    checks.push([off.icon === false, 'boot: no Worksheets icon in the activity bar']);
    checks.push([off.view === false, 'boot: no Worksheets view element exists']);
    checks.push([off.command === false, 'boot: its command is not registered']);
    checks.push([off.icons > 0, 'boot: other activity bar icons are present']);

    await page.evaluate(async (t) => {
      await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement(t, true);
    }, TOOL);
    await page.waitForTimeout(4_000);
    const icon = await page.$(`.activity-bar-item[data-icon-id="${CONTAINER}"]`);
    if (icon) { await icon.click(); await page.waitForTimeout(2_500); }
    const on = await state(page, 'enabled live');
    await shot(page, 'enabled-live');
    checks.push([on.enabled === true, 'enable: the tool is enabled']);
    checks.push([on.activated === true, 'enable: the tool activated']);
    checks.push([on.icon === true, 'enable: the Worksheets icon is back']);
    checks.push([on.view === true && on.placeholder === false, 'enable: the view rendered real content, not the placeholder']);
    checks.push([on.command === true, 'enable: its command is registered']);

    await page.evaluate(async (t) => {
      await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement(t, false);
    }, TOOL);
    await page.waitForTimeout(3_000);
    const offAgain = await state(page, 'disabled live');
    await shot(page, 'disabled-live');
    checks.push([offAgain.activated === false, 'disable: the tool deactivated']);
    checks.push([offAgain.icon === false, 'disable: the icon is gone again']);
    checks.push([offAgain.view === false, 'disable: the view element is gone']);
    checks.push([offAgain.command === false, 'disable: its command is gone']);
  } finally {
    if (logs.length) { console.log(`[probe] ${logs.length} console line(s) about the tool:`); for (const l of logs) console.log(`  ${l}`); }
    if (errors.length) { console.log(`[probe] ${errors.length} renderer error(s):`); for (const e of errors) console.log(`  ${e}`); }
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
  console.log('');
  for (const [ok, label] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  process.exit(checks.length && checks.every(([ok]) => ok) ? 0 : 1);
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
