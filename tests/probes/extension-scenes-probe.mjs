// Hidden-window probe for Alpha Unification passes 3 and 4 (docs/ALPHA_UNIFICATION.md).
// Launches the app HIDDEN (PARALLX_HIDDEN_PROBE) on a throwaway workspace with every
// extension enabled, opens one surface per extension (and three core surfaces as the
// reference), screenshots each, and measures the chrome the eye compares across tabs:
// heading sizes, toolbar height, button and input heights, empty-state markup, fonts.
// Usage: node tests/probes/extension-scenes-probe.mjs <outDir> [sceneName ...]
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-extension-scenes'));
const only = new Set(process.argv.slice(3));

const EXTENSIONS = ['parallx.browser', 'parallx.budget', 'parallx.concept-lab', 'parallx-community.creations-ai',
  'parallx-community.flashcards', 'parallx-community.media-organizer', 'parallx.web-research', 'parallx.workspace-graph'];

// [scene name, command, args]
const SCENES = [
  ['core-planner', 'planner.open'],
  ['core-worksheet', 'worksheet.open'],
  ['core-dashboard', 'dashboard.open'],
  ['flashcards', 'flashcards.open'],
  ['budget-dashboard', 'budget.openDashboard'],
  ['budget-accounts', 'budget.openAccounts'],
  ['creations-home', 'textGenerator.openHome'],
  ['creations-characters', 'textGenerator.openCharacters'],
  ['concept-lab', 'conceptLab.open'],
  ['browser', 'browser.newTab'],
  ['workspace-graph', 'workspaceGraph.open'],
  ['media-library', 'media-organizer.openGrid'],
];

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

async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-scenes-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-scenes-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  await fs.writeFile(path.join(workspace, 'README.md'), '# Scenes\nThrowaway workspace for the extension scenes probe.\n');
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

// The chrome the eye compares across tabs, measured inside the editor part.
const measure = (page) => page.evaluate(() => {
  const part = document.querySelector('[data-part-id="workbench.parts.editor"]') || document.body;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const px = (v) => Math.round(parseFloat(v));
  const hist = (els, prop, withClass = false) => {
    const m = new Map();
    const eg = new Map();
    for (const el of els) {
      const v = px(getComputedStyle(el)[prop]);
      m.set(v, (m.get(v) || 0) + 1);
      if (!eg.has(v)) eg.set(v, (el.className + '').split(' ')[0] || el.tagName.toLowerCase());
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v, n]) => `${v}x${n}${withClass ? `(.${eg.get(v)})` : ''}`).join(' ');
  };
  const all = Array.from(part.querySelectorAll('*')).filter(visible);
  const heads = all.filter((el) => /^H[1-3]$/.test(el.tagName) || /(^|\s|__|-)(title|heading|headline)(\s|$|__|-)/.test(el.className + '')).slice(0, 3)
    .map((el) => { const cs = getComputedStyle(el); return `${el.tagName.toLowerCase()}.${(el.className + '').split(' ')[0]} ${px(cs.fontSize)}px/${cs.fontWeight} "${(el.textContent || '').trim().slice(0, 28)}"`; });
  const toolbar = all.find((el) => /toolbar/.test(el.className + '') || el.getAttribute('role') === 'toolbar');
  const buttons = all.filter((el) => el.tagName === 'BUTTON');
  const inputs = all.filter((el) => (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color'].includes(el.type)) || el.tagName === 'TEXTAREA');
  const empties = all.filter((el) => /(^|\s|__|-)empty(\s|$|__|-)/.test(el.className + ''));
  const emptyHead = empties.length ? (empties[0].querySelector('[class*="headline"], [class*="title"], h2, h3, strong') || empties[0]) : null;
  const root = part.querySelector(':scope > * > *') || part;
  const fontOf = (el) => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '');
  return {
    heads,
    toolbar: toolbar ? `${(toolbar.className + '').split(' ')[0]} h=${Math.round(toolbar.getBoundingClientRect().height)}` : '-',
    buttons: hist(buttons, 'height', true) || '-',
    inputs: hist(inputs, 'height', true) || '-',
    empty: empties.length ? `${(empties[0].className + '').split(' ').slice(0, 2).join('.')}${document.querySelector('.px-empty') ? ' (px-empty present)' : ''}` + (emptyHead ? ` head=${px(getComputedStyle(emptyHead).fontSize)}px/${getComputedStyle(emptyHead).fontWeight}` : '') : '-',
    font: `${fontOf(root)} / body ${fontOf(document.body)}`,
    fontSizes: hist(all.filter((el) => el.children.length === 0 && (el.textContent || '').trim()), 'fontSize'),
  };
});

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
    await page.evaluate(async (ids) => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
      for (const id of ids) { try { await svc.setEnablement(id, true); } catch (e) { console.warn('enable', id, String(e)); } }
    }, EXTENSIONS);
    await page.waitForTimeout(4_000);

    for (const [name, command, ...args] of SCENES) {
      if (only.size && !only.has(name)) continue;
      const before = errors.length;
      const res = await runCommand(page, command, ...args);
      await page.waitForTimeout(2_500);
      const m = await measure(page);
      console.log(`[scene] ${name} (${command}: ${res})\n  heads: ${m.heads.join(' | ') || '-'}\n  toolbar: ${m.toolbar}  buttons: ${m.buttons}  inputs: ${m.inputs}\n  empty: ${m.empty}\n  font: ${m.font}  sizes: ${m.fontSizes}`);
      if (errors.length > before) console.log(`  errors: ${errors.slice(before).join(' || ').slice(0, 400)}`);
      await shot(page, name);
    }
  } finally {
    if (errors.length) {
      console.log(`[probe] ${errors.length} renderer error(s):`);
      for (const e of errors) console.log(`  ${e}`);
    } else {
      console.log('[probe] no renderer errors');
    }
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
