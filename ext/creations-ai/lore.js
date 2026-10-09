// lore.js — Creations AI: which lorebook entries a roleplay turn gets, pure.
//
// The owner asked (2026-10-09) for the AI to respect a world's lore without
// all of it living in every prompt. Before this, an entry was in the prompt
// only while one of its trigger words was in the last ten messages, matched
// as any substring ("rain" in "train"); an entry without a triggers line was
// never sent, though the code's comment and Inspect Last Context said it was
// always on (so a lorebook made from the New Lorebook template sent nothing);
// what did not fire was invisible, so the model invented over it; and an
// entry that overflowed the lane was cut mid-sentence.
//
// Now:
//   - Every entry the turn can see is either in full or in the index: one
//     line each ("Blackstone Keep: the Ashby family's ruined fortress"), so
//     the model knows every name and fact of the world and the prompt holds
//     only what the scene needs in full.
//   - An entry comes in full while one of its keys was said in its window
//     (the last `sticky` messages, 12 by default, so it stays a while after
//     it was last named). The keys are its `triggers:`; without that line,
//     its own heading.
//   - Keys match whole words (plural and possessive too); `elf*` matches
//     words starting with "elf".
//   - The text above the first `##` heading is the book's overview: always
//     in full, like `scope: always`.
//   - Packed against the room the lore really gets; an entry that does not
//     fit falls back to its index line, never cut.
//
// Format of an entry (each line under the heading optional, in any order):
//   ## Blackstone Keep
//   triggers: blackstone, the keep, fortress
//   summary: the Ashby family's ruined fortress above the river
//   scope: always | triggered | scene:<location/time/mood> | character:<name>
//   priority: 0..10   (higher comes first when room is short; default 5)
//   anti: words that keep it out
//   sticky: 12        (messages it stays after its key was last said; 0 = only while said)
//   The body...

/** Messages an entry stays in full after one of its keys was last said. */
export const DEFAULT_STICKY = 12;
/** Most messages any entry looks back over. */
export const MAX_STICKY = 60;
/** Words an index line keeps of an entry's first sentence. */
const SUMMARY_WORDS = 24;

const roughTokens = (t) => Math.ceil(String(t || '').length / 4);

function firstSentence(body) {
  const text = String(body || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*|__/g, '').trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l))
    .join(' ');
  const m = /^(.+?[.!?])(?:\s|$)/.exec(text);
  const s = (m ? m[1] : text).trim();
  const words = s.split(/\s+/).filter(Boolean);
  return words.length <= SUMMARY_WORDS ? s : `${words.slice(0, SUMMARY_WORDS).join(' ')}...`;
}

