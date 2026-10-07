// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: THE PURE MODEL
// ═══════════════════════════════════════════════════════════════════════════════
//
// Nothing here touches _api, the DOM, the database or Date.now(): `now` is an
// argument, randomness is an `rng` argument. Every function is exported
// through __testables (90-activate.js) and tested in tests/unit/studyModel
// and studyImport. Shapes are the §4 ones of docs/STUDY_BUILD_SPEC.md.

// ── Mastery and state ──────────────────────────────────────────────────────────

/** Mastery below this is weak. */
const ST_WEAK_BELOW = 0.6;
/** How fast one answer moves mastery, by format class: a typed answer is
 *  stronger evidence than a recognised option. */
const ST_ALPHA_TYPE = 0.5;
const ST_ALPHA_CHOOSE = 0.35;
/** Concept state ranks, the draw order. */
const ST_STATE_RANK = { unasked: 0, weak: 1, stale: 2, clean: 3 };

/**
 * A concept's state at `now`: unasked (never answered), weak (mastery under
 * the threshold), stale (clean, but not answered for staleDays), clean.
 */
function stConceptState(concept, now, { staleDays = 14 } = {}) {
  const c = concept || {};
  if (!(Number(c.answers) > 0)) return 'unasked';
  if ((Number(c.mastery) || 0) < ST_WEAK_BELOW) return 'weak';
  const days = Number.isFinite(Number(staleDays)) ? Number(staleDays) : 14;
  const last = Number(c.lastAnsweredAt) || 0;
  if (now - last > days * DAY) return 'stale';
  return 'clean';
}

/** 'choose' for multiple choice, 'type' for everything answered by typing. */
function stFormatClass(format) {
  return format === 'mc' ? 'choose' : 'type';
}

/** Has the concept been answered right once in this class? */
function stConceptIsCleanIn(concept, formatClass) {
  const c = concept || {};
  return formatClass === 'choose' ? (Number(c.rightChooseAt) || 0) > 0 : (Number(c.rightTypeAt) || 0) > 0;
}

/**
 * Fold one answer into a concept (a pure copy). The target mastery of the
 * answer is 1 for a right or Good/Easy answer, 0.5 for Hard, 0 for wrong;
 * a retried right counts 0 (the first try was the evidence). The concept
 * moves a fraction alpha of the way to the target: 0.5 for a typed answer,
 * 0.35 for a chosen one. A right first try stamps the class's clean marker.
 */
function stApplyAnswer(concept, { correct, rating, formatUsed, retried } = {}, now) {
  const c = { ...(concept || {}) };
  const typed = ST_TYPED.has(formatUsed);
  const r = Number(rating) || 0;
  const right = typeof correct === 'boolean' ? correct : r >= GOOD;
  let target;
  if (retried) target = 0;
  else if (typed && r > 0) target = r >= GOOD ? 1 : r === HARD ? 0.5 : 0;
  else target = right ? 1 : 0;
  const alpha = typed ? ST_ALPHA_TYPE : ST_ALPHA_CHOOSE;
  const mastery = Number(c.mastery) || 0;
  c.mastery = Math.max(0, Math.min(1, mastery + alpha * (target - mastery)));
  c.answers = (Number(c.answers) || 0) + 1;
  if (right) {
    c.missStreak = 0;
    if (!retried) {
      if (stFormatClass(formatUsed) === 'choose') c.rightChooseAt = now;
      else c.rightTypeAt = now;
    }
  } else {
    c.misses = (Number(c.misses) || 0) + 1;
    c.missStreak = (Number(c.missStreak) || 0) + 1;
  }
  c.lastAnsweredAt = now;
  return c;
}

/** Mastery written back from a Flashcards rating: Again halves it, Hard trims it. */
function stMasteryFromCardRating(mastery, rating) {
  const m = Number(mastery) || 0;
  const r = Number(rating) || 0;
  if (r === AGAIN) return m * 0.5;
  if (r === HARD) return m * 0.85;
  return m;
}

/**
 * The format an item is answered in. Essay and numeric are always their
 * own. 'choose' keeps mc as mc and leaves the others as they are; 'type'
 * turns an mc question into a short one (its answer text is the model
 * answer); 'mixed' is mc until the concept is clean in choose, then typed.
 */
function stResolveFormat(concept, question, answerFormat) {
  const own = ST_FORMATS.includes(question?.format) ? question.format : 'short';
  if (own === 'essay' || own === 'numeric') return own;
  if (own !== 'mc') return own;
  if (answerFormat === 'choose') return 'mc';
  if (answerFormat === 'type') return 'short';
  if (answerFormat === 'mixed') return stConceptIsCleanIn(concept, 'choose') ? 'short' : 'mc';
  return 'mc';
}

/** Which class of question a concept should be offered under an answer format. */
function stPreferredClass(concept, answerFormat) {
  if (answerFormat === 'choose') return 'choose';
  if (answerFormat === 'type') return 'type';
  if (answerFormat === 'mixed') return stConceptIsCleanIn(concept, 'choose') ? 'type' : 'choose';
  return 'choose';
}

