// character-tool-core.js — Creations AI: the chat's character tools, pure.
//
// The owner asked (2026-10-08) for the chat's AI to make characters: a
// concept of any length, pages, links, files and photos in the conversation,
// one character or several, saved straight into the roster. The creative work
// happens in the conversation, where the model already sees all of that; what
// must be exact lives here, tested on its own (tests/unit/creationsCharacterTools.test.ts):
//
//   - the brief: what a sheet must be right now, from the user's own Settings
//     (Sheet structure) and roster, so the model writes to what the app wants,
//     not to a copy in a prompt;
//   - reading what the model sends, however it shapes it (arrays, objects,
//     other key names), into the Studio's twelve fields;
//   - the checks, each a sentence that says what to change: every field
//     filled, every structured section there, the labelled lines the chat and
//     the Studio expect, connected people named in Relationships, no name
//     taken twice;
//   - connections by name, to the roster or to another character in the same
//     call, so a household is one call;
//   - the file, built by the Studio's own characterFromSheet, so a character
//     made in chat opens in the Studio like any other.
//
// main.js registers the tools and does the reading and writing of files.

import {
  STUDIO_FIELDS, STUDIO_KEYS, cleanFieldValue, emptySheet, fieldRequirements, structureSystemLine,
  sectionsPresent, characterFromSheet, sheetFromCharacter, connectionsBlock, parseRelationshipLines,
  SHEET_CRAFT_RULES, stripDashes, sectionOfParagraph,
} from './studio-core.js';

/** Most characters one save call takes; the rest go in another call. */
export const MAX_CHARACTERS_PER_CALL = 8;
/** Longest a field may be, in characters: anything longer is not a sheet. */
export const MAX_FIELD_CHARS = 12000;
/** Roster entries the brief lists by name; the rest are counted. */
export const BRIEF_ROSTER_MAX = 60;

const LINK_SEGMENT = 'creations';

/** The link that opens a character in the Studio: `parallx://creations/character?file=<fileName>`. */
export function characterLink(fileName) {
  return `parallx://${LINK_SEGMENT}/character?file=${encodeURIComponent(String(fileName || ''))}`;
}

/** The file a character link names, or '' when it names none a character could have. */
export function fileFromCharacterLink(parsed) {
  const f = parsed && parsed.params && typeof parsed.params.file === 'string' ? parsed.params.file : '';
  return /^[\w.-]{1,120}\.json$/.test(f) && !f.includes('..') ? f : '';
}

// ── Reading what the model sends ───────────────────────────────────────────

/** Other names models use for the twelve fields, lower-cased, without spaces, dashes or underscores. */
const FIELD_ALIASES = new Map([
  ['name', 'name'], ['fullname', 'name'], ['charactername', 'name'],
  ['tagline', 'tagline'], ['oneliner', 'tagline'], ['logline', 'tagline'],
  ['description', 'description'], ['overview', 'description'], ['summary', 'description'], ['about', 'description'],
  ['appearance', 'appearance'], ['looks', 'appearance'], ['physicaldescription', 'appearance'], ['physical', 'appearance'],
  ['personality', 'personality'], ['temperament', 'personality'],
  ['voice', 'voice'], ['speech', 'voice'], ['speakingstyle', 'voice'], ['howtheyspeak', 'voice'],
  ['backstory', 'backstory'], ['background', 'backstory'], ['history', 'backstory'],
  ['drives', 'drives'], ['motivations', 'drives'], ['goals', 'drives'],
  ['secrets', 'secrets'], ['secret', 'secrets'],
  ['relationships', 'relationships'], ['relations', 'relationships'], ['people', 'relationships'],
  ['exampledialogue', 'exampleDialogue'], ['dialogue', 'exampleDialogue'], ['exampledialog', 'exampleDialogue'], ['sampledialogue', 'exampleDialogue'], ['examples', 'exampleDialogue'],
  ['reminder', 'reminder'], ['note', 'reminder'],
]);

const keyOf = (k) => String(k || '').toLowerCase().replace(/[\s_\-]+/g, '');

/** A label for an object key a model used inside a field ("in_the_way" → "In the way"). */
function labelOf(k) {
  const words = String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ').trim().toLowerCase();
  if (words === 'want' || words === 'wants') return 'Wants';
  if (words === 'fear' || words === 'fears') return 'Fears';
  if (/^(in the way|obstacle|obstacles|blocker|standing in the way)$/.test(words)) return 'In the way';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One field's value as text. Models send strings, arrays of lines, objects of
 * labelled parts ({ wants, fears, inTheWay }), arrays of people
 * ({ name, note }) or of dialogue turns ({ speaker, line }).
 */
export function fieldText(key, value) {
  if (value == null) return '';
  // A model that escaped its line breaks twice sends the two characters "\n".
  if (typeof value === 'string') return !value.includes('\n') && value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (key === 'exampleDialogue') {
      return value.map((t) => {
        if (typeof t === 'string') return t;
        if (t && typeof t === 'object') {
          const who = String(t.speaker || t.role || t.who || t.from || '').trim();
          const line = String(t.line || t.text || t.content || t.says || '').trim();
          const tag = /^(user|\{\{user\}\}|you|player)$/i.test(who) ? '[USER]' : '[AI]';
          return line ? `${tag}: ${line}` : '';
        }
        return '';
      }).filter(Boolean).join('\n');
    }
    return value.map((v) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') {
        const name = String(v.name || v.person || v.who || '').trim();
        const note = String(v.note || v.how || v.relationship || v.description || v.text || '').trim();
        if (name) return note ? `${name}: ${note}` : name;
        return Object.entries(v).map(([k, x]) => `${labelOf(k)}: ${String(x).trim()}`).join('\n');
      }
      return '';
    }).filter((x) => x && x.trim()).join(key === 'voice' || key === 'drives' || key === 'relationships' ? '\n' : '\n\n');
  }
  if (typeof value === 'object') {
    // { Overview: "...", Face: "..." } for a structured field; { wants, fears, inTheWay } for drives.
    const sep = key === 'drives' || key === 'voice' || key === 'relationships' ? '\n' : '\n\n';
    return Object.entries(value).map(([k, x]) => `${labelOf(k)}: ${fieldText(key, x).trim()}`).join(sep);
  }
  return '';
}

/**
 * One character as the model sent it, read into the Studio's sheet plus what
 * goes with it. Unknown keys are reported, never silently used.
 * `{ sheet, connections: [{ name, how, addToTheirCard }], concept, allowSameName, unknownKeys }`.
 */
