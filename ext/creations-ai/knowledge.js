// knowledge.js — Creations AI: what a character knows. The model writing a
// turn is handed everything: every card in the chat, the lore, the memories,
// the whole transcript. The character it writes for knows only part of it,
// and a model with no notion of separate minds writes from all it was given:
// a daughter who knows what her father told the chef in another room, a
// stranger who knows the other stranger's past. This module draws the line
// between the writer's knowledge and the character's: another character's
// card as the speaker knows that person, and the sentence each prompt section
// carries about whose knowledge it holds. The Narrator and the user's own
// turns are not minds in the story and get everything.

import { sheetFromCharacter, PORTRAIT_SECTIONS } from './studio-sheet.js';
import { parseRelationshipLines } from './studio-connections.js';

/** Of someone the speaker knows: the overview and these sections. Drives, Secrets, Voice and Relationships stay with their owner. */
const KNOWN_SECTIONS = ['appearance', 'personality', 'backstory'];
/** Of a stranger: what can be seen. */
const SEEN_SECTIONS = ['appearance'];

const HEADING = new Map(PORTRAIT_SECTIONS);

/** A chat's character object as a sheet, whether or not it was made in the Studio. */
export function characterSheet(char) {
  if (!char) return sheetFromCharacter(null);
  const name = char.frontmatter?.name || String(char.fileName || '').replace(/\.(md|json)$/, '');
  return sheetFromCharacter(char.rawData || { name, roleInstruction: char.sections?.roleInstruction || '', voiceAnchor: char.sections?.voiceAnchor || '', exampleDialogue: char.sections?.exampleDialogue || '', reminder: char.sections?.reminder || '' });
}

const norm = (s) => String(s || '').trim().toLowerCase();
const firstName = (s) => norm(s).split(/\s+/)[0] || '';

/** Whether a sheet's Relationships name a person, by full name or first name. */
export function namesPerson(sheet, personName) {
  const full = norm(personName);
  const first = firstName(personName);
  if (!full) return false;
  return parseRelationshipLines(sheet?.relationships || '').some((line) => {
    const n = norm(line.name);
    return n === full || n === first || firstName(n) === first || full.startsWith(n + ' ');
  });
}

/** Two characters know each other when either card's Relationships names the other. */
export function knowEachOther(a, aName, b, bName) {
  return namesPerson(a, bName) || namesPerson(b, aName);
}

function sections(sheet, keys) {
  const out = [];
  for (const key of keys) {
    const v = String(sheet?.[key] || '').trim();
    if (v) out.push(`## ${HEADING.get(key) || key}\n${v}`);
  }
  return out;
}

/**
 * Another character's card as the speaker knows that person. Known (either
 * card's Relationships names the other): who they are, how they look, their
 * ways and where they come from; the standing between them is on the
 * speaker's own card. A stranger: a face and a manner, and only what this
 * chat has shown since. Nobody gets another person's Drives or Secrets.
 */
export function cardAsKnownBy(speakerName, speakerSheet, otherName, otherSheet) {
  const known = knowEachOther(speakerSheet, speakerName, otherSheet, otherName);
  const parts = [`### ${otherName}`];
  if (known) {
    parts.push(`What ${speakerName} knows of ${otherName}. How they stand with each other is on ${speakerName}'s own card. Of ${otherName}'s wants, fears and what ${otherName} hides, ${speakerName} knows only what ${otherName} has shown or told them in this chat.`);
    const overview = String(otherSheet?.description || '').trim();
    if (overview) parts.push(overview);
    parts.push(...sections(otherSheet, KNOWN_SECTIONS));
  } else {
    parts.push(`${speakerName} has not met ${otherName} before this chat and knows of ${otherName} only what can be seen and what this chat has shown. Nothing else about ${otherName} is in ${speakerName}'s head: not their name until it is given, not their past, not what they want.`);
    parts.push(...sections(otherSheet, SEEN_SECTIONS));
  }
  return parts.join('\n\n');
}

/** The rule, stated once with the Turn Contract. */
export function knowledgeRule(name) {
  return `${name} knows only what ${name}'s own card holds and what this chat has shown or told ${name}. Every other card above is given as ${name} knows that person. ${name}'s words and actions draw on nothing else: a line that needs what ${name} could not know is not written.`;
}

/** The rule again, short, in the late block right before the reply. */
export function knowledgeReminder(name) {
  return `${name} knows only what ${name}'s card holds and what this chat has shown or told ${name}; nothing else is in ${name}'s head.`;
}

/** What the Present list means for whoever is not on it. */
export const PRESENT_MEANING = 'Anyone not listed is elsewhere and hears nothing said here.';

/** How the lore is addressed when a character is writing. */
export function loreAddress(name) {
  return `The world as it is. ${name} knows the part of it a person in ${name}'s place would know, and nothing a person in that place could not.`;
}

/** How the memories are addressed when a character is writing. */
export function memoryAddress(name) {
  return `Of this, ${name} knows what happened in ${name}'s presence and what ${name} was told.`;
}