/** Fisher-Yates on a copy, driven by `rng` (a function returning [0, 1)). */
function stShuffle(items, rng) {
  const out = [...items];
  const random = typeof rng === 'function' ? rng : Math.random;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/** Order concepts for a draw: unasked, weak (lowest mastery first), stale,
 *  clean (oldest answer first). Ties keep the incoming order. */
function stOrderConcepts(concepts, now, opts) {
  const keyed = concepts.map((c, i) => ({ c, i, state: stConceptState(c, now, opts) }));
  keyed.sort((a, b) => {
    const ra = ST_STATE_RANK[a.state], rb = ST_STATE_RANK[b.state];
    if (ra !== rb) return ra - rb;
    if (a.state === 'weak') {
      const d = (Number(a.c.mastery) || 0) - (Number(b.c.mastery) || 0);
      if (d) return d;
    }
    if (a.state === 'clean') {
      const d = (Number(a.c.lastAnsweredAt) || 0) - (Number(b.c.lastAnsweredAt) || 0);
      if (d) return d;
    }
    return a.i - b.i;
  });
  return keyed.map((k) => k.c);
}

/**
 * Draw a session's questions from the bank.
 *
 * Candidates are the questions not hidden, not excluded (already in the
 * session), whose concept is in scope. Concepts go unasked, weak (lowest
 * mastery first), stale, clean (oldest first); each concept gives one
 * question per round until every concept has one, then a second round. The
 * question a concept gives first is of the class stResolveFormat would pick
 * for it (mc while a mixed concept is not yet clean, typed after). Within a
 * round, picks alternate across materials so no two consecutive questions
 * share a material while more than one still has candidates. Deterministic
 * given `rng`: it only breaks ties among equal concepts and equal questions.
 */
function stDrawSession({ questions = [], concepts = [], size = 20, exclude, answerFormat = 'mixed', now = 0, rng, staleDays } = {}) {
  const limit = Math.max(0, Math.floor(Number(size) || 0));
  if (!limit) return [];
  const excluded = exclude instanceof Set ? exclude : new Set(Array.isArray(exclude) ? exclude : []);
  const byConcept = new Map();
  for (const c of concepts) if (c && c.id != null) byConcept.set(c.id, c);
  const pool = new Map();
  for (const q of questions) {
    if (!q || q.hidden || excluded.has(q.id)) continue;
    if (!byConcept.has(q.conceptId)) continue;
    if (!pool.has(q.conceptId)) pool.set(q.conceptId, []);
    pool.get(q.conceptId).push(q);
  }
  if (!pool.size) return [];

  const opts = { staleDays: staleDays ?? 14 };
  const ordered = stOrderConcepts(stShuffle([...byConcept.values()].filter((c) => pool.has(c.id)), rng), now, opts);
  // Each concept's questions: the preferred class first, ties in rng order.
  const queues = new Map();
  for (const c of ordered) {
    const want = stPreferredClass(c, answerFormat);
    const shuffled = stShuffle(pool.get(c.id), rng);
    const preferred = shuffled.filter((q) => stFormatClass(q.format) === want);
    const rest = shuffled.filter((q) => stFormatClass(q.format) !== want);
    queues.set(c.id, preferred.concat(rest));
  }

  const out = [];
  let lastMaterial = null;
  for (let round = 0; out.length < limit; round++) {
    // This round's pick per concept, grouped by material in concept order.
    const perMaterial = new Map();
    for (const c of ordered) {
      const q = queues.get(c.id)[round];
      if (!q) continue;
      const m = q.materialId ?? c.materialId ?? 0;
      if (!perMaterial.has(m)) perMaterial.set(m, []);
      perMaterial.get(m).push(q);
    }
    if (!perMaterial.size) break;
    const materials = [...perMaterial.keys()];
    let cursor = 0;
    for (;;) {
      if (out.length >= limit) break;
      const live = materials.filter((m) => perMaterial.get(m).length > 0);
      if (!live.length) break;
      let chosen = -1;
      for (let k = 0; k < materials.length; k++) {
        const idx = (cursor + k) % materials.length;
        const m = materials[idx];
        if (!perMaterial.get(m).length) continue;
        if (m === lastMaterial && live.length > 1) continue;
        chosen = idx;
        break;
      }
      if (chosen === -1) chosen = materials.indexOf(live[0]);
      const m = materials[chosen];
      out.push(perMaterial.get(m).shift());
      lastMaterial = m;
      cursor = chosen + 1;
    }
  }
  return out;
}

/** Counts of concept states at `now`, with each concept's state in order. */
function stCoverage(concepts, now, opts) {
  const list = Array.isArray(concepts) ? concepts : [];
  const states = list.map((c) => stConceptState(c, now, opts || {}));
  const out = { total: list.length, clean: 0, weak: 0, unasked: 0, stale: 0, states };
  for (const s of states) out[s]++;
  return out;
}

/**
 * Tally a session's items: right, wrong, skipped, answered, and the missed
 * list (one entry per wrong item). `secondMiss` marks an item whose concept
 * was already missed earlier in the session, or whose concept is on a miss
 * streak of two or more. Items carry conceptId, or a question with one.
 */
function stSessionSummary(items, concepts) {
  const byId = new Map();
  for (const c of concepts || []) if (c && c.id != null) byId.set(c.id, c);
  const out = { right: 0, wrong: 0, skipped: 0, answered: 0, missed: [] };
  const seenMiss = new Set();
  for (const it of items || []) {
    if (!it) continue;
    const status = it.status;
    if (status === 'right') out.right++;
    else if (status === 'wrong') out.wrong++;
    else if (status === 'skipped') out.skipped++;
    if (status !== 'wrong') continue;
    const conceptId = it.conceptId ?? it.question?.conceptId ?? 0;
    const concept = byId.get(conceptId);
    const secondMiss = seenMiss.has(conceptId) || (Number(concept?.missStreak) || 0) >= 2;
    seenMiss.add(conceptId);
    const verdict = typeof it.verdict === 'string' ? (stExtractJsonObject(it.verdict) || {}) : (it.verdict || {});
    out.missed.push({ conceptId, questionId: it.questionId ?? it.question?.id ?? 0, note: String(verdict.note || ''), secondMiss });
  }
  out.answered = out.right + out.wrong;
  return out;
}

/** Reorder so no two consecutive items share a materialId when avoidable. Stable otherwise. */
function stInterleaveMaterials(items) {
  const rest = [...(items || [])];
  const out = [];
  let last;
  while (rest.length) {
    let idx = rest.findIndex((it) => (it?.materialId ?? 0) !== last);
    if (idx < 0 || out.length === 0) idx = 0;
    const it = rest.splice(idx, 1)[0];
    out.push(it);
    last = it?.materialId ?? 0;
  }
  return out;
}

// ── Context planning and chunking ──────────────────────────────────────────────
// Ported from Flashcards (fcContextPlan): the constants and the arithmetic are
// the same, only the output reserve is passed in directly instead of being
// derived from a card count.

const ST_CHARS_PER_TOKEN = 2.5;
const ST_PROMPT_HEADROOM = 1.08;
const ST_SCAFFOLD_TOKENS = 600;
const ST_FALLBACK_MODEL_CTX = 131072;

/**
 * The context window for one request: enough for prompt and output,
 * rounded up to 2048, clamped to the model's real length. `setting` > 0 is
 * the user's fixed window; `maxChars` is how much material fits under it.
 */
function stContextPlan({ chars = 0, outputTokens = 2000, modelCtx = 0, setting = 0 } = {}) {
  const out = Math.max(256, Math.floor(Number(outputTokens) || 2000));
  const ceiling = modelCtx > 0 ? modelCtx : ST_FALLBACK_MODEL_CTX;
  let numCtx;
  if (Number.isFinite(setting) && setting > 0) {
    numCtx = Math.min(setting, ceiling);
  } else {
    const needed = Math.ceil(((Number(chars) || 0) / ST_CHARS_PER_TOKEN) * ST_PROMPT_HEADROOM) + ST_SCAFFOLD_TOKENS + out;
    numCtx = Math.min(ceiling, Math.max(8192, Math.ceil(needed / 2048) * 2048));
  }
  const maxChars = Math.max(4000, Math.floor(((numCtx - ST_SCAFFOLD_TOKENS - out) * ST_CHARS_PER_TOKEN) / ST_PROMPT_HEADROOM));
  return { numCtx, maxChars, outputTokens: out };
}

/**
 * Split a page range into chunks of whole pages, each at most maxChars
 * (a single page longer than that is a chunk of its own, never cut).
 * Each chunk's text tags its pages so the model can cite them.
 */
function stChunkPages(pageTexts, { from, to, maxChars = 12000 } = {}) {
  const pages = Array.isArray(pageTexts) ? pageTexts : [];
  if (!pages.length) return [];
  const first = Math.max(1, Math.min(Number(from) || 1, pages.length));
  const last = Math.max(first, Math.min(Number(to) || pages.length, pages.length));
  const cap = Math.max(1, Number(maxChars) || 12000);
  const chunks = [];
  let cur = null;
  const flush = () => { if (cur) { chunks.push({ pageFrom: cur.pageFrom, pageTo: cur.pageTo, text: cur.parts.join('\n\n') }); cur = null; } };
  for (let p = first; p <= last; p++) {
    const text = String(pages[p - 1] || '').trim();
    const block = `[Page ${p}]\n${text}`;
    if (cur && cur.length + block.length + 2 > cap) flush();
    if (!cur) cur = { pageFrom: p, pageTo: p, parts: [], length: 0 };
    cur.parts.push(block);
    cur.pageTo = p;
    cur.length += block.length + 2;
  }
  flush();
  return chunks;
}

// ── Anchoring ──────────────────────────────────────────────────────────────────
// A port of src/services/quoteLocator.ts (Study cannot import from src/):
// only letters and digits are compared, lower-cased, NFKC-folded, so
// extraction's line breaks, hyphenation, ligatures and quote styles do not
// matter.

const ST_KEEP_CHAR = /[\p{L}\p{N}]/u;
/** Shortest quote skeleton that can be anchored fuzzily. */
const ST_MIN_SKELETON = 12;
/** Similarity at or above which a garbled page still anchors a quote. */
const ST_ANCHOR_THRESHOLD = 0.9;

/** Lower-cased letters and digits only, NFKC-folded. */
function stSkeleton(text) {
  const source = String(text ?? '');
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code < 128) {
      if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) out += source[i];
      else if (code >= 65 && code <= 90) out += String.fromCharCode(code + 32);
      continue;
    }
    const cp = source.codePointAt(i) ?? code;
    const width = cp > 0xffff ? 2 : 1;
    const folded = String.fromCodePoint(cp).normalize('NFKC').toLowerCase();
    for (const ch of folded) if (ST_KEEP_CHAR.test(ch)) out += ch;
    i += width - 1;
  }
  return out;
}

