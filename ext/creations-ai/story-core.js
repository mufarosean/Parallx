// story-core.js — Creations AI: the Story Writer's pure half.
//
// A story is a brief (premise, genre, setting, cast, style, point of view,
// tense, an author's note the model sees every turn) and a run of beats,
// grouped into chapters, with a Story Memory that summarises what has
// happened so the model stays consistent past its context. This file holds
// the shapes, the prompts, the context budget and the Markdown export. No
// DOM, no model, no files: tests/unit/creationsStory.test.ts covers it.

import { sheetFromCharacter, stripDashes, collapseWhitespace, countWords } from './studio-core.js';

export const POVS = [
  { value: 'first', label: 'First Person', rule: 'first person, from inside the point-of-view character' },
  { value: 'third-limited', label: 'Third Person, Close', rule: 'third person, close on one character at a time, only what they can know' },
  { value: 'third-omniscient', label: 'Third Person, Omniscient', rule: 'third person, omniscient, moving between minds with intent' },
  { value: 'second', label: 'Second Person', rule: 'second person, addressing the reader as the point-of-view character' },
];
export const TENSES = [
  { value: 'past', label: 'Past', rule: 'past tense' },
  { value: 'present', label: 'Present', rule: 'present tense' },
];
export const BEAT_LENGTHS = [
  { value: 'short', label: 'Short', words: 150 },
  { value: 'medium', label: 'Medium', words: 350 },
  { value: 'long', label: 'Long', words: 700 },
];

export function emptyBrief() {
  return { premise: '', genre: '', setting: '', cast: [], style: '', pov: 'third-limited', tense: 'past', authorsNote: '', beatLength: 'medium' };
}

export function newStory(id, now = Date.now()) {
  return { id, title: '', brief: emptyBrief(), chapters: [{ id: 'ch-1', title: 'Chapter 1' }], beats: [], memory: '', memoryAt: 0, createdAt: now, updatedAt: now };
}

/** Everything a beat needs to know about a cast member, kept short. */
export function castEntryFromCharacter(fileName, data) {
  const sheet = sheetFromCharacter(data);
  const firstParagraph = (sheet.description || '').split(/\n\s*\n/)[0] || '';
  return {
    fileName,
    name: sheet.name || data?.name || 'Unnamed',
    tagline: sheet.tagline || '',
    portrait: clip(firstParagraph, 600),
    voice: clip(sheet.voice || '', 400),
    drives: clip(sheet.drives || '', 300),
  };
}

function clip(text, max) {
  const t = collapseWhitespace(text);
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}...`;
}

export function castBlock(cast) {
  if (!cast || cast.length === 0) return '';
  return cast.map((c) => {
    const lines = [`${c.name}${c.tagline ? `, ${c.tagline}` : ''}`];
    if (c.portrait) lines.push(c.portrait);
    if (c.voice) lines.push(`Voice: ${c.voice}`);
    if (c.drives) lines.push(`Drives: ${c.drives}`);
    return lines.join('\n');
  }).join('\n\n');
}

export function briefBlock(brief) {
  const pov = POVS.find((p) => p.value === brief.pov) || POVS[1];
  const tense = TENSES.find((t) => t.value === brief.tense) || TENSES[0];
  const lines = [];
  if (brief.premise) lines.push(`Premise: ${brief.premise.trim()}`);
  if (brief.genre) lines.push(`Genre: ${brief.genre.trim()}`);
  if (brief.setting) lines.push(`Setting: ${brief.setting.trim()}`);
  if (brief.style) lines.push(`Style: ${brief.style.trim()}`);
  lines.push(`Point of view: ${pov.rule}.`);
  lines.push(`Tense: ${tense.rule}.`);
  return lines.join('\n');
}

export function beatLengthWords(brief) {
  return (BEAT_LENGTHS.find((b) => b.value === brief.beatLength) || BEAT_LENGTHS[1]).words;
}

/** The most recent beats that fit the budget, oldest first. A rewrite excludes the beat being rewritten. */
export function beatsForContext(beats, maxChars = 9000, excludeId = null) {
  const out = [];
  let used = 0;
  for (let i = beats.length - 1; i >= 0; i--) {
    const b = beats[i];
    if (excludeId && b.id === excludeId) continue;
    const len = (b.text || '').length + 2;
    if (used + len > maxChars && out.length > 0) break;
    out.unshift(b);
    used += len;
  }
  return out;
}

const NO_DASHES = 'Never use em dashes or en dashes. Use commas, periods or ellipses.';

/**
 * One beat. `mode` is 'continue' (the next beat) or 'rewrite' (the beat
 * `target` again, differently). `instruction` steers this beat only.
 */
export function buildBeatMessages({ story, instruction = '', mode = 'continue', target = null, maxContextChars = 9000 }) {
  const brief = story.brief || emptyBrief();
  const words = beatLengthWords(brief);
  const system = [
    'You are a novelist writing one story in beats. Each beat is a stretch of finished prose that continues the story exactly where it stands: no recap, no summary, no headings, no notes to the reader, no questions about what to write next.',
    'Write in the point of view and tense given. Keep every character consistent with their portrait and voice. Show, do not explain. Concrete detail over adjectives. Dialogue carries character.',
    `A beat runs about ${words} words, not more than ${Math.round(words * 1.5)}, and ends at a natural pause, not a cliffhanger sentence and not a moral.`,
    NO_DASHES,
    '',
    'THE BRIEF',
    briefBlock(brief),
    castBlock(brief.cast) ? `\nTHE CAST\n${castBlock(brief.cast)}` : '',
    brief.authorsNote ? `\nAUTHOR'S NOTE (holds for every beat)\n${brief.authorsNote.trim()}` : '',
    story.memory ? `\nSTORY MEMORY (what has happened so far; never contradict it)\n${story.memory.trim()}` : '',
  ].filter((l) => l !== '').join('\n');

  const recent = beatsForContext(story.beats, maxContextChars, mode === 'rewrite' && target ? target.id : null);
  const parts = [];
  if (recent.length > 0) {
    parts.push('THE STORY SO FAR (the most recent beats, verbatim):', '', ...recent.map((b) => b.text.trim()), '');
  } else if (mode !== 'rewrite') {
    parts.push('The story has not begun. This beat opens it: arrive inside a scene, in motion, no throat-clearing.', '');
  }
  if (mode === 'rewrite' && target) {
    parts.push('REWRITE THIS BEAT. Same place in the story, the same events, a different telling: open differently, notice things in a different order, bring in details the first take did not have, and let no sentence of the first take survive, even reworded:', '', target.text.trim(), '');
    parts.push(instruction.trim() ? `How it should change: ${instruction.trim()}` : 'Make it better: sharper, more specific, truer to the characters.');
  } else {
    parts.push('Write the next beat.');
    if (instruction.trim()) parts.push(`Direction for this beat: ${instruction.trim()}`);
  }
  parts.push('', 'Return the prose only.');
  return [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n') }];
}

