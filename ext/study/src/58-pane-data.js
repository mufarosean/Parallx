// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 58: WHAT THE PANE READS — rows, scopes, counts and Test marking
// ═══════════════════════════════════════════════════════════════════════════════
//
// The editor pane's helpers that draw nothing: reading a row whichever shape
// it comes in, the questions and concepts a session needs, the sheet's
// counts, and the background marking of a Test. Moved out of 60-pane.js so
// the screens stay in one file a person can read.

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
    // As stConceptsForSections: filed under the chapter, or on its pages (a
    // parent chapter so includes its subsections' concepts).
    const mids = Array.isArray(scope.materialIds) ? scope.materialIds : [];
    const from = Number(scope.pageFrom) || 0, to = Number(scope.pageTo) || from;
    return list.filter((c) => scope.sectionIds.includes(c.sectionId)
      || (from && c.page >= from && c.page <= to && (!mids.length || mids.includes(c.materialId))));
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

/** The concepts a session's screens need: the scope's materials' concepts
 *  plus every concept its questions point at that lies outside them (a
 *  bank's concepts live under a hidden material stListMaterials leaves out). */
async function stSessionConcepts(materialIds, questions) {
  const list = materialIds && materialIds.length ? ((await stListConcepts({ materialIds })) || []) : [];
  const have = new Set(list.map((c) => c.id));
  const missing = [...new Set([...(questions ? questions.values() : [])].map((q) => Number(q && q.conceptId) || 0))].filter((id) => id > 0 && !have.has(id));
  if (missing.length) list.push(...(((await stListConcepts({ ids: missing })) || []).filter((c) => !have.has(c.id))));
  return list;
}

function stFmtK(n) {
  const v = Number(n) || 0;
  if (!v) return '';
  return v >= 1024 ? `${Math.round(v / 1024)}K` : String(v);
}

/** An error's message as text. */
function stErrText(err) {
  return String(err && err.message ? err.message : (err || 'Unknown error'));
}

/** Text as a sentence: a period added only when it has no closing mark. */
function stSentence(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return /[.!?…:]$/.test(t) ? t : `${t}.`;
}

/** True once an item has an answer in, marked or not (Test's 'answered'). */
function stItemAnswered(item) {
  const s = item && item.status;
  return s === 'right' || s === 'wrong' || s === 'answered';
}

/** A multiple-choice question answered as typed (Test): the right option is
 *  the reference answer and, without a rubric, the one point to hit. A copy
 *  with id 0, so grading never writes a derived rubric back onto it. */
function stTestQuestion(q) {
  if (!q || q.format !== 'mc') return q;
  const options = Array.isArray(q.options) ? q.options : [];
  const answer = String(options[Number(q.answer)] !== undefined ? options[Number(q.answer)] : (q.answer ?? ''));
  const rubric = Array.isArray(q.rubric) && q.rubric.length ? q.rubric : [{ text: answer, required: true }];
  return { ...q, id: 0, format: 'short', answer, rubric };
}

/** Grade a typed answer. stGradeTyped grades numeric, cloze and formula
 *  answers mechanically and the rest against the rubric; it returns the
 *  rubric it marked against, which is the one the points are drawn from. */
async function stGradeTypedResult(q, text, { modelId = '', numCtx = 0 } = {}) {
  const g = await stGradeTyped(stTestQuestion(q), text, { modelId, numCtx });
  const rubric = Array.isArray(g && g.rubric) && g.rubric.length ? g.rubric : (Array.isArray(q.rubric) ? q.rubric : []);
  const rating = g && g.rating != null ? Number(g.rating) : AGAIN;
  const verdict = g && g.verdict ? g.verdict : null;
  const label = (g && g.label) || (verdict ? stVerdictLabel(verdict, rubric) : (rating >= GOOD ? 'Correct' : 'Not quite'));
  return { rating, verdict, label, rubric };
}

/** The verdict as stored on the item: the points plus the rubric they were
 *  marked against, the label and the rating, so review shows it as marked. */
function stStoredVerdict(result) {
  if (!result || !result.verdict) return null;
  return { ...result.verdict, rubric: result.rubric, label: result.label, rating: result.rating };
}

// Test marking runs in the background, one answer at a time (a local model
// grades better without a queue of parallel calls). Per session: the chain
// and the promise of every item still being marked, so the results screen
// can wait for exactly those. Module state, so a pane rebuild loses nothing.
const _stGrades = new Map(); // sessionId → { chain, pending: Map<itemId, Promise> }

function stGradeStateFor(sessionId) {
  let g = _stGrades.get(sessionId);
  if (!g) { g = { chain: Promise.resolve(), pending: new Map() }; _stGrades.set(sessionId, g); }
  return g;
}

/** The marking promises still open for a session. */
function stPendingGrades(sessionId) {
  const g = _stGrades.get(sessionId);
  return g ? [...g.pending.values()] : [];
}

/** Queue one Test answer for marking; returns its promise (never rejects). */
function stQueueTestGrade(sessionId, item, q, { modelId = '', numCtx = 0 } = {}) {
  const g = stGradeStateFor(sessionId);
  if (g.pending.has(item.id)) return g.pending.get(item.id);
  const token = stActivation();
  const job = g.chain
    .then(() => stMarkTestAnswer(sessionId, item, q, { modelId, numCtx, token }))
    .catch((err) => { if (stIsCurrent(token) && !stIsStopped(err)) console.warn('[Study] marking failed:', err); });
  g.chain = job;
  g.pending.set(item.id, job);
  void job.then(() => {
    g.pending.delete(item.id);
    if (!g.pending.size && _stGrades.get(sessionId) === g) _stGrades.delete(sessionId);
  });
  return job;
}

