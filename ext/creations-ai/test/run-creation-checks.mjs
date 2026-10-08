// run-creation-checks.mjs — Part 1 of docs/CREATIONS_QUALITY_TESTING.md:
// character creation, measured. Sends the prompts the Studio sends (built by
// studio-core.js) and scores pitches, the sheet's structure and its
// completion, connected people, the dice, example dialogue, the voice, and
// whether the sheet survives into chat (an InCharacter-style interview).
//
//   node ext/creations-ai/test/run-creation-checks.mjs --mock
//   node ext/creations-ai/test/run-creation-checks.mjs --pass play     (player only)
//   node ext/creations-ai/test/run-creation-checks.mjs --pass judge    (judge only, over the cached play)
//   options: see harness-common.mjs (--model, --judge, --samples, --num-ctx, --cache, --report, --replay)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as studio from '../studio-core.js';
import {
  parseArgs, createGateway, createReport, judgeJson, ollamaPs, SkipCase,
  contentWords, pairwiseOverlap, pairwiseCosine, abstractSubjects, mightSay, words, median,
} from './harness-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const opts = parseArgs(process.argv, { name: 'creation-checks', report: path.join(__dirname, 'last-creation-checks.md') });
const {
  buildPitchMessages, parsePitches, pitchAsConcept, buildSheetMessages, buildFieldMessages, buildTryLineMessages,
  parseJsonLoose, cleanSheet, cleanFieldValue, parseSheetStructure, DEFAULT_SHEET_STRUCTURE, sectionsPresent,
  completionDirection, characterFromSheet, withRelationshipLine, backLinkLine, parseRelationshipLines,
} = studio;

const STRUCTURE = parseSheetStructure(DEFAULT_SHEET_STRUCTURE);
const APPEARANCE = STRUCTURE.appearance;

// ── Cases ───────────────────────────────────────────────────────────────────
// Two plain, two from sources with a Twist, one connected to an existing
// character (the first plain one, as the harness writes it), one from the dice.

const DICE = {
  want: 'to be asked to cater her estranged sister\'s wedding',
  fear: 'that her hands will start shaking during the night shift',
  secret: 'she sold the family recipe book to a supermarket chain',
};
const diceSpec = [
  `- What they openly WANT: ${DICE.want}`,
  `- What they privately FEAR: ${DICE.fear}`,
  `- A SECRET they keep: ${DICE.secret}`,
].join('\n');

const CASES = [
  { id: 'P1', kind: 'plain', concept: 'a retired forensic accountant who hears music in ledgers', pitch: true },
  { id: 'P2', kind: 'plain', concept: 'a ferry mechanic on a northern lake who keeps every lost glove she finds', pitch: true },
  {
    id: 'W1', kind: 'twist', concept: '', twist: 'she was born in 1991 and runs a small software consultancy in Leeds',
    canon: ['Ada Lovelace was a mathematician and writer', 'She wrote the first published algorithm intended for a machine, for Babbage\'s Analytical Engine', 'She was the daughter of the poet Lord Byron', 'She saw that the machine could act on symbols other than numbers, such as music', 'Her mother had her schooled in mathematics to steer her away from her father\'s temperament'],
  },
  {
    id: 'W2', kind: 'twist', concept: '', twist: 'he lives now, in 2026, and repairs e-bikes in a garage in Belgrade',
    canon: ['Nikola Tesla was an inventor and electrical engineer', 'He developed the alternating current induction motor', 'He worked briefly for Thomas Edison and they fell out', 'He was known for a photographic memory and odd habits, including a fixation on the number three', 'He died poor and alone in a New York hotel room'],
  },
  { id: 'C1', kind: 'connected', concept: 'the younger brother of the retired accountant, a session drummer who never paid him back', connectTo: 'P1', how: 'her younger brother; he still owes her money from 1998', pitch: false },
  { id: 'D1', kind: 'dice', concept: 'a night-shift baker in a seaside town', spec: diceSpec, pitch: true },
];

