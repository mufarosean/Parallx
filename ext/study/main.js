// GENERATED from ext/study/src/*.js by scripts/bundle-study.mjs; edit the parts, then run it.

// Study: review dense material without rereading it.
//
// Multiple-choice practice, typed and essay tests graded against the text,
// every question anchored to the page it came from, and only what was missed
// sent on to Flashcards. A material is a PDF, a canvas page or an imported
// question bank; a concept map per section is the unit of coverage and
// mastery; sessions draw from a bank that generation keeps topped up.
//
// Integration points (everything the host offers, used once each):
//   - api.database          per-extension SQLite (st_* tables)
//   - api.lm                concept maps, question writing, checks, grading
//   - api.commands          canvas.getPageMarkdown, questions.getRegistry,
//                           flashcards.addCards (only while it exists)
//   - api.editors           the study pane, openFileEditor for Show Source
//   - api.chat              the selection action, chat tools
//   - api.dashboard         the Weak Spots widget
//   - api.links             parallx://study/... deep links
//   - parallxElectron.document.extractText   PDF text and outline
//   - parallxElectron.python                 numeric checks
//
// ext/study/main.js is GENERATED: it is the concatenation, in filename order,
// of ext/study/src/*.js (node scripts/bundle-study.mjs writes it, and
// tests/unit/studyBundle.test.ts fails when it is stale). The parts share one
// module scope: no import, no export except in 90-activate.js. Function
// declarations hoist, const does not, so a part never runs code at load time
// beyond declaring things. Edit the parts, then run the bundler.
//
// Pure logic lives in 10-model.js and is exported through __testables so
// tests/unit/study*.test.ts can run it without a DOM, a model or a database.

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 0: SHARED HELPERS (every part may use these names)
// ═══════════════════════════════════════════════════════════════════════════════

/** The host api, bound in activate(). */
let _api = null;
/** api.database, bound in activate(). */
let _dbBridge = null;

/** The Flashcards database wrapper, copied: errors surface as thrown Errors
 *  with a prefix, so a failed statement never reads as an empty result. */
const db = {
  async run(sql, params = []) {
    const res = await _dbBridge.run(sql, params);
    if (res.error) throw new Error(`[ST-DB] ${res.error.message}`);
    return res;
  },
  async get(sql, params = []) {
    const res = await _dbBridge.get(sql, params);
    if (res.error) throw new Error(`[ST-DB] ${res.error.message}`);
    return res.row ?? null;
  },
  async all(sql, params = []) {
    const res = await _dbBridge.all(sql, params);
    if (res.error) throw new Error(`[ST-DB] ${res.error.message}`);
    return res.rows ?? [];
  },
};

/** The preload bridge (document extraction, python, fs). Copied from Flashcards. */
function electronBridge() {
  return globalThis.parallxElectron;
}

/** Make an element. Copied from Flashcards, with defaults so `el('div')` reads cleanly. */
function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== '') node.textContent = text;
  return node;
}

/** Icon html from the registry, '' when the api is not bound yet. */
function icon(id, size = 16) {
  try {
    if (_api?.icons?.createIconHtml) return _api.icons.createIconHtml(id, size);
  } catch { /* noop */ }
  return '';
}

/** A Study setting (the manifest's `study.*` keys, given without the prefix). */
function cfg(key, fallback) {
  try {
    const c = _api.workspace.getConfiguration('study');
    const v = c.get(String(key).replace(/^study\./, ''), fallback);
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/** The clock, in one place, so the pure model can take `now` as an argument. */
function stNow() {
  return Date.now();
}

/** fsPath of the first workspace folder, or ''. */
function stWorkspaceRoot() {
  try {
    const uri = _api?.workspace?.workspaceFolders?.[0]?.uri;
    return uri ? stFsPathOf(uri) : '';
  } catch {
    return '';
  }
}

/** A file:// URI or a raw path, as an fs path. Copied from Flashcards (fcUriToFsPath). */
function stFsPathOf(uriOrPath) {
  if (!uriOrPath) return '';
  let p = String(uriOrPath);
  if (/^file:\/\//i.test(p)) {
    p = p.replace(/^file:\/\//i, '');
    try { p = decodeURIComponent(p); } catch { /* leave encoded on malformed input */ }
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1); // /D:/x → D:/x
  }
  return p;
}

/** An fs path as a file:// URI string (already a URI: returned as is). */
function stUriOf(fsPath) {
  const p = String(fsPath || '');
  if (!p) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return p;
  let norm = p.replace(/\\/g, '/');
  if (!norm.startsWith('/')) norm = '/' + norm;
  return 'file://' + encodeURI(norm).replace(/[?#]/g, (c) => encodeURIComponent(c));
}

/** Cut text to `max` characters with a trailing ellipsis. */
function stTruncate(text, max) {
  const s = String(text ?? '');
  const n = Math.max(1, Number(max) || 1);
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).replace(/\s+$/, '') + '…';
}

/** HTML-escape text for innerHTML. */
function stEsc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The in-extension event bus. Events: 'data' (anything changed), 'route'
 * (pane navigation), 'run' (generation progress {runId, ...}), 'session'
 * (a session item was answered). `on` returns a dispose function that is
 * also an IDisposable, so it can go straight on context.subscriptions.
 */
const bus = (() => {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      const set = listeners.get(event);
      set.add(fn);
      const dispose = () => { set.delete(fn); };
      dispose.dispose = dispose;
      return dispose;
    },
    emit(event, detail) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(detail); } catch (err) { console.error('[Study] listener failed', err); }
      }
    },
  };
})();

function _emitDataChanged() {
  bus.emit('data');
}

function onDataChanged(fn) {
  return bus.on('data', fn);
}

/** Question formats, and the ones answered by typing. */
const ST_FORMATS = ['mc', 'short', 'essay', 'numeric', 'formula', 'cloze'];
const ST_TYPED = new Set(['short', 'essay', 'numeric', 'formula', 'cloze']);

/** Ratings (the Flashcards scale) and time units. */
const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;
const MIN = 60000, DAY = 86400000;

/** The px-study icon as inline svg (the manifest's, for openEditor iconHtml). */
const ST_ICON_HTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13.5"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20"/><path d="M9 9h6M9 13h4"/></svg>';

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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20: DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════════
//
// Database access, materials and ingest, banks and providers, the import
// parsers' IO. Every function takes and returns plain objects in the §4
// shapes (camelCase; JSON columns parsed on the way out) and none touches
// the DOM. The database wrapper `db` and `_emitDataChanged()` come from
// 00-header.js; the pure helpers (stHeadingsFromPages, stParseQuestionFile,
// stConceptState and the rest) from 10-model.js.
//
// Patterns copied from ext/flashcards/main.js SECTION 4 (row mapping,
// lastInsertRowid, _emitDataChanged after writes) and SECTION 6 (the PDF
// extractor through electronBridge().document.extractText, the canvas read
// through the 'canvas.getPageMarkdown' command, the workspace walk for the
// picker), renamed to st.

// ── Small helpers ───────────────────────────────────────────────────────────

/** Parse a JSON column, falling back when the cell is empty or corrupt. */
function stParseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    const v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** A JSON column value; '' for an empty object or array when `emptyAs` says so. */
function stJsonCol(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.stringify(value); } catch { return fallback; }
}

/**
 * FNV-1a 32-bit over a string, as eight hex digits. A cheap content hash:
 * it only has to notice that a PDF changed since it was ingested, so the
 * cached text and the sections can be refreshed.
 */
function stHashText(text) {
  const s = String(text || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Integer id list for an IN (...) clause; [] when nothing usable. */
function stIdList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0);
}

function stPlaceholders(list) {
  return list.map(() => '?').join(', ');
}

function stFileNameOf(fsPath) {
  return String(fsPath || '').split(/[\\/]/).pop() || '';
}

function stExtOf(nameOrPath) {
  const m = /\.([a-z0-9]+)$/i.exec(String(nameOrPath || ''));
  return m ? m[1].toLowerCase() : '';
}

// ── Row mapping ─────────────────────────────────────────────────────────────

function stRowToMaterial(row) {
  return {
    id: row.id,
    kind: row.kind,
    uri: row.uri,
    label: row.label,
    pageCount: row.page_count || 0,
    contentHash: row.content_hash || '',
    outline: stParseJson(row.outline_json, []),
    model: row.model || '',
    contextSetting: row.context_setting || 0,
    answerFormat: row.answer_format || '',
    createdAt: row.created_at || 0,
    lastStudiedAt: row.last_studied_at || 0,
  };
}

function stRowToSection(row) {
  return {
    id: row.id,
    materialId: row.material_id,
    title: row.title,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    ord: row.ord,
    mappedAt: row.mapped_at || 0,
  };
}

function stRowToConcept(row) {
  return {
    id: row.id,
    materialId: row.material_id,
    sectionId: row.section_id || 0,
    title: row.title,
    summary: row.summary || '',
    page: row.page || 0,
    anchorQuote: row.anchor_quote || '',
    ord: row.ord || 0,
    mastery: row.mastery || 0,
    answers: row.answers || 0,
    misses: row.misses || 0,
    missStreak: row.miss_streak || 0,
    rightChooseAt: row.right_choose_at || 0,
    rightTypeAt: row.right_type_at || 0,
    lastAnsweredAt: row.last_answered_at || 0,
  };
}

function stRowToQuestion(row) {
  const numeric = stParseJson(row.numeric_json, null);
  return {
    id: row.id,
    materialId: row.material_id || 0,
    conceptId: row.concept_id || 0,
    format: row.format,
    stem: row.stem,
    options: stParseJson(row.options_json, []),
    answer: row.answer || '',
    explanation: row.explanation || '',
    rubric: stParseJson(row.rubric_json, []),
    rubricOrigin: row.rubric_origin || '',
    contradictions: stParseJson(row.contradictions_json, []),
    numeric: numeric && typeof numeric === 'object' ? numeric : null,
    sourcePage: row.source_page || 0,
    sourceQuote: row.source_quote || '',
    sourceUri: row.source_uri || '',
    origin: row.origin || 'generated',
    originLabel: row.origin_label || '',
    providerId: row.provider_id || '',
    providerRef: row.provider_ref || '',
    bankId: row.bank_id || 0,
    checks: stParseJson(row.checks_json, {}),
    difficulty: row.difficulty || '',
    hidden: !!row.hidden,
    edited: !!row.edited,
    runId: row.run_id || 0,
    model: row.model || '',
    createdAt: row.created_at || 0,
  };
}

function stRowToRun(row) {
  return {
    id: row.id,
    materialId: row.material_id,
    sectionId: row.section_id || 0,
    model: row.model || '',
    numCtx: row.num_ctx || 0,
    startedAt: row.started_at || 0,
    finishedAt: row.finished_at || 0,
    status: row.status || 'running',
    written: row.written || 0,
    kept: row.kept || 0,
    dropped: stParseJson(row.dropped_json, {}),
    error: row.error || '',
  };
}

function stRowToSession(row) {
  return {
    id: row.id,
    name: row.name,
    scope: stParseJson(row.scope_json, { kind: 'document', materialIds: [], label: '' }),
    mode: row.mode,
    answerFormat: row.answer_format,
    size: row.size || 20,
    model: row.model || '',
    numCtx: row.num_ctx || 0,
    startedAt: row.started_at || 0,
    finishedAt: row.finished_at || 0,
    position: row.position || 0,
    refreshes: row.refreshes || 0,
    seconds: row.seconds || 0,
  };
}

function stRowToSessionItem(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    draw: row.draw || 0,
    ord: row.ord,
    formatUsed: row.format_used || '',
    status: row.status || 'pending',
    chosen: row.chosen || '',
    typed: row.typed || '',
    verdict: stParseJson(row.verdict_json, null),
    retried: !!row.retried,
    answeredAt: row.answered_at || 0,
  };
}

function stRowToBank(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    path: row.path || '',
    providerId: row.provider_id || '',
    exam: row.exam || '',
    sitting: row.sitting || '',
    count: row.count || 0,
    importedAt: row.imported_at || 0,
  };
}

// ── Database ────────────────────────────────────────────────────────────────

/** Open the per-extension database and apply db/migrations. False on failure. */
async function stEnsureDatabase(api) {
  if (!api || !api.database) {
    console.error('[Study] api.database unavailable; cannot activate.');
    return false;
  }
  _dbBridge = api.database;
  const openResult = await api.database.open();
  if (openResult && openResult.error) {
    console.error('[Study] Database open failed:', openResult.error.message);
    return false;
  }
  const toolPath = String(api.env?.toolPath || '');
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = toolPath + sep + 'db' + sep + 'migrations';
  const res = await api.database.migrate(migrationsDir);
  if (res && res.error) {
    console.error('[Study] Migration failed:', res.error.message);
    return false;
  }
  return true;
}

// ── Materials ───────────────────────────────────────────────────────────────

async function stListMaterials() {
  const rows = await db.all('SELECT * FROM st_materials ORDER BY last_studied_at DESC, label COLLATE NOCASE');
  return rows.map(stRowToMaterial);
}

async function stGetMaterial(id) {
  if (id == null) return null;
  const row = await db.get('SELECT * FROM st_materials WHERE id = ?', [id]);
  return row ? stRowToMaterial(row) : null;
}

/** Insert or refresh a material by (kind, uri). Returns the stored material. */
async function stUpsertMaterial({ kind, uri, label, pageCount = 0, contentHash = '', outline = [] }) {
  const outlineJson = stJsonCol(Array.isArray(outline) ? outline : [], '[]');
  const existing = await db.get('SELECT id FROM st_materials WHERE kind = ? AND uri = ?', [kind, uri]);
  let id;
  if (existing) {
    await db.run(
      'UPDATE st_materials SET label = ?, page_count = ?, content_hash = ?, outline_json = ? WHERE id = ?',
      [label, pageCount || 0, contentHash || '', outlineJson, existing.id],
    );
    id = existing.id;
  } else {
    const res = await db.run(
      'INSERT INTO st_materials (kind, uri, label, page_count, content_hash, outline_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [kind, uri, label, pageCount || 0, contentHash || '', outlineJson, stNow()],
    );
    id = res.lastInsertRowid;
  }
  _emitDataChanged();
  return stGetMaterial(id);
}

/** Remember the model, context and answer format chosen for a material. Undefined keys are left alone. */
async function stSetMaterialPrefs(id, { model, contextSetting, answerFormat } = {}) {
  const sets = [];
  const params = [];
  if (model !== undefined) { sets.push('model = ?'); params.push(String(model || '')); }
  if (contextSetting !== undefined) { sets.push('context_setting = ?'); params.push(Number(contextSetting) || 0); }
  if (answerFormat !== undefined) { sets.push('answer_format = ?'); params.push(String(answerFormat || '')); }
  if (!sets.length) return stGetMaterial(id);
  params.push(id);
  await db.run(`UPDATE st_materials SET ${sets.join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
  return stGetMaterial(id);
}

async function stTouchMaterial(id, now) {
  await db.run('UPDATE st_materials SET last_studied_at = ? WHERE id = ?', [now || stNow(), id]);
  _emitDataChanged();
}

// ── Sections ────────────────────────────────────────────────────────────────

async function stListSections(materialId) {
  const rows = await db.all('SELECT * FROM st_sections WHERE material_id = ? ORDER BY ord, id', [materialId]);
  return rows.map(stRowToSection);
}

async function stGetSection(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_sections WHERE id = ?', [id]);
  return row ? stRowToSection(row) : null;
}

/** Replace a material's sections with [{ title, pageFrom, pageTo }] in order. Returns the new rows. */
async function stReplaceSections(materialId, sections) {
  await db.run('DELETE FROM st_sections WHERE material_id = ?', [materialId]);
  const list = Array.isArray(sections) ? sections : [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {};
    await db.run(
      'INSERT INTO st_sections (material_id, title, page_from, page_to, ord) VALUES (?, ?, ?, ?, ?)',
      [materialId, String(s.title || `Pages ${s.pageFrom}-${s.pageTo}`), Number(s.pageFrom) || 1, Number(s.pageTo) || Number(s.pageFrom) || 1, i],
    );
  }
  _emitDataChanged();
  return stListSections(materialId);
}

async function stMarkSectionMapped(sectionId, now) {
  await db.run('UPDATE st_sections SET mapped_at = ? WHERE id = ?', [now || stNow(), sectionId]);
  _emitDataChanged();
}

/**
 * Store sections for a freshly ingested material: keep the existing rows
 * (and their mapped_at) when the new list has the same titles and pages,
 * replace them otherwise. A re-ingest of an unchanged PDF must not throw
 * away the concept maps it already built.
 */
async function stEnsureSections(materialId, sections) {
  const existing = await stListSections(materialId);
  const next = Array.isArray(sections) ? sections : [];
  const same = existing.length === next.length && existing.every((e, i) =>
    e.title === String(next[i].title || '') && e.pageFrom === Number(next[i].pageFrom) && e.pageTo === Number(next[i].pageTo));
  if (existing.length && same) return existing;
  return stReplaceSections(materialId, next);
}

// ── Concepts ────────────────────────────────────────────────────────────────

/** Concepts by material and/or section. Either filter may be empty; both empty lists everything. */
async function stListConcepts({ materialIds, sectionIds } = {}) {
  const where = [];
  const params = [];
  const mids = stIdList(materialIds);
  const sids = stIdList(sectionIds);
  if (Array.isArray(materialIds)) {
    if (!mids.length) return [];
    where.push(`material_id IN (${stPlaceholders(mids)})`);
    params.push(...mids);
  }
  if (Array.isArray(sectionIds)) {
    if (!sids.length) return [];
    where.push(`section_id IN (${stPlaceholders(sids)})`);
    params.push(...sids);
  }
  const sql = `SELECT * FROM st_concepts${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY material_id, section_id, ord, id`;
  const rows = await db.all(sql, params);
  return rows.map(stRowToConcept);
}

async function stGetConcept(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_concepts WHERE id = ?', [id]);
  return row ? stRowToConcept(row) : null;
}

/** Insert [{ title, summary, page, anchorQuote, ord? }] under a section. Returns the stored concepts. */
async function stInsertConcepts(materialId, sectionId, concepts) {
  const list = Array.isArray(concepts) ? concepts : [];
  if (!list.length) return [];
  const base = await db.get('SELECT COALESCE(MAX(ord), -1) AS m FROM st_concepts WHERE material_id = ? AND section_id = ?', [materialId, sectionId || 0]);
  let ord = (base && Number(base.m)) || -1;
  const ids = [];
  const now = stNow();
  for (const c of list) {
    ord += 1;
    const res = await db.run(
      'INSERT INTO st_concepts (material_id, section_id, title, summary, page, anchor_quote, ord, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [materialId, sectionId || 0, String(c.title || '').trim(), String(c.summary || '').trim(), Number(c.page) || 0, String(c.anchorQuote || ''), Number.isInteger(c.ord) ? c.ord : ord, now],
    );
    ids.push(res.lastInsertRowid);
  }
  _emitDataChanged();
  const rows = await db.all(`SELECT * FROM st_concepts WHERE id IN (${stPlaceholders(ids)}) ORDER BY ord, id`, ids);
  return rows.map(stRowToConcept);
}

/** Write a concept's text and mastery state back (the pure stApplyAnswer result). */
async function stUpdateConcept(concept) {
  await db.run(
    `UPDATE st_concepts SET title = ?, summary = ?, page = ?, anchor_quote = ?, mastery = ?, answers = ?, misses = ?,
       miss_streak = ?, right_choose_at = ?, right_type_at = ?, last_answered_at = ? WHERE id = ?`,
    [
      String(concept.title || ''), String(concept.summary || ''), Number(concept.page) || 0, String(concept.anchorQuote || ''),
      Number(concept.mastery) || 0, Number(concept.answers) || 0, Number(concept.misses) || 0,
      Number(concept.missStreak) || 0, Number(concept.rightChooseAt) || 0, Number(concept.rightTypeAt) || 0,
      Number(concept.lastAnsweredAt) || 0, concept.id,
    ],
  );
  _emitDataChanged();
}

// ── Questions ───────────────────────────────────────────────────────────────

/**
 * Questions by material, concept, format or bank. Hidden questions are left
 * out unless includeHidden. An empty id list means "none", not "all".
 */
async function stListQuestions({ materialIds, conceptIds, formats, includeHidden = false, bankIds } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(materialIds)) {
    const ids = stIdList(materialIds);
    if (!ids.length) return [];
    where.push(`material_id IN (${stPlaceholders(ids)})`);
    params.push(...ids);
  }
  if (Array.isArray(conceptIds)) {
    const ids = stIdList(conceptIds);
    if (!ids.length) return [];
    where.push(`concept_id IN (${stPlaceholders(ids)})`);
    params.push(...ids);
  }
  if (Array.isArray(bankIds)) {
    const ids = stIdList(bankIds);
    if (!ids.length) return [];
    where.push(`bank_id IN (${stPlaceholders(ids)})`);
    params.push(...ids);
  }
  if (Array.isArray(formats) && formats.length) {
    const list = formats.map((f) => String(f));
    where.push(`format IN (${stPlaceholders(list)})`);
    params.push(...list);
  }
  if (!includeHidden) where.push('hidden = 0');
  const sql = `SELECT * FROM st_questions${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY concept_id, id`;
  const rows = await db.all(sql, params);
  return rows.map(stRowToQuestion);
}

async function stGetQuestion(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_questions WHERE id = ?', [id]);
  return row ? stRowToQuestion(row) : null;
}

const ST_QUESTION_COLS = [
  'material_id', 'concept_id', 'format', 'stem', 'options_json', 'answer', 'explanation', 'rubric_json', 'rubric_origin',
  'contradictions_json', 'numeric_json', 'source_page', 'source_quote', 'source_uri', 'origin', 'origin_label',
  'provider_id', 'provider_ref', 'bank_id', 'checks_json', 'difficulty', 'hidden', 'edited', 'run_id', 'model', 'created_at',
];

function stQuestionParams(q, now) {
  return [
    Number(q.materialId) || 0,
    Number(q.conceptId) || 0,
    String(q.format || 'short'),
    String(q.stem || '').trim(),
    stJsonCol(Array.isArray(q.options) ? q.options : [], '[]'),
    q.answer == null ? '' : String(q.answer),
    String(q.explanation || ''),
    stJsonCol(Array.isArray(q.rubric) ? q.rubric : [], '[]'),
    String(q.rubricOrigin || ''),
    stJsonCol(Array.isArray(q.contradictions) ? q.contradictions : [], '[]'),
    q.numeric && typeof q.numeric === 'object' ? stJsonCol(q.numeric, '') : '',
    Number(q.sourcePage) || 0,
    String(q.sourceQuote || ''),
    String(q.sourceUri || ''),
    String(q.origin || 'generated'),
    String(q.originLabel || ''),
    String(q.providerId || ''),
    String(q.providerRef || ''),
    Number(q.bankId) || 0,
    stJsonCol(q.checks && typeof q.checks === 'object' ? q.checks : {}, '{}'),
    String(q.difficulty || ''),
    q.hidden ? 1 : 0,
    q.edited ? 1 : 0,
    Number(q.runId) || 0,
    String(q.model || ''),
    Number(q.createdAt) || now,
  ];
}

/** Insert StQuestion-shaped objects (no id). Returns the stored questions, in order. */
async function stInsertQuestions(questions) {
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length) return [];
  const now = stNow();
  const ids = [];
  const sql = `INSERT INTO st_questions (${ST_QUESTION_COLS.join(', ')}) VALUES (${stPlaceholders(ST_QUESTION_COLS)})`;
  for (const q of list) {
    const res = await db.run(sql, stQuestionParams(q, now));
    ids.push(res.lastInsertRowid);
  }
  _emitDataChanged();
  const rows = await db.all(`SELECT * FROM st_questions WHERE id IN (${stPlaceholders(ids)})`, ids);
  const byId = new Map(rows.map((r) => [r.id, stRowToQuestion(r)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** Write a full StQuestion back (every editable column). */
async function stUpdateQuestion(q) {
  const cols = ST_QUESTION_COLS.filter((c) => c !== 'created_at');
  const params = stQuestionParams(q, stNow()).slice(0, cols.length);
  params.push(q.id);
  await db.run(`UPDATE st_questions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
}

/** Thumbs down: hide the question and log why. */
async function stHideQuestion(id, reason = '') {
  await db.run('UPDATE st_questions SET hidden = 1 WHERE id = ?', [id]);
  await stRecordFeedback(id, reason);
}

async function stRecordFeedback(questionId, reason = '') {
  await db.run('INSERT INTO st_feedback (question_id, reason, at) VALUES (?, ?, ?)', [questionId, String(reason || ''), stNow()]);
  _emitDataChanged();
}

// ── Runs ────────────────────────────────────────────────────────────────────

async function stStartRun({ materialId, sectionId = 0, model = '', numCtx = 0 }) {
  const res = await db.run(
    'INSERT INTO st_runs (material_id, section_id, model, num_ctx, started_at) VALUES (?, ?, ?, ?, ?)',
    [Number(materialId) || 0, Number(sectionId) || 0, String(model || ''), Number(numCtx) || 0, stNow()],
  );
  _emitDataChanged();
  return res.lastInsertRowid;
}

async function stFinishRun(id, { status = 'done', written = 0, kept = 0, dropped = {}, error = '' } = {}) {
  await db.run(
    'UPDATE st_runs SET finished_at = ?, status = ?, written = ?, kept = ?, dropped_json = ?, error = ? WHERE id = ?',
    [stNow(), String(status), Number(written) || 0, Number(kept) || 0, stJsonCol(dropped || {}, '{}'), String(error || ''), id],
  );
  _emitDataChanged();
}

async function stGetRun(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_runs WHERE id = ?', [id]);
  return row ? stRowToRun(row) : null;
}

/** Generation runs, newest first, for one material or all. The sidebar's per-model record. */
async function stListRuns({ materialId, limit = 50 } = {}) {
  const rows = materialId
    ? await db.all('SELECT * FROM st_runs WHERE material_id = ? ORDER BY started_at DESC LIMIT ?', [materialId, limit])
    : await db.all('SELECT * FROM st_runs ORDER BY started_at DESC LIMIT ?', [limit]);
  return rows.map(stRowToRun);
}

// ── Sessions ────────────────────────────────────────────────────────────────

async function stCreateSession({ name, scope, mode, answerFormat, size, model = '', numCtx = 0 }) {
  const res = await db.run(
    'INSERT INTO st_sessions (name, scope_json, mode, answer_format, size, model, num_ctx, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [String(name || 'Session'), stJsonCol(scope || {}, '{}'), String(mode || 'practice'), String(answerFormat || 'mixed'), Number(size) || 20, String(model || ''), Number(numCtx) || 0, stNow()],
  );
  _emitDataChanged();
  return stGetSession(res.lastInsertRowid);
}

async function stGetSession(id) {
  if (id == null) return null;
  const row = await db.get('SELECT * FROM st_sessions WHERE id = ?', [id]);
  return row ? stRowToSession(row) : null;
}

/** Sessions newest first; `open` true keeps only unfinished ones, false only finished. */
async function stListSessions({ open } = {}) {
  const where = open === true ? ' WHERE finished_at = 0' : open === false ? ' WHERE finished_at > 0' : '';
  const rows = await db.all(`SELECT * FROM st_sessions${where} ORDER BY started_at DESC`);
  return rows.map(stRowToSession);
}

const ST_SESSION_PATCH_COLS = {
  name: (v) => ['name', String(v || '')],
  scope: (v) => ['scope_json', stJsonCol(v || {}, '{}')],
  mode: (v) => ['mode', String(v || '')],
  answerFormat: (v) => ['answer_format', String(v || '')],
  size: (v) => ['size', Number(v) || 20],
  model: (v) => ['model', String(v || '')],
  numCtx: (v) => ['num_ctx', Number(v) || 0],
  finishedAt: (v) => ['finished_at', Number(v) || 0],
  position: (v) => ['position', Number(v) || 0],
  refreshes: (v) => ['refreshes', Number(v) || 0],
  seconds: (v) => ['seconds', Number(v) || 0],
};

async function stUpdateSession(id, patch = {}) {
  const sets = [];
  const params = [];
  for (const [key, map] of Object.entries(ST_SESSION_PATCH_COLS)) {
    if (patch[key] === undefined) continue;
    const [col, val] = map(patch[key]);
    sets.push(`${col} = ?`);
    params.push(val);
  }
  if (!sets.length) return stGetSession(id);
  params.push(id);
  await db.run(`UPDATE st_sessions SET ${sets.join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
  return stGetSession(id);
}

async function stDeleteSession(id) {
  await db.run('DELETE FROM st_session_items WHERE session_id = ?', [id]);
  await db.run('DELETE FROM st_sessions WHERE id = ?', [id]);
  _emitDataChanged();
}

/**
 * Remove a material and everything made from it: sections and concepts
 * (cascade), its questions, its runs, and every session whose scope was
 * only this material (a session over several materials keeps its rows;
 * its questions from this material are simply gone from future draws).
 */
async function stDeleteMaterial(id) {
  const mid = Number(id);
  if (!Number.isFinite(mid) || mid <= 0) return;
  const sessions = await db.all('SELECT id, scope_json FROM st_sessions', []);
  for (const row of sessions) {
    let scope = null;
    try { scope = JSON.parse(row.scope_json || '{}'); } catch { scope = null; }
    const ids = Array.isArray(scope?.materialIds) ? scope.materialIds.map(Number) : [];
    if (ids.length && ids.every((x) => x === mid)) {
      await db.run('DELETE FROM st_session_items WHERE session_id = ?', [row.id]);
      await db.run('DELETE FROM st_sessions WHERE id = ?', [row.id]);
    }
  }
  await db.run('DELETE FROM st_answers WHERE concept_id IN (SELECT id FROM st_concepts WHERE material_id = ?)', [mid]);
  await db.run('DELETE FROM st_questions WHERE material_id = ?', [mid]);
  await db.run('DELETE FROM st_runs WHERE material_id = ?', [mid]);
  await db.run('DELETE FROM st_concepts WHERE material_id = ?', [mid]);
  await db.run('DELETE FROM st_sections WHERE material_id = ?', [mid]);
  await db.run('DELETE FROM st_materials WHERE id = ?', [mid]);
  _stTextCache.delete(`${mid}:`);
  for (const k of [..._stTextCache.keys()]) if (k.startsWith(`${mid}:`)) _stTextCache.delete(k);
  _emitDataChanged();
}

// ── Session items ───────────────────────────────────────────────────────────

/** Append a draw's questions to a session, in order. `formats[i]` is the format item i is answered in. */
async function stAddSessionItems(sessionId, draw, questionIds, formats = []) {
  const ids = stIdList(questionIds);
  if (!ids.length) return [];
  const base = await db.get('SELECT COALESCE(MAX(ord), -1) AS m FROM st_session_items WHERE session_id = ?', [sessionId]);
  let ord = (base && Number(base.m)) || -1;
  const inserted = [];
  for (let i = 0; i < ids.length; i++) {
    ord += 1;
    const res = await db.run(
      'INSERT INTO st_session_items (session_id, question_id, draw, ord, format_used) VALUES (?, ?, ?, ?, ?)',
      [sessionId, ids[i], Number(draw) || 0, ord, String((formats && formats[i]) || '')],
    );
    inserted.push(res.lastInsertRowid);
  }
  _emitDataChanged();
  const rows = await db.all(`SELECT * FROM st_session_items WHERE id IN (${stPlaceholders(inserted)}) ORDER BY ord`, inserted);
  return rows.map(stRowToSessionItem);
}

async function stListSessionItems(sessionId) {
  const rows = await db.all('SELECT * FROM st_session_items WHERE session_id = ? ORDER BY draw, ord, id', [sessionId]);
  return rows.map(stRowToSessionItem);
}

async function stAnswerItem(itemId, { status, chosen, typed, verdict, retried, formatUsed } = {}, now) {
  const sets = ['answered_at = ?'];
  const params = [now || stNow()];
  if (status !== undefined) { sets.push('status = ?'); params.push(String(status)); }
  if (chosen !== undefined) { sets.push('chosen = ?'); params.push(chosen == null ? '' : String(chosen)); }
  if (typed !== undefined) { sets.push('typed = ?'); params.push(String(typed || '')); }
  if (verdict !== undefined) { sets.push('verdict_json = ?'); params.push(verdict ? stJsonCol(verdict, '') : ''); }
  if (retried !== undefined) { sets.push('retried = ?'); params.push(retried ? 1 : 0); }
  if (formatUsed !== undefined) { sets.push('format_used = ?'); params.push(String(formatUsed || '')); }
  params.push(itemId);
  await db.run(`UPDATE st_session_items SET ${sets.join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
}

async function stLogAnswer({ questionId, conceptId = 0, sessionId = 0, formatUsed, correct, rating = 0, retried = false }, now) {
  const res = await db.run(
    'INSERT INTO st_answers (question_id, concept_id, session_id, format_used, correct, rating, retried, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(questionId) || 0, Number(conceptId) || 0, Number(sessionId) || 0, String(formatUsed || ''), correct ? 1 : 0, Number(rating) || 0, retried ? 1 : 0, now || stNow()],
  );
  _emitDataChanged();
  return res.lastInsertRowid;
}

async function stListAnswers({ conceptId, questionId, sessionId, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (conceptId) { where.push('concept_id = ?'); params.push(conceptId); }
  if (questionId) { where.push('question_id = ?'); params.push(questionId); }
  if (sessionId) { where.push('session_id = ?'); params.push(sessionId); }
  params.push(limit);
  const rows = await db.all(`SELECT * FROM st_answers${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ?`, params);
  return rows.map((r) => ({
    id: r.id, questionId: r.question_id, conceptId: r.concept_id, sessionId: r.session_id,
    formatUsed: r.format_used, correct: !!r.correct, rating: r.rating || 0, retried: !!r.retried, at: r.at,
  }));
}

// ── Banks ───────────────────────────────────────────────────────────────────

async function stListBanks() {
  const rows = await db.all('SELECT * FROM st_banks ORDER BY imported_at DESC');
  return rows.map(stRowToBank);
}

async function stGetBank(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_banks WHERE id = ?', [id]);
  return row ? stRowToBank(row) : null;
}

async function stInsertBank(bank) {
  const res = await db.run(
    'INSERT INTO st_banks (name, kind, path, provider_id, exam, sitting, count, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [String(bank.name || 'Bank'), String(bank.kind || 'file'), String(bank.path || ''), String(bank.providerId || ''), String(bank.exam || ''), String(bank.sitting || ''), Number(bank.count) || 0, stNow()],
  );
  _emitDataChanged();
  return stGetBank(res.lastInsertRowid);
}

async function stSetBankCount(id, count) {
  await db.run('UPDATE st_banks SET count = ? WHERE id = ?', [Number(count) || 0, id]);
  _emitDataChanged();
}

/** Delete a bank and the questions it brought in. */
async function stDeleteBank(id) {
  await db.run('DELETE FROM st_questions WHERE bank_id = ?', [id]);
  await db.run('DELETE FROM st_banks WHERE id = ?', [id]);
  _emitDataChanged();
}

// ── Material text ───────────────────────────────────────────────────────────

/** Extracted text per material id + content hash. A few entries; a long PDF is about a megabyte. */
const _stTextCache = new Map();
const ST_TEXT_CACHE_MAX = 8;

function stTextCacheKey(material) {
  return `${material.id}:${material.contentHash || ''}`;
}

function stTextCachePut(key, value) {
  if (_stTextCache.size >= ST_TEXT_CACHE_MAX) {
    const oldest = _stTextCache.keys().next().value;
    if (oldest !== undefined) _stTextCache.delete(oldest);
  }
  _stTextCache.set(key, value);
}

/** Extract a PDF's text. Copy of fcExtractDocument, keeping pageTexts and the outline. */
async function stExtractPdf(fsPath) {
  const electron = electronBridge();
  if (!electron || !electron.document || !electron.document.extractText) {
    throw new Error('Document extraction is not available in this build. Open the PDF in the desktop app.');
  }
  const result = await electron.document.extractText(fsPath);
  if (result && result.error) throw new Error(result.error.message || 'The document could not be read.');
  const text = String(result && result.text || '').trim();
  if (text.length < 200) {
    throw new Error(text.length === 0
      ? 'No text was found in that document. If it is a scanned PDF, run OCR on it first.'
      : `Only ${text.length} characters of text could be read from that document. It looks scanned; run OCR on it first.`);
  }
  const pageTexts = Array.isArray(result.pageTexts) && result.pageTexts.length ? result.pageTexts.map((p) => String(p || '')) : [text];
  const pageCount = Number(result.metadata && result.metadata.pageCount) || pageTexts.length;
  const outline = Array.isArray(result.outline) ? result.outline : [];
  return { text, pageTexts, pageCount, outline };
}

/** Read a canvas page as markdown through the core command. Copy of fcReadCanvasPage. */
async function stReadCanvasPage(pageId) {
  const result = await _api.commands.executeCommand('canvas.getPageMarkdown', pageId);
  if (!result || !result.markdown) throw new Error('That canvas page could not be read. Pick a page with written notes.');
  const text = String(result.markdown).trim();
  if (text.length < 120) {
    throw new Error(`Only ${text.length} characters could be read from "${result.title || 'that page'}". Pick a page with written notes.`);
  }
  return { text, title: result.title || 'Untitled' };
}

/**
 * The material's text: { pageTexts, text, pageCount }. PDFs through the
 * extractor, canvas pages through the canvas command, banks empty. Cached in
 * memory per material id and content hash.
 */
async function stMaterialText(material) {
  if (!material) return { pageTexts: [], text: '', pageCount: 0 };
  const key = stTextCacheKey(material);
  const hit = _stTextCache.get(key);
  if (hit) return hit;
  let value;
  if (material.kind === 'pdf') {
    const ex = await stExtractPdf(stFsPathOf(material.uri));
    value = { pageTexts: ex.pageTexts, text: ex.text, pageCount: ex.pageCount };
  } else if (material.kind === 'canvas') {
    const page = await stReadCanvasPage(material.uri);
    value = { pageTexts: [page.text], text: page.text, pageCount: 1 };
  } else {
    value = { pageTexts: [], text: '', pageCount: 0 };
  }
  stTextCachePut(key, value);
  return value;
}

// ── Ingest ──────────────────────────────────────────────────────────────────

/** Sections as [{ title, pageFrom, pageTo, level }] clamped to the page count; one whole-document section when nothing usable came back. */
function stNormalizeSections(sections, pageCount) {
  const total = Math.max(1, Number(pageCount) || 1);
  const out = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s) continue;
    const from = Math.min(total, Math.max(1, Math.round(Number(s.pageFrom) || 1)));
    const to = Math.min(total, Math.max(from, Math.round(Number(s.pageTo) || from)));
    const title = String(s.title || '').trim() || `Pages ${from} to ${to}`;
    out.push({ title, pageFrom: from, pageTo: to, level: Number(s.level) || 0 });
  }
  if (!out.length) out.push({ title: total > 1 ? `Pages 1 to ${total}` : 'Page 1', pageFrom: 1, pageTo: total, level: 0 });
  return out;
}

/**
 * Ingest a PDF: extract, hash, find its sections (the PDF outline when the
 * extractor returns one, else the numbered-heading heuristic over the page
 * texts), store the material and its sections. Returns the material.
 */
async function stIngestPdf(fsPath) {
  const path = stFsPathOf(fsPath);
  const ex = await stExtractPdf(path);
  const contentHash = stHashText(ex.text);
  const raw = ex.outline.length
    ? stSectionsFromOutline(ex.outline, ex.pageCount)
    : stHeadingsFromPages(ex.pageTexts);
  const sections = stNormalizeSections(raw, ex.pageCount);
  const material = await stUpsertMaterial({
    kind: 'pdf',
    uri: stUriOf(path),
    label: stFileNameOf(path) || 'Document',
    pageCount: ex.pageCount,
    contentHash,
    outline: sections,
  });
  await stEnsureSections(material.id, sections);
  stTextCachePut(stTextCacheKey(material), { pageTexts: ex.pageTexts, text: ex.text, pageCount: ex.pageCount });
  return material;
}

/** Ingest a canvas page as a one-page material with one section. */
async function stIngestCanvasPage(pageId) {
  const page = await stReadCanvasPage(pageId);
  const contentHash = stHashText(page.text);
  const sections = [{ title: page.title, pageFrom: 1, pageTo: 1, level: 0 }];
  const material = await stUpsertMaterial({
    kind: 'canvas',
    uri: String(pageId),
    label: page.title,
    pageCount: 1,
    contentHash,
    outline: sections,
  });
  await stEnsureSections(material.id, sections);
  stTextCachePut(stTextCacheKey(material), { pageTexts: [page.text], text: page.text, pageCount: 1 });
  return material;
}

/** The FileType.Directory value of api.workspace.fs.readdir entries. */
const ST_FS_DIRECTORY = 2;

/**
 * Quick pick over every .pdf under the workspace folders. Walks
 * api.workspace.fs.readdir, skipping dot folders and node_modules, capped at
 * a few thousand entries. Returns the chosen fsPath or null.
 */
async function stPickWorkspacePdf() {
  const folders = (_api.workspace && _api.workspace.workspaceFolders) || [];
  const fs = _api.workspace && _api.workspace.fs;
  if (!folders.length || !fs || typeof fs.readdir !== 'function') {
    await _api.window.showInformationMessage('Open a workspace folder first.');
    return null;
  }
  const MAX = 3000;
  const found = [];
  const walk = async (dirUri, rel, depth) => {
    if (depth > 12 || found.length >= MAX) return;
    let entries;
    try { entries = await fs.readdir(dirUri); } catch { return; }
    for (const ent of entries || []) {
      if (found.length >= MAX) return;
      const name = String(ent.name || '');
      if (!name || name.startsWith('.') || name === 'node_modules') continue;
      const childUri = `${dirUri.replace(/\/$/, '')}/${name}`;
      const childRel = rel ? `${rel}/${name}` : name;
      if (ent.type === ST_FS_DIRECTORY) await walk(childUri, childRel, depth + 1);
      else if (stExtOf(name) === 'pdf') found.push({ name, rel: childRel, uri: childUri });
    }
  };
  for (const folder of folders) {
    const prefix = folders.length > 1 ? folder.name : '';
    await walk(String(folder.uri), prefix, 0);
  }
  if (!found.length) {
    await _api.window.showInformationMessage('No PDFs were found in this workspace.');
    return null;
  }
  found.sort((a, b) => a.rel.localeCompare(b.rel));
  const pick = await _api.window.showQuickPick(
    found.map((f) => ({ label: f.name, description: f.rel })),
    { placeholder: `Study which PDF? (${found.length} found)`, matchOnDescription: true },
  );
  if (!pick) return null;
  const chosen = found.find((f) => f.name === pick.label && f.rel === pick.description);
  return chosen ? stFsPathOf(chosen.uri) : null;
}

// ── Imports ─────────────────────────────────────────────────────────────────

const ST_IMPORT_KINDS = { essay: 'essay', short: 'short', mc: 'mc', numeric: 'numeric', formula: 'formula', cloze: 'cloze', quant: 'short', qual: 'essay', other: 'essay' };

/** "CAS Exam 7 · 2019 Fall · Q5(b)" from the pieces an import carries. */
function stOriginLabel({ exam, sitting, number, part, paper, label } = {}) {
  if (label) return String(label);
  const parts = [];
  if (exam) parts.push(String(exam));
  else if (paper) parts.push(String(paper));
  if (sitting) parts.push(String(sitting));
  if (number != null && number !== '') parts.push(`Q${number}${part ? `(${part})` : ''}`);
  return parts.join(' · ');
}

/** A parsed import entry (§7) as an StQuestion-shaped insert. */
function stImportedToQuestion(raw, { origin, bankId, sourceUri, providerId = '', providerRef = '' }) {
  const kind = String(raw.format || raw.kind || '').toLowerCase();
  let format = ST_IMPORT_KINDS[kind] || 'essay';
  const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o)) : [];
  if (format === 'mc' && options.length < 2) format = 'short';
  const rubric = stNormalizeRubric(raw.rubric);
  const extra = raw.extra && typeof raw.extra === 'object' ? raw.extra : null;
  return {
    materialId: 0,
    conceptId: 0,
    format,
    stem: String(raw.stem || raw.question || '').trim(),
    options,
    answer: raw.answer == null ? '' : String(raw.answer),
    explanation: String(raw.explanation || ''),
    rubric,
    rubricOrigin: rubric.length ? String(raw.rubricOrigin || 'source') : '',
    contradictions: Array.isArray(raw.contradictions) ? raw.contradictions.map((c) => String(c)) : [],
    numeric: null,
    sourcePage: Number(raw.sourcePage || raw.page) || 0,
    sourceQuote: String(raw.sourceQuote || ''),
    sourceUri: String(raw.sourceUri || sourceUri || ''),
    origin: String(raw.origin || origin),
    originLabel: stOriginLabel(raw),
    providerId,
    providerRef: providerRef || (raw.providerRef != null ? (typeof raw.providerRef === 'string' ? raw.providerRef : stJsonCol(raw.providerRef, '')) : (extra ? stJsonCol(extra, '') : '')),
    bankId,
    checks: {},
    difficulty: '',
    hidden: false,
    edited: false,
  };
}

/** Read a workspace file as text through api.workspace.fs. */
async function stReadWorkspaceFile(fsPath) {
  const fs = _api.workspace && _api.workspace.fs;
  if (!fs || typeof fs.readFile !== 'function') throw new Error('Workspace file access is not available in this build.');
  const res = await fs.readFile(stUriOf(stFsPathOf(fsPath)));
  return typeof res === 'string' ? res : String((res && res.content) || '');
}

/** Import a question file (.md, .csv, .tsv, .json) as a bank. Returns { bank, inserted }. */
async function stImportQuestionFile(fsPath) {
  const path = stFsPathOf(fsPath);
  const ext = stExtOf(path);
  if (!['md', 'csv', 'tsv', 'json', 'txt'].includes(ext)) {
    throw new Error('Pick a Markdown, CSV, TSV or JSON file of questions.');
  }
  const text = await stReadWorkspaceFile(path);
  const parsed = stParseQuestionFile(text, ext) || { questions: [], skipped: 0 };
  const entries = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (!entries.length) throw new Error('No questions were found in that file. Check its format in the Study help.');
  const bank = await stInsertBank({ name: stFileNameOf(path), kind: 'file', path, count: entries.length });
  const sourceUri = stUriOf(path);
  const rows = entries
    .map((raw) => stImportedToQuestion(raw, { origin: 'imported', bankId: bank.id, sourceUri }))
    .filter((q) => q.stem);
  const inserted = await stInsertQuestions(rows);
  await stSetBankCount(bank.id, inserted.length);
  return { bank: await stGetBank(bank.id), inserted: inserted.length, skipped: Number(parsed.skipped) || 0 };
}

/**
 * Import an examiner's report: extract its pages, parse the entries, match
 * them to the bank questions by exam, sitting, number and part, and write
 * each matched question's rubric and contradictions (origin 'report') with
 * the report as its source. Returns { bank, matched, unmatched }.
 */
async function stImportExaminerReport(fsPath, { modelId } = {}) {
  const path = stFsPathOf(fsPath);
  const ex = await stExtractPdf(path);
  const report = stParseExaminerReport(ex.pageTexts) || { exam: '', sitting: '', questions: [] };
  const entries = Array.isArray(report.questions) ? report.questions : [];
  if (!entries.length) throw new Error('No question entries were found in that report. Check that it is a CAS examiner\'s report PDF.');
  const bank = await stInsertBank({ name: stFileNameOf(path), kind: 'report', path, exam: report.exam || '', sitting: report.sitting || '', count: entries.length });
  const candidates = (await stListQuestions({ includeHidden: true })).filter((q) => q.origin !== 'generated');
  const matches = stMatchReportToQuestions(report, candidates) || [];
  const reportUri = stUriOf(path);
  let matched = 0;
  for (const m of matches) {
    const q = candidates.find((c) => c.id === m.questionId);
    if (!q || !m.entry) continue;
    const derived = await stRubricFromReport(m.entry, { modelId });
    if (!derived || !derived.rubric || !derived.rubric.length) continue;
    q.rubric = derived.rubric;
    q.contradictions = Array.isArray(derived.contradictions) ? derived.contradictions : [];
    q.rubricOrigin = 'report';
    q.sourceUri = reportUri;
    q.sourcePage = Number(m.entry.page) || 0;
    await stUpdateQuestion(q);
    matched += 1;
  }
  return { bank, matched, unmatched: entries.length - matched };
}

/**
 * Pull every question provider's items into st_questions with origin
 * 'provider' (idempotent by provider_id + provider_ref) and one st_banks
 * row per provider. Returns { providers, inserted, updated }.
 */
async function stSyncProviders(registry) {
  if (!registry || typeof registry.listQuestionProviders !== 'function') return { providers: 0, inserted: 0, updated: 0 };
  let providers;
  try { providers = registry.listQuestionProviders() || []; } catch { providers = []; }
  let inserted = 0;
  let updated = 0;
  const banks = await stListBanks();
  for (const p of providers) {
    if (!p || !p.id || typeof p.list !== 'function') continue;
    let items;
    try { items = await p.list({ limit: 2000 }); } catch (err) {
      console.warn(`[Study] provider ${p.id} failed to list:`, err && err.message);
      continue;
    }
    if (!Array.isArray(items)) continue;
    let bank = banks.find((b) => b.kind === 'provider' && b.providerId === p.id);
    if (!bank) {
      bank = await stInsertBank({ name: String(p.displayName || p.id), kind: 'provider', providerId: p.id, count: 0 });
      banks.push(bank);
    }
    const existing = await db.all('SELECT * FROM st_questions WHERE provider_id = ?', [p.id]);
    const byRef = new Map(existing.map((r) => [String(r.provider_ref), stRowToQuestion(r)]));
    const rows = [];
    for (const item of items) {
      if (!item || item.ref == null) continue;
      const ref = String(item.ref);
      const mapped = stImportedToQuestion({
        kind: item.kind,
        question: item.question,
        answer: item.answer,
        rubric: item.rubric,
        paper: item.paper,
        source: item.source,
        exam: item.exam,
        sitting: item.sitting,
        number: item.number,
        part: item.part,
        label: item.label,
        sourceUri: item.sourceUri,
        sourcePage: item.sourcePage,
      }, { origin: 'provider', bankId: bank.id, providerId: p.id, providerRef: ref });
      if (!mapped.stem) continue;
      const prior = byRef.get(ref);
      if (prior) {
        const changed = prior.stem !== mapped.stem || prior.answer !== mapped.answer || prior.originLabel !== mapped.originLabel
          || prior.format !== mapped.format || stJsonCol(prior.rubric, '') !== stJsonCol(mapped.rubric, '');
        if (changed && !prior.edited) {
          await stUpdateQuestion({ ...prior, stem: mapped.stem, answer: mapped.answer, format: mapped.format, originLabel: mapped.originLabel,
            rubric: mapped.rubric.length ? mapped.rubric : prior.rubric, rubricOrigin: mapped.rubric.length ? 'source' : prior.rubricOrigin,
            sourceUri: mapped.sourceUri || prior.sourceUri, sourcePage: mapped.sourcePage || prior.sourcePage });
          updated += 1;
        }
      } else {
        rows.push(mapped);
      }
    }
    if (rows.length) {
      await stInsertQuestions(rows);
      inserted += rows.length;
    }
    const count = await db.get('SELECT COUNT(*) AS n FROM st_questions WHERE provider_id = ?', [p.id]);
    await stSetBankCount(bank.id, (count && count.n) || 0);
  }
  return { providers: providers.length, inserted, updated };
}

// ── Weak concepts ───────────────────────────────────────────────────────────

/**
 * Concepts across every material that have been answered, weak first
 * (lowest mastery first), then stale, then clean. Each carries `state`.
 */
async function stWeakConcepts({ limit = 50 } = {}) {
  const rows = await db.all('SELECT * FROM st_concepts WHERE answers > 0 ORDER BY mastery ASC, last_answered_at ASC');
  const now = stNow();
  const staleDays = Number(cfg('staleDays', 14)) || 14;
  const rank = { weak: 0, stale: 1, clean: 2, unasked: 3 };
  const list = rows.map((r) => {
    const c = stRowToConcept(r);
    c.state = stConceptState(c, now, { staleDays });
    return c;
  });
  list.sort((a, b) => (rank[a.state] - rank[b.state]) || (a.mastery - b.mastery) || (a.lastAnsweredAt - b.lastAnsweredAt));
  return list.slice(0, Math.max(1, Number(limit) || 50));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 30: AI LAYER
// ═══════════════════════════════════════════════════════════════════════════════
//
// Prompts, the generation pipeline and its four checks, grading, explain,
// rubric derivation, numeric execution through the Python bridge, and the
// two orchestrators the pane calls (stEnsureBank, stNextDraw).
//
// Every model call picks a model (stPickModel), plans its context window
// (stContextPlan from 10-model.js with the material's setting), sends
// { temperature, numCtx, think, format: 'json' when JSON is wanted }, streams
// through stStreamWithStall and parses with the 10-model.js extractors. No
// raw model text ever reaches the user: a failure is a thrown Error with a
// plain sentence, or a { error } result.
//
// Patterns copied from ext/flashcards/main.js SECTION 5: fcPickModel,
// fcModelContextLength, fcStreamWithStall (same timeouts), the generation
// prompt's rules (one atomic idea, never invent, the garbled-maths
// exception), the M102 marker prompt and its per-point statuses, the rubric
// prompt. Renamed to st and extended with the anchor, support, distractor
// and numeric checks of the brief (§7.2).

// ── Constants ───────────────────────────────────────────────────────────────

/** Temperatures: writing is allowed some variety; checks and grading are not. */
const ST_TEMP_GENERATE = 0.3;
const ST_TEMP_CHECK = 0;
const ST_TEMP_RUBRIC = 0.1;

/** Output reserves, in tokens, for the context plan. */
const ST_MAP_OUTPUT_TOKENS = 2400;
const ST_QUESTION_OUTPUT_BASE = 400;
const ST_QUESTION_OUTPUT_PER = 320;
const ST_SMALL_OUTPUT_TOKENS = 700;
/** Pages per concept-map chunk, as characters: about eight pages of dense text. */
const ST_MAP_CHUNK_CHARS = 24000;
/** Questions asked for in one generation call, at most. */
const ST_ASK_PER_CALL = 24;
/** Generation passes over a scope before giving up on a format the model cannot write. */
const ST_MAX_PASSES = 3;
/** Concept titles this similar (Dice over bigrams of the skeleton) are one concept. */
const ST_TITLE_SIMILARITY = 0.85;

/**
 * The Python bridge's scratch directory, relative to the workspace root.
 * Copied from electron/pythonBridge.cjs: TMP_REL = path.join('.parallx', 'tmp').
 * The bridge only runs .py files inside the workspace and outside its venv,
 * so the check scripts live under its own tmp folder.
 */
const ST_TMP_REL = '.parallx/tmp';
const ST_NUMERIC_TIMEOUT_MS = 20000;

// ── Model choice and options ────────────────────────────────────────────────

/** material.model, then study.aiModel, then the chat's active model, then the first model listed. */
async function stPickModel(material) {
  const remembered = String((material && material.model) || '').trim();
  if (remembered) return remembered;
  const configured = String(cfg('aiModel', '') || '').trim();
  if (configured) return configured;
  try {
    const active = _api.lm && typeof _api.lm.getActiveModel === 'function' ? await _api.lm.getActiveModel() : undefined;
    if (active) return String(active);
  } catch { /* fall through */ }
  try {
    const models = await _api.lm.getModels();
    if (models && models.length > 0) return models[0].id;
  } catch { /* fall through */ }
  return null;
}

/** The model's real context length, or 0 when the probe fails. Cached per model. */
const _stModelCtx = new Map();
async function stModelContextLength(modelId) {
  if (_stModelCtx.has(modelId)) return _stModelCtx.get(modelId);
  let n = 0;
  try {
    if (_api.lm && typeof _api.lm.getModelInfo === 'function') {
      const info = await _api.lm.getModelInfo(modelId);
      n = (info && info.contextLength) || 0;
    }
  } catch { /* unknown */ }
  if (n > 0) _stModelCtx.set(modelId, n);
  return n;
}

/** The context setting for a run: the sheet's choice, else the material's, else Settings; 0 = auto. */
function stContextSettingFor(material, numCtx) {
  return Number(numCtx) || Number(material && material.contextSetting) || Number(cfg('generationContext', 0)) || 0;
}

/** Plan one call's window. */
async function stPlanFor(modelId, material, chars, outputTokens, numCtx) {
  const modelCtx = await stModelContextLength(modelId);
  return stContextPlan({ chars, outputTokens, modelCtx, setting: stContextSettingFor(material, numCtx) });
}

/**
 * Consume an LM stream with a stall watchdog. Copy of fcStreamWithStall:
 * the extension LM API has no AbortSignal, so a hung backend would leave a
 * spinner alive forever. The first chunk gets a longer leash because a cold
 * model load takes minutes.
 */
async function stStreamWithStall(stream, onChunk, stallMs = 90000, firstChunkMs = 240000) {
  const it = stream[Symbol.asyncIterator]();
  let sawChunk = false;
  for (;;) {
    const limit = sawChunk ? stallMs : Math.max(stallMs, firstChunkMs);
    let timer;
    const stall = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `The model stopped responding (no output for ${Math.round(limit / 1000)} seconds). Check that the model backend is running.`,
      )), limit);
    });
    const next = it.next();
    next.catch(() => { /* orphaned after a stall; already surfaced */ });
    let step;
    try {
      step = await Promise.race([next, stall]);
    } catch (err) {
      try { void (it.return && it.return()); } catch { /* generator already closed */ }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (step.done) return;
    sawChunk = true;
    onChunk(step.value);
  }
}

