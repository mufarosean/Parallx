// studio-core.js — Creations AI: the Character Studio's pure half.
//
// Prompts, parsing, the canon and its Twist, and the mapping between a
// character sheet and the character file the chat reads. No DOM, no model,
// no files: everything in here is unit-tested (tests/unit/creationsStudio*.ts).
//
// The idea (docs/CREATIONS_AI.md): a character is made from a concept, from
// sources, or from sources with a Twist. Sources become CANON, a list of
// short established facts. A Twist rewrites the canon and says, fact by
// fact, what it kept, changed and added. The sheet is written from the canon,
// so what changed is visible as facts, not guessed from prose.

// ── The sheet ──────────────────────────────────────────────────────────────

export const STUDIO_FIELDS = [
  { key: 'name', label: 'Name', rows: 1, hint: 'What they are called.' },
  { key: 'tagline', label: 'Tagline', rows: 1, hint: 'One line that says who they are, without the name.' },
  { key: 'description', label: 'Overview', rows: 5, hint: 'Who they are, their life and work, how they behave.' },
  { key: 'appearance', label: 'Appearance', rows: 4, hint: 'What they look like and what they wear.' },
  { key: 'personality', label: 'Personality', rows: 4, hint: 'Their temperament, how they treat people, the need under it.' },
  { key: 'voice', label: 'Voice', rows: 4, hint: 'How they speak: tone, rhythm, phrases they use and never use.' },
  { key: 'backstory', label: 'Backstory', rows: 5, hint: 'Where they come from and the turning points that made them.' },
  { key: 'drives', label: 'Drives', rows: 3, hint: 'What they want, what they fear, what stands in the way.' },
  { key: 'secrets', label: 'Secrets', rows: 2, hint: 'What they hide, and from whom.' },
  { key: 'relationships', label: 'Relationships', rows: 3, hint: 'The people who matter to them and how things stand.' },
  { key: 'exampleDialogue', label: 'Example Dialogue', rows: 8, hint: 'Three exchanges. The chat imitates these more than anything else.' },
  { key: 'reminder', label: 'Reminder', rows: 2, hint: 'The one thing the chat must never forget about them.' },
];
export const STUDIO_KEYS = STUDIO_FIELDS.map((f) => f.key);

/** Sheet sections that are folded into the chat's role instruction, in order, with their headings. */
const PORTRAIT_SECTIONS = [
  ['appearance', 'Appearance'],
  ['personality', 'Personality'],
  ['voice', 'Voice'],
  ['backstory', 'Background'],
  ['drives', 'Drives'],
  ['secrets', 'Secrets'],
  ['relationships', 'Relationships'],
];

export function emptySheet() {
  return Object.fromEntries(STUDIO_KEYS.map((k) => [k, '']));
}

// ── Text hygiene ───────────────────────────────────────────────────────────

