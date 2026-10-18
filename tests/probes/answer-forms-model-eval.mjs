// answer-forms-model-eval.mjs: can a REAL model use the answer forms, write
// mini-apps and build extensions? Unlike every other probe this one talks to
// the person's Ollama on purpose (run it only with their OK): a hidden app on
// a throwaway workspace, the chosen model at the chosen context, each prompt
// in a fresh chat through the normal pipeline. For every reply it records
// what the model wrote, which forms drew and which fell back to code, errors,
// and for mini-apps whether the app's script ran; extensions are installed
// from the review and checked running. Writes results.json and screenshots.
//
// Usage: node tests/probes/answer-forms-model-eval.mjs <outDir> [model] [contextTokens] [only=1,5,12]
// Requires `npm run build` first. Indexing is off, so no embeddings are made.

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-forms-eval'));
const MODEL = process.argv[3] ?? 'qwen3.8:latest';
const CONTEXT = Number(process.argv[4] ?? 163840);
const ONLY = (process.argv[5] ?? '').replace(/^only=/, '').split(',').filter(Boolean).map(Number);
const PER_PROMPT_MS = 8 * 60_000;
// The same style checks the app runs (Node strips the types).
const { lintMiniApp, lintStyleSource, lintActionLabels, actionLabelsInCode } = await import('../../src/ui/styleLint.ts');

/**
 * A live style audit of what is on screen inside `rootSelector` (run in a
 * frame or the page): controls without a name, text below 4.5:1 contrast
 * (3:1 when large), type sizes off the scale, uppercase text, button words.
 */
function liveAudit(rootSelector) {
  const root = [...document.querySelectorAll(rootSelector)].reverse().find((e) => e.getClientRects().length && e.textContent.trim()) ?? document.body;
  const SCALE = new Set([10, 11, 12, 13, 15, 18, 22]);
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 22, g: 23, b: 26, a: 1 }; };
  const controls = [...root.querySelectorAll('input, select, textarea, button')].filter((e) => e.getClientRects().length && e.type !== 'hidden');
  const unnamed = controls.filter((e) => !(e.getAttribute('aria-label') || e.labels?.length || e.getAttribute('aria-labelledby') || e.title || (e.tagName === 'BUTTON' && e.textContent.trim())));
  let lowContrast = 0; const offScale = new Set(); let upper = 0;
  for (const el of root.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    if (!SCALE.has(Math.round(size))) offScale.add(Math.round(size));
    if (cs.textTransform === 'uppercase') upper++;
    const fg = parse(cs.color); const bg = bgOf(el);
    if (fg && bg) { const [L1, L2] = [lum(fg), lum(bg)].sort((a, b) => b - a); const ratio = (L1 + 0.05) / (L2 + 0.05); const large = size >= 18 || (size >= 14 && Number(cs.fontWeight) >= 600); if (ratio < (large ? 3 : 4.5)) lowContrast++; }
  }
  return {
    controls: controls.length,
    unnamed: unnamed.length,
    lowContrast,
    offScaleSizes: [...offScale],
    uppercase: upper,
    buttonLabels: controls.filter((e) => e.tagName === 'BUTTON').map((b) => b.textContent.trim()).filter(Boolean),
  };
}

/** One list of style findings from the source check and the live audit. */
function styleFindings(sourceIssues, live) {
  const out = sourceIssues.map((i) => `${i.rule} (${i.detail})`);
  if (live) {
    if (live.unnamed) out.push(`${live.unnamed} of ${live.controls} controls have no name`);
    if (live.lowContrast) out.push(`${live.lowContrast} text elements below contrast`);
    if (live.offScaleSizes.length) out.push(`type sizes off the scale: ${live.offScaleSizes.join(', ')}px`);
    if (live.uppercase) out.push(`${live.uppercase} uppercase text elements`);
    for (const i of lintActionLabels(live.buttonLabels)) out.push(`${i.rule} (${i.detail})`);
  }
  return [...new Set(out)];
}