/** Trigram counts of a skeleton. */
function stTrigramCounts(s) {
  const counts = new Map();
  for (let i = 0; i + 3 <= s.length; i++) {
    const g = s.slice(i, i + 3);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  return counts;
}

/**
 * Is the quote on the page? Exact skeleton substring first (similarity 1);
 * otherwise the best window of the page skeleton, by trigram overlap (Dice
 * over multisets, slid one character at a time), must reach 0.9. Quotes
 * shorter than 12 letters and digits only anchor exactly.
 */
function stAnchorOnPage(quote, pageText) {
  const needle = stSkeleton(quote);
  const hay = stSkeleton(pageText);
  if (!needle || !hay) return { ok: false, similarity: 0 };
  if (hay.includes(needle)) return { ok: true, similarity: 1 };
  if (needle.length < ST_MIN_SKELETON) return { ok: false, similarity: 0 };
  const m = needle.length;
  const needleGrams = stTrigramCounts(needle);
  const needleTotal = m - 2;
  if (hay.length <= m) {
    const hayGrams = stTrigramCounts(hay);
    let inter = 0;
    for (const [g, n] of needleGrams) inter += Math.min(n, hayGrams.get(g) || 0);
    const sim = (2 * inter) / (needleTotal + Math.max(1, hay.length - 2));
    return { ok: sim >= ST_ANCHOR_THRESHOLD, similarity: sim };
  }
  // Slide a window of the needle's length across the page, keeping the
  // multiset intersection up to date as one trigram enters and one leaves.
  const window = new Map();
  let inter = 0;
  const add = (g) => {
    const have = window.get(g) || 0;
    if (have < (needleGrams.get(g) || 0)) inter++;
    window.set(g, have + 1);
  };
  const remove = (g) => {
    const have = window.get(g) || 0;
    if (have <= (needleGrams.get(g) || 0)) inter--;
    window.set(g, have - 1);
  };
  for (let i = 0; i + 3 <= m; i++) add(hay.slice(i, i + 3));
  let best = inter;
  for (let start = 1; start + m <= hay.length; start++) {
    remove(hay.slice(start - 1, start + 2));
    add(hay.slice(start + m - 3, start + m));
    if (inter > best) best = inter;
    if (best === needleTotal) break;
  }
  const similarity = best / needleTotal;
  return { ok: similarity >= ST_ANCHOR_THRESHOLD, similarity };
}

/** The 1-based page a quote is on: the hint first, then its neighbours, then every page. 0 when none. */
function stFindAnchorPage(quote, pageTexts, hintPage) {
  const pages = Array.isArray(pageTexts) ? pageTexts : [];
  if (!pages.length) return 0;
  const hint = Math.floor(Number(hintPage) || 0);
  const order = [];
  const seen = new Set();
  const push = (p) => { if (p >= 1 && p <= pages.length && !seen.has(p)) { seen.add(p); order.push(p); } };
  if (hint >= 1) {
    push(hint);
    for (let d = 1; d <= 2; d++) { push(hint - d); push(hint + d); }
  }
  for (let p = 1; p <= pages.length; p++) push(p);
  for (const p of order) if (stAnchorOnPage(quote, pages[p - 1]).ok) return p;
  return 0;
}

// ── Headings and sections ──────────────────────────────────────────────────────

const ST_FALLBACK_SECTION_PAGES = 8;

/** "Pages 3–10" (en dash), or "Page 3" for one page. */
function stPagesLabel(a, b) {
  return a === b ? `Page ${a}` : `Pages ${a}–${b}`;
}

/**
 * One line as a heading candidate, or null. A heading is short (at most
 * 80 characters, 12 words), starts "3. Title", "3.1 Title", "Chapter 3",
 * "CHAPTER 3 Title", "Section 4", and does not read as a sentence (no
 * terminal punctuation) or a contents line (dot leaders, a page number).
 */
function stHeadingOfLine(rawLine) {
  const line = String(rawLine || '').replace(/\s+/g, ' ').trim();
  if (!line || line.length > 80) return null;
  if (/\.{3,}/.test(line)) return null;
  if (/[.,;:]$/.test(line)) return null;
  if (line.split(' ').length > 12) return null;
  // A title that reads as a sentence start, a formula or a contents line
  // ("Introduction ........ 45", "Methods 5") is not a heading.
  const titleOk = (t) => /^[\p{L}(]/u.test(t) && (t.match(/\p{L}/gu) || []).length >= 2 && !/\s\d{1,4}$/.test(t);
  let m = /^(\d{1,3})\.\s+(\S.*)$/.exec(line);
  if (m && titleOk(m[2])) return { title: line, level: 1, kind: 'number', number: Number(m[1]) };
  m = /^(\d{1,3}(?:\.\d{1,3})+)\.?\s+(\S.*)$/.exec(line);
  if (m && titleOk(m[2])) return { title: line, level: m[1].split('.').length, kind: 'number', number: 0 };
  m = /^(chapter|part|appendix|section)\s+(\d{1,3}(?:\.\d{1,3})*|[IVXLC]{1,6}|[A-Z])\b\s*[.:-]?\s*(.*)$/i.exec(line);
  if (m) {
    const rest = m[3].trim();
    if (rest && !titleOk(rest)) return null;
    const word = m[1].toLowerCase();
    return { title: line, level: word === 'section' ? 2 : 1, kind: word, number: 0 };
  }
  return null;
}

/**
 * The heading candidates of one page, minus what reads as a list rather
 * than headings: a run of three or more "1. ...", "2. ...", "3. ..." lines
 * numbered from 1 (exercises, steps), and a page of six or more candidates
 * (a contents page).
 */
function stPageHeadings(pageText) {
  const found = [];
  for (const line of String(pageText || '').replace(/\r\n?/g, '\n').split('\n')) {
    const h = stHeadingOfLine(line);
    if (h) found.push(h);
  }
  const kept = [];
  for (let i = 0; i < found.length; i++) {
    const h = found[i];
    if (h.kind === 'number' && h.level === 1 && h.number === 1) {
      let run = 1;
      while (i + run < found.length && found[i + run].kind === 'number' && found[i + run].level === 1 && found[i + run].number === run + 1) run++;
      if (run >= 3) { i += run - 1; continue; }
    }
    kept.push(h);
  }
  return kept.length >= 6 ? [] : kept;
}

/** Page ranges for headings in page order: each runs to the page before the
 *  next heading of its level or above (contiguous, never past pageCount). */
function stRangesFor(entries, pageCount) {
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let pageTo = pageCount;
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].level <= e.level) { pageTo = Math.max(e.page, entries[j].page - 1); break; }
    }
    out.push({ title: e.title, pageFrom: e.page, pageTo: Math.max(e.page, Math.min(pageCount, pageTo)), level: e.level });
  }
  if (out.length && out[0].pageFrom > 1) {
    out.unshift({ title: stPagesLabel(1, out[0].pageFrom - 1), pageFrom: 1, pageTo: out[0].pageFrom - 1, level: 1 });
  }
  return out;
}

