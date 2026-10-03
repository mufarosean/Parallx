// Every surface of the app, seen and measured.
//
//   node tests/ui-polish/app-sweep.mjs [--light] [--width=1440] [--height=900] [--only=regex]
//
// Launches the built app (run `node scripts/build.mjs` first) with a new
// profile and workspace under test-results/ui-polish/, installs and enables
// every extension in ext/, then opens each activity-bar view, each command
// titled "Open …"/"Show …" (and a few core surfaces), and each bottom-panel
// tab. For every scene it saves a screenshot and measures the visible chrome:
// distinct font sizes and families, buttons off the 22/24/28/32 height
// ladder, accent-filled (primary) buttons, native <select>s, uppercase or
// letter-spaced labels, and dropdown-like triggers that are not the core
// `.ui-dropdown`. Results go to scenes.json beside the shots. No user profile
// or workspace is read. On Linux without a display, run under xvfb-run.
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const light = Boolean(args.light);
const width = Number(args.width) || 1440;
const height = Number(args.height) || 900;
const only = args.only ? new RegExp(String(args.only)) : null;

const outRoot = path.join(repo, 'test-results/ui-polish');
await fs.mkdir(outRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(outRoot, `app-sweep-${light ? 'light' : 'dark'}-`));
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
await fs.writeFile(path.join(workspace, 'README.md'), '# Sweep workspace\n\nSynthetic content.\n\n- a list\n- of things\n');
await fs.mkdir(path.join(workspace, 'notes'), { recursive: true });
await fs.writeFile(path.join(workspace, 'notes/ideas.md'), '# Ideas\n\nSome text with a [link](https://example.com).\n');

const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
let page = await app.firstWindow();
const errors = [];
const watch = (p) => {
  p.on('pageerror', e => errors.push({ scene: current, text: String(e) }));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Ollama|11434/.test(m.text())) errors.push({ scene: current, text: m.text().slice(0, 400) }); });
};
let current = 'boot';
watch(page);
await app.evaluate(({ BrowserWindow }, { width, height }) => { BrowserWindow.getAllWindows()[0].setSize(width, height); }, { width, height });
await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });

const command = (id, ...a) => page.evaluate(({ id, a }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...a), { id, a });
const settle = async (ms = 700) => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(ms); };

// Per-scene measurement of the visible chrome.
async function measure() {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const textEls = [...document.querySelectorAll('body *')].filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && vis(el));
    const inDoc = (el) => el.closest('.ProseMirror, .canvas-tiptap-editor, .monaco-editor, .xterm, .cm-editor, webview');
    const sizes = new Map(), fams = new Map(), weights = new Map();
    let upper = [], spaced = [];
    for (const el of textEls) {
      if (inDoc(el)) continue;
      const cs = getComputedStyle(el);
      const fs = cs.fontSize;
      sizes.set(fs, (sizes.get(fs) || 0) + 1);
      fams.set(cs.fontFamily.split(',')[0].trim(), (fams.get(cs.fontFamily.split(',')[0].trim()) || 0) + 1);
      weights.set(cs.fontWeight, (weights.get(cs.fontWeight) || 0) + 1);
      const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 60);
      if (cs.textTransform === 'uppercase' && /[a-z]/i.test(t)) upper.push(t);
      if (parseFloat(cs.letterSpacing) > 0.3 && t.length > 1) spaced.push(t);
    }
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--px-accent').trim();
    const probe = document.createElement('div'); probe.style.background = accent; document.body.appendChild(probe);
    const accentRgb = getComputedStyle(probe).backgroundColor; probe.remove();
    const buttons = [...document.querySelectorAll('button, [role="button"], a.button, input[type="button"], input[type="submit"]')].filter(vis).filter(b => !inDoc(b));
    const ladder = new Set([22, 24, 28, 32]);
    const offLadder = [], primaries = [], radii = new Map(), btnSizes = new Map();
    for (const b of buttons) {
      const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
      const label = (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const h = Math.round(r.height);
      const hasBox = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopWidth) > 0;
      if (hasBox && !ladder.has(h) && h < 60) offLadder.push(`${h}px ${label}`);
      if (cs.backgroundColor === accentRgb) primaries.push(label);
      if (hasBox) radii.set(cs.borderTopLeftRadius, (radii.get(cs.borderTopLeftRadius) || 0) + 1);
      if (hasBox && b.textContent.trim()) btnSizes.set(cs.fontSize, (btnSizes.get(cs.fontSize) || 0) + 1);
    }
    const selects = [...document.querySelectorAll('select')].filter(vis).length;
    // Dropdown-like triggers: text ending in ▾/▼/⌄ or a chevron-down, not inside the core .ui-dropdown.
    const ddLike = [...document.querySelectorAll('button, [role="button"], [aria-haspopup]')].filter(vis)
      .filter(b => /[▾▼⌄]\s*$/.test(b.textContent.trim()) || b.querySelector('[data-icon="chevron-down"], .codicon-chevron-down') || b.getAttribute('aria-haspopup'))
      .filter(b => !b.closest('.ui-dropdown')).map(b => (b.className || '').toString().split(' ')[0] + ':' + b.textContent.trim().slice(0, 30));
    const coreDd = [...document.querySelectorAll('.ui-dropdown')].filter(vis).length;
    const emoji = textEls.filter(el => !inDoc(el)).map(el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('')).filter(t => /\p{Extended_Pictographic}/u.test(t)).map(t => t.trim().slice(0, 40));
    const dashLabels = buttons.map(b => b.textContent.trim()).filter(t => /—/.test(t)).slice(0, 10);
    const threeDots = [...buttons, ...document.querySelectorAll('[role="menuitem"]')].map(b => b.textContent.trim()).filter(t => /\.\.\.$/.test(t)).slice(0, 10);
    const sort = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
    return {
      fontSizes: sort(sizes), fontFamilies: sort(fams), fontWeights: sort(weights), buttonFontSizes: sort(btnSizes), buttonRadii: sort(radii),
      buttons: buttons.length, offLadder: offLadder.slice(0, 25), offLadderCount: offLadder.length,
      primaries, selects, upper: upper.slice(0, 15), spaced: spaced.slice(0, 15), ddLike: ddLike.slice(0, 15), coreDd,
      emoji: emoji.slice(0, 10), dashLabels, threeDots,
    };
  });
}

