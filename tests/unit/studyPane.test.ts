// @vitest-environment jsdom
//
// studyPane.test.ts — the Study extension end to end, through the REAL bundle
// (ext/study/main.js, generated from ext/study/src/*.js) against a fake host:
//
//   - api.database: better-sqlite3 in memory, the host contract (open, migrate
//     over <toolPath>/db/migrations, run/get/all/runTransaction, errors
//     returned as { error } and never thrown, foreign keys on).
//   - api.lm: an async-generator chat that answers by system prompt (concept
//     map, question writing, support and distractor checks, marking, explain,
//     rubric), quoting the fixture pages verbatim, with planted failures.
//   - parallxElectron: document.extractText over fixture PDFs (outline, pages),
//     python.status with no environment.
//   - api.workspace (settings from the manifest, an in-memory fs), commands,
//     editors that mount the registered pane like the workbench does, views,
//     chat, dashboard, links, the REAL kit, renderMarkdown and icon registry.
//
// Written to docs/STUDY_BUILD_SPEC.md (§3–§11) and docs/mockups/study.html.
// Deterministic: Math.random is seeded per test; nothing waits on the clock
// (waits are bounded by event-loop turns, card transitions end by a manual
// animationend, mastery is predicted from the stored answer times).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as kit from '../../src/ui/kit.js';
import { renderMarkdown } from '../../src/ui/renderMarkdown.js';
import { getIcon, hasIcon, registerIcon } from '../../src/ui/iconRegistry.js';
// @ts-expect-error — JS module with no types
import { activate, deactivate, __testables } from '../../ext/study/main.js';

type AnyRec = Record<string, any>;
const T = __testables as AnyRec;

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const STUDY_DIR = resolve(__dirname, '..', '..', 'ext', 'study');
const MANIFEST = JSON.parse(readFileSync(join(STUDY_DIR, 'parallx-manifest.json'), 'utf8'));
const MANIFEST_COMMANDS: string[] = MANIFEST.contributes.commands.map((c: AnyRec) => c.id);

const MAT1 = '/ws/readings/Clark_2003_Mack_1994.pdf';
const MAT1_URI = 'file:///ws/readings/Clark_2003_Mack_1994.pdf';
const MAT2 = '/ws/readings/Hurlimann_2009.pdf';
const REPORT = '/ws/reports/Exam7_Fall2019_Report.pdf';
const QFILE = '/ws/banks/questions.md';

const CLARK_PAGES = [
  // 1
  '1. Growth Curves\nClark (2003) models the emergence of losses with a growth curve. The growth curve G(x) rises from zero to one as the age x increases. Expected losses emerging between two ages are the ultimate losses times the difference in the growth curve at those ages. The curve is fit to the triangle by maximum likelihood rather than by selecting age-to-age factors.',
  '1.1 The Loglogistic Curve\nThe loglogistic curve has two parameters, omega and theta. Theta is the age at which half of the ultimate losses have emerged. Omega controls how quickly the curve rises around that age. The loglogistic tail is heavier than the Weibull tail, so it produces larger reserves for immature years.',
  '1.2 The Weibull Curve\nThe Weibull curve is the alternative form Clark considers. It also has two parameters and reaches the ultimate more quickly than the loglogistic. Because of its lighter tail, the Weibull curve is often preferred when development is short.',
  '1.3 Truncation\nExtrapolating a fitted curve to infinite age can produce very large tail factors. Clark suggests truncating the curve at a selected age, such as 240 months, to limit the tail. The choice of truncation point is a judgement and is not estimated from the data.',
  '1.4 Average Accident Date\nThe ages used in the curve are measured from the average accident date of each year. For annual accident years the average date is the middle of the year, so the age at the first evaluation is six months. Using the average date keeps the curve consistent across years.',
  // 6
  '2. The LDF and Cape Cod Methods\nClark presents two ways of using the growth curve to estimate ultimate losses. The LDF method estimates the ultimate losses for each accident year separately. Each accident year contributes its own ultimate as a parameter to be estimated.',
  '2.1 Counting Parameters\nThe LDF method requires one parameter per accident year plus the two curve parameters. For a ten year triangle that is twelve parameters fit to fifty-five data points. The large number of parameters is the main weakness of the method when the triangle is small.',
  '2.2 The Cape Cod Method\nThe Cape Cod method assumes a single expected loss ratio for all accident years. It uses on-level premium as the exposure base for each year. The expected loss ratio and the two curve parameters are the only parameters, so the method needs three in total.',
  '2.3 Process Variance\nClark assumes the incremental losses follow an over-dispersed Poisson distribution. The process variance is the scale factor times the expected incremental loss. The reserve process variance is therefore the scale factor times the reserve estimate.',
  '2.4 The Scale Factor\nThe scale factor is estimated as the sum of squared normalized residuals divided by the degrees of freedom. The degrees of freedom are the number of data points less the number of parameters. A larger scale factor means more process variance for the same reserve.',
  '2.5 Parameter Variance\nParameter variance measures the uncertainty in the estimated parameters themselves. Clark approximates it with the Rao-Cramer bound using the inverse of the information matrix. The covariance matrix of the parameters is the scale factor times that inverse.',
  '2.6 Comparing the Methods\nThe Cape Cod method has a lower parameter variance than the LDF method because it estimates fewer parameters. When exposure information is reliable the Cape Cod method is usually preferred. Residual plots against age and against expected loss test the fit of either method.',
  // 13
  '3. Mack (1994) and the Chain Ladder\nMack shows that the chain ladder method rests on three assumptions. The first assumption is that the expected cumulative loss at the next age equals the development factor times the cumulative loss to date. Under this assumption the chain ladder factors are unbiased estimators of the true development factors.',
  '3.1 Independence of Accident Years\nThe second assumption is that the cumulative losses of different accident years are independent. Calendar year effects such as a change in claims handling would violate this assumption. Mack suggests a test that counts large and small development factors along each diagonal.',
  '3.2 The Variance Assumption\nThe third assumption is that the variance of the next cumulative loss is proportional to the cumulative loss to date. This assumption implies that the chain ladder factor is the loss weighted average of the individual factors. Plotting the weighted residuals against the losses to date checks the variance assumption.',
  '3.3 The Standard Error of the Reserve\nMack derives the standard error of the reserve from the process risk and the parameter risk. The mean squared error of the reserve combines both sources of uncertainty. A confidence interval for the reserve can then be built from a normal or a lognormal distribution.',
];
const CLARK_OUTLINE = [
  { title: '1. Growth Curves', page: 1, level: 0 },
  { title: '2. The LDF and Cape Cod Methods', page: 6, level: 0 },
  { title: '3. Mack (1994) and the Chain Ladder', page: 13, level: 0 },
];
const CH3 = '3. Mack (1994) and the Chain Ladder';

// No outline: sections come from the numbered headings. Page 2 repeats its
// chapter heading as "(continued)", which is one chapter, not two.
const HURLIMANN_PAGES = [
  '1. Credible Loss Ratio Reserves\nHurlimann blends the individual and the collective loss ratio reserves with a credibility weight. The individual reserve is based on the chain ladder paid to date. The collective reserve is based on an expected loss ratio applied to premium.',
  '1. Credible Loss Ratio Reserves (continued)\nThe loss ratio payout factor at a given age is the sum of the incremental loss ratios up to that age. Hurlimann estimates the incremental loss ratios from the triangle using premium as the exposure.',
  '2. Optimal Credibility\nThe optimal credibility weight minimises the mean squared error of the blended reserve. The Benktander method uses a credibility weight equal to the percentage of losses paid.',
  'The Neuhaus method uses a credibility weight equal to the expected loss ratio times the percentage paid. Hurlimann recommends the optimal weight when the expected loss ratio is reliable.',
];

const REPORT_PAGES = [
  "CAS Exam 7 Examiner’s Report\nFall 2019 Sitting\nThis report gives the sample answers and the examiners’ comments for each question of the sitting. Scores are out of the points shown for each part.",
  'QUESTION 5\nSample Answer:\nThe Cape Cod method estimates fewer parameters than the LDF method.\nIt uses one expected loss ratio for every accident year.\nFewer parameters give a lower parameter variance.\nExaminer’s Comments\nSome candidates said the Cape Cod method uses fewer data points.\nThat is not the reason for the lower variance.\nq1 = 0.65',
  "QUESTION 6\nSample Answer:\nThe Mack test counts large and small development factors on each diagonal.\nExaminer's Comments\nMost candidates did not explain the diagonal test.",
];

const PDFS: Record<string, { pages: string[]; outline: AnyRec[] }> = {
  [MAT1]: { pages: CLARK_PAGES, outline: CLARK_OUTLINE },
  [MAT2]: { pages: HURLIMANN_PAGES, outline: [] },
  [REPORT]: { pages: REPORT_PAGES, outline: [] },
};

const QUESTIONS_MD = [
  '# Exam 7 practice',
  '',
  '## CAS Exam 7 2019 Fall Q5',
  'Exam: CAS Exam 7',
  'Sitting: 2019 Fall',
  'Number: 5',
  'Q: Explain why the Cape Cod method has a lower parameter variance than the LDF method.',
  'A: The Cape Cod method fits fewer parameters, one expected loss ratio for all years instead of one ultimate per year.',
  '',
  '## CAS Exam 7 2018 Spring Q3',
  'Exam: CAS Exam 7',
  'Sitting: 2018 Spring',
  'Number: 3',
  'Q: State the three assumptions Mack gives for the chain ladder method.',
  'A: Expected development proportional to losses to date, independent accident years, and variance proportional to losses to date.',
  '',
].join('\n');

/** A concept as the fixture model knows it: what it maps and the questions it writes. */
interface CFix {
  title: string; summary: string; page: number; claimedPage?: number; quote: string;
  ask: string; right: string; wrong: string[]; points: string[];
  plantSupport?: boolean; plantDistractor?: boolean; plantAnchor?: boolean;
}

/** Off-topic but on its page: anchors, does not settle the answer. */
const OFF_TOPIC_QUOTE = 'Mack shows that the chain ladder method rests on three assumptions.';
/** On no page at all. */
const FABRICATED_QUOTE = 'Mack proves that the chain ladder reserve is unbiased under every possible loss distribution.';
/** A wrong option a careful student could defend. */
const PLANTED_OPTION = 'Losses of different accident years do not affect one another';
const EXPLANATION = 'The quotation states the rule directly, so the right answer follows from it.';

const CONCEPTS: CFix[] = [
  {
    title: 'Expected development assumption', page: 13,
    summary: 'The expected cumulative loss at the next age equals the development factor times the cumulative loss to date.',
    quote: 'The first assumption is that the expected cumulative loss at the next age equals the development factor times the cumulative loss to date.',
    ask: "What does Mack's first chain ladder assumption state?",
    right: 'The expected next cumulative loss is the development factor times the loss to date',
    wrong: ['The expected next incremental loss is a fixed share of the ultimate loss', 'The expected next cumulative loss is the loss to date plus a constant amount', 'The expected next cumulative loss depends on the prior accident year'],
    points: ['expected cumulative loss at the next age', 'development factor times the cumulative loss to date', 'the chain ladder factors are unbiased'],
    plantSupport: true,
  },
  {
    title: 'Independence of accident years', page: 14, claimedPage: 13,
    summary: 'The cumulative losses of different accident years are independent.',
    quote: 'The second assumption is that the cumulative losses of different accident years are independent.',
    ask: "What does Mack's second assumption say about accident years?",
    right: 'Cumulative losses of different accident years are independent',
    wrong: ['Each accident year develops with its own development factors', 'Losses of later accident years are larger than earlier ones', 'Accident years share one ultimate loss ratio'],
    points: ['losses of different accident years are independent', 'calendar year effects would violate the assumption', 'a test counts large and small factors on diagonals'],
    plantDistractor: true,
  },
  {
    title: 'Variance proportional to losses to date', page: 15,
    summary: 'The variance of the next cumulative loss is proportional to the cumulative loss to date.',
    quote: 'The third assumption is that the variance of the next cumulative loss is proportional to the cumulative loss to date.',
    ask: "What does Mack's third assumption say about the variance?",
    right: 'The variance of the next cumulative loss is proportional to the loss to date',
    wrong: ['The variance of the next cumulative loss is the same for every accident year', 'The variance of the next cumulative loss is proportional to the square of the loss to date', 'The variance of the next cumulative loss is proportional to the ultimate loss'],
    points: ['variance of the next cumulative loss', 'proportional to the cumulative loss to date', 'the factor is a loss weighted average'],
    plantAnchor: true,
  },
  {
    title: 'Standard error of the reserve', page: 16,
    summary: 'Mack derives the standard error of the reserve from the process risk and the parameter risk.',
    quote: 'Mack derives the standard error of the reserve from the process risk and the parameter risk.',
    ask: 'From what does Mack derive the standard error of the reserve?',
    right: 'From the process risk and the parameter risk',
    wrong: ['From the process risk alone', 'From the spread of the age-to-age factors alone', 'From a bootstrap of the residuals'],
    points: ['the process risk and the parameter risk', 'the mean squared error of the reserve', 'a normal or lognormal confidence interval'],
  },
  {
    title: 'Credibility blend of reserves', page: 1,
    summary: 'Hurlimann blends the individual and the collective loss ratio reserves with a credibility weight.',
    quote: 'Hurlimann blends the individual and the collective loss ratio reserves with a credibility weight.',
    ask: 'How does Hurlimann combine the individual and collective reserves?',
    right: 'With a credibility weight between the two reserves',
    wrong: ['By taking the larger of the two reserves', 'By using the collective reserve until the year is fully paid', 'By averaging the two reserves with equal weights'],
    points: ['the individual and the collective reserves', 'blended with a credibility weight', 'the collective uses an expected loss ratio'],
  },
  {
    title: 'Loss ratio payout factor', page: 2,
    summary: 'The loss ratio payout factor at an age is the sum of the incremental loss ratios up to that age.',
    quote: 'The loss ratio payout factor at a given age is the sum of the incremental loss ratios up to that age.',
    ask: 'How is the loss ratio payout factor at an age defined?',
    right: 'The sum of the incremental loss ratios up to that age',
    wrong: ['The ratio of paid losses to ultimate losses at that age', 'The incremental loss ratio at that age alone', 'The expected loss ratio times the percentage paid'],
    points: ['the sum of the incremental loss ratios', 'up to the given age', 'premium is the exposure base'],
  },
  {
    title: 'Optimal credibility weight', page: 3,
    summary: 'The optimal credibility weight minimises the mean squared error of the blended reserve.',
    quote: 'The optimal credibility weight minimises the mean squared error of the blended reserve.',
    ask: 'What does the optimal credibility weight minimise?',
    right: 'The mean squared error of the blended reserve',
    wrong: ['The variance of the individual reserve', 'The bias of the collective reserve', 'The difference between paid and incurred losses'],
    points: ['minimises the mean squared error', 'of the blended reserve', 'it needs a reliable expected loss ratio'],
  },
  {
    title: 'Neuhaus weight', page: 4,
    summary: 'The Neuhaus method uses a credibility weight equal to the expected loss ratio times the percentage paid.',
    quote: 'The Neuhaus method uses a credibility weight equal to the expected loss ratio times the percentage paid.',
    ask: 'Which credibility weight does the Neuhaus method use?',
    right: 'The expected loss ratio times the percentage paid',
    wrong: ['The percentage of losses paid', 'One minus the percentage paid', 'The ratio of paid to incurred losses'],
    points: ['the expected loss ratio', 'times the percentage paid', 'differs from the Benktander weight'],
  },
];
const CH3_TITLES = CONCEPTS.slice(0, 4).map((c) => c.title);

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const halfOf = (point: string) => { const w = norm(point).split(' '); return w.slice(0, Math.ceil(w.length / 2)).join(' '); };

/** The fixture marker's rule: the whole point is a hit, its first half a partial, else a miss. */
function gradePoint(point: string, answer: string): 'hit' | 'partial' | 'miss' {
  const a = norm(answer);
  if (a.includes(norm(point))) return 'hit';
  return a.includes(halfOf(point)) ? 'partial' : 'miss';
}

/** A question the fixture model writes for a concept: the i-th of a format. */
function writeQuestion(fx: CFix, conceptId: number, format: string, i: number): AnyRec {
  const k = CONCEPTS.indexOf(fx);
  if (format === 'mc') {
    const wrong = i === 0 && fx.plantDistractor ? [fx.wrong[0], fx.wrong[1], PLANTED_OPTION] : fx.wrong.slice();
    const answer = (k + i) % 4;
    const options = wrong.slice();
    options.splice(answer, 0, fx.right);
    return {
      concept: conceptId, format: 'mc',
      stem: i === 0 ? fx.ask : `Which statement about ${fx.title.toLowerCase()} does the text make?`,
      options, answer, explanation: `The text says: ${fx.summary}`,
      quote: i === 0 && fx.plantSupport ? OFF_TOPIC_QUOTE : fx.quote, page: fx.page, difficulty: 'medium',
    };
  }
  return {
    concept: conceptId, format,
    stem: i === 0 ? `In a sentence or two, state ${fx.title.toLowerCase()} as the text gives it.` : `Explain briefly what the text says about ${fx.title.toLowerCase()}.`,
    answer: fx.summary,
    rubric: fx.points.map((text, j) => ({ text, required: j < 2 })),
    explanation: `The text says: ${fx.summary}`,
    quote: i === 0 && fx.plantAnchor ? FABRICATED_QUOTE : fx.quote, page: fx.page,
  };
}