export function readIncomingCharacter(raw) {
  const sheet = emptySheet();
  const out = { sheet, connections: [], concept: '', allowSameName: false, unknownKeys: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw.sheet && typeof raw.sheet === 'object' && !Array.isArray(raw.sheet) ? { ...raw.sheet, ...raw } : raw;
  for (const [k, v] of Object.entries(src)) {
    const kk = keyOf(k);
    if (kk === 'sheet') continue;
    if (kk === 'connections' || kk === 'connectedto' || kk === 'connectto') {
      for (const c of Array.isArray(v) ? v : [v]) {
        if (!c) continue;
        if (typeof c === 'string') { const i = c.indexOf(':'); out.connections.push({ name: (i > 0 ? c.slice(0, i) : c).trim(), how: i > 0 ? c.slice(i + 1).trim() : '', addToTheirCard: false }); continue; }
        if (typeof c === 'object') {
          out.connections.push({
            name: String(c.name || c.character || c.to || '').trim(),
            how: String(c.how || c.relationship || c.note || c.line || '').trim(),
            addToTheirCard: c.addToTheirCard === true || c.addLineToTheirCard === true || c.backLink === true,
          });
        }
      }
      continue;
    }
    if (kk === 'concept' || kk === 'brief' || kk === 'idea') { out.concept = fieldText('concept', v).trim(); continue; }
    if (kk === 'allowsamename') { out.allowSameName = v === true; continue; }
    const field = FIELD_ALIASES.get(kk);
    if (!field) { out.unknownKeys.push(k); continue; }
    const text = fieldText(field, v);
    if (text && !sheet[field]) sheet[field] = text;
  }
  for (const k of STUDIO_KEYS) sheet[k] = cleanFieldValue(k, sheet[k]);
  sheet.name = sheet.name.replace(/\s+/g, ' ').trim();
  out.concept = stripDashes(out.concept);
  for (const c of out.connections) { c.name = stripDashes(c.name).trim(); c.how = stripDashes(c.how).trim(); }
  return out;
}

/**
 * The list of characters a save call sent, however it came: an array, a JSON
 * string of one, one character sent bare, items that are JSON strings.
 * `null` when there is nothing that could be a character.
 */
export function incomingList(args) {
  let list = args && args.characters;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
  if (list && !Array.isArray(list) && typeof list === 'object') list = [list];
  if (!Array.isArray(list)) {
    list = args && typeof args === 'object' && !Array.isArray(args) && (args.name || args.appearance || args.description) ? [args] : null;
  }
  if (!list) return null;
  return list.map((item) => {
    if (typeof item !== 'string') return item;
    try { return JSON.parse(item); } catch { return null; }
  }).filter((x) => x && typeof x === 'object' && !Array.isArray(x));
}

/**
 * A character the save could not take, kept so the fix needs only its name
 * and the fields that change: the chat cuts a long tool argument short when
 * it replays the turn to the model, so a whole sheet is often no longer in
 * front of it. `draft` is a plain character object (readIncomingCharacter
 * reads it); `incoming` the resend; what the resend gives wins, field by
 * field; connections and the concept come from the resend when it has them.
 */
export function mergeDraft(draft, incoming) {
  if (!draft) return { raw: incoming, fromDraft: [] };
  const d = readIncomingCharacter(draft);
  const n = readIncomingCharacter(incoming);
  // A whole sheet sent again is a whole sheet: nothing is taken from the draft.
  if (STUDIO_KEYS.every((k) => n.sheet[k])) return { raw: incoming, fromDraft: [] };
  const out = {};
  const fromDraft = [];
  for (const k of STUDIO_KEYS) {
    out[k] = n.sheet[k] || d.sheet[k] || '';
    if (!n.sheet[k] && d.sheet[k]) fromDraft.push(k);
  }
  out.concept = n.concept || d.concept;
  out.connections = n.connections.length ? n.connections : d.connections;
  if (n.allowSameName || d.allowSameName) out.allowSameName = true;
  return { raw: out, fromDraft };
}

/** A character as a plain object again, for keeping as a draft. */
export function asDraft(raw) {
  const r = readIncomingCharacter(raw);
  return { ...r.sheet, concept: r.concept, connections: r.connections, ...(r.allowSameName ? { allowSameName: true } : {}) };
}

/** The key a draft is kept under: the name, as the checks compare it. */
export const draftKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

// ── Checks ─────────────────────────────────────────────────────────────────

const LABEL = new Map(STUDIO_FIELDS.map((f) => [f.key, f.label]));
const label = (k) => LABEL.get(k) || k;

/** How many exchanges a dialogue has: a [USER] line followed, later, by an [AI] line. */
export function dialogueExchanges(text) {
  let n = 0;
  let open = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\[USER\]:\s*\S/.test(line)) open = true;
    else if (/^\[AI\]:\s*\S/.test(line) && open) { n++; open = false; }
  }
  return n;
}

/**
 * Everything wrong with a sheet, each a sentence that says what to change,
 * and the notes that do not stop a save. `structure` is the parsed Sheet
 * structure; `requirementOf(key)` its requirement line for a field.
 */
