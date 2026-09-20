// run-creations-quality.mjs — generation-quality harness for Creations AI.
//
// Sends the REAL prompts the app sends (built by studio-core.js and
// story-core.js) to the local model, one call at a time, and scores what
// comes back: the sheet from a concept, the canon and its Twist from
// sources, a field reroll, Try A Line, story beats, a rewrite, the memory,
// and the Tables grammar (mechanical, no model). The report is a Markdown
// table plus verbatim samples so a person can judge the voice.
//
// Usage:
//   node ext/creations-ai/test/run-creations-quality.mjs --mock
//   node ext/creations-ai/test/run-creations-quality.mjs            (live)
//   --only studio,twist,reroll,story,tables   rerun some sections; the
//          rest are read back from the cache so dependants still have sheets
//   --cache <path>   where the raw outputs are kept (default: os tmpdir)
//   --report <path>  where the Markdown goes (default: last-creations-quality.md)
//   --num-ctx <n>    Ollama num_ctx, 8192 by default, never above 16384
//   --replay         no model calls: rescore the cached outputs of the last
//                    live run (after a change to the checks or the cleaning)
//
// The model is fixed on purpose: it is the one already loaded for the
// user's own chat. The harness never pulls, loads or unloads anything.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as studio from '../studio-core.js';
import * as storyCore from '../story-core.js';
import * as tables from '../tables-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argAfter = (flag, dflt) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : dflt);
const MOCK = args.includes('--mock');
const REPLAY = args.includes('--replay');
const MODE = MOCK ? 'MOCK' : REPLAY ? 'REPLAY' : 'LIVE';
const MODEL = 'qwen3.8:27b';
const OLLAMA = 'http://localhost:11434';
const NUM_CTX = Math.min(16384, Math.max(2048, Number(argAfter('--num-ctx', 8192)) || 8192));
const REPORT = path.resolve(argAfter('--report', path.join(__dirname, 'last-creations-quality.md')));
const CACHE = path.resolve(argAfter('--cache', path.join(os.tmpdir(), 'creations-quality-cache.json')));
const ONLY = new Set((argAfter('--only', 'studio,twist,reroll,story,tables')).split(',').map((s) => s.trim()).filter(Boolean));

const {
  buildCanonMessages, buildTwistMessages, buildSheetMessages, buildFieldMessages, buildTryLineMessages,
  parseJsonLoose, parseCanonFacts, parseTwistedCanon, cleanSheet, cleanFieldValue, stripDashes, characterFromSheet, STUDIO_KEYS,
} = studio;
const { newStory, emptyBrief, castEntryFromCharacter, buildBeatMessages, buildMemoryMessages, cleanBeat } = storyCore;

// ── Bookkeeping ────────────────────────────────────────────────────────────

