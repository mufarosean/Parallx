// chat-context-assessment.mjs: when does the chat compact, and why? Measured,
// not read from the code.
//
// Runs a hidden app on a throwaway workspace set up like the owner's (a real
// local model at a large context, study notes, indexing on) and sits between
// the app and Ollama: every /api/chat request is recorded with its size broken
// down (system prompt, tool definitions, history by role, tool-call
// arguments, tool results, retrieved context), the num_ctx it asked for, and
// Ollama's own token counts from the answer. A request whose system prompt is
// the compaction summarizer is marked as a compaction. A ten-turn study
// session drives it, tool-heavy on purpose: reading eight large notes in full,
// searches with quoted hits, writing and re-reading a long page, a mini-app,
// an extension, a question about something said earlier, and a recap.
// The app's code is not changed; this talks to the person's Ollama (run it
// only with their OK).
//
// Usage: node tests/probes/chat-context-assessment.mjs <outDir> [model] [contextTokens] [turns=1-10]

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-context-assessment'));
const MODEL = process.argv[3] ?? 'qwen3.8:latest';
const CONTEXT = Number(process.argv[4] ?? 163840);
const RANGE = (process.argv[5] ?? 'turns=1-12').replace('turns=', '').split('-').map(Number);
const PER_TURN_MS = 9 * 60_000;

const TURNS = [
  'List every file in my workspace, then read all of my reserving notes in full and give me one paragraph on each.',
  'Search my notes for every mention of "variance" and of "credibility" and quote each hit with its file and section.',
  'Read the Mack notes again in full and build a table of all the assumptions, with where each one is used in the calculation.',
  'Read the Clark and the Shapland notes in full and compare how they get the variance of the reserve, section by section.',
  'Create a canvas page called "Reserving Review" with a full summary of all my notes, one section per paper, including the formulas.',
  'Read the page you just created and add a "Common mistakes" section at the end, pulling from the exam traps in every note.',
  'Make me a mini-app that computes age-to-age factors and a chain-ladder reserve from a small triangle I type in.',
  'Build an extension with a tab where I log practice exam scores, and a chat tool so you can add a score for me.',
  'Search all my notes for "formula" and list every formula mentioned, with the file and section it is in.',
  'What did we conclude earlier about how Clark and Shapland differ on variance? Quote the key point you made.',
  'Read all my notes once more and write 10 exam questions covering every paper, with worked answers.',
  'Summarize everything we did in this chat as a checklist, and list every file or page we created or changed.',
];

// ── Study notes like the owner's: real sections, realistic size ────────────
const NOTES = {
  'Mack 1994 - Chain Ladder Variance.md': ['Mack (1994)', ['The chain ladder as a stochastic model', 'Assumption 1: expected development is proportional to the latest diagonal', 'Assumption 2: accident years are independent', 'Assumption 3: variance of the next value is proportional to the current value', 'Estimating the age-to-age factors as volume-weighted averages', 'Estimating sigma squared for each development age', 'Process variance and parameter variance of the reserve', 'Mean squared error of the total reserve and correlation between years', 'Testing the assumptions with residual plots', 'Exam traps and common mistakes']],
  'Bornhuetter-Ferguson.md': ['Bornhuetter and Ferguson (1972)', ['Why an a priori expected loss ratio', 'The BF ultimate formula', 'Credibility view: weighting chain ladder and expected losses', 'Behaviour in immature accident years', 'Benktander as iterated BF', 'Choosing the expected loss ratio', 'Sensitivity to rate changes', 'Exam traps and common mistakes']],
  'Clark - LDF Curve Fitting.md': ['Clark (2003)', ['Growth curves: loglogistic and Weibull', 'Expected emergence between two ages', 'Maximum likelihood with an over-dispersed Poisson', 'The Cape Cod and LDF methods', 'Variance of the reserve: process and parameter', 'Truncating the tail', 'Residual checks', 'Exam traps and common mistakes']],
  'Shapland - Bootstrap ODP.md': ['Shapland (2016)', ['The over-dispersed Poisson GLM and chain ladder', 'Pearson residuals and their adjustment', 'Sampling pseudo triangles', 'Process variance in the simulated future', 'Heteroscedasticity and hetero adjustment factors', 'Negative incremental values', 'Diagnostics and model weighting', 'Exam traps and common mistakes']],
  'Brosius - Least Squares Development.md': ['Brosius (1993)', ['Least squares as a linear credibility estimate', 'The Bayesian credibility link', 'When the slope is negative', 'Comparing with chain ladder and budgeted loss', 'Caseload effect', 'Exam traps and common mistakes']],
  'Friedland - Case Outstanding and Frequency Severity.md': ['Friedland (2010)', ['Case outstanding development technique', 'Frequency and severity methods', 'Disposal rate method', 'Berquist-Sherman adjustments for case reserves', 'Berquist-Sherman adjustments for settlement rates', 'Exam traps and common mistakes']],
  'Marshall - Correlations and Risk Margins.md': ['Marshall et al. (2008)', ['Independent and systemic risk', 'Internal and external systemic risk', 'Correlation between valuation classes', 'Coefficients of variation and risk margins', 'Balanced scorecard approach', 'Exam traps and common mistakes']],
  'Siewert - Excess of Loss Reserving.md': ['Siewert (1996)', ['Limited and excess development factors', 'Loss ratio method for excess layers', 'Implied development', 'Severity relationships across limits', 'Exam traps and common mistakes']],
};
const paragraph = (paper, topic, i) => `${paper} on ${topic.toLowerCase()}: point ${i + 1}. The idea here is that the analyst should be able to state the assumption, `
  + 'show where it enters the calculation, and explain what happens to the estimate when it fails. Write the formula, define every symbol, and work one '
  + 'small example by hand with a 4 by 4 triangle so the arithmetic is checked. Note the link to the other readings and the usual exam wording.';
