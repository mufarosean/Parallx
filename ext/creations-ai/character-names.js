// character-names.js — Creations AI: how a character is named and linked, on
// its own. character-tool-core.js and character-find.js both use these, so
// this imports neither (an external tool's imports must not cycle).

const LINK_SEGMENT = 'creations';

/** The link that opens a character in the Studio: `parallx://creations/character?file=<fileName>`. */
export function characterLink(fileName) {
  return `parallx://${LINK_SEGMENT}/character?file=${encodeURIComponent(String(fileName || ''))}`;
}

export const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The roster's name for a character entry from scanCharacters. */
export function rosterName(entry) {
  return String((entry && (entry.frontmatter?.name || entry.rawData?.name)) || (entry && entry.fileName ? entry.fileName.replace(/\.(md|json)$/, '') : '')).trim();
}

export const clip = (t, words) => { const w = String(t || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); return w.length <= words ? w.join(' ') : `${w.slice(0, words).join(' ')}...`; };