export function checkSheet(sheet, { structure = null } = {}) {
  const problems = [];
  const notes = [];
  const reqs = fieldRequirements(structure).split('\n');
  const requirementOf = (key) => (reqs.find((l) => l.startsWith(`- "${key}"`)) || '').replace(/^- /, '');
  if (!sheet.name) problems.push('name is empty: give the character a name.');
  else if (sheet.name.length > 80) problems.push('name is longer than 80 characters: a name, not a description.');
  else if (/^(unnamed|new character|character|tbd|unknown)$/i.test(sheet.name)) problems.push(`name "${sheet.name}" is a placeholder: give a real name.`);
  for (const key of STUDIO_KEYS) {
    if (key === 'name') continue;
    const v = sheet[key] || '';
    if (!v.trim()) { problems.push(`${key} (${label(key)}) is missing. Required: ${requirementOf(key)}`); continue; }
    if (v.length > MAX_FIELD_CHARS) problems.push(`${key} is ${v.length} characters, more than ${MAX_FIELD_CHARS}: shorten it to what the requirement asks.`);
  }
  // A structured field (Settings, Sheet structure): every section, by its label.
  for (const [key, entry] of Object.entries(structure && typeof structure === 'object' ? structure : {})) {
    if (!entry || !entry.sections || !entry.sections.length || !sheet[key]) continue;
    const { missing } = sectionsPresent(sheet[key], entry);
    if (missing.length) {
      problems.push(`${key} is missing ${missing.length === 1 ? 'the section' : 'the sections'} ${missing.join(', ')}: write all ${entry.sections.length} sections, each its own paragraph${entry.labels ? ' starting with its label and a colon' : ''}, in this order: ${entry.sections.map((x) => x.name).join(', ')}. Keep the sections already written.`);
    }
  }
  if (sheet.exampleDialogue) {
    const n = dialogueExchanges(sheet.exampleDialogue);
    if (n < 3) problems.push(`exampleDialogue has ${n} exchange${n === 1 ? '' : 's'}: it needs three, six lines alternating "[USER]: ..." and "[AI]: ...", one line each, in three different situations from this character's own sheet.`);
  }
  if (sheet.voice) {
    const lines = sheet.voice.split('\n').filter((l) => l.trim()).length;
    if (lines < 3) problems.push(`voice is ${lines} line${lines === 1 ? '' : 's'}: write 3 to 5 short third-person lines, one per line (tone; rhythm; what they talk about when uneasy; "Might say: '...'"; "Never says: '...'").`);
  }
  if (sheet.drives) {
    const need = [['Wants', /^\s*wants?\s*:/im], ['Fears', /^\s*fears?\s*:/im], ['In the way', /^\s*in the way\s*:/im]];
    const absent = need.filter(([, re]) => !re.test(sheet.drives)).map(([n]) => n);
    if (absent.length) problems.push(`drives is missing the line${absent.length === 1 ? '' : 's'} ${absent.map((a) => `"${a}: ..."`).join(', ')}: exactly three lines, "Wants: ...", "Fears: ...", "In the way: ...".`);
  }
  if (sheet.relationships) {
    const people = parseRelationshipLines(sheet.relationships);
    if (people.length < 2) problems.push(`relationships names ${people.length} ${people.length === 1 ? 'person' : 'people'} in the "Name: who they are to them" form: name two to four, one per line.`);
  }
  if (sheet.tagline) {
    const words = sheet.tagline.split(/\s+/).filter(Boolean).length;
    if (words > 14) notes.push(`tagline is ${words} words (ten is the aim).`);
    if (sheet.name && sheet.tagline.toLowerCase().includes(sheet.name.split(' ')[0].toLowerCase())) notes.push('tagline uses the name (it should say who they are without it).');
  }
  return { problems, notes };
}

// ── A call's characters, together ──────────────────────────────────────────

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The roster's name for a character entry from scanCharacters. */
export function rosterName(entry) {
  return String((entry && (entry.frontmatter?.name || entry.rawData?.name)) || (entry && entry.fileName ? entry.fileName.replace(/\.(md|json)$/, '') : '')).trim();
}

/**
 * Read, check and connect every character of one save call. `roster` is
 * scanCharacters' list. Characters in the same call may connect to each
 * other by name. A character connected to one that cannot be saved cannot
 * be saved either (its connection would point at nothing); it says so.
 * Returns `[{ index, sheet, concept, connections: [{ name, how, addToTheirCard, fileName?, batchIndex? }], problems, notes }]`.
 */
export function planBatch(rawCharacters, roster = [], { structure = null } = {}) {
  const list = Array.isArray(rawCharacters) ? rawCharacters : [];
  const plans = list.map((raw, index) => {
    const read = readIncomingCharacter(raw);
    const { problems, notes } = checkSheet(read.sheet, { structure });
    if (read.unknownKeys.length) notes.push(`ignored ${read.unknownKeys.length === 1 ? 'a key' : 'keys'} that ${read.unknownKeys.length === 1 ? 'is' : 'are'} not a field: ${read.unknownKeys.join(', ')}.`);
    return { index, sheet: read.sheet, concept: read.concept, allowSameName: read.allowSameName, connections: read.connections, problems, notes };
  });
  const rosterByName = new Map();
  for (const r of roster) { const n = norm(rosterName(r)); if (n && !rosterByName.has(n)) rosterByName.set(n, r); }
  // Names: never one already in the roster or earlier in this call, unless asked.
  const seen = new Map();
  for (const p of plans) {
    const n = norm(p.sheet.name);
    if (!n) continue;
    if (seen.has(n)) p.problems.push(`name "${p.sheet.name}" is used twice in this call (character ${seen.get(n) + 1} has it too): give each a different name.`);
    else seen.set(n, p.index);
    const taken = rosterByName.get(n);
    if (taken && !p.allowSameName) p.problems.push(`name "${p.sheet.name}" is already a character in the roster (${taken.fileName}). Pick another name; or, if a second character of that name is really wanted, send "allowSameName": true with it.`);
  }
  // Connections: the roster, then this call; each named in Relationships.
  const batchByName = new Map(plans.filter((p) => p.sheet.name).map((p) => [norm(p.sheet.name), p]));
  const rosterNames = roster.map(rosterName).filter(Boolean);
  for (const p of plans) {
    const kept = [];
    for (const c of p.connections) {
      if (!c.name) { p.problems.push('a connection has no name: each is { "name": "<a character>", "how": "<how this one stands to them>" }.'); continue; }
      const n = norm(c.name);
      if (n === norm(p.sheet.name)) { p.problems.push(`connections names "${c.name}", the character itself.`); continue; }
      if (kept.some((k) => norm(k.name) === n)) continue;
      const mate = batchByName.get(n);
      const inRoster = rosterByName.get(n);
      if (mate) kept.push({ ...c, name: mate.sheet.name, batchIndex: mate.index });
      else if (inRoster) kept.push({ ...c, name: rosterName(inRoster), fileName: inRoster.fileName });
      else {
        const shown = rosterNames.slice(0, 20).join(', ');
        p.problems.push(`connections names "${c.name}", who is not in the roster or in this call.${shown ? ` The roster has: ${shown}${rosterNames.length > 20 ? ', and more' : ''}.` : ' The roster is empty.'}`);
        continue;
      }
      if (!c.how) p.notes.push(`the connection to ${c.name} has no "how" line (how this character stands to them).`);
    }
    p.connections = kept;
    if (p.sheet.relationships) {
      const named = parseRelationshipLines(p.sheet.relationships).map((x) => norm(x.name));
      const unnamed = kept.filter((k) => !named.includes(norm(k.name)));
      if (unnamed.length) p.problems.push(`relationships must have a line for each connected person, by exact name: add ${unnamed.map((u) => `"${u.name}: ..."`).join(', ')}.`);
    }
  }
  // A connection to a character of this call that cannot be saved: neither can this one.
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of plans) {
      if (p.problems.length) continue;
      const broken = p.connections.find((c) => c.batchIndex != null && plans[c.batchIndex].problems.length);
      if (broken) { p.problems.push(`it is connected to ${broken.name}, who could not be saved: send both again together once ${broken.name} is fixed.`); changed = true; }
    }
  }
  return plans;
}

// ── The file ───────────────────────────────────────────────────────────────

