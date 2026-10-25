// character-find.js — Creations' character tools: finding characters in the
// roster by name or words, and the text the chat gets back for a find.
// Split out of character-tool-core.js, which re-exports what other files import.

import { characterLink, rosterName, norm, clip } from './character-tool-core.js';
import { sheetFromCharacter, STUDIO_KEYS, STUDIO_FIELDS } from './studio-core.js';

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