/** Every 8 pages, "Pages a–b". */
function stFallbackSections(pageCount) {
  const out = [];
  for (let a = 1; a <= pageCount; a += ST_FALLBACK_SECTION_PAGES) {
    const b = Math.min(pageCount, a + ST_FALLBACK_SECTION_PAGES - 1);
    out.push({ title: stPagesLabel(a, b), pageFrom: a, pageTo: b, level: 1 });
  }
  return out;
}

/**
 * Sections from the page texts when the PDF has no outline: numbered and
 * chapter headings at line starts, the first occurrence of each (running
 * headers repeat on every page), minus what reads as a list or a contents
 * page (stPageHeadings). Fewer than two headings: every eight pages,
 * "Pages a–b".
 */
function stHeadingsFromPages(pageTexts) {
  const pages = Array.isArray(pageTexts) ? pageTexts : [];
  if (!pages.length) return [];
  const entries = [];
  const seen = new Set();
  let sawChapter = false;
  for (let p = 1; p <= pages.length; p++) {
    for (const h of stPageHeadings(pages[p - 1])) {
      const key = stSkeleton(h.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (h.kind === 'chapter' || h.kind === 'part' || h.kind === 'appendix') sawChapter = true;
      entries.push({ title: h.title, page: p, level: h.level, kind: h.kind });
    }
  }
  if (!sawChapter) for (const e of entries) if (e.kind === 'section') e.level = 1;
  if (entries.length < 2) return stFallbackSections(pages.length);
  return stRangesFor(entries, pages.length);
}

/** Sections from a PDF outline [{title, page, level}]: the same ranges. */
function stSectionsFromOutline(outline, pageCount) {
  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (!total || !Array.isArray(outline)) return [];
  const entries = [];
  for (const o of outline) {
    const page = Math.floor(Number(o?.page) || 0);
    const title = String(o?.title || '').replace(/\s+/g, ' ').trim();
    if (!title || page < 1 || page > total) continue;
    entries.push({ title, page, level: Math.max(1, Math.floor(Number(o.level) || 1)) });
  }
  entries.sort((a, b) => a.page - b.page);
  return stRangesFor(entries, total);
}

// ── JSON from a model ──────────────────────────────────────────────────────────
// Ports of the Flashcards extractors (fcRepairLatexEscapes, fcExtractJsonArray,
// fcExtractJsonObject): think-block and fence stripping, a string-aware
// bracket walk over every candidate, and the LaTeX escape repair before the
// strict parse. Copied because local models answer the same way here.

function stRepairLatexEscapes(slice) {
  let out = '';
  let inStr = false;
  let inMath = false;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (!inStr) {
      if (ch === '"') { inStr = true; inMath = false; }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = false; out += ch; continue; }
    if (ch === '$') {
      if (slice[i + 1] === '$') { out += '$$'; i++; } else { out += ch; }
      inMath = !inMath;
      continue;
    }
    if (ch !== '\\') { out += ch; continue; }
    const next = slice[i + 1] ?? '';
    if (next === '\\' || next === '"' || next === '/') {
      out += ch + next; i++;
    } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(slice.slice(i + 2, i + 6))) {
      out += ch + next; i++;
    } else if ('bfnrt'.includes(next)) {
      const after = slice[i + 2] ?? '';
      if (inMath && /[a-zA-Z]/.test(after)) {
        out += '\\\\' + next; i++;
      } else {
        out += ch + next; i++;
      }
    } else {
      out += '\\\\';
    }
  }
  return out;
}

/**
 * Find and parse a JSON array in raw model output. `mapSlice(parsedArray)`
 * turns one candidate into items (null rejects it); the default keeps the
 * array. Returns { items, error, truncated }; items is [] on failure.
 */
function stExtractJsonArray(text, mapSlice) {
  const map = typeof mapSlice === 'function' ? mapSlice : (a) => a;
  if (typeof text !== 'string' || !text.trim()) return { items: [], error: 'Empty response.', truncated: false };
  let t = text.trim();
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/^[\s\S]*?<\/think>/i, '');
  t = t.replace(/```(?:json)?/gi, '');

  const parseSlice = (slice) => {
    let parsed;
    try { parsed = JSON.parse(stRepairLatexEscapes(slice)); }
    catch {
      try { parsed = JSON.parse(slice); } catch { return null; }
    }
    if (!Array.isArray(parsed)) return null;
    return map(parsed);
  };

  let sawArray = false, unterminated = false;
  let start = t.indexOf('[');
  let attempts = 0;
  while (start !== -1 && attempts < 8) {
    attempts++;
    let depth = 0, curly = 0, end = -1, inStr = false, escape = false, lastObjEnd = -1;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') curly++;
      else if (ch === '}') {
        curly--;
        if (depth === 1 && curly === 0) lastObjEnd = i;
      } else if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) {
      if (lastObjEnd > start) {
        const items = parseSlice(t.slice(start, lastObjEnd + 1) + ']');
        if (items !== null && items.length > 0) return { items, error: null, truncated: true };
      }
      unterminated = true;
      break;
    }
    const items = parseSlice(t.slice(start, end + 1));
    if (items !== null) {
      sawArray = true;
      if (items.length > 0) return { items, error: null, truncated: false };
    }
    start = t.indexOf('[', start + 1);
  }
  if (unterminated) return { items: [], error: 'Unterminated JSON array. The response may have been cut off.', truncated: true };
  if (sawArray) return { items: [], error: 'No usable items in response.', truncated: false };
  return { items: [], error: 'No JSON array in response.', truncated: false };
}

/** The first top-level JSON object in raw model output, or null. */
function stExtractJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const t = text.trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .replace(/```(?:json)?/gi, '');
  let start = t.indexOf('{');
  let attempts = 0;
  while (start !== -1 && attempts < 8) {
    attempts++;
    let depth = 0, end = -1, inStr = false, escape = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return null;
    const slice = t.slice(start, end + 1);
    let parsed = null;
    try { parsed = JSON.parse(stRepairLatexEscapes(slice)); }
    catch { try { parsed = JSON.parse(slice); } catch { parsed = null; } }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    start = t.indexOf('{', start + 1);
  }
  return null;
}

// ── Grading ────────────────────────────────────────────────────────────────────
// A port of the Flashcards M102 grader (fcNormalizeRubric, fcSerializeRubric,
// fcNormalizeVerdict, fcScoreVerdict, fcMapVerdictToRating), thresholds
// identical: the model only says, per rubric point, hit, partial or miss, and
// this code turns that into a rating, so identical answers grade alike and
// the thresholds are testable without a model.

const ST_RUBRIC_MAX_POINTS = 12;
const ST_RUBRIC_POINT_MAX_CHARS = 400;
const ST_POINT_STATUSES = ['hit', 'partial', 'miss'];
/** Score at or above which an incomplete answer still reads as Good
 *  (2 of 3 and 3 of 4 pass; 1 of 2 and 3 of 5 do not). */
