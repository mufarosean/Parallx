// browser-model-benchmark.mjs: the live-model benchmark
// (docs/BROWSER_AGENT_IMPLEMENTATION_REVIEW.md, remaining work 1).
//
// The user's local Ollama model drives the Assistant Browser through real chat
// turns in the ACTUAL app: a hidden window, a throwaway app root and workspace,
// the Browser extension enabled as host, the browser tools granted for the
// session (the "Allow for session" a user would click), and a cleared
// assistant profile before every trial. Tasks are read-only on public sites:
// no sign-in, no purchase, nothing submitted.
//
// A trial succeeds only when the answer is right AND the browser visited the
// site: a page opening is not task completion. Where the answer changes (Hacker
// News, GitHub) the harness fetches the truth itself right after the trial.
// Each failure is classified: runtime (a browser tool failed), handoff (the
// tools asked for the user), timeout, or model (no browsing, or a wrong or
// incomplete answer).
//
// Usage: node --use-system-ca tests/probes/browser-model-benchmark.mjs
//   [--model=qwen3.8:27b] [--trials=3] [--tasks=id,id] [--timeout=480] [--visible]
// Requires `npm run build`. Evidence: test-results/browser-audit/model-benchmark-*/

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const arg = (name, fallback) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : fallback; };
const MODEL = arg('model', 'qwen3.8:27b');
const TRIALS = Math.max(1, Number(arg('trials', '3')) || 3);
const ONLY = arg('tasks', '') ? new Set(arg('tasks', '').split(',').filter(Boolean)) : null;
const TIMEOUT_MS = Math.max(60, Number(arg('timeout', '480')) || 480) * 1000;
const VISIBLE = process.argv.includes('--visible');
const OUT = path.join(ROOT, 'test-results', 'browser-audit', `model-benchmark-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`);
const t0 = Date.now();
const log = (msg) => { const line = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`; console.log(line); try { appendFileSync(path.join(OUT, 'progress.log'), line + '\n'); } catch { /* not yet */ } };
const within = (ms, label, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms: ${label}`)), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSER_TOOLS = ['browserOpen', 'browserRead', 'browserClick', 'browserType', 'browserBack', 'browserAct', 'browserTabs', 'browserWait', 'browserCapture'];
const RUNTIME_CODES = new Set(['CDP_TIMEOUT', 'DEBUGGER_BUSY', 'PAGE_NOT_ACTIONABLE', 'INTERNAL', 'PAGE_SCRIPT', 'NAVIGATION_TIMEOUT', 'LOAD_FAILED', 'PAGE_CRASHED', 'UNAVAILABLE', 'CAPTURE_FAILED']);

