// refactor-verify-probe.mjs: the running-app checks from
// docs/REFACTOR_HANDOFF_2026-10-12.md section 2, hidden, on a throwaway
// workspace. No model calls: rows that need a model are left to a person.
//
// Usage: node tests/probes/refactor-verify-probe.mjs <outDir> [row ...]
// Rows: pdf markdown find quickopen mermaid dashboard icons tools docling worksheet exts
// (default: all). Requires `npm run build` first (the app loads dist/).

import { _electron as electron, chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-verify'));
const ALL = ['pdf', 'markdown', 'find', 'quickopen', 'mermaid', 'dashboard', 'icons', 'tools', 'docling', 'worksheet', 'exts'];
const rows = process.argv.slice(3).length ? process.argv.slice(3) : ALL;

const log = (row, msg) => console.log(`[${row}] ${msg}`);

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, {
    PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1',
    PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache'),
  });
  return env;
}

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

async function cmd(page, id, ...args) {
  return page.evaluate(async ({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    if (!svc) return 'no command service';
    try { await svc.executeCommand(id, ...args); return true; } catch (e) { return String(e?.message || e); }
  }, { id, args });
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

async function openFile(page, name) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+P');
  await page.waitForSelector('.command-palette-input', { timeout: 5_000 });
  await page.keyboard.type(name);
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_500);
}

