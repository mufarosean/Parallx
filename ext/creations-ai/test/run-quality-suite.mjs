// run-quality-suite.mjs — story-quality benchmark for the Text Generator.
//
// Plays the SAME 9-turn roleplay session through the real extension under
// several parameter configurations, then scores each config on the things
// that make prose feel robotic:
//   - cross-reply repeated phrases (4-grams appearing in 3+ replies)
//   - opening-structure similarity (replies that start the same way)
//   - lexical diversity (type-token ratio)
//   - sentence-cadence variance (uniform sentence lengths = robotic)
//   - reply-length drift (ballooning over turns)
//   - stock LLM tells ("dust motes", "couldn't help but", ...)
//
// Usage:
//   node ext/text-generator/test/run-quality-suite.mjs --mock     # mechanics check
//   node ext/text-generator/test/run-quality-suite.mjs            # live benchmark
//
// Report: ext/text-generator/test/last-quality-report.md (rewritten per config).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  setupDom, makeFakeParallx, waitFor, openChat, sendAndWait, readThreadMessages, writeThread,
} from './live-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const MOCK = args.includes('--mock');
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'qwen3.5-uncensored:latest';
const OLLAMA = 'http://localhost:11434';
const CTX = args.includes('--ctx') ? Number(args[args.indexOf('--ctx') + 1]) : 8192;
const REPORT = path.join(__dirname, args.includes('--report') ? args[args.indexOf('--report') + 1] : 'last-quality-report.md');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

// Style/reminder tuning experiment: prose rules at the TOP of the prompt
// (via the app's Custom writing style setting) plus a character reminder
// that rides the LATE high-attention block every turn. Targets the
// observed failure mode: every reply opening with atmospheric
// scene-dressing, uniform cadence, stock imagery.
const TUNED_STYLE = `Vivid roleplay prose. Hard rules:
- OPENINGS: Never begin two replies the same way. Do not begin with scenery, weather, or light. Begin with dialogue, a physical action, or a direct reaction to the last message.
- Dialogue in "double quotes"; inner thoughts in *italics*; actions in plain prose.
- Vary cadence hard: mix very short sentences with long flowing ones.
- Concrete, specific detail only — no stock imagery (no dancing candlelight, no held breath, no shivers).
- Default to 1-2 paragraphs. Leave room for the other person.
- End mid-beat with a hook — a question, a gesture, an unfinished thought. Never summarize the scene.`;

const TUNED_REMINDER = 'Vary your openings — never start with the room, the light, or the weather. Sometimes answer in a single sharp sentence. Stay precise, warm, quick.';

// One config = one thread + one character clone with these knobs. All are
// settings the app actually exposes (no hardcoded model behavior).
const CONFIGS = [
  { id: 'baseline', label: 'Baseline — immersive-rp, temp 0.7, length inherit', temp: 0.7, presetOverride: '', lengthOverride: '' },
  { id: 'hot', label: 'Hot — immersive-rp, temp 1.05, length inherit', temp: 1.05, presetOverride: '', lengthOverride: '' },
  { id: 'casual', label: 'Casual — casual-rp, temp 0.85, length medium', temp: 0.85, presetOverride: 'casual-rp', lengthOverride: 'medium' },
  {
    id: 'tuned', label: 'Tuned — custom anti-robotic style + late reminder, temp 0.85',
    temp: 0.85, presetOverride: 'custom', lengthOverride: '',
    customStyle: TUNED_STYLE, reminder: TUNED_REMINDER,
  },
];

// Fixed session script — varied registers on purpose: greeting, question,
// action beat, emotional probe, offer, conflict, terse "ok" (balloon
// stress-test), memory prompt, scene-changing suggestion.
const SCRIPT = [
  'hello',
  'What are you working on tonight?',
  '*I hand her a letter that just arrived by courier.* It looks urgent.',
  'You seem troubled. What does it say?',
  'Is there anything I can do to help?',
  "I don't think you should trust him.",
  'ok',
  'Tell me a memory from your childhood.',
  '*I glance at the storm outside.* Perhaps I should stay the night.',
];

const STOCK_TELLS = [
  'shiver down', "couldn't help but", 'a testament to', 'dust motes', 'barely above a whisper',
  'a mixture of', 'eyes sparkling', 'mischievous glint', 'sent a chill', 'unreadable expression',
  'in that moment', 'the air was thick', 'voice barely', 'heart pounding',
];

