// Creations AI: the director. In a roleplay the user steers each turn with a
// director's note ("/ai @Ada <what she does>"), and writing one every turn is
// work. On request, the director reads the scene and offers four short notes
// per character, each a different kind of move, so the user picks one instead
// of writing it. The pick becomes the usual "/ai @Name note" in the composer:
// nothing about how a turn is written changes, and the note is kept on the
// reply like any typed one.
//
// The Narrator gets four notes too, for the story rather than a character:
// a new scene, a time skip, an arrival, an event. Character notes play the
// scene that is running; the Narrator's move the story on from it. A pick
// becomes the chat's own "/nar note".
//
// Pure: the prompt and the reading of the reply. The chat makes the call.

// The kinds of option are the user's (Creations Settings, one list for the
// characters and one for the Narrator): one per line, "Label: what it
// means". The number of lines is the number of options per card. Shipped
// with these; Deepen was dropped from the characters' list (2026-10-08:
// the owner found it the one never worth picking).

/** The shipped kinds for each character, as the Settings text. */
export const DEFAULT_CHARACTER_DIRECTIONS = [
  'Push: they act on what they want, now, in this scene',
  'Complicate: a secret, a flaw, something from the past or a person from their life gets in the way',
  'Move: they change the scene: leave, arrive somewhere, bring someone in, turn the talk somewhere new, or let time pass',
].join('\n');

/** The shipped kinds for the Narrator, as the Settings text: moves for the story itself. */
export const DEFAULT_NARRATOR_DIRECTIONS = [
  'New Scene: this scene ends and the next one opens: a place, a moment and who is there, somewhere the story has reason to go',
  'Time Skip: time passes (an hour, a night, weeks) and one thing that changed meanwhile shows',
  'Arrival: someone comes in, calls or writes: a person from their world, or someone new with a reason to be there',
  'Event: something from outside the scene happens that the characters must answer: news, weather, an accident, a discovery',
].join('\n');

/** At most this many kinds per list: past it a card is a wall. */
export const MAX_DIRECTION_KINDS = 8;

/**
 * A kinds list from its Settings text: one per line, "Label: what it
 * means" (a bare label works too). Blank lines, # lines and repeats are
 * skipped; a label is at most four words. Empty text, no kinds.
 */
export function parseDirectionKinds(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([^:]{1,40}?)\s*:\s*(.*)$/);
    const label = (m ? m[1] : line).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    const rule = m ? m[2].trim().replace(/\.$/, '') : '';
    if (!label || label.split(' ').length > 4) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, rule });
    if (out.length >= MAX_DIRECTION_KINDS) break;
  }
  return out;
}

/** The shipped kinds, parsed. */
export const DIRECTION_KINDS = parseDirectionKinds(DEFAULT_CHARACTER_DIRECTIONS);
export const NARRATOR_KINDS = parseDirectionKinds(DEFAULT_NARRATOR_DIRECTIONS);

/** The Narrator's group name on the card and in the reply. */
export const NARRATOR = 'Narrator';

/** Characters given options at once. More makes the card a wall and the call slow. */
export const DIRECTOR_MAX_CAST = 4;

/** A kind label at the start of a line ("Push:", "New Scene -"), among `kinds`: [key, rest] or null. */
const labelledKind = (line, kinds) => {
  const low = line.toLowerCase();
  for (const k of [...kinds].sort((a, b) => b.label.length - a.label.length)) {
    const l = k.label.toLowerCase();
    if (!low.startsWith(l)) continue;
    const m = line.slice(l.length).match(/^\s*[:\-–—]\s*(.*)$/);
    if (m) return [k.key, m[1]];
  }
  return null;
};
const kindLines = (kinds) => kinds.map((k) => (k.rule ? `- ${k.label}: ${k.rule}.` : `- ${k.label}.`)).join('\n');
const formatLines = (kinds) => kinds.map((k) => `${k.label}: <one sentence>`).join('\n');

const clip = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim() + '...';
};

