// part-glide-probe.mjs — the sidebar, the right sidebar and the panel glide
// open and shut in the built app, the space moving with them.
//
// New profile under test-results/. Toggles each part and samples every
// animation frame: the part's box, its content and the editor beside it.
// The box must pass through in-between sizes in order, the editor's edge must
// sit against the part's moving edge on EVERY frame (the old hide removed the
// box only after the content had slid away, so the editor jumped late), and
// the content must keep its full size, riding that edge. Toggling mid-glide
// must reverse.
//   node scripts/build.mjs && xvfb-run -a node tests/probes/part-glide-probe.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
await fs.mkdir(path.join(repo, 'test-results'), { recursive: true });
const root = await fs.mkdtemp(path.join(repo, 'test-results', 'part-glide-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx')]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;
const results = [];
const check = (label, ok, detail) => { results.push(ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`); };
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });

const SIDEBAR = 'workbench.parts.sidebar';
const AUX = 'workbench.parts.auxiliarybar';
const PANEL = 'workbench.parts.panel';

try {
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // Samples one toggle: a frame before, the synchronous state right after the
  // call, then every animation frame for 600ms. `reverseAfter` toggles again
  // that many ms in.
  const glide = (partId, method, reverseAfter) => page.evaluate(({ partId, method, reverseAfter }) => new Promise((resolve) => {
    const wb = window.__parallx_workbench__;
    const rect = (el) => {
      if (!el || !el.isConnected || el.classList.contains('hidden')) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const read = () => {
      const part = document.querySelector(`[data-part-id="${partId}"]`);
      return {
        box: rect(part),
        content: rect(part?.querySelector(':scope > .part-content')),
        editor: rect(document.querySelector('[data-part-id="workbench.parts.editor"]')),
      };
    };
    const samples = [read()];
    const t0 = performance.now();
    wb[method]();
    const afterCall = { ...read(), visible: wb.isPartVisible(partId) };
    let reversed = false;
    const tick = () => {
      const t = performance.now() - t0;
      if (reverseAfter !== undefined && !reversed && t >= reverseAfter) { reversed = true; wb[method](); }
      samples.push({ ...read(), t });
      if (t < 600) requestAnimationFrame(tick);
      else resolve({ samples, afterCall, visibleAtEnd: wb.isPartVisible(partId), visibility: document.visibilityState });
    };
    requestAnimationFrame(tick);
  }), { partId, method, reverseAfter });

  const ensure = (partId, method, shown) => page.evaluate(({ partId, method, shown }) => {
    const wb = window.__parallx_workbench__;
    if (wb.isPartVisible(partId) !== shown) wb[method](false);
  }, { partId, method, shown });

  // side: which of the part's edges moves ('right' for the left sidebar),
  // axis: 'w' or 'h'.
  const judge = (name, run, { opening, side, axis }) => {
    const size = (s) => s.box ? s.box[axis] : 0;
    const sizes = run.samples.map(size);
    const full = opening ? sizes[sizes.length - 1] : sizes[0];
    const between = sizes.filter((v) => v > 2 && v < full - 2);
    check(`${name}: the box passes through in-between sizes`, between.length >= 3, { frames: run.samples.length, between: between.length, full, visibility: run.visibility });
    const ordered = sizes.every((v, i) => i === 0 || (opening ? v >= sizes[i - 1] - 0.5 : v <= sizes[i - 1] + 0.5));
    check(`${name}: in order, ${opening ? 'growing' : 'shrinking'} every frame`, ordered, sizes.map((v) => Math.round(v)));
    // The editor's edge against the part's moving edge, every frame.
    const base = run.samples[opening ? run.samples.length - 1 : 0];
    const gapOf = (s) => {
      if (!s.box || !s.editor) return undefined;
      if (side === 'right') return s.editor.x - (s.box.x + s.box.w);
      if (side === 'left') return s.box.x - (s.editor.x + s.editor.w);
      return s.box.y - (s.editor.y + s.editor.h);
    };
    const gap = gapOf(base);
    const drift = run.samples.filter((s) => s.box && s.box[axis] > 0).map((s) => Math.abs(gapOf(s) - gap));
    check(`${name}: the editor's edge rides the part's edge on every frame`, drift.length > 0 && Math.max(...drift) <= 1.5, { gap, maxDrift: Math.max(...drift) });
    // The content keeps its full size and stays against the moving edge.
    const moving = run.samples.filter((s) => s.box && s.content && s.box[axis] > 2 && s.box[axis] < full - 2);
    const fullContent = moving.every((s) => Math.abs(s.content[axis] - full) <= 1.5);
    const anchored = moving.every((s) => {
      if (side === 'right') return Math.abs((s.content.x + s.content.w) - (s.box.x + s.box.w)) <= 1.5;
      if (side === 'left') return Math.abs(s.content.x - s.box.x) <= 1.5;
      return Math.abs(s.content.y - s.box.y) <= 1.5 + 40; // under its tab strip
    });
    check(`${name}: the content holds its full size and rides the moving edge`, moving.length > 0 && fullContent && anchored,
      moving.slice(0, 3).map((s) => ({ box: Math.round(s.box[axis]), content: Math.round(s.content[axis]) })));
  };

  // Sidebar
  await ensure(SIDEBAR, 'toggleSidebar', true);
  await page.waitForTimeout(300);
  let run = await glide(SIDEBAR, 'toggleSidebar');
  check('sidebar hide: reads hidden at once, still on screen', run.afterCall.visible === false && !!run.afterCall.box);
  judge('sidebar hide', run, { opening: false, side: 'right', axis: 'w' });
  check('sidebar hide: gone at the end, the editor at the left', !run.samples[run.samples.length - 1].box);
  run = await glide(SIDEBAR, 'toggleSidebar');
  judge('sidebar show', run, { opening: true, side: 'right', axis: 'w' });

  // Right sidebar
  await ensure(AUX, 'toggleAuxiliaryBar', false);
  await page.waitForTimeout(300);
  run = await glide(AUX, 'toggleAuxiliaryBar');
  judge('right sidebar show', run, { opening: true, side: 'left', axis: 'w' });
  run = await glide(AUX, 'toggleAuxiliaryBar');
  judge('right sidebar hide', run, { opening: false, side: 'left', axis: 'w' });
  check('right sidebar hide: gone at the end', !run.samples[run.samples.length - 1].box);

  // Panel
  await ensure(PANEL, 'togglePanel', true);
  await page.waitForTimeout(300);
  run = await glide(PANEL, 'togglePanel');
  judge('panel hide', run, { opening: false, side: 'bottom', axis: 'h' });
  run = await glide(PANEL, 'togglePanel');
  judge('panel show', run, { opening: true, side: 'bottom', axis: 'h' });

  // Reversal: hide, then toggle again 80ms in.
  await page.waitForTimeout(300);
  run = await glide(SIDEBAR, 'toggleSidebar', 80);
  const widths = run.samples.map((s) => (s.box ? Math.round(s.box.w) : 0));
  const low = Math.min(...widths);
  check('toggling mid-glide reverses: down part way, back to full, still shown',
    low > 0 && low < widths[0] - 10 && Math.abs(widths[widths.length - 1] - widths[0]) <= 1 && run.visibleAtEnd === true, widths);

  // Reduce Motion: lands at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  run = await glide(SIDEBAR, 'toggleSidebar');
  check('reduced motion: the sidebar is gone straight after the call', !run.afterCall.box, run.afterCall.box);
  await page.evaluate(() => window.__parallx_workbench__.toggleSidebar());
} finally {
  await app.close().catch(() => {});
}
console.log(`[probe] ${results.filter(Boolean).length}/${results.length} checks passed`);