/** The character file for a sheet made in chat, the Studio's own shape. `base` is createCharacterJson's. */
export function characterFileFor(sheet, { base = {}, concept = '', connections = [] } = {}) {
  return characterFromSheet(sheet, base, {
    mode: 'concept',
    concept: concept || '',
    sources: [],
    twist: '',
    canon: [],
    baseFacts: [],
    excluded: [],
    locks: [],
    dials: null,
    parentId: null,
    parentName: '',
    pitch: null,
    connections: connections.map((c) => ({ fileName: c.fileName, name: c.name, how: c.how || '' })),
    madeIn: 'chat',
  });
}

/** The other card, with one line about the new character in its Relationships; null when it already names them. */
export function backLinkedCard(otherData, newName, how) {
  const sheet = sheetFromCharacter(otherData);
  const n = String(newName || '').trim();
  if (!n) return null;
  if (parseRelationshipLines(sheet.relationships || '').some((p) => norm(p.name) === norm(n))) return null;
  const h = stripDashes(String(how || '')).trim().replace(/\.$/, '');
  const line = h ? `${n}: ${h}.` : `${n}: connected to them.`;
  const next = { ...sheet, relationships: [String(sheet.relationships || '').trim(), line].filter(Boolean).join('\n') };
  return characterFromSheet(next, otherData, otherData.studio || {});
}

// ── The brief ──────────────────────────────────────────────────────────────

const clip = (t, words) => { const w = String(t || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); return w.length <= words ? w.join(' ') : `${w.slice(0, words).join(' ')}...`; };

/**
 * What a character sheet must be right now: the fields and their
 * requirements (the user's Sheet structure applied), the craft rules, how to
 * use what is in the conversation, the roster, and the shape to send.
 * `connectTo` names roster characters whose cards come along in full.
 */
export function buildCharacterBrief({ structure = null, roster = [], connectTo = [], rosterMax = BRIEF_ROSTER_MAX } = {}) {
  const parts = [];
  parts.push('# Writing a Creations character', '');
  parts.push('Write each character as a sheet of twelve fields, then save them with creations_save_characters. Everything is in the third person, a description of the character; the only "you" is inside the example dialogue.');
  parts.push('The concept is what the user asked for in this chat, with everything they gave for it: their words (however long), canvas pages, files, links you read, and any photos attached. It is authoritative: never contradict it, and keep its details.');
  parts.push('Photos: when photos of the person are attached, write the appearance from what you see in them (build, height as it reads, face, hair, skin, clothes, bearing and how they hold themselves), concrete and specific. Do not invent what a photo does not show beyond what the concept says.');
  parts.push('Several characters: send them all in one save call (up to 8). They can be connected to each other by name, and each one\'s relationships can name the others.');
  const sys = structureSystemLine(structure);
  if (sys) parts.push('', sys);
  parts.push('', 'Field requirements:');
  parts.push(fieldRequirements(structure).replace('The NAME given above when there is one, exactly; otherwise the canon\'s name when there is one.', 'The name the user gave, exactly, when they gave one.'));
  parts.push('', SHEET_CRAFT_RULES.replace(/^- Inside the JSON strings.*$/m, '- Inside the strings, quote phrases with single quotes. Write all twelve fields for every character.'));
  parts.push('', 'Connections: a character can be connected to people in the roster (below) or in the same call, each as { "name": "<their exact name>", "how": "<how this character stands to them, from this character\'s side>" }. Their card then comes along into every chat with this character. The relationships field must have a line for each connected person, by exact name. To also add a line about the new character to an existing character\'s card, set "addToTheirCard": true on that connection (only when the user wants it).');
  parts.push('', 'Send to creations_save_characters:', '{"characters": [{"name": "...", "tagline": "...", "description": "...", "appearance": "...", "personality": "...", "voice": "...", "backstory": "...", "drives": "Wants: ...\\nFears: ...\\nIn the way: ...", "secrets": "...", "relationships": "Name: ...\\nName: ...", "exampleDialogue": "[USER]: ...\\n[AI]: ...\\n[USER]: ...\\n[AI]: ...\\n[USER]: ...\\n[AI]: ...", "reminder": "...", "concept": "<the user\'s request for this character, in short>", "connections": [{"name": "...", "how": "..."}]}]}');
  parts.push('Each field is a string; line breaks inside it are \\n. What the save cannot accept comes back with exactly what to change. To fix a character, send its name and only the fields that change: the rest of it is kept from the earlier call. A save only ever makes new characters: to change one that is already in the roster, use creations_edit_character.');
  const named = [];
  for (const n of Array.isArray(connectTo) ? connectTo : []) {
    const hit = roster.find((r) => norm(rosterName(r)) === norm(n));
    if (hit) named.push({ name: rosterName(hit), how: '', data: hit.rawData || null });
  }
  if (named.length) parts.push('', ...connectionsBlock(named, ''));
  parts.push('', `Roster (${roster.length} character${roster.length === 1 ? '' : 's'}; a new character may not take one of these names unless the user wants a second of that name; creations_find_characters gives any one's whole sheet):`);
  if (roster.length === 0) parts.push('- (empty)');
  for (const r of roster.slice(0, rosterMax)) {
    const sheet = sheetFromCharacter(r.rawData || {});
    const who = clip(sheet.tagline || (sheet.description || '').split(/(?<=[.!?])\s/)[0] || '', 14);
    parts.push(`- ${rosterName(r)}${who ? `: ${who}` : ''}`);
  }
  if (roster.length > rosterMax) parts.push(`- and ${roster.length - rosterMax} more (creations_find_characters lists them)`);
  return parts.join('\n');
}

// ── Finding characters ─────────────────────────────────────────────────────
// The roster, searchable by the chat (2026-10-09): "who do I have that lives
// in the valley", "what is Tom's secret", "which of my characters have I
// played most". Read-only. Words match in any order across the name, the
// tagline, every sheet field and the concept; a quoted phrase matches whole.

/** Most full sheets one find returns; the rest come as list lines. */
export const FIND_FULL_MAX = 4;
/** Most list lines one find returns. */
export const FIND_LIST_MAX = 60;

const FIND_WEIGHT = { name: 8, tagline: 4, description: 2 };

/** Words and "quoted phrases", lower-cased. */
export function findTerms(query) {
  const out = [];
  for (const m of String(query || '').toLowerCase().matchAll(/"([^"]*)"?|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? '').trim();
    if (/[\p{L}\p{N}]/u.test(t)) out.push(t);
  }
  return out;
}

/**
 * The roster entries a find asks for, best first: `[{ entry, sheet, score, matched }]`.
 * `names` are exact names (any case); `query` words must each appear
 * somewhere. Neither: the whole roster, most recently changed first.
 */