// ── ground truth ──
const norm = (s) => String(s || '').toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/\s+/g, ' ').trim();
const says = (text, needle) => norm(text).includes(norm(needle));
const getJson = async (url) => { const r = await fetch(url, { headers: { 'user-agent': 'parallx-benchmark' } }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
const getText = async (url) => { const r = await fetch(url, { headers: { 'user-agent': 'parallx-benchmark' } }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); };
async function hnTop(n) {
  const ids = (await getJson('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, n);
  return Promise.all(ids.map((id) => getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
}
const WORD_RATING = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 };
async function travelTruth() {
  const html = await getText('https://books.toscrape.com/catalogue/category/books/travel_2/index.html');
  const count = (/<strong>(\d+)<\/strong>\s*results/.exec(html) || [])[1];
  const price = (/<p class="price_color">[^0-9]*([0-9.]+)<\/p>/.exec(html) || [])[1];
  const rating = (/<p class="star-rating (\w+)">/.exec(html) || [])[1];
  return { count, price, rating, ratingNumber: WORD_RATING[rating] };
}

// Did the browser reach this site (a tool result's url)?
const visited = (r, host) => r.tools.some((t) => (t.url || '').includes(host));
const used = (r, name) => r.tools.some((t) => t.name === name);

const TASKS = [
  {
    id: 'wiki-search', site: 'en.wikipedia.org', kind: 'search box, navigation',
    prompt: 'Use the Assistant Browser: go to https://en.wikipedia.org, use the site\'s search box to search for "Grace Hopper", open her article, and tell me the article\'s first sentence as written.',
    check: async (r) => ({ ok: /grace brewster hopper/i.test(r.text) && visited(r, 'wikipedia.org/wiki/Grace') && used(r, 'browserType'), expect: 'first sentence naming Grace Brewster Hopper, reached through the search box' }),
  },
  {
    id: 'wiki-follow-link', site: 'en.wikipedia.org', kind: 'multi-page navigation',
    prompt: 'Use the Assistant Browser: open https://en.wikipedia.org/wiki/Grace_Hopper, follow the link in the article to the COBOL programming language article, and tell me the year COBOL first appeared according to that article.',
    check: async (r) => ({ ok: /\b1959\b/.test(r.text) && visited(r, 'wikipedia.org/wiki/COBOL'), expect: '1959, on the COBOL article reached from the Hopper article' }),
  },
  {
    id: 'hn-top', site: 'news.ycombinator.com', kind: 'live content',
    prompt: 'Use the Assistant Browser: open https://news.ycombinator.com and tell me the exact title of the number 1 story on the front page right now.',
    check: async (r) => {
      const top = await hnTop(3);
      const hit = top.findIndex((s) => says(r.text, s.title));
      return { ok: hit >= 0 && visited(r, 'news.ycombinator.com'), expect: `the current #1 title (top 3 now: ${top.map((s) => JSON.stringify(s.title)).join(', ')}; ranking can move during a run)`, detail: { matchedRank: hit + 1 } };
    },
  },
  {
    id: 'hn-submitter', site: 'news.ycombinator.com', kind: 'live content, second page',
    prompt: 'Use the Assistant Browser: open https://news.ycombinator.com, open the comments page of the number 1 story, and tell me the username of the person who submitted it.',
    check: async (r) => {
      const top = await hnTop(3);
      const hit = top.findIndex((s) => new RegExp(`\\b${s.by.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(r.text));
      return { ok: hit >= 0 && visited(r, 'news.ycombinator.com/item'), expect: `the #1 story's submitter (top 3 now: ${top.map((s) => s.by).join(', ')}), read on its comments page`, detail: { matchedRank: hit + 1 } };
    },
  },
  {
    id: 'python-docs-search', site: 'docs.python.org', kind: 'site search form',
    prompt: 'Use the Assistant Browser: go to https://docs.python.org/3/, use the documentation\'s search to find str.removeprefix, open its entry, and tell me in which Python version it was added.',
    check: async (r) => ({ ok: /3\.9/.test(r.text) && visited(r, 'docs.python.org') && used(r, 'browserType'), expect: '3.9, found through the docs search' }),
  },
  {
    id: 'mdn-reference', site: 'developer.mozilla.org', kind: 'reading a reference page',
    prompt: 'Use the Assistant Browser: open https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/findLast and tell me what the method returns when no element satisfies the testing function, quoting the page.',
    check: async (r) => ({ ok: /undefined/i.test(r.text) && visited(r, 'developer.mozilla.org'), expect: 'undefined, from the MDN page' }),
  },
  {
    id: 'github-release', site: 'github.com', kind: 'live content, busy page',
    prompt: 'Use the Assistant Browser: open https://github.com/microsoft/playwright and tell me the tag name of the latest release shown on the repository page.',
    check: async (r) => {
      const tag = (await getJson('https://api.github.com/repos/microsoft/playwright/releases/latest')).tag_name;
      return { ok: says(r.text, tag) && visited(r, 'github.com/microsoft/playwright'), expect: `the latest release tag (${tag})` };
    },
  },
  {
    id: 'books-category', site: 'books.toscrape.com', kind: 'sidebar navigation, listing',
    prompt: 'Use the Assistant Browser: open https://books.toscrape.com, go to the "Travel" category using the sidebar, and tell me how many books the category has and the price of the first book listed.',
    check: async (r) => {
      const t = await travelTruth();
      return { ok: new RegExp(`\\b${t.count}\\b`).test(r.text) && r.text.includes(t.price) && visited(r, 'travel_2'), expect: `${t.count} books, first priced ${t.price}` };
    },
  },
  {
    id: 'form-no-submit', site: 'httpbin.org', kind: 'form widgets, restraint',
    prompt: 'Use the Assistant Browser: open https://httpbin.org/forms/post and fill in the form: customer name "Benchmark Tester", pizza size Medium, and the topping Bacon. Do NOT submit the form. When done, tell me what you filled in.',
    // The page itself is the evidence: its fields as the assistant left them, and no submission.
    pageCheck: `JSON.stringify({ url: location.href, name: (document.querySelector('[name=custname]') || {}).value || '', medium: !!(document.querySelector('input[name=size][value=medium]') || {}).checked, bacon: !!(document.querySelector('input[name=topping][value=bacon]') || {}).checked })`,
    check: async (r) => {
      const p = r.page || {};
      const notSubmitted = !r.tools.some((t) => (t.url || '').includes('/post') && !(t.url || '').includes('/forms/post'));
      return { ok: p.name === 'Benchmark Tester' && p.medium && p.bacon && /\/forms\/post/.test(p.url || '') && notSubmitted, expect: 'name, Medium and Bacon set on the page; form not submitted', detail: { page: p, notSubmitted } };
    },
  },
  {
    id: 'books-visual-rating', site: 'books.toscrape.com', kind: 'visual (capture), needs vision', vision: true,
    prompt: 'Use the Assistant Browser: open https://books.toscrape.com/catalogue/category/books/travel_2/index.html, take a capture of the page with browserCapture, and tell me the star rating (1 to 5 stars) of the first book, judged from the stars you see in the capture.',
    check: async (r) => {
      const t = await travelTruth();
      const words = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
      const n = t.ratingNumber;
      const said = new RegExp(`\\b(${n}|${words[n]})\\s*(\\/\\s*5\\s*)?(star|out of)`, 'i').test(r.text) || new RegExp(`\\b${words[n]}\\b`, 'i').test(r.text);
      return { ok: said && used(r, 'browserCapture'), expect: `${n} stars, from the capture` };
    },
  },
];

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  if (!VISIBLE) env.PARALLX_HIDDEN_PROBE = '1';
  return env;
}

function classify(r, verdict) {
  if (verdict.ok) return 'success';
  if (r.timedOut) return 'timeout';
  const codes = r.tools.map((t) => t.code).filter(Boolean);
  if (!r.tools.some((t) => BROWSER_TOOLS.includes(t.name))) return 'model: did not browse';
  if (r.tools.some((t) => t.status === 'needs_user')) return 'handoff';
  if (codes.some((c) => RUNTIME_CODES.has(c))) return 'runtime';
  return 'model: wrong or incomplete answer';
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const tasks = TASKS.filter((t) => !ONLY || ONLY.has(t.id));
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-bench-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-bench-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  const report = { started: new Date().toISOString(), model: MODEL, trialsPerTask: TRIALS, timeoutMs: TIMEOUT_MS, visible: VISIBLE, setup: {}, trials: [] };
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: launchEnv(appRoot) });
  // Page dialogs are the broker's to answer; keep Playwright from dismissing them.
  app.context().on('dialog', () => {});
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    report.setup = await within(60_000, 'setup', page.evaluate(async ([model, names]) => {
      const svc = (id) => window.__parallx_workbench__._services.get({ id });
      await svc('IToolEnablementService').setEnablement('parallx.browser', true);
      const tools = svc('ILanguageModelToolsService');
      for (let i = 0; i < 100 && !tools._tools.has('browserOpen'); i++) await new Promise((r) => setTimeout(r, 100));
      const lm = svc('ILanguageModelsService');
      let info = null; let modelError = null;
      try { lm.setActiveModel(model); info = await lm.getModelInfo(model); } catch (e) { modelError = String(e && e.message || e); }
      // The "Allow for session" a user would click for each browser tool.
      const perms = tools._permissionService;
      for (const n of names) { try { perms && perms.grantForSession(n); } catch { /* none */ } }
      return {
        browserTools: names.filter((n) => tools._tools.has(n)), granted: !!perms && names.every((n) => perms.hasSessionGrant(n)),
        activeModel: lm.getActiveModel(), capabilities: info ? info.capabilities : null, modelError,
      };
    }, [MODEL, BROWSER_TOOLS]));
    log(`setup: ${JSON.stringify(report.setup)}`);
    if (!report.setup.browserTools.length) throw new Error('the browser tools are not registered');
    const sees = (report.setup.capabilities || []).includes('vision');

    await page.evaluate(() => {
      const svc = (id) => window.__parallx_workbench__._services.get({ id });
      window.__bench = {
        async run(prompt, model, timeoutMs) {
          const chat = svc('IChatService');
          const s = chat.createSession('agent', model);
          const started = performance.now();
          let timedOut = false;
          const p = chat.sendRequest(s.id, prompt).catch((e) => ({ thrown: String(e && e.message || e) }));
          const timer = new Promise((r) => setTimeout(() => { timedOut = true; r(null); }, timeoutMs));
          const res = await Promise.race([p, timer]);
          if (timedOut) { try { chat.cancelRequest(s.id); } catch { /* none */ } await Promise.race([p, new Promise((r) => setTimeout(r, 8000))]); }
          const session = chat.getSession(s.id) || s;
          const pair = session.messages[session.messages.length - 1];
          const parts = pair ? pair.response.parts : [];
          const text = parts.filter((x) => x.kind === 'markdown').map((x) => x.content).join('\n');
          const tools = parts.filter((x) => x.kind === 'toolInvocation').map((x) => {
            let out = null;
            try { out = x.result ? JSON.parse(x.result.content) : null; } catch { out = null; }
            return {
              name: x.toolName, args: x.args, status: out ? out.status : (x.isError || (x.result && x.result.isError) ? 'error' : x.status),
              code: out && out.error ? out.error.code : null, url: out ? out.url || '' : '', summary: out ? String(out.summary || '').slice(0, 200) : (x.result ? String(x.result.content).slice(0, 200) : ''),
            };
          });
          const warnings = parts.filter((x) => x.kind === 'warning').map((x) => x.message);
          const errorDetails = res && res.errorDetails ? res.errorDetails.message : (res && res.thrown) || null;
          return { ms: Math.round(performance.now() - started), timedOut, text, tools, warnings, errorDetails };
        },
      };
    });

    for (const task of tasks) {
      for (let trial = 1; trial <= TRIALS; trial++) {
        const label = `${task.id} #${trial}`;
        if (task.vision && !sees) { report.trials.push({ task: task.id, trial, skipped: 'the model does not report vision' }); log(`${label}: skipped (no vision)`); continue; }
        // A clean assistant profile for every trial: no run, no tabs, no cookies.
        await page.evaluate(async () => {
          const b = window.parallxElectron.browser;
          await b.automation('revokeAll', { reason: 'benchmark', closeViews: true }).catch(() => {});
          await b.clearData('agent').catch(() => {});
        });
        await sleep(1_000);
        log(`${label}: start`);
        let r;
        try {
          r = await within(TIMEOUT_MS + 30_000, label, page.evaluate(([p, m, ms]) => window.__bench.run(p, m, ms), [task.prompt, MODEL, TIMEOUT_MS]));
        } catch (e) { r = { ms: TIMEOUT_MS, timedOut: true, text: '', tools: [], warnings: [], errorDetails: String(e && e.message || e) }; }
        if (task.pageCheck) {
          r.page = await page.evaluate(async (code) => {
            const list = await window.parallxElectron.browser.view('list', null);
            const v = list.find((x) => x.kind === 'agent' && /httpbin\.org\/forms\/post/.test(x.url || ''));
            return v ? { tabId: v.tabId, webContentsId: v.webContentsId } : null;
          }, task.pageCheck);
          if (r.page) {
            r.page = await app.evaluate(({ webContents }, a) => webContents.fromId(a.id).executeJavaScript(a.code, true).then((s) => JSON.parse(s)), { id: r.page.webContentsId, code: task.pageCheck }).catch((e) => ({ error: String(e && e.message || e) }));
          }
        }
        let verdict;
        try { verdict = await task.check(r); } catch (e) { verdict = { ok: false, expect: `could not check: ${String(e && e.message || e)}` }; }
        const outcome = classify(r, verdict);
        const failures = r.tools.filter((t) => t.status === 'error' || t.status === 'needs_user');
        const recoveries = failures.filter((f) => r.tools.slice(r.tools.indexOf(f) + 1).some((t) => t.status === 'ok')).length;
        const rec = {
          task: task.id, site: task.site, kind: task.kind, trial, model: MODEL, prompt: task.prompt, success: !!verdict.ok, outcome,
          expect: verdict.expect, detail: verdict.detail || null, ms: r.ms, timedOut: r.timedOut, toolCalls: r.tools.length,
          tools: r.tools.map((t) => `${t.name}:${t.status}${t.code ? `(${t.code})` : ''}`), recoveries, handoffs: r.tools.filter((t) => t.status === 'needs_user').length,
          answer: String(r.text || '').slice(0, 1500), warnings: r.warnings, errorDetails: r.errorDetails, page: r.page || null,
        };
        report.trials.push(rec);
        log(`${label}: ${outcome} in ${(r.ms / 1000).toFixed(0)} s, ${r.tools.length} tool calls [${rec.tools.join(' ')}]`);
        await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2));
      }
    }
  } catch (err) {
    report.error = String(err && err.stack || err);
    log(`FAILED: ${report.error.split('\n')[0]}`);
  } finally {
    await within(15_000, 'app.close', app.close()).catch(() => { try { app.process().kill(); } catch { /* gone */ } });
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    report.finished = new Date().toISOString();
    await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(OUT, 'report.md'), renderReport(report));
  }
  const ran = report.trials.filter((t) => !t.skipped);
  console.log(JSON.stringify({ out: OUT, model: MODEL, trials: ran.length, successes: ran.filter((t) => t.success).length, error: report.error }, null, 2));
}

