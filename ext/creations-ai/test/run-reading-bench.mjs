// run-reading-bench.mjs — Part 5 of docs/CREATIONS_QUALITY_TESTING.md: does a
// scene between two characters read like a book?
//
// The dialogue bench judges single lines (abstract, metaphor, forced wit).
// This bench judges the exchange and the page. Two characters talk to each
// other through the real chat (Sam opens the scene, then sends `/ai @Name`
// so the two of them carry it), on five scenes written for the things that
// go wrong: strangers who meet and skip what strangers say, a line that is
// said and dropped ("the storm is getting closer", then nothing), news that
// gets no reaction, a want that is never pressed, an argument with no
// subtext. Each variant in reading-variants.md (a writing style, a rule set,
// a temperature) plays the same scenes, and every measure is compared with
// baseline.
//
// Measures, mechanical first, then a judge of another family:
//   per reply (judge): takes up what was just said; answers what it was
//     asked; gives the other something to answer; shows a thought; moves
//     the scene; names a feeling outright (a fault)
//   per scene (judge): a rubric drawn from EQ-Bench Creative Writing v3,
//     0 to 10 with a quoted reason; where the scene went; whether the two
//     could be told apart; for the strangers scene, what strangers do
//   style identification (judge): shown one reply and the list of styles in
//     the run, which was it written in; a style a judge cannot tell from the
//     others is not a style
//   head to head (judge): each variant's scene against baseline's, both
//     orders, the EQ-Bench pairwise criteria plus two of ours
//   anchors: reading-anchors.md, human-written scenes, scored on the same
//     rubric so the bar is set by a book and not by the judge's mood
//   mechanical: share of a reply that is speech, questions asked, interior
//     markers, tense and person, "said" against beats, stock tells, dashes,
//     motif echoes, novelty by thirds
//
//   node ext/creations-ai/test/run-reading-bench.mjs --mock
//   node ext/creations-ai/test/run-reading-bench.mjs --pass play
//   node ext/creations-ai/test/run-reading-bench.mjs --pass judge
//   node ext/creations-ai/test/run-reading-bench.mjs --only baseline,novel --samples 1
//   --turns <n>           character replies per scene after the opening (12)
//   --order alternate|auto  who speaks next: the other lead (default), or the chat's own turn order
//   --calibration-sheet   --replay: writes reading-calibration.md, 20 exchanges for you to mark
//   --calibrate           --replay: compares your marks with the judge's
//   other options: harness-common.mjs (--model, --judge, --samples, --num-ctx, --pass, --cache, --report)

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startChatDriver, slug, kindOf } from './chat-driver.mjs';
import { parseArgs, createGateway, createReport, judgeJson, ollamaPs, SkipCase, motifEchoes, noveltyByThirds, words, contentWords, median } from './harness-common.mjs';
import { SCENARIOS, JOAN } from './scenarios.mjs';
import { WRITING_PRESETS } from '../writing-style.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const opts = parseArgs(process.argv, { name: 'reading-bench', report: path.join(__dirname, 'last-reading-bench.md'), samples: 2 });
const argv = process.argv.slice(2);
const after = (flag, dflt) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : dflt);
const TURNS = Math.max(4, Number(after('--turns', 12)) || 12);
const ORDER = after('--order', 'alternate') === 'auto' ? 'auto' : 'alternate';
const CAL_FILE = path.join(__dirname, 'reading-calibration.md');
const USER = 'Sam';

// ── Levers: reading-variants.md ───────────────────────────────────────────

async function shippedRules() {
  const src = await fsp.readFile(path.join(__dirname, '..', 'main.js'), 'utf8');
  const m = /const DEFAULT_DIALOGUE_RULES = \[([\s\S]*?)\]\.join\('\\n'\);/.exec(src);
  if (!m) throw new Error('DEFAULT_DIALOGUE_RULES not found in main.js');
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
}

async function readVariants(shipped) {
  const text = (await fsp.readFile(path.join(__dirname, 'reading-variants.md'), 'utf8')).replace(/\r/g, '');
  const variants = [];
  let cur = null;
  let block = null;
  for (const line of text.split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h) { cur = { id: h[1].trim() }; variants.push(cur); block = null; continue; }
    if (!cur) continue;
    const kv = /^(Rules|Temperature|Preset|Style|Label):\s*(.*)$/i.exec(line);
    if (kv) {
      const key = kv[1].toLowerCase();
      const val = kv[2].trim();
      block = null;
      if (key === 'rules') { if (/^shipped\s*(\+|plus)$/i.test(val)) { cur.rules = shipped.join('\n'); block = 'rules'; } else if (/^shipped$/i.test(val)) cur.rules = shipped.join('\n'); else if (/^none$/i.test(val)) cur.rules = ''; else { cur.rules = val; block = 'rules'; } }
      else if (key === 'style') { cur.style = val; block = 'style'; }
      else if (key === 'temperature') cur.temperature = Number(val);
      else if (key === 'preset') cur.preset = val;
      else if (key === 'label') cur.label = val;
      continue;
    }
    if (block && line.trim()) cur[block] = [cur[block], line].filter(Boolean).join('\n');
  }
  for (const v of variants) {
    if (v.style && !v.preset) v.preset = 'custom';
    // What the style judge is shown: the variant's own label, else its preset's.
    v.label ||= v.preset && WRITING_PRESETS[v.preset]?.label && v.preset !== 'custom' ? WRITING_PRESETS[v.preset].label : v.id;
  }
  return variants;
}

// ── Scenes: two characters, Sam opens and then listens ───────────────────

const NORA = SCENARIOS[0].leads[0];
const ILAN = SCENARIOS[0].leads[1];

/**
 * Each scene names the thing it is written to catch. `nudges` are lines Sam
 * says at a fixed reply number, so a scene that stalls is pushed the same way
 * in every variant. `strangers` turns on the what-strangers-do checklist.
 */