export function searchCharacters(roster, { query = '', names = [] } = {}) {
  const want = (Array.isArray(names) ? names : []).map(norm).filter(Boolean);
  const terms = findTerms(query);
  const out = [];
  for (const entry of Array.isArray(roster) ? roster : []) {
    const data = entry.rawData || {};
    const sheet = sheetFromCharacter(data);
    const name = rosterName(entry);
    if (want.length && !want.includes(norm(name))) continue;
    let score = 0;
    const matched = new Set();
    if (terms.length) {
      const hay = { name: name.toLowerCase(), concept: String(data.studio?.concept || '').toLowerCase() };
      for (const k of STUDIO_KEYS) if (k !== 'name') hay[k] = String(sheet[k] || '').toLowerCase();
      let all = true;
      for (const t of terms) {
        const where = Object.keys(hay).filter((k) => hay[k].includes(t));
        if (!where.length) { all = false; break; }
        for (const k of where) { matched.add(k); score += FIND_WEIGHT[k] || 1; }
      }
      if (!all) continue;
    }
    out.push({ entry, sheet, name, score, matched: [...matched], updatedAt: Number(data.updatedAt) || 0 });
  }
  out.sort((a, b) => (b.score - a.score) || (b.updatedAt - a.updatedAt) || a.name.localeCompare(b.name));
  return out;
}

/** One line for a character in a list: name, link, who they are, connections, chats. */
export function characterListLine(hit, chats = 0) {
  const who = clip(hit.sheet.tagline || (hit.sheet.description || '').split(/(?<=[.!?])\s/)[0] || '', 16);
  const conns = Array.isArray(hit.entry.rawData?.studio?.connections) ? hit.entry.rawData.studio.connections.map((c) => c && c.name).filter(Boolean) : [];
  const bits = [];
  if (conns.length) bits.push(`connected to ${conns.join(', ')}`);
  bits.push(chats === 1 ? '1 chat' : `${chats} chats`);
  return `- ${hit.name}: ${characterLink(hit.entry.fileName)}${who ? ` | ${who}` : ''} (${bits.join('; ')})`;
}

/** A character's whole sheet as text, fields by their Studio labels, with its link and what goes with it. */
export function characterFullText(hit, chats = 0) {
  const data = hit.entry.rawData || {};
  const lines = [`## ${hit.name}`, `Link: ${characterLink(hit.entry.fileName)}`];
  for (const f of STUDIO_FIELDS) {
    if (f.key === 'name') continue;
    const v = String(hit.sheet[f.key] || '').trim();
    if (v) lines.push('', `${f.label}:`, v);
  }
  const conns = Array.isArray(data.studio?.connections) ? data.studio.connections.filter((c) => c && c.name) : [];
  if (conns.length) lines.push('', 'Connected to:', ...conns.map((c) => `- ${c.name}${c.how ? `: ${c.how}` : ''}`));
  const lore = Array.isArray(data.lorebookFiles) ? data.lorebookFiles.filter(Boolean) : [];
  if (lore.length) lines.push('', `Lorebooks: ${lore.join(', ')}`);
  if (data.studio?.concept) lines.push('', `Made from: ${clip(data.studio.concept, 60)}`);
  lines.push('', `Chats: ${chats}${data.updatedAt ? `. Last changed: ${new Date(Number(data.updatedAt)).toISOString().slice(0, 10)}` : ''}.`);
  return lines.join('\n');
}

/**
 * The text a find returns. `full`: whole sheets for the first few (always
 * when names were asked for and few came back); the rest as list lines.
 * `chatsOf(fileName)` counts the chats a character is in.
 */
export function findResultText(hits, { query = '', names = [], full = false, chatsOf = () => 0, total = 0, fullMax = FIND_FULL_MAX } = {}) {
  const q = String(query || '').trim();
  // A query with its own quotes is shown as typed; otherwise it is quoted.
  const asked = [q && `matching ${q.includes('"') ? q : `"${q}"`}`, names && names.length ? `named ${names.join(', ')}` : ''].filter(Boolean).join(', ');
  if (hits.length === 0) {
    const lines = [`No character ${asked || 'in the roster'}${asked ? '' : ' yet'}.`];
    if (names && names.length) lines.push('Names are matched exactly (any case); search with words in "query" to find one by what is in their sheet.');
    else if (query) lines.push(`The roster has ${total} character${total === 1 ? '' : 's'}; try fewer or other words.`);
    return lines.join('\n');
  }
  const showFull = full || ((names && names.length) && hits.length <= FIND_FULL_MAX);
  const head = `${hits.length} character${hits.length === 1 ? '' : 's'}${asked ? ` ${asked}` : ''}, of ${total} in the roster.`;
  const lines = [head];
  const fullOnes = showFull ? hits.slice(0, fullMax) : [];
  for (const h of fullOnes) lines.push('', characterFullText(h, chatsOf(h.entry.fileName)));
  const rest = hits.slice(fullOnes.length, fullOnes.length + FIND_LIST_MAX);
  if (rest.length) {
    lines.push('', fullOnes.length ? 'Also:' : 'Characters:');
    for (const h of rest) lines.push(characterListLine(h, chatsOf(h.entry.fileName)));
  }
  const left = hits.length - fullOnes.length - rest.length;
  if (left > 0) lines.push(`- and ${left} more: narrow the search.`);
  if (!showFull) lines.push('', 'For whole sheets, call again with "names" (or "full": true).');
  else if (fullMax < Math.min(hits.length, FIND_FULL_MAX)) lines.push('', `Only ${fullMax === 1 ? 'one whole sheet fits' : fullMax === 0 ? 'no whole sheet fits' : `${fullMax} whole sheets fit`} in this reply: ask for the others by name, one at a time.`);
  lines.push('Give the user a character with its link exactly as written. To change one, creations_edit_character.');
  return lines.join('\n');
}

// ── Editing a character ────────────────────────────────────────────────────
// The owner asked (2026-10-09) for the chat to change a character it made,
// or any other, when the user does not like it: "make her older", "give Tom
// a scar", "connect Nell to Ashby". Only what the user asked changes: the
// fields sent, and in a field written in sections (Settings, Sheet
// structure) or in Drives, only the sections or lines sent, by their labels.
// The edited card must pass the checks a new one does, but a gap the card
// already had in a field the edit leaves alone does not stop it. Fields the
// user locked in the Studio are never changed. What each field said before
// is kept on the card (`studio.chatEdits`, the last ten), so the Studio's
// Undo, or the chat's, puts it back.

/** Chat edits a card remembers, newest last. */
export const CHAT_EDITS_KEPT = 10;

/**
 * The roster entry a reference names: its link, its file name or its exact
 * name (any case). `{ entry }`, or `{ problem }` saying how to name it.
 */
