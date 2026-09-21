// chat-memory.js — Creations AI: the roleplay thread's memory, as one file.
//
// A thread's memory is `memories.md` beside its messages: Facts (what a
// later turn must not contradict, grouped), Timeline (one line per beat,
// append-only), Notes (whatever the user writes). The user opens it in the
// editor; the file is the source of truth, so a line removed by hand stays
// removed. The extractor that already runs every few exchanges merges what
// it finds into it, never overwriting a line.
//
// The summariser is gone. When the live window drops old turns, the prompt
// gets the Timeline's tail plus the dropped turns that matter to the
// current one, quoted verbatim with their turn numbers, ranked by the
// terms they share with what is being said now. No model call, no loss,
// nothing indexed anywhere: it is computed from the thread in memory.
//
// Pure: no DOM, no files. tests/unit/creationsChatMemory.test.ts.

export const MEMORY_CATEGORIES = ['relationship', 'trait', 'event', 'place', 'preference', 'other'];
const CATEGORY_LABEL = { relationship: 'Relationships', trait: 'Traits', event: 'Events', place: 'Places', preference: 'Preferences', other: 'Other' };
const LABEL_CATEGORY = Object.fromEntries(Object.entries(CATEGORY_LABEL).map(([k, v]) => [v.toLowerCase(), k]));

export const MEMORY_HEADER = '# Memory';
const FACTS_HEADING = '## Facts';
const TIMELINE_HEADING = '## Timeline';
const NOTES_HEADING = '## Notes';
const INTRO = [
  'What the story must not forget. Edit freely: a line you remove stays removed, a line you add is read on the next turn.',
  'Facts are grouped; the Timeline is one line per beat, oldest first; Notes are yours.',
].join('\n');

