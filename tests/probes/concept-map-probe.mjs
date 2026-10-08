// Hidden-window probe for the canvas concept map block (ui/conceptMap,
// canvas/extensions/conceptMapNode). Opens a map the way chat sends one
// (canvas.saveConceptMap), then drives the real pointer and keys: select,
// add to the selection, frame-select, drag a branch to the board and check
// it stays exactly where it was let go, drop a branch onto another box to
// move it under it, reorder and re-nest with Alt and the arrows, delete,
// undo. Prints PASS or FAIL per check and shoots each stage.
// Usage: xvfb-run -a node tests/probes/concept-map-probe.mjs <outDir>
// (run `npm run build` first; the native sqlite module must be built for
// Electron: npx electron-rebuild -f -w better-sqlite3)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-concept-map'));

const SRC = [
  'Reserving',
  '  Chain Ladder',
  '    Mack',
  '    Bootstrap',
  '  Bornhuetter',
  '    Prior',
  '  Cape Cod',
].join('\n');

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-cm-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-cm-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Ollama|11434/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
  let fails = 0;
  const check = (ok, what) => { if (!ok) fails++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const shot = async (name) => {
    const file = path.join(outDir, name);
    await page.evaluate(() => { const d = document.getElementById('__probe_repaint') || document.body.appendChild(Object.assign(document.createElement('div'), { id: '__probe_repaint', style: 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none' })); d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01'; }).catch(() => {});
    try { await page.screenshot({ path: file, timeout: 8_000, animations: 'disabled' }); console.log(`[probe] screenshot -> ${file}`); return; } catch { /* fall back */ }
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : null;
    }).catch(() => null);
    if (png) { await fs.writeFile(file, Buffer.from(png, 'base64')); console.log(`[probe] screenshot (capturePage) -> ${file}`); }
    else console.log(`[probe] screenshot FAILED ${name}`);
  };
  // A point on the board with no box and no tool under it.
  const emptySpot = () => page.evaluate(() => {
    const svg = document.querySelector('.canvas-conceptmap svg');
    const r = svg.getBoundingClientRect();
    for (let y = r.bottom - 10; y > r.top + 40; y -= 12) {
      for (let x = r.left + 10; x < r.right - 10; x += 12) {
        const el = document.elementFromPoint(x, y);
        if (el && svg.contains(el) && !el.closest('.parallx-mindmap__node')) return { x, y };
      }
    }
    return null;
  });
  const run = (id, ...args) => page.evaluate(async ({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    try { return await svc.executeCommand(id, ...args); } catch (e) { return `failed: ${String(e).slice(0, 160)}`; }
  }, { id, args });

  const box = (label) => page.locator(`.canvas-conceptmap .parallx-mindmap__node[data-mindmap-label="${label}"] .parallx-mindmap__box`).first();
  // Where a box is DRAWN: the board's screen position plus the box's own
  // coordinates (the map is at real size). A box dragged past the board's
  // edge is drawn outside it, where the browser's own box measure is off.
  const rectOf = (label) => page.$eval('.canvas-conceptmap svg', (svg, l) => {
    const r = svg.getBoundingClientRect();
    const b = [...svg.querySelectorAll('.parallx-mindmap__node')].find((g) => g.getAttribute('data-mindmap-label') === l)?.querySelector('.parallx-mindmap__box');
    if (!b) return null;
    return { x: r.x + Number(b.getAttribute('x')), y: r.y + Number(b.getAttribute('y')), width: Number(b.getAttribute('width')), height: Number(b.getAttribute('height')) };
  }, label);
  // A wide map scrolls sideways inside its block: bring the box into view first, as a user would.
  const centre = async (label) => {
    await box(label).scrollIntoViewIfNeeded().catch(() => {});
    const r = await rectOf(label);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const selectedLabels = () => page.$$eval('.canvas-conceptmap .parallx-mindmap__node--selected', (gs) => gs.map((g) => g.getAttribute('data-mindmap-label')).sort());
  // The outline, read the way a user would: Edit Outline, read, Done.
  const outline = async () => {
    await page.locator('.canvas-conceptmap').hover();
    await page.locator('.canvas-conceptmap__tool', { hasText: 'Edit Outline' }).click();
    const ta = page.locator('.canvas-conceptmap__editor');
    await ta.waitFor({ timeout: 5_000 });
    const v = await ta.inputValue();
    await page.locator('.canvas-conceptmap__tool', { hasText: 'Done' }).click();
    await page.waitForTimeout(400);
    return v;
  };
  const drag = async (from, to, { steps = 12, hold = null } = {}) => {
    await page.mouse.move(from.x, from.y);
    if (hold) await page.keyboard.down(hold);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 6, { steps: 2 });
    await page.mouse.move(to.x, to.y, { steps });
    await page.waitForTimeout(150);
    const before = {};
    for (const l of ['Chain Ladder', 'Mack', 'Bootstrap', 'Cape Cod', 'Prior', 'Bornhuetter', 'Reserving']) before[l] = await rectOf(l).catch(() => null);
    await page.mouse.up();
    if (hold) await page.keyboard.up(hold);
    await page.waitForTimeout(500);
    return before;
  };

  try {
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    const pageId = await run('canvas.saveConceptMap', SRC, 'right');
    check(typeof pageId === 'string', `a map sent the way chat sends one opens on a page (${pageId})`);
    await page.waitForSelector('.canvas-conceptmap .parallx-mindmap__node', { timeout: 15_000 });
    await page.waitForTimeout(1_000);
    await shot('01-opened.png');

    // Real size: one map unit per pixel, so the grid is 18px on every map.
    const scale = await page.$eval('.canvas-conceptmap svg', (svg) => svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
    check(Math.abs(scale - 1) < 0.01, `the map draws at real size (scale ${scale.toFixed(3)})`);

    // 1. Click selects; Shift-click adds; a click on the board clears.
    await page.mouse.click(...Object.values(await centre('Mack')));
    check(JSON.stringify(await selectedLabels()) === '["Mack"]', 'a click selects one box');
    const b = await centre('Bootstrap');
    await page.keyboard.down('Shift'); await page.mouse.click(b.x, b.y); await page.keyboard.up('Shift');
    check(JSON.stringify(await selectedLabels()) === '["Bootstrap","Mack"]', 'Shift-click adds a second box');
    const blank = await emptySpot();
    await page.mouse.click(blank.x, blank.y);
    check((await selectedLabels()).length === 0 && await page.locator('.canvas-conceptmap__editor').count() === 0, 'a click on the empty board clears the selection');

    // 2. A frame across the board selects every box it touches.
    const m = await rectOf('Mack');
    const p = await rectOf('Prior');
    await page.mouse.move(m.x - 24, m.y - 12);
    await page.mouse.down();
    await page.mouse.move(p.x + 20, p.y + p.height + 6, { steps: 8 });
    await shot('02-frame.png');
    await page.mouse.up();
    const framed = await selectedLabels();
    check(['Bootstrap', 'Mack', 'Prior'].every((l) => framed.includes(l)), `a frame selects the boxes it touches (${framed.join(', ')})`);
    const blank2 = await emptySpot();
    await page.mouse.click(blank2.x, blank2.y);

    // 3. Drag a branch to the board: it carries its children, lands on the
    //    grid, and stays EXACTLY where it was let go (nothing jumps).
    const cl0 = await rectOf('Chain Ladder');
    const mack0 = await rectOf('Mack');
    const capeCod0 = await rectOf('Cape Cod');
    const before = await drag(await centre('Chain Ladder'), { x: cl0.x + cl0.width / 2 + 200, y: cl0.y + cl0.height / 2 + 300 });
    const cl1 = await rectOf('Chain Ladder');
    const mack1 = await rectOf('Mack');
    const capeCod1 = await rectOf('Cape Cod');
    check(Math.abs(cl1.x - before['Chain Ladder'].x) < 1.5 && Math.abs(cl1.y - before['Chain Ladder'].y) < 1.5,
      `the dropped box stays where it was let go (moved ${Math.round(cl1.x - cl0.x)}, ${Math.round(cl1.y - cl0.y)})`);
    check(Math.abs((mack1.x - mack0.x) - (cl1.x - cl0.x)) < 1.5 && Math.abs((mack1.y - mack0.y) - (cl1.y - cl0.y)) < 1.5, 'its children moved with it');
    check(Math.abs(capeCod1.x - capeCod0.x) < 1.5 && Math.abs(capeCod1.y - capeCod0.y) < 1.5, 'boxes outside the branch did not move');
    const onGrid = await page.$$eval('.canvas-conceptmap .parallx-mindmap__box', (rs) => rs.every((r) => Number(r.getAttribute('x')) % 18 === 0 && Number(r.getAttribute('y')) % 18 === 0));
    check(onGrid, 'every box edge sits on the 18px grid after the move');
    await shot('03-moved-branch.png');

    // 4. Drag the topmost box down: the rest of the board must not jump.
    const res0 = await rectOf('Reserving');
    const bh0 = await rectOf('Bornhuetter');
    const tb = await drag(await centre('Reserving'), { x: res0.x + res0.width / 2 + 36, y: res0.y + res0.height / 2 + 108 });
    const res1 = await rectOf('Reserving');
    check(Math.abs(res1.y - tb['Reserving'].y) < 1.5, 'moving the root also lands where it was let go');
    const bh1 = await rectOf('Bornhuetter');
    check(Math.abs((bh1.y - bh0.y) - (res1.y - res0.y)) < 1.5, 'moving the root carries the whole map');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    const res2 = await rectOf('Reserving');
    check(Math.abs(res2.y - res0.y) < 1.5, 'Ctrl+Z on the map undoes the move');

    // 5. Drop a branch onto another box: it moves under that box.
    const target = await centre('Bornhuetter');
    await drag(await centre('Cape Cod'), target, { steps: 16 });
    let out = await outline();
    check(/ {2}Bornhuetter\n {4}Prior\n {4}Cape Cod/.test(out), `dropping a box on another moves it under it:\n${out}`);
    await shot('04-reparented.png');

    // 6. Reset Layout brings every box back; then several at once: select
    //    Mack and Bootstrap and drop them on Cape Cod.
    const blank3 = await emptySpot();
    await page.mouse.click(blank3.x, blank3.y);
    await page.locator('.canvas-conceptmap').hover();
    await page.locator('.canvas-conceptmap__tool', { hasText: 'Reset Layout' }).click();
    await page.waitForTimeout(500);
    check(await page.locator('.canvas-conceptmap__tool', { hasText: /^Reset/ }).isHidden(), 'Reset Layout puts every box back (and hides itself)');
    await page.mouse.click(...Object.values(await centre('Mack')));
    const bb = await centre('Bootstrap');
    await page.keyboard.down('Shift'); await page.mouse.click(bb.x, bb.y); await page.keyboard.up('Shift');
    await page.mouse.move(...Object.values(await centre('Mack')));
    await page.mouse.down();
    const cc = await centre('Cape Cod');
    await page.mouse.move(cc.x - 30, cc.y - 30, { steps: 6 });
    await page.mouse.move(cc.x, cc.y, { steps: 6 });
    await page.waitForTimeout(150);
    const noteText = await page.locator('.canvas-conceptmap__dropnote').textContent().catch(() => '');
    check(/Move under .Cape Cod./.test(noteText || ''), `while dragging, the target says what will happen ("${noteText}")`);
    await shot('05-drop-target.png');
    await page.mouse.up();
    await page.waitForTimeout(500);
    out = await outline();
    check(/ {4}Cape Cod\n {6}Mack\n {6}Bootstrap/.test(out), `two selected boxes move under a box together:\n${out}`);

    // 7. Keys: Alt+Up reorders, Alt+Left outdents, Delete removes, Escape clears.
    await page.mouse.click(...Object.values(await centre('Bootstrap')));
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForTimeout(400);
    out = await outline();
    check(/ {6}Bootstrap\n {6}Mack/.test(out), 'Alt+Up moves a box above its sibling');
    check(JSON.stringify(await selectedLabels()) === '["Bootstrap"]', 'the moved box stays selected');
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForTimeout(400);
    out = await outline();
    check(/ {4}Cape Cod\n {6}Mack\n {4}Bootstrap/.test(out), `Alt+Left lifts a box out a level:\n${out}`);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(400);
    out = await outline();
    check(!out.includes('Bootstrap') && out.includes('Mack'), 'Delete removes the selected box');
    check(await page.locator('.canvas-conceptmap').count() === 1, 'the map block itself is still on the page');

    // 8. Click a selected box to edit it in place.
    await page.mouse.click(...Object.values(await centre('Mack')));
    await page.mouse.click(...Object.values(await centre('Mack')));
    const editing = await page.locator('.canvas-conceptmap__boxedit').count();
    check(editing === 1, 'a click on the selected box opens it for editing');
    await page.keyboard.press('Escape');
    await shot('06-final.png');

    // Light mode, for the selection colour.
    await page.mouse.click(...Object.values(await centre('Prior')));
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(400);
    await shot('07-light.png');
  } finally {
    console.log(errors.length ? `[probe] ${errors.length} renderer error(s):\n  ${errors.join('\n  ')}` : '[probe] no renderer errors');
    console.log(`[probe] ${fails === 0 ? 'ALL PASS' : `${fails} FAILED`}`);
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