const scenes = [];
async function scene(name, fn) {
  if (only && !only.test(name)) return;
  current = name;
  try {
    await fn();
    await settle();
    const file = `${String(scenes.length).padStart(3, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`;
    await page.screenshot({ path: path.join(shots, file) });
    scenes.push({ name, file, ...(await measure()) });
    console.log('scene', name);
  } catch (e) {
    scenes.push({ name, error: String(e).slice(0, 300) });
    console.log('scene failed', name, String(e).slice(0, 200));
  }
}

try {
  await page.waitForFunction(() => window.__parallx_workbench__?._services.get({ id: 'IToolEnablementService' }), undefined, { timeout: 60000 });
  await page.evaluate((ids) => { const s = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }); for (const id of ids) s.setEnablement(id, true); }, extIds);
  await page.reload();
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForTimeout(4000);
  if (light) await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));

  await scene('first-screen', async () => {});

  // Activity bar views.
  const acts = await page.evaluate(() => [...document.querySelectorAll('.activity-bar-item')].map((el, i) => ({ i, label: el.getAttribute('aria-label') || el.getAttribute('title') || el.dataset.iconId || `item-${i}` })));
  for (const a of acts) {
    await scene(`view ${a.label}`, async () => { await page.locator('.activity-bar-item').nth(a.i).click(); });
  }

  // Editors: every titled Open/Show command, plus core surfaces.
  const cmds = await page.evaluate(() => {
    const m = window.__parallx_workbench__._services.get({ id: 'ICommandService' }).getCommands();
    return [...m.values()].map(c => ({ id: c.id, title: c.title || '' }))
      .filter(c => c.title && (/^(Open|Show)\b/i.test(c.title.replace(/^[^:]+:\s*/, '')) || /\.(open|show)[A-Z]/.test(c.id)))
      .filter(c => !/(file|folder|workspace|recent|external|devtools|logs?Folder|keybindings?File|url|address|inFinder|explorer|reveal|terminal|clipProject|openWith|toSide|picker|quickOpen|cacheStats|history$)/i.test(c.id + ' ' + c.title));
  });
  for (const c of cmds) {
    await scene(`cmd ${c.id} (${c.title})`, async () => {
      // No close-all command exists: close the active editor until none is left.
      for (let i = 0; i < 20; i++) {
        const left = await page.locator('.editor-tab-bar .ui-tab').count().catch(() => 0);
        if (!left) break;
        await command('workbench.action.closeActiveEditor').catch(() => {});
        await page.waitForTimeout(60);
      }
      await Promise.race([command(c.id), page.waitForTimeout(6000)]).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    });
  }

  // Bottom panel tabs.
  await command('workbench.action.togglePanel').catch(() => {});
  const panelSel = '.panel-views .view-tab, .panel-content .view-tab';
  const panelTabs = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el, i) => ({ i, label: (el.getAttribute('aria-label') || el.textContent || '').trim() || `tab-${i}` })), panelSel);
  for (const t of panelTabs) {
    await scene(`panel ${t.label}`, async () => { await page.locator(panelSel).nth(t.i).click(); });
  }

  // The command palette and the title-bar menus.
  await scene('command-palette', async () => { await page.keyboard.press('Escape'); await command('workbench.action.showCommands').catch(() => page.keyboard.press('Control+Shift+P')); });
  await page.keyboard.press('Escape');
  const menus = await page.evaluate(() => [...document.querySelectorAll('.titlebar-menu-item, .menubar-menu-button, [role="menubar"] > *')].map((el, i) => ({ i, label: (el.textContent || '').trim() })).filter(m => m.label));
  for (const m of menus) {
    await scene(`menu ${m.label}`, async () => { await page.keyboard.press('Escape'); await page.locator('.titlebar-menu-item, .menubar-menu-button, [role="menubar"] > *').nth(m.i).click(); });
  }
  await page.keyboard.press('Escape');
} catch (e) {
  console.error(e);
} finally {
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify(scenes, null, 2));
  await fs.writeFile(path.join(root, 'errors.json'), JSON.stringify(errors, null, 2));
  console.log('sweep in', root, 'scenes', scenes.length, 'errors', errors.length);
  await app.close().catch(() => {});
}