const TRY_LINES = [
  'Long day?',
  'What are you working on right now?',
  'Someone told me you used to be famous.',
  'Can I ask you something personal?',
  'What would you do with a free afternoon?',
];

const INTERVIEW = [
  'What do you do when someone lies to you?',
  'A stranger asks you for help carrying something heavy. What happens?',
  'How do you spend the first hour after you wake up?',
  'Someone praises your work in front of everyone. How do you react?',
  'What would make you break a promise?',
  'You get bad news by phone. What do you do in the next ten minutes?',
  'Who do you call when something good happens?',
  'Someone you dislike needs a favour only you can do. Do you do it?',
  'What do you argue about most often?',
  'If you could change one decision from your past, which would it be?',
];

// ── Mock replies (wiring only) ─────────────────────────────────────────────

let mockFirstSheet = true;
function mockRespond(label, messages, { role }) {
  if (role === 'judge') {
    if (/interview predict/.test(label)) return JSON.stringify({ predictions: INTERVIEW.map((q, i) => `direction ${i}`) });
    if (/interview score/.test(label)) return JSON.stringify({ scores: INTERVIEW.map(() => 4), notes: [] });
    if (/contradiction/.test(label)) return JSON.stringify({ contradictions: [] });
    if (/dialogue/.test(label)) return JSON.stringify({ situations: [{ traces_to: 'drive' }, { traces_to: 'secret' }, { traces_to: 'relationship' }] });
    return '{}';
  }
  if (/ pitch$/.test(label)) {
    return JSON.stringify({ pitches: ['Hanne Rask', 'Olu Bakare', 'Mirela Popa', 'Tom Ashby'].map((n, i) => ({ name: n, tagline: `a person of ledgers ${i}`, hook: ['Audits a failing brewery while composing waltzes from invoices', 'Volunteers counting church collections, hums hymns backwards', 'Travels with circus payroll, whistling marches between towns', 'Fixes garage tax returns for neighbours, plays piano badly'][i], contradiction: `wants quiet ${i} but takes every job`, line: `Line number ${i}.` })) });
  }
  if (/ sheet$/.test(label)) {
    const user = messages[1].content;
    const name = (/NAME: ([^.]+)\./.exec(user) || [])[1] || (/Write This One: ([^\n]+)/.exec(user) || [])[1] || 'Hanne Rask';
    const hook = (/^Hook: (.+)$/m.exec(user) || [])[1] || '';
    const pitched = (/^Name: (.+)$/m.exec(user) || [])[1];
    const who = /### /.test(user) ? 'Dev Rask' : pitched || name;
    const first = mockFirstSheet;
    mockFirstSheet = !mockFirstSheet;
    const conn = /### (.+)/.exec(user);
    return JSON.stringify({
      name: who, tagline: 'a careful keeper of books', description: `${who}. ${hook}`,
      appearance: first ? 'Overview: Tall and plain.\n\nHeight and build: Six foot.\n\nFace: Grey eyes.' : 'Overview: Tall and plain.\n\nHeight and build: Six foot.\n\nFace: Grey eyes.\n\nClothes: Cardigans.\n\nPhysicality: Taps a pencil.',
      personality: 'Patient, dry, keeps score.', voice: 'Speaks slowly.\nMight say: \'The column never lies, people do.\'\nNever says: \'whatever\'.',
      backstory: 'Grew up above a bakery.', drives: /SECRET they keep/.test(user) ? `Wants ${DICE.want}. Fears ${DICE.fear}.` : 'Wants a quiet year.',
      secrets: /SECRET they keep/.test(user) ? `${DICE.secret}.` : who === 'Dev Rask' ? 'Owes a loan shark in Hull.' : `${who} once forged a signature on a mortgage deed.`,
      relationships: conn ? `${conn[1].trim()}: her brother.` : 'Mira: a neighbour.',
      exampleDialogue: '[USER]: Busy?\n[AI]: The till is short by four pounds.\n[USER]: And?\n[AI]: I count it again.\n[USER]: Nice day.\n[AI]: The gulls think so.',
      reminder: 'Counts everything.',
    });
  }
  if (/ complete appearance$/.test(label)) return JSON.stringify({ appearance: 'Overview: Tall and plain.\n\nHeight and build: Six foot.\n\nFace: Grey eyes.\n\nClothes: Cardigans.\n\nPhysicality: Taps a pencil.' });
  if (/ tryline /.test(label)) return 'Four pounds short. I count it again.';
  if (/ interview /.test(label)) return 'I ask them to say it again, slower.';
  return '{}';
}