export function resolveCharacterTarget(roster, ref) {
  const list = Array.isArray(roster) ? roster : [];
  const r = String(ref || '').trim();
  if (!r) return { problem: 'name the character to change: "character" is its exact name or its parallx://creations/character link.' };
  let file = '';
  const q = /[?&]file=([^&\s)]+)/.exec(r);
  if (/^parallx:\/\//i.test(r) && q) { try { file = decodeURIComponent(q[1]); } catch { file = q[1]; } }
  else if (/^[\w.-]{1,120}\.json$/.test(r)) file = r;
  if (file) {
    const hit = list.find((e) => e.fileName === file);
    return hit ? { entry: hit } : { problem: `no character has the file ${file}. creations_find_characters gives every character's link.` };
  }
  const hits = list.filter((e) => norm(rosterName(e)) === norm(r));
  if (hits.length === 1) return { entry: hits[0] };
  if (hits.length > 1) return { problem: `${hits.length} characters are named ${r}: send the link of the one to change (${hits.map((h) => characterLink(h.fileName)).join(', ')}).` };
  const close = searchCharacters(list, { query: r.split(/\s+/)[0] }).slice(0, 6).map((h) => h.name);
  return { problem: `no character is named "${r}".${close.length ? ` Close: ${close.join(', ')}.` : ''} Names are matched exactly; creations_find_characters finds one by what is in their sheet.` };
}

const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
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

const DRIVE_LINES = [['Wants', /^\s*wants?\s*:/i], ['Fears', /^\s*fears?\s*:/i], ['In the way', /^\s*in the way\s*:/i]];
const driveOf = (line) => (DRIVE_LINES.find(([, re]) => re.test(line)) || [''])[0];

/** Drives with only some of its three lines sent: those lines replace theirs. `null` when the text is the whole field. */
export function mergeDrives(existing, incoming) {
  const inc = String(incoming || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!inc.length || inc.some((l) => !driveOf(l))) return null;
  const sent = [...new Set(inc.map(driveOf))];
  if (sent.length >= DRIVE_LINES.length) return null;
  const out = String(existing || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of inc) {
    const at = out.findIndex((x) => driveOf(x) === driveOf(l));
    if (at >= 0) out[at] = l;
    else {
      const rank = DRIVE_LINES.findIndex(([n]) => n === driveOf(l));
      let after = -1;
      out.forEach((x, i) => { const k = DRIVE_LINES.findIndex(([n]) => n === driveOf(x)); if (k >= 0 && k < rank) after = i; });
      out.splice(after + 1, 0, l);
    }
  }
  return { text: out.join('\n'), lines: sent };
}

const sameText = (a, b) => String(a || '').trim() === String(b || '').trim();
const connectionsOf = (data) => (Array.isArray(data?.studio?.connections) ? data.studio.connections : [])
  .filter((c) => c && c.fileName).map((c) => ({ fileName: String(c.fileName), name: String(c.name || ''), how: String(c.how || '') }));

/**
 * One edit, checked: `{ problems, notes, sheet, before, changed: [{ key, how }],
 * connections, connectionsChanged, backLinks: [{ fileName, name, how }], renamedFrom }`.
 * `changes` holds only the fields that change (any of the names a save
 * takes); `connect` `[{ name, how, addToTheirCard }]` and `disconnect`
 * `[name]` change who the card stands beside.
 */
