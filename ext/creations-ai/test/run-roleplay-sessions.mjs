// run-roleplay-sessions.mjs — Part 2 of docs/CREATIONS_QUALITY_TESTING.md,
// with the two Part 3 checks that need the real chat. Plays long sessions
// through the real extension (headless, live-harness.mjs): a user emulator
// plays Sam from a brief, the four standard scenarios plant lines and probes
// at fixed turns, and every model call (turns, turn order, memory, director,
// emulator) goes through the cached gateway, so --replay rescores a run
// without a model and --pass judge scores it after the play is done.
//
//   node ext/creations-ai/test/run-roleplay-sessions.mjs --mock --turns 12
//   node ext/creations-ai/test/run-roleplay-sessions.mjs --pass play
//   node ext/creations-ai/test/run-roleplay-sessions.mjs --pass judge
//   --turns <n>        turns per session (30)
//   --only room,cast,facts,married,directions   which sessions
//   --emulator <tag>   the model that plays Sam (the player model by default:
//                      no model swap during play)
//
// The fixed 9-turn script stays in run-quality-suite.mjs as the regression
// check beside this.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startChatDriver, kindOf, slug } from './chat-driver.mjs';
import { buildDirectorPrompt, parseDirections, directionCommand, composeWithDirection } from '../director.js';
import { SCENARIOS, PEOPLE_CARDS, USER } from './scenarios.mjs';
import {
  parseArgs, createGateway, createReport, judgeJson, ollamaPs, SkipCase,
  motifEchoes, noveltyByThirds, abstractSubjects, mightSay, words, median,
} from './harness-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const opts = parseArgs(process.argv, { name: 'roleplay-sessions', report: path.join(__dirname, 'last-roleplay-sessions.md') });
const argv = process.argv.slice(2);
const TURNS = Math.max(6, Number(argv.includes('--turns') ? argv[argv.indexOf('--turns') + 1] : 30) || 30);
const EMULATOR = argv.includes('--emulator') ? argv[argv.indexOf('--emulator') + 1] : opts.model;
const ONLY = opts.only.size ? opts.only : new Set(['room', 'cast', 'facts', 'married', 'directions']);
const STOCK_TELLS = ['shiver down', "couldn't help but", 'a testament to', 'dust motes', 'barely above a whisper', 'a mixture of', 'mischievous glint', 'sent a chill', 'unreadable expression', 'in that moment', 'the air was thick', 'heart pounding'];

// ── Mock replies ────────────────────────────────────────────────────────────

let mockN = 0;
function mockRespond(label, messages, { role }) {
  mockN++;
  if (role === 'judge') {
    if (/judge recall/.test(label)) return JSON.stringify({ consistent: true, quote: '' });
    if (/judge memory/.test(label)) return JSON.stringify({ invented: [], wrong: [] });
    if (/judge session/.test(label)) return JSON.stringify({ storyline_consistency: { score: 90, flaws: [] }, human_likeness: { score: 85, flaws: [] }, character_fidelity: { score: 88, flaws: [] }, storyline_quality: { score: 80, flaws: [] } });
    if (/judge pick/.test(label)) return JSON.stringify({ did_it: true, in_voice: true });
    if (/judge compare/.test(label)) return JSON.stringify({ better: 'A', why: 'more happens' });
    return '{}';
  }
  if (/ user$/.test(label)) return `*I lean on the counter.* What about the van keys, ${mockN}?`;
  const kind = kindOf(messages);
  if (kind === 'memory') return JSON.stringify({ facts: [{ text: 'They parked on level two.', category: 'place', confidence: 0.9 }], beats: [{ text: 'Sam made a delivery.' }] });
  if (kind === 'order') return 'Nora Vasquez';
  if (kind === 'director') {
    const names = (/Write the options for: (.+)\./.exec(messages[1].content) || [])[1]?.split(', ') || ['Nora Vasquez'];
    return names.map((n) => `## ${n}\nDeepen: Counts the rolls again.\nPush: Asks Sam for a lift.\nComplicate: Finds the forged slip.\nMove: Walks to Kemal's.`).join('\n\n');
  }
  const topics = ['the till roll', 'a cracked thermos', 'the night bus', 'Kemal\'s chips', 'the area manager', 'a parking ticket', 'the brass key'];
  return `"Two of those, not three," I say, and tap the counter. ${topics[mockN % topics.length]} comes up again. *I glance at the rain.*`;
}

