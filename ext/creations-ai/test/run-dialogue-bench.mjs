// run-dialogue-bench.mjs — tuning dialogue so characters sound like people.
// Runs the variants in dialogue-variants.md (the levers: dialogue rules,
// temperature, writing preset and style, reminder, example dialogue) on the
// same everyday scenes through the real chat, and a dialogue judge flags each
// spoken line that a person would not say: abstract topics, metaphors and
// aphorisms, fixing on trivia, roundabout "clever" questions, forced wit,
// unnatural lines; and, so tuning does not make it dry, flat lines and wit
// that lands. Each variant is compared with baseline.
//
//   node ext/creations-ai/test/run-dialogue-bench.mjs --mock
//   node ext/creations-ai/test/run-dialogue-bench.mjs                  all variants, play then judge
//   node ext/creations-ai/test/run-dialogue-bench.mjs --only baseline,direct-questions
//   node ext/creations-ai/test/run-dialogue-bench.mjs --ablate         plus one variant per shipped rule left out
//   node ext/creations-ai/test/run-dialogue-bench.mjs --triggers       the trigger-word study instead
//   node ext/creations-ai/test/run-dialogue-bench.mjs --replay --calibration-sheet
//        writes dialogue-calibration.md: 40 lines for you to mark
//   node ext/creations-ai/test/run-dialogue-bench.mjs --replay --calibrate
//        compares your marks in dialogue-calibration.md with the judge's
//   other options: harness-common.mjs (--model, --judge, --samples, --num-ctx, --pass)

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startChatDriver, slug, kindOf } from './chat-driver.mjs';
import { parseArgs, createGateway, createReport, judgeJson, ollamaPs, SkipCase, abstractSubjects } from './harness-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const opts = parseArgs(process.argv, { name: 'dialogue-bench', report: path.join(__dirname, 'last-dialogue-bench.md'), samples: 2 });
const argv = process.argv.slice(2);
const TRIGGERS = argv.includes('--triggers');
const ABLATE = argv.includes('--ablate');
const CAL_FILE = path.join(__dirname, 'dialogue-calibration.md');
const USER = 'Sam';

// ── Levers: dialogue-variants.md, and the app's own shipped rules ──────────

async function shippedRules() {
  const src = await fsp.readFile(path.join(__dirname, '..', 'main.js'), 'utf8');
  const m = /const DEFAULT_DIALOGUE_RULES = \[([\s\S]*?)\]\.join\('\\n'\);/.exec(src);
  if (!m) throw new Error('DEFAULT_DIALOGUE_RULES not found in main.js');
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
}

async function readVariants(shipped) {
  const text = (await fsp.readFile(path.join(__dirname, 'dialogue-variants.md'), 'utf8')).replace(/\r/g, '');
  const [variantPart, triggerPart = ''] = text.split(/^# Trigger words\s*$/m);
  const variants = [];
  let cur = null;
  let block = null;
  for (const line of variantPart.split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h) { cur = { id: h[1].trim() }; variants.push(cur); block = null; continue; }
    if (!cur) continue;
    const kv = /^(Rules|Temperature|Preset|Style|Reminder|Example dialogue|Anchor):\s*(.*)$/i.exec(line);
    if (kv) {
      const key = kv[1].toLowerCase();
      const val = kv[2].trim();
      block = null;
      // "shipped +": the app's rules, then the lines that follow.
      if (key === 'rules') { if (/^shipped\s*(\+|plus)$/i.test(val)) { cur.rules = shipped.join('\n'); block = 'rules'; } else if (/^shipped$/i.test(val)) cur.rules = shipped.join('\n'); else if (/^none$/i.test(val)) cur.rules = ''; else { cur.rules = val; block = 'rules'; } }
      else if (key === 'style') { cur.style = val; block = 'style'; }
      else if (key === 'temperature') cur.temperature = Number(val);
      else if (key === 'preset') cur.preset = val;
      else if (key === 'reminder') cur.reminder = val;
      else if (key === 'example dialogue') cur.noExamples = /^off$/i.test(val);
      else if (key === 'anchor') cur.anchor = val.toLowerCase();
      continue;
    }
    if (block && line.trim()) cur[block] = [cur[block], line].filter(Boolean).join('\n');
  }
  const triggers = triggerPart.split('\n').map((l) => /^-\s+(.+)$/.exec(l.trim())?.[1]).filter(Boolean);
  return { variants, triggers };
}

