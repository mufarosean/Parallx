// acts.js — Creations AI: an act is a plot brief the AI runs as turns.
//
// The director steers one turn at a time; a story is many. An act is the
// player's brief for a stretch of it ("her childhood in a small town, ages
// 13 to 18, the moments that shaped her") that the model turns into a beat
// sheet: one line per turn, each with its speaker, chosen per beat (the
// Narrator for a new scene, a time skip, an arrival or an event; a character
// for a move; the player when the brief wants them to act). The sheet is a
// file beside the thread, act.md, edited in the editor like memories.md,
// and read fresh when the act runs. Running is the chat's own turn, beat by
// beat, through the same pipeline as a typed "/ai @Name note": memory,
// scene state and latitude all keep working. A beat for the player pauses
// the run until they write; the run ends at the last beat, on Stop, or
// when a turn fails. Pure: the prompts, the file, the reading. The chat
// runs the turns (acts-panel.js drives it).

import { parseJsonLoose, stripDashes } from './studio-core.js';
import { NARRATOR, directionCommand } from './director.js';

export const ACT_FILE = 'act.md';
/** The most beats one act may hold: past it a run is a story written without the player. */
export const MAX_BEATS = 24;
const DEFAULT_BEATS = 8;
/** How the player is named on a beat that is theirs. */
export const YOU = 'You';

const clip = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim() + '...';
};

/** "about 6 turns", "8 beats", "in ten turns" inside a brief, else the default. */
export function beatsAskedFor(brief) {
  const m = /\b(\d{1,2})\s*(?:turns?|beats?|scenes?)\b/i.exec(String(brief || ''));
  const n = m ? Number(m[1]) : DEFAULT_BEATS;
  return Math.min(MAX_BEATS, Math.max(2, n));
}

/**
 * The messages that turn a brief into a beat sheet.
 *   brief: the player's text
 *   cast: [{ name, tagline, drives }] — who can take a turn
 *   player: { name, plays } — the player's name, and the cast name they play ('' as themselves)
 *   others: [{ name, note }] — supporting cast and people in their lives
 *   scene, memory, transcript, rules: as the director takes them
 */