/** One chat call, collected to a string. `json` asks the backend for JSON output. */
async function stChat(modelId, system, user, { temperature = ST_TEMP_CHECK, numCtx = 0, json = true, onChunk = null } = {}) {
  if (!_api.lm || typeof _api.lm.sendChatRequest !== 'function') {
    throw new Error('No model backend is available. Start the model backend and try again.');
  }
  const options = { temperature, think: !!cfg('aiThinking', false) };
  if (numCtx > 0) options.numCtx = numCtx;
  if (json) options.format = 'json';
  let output = '';
  const stream = _api.lm.sendChatRequest(modelId, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], options);
  await stStreamWithStall(stream, (chunk) => {
    if (chunk && chunk.content) {
      output += chunk.content;
      if (onChunk) { try { onChunk(chunk.content); } catch { /* listener error is not ours */ } }
    }
  });
  return output;
}

/** The first array inside the model's JSON object, else a bare array; [] when nothing parses. */
function stJsonArrayFrom(text) {
  const obj = stExtractJsonObject(text);
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) return obj[key];
    }
  }
  let res = null;
  try { res = stExtractJsonArray(text, (parsed) => parsed); } catch { res = null; }
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.items)) return res.items;
  return [];
}

function stJsonObjectFrom(text) {
  const obj = stExtractJsonObject(text);
  return obj && typeof obj === 'object' ? obj : null;
}

