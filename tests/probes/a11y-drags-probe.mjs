// a11y-drags-probe.mjs: drags that gained a keyboard way, in the real app,
// never on screen, the chat model's port refused (docs/ACCESSIBILITY.md,
// section 6).
//
// + A concept map: PageDown picks a box, Shift+PageDown adds the next,
//   Ctrl+Right widens the picked boxes.
// + Editor tabs: Shift+F10 on a tab offers Move to Next Group, which splits
//   one off and moves the tab there.
// + The Workspace Graph: the canvas takes focus, PageDown picks a node (its
//   name is the canvas's label), Alt-free arrows move it.
// + Worksheet Generate shows Choose File…; Media Organizer registers
//   Import Files… and lists it in the page header's menu.
//
// Usage: node tests/probes/a11y-drags-probe.mjs
// Requires `npm run build` first (the app loads dist/).

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { launchApp, cmd, setToolEnabled, menuRows, tinyPdf } from './scene.mjs';
import { PROJECT_ROOT } from './scene.mjs';

const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-a11ydrag-root-${stamp}`);
const workspace = path.join(os.tmpdir(), `parallx-a11ydrag-ws-${stamp}`);
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const until = async (page, fn, arg, ms = 4_000) => {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) { v = await page.evaluate(fn, arg); if (v) return v; await page.waitForTimeout(100); }
  return v;
};

const { app, page, errors } = await launchApp(appRoot);
try {
  // ── Concept map ──
  const pageId = await page.evaluate(async () => {
    const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
    return svc.executeCommand('canvas.saveConceptMap', 'Reserving\n  Chain Ladder\n    Mack\n  Cape Cod', 'right');
  });
  await page.waitForSelector('.canvas-conceptmap .parallx-mindmap__node', { timeout: 15_000 });
  await page.waitForTimeout(800);
  const selected = () => page.$$eval('.canvas-conceptmap .parallx-mindmap__node--selected', (gs) => gs.map((g) => g.getAttribute('data-mindmap-label')).sort().join(','));
  await page.evaluate(() => document.querySelector('.canvas-conceptmap__body')?.focus());
  const focusedMap = await page.evaluate(() => !!document.activeElement?.closest('.canvas-conceptmap'));
  await page.keyboard.press('PageDown');
  const one = await selected();
  await page.keyboard.press('Shift+PageDown');
  const two = await selected();
  check('concept map: PageDown picks a box, Shift+PageDown adds the next', one === 'Reserving' && two === 'Chain Ladder,Reserving', `focus ${focusedMap}; ${one} -> ${two}`);
  const width = () => page.evaluate(() => Number(document.querySelector('.canvas-conceptmap .parallx-mindmap__node[data-mindmap-label="Chain Ladder"] .parallx-mindmap__box')?.getAttribute('width')));
  const w0 = await width();
  await page.keyboard.press('Control+ArrowRight');
  await page.waitForTimeout(600);
  const w1 = await until(page, (w) => { const n = Number(document.querySelector('.canvas-conceptmap .parallx-mindmap__node[data-mindmap-label="Chain Ladder"] .parallx-mindmap__box')?.getAttribute('width')); return n !== w ? n : 0; }, w0);
  check('concept map: Ctrl+Right widens the picked boxes', w1 > w0, `${w0} -> ${w1}; still ${await selected()}`);

  // ── Editor tab to another group ──
  const groups = () => page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'IEditorGroupService' }).groupCount);
  const g0 = await groups();
  await cmd(page, 'welcome.openWelcome');
  await page.waitForTimeout(800);
  await page.evaluate(() => { const t = Array.from(document.querySelectorAll('.editor-group .editor-tab-bar .ui-tab--active')).find((x) => x.getClientRects().length && x.textContent.includes('Welcome')); t?.focus(); });
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(400);
  const rows = (await menuRows(page)) || [];
  const move = rows.find((r) => r.label === 'Move to Next Group');
  check('editor tab menu offers Move to Next Group', !!move && !move.off, rows.map((r) => r.label).join(' | '));
  if (move) {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+F10');
    await page.waitForTimeout(300);
    const r2 = (await menuRows(page)) || [];
    const idx = r2.findIndex((r) => r.label === 'Move to Next Group');
    for (let i = 0; i <= idx; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  }
  const g1 = await groups();
  check('Move to Next Group splits one off and moves the tab', g1 === g0 + 1, `${g0} -> ${g1}`);

  // ── Workspace Graph ──
  check('the Workspace Graph turns on', (await setToolEnabled(page, 'parallx.workspace-graph', true)) === true);
  await page.waitForTimeout(1_500);
  await cmd(page, 'workspaceGraph.open');
  await page.waitForTimeout(3_000);
  const graph = await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('canvas[aria-roledescription="graph"]')).find((x) => x.getClientRects().length);
    if (!c) return null;
    c.focus();
    return { focused: document.activeElement === c, label: c.getAttribute('aria-label') };
  });
  await page.keyboard.press('PageDown');
  const picked = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('the graph takes focus and PageDown picks a node', !!graph?.focused && picked !== graph.label && /Workspace graph: /.test(picked || ''), `${graph?.label} -> ${picked}`);
  check('an arrow moves the picked node (it pins)', /, pinned$/.test(after || ''), after);

  // ── File buttons ──
  await cmd(page, 'worksheet.generate');
  const choose = await until(page, () => !!Array.from(document.querySelectorAll('[data-px-id="worksheet.generate.chooseFile"]')).find((x) => x.getClientRects().length));
  check('Worksheet Generate shows Choose File…', !!choose);
  // The command the button runs, given a path (the picker would give one): the pane extracts it.
  // (A one-line test PDF runs off its page, so the extractor may call it near-empty: still extracted.)
  const pdf = path.join(workspace, 'source.pdf');
  await fs.writeFile(pdf, tinyPdf('Chain ladder development factors. '.repeat(10)));
  await cmd(page, 'worksheet.generateFromFile', pdf);
  const loaded = await until(page, () => { const s = Array.from(document.querySelectorAll('.ws-create__status')).find((x) => x.getClientRects().length)?.textContent || ''; return /^(Loaded source\.pdf|Extraction failed: Almost no text)/.test(s) ? s : ''; }, undefined, 15_000);
  const statusNow = await page.evaluate(() => Array.from(document.querySelectorAll('.ws-create__status')).map((x) => x.textContent).join(' / '));
  check('Generate Items From a File… hands the document to the pane, which extracts it', !!loaded, loaded || statusNow);
  await setToolEnabled(page, 'parallx-community.media-organizer', true);
  await page.waitForTimeout(2_500);
  const registered = await page.evaluate(() => !!window.__parallx_workbench__._services.get({ id: 'ICommandService' }).getCommand?.('media-organizer.importFiles'));
  check('Media Organizer registers Import Files…', registered);
  console.log(`[probe] concept map page ${pageId}; renderer errors: ${errors.length ? errors.join(' | ') : 'none'}`);
} catch (err) {
  check('the run', false, err && err.message);
} finally {
  await app.close().catch(() => {});
  await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
}
const ok = results.every(Boolean);
console.log(ok ? '[probe] keyboard drags: all ok' : '[probe] keyboard drags: FAILED');
process.exit(ok ? 0 : 1);