/** Em and en dashes never reach a saved character (house rule, same as the chat). */
export function stripDashes(text) {
  if (!text) return text;
  return String(text)
    .replace(/(\d)\s*[—–]\s*(?=\d)/g, '$1-')
    .replace(/^[—–]+\s*/gm, '')
    .replace(/\s*[—–]+(?=["'”’)\]]|\s*$)/gm, '...')
    .replace(/\s*[—–]+\s*/g, ', ');
}

/**
 * Models tag dialogue with the character's own name; the chat wants [USER]:
 * and [AI]:. A model that ran the exchanges together on one line gets its
 * line breaks back: a speaker tag always starts a line.
 */
export function normalizeDialogue(text) {
  if (!text) return text;
  return String(text)
    .replace(/(\S)[ \t]+(?=\[[^\]\n]+\]\s*:)/g, '$1\n')
    .replace(/^\s*\[([^\]\n]+)\]\s*:/gm, (m, tag) =>
      tag.trim().toUpperCase() === 'USER' ? '[USER]:' : '[AI]:');
}

/** The labelled lines the sheet asks for, put back on their own lines when the model ran them together. */
function restoreLines(key, v) {
  const lines = v.split('\n').filter((l) => l.trim()).length;
  if (key === 'drives' && lines < 3) {
    return v.replace(/(\S)[ \t]+(?=(?:Wants|Fears|In the way)\s*:)/gi, '$1\n');
  }
  if (key === 'relationships' && lines < 2) {
    // "...ice machine. Dana: her sister..." splits before a capitalised name followed by a colon.
    // The sentence end must follow two lowercase letters or digits, so "Mr. Henderson:" stays whole.
    return v.replace(/([a-z0-9]{2}[.;!?])[ \t]+(?=(?:[A-Z][\w'.-]*\s?){1,4}:\s)/g, '$1\n');
  }
  return v;
}

export function cleanFieldValue(key, value) {
  let v = typeof value === 'string' ? value : (value == null ? '' : JSON.stringify(value));
  v = stripDashes(v).trim();
  if (key === 'exampleDialogue') v = normalizeDialogue(v);
  if (key === 'drives' || key === 'relationships') v = restoreLines(key, v);
  return v;
}

export function cleanSheet(parsed) {
  const out = emptySheet();
  if (!parsed || typeof parsed !== 'object') return out;
  for (const k of STUDIO_KEYS) if (parsed[k] != null) out[k] = cleanFieldValue(k, parsed[k]);
  return out;
}

// ── Sources ────────────────────────────────────────────────────────────────
// A link is fetched by the Web Research extension (its provenance seed,
// egress bridge, sanitizer and caps), never here: one door to the web.

export function collapseWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Keep the first `maxWords` words, cut back to the last sentence end in the
 * final stretch so the model never sees a half sentence. Returns
 * { text, words, totalWords, condensed }.
 */
export function condenseText(text, maxWords = 1500) {
  const clean = collapseWhitespace(text);
  const totalWords = countWords(clean);
  if (totalWords <= maxWords) return { text: clean, words: totalWords, totalWords, condensed: false };
  const words = clean.split(/\s+/);
  let cut = words.slice(0, maxWords).join(' ');
  const tail = cut.slice(Math.floor(cut.length * 0.85));
  const end = Math.max(tail.lastIndexOf('. '), tail.lastIndexOf('.\n'), tail.lastIndexOf('! '), tail.lastIndexOf('? '));
  if (end > 0) cut = cut.slice(0, Math.floor(cut.length * 0.85) + end + 1);
  return { text: cut.trim(), words: countWords(cut), totalWords, condensed: true };
}

/** One block per source for a prompt, numbered, with its citation. */
export function sourcesBlock(sources) {
  return sources
    .filter((s) => s && s.text)
    .map((s, i) => `[${i + 1}] ${s.title || s.kind || 'Source'}${s.ref ? ` (${s.ref})` : ''}\n${s.text}`)
    .join('\n\n');
}

// ── Prompts ────────────────────────────────────────────────────────────────

const NO_DASHES = 'Never use em dashes or en dashes anywhere. Use commas, periods or ellipses instead.';

/** Facts out of the sources: the canon. */
export function buildCanonMessages(sources, direction = '') {
  const system = [
    'You extract established facts about one subject from source text.',
    'Write each fact as one short, self-contained statement in the third person. Every fact names the subject by name, never by a pronoun alone, so it stands on its own: "<Name> was born in...", "<Name>\'s mother, Sigrid, is a teacher." Only what the text supports; never invent, never soften.',
    'Cover, when the text gives them: identity (name, age, origin), life and work, relationships, personality and habits, how they speak, appearance, notable events, beliefs, what they are known for.',
    'Return ONLY a JSON object: {"subject": "<name>", "facts": ["...", "..."]}. 15 to 40 facts, most important first; when the text supports more than 40, merge the small ones rather than exceed it. No markdown, no commentary.',
    NO_DASHES,
  ].join('\n');
  const user = [
    'SOURCES:',
    '',
    sourcesBlock(sources),
    '',
    direction.trim() ? `The subject, and what to focus on: ${direction.trim()}` : 'The subject is whoever or whatever the sources are about.',
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** The Twist: rewrite the canon, saying what was kept, changed and added. */
export function buildTwistMessages(facts, twist) {
  const system = [
    'You revise a list of established facts about a person according to one change the user wants.',
    'The change is a cause, not a line to append. Go through the list fact by fact and ask of each: could this still be true after the change? A fact that could not is rewritten; every other fact is kept word for word.',
    'What a change usually touches: "never became famous" makes every award, residency, tour, television series, critics\' praise and "best known for" untrue, and each becomes the smaller thing that happened instead (the act played bars, the series was never made) or, for a prize, "never won". "Lives in another world or era" moves the same life into it: the same trade, home, family and habits, translated, not replaced by a new occupation or title unless the change names one. "Refuses students" makes taking on apprentices untrue, and what they teach becomes what they refuse to teach. Temperament, manner of speaking, looks, family, fears and beliefs almost never change.',
    'Return ONLY a JSON object: {"facts": [{"text": "...", "status": "kept" | "changed" | "added", "was": "..."}]}.',
    'Rules, in order:',
    '1. Every fact the change does not touch stays word for word, with status "kept".',
    '2. Every fact the change makes untrue is rewritten as what is true instead, with status "changed" and the old text in "was". The new text must differ from the old.',
    '3. Only what the change clearly implies is added, with status "added". No more than a third of the list may be added, and no added fact merely restates the change; its consequences belong in the facts.',
    '4. The person stays recognisable: their name, temperament, manner of speaking and the shape of their personality survive unless the change says otherwise.',
    '5. Nothing kept or added may contradict the change or another fact. Keep the original order; put added facts where they belong.',
    'A result where every fact is kept and the change is one added line is wrong; so is one where more than half the facts change for a change that touches only career, fame or place.',
    NO_DASHES,
  ].join('\n');
  const user = [
    'FACTS:',
    ...facts.map((f, i) => `${i + 1}. ${f}`),
    '',
    'THE CHANGE:',
    twist.trim(),
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const FIELD_REQUIREMENTS = [
  '- "name": their name. The NAME given above when there is one, exactly; otherwise the canon\'s name when there is one. Otherwise a first name and surname from the character\'s own country and generation, the kind found in a phone book there. Never the fiction defaults: Elias, Elara, Silas, Marcus, Mara, Mira, Thorne, Vance, Vane, Aris, Kael, Vex, Wren. The same rule for every named person in the sheet.',
  '- "tagline": at most ten words, no name, not a restatement of the concept: the one line that says who they are now.',
  '- "description": 1-2 paragraphs: who they are, their background, occupation and daily life, and how they behave. Concrete specifics over adjectives.',
  '- "appearance": one vivid paragraph: their physical appearance and typical clothing, faithful to the canon and the concept. Any physical trait the concept states replaces any attribute given below.',
  '- "personality": one paragraph: their temperament, how they treat people, what they openly want, and the hidden need that conflicts with it.',
  '- "voice": 3-5 short lines, one per line with a line break between them, each a third-person description of how they speak, not a sample line: the tone; the rhythm; "Says: \'...\' and \'...\'" (two signature phrases); "Never says: \'...\' or \'...\'". Sample lines belong in the example dialogue.',
  '- "backstory": 1-2 paragraphs in the past tense: where they come from, with places and ages, and at least one turning point that made them who they are.',
  '- "drives": exactly three lines with a line break between them, each starting with its label: "Wants: ..." (what they openly want), "Fears: ..." (what they privately fear), "In the way: ..." (a person, a habit, a fact).',
  '- "secrets": one or two sentences: what they hide and who must never learn it.',
  '- "relationships": two to four named people, one per line with a line break between them, each starting "<Their name>: " then who they are to the character and how things stand between them right now.',
  '- "exampleDialogue": the MOST important field. Three exchanges, three different situations, in this order: first someone asks them for something practical; then someone touches the fear or the secret; then idle small talk they answer in their own way. Six lines, laid out as "[USER]: ...\\n[AI]: ...\\n[USER]: ...\\n[AI]: ...\\n[USER]: ...\\n[AI]: ...", one to three sentences per line. The personality must be AUDIBLE in how the character speaks: do not describe traits, perform them. The character answers like a person, not in slogans, and never ends a reply on a clipped aphorism ("That is enough.", "Do not ask me to...").',
  '- "reminder": one third-person sentence: the single most important fact to never forget about this character.',
].join('\n');

const CRAFT_RULES = [
  'Craft rules:',
  '- The temperament comes from the concept and the canon, not from a default. Not every character is quiet, precise and cold; people are also warm, talkative, funny, anxious, sloppy, vain or boastful. Decide what this one is and let every field show it.',
  '- No stock details: no scar, no trembling hands, no rigid posture, no steel-grey eyes unless the concept or the canon gives them. No stock phrases, no "eyes sparkling", no purple filler. Concrete specifics a reader would remember.',
  '- Third person everywhere except inside the example dialogue, and no "you" at all outside it, not even the general "you"; say "a person" or "anyone".',
  '- Inside the JSON strings, quote phrases with single quotes, never double quotes. Write every one of the twelve fields, "name" first; the object is not finished until "reminder" is written.',
  `- ${NO_DASHES}`,
].join('\n');

/**
 * The sheet, in one request. `canon` is the list of facts (already
 * twisted when there is a Twist), `concept` the user's own words, `spec`
 * the dials as text (only when the user touched them), `twist` the change
 * so the writer knows the world has already moved.
 */
export function buildSheetMessages({ concept = '', canon = [], spec = '', twist = '', name = '' } = {}) {
  const system = [
    'You are a character designer for roleplay fiction. You create original, specific, believable characters, never generic ones.',
    'Every field is written in the THIRD PERSON, as a description of the character ("<Name> is...", "She speaks..."). Never address anyone as "you", and never the general "you" either ("if you catch them early" becomes "if caught early"); the only "you" is inside the example dialogue. Never write instructions. It should all read as one consistent character portrait.',
    `Return ONLY a single JSON object with EXACTLY these string keys, in this order: ${STUDIO_KEYS.map((k) => `"${k}"`).join(', ')}. No markdown, no commentary.`,
    NO_DASHES,
  ].join('\n');
  const parts = ['Create ONE character.', ''];
  if (name.trim()) {
    parts.push(`NAME: ${name.trim()}. The user chose this name. Use it exactly, in every field; never rename them.`, '');
  }
  if (concept.trim()) {
    parts.push('CHARACTER CONCEPT (the user\'s own words; authoritative; build everything around this, and when it conflicts with anything below except the canon, the concept wins):', concept.trim(), '');
  }
  if (canon.length > 0) {
    parts.push('CANON (established facts about this person; every field must agree with all of them; do not contradict them and do not drop the important ones):', ...canon.map((f) => `- ${f}`), '');
    if (twist.trim()) parts.push(`The canon already includes this change: ${twist.trim()}. Write the character as they are now, in that life, not as they were before. The description states the change plainly in its first sentences and then what it means for their days; the backstory tells how it came about.`, '');
  }
  if (spec.trim()) {
    parts.push('ATTRIBUTES (fill whatever the canon and the concept leave open; the canon and the concept win on any conflict):', spec.trim(), '');
  }
  parts.push('Field requirements:', FIELD_REQUIREMENTS, '', CRAFT_RULES);
  return [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n') }];
}

/** One field again, consistent with the rest of the sheet, written differently. */
export function buildFieldMessages({ concept = '', canon = [], spec = '', twist = '', name = '' } = {}, sheet, key) {
  const field = STUDIO_FIELDS.find((f) => f.key === key);
  const label = field ? field.label.toLowerCase() : key;
  const context = [];
  if (name.trim()) context.push(`NAME: ${name.trim()}. The user chose this name; use it exactly.`, '');
  if (concept.trim()) context.push('CHARACTER CONCEPT (authoritative):', concept.trim(), '');
  if (canon.length > 0) context.push('CANON (must agree with all of these):', ...canon.map((f) => `- ${f}`), '');
  if (twist.trim() && canon.length > 0) context.push(`The canon already includes this change: ${twist.trim()}.`, '');
  if (spec.trim()) context.push('ATTRIBUTES:', spec.trim(), '');
  const requirement = FIELD_REQUIREMENTS.split('\n').find((l) => l.startsWith(`- "${key}"`)) || '';
  return [
    { role: 'system', content: `You are a character designer. Write in the THIRD PERSON as a description of the character; never address anyone as "you", not even the general "you"; never write instructions. Return ONLY a JSON object with exactly one string key: "${key}". No commentary. ${NO_DASHES}` },
    { role: 'user', content: [
      ...context,
      'Current character sheet JSON:', JSON.stringify(sheet, null, 2), '',
      `Rewrite ONLY the ${label}: a fresh take, consistent with the rest of the sheet but written differently than before. Keep to the same length as the current one or shorter; plain and concrete, no purple filler, no stock phrases.`,
      requirement,
    ].join('\n') },
  ];
}

/** A line to the character in the Studio: one reply, in their voice, no thread. */
export function buildTryLineMessages(sheet, line) {
  const name = (sheet.name || 'the character').trim();
  const system = [
    `You are ${name}. Stay in character. Reply in the first person, in one to four sentences, in their voice exactly as described. No narration unless ${name} would narrate. Never break character, never explain.`,
    NO_DASHES,
    '',
    composeRoleInstruction(sheet),
    sheet.exampleDialogue ? `\nExample dialogue:\n${sheet.exampleDialogue}` : '',
    sheet.reminder ? `\nReminder: ${sheet.reminder}` : '',
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: line.trim() }];
}

// ── Parsing ────────────────────────────────────────────────────────────────

export function parseJsonLoose(text) {
  const tryParse = (s) => { try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : null; } catch { return null; } };
  const raw = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const direct = tryParse(raw);
  if (direct) return direct;
  const m = raw.match(/\{[\s\S]*\}/);
  return m ? tryParse(m[0]) : null;
}

/**
 * While a JSON object streams in, the string fields already closed can be
 * shown before the object is complete. Returns { key: value } for every key
 * whose string literal has ended. Escapes are honoured; a key inside an
 * unfinished value is not mistaken for a field.
 */
export function extractCompletedFields(raw, keys = STUDIO_KEYS) {
  const out = {};
  const text = String(raw || '');
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"`, 'g');
    let m;
    while ((m = re.exec(text))) {
      const start = m.index + m[0].length;
      let i = start;
      let closed = -1;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '"') { closed = i; break; }
        i++;
      }
      if (closed < 0) break;
      try { out[key] = JSON.parse(`"${text.slice(start, closed)}"`); } catch { /* malformed escape: wait for more */ }
      break;
    }
  }
  return out;
}

/** The twisted canon out of the model's JSON: [{ text, status, was }]. Unknown statuses read as kept. */
export function parseTwistedCanon(parsed, baseFacts = []) {
  const list = Array.isArray(parsed?.facts) ? parsed.facts : [];
  const out = [];
  for (const item of list) {
    if (typeof item === 'string') { out.push({ text: stripDashes(item).trim(), status: 'kept', was: '' }); continue; }
    if (!item || typeof item !== 'object' || typeof item.text !== 'string') continue;
    let status = item.status === 'changed' || item.status === 'added' ? item.status : 'kept';
    const text = stripDashes(item.text).trim();
    const was = status === 'changed' ? stripDashes(String(item.was || '')).trim() : '';
    // A "change" whose text is the old text is no change: the canon shows it as kept, not as a move.
    if (status === 'changed' && was && was.replace(/\s+/g, ' ') === text.replace(/\s+/g, ' ')) status = 'kept';
    out.push({ text, status, was: status === 'changed' ? was : '' });
  }
  // A twist that returned nothing keeps the base canon rather than emptying it.
  return out.length > 0 ? out.filter((f) => f.text) : baseFacts.map((text) => ({ text, status: 'kept', was: '' }));
}

/** The canon prompt asks for at most 40 facts, most important first; a longer list is cut there. */
export const MAX_CANON_FACTS = 40;
export function parseCanonFacts(parsed) {
  const list = Array.isArray(parsed?.facts) ? parsed.facts : [];
  return list.filter((f) => typeof f === 'string' && f.trim()).map((f) => stripDashes(f).trim()).slice(0, MAX_CANON_FACTS);
}

export function canonCounts(entries) {
  const c = { total: 0, kept: 0, changed: 0, added: 0 };
  for (const e of entries || []) { c.total++; c[e.status === 'changed' ? 'changed' : e.status === 'added' ? 'added' : 'kept']++; }
  return c;
}

// ── Sheet <-> character file ───────────────────────────────────────────────

/** The role instruction the chat reads: overview first, then headed sections in a fixed order. */
export function composeRoleInstruction(sheet) {
  const parts = [(sheet.description || '').trim()];
  for (const [key, heading] of PORTRAIT_SECTIONS) {
    const v = (sheet[key] || '').trim();
    if (v) parts.push(`## ${heading}\n${v}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/** The inverse: a role instruction written by the Studio (or the old Forge) split back into fields. */
export function splitRoleInstruction(text) {
  const out = { description: '' };
  const src = String(text || '');
  const chunks = src.split(/^## +/m);
  out.description = chunks[0].trim();
  const byHeading = new Map(PORTRAIT_SECTIONS.map(([key, heading]) => [heading.toLowerCase(), key]));
  byHeading.set('backstory', 'backstory');
  for (const chunk of chunks.slice(1)) {
    const nl = chunk.indexOf('\n');
    const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim().toLowerCase();
    const body = nl < 0 ? '' : chunk.slice(nl + 1).trim();
    const key = byHeading.get(heading);
    if (key) out[key] = body;
    else out.description = `${out.description}\n\n## ${chunk.trim()}`.trim();
  }
  return out;
}

/**
 * The sheet for a character file. A Studio-made character carries its
 * sheet; any other (hand-written, imported, Forge-made) is read back out of
 * its role instruction so the same rows work on it.
 */
export function sheetFromCharacter(data) {
  const sheet = emptySheet();
  if (!data) return sheet;
  const saved = data.studio && data.studio.sheet;
  if (saved && typeof saved === 'object') {
    for (const k of STUDIO_KEYS) if (typeof saved[k] === 'string') sheet[k] = saved[k];
    if (!sheet.name) sheet.name = data.name || '';
    return sheet;
  }
  const split = splitRoleInstruction(data.roleInstruction || '');
  Object.assign(sheet, split);
  sheet.name = data.name || '';
  if (!sheet.voice && data.voiceAnchor) sheet.voice = data.voiceAnchor;
  sheet.exampleDialogue = data.exampleDialogue || '';
  sheet.reminder = data.reminder || '';
  return sheet;
}

/** The character file fields the chat reads, written from the sheet. Everything else on `base` is kept. */
export function characterFromSheet(sheet, base = {}, studio = {}) {
  return {
    ...base,
    name: (sheet.name || base.name || 'Unnamed').trim(),
    roleInstruction: composeRoleInstruction(sheet),
    voiceAnchor: (sheet.voice || '').trim(),
    exampleDialogue: (sheet.exampleDialogue || '').trim(),
    reminder: (sheet.reminder || '').trim(),
    studio: { ...(base.studio || {}), ...studio, sheet: { ...sheet } },
  };
}

// ── Lineage ────────────────────────────────────────────────────────────────

/** Root first, the character itself last. Cycles and missing parents end the walk. */
export function lineageOf(charactersById, id) {
  const chain = [];
  const seen = new Set();
  let cur = charactersById.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    const parentId = cur.studio && cur.studio.parentId;
    cur = parentId ? charactersById.get(parentId) : null;
  }
  return chain;
}

export function formatWords(n) {
  return `${Number(n || 0).toLocaleString('en-US')} ${n === 1 ? 'word' : 'words'}`;
}