const SCENES = [
  {
    id: 'strangers', title: 'Strangers in a waiting room', catches: 'two people who have just met skip what people say when they meet',
    leads: [NORA, JOAN], strangers: true, scene: { location: 'the A&E waiting room at St Jude\'s', time: '2 a.m.', mood: 'tired, fluorescent, a long wait' },
    situation: 'The A&E waiting room at St Jude\'s, 2 a.m. Nora Vasquez is waiting for her friend Ilan, who is being stitched after a call-out went wrong. Joan Pike has brought one of her drivers in with a crushed hand. The two women have never met. Sam is the porter, in and out with a trolley.',
    opening: '*I wheel the trolley past the two of you.* Machine is out of order, before you try it. There is a kettle at the desk if you ask nicely.',
    nudges: { 6: '*I come back for the trolley.* Still here, the pair of you? They said another hour.' },
  },
  {
    id: 'storm', title: 'The storm is getting closer', catches: 'a line that is said and dropped: nobody thinks about it or takes it anywhere',
    leads: [NORA, ILAN], scene: { location: 'the Albion Street pharmacy', time: '11 p.m.', mood: 'a storm coming' },
    situation: 'The Albion Street pharmacy, 11 p.m. The radio has just said the storm reaches the city at four. The pharmacy\'s back roof leaks in heavy rain, and Ilan\'s van is parked under the old plane tree outside. Sam is sorting the bread delivery at the end of the counter.',
    opening: '*I turn the radio down.* Four o\'clock, they said. That is your roof, Nora. And that tree is right over your van, Ilan.',
    nudges: { 6: '*I look out at the sky.* It is getting darker already.' },
  },
  {
    id: 'news', title: 'News with no reaction', catches: 'news that is announced and not answered: no questions, no shock, nothing practical',
    leads: [ILAN, NORA], scene: { location: 'Ilan\'s locksmith shop', time: 'after closing', mood: 'a letter on the counter' },
    situation: 'Ilan\'s locksmith shop, after closing. Ilan has had a letter this morning: his daughter Mira, who has not spoken to him in two years, is getting married in June, and the letter is from her fiance, not from her. Nora has come round with the takings bag she minds for him. Sam is fixing the shop\'s buzzer by the door.',
    opening: '*I hold up the buzzer\'s cover.* This is held on with a plaster. Ilan, you look like someone died. What is the letter?',
    nudges: { 6: '*I put the screwdriver down.* So are you going, or not?' },
  },
  {
    id: 'favour', title: 'A want that is pressed', catches: 'a request that is made once and left: no pressing, no refusing, no bargaining',
    leads: [NORA, ILAN], scene: { location: 'the Albion Street pharmacy', time: '3 a.m.', mood: 'quiet' },
    situation: 'The pharmacy at 3 a.m., quiet. The chain has offered to sell Nora the shop, but the bank wants a second name on the loan, and the only person she can ask is Ilan, who lost his first shop and has a reason he never says for fearing the bank. Sam is on a break, eating a roll at the counter.',
    opening: '*I push the crate aside.* Go on then. You have been staring at that envelope since I came in. What is it?',
    nudges: { 6: 'Sounds like a no to me, Nora.' },
  },
  {
    id: 'argument', title: 'An argument with something under it', catches: 'anger with no subtext: people saying exactly what they mean and nothing else',
    leads: [NORA, ILAN], scene: { location: 'the Albion Street pharmacy', time: '1 a.m.', mood: 'something unsaid' },
    situation: 'The pharmacy, 1 a.m. An insurance assessor came in today asking Nora questions about the fire at Ilan\'s first shop, years ago, and about the wiring. Nora said nothing to him. Ilan has just come in for his evening paper and does not know. Sam is restocking the fridge.',
    opening: '*I shut the fridge.* Ilan, there was a man in a suit here today asking about you. Nora talked to him for ages.',
    nudges: { 6: '*I keep my head in the fridge.* Should I go?' },
  },
];

// ── Mock ─────────────────────────────────────────────────────────────────────

const MOCK_REPLIES = [
  '"Where are you from, then?" *She looks up from the form.* "You are not from here."',
  '*He turns the key over.* "Leeds. A long time ago." He thought of the yard, the one woman in it. "And you?"',
  '"The storm is getting closer."',
  '"It is. And the roof will go at the back first, it always does." *She counts the buckets under the counter.* "Three. Are you moving the van or not?"',
  '*He said nothing for a moment.* "I will move it. But I want to know why you did not tell me."',
  '"Because I knew what you would say." *She pushes the envelope across.* "Read it. Then say no."',
];
let mockN = 0;
let judgeN = 0;
/** As a real judge answers: now and then the JSON comes fenced, with a word before it. */
function messy(json) {
  judgeN++;
  return judgeN % 7 === 0 ? `Here is my verdict:\n\`\`\`json\n${json}\n\`\`\`` : json;
}
function mockRespond(label, messages, { role }) {
  if (role === 'judge') {
    const u = messages[1].content;
    if (/^STYLE:/.test(label)) { const m = /Styles:\n((?:- .+\n?)+)/.exec(u); const first = m ? m[1].split('\n')[0].replace(/^- /, '').trim() : 'x'; return messy(JSON.stringify({ style: first, features: ['past tense', 'said tags', 'thought shown'] })); }
    if (/^PAIR:/.test(label)) return messy(JSON.stringify({ reasoning: 'mock', winners: Object.fromEntries(PAIR_CRITERIA.map((c, i) => [c.key, { winner: i % 2 ? 'A' : 'B', strength: 2 }])) }));
    if (/^SCENE:/.test(label)) {
      const out = { scores: Object.fromEntries(RUBRIC.map((c) => [c.key, { score: c.negative ? 3 : 6, quote: 'mock' }])), wentSomewhere: 3, where: 'mock', distinct: 4 };
      if (u.includes('STRANGERS')) out.strangers = { names: true, whereFrom: true, whatTheyDo: false, whyHere: true, tookUpAnswers: true };
      return messy(JSON.stringify(out));
    }
    const n = (u.match(/^\s*\[\d+\] /gm) || []).length;
    return messy(JSON.stringify({ replies: Array.from({ length: n }, (_, i) => ({ n: i + 1, takesUp: i % 3 !== 2, quote: 'mock', answers: i % 2 ? true : null, gives: i % 4 !== 2, thinks: i % 2 === 1, moves: i % 3 === 0, tells: i % 5 === 4, why: '' })) }));
  }
  mockN++;
  // As a real player answers: curly quotes, a reply with no quotes at all, a think block that leaked.
  if (mockN % 9 === 0) return '\u201cWhere were you when it went up?\u201d She did not look at him.';
  if (mockN % 13 === 0) return 'He thought about the fire for a long moment and said nothing, and then he picked up the paper and went out.';
  if (mockN % 17 === 0) return '<think>who speaks</think>"I heard you," he said. "Say it again anyway."';
  return MOCK_REPLIES[mockN % MOCK_REPLIES.length];
}

