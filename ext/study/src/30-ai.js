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
