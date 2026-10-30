// drive.js — Creations AI: hear a new character in three scenes before
// accepting them.
//
// Try A Line answers one line. A card's faults show across several: the
// phrase that comes back in every reply, the trait announced instead of
// shown, the secret said out loud, the reply that ends on a line for a mug.
// Test Drive writes three opening lines from the character's own sheet (one
// about the work or the thing they want, one that presses on what they fear
// or hide, one of idle talk), hears the reply to each through the same call
// Try A Line uses, and reads the three replies together for those faults.
// The checks are the quality harness's, mechanical, no judge model: a
// finding is something to look at, never a verdict.
//
// The reading is pure (tests/unit/creationsTestDrive.test.ts); the section
// in the Studio is drawn with the kit alone.

import { buildTryLineMessages, parseJsonLoose, stripDashes } from './studio-core.js';
import { createModelRoute } from './model-route.js';

const STOP = new Set(('a an the and or but if then so of to in on at by for with from into onto over under about as is are was were be been being it its this that these those he she they them his her their him i me my you your we our us not no nor do does did have has had will would can could should may might must just only very more most less than too also there here what which who whom whose when where why how all any each every some such own same other another one two up down out off again once while because until before after above below between through during without within against toward towards upon among around like').split(/\s+/));

/** Abstract nouns a person does not make the subject of a sentence (the harness's list). */
export const ABSTRACT = new Set(['peace', 'solitude', 'freedom', 'honor', 'honour', 'loyalty', 'truth', 'justice', 'love', 'duty', 'courage', 'dignity', 'purpose', 'meaning', 'control', 'order', 'chaos', 'trust', 'faith', 'hope', 'grief', 'pride', 'shame', 'beauty', 'silence', 'independence', 'integrity', 'balance', 'harmony', 'redemption', 'legacy']);

export const SITUATION_KINDS = [
  { kind: 'work', label: 'The work', brief: 'about the work or the thing they want, from the drives and the description' },
  { kind: 'pressure', label: 'Under pressure', brief: 'that presses on what they fear or hide, without naming it: a question or a remark that comes close' },
  { kind: 'idle', label: 'Idle talk', brief: 'idle, about nothing much: the weather, a meal, something in the room' },
];

/** Three lines to try when the model gives none. */
const FALLBACK_LINES = {
  work: 'How is the work going?',
  pressure: 'You went quiet just now. What was that about?',
  idle: 'Long day. Did you eat anything?',
};

const words = (text) => String(text || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
const sentences = (text) => String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/** The call that writes the three opening lines, each from this sheet. */
export function buildSituationsMessages(sheet) {
  const name = (sheet.name || 'the character').trim();
  const system = [
    `You write three short opening lines a person might say to ${name}, in a roleplay, each starting a different scene. Each line is one or two sentences, in the second person, addressed to ${name}, concrete, from THIS character's own sheet, never from a template.`,
    'The three scenes, in this order:',
    ...SITUATION_KINDS.map((s, i) => `${i + 1}. "${s.kind}": a line ${s.brief}.`),
    'Never use em dashes or en dashes.',
    'Answer with JSON only: {"situations": [{"kind": "work", "line": "..."}, {"kind": "pressure", "line": "..."}, {"kind": "idle", "line": "..."}]}',
  ].join('\n');
  const sheetText = ['description', 'personality', 'drives', 'secrets', 'relationships']
    .map((k) => (sheet[k] ? `${k[0].toUpperCase()}${k.slice(1)}:\n${sheet[k]}` : ''))
    .filter(Boolean).join('\n\n');
  return [{ role: 'system', content: system }, { role: 'user', content: `${name}'s sheet:\n\n${sheetText}` }];
}

/** The three situations from the reply; a missing or unreadable one gets its fallback line. */
export function parseSituations(raw) {
  const data = parseJsonLoose(raw);
  const list = data && Array.isArray(data.situations) ? data.situations : [];
  return SITUATION_KINDS.map((s) => {
    const hit = list.find((x) => x && String(x.kind || '').toLowerCase() === s.kind && String(x.line || '').trim());
    return { kind: s.kind, label: s.label, line: hit ? stripDashes(String(hit.line)).trim() : FALLBACK_LINES[s.kind] };
  });
}

/** The reply call for one situation: Try A Line's own. */
export function buildDriveMessages(sheet, situation) {
  return buildTryLineMessages(sheet, situation.line);
}

/** Phrases of two or three content words, and single long words, in a reply. */
function phraseSet(text) {
  const toks = words(text);
  const out = new Set();
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i]; const b = toks[i + 1];
    if (STOP.has(a) || STOP.has(b) || a.length < 3 || b.length < 3) continue;
    out.add(`${a} ${b}`);
    const c = toks[i + 2];
    if (c && !STOP.has(c) && c.length >= 3) out.add(`${a} ${b} ${c}`);
  }
  return out;
}