const sentences = (s: string) => String(s || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

// ═══════════════════════════════════════════════════════════════════════════
// The fake host
// ═══════════════════════════════════════════════════════════════════════════

function studySettings(): AnyRec {
  const props = MANIFEST.contributes.configuration[0].properties;
  const out: AnyRec = {};
  for (const k of Object.keys(props)) out[k.replace(/^study\./, '')] = props[k].default;
  out.sessionSize = 6;
  out.questionsPerConcept = 1;
  return out;
}

function makeDatabase() {
  let db: any = null;
  const fail = (e: any) => ({ error: { code: String(e?.code || 'SQLITE_ERROR'), message: String(e?.message || e) } });
  const notOpen = { error: { code: 'NOT_OPEN', message: 'Database is not open' } };
  const bridge = {
    migratedFrom: '' as string,
    raw: () => db,
    async open() {
      if (!db) { db = new Database(':memory:'); db.pragma('foreign_keys = ON'); }
      return { error: null, dbPath: ':memory:' };
    },
    async close() { try { db?.close(); } catch { /* closed */ } db = null; return { error: null }; },
    async isOpen() { return { isOpen: !!db }; },
    async migrate(dir: string) {
      if (!db) return notOpen;
      bridge.migratedFrom = dir;
      try {
        db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT 0)');
        const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((r: AnyRec) => r.name));
        for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
          if (done.has(f)) continue;
          const sql = readFileSync(join(dir, f), 'utf8');
          db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f); })();
        }
        return { error: null };
      } catch (e) { return fail(e); }
    },
    async run(sql: string, params: unknown[] = []) {
      if (!db) return notOpen;
      try { const r = db.prepare(sql).run(...params); return { error: null, changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) }; } catch (e) { return fail(e); }
    },
    async get(sql: string, params: unknown[] = []) {
      if (!db) return notOpen;
      try { return { error: null, row: db.prepare(sql).get(...params) ?? null }; } catch (e) { return fail(e); }
    },
    async all(sql: string, params: unknown[] = []) {
      if (!db) return notOpen;
      try { return { error: null, rows: db.prepare(sql).all(...params) }; } catch (e) { return fail(e); }
    },
    async runTransaction(ops: AnyRec[]) {
      if (!db) return notOpen;
      try {
        const results = db.transaction(() => ops.map((op) => {
          const st = db.prepare(op.sql);
          const p = op.params || [];
          return op.type === 'run' ? st.run(...p) : op.type === 'get' ? (st.get(...p) ?? null) : st.all(...p);
        }))();
        return { error: null, results };
      } catch (e) { return fail(e); }
    },
  };
  return bridge;
}