const normalise = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The file's text from its parts. */
export function renderMemoryMarkdown({ facts = [], beats = [], notes = '' } = {}) {
  const lines = [MEMORY_HEADER, '', INTRO, '', FACTS_HEADING, ''];
  const byCat = new Map();
  for (const f of facts) {
    const text = String(f && f.text || '').trim();
    if (!text) continue;
    const cat = MEMORY_CATEGORIES.includes(f.category) ? f.category : 'other';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(text);
  }
  let anyFact = false;
  for (const cat of MEMORY_CATEGORIES) {
    const items = byCat.get(cat);
    if (!items || items.length === 0) continue;
    anyFact = true;
    lines.push(`### ${CATEGORY_LABEL[cat]}`, ...items.map((t) => `- ${t}`), '');
  }
  if (!anyFact) lines.push('(nothing yet)', '');
  lines.push(TIMELINE_HEADING, '');
  const beatLines = beats.map((b) => String(b && (b.text || b) || '').trim()).filter(Boolean);
  lines.push(...(beatLines.length ? beatLines.map((t) => `- ${t}`) : ['(nothing yet)']), '');
  lines.push(NOTES_HEADING, '');
  lines.push(String(notes || '').trim() || '', '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Is this text the structured file (as opposed to the old free-text memories.md)? */
export function isMemoryMarkdown(text) {
  const t = String(text || '');
  return t.includes(FACTS_HEADING) && t.includes(TIMELINE_HEADING);
}

/** The parts from the file's text. Unknown lines under Facts count as "other"; anything outside the sections is Notes. */
export function parseMemoryMarkdown(text) {
  const out = { facts: [], beats: [], notes: '' };
  const src = String(text || '').replace(/\r/g, '');
  if (!isMemoryMarkdown(src)) { out.notes = src.trim(); return out; }
  let section = null;
  let category = 'other';
  const notes = [];
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    if (line === FACTS_HEADING) { section = 'facts'; category = 'other'; continue; }
    if (line === TIMELINE_HEADING) { section = 'timeline'; continue; }
    if (line === NOTES_HEADING) { section = 'notes'; continue; }
    if (line.startsWith('# ') || line.startsWith('## ')) { section = null; continue; }
    if (section === 'facts') {
      const h = line.match(/^###\s+(.+)$/);
      if (h) { category = LABEL_CATEGORY[h[1].trim().toLowerCase()] || 'other'; continue; }
      const b = line.match(/^\s*[-*]\s+(.+)$/);
      if (b && b[1].trim() !== '(nothing yet)') out.facts.push({ category, text: b[1].trim() });
      continue;
    }
    if (section === 'timeline') {
      const b = line.match(/^\s*[-*]\s+(.+)$/);
      if (b && b[1].trim() !== '(nothing yet)') out.beats.push({ text: b[1].trim() });
      continue;
    }
    if (section === 'notes') notes.push(line);
  }
  out.notes = notes.join('\n').trim();
  return out;
}

/** New facts and beats folded into the parts, without touching a line that is already there. */
export function mergeMemory(parts, { facts = [], beats = [] } = {}) {
  const seen = new Set(parts.facts.map((f) => normalise(f.text)));
  const outFacts = [...parts.facts];
  for (const f of facts) {
    const text = String(f && f.text || '').trim();
    const key = normalise(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    outFacts.push({ category: MEMORY_CATEGORIES.includes(f.category) ? f.category : 'other', text });
  }
  const seenBeats = new Set(parts.beats.map((b) => normalise(b.text)));
  const outBeats = [...parts.beats];
  for (const b of beats) {
    const text = String(b && (b.text || b) || '').trim();
    const key = normalise(text);
    if (!text || !key || seenBeats.has(key)) continue;
    seenBeats.add(key);
    outBeats.push({ text });
  }
  return { facts: outFacts, beats: outBeats, notes: parts.notes || '' };
}

/** The old shape (free text plus two JSON logs) as parts, once, when a thread is first opened with this code. */
export function memoryFromLegacy({ notes = '', semantic = [], episodic = [] } = {}) {
  const facts = semantic.filter((e) => e && typeof e.text === 'string').map((e) => ({ category: e.category, text: e.text }));
  const beats = episodic.filter((e) => e && typeof (e.text || e.summary) === 'string').map((e) => ({ text: e.text || e.summary }));
  return mergeMemory({ facts: [], beats: [], notes: String(notes || '').trim() }, { facts, beats });
}

// ── Retrieval: the dropped turns that matter now, verbatim ──────────────────

const STOP = new Set('a an the and or but of to in on at for with by from as is are was were be been being it its this that these those i you he she they we me him her them us my your his their our not no yes do does did have has had so if then than too very just can could would should will may might there here what when where who whom which why how all any some such into out up down over under again also about'.split(' '));

function terms(text) {
  const out = [];
  for (const w of normalise(text).split(' ')) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.push(w.length > 5 && w.endsWith('s') ? w.slice(0, -1) : w);
  }
  return out;
}

/**
 * Rank `candidates` (the turns outside the live window, oldest first, each
 * { turn, name, content }) against `query` and return the top `k` in story
 * order. BM25 over shared terms: names, places and objects said now pull
 * the turns that said them before. Turns already in the window are not
 * candidates; the caller passes only what was dropped.
 */
export function rankExcerpts(candidates, query, k = 5, { minScore = 1.0 } = {}) {
  const q = [...new Set(terms(query))];
  if (q.length === 0 || candidates.length === 0) return [];
  const docs = candidates.map((c) => terms(c.content || ''));
  const n = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / n || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const k1 = 1.4, b = 0.6;
  const scored = candidates.map((c, i) => {
    const d = docs[i];
    if (d.length === 0) return { c, score: 0 };
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avgLen));
    }
    return { c, score };
  });
  return scored
    .filter((s) => s.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .sort((x, y) => x.c.turn - y.c.turn)
    .map((s) => s.c);
}

const RULE = 'If a detail of the setting, of an object, of who is where, or of what happened is not in the scene, the memory or these turns, do not invent it: leave it unsaid, or have a character ask.';

/**
 * The system message that stands in for the dropped turns: the Timeline's
 * tail and the quoted turns, each within a character budget, and the rule.
 */
export function earlierBlock({ beats = [], excerpts = [], maxBeats = 25, maxExcerptChars = 900 } = {}) {
  const parts = ['[Earlier in the story.'];
  const tail = beats.slice(-maxBeats).map((b) => String(b && (b.text || b) || '').trim()).filter(Boolean);
  if (tail.length) parts.push('', 'Timeline so far:', ...tail.map((t) => `- ${t}`));
  if (excerpts.length) {
    parts.push('', 'Earlier turns quoted word for word, because they bear on what is being said now:');
    for (const e of excerpts) {
      const body = String(e.content || '').trim();
      const clipped = body.length > maxExcerptChars ? `${body.slice(0, maxExcerptChars).replace(/\s+\S*$/, '')}...` : body;
      parts.push(`(turn ${e.turn}${e.name ? `, ${e.name}` : ''}) ${clipped}`);
    }
  }
  parts.push('', RULE + ']');
  return parts.join('\n');
}

export function memoryRule() { return RULE; }
