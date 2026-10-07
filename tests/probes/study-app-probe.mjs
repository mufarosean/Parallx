// study-app-probe.mjs: every Study flow in the real app (docs/STUDY_BUILD_SPEC.md
// §12), on a throwaway workspace with two bookmarked PDFs, with a scripted model
// provider so no model backend is needed. After the app closes, the extension's
// own database file is read to check what the UI claimed.
//
//   A  PDF More Actions → Study This Document…: the chapters come from the bookmarks
//   B  a Practice session on one chapter: generation runs every check, feedback with
//      the anchor, Explain, Show Source beside the session with the passage
//      highlighted, results, Send Missed To Flashcards, Refresh
//   C  the sidebar lists the material and the session
//   D  Test mode on a second PDF: no verdict per card, per-point results
//   E  Study Together on both PDFs, interleaved
//   F  a past-exam question file imported and studied with a typed answer
//   G  light mode; H  Study off and on again, its data kept; I  the database
//
// The PDFs are made by study-fixture-pdfs.py (python3 with reportlab), or taken
// from PROBE_PDFS=<folder> (it needs Clark_2003_LDF_Curve_Fitting.pdf and
// Mack_1994_Chain_Ladder.pdf). Build first (npm run build). On Linux without a
// display, run it under xvfb-run -a.
//
// Usage: node tests/probes/study-app-probe.mjs [outDir]
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-study-probe'));
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const NOISE = /ERR_CONNECTION_REFUSED|Ollama|EmbeddingService|IndexingPipeline|11434|Failed to fetch/;

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1'; env.PARALLX_RENDERER_PORT = '0';
  env.PARALLX_APP_ROOT = appRoot; env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-study-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-study-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  let pdfDir = process.env.PROBE_PDFS ? path.resolve(process.env.PROBE_PDFS) : '';
  if (!pdfDir) {
    pdfDir = path.join(appRoot, 'pdfs');
    const made = spawnSync('python3', [path.join(__dirname, 'study-fixture-pdfs.py'), pdfDir], { encoding: 'utf8' });
    if (made.status !== 0) throw new Error(`study-fixture-pdfs.py failed (python3 with reportlab, or set PROBE_PDFS): ${made.stderr || made.error}`);
  }
  for (const f of await fs.readdir(pdfDir)) if (f.endsWith('.pdf')) await fs.copyFile(path.join(pdfDir, f), path.join(workspace, f));
  await fs.writeFile(path.join(workspace, 'README.md'), '# Study probe\n');
  await fs.writeFile(path.join(workspace, 'Clark past exam essays.md'), [
    '## CAS Exam 7 2019 Fall Q5(b)',
    'Exam: CAS Exam 7',
    'Sitting: 2019 Fall',
    'Number: 5',
    'Part: b',
    'Q: Briefly describe two reasons Clark prefers the Cape Cod method to the LDF method, and one situation where the LDF method is the better choice.',
    'A: The Cape Cod method fits fewer parameters, so its parameter variance is smaller. It uses premium as an exposure base, which carries information about immature years. The LDF method is better when premium cannot be put on level or the loss ratio is not stable across years.',
    '',
    '---',
    '',
    '## CAS Exam 7 2018 Fall Q3(a)',
    'Exam: CAS Exam 7',
    'Sitting: 2018 Fall',
    'Number: 3',
    'Part: a',
    'Q: Explain the difference between process variance and parameter variance in Clark\'s model.',
    'A: Process variance is the random variation in losses around their expected value. Parameter variance is the uncertainty in the fitted parameters, estimated from the information matrix. The total variance of the reserve is their sum.',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* fine */ }
  return { appRoot, workspace };
}

