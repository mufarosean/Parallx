// run-live-tests.mjs — behavioral test suite for the Text Generator extension.
//
// Usage:
//   node ext/text-generator/test/run-live-tests.mjs --mock           # harness self-check, no GPU
//   node ext/text-generator/test/run-live-tests.mjs                  # live run (default model below)
//   node ext/text-generator/test/run-live-tests.mjs --model <tag>
//
// HARD assertions test the wiring (what the model receives) — these are
// deterministic and must pass. SOFT checks test model obedience/quality —
// they report WARN, never fail the run, because a small local model
// ignoring an instruction is information, not a code bug.
//
// Writes a markdown report to ext/text-generator/test/last-live-report.md
// (rewritten after every scenario, so a killed run keeps partial results).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  setupDom, makeFakeParallx, waitFor, openChat, sendAndWait,
  readThreadMessages, readThreadMeta, writeThread, roughTokens,
} from './live-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const MOCK = args.includes('--mock');
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'qwen3.5-uncensored:latest';
const OLLAMA = 'http://localhost:11434';
const CTX = args.includes('--ctx') ? Number(args[args.indexOf('--ctx') + 1]) : 8192;
const REPORT = path.join(__dirname, 'last-live-report.md');

const results = [];
const t0 = Date.now();
function log(...a) { console.log(...a); }
function record(id, name, status, detail = '') {
  results.push({ id, name, status, detail });
  log(`[${status}] ${id} ${name}${detail ? ' — ' + detail.split('\n')[0].slice(0, 140) : ''}`);
}
function hard(id, name, cond, detail = '') { record(id, name, cond ? 'PASS' : 'FAIL', detail); }
function soft(id, name, cond, detail = '') { record(id, name, cond ? 'PASS' : 'WARN', detail); }

function sysPrompt(rec) { return rec.messages[0]?.role === 'system' ? rec.messages[0].content : ''; }
function lateBlock(rec) {
  const sys = rec.messages.filter((m) => m.role === 'system');
  return sys.length > 1 ? sys[sys.length - 1].content : '';
}
function userTurn(rec) {
  const last = rec.messages[rec.messages.length - 1];
  return last?.role === 'user' ? last.content : '';
}
function paragraphs(text) { return (text || '').trim().split(/\n\s*\n/).filter(Boolean); }
function excerpt(text, n = 320) { const t = (text || '').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }

const STOCK_TELLS = [
  'shiver down', "couldn't help but", 'a testament to', 'dust motes', 'barely above a whisper',
  'a mixture of', 'eyes sparkling', 'mischievous glint', 'sent a chill', 'unreadable expression',
  'in that moment', 'the air was thick',
];

async function writeReport(extra = '') {
  const lines = [
    `# Text Generator — live behavioral test report`,
    ``,
    `- Date: ${new Date().toISOString()}`,
    `- Mode: ${MOCK ? 'MOCK (harness self-check, no model)' : 'LIVE'}`,
    `- Model: ${MODEL}  |  Ollama: ${OLLAMA}  |  Context: ${CTX}`,
    `- Elapsed: ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    ``,
    `| # | Check | Result | Detail |`,
    `|---|-------|--------|--------|`,
    ...results.map((r) => `| ${r.id} | ${r.name} | ${r.status} | ${r.detail.replace(/\n/g, ' ').replace(/\|/g, '\\|').slice(0, 220)} |`),
    ``,
    extra,
  ];
  await fsp.writeFile(REPORT, lines.join('\n'));
}

