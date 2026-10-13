// refactor-verify-probe.mjs: the running-app checks from
// docs/REFACTOR_HANDOFF_2026-10-12.md section 2, hidden, on a throwaway
// workspace. No model calls: rows that need a model are left to a person.
//
// Controls are driven by their scene ids and read through the scene
// (tests/probes/scene.mjs, docs/SELF_DESCRIBING_UI_DESIGN.md section 7);
// the workbench is reached only through scene.mjs's helpers. What the app
// renders but does not declare (pdf.js pages and text, a Mermaid drawing,
// code highlighting, a sheet's cells) is read as content, under the
// surface that holds it.
//
// Usage: node tests/probes/refactor-verify-probe.mjs <outDir> [row ...]
// Rows: pdf markdown find quickopen mermaid dashboard icons tools docling worksheet exts
// (default: all). Requires `npm run build` first (the app loads dist/).

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PROJECT_ROOT, launchApp, cmd, sceneOf, flatten, click, openFile, toolList, setToolEnabled } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-verify'));
const ALL = ['pdf', 'markdown', 'find', 'quickopen', 'mermaid', 'dashboard', 'icons', 'tools', 'docling', 'worksheet', 'exts'];
const rows = process.argv.slice(3).length ? process.argv.slice(3) : ALL;

const log = (row, msg) => console.log(`[${row}] ${msg}`);

async function seed() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-verify-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `parallx-verify-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(ws, 'notes', 'many'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* ok */ }
  await fs.writeFile(path.join(ws, 'code-notes.md'), '# Code notes\n\nSome text.\n\n```js\nconst tail = factor * 1.05;\nfunction develop(x) { return x + 1; }\n```\n');
  for (let i = 0; i < 400; i++) {
    await fs.writeFile(path.join(ws, 'notes', 'many', `note-${String(i).padStart(3, '0')}.md`), `# Note ${i}\n\nThe tail factor is chosen here.\n`.repeat(20));
  }
  await fs.writeFile(path.join(ws, 'alpha.md'), '# Alpha\n');
  await fs.writeFile(path.join(ws, 'beta.md'), '# Beta\n');
  const pdfPath = path.join(ws, 'reading.pdf');
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    const para = 'Excess loss development follows the reported pattern closely in the early years and then flattens. ';
    const sec = (n, t) => `<h1>${n}. ${t}</h1><p>${para.repeat(12)}</p><h2>${n}.1 Method</h2><p>${para.repeat(10)}</p>`;
    await p.setContent(`<html><body style="font:12pt Georgia">${['Introduction', 'Data', 'Development', 'Conclusions'].map((t, i) => `<section style="page-break-after:always">${sec(i + 1, t)}</section>`).join('')}</body></html>`);
    await p.pdf({ path: pdfPath, format: 'Letter', margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' }, tagged: true, outline: true });
  } finally { await browser.close(); }
  return { appRoot, ws };
}

async function repaint(page) {
  await page.evaluate(() => {
    let d = document.getElementById('__probe_repaint');
    if (!d) { d = document.createElement('div'); d.id = '__probe_repaint'; d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none'; document.body.appendChild(d); }
    d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01';
  });
  await page.screenshot({ timeout: 4_000 }).catch(() => {});
}

async function shot(page, name) {
  await repaint(page);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), timeout: 8_000 }).catch(() => {});
}

/** The scene, flattened; `entry(id)` is its first entry with that id. */
async function entries(page) {
  const nodes = flatten(await sceneOf(page));
  return Object.assign(nodes, { entry: (id) => nodes.filter((n) => n.id === id)[0] });
}

/** The element of a scene id, for reading its attributes or typing in it. */
const byId = (id) => `[data-px-id="${id}"]`;
/** A surface's element, by its id (an editor surface is its type id). */
const surface = (id) => `[data-px-surface="${id}"]`;

