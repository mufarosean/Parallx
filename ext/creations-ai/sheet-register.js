// sheet-register.js — what a character sheet is for, the register that
// follows from it, and the lengths it is held to.
//
// Nobody reads the sheet. It is handed, word for word, to the chat model as
// its instructions for playing the character, and that model cannot ask: it
// guesses where the sheet says nothing and takes literally what it says. A
// writer told that writes what the chat can act on and stops writing what
// it cannot (one model was writing "her clothes are her armour" into the
// Clothes section; another wrote a line where a paragraph was asked for).
// Every writer of a sheet gets the same two paragraphs (SHEET_PURPOSE,
// SHEET_REGISTER): the Studio's whole sheet, a field's or a section's
// Rewrite, the completion pass, the chat's character tools.
//
// Length is a word range (FIELD_WORDS, SECTION_WORDS), a floor so a terse
// model gives the chat enough and a ceiling so a verbose one stops before
// it pads. fieldShortfall measures a written field against its structure
// and its floor; the Studio asks once more for what is missing or thin.
// The section helpers (a label at the start of a line, which sections a
// field has) live here too, so the measuring needs nothing from the prompts.

import { STUDIO_FIELDS } from './studio-sheet.js';

export const SHEET_PURPOSE = 'What the sheet is for: it is handed, word for word, to another AI as its only instructions for playing this character in a roleplay chat. That model cannot ask a question. Whatever the sheet leaves open it guesses, differently in every scene, and whatever the sheet says it takes literally. So every sentence hands it something to act on: a fact to keep straight, a thing it can describe (a colour, a cut, a fabric, a measurement, an object, a place), a habit it can perform, what the character does when something happens. Write it as a dossier, literal and specific, in plain words.';
export const SHEET_REGISTER = 'A sentence the chat cannot act on is wasted, or worse, played literally. No figures of speech anywhere outside the example dialogue: no metaphor, no simile, no image. Clothes are clothes, never armour; a face is never a mask; nothing "speaks of", "is a testament to" or "tells its own story". No sentence that says what the one before it meant, no line that sums the person up, no adjective where the fact behind it would do ("professional" gives the chat nothing to describe; the suit, the shoes and the badge do). Figurative speech has one place: the character\'s own mouth, in the example dialogue, when they would talk that way. The test for every sentence: could the chat describe, do, say or keep straight something because of it? If not, replace it with the fact behind it, or cut it.';

/** How long each field is, in words, when nothing else sets it. A floor so a terse model writes enough; a ceiling so a verbose one stops. */
export const FIELD_WORDS = { description: [120, 220], appearance: [100, 180], personality: [80, 160], backstory: [150, 280] };
/** The same for one section of a structured field. */
export const SECTION_WORDS = [30, 90];
/** Under this share of its floor a field or a section is thin, and the Studio asks for it again. */
const THIN_SHARE = 0.6;

export function countWords(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

export const normLabel = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A section's label at the start of a line, any length: "Face:", "**Face:**", "## Face -", a whole question. */
export const SECTION_HEAD = /^\s*(?:\*\*|__|#+\s*)?([^:\n*_]+?)(?:\*\*|__)?\s*[:\-–—]/;

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

export const paragraphs = (t) => String(t || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/**
 * What a field still lacks. `missing`: the structure sections it has no
 * paragraph for. `thin`: the sections it has, under the section floor
 * (SECTION_WORDS, THIN_SHARE). `short`: a field with no structure under
 * its own floor (FIELD_WORDS); an empty field is not short, it is empty. A
 * field at length is { missing: [], thin: [], short: false }.
 */
export function fieldShortfall(key, value, entry) {
  const text = String(value || '').replace(/\r/g, '');
  if (entry && Array.isArray(entry.sections) && entry.sections.length) {
    const { present, missing } = sectionsPresent(text, entry);
    const floor = Math.ceil(SECTION_WORDS[0] * THIN_SHARE);
    const thin = [];
    if (entry.labels) {
      // The words under each label, up to the next label.
      const bodies = new Map();
      let current = '';
      for (const line of text.split('\n')) {
        const m = SECTION_HEAD.exec(line);
        const hit = m && entry.sections.find((x) => normLabel(x.name) === normLabel(m[1]));
        if (hit) { current = hit.name; bodies.set(current, line.slice(m[0].length)); continue; }
        if (current) bodies.set(current, `${bodies.get(current)} ${line}`);
      }
      for (const name of present) if (countWords(bodies.get(name) || '') < floor) thin.push(name);
    } else {
      const paras = paragraphs(text);
      present.forEach((name, i) => { if (countWords(paras[i] || '') < floor) thin.push(name); });
    }
    return { missing, thin, short: false };
  }
  const range = FIELD_WORDS[key];
  const short = !!range && text.trim().length > 0 && countWords(text) < Math.ceil(range[0] * THIN_SHARE);
  return { missing: [], thin: [], short };
}

/** The direction for a rewrite that brings a field with no structure up to its length, keeping every fact it has. */
export function expansionDirection(key) {
  const field = STUDIO_FIELDS.find((f) => f.key === key);
  const label = field ? field.label.toLowerCase() : key;
  const [min, max] = FIELD_WORDS[key] || SECTION_WORDS;
  return `Keep every fact the ${label} already states and EXPAND it to its full length, ${min} to ${max} words: more concrete detail about THIS character that the chat can describe or act on (what they do, where, with what, what happens when), as the requirement below asks. No figures of speech, no filler, no summing up.`;
}