// The per-turn voice reminder (main.js, generateTurn's late anchor). The bench
// runs a version of it from a temporary copy of the chat; the app is untouched.
const ANCHOR_LINE = "const personaLine = anchorBody ? ` Voice anchor (how ${rName} speaks; any quoted phrases show the register and are not lines to repeat: use one rarely, never twice in a scene, never to open a reply): ${anchorBody.slice(0, 400)}` : '';";
const STRICT = "Stay strictly in ${rName}'s voice.";
const ANCHORS = {
  // The voice as a tendency: most speech plain, the habits now and then.
  soft: (src) => src
    .replace(ANCHOR_LINE, "const personaLine = anchorBody ? ` How ${rName} talks, as a tendency and not a rule for every line: most of what ${rName} says is plain, ordinary speech that answers what was just said, and these habits show now and then (quoted phrases show the register and are not lines to repeat): ${anchorBody.slice(0, 400)}` : '';")
    .replace(STRICT, 'Sound like ${rName}.'),
  // No voice text in the reminder at all: the voice stays in the portrait at the top.
  identity: (src) => src.replace(ANCHOR_LINE, "const personaLine = '';").replace(STRICT, 'Sound like ${rName}.'),
};
async function patchedMain(anchor) {
  const src = await fsp.readFile(path.join(__dirname, '..', 'main.js'), 'utf8');
  if (!ANCHORS[anchor]) throw new Error(`Unknown Anchor "${anchor}": use shipped, ${Object.keys(ANCHORS).join(', ')}.`);
  if (!src.includes(ANCHOR_LINE) || !src.includes(STRICT)) throw new Error('The voice reminder in main.js changed: update ANCHOR_LINE and STRICT in the bench.');
  return ANCHORS[anchor](src);
}

// ── Characters and scenes ──────────────────────────────────────────────────

import { SCENARIOS } from './scenarios.mjs';
const NORA = SCENARIOS[0].leads[0];
const ILAN = SCENARIOS[0].leads[1];
const JOAN = {
  name: 'Joan Pike',
  tagline: 'a bus depot mechanic who has seen every way an engine can die',
  description: 'Joan Pike keeps the night fleet running at the Eastgate bus depot. Forty-eight, divorced, two grown sons, a dog called Biscuit.',
  personality: 'Practical, patient, a bit gruff with strangers, soft with her sons.',
  voice: 'Short sentences, Yorkshire turns of phrase.\nMight say: \'Pass us that spanner, love.\'\nNever says: \'awesome\'.',
  backstory: 'Started as an apprentice at sixteen, the only woman in the yard for ten years.',
  drives: 'Wants to retire to the coast with Biscuit. Fears the depot being sold off.',
  secrets: 'She failed her first engineering exam twice and never told anyone.',
  relationships: 'Danny and Lee: her sons.\nMick: the depot manager.',
  exampleDialogue: '[USER]: Busy?\n[AI]: Number twelve\'s leaking again. Hold this.\n[USER]: You alright?\n[AI]: Back\'s playing up. I\'ll live.\n[USER]: Nice weather.\n[AI]: Won\'t last. Never does on a Thursday.',
  reminder: 'Joan talks about the job and the people in front of her.',
};

const SCENES = [
  { id: 'smalltalk', who: NORA, lines: ['*It is 8 a.m. at the end of the night shift.* Morning. Rough night?', 'Did you see the match last night?', 'What are you having for breakfast?', 'Right, I will leave you to it.'] },
  { id: 'badnews', who: ILAN, lines: ['I have got something to tell you. The landlord is selling the building.', 'We have got until March.', 'What do you want to do?', 'Should I tell the others or will you?'] },
  { id: 'favour', who: NORA, lines: ['Can I borrow your car on Saturday?', 'It is for my mum\'s move, she is going into sheltered housing.', 'I will fill the tank, promise.', 'So is that a yes?'] },
  { id: 'lie', who: ILAN, lines: ['You said you were at your sister\'s on Friday. I saw your van outside the Crown.', 'Why lie about it?', 'I am not angry. I just want to know.', 'Okay. Are we good?'] },
  { id: 'argument', who: NORA, lines: ['You left the back door unlocked again last night.', 'Anyone could have walked in.', 'That is the third time this month.', 'So what are you going to do about it?'] },
  { id: 'praise', who: ILAN, lines: ['That lock you fixed for the school, the caretaker could not believe it.', 'Where did you learn that?', 'You should charge more.', 'Can I tell people it was you?'] },
  { id: 'practical', who: NORA, lines: ['Where do you keep the spare keys?', 'And the alarm code?', 'Is the back door still sticking?', 'What time do you open tomorrow?'] },
  { id: 'personal', who: ILAN, lines: ['Can I ask you something personal? Why did you never move back to Leeds?', 'Do you miss it?', 'Would you go back if you could?', 'Sorry. I did not mean to pry.'] },
];
const TRIGGER_SCENES = ['smalltalk', 'badnews', 'lie', 'personal'];