const errors = [];
let currentRow = 'boot';

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, ws } = await seed();
  const { app, page } = await launchApp(appRoot);
  page.on('pageerror', (e) => errors.push(`[${currentRow}] pageerror: ${String(e).slice(0, 400)}`));
  page.on('console', (m) => { if (m.type() === 'warning' && currentRow === 'markdown') errors.push(`[markdown] warn: ${m.text().slice(0, 300)}`); if (m.type() === 'error') errors.push(`[${currentRow}] console: ${m.text().slice(0, 400)}`); });

  const run = async (row, fn) => {
    if (!rows.includes(row)) return;
    currentRow = row;
    try { await fn(); } catch (e) { log(row, `FAILED ${String(e).split('\n')[0]}`); }
  };

  await run('quickopen', async () => {
    // Recent files first: open beta, then alpha; an empty quick open lists alpha, beta.
    await openFile(page, 'beta.md');
    await openFile(page, 'alpha.md');
    await cmd(page, 'workbench.action.quickOpen');
    await page.waitForSelector(byId('quickAccess.list'), { timeout: 5_000 });
    await page.waitForTimeout(500);
    const items = await page.evaluate((sel) => Array.from(document.querySelector(sel)?.children ?? []).slice(0, 8).map((x) => `${x.getAttribute('role') || x.tagName.toLowerCase()}:${x.textContent.trim().slice(0, 40)}`), byId('quickAccess.list'));
    log('quickopen', items.join(' | '));
    await page.keyboard.press('Escape');
  });

  await run('markdown', async () => {
    await openFile(page, 'code-notes.md');
    const groups = async () => (await entries(page)).filter((n) => n.id === 'editorGroup.tabs').map((n) => n.state?.value?.join(',')).join(' / ');
    log('markdown', `active editors: ${await groups()}`);
    const r = await cmd(page, 'markdown.showPreviewToSide');
    log('markdown', `showPreviewToSide: ${r}`);
    await page.waitForTimeout(2_000);
    log('markdown', `active editors: ${await groups()}`);
    const preview = surface('parallx.editor.markdownPreview');
    await page.waitForSelector(`${preview} pre`, { timeout: 10_000 });
    await page.waitForTimeout(300);
    const first = await page.evaluate((sel) => {
      const pre = document.querySelector(`${sel} pre`);
      return `spans=${pre?.querySelectorAll('[class^="hljs-"]').length} html=${pre?.innerHTML.slice(0, 120)}`;
    }, preview);
    log('markdown', `first paint: ${first}`);
    // Type in the source; the preview follows.
    const src = page.locator(`${surface('parallx.editor.file')} [contenteditable="true"]`).filter({ visible: true }).first();
    if (await src.count()) {
      await src.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('\nTyped line here.\n');
      await page.waitForTimeout(800);
      await repaint(page);
      const has = await page.evaluate((sel) => /Typed line here/.test(document.querySelector(sel)?.textContent || ''), preview);
      log('markdown', `preview follows typing: ${has}`);
    } else log('markdown', 'no editable source in the file editor');
    await shot(page, 'markdown');
  });

  await run('find', async () => {
    const r = await cmd(page, 'search.findInFiles');
    log('find', `findInFiles: ${r}`);
    await page.waitForSelector(byId('search.query'), { timeout: 5_000 });
    await page.fill(`${byId('search.query')} input, input${byId('search.query')}`, 'tail factor').catch(async () => { await page.fill(byId('search.query'), 'tail factor'); });
    await page.keyboard.press('Enter');
    const samples = [];
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(150);
      await repaint(page);
      const rowsShown = (await entries(page)).entry('search.results')?.state?.count ?? 0;
      samples.push(`${Date.now() - t0}ms:${rowsShown}`);
      if (i === 19) log('find', `final: rows=${rowsShown} message="${await page.evaluate((sel) => document.querySelector(`${sel} [role="status"]`)?.textContent?.trim() || '', surface('view.search'))}"`);
    }
    log('find', `rows over time: ${samples.join(' ')}`);
    await shot(page, 'find');
  });

  await run('pdf', async () => {
    await openFile(page, 'reading.pdf');
    const pdf = surface('parallx.editor.pdf');
    await page.waitForSelector(`${pdf} .page canvas`, { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    log('pdf', `opened, pages=${await page.evaluate((sel) => document.querySelectorAll(`${sel} .page`).length, pdf)}`);
    // Highlight, then undo it.
    const box = await page.evaluate((sel) => {
      const spans = Array.from(document.querySelectorAll(`${sel} .page .textLayer span`)).filter((s) => s.textContent.trim().length > 20);
      const r = spans[2]?.getBoundingClientRect();
      return r ? { x: r.left + 2, y: r.top + r.height / 2, w: r.width } : null;
    }, pdf);
    if (!box) log('pdf', 'no text span to select');
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w * 0.7, box.y, { steps: 8 });
    await page.mouse.up();
    // The hidden window may not turn a drag into a selection: select the span's text directly, then release.
    await page.evaluate((b) => { if (String(getSelection()).trim()) return; const s = document.elementFromPoint(b.x + 5, b.y); const tn = s?.firstChild; if (!tn) return; const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, Math.min(30, tn.textContent.length)); getSelection().removeAllRanges(); getSelection().addRange(r); s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: b.x + 100, clientY: b.y })); }, box);
    await repaint(page);
    await page.waitForTimeout(500);
    const bubble = !!(await entries(page)).entry('pdf.selection.highlight.yellow');
    log('pdf', `selection="${await page.evaluate(() => String(getSelection()).slice(0, 60))}" bubble=${bubble} box=${JSON.stringify(box)}`);
    // The highlight boxes are content the pane draws over the page, not controls.
    const boxes = () => page.evaluate((sel) => document.querySelectorAll(`${sel} .pdf-highlight-box`).length, pdf);
    await click(page, 'pdf.selection.highlight.yellow');
    await page.waitForTimeout(900);
    const made = await boxes();
    // Focus the PDF pane itself (it may sit in a split group) before Ctrl+Z.
    const at = await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + 20, y: r.bottom - 20 }; }, pdf);
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(800);
    const after = await boxes();
    await page.keyboard.press('Control+Shift+Z');
    await page.waitForTimeout(800);
    log('pdf', `highlight boxes: made=${made} afterUndo=${after} afterRedo=${await boxes()}`);
    // The toolbar's own controls: fit, a typed zoom, a preset, night reading, the page field.
    const bar = async () => {
      const e = await entries(page);
      const fit = await page.getAttribute(byId('pdf.fit'), 'aria-label');
      return `zoom=${e.entry('pdf.zoom')?.state?.value} fitBtn="${fit}" night=${e.entry('pdf.nightReading')?.state?.value} page=${e.entry('pdf.page')?.state?.value}`;
    };
    const setField = async (id, v) => { await page.fill(byId(id), v); await page.press(byId(id), 'Enter'); await page.waitForTimeout(500); };
    log('pdf', `toolbar start: ${await bar()}`);
    await click(page, 'pdf.fit'); await page.waitForTimeout(500);
    log('pdf', `after Fit Width: ${await bar()}`);
    await setField('pdf.zoom', '150');
    log('pdf', `after typing 150: ${await bar()}`);
    await click(page, 'pdf.zoomPresets'); await page.waitForTimeout(400);
    await click(page, 'contextMenu.zoom.75');
    await page.waitForTimeout(500);
    log('pdf', `after preset 75%: ${await bar()}`);
    await click(page, 'pdf.nightReading'); await page.waitForTimeout(300);
    log('pdf', `after Night Reading: ${await bar()}`);
    await click(page, 'pdf.nightReading'); await page.waitForTimeout(300);
    await setField('pdf.page', '3');
    log('pdf', `after page 3: ${await bar()}`);
    await click(page, 'pdf.fit'); await page.waitForTimeout(300);
    // Overflow menu: list it, then pick spread and scroll modes from their submenus.
    const openMore = async () => {
      await click(page, 'pdf.more');
      await page.waitForTimeout(500);
      return (await entries(page)).filter((n) => n.parent === 'contextMenu').map((n) => n.label);
    };
    log('pdf', `more menu: ${(await openMore()).join(' | ')}`);
    await page.keyboard.press('Escape');
    // How pdf.js lays the pages out is content: its viewer's classes and spread count.
    const viewer = () => page.evaluate((sel) => {
      const v = document.querySelector(`${sel} .pdfViewer`);
      return `viewer="${v?.className}" spreads=${v?.querySelectorAll('.spread').length}`;
    }, pdf);
    log('pdf', `before modes: ${await viewer()}`);
    const subPick = async (parent, child) => {
      await openMore();
      await page.hover(byId(`contextMenu.${parent}`));
      await page.waitForTimeout(700);
      const sub = (await entries(page)).filter((n) => n.id.startsWith(`contextMenu.${parent}.`)).map((n) => n.label);
      await click(page, `contextMenu.${parent}.${child}`);
      await page.waitForTimeout(800);
      return `submenu=[${sub.join(' | ')}] clicked=${child}`;
    };
    for (const [parent, child] of [['pdf.spread', 'odd'], ['pdf.spread', 'none'], ['pdf.scroll', 'horizontal'], ['pdf.scroll', 'vertical']]) {
      log('pdf', `${parent}.${child}: ${await subPick(parent, child)} -> ${await viewer()}`);
      await page.keyboard.press('Escape');
    }
    // Away and back: the reader returns to the same page and scroll offset.
    const scroller = `${pdf} .pdf-viewer-container`;
    await page.evaluate((sel) => { const c = document.querySelector(sel); c.scrollTop = c.scrollHeight * 0.6; }, scroller);
    await page.waitForTimeout(800);
    const where = async () => ({ top: await page.evaluate((sel) => Math.round(document.querySelector(sel)?.scrollTop ?? -1), scroller), page: (await entries(page)).entry('pdf.page')?.state?.value });
    const beforeAway = await where();
    await openFile(page, 'alpha.md');
    await page.waitForTimeout(800);
    await openFile(page, 'reading.pdf');
    await page.waitForTimeout(1_500);
    log('pdf', `away and back: before=${JSON.stringify(beforeAway)} after=${JSON.stringify(await where())}`);
    log('pdf', `test hook: ${await page.evaluate(() => { const d = window.__parallxPdfDebug; if (typeof d?.getState !== 'function') return 'not installed'; const s = d.getState(); return `pages=${s.pagesCount} scale=${s.currentScaleValue} canvas=${!!s.canvas}`; })}`);
    // Add to Canvas Note: the passage goes to a canvas page and its new
    // highlight links back. Last, since the canvas page it opens hides the PDF.
    const noted = await page.evaluate((sel) => {
      const spans = Array.from(document.querySelectorAll(`${sel} .page .textLayer span`)).filter((s) => s.textContent.trim().length > 20);
      const s = spans[6];
      if (!s?.firstChild) return 'no span';
      const r = document.createRange();
      r.setStart(s.firstChild, 0); r.setEnd(s.firstChild, Math.min(25, s.firstChild.textContent.length));
      getSelection().removeAllRanges(); getSelection().addRange(r);
      const b = s.getBoundingClientRect();
      s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: b.left + 40, clientY: b.top + 4 }));
      return 'selected';
    }, pdf);
    await repaint(page);
    await page.waitForTimeout(600);
    await click(page, 'pdf.selection.addToNote');
    await page.waitForTimeout(1_200);
    // Canvas asks which page the note goes to (a quick pick, not yet in the scene): the first offer, a new page.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_500);
    await repaint(page);
    log('pdf', `canvas note: ${noted} linkedTabs=${await page.evaluate((sel) => document.querySelectorAll(`${sel} .pdf-highlight-tab.has-canvas-link`).length, pdf)} tabs=${await page.evaluate((sel) => document.querySelectorAll(`${sel} .pdf-highlight-tab`).length, pdf)}`);
    await shot(page, 'pdf');
  });

  await run('mermaid', async () => {
    const r = await cmd(page, 'canvas.newPage');
    log('mermaid', `canvas.newPage: ${r}`);
    const canvas = surface('canvas');
    // The page body is the editor (Tiptap on ProseMirror), which the scene never declares.
    // A canvas page opened earlier (the PDF row's note) stays mounted, hidden: wait for the visible one.
    await page.locator(`${canvas} [contenteditable="true"]`).filter({ visible: true }).first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const ins = await page.evaluate((sel) => {
      const ed = Array.from(document.querySelectorAll(`${sel} [contenteditable="true"]`)).filter((x) => x.offsetParent).map((x) => x.editor).find(Boolean);
      if (!ed) return 'no editor on the page body';
      return ed.commands.insertContent({ type: 'mermaidDiagram' }) ? 'inserted' : 'insert refused';
    }, canvas);
    log('mermaid', ins);
    await page.waitForSelector(`${canvas} .canvas-mermaid svg`, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(800);
    log('mermaid', `drawn: ${await page.evaluate((sel) => `${document.querySelectorAll(`${sel} .canvas-mermaid svg`).length} svg, message="${document.querySelector(`${sel} .canvas-mermaid__message`)?.textContent || ''}"`, canvas)}`);
    await page.evaluate((sel) => {
      window.__mmDraws = 0;
      const host = document.querySelector(`${sel} .canvas-mermaid`);
      if (host) new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName.toLowerCase() === 'svg') window.__mmDraws++; }).observe(host, { childList: true, subtree: true });
    }, canvas);
    const modes = [];
    for (const mode of ['light', 'dark', 'light']) {
      await page.evaluate((m) => document.documentElement.setAttribute('data-px-mode', m), mode);
      await page.waitForTimeout(1_500);
      await repaint(page);
      modes.push(`${mode}: draws=${await page.evaluate(() => window.__mmDraws)} body=${await page.evaluate(() => getComputedStyle(document.body).backgroundColor)}`);
    }
    log('mermaid', modes.join(' ; '));
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));
    await shot(page, 'mermaid');
  });

  await run('dashboard', async () => {
    const r = await cmd(page, 'dashboard.newPage');
    log('dashboard', `dashboard.newPage: ${r}`);
    await page.waitForTimeout(2_500);
    const ids = async () => (await entries(page)).filter((n) => n.id.startsWith('dashboard.'));
    log('dashboard', `controls: ${[...new Set((await ids()).map((n) => n.id))].join(',')}`);
    await cmd(page, 'dashboard.addWidget');
    await page.waitForTimeout(1_000);
    // The widget picker (a surface) lists templates as rows: its first one, as a person would pick it.
    const picked = await page.evaluate((sel) => { const o = Array.from(document.querySelectorAll(`${sel} button:not([data-px-id])`)).find((x) => x.offsetParent && x.textContent.trim()); o?.click(); return o?.textContent.trim().slice(0, 40) ?? 'nothing offered'; }, surface('dashboard.picker'));
    log('dashboard', `picker: first="${picked}"`);
    await page.waitForTimeout(1_500);
    const e = await entries(page);
    log('dashboard', `widgets=${e.filter((n) => n.id === 'dashboard.widget').length} buttons=${[...new Set(e.filter((n) => n.parent === 'dashboard.widget').map((n) => n.label))].join('|')}`);
    for (const id of ['dashboard.widget.appearance', 'dashboard.widget.configure']) {
      const opened = !!(await entries(page)).entry(id);
      // The widget's buttons show while the pointer is over it, as for a person.
      if (opened) { await page.locator(surface('dashboard.widget')).filter({ visible: true }).first().hover(); await click(page, id); }
      await page.waitForTimeout(800);
      // The drawer's dropdowns are selects in the scene, each with its value.
      const selects = (await entries(page)).filter((n) => n.kind === 'select' && n.visible !== false && (n.parent === 'dashboard.widgetSettings' || n.parent === 'dashboard.appearance'));
      const first = selects[0];
      let after = 'no select';
      let options = 0;
      if (first) {
        await click(page, first.id);
        await page.waitForTimeout(500);
        options = await page.evaluate(() => Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).filter((x) => x.offsetParent).length);
        await page.evaluate(() => { const items = Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).filter((x) => x.offsetParent); const it = items[1] ?? items[0]; it?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); it?.click(); });
        await page.waitForTimeout(500);
        after = (await entries(page)).entry(first.id)?.state?.value;
      }
      log('dashboard', `${id}: button=${opened} selects=${selects.length} first=${first?.id}="${first?.state?.value}" options=${options} after pick="${after}"`);
      await shot(page, `dashboard-${id.split('.').pop()}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await shot(page, 'dashboard');
  });

  await run('icons', async () => {
    // Every visible icon button in the scene draws its icon: an svg with a width.
    const ids = (await entries(page)).filter((n) => n.kind === 'iconButton' && n.visible !== false).map((n) => n.id);
    log('icons', await page.evaluate((ids) => {
      let shown = 0; let withSvg = 0; let zero = 0; const bad = [];
      for (const id of new Set(ids)) {
        for (const el of document.querySelectorAll(`[data-px-id="${id}"]`)) {
          if (!el.offsetParent) continue;
          shown++;
          const svg = el.querySelector('svg');
          if (svg) withSvg++; else bad.push(id);
          if (svg && svg.getBoundingClientRect().width === 0) zero++;
        }
      }
      return `visible icon buttons=${shown} with svg=${withSvg} zero-width svgs=${zero}${bad.length ? ` without svg: ${bad.slice(0, 8).join(', ')}` : ''}`;
    }, ids));
  });

  await run('tools', async () => {
    const r = await cmd(page, 'tools.showInstalled');
    log('tools', `tools.showInstalled: ${r}`);
    await page.waitForTimeout(1_500);
    const list = await toolList(page);
    log('tools', `registry (${list.length}): ${list.map((t) => `${t.id}${t.builtin ? '' : '(ext)'}`).join(', ')}`);
    log('tools', `view text: ${await page.evaluate((sel) => (document.querySelector(sel)?.textContent || 'no view element').replace(/\s+/g, ' ').slice(0, 600), surface('view.tools'))}`);
    // Each optional built-in off and on again.
    const out = [];
    for (const t of list) {
      if (!t.builtin || t.required) continue;
      const off = await setToolEnabled(page, t.id, false);
      await page.waitForTimeout(200);
      const on = await setToolEnabled(page, t.id, true);
      await page.waitForTimeout(200);
      out.push(`${t.id}:${off === true && on === true ? 'ok' : `ERR ${off === true ? on : off}`}`);
    }
    log('tools', `toggle: ${out.join(' ')}`);
  });

  await run('docling', async () => {
    // The window must keep painting while Settings looks for Python.
    await page.evaluate(() => {
      window.__gaps = [];
      let last = performance.now();
      const tick = () => { const now = performance.now(); window.__gaps.push(now - last); last = now; if (window.__gaps.length < 400) setTimeout(tick, 16); };
      setTimeout(tick, 16);
    });
    const r = await cmd(page, 'workbench.action.openSettings', 'documents');
    log('docling', `openSettings: ${r}`);
    await page.waitForTimeout(1_000);
    await click(page, 'settings.nav.panel-python');
    log('docling', 'Python section clicked');
    await page.waitForTimeout(5_000);
    const gaps = await page.evaluate(() => { const g = window.__gaps; return { n: g.length, max: Math.round(Math.max(...g)), over200: g.filter((x) => x > 200).length }; });
    log('docling', `timer gaps: ticks=${gaps.n} max=${gaps.max}ms over200=${gaps.over200}`);
    // The detection runs in the main process: other IPC must keep answering meanwhile.
    log('docling', `ipc during status: ${await page.evaluate(async () => {
      const px = window.parallxElectron;
      const t0 = performance.now();
      const status = px.docling.status().then((s) => ({ s, ms: Math.round(performance.now() - t0) }));
      const pings = [];
      for (let i = 0; i < 10; i++) { const a = performance.now(); await px.fs.exists('C:\\'); pings.push(Math.round(performance.now() - a)); await new Promise((r) => setTimeout(r, 50)); }
      const done = await status;
      return `status took ${done.ms}ms (${JSON.stringify(done.s).slice(0, 160)}); fs:exists pings ms=[${pings.join(',')}]`;
    })}`);
    const consent = (await entries(page)).entry('settings.python.consent');
    log('docling', `python switch: ${consent ? `${consent.label} ${JSON.stringify(consent.state)}` : 'not in the scene'}`);
    log('docling', `panel text: ${await page.evaluate((sel) => (document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').match(/.{0,80}(Docling|Python).{0,160}/i)?.[0] || 'no Docling/Python text', surface('settings'))}`);
    await shot(page, 'docling');
    await page.keyboard.press('Escape');
  });

  await run('worksheet', async () => {
    const dl = path.join(ws, 'downloads');
    await fs.mkdir(dl, { recursive: true });
    // Downloads land in the throwaway workspace, never the real Downloads folder.
    await app.evaluate(({ session }, dir) => {
      session.defaultSession.on('will-download', (_e, item) => item.setSavePath(`${dir}\\${item.getFilename()}`));
    }, dl).catch((e) => log('worksheet', `download hook failed: ${String(e).split('\n')[0]}`));
    // The sheet's test host hangs on the element that holds the grid, inside the worksheet surface.
    // (The window's content policy forbids evaluating strings, so each lookup is written out.)
    const waitHost = () => page.waitForFunction(() => Array.from(document.querySelectorAll('[data-px-surface="worksheet"] *')).some((e) => e.__wsHost), null, { timeout: 60_000 });
    const host = (fn, ...a) => page.evaluate(({ fn, a }) => Array.from(document.querySelectorAll('[data-px-surface="worksheet"] *')).find((e) => e.__wsHost).__wsHost[fn](...a), { fn, a });
    log('worksheet', `openScratch: ${await cmd(page, 'worksheet.openScratch')}`);
    await waitHost();
    await page.waitForTimeout(1_500);
    await host('setCellText', 0, 0, 'probe-42');
    log('worksheet', `formula set: ${await host('probeSetFormula', 1, 0, '=6*7')}`);
    await page.waitForTimeout(6_500);
    log('worksheet', `before close: A1=${JSON.stringify(await host('probeReadValue', 0, 0))} A2=${JSON.stringify(await host('probeReadValue', 1, 0))}`);
    await cmd(page, 'workbench.action.closeActiveEditor');
    await page.waitForTimeout(1_500);
    await cmd(page, 'worksheet.openScratch');
    await waitHost();
    await page.waitForTimeout(2_000);
    log('worksheet', `after reopen: A1=${JSON.stringify(await host('probeReadValue', 0, 0))} A2=${JSON.stringify(await host('probeReadValue', 1, 0))}`);
    log('worksheet', `exportToXlsx: ${await host('exportToXlsx', 'probe-export')}`);
    await page.waitForTimeout(3_000);
    const files = await fs.readdir(dl).catch(() => []);
    const stats = await Promise.all(files.map(async (f) => `${f}(${(await fs.stat(path.join(dl, f))).size} B)`));
    log('worksheet', `downloads: ${stats.join(', ') || 'none'}`);
    const xlsx = files.find((f) => f.endsWith('.xlsx'));
    if (!xlsx) return;
    log('worksheet', `importExcel: ${await cmd(page, 'worksheet.importExcel', path.join(dl, xlsx))}`);
    await page.waitForTimeout(6_000);
    await repaint(page);
    const imported = (await entries(page)).filter((n) => n.kind === 'surface' && n.id === 'worksheet').map((n) => n.instance);
    log('worksheet', `worksheet surfaces: ${imported.join(' / ')}`);
    log('worksheet', `import pane: ${await page.evaluate(() => { const panes = Array.from(document.querySelectorAll('[data-px-surface="worksheet"]')).filter((x) => x.offsetParent); return (panes.pop()?.textContent || 'no import pane').replace(/\s+/g, ' ').slice(0, 400); })}`);
    await shot(page, 'worksheet-import');
  });

  await run('exts', async () => {
    // Every extension the refactor touched activates cleanly.
    const ids = ['parallx-community.flashcards', 'parallx.budget', 'parallx-community.study', 'parallx-community.creations-ai', 'parallx.workspace-graph', 'parallx-community.media-organizer'];
    const out = [];
    for (const id of ids) { const r = await setToolEnabled(page, id, true); out.push(`${id}:${r === true ? 'on' : `ERR ${r}`}`); }
    log('exts', out.join(' '));
    await page.waitForTimeout(6_000);
    const x = (name, ops) => page.evaluate(async ({ name, ops }) => {
      const r = await window.parallxElectron.extensionDatabase.runTransaction(name, ops.map((o) => ({ ...o, params: (o.params || []).map((p) => (p && p.__vec ? new Uint8Array(new Float32Array(p.__vec).buffer.slice(0)) : p)) })));
      return r.error ? `ERR ${r.error.message}` : JSON.stringify(r.results.map((y) => (y.rows ? y.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'object' && v ? `<${v.byteLength ?? v.length ?? '?'} bytes>` : v]))) : y)));
    }, { name, ops });
    // Flashcards: the batched vector write, the one read of card ids, the chunked vector read.
    const vec = { __vec: Array.from({ length: 768 }, (_, i) => (i % 7) / 7) };
    // The vector table is made on first use (fcEnsureVecTable); the same statement here.
    log('exts', `flashcards table: ${await x('flashcards', [{ type: 'run', sql: 'CREATE VIRTUAL TABLE IF NOT EXISTS fc_card_embeddings USING vec0(embedding float[768] distance_metric=cosine, +card_id TEXT NOT NULL)' }])}`);
    log('exts', `flashcards write: ${await x('flashcards', [
      { type: 'run', sql: 'DELETE FROM fc_card_embeddings WHERE card_id = ?', params: ['probe-1'] },
      { type: 'run', sql: 'INSERT INTO fc_card_embeddings (embedding, card_id) VALUES (?, ?)', params: [vec, 'probe-1'] },
      { type: 'run', sql: 'DELETE FROM fc_card_embeddings WHERE card_id = ?', params: ['probe-2'] },
      { type: 'run', sql: 'INSERT INTO fc_card_embeddings (embedding, card_id) VALUES (?, ?)', params: [vec, 'probe-2'] },
    ])}`);
    log('exts', `flashcards reads: ${await x('flashcards', [
      { type: 'all', sql: 'SELECT card_id FROM fc_card_embeddings' },
      { type: 'all', sql: 'SELECT card_id, embedding FROM fc_card_embeddings WHERE card_id IN (?,?)', params: ['probe-1', 'probe-2'] },
      { type: 'run', sql: 'DELETE FROM fc_card_embeddings WHERE card_id IN (?,?)', params: ['probe-1', 'probe-2'] },
    ])}`);
    // Study: a batch of inserts returns each new row id, in order.
    log('exts', `study ids: ${await x('study', [
      { type: 'run', sql: 'INSERT INTO st_materials (id, kind, uri, label, created_at) VALUES (999, ?, ?, ?, 0)', params: ['bank', '', 'Probe'] },
      { type: 'run', sql: 'INSERT INTO st_concepts (material_id, section_id, title, summary, page, anchor_quote, ord, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [999, 0, 'A', '', 0, '', 0, 'now'] },
      { type: 'run', sql: 'INSERT INTO st_concepts (material_id, section_id, title, summary, page, anchor_quote, ord, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [999, 0, 'B', '', 0, '', 1, 'now'] },
      { type: 'all', sql: 'SELECT id, title FROM st_concepts WHERE material_id = 999 ORDER BY id' },
      { type: 'run', sql: 'DELETE FROM st_concepts WHERE material_id = 999' },
      { type: 'run', sql: 'DELETE FROM st_materials WHERE id = 999' },
    ])}`);
  });

  currentRow = 'end';
  await page.waitForTimeout(1_000);
  await app.close().catch(() => {});
  const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama|11434/.test(e));
  console.log(`\n${real.length} renderer error(s)`);
  for (const e of real) console.log(`  ${e}`);
  await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