export function buildActPlanMessages({ brief, cast = [], player = { name: 'You', plays: '' }, others = [], scene = null, memory = {}, transcript = [], rules = '' } = {}) {
  const n = beatsAskedFor(brief);
  const names = cast.map((c) => c.name);
  const playerLabel = player.plays ? `${YOU} (the player, who plays ${player.plays})` : `${YOU} (the player, ${player.name})`;
  const system = [
    'You plan one act of an ongoing roleplay as a beat sheet: one line per turn, in order, each turn by one speaker.',
    'The speakers:',
    `- ${NARRATOR}: a new scene, a time skip, an arrival, an event. Present tense, says what happens and where the story now stands, never what anyone says or feels. Open with the Narrator whenever the place or the time changes; a span of years is several Narrator time skips with character turns between them.`,
    `- A character from the cast (${names.join(', ') || 'none'}): what they do next, one sentence starting with a verb, naming something concrete. Their wants, secrets and history shape the beat; the beat never names a value or a feeling.`,
    `- ${playerLabel}: only when the brief wants the player to act; write what the moment asks of them, not their words. The run pauses there for them to write.`,
    `Write ${n} beats unless the brief needs fewer. Each beat follows from the one before and moves the act on; together they cover the whole brief and no more. Keep what the memory says true. Never settle the story's central question unless the brief asks for it; never end the story.`,
    'Never use em dashes or en dashes.',
    'Answer with the beats only, one per line, numbered, in exactly this form and nothing else:',
    '1. <Speaker>: <one sentence> || <what it sets in motion, at most twelve words>',
  ].join('\n');

  const parts = [`The brief for this act:\n${String(brief || '').trim()}`];
  const castLines = cast.map((c) => `- ${c.name}${c.tagline ? `: ${clip(c.tagline, 160)}` : ''}${c.drives ? ` Wants: ${clip(c.drives, 220)}` : ''}`);
  if (castLines.length) parts.push(`Cast:\n${castLines.join('\n')}`);
  const otherLines = (others || []).filter((o) => o && o.name).slice(0, 8).map((o) => `- ${o.name}${o.note ? `: ${clip(o.note, 160)}` : ''}`);
  if (otherLines.length) parts.push(`Others in their world, who can come in:\n${otherLines.join('\n')}`);
  const facts = (memory.facts || []).map((f) => f && f.text).filter(Boolean).slice(-30);
  if (facts.length) parts.push(`Memory, what is true now:\n${facts.map((f) => `- ${clip(f, 200)}`).join('\n')}`);
  const beats = (memory.beats || []).map((b) => b && b.text).filter(Boolean).slice(-12);
  if (beats.length) parts.push(`Story so far:\n${beats.map((b) => `- ${clip(b, 200)}`).join('\n')}`);
  const sceneBits = scene && typeof scene === 'object' ? [scene.location, scene.time, scene.mood].filter(Boolean) : [];
  if (sceneBits.length) parts.push(`Now: ${sceneBits.join(', ')}`);
  if (rules && String(rules).trim()) parts.push(`How people talk in this story:\n${clip(rules, 600)}`);
  const turns = (transcript || []).filter((m) => m && m.content).slice(-6).map((m) => `${m.name || 'Someone'}: ${clip(m.content, 500)}`).join('\n\n');
  if (turns) parts.push(`The last turns, oldest first:\n${turns}`);
  parts.push(`Write the ${n} beats.`);
  return [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
}

/** Between a beat and what it sets in motion. */
const THEN_SPLIT = /\s*(?:\|\||\s\|\s|=>|->|→)\s*/;

/**
 * Who a beat's speaker label names: { kind: 'narrator' | 'character' |
 * 'you', name } against the cast names and the player.
 */
export function resolveBeatSpeaker(label, { names = [], player = { name: '', plays: '' } } = {}) {
  const t = String(label || '').trim().replace(/^[*_]+|[*_]+$/g, '').trim();
  const low = t.toLowerCase();
  if (!low) return null;
  if (low === 'narrator' || low === 'nar') return { kind: 'narrator', name: NARRATOR };
  const pName = String(player.name || '').toLowerCase();
  const plays = String(player.plays || '').toLowerCase();
  if (low === 'you' || low === 'me' || low === 'player' || low === 'the player' || (pName && low === pName)) return { kind: 'you', name: YOU };
  const exact = names.find((n) => n.toLowerCase() === low);
  const first = exact || names.find((n) => n.split(/\s+/)[0].toLowerCase() === low && names.filter((m) => m.split(/\s+/)[0].toLowerCase() === low).length === 1);
  if (first) return first.toLowerCase() === plays ? { kind: 'you', name: YOU, as: first } : { kind: 'character', name: first };
  return null;
}

/**
 * Beat lines, from the model's reply or the act file, into
 * [{ speaker, kind, note, then }]. Numbering, bullets and bold are
 * tolerated; a speaker nobody in the chat matches becomes the Narrator's,
 * with the name kept at the front of the note; a line with no "Speaker:"
 * is skipped. At most MAX_BEATS.
 */
export function parseBeats(text, { names = [], player = { name: '', plays: '' } } = {}) {
  const out = [];
  const src = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\*\*|__/g, '').replace(/^\s*(?:[-*•>]|\d+[.)])\s+/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0 || colon > 40) continue;
    const label = line.slice(0, colon).trim();
    const rest = stripDashes(line.slice(colon + 1)).trim();
    if (!rest) continue;
    const [noteRaw, thenRaw] = rest.split(THEN_SPLIT);
    const who = resolveBeatSpeaker(label, { names, player });
    const note = (who ? noteRaw : `${label} ${noteRaw}`).trim().replace(/\.$/, '');
    out.push({ speaker: who ? who.name : NARRATOR, kind: who ? who.kind : 'narrator', ...(who && who.as ? { as: who.as } : {}), note, then: (thenRaw || '').trim().replace(/\.$/, '') });
    if (out.length >= MAX_BEATS) break;
  }
  return out;
}

/** The act file: the brief as the heading, the beats as a numbered list. */
export function renderActFile(brief, beats = []) {
  const lines = [
    `# ${clip(brief, 400) || 'An act'}`,
    '',
    '> One beat per line, "Speaker: what happens || what it sets in motion". The Narrator moves the story (a new scene, a time skip, an arrival, an event); a character acts; "You:" pauses for you to write. Edit freely; the run reads this file.',
    '',
    ...beats.map((b, i) => `${i + 1}. ${b.speaker}: ${b.note}${b.then ? ` || ${b.then}` : ''}`),
    '',
  ];
  return lines.join('\n');
}

/** The act file read back: { brief, beats }. Quoted lines (">") are notes, never beats. */
export function parseActFile(text, ctx = {}) {
  const src = String(text || '');
  const head = /^#\s+(.+)$/m.exec(src);
  const brief = head ? head[1].trim() : '';
  const body = (head ? src.slice(head.index + head[0].length) : src).split('\n').filter((l) => !l.trim().startsWith('>')).join('\n');
  return { brief, beats: parseBeats(body, ctx) };
}