/** Mark one recorded Test answer and write it back as Practice would have. */
async function stMarkTestAnswer(sessionId, item, q, { modelId, numCtx, token = stActivation() }) {
  // Each wait may end with Study turned off (or off and on again): then the
  // answer stays as recorded and the next results screen marks it.
  const live = () => stIsCurrent(token);
  if (!live()) return;
  const typed = String(item.typed || '');
  let result;
  try {
    result = await stGradeTypedResult(q, typed, { modelId, numCtx });
  } catch (err) {
    if (!live()) return;
    // Not counted either way: skipped, with the reason kept for review.
    await stAnswerItem(item.id, { status: 'skipped', verdict: { note: `Could not mark this answer: ${stSentence(stErrText(err))}`, ungraded: true } }, stNow());
    item.status = 'skipped';
    bus.emit('session', { sessionId, itemId: item.id, status: 'skipped' });
    return;
  }
  if (!live()) return;
  const ok = result.rating >= GOOD;
  const status = ok ? 'right' : 'wrong';
  const now = stNow();
  const fmt = item.formatUsed || 'short';
  await stAnswerItem(item.id, { status, verdict: stStoredVerdict(result) }, now);
  if (!live()) return;
  await stLogAnswer({ questionId: q.id, conceptId: q.conceptId, sessionId, formatUsed: fmt, correct: ok ? 1 : 0, rating: result.rating, retried: 0 }, now);
  const concept = Number(q.conceptId) > 0 ? await stGetConcept(q.conceptId) : null;
  if (!live()) return;
  if (concept) await stUpdateConcept(stApplyAnswer(concept, { correct: ok, rating: result.rating, formatUsed: fmt, retried: 0 }, now));
  item.status = status;
  bus.emit('session', { sessionId, itemId: item.id, status });
}

/** Results of a Test: queue every recorded answer not yet marked and not in
 *  the queue (the app closed mid-marking). Returns the open promises. */
function stEnsureTestGrades(sessionId, items, questions, opts) {
  const g = _stGrades.get(sessionId);
  for (const it of items || []) {
    if (it.status !== 'answered') continue;
    if (g && g.pending.has(it.id)) continue;
    const q = questions.get(it.questionId);
    if (q) stQueueTestGrade(sessionId, it, q, opts);
  }
  return stPendingGrades(sessionId);
}

/** Usable questions in a scope: the pipeline's count when it is there, else
 *  the scope's materials' questions filtered by the scope (the same rule as
 *  stSessionNeedsGeneration, so the sheet and the start agree). */
async function stCountScopeQuestions(scope) {
  try {
    if (typeof stScopeQuestionCount === 'function') return Number(await stScopeQuestionCount(scope)) || 0;
  } catch { /* fall through */ }
  try {
    if (scope && scope.kind === 'bank') return ((await stFixedScopeQuestions(scope)) || []).filter((q) => !q.hidden).length;
    const materialIds = Array.isArray(scope && scope.materialIds) ? scope.materialIds : [];
    const [questions, concepts] = await Promise.all([
      stListQuestions({ materialIds }),
      materialIds.length ? stListConcepts({ materialIds }) : Promise.resolve([]),
    ]);
    return stQuestionsInScope(questions || [], concepts || [], scope, stNow(), Number(cfg('staleDays', 14)) || 14).length;
  } catch { return 0; }
}

/** What the sheet's one count line says: concepts, how many clean, and the questions in the bank or still to make. */
function stSetupCountText({ mode, concepts, clean, questions, size }) {
  const prefix = concepts ? `${concepts} ${concepts === 1 ? 'concept' : 'concepts'}, ${clean} clean` : '';
  if (mode === 'learn') return prefix || 'No concepts yet; Learn maps them first.';
  const join = (rest) => (prefix ? `${prefix} · ${rest}` : rest);
  if (questions >= size) return join(`${questions} questions in the bank`);
  if (questions > 0) return join(`${questions} questions in the bank, ${size - questions} more will be made first`);
  return prefix ? `${prefix} · no questions yet, ${size} will be made first` : `No questions yet, ${size} will be made first.`;
}

/** Where a bank's questions came from, in a few words. */
function stBankOriginText(bank, questions) {
  if (bank && bank.kind === 'report') return "examiner's report";
  if (bank && bank.kind === 'provider') return 'from another tool';
  if (bank && bank.kind === 'subject') return 'from its Questions database';
  const counts = new Map();
  for (const q of questions || []) counts.set(q.origin, (counts.get(q.origin) || 0) + 1);
  let top = '', n = -1;
  for (const [k, v] of counts) if (v > n) { top = k; n = v; }
  if (top === 'exam') return bank && bank.exam ? `${bank.exam}${bank.sitting ? ` ${bank.sitting}` : ''}` : 'past exams';
  if (top === 'rising-fellow') return 'Rising Fellow';
  return 'imported';
}

/** The models api.lm offers and the chat's active one. */
async function stSheetModels() {
  let models = [];
  let activeModel = '';
  if (_api.lm) {
    try { models = (await _api.lm.getModels()) || []; } catch { models = []; }
    try { activeModel = typeof _api.lm.getActiveModel === 'function' ? (_api.lm.getActiveModel() || '') : ''; } catch { activeModel = ''; }
  }
  return { models, activeModel };
}
