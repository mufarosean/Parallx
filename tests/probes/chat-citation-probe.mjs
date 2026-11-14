// chat-citation-probe.mjs: from a question in the chat to the place on the
// page, checked in a hidden copy of the app on a throwaway workspace.
//
// No model is used. A stand-in answers in Ollama's wire format and behaves
// as a model would for this one question: it first calls the app's own Read
// tool on a scanned page, then answers from what the tool returned, citing
// the block's source label. Everything after that is the app's real path:
// the label is checked and becomes a link that carries the words the
// sentence rests on; pointing at the link shows a card with the piece of the
// page; the keyboard shows it too; following the link opens the PDF with the
// cited table framed. The scanned page is read by the real document reader
// on this machine (set it up first: Set Up Document Reader), on the
// processor. A second question cites a PDF with text of its own that the
// reader never saw: its card is made from the text the page itself reports.
// A third cites a row near the foot of a table that fills its page: the card
// shows the table's heading and the rows the quote is in. A finger then
// presses that citation: the first press shows the card with the way in, and
// the way in opens the page.
//
// Usage: node tests/probes/chat-citation-probe.mjs [--out FOLDER]
// Requires `npm run build` first (the app loads dist/). Run it from Bash.

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PAGE_W, PAGE_H, TABLE, PROSE_Y, drawTablePage, scanPdf } from './scan-pages.mjs';
import { tinyPdf } from './scene.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outArg = process.argv.indexOf('--out');
const outDir = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(os.tmpdir(), 'parallx-chat-citation');

const MODEL = 'standin:latest';
const QUESTION = 'What is the paid factor at 120 months in Scans/table.pdf?';
const SECOND = 'What tail factor does Notes/hello.pdf select?';
const THIRD = 'What is the paid factor at 372 months in Scans/long.pdf?';
/** What the stand-in answers from each file, citing the block it was shown. */
const ANSWERS = {
  'Scans/table.pdf': (label) => `The paid factor at 120 months is 1.05 [${label}].`,
  'Notes/hello.pdf': (label) => `The selected tail factor is 1.05 [${label}].`,
  'Scans/long.pdf': (label) => `The paid factor at 372 months is 1.016 [${label}].`,
};
/** A table that fills its page: a heading row and a row for every twelve months to 396. */
const LONG_TABLE = {
  x: 180, y: 520, w: 900, h: 1700,
  rows: [['Age', 'Paid', 'Incurred'], ...Array.from({ length: 33 }, (_, i) => [String(12 * (i + 1)), (1 + (34 - i) / 250).toFixed(3), (1 + (34 - i) / 500).toFixed(3)])],
};
const FINAL = { total_duration: 4883583458, load_duration: 1334875, prompt_eval_count: 26, prompt_eval_duration: 342546000, eval_count: 282, eval_duration: 4535599000 };
const line = (o) => JSON.stringify({ model: MODEL, created_at: new Date().toISOString(), ...o });
const stream = (chunks) => `${chunks.map(line).join('\n')}\n`;
const seen = { readCalls: 0, answers: 0 };

/** What the stand-in says to one chat request: a call of the Read tool, then an answer citing what it returned. */
function reply(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const text = (m) => (typeof m?.content === 'string' ? m.content : '');
  const asked = text([...messages].reverse().find((m) => m.role === 'user'));
  const file = Object.keys(ANSWERS).find((f) => asked.includes(f));
  if (!file || !Array.isArray(body.tools) || body.tools.length === 0) {
    return stream([{ message: { role: 'assistant', content: 'Table factors' }, done: false }, { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', ...FINAL }]);
  }
  const read = [...messages].reverse().find((m) => m.role === 'tool');
  if (!read) {
    seen.readCalls++;
    return stream([
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'fs_read_file', arguments: { path: file } } }] }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', ...FINAL },
    ]);
  }
  seen.answers++;
  // The label on the block's own header line ("===== [S1] Scans/table.pdf · page 1 of 1 ====="), not the one in the tool's example.
  const label = (text(read).match(/=====\s*\[(S\d+)\]/) ?? [])[1] ?? 'S1';
  const answer = ANSWERS[file](label);
  return stream([
    { message: { role: 'assistant', content: answer.slice(0, 20) }, done: false },
    { message: { role: 'assistant', content: answer.slice(20) }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', ...FINAL },
  ]);
}