const errors = [];
let currentRow = 'boot';

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, ws } = await seed();
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`[${currentRow}] pageerror: ${String(e).slice(0, 400)}`));
  page.on('console', (m) => { if (m.type() === 'warning' && currentRow === 'markdown') errors.push(`[markdown] warn: ${m.text().slice(0, 300)}`); if (m.type() === 'error') errors.push(`[${currentRow}] console: ${m.text().slice(0, 400)}`); });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(3_000);

  const run = async (row, fn) => {
    if (!rows.includes(row)) return;
    currentRow = row;
    try { await fn(); } catch (e) { log(row, `FAILED ${String(e).split('\n')[0]}`); }
  };

  await run('quickopen', async () => {
    // Recent files first: open beta, then alpha; an empty Ctrl+P lists alpha, beta.
    await openFile(page, 'beta.md');
    await openFile(page, 'alpha.md');
    await page.keyboard.press('Control+P');
    await page.waitForSelector('.command-palette-item', { timeout: 5_000 });
    await page.waitForTimeout(500);
    const items = await page.evaluate(() => Array.from(document.querySelectorAll('.command-palette-list > *')).slice(0, 8).map((x) => `${x.className.split(' ')[0]}:${x.textContent.trim().slice(0, 40)}`));
    log('quickopen', items.join(' | '));
    await page.keyboard.press('Escape');
  });

  await run('markdown', async () => {
    await openFile(page, 'code-notes.md');
    log('markdown', await page.evaluate(() => { const g = window.__parallx_workbench__?._services?.get?.({ id: 'IEditorGroupService' }); const e = g?.activeGroup?.model?.activeEditor; return `active editor: ${e?.typeId} ${e?.name} panes=${Array.from(document.querySelectorAll('[class*="-editor-pane"], .markdown-editor-pane')).map((x) => x.className.split(' ')[0]).join(',')}`; }));
    const r = await cmd(page, 'markdown.showPreviewToSide');
    log('markdown', `showPreviewToSide: ${r}`);
    await page.waitForTimeout(2_000);
    log('markdown', await page.evaluate(() => { const g = window.__parallx_workbench__?._services?.get?.({ id: 'IEditorGroupService' }); return `groups=${g?.groups?.map((x) => `${x.model.activeEditor?.typeId}:${x.model.activeEditor?.name}`).join(',')} md=${document.querySelectorAll('.markdown-editor-pane').length} content="${(document.querySelector('.markdown-content')?.innerHTML || '').slice(0, 200)}"`; }));
    await page.waitForSelector('.markdown-content pre', { timeout: 10_000 });
    await page.waitForTimeout(300);
    const first = await page.evaluate(() => {
      const pre = document.querySelector('.markdown-content pre');
      return `spans=${pre?.querySelectorAll('[class^="hljs-"]').length} html=${pre?.innerHTML.slice(0, 120)}`;
    });
    log('markdown', `first paint: ${first}`);
    // Type in the source; the preview follows.
    const src = page.locator('.cm-content').first();
    if (await src.count()) {
      await src.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('\nTyped line here.\n');
      await page.waitForTimeout(800);
      await repaint(page);
      const has = await page.evaluate(() => /Typed line here/.test(document.querySelector('.markdown-content')?.textContent || ''));
      log('markdown', `preview follows typing: ${has}`);
    } else log('markdown', 'no .cm-content source editor found');
    await shot(page, 'markdown');
  });

  await run('find', async () => {
    const r = await cmd(page, 'search.findInFiles');
    log('find', `findInFiles: ${r}`);
    await page.waitForSelector('.search-input', { timeout: 5_000 });
    const input = page.locator('.search-input').first();
    await input.fill('tail factor');
    await page.keyboard.press('Enter');
    const samples = [];
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(150);
      await repaint(page);
      const s = await page.evaluate(() => ({ files: document.querySelectorAll('.search-file-group').length, msg: document.querySelector('.search-message')?.textContent?.trim() || '' }));
      samples.push(`${Date.now() - t0}ms:${s.files}`);
      if (i === 19) log('find', `final: files=${s.files} message="${s.msg}"`);
    }
    log('find', `files over time: ${samples.join(' ')}`);
    await shot(page, 'find');
  });

  await run('pdf', async () => {
    await openFile(page, 'reading.pdf');
    await page.waitForSelector('.pdf-editor-pane .pdfViewer .page canvas', { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    log('pdf', `opened, pages=${await page.evaluate(() => document.querySelectorAll('.pdfViewer .page').length)}`);
    // Highlight, then undo it.
    const box = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.pdfViewer .page .textLayer span')).filter((s) => s.textContent.trim().length > 20);
      const r = spans[2]?.getBoundingClientRect();
      return r ? { x: r.left + 2, y: r.top + r.height / 2, w: r.width } : null;
    });
    if (!box) log('pdf', 'no text span to select');
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w * 0.7, box.y, { steps: 8 });
    await page.mouse.up();
    // The hidden window may not turn a drag into a selection: select the span's text directly, then release.
    await page.evaluate((b) => { if (String(getSelection()).trim()) return; const s = document.elementFromPoint(b.x + 5, b.y); const tn = s?.firstChild; if (!tn) return; const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, Math.min(30, tn.textContent.length)); getSelection().removeAllRanges(); getSelection().addRange(r); s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: b.x + 100, clientY: b.y })); }, box);
    await repaint(page);
    await page.waitForTimeout(500);
    log('pdf', `selection="${await page.evaluate(() => String(getSelection()).slice(0, 60))}" bubble=${await page.evaluate(() => !!document.querySelector('.pdf-selection-bubble'))} hit=${await page.evaluate((b) => { const e = document.elementFromPoint(b.x + 5, b.y); return e ? e.tagName + '.' + String(e.className).slice(0, 50) + ' in ' + String(e.parentElement?.className).slice(0, 40) : 'none'; }, box)} box=${JSON.stringify(box)}`);
    await page.evaluate(() => document.querySelector('.pdf-selection-bubble [aria-label="Highlight Yellow"]')?.click());
    await page.waitForTimeout(900);
    const made = await page.evaluate(() => document.querySelectorAll('.pdf-highlight-box').length);
    // Focus the PDF pane itself (it may sit in a split group) before Ctrl+Z.
    const pane = await page.evaluate(() => { const r = document.querySelector('.pdf-viewer-container').getBoundingClientRect(); return { x: r.left + 20, y: r.bottom - 20 }; });
    await page.mouse.click(pane.x, pane.y);
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => document.querySelectorAll('.pdf-highlight-box').length);
    await page.keyboard.press('Control+Shift+Z');
    await page.waitForTimeout(800);
    const redo = await page.evaluate(() => document.querySelectorAll('.pdf-highlight-box').length);
    log('pdf', `highlight boxes: made=${made} afterUndo=${after} afterRedo=${redo}`);
    // The toolbar's own controls: fit, a typed zoom, a preset, night reading, the page field.
    const bar = () => page.evaluate(() => {
      const label = (sel) => document.querySelector(sel)?.getAttribute('aria-label');
      return `zoom=${document.querySelector('.pdf-toolbar-zoom-input')?.value} fitBtn="${Array.from(document.querySelectorAll('.pdf-toolbar .pdf-toolbar-btn')).map((b) => b.getAttribute('aria-label')).find((l) => /^Fit/.test(l))}" night="${Array.from(document.querySelectorAll('.pdf-toolbar .pdf-toolbar-btn')).map((b) => b.getAttribute('aria-label')).find((l) => /Reading$/.test(l))}" page=${document.querySelector('.pdf-toolbar-page-input')?.value}`;
    });
    const clickLabel = (l) => page.evaluate((l) => Array.from(document.querySelectorAll('.pdf-toolbar .pdf-toolbar-btn')).find((b) => b.getAttribute('aria-label') === l)?.click(), l);
    log('pdf', `toolbar start: ${await bar()}`);
    await clickLabel('Fit Width'); await page.waitForTimeout(500);
    log('pdf', `after Fit Width: ${await bar()}`);
    await page.fill('.pdf-toolbar-zoom-input', '150'); await page.press('.pdf-toolbar-zoom-input', 'Enter'); await page.waitForTimeout(500);
    log('pdf', `after typing 150: ${await bar()}`);
    await clickLabel('Zoom Presets'); await page.waitForTimeout(400);
    await page.evaluate(() => Array.from(document.querySelectorAll('.context-menu .context-menu-item')).find((x) => x.textContent.trim().startsWith('75%'))?.click());
    await page.waitForTimeout(500);
    log('pdf', `after preset 75%: ${await bar()}`);
    await clickLabel('Night Reading'); await page.waitForTimeout(300);
    log('pdf', `after Night Reading: ${await bar()} dark=${await page.evaluate(() => document.querySelector('.pdf-viewer-container')?.classList.contains('pdf-reading-dark'))}`);
    await clickLabel('Day Reading'); await page.waitForTimeout(300);
    await page.fill('.pdf-toolbar-page-input', '3'); await page.press('.pdf-toolbar-page-input', 'Enter'); await page.waitForTimeout(600);
    log('pdf', `after page 3: ${await bar()}`);
    await clickLabel('Fit Page'); await page.waitForTimeout(300);
    // Overflow menu: list it, then pick spread and scroll modes.
    const openMore = async () => {
      await page.evaluate(() => document.querySelector('.pdf-toolbar [aria-label="More Actions"]')?.click());
      await page.waitForTimeout(500);
      return page.evaluate(() => Array.from(document.querySelectorAll('.context-menu .context-menu-item, .context-menu [role="menuitem"], .context-menu [role="menuitemcheckbox"], .context-menu [role="menuitemradio"]')).map((x) => x.textContent.trim()).filter(Boolean));
    };
    const items = await openMore();
    log('pdf', `more menu: ${items.join(' | ')}`);
    await page.keyboard.press('Escape');
    const pick = async (re) => {
      await openMore();
      const hit = await page.evaluate((src) => {
        const re = new RegExp(src, 'i');
        const all = Array.from(document.querySelectorAll('.context-menu *')).filter((x) => x.childElementCount === 0 && re.test(x.textContent.trim()));
        const el = all[0]?.closest('[role^="menuitem"], .context-menu-item') || all[0];
        if (!el) return null;
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        el.click();
        return el.textContent.trim();
      }, re.source);
      await page.waitForTimeout(400);
      return hit;
    };
    const viewerClass = () => page.evaluate(() => {
      const v = document.querySelector('.pdfViewer');
      const spreads = v?.querySelectorAll('.spread').length;
      return `viewer="${v?.className}" spreads=${spreads} container="${document.querySelector('.pdf-viewer-container')?.className}"`;
    });
    log('pdf', `before modes: ${await viewerClass()}`);
    // Each mode sits in a submenu: hover its parent, list it, click one entry.
    const subPick = async (parent, index) => {
      await openMore();
      const at = await page.evaluate((p) => {
        const row = Array.from(document.querySelectorAll('.context-menu .context-menu-item')).find((x) => x.textContent.trim().startsWith(p));
        if (!row) return null;
        const r = row.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
      }, parent);
      if (!at) return `no "${parent}" row`;
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(700);
      const sub = await page.evaluate(() => {
        const menus = Array.from(document.querySelectorAll('.context-menu'));
        const last = menus[menus.length - 1];
        return menus.length > 1 ? Array.from(last.querySelectorAll('.context-menu-item')).map((x) => x.textContent.trim()) : [];
      });
      const clicked = await page.evaluate((i) => {
        const menus = Array.from(document.querySelectorAll('.context-menu'));
        if (menus.length < 2) return null;
        const item = menus[menus.length - 1].querySelectorAll('.context-menu-item')[i];
        item?.click(); return item?.textContent.trim() ?? null;
      }, index);
      await page.waitForTimeout(800);
      return `submenu=[${sub.join(' | ')}] clicked=${clicked}`;
    };
    for (const [parent, i] of [['Two-page spread', 1], ['Two-page spread', 0], ['Scroll Direction', 1], ['Scroll Direction', 0]]) {
      log('pdf', `${parent}#${i}: ${await subPick(parent, i)} -> ${await viewerClass()}`);
      await page.keyboard.press('Escape');
    }
    // Away and back: the reader returns to the same page and scroll offset.
    await page.evaluate(() => { const c = document.querySelector('.pdf-viewer-container'); c.scrollTop = c.scrollHeight * 0.6; });
    await page.waitForTimeout(800);
    const beforeAway = await page.evaluate(() => ({ top: Math.round(document.querySelector('.pdf-viewer-container').scrollTop), page: document.querySelector('.pdf-toolbar-page-input')?.value }));
    await openFile(page, 'alpha.md');
    await page.waitForTimeout(800);
    await openFile(page, 'reading.pdf');
    await page.waitForTimeout(1_500);
    const afterBack = await page.evaluate(() => ({ top: Math.round(document.querySelector('.pdf-viewer-container')?.scrollTop ?? -1), page: document.querySelector('.pdf-toolbar-page-input')?.value }));
    log('pdf', `away and back: before=${JSON.stringify(beforeAway)} after=${JSON.stringify(afterBack)}`);
    log('pdf', `test hook: ${await page.evaluate(() => { const d = window.__parallxPdfDebug; if (typeof d?.getState !== 'function') return 'not installed'; const s = d.getState(); return `pages=${s.pagesCount} scale=${s.currentScaleValue} canvas=${!!s.canvas}`; })}`);
    // Add to Canvas Note: the passage goes to a canvas page and its new
    // highlight links back. Last, since the canvas page it opens hides the PDF.
    const noted = await page.evaluate(async () => {
      const spans = Array.from(document.querySelectorAll('.pdfViewer .page .textLayer span')).filter((s) => s.textContent.trim().length > 20);
      const s = spans[6];
      if (!s?.firstChild) return 'no span';
      const r = document.createRange();
      r.setStart(s.firstChild, 0); r.setEnd(s.firstChild, Math.min(25, s.firstChild.textContent.length));
      getSelection().removeAllRanges(); getSelection().addRange(r);
      const b = s.getBoundingClientRect();
      s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: b.left + 40, clientY: b.top + 4 }));
      return 'selected';
    });
    await repaint(page);
    await page.waitForTimeout(600);
    const clicked = await page.evaluate(() => { const b = document.querySelector('.pdf-selection-bubble [aria-label="Add to Canvas Note"]'); b?.click(); return !!b; });
    await page.waitForTimeout(1_200);
    // Canvas asks which page the note goes to: take the first offer (a new page).
    log('pdf', `canvas asks: ${await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.parallx-quickpick-row')).filter((x) => x.offsetParent);
      const first = items[0];
      const text = items.slice(0, 4).map((x) => x.textContent.trim().slice(0, 40)).join(' | ');
      first?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      first?.click();
      return text || 'nothing offered';
    })}`);
    await page.waitForTimeout(2_500);
    await repaint(page);
    log('pdf', `canvas note: ${noted} bubbleButton=${clicked} linkedTabs=${await page.evaluate(() => document.querySelectorAll('.pdf-highlight-tab.has-canvas-link').length)} tabs=${await page.evaluate(() => document.querySelectorAll('.pdf-highlight-tab').length)}`);
    await shot(page, 'pdf');
  });

  await run('mermaid', async () => {
    const r = await cmd(page, 'canvas.newPage');
    log('mermaid', `canvas.newPage: ${r}`);
    await page.waitForSelector('.ProseMirror', { timeout: 10_000 });
    await page.waitForTimeout(800);
    const ins = await page.evaluate(() => {
      const ed = Array.from(document.querySelectorAll('.ProseMirror')).map((x) => x.editor).find(Boolean);
      if (!ed) return 'no editor on .ProseMirror';
      return ed.commands.insertContent({ type: 'mermaidDiagram' }) ? 'inserted' : 'insert refused';
    });
    log('mermaid', ins);
    await page.waitForSelector('.canvas-mermaid svg', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(800);
    log('mermaid', `drawn: ${await page.evaluate(() => `${document.querySelectorAll('.canvas-mermaid svg').length} svg, message="${document.querySelector('.canvas-mermaid__message')?.textContent || ''}"`)}`);
    await page.evaluate(() => {
      window.__mmDraws = 0;
      const host = document.querySelector('.canvas-mermaid');
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName.toLowerCase() === 'svg') window.__mmDraws++; }).observe(host, { childList: true, subtree: true });
    });
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
    log('dashboard', await page.evaluate(() => `header=${!!document.querySelector('.dashboard-header__title')} roots=${Array.from(document.querySelectorAll('[class*="dashboard"]')).slice(0, 8).map((x) => x.className.split(' ')[0]).join(',')}`));
    await cmd(page, 'dashboard.addWidget');
    await page.waitForTimeout(1_000);
    log('dashboard', `picker: ${await page.evaluate(() => { const els = Array.from(document.querySelectorAll('[class*="picker"] button, [class*="picker"] [role="option"], [class*="gallery"] button, [class*="catalog"] [class*="item"], [class*="add-widget"] [class*="item"]')).filter((x) => x.offsetParent); const first = els[0]; first?.click(); return `${els.length} items, first="${first?.textContent.trim().slice(0, 40)}" class=${first?.className}`; })}`);
    await page.waitForTimeout(1_500);
    log('dashboard', `widgets=${await page.evaluate(() => document.querySelectorAll('.dashboard-widget').length)} buttons=${await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('.dashboard-widget__btn')).map((b) => b.title))).join('|'))}`);
    for (const title of ['Appearance', 'Configure']) {
      const opened = await page.evaluate((t) => { const b = document.querySelector(`.dashboard-widget__btn[title="${t}"]`); b?.click(); return !!b; }, title);
      await page.waitForTimeout(800);
      const selects = await page.evaluate(() => Array.from(document.querySelectorAll('.ui-select')).filter((x) => x.offsetParent).length);
      // Open the first visible select's dropdown and pick its second entry.
      const before = await page.evaluate(() => Array.from(document.querySelectorAll('.ui-select')).find((x) => x.offsetParent)?.textContent.trim());
      const at = await page.evaluate(() => { const s = Array.from(document.querySelectorAll('.ui-select')).find((x) => x.offsetParent); const r = s?.querySelector('button, [role="combobox"], .ui-dropdown')?.getBoundingClientRect() ?? s?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
      let after = 'no select';
      let listItems = 0;
      if (at) {
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(500);
        listItems = await page.evaluate(() => document.querySelectorAll('.ui-dropdown__list [role="option"], .ui-dropdown__list .ui-dropdown__item').length);
        await page.evaluate(() => { const items = document.querySelectorAll('.ui-dropdown__list [role="option"], .ui-dropdown__list .ui-dropdown__item'); (items[1] ?? items[0])?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); (items[1] ?? items[0])?.click(); });
        await page.waitForTimeout(500);
        after = await page.evaluate(() => Array.from(document.querySelectorAll('.ui-select')).find((x) => x.offsetParent)?.textContent.trim());
      }
      log('dashboard', `${title}: button=${opened} visible selects=${selects} first="${before}" list items=${listItems} after pick="${after}"`);
      await shot(page, `dashboard-${title.toLowerCase()}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await shot(page, 'dashboard');
  });

  await run('icons', async () => {
    log('icons', await page.evaluate(() => {
      const holders = Array.from(document.querySelectorAll('.activity-bar-item, .codicon, [class*="icon"]')).filter((x) => x.offsetParent);
      const withSvg = holders.filter((x) => x.querySelector('svg'));
      const bad = Array.from(document.querySelectorAll('svg')).filter((s) => s.offsetParent !== null && s.getBoundingClientRect().width === 0).length;
      const raw = Array.from(document.querySelectorAll('[class*="icon"]')).filter((x) => /<path|<svg/.test(x.textContent || '')).length;
      return `visible icon holders=${holders.length} with svg=${withSvg.length} zero-width svgs=${bad} markup-as-text=${raw} activity items=${document.querySelectorAll('.activity-bar-item').length} activity with svg=${Array.from(document.querySelectorAll('.activity-bar-item')).filter((x) => x.querySelector('svg')).length}`;
    }));
  });

  await run('tools', async () => {
    const r = await cmd(page, 'tools.showInstalled');
    log('tools', `tools.showInstalled: ${r}`);
    await page.waitForTimeout(1_500);
    const list = await page.evaluate(async () => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolRegistryService' });
      const all = svc?.getAll?.() ?? svc?.getTools?.() ?? [];
      return all.map((t) => `${t.description?.manifest?.id ?? t.manifest?.id ?? t.id}${t.description?.isBuiltin || t.isBuiltin ? '' : '(ext)'}`);
    });
    log('tools', `registry (${list.length}): ${list.join(', ')}`);
    log('tools', `view text: ${await page.evaluate(() => (document.querySelector('[data-view-id="view.tools"], .tool-gallery, .tools-view')?.textContent || 'no view element').replace(/\s+/g, ' ').slice(0, 600))}`);
    // Each optional built-in off and on again.
    const res = await page.evaluate(async () => {
      const en = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
      const reg = window.__parallx_workbench__?._services?.get?.({ id: 'IToolRegistryService' });
      if (!en || !reg) return 'no enablement or registry service';
      const all = (reg.getAll?.() ?? []).map((t) => t.description ?? t);
      const out = [];
      for (const d of all) {
        const m = d.manifest ?? d;
        if (!d.isBuiltin || m.required) continue;
        try {
          await en.setEnablement(m.id, false);
          await new Promise((r) => setTimeout(r, 200));
          await en.setEnablement(m.id, true);
          await new Promise((r) => setTimeout(r, 200));
          out.push(`${m.id}:ok`);
        } catch (e) { out.push(`${m.id}:ERR ${String(e?.message || e).slice(0, 80)}`); }
      }
      return out.join(' ');
    });
    log('tools', `toggle: ${res}`);
  });

  await run('docling', async () => {
    // The window must keep painting while Settings > Documents looks for Python.
    await page.evaluate(() => {
      window.__gaps = [];
      let last = performance.now();
      const tick = () => { const now = performance.now(); window.__gaps.push(now - last); last = now; if (window.__gaps.length < 400) setTimeout(tick, 16); };
      setTimeout(tick, 16);
    });
    const r = await cmd(page, 'workbench.action.openSettings', 'documents');
    log('docling', `openSettings: ${r}`);
    await page.waitForTimeout(1_000);
    const hit = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.settings-editor *')).find((x) => x.childElementCount === 0 && /^Python$/.test(x.textContent.trim()));
      el?.click();
      return !!el;
    });
    log('docling', `Documents section clicked: ${hit}`);
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
    log('docling', `panel text: ${await page.evaluate(() => (document.querySelector('.settings-editor')?.textContent || '').replace(/\s+/g, ' ').match(/.{0,80}(Docling|Python).{0,160}/i)?.[0] || 'no Docling/Python text')}`);
    await shot(page, 'docling');
  });

  await run('worksheet', async () => {
    const dl = path.join(ws, 'downloads');
    await fs.mkdir(dl, { recursive: true });
    // Downloads land in the throwaway workspace, never the real Downloads folder.
    await app.evaluate(({ session }, dir) => {
      session.defaultSession.on('will-download', (_e, item) => item.setSavePath(`${dir}\\${item.getFilename()}`));
    }, dl).catch((e) => log('worksheet', `download hook failed: ${String(e).split('\n')[0]}`));
    const waitHost = () => page.waitForFunction(() => !!document.querySelector('.ws-pane__sheet')?.__wsHost, null, { timeout: 60_000 });
    const host = (fn, ...a) => page.evaluate(({ fn, a }) => document.querySelector('.ws-pane__sheet').__wsHost[fn](...a), { fn, a });
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
    log('worksheet', `import pane: ${await page.evaluate(() => (Array.from(document.querySelectorAll('.ws-import__row, .ws-xlrow__title, .ws-import__grouphead, [class*="status"]')).filter((x) => x.offsetParent).map((x) => x.textContent.trim()).join(' / ') || 'no import rows').replace(/\s+/g, ' ').slice(0, 400))}`);
    await shot(page, 'worksheet-import');
  });

  await run('exts', async () => {
    // Every extension the refactor touched activates cleanly.
    const ids = ['parallx-community.flashcards', 'parallx.budget', 'parallx-community.study', 'parallx-community.creations-ai', 'parallx.workspace-graph', 'parallx-community.media-organizer'];
    log('exts', await page.evaluate(async (ids) => {
      const en = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
      const out = [];
      for (const id of ids) { try { await en.setEnablement(id, true); out.push(`${id}:on`); } catch (e) { out.push(`${id}:ERR ${e.message}`); } }
      return out.join(' ');
    }, ids));
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