// ── The judges ───────────────────────────────────────────────────────────────

const EXCHANGE_JUDGE = [
  'You are a fiction editor reading a scene between two characters, written one reply at a time. Sam is a minor presence. Judge each numbered reply in its moment, against what came just before it.',
  'For each numbered reply give:',
  '- "takesUp": true when the reply responds to what was just said or done (by anyone), false when it ignores it and starts somewhere else. Quote the words it responds to in "quote" (empty when false).',
  '- "answers": when the previous reply asked this character something, true if this reply answers it plainly (a question back after the answer still counts), false if it dodges or answers with only a question; null when nothing was asked.',
  '- "gives": true when the reply leaves the other person something to answer: a question, a claim they can take or refuse, an offer, a request, an action that needs a reaction. False when it states something and stops ("The storm is getting closer." and nothing more), summarises, or closes the scene down.',
  '- "thinks": true when the reply shows the character thinking: weighing something, noticing, deciding what not to say, remembering, changing their mind. Shown through what they notice, do, or nearly say; a feeling named outright does not count.',
  '- "moves": true when something new enters: a fact, a decision, an intention, a change between the two people. False when the reply only restates or decorates.',
  '- "tells": true when the reply names a feeling or a trait outright instead of showing it ("she felt a wave of sadness", "he was a stubborn man", "I feel so alone").',
  '- "why": a few words.',
  'Reply as JSON: {"replies": [{"n": 1, "takesUp": true, "quote": "", "answers": null, "gives": true, "thinks": false, "moves": true, "tells": false, "why": ""}], one entry per numbered reply, in order.',
].join('\n');

/** The rubric: EQ-Bench Creative Writing v3 criteria that bear on a scene of talk, with definitions written for this bench. */
const RUBRIC = [
  { key: 'believableDialogue', name: 'Believable dialogue', def: 'people say what people say, in that moment, in their own words; the inverse of "weak dialogue"' },
  { key: 'nuancedCharacters', name: 'Nuanced characters', def: 'each has more than one thing going on; wants, fears and habits show without being announced' },
  { key: 'emotionallyEngaging', name: 'Emotionally engaging', def: 'a reader would care what happens to them next' },
  { key: 'emotionallyComplex', name: 'Emotionally complex', def: 'mixed feelings, subtext, people saying less than they mean' },
  { key: 'coherent', name: 'Coherent', def: 'the scene holds together: place, time, who knows what, what was said before' },
  { key: 'sentencesFlow', name: 'Sentences flow naturally', def: 'the prose reads easily aloud; rhythm varies with the moment' },
  { key: 'readerEngagement', name: 'Overall reader engagement', def: 'you would keep reading' },
  { key: 'tellDontShow', name: 'Tell-don\'t-show', def: 'feelings and traits named instead of shown', negative: true },
  { key: 'purpleProse', name: 'Purple prose', def: 'ornament for its own sake; adjectives and atmosphere where the moment wanted plainness', negative: true },
  { key: 'forcedMetaphor', name: 'Forced poetry or metaphor', def: 'similes and metaphors nobody in the scene would reach for', negative: true },
  { key: 'meandering', name: 'Meandering', def: 'the scene circles; replies restate; nothing is at stake from one to the next', negative: true },
  { key: 'amateurish', name: 'Amateurish', def: 'stock images, summary endings, every reply shaped the same, a line that could be printed on a mug', negative: true },
];

const SCENE_JUDGE = [
  'You are a fiction editor. Score a scene between two characters on each criterion below, 0 to 10, and quote the words that most earned the score (the best for a positive criterion, the worst for a negative one). For a negative criterion 0 means none of it and 10 means it is everywhere.',
  ...RUBRIC.map((c) => `- "${c.key}" (${c.name}${c.negative ? ', negative' : ''}): ${c.def}.`),
  'Then: "wentSomewhere", 1 to 5: did the scene arrive anywhere (a decision, a revelation, a change between them) by its end, and "where", one sentence saying where. "distinct", 1 to 5: could the two be told apart without their names.',
  'If the scene is marked STRANGERS, also fill "strangers": {"names": did they learn each other\'s names, "whereFrom": did either ask where the other is from, "whatTheyDo": did either ask what the other does, "whyHere": did either ask why the other is here, "tookUpAnswers": did they take up the answers rather than move on} as booleans.',
  'Reply as JSON: {"scores": {"<key>": {"score": 0, "quote": ""}}, "wentSomewhere": 3, "where": "", "distinct": 3, "strangers": {...}}.',
].join('\n');

const STYLE_JUDGE = 'You are shown one reply from a scene, and a list of the writing styles the scene may have been written in. Say which style it was written in ("style": one of the listed names, exactly as listed) and name three features of the writing that told you ("features": three short phrases). If nothing in the writing distinguishes it, still pick one, and say so in the features. Reply as JSON: {"style": "", "features": ["", "", ""]}.';