const METADATA = /^(triggers|keys|scope|priority|anti|anti-triggers|summary|sticky)\s*:\s*(.*)$/i;
const list = (v) => String(v || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

/**
 * A lorebook's entries. `{ heading, text, triggers, keys, scope, priority,
 * antiTriggers, sticky, summary, overview, book }`; `text` is the body
 * without the metadata lines. The overview is the text above the first `##`.
 */
export function parseLorebook(content, book = '') {
  let src = String(content || '').replace(/\r/g, '');
  src = src.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const chunks = src.split(/^## /m);
  const out = [];
  const preamble = chunks.shift() || '';
  const pre = preamble.trim();
  if (pre) {
    const title = /^#\s+(.+)$/m.exec(pre);
    const text = pre.replace(/^#\s+.+$/m, '').trim();
    if (text) out.push({ heading: title ? title[1].trim() : (book.replace(/\.md$/, '') || 'World'), text, triggers: null, keys: [], scope: 'always', priority: 5, antiTriggers: null, sticky: DEFAULT_STICKY, summary: firstSentence(text), overview: true, book });
  }
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const heading = lines[0].trim();
    if (!heading) continue;
    const e = { heading, text: '', triggers: null, keys: [], scope: 'triggered', priority: 5, antiTriggers: null, sticky: DEFAULT_STICKY, summary: '', overview: false, book };
    let i = 1;
    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = METADATA.exec(line);
      if (!m) break;
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === 'triggers' || key === 'keys') e.triggers = list(value);
      else if (key === 'scope') e.scope = value.toLowerCase() || 'triggered';
      else if (key === 'priority') { const n = parseInt(value, 10); if (Number.isFinite(n)) e.priority = Math.max(0, Math.min(10, n)); }
      else if (key === 'anti' || key === 'anti-triggers') e.antiTriggers = list(value);
      else if (key === 'summary') e.summary = value;
      else if (key === 'sticky') { const n = parseInt(value, 10); if (Number.isFinite(n)) e.sticky = Math.max(0, Math.min(MAX_STICKY, n)); }
    }
    e.text = lines.slice(i).join('\n').trim();
    // Without a triggers line, an entry is called by its own name.
    e.keys = e.triggers && e.triggers.length ? e.triggers : [heading.toLowerCase()];
    if (!e.summary) e.summary = firstSentence(e.text);
    out.push(e);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matcherCache = new Map();

/** Whether a key is said in a text: whole words, any case; plural and possessive count; `elf*` is a prefix. */
export function keySaid(key, text) {
  const k = String(key || '').trim().toLowerCase();
  if (!k || !text) return false;
  let re = matcherCache.get(k);
  if (!re) {
    const prefix = k.endsWith('*');
    const stem = escapeRe(prefix ? k.slice(0, -1).trim() : k).replace(/\s+/g, '\\s+');
    if (!stem) return false;
    re = new RegExp(`(?<![\\p{L}\\p{N}])${stem}${prefix ? '' : "(?:s|es|'s|’s)?(?![\\p{L}\\p{N}])"}`, 'iu');
    if (matcherCache.size > 2000) matcherCache.clear();
    matcherCache.set(k, re);
  }
  return re.test(text);
}

/**
 * What a turn sees of the lorebooks. `messages`: the chat's texts the AI may
 * see, oldest first; `userText`: what is being sent now. Each entry comes back
 * with a `state`: 'always' (scope: always, the overview), 'fired' (a key said
 * in its window; `hits`, `ago` messages back), 'index' (in brief), or
 * 'hidden' (an anti word was said, or its scene or character is not here).
 */
export function selectLore(books, { messages = [], userText = '', sceneState = null, presentCharNames = [] } = {}) {
  const texts = [...(Array.isArray(messages) ? messages : []).map((m) => String(m || '')), ...(userText ? [String(userText)] : [])];
  const sceneTags = [];
  if (sceneState && typeof sceneState === 'object') for (const k of ['location', 'time', 'mood']) if (sceneState[k]) sceneTags.push(String(sceneState[k]).toLowerCase());
  const present = presentCharNames.map((n) => String(n).toLowerCase());
  const out = [];
  let order = 0;
  for (const b of Array.isArray(books) ? books : []) {
    for (const entry of parseLorebook(b.content, b.fileName || '')) {
      const window = texts.slice(-Math.max(1, entry.sticky + 1)).join('\n');
      const item = { entry, state: 'index', hits: [], ago: null, order: order++ };
      out.push(item);
      if (entry.antiTriggers && entry.antiTriggers.some((k) => keySaid(k, window))) { item.state = 'hidden'; item.why = 'an anti word was said'; continue; }
      const scope = entry.scope || 'triggered';
      if (scope.startsWith('scene:')) {
        const want = scope.slice(6).trim();
        if (!want || !sceneTags.includes(want)) { item.state = 'hidden'; item.why = `not in the scene ${want}`; continue; }
        if (!entry.triggers || !entry.triggers.length) { item.state = 'always'; continue; }
      } else if (scope.startsWith('character:')) {
        const want = scope.slice(10).trim();
        if (!want || !present.includes(want)) { item.state = 'hidden'; item.why = `${want} is not in this chat`; continue; }
        if (!entry.triggers || !entry.triggers.length) { item.state = 'always'; continue; }
      } else if (scope === 'always') { item.state = 'always'; continue; }
      // Triggered: the newest message a key was said in, within the window.
      const span = texts.slice(-Math.max(1, entry.sticky + 1));
      for (let i = span.length - 1; i >= 0; i--) {
        const hits = entry.keys.filter((k) => keySaid(k, span[i]));
        if (hits.length) { item.state = 'fired'; item.hits = hits; item.ago = span.length - 1 - i; break; }
      }
    }
  }
  return out;
}

/** The order entries get the room in: priority, then always-on, then the most recently named. */
function rank(a, b) {
  if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority;
  const always = (x) => (x.state === 'always' ? 0 : 1);
  if (always(a) !== always(b)) return always(a) - always(b);
  if ((a.ago ?? 0) !== (b.ago ?? 0)) return (a.ago ?? 0) - (b.ago ?? 0);
  return a.order - b.order;
}

const LORE_RULE = 'These are facts of this world. Never contradict them, and bring them in when the story touches them.';
const INDEX_HEAD = 'Also in this world, in brief (the details come in when the story reaches them):';

/**
 * The lore for the prompt, within `budgetTokens`. In full: the always-on and
 * fired entries, by rank, while they fit; the rest, and what did not fit, as
 * index lines. Returns `{ text, full: [items], brief: [items], left }`
 * (`left`: index lines that did not fit either).
 */
export function renderLore(selection, budgetTokens = Infinity, { estimate = roughTokens } = {}) {
  const visible = (Array.isArray(selection) ? selection : []).filter((x) => x.state !== 'hidden');
  if (!visible.length || budgetTokens <= 0) return { text: '', full: [], brief: [], left: 0 };
  const bodyOf = (x) => `### ${x.entry.heading}${x.entry.text ? `\n${x.entry.text}` : ''}`;
  const lineOf = (x) => `- ${x.entry.heading}${x.entry.summary ? `: ${x.entry.summary.replace(/\s+/g, ' ')}` : ''}`;
  const wanted = visible.filter((x) => x.state === 'always' || x.state === 'fired').sort(rank);
  const rest = visible.filter((x) => x.state === 'index').sort((a, b) => (b.entry.priority - a.entry.priority) || (a.order - b.order));
  const ruleCost = estimate(LORE_RULE) + 2;
  const headCost = estimate(INDEX_HEAD) + 2;
  const bodyCost = (x) => estimate(bodyOf(x)) + 2;
  const lineCost = (x) => estimate(lineOf(x)) + 1;
  // Everything wanted in full, every other entry as a line; then, while over
  // the room, the lowest-ranked entry in full becomes a line (an entry that
  // came up keeps at least its line); then the last lines go, the least
  // important first.
  const full = [...wanted];
  let brief = [...rest];
  const total = () => ruleCost + full.reduce((n, x) => n + bodyCost(x), 0) + (brief.length ? headCost + brief.reduce((n, x) => n + lineCost(x), 0) : 0);
  while (full.length && total() > budgetTokens) brief.unshift(full.pop());
  let left = 0;
  // The "and N more" line takes room too.
  while (brief.length && total() + (left ? 4 : 0) > budgetTokens) { brief.pop(); left++; }
  if (!full.length && !brief.length) return { text: '', full, brief, left };
  const parts = [LORE_RULE];
  if (full.length) parts.push(full.map(bodyOf).join('\n\n'));
  if (brief.length) parts.push([INDEX_HEAD, ...brief.map(lineOf), ...(left ? [`- and ${left} more.`] : [])].join('\n'));
  return { text: parts.join('\n\n'), full, brief, left };
}

/** What Inspect Last Context shows: each entry, how it went in (or why not), from the real selection and render. */
export function loreReport(selection, render) {
  const fullSet = new Set((render?.full || []).map((x) => x.order));
  const briefSet = new Set((render?.brief || []).map((x) => x.order));
  const lines = [];
  for (const x of Array.isArray(selection) ? selection : []) {
    const where = `[${x.entry.book}] ${x.entry.heading}`;
    if (x.state === 'hidden') lines.push(`HIDDEN   ${where}  (${x.why})`);
    else if (fullSet.has(x.order)) lines.push(`IN FULL  ${where}  (${x.state === 'fired' ? `said: ${x.hits.join(', ')}${x.ago ? `, ${x.ago} message${x.ago === 1 ? '' : 's'} ago` : ''}` : x.entry.overview ? 'the book\'s overview' : 'always'})`);
    else if (briefSet.has(x.order)) lines.push(`IN BRIEF ${where}  (${x.state === 'index' ? `comes in full when someone says: ${x.entry.keys.join(', ')}` : 'no room in full'})`);
    else lines.push(`LEFT OUT ${where}  (no room, even in brief)`);
  }
  return lines;
}
