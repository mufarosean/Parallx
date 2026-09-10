// tool-visibility-probe.mjs: an extension's AI tools exist only while it is enabled.
//
// Launches the app HIDDEN on a fresh app root, where the Media Organizer is a
// newly found external extension and therefore disabled, and checks three
// states: disabled (not activated, no tool registered, nothing in the model's
// tool list, nothing in AI Settings > Tools), enabled (the tool registered, in
// the model's list, listed in Tools), and disabled again (gone from all three).
//
// Usage: node tests/probes/tool-visibility-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/).

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-tool-visibility'));
const EXT = 'parallx-community.media-organizer';

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
  await page.waitForTimeout(500);
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
  // Re-open the Tools section so it renders from the current registry.
  await page.evaluate(async () => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    try { await svc.executeCommand('aiSettings.manageTools'); } catch { /* reported below */ }
  });
  await page.waitForSelector('.ai-settings-tools-group-label', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(600);
  const s = await page.evaluate((ext) => {
    const get = (id) => window.__parallx_workbench__?._services?.get?.({ id });
    const tools = get('ILanguageModelToolsService');
    const enable = get('IToolEnablementService');
    const cmds = get('ICommandService');
    const mine = (tools?.getTools?.() || []).filter((t) => t.ownerToolId === ext).map((t) => t.name);
    const modelSees = (tools?.getToolDefinitions?.() || []).map((d) => d.name).filter((n) => /media|tag_?photos/i.test(n));
    const groups = Array.from(document.querySelectorAll('.ai-settings-tools-group-label')).map((g) => g.textContent);
    const rows = Array.from(document.querySelectorAll('.ai-settings-tools-group-label'))
      .filter((g) => /media/i.test(g.textContent)).map((g) => g.parentElement?.textContent?.trim());
    const hasCmd = !!(cmds?.getCommands?.()?.has?.('media-organizer.openTagReview') ?? cmds?.hasCommand?.('media-organizer.openTagReview'));
    return { enabled: enable?.isEnabled?.(ext), registered: mine, modelSees, groups, mediaGroup: rows, hasCmd, sidebarButton: !!document.querySelector('.activity-bar-item[data-icon-id="media-organizer-container"]') };
  }, EXT);
  console.log(`[probe] ${label}: extension enabled=${s.enabled} | tool registered=[${s.registered.join(', ')}] | model sees=[${s.modelSees.join(', ')}] | ` +
    `Tools groups=[${s.groups.join(' | ')}] | media group=${JSON.stringify(s.mediaGroup)} | sidebar button=${s.sidebarButton}`);
  return s;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-toolvis-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-toolvis-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  APP = app;
  const errors = [];
  const checks = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(4_000);

    const off = await state(page, 'fresh (disabled)');
    await shot(page, 'tools-disabled');
    checks.push([off.enabled === false, 'a newly found extension starts disabled']);
    checks.push([off.registered.length === 0, 'disabled: its tool is not registered (the extension did not run)']);
    checks.push([off.modelSees.length === 0, 'disabled: the model sees no Media Organizer tool']);
    checks.push([off.mediaGroup.length === 0, 'disabled: AI Settings > Tools lists no Media Organizer group']);

    await page.evaluate(async (ext) => {
      await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement(ext, true);
    }, EXT);
    await page.waitForTimeout(4_000);
    const on = await state(page, 'enabled');
    await shot(page, 'tools-enabled');
    checks.push([on.registered.includes('mediaOrganizer_tagPhotos'), 'enabled: the one tool is registered']);
    checks.push([on.registered.length === 1, 'enabled: exactly one Media Organizer tool']);
    checks.push([on.modelSees.includes('mediaOrganizer_tagPhotos'), 'enabled: the model sees it']);
    checks.push([on.mediaGroup.length === 1, 'enabled: AI Settings > Tools lists it']);

    await page.evaluate(async (ext) => {
      await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement(ext, false);
    }, EXT);
    await page.waitForTimeout(3_000);
    const offAgain = await state(page, 'disabled again');
    await shot(page, 'tools-disabled-again');
    checks.push([offAgain.registered.length === 0, 'disabled again: the tool is unregistered']);
    checks.push([offAgain.modelSees.length === 0, 'disabled again: the model no longer sees it']);
    checks.push([offAgain.mediaGroup.length === 0, 'disabled again: Tools no longer lists it']);
  } finally {
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
