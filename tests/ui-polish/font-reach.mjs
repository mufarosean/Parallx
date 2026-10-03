// Where the app font reaches.
//
//   node tests/ui-polish/font-reach.mjs [--font=georgia] [--only=regex]
//
// Same setup as app-sweep.mjs (built app, new profile and workspace under
// test-results/ui-polish/, every extension in ext/ installed and enabled),
// then picks the font through the real Appearance panel (Settings, the
// "Font: <name>" chip) and visits every surface the sweep visits, plus
// documents: a Markdown file, a code file, a canvas page and a worksheet.
// For each scene, every visible text element is sorted into: follows the
// chosen font, monospace (code and numbers, expected to stay), or other.
// "other" is listed with the element's class path and text, split into
// chrome (the app's own UI) and content (what the user writes or opens).
// Canvases and webviews are counted, since their text is not in the DOM.
// Results: fonts.json and a per-scene screenshot. Run under xvfb-run on Linux.
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const fontId = String(args.font || 'georgia');
const only = args.only ? new RegExp(String(args.only)) : null;

const outRoot = path.join(repo, 'test-results/ui-polish');
await fs.mkdir(outRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(outRoot, `font-reach-${fontId}-`));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/extensions'), workspace, shots, path.join(appRoot, 'data/chromium-cache')]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
const extIds = [];
for (const name of await fs.readdir(path.join(repo, 'ext'))) {
  const manifest = path.join(repo, 'ext', name, 'parallx-manifest.json');
  try { extIds.push(JSON.parse(await fs.readFile(manifest, 'utf8')).id); } catch { continue; }
  await fs.cp(path.join(repo, 'ext', name), path.join(appRoot, 'data/extensions', name), { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes(`${path.sep}test${path.sep}`) });
}
await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
await fs.writeFile(path.join(workspace, 'README.md'), '# Font reach\n\nA paragraph of prose with **bold** and `inline code`.\n\n- a list item\n- another\n\n```ts\nconst answer = 42;\n```\n');
await fs.writeFile(path.join(workspace, 'sample.ts'), 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');

const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });

const command = (id, ...a) => page.evaluate(({ id, a }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...a), { id, a });
const settle = async (ms = 700) => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(ms); };