// ── Run ─────────────────────────────────────────────────────────────────────

const gw = createGateway(opts, { mockRespond });
const report = createReport('Creations: roleplay sessions', opts);
const psBefore = ollamaPs(opts);
await gw.load();

const d = await startChatDriver(gw, opts, { tag: 'roleplay', userName: USER.name });
const { captured } = d;
for (const card of PEOPLE_CARDS) await d.writeCard(card);

/** The emulator's next line as Sam, from the brief, the situation and the recent turns. */
async function emulatorLine(scn, history, t) {
  const recent = history.slice(-12).map((m) => `${m.name}: ${m.content}`).join('\n\n');
  const messages = [
    { role: 'system', content: [
      `You play ${USER.name} in a roleplay with other characters. You are the player, not the narrator.`,
      `${USER.name}: ${USER.brief}`,
      `The situation: ${scn.situation}`,
      `Write ONLY ${USER.name}'s next message: one to three sentences, first person, actions in *asterisks*, dialogue plain. Never write what anyone else says or does. React to what was just said, and now and then bring in something new: an object, a person ${USER.name} knows, a place, a plan. No em dashes.`,
    ].join('\n') },
    { role: 'user', content: `${recent || '(the scene is just starting)'}\n\nWrite ${USER.name}'s next message.` },
  ];
  const raw = await gw.call(`${d.label} user`, messages, { temperature: 0.9, maxTokens: 200, model: EMULATOR });
  return String(raw).replace(new RegExp(`^\\s*${USER.name}\\s*:\\s*`, 'i'), '').trim() || '*I nod.*';
}


const sessions = []; // { id, variant, sample, scn, replies, msgs, picks, probes }

async function playSession(scn, sample, variant = 'plain') {
  const id = `${scn.id}${variant === 'directions' ? '+dir' : ''}#${sample}`;
  const leadFiles = [];
  for (const lead of scn.leads) {
    const people = scn.people?.[lead.name] || [];
    const connections = [];
    for (const p of people) connections.push({ fileName: `${slug(p.card.name)}.json`, name: p.card.name, how: p.how });
    leadFiles.push(await d.writeCard(lead, connections.length ? { connections } : {}));
  }
  const threadIdNow = `rp-${slug(id)}`;
  const capturedFrom = captured.length;
  const container = await d.startThread({
    id: threadIdNow, title: `${scn.title} (${id})`, files: leadFiles,
    supportingCast: (scn.supporting || []).map((p, i) => ({ id: `sc${i}`, name: p.name, note: p.note })),
  });
  const plants = new Map((scn.plants || []).map((p) => [p.turn, p]));
  const probes = new Map((scn.probes || []).map((p) => [p.turn, p]));
  const picks = [];
  const probeReplies = [];
  let rng = 7 + sample * 31;
  const rand = (n) => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };

  for (let t = 1; t <= TURNS; t++) {
    d.setLabel(`${id} t${t}`);
    const history = (await d.readMessages(threadIdNow)).map((m) => ({ name: m.name, content: m.content }));
    let line = t === 1 ? scn.opening : plants.get(t)?.line || probes.get(t)?.line || await emulatorLine(scn, history, t);
    // With Directions: every other turn, ask the director and take a random option.
    if (variant === 'directions' && t % 2 === 0 && !plants.has(t) && !probes.has(t)) {
      const cast = scn.leads.map((c) => ({ name: c.name, tagline: c.tagline, drives: c.drives, secrets: c.secrets, relationships: c.relationships }));
      const raw = await gw.call(`${d.label} director`, buildDirectorPrompt({ cast, others: scn.supporting || [], transcript: history.slice(-12) }), { temperature: 0.9, maxTokens: 1200 });
      const groups = parseDirections(raw, cast.map((c) => c.name)).filter((g) => g.options.length);
      if (groups.length) {
        const g = groups[rand(groups.length)];
        const o = g.options[rand(g.options.length)];
        picks.push({ turn: t, name: g.name, kind: o.kind, text: o.text });
        line = composeWithDirection(line, directionCommand(g.name, o.text));
      }
    }
    await d.sendTurn(container, threadIdNow, line);
    const msgs = await d.readMessages(threadIdNow);
    const last = [...msgs].reverse().find((m) => m.author === 'ai');
    if (probes.has(t)) probeReplies.push({ ...probes.get(t), reply: last?.content || '' });
    const pick = picks.find((p) => p.turn === t);
    if (pick) pick.reply = last?.content || '', pick.speaker = last?.name || '';
    if (t % 5 === 0) console.log(`  ${id}: turn ${t}/${TURNS}`);
  }
  container.remove();
  const msgs = await d.readMessages(threadIdNow);
  const memory = await d.readMemory(threadIdNow);
  const turnPrompts = captured.slice(capturedFrom).filter((r) => kindOf(r.messages) === 'turn').map((r) => r.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'));
  sessions.push({ id, variant, sample, scn, msgs, turnPrompts, replies: msgs.filter((m) => m.author === 'ai'), picks, probeReplies, memory, memoryCalls: gw.calls.filter((c) => c.label.startsWith(`${id} `) && / memory/.test(c.label)).length });
}