function renderReport(report) {
  const ran = report.trials.filter((t) => !t.skipped);
  const byTask = new Map();
  for (const t of ran) { if (!byTask.has(t.task)) byTask.set(t.task, []); byTask.get(t.task).push(t); }
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const lines = [];
  lines.push(`# Assistant Browser live-model benchmark`, '');
  lines.push(`Model: \`${report.model}\` (capabilities: ${(report.setup.capabilities || []).join(', ') || 'unknown'}). Started ${report.started}; ${report.trialsPerTask} trial(s) per task; ${Math.round(report.timeoutMs / 1000)} s limit per trial. Hidden app, throwaway profile and workspace, browser tools granted for the session, assistant profile cleared before each trial.`, '');
  const ok = ran.filter((t) => t.success).length;
  lines.push(`**Completion: ${ok} of ${ran.length} trials (${ran.length ? Math.round((100 * ok) / ran.length) : 0}%).** Success needs the right answer and a visit to the site; a page opening alone is not completion.`, '');
  lines.push('| Task | Site | Kind | Success | Median time | Median tool calls | Outcomes |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [id, ts] of byTask) {
    const outcomes = [...new Set(ts.map((t) => t.outcome))].map((o) => `${o} ×${ts.filter((t) => t.outcome === o).length}`).join('; ');
    lines.push(`| ${id} | ${ts[0].site} | ${ts[0].kind} | ${ts.filter((t) => t.success).length}/${ts.length} | ${Math.round(median(ts.map((t) => t.ms)) / 1000)} s | ${median(ts.map((t) => t.toolCalls))} | ${outcomes} |`);
  }
  lines.push('', '## Failure classes', '');
  const classes = new Map();
  for (const t of ran.filter((x) => !x.success)) classes.set(t.outcome, (classes.get(t.outcome) || 0) + 1);
  if (!classes.size) lines.push('None.');
  for (const [c, n] of classes) lines.push(`- ${c}: ${n}`);
  lines.push('', '## Trials', '');
  for (const t of ran) {
    lines.push(`### ${t.task} #${t.trial}: ${t.outcome}`, '', `Expected: ${t.expect}. Time ${Math.round(t.ms / 1000)} s, ${t.toolCalls} tool calls, ${t.recoveries} recoveries, ${t.handoffs} handoffs.`, '', `Tools: ${t.tools.join(' ') || 'none'}`, '');
    if (t.errorDetails) lines.push(`Error: ${t.errorDetails}`, '');
    lines.push('Answer:', '', '> ' + (t.answer || '(none)').replace(/\n/g, '\n> '), '');
  }
  for (const t of report.trials.filter((x) => x.skipped)) lines.push(`- ${t.task} #${t.trial} skipped: ${t.skipped}`);
  if (report.error) lines.push('', `Harness error: ${report.error.split('\n')[0]}`);
  return lines.join('\n') + '\n';
}

main().catch((e) => { console.error(e); process.exit(1); });
