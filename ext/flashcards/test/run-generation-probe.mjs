// run-generation-probe.mjs — LIVE verification of flashcard generation.
//
// Drives the REAL ext/flashcards/main.js generation pipeline against REAL
// local Ollama (same pattern as ext/text-generator/test/live-harness.mjs:
// jsdom + faithful bridge fake, model calls over HTTP, no Electron, no
// window — dev machine = study machine).
//
// Two probes:
//   A) Canvas path — realistic Exam-7 study markdown (what
//      canvas.getPageMarkdown returns) → fcGenerateCards.
//   B) PDF path — builds a REAL one-page PDF on disk, extracts it with the
//      REAL electron/documentExtractor.cjs (pure Node), feeds the extracted
//      text to fcGenerateCards.
//
// Output: every generated card + automated sanity checks (count, question
// shape, non-empty backs, grounding — each card must share distinctive
// terms with the source material; hallucination canaries must NOT appear).
//
// Run: node ext/flashcards/test/run-generation-probe.mjs [model]

import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const { DatabaseSync } = require_('node:sqlite');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '..');
const REPO = path.resolve(EXT_DIR, '..', '..');

const OLLAMA = 'http://localhost:11434';
const MODEL = process.argv[2] || 'qwen3.6:latest';

// ─── PDF extraction FIRST — before jsdom exists ─────────────────────────────
// pdf-parse sniffs `document` to decide browser vs node; with jsdom globals
// installed it mis-detects and breaks. Extract while the environment is
// still pure Node, then bring up the DOM for the extension.

function earlyExtractPdf(buildPdfFn, lines) {
  const scratchDir = path.resolve(__dirname);
  const p = path.join(scratchDir, 'probe-material.pdf');
  fs.writeFileSync(p, buildPdfFn(lines));
  const { extractText } = require_(path.join(REPO, 'electron', 'documentExtractor.cjs'));
  return extractText(p).finally(() => fs.unlinkSync(p));
}

const PDF_TEXT_LINES = [
  'Mack Model Assumptions and Reserve Variability',
  '',
  'The Mack model estimates the standard error of chain-ladder reserves',
  'without assuming a full distribution. It rests on three assumptions.',
  'First, expected incremental development is proportional to losses',
  'reported to date: E[C(i,k+1) | history] = f(k) x C(i,k).',
  'Second, accident years are independent of one another.',
  'Third, the variance of next-period losses is proportional to losses',
  'to date: Var[C(i,k+1) | history] = sigma(k)^2 x C(i,k).',
  '',
  'Under these assumptions the chain-ladder factors are unbiased, and the',
  'mean squared error of the reserve splits into process variance, the',
  'inherent randomness of future emergence, and parameter variance, the',
  'estimation error in the development factors themselves.',
  'Residual plots against development period test the first assumption;',
  'calendar-year diagnostics detect diagonal effects that violate',
  'independence, such as changes in claim settlement rates.',
];

// Extract NOW, fully, while the environment is still pure Node (buildPdf is
// a hoisted function declaration).
const extracted = await earlyExtractPdf(buildPdf, PDF_TEXT_LINES);

// ─── DOM (extension touches document at activate) ───────────────────────────

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

// ─── Real-Ollama lm bridge ──────────────────────────────────────────────────

async function* ollamaChat(modelId, messages, options) {
  // Faithful to src/built-in/chat/providers/ollamaProvider.ts: think and
  // numCtx come from the CALLER's options — the probe must not paper over
  // missing options the way a hardcoded think/num_ctx once did (that hid
  // the in-app "Ctx: auto → silent top-truncation" failure).
  const body = {
    model: modelId,
    messages,
    stream: false,
    options: {
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.numCtx && options.numCtx > 0 ? { num_ctx: options.numCtx } : {}),
    },
  };
  if (options?.think) body.think = true;
  else if (options?.think === false) body.think = false;
  const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const j = await res.json();
  yield { content: j.message?.content ?? '', done: false };
  yield { content: '', done: true };
}

// ─── Minimal faithful bridge (only what activate + generation touch) ────────