async function measure(expected) {
  return page.evaluate((expected) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const MONO = /mono|code|consolas|courier|menlo|cascadia|fira|monaco/i;
    const inDoc = (el) => el.closest('.ProseMirror, .canvas-tiptap-editor, .monaco-editor, .cm-editor, .xterm, .markdown-preview, .md-preview, .px-code-editor, [contenteditable="true"]');
    const where = (el) => {
      const parts = [];
      for (let n = el; n && n !== document.body && parts.length < 3; n = n.parentElement) {
        const c = (n.className && typeof n.className === 'string') ? n.className.trim().split(/\s+/)[0] : '';
        if (c) parts.unshift(c);
      }
      return parts.join(' > ') || el.tagName.toLowerCase();
    };
    const out = { chrome: { follows: 0, mono: 0, other: 0 }, content: { follows: 0, mono: 0, other: 0 }, other: [], mono: [], canvases: 0, webviews: 0 };
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue;
      if (el.tagName === 'CANVAS') { const r = el.getBoundingClientRect(); if (r.width > 200 && r.height > 120) out.canvases++; continue; }
      if (el.tagName === 'WEBVIEW' || el.tagName === 'IFRAME') { out.webviews++; continue; }
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const fam = getComputedStyle(el).fontFamily;
      const first = fam.split(',')[0].trim().replace(/['"]/g, '');
      const zone = inDoc(el) ? 'content' : 'chrome';
      const kind = first.toLowerCase() === expected.toLowerCase() ? 'follows' : MONO.test(first) ? 'mono' : 'other';
      out[zone][kind]++;
      if (kind !== 'follows') {
        const key = `${kind}|${zone}|${first}|${where(el)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 40);
        out[kind].push({ zone, font: first, where: where(el), text });
      }
    }
    return out;
  }, expected);
}

const scenes = [];
let expectedFamily = 'Georgia';
async function scene(name, fn) {
  if (only && !only.test(name)) return;
  try {
    await fn();
    await settle();
    const file = `${String(scenes.length).padStart(3, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`;
    await page.screenshot({ path: path.join(shots, file) });
    scenes.push({ name, file, ...(await measure(expectedFamily)) });
    console.log('scene', name);
  } catch (e) {
    scenes.push({ name, error: String(e).slice(0, 300) });
    console.log('scene failed', name, String(e).slice(0, 200));
  }
}
const closeEditors = async () => {
  for (let i = 0; i < 20; i++) {
    const left = await page.locator('.editor-tab-bar .ui-tab').count().catch(() => 0);
    if (!left) break;
    await command('workbench.action.closeActiveEditor').catch(() => {});
    await page.waitForTimeout(60);
  }
};

let picked = null;
try {
  await page.waitForFunction(() => window.__parallx_workbench__?._services.get({ id: 'IToolEnablementService' }), undefined, { timeout: 60000 });
  await page.evaluate((ids) => { const s = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }); for (const id of ids) s.setEnablement(id, true); }, extIds);
  await page.reload();
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, undefined, { timeout: 60000 });
  await page.waitForTimeout(4000);

  // The real path: Settings, Appearance, the font chip.
  await command('settings.openAppearance');
  await page.waitForSelector('.px-font-chip', { timeout: 15000 });
  const chipLabels = await page.$$eval('.px-font-chip', (els) => els.map((e) => (e.getAttribute('aria-label') || '').toLowerCase()));
  const chipIndex = chipLabels.findIndex((l) => l.includes(fontId.toLowerCase()));
  if (chipIndex < 0) throw new Error(`no font chip for ${fontId}: ${chipLabels.join(', ')}`);
  await page.locator('.px-font-chip').nth(chipIndex).click();
  await settle(500);
  picked = await page.evaluate(() => ({
    rootVar: getComputedStyle(document.documentElement).getPropertyValue('--parallx-fontFamily-ui').trim(),
    pxFontUi: getComputedStyle(document.documentElement).getPropertyValue('--px-font-ui').trim(),
    saved: (() => { try { return JSON.parse(localStorage.getItem('px-appearance') || '{}').font ?? null; } catch { return null; } })(),
  }));
  expectedFamily = picked.rootVar.split(',')[0].trim().replace(/['"]/g, '') || expectedFamily;
  console.log('picked', JSON.stringify(picked));
  await scene('settings appearance (after picking)', async () => {});

  // Survives a restart of the window.
  await page.reload();
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, undefined, { timeout: 60000 });
  await page.waitForTimeout(3000);
  picked.afterReload = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--parallx-fontFamily-ui').trim());
  await scene('first-screen (after reload)', async () => {});

  // Documents.
  await scene('doc README.md', async () => {
    await closeEditors();
    await page.locator('.tree-node', { hasText: 'README.md' }).first().dblclick();
  });
  await scene('doc sample.ts', async () => {
    await closeEditors();
    await page.locator('.tree-node', { hasText: 'sample.ts' }).first().dblclick();
  });
  await scene('doc canvas page', async () => {
    await closeEditors();
    await command('canvas.newPage');
    await page.waitForTimeout(1500);
    await page.keyboard.type('A canvas paragraph to measure.');
  });
  await scene('doc worksheet', async () => { await closeEditors(); await command('worksheet.openScratch'); await page.waitForTimeout(2500); });

  // Every view, every Open/Show editor, panel tabs, palette, menus (as app-sweep).
  const acts = await page.evaluate(() => [...document.querySelectorAll('.activity-bar-item')].map((el, i) => ({ i, label: el.getAttribute('aria-label') || el.getAttribute('title') || `item-${i}` })));
  for (const a of acts) await scene(`view ${a.label}`, async () => { await page.locator('.activity-bar-item').nth(a.i).click(); });
  const cmds = await page.evaluate(() => {
    const m = window.__parallx_workbench__._services.get({ id: 'ICommandService' }).getCommands();
    return [...m.values()].map(c => ({ id: c.id, title: c.title || '' }))
      .filter(c => c.title && (/^(Open|Show)\b/i.test(c.title.replace(/^[^:]+:\s*/, '')) || /\.(open|show)[A-Z]/.test(c.id)))
      .filter(c => !/(file|folder|workspace|recent|external|devtools|logs?Folder|keybindings?File|url|address|inFinder|explorer|reveal|terminal|clipProject|openWith|toSide|picker|quickOpen|cacheStats|history$)/i.test(c.id + ' ' + c.title));
  });
  for (const c of cmds) {
    await scene(`cmd ${c.id} (${c.title})`, async () => {
      await closeEditors();
      await Promise.race([command(c.id), page.waitForTimeout(6000)]).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    });
  }
  await command('workbench.action.togglePanel').catch(() => {});
  const panelSel = '.panel-views .view-tab, .panel-content .view-tab';
  const panelTabs = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el, i) => ({ i, label: (el.getAttribute('aria-label') || el.textContent || '').trim() || `tab-${i}` })), panelSel);
  for (const t of panelTabs) await scene(`panel ${t.label}`, async () => { await page.locator(panelSel).nth(t.i).click(); });
  await scene('command-palette', async () => { await page.keyboard.press('Escape'); await command('workbench.action.showCommands').catch(() => page.keyboard.press('Control+Shift+P')); });
  await page.keyboard.press('Escape');
  await scene('context menu (explorer)', async () => { await page.locator('.activity-bar-item').first().click(); await page.locator('.tree-node', { hasText: 'README.md' }).first().click({ button: 'right' }); });
  await page.keyboard.press('Escape');
  const menus = await page.evaluate(() => [...document.querySelectorAll('.titlebar-menu-item, .menubar-menu-button, [role="menubar"] > *')].map((el, i) => ({ i, label: (el.textContent || '').trim() })).filter(m => m.label));
  for (const m of menus) await scene(`menu ${m.label}`, async () => { await page.keyboard.press('Escape'); await page.locator('.titlebar-menu-item, .menubar-menu-button, [role="menubar"] > *').nth(m.i).click(); });
  await page.keyboard.press('Escape');
} catch (e) {
  console.error(e);
} finally {
  // Every distinct element that did not follow, with the scenes it showed in.
  const misses = new Map();
  for (const s of scenes) for (const o of s.other || []) {
    const key = `${o.zone}|${o.font}|${o.where}`;
    if (!misses.has(key)) misses.set(key, { ...o, scenes: [] });
    misses.get(key).scenes.push(s.name);
  }
  const monos = new Map();
  for (const s of scenes) for (const o of s.mono || []) {
    const key = `${o.zone}|${o.where}`;
    if (!monos.has(key)) monos.set(key, { ...o, scenes: [] });
    monos.get(key).scenes.push(s.name);
  }
  const summary = { font: fontId, expectedFamily, picked, scenes: scenes.length, misses: [...misses.values()].sort((a, b) => b.scenes.length - a.scenes.length), mono: [...monos.values()].sort((a, b) => b.scenes.length - a.scenes.length) };
  await fs.writeFile(path.join(root, 'fonts.json'), JSON.stringify({ summary, scenes }, null, 2));
  console.log('font reach in', root, 'scenes', scenes.length, 'distinct misses', misses.size);
  await app.close().catch(() => {});
}
