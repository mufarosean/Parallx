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
 *
 * `ranges` ([[from, to], ...]) maps only those pages (the pages the section
 * owns under stPagePartition, so a chapter and its subsections never map a
 * page twice); `ownerOf(page)` files each concept under the section that
 * owns its page; `markMapped` false leaves the section unmarked (a range
 * clipped to a Pages scope is not the whole section). `quiet` reports only
 * through onProgress, for a caller that rewrites the progress (stEnsureBank).
 */
async function stBuildConceptMap(material, section, {
  modelId, numCtx = 0, token, onProgress, selectionText = '', selectionPage = 0,
  ranges = null, ownerOf = null, markMapped = true, quiet = false,
} = {}) {
  const cancelled = () => !!(token && token.cancelled);
  const model = modelId || await stPickModel(material);
  if (!model) throw new Error('No model is available. Pick a model in Settings or start the model backend.');
  const text = await stMaterialText(material);
  const existing = await stListConcepts({ materialIds: [material.id] });
  const report = (done, total) => {
    const p = { phase: 'map', done, total, written: 0, kept: 0, dropped: {}, materialId: material.id, sectionId: section ? section.id : 0 };
    if (onProgress) { try { onProgress(p); } catch { /* listener error is not ours */ } }
    if (!quiet) { try { bus.emit('run', p); } catch { /* bus is optional here */ } }
  };

  // The chunks: page ranges of the section, or the selection as one chunk.
  let chunks = [];
  if (selectionText) {
    const page = Number(selectionPage) || 0;
    chunks = [{ pageFrom: page, pageTo: page, text: `[Page ${page || 1}]\n${String(selectionText).trim()}` }];
  } else {
    const pageCount = text.pageTexts.length;
    const list = Array.isArray(ranges) && ranges.length ? ranges : [[section.pageFrom, section.pageTo]];
    const cap = await stPlanFor(model, material, ST_MAP_CHUNK_CHARS, ST_MAP_OUTPUT_TOKENS, numCtx);
    const maxChars = Math.min(ST_MAP_CHUNK_CHARS, cap.maxChars);
    for (const [rf, rt] of list) {
      const from = Math.max(1, Number(rf) || 1);
      const to = Math.max(from, Math.min(pageCount || from, Number(rt) || from));
      const pieces = (stChunkPages(text.pageTexts, { from, to, maxChars }) || []).map((r) => {
        const block = stPageBlock(text.pageTexts, r.pageFrom, r.pageTo, maxChars);
        return { pageFrom: r.pageFrom, pageTo: r.pageTo, text: block.material };
      }).filter((c) => c.text.trim());
      if (!pieces.length) {
        const block = stPageBlock(text.pageTexts, from, to, maxChars);
        if (block.material.trim()) pieces.push({ pageFrom: from, pageTo: to, text: block.material });
      }
      chunks.push(...pieces);
    }
  }
  if (!chunks.length) {
    // Nothing readable (a blank or image-only stretch): mapped, with no concepts.
    if (section && section.id && markMapped && !cancelled()) await stMarkSectionMapped(section.id, stNow());
    return [];
  }

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
        if (prior.id && !matched.includes(prior)) matched.push(prior);
        if (prior.id && !_stConceptFlags.has(prior.id)) stRememberFlags(prior.id, raw);
        continue;
      }
      found.push({ title, summary, page, anchorQuote, flags: raw });
      pool.push({ id: 0, title });
    }
    report(i + 1, chunks.length);
  }

  // Each new concept goes under the section that owns its page.
  const baseSection = section ? section.id : 0;
  const bySection = new Map();
  for (const f of found) {
    const sid = typeof ownerOf === 'function' && !selectionText ? (Number(ownerOf(f.page)) || baseSection) : baseSection;
    if (!bySection.has(sid)) bySection.set(sid, []);
    bySection.get(sid).push(f);
  }
  const inserted = [];
  for (const [sid, list] of bySection) {
    const rows = await stInsertConcepts(material.id, sid, list.map(({ title, summary, page, anchorQuote }) => ({ title, summary, page, anchorQuote })));
    for (let i = 0; i < rows.length; i++) stRememberFlags(rows[i].id, list[i] && list[i].flags);
    inserted.push(...rows);
  }
  if (section && section.id && markMapped && !cancelled()) await stMarkSectionMapped(section.id, stNow());
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

/** The answer as text, for the support check. `q` is a validated StQuestion (stValidateQuestion). */
function stAnswerText(q) {
  switch (q.format) {
    case 'mc': return String((Array.isArray(q.options) ? q.options[Number(q.answer)] : '') || '');
    case 'numeric': {
      const n = q.numeric || {};
      return `${n.expected != null ? n.expected : q.answer}${n.units ? ` ${n.units}` : ''}`;
    }
    default: return String(q.answer || '');
  }
}