// ── Mock ────────────────────────────────────────────────────────────────────

const MOCK_LINES = ['Two of those, not three.', 'Trust is a door you leave unlocked.', 'Kettle is on. Sit.', 'Time heals nothing, it only files.', 'Back door sticks. Lift and push.'];
let mockN = 0;
function mockRespond(label, messages, { role }) {
  if (role === 'judge') {
    const n = (messages[1].content.match(/^\s*\d+\. /gm) || []).length;
    return JSON.stringify({ lines: Array.from({ length: n }, (_, i) => ({ n: i + 1, flags: i % 3 === 1 ? ['metaphor'] : [], good: i % 3 !== 1, habit: i % 2 === 0, answered: i % 2 === 0 ? true : null, why: '' })), scene: { recognisable: 4, balance: 3 } });
  }
  mockN++;
  return `*She wipes the counter.* "${MOCK_LINES[mockN % MOCK_LINES.length]}" *She looks up.* "${MOCK_LINES[(mockN + 2) % MOCK_LINES.length]}"`;
}

// ── The judge ──────────────────────────────────────────────────────────────

const SCENE_SCORES = []; // { cond, who, recognisable, balance }
const FLAGS = ['abstract', 'metaphor', 'trivial', 'oblique', 'forced_wit', 'unnatural', 'flat'];
const DIALOGUE_JUDGE = [
  'You are a dialogue editor. You check whether a character\'s spoken lines sound like a real person talking in that moment. For each numbered line, list ONLY the faults that clearly apply:',
  '- "abstract": talks about an abstract idea as if it were a thing or the topic (trust, silence, time, the past, truth, loyalty, peace), where a real person would talk about the concrete thing.',
  '- "metaphor": a metaphor, simile or aphorism a normal person in this situation would not use; sounds like a quote, a proverb or a mug slogan.',
  '- "trivial": fixes on a trivial detail in a way that dodges what was said, for no reason a real person would have.',
  '- "oblique": asks or answers in a roundabout, would-be clever way where a person would just ask or say the thing; a question that makes no sense as a question; does not answer a plain question.',
  '- "forced_wit": sarcasm or a quip that does not fit the moment, or would fit any scene.',
  '- "unnatural": no normal person would say it out loud: too polished, too wise, a little speech, therapy-speak, narrating their own feelings.',
  '- "flat": empty or generic; says nothing this person in particular would say.',
  'Set "good" to true when the line sounds like a real person in that moment. Wit, sarcasm, warmth and a turn of phrase are good when they fit the moment and the person; plain everyday lines are good too. A line with any fault is not good.',
  'Also say for each line whether it answers what was said to them ("answered"): true when what was said asked something and this line, read with the lines before it in the same reply, gives a plain answer; false when it was asked something and the line dodges it, answers with a question, or goes somewhere else; null when nothing was asked or the line is not meant as the answer. A question back after a plain answer still counts as answered.',
  'Also say for each line whether it shows one of the habits in the character\'s VOICE ("habit": true or false). A habit showing now and then is how people are; a habit in every line is not.',
  'Then judge the scene as a whole: "recognisable", 1 to 5, could these lines only be this person (5) or anyone at all (1); "balance", 1 to 5, does this person mostly talk plainly with their habits showing now and then (5), or does nearly every line perform a habit (1).',
  'Judge each line in its moment. Reply as JSON: {"lines": [{"n": 1, "flags": [], "good": true, "habit": false, "answered": true, "why": "a few words"}], "scene": {"recognisable": 4, "balance": 4}}, one entry per line, in order.',
].join('\n');

// ── Run ─────────────────────────────────────────────────────────────────────