const ST_GRADE_GOOD_FLOOR = 0.65;
const ST_RATING_WORDS = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** A rubric as stored: [{text, required}]. Strings, objects, or a JSON string in. */
function stNormalizeRubric(raw) {
  const v = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return []; } })()
    : raw;
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    const text = String(
      (item && typeof item === 'object' ? (item.text ?? item.point ?? item.item ?? '') : item) ?? '',
    ).replace(/\s+/g, ' ').trim().slice(0, ST_RUBRIC_POINT_MAX_CHARS);
    if (!text) continue;
    const required = (item && typeof item === 'object' && item.required !== undefined) ? !!item.required : true;
    out.push({ text, required });
    if (out.length >= ST_RUBRIC_MAX_POINTS) break;
  }
  return out;
}

/** Stored form: '' for an empty rubric, so `= ''` reads as absent. */
function stSerializeRubric(points) {
  const norm = stNormalizeRubric(points);
  return norm.length ? JSON.stringify(norm) : '';
}

/** Coerce a model's judgement into a StVerdict: points positional to the rubric, short arrays padded with misses. */
function stNormalizeVerdict(raw, rubric) {
  const src = typeof raw === 'string' ? (stExtractJsonObject(raw) || {}) : (raw || {});
  const points = stNormalizeRubric(rubric);
  const rawPoints = Array.isArray(src.points) ? src.points : [];
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = rawPoints[i];
    const statusRaw = String(
      (p && typeof p === 'object' ? (p.status ?? p.verdict ?? p.result ?? '') : p) ?? '',
    ).trim().toLowerCase();
    const status = ST_POINT_STATUSES.includes(statusRaw) ? statusRaw
      : statusRaw === 'yes' || statusRaw === 'true' ? 'hit'
        : 'miss';
    out.push({
      status,
      note: String((p && typeof p === 'object' ? p.note ?? p.reason ?? '' : '') || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    });
  }
  return {
    points: out,
    contradiction: !!(src.contradiction ?? src.contradicts ?? src.contradictsSource),
    note: String(src.note ?? src.feedback ?? src.comment ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
  };
}

/** Score a verdict against its rubric: a partial counts half. */
function stScoreVerdict(verdict, rubric) {
  const points = stNormalizeRubric(rubric);
  const total = points.length;
  if (!total) return { score: 0, hits: 0, partials: 0, misses: 0, requiredMisses: 0, requiredMissed: false, gaps: 0, total: 0 };
  let hits = 0, partials = 0, misses = 0, requiredMisses = 0;
  for (let i = 0; i < total; i++) {
    const status = verdict?.points?.[i]?.status || 'miss';
    if (status === 'hit') hits++;
    else if (status === 'partial') partials++;
    else {
      misses++;
      if (points[i].required) requiredMisses++;
    }
  }
  return {
    score: (hits + 0.5 * partials) / total,
    hits, partials, misses, total,
    requiredMisses,
    requiredMissed: requiredMisses > 0,
    gaps: misses + partials,
  };
}

/** Verdict to 1..4, or null without a rubric. A contradiction outranks the score. */
function stMapVerdictToRating(verdict, rubric) {
  const s = stScoreVerdict(verdict, rubric);
  if (!s.total) return null;
  if (verdict?.contradiction) return AGAIN;
  if (s.score < 0.5) return AGAIN;
  if (s.requiredMisses >= 2) return HARD;
  if (s.requiredMisses === 1) return (s.gaps === 1 && s.score >= ST_GRADE_GOOD_FLOOR) ? GOOD : HARD;
  if (s.score >= 1 && s.partials === 0) return s.total >= 2 ? EASY : GOOD;
  return s.score >= ST_GRADE_GOOD_FLOOR ? GOOD : HARD;
}

const ST_NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function stNumberWord(n) {
  return ST_NUMBER_WORDS[n] ?? String(n);
}

/** The verdict line: Complete, "Two of three", Not quite, Contradicts the source. */
function stVerdictLabel(verdict, rubric) {
  const s = stScoreVerdict(verdict, rubric);
  if (verdict?.contradiction) return 'Contradicts the source';
  if (!s.total) return 'Not quite';
  if (s.hits === s.total) return 'Complete';
  const rating = stMapVerdictToRating(verdict, rubric);
  if (rating === AGAIN) return 'Not quite';
  const got = stNumberWord(s.hits);
  return `${got.charAt(0).toUpperCase()}${got.slice(1)} of ${stNumberWord(s.total)}`;
}

function stRatingWord(rating) {
  return ST_RATING_WORDS[Number(rating)] || '';
}

// ── Formula, numeric and cloze answers ─────────────────────────────────────────

/** Normalise a formula for comparison. A port of the Flashcards path: only
 *  free notation goes (spacing, delimiters, \left/\right, $) and a few pure
 *  synonyms are unified; it is not a computer algebra system. */
function stNormalizeFormula(s) {
  return String(s || '')
    .replace(/\$+/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[,;:!]/g, '')
    .replace(/\\(?:cdot|times)\b/g, '*')
    .replace(/\\(?:mathrm|mathit|text|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\s+/g, '')
    .replace(/\{([A-Za-z0-9])\}/g, '$1')
    .trim();
}

/** Exact-after-normalisation formula match. */
function stFormulaMatches(a, b) {
  const na = stNormalizeFormula(a);
  return !!na && na === stNormalizeFormula(b);
}

/**
 * The first number in a typed answer: "1,234.5", "12.5%", "$1.2M", "(150)"
 * (negative), "3.2e-4". Returns { value, percent } or null.
 */
function stParseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? { value: input, percent: false } : null;
  let s = String(input ?? '').trim();
  if (!s) return null;
  s = s.replace(/[−–]/g, '-');
  let negative = false;
  const paren = /^\(\s*([^()]*)\s*\)$/.exec(s);
  if (paren) { negative = true; s = paren[1]; }
  const m = /-?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.replace(/[$€£¥]/g, ''));
  if (!m) return null;
  let value = Number(m[0].replace(/[\s,]/g, ''));
  if (!Number.isFinite(value)) return null;
  const after = s.replace(/[$€£¥]/g, '').slice(m.index + m[0].length);
  const suffix = /^\s*([kKmMbB])\b/.exec(after);
  const percent = /^\s*%/.test(after);
  if (suffix && !percent) {
    const f = suffix[1].toLowerCase();
    value *= f === 'k' ? 1e3 : f === 'm' ? 1e6 : 1e9;
  }
  if (negative) value = -Math.abs(value);
  return { value, percent };
}

function stClose(a, b, tolerance) {
  const tol = Number.isFinite(Number(tolerance)) && Number(tolerance) >= 0 ? Number(tolerance) : 0.005;
  if (Math.abs(b) < 1e-9) return Math.abs(a - b) <= 1e-9;
  return Math.abs(a - b) <= tol * Math.abs(b);
}

/** Does a typed number match the expected one within a relative tolerance (absolute 1e-9 near zero)? */
function stNumericMatches(answer, expected, tolerance) {
  const a = stParseNumber(answer);
  const e = stParseNumber(expected);
  if (!a || !e) return false;
  if (stClose(a.value, e.value, tolerance)) return true;
  // A percent sign on one side only: 12.5% is 0.125 and also "12.5".
  if (a.percent !== e.percent) {
    const ac = a.percent ? a.value / 100 : a.value;
    const ec = e.percent ? e.value / 100 : e.value;
    return stClose(ac, ec, tolerance);
  }
  return false;
}

/** Case, whitespace, punctuation and leading articles folded. */
function stFoldTerm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:the|a|an) /, '');
}

