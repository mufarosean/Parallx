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

// ── Sheet structure ────────────────────────────────────────────────────────
// The owner wanted the writer to describe, not gesture (2026-10-06): an
// appearance that says how tall, what the face does, how they sit and move,
// each in its own paragraph, and the list of what is required to be his to
// change over time. The structure is a Settings text (DEFAULT_SHEET_STRUCTURE
// shipped, "Sheet structure" in Settings): a heading names a sheet field, the
// lines under it are its sections in order. A field named there is written
// as one paragraph per section, each starting with its label; a field not
// named keeps its usual shape (FIELD_REQUIREMENTS). The whole sheet and a
// single field's rewrite follow it alike.

export const DEFAULT_SHEET_STRUCTURE = [
  '# The shape of each sheet field the Studio writes. A heading names a field',
  '# (Appearance, Personality, Backstory...); the lines under it are its sections,',
  '# in order, each written as its own paragraph that starts with the section\'s',
  '# label. "Label: hint" says what belongs there. A field with no heading here',
  '# keeps its usual shape. Add "(no labels)" after a heading for plain paragraphs.',
  '',
  'Appearance',
  '- Overview: the impression at first sight, in one or two sentences',
  '- Height and build: height, weight, frame, posture, how they carry it',
  '- Face: eyes, hair, skin, the features people remember, what the face does at rest',
  '- Clothes: what they wear day to day and how they wear it',
  '- Physicality: how they move, sit, stand and gesture; the habits of their body; what their hands do',
].join('\n');

/**
 * The structure text as a map: field key -> { labels, sections: [{ name, hint }] }.
 * A heading is a field's label or key, case-insensitive, an optional colon,
 * and optionally "(no labels)". Lines starting with # are notes. A section
 * line is "- Name: hint" or "- Name"; a field whose heading has no sections
 * is left out, as is a heading that names no field.
 */
export function parseSheetStructure(text) {
  const out = {};
  if (typeof text !== 'string' || !text.trim()) return out;
  const byName = new Map(STUDIO_FIELDS.flatMap((f) => [[f.label.toLowerCase(), f.key], [f.key.toLowerCase(), f.key]]));
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (!current) continue;
      const m = /^([^:]+?)\s*:\s*(.*)$/.exec(bullet[1]);
      const name = stripDashes(m ? m[1] : bullet[1]).trim();
      if (name) current.sections.push({ name, hint: stripDashes(m ? m[2] : '').trim() });
      continue;
    }
    const head = /^(.+?)\s*(\((?:no|without)\s+labels\))?\s*:?\s*$/i.exec(line);
    const key = head ? byName.get(head[1].trim().toLowerCase()) : undefined;
    if (!key) { current = null; continue; }
    current = { labels: !head[2], sections: [] };
    out[key] = current;
  }
  for (const k of Object.keys(out)) if (out[k].sections.length === 0) delete out[k];
  return out;
}

/** The requirement line for a field written to a structure: one paragraph per section, in order, each in detail. */
export function structureRequirement(key, entry) {
  const n = entry.sections.length;
  const list = entry.sections.map((s) => (s.hint ? `${s.name} (${s.hint})` : s.name)).join('; ');
  const first = entry.sections[0].name;
  const label = entry.labels
    ? `each paragraph begins with its section's label and a colon, like "${first}: ..."`
    : 'each paragraph is plain, with no label';
  const skeleton = entry.labels
    ? entry.sections.map((s) => `${s.name}: ...`).join('\\n\\n')
    : entry.sections.map(() => '...').join('\\n\\n');
  return `- "${key}": written as ${n} separate paragraphs, one per section, in this order, with a blank line between them (\\n\\n inside the JSON string); ${label}. Every section is filled with concrete, specific detail about THIS character, several sentences each; none is skipped, merged or padded out. The sections: ${list}. Written like: "${skeleton}" with each ... a full paragraph. A "${key}" with fewer than ${n} paragraphs is incomplete and wrong.`;
}

