// Hidden-window probe: a scanned PDF is read, and the PDF view treats it as a
// document with text. It makes a one-page scan (a picture of a page with no
// text of its own), has the document reader read it, opens it, and checks:
// the reader's lines are kept with their boxes; the page's text layer is
// built from them and sits on the printed lines; find highlights a phrase;
// a quote is located on its page. Then a second scan, which nobody has read,
// is opened: the view says it is being read, and its text arrives on the
// page already on screen (find works, the reading is kept).
//
// It uses the reader's engine as installed on this machine (set it up first:
// the command Set Up Document Reader). Without it the probe says so and stops.
// Usage: node tests/probes/read-anything-probe.mjs <outDir>
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import { PROJECT_ROOT, launchApp, openFile } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-read-anything'));
const LINES = [
  { text: 'Chapter 7: Reserving', y: 220, size: 64 },
  { text: 'The ultimate loss is not the same as the expected loss.', y: 420, size: 40 },
  { text: 'Development factors are selected from the triangle.', y: 500, size: 40 },
  { text: 'Total reserve 1,250,000', y: 580, size: 40 },
];
const PAGE_W = 1654; const PAGE_H = 2339; // A4 at 200 dpi
/** The second scan: never handed to the reader before it is opened. */
const UNREAD = [
  { text: 'Appendix B: Tail factors', y: 240, size: 60 },
  { text: 'The Bondy method repeats the last selected factor.', y: 430, size: 40 },
  { text: 'Exponential decay is fitted to the last few factors.', y: 510, size: 40 },
];

/** In the page: a picture of a page with these lines printed on it, as a JPEG in base64. */
const drawPage = ({ LINES, PAGE_W, PAGE_H }) => {
  const c = document.createElement('canvas');
  c.width = PAGE_W; c.height = PAGE_H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, PAGE_W, PAGE_H);
  g.fillStyle = '#111';
  for (const l of LINES) { g.font = `${l.size}px Georgia, serif`; g.fillText(l.text, 180, l.y); }
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
};

/** In the page: the text layer of the PDF on screen (the tab showing, not one kept behind it), each line with its place. */
const readLayer = () => {
  const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
  const pageEl = pane?.querySelector('.pdfViewer .page');
  const spans = [...(pane?.querySelectorAll('.textLayer span') ?? [])].filter((s) => s.textContent.trim());
  const box = pageEl?.getBoundingClientRect();
  return {
    count: spans.length,
    text: spans.map((s) => s.textContent).join(' | '),
    page: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
    spans: spans.map((s) => { const r = s.getBoundingClientRect(); return { text: s.textContent, x: r.x, y: r.y, w: r.width, h: r.height }; }),
  };
};

/** How far the worst line of a text layer sits from where it is printed, in pixels. */
function worstOffset(layer, lines) {
  let worst = 0;
  for (const want of lines) {
    const span = layer.spans.find((s) => s.text.includes(want.text.slice(0, 14)));
    if (!span || !layer.page) { worst = Infinity; continue; }
    const scale = layer.page.w / PAGE_W;
    const expectedLeft = layer.page.x + 180 * scale;
    const expectedMid = layer.page.y + (want.y - want.size * 0.3) * scale;
    worst = Math.max(worst, Math.abs(span.x - expectedLeft), Math.abs(span.y + span.h / 2 - expectedMid));
  }
  return worst;
}