/** The stand-in engine: what the app asks Ollama, answered here. Anything else (embeddings) is refused. */
async function standIn(route) {
  const url = new URL(route.request().url());
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const details = { family: 'standin', families: ['standin'], parameter_size: '1B', quantization_level: 'Q4_K_M', format: 'gguf' };
  if (url.pathname === '/api/version') return json({ version: '0.12.6' });
  if (url.pathname === '/api/tags') return json({ models: [{ name: MODEL, model: MODEL, modified_at: '2026-11-01T00:00:00Z', size: 1_000_000, digest: 'standin', details }] });
  if (url.pathname === '/api/ps') return json({ models: [] });
  if (url.pathname === '/api/show') return json({ details, model_info: { 'general.architecture': 'standin', 'standin.context_length': 32768 }, capabilities: ['completion', 'tools'] });
  if (url.pathname === '/api/chat') {
    let body = {};
    try { body = route.request().postDataJSON() ?? {}; } catch { /* answered as a plain call */ }
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: reply(body) });
  }
  return route.abort('connectionrefused');
}

let failed = 0;
const check = (ok, what) => { if (!ok) failed++; console.log(`[citation] ${ok ? 'PASS' : 'FAIL'} ${what}`); };

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const runtimes = path.join(PROJECT_ROOT, 'data', 'runtimes');
  if (!fssync.existsSync(path.join(runtimes, 'docling', 'state.json'))) {
    console.log('[citation] SKIP the document reader is not set up on this machine (run Set Up Document Reader first)');
    process.exit(2);
  }
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-cite-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-cite-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'Scans'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'Notes'), { recursive: true });
  // A PDF with text of its own; the document reader is never asked for it.
  await fs.writeFile(path.join(workspace, 'Notes', 'hello.pdf'), tinyPdf('The selected tail factor is 1.05.'));
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  // The reader's declaration (its lock, its model list, its server) is read from the app root.
  await fs.symlink(path.join(PROJECT_ROOT, 'tools'), path.join(appRoot, 'tools'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));

  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, {
    PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1',
    PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache'), PARALLX_RUNTIMES_DIR: runtimes,
  });
  const errors = [];
  const app = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'], cwd: PROJECT_ROOT, env });
  // Nothing reaches the Ollama the real app uses: the stand-in answers in its place.
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, standIn);
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  const shot = async (name) => {
    // A hidden window can hand back its last painted frame: ask for a fresh one, and keep the second capture.
    const b64 = await app.evaluate(async ({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.invalidate(); await new Promise((r) => setTimeout(r, 250)); await wc.capturePage(); await new Promise((r) => setTimeout(r, 400)); const img = await wc.capturePage(); return img.isEmpty() ? '' : img.toPNG().toString('base64'); });
    if (b64) { await fs.writeFile(path.join(outDir, name), Buffer.from(b64, 'base64')); console.log(`[citation] picture -> ${path.join(outDir, name)}`); }
  };
  const run = (id, ...args) => page.evaluate(async ({ id, args }) => { try { return await window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args); } catch (e) { return `failed: ${String(e?.message || e)}`; } }, { id, args });

  try {
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);

    // A scanned page with a table, read by the real reader as the indexer would have.
    const jpeg = Buffer.from(await page.evaluate(drawTablePage, { TABLE, PROSE_Y, PAGE_W, PAGE_H }), 'base64');
    const pdf = path.join(workspace, 'Scans', 'table.pdf');
    await fs.writeFile(pdf, scanPdf(jpeg, PAGE_W, PAGE_H));
    const started = await page.evaluate(() => window.parallxElectron.docling.start());
    check(started?.ok === true, `the document reader starts (${JSON.stringify(started).slice(0, 120)})`);
    const converted = await page.evaluate((p) => window.parallxElectron.docling.convert(p, { ocr: true }), pdf);
    check(converted?.ok === true, 'the scanned page is read');

    // The question, typed into the chat; the stand-in reads the file with the app's tool and answers citing it.
    await run('chat.show');
    await page.waitForTimeout(1_200);
    const input = page.locator('.parallx-chat-input textarea').first();
    await input.click();
    await input.fill(QUESTION);
    await page.keyboard.press('Enter');
    let answered = null;
    for (let i = 0; i < 120 && !answered; i++) {
      await page.waitForTimeout(500);
      answered = await page.evaluate((q) => {
        const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
        const s = svc.getSessions().find((x) => x.messages.some((p) => p.request.text === q));
        const p = s?.messages[s.messages.length - 1];
        if (!s || s.requestInProgress || !p?.response.isComplete) return null;
        return { parts: p.response.parts.map((x) => ({ kind: x.kind, name: x.toolName, text: (x.content ?? '').slice(0, 400) })) };
      }, QUESTION);
    }
    console.log(`[citation] the answer as the app holds it: ${JSON.stringify(answered)} (the stand-in was asked ${seen.readCalls} time(s) to read, ${seen.answers} to answer)`);
    check(!!answered && answered.parts.some((p) => p.name === 'fs_read_file'), 'the stand-in read the file with the app\'s own Read tool');
    const markdown = answered?.parts.filter((p) => p.kind === 'markdown').map((p) => p.text).join('') ?? '';
    const href = (markdown.match(/\((parallx:\/\/explorer\/file\?[^)\s]+)\)/) ?? [])[1] ?? '';
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    check(params.get('path') === 'Scans/table.pdf' && params.get('page') === '1' && /1\.05/.test(params.get('quote') ?? ''), `the source label became a link to the page that carries the words it rests on (quote: ${JSON.stringify(params.get('quote'))})`);
    check(!/\[S\d+\]/.test(markdown) && !/Unverified/.test(markdown), 'the citation checked out: no raw label, not marked Unverified');

    // Pointing at the citation shows its card.
    const cite = page.locator('.parallx-chat-message--assistant a[href*="quote="]').last();
    check(/table\.pdf, page 1/.test((await cite.textContent().catch(() => '')) ?? ''), 'the citation reads "table.pdf, page 1" in the answer');
    await cite.hover();
    const pieceShown = await page.waitForSelector('.parallx-cite-peek img.parallx-cite-peek__piece', { state: 'visible', timeout: 45_000 }).then(() => true, () => false);
    await page.waitForTimeout(600);
    const card = await page.evaluate(() => {
      const c = document.querySelector('.parallx-cite-peek');
      const img = c?.querySelector('img');
      const r = c?.getBoundingClientRect();
      const a = document.querySelector('.parallx-chat-message--assistant a[aria-describedby]');
      return c ? {
        where: c.querySelector('.parallx-cite-peek__where')?.textContent ?? '', spoken: c.querySelector('.px-visually-hidden')?.textContent ?? '',
        natural: img ? [img.naturalWidth, img.naturalHeight] : null, shown: img ? [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)] : null,
        inView: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, described: a?.getAttribute('aria-describedby') === c.id, role: c.getAttribute('role'),
      } : null;
    });
    console.log(`[citation] the card: ${JSON.stringify(card)}`);
    check(pieceShown && !!card?.natural && !!card.shown && card.shown[0] >= 300 && card.natural[0] >= card.shown[0] * 1.5 && card.natural[1] >= 80, `pointing at the citation shows the piece of the page (${card?.natural?.join(' x ')} pixels, shown at ${card?.shown?.join(' x ')})`);
    check(card?.where === 'table.pdf, page 1' && card?.role === 'tooltip' && card?.described === true, 'the card says the file and the page, and describes the link for a screen reader');
    check(/Table 3/.test(card?.spoken ?? '') && /1\.05/.test(card?.spoken ?? ''), `a screen reader hears the table's name and the words (${JSON.stringify(card?.spoken)})`);
    check(card?.inView === true, 'the card sits inside the window');
    await shot('citation-card.png');
    await page.mouse.move(40, 400);
    await page.waitForTimeout(500);
    check(await page.evaluate(() => !document.querySelector('.parallx-cite-peek')), 'the card goes when the pointer leaves');

    // The keyboard reaches it too.
    await page.keyboard.press('Tab');
    await page.evaluate(() => { const all = document.querySelectorAll('.parallx-chat-message--assistant a[href*="quote="]'); all[all.length - 1].focus(); });
    await page.waitForSelector('.parallx-cite-peek', { state: 'attached', timeout: 10_000 }).catch(() => {});
    check(await page.evaluate(() => !!document.querySelector('.parallx-cite-peek') && document.activeElement?.matches('a[href*="quote="]')), 'the keyboard\'s focus on the citation shows the card');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(await page.evaluate(() => !document.querySelector('.parallx-cite-peek')), 'Escape takes it away');

    // Following the citation opens the page with the table framed.
    await cite.click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pdf-editor-pane')].some((p) => p.getClientRects().length && p.querySelector('.pdf-cited-block')), null, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    const opened = await page.evaluate(() => {
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      return { name: pane?.querySelector('.pdf-cited-block__name')?.textContent ?? '', washed: [...(pane?.querySelectorAll('.textLayer .highlight') ?? [])].map((h) => h.textContent).join(' ') };
    });
    check(opened.name === 'Table 3', `following the citation opens the page with the table framed and named ("${opened.name}")`);
    check(/1\.05/.test(opened.washed), `and the words it rests on washed (${JSON.stringify(opened.washed)})`);
    await shot('citation-followed.png');

    // A PDF with text of its own, never read by the reader: its card is made from the page's own text.
    await run('chat.newSession');
    await page.waitForTimeout(800);
    await input.click();
    await input.fill(SECOND);
    await page.keyboard.press('Enter');
    let second = '';
    for (let i = 0; i < 120 && !second; i++) {
      await page.waitForTimeout(500);
      second = await page.evaluate((q) => {
        const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
        const s = svc.getSessions().find((x) => x.messages.some((p) => p.request.text === q));
        const p = s?.messages[s.messages.length - 1];
        return s && !s.requestInProgress && p?.response.isComplete ? p.response.parts.filter((x) => x.kind === 'markdown').map((x) => x.content).join('') : '';
      }, SECOND);
    }
    const href2 = (second.match(/\((parallx:\/\/explorer\/file\?[^)\s]+)\)/) ?? [])[1] ?? '';
    const quote2 = new URLSearchParams(href2.slice(href2.indexOf('?') + 1)).get('quote');
    check(quote2 === 'The selected tail factor is 1.05.', `a citation of a PDF with its own text carries its line too (quote: ${JSON.stringify(quote2)})`);
    await page.mouse.move(40, 400);
    const cite2 = page.locator('.parallx-chat-message--assistant a[href*="hello.pdf"][href*="quote="]').last();
    await cite2.hover();
    const piece2 = await page.waitForSelector('.parallx-cite-peek img.parallx-cite-peek__piece', { state: 'visible', timeout: 45_000 }).then(() => true, () => false);
    await page.waitForTimeout(600);
    const size2 = await page.evaluate(() => { const img = document.querySelector('.parallx-cite-peek img'); return img ? [img.naturalWidth, img.naturalHeight] : null; });
    check(piece2 && !!size2 && size2[0] >= 300 && size2[1] >= 40, `its card shows the piece of the page, found by the text the page itself reports (${size2?.join(' x ')} pixels)`);
    await shot('citation-card-own-text.png');
    await page.mouse.move(40, 400);

    // A table that fills its page, cited near its foot: the card keeps the heading and shows the quoted rows.
    const longJpeg = Buffer.from(await page.evaluate(drawTablePage, { TABLE: LONG_TABLE, PROSE_Y: 2290, PAGE_W, PAGE_H }), 'base64');
    const longPdf = path.join(workspace, 'Scans', 'long.pdf');
    await fs.writeFile(longPdf, scanPdf(longJpeg, PAGE_W, PAGE_H));
    const longRead = await page.evaluate((p) => window.parallxElectron.docling.convert(p, { ocr: true }), longPdf);
    check(longRead?.ok === true, 'the page with the long table is read');
    await run('chat.newSession');
    await page.waitForTimeout(800);
    await input.click();
    await input.fill(THIRD);
    await page.keyboard.press('Enter');
    let third = '';
    for (let i = 0; i < 120 && !third; i++) {
      await page.waitForTimeout(500);
      third = await page.evaluate((q) => {
        const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
        const s = svc.getSessions().find((x) => x.messages.some((p) => p.request.text === q));
        const p = s?.messages[s.messages.length - 1];
        return s && !s.requestInProgress && p?.response.isComplete ? p.response.parts.filter((x) => x.kind === 'markdown').map((x) => x.content).join('') : '';
      }, THIRD);
    }
    const href3 = (third.match(/\((parallx:\/\/explorer\/file\?[^)\s]+)\)/) ?? [])[1] ?? '';
    const quote3 = new URLSearchParams(href3.slice(href3.indexOf('?') + 1)).get('quote') ?? '';
    check(/372/.test(quote3) && /1\.016/.test(quote3), `a row near the foot of the long table is what the citation carries (quote: ${JSON.stringify(quote3)})`);
    const cite3 = page.locator('.parallx-chat-message--assistant a[href*="long.pdf"][href*="quote="]').last();
    await cite3.hover();
    await page.waitForSelector('.parallx-cite-peek img.parallx-cite-peek__piece', { state: 'visible', timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(600);
    const tall = await page.evaluate(() => {
      const c = document.querySelector('.parallx-cite-peek');
      const r = c?.getBoundingClientRect();
      const parts = [...(c?.querySelectorAll('img.parallx-cite-peek__piece') ?? [])].map((i) => [Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height), i.naturalWidth]);
      return c ? { parts, skips: c.querySelectorAll('.parallx-cite-peek__skip').length, card: r ? [Math.round(r.width), Math.round(r.height)] : null, inView: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, spoken: c.querySelector('.px-visually-hidden')?.textContent ?? '' } : null;
    });
    console.log(`[citation] the long table's card: ${JSON.stringify(tall)}`);
    check(tall?.parts.length === 2 && tall.skips === 1, `a table too tall for the card is shown as its heading and the rows the quote is in (${tall?.parts.length} part(s), ${tall?.skips} mark(s) where rows were left out)`);
    check(!!tall && tall.parts.reduce((h, p) => h + p[1], 0) <= 430 && tall.parts.every((p) => p[0] >= 300 && p[2] >= p[0] * 1.5), `its pieces fit the room and hold the pixels for a sharp screen (${JSON.stringify(tall?.parts)})`);
    check(tall?.inView === true, 'the card sits inside the window');
    await shot('citation-card-tall-table.png');
    await page.mouse.move(40, 400);
    await page.waitForTimeout(400);

    // A finger: the first press shows the card with the way in; the way in opens the place.
    const cdp = await page.context().newCDPSession(page);
    const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const at3 = await cite3.boundingBox();
    await tap(Math.round(at3.x + at3.width / 2), Math.round(at3.y + at3.height / 2));
    await page.waitForSelector('.parallx-cite-peek a.parallx-cite-peek__open', { state: 'visible', timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const pressed = await page.evaluate(() => {
      const way = document.querySelector('.parallx-cite-peek a.parallx-cite-peek__open');
      const r = way?.getBoundingClientRect();
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      return { modality: document.documentElement.dataset.inputModality, way: way?.textContent ?? '', at: r ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null, size: r ? [Math.round(r.width), Math.round(r.height)] : null, framed: !!pane?.querySelector('.pdf-cited-block') };
    });
    check(pressed.modality === 'touch' && pressed.way === 'Open At This Place', `a finger's first press shows the card with the way in ("${pressed.way}")`);
    await shot('citation-card-finger.png');
    if (pressed.at) await tap(pressed.at[0], pressed.at[1]);
    await page.waitForFunction(() => [...document.querySelectorAll('.pdf-editor-pane')].some((p) => p.getClientRects().length && p.querySelector('.pdf-cited-block') && /372|1\.016/.test([...p.querySelectorAll('.textLayer .highlight')].map((h) => h.textContent).join(' '))), null, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const wentIn = await page.evaluate(() => {
      const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((p) => p.getClientRects().length);
      return { framed: !!pane?.querySelector('.pdf-cited-block'), washed: [...(pane?.querySelectorAll('.textLayer .highlight') ?? [])].map((h) => h.textContent).join(' '), card: !!document.querySelector('.parallx-cite-peek') };
    });
    check(wentIn.framed && /372|1\.016/.test(wentIn.washed), `pressing the way in opens the page at the quoted row, the table framed (washed: ${JSON.stringify(wentIn.washed)})`);
    check(!wentIn.card, 'and the card goes');
    await shot('citation-finger-followed.png');

    const faults = errors.filter((e) => !/ERR_CONNECTION_REFUSED|ERR_FAILED|Failed to fetch|embed/i.test(e));
    check(faults.length === 0, `no errors in the window${faults.length ? `: ${faults.slice(0, 3).join(' || ')}` : ''}`);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failed ? `[citation] ${failed} FAILED` : '[citation] 0 problems');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