const PROMPTS = [
  { kind: 'form', expect: 'any', text: 'Compare how the chain ladder and Bornhuetter-Ferguson methods treat immature accident years.' },
  { kind: 'form', expect: 'chart', text: 'My monthly spending: rent 1450, food 620, transport 310, utilities 180, other 240. Which costs dominate? Show me.' },
  { kind: 'form', expect: 'timeline', text: 'Lay out my exam timeline: practice exams on Oct 6, Oct 13 and Oct 20, today is Oct 18, and the sitting is Oct 27.' },
  { kind: 'form', expect: 'live', text: 'If I save $500 a month for 18 months toward a $12,000 goal, how much is left? I want to try other numbers too.' },
  { kind: 'form', expect: 'worked', text: 'Walk me through, one step at a time, the reserve for an accident year with 4,200 paid where the growth curve gives G = 0.80 at its age.' },
  { kind: 'form', expect: 'any', text: 'What is the single most important idea about why age-to-age development factors decline with age?' },
  { kind: 'form', expect: 'live', text: 'Show how a loan payment depends on rate and term so I can play with the numbers: $20,000 over 5 years at 6% a year, paid monthly.' },
  { kind: 'form', expect: 'mindmap', text: 'Map out the main families of loss reserving methods and how they relate to each other.' },
  { kind: 'form', expect: 'chart', text: 'Plot the age-to-age factors 1.65, 1.21, 1.08, 1.03 and 1.01 for ages 12-24 through 60-72 and tell me what they show.' },
  { kind: 'form', expect: 'worked', text: 'Work through, step by step, the percentage increase from 60 to 72.' },
  { kind: 'app', text: 'Make me a mini-app with a slider for the tail factor from 1.00 to 1.20 that shows how the reserve changes, for 4,200 paid and a factor to ultimate of 1.25 before the tail.' },
  { kind: 'app', text: 'Build a small interactive tool that converts recipe amounts from cups, tablespoons and ounces to grams and millilitres.' },
  { kind: 'app', text: 'Make a mini-app: a focus timer with start, pause and reset, 25 minutes by default.' },
  { kind: 'app', text: 'Create an interactive app where I type a small cumulative loss triangle and it computes the age-to-age factors and their averages.' },
  { kind: 'ext', text: 'Build an extension that gives the chat a tool to convert temperatures between Celsius and Fahrenheit.' },
  { kind: 'ext', text: 'Build an extension with a command that opens a tab where I can keep a short list of exam dates.' },
  { kind: 'ext', text: 'Build an extension that adds a page block showing how many days are left until a date I set in its settings.' },
];

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