// ── Run ─────────────────────────────────────────────────────────────────────

const gw = createGateway(opts, { mockRespond });
const report = createReport('Creations: character creation checks', opts);
const psBefore = ollamaPs(opts);
await gw.load();

const json = (raw) => parseJsonLoose(raw) || {};
const sheetText = (s) => Object.values(s).join('\n');
const paragraphs = (t) => String(t || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const aiLines = (dialogue) => String(dialogue || '').split('\n').filter((l) => /^\s*\[AI\]\s*:/i.test(l)).map((l) => l.replace(/^\s*\[AI\]\s*:\s*/i, ''));

/** Distinctive words of a field: content words over five letters, minus those also in `common`. */
function distinctive(text, common = '') {
  const c = new Set(contentWords(common));
  return [...new Set(contentWords(text).filter((w) => w.length > 5 && !c.has(w)))];
}

const sheets = {};          // `${case}#${s}` -> sheet
const rates = { first: 0, afterOne: 0, missing: 0, n: 0 };
const pitchOverlap = [];
const pitchCos = [];

async function guarded(id, fn) {
  try { return await fn(); } catch (err) {
    if (err instanceof SkipCase) { report.skip(id, err.message); return undefined; }
    report.check(id, 'ran without error', false, err?.message || String(err));
    return undefined;
  }
}

for (const c of CASES) {
  for (let s = 0; s < opts.samples; s++) {
    const key = `${c.id}#${s + 1}`;
    report.section(`${c.id} (${c.kind})`);
    const base = { concept: c.concept, canon: c.canon || [], twist: c.twist || '', spec: c.spec || '', structure: STRUCTURE, name: '' };

    // Connected: the card it links to is the first sample of that case.
    if (c.connectTo) {
      const other = sheets[`${c.connectTo}#1`];
      if (!other) { report.skip(`${key}.conn`, `${c.connectTo}#1 has no sheet`); continue; }
      base.connections = [{ name: other.name, how: c.how, data: characterFromSheet(other) }];
    }

    // Pitch Ideas, then Write This One with the first pitch.
    let pitch = null;
    if (c.pitch) {
      await guarded(`${key}.pitch`, async () => {
        const raw = await gw.call(`${key} pitch`, buildPitchMessages({ concept: c.concept, spec: base.spec }), { json: true, temperature: 1.0 });
        const pitches = parsePitches(json(raw));
        const full = pitches.filter((p) => p.name && p.tagline && p.hook && p.contradiction && p.line);
        report.check(`${key}.pitch.1`, 'four pitches, each with name, tagline, hook, contradiction and line', pitches.length === 4 && full.length === 4, `${pitches.length} pitches, ${full.length} complete`);
        const names = pitches.map((p) => p.name.toLowerCase());
        report.check(`${key}.pitch.2`, 'no two pitches share a name', new Set(names).size === names.length, names.join(', '));
        const ov = pairwiseOverlap(pitches.map((p) => p.hook));
        pitchOverlap.push(ov.mean);
        report.check(`${key}.pitch.3`, 'hooks differ (max pairwise word overlap under 0.35)', ov.max < 0.35, `mean ${ov.mean.toFixed(2)}, max ${ov.max.toFixed(2)}`);
        const vecs = await gw.embed(pitches.map((p) => `${p.tagline}. ${p.hook} ${p.contradiction}`));
        if (vecs) { const cs = pairwiseCosine(vecs); pitchCos.push(cs.mean); report.metric(`${key}.pitch.cos`, 'pitch similarity (embedding cosine, mean)', cs.mean); }
        if (s === 0) report.sample(`${key} pitches`, pitches.map((p) => `${p.name}: ${p.tagline}\n  ${p.hook}\n  ${p.contradiction}\n  "${p.line}"`).join('\n\n'));
        pitch = pitches[0] || null;
      });
    }

    // The sheet.
    let sheet = null;
    await guarded(`${key}.sheet`, async () => {
      const ctx = { ...base, concept: pitch ? pitchAsConcept(c.concept, pitch) : c.concept };
      const raw = await gw.call(`${key} sheet`, buildSheetMessages(ctx), { json: true, temperature: 0.8 });
      sheet = cleanSheet(json(raw));
      report.check(`${key}.sheet.0`, 'the sheet parses with a name and an overview', !!(sheet.name && sheet.description), sheet.name || '(no name)');
      if (pitch) {
        const nouns = distinctive(pitch.hook).slice(0, 6);
        const text = sheetText(sheet).toLowerCase();
        const carried = nouns.filter((w) => text.includes(w));
        report.check(`${key}.pitch.4`, 'Write This One carries the pitch: its name, and most of its hook\'s key words', sheet.name.trim().toLowerCase() === pitch.name.trim().toLowerCase() && carried.length >= Math.ceil(nouns.length / 2), `name "${sheet.name}" vs "${pitch.name}"; ${carried.length}/${nouns.length} hook words`);
      }

      // Structure: five labelled Appearance sections, in order; one completion.
      rates.n++;
      let { missing } = sectionsPresent(sheet.appearance, APPEARANCE);
      if (!missing.length) rates.first++;
      else {
        const before = sheet.appearance;
        const craw = await gw.call(`${key} complete appearance`, buildFieldMessages(ctx, sheet, 'appearance', completionDirection(APPEARANCE, missing)), { json: true, temperature: 0.8 });
        const next = cleanFieldValue('appearance', json(craw).appearance || '');
        // The app takes the rewrite only when it adds sections.
        if (next && sectionsPresent(next, APPEARANCE).present.length > sectionsPresent(before, APPEARANCE).present.length) {
          const kept = paragraphs(before).filter((p) => next.includes(p));
          report.check(`${key}.struct.keep`, 'the completion keeps the existing sections word for word', kept.length === paragraphs(before).length, `${kept.length}/${paragraphs(before).length} paragraphs kept`);
          sheet.appearance = next;
        }
        missing = sectionsPresent(sheet.appearance, APPEARANCE).missing;
        if (!missing.length) rates.afterOne++; else rates.missing++;
      }
      const order = paragraphs(sheet.appearance).map((p) => APPEARANCE.sections.findIndex((x) => p.toLowerCase().startsWith(x.name.toLowerCase())));
      report.check(`${key}.struct.order`, 'Appearance sections in order: Overview, Height and build, Face, Clothes, Physicality', !missing.length && order.every((v, i) => i === 0 || v > order[i - 1]), missing.length ? `missing ${missing.join(', ')}` : order.join(','));
      sheets[key] = sheet;
      if (s === 0) report.sample(`${key} sheet`, Object.entries(sheet).map(([k, v]) => `## ${k}\n${v}`).join('\n\n'));
    });
    if (!sheet) continue;

    // Connected people.
    if (c.connectTo) {
      const other = sheets[`${c.connectTo}#1`];
      const rel = parseRelationshipLines(sheet.relationships || '');
      report.check(`${key}.conn.1`, 'the connected name is spelled exactly as on their card', sheetText(sheet).includes(other.name.trim()), other.name);
      report.check(`${key}.conn.2`, 'Relationships names the connected person', rel.some((p) => p.name.trim() === other.name.trim()), rel.map((p) => p.name).join(', '));
      const secretWords = distinctive(other.secrets, [other.description, other.appearance, other.backstory, other.relationships, other.tagline, c.concept, c.how].join(' '));
      const leaked = secretWords.filter((w) => words(sheetText(sheet)).includes(w));
      report.check(`${key}.conn.3`, 'none of the connected card\'s Secrets appears', leaked.length === 0, leaked.length ? `leaked: ${leaked.join(', ')}` : `${secretWords.length} secret words checked`);
      const once = withRelationshipLine(other, backLinkLine(sheet.name, 'her brother'));
      const twice = withRelationshipLine(once, backLinkLine(sheet.name, 'her brother'));
      const added = parseRelationshipLines(twice.relationships).filter((p) => p.name.trim().toLowerCase() === sheet.name.trim().toLowerCase()).length;
      report.check(`${key}.conn.4`, 'the link adds exactly one line to the other card, never twice', added === 1, `${added} line(s)`);
      await guarded(`${key}.conn.5`, async () => {
        const v = await judgeJson(gw, `${key} judge contradiction`,
          'You compare two character cards from the same fictional world. List every statement in the NEW card that contradicts the ESTABLISHED card (names, facts, dates, family, places, how they stand with each other). Quote the NEW card. Differences in opinion or things the established card does not mention are not contradictions. Reply as JSON: {"contradictions": [{"quote": "...", "why": "..."}]}.',
          `ESTABLISHED CARD (${other.name}):\n${sheetText(other)}\n\nNEW CARD (${sheet.name}):\n${sheetText(sheet)}`);
        const list = Array.isArray(v?.contradictions) ? v.contradictions : [];
        report.check(`${key}.conn.5`, 'nothing contradicts the connected card (judge)', list.length === 0, list.map((x) => x.quote).join(' | ').slice(0, 300));
      });
    }

    // Dice and example dialogue.
    if (c.kind === 'dice') {
      const ds = `${sheet.drives}\n${sheet.secrets}`.toLowerCase();
      for (const k of ['want', 'fear', 'secret']) {
        const w = distinctive(DICE[k]);
        const hit = w.filter((x) => ds.includes(x));
        report.check(`${key}.dice.${k}`, `the rolled ${k} appears in Drives and Secrets`, hit.length >= Math.ceil(w.length / 2), `${hit.length}/${w.length}: ${w.join(', ')}`);
      }
    }
    {
      const pairs = (String(sheet.exampleDialogue).match(/\[USER\]\s*:/gi) || []).length;
      report.check(`${key}.dlg.1`, 'example dialogue has three exchanges', pairs === 3, `${pairs} [USER] lines`);
      const named = aiLines(sheet.exampleDialogue).flatMap(abstractSubjects);
      report.check(`${key}.dlg.2`, 'the character never names their own values', named.length === 0, named.join(' | '));
      if (c.kind === 'dice' || s === 0) {
        await guarded(`${key}.dlg.3`, async () => {
          const v = await judgeJson(gw, `${key} judge dialogue`,
            'You read a character sheet and its example dialogue. For each of the three exchanges, say what in the sheet it comes from: "drive" (a want or goal in Drives or the work in the Overview), "secret" (something in Secrets, or a fear), "relationship" (a person in Relationships), or "none" (it could belong to anyone). Reply as JSON: {"situations": [{"traces_to": "...", "evidence": "..."}]}.',
            `SHEET:\n${['description', 'drives', 'secrets', 'relationships'].map((k) => `${k}: ${sheet[k]}`).join('\n')}\n\nEXAMPLE DIALOGUE:\n${sheet.exampleDialogue}`);
          const sit = Array.isArray(v?.situations) ? v.situations : [];
          const traced = sit.filter((x) => x && x.traces_to && x.traces_to !== 'none').length;
          report.check(`${key}.dlg.3`, 'each exchange traces to a drive, the secret or a relationship (judge)', sit.length === 3 && traced === 3, sit.map((x) => x?.traces_to).join(', '));
        });
      }
    }

    // Voice: one "Might say", and Try A Line does not parrot it.
    const phrase = mightSay(sheet.voice);
    report.check(`${key}.voice.1`, 'Voice has one "Might say" example', !!phrase && (String(sheet.voice).match(/might say/gi) || []).length === 1, phrase || '(none)');
    await guarded(`${key}.voice.2`, async () => {
      const lines = [];
      for (let i = 0; i < TRY_LINES.length; i++) lines.push(await gw.call(`${key} tryline ${i + 1}`, buildTryLineMessages(sheet, TRY_LINES[i]), { temperature: 0.8 }));
      if (phrase) {
        const norm = (t) => words(t).join(' ');
        const p = norm(phrase);
        const uses = lines.filter((l) => norm(l).includes(p)).length;
        const opens = lines.filter((l) => norm(l).startsWith(p.split(' ').slice(0, 4).join(' '))).length;
        report.check(`${key}.voice.2`, 'in five Try A Line samples the phrase appears at most once and never opens a line', uses <= 1 && opens === 0, `${uses} uses, ${opens} openings`);
      }
      if (s === 0) report.sample(`${key} Try A Line`, TRY_LINES.map((q, i) => `> ${q}\n${lines[i]}`).join('\n\n'));
    });

    // Does the sheet survive into chat? One interview per case, on the first sample.
    if (s === 0) {
      await guarded(`${key}.interview`, async () => {
        const answers = [];
        for (let i = 0; i < INTERVIEW.length; i++) answers.push(await gw.call(`${key} interview ${i + 1}`, buildTryLineMessages(sheet, INTERVIEW[i]), { temperature: 0.8 }));
        const persona = `PERSONALITY: ${sheet.personality}\nDRIVES: ${sheet.drives}`;
        const pred = await judgeJson(gw, `${key} judge interview predict`,
          'You read two fields of a character sheet and predict, for each interview question, how this particular person would answer: the direction of the answer in one short sentence (what they would do or feel), specific to them, not what anyone would say. Reply as JSON: {"predictions": ["...", ...]} with one entry per question, in order.',
          `${persona}\n\nQUESTIONS:\n${INTERVIEW.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
        const predictions = Array.isArray(pred?.predictions) ? pred.predictions : [];
        const score = await judgeJson(gw, `${key} judge interview score`,
          'For each question you get a prediction of how a particular character would answer, made from their sheet, and the answer the character actually gave. Score each 1 to 5: 5 = the answer goes the predicted way and could only be this person; 3 = compatible but generic, anyone could have said it; 1 = goes against the prediction. Reply as JSON: {"scores": [n, ...], "notes": ["one short reason per score"]}.',
          INTERVIEW.map((q, i) => `${i + 1}. ${q}\nPREDICTED: ${predictions[i] ?? '(none)'}\nANSWER: ${answers[i]}`).join('\n\n'));
        const scores = (Array.isArray(score?.scores) ? score.scores : []).map(Number).filter((n) => n >= 1 && n <= 5);
        const generic = scores.filter((n) => n <= 3).length;
        report.metric(`${key}.interview`, 'interview agreement (median of 10, 1 to 5)', median(scores));
        report.check(`${key}.interview`, 'the sheet survives into chat: median agreement 4 or more, at most three generic answers (judge)', scores.length === INTERVIEW.length && median(scores) >= 4 && generic <= 3, `scores ${scores.join(',')}`);
      });
    }
  }
}

report.section('Totals');
if (rates.n) {
  report.metric('struct.first', 'Appearance complete on the first try', rates.first / rates.n);
  report.metric('struct.after', 'complete after the one automatic completion', (rates.first + rates.afterOne) / rates.n);
  report.metric('struct.missing', 'still showing "Missing:"', rates.missing / rates.n, 'under 0.05');
}
if (pitchOverlap.length) report.metric('pitch.overlap', 'pitch hook word overlap (mean over asks)', pitchOverlap.reduce((a, b) => a + b, 0) / pitchOverlap.length);
if (pitchCos.length) report.metric('pitch.cosine', 'pitch similarity by embedding (mean over asks)', pitchCos.reduce((a, b) => a + b, 0) / pitchCos.length);

const failures = await report.write(gw, `\`\`\`text\nollama ps before:\n${psBefore}\n\nollama ps after:\n${ollamaPs(opts)}\n\`\`\``);
process.exitCode = opts.mock && failures ? 1 : 0;
