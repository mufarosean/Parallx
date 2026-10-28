// studio-connections.js — Creations' character studio: the people a new
// character is connected to (their cards, read fresh, shortened, never their
// secrets), the Relationships lines that tie two cards together, making one
// of a character's people into a card of their own, and a card's lineage.
// Split out of studio-core.js, which re-exports what other files import.

import { sheetFromCharacter, stripDashes } from './studio-sheet.js';

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
export function connectionsRequirement(connections) {
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