/** An image-only PDF: each page is a JPEG and nothing else. `jpegs` is one picture or several. */
function scanPdf(jpegs, w, h) {
  const pictures = Array.isArray(jpegs) ? jpegs : [jpegs];
  const head = (s) => Buffer.from(s, 'latin1');
  const parts = [];
  const offsets = [];
  let size = 0;
  const push = (b) => { parts.push(b); size += b.length; };
  push(head('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
  const obj = (n, body, stream) => {
    offsets[n] = size;
    push(head(`${n} 0 obj\n${body}\n`));
    if (stream) { push(head('stream\n')); push(stream); push(head('\nendstream\n')); }
    push(head('endobj\n'));
  };
  const content = head(`q 595 0 0 842 0 0 cm /Im0 Do Q`);
  // Objects 1 and 2 are the catalog and the page list; each page then takes three: itself, what it draws, its picture.
  const last = 2 + 3 * pictures.length;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pictures.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pictures.length} >>`);
  pictures.forEach((jpeg, i) => {
    const n = 3 + 3 * i;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${n + 1} 0 R /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> >>`);
    obj(n + 1, `<< /Length ${content.length} >>`, content);
    obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  });
  const xref = size;
  let table = `xref\n0 ${last + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= last; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(head(`${table}trailer\n<< /Size ${last + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(parts);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const runtimes = path.join(PROJECT_ROOT, 'data', 'runtimes');
  if (!fssync.existsSync(path.join(runtimes, 'docling', 'state.json'))) {
    console.log('[probe] SKIP the document reader is not set up on this machine (run Set Up Document Reader first)');
    process.exit(2);
  }
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-ra-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-ra-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'Scans'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  // The reader's declaration (its lock, its model list, its server) is read from the app root.
  await fs.symlink(path.join(PROJECT_ROOT, 'tools'), path.join(appRoot, 'tools'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  process.env.PARALLX_RUNTIMES_DIR = runtimes;

  const { app, page, errors } = await launchApp(appRoot);
  let failed = 0;
  const check = (ok, what) => { if (!ok) failed++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const shot = async (name) => {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => {
      const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      return img.isEmpty() ? '' : img.toPNG().toString('base64');
    });
    if (b64) { await fs.writeFile(path.join(outDir, name), Buffer.from(b64, 'base64')); console.log(`[probe] screenshot -> ${path.join(outDir, name)}`); }
  };

  try {
    // 1. A picture of a page: text drawn on a canvas, saved as a JPEG, wrapped in a PDF.
    const jpegB64 = await page.evaluate(drawPage, { LINES, PAGE_W, PAGE_H });
    const scan = path.join(workspace, 'Scans', 'scan.pdf');
    await fs.writeFile(scan, scanPdf(Buffer.from(jpegB64, 'base64'), PAGE_W, PAGE_H));
    // And a second one of four pages, written now so the app lists it, and handed to nobody until it is opened (step 8).
    const unread = path.join(workspace, 'Scans', 'unread.pdf');
    const unreadPages = [UNREAD, ...[2, 3, 4].map((n) => [{ text: `Page ${n} of the appendix`, y: 260, size: 56 }, { text: 'More selected factors follow on this page.', y: 430, size: 40 }])];
    const unreadJpegs = [];
    for (const lines of unreadPages) unreadJpegs.push(Buffer.from(await page.evaluate(drawPage, { LINES: lines, PAGE_W, PAGE_H }), 'base64'));
    await fs.writeFile(unread, scanPdf(unreadJpegs, PAGE_W, PAGE_H));

    // 2. The reader reads it, as indexing would for a scan.
    const started = await page.evaluate(() => window.parallxElectron.docling.start());
    check(started && started.ok === true && started.engine === 'managed', `the reader starts from its own engine (${JSON.stringify(started).slice(0, 160)})`);
    const t0 = Date.now();
    const converted = await page.evaluate((p) => window.parallxElectron.docling.convert(p, { ocr: true }), scan);
    check(converted.ok === true && /ultimate loss is not the same as the expected loss/i.test(converted.markdown || ''), `the scan is read in ${Date.now() - t0} ms: ${JSON.stringify((converted.markdown || converted.error || '').slice(0, 120))}`);
    check(!('reading' in converted), 'the positions are kept by the main process, not sent with the text');

    // 3. Its reading: every line with a box.
    const reading = await page.evaluate((p) => window.parallxElectron.docling.reading(p), scan);
    const lines = reading?.pages?.[0]?.lines ?? [];
    check(lines.length >= LINES.length && lines.every((l) => Array.isArray(l.box) && l.box.length === 4), `the reading has ${lines.length} lines on page 1, each with a box`);

    // 4. A quote is found on its page, though the PDF has no text of its own.
    const located = await page.evaluate(async (p) => {
      const wb = window.__parallx_workbench__;
      const files = wb._services.get({ id: 'IFileService' });
      const root = wb._services.get({ id: 'IWorkspaceService' }).folders[0]?.uri;
      if (!root) return { error: 'no workspace folder' };
      void p;
      try { const r = await files.locateInFile(root.joinPath('Scans', 'scan.pdf'), 'the ultimate loss is not the same'); return { addressing: r.addressing, pageCount: r.pageCount, spots: r.spots }; }
      catch (e) { return { error: String(e?.message || e) }; }
    }, scan);
    check(located.addressing === 'page' && located.spots?.[0]?.page === 1, `a quote is located on page 1 (${JSON.stringify(located).slice(0, 200)})`);

    // 5. Open it: the page gets a text layer made of the reader's lines.
    await openFile(page, 'scan.pdf');
    await page.waitForSelector('.pdf-editor-pane .textLayer span', { state: 'attached', timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    const layer = await page.evaluate(readLayer);
    check(layer.count >= LINES.length && /ultimate loss/i.test(layer.text), `the scanned page has a text layer of ${layer.count} lines: ${JSON.stringify(layer.text.slice(0, 140))}`);

    // 6. Each line of text sits on its printed line: same place, same width, within a few pixels.
    const worst = worstOffset(layer, LINES);
    check(worst < 8, `each line of the text layer sits on its printed line (worst offset ${Number.isFinite(worst) ? worst.toFixed(1) : 'missing'} px)`);

    // 7. Find works on the scan.
    await page.locator('.pdf-editor-pane').first().click({ position: { x: 300, y: 300 } }).catch(() => {});
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(500);
    await page.keyboard.type('expected loss');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_500);
    const found = await page.evaluate(() => [...document.querySelectorAll('.pdf-editor-pane .textLayer .highlight')].map((h) => h.textContent).join(''));
    check(/expected loss/i.test(found), `find highlights the phrase on the scan (${JSON.stringify(found)})`);
    await shot('scan-find.png');
    await page.keyboard.press('Escape');

    // 8. A scan nobody has read is read when it is opened.
    check(await page.evaluate((p) => window.parallxElectron.docling.reading(p), unread) === null, 'a second scan (four pages) has no reading before it is opened');
    // Whatever the view says while the scan is read is kept here, however briefly it shows.
    await page.evaluate(() => {
      window.__scanSaid = [];
      new MutationObserver(() => { const s = document.querySelector('.pdf-scan-status'); if (s && !window.__scanSaid.includes(s.textContent)) window.__scanSaid.push(s.textContent); }).observe(document.body, { childList: true, subtree: true });
    });
    await openFile(page, 'unread.pdf');
    await page.waitForSelector('.pdf-scan-status', { state: 'attached', timeout: 20_000 }).catch(() => {});
    const t1 = Date.now();
    await shot('unread-being-read.png');
    await page.waitForFunction(() => {
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      return !!pane && [...pane.querySelectorAll('.textLayer span')].some((s) => /Bondy method/i.test(s.textContent));
    }, null, { timeout: 180_000 }).catch(() => {});
    const waited = Date.now() - t1;
    await page.waitForTimeout(1_200);
    const said = await page.evaluate(() => window.__scanSaid);
    check(said.some((s) => /Reading this scan/.test(s)), `opening it says the scan is being read (${JSON.stringify(said)})`);
    const arrived = await page.evaluate(readLayer);
    check(/Bondy method/i.test(arrived.text) && !/Chapter 7/.test(arrived.text), `its text arrives on the open page ${waited} ms later, without the file being opened again: ${JSON.stringify(arrived.text.slice(0, 120))}`);
    check(await page.evaluate(() => !document.querySelector('.pdf-scan-status')), 'the line goes when the reading is done');
    const worstUnread = worstOffset(arrived, UNREAD);
    check(worstUnread < 8, `each line of its first page sits on its printed line (worst offset ${Number.isFinite(worstUnread) ? worstUnread.toFixed(1) : 'missing'} px)`);
    // A later page has its text when it is reached.
    await page.evaluate(() => {
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      const pages = pane.querySelectorAll('.pdfViewer .page');
      pages[pages.length - 1].scrollIntoView();
    });
    const lastPage = await page.waitForFunction(() => {
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      return !!pane && [...pane.querySelectorAll('.textLayer span')].some((s) => /Page 4 of the appendix/i.test(s.textContent));
    }, null, { timeout: 30_000 }).then(() => true, () => false);
    check(lastPage, 'its last page has its text when it is scrolled to');
    await page.locator('.pdf-editor-pane:visible').first().click({ position: { x: 300, y: 300 } }).catch(() => {});
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Exponential decay');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_500);
    const foundUnread = await page.evaluate(() => {
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      return [...pane.querySelectorAll('.textLayer .highlight')].map((h) => h.textContent).join('');
    });
    check(/Exponential decay/i.test(foundUnread), `find works on it (${JSON.stringify(foundUnread)})`);
    const keptNow = await page.evaluate((p) => window.parallxElectron.docling.reading(p), unread);
    const keptLines = (keptNow?.pages ?? []).map((p) => p.lines?.length ?? 0);
    check(keptLines.length === 4 && keptLines[0] >= UNREAD.length && keptLines.every((n) => n >= 1), `its reading is kept (lines a page: ${JSON.stringify(keptLines)}), so it is not read again`);
    await shot('unread-read.png');

    // The hidden copy is kept off Ollama on purpose; indexing saying so is not a fault here.
    const faults = errors.filter((e) => !/Cannot connect to Ollama|ERR_CONNECTION_REFUSED/.test(e));
    check(faults.length === 0, `no errors in the window${faults.length ? `: ${faults.slice(0, 3).join(' || ')}` : ''}`);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failed ? `[probe] ${failed} FAILED` : '[probe] 0 problems');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