/** Shown only the quote, the stem and the answer: does the quote settle it? */
async function stCheckSupport(modelId, q, { material, numCtx } = {}) {
  const user = [
    'Quotation:',
    String(q.sourceQuote || ''),
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
      String(q.sourceQuote || ''),
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

/** The only import line a solution may carry (math is bound for it anyway). */
const ST_PY_IMPORT_MATH = /^\s*import\s+math\s*(?:#.*)?$/;
/** Words a calculation never needs: modules, introspection, I/O, control flow the vetting refuses. */
const ST_PY_FORBIDDEN = /(__|\b(?:open|exec|eval|compile|input|print|globals|locals|vars|getattr|setattr|delattr|hasattr|breakpoint|help|dir|type|object|lambda|while|with|try|except|finally|global|nonlocal|class|yield|async|await|del|assert|raise|os|sys|subprocess|socket|shutil|pathlib|json|codecs|ctypes|urllib|importlib|builtins|pickle|marshal|io)\b)/;

/**
 * A model-written solution is run in the user's environment, so it is held
 * to the shape the prompt asked for: a solve() over arithmetic and math,
 * nothing that reaches the file system, the network or the interpreter.
 * This is the first gate only; the script itself vets the solution's syntax
 * tree before running it (ST_NUMERIC_WRAPPER).
 */
function stNumericSolutionSafe(py) {
  const src = String(py || '');
  if (!/def\s+solve\s*\(/.test(src)) return { ok: false, reason: 'The solution does not define solve().' };
  if (src.length > 4000) return { ok: false, reason: 'The solution is too long to be a calculation.' };
  for (const line of src.split(/\r\n?|\n/)) {
    if (/\b(?:import|from)\b/.test(line) && !ST_PY_IMPORT_MATH.test(line)) {
      return { ok: false, reason: 'The solution imports a module other than math.' };
    }
  }
  if (ST_PY_FORBIDDEN.test(src)) return { ok: false, reason: 'The solution uses something a calculation does not need.' };
  return { ok: true, reason: '' };
}

/**
 * The check script. The solution arrives as a string (__SOURCE__) and the
 * inputs as JSON text (__INPUTS__), both JSON string literals, which Python
 * reads as string literals. Before anything runs, the solution's syntax
 * tree is vetted: one `def solve(i)` (a bare `import math` is allowed and
 * dropped), and inside it only assignments, augmented assignments, return,
 * if, and for over range() with constant bounds of at most 1000; numbers;
 * arithmetic, comparisons, boolean and conditional expressions; names
 * assigned in solve and its argument; `i["key"]`; math.<name> calls and
 * constants; calls to abs, min, max, round, sum, pow, float, int, len and
 * range; lists, tuples and comprehensions over range() only as call
 * arguments. Anything else (an import, an attribute on anything but math, a
 * dunder, a string outside a subscript, while, with, try, lambda, global,
 * any other call) is refused. The vetted tree is executed in a namespace
 * whose __builtins__ is exactly those functions and whose only other name
 * is math; the inputs are parsed before, json is not reachable from it, and
 * the one JSON result line is printed by the wrapper after.
 */
// (The imports are a string of their own: a part's line never starts with "import", studyBundle.test.ts.)
const ST_NUMERIC_WRAPPER = 'import ast\nimport json\nimport math\n' + `
SOURCE = __SOURCE__
INPUTS = __INPUTS__

ALLOWED_CALLS = {"abs", "min", "max", "round", "sum", "pow", "float", "int", "len", "range"}
SAFE_BUILTINS = {"abs": abs, "min": min, "max": max, "round": round, "sum": sum, "pow": pow, "float": float, "int": int, "len": len, "range": range}
MATH_CONSTANTS = {"pi", "e", "tau", "inf", "nan"}
BIN_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow)
UNARY_OPS = (ast.UAdd, ast.USub, ast.Not)
CMP_OPS = (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE)
MAX_RANGE = 1000


class Rejected(Exception):
    pass


def reject(why):
    raise Rejected(why)


def check_store(name):
    if name.startswith("_") or name == "math" or name in ALLOWED_CALLS:
        reject("assignment to " + name)


def const_int(node):
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -const_int(node.operand)
    if isinstance(node, ast.Constant) and type(node.value) is int:
        return node.value
    reject("range() bounds must be constant integers")


def is_range(node):
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "range"


def check_range(node):
    if not is_range(node) or node.keywords or not 1 <= len(node.args) <= 3:
        reject("loops run over range() only")
    for arg in node.args:
        if abs(const_int(arg)) > MAX_RANGE:
            reject("range() longer than 1000")


def check_expr(node, names, as_arg=False):
    if isinstance(node, ast.Constant):
        if type(node.value) in (int, float, bool):
            return
        reject("constant")
    if isinstance(node, ast.Name):
        if not isinstance(node.ctx, ast.Load) or node.id.startswith("_") or node.id not in names:
            reject("name " + node.id)
        return
    if isinstance(node, ast.BinOp):
        if not isinstance(node.op, BIN_OPS):
            reject("operator")
        check_expr(node.left, names)
        check_expr(node.right, names)
        return
    if isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, UNARY_OPS):
            reject("operator")
        check_expr(node.operand, names)
        return
    if isinstance(node, ast.BoolOp):
        for value in node.values:
            check_expr(value, names)
        return
    if isinstance(node, ast.Compare):
        if not all(isinstance(op, CMP_OPS) for op in node.ops):
            reject("comparison")
        check_expr(node.left, names)
        for value in node.comparators:
            check_expr(value, names)
        return
    if isinstance(node, ast.IfExp):
        check_expr(node.test, names)
        check_expr(node.body, names)
        check_expr(node.orelse, names)
        return
    if isinstance(node, ast.Subscript):
        key = node.slice
        if hasattr(ast, "Index") and isinstance(key, getattr(ast, "Index")):
            key = key.value
        if not (isinstance(node.ctx, ast.Load) and isinstance(node.value, ast.Name) and node.value.id == ARG):
            reject("subscript")
        if not (isinstance(key, ast.Constant) and type(key.value) is str):
            reject("subscript key")
        return
    if isinstance(node, ast.Attribute):
        if isinstance(node.ctx, ast.Load) and isinstance(node.value, ast.Name) and node.value.id == "math" and node.attr in MATH_CONSTANTS:
            return
        reject("attribute")
    if isinstance(node, ast.Call):
        check_call(node, names)
        return
    if as_arg and isinstance(node, (ast.List, ast.Tuple)) and isinstance(node.ctx, ast.Load):
        for elt in node.elts:
            check_expr(elt, names)
        return
    if as_arg and isinstance(node, (ast.ListComp, ast.GeneratorExp)):
        inner = set(names)
        for gen in node.generators:
            if getattr(gen, "is_async", 0) or not isinstance(gen.target, ast.Name):
                reject("comprehension")
            check_store(gen.target.id)
            check_range(gen.iter)
            inner.add(gen.target.id)
            for cond in gen.ifs:
                check_expr(cond, inner)
        check_expr(node.elt, inner)
        return
    reject(type(node).__name__)


def check_call(node, names):
    func = node.func
    if isinstance(func, ast.Attribute):
        if not (isinstance(func.value, ast.Name) and func.value.id == "math") or func.attr.startswith("_") or not hasattr(math, func.attr):
            reject("call")
    elif isinstance(func, ast.Name):
        if func.id not in ALLOWED_CALLS:
            reject("call " + func.id)
        if func.id == "range":
            check_range(node)
            return
    else:
        reject("call")
    for arg in node.args:
        check_expr(arg, names, True)
    for kw in node.keywords:
        if kw.arg is None:
            reject("keyword unpacking")
        check_expr(kw.value, names)


def check_target(node):
    if not isinstance(node, ast.Name):
        reject("assignment target")
    check_store(node.id)


def check_body(stmts, names, depth=0):
    if depth > 12:
        reject("nesting")
    for stmt in stmts:
        if isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                check_target(target)
            check_expr(stmt.value, names)
        elif isinstance(stmt, ast.AugAssign):
            check_target(stmt.target)
            if not isinstance(stmt.op, BIN_OPS):
                reject("operator")
            check_expr(stmt.value, names)
        elif isinstance(stmt, ast.Return):
            if stmt.value is None:
                reject("return without a value")
            check_expr(stmt.value, names)
        elif isinstance(stmt, ast.If):
            check_expr(stmt.test, names)
            check_body(stmt.body, names, depth + 1)
            check_body(stmt.orelse, names, depth + 1)
        elif isinstance(stmt, ast.For):
            check_target(stmt.target)
            check_range(stmt.iter)
            if stmt.orelse:
                reject("for-else")
            check_body(stmt.body, names, depth + 1)
        elif isinstance(stmt, ast.Pass):
            pass
        elif isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
            pass
        else:
            reject(type(stmt).__name__)


ARG = "i"


def vet(source):
    global ARG
    tree = ast.parse(source, mode="exec")
    functions = []
    for node in tree.body:
        if isinstance(node, ast.Import) and len(node.names) == 1 and node.names[0].name == "math" and node.names[0].asname is None:
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        if not isinstance(node, ast.FunctionDef):
            reject(type(node).__name__ + " outside solve()")
        functions.append(node)
    if len(functions) != 1 or functions[0].name != "solve":
        reject("exactly one def solve(i)")
    fn = functions[0]
    args = fn.args
    if fn.decorator_list or fn.returns or getattr(fn, "type_params", None) or args.vararg or args.kwarg or args.kwonlyargs or args.defaults or args.kw_defaults or getattr(args, "posonlyargs", []) or len(args.args) != 1 or args.args[0].annotation:
        reject("solve() takes one plain argument")
    ARG = args.args[0].arg
    check_store(ARG)
    names = {ARG}
    for node in ast.walk(fn):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            check_store(node.id)
            names.add(node.id)
    check_body(fn.body, names)
    module = ast.Module(body=[fn], type_ignores=[])
    return compile(module, "<solution>", "exec")


def main():
    try:
        inputs = json.loads(INPUTS)
        if not isinstance(inputs, dict):
            reject("inputs are not an object")
        code = vet(SOURCE)
    except Rejected as err:
        print(json.dumps({"error": "rejected: " + str(err)}))
        return
    except (SyntaxError, ValueError, TypeError, RecursionError) as err:
        print(json.dumps({"error": "rejected: " + type(err).__name__}))
        return
    namespace = {"__builtins__": dict(SAFE_BUILTINS), "math": math}
    try:
        exec(code, namespace)
        value = namespace["solve"](inputs)
        if isinstance(value, bool):
            raise TypeError("not a number")
        value = float(value)
        if not math.isfinite(value):
            raise ValueError("not finite")
    except Exception as err:
        print(json.dumps({"error": type(err).__name__}))
        return
    print(json.dumps({"value": value}))


main()
`;

/** The script for one numeric question: the wrapper with the solution and inputs filled in. */
function stNumericScript(numeric) {
  const inputs = numeric && numeric.inputs && typeof numeric.inputs === 'object' ? numeric.inputs : {};
  const source = String((numeric && numeric.solutionPy) || '').replace(/\r\n?/g, '\n');
  return ST_NUMERIC_WRAPPER
    .replace('__SOURCE__', () => JSON.stringify(source))
    .replace('__INPUTS__', () => JSON.stringify(JSON.stringify(inputs)));
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
/** The run's output directory, relative to the workspace (the bridge accepts any path inside it; without one it makes output/pyrun-N per run). */
const ST_NUMERIC_OUT_REL = '.parallx/tmp/study/out';

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
    Promise.resolve(py.runScript({ workspaceRoot, scriptPath, args: [], timeout, outDir: ST_NUMERIC_OUT_REL })).then((res) => {
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
    try { await fs.delete(stUriOf(`${rootSlash}/${ST_NUMERIC_OUT_REL}`)); } catch { /* best effort */ }
  }
  if (run.error && !run.stdout.trim()) return { available: true, agreed: false, computed: null, error: run.error };
  const lines = run.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let parsed = null;
  for (let i = lines.length - 1; i >= 0 && !parsed; i--) {
    try { const v = JSON.parse(lines[i]); if (v && typeof v === 'object') parsed = v; } catch { /* not the result line */ }
  }
  if (!parsed) return { available: true, agreed: false, computed: null, error: run.stderr.trim() ? 'The solution did not run cleanly.' : 'The solution printed no result.' };
  if (parsed.error) {
    const refused = /^rejected/.test(String(parsed.error));
    return { available: true, agreed: false, computed: null, error: refused ? 'The solution uses something a calculation does not need.' : 'The solution raised an error when run.' };
  }
  const computed = Number(parsed.value);
  if (!Number.isFinite(computed)) return { available: true, agreed: false, computed: null, error: 'The solution did not return a number.' };
  const tolerance = Number(numeric.tolerance) || Number(cfg('numericTolerance', 0.005)) || 0.005;
  const agreed = stNumericMatches(String(computed), numeric.expected, tolerance);
  return { available: true, agreed, computed, error: '' };
}

// ── Generation ──────────────────────────────────────────────────────────────

/**
 * A validated question (stValidateQuestion's StQuestion: sourceQuote,
 * sourcePage, numeric {inputs, solutionPy, expected, units}, a cloze's
 * aliases in options, an mc answer as an index) made ready to insert. The
 * checks read the same object, so there is one shape from validation on.
 */
function stFinalizeQuestion(q, { material, concept, modelId, runId, sourcePage, checks, numeric }) {
  return {
    ...q,
    materialId: material.id,
    conceptId: concept.id,
    numeric: numeric || q.numeric || null,
    sourcePage: Number(sourcePage) || Number(q.sourcePage) || 0,
    sourceUri: '',
    origin: 'generated',
    checks,
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
 * no call asks for more than ST_ASK_PER_CALL questions, and with
 * `maxConcepts` > 0 no call covers more concepts than that.
 */
function stGroupPlan(plan, maxConcepts = 0) {
  const sorted = [...plan].sort((a, b) => (a.concept.page - b.concept.page) || (a.concept.ord - b.concept.ord) || (a.concept.id - b.concept.id));
  const groups = [];
  let current = null;
  let currentAsk = 0;
  for (const slot of sorted) {
    const ask = Object.values(slot.need).reduce((n, v) => n + stAskCount(v), 0);
    const samePage = current && current[0].concept.page === slot.concept.page;
    const full = maxConcepts > 0 && current && current.length >= maxConcepts;
    if (!current || !samePage || full || currentAsk + ask > ST_ASK_PER_CALL) {
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
 * dropped when it fails. `maxGroups` > 0 makes at most that many model
 * calls (stEnsureBank visits units round-robin, one call each); `more` says
 * calls were left. `attempted` lists the concepts a call was made for.
 * Returns { kept, written, dropped, runId, needed, status, attempted, more }.
 */
async function stGenerateQuestions(material, {
  sectionId = 0, conceptIds = null, formats = null, perConcept = 0, choices = 0, modelId = '', numCtx = 0,
  token = null, onProgress = null, pythonAvailable = null, stopWhen = null,
  maxGroups = 0, maxConceptsPerCall = 0, quiet = false,
} = {}) {
  const cancelled = () => !!(token && token.cancelled);
  const wanted = Array.isArray(conceptIds) ? new Set(conceptIds.map(Number)) : null;
  const concepts = wanted
    ? (await stListConcepts({ materialIds: [material.id] })).filter((c) => wanted.has(c.id))
    : await stListConcepts({ sectionIds: [sectionId] });
  const empty = { kept: [], written: 0, dropped: {}, runId: 0, needed: 0, status: 'done', attempted: [], more: false };
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
  const groups = stGroupPlan(plan, Number(maxConceptsPerCall) || 0);
  const setting = stContextSettingFor(material, numCtx);
  const runId = await stStartRun({ materialId: material.id, sectionId, model, numCtx: setting });
  const dropped = { anchor: 0, support: 0, distractor: 0, numeric: python ? 0 : null, parse: 0 };
  const kept = [];
  let written = 0;
  let conceptsDone = 0;
  let status = 'done';
  let groupsDone = 0;
  let more = false;
  const attempted = [];
  const report = (phase, extra) => {
    const p = {
      phase, done: conceptsDone, total: plan.length, written, kept: kept.length, dropped,
      runId, materialId: material.id, sectionId, model, ...(extra || {}),
    };
    if (onProgress) { try { onProgress(p); } catch { /* listener error is not ours */ } }
    if (!quiet) { try { bus.emit('run', p); } catch { /* bus is optional here */ } }
  };
  const checkAnchor = cfg('checkAnchor', true) !== false;
  const checkSupport = cfg('checkSupport', true) !== false;
  const checkDistractors = cfg('checkDistractors', true) !== false;

  try {
    report('generate');
    for (const group of groups) {
      if (cancelled()) { status = 'stopped'; break; }
      if (maxGroups > 0 && groupsDone >= maxGroups) { more = true; break; }
      if (stopWhen && await stopWhen()) break;
      groupsDone += 1;
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
      for (const slot of group) attempted.push(slot.concept.id);
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
        const format = String(raw.format || '').trim().toLowerCase();
        if (!slot.need[format] || slot.need[format] <= 0) continue; // a format not asked for, or already filled
        const v = stValidateQuestion(raw, { choices: nChoices });
        if (!v || !v.ok || !v.question) { dropped.parse += 1; continue; }
        // From here on, only the validated StQuestion: sourceQuote, sourcePage,
        // numeric {...}, aliases in options. The raw model fields are gone.
        const q = v.question;
        const concept = slot.concept;
        const checks = { anchor: null, support: null, distractor: null, numeric: null };
        let sourcePage = Number(q.sourcePage) || concept.page || focus;

        // 1. Anchor: the quote must be on its page (mechanical).
        if (checkAnchor) {
          report('check:anchor', { concept: concept.title });
          const found = stAnchorPageFor(q.sourceQuote, text.pageTexts, sourcePage);
          if (!found) { dropped.anchor += 1; continue; }
          checks.anchor = true;
          sourcePage = found;
        }
        q.sourcePage = sourcePage;
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
          const n = q.numeric || {};
          numeric = {
            inputs: n.inputs && typeof n.inputs === 'object' ? n.inputs : {},
            solutionPy: String(n.solutionPy || ''),
            expected: n.expected,
            units: String(n.units || ''),
            tolerance: Number.isFinite(Number(n.tolerance)) && n.tolerance !== null ? Number(n.tolerance) : (Number(cfg('numericTolerance', 0.005)) || 0.005),
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
        groupKept.push(stFinalizeQuestion(q, { material, concept, modelId: model, runId, sourcePage, checks, numeric }));
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
  return { kept, written, dropped, runId, needed, status, attempted, more };
}

// ── Grading, explaining, rubrics ────────────────────────────────────────────

function stVerdictFor(statuses, rubric, { contradiction = false, note = '' } = {}) {
  const verdict = stNormalizeVerdict({ points: statuses.map((s) => ({ status: s, note: '' })), contradiction, note }, rubric);
  return { verdict, rating: stMapVerdictToRating(verdict, rubric), label: stVerdictLabel(verdict, rubric), rubric };
}

/**
 * Rubrics for multiple-choice questions answered by typing, per question
 * id. Never stored on the question: the mc row keeps its options and index,
 * and the next typed answer reuses this.
 */
const _stTypedRubrics = new Map();

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

  // An mc question answered by typing is marked against its correct
  // option's text, never against the stored index.
  let rubric = format === 'mc' ? [] : stNormalizeRubric(question.rubric);
  const reference = format === 'mc'
    ? String((Array.isArray(question.options) ? question.options[Number(question.answer)] : '') || '')
    : String(question.answer || '');
  if (format === 'formula') {
    if (!typed) return stVerdictFor(['miss'], [{ text: reference, required: true }], { note: 'Nothing written down.' });
    if (stFormulaMatches(typed, reference)) return stVerdictFor(['hit'], [{ text: reference, required: true }]);
    rubric = [{ text: reference, required: true }];
  }
  if (!rubric.length && reference && format === 'mc') {
    const cached = question.id ? _stTypedRubrics.get(question.id) : null;
    if (cached && cached.length) rubric = cached;
    else {
      const derived = await stRubricFromAnswer({ ...question, format: 'short', answer: reference, options: [] }, { modelId, numCtx });
      if (derived.length) {
        rubric = derived;
        if (question.id) _stTypedRubrics.set(question.id, derived);
      }
    }
  }
  if (!rubric.length && reference && format !== 'mc') {
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
  if (!rubric.length) throw new Error('This question has no reference answer, so it has been left out.');
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
  if (!raw) throw new Error('The model could not grade this answer. Try again, or open the full answer to compare.');
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

/** Selection concepts by selection text, for the life of the app; scope.conceptIds is the lasting copy. */
const _stSelectionConcepts = new Map();

function stSelectionKey(scope) {
  return `${(scope.materialIds || [])[0] || 0}:${stHashText(String(scope.selectionText || ''))}`;
}

/** The concept ids a selection scope was mapped to: the persisted scope.conceptIds, else this run's memory. */
function stSelectionConceptIds(scope) {
  const persisted = Array.isArray(scope && scope.conceptIds) ? scope.conceptIds.map(Number).filter((n) => n > 0) : [];
  if (persisted.length) return persisted;
  return _stSelectionConcepts.get(stSelectionKey(scope)) || [];
}

function stInRanges(page, ranges) {
  const p = Number(page) || 0;
  return ranges.some(([a, b]) => p >= a && p <= b);
}

/** A material's sections with their outline levels (st_sections has no level column; the stored outline has, in the same order). */
async function stSectionsWithLevels(material) {
  let sections = await stListSections(material.id);
  if (!sections.length) sections = await stEnsureSections(material.id, stNormalizeSections([], material.pageCount));
  const outline = Array.isArray(material.outline) ? material.outline : [];
  const aligned = outline.length === sections.length && outline.every((o, i) => o && String(o.title || '') === sections[i].title);
  return sections.map((s, i) => ({ ...s, level: aligned ? Number(outline[i].level) || 0 : 0 }));
}

/**
 * The mapping units of one material: each section with the pages it owns
 * (stPagePartition: a page belongs to the deepest section holding it),
 * clipped to [pageFrom, pageTo] when given. `partial` marks a unit clipped
 * short of what its section owns; `ownerOf(page)` gives any page's section.
 */
async function stMaterialUnits(material, { pageFrom = 0, pageTo = 0 } = {}) {
  const sections = await stSectionsWithLevels(material);
  const runs = stPagePartition(sections, material.pageCount || 0);
  const owner = new Map();
  for (const r of runs) for (let p = r.pageFrom; p <= r.pageTo; p++) owner.set(p, sections[r.index].id);
  const ownerOf = (page) => owner.get(Math.floor(Number(page) || 0)) || 0;
  const units = new Map();
  for (const r of runs) {
    const from = pageFrom ? Math.max(r.pageFrom, pageFrom) : r.pageFrom;
    const to = pageTo ? Math.min(r.pageTo, pageTo) : r.pageTo;
    const section = sections[r.index];
    if (!units.has(section.id)) units.set(section.id, { material, section, ranges: [], owned: 0, covered: 0, ownerOf });
    const u = units.get(section.id);
    u.owned += r.pageTo - r.pageFrom + 1;
    if (from > to) continue;
    u.ranges.push([from, to]);
    u.covered += to - from + 1;
  }
  return [...units.values()]
    .filter((u) => u.ranges.length)
    .map((u) => ({ ...u, partial: u.covered < u.owned }))
    .sort((a, b) => a.ranges[0][0] - b.ranges[0][0]);
}

/**
 * The units a scope covers, per material: [{ material, units }]. A
 * selection is its own unit; a chapter is the units inside its page range,
 * so a parent chapter takes its subsections' pages.
 */
async function stScopeUnits(scope) {
  const kind = scope && scope.kind;
  const materialIds = Array.isArray(scope && scope.materialIds) ? scope.materialIds : [];
  const out = [];
  if (kind === 'selection') {
    const material = await stGetMaterial(materialIds[0]);
    if (material) out.push({ material, units: [{ material, section: null, selection: true, selectionText: String(scope.selectionText || ''), selectionPage: Number(scope.selectionPage) || 0, ranges: [] }] });
    return out;
  }
  if (kind === 'chapter') {
    const byMaterial = new Map();
    for (const sid of Array.isArray(scope.sectionIds) ? scope.sectionIds : []) {
      const section = await stGetSection(sid);
      if (!section) continue;
      const material = await stGetMaterial(section.materialId);
      if (!material) continue;
      if (!byMaterial.has(material.id)) byMaterial.set(material.id, { material, units: new Map() });
      const entry = byMaterial.get(material.id);
      for (const u of await stMaterialUnits(material, { pageFrom: section.pageFrom, pageTo: section.pageTo })) {
        const prior = entry.units.get(u.section.id);
        if (!prior) { entry.units.set(u.section.id, u); continue; }
        prior.ranges.push(...u.ranges.filter(([a, b]) => !prior.ranges.some(([c, d]) => c === a && d === b)));
        prior.covered = prior.ranges.reduce((n, [a, b]) => n + b - a + 1, 0);
        prior.partial = prior.covered < prior.owned;
      }
    }
    for (const { material, units } of byMaterial.values()) out.push({ material, units: [...units.values()] });
    return out;
  }
  if (kind === 'document' || kind === 'materials' || kind === 'pages') {
    for (const mid of materialIds) {
      const material = await stGetMaterial(mid);
      if (!material) continue;
      const clip = kind === 'pages' ? { pageFrom: Number(scope.pageFrom) || 1, pageTo: Number(scope.pageTo) || Number(scope.pageFrom) || 1 } : {};
      out.push({ material, units: await stMaterialUnits(material, clip) });
    }
  }
  return out;
}

/** The concepts a scope draws from. `ensured` is a prior stEnsureBank result. */
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
    const ids = stSelectionConceptIds(scope);
    if (!ids.length) return ensured && Array.isArray(ensured.concepts) ? ensured.concepts : [];
    const set = new Set(ids);
    return (await stListConcepts({ materialIds: [materialIds[0]] })).filter((c) => set.has(c.id));
  }
  if (kind === 'chapter') return stConceptsForSections(Array.isArray(scope.sectionIds) ? scope.sectionIds : []);
  const all = await stListConcepts({ materialIds });
  if (kind === 'pages') {
    const from = Number(scope.pageFrom) || 1;
    const to = Number(scope.pageTo) || from;
    return all.filter((c) => c.page >= from && c.page <= to);
  }
  return all;
}

/** A stand-in concept for a question whose concept row is missing. */
function stPseudoConcept(id = 0) {
  return { id, materialId: 0, sectionId: 0, title: 'Question', summary: '', page: 0, anchorQuote: '', ord: 0, mastery: 0, answers: 0, misses: 0, missStreak: 0, rightChooseAt: 0, rightTypeAt: 0, lastAnsweredAt: 0 };
}

/**
 * Concepts and usable questions for a scope: not hidden and answerable
 * (stQuestionAnswerable); `unanswerable` counts the rest. A bank scope
 * draws the banks' questions; with `materialize`, a bank question without
 * a concept gets its own first (stEnsureBankConcepts).
 */
async function stScopePool(scope, { materialize = false, ensured = null } = {}) {
  if (scope && scope.kind === 'bank') {
    const all = await stListQuestions({ bankIds: Array.isArray(scope.bankIds) ? scope.bankIds : [] });
    const questions = all.filter(stQuestionAnswerable);
    if (materialize) await stEnsureBankConcepts(questions);
    const ids = [...new Set(questions.map((q) => q.conceptId).filter((id) => id > 0))];
    const concepts = ids.length ? await stListConcepts({ ids }) : [];
    return { concepts, questions, unanswerable: all.length - questions.length };
  }
  const concepts = await stScopeConcepts(scope, ensured);
  const all = concepts.length ? await stListQuestions({ conceptIds: concepts.map((c) => c.id) }) : [];
  const questions = all.filter(stQuestionAnswerable);
  return { concepts, questions, unanswerable: all.length - questions.length };
}

/** Does a drawn question still need a rubric made from its answer? */
function stNeedsAnswerRubric(q) {
  return (q.format === 'short' || q.format === 'essay') && !stNormalizeRubric(q.rubric).length && !!String(q.answer || '').trim();
}

/**
 * What a scope holds now: `available` usable questions (the same pool as
 * stNextDraw), `unanswerable` ones left out (no answer and no rubric), and
 * `needsRubric`, the short and essay ones whose rubric is made from the
 * answer when first drawn.
 */
async function stScopeStats(scope) {
  const pool = await stScopePool(scope || {});
  return {
    available: pool.questions.length,
    unanswerable: pool.unanswerable,
    needsRubric: pool.questions.filter(stNeedsAnswerRubric).length,
  };
}

/** The number of usable (non-hidden, answerable) questions in a scope, for stSessionNeedsGeneration. */
async function stScopeQuestionCount(scope) {
  return (await stScopeStats(scope)).available;
}

// ── Orchestration ───────────────────────────────────────────────────────────

/** dropped counts added key by key; numeric stays null (Python missing) when either side says so. */
function stAddDropped(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v === null || out[k] === null) { out[k] = null; continue; }
    out[k] = (Number(out[k]) || 0) + (Number(v) || 0);
  }
  return out;
}

/**
 * Make sure a scope has questions. Units (a section's own pages, a
 * selection, a material's weak concepts) are visited round-robin across
 * materials and, within a material, across its units in an order spread
 * over the document (stSpreadOrder): each visit maps the unit if it is not
 * mapped yet, then makes one generation call for it. So the first questions
 * already span the scope, and a long PDF is mapped only as far as needed.
 * With `untilSize`, the run stops once `size` usable questions exist in
 * the scope (the Start With N Ready path), one concept per call; without,
 * it goes on until every concept has questionsPerConcept of each format
 * (or failed ST_MAX_PASSES times). A bank scope has nothing to generate.
 *
 * Progress payloads: { phase, done, total, written, kept, dropped,
 * available, unanswerable, unitsDone, unitsTotal, sessionId, materialId,
 * sectionId, concept?, runId?, model? }. `kept`, `written` and `dropped`
 * count this run; `available` is every usable question in the scope now;
 * done/total never go back: with untilSize, available (capped) of size,
 * else units finished of units. Phases: map, generate, check:<key>, done,
 * stopped, failed.
 *
 * A selection's concept ids are written into the session's scope
 * (scope.conceptIds) when `sessionId` is given, so a restart draws from
 * them without mapping again. Returns { kept, concepts, available,
 * unanswerable, numericUnavailable }.
 */
async function stEnsureBank(scope, { size = 0, modelId = '', numCtx = 0, token = null, onProgress = null, untilSize = false, sessionId = null } = {}) {
  const cancelled = () => !!(token && token.cancelled);
  const result = { kept: 0, concepts: [], available: 0, unanswerable: 0, numericUnavailable: false };
  if (!scope) return result;
  const base = await stScopeStats(scope);
  result.available = base.available;
  result.unanswerable = base.unanswerable;
  if (scope.kind === 'bank') return result;
  const target = untilSize && Number(size) > 0 ? Number(size) : 0;
  if (target && result.available >= target) return result;

  const checkNumeric = cfg('checkNumeric', true) !== false;
  const pythonAvailable = checkNumeric ? await stPythonAvailable() : false;
  result.numericUnavailable = checkNumeric && !pythonAvailable;
  const perConcept = Math.max(1, Number(cfg('questionsPerConcept', 2)) || 2);
  const choices = Number(cfg('choices', 4)) === 5 ? 5 : 4;

  const run = {
    written: 0, kept: 0, unitsDone: 0, unitsTotal: 0,
    dropped: { anchor: 0, support: 0, distractor: 0, numeric: result.numericUnavailable ? null : 0, parse: 0 },
  };
  const emit = (phase, inner = null, unit = null) => {
    const innerKept = inner ? Number(inner.kept) || 0 : 0;
    const available = result.available + innerKept;
    const p = {
      phase,
      done: target ? Math.min(available, target) : run.unitsDone,
      total: target || run.unitsTotal,
      written: run.written + (inner ? Number(inner.written) || 0 : 0),
      kept: run.kept + innerKept,
      dropped: stAddDropped(run.dropped, inner && inner.dropped),
      available,
      unanswerable: result.unanswerable,
      unitsDone: run.unitsDone,
      unitsTotal: run.unitsTotal,
      sessionId: sessionId == null ? null : sessionId,
      materialId: inner && inner.materialId != null ? inner.materialId : unit ? unit.material.id : null,
      sectionId: inner && inner.sectionId != null ? inner.sectionId : unit && unit.section ? unit.section.id : 0,
    };
    if (inner) for (const k of ['concept', 'runId', 'model', 'error']) if (inner[k] != null) p[k] = inner[k];
    if (onProgress) { try { onProgress(p); } catch { /* listener error is not ours */ } }
    try { bus.emit('run', p); } catch { /* bus is optional here */ }
  };
  const innerFor = (unit) => (p) => {
    const phase = p && (p.phase === 'done' || p.phase === 'stopped') ? 'generate' : (p && p.phase) || 'generate';
    // A map call's done/total are chunks, not this run's: the payload keeps the run's.
    emit(phase, p && p.phase === 'map' ? { ...p, kept: 0, written: 0, dropped: {} } : p, unit);
  };

  // The units, per material.
  const queues = [];
  if (scope.kind === 'weak') {
    const byMaterial = new Map();
    for (const c of await stScopeConcepts(scope)) {
      if (!byMaterial.has(c.materialId)) byMaterial.set(c.materialId, []);
      byMaterial.get(c.materialId).push(c);
    }
    for (const [mid, list] of byMaterial) {
      const material = await stGetMaterial(mid);
      if (material && material.kind !== 'bank') queues.push({ material, cursor: 0, units: [{ material, section: null, concepts: list, mapped: true, ranges: [] }] });
    }
  } else {
    for (const { material, units } of await stScopeUnits(scope)) {
      if (!units.length) continue;
      const ordered = stSpreadOrder(units.length).map((i) => units[i]);
      for (const u of ordered) {
        if (u.selection) u.mapped = stSelectionConceptIds(scope).length > 0;
        else if (u.section.mappedAt > 0) u.mapped = true;
        else if (u.partial) {
          // A clipped unit counts as mapped once its pages have concepts.
          const known = await stListConcepts({ materialIds: [material.id] });
          u.mapped = known.some((c) => stInRanges(c.page, u.ranges));
        } else u.mapped = false;
      }
      queues.push({ material, cursor: 0, units: ordered });
    }
  }
  run.unitsTotal = queues.reduce((n, q) => n + q.units.length, 0);

  const models = new Map();
  const modelFor = async (material) => {
    if (!models.has(material.id)) models.set(material.id, modelId || await stPickModel(material));
    const m = models.get(material.id);
    if (!m) throw new Error('No model is available. Pick a model in Settings or start the model backend.');
    return m;
  };
  const attempts = new Map();
  const touched = new Map();
  const finish = (unit) => {
    if (unit.done) return;
    unit.done = true;
    if (!unit.counted) { unit.counted = true; run.unitsDone += 1; }
  };

  const visit = async (unit) => {
    const material = unit.material;
    const model = await modelFor(material);
    // 1. Map the unit when it has not been mapped.
    if (!unit.mapped) {
      if (unit.selection) {
        const concepts = await stBuildConceptMap(material, null, {
          modelId: model, numCtx, token, onProgress: innerFor(unit), quiet: true,
          selectionText: unit.selectionText, selectionPage: unit.selectionPage,
        });
        const ids = concepts.map((c) => c.id).filter((id) => id > 0);
        _stSelectionConcepts.set(stSelectionKey(scope), ids);
        scope.conceptIds = ids;
        if (sessionId != null && ids.length) {
          const s = await stGetSession(sessionId);
          if (s) await stUpdateSession(sessionId, { scope: { ...(s.scope || {}), conceptIds: ids } });
        }
      } else {
        await stBuildConceptMap(material, unit.section, {
          modelId: model, numCtx, token, onProgress: innerFor(unit), quiet: true,
          ranges: unit.ranges, ownerOf: unit.ownerOf, markMapped: !unit.partial,
        });
      }
      if (cancelled()) return;
      unit.mapped = true;
    }
    // 2. One generation call for the unit's concepts.
    let concepts;
    if (unit.concepts) concepts = unit.concepts;
    else if (unit.selection) {
      const set = new Set(stSelectionConceptIds(scope));
      concepts = (await stListConcepts({ materialIds: [material.id] })).filter((c) => set.has(c.id));
    } else {
      concepts = (await stListConcepts({ materialIds: [material.id] })).filter((c) => stInRanges(c.page, unit.ranges));
    }
    for (const c of concepts) touched.set(c.id, c);
    const eligible = concepts.filter((c) => (attempts.get(c.id) || 0) < ST_MAX_PASSES);
    if (!eligible.length) { finish(unit); return; }
    const gen = await stGenerateQuestions(material, {
      sectionId: unit.section ? unit.section.id : 0,
      conceptIds: eligible.map((c) => c.id),
      perConcept: sweepPer, choices, modelId: model, numCtx, token, onProgress: innerFor(unit), pythonAvailable,
      maxGroups: 1, maxConceptsPerCall: target ? 1 : 0, quiet: true,
    });
    run.written += Number(gen.written) || 0;
    run.kept += gen.kept.length;
    result.available += gen.kept.length;
    run.dropped = stAddDropped(run.dropped, gen.dropped);
    for (const id of gen.attempted || []) attempts.set(id, (attempts.get(id) || 0) + 1);
    if (!gen.needed || (!(gen.attempted || []).length && gen.status !== 'stopped')) finish(unit);
  };

  // With a target, a first sweep asks one question of each format per
  // concept, so the first `size` questions come from many units; the
  // second fills each concept up to questionsPerConcept.
  const sweeps = target && perConcept > 1 ? [1, perConcept] : [perConcept];
  let sweepPer = sweeps[0];
  for (let sweep = 0; sweep < sweeps.length; sweep++) {
    sweepPer = sweeps[sweep];
    if (sweep > 0) {
      attempts.clear();
      for (const q of queues) { q.cursor = 0; for (const u of q.units) u.done = false; }
    }
    let turn = 0;
    for (;;) {
      if (cancelled()) break;
      if (target && result.available >= target) break;
      const live = queues.filter((q) => q.units.some((u) => !u.done));
      if (!live.length) break;
      const queue = live[turn % live.length];
      turn += 1;
      const n = queue.units.length;
      let unit = null;
      for (let k = 0; k < n; k++) {
        const u = queue.units[(queue.cursor + k) % n];
        if (!u.done) { unit = u; queue.cursor = (queue.cursor + k + 1) % n; break; }
      }
      if (!unit) continue;
      await visit(unit);
      emit('generate', null, unit);
    }
    if (cancelled() || (target && result.available >= target)) break;
  }
  result.kept = run.kept;
  result.concepts = [...touched.values()];
  emit(cancelled() ? 'stopped' : 'done');
  return result;
}

/**
 * Rubrics for the drawn short and essay questions that have an answer and
 * no rubric (bank questions), made from the answer and stored with
 * rubric_origin 'answer', before the session shows them.
 */
async function stDeriveDrawRubrics(draw, session, { token = null, onProgress = null } = {}) {
  const todo = draw.filter(stNeedsAnswerRubric);
  for (let k = 0; k < todo.length; k++) {
    if (token && token.cancelled) return;
    const q = todo[k];
    const p = { phase: 'rubric', rubricsDone: k, rubricsTotal: todo.length, sessionId: session.id };
    if (onProgress) { try { onProgress(p); } catch { /* listener error is not ours */ } }
    const rubric = await stRubricFromAnswer(q, { modelId: session.model, numCtx: session.numCtx });
    if (!rubric.length) continue;
    q.rubric = rubric;
    q.rubricOrigin = 'answer';
    try { await stUpdateQuestion(q); } catch { /* grading derives it again */ }
  }
}

/**
 * The next draw for a session: top the bank up when fewer than `size`
 * unseen questions remain (never for a bank scope: there is nothing to
 * generate from), draw with stDrawSession excluding everything the session
 * already holds, give bank questions their concepts and rubrics, and record
 * the items. Returns the questions in order (empty when the scope has
 * nothing left or the run was stopped); `unanswerable` on the array counts
 * the questions left out for having neither answer nor rubric.
 */
async function stNextDraw(session, { token = null, onProgress = null } = {}) {
  const scope = session.scope || {};
  const items = await stListSessionItems(session.id);
  const exclude = new Set(items.map((i) => i.questionId));
  const size = Number(session.size) || Number(cfg('sessionSize', 20)) || 20;
  const materialize = scope.kind === 'bank';
  let pool = await stScopePool(scope, { materialize });
  let candidates = pool.questions.filter((q) => !exclude.has(q.id));
  if (candidates.length < size && scope.kind !== 'bank') {
    const ensured = await stEnsureBank(scope, {
      size: size + exclude.size, modelId: session.model, numCtx: session.numCtx, token, onProgress, untilSize: true, sessionId: session.id,
    });
    pool = await stScopePool(scope, { materialize, ensured });
    candidates = pool.questions.filter((q) => !exclude.has(q.id));
  }
  const empty = () => Object.assign([], { unanswerable: pool.unanswerable });
  if (token && token.cancelled) return empty();
  if (!candidates.length) return empty();
  const conceptById = new Map(pool.concepts.map((c) => [c.id, c]));
  const draw = stDrawSession({
    questions: pool.questions, concepts: pool.concepts, size, exclude,
    answerFormat: session.answerFormat, now: stNow(), rng: Math.random,
    staleDays: Number(cfg('staleDays', 14)) || 14,
  }) || [];
  if (!draw.length) return empty();
  await stDeriveDrawRubrics(draw, session, { token, onProgress });
  const formats = draw.map((q) => stResolveFormat(conceptById.get(q.conceptId) || stPseudoConcept(q.conceptId), q, session.answerFormat));
  await stAddSessionItems(session.id, Number(session.refreshes) || 0, draw.map((q) => q.id), formats);
  return Object.assign(draw, { unanswerable: pool.unanswerable });
}