const gw = createGateway(opts, { mockRespond });
const report = createReport(`Creations: dialogue bench${TRIGGERS ? ' (trigger words)' : ''}`, opts);
const psBefore = ollamaPs(opts);
await gw.load();
const shipped = await shippedRules();
const { variants, triggers } = await readVariants(shipped);

/** The conditions to run: variants (plus ablations), or the trigger study. */
const conditions = [];
if (TRIGGERS) {
  conditions.push({ id: 'plain', triggerWord: '' });
  for (const w of triggers) conditions.push({ id: `trigger:${w}`, triggerWord: w });
} else {
  for (const v of variants) conditions.push(v);
  if (ABLATE) shipped.forEach((r, i) => conditions.push({ id: `minus-rule-${i + 1}`, rules: shipped.filter((_, j) => j !== i).join('\n'), note: r }));
}
const wanted = opts.only.size ? conditions.filter((c) => opts.only.has(c.id)) : conditions;
if (!wanted.length) throw new Error('No condition to run: check --only against dialogue-variants.md.');

let d = null;
let dAnchor = null;
/** The chat for a condition: a fresh one whenever the reminder version changes. */
async function chatFor(cond) {
  const anchor = cond.anchor || 'shipped';
  if (d && dAnchor === anchor) return d;
  if (d) await d.cleanup();
  d = await startChatDriver(gw, opts, { tag: `dialogue-${anchor}`, userName: USER, mainSource: anchor === 'shipped' ? '' : await patchedMain(anchor) });
  dAnchor = anchor;
  return d;
}