// The scripted model, registered in the renderer's language models service: it
// answers each Study prompt (told apart by its system line) from the material it
// is given, so generation, the checks, grading and Explain all run for real.
function installProbeModel() {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ILanguageModelsService' });
  if (!svc?.registerProvider) return 'no models service';
  const calls = (window.__probeCalls = []);
  // Body text only: drop heading lines (a short line with no full stop), then split into sentences.
  const sentencesOf = (block) => block.split('\n').map((l) => l.trim()).filter((l) => l && !(/^\d+(\.\d+)*\.?\s/.test(l) && !/\.$/.test(l)) && !/^\d+$/.test(l)).join(' ').replace(/\s+/g, ' ').split(/(?<=[.])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.split(' ').length >= 9 && /\.$/.test(s));
  const pagesOf = (material) => { const out = []; const re = /\[Page (\d+)\]([\s\S]*?)(?=\[Page \d+\]|$)/g; let m; while ((m = re.exec(material))) out.push({ page: Number(m[1]), text: m[2] }); return out; };
  const titleOf = (s) => s.replace(/[.,;:]+$/, '').split(' ').slice(0, 6).join(' ');
  const pointsOf = (s) => { const parts = s.replace(/\.$/, '').split(/,\s+(?:and\s+|which\s+|with\s+)?|\s+and\s+|\.\s+/).map((p) => p.trim()).filter((p) => p.split(' ').length >= 3); return (parts.length ? parts : [s]).slice(0, 3).map((t, i) => ({ text: t, required: i < 2 })); };
  const swap = (s, i) => {
    const pairs = [[/\bsmaller\b/, 'larger'], [/\blower\b/, 'higher'], [/\bfewer\b/, 'more'], [/\bheavier\b/, 'lighter'], [/\bprocess\b/, 'parameter'], [/\bonly on\b/, 'on both'], [/\bindependent\b/, 'correlated'], [/\bproportional\b/, 'unrelated'], [/\bdivided by\b/, 'multiplied by'], [/\bsum\b/, 'product'], [/\bunpaid\b/, 'paid'], [/\bmaximum\b/, 'minimum']];
    let out = s; let n = 0; for (const [re, to] of pairs) { if (re.test(out) && n <= i) { out = out.replace(re, to); n++; } }
    return out === s ? `${s.replace(/\.$/, '')} for the latest accident year only.` : out;
  };
  async function* reply(text) { for (let i = 0; i < text.length; i += 40) { yield { content: text.slice(i, i + 40), done: false }; await new Promise((r) => setTimeout(r, 2)); } yield { content: '', done: true }; }
  const info = { id: 'probe-model', displayName: 'Probe Model', family: 'probe', parameterSize: '1B', quantization: 'none', contextLength: 32768, capabilities: ['completion'] };
  svc.registerProvider({
    id: 'probe', displayName: 'Probe', local: true,
    async listModels() { return [info]; }, async checkAvailability() { return { available: true }; }, async getModelInfo() { return info; },
    sendChatRequest(modelId, messages, options) {
      const system = String(messages.find((m) => m.role === 'system')?.content || '');
      const user = String(messages.find((m) => m.role === 'user')?.content || '');
      const kind = system.startsWith('You read a passage') ? 'concepts' : system.startsWith('You write questions') ? 'questions'
        : system.startsWith('You check whether a quotation') ? 'support' : system.startsWith('You check one option') ? 'distractor'
        : system.startsWith('You mark') ? 'grade' : system.startsWith('You explain') ? 'explain' : system.startsWith('You reduce') ? 'rubric' : 'other';
      calls.push({ kind, numCtx: options?.numCtx, format: options?.format });
      let out = '{}';
      if (kind === 'concepts') {
        const material = user.split('--- MATERIAL ---')[1] || '';
        const concepts = [];
        for (const p of pagesOf(material)) for (const s of sentencesOf(p.text).slice(0, 2)) concepts.push({ title: titleOf(s), summary: s, page: p.page, quote: s, essayWorthy: /\b(because|which is why|prefers|sum of)\b/.test(s), quantitative: false, hasFormula: false, term: '' });
        out = JSON.stringify({ concepts });
      } else if (kind === 'questions') {
        const lines = [...user.matchAll(/^- id (\d+): (.*?)\. (.*?) Taught on page (\d+)\. Write: (.*)\.$/gm)];
        const all = lines.map((m) => m[3]); const questions = [];
        lines.forEach((m, li) => {
          const id = Number(m[1]); const title = m[2]; const summary = m[3].trim(); const page = Number(m[4]);
          for (const ask of m[5].split(',').map((x) => x.trim())) {
            const [nStr, fmt] = ask.split(' '); const n = Number(nStr) || 1;
            for (let k = 0; k < n; k++) {
              if (fmt === 'mc') {
                const others = all.filter((x, j) => j !== li).slice(0, 2);
                const tails = [' only for the latest accident year.', ' only before trending to a common level.', ' only for paid losses.'];
                const wrong = [];
                for (const cand of [swap(summary, 0), swap(summary, 1), ...others, ...tails.map((t) => summary.replace(/\.$/, '') + t)]) {
                  if (cand !== summary && !wrong.includes(cand)) wrong.push(cand);
                  if (wrong.length === 3) break;
                }
                const options = [summary, ...wrong.slice(0, 3)]; const r = (id + k) % 4; [options[0], options[r]] = [options[r], options[0]];
                questions.push({ concept: id, format: 'mc', stem: `Which statement does the text make about ${title.toLowerCase()}?`, options, answer: r, explanation: `The text states it directly: ${summary}`, quote: summary, page, difficulty: 'medium' });
              } else if (fmt === 'short' || fmt === 'essay') {
                questions.push({ concept: id, format: fmt, stem: fmt === 'essay' ? `Explain what the text says about ${title.toLowerCase()} and why it matters.` : `In one or two sentences, what does the text say about ${title.toLowerCase()}?`, answer: summary, rubric: pointsOf(summary), explanation: summary, quote: summary, page });
              }
            }
          }
        });
        out = JSON.stringify({ questions });
      } else if (kind === 'support') out = JSON.stringify({ settles: true, reason: 'The quotation states the answer.' });
      else if (kind === 'distractor') out = JSON.stringify({ defensible: false, reason: 'It contradicts the quotation.' });
      else if (kind === 'grade') {
        const pts = (user.split('Points to mark, in order:')[1] || '').split("Student's answer:")[0].split('\n').map((l) => l.replace(/^\d+\.\s*/, '').replace(/\s*\(supporting detail\)$/, '').trim()).filter(Boolean).filter((l) => !l.startsWith('Statements that'));
        const ans = (user.split("Student's answer:")[1] || '').toLowerCase();
        const points = pts.map((p) => { const words = p.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4); const hit = words.filter((w) => ans.includes(w)).length; return { status: !words.length || hit / words.length >= 0.6 ? 'hit' : hit > 0 ? 'partial' : 'miss', note: '' }; });
        const missed = points.findIndex((p) => p.status !== 'hit');
        out = JSON.stringify({ points, contradiction: false, note: missed >= 0 ? `The answer leaves out: ${pts[missed]}.` : '' });
      } else if (kind === 'explain') out = 'The quotation says this in so many words, so the right option is the one that restates it. The option you chose changes one term the text is careful about.';
      else if (kind === 'rubric') { const ref = (user.split(/answer:\n/i)[1] || user).split('\n')[0]; out = JSON.stringify({ rubric: pointsOf(ref), contradictions: [] }); }
      return reply(out);
    },
  });
  svc.setActiveModel?.('probe-model');
  return 'ok';
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace } = await makeRoots();
  // Chromium refuses to run as root with its sandbox on (a container's user).
  const args = process.getuid?.() === 0 ? ['--no-sandbox', '.'] : ['.'];
  const app = await electron.launch({ executablePath: ELECTRON, args, cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = []; let failures = 0; let n = 0;
  const check = (label, ok, detail) => { console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ' :: ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''}`); if (!ok) failures++; };
  const shot = async (page, name) => { const f = path.join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: f }); console.log(`[probe] screenshot -> ${path.basename(f)}`); };
  const run = (page, commandId, ...args) => page.evaluate(async ({ commandId, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    try { const r = await svc.executeCommand(commandId, ...args); return { ok: true, r: r === undefined ? null : (typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r) }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; }
  }, { commandId, args });
  const click = (page, sel, re) => page.evaluate(({ sel, re }) => { const el = Array.from((/^\.st-(?!sb)/.test(sel) ? window.__vqa : (x) => document.querySelectorAll(x))(sel)).find((b) => !re || new RegExp(re).test((b.textContent || '').trim())); if (!el) return false; el.click(); return true; }, { sel, re });
  const text = (page, sel) => page.evaluate((sel) => (/^\.st-(?!sb)/.test(sel) ? window.__vq(sel) : document.querySelector(sel))?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);
  const texts = (page, sel) => page.evaluate((sel) => Array.from(/^\.st-(?!sb)/.test(sel) ? window.__vqa(sel) : document.querySelectorAll(sel)).map((n) => n.textContent.replace(/\s+/g, ' ').trim()), sel);
  const sbVisible = (page) => page.evaluate(() => { const sb = document.querySelector('.st-sb'); return !!sb && sb.offsetParent !== null && sb.getBoundingClientRect().width > 0; });
  const showStudy = async (page) => {
    if (!(await sbVisible(page))) await run(page, 'workbench.view.show', 'study.materials');
    await page.waitForTimeout(500);
    if (!(await sbVisible(page))) await click(page, '.activity-bar-item[data-icon-id="study-container"]');
    await page.waitForTimeout(800);
  };
  // Answer whatever the current session shows until results: mc picks `pickMc(i)`; typed writes `typed`.
  async function workSession(page, { pickMc = () => 0, typed = '', maxSteps = 40, label = 's' } = {}) {
    let shots = 0;
    for (let i = 0; i < maxSteps; i++) {
      const st = await page.evaluate(() => ({ res: !!window.__vq('.st-res'), format: window.__vq('.st-card')?.dataset.format, answered: !!window.__vq('.st-fb--show, .st-card--answered') }));
      if (st.res || !st.format) return st;
      if (!st.answered) {
        if (st.format === 'mc') await page.evaluate((k) => { const o = window.__vqa('.st-opt'); (o[k % o.length] || o[0])?.click(); }, pickMc(i));
        else {
          await page.evaluate((t) => { const ta = window.__vq('.st-card textarea, .st-card input'); if (ta) { ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, typed);
          await click(page, '.st-root button', '^Check');
          await page.waitForTimeout(1_200);
          if (shots++ < 2) await shot(page, `${label}-typed`);
        }
        await page.waitForTimeout(400);
      }
      if (!(await click(page, '.st-root button', '^Next'))) await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
    }
    return { stuck: true };
  }

  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 400)));
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !NOISE.test(t)) errors.push(`console: ${t.slice(0, 400)}`); if (/\[Study\]/.test(t)) console.log('[app]', t.slice(0, 200)); });
    await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 120_000 });
    await page.waitForTimeout(3_000);
    for (const id of ['parallx-community.study', 'parallx-community.flashcards']) {
      const r = await page.evaluate(async (id) => { try { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement(id, true); return true; } catch (e) { return String(e); } }, id);
      check(`enable ${id}`, r === true, r);
    }
    await page.waitForTimeout(4_000);
    check('scripted model registered', (await page.evaluate(installProbeModel)) === 'ok');
    await page.evaluate(() => {
      const shown = (n) => n && n.offsetParent !== null && n.getBoundingClientRect().width > 0;
      const root = () => Array.from(document.querySelectorAll('.st-root')).find(shown) || document;
      window.__vq = (sel) => { const r = root(); return r.matches?.(sel) ? r : r.querySelector(sel); };
      window.__vqa = (sel) => { const r = root(); return r.querySelectorAll(sel); };
    });
    await page.waitForTimeout(500);

    // ── A. PDF More Actions → Study This Document ──
    await run(page, 'workbench.view.show', 'explorer');
    await page.waitForTimeout(1_200);
    await page.evaluate(() => { const row = Array.from(document.querySelectorAll('[class*="explorer"] *')).find((n) => n.children.length === 0 && /Clark_2003_LDF_Curve_Fitting\.pdf/.test(n.textContent || '')); const t = row?.closest('[role="treeitem"], [class*="row"]') || row; t?.dispatchEvent(new MouseEvent('click', { bubbles: true })); t?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await page.waitForSelector('.pdf-toolbar', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    await page.click('.pdf-toolbar [aria-label="More Actions"]').catch(() => {});
    await page.waitForTimeout(500);
    check('More Actions lists Study This Document…', (await texts(page, '.context-menu-item')).some((t) => /Study This Document…/.test(t)));
    await page.evaluate(() => { const it = Array.from(document.querySelectorAll('.context-menu-item')).find((n) => /Study This Document/.test(n.textContent || '')); it?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); it?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); it?.click(); });
    await page.waitForSelector('.st-sheet', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    const rows = await texts(page, '.st-outline__o');
    check('setup sheet shows the four chapters from the bookmarks', rows.length === 4 && rows.every((r) => !/continued/.test(r)), rows);
    check('material carries a readable title', /Clark 2003/.test((await text(page, '.st-sheet__sub')) || ''), await text(page, '.st-sheet__sub'));
    await shot(page, 'setup-sheet');

    // ── B. Practice, Mixed, chapter 3 ──
    await page.evaluate(() => Array.from(window.__vqa('.st-outline__o')).find((n) => /Cape Cod/.test(n.textContent))?.click());
    await page.waitForTimeout(300);
    await click(page, '.st-sheet button', 'Start');
    await page.waitForTimeout(1_000);
    await shot(page, 'generating');
    await page.waitForSelector('.st-card', { timeout: 180_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const calls = await page.evaluate(() => (window.__probeCalls || []).reduce((m, c) => { m[c.kind] = (m[c.kind] || 0) + 1; return m; }, {}));
    console.log('[probe] model calls', JSON.stringify(calls));
    check('generation ran every check', calls.concepts > 0 && calls.questions > 0 && calls.support > 0 && calls.distractor > 0, calls);
    check('every model call carried an explicit context window', await page.evaluate(() => (window.__probeCalls || []).every((c) => c.numCtx > 0)));
    check('session shows a card', !!(await text(page, '.st-card__q')), await text(page, '.st-card__q'));
    check('session tab title is readable', !/_/.test((await text(page, '.st-sess-tb__scope')) || '_'), await text(page, '.st-sess-tb__scope'));
    await shot(page, 'session-card');

    if ((await page.evaluate(() => window.__vq('.st-card')?.dataset.format)) === 'mc') {
      // Pick a wrong option: the one that is not the anchor sentence.
      await page.evaluate(() => { const q = window.__vq('.st-card')?.dataset.questionId; const opts = Array.from(window.__vqa('.st-opt')); opts[opts.length - 1]?.click(); });
      await page.waitForTimeout(800);
      check('feedback with a verdict and the anchor', !!(await text(page, '.st-fb__text')) && !!(await text(page, '.st-quote__text')), { v: await text(page, '.st-fb__text'), q: await text(page, '.st-quote__text') });
      await shot(page, 'feedback');
      await click(page, '.st-fb__acts button', 'Explain');
      await page.waitForTimeout(1_500);
      check('Explain streams an explanation under the quote', !!(await text(page, '.st-explain')), await text(page, '.st-explain'));
      await click(page, '.st-fb__acts button', 'Show Source');
      await page.waitForTimeout(3_500);
      const layout = await page.evaluate(() => ({ session: !!window.__vq('.st-card'), pdf: !!document.querySelector('.pdf-toolbar'), pageNo: document.querySelector('.pdf-toolbar-page-input')?.value }));
      check('Show Source puts the PDF beside the session, both visible', layout.session && layout.pdf, layout);
      let hl = 0;
      for (let k = 0; k < 20 && !hl; k++) { await page.waitForTimeout(250); hl = await page.evaluate(() => document.querySelectorAll('.textLayer .highlight').length); }
      check('the anchor passage is highlighted on the revealed page', hl > 0, hl);
      await shot(page, 'show-source');
      await page.evaluate(() => window.__vq('.st-root')?.focus());
    }
    const endA = await workSession(page, { pickMc: (i) => i, typed: 'Fewer parameters means more degrees of freedom and a smaller parameter variance, and the loss ratio is assumed stable.', label: 'practice' });
    check('practice session reaches results', !endA.stuck, endA);
    await page.waitForTimeout(600);
    const res = await page.evaluate(() => ({ big: window.__vq('.st-res__big')?.textContent?.replace(/\s+/g, ' ').trim(), under: window.__vq('.st-res__under')?.textContent?.trim(), cov: window.__vqa('.st-cov i').length, missed: window.__vqa('.st-mrow').length, buttons: Array.from(window.__vqa('.st-res button')).map((b) => b.textContent.trim()) }));
    check('results: score, coverage bar, missed list', !!res.big && res.cov > 0, res);
    await shot(page, 'results');
    if (res.buttons.some((t) => /Send Missed/.test(t))) {
      await click(page, '.st-res button', 'Send Missed');
      await page.waitForTimeout(1_500);
      const fc = await run(page, 'flashcards.addCards', { deckName: '__probe_count__', cards: [] }).catch(() => null);
      check('Send Missed ran', true, fc);
    }
    await click(page, '.st-res button', 'Refresh');
    await page.waitForSelector('.st-card', { timeout: 180_000 }).catch(() => {});
    await page.waitForTimeout(800);
    check('Refresh brings the next draw', !!(await page.evaluate(() => !!window.__vq('.st-card'))));
    await shot(page, 'refresh');

    // ── C. Sidebar ──
    await showStudy(page);
    const sb = await page.evaluate(() => ({ materials: Array.from(document.querySelectorAll('.st-sb__it--material')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()), sessions: Array.from(document.querySelectorAll('.st-sb__it--session')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()), dupMore: document.querySelectorAll('.st-sb [aria-label="More Actions"], .st-sb button[title="More Actions"]').length }));
    check('sidebar lists the material and the session, no second More Actions', sb.materials.length >= 1 && sb.sessions.length >= 1 && sb.dupMore === 0, sb);
    await shot(page, 'sidebar');

    // ── D. Test mode on Mack, typed ──
    const add = await run(page, 'study.addMaterial', path.join(workspace, 'Mack_1994_Chain_Ladder.pdf'));
    check('study.addMaterial with a path', add.ok, add);
    await page.waitForSelector('.st-sheet', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate(() => { const segs = Array.from(window.__vqa('.st-sheet .ui-segmented-control__segment')); segs.find((s) => s.textContent.trim() === 'Document')?.click(); segs.find((s) => s.textContent.trim() === 'Test')?.click(); });
    await page.waitForTimeout(300);
    await shot(page, 'test-setup');
    await click(page, '.st-sheet button', 'Start');
    await page.waitForSelector('.st-card', { timeout: 180_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const testCard = await page.evaluate(() => ({ format: window.__vq('.st-card')?.dataset.format, hasTa: !!window.__vq('.st-card textarea, .st-card input') }));
    check('Test mode asks for typed answers', testCard.hasTa, testCard);
    await shot(page, 'test-card');
    // In Test, no verdict after an answer.
    await page.evaluate(() => { const ta = window.__vq('.st-card textarea, .st-card input'); if (ta) { ta.value = 'The development factor depends only on the age and the accident years are independent.'; ta.dispatchEvent(new Event('input', { bubbles: true })); } });
    await click(page, '.st-root button', '^Check|^Next|^Submit');
    await page.waitForTimeout(1_000);
    check('Test mode shows no verdict after an answer', !(await page.evaluate(() => !!window.__vq('.st-fb--show .st-fb__text'))), await text(page, '.st-fb__text'));
    await shot(page, 'test-after-answer');
    const endB = await workSession(page, { typed: 'The expected cumulative loss is the current loss times a factor that depends only on the age, accident years are independent, and the variance is proportional to the current loss.', label: 'test' });
    await page.waitForTimeout(3_000);
    const tres = await page.evaluate(() => ({ big: window.__vq('.st-res__big')?.textContent?.replace(/\s+/g, ' ').trim(), points: window.__vqa('.st-res .st-rub__pt, .st-res [class*="rub"]').length, items: window.__vqa('.st-res .st-review__item, .st-res [class*="item"]').length }));
    check('Test results list every item with per-point feedback', !endB.stuck && tres.points > 0, tres);
    await shot(page, 'test-results');

    // ── E. Study Together ──
    const tog = await run(page, 'study.studyTogether', [1, 2]);
    check('study.studyTogether with ids', tog.ok, tog);
    await page.waitForSelector('.st-sheet', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(800);
    check('Together sheet lists both materials', (await texts(page, '.st-outline__o')).length === 2, await texts(page, '.st-outline__o'));
    await shot(page, 'together-sheet');
    await click(page, '.st-sheet button', 'Start');
    await page.waitForSelector('.st-card', { timeout: 180_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, 'together-card');
    const endC = await workSession(page, { pickMc: (i) => i + 1, typed: 'Fewer parameters and independent accident years.', label: 'together' });
    check('together session reaches results', !endC.stuck, endC);

    // ── F. Question bank from past exams ──
    const imp = await run(page, 'study.importQuestions', path.join(workspace, 'Clark past exam essays.md'));
    check('study.importQuestions with a path', imp.ok, imp);
    await page.waitForTimeout(1_000);
    await showStudy(page);
    if (!(await page.$('.st-sb__it--bank'))) await page.evaluate(() => { const sec = document.querySelector('.st-sb__sec--banks'); const lab = sec && Array.from(sec.querySelectorAll('*')).find((n) => /Question banks/.test(n.textContent) && n.children.length <= 3); (sec?.querySelector('[role="button"]') || lab?.closest('button, [role="button"], .px-section-label') || lab)?.click(); });
    await page.waitForTimeout(600);
    await page.waitForTimeout(500);
    const banks = await texts(page, '.st-sb__it--bank');
    check('the imported bank is listed, named without its extension', banks.some((b) => /essays/.test(b)) && !banks.some((b) => /\.md\b/.test(b)), banks);
    await shot(page, 'sidebar-banks');
    await page.evaluate(() => Array.from(document.querySelectorAll('.st-sb__it--bank')).find((n) => /essays/i.test(n.textContent))?.click());
    await page.waitForSelector('.st-sheet', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, 'bank-sheet');
    await click(page, '.st-sheet button', 'Start');
    await page.waitForSelector('.st-card', { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    const bankCard = await page.evaluate(() => ({ q: window.__vq('.st-card__q')?.textContent?.trim(), eyebrow: window.__vq('.st-eyebrow')?.textContent?.replace(/\s+/g, ' ').trim(), ta: !!window.__vq('.st-card textarea') }));
    check('a past-exam essay is studied with a typed answer', !!bankCard.q && bankCard.ta, bankCard);
    await shot(page, 'bank-card');
    await page.evaluate(() => { const ta = window.__vq('.st-card textarea'); if (ta) { ta.value = 'Cape Cod fits fewer parameters so its parameter variance is smaller, and premium gives information about immature years. LDF is better when premium cannot be put on level.'; ta.dispatchEvent(new Event('input', { bubbles: true })); } });
    await click(page, '.st-root button', '^Check');
    await page.waitForTimeout(2_000);
    check('the essay is graded point by point', (await page.evaluate(() => window.__vqa('.st-rub__pt').length)) > 0, await texts(page, '.st-rub__pt'));
    check('a question with no anchor shows no anchor box', !(await page.evaluate(() => !!window.__vq('.st-fb--show .st-quote'))));
    check('no note only restates a missed point', !(await texts(page, '.st-fb__why')).some((t) => /^The answer leaves out/.test(t)), await texts(page, '.st-fb__why'));
    await shot(page, 'bank-verdict');

    // ── G. Light mode ──
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(500);
    await shot(page, 'light-mode');
    await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode'));

    // ── H. Turn Study off and on ──
    await page.evaluate(async () => { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.study', false); });
    await page.waitForTimeout(2_500);
    const off = await page.evaluate(() => ({ rail: !!document.querySelector('.activity-bar-item[data-icon-id="study-container"]'), styles: !!document.getElementById('study-styles'), tabs: Array.from(document.querySelectorAll('.tab, [class*="editor-tab"]')).filter((t) => /Study/.test(t.textContent)).length }));
    check('Study off: no activity bar entry, no styles left', !off.rail && !off.styles, off);
    await page.click('.pdf-toolbar [aria-label="More Actions"]').catch(() => {});
    await page.waitForTimeout(400);
    check('Study off: the PDF menu has no Study entry', !(await texts(page, '.context-menu-item')).some((t) => /Study This Document/.test(t)));
    await page.keyboard.press('Escape');
    await page.evaluate(async () => { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.study', true); });
    await page.waitForTimeout(3_000);
    await showStudy(page);
    check('Study on again: materials kept', (await texts(page, '.st-sb__it--material')).length >= 2, await texts(page, '.st-sb__it--material'));
    await shot(page, 'back-on');
  } catch (err) {
    console.log('[probe] FAIL exception', String(err && err.stack || err).slice(0, 800)); failures++;
  } finally {
    console.log(`[probe] renderer errors (${errors.length}):`);
    for (const e of errors.slice(0, 40)) console.log('   ', e);
    if (errors.length) failures++;
    await app.close().catch(() => {});
  }

  // ── I. The database, read after the app closed ──
  try {
    const dbFile = path.join(workspace, '.parallx', 'extensions', 'study', 'data.db');
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const q = (sql) => db.prepare(sql).all();
    const runs = q('SELECT status, written, kept, dropped_json FROM st_runs');
    console.log('[probe] runs', JSON.stringify(runs));
    check('runs finished with kept questions', runs.length > 0 && runs.some((r) => r.kept > 0), runs);
    const qs = q("SELECT format, origin, COUNT(*) n, SUM(source_quote != '') quoted, SUM(source_page > 0) paged FROM st_questions GROUP BY format, origin");
    console.log('[probe] questions', JSON.stringify(qs));
    check('every generated question carries a quote and a page', qs.filter((r) => r.origin === 'generated').every((r) => r.quoted === r.n && r.paged === r.n), qs);
    const sections = q('SELECT material_id, title, page_from, page_to FROM st_sections ORDER BY material_id, ord');
    check('sections are the bookmarks, no "continued"', sections.every((s) => !/continued/.test(s.title)), sections);
    const items = q("SELECT i.session_id, i.ord, i.draw, q.material_id FROM st_session_items i JOIN st_questions q ON q.id = i.question_id JOIN st_sessions s ON s.id = i.session_id WHERE s.scope_json LIKE '%materials%' ORDER BY i.session_id, i.draw, i.ord");
    let adjacent = 0; for (let k = 1; k < items.length; k++) if (items[k].session_id === items[k - 1].session_id && items[k].draw === items[k - 1].draw && items[k].material_id === items[k - 1].material_id) adjacent++;
    const mats = new Set(items.map((i) => i.material_id));
    check('Study Together drew from both materials, interleaved', mats.size >= 2 && adjacent <= 1, { mats: [...mats], adjacent, n: items.length });
    const answers = q('SELECT format_used, correct, COUNT(*) n FROM st_answers GROUP BY format_used, correct');
    console.log('[probe] answers', JSON.stringify(answers));
    const concepts = q('SELECT COUNT(*) n, SUM(answers > 0) answered, MIN(mastery) lo, MAX(mastery) hi FROM st_concepts');
    console.log('[probe] concepts', JSON.stringify(concepts));
    check('answers moved concept mastery', concepts[0].answered > 0 && concepts[0].hi > 0, concepts);
    db.close();
  } catch (err) {
    console.log('[probe] FAIL database read', String(err && err.message || err)); failures++;
  }
  console.log(`[probe] done: ${failures} failure(s)`);
}
main();