/**
 * Who gets options, in order. `cast` is `[{ file, name }]` in the chat's
 * order. When the scene says who is present, only they are offered, unless
 * that leaves nobody. The character who spoke last goes last: the next turn
 * is usually someone else's.
 */
export function directorCast(cast, { present = [], lastSpeaker = null, max = DIRECTOR_MAX_CAST } = {}) {
  const list = (Array.isArray(cast) ? cast : []).filter((c) => c && c.name);
  const here = new Set((Array.isArray(present) ? present : []).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
  const inScene = here.size ? list.filter((c) => here.has(c.name.toLowerCase())) : [];
  const pool = inScene.length ? inScene : list;
  const ordered = [...pool.filter((c) => c.file !== lastSpeaker), ...pool.filter((c) => c.file === lastSpeaker)];
  return ordered.slice(0, Math.max(1, max));
}

/**
 * The messages for the director call.
 *   cast: [{ name, tagline, drives, secrets, relationships }] — who gets options, in order
 *   others: [{ name, note }] — supporting cast and people in their lives
 *   scene: { location, time, mood } | null
 *   memory: { facts: [{ text }], beats: [{ text }], notes }
 *   transcript: [{ name, content }] — the recent turns, oldest first
 *   recentNotes: string[] — the director's notes the last turns were written with
 *   rules: string — the user's dialogue rules, if any
 */
export function buildDirectorPrompt({
  cast = [], others = [], scene = null, memory = {}, transcript = [], recentNotes = [], rules = '',
  narrator = true, characterKinds = DIRECTION_KINDS, narratorKinds = NARRATOR_KINDS,
} = {}) {
  const forCast = characterKinds.length > 0 && cast.length > 0;
  const forNarrator = narrator && narratorKinds.length > 0;
  const names = forCast ? cast.map((c) => c.name) : [];
  const count = (n) => (n === 1 ? 'one option, of this kind' : `exactly ${n} options, one of each kind`);
  const narratorRules = forNarrator ? [
    '',
    `${forCast ? 'Then, under' : 'Under'} "## ${NARRATOR}", write ${count(narratorKinds.length)}, for the story itself:`,
    kindLines(narratorKinds),
    'Each Narrator option: one sentence, at most 20 words, present tense, saying what happens, never what anyone says or feels: "Cut to the harbour at dawn, where the buyer is already waiting".',
    'They move the story on from this scene. Read where it stands: a scene that has run its course needs moving on; a scene going in circles needs something new to answer.',
    'When an option brings someone in, name someone from the Others list when one fits. Never contradict the memory, never end the story.',
  ] : [];
  const characterRules = forCast ? [
    `For each character named at the end, write ${count(characterKinds.length)}:`,
    kindLines(characterKinds),
    '',
    'Each option:',
    '- One sentence, at most 20 words, present tense, starting with a verb. The character is implied: "Asks him where the money went", not "Ada asks...".',
    '- Concrete: it names a person, an object, a place or an event from the scene, the memory or their sheet. Never only a feeling or a mood.',
    '- Something a player would be glad to see happen next, and different from what just happened.',
    '- Only what this character does. Never decide how anyone else answers.',
    '- Never contradicts the memory. Never ends the story or settles its central question.',
    "A character's options must each lead to a clearly different next turn.",
  ] : [];
  const system = [
    'You are the director of an ongoing roleplay. You do not write the story.',
    forCast
      ? 'You suggest what each character could do in their next turn, so the player can pick one.'
      : 'You suggest where the story could go next, so the player can pick one.',
    '',
    ...characterRules,
    'Do not repeat or rephrase the notes the last turns were written with.',
    ...narratorRules,
    '',
    'Answer in exactly this format, nothing before or after it, no em dashes:',
    '',
    ...(forNarrator ? [`## ${NARRATOR}`, formatLines(narratorKinds), ''] : []),
    ...(forCast ? [`## ${names[0]}`, formatLines(characterKinds)] : []),
  ].join('\n').replace(/\n+$/, '');

  const parts = [];
  const castLines = cast.map((c) => {
    const bits = [
      c.tagline && clip(c.tagline, 160),
      c.drives && `Wants: ${clip(c.drives, 260)}`,
      c.secrets && `Hides: ${clip(c.secrets, 200)}`,
      c.relationships && `People: ${clip(c.relationships, 260)}`,
    ].filter(Boolean);
    return `- ${c.name}${bits.length ? `: ${bits.join(' ')}` : ''}`;
  });
  if (castLines.length) parts.push(`Cast:\n${castLines.join('\n')}`);
  const otherLines = (Array.isArray(others) ? others : []).filter((o) => o && o.name).slice(0, 8).map((o) => `- ${o.name}${o.note ? `: ${clip(o.note, 160)}` : ''}`);
  if (otherLines.length) parts.push(`Others in their world, who can be mentioned or come in:\n${otherLines.join('\n')}`);
  const facts = (memory?.facts || []).map((f) => f && f.text).filter(Boolean).slice(-30);
  if (facts.length) parts.push(`Memory, what is true now:\n${facts.map((f) => `- ${clip(f, 200)}`).join('\n')}`);
  const beats = (memory?.beats || []).map((b) => b && b.text).filter(Boolean).slice(-12);
  if (beats.length) parts.push(`Story so far:\n${beats.map((b) => `- ${clip(b, 200)}`).join('\n')}`);
  if (memory?.notes && String(memory.notes).trim()) parts.push(`The player's notes:\n${clip(memory.notes, 600)}`);
  const sceneBits = scene && typeof scene === 'object' ? [scene.location, scene.time, scene.mood].filter(Boolean) : [];
  if (sceneBits.length) parts.push(`Now: ${sceneBits.join(', ')}`);
  if (rules && String(rules).trim()) parts.push(`How people talk in this story:\n${clip(rules, 600)}`);
  const turns = (Array.isArray(transcript) ? transcript : [])
    .filter((m) => m && m.content)
    .map((m) => {
      const c = String(m.content);
      return `${m.name || 'Someone'}: ${c.length > 1400 ? `${c.slice(0, 900)} [...] ${c.slice(-400)}` : c}`;
    })
    .join('\n\n')
    .slice(-9000);
  if (turns.trim()) parts.push(`Recent turns, oldest first:\n${turns}`);
  const notes = (Array.isArray(recentNotes) ? recentNotes : []).map((n) => String(n || '').trim()).filter(Boolean).slice(-5);
  if (notes.length) parts.push(`Notes the last turns were written with:\n${notes.map((n) => `- ${clip(n, 200)}`).join('\n')}`);
  parts.push(forNarrator && forCast
    ? `Write the options for the ${NARRATOR}, then for: ${names.join(', ')}.`
    : forNarrator ? `Write the options for the ${NARRATOR}.` : `Write the options for: ${names.join(', ')}.`);

  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/**
 * Read the director's reply, complete or still streaming, into
 * `[{ name, options: [{ kind, text }] }]` in the order of `names`. Tolerates
 * bold, bullets, numbering, "Name:" headings and a thinking block. A line
 * with no kind label takes the next kind not yet used. A character with
 * nothing yet is left out. Cut-off last lines are kept only once the reply
 * is `complete`.
 */
export function parseDirections(raw, names = [], { complete = true, characterKinds = DIRECTION_KINDS, narratorKinds = NARRATOR_KINDS } = {}) {
  const kindsFor = (name) => (name === NARRATOR ? narratorKinds : characterKinds);
  const allKinds = [...characterKinds, ...narratorKinds];
  let text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
  if (!complete) {
    const nl = text.lastIndexOf('\n');
    text = nl >= 0 ? text.slice(0, nl) : '';
  }
  const wanted = (Array.isArray(names) ? names : []).filter(Boolean);
  const byName = new Map(wanted.map((n) => [n.toLowerCase(), n]));
  // "## Ada" for "Ada Lovelace", when no one else in the list is also an Ada.
  const firsts = new Map();
  for (const n of wanted) {
    const f = n.split(/\s+/)[0].toLowerCase();
    firsts.set(f, firsts.has(f) ? null : n);
  }
  for (const [f, n] of firsts) if (n && !byName.has(f)) byName.set(f, n);
  const groups = new Map();
  let current = null;
  let skipping = false;

  const strip = (line) => line
    .replace(/\*\*|__/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/^\s*(?:[-*•>]|\d+[.)])\s+/, '')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .trim();
  // A heading for someone not asked for: "## Dana", "**Dana:**", "Dana:".
  const otherHeading = (line) => {
    if (/^\s*#/.test(line) || /^\s*\*\*[^*]+\*\*:?\s*$/.test(line)) return true;
    const t = strip(line);
    if (labelledKind(t, allKinds)) return false;
    return /:$/.test(t) && t.split(/\s+/).length <= 4;
  };
  const headingName = (line) => {
    const t = strip(line).replace(/[:.]$/, '').trim().toLowerCase();
    if (byName.has(t)) return byName.get(t);
    // "Options for Ada", "Ada (the doctor)"
    for (const [low, n] of byName) if (t === `options for ${low}` || t === `for ${low}` || t.startsWith(`${low} (`)) return n;
    return null;
  };

  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) continue;
    const name = headingName(rawLine);
    if (name) {
      current = name;
      if (!groups.has(name)) groups.set(name, []);
      continue;
    }
    if (otherHeading(rawLine)) { current = null; skipping = true; continue; }
    if (!current) {
      // A model that skips headings for a single character: the options are theirs.
      if (wanted.length === 1 && !skipping) { current = wanted[0]; if (!groups.has(current)) groups.set(current, []); } else continue;
    }
    let line = strip(rawLine);
    let kind = null;
    const kinds = kindsFor(current);
    const labelled = labelledKind(line, allKinds);
    if (labelled) {
      // A label from the other set (a character's "Push" under the Narrator) counts as no label.
      kind = kinds.some((k) => k.key === labelled[0]) ? labelled[0] : null;
      line = labelled[1];
    }
    line = line
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/^["“']+|["”']+$/g, '')
      .trim();
    if (!line || /^<.*>$/.test(line) || line.length < 4) continue;
    const opts = groups.get(current);
    if (opts.length >= kinds.length) continue;
    if (!kind || opts.some((o) => o.kind === kind)) {
      kind = kinds.map((k) => k.key).find((k) => !opts.some((o) => o.kind === k)) || null;
    }
    if (!kind) continue;
    opts.push({ kind, label: kinds.find((k) => k.key === kind)?.label || '', text: line });
  }

  const order = (name, opts) => kindsFor(name).map((k) => opts.find((o) => o.kind === k.key)).filter(Boolean);
  return wanted.filter((n) => groups.get(n)?.length).map((n) => ({ name: n, options: order(n, groups.get(n)) }));
}

/** The composer text a picked option becomes: the chat's own "/ai @Name note", or "/nar note". */
export function directionCommand(name, text) {
  const n = String(name || '').trim();
  if (n === NARRATOR) return `/nar ${String(text || '').trim()}`;
  const ref = /\s/.test(n) ? `@"${n}"` : `@${n}`;
  return `/ai ${ref} ${String(text || '').trim()}`;
}

/**
 * The composer after a pick. Empty, or holding only a command (a turn chip,
 * an earlier pick): the pick replaces it. Holding the player's own words:
 * they stay, and the pick goes on the last line, where the chat reads a
 * trailing "/ai" or "/nar" line as the note for the reply that follows.
 */
export function composeWithDirection(current, command) {
  const text = String(current || '').replace(/\s+$/, '');
  if (!text.trim()) return command;
  const lines = text.split('\n');
  if (lines.length === 1 && lines[0].trim().startsWith('/')) return command;
  if (/^\/(ai|nar) /.test(lines[lines.length - 1].trim())) lines.pop();
  return [...lines, command].join('\n');
}

/** Label for a kind key. */
export function directionKindLabel(key) {
  return [...DIRECTION_KINDS, ...NARRATOR_KINDS].find((k) => k.key === key)?.label || '';
}