// ── Metrics ─────────────────────────────────────────────────────────────
function wordsOf(t) { return (t.toLowerCase().match(/[a-z']+/g)) || []; }
function ngrams(ws, n) { const out = []; for (let i = 0; i <= ws.length - n; i++) out.push(ws.slice(i, i + n).join(' ')); return out; }
function sentencesOf(t) { return (t.replace(/\*[^*]*\*/g, ' ').match(/[^.!?]+[.!?]/g) || []).map((s) => wordsOf(s).length).filter((n) => n > 0); }

function scoreConfig(replies) {
  const perReplyGrams = replies.map((r) => new Set(ngrams(wordsOf(r), 4)));
  const gramReplies = new Map();
  perReplyGrams.forEach((set, i) => { for (const g of set) { if (!gramReplies.has(g)) gramReplies.set(g, []); gramReplies.get(g).push(i); } });
  const crossRepeats = [...gramReplies.entries()].filter(([, idxs]) => idxs.length >= 3).map(([g, idxs]) => `"${g}" ×${idxs.length}`);

  const openings = replies.map((r) => wordsOf(r).slice(0, 10).join(' '));
  const openTrigrams = replies.map((r) => wordsOf(r).slice(0, 3).join(' '));
  let similarOpenings = 0;
  for (let i = 1; i < openTrigrams.length; i++) {
    if (openTrigrams.slice(0, i).includes(openTrigrams[i])) similarOpenings++;
  }

  const allWords = replies.flatMap(wordsOf);
  const ttr = allWords.length ? (new Set(allWords).size / allWords.length) : 0;

  const sentLens = replies.flatMap(sentencesOf);
  const mean = sentLens.reduce((a, b) => a + b, 0) / (sentLens.length || 1);
  const cadenceStd = Math.sqrt(sentLens.reduce((a, b) => a + (b - mean) ** 2, 0) / (sentLens.length || 1));

  const lens = replies.map((r) => r.length);
  const firstHalf = lens.slice(0, Math.ceil(lens.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(lens.length / 2);
  const secondHalf = lens.slice(Math.ceil(lens.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(lens.length / 2);
  const drift = firstHalf > 0 ? secondHalf / firstHalf : 1;

  const tells = [];
  for (const tell of STOCK_TELLS) {
    const n = replies.reduce((a, t) => a + (t.toLowerCase().split(tell).length - 1), 0);
    if (n > 0) tells.push(`"${tell}" ×${n}`);
  }

  return {
    crossRepeats, similarOpenings, openings, ttr, cadenceStd,
    meanSentence: mean, avgLen: Math.round(lens.reduce((a, b) => a + b, 0) / (lens.length || 1)),
    drift, tells,
    paragraphCounts: replies.map((r) => r.trim().split(/\n\s*\n/).filter(Boolean).length),
  };
}

// ── Runner ──────────────────────────────────────────────────────────────
const t0 = Date.now();
const sections = [];
const summaryRows = [];

async function writeReport() {
  const out = [
    `# Text Generator — story-quality benchmark`,
    ``,
    `- Date: ${new Date().toISOString()}`,
    `- Mode: ${MOCK ? 'MOCK' : 'LIVE'}  |  Model: ${MODEL}  |  Context: ${CTX}`,
    `- Session: identical ${SCRIPT.length}-turn script per config`,
    `- Elapsed: ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    ``,
    `## Summary`,
    ``,
    `| Config | Repeated 4-grams (3+ replies) | Same-opening replies | Type-token ratio | Cadence stddev | Avg reply chars | Length drift | Stock tells |`,
    `|---|---|---|---|---|---|---|---|`,
    ...summaryRows,
    ``,
    `Reading the numbers: fewer repeated 4-grams and same-openings = less repetitive; higher type-token ratio = richer vocabulary; higher cadence stddev = more varied sentence rhythm (robotic prose is uniform); drift near 1.0 = stable reply lengths.`,
    ``,
    ...sections,
  ];
  await fsp.writeFile(REPORT, out.join('\n'));
}

async function main() {
  const wsDir = path.join(__dirname, `.quality-ws-${Date.now()}`).replace(/\\/g, '/');
  await fsp.mkdir(wsDir, { recursive: true });
  setupDom();
  const { parallx, captured, editorProviders } = makeFakeParallx({
    workspaceDir: wsDir, ollamaUrl: OLLAMA, model: MODEL, mock: MOCK, log: console.log,
  });
  const ext = await import(pathToFileURL(path.join(__dirname, '..', 'main.js')));
  ext.activate(parallx, { subscriptions: [] });

  const charDir = path.join(wsDir, '.parallx', 'extensions', 'text-generator', 'characters');
  const adaFile = path.join(charDir, 'ada-lovelace.json');
  await waitFor(() => fsp.access(adaFile).then(() => true, () => false), 10000, 'scaffolded character');
  const settingsPath = path.join(wsDir, '.parallx', 'extensions', 'text-generator', 'settings.json');
  const adaBase = JSON.parse(await fsp.readFile(adaFile, 'utf8'));

  const activeConfigs = ONLY ? CONFIGS.filter((c) => ONLY.includes(c.id)) : CONFIGS;
  for (const cfg of activeConfigs) {
    console.log(`\n=== CONFIG ${cfg.id}: ${cfg.label} ===`);
    // Settings are re-read on every chat open, so a per-config write is
    // how the custom writing style reaches the 'custom' preset.
    await fsp.writeFile(settingsPath, JSON.stringify({
      defaultContextWindow: CTX, userName: 'Anon', customWritingStyle: cfg.customStyle || '',
    }, null, 2));
    // Character temperature wins over the global default in the app's
    // resolution chain, so the sweep sets it on a per-config clone. The
    // reminder rides the late-stage block every turn (Perchance-style).
    const charName = `ada-${cfg.id}.json`;
    const clone = { ...adaBase, temperature: cfg.temp };
    if (cfg.reminder !== undefined) clone.reminder = cfg.reminder;
    await fsp.writeFile(path.join(charDir, charName), JSON.stringify(clone, null, 2));
    const now = Date.now();
    const threadId = `q-${cfg.id}`;
    await writeThread(wsDir, {
      id: threadId, title: cfg.label, characters: [{ file: charName, addedAt: now }],
      writingPresetOverride: cfg.presetOverride, responseLengthOverride: cfg.lengthOverride,
      createdAt: now, updatedAt: now,
    });

    const { container } = await openChat(editorProviders, threadId);
    const timings = [];
    for (const [i, msg] of SCRIPT.entries()) {
      const rec = await sendAndWait(container, captured, msg);
      timings.push(((rec.endedAt - rec.startedAt) / 1000).toFixed(1) + 's');
      console.log(`  turn ${i + 1}/${SCRIPT.length} done (${timings[timings.length - 1]}, temp=${rec.options?.temperature})`);
    }

    const msgs = await readThreadMessages(wsDir, threadId);
    const replies = msgs.filter((m) => m.author === 'ai' && m.generatedBy === 'model').map((m) => m.content);
    const s = scoreConfig(replies);
    summaryRows.push(
      `| ${cfg.id} | ${s.crossRepeats.length} | ${s.similarOpenings}/${replies.length - 1} | ${s.ttr.toFixed(3)} | ${s.cadenceStd.toFixed(1)} (mean ${s.meanSentence.toFixed(1)}) | ${s.avgLen} | ${s.drift.toFixed(2)}x | ${s.tells.length} |`,
    );
    sections.push([
      `## ${cfg.label}`,
      ``,
      `- Turn timings: ${timings.join(', ')}`,
      `- Paragraphs per reply: ${s.paragraphCounts.join(', ')}${cfg.lengthOverride ? `  (override: ${cfg.lengthOverride})` : ''}`,
      `- Repeated 4-grams across replies: ${s.crossRepeats.length ? s.crossRepeats.slice(0, 12).join('; ') : 'none'}`,
      `- Stock tells: ${s.tells.length ? s.tells.join(', ') : 'none'}`,
      ``,
      `### All reply openings (first 10 words)`,
      ``,
      ...s.openings.map((o, i) => `${i + 1}. ${o}`),
      ``,
      `### Sample replies`,
      ``,
      ...[0, 4, 8].filter((i) => replies[i]).map((i) =>
        `**Turn ${i + 1}** (user: ${JSON.stringify(SCRIPT[i])})\n\n> ${replies[i].trim().slice(0, 1200).replace(/\n/g, '\n> ')}\n`),
    ].join('\n'));
    await writeReport();
  }

  if (!MOCK) {
    try { await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: MODEL, prompt: '', keep_alive: 0 }) }); } catch { /* best effort */ }
  }
  try { await fsp.rm(wsDir, { recursive: true, force: true }); } catch { /* locked */ }
  console.log(`\nDONE — report: ${REPORT}`);
}

main().catch(async (err) => {
  sections.push(`## CRASH\n\n\`\`\`\n${err?.stack || err}\n\`\`\``);
  await writeReport();
  console.error(err);
  process.exit(2);
});
