// run-card-standard.mjs — does the app write cards to the card standard?
// Sends the Studio's own sheet request (studio-core.js buildSheetMessages,
// at the Studio's settings: thinking on, JSON, temperature 0.9) for a set of
// short concepts of the kind a person types, including concepts that state
// a rule ("always says arr"), and reads each card with card-rules.js. The
// report shows Voice, Personality and Reminder as written, with the findings,
// so the session can read them. The sheets are kept beside the cache for a
// play with the same cards (run-reading-bench.mjs --cast c).
//
//   node ext/creations-ai/test/run-card-standard.mjs --pass play --num-ctx 65536
//   options: see harness-common.mjs (--model, --num-ctx, --cache, --report, --replay, --only)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSheetMessages, parseJsonLoose, cleanSheet, parseSheetStructure, DEFAULT_SHEET_STRUCTURE } from '../studio-core.js';
import { readCard } from '../card-rules.js';
import { parseArgs, createGateway, median } from './harness-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const opts = parseArgs(process.argv, { name: 'card-standard', report: path.join(__dirname, 'last-card-standard.md'), samples: 1 });
const STRUCTURE = parseSheetStructure(DEFAULT_SHEET_STRUCTURE);
const SHEETS_FILE = path.join(__dirname, '.card-standard-sheets.json');

// What people type. The last three state a rule in the concept itself.
export const CONCEPTS = [
  { id: 'terse', concept: 'a lighthouse keeper on a Norwegian island who says as little as she can' },
  { id: 'chatty', concept: 'a Dublin taxi driver who talks to every fare like an old friend' },
  { id: 'child', concept: 'an eight-year-old boy who runs the village lost-and-found from a shoebox' },
  { id: 'second-language', concept: 'a Polish welder in Aberdeen, ten years in Scotland, who learnt his English on the yard' },
  { id: 'formal', concept: 'a retired Supreme Court clerk who still speaks as if the court were in session' },
  { id: 'villain', concept: 'a landlord who is charming to your face and is quietly evicting the whole street' },
  { id: 'rule-pirate', concept: 'a pirate captain who always says arr and never apologises' },
  { id: 'rule-comic', concept: 'a washed-up stand-up comic whose catchphrase is "and that\'s the tragedy" and who answers every question with a joke' },
  { id: 'rule-counter', concept: 'a nurse who counts everything out loud and never talks about her feelings' },
];

function mockRespond(label) {
  const id = label.replace(/^sheet /, '');
  return JSON.stringify({
    name: `Mock ${id}`, tagline: 'a stand-in', description: 'A stand-in.', appearance: 'Plain.',
    personality: 'Calm.', voice: 'Even.\nShort sentences.\nPlain words.', backstory: 'None.',
    drives: 'Wants: nothing\nFears: nothing\nIn the way: nothing', secrets: 'None.', relationships: 'A: friend\nB: foe',
    exampleDialogue: '[USER]: Hi\n[AI]: Hello\n[USER]: How are you\n[AI]: Fine\n[USER]: Bye\n[AI]: Bye', reminder: 'A stand-in.',
  });
}

const gw = createGateway(opts, { mockRespond });
const lines = ['# Card standard: what the app writes', '', `Model ${opts.model}, num_ctx ${opts.numCtx}, thinking on, temperature 0.9 (the Studio's settings). Each card read by card-rules.js; findings are what the chat would obey in every reply.`, ''];
const sheets = {};
const times = [];
let found = 0;
for (const c of CONCEPTS) {
  if (opts.only.size && !opts.only.has(c.id)) continue;
  const t0 = Date.now();
  let raw = '';
  try {
    raw = await gw.call(`sheet ${c.id}`, buildSheetMessages({ concept: c.concept, structure: STRUCTURE }), { json: true, temperature: 0.9, think: true });
  } catch (err) {
    lines.push(`## ${c.id}`, '', `Concept: ${c.concept}`, '', `Failed: ${err?.message || err}`, '');
    continue;
  }
  const secs = (Date.now() - t0) / 1000;
  times.push(secs);
  const sheet = cleanSheet(parseJsonLoose(raw) || {});
  sheets[c.id] = { concept: c.concept, sheet };
  const findings = readCard(sheet);
  found += findings.length;
  console.log(`  [card] ${c.id}: ${sheet.name || '(no name)'}, ${findings.length} finding${findings.length === 1 ? '' : 's'}, ${secs.toFixed(1)}s`);
  lines.push(`## ${c.id}: ${sheet.name || '(no name)'}`, '', `Concept: ${c.concept}`, '', `**Voice**`, '', ...String(sheet.voice || '').split('\n').map((l) => `> ${l}`), '', `**Personality**: ${sheet.personality || ''}`, '', `**Reminder**: ${sheet.reminder || ''}`, '');
  lines.push(findings.length ? ['**Findings**', '', ...findings.map((f) => `- ${f.label} (${f.key}): "${f.line}"`)].join('\n') : '**Findings**: none', '');
}
lines.push('## Totals', '', `${Object.keys(sheets).length} cards, ${found} findings, median ${median(times).toFixed(1)} s a card.`, '');
fs.writeFileSync(opts.report, lines.join('\n'));
// A partial run (--only) replaces only the cards it wrote; the rest stay for the play.
if (!opts.mock) {
  const kept = fs.existsSync(SHEETS_FILE) ? JSON.parse(fs.readFileSync(SHEETS_FILE, 'utf8')) : {};
  fs.writeFileSync(SHEETS_FILE, JSON.stringify({ ...kept, ...sheets }, null, 2));
}
console.log(`DONE: ${Object.keys(sheets).length} cards, ${found} findings. Report: ${opts.report}`);