function makeApi() {
  const sqlite = new DatabaseSync(':memory:');
  const noopDisposable = { dispose() {} };
  return {
    env: { toolPath: EXT_DIR, appName: 'parallx', appVersion: '0.0.0' },
    database: {
      open: async () => ({ error: null }),
      migrate: async (dir) => {
        sqlite.exec(fs.readFileSync(path.join(dir, 'flashcards_001_initial.sql'), 'utf8'));
        return { error: null };
      },
      run: async (sql, params = []) => {
        const r = sqlite.prepare(sql).run(...params);
        return { error: null, lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
      },
      get: async (sql, params = []) => ({ error: null, row: sqlite.prepare(sql).get(...params) }),
      all: async (sql, params = []) => ({ error: null, rows: sqlite.prepare(sql).all(...params) }),
      runTransaction: async () => ({ error: null, results: [] }),
    },
    commands: { registerCommand: () => noopDisposable, executeCommand: async () => null },
    views: { registerViewProvider: () => noopDisposable },
    editors: { registerEditorProvider: () => noopDisposable, openEditor: async () => {} },
    window: {
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async (m) => { console.error('[ext error]', m); return undefined; },
      showInputBox: async () => undefined,
      showQuickPick: async (items) => items[0],
    },
    workspace: {
      getConfiguration: () => ({ get: (_k, d) => d, has: () => false }),
      onDidChangeConfiguration: () => noopDisposable,
      getCanvasPageTree: async () => [],
    },
    lm: {
      getActiveModel: () => MODEL,
      getModels: async () => [{ id: MODEL }],
      sendChatRequest: (m, msgs, opts) => ollamaChat(m, msgs, opts),
    },
    icons: { createIconHtml: () => '', getIcon: () => '', hasIcon: () => false },
    ui: {
      createDropdown: (container) => {
        const el = document.createElement('div');
        container.appendChild(el);
        return { element: el, value: '', setItems() {}, onDidChange: () => noopDisposable, focus() {}, setDisabled() {}, dispose() {} };
      },
      rafThrottle: (fn) => Object.assign((...a) => fn(...a), { dispose() {}, flush() {} }),
    },
    chat: { registerTool: () => noopDisposable },
    cron: { upsertJob() {}, removeJob: () => false },
    dashboard: { registerWidgetType: () => noopDisposable },
    links: { register: () => noopDisposable },
  };
}

// ─── Probe material ─────────────────────────────────────────────────────────

const CANVAS_MARKDOWN = `# Chain Ladder and Bornhuetter-Ferguson

The chain-ladder method projects ultimate losses by applying age-to-age
development factors to losses reported to date. The key assumption is that
historical development patterns persist: losses at each maturity are a
constant multiple of losses at the prior maturity, independent of calendar
year effects.

Age-to-age factors for a segment: 12-24 months: 1.80, 24-36 months: 1.25,
36-48 months: 1.10, 48-ultimate: 1.05. The cumulative development factor
(CDF) from 12 months to ultimate is 1.80 x 1.25 x 1.10 x 1.05 = 2.599.

The chain-ladder ultimate is reported-to-date times the CDF. Its weakness:
for immature accident years the estimate is highly leveraged — a small
change in reported losses swings the ultimate by the full CDF multiple.

The Bornhuetter-Ferguson (BF) method blends the chain-ladder with an a
priori expected loss estimate. BF ultimate = actual reported losses +
expected losses x (1 - 1/CDF). The (1 - 1/CDF) term is the expected
unreported fraction. BF gives more weight to the a priori estimate at
immature ages and converges to chain-ladder as the year matures, which is
why it is preferred for long-tailed lines at early maturities.

Benktander is a credibility-weighted average of chain-ladder and BF:
it applies the BF procedure a second time, using the BF ultimate as the
new a priori. It reacts to emergence faster than BF but is more stable
than pure chain-ladder.`;

// Build a REAL one-page PDF (raw PDF syntax, Helvetica Tj operators) so the
// REAL extractor parses a real file, not a fixture string.
function buildPdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = [
    'BT', '/F1 11 Tf', '50 770 Td', '13 TL',
    ...lines.map((l, i) => `${i === 0 ? '' : 'T* '}(${esc(l)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// ─── Quality checks ─────────────────────────────────────────────────────────

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'is', 'are', 'for', 'in', 'on', 'at', 'by', 'with', 'that', 'this', 'it', 'its', 'as', 'be', 'or', 'from', 'which', 'what', 'why', 'how', 'does', 'do', 'not', 'more', 'than', 'each', 'their', 'them']);

function terms(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9.%-]+/g, ' ').split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

function judge(label, material, cards) {
  const materialTerms = terms(material);
  console.log(`\n════ ${label}: ${cards.length} cards ════`);
  let grounded = 0, questiony = 0, withMath = 0, emDashHits = 0;
  const canaries = ['as an ai', 'i cannot', 'here are', 'flashcard'];
  let canaryHits = 0;
  cards.forEach((c, i) => {
    const cardTerms = [...terms(`${c.front} ${c.back}`)];
    const overlap = cardTerms.filter((t) => materialTerms.has(t)).length;
    const isGrounded = overlap >= 3;
    if (isGrounded) grounded++;
    if (/[?]$|^(what|why|how|when|which|under|state|give|name|compare|define|in the)/i.test(c.front.trim())) questiony++;
    const body = `${c.front} ${c.back}`;
    // Formatting the new prompt asks for: LaTeX ($…$) and no em dashes.
    if (/\$[^$]+\$/.test(body)) withMath++;
    if (body.includes('—')) emDashHits++;
    const lower = body.toLowerCase();
    if (canaries.some((x) => lower.includes(x))) canaryHits++;
    console.log(`\n[${i + 1}] Q: ${c.front}`);
    console.log(`    A: ${c.back}`);
    console.log(`    grounded-terms: ${overlap}${isGrounded ? '' : '  ⚠ LOW GROUNDING'}`);
  });
  console.log(`\n${label} summary: ${cards.length} cards · grounded ${grounded}/${cards.length} · question-shaped ${questiony}/${cards.length} · with-LaTeX ${withMath}/${cards.length} · em-dashes ${emDashHits} · canary hits ${canaryHits}`);
  return { grounded, total: cards.length, canaryHits, emDashHits, withMath };
}

// ─── Run ────────────────────────────────────────────────────────────────────

const { activate, __testables } = await import('../main.js');
await activate(makeApi(), { subscriptions: [] });
const { fcGenerateCards } = __testables;

console.log(`Model: ${MODEL}`);

// Probe A — canvas markdown.
const t0 = Date.now();
const { cards: canvasCards } = await fcGenerateCards(CANVAS_MARKDOWN, { count: 8 });
console.log(`\n(canvas probe took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const a = judge('PROBE A · canvas page (chain ladder / BF)', CANVAS_MARKDOWN, canvasCards);

// Probe B — real PDF through the real extractor (extraction ran pre-jsdom).
console.log(`\nPDF extractor: format=${extracted.format ?? 'pdf'} chars=${extracted.text.length}`);
if (!extracted.text.includes('Mack') || !extracted.text.includes('process variance')) {
  console.log('⚠ PDF extraction did not recover expected text!');
  console.log(extracted.text.slice(0, 400));
  process.exit(1);
}
const t1 = Date.now();
const { cards: pdfCards } = await fcGenerateCards(extracted.text, { count: 8 });
console.log(`\n(pdf probe took ${((Date.now() - t1) / 1000).toFixed(1)}s)`);
const b = judge('PROBE B · real PDF (Mack model)', extracted.text, pdfCards);

const pass = a.total >= 4 && b.total >= 4
  && a.grounded / a.total >= 0.75 && b.grounded / b.total >= 0.75
  && a.canaryHits === 0 && b.canaryHits === 0;
console.log(`\n═══ VERDICT: ${pass ? 'PASS' : 'FAIL'} ═══`);
process.exit(pass ? 0 : 1);