export function planEdit(entry, roster = [], { changes = {}, connect = [], disconnect = [], allowSameName = false, structure = null } = {}) {
  const data = entry.rawData || {};
  const before = sheetFromCharacter(data);
  const problems = [];
  const notes = [];
  const read = readIncomingCharacter(changes && typeof changes === 'object' && !Array.isArray(changes) ? changes : {});
  if (read.unknownKeys.length) notes.push(`ignored ${read.unknownKeys.length === 1 ? 'a key' : 'keys'} that ${read.unknownKeys.length === 1 ? 'is' : 'are'} not a field: ${read.unknownKeys.join(', ')}.`);
  // Connections sent inside the changes are connections to add.
  connect = [...(Array.isArray(connect) ? connect : connect ? [connect] : []), ...read.connections];
  if (read.allowSameName) allowSameName = true;
  const locks = new Set(Array.isArray(data.studio?.locks) ? data.studio.locks : []);
  const sheet = { ...before };
  const changed = [];
  for (const key of STUDIO_KEYS) {
    const sent = read.sheet[key];
    if (!sent) continue;
    let next = sent;
    let how = 'rewritten';
    if (key === 'drives') {
      const m = mergeDrives(before.drives, sent);
      if (m) { next = m.text; how = `the ${andList(m.lines)} line${m.lines.length === 1 ? '' : 's'} (the rest kept)`; }
    } else if (structure && structure[key]) {
      const m = mergeSections(before[key], sent, structure[key]);
      if (m && m.problem) { problems.push(`${key}: ${m.problem}`); continue; }
      if (m) { next = m.text; how = `the ${andList(m.sections)} section${m.sections.length === 1 ? '' : 's'} (the rest kept)`; }
    }
    if (sameText(next, before[key])) continue;
    if (locks.has(key)) { problems.push(`${key} (${label(key)}) is locked in the Studio, so nothing rewrites it: leave it out, or ask the user to unlock it there (the lock on its row).`); continue; }
    sheet[key] = next;
    changed.push({ key, how });
  }

  // A new name may not be another character's, unless asked.
  const renamedFrom = sheet.name && norm(sheet.name) !== norm(before.name) ? before.name : '';
  const others = (Array.isArray(roster) ? roster : []).filter((r) => r.fileName !== entry.fileName);
  if (renamedFrom) {
    const taken = others.find((r) => norm(rosterName(r)) === norm(sheet.name));
    if (taken && !allowSameName) problems.push(`name "${sheet.name}" is already a character in the roster (${taken.fileName}). Pick another name; or, if a second character of that name is really wanted, send "allowSameName": true.`);
    const mention = others.filter((r) => connectionsOf(r.rawData).some((c) => c.fileName === entry.fileName)
      || parseRelationshipLines(sheetFromCharacter(r.rawData || {}).relationships).some((p) => norm(p.name) === norm(renamedFrom)))
      .map(rosterName);
    if (mention.length) notes.push(`${mention.join(', ')} still call${mention.length === 1 ? 's' : ''} them ${renamedFrom} on their own card${mention.length === 1 ? '' : 's'}; those were not changed.`);
  }

  // Who the card stands beside.
  const was = connectionsOf(data);
  let connections = was.map((c) => ({ ...c }));
  const rosterByName = new Map();
  for (const r of others) { const n = norm(rosterName(r)); if (n && !rosterByName.has(n)) rosterByName.set(n, r); }
  for (const raw of Array.isArray(disconnect) ? disconnect : [disconnect]) {
    const n = norm(typeof raw === 'string' ? raw : raw && raw.name);
    if (!n) continue;
    const at = connections.findIndex((c) => norm(c.name) === n || (rosterByName.get(n) && rosterByName.get(n).fileName === c.fileName));
    if (at < 0) { problems.push(`disconnect names "${raw.name || raw}", who this card is not connected to${connections.length ? ` (it is connected to ${connections.map((c) => c.name).join(', ')})` : ''}.`); continue; }
    connections.splice(at, 1);
  }
  const backLinks = [];
  const added = [];
  for (const raw of Array.isArray(connect) ? connect : [connect]) {
    if (!raw) continue;
    const c = typeof raw === 'string'
      ? (() => { const i = raw.indexOf(':'); return { name: (i > 0 ? raw.slice(0, i) : raw).trim(), how: i > 0 ? raw.slice(i + 1).trim() : '', addToTheirCard: false }; })()
      : { name: String(raw.name || raw.character || '').trim(), how: stripDashes(String(raw.how || raw.relationship || '')).trim(), addToTheirCard: raw.addToTheirCard === true };
    if (!c.name) { problems.push('a connection has no name: each is { "name": "<a character>", "how": "<how this one stands to them>" }.'); continue; }
    if (norm(c.name) === norm(sheet.name) || norm(c.name) === norm(before.name)) { problems.push(`connect names "${c.name}", the character itself.`); continue; }
    const hit = rosterByName.get(norm(c.name));
    if (!hit) { problems.push(`connect names "${c.name}", who is not in the roster. Characters are connected by their exact name; creations_find_characters lists them.`); continue; }
    const at = connections.findIndex((x) => x.fileName === hit.fileName);
    const next = { fileName: hit.fileName, name: rosterName(hit), how: c.how || (at >= 0 ? connections[at].how : '') };
    if (at >= 0) connections[at] = next; else { connections.push(next); added.push(next); }
    if (!next.how) notes.push(`the connection to ${next.name} has no "how" line (how this character stands to them).`);
    if (c.addToTheirCard) backLinks.push({ fileName: hit.fileName, name: next.name, how: c.how });
  }
  const connectionsChanged = JSON.stringify(connections) !== JSON.stringify(was);

  // Each person newly connected has a line in Relationships; a line for one already connected is not dropped.
  const namedAfter = parseRelationshipLines(sheet.relationships).map((p) => norm(p.name));
  const namedBefore = parseRelationshipLines(before.relationships).map((p) => norm(p.name));
  const unnamed = added.filter((c) => !namedAfter.includes(norm(c.name)));
  if (unnamed.length) problems.push(`relationships must have a line for each connected person, by exact name: send relationships with ${unnamed.map((u) => `"${u.name}: ..."`).join(', ')} added (the whole field, the lines already there kept).`);
  const dropped = connections.filter((c) => !added.includes(c) && namedBefore.includes(norm(c.name)) && !namedAfter.includes(norm(c.name)));
  if (dropped.length) problems.push(`relationships no longer has a line for ${dropped.map((d) => d.name).join(', ')}, who this card is connected to: keep their line, or disconnect them.`);

  // The checks a new card passes, on what this edit touched; a gap the card already had elsewhere is only noted.
  const touched = changed.map((c) => c.key);
  const was0 = checkSheet(before, { structure }).problems;
  const now = checkSheet(sheet, { structure });
  const own = (p) => touched.some((k) => p.startsWith(`${k} `)) || !was0.includes(p);
  problems.push(...now.problems.filter(own));
  const old = now.problems.filter((p) => !own(p));
  if (old.length) notes.push(`the card already had gaps this edit does not touch (offer to fix them if it fits): ${old.map((p) => p.replace(/[.:].*$/, '')).join('; ')}.`);
  notes.push(...now.notes.filter((n) => touched.includes('tagline') || touched.includes('name') ? true : !/^tagline/.test(n)));

  return { problems, notes, sheet, before, changed, connections, connectionsChanged, wasConnections: was, backLinks, renamedFrom };
}

/** The card with an edit applied and what it replaced remembered, so it can be undone. */
export function applyEdit(data, plan, { request = '', at = 0 } = {}) {
  const fields = {};
  for (const c of plan.changed) fields[c.key] = { before: plan.before[c.key] || '', after: plan.sheet[c.key] || '' };
  const record = { at, by: 'chat', request: stripDashes(String(request || '')).trim().slice(0, 300), fields };
  if (plan.connectionsChanged) record.connections = { before: plan.wasConnections, after: plan.connections };
  const studio = { ...(data.studio || {}) };
  if (plan.connectionsChanged) studio.connections = plan.connections;
  const edits = Array.isArray(studio.chatEdits) ? studio.chatEdits : [];
  studio.chatEdits = [...edits, record].slice(-CHAT_EDITS_KEPT);
  return characterFromSheet(plan.sheet, data, studio);
}

/**
 * The last chat edit taken back: each field the chat changed that still says
 * what the chat wrote gets its old text again; a field changed since, or
 * locked, is kept and named. `null` when the card has no chat edit.
 * `{ data, restored: [keys], kept: [keys], entry }`.
 */
export function undoLastChatEdit(data) {
  const edits = Array.isArray(data?.studio?.chatEdits) ? data.studio.chatEdits : [];
  if (!edits.length) return null;
  const entry = edits[edits.length - 1];
  const now = sheetFromCharacter(data);
  const locks = new Set(Array.isArray(data.studio?.locks) ? data.studio.locks : []);
  const next = { ...now };
  const restored = [];
  const kept = [];
  for (const [k, v] of Object.entries(entry.fields || {})) {
    if (!STUDIO_KEYS.includes(k) || !v) continue;
    if (sameText(now[k], v.after) && !locks.has(k)) { next[k] = v.before || ''; restored.push(k); } else kept.push(k);
  }
  const studio = { ...data.studio, chatEdits: edits.slice(0, -1) };
  if (entry.connections) {
    if (JSON.stringify(connectionsOf(data)) === JSON.stringify(entry.connections.after)) { studio.connections = entry.connections.before; restored.push('connections'); } else kept.push('connections');
  }
  return { data: characterFromSheet(next, data, studio), restored, kept, entry };
}

/**
 * What the Studio offers to undo when it opens a card: the last chat edit,
 * unless the user kept it, with the fields that still say what the chat
 * wrote. `null` when there is nothing to offer.
 */