/** Does a fill-in answer match the term or one of its aliases? */
function stClozeMatches(answer, term, aliases) {
  const a = stFoldTerm(answer);
  if (!a) return false;
  const targets = [term].concat(Array.isArray(aliases) ? aliases : []).map(stFoldTerm).filter(Boolean);
  return targets.includes(a);
}

// ── Questions as the model writes them ─────────────────────────────────────────

/** An mc answer as an index: a number, a numeric string, a letter A..E, or the option's text. */
function stOptionIndex(answer, options) {
  if (typeof answer === 'number' && Number.isInteger(answer)) return answer;
  const s = String(answer ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (/^[A-Ea-e]$/.test(s)) return s.toUpperCase().charCodeAt(0) - 65;
  const i = options.findIndex((o) => stFoldTerm(o) === stFoldTerm(s));
  return i;
}

/**
 * Shape check of a model-written question (the §6 JSON) into a StQuestion
 * ready to insert, or a reason to drop it. For cloze the aliases are kept
 * in `options`. The page may be missing (the anchor check finds it).
 */
function stValidateQuestion(raw, { choices = 4 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not an object' };
  const format = String(raw.format || '').trim().toLowerCase();
  if (!ST_FORMATS.includes(format)) return { ok: false, reason: 'unknown format' };
  const stem = String(raw.stem ?? raw.question ?? '').replace(/\s+/g, ' ').trim();
  if (!stem) return { ok: false, reason: 'empty stem' };
  const quote = String(raw.quote ?? raw.sourceQuote ?? '').trim();
  if (!quote) return { ok: false, reason: 'no quote' };
  const page = Math.floor(Number(raw.page ?? raw.sourcePage) || 0);
  const difficultyRaw = String(raw.difficulty || '').trim().toLowerCase();
  const difficulty = ['easy', 'medium', 'hard'].includes(difficultyRaw) ? difficultyRaw : '';
  const explanation = String(raw.explanation || '').replace(/\s+/g, ' ').trim();
  const question = {
    materialId: 0, conceptId: 0, format, stem,
    options: [], answer: '', explanation,
    rubric: [], rubricOrigin: '', contradictions: [], numeric: null,
    sourcePage: page > 0 ? page : 0, sourceQuote: quote, sourceUri: '',
    origin: 'generated', originLabel: '', providerId: '', providerRef: '', bankId: 0,
    checks: { anchor: null, support: null, distractor: null, numeric: null },
    difficulty, hidden: 0, edited: 0,
  };
  if (format === 'mc') {
    const want = Math.max(2, Math.floor(Number(choices) || 4));
    const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o ?? '').replace(/\s+/g, ' ').trim()) : [];
    if (options.length !== want) return { ok: false, reason: `expected ${want} options, got ${options.length}` };
    if (options.some((o) => !o)) return { ok: false, reason: 'empty option' };
    if (new Set(options.map(stFoldTerm)).size !== options.length) return { ok: false, reason: 'duplicate options' };
    const idx = stOptionIndex(raw.answer, options);
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return { ok: false, reason: 'answer out of range' };
    question.options = options;
    question.answer = String(idx);
    return { ok: true, question };
  }
  if (format === 'short' || format === 'essay') {
    const answer = String(raw.answer ?? '').trim();
    if (!answer) return { ok: false, reason: 'empty answer' };
    question.answer = answer;
    question.rubric = stNormalizeRubric(raw.rubric);
    question.rubricOrigin = question.rubric.length ? 'source' : '';
    return { ok: true, question };
  }
  if (format === 'numeric') {
    const expected = stParseNumber(raw.expected ?? raw.answer);
    if (!expected) return { ok: false, reason: 'expected value is not a number' };
    const solutionPy = String(raw.solutionPy ?? raw.solution_py ?? '');
    if (!/def\s+solve\s*\(/.test(solutionPy)) return { ok: false, reason: 'solution is not a solve() function' };
    const inputs = raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs) ? raw.inputs : {};
    const tolerance = Number(raw.tolerance);
    question.answer = String(expected.value);
    question.numeric = {
      inputs, solutionPy, expected: expected.value,
      units: String(raw.units || '').trim(),
      tolerance: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : null,
      executed: false, agreed: null,
    };
    return { ok: true, question };
  }
  if (format === 'formula') {
    const answer = String(raw.answer ?? '').trim();
    if (!stNormalizeFormula(answer)) return { ok: false, reason: 'empty formula' };
    question.answer = answer;
    return { ok: true, question };
  }
  // cloze
  const term = String(raw.answer ?? raw.term ?? '').replace(/\s+/g, ' ').trim();
  if (!term) return { ok: false, reason: 'empty term' };
  if (!/_{3,}/.test(stem)) return { ok: false, reason: 'stem has no blank' };
  question.answer = term;
  question.options = (Array.isArray(raw.aliases) ? raw.aliases : []).map((a) => String(a ?? '').trim()).filter(Boolean);
  return { ok: true, question };
}

/** The distractor checks to run: each wrong option alone with the stem. */
function stDistractorPrompts(question) {
  if (!question || question.format !== 'mc' || !Array.isArray(question.options)) return [];
  const answer = Number(question.answer);
  const out = [];
  question.options.forEach((option, optionIndex) => {
    if (optionIndex === answer) return;
    out.push({ optionIndex, stem: question.stem, option });
  });
  return out;
}

// ── Import: question files ─────────────────────────────────────────────────────