/** Update the Story Memory from the beats since it was last written. */
export function buildMemoryMessages(story, sinceIndex = 0) {
  const brief = story.brief || emptyBrief();
  const fresh = story.beats.slice(Math.max(0, sinceIndex));
  const system = [
    'You keep the memory of a story for its writer: a compact, factual record of what has happened, so later beats never contradict earlier ones.',
    'Write it as short plain statements grouped under these headings: Where things stand. What has happened. Open threads. Facts established (names, places, objects, rules of the world, who knows what).',
    'Keep everything from the existing memory that is still true; fold in the new beats; drop nothing important; no prose, no opinions, no em dashes.',
    'Only what a later beat could need: names, places, objects, promises, injuries, who knows what. Not every detail of every scene. Nothing the beats did not say. Under 200 words in all.',
    'Return ONLY a JSON object: {"memory": "..."}.',
  ].join('\n');
  const user = [
    `Story: ${story.title || 'Untitled'}`,
    brief.premise ? `Premise: ${brief.premise.trim()}` : '',
    '',
    'EXISTING MEMORY:',
    story.memory.trim() || '(none yet)',
    '',
    'NEW BEATS SINCE THEN:',
    '',
    ...fresh.map((b) => b.text.trim()),
  ].filter((l) => l !== undefined).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** Clean a beat the model wrote: dashes out, stray headings and quotes off the edges. */
export function cleanBeat(text) {
  let t = stripDashes(String(text || ''));
  t = t.replace(/^\s*(#+\s*.*|\*\*[^*]+\*\*)\s*\n/, '');
  t = t.replace(/^```[a-z]*\s*|```\s*$/g, '');
  return t.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function storyWords(story) {
  return story.beats.reduce((n, b) => n + countWords(b.text), 0);
}

export function chapterBeats(story, chapterId) {
  return story.beats.filter((b) => b.chapterId === chapterId);
}

/** The whole story as Markdown: a title, a heading per chapter, beats as paragraphs. */
export function storyMarkdown(story) {
  const lines = [`# ${story.title || 'Untitled'}`, ''];
  const chapters = story.chapters.length ? story.chapters : [{ id: null, title: '' }];
  for (const ch of chapters) {
    const beats = story.beats.filter((b) => (ch.id ? b.chapterId === ch.id : true));
    if (chapters.length > 1 || ch.title) lines.push(`## ${ch.title || 'Chapter'}`, '');
    for (const b of beats) lines.push(b.text.trim(), '');
  }
  return lines.join('\n').trim() + '\n';
}

export function storyFileName(story) {
  const base = (story.title || 'story').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'story';
  return `${base}.md`;
}