export function pendingChatEdit(data) {
  const edits = Array.isArray(data?.studio?.chatEdits) ? data.studio.chatEdits : [];
  const entry = edits[edits.length - 1];
  if (!entry || entry.kept) return null;
  const now = sheetFromCharacter(data);
  const keys = Object.entries(entry.fields || {}).filter(([k, v]) => STUDIO_KEYS.includes(k) && v && sameText(now[k], v.after)).map(([k]) => k);
  const connections = !!entry.connections && JSON.stringify(connectionsOf(data)) === JSON.stringify(entry.connections.after);
  return keys.length || connections ? { entry, keys, connections } : null;
}

/** The fields an edit or undo touched, by their Studio labels: "Appearance, Voice and connections". */
export function fieldListText(keys) {
  return andList(keys.map((k) => (k === 'connections' ? 'connections' : label(k))));
}

/** The text the model gets back from an edit. */
export function editResultText({ name, link, plan, backLinked = [], notes = [], failed = false, noChange = false } = {}) {
  if (failed) {
    return [`Nothing was changed on ${name}. Fix these and call creations_edit_character again with every change you meant (nothing from this call was kept):`, ...plan.problems.map((p) => `- ${p}`)].join('\n');
  }
  if (noChange) return `Nothing to change on ${name}: the card already says that. ${link}`;
  const lines = [`Changed ${plan.sheet.name || name}: ${link}`];
  if (plan.renamedFrom) lines.push(`- name: was ${plan.renamedFrom}`);
  for (const c of plan.changed) if (c.key !== 'name') lines.push(`- ${c.key}: ${c.how}`);
  if (plan.connectionsChanged) {
    const was = new Set(plan.wasConnections.map((c) => c.fileName));
    const now = new Set(plan.connections.map((c) => c.fileName));
    const add = plan.connections.filter((c) => !was.has(c.fileName)).map((c) => c.name);
    const gone = plan.wasConnections.filter((c) => !now.has(c.fileName)).map((c) => c.name);
    const re = plan.connections.filter((c) => was.has(c.fileName) && JSON.stringify(c) !== JSON.stringify(plan.wasConnections.find((x) => x.fileName === c.fileName))).map((c) => c.name);
    if (add.length) lines.push(`- connected to ${add.join(', ')}`);
    if (gone.length) lines.push(`- no longer connected to ${gone.join(', ')}`);
    if (re.length) lines.push(`- how they stand to ${re.join(', ')}: updated`);
  }
  if (backLinked.length) lines.push(`- a line added to ${backLinked.join(', ')}'s card`);
  for (const n of [...plan.notes, ...notes]) lines.push(`note: ${n}`);
  lines.push('', 'What it said before is kept: the user can undo it in the Studio, or you can, with "undo": true. Give the user the link exactly as written above.');
  return lines.join('\n');
}

/** The text the model gets back from an undo. */
export function undoResultText({ name, link, result }) {
  if (!result) return `${name} has no change from the chat to undo. ${link}`;
  const lines = [];
  if (result.restored.length) lines.push(`Undid the chat's last change to ${name}: ${fieldListText(result.restored)} ${result.restored.length === 1 ? 'is' : 'are'} back as before. ${link}`);
  else lines.push(`Nothing was put back on ${name}. ${link}`);
  if (result.kept.length) lines.push(`Kept as they are now (changed since, or locked in the Studio): ${fieldListText(result.kept)}.`);
  if (result.entry && result.entry.request) lines.push(`That change was: ${result.entry.request}`);
  return lines.join('\n');
}

// ── Fitting the room the chat gives a result ───────────────────────────────
// The chat says how long a tool's result may be (`resultCharBudget`, from the
// model's context). A result over it is cut mid-text by the loop; these fit
// it first, by dropping what can be asked for again.

/** The brief within `budget` characters: fewer roster lines first; the rules always stay. */
export function fitBrief(opts, budget) {
  let text = buildCharacterBrief(opts);
  if (!budget || text.length <= budget) return text;
  for (const rosterMax of [30, 15, 5, 0]) {
    text = buildCharacterBrief({ ...opts, rosterMax });
    if (text.length <= budget) return text;
  }
  return text;
}

/** A find within `budget` characters: fewer whole sheets first, then fewer list lines. */
export function fitFindResult(hits, opts, budget) {
  let text = findResultText(hits, opts);
  if (!budget || text.length <= budget) return text;
  for (let fullMax = FIND_FULL_MAX - 1; fullMax >= 0; fullMax--) {
    text = findResultText(hits, { ...opts, fullMax });
    if (text.length <= budget) return text;
  }
  const lines = text.split('\n');
  const tail = '- and more that did not fit this reply: narrow the search.';
  while (lines.length > 1 && lines.join('\n').length + tail.length + 1 > budget) lines.pop();
  return [...lines, tail].join('\n');
}

// ── The result ─────────────────────────────────────────────────────────────

/**
 * The text the model gets back from a save. `saved`: `[{ name, fileName, link,
 * connectedTo: [names], backLinked: [names], notes }]`; `failed`: `[{ index,
 * name, problems }]`; `extra`: how many characters were over the per-call limit.
 */
export function saveResultText({ saved = [], failed = [], extra = 0, total = 0, stopped = [] } = {}) {
  const lines = [];
  lines.push(`Saved ${saved.length} of ${total} character${total === 1 ? '' : 's'}.`);
  for (const s of saved) {
    const bits = [];
    if (s.connectedTo && s.connectedTo.length) bits.push(`connected to ${s.connectedTo.join(', ')}`);
    if (s.backLinked && s.backLinked.length) bits.push(`a line added to ${s.backLinked.join(', ')}'s card`);
    lines.push(`- ${s.name}: ${s.link}${bits.length ? ` (${bits.join('; ')})` : ''}`);
    for (const n of s.notes || []) lines.push(`  note: ${n}`);
  }
  if (failed.length) {
    lines.push('', 'Not saved. Fix these and call creations_save_characters again with only them (the ones above are saved; do not send them again). For each, send its name and only the fields that change; the rest of what was sent is kept. To rename one, send the whole character under the new name:');
    for (const f of failed) {
      lines.push(`- ${f.name || `Character ${f.index + 1} (no name)`}:`);
      for (const p of f.problems) lines.push(`  - ${p}`);
    }
  }
  if (stopped.length) lines.push('', `Stopped by the user before ${stopped.join(', ')} ${stopped.length === 1 ? 'was' : 'were'} saved. Do not save ${stopped.length === 1 ? 'it' : 'them'} again unless the user asks.`);
  if (extra > 0) lines.push('', `${extra} more character${extra === 1 ? ' was' : 's were'} sent than one call takes (${MAX_CHARACTERS_PER_CALL}); send ${extra === 1 ? 'it' : 'them'} in another call.`);
  if (saved.length) lines.push('', 'Give the user each saved character with its link exactly as written above; the link opens them in the Character Studio.');
  return lines.join('\n');
}