const results = [];
const calls = [];
const sections = new Map();
let currentSection = '';
function section(name) { currentSection = name; if (!sections.has(name)) sections.set(name, { pass: 0, fail: 0 }); }
function check(id, name, ok, detail = '') {
  const s = sections.get(currentSection);
  if (s) s[ok ? 'pass' : 'fail']++;
  results.push({ id, name, section: currentSection, status: ok ? 'PASS' : 'FAIL', detail: String(detail ?? '') });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' :: ' + String(detail).split('\n')[0].slice(0, 140) : ''}`);
  return ok;
}

/** The raw model outputs of the last live run, by call label, for --replay. */
let replayRaws = null;
function replayMap(prev) {
  const m = {};
  for (const [id, rec] of Object.entries(prev.sheets || {})) m[`${id} sheet`] = rec.raw;
  for (const [id, rec] of Object.entries(prev.twist || {})) { m[`${id} canon`] = rec.canonRaw; m[`${id} twist`] = rec.twistRaw; m[`${id} sheet`] = rec.sheetRaw; }
  m['R1 reroll backstory'] = prev.reroll?.backstory?.raw;
  m['R2 try a line'] = prev.reroll?.tryLine?.raw;
  m['S1 beat 1'] = prev.story?.beats?.[0]?.raw;
  m['S2 beat 2'] = prev.story?.beats?.[1]?.raw;
  m['S3 rewrite beat 2 (slower)'] = prev.story?.rewrite?.raw;
  m['S4 memory'] = prev.story?.memory?.raw;
  return m;
}

function ollamaPs() {
  if (MOCK) return '(mock mode: ollama ps not run)';
  if (REPLAY) return '(replay: no model touched)';
  try { return execSync('ollama ps', { encoding: 'utf8', timeout: 15000 }).trim(); } catch (err) { return `ollama ps failed: ${err?.message || err}`; }
}

async function modelIsLoaded() {
  const res = await fetch(`${OLLAMA}/api/ps`);
  if (!res.ok) throw new Error(`Ollama /api/ps ${res.status}`);
  const j = await res.json();
  return (j.models || []).some((m) => m.name === MODEL || m.model === MODEL);
}

/** One request, never in parallel. Mirrors the app's option mapping (think off, json only where asked). */
async function chat(label, messages, { json = false, temperature = 0.8 } = {}) {
  const started = Date.now();
  if (MOCK) {
    const content = mockRespond(messages);
    calls.push({ label, ms: 0, promptTokens: 0, evalTokens: 0, chars: content.length });
    return content;
  }
  if (REPLAY) {
    const content = replayRaws?.[label];
    if (typeof content !== 'string') throw new Error(`no cached output for "${label}"; run live first`);
    calls.push({ label, ms: 0, promptTokens: 0, evalTokens: 0, chars: content.length });
    return content;
  }
  const body = { model: MODEL, messages, stream: false, think: false, options: { num_ctx: NUM_CTX, temperature } };
  if (json) body.format = 'json';
  const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const content = j.message?.content || '';
  const rec = { label, ms: Date.now() - started, promptTokens: j.prompt_eval_count || 0, evalTokens: j.eval_count || 0, chars: content.length };
  calls.push(rec);
  console.log(`  [call] ${label}: ${(rec.ms / 1000).toFixed(1)}s, prompt ${rec.promptTokens} tok, output ${rec.evalTokens} tok`);
  return content;
}

// ── Text measures ──────────────────────────────────────────────────────────

const DASH = /[—–]/g;
const STOCK_PHRASES = ['eyes sparkling', 'a testament to', 'in the tapestry of', 'little did', "couldn't help but", 'sent shivers', 'a mix of', 'delve'];
const words = (t) => (String(t || '').trim() ? String(t).trim().split(/\s+/).length : 0);
const countDashes = (t) => (String(t || '').match(DASH) || []).length;
const norm = (t) => String(t || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const lower = (t) => norm(t).toLowerCase();
/** Quoted speech out, so a "you" inside a signature phrase is not the writer addressing the reader. Single quotes may hold apostrophes. */
const stripQuotes = (t) => norm(t).replace(/"[^"]*"/g, ' ').replace(/(?<![A-Za-z])'(?:[^'\n]|[A-Za-z]'[A-Za-z])*?'(?![A-Za-z])/g, ' ');
const sentences = (t) => norm(t).split(/(?<=[.!?])\s+(?=["'A-Z\[])/).map((s) => s.trim()).filter((s) => s.length > 0);
const normSentence = (s) => lower(s).replace(/[^a-z0-9 ]+/g, '').trim();

/** Fraction of b's sentences that appear verbatim in a. */
function sentenceOverlap(a, b) {
  const setA = new Set(sentences(a).map(normSentence).filter(Boolean));
  const listB = sentences(b).map(normSentence).filter(Boolean);
  if (listB.length === 0) return 0;
  return listB.filter((s) => setA.has(s)).length / listB.length;
}

/** "you" addressed to the reader, with quoted speech taken out first. Returns the offending snippet or ''. */
function secondPerson(text) {
  const t = stripQuotes(text);
  const m = t.match(/(?:^|[^A-Za-z])(you(?:r|rs|'re|'ll|'ve|'d)?|yourself)(?![A-Za-z])/i);
  if (!m) return '';
  const i = t.indexOf(m[0]);
  return t.slice(Math.max(0, i - 40), i + 40);
}

function stockPhrase(text) {
  const t = lower(text);
  return STOCK_PHRASES.find((p) => t.includes(p)) || '';
}

/**
 * Past against present markers in the narration (dialogue stripped):
 * was/were/had/did, regular -ed verbs and the common irregulars, against
 * is/are/has/does and the common third-person present verbs.
 */
const PAST_IRREGULAR = 'went|came|took|saw|said|made|knew|thought|felt|stood|sat|put|held|let|got|gave|told|found|left|kept|began|ran|brought|heard|met|wrote|spoke|drove|rose|fell|grew|built|lost|won|sent|spent|taught|caught|bought|fought|led|read|set|cut|hit|hung|drew|threw|flew|rang|sang|swam|broke|chose|forgot|became|bore|wore|tore|woke|drank|ate|lay|laid|paid|slept|struck|swung|shook|shone|shut|stuck|understood|wound|meant|learnt|dealt|bent|lent';
const PRESENT_VERBS = 'is|are|has|does|says|goes|comes|takes|sees|knows|thinks|feels|makes|puts|holds|lets|gets|gives|tells|finds|leaves|keeps|begins|runs|brings|hears|meets|writes|speaks|stands|sits|looks|turns|walks|moves|lives|works|wants|needs|watches|waits|opens|closes|pulls|pushes|reaches|steps|nods|shakes|breathes|listens|counts|notices|becomes';
const NOT_PAST_ED = /^(need|bed|red|shed|seed|feed|bleed|speed|indeed|hundred|sacred|naked|wicked|wretched|ragged|rugged|jagged|crooked|beloved|aged|learned|blessed|hatred|kindred|reed|weed|deed|creed|greed|freed|breed|proceed|succeed|exceed|embed|shred|sled|fled)$/i;
function tense(text) {
  const t = stripQuotes(text);
  const past = (t.match(new RegExp(`\\b(was|were|had|did|${PAST_IRREGULAR}|[a-z]{2,}ed)\\b`, 'gi')) || []).filter((w) => !NOT_PAST_ED.test(w)).length;
  const present = (t.match(new RegExp(`\\b(${PRESENT_VERBS})\\b`, 'gi')) || []).length;
  return { past, present };
}

function proseOffender(text) {
  const t = String(text || '');
  const rules = [
    [/^\s*#/m, 'heading'],
    [/\*\*/, 'markdown bold'],
    [/^\s*(beat|chapter)\s*\d*\s*[:.\-]?\s*$/im, 'a beat or chapter label'],
    [/^\s*(beat|chapter)\b[^\n]{0,30}$/im, 'a beat or chapter label'],
    [/\bhere(?:'s| is) (?:the|a|your)\b/i, '"here is"'],
    [/^\s*[\[(]?\s*note\b/im, 'a note'],
    [/\bword count\b/i, 'a word count'],
    [/^\s*---+\s*$/m, 'a rule'],
    [/\bthe end\.?\s*$/i, '"the end"'],
  ];
  for (const [re, label] of rules) { const m = t.match(re); if (m) return `${label}: ${m[0].trim().slice(0, 40)}`; }
  return '';
}

function hasAll(text, groups) {
  const t = lower(text);
  return groups.filter((alts) => !alts.some((a) => t.includes(a.toLowerCase())));
}

/** Words in the text that carry a positive fame claim, not negated in the sixty characters before them. */
function unnegated(text, re, negation = /\b(never|not|no|nor|without|instead of|would have|could have|might have|almost|failed|lost|unfulfilled|abandoned|gave up|turned down|refus\w*|stopped|no longer|once|used to|n't)\b/i) {
  const t = norm(text);
  const out = [];
  let m;
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = g.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 60), m.index);
    if (!negation.test(before)) out.push(t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 20));
  }
  return out;
}

function nameTokens(name) {
  return String(name || '').split(/[\s,]+/).map((s) => s.replace(/[^A-Za-z'-]/g, '')).filter((s) => s.length > 2);
}

/** Proper nouns that are not sentence-initial, plus concrete nouns present, for the memory check. */
function concreteTokens(text) {
  const t = norm(text);
  const set = new Set();
  for (const m of t.matchAll(/(?<![.!?]\s|^|["“])\b([A-Z][a-z]{2,})\b/g)) set.add(m[1]);
  for (const w of ['boat', 'door', 'packet', 'lamp', 'stairs', 'tide', 'tower', 'rope', 'letter', 'oar', 'gallery', 'harbour', 'harbor', 'window', 'ledger', 'coat']) if (new RegExp(`\\b${w}s?\\b`, 'i').test(t)) set.add(w);
  for (const stop of ['The', 'She', 'He', 'They', 'Her', 'His', 'Then', 'When', 'But', 'And', 'There', 'That', 'This', 'What', 'Where', 'Open', 'Facts', 'Not', 'Nothing', 'Behind', 'Inside', 'Outside', 'Below', 'Above', 'Just', 'Only', 'Still', 'Before', 'After', 'Once', 'Even', 'Now', 'Yes', 'No']) set.delete(stop);
  return set;
}

// ── Cases ──────────────────────────────────────────────────────────────────

const CONCEPTS = [
  { id: 'C1', concept: 'A retired forensic accountant who hears music in ledgers.', nouns: [['forensic', 'fraud', 'audit', 'embezzl', 'investigat'], ['accountant', 'accounting', 'audit'], ['ledger'], ['music', 'melod', 'hum', 'tune', 'song', 'chord']] },
  { id: 'C2', concept: 'A hotel night security guard who used to be a stuntman.', nouns: [['hotel'], ['security', 'guard'], ['stunt'], ['night']] },
  { id: 'C3', concept: 'A lighthouse keeper, a woman in her fifties, who cannot swim.', nouns: [['lighthouse', 'the light'], ['keeper'], ['swim']] },
  { id: 'C4', concept: 'A teenage courier in a flooded city, a girl of sixteen.', nouns: [['courier', 'deliver', 'messenger', 'runner'], ['flood', 'water'], ['city', 'street', 'district', 'town', 'rooftop']] },
  { id: 'C5', concept: 'A court composer who has gone deaf.', nouns: [['court'], ['compos'], ['deaf', 'hearing', 'silence', 'silent']] },
];

const BIO_A = `Marisol Adeyemi-Brandt (born 14 March 1979) is a Norwegian stage illusionist and escape artist, best known for the Glass Cabinet, a water escape she has performed in more than forty countries, and for close-up card work that critics have called the most precise of her generation.

Early life. Adeyemi-Brandt was born in Tromso to a Nigerian marine engineer, Folake Adeyemi, and a Norwegian schoolteacher, Sigrid Brandt. She grew up above her mother's classroom in the Storgata district and learned her first card sleights at eleven from a retired sailor, Einar Holm, who ran the harbour kiosk. She has said in interviews that the long polar night made her practise: "Nothing to look at outside, so I looked at my hands." She studied mathematics for two years at the University of Bergen before leaving to work the cruise ships out of Oslo.

Career. Her first stage act, a twelve-minute card routine performed without patter, was booked at the Chat Noir in Oslo in 2003. The Glass Cabinet, developed with her engineer father over three winters, premiered in Hamburg in 2008 and brought her the Mandrake d'Or in 2010; she remains the only Norwegian to have won it. From 2012 to 2019 she headlined a residency at the Corinthia Theatre in London. Her television series, Hands, ran for three seasons on NRK. She has refused every offer to reveal a method and once walked out of a live broadcast when the host pressed her on one.

Personal life. Adeyemi-Brandt married the sound designer Tomas Lindqvist in 2011; they divorced in 2017 and remain close, and Lindqvist still designs the sound for her shows. She has a daughter, Ebba, born in 2013. She lives in Bergen with two greyhounds and keeps her mother's old classroom clock on her workshop wall. She is a vegetarian and has spoken publicly about her fear of open water, which she says the Glass Cabinet was built to master rather than to hide.

Style and personality. She is known for a dry, unhurried manner on stage, speaking rarely and never raising her voice; colleagues describe her as exacting, private and loyal, and impatient with flattery. She is left-handed and tall, with close-cropped hair she has worn grey since her thirties, and performs in a plain black suit without jewellery. Her signature phrase, said quietly at the end of every escape, is "Well. That held."`;

const NOTE_B = `Notes for the campaign. Old Hesper (Hesper Vail), the ferry keeper at Marrow's Crossing.