async function main() {
  const wsDir = path.join(__dirname, `.live-ws-${Date.now()}`).replace(/\\/g, '/');
  await fsp.mkdir(wsDir, { recursive: true });
  setupDom();
  const { parallx, captured, editorProviders } = makeFakeParallx({
    workspaceDir: wsDir, ollamaUrl: OLLAMA, model: MODEL, mock: MOCK, log,
  });

  const ext = await import(pathToFileURL(path.join(__dirname, '..', 'main.js')));
  ext.activate(parallx, { subscriptions: [] });
  hard('S0.1', 'extension activates + registers chat editor', editorProviders.has('text-generator-chat'));

  // Wait for the auto-scaffolded example character, then pin settings.
  const charFile = path.join(wsDir, '.parallx', 'extensions', 'text-generator', 'characters', 'ada-lovelace.json');
  await waitFor(() => fsp.access(charFile).then(() => true, () => false), 10000, 'scaffolded character');
  hard('S0.2', 'example character scaffolded', true);
  await fsp.writeFile(
    path.join(wsDir, '.parallx', 'extensions', 'text-generator', 'settings.json'),
    JSON.stringify({ defaultContextWindow: CTX, defaultTemperature: 0.7, userName: 'Anon' }, null, 2),
  );

  const now = Date.now();
  await writeThread(wsDir, { id: 't-basic', title: 'New Chat', characters: [{ file: 'ada-lovelace.json', addedAt: now }], createdAt: now, updatedAt: now });

  // ── S1: basic turn — wiring integrity ─────────────────────────────────
  const { container } = await openChat(editorProviders, 't-basic');
  const r1 = await sendAndWait(container, captured, 'hello');
  hard('S1.1', 'num_ctx equals settings default (budget == num_ctx chain)', r1.options?.numCtx === CTX, `numCtx=${r1.options?.numCtx}`);
  hard('S1.2', 'system prompt contains Cast + Turn Contract', sysPrompt(r1).includes('## Cast') && sysPrompt(r1).includes('## Turn Contract'));
  hard('S1.3', 'active-turn directive rides the user turn', userTurn(r1).includes('Now write the next reply as Ada Lovelace'));
  hard('S1.4', 'wrong-speaker stop tokens sent', Array.isArray(r1.options?.stop) && r1.options.stop.includes('<<Anon>>'), `stop=${JSON.stringify(r1.options?.stop)}`);
  hard('S1.5', 'prompt fits context (rough estimate)', roughTokens(r1.messages.map((m) => m.content).join('\n')) <= CTX * 1.25);
  const msgs1 = await readThreadMessages(wsDir, 't-basic');
  const lastAi1 = [...msgs1].reverse().find((m) => m.author === 'ai');
  hard('S1.6', 'AI reply persisted with correct speaker', !!lastAi1 && lastAi1.name === 'Ada Lovelace', excerpt(lastAi1?.content, 100));
  hard('S1.7', 'no speaker-tag leak in stored reply', !!lastAi1 && !lastAi1.content.includes('<<') && !/^Ada(\s+Lovelace)?\s*:/i.test(lastAi1.content.trim()));
  soft('S1.8', 'reply is substantive (>50 chars)', (lastAi1?.content || '').length > 50, `${(lastAi1?.content || '').length} chars`);
  await writeReport();

  // Drawer helpers ------------------------------------------------------
  const openDrawer = () => { container.querySelector('.tg-input-options-btn').click(); return container.querySelector('.tg-drawer'); };
  const closeDrawer = () => { container.querySelector('.tg-input-options-btn').click(); };
  const drawerSelectWithOption = (drawer, optValue) =>
    [...drawer.querySelectorAll('.tg-drawer-select')].find((s) => [...s.options].some((o) => o.value === optValue));
  const setSelect = (sel, value) => { sel.value = value; sel.dispatchEvent(new window.Event('change')); };

  // ── S2: per-chat response-length override ─────────────────────────────
  let drawer = openDrawer();
  hard('S2.1', 'settings drawer opens', !!drawer);
  // 'short' is unique to the length select ('none' also exists as a
  // preset key in the writing-style select — do not match on it).
  const lenSel = drawerSelectWithOption(drawer, 'short');
  setSelect(lenSel, 'short');
  await new Promise((r) => setTimeout(r, 400));
  closeDrawer();
  const meta2 = await readThreadMeta(wsDir, 't-basic');
  hard('S2.2', 'length override persisted to thread.json', meta2.responseLengthOverride === 'short');
  const r2 = await sendAndWait(container, captured, 'What is the Analytical Engine?');
  hard('S2.3', 'short-length directive in system prompt', sysPrompt(r2).includes('Reply with EXACTLY ONE paragraph'));
  hard('S2.4', 'length hint restated on user turn', userTurn(r2).includes('exactly one paragraph'));
  const msgs2 = await readThreadMessages(wsDir, 't-basic');
  const lastAi2 = [...msgs2].reverse().find((m) => m.author === 'ai');
  soft('S2.5', 'model obeyed short length (≤2 paragraphs)', paragraphs(lastAi2?.content).length <= 2, `${paragraphs(lastAi2?.content).length} paragraphs`);
  await writeReport();

  // ── S3: one-shot director's note ──────────────────────────────────────
  container.querySelector('.tg-director-input').value = 'End your reply with the exact word: nightingale';
  const r3 = await sendAndWait(container, captured, 'Tell me about your work.');
  hard('S3.1', "director's note lands on the user turn", userTurn(r3).includes("Director's note") && userTurn(r3).includes('nightingale'));
  hard('S3.2', 'director input cleared after consumption', container.querySelector('.tg-director-input').value === '');
  const msgs3 = await readThreadMessages(wsDir, 't-basic');
  const lastAi3 = [...msgs3].reverse().find((m) => m.author === 'ai');
  soft('S3.3', 'model obeyed the note (says nightingale)', (lastAi3?.content || '').toLowerCase().includes('nightingale'), excerpt(lastAi3?.content, 120));
  await writeReport();

  // ── S4: standing note (persistent) + one-shot proof ───────────────────
  drawer = openDrawer();
  const standing = drawer.querySelector('.tg-drawer-textarea');
  standing.value = 'Somewhere in every reply, mention the color vermilion.';
  standing.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 400));
  closeDrawer();
  const r4 = await sendAndWait(container, captured, 'And what of Mr. Babbage?');
  hard('S4.1', 'standing note injected in late block', lateBlock(r4).includes("Standing director's note") && lateBlock(r4).includes('vermilion'));
  // One-shot means the NOTE doesn't recur in the instruction channels
  // (user turn / late system block). The word may legitimately appear in
  // history if the model obeyed it last turn.
  hard('S4.2', "previous director's note did NOT recur (one-shot)",
    !userTurn(r4).includes("Director's note") && !lateBlock(r4).includes('nightingale'));
  const msgs4 = await readThreadMessages(wsDir, 't-basic');
  const lastAi4 = [...msgs4].reverse().find((m) => m.author === 'ai');
  soft('S4.3', 'model obeyed standing note (vermilion)', (lastAi4?.content || '').toLowerCase().includes('vermilion'), excerpt(lastAi4?.content, 120));
  await writeReport();

  // ── S5: per-chat writing-preset override + anti-repetition guard ──────
  drawer = openDrawer();
  const presetSel = drawerSelectWithOption(drawer, 'screenplay');
  setSelect(presetSel, 'screenplay');
  await new Promise((r) => setTimeout(r, 400));
  closeDrawer();
  const r5 = await sendAndWait(container, captured, 'Continue the scene.');
  hard('S5.1', 'preset override reaches system prompt', sysPrompt(r5).includes('Write in screenplay format'));
  hard('S5.2', 'late style hint follows the override', lateBlock(r5).includes('Screenplay format:'));
  hard('S5.3', 'standing note persists across turns', lateBlock(r5).includes('vermilion'));
  hard('S5.4', 'anti-repetition guard active by turn 5', lateBlock(r5).includes('Do NOT echo the openings'));
  await writeReport();

  // ── S6: truncation regression (the num_ctx/budget root-cause bug) ─────
  // Model advertises 32K context (fake bridge) while settings say 4096.
  // Pre-fix code budgeted at 32K and shipped a prompt Ollama silently
  // truncated FROM THE TOP. Post-fix, history must be trimmed to fit.
  const fat = [];
  for (let i = 0; i < 40; i++) {
    const user = i % 2 === 0;
    fat.push({
      id: `seed-${i}`,
      author: user ? 'user' : 'ai',
      name: user ? 'Anon' : 'Ada Lovelace',
      characterFile: user ? null : 'ada-lovelace.json',
      content: `Turn ${i}: ${'The Analytical Engine weaves algebraic patterns just as the Jacquard loom weaves flowers and leaves, and we discussed this at considerable length. '.repeat(9)}`,
      timestamp: now + i, generatedBy: user ? 'human' : 'model', hiddenFrom: null,
    });
  }
  await writeThread(wsDir, { id: 't-long', title: 'Long Chat', characters: [{ file: 'ada-lovelace.json', addedAt: now }], createdAt: now, updatedAt: now }, fat);
  const { container: cB } = await openChat(editorProviders, 't-long');
  const diskChars = fat.reduce((a, m) => a + m.content.length, 0);
  const r6 = await sendAndWait(cB, captured, 'What did we just discuss?');
  const sentChars = r6.messages.reduce((a, m) => a + m.content.length, 0);
  const sentHistoryCount = r6.messages.filter((m) => m.role !== 'system').length;
  hard('S6.1', 'num_ctx honored on long thread', r6.options?.numCtx === CTX, `numCtx=${r6.options?.numCtx}`);
  hard('S6.2', 'history trimmed to fit window', sentHistoryCount < 40 && roughTokens(r6.messages.map((m) => m.content).join('\n')) <= CTX * 1.25,
    `sent ${sentHistoryCount}/40 msgs, ${sentChars} of ${diskChars} chars`);
  hard('S6.3', 'system prompt survives trimming intact', sysPrompt(r6).includes('## Turn Contract'));
  await writeReport();

  // ── S7: regenerate keeps variants ─────────────────────────────────────
  const aiRows = [...container.querySelectorAll('.tg-msg--ai')];
  const lastRow = aiRows[aiRows.length - 1];
  const regenBtn = lastRow?.querySelector('button[title="Regenerate this turn"]');
  hard('S7.1', 'regenerate affordance present', !!regenBtn);
  if (regenBtn) {
    const before = captured.length;
    regenBtn.click();
    await waitFor(() => captured.length > before, 420000, 'regen request');
    const rec = captured[captured.length - 1];
    await waitFor(() => rec.endedAt !== null, 420000, 'regen stream end');
    await waitFor(async () => {
      const m = await readThreadMessages(wsDir, 't-basic');
      const ai = [...m].reverse().find((x) => x.author === 'ai');
      return Array.isArray(ai?.variants) && ai.variants.length >= 2;
    }, 30000, 'variants persisted');
    hard('S7.2', 'regenerate produced a stored variant set', true);
  }
  await writeReport();

  // ── Quality scan + prompt dump ────────────────────────────────────────
  const allMsgs = await readThreadMessages(wsDir, 't-basic');
  const aiTexts = allMsgs.filter((m) => m.author === 'ai' && m.generatedBy === 'model').map((m) => m.content);
  const tells = [];
  for (const tell of STOCK_TELLS) {
    const n = aiTexts.reduce((a, t) => a + (t.toLowerCase().split(tell).length - 1), 0);
    if (n > 0) tells.push(`"${tell}" ×${n}`);
  }
  record('Q1', 'stock LLM-phrase scan across replies', 'INFO', tells.length ? tells.join(', ') : 'no stock tells detected');
  const timings = captured.filter((r) => r.endedAt).map((r, i) => `req${i + 1}: ${((r.endedAt - r.startedAt) / 1000).toFixed(1)}s, ${r.reply.length} chars${r.thinkingChars ? `, think ${r.thinkingChars}ch` : ''}`);

  const extra = [
    `## Request timings`, '', ...timings.map((t) => `- ${t}`), '',
    `## Sample replies (thread t-basic)`, '',
    ...aiTexts.slice(0, 6).map((t, i) => `### Reply ${i + 1}\n\n> ${excerpt(t, 900).replace(/\n/g, '\n> ')}\n`),
    `## Exact prompt of request 1 (inspector view)`, '',
    '```',
    ...(captured[0]?.messages || []).map((m) => `--- ${m.role} ---\n${m.content}`),
    '```',
  ].join('\n');
  await writeReport(extra);

  // Courtesy: release VRAM on the study machine.
  if (!MOCK) {
    try { await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: MODEL, prompt: '', keep_alive: 0 }) }); } catch { /* best effort */ }
  }

  // Keep the workspace for post-mortem unless everything passed.
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const warns = results.filter((r) => r.status === 'WARN').length;
  if (fails === 0) { try { await fsp.rm(wsDir, { recursive: true, force: true }); } catch { /* locked file */ } }
  log(`\nDONE: ${results.filter((r) => r.status === 'PASS').length} pass, ${warns} warn, ${fails} fail — report: ${REPORT}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (err) => {
  record('CRASH', 'suite crashed', 'FAIL', String(err?.stack || err));
  await writeReport();
  console.error(err);
  process.exit(2);
});