/** The sheet's own rule for a structure, in the system message: models weigh it more there. */
export function structureSystemLine(structure) {
  const keys = Object.keys(structure && typeof structure === 'object' ? structure : {}).filter((k) => structure[k] && structure[k].sections && structure[k].sections.length);
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `"${k}" (${structure[k].sections.length} sections: ${structure[k].sections.map((x) => x.name).join(', ')})`);
  return `Some fields have a required structure, given under Field requirements: ${parts.join('; ')}. Write EVERY section named, each as its own paragraph, in order. A field with fewer paragraphs than its sections is incomplete and wrong; never merge two sections into one paragraph.`;
}

const normLabel = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A section's label at the start of a line: "Face:", "**Face:**", "## Face -". */
const SECTION_HEAD = /^\s*(?:\*\*|__|#+\s*)?([^:\n*_]{1,60}?)(?:\*\*|__)?\s*[:\-\u2013\u2014]/;

/** The structure section a paragraph starts with, by its label; '' when it names none of `entry`'s. */
export function sectionOfParagraph(paragraph, entry) {
  if (!entry || !Array.isArray(entry.sections)) return '';
  const m = SECTION_HEAD.exec(String(paragraph || '').trimStart().split('\n')[0]);
  if (!m) return '';
  const n = normLabel(m[1]);
  const hit = entry.sections.find((x) => normLabel(x.name) === n);
  return hit ? hit.name : '';
}

/**
 * Which of a structure's sections a field's text has. With labels, a section
 * is present when a paragraph or a line begins with its label (bold or not,
 * a colon or a dash after it); without, paragraphs are counted in order.
 * `{ present, missing }`, both lists of section names.
 */
export function sectionsPresent(value, entry) {
  const text = String(value || '').replace(/\r/g, '');
  const sections = entry && Array.isArray(entry.sections) ? entry.sections : [];
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!entry || !entry.labels) {
    return { present: sections.slice(0, paras.length).map((x) => x.name), missing: sections.slice(paras.length).map((x) => x.name) };
  }
  const heads = new Set();
  for (const line of text.split('\n')) {
    const m = SECTION_HEAD.exec(line);
    if (m) heads.add(normLabel(m[1]));
  }
  const present = [];
  const missing = [];
  for (const x of sections) (heads.has(normLabel(x.name)) ? present : missing).push(x.name);
  return { present, missing };
}

