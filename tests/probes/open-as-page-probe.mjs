// open-as-page-probe.mjs: a scan made into a page beside it, and the two
// kept in step, in a hidden copy of the app on a throwaway workspace.
//
// A four-page scan is drawn (a page with a captioned table, three of text)
// and read by the real document reader on this machine, on the processor
// (set it up first: Set Up Document Reader). Then, as a person would:
// the PDF's Reading side, Open As Page. Checked:
//   - the page that is made: its title, its first line naming the file, a
//     real table with heading cells, the text of both pages, in order;
//   - the record of where each block came from, kept in the workspace;
//   - a press in a cell of the page frames that very cell on the scan;
//   - a press on the scan marks the block made from that spot on the page;
//   - each side follows the other's scroll;
//   - asking again opens the same page, and makes no second one.
// No model is used.
//
// Usage: node tests/probes/open-as-page-probe.mjs [outDir]
// Requires `npm run build` first (the app loads dist/). Run it from Bash.

import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import { PROJECT_ROOT, launchApp, openFile, cmd } from './scene.mjs';
import { PAGE_W, PAGE_H, TABLE, PROSE_Y, drawPage, drawTablePage, scanPdf } from './scan-pages.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-open-as-page'));

/** A page of text: a heading and twelve lines, so that both the scan and the page made from it have room to scroll. */
const textPage = (n, title) => [
  { text: title, y: 240, size: 60 },
  ...Array.from({ length: 12 }, (_, i) => ({ text: `Line ${i + 1} of page ${n} of the tail factor notes.`, y: 420 + i * 140, size: 40 })),
];
const MORE = [textPage(2, 'Appendix D: Tail factors'), textPage(3, 'Appendix E: Curve fitting'), textPage(4, 'Appendix F: Results')];

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const runtimes = path.join(PROJECT_ROOT, 'data', 'runtimes');
  if (!fssync.existsSync(path.join(runtimes, 'docling', 'state.json'))) {
    console.log('[page] SKIP the document reader is not set up on this machine (run Set Up Document Reader first)');
    process.exit(2);
  }
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-oap-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-oap-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'Scans'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.symlink(path.join(PROJECT_ROOT, 'tools'), path.join(appRoot, 'tools'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  process.env.PARALLX_RUNTIMES_DIR = runtimes;

  const { app, page, errors } = await launchApp(appRoot);
  let failed = 0;
  const check = (ok, what) => { if (!ok) failed++; console.log(`[page] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const shot = async (name) => {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.invalidate(); await new Promise((r) => setTimeout(r, 250)); await wc.capturePage(); await new Promise((r) => setTimeout(r, 400)); const img = await wc.capturePage(); return img.isEmpty() ? '' : img.toPNG().toString('base64'); });
    if (b64) { await fs.writeFile(path.join(outDir, name), Buffer.from(b64, 'base64')); console.log(`[page] picture -> ${path.join(outDir, name)}`); }
  };
  /** The page that is showing, as its blocks: what each is, its words, and where it sits in the window. */
  const pageSide = () => page.evaluate(() => {
    const surface = [...document.querySelectorAll('[data-px-surface="canvas"]')].find((s) => s.getClientRects().length);
    if (!surface) return null;
    const editor = surface.querySelector('.ProseMirror') ?? surface;
    const rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    const blocks = [...editor.children].map((e) => ({ tag: e.tagName.toLowerCase(), cls: e.className, text: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90), id: e.getAttribute('data-id') ?? e.querySelector('[data-id]')?.getAttribute('data-id') ?? '' }));
    const table = editor.querySelector('table');
    let scroller = null;
    for (let up = editor.parentElement; up; up = up.parentElement) { const o = getComputedStyle(up).overflowY; if ((o === 'auto' || o === 'scroll') && up.scrollHeight > up.clientHeight) { scroller = up; break; } }
    return {
      pageId: (surface.getAttribute('data-px-instance') ?? '').split(':').pop(),
      blocks,
      rows: table ? [...table.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => `${c.tagName === 'TH' ? 'H' : 'C'}:${(c.textContent ?? '').trim()}`)) : [],
      // The mark is drawn over a block: the block under its middle is the one marked.
      marked: [...surface.querySelectorAll('.canvas-scan-mark')].map((m) => {
        const r = m.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const under = [...editor.children].find((e) => { const b = e.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
        return (under?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      }),
      scroller: scroller ? { cls: scroller.className.slice(0, 60), top: Math.round(scroller.scrollTop), inSurface: surface.contains(scroller), rect: rect(scroller) } : null,
      surface: rect(surface),
    };
  });
  /** The scan's view: its frame, and how far it is scrolled. */
  const scanSide = () => page.evaluate(() => {
    const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
    const frame = pane?.querySelector('.pdf-cited-block');
    const container = pane?.querySelector('.pdf-viewer-container');
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const sheets = [...(pane?.querySelectorAll('.pdfViewer .page') ?? [])];
    return { frame: frame ? r(frame) : null, label: frame?.getAttribute('aria-label') ?? '', named: !!frame?.querySelector('.pdf-cited-block__name'), sheets: sheets.map(r), scrollTop: Math.round(container?.scrollTop ?? -1), container: container ? r(container) : null };
  });

  try {
    // The scan: a page with a captioned table, and a page of text.
    const first = Buffer.from(await page.evaluate(drawTablePage, { TABLE, PROSE_Y, PAGE_W, PAGE_H }), 'base64');
    const rest = [];
    for (const lines of MORE) rest.push(Buffer.from(await page.evaluate(drawPage, { LINES: lines, PAGE_W, PAGE_H }), 'base64'));
    const pdf = path.join(workspace, 'Scans', 'appendix.pdf');
    await fs.writeFile(pdf, scanPdf([first, ...rest], PAGE_W, PAGE_H));
    const started = await page.evaluate(() => window.parallxElectron.docling.start());
    check(started?.ok === true, 'the document reader starts');
    const converted = await page.evaluate((p) => window.parallxElectron.docling.convert(p, { ocr: true }), pdf);
    check(converted?.ok === true, 'the four-page scan is read');

    // The PDF, its Reading side, Open As Page.
    await openFile(page, 'appendix.pdf');
    await page.waitForTimeout(1_500);
    const pane = page.locator('.pdf-editor-pane:visible').first();
    await pane.locator('button[aria-label="Outline, Pages And Reading"]').click();
    await pane.locator('.pdf-side-panel-header .ui-segmented-control__segment', { hasText: 'Reading' }).click();
    await pane.locator('.pdf-reading button', { hasText: 'Open As Page' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await pane.locator('.pdf-reading button', { hasText: 'Open As Page' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-px-surface="canvas"]')].some((s) => s.getClientRects().length && s.querySelector('table')), null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    const made = await pageSide();
    console.log(`[page] the page that was made: ${JSON.stringify(made).slice(0, 1800)}`);
    check(!!made && made.blocks.length >= 6, `Open As Page makes a page and opens it (${made?.blocks.length ?? 0} blocks)`);
    const groups = await page.evaluate(() => ({ pdf: [...document.querySelectorAll('.pdf-editor-pane')].filter((p) => p.getClientRects().length).length, canvas: [...document.querySelectorAll('[data-px-surface="canvas"]')].filter((s) => s.getClientRects().length).length }));
    check(groups.pdf === 1 && groups.canvas === 1, 'the scan and the page are side by side, both showing');
    const texts = (made?.blocks ?? []).map((b) => b.text);
    check(/^From appendix\.pdf$/.test(texts[0] ?? ''), `the page opens with a line naming the file ("${texts[0]}")`);
    const at = (re) => texts.findIndex((t) => re.test(t));
    check(at(/Appendix C/) > 0 && at(/Appendix C/) < at(/Table 3/) && at(/Bondy method/) > at(/Table 3/) && at(/Appendix D/) > at(/Bondy method/) && at(/Appendix E/) > at(/Line 12 of page 2/) && at(/Appendix F/) > at(/Line 12 of page 3/) && at(/Line 12 of page 4/) > at(/Appendix F/), 'its blocks are in the order of the scan, page after page');
    // The words are the reader's (it has read the bold "Paid" as "pad" before now); what is checked is that the grid is a real table.
    const rows = made?.rows ?? [];
    check(rows.length === 3 && rows.every((r) => r.length === 3) && rows[0].every((c) => c.startsWith('H:')) && rows[0][0] === 'H:Age' && JSON.stringify(rows.slice(1)) === JSON.stringify([['C:108', 'C:1.08', 'C:1.04'], ['C:120', 'C:1.05', 'C:1.02']]), `the scanned table is a real table, with its heading row (${JSON.stringify(rows)})`);
    const title = await page.evaluate(() => [...document.querySelectorAll('[data-px-surface="canvas"]')].find((s) => s.getClientRects().length)?.querySelector('.canvas-page-title, [data-placeholder="Untitled"], h1')?.textContent ?? '');
    check(/appendix/i.test(title), `it is titled after the file ("${title}")`);
    await shot('open-as-page.png');

    // Where each block came from is kept in the workspace, beside its other files.
    const recordFile = path.join(workspace, '.parallx', 'page-sources', `${made?.pageId}.json`);
    const record = JSON.parse(await fs.readFile(recordFile, 'utf8').catch(() => 'null'));
    check(!!record && record.file === 'Scans/appendix.pdf' && Object.keys(record.anchors ?? {}).length >= 40 && !!record.pageSizes?.['4'], `the record of where each block came from is kept with the workspace (${Object.keys(record?.anchors ?? {}).length} places, file "${record?.file}")`);

    // The page points at the scan: a press in a cell frames that very cell.
    const cell = page.locator('[data-px-surface="canvas"]:visible td', { hasText: /^1\.05$/ }).first();
    await cell.click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pdf-editor-pane')].some((p) => p.getClientRects().length && p.querySelector('.pdf-cited-block')), null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(600);
    const framed = await scanSide();
    check(!!framed.frame && !framed.named && /came from/.test(framed.label), `a press in a cell of the page frames a place on the scan ("${framed.label}")`);
    if (framed.frame && framed.sheets[0]) {
      // The cell "1.05": second column, third row of the table as drawn.
      const k = framed.sheets[0].w / PAGE_W;
      const colW = TABLE.w / 3, rowH = TABLE.h / 3;
      const want = { x: framed.sheets[0].x + (TABLE.x + colW) * k, y: framed.sheets[0].y + (TABLE.y + 2 * rowH) * k, w: colW * k, h: rowH * k };
      const cx = framed.frame.x + framed.frame.w / 2, cy = framed.frame.y + framed.frame.h / 2;
      const inside = cx > want.x && cx < want.x + want.w && cy > want.y && cy < want.y + want.h;
      check(inside && framed.frame.w <= want.w * 1.15 && framed.frame.h <= want.h * 1.25, `the frame is on that very cell, not on the whole table (frame ${Math.round(framed.frame.w)} x ${Math.round(framed.frame.h)} in a cell ${Math.round(want.w)} x ${Math.round(want.h)})`);
    }
    await shot('open-as-page-cell.png');
    // The keyboard does it too: the caret moved up a row, and the frame moves to the cell above.
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(700);
    const above = await scanSide();
    if (framed.frame && above.frame && above.sheets[0]) {
      const k2 = above.sheets[0].w / PAGE_W, rowH = (TABLE.h / 3) * k2;
      const moved = framed.frame.y - above.frame.y;
      check(moved > rowH * 0.6 && moved < rowH * 1.5 && Math.abs(above.frame.x - framed.frame.x) < 6, `moving the caret up a row with the keyboard moves the frame to the cell above (${moved.toFixed(1)} px up, a row is ${rowH.toFixed(1)} px)`);
    } else check(false, 'moving the caret up a row with the keyboard moves the frame to the cell above (no frame)');

    // The scan points at the page: a press on the heading marks the heading made from it.
    const sheet = (await scanSide()).sheets[0];
    const k = sheet.w / PAGE_W;
    // The page editor redraws a block whose own element is touched: watch that the mark touches none.
    await page.evaluate(() => {
      const editor = [...document.querySelectorAll('[data-px-surface="canvas"]')].find((s) => s.getClientRects().length).querySelector('.ProseMirror');
      window.__oapTouched = 0;
      // What counts: a block redrawn (children changed) or its class changed. The editor's own frame losing the focus is not the mark's doing.
      new MutationObserver((list) => { for (const m of list) if (m.type === 'childList' || (m.target !== editor && m.target.hasAttribute?.('data-id'))) window.__oapTouched++; }).observe(editor, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
    });
    await page.mouse.click(sheet.x + 300 * k, sheet.y + 225 * k); // on "Appendix C", printed at about (180..560, 190..245)
    await page.waitForTimeout(500);
    const marked = await pageSide();
    check(marked?.marked.length === 1 && /^Appendix C$/.test(marked.marked[0]), `a press on the scan marks the block made from that spot (${JSON.stringify(marked?.marked)})`);
    check(await page.evaluate(() => window.__oapTouched) === 0, 'the mark is drawn over the block: the page\'s own content is not touched');
    const picked = await scanSide();
    check(!!picked.frame && picked.frame.y < sheet.y + 300 * k, 'and frames on the scan what was picked');
    await shot('open-as-page-from-scan.png');
    await page.waitForTimeout(1_500);
    check((await pageSide())?.marked.length === 0, 'the mark goes after a moment');

    // Each side follows the other's scroll. (Four pages: both sides have room to scroll.)
    const room = await page.evaluate(() => {
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      const c = pane.querySelector('.pdf-viewer-container');
      const wrapper = [...document.querySelectorAll('[data-px-surface="canvas"]')].find((s) => s.getClientRects().length).querySelector('.canvas-editor-wrapper');
      wrapper.scrollTop = 0;
      return { scan: c.scrollHeight - c.clientHeight, page: wrapper.scrollHeight - wrapper.clientHeight, sheet: Math.round(pane.querySelector('.pdfViewer .page').getBoundingClientRect().height) };
    });
    await page.waitForTimeout(900);
    check(room.scan > room.sheet && room.page > 400, `both sides have room to scroll (the scan ${room.scan} px, the page ${room.page} px)`);
    // The scan goes to its third page: the page follows to what was made from there.
    const trace = await page.evaluate(async () => {
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      const c = pane.querySelector('.pdf-viewer-container');
      const third = pane.querySelectorAll('.pdfViewer .page')[2];
      const wrapper = [...document.querySelectorAll('[data-px-surface="canvas"]')].find((s) => s.getClientRects().length).querySelector('.canvas-editor-wrapper');
      const out = [`start scan=${Math.round(c.scrollTop)} page=${Math.round(wrapper.scrollTop)}`];
      c.scrollTop += third.getBoundingClientRect().top - c.getBoundingClientRect().top - 40;
      for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 110)); out.push(`${(i + 1) * 110}ms scan=${Math.round(c.scrollTop)} page=${Math.round(wrapper.scrollTop)}`); }
      return out;
    });
    console.log(`[page] the scan scrolled to its third page: ${JSON.stringify(trace)}`);
    /** The block of the page nearest the line both sides keep in step. */
    const atLine = () => page.evaluate(() => {
      const surface = [...document.querySelectorAll('[data-px-surface="canvas"]')].find((s) => s.getClientRects().length);
      const wrapper = surface.querySelector('.canvas-editor-wrapper');
      const box = wrapper.getBoundingClientRect();
      const line = box.top + box.height * 0.25;
      return [...surface.querySelector('.ProseMirror').children].map((e) => ({ text: (e.textContent ?? '').trim().slice(0, 50), d: Math.round(Math.abs(e.getBoundingClientRect().top - line)) })).sort((a, b) => a.d - b.d)[0];
    });
    const followed = await atLine();
    check(/of page 3 of the tail|Appendix E/.test(followed?.text ?? '') && followed.d < 40, `the page follows the scan's scroll: what was made from the same height of its third page is at the same height (at the line: "${followed?.text}", ${followed?.d} px off)`);
    await shot('open-as-page-scrolled.png');
    await page.waitForTimeout(700);
    // The page goes back to its top: the scan follows to its first page.
    const scanBefore = await scanSide();
    await page.evaluate(() => { [...document.querySelectorAll('[data-px-surface="canvas"]')].find((s) => s.getClientRects().length).querySelector('.canvas-editor-wrapper').scrollTop = 0; });
    await page.waitForTimeout(900);
    const scanAfter = await scanSide();
    check(scanBefore.scrollTop > room.sheet && scanAfter.scrollTop < room.sheet * 0.5, `the scan follows the page's scroll back to its first page (${scanBefore.scrollTop} to ${scanAfter.scrollTop})`);
    // And it settles: neither side keeps pulling the other.
    await page.waitForTimeout(900);
    const settled = await scanSide();
    check(Math.abs(settled.scrollTop - scanAfter.scrollTop) < 3, 'the two sides come to rest');

    // Asking again opens the same page: a document becomes a page once.
    await page.locator('.pdf-editor-pane:visible .pdf-viewer-container').first().click({ position: { x: 30, y: 30 } }).catch(() => {});
    await cmd(page, 'canvas.openFileAsPage', pdf);
    await page.waitForTimeout(1_500);
    const again = await pageSide();
    const records = await fs.readdir(path.join(workspace, '.parallx', 'page-sources')).catch(() => []);
    check(again?.pageId === made?.pageId && records.length === 1, `asking again opens the page it became, and makes no second one (${records.length} record)`);

    const faults = errors.filter((e) => !/Cannot connect to Ollama|ERR_CONNECTION_REFUSED/.test(e));
    check(faults.length === 0, `no errors in the window${faults.length ? `: ${faults.slice(0, 3).join(' || ')}` : ''}`);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failed ? `[page] ${failed} FAILED` : '[page] 0 problems');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
