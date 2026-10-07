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
/** Retry timers of the registrations that wait for another tool's command;
 *  deactivate clears them so nothing fires for a Study that is off. */
const _stRetryTimers = new Set();

/** Run `fn` after `ms` unless Study is turned off first, or turned off and
 *  on again (`token`, default the activation now): then nothing runs. */
function stRetryLater(fn, ms, token = stActivation()) {
  const timer = setTimeout(() => {
    _stRetryTimers.delete(timer);
    if (!stIsCurrent(token)) return;
    fn();
  }, ms);
  _stRetryTimers.add(timer);
  return timer;
}

/** Clear every pending retry (deactivate). */
function stClearRetryTimers() {
  for (const t of _stRetryTimers) clearTimeout(t);
  _stRetryTimers.clear();
}

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

/** True for a question that came from a bank (an import, a past exam, a provider). */
function stIsBankQuestion(q) {
  return !!q && (Number(q.bankId) > 0 || (!!q.origin && q.origin !== 'generated'));
}

/** A bank question's answer as card text: the right option for a choice. */
function stQuestionAnswerText(q) {
  if (q && q.format === 'mc') {
    const options = Array.isArray(q.options) ? q.options : [];
    const i = Number(q.answer);
    if (options[i] !== undefined) return String(options[i]);
  }
  return String(q?.answer ?? '');
}

/**
 * Pure: the cards Send Missed makes. One card per missed concept, grouped by
 * material so each group lands in the deck "Study: <material label>"; a
 * missed bank question is its own card (front the stem, back the answer,
 * tagged study:q:<id>) in the deck "Study: <bank name>".
 * `summary` is stSessionSummary's result ({ missed: [{ conceptId, questionId }] }).
 */