/** An error the user can read: never the model's text, never a stack. */
function stPlainError(err) {
  const msg = String((err && err.message) || err || '').trim();
  if (!msg) return 'Something went wrong while making questions. Try again.';
  if (msg.startsWith('[ST-DB]')) return 'The study database could not be written. Restart Parallx and try again.';
  return /[.!?]$/.test(msg) ? msg : `${msg}.`;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const ST_CONCEPT_SYSTEM = [
  'You read a passage of study material and list the concepts it actually teaches: the ideas, methods, definitions, results and assumptions a student is expected to know after reading it.',
  'Rules:',
  '- One entry per concept. Between 3 and 15 for a passage of a few pages; fewer when the passage is thin. Never pad, never split one idea into two.',
  '- "title": a short noun phrase naming the concept, as the text names it.',
  '- "summary": one sentence stating the concept as the text states it. Never add a claim the passage does not make.',
  '- "page": the number from the [Page N] marker the concept is taught under.',
  '- "quote": a short sentence or clause copied verbatim from that page that states the concept. Copy the words exactly as they appear, including odd spacing from extraction. Never paraphrase a quote.',
  '- "essayWorthy": true when the concept is a mechanism, a comparison, a derivation or a why, something a paragraph could explain; false for a bare fact or a term.',
  '- "quantitative": true when the text gives a calculation with inputs and a result a student could reproduce with numbers; false otherwise.',
  '- "hasFormula": true when the concept is stated as a formula or equation in the text.',
  '- "term": the single term a definition names, when the concept is a definition; otherwise an empty string.',
  '- Formulas in LaTeX between $...$. Never use em dashes.',
  '- Exception for garbled maths: PDF extraction mangles formulas (lost superscripts and subscripts, broken Greek letters, flattened fractions). When the passage clearly names a formula but its text is corrupted, write the formula in its standard form in the summary; the quote stays verbatim.',
  'Output only this JSON object, no prose:',
  '{"concepts": [{"title": "...", "summary": "...", "page": 17, "quote": "...", "essayWorthy": false, "quantitative": false, "hasFormula": false, "term": ""}]}',
].join('\n');

const ST_QUESTION_SYSTEM = [
  'You write questions that test whether a student understands study material: one concept per question, every question anchored to a verbatim quote from the page that settles its answer.',
  'Rules for every question:',
  '- One concept per question. "concept" is the id of the concept it tests, from the list you are given. Write only the formats and counts asked for each concept.',
  '- Never invent a fact. Everything in the stem, the answer and the explanation must be stated or directly implied by the material.',
  '- "quote": one sentence or clause copied verbatim from the page that settles the answer, and "page": the number from its [Page N] marker. Copy the words exactly; never paraphrase, never merge two places into one quote.',
  '- "explanation": one or two sentences grounded in the quote saying why the answer is right.',
  '- Formulas in LaTeX between $...$. Never use em dashes. Never use absolute words such as always, never, all or none in a stem or an option.',
  '- Exception for garbled maths: when the material clearly names a formula but extraction corrupted it, write the formula in its standard form in clean LaTeX instead of copying the garble. Repairing a known formula is not inventing a fact.',
  'Multiple choice ("mc"):',
  '- Exactly the number of options asked for, one of them correct. "answer" is the index of the correct option, counting from 0.',
  '- Distractors are competitive: semantically close to the answer, about the same length and form, each a plausible misreading of the text that a careful reader can still rule out. No "all of the above", no "none of the above", no joke options, no option that is also correct.',
  '- "difficulty": easy, medium or hard.',
  'Short answer ("short"): answered in one or two sentences. "answer" is the model answer. "rubric" lists the 1 to 4 claims a correct answer must make, each {"text": "...", "required": true}; a claim, not a topic.',
  'Essay ("essay"): answered in a paragraph: explain a mechanism, compare two methods, justify an assumption. "answer" is a model answer of a few sentences. "rubric" lists the 3 to 6 claims a complete answer makes, with "required": false on supporting detail.',
  'Numeric ("numeric"): a calculation the text gives inputs for. "inputs" is an object of named numbers, "solutionPy" a Python function "def solve(i):" computing the answer from i, the inputs dict, using only arithmetic and the math module, "expected" the number it returns, "units" a short unit string or "".',
  'Formula ("formula"): asks the student to state a formula. "answer" is the formula in LaTeX.',
  'Fill in the blank ("cloze"): a sentence from the material with one defined term replaced by ____. "answer" is the term; "aliases" lists other spellings the text uses.',
  'Output only this JSON object, no prose:',
  '{"questions": [',
  ' {"concept": 12, "format": "mc", "stem": "...", "options": ["...", "...", "...", "..."], "answer": 0, "explanation": "...", "quote": "...", "page": 17, "difficulty": "medium"},',
  ' {"concept": 12, "format": "short", "stem": "...", "answer": "...", "rubric": [{"text": "...", "required": true}], "explanation": "...", "quote": "...", "page": 17},',
  ' {"concept": 12, "format": "essay", "stem": "...", "answer": "...", "rubric": [{"text": "...", "required": true}, {"text": "...", "required": false}], "explanation": "...", "quote": "...", "page": 17},',
  ' {"concept": 12, "format": "numeric", "stem": "...", "inputs": {"premium": 1000, "elr": 0.65}, "solutionPy": "def solve(i):\\n    return i[\'premium\'] * i[\'elr\']", "expected": 650, "units": "", "explanation": "...", "quote": "...", "page": 16},',
  ' {"concept": 12, "format": "formula", "stem": "...", "answer": "G(x) = \\\\frac{x^\\\\omega}{x^\\\\omega + \\\\theta^\\\\omega}", "explanation": "...", "quote": "...", "page": 8},',
  ' {"concept": 12, "format": "cloze", "stem": "The ____ method fits one expected loss ratio for every year.", "answer": "Cape Cod", "aliases": ["Cape-Cod"], "explanation": "...", "quote": "...", "page": 15}',
  ']}',
].join('\n');

const ST_SUPPORT_SYSTEM = [
  'You check whether a quotation from a text settles the answer to a question. You are given only the quotation, the question and the proposed answer; nothing else counts.',
  '"settles" is true only when a careful reader who had read the quotation alone, and nothing else, would arrive at exactly that answer.',
  'It is false when the quotation is about something else, when it supports the answer only with outside knowledge, when it supports a different answer, or when it is too vague to decide.',
  'Be strict: a quotation that merely mentions the topic does not settle the answer.',
  'Output only this JSON object, no prose:',
  '{"settles": true, "reason": "one short sentence"}',
].join('\n');

const ST_DISTRACTOR_SYSTEM = [
  'You check one option of a multiple-choice question. You are given the question, a quotation from the source text, and one option that is meant to be wrong.',
  '"defensible" is true when a well-prepared student could reasonably argue, from the quotation or from standard knowledge of the subject, that this option is a correct answer to the question.',
  'It is false when the option is clearly wrong, contradicts the quotation, or answers a different question.',
  'An option that is partly right but misses what the question asks is not defensible. An option that is as right as the intended answer is defensible.',
  'Output only this JSON object, no prose:',
  '{"defensible": false, "reason": "one short sentence"}',
].join('\n');

const ST_GRADE_SYSTEM = [
  'You mark a student\'s written answer against a fixed list of points. You are a marker, not a teacher.',
  'For each point, in order, decide whether the student\'s answer contains it:',
  '- "hit": the point is there. Different wording, different order and imperfect spelling are all fine.',
  '- "partial": the idea is there but incomplete, hedged, or missing the part that makes it true.',
  '- "miss": the point is absent.',
  'Mark meaning only. Never reward fluent writing that says nothing, and never penalise terse writing that says everything.',
  'A formula point is "hit" when the student\'s formula is mathematically equivalent however it is written, "partial" when the structure is right with a notation slip, a wrong constant or a wrong index, and "miss" when it is a different formula.',
  'Set "contradiction": true only when the answer asserts something the source quotation or the reference answer denies, or states one of the listed errors: a wrong direction, a wrong sign, a reversed causal claim, a false condition. An omission is never a contradiction.',
  'Write "note": one short sentence naming what was missing or wrong, addressed to the student. Empty when every point was hit.',
  'Never award a point that is not in the list, and never invent points. Never use em dashes.',
  'Output only this JSON object, no prose:',
  '{"points": [{"status": "hit", "note": "..."}], "contradiction": false, "note": "..."}',
].join('\n');

const ST_EXPLAIN_SYSTEM = [
  'You explain, in two to four plain sentences, why the right answer to a study question is right, using only the quotation from the source you are given.',
  'Start from what the quotation says, then connect it to the answer. When the student chose or wrote something else, say in one sentence where that went wrong, without scolding.',
  'Never add a fact the quotation does not state or directly imply; when the quotation does not cover a point, say that the text does not say.',
  'Formulas in LaTeX between $...$. No headings, no lists, no em dashes. Plain prose only.',
].join('\n');

const ST_RUBRIC_SYSTEM = [
  'You reduce a model answer to the points a student must state to have answered the question and, when common errors are given, to the statements that mark an answer wrong.',
  'Rules:',
  '- One point per idea. Between 2 and 6 points; fewer only when the answer genuinely holds fewer.',
  '- A point is a claim, not a topic: "variance is proportional to the prior column", not "variance".',
  '- Mark "required": false for supporting detail a complete answer could omit. Mark the load-bearing claims required.',
  '- Never add a point the answer does not make.',
  '- "contradictions": each common error as one short statement a wrong answer would assert; [] when none were given.',
  '- Never use em dashes.',
  'Output only this JSON object, no prose:',
  '{"rubric": [{"text": "...", "required": true}], "contradictions": ["..."]}',
].join('\n');

// ── Material blocks ─────────────────────────────────────────────────────────

/**
 * Pages `from`..`to` tagged [Page N], whole pages first, clipped to
 * maxChars. `focus` is kept even when the neighbours are dropped; a page
 * that alone exceeds the limit is cut with a marker, so a tag never lies.
 */
function stPageBlock(pageTexts, from, to, maxChars, focus = 0) {
  const pages = [];
  for (let p = from; p <= to; p++) {
    const text = String((pageTexts && pageTexts[p - 1]) || '').trim();
    if (text) pages.push({ page: p, text });
  }
  if (!pages.length) return { material: '', chars: 0, pages: [] };
  const order = focus
    ? [...pages].sort((a, b) => Math.abs(a.page - focus) - Math.abs(b.page - focus) || a.page - b.page)
    : pages;
  const kept = [];
  let used = 0;
  for (const p of order) {
    const block = `[Page ${p.page}]\n${p.text}`;
    if (used + block.length > maxChars) {
      if (!kept.length) {
        const room = Math.max(200, maxChars - 40);
        kept.push({ page: p.page, block: block.slice(0, room) + '\n[...page truncated...]' });
        used += room;
      }
      continue;
    }
    kept.push({ page: p.page, block });
    used += block.length + 2;
  }
  kept.sort((a, b) => a.page - b.page);
  return { material: kept.map((k) => k.block).join('\n\n'), chars: used, pages: kept.map((k) => k.page) };
}

// ── Concept flags ───────────────────────────────────────────────────────────

/**
 * Which formats a concept can carry, as the concept-map prompt flagged it.
 * st_concepts has no column for the flags, so they live here per concept id
 * for the life of the app and are re-derived from the stored text when the
 * map was built in an earlier run.
 */
const _stConceptFlags = new Map();

function stConceptFlags(concept) {
  if (!concept) return { essayWorthy: false, quantitative: false, hasFormula: false, term: '' };
  const cached = _stConceptFlags.get(concept.id);
  if (cached) return cached;
  const summary = String(concept.summary || '');
  const quote = String(concept.anchorQuote || '');
  const title = String(concept.title || '').trim();
  const both = `${summary} ${quote}`;
  const derived = {
    essayWorthy: /\b(because|why|mechanism|compar|versus|differ|assum|deriv|explain|advantage|disadvantage|trade-?off|depends|leads to|results in)\b/i.test(summary) || summary.length > 140,
    quantitative: /\d/.test(both) && /(=|\bcalculat|\bcomput|\bratio\b|\bpercent|%|\bmultipl|\bdivid|\bsum of\b|\bproduct of\b)/i.test(both),
    hasFormula: /(\$|\\[a-zA-Z]+|[a-zA-Z]\s*=\s*[^=]|\^|_\{)/.test(both),
    term: title.split(/\s+/).length <= 4 && /\b(is|are|means|refers|defined|called|denotes)\b/i.test(summary) ? title : '',
  };
  _stConceptFlags.set(concept.id, derived);
  return derived;
}

function stRememberFlags(conceptId, raw) {
  _stConceptFlags.set(conceptId, {
    essayWorthy: !!(raw && raw.essayWorthy),
    quantitative: !!(raw && raw.quantitative),
    hasFormula: !!(raw && raw.hasFormula),
    term: String((raw && raw.term) || '').trim(),
  });
}

/** mc and short always; essay, numeric, formula and cloze as the flags and Python allow. */
function stApplicableFormats(concept, pythonAvailable) {
  const flags = stConceptFlags(concept);
  const out = ['mc', 'short'];
  if (flags.essayWorthy) out.push('essay');
  if (flags.quantitative && pythonAvailable) out.push('numeric');
  if (flags.hasFormula) out.push('formula');
  if (flags.term) out.push('cloze');
  return out;
}

// ── Title similarity ────────────────────────────────────────────────────────

function stBigrams(s) {
  const out = new Map();
  for (let i = 0; i + 1 < s.length; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Dice coefficient over character bigrams of two skeletons. */
function stTitleSimilarity(a, b) {
  const sa = stSkeleton(a);
  const sb = stSkeleton(b);
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  if (sa.length >= 6 && sb.length >= 6 && (sa.includes(sb) || sb.includes(sa))) return 1;
  const ga = stBigrams(sa);
  const gb = stBigrams(sb);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) || 0);
  return (2 * shared) / Math.max(1, (sa.length - 1) + (sb.length - 1));
}

function stFindSimilarConcept(title, concepts) {
  for (const c of concepts) {
    if (stTitleSimilarity(title, c.title) >= ST_TITLE_SIMILARITY) return c;
  }
  return null;
}

// ── Concept map ─────────────────────────────────────────────────────────────

/**
 * Build the concept map for a section (or for a selection, given as the only
 * chunk). Per chunk the model lists concepts with a page and a verbatim
 * quote; the quote is located with stFindAnchorPage; titles are deduplicated
 * against the material's existing concepts and each other; new ones are
 * inserted and the section marked mapped. Returns the unit's concepts:
 * the existing matches plus the new rows.
 */
async function stBuildConceptMap(material, section, { modelId, numCtx = 0, token, onProgress, selectionText = '', selectionPage = 0 } = {}) {
  const cancelled = () => !!(token && token.cancelled);
  const model = modelId || await stPickModel(material);
  if (!model) throw new Error('No model is available. Pick a model in Settings or start the model backend.');
  const text = await stMaterialText(material);
  const existing = await stListConcepts({ materialIds: [material.id] });
  const report = (done, total) => {
    const p = { phase: 'map', done, total, written: 0, kept: 0, dropped: {}, materialId: material.id, sectionId: section ? section.id : 0 };
    if (onProgress) { try { onProgress(p); } catch { /* listener error is not ours */ } }
    try { bus.emit('run', p); } catch { /* bus is optional here */ }
  };

  // The chunks: page ranges of the section, or the selection as one chunk.
  let chunks;
  if (selectionText) {
    const page = Number(selectionPage) || 0;
    chunks = [{ pageFrom: page, pageTo: page, text: `[Page ${page || 1}]\n${String(selectionText).trim()}` }];
  } else {
    const from = Math.max(1, Number(section.pageFrom) || 1);
    const to = Math.max(from, Math.min(text.pageTexts.length || from, Number(section.pageTo) || from));
    const cap = await stPlanFor(model, material, ST_MAP_CHUNK_CHARS, ST_MAP_OUTPUT_TOKENS, numCtx);
    const maxChars = Math.min(ST_MAP_CHUNK_CHARS, cap.maxChars);
    const ranges = stChunkPages(text.pageTexts, { from, to, maxChars }) || [];
    chunks = ranges.map((r) => {
      const block = stPageBlock(text.pageTexts, r.pageFrom, r.pageTo, maxChars);
      return { pageFrom: r.pageFrom, pageTo: r.pageTo, text: block.material };
    }).filter((c) => c.text.trim());
    if (!chunks.length) {
      const block = stPageBlock(text.pageTexts, from, to, maxChars);
      if (block.material.trim()) chunks = [{ pageFrom: from, pageTo: to, text: block.material }];
    }
  }
  if (!chunks.length) throw new Error('This section has no readable text to map.');

  const found = [];   // new concepts to insert: { title, summary, page, anchorQuote, flags }
  const matched = []; // existing concepts the chunk named again
  const pool = [...existing];
  report(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    if (cancelled()) break;
    const chunk = chunks[i];
    const plan = await stPlanFor(model, material, chunk.text.length, ST_MAP_OUTPUT_TOKENS, numCtx);
    const user = [
      selectionText
        ? 'The material below is a passage the student selected. List the concepts it teaches.'
        : `The material below is pages ${chunk.pageFrom} to ${chunk.pageTo}${section && section.title ? ` of "${section.title}"` : ''}. List the concepts it teaches.`,
      'Every "page" must be a [Page N] marker that appears in the material.',
      '',
      '--- MATERIAL ---',
      chunk.text,
    ].join('\n');
    const output = await stChat(model, ST_CONCEPT_SYSTEM, user, { temperature: ST_TEMP_GENERATE, numCtx: plan.numCtx, json: true });
    const raws = stJsonArrayFrom(output);
    for (const raw of raws) {
      if (!raw || typeof raw !== 'object') continue;
      const title = String(raw.title || '').trim();
      if (!title) continue;
      const summary = String(raw.summary || '').trim();
      const quote = String(raw.quote || '').trim();
      let page = Number(raw.page) || 0;
      if (selectionText) {
        page = Number(selectionPage) || 0;
      } else {
        const hint = page >= chunk.pageFrom && page <= chunk.pageTo ? page : chunk.pageFrom;
        const located = quote ? stFindAnchorPage(quote, text.pageTexts, hint) : 0;
        page = located || hint;
      }
      const anchorQuote = quote && (selectionText || stAnchorPageFor(quote, text.pageTexts, page)) ? quote : '';
      const prior = stFindSimilarConcept(title, pool);
      if (prior) {
        if (!matched.includes(prior)) matched.push(prior);
        if (!_stConceptFlags.has(prior.id)) stRememberFlags(prior.id, raw);
        continue;
      }
      const entry = { title, summary, page, anchorQuote, flags: raw };
      found.push(entry);
      pool.push({ id: 0, title });
    }
    report(i + 1, chunks.length);
  }

  const inserted = found.length
    ? await stInsertConcepts(material.id, section ? section.id : 0, found.map(({ title, summary, page, anchorQuote }) => ({ title, summary, page, anchorQuote })))
    : [];
  for (let i = 0; i < inserted.length; i++) stRememberFlags(inserted[i].id, found[i] && found[i].flags);
  if (section && section.id && !cancelled()) await stMarkSectionMapped(section.id, stNow());
  return [...matched, ...inserted];
}

/** The page a quote is on: the hinted page when the quote is there, else the located one, else 0. */
function stAnchorPageFor(quote, pageTexts, hintPage) {
  if (!quote || !Array.isArray(pageTexts) || !pageTexts.length) return 0;
  const idx = (Number(hintPage) || 0) - 1;
  if (idx >= 0 && idx < pageTexts.length) {
    const r = stAnchorOnPage(quote, String(pageTexts[idx] || ''));
    if (r && r.ok) return idx + 1;
  }
  return stFindAnchorPage(quote, pageTexts, Number(hintPage) || 0) || 0;
}

// ── Checks ──────────────────────────────────────────────────────────────────

/** The answer as text, for the support check. */
function stAnswerText(q) {
  switch (q.format) {
    case 'mc': return String((Array.isArray(q.options) ? q.options[Number(q.answer)] : '') || '');
    case 'numeric': return `${q.expected != null ? q.expected : q.answer}${q.units ? ` ${q.units}` : ''}`;
    default: return String(q.answer || '');
  }
}

/** Shown only the quote, the stem and the answer: does the quote settle it? */
async function stCheckSupport(modelId, q, { material, numCtx } = {}) {
  const user = [
    'Quotation:',
    String(q.quote || ''),
    '',
    'Question:',
    String(q.stem || ''),
    '',
    'Proposed answer:',
    stAnswerText(q),
  ].join('\n');
  const plan = await stPlanFor(modelId, material, user.length, ST_SMALL_OUTPUT_TOKENS, numCtx);
  const output = await stChat(modelId, ST_SUPPORT_SYSTEM, user, { temperature: ST_TEMP_CHECK, numCtx: plan.numCtx, json: true });
  const raw = stJsonObjectFrom(output);
  // An unreadable verdict is not evidence for the question: treat it as unsettled.
  if (!raw) return { settles: false, reason: 'The check gave no verdict.' };
  return { settles: raw.settles === true || raw.settles === 'true', reason: String(raw.reason || '') };
}

/** Each wrong option alone with the stem: could it be defended as correct? */
async function stCheckDistractors(modelId, q, { material, numCtx } = {}) {
  const prompts = stDistractorPrompts(q) || [];
  for (const d of prompts) {
    const user = [
      'Question:',
      String(d.stem || q.stem || ''),
      '',
      'Quotation from the source:',
      String(q.quote || ''),
      '',
      'Option to check:',
      String(d.option || ''),
    ].join('\n');
    const plan = await stPlanFor(modelId, material, user.length, ST_SMALL_OUTPUT_TOKENS, numCtx);
    const output = await stChat(modelId, ST_DISTRACTOR_SYSTEM, user, { temperature: ST_TEMP_CHECK, numCtx: plan.numCtx, json: true });
    const raw = stJsonObjectFrom(output);
    if (!raw) return { defensible: true, optionIndex: d.optionIndex, reason: 'The check gave no verdict.' };
    if (raw.defensible === true || raw.defensible === 'true') {
      return { defensible: true, optionIndex: d.optionIndex, reason: String(raw.reason || '') };
    }
  }
  return { defensible: false, optionIndex: -1, reason: '' };
}

// ── Numeric execution ───────────────────────────────────────────────────────

/** Whether the workspace Python environment exists (and Python is not switched off). */
async function stPythonAvailable() {
  const electron = electronBridge();
  const root = stWorkspaceRoot();
  if (!electron || !electron.python || typeof electron.python.status !== 'function' || !root) return false;
  try {
    const conf = _api.workspace && typeof _api.workspace.getConfiguration === 'function' ? _api.workspace.getConfiguration('python') : null;
    if (conf && typeof conf.get === 'function' && conf.get('enabled') === false) return false;
  } catch { /* no such setting here */ }
  try {
    const s = await electron.python.status(root);
    return !!(s && (s.envExists || s.exists));
  } catch {
    return false;
  }
}

/**
 * A model-written solution is run in the user's environment, so it is held
 * to the shape the prompt asked for: a solve() over arithmetic and math,
 * nothing that reaches the file system, the network or the interpreter.
 */
function stNumericSolutionSafe(py) {
  const src = String(py || '');
  if (!/def\s+solve\s*\(/.test(src)) return { ok: false, reason: 'The solution does not define solve().' };
  if (/^\s*(import|from)\s+(?!math\b)/m.test(src)) return { ok: false, reason: 'The solution imports a module other than math.' };
  if (/(__|\bopen\s*\(|\bexec\s*\(|\beval\s*\(|\bcompile\s*\(|\binput\s*\(|\bos\b|\bsys\b|\bsubprocess\b|\bsocket\b|\bshutil\b|\bpathlib\b|\bglobals\s*\(|\bgetattr\s*\(|\bbreakpoint\s*\()/.test(src)) {
    return { ok: false, reason: 'The solution uses something a calculation does not need.' };
  }
  if (src.length > 4000) return { ok: false, reason: 'The solution is too long to be a calculation.' };
  return { ok: true, reason: '' };
}

/** The script: the inputs, the model's solve(), one JSON line on stdout. */
function stNumericScript(numeric) {
  const inputs = numeric && numeric.inputs && typeof numeric.inputs === 'object' ? numeric.inputs : {};
  const literal = JSON.stringify(JSON.stringify(inputs));
  return [
    'import json',
    'import math',
    `INPUTS = json.loads(${literal})`,
    '',
    String(numeric.solutionPy || '').replace(/\r\n?/g, '\n'),
    '',
    'try:',
    '    _v = solve(INPUTS)',
    '    print(json.dumps({"value": _v if isinstance(_v, (int, float)) else float(_v)}))',
    'except Exception as _e:',
    '    print(json.dumps({"error": str(_e)}))',
    '',
  ].join('\n');
}

/** Make sure each directory of a workspace-relative path exists, best effort. */
async function stEnsureWorkspaceDirs(fs, rootSlash, relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let rel = '';
  for (const part of parts) {
    rel = rel ? `${rel}/${part}` : part;
    const uri = stUriOf(`${rootSlash}/${rel}`);
    try {
      if (typeof fs.exists === 'function' && await fs.exists(uri)) continue;
      await fs.mkdir(uri);
    } catch { /* may already exist, or the write will say so */ }
  }
}

/**
 * Run a script through the Python bridge and collect its output. The bridge
 * returns { ok, runId } at once; stdout arrives on python:run:data and the
 * end on python:run:exit (parallxElectron.python.onRunData / onRunExit), so
 * both are subscribed before the start and buffered by run id until the id
 * is known. `timeout` is the bridge's stall limit; a second timer here
 * cancels the run if the exit never arrives.
 */
function stRunPythonScript(workspaceRoot, scriptPath, timeout) {
  const py = electronBridge() && electronBridge().python;
  if (!py || typeof py.runScript !== 'function' || typeof py.onRunData !== 'function' || typeof py.onRunExit !== 'function') {
    return Promise.resolve({ stdout: '', stderr: '', exitCode: -1, error: 'Python output is not available in this build.' });
  }
  return new Promise((resolve) => {
    const buckets = new Map();
    const bucket = (id) => {
      if (!buckets.has(id)) buckets.set(id, { out: '', err: '', exit: null });
      return buckets.get(id);
    };
    let runId = null;
    let settled = false;
    let timer = null;
    let offData = () => {};
    let offExit = () => {};
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { offData(); } catch { /* already off */ }
      try { offExit(); } catch { /* already off */ }
      resolve(result);
    };
    const finish = () => {
      const b = bucket(runId);
      const exit = b.exit || {};
      done({
        stdout: b.out,
        stderr: b.err,
        exitCode: Number.isFinite(exit.exitCode) ? exit.exitCode : -1,
        error: exit.error && exit.error.message ? String(exit.error.message) : '',
      });
    };
    offData = py.onRunData((p) => {
      if (!p || !p.runId) return;
      const b = bucket(p.runId);
      if (p.channel === 'stderr') b.err += String(p.chunk || '');
      else b.out += String(p.chunk || '');
    });
    offExit = py.onRunExit((p) => {
      if (!p || !p.runId) return;
      bucket(p.runId).exit = p;
      if (runId && p.runId === runId) finish();
    });
    Promise.resolve(py.runScript({ workspaceRoot, scriptPath, args: [], timeout })).then((res) => {
      if (!res || !res.ok || !res.runId) {
        done({ stdout: '', stderr: '', exitCode: -1, error: String((res && res.error) || 'The check script could not be started.') });
        return;
      }
      runId = res.runId;
      if (bucket(runId).exit) { finish(); return; }
      timer = setTimeout(() => {
        try { void py.cancelRun(runId); } catch { /* best effort */ }
        done({ stdout: bucket(runId).out, stderr: bucket(runId).err, exitCode: -1, error: 'The solution took too long to run.' });
      }, timeout + 5000);
    }).catch((err) => {
      done({ stdout: '', stderr: '', exitCode: -1, error: stPlainError(err) });
    });
  });
}

/**
 * Execute a numeric question's solution and compare with its stated answer.
 * Returns { available, agreed, computed, error }. `available` false means
 * the check could not run at all (no Python), which is not a verdict.
 */
async function stRunNumericCheck(question) {
  const numeric = question && question.numeric;
  if (!numeric || !numeric.solutionPy) return { available: true, agreed: false, computed: null, error: 'The question has no solution to run.' };
  if (!(await stPythonAvailable())) {
    return { available: false, agreed: null, computed: null, error: 'Python is not set up for this workspace. Create the environment in Settings to check numeric questions.' };
  }
  const safe = stNumericSolutionSafe(numeric.solutionPy);
  if (!safe.ok) return { available: true, agreed: false, computed: null, error: safe.reason };
  const fs = _api.workspace && _api.workspace.fs;
  if (!fs || typeof fs.writeFile !== 'function') {
    return { available: false, agreed: null, computed: null, error: 'Workspace file access is not available in this build.' };
  }
  const root = stWorkspaceRoot();
  const rootSlash = String(root).replace(/\\/g, '/').replace(/\/$/, '');
  const nonce = question.id ? String(question.id) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const rel = `${ST_TMP_REL}/study/check_${nonce}.py`;
  const scriptUri = stUriOf(`${rootSlash}/${rel}`);
  await stEnsureWorkspaceDirs(fs, rootSlash, `${ST_TMP_REL}/study`);
  try {
    await fs.writeFile(scriptUri, stNumericScript(numeric));
  } catch (err) {
    return { available: false, agreed: null, computed: null, error: 'The check script could not be written to the workspace.' };
  }
  let run;
  try {
    run = await stRunPythonScript(root, stFsPathOf(scriptUri), ST_NUMERIC_TIMEOUT_MS);
  } finally {
    try { await fs.delete(scriptUri); } catch { /* best effort */ }
  }
  if (run.error && !run.stdout.trim()) return { available: true, agreed: false, computed: null, error: run.error };
  const lines = run.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let parsed = null;
  for (let i = lines.length - 1; i >= 0 && !parsed; i--) {
    try { const v = JSON.parse(lines[i]); if (v && typeof v === 'object') parsed = v; } catch { /* not the result line */ }
  }
  if (!parsed) return { available: true, agreed: false, computed: null, error: run.stderr.trim() ? 'The solution did not run cleanly.' : 'The solution printed no result.' };
  if (parsed.error) return { available: true, agreed: false, computed: null, error: 'The solution raised an error when run.' };
  const computed = Number(parsed.value);
  if (!Number.isFinite(computed)) return { available: true, agreed: false, computed: null, error: 'The solution did not return a number.' };
  const tolerance = Number(numeric.tolerance) || Number(cfg('numericTolerance', 0.005)) || 0.005;
  const agreed = stNumericMatches(String(computed), numeric.expected, tolerance);
  return { available: true, agreed, computed, error: '' };
}

// ── Generation ──────────────────────────────────────────────────────────────

/** A validated model question as an StQuestion-shaped insert. */
function stRawToQuestion(q, { material, concept, modelId, runId, sourcePage, checks, numeric }) {
  const format = String(q.format);
  let options = [];
  let answer = '';
  let rubric = [];
  if (format === 'mc') {
    options = Array.isArray(q.options) ? q.options.map((o) => String(o)) : [];
    answer = String(Number(q.answer) || 0);
  } else if (format === 'numeric') {
    answer = String(q.expected != null ? q.expected : q.answer != null ? q.answer : '');
  } else if (format === 'cloze') {
    answer = String(q.answer || '');
    options = Array.isArray(q.aliases) ? q.aliases.map((a) => String(a)) : [];
  } else {
    answer = String(q.answer || '');
    if (format === 'short' || format === 'essay') rubric = stNormalizeRubric(q.rubric);
  }
  return {
    materialId: material.id,
    conceptId: concept.id,
    format,
    stem: String(q.stem || '').trim(),
    options,
    answer,
    explanation: String(q.explanation || '').trim(),
    rubric,
    rubricOrigin: rubric.length ? 'source' : '',
    contradictions: [],
    numeric: numeric || null,
    sourcePage: Number(sourcePage) || 0,
    sourceQuote: String(q.quote || '').trim(),
    sourceUri: '',
    origin: 'generated',
    originLabel: '',
    providerId: '',
    providerRef: '',
    bankId: 0,
    checks,
    difficulty: ['easy', 'medium', 'hard'].includes(String(q.difficulty || '').toLowerCase()) ? String(q.difficulty).toLowerCase() : '',
    hidden: false,
    edited: false,
    runId,
    model: modelId,
  };
}

/** Over-generate by a third: the drops are covered without a second call. */
function stAskCount(need) {
  return Math.max(1, Math.ceil(need * 4 / 3));
}

/**
 * Split the plan into calls: concepts on one page share the page's text,
 * and no call asks for more than ST_ASK_PER_CALL questions.
 */
function stGroupPlan(plan) {
  const sorted = [...plan].sort((a, b) => (a.concept.page - b.concept.page) || (a.concept.ord - b.concept.ord) || (a.concept.id - b.concept.id));
  const groups = [];
  let current = null;
  let currentAsk = 0;
  for (const slot of sorted) {
    const ask = Object.values(slot.need).reduce((n, v) => n + stAskCount(v), 0);
    const samePage = current && current[0].concept.page === slot.concept.page;
    if (!current || !samePage || currentAsk + ask > ST_ASK_PER_CALL) {
      current = [];
      currentAsk = 0;
      groups.push(current);
    }
    current.push(slot);
    currentAsk += ask;
  }
  return groups;
}

/** Which concept a model question belongs to: by id, by title, else the group's only concept. */
function stConceptForRaw(raw, group) {
  const id = Number(raw.concept != null ? raw.concept : raw.conceptId);
  if (Number.isInteger(id)) {
    const slot = group.find((g) => g.concept.id === id);
    if (slot) return slot;
  }
  const title = String(raw.concept || raw.conceptTitle || '').trim();
  if (title) {
    const slot = group.find((g) => stTitleSimilarity(title, g.concept.title) >= ST_TITLE_SIMILARITY);
    if (slot) return slot;
  }
  return group.length === 1 ? group[0] : null;
}

/**
 * Generate questions for concepts of a material until each has perConcept
 * of each applicable format, through the checks in order: anchor
 * (mechanical), support (model), distractor (model, mc only), numeric
 * (Python). Each check is skipped when its setting is off and counted in
 * dropped when it fails. Returns { kept, written, dropped, runId, needed, status }.
 */
async function stGenerateQuestions(material, {
  sectionId = 0, conceptIds = null, formats = null, perConcept = 0, choices = 0, modelId = '', numCtx = 0,
  token = null, onProgress = null, pythonAvailable = null, stopWhen = null,
} = {}) {
  const cancelled = () => !!(token && token.cancelled);
  const wanted = Array.isArray(conceptIds) ? new Set(conceptIds.map(Number)) : null;
  const concepts = wanted
    ? (await stListConcepts({ materialIds: [material.id] })).filter((c) => wanted.has(c.id))
    : await stListConcepts({ sectionIds: [sectionId] });
  const empty = { kept: [], written: 0, dropped: {}, runId: 0, needed: 0, status: 'done' };
  if (!concepts.length) return empty;

  const per = Math.max(1, Number(perConcept) || Number(cfg('questionsPerConcept', 2)) || 2);
  const nChoices = Number(choices) === 5 || (!choices && Number(cfg('choices', 4)) === 5) ? 5 : 4;
  const checkNumeric = cfg('checkNumeric', true) !== false;
  const python = pythonAvailable == null ? (checkNumeric ? await stPythonAvailable() : false) : !!pythonAvailable;
  const allowed = Array.isArray(formats) && formats.length ? new Set(formats) : null;

  // What each concept still needs.
  const existing = await stListQuestions({ conceptIds: concepts.map((c) => c.id) });
  const have = new Map();
  for (const q of existing) {
    const m = have.get(q.conceptId) || new Map();
    m.set(q.format, (m.get(q.format) || 0) + 1);
    have.set(q.conceptId, m);
  }
  const plan = [];
  let needed = 0;
  for (const c of concepts) {
    const need = {};
    for (const f of stApplicableFormats(c, python)) {
      if (allowed && !allowed.has(f)) continue;
      const n = per - ((have.get(c.id) && have.get(c.id).get(f)) || 0);
      if (n > 0) { need[f] = n; needed += n; }
    }
    if (Object.keys(need).length) plan.push({ concept: c, need });
  }
  if (!plan.length) return empty;

  const model = modelId || await stPickModel(material);
  if (!model) throw new Error('No model is available. Pick a model in Settings or start the model backend.');
  const text = await stMaterialText(material);
  const groups = stGroupPlan(plan);
  const setting = stContextSettingFor(material, numCtx);
  const runId = await stStartRun({ materialId: material.id, sectionId, model, numCtx: setting });
  const dropped = { anchor: 0, support: 0, distractor: 0, numeric: python ? 0 : null, parse: 0 };
  const kept = [];
  let written = 0;
  let conceptsDone = 0;
  let status = 'done';
  const report = (phase, extra) => {
    const p = {
      phase, done: conceptsDone, total: plan.length, written, kept: kept.length, dropped,
      runId, materialId: material.id, sectionId, model, ...(extra || {}),
    };
    if (onProgress) { try { onProgress(p); } catch { /* listener error is not ours */ } }
    try { bus.emit('run', p); } catch { /* bus is optional here */ }
  };
  const checkAnchor = cfg('checkAnchor', true) !== false;
  const checkSupport = cfg('checkSupport', true) !== false;
  const checkDistractors = cfg('checkDistractors', true) !== false;

  try {
    report('generate');
    for (const group of groups) {
      if (cancelled()) { status = 'stopped'; break; }
      if (stopWhen && await stopWhen()) break;
      const focus = group[0].concept.page || 1;
      const pageFrom = Math.max(1, focus - 1);
      const pageTo = Math.min(Math.max(1, text.pageTexts.length), focus + 1);
      const askTotal = group.reduce((n, slot) => n + Object.values(slot.need).reduce((m, v) => m + stAskCount(v), 0), 0);
      const outputTokens = ST_QUESTION_OUTPUT_BASE + ST_QUESTION_OUTPUT_PER * askTotal;
      const rawChars = [pageFrom, focus, pageTo].reduce((n, p) => n + String(text.pageTexts[p - 1] || '').length, 0);
      const plan1 = await stPlanFor(model, material, rawChars, outputTokens, numCtx);
      const block = stPageBlock(text.pageTexts, pageFrom, pageTo, plan1.maxChars, focus);
      const conceptLines = group.map((slot) => {
        const asks = Object.entries(slot.need).map(([f, n]) => `${stAskCount(n)} ${f}`).join(', ');
        const c = slot.concept;
        return `- id ${c.id}: ${c.title}. ${c.summary || ''} Taught on page ${c.page || focus}. Write: ${asks}.`;
      });
      const user = [
        'Write questions for the concepts below from the material that follows. For each concept write exactly the formats and counts listed, and nothing for a format that is not listed.',
        `Multiple-choice questions have ${nChoices} options.`,
        '',
        'Concepts:',
        ...conceptLines,
        '',
        '--- MATERIAL ---',
        block.material,
      ].join('\n');
      report('generate', { concept: group[0].concept.title });
      let output;
      try {
        output = await stChat(model, ST_QUESTION_SYSTEM, user, { temperature: ST_TEMP_GENERATE, numCtx: plan1.numCtx, json: true });
      } catch (err) {
        if (cancelled()) { status = 'stopped'; break; }
        throw err;
      }
      const raws = stJsonArrayFrom(output);
      if (!raws.length) {
        dropped.parse += 1;
        conceptsDone += group.length;
        report('generate');
        continue;
      }
      written += raws.length;
      const groupKept = [];
      for (const raw of raws) {
        if (cancelled()) { status = 'stopped'; break; }
        if (!raw || typeof raw !== 'object') { dropped.parse += 1; continue; }
        const slot = stConceptForRaw(raw, group);
        if (!slot) { dropped.parse += 1; continue; }
        const format = String(raw.format || '');
        if (!slot.need[format] || slot.need[format] <= 0) continue; // a format not asked for, or already filled
        const v = stValidateQuestion(raw, { choices: nChoices });
        if (!v || !v.ok || !v.question) { dropped.parse += 1; continue; }
        const q = v.question;
        const concept = slot.concept;
        const checks = { anchor: null, support: null, distractor: null, numeric: null };
        let sourcePage = Number(q.page) || concept.page || focus;

        // 1. Anchor: the quote must be on its page (mechanical).
        if (checkAnchor) {
          report('check:anchor', { concept: concept.title });
          const found = stAnchorPageFor(q.quote, text.pageTexts, sourcePage);
          if (!found) { dropped.anchor += 1; continue; }
          checks.anchor = true;
          sourcePage = found;
        }
        // 2. Support: the quote alone settles the answer (model).
        if (checkSupport) {
          report('check:support', { concept: concept.title });
          const r = await stCheckSupport(model, q, { material, numCtx });
          if (!r.settles) { dropped.support += 1; continue; }
          checks.support = true;
        }
        // 3. Distractors: no wrong option is defensible (model, mc only).
        if (format === 'mc' && checkDistractors) {
          report('check:distractor', { concept: concept.title });
          const r = await stCheckDistractors(model, q, { material, numCtx });
          if (r.defensible) { dropped.distractor += 1; continue; }
          checks.distractor = true;
        }
        // 4. Numeric: the solution, run in Python, agrees with the stated answer.
        let numeric = null;
        if (format === 'numeric') {
          numeric = {
            inputs: q.inputs && typeof q.inputs === 'object' ? q.inputs : {},
            solutionPy: String(q.solutionPy || ''),
            expected: q.expected,
            units: String(q.units || ''),
            tolerance: Number(cfg('numericTolerance', 0.005)) || 0.005,
            executed: false,
            agreed: null,
          };
          if (checkNumeric) {
            if (!python) { dropped.numeric = null; continue; }
            report('check:numeric', { concept: concept.title });
            const r = await stRunNumericCheck({ id: 0, numeric });
            if (!r.available) { dropped.numeric = null; continue; }
            numeric.executed = true;
            numeric.agreed = !!r.agreed;
            numeric.computed = r.computed;
            if (!r.agreed) { dropped.numeric = (dropped.numeric || 0) + 1; continue; }
            checks.numeric = true;
          }
        }
        slot.need[format] -= 1;
        groupKept.push(stRawToQuestion(q, { material, concept, modelId: model, runId, sourcePage, checks, numeric }));
      }
      if (groupKept.length) {
        const inserted = await stInsertQuestions(groupKept);
        kept.push(...inserted);
      }
      conceptsDone += group.length;
      report('generate');
    }
  } catch (err) {
    const error = stPlainError(err);
    await stFinishRun(runId, { status: 'failed', written, kept: kept.length, dropped, error });
    report('failed', { error });
    throw new Error(error);
  }
  await stFinishRun(runId, { status, written, kept: kept.length, dropped });
  report(status === 'stopped' ? 'stopped' : 'done');
  return { kept, written, dropped, runId, needed, status };
}

// ── Grading, explaining, rubrics ────────────────────────────────────────────

function stVerdictFor(statuses, rubric, { contradiction = false, note = '' } = {}) {
  const verdict = stNormalizeVerdict({ points: statuses.map((s) => ({ status: s, note: '' })), contradiction, note }, rubric);
  return { verdict, rating: stMapVerdictToRating(verdict, rubric), label: stVerdictLabel(verdict, rubric), rubric };
}

/**
 * Grade a typed answer: { verdict, rating, label, rubric }. Numeric, cloze
 * and an exact formula are settled mechanically; everything else goes to
 * the marker with the rubric, the contradictions and the source quote.
 * A bank question with an answer but no rubric gets one derived and
 * stored first (origin 'answer').
 */
async function stGradeTyped(question, answer, { modelId = '', numCtx = 0 } = {}) {
  const typed = String(answer || '').trim();
  const format = String(question.format || 'short');
  const numeric = question.numeric || {};

  if (format === 'numeric') {
    const expected = numeric.expected != null ? numeric.expected : question.answer;
    const tolerance = Number(numeric.tolerance) || Number(cfg('numericTolerance', 0.005)) || 0.005;
    const ok = !!typed && stNumericMatches(typed, expected, tolerance);
    const rubric = [{ text: `${expected}${numeric.units ? ` ${numeric.units}` : ''}`, required: true }];
    return stVerdictFor([ok ? 'hit' : 'miss'], rubric, { note: ok ? '' : (typed ? `The text gives ${rubric[0].text}.` : 'Nothing written down.') });
  }
  if (format === 'cloze') {
    const ok = !!typed && stClozeMatches(typed, question.answer, Array.isArray(question.options) ? question.options : []);
    const rubric = [{ text: String(question.answer || ''), required: true }];
    return stVerdictFor([ok ? 'hit' : 'miss'], rubric, { note: ok ? '' : (typed ? `The term is ${question.answer}.` : 'Nothing written down.') });
  }

  let rubric = stNormalizeRubric(question.rubric);
  const reference = format === 'mc'
    ? String((Array.isArray(question.options) ? question.options[Number(question.answer)] : '') || '')
    : String(question.answer || '');
  if (format === 'formula') {
    if (!typed) return stVerdictFor(['miss'], [{ text: reference, required: true }], { note: 'Nothing written down.' });
    if (stFormulaMatches(typed, reference)) return stVerdictFor(['hit'], [{ text: reference, required: true }]);
    rubric = [{ text: reference, required: true }];
  }
  if (!rubric.length && reference) {
    const derived = await stRubricFromAnswer(question, { modelId, numCtx });
    if (derived.length) {
      rubric = derived;
      if (question.id) {
        question.rubric = derived;
        question.rubricOrigin = 'answer';
        try { await stUpdateQuestion(question); } catch { /* grading still proceeds */ }
      }
    }
  }
  if (!rubric.length && reference) rubric = [{ text: reference, required: true }];
  if (!rubric.length) throw new Error('This question has no answer to grade against. Edit the question and add one.');
  if (!typed) return stVerdictFor(rubric.map(() => 'miss'), rubric, { note: 'Nothing written down.' });

  const model = modelId || await stPickModel(null);
  if (!model) throw new Error('No model is available to grade with. Pick a model in Settings or start the model backend.');
  const contradictions = Array.isArray(question.contradictions) ? question.contradictions.filter(Boolean) : [];
  const user = [
    `Question:\n${question.stem}`,
    '',
    reference ? `Reference answer:\n${reference}` : '',
    question.sourceQuote ? `Source quotation${question.sourcePage ? ` (page ${question.sourcePage})` : ''}:\n${question.sourceQuote}` : '',
    '',
    'Points to mark, in order:',
    ...rubric.map((p, i) => `${i + 1}. ${p.text}${p.required ? '' : ' (supporting detail)'}`),
    contradictions.length ? `\nStatements that make an answer wrong:\n${contradictions.map((c) => `- ${c}`).join('\n')}` : '',
    '',
    `Student's answer:\n${typed}`,
  ].filter((line) => line !== '').join('\n');
  const plan = await stPlanFor(model, null, user.length, ST_SMALL_OUTPUT_TOKENS + 40 * rubric.length, numCtx);
  const output = await stChat(model, ST_GRADE_SYSTEM, user, { temperature: ST_TEMP_CHECK, numCtx: plan.numCtx, json: true });
  const raw = stJsonObjectFrom(output);
  if (!raw) throw new Error('The model could not grade this answer. Try again, or rate it yourself.');
  const verdict = stNormalizeVerdict(raw, rubric);
  return { verdict, rating: stMapVerdictToRating(verdict, rubric), label: stVerdictLabel(verdict, rubric), rubric };
}

/** Stream a short explanation grounded in the question's quote. Returns the full text. */
async function stExplain(question, { chosen = null, typed = '', modelId = '', numCtx = 0, onChunk = null } = {}) {
  const model = modelId || await stPickModel(null);
  if (!model) throw new Error('No model is available to explain with. Pick a model in Settings or start the model backend.');
  const options = Array.isArray(question.options) ? question.options : [];
  const right = question.format === 'mc' ? String(options[Number(question.answer)] || '') : String(question.answer || '');
  const chosenText = question.format === 'mc' && chosen != null && chosen !== '' ? String(options[Number(chosen)] || '') : '';
  const user = [
    `Question:\n${question.stem}`,
    question.format === 'mc' && options.length ? `Options:\n${options.map((o, i) => `${i + 1}. ${o}${i === Number(question.answer) ? ' (correct)' : ''}`).join('\n')}` : '',
    `Right answer:\n${right}`,
    chosenText ? `The student chose:\n${chosenText}` : '',
    typed ? `The student wrote:\n${String(typed).trim()}` : '',
    question.explanation ? `Why, as written when the question was made:\n${question.explanation}` : '',
    `Quotation from the source${question.sourcePage ? ` (page ${question.sourcePage})` : ''}:\n${question.sourceQuote || '(none)'}`,
  ].filter(Boolean).join('\n\n');
  const plan = await stPlanFor(model, null, user.length, ST_SMALL_OUTPUT_TOKENS, numCtx);
  const text = await stChat(model, ST_EXPLAIN_SYSTEM, user, { temperature: ST_TEMP_GENERATE, numCtx: plan.numCtx, json: false, onChunk });
  const out = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!out) throw new Error('The model gave no explanation. Try again.');
  return out;
}

/** Derive a rubric from a bank question's answer (origin 'answer'). [] when the model gives nothing. */
async function stRubricFromAnswer(question, { modelId = '', numCtx = 0 } = {}) {
  const reference = String(question.answer || '').trim();
  if (!reference) return [];
  let model = modelId;
  try { model = model || await stPickModel(null); } catch { model = ''; }
  if (!model) return [];
  const user = [
    `Question:\n${question.stem}`,
    '',
    `Model answer:\n${reference}`,
    question.sourceQuote ? `\nSource quotation:\n${question.sourceQuote}` : '',
  ].filter((l) => l !== '').join('\n');
  try {
    const plan = await stPlanFor(model, null, user.length, ST_SMALL_OUTPUT_TOKENS, numCtx);
    const output = await stChat(model, ST_RUBRIC_SYSTEM, user, { temperature: ST_TEMP_RUBRIC, numCtx: plan.numCtx, json: true });
    const raw = stJsonObjectFrom(output);
    return stNormalizeRubric(raw && (raw.rubric || raw.points));
  } catch (err) {
    console.warn('[Study] rubric derivation failed:', err && err.message);
    return [];
  }
}

/** Sentences of a text, trimmed, for the mechanical rubric fallback. */
function stSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

/**
 * Rubric and contradictions from an examiner's report entry (origin
 * 'report'): the sample answer's claims become the points, the common
 * errors the contradictions. Falls back to a sentence split when the
 * model gives nothing, so an import never fails on a model outage.
 */
async function stRubricFromReport(entry, { modelId = '', numCtx = 0 } = {}) {
  const sample = String((entry && entry.sampleAnswer) || '').trim();
  const errors = String((entry && entry.commonErrors) || '').trim();
  const fallback = () => ({
    rubric: stNormalizeRubric(stSentences(sample).slice(0, 6).map((text) => ({ text, required: true }))),
    contradictions: stSentences(errors).slice(0, 6),
    origin: 'report',
  });
  if (!sample) return fallback();
  let model = modelId;
  try { model = model || await stPickModel(null); } catch { model = ''; }
  if (!model) return fallback();
  const user = [
    entry && entry.number != null ? `Question ${entry.number}${entry.part ? ` part ${entry.part}` : ''} of the examiner's report.` : '',
    '',
    `Sample answer:\n${sample}`,
    errors ? `\nCommon errors the examiners noted:\n${errors}` : '',
  ].filter((l) => l !== '').join('\n');
  try {
    const plan = await stPlanFor(model, null, user.length, ST_SMALL_OUTPUT_TOKENS, numCtx);
    const output = await stChat(model, ST_RUBRIC_SYSTEM, user, { temperature: ST_TEMP_RUBRIC, numCtx: plan.numCtx, json: true });
    const raw = stJsonObjectFrom(output);
    const rubric = stNormalizeRubric(raw && (raw.rubric || raw.points));
    if (!rubric.length) return fallback();
    const contradictions = Array.isArray(raw.contradictions) ? raw.contradictions.map((c) => String(c).trim()).filter(Boolean).slice(0, 10) : [];
    return { rubric, contradictions, origin: 'report' };
  } catch (err) {
    console.warn('[Study] report rubric failed:', err && err.message);
    return fallback();
  }
}

// ── Scope resolution ────────────────────────────────────────────────────────

/** Selection scopes map to concepts kept here by selection text, so a refresh does not map them again. */
const _stSelectionConcepts = new Map();

function stSelectionKey(scope) {
  return `${(scope.materialIds || [])[0] || 0}:${stHashText(String(scope.selectionText || ''))}`;
}

/** The sections a scope covers, each with its material; a selection is its own unit. */
async function stScopeUnits(scope) {
  const units = [];
  const kind = scope && scope.kind;
  const materialIds = Array.isArray(scope && scope.materialIds) ? scope.materialIds : [];
  if (kind === 'selection') {
    const material = await stGetMaterial(materialIds[0]);
    if (material) units.push({ material, section: null, selectionText: String(scope.selectionText || ''), selectionPage: Number(scope.selectionPage) || 0 });
    return units;
  }
  if (kind === 'chapter') {
    for (const sid of Array.isArray(scope.sectionIds) ? scope.sectionIds : []) {
      const section = await stGetSection(sid);
      if (!section) continue;
      const material = await stGetMaterial(section.materialId);
      if (material) units.push({ material, section });
    }
    return units;
  }
  if (kind === 'document' || kind === 'materials' || kind === 'pages') {
    for (const mid of materialIds) {
      const material = await stGetMaterial(mid);
      if (!material) continue;
      let sections = await stListSections(material.id);
      if (!sections.length) sections = await stEnsureSections(material.id, stNormalizeSections([], material.pageCount));
      if (kind === 'pages') {
        const from = Number(scope.pageFrom) || 1;
        const to = Number(scope.pageTo) || from;
        sections = sections.filter((s) => s.pageTo >= from && s.pageFrom <= to);
      }
      for (const section of sections) units.push({ material, section });
    }
  }
  return units;
}

/** The concepts a scope draws from. `ensured` is a prior stEnsureBank result, for selections. */
async function stScopeConcepts(scope, ensured = null) {
  const kind = scope && scope.kind;
  const materialIds = Array.isArray(scope && scope.materialIds) ? scope.materialIds : [];
  if (kind === 'bank') return [];
  if (kind === 'weak') {
    const weak = await stWeakConcepts({ limit: 400 });
    const mids = new Set(materialIds);
    return weak.filter((c) => (c.state === 'weak' || c.state === 'stale') && (!mids.size || mids.has(c.materialId)));
  }
  if (kind === 'selection') {
    if (ensured && Array.isArray(ensured.concepts) && ensured.concepts.length) return ensured.concepts;
    const ids = _stSelectionConcepts.get(stSelectionKey(scope));
    if (!ids || !ids.length) return [];
    const set = new Set(ids);
    return (await stListConcepts({ materialIds: [materialIds[0]] })).filter((c) => set.has(c.id));
  }
  if (kind === 'chapter') return stListConcepts({ sectionIds: Array.isArray(scope.sectionIds) ? scope.sectionIds : [] });
  const all = await stListConcepts({ materialIds });
  if (kind === 'pages') {
    const from = Number(scope.pageFrom) || 1;
    const to = Number(scope.pageTo) || from;
    return all.filter((c) => c.page >= from && c.page <= to);
  }
  return all;
}

/** A stand-in concept for bank questions that were never mapped. */
function stPseudoConcept(id = 0) {
  return { id, materialId: 0, sectionId: 0, title: 'Bank', summary: '', page: 0, anchorQuote: '', ord: 0, mastery: 0, answers: 0, misses: 0, missStreak: 0, rightChooseAt: 0, rightTypeAt: 0, lastAnsweredAt: 0 };
}

/** Concepts and questions for a scope's draw. */
async function stScopePool(scope, ensured = null) {
  if (scope && scope.kind === 'bank') {
    const questions = await stListQuestions({ bankIds: Array.isArray(scope.bankIds) ? scope.bankIds : [] });
    const mapped = [...new Set(questions.map((q) => q.conceptId).filter((id) => id > 0))];
    const concepts = mapped.length ? (await stListConcepts({})).filter((c) => mapped.includes(c.id)) : [];
    if (questions.some((q) => !q.conceptId)) concepts.push(stPseudoConcept(0));
    return { concepts, questions };
  }
  const concepts = await stScopeConcepts(scope, ensured);
  const questions = concepts.length ? await stListQuestions({ conceptIds: concepts.map((c) => c.id) }) : [];
  return { concepts, questions };
}

// ── Orchestration ───────────────────────────────────────────────────────────

/**
 * Make sure a scope has questions: map every unmapped section (or the
 * selection), then generate until every concept has questionsPerConcept of
 * each applicable format. With `untilSize`, stop as soon as `size` kept
 * questions exist across the scope (the Start With N Ready path).
 * Returns { kept, concepts, numericUnavailable }.
 */
async function stEnsureBank(scope, { size = 0, modelId = '', numCtx = 0, token = null, onProgress = null, untilSize = false } = {}) {
  const cancelled = () => !!(token && token.cancelled);
  const result = { kept: 0, concepts: [], numericUnavailable: false };
  if (!scope) return result;
  if (scope.kind === 'bank') {
    result.kept = (await stListQuestions({ bankIds: Array.isArray(scope.bankIds) ? scope.bankIds : [] })).length;
    return result;
  }
  const checkNumeric = cfg('checkNumeric', true) !== false;
  const pythonAvailable = checkNumeric ? await stPythonAvailable() : false;
  result.numericUnavailable = checkNumeric && !pythonAvailable;

  // 1. Concepts: map what is unmapped.
  const groups = []; // [{ material, section, concepts, model }]
  if (scope.kind === 'weak') {
    const concepts = await stScopeConcepts(scope);
    const byMaterial = new Map();
    for (const c of concepts) {
      if (!byMaterial.has(c.materialId)) byMaterial.set(c.materialId, []);
      byMaterial.get(c.materialId).push(c);
    }
    for (const [mid, list] of byMaterial) {
      const material = await stGetMaterial(mid);
      if (material) groups.push({ material, section: null, concepts: list, model: modelId || await stPickModel(material) });
    }
  } else {
    const units = await stScopeUnits(scope);
    for (const unit of units) {
      if (cancelled()) break;
      const model = modelId || await stPickModel(unit.material);
      let concepts;
      if (unit.selectionText !== undefined) {
        const key = stSelectionKey(scope);
        const known = _stSelectionConcepts.get(key);
        if (known && known.length) {
          const set = new Set(known);
          concepts = (await stListConcepts({ materialIds: [unit.material.id] })).filter((c) => set.has(c.id));
        } else {
          concepts = await stBuildConceptMap(unit.material, null, { modelId: model, numCtx, token, onProgress, selectionText: unit.selectionText, selectionPage: unit.selectionPage });
          _stSelectionConcepts.set(key, concepts.map((c) => c.id));
        }
      } else {
        if (!unit.section.mappedAt) {
          await stBuildConceptMap(unit.material, unit.section, { modelId: model, numCtx, token, onProgress });
        }
        concepts = await stListConcepts({ sectionIds: [unit.section.id] });
        if (scope.kind === 'pages') {
          const from = Number(scope.pageFrom) || 1;
          const to = Number(scope.pageTo) || from;
          concepts = concepts.filter((c) => c.page >= from && c.page <= to);
        }
      }
      groups.push({ material: unit.material, section: unit.section, concepts, model });
    }
  }
  const concepts = groups.flatMap((g) => g.concepts);
  result.concepts = concepts;
  const countKept = async () => concepts.length ? (await stListQuestions({ conceptIds: concepts.map((c) => c.id) })).length : 0;
  result.kept = await countKept();
  if (!concepts.length || cancelled()) return result;
  const target = untilSize && Number(size) > 0 ? Number(size) : 0;
  if (target && result.kept >= target) return result;

  // 2. Questions: generate to coverage, or until the size is reached.
  const perConcept = Math.max(1, Number(cfg('questionsPerConcept', 2)) || 2);
  const choices = Number(cfg('choices', 4)) === 5 ? 5 : 4;
  const stopWhen = target ? async () => (await countKept()) >= target : null;
  for (let pass = 0; pass < ST_MAX_PASSES; pass++) {
    let progressed = false;
    for (const group of groups) {
      if (cancelled()) break;
      if (!group.concepts.length) continue;
      if (stopWhen && await stopWhen()) break;
      const gen = await stGenerateQuestions(group.material, {
        sectionId: group.section ? group.section.id : 0,
        conceptIds: group.concepts.map((c) => c.id),
        perConcept, choices, modelId: group.model, numCtx, token, onProgress, pythonAvailable, stopWhen,
      });
      if (gen.kept.length) progressed = true;
      if (gen.status === 'stopped') break;
    }
    result.kept = await countKept();
    if (cancelled() || !progressed) break;
    if (stopWhen && result.kept >= target) break;
  }
  return result;
}

/**
 * The next draw for a session: top the bank up when fewer than `size`
 * unseen questions remain, draw with stDrawSession excluding everything
 * the session already holds, and record the items. Returns the questions
 * in order (empty when the scope has nothing left or the run was stopped).
 */
async function stNextDraw(session, { token = null, onProgress = null } = {}) {
  const scope = session.scope || {};
  const items = await stListSessionItems(session.id);
  const exclude = new Set(items.map((i) => i.questionId));
  const size = Number(session.size) || Number(cfg('sessionSize', 20)) || 20;
  let pool = await stScopePool(scope);
  let candidates = pool.questions.filter((q) => !q.hidden && !exclude.has(q.id));
  if (candidates.length < size && scope.kind !== 'bank') {
    const ensured = await stEnsureBank(scope, {
      size: size + exclude.size, modelId: session.model, numCtx: session.numCtx, token, onProgress, untilSize: true,
    });
    pool = await stScopePool(scope, ensured);
    candidates = pool.questions.filter((q) => !q.hidden && !exclude.has(q.id));
  }
  if (token && token.cancelled) return [];
  if (!candidates.length) return [];
  const conceptById = new Map(pool.concepts.map((c) => [c.id, c]));
  const draw = stDrawSession({
    questions: pool.questions, concepts: pool.concepts, size, exclude,
    answerFormat: session.answerFormat, now: stNow(), rng: Math.random,
  }) || [];
  if (!draw.length) return [];
  const formats = draw.map((q) => stResolveFormat(conceptById.get(q.conceptId) || stPseudoConcept(q.conceptId), q, session.answerFormat));
  await stAddSessionItems(session.id, Number(session.refreshes) || 0, draw.map((q) => q.id), formats);
  return draw;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 40: CSS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Every st-* rule the sidebar, the pane and the dashboard widget use, written
// once into one <style id="study-styles">. The look is docs/mockups/study.html
// on the app's tokens: the card is the Flashcards white serif stock (the
// --px-stock-* tokens), everything around it is the workbench's own chrome.
// Motion only through --px-dur-* and --px-ease*; reduced motion collapses it
// all (the core stills everything in px-motion.css, and the same two
// selectors are repeated here scoped to Study so the rule holds on its own).
// Copied from the Flashcards injectStyles pattern (one style element, an
// idempotent guard) so Study turned on twice never writes its rules twice.

let _stStyleInjected = false;

function injectStyles() {
  if (_stStyleInjected) return;
  if (document.getElementById('study-styles')) { _stStyleInjected = true; return; }
  _stStyleInjected = true;
  const style = document.createElement('style');
  style.id = 'study-styles';
  style.textContent = `
/* ── Pane root ──────────────────────────────────────────────────────────── */
.st-root { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--px-window); color: var(--px-text); font-size: var(--px-text-base); outline: none; }
.st-root:focus-visible { box-shadow: inset 0 0 0 1px var(--px-accent); }
.st-root .svg-icon { display: inline-flex; }
.st-error { margin: var(--px-space-8) auto; max-width: 70ch; padding: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); color: var(--px-text-secondary); display: grid; gap: var(--px-space-3); }
.st-error__t { font-weight: 600; color: var(--px-text); }
.st-sp { flex: 1; }
.st-num { font-variant-numeric: tabular-nums; }
.st-faint { color: var(--px-text-faint); }
.st-muted { color: var(--px-text-muted); }

/* ── Session toolbar and the strand ─────────────────────────────────────── */
.st-sess { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--px-window); }
.st-sess-tb { display: flex; align-items: center; gap: var(--px-space-3); height: 40px; padding: 0 var(--px-space-4); border-bottom: 1px solid var(--px-divider); background: var(--px-bg); flex: none; }
.st-sess-tb__scope { font-size: var(--px-text-sm); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.st-sess-tb__scope .m { color: var(--px-text-muted); font-weight: 400; }
.st-strand { display: flex; gap: 3px; flex: 0 1 240px; min-width: 120px; }
.st-strand i { flex: 1; height: 3px; border-radius: var(--px-radius-full); background: var(--px-surface-active); transition: background var(--px-dur-base) var(--px-ease), transform var(--px-dur-base) var(--px-ease-spring); }
.st-strand i.ok { background: var(--px-success); }
.st-strand i.no { background: var(--px-danger); }
.st-strand i.cur { background: var(--px-accent); }
.st-strand i.just { transform: scaleY(1.9); }
.st-sess-main { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; padding: var(--px-space-5) var(--px-space-6) var(--px-space-6); overflow-y: auto; }
.st-qwrap { width: 100%; max-width: 760px; position: relative; }

/* ── Eyebrow ────────────────────────────────────────────────────────────── */
.st-eyebrow { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-text-muted); margin-bottom: var(--px-space-2); min-height: var(--px-control-h-sm); }
.st-eyebrow__cpt { color: var(--px-text-secondary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-eyebrow__dot { width: 3px; height: 3px; border-radius: var(--px-radius-full); background: var(--px-text-faint); flex: none; }
.st-eyebrow__src { color: var(--px-text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-eyebrow__acts { margin-left: auto; display: inline-flex; align-items: center; gap: var(--px-space-1); }
.st-eyebrow__acts .px-btn { color: var(--px-text-faint); }

/* ── The card: the Flashcards stock, white paper and dark ink in every
   theme (the --px-stock-* tokens are the same in light and dark). ───────── */
.st-card { background: var(--px-stock); border: 1px solid var(--px-stock-edge); box-shadow: var(--px-stock-shadow); padding: var(--px-space-5) var(--px-space-6) var(--px-space-2); color: var(--px-stock-ink); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-card--leaving { animation: st-card-out var(--px-dur-fast) var(--px-ease) forwards; }
@keyframes st-card-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes st-card-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(-14px); } }
/* Card ink is a book serif, as the Flashcards card: printed-card text, not
   UI chrome. It matches KaTeX's serif math, so a formula in a stem reads as
   one sentence instead of sans colliding with serif math. The one deliberate
   font-family in the extension; the keycaps and hints inherit the UI face. */
.st-card__q, .st-opt__text, .st-ta__field, .st-ta__line, .st-ta__num, .st-quote__text, .st-full__text, .st-learn__pt, .st-review__stem, .st-review__ans { font-family: Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, 'Times New Roman', serif; }
.st-card__q { font-size: var(--px-text-xl); font-weight: 700; line-height: 1.35; margin: 0 0 var(--px-space-4); }
.st-card__q .px-markdown p { margin: 0; }
.st-card .px-markdown code { background: var(--px-stock-well); color: var(--px-stock-ink); }
.st-card .px-markdown pre { background: var(--px-stock-well); border-color: var(--px-stock-edge); color: var(--px-stock-ink); }
.st-card .px-markdown a { color: var(--px-accent-text); }
/* Options: rows on the card with a keycap at the left, divided by the card's
   own hairline. No radio circles: the keycap is the letter and the key. */
.st-opts { margin: 0 calc(var(--px-space-6) * -1); border-top: 1px solid var(--px-stock-line); }
.st-opt { display: flex; align-items: flex-start; gap: var(--px-space-3); padding: 11px var(--px-space-6); border-bottom: 1px solid var(--px-stock-line); font-size: var(--px-text-md); line-height: 1.45; cursor: pointer; position: relative; transition: background var(--px-dur-fast) var(--px-ease), transform var(--px-dur-instant) var(--px-ease); }
.st-opt:last-child { border-bottom: 0; }
.st-opt:hover { background: var(--px-stock-well); }
.st-opt:active { transform: var(--px-press); }
.st-opt__text { flex: 1; min-width: 0; }
.st-opt__text .px-markdown p { margin: 0; }
.st-opt__key { flex: none; width: 20px; height: 20px; margin-top: 1px; border: 1px solid var(--px-stock-line); border-radius: var(--px-radius-sm); font-size: var(--px-text-xs); font-weight: 500; line-height: 18px; text-align: center; color: var(--px-stock-ink-faint); transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease), border-color var(--px-dur-fast) var(--px-ease); }
.st-opt__mark { flex: none; width: 16px; height: 16px; margin: 3px 0 0 auto; opacity: 0; transform: scale(.6); transition: opacity var(--px-dur-fast) var(--px-ease), transform var(--px-dur-base) var(--px-ease-spring); }
.st-opts--done .st-opt { cursor: default; }
.st-opts--done .st-opt:hover { background: transparent; }
.st-opt--right { background: rgba(var(--px-green-rgb), .09); }
.st-opt--right .st-opt__key { background: var(--px-success); border-color: var(--px-success); color: var(--px-stock); }
.st-opt--right .st-opt__mark { opacity: 1; transform: none; color: var(--px-success); }
.st-opt--wrong { background: rgba(var(--px-red-rgb), .08); }
.st-opt--wrong .st-opt__key { background: var(--px-danger); border-color: var(--px-danger); color: var(--px-stock); }
.st-opt--wrong .st-opt__mark { opacity: 1; transform: none; color: var(--px-danger); }
.st-opts--done .st-opt:not(.st-opt--right):not(.st-opt--wrong) { color: var(--px-stock-ink-faint); }
.st-opts--done .st-opt:not(.st-opt--right):not(.st-opt--wrong) .st-opt__key { color: var(--px-stock-ink-faint); border-color: var(--px-stock-line); }
/* Typed answer: a well on the card. */
.st-ta { margin: 0 calc(var(--px-space-6) * -1) calc(var(--px-space-2) * -1); border-top: 1px solid var(--px-stock-line); padding: var(--px-space-4) var(--px-space-6) var(--px-space-5); }
.st-ta__field, .st-ta__line, .st-ta__num { width: 100%; border: 1px solid var(--px-stock-line); border-radius: var(--px-radius-sm); padding: 10px 12px; font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-stock-ink); background: var(--px-stock-well); outline: none; box-sizing: border-box; transition: border-color var(--px-dur-fast) var(--px-ease), box-shadow var(--px-dur-fast) var(--px-ease); }
.st-ta__field { min-height: 96px; resize: vertical; }
.st-ta__field--essay { min-height: 130px; }
.st-ta__line { height: 40px; }
.st-ta__num { width: 180px; height: 40px; font-variant-numeric: tabular-nums; }
.st-ta__field:focus, .st-ta__line:focus, .st-ta__num:focus { border-color: var(--px-accent); box-shadow: 0 0 0 1px var(--px-accent); background: var(--px-stock); }
.st-ta__field[disabled], .st-ta__line[disabled], .st-ta__num[disabled] { color: var(--px-stock-ink-soft); }
.st-ta__row { display: flex; align-items: center; gap: var(--px-space-2); }
.st-ta__units { color: var(--px-stock-ink-soft); font-size: var(--px-text-md); }
.st-ta__hint { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); margin-top: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-stock-ink-faint); }

/* ── Feedback under the card ────────────────────────────────────────────── */
.st-fb { margin-top: var(--px-space-4); display: grid; grid-template-columns: 1fr auto; gap: var(--px-space-3) var(--px-space-4); align-items: start; opacity: 0; transform: translateY(6px); transition: opacity var(--px-dur-base) var(--px-ease-out), transform var(--px-dur-base) var(--px-ease-out); pointer-events: none; }
.st-fb--show { opacity: 1; transform: none; pointer-events: auto; }
.st-fb__verdict { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-base); font-weight: 600; min-height: var(--px-control-h-sm); }
.st-fb__dot { width: 8px; height: 8px; border-radius: var(--px-radius-full); background: var(--px-text-faint); flex: none; }
.st-fb--ok .st-fb__verdict { color: var(--px-success); }
.st-fb--ok .st-fb__dot { background: var(--px-success); }
.st-fb--no .st-fb__verdict { color: var(--px-danger); }
.st-fb--no .st-fb__dot { background: var(--px-danger); }
.st-fb__grade { display: inline-flex; align-items: center; gap: var(--px-space-1); font-size: var(--px-text-sm); font-weight: 400; color: var(--px-text-muted); }
.st-fb__grade b { font-weight: 600; color: var(--px-warning); }
.st-fb--ok .st-fb__grade b { color: var(--px-success); }
.st-fb--no .st-fb__grade b { color: var(--px-danger); }
.st-fb__why { grid-column: 1 / -1; font-size: var(--px-text-base); color: var(--px-text-secondary); line-height: var(--px-leading-base); margin-top: calc(var(--px-space-1) * -1); max-width: 70ch; }
.st-fb__why b, .st-fb__why strong { color: var(--px-text); font-weight: 600; }
.st-fb__why .px-markdown p { margin: 0; }
/* The text actions on the verdict line: words, not buttons. */
.st-fb__acts { grid-column: 2; grid-row: 1; display: flex; gap: var(--px-space-4); align-items: center; justify-self: end; }
.st-fb__acts .px-btn { height: auto; padding: 0; border: 0; background: none; color: var(--px-text-muted); font-weight: 500; }
.st-fb__acts .px-btn:hover:not(:disabled) { color: var(--px-text); background: none; }
.st-fb__acts .px-btn .svg-icon { display: none; }
/* The anchor quote with the warning-coloured left rule and the page link. */
.st-quote { grid-column: 1 / -1; display: flex; gap: var(--px-space-2); padding: 10px 12px; border: 1px solid var(--px-border); border-left: 2px solid var(--px-warning); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); font-size: var(--px-text-base); line-height: var(--px-leading-base); color: var(--px-text-secondary); max-width: 70ch; }
.st-quote__text { flex: 1; min-width: 0; }
.st-quote__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; align-self: flex-start; margin-top: 2px; cursor: pointer; background: none; border: 0; padding: 0; font-weight: 500; }
.st-quote__pg:hover { text-decoration: underline; }
/* Rubric points land one after another: 50 ms apart, --st-i set per row. */
.st-rub { grid-column: 1 / -1; display: grid; gap: 6px; margin-top: calc(var(--px-space-1) * -1); }
.st-rub__pt { display: flex; align-items: flex-start; gap: 10px; font-size: var(--px-text-base); line-height: 1.45; color: var(--px-text-secondary); opacity: 0; transform: translateX(-4px); animation: st-pt-in var(--px-dur-base) var(--px-ease-out) forwards; animation-delay: calc(var(--st-i, 0) * 50ms); }
@keyframes st-pt-in { to { opacity: 1; transform: none; } }
.st-rub__g { flex: none; width: 18px; height: 18px; border-radius: var(--px-radius-sm); display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
.st-rub__g .svg-icon svg { width: 12px; height: 12px; }
.st-rub__pt--hit .st-rub__g { background: rgba(var(--px-green-rgb), .18); color: var(--px-success); }
.st-rub__pt--partial .st-rub__g { background: rgba(var(--px-yellow-rgb), .18); color: var(--px-warning); }
.st-rub__pt--miss .st-rub__g { background: rgba(var(--px-red-rgb), .18); color: var(--px-danger); }
.st-rub__pt--miss { color: var(--px-text); }
.st-rub__req { font-size: var(--px-text-2xs); color: var(--px-text-faint); margin-left: var(--px-space-1); }
/* The full answer stays folded; the explanation streams into a block. */
.st-full { grid-column: 1 / -1; margin-top: 2px; }
.st-full summary { font-size: var(--px-text-sm); color: var(--px-text-muted); cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 5px; }
.st-full summary::-webkit-details-marker { display: none; }
.st-full__text, .st-explain { margin: var(--px-space-2) 0 0; font-size: var(--px-text-base); line-height: 1.55; color: var(--px-text-secondary); max-width: 70ch; padding: 10px 12px; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); }
.st-explain { grid-column: 1 / -1; margin-top: 0; white-space: pre-wrap; }
.st-explain .px-markdown { white-space: normal; }
.st-explain--busy { color: var(--px-text-muted); }

/* ── Controls row ───────────────────────────────────────────────────────── */
.st-ctl { display: flex; align-items: center; gap: var(--px-space-2); width: 100%; max-width: 760px; margin-top: var(--px-space-5); }
.st-k { margin-left: 6px; opacity: .55; font-size: var(--px-text-xs); font-weight: 400; }

/* ── Setup sheet: scrim and sheet over the pane ─────────────────────────── */
.st-scrim { position: absolute; inset: 0; background: color-mix(in srgb, var(--px-bg) 55%, transparent); animation: st-fade var(--px-dur-base) var(--px-ease-out); }
@keyframes st-fade { from { opacity: 0; } to { opacity: 1; } }
.st-sheet { position: absolute; top: 50%; left: 50%; width: 560px; max-width: calc(100% - 32px); transform: translate(-50%, -50%); background: var(--px-bg-elevated); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); box-shadow: var(--px-shadow-lg), var(--px-edge-light); animation: st-rise var(--px-dur-slow) var(--px-ease-out); }
@keyframes st-rise { from { opacity: 0; transform: translate(-50%, -50%) translateY(10px) scale(.985); } to { opacity: 1; transform: translate(-50%, -50%); } }
.st-sheet__hd { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); padding: var(--px-space-4) var(--px-space-5) 0; }
.st-sheet__title { margin: 0; font-size: var(--px-text-md); font-weight: 600; }
.st-sheet__sub { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-sheet__bd { padding: var(--px-space-4) var(--px-space-5) var(--px-space-5); display: grid; gap: var(--px-space-4); }
.st-row { display: flex; align-items: center; gap: var(--px-space-3); flex-wrap: wrap; }
.st-row__lab { width: 92px; flex: none; font-size: var(--px-text-sm); color: var(--px-text-muted); }
.st-row__lab--inline { width: auto; margin-left: var(--px-space-3); }
.st-outline { border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-inset); overflow: hidden; max-height: 240px; overflow-y: auto; }
.st-outline__o { display: flex; align-items: center; gap: var(--px-space-2); min-height: var(--px-control-h); padding: 0 var(--px-space-3); font-size: var(--px-text-sm); color: var(--px-text-secondary); border-top: 1px solid var(--px-divider); cursor: pointer; }
.st-outline__o:first-child { border-top: 0; }
.st-outline__o:hover { background: var(--px-surface-hover); }
.st-outline__o--on { background: var(--px-surface-selected); color: var(--px-text); }
.st-outline__nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-outline__pp { width: 64px; text-align: right; color: var(--px-text-faint); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; }
/* Coverage bars: green share clean, accent share answered but not clean. */
.st-ocov { margin-left: auto; width: 56px; height: 3px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; flex: none; display: flex; }
.st-ocov i, .st-mini i { display: block; height: 100%; }
.st-cov-c { background: var(--px-success); }
.st-cov-w { background: var(--px-accent); }
.st-pages { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-sm); color: var(--px-text-muted); }
.st-input { height: var(--px-control-h); width: 72px; padding: 0 var(--px-space-2); border: 1px solid var(--px-border-strong); border-radius: var(--px-radius-sm); background: var(--px-bg-inset); color: var(--px-text); font: inherit; font-size: var(--px-text-sm); font-variant-numeric: tabular-nums; outline: none; }
.st-input:focus { border-color: var(--px-accent); box-shadow: 0 0 0 1px var(--px-accent); }
.st-selection { padding: 10px 12px; border: 1px solid var(--px-border); border-left: 2px solid var(--px-accent); border-radius: var(--px-radius-md); background: var(--px-bg-inset); font-size: var(--px-text-sm); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.st-sheet__ft { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); padding: var(--px-space-3) var(--px-space-5) var(--px-space-4); border-top: 1px solid var(--px-divider); }
.st-sheet__st { font-size: var(--px-text-sm); color: var(--px-text-muted); display: inline-flex; align-items: center; gap: var(--px-space-2); min-width: 0; flex-wrap: wrap; }
.st-sheet__st b { color: var(--px-text); font-weight: 600; }
.st-sheet__mdl { display: inline-flex; align-items: center; gap: 5px; color: var(--px-text-secondary); cursor: pointer; background: none; border: 0; padding: 0; font: inherit; font-size: var(--px-text-sm); white-space: nowrap; }
.st-sheet__mdl:hover { color: var(--px-text); }
.st-sheet__acts { display: flex; gap: var(--px-space-2); flex: none; }

/* ── Generation screen ──────────────────────────────────────────────────── */
.st-gen { width: 560px; max-width: calc(100% - 32px); margin: 56px auto 0; }
.st-gen__t { font-size: var(--px-text-md); font-weight: 600; }
.st-gen__s { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: 2px; }
.st-gen__bar { height: 4px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; margin: var(--px-space-4) 0 var(--px-space-4); }
.st-gen__bar i { display: block; height: 100%; width: 0; background: var(--px-accent); border-radius: var(--px-radius-full); transition: width var(--px-dur-slow) var(--px-ease); }
.st-genline { display: flex; gap: var(--px-space-5); font-size: var(--px-text-base); color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.st-genline b { color: var(--px-text); font-weight: 600; }
.st-checks { margin-top: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-md); overflow: hidden; }
.st-ck { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 var(--px-space-3); font-size: var(--px-text-sm); border-top: 1px solid var(--px-divider); color: var(--px-text-secondary); }
.st-ck:first-child { border-top: 0; }
.st-ck__d { width: 7px; height: 7px; border-radius: var(--px-radius-full); background: var(--px-success); flex: none; }
.st-ck__d--run { background: var(--px-accent); animation: st-pulse calc(var(--px-dur-slow) * 5) var(--px-ease) infinite; }
.st-ck__d--idle { background: var(--px-border-strong); }
.st-ck__n { margin-left: auto; color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
@keyframes st-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.st-gen__acts { display: flex; gap: var(--px-space-2); margin-top: var(--px-space-4); justify-content: flex-end; }

/* ── Results ────────────────────────────────────────────────────────────── */
.st-res { width: 100%; max-width: 760px; margin: 0 auto; animation: st-card-in var(--px-dur-slow) var(--px-ease-out); }
.st-res__top { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--px-space-4); padding: var(--px-space-6) 0 var(--px-space-5); border-bottom: 1px solid var(--px-divider); flex-wrap: wrap; }
/* The one hero number, derived from the top step of the ladder. */
.st-res__big { font-size: calc(var(--px-text-xl) * 1.8); font-weight: 600; line-height: 1; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.st-res__big small { font-size: var(--px-text-lg); color: var(--px-text-muted); font-weight: 500; margin-left: var(--px-space-1); }
.st-res__under { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-top: var(--px-space-2); }
.st-res__under b { color: var(--px-text); font-weight: 600; }
.st-res__acts { display: flex; gap: var(--px-space-2); flex-wrap: wrap; justify-content: flex-end; }
.st-res__acts .st-faint { margin-left: var(--px-space-1); }
.st-cov { display: flex; gap: 2px; height: 6px; margin: var(--px-space-5) 0 6px; }
.st-cov i { flex: 1; border-radius: 2px; background: var(--px-surface-active); }
.st-cov i.c { background: var(--px-success); }
.st-cov i.w { background: var(--px-danger); }
.st-cov i.n { background: var(--px-surface-active); }
.st-cov i.c.just { animation: st-fill var(--px-dur-base) var(--px-ease-out) both; animation-delay: calc(var(--st-i, 0) * 24ms); }
@keyframes st-fill { from { transform: scaleX(.2); opacity: .4; } to { transform: none; opacity: 1; } }
.st-covl { display: flex; justify-content: space-between; font-size: var(--px-text-xs); color: var(--px-text-muted); }
.st-covl b { color: var(--px-text); font-weight: 600; }
.st-missed { margin-top: var(--px-space-5); }
.st-missed .px-section-label { padding-top: 0; }
.st-mrow { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--px-space-3); padding: 10px 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-base); }
.st-mrow:first-of-type { border-top: 0; }
.st-mrow__c { font-weight: 500; min-width: 0; }
.st-mrow__c small { display: block; font-size: var(--px-text-xs); color: var(--px-text-muted); margin-top: 1px; font-weight: 400; }
.st-mrow__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; background: none; border: 0; padding: 0; cursor: pointer; font-weight: 500; }
.st-mrow__pg:hover { text-decoration: underline; }
.st-mrow__st { display: inline-flex; align-items: center; gap: 6px; font-size: var(--px-text-xs); color: var(--px-text-muted); white-space: nowrap; }
.st-mrow__st i { width: 6px; height: 6px; border-radius: var(--px-radius-full); background: var(--px-danger); }
.st-mrow__st--w i { background: var(--px-warning); }
.st-res__ft { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3); margin-top: var(--px-space-5); padding-top: var(--px-space-4); border-top: 1px solid var(--px-divider); }
.st-res__lhs { font-size: var(--px-text-sm); color: var(--px-text-muted); }

/* ── Review ─────────────────────────────────────────────────────────────── */
.st-review { width: 100%; max-width: 760px; margin: 0 auto; display: grid; gap: var(--px-space-3); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-review__item { padding: var(--px-space-3) 0 var(--px-space-4); border-top: 1px solid var(--px-divider); display: grid; gap: var(--px-space-2); }
.st-review__item:first-child { border-top: 0; }
.st-review__stem { font-size: var(--px-text-md); font-weight: 600; color: var(--px-text); line-height: 1.4; }
.st-review__stem .px-markdown p { margin: 0; }
.st-review__ans { font-size: var(--px-text-base); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.st-review__ans .px-markdown { display: inline; }
.st-review__ans .px-markdown p { display: inline; margin: 0; }
.st-review__lab { font-size: var(--px-text-xs); color: var(--px-text-faint); margin-right: var(--px-space-1); }
.st-review__ans--ok { color: var(--px-success); }
.st-review__ans--no { color: var(--px-danger); }
.st-review__ans--skip { color: var(--px-text-muted); }
.st-review .st-quote { max-width: none; }

/* ── Learn ──────────────────────────────────────────────────────────────── */
.st-learn { width: 100%; max-width: 720px; margin: 0 auto; padding-top: var(--px-space-2); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-learn__h { font-size: var(--px-text-xl); font-weight: 600; line-height: 1.3; margin: 10px 0 var(--px-space-1); }
.st-learn__sub { font-size: var(--px-text-sm); color: var(--px-text-muted); margin-bottom: var(--px-space-5); }
.st-learn__pt { display: grid; grid-template-columns: 1fr auto; gap: var(--px-space-4); padding: var(--px-space-3) 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-base); line-height: 1.55; color: var(--px-text-secondary); }
.st-learn__pt b { color: var(--px-text); font-weight: 600; }
.st-learn__pt:hover { color: var(--px-text); }
.st-learn__pg { font-size: var(--px-text-xs); color: var(--px-accent-text); white-space: nowrap; align-self: start; margin-top: 3px; cursor: pointer; background: none; border: 0; padding: 0; font-weight: 500; }
.st-learn__pg:hover { text-decoration: underline; }
.st-learn__ft { display: flex; justify-content: space-between; align-items: center; gap: var(--px-space-3); margin-top: var(--px-space-4); padding-top: var(--px-space-4); border-top: 1px solid var(--px-divider); font-size: var(--px-text-sm); color: var(--px-text-muted); }

/* ── Sidebar ────────────────────────────────────────────────────────────── */
.st-sb { display: flex; flex-direction: column; height: 100%; min-width: 0; font-size: var(--px-text-sm); }
.st-sb__hd { display: flex; align-items: center; gap: var(--px-space-1); height: 36px; flex: none; padding: 0 var(--px-space-2) 0 var(--px-sidebar-inset); }
.st-sb__btn--on { color: var(--px-accent-text); background: var(--px-accent-faint); }
.st-sb__body { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: var(--px-space-3); }
.st-sb__sec { padding: var(--px-space-1) 0 var(--px-space-2); }
.st-sb__secl { display: flex; align-items: center; gap: var(--px-space-1); padding: 0 var(--px-space-2) 0 var(--px-sidebar-inset); }
.st-sb__secl .px-section-label { display: inline-flex; align-items: center; gap: var(--px-space-1); min-width: 0; }
.st-sb__secl--fold .px-section-label { cursor: pointer; color: var(--px-text-faint); }
.st-sb__secl--fold .px-section-label:hover { color: var(--px-text-secondary); }
.st-sb__n { color: var(--px-text-faint); font-weight: 500; margin-left: 2px; font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; }
.st-sb__it { display: grid; grid-template-columns: 16px 1fr auto; align-items: center; gap: var(--px-space-2); height: 30px; padding: 0 var(--px-sidebar-inset); color: var(--px-text-secondary); white-space: nowrap; cursor: pointer; transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease); }
.st-sb__it:hover { background: var(--px-surface-hover); color: var(--px-text); }
.st-sb__it--on { background: var(--px-surface-selected); color: var(--px-text); }
.st-sb__it .svg-icon { color: var(--px-text-muted); display: inline-flex; }
.st-sb__nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.st-mini { width: 48px; height: 3px; border-radius: var(--px-radius-full); background: var(--px-surface-active); overflow: hidden; display: flex; }
.st-sb__r { font-size: var(--px-text-xs); color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
.st-sb__r--weak { color: var(--px-danger); }
.st-sb__it--sub { padding-left: 32px; grid-template-columns: 1fr auto; }
/* Select mode: a check well replaces the icon; chosen rows tint. */
.st-sb__ck { width: 15px; height: 15px; border-radius: 3px; border: 1px solid var(--px-border-strong); background: var(--px-bg-inset); display: inline-flex; align-items: center; justify-content: center; color: transparent; }
.st-sb__ck .svg-icon svg { width: 11px; height: 11px; }
.st-sb__ck--on { background: var(--px-accent); border-color: var(--px-accent); color: var(--px-text-on-accent); }
.st-sb__it--picked { background: var(--px-accent-faint); color: var(--px-text); }
.st-sb__bar { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; margin: var(--px-space-1) var(--px-sidebar-inset) 6px; padding: var(--px-space-2) 10px; white-space: nowrap; border: 1px solid var(--px-border); border-radius: var(--px-radius-md); background: var(--px-bg-elevated); font-size: var(--px-text-sm); color: var(--px-text-secondary); animation: st-card-in var(--px-dur-base) var(--px-ease-out); }
.st-sb__bar b { color: var(--px-text); font-weight: 600; }
.st-sb__bar small { display: block; font-size: var(--px-text-xs); color: var(--px-text-muted); margin-top: 1px; }
.st-sb__live { width: 6px; height: 6px; border-radius: var(--px-radius-full); background: var(--px-accent); animation: st-pulse calc(var(--px-dur-slow) * 6) var(--px-ease) infinite; justify-self: center; }
.st-sb .px-empty { padding: var(--px-space-6) var(--px-sidebar-inset); }

/* ── Dashboard widget rows (70-integration.js draws them) ──────────────── */
.st-widget { display: flex; flex-direction: column; min-height: 0; }
.st-widget__empty { font-size: var(--px-text-sm); color: var(--px-text-muted); padding: var(--px-space-2) 0; }
.st-widget__row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 7px 0; border-top: 1px solid var(--px-divider); font-size: var(--px-text-sm); cursor: pointer; color: var(--px-text); outline: none; }
.st-widget__row:first-of-type { border-top: 0; }
.st-widget__row:hover .st-widget__label, .st-widget__row:focus-visible .st-widget__label { color: var(--px-accent-text); }
.st-widget__text { min-width: 0; }
.st-widget__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-widget__under { display: block; color: var(--px-text-muted); font-size: var(--px-text-xs); margin-top: 1px; }
.st-widget__bar { width: 72px; height: 4px; border-radius: var(--px-radius-full); background: var(--px-surface-active); overflow: hidden; display: block; }
.st-widget__fill { display: block; height: 100%; background: var(--px-danger); }
.st-widget__fill--warn { background: var(--px-warning); }
.st-widget__foot { margin-top: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-accent-text); cursor: pointer; background: none; border: 0; padding: 0; text-align: left; font-family: inherit; }
.st-widget__foot:hover { text-decoration: underline; }

/* ── Reduced motion: every duration above collapses; nothing hides behind
   an animation. The core stills the whole app the same way; repeated here
   scoped to Study so the rule holds for this stylesheet on its own. ─────── */
@media (prefers-reduced-motion: reduce) {
  .st-root, .st-root *, .st-root *::before, .st-root *::after,
  .st-sb, .st-sb *, .st-widget, .st-widget * {
    animation-duration: 0.001ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    transition-delay: 0ms !important;
  }
}
:root[data-px-motion="reduced"] .st-root, :root[data-px-motion="reduced"] .st-root *,
:root[data-px-motion="reduced"] .st-root *::before, :root[data-px-motion="reduced"] .st-root *::after,
:root[data-px-motion="reduced"] .st-sb, :root[data-px-motion="reduced"] .st-sb *,
:root[data-px-motion="reduced"] .st-widget, :root[data-px-motion="reduced"] .st-widget * {
  animation-duration: 0.001ms !important;
  animation-delay: 0ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  transition-delay: 0ms !important;
}
`;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 50: SIDEBAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════
//
// The desk (mockup section 10): every material with its coverage and, for the
// expanded PDF, its chapters; the sessions open now and the finished ones
// under them; the question banks folded. Select Materials turns the icon
// column into checks and Study Together starts one session over the pick.
// Chrome is the kit's (icon buttons, section labels, the empty state, the
// context menu, the confirm modal); the rows are Study's own rules on tokens.
// Repaints on bus 'data' and 'session'; every listener goes on dispose.

/** Mode word for a session row and the toolbar scope line. */
const ST_MODE_LABELS = { practice: 'Practice', test: 'Test', learn: 'Learn', weak: 'Weak Spots' };
/** Answer-format word for the toolbar scope line. */
const ST_ANSWER_LABELS = { choose: 'Choose', type: 'Type', mixed: 'Mixed' };

/** bus.on returns a dispose; accept a function or a disposable so the part
 *  works whichever shape 00-header.js settles on. */
function stOff(handle) {
  try {
    if (typeof handle === 'function') handle();
    else if (handle && typeof handle.dispose === 'function') handle.dispose();
  } catch { /* noop */ }
}

/** The icon for a material row, by kind. */
function stMaterialIcon(kind) {
  if (kind === 'pdf') return 'file-text';
  if (kind === 'canvas') return 'notebook-text';
  return 'database';
}

/** "today", "yesterday", a weekday within the week, else "3 Oct". Local
 *  dates on purpose: the sidebar says when the owner studied, in their day. */
function stRelativeDay(ts, now) {
  if (!ts) return '';
  const a = new Date(ts), b = new Date(now);
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  const days = Math.round((dayB - dayA) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return a.toLocaleDateString(undefined, { weekday: 'short' });
  return a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A two-segment coverage bar: green share clean, accent share answered but
 *  not clean (weak or stale). `className` is st-mini (sidebar) or st-ocov. */
function stCoverageBar(className, cov) {
  const bar = el('span', className);
  const total = cov && cov.total ? cov.total : 0;
  const clean = total ? Math.round((cov.clean / total) * 100) : 0;
  const working = total ? Math.round(((cov.weak + cov.stale) / total) * 100) : 0;
  const c = el('i', 'st-cov-c'); c.style.width = `${clean}%`; bar.appendChild(c);
  const w = el('i', 'st-cov-w'); w.style.width = `${working}%`; bar.appendChild(w);
  bar.title = total ? `${cov.clean} of ${total} concepts clean` : 'No concepts yet';
  return bar;
}

/** stCoverage over a concept list with the configured stale window. */
function stCoverageOf(concepts, now) {
  return stCoverage(concepts || [], now, { staleDays: Number(cfg('staleDays', 14)) || 14 });
}

/** Flatten the canvas page tree into quick-pick rows, path as the description. */
function stFlattenPageTree(nodes, path = [], out = []) {
  for (const n of nodes || []) {
    const title = n.title || n.name || 'Untitled';
    out.push({ label: title, description: path.join(' / '), id: n.id });
    if (Array.isArray(n.children) && n.children.length) stFlattenPageTree(n.children, [...path, title], out);
  }
  return out;
}

/** Add PDF…: the workspace pick, ingest, then the setup sheet. Shared by the
 *  header's + menu and the empty state. */
async function stAddPdfFlow() {
  const fsPath = await stPickWorkspacePdf();
  if (!fsPath) return;
  const material = await stIngestPdf(fsPath);
  _emitDataChanged();
  if (material) await stOpenSetup({ materialIds: [material.id] });
}

/** Add Canvas Page…: a quick pick over the page tree, ingest, then the sheet. */
async function stAddCanvasPageFlow() {
  let tree = [];
  try { tree = await _api.workspace.getCanvasPageTree(); } catch { tree = []; }
  const items = stFlattenPageTree(tree);
  if (!items.length) {
    await _api.window.showInformationMessage('No canvas pages in this workspace.');
    return;
  }
  const pick = await _api.window.showQuickPick(items, { placeholder: 'Choose a page', matchOnDescription: true });
  if (!pick || !pick.id) return;
  const material = await stIngestCanvasPage(pick.id);
  _emitDataChanged();
  if (material) await stOpenSetup({ materialIds: [material.id] });
}

function createSidebarView(container) {
  injectStyles();
  const root = el('div', 'st-sb');
  container.appendChild(root);

  const state = {
    disposed: false,
    selecting: false,
    picked: new Set(),
    expandedId: null,
    banksOpen: false,
    activeSessionId: null,
  };

  // ── Header: Select Materials, +, ⋯ ──
  const header = el('div', 'st-sb__hd');
  header.appendChild(el('span', 'st-sp'));
  const selectIcon = _api.icons && typeof _api.icons.hasIcon === 'function' && _api.icons.hasIcon('check-square') ? 'check-square' : 'square-check';
  const selectBtn = _api.ui.createIconButton(header, {
    icon: selectIcon, title: 'Select Materials', size: 'sm',
    onClick: () => {
      state.selecting = !state.selecting;
      if (!state.selecting) { state.picked.clear(); stSetPicked([]); }
      void paint();
    },
  });
  selectBtn.setAttribute('aria-pressed', 'false');
  const addBtn = _api.ui.createIconButton(header, {
    icon: 'plus', title: 'Add Material', size: 'sm',
    onClick: () => {
      _api.ui.showContextMenu(addBtn, [
        { label: 'Add PDF…', icon: 'file-text', onSelect: () => void stAddPdfFlow() },
        { label: 'Add Canvas Page…', icon: 'notebook-text', onSelect: () => void stAddCanvasPageFlow() },
      ], { anchorPosition: 'below' });
    },
  });
  const moreBtn = _api.ui.createIconButton(header, {
    icon: 'ellipsis', title: 'More Actions', size: 'sm',
    onClick: () => {
      _api.ui.showContextMenu(moreBtn, [
        { label: 'Import Questions…', icon: 'database', onSelect: () => void _api.commands.executeCommand('study.importQuestions') },
        { label: "Import Examiner's Report…", icon: 'file-check', onSelect: () => void _api.commands.executeCommand('study.importReport') },
      ], { anchorPosition: 'below' });
    },
  });
  root.appendChild(header);

  const body = el('div', 'st-sb__body');
  root.appendChild(body);

  // ── Rows ──
  const sectionLabel = (host, text, count, { fold = null } = {}) => {
    const row = el('div', 'st-sb__secl' + (fold ? ' st-sb__secl--fold' : ''));
    const label = _api.ui.createSectionLabel(null, text);
    if (fold) {
      const chev = el('span', '');
      chev.innerHTML = icon(fold.open ? 'chevron-down' : 'chevron-right', 12);
      label.prepend(chev);
      label.addEventListener('click', () => fold.onToggle());
      label.setAttribute('role', 'button');
      label.setAttribute('aria-expanded', fold.open ? 'true' : 'false');
    }
    if (count != null) label.appendChild(el('span', 'st-sb__n', String(count)));
    row.appendChild(label);
    host.appendChild(row);
    return row;
  };

  const materialRow = (m, cov, concepts) => {
    const row = el('div', 'st-sb__it st-sb__it--material');
    row.dataset.materialId = String(m.id);
    row.title = m.label;
    if (state.selecting) {
      const on = state.picked.has(m.id);
      const ck = el('span', 'st-sb__ck' + (on ? ' st-sb__ck--on' : ''));
      ck.innerHTML = icon('check', 12);
      row.appendChild(ck);
      if (on) row.classList.add('st-sb__it--picked');
    } else {
      const ic = el('span', '');
      ic.innerHTML = icon(stMaterialIcon(m.kind), 14);
      row.appendChild(ic);
      if (state.expandedId === m.id) row.classList.add('st-sb__it--on');
    }
    row.appendChild(el('span', 'st-sb__nm', m.label));
    row.appendChild(stCoverageBar('st-mini', cov));
    row.addEventListener('click', () => {
      if (state.selecting) {
        if (state.picked.has(m.id)) state.picked.delete(m.id); else state.picked.add(m.id);
        stSetPicked([...state.picked]); // the Study Together command reads the pick
        void paint();
        return;
      }
      state.expandedId = m.id;
      void paint();
      void stOpenSetup({ materialIds: [m.id] });
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _api.ui.showContextMenu({ x: e.clientX, y: e.clientY }, [
        { label: 'Learn', icon: 'book-open', onSelect: () => void stOpenPane({ view: 'learn', materialId: m.id, sectionId: 0 }) },
        { label: 'Study…', icon: 'px-study', onSelect: () => void stOpenSetup({ materialIds: [m.id] }) },
        { separator: true },
        { label: 'Remove', icon: 'trash', danger: true, onSelect: () => void removeMaterial(m, concepts) },
      ]);
    });
    return row;
  };

  const chapterRow = (m, s, concepts, now) => {
    const row = el('div', 'st-sb__it st-sb__it--sub');
    row.dataset.sectionId = String(s.id);
    row.title = s.title;
    row.appendChild(el('span', 'st-sb__nm', s.title));
    const inSection = concepts.filter((c) => c.sectionId === s.id);
    const cov = stCoverageOf(inSection, now);
    let text, cls = 'st-sb__r';
    if (!inSection.length) { text = 'no bank'; cls += ' st-faint'; }
    else if (cov.clean === cov.total) text = 'clean';
    else { text = `${cov.clean} / ${cov.total}`; if (cov.weak > 0) cls += ' st-sb__r--weak'; }
    row.appendChild(el('span', cls, text));
    row.addEventListener('click', () => void stOpenSetup({ materialIds: [m.id], sectionId: s.id }));
    return row;
  };

  const sessionRow = (s, items, now) => {
    const row = el('div', 'st-sb__it st-sb__it--session');
    row.dataset.sessionId = String(s.id);
    const finished = !!s.finishedAt;
    const name = `${s.name} · ${ST_MODE_LABELS[s.mode] || s.mode}`;
    row.title = name;
    if (!finished) {
      row.appendChild(el('span', 'st-sb__live'));
    } else {
      const ic = el('span', '');
      ic.innerHTML = icon('px-study', 14);
      row.appendChild(ic);
    }
    if (state.activeSessionId === s.id) row.classList.add('st-sb__it--on');
    row.appendChild(el('span', 'st-sb__nm', name));
    const list = items || [];
    const lastDraw = list.reduce((m, i) => Math.max(m, i.draw || 0), 0);
    const drawItems = list.filter((i) => (i.draw || 0) === lastDraw);
    const total = drawItems.length || s.size || 0;
    if (!finished) {
      const answered = drawItems.filter((i) => i.status && i.status !== 'pending').length;
      row.appendChild(el('span', 'st-sb__r', `${answered} / ${total}`));
    } else {
      const right = drawItems.filter((i) => i.status === 'right').length;
      row.appendChild(el('span', 'st-sb__r', `${right}/${total} · ${stRelativeDay(s.finishedAt, now)}`));
    }
    row.addEventListener('click', () => void stOpenPane({ view: finished ? 'results' : 'session', sessionId: s.id }));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _api.ui.showContextMenu({ x: e.clientX, y: e.clientY }, [
        { label: 'Delete Session', icon: 'trash', danger: true, onSelect: () => void deleteSession(s) },
      ]);
    });
    return row;
  };

  const bankRow = (b) => {
    const row = el('div', 'st-sb__it st-sb__it--bank');
    row.dataset.bankId = String(b.id);
    const ic = el('span', '');
    ic.innerHTML = icon('database', 14);
    row.appendChild(ic);
    row.appendChild(el('span', 'st-sb__nm', b.name));
    row.title = b.name;
    row.appendChild(el('span', 'st-sb__r', `${b.count || 0} · ${b.kind}`));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _api.ui.showContextMenu({ x: e.clientX, y: e.clientY }, [
        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => void deleteBank(b) },
      ]);
    });
    return row;
  };

  // ── Destructive flows, each behind the app's confirm modal ──
  async function removeMaterial(m, concepts) {
    const ok = await _api.window.showConfirmModal({
      message: `Remove ${m.label}?`,
      detail: `Its ${(concepts || []).length} concepts, their questions and every session over it go too. The file stays where it is.`,
      confirmLabel: 'Remove', danger: true,
    });
    if (!ok) return;
    await stDeleteMaterial(m.id);
    if (state.expandedId === m.id) state.expandedId = null;
    state.picked.delete(m.id);
    _emitDataChanged();
  }
  async function deleteSession(s) {
    const ok = await _api.window.showConfirmModal({
      message: `Delete the session ${s.name}?`,
      detail: 'Its answers are already counted toward each concept; only the session record goes.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    await stDeleteSession(s.id);
    _emitDataChanged();
  }
  async function deleteBank(b) {
    const ok = await _api.window.showConfirmModal({
      message: `Delete the bank ${b.name}?`,
      detail: `Its ${b.count || 0} questions go with it.`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    await stDeleteBank(b.id);
    _emitDataChanged();
  }

  // ── Paint ──
  let painting = false, paintQueued = false;
  async function paint() {
    if (painting) { paintQueued = true; return; }
    painting = true;
    try {
      do {
        paintQueued = false;
        await paintOnce();
      } while (paintQueued && !state.disposed);
    } finally { painting = false; }
  }

  async function paintOnce() {
    const now = stNow();
    const materials = (await stListMaterials()) || [];
    const perMaterial = [];
    for (const m of materials) {
      const concepts = (await stListConcepts({ materialIds: [m.id] })) || [];
      const sections = m.kind === 'pdf' && state.expandedId === m.id ? ((await stListSections(m.id)) || []) : [];
      perMaterial.push({ m, concepts, cov: stCoverageOf(concepts, now), sections });
    }
    const open = (await stListSessions({ open: true })) || [];
    const done = (await stListSessions({ open: false })) || [];
    const itemsBySession = new Map();
    for (const s of [...open, ...done]) itemsBySession.set(s.id, (await stListSessionItems(s.id)) || []);
    const banks = (await stListBanks()) || [];
    if (state.disposed) return;

    selectBtn.setAttribute('aria-pressed', state.selecting ? 'true' : 'false');
    selectBtn.classList.toggle('st-sb__btn--on', state.selecting);
    body.innerHTML = '';

    if (!materials.length) {
      _api.ui.createEmptyState(body, {
        icon: 'px-study',
        headline: 'Nothing to study yet.',
        hint: 'Open a PDF and choose Study This Document, or add one here.',
        action: { label: 'Add PDF…', onClick: () => void stAddPdfFlow() },
      });
      return;
    }

    // The pick bar, while selecting.
    if (state.selecting) {
      const bar = el('div', 'st-sb__bar');
      const chosen = perMaterial.filter((p) => state.picked.has(p.m.id));
      const concepts = chosen.reduce((n, p) => n + p.cov.total, 0);
      const weak = chosen.reduce((n, p) => n + p.cov.weak, 0);
      const left = el('div', '');
      left.appendChild(el('b', '', `${chosen.length} ${chosen.length === 1 ? 'material' : 'materials'}`));
      left.appendChild(el('small', '', `${concepts} concepts · ${weak} weak`));
      bar.appendChild(left);
      _api.ui.createButton(bar, {
        label: 'Study Together', kind: 'primary', size: 'sm', disabled: chosen.length === 0,
        title: chosen.length ? 'One session over the picked materials, interleaved.' : 'Pick at least one material.',
        onClick: () => {
          const ids = chosen.map((p) => p.m.id);
          state.selecting = false;
          state.picked.clear();
          stSetPicked([]);
          void paint();
          void stOpenSetup({ materialIds: ids });
        },
      });
      body.appendChild(bar);
    }

    // Materials.
    const matSec = el('div', 'st-sb__sec st-sb__sec--materials');
    sectionLabel(matSec, 'Materials', materials.length);
    for (const p of perMaterial) {
      matSec.appendChild(materialRow(p.m, p.cov, p.concepts));
      if (!state.selecting) for (const s of p.sections) matSec.appendChild(chapterRow(p.m, s, p.concepts, now));
    }
    body.appendChild(matSec);

    // Sessions.
    if (open.length || done.length) {
      const sesSec = el('div', 'st-sb__sec st-sb__sec--sessions');
      sectionLabel(sesSec, 'Sessions', open.length ? `${open.length} open` : null);
      for (const s of open) sesSec.appendChild(sessionRow(s, itemsBySession.get(s.id), now));
      for (const s of done) sesSec.appendChild(sessionRow(s, itemsBySession.get(s.id), now));
      body.appendChild(sesSec);
    }

    // Question banks, folded.
    if (banks.length) {
      const bankSec = el('div', 'st-sb__sec st-sb__sec--banks');
      sectionLabel(bankSec, 'Question banks', banks.length, {
        fold: { open: state.banksOpen, onToggle: () => { state.banksOpen = !state.banksOpen; void paint(); } },
      });
      if (state.banksOpen) for (const b of banks) bankSec.appendChild(bankRow(b));
      body.appendChild(bankSec);
    }
  }

  const offData = onDataChanged(() => void paint());
  const offSession = bus.on('session', () => void paint());
  const offRoute = bus.on('route', (route) => {
    if (!route) return;
    if (Array.isArray(route.materialIds) && route.materialIds.length === 1) state.expandedId = route.materialIds[0];
    if (route.view === 'learn' && route.materialId) state.expandedId = route.materialId;
    state.activeSessionId = route.sessionId != null ? route.sessionId : state.activeSessionId;
    void paint();
  });

  void paint();

  return {
    dispose() {
      state.disposed = true;
      stOff(offData); stOff(offSession); stOff(offRoute);
      root.remove();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 60: EDITOR PANE — setup, generation, session, results, review, learn
// ═══════════════════════════════════════════════════════════════════════════════
//
// One editor tab per session (instanceId 'session-<id>'), one for the setup
// sheet ('setup'), one per Learn page ('learn-<materialId>-<sectionId>'). The
// pane renders by route (spec §9) and nothing else; every screen is the
// mockup's. The route reaches a pane the Flashcards way: stOpenPane stashes
// it as the pending route, focuses the tab when it exists (the live pane
// takes it from the 'parallx.study.route' document event) or opens the tab
// (the new pane takes it at construction). Session state is in the database
// after every answer, so a closed tab reopens where it was.

let _stPendingRoute = null; // consumed by the editor pane on first render

function _stTakePendingRoute() {
  const r = _stPendingRoute;
  _stPendingRoute = null;
  return r;
}

/** The tab a route lives in (spec §0b). */
function stRouteInstanceId(route) {
  if (!route) return 'setup';
  if (route.view === 'setup') return 'setup';
  if (route.view === 'learn') return `learn-${route.materialId}-${route.sectionId || 0}`;
  return `session-${route.sessionId}`;
}

/** The route a rebuilt pane starts from when no pending route was handed to
 *  it (a tab switch or a workspace restore): the tab's own instance id. The
 *  session route itself decides between session and results by the row. */
function stRouteFromInstanceId(instanceId) {
  const id = String(instanceId || '');
  let m = /^session-(\d+)$/.exec(id);
  if (m) return { view: 'session', sessionId: Number(m[1]) };
  m = /^learn-(\d+)-(\d+)$/.exec(id);
  if (m) return { view: 'learn', materialId: Number(m[1]), sectionId: Number(m[2]) };
  return { view: 'setup', materialIds: [] };
}

async function stRouteTitle(route) {
  try {
    if (route.view === 'setup') return 'Study';
    if (route.view === 'learn') {
      const material = await stGetMaterial(route.materialId);
      let title = material ? material.label : 'Learn';
      if (route.sectionId) {
        const section = ((await stListSections(route.materialId)) || []).find((s) => s.id === route.sectionId);
        if (section) title = section.title;
      }
      return `Learn · ${stTruncate(title, 40)}`;
    }
    const session = await stGetSession(route.sessionId);
    return session ? `Study · ${stTruncate(session.name, 40)}` : 'Study';
  } catch { return 'Study'; }
}

/** Open or focus the tab for a route. Copied from openFlashcards: the route
 *  is stashed first on every path, because an open tab does not imply a live
 *  pane (the workbench builds panes lazily and drops them on restore). */
async function stOpenPane(route) {
  if (!route || !route.view) return;
  _stPendingRoute = route;
  const instanceId = stRouteInstanceId(route);
  try {
    const existing = (_api.editors.openEditors || []).find((e) =>
      typeof e?.id === 'string' && e.id.endsWith(`:study:${instanceId}`));
    if (existing) {
      await _api.editors.focusEditor(existing.id);
      document.dispatchEvent(new CustomEvent('parallx.study.route', { detail: route }));
      return;
    }
  } catch { /* fall through to a fresh open */ }
  await _api.editors.openEditor({
    typeId: 'study',
    title: await stRouteTitle(route),
    iconHtml: ST_ICON_HTML,
    instanceId,
  });
}

function stOpenSetup(partial) {
  const p = partial || {};
  const route = { view: 'setup', materialIds: Array.isArray(p.materialIds) ? p.materialIds.slice() : [] };
  for (const k of ['sectionId', 'pageFrom', 'pageTo', 'selectionText', 'selectionPage']) if (p[k] != null) route[k] = p[k];
  return stOpenPane(route);
}

// ── Small helpers shared by the screens ─────────────────────────────────────

/** A field by its camelCase name, falling back to the snake_case column, so
 *  the screens read a row whichever shape 20-data.js hands over. */
function stProp(obj, key, fallback) {
  if (!obj) return fallback;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return obj[snake] !== undefined && obj[snake] !== null ? obj[snake] : fallback;
}

/** The session's StScope, parsed when it is still JSON. */
function stSessionScope(session) {
  const raw = stProp(session, 'scope', null) ?? stProp(session, 'scopeJson', null);
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/** The concepts a scope covers, from the concept list of its materials. */
function stConceptsInScope(concepts, scope) {
  const list = concepts || [];
  if (!scope) return list;
  if (scope.kind === 'chapter' && Array.isArray(scope.sectionIds) && scope.sectionIds.length) {
    return list.filter((c) => scope.sectionIds.includes(c.sectionId));
  }
  if ((scope.kind === 'pages' || scope.kind === 'selection') && scope.pageFrom) {
    const to = scope.pageTo || scope.pageFrom;
    return list.filter((c) => c.page >= scope.pageFrom && c.page <= to);
  }
  if (Array.isArray(scope.materialIds) && scope.materialIds.length) return list.filter((c) => scope.materialIds.includes(c.materialId));
  return list;
}

/** The questions a set of session items point at, by id. stListQuestions
 *  filters by material, so the scope's materials come first and the whole
 *  table only when an item's question is still missing (a bank question
 *  not yet mapped to a material). */
async function stQuestionMap(scope, ids) {
  const wanted = new Set(ids);
  const map = new Map();
  const add = (list) => { for (const q of list || []) if (wanted.has(q.id)) map.set(q.id, q); };
  const materialIds = scope && Array.isArray(scope.materialIds) && scope.materialIds.length ? scope.materialIds : undefined;
  add(await stListQuestions({ materialIds, includeHidden: true }));
  if (map.size < wanted.size && materialIds) add(await stListQuestions({ includeHidden: true }));
  return map;
}

function stFmtK(n) {
  const v = Number(n) || 0;
  if (!v) return '';
  return v >= 1024 ? `${Math.round(v / 1024)}k` : String(v);
}

/** Markdown (and LaTeX) through the kit; a text node when the kit is absent. */
function stMd(text) {
  const s = String(text ?? '');
  try {
    if (_api.ui && typeof _api.ui.renderMarkdown === 'function') return _api.ui.renderMarkdown(s);
  } catch { /* fall through */ }
  return document.createTextNode(s);
}

function stSetLabel(btn, text) {
  const l = btn.querySelector('.px-btn__label');
  if (l) l.textContent = text; else btn.textContent = text;
}

/** Resolves after the node's animation ends, or after timeoutMs when no
 *  animationend arrives (reduced motion, a detached node, jsdom). */
function stAfterAnimation(node, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const fin = () => {
      if (done) return;
      done = true;
      node.removeEventListener('animationend', fin);
      clearTimeout(timer);
      resolve();
    };
    node.addEventListener('animationend', fin);
    timer = setTimeout(fin, timeoutMs);
  });
}

/** What the eyebrow says a bank question is graded against. */
function stRubricOriginText(q) {
  if (q.rubricOrigin === 'report') return "graded against the examiner's report";
  if (q.rubricOrigin === 'answer') return 'rubric from the answer';
  if (q.origin === 'rising-fellow') return 'Rising Fellow';
  if (q.origin === 'provider' && q.originLabel) return '';
  return '';
}

function stSourceLabel(q) {
  return q.rubricOrigin === 'report' ? 'Show Report' : 'Show Source';
}

function stPageLabel(q, page) {
  const prefix = q.rubricOrigin === 'report' ? 'Report p.' : 'p.';
  return page ? `${prefix} ${page}` : 'Source';
}

/** The anchor quote with the warning rule and the page link. */
function stQuoteEl(q, quote, page, onOpen) {
  const box = el('div', 'st-quote');
  box.appendChild(el('span', 'st-quote__text', quote ? `“${quote}”` : 'No anchor stored for this question.'));
  if (page || q.sourceUri || q.providerId) {
    const pg = el('button', 'st-quote__pg');
    pg.type = 'button';
    pg.textContent = `${stPageLabel(q, page)} ↗`;
    pg.title = 'Open beside the session (S)';
    pg.addEventListener('click', () => onOpen());
    box.appendChild(pg);
  }
  return box;
}

/** The session toolbar: scope line, optional strand host, the close button. */
function stToolbar(host, { name, meta, strand, closeTitle, onClose }) {
  const tb = el('div', 'st-sess-tb');
  const scope = el('span', 'st-sess-tb__scope', `${name} `);
  if (meta) scope.appendChild(el('span', 'm', `· ${meta}`));
  tb.appendChild(scope);
  tb.appendChild(el('span', 'st-sp'));
  let strandEl = null;
  if (strand) {
    strandEl = el('div', 'st-strand');
    strandEl.setAttribute('role', 'img');
    tb.appendChild(strandEl);
  }
  if (onClose) _api.ui.createIconButton(tb, { icon: 'x', title: closeTitle || 'Close', size: 'sm', onClick: () => void onClose() });
  host.appendChild(tb);
  return { tb, strand: strandEl };
}

/** A state → class for the results coverage bar. */
function stCovClass(state) {
  if (state === 'clean') return 'c';
  if (state === 'weak') return 'w';
  return 'n';
}

/** A scope's label and the Start-time StScope from the sheet's choices. */
function stBuildScope(st, materials, sections, route) {
  const primary = materials[0];
  if (st.kind === 'chapter') {
    const s = sections.find((x) => x.id === st.sectionId) || sections[0];
    return {
      kind: 'chapter', materialIds: [primary.id], sectionIds: s ? [s.id] : [],
      pageFrom: s ? stProp(s, 'pageFrom', 0) : 0, pageTo: s ? stProp(s, 'pageTo', 0) : 0,
      label: `${stTruncate(primary.label, 32)} · ${s ? stTruncate(s.title, 40) : 'chapter'}`,
    };
  }
  if (st.kind === 'pages') {
    const from = Math.max(1, Number(st.pageFrom) || 1);
    const to = Math.max(from, Number(st.pageTo) || from);
    return { kind: 'pages', materialIds: [primary.id], pageFrom: from, pageTo: to, label: `${stTruncate(primary.label, 32)} · pp. ${from}–${to}` };
  }
  if (st.kind === 'selection') {
    const page = Number(route.selectionPage) || 0;
    return {
      kind: 'selection', materialIds: [primary.id], selectionText: route.selectionText || '', selectionPage: page,
      pageFrom: page, pageTo: page, label: `${stTruncate(primary.label, 32)} · ${page ? `p. ${page}` : 'selection'}`,
    };
  }
  if (st.kind === 'materials') {
    return { kind: 'materials', materialIds: materials.map((m) => m.id), label: materials.map((m) => stTruncate(m.label, 20)).join(' + ') };
  }
  return { kind: 'document', materialIds: [primary.id], label: primary.label };
}

// ── In-flight draws, kept across pane rebuilds ──────────────────────────────
// The workbench rebuilds a pane on every tab switch; a generation run must
// not die with it. One run per session, owned here, released when it settles.
const _stRuns = new Map();

function stRunFor(session) {
  let run = _stRuns.get(session.id);
  if (run) return run;
  const token = { cancelled: false };
  run = {
    token,
    progress: { phase: '', done: 0, total: 0, written: 0, kept: 0, dropped: {} },
    listeners: new Set(),
    done: false, result: null, error: null, promise: null,
  };
  const notify = () => { for (const fn of run.listeners) { try { fn(); } catch { /* noop */ } } };
  const onProgress = (p) => {
    if (p && typeof p === 'object') {
      const dropped = p.dropped && typeof p.dropped === 'object' ? { ...run.progress.dropped, ...p.dropped } : run.progress.dropped;
      Object.assign(run.progress, p, { dropped });
    }
    notify();
  };
  run.onProgress = onProgress;
  run.promise = Promise.resolve()
    .then(() => stNextDraw(session, { token, onProgress }))
    .then((qs) => { run.result = Array.isArray(qs) ? qs : []; }, (err) => { run.error = err; })
    .then(() => { run.done = true; _stRuns.delete(session.id); notify(); });
  _stRuns.set(session.id, run);
  return run;
}

// ── The pane ────────────────────────────────────────────────────────────────

function createEditorPane(container, input) {
  injectStyles();
  const pendingRoute = _stTakePendingRoute();
  const instanceId = input && input.instanceId ? input.instanceId : stRouteInstanceId(pendingRoute);
  const state = {
    route: pendingRoute || stRouteFromInstanceId(instanceId),
    disposed: false,
    explicitRoute: !!pendingRoute,
  };

  const root = el('div', 'st-root');
  root.tabIndex = 0;
  root.setAttribute('aria-label', 'Study');
  container.appendChild(root);

  let viewDisposables = [];
  const disposeView = () => {
    for (const d of viewDisposables) { try { d.dispose(); } catch { /* noop */ } }
    viewDisposables = [];
  };

  const ctx = {
    root,
    input,
    setRoute,
    add: (d) => { viewDisposables.push(d); },
    disposed: () => state.disposed,
    closeTab: async () => {
      try { if (input && input.id && _api.editors && typeof _api.editors.closeEditor === 'function') await _api.editors.closeEditor(input.id); } catch { /* noop */ }
    },
  };

  let rendering = false, renderQueued = false;
  const render = async () => {
    if (rendering) { renderQueued = true; return; }
    rendering = true;
    try {
      do {
        renderQueued = false;
        if (state.disposed) return;
        disposeView();
        root.innerHTML = '';
        const route = state.route;
        try {
          if (route.view === 'setup') await renderSetup(root, route, ctx);
          else if (route.view === 'generating') await renderGenerating(root, route, ctx);
          else if (route.view === 'session') await renderSession(root, route, ctx);
          else if (route.view === 'results') await renderResults(root, route, ctx);
          else if (route.view === 'review') await renderReview(root, route, ctx);
          else if (route.view === 'learn') await renderLearn(root, route, ctx);
          else await renderSetup(root, { view: 'setup', materialIds: [] }, ctx);
        } catch (err) {
          if (state.disposed) return;
          // Error boundary, as the Flashcards pane: a view that throws says so.
          root.innerHTML = '';
          const box = el('div', 'st-error');
          box.appendChild(el('div', 'st-error__t', 'Study could not open this view.'));
          box.appendChild(el('div', '', String(err && err.message ? err.message : err)));
          const acts = el('div', 'st-row');
          _api.ui.createButton(acts, { label: 'Retry', icon: 'refresh-cw', onClick: () => void render() });
          box.appendChild(acts);
          root.appendChild(box);
        }
      } while (renderQueued && !state.disposed);
    } finally {
      rendering = false;
    }
  };

  function setRoute(route) {
    if (JSON.stringify(route) === JSON.stringify(state.route)) return;
    state.route = route;
    state.explicitRoute = true;
    bus.emit('route', route);
    void render();
  }

  const onRouteEvent = (e) => {
    if (!root.isConnected) return;
    const route = e.detail;
    if (!route || !route.view) return;
    // Only the pane whose tab the route names navigates; several Study tabs
    // can be open at once, one per session.
    if (stRouteInstanceId(route) !== instanceId) return;
    _stTakePendingRoute();
    setRoute(route);
  };
  document.addEventListener('parallx.study.route', onRouteEvent);

  bus.emit('route', state.route);
  void render();

  return {
    dispose() {
      state.disposed = true;
      disposeView();
      document.removeEventListener('parallx.study.route', onRouteEvent);
      root.remove();
    },
    saveViewState() {
      return { route: state.route };
    },
    restoreViewState(saved) {
      if (state.disposed || !saved || !saved.route || !saved.route.view) return;
      if (state.explicitRoute) return;
      setRoute(saved.route);
      state.explicitRoute = false;
    },
  };
}

// ── Setup sheet ─────────────────────────────────────────────────────────────

async function renderSetup(host, route, ctx) {
  const now = stNow();
  const all = (await stListMaterials()) || [];
  let ids = Array.isArray(route.materialIds) ? route.materialIds.filter((n) => n != null) : [];
  if (!ids.length) ids = all.map((m) => m.id);
  const materials = ids.map((id) => all.find((m) => m.id === id)).filter(Boolean);
  if (!materials.length) {
    _api.ui.createEmptyState(host, {
      icon: 'px-study',
      headline: 'Nothing to study yet.',
      hint: 'Open a PDF and choose Study This Document, or add one here.',
      action: { label: 'Add PDF…', onClick: () => void stAddPdfFlow() },
    });
    return;
  }
  const primary = materials[0];
  const sections = primary.kind === 'pdf' ? ((await stListSections(primary.id)) || []) : [];
  const concepts = (await stListConcepts({ materialIds: materials.map((m) => m.id) })) || [];
  let models = [];
  let activeModel = '';
  if (_api.lm) {
    try { models = (await _api.lm.getModels()) || []; } catch { models = []; }
    try { activeModel = typeof _api.lm.getActiveModel === 'function' ? (_api.lm.getActiveModel() || '') : ''; } catch { activeModel = ''; }
  }
  const size = Number(cfg('sessionSize', 20)) || 20;

  const kinds = [];
  if (materials.length > 1) kinds.push({ value: 'materials', label: 'Materials' });
  kinds.push({ value: 'document', label: 'Document' });
  if (primary.kind === 'pdf') kinds.push({ value: 'pages', label: 'Pages' });
  if (sections.length) kinds.push({ value: 'chapter', label: 'Chapter' });
  if (route.selectionText) kinds.push({ value: 'selection', label: 'Selection' });

  const st = {
    kind: route.selectionText ? 'selection'
      : route.sectionId && sections.some((s) => s.id === route.sectionId) ? 'chapter'
      : route.pageFrom ? 'pages'
      : materials.length > 1 ? 'materials' : 'document',
    sectionId: route.sectionId || (sections[0] ? sections[0].id : 0),
    pageFrom: route.pageFrom || 1,
    pageTo: route.pageTo || route.pageFrom || stProp(primary, 'pageCount', 1) || 1,
    mode: 'practice',
    answer: stProp(primary, 'answerFormat', '') || String(cfg('answerFormat', 'mixed') || 'mixed'),
    model: stProp(primary, 'model', '') || String(cfg('aiModel', '') || ''),
    contextSetting: Number(stProp(primary, 'contextSetting', 0)) || Number(cfg('generationContext', 0)) || 0,
    starting: false,
  };
  if (!['choose', 'type', 'mixed'].includes(st.answer)) st.answer = 'mixed';

  host.appendChild(el('div', 'st-scrim'));
  const sheet = el('div', 'st-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Study');
  host.appendChild(sheet);

  const hd = el('div', 'st-sheet__hd');
  const titles = el('div', '');
  titles.appendChild(el('h3', 'st-sheet__title', 'Study'));
  titles.appendChild(el('div', 'st-sheet__sub', materials.length > 1 ? `${materials.length} materials` : primary.label));
  hd.appendChild(titles);
  _api.ui.createIconButton(hd, { icon: 'x', title: 'Cancel', size: 'sm', onClick: () => void ctx.closeTab() });
  sheet.appendChild(hd);

  const bd = el('div', 'st-sheet__bd');
  sheet.appendChild(bd);

  // Scope row.
  const scopeRow = el('div', 'st-row');
  scopeRow.appendChild(el('span', 'st-row__lab', 'Scope'));
  const scopeSeg = _api.ui.createSegmented(scopeRow, {
    ariaLabel: 'Scope', items: kinds, value: st.kind,
    onChange: (v) => { st.kind = v; paintList(); void paintFooter(); },
  });
  ctx.add(scopeSeg);
  bd.appendChild(scopeRow);

  // The list under the scope: outline, page inputs, the selection, or the materials.
  const listHost = el('div', 'st-sheet__list');
  bd.appendChild(listHost);

  const conceptsBySection = new Map();
  for (const c of concepts) {
    const k = c.sectionId || 0;
    if (!conceptsBySection.has(k)) conceptsBySection.set(k, []);
    conceptsBySection.get(k).push(c);
  }

  function paintList() {
    listHost.innerHTML = '';
    if (st.kind === 'document' || st.kind === 'chapter') {
      if (!sections.length) {
        const cov = stCoverageOf(concepts, now);
        const line = el('div', 'st-selection', `${primary.label} · ${stProp(primary, 'pageCount', 0) ? `${stProp(primary, 'pageCount', 0)} pages · ` : ''}${cov.total} concepts`);
        listHost.appendChild(line);
        return;
      }
      const outline = el('div', 'st-outline');
      outline.setAttribute('role', 'listbox');
      for (const s of sections) {
        const row = el('div', 'st-outline__o' + (st.kind === 'chapter' && s.id === st.sectionId ? ' st-outline__o--on' : ''));
        row.setAttribute('role', 'option');
        row.dataset.sectionId = String(s.id);
        row.appendChild(el('span', 'st-outline__nm', s.title));
        row.appendChild(stCoverageBar('st-ocov', stCoverageOf(conceptsBySection.get(s.id) || [], now)));
        const from = stProp(s, 'pageFrom', 0), to = stProp(s, 'pageTo', 0);
        row.appendChild(el('span', 'st-outline__pp', from === to ? String(from) : `${from}–${to}`));
        row.addEventListener('click', () => {
          st.sectionId = s.id;
          st.kind = 'chapter';
          scopeSeg.value = 'chapter';
          paintList();
          void paintFooter();
        });
        outline.appendChild(row);
      }
      listHost.appendChild(outline);
      return;
    }
    if (st.kind === 'pages') {
      const row = el('div', 'st-pages');
      const mk = (label, key) => {
        row.appendChild(el('span', '', label));
        const input = el('input', 'st-input');
        input.type = 'number';
        input.min = '1';
        const max = stProp(primary, 'pageCount', 0);
        if (max) input.max = String(max);
        input.value = String(st[key]);
        input.setAttribute('aria-label', label === 'From' ? 'First page' : 'Last page');
        input.addEventListener('input', () => { st[key] = Number(input.value) || 1; void paintFooter(); });
        row.appendChild(input);
      };
      mk('From', 'pageFrom');
      mk('to', 'pageTo');
      const max = stProp(primary, 'pageCount', 0);
      if (max) row.appendChild(el('span', 'st-faint', `of ${max}`));
      listHost.appendChild(row);
      return;
    }
    if (st.kind === 'selection') {
      const box = el('div', 'st-selection');
      box.textContent = stTruncate(String(route.selectionText || ''), 280);
      if (route.selectionPage) box.appendChild(el('span', 'st-faint', ` · p. ${route.selectionPage}`));
      listHost.appendChild(box);
      return;
    }
    // materials
    const outline = el('div', 'st-outline');
    for (const m of materials) {
      const row = el('div', 'st-outline__o');
      row.dataset.materialId = String(m.id);
      row.appendChild(el('span', 'st-outline__nm', m.label));
      row.appendChild(stCoverageBar('st-ocov', stCoverageOf(concepts.filter((c) => c.materialId === m.id), now)));
      outline.appendChild(row);
    }
    listHost.appendChild(outline);
  }

  // Mode and Answer on one row.
  const modeRow = el('div', 'st-row');
  modeRow.appendChild(el('span', 'st-row__lab', 'Mode'));
  let answerSeg = null;
  const modeSeg = _api.ui.createSegmented(modeRow, {
    ariaLabel: 'Mode',
    items: [{ value: 'practice', label: 'Practice' }, { value: 'test', label: 'Test' }, { value: 'learn', label: 'Learn' }],
    value: st.mode,
    onChange: (v) => {
      st.mode = v;
      if (v === 'test' && answerSeg) { st.answer = 'type'; answerSeg.value = 'type'; }
      void paintFooter();
    },
  });
  modeSeg.element.title = 'Practice marks as you go and lets you retry. Test is typed answers, no retry, results at the end. Learn is the chapter in a page.';
  ctx.add(modeSeg);
  modeRow.appendChild(el('span', 'st-row__lab st-row__lab--inline', 'Answer'));
  answerSeg = _api.ui.createSegmented(modeRow, {
    ariaLabel: 'Answer format',
    items: [{ value: 'choose', label: 'Choose' }, { value: 'type', label: 'Type' }, { value: 'mixed', label: 'Mixed' }],
    value: st.answer,
    onChange: (v) => { st.answer = v; void paintFooter(); },
  });
  answerSeg.element.title = 'Mixed starts on choices and moves a concept to typing once it has been answered right.';
  ctx.add(answerSeg);
  bd.appendChild(modeRow);

  // Footer: the model line, the count line, Cancel, Start.
  const ft = el('div', 'st-sheet__ft');
  const status = el('span', 'st-sheet__st');
  const mdlBtn = el('button', 'st-sheet__mdl');
  mdlBtn.type = 'button';
  mdlBtn.title = 'The model that writes and grades, and its context window';
  status.appendChild(mdlBtn);
  status.appendChild(el('span', 'st-faint', '·'));
  const countEl = el('span', 'st-sheet__count');
  status.appendChild(countEl);
  ft.appendChild(status);
  const acts = el('span', 'st-sheet__acts');
  _api.ui.createButton(acts, { label: 'Cancel', kind: 'ghost', onClick: () => void ctx.closeTab() });
  const startBtn = _api.ui.createButton(acts, { label: 'Start', kind: 'primary', onClick: () => void start() });
  ft.appendChild(acts);
  sheet.appendChild(ft);

  const effectiveModel = () => st.model || activeModel || (models[0] ? models[0].id : '');
  const modelName = (id) => { const m = models.find((x) => x.id === id); return m ? (m.displayName || m.id) : (id || 'No model'); };
  const paintModel = () => {
    mdlBtn.innerHTML = '';
    const mark = el('span', '');
    mark.innerHTML = icon('px-ai-mark', 12);
    mdlBtn.appendChild(mark);
    const ctxLabel = st.contextSetting ? `${stFmtK(st.contextSetting)} context` : 'Auto context';
    mdlBtn.appendChild(el('span', '', `${modelName(effectiveModel())} · ${ctxLabel}`));
    const chev = el('span', '');
    chev.innerHTML = icon('chevron-down', 12);
    mdlBtn.appendChild(chev);
  };
  const savePrefs = async () => {
    for (const m of materials) {
      try { await stSetMaterialPrefs(m.id, { model: st.model, contextSetting: st.contextSetting, answerFormat: st.answer }); } catch { /* noop */ }
    }
  };
  mdlBtn.addEventListener('click', () => {
    const items = [{ label: 'Model', disabled: true }];
    for (const m of models) {
      items.push({
        label: m.displayName || m.id, keybinding: stFmtK(m.contextLength), checked: st.model === m.id,
        onSelect: () => { st.model = m.id; paintModel(); void savePrefs(); },
      });
    }
    items.push({ label: "Use the chat's model", checked: !st.model, onSelect: () => { st.model = ''; paintModel(); void savePrefs(); } });
    items.push({ separator: true });
    items.push({ label: 'Context', disabled: true });
    items.push({ label: 'Auto', checked: !st.contextSetting, onSelect: () => { st.contextSetting = 0; paintModel(); void savePrefs(); } });
    const current = models.find((x) => x.id === effectiveModel());
    const limit = current ? Number(current.contextLength) || 0 : 0;
    for (const k of [8, 16, 32, 64]) {
      const tokens = k * 1024;
      if (limit && tokens > limit) continue;
      items.push({ label: `${k}k`, checked: st.contextSetting === tokens, onSelect: () => { st.contextSetting = tokens; paintModel(); void savePrefs(); } });
    }
    _api.ui.showContextMenu(mdlBtn, items, { anchorPosition: 'above' });
  });

  let footerSeq = 0;
  async function paintFooter() {
    const seq = ++footerSeq;
    const scope = stBuildScope(st, materials, sections, route);
    const scopeConcepts = stConceptsInScope(concepts, scope);
    const cov = stCoverageOf(scopeConcepts, now);
    let candidates = [];
    if (scopeConcepts.length && st.mode !== 'learn') {
      try {
        candidates = ((await stListQuestions({ materialIds: scope.materialIds, conceptIds: scopeConcepts.map((c) => c.id) })) || []).filter((q) => !q.hidden);
      } catch { candidates = []; }
    }
    if (seq !== footerSeq || ctx.disposed()) return;
    const short = st.mode !== 'learn' && candidates.length < size;
    countEl.textContent = short
      ? `${candidates.length} questions in the bank, ${size - candidates.length} more will be made first`
      : `${cov.total} concepts, ${cov.clean} clean`;
    stSetLabel(startBtn, st.mode !== 'learn' && short ? 'Make Questions and Start' : 'Start');
    startBtn.title = st.mode === 'learn' ? 'Open the chapter as a page' : short ? 'Writes the missing questions first, then starts' : `Draws ${size} questions from the bank`;
  }

  async function start() {
    if (st.starting) return;
    st.starting = true;
    startBtn.disabled = true;
    try {
      const scope = stBuildScope(st, materials, sections, route);
      await savePrefs();
      if (st.mode === 'learn') {
        await stOpenPane({ view: 'learn', materialId: primary.id, sectionId: (scope.sectionIds && scope.sectionIds[0]) || 0 });
        await ctx.closeTab();
        return;
      }
      await stStartSession({ scope, mode: st.mode, answerFormat: st.answer, model: st.model, numCtx: st.contextSetting });
      _emitDataChanged();
      await ctx.closeTab();
    } catch (err) {
      st.starting = false;
      startBtn.disabled = false;
      try { await _api.window.showErrorMessage(`Could not start: ${err && err.message ? err.message : err}`); } catch { /* noop */ }
    }
  }

  paintList();
  paintModel();
  await paintFooter();
}

// ── Generation screen ───────────────────────────────────────────────────────

const ST_CHECK_ROWS = [
  { key: 'anchor', label: 'Anchor is on the page', setting: 'checkAnchor' },
  { key: 'support', label: 'Anchor settles the answer', setting: 'checkSupport' },
  { key: 'distractor', label: 'No wrong option is defensible', setting: 'checkDistractors' },
  { key: 'numeric', label: 'Numeric answers execute', setting: 'checkNumeric' },
];

async function renderGenerating(host, route, ctx) {
  const session = await stGetSession(route.sessionId);
  if (!session) throw new Error('This session no longer exists.');
  const scope = stSessionScope(session);
  const items = (await stListSessionItems(session.id)) || [];
  if (items.some((i) => i.status === 'pending')) {
    ctx.setRoute({ view: 'session', sessionId: session.id });
    return;
  }
  const materialIds = Array.isArray(scope.materialIds) ? scope.materialIds : [];
  const primary = materialIds.length ? await stGetMaterial(materialIds[0]) : null;
  const concepts = stConceptsInScope((await stListConcepts({ materialIds })) || [], scope);
  const size = Number(stProp(session, 'size', 0)) || Number(cfg('sessionSize', 20)) || 20;
  let modelId = stProp(session, 'model', '');
  if (!modelId) { try { modelId = (await stPickModel(primary)) || ''; } catch { modelId = ''; } }

  const gen = el('div', 'st-gen');
  gen.appendChild(el('div', 'st-gen__t', `Making questions for ${scope.label || session.name}`));
  const pages = scope.pageFrom ? `Pages ${scope.pageFrom} to ${scope.pageTo || scope.pageFrom}` : (primary && stProp(primary, 'pageCount', 0) ? `${stProp(primary, 'pageCount', 0)} pages` : (materialIds.length > 1 ? `${materialIds.length} materials` : 'Whole document'));
  const sub = el('div', 'st-gen__s');
  gen.appendChild(sub);
  const bar = el('div', 'st-gen__bar');
  const fill = el('i', '');
  bar.appendChild(fill);
  gen.appendChild(bar);
  const line = el('div', 'st-genline');
  gen.appendChild(line);
  const checks = el('div', 'st-checks');
  const rows = new Map();
  for (const def of ST_CHECK_ROWS) {
    const ck = el('div', 'st-ck');
    ck.dataset.check = def.key;
    const dot = el('span', 'st-ck__d st-ck__d--idle');
    ck.appendChild(dot);
    ck.appendChild(el('span', '', def.label));
    const n = el('span', 'st-ck__n', '');
    ck.appendChild(n);
    checks.appendChild(ck);
    rows.set(def.key, { dot, n, on: cfg(def.setting, true) !== false });
  }
  gen.appendChild(checks);
  const acts = el('div', 'st-gen__acts');
  const stopBtn = _api.ui.createButton(acts, { label: 'Stop', kind: 'ghost', title: 'Stop writing; what is kept stays in the bank', onClick: () => void stop() });
  const startBtn = _api.ui.createButton(acts, { label: `Start With ${size} Ready`, kind: 'primary', disabled: true, onClick: () => void startEarly() });
  gen.appendChild(acts);
  host.appendChild(gen);

  const run = stRunFor(session);
  const total = () => run.progress.total || concepts.length || 0;
  const paint = () => {
    if (ctx.disposed()) return;
    const p = run.progress;
    const done = Number(p.done) || 0;
    const t = total();
    sub.textContent = `${pages} · ${t} concepts${modelId ? ` · ${modelId}` : ''}`;
    fill.style.width = `${t ? Math.min(100, Math.round((done / t) * 100)) : 0}%`;
    const dropped = p.dropped || {};
    const droppedTotal = Object.values(dropped).reduce((a, b) => a + (Number(b) || 0), 0);
    line.innerHTML = '';
    const part = (b, rest) => { const s = el('span', ''); s.appendChild(el('b', '', b)); s.appendChild(document.createTextNode(` ${rest}`)); line.appendChild(s); };
    part(String(Number(p.kept) || 0), 'kept');
    part(String(droppedTotal), 'dropped');
    part(`${done} of ${t}`, 'concepts');
    // 30-ai reports phases 'map', 'generate', 'check:<key>', 'done',
    // 'stopped', 'failed'; dropped.numeric is null when Python is missing.
    const order = ST_CHECK_ROWS.map((d) => d.key);
    const idx = order.indexOf(String(p.phase || '').replace(/^check:/, ''));
    order.forEach((key, i) => {
      const r = rows.get(key);
      const unavailable = key === 'numeric' && dropped.numeric === null;
      const count = Number(dropped[key]) || 0;
      r.n.textContent = !r.on ? 'off' : unavailable ? 'needs Python' : `${count} dropped`;
      let cls = 'st-ck__d';
      if (!r.on || unavailable) cls += ' st-ck__d--idle';
      else if (idx >= 0 ? i === idx : false) cls += ' st-ck__d--run';
      else if (idx >= 0 ? i > idx : count === 0 && !run.done) cls += ' st-ck__d--idle';
      r.dot.className = cls;
    });
    const kept = Number(p.kept) || 0;
    startBtn.disabled = run.done || run.token.cancelled || kept < size;
    stopBtn.disabled = run.done || run.token.cancelled;
  };

  let restarting = false; // Start With N Ready: the cancelled run hands over to a fresh draw
  const settle = async () => {
    if (ctx.disposed()) return;
    const after = (await stListSessionItems(session.id)) || [];
    if (ctx.disposed()) return;
    if (after.some((i) => i.status === 'pending')) {
      _emitDataChanged();
      ctx.setRoute({ view: 'session', sessionId: session.id });
      return;
    }
    if (restarting) return;
    if (run.error) throw run.error;
    host.innerHTML = '';
    const stopped = !!run.token.cancelled;
    _api.ui.createEmptyState(host, {
      icon: 'px-study',
      headline: stopped ? 'Stopped before any question was ready.' : 'No questions could be made.',
      hint: stopped ? 'What was kept stays in the bank. Open the sheet to try again.' : 'Nothing passed the checks. Try another model on the sheet, or a smaller scope.',
      action: { label: 'Open Setup…', onClick: () => void stOpenSetup({ materialIds, sectionId: scope.sectionIds && scope.sectionIds[0] }) },
    });
  };

  const onDone = () => { void settle().catch((err) => { if (ctx.disposed()) return; host.innerHTML = ''; const box = el('div', 'st-error'); box.appendChild(el('div', 'st-error__t', 'Could not make questions.')); box.appendChild(el('div', '', String(err && err.message ? err.message : err))); host.appendChild(box); }); };
  const listener = () => { paint(); if (run.done) onDone(); };
  run.listeners.add(listener);
  const offRun = bus.on('run', (d) => {
    if (!d || typeof d !== 'object') return;
    if (d.sessionId != null && d.sessionId !== session.id) return;
    if (d.materialId != null && !materialIds.includes(d.materialId)) return;
    run.onProgress(d);
  });
  ctx.add({ dispose: () => { run.listeners.delete(listener); stOff(offRun); } });

  async function stop() {
    run.token.cancelled = true;
    paint();
  }
  async function startEarly() {
    restarting = true;
    run.token.cancelled = true;
    stSetLabel(startBtn, 'Starting');
    startBtn.disabled = true;
    stopBtn.disabled = true;
    await run.promise;
    if (ctx.disposed()) return;
    const after = (await stListSessionItems(session.id)) || [];
    if (after.some((i) => i.status === 'pending')) { restarting = false; onDone(); return; }
    // The bank now holds enough; a fresh draw needs no generation.
    const again = stRunFor(session);
    const finish = () => { if (!again.done) return; restarting = false; run.error = again.error; onDone(); };
    again.listeners.add(finish);
    finish();
  }

  paint();
  if (run.done) onDone();
}

// ── Session screen ──────────────────────────────────────────────────────────

async function renderSession(host, route, ctx) {
  const session = await stGetSession(route.sessionId);
  if (!session) throw new Error('This session no longer exists.');
  if (stProp(session, 'finishedAt', 0)) { ctx.setRoute({ view: 'results', sessionId: session.id }); return; }
  const scope = stSessionScope(session);
  const allItems = (await stListSessionItems(session.id)) || [];
  if (!allItems.length) { ctx.setRoute({ view: 'generating', sessionId: session.id }); return; }
  const draw = allItems.reduce((m, i) => Math.max(m, Number(i.draw) || 0), 0);
  const drawItems = allItems.filter((i) => (Number(i.draw) || 0) === draw).sort((a, b) => (a.ord || 0) - (b.ord || 0));
  const queue = drawItems.filter((i) => i.status === 'pending' || !i.status);
  if (!queue.length) { ctx.setRoute({ view: 'results', sessionId: session.id }); return; }
  const materialIds = Array.isArray(scope.materialIds) ? scope.materialIds : [];
  const questions = await stQuestionMap(scope, drawItems.map((i) => i.questionId));
  const conceptList = (await stListConcepts({ materialIds })) || [];
  const concepts = new Map(conceptList.map((c) => [c.id, c]));
  const materials = new Map();
  for (const id of materialIds) { const m = await stGetMaterial(id); if (m) materials.set(id, m); }
  const multi = materialIds.length > 1;
  const answerFormat = stProp(session, 'answerFormat', 'mixed');
  let modelId = stProp(session, 'model', '');
  if (!modelId) { try { modelId = (await stPickModel(materials.get(materialIds[0]) || null)) || ''; } catch { modelId = ''; } }
  const numCtx = Number(stProp(session, 'numCtx', 0)) || 0;
  const isTest = session.mode === 'test';

  const sess = el('div', 'st-sess');
  host.appendChild(sess);
  const { strand } = stToolbar(sess, {
    name: session.name,
    meta: `${ST_MODE_LABELS[session.mode] || session.mode} · ${ST_ANSWER_LABELS[answerFormat] || answerFormat}`,
    strand: true, closeTitle: 'End Session', onClose: () => endSession(),
  });
  const main = el('div', 'st-sess-main');
  sess.appendChild(main);
  const qwrap = el('div', 'st-qwrap');
  main.appendChild(qwrap);
  const ctl = el('div', 'st-ctl');
  main.appendChild(ctl);

  // ── Timing: seconds while the pane is visible, stored every 30 s and on close ──
  let seconds = Number(stProp(session, 'seconds', 0)) || 0;
  const tick = setInterval(() => {
    if (ctx.disposed() || !host.isConnected) return;
    if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return;
    seconds++;
    if (seconds % 30 === 0) void stUpdateSession(session.id, { seconds });
  }, 1000);
  ctx.add({ dispose: () => { clearInterval(tick); void stUpdateSession(session.id, { seconds }); } });

  // ── Strand ──
  const segs = new Map();
  function paintStrand(currentId) {
    strand.innerHTML = '';
    segs.clear();
    for (const it of drawItems) {
      const i = el('i', '');
      if (it.status === 'right') i.className = 'ok';
      else if (it.status === 'wrong') i.className = 'no';
      else if (it.id === currentId) i.className = 'cur';
      strand.appendChild(i);
      segs.set(it.id, i);
    }
    const answered = drawItems.filter((i) => i.status === 'right' || i.status === 'wrong').length;
    strand.setAttribute('aria-label', `${answered} of ${drawItems.length} answered`);
  }
  function pulseSeg(itemId, cls) {
    const i = segs.get(itemId);
    if (!i) return;
    i.className = `${cls} just`;
    setTimeout(() => { if (!ctx.disposed()) i.classList.remove('just'); }, 220);
  }

  let index = 0;
  let current = null;

  function renderItem() {
    if (ctx.disposed()) return;
    while (index < queue.length && !questions.get(queue[index].questionId)) index++;
    if (index >= queue.length) { void finishDraw(); return; }
    const item = queue[index];
    const q = questions.get(item.questionId);
    const concept = concepts.get(q.conceptId) || null;
    let fmt = item.formatUsed || '';
    if (!fmt) { try { fmt = stResolveFormat(concept, q, answerFormat); } catch { fmt = ''; } }
    if (!fmt) fmt = q.format || 'mc';
    if (fmt === 'mc' && !(Array.isArray(q.options) && q.options.length)) fmt = 'short';
    const cur = { item, q, concept, fmt, answered: false, retried: false, retryBtn: null, chosen: null, sourceOpen: false, explaining: false, busy: false, ungraded: false, typedField: null };
    current = cur;
    paintStrand(item.id);
    qwrap.innerHTML = '';
    ctl.innerHTML = '';

    // Eyebrow: the concept; a bank question's origin and what it is graded
    // against; for a session over several materials, the material first.
    const eyebrow = el('div', 'st-eyebrow');
    if (multi) {
      const mat = materials.get(q.materialId);
      if (mat) { eyebrow.appendChild(el('span', 'st-eyebrow__src', stTruncate(mat.label, 28))); eyebrow.appendChild(el('span', 'st-eyebrow__dot')); }
    }
    const bank = q.origin && q.origin !== 'generated';
    if (bank && q.originLabel) {
      eyebrow.appendChild(el('span', 'st-eyebrow__cpt', q.originLabel));
      const origin = stRubricOriginText(q);
      if (origin) { eyebrow.appendChild(el('span', 'st-eyebrow__dot')); eyebrow.appendChild(el('span', 'st-eyebrow__src', origin)); }
    } else {
      eyebrow.appendChild(el('span', 'st-eyebrow__cpt', concept ? concept.title : (q.originLabel || 'Question')));
    }
    const eyeActs = el('span', 'st-eyebrow__acts');
    _api.ui.createIconButton(eyeActs, { icon: 'thumbs-down', title: 'Hide This Question', size: 'sm', onClick: () => void hideQuestion() });
    eyebrow.appendChild(eyeActs);
    qwrap.appendChild(eyebrow);

    const card = el('div', 'st-card');
    card.dataset.format = fmt;
    const stem = el('div', 'st-card__q');
    stem.appendChild(stMd(q.stem));
    card.appendChild(stem);
    if (fmt === 'mc') buildOptions(card, cur); else buildTyped(card, cur);
    qwrap.appendChild(card);
    cur.card = card;

    const fb = el('div', 'st-fb');
    qwrap.appendChild(fb);
    cur.fb = fb;

    ctl.appendChild(el('span', 'st-sp'));
    cur.skipBtn = _api.ui.createButton(ctl, {
      label: 'Skip', kind: 'ghost', title: 'Skip (K) · Moves this question to the end of the session',
      disabled: queue.length - index <= 1,
      onClick: () => void skip(),
    });
    cur.skipBtn.appendChild(el('span', 'st-k', 'K'));
    cur.nextBtn = _api.ui.createButton(ctl, {
      label: fmt === 'mc' ? 'Next' : 'Check', kind: 'primary', disabled: fmt === 'mc',
      title: fmt === 'mc' ? 'Next (Enter)' : 'Check (Enter)',
      onClick: () => { if (cur.fmt !== 'mc' && !cur.answered) void check(); else void next(); },
    });
    cur.nextBtn.appendChild(el('span', 'st-k', '↵'));

    queueMicrotask(() => { if (current !== cur || ctx.disposed()) return; if (cur.typedField) cur.typedField.focus(); else ctx.root.focus(); });
  }

  function buildOptions(card, cur) {
    const opts = el('div', 'st-opts');
    opts.setAttribute('role', 'group');
    cur.opts = opts;
    const right = Number(cur.q.answer);
    (cur.q.options || []).forEach((text, i) => {
      const row = el('div', 'st-opt');
      row.dataset.i = String(i);
      row.setAttribute('role', 'button');
      row.appendChild(el('span', 'st-opt__key', String(i + 1)));
      const t = el('span', 'st-opt__text');
      t.appendChild(stMd(text));
      row.appendChild(t);
      const mark = el('span', 'st-opt__mark');
      mark.innerHTML = icon(i === right ? 'check' : 'x', 16);
      row.appendChild(mark);
      row.addEventListener('click', () => void choose(i));
      opts.appendChild(row);
    });
    card.appendChild(opts);
  }

  function typedHint(q, fmt) {
    if (fmt === 'numeric') return 'A number, within the tolerance the question sets.';
    if (fmt === 'formula') return 'Compared after normalising; the model reads it when it differs.';
    if (fmt === 'cloze') return 'The term the blank stands for.';
    const n = Array.isArray(q.rubric) ? q.rubric.length : 0;
    if (q.rubricOrigin === 'report') return "Graded against the examiner's report for this question.";
    if (n) return `Graded against ${n} ${n === 1 ? 'point' : 'points'} from the ${q.rubricOrigin === 'answer' ? 'answer' : 'source'}.`;
    return 'Graded against the model answer.';
  }

  function buildTyped(card, cur) {
    const q = cur.q, fmt = cur.fmt;
    const ta = el('div', 'st-ta');
    let field;
    if (fmt === 'numeric') {
      const row = el('div', 'st-ta__row');
      field = el('input', 'st-ta__num');
      field.type = 'text';
      field.inputMode = 'decimal';
      field.placeholder = 'Number';
      row.appendChild(field);
      const units = q.numeric && q.numeric.units;
      if (units) row.appendChild(el('span', 'st-ta__units', String(units)));
      ta.appendChild(row);
    } else if (fmt === 'formula') {
      field = el('input', 'st-ta__line');
      field.type = 'text';
      field.placeholder = 'LaTeX or plain text';
      ta.appendChild(field);
    } else if (fmt === 'cloze') {
      field = el('input', 'st-ta__line');
      field.type = 'text';
      field.placeholder = 'The missing term';
      ta.appendChild(field);
    } else {
      field = el('textarea', `st-ta__field${fmt === 'essay' ? ' st-ta__field--essay' : ''}`);
      field.placeholder = 'Write it out before it shows.';
      ta.appendChild(field);
    }
    field.setAttribute('aria-label', 'Your answer');
    const hint = el('div', 'st-ta__hint');
    hint.appendChild(el('span', '', typedHint(q, fmt)));
    hint.appendChild(el('span', '', fmt === 'short' || fmt === 'essay' ? 'Enter to check · Shift+Enter for a new line' : 'Enter to check'));
    ta.appendChild(hint);
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!cur.answered) void check(); else void next();
      }
    });
    card.appendChild(ta);
    cur.typedField = field;
  }

  function showFeedback(fb) {
    // Force a style pass before the class lands, so the rise transition plays
    // on a strip that was just filled (the mockup's requestAnimationFrame).
    void fb.offsetWidth;
    fb.classList.add('st-fb--show');
  }

  function feedbackActs(cur, { retry: withRetry }) {
    const acts = el('div', 'st-fb__acts');
    if (withRetry) {
      cur.retryBtn = _api.ui.createButton(acts, { label: 'Retry', kind: 'ghost', title: 'Retry (R) · once; a right answer now still counts as a miss', onClick: () => retry() });
    }
    _api.ui.createButton(acts, { label: stSourceLabel(cur.q), kind: 'ghost', title: 'Show Source (S) · opens the page beside the session', onClick: () => void showSource() });
    _api.ui.createButton(acts, { label: 'Explain', kind: 'ghost', title: 'Explain (E) · a short explanation grounded in the anchor', onClick: () => void explain() });
    return acts;
  }

  function renderChoiceFeedback(cur, ok, retried) {
    const fb = cur.fb;
    fb.innerHTML = '';
    fb.className = `st-fb ${ok ? 'st-fb--ok' : 'st-fb--no'}`;
    const verdict = el('div', 'st-fb__verdict');
    verdict.appendChild(el('span', 'st-fb__dot'));
    verdict.appendChild(el('span', 'st-fb__text', ok ? 'Correct' : 'Not quite'));
    if (retried) {
      const g = el('span', 'st-fb__grade');
      g.appendChild(document.createTextNode('· counts as '));
      g.appendChild(el('b', '', stRatingWord(AGAIN)));
      verdict.appendChild(g);
    }
    fb.appendChild(verdict);
    fb.appendChild(feedbackActs(cur, { retry: !ok && !retried && !isTest }));
    if (!ok && cur.q.explanation) {
      const why = el('div', 'st-fb__why');
      why.appendChild(stMd(cur.q.explanation));
      fb.appendChild(why);
    }
    fb.appendChild(stQuoteEl(cur.q, cur.q.sourceQuote, cur.q.sourcePage, () => void showSource()));
    showFeedback(fb);
  }

  function renderTypedFeedback(cur, result) {
    const q = cur.q;
    const rubric = Array.isArray(result.rubric) ? result.rubric : (Array.isArray(q.rubric) ? q.rubric : []);
    const ok = result.rating >= GOOD;
    const fb = cur.fb;
    fb.innerHTML = '';
    fb.className = `st-fb ${ok ? 'st-fb--ok' : 'st-fb--no'}`;
    const verdict = el('div', 'st-fb__verdict');
    verdict.appendChild(el('span', 'st-fb__dot'));
    verdict.appendChild(el('span', 'st-fb__text', result.label));
    const g = el('span', 'st-fb__grade');
    g.appendChild(document.createTextNode('· counts as '));
    g.appendChild(el('b', '', stRatingWord(result.rating)));
    verdict.appendChild(g);
    fb.appendChild(verdict);
    fb.appendChild(feedbackActs(cur, { retry: false }));
    const points = result.verdict && Array.isArray(result.verdict.points) ? result.verdict.points : [];
    if (result.verdict && rubric.length) {
      const rub = el('div', 'st-rub');
      rubric.forEach((p, i) => {
        const status = (points[i] && points[i].status) || 'miss';
        const pt = el('div', `st-rub__pt st-rub__pt--${status}`);
        pt.style.setProperty('--st-i', String(i));
        const glyph = el('span', 'st-rub__g');
        glyph.innerHTML = icon(status === 'hit' ? 'check' : status === 'partial' ? 'minus' : 'x', 12);
        pt.appendChild(glyph);
        const body = el('span', 'st-rub__text');
        body.appendChild(stMd(p.text));
        if (p.required) body.appendChild(el('span', 'st-rub__req', 'required'));
        pt.appendChild(body);
        rub.appendChild(pt);
      });
      fb.appendChild(rub);
    }
    if (result.verdict && result.verdict.note) {
      const why = el('div', 'st-fb__why');
      why.appendChild(stMd(result.verdict.note));
      fb.appendChild(why);
    }
    // The anchor is the line for the missed point when the rubric carries
    // quotes; else the question's own quote.
    let quote = q.sourceQuote, page = q.sourcePage;
    const missIdx = rubric.findIndex((p, i) => p && p.quote && ((points[i] && points[i].status) || 'miss') !== 'hit');
    if (missIdx >= 0) { quote = rubric[missIdx].quote; page = rubric[missIdx].page || page; }
    fb.appendChild(stQuoteEl(q, quote, page, () => void showSource()));
    if (q.answer !== undefined && q.answer !== null && String(q.answer) !== '') {
      const d = el('details', 'st-full');
      const s = el('summary', '');
      s.innerHTML = icon('chevron-right', 12);
      s.appendChild(document.createTextNode('Full answer'));
      d.appendChild(s);
      const t = el('div', 'st-full__text');
      t.appendChild(stMd(String(q.answer)));
      d.appendChild(t);
      fb.appendChild(d);
    }
    showFeedback(fb);
  }

  function renderGradeError(cur, err) {
    const fb = cur.fb;
    fb.innerHTML = '';
    fb.className = 'st-fb';
    const verdict = el('div', 'st-fb__verdict');
    verdict.appendChild(el('span', 'st-fb__dot'));
    verdict.appendChild(el('span', 'st-fb__text', 'Could not grade this answer'));
    fb.appendChild(verdict);
    fb.appendChild(feedbackActs(cur, { retry: false }));
    fb.appendChild(el('div', 'st-fb__why', `${err && err.message ? err.message : err}. The answer is not counted; Next moves on.`));
    const t = el('div', 'st-full__text');
    t.appendChild(stMd(String(cur.q.answer || '')));
    fb.appendChild(t);
    fb.appendChild(stQuoteEl(cur.q, cur.q.sourceQuote, cur.q.sourcePage, () => void showSource()));
    showFeedback(fb);
  }

  // ── Persistence: every answer lands before the UI moves on ──
  async function commitAnswer(cur, { status, chosen, typed, verdict, correct, rating, retried }) {
    const now = stNow();
    const q = cur.q, fmt = cur.fmt;
    await stAnswerItem(cur.item.id, { status, chosen, typed, verdict, retried, formatUsed: fmt }, now);
    await stLogAnswer({ questionId: q.id, conceptId: q.conceptId, sessionId: session.id, formatUsed: fmt, correct: correct ? 1 : 0, rating, retried }, now);
    if (cur.concept) {
      const nextConcept = stApplyAnswer(cur.concept, { correct, rating, formatUsed: fmt, retried }, now);
      await stUpdateConcept(nextConcept);
      concepts.set(nextConcept.id, nextConcept);
      cur.concept = nextConcept;
    }
    Object.assign(cur.item, { status, chosen, typed, verdict, retried, formatUsed: fmt, answeredAt: now });
    await stUpdateSession(session.id, { position: Math.max(0, drawItems.indexOf(cur.item)), seconds });
    bus.emit('session', { sessionId: session.id, itemId: cur.item.id, status });
  }

  async function commitRetry(cur, { chosen, correct }) {
    const now = stNow();
    await stAnswerItem(cur.item.id, { status: 'wrong', chosen, typed: '', verdict: null, retried: 1, formatUsed: cur.fmt }, now);
    await stLogAnswer({ questionId: cur.q.id, conceptId: cur.q.conceptId, sessionId: session.id, formatUsed: cur.fmt, correct: correct ? 1 : 0, rating: AGAIN, retried: 1 }, now);
    Object.assign(cur.item, { chosen, retried: 1, answeredAt: now });
    bus.emit('session', { sessionId: session.id, itemId: cur.item.id, status: 'wrong' });
  }

  // ── Choose ──
  async function choose(i) {
    const cur = current;
    if (!cur || cur.fmt !== 'mc' || cur.answered || cur.busy) return;
    const rows = Array.from(cur.opts.querySelectorAll('.st-opt'));
    if (!rows[i]) return;
    if (cur.retried && rows[i].classList.contains('st-opt--wrong')) return;
    const right = Number(cur.q.answer);
    const ok = i === right;
    const retriedNow = cur.retried;
    cur.answered = true;
    cur.chosen = i;
    cur.opts.classList.add('st-opts--done');
    if (rows[right]) rows[right].classList.add('st-opt--right');
    if (!ok) rows[i].classList.add('st-opt--wrong');
    const status = ok && !retriedNow ? 'right' : 'wrong';
    pulseSeg(cur.item.id, status === 'right' ? 'ok' : 'no');
    renderChoiceFeedback(cur, ok, retriedNow);
    cur.busy = true;
    try {
      if (!retriedNow) await commitAnswer(cur, { status, chosen: String(i), typed: '', verdict: null, correct: ok, rating: ok ? GOOD : AGAIN, retried: 0 });
      else await commitRetry(cur, { chosen: String(i), correct: ok });
    } finally { cur.busy = false; }
    if (current !== cur || ctx.disposed()) return;
    cur.nextBtn.disabled = false;
    cur.skipBtn.disabled = true;
    ctx.root.focus();
  }

  function retry() {
    const cur = current;
    if (!cur || cur.fmt !== 'mc' || !cur.answered || cur.retried || cur.busy || !cur.retryBtn || isTest) return;
    cur.retried = true;
    cur.answered = false;
    cur.retryBtn = null;
    cur.opts.classList.remove('st-opts--done');
    for (const row of cur.opts.querySelectorAll('.st-opt')) if (!row.classList.contains('st-opt--wrong')) row.classList.remove('st-opt--right');
    cur.fb.classList.remove('st-fb--show');
    cur.nextBtn.disabled = true;
    const seg = segs.get(cur.item.id);
    if (seg) seg.className = 'no';
    ctx.root.focus();
  }

  // ── Typed ──
  async function gradeTyped(q, text) {
    // stGradeTyped grades numeric, cloze and formula answers mechanically and
    // the rest against the rubric; it returns the rubric it marked against,
    // which is the one the points are drawn from.
    const g = await stGradeTyped(q, text, { modelId, numCtx });
    const rubric = Array.isArray(g && g.rubric) && g.rubric.length ? g.rubric : (Array.isArray(q.rubric) ? q.rubric : []);
    const rating = g && g.rating != null ? Number(g.rating) : AGAIN;
    const verdict = g && g.verdict ? g.verdict : null;
    const label = (g && g.label) || (verdict ? stVerdictLabel(verdict, rubric) : (rating >= GOOD ? 'Correct' : 'Not quite'));
    return { rating, verdict, label, rubric };
  }

  async function check() {
    const cur = current;
    if (!cur || cur.fmt === 'mc' || cur.answered || cur.busy || !cur.typedField) return;
    const text = String(cur.typedField.value || '').trim();
    if (!text) { cur.typedField.focus(); return; }
    cur.busy = true;
    cur.typedField.disabled = true;
    cur.nextBtn.disabled = true;
    stSetLabel(cur.nextBtn, 'Checking');
    let result;
    try { result = await gradeTyped(cur.q, text); }
    catch (err) { result = { error: err || new Error('Grading failed') }; }
    if (current !== cur || ctx.disposed()) return;
    cur.answered = true;
    cur.typed = text;
    if (result.error) {
      cur.busy = false;
      cur.ungraded = true;
      renderGradeError(cur, result.error);
      stSetLabel(cur.nextBtn, 'Next');
      cur.nextBtn.disabled = false;
      cur.skipBtn.disabled = true;
      return;
    }
    const ok = result.rating >= GOOD;
    pulseSeg(cur.item.id, ok ? 'ok' : 'no');
    renderTypedFeedback(cur, result);
    try {
      await commitAnswer(cur, { status: ok ? 'right' : 'wrong', chosen: '', typed: text, verdict: result.verdict, correct: ok, rating: result.rating, retried: 0 });
    } finally { cur.busy = false; }
    if (current !== cur || ctx.disposed()) return;
    stSetLabel(cur.nextBtn, 'Next');
    cur.nextBtn.disabled = false;
    cur.skipBtn.disabled = true;
    ctx.root.focus();
  }

  // ── Source, Explain, Hide, Skip, Next ──
  async function showSource() {
    const cur = current;
    if (!cur) return;
    try { await stShowSource(cur.q); cur.sourceOpen = true; }
    catch (err) { try { await _api.window.showWarningMessage(`Could not open the source: ${err && err.message ? err.message : err}`); } catch { /* noop */ } }
  }

  async function explain() {
    const cur = current;
    if (!cur || !cur.answered || cur.explaining) return;
    cur.explaining = true;
    let block = cur.fb.querySelector('.st-explain');
    if (!block) {
      block = el('div', 'st-explain');
      const quote = cur.fb.querySelector('.st-quote');
      if (quote && quote.nextSibling) cur.fb.insertBefore(block, quote.nextSibling); else cur.fb.appendChild(block);
    }
    block.classList.add('st-explain--busy');
    block.textContent = 'Explaining';
    let text = '';
    try {
      const full = await stExplain(cur.q, {
        chosen: cur.chosen != null ? String(cur.chosen) : '',
        typed: cur.typed || '',
        modelId, numCtx,
        onChunk: (chunk) => { text += String(chunk || ''); block.textContent = text; },
      });
      if (current !== cur) return;
      block.classList.remove('st-explain--busy');
      block.innerHTML = '';
      block.appendChild(stMd(String(full || text || 'Nothing to add: the anchor says it.')));
    } catch (err) {
      block.classList.remove('st-explain--busy');
      block.textContent = `Could not explain: ${err && err.message ? err.message : err}`;
    } finally { cur.explaining = false; }
  }

  async function hideQuestion() {
    const cur = current;
    if (!cur || cur.busy) return;
    const reasons = ['Wrong answer', 'Not in the text', 'Ambiguous', 'Other'].map((label) => ({ label }));
    const pick = await _api.window.showQuickPick(reasons, { placeholder: 'Why hide this question?' });
    if (!pick || current !== cur || ctx.disposed()) return;
    const reason = Array.isArray(pick) ? (pick[0] && pick[0].label) : pick.label;
    await stHideQuestion(cur.q.id, reason || 'Other');
    _emitDataChanged();
    if (cur.answered) { await next(); return; }
    cur.busy = true;
    await stAnswerItem(cur.item.id, { status: 'skipped', chosen: '', typed: '', verdict: null, retried: 0, formatUsed: cur.fmt }, stNow());
    cur.item.status = 'skipped';
    queue.splice(index, 1);
    await leave(cur);
    cur.busy = false;
    renderItem();
  }

  async function skip() {
    const cur = current;
    if (!cur || cur.answered || cur.busy) return;
    if (queue.length - index <= 1) return;
    cur.busy = true;
    queue.splice(index, 1);
    queue.push(cur.item);
    await leave(cur);
    cur.busy = false;
    renderItem();
  }

  function leave(cur) {
    cur.fb.classList.remove('st-fb--show');
    cur.card.classList.add('st-card--leaving');
    return stAfterAnimation(cur.card, 220);
  }

  async function next() {
    const cur = current;
    if (!cur || cur.busy) return;
    if (!cur.answered) { if (cur.fmt !== 'mc') void check(); return; }
    cur.busy = true;
    if (cur.ungraded) {
      await stAnswerItem(cur.item.id, { status: 'skipped', chosen: '', typed: cur.typed || '', verdict: null, retried: 0, formatUsed: cur.fmt }, stNow());
      cur.item.status = 'skipped';
    }
    await leave(cur);
    if (ctx.disposed()) return;
    index++;
    renderItem();
  }

  async function finishDraw() {
    current = null;
    await stUpdateSession(session.id, { position: drawItems.length, finishedAt: stNow(), seconds });
    _emitDataChanged();
    ctx.setRoute({ view: 'results', sessionId: session.id });
  }

  async function endSession() {
    const answered = drawItems.filter((i) => i.status === 'right' || i.status === 'wrong').length;
    const ok = await _api.window.showConfirmModal({
      message: 'End this session?',
      detail: `${answered} of ${drawItems.length} answered. The results stay; Refresh picks the scope up again.`,
      confirmLabel: 'End Session',
    });
    if (!ok || ctx.disposed()) return;
    await stUpdateSession(session.id, { finishedAt: stNow(), seconds });
    _emitDataChanged();
    ctx.setRoute({ view: 'results', sessionId: session.id });
  }

  // ── Keys, scoped to the focusable pane root ──
  const onKey = (e) => {
    const cur = current;
    if (!cur) return;
    const t = e.target;
    const inField = (typeof HTMLInputElement !== 'undefined' && t instanceof HTMLInputElement) || (typeof HTMLTextAreaElement !== 'undefined' && t instanceof HTMLTextAreaElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      if (cur.sourceOpen) { cur.sourceOpen = false; return; }
      void endSession();
      return;
    }
    if (inField) return;
    if ((e.key === 'Enter' || e.key === ' ') && t && typeof t.closest === 'function' && t.closest('button, summary, a')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (cur.fmt === 'mc' && /^[1-5]$/.test(e.key)) { e.preventDefault(); void choose(Number(e.key) - 1); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (cur.fmt !== 'mc' && !cur.answered) void check(); else void next(); return; }
    const k = String(e.key).toLowerCase();
    if (k === 's') { if (cur.answered) { e.preventDefault(); void showSource(); } return; }
    if (k === 'r') { if (cur.retryBtn) { e.preventDefault(); retry(); } return; }
    if (k === 'e') { if (cur.answered) { e.preventDefault(); void explain(); } return; }
    if (k === 'k') { if (!cur.answered) { e.preventDefault(); void skip(); } return; }
  };
  ctx.root.addEventListener('keydown', onKey);
  ctx.add({ dispose: () => ctx.root.removeEventListener('keydown', onKey) });

  renderItem();
}

/** The small line under a missed concept when the verdict carried no note:
 *  what was chosen, or how many points a typed answer missed. */
function stMissedNote(item, q) {
  if (!item || !q) return '';
  const fmt = item.formatUsed || q.format;
  if (fmt === 'mc') {
    const i = Number(item.chosen);
    const text = Array.isArray(q.options) && item.chosen !== '' && q.options[i] !== undefined ? q.options[i] : '';
    const chose = text ? `Chose “${stTruncate(String(text), 60)}”` : 'No option chosen';
    return item.retried ? `${chose} · retried` : chose;
  }
  const v = item.verdict && typeof item.verdict === 'object' ? item.verdict : null;
  const points = v && Array.isArray(v.points) ? v.points : [];
  const missedPts = points.filter((p) => p && p.status !== 'hit').length;
  if (v && v.contradiction) return 'Typed answer contradicted the source';
  if (points.length) return `Typed answer missed ${missedPts} of ${points.length} ${points.length === 1 ? 'point' : 'points'}`;
  return item.typed ? 'Typed answer missed the mark' : 'Nothing written down';
}

// ── Results ─────────────────────────────────────────────────────────────────

async function renderResults(host, route, ctx) {
  const now = stNow();
  const session = await stGetSession(route.sessionId);
  if (!session) throw new Error('This session no longer exists.');
  const scope = stSessionScope(session);
  const materialIds = Array.isArray(scope.materialIds) ? scope.materialIds : [];
  const allItems = (await stListSessionItems(session.id)) || [];
  const draw = allItems.reduce((m, i) => Math.max(m, Number(i.draw) || 0), 0);
  const drawItems = allItems.filter((i) => (Number(i.draw) || 0) === draw).sort((a, b) => (a.ord || 0) - (b.ord || 0));
  const conceptList = (await stListConcepts({ materialIds })) || [];
  const scopeConcepts = stConceptsInScope(conceptList, scope);
  const concepts = new Map(conceptList.map((c) => [c.id, c]));
  const questions = await stQuestionMap(scope, drawItems.map((i) => i.questionId));
  // stSessionSummary reads conceptId off each item; the rows carry only the question id.
  const enriched = drawItems.map((i) => ({ ...i, conceptId: (questions.get(i.questionId) || {}).conceptId || 0 }));
  const summary = stSessionSummary(enriched, conceptList) || { right: 0, wrong: 0, skipped: 0, answered: 0, missed: [] };
  const missed = (Array.isArray(summary.missed) ? summary.missed : []).map((m) => ({ ...m, note: m.note || stMissedNote(enriched.find((i) => i.questionId === m.questionId), questions.get(m.questionId)) }));
  const cov = stCoverageOf(scopeConcepts, now);
  const size = drawItems.length || Number(stProp(session, 'size', 0)) || 0;
  const sessionSize = Number(stProp(session, 'size', 0)) || Number(cfg('sessionSize', 20)) || 20;
  const refreshes = Number(stProp(session, 'refreshes', 0)) || 0;
  const answerFormat = stProp(session, 'answerFormat', 'mixed');
  const flashcards = await stFlashcardsAvailable();

  const sess = el('div', 'st-sess');
  host.appendChild(sess);
  stToolbar(sess, {
    name: session.name,
    meta: `${ST_MODE_LABELS[session.mode] || session.mode} · ${ST_ANSWER_LABELS[answerFormat] || answerFormat}`,
    strand: false, closeTitle: 'Close', onClose: () => ctx.closeTab(),
  });
  const main = el('div', 'st-sess-main');
  sess.appendChild(main);
  const res = el('div', 'st-res');
  main.appendChild(res);

  const top = el('div', 'st-res__top');
  const left = el('div', '');
  const big = el('div', 'st-res__big', String(summary.right || 0));
  big.appendChild(el('small', '', `of ${size}`));
  left.appendChild(big);
  const under = el('div', 'st-res__under');
  under.appendChild(document.createTextNode(`${scope.label || session.name} is `));
  under.appendChild(el('b', '', `${cov.clean} of ${cov.total} concepts clean`));
  under.appendChild(document.createTextNode(` · ${Math.max(0, cov.total - cov.clean)} to go · ${refreshes} ${refreshes === 1 ? 'refresh' : 'refreshes'} so far`));
  left.appendChild(under);
  top.appendChild(left);
  const acts = el('div', 'st-res__acts');
  if (flashcards) {
    const sendBtn = _api.ui.createButton(acts, {
      label: 'Send Missed to Flashcards', icon: 'layers', kind: 'secondary', disabled: missed.length === 0,
      title: missed.length ? 'One card per missed concept, with the anchor as its source' : 'Nothing missed this session',
      onClick: async () => {
        sendBtn.disabled = true;
        try {
          const r = await stSendMissedToFlashcards(session);
          const n = r && typeof r.count === 'number' ? r.count : 0;
          await _api.window.showInformationMessage(`${n} ${n === 1 ? 'card' : 'cards'} sent to Flashcards.`);
        } catch (err) {
          sendBtn.disabled = false;
          try { await _api.window.showErrorMessage(`Could not send: ${err && err.message ? err.message : err}`); } catch { /* noop */ }
        }
      },
    });
    sendBtn.appendChild(el('span', 'st-faint', `· ${missed.length}`));
  }
  _api.ui.createButton(acts, {
    label: 'Refresh', icon: 'refresh-cw', kind: 'primary', title: `Draws the next ${sessionSize} from the same scope, weak concepts first`,
    onClick: async () => {
      await stUpdateSession(session.id, { refreshes: refreshes + 1, finishedAt: 0, position: 0 });
      _emitDataChanged();
      ctx.setRoute({ view: 'generating', sessionId: session.id });
    },
  });
  top.appendChild(acts);
  res.appendChild(top);

  // The coverage bar: one segment per concept in scope.
  const bar = el('div', 'st-cov');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${cov.clean} clean, ${cov.weak} weak, ${cov.unasked} unasked`);
  const states = Array.isArray(cov.states) ? cov.states : [];
  scopeConcepts.forEach((c, i) => {
    const s = typeof states[i] === 'string' ? states[i] : stConceptState(c, now, { staleDays: Number(cfg('staleDays', 14)) || 14 });
    const seg = el('i', stCovClass(s) + (s === 'clean' ? ' just' : ''));
    seg.style.setProperty('--st-i', String(i));
    seg.title = c.title;
    bar.appendChild(seg);
  });
  res.appendChild(bar);
  const covl = el('div', 'st-covl');
  const legend = (n, word) => { const s = el('span', ''); s.appendChild(el('b', '', String(n))); s.appendChild(document.createTextNode(` ${word}`)); covl.appendChild(s); };
  legend(cov.clean, 'clean');
  legend(cov.weak, 'weak');
  legend(cov.unasked, 'unasked');
  if (cov.stale) legend(cov.stale, 'stale');
  res.appendChild(covl);

  // Missed this session.
  const missedBox = el('div', 'st-missed');
  _api.ui.createSectionLabel(missedBox, 'Missed this session');
  if (!missed.length) {
    missedBox.appendChild(el('div', 'st-muted', 'Nothing missed.'));
  }
  for (const m of missed) {
    const c = concepts.get(m.conceptId);
    const q = questions.get(m.questionId);
    const row = el('div', 'st-mrow');
    const cell = el('div', 'st-mrow__c', c ? c.title : (q ? stTruncate(q.stem, 60) : 'Concept'));
    if (m.note) cell.appendChild(el('small', '', m.note));
    row.appendChild(cell);
    const page = q ? q.sourcePage : (c ? c.page : 0);
    const pg = el('button', 'st-mrow__pg');
    pg.type = 'button';
    pg.textContent = q ? stPageLabel(q, page) : (page ? `p. ${page}` : 'Source');
    pg.title = 'Open the page beside this';
    pg.addEventListener('click', () => {
      if (q) void stShowSource(q);
      else if (c) void stShowSource({ id: 0, materialId: c.materialId, conceptId: c.id, format: 'short', stem: c.title, sourcePage: c.page, sourceQuote: c.anchorQuote, sourceUri: '', origin: 'generated' });
    });
    row.appendChild(pg);
    const stEl = el('span', `st-mrow__st${m.secondMiss ? ' st-mrow__st--w' : ''}`);
    stEl.appendChild(el('i', ''));
    stEl.appendChild(document.createTextNode(m.secondMiss ? 'second miss' : 'weak'));
    row.appendChild(stEl);
    missedBox.appendChild(row);
  }
  res.appendChild(missedBox);

  const ft = el('div', 'st-res__ft');
  ft.appendChild(el('span', 'st-res__lhs', `Refresh draws the next ${sessionSize}, weak concepts first.`));
  _api.ui.createButton(ft, { label: 'Review Answers', kind: 'ghost', onClick: () => ctx.setRoute({ view: 'review', sessionId: session.id }) });
  res.appendChild(ft);
}

// ── Review ──────────────────────────────────────────────────────────────────

async function renderReview(host, route, ctx) {
  const session = await stGetSession(route.sessionId);
  if (!session) throw new Error('This session no longer exists.');
  const scope = stSessionScope(session);
  const materialIds = Array.isArray(scope.materialIds) ? scope.materialIds : [];
  const items = ((await stListSessionItems(session.id)) || []).slice().sort((a, b) => ((a.draw || 0) - (b.draw || 0)) || ((a.ord || 0) - (b.ord || 0)));
  const questions = await stQuestionMap(scope, items.map((i) => i.questionId));
  const concepts = new Map(((await stListConcepts({ materialIds })) || []).map((c) => [c.id, c]));

  const sess = el('div', 'st-sess');
  host.appendChild(sess);
  stToolbar(sess, { name: session.name, meta: 'Review', strand: false, closeTitle: 'Back to Results', onClose: () => ctx.setRoute({ view: 'results', sessionId: session.id }) });
  const main = el('div', 'st-sess-main');
  sess.appendChild(main);
  const list = el('div', 'st-review');
  main.appendChild(list);

  let n = 0;
  for (const item of items) {
    const q = questions.get(item.questionId);
    if (!q) continue;
    n++;
    const c = concepts.get(q.conceptId);
    const box = el('div', 'st-review__item');
    box.dataset.status = item.status || 'pending';
    const eyebrow = el('div', 'st-eyebrow');
    eyebrow.appendChild(el('span', 'st-eyebrow__src', `${n}.`));
    eyebrow.appendChild(el('span', 'st-eyebrow__cpt', c ? c.title : (q.originLabel || 'Question')));
    if (item.draw) { eyebrow.appendChild(el('span', 'st-eyebrow__dot')); eyebrow.appendChild(el('span', 'st-eyebrow__src', `draw ${Number(item.draw) + 1}`)); }
    box.appendChild(eyebrow);
    const stem = el('div', 'st-review__stem');
    stem.appendChild(stMd(q.stem));
    box.appendChild(stem);
    const fmt = item.formatUsed || q.format;
    const options = Array.isArray(q.options) ? q.options : [];
    let yours = '';
    if (fmt === 'mc') { const i = Number(item.chosen); yours = item.chosen !== '' && item.chosen != null && options[i] !== undefined ? options[i] : ''; }
    else yours = item.typed || '';
    const yoursEl = el('div', `st-review__ans st-review__ans--${item.status === 'right' ? 'ok' : item.status === 'wrong' ? 'no' : 'skip'}`);
    yoursEl.appendChild(el('span', 'st-review__lab', 'Your answer'));
    if (yours) yoursEl.appendChild(stMd(yours)); else yoursEl.appendChild(document.createTextNode(item.status === 'skipped' ? 'skipped' : 'no answer'));
    if (item.retried) yoursEl.appendChild(el('span', 'st-review__lab', ' · retried'));
    box.appendChild(yoursEl);
    const rightEl = el('div', 'st-review__ans');
    rightEl.appendChild(el('span', 'st-review__lab', 'Right answer'));
    const rightText = fmt === 'mc' || q.format === 'mc' ? (options[Number(q.answer)] !== undefined ? options[Number(q.answer)] : String(q.answer)) : String(q.answer || '');
    rightEl.appendChild(stMd(rightText));
    box.appendChild(rightEl);
    box.appendChild(stQuoteEl(q, q.sourceQuote, q.sourcePage, () => void stShowSource(q)));
    list.appendChild(box);
  }
  if (!n) list.appendChild(el('div', 'st-muted', 'No answers yet.'));
}

// ── Learn ───────────────────────────────────────────────────────────────────

async function renderLearn(host, route, ctx) {
  const material = await stGetMaterial(route.materialId);
  if (!material) throw new Error('This material no longer exists.');
  const sections = material.kind === 'pdf' ? ((await stListSections(material.id)) || []) : [];
  const section = route.sectionId ? sections.find((s) => s.id === route.sectionId) || null : null;
  const concepts = ((await stListConcepts({ materialIds: [material.id], sectionIds: section ? [section.id] : undefined })) || [])
    .filter((c) => !section || c.sectionId === section.id)
    .sort((a, b) => (a.ord || 0) - (b.ord || 0) || (a.page || 0) - (b.page || 0));

  const main = el('div', 'st-sess-main');
  host.appendChild(main);
  const learn = el('div', 'st-learn');
  main.appendChild(learn);

  const eyebrow = el('div', 'st-eyebrow');
  eyebrow.appendChild(el('span', 'st-eyebrow__cpt', section ? `${stTruncate(material.label, 32)} · chapter ${(sections.indexOf(section) + 1) || ''}`.trim() : stTruncate(material.label, 48)));
  eyebrow.appendChild(el('span', 'st-eyebrow__dot'));
  const from = section ? stProp(section, 'pageFrom', 0) : 1, to = section ? stProp(section, 'pageTo', 0) : stProp(material, 'pageCount', 0);
  eyebrow.appendChild(el('span', 'st-eyebrow__src', `${from && to ? `pp. ${from}–${to} · ` : ''}${concepts.length} ${concepts.length === 1 ? 'concept' : 'concepts'}`));
  learn.appendChild(eyebrow);
  learn.appendChild(el('h3', 'st-learn__h', section ? section.title : material.label));
  learn.appendChild(el('div', 'st-learn__sub', 'Each line is one concept, as the text states it. A page opens the PDF beside this.'));

  if (!concepts.length) {
    _api.ui.createEmptyState(learn, {
      icon: 'px-study',
      headline: 'No concepts mapped yet.',
      hint: 'Practice This Chapter builds the concept map first.',
    });
  }
  for (const c of concepts) {
    const pt = el('div', 'st-learn__pt');
    const text = el('span', '');
    text.appendChild(el('b', '', c.title));
    if (c.summary) { text.appendChild(document.createTextNode(' ')); text.appendChild(stMd(c.summary)); }
    pt.appendChild(text);
    const pg = el('button', 'st-learn__pg');
    pg.type = 'button';
    pg.textContent = c.page ? `p. ${c.page}` : 'Source';
    pg.title = 'Open the page beside this';
    pg.addEventListener('click', () => void stShowSource({
      id: 0, materialId: material.id, conceptId: c.id, format: 'short', stem: c.title,
      sourcePage: c.page, sourceQuote: c.anchorQuote, sourceUri: material.kind === 'pdf' ? material.uri : '', origin: 'generated',
    }));
    pt.appendChild(pg);
    learn.appendChild(pt);
  }

  const ft = el('div', 'st-learn__ft');
  ft.appendChild(el('span', '', `${concepts.length} ${concepts.length === 1 ? 'concept' : 'concepts'}`));
  _api.ui.createButton(ft, {
    label: 'Practice This Chapter', kind: 'primary',
    onClick: () => void stOpenSetup({ materialIds: [material.id], sectionId: section ? section.id : undefined }),
  });
  learn.appendChild(ft);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 70: INTEGRATION
// Commands, the selection action, question providers, the Flashcards hand-off,
// the dashboard widget, links, chat tools, planner day loads. The patterns
// (retry over a command that returns a live registry, the widget, links and
// chat tool shapes) are copies of ext/flashcards/main.js SECTION 10 to 14,
// renamed to st, because extensions cannot import each other.
// Names from other parts (00-header, 10-model, 20-data, 30-ai, 60-pane) are
// called as the build specification promises them (docs/STUDY_BUILD_SPEC.md).
// ═══════════════════════════════════════════════════════════════════════════════

/** Materials picked in the sidebar's Select Materials mode (ids). */
let _picked = [];
/** The live question-provider registry once `questions.getRegistry` answers. */
let _questionRegistry = null;
/** `flashcards.addCards` existence, cached for ten seconds. */
let _fcCheck = null;
/** The document listener for `parallx:card-rated`, so deactivate can remove it. */
let _ratingListener = null;

const ST_FC_CHECK_TTL = 10000;
const ST_IMPORT_EXTS = ['.md', '.csv', '.tsv', '.json'];
const ST_PICK_MAX_FILES = 2000;
const ST_PICK_MAX_DEPTH = 8;

// ─── Picked materials (the sidebar reads and writes these) ──────────────────

function stPicked() {
  return _picked.slice();
}

function stSetPicked(ids) {
  const seen = new Set();
  _picked = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    _picked.push(id);
  }
}

// ─── Small pure helpers ─────────────────────────────────────────────────────

/** A session's scope as an object, whatever the row holds. */
function stScopeOf(session) {
  const raw = session?.scope ?? session?.scopeJson ?? session?.scope_json;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw || '{}')) || {}; } catch { return {}; }
}

/** The section of a material whose page range holds `page`, else null. */
function stSectionForPage(sections, page) {
  const p = Number(page);
  if (!Number.isFinite(p) || p <= 0) return null;
  for (const s of sections || []) {
    const from = Number(s.pageFrom ?? s.page_from);
    const to = Number(s.pageTo ?? s.page_to);
    if (p >= from && p <= to) return s;
  }
  return null;
}

/** The active open editor showing a PDF, else the only open PDF, else null. */
function stPdfOfOpenEditors(editors) {
  const list = Array.isArray(editors) ? editors : [];
  const isPdf = (e) => /\.pdf$/i.test(String(e?.description || '')) || /\.pdf$/i.test(String(e?.name || ''));
  const pdfs = list.filter(isPdf);
  const active = pdfs.find((e) => e.isActive);
  if (active) return active;
  return pdfs.length === 1 ? pdfs[0] : null;
}

/** The fsPath a PDF editor descriptor carries (its description is the fsPath). */
function stPathOfEditor(editor) {
  const d = String(editor?.description || '');
  if (/\.pdf$/i.test(d)) return stFsPathOf(d);
  return stFsPathOf(String(editor?.name || ''));
}

/** The concept's title turned into the question on a Flashcards card. */
function stConceptQuestion(title) {
  const t = String(title || '').trim().replace(/[.:]+$/, '');
  if (!t) return 'What does the text say here?';
  if (t.endsWith('?')) return t;
  return `What does the text say about ${t}?`;
}

/** Rubric origins ranked: a report's rubric beats one read from the source, which beats one written from an answer. */
const ST_RUBRIC_RANK = { report: 3, source: 2, answer: 1 };

/** The typed question of a concept whose rubric is worth copying onto a card, else null. */
function stBestTypedQuestion(questions, conceptId) {
  let best = null;
  let bestScore = -1;
  for (const q of questions || []) {
    if (Number(q.conceptId) !== Number(conceptId) || q.hidden) continue;
    if (!ST_TYPED.has(q.format)) continue;
    const rubric = Array.isArray(q.rubric) ? q.rubric : [];
    if (rubric.length === 0) continue;
    const score = (ST_RUBRIC_RANK[q.rubricOrigin] || 0) * 100 + rubric.length;
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return best;
}

/**
 * Pure: the cards Send Missed makes. One card per missed concept, grouped by
 * material so each group lands in the deck "Study: <material label>".
 * `summary` is stSessionSummary's result ({ missed: [{ conceptId, questionId }] }).
 */
function stCardsForMissed(summary, concepts, questions, materials) {
  const conceptById = new Map((concepts || []).map((c) => [Number(c.id), c]));
  const questionById = new Map((questions || []).map((q) => [Number(q.id), q]));
  const materialById = new Map((materials || []).map((m) => [Number(m.id), m]));
  const seen = new Set();
  const groups = new Map();
  for (const miss of summary?.missed || []) {
    let conceptId = Number(miss.conceptId);
    if (!Number.isFinite(conceptId) || conceptId <= 0) {
      const q = questionById.get(Number(miss.questionId));
      conceptId = Number(q?.conceptId);
    }
    const concept = conceptById.get(conceptId);
    if (!concept || seen.has(conceptId)) continue;
    seen.add(conceptId);
    const material = materialById.get(Number(concept.materialId)) || null;
    const label = String(material?.label || 'Material');
    const typed = stBestTypedQuestion(questions, conceptId);
    const missedQuestion = questionById.get(Number(miss.questionId)) || null;
    const sourceUri = String(missedQuestion?.sourceUri || material?.uri || '');
    const card = {
      front: stConceptQuestion(concept.title),
      back: String(concept.summary || concept.anchorQuote || concept.title || ''),
      tags: ['study', `study:c:${conceptId}`],
      sourceUri,
      sourceLabel: label,
      sourcePage: Number(concept.page) > 0 ? Number(concept.page) : 0,
      sourceExcerpt: String(concept.anchorQuote || ''),
      recallMode: 'conceptual',
    };
    if (typed) card.rubric = typed.rubric.map((pt) => ({ text: String(pt.text || ''), required: pt.required !== false }));
    const key = Number(concept.materialId) || 0;
    if (!groups.has(key)) groups.set(key, { materialId: key, deckName: `Study: ${label}`, cards: [] });
    groups.get(key).cards.push(card);
  }
  return [...groups.values()];
}

/**
 * Pure: the questions a scope can draw from (not hidden, inside the scope).
 * `concepts` are the scope's materials' concepts; `now` and `staleDays` serve
 * the weak scope only.
 */
function stQuestionsInScope(questions, concepts, scope, now, staleDays = 14) {
  const s = scope || {};
  const materialIds = new Set((s.materialIds || []).map(Number));
  const conceptById = new Map((concepts || []).map((c) => [Number(c.id), c]));
  const sectionIds = Array.isArray(s.sectionIds) && s.sectionIds.length ? new Set(s.sectionIds.map(Number)) : null;
  const bankIds = Array.isArray(s.bankIds) && s.bankIds.length ? new Set(s.bankIds.map(Number)) : null;
  const from = Number(s.pageFrom) || 0;
  const to = Number(s.pageTo) || 0;
  return (questions || []).filter((q) => {
    if (q.hidden) return false;
    if (s.kind === 'bank') return bankIds ? bankIds.has(Number(q.bankId)) : Number(q.bankId) > 0;
    if (materialIds.size && !materialIds.has(Number(q.materialId))) return false;
    const concept = conceptById.get(Number(q.conceptId));
    if (sectionIds && !(concept && sectionIds.has(Number(concept.sectionId)))) return false;
    if (s.kind === 'pages' && (from || to)) {
      const page = Number(q.sourcePage) || Number(concept?.page) || 0;
      if (from && page < from) return false;
      if (to && page > to) return false;
    }
    if (s.kind === 'selection') {
      const page = Number(s.selectionPage) || 0;
      if (page && Number(q.sourcePage) !== page && Number(concept?.page) !== page) return false;
    }
    if (s.kind === 'weak') {
      if (!concept) return false;
      return stConceptState(concept, now, { staleDays }) === 'weak';
    }
    return true;
  });
}

/**
 * Pure: the planner's per-day loads. A weak or stale concept is due today; a
 * clean one on the day it goes stale (lastAnsweredAt + staleDays). `dayStart`
 * maps a time to its local midnight so the caller owns the time zone.
 */
function stDayLoadsFor(concepts, { now, staleDays = 14, fromMs, toMs, dayStart }) {
  const today = dayStart(now);
  const byDay = new Map();
  for (const c of concepts || []) {
    const state = stConceptState(c, now, { staleDays });
    let day;
    if (state === 'weak' || state === 'stale') day = today;
    else if (state === 'clean') day = Math.max(today, dayStart(Number(c.lastAnsweredAt) + staleDays * DAY));
    else continue;
    if (day < fromMs || day >= toMs) continue;
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  return [...byDay.entries()]
    .map(([dayStartMs, count]) => ({ dayStartMs, count, label: 'Study' }))
    .sort((a, b) => a.dayStartMs - b.dayStartMs);
}

/** Pure: the dashboard widget's rows from per-material coverage and the last score. */
function stWeakRowsFrom(entries, limit) {
  const rows = (entries || []).map((e) => {
    const total = Number(e.total) || 0;
    const weak = Number(e.weak) || 0;
    const covered = total ? Math.round(((total - (Number(e.unasked) || 0)) / total) * 100) : 0;
    return {
      materialId: Number(e.materialId),
      label: String(e.label || ''),
      weak,
      total,
      share: total ? weak / total : 0,
      last: e.last ? String(e.last) : '',
      covered,
    };
  });
  rows.sort((a, b) => b.weak - a.weak || b.share - a.share || a.label.localeCompare(b.label));
  return rows.slice(0, Math.max(1, Number(limit) || 5));
}

// ─── Settings for a session, from the material then the settings ────────────

function stSessionPrefs(material) {
  return {
    answerFormat: String(material?.answerFormat || cfg('answerFormat', 'mixed') || 'mixed'),
    model: String(material?.model || cfg('aiModel', '') || ''),
    numCtx: Number(material?.contextSetting || cfg('generationContext', 0) || 0),
  };
}

/** One concept by id, through the data layer's own mapper. */
async function stLoadConcept(conceptId) {
  const id = Number(conceptId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await db.get('SELECT material_id FROM st_concepts WHERE id = ?', [id]);
  if (!row) return null;
  const concepts = await stListConcepts({ materialIds: [Number(row.material_id)] });
  return concepts.find((c) => Number(c.id) === id) || null;
}

// ─── Workspace file picker (the PDF picker in 20-data is pdf-only) ───────────

/** Quick pick of every file under the workspace with one of `exts`; returns an fsPath or null. */
async function stPickWorkspaceFile(exts, placeholder) {
  const root = stWorkspaceRoot();
  const fs = _api?.workspace?.fs;
  if (!root || !fs?.readdir) {
    await _api.window.showWarningMessage('Open a workspace first.');
    return null;
  }
  const sep = root.includes('\\') ? '\\' : '/';
  const wanted = (exts || []).map((e) => String(e).toLowerCase());
  const found = [];
  const walk = async (dir, rel, depth) => {
    if (found.length >= ST_PICK_MAX_FILES || depth > ST_PICK_MAX_DEPTH) return;
    let entries = [];
    try { entries = await fs.readdir(stUriOf(dir)); } catch { return; }
    for (const entry of entries || []) {
      const name = String(entry?.name || '');
      if (!name || name.startsWith('.') || name === 'node_modules') continue;
      const path = dir + sep + name;
      const relPath = rel ? rel + '/' + name : name;
      if (entry.type === 2) await walk(path, relPath, depth + 1);
      else if (wanted.some((e) => name.toLowerCase().endsWith(e))) found.push({ path, relPath });
      if (found.length >= ST_PICK_MAX_FILES) return;
    }
  };
  await walk(root, '', 0);
  if (found.length === 0) {
    await _api.window.showInformationMessage(`No ${wanted.join(', ')} files in the workspace.`);
    return null;
  }
  found.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const items = found.map((f) => ({ label: f.relPath.split('/').pop(), description: f.relPath, path: f.path }));
  const pick = await _api.window.showQuickPick(items, { placeholder });
  return pick?.path || null;
}

// ─── Session start ──────────────────────────────────────────────────────────

/** True when the scope holds fewer ready questions than the session size. */
async function stSessionNeedsGeneration(session) {
  const scope = stScopeOf(session);
  const size = Number(session?.size) || Number(cfg('sessionSize', 20)) || 20;
  const materialIds = (scope.materialIds || []).map(Number).filter((n) => n > 0);
  const [questions, concepts] = await Promise.all([
    stListQuestions({ materialIds, includeHidden: false }),
    materialIds.length ? stListConcepts({ materialIds }) : Promise.resolve([]),
  ]);
  const ready = stQuestionsInScope(questions, concepts, scope, stNow(), Number(cfg('staleDays', 14)) || 14);
  return ready.length < size;
}

/**
 * Create the session and open its pane: the generation screen when the scope
 * is short of questions (it calls stNextDraw when ready), else the first draw
 * and the session view.
 */
async function stStartSession({ scope, mode, answerFormat, model, numCtx }) {
  const size = Number(cfg('sessionSize', 20)) || 20;
  const created = await stCreateSession({
    name: String(scope?.label || mode || 'Study'),
    scope,
    mode: String(mode || 'practice'),
    answerFormat: String(answerFormat || cfg('answerFormat', 'mixed') || 'mixed'),
    size,
    model: String(model || ''),
    numCtx: Number(numCtx) || 0,
  });
  const session = created && typeof created === 'object' ? created : await stGetSession(Number(created));
  if (!session) throw new Error('[Study] session was not created');
  const now = stNow();
  for (const id of scope?.materialIds || []) {
    try { await stTouchMaterial(Number(id), now); } catch { /* a bank scope has no material */ }
  }
  if (await stSessionNeedsGeneration(session)) {
    await stOpenPane({ view: 'generating', sessionId: session.id });
  } else {
    await stNextDraw(session, { token: { cancelled: false }, onProgress: () => {} });
    await stOpenPane({ view: 'session', sessionId: session.id });
  }
  _emitDataChanged();
  return session;
}

// ─── Show Source ────────────────────────────────────────────────────────────

/** Open the question's source beside the session: the provider's own open, else the file at its page and quote. */
async function stShowSource(question) {
  if (!question) return false;
  if (question.providerId && _questionRegistry) {
    try {
      const list = typeof _questionRegistry.list === 'function' ? _questionRegistry.list() : [];
      const provider = (await list || []).find((p) => p && p.id === question.providerId);
      if (provider && typeof provider.open === 'function') {
        const ok = await provider.open(String(question.providerRef || ''));
        if (ok) return true;
      }
    } catch (err) {
      console.warn('[Study] provider open failed:', err);
    }
  }
  let uri = String(question.sourceUri || '');
  if (!uri && question.materialId) {
    const material = await stGetMaterial(Number(question.materialId)).catch(() => null);
    uri = String(material?.uri || '');
  }
  if (!uri) {
    await _api.window.showInformationMessage('This question has no source to show.');
    return false;
  }
  const reveal = {};
  if (Number(question.sourcePage) > 0) reveal.page = Number(question.sourcePage);
  if (question.sourceQuote) reveal.quote = String(question.sourceQuote);
  const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : stUriOf(stFsPathOf(uri));
  try {
    // `side` opens beside the session (core seam C4); an older core ignores it.
    await _api.editors.openFileEditor(target, { reveal, side: true });
  } catch (err) {
    console.warn('[Study] open beside failed, opening in place:', err);
    await _api.editors.openFileEditor(target, { reveal });
  }
  return true;
}

// ─── Flashcards hand-off ────────────────────────────────────────────────────

/** True while the `flashcards.addCards` command exists (Flashcards on). Cached ten seconds. */
async function stFlashcardsAvailable() {
  const now = stNow();
  if (_fcCheck && now - _fcCheck.at < ST_FC_CHECK_TTL) return _fcCheck.value;
  let value = false;
  try {
    const cmds = await _api.commands.getCommands();
    value = Array.isArray(cmds) && cmds.includes('flashcards.addCards');
  } catch { value = false; }
  _fcCheck = { at: now, value };
  return value;
}

/**
 * A session's items with the concepts and questions they need: the scope's
 * materials' concepts, plus the concept of any drawn question outside them (a
 * bank question), plus every question of each missed concept (the rubric on
 * a card comes from the best typed one, which the session may never have drawn).
 */
async function stSessionContext(session) {
  const scope = stScopeOf(session);
  const materialIds = (scope.materialIds || []).map(Number).filter((n) => n > 0);
  const items = await stListSessionItems(session.id);
  const questionIds = [...new Set(items.map((it) => Number(it.questionId)))];
  const [concepts, scopedQuestions] = await Promise.all([
    materialIds.length ? stListConcepts({ materialIds }) : Promise.resolve([]),
    stListQuestions({ materialIds, includeHidden: true }),
  ]);
  const questions = scopedQuestions.slice();
  const questionById = new Map(questions.map((q) => [Number(q.id), q]));
  const missing = questionIds.filter((id) => !questionById.has(id));
  if (missing.length) {
    for (const q of await stListQuestions({ includeHidden: true })) {
      if (missing.includes(Number(q.id)) && !questionById.has(Number(q.id))) { questionById.set(Number(q.id), q); questions.push(q); }
    }
  }
  const conceptIds = new Set(concepts.map((c) => Number(c.id)));
  for (const id of questionIds) {
    const q = questionById.get(id);
    if (q && Number(q.conceptId) > 0 && !conceptIds.has(Number(q.conceptId))) {
      const c = await stLoadConcept(q.conceptId);
      if (c) { concepts.push(c); conceptIds.add(Number(c.id)); }
    }
  }
  const summary = stSessionSummary(items, concepts);
  const missedConceptIds = [...new Set((summary.missed || []).map((m) => Number(m.conceptId) || Number(questionById.get(Number(m.questionId))?.conceptId) || 0).filter((n) => n > 0))];
  if (missedConceptIds.length) {
    for (const q of await stListQuestions({ conceptIds: missedConceptIds, includeHidden: false })) {
      if (!questionById.has(Number(q.id))) { questionById.set(Number(q.id), q); questions.push(q); }
    }
  }
  return { scope, items, concepts, questions, summary };
}

/** Send one card per missed concept of the session to Flashcards. Returns { count }. */
async function stSendMissedToFlashcards(session) {
  const s = session && typeof session === 'object' ? session : await stGetSession(Number(session));
  if (!s) return { count: 0 };
  if (!(await stFlashcardsAvailable())) return { count: 0 };
  const [{ summary, concepts, questions }, materials] = await Promise.all([stSessionContext(s), stListMaterials()]);
  const groups = stCardsForMissed(summary, concepts, questions, materials);
  let count = 0;
  for (const g of groups) {
    await _api.commands.executeCommand('flashcards.addCards', { deckName: g.deckName, cards: g.cards });
    count += g.cards.length;
  }
  return { count };
}

/** A card rated in Flashcards lowers its concept's mastery here (tag study:c:<id>). */
function registerRatingListener(context) {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  const handler = (ev) => {
    const detail = ev?.detail || {};
    const rating = Number(detail.rating);
    const tags = Array.isArray(detail.tags) ? detail.tags : String(detail.tags || '').split(',');
    for (const raw of tags) {
      const m = /^study:c:(\d+)$/.exec(String(raw || '').trim());
      if (!m) continue;
      void (async () => {
        if (!_dbBridge) return;
        const concept = await stLoadConcept(Number(m[1]));
        if (!concept) return;
        const mastery = stMasteryFromCardRating(Number(concept.mastery) || 0, rating);
        if (mastery === concept.mastery) return;
        await stUpdateConcept({ ...concept, mastery });
        _emitDataChanged();
      })().catch((err) => console.warn('[Study] card rating not applied:', err));
    }
  };
  _ratingListener = handler;
  document.addEventListener('parallx:card-rated', handler);
  context.subscriptions.push({
    dispose: () => {
      document.removeEventListener('parallx:card-rated', handler);
      if (_ratingListener === handler) _ratingListener = null;
    },
  });
}

// ─── Question providers ─────────────────────────────────────────────────────

/** Pull every question provider's items; re-sync when the set changes. Retries while the core command is not yet there. */
function registerQuestionProviders(context, attempt = 0) {
  _api.commands.executeCommand('questions.getRegistry')
    .then(async (registry) => {
      if (!_dbBridge) return;
      if (!registry || typeof registry.list !== 'function') throw new Error('no registry');
      _questionRegistry = registry;
      await stSyncProviders(registry);
      if (typeof registry.onDidChange === 'function') {
        context.subscriptions.push(registry.onDidChange(() => {
          if (!_dbBridge) return;
          stSyncProviders(registry).then(() => _emitDataChanged()).catch((err) => console.warn('[Study] provider sync failed:', err));
        }));
      }
      _emitDataChanged();
    })
    .catch(() => {
      if (attempt < 5 && _dbBridge) setTimeout(() => registerQuestionProviders(context, attempt + 1), 2000);
    });
}

// ─── Selection action ───────────────────────────────────────────────────────

/** Quiz This Selection: ingest the source, then a Practice session over the selected text. */
async function stQuizSelection(payload) {
  const text = String(payload?.selectedText || '').trim();
  if (text.length < 20) {
    await _api.window.showInformationMessage('Select a little more text to quiz on.');
    return null;
  }
  const source = payload?.source || {};
  const filePath = String(source.filePath || '');
  let material = null;
  if (/\.pdf$/i.test(filePath)) {
    material = await stIngestPdf(stFsPathOf(filePath));
  } else {
    const canvas = /^parallx:\/\/canvas\/page\/(.+)$/.exec(filePath);
    if (payload?.surface === 'canvas' && canvas) material = await stIngestCanvasPage(decodeURIComponent(canvas[1]));
  }
  if (!material) {
    await _api.window.showInformationMessage('Quiz This Selection works on a PDF or a canvas page.');
    return null;
  }
  const page = Number.isInteger(source.pageNumber) && source.pageNumber > 0 ? source.pageNumber : 0;
  const fileName = String(source.fileName || material.label || 'Selection');
  const prefs = stSessionPrefs(material);
  return stStartSession({
    scope: { kind: 'selection', materialIds: [material.id], selectionText: text, selectionPage: page, label: `${fileName} · selection` },
    mode: 'practice',
    ...prefs,
  });
}

/** Register into the selection-action dispatcher; the chat may activate after Study, so retry briefly. */
function registerSelectionAction(context, attempt = 0) {
  _api.commands.executeCommand('chat.getSelectionActionDispatcher')
    .then((dispatcher) => {
      if (!_dbBridge) return;
      if (!dispatcher || typeof dispatcher.registerHandler !== 'function') throw new Error('no dispatcher');
      context.subscriptions.push(dispatcher.registerHandler({
        actionId: 'quiz-selection',
        label: 'Quiz This Selection',
        icon: 'px-study',
        execute: async (payload) => { await stQuizSelection(payload); },
      }));
    })
    .catch(() => {
      if (attempt < 5 && _dbBridge) setTimeout(() => registerSelectionAction(context, attempt + 1), 2000);
    });
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function stCmdOpen() {
  const picked = stPicked();
  if (picked.length) return stOpenSetup({ materialIds: picked });
  const materials = await stListMaterials();
  if (materials.length) return stOpenSetup({ materialIds: [materials[0].id] });
  return stOpenPane({ view: 'setup', materialIds: [] });
}

/** `arg` is the PDF pane's `{ uri, fsPath, page }`, a path string, or nothing (the palette). */
async function stCmdStudyDocument(arg) {
  let fsPath = '';
  let page = 0;
  if (typeof arg === 'string') fsPath = stFsPathOf(arg);
  else if (arg && typeof arg === 'object') {
    fsPath = stFsPathOf(String(arg.fsPath || arg.uri || ''));
    page = Number(arg.page) || 0;
  }
  if (!fsPath) {
    const editor = stPdfOfOpenEditors(_api.editors?.openEditors);
    if (editor) fsPath = stPathOfEditor(editor);
  }
  if (!fsPath) fsPath = (await stPickWorkspacePdf()) || '';
  if (!fsPath) return null;
  const material = await stIngestPdf(fsPath);
  const sections = await stListSections(material.id);
  const section = stSectionForPage(sections, page);
  await stOpenSetup({ materialIds: [material.id], sectionId: section ? section.id : undefined });
  return material;
}

async function stCmdStudyTogether() {
  let ids = stPicked();
  if (!ids.length) ids = (await stListMaterials()).map((m) => m.id);
  if (!ids.length) {
    await _api.window.showInformationMessage('Add a material first.');
    return null;
  }
  return stOpenSetup({ materialIds: ids });
}

async function stCmdWeakSpots() {
  const materials = await stListMaterials();
  if (!materials.length) {
    await _api.window.showInformationMessage('Add a material first.');
    return null;
  }
  return stStartSession({
    scope: { kind: 'weak', materialIds: materials.map((m) => m.id), label: 'Weak spots' },
    mode: 'weak',
    ...stSessionPrefs(null),
  });
}

async function stCmdAddMaterial() {
  const fsPath = await stPickWorkspacePdf();
  if (!fsPath) return null;
  const material = await stIngestPdf(fsPath);
  await stOpenSetup({ materialIds: [material.id] });
  return material;
}

async function stCmdImportQuestions() {
  const fsPath = await stPickWorkspaceFile(ST_IMPORT_EXTS, 'Import questions from which file?');
  if (!fsPath) return null;
  const result = await stImportQuestionFile(fsPath);
  const n = Number(result?.inserted) || 0;
  await _api.window.showInformationMessage(`Imported ${n} ${n === 1 ? 'question' : 'questions'}.`);
  _emitDataChanged();
  return result;
}

async function stCmdImportReport() {
  const fsPath = await stPickWorkspaceFile(['.pdf'], 'Which examiner\'s report?');
  if (!fsPath) return null;
  const result = await stImportExaminerReport(fsPath);
  const countOf = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
  const matched = countOf(result?.matched);
  const unmatched = countOf(result?.unmatched);
  await _api.window.showInformationMessage(
    `Matched ${matched} ${matched === 1 ? 'question' : 'questions'}; ${unmatched} ${unmatched === 1 ? 'entry' : 'entries'} had no question.`,
  );
  _emitDataChanged();
  return result;
}

function registerCommands(context) {
  const cmds = [
    ['study.open', () => stCmdOpen()],
    ['study.studyDocument', (arg) => stCmdStudyDocument(arg)],
    // From the palette there is no selection; the selection action passes the payload.
    ['study.quizSelection', async (payload) => {
      if (!payload || typeof payload !== 'object' || !payload.selectedText) {
        await _api.window.showInformationMessage('Select text in a PDF or a page, then choose Quiz This Selection.');
        return null;
      }
      return stQuizSelection(payload);
    }],
    ['study.studyTogether', () => stCmdStudyTogether()],
    ['study.weakSpots', () => stCmdWeakSpots()],
    ['study.addMaterial', () => stCmdAddMaterial()],
    ['study.importQuestions', () => stCmdImportQuestions()],
    ['study.importReport', () => stCmdImportReport()],
  ];
  for (const [id, handler] of cmds) {
    context.subscriptions.push(_api.commands.registerCommand(id, handler));
  }
}

// ─── Dashboard widget ───────────────────────────────────────────────────────

/** "17/20" for the last finished session over the material, else ''. */
async function stLastScoreOf(materialId) {
  const rows = await db.all(
    `SELECT s.id, s.scope_json,
            (SELECT COUNT(*) FROM st_session_items i WHERE i.session_id = s.id AND i.status = 'right') AS right_n,
            (SELECT COUNT(*) FROM st_session_items i WHERE i.session_id = s.id AND i.status IN ('right', 'wrong')) AS answered_n
       FROM st_sessions s WHERE s.finished_at > 0 ORDER BY s.finished_at DESC LIMIT 50`,
  );
  for (const r of rows) {
    const scope = stScopeOf({ scope: r.scope_json });
    if (!(scope.materialIds || []).map(Number).includes(Number(materialId))) continue;
    if (!(Number(r.answered_n) > 0)) continue;
    return `${Number(r.right_n)}/${Number(r.answered_n)}`;
  }
  return '';
}

async function stWeakSpotRows(limit) {
  const materials = await stListMaterials();
  const now = stNow();
  const staleDays = Number(cfg('staleDays', 14)) || 14;
  const entries = [];
  let totalWeak = 0;
  for (const m of materials) {
    const concepts = await stListConcepts({ materialIds: [m.id] });
    const cov = stCoverage(concepts, now, { staleDays });
    totalWeak += Number(cov.weak) || 0;
    entries.push({ materialId: m.id, label: m.label, weak: cov.weak, total: cov.total, unasked: cov.unasked, last: await stLastScoreOf(m.id) });
  }
  return { rows: stWeakRowsFrom(entries, limit), totalWeak, size: Number(cfg('sessionSize', 20)) || 20 };
}

function registerDashboardWidget(context) {
  if (!_api.dashboard?.registerWidgetType) return;
  try {
    context.subscriptions.push(_api.dashboard.registerWidgetType({
      typeId: 'parallx-community.study.weak-spots',
      displayName: 'Weak spots',
      description: 'The concepts you keep missing, by material, each row a door into a session on it.',
      icon: 'px-study',
      category: 'query',
      defaultSize: { colSpan: 4, rowSpan: 3 },
      defaultConfig: { maxRows: 5 },
      configSchema: { fields: { maxRows: { type: 'number', label: 'Materials to show' } } },
      defaultRefreshPolicy: { kind: 'interval', ms: 15 * 60 * 1000 },
      refresh: async (ctx) => JSON.stringify(await stWeakSpotRows(Number(ctx?.config?.maxRows) || 5)),
      createWidget: (container, ctx) => {
        injectStyles();
        const root = el('div', 'st-widget');
        container.appendChild(root);
        const paint = (raw) => {
          let data = { rows: [], totalWeak: 0, size: 20 };
          try { data = { ...data, ...JSON.parse(raw || '{}') }; } catch { /* keep the empty shape */ }
          root.innerHTML = '';
          const rows = Array.isArray(data.rows) ? data.rows : [];
          if (rows.length === 0) {
            root.appendChild(el('div', 'st-widget__empty', 'Nothing studied yet.'));
          }
          for (const r of rows) {
            const row = el('div', 'st-widget__row');
            row.setAttribute('role', 'button');
            row.tabIndex = 0;
            const text = el('div', 'st-widget__text');
            text.appendChild(el('div', 'st-widget__label', r.label));
            const under = r.last
              ? `${r.weak} weak · last ${r.last}`
              : `${r.weak} weak · ${r.covered || 0}% covered`;
            text.appendChild(el('small', 'st-widget__under', under));
            row.appendChild(text);
            const bar = el('span', 'st-widget__bar');
            const fill = el('i', 'st-widget__fill' + (r.share < 0.2 ? ' st-widget__fill--warn' : ''));
            fill.style.width = `${Math.max(0, Math.min(100, Math.round((r.share || 0) * 100)))}%`;
            bar.appendChild(fill);
            row.appendChild(bar);
            const open = () => void stOpenSetup({ materialIds: [r.materialId] });
            row.addEventListener('click', open);
            row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
            root.appendChild(row);
          }
          const foot = el('button', 'st-widget__foot', `Study the weakest ${data.size || 20}`);
          foot.type = 'button';
          foot.addEventListener('click', () => void _api.commands.executeCommand('study.weakSpots'));
          root.appendChild(foot);
        };
        paint(ctx.cachedOutput);
        const sub = typeof ctx.onDidChangeConfig === 'function' ? ctx.onDidChangeConfig(() => ctx.requestRefresh()) : null;
        const data = onDataChanged(() => { if (typeof ctx.requestRefresh === 'function') ctx.requestRefresh(); });
        return {
          refreshFromCache: (cached) => paint(cached),
          renderError: () => {},
          dispose: () => { sub?.dispose?.(); data?.dispose?.(); root.remove(); },
        };
      },
    }));
  } catch (err) {
    console.warn('[Study] dashboard widget registration failed:', err);
  }
}

// ─── Links ──────────────────────────────────────────────────────────────────

function registerLinks(context) {
  if (!_api.links?.register) return;
  try {
    context.subscriptions.push(_api.links.register({
      segment: 'study',
      displayName: 'Study',
      kinds: {
        session: {
          uriTemplate: 'parallx://study/session/<id>',
          description: 'Open a study session: where it stands, or its results once finished.',
          open: async (parsed) => {
            const id = parseInt(parsed.pathSegments[1] || '', 10);
            const session = Number.isFinite(id) ? await stGetSession(id).catch(() => null) : null;
            if (!session) return false;
            await stOpenPane({ view: Number(session.finishedAt) > 0 ? 'results' : 'session', sessionId: session.id });
            return true;
          },
          resolveMetadata: async (parsed) => {
            const id = parseInt(parsed.pathSegments[1] || '', 10);
            const session = Number.isFinite(id) ? await stGetSession(id).catch(() => null) : null;
            return session ? { title: `Session: ${stTruncate(String(session.name || ''), 60)}`, icon: 'px-study' } : null;
          },
        },
        concept: {
          uriTemplate: 'parallx://study/concept/<id>',
          description: 'Open the setup sheet on the chapter holding one concept.',
          open: async (parsed) => {
            const id = parseInt(parsed.pathSegments[1] || '', 10);
            const concept = Number.isFinite(id) ? await stLoadConcept(id).catch(() => null) : null;
            if (!concept) return false;
            await stOpenSetup({ materialIds: [concept.materialId], sectionId: Number(concept.sectionId) > 0 ? concept.sectionId : undefined });
            return true;
          },
          resolveMetadata: async (parsed) => {
            const id = parseInt(parsed.pathSegments[1] || '', 10);
            const concept = Number.isFinite(id) ? await stLoadConcept(id).catch(() => null) : null;
            return concept ? { title: `Concept: ${stTruncate(String(concept.title || ''), 60)}`, icon: 'px-study' } : null;
          },
        },
      },
    }));
  } catch (err) {
    console.warn('[Study] links registration failed:', err);
  }
}

// ─── Chat tools ─────────────────────────────────────────────────────────────

/** The material whose label or path holds `text` (case folded); null when none. */
function stFindMaterial(materials, text) {
  const needle = String(text || '').trim().toLowerCase();
  if (!needle) return null;
  const exact = materials.find((m) => String(m.label || '').toLowerCase() === needle);
  if (exact) return exact;
  return materials.find((m) => String(m.label || '').toLowerCase().includes(needle) || String(m.uri || '').toLowerCase().includes(needle)) || null;
}

/** "12-20", "12 to 20" or "12" as { from, to }, else null. */
function stParsePages(text) {
  const m = /^\s*(\d+)\s*(?:-|–|to)?\s*(\d*)\s*$/.exec(String(text || ''));
  if (!m) return null;
  const from = parseInt(m[1], 10);
  const to = m[2] ? parseInt(m[2], 10) : from;
  if (!(from > 0) || !(to >= from)) return null;
  return { from, to };
}

async function stLastSession() {
  const finished = await stListSessions({ open: false });
  const byFinish = finished.slice().sort((a, b) => Number(b.finishedAt) - Number(a.finishedAt));
  if (byFinish.length) return byFinish[0];
  const open = await stListSessions({ open: true });
  return open.slice().sort((a, b) => Number(b.startedAt) - Number(a.startedAt))[0] || null;
}

function registerChatTools(context) {
  if (!_api.chat?.registerTool) return;

  context.subscriptions.push(_api.chat.registerTool('study_session', {
    description:
      'Start a Study session on a material the user has already added to Study (a PDF or a canvas page), '
      + 'optionally over a page range. Opens the session in an editor tab; when the material has too few '
      + 'questions yet, the generation screen opens first. Local models only, nothing leaves the computer.',
    parameters: {
      type: 'object',
      properties: {
        material: { type: 'string', description: 'The material by its label or file name, as the Study sidebar lists it.' },
        pages: { type: 'string', description: 'A page range such as "12-20". Omit for the whole document.' },
        mode: { type: 'string', enum: ['practice', 'test', 'learn', 'weak'], description: 'practice (feedback after each answer), test (feedback at the end), learn (read the concept map first) or weak (only weak concepts). Default practice.' },
        format: { type: 'string', enum: ['choose', 'type', 'mixed'], description: 'choose (multiple choice), type (typed answers graded against the text) or mixed. Default the Study setting.' },
      },
      required: ['material'],
    },
    requiresConfirmation: false,
    handler: async (args) => {
      try {
        const materials = await stListMaterials();
        const material = stFindMaterial(materials, args?.material);
        if (!material) {
          const names = materials.map((m) => m.label).join(', ');
          return { content: names ? `No material matches "${args?.material}". Materials: ${names}.` : 'Study has no materials yet. Add a PDF with Add Material in the Study sidebar.', isError: true };
        }
        const mode = ['practice', 'test', 'learn', 'weak'].includes(args?.mode) ? args.mode : 'practice';
        const pages = args?.pages ? stParsePages(args.pages) : null;
        if (args?.pages && !pages) return { content: `Could not read the page range "${args.pages}". Use "12-20".`, isError: true };
        if (mode === 'learn') {
          const sections = await stListSections(material.id);
          const section = (pages && stSectionForPage(sections, pages.from)) || sections[0] || null;
          await stOpenPane({ view: 'learn', materialId: material.id, sectionId: section ? section.id : 0 });
          return { content: `Opened Learn on ${material.label}${section ? `, ${section.title}` : ''}.` };
        }
        const prefs = stSessionPrefs(material);
        if (['choose', 'type', 'mixed'].includes(args?.format)) prefs.answerFormat = args.format;
        const scope = pages
          ? { kind: 'pages', materialIds: [material.id], pageFrom: pages.from, pageTo: pages.to, label: `${material.label} · pages ${pages.from} to ${pages.to}` }
          : mode === 'weak'
            ? { kind: 'weak', materialIds: [material.id], label: `${material.label} · weak spots` }
            : { kind: 'document', materialIds: [material.id], label: material.label };
        const session = await stStartSession({ scope, mode, ...prefs });
        const where = pages ? ` (pages ${pages.from} to ${pages.to})` : '';
        return { content: `Started a ${mode} session on ${material.label}${where}: parallx://study/session/${session.id}` };
      } catch (err) {
        return { content: `Could not start the session: ${err?.message || err}`, isError: true };
      }
    },
  }));

  context.subscriptions.push(_api.chat.registerTool('study_weak_spots', {
    description:
      'List the concepts the user keeps getting wrong in Study, across every material, weakest first, '
      + 'with each one\'s mastery, misses and material. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many concepts to list (default 20, max 100).' },
      },
      required: [],
    },
    requiresConfirmation: false,
    handler: async (args) => {
      try {
        const limit = Math.max(1, Math.min(100, Number(args?.limit) || 20));
        const [concepts, materials] = await Promise.all([stWeakConcepts({ limit }), stListMaterials()]);
        if (!concepts.length) return { content: 'No weak concepts: nothing answered yet, or everything answered is clean.' };
        const labels = new Map(materials.map((m) => [Number(m.id), String(m.label || '')]));
        const now = stNow();
        const staleDays = Number(cfg('staleDays', 14)) || 14;
        const lines = concepts.map((c) => [
          `${c.title}`,
          labels.get(Number(c.materialId)) || `material ${c.materialId}`,
          c.page ? `p. ${c.page}` : '',
          `mastery ${Math.round((Number(c.mastery) || 0) * 100)}%`,
          `missed ${c.misses || 0} of ${c.answers || 0}`,
          stConceptState(c, now, { staleDays }),
          `parallx://study/concept/${c.id}`,
        ].filter(Boolean).join(' · '));
        return { content: `${concepts.length} weakest ${concepts.length === 1 ? 'concept' : 'concepts'}:\n${lines.join('\n')}` };
      } catch (err) {
        return { content: `Could not list weak spots: ${err?.message || err}`, isError: true };
      }
    },
  }));

  context.subscriptions.push(_api.chat.registerTool('study_results', {
    description:
      'The summary of one Study session (right, wrong, skipped, and the concepts missed), by session id or '
      + 'the most recent session when none is given. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'number', description: 'The session id. Omit for the latest session.' },
      },
      required: [],
    },
    requiresConfirmation: false,
    handler: async (args) => {
      try {
        const id = Number(args?.sessionId);
        const session = id > 0 ? await stGetSession(id) : await stLastSession();
        if (!session) return { content: id > 0 ? `No session #${id}.` : 'No sessions yet.', isError: id > 0 };
        const { scope, items, concepts, questions, summary } = await stSessionContext(session);
        const byId = new Map(concepts.map((c) => [Number(c.id), c]));
        const questionById = new Map(questions.map((q) => [Number(q.id), q]));
        const missedTitles = [];
        const seen = new Set();
        for (const m of summary.missed || []) {
          const c = byId.get(Number(m.conceptId) || Number(questionById.get(Number(m.questionId))?.conceptId));
          if (!c || seen.has(c.id)) continue;
          seen.add(c.id);
          missedTitles.push(`- ${c.title}${m.secondMiss ? ' (missed twice)' : ''} · parallx://study/concept/${c.id}`);
        }
        const state = Number(session.finishedAt) > 0 ? 'finished' : 'open';
        return { content: [
          `Session #${session.id} "${session.name}" · ${session.mode} · ${scope.label || ''} · ${state}`,
          `Right ${summary.right || 0} · wrong ${summary.wrong || 0} · skipped ${summary.skipped || 0} · answered ${summary.answered || 0} of ${items.length}`,
          missedTitles.length ? `Missed concepts:\n${missedTitles.join('\n')}` : 'No concepts missed.',
          `parallx://study/session/${session.id}`,
        ].join('\n') };
      } catch (err) {
        return { content: `Could not read the results: ${err?.message || err}`, isError: true };
      }
    },
  }));
}

// ─── Planner day loads ──────────────────────────────────────────────────────

/** Local midnight of a time, the planner's own day boundary. */
function stDayStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function stDayLoads(fromMs, toMs) {
  const materials = await stListMaterials();
  const ids = materials.map((m) => m.id);
  if (!ids.length) return [];
  const concepts = await stListConcepts({ materialIds: ids });
  return stDayLoadsFor(concepts, {
    now: stNow(),
    staleDays: Number(cfg('staleDays', 14)) || 14,
    fromMs,
    toMs,
    dayStart: stDayStart,
  });
}

/** Study's due concepts as planner day badges, through the planner's generic seam; skipped when it lacks the method. */
function registerPlannerDayLoads(context, attempt = 0) {
  _api.commands.executeCommand('planner.getRegistry')
    .then((registry) => {
      if (!_dbBridge) return;
      if (!registry) throw new Error('no registry');
      if (typeof registry.registerDayLoadProvider !== 'function') return;
      context.subscriptions.push(registry.registerDayLoadProvider({
        id: 'study',
        getDayLoads: (fromMs, toMs) => stDayLoads(fromMs, toMs),
        onDidChange: (listener) => onDataChanged(listener),
      }));
    })
    .catch(() => {
      if (attempt < 5 && _dbBridge) setTimeout(() => registerPlannerDayLoads(context, attempt + 1), 2000);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 90: ACTIVATION
// activate, deactivate, __testables. The shape is Flashcards' SECTION 15,
// copied so the two extensions start and stop the same way.
// ═══════════════════════════════════════════════════════════════════════════════

let _activated = false;

/** Open the database and run `<toolPath>/db/migrations`. Copied from Flashcards' ensureDatabase. */
async function ensureDatabase(api) {
  const openResult = await api.database.open();
  if (openResult?.error) {
    console.error('[Study] Database open failed:', openResult.error.message);
    return false;
  }
  const toolPath = String(api.env?.toolPath || '');
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = toolPath + sep + 'db' + sep + 'migrations';
  const res = await api.database.migrate(migrationsDir);
  if (res?.error) {
    console.error('[Study] Migration failed:', res.error.message);
    return false;
  }
  return true;
}

export async function activate(api, context) {
  if (_activated) return;
  _activated = true;
  _api = api;

  if (!api.database) {
    console.error('[Study] api.database unavailable; cannot activate.');
    return;
  }
  _dbBridge = api.database;
  const ok = await ensureDatabase(api);
  if (!ok) return;

  injectStyles();

  context.subscriptions.push(
    api.views.registerViewProvider('study.materials', {
      createView: (container) => createSidebarView(container),
    }),
  );

  context.subscriptions.push(
    api.editors.registerEditorProvider('study', {
      createEditorPane: (container, input) => createEditorPane(container, input),
    }),
  );

  registerCommands(context);
  registerSelectionAction(context);
  registerQuestionProviders(context);
  registerRatingListener(context);
  registerDashboardWidget(context);
  registerLinks(context);
  registerChatTools(context);
  registerPlannerDayLoads(context);

  console.log('[Study] activated');
}

export async function deactivate() {
  _activated = false;
  // The host disposes context.subscriptions; this drops what lives in module state.
  if (_ratingListener && typeof document !== 'undefined' && document.removeEventListener) {
    document.removeEventListener('parallx:card-rated', _ratingListener);
  }
  _ratingListener = null;
  _questionRegistry = null;
  _fcCheck = null;
  _picked = [];
  _dbBridge = null;
  _api = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 91: TESTABLES
// ═══════════════════════════════════════════════════════════════════════════════

export const __testables = {
  /** Bind a fake api without activating (jsdom tests of the pane and sidebar). */
  __setApi: (api) => { _api = api; _dbBridge = api?.database || null; },
  // 40/50/60: the surfaces, for jsdom tests over the real bundle
  injectStyles,
  createSidebarView,
  createEditorPane,
  stOpenPane,
  stOpenSetup,
  stDeleteMaterial,
  // 00-header
  el,
  icon,
  cfg,
  stNow,
  stWorkspaceRoot,
  stFsPathOf,
  stUriOf,
  stTruncate,
  stEsc,
  bus,
  onDataChanged,
  ST_FORMATS,
  ST_TYPED,
  AGAIN, HARD, GOOD, EASY,
  MIN, DAY,
  ST_ICON_HTML,
  // 10-model (the pure model, docs/STUDY_BUILD_SPEC.md §4)
  stConceptState,
  stApplyAnswer,
  stConceptIsCleanIn,
  stFormatClass,
  stResolveFormat,
  stDrawSession,
  stCoverage,
  stSessionSummary,
  stContextPlan,
  stChunkPages,
  stSkeleton,
  stAnchorOnPage,
  stFindAnchorPage,
  stHeadingsFromPages,
  stSectionsFromOutline,
  stExtractJsonArray,
  stExtractJsonObject,
  stNormalizeRubric,
  stNormalizeVerdict,
  stScoreVerdict,
  stMapVerdictToRating,
  stVerdictLabel,
  stRatingWord,
  stNormalizeFormula,
  stFormulaMatches,
  stNumericMatches,
  stClozeMatches,
  stValidateQuestion,
  stDistractorPrompts,
  stParseQuestionFile,
  stParseExaminerReport,
  stMatchReportToQuestions,
  stInterleaveMaterials,
  stMasteryFromCardRating,
  // 70-integration: state and pure helpers
  stPicked,
  stSetPicked,
  stScopeOf,
  stSectionForPage,
  stPdfOfOpenEditors,
  stPathOfEditor,
  stConceptQuestion,
  stBestTypedQuestion,
  stCardsForMissed,
  stQuestionsInScope,
  stDayLoadsFor,
  stWeakRowsFrom,
  stFindMaterial,
  stParsePages,
  // 70-integration: the api-bound surface (needs activate or __setApi first)
  stSessionNeedsGeneration,
  stStartSession,
  stShowSource,
  stFlashcardsAvailable,
  stSendMissedToFlashcards,
  stSessionContext,
  stQuizSelection,
  stPickWorkspaceFile,
  stDayLoads,
  stWeakSpotRows,
  stLoadConcept,
};
