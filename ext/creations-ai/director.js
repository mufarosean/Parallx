// Creations AI: the director. In a roleplay the user steers each turn with a
// director's note ("/ai @Ada <what she does>"), and writing one every turn is
// work. On request, the director reads the scene and offers four short notes
// per character, each a different kind of move, so the user picks one instead
// of writing it. The pick becomes the usual "/ai @Name note" in the composer:
// nothing about how a turn is written changes, and the note is kept on the
// reply like any typed one.
//
// Pure: the prompt and the reading of the reply. The chat makes the call.

/** The four kinds of move, in the order they are asked for and shown. */
export const DIRECTION_KINDS = [
  { key: 'deepen', label: 'Deepen', rule: 'a feeling comes through in something they do or say; never name the feeling' },
  { key: 'push', label: 'Push', rule: 'they act on what they want, now, in this scene' },
  { key: 'complicate', label: 'Complicate', rule: 'a secret, a flaw, something from the past or a person from their life gets in the way' },
  { key: 'move', label: 'Move', rule: 'they change the scene: leave, arrive somewhere, bring someone in, turn the talk somewhere new, or let time pass' },
];

/** Characters given options at once. More makes the card a wall and the call slow. */
export const DIRECTOR_MAX_CAST = 4;

const KIND_BY_WORD = new Map(DIRECTION_KINDS.flatMap((k) => [[k.key, k.key], [k.label.toLowerCase(), k.key]]));

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
export function buildDirectorPrompt({ cast = [], others = [], scene = null, memory = {}, transcript = [], recentNotes = [], rules = '' } = {}) {
  const names = cast.map((c) => c.name);
  const kinds = DIRECTION_KINDS.map((k) => `- ${k.label}: ${k.rule}.`).join('\n');
  const example = DIRECTION_KINDS.map((k) => `${k.label}: <one sentence>`).join('\n');
  const system = [
    'You are the director of an ongoing roleplay. You do not write the story.',
    'You suggest what each character could do in their next turn, so the player can pick one.',
    '',
    'For each character named at the end, write exactly four options, one of each kind:',
    kinds,
    '',
    'Each option:',
    '- One sentence, at most 20 words, present tense, starting with a verb. The character is implied: "Asks him where the money went", not "Ada asks...".',
    '- Concrete: it names a person, an object, a place or an event from the scene, the memory or their sheet. Never only a feeling or a mood.',
    '- Something a player would be glad to see happen next, and different from what just happened.',
    '- Only what this character does. Never decide how anyone else answers.',
    '- Never contradicts the memory. Never ends the story or settles its central question.',
    'The four options for one character must lead to four clearly different next turns.',
    'Do not repeat or rephrase the notes the last turns were written with.',
    '',
    'Answer in exactly this format, nothing before or after it, no em dashes:',
    '',
    `## ${names[0] || 'Name'}`,
    example,
  ].join('\n');

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
  parts.push(`Write the options for: ${names.join(', ')}.`);

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
export function parseDirections(raw, names = [], { complete = true } = {}) {
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
    const first = t.match(/^([A-Za-z]+)\s*[:\-\u2013\u2014]/);
    if (first && KIND_BY_WORD.has(first[1].toLowerCase())) return false;
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
    const labelled = line.match(/^([A-Za-z]+)\s*[:\-–—]\s*(.+)$/);
    if (labelled && KIND_BY_WORD.has(labelled[1].toLowerCase())) {
      kind = KIND_BY_WORD.get(labelled[1].toLowerCase());
      line = labelled[2];
    }
    line = line
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/^["“']+|["”']+$/g, '')
      .trim();
    if (!line || /^<.*>$/.test(line) || line.length < 4) continue;
    const opts = groups.get(current);
    if (opts.length >= DIRECTION_KINDS.length) continue;
    if (!kind || opts.some((o) => o.kind === kind)) {
      kind = DIRECTION_KINDS.map((k) => k.key).find((k) => !opts.some((o) => o.kind === k)) || null;
    }
    if (!kind) continue;
    opts.push({ kind, text: line });
  }

  const order = (opts) => DIRECTION_KINDS.map((k) => opts.find((o) => o.kind === k.key)).filter(Boolean);
  return wanted.filter((n) => groups.get(n)?.length).map((n) => ({ name: n, options: order(groups.get(n)) }));
}

/** The composer text a picked option becomes: the chat's own "/ai @Name note". */
export function directionCommand(name, text) {
  const n = String(name || '').trim();
  const ref = /\s/.test(n) ? `@"${n}"` : `@${n}`;
  return `/ai ${ref} ${String(text || '').trim()}`;
}

/**
 * The composer after a pick. Empty, or holding only a command (a turn chip,
 * an earlier pick): the pick replaces it. Holding the player's own words:
 * they stay, and the pick goes on the last line, where the chat reads a
 * trailing "/ai" line as the note for the reply that follows.
 */
export function composeWithDirection(current, command) {
  const text = String(current || '').replace(/\s+$/, '');
  if (!text.trim()) return command;
  const lines = text.split('\n');
  if (lines.length === 1 && lines[0].trim().startsWith('/')) return command;
  if (lines[lines.length - 1].trim().startsWith('/ai ')) lines.pop();
  return [...lines, command].join('\n');
}

/** Label for a kind key. */
export function directionKindLabel(key) {
  return DIRECTION_KINDS.find((k) => k.key === key)?.label || '';
}