/** Strip a BOM and normalise line endings. */
function stCleanText(text) {
  return String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

const ST_IMPORT_KEYS = {
  question: 'question', q: 'question', stem: 'question', prompt: 'question',
  answer: 'answer', a: 'answer', solution: 'answer',
  rubric: 'rubric', points: 'rubric',
  paper: 'paper', source: 'source', exam: 'exam', sitting: 'sitting', number: 'number', part: 'part',
  kind: 'kind', format: 'kind', type: 'kind', options: 'options', label: 'label',
};

/** The imported format from a kind word. */
function stImportFormat(kind) {
  const k = String(kind || '').trim().toLowerCase();
  if (k === 'short') return 'short';
  if (k === 'mc' || k === 'multiple choice' || k === 'multiple-choice' || k === 'choice') return 'mc';
  if (k === 'numeric' || k === 'quant' || k === 'calc' || k === 'calculation' || k === 'number') return 'numeric';
  if (k === 'formula') return 'formula';
  return 'essay';
}

/** A hand-written point: a trailing "(optional)" or "(supporting)" marks it not required (the Flashcards line format). */
function stImportPoint(line) {
  const text = String(line ?? '').replace(/^\s*[-*•]\s*/, '').trim();
  const m = /^(.*?)\s*\((?:optional|supporting)\)\s*$/i.exec(text);
  return m ? { text: m[1].trim(), required: false } : { text, required: true };
}

/** Rubric points from a file value: an array, "a | b | c", or bullet lines. */
function stImportRubric(value) {
  if (Array.isArray(value)) return stNormalizeRubric(value.map((v) => (typeof v === 'string' ? stImportPoint(v) : v)));
  const s = String(value ?? '').trim();
  if (!s) return [];
  if (s.startsWith('[')) { try { return stImportRubric(JSON.parse(s)); } catch { /* a plain point */ } }
  if (s.includes('|')) return stNormalizeRubric(s.split('|').map(stImportPoint));
  if (s.includes('\n')) return stNormalizeRubric(s.split('\n').map(stImportPoint));
  return stNormalizeRubric([stImportPoint(s)]);
}

/** Options from a file value: an array or "a | b | c". */
function stImportOptions(value) {
  if (Array.isArray(value)) return value.map((o) => String(o ?? '').trim()).filter(Boolean);
  const s = String(value ?? '').trim();
  if (!s) return [];
  if (s.startsWith('[')) { try { const arr = JSON.parse(s); if (Array.isArray(arr)) return arr.map((o) => String(o ?? '').trim()).filter(Boolean); } catch { /* fall through */ } }
  return s.split('|').map((o) => o.trim()).filter(Boolean);
}

/** "CAS Exam 7 · 2019 Fall · Q5(b)" from the parts that are present. */
function stImportOriginLabel(fields) {
  const num = fields.number ? `Q${fields.number}${fields.part ? `(${fields.part})` : ''}` : '';
  const parts = [fields.exam, fields.sitting, num].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return fields.paper || fields.label || '';
}

/** One imported record (known keys lower-cased) as a question, or null without question text. */
function stImportedQuestion(record, extras) {
  const stem = String(record.question ?? '').trim();
  if (!stem) return null;
  const fields = {
    paper: String(record.paper ?? '').trim(),
    source: String(record.source ?? '').trim(),
    exam: String(record.exam ?? '').trim(),
    sitting: String(record.sitting ?? '').trim(),
    number: String(record.number ?? '').trim(),
    part: String(record.part ?? '').trim().toLowerCase(),
    label: String(record.label ?? '').trim(),
  };
  const format = stImportFormat(record.kind);
  const rubric = stImportRubric(record.rubric);
  const q = {
    format, stem,
    options: [], answer: String(record.answer ?? '').trim(), explanation: '',
    rubric, rubricOrigin: rubric.length ? 'source' : '', contradictions: [], numeric: null,
    sourcePage: 0, sourceQuote: '', sourceUri: '',
    origin: 'imported', originLabel: stImportOriginLabel(fields), providerId: '',
    providerRef: extras && Object.keys(extras).length ? JSON.stringify(extras) : '',
    bankId: 0, checks: { anchor: null, support: null, distractor: null, numeric: null },
    difficulty: '', hidden: 0, edited: 0,
    ...fields,
  };
  if (format === 'mc') {
    q.options = stImportOptions(record.options);
    const idx = stOptionIndex(q.answer, q.options);
    q.answer = Number.isInteger(idx) && idx >= 0 && idx < q.options.length ? String(idx) : '';
  }
  return q;
}

/** Split a Markdown question file into blocks on `---` lines and `#` headings. */
function stMarkdownBlocks(text) {
  const blocks = [];
  let cur = { label: '', lines: [] };
  for (const line of text.split('\n')) {
    if (/^-{3,}\s*$/.test(line)) { blocks.push(cur); cur = { label: '', lines: [] }; continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { blocks.push(cur); cur = { label: h[1].trim(), lines: [] }; continue; }
    cur.lines.push(line);
  }
  blocks.push(cur);
  return blocks;
}

/** Key lines of one block: `Q:`, `**Question**`, `Answer:`, ... with multi-line values. */
function stMarkdownRecord(lines) {
  const record = {};
  let key = null;
  const keyLine = /^\s*(?:\*\*)?([A-Za-z]+)(?:\*\*)?\s*:\s*(.*)$/;
  const boldLine = /^\s*\*\*([A-Za-z]+)\*\*\s*:?\s*(.*)$/;
  for (const line of lines) {
    const m = keyLine.exec(line) || boldLine.exec(line);
    const name = m ? ST_IMPORT_KEYS[m[1].toLowerCase()] : null;
    if (name) {
      key = name;
      record[key] = (record[key] ? record[key] + '\n' : '') + m[2].trim();
      continue;
    }
    if (key) record[key] += '\n' + line;
  }
  for (const k of Object.keys(record)) record[k] = record[k].replace(/\n{3,}/g, '\n\n').trim();
  return record;
}

/** A delimited file: rows of fields, quotes honoured. */
function stSplitDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** Known keys of a raw object, and the rest (unknown columns) as extras. */
function stSplitRecord(obj) {
  const record = {};
  const extras = {};
  for (const [rawKey, value] of Object.entries(obj || {})) {
    const name = ST_IMPORT_KEYS[String(rawKey).trim().toLowerCase()];
    if (name) record[name] = value;
    else if (value !== '' && value != null) extras[rawKey] = value;
  }
  return { record, extras };
}

/**
 * Parse a question file (.md, .csv, .tsv, .json) into questions (§7).
 * Every question is `essay` unless its kind says short, mc, numeric or
 * formula. Unknown columns are kept in providerRef as JSON. `skipped`
 * counts the entries with no question text.
 */
function stParseQuestionFile(text, ext) {
  const src = stCleanText(text);
  const kind = String(ext || '').replace(/^\./, '').toLowerCase();
  const questions = [];
  let skipped = 0;
  const add = (record, extras) => {
    const q = stImportedQuestion(record, extras);
    if (q) questions.push(q); else skipped++;
  };
  if (kind === 'json') {
    let parsed;
    try { parsed = JSON.parse(src); } catch { return { questions, skipped, error: 'Not valid JSON.' }; }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : Array.isArray(parsed?.items) ? parsed.items : [];
    for (const item of list) {
      if (!item || typeof item !== 'object') { skipped++; continue; }
      const { record, extras } = stSplitRecord(item);
      add(record, extras);
    }
    return { questions, skipped };
  }
  if (kind === 'csv' || kind === 'tsv') {
    const delimiter = kind === 'tsv' ? '\t' : ',';
    const rows = stSplitDelimited(src, delimiter);
    if (!rows.length) return { questions, skipped };
    const header = rows[0].map((h) => h.trim());
    for (const row of rows.slice(1)) {
      const obj = {};
      header.forEach((h, i) => { if (h) obj[h] = (row[i] ?? '').trim(); });
      const { record, extras } = stSplitRecord(obj);
      add(record, extras);
    }
    return { questions, skipped };
  }
  // Markdown (and anything else): blocks of key lines.
  for (const block of stMarkdownBlocks(src)) {
    if (!block.lines.some((l) => l.trim())) continue;
    const record = stMarkdownRecord(block.lines);
    if (block.label && !record.label) record.label = block.label;
    if (!Object.keys(record).length) { skipped++; continue; }
    add(record, {});
  }
  return { questions, skipped };
}

// ── Import: examiner's reports ─────────────────────────────────────────────────

const ST_REPORT_QUESTION = /^\s*(?:question|q)\s*[#.:]?\s*(\d{1,3})\b\s*(.*)$/i;
const ST_REPORT_SAMPLE = /^(?:sample\s+(?:answers?|responses?|solutions?)|model\s+(?:answers?|solutions?))\b/i;
const ST_REPORT_COMMENTS = /^(?:examiner'?s'?\s+(?:report|comments?|notes?)|common\s+(?:errors?|mistakes?)|candidates?\b)/i;
const ST_REPORT_PART_WORD = /^\s*part\s*\(?([a-h])\)?\s*[:.)]?\s*(.*)$/i;
const ST_REPORT_PART_BARE = /^\s*\(?([a-h])\)\s*(?:(\d+(?:\.\d+)?)\s*(?:points?|pts?))?\s*$/i;
const ST_REPORT_PART_POINTS = /^\s*\(?([a-h])[.):]\s*(\d+(?:\.\d+)?)\s*(?:points?|pts?)\b/i;

/** Which part letter a line names, when it is a part marker and not prose. */
function stReportPartOf(line) {
  const s = line.trim();
  if (!s || s.length > 80) return '';
  let m = ST_REPORT_PART_WORD.exec(s);
  if (m) return m[2].length > 40 && !/^\d/.test(m[2]) ? '' : m[1].toLowerCase();
  m = ST_REPORT_PART_BARE.exec(s);
  if (m) return m[1].toLowerCase();
  m = ST_REPORT_PART_POINTS.exec(s);
  if (m) return m[1].toLowerCase();
  return '';
}

/** Is the line a short heading of this kind (not a sentence)? */
function stReportHeading(line, re) {
  const s = line.trim();
  if (!s || s.length > 60 || /[.!?]$/.test(s)) return false;
  return re.test(s);
}

function stReportText(lines) {
  return lines.map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse an examiner's report from its page texts: the exam and sitting from
 * the first pages, then one entry per QUESTION n heading (or per part when
 * the sample answers are split into parts). Each entry's sampleAnswer is
 * the text under the sample heading, commonErrors the text under the
 * examiner's comments, and page the page its heading is on.
 */
function stParseExaminerReport(pageTexts) {
  const pages = (Array.isArray(pageTexts) ? pageTexts : []).map((p) => stCleanText(p));
  const head = pages.slice(0, 2).join('\n');
  let exam = '';
  const em = /\bexam\s*[:#]?\s*(\d{1,2}[A-Za-z]?)\b/i.exec(head);
  if (em) exam = `${/\bCAS\b/.test(head) ? 'CAS ' : ''}Exam ${em[1].toUpperCase()}`;
  let sitting = '';
  const seasons = 'spring|fall|summer|winter|autumn';
  const sm = new RegExp(`\\b(${seasons})\\s*,?\\s*((?:19|20)\\d\\d)\\b`, 'i').exec(head)
    || new RegExp(`\\b((?:19|20)\\d\\d)\\s*,?\\s*(${seasons})\\b`, 'i').exec(head);
  if (sm) {
    const year = /^\d/.test(sm[1]) ? sm[1] : sm[2];
    const season = /^\d/.test(sm[1]) ? sm[2] : sm[1];
    sitting = `${year} ${season.charAt(0).toUpperCase()}${season.slice(1).toLowerCase()}`;
  }

  const lines = [];
  pages.forEach((p, i) => { for (const l of p.split('\n')) lines.push({ text: l, page: i + 1 }); });
  const starts = [];
  lines.forEach((l, i) => {
    const s = l.text.trim();
    if (s.length > 80) return;
    const m = ST_REPORT_QUESTION.exec(s);
    if (!m) return;
    const rest = m[2].trim();
    if (rest && (/[.!?]$/.test(rest) || (rest.length > 30 && !/\bpart\b/i.test(rest)))) return;
    const pm = /(?:\bpart\s*)?\(?\b([a-h])\b\)?/i.exec(rest.replace(/\bpart\b/i, 'part '));
    starts.push({ at: i, number: Number(m[1]), part: pm ? pm[1].toLowerCase() : '', page: l.page });
  });

  const questions = [];
  starts.forEach((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1].at : lines.length;
    const sample = new Map();
    const comments = new Map();
    const partPages = new Map();
    const order = [];
    let state = '';
    let part = '';
    const buffer = (map, key) => { if (!map.has(key)) map.set(key, []); return map.get(key); };
    for (let i = start.at + 1; i < end; i++) {
      const line = lines[i].text;
      if (stReportHeading(line, ST_REPORT_SAMPLE)) { state = 'sample'; part = ''; continue; }
      if (stReportHeading(line, ST_REPORT_COMMENTS)) { state = 'comments'; part = ''; continue; }
      if (!state) continue;
      const p = stReportPartOf(line);
      if (p) {
        part = p;
        if (!order.includes(p)) order.push(p);
        if (state === 'sample' && !partPages.has(p)) partPages.set(p, lines[i].page);
        continue;
      }
      buffer(state === 'sample' ? sample : comments, part).push(line);
    }
    const textOf = (map, key) => stReportText(map.get(key) || []);
    if (start.part || !order.length) {
      const all = (map) => stReportText([...map.values()].flat());
      questions.push({ number: start.number, part: start.part, sampleAnswer: all(sample), commonErrors: all(comments), page: start.page });
      return;
    }
    for (const p of order) {
      questions.push({
        number: start.number,
        part: p,
        sampleAnswer: textOf(sample, p),
        commonErrors: textOf(comments, p) || textOf(comments, ''),
        page: partPages.get(p) || start.page,
      });
    }
  });
  return { exam, sitting, questions };
}

// ── Matching a report to questions ─────────────────────────────────────────────

/** "CAS Exam 7", "Exam 7", "7" all key as "7"; '' stays ''. */
function stExamKey(s) {
  const v = String(s ?? '').trim();
  if (!v) return '';
  const m = /exam\s*[:#]?\s*(\d{1,2}[a-z]?)/i.exec(v);
  if (m) return m[1].toLowerCase();
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** "Fall 2019", "2019 Fall", "2019F" key as "2019 fall"; '' stays ''. */
function stSittingKey(s) {
  const v = String(s ?? '').trim();
  if (!v) return '';
  const year = /((?:19|20)\d\d)/.exec(v);
  const season = /(spring|fall|summer|winter|autumn)/i.exec(v);
  if (year && season) return `${year[1]} ${season[1].toLowerCase()}`;
  if (year) {
    const letter = /(?:19|20)\d\d\s*([sfSF])\b/.exec(v);
    if (letter) return `${year[1]} ${letter[1].toLowerCase() === 's' ? 'spring' : 'fall'}`;
    return year[1];
  }
  return v.toLowerCase();
}

/** A question's exam, sitting, number and part keys: its own fields, else its origin label. */
function stQuestionKeys(q) {
  const keys = {
    exam: stExamKey(q?.exam),
    sitting: stSittingKey(q?.sitting),
    number: Number(q?.number) || 0,
    part: String(q?.part ?? '').trim().toLowerCase(),
  };
  if (!keys.number && q?.originLabel) {
    const pieces = String(q.originLabel).split(/\s*[·|]\s*/);
    for (const piece of pieces) {
      const qm = /^q\s*(\d{1,3})\s*(?:\(([a-h])\))?$/i.exec(piece.trim());
      if (qm) { keys.number = Number(qm[1]); if (!keys.part && qm[2]) keys.part = qm[2].toLowerCase(); continue; }
      if (!keys.exam && /exam/i.test(piece)) keys.exam = stExamKey(piece);
      else if (!keys.sitting && /(?:19|20)\d\d/.test(piece)) keys.sitting = stSittingKey(piece);
    }
  }
  return keys;
}

/** Pair each report entry with the questions it is about, by exam, sitting, number and part. */
function stMatchReportToQuestions(report, questions) {
  const exam = stExamKey(report?.exam);
  const sitting = stSittingKey(report?.sitting);
  const out = [];
  const keyed = (questions || []).map((q) => ({ q, k: stQuestionKeys(q) }));
  for (const entry of report?.questions || []) {
    const number = Number(entry?.number) || 0;
    const part = String(entry?.part ?? '').trim().toLowerCase();
    if (!number) continue;
    for (const { q, k } of keyed) {
      if (k.number !== number || k.part !== part) continue;
      if (exam && k.exam && k.exam !== exam) continue;
      if (sitting && k.sitting && k.sitting !== sitting) continue;
      out.push({ questionId: q.id, entry });
    }
  }
  return out;
}