function noteText(title, sections) {
  return `# ${title}\n\n` + sections.map((s) => `## ${s}\n\n${Array.from({ length: 14 }, (_, i) => paragraph(title, s, i)).join('\n\n')}\n`).join('\n');
}

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

const chars = (v) => (typeof v === 'string' ? v.length : JSON.stringify(v ?? '').length);

/** One /api/chat request, measured. */
function measureRequest(body) {
  const messages = body.messages ?? [];
  const system = messages.filter((m) => m.role === 'system');
  const kind = system.some((m) => String(m.content).includes('You are compacting an agent conversation')) ? 'compaction' : 'turn';
  const byRole = {};
  let toolCallArgs = 0;
  let retrieved = 0;
  for (const m of messages) {
    byRole[m.role] = (byRole[m.role] ?? 0) + chars(m.content);
    for (const tc of m.tool_calls ?? []) toolCallArgs += chars(tc.function?.arguments);
    if (/Retrieved Context|Recalled Memories|Recalled Transcripts|Active Plan|Since Your Last Turn/.test(String(m.content))) retrieved += chars(m.content);
  }
  return {
    kind,
    numCtx: body.options?.num_ctx ?? null,
    think: body.think ?? null,
    messages: messages.length,
    systemChars: system.reduce((n, m) => n + chars(m.content), 0),
    tools: (body.tools ?? []).length,
    toolSchemaChars: chars(body.tools ?? []),
    userChars: byRole.user ?? 0,
    assistantChars: byRole.assistant ?? 0,
    toolResultChars: byRole.tool ?? 0,
    toolCallArgChars: toolCallArgs,
    standingContextChars: retrieved,
    totalChars: chars(messages) + chars(body.tools ?? []),
  };
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `px-ctx-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `px-ctx-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(ws, '.parallx'), { recursive: true });
  await fs.mkdir(path.join(ws, 'Notes'), { recursive: true });
  for (const [file, [title, sections]] of Object.entries(NOTES)) await fs.writeFile(path.join(ws, 'Notes', file), noteText(title, sections));
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  await fs.writeFile(path.join(ws, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { model: { chatModel: MODEL, contextWindow: CONTEXT } } }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');

  const requests = [];
  let turnNo = 0;
  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  // The recorder: every chat request to Ollama passes through, measured, with Ollama's own counts.
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\/api\/chat/, async (route) => {
    let body = {};
    try { body = route.request().postDataJSON() ?? {}; } catch { /* not JSON */ }
    const rec = { turn: turnNo, at: Date.now(), ...measureRequest(body) };
    try {
      const resp = await route.fetch({ timeout: 0 });
      const text = await resp.text();
      const last = text.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).pop() ?? {};
      Object.assign(rec, { promptTokens: last.prompt_eval_count ?? null, answerTokens: last.eval_count ?? null, promptSeconds: last.prompt_eval_duration ? +(last.prompt_eval_duration / 1e9).toFixed(1) : null, seconds: +((Date.now() - rec.at) / 1000).toFixed(1) });
      requests.push(rec);
      await route.fulfill({ response: resp, body: text });
    } catch (e) {
      rec.error = String(e).slice(0, 160);
      requests.push(rec);
      await route.abort('failed').catch(() => {});
    }
  });
  const page = await app.firstWindow();
  const turns = [];
  try {
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(8_000); // indexing of the notes starts on its own
    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
    const cmd = (id, ...a) => page.evaluate(({ id, a }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...a), { id, a });
    await cmd('chat.show');
    for (let i = 0; i < 30; i++) {
      const ok = await page.evaluate((m) => Promise.resolve(window.__parallx_workbench__._services.get({ id: 'ILanguageModelsService' }).getModels?.()).then((ms) => (ms ?? []).some((x) => x.id === m)), MODEL).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(1_000);
    }
    await page.evaluate((m) => window.__parallx_workbench__._services.get({ id: 'ILanguageModelsService' }).setActiveModel(m), MODEL);
    await cmd('chat.newSession');
    await page.waitForTimeout(800);

    for (let t = RANGE[0]; t <= (RANGE[1] ?? RANGE[0]); t++) {
      turnNo = t;
      const started = Date.now();
      const before = requests.length;
      await cmd('chat.submitPrompt', { text: TURNS[t - 1] });
      let done = false;
      while (Date.now() - started < PER_TURN_MS) {
        await page.waitForTimeout(3_000);
        // Approve tool calls and app permissions the way the person would.
        await page.evaluate(() => {
          for (const b of document.querySelectorAll('.parallx-chat-approval-btn--primary')) b.click();
          const perm = [...document.querySelectorAll('.px-app-permission button')].find((b) => b.textContent.trim() === 'Always Allow');
          perm?.click();
        }).catch(() => {});
        done = await page.evaluate(() => {
          const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
          const s = [...svc.getSessions()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
          const last = s?.messages?.[s.messages.length - 1];
          return !!last?.response?.isComplete;
        }).catch(() => false);
        if (done) break;
      }
      await page.waitForTimeout(1_500);
      const mine = requests.slice(before);
      const answer = await page.evaluate(() => {
        const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
        const s = [...svc.getSessions()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
        const last = s?.messages?.[s.messages.length - 1];
        return (last?.response?.parts ?? []).filter((p) => p.kind === 'markdown').map((p) => p.content).join('\n').slice(0, 1200);
      }).catch(() => '');
      const progress = await page.evaluate(() => [...document.querySelectorAll('.parallx-chat-progress, [class*="progress"]')].map((e) => e.textContent.trim()).filter((t) => /compact|summar/i.test(t)).slice(-4)).catch(() => []);
      const row = {
        turn: t, seconds: Math.round((Date.now() - started) / 1000), finished: done,
        requests: mine.length, compactions: mine.filter((r) => r.kind === 'compaction').length,
        maxPromptTokens: Math.max(0, ...mine.filter((r) => r.kind === 'turn').map((r) => r.promptTokens ?? 0)),
        compactionNotes: progress, answer,
      };
      turns.push(row);
      console.log(`[ctx] turn ${t}: ${row.seconds}s requests=${row.requests} compactions=${row.compactions} maxPrompt=${row.maxPromptTokens} finished=${done}`);
      for (const r of mine) console.log(`    ${r.kind.padEnd(10)} msgs=${r.messages} sys=${r.systemChars} tools=${r.tools}/${r.toolSchemaChars}ch hist(u/a/t)=${r.userChars}/${r.assistantChars}/${r.toolResultChars} args=${r.toolCallArgChars} standing=${r.standingContextChars} numCtx=${r.numCtx} promptTok=${r.promptTokens} ${r.promptSeconds ?? ''}s`);
      await fs.writeFile(path.join(outDir, 'assessment.json'), JSON.stringify({ model: MODEL, context: CONTEXT, turns, requests }, null, 2));
    }
  } finally {
    await app.close();
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