/** Spoken lines of a reply: its quoted speech; a reply with no quotes is taken whole, less its *actions*. */
function spokenLines(reply) {
  const quoted = [...String(reply).matchAll(/["\u201c]([^"\u201d]{2,})["\u201d]/g)].map((m) => m[1].trim());
  if (quoted.length) return quoted;
  const bare = String(reply).replace(/\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
  return bare ? [bare] : [];
}
const SIMILE = /\b(like a|like an|as if|as though)\b/i;

const lines = []; // { id, cond, sample, scene, context, text, flags, good, why, mechAbstract, simile }
const played = []; // { key, scene, sceneLines }, judged after all the play
const emptyTurns = []; // turns where the model answered nothing the chat could keep

const ordered = [...wanted].sort((a, b) => (a.anchor || 'shipped').localeCompare(b.anchor || 'shipped'));
for (const cond of ordered) {
  await chatFor(cond);
  for (let s = 1; s <= opts.samples; s++) {
    await d.writeSettings({
      ...(cond.rules !== undefined ? { dialogueRules: cond.rules } : {}),
      ...(cond.style ? { customWritingStyle: cond.style } : {}),
    });
    const scenes = TRIGGERS ? SCENES.filter((x) => TRIGGER_SCENES.includes(x.id)).map((x) => ({ ...x, who: JOAN })) : SCENES;
    for (const scene of scenes) {
      const key = `${cond.id}#${s} ${scene.id}`;
      try {
        const sheet = { ...scene.who };
        if (cond.triggerWord) sheet.voice = `${sheet.voice}\nHer speech is ${cond.triggerWord}.`;
        if (cond.reminder) sheet.reminder = `${sheet.reminder} ${cond.reminder}`.trim();
        if (cond.noExamples) sheet.exampleDialogue = '';
        const file = await d.writeCard(sheet, {}, `${slug(scene.who.name)}.json`, Number.isFinite(cond.temperature) ? { temperature: cond.temperature } : {});
        const threadId = `dl-${slug(key)}`;
        d.setLabel(`${key} open`);
        const capturedFrom = d.captured.length;
        const container = await d.startThread({ id: threadId, title: key, files: [file], ...(cond.preset ? { writingPresetOverride: cond.preset } : {}) });
        for (let t = 0; t < scene.lines.length; t++) {
          d.setLabel(`${key} t${t + 1}`);
          if (!(await d.sendTurn(container, threadId, scene.lines[t]))) emptyTurns.push({ cond: cond.id, turn: `${key} t${t + 1}` });
        }
        container.remove();
        // Wiring, once per condition: the levers reach the request the chat sends.
        if (s === 1 && scene === scenes[0]) {
          const req = d.captured.slice(capturedFrom).find((r) => kindOf(r.messages) === 'turn');
          const sys = (req?.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
          report.section('Wiring');
          if (cond.rules !== undefined) {
            const first = cond.rules.split('\n').find((l) => l.trim()) || '';
            report.check(`${cond.id}.rules`, cond.rules.trim() ? 'its rules are in the prompt' : 'no rules are in the prompt', cond.rules.trim() ? sys.includes(first.trim()) && sys.includes(cond.rules.trim().split('\n').pop().trim()) : !sys.includes('## How People Talk'));
          }
          if (Number.isFinite(cond.temperature)) report.check(`${cond.id}.temperature`, `temperature ${cond.temperature} is sent`, req?.options?.temperature === cond.temperature, `sent ${req?.options?.temperature}`);
          if (cond.triggerWord) report.check(`${cond.id}.voice`, 'the trigger word is in the prompt', sys.includes(`Her speech is ${cond.triggerWord}.`));
          if (cond.anchor === 'soft') report.check(`${cond.id}.anchor`, 'the softened voice reminder is in the prompt', sys.includes('as a tendency and not a rule for every line') && !sys.includes('Stay strictly'));
          if (cond.anchor === 'identity') report.check(`${cond.id}.anchor`, 'the voice reminder carries no voice text', !sys.includes('Voice anchor') && !sys.includes('Stay strictly'));
          if (cond.noExamples) report.check(`${cond.id}.examples`, 'no example dialogue in the prompt', !sys.includes(scene.who.exampleDialogue.split('\n')[0]));
        }
        const msgs = await d.readMessages(threadId);
        const sceneLines = [];
        let context = '';
        let reply = 0;
        for (const m of msgs) {
          if (m.author !== 'ai') { context = m.content; continue; }
          reply++;
          for (const text of spokenLines(m.content)) sceneLines.push({ id: `${key} l${sceneLines.length + 1}`, cond: cond.id, sample: s, scene: scene.id, who: scene.who.name, reply, context, text, flags: null, good: null, mechAbstract: abstractSubjects(text).length > 0, simile: SIMILE.test(text) });
        }
        lines.push(...sceneLines);
        played.push({ key, scene, sceneLines });
      } catch (err) {
        if (err instanceof SkipCase) { report.skip(key, err.message); continue; }
        throw err;
      }
    }
  }
}


// The dialogue judge, after all the play: every line, with what was said to the character.
for (const { key, scene, sceneLines } of played) {
  try {
    const v = await judgeJson(gw, `${key} judge3`, DIALOGUE_JUDGE,
      `CHARACTER: ${scene.who.name}. ${scene.who.tagline}\nVOICE:\n${scene.who.voice}\n\n${sceneLines.map((l, i) => `${i + 1}. (${USER} had said: "${l.context.replace(/\*[^*]*\*/g, '').trim().slice(0, 160)}") ${scene.who.name.split(' ')[0]}: "${l.text}"`).join('\n')}`);
    const verdicts = Array.isArray(v?.lines) ? v.lines : [];
    sceneLines.forEach((l, i) => {
      const x = verdicts.find((y) => Number(y?.n) === i + 1) || verdicts[i];
      if (!x) return;
      l.flags = (Array.isArray(x.flags) ? x.flags : []).map((f) => String(f).toLowerCase()).filter((f) => FLAGS.includes(f));
      l.good = x.good === true;
      l.why = String(x.why || '');
      l.habit = x.habit === true;
      l.answered = x.answered === true ? true : x.answered === false ? false : null;
    });
    const sc = v?.scene || {};
    SCENE_SCORES.push({ cond: sceneLines[0]?.cond, who: scene.who.name, recognisable: Number(sc.recognisable) || NaN, balance: Number(sc.balance) || NaN });
  } catch (err) { if (err instanceof SkipCase) report.skip(`${key} judge`, err.message); else throw err; }
}

// ── Measures ────────────────────────────────────────────────────────────────

function measure(list) {
  const judged = list.filter((l) => Array.isArray(l.flags));
  const per100 = (n, d0) => (d0 ? (100 * n) / d0 : 0);
  const out = { lines: list.length, judged: judged.length };
  for (const f of FLAGS) out[f] = per100(judged.filter((l) => l.flags.includes(f)).length, judged.length);
  out.anyFault = per100(judged.filter((l) => l.flags.some((f) => f !== 'flat')).length, judged.length);
  out.good = per100(judged.filter((l) => l.good).length, judged.length);
  out.mechAbstract = per100(list.filter((l) => l.mechAbstract).length, list.length);
  out.simile = per100(list.filter((l) => l.simile).length, list.length);
  return out;
}

const avg = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const pct = (list, fn) => (list.length ? (100 * list.filter(fn).length) / list.length : 0);
const balanceRows = [];
for (const c of wanted) {
  for (const who of [...new Set(lines.filter((l) => l.cond === c.id).map((l) => l.who))]) {
    const ls = lines.filter((l) => l.cond === c.id && l.who === who);
    const judged = ls.filter((l) => Array.isArray(l.flags));
    const sc = SCENE_SCORES.filter((x) => x.cond === c.id && x.who === who);
    const replies = new Map();
    for (const l of judged) { const k = `${l.sample} ${l.scene} ${l.reply}`; const r = replies.get(k) || { asked: false, answered: false }; if (l.answered !== null && l.answered !== undefined) r.asked = true; if (l.answered === true) r.answered = true; replies.set(k, r); }
    const asked = [...replies.values()].filter((r) => r.asked);
    const answeredPct = asked.length ? (100 * asked.filter((r) => r.answered).length) / asked.length : NaN;
    balanceRows.push(`| ${c.id} | ${who} | ${ls.length} | ${Number.isFinite(answeredPct) ? answeredPct.toFixed(0) : '-'} | ${pct(judged, (l) => l.habit).toFixed(0)} | ${pct(ls, (l) => /\?\s*$/.test(l.text)).toFixed(0)} | ${pct(ls, (l) => l.text.split(/\s+/).length > 35).toFixed(0)} | ${avg(sc.map((x) => x.balance)).toFixed(1)} | ${avg(sc.map((x) => x.recognisable)).toFixed(1)} | ${pct(judged, (l) => l.flags.some((f) => f !== 'flat')).toFixed(0)} | ${pct(judged, (l) => l.good).toFixed(0)} |`);
  }
}
const balanceTable = [
  '### Balance by character',
  '',
  'Answered: share of replies that answer what they were asked (judge; a quip after the answer still counts). Habit: share of lines showing a voice habit (judge; some of the time is right, nearly all is not). Ends in ?: share of lines that are questions. Long: lines over 35 words. Balance and recognisable: the judge, per scene, 1 to 5. Fault and good: per 100 lines.',
  '',
  '| Condition | Character | Lines | Answered % | Habit % | Ends in ? % | Long % | Balance | Recognisable | Fault % | Good % |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...balanceRows,
].join('\n');

const baseId = TRIGGERS ? 'plain' : 'baseline';
const rows = wanted.map((c) => ({ id: c.id, note: c.note || c.triggerWord || '', m: measure(lines.filter((l) => l.cond === c.id)) }));
const base = rows.find((r) => r.id === baseId)?.m;
const cols = ['anyFault', 'abstract', 'metaphor', 'trivial', 'oblique', 'forced_wit', 'unnatural', 'flat', 'good', 'mechAbstract', 'simile'];
const fmt = (v, b) => `${v.toFixed(1)}${b !== undefined && Number.isFinite(b) ? ` (${v - b >= 0 ? '+' : ''}${(v - b).toFixed(1)})` : ''}`;
const ranked = TRIGGERS ? [...rows].sort((a, b) => b.m.anyFault - a.m.anyFault) : rows;
const table = [
  `Per 100 spoken lines. In brackets: the change from ${baseId}. Lower is better for every fault; higher is better for "good". "anyFault" counts lines with any fault except flat.${TRIGGERS ? ' Sorted worst first.' : ''}`,
  '',
  `| Condition | Lines | ${cols.join(' | ')} |`,
  `|---|---|${cols.map(() => '---').join('|')}|`,
  ...ranked.map((r) => `| ${r.id}${r.note && r.id.startsWith('minus') ? ` (without: ${r.note.slice(0, 60)}...)` : ''} | ${r.m.judged}/${r.m.lines} | ${cols.map((c) => fmt(r.m[c], r.id === baseId ? undefined : base?.[c])).join(' | ')} |`),
].join('\n');

report.section('Results');
for (const c of wanted) {
  const n = emptyTurns.filter((x) => x.cond === c.id).length;
  if (n) report.metric(`${c.id}.empty`, 'turns with no reply kept (the model answered nothing)', n);
}
if (emptyTurns.length) report.sample('Turns with no reply kept', emptyTurns.map((x) => x.turn).join('\n'));
for (const r of rows) {
  report.metric(`${r.id}.anyFault`, 'lines with a fault, per 100', r.m.anyFault);
  report.metric(`${r.id}.good`, 'lines that sound like a person, per 100', r.m.good);
}
report.section('Worst lines');
for (const c of wanted) {
  const bad = lines.filter((l) => l.cond === c.id && l.flags && l.flags.length).slice(0, 12);
  if (bad.length) report.sample(`${c.id}: flagged lines`, bad.map((l) => `[${l.flags.join(', ')}] "${l.text}"  (${l.why || ''})`).join('\n'));
}

// ── Calibration ────────────────────────────────────────────────────────────

const CODES = { N: 'natural', A: 'abstract', M: 'metaphor', T: 'trivial', Q: 'oblique', W: 'forced_wit', U: 'unnatural', F: 'flat' };
if (argv.includes('--calibration-sheet')) {
  const judged = lines.filter((l) => Array.isArray(l.flags));
  const step = Math.max(1, Math.floor(judged.length / 40));
  const pick = judged.filter((_, i) => i % step === 0).slice(0, 40);
  await fsp.writeFile(CAL_FILE, [
    '# Dialogue calibration',
    '',
    'Mark each line in the last column with the letters that apply, then run the bench with `--replay --calibrate`.',
    'N natural (sounds like a person), A abstract topic, M metaphor or aphorism, T fixes on trivia, Q roundabout or odd question, W forced wit, U unnatural, F flat.',
    'Several letters are fine (MU). N alone means nothing is wrong.',
    '',
    '| Id | What was said to them | Their line | Your mark |',
    '|---|---|---|---|',
    ...pick.map((l) => `| ${l.id} | ${l.context.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 120)} | ${l.text.replace(/\|/g, '/').replace(/\s+/g, ' ')} |  |`),
    '',
  ].join('\n'), 'utf8');
  console.log(`Calibration sheet: ${CAL_FILE}`);
}
if (argv.includes('--calibrate')) {
  const sheet = (await fsp.readFile(CAL_FILE, 'utf8')).split('\n').filter((l) => /^\| [^|]+ \|/.test(l) && !/^\| Id /.test(l) && !/^\|---/.test(l));
  const byId = new Map(lines.map((l) => [l.id, l]));
  const agree = {};
  let marked = 0;
  for (const row of sheet) {
    const cells = row.split('|').map((c) => c.trim());
    const id = cells[1];
    const mark = (cells[4] || '').toUpperCase().replace(/[^NAMTQWUF]/g, '');
    const l = byId.get(id);
    if (!mark || !l || !Array.isArray(l.flags)) continue;
    marked++;
    const mine = new Set([...mark].map((ch) => CODES[ch]).filter((x) => x !== 'natural'));
    for (const f of FLAGS) {
      agree[f] ??= { same: 0, n: 0 };
      agree[f].n++;
      if (mine.has(f) === l.flags.includes(f)) agree[f].same++;
    }
    agree.good ??= { same: 0, n: 0 };
    agree.good.n++;
    if ((mine.size === 0) === (l.good === true)) agree.good.same++;
  }
  report.section('Calibration');
  report.metric('calibration.marked', 'lines you marked', marked);
  for (const [f, a] of Object.entries(agree)) {
    report.metric(`calibration.${f}`, `judge agrees with you on "${f}"`, a.n ? a.same / a.n : 0, 'keep at 0.8 or more');
  }
}

// --dump <path>: every spoken line with its context and the judge's verdict, as JSON (for a second judge or a person).
if (argv.includes('--dump')) {
  const out = path.resolve(argv[argv.indexOf('--dump') + 1]);
  await fsp.writeFile(out, JSON.stringify(lines.map(({ id, cond, scene, who, reply, context, text, flags, good, habit, answered, why }) => ({ id, cond, scene, who, reply, context, text, flags, good, habit, answered, why })), null, 1), 'utf8');
  console.log(`Lines: ${out}`);
}

if (d) await d.cleanup();
const failures = await report.write(gw, `${table}\n\n${balanceTable}\n\n\`\`\`text\nollama ps before:\n${psBefore}\n\nollama ps after:\n${ollamaPs(opts)}\n\`\`\``);
process.exitCode = opts.mock && failures ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 200);
