// Real model, real photo (docs/AI_TAGGING.md).
//
// Sends the AI-tagging request the way the runner builds it: the system line,
// the user prompt with the tag list, the image, the JSON-schema format,
// temperature 0 and thinking off. It goes straight to Ollama, which is what
// the Ollama provider forwards. The reply is parsed and resolved with the
// extension's own pure functions (the @mo-tag-pure region of main.js).
//
// usage: node tests/probes/ai-tag-model-probe.mjs <image.jpg> [model]
// The image must already be at most 1536 px on the long edge (the runner
// re-encodes larger photos in the renderer; that step is not exercised here).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(resolve(root, 'ext/media-organizer/main.js'), 'utf8');
const region = src.slice(src.indexOf('// @mo-tag-pure-begin'), src.indexOf('// @mo-tag-pure-end'));
// eslint-disable-next-line no-new-func
const P = new Function(region + '\nreturn { MO_TAG_SYSTEM, moTagEntries, moTagPrompt, moTagReplySchema, moParseTagReply, moResolveTagPicks, moExpandWithAncestors, moTagParentsOf };')();

const imagePath = process.argv[2];
const model = process.argv[3] || 'qwen3.8:27b';
if (!imagePath) { console.error('usage: node tests/probes/ai-tag-model-probe.mjs <image.jpg> [model]'); process.exit(2); }
const image = readFileSync(imagePath).toString('base64');

// A user's tree: right answers and decoys, one description, three levels deep.
const names = ['SPORTS', 'BOXING', 'FOOTBALL', 'TENNIS', 'PEOPLE', 'CROWD', 'PORTRAIT', 'ANIMALS', 'DOG', 'CORGI', 'CAT',
  'PLACES', 'BEACH', 'MOUNTAINS', 'EVENTS', 'WEDDING', 'STYLE', 'BLACK AND WHITE', 'EQUIPMENT', 'CAMERA'];
const tags = names.map((name, i) => ({ id: i + 1, name, description: name === 'BLACK AND WHITE' ? 'Monochrome photos only' : '' }));
const id = (n) => names.indexOf(n) + 1;
const under = [['BOXING', 'SPORTS'], ['FOOTBALL', 'SPORTS'], ['TENNIS', 'SPORTS'], ['CROWD', 'PEOPLE'], ['PORTRAIT', 'PEOPLE'],
  ['DOG', 'ANIMALS'], ['CORGI', 'DOG'], ['CAT', 'ANIMALS'], ['BEACH', 'PLACES'], ['MOUNTAINS', 'PLACES'], ['WEDDING', 'EVENTS'],
  ['BLACK AND WHITE', 'STYLE'], ['CAMERA', 'EQUIPMENT']];
const rels = under.map(([c, p]) => ({ parent_id: id(p), child_id: id(c) }));
const nameOf = (tid) => names[tid - 1];

async function run(label, has) {
  const hasIds = new Set(has.map(id));
  const entries = P.moTagEntries(tags, rels, hasIds);
  const body = {
    model,
    stream: false,
    think: false,
    format: P.moTagReplySchema(entries.map((e) => e.path)),
    options: { temperature: 0 },
    messages: [
      { role: 'system', content: P.MO_TAG_SYSTEM },
      { role: 'user', content: P.moTagPrompt({ entries, existing: has, crops: false }), images: [image] },
    ],
  };
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  const text = json.message && json.message.content;
  const reply = P.moParseTagReply(text);
  const { ids, unknown } = P.moResolveTagPicks(reply.tags, entries);
  const fresh = ids.filter((t) => !hasIds.has(t));
  const withParents = P.moExpandWithAncestors(fresh, P.moTagParentsOf(rels)).filter((t) => !hasIds.has(t));
  console.log(`\n── ${label} ──`);
  console.log(`reply (${ms} ms, ${json.prompt_eval_count} prompt tokens, ${json.eval_count} generated): ${text}`);
  console.log(`parsed: ${reply.ok} | picks: ${fresh.map(nameOf).join(', ') || '(none)'} | unknown: ${unknown.join(', ') || '(none)'}`);
  console.log(`on Approve the photo gets: ${withParents.map(nameOf).join(', ') || '(nothing)'}`);
  return { ok: reply.ok, picks: fresh.map(nameOf), unknown, ms };
}

const a = await run('no existing tags', []);
const b = await run('photo already has BOXING', ['BOXING']);
const checks = [
  [a.ok && b.ok, 'both replies parse as a tag list'],
  [a.unknown.length === 0 && b.unknown.length === 0, 'no invented tags reached the list'],
  [a.picks.includes('BOXING'), 'run 1 picks BOXING'],
  [!b.picks.includes('BOXING'), 'run 2 does not repeat a tag the photo has'],
  [!a.picks.some((n) => ['CORGI', 'CAT', 'BEACH', 'MOUNTAINS', 'WEDDING', 'TENNIS'].includes(n)), 'run 1 picks none of the clear decoys'],
];
console.log('');
for (const [pass, label] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
process.exit(checks.every(([p]) => p) ? 0 : 1);