async function shot(page, file, selector) {
  try {
    if (selector) await page.locator(selector).last().scrollIntoViewIfNeeded({ timeout: 3_000 });
    await page.screenshot({ path: file, timeout: 10_000 });
  } catch (e) { console.log(`[eval] screenshot failed ${path.basename(file)}: ${String(e).slice(0, 80)}`); }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `px-eval-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `px-eval-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(ws, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  await fs.writeFile(path.join(ws, '.parallx', 'ai-config.json'), JSON.stringify({
    overrides: { indexing: { autoIndex: false, watchFiles: false }, model: { chatModel: MODEL, contextWindow: CONTEXT } },
  }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');

  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const page = await app.firstWindow();
  let log = [];
  page.on('console', (m) => { if (m.type() === 'error') log.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log.push(`pageerror: ${String(e).slice(0, 300)}`));
  const results = [];
  try {
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(4_000);
    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
    const cmd = (id, ...a) => page.evaluate(({ id, a }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...a), { id, a });
    await cmd('chat.show');
    // Wait for the model list, then pick the model.
    for (let i = 0; i < 30; i++) {
      const ok = await page.evaluate((m) => {
        const lms = window.__parallx_workbench__._services.get({ id: 'ILanguageModelsService' });
        return Promise.resolve(lms.getModels?.()).then((ms) => (ms ?? []).some((x) => x.id === m));
      }, MODEL).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(1_000);
    }
    await page.evaluate((m) => window.__parallx_workbench__._services.get({ id: 'ILanguageModelsService' }).setActiveModel(m), MODEL);
    console.log(`[eval] model ${MODEL}, context ${CONTEXT}`);

    for (let n = 0; n < PROMPTS.length; n++) {
      if (ONLY.length && !ONLY.includes(n + 1)) continue;
      const p = PROMPTS[n];
      log = [];
      await cmd('chat.newSession');
      await page.waitForTimeout(500);
      const started = Date.now();
      const sessionId = await page.evaluate(() => {
        const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
        return [...svc.getSessions()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]?.id ?? null;
      });
      const reviewsBefore = await page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).filter((t) => /^Review:/.test(t.textContent.trim())).length);
      await cmd('chat.submitPrompt', { text: p.text });
      // Wait for the reply to finish.
      let state = null;
      while (Date.now() - started < PER_PROMPT_MS) {
        await page.waitForTimeout(3_000);
        state = await page.evaluate((sid) => {
          const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
          const s = svc.getSession(sid) ?? [...svc.getSessions()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
          const last = s?.messages?.[s.messages.length - 1];
          const approval = !!document.querySelector('.parallx-chat-approval, [class*="confirmation"] button');
          return { done: !!last?.response?.isComplete, approval, parts: (last?.response?.parts ?? []).map((x) => ({ kind: x.kind, tool: x.toolName ?? x.name ?? x.toolId ?? undefined, error: x.isError || undefined, content: typeof x.content === 'string' ? x.content : undefined, args: (x.toolName ?? x.name) === 'extension_propose' ? (x.args ?? x.parameters ?? x.input) : undefined })) };
        }, sessionId);
        if (state.done) break;
      }
      await page.waitForTimeout(1_500);
      const seconds = Math.round((Date.now() - started) / 1000);
      const dom = await page.evaluate(() => {
        const answers = Array.from(document.querySelectorAll('.parallx-chat-markdown')).filter((e) => e.getClientRects().length);
        const last = answers[answers.length - 1];
        const scope = last?.closest('[class*="message"], [class*="turn"]')?.parentElement ?? document;
        return {
          forms: Array.from(document.querySelectorAll('.px-af-host')).filter((e) => e.getClientRects().length).map((e) => e.getAttribute('data-af-form')),
          codeFences: Array.from(document.querySelectorAll('.parallx-chat-markdown pre code')).filter((e) => e.getClientRects().length).map((e) => (e.className.match(/language-([\w-]+)/) ?? [])[1] ?? 'plain'),
          liveInputs: document.querySelectorAll('.px-af-live__in').length,
          appFrames: document.querySelectorAll('.px-af-app__frame').length,
          reviewTabs: Array.from(document.querySelectorAll('[role="tab"]')).filter((t) => /^Review:/.test(t.textContent.trim())).length,
          reviewOpen: !!Array.from(document.querySelectorAll('.px-xr__card')).find((c) => c.getClientRects().length),
          reviewChecks: document.querySelector('.px-xr__checks')?.textContent?.trim() ?? null,
          scopeOk: !!scope,
        };
      });
      const markdown = (state?.parts ?? []).filter((x) => x.kind === 'markdown').map((x) => x.content).join('\n');
      const toolCalls = (state?.parts ?? []).filter((x) => x.kind === 'toolInvocation').map((x) => `${x.tool ?? '?'}${x.error ? ' (error)' : ''}`);
      const r = { n: n + 1, kind: p.kind, expect: p.expect, prompt: p.text, seconds, finished: !!state?.done, stuckOnApproval: !!state?.approval && !state?.done, ...dom, toolCalls, errors: [...new Set(log.filter((e) => !/favicon|11434\/api\/(embed|embeddings)/.test(e)))].slice(0, 6) };

      // Mini-apps: did the script run, and what is in the app?
      if (p.kind === 'app' && dom.appFrames > 0) {
        await page.locator('.px-af-app__frame').last().scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(1_500);
        const frames = page.frames().filter((f) => f.url().startsWith('parallx-frame:'));
        const f = frames[frames.length - 1];
        r.app = f ? await f.evaluate(() => ({
          text: document.body.innerText.slice(0, 300),
          controls: document.querySelectorAll('input, button, select, textarea').length,
          unlabeled: Array.from(document.querySelectorAll('input, select, textarea')).filter((e) => !e.labels?.length && !e.getAttribute('aria-label')).length,
          canvas: document.querySelectorAll('canvas, svg').length,
        })).catch((e) => ({ error: String(e).slice(0, 120) })) : { error: 'no frame' };
        // Poke the first control and see whether anything changes.
        if (f && r.app.controls) {
          r.app.reacts = await f.evaluate(async () => {
            const before = document.body.innerText;
            const el = document.querySelector('input[type="range"], input[type="number"], input, button');
            if (!el) return false;
            if (el.tagName === 'BUTTON') el.click();
            else { el.value = el.type === 'range' ? String(Number(el.max || 100)) : '7'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
            await new Promise((res) => setTimeout(res, 1200));
            return document.body.innerText !== before;
          }).catch(() => null);
        }
        // Style: the source against the house rules, and what the running app shows.
        const src = await page.evaluate(() => {
          const h = [...document.querySelectorAll('.px-af-host[data-af-form="app"]')].pop();
          try { return decodeURIComponent(h?.getAttribute('data-af-src') ?? ''); } catch { return ''; }
        });
        const live = f ? await f.evaluate(liveAudit, 'body').catch(() => null) : null;
        r.style = styleFindings(lintMiniApp(src), live);
      }

      // Extensions: install from the review and check it runs.
      // Only a review this prompt opened counts (an earlier one stays open in its tab).
      dom.reviewOpen = dom.reviewOpen && dom.reviewTabs > reviewsBefore;
      if (p.kind === 'ext' && dom.reviewOpen) {
        await shot(page, path.join(outDir, `${String(n + 1).padStart(2, '0')}-review.png`), '.px-xr__card');
        await page.locator('.px-xr__actions button', { hasText: 'Install' }).last().click().catch(() => {});
        await page.waitForTimeout(4_000);
        const proposals = (state?.parts ?? []).filter((x) => x.args);
        r.draft = proposals[proposals.length - 1]?.args ?? null;
        await fs.writeFile(path.join(outDir, `${String(n + 1).padStart(2, '0')}-draft.json`), JSON.stringify(r.draft, null, 2));
        r.install = await page.evaluate(() => {
          const outcome = document.querySelector('.px-xr__outcome')?.textContent?.trim() ?? null;
          const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTools().map((t) => t.name);
          return { outcome, toolsNow: tools.filter((t) => !/^(fs_|canvas_|web|app__|activity|plan_|mind_|link_|cron|sessions_|surface_|terminal|python|memory|transcript|dashboard|extension_propose|workflow)/.test(t)) };
        });
      }

      // An installed extension: did it start, do its commands open something, did its chat tools register?
      if (r.install) {
        const asObj = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : (v ?? {}));
        const manifest = asObj(r.draft?.manifest);
        const files = asObj(r.draft?.files);
        const commands = (manifest?.contributes?.commands ?? []).map((c) => c.id);
        const toolNames = [...String(files['main.js'] ?? '').matchAll(/registerTool\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
        r.activation = manifest?.activationEvents ?? null;
        r.works = await page.evaluate(async ({ commands, toolNames }) => {
          const svc = window.__parallx_workbench__._services;
          const cmds = svc.get({ id: 'ICommandService' });
          const before = document.querySelectorAll('[role="tab"]').length;
          const ran = [];
          for (const c of commands) {
            try { await cmds.executeCommand(c); ran.push(`${c}: ran`); } catch (e) { ran.push(`${c}: ERR ${String(e?.message ?? e).slice(0, 80)}`); }
          }
          await new Promise((res) => setTimeout(res, 1500));
          const tools = svc.get({ id: 'ILanguageModelToolsService' });
          return { ran, newTabs: document.querySelectorAll('[role="tab"]').length - before, toolsRegistered: toolNames.map((t) => `${t}: ${tools.getTool(t) ? 'yes' : 'NO'}`) };
        }, { commands, toolNames });
        // Style: the code against the house rules, and the tab it opened, if any.
        const live = r.works.newTabs > 0 ? await page.evaluate(liveAudit, '.editor-pane').catch(() => null) : null;
        const code = String(files['main.js'] ?? '');
        r.style = styleFindings([...lintStyleSource(code), ...lintActionLabels(actionLabelsInCode(code))], live);
        await shot(page, path.join(outDir, `${String(n + 1).padStart(2, '0')}-after-install.png`));
        delete r.draft;
      }
      await shot(page, path.join(outDir, `${String(n + 1).padStart(2, '0')}-${p.kind}.png`), dom.appFrames ? '.px-af-app' : '.parallx-chat-markdown');
      await fs.writeFile(path.join(outDir, `${String(n + 1).padStart(2, '0')}-reply.md`), `# ${p.text}\n\n${markdown}\n\nTool calls: ${toolCalls.join(', ') || 'none'}\n`);
      results.push(r);
      console.log(`[eval] ${r.n} ${p.kind} ${seconds}s finished=${r.finished} forms=${dom.forms.join('|') || '-'} code=${dom.codeFences.join('|') || '-'} tools=${toolCalls.join('|') || '-'}${r.app ? ` app=${JSON.stringify(r.app).slice(0, 160)}` : ''}${r.install ? ` install=${String(r.install.outcome).slice(0, 25)} activation=${JSON.stringify(r.activation)} works=${JSON.stringify(r.works)}` : ''} errors=${r.errors.length}${r.style ? ` style=${r.style.length}${r.style.map((s) => `\n    - ${s}`).join('')}` : ''}`);
      await fs.writeFile(path.join(outDir, 'results.json'), JSON.stringify({ model: MODEL, context: CONTEXT, results }, null, 2));
    }
  } finally {
    await app.close();
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