/** Sentences whose subject is an abstract noun ("Loyalty is everything."). */
export function abstractSubjects(text) {
  const hits = [];
  for (const s of sentences(text)) {
    const m = /^\W*(?:my |the |true |real )?(\p{L}+)\s+(is|was|means|matters|has|keeps|makes|isn't|was not|is not)\b/iu.exec(s);
    if (m && ABSTRACT.has(m[1].toLowerCase())) hits.push(s);
  }
  return hits;
}

/** A reply that ends on a clipped line for a mug: a last sentence of at most four words, after others. */
function mugEnding(text) {
  const ss = sentences(text);
  if (ss.length < 2) return '';
  const last = ss[ss.length - 1];
  if (last.endsWith('?')) return '';
  const n = words(last).length;
  return n >= 1 && n <= 4 ? last : '';
}

/** Content words of what the character hides, for a blurt check. */
function secretWords(secrets) {
  return [...new Set(words(secrets).filter((w) => w.length > 4 && !STOP.has(w)))];
}

/**
 * The reading of three replies: [{ kind, label, detail, scenes }], the
 * scenes as 0-based indexes. Empty when nothing was found.
 */
export function readTestDrive(sheet, situations, replies) {
  const findings = [];
  const texts = replies.map((r) => String(r || ''));
  const name = (sheet && sheet.name) || '';

  // Repeats: a phrase in two or more of the three replies.
  const sets = texts.map(phraseSet);
  const nameWords = new Set(words(name));
  const seen = new Map();
  sets.forEach((set, i) => { for (const p of set) { if (p.split(' ').some((w) => nameWords.has(w))) continue; const arr = seen.get(p) || []; arr.push(i); seen.set(p, arr); } });
  const repeats = [...seen.entries()].filter(([, idx]) => idx.length >= 2);
  // A longer phrase covers the shorter ones inside it.
  const kept = repeats.filter(([p]) => !repeats.some(([q]) => q !== p && q.includes(p)));
  for (const [phrase, idx] of kept.slice(0, 4)) {
    findings.push({ kind: 'repeat', label: 'Said again', detail: `"${phrase}" comes back in ${idx.length} of the 3 replies.`, scenes: idx });
  }

  // Same opening in two replies.
  const openings = texts.map((t) => words(t).slice(0, 3).join(' '));
  openings.forEach((o, i) => {
    const j = openings.findIndex((p, k) => k > i && p && p === o);
    if (o && j >= 0 && !findings.some((f) => f.kind === 'opening')) findings.push({ kind: 'opening', label: 'Same opening', detail: `Two replies open the same way ("${o}...").`, scenes: [i, j] });
  });

  // A value named instead of shown.
  texts.forEach((t, i) => {
    for (const s of abstractSubjects(t).slice(0, 1)) findings.push({ kind: 'abstract', label: 'Names a value', detail: `"${s}"`, scenes: [i] });
  });

  // What they hide, said out loud.
  const sw = secretWords(sheet && sheet.secrets);
  if (sw.length >= 2) {
    texts.forEach((t, i) => {
      const w = new Set(words(t));
      const said = sw.filter((x) => w.has(x));
      if (said.length >= Math.max(2, Math.ceil(sw.length * 0.4))) findings.push({ kind: 'secret', label: 'Says what they hide', detail: `The reply carries ${said.length} words of the secret (${said.slice(0, 4).join(', ')}).`, scenes: [i] });
    });
  }

  // The mug line.
  texts.forEach((t, i) => {
    const m = mugEnding(t);
    if (m) findings.push({ kind: 'mug', label: 'Ends on a slogan', detail: `"${m}"`, scenes: [i] });
  });

  // Dashes, which the dialogue rules forbid.
  texts.forEach((t, i) => { if (/[–—]/.test(t)) findings.push({ kind: 'dash', label: 'Dashes', detail: 'The reply uses em or en dashes.', scenes: [i] }); });

  return findings;
}

/** One line for the section's header: how the drive went. */
export function summarizeFindings(findings) {
  if (!findings.length) return 'Nothing repeated, nothing announced. Three scenes, three plain replies.';
  const n = findings.length;
  return `${n} thing${n === 1 ? '' : 's'} to look at.`;
}

/**
 * The drive as Markdown for the kit's renderer: each scene with its line,
 * the reply, and the findings that touch it.
 */
export function renderTestDriveMarkdown(situations, replies, findings) {
  const out = [];
  situations.forEach((s, i) => {
    out.push(`**${s.label}**`, '', `> ${s.line}`, '');
    out.push(replies[i] ? String(replies[i]).trim() : '*No reply came back.*', '');
    const here = findings.filter((f) => f.scenes.includes(i));
    if (here.length) out.push(...here.map((f) => `- ${f.label}: ${f.detail}`), '');
  });
  return out.join('\n').trim();
}

/**
 * The Studio section. `host` is the section body; `deps`: { ui, lm,
 * sheet() → the sheet as it stands, resolveModel() → { modelId, numCtx },
 * setMeta(text), isBusy(), setBusy(flag) }. Drawn with the kit alone.
 */
export function mountTestDrive(host, deps) {
  let results = null;
  const paint = () => {
    host.replaceChildren();
    deps.ui.createButton(host, { id: 'textGenerator.studio.testDrive.run', command: TEST_DRIVE_COMMAND, label: results ? 'Drive Again' : 'Drive', icon: 'play', size: 'sm', title: 'Three scenes from their sheet: the work, pressure on what they hide, idle talk' });
    if (results) host.appendChild(deps.ui.renderMarkdown(results));
  };
  async function run() {
    if (deps.isBusy()) return;
    const sheet = deps.sheet();
    if (!sheet.description && !sheet.personality && !sheet.voice) { deps.setMeta('Give them a sheet first.'); return; }
    deps.setBusy(true);
    deps.setMeta('Writing three scenes…');
    try {
      const { modelId, numCtx } = await deps.resolveModel();
      const route = createModelRoute(deps.lm);
      const situations = parseSituations(await route.ask(modelId, buildSituationsMessages(sheet), { temperature: 0.9, think: false, format: 'json', numCtx }));
      const replies = [];
      for (let i = 0; i < situations.length; i++) {
        deps.setMeta(`Hearing them in scene ${i + 1} of ${situations.length}…`);
        replies.push(stripDashes(await route.ask(modelId, buildDriveMessages(sheet, situations[i]), { temperature: 0.85, think: true, numCtx })));
      }
      const findings = readTestDrive(sheet, situations, replies);
      results = renderTestDriveMarkdown(situations, replies, findings);
      deps.setMeta(summarizeFindings(findings));
    } catch (err) {
      deps.setMeta(`Could not drive: ${err && err.message ? err.message : String(err)}`);
    } finally {
      deps.setBusy(false);
      paint();
    }
  }
  paint();
  live = { run };
  return live;
}

/** The command the Drive button runs; the chat registers it to `runLiveTestDrive`. */
export const TEST_DRIVE_COMMAND = 'textGenerator.studio.testDrive';
let live = null;
/** Runs the drive of the Studio last opened (one Studio is open at a time). */
export function runLiveTestDrive() { return live ? live.run() : undefined; }
