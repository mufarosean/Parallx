// since-then.js — Creations AI: off-screen life.
//
// When the Narrator moves the story to a new place or a later time, the
// characters lived through the gap. One line each is proposed, from their
// own wants and the people in their lives: what happened to them since,
// concrete, something they could mention or that shows, nothing that
// settles the story or contradicts the memory. The player sees the lines
// in the Memory panel's Timeline before they land, keeps or drops each,
// and Apply writes the kept ones to the Timeline; a line the player drops
// is never written. Story time only: nothing fires on the clock. Pure
// prompt and reading; the panel is drawn with the kit alone.

import { parseJsonLoose, stripDashes } from './studio-core.js';

const clip = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim() + '...';
};

const sceneLine = (s) => (s && typeof s === 'object' ? [s.location, s.time, s.mood].filter(Boolean).join(', ') : '');

/** Whether a Narrator turn moved the story on: the place or the time changed from a known scene. */
export function sceneMovedOn(before, after) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
  const known = !!(before.location || before.time);
  const moved = (after.location && after.location !== before.location) || (after.time && after.time !== before.time);
  return known && !!moved;
}

/** Who lived through the gap: the cast now present in the scene, else everyone; never the player's own character. */
export function whoLivedThrough(cast, after, plays = '') {
  const list = (Array.isArray(cast) ? cast : []).filter((c) => c && c.name && c.name.toLowerCase() !== String(plays || '').toLowerCase());
  const here = new Set((after && Array.isArray(after.present) ? after.present : []).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
  const present = here.size ? list.filter((c) => here.has(c.name.toLowerCase())) : [];
  return present.length ? present : list;
}

/**
 * The messages that propose one line per character.
 *   cast: [{ name, drives, relationships }]; others: [{ name, note }];
 *   before, after: scene states; memory: { facts, beats }; lastTurn: the Narrator's text
 */
export function buildSinceThenMessages({ cast = [], others = [], before = null, after = null, memory = {}, lastTurn = '' } = {}) {
  const names = cast.map((c) => c.name);
  const system = [
    'The story has moved on to a new place or a later time. For each character named, write ONE line: what happened to them in the gap, from their own wants and the people in their life. Concrete and small: a thing done, a person seen, a letter, a debt, an illness, a quarrel, a purchase. Something they could mention, or that shows on them, when the scene resumes.',
    'Never settle the story\'s central question, never contradict the memory, never decide what another character thinks. Past tense, at most 25 words, no em dashes or en dashes.',
    `Answer with JSON only: {"since": [${names.map((n) => `{"name": "${n}", "line": "..."}`).join(', ')}]}`,
  ].join('\n');
  const parts = [];
  if (sceneLine(before) || sceneLine(after)) parts.push(`The scene was: ${sceneLine(before) || 'unknown'}\nThe scene is now: ${sceneLine(after) || 'unknown'}`);
  if (lastTurn) parts.push(`The Narrator's turn that moved the story on:\n${clip(lastTurn, 1200)}`);
  const castLines = cast.map((c) => `- ${c.name}${c.drives ? `: wants ${clip(c.drives, 200)}` : ''}${c.relationships ? ` People: ${clip(c.relationships, 200)}` : ''}`);
  if (castLines.length) parts.push(`The characters:\n${castLines.join('\n')}`);
  const otherLines = (others || []).filter((o) => o && o.name).slice(0, 8).map((o) => `- ${o.name}${o.note ? `: ${clip(o.note, 160)}` : ''}`);
  if (otherLines.length) parts.push(`Others in their world:\n${otherLines.join('\n')}`);
  const facts = (memory.facts || []).map((f) => f && f.text).filter(Boolean).slice(-30);
  if (facts.length) parts.push(`Memory, what is true:\n${facts.map((f) => `- ${clip(f, 200)}`).join('\n')}`);
  const beats = (memory.beats || []).map((b) => b && b.text).filter(Boolean).slice(-12);
  if (beats.length) parts.push(`Story so far:\n${beats.map((b) => `- ${clip(b, 200)}`).join('\n')}`);
  parts.push(`Write one line for: ${names.join(', ')}.`);
  return [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
}

/** The lines from the reply, for the names asked, dashes stripped: [{ name, text }]. */
export function parseSinceThen(raw, names = []) {
  const data = parseJsonLoose(raw);
  const list = data && Array.isArray(data.since) ? data.since : [];
  const out = [];
  for (const n of names) {
    const hit = list.find((x) => x && String(x.name || '').toLowerCase() === n.toLowerCase() && String(x.line || '').trim());
    if (hit) out.push({ name: n, text: stripDashes(String(hit.line)).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/** A proposed line as it goes to the Timeline. */
export function sinceThenLine(name, text) {
  return `Since then, ${name}: ${String(text || '').trim()}`;
}

/** The proposals by thread, for the panel's commands (a button names its thread). */
const proposals = new Map();
export const SINCE_THEN_COMMANDS = { apply: 'textGenerator.chat.sinceThen.apply', dismiss: 'textGenerator.chat.sinceThen.dismiss' };
/** A panel command for a thread: 'apply' writes the kept lines, 'dismiss' drops them all. */
export function sinceThenCommand(action, threadId) {
  const p = proposals.get(threadId);
  if (!p) return undefined;
  proposals.delete(threadId);
  return action === 'apply' ? p.onApply(p.lines.filter((_, i) => p.keep[i])) : p.onDismiss();
}

/**
 * The proposal in the panel, with the kit alone: a toggle per line, Apply
 * and Dismiss. `onApply(kept)` gets the kept [{ name, text }].
 */
export function mountSinceThen(host, { threadId, lines = [], ui, onApply, onDismiss }) {
  const keep = lines.map(() => true);
  proposals.set(threadId, { lines, keep, onApply, onDismiss });
  host.appendChild(ui.renderMarkdown('**Since then**: what happened to them in the gap. Keep what you like; Apply writes it to the Timeline.'));
  lines.forEach((l, i) => ui.createToggle(host, { id: `textGenerator.chat.sinceThen.${i}`, label: `${l.name}: ${l.text}`, checked: true, onChange: (v) => { keep[i] = v; } }));
  ui.createButton(host, { id: 'textGenerator.chat.sinceThen.apply', command: SINCE_THEN_COMMANDS.apply, args: [threadId], label: 'Apply', icon: 'check', size: 'sm', kind: 'primary', title: 'Write the kept lines to the Timeline' });
  ui.createButton(host, { id: 'textGenerator.chat.sinceThen.dismiss', command: SINCE_THEN_COMMANDS.dismiss, args: [threadId], label: 'Dismiss', size: 'sm', title: 'Drop the proposal; nothing is written' });
}