She has run the rope ferry at Marrow's Crossing for thirty-one years, since her father Aldous Vail drowned there in the spring flood of the year she turned nineteen. She lives in the stone ferry house on the east bank with a one-eyed dog called Pennant and never crosses to the west bank after dark; she says the river "keeps a different time" over there and won't be drawn on it. She is sixty now, broad-shouldered, hands like rope, hair in a grey plait, and wears her father's oilskin whatever the weather. Speaks slow and low, mostly in river terms: a difficult person is "a snag", a lie is "slack water", a good day is "running clean". Never swears, never raises her voice; when she is angry she goes quiet and starts coiling rope. Every spring she takes on two apprentices from the villages and teaches them to read the river, the eddies, the sandbars, where the rope will fray; most give up by midsummer, and she keeps a list of every one who finished in the ferry house ledger. The toll is a copper a head and she has never once let anyone cross for free, not even the priest, though she has been known to "lose" the copper in the river afterwards. Her brother Corwin left for the city twenty years ago and writes twice a year; she has not answered a letter in ten. She keeps a lantern lit on the crossing post all night, every night, and nobody knows who it is for. She is superstitious about the number three: three crossings in a day and she stops. Rumour in the village is that she has a great deal of money buried under the ferry house, and that she has refused three offers from the toll company to buy the crossing. Things she wants: to die at the crossing, and for someone to keep the lantern lit after.`;