const paragraphs = (t) => String(t || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/**
 * A structured field with only some of its sections sent: those sections
 * replace theirs, the rest stay word for word, a section the card lacks goes
 * in at its place in the structure. `null` when the text is the whole field
 * (every section, or paragraphs without labels); `{ problem }` when the card's
 * own text has no sections to put them in.
 */
export function mergeSections(existing, incoming, entry) {
  if (!entry || !entry.labels || !Array.isArray(entry.sections) || !entry.sections.length) return null;
  const inc = paragraphs(incoming).map((text) => ({ text, section: sectionOfParagraph(text, entry) }));
  if (!inc.length || inc.some((p) => !p.section)) return null;
  const sent = [...new Set(inc.map((p) => p.section))];
  if (sent.length >= entry.sections.length) return null;
  const out = paragraphs(existing).map((text) => ({ text, section: sectionOfParagraph(text, entry) }));
  if (out.length && !out.some((p) => p.section)) return { problem: `the card's text for this field is not written in sections yet, so the ${sent.join(', ')} section${sent.length === 1 ? '' : 's'} cannot be put in place: send the whole field, all ${entry.sections.length} sections.` };
  const order = (name) => entry.sections.findIndex((x) => x.name === name);
  for (const p of inc) {
    const at = out.findIndex((x) => x.section === p.section);
    if (at >= 0) { out[at] = p; continue; }
    let after = -1;
    out.forEach((x, i) => { if (x.section && order(x.section) < order(p.section)) after = i; });
    out.splice(after + 1, 0, p);
  }
  return { text: out.map((p) => p.text).join('\n\n'), sections: sent };
}

/**
 * One section rewritten, put back in its place: the section's paragraph from
 * the model's reply (or the whole reply, labelled, when it wrote just the
 * text) replaces that section; every other section stays word for word,
 * whatever else the reply held. `{ text }`, or `{ problem }`.
 */
export function spliceSection(existing, reply, entry, section) {
  const paras = paragraphs(reply);
  let para = paras.find((p) => sectionOfParagraph(p, entry) === section);
  if (!para) {
    const plain = paras.filter((p) => !sectionOfParagraph(p, entry));
    if (!plain.length) return { problem: `the reply had no ${section} section` };
    para = `${section}: ${plain.join(' ')}`;
  }
  const merged = mergeSections(existing, para, entry);
  if (!merged) return { text: para };
  if (merged.problem) return { problem: merged.problem };
  return { text: merged.text };
}

/** The messages that rewrite one section of a structured field, and nothing else. */
export function buildSectionMessages(ctx, sheet, key, section, entry, direction = '') {
  const field = STUDIO_FIELDS.find((f) => f.key === key);
  const label = field ? field.label.toLowerCase() : key;
  const s = (entry && entry.sections || []).find((x) => x.name === section) || { name: section, hint: '' };
  const base = buildFieldMessages(ctx, sheet, key, direction);
  const ask = [
    `Rewrite ONLY the "${s.name}" section of the ${label}${s.hint ? ` (${s.hint})` : ''}${String(direction || '').trim() ? ', following the user\'s direction for it:' : ': a fresh take, consistent with the rest of the sheet, about the same length.'}`,
    ...(String(direction || '').trim() ? [`DIRECTION: ${String(direction).trim()}`, 'The direction leads: change what it asks to change, and keep the rest of the sheet true. Plain and concrete, no purple filler.'] : []),
    `Return the "${key}" key with ONE paragraph: the ${s.name} section, starting with "${s.name}:". Do not write the other sections of the ${label}; they stay exactly as they are.`,
  ].join('\n');
  const user = base[1].content;
  const cut = user.indexOf('Current character sheet JSON:');
  const sheetPart = cut >= 0 ? user.slice(cut).split('\n').slice(0, 1).join('\n') : '';
  const head = cut >= 0 ? user.slice(0, cut) : '';
  return [base[0], { role: 'user', content: [head + sheetPart, JSON.stringify(sheet, null, 2), '', ask].join('\n') }];
}

/**
 * The section a direction names, when it names exactly one: by a word of
 * the section's name ("her clothes", "the face"); '' otherwise.
 */
export function sectionNamedIn(direction, entry) {
  const d = String(direction || '').toLowerCase();
  if (!d.trim() || !entry || !Array.isArray(entry.sections)) return '';
  const hits = entry.sections.filter((x) => normLabel(x.name).split(' ').filter((w) => w.length > 3 && w !== 'and' && w !== 'with').some((w) => new RegExp(`(?<![\\p{L}])${w}`, 'u').test(d)));
  return hits.length === 1 ? hits[0].name : '';
}

/** The direction for a rewrite that adds what a structured field lacks and keeps what it has. */
export function completionDirection(entry, missing) {
  const names = Array.isArray(missing) ? missing : [];
  const all = entry.sections.map((x) => x.name).join(', ');
  const want = entry.sections.filter((x) => names.includes(x.name)).map((x) => (x.hint ? `${x.name} (${x.hint})` : x.name)).join('; ');
  return `Keep every paragraph that is already there, word for word, and ADD the missing sections: ${want}. Each missing section is its own paragraph of several concrete sentences${entry.labels ? ', starting with its label and a colon' : ''}, placed in the order of the structure. The result has all ${entry.sections.length} sections, in this order: ${all}. Nothing else changes.`;
}

/** Every field's requirement, with the structured fields' lines in place of their usual ones. */
export function fieldRequirements(structure) {
  const lines = FIELD_REQUIREMENTS.split('\n');
  if (!structure || typeof structure !== 'object') return lines.join('\n');
  return lines.map((l) => {
    const m = /^- "(\w+)"/.exec(l);
    const entry = m && structure[m[1]];
    return entry && entry.sections && entry.sections.length ? structureRequirement(m[1], entry) : l;
  }).join('\n');
}

const FIELD_REQUIREMENTS = [
  '- "name": their name. The NAME given above when there is one, exactly; otherwise the canon\'s name when there is one. Otherwise a first name and surname from the character\'s own country and generation, the kind found in a phone book there. Never the fiction defaults: Elias, Elara, Silas, Marcus, Mara, Mira, Thorne, Vance, Vane, Aris, Kael, Vex, Wren. The same rule for every named person in the sheet.',
  '- "tagline": at most ten words, no name, not a restatement of the concept: the one line that says who they are now.',
  '- "description": 1-2 paragraphs: who they are, their background, occupation and daily life, and how they behave. Concrete specifics over adjectives.',
  '- "appearance": one vivid paragraph: their physical appearance and typical clothing, faithful to the canon and the concept. Any physical trait the concept states replaces any attribute given below.',
  '- "personality": one paragraph: their temperament, how they treat people, what they openly want, and the hidden need that conflicts with it.',
  '- "voice": 3-5 short lines, one per line with a line break between them, each a third-person description of how they speak, not a sample line: the tone; the rhythm (sentence length, questions or statements, how they handle silence); what they talk about when they are uneasy; one line "Might say: \'...\'" giving ONE example of their phrasing, an example of the register, never a catchphrase they would repeat; one line "Never says: \'...\' or \'...\'". Sample lines belong in the example dialogue.',
  '- "backstory": 1-2 paragraphs in the past tense: where they come from, with places and ages, and at least one turning point that made them who they are.',
  '- "drives": exactly three lines with a line break between them, each starting with its label: "Wants: ..." (what they openly want), "Fears: ..." (what they privately fear), "In the way: ..." (a person, a habit, a fact).',
  '- "secrets": one or two sentences: what they hide and who must never learn it.',
  '- "relationships": two to four named people, one per line with a line break between them, each starting "<Their name>: " then who they are to the character and how things stand between them right now.',
  '- "exampleDialogue": the MOST important field. Three exchanges in three different situations, each chosen from THIS character\'s own sheet, not from a template: one about the work or the thing they want (from the drives and the description); one where what they care about, fear or hide comes up, and they deal with it by doing or saying something concrete (changing the subject, fixing the kettle, a remark about the dog), never by naming the value or the feeling; one bit of idle talk they answer in their own way. Six lines, laid out as "[USER]: ...\\n[AI]: ...\\n[USER]: ...\\n[AI]: ...\\n[USER]: ...\\n[AI]: ...", one to three sentences per line. The personality must be AUDIBLE in how they speak: perform it, never describe it. No abstract nouns in their mouth (peace, solitude, trust, freedom); the concrete thing instead. Humour, if they have it, comes from something specific in the exchange, never a quip that would fit anyone. They answer like a person, not in slogans, and never end a reply on a clipped aphorism ("That is enough.", "Do not ask me to...").',
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
/** The craft rules every sheet is written to, for callers outside the Studio (the chat's character tools). */
export const SHEET_CRAFT_RULES = CRAFT_RULES;

/**
 * The sheet, in one request. `canon` is the list of facts (already
 * twisted when there is a Twist), `concept` the user's own words, `spec`
 * the dials as text (only when the user touched them), `twist` the change
 * so the writer knows the world has already moved.
 */
export function buildSheetMessages({ concept = '', focus = '', canon = [], spec = '', twist = '', name = '', structure = null, connections = [] } = {}) {
  const structureLine = structureSystemLine(structure);
  const system = [
    'You are a character designer for roleplay fiction. You create original, specific, believable characters, never generic ones.',
    ...(structureLine ? [structureLine] : []),
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
    if (focus.trim()) parts.push(`FOCUS (what to bring forward from the canon; it changes no fact): ${focus.trim()}`, '');
    if (twist.trim()) parts.push(`The canon already includes this change: ${twist.trim()}. Write the character as they are now, in that life, not as they were before. The description states the change plainly in its first sentences and then what it means for their days; the backstory tells how it came about.`, '');
  }
  if (spec.trim()) {
    parts.push('ATTRIBUTES (fill whatever the canon and the concept leave open; the canon and the concept win on any conflict):', spec.trim(), '');
  }
  parts.push(...connectionsBlock(connections, name));
  const connReq = connectionsRequirement(connections);
  parts.push('Field requirements:', fieldRequirements(structure), ...(connReq ? [connReq] : []), '', CRAFT_RULES);
  return [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n') }];
}

// ── Pitches ────────────────────────────────────────────────────────────────
// One seed used to give one character. A pitch is a short take on the
// concept (name, tagline, hook, the contradiction inside them, one line they
// might say); several at once, each a different person, and the sheet is
// written from the one chosen. Choosing between angles is where the
// creativity is; a full sheet per angle would cost too much.

export const PITCH_COUNT = 4;

export function buildPitchMessages({ concept = '', spec = '', name = '' } = {}, count = PITCH_COUNT) {
  const system = [
    'You design characters for roleplay fiction. From one concept you propose several different characters, each a real take on it, never the obvious one twice.',
    `Return ONLY a JSON object: {"pitches": [{"name": "...", "tagline": "...", "hook": "...", "contradiction": "...", "line": "..."}]} with exactly ${count} pitches. No markdown, no commentary.`,
    'Each pitch: "name", a first name and surname from the character\'s own country and generation, the kind found in a phone book there, never the fiction defaults (Elias, Elara, Silas, Marcus, Mara, Mira, Thorne, Vance, Vane, Aris, Kael, Vex, Wren); "tagline", at most ten words, no name, who they are now; "hook", one sentence: the premise of this person, their life and work, concrete; "contradiction", one sentence: the tension inside them, what they want against what they do; "line", one thing they might say, in their own voice, one or two sentences, no stock quip.',
    'The pitches differ in temperament (one may be warm, one vain, one anxious, one funny), in age, in the life around the concept, and in what the contradiction is. Third person throughout except inside "line".',
    NO_DASHES,
  ].join('\n');
  const parts = [`Propose ${count} different characters for this concept.`, ''];
  if (name.trim()) parts.push(`NAME: ${name.trim()}. The user chose this name: every pitch uses it, and the pitches differ in everything else.`, '');
  if (concept.trim()) parts.push('CHARACTER CONCEPT (the user\'s own words; authoritative; every pitch is a take on this):', concept.trim(), '');
  if (spec.trim()) parts.push('ATTRIBUTES (fill whatever the concept leaves open; the concept wins on any conflict):', spec.trim(), '');
  return [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n') }];
}

/** The pitches out of the model's JSON, cleaned; at most six, only those with a hook or a tagline. */
export function parsePitches(parsed) {
  const list = Array.isArray(parsed?.pitches) ? parsed.pitches : [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const take = (k) => stripDashes(typeof p[k] === 'string' ? p[k] : '').trim();
    const pitch = { name: take('name'), tagline: take('tagline'), hook: take('hook'), contradiction: take('contradiction'), line: take('line') };
    if (!pitch.hook && !pitch.tagline) continue;
    out.push(pitch);
    if (out.length >= 6) break;
  }
  return out;
}

/** The concept the sheet is written from once a pitch is chosen: the user's words, then the take. */
export function pitchAsConcept(concept, pitch) {
  if (!pitch) return concept;
  const lines = [
    'The take to write, chosen from several pitches (the sheet is this person):',
    pitch.name ? `Name: ${pitch.name}` : '',
    pitch.tagline ? `Tagline: ${pitch.tagline}` : '',
    pitch.hook ? `Hook: ${pitch.hook}` : '',
    pitch.contradiction ? `Contradiction: ${pitch.contradiction}` : '',
    pitch.line ? `A line they might say: ${pitch.line}` : '',
  ].filter(Boolean);
  return [String(concept || '').trim(), lines.join('\n')].filter(Boolean).join('\n\n');
}

/** One field again, consistent with the rest of the sheet, written differently. */
/**
 * Rewrite one field. `direction` is the user's optional steer for this
 * rewrite ("darker, more about her father", "more detail on the war years");
 * when given it leads, and the field's usual length gives way to it.
 */
export function buildFieldMessages({ concept = '', focus = '', canon = [], spec = '', twist = '', name = '', structure = null, connections = [] } = {}, sheet, key, direction = '') {
  const field = STUDIO_FIELDS.find((f) => f.key === key);
  const label = field ? field.label.toLowerCase() : key;
  const context = [];
  if (name.trim()) context.push(`NAME: ${name.trim()}. The user chose this name; use it exactly.`, '');
  if (concept.trim()) context.push('CHARACTER CONCEPT (authoritative):', concept.trim(), '');
  if (canon.length > 0) context.push('CANON (must agree with all of these):', ...canon.map((f) => `- ${f}`), '');
  if (twist.trim() && canon.length > 0) context.push(`The canon already includes this change: ${twist.trim()}.`, '');
  if (focus.trim() && canon.length > 0) context.push(`FOCUS (what to bring forward from the canon; it changes no fact): ${focus.trim()}`, '');
  if (spec.trim()) context.push('ATTRIBUTES:', spec.trim(), '');
  context.push(...connectionsBlock(connections, name || (sheet && sheet.name) || ''));
  const connReq = key === 'relationships' || key === 'description' || key === 'backstory' ? connectionsRequirement(connections) : '';
  const requirement = [fieldRequirements(structure).split('\n').find((l) => l.startsWith(`- "${key}"`)) || '', connReq].filter(Boolean).join('\n');
  return [
    { role: 'system', content: `You are a character designer. Write in the THIRD PERSON as a description of the character; never address anyone as "you", not even the general "you"; never write instructions. Return ONLY a JSON object with exactly one string key: "${key}". No commentary. ${NO_DASHES}` },
    { role: 'user', content: [
      ...context,
      'Current character sheet JSON:', JSON.stringify(sheet, null, 2), '',
      ...(String(direction || '').trim()
        ? [
          `Rewrite ONLY the ${label}, following the user's direction for it:`,
          `DIRECTION: ${String(direction).trim()}`,
          'The direction leads: change what it asks to change, add what it asks for, and keep the rest of the sheet true. Length is what the direction needs: if it asks for more detail or depth, write more (up to about three times the current length); otherwise keep about the same length. Plain and concrete, no purple filler, no stock phrases.',
          `The usual shape of the ${label}, which the direction may override (a shape given as sections is kept: the direction changes what is in them):`,
        ]
        : [`Rewrite ONLY the ${label}: a fresh take, consistent with the rest of the sheet but written differently than before. Keep to the same length as the current one or shorter; plain and concrete, no purple filler, no stock phrases.`]),
      requirement,
    ].join('\n') },
  ];
}

/** A line to the character in the Studio: one reply, in their voice, no thread. */
export function buildTryLineMessages(sheet, line) {
  const name = (sheet.name || 'the character').trim();
  const system = [
    `You are ${name}. Stay in character. Reply in the first person, in one to four sentences, in their voice exactly as described. Quoted phrases in the voice notes are examples of the register, not lines to say. No narration unless ${name} would narrate. Never break character, never explain.`,
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

/**
 * A character saved from the Chat Behaviour page, its Studio sheet kept in
 * step. That page edits the file's own fields (the role instruction, the
 * voice anchor, the example dialogue, the reminder, the name); the Studio
 * and the chat's tools read the sheet first, so an edit made there and not
 * carried into the sheet would be undone by the next Studio save or chat
 * edit (found 2026-10-09). `before` is the file as the page loaded it,
 * `next` what it saves; only what changed is carried, so a sheet field the
 * role instruction cannot hold (the tagline) stays.
 */
export function keepSheetInStep(before, next) {
  const saved = next && next.studio && next.studio.sheet;
  if (!saved || typeof saved !== 'object') return next;
  const b = before || {};
  const changed = (k) => String(next[k] ?? '').trim() !== String(b[k] ?? '').trim();
  const sheet = { ...saved };
  if (changed('name')) sheet.name = String(next.name || '').trim();
  if (changed('roleInstruction')) {
    const split = splitRoleInstruction(next.roleInstruction);
    sheet.description = split.description || '';
    for (const [key] of PORTRAIT_SECTIONS) sheet[key] = split[key] || '';
    // A role instruction without a Voice section still has the voice anchor.
    if (!sheet.voice) sheet.voice = String(next.voiceAnchor || '');
  }
  if (changed('voiceAnchor')) sheet.voice = String(next.voiceAnchor || '');
  if (changed('exampleDialogue')) sheet.exampleDialogue = String(next.exampleDialogue || '');
  if (changed('reminder')) sheet.reminder = String(next.reminder || '');
  return { ...next, studio: { ...next.studio, sheet } };
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

// ── Connected people ───────────────────────────────────────────────────────
// A new character is often made to stand beside one that exists: the
// gamekeeper to a lord, the sister to a lead. Before this (2026-10-06) the
// owner retyped who the other person was and what their world looked like,
// every time. A connection names a character from the roster and one line,
// from the new character's side, on how they stand to them ("works for Lord
// Ashby at his estate as his gamekeeper"). At generation the connected card is
// read fresh and goes in as established fact, so the sheet is written in that
// world without a word of it retyped; saved on the character
// (`studio.connections`), the link stays live for the chat (main.js, People In
// Their Lives) and for the back-link onto the other card.

const CONNECTION_FIELD_WORDS = { tagline: 30, description: 160, appearance: 90, backstory: 120, relationships: 90 };

function clipWords(text, max) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ').replace(/[,;:]$/, '') + '...';
}

/** What a connected card tells the writer: the person as their own sheet has them, shortened; never their secrets. */
export function connectionDigest(data) {
  const sheet = sheetFromCharacter(data || {});
  const name = (sheet.name || (data && data.name) || 'Unnamed').trim();
  const lines = [];
  if (sheet.tagline) lines.push(`Tagline: ${clipWords(sheet.tagline, CONNECTION_FIELD_WORDS.tagline)}`);
  if (sheet.description) lines.push(`Overview: ${clipWords(sheet.description, CONNECTION_FIELD_WORDS.description)}`);
  if (sheet.appearance) lines.push(`Appearance: ${clipWords(sheet.appearance, CONNECTION_FIELD_WORDS.appearance)}`);
  if (sheet.backstory) lines.push(`Background: ${clipWords(sheet.backstory, CONNECTION_FIELD_WORDS.backstory)}`);
  if (sheet.relationships) lines.push(`Their relationships: ${clipWords(sheet.relationships, CONNECTION_FIELD_WORDS.relationships)}`);
  return { name, lines };
}

/**
 * The prompt block for the connections: `[{ name, how, data }]`, `data` the
 * connected character's current file (read fresh). `newName` is the character
 * being written, when known. Empty array when there is nothing to say.
 */
export function connectionsBlock(connections, newName = '') {
  const list = Array.isArray(connections) ? connections.filter((c) => c && (c.data || c.name)) : [];
  if (list.length === 0) return [];
  const who = (newName || '').trim() || 'The character';
  const out = [
    'CONNECTED PEOPLE (established characters from the user\'s roster, read from their own cards; everything here is true and must not be contradicted or renamed; the character is written in relation to them, in their world, and knows what anyone in their position would know of it):',
  ];
  for (const c of list) {
    const d = c.data ? connectionDigest(c.data) : { name: c.name, lines: [] };
    out.push(`### ${(c.name || d.name).trim()}`);
    if (c.how && c.how.trim()) out.push(`${who} to them, from ${who}'s side: ${c.how.trim()}`);
    out.push(...d.lines);
  }
  out.push('');
  return out;
}

/** The requirement that the Relationships field names every connected person. */
function connectionsRequirement(connections) {
  const names = (Array.isArray(connections) ? connections : []).map((c) => c && (c.name || (c.data && c.data.name))).filter(Boolean);
  if (names.length === 0) return '';
  return `- The "relationships" field includes one line for each connected person (${names.map((n) => `"${n}"`).join(', ')}), by that exact name, saying who they are to the character and how things stand right now, in keeping with the line given for them; the other lines may be new people. The "description" and "backstory" place the character in the connected people's world (their house, their work, their town) as those cards describe it, without retelling the other person's story.`;
}

/** The line a connection adds to the OTHER card's Relationships: the new person, then how they stand, from their side. */
export function backLinkLine(newName, how) {
  const n = String(newName || '').trim();
  const h = stripDashes(String(how || '')).trim().replace(/\.$/, '');
  if (!n) return '';
  return h ? `${n}: ${h}.` : `${n}: connected to them.`;
}

/** The sheet with one more Relationships line (not added twice for the same name). */
export function withRelationshipLine(sheet, line) {
  const l = String(line || '').trim();
  if (!l) return sheet;
  const name = l.split(':')[0].trim().toLowerCase();
  const existing = parseRelationshipLines(sheet.relationships || '');
  if (existing.some((p) => p.name.trim().toLowerCase() === name)) return sheet;
  return { ...sheet, relationships: [String(sheet.relationships || '').trim(), l].filter(Boolean).join('\n') };
}

// ── Making one of their people ─────────────────────────────────────────────
// The sheet names two to four people who do not exist. Any of them can be
// made a character of their own, from the line that names them and who they
// are to this character; added to a chat as supporting cast, the leads have
// someone to talk to.

/** "Dana: her sister, lives upstairs" lines → [{ name, note }]. */
export function parseRelationshipLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.trim().match(/^[-*]?\s*([^:]{1,60}?)\s*:\s*(.+)$/);
    if (m) out.push({ name: m[1].trim(), note: m[2].trim() });
  }
  return out;
}

/** The concept for one of their people: the line, and who it is in relation to. */
export function relationConcept(person, sheet) {
  const owner = (sheet.name || 'the character').trim();
  const who = (sheet.tagline || '').trim();
  return [
    `${person.name}: ${person.note}`,
    `${person.name} is written here in relation to ${owner}${who ? ` (${who.replace(/\.$/, '')})` : ''}; the relationship above is how things stand between them right now, seen from ${person.name}'s side. ${person.name} is a whole person with a life of their own, not an extension of ${owner}.`,
  ].join('\n\n');
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

// ── The canon, edited by hand ──────────────────────────────────────────────
//
// A fact can be rewritten by hand. Edits are kept against the SOURCE fact
// they change (its text as read from the sources), so they survive a new
// Changes text being applied to the same sources; a new reading of the
// sources starts over. A fact typed back to its source text is kept again.

/** The source fact a canon entry stands for: its own text if kept, its "was" if changed; none for an added fact. */
export function canonBaseOf(fact) {
  if (!fact) return null;
  if (fact.status === 'kept') return fact.text;
  if (fact.status === 'changed') return fact.was || null;
  return null;
}

/**
 * Rewrite canon fact `index` to `text` by hand. Returns the new canon and
 * the edits map (source fact → your text). Empty text changes nothing.
 */
export function editCanonFact(canon, edits, index, text) {
  const next = String(text || '').replace(/\s+/g, ' ').trim();
  const list = Array.isArray(canon) ? canon.map((f) => ({ ...f })) : [];
  const map = { ...(edits || {}) };
  const f = list[index];
  if (!f || !next || next === f.text) return { canon: list, edits: map };
  const base = canonBaseOf(f);
  if (base !== null && next === base) {
    list[index] = { text: base, status: 'kept', was: '' };
    delete map[base];
  } else if (base !== null) {
    list[index] = { text: next, status: 'changed', was: base, hand: true };
    map[base] = next;
  } else {
    list[index] = { ...f, text: next, hand: true };
  }
  return { canon: list, edits: map };
}

/** Put hand edits back on a rebuilt canon (after the Changes are applied again to the same sources). */
export function applyCanonEdits(canon, edits) {
  const map = edits || {};
  if (!Object.keys(map).length) return Array.isArray(canon) ? canon : [];
  return (Array.isArray(canon) ? canon : []).map((f) => {
    const base = canonBaseOf(f);
    if (base === null || !map[base] || map[base] === f.text) return f;
    return { text: map[base], status: 'changed', was: base, hand: true };
  });
}

/** A fingerprint of what the canon is read from: the sources' text and the focus. Equal means nothing to re-read. */
export function sourcesKey(sources, focus = '') {
  let h = 2166136261;
  const feed = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } };
  for (const src of Array.isArray(sources) ? sources : []) feed(`${src.id || ''}\u0001${src.text || ''}\u0002`);
  feed(`\u0003${String(focus || '').trim()}`);
  return (h >>> 0).toString(36);
}