function fsPathOf(uri: string) {
  let p = String(uri || '').replace(/^file:\/\//i, '');
  try { p = decodeURIComponent(p); } catch { /* keep */ }
  return p.length > 1 ? p.replace(/\/$/, '') : p;
}

interface Env {
  api: AnyRec; context: AnyRec; db: ReturnType<typeof makeDatabase>;
  calls: AnyRec; lmCalls: AnyRec[]; settings: AnyRec;
  editors: AnyRec; views: Map<string, AnyRec>; commandHandlers: Map<string, (...a: any[]) => any>;
  tools: Map<string, AnyRec>; widgets: AnyRec[]; links: AnyRec[]; selectionHandlers: AnyRec[];
  flashcardsOn: boolean;
  pick: (items: AnyRec[], opts: AnyRec) => AnyRec | undefined;
  confirm: boolean;
  hold: { kind: string; reached: boolean; release: () => void; promise: Promise<void> } | null;
  /** Question writing opens each reply with one question that fails validation. */
  unusable: boolean;
  /** The provider's next list() waits for this, once. */
  listGate: Promise<void> | null;
  listCalls: number;
  fireProviders: () => void;
  providerListenerCount: () => number;
}

function makeEnv(): Env {
  const calls: AnyRec = {
    openEditor: [], focusEditor: [], closeEditor: [], openFileEditor: [], executeCommand: [], quickPicks: [],
    confirms: [], info: [], warnings: [], errors: [], menus: [], addCards: [], extract: [], providerOpen: [],
  };
  const lmCalls: AnyRec[] = [];
  const settings = studySettings();
  const files = new Map<string, string>([
    [MAT1, '%PDF-1.7'], [MAT2, '%PDF-1.7'], [REPORT, '%PDF-1.7'], [QFILE, QUESTIONS_MD],
    ['/ws/.parallx/settings.json', '{}'], ['/ws/node_modules/x/readme.md', 'skip'],
  ]);
  const dirs = new Set<string>(['/ws']);
  const db = makeDatabase();
  const commandHandlers = new Map<string, (...a: any[]) => any>();
  const views = new Map<string, AnyRec>();
  const tools = new Map<string, AnyRec>();
  const widgets: AnyRec[] = [];
  const links: AnyRec[] = [];
  const selectionHandlers: AnyRec[] = [];

  const env = {} as Env;

  // The question-provider registry, in the core's shape ({ register, list, onDidChange }).
  const providerListeners = new Set<() => void>();
  const provider = {
    id: 'worksheets.items', displayName: 'Worksheets', toolId: 'parallx.worksheets',
    list: async () => {
      env.listCalls++;
      const gate = env.listGate;
      env.listGate = null;
      if (gate) await gate;
      return providerItems();
    },
    open: async (ref: string) => { calls.providerOpen.push(ref); return true; },
  };
  const providerItems = () => [
      { ref: 'ws-1', kind: 'essay', question: 'Explain why the LDF method has a high parameter variance on a small triangle.', answer: 'It fits one ultimate per accident year plus the curve parameters, so many parameters come from few points.', label: 'Clark LDF parameters', paper: 'Exam 7', source: 'rf' },
      { ref: 'ws-2', kind: 'essay', question: 'Describe the test Mack proposes for calendar year effects.', answer: 'Count large and small development factors along each diagonal and compare with the binomial expectation.', label: 'Mack calendar year test', paper: 'Exam 7', source: 'rf' },
  ];
  const registry = {
    register: (p: AnyRec) => { void p; return { dispose() {} }; },
    list: () => [provider],
    onDidChange: (fn: () => void) => { providerListeners.add(fn); return { dispose: () => providerListeners.delete(fn) }; },
  };
  const dispatcher = {
    registerHandler: (h: AnyRec) => {
      selectionHandlers.push(h);
      return { dispose: () => { const i = selectionHandlers.indexOf(h); if (i >= 0) selectionHandlers.splice(i, 1); } };
    },
  };

  // Editors: the workbench mounts the registered pane on openEditor.
  const editorProviders = new Map<string, AnyRec>();
  const open = new Map<string, AnyRec>(); // instanceId → { id, instanceId, title, host, pane, order }
  let order = 0;
  const editors = {
    providers: editorProviders,
    open,
    registerEditorProvider(typeId: string, p: AnyRec) {
      editorProviders.set(typeId, p);
      return { dispose: () => { if (editorProviders.get(typeId) === p) editorProviders.delete(typeId); } };
    },
    get openEditors() {
      return [...open.values()].map((e) => ({ id: e.id, name: e.title, description: '', isActive: e.order === order }));
    },
    async openEditor(o: AnyRec) {
      calls.openEditor.push(o);
      const existing = open.get(o.instanceId);
      if (existing) { existing.order = ++order; return; }
      const host = document.createElement('div');
      document.body.appendChild(host);
      const id = `parallx-community.study:${o.typeId}:${o.instanceId}`;
      const pane = editorProviders.get(o.typeId)?.createEditorPane(host, { id, instanceId: o.instanceId, title: o.title });
      open.set(o.instanceId, { id, instanceId: o.instanceId, title: o.title, host, pane, order: ++order });
    },
    async focusEditor(id: string) {
      calls.focusEditor.push(id);
      for (const e of open.values()) if (e.id === id) e.order = ++order;
      return true;
    },
    async closeEditor(id: string) {
      calls.closeEditor.push(id);
      for (const [k, e] of open) {
        if (e.id !== id) continue;
        try { e.pane?.dispose(); } catch { /* noop */ }
        e.host.remove();
        open.delete(k);
      }
      return true;
    },
    async openFileEditor(uri: string, options: AnyRec) { calls.openFileEditor.push({ uri, options }); },
  };

  async function* chat(modelId: string, messages: AnyRec[], options: AnyRec = {}) {
    const system = String(messages.find((m) => m.role === 'system')?.content || '');
    const user = String(messages.find((m) => m.role === 'user')?.content || '');
    const kind = system.startsWith('You read a passage') ? 'map'
      : system.startsWith('You write questions') ? 'questions'
      : system.startsWith('You check whether a quotation') ? 'support'
      : system.startsWith('You check one option') ? 'distractor'
      : system.startsWith('You mark') ? 'grade'
      : system.startsWith('You explain') ? 'explain'
      : system.startsWith('You reduce') ? 'rubric'
      : 'other';
    lmCalls.push({ kind, modelId, numCtx: options.numCtx, format: options.format, think: options.think, temperature: options.temperature, user });
    const hold = env.hold;
    if (hold && hold.kind === kind && !hold.reached) { hold.reached = true; await hold.promise; }
    const reply = answer(kind, user);
    const cut = Math.max(1, Math.floor(reply.length / 2));
    yield { content: reply.slice(0, cut) };
    yield { content: reply.slice(cut) };
    yield { done: true };
  }

  function answer(kind: string, user: string): string {
    if (kind === 'map') {
      const pages = new Set([...user.matchAll(/\[Page (\d+)\]/g)].map((m) => Number(m[1])));
      const found = CONCEPTS.filter((c) => pages.has(c.page) && user.includes(c.quote));
      return JSON.stringify({ concepts: found.map((c) => ({ title: c.title, summary: c.summary, page: c.claimedPage ?? c.page, quote: c.quote, essayWorthy: false, quantitative: false, hasFormula: false, term: '' })) });
    }
    if (kind === 'questions') {
      const out: AnyRec[] = [];
      for (const m of user.matchAll(/^- id (\d+): (.+?)\. .*Write: (.+)\.$/gm)) {
        const fx = CONCEPTS.find((c) => c.title === m[2]);
        if (!fx) continue;
        for (const part of m[3].split(',').map((s) => s.trim())) {
          const [n, format] = part.split(' ');
          for (let i = 0; i < Number(n); i++) out.push(writeQuestion(fx, Number(m[1]), format, i));
        }
      }
      if (env.unusable && out.length) out.unshift({ ...out[0], format: 'mc', options: ['Only one option'], answer: 3 });
      return JSON.stringify({ questions: out });
    }
    if (kind === 'support') {
      const quote = (/Quotation:\n([\s\S]*?)\n\nQuestion:/.exec(user) || [])[1] || '';
      return JSON.stringify({ settles: quote.trim() !== OFF_TOPIC_QUOTE, reason: 'Read alone.' });
    }
    if (kind === 'distractor') {
      const option = user.slice(user.indexOf('Option to check:\n') + 'Option to check:\n'.length).trim();
      return JSON.stringify({ defensible: option === PLANTED_OPTION, reason: 'Checked.' });
    }
    if (kind === 'grade') {
      const lines = user.split('\n');
      const start = lines.indexOf('Points to mark, in order:');
      const points: string[] = [];
      for (let i = start + 1; i < lines.length; i++) {
        const m = /^(\d+)\. (.*?)(?: \(supporting detail\))?$/.exec(lines[i]);
        if (m) points.push(m[2]); else if (points.length) break;
      }
      const typed = user.slice(user.indexOf("Student's answer:\n") + "Student's answer:\n".length);
      const statuses = points.map((p) => gradePoint(p, typed));
      // One point short: the note restates it word for word (as a local model
      // often does); more: a note that says something of its own.
      const short = statuses.map((st, i) => (st === 'hit' ? '' : points[i])).filter(Boolean);
      const note = !short.length ? '' : short.length === 1 ? `${short[0][0].toUpperCase()}${short[0].slice(1)}.` : 'A point from the text is missing.';
      return JSON.stringify({ points: statuses.map((status) => ({ status, note: '' })), contradiction: false, note });
    }
    if (kind === 'explain') return EXPLANATION;
    if (kind === 'rubric') {
      const answerText = (/(?:Sample answer|Model answer):\n([\s\S]*?)(?:\n\n|\nCommon errors|\nSource quotation|$)/.exec(user) || [])[1] || '';
      const errors = (/Common errors the examiners noted:\n([\s\S]*)$/.exec(user) || [])[1] || '';
      return JSON.stringify({ rubric: sentences(answerText).map((text) => ({ text, required: true })), contradictions: sentences(errors) });
    }
    return '{}';
  }

  const api: AnyRec = {
    env: { toolPath: STUDY_DIR },
    database: db,
    lm: {
      getModels: async () => [{ id: 'qwen3:14b', displayName: 'qwen3:14b', contextLength: 40960 }, { id: 'llama3:8b', displayName: 'llama3:8b', contextLength: 8192 }],
      getActiveModel: () => 'qwen3:14b',
      getModelInfo: async (id: string) => ({ id, displayName: id, family: 'qwen3', parameterSize: '14B', quantization: 'Q4', contextLength: id === 'llama3:8b' ? 8192 : 40960, capabilities: [] }),
      sendChatRequest: (modelId: string, messages: AnyRec[], options: AnyRec) => chat(modelId, messages, options),
    },
    workspace: {
      workspaceFolders: [{ uri: 'file:///ws', name: 'ws', index: 0 }],
      getConfiguration: (section: string) => ({ get: (key: string, fb: unknown) => (section === 'study' && key in env.settings ? env.settings[key] : fb) }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getCanvasPageTree: async () => [{ id: 'page-1', title: 'Clark notes', children: [] }],
      fs: {
        async readdir(uri: string) {
          const dir = fsPathOf(uri);
          const entries = new Map<string, number>();
          for (const f of [...files.keys(), ...dirs]) {
            if (!f.startsWith(dir + '/')) continue;
            const [head, ...rest] = f.slice(dir.length + 1).split('/');
            entries.set(head, rest.length || dirs.has(`${dir}/${head}`) ? 2 : (entries.get(head) ?? 1));
          }
          return [...entries].map(([name, type]) => ({ name, type }));
        },
        async readFile(uri: string) {
          const p = fsPathOf(uri);
          if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
          return { content: files.get(p), encoding: 'utf8' };
        },
        async writeFile(uri: string, content: string) { files.set(fsPathOf(uri), String(content)); },
        async mkdir(uri: string) { dirs.add(fsPathOf(uri)); },
        async exists(uri: string) { const p = fsPathOf(uri); return files.has(p) || dirs.has(p) || [...files.keys()].some((f) => f.startsWith(p + '/')); },
        async stat(uri: string) { const p = fsPathOf(uri); return { type: files.has(p) ? 1 : 2, size: (files.get(p) || '').length, mtime: 0, ctime: 0 }; },
        async delete(uri: string) { files.delete(fsPathOf(uri)); },
      },
    },
    commands: {
      registerCommand(id: string, handler: (...a: any[]) => any) {
        commandHandlers.set(id, handler);
        return { dispose: () => { if (commandHandlers.get(id) === handler) commandHandlers.delete(id); } };
      },
      async executeCommand(id: string, ...args: any[]) {
        calls.executeCommand.push({ id, args });
        const h = commandHandlers.get(id);
        if (h) return h(...args);
        switch (id) {
          case 'questions.getRegistry': return registry;
          case 'chat.getSelectionActionDispatcher': return dispatcher;
          case 'planner.getRegistry': return {};
          case 'canvas.getPageMarkdown': return { title: 'Clark notes', markdown: CLARK_PAGES.slice(0, 2).join('\n\n') };
          case 'flashcards.addCards':
            if (env.flashcardsOn) { calls.addCards.push(args[0]); return { deckId: 7, ids: (args[0]?.cards || []).map((_: unknown, i: number) => i + 1) }; }
            break;
          default: break;
        }
        throw new Error(`command '${id}' not found`);
      },
      async getCommands() {
        return [...commandHandlers.keys(), 'questions.getRegistry', 'chat.getSelectionActionDispatcher', 'planner.getRegistry', 'canvas.getPageMarkdown', ...(env.flashcardsOn ? ['flashcards.addCards'] : [])];
      },
    },
    editors,
    views: {
      registerViewProvider(id: string, p: AnyRec) {
        views.set(id, p);
        return { dispose: () => { if (views.get(id) === p) views.delete(id); } };
      },
    },
    chat: {
      registerTool(name: string, def: AnyRec) {
        tools.set(name, def);
        return { dispose: () => { if (tools.get(name) === def) tools.delete(name); } };
      },
    },
    dashboard: {
      registerWidgetType(def: AnyRec) {
        widgets.push(def);
        return { dispose: () => { const i = widgets.indexOf(def); if (i >= 0) widgets.splice(i, 1); } };
      },
    },
    links: {
      register(def: AnyRec) {
        links.push(def);
        return { dispose: () => { const i = links.indexOf(def); if (i >= 0) links.splice(i, 1); } };
      },
    },
    icons: {
      hasIcon,
      createIconHtml: (id: string, size = 16) => { const svg = getIcon(id); return svg ? `<span class="svg-icon">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</span>` : ''; },
    },
    ui: {
      createButton: kit.createButton,
      createIconButton: kit.createIconButton,
      createSectionLabel: kit.createSectionLabel,
      createEmptyState: kit.createEmptyState,
      createSegmented: kit.createSegmented,
      createPageHeader: kit.createPageHeader,
      createFilterChip: kit.createFilterChip,
      showContextMenu: (_anchor: unknown, items: AnyRec[]) => { calls.menus.push(items); return { update(next: AnyRec[]) { calls.menus.push(next); }, dispose() {} }; },
      renderMarkdown,
    },
    window: {
      showQuickPick: async (items: AnyRec[], opts: AnyRec) => { calls.quickPicks.push({ items, opts }); return env.pick(items, opts); },
      showConfirmModal: async (o: AnyRec) => { calls.confirms.push(o); return env.confirm; },
      showInformationMessage: async (m: string) => { calls.info.push(m); return undefined; },
      showWarningMessage: async (m: string) => { calls.warnings.push(m); return undefined; },
      showErrorMessage: async (m: string) => { calls.errors.push(m); return undefined; },
      showInputBox: async () => undefined,
    },
  };

  (globalThis as AnyRec).parallxElectron = {
    document: {
      extractText: async (fsPath: string) => {
        calls.extract.push(fsPath);
        const fx = PDFS[fsPath];
        if (!fx) return { error: { message: `No such file: ${fsPath}` } };
        return { text: fx.pages.join('\n\n'), format: 'pdf', metadata: { pageCount: fx.pages.length }, pageTexts: fx.pages.slice(), outline: fx.outline.map((o) => ({ ...o })) };
      },
    },
    python: {
      status: async () => ({ envExists: false, envPath: null, envPython: null, exists: false }),
      runScript: async () => ({ ok: false, error: 'No Python environment.' }),
      onRunData: () => () => {},
      onRunExit: () => () => {},
      cancelRun: async () => {},
    },
  };

  Object.assign(env, {
    api, context: { subscriptions: [] as AnyRec[] }, db, calls, lmCalls, settings, editors, views, commandHandlers,
    tools, widgets, links, selectionHandlers, flashcardsOn: true, pick: (items: AnyRec[]) => items[0], confirm: true, hold: null, unusable: false,
    listGate: null, listCalls: 0,
    fireProviders: () => { for (const fn of [...providerListeners]) fn(); },
    providerListenerCount: () => providerListeners.size,
  });
  return env;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function settle(rounds = 10) { for (let i = 0; i < rounds; i++) await tick(); }
/** Wait for a condition, bounded by event-loop turns (not by the clock). */
async function waitFor<V>(fn: () => V, what: string, rounds = 2000): Promise<NonNullable<V>> {
  for (let i = 0; i < rounds; i++) {
    let v: V | undefined;
    try { v = fn(); } catch { v = undefined; }
    if (v) return v as NonNullable<V>;
    await tick();
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const q = <E extends Element = HTMLElement>(root: ParentNode | null | undefined, sel: string) => (root ? root.querySelector(sel) : null) as E | null;
const qa = <E extends Element = HTMLElement>(root: ParentNode | null | undefined, sel: string) => (root ? Array.from(root.querySelectorAll(sel)) : []) as E[];
const text = (n: Element | null | undefined) => (n?.textContent || '').replace(/\s+/g, ' ').trim();
const btn = (root: ParentNode | null | undefined, label: string) => qa<HTMLButtonElement>(root, 'button').find((b) => text(b).startsWith(label)) || null;
/** Keys go to the focusable pane root, where the handler is scoped. */
const key = (h: Element, k: string, target?: Element) => (target || h.querySelector('.st-root') || h).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let env: Env;
let sidebars: AnyRec[] = [];
const extraHosts: HTMLElement[] = [];

const all = (sql: string, ...params: unknown[]): AnyRec[] => env.db.raw().prepare(sql).all(...params);
const one = (sql: string, ...params: unknown[]): AnyRec => env.db.raw().prepare(sql).get(...params);
/** The material's label as Study stored it (the file name, or a title made from it). */
const label1 = (): string => one('SELECT label FROM st_materials WHERE uri = ?', MAT1_URI).label;
const exec = (id: string, ...args: unknown[]) => env.api.commands.executeCommand(id, ...args);
const paneHost = (instanceId: string): HTMLElement | null => env.editors.open.get(instanceId)?.host ?? null;
function latestSessionTab(): string | null {
  const tabs = [...env.editors.open.values()].filter((e: AnyRec) => /^session-\d+$/.test(e.instanceId));
  tabs.sort((a: AnyRec, b: AnyRec) => b.order - a.order);
  return tabs[0]?.instanceId ?? null;
}
function mountSidebar() {
  const h = document.createElement('div');
  document.body.appendChild(h);
  extraHosts.push(h);
  const view = env.views.get('study.materials')!.createView(h);
  sidebars.push(view);
  return h;
}

async function boot() {
  await activate(env.api, env.context);
  // The provider sync runs on its own after activate; scenario 1 asserts what it stores.
  await waitFor(() => env.calls.executeCommand.some((c: AnyRec) => c.id === 'questions.getRegistry'), 'the registry request');
  await settle(20);
}

async function shutdown() {
  for (const e of [...env.editors.open.values()]) { try { e.pane?.dispose(); } catch { /* noop */ } e.host.remove(); }
  env.editors.open.clear();
  for (const v of sidebars) { try { v.dispose(); } catch { /* noop */ } }
  sidebars = [];
  for (const h of extraHosts.splice(0)) h.remove();
  await settle(5);
  for (const d of env.context.subscriptions.splice(0)) { try { d.dispose(); } catch { /* noop */ } }
  await deactivate();
  await settle(3);
}

/** The question on the card, by its stem. */
function currentQuestion(h: Element): AnyRec {
  const stem = norm(text(q(h, '.st-card__q')));
  const rows = all('SELECT * FROM st_questions WHERE hidden = 0 ORDER BY id DESC').filter((r) => norm(r.stem) === stem);
  if (!rows.length) throw new Error(`No question with the stem on the card: ${stem}`);
  return rows[0];
}

/** End the leaving card's transition by hand (jsdom has no animations). */
async function cardLeft(h: Element) {
  const leaving = await waitFor(() => q(h, '.st-card--leaving'), 'the card to leave');
  leaving.dispatchEvent(new Event('animationend'));
  await settle();
}

/** Study This Document on Clark at page 15: the setup sheet on chapter 3, its footer painted. */
async function openChapterSetup() {
  await exec('study.studyDocument', { uri: MAT1_URI, fsPath: MAT1, page: 15 });
  const h = await waitFor(() => paneHost('setup'), 'the setup tab');
  await waitFor(() => text(q(h, '.st-sheet__count')), 'the count line');
  return h;
}

/** From an open setup sheet: Start, through generation if needed, to the first card. */
async function startFromSetup(setup: HTMLElement) {
  const before = latestSessionTab();
  (btn(setup, 'Make Questions and Start') || btn(setup, 'Start'))!.click();
  const tab = await waitFor(() => { const t = latestSessionTab(); return t && t !== before ? t : null; }, 'a session tab');
  const h = paneHost(tab)!;
  await waitFor(() => q(h, '.st-card'), 'the first card');
  return { h, sessionId: Number(tab.slice('session-'.length)) };
}

async function startChapterSession() {
  return startFromSetup(await openChapterSetup());
}

/** Typed answers built from a question's rubric. */
function typedAnswer(rubric: AnyRec[], plan: 'all' | 'two' | 'partial' | 'none'): string {
  const pts = rubric.map((p) => p.text);
  if (plan === 'all') return pts.join('. ') + '.';
  if (plan === 'two') return `${pts[0]}. ${pts[1]}.`;
  if (plan === 'partial') return `${pts[0]}. ${halfOf(pts[1])}.`;
  return 'I do not remember this one at all.';
}

/**
 * Answer every remaining card of the draw: mc right by key unless `wrongFirstMc`
 * (then wrong, Retry, right), typed by `typedPlans` in turn.
 */
async function answerDraw(h: HTMLElement, { wrongFirstMc = false, typedPlans = ['all', 'two', 'partial'] as Array<'all' | 'two' | 'partial' | 'none'>, mcWrong = false } = {}) {
  let mcSeen = 0;
  let typedSeen = 0;
  for (let guard = 0; guard < 30; guard++) {
    if (q(h, '.st-res')) return;
    const card = q(h, '.st-card:not(.st-card--leaving)');
    if (!card) { await settle(); continue; }
    const qrow = currentQuestion(h);
    if (card.dataset.format === 'mc') {
      const right = Number(qrow.answer);
      const wrong = (right + 1) % 4;
      if ((wrongFirstMc && mcSeen === 0) || mcWrong) {
        key(h, String(wrong + 1));
        await waitFor(() => q(h, '.st-fb--show'), 'feedback');
        if (wrongFirstMc && mcSeen === 0) {
          await waitFor(() => btn(h, 'Next') && !btn(h, 'Next')!.disabled, 'the answer stored');
          key(h, 'r');
          key(h, String(right + 1));
          await waitFor(() => text(q(h, '.st-fb__grade')).includes('Again'), 'counts as Again');
        }
      } else {
        key(h, String(right + 1));
        await waitFor(() => q(h, '.st-fb--show'), 'feedback');
      }
      mcSeen++;
    } else {
      const field = q<HTMLTextAreaElement>(h, '.st-ta textarea, .st-ta input')!;
      field.value = typedAnswer(JSON.parse(qrow.rubric_json || '[]').length ? JSON.parse(qrow.rubric_json) : [{ text: qrow.answer }], typedPlans[typedSeen % typedPlans.length]);
      key(h, 'Enter', field);
      await waitFor(() => text(q(btn(h, 'Next'), '.px-btn__label')) === 'Next' || q(h, '.st-card--leaving') || q(h, '.st-res'), 'the check');
      typedSeen++;
    }
    await waitFor(() => btn(h, 'Next') && !btn(h, 'Next')!.disabled, 'Next enabled');
    key(h, 'Enter');
    await cardLeft(h);
  }
}

/** Mastery each concept should hold, replaying the stored first answers through stApplyAnswer. */
function predictConcepts(pre: AnyRec[]): Map<number, AnyRec> {
  const byId = new Map<number, AnyRec>();
  for (const r of pre) byId.set(r.id, {
    id: r.id, materialId: r.material_id, sectionId: r.section_id, title: r.title, summary: r.summary, page: r.page, anchorQuote: r.anchor_quote, ord: r.ord,
    mastery: r.mastery, answers: r.answers, misses: r.misses, missStreak: r.miss_streak, rightChooseAt: r.right_choose_at, rightTypeAt: r.right_type_at, lastAnsweredAt: r.last_answered_at,
  });
  for (const a of all('SELECT * FROM st_answers WHERE retried = 0 ORDER BY id')) {
    const c = byId.get(a.concept_id);
    if (!c) continue;
    byId.set(a.concept_id, T.stApplyAnswer(c, { correct: !!a.correct, rating: a.rating, formatUsed: a.format_used, retried: false }, a.at));
  }
  return byId;
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261007));
  registerIcon(MANIFEST.contributes.icons[0].id, MANIFEST.contributes.icons[0].svg);
  env = makeEnv();
});

afterEach(async () => {
  if (env.hold) env.hold.release();
  await shutdown();
  await env.db.close();
  vi.restoreAllMocks();
});

function holdLm(kind: string) {
  let release: () => void = () => {};
  const promise = new Promise<void>((r) => { release = r; });
  env.hold = { kind, reached: false, release, promise };
  return env.hold;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Activation
// ═══════════════════════════════════════════════════════════════════════════

describe('Study end to end', () => {
  it('1. activate registers every contribution, syncs providers; dispose and deactivate clean up; a second activate works', async () => {
    await boot();
    await waitFor(() => one("SELECT COUNT(*) AS n FROM st_banks WHERE kind = 'provider'").n === 1, 'the provider bank');
    expect(env.db.migratedFrom).toBe(join(STUDY_DIR, 'db', 'migrations'));
    expect(one("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'st_%'").n).toBe(10);
    expect(one('PRAGMA foreign_keys').foreign_keys).toBe(1);

    expect([...env.views.keys()]).toEqual(['study.materials']);
    expect([...env.editors.providers.keys()]).toEqual(['study']);
    expect([...env.commandHandlers.keys()].sort()).toEqual([...MANIFEST_COMMANDS].sort());
    expect(MANIFEST_COMMANDS.length).toBe(8);
    expect(env.selectionHandlers.map((h) => ({ actionId: h.actionId, label: h.label, icon: h.icon }))).toEqual([{ actionId: 'quiz-selection', label: 'Quiz This Selection', icon: 'px-study' }]);

    // Provider sync (bug 2): the core registry is { register, list, onDidChange }.
    const provided = all("SELECT * FROM st_questions WHERE origin = 'provider' ORDER BY id");
    const refOf = (raw: string) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v.ref : raw; } catch { return raw; } };
    expect(provided.map((r) => [r.provider_id, refOf(r.provider_ref), r.format, r.origin_label])).toEqual([
      ['worksheets.items', 'ws-1', 'essay', 'Clark LDF parameters'],
      ['worksheets.items', 'ws-2', 'essay', 'Mack calendar year test'],
    ]);
    const bank = one("SELECT * FROM st_banks WHERE kind = 'provider'");
    expect(bank).toMatchObject({ provider_id: 'worksheets.items', name: 'Worksheets', count: 2 });
    expect(provided.every((r) => r.bank_id === bank.id)).toBe(true);

    expect(env.widgets.map((w) => w.typeId)).toEqual(['parallx-community.study.weak-spots']);
    expect(env.widgets[0].displayName).toBe('Weak Spots');
    expect(env.links.map((l) => l.segment)).toEqual(['study']);
    expect(Object.keys(env.links[0].kinds).sort()).toEqual(['concept', 'session']);
    expect([...env.tools.keys()].sort()).toEqual(['study_results', 'study_session', 'study_weak_spots']);
    expect(q(document, 'style#study-styles')).not.toBeNull();

    // The widget renders from its refresh output; its footer is Title Case.
    const wHost = document.createElement('div');
    document.body.appendChild(wHost);
    extraHosts.push(wHost);
    const cached = await env.widgets[0].refresh({ config: { maxRows: 5 } });
    const widget = env.widgets[0].createWidget(wHost, { cachedOutput: cached, config: { maxRows: 5 }, requestRefresh: () => {}, onDidChangeConfig: () => ({ dispose() {} }) });
    expect(text(q(wHost, '.st-widget__empty'))).toBe('Nothing studied yet.');
    expect(text(q(wHost, '.st-widget__foot'))).toMatch(/^Study the Weakest \d+$/);
    widget.dispose();

    // Turned off: every contribution goes at once.
    for (const d of env.context.subscriptions.splice(0)) d.dispose();
    await deactivate();
    expect(env.views.size).toBe(0);
    expect(env.editors.providers.size).toBe(0);
    expect(env.commandHandlers.size).toBe(0);
    expect(env.selectionHandlers.length).toBe(0);
    expect(env.widgets.length).toBe(0);
    expect(env.links.length).toBe(0);
    expect(env.tools.size).toBe(0);
    expect(q(document, 'style#study-styles')).toBeNull(); // bug 14
    const extractsBefore = env.calls.extract.length;
    const execBefore = env.calls.executeCommand.length;
    await settle(5);
    expect(env.calls.extract.length).toBe(extractsBefore);
    expect(env.calls.executeCommand.length).toBe(execBefore);

    // On again: the same database, nothing duplicated.
    env.context = { subscriptions: [] };
    await activate(env.api, env.context);
    await waitFor(() => env.commandHandlers.size === 8 && env.selectionHandlers.length === 1, 'the second activation');
    await settle(10);
    expect(one("SELECT COUNT(*) AS n FROM st_questions WHERE origin = 'provider'").n).toBe(2);
    expect(one("SELECT COUNT(*) AS n FROM st_banks WHERE kind = 'provider'").n).toBe(1);
    expect(env.tools.size).toBe(3);
  });

  it('1b. off and on again in one app session: a provider sync that resolves after deactivate stops quietly, and the next activation syncs once', async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logged.push(a); });
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { logged.push(a); });
    let release: () => void = () => {};
    env.listGate = new Promise<void>((r) => { release = r; });
    await activate(env.api, env.context);
    await waitFor(() => env.listCalls === 1, 'the first sync to reach the provider');
    const firstContext = env.context;

    // Off, in the order that leaks if anything is pushed late: the
    // subscriptions first, then deactivate().
    for (const d of firstContext.subscriptions.splice(0)) d.dispose();
    await deactivate();
    env.fireProviders(); // the registry changes while Study is off
    await settle(5);
    expect(env.listCalls).toBe(1);
    expect(env.providerListenerCount()).toBe(0);

    // On again; the first sync's provider answers only now.
    env.context = { subscriptions: [] };
    await activate(env.api, env.context);
    await waitFor(() => env.listCalls === 2, "the second activation's sync");
    release();
    await settle(30);
    expect(env.listCalls).toBe(2);
    expect(env.providerListenerCount()).toBe(1);
    expect(firstContext.subscriptions.length).toBe(0);
    expect(one("SELECT COUNT(*) AS n FROM st_banks WHERE kind = 'provider'").n).toBe(1);
    expect(one("SELECT COUNT(*) AS n FROM st_questions WHERE origin = 'provider'").n).toBe(2);

    // One change, one sync: only the live activation listens.
    env.fireProviders();
    await waitFor(() => env.listCalls === 3, 'the sync on change');
    await settle(30);
    expect(env.listCalls).toBe(3);
    expect(logged).toEqual([]);

    // Off again with deactivate() first (the host's order), then a change: nothing runs.
    await deactivate();
    for (const d of env.context.subscriptions.splice(0)) d.dispose();
    env.fireProviders();
    await settle(10);
    expect(env.listCalls).toBe(3);
    expect(env.providerListenerCount()).toBe(0);
    expect(logged).toEqual([]);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. Study This Document
  // ═════════════════════════════════════════════════════════════════════════

  it('2. Study This Document ingests the PDF, stores its outline sections and opens setup on the chapter holding the page', async () => {
    await boot();
    const sb = mountSidebar();
    await settle();
    expect(qa(sb, '.st-sb__it--material').length).toBe(0);

    const material = await exec('study.studyDocument', { uri: MAT1_URI, fsPath: MAT1, page: 15 });
    expect(material).toMatchObject({ kind: 'pdf', uri: MAT1_URI, pageCount: 16 });
    expect(material.label).toBe(label1());
    expect(label1()).toMatch(/Clark.*2003.*Mack.*1994/);
    expect(env.calls.extract).toEqual([MAT1]);

    const mats = all('SELECT * FROM st_materials');
    expect(mats.length).toBe(1);
    expect(mats[0]).toMatchObject({ kind: 'pdf', uri: MAT1_URI, page_count: 16 });
    expect(mats[0].content_hash).toMatch(/^[0-9a-f]{8}$/);
    const sections = all('SELECT title, page_from, page_to, ord FROM st_sections ORDER BY ord');
    expect(sections).toEqual([
      { title: '1. Growth Curves', page_from: 1, page_to: 5, ord: 0 },
      { title: '2. The LDF and Cape Cod Methods', page_from: 6, page_to: 12, ord: 1 },
      { title: CH3, page_from: 13, page_to: 16, ord: 2 },
    ]);
    const ch3 = one('SELECT id FROM st_sections WHERE title = ?', CH3).id;

    expect(env.calls.openEditor.at(-1)).toMatchObject({ typeId: 'study', instanceId: 'setup', title: 'Study' });
    const setup = await waitFor(() => paneHost('setup'), 'the setup tab');
    await waitFor(() => q(setup, '.st-outline__o--on'), 'the chosen chapter');
    expect(q(setup, '.st-outline__o--on')!.dataset.sectionId).toBe(String(ch3));

    // The same document again: one material, the same sections (the map is kept).
    const sectionIds = all('SELECT id FROM st_sections ORDER BY ord').map((r) => r.id);
    await exec('study.studyDocument', { uri: MAT1_URI, fsPath: MAT1, page: 2 });
    expect(one('SELECT COUNT(*) AS n FROM st_materials').n).toBe(1);
    expect(all('SELECT id FROM st_sections ORDER BY ord').map((r) => r.id)).toEqual(sectionIds);
    expect(env.calls.focusEditor.at(-1)).toBe('parallx-community.study:study:setup');

    // The sidebar lists it, expanded into its chapters, none with a bank yet.
    await waitFor(() => qa(sb, '.st-sb__it--sub').length === 3, 'chapter rows');
    expect(qa(sb, '.st-sb__it--material').map(text)).toEqual([label1()]);
    expect(qa(sb, '.st-sb__it--material .st-mini').length).toBe(1);
    expect(qa(sb, '.st-sb__it--sub').map((r) => text(q(r, '.st-sb__nm')))).toEqual(sections.map((s) => s.title));
    expect(qa(sb, '.st-sb__it--sub').map((r) => text(q(r, '.st-sb__r')))).toEqual(['no bank', 'no bank', 'no bank']);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. Setup, generation, the first card
  // ═════════════════════════════════════════════════════════════════════════

  it('3. setup renders; Start generates through the four checks into the bank, and the session opens on a card', async () => {
    await boot();
    const setup = await openChapterSetup();
    const ch3 = one('SELECT id FROM st_sections WHERE title = ?', CH3).id;

    // The sheet: scope, outline with coverage bars, Mode and Answer on one row, the footer.
    expect(q(setup, '.st-scrim')).not.toBeNull();
    expect(text(q(setup, '.st-sheet__title'))).toBe('Study');
    expect(text(q(setup, '.st-sheet__sub'))).toBe(label1());
    const segs = qa(setup, '.ui-segmented-control');
    expect(segs.length).toBe(3);
    expect(qa(segs[0], '.ui-segmented-control__segment').map(text)).toEqual(['Document', 'Pages', 'Chapter']);
    expect(text(q(segs[0], '.ui-segmented-control__segment--active'))).toBe('Chapter');
    expect(qa(segs[1], '.ui-segmented-control__segment').map(text)).toEqual(['Practice', 'Test', 'Learn']);
    expect(qa(segs[2], '.ui-segmented-control__segment').map(text)).toEqual(['Choose', 'Type', 'Mixed']);
    expect(text(q(segs[2], '.ui-segmented-control__segment--active'))).toBe('Mixed');
    // Mode and Answer share one row: their common container holds nothing else of the sheet.
    let shared: HTMLElement | null = segs[1].parentElement;
    while (shared && !shared.contains(segs[2])) shared = shared.parentElement;
    expect(shared && !shared.contains(segs[0]) && !shared.classList.contains('st-sheet__bd')).toBe(true);
    expect(qa(setup, '.st-outline__o').length).toBe(3);
    expect(qa(setup, '.st-outline__o .st-ocov').length).toBe(3);
    expect(q(setup, '.st-outline__o--on')!.dataset.sectionId).toBe(String(ch3));
    expect(text(q(setup, '.st-sheet__mdl'))).toBe('qwen3:14b · Auto context');
    expect(text(q(setup, '.st-sheet__count'))).toMatch(/(No questions yet|0 questions in the bank), 6 (more )?will be made first/i);
    expect(btn(setup, 'Make Questions and Start')).not.toBeNull();
    expect(btn(setup, 'Cancel')).not.toBeNull();
    q<HTMLButtonElement>(setup, '.st-sheet__mdl')!.click();
    const menu = env.calls.menus.at(-1).map((m: AnyRec) => m.label);
    expect(menu).toEqual(['Model', 'qwen3:14b', 'llama3:8b', "Use the Chat's Model", undefined, 'Context', 'Auto', '8K', '16K', '32K', '40K']);

    // Start: the generation screen, held at the first question-writing call.
    const hold = holdLm('questions');
    btn(setup, 'Make Questions and Start')!.click();
    const tab = await waitFor(() => latestSessionTab(), 'the session tab');
    const sessionId = Number(tab.slice('session-'.length));
    expect(env.calls.closeEditor).toContain('parallx-community.study:study:setup');
    expect(paneHost('setup')).toBeNull();
    const h = paneHost(tab)!;
    await waitFor(() => hold.reached, 'the first question call');
    await waitFor(() => text(q(h, '.st-ck[data-check="numeric"] .st-ck__n')) === 'needs Python', 'the numeric row');
    expect(text(q(h, '.st-gen__t'))).toBe(`Making questions for ${label1()} · ${CH3}`);
    expect(qa(h, '.st-ck').map((c) => text(qa(c, 'span')[1]))).toEqual(['Anchor is on the page', 'Anchor settles the answer', 'No wrong option is defensible', 'Numeric answers execute']);
    expect(q(h, '.st-ck[data-check="parse"]'), 'no unusable output yet: no fifth row').toBeNull();
    expect(btn(h, 'Start With 6 Ready')!.disabled).toBe(true);
    expect(btn(h, 'Stop')!.disabled).toBe(false);
    const session = one('SELECT * FROM st_sessions WHERE id = ?', sessionId);
    expect(session).toMatchObject({ mode: 'practice', answer_format: 'mixed', size: 6, finished_at: 0 });
    expect(JSON.parse(session.scope_json)).toMatchObject({ kind: 'chapter', materialIds: [1], sectionIds: [ch3] });
    hold.release();

    // The session screen: a card and a strand of six.
    await waitFor(() => q(h, '.st-card'), 'the first card');
    expect(qa(h, '.st-strand i').length).toBe(6);
    expect(qa(h, '.st-strand i')[0].className).toBe('cur');
    expect(text(q(h, '.st-sess-tb__scope'))).toBe(`${label1()} · ${CH3} · Practice · Mixed`);

    // Concepts: one map call, anchored mechanically (page 14 although the model said 13).
    const concepts = all('SELECT * FROM st_concepts ORDER BY page');
    expect(concepts.map((c) => [c.title, c.page, c.section_id])).toEqual(CONCEPTS.slice(0, 4).map((c) => [c.title, c.page, ch3]));
    expect(concepts.map((c) => c.anchor_quote)).toEqual(CONCEPTS.slice(0, 4).map((c) => c.quote));
    expect(one('SELECT mapped_at FROM st_sections WHERE id = ?', ch3).mapped_at).toBeGreaterThan(0);

    // Questions: every kept one passed its checks; the planted failures were dropped.
    const generated = all("SELECT * FROM st_questions WHERE origin = 'generated' ORDER BY id");
    expect(generated.length).toBeGreaterThanOrEqual(6);
    for (const g of generated) {
      const checks = JSON.parse(g.checks_json);
      expect(checks.anchor).toBe(true);
      expect(checks.support).toBe(true);
      expect(checks.distractor).toBe(g.format === 'mc' ? true : null);
      expect(checks.numeric).toBe(null);
      const fx = CONCEPTS.find((c) => c.title === concepts.find((x) => x.id === g.concept_id)!.title)!;
      expect(g.source_page).toBe(fx.page);
      expect(g.source_quote).toBe(fx.quote);
      expect(g.material_id).toBe(1);
      expect(g.model).toBe('qwen3:14b');
      expect(['mc', 'short']).toContain(g.format);
    }
    expect(generated.map((g) => g.source_quote)).not.toContain(OFF_TOPIC_QUOTE);
    expect(generated.map((g) => g.source_quote)).not.toContain(FABRICATED_QUOTE);
    expect(generated.some((g) => JSON.parse(g.options_json).includes(PLANTED_OPTION))).toBe(false);

    // The run: done, its counts are the table's, the drops counted, numeric unavailable.
    const runs = all('SELECT * FROM st_runs ORDER BY id');
    expect(runs.length).toBeGreaterThanOrEqual(1);
    for (const r of runs) {
      expect(r.status).toBe('done');
      expect(r.kept).toBe(one('SELECT COUNT(*) AS n FROM st_questions WHERE run_id = ?', r.id).n);
      expect(r.written).toBeGreaterThanOrEqual(r.kept);
      expect(r.model).toBe('qwen3:14b');
      expect(r.finished_at).toBeGreaterThan(0);
    }
    const dropped = runs.map((r) => JSON.parse(r.dropped_json));
    const sum = (k: string) => dropped.reduce((n, d) => n + (Number(d[k]) || 0), 0);
    expect(sum('anchor')).toBe(1);
    expect(sum('support')).toBe(1);
    expect(sum('distractor')).toBe(1);
    expect(dropped.every((d) => d.numeric === null)).toBe(true);
    expect(runs.reduce((n, r) => n + r.kept, 0)).toBe(generated.length);

    // Every model call: JSON where a reply is parsed, a planned window, no thinking.
    const kinds = env.lmCalls.map((c) => c.kind);
    expect(kinds[0]).toBe('map');
    expect(kinds.filter((k) => k === 'map').length).toBe(1);
    expect(kinds).toContain('questions');
    expect(kinds).toContain('support');
    expect(kinds).toContain('distractor');
    for (const c of env.lmCalls) {
      expect(c.format).toBe('json');
      expect(c.numCtx).toBeGreaterThanOrEqual(8192);
      expect(c.numCtx).toBeLessThanOrEqual(40960);
      expect(c.think).toBe(false);
    }
    expect(env.lmCalls.filter((c) => c.kind === 'questions').every((c) => c.temperature === 0.3)).toBe(true);
    expect(env.lmCalls.filter((c) => c.kind === 'support' || c.kind === 'distractor').every((c) => c.temperature === 0)).toBe(true);

    // Items: six of draw 0, mc while the concept is new in Mixed.
    const items = all('SELECT i.*, q.material_id, q.concept_id, q.format AS qformat FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ? ORDER BY i.ord', sessionId);
    expect(items.length).toBe(6);
    expect(items.every((i) => i.draw === 0 && i.status === 'pending')).toBe(true);
    expect(new Set(items.map((i) => i.question_id)).size).toBe(6);
    for (const i of items) expect(i.format_used).toBe(i.qformat === 'mc' ? 'mc' : i.qformat);
  });

  it('3b. unusable model output has its own row once it counts, and the count line adds up to the rows', async () => {
    await boot();
    env.unusable = true;
    const setup = await openChapterSetup();
    const hold = holdLm('support');
    btn(setup, 'Make Questions and Start')!.click();
    const tab = await waitFor(() => latestSessionTab(), 'the session tab');
    const h = paneHost(tab)!;
    await waitFor(() => hold.reached, 'the first support check');
    const row = await waitFor(() => q(h, '.st-ck[data-check="parse"]'), 'the unusable row');
    expect(text(qa(row, 'span')[1])).toBe('Unusable model output');
    expect(text(q(row, '.st-ck__n'))).toBe('1 dropped');
    expect(q(row, '.st-ck__d')!.className).toBe('st-ck__d st-ck__d--idle');
    expect(qa(h, '.st-ck').at(-1)).toBe(row);
    const rowsTotal = qa(h, '.st-ck__n').map((n) => Number((/^(\d+) dropped$/.exec(text(n)) || [])[1]) || 0).reduce((a, b) => a + b, 0);
    const line = qa(h, '.st-genline > span').map(text);
    expect(line[1]).toBe(`${rowsTotal} dropped`);
    expect(line[2]).toMatch(/^\d of 6 ready$/);
    hold.release();
    await waitFor(() => q(h, '.st-card'), 'the first card');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. The session
  // ═════════════════════════════════════════════════════════════════════════

  it('4. session: a wrong choice marks rows and persists; source, explain, retry; typed answers graded point by point; mastery as stApplyAnswer predicts', async () => {
    await boot();
    const setup = await openChapterSetup();
    const preConcepts = () => all('SELECT * FROM st_concepts');
    const { h, sessionId } = await startFromSetup(setup);
    const pre = preConcepts();
    expect(pre.every((c) => c.answers === 0 && c.mastery === 0)).toBe(true);

    // The card: eyebrow, the stem, options with keycaps, Next disabled.
    const card = q(h, '.st-card')!;
    expect(card.dataset.format).toBe('mc');
    const first = currentQuestion(h);
    const concept = pre.find((c) => c.id === first.concept_id)!;
    expect(text(q(h, '.st-eyebrow__cpt'))).toBe(concept.title);
    expect(q<HTMLButtonElement>(h, 'button[title^="Hide This Question"]')!.title).toBe('Hide This Question…');
    expect(qa(h, '.st-opt .st-opt__key').map(text)).toEqual(['1', '2', '3', '4']);
    expect(qa(h, '.st-opt .st-opt__text').map(text)).toEqual(JSON.parse(first.options_json));
    expect(btn(h, 'Next')!.disabled).toBe(true);
    expect(q(h, '.st-sess-tb')!.textContent).not.toMatch(/\d+\s*\/\s*\d+/); // no counter

    // Wrong by key.
    const right = Number(first.answer);
    const wrong = (right + 1) % 4;
    key(h, String(wrong + 1));
    await waitFor(() => q(h, '.st-fb--show'), 'feedback');
    expect(qa(h, '.st-opt')[wrong].classList.contains('st-opt--wrong')).toBe(true);
    expect(qa(h, '.st-opt')[right].classList.contains('st-opt--right')).toBe(true);
    expect(q(h, '.st-opts')!.classList.contains('st-opts--done')).toBe(true);
    const fb = q(h, '.st-fb')!;
    expect(fb.classList.contains('st-fb--no')).toBe(true);
    expect(text(q(fb, '.st-fb__text'))).toBe('Not quite');
    expect(text(q(fb, '.st-fb__why'))).toBe(first.explanation);
    expect(text(q(fb, '.st-quote__text'))).toBe(`“${first.source_quote}”`);
    expect(text(q(fb, '.st-quote__pg'))).toBe(`p. ${first.source_page} ↗`);
    expect(qa(fb, '.st-fb__acts button').map(text)).toEqual(['Retry', 'Show Source', 'Explain']);
    expect(qa(h, '.st-strand i')[0].className).toContain('no');
    await waitFor(() => !btn(h, 'Next')!.disabled, 'Next enabled');
    const item0 = one('SELECT * FROM st_session_items WHERE session_id = ? ORDER BY ord LIMIT 1', sessionId);
    expect(item0).toMatchObject({ question_id: first.id, status: 'wrong', chosen: String(wrong), format_used: 'mc', retried: 0 });
    expect(item0.answered_at).toBeGreaterThan(0);
    expect(all('SELECT * FROM st_answers')).toEqual([expect.objectContaining({ question_id: first.id, concept_id: first.concept_id, session_id: sessionId, format_used: 'mc', correct: 0, rating: 1, retried: 0 })]);
    expect(one('SELECT * FROM st_concepts WHERE id = ?', first.concept_id)).toMatchObject({ answers: 1, misses: 1, miss_streak: 1 });
    expect(one('SELECT position FROM st_sessions WHERE id = ?', sessionId).position).toBe(0);

    // The page link opens the PDF beside the session at the anchor.
    q<HTMLButtonElement>(fb, '.st-quote__pg')!.click();
    await waitFor(() => env.calls.openFileEditor.length === 1, 'openFileEditor');
    expect(env.calls.openFileEditor[0]).toEqual({ uri: MAT1_URI, options: { reveal: { page: first.source_page, quote: first.source_quote }, side: true } });

    // Explain streams the model's explanation, without JSON.
    btn(fb, 'Explain')!.click();
    await waitFor(() => text(q(fb, '.st-explain')) === EXPLANATION, 'the explanation');
    expect(env.lmCalls.at(-1)).toMatchObject({ kind: 'explain', format: undefined });

    // Retry once, then right: still a miss, counted as Again.
    btn(fb, 'Retry')!.click();
    expect(q(h, '.st-opts')!.classList.contains('st-opts--done')).toBe(false);
    expect(btn(h, 'Next')!.disabled).toBe(true);
    key(h, String(right + 1));
    await waitFor(() => text(q(h, '.st-fb__text')) === 'Correct', 'the retried answer');
    expect(text(q(h, '.st-fb__grade'))).toBe('· counts as Again');
    expect(qa(h, '.st-fb__acts button').map(text)).toEqual(['Show Source', 'Explain']);
    expect(qa(h, '.st-strand i')[0].className).toContain('no');
    await waitFor(() => one('SELECT COUNT(*) AS n FROM st_answers').n === 2, 'the retry row');
    expect(one('SELECT * FROM st_session_items WHERE id = ?', item0.id)).toMatchObject({ status: 'wrong', chosen: String(right), retried: 1 });
    expect(one('SELECT * FROM st_answers ORDER BY id DESC LIMIT 1')).toMatchObject({ correct: 1, rating: 1, retried: 1 });
    expect(one('SELECT answers FROM st_concepts WHERE id = ?', first.concept_id).answers).toBe(1);

    // Enter: the card leaves, the next arrives.
    await waitFor(() => !btn(h, 'Next')!.disabled, 'Next enabled');
    key(h, 'Enter');
    expect(q(h, '.st-card')!.classList.contains('st-card--leaving')).toBe(true);
    await cardLeft(h);
    expect(currentQuestion(h).id).not.toBe(first.id);
    expect(qa(h, '.st-strand i').map((i) => i.className)).toEqual(['no', 'cur', '', '', '', '']);

    // The rest of the draw: mc right, then the typed items through the marker.
    for (let n = 0; n < 2; n++) {
      if (q(h, '.st-card')!.dataset.format !== 'mc') break;
      const qr = currentQuestion(h);
      key(h, String(Number(qr.answer) + 1));
      await waitFor(() => text(q(h, '.st-fb__text')) === 'Correct', 'a right answer');
      await waitFor(() => !btn(h, 'Next')!.disabled, 'Next enabled');
      key(h, 'Enter');
      await cardLeft(h);
    }
    const plans: Array<'all' | 'two' | 'partial'> = ['all', 'two', 'partial'];
    for (const plan of plans) {
      const c = q(h, '.st-card')!;
      expect(c.dataset.format).toBe('short');
      const qr = currentQuestion(h);
      const rubric = JSON.parse(qr.rubric_json);
      expect(rubric.length).toBe(3);
      expect(qa(q(h, '.st-ta__hint'), 'span').map(text)).toEqual(['Graded against 3 points from the source.', 'Enter to check · Shift+Enter for a new line']);
      expect(text(q(btn(h, 'Check'), '.px-btn__label'))).toBe('Check');
      const field = q<HTMLTextAreaElement>(h, 'textarea.st-ta__field')!;
      field.value = typedAnswer(rubric, plan);
      key(h, '1', field); // a digit typed into the field is text, not a choice
      key(h, 'Enter', field);
      await waitFor(() => q(h, '.st-rub'), 'the verdict points');
      const statuses = rubric.map((p: AnyRec) => gradePoint(p.text, field.value));
      const verdict = { points: statuses.map((s: string) => ({ status: s })), contradiction: false };
      const rating = T.stMapVerdictToRating(verdict, rubric);
      const pts = qa(h, '.st-rub__pt');
      expect(pts.map((p) => p.className)).toEqual(statuses.map((s: string) => `st-rub__pt st-rub__pt--${s}`));
      expect(pts.map((p) => p.style.getPropertyValue('--st-i'))).toEqual(['0', '1', '2']);
      expect(qa(h, '.st-rub__req').length).toBe(2);
      expect(text(q(h, '.st-fb__text'))).toBe(T.stVerdictLabel(verdict, rubric));
      expect(text(q(h, '.st-fb__grade'))).toBe(`· counts as ${T.stRatingWord(rating)}`);
      // Nothing said twice: a note that only restates the missed point is left out.
      const short = statuses.filter((st: string) => st !== 'hit').length;
      expect(text(q(h, '.st-fb__why'))).toBe(short > 1 ? 'A point from the text is missing.' : '');
      expect(q(h, '.st-fb__why') === null).toBe(short <= 1);
      expect(q(h, '.st-fb')!.classList.contains(rating >= 3 ? 'st-fb--ok' : 'st-fb--no')).toBe(true);
      expect(text(q(h, '.st-full summary'))).toBe('Full answer');
      expect(q<HTMLDetailsElement>(h, 'details.st-full')!.open).toBe(false);
      await waitFor(() => text(q(btn(h, 'Next'), '.px-btn__label')) === 'Next' && !btn(h, 'Next')!.disabled, 'Next');
      const it = one('SELECT * FROM st_session_items WHERE session_id = ? AND question_id = ?', sessionId, qr.id);
      expect(it).toMatchObject({ status: rating >= 3 ? 'right' : 'wrong', typed: field.value, format_used: 'short' });
      expect(JSON.parse(it.verdict_json).points.map((p: AnyRec) => p.status)).toEqual(statuses);
      key(h, 'Enter');
      await cardLeft(h);
    }
    // Grading calls: the rubric, the quote and the answer, as JSON at temperature 0.
    const grades = env.lmCalls.filter((c) => c.kind === 'grade');
    expect(grades.length).toBe(3);
    for (const g of grades) { expect(g.format).toBe('json'); expect(g.temperature).toBe(0); expect(g.user).toContain('Points to mark, in order:'); }

    // End of draw: results; the stored answers and the concepts are exactly what the model says.
    await waitFor(() => q(h, '.st-res'), 'results');
    expect(one('SELECT finished_at FROM st_sessions WHERE id = ?', sessionId).finished_at).toBeGreaterThan(0);
    expect(one('SELECT position FROM st_sessions WHERE id = ?', sessionId).position).toBe(6);
    const answers = all('SELECT * FROM st_answers ORDER BY id');
    expect(answers.length).toBe(7);
    expect(answers.filter((a) => a.retried).length).toBe(1);
    const predicted = predictConcepts(pre);
    for (const c of all('SELECT * FROM st_concepts')) {
      const p = predicted.get(c.id)!;
      expect(c.mastery).toBeCloseTo(p.mastery, 10);
      expect([c.answers, c.misses, c.miss_streak, c.right_choose_at, c.right_type_at, c.last_answered_at])
        .toEqual([p.answers, p.misses, p.missStreak, p.rightChooseAt, p.rightTypeAt, p.lastAnsweredAt]);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5. Results
  // ═════════════════════════════════════════════════════════════════════════

  it('5. results: the score, coverage, missed rows; Send Missed sends the draw\'s misses; a rated card lowers mastery; Refresh draws again', async () => {
    await boot();
    const { h, sessionId } = await startChapterSession();
    await answerDraw(h, { wrongFirstMc: true });
    await waitFor(() => q(h, '.st-res'), 'results');

    const ch3 = one('SELECT id FROM st_sections WHERE title = ?', CH3).id;
    const items = all('SELECT i.*, q.concept_id FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ? ORDER BY i.ord', sessionId);
    const rightN = items.filter((i) => i.status === 'right').length;
    const missed = items.filter((i) => i.status === 'wrong');
    expect(missed.length).toBeGreaterThanOrEqual(1);
    const now = Date.now();
    const toConcept = (r: AnyRec) => ({ id: r.id, materialId: r.material_id, sectionId: r.section_id, title: r.title, mastery: r.mastery, answers: r.answers, misses: r.misses, missStreak: r.miss_streak, rightChooseAt: r.right_choose_at, rightTypeAt: r.right_type_at, lastAnsweredAt: r.last_answered_at, page: r.page });
    const scopeConcepts = all('SELECT * FROM st_concepts WHERE section_id = ? ORDER BY material_id, section_id, ord, id', ch3).map(toConcept);
    const cov = T.stCoverage(scopeConcepts, now, { staleDays: 14 });

    expect(q(h, '.st-res__big')!.firstChild!.textContent).toBe(String(rightN));
    expect(text(q(h, '.st-res__big small'))).toBe('of 6');
    expect(text(q(h, '.st-res__under'))).toBe(`${label1()} · ${CH3} is ${cov.clean} of ${cov.total} concepts clean · ${cov.total - cov.clean} to go`);
    const cls = (s: string) => (s === 'clean' ? 'c just' : s === 'weak' ? 'w' : 'n');
    expect(qa(h, '.st-cov i').map((i) => i.className)).toEqual(cov.states.map(cls));
    expect(text(q(h, '.st-missed .px-section-label'))).toBe('Missed this session');
    const rows = qa(h, '.st-mrow');
    expect(rows.length).toBe(missed.length);
    const titleOf = (id: number) => scopeConcepts.find((c: AnyRec) => c.id === id)!.title;
    expect(rows.map((r) => text(q(r, '.st-mrow__c'))).every((t, i) => t.startsWith(titleOf(missed[i].concept_id)))).toBe(true);
    expect(text(q(h, '.st-res__lhs'))).toBe('Refresh draws the next 6, weak concepts first.');
    expect(btn(h, 'Review Answers')).not.toBeNull();

    // Send Missed: one card per missed concept of this draw, into the material's deck.
    const send = btn(h, 'Send Missed to Flashcards')!;
    expect(send).not.toBeNull();
    expect(text(q(send, '.px-btn__label'))).toBe('Send Missed to Flashcards');
    expect(text(q(send, '.st-faint'))).toBe(`· ${missed.length}`);
    send.click();
    const missedConcepts = [...new Set(missed.map((m) => m.concept_id))];
    await waitFor(() => env.calls.addCards.length === 1, 'flashcards.addCards');
    const payload = env.calls.addCards[0];
    expect(payload.deckName).toBe(`Study: ${label1()}`);
    expect(payload.cards.map((c: AnyRec) => c.tags)).toEqual(missedConcepts.map((id) => ['study', `study:c:${id}`]));
    for (const c of payload.cards) {
      const conceptId = Number(c.tags[1].split(':')[2]);
      const row = one('SELECT * FROM st_concepts WHERE id = ?', conceptId);
      expect(c).toMatchObject({ back: row.summary, sourcePage: row.page, sourceExcerpt: row.anchor_quote, recallMode: 'conceptual', sourceLabel: label1(), sourceUri: MAT1_URI });
      expect(c.front).toContain(row.title);
    }
    await waitFor(() => env.calls.info.includes(`${missedConcepts.length} ${missedConcepts.length === 1 ? 'card' : 'cards'} sent to Flashcards.`), 'the confirmation');

    // A card rated Again in Flashcards halves that concept's mastery.
    const target = all('SELECT * FROM st_concepts WHERE id IN (' + missedConcepts.join(',') + ') ORDER BY mastery DESC')[0];
    expect(target.mastery).toBeGreaterThan(0);
    document.dispatchEvent(new CustomEvent('parallx:card-rated', { detail: { toolId: 'parallx-community.flashcards', cardId: 1, rating: 1, tags: ['study', `study:c:${target.id}`] } }));
    await waitFor(() => Math.abs(one('SELECT mastery FROM st_concepts WHERE id = ?', target.id).mastery - target.mastery * 0.5) < 1e-12, 'mastery halved');

    // Refresh: draw 1. The chapter's unasked questions come first; the bank
    // is then used up (every concept has its quota), so the draw is filled
    // with this session's questions, the missed ones first, none twice.
    const drawn0 = new Set(items.map((i) => i.question_id));
    btn(h, 'Refresh')!.click();
    await waitFor(() => q(h, '.st-card') && one('SELECT COUNT(*) AS n FROM st_session_items WHERE session_id = ? AND draw = 1', sessionId).n > 0, 'the second draw');
    expect(one('SELECT refreshes, finished_at FROM st_sessions WHERE id = ?', sessionId)).toEqual({ refreshes: 1, finished_at: 0 });
    const draw1 = all('SELECT * FROM st_session_items WHERE session_id = ? AND draw = 1 ORDER BY ord', sessionId);
    expect(draw1).toHaveLength(6);
    const fresh1 = draw1.filter((i) => !drawn0.has(i.question_id));
    expect(fresh1.length).toBeGreaterThan(0);
    expect(fresh1.length).toBeLessThan(6);
    expect(draw1.slice(0, fresh1.length)).toEqual(fresh1);
    expect(new Set(draw1.map((i) => i.question_id)).size).toBe(6);
    const num = (a: number[]) => [...a].sort((x, y) => x - y);
    const wrong0 = missed.map((i) => i.question_id);
    expect(num(draw1.slice(fresh1.length, fresh1.length + wrong0.length).map((i) => i.question_id))).toEqual(num(wrong0));
    // Answered wrong before retried: the plain miss leads the repeats.
    const plain = missed.filter((i) => !i.retried).map((i) => i.question_id);
    if (plain.length && plain.length < wrong0.length) expect(plain).toContain(draw1[fresh1.length].question_id);
    expect(draw1[0].ord).toBe(6);
    expect(qa(h, '.st-strand i').length).toBe(draw1.length);
    expect(qa(h, '.st-strand i')[0].className).toBe('cur');
    expect(drawn0.has(currentQuestion(h).id)).toBe(false);

    // Draw 1 answered all wrong: Send Missed sends only this draw's misses (bug 7).
    await answerDraw(h, { mcWrong: true, typedPlans: ['none'] });
    await waitFor(() => q(h, '.st-res'), 'results of draw 1');
    const missed1 = all("SELECT DISTINCT q.concept_id FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ? AND i.draw = 1 AND i.status = 'wrong'", sessionId).map((r) => r.concept_id);
    expect(missed1.length).toBeGreaterThan(0);
    expect(text(q(h, '.st-res__big small'))).toBe(`of ${draw1.length}`);
    // Said once, on the under line: the next Refresh repeats.
    expect(text(q(h, '.st-res__under'))).toMatch(/ · 1 refresh so far · Every question here has been asked; Refresh repeats the ones you missed first\.$/);
    expect(text(q(h, '.st-res__lhs'))).toBe('');
    // One row per missed concept; a concept missed twice in the draw says so.
    const wrong1 = all("SELECT q.concept_id FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ? AND i.draw = 1 AND i.status = 'wrong'", sessionId).map((r) => r.concept_id);
    const rows1 = qa(h, '.st-mrow');
    expect(rows1.length).toBe(missed1.length);
    expect(wrong1.length).toBeGreaterThan(missed1.length);
    const times = (id: number) => wrong1.filter((x) => x === id).length;
    for (const r of rows1) {
      const c = all('SELECT * FROM st_concepts').find((x: AnyRec) => text(q(r, '.st-mrow__c')).startsWith(x.title))!;
      const n = times(c.id);
      expect(text(q(r, '.st-mrow__st'))).toBe(n === 2 ? 'missed twice' : n > 2 ? `missed ${n} times` : c.miss_streak > n ? 'second miss' : 'weak');
    }
    expect(text(q(btn(h, 'Send Missed to Flashcards'), '.st-faint'))).toBe(`· ${rows1.length}`);
    // Past the ten-second Flashcards check cache.
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 60_000);
    btn(h, 'Send Missed to Flashcards')!.click();
    await waitFor(() => env.calls.addCards.length === 2, 'the second send');
    expect(env.calls.addCards[1].cards.map((c: AnyRec) => c.tags[1]).sort()).toEqual(missed1.map((id) => `study:c:${id}`).sort());
  });

  it('5b. without flashcards.addCards there is no Send Missed; Refresh stays', async () => {
    env.flashcardsOn = false;
    await boot();
    const { h } = await startChapterSession();
    env.confirm = true;
    key(h, 'Escape');
    await waitFor(() => q(h, '.st-res'), 'results');
    expect(env.calls.confirms.at(-1)).toMatchObject({ message: 'End this session?', confirmLabel: 'End Session' });
    expect(btn(h, 'Send Missed to Flashcards')).toBeNull();
    expect(btn(h, 'Refresh')).not.toBeNull();
    expect(text(q(h, '.st-res__big small'))).toBe('of 6');
    expect(q(h, '.st-res__big')!.firstChild!.textContent).toBe('0');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6. Sidebar, a second material, Study Together
  // ═════════════════════════════════════════════════════════════════════════

  it('6. sidebar: open sessions with the live dot and position; Add Material; Select Materials and Study Together interleave materials', async () => {
    await boot();
    const sb = mountSidebar();
    const s1 = await startChapterSession();

    // The open session: live dot, position, and it moves with each answer.
    await waitFor(() => qa(sb, '.st-sb__it--session').length === 1, 'the session row');
    const row = () => qa(sb, '.st-sb__it--session')[0];
    expect(q(row(), '.st-sb__live')).not.toBeNull();
    expect(text(q(row(), '.st-sb__nm'))).toBe(`${label1()} · ${CH3} · Practice`);
    expect(text(q(row(), '.st-sb__r'))).toBe('0 / 6');
    const qr = currentQuestion(s1.h);
    key(s1.h, String(Number(qr.answer) + 1));
    await waitFor(() => text(q(row(), '.st-sb__r')) === '1 / 6', 'the position');
    await waitFor(() => qa(sb, '.st-sb__it--sub').length === 3, 'chapter rows');
    const subs = qa(sb, '.st-sb__it--sub');
    expect(text(q(subs[2], '.st-sb__r'))).toMatch(/^\d+ \/ 4$/);
    expect(text(q(subs[0], '.st-sb__r'))).toBe('no bank');

    // A second material through Add Material: the quick pick lists the workspace PDFs.
    env.pick = (items) => items.find((i) => i.label === 'Hurlimann_2009.pdf');
    await exec('study.addMaterial');
    const pick = env.calls.quickPicks.at(-1);
    expect(pick.items.map((i: AnyRec) => i.label).sort()).toEqual(['Clark_2003_Mack_1994.pdf', 'Exam7_Fall2019_Report.pdf', 'Hurlimann_2009.pdf']);
    const m2 = one('SELECT * FROM st_materials WHERE uri = ?', 'file:///ws/readings/Hurlimann_2009.pdf');
    expect(m2).toMatchObject({ kind: 'pdf', page_count: 4 });
    // Headings, with "(continued)" folded into its chapter (bug 5).
    expect(all('SELECT title, page_from, page_to FROM st_sections WHERE material_id = ? ORDER BY ord', m2.id)).toEqual([
      { title: '1. Credible Loss Ratio Reserves', page_from: 1, page_to: 2 },
      { title: '2. Optimal Credibility', page_from: 3, page_to: 4 },
    ]);
    const setup2 = await waitFor(() => paneHost('setup'), 'setup for the second material');
    await waitFor(() => text(q(setup2, '.st-sheet__sub')) === m2.label, 'its sheet');
    await waitFor(() => text(q(setup2, '.st-sheet__count')), 'its count');
    const s2 = await startFromSetup(setup2);
    expect(JSON.parse(one('SELECT scope_json FROM st_sessions WHERE id = ?', s2.sessionId).scope_json)).toMatchObject({ kind: 'document', materialIds: [m2.id] });
    expect(all('SELECT DISTINCT q.material_id FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ?', s2.sessionId).map((r) => r.material_id)).toEqual([m2.id]);

    // Two open sessions, newest first.
    await waitFor(() => qa(sb, '.st-sb__it--session').length === 2, 'two session rows');
    expect(text(q(sb, '.st-sb__sec--sessions .px-section-label'))).toContain('2 open');
    expect(qa(sb, '.st-sb__it--session').every((r) => q(r, '.st-sb__live'))).toBe(true);

    // A session row focuses its tab.
    const s1Row = qa(sb, '.st-sb__it--session').find((r) => r.dataset.sessionId === String(s1.sessionId))!;
    s1Row.click();
    await waitFor(() => env.calls.focusEditor.at(-1) === `parallx-community.study:study:session-${s1.sessionId}`, 'focus');

    // Select Materials: checks; the pick bar; Study Together.
    q<HTMLButtonElement>(sb, 'button[title="Select Materials"]')!.click();
    await waitFor(() => qa(sb, '.st-sb__ck').length === 2, 'checks');
    expect(btn(sb, 'Study Together')!.disabled).toBe(true);
    qa(sb, '.st-sb__it--material')[0].click();
    await waitFor(() => qa(sb, '.st-sb__ck--on').length === 1, 'one picked');
    qa(sb, '.st-sb__it--material').find((r) => !r.querySelector('.st-sb__ck--on'))!.click();
    await waitFor(() => text(q(sb, '.st-sb__bar b')) === '2 materials', 'two picked');
    expect(T.stPicked().sort()).toEqual([1, m2.id].sort());
    btn(sb, 'Study Together')!.click();
    const together = await waitFor(() => paneHost('setup'), 'the Materials sheet');
    await waitFor(() => text(q(together, '.st-sheet__sub')) === '2 materials', 'the sheet sub');
    await waitFor(() => text(q(together, '.st-sheet__count')), 'its count');
    expect(text(q(together, '.ui-segmented-control__segment--active'))).toBe('Materials');
    expect(qa(together, '.st-outline__o').map((r) => r.dataset.materialId).sort()).toEqual([String(1), String(m2.id)].sort());

    const s3 = await startFromSetup(together);
    const scope3 = JSON.parse(one('SELECT scope_json FROM st_sessions WHERE id = ?', s3.sessionId).scope_json);
    expect(scope3.kind).toBe('materials');
    expect([...scope3.materialIds].sort()).toEqual([1, m2.id].sort());
    const mats = all('SELECT q.material_id FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ? ORDER BY i.ord', s3.sessionId).map((r) => r.material_id);
    expect(mats.length).toBe(6);
    expect(new Set(mats).size).toBe(2);
    for (let i = 0; i + 1 < mats.length; i++) {
      if (mats[i] !== mats[i + 1]) continue;
      // Allowed only when the other material has nothing left after i.
      expect(mats.slice(i + 1).every((m) => m === mats[i])).toBe(true);
    }
    // The eyebrow names the material first in a session over several.
    expect([label1(), m2.label].some((l) => text(q(s3.h, '.st-eyebrow__src')).startsWith(l.slice(0, 12)))).toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7. Learn
  // ═════════════════════════════════════════════════════════════════════════

  it('7. Learn lists the chapter concepts with page links; Practice This Chapter opens setup', async () => {
    await boot();
    await startChapterSession();
    const setup = await openChapterSetup();
    const ch3 = one('SELECT id FROM st_sections WHERE title = ?', CH3).id;
    q<HTMLButtonElement>(setup, '.ui-segmented-control__segment[data-value="learn"]')!.click();
    await waitFor(() => btn(setup, 'Start') && !btn(setup, 'Make Questions'), 'the Learn start');
    btn(setup, 'Start')!.click();
    const id = `learn-1-${ch3}`;
    const h = await waitFor(() => paneHost(id), 'the Learn tab');
    expect(env.calls.openEditor.at(-1)).toMatchObject({ instanceId: id, title: `Learn · ${CH3}` });
    await waitFor(() => qa(h, '.st-learn__pt').length === 4, 'the concepts');
    expect(paneHost('setup')).toBeNull();
    expect(text(q(h, '.st-learn__h'))).toBe(CH3);
    expect(qa(q(h, '.st-eyebrow'), 'span').map(text).filter(Boolean)).toEqual([`${label1()} · chapter 3`, 'pp. 13–16 · 4 concepts']);
    const pts = qa(h, '.st-learn__pt');
    expect(pts.map((p) => text(q(p, 'b')))).toEqual(CH3_TITLES);
    expect(pts.map((p) => text(q(p, '.st-learn__pg')))).toEqual(['p. 13', 'p. 14', 'p. 15', 'p. 16']);
    q<HTMLButtonElement>(pts[1], '.st-learn__pg')!.click();
    await waitFor(() => env.calls.openFileEditor.length === 1, 'the page');
    expect(env.calls.openFileEditor[0]).toEqual({ uri: MAT1_URI, options: { reveal: { page: 14, quote: CONCEPTS[1].quote }, side: true } });
    expect(text(q(h, '.st-learn__ft'))).toContain('4 concepts');
    btn(h, 'Practice This Chapter')!.click();
    const again = await waitFor(() => paneHost('setup'), 'setup');
    await waitFor(() => q(again, '.st-outline__o--on'), 'the chapter');
    expect(q(again, '.st-outline__o--on')!.dataset.sectionId).toBe(String(ch3));
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 8. Imports
  // ═════════════════════════════════════════════════════════════════════════

  it('8. Import Questions and Import Examiner\'s Report: imported questions, then the report\'s rubric on the matching one', async () => {
    await boot();
    env.pick = (items) => items.find((i) => i.label === 'questions.md');
    const res = await exec('study.importQuestions');
    expect(env.calls.quickPicks.at(-1).items.map((i: AnyRec) => i.label)).toEqual(['questions.md']);
    expect(res.inserted).toBe(2);
    expect(env.calls.info.at(-1)).toBe('Imported 2 questions.');
    const fileBank = one("SELECT * FROM st_banks WHERE kind = 'file'");
    expect(fileBank).toMatchObject({ name: 'questions', path: QFILE, count: 2 });
    const imported = all("SELECT * FROM st_questions WHERE origin = 'imported' ORDER BY id");
    expect(imported.map((r) => [r.format, r.origin_label, r.bank_id, r.material_id, r.source_uri])).toEqual([
      ['essay', 'CAS Exam 7 · 2019 Fall · Q5', fileBank.id, 0, 'file:///ws/banks/questions.md'],
      ['essay', 'CAS Exam 7 · 2018 Spring · Q3', fileBank.id, 0, 'file:///ws/banks/questions.md'],
    ]);
    expect(imported[0].stem).toBe('Explain why the Cape Cod method has a lower parameter variance than the LDF method.');
    // The match keys are stored, not only printed in the label (bug 9).
    const ref = JSON.parse(imported[0].provider_ref || '{}');
    expect(ref.exam).toBe('CAS Exam 7');
    expect(ref.sitting).toBe('2019 Fall');
    expect(String(ref.number)).toBe('5');

    env.pick = (items) => items.find((i) => i.label === 'Exam7_Fall2019_Report.pdf');
    const rep = await exec('study.importReport');
    expect(env.calls.extract.at(-1)).toBe(REPORT);
    // Curly apostrophes and a "q1 =" line do not break the entries (bug 8).
    expect(rep.matched).toBe(1);
    expect(rep.unmatched).toBe(1);
    expect(env.calls.info.at(-1)).toBe('Matched 1 question; 1 entry had no question.');
    const reportBank = one("SELECT * FROM st_banks WHERE kind = 'report'");
    expect(reportBank).toMatchObject({ exam: 'CAS Exam 7', sitting: '2019 Fall', count: 2 });
    const q5 = one('SELECT * FROM st_questions WHERE id = ?', imported[0].id);
    expect(q5.rubric_origin).toBe('report');
    expect(JSON.parse(q5.rubric_json)).toEqual([
      { text: 'The Cape Cod method estimates fewer parameters than the LDF method.', required: true },
      { text: 'It uses one expected loss ratio for every accident year.', required: true },
      { text: 'Fewer parameters give a lower parameter variance.', required: true },
    ]);
    expect(JSON.parse(q5.contradictions_json)).toEqual([
      'Some candidates said the Cape Cod method uses fewer data points.',
      'That is not the reason for the lower variance.',
      'q1 = 0.65',
    ]);
    expect(q5.source_uri).toBe('file:///ws/reports/Exam7_Fall2019_Report.pdf');
    expect(q5.source_page).toBe(2);
    const q3 = one('SELECT * FROM st_questions WHERE id = ?', imported[1].id);
    expect(q3.rubric_origin).toBe('');
    expect(JSON.parse(q3.rubric_json)).toEqual([]);
    const rubricCalls = env.lmCalls.filter((c) => c.kind === 'rubric');
    expect(rubricCalls.length).toBe(1);
    expect(rubricCalls[0]).toMatchObject({ format: 'json' });
  });

  it('8b. a question bank is studiable: its sidebar row opens setup on the bank, and the session draws its questions', async () => {
    await boot();
    env.pick = (items) => items.find((i) => i.label === 'questions.md');
    await exec('study.importQuestions');
    const bankId = one("SELECT id FROM st_banks WHERE kind = 'file'").id;
    const sb = mountSidebar();
    await waitFor(() => q(sb, '.st-sb__sec--banks .px-section-label'), 'the banks section');
    q<HTMLElement>(sb, '.st-sb__sec--banks .px-section-label')!.click();
    await waitFor(() => qa(sb, '.st-sb__it--bank').length === 2, 'bank rows');
    qa(sb, '.st-sb__it--bank').find((r) => r.dataset.bankId === String(bankId))!.click();
    const setup = await waitFor(() => paneHost('setup'), 'setup on the bank');
    await waitFor(() => text(q(setup, '.st-sheet__count')), 'the count');
    const { h, sessionId } = await startFromSetup(setup);
    const scope = JSON.parse(one('SELECT scope_json FROM st_sessions WHERE id = ?', sessionId).scope_json);
    expect(scope).toMatchObject({ kind: 'bank', bankIds: [bankId], materialIds: [] });
    const drawn = all('SELECT q.bank_id, q.origin FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ?', sessionId);
    expect(drawn.length).toBe(2);
    expect(drawn.every((r) => r.bank_id === bankId && r.origin === 'imported')).toBe(true);
    expect(q(h, '.st-card')!.dataset.format).toBe('essay');
    expect(text(q(h, '.st-eyebrow__cpt'))).toMatch(/^CAS Exam 7 · 201\d (Fall|Spring) · Q\d$/);

    // A bank question has no anchor: its feedback shows none, and Show
    // Source opens the question file at the question's own line.
    const cur = currentQuestion(h);
    const field = q<HTMLTextAreaElement>(h, '.st-ta textarea, .st-ta input')!;
    field.value = typedAnswer([{ text: cur.answer }], 'all');
    key(h, 'Enter', field);
    await waitFor(() => q(h, '.st-fb--show'), 'feedback');
    expect(q(h, '.st-fb--show .st-quote')).toBeNull();
    // Its rubric, reduced from the answer, is all required: no point says so.
    expect(qa(h, '.st-rub__pt').length).toBeGreaterThan(0);
    expect(qa(h, '.st-rub__req').length).toBe(0);
    expect(qa(h, '.st-fb__acts button').map(text)).toEqual(['Show Source', 'Explain']);
    btn(h, 'Show Source')!.click();
    await waitFor(() => env.calls.openFileEditor.length === 1, 'the question file');
    const line = QUESTIONS_MD.split('\n').findIndex((l) => l === `Q: ${cur.stem}`) + 1;
    expect(line).toBeGreaterThan(0);
    expect(env.calls.openFileEditor[0]).toEqual({ uri: 'file:///ws/banks/questions.md', options: { reveal: { line }, side: true } });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 9. Hide This Question
  // ═════════════════════════════════════════════════════════════════════════

  it('9. Hide This Question asks the reason, records it, and keeps the question out of the next draw', async () => {
    await boot();
    const { h, sessionId } = await startChapterSession();
    const hidden = currentQuestion(h);
    env.pick = (items) => items.find((i) => i.label === 'Ambiguous');
    q<HTMLButtonElement>(h, 'button[title^="Hide This Question"]')!.click();
    await cardLeft(h);
    const pickCall = env.calls.quickPicks.at(-1);
    expect(pickCall.items.map((i: AnyRec) => i.label)).toEqual(['Wrong answer', 'Not in the text', 'Ambiguous', 'Other']);
    expect(all('SELECT question_id, reason FROM st_feedback')).toEqual([{ question_id: hidden.id, reason: 'Ambiguous' }]);
    expect(one('SELECT hidden FROM st_questions WHERE id = ?', hidden.id).hidden).toBe(1);
    expect(one('SELECT status FROM st_session_items WHERE session_id = ? AND question_id = ?', sessionId, hidden.id).status).toBe('skipped');
    expect(currentQuestion(h).id).not.toBe(hidden.id);

    // End it, and start the chapter again: the hidden question is not drawn.
    env.confirm = true;
    key(h, 'Escape');
    await waitFor(() => q(h, '.st-res'), 'results');
    const setup = await openChapterSetup();
    expect(text(q(setup, '.st-sheet__count'))).toMatch(/5 questions in the bank, 1 more will be made first/);
    const next = await startFromSetup(setup);
    const ids = all('SELECT question_id FROM st_session_items WHERE session_id = ?', next.sessionId).map((r) => r.question_id);
    expect(ids.length).toBe(6);
    expect(ids).not.toContain(hidden.id);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 10. Keys
  // ═════════════════════════════════════════════════════════════════════════

  it('10. keys: 1–5 choose, Enter checks or moves on, S source, R retry, E explain, K skip, Esc closes the source then asks to end', async () => {
    await boot();
    const { h, sessionId } = await startChapterSession();
    const items = all('SELECT * FROM st_session_items WHERE session_id = ? ORDER BY ord', sessionId);

    // E and R do nothing before an answer; Enter on an unanswered choice does nothing.
    key(h, 'e');
    key(h, 'r');
    key(h, 'Enter');
    await settle();
    expect(q(h, '.st-explain')).toBeNull();
    expect(q(h, '.st-fb--show')).toBeNull();

    // K skips to the end of the draw.
    const firstQ = currentQuestion(h);
    expect(firstQ.id).toBe(items[0].question_id);
    key(h, 'k');
    await cardLeft(h);
    expect(currentQuestion(h).id).toBe(items[1].question_id);
    expect(qa(h, '.st-strand i').map((i) => i.className)).toEqual(['', 'cur', '', '', '', '']);

    // 5 is no option of four; a wrong digit marks the rows.
    const cur = currentQuestion(h);
    const right = Number(cur.answer);
    key(h, '5');
    await settle();
    expect(q(h, '.st-opts')!.classList.contains('st-opts--done')).toBe(false);
    key(h, String(((right + 2) % 4) + 1));
    await waitFor(() => q(h, '.st-fb--show'), 'feedback');
    expect(qa(h, '.st-opt')[(right + 2) % 4].classList.contains('st-opt--wrong')).toBe(true);

    // S opens the source; the first Esc closes it, asking nothing.
    key(h, 's');
    await waitFor(() => env.calls.openFileEditor.length === 1, 'the source');
    expect(env.calls.openFileEditor[0].options).toMatchObject({ side: true, reveal: { page: cur.source_page } });
    key(h, 'Escape');
    await settle();
    expect(env.calls.confirms.length).toBe(0);

    // E explains; R retries once; the right digit counts as Again.
    key(h, 'e');
    await waitFor(() => text(q(h, '.st-explain')) === EXPLANATION, 'the explanation');
    key(h, 'r');
    expect(q(h, '.st-opts')!.classList.contains('st-opts--done')).toBe(false);
    key(h, 'r'); // once only
    key(h, String(right + 1));
    await waitFor(() => text(q(h, '.st-fb__grade')) === '· counts as Again', 'Again');
    await waitFor(() => !btn(h, 'Next')!.disabled, 'Next');
    key(h, 'Enter');
    await cardLeft(h);
    expect(currentQuestion(h).id).toBe(items[2].question_id);

    // The third card by key, Enter on: the fourth is typed.
    const third = currentQuestion(h);
    key(h, String(Number(third.answer) + 1));
    await waitFor(() => text(q(h, '.st-fb__text')) === 'Correct', 'right');
    await waitFor(() => !btn(h, 'Next')!.disabled, 'Next');
    key(h, 'Enter');
    await cardLeft(h);
    expect(q(h, '.st-card')!.dataset.format).toBe('short');
    const field = q<HTMLTextAreaElement>(h, 'textarea.st-ta__field')!;
    key(h, 'k', field); // typing a k is text
    await settle();
    expect(currentQuestion(h).id).toBe(items[3].question_id);
    field.value = typedAnswer(JSON.parse(currentQuestion(h).rubric_json), 'all');
    key(h, 'Enter', field);
    await waitFor(() => text(q(h, '.st-fb__text')) === 'Complete', 'the verdict');
    expect(text(q(h, '.st-fb__grade'))).toBe('· counts as Easy');

    // Esc with no source open asks to end; declined, the session stays.
    env.confirm = false;
    key(h, 'Escape');
    await waitFor(() => env.calls.confirms.length === 1, 'the confirm');
    expect(env.calls.confirms[0]).toMatchObject({ message: 'End this session?', confirmLabel: 'End Session' });
    await settle();
    expect(q(h, '.st-res')).toBeNull();
    expect(q(h, '.st-card')).not.toBeNull();
    expect(one('SELECT finished_at FROM st_sessions WHERE id = ?', sessionId).finished_at).toBe(0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 11. Quiz This Selection
  // ═════════════════════════════════════════════════════════════════════════

  it('11. Quiz This Selection maps the selected passage, makes questions sourced to it and opens a Practice session on them, with no sheet', async () => {
    await boot();
    const action = env.selectionHandlers.find((hd) => hd.actionId === 'quiz-selection')!;
    /** A page's text without its heading line: what a reader selects. */
    const bodyOf = (page: number) => CLARK_PAGES[page - 1].split('\n').slice(1).join('\n');
    const payload = (selectedText: string, pageNumber: number) => ({
      selectedText, surface: 'pdf', actionId: 'quiz-selection',
      source: { fileName: 'Clark_2003_Mack_1994.pdf', filePath: MAT1, pageNumber },
    });

    // From the palette (no selection), or a few words: a line saying what to do, nothing made.
    await exec('study.quizSelection');
    expect(env.calls.info.at(-1)).toBe('Select text in a PDF or a page, then choose Quiz This Selection.');
    await action.execute(payload('Mack derives', 16));
    expect(env.calls.info.at(-1)).toBe('Select a little more text to quiz on.');
    expect(env.calls.extract).toEqual([]);
    expect(one('SELECT COUNT(*) AS n FROM st_sessions').n).toBe(0);

    // The passage on page 16: straight into a session over it, through the generating screen.
    const hold = holdLm('questions');
    await action.execute(payload(bodyOf(16), 16));
    const tab = await waitFor(() => latestSessionTab(), 'the session tab');
    const sessionId = Number(tab.slice('session-'.length));
    const h = paneHost(tab)!;
    expect(env.calls.openEditor.map((o: AnyRec) => o.instanceId)).not.toContain('setup');
    expect(env.calls.extract).toEqual([MAT1]);
    await waitFor(() => hold.reached, 'the question call');
    const label = `${label1()} · p. 16`;
    await waitFor(() => text(q(h, '.st-gen__t')) === `Making questions for ${label}`, 'the generating screen');
    hold.release();
    await waitFor(() => q(h, '.st-card'), 'the first card');

    // One map call, over the selected passage alone.
    const maps = env.lmCalls.filter((c) => c.kind === 'map');
    expect(maps.length).toBe(1);
    expect(maps[0].user).toContain(`[Page 16]\n${bodyOf(16)}`);
    expect(maps[0].user).not.toContain(bodyOf(15));
    const concepts = all('SELECT * FROM st_concepts');
    expect(concepts.map((c) => [c.title, c.page, c.anchor_quote])).toEqual([[CONCEPTS[3].title, 16, CONCEPTS[3].quote]]);

    // The session: Practice in the saved default format, scoped to the passage like the sheet's Selection.
    const session = one('SELECT * FROM st_sessions WHERE id = ?', sessionId);
    expect(session).toMatchObject({ mode: 'practice', answer_format: 'mixed', finished_at: 0, name: label });
    expect(JSON.parse(session.scope_json)).toEqual({
      kind: 'selection', materialIds: [1], selectionText: bodyOf(16), selectionPage: 16,
      pageFrom: 16, pageTo: 16, label, conceptIds: [concepts[0].id],
    });

    // Its questions: written for that concept only, every one sourced inside the selection.
    for (const c of env.lmCalls.filter((x) => x.kind === 'questions')) {
      expect([...c.user.matchAll(/^- id \d+: (.+?)\. .*Write: /gm)].map((m) => m[1])).toEqual([CONCEPTS[3].title]);
    }
    const made = all("SELECT * FROM st_questions WHERE origin = 'generated' ORDER BY id");
    expect(made.map((r) => r.format).sort()).toEqual(['mc', 'short']);
    for (const r of made) {
      expect(r.concept_id).toBe(concepts[0].id);
      expect(r.source_page).toBe(16);
      expect(bodyOf(16)).toContain(r.source_quote);
    }
    const items = all('SELECT * FROM st_session_items WHERE session_id = ? ORDER BY ord', sessionId);
    expect(items.map((i) => i.question_id).sort()).toEqual(made.map((r) => r.id).sort());

    // What the card shows.
    expect(text(q(h, '.st-sess-tb__scope'))).toBe(`${label} · Practice · Mixed`);
    expect(qa(h, '.st-strand i').length).toBe(2);
    expect(text(q(h, '.st-eyebrow__cpt'))).toBe(CONCEPTS[3].title);
    await answerDraw(h);
    await waitFor(() => q(h, '.st-res'), 'results');
    expect(text(q(h, '.st-res__big small'))).toBe('of 2');
    expect(text(q(h, '.st-res__under')).startsWith(`${label} is `)).toBe(true);
    expect(text(q(h, '.st-res__under'))).toMatch(/ is \d of 1 concepts clean · /);
    expect(qa(h, '.st-cov i').length).toBe(1);

    // A second passage, page 15: its own concept and session, and its results
    // count that passage, not every concept the document now has.
    await action.execute(payload(bodyOf(15), 15));
    const tab2 = await waitFor(() => { const t = latestSessionTab(); return t && t !== tab ? t : null; }, 'the second session tab');
    const sessionId2 = Number(tab2.slice('session-'.length));
    const h2 = paneHost(tab2)!;
    await waitFor(() => q(h2, '.st-card'), 'its first card');
    expect(text(q(h2, '.st-sess-tb__scope'))).toBe(`${label1()} · p. 15 · Practice · Mixed`);
    const c15 = one('SELECT * FROM st_concepts WHERE title = ?', CONCEPTS[2].title);
    expect(c15.page).toBe(15);
    expect(one('SELECT COUNT(*) AS n FROM st_concepts').n).toBe(2);
    const drawn2 = all('SELECT q.* FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ?', sessionId2);
    expect(drawn2.length).toBeGreaterThan(0);
    for (const r of drawn2) {
      expect(r.concept_id).toBe(c15.id);
      expect(r.source_page).toBe(15);
      expect(bodyOf(15)).toContain(r.source_quote);
    }
    expect(drawn2.map((r) => r.source_quote)).not.toContain(FABRICATED_QUOTE);
    await answerDraw(h2);
    await waitFor(() => q(h2, '.st-res'), 'its results');
    expect(qa(h2, '.st-cov i').length).toBe(1);
    expect(text(q(h2, '.st-res__under'))).toMatch(/ is \d of 1 concepts clean · /);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 12. Weak Spots
  // ═════════════════════════════════════════════════════════════════════════

  it('12. Weak Spots, from the widget: weakest concepts first, then stale, clean ones left out; with nothing weak it says so and starts nothing', async () => {
    await boot();
    await exec('study.weakSpots');
    expect(env.calls.info.at(-1)).toBe('Add a material first.');

    // A chapter's bank, the session ended unanswered: nothing is weak yet.
    const s0 = await startChapterSession();
    env.confirm = true;
    key(s0.h, 'Escape');
    await waitFor(() => q(s0.h, '.st-res'), 'results');
    const opened = env.calls.openEditor.length;
    await exec('study.weakSpots');
    expect(env.calls.info.at(-1)).toBe('No weak spots yet: every concept you have answered is clean.');
    expect(one('SELECT COUNT(*) AS n FROM st_sessions').n).toBe(1);
    expect(env.calls.openEditor.length).toBe(opened);

    // Mastery as answers leave it: two weak at different depths, one clean,
    // and one stale that the chapter's run never wrote a question for.
    const now = Date.now();
    const setConcept = (title: string, mastery: number, answers: number, at: number) =>
      env.db.raw().prepare('UPDATE st_concepts SET mastery = ?, answers = ?, misses = 1, last_answered_at = ? WHERE title = ?').run(mastery, answers, at, title);
    setConcept(CH3_TITLES[0], 0.4, 2, now - 60_000);          // weak
    setConcept(CH3_TITLES[1], 0.1, 3, now - 60_000);          // weakest
    setConcept(CH3_TITLES[2], 0.8, 3, now - 60_000);          // clean
    setConcept(CH3_TITLES[3], 0.9, 4, now - 30 * 86_400_000); // clean once, stale now
    const id = (title: string) => one('SELECT id FROM st_concepts WHERE title = ?', title).id;
    const order = [CH3_TITLES[1], CH3_TITLES[0], CH3_TITLES[3]].map(id);
    const questionsOf = (cid: number) => one('SELECT COUNT(*) AS n FROM st_questions WHERE concept_id = ? AND hidden = 0', cid).n;
    expect(questionsOf(id(CH3_TITLES[2]))).toBeGreaterThan(0);
    expect(questionsOf(id(CH3_TITLES[3]))).toBe(0);

    // The widget counts them and its footer opens the session.
    const wHost = document.createElement('div');
    document.body.appendChild(wHost);
    extraHosts.push(wHost);
    const cached = await env.widgets[0].refresh({ config: { maxRows: 5 } });
    const widget = env.widgets[0].createWidget(wHost, { cachedOutput: cached, config: { maxRows: 5 }, requestRefresh: () => {}, onDidChangeConfig: () => ({ dispose() {} }) });
    expect(qa(wHost, '.st-widget__row').map((r) => text(q(r, '.st-widget__label')))).toEqual([label1()]);
    expect(text(q(wHost, '.st-widget__under'))).toBe('2 weak · 100% covered');
    const sb = mountSidebar();
    const callsBefore = env.lmCalls.length;
    btn(wHost, 'Study the Weakest 6')!.click();
    const tab = await waitFor(() => { const t = latestSessionTab(); return t && t !== `session-${s0.sessionId}` ? t : null; }, 'the Weak Spots tab');
    widget.dispose();
    const sessionId = Number(tab.slice('session-'.length));
    const h = paneHost(tab)!;
    await waitFor(() => q(h, '.st-card'), 'the first card');

    const session = one('SELECT * FROM st_sessions WHERE id = ?', sessionId);
    expect(session).toMatchObject({ mode: 'weak', answer_format: 'mixed', finished_at: 0, name: 'All materials' });
    expect(JSON.parse(session.scope_json)).toEqual({ kind: 'weak', materialIds: [1], label: 'All materials' });
    // Short of a full draw, the run wrote questions for the stale concept alone.
    const written = env.lmCalls.slice(callsBefore).filter((c) => c.kind === 'questions');
    expect(written.length).toBeGreaterThan(0);
    for (const c of written) expect([...c.user.matchAll(/^- id \d+: (.+?)\. .*Write: /gm)].map((m) => m[1])).toEqual([CH3_TITLES[3]]);
    expect(questionsOf(id(CH3_TITLES[3]))).toBe(2);
    // Round one: one question per concept, weakest first, the stale one after
    // the weak; then a second round in the same order. The clean one never.
    const drawn = all('SELECT q.concept_id FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ? ORDER BY i.ord', sessionId).map((r) => r.concept_id);
    expect(drawn).toEqual([...order, ...order]);
    expect(drawn).not.toContain(id(CH3_TITLES[2]));

    // What it says: the scope once, the mode once.
    expect(text(q(h, '.st-eyebrow__cpt'))).toBe(CH3_TITLES[1]);
    expect(text(q(h, '.st-sess-tb__scope'))).toBe('All materials · Weak Spots · Mixed');
    expect(env.calls.openEditor.at(-1)).toMatchObject({ instanceId: tab, title: 'Study · All materials' });
    const row = await waitFor(() => qa(sb, '.st-sb__it--session').find((r) => r.dataset.sessionId === String(sessionId)), 'its sidebar row');
    expect(text(q(row, '.st-sb__nm'))).toBe('All materials · Weak Spots');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 13. Delete Session, Delete Bank
  // ═════════════════════════════════════════════════════════════════════════

  it('13. Delete Session… and Delete Bank… ask first, then remove the rows, a bank\'s questions and its sessions; the sidebar updates and a deleted session\'s tab closes', async () => {
    await boot();
    const sb = mountSidebar();
    const menuOf = (r: Element) => { r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return env.calls.menus.at(-1) as AnyRec[]; };

    // An open session with one answer in.
    const { h, sessionId } = await startChapterSession();
    const tab = `session-${sessionId}`;
    const first = currentQuestion(h);
    key(h, String(Number(first.answer) + 1));
    await waitFor(() => one('SELECT COUNT(*) AS n FROM st_answers').n === 1, 'the answer stored');
    const row = await waitFor(() => qa(sb, '.st-sb__it--session').find((r) => r.dataset.sessionId === String(sessionId)), 'the session row');
    const name = one('SELECT name FROM st_sessions WHERE id = ?', sessionId).name;
    const menu = menuOf(row);
    expect(menu.map((m) => m.label)).toEqual(['Delete Session…']);
    expect(menu[0]).toMatchObject({ icon: 'trash', danger: true });

    // Declined: nothing goes.
    env.confirm = false;
    menu[0].onSelect();
    await waitFor(() => env.calls.confirms.length === 1, 'the confirm');
    expect(env.calls.confirms[0]).toMatchObject({ message: `Delete the session ${name}?`, confirmLabel: 'Delete', danger: true });
    await settle();
    expect(one('SELECT COUNT(*) AS n FROM st_sessions WHERE id = ?', sessionId).n).toBe(1);
    expect(qa(sb, '.st-sb__it--session').length).toBe(1);
    expect(paneHost(tab)).not.toBeNull();

    // Confirmed: the session and its items go, its answers stay counted, the row and the tab go.
    env.confirm = true;
    menuOf(qa(sb, '.st-sb__it--session')[0])[0].onSelect();
    await waitFor(() => paneHost(tab) === null, 'the session tab closed');
    expect(env.calls.closeEditor).toContain(`parallx-community.study:study:${tab}`);
    expect(one('SELECT COUNT(*) AS n FROM st_sessions').n).toBe(0);
    expect(one('SELECT COUNT(*) AS n FROM st_session_items').n).toBe(0);
    expect(all('SELECT question_id, session_id FROM st_answers')).toEqual([{ question_id: first.id, session_id: sessionId }]);
    await waitFor(() => !q(sb, '.st-sb__sec--sessions'), 'the sessions section gone');
    expect(qa(sb, '.st-sb__it--session').length).toBe(0);

    // A bank with a session over it, open in its tab.
    env.pick = (items) => items.find((i) => i.label === 'questions.md');
    await exec('study.importQuestions');
    const bank = one("SELECT * FROM st_banks WHERE kind = 'file'");
    const providerQuestions = one("SELECT COUNT(*) AS n FROM st_questions WHERE origin = 'provider'").n;
    expect(providerQuestions).toBe(2);
    await waitFor(() => q(sb, '.st-sb__sec--banks .px-section-label'), 'the banks section');
    q<HTMLElement>(sb, '.st-sb__sec--banks .px-section-label')!.click();
    const bankRow = () => qa(sb, '.st-sb__it--bank').find((r) => r.dataset.bankId === String(bank.id)) || null;
    await waitFor(() => qa(sb, '.st-sb__it--bank').length === 2, 'bank rows');
    bankRow()!.click();
    const setup = await waitFor(() => paneHost('setup'), 'setup on the bank');
    await waitFor(() => text(q(setup, '.st-sheet__count')), 'the count');
    const bs = await startFromSetup(setup);
    const bankMaterial = one("SELECT * FROM st_materials WHERE kind = 'bank'");
    expect(bankMaterial.uri).toBe(`bank:${bank.id}`);
    expect(one('SELECT COUNT(*) AS n FROM st_concepts WHERE material_id = ?', bankMaterial.id).n).toBe(2);

    const bankMenu = menuOf(await waitFor(() => bankRow(), 'the bank row'));
    expect(bankMenu.map((m) => m.label)).toEqual(['Study…', undefined, 'Delete Bank…']);
    expect(bankMenu[2]).toMatchObject({ icon: 'trash', danger: true });
    bankMenu[2].onSelect();
    await waitFor(() => paneHost(`session-${bs.sessionId}`) === null, 'the bank session tab closed');
    expect(env.calls.confirms.at(-1)).toMatchObject({ message: `Delete the bank ${bank.name}?`, detail: 'Its 2 questions and every session over it go too.', confirmLabel: 'Delete', danger: true });
    expect(one('SELECT COUNT(*) AS n FROM st_banks WHERE id = ?', bank.id).n).toBe(0);
    expect(one('SELECT COUNT(*) AS n FROM st_questions WHERE bank_id = ?', bank.id).n).toBe(0);
    expect(one("SELECT COUNT(*) AS n FROM st_questions WHERE origin = 'imported'").n).toBe(0);
    expect(one("SELECT COUNT(*) AS n FROM st_materials WHERE kind = 'bank'").n).toBe(0);
    expect(one('SELECT COUNT(*) AS n FROM st_concepts WHERE material_id = ?', bankMaterial.id).n).toBe(0);
    expect(one('SELECT COUNT(*) AS n FROM st_sessions WHERE id = ?', bs.sessionId).n).toBe(0);
    expect(one('SELECT COUNT(*) AS n FROM st_session_items WHERE session_id = ?', bs.sessionId).n).toBe(0);
    // The other bank and the reading are untouched.
    expect(one("SELECT COUNT(*) AS n FROM st_questions WHERE origin = 'provider'").n).toBe(providerQuestions);
    expect(one("SELECT COUNT(*) AS n FROM st_questions WHERE origin = 'generated'").n).toBeGreaterThan(0);
    await waitFor(() => qa(sb, '.st-sb__it--bank').length === 1, 'one bank row');
    expect(bankRow()).toBeNull();
    expect(text(q(sb, '.st-sb__sec--banks .st-sb__n'))).toBe('1');
    expect(q(sb, '.st-sb__sec--sessions')).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 14. Resume
  // ═════════════════════════════════════════════════════════════════════════

  it('14. an open session survives Study turned off and on: its sidebar row reopens it at the same question, earlier answers kept', async () => {
    await boot();
    const { h, sessionId } = await startChapterSession();
    const tab = `session-${sessionId}`;
    const items = all('SELECT * FROM st_session_items WHERE session_id = ? ORDER BY ord', sessionId);
    /** Answer the card on screen, right or wrong, and move on. */
    const answerOne = async (host: HTMLElement, right: boolean) => {
      const qr = currentQuestion(host);
      if (q(host, '.st-card')!.dataset.format === 'mc') {
        const r = Number(qr.answer);
        key(host, String((right ? r : (r + 1) % 4) + 1));
      } else {
        const field = q<HTMLTextAreaElement>(host, '.st-ta textarea, .st-ta input')!;
        field.value = typedAnswer(JSON.parse(qr.rubric_json), right ? 'all' : 'none');
        key(host, 'Enter', field);
      }
      await waitFor(() => btn(host, 'Next') && text(q(btn(host, 'Next'), '.px-btn__label')) === 'Next' && !btn(host, 'Next')!.disabled, 'the answer stored');
      key(host, 'Enter');
      await cardLeft(host);
      return qr;
    };
    expect((await answerOne(h, false)).id).toBe(items[0].question_id);
    expect((await answerOne(h, true)).id).toBe(items[1].question_id);
    expect(currentQuestion(h).id).toBe(items[2].question_id);
    const itemRows = () => all('SELECT id, question_id, status, chosen, typed, verdict_json, format_used, answered_at FROM st_session_items WHERE session_id = ? ORDER BY ord', sessionId);
    const itemsBefore = itemRows();
    expect(itemsBefore.map((i) => i.status)).toEqual(['wrong', 'right', 'pending', 'pending', 'pending', 'pending']);
    const answersBefore = all('SELECT * FROM st_answers ORDER BY id');
    expect(answersBefore.length).toBe(2);
    const conceptsBefore = all('SELECT * FROM st_concepts ORDER BY id');

    // Off, as the host does it: the workbench closes Study's tabs, then the
    // registrations go and deactivate runs.
    for (const e of [...env.editors.open.values()]) await env.editors.closeEditor(e.id);
    for (const d of env.context.subscriptions.splice(0)) d.dispose();
    await deactivate();
    await settle(5);
    expect(env.editors.providers.size).toBe(0);
    expect(env.views.size).toBe(0);
    expect(one('SELECT finished_at FROM st_sessions WHERE id = ?', sessionId).finished_at).toBe(0);

    // On again: the session is still open in the sidebar, where it stood.
    env.context = { subscriptions: [] };
    await activate(env.api, env.context);
    await waitFor(() => env.commandHandlers.size === 8 && env.editors.providers.size === 1 && env.views.size === 1, 'the second activation');
    const sb = mountSidebar();
    const row = await waitFor(() => qa(sb, '.st-sb__it--session').find((r) => r.dataset.sessionId === String(sessionId)), 'the open session row');
    expect(q(row, '.st-sb__live')).not.toBeNull();
    expect(text(q(row, '.st-sb__r'))).toBe('2 / 6');

    // Reopened from its row: the third question, the first two marked on the strand, nothing re-asked.
    row.click();
    const h2 = await waitFor(() => paneHost(tab), 'the session tab again');
    await waitFor(() => q(h2, '.st-card'), 'the card');
    expect(currentQuestion(h2).id).toBe(items[2].question_id);
    expect(qa(h2, '.st-strand i').map((i) => i.className)).toEqual(['no', 'ok', 'cur', '', '', '']);
    expect(itemRows()).toEqual(itemsBefore);
    expect(all('SELECT * FROM st_answers ORDER BY id')).toEqual(answersBefore);
    expect(all('SELECT * FROM st_concepts ORDER BY id')).toEqual(conceptsBefore);

    // It goes on in the same session.
    await answerOne(h2, true);
    expect(currentQuestion(h2).id).toBe(items[3].question_id);
    expect(itemRows().map((i) => i.status).slice(0, 3)).toEqual(['wrong', 'right', 'right']);
    expect(one('SELECT COUNT(*) AS n FROM st_answers WHERE session_id = ?', sessionId).n).toBe(3);
    expect(one('SELECT position FROM st_sessions WHERE id = ?', sessionId).position).toBe(2);
    expect(one('SELECT COUNT(*) AS n FROM st_sessions').n).toBe(1);
    await waitFor(() => text(q(qa(sb, '.st-sb__it--session')[0], '.st-sb__r')) === '3 / 6', 'the row moves on');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 15. Model and context window
  // ═════════════════════════════════════════════════════════════════════════

  it('15. the model line on the sheet: model and context are remembered per material and every call of the run carries them; Auto sizes each call', async () => {
    await boot();
    const setup = await openChapterSetup();
    const mdl = (host: HTMLElement) => q<HTMLButtonElement>(host, '.st-sheet__mdl')!;
    const openMenu = (host: HTMLElement) => { mdl(host).click(); return env.calls.menus.at(-1) as AnyRec[]; };
    const pick = (host: HTMLElement, label: string) => openMenu(host).find((m) => m.label === label)!.onSelect();
    const material = () => one('SELECT model, context_setting, answer_format FROM st_materials WHERE id = 1');
    expect(text(mdl(setup))).toBe('qwen3:14b · Auto context');
    expect(material()).toEqual({ model: '', context_setting: 0, answer_format: '' });

    // Model and context are set together: every choice keeps the menu open,
    // and a model redraws it with the sizes that model can hold.
    const first = openMenu(setup);
    expect(first.filter((m) => m.label && !m.disabled).every((m) => m.keepOpen === true)).toBe(true);
    expect(first.slice(first.indexOf(first.find((m) => m.label === 'Auto')!))).toHaveLength(5);
    const before = env.calls.menus.length;
    first.find((m) => m.label === 'llama3:8b')!.onSelect();
    expect(env.calls.menus.length).toBe(before + 1);
    const redrawn = env.calls.menus.at(-1) as AnyRec[];
    expect(redrawn.filter((m) => m.checked).map((m) => m.label)).toEqual(['llama3:8b', 'Auto']);
    expect(redrawn.slice(redrawn.findIndex((m) => m.label === 'Auto')).map((m) => m.label)).toEqual(['Auto', '8K']);
    // A fixed size the new model cannot hold becomes that model's maximum.
    pick(setup, 'qwen3:14b');
    pick(setup, '32K');
    expect(text(mdl(setup))).toBe('qwen3:14b · 32K context');
    pick(setup, 'llama3:8b');
    expect(text(mdl(setup))).toBe('llama3:8b · 8K context');
    pick(setup, 'Auto');
    expect(text(mdl(setup))).toBe('llama3:8b · Auto context');
    await waitFor(() => material().model === 'llama3:8b', 'the model stored');
    const menu = openMenu(setup);
    // Its window is 8K: no larger fixed size is offered. The choice is checked.
    expect(menu.map((m) => m.label)).toEqual(['Model', 'qwen3:14b', 'llama3:8b', "Use the Chat's Model", undefined, 'Context', 'Auto', '8K']);
    expect(menu.filter((m) => m.checked).map((m) => m.label)).toEqual(['llama3:8b', 'Auto']);
    expect(menu.filter((m) => m.keybinding).map((m) => [m.label, m.keybinding])).toEqual([['qwen3:14b', '40K'], ['llama3:8b', '8K']]);
    menu.find((m) => m.label === '8K')!.onSelect();
    expect(text(mdl(setup))).toBe('llama3:8b · 8K context');
    await waitFor(() => material().context_setting === 8192, 'the context stored');

    // The run: the session records both and every call carries them.
    const s1 = await startFromSetup(setup);
    expect(one('SELECT model, num_ctx FROM st_sessions WHERE id = ?', s1.sessionId)).toEqual({ model: 'llama3:8b', num_ctx: 8192 });
    await answerDraw(s1.h);
    await waitFor(() => q(s1.h, '.st-res'), 'results');
    const kinds = new Set(env.lmCalls.map((c) => c.kind));
    for (const k of ['map', 'questions', 'support', 'distractor', 'grade']) expect(kinds.has(k)).toBe(true);
    for (const c of env.lmCalls) expect([c.kind, c.modelId, c.numCtx]).toEqual([c.kind, 'llama3:8b', 8192]);
    const runs = all('SELECT model, num_ctx FROM st_runs');
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) expect(r).toEqual({ model: 'llama3:8b', num_ctx: 8192 });
    expect(all("SELECT DISTINCT model FROM st_questions WHERE origin = 'generated'")).toEqual([{ model: 'llama3:8b' }]);

    // The sheet again remembers both; back to the chat's model and Auto, answered by typing.
    const again = await openChapterSetup();
    expect(text(mdl(again))).toBe('llama3:8b · 8K context');
    pick(again, "Use the Chat's Model");
    expect(text(mdl(again))).toBe('qwen3:14b · 8K context');
    pick(again, 'Auto');
    expect(text(mdl(again))).toBe('qwen3:14b · Auto context');
    await waitFor(() => material().model === '' && material().context_setting === 0, 'the defaults stored');
    q<HTMLButtonElement>(again, '.ui-segmented-control__segment[data-value="type"]')!.click();
    await settle();
    const from = env.lmCalls.length;
    const s2 = await startFromSetup(again);
    expect(one('SELECT model, num_ctx, answer_format FROM st_sessions WHERE id = ?', s2.sessionId)).toEqual({ model: '', num_ctx: 0, answer_format: 'type' });
    expect(material()).toEqual({ model: '', context_setting: 0, answer_format: 'type' });

    // The first answer is long, the rest short: Auto gives each call the window its own prompt needs.
    const filler = ' Mack derives the standard error of the reserve from the process risk and the parameter risk.'.repeat(320);
    let typed = 0;
    for (let guard = 0; guard < 12; guard++) {
      const step = await waitFor(() => q(s2.h, '.st-res') || q(s2.h, '.st-card:not(.st-card--leaving)'), 'a card or the results');
      if (step.classList.contains('st-res')) break;
      expect(step.dataset.format).not.toBe('mc');
      const field = q<HTMLTextAreaElement>(s2.h, '.st-ta textarea, .st-ta input')!;
      field.value = `${currentQuestion(s2.h).stem}${typed === 0 ? filler : ''}`;
      key(s2.h, 'Enter', field);
      await waitFor(() => btn(s2.h, 'Next') && text(q(btn(s2.h, 'Next'), '.px-btn__label')) === 'Next' && !btn(s2.h, 'Next')!.disabled, 'the verdict');
      typed++;
      key(s2.h, 'Enter');
      await cardLeft(s2.h);
    }
    await waitFor(() => q(s2.h, '.st-res'), 'results');
    expect(typed).toBe(6);
    const run2 = env.lmCalls.slice(from);
    expect(run2.every((c) => c.modelId === 'qwen3:14b')).toBe(true);
    const grades = run2.filter((c) => c.kind === 'grade');
    expect(grades.length).toBe(6);
    expect(grades[0].user.length).toBeGreaterThan(30000);
    expect(grades[0].numCtx).toBeGreaterThan(8192);
    expect(grades[0].numCtx).toBeLessThanOrEqual(40960);
    expect(grades[0].numCtx % 2048).toBe(0);
    for (const g of grades.slice(1)) expect(g.numCtx).toBe(8192);
    for (const c of run2) { expect(c.numCtx).toBeGreaterThanOrEqual(8192); expect(c.numCtx).toBeLessThanOrEqual(40960); }
  });

  it('16. with a model and a context fixed in Settings, the sheet names them as the default and the run uses them', async () => {
    await boot();
    env.settings.aiModel = 'llama3:8b';
    env.settings.generationContext = 8192;
    const setup = await openChapterSetup();
    const mdl = q<HTMLButtonElement>(setup, '.st-sheet__mdl')!;
    expect(text(mdl)).toBe('llama3:8b · 8K context');
    mdl.click();
    const menu = env.calls.menus.at(-1) as AnyRec[];
    expect(menu.map((m) => m.label)).toEqual(['Model', 'qwen3:14b', 'llama3:8b', 'Use the Model in Settings', undefined, 'Context', 'As in Settings', '8K']);
    expect(menu.filter((m) => m.checked).map((m) => m.label)).toEqual(['Use the Model in Settings', 'As in Settings']);
    expect(menu.find((m) => m.label === 'As in Settings')!.keybinding).toBe('8K');
    // Nothing is copied onto the material: it follows Settings.
    expect(one('SELECT model, context_setting FROM st_materials WHERE id = 1')).toEqual({ model: '', context_setting: 0 });
    const s = await startFromSetup(setup);
    await waitFor(() => q(s.h, '.st-card'), 'a card');
    for (const c of env.lmCalls) expect([c.kind, c.modelId, c.numCtx]).toEqual([c.kind, 'llama3:8b', 8192]);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Test mode (bugs 4, 12)
  // ═════════════════════════════════════════════════════════════════════════

  it('Test mode: typed answers only, no feedback per answer, mc questions graded against the option text, results at the end with points', async () => {
    await boot();
    const setup = await openChapterSetup();
    q<HTMLButtonElement>(setup, '.ui-segmented-control__segment[data-value="test"]')!.click();
    await settle();
    const answerSeg = qa(setup, '.ui-segmented-control')[2];
    expect(text(q(answerSeg, '.ui-segmented-control__segment--active'))).toBe('Type');
    const { h, sessionId } = await startFromSetup(setup);
    expect(one('SELECT mode, answer_format FROM st_sessions WHERE id = ?', sessionId)).toEqual({ mode: 'test', answer_format: 'type' });

    for (let n = 0; n < 6; n++) {
      const card = await waitFor(() => q(h, '.st-card:not(.st-card--leaving)'), 'a card');
      expect(card.dataset.format).not.toBe('mc');
      expect(q(h, '.st-opt')).toBeNull();
      const qr = currentQuestion(h);
      const stemBefore = text(q(h, '.st-card__q'));
      const field = q<HTMLTextAreaElement>(h, '.st-ta textarea, .st-ta input')!;
      field.value = qr.format === 'mc' ? JSON.parse(qr.options_json)[Number(qr.answer)] : typedAnswer(JSON.parse(qr.rubric_json), 'two');
      key(h, 'Enter', field);
      await waitFor(() => one('SELECT status FROM st_session_items WHERE session_id = ? AND question_id = ?', sessionId, qr.id).status !== 'pending', 'the answer stored');
      const after = await waitFor(() => (q(h, '.st-res') ? 'results'
        : q(h, '.st-card--leaving') ? 'leaving'
        : text(q(h, '.st-card__q')) !== stemBefore ? 'next'
        : btn(h, 'Next') && !btn(h, 'Next')!.disabled ? 'button' : null), 'the step after an answer');
      // No verdict, no points, no retry while the test runs.
      if (after !== 'results') {
        expect(q(h, '.st-fb--show')).toBeNull();
        expect(q(h, '.st-rub__pt')).toBeNull();
        expect(btn(h, 'Retry')).toBeNull();
      }
      if (after === 'button') key(h, 'Enter');
      if (after === 'button' || after === 'leaving') await cardLeft(h);
    }
    await waitFor(() => q(h, '.st-res'), 'results');

    // mc questions answered by typing are graded against the option text, never its index.
    const mcIds = all("SELECT q.* FROM st_session_items i JOIN st_questions q ON q.id = i.question_id WHERE i.session_id = ? AND q.format = 'mc'", sessionId);
    expect(mcIds.length).toBeGreaterThan(0);
    for (const mq of mcIds) {
      const optionText = JSON.parse(mq.options_json)[Number(mq.answer)];
      const stored = JSON.parse(one('SELECT rubric_json FROM st_questions WHERE id = ?', mq.id).rubric_json || '[]');
      for (const p of stored) expect(p.text).not.toMatch(/^\s*\d+\s*$/);
      const asked = env.lmCalls.filter((c) => (c.kind === 'grade' || c.kind === 'rubric') && c.user.includes(mq.stem));
      for (const c of asked) {
        expect(c.user).not.toMatch(/(?:Reference answer|Model answer):\n\d+\s*(\n|$)/);
        expect(c.user).toContain(optionText);
      }
      expect(one('SELECT status FROM st_session_items WHERE session_id = ? AND question_id = ?', sessionId, mq.id).status).toBe('right');
    }

    // Per-point feedback at the end: on the results, or in Review Answers.
    if (!q(h, '.st-rub__pt')) {
      btn(h, 'Review Answers')!.click();
      await waitFor(() => q(h, '.st-review'), 'review');
    }
    expect(qa(h, '.st-rub__pt').length).toBeGreaterThan(0);
  });
});