/** EQ-Bench\'s pairwise criteria, with two of this bench\'s own. */
const PAIR_CRITERIA = [
  { key: 'authenticity', name: 'Character authenticity and insight' },
  { key: 'interesting', name: 'Interesting and original' },
  { key: 'writing', name: 'Writing quality' },
  { key: 'coherence', name: 'Coherence in plot, character choices, metaphor' },
  { key: 'cliches', name: 'Avoids cliches in characters, dialogue and plot' },
  { key: 'flowery', name: 'Avoids flowery verbosity and show-off vocabulary' },
  { key: 'metaphorLoad', name: 'Avoids gratuitous metaphor or poetic overload' },
  { key: 'conversation', name: 'The two talk to each other: each takes up the last line and gives the other something to answer' },
  { key: 'goesSomewhere', name: 'The scene goes somewhere by the end' },
];
const PAIR_JUDGE = [
  'Two writers wrote the same scene between the same two characters, from the same opening. Compare them on each criterion. You must pick a winner for every criterion (no draws), with a strength from 1 (barely) to 5 (clearly).',
  ...PAIR_CRITERIA.map((c) => `- "${c.key}": ${c.name}`),
  'Reply as JSON: {"reasoning": "", "winners": {"<key>": {"winner": "A" or "B", "strength": 1}}}.',
].join('\n');

// ── Run ──────────────────────────────────────────────────────────────────────

const gw = createGateway(opts, { mockRespond });
const report = createReport('Creations: reading bench', opts);
const psBefore = ollamaPs(opts);
await gw.load();
const shipped = await shippedRules();
const variants = await readVariants(shipped);
const wanted = opts.only.size ? variants.filter((v) => opts.only.has(v.id)) : variants;
if (!wanted.length) throw new Error('No variant to run: check --only against reading-variants.md.');
if (!wanted.some((v) => v.id === 'baseline') && !opts.only.size) throw new Error('reading-variants.md needs a "baseline" variant.');
const baselineVariant = variants.find((v) => v.id === 'baseline');
if (baselineVariant && !wanted.includes(baselineVariant)) wanted.unshift(baselineVariant); // every comparison is against it

const runs = []; // { variant, sample, scene, replies: [{name, content}], userLines, turnPrompts, empty }
let d = null;