/**
 * The turn a beat asks for: { speaker, instruction } for the chat's
 * generateTurn, with the beat set in its act so the model keeps the arc.
 * `speaker` is the Narrator sentinel, a character file, or null for the
 * player's own beat.
 */
export function beatTurn(beat, index, total, brief, { narratorSpeaker, fileFor } = {}) {
  const where = `Beat ${index + 1} of ${total} of this act (${clip(brief, 200)}).`;
  const instruction = `${beat.note}${beat.then ? ` (${beat.then})` : ''}. ${where}`;
  if (beat.kind === 'you') return { speaker: null, instruction: beat.note };
  if (beat.kind === 'narrator') return { speaker: narratorSpeaker, instruction };
  return { speaker: fileFor ? fileFor(beat.speaker) : beat.speaker, instruction };
}

/** The composer text for a beat, as a typed direction would be. */
export function beatCommand(beat) {
  return directionCommand(beat.kind === 'narrator' ? NARRATOR : beat.speaker, beat.note);
}

/** One line for the memory Timeline when an act ends. */
export function actTimelineLine(brief, ranBeats) {
  return `An act ran (${ranBeats} ${ranBeats === 1 ? 'turn' : 'turns'}): ${clip(brief, 160)}`;
}

/** The messages that propose the next act's brief from where the story stands. */
export function buildNextActMessages({ cast = [], memory = {}, transcript = [], lastBrief = '' } = {}) {
  const system = [
    'You propose the next act of an ongoing roleplay to its player: a brief of one to three sentences that says where the story goes next and what it covers, concrete and specific to these people, following from where things stand. Not a plot twist for its own sake; what these people would do next, and what it costs. Name the span when time passes.',
    'Never settle the story\'s central question. Never use em dashes or en dashes.',
    'Answer with JSON only: {"brief": "..."}',
  ].join('\n');
  const parts = [];
  const castLines = cast.map((c) => `- ${c.name}${c.tagline ? `: ${clip(c.tagline, 160)}` : ''}${c.drives ? ` Wants: ${clip(c.drives, 220)}` : ''}${c.secrets ? ` Hides: ${clip(c.secrets, 160)}` : ''}`);
  if (castLines.length) parts.push(`Cast:\n${castLines.join('\n')}`);
  const facts = (memory.facts || []).map((f) => f && f.text).filter(Boolean).slice(-30);
  if (facts.length) parts.push(`Memory, what is true now:\n${facts.map((f) => `- ${clip(f, 200)}`).join('\n')}`);
  const beats = (memory.beats || []).map((b) => b && b.text).filter(Boolean).slice(-16);
  if (beats.length) parts.push(`Story so far:\n${beats.map((b) => `- ${clip(b, 200)}`).join('\n')}`);
  if (lastBrief) parts.push(`The last act's brief:\n${clip(lastBrief, 400)}`);
  const turns = (transcript || []).filter((m) => m && m.content).slice(-6).map((m) => `${m.name || 'Someone'}: ${clip(m.content, 500)}`).join('\n\n');
  if (turns) parts.push(`The last turns, oldest first:\n${turns}`);
  parts.push('Propose the next act.');
  return [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
}

/** The proposed brief from the reply ('' when none). */
export function parseNextAct(raw) {
  const data = parseJsonLoose(raw);
  return data && typeof data.brief === 'string' ? stripDashes(data.brief).trim() : '';
}

/** The act's state line for the panel. */
export function actStatusLine(act) {
  if (!act || !act.brief) return 'No act yet. Write one in the message box: /act followed by the brief.';
  const n = Array.isArray(act.beats) ? act.beats.length : 0;
  switch (act.status) {
    case 'running': return `Running: beat ${Math.min(n, (act.index || 0) + 1)} of ${n}.`;
    case 'waiting': return `Your turn: ${act.beats && act.beats[act.index] ? act.beats[act.index].note : 'write what happens'}. The act goes on after you send.`;
    case 'done': return `Done: ${n} ${n === 1 ? 'beat' : 'beats'} ran.`;
    case 'stopped': return `Stopped at beat ${(act.index || 0) + 1} of ${n}. Run goes on from there.`;
    default: return n ? `Planned: ${n} ${n === 1 ? 'beat' : 'beats'}. Edit act.md, then Run.` : 'Planning…';
  }
}