const TWIST_CASES = [
  {
    id: 'TA', label: 'Case A (biography + hotel guard Twist)', subject: 'Marisol Adeyemi-Brandt',
    sources: [{ kind: 'paste', title: 'Marisol Adeyemi-Brandt', ref: 'pasted text', text: BIO_A }],
    direction: '',
    twist: 'never became famous and works nights as a hotel security guard',
    twistNouns: [['hotel'], ['security', 'guard'], ['night', 'graveyard', 'overnight']],
    // A present-tense claim of fame is the untwisted life stated as current.
    untwisted: /\b(famous|celebrated|renowned|acclaimed|world-famous|headlin\w*|residency|television series|Mandrake d'Or|won the|award-winning|sold-out|forty countries)\b/i,
  },
  {
    id: 'TB', label: 'Case B (pasted note + wuxia master Twist)', subject: 'Hesper Vail',
    sources: [{ kind: 'paste', title: 'Notes on Old Hesper', ref: 'pasted text', text: NOTE_B }],
    direction: '',
    twist: 'lives in a wuxia world, a sought-after master who refuses students',
    twistNouns: [['wuxia', 'jianghu', 'martial', 'sect'], ['master'], ['student', 'disciple', 'pupil', 'apprentice', 'teach']],
    untwisted: /\b(takes|teaches|trains|welcomes|accepts|took) (on )?(two |her |new |the |a )?(apprentice|student|disciple|pupil)s?\b/i,
  },
];

const PASTED_GENERATOR = `// A tavern, pasted from a Perchance page.
output
  The [name.titleCase] is {a} [adj] [place] run by [owner = keeper]. [owner] serves [dish.pluralForm] and {never|always|sometimes^2} [quirk]. Rooms cost {2-9} silver.
  [owner = keeper] keeps {a} [animal] behind the bar of the [name.titleCase]; [owner] says it is {a} [adj] [animal].

name
  drowned [animal]
  [adj] [animal]
  [animal] and [dish]

adj
  honest
  old
  eager
  unlikely^2
  one-eyed
  useful
  hourly

place
  inn
  alehouse
  waystation

keeper
  Orla
  Ubaid
  Ivo
  Hesper

animal
  owl
  ox
  umbrella bird
  cat
  hound

dish
  eel pie
  onion
  apple tart

quirk
  waters the ale
  sings after midnight
  reads the guests' letters
`;
const KEEPER_NAMES = ['Orla', 'Ubaid', 'Ivo', 'Hesper'];

// ── The mock model ─────────────────────────────────────────────────────────
// Canned replies shaped like a good model's, routed on the system prompt, so
// the harness can be proven without a GPU. One em dash and one name-tagged
// dialogue line are DELIBERATE: they show the cleaning and the raw count.

const MOCK_NAMES = [['accountant', 'Nell Aske'], ['stuntman', 'Dario Quist'], ['lighthouse', 'Maren Holt'], ['courier', 'Pim Okoro'], ['composer', 'Ludo Ferrant']];
let mockCast = ['Maren Holt', 'Pim Okoro'];

function mockSheet(user) {
  const conceptM = user.match(/CHARACTER CONCEPT[^\n]*\n([^\n]+)/);
  const twistM = user.match(/The canon already includes this change: ([^\n]+?)\. Write the character/);
  const concept = conceptM ? conceptM[1].trim() : '';
  const name = user.includes('Marisol') ? 'Marisol Adeyemi-Brandt' : user.includes('Hesper') ? 'Hesper Vail'
    : (MOCK_NAMES.find(([k]) => concept.toLowerCase().includes(k)) || [null, 'Ada Vane'])[1];
  const first = name.split(' ')[0];
  const who = concept ? concept.replace(/\.$/, '').replace(/^A /, 'a ') : `someone who ${twistM ? twistM[1] : 'keeps to themselves'}`;
  // Two words of the concept (or the twist) make each mock dialogue its own, so the sameness check has something to measure.
  const vocab = (concept || (twistM ? twistM[1] : 'quiet rooms')).toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((w) => w.length > 4);
  const nounA = vocab[0] || 'books';
  const nounB = vocab[1] || 'money';
  return {
    name,
    tagline: 'Counts what nobody else can hear',
    description: `${name} is ${who}. ${first} lives in two rented rooms above a shuttered bakery, keeps the same hours every day, and answers questions with questions. Neighbours know ${first} by the coat, not the face.`,
    appearance: `${first} is tall and narrow-shouldered, with grey hair cut close — a habit from years of not caring — and a long charcoal coat worn in every season. The hands are the tell: steady, scarred at the knuckles, always in motion.`,
    personality: `${first} is patient to the point of stubbornness and treats everyone with the same flat courtesy, which people mistake for warmth. What ${first} openly wants is to be left alone with the work; what ${first} needs is for one person to see the work and say it mattered.`,
    voice: `Low and unhurried, with long pauses.\nShort sentences, rarely a question answered directly.\nSays "Show me." and "That will keep."\nNever says "trust me" or "honestly".`,
    backstory: `${first} was born in Tromso in 1968 and grew up above a harbour kiosk. At nineteen ${first} left for Bergen and a job that lasted twenty years. The turning point came at forty-one, when a colleague's mistake cost a friend everything and ${first} said nothing; ${first} has been making up for that silence since.`,
    drives: `Wants: to finish the one piece of work nobody asked for.\nFears: being found ordinary.\nIn the way: a sister who needs money and a habit of saying no.`,
    secrets: `${first} still has the letter that should have been sent in 2009, and the sister must never learn it exists.`,
    relationships: `Ines Okafor: the sister, three years younger, who calls on Sundays and asks for nothing out loud.\nTomas Reyes: the old colleague, now retired, who thinks they are still friends.\nMrs Halvorsen: the landlady, who leaves soup on the stair and is never thanked.`,
    exampleDialogue: `[USER]: Can I ask you something?\n[AI]: "${first} keeps the ${nounA}. Sit."\n[USER]: Do you ever regret leaving?\n[${first}]: "Ask about the ${nounB} again and ${first} leaves."\n[USER]: Fine. What did you do instead?\n[AI]: "The ${nounA} was never the ${nounB}, whatever they told ${first}."`,
    reminder: `${first} never answers a question directly the first time it is asked.`,
  };
}

function mockCanon(user) {
  if (user.includes('Marisol')) {
    return { subject: 'Marisol Adeyemi-Brandt', facts: [
      'Marisol Adeyemi-Brandt was born on 14 March 1979 in Tromso.', 'Marisol Adeyemi-Brandt is a Norwegian stage illusionist and escape artist.',
      'Marisol Adeyemi-Brandt is best known for the Glass Cabinet, a water escape.', 'Marisol Adeyemi-Brandt has performed the Glass Cabinet in more than forty countries.',
      'Her mother Sigrid Brandt was a Norwegian schoolteacher.', 'Her father Folake Adeyemi was a Nigerian marine engineer.',
      'Marisol Adeyemi-Brandt learned her first card sleights at eleven from a retired sailor named Einar Holm.', 'Marisol Adeyemi-Brandt studied mathematics for two years at the University of Bergen.',
      'Marisol Adeyemi-Brandt won the Mandrake d\'Or in 2010.', 'Marisol Adeyemi-Brandt headlined a residency at the Corinthia Theatre in London from 2012 to 2019.',
      'Marisol Adeyemi-Brandt married the sound designer Tomas Lindqvist in 2011 and divorced him in 2017.', 'Marisol Adeyemi-Brandt has a daughter named Ebba, born in 2013.',
      'Marisol Adeyemi-Brandt lives in Bergen with two greyhounds.', 'Marisol Adeyemi-Brandt is afraid of open water.',
      'Marisol Adeyemi-Brandt has a dry, unhurried manner and rarely raises her voice.', 'Marisol Adeyemi-Brandt is tall, left-handed, and wears her hair close-cropped and grey.',
      'Marisol Adeyemi-Brandt performs in a plain black suit without jewellery.', 'Marisol Adeyemi-Brandt says "Well. That held." at the end of every escape.',
    ] };
  }
  return { subject: 'Hesper Vail', facts: [
    'Hesper Vail is the ferry keeper at Marrow\'s Crossing.', 'Hesper Vail has run the rope ferry for thirty-one years.',
    'Her father Aldous Vail drowned at the crossing in a spring flood when she was nineteen.', 'Hesper Vail lives in the stone ferry house on the east bank.',
    'Hesper Vail has a one-eyed dog called Pennant.', 'Hesper Vail never crosses to the west bank after dark.',
    'Hesper Vail is sixty years old, broad-shouldered, with a grey plait.', 'Hesper Vail wears her father\'s oilskin whatever the weather.',
    'Hesper Vail speaks slowly and low, in river terms.', 'Hesper Vail never swears and never raises her voice.',
    'Every spring Hesper Vail takes on two apprentices and teaches them to read the river.', 'Hesper Vail keeps a list of every apprentice who finished in the ferry house ledger.',
    'Hesper Vail has never let anyone cross for free.', 'Her brother Corwin left for the city twenty years ago.',
    'Hesper Vail keeps a lantern lit on the crossing post every night.', 'Hesper Vail stops after three crossings in a day.',
  ] };
}

function mockTwist(user) {
  const facts = [...user.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
  const twist = (user.split('THE CHANGE:')[1] || '').trim();
  const hotel = twist.includes('hotel');
  const subject = facts[0]?.split(' ').slice(0, 2).join(' ') || 'The subject';
  const out = facts.slice(0, -2).map((text) => ({ text, status: 'kept' }));
  for (const old of facts.slice(-2)) {
    out.push({ text: hotel ? `${subject} never won an award and never headlined anywhere.` : `${subject} refuses every student who comes to the crossing.`, status: 'changed', was: old });
  }
  if (hotel) {
    out.push({ text: `${subject} never became famous.`, status: 'added' }, { text: `${subject} works nights as a hotel security guard in Bergen.`, status: 'added' }, { text: `${subject} does card tricks for the night porters when the lobby is empty.`, status: 'added' });
  } else {
    out.push({ text: `${subject} lives in a wuxia world where the river crossing is a place of the jianghu.`, status: 'added' }, { text: `${subject} is a sought-after master whose rope technique is famous across the provinces.`, status: 'added' }, { text: `${subject} refuses students, and sends every disciple who kneels at the crossing away.`, status: 'added' });
  }
  return { facts: out };
}

const MOCK_BEAT_1 = `The lamp had been lit for an hour when Maren Holt counted the tins again. Eleven. She had counted them at noon and at the change of the tide and the number had not moved, which was the trouble with counting. Below the gallery the drowned street ran black to the old customs house, its upper windows showing the water line like a tide mark on a bath. She put the last of the coal on and stood with her back to the stove. Nine days. The relief boat had never been more than four late, not in the flood year, not in the winter the harbour froze. She listened for an engine and heard the sea working at the stair, patient as a clerk.`;
const MOCK_BEAT_2 = `The boat came in under the west face where the swell was least, a flat grey launch with one figure at the tiller and nobody else. Maren watched it from the gallery and did not go down. It was the door she noticed first: the launch had a cabin, and the cabin door hung open and swung with the roll, and no one closed it. A person who meant to come back closed a door. The figure made the painter fast to the ring at the stair, looked up, and lifted a hand. A girl. Sixteen, perhaps, in a coat that had belonged to someone bigger, with a flat oilcloth packet strapped across her chest the way a courier carried a thing that was not hers. Maren went down the stair one hand on the rail, the way she always went down, and did not look at the water.`;
const MOCK_BEAT_2R = `Maren heard the engine before she saw the boat, a note under the wind that came and went with the swell. She stayed on the gallery. Below her the launch found the lee of the west face and slowed, and she took in the whole of it in the order her eyes chose: the door first. The cabin door was open. It swung out and back with every roll, banging softly, and the figure at the tiller let it. Then the figure itself, small, one hand up. Then the packet, strapped flat across the chest under a coat too big for the body inside it. A girl, and a courier, and a door left open, which meant the girl did not expect to sail again soon or did not care. Maren took the stair one step at a time with her hand on the rail and her eyes on the stone.`;

function mockRespond(messages) {
  const sys = messages[0]?.content || '';
  const user = messages[1]?.content || '';
  if (sys.includes('extract established facts')) return JSON.stringify(mockCanon(user));
  if (sys.includes('revise a list of established facts')) return JSON.stringify(mockTwist(user));
  if (sys.includes('exactly one string key')) {
    const first = (user.match(/"name": "([^"]+)"/)?.[1] || 'Ada').split(' ')[0];
    return JSON.stringify({ backstory: `${first} grew up in Tromso, the child of a harbour clerk, and left at twenty for Bergen. The years there were ordinary until one winter a friend was ruined by a mistake ${first} had seen coming and said nothing about. ${first} has not been silent since.` });
  }
  if (sys.includes('character designer for roleplay fiction')) return JSON.stringify(mockSheet(user));
  if (sys.includes('Stay in character')) return 'I am well enough, thank you. The ledgers kept me up again, but they always do.';
  if (sys.includes('novelist')) {
    const castBlock = sys.split('THE CAST\n')[1] || '';
    const names = castBlock.split('\n\n').map((b) => b.split('\n')[0].split(',')[0].trim()).filter(Boolean);
    if (names.length === 2) mockCast = names;
    const [keeper, courier] = mockCast;
    const swap = (t) => t.replace(/Maren Holt/g, keeper).replace(/Maren/g, keeper.split(' ')[0]).replace(/Pim Okoro/g, courier);
    if (user.includes('REWRITE THIS BEAT')) return swap(MOCK_BEAT_2R);
    if (user.includes('Direction for this beat: the boat arrives')) return swap(MOCK_BEAT_2);
    return swap(MOCK_BEAT_1);
  }
  if (sys.includes('memory of a story')) {
    const [keeper, courier] = mockCast;
    return JSON.stringify({ memory: `Where things stand. ${keeper} has just come down the stair to meet the boat; the girl is on the landing with the packet.\nWhat has happened. The relief boat was nine days late. ${keeper} counted eleven tins of food and burned the last of the coal. The boat arrived at dusk under the west face with one person aboard, a girl of about sixteen, ${courier}, who carried a flat oilcloth packet strapped across her chest. ${keeper} noticed the open cabin door before anything else.\nOpen threads. What is in the packet and who sent it. Why the boat came with no crew. Whether the door left open means the girl will not sail back.\nFacts established. Skerry Rock light stands above a drowned harbour district; the customs house is flooded to its upper windows. ${keeper} never looks at the water on the stair. The launch is a flat grey boat with a cabin.` });
  }
  return '{}';
}

// ── Sections ───────────────────────────────────────────────────────────────

const out = { sheets: {}, twist: {}, reroll: {}, story: {}, tables: {} };

async function runStudio() {
  section('Studio from a concept');
  for (const c of CONCEPTS) {
    console.log(`\n${c.id}: ${c.concept}`);
    let raw = '';
    try { raw = await chat(`${c.id} sheet`, buildSheetMessages({ concept: c.concept }), { json: true, temperature: 0.9 }); }
    catch (err) { check(`${c.id}.0`, `${c.id} model call`, false, err.message); continue; }
    const parsed = parseJsonLoose(raw);
    const rawDashes = countDashes(raw);
    const sheet = cleanSheet(parsed);
    out.sheets[c.id] = { concept: c.concept, raw, sheet, rawDashes };
    scoreSheet(c.id, sheet, parsed, rawDashes, { nouns: c.nouns, nounLabel: 'concept' });
  }
  // Across the five: the same names, the same temperament and the same catchphrases would mean one character in five costumes.
  const sheets = CONCEPTS.map((c) => out.sheets[c.id]?.sheet).filter((s) => s?.name);
  if (sheets.length < 2) return;
  const seen = new Map();
  for (const s of sheets) for (const t of nameTokens(s.name)) seen.set(t.toLowerCase(), (seen.get(t.toLowerCase()) || 0) + 1);
  const repeats = [...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t);
  check('X1', 'the five sheets have five different names', repeats.length === 0, repeats.length ? `repeated: ${repeats.join(', ')}` : sheets.map((s) => s.name).join('; '));
  const grams = sheets.map((s) => {
    const ai = s.exampleDialogue.split('\n').filter((l) => l.startsWith('[AI]:')).map((l) => l.replace(/^\[AI\]:\s*/, '')).join(' ');
    const w = lower(ai).replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
    return new Set(w.map((_, i) => w.slice(i, i + 4).join(' ')).filter((g) => g.split(' ').length === 4));
  });
  const shared = new Map();
  grams.forEach((set, i) => { for (const g of set) for (let j = i + 1; j < grams.length; j++) if (grams[j].has(g)) shared.set(g, (shared.get(g) || 0) + 1); });
  const sharedList = [...shared.keys()];
  check('X2', 'no catchphrase shared by two sheets\' dialogue (four-word runs)', sharedList.length < 3, sharedList.length ? sharedList.slice(0, 6).map((g) => `"${g}"`).join(', ') : '');
  const stoic = sheets.filter((s) => new Set((`${s.personality}\n${s.voice}`.match(/\b(quiet|reserved|cold|methodical|precise|clipped|measured|stoic|detached)\b/gi) || []).map((w) => w.toLowerCase())).size >= 2);
  check('X3', 'not every character is the quiet, precise type', stoic.length < sheets.length - 1, `${stoic.length} of ${sheets.length} read as quiet, precise or cold: ${stoic.map((s) => s.name).join(', ')}`);
}

function scoreSheet(id, sheet, parsed, rawDashes, { nouns, nounLabel }) {
  const all = STUDIO_KEYS.map((k) => sheet[k]).join('\n');
  check(`${id}.1`, `${id} valid JSON object`, !!parsed && typeof parsed === 'object', parsed ? '' : 'could not parse');
  const missing = STUDIO_KEYS.filter((k) => !sheet[k]);
  check(`${id}.2`, `${id} all 12 fields present and non-empty`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');
  const you = STUDIO_KEYS.filter((k) => k !== 'exampleDialogue').map((k) => [k, secondPerson(sheet[k])]).find(([, s]) => s);
  const youAre = STUDIO_KEYS.map((k) => sheet[k]).some((v) => /^\s*you are\b/i.test(v));
  check(`${id}.3`, `${id} third person throughout (no "you" to the reader outside the dialogue)`, !you && !youAre, you ? `${you[0]}: ...${you[1]}...` : youAre ? '"You are" opening' : '');
  const userLines = (sheet.exampleDialogue.match(/^\[USER\]:/gm) || []).length;
  const aiLines = (sheet.exampleDialogue.match(/^\[AI\]:/gm) || []).length;
  check(`${id}.4`, `${id} dialogue has three exchanges as [USER]/[AI]`, userLines >= 3 && aiLines >= 3, `${userLines} user, ${aiLines} ai`);
  check(`${id}.5`, `${id} no em/en dashes after cleaning`, countDashes(all) === 0, `raw output had ${rawDashes}`);
  const tagWords = words(sheet.tagline);
  const tagHasName = nameTokens(sheet.name).some((t) => new RegExp(`\\b${t}\\b`, 'i').test(sheet.tagline));
  check(`${id}.6`, `${id} tagline under 12 words and without the name`, tagWords > 0 && tagWords < 12 && !tagHasName, `${tagWords} words: "${sheet.tagline}"`);
  const driveLines = sheet.drives.split('\n').map((s) => s.trim()).filter(Boolean);
  check(`${id}.7`, `${id} drives is three lines`, driveLines.length === 3, `${driveLines.length} lines`);
  const relLines = sheet.relationships.split('\n').map((s) => s.trim()).filter(Boolean);
  const own = new Set(nameTokens(sheet.name).map((t) => t.toLowerCase()));
  const named = relLines.filter((l) => (l.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?/g) || []).some((n) => !own.has(n.toLowerCase().split(' ')[0])));
  check(`${id}.8`, `${id} relationships name at least two people`, named.length >= 2, `${relLines.length} lines, ${named.length} with a name`);
  const stock = stockPhrase(all);
  check(`${id}.9`, `${id} no stock phrases`, !stock, stock ? `found "${stock}"` : '');
  const missingNouns = hasAll(all, nouns);
  check(`${id}.10`, `${id} the ${nounLabel}'s key nouns appear in the sheet`, missingNouns.length === 0, missingNouns.length ? `missing: ${missingNouns.map((g) => g[0]).join(', ')}` : '');
  const bsTense = tense(sheet.backstory);
  check(`${id}.11`, `${id} backstory in the past tense`, bsTense.past >= bsTense.present, `past ${bsTense.past} vs present ${bsTense.present}`);
}

async function runTwist() {
  section('Studio from sources with a Twist');
  for (const tc of TWIST_CASES) {
    console.log(`\n${tc.id}: ${tc.label}`);
    const rec = { label: tc.label, twist: tc.twist };
    out.twist[tc.id] = rec;
    let canonRaw = '';
    try { canonRaw = await chat(`${tc.id} canon`, buildCanonMessages(tc.sources, tc.direction), { json: true, temperature: 0.3 }); }
    catch (err) { check(`${tc.id}.0`, `${tc.id} canon call`, false, err.message); continue; }
    const canonParsed = parseJsonLoose(canonRaw);
    const facts = parseCanonFacts(canonParsed);
    rec.canonRaw = canonRaw; rec.facts = facts; rec.subject = canonParsed?.subject || '';
    check(`${tc.id}.1`, `${tc.id} canon is JSON with 15 to 40 facts`, facts.length >= 15 && facts.length <= 40, `${facts.length} facts, subject "${rec.subject}"`);
    const bad = facts.filter((f) => {
      const t = stripQuotes(f);
      if (/\b(I|me|my|we|our|you|your)\b/.test(t)) return true;
      return t.split(/[.!?]\s+(?=[A-Z])/).length > 1;
    });
    check(`${tc.id}.2`, `${tc.id} each fact is one third-person statement`, facts.length > 0 && bad.length <= Math.ceil(facts.length * 0.1), bad.length ? `${bad.length} off: ${bad[0].slice(0, 90)}` : '');
    const subjectNamed = facts.filter((f) => nameTokens(tc.subject).some((t) => f.includes(t))).length;
    check(`${tc.id}.3`, `${tc.id} facts use the subject's name`, subjectNamed >= facts.length * 0.5, `${subjectNamed} of ${facts.length} name ${tc.subject.split(' ')[0]}`);

    let twistRaw = '';
    try { twistRaw = await chat(`${tc.id} twist`, buildTwistMessages(facts, tc.twist), { json: true, temperature: 0.5 }); }
    catch (err) { check(`${tc.id}.4`, `${tc.id} twist call`, false, err.message); continue; }
    const twisted = parseTwistedCanon(parseJsonLoose(twistRaw), facts);
    rec.twistRaw = twistRaw; rec.twisted = twisted;
    const base = new Set(facts.map(norm));
    const kept = twisted.filter((f) => f.status === 'kept');
    const keptExact = kept.filter((f) => base.has(norm(f.text)));
    const changed = twisted.filter((f) => f.status === 'changed');
    const changedWithWas = changed.filter((f) => f.was);
    const added = twisted.filter((f) => f.status === 'added');
    const keptRatio = facts.length ? keptExact.length / facts.length : 0;
    check(`${tc.id}.4`, `${tc.id} at least 60% of the canon kept word for word`, keptRatio >= 0.6, `${keptExact.length} of ${facts.length} exact (${Math.round(keptRatio * 100)}%); ${kept.length - keptExact.length} marked kept but reworded`);
    const reallyChanged = changedWithWas.filter((f) => norm(f.text) !== norm(f.was));
    check(`${tc.id}.5`, `${tc.id} at least two facts changed, each with a "was" that differs`, reallyChanged.length >= 2, `${changed.length} changed, ${changedWithWas.length} with was, ${reallyChanged.length} actually different`);
    check(`${tc.id}.6`, `${tc.id} added facts are no more than a third`, twisted.length > 0 && added.length <= twisted.length / 3, `${added.length} added of ${twisted.length}`);
    const moved = [...changed, ...added].map((f) => f.text).join('\n');
    const missingTwist = hasAll(moved, tc.twistNouns);
    check(`${tc.id}.7`, `${tc.id} changed and added facts carry the Twist's nouns`, missingTwist.length === 0, missingTwist.length ? `missing: ${missingTwist.map((g) => g[0]).join(', ')}` : `${changed.length + added.length} moved facts`);

    const active = twisted.map((f) => f.text);
    let sheetRaw = '';
    try { sheetRaw = await chat(`${tc.id} sheet`, buildSheetMessages({ canon: active, twist: tc.twist }), { json: true, temperature: 0.9 }); }
    catch (err) { check(`${tc.id}.8`, `${tc.id} sheet call`, false, err.message); continue; }
    const parsed = parseJsonLoose(sheetRaw);
    const sheet = cleanSheet(parsed);
    rec.sheetRaw = sheetRaw; rec.sheet = sheet; rec.rawDashes = countDashes(sheetRaw);
    const life = `${sheet.description}\n${sheet.backstory}`;
    const missingLife = hasAll(life, tc.twistNouns);
    check(`${tc.id}.8`, `${tc.id} description and backstory live the twisted life`, missingLife.length === 0, missingLife.length ? `missing: ${missingLife.map((g) => g[0]).join(', ')}` : '');
    const stale = unnegated(life, tc.untwisted);
    check(`${tc.id}.9`, `${tc.id} the untwisted life is never stated as current`, stale.length === 0, stale.length ? `${stale.length}: ...${stale[0]}...` : '');
    const nameOk = nameTokens(tc.subject).some((t) => sheet.name.includes(t));
    check(`${tc.id}.10`, `${tc.id} the name survives`, nameOk, `"${sheet.name}"`);
    scoreSheet(`${tc.id}S`, sheet, parsed, rec.rawDashes, { nouns: tc.twistNouns, nounLabel: 'Twist' });
  }
}

async function runReroll() {
  section('Reroll and Try A Line');
  const c = CONCEPTS[0];
  const base = out.sheets[c.id];
  if (!base?.sheet?.name) { check('R1.0', 'a sheet to reroll from', false, `no sheet for ${c.id} (run studio first)`); return; }
  const sheet = base.sheet;
  const first = sheet.name.split(' ')[0];
  let raw = '';
  try { raw = await chat('R1 reroll backstory', buildFieldMessages({ concept: c.concept }, sheet, 'backstory'), { json: true, temperature: 0.9 }); }
  catch (err) { check('R1.0', 'reroll call', false, err.message); return; }
  const parsed = parseJsonLoose(raw);
  const next = parsed && typeof parsed.backstory === 'string' ? cleanFieldValue('backstory', parsed.backstory) : '';
  out.reroll.backstory = { before: sheet.backstory, after: next, raw };
  check('R1.1', 'reroll returns JSON with one "backstory" string', !!next, next ? `${words(next)} words` : `raw: ${raw.slice(0, 80)}`);
  const overlap = sentenceOverlap(sheet.backstory, next);
  check('R1.2', 'the new backstory differs (under 60% of sentences shared)', !!next && next !== sheet.backstory && overlap < 0.6, `${Math.round(overlap * 100)}% shared`);
  check('R1.3', 'the new backstory still belongs to the same character', nameTokens(sheet.name).some((t) => next.includes(t)), `looks for "${first}"`);
  const you = secondPerson(next);
  check('R1.4', 'the new backstory is third person, past tense, no dashes', !you && countDashes(next) === 0 && tense(next).past >= tense(next).present, you ? `you: ${you}` : `raw dashes ${countDashes(raw)}; past ${tense(next).past} vs present ${tense(next).present}`);

  let line = '';
  try { line = await chat('R2 try a line', buildTryLineMessages(sheet, 'Are you well?'), { json: false, temperature: 0.85 }); }
  catch (err) { check('R2.0', 'try a line call', false, err.message); return; }
  const shown = stripDashes(line).trim();
  out.reroll.tryLine = { raw: line, shown };
  const firstPerson = /(?:^|[^A-Za-z])(I|I'm|I've|I'd|I'll|me|my|mine|myself)(?![A-Za-z])/.test(shown.replace(/[’]/g, "'"));
  const aboutSelf = new RegExp(`^\\s*\\*?\\s*(?:${first}|She|He|They)\\s+(?:said|says|replied|replies|looked|looks|nodded|nods)`, 'i').test(shown);
  check('R2.1', 'Try A Line answers in the first person', firstPerson && !aboutSelf, shown.slice(0, 120));
  const n = sentences(shown).length;
  check('R2.2', 'Try A Line is one to four sentences', n >= 1 && n <= 4, `${n} sentences, ${words(shown)} words`);
  check('R2.3', 'Try A Line has no narration markers, no speaker tag, no "As an AI"', !shown.includes('*') && !/as an ai|language model/i.test(shown) && !/^\s*\[[^\]]+\]\s*:/.test(shown) && !new RegExp(`^\\s*${first}\\s*:`).test(shown), '');
}

async function runStory() {
  section('Story');
  // The keeper and the courier by preference; any two named sheets if one of those came back nameless.
  const named = CONCEPTS.map((c) => out.sheets[c.id]?.sheet).filter((s) => s?.name);
  const keeperSrc = out.sheets.C3?.sheet?.name ? out.sheets.C3.sheet : named[0];
  const courierSrc = out.sheets.C4?.sheet?.name ? out.sheets.C4.sheet : named.find((s) => s !== keeperSrc);
  if (!keeperSrc || !courierSrc) { check('S0', 'two sheets for the cast', false, 'run studio first'); return; }
  const cast = [
    castEntryFromCharacter('character-c3.json', characterFromSheet(keeperSrc)),
    castEntryFromCharacter('character-c4.json', characterFromSheet(courierSrc)),
  ];
  const keeper = cast[0].name;
  const courier = cast[1].name;
  const story = newStory('quality-story');
  story.title = 'The Relief Boat';
  story.brief = {
    ...emptyBrief(),
    premise: `In a city three years under water, the light on Skerry Rock is the last dry post. The relief boat is nine days late, and when it comes it carries only ${courier}, sixteen, with a sealed packet addressed to ${keeper} by name.`,
    genre: 'quiet drama',
    setting: 'Skerry Rock light, a stone tower above the drowned harbour district; late autumn',
    style: 'spare, concrete, no melodrama',
    pov: 'third-limited', tense: 'past', beatLength: 'short', cast,
  };
  out.story = { cast, brief: story.brief, beats: [] };

  const beatChecks = (id, text, raw) => {
    const offender = proseOffender(text);
    check(`${id}.1`, `${id} prose only`, !offender, offender);
    const t = tense(text);
    check(`${id}.2`, `${id} past tense dominant in narration`, t.past > t.present, `past ${t.past} vs present ${t.present}`);
    const w = words(text);
    check(`${id}.3`, `${id} about a short beat (90 to 260 words)`, w >= 90 && w <= 260, `${w} words`);
    check(`${id}.4`, `${id} no em/en dashes after cleaning`, countDashes(text) === 0, `raw output had ${countDashes(raw)}`);
  };

  // Beat 1 is told to stay before the arrival so that beat 2's direction has something to do.
  const instruction1 = 'the ninth day of waiting; the boat has not come yet';
  let raw1 = '';
  try { raw1 = await chat('S1 beat 1', buildBeatMessages({ story, mode: 'continue', instruction: instruction1 }), { temperature: 0.85 }); }
  catch (err) { check('S1.0', 'beat 1 call', false, err.message); return; }
  const b1 = { id: 'b1', chapterId: 'ch-1', text: cleanBeat(raw1), instruction: instruction1, createdAt: Date.now() };
  story.beats.push(b1);
  out.story.beats.push({ id: 'b1', raw: raw1, text: b1.text });
  beatChecks('S1', b1.text, raw1);

  const instruction = 'the boat arrives, she notices the door first';
  let raw2 = '';
  try { raw2 = await chat('S2 beat 2', buildBeatMessages({ story, mode: 'continue', instruction }), { temperature: 0.85 }); }
  catch (err) { check('S2.0', 'beat 2 call', false, err.message); return; }
  const b2 = { id: 'b2', chapterId: 'ch-1', text: cleanBeat(raw2), instruction, createdAt: Date.now() };
  story.beats.push(b2);
  out.story.beats.push({ id: 'b2', raw: raw2, text: b2.text, instruction });
  beatChecks('S2', b2.text, raw2);
  check('S2.5', 'S2 the direction was obeyed (the boat arrives, the door appears)', /\b(boat|launch|vessel|hull|engine|skiff|dinghy)\b/i.test(b2.text) && /\bdoor\b/i.test(b2.text), `boat by name: ${/\bboat\b/i.test(b2.text)}`);

  let raw3 = '';
  try { raw3 = await chat('S3 rewrite beat 2 (slower)', buildBeatMessages({ story, mode: 'rewrite', target: b2, instruction: 'slower' }), { temperature: 0.85 }); }
  catch (err) { check('S3.0', 'rewrite call', false, err.message); return; }
  const rewritten = cleanBeat(raw3);
  out.story.rewrite = { raw: raw3, text: rewritten, of: 'b2' };
  beatChecks('S3', rewritten, raw3);
  const overlap = sentenceOverlap(b2.text, rewritten);
  check('S3.5', 'S3 the rewrite differs from beat 2 and is not shorter than half', overlap < 0.5 && words(rewritten) >= words(b2.text) / 2, `${Math.round(overlap * 100)}% sentences shared; ${words(rewritten)} vs ${words(b2.text)} words`);
  b2.text = rewritten;

  let raw4 = '';
  try { raw4 = await chat('S4 memory', buildMemoryMessages(story, 0), { json: true, temperature: 0.2 }); }
  catch (err) { check('S4.0', 'memory call', false, err.message); return; }
  const parsed = parseJsonLoose(raw4);
  const memory = parsed && typeof parsed.memory === 'string' ? stripDashes(parsed.memory).trim() : '';
  out.story.memory = { raw: raw4, text: memory };
  check('S4.1', 'S4 memory is JSON with a "memory" string', !!memory, memory ? '' : raw4.slice(0, 80));
  check('S4.2', 'S4 memory under 250 words', words(memory) > 0 && words(memory) < 250, `${words(memory)} words`);
  const tokens = concreteTokens(`${b1.text}\n${b2.text}`);
  const castTokens = new Set(cast.flatMap((c) => nameTokens(c.name)));
  const shared = [...tokens].filter((t) => !castTokens.has(t) && new RegExp(`\\b${t}s?\\b`, 'i').test(memory));
  check('S4.3', 'S4 memory holds at least three concrete facts from the beats', shared.length >= 3, `shared: ${shared.slice(0, 8).join(', ')}`);
  const namesIn = cast.filter((c) => nameTokens(c.name).some((t) => memory.includes(t)));
  check('S4.4', 'S4 memory names the cast', namesIn.length === cast.length, namesIn.map((c) => c.name).join(', ') || 'none');
  const headings = ['Where things stand', 'What has happened', 'Open threads', 'Facts established'].filter((h) => memory.toLowerCase().includes(h.toLowerCase()));
  check('S4.5', 'S4 memory keeps the four headings', headings.length === 4, `${headings.length} of 4`);
}

function articleOffenders(text) {
  const out = [];
  for (const m of String(text).matchAll(/\b(a|an)\s+([A-Za-z][\w'-]*)/gi)) {
    const w = m[2].toLowerCase();
    let an = /^[aeiou]/.test(w);
    if (/^(hour|honest|honou?r|heir)/.test(w)) an = true;
    if (/^(uni|use|user|usual|utensil|one|once|euro|ewe)/.test(w)) an = false;
    if ((m[1].toLowerCase() === 'an') !== an) out.push(m[0]);
  }
  return out;
}

function runTables() {
  section('Tables');
  const gen = tables.parseTables(tables.STARTER_TABLE);
  check('T1.1', 'T1 the starter table parses clean', gen.errors.length === 0, gen.errors.join('; '));
  const rolled = tables.roll(gen, 20, 'output', {});
  out.tables.starter = rolled.results;
  check('T1.2', 'T1 twenty rolls report no errors', rolled.errors.length === 0, rolled.errors.join('; '));
  const leftovers = rolled.results.filter((r) => /[\[\]{}]/.test(r));
  check('T1.3', 'T1 no brackets or braces left in twenty rolls', leftovers.length === 0, leftovers[0] || '');
  const empty = rolled.results.filter((r) => !r.trim());
  check('T1.4', 'T1 every roll has text', empty.length === 0, `${rolled.results.length} rolls`);
  const badArticles = rolled.results.flatMap(articleOffenders);
  check('T1.5', 'T1 articles agree with the next word', badArticles.length === 0, badArticles.join(', ') || rolled.results[0]);

  const own = tables.parseTables(PASTED_GENERATOR);
  check('T2.1', 'T2 a pasted Perchance-style generator parses clean', own.errors.length === 0, own.errors.join('; '));
  const rolledOwn = tables.roll(own, 20, 'output', {});
  out.tables.pasted = rolledOwn.results;
  check('T2.2', 'T2 twenty rolls report no errors', rolledOwn.errors.length === 0, rolledOwn.errors.join('; '));
  const left2 = rolledOwn.results.filter((r) => /[\[\]{}]/.test(r));
  check('T2.3', 'T2 no brackets or braces left', left2.length === 0, left2[0] || '');
  const bad2 = rolledOwn.results.flatMap(articleOffenders);
  const vowelSeen = rolledOwn.results.some((r) => /\ban\s+(owl|ox|umbrella|old|eager|unlikely|honest|hourly)\b/i.test(r));
  check('T2.4', 'T2 articles agree, with vowel and h-silent cases exercised', bad2.length === 0 && vowelSeen, bad2.join(', ') || (vowelSeen ? '' : 'no vowel case rolled'));
  const varBad = rolledOwn.results.filter((r) => {
    const found = KEEPER_NAMES.filter((n) => r.includes(n));
    if (found.length !== 1) return true;
    return (r.match(new RegExp(`\\b${found[0]}\\b`, 'g')) || []).length !== 2;
  });
  check('T2.5', 'T2 a variable prints the same pick both times', varBad.length === 0, varBad[0] || rolledOwn.results[0]);
  const plural = rolledOwn.results.some((r) => /\b(eel pies|onions|apple tarts)\b/.test(r));
  const titled = rolledOwn.results.every((r) => /\bThe [A-Z][a-z-]+(?: [A-Z][a-z-]+)*\b/.test(r) || /\bof the [A-Z]/.test(r));
  check('T2.6', 'T2 pluralForm and titleCase land', plural && titled, `plural seen ${plural}, titled ${titled}`);
}

// ── Report ─────────────────────────────────────────────────────────────────

const cell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').slice(0, 220);
const fence = (s) => ['```', String(s ?? '').replace(/```/g, "'''"), '```'].join('\n');

function sheetMarkdown(sheet) {
  return studio.STUDIO_FIELDS.map((f) => `**${f.label}**\n\n${(sheet[f.key] || '(empty)').trim()}`).join('\n\n');
}

function verdictLines() {
  const lines = [];
  const bySection = (name) => results.filter((r) => r.section === name);
  const summarise = (label, rows, note) => {
    const fails = rows.filter((r) => r.status === 'FAIL');
    lines.push(`- **${label}**: ${rows.length - fails.length} of ${rows.length} checks pass${fails.length ? `; failing: ${fails.map((r) => r.id).join(', ')}` : ''}. ${note}`);
  };
  const studioRows = bySection('Studio from a concept');
  summarise('Sheet from a concept (buildSheetMessages)', studioRows, studioRows.length ? (studioRows.every((r) => r.status === 'PASS') ? 'The concept prompt holds.' : 'See the failing checks for what the prompt does not yet enforce.') : 'Not run.');
  const twistRows = bySection('Studio from sources with a Twist');
  summarise('Canon, Twist and the sheet from canon', twistRows, twistRows.length ? '' : 'Not run.');
  const rerollRows = bySection('Reroll and Try A Line');
  summarise('Reroll (buildFieldMessages) and Try A Line', rerollRows, rerollRows.length ? '' : 'Not run.');
  const storyRows = bySection('Story');
  summarise('Beats, rewrite and memory (story-core)', storyRows, storyRows.length ? '' : 'Not run.');
  const tableRows = bySection('Tables');
  summarise('Tables grammar (mechanical)', tableRows, '');
  return lines;
}

async function writeReport({ psBefore, psAfter, wallMs, aborted = '' }) {
  const lines = [
    '# Creations AI quality report',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Mode: ${MODE}${REPLAY ? ` (the cached outputs of the live run of ${out.liveAt || 'an earlier date'}, rescored without a model call)` : ''}  |  Model: ${MODEL}  |  num_ctx: ${NUM_CTX}  |  temperatures as the app sends them`,
    `- Sections: ${[...ONLY].join(', ')}  |  Model calls: ${calls.length}${REPLAY ? ' replayed' : ''}  |  Wall time: ${(wallMs / 1000).toFixed(0)}s${REPLAY && out.liveWallMs ? ` (the live run took ${(out.liveWallMs / 1000).toFixed(0)}s)` : ''}`,
    `- Result: ${results.filter((r) => r.status === 'PASS').length} pass, ${results.filter((r) => r.status === 'FAIL').length} fail`,
    aborted ? `- ABORTED: ${aborted}` : '',
    '',
    `## ollama ps${REPLAY ? ' (as recorded by the live run)' : ''}`,
    '',
    'Before:', '', fence(REPLAY ? out.ps?.before : psBefore), '', 'After:', '', fence(REPLAY ? out.ps?.after : psAfter), '',
    '## Scores by section',
    '',
    '| Section | Pass | Fail |',
    '|---|---|---|',
    ...[...sections.entries()].map(([name, s]) => `| ${name} | ${s.pass} | ${s.fail} |`),
    '',
    '## Checks',
    '',
    '| # | Check | Result | Detail |',
    '|---|-------|--------|--------|',
    ...results.map((r) => `| ${r.id} | ${cell(r.name)} | ${r.status} | ${cell(r.detail)} |`),
    '',
    '## Calls',
    '',
    '| Call | Seconds | Prompt tokens | Output tokens |',
    '|---|---|---|---|',
    ...calls.map((c) => `| ${c.label} | ${(c.ms / 1000).toFixed(1)} | ${c.promptTokens} | ${c.evalTokens} |`),
    '',
    '## Prompt verdicts',
    '',
    ...verdictLines(),
    '',
  ];

  // Samples: the best concept sheet, the twisted canon of case A, beat 2 and its rewrite.
  const sheetScores = Object.keys(out.sheets).map((id) => ({ id, passes: results.filter((r) => r.id.startsWith(`${id}.`) && r.status === 'PASS').length, dashes: out.sheets[id].rawDashes }));
  sheetScores.sort((a, b) => b.passes - a.passes || a.dashes - b.dashes);
  const best = sheetScores[0];
  lines.push('## Samples', '');
  if (best) {
    lines.push(`### Best sheet: ${best.id} (${best.passes} checks passed, ${best.dashes} raw dashes)`, '', `Concept: ${out.sheets[best.id].concept}`, '', sheetMarkdown(out.sheets[best.id].sheet), '');
  }
  const ta = out.twist.TA;
  if (ta?.twisted) {
    lines.push(`### Twisted canon, case A: "${ta.twist}"`, '', `Canon: ${ta.facts.length} facts for ${ta.subject || 'the subject'}.`, '');
    for (const status of ['kept', 'changed', 'added']) {
      const list = ta.twisted.filter((f) => f.status === status);
      lines.push(`**${status[0].toUpperCase()}${status.slice(1)} (${list.length})**`, '');
      for (const f of list) lines.push(`- ${f.text}${f.was ? `\n  - was: ${f.was}` : ''}`);
      lines.push('');
    }
    if (ta.sheet) lines.push('**The twisted sheet (description and backstory)**', '', ta.sheet.description, '', ta.sheet.backstory, '');
  }
  const tb = out.twist.TB;
  if (tb?.twisted) {
    const moved = tb.twisted.filter((f) => f.status !== 'kept');
    lines.push(`### Twisted canon, case B: "${tb.twist}" (changed and added only)`, '');
    for (const f of moved) lines.push(`- [${f.status}] ${f.text}${f.was ? `\n  - was: ${f.was}` : ''}`);
    lines.push('');
    if (tb.sheet) lines.push('**The twisted sheet (description)**', '', tb.sheet.description, '');
  }
  if (out.story.beats?.length) {
    lines.push('### Story: beat 1', '', out.story.beats[0].text, '');
    if (out.story.beats[1]) lines.push(`### Story: beat 2 (direction: "${out.story.beats[1].instruction}")`, '', out.story.beats[1].text, '');
    if (out.story.rewrite) lines.push('### Story: beat 2 rewritten with "slower"', '', out.story.rewrite.text, '');
    if (out.story.memory) lines.push('### Story memory', '', fence(out.story.memory.text), '');
  }
  if (out.reroll.backstory) lines.push('### Reroll: backstory before and after', '', '**Before**', '', out.reroll.backstory.before, '', '**After**', '', out.reroll.backstory.after || '(nothing)', '');
  if (out.reroll.tryLine) lines.push('### Try A Line: "Are you well?"', '', fence(out.reroll.tryLine.shown), '');
  if (out.tables.starter) lines.push('### Tables: five rolls of the starter', '', ...out.tables.starter.slice(0, 5).map((r) => `- ${r}`), '', '### Tables: five rolls of the pasted generator', '', ...out.tables.pasted.slice(0, 5).map((r) => `- ${r}`), '');

  lines.push('## Appendix: every sheet', '');
  for (const [id, rec] of Object.entries(out.sheets)) {
    if (id === best?.id) continue;
    lines.push(`### ${id}: ${rec.concept}`, '', sheetMarkdown(rec.sheet), '');
  }
  for (const [id, rec] of Object.entries(out.twist)) if (rec.sheet) lines.push(`### ${id}: ${rec.label}`, '', sheetMarkdown(rec.sheet), '');

  await fsp.writeFile(REPORT, lines.filter((l) => l !== undefined).join('\n'));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const started = Date.now();
  const psBefore = ollamaPs();
  console.log(`ollama ps (before):\n${psBefore}\n`);
  if (!MOCK && !REPLAY) {
    let loaded = false;
    try { loaded = await modelIsLoaded(); } catch (err) { console.error(err.message); }
    if (!loaded) {
      await writeReport({ psBefore, psAfter: psBefore, wallMs: Date.now() - started, aborted: `${MODEL} is not loaded; nothing was sent (the harness never loads a model).` });
      console.error(`${MODEL} is not loaded. Stopping without sending anything.`);
      process.exit(3);
    }
  }
  // Sections not run this time come from the cache so dependants still have their sheets.
  try {
    const prev = JSON.parse(await fsp.readFile(CACHE, 'utf8'));
    for (const k of Object.keys(out)) if (prev[k]) out[k] = prev[k];
    if (REPLAY) { replayRaws = replayMap(prev); out.ps = prev.ps; out.liveAt = prev.liveAt; out.liveWallMs = prev.liveWallMs; }
  } catch (err) { if (REPLAY) { console.error(`--replay needs a cache from a live run: ${err.message}`); process.exit(3); } }
  if (ONLY.has('studio')) await runStudio();
  if (ONLY.has('twist')) await runTwist();
  if (ONLY.has('reroll')) await runReroll();
  if (ONLY.has('story')) await runStory();
  if (ONLY.has('tables')) runTables();
  const psAfter = ollamaPs();
  console.log(`\nollama ps (after):\n${psAfter}`);
  if (!MOCK && !REPLAY) { out.ps = { before: psBefore, after: psAfter }; out.liveAt = new Date().toISOString(); out.liveWallMs = Date.now() - started; }
  if (!REPLAY) await fsp.writeFile(CACHE, JSON.stringify(out, null, 2));
  await writeReport({ psBefore, psAfter, wallMs: Date.now() - started });
  const fails = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\nDONE: ${results.length - fails} pass, ${fails} fail, ${calls.length} calls, ${((Date.now() - started) / 1000).toFixed(0)}s. Report: ${REPORT}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (err) => { console.error(err); process.exit(2); });