async function guarded(id, fn) {
  try { return await fn(); } catch (err) {
    if (err instanceof SkipCase) { report.skip(id, err.message); return undefined; }
    report.check(id, 'ran without error', false, err?.stack?.split('\n').slice(0, 2).join(' ') || String(err));
    return undefined;
  }
}

// Play.
for (const scn of SCENARIOS) {
  for (let s = 1; s <= opts.samples; s++) {
    if (ONLY.has(scn.id)) await guarded(`${scn.id}#${s}`, () => playSession(scn, s));
    if (scn.id === 'room' && ONLY.has('directions')) await guarded(`room+dir#${s}`, () => playSession(scn, s, 'directions'));
  }
}

// ── Measures ────────────────────────────────────────────────────────────────

const allNames = (scn) => [...scn.leads.map((l) => l.name), USER.name, ...(scn.supporting || []).map((p) => p.name)];
const firstName = (n) => n.split(' ')[0];
const SPEECH = '(?:says|said|asks|asked|replies|replied|whispers|whispered|mutters|muttered|answers|answered|adds|added|snaps|snapped)';

function leaksIn(reply, speaker, scn) {
  const others = [...scn.leads.map((l) => l.name).filter((n) => n !== speaker), USER.name];
  const hits = [];
  for (const n of others) {
    const f = firstName(n);
    const pats = [
      new RegExp(`(^|\\n)\\s*(?:<<)?(?:${n}|${f})(?:>>)?\\s*:`, 'i'),
      new RegExp(`"[^"]{2,}"[,.!?]?\\s+(?:${f})\\s+${SPEECH}`, 'i'),
      new RegExp(`\\b(?:${f})\\s+${SPEECH}[,:]?\\s*"`, 'i'),
    ];
    if (pats.some((p) => p.test(reply))) hits.push(n);
  }
  return hits;
}
const quotes = (t) => (String(t).match(/"[^"]+"/g) || []).join(' ');

for (const ss of sessions) {
  const { scn } = ss;
  report.section(`Session ${ss.id}: ${scn.title}`);
  const replies = ss.replies.map((m) => m.content);
  if (!replies.length) { report.skip(ss.id, 'no replies'); continue; }

  // Wiring: who the scenario puts in the scene reaches the turn prompt.
  const firstPrompt = ss.turnPrompts[0] || '';
  for (const p of scn.supporting || []) report.check(`${ss.id}.wire.${p.name}`, `supporting cast ${p.name} is in the turn prompt`, firstPrompt.includes(p.name));
  for (const list of Object.values(scn.people || {})) for (const p of list) report.check(`${ss.id}.wire.${firstName(p.card.name)}`, `${p.card.name} is in the turn prompt as someone in their lives`, firstPrompt.includes(p.card.name));

  const echoes = motifEchoes(replies, { names: allNames(scn), bigramsOnly: true });
  report.metric(`${ss.id}.motif`, 'motif echoes (a phrase in 3 of any 5 replies in a row)', echoes.length, 'record only');
  if (echoes.length) report.sample(`${ss.id} motif echoes`, echoes.slice(0, 30).map((e) => `${e.phrase}: replies ${e.turns.join(', ')}`).join('\n'));
  const nov = noveltyByThirds(replies, `${scn.situation} ${scn.leads.map((l) => Object.values(l).join(' ')).join(' ')}`);
  report.metric(`${ss.id}.novelty`, 'turns bringing in something new, by thirds', nov.thirds.map((x) => x.toFixed(2)).join(' / '), 'record only');

  const leaks = ss.replies.map((m, i) => ({ i: i + 1, who: leaksIn(m.content, m.name, scn) })).filter((x) => x.who.length);
  report.check(`${ss.id}.leaks`, 'no speaker leaks (writing another lead\'s or Sam\'s words)', leaks.length === 0, leaks.map((x) => `reply ${x.i}: ${x.who.join(', ')}`).join('; '));
  const named = replies.flatMap((r) => abstractSubjects(quotes(r)));
  report.metric(`${ss.id}.values`, 'lines naming a value as subject', named.length);
  for (const lead of scn.leads) {
    const phrase = mightSay(lead.voice);
    if (!phrase) continue;
    const p = words(phrase).join(' ');
    const uses = ss.replies.filter((m) => m.name === lead.name && words(m.content).join(' ').includes(p)).length;
    report.check(`${ss.id}.voice.${firstName(lead.name)}`, `${firstName(lead.name)}'s "Might say" phrase used at most once`, uses <= 1, `${uses} uses`);
  }
  const dashes = replies.reduce((n, r) => n + (r.match(/[\u2013\u2014]/g) || []).length, 0);
  report.metric(`${ss.id}.dashes`, 'em and en dashes in replies', dashes);
  const lens = replies.map((r) => r.length);
  const half = Math.ceil(lens.length / 2);
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  report.metric(`${ss.id}.drift`, 'length drift (second half over first)', avg(lens.slice(half)) / (avg(lens.slice(0, half)) || 1));
  const tells = STOCK_TELLS.map((t) => [t, replies.reduce((n, r) => n + (r.toLowerCase().split(t).length - 1), 0)]).filter(([, n]) => n);
  report.metric(`${ss.id}.tells`, 'stock phrases', tells.map(([t, n]) => `${t} x${n}`).join(', ') || 'none');
  report.check(`${ss.id}.memory.cadence`, 'the memory was updated after every sixth story reply', ss.memoryCalls >= Math.floor(replies.length / 6), `${ss.memoryCalls} updates for ${replies.length} replies`);
  report.sample(`${ss.id} transcript`, ss.msgs.map((m) => `${m.name}: ${m.content}`).join('\n\n').slice(0, 12000));

  const transcript = ss.msgs.map((m, i) => `[${i + 1}] ${m.name}: ${m.content}`).join('\n\n');
  for (const [i, p] of ss.probeReplies.entries()) {
    await guarded(`${ss.id}.recall.${i + 1}`, async () => {
      const v = await judgeJson(gw, `${ss.id} judge recall ${i + 1}`,
        'You check one reply in a roleplay against a fact established earlier in the story. "consistent" is true when the reply agrees with the fact or does not touch it in a way that contradicts it; false when it gets it wrong (another place, another day, another object, the old state of things). Quote the words that decide it. Reply as JSON: {"consistent": true, "quote": "..."}.',
        `FACT: ${p.fact}\n\nTHE PLAYER SAID: ${p.line}\n\nTHE REPLY: ${p.reply}`);
      report.check(`${ss.id}.recall.${i + 1}`, `recall at turn ${p.turn}: ${p.fact} (judge)`, v?.consistent === true, v?.quote || '');
    });
  }
  if (ss.memory.facts.length) {
    await guarded(`${ss.id}.memoryfile`, async () => {
      const v = await judgeJson(gw, `${ss.id} judge memory`,
        'You check a memory file kept for a roleplay against its transcript. List every memory entry that is INVENTED (nothing in the transcript supports it) and every entry that is WRONG (the transcript says otherwise). Missing things do not count. Reply as JSON: {"invented": ["entry"], "wrong": ["entry"]}.',
        `MEMORY:\n${ss.memory.facts.map((f) => `- ${f.text}`).join('\n')}\n\nTRANSCRIPT:\n${transcript.slice(-24000)}`);
      const bad = [...(v?.invented || []), ...(v?.wrong || [])];
      report.check(`${ss.id}.memoryfile`, 'the memory file has nothing invented or wrong (judge)', bad.length === 0, bad.join(' | ').slice(0, 300));
    });
  }
  await guarded(`${ss.id}.session`, async () => {
    const v = await judgeJson(gw, `${ss.id} judge session`,
      `You review a roleplay transcript. ${USER.name} is the player; the other named characters are written by an AI. Score the AI's writing on four dimensions. Each starts at 100 and loses 5 to 20 points per flaw you find, by its weight. Every flaw must quote the words that show it, with the reply number. Dimensions: storyline_consistency (contradictions with earlier turns or the setting), human_likeness (robotic, repetitive or over-written prose, stock phrases), character_fidelity (characters acting or talking against their cards), storyline_quality (does the story go anywhere, do things happen, do new people, places or objects come in). Reply as JSON: {"storyline_consistency": {"score": 0, "flaws": [{"reply": 0, "quote": "...", "why": "..."}]}, "human_likeness": {...}, "character_fidelity": {...}, "storyline_quality": {...}}.`,
      `CARDS:\n${scn.leads.map((l) => `${l.name}: ${l.personality} ${l.voice}`).join('\n')}\n\nTRANSCRIPT:\n${transcript.slice(-24000)}`);
    for (const dim of ['storyline_consistency', 'human_likeness', 'character_fidelity', 'storyline_quality']) {
      const d = v?.[dim];
      report.metric(`${ss.id}.${dim}`, `${dim.replace(/_/g, ' ')} (judge, 100 minus flaws)`, Number(d?.score ?? NaN));
      const flaws = Array.isArray(d?.flaws) ? d.flaws : [];
      if (flaws.length) report.sample(`${ss.id} ${dim} flaws`, flaws.map((f) => `[${f.reply}] "${f.quote}": ${f.why}`).join('\n'));
    }
  });
  for (const [i, p] of ss.picks.entries()) {
    if (i >= 6) break;
    await guarded(`${ss.id}.pick.${p.turn}`, async () => {
      const lead = scn.leads.find((l) => l.name === p.name);
      const v = await judgeJson(gw, `${ss.id} judge pick ${p.turn}`,
        'A player picked a director\'s note for a character\'s next turn. Say whether the turn did what the note said ("did_it") and whether the character stayed in their voice ("in_voice"). Reply as JSON: {"did_it": true, "in_voice": true, "why": "..."}.',
        `NOTE FOR ${p.name}: ${p.text}\n\nVOICE: ${lead?.voice || ''}\n\nTHE TURN (by ${p.speaker}): ${p.reply}`);
      report.check(`${ss.id}.pick.${p.turn}`, `the picked ${p.kind} note was carried out in voice (judge)`, v?.did_it === true && v?.in_voice === true && p.speaker === p.name, `${p.speaker === p.name ? '' : `spoken by ${p.speaker}; `}${v?.why || ''}`);
    });
  }
}

// With and without Directions, blind, both orders (EQ-Bench style).
report.section('Directions: does it make the story better?');
for (let s = 1; s <= opts.samples; s++) {
  const a = sessions.find((x) => x.id === `room#${s}`);
  const b = sessions.find((x) => x.id === `room+dir#${s}`);
  if (!a || !b) continue;
  const text = (ss) => ss.msgs.map((m) => `${m.name}: ${m.content}`).join('\n\n').slice(-16000);
  const ask = (first, second, tag) => judgeJson(gw, `room#${s} judge compare ${tag}`,
    'You compare two roleplay stories that start from the same scene. Which is the better story to have played: more happens, the characters stay themselves, it does not repeat itself, you would want to keep going? Reply as JSON: {"better": "A" or "B", "why": "..."}.',
    `STORY A:\n${text(first)}\n\nSTORY B:\n${text(second)}`);
  await guarded(`compare#${s}`, async () => {
    const v1 = await ask(b, a, 'dir-first');
    const v2 = await ask(a, b, 'plain-first');
    const dirWins = (v1?.better === 'A' ? 1 : 0) + (v2?.better === 'B' ? 1 : 0);
    report.metric(`compare#${s}`, 'times the Directions story won (of 2 orders)', dirWins);
    report.sample(`compare#${s}`, `Directions first: ${v1?.better} (${v1?.why || ''})\nPlain first: ${v2?.better} (${v2?.why || ''})`);
  });
}

await d.cleanup();
const failures = await report.write(gw, `Turns per session: ${TURNS}. Emulator: ${EMULATOR}.\n\n\`\`\`text\nollama ps before:\n${psBefore}\n\nollama ps after:\n${ollamaPs(opts)}\n\`\`\``);
process.exitCode = opts.mock && failures ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 200);