function stCardsForMissed(summary, concepts, questions, materials, banks = []) {
  const conceptById = new Map((concepts || []).map((c) => [Number(c.id), c]));
  const questionById = new Map((questions || []).map((q) => [Number(q.id), q]));
  const materialById = new Map((materials || []).map((m) => [Number(m.id), m]));
  const bankById = new Map((banks || []).map((b) => [Number(b.id), b]));
  const seen = new Set();
  const seenQuestions = new Set();
  const groups = new Map();
  for (const miss of summary?.missed || []) {
    const missedQ = questionById.get(Number(miss.questionId)) || null;
    if (stIsBankQuestion(missedQ)) {
      if (seenQuestions.has(Number(missedQ.id))) continue;
      seenQuestions.add(Number(missedQ.id));
      const bank = bankById.get(Number(missedQ.bankId)) || null;
      const label = String(bank?.name || missedQ.originLabel || 'Question bank');
      const card = {
        front: String(missedQ.stem || ''),
        back: stQuestionAnswerText(missedQ),
        tags: ['study', `study:q:${Number(missedQ.id)}`],
        sourceUri: String(missedQ.sourceUri || ''),
        sourceLabel: label,
        sourcePage: Number(missedQ.sourcePage) > 0 ? Number(missedQ.sourcePage) : 0,
        sourceExcerpt: String(missedQ.sourceQuote || ''),
        recallMode: 'conceptual',
      };
      const rubric = Array.isArray(missedQ.rubric) ? missedQ.rubric : [];
      if (rubric.length) card.rubric = rubric.map((pt) => ({ text: String(pt.text || ''), required: pt.required !== false }));
      const key = `bank:${Number(missedQ.bankId) || 0}`;
      if (!groups.has(key)) groups.set(key, { materialId: 0, bankId: Number(missedQ.bankId) || 0, deckName: `Study: ${label}`, cards: [] });
      groups.get(key).cards.push(card);
      continue;
    }
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
    const key = `material:${Number(concept.materialId) || 0}`;
    if (!groups.has(key)) groups.set(key, { materialId: Number(concept.materialId) || 0, deckName: `Study: ${label}`, cards: [] });
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

/** True when the scope holds fewer usable questions than the session size.
 *  The count is the pipeline's own (stScopeQuestionCount), so a selection
 *  whose page already has a bank still goes through the generating screen
 *  when its own concepts are short. */
async function stSessionNeedsGeneration(session) {
  const scope = stScopeOf(session);
  const size = Number(session?.size) || Number(cfg('sessionSize', 20)) || 20;
  // A bank is never generated into, but its short and essay questions get a
  // rubric from their answer when first drawn: that model work goes through
  // the generating screen too, never invisibly.
  if (scope.kind === 'bank') {
    if (typeof stScopeStats !== 'function') return false;
    const stats = await stScopeStats(scope);
    return (Number(stats && stats.needsRubric) || 0) > 0;
  }
  if (typeof stScopeQuestionCount === 'function') return (Number(await stScopeQuestionCount(scope)) || 0) < size;
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
  let view = 'generating';
  if (!(await stSessionNeedsGeneration(session))) {
    // The bank is full enough, so the draw makes nothing. Should the pipeline
    // start writing anyway, the run stops at once and the generating screen
    // takes over: generation is never invisible.
    const token = { cancelled: false };
    let wrote = false;
    const onProgress = () => { if (!wrote) { wrote = true; token.cancelled = true; } };
    const drawn = await stNextDraw(session, { token, onProgress });
    if (!wrote && Array.isArray(drawn) && drawn.length) view = 'session';
  }
  await stOpenPane({ view, sessionId: session.id });
  _emitDataChanged();
  return session;
}

// ─── Show Source ────────────────────────────────────────────────────────────

/** Open the question's source beside the session: the provider's own open,
 *  else the file at its page and quote. Returns the file URI opened (so the
 *  session's Esc can close it), true for a provider's open, false for none. */
async function stShowSource(question) {
  if (!question) return false;
  if (question.providerId && _questionRegistry) {
    try {
      const list = typeof _questionRegistry.list === 'function' ? _questionRegistry.list() : [];
      const provider = (await list || []).find((p) => p && p.id === question.providerId);
      if (provider && typeof provider.open === 'function') {
        // providerRef is JSON now; the provider knows the question by its `ref`.
        const ref = typeof stProviderRefOf === 'function' ? stProviderRefOf(question) : String(question.providerRef || '');
        const ok = await provider.open(ref);
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
  // A question from a notes file (no page, no anchor) opens at its own line.
  if (!reveal.page && !reveal.quote && question.stem && /\.(?:md|txt|csv|tsv|json)$/i.test(uri)) {
    const text = await stReadWorkspaceFile(stFsPathOf(uri)).catch(() => '');
    const line = stLineOfStem(text, question.stem);
    if (line > 0) reveal.line = line;
  }
  const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : stUriOf(stFsPathOf(uri));
  try {
    // `side` opens beside the session (core seam C4); an older core ignores it.
    await _api.editors.openFileEditor(target, { reveal, side: true });
  } catch (err) {
    console.warn('[Study] open beside failed, opening in place:', err);
    await _api.editors.openFileEditor(target, { reveal });
  }
  return target;
}

/** Close the open editor showing `uri` (the source Show Source opened).
 *  Matched by its fsPath against the editor's description, name or id. */
async function stCloseSourceEditor(uri) {
  const fsPath = stFsPathOf(String(uri || ''));
  if (!fsPath || !_api?.editors) return false;
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const want = norm(fsPath);
  const editors = Array.isArray(_api.editors.openEditors) ? _api.editors.openEditors : [];
  const hit = editors.find((e) => e && (norm(stFsPathOf(String(e.description || ''))) === want
    || norm(stFsPathOf(String(e.name || ''))) === want
    || norm(String(e.id || '')).includes(want)));
  if (!hit || typeof _api.editors.closeEditor !== 'function') return false;
  try { return !!(await _api.editors.closeEditor(hit.id)); } catch { return false; }
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
async function stSessionContext(session, onlyItems = null) {
  const scope = stScopeOf(session);
  const materialIds = (scope.materialIds || []).map(Number).filter((n) => n > 0);
  const items = Array.isArray(onlyItems) ? onlyItems : await stListSessionItems(session.id);
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
  // stSessionSummary reads conceptId off each item; the rows carry only the question id.
  const summary = stSessionSummary(items.map((it) => ({ ...it, conceptId: Number(it.conceptId) || Number(questionById.get(Number(it.questionId))?.conceptId) || 0 })), concepts);
  const missedConceptIds = [...new Set((summary.missed || []).map((m) => Number(m.conceptId) || Number(questionById.get(Number(m.questionId))?.conceptId) || 0).filter((n) => n > 0))];
  if (missedConceptIds.length) {
    for (const q of await stListQuestions({ conceptIds: missedConceptIds, includeHidden: false })) {
      if (!questionById.has(Number(q.id))) { questionById.set(Number(q.id), q); questions.push(q); }
    }
  }
  return { scope, items, concepts, questions, summary };
}

/** The last draw of a session (the one the results screen shows). */
function stLastDrawItems(items) {
  const list = Array.isArray(items) ? items : [];
  const draw = list.reduce((m, i) => Math.max(m, Number(i.draw) || 0), 0);
  return list.filter((i) => (Number(i.draw) || 0) === draw);
}

/**
 * The card groups Send Missed would make for `items` (default: the session's
 * last draw, never every draw, so a Refresh never resends earlier misses).
 * The results screen counts its button from this, so the count is what is sent.
 */
async function stMissedCardGroups(session, items = null) {
  const s = session && typeof session === 'object' ? session : await stGetSession(Number(session));
  if (!s) return [];
  const chosen = Array.isArray(items) ? items : stLastDrawItems(await stListSessionItems(s.id));
  const [{ summary, concepts, questions }, materials, banks] = await Promise.all([stSessionContext(s, chosen), stListMaterials(), stListBanks()]);
  return stCardsForMissed(summary, concepts, questions, materials, banks);
}

/** Send the missed cards of the draw shown (`items`, default the last draw) to Flashcards. Returns { count }. */
async function stSendMissedToFlashcards(session, { items = null } = {}) {
  const s = session && typeof session === 'object' ? session : await stGetSession(Number(session));
  if (!s) return { count: 0 };
  if (!(await stFlashcardsAvailable())) return { count: 0 };
  const groups = await stMissedCardGroups(s, items);
  let count = 0;
  for (const g of groups) {
    await _api.commands.executeCommand('flashcards.addCards', { deckName: g.deckName, cards: g.cards });
    count += g.cards.length;
  }
  return { count };
}

/** A card rated in Flashcards lowers its concept's mastery here (tag study:c:<id>, or study:q:<id>). */
function registerRatingListener(context, token = stActivation()) {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  const handler = (ev) => {
    if (!stIsCurrent(token)) return;
    const detail = ev?.detail || {};
    const rating = Number(detail.rating);
    const tags = Array.isArray(detail.tags) ? detail.tags : String(detail.tags || '').split(',');
    for (const raw of tags) {
      // study:c:<concept>, or study:q:<question> for a bank question's card
      // (its concept, when the question has one).
      const m = /^study:([cq]):(\d+)$/.exec(String(raw || '').trim());
      if (!m) continue;
      void (async () => {
        if (!stIsCurrent(token)) return;
        let conceptId = Number(m[2]);
        if (m[1] === 'q') {
          const q = await stGetQuestion(conceptId);
          if (!stIsCurrent(token)) return;
          conceptId = Number(q?.conceptId) || 0;
          if (!conceptId) return;
        }
        const concept = await stLoadConcept(conceptId);
        if (!concept || !stIsCurrent(token)) return;
        const mastery = stMasteryFromCardRating(Number(concept.mastery) || 0, rating);
        if (mastery === concept.mastery) return;
        await stUpdateConcept({ ...concept, mastery });
        if (stIsCurrent(token)) _emitDataChanged();
      })().catch((err) => { if (stIsCurrent(token) && !stIsStopped(err)) console.warn('[Study] card rating not applied:', err); });
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

/**
 * Pull every question provider's items; re-sync when the set changes.
 * Retries while the core command is not yet there. Everything is tied to
 * activation `token`: a sync that resumes after Study went off (or off and
 * on again) stops there, and the change listener is only registered while
 * the token is current (stOwn disposes it with the activation).
 */
function registerQuestionProviders(context, attempt = 0, token = stActivation()) {
  const live = () => stIsCurrent(token);
  if (!live()) return;
  _api.commands.executeCommand('questions.getRegistry')
    .then(async (registry) => {
      if (!live()) return;
      if (!registry || typeof registry.list !== 'function') throw new Error('no registry');
      _questionRegistry = registry;
      await stSyncProviders(registry, { isLive: live });
      if (!live()) return;
      // Activate hands every register function a context owned by its
      // activation (stOwnedContext): a push after Study went off is
      // disposed at once, and deactivate disposes the rest.
      if (typeof registry.onDidChange === 'function') {
        context.subscriptions.push(registry.onDidChange(() => {
          if (!live()) return;
          stSyncProviders(registry, { isLive: live })
            .then(() => { if (live()) _emitDataChanged(); })
            .catch((err) => { if (live() && !stIsStopped(err)) console.warn('[Study] provider sync failed:', err); });
        }));
      }
      _emitDataChanged();
    })
    .catch(() => {
      if (attempt < 5 && live()) stRetryLater(() => registerQuestionProviders(context, attempt + 1, token), 2000, token);
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
  const prefs = stSessionPrefs(material);
  // The same scope the sheet's Selection builds (stBuildScope): named by the
  // material's label and the page, and bounded to that page, so the results
  // count the passage's concepts and not the whole document's.
  return stStartSession({
    scope: {
      kind: 'selection', materialIds: [material.id], selectionText: text, selectionPage: page,
      pageFrom: page, pageTo: page, label: `${stTruncate(material.label || 'Selection', 32)} · ${page ? `p. ${page}` : 'selection'}`,
    },
    mode: 'practice',
    ...prefs,
  });
}

/** Register into the selection-action dispatcher; the chat may activate after Study, so retry briefly. */
function registerSelectionAction(context, attempt = 0, token = stActivation()) {
  if (!stIsCurrent(token)) return;
  _api.commands.executeCommand('chat.getSelectionActionDispatcher')
    .then((dispatcher) => {
      if (!stIsCurrent(token)) return;
      if (!dispatcher || typeof dispatcher.registerHandler !== 'function') throw new Error('no dispatcher');
      context.subscriptions.push(dispatcher.registerHandler({
        actionId: 'quiz-selection',
        label: 'Quiz This Selection',
        icon: 'px-study',
        execute: async (payload) => { await stQuizSelection(payload); },
      }));
    })
    .catch(() => {
      if (attempt < 5 && stIsCurrent(token)) stRetryLater(() => registerSelectionAction(context, attempt + 1, token), 2000, token);
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

/** A command's optional file argument: a path or file URI string, or
 *  `{ fsPath }` / `{ uri }`. '' when none was given. */
function stPathArg(arg) {
  let raw = '';
  if (typeof arg === 'string') raw = arg.trim();
  else if (arg && typeof arg === 'object') raw = String(arg.fsPath || arg.uri || arg.path || '').trim();
  if (!raw) return '';
  const p = stFsPathOf(raw);
  // A workspace-relative path resolves against the workspace root.
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(p)) return p;
  const root = stWorkspaceRoot();
  if (!root) return p;
  const sep = root.includes('\\') ? '\\' : '/';
  return root.replace(/[\\/]+$/, '') + sep + p.replace(/^\.[\\/]/, '');
}

/** `ids` (optional) are material ids; else the sidebar's pick; else every material. */
async function stCmdStudyTogether(ids0) {
  let ids = Array.isArray(ids0) ? ids0.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  if (!ids.length) ids = stPicked();
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
  // The label names the scope; the mode word already says Weak Spots.
  const scope = { kind: 'weak', materialIds: materials.map((m) => m.id), label: 'All materials' };
  // Nothing weak or stale yet: no empty session, and no "nothing passed the
  // checks", which would be untrue.
  if (!(await stScopeConcepts(scope)).length) {
    await _api.window.showInformationMessage('No weak spots yet: every concept you have answered is clean.');
    return null;
  }
  return stStartSession({
    scope,
    mode: 'weak',
    ...stSessionPrefs(null),
  });
}

async function stCmdAddMaterial(arg) {
  const fsPath = stPathArg(arg) || await stPickWorkspacePdf();
  if (!fsPath) return null;
  const material = await stIngestPdf(fsPath);
  await stOpenSetup({ materialIds: [material.id] });
  return material;
}

async function stCmdImportQuestions(arg) {
  const fsPath = stPathArg(arg) || await stPickWorkspaceFile(ST_IMPORT_EXTS, 'Import questions from which file?');
  if (!fsPath) return null;
  const result = await stImportQuestionFile(fsPath);
  const n = Number(result?.inserted) || 0;
  await _api.window.showInformationMessage(`Imported ${n} ${n === 1 ? 'question' : 'questions'}.`);
  _emitDataChanged();
  return result;
}

async function stCmdImportReport(arg) {
  const fsPath = stPathArg(arg) || await stPickWorkspaceFile(['.pdf'], 'Which examiner\'s report?');
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
    // Each takes an optional argument (material ids; a path or file URI) so
    // the chat and scripts can call them without the quick pick.
    ['study.studyTogether', (ids) => stCmdStudyTogether(ids)],
    ['study.weakSpots', () => stCmdWeakSpots()],
    ['study.addMaterial', (arg) => stCmdAddMaterial(arg)],
    ['study.importQuestions', (arg) => stCmdImportQuestions(arg)],
    ['study.importReport', (arg) => stCmdImportReport(arg)],
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
      displayName: 'Weak Spots',
      description: 'The concepts you keep missing, by material, each row a door into a session on it.',
      icon: 'px-study',
      category: 'query',
      defaultSize: { colSpan: 4, rowSpan: 3 },
      defaultConfig: { maxRows: 5 },
      configSchema: { fields: { maxRows: { type: 'number', label: 'Materials to show' } } },
      defaultRefreshPolicy: { kind: 'interval', ms: 15 * 60 * 1000 },
      refresh: async (ctx) => {
        const token = stActivation();
        try {
          return JSON.stringify(await stWeakSpotRows(Number(ctx?.config?.maxRows) || 5));
        } catch (err) {
          // Turned off mid-refresh: an empty widget, no error.
          if (!stIsCurrent(token) || stIsStopped(err)) return JSON.stringify({ rows: [], totalWeak: 0, size: 20 });
          throw err;
        }
      },
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
          const foot = _api.ui.createButton(root, {
            label: `Study the Weakest ${data.size || 20}`, kind: 'ghost', size: 'sm',
            title: 'One session over the weakest concepts across every material.',
            onClick: () => void _api.commands.executeCommand('study.weakSpots'),
          });
          foot.classList.add('st-widget__foot');
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
            ? { kind: 'weak', materialIds: [material.id], label: material.label }
            : { kind: 'document', materialIds: [material.id], label: material.label };
        if (scope.kind === 'weak' && !(await stScopeConcepts(scope)).length) {
          return { content: `No weak spots in ${material.label} yet: every concept answered there is clean.` };
        }
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
        for (const m of summary.missedConcepts || []) {
          const c = byId.get(Number(m.conceptId) || Number(questionById.get(Number(m.questionId))?.conceptId));
          if (!c || seen.has(c.id)) continue;
          seen.add(c.id);
          const status = stMissedStatusText(m);
          missedTitles.push(`- ${c.title}${status === 'weak' ? '' : ` (${status})`} · parallx://study/concept/${c.id}`);
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
function registerPlannerDayLoads(context, attempt = 0, token = stActivation()) {
  if (!stIsCurrent(token)) return;
  _api.commands.executeCommand('planner.getRegistry')
    .then((registry) => {
      if (!stIsCurrent(token)) return;
      if (!registry) throw new Error('no registry');
      if (typeof registry.registerDayLoadProvider !== 'function') return;
      context.subscriptions.push(registry.registerDayLoadProvider({
        id: 'study',
        getDayLoads: (fromMs, toMs) => stDayLoads(fromMs, toMs),
        onDidChange: (listener) => onDataChanged(listener),
      }));
    })
    .catch(() => {
      if (attempt < 5 && stIsCurrent(token)) stRetryLater(() => registerPlannerDayLoads(context, attempt + 1, token), 2000, token);
    });
}