async function playScene(variant, sample, scene) {
  d ??= await startChatDriver(gw, opts, { tag: 'reading', userName: USER });
  await d.writeSettings({
    ...(variant.rules !== undefined ? { dialogueRules: variant.rules } : {}),
    ...(variant.style ? { customWritingStyle: variant.style } : {}),
  });
  const files = [];
  for (const lead of scene.leads) files.push(await d.writeCard({ ...lead }, {}, `${slug(lead.name)}.json`, Number.isFinite(variant.temperature) ? { temperature: variant.temperature } : {}));
  const key = `${variant.id}#${sample} ${scene.id}`;
  const threadId = `rb-${slug(key)}`;
  d.setLabel(`${key} open`);
  const capturedFrom = d.captured.length;
  const container = await d.startThread({
    id: threadId, title: key, files, ...(variant.preset ? { writingPresetOverride: variant.preset } : {}),
    // Where and when, as the chat's own Scene panel holds it (rendered into every turn's prompt).
    sceneState: { ...scene.scene, present: [...scene.leads.map((l) => l.name), USER], updatedAt: Date.now() },
  });
  let empty = 0;
  // What is going on goes in Sam's opening narration, as a player sets a scene.
  const opening = `*${scene.situation}*\n\n${scene.opening}`;
  const userLines = [{ turn: 0, text: opening }];
  d.setLabel(`${key} t0`);
  if (!(await d.sendTurn(container, threadId, opening))) empty++;
  for (let t = 1; t <= TURNS; t++) {
    d.setLabel(`${key} t${t}`);
    const nudge = scene.nudges?.[t];
    let text;
    if (nudge) { text = nudge; userLines.push({ turn: t, text: nudge }); }
    else if (ORDER === 'auto') text = '/ai';
    else {
      const last = [...(await d.readMessages(threadId))].reverse().find((m) => m.author === 'ai');
      const next = scene.leads.find((l) => l.name !== last?.name) || scene.leads[0];
      text = `/ai @"${next.name}"`;
    }
    if (!(await d.sendTurn(container, threadId, text))) empty++;
    if (t % 4 === 0) console.log(`  ${key}: reply ${t}/${TURNS}`);
  }
  container.remove();
  const msgs = await d.readMessages(threadId);
  const turnRequests = d.captured.slice(capturedFrom).filter((r) => kindOf(r.messages) === 'turn');
  const turnPrompts = turnRequests.map((r) => r.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'));
  const firstTurnText = (turnRequests[0]?.messages || []).map((m) => m.content).join('\n');
  runs.push({ variant, sample, scene, key, replies: msgs.filter((m) => m.author === 'ai').map((m) => ({ name: m.name, content: m.content })), userLines, turnPrompts, firstTurnText, empty });
}

async function guarded(id, fn) {
  try { return await fn(); } catch (err) {
    if (err instanceof SkipCase) { report.skip(id, err.message); return undefined; }
    report.check(id, 'ran without error', false, err?.stack?.split('\n').slice(0, 2).join(' ') || String(err));
    return undefined;
  }
}

const CAL = argv.includes('--calibration-sheet') || argv.includes('--calibrate');
for (const variant of wanted) {
  for (let s = 1; s <= opts.samples; s++) {
    for (const scene of SCENES) await guarded(`${variant.id}#${s} ${scene.id}`, () => playScene(variant, s, scene));
  }
}
if (d) await d.cleanup();

// ── Mechanical measures ──────────────────────────────────────────────────────

const STOCK_TELLS = ['shiver down', "couldn't help but", 'a testament to', 'dust motes', 'barely above a whisper', 'a mixture of', 'mischievous glint', 'sent a chill', 'unreadable expression', 'in that moment', 'the air was thick', 'heart pounding', 'a wave of', 'a pang of', 'a surge of'];
const INTERIOR = /\b(thought|wondered|wanted to|did not want|didn't want|decided|remembered|considered|weighed|knew|realised|realized|noticed|could not say|couldn't say|nearly said|almost said|let it go|chose)\b/i;
const FIRST_PERSON = /\b(I|me|my|mine|I'm|I've|I'd)\b/g;
const THIRD_PERSON = /\b(he|she|his|her|him|they|their|them)\b/gi;
const SAID_TAGS = /\b(said|asked|replied|answered|muttered|whispered|snapped|added)\b/gi;
const PAST = /\b\w+ed\b|\b(was|were|had|did|said|went|came|took|looked|turned|put|got|made|thought|knew|saw)\b/gi;
const PRESENT = /\b(is|are|am|has|does|says|looks|turns|puts|takes|goes|comes|thinks|knows|sees)\b/gi;

function spokenLines(reply) {
  const quoted = [...String(reply).matchAll(/["\u201c]([^"\u201d]{2,})["\u201d]/g)].map((m) => m[1].trim());
  if (quoted.length) return quoted;
  const bare = String(reply).replace(/\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
  return bare ? [bare] : [];
}
const narrationOf = (reply) => String(reply).replace(/["\u201c][^"\u201d]*["\u201d]/g, ' ').replace(/[*_]/g, ' ');
const count = (text, re) => (String(text).match(re) || []).length;

function mechanics(replies) {
  const texts = replies.map((r) => r.content);
  const all = texts.join('\n');
  const spoken = texts.flatMap(spokenLines);
  const spokenWords = spoken.reduce((n, l) => n + words(l).length, 0);
  const totalWords = words(all).length || 1;
  const narr = texts.map(narrationOf).join('\n');
  const first = count(narr, FIRST_PERSON), third = count(narr, THIRD_PERSON);
  const past = count(narr, PAST), present = count(narr, PRESENT);
  const paragraphs = texts.reduce((n, t) => n + t.split(/\n\s*\n/).filter((p) => p.trim()).length, 0);
  return {
    speechShare: spokenWords / totalWords,
    questionsPer10Lines: spoken.length ? (spoken.filter((l) => l.includes('?')).length / spoken.length) * 10 : 0,
    interiorPerReply: texts.filter((t) => INTERIOR.test(narrationOf(t))).length / (texts.length || 1),
    person: first + third ? first / (first + third) : 0.5,  // 1 = all first person
    tense: past + present ? past / (past + present) : 0.5,  // 1 = all past
    saidPerReply: count(all, SAID_TAGS) / (texts.length || 1),
    paragraphsPerReply: paragraphs / (texts.length || 1),
    wordsPerReply: totalWords / (texts.length || 1),
    stockTells: STOCK_TELLS.filter((t) => all.toLowerCase().includes(t)).length,
    dashes: count(all, /[\u2013\u2014]/g),
    endsWithQuestion: texts.filter((t) => /\?["\u201d]?\s*$/.test(t.trim())).length / (texts.length || 1),
  };
}

// ── Judge passes ─────────────────────────────────────────────────────────────

const castLine = (scene) => scene.leads.map((l) => `${l.name}: ${l.tagline}`).join('\n');
function transcriptOf(run) {
  const out = [];
  let n = 0;
  const nudges = new Map(run.userLines.map((u) => [u.turn, u.text]));
  out.push(`${USER}: ${run.userLines[0].text}`);
  run.replies.forEach((r, i) => {
    if (i > 0 && nudges.has(i)) out.push(`${USER}: ${nudges.get(i)}`);
    out.push(`[${++n}] ${r.name}: ${r.content}`);
  });
  return out.join('\n\n');
}

for (const run of runs) {
  run.mech = mechanics(run.replies);
  if (!run.replies.length) continue;
  await guarded(`judge ${run.key}`, async () => {
    const user = `Scene: ${run.scene.situation}\n\nThe two:\n${castLine(run.scene)}\n\nThe scene, replies numbered:\n\n${transcriptOf(run)}`;
    const ex = await judgeJson(gw, `EXCHANGE: ${run.key}`, EXCHANGE_JUDGE, user);
    run.exchange = Array.isArray(ex?.replies) ? ex.replies : [];
    if (!run.exchange.length) report.check(`${run.key}.exchangeJudge`, 'the exchange judge gave a verdict', false, 'no JSON came back; the play is cached, so --pass judge --fresh asks again');
    const sc = await judgeJson(gw, `SCENE: ${run.key}`, SCENE_JUDGE, `${run.scene.strangers ? 'STRANGERS\n\n' : ''}${user}`);
    run.sceneScore = sc && sc.scores ? sc : null;
    // Style identification on the third reply (past the opening's momentum).
    const sample = run.replies[Math.min(2, run.replies.length - 1)];
    const labels = [...new Set(wanted.map((v) => v.label))];
    const st = await judgeJson(gw, `STYLE: ${run.key}`, STYLE_JUDGE, `Styles:\n${labels.map((l) => `- ${l}`).join('\n')}\n\nThe reply:\n${sample.content}`);
    run.styleGuess = st?.style || '';
    run.styleFeatures = Array.isArray(st?.features) ? st.features : [];
  });
}

// Head to head against baseline, both orders.
const baselineRun = (run) => runs.find((r) => r.variant.id === 'baseline' && r.sample === run.sample && r.scene.id === run.scene.id && r.replies.length);
const sceneText = (run) => run.replies.map((r) => `${r.name}: ${r.content}`).join('\n\n').slice(0, 6000);
for (const run of runs) {
  if (run.variant.id === 'baseline' || !run.replies.length) continue;
  const base = baselineRun(run);
  if (!base) continue;
  await guarded(`pair ${run.key}`, async () => {
    const ask = async (a, b, tag) => judgeJson(gw, `PAIR: ${run.key} ${tag}`, PAIR_JUDGE, `Scene: ${run.scene.situation}\n\nThe two:\n${castLine(run.scene)}\n\n=== WRITER A ===\n${sceneText(a)}\n\n=== WRITER B ===\n${sceneText(b)}`);
    const ab = await ask(run, base, 'AB');
    const ba = await ask(base, run, 'BA');
    // Score per criterion: + when the variant won, by its strength; averaged over both orders.
    const score = {};
    for (const c of PAIR_CRITERIA) {
      const w1 = ab?.winners?.[c.key], w2 = ba?.winners?.[c.key];
      const s1 = w1 ? (w1.winner === 'A' ? 1 : -1) * Math.min(5, Math.max(1, Number(w1.strength) || 1)) : 0;
      const s2 = w2 ? (w2.winner === 'B' ? 1 : -1) * Math.min(5, Math.max(1, Number(w2.strength) || 1)) : 0;
      score[c.key] = (s1 + s2) / 2;
    }
    run.pair = score;
  });
}

// Anchors: human-written scenes on the same rubric.
async function readAnchors() {
  let text = '';
  try { text = (await fsp.readFile(path.join(__dirname, 'reading-anchors.md'), 'utf8')).replace(/\r/g, ''); } catch { return []; }
  const anchors = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h) { cur = { id: h[1].trim(), body: '' }; anchors.push(cur); continue; }
    if (!cur) continue;
    if (/^(Source|Situation|Strangers):/i.test(line)) { const [k, ...v] = line.split(':'); cur[k.trim().toLowerCase()] = v.join(':').trim(); continue; }
    cur.body += `${line}\n`;
  }
  return anchors.filter((a) => a.body.trim().length > 200 && !/^\(paste/i.test(a.body.trim()));
}
const anchors = await readAnchors();
for (const a of anchors) {
  await guarded(`anchor ${a.id}`, async () => {
    const sc = await judgeJson(gw, `SCENE: anchor ${a.id}`, SCENE_JUDGE, `${/^yes/i.test(a.strangers || '') ? 'STRANGERS\n\n' : ''}Scene: ${a.situation || a.id}\n\nThe scene:\n\n${a.body.trim()}`);
    a.sceneScore = sc && sc.scores ? sc : null;
  });
}

// ── Report ───────────────────────────────────────────────────────────────────

const pct = (xs) => (xs.length ? (100 * xs.filter(Boolean).length) / xs.length : NaN);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '-');
const delta = (v, b, d = 0) => (Number.isFinite(v) && Number.isFinite(b) && v !== b ? ` (${v > b ? '+' : ''}${(v - b).toFixed(d)})` : '');

/** Everything about one variant, over its scenes and samples. */
function summarise(variant) {
  const mine = runs.filter((r) => r.variant.id === variant.id && r.replies.length);
  const ex = mine.flatMap((r) => r.exchange || []);
  const asked = ex.filter((e) => e.answers !== null && e.answers !== undefined);
  const scored = mine.filter((r) => r.sceneScore);
  const rubric = Object.fromEntries(RUBRIC.map((c) => [c.key, mean(scored.map((r) => Number(r.sceneScore.scores?.[c.key]?.score)).filter(Number.isFinite))]));
  const strangers = mine.filter((r) => r.scene.strangers && r.sceneScore?.strangers).map((r) => r.sceneScore.strangers);
  const styled = mine.filter((r) => r.styleGuess);
  const paired = mine.filter((r) => r.pair);
  return {
    variant, runs: mine.length, replies: ex.length,
    takesUp: pct(ex.map((e) => e.takesUp)), answers: pct(asked.map((e) => e.answers)), gives: pct(ex.map((e) => e.gives)),
    thinks: pct(ex.map((e) => e.thinks)), moves: pct(ex.map((e) => e.moves)), tells: pct(ex.map((e) => e.tells)),
    deadEnds: ex.length ? (100 * ex.filter((e) => !e.gives).length) / ex.length : NaN,
    rubric,
    positive: mean(RUBRIC.filter((c) => !c.negative).map((c) => rubric[c.key]).filter(Number.isFinite)),
    negative: mean(RUBRIC.filter((c) => c.negative).map((c) => rubric[c.key]).filter(Number.isFinite)),
    wentSomewhere: mean(scored.map((r) => Number(r.sceneScore.wentSomewhere)).filter(Number.isFinite)),
    distinct: mean(scored.map((r) => Number(r.sceneScore.distinct)).filter(Number.isFinite)),
    strangers: strangers.length ? Object.fromEntries(['names', 'whereFrom', 'whatTheyDo', 'whyHere', 'tookUpAnswers'].map((k) => [k, pct(strangers.map((s) => s[k]))])) : null,
    styleHit: styled.length ? (100 * styled.filter((r) => r.styleGuess === variant.label).length) / styled.length : NaN,
    styleFeatures: [...new Set(styled.flatMap((r) => r.styleFeatures))].slice(0, 6),
    pair: paired.length ? Object.fromEntries(PAIR_CRITERIA.map((c) => [c.key, mean(paired.map((r) => r.pair[c.key]))])) : null,
    pairOverall: paired.length ? mean(paired.flatMap((r) => Object.values(r.pair))) : NaN,
    mech: Object.fromEntries(Object.keys(mine[0]?.mech || {}).map((k) => [k, mean(mine.map((r) => r.mech[k]))])),
    empty: mine.reduce((n, r) => n + r.empty, 0),
  };
}

const summaries = wanted.map(summarise);
const base = summaries.find((s) => s.variant.id === 'baseline');

/** The bar for "satisfied", provisional until calibrated against your own marks (the brief says how). */
const BARS = {
  takesUp: ['>= 90', (s) => s.takesUp >= 90], answers: ['>= 80', (s) => s.answers >= 80], deadEnds: ['<= 10 per 100', (s) => s.deadEnds <= 10],
  moves: ['>= 60', (s) => s.moves >= 60], tells: ['<= 10 per 100', (s) => s.tells <= 10],
  wentSomewhere: ['>= 4', (s) => s.wentSomewhere >= 4], distinct: ['>= 4', (s) => s.distinct >= 4],
  positive: ['>= 7', (s) => s.positive >= 7], negative: ['<= 3', (s) => s.negative <= 3], styleHit: ['>= 80', (s) => s.styleHit >= 80],
};

report.section('Results');
const lines = [];
lines.push('Per variant, over its scenes and samples. Percentages are of character replies; in brackets, the change from baseline. The bar is provisional: calibrate it against your own marks before trusting it (--calibration-sheet).', '');
lines.push('| Variant | Replies | Takes up % | Answers % | Gives % | Dead ends /100 | Thinks % | Moves % | Tells /100 | Went somewhere (1-5) | Distinct (1-5) | Rubric + (0-10) | Rubric - (0-10) | Style told % | vs baseline |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of summaries) {
  const b = s === base ? null : base;
  const cell = (k, d = 0) => `${fmt(s[k], d)}${b ? delta(s[k], b[k], d) : ''}`;
  lines.push(`| ${s.variant.id} | ${s.replies} | ${cell('takesUp')} | ${cell('answers')} | ${cell('gives')} | ${cell('deadEnds')} | ${cell('thinks')} | ${cell('moves')} | ${cell('tells')} | ${cell('wentSomewhere', 1)} | ${cell('distinct', 1)} | ${cell('positive', 1)} | ${cell('negative', 1)} | ${fmt(s.styleHit)} | ${s === base ? '-' : fmt(s.pairOverall, 2)} |`);
  for (const [k, [bar, ok]] of Object.entries(BARS)) report.metric(`${s.variant.id}.${k}`, k, s[k], bar);
  report.check(`${s.variant.id}.bar`, 'meets every provisional bar', Object.values(BARS).every(([, ok]) => ok(s)), Object.entries(BARS).filter(([, [, ok]]) => !ok(s)).map(([k]) => k).join(', ') || 'all');
  if (s.empty) report.check(`${s.variant.id}.empty`, 'every turn kept a reply', false, `${s.empty} turns answered nothing`);
}
lines.push('', '### Rubric by criterion (0-10; for a negative criterion lower is better)', '');
lines.push(`| Variant | ${RUBRIC.map((c) => c.name).join(' | ')} |`, `|---|${RUBRIC.map(() => '---').join('|')}|`);
for (const s of summaries) lines.push(`| ${s.variant.id} | ${RUBRIC.map((c) => fmt(s.rubric[c.key], 1)).join(' | ')} |`);
for (const a of anchors.filter((x) => x.sceneScore)) lines.push(`| anchor: ${a.id} | ${RUBRIC.map((c) => fmt(Number(a.sceneScore.scores?.[c.key]?.score), 1)).join(' | ')} |`);
if (anchors.length && !anchors.some((x) => x.sceneScore)) lines.push('', '(reading-anchors.md has no filled anchors yet: the brief says how to add them)');
if (summaries.some((s) => s.strangers)) {
  lines.push('', '### What strangers do (the strangers scene; % of samples)', '', '| Variant | Names | Where from | What they do | Why here | Took up the answers |', '|---|---|---|---|---|---|');
  for (const s of summaries.filter((x) => x.strangers)) lines.push(`| ${s.variant.id} | ${['names', 'whereFrom', 'whatTheyDo', 'whyHere', 'tookUpAnswers'].map((k) => fmt(s.strangers[k])).join(' | ')} |`);
}
lines.push('', '### Style identification (the judge was shown one reply and the list of styles in this run)', '', '| Variant | Shown as | Told apart % | What told the judge |', '|---|---|---|---|');
for (const s of summaries) lines.push(`| ${s.variant.id} | ${s.variant.label} | ${fmt(s.styleHit)} | ${s.styleFeatures.join('; ')} |`);
if (summaries.some((s) => s.pair)) {
  lines.push('', '### Head to head against baseline (judge, both orders; + means the variant won, 5 is clearly)', '', `| Variant | ${PAIR_CRITERIA.map((c) => c.key).join(' | ')} |`, `|---|${PAIR_CRITERIA.map(() => '---').join('|')}|`);
  for (const s of summaries.filter((x) => x.pair)) lines.push(`| ${s.variant.id} | ${PAIR_CRITERIA.map((c) => fmt(s.pair[c.key], 2)).join(' | ')} |`);
}
lines.push('', '### The page, mechanically', '', '| Variant | Words/reply | Paragraphs/reply | Speech share | Questions /10 lines | Replies showing a thought | First person | Past tense | "said" /reply | Ends with a question | Stock tells | Dashes |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of summaries) { const m = s.mech; lines.push(`| ${s.variant.id} | ${fmt(m.wordsPerReply)} | ${fmt(m.paragraphsPerReply, 1)} | ${fmt(100 * m.speechShare)}% | ${fmt(m.questionsPer10Lines, 1)} | ${fmt(100 * m.interiorPerReply)}% | ${fmt(100 * m.person)}% | ${fmt(100 * m.tense)}% | ${fmt(m.saidPerReply, 1)} | ${fmt(100 * m.endsWithQuestion)}% | ${fmt(m.stockTells)} | ${fmt(m.dashes)} |`); }

// Wiring: the levers reach the prompt.
report.section('Wiring');
for (const v of wanted) {
  const run = runs.find((r) => r.variant.id === v.id && r.turnPrompts.length);
  if (!run) continue;
  const sys = run.turnPrompts[0];
  if (v.style) report.check(`${v.id}.style`, 'its style text is in the prompt', sys.includes(v.style.split('\n')[0].trim()));
  else if (v.preset && WRITING_PRESETS[v.preset]?.content) report.check(`${v.id}.preset`, `the ${v.preset} preset is in the prompt`, sys.includes(WRITING_PRESETS[v.preset].content.split('\n')[0].trim().slice(0, 60)));
  if (v.rules !== undefined) report.check(`${v.id}.rules`, v.rules.trim() ? 'its rules are in the prompt' : 'no rules are in the prompt', v.rules.trim() ? sys.includes(v.rules.trim().split('\n').pop().trim()) : !sys.includes('## How People Talk'));
}
for (const run of runs) {
  // The scene reached the model: its place from the scene state, and a phrase of the situation, in the first turn's request.
  const phrase = run.scene.situation.split('. ')[1] || run.scene.situation;
  report.check(`${run.key}.scene`, 'the place and the situation are in the first turn\'s request', run.firstTurnText.includes(`Location: ${run.scene.scene.location}`) && run.firstTurnText.includes(phrase.slice(0, 40)), `${run.scene.scene.location}; ${phrase.slice(0, 40)}`);
  const names = run.replies.map((r) => r.name);
  const alternates = names.every((n, i) => i === 0 || n !== names[i - 1] || run.userLines.some((u) => u.turn === i));
  if (ORDER === 'alternate') report.check(`${run.key}.turns`, 'the two took turns', alternates, names.join(' > '));
  for (const r of run.replies) { for (const other of run.scene.leads.map((l) => l.name).filter((n) => n !== r.name)) { if (new RegExp(`(^|\\n)\\s*${other}\\s*:`, 'i').test(r.content)) report.check(`${run.key}.leak`, `${r.name} did not write ${other}'s turn`, false, r.content.slice(0, 100)); } }
}

// Motifs and novelty, as in Part 2.
report.section('Repetition');
for (const s of summaries) {
  const mine = runs.filter((r) => r.variant.id === s.variant.id && r.replies.length);
  const echoes = mine.flatMap((r) => motifEchoes(r.replies.map((x) => x.content), { names: [...r.scene.leads.map((l) => l.name), USER], bigramsOnly: true }));
  report.metric(`${s.variant.id}.motif`, 'motif echoes across all scenes', echoes.length, 'record only');
  const nov = mine.map((r) => noveltyByThirds(r.replies.map((x) => x.content), r.scene.situation).thirds);
  if (nov.length) report.metric(`${s.variant.id}.novelty`, 'turns bringing in something new, by thirds (mean)', [0, 1, 2].map((i) => mean(nov.map((t) => t[i])).toFixed(2)).join(' / '), 'record only');
}

// Samples: the exchanges that failed, with the judge's reason; the best scene whole.
report.section('Samples');
for (const s of summaries) {
  const mine = runs.filter((r) => r.variant.id === s.variant.id && (r.exchange || []).length);
  const bad = [];
  for (const r of mine) for (const e of r.exchange) if (!e.takesUp || !e.gives) { const rep = r.replies[e.n - 1]; const prev = r.replies[e.n - 2]; if (rep) bad.push(`[${r.scene.id} #${r.sample} reply ${e.n}] ${!e.takesUp ? 'does not take up' : ''}${!e.takesUp && !e.gives ? ', ' : ''}${!e.gives ? 'gives nothing to answer' : ''}: ${e.why || ''}\n  before: ${(prev?.content || r.userLines[0].text).replace(/\s+/g, ' ').slice(0, 220)}\n  reply:  ${rep.content.replace(/\s+/g, ' ').slice(0, 320)}`); }
  if (bad.length) report.sample(`${s.variant.id}: exchanges that fail`, bad.slice(0, 12).join('\n\n'));
  const best = mine.filter((r) => r.sceneScore).sort((a, b) => Number(b.sceneScore.scores?.readerEngagement?.score || 0) - Number(a.sceneScore.scores?.readerEngagement?.score || 0))[0];
  if (best) report.sample(`${s.variant.id}: best scene (${best.scene.id} #${best.sample}, engagement ${best.sceneScore.scores?.readerEngagement?.score}; where it went: ${best.sceneScore.where || ''})`, best.replies.map((r) => `${r.name}: ${r.content}`).join('\n\n').slice(0, 5000));
}

// ── Calibration: your marks against the judge's ──────────────────────────────

if (argv.includes('--calibration-sheet')) {
  const picks = [];
  for (const r of runs) for (const e of r.exchange || []) if (r.replies[e.n - 1]) picks.push({ r, e });
  const chosen = picks.filter((_, i) => i % Math.max(1, Math.floor(picks.length / 20)) === 0).slice(0, 20);
  const sheet = ['# Reading bench calibration', '', 'For each exchange mark the four with y or n: takes up what was just said; gives the other something to answer; shows a thought; moves the scene. Then run with --replay --calibrate.', ''];
  chosen.forEach(({ r, e }, i) => {
    const rep = r.replies[e.n - 1], prev = r.replies[e.n - 2];
    sheet.push(`## ${i + 1}. ${r.key} reply ${e.n}`, '', `Before (${prev?.name || USER}): ${(prev?.content || r.userLines[0].text).trim()}`, '', `Reply (${rep.name}): ${rep.content.trim()}`, '', 'takesUp: ', 'gives: ', 'thinks: ', 'moves: ', '');
  });
  await fsp.writeFile(CAL_FILE, sheet.join('\n'), 'utf8');
  console.log(`Calibration sheet: ${CAL_FILE} (${chosen.length} exchanges)`);
}
if (argv.includes('--calibrate')) {
  await guarded('calibration', async () => {
    const text = (await fsp.readFile(CAL_FILE, 'utf8')).replace(/\r/g, '');
    const agree = { takesUp: [], gives: [], thinks: [], moves: [] };
    for (const block of text.split(/^## /m).slice(1)) {
      const head = /^\d+\. (.+?) reply (\d+)/.exec(block);
      if (!head) continue;
      const run = runs.find((r) => r.key === head[1]);
      const e = run?.exchange?.find((x) => x.n === Number(head[2]));
      if (!e) continue;
      for (const k of Object.keys(agree)) { const m = new RegExp(`^${k}:\\s*([yn])`, 'mi').exec(block); if (m) agree[k].push((m[1].toLowerCase() === 'y') === !!e[k]); }
    }
    report.section('Calibration');
    for (const [k, xs] of Object.entries(agree)) { report.metric(`calibration.${k}`, `judge agrees with your marks on "${k}" (%)`, pct(xs), '>= 80'); report.check(`calibration.${k}`, `"${k}" is a criterion to trust`, xs.length >= 10 && pct(xs) >= 80, `${xs.length} marked`); }
  });
}

const psAfter = ollamaPs(opts);
await report.write(gw, `${lines.join('\n')}\n\n\`\`\`text\nollama ps before:\n${psBefore}\n\nollama ps after:\n${psAfter}\n\`\`\``);
