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
  if (Array.isArray(p.bankIds) && p.bankIds.length) route.bankIds = p.bankIds.slice();
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
    progress: { phase: '', done: 0, total: 0, written: 0, kept: 0, available: null, dropped: {} },
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

/** Stop every in-flight draw (deactivate): their tokens are cancelled, so the
 *  pipeline stops at its next check and nothing keeps writing. */
function stCancelRuns() {
  for (const run of _stRuns.values()) { try { run.token.cancelled = true; } catch { /* noop */ } }
  _stRuns.clear();
}

// ── Answers and marking shared by the session, results and review ──────────

/** True once an item has an answer in, marked or not (Test's 'answered'). */
function stItemAnswered(item) {
  const s = item && item.status;
  return s === 'right' || s === 'wrong' || s === 'answered';
}

/** The rubric points, hit / partial / miss, landing one after another. */
function stRubricEl(rubric, points) {
  const rub = el('div', 'st-rub');
  (rubric || []).forEach((p, i) => {
    const status = (points && points[i] && points[i].status) || 'miss';
    const pt = el('div', `st-rub__pt st-rub__pt--${status}`);
    pt.style.setProperty('--st-i', String(i));
    const glyph = el('span', 'st-rub__g');
    glyph.innerHTML = icon(status === 'hit' ? 'check' : status === 'partial' ? 'minus' : 'x', 12);
    pt.appendChild(glyph);
    const body = el('span', 'st-rub__text');
    body.appendChild(stMd(p && p.text));
    if (p && p.required) body.appendChild(el('span', 'st-rub__req', 'required'));
    pt.appendChild(body);
    rub.appendChild(pt);
  });
  return rub;
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
  const job = g.chain
    .then(() => stMarkTestAnswer(sessionId, item, q, { modelId, numCtx }))
    .catch((err) => console.warn('[Study] marking failed:', err));
  g.chain = job;
  g.pending.set(item.id, job);
  void job.then(() => {
    g.pending.delete(item.id);
    if (!g.pending.size && _stGrades.get(sessionId) === g) _stGrades.delete(sessionId);
  });
  return job;
}

/** Mark one recorded Test answer and write it back as Practice would have. */
async function stMarkTestAnswer(sessionId, item, q, { modelId, numCtx }) {
  if (!_api) return;
  const typed = String(item.typed || '');
  let result;
  try {
    result = await stGradeTypedResult(q, typed, { modelId, numCtx });
  } catch (err) {
    if (!_api) return;
    // Not counted either way: skipped, with the reason kept for review.
    await stAnswerItem(item.id, { status: 'skipped', verdict: { note: `Could not mark this answer: ${stSentence(stErrText(err))}`, ungraded: true } }, stNow());
    item.status = 'skipped';
    bus.emit('session', { sessionId, itemId: item.id, status: 'skipped' });
    return;
  }
  if (!_api) return;
  const ok = result.rating >= GOOD;
  const status = ok ? 'right' : 'wrong';
  const now = stNow();
  const fmt = item.formatUsed || 'short';
  await stAnswerItem(item.id, { status, verdict: stStoredVerdict(result) }, now);
  await stLogAnswer({ questionId: q.id, conceptId: q.conceptId, sessionId, formatUsed: fmt, correct: ok ? 1 : 0, rating: result.rating, retried: 0 }, now);
  const concept = Number(q.conceptId) > 0 ? await stGetConcept(q.conceptId) : null;
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

/** One answered item in the review layout: the stem, the answer given, the
 *  verdict with its rubric points, the right answer and the anchor. */
function stReviewItemEl(item, q, c, n) {
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

  // The verdict of a typed answer, as it was marked, point by point.
  const v = item.verdict && typeof item.verdict === 'object' ? item.verdict : null;
  if (item.status === 'answered') {
    box.appendChild(el('div', 'st-review__v', 'Marking…'));
  } else if (fmt !== 'mc' && v && Array.isArray(v.points)) {
    const rubric = Array.isArray(v.rubric) && v.rubric.length ? v.rubric : (Array.isArray(q.rubric) ? q.rubric : []);
    const ok = item.status === 'right';
    const line = el('div', `st-review__v st-review__v--${ok ? 'ok' : 'no'}`);
    line.appendChild(el('span', '', v.label || (rubric.length ? stVerdictLabel(v, rubric) : (ok ? 'Correct' : 'Not quite'))));
    if (v.rating) {
      const g = el('span', 'st-fb__grade');
      g.appendChild(document.createTextNode('· counts as '));
      g.appendChild(el('b', '', stRatingWord(Number(v.rating))));
      line.appendChild(g);
    }
    box.appendChild(line);
    if (rubric.length) box.appendChild(stRubricEl(rubric, v.points));
  }
  if (v && v.note) {
    const note = el('div', 'st-fb__why');
    note.appendChild(stMd(v.note));
    box.appendChild(note);
  }

  const rightEl = el('div', 'st-review__ans');
  rightEl.appendChild(el('span', 'st-review__lab', 'Right answer'));
  const rightText = q.format === 'mc' ? (options[Number(q.answer)] !== undefined ? options[Number(q.answer)] : String(q.answer)) : String(q.answer || '');
  rightEl.appendChild(stMd(rightText));
  box.appendChild(rightEl);
  box.appendChild(stQuoteEl(q, q.sourceQuote, q.sourcePage, () => void stShowSource(q)));
  return box;
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
    rerender: () => { if (!state.disposed) void render(); },
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

/** Usable questions in a scope: the pipeline's count when it is there, else
 *  the scope's materials' questions filtered by the scope (the same rule as
 *  stSessionNeedsGeneration, so the sheet and the start agree). */
async function stCountScopeQuestions(scope) {
  try {
    if (typeof stScopeQuestionCount === 'function') return Number(await stScopeQuestionCount(scope)) || 0;
  } catch { /* fall through */ }
  try {
    if (scope && scope.kind === 'bank') return ((await stListQuestions({ bankIds: scope.bankIds || [] })) || []).filter((q) => !q.hidden).length;
    const materialIds = Array.isArray(scope && scope.materialIds) ? scope.materialIds : [];
    const [questions, concepts] = await Promise.all([
      stListQuestions({ materialIds }),
      materialIds.length ? stListConcepts({ materialIds }) : Promise.resolve([]),
    ]);
    return stQuestionsInScope(questions || [], concepts || [], scope, stNow(), Number(cfg('staleDays', 14)) || 14).length;
  } catch { return 0; }
}

/** What the sheet's one count line says (mockup §2, second pass). */
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

/** The scrim, the sheet and its header; returns the body to fill. */
function stSheetFrame(host, ctx, subtitle) {
  host.appendChild(el('div', 'st-scrim'));
  const sheet = el('div', 'st-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Study');
  host.appendChild(sheet);
  const hd = el('div', 'st-sheet__hd');
  const titles = el('div', '');
  titles.appendChild(el('h3', 'st-sheet__title', 'Study'));
  const sub = el('div', 'st-sheet__sub', subtitle);
  sub.title = subtitle;
  titles.appendChild(sub);
  hd.appendChild(titles);
  _api.ui.createIconButton(hd, { icon: 'x', title: 'Cancel', size: 'sm', onClick: () => void ctx.closeTab() });
  sheet.appendChild(hd);
  const bd = el('div', 'st-sheet__bd');
  sheet.appendChild(bd);
  return { sheet, bd };
}

/** Mode and Answer: one row (two aligned rows when the sheet is narrow).
 *  Test is answered by typing, so it locks Answer on Type; a bank with no
 *  multiple-choice question cannot be answered by choosing. */
function stModeAnswerRow(bd, ctx, st, { modes, noChoose = false, onChange }) {
  const row = el('div', 'st-ma');
  const modePair = el('div', 'st-ma__pair');
  modePair.appendChild(el('span', 'st-row__lab', 'Mode'));
  row.appendChild(modePair);
  const answerPair = el('div', 'st-ma__pair');
  answerPair.appendChild(el('span', 'st-row__lab st-row__lab--inline', 'Answer'));
  row.appendChild(answerPair);
  let answerSeg = null;
  const sync = () => {
    if (!answerSeg) return;
    const test = st.mode === 'test';
    if (test || (noChoose && st.answer === 'choose')) { st.answer = 'type'; answerSeg.value = 'type'; }
    for (const btn of answerSeg.element.querySelectorAll('[data-value]')) {
      const v = btn.dataset.value;
      const why = test && v !== 'type' ? 'Test is answered by typing.'
        : noChoose && v === 'choose' ? 'This bank has no multiple-choice questions.' : '';
      btn.disabled = !!why;
      if (why) btn.title = why; else btn.removeAttribute('title');
    }
  };
  const modeSeg = _api.ui.createSegmented(modePair, {
    ariaLabel: 'Mode', items: modes, value: st.mode,
    onChange: (v) => { st.mode = v; sync(); onChange(); },
  });
  modeSeg.element.title = modes.some((m) => m.value === 'learn')
    ? 'Practice marks as you go and lets you retry. Test is typed answers, no retry, results at the end. Learn is the chapter in a page.'
    : 'Practice marks as you go and lets you retry. Test is typed answers, no retry, results at the end.';
  ctx.add(modeSeg);
  answerSeg = _api.ui.createSegmented(answerPair, {
    ariaLabel: 'Answer format',
    items: [{ value: 'choose', label: 'Choose' }, { value: 'type', label: 'Type' }, { value: 'mixed', label: 'Mixed' }],
    value: st.answer,
    onChange: (v) => { st.answer = v; onChange(); },
  });
  answerSeg.element.title = 'Mixed starts on choices and moves a concept to typing once it has been answered right.';
  ctx.add(answerSeg);
  bd.appendChild(row);
  sync();
  return { modeSeg, answerSeg };
}

/** The footer: the model line on the left (a kit ghost button with its
 *  chevron), Cancel and Start on the right. */
function stSheetFooter(sheet, ctx, { models, activeModel, st, onPrefs, onStart }) {
  const ft = el('div', 'st-sheet__ft');
  const mdlBtn = _api.ui.createButton(ft, {
    label: '', icon: 'px-ai-mark', kind: 'ghost', size: 'sm',
    title: 'The model that writes and grades, and its context window',
    onClick: () => openMenu(),
  });
  mdlBtn.classList.add('st-sheet__mdl');
  const chev = el('span', 'st-sheet__chev');
  chev.innerHTML = icon('chevron-down', 12);
  mdlBtn.appendChild(chev);
  const acts = el('span', 'st-sheet__acts');
  _api.ui.createButton(acts, { label: 'Cancel', kind: 'ghost', onClick: () => void ctx.closeTab() });
  const startBtn = _api.ui.createButton(acts, { label: 'Start', kind: 'primary', onClick: () => void onStart() });
  ft.appendChild(acts);
  sheet.appendChild(ft);

  const effectiveModel = () => st.model || activeModel || (models[0] ? models[0].id : '');
  const modelName = (id) => { const m = models.find((x) => x.id === id); return m ? (m.displayName || m.id) : (id || 'No model'); };
  const paintModel = () => {
    const ctxLabel = st.contextSetting ? `${stFmtK(st.contextSetting)} context` : 'Auto context';
    stSetLabel(mdlBtn, `${modelName(effectiveModel())} · ${ctxLabel}`);
  };
  const pick = (patch) => { Object.assign(st, patch); paintModel(); void onPrefs(); };
  function openMenu() {
    const items = [{ label: 'Model', disabled: true }];
    for (const m of models) {
      items.push({ label: m.displayName || m.id, keybinding: stFmtK(m.contextLength), checked: st.model === m.id, onSelect: () => pick({ model: m.id }) });
    }
    items.push({ label: "Use the Chat's Model", checked: !st.model, onSelect: () => pick({ model: '' }) });
    items.push({ separator: true });
    items.push({ label: 'Context', disabled: true });
    items.push({ label: 'Auto', checked: !st.contextSetting, onSelect: () => pick({ contextSetting: 0 }) });
    const current = models.find((x) => x.id === effectiveModel());
    const limit = current ? Number(current.contextLength) || 0 : 0;
    for (const k of [8, 16, 32, 64]) {
      const tokens = k * 1024;
      if (limit && tokens > limit) continue;
      items.push({ label: `${k}k`, checked: st.contextSetting === tokens, onSelect: () => pick({ contextSetting: tokens }) });
    }
    _api.ui.showContextMenu(mdlBtn, items, { anchorPosition: 'above' });
  }
  paintModel();
  return { startBtn, mdlBtn };
}

async function renderSetup(host, route, ctx) {
  if (Array.isArray(route.bankIds) && route.bankIds.length) { await renderBankSetup(host, route, ctx); return; }
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
  const { models, activeModel } = await stSheetModels();
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

  const { sheet, bd } = stSheetFrame(host, ctx, materials.length > 1 ? `${materials.length} materials` : primary.label);

  // Scope row.
  const scopeRow = el('div', 'st-row');
  scopeRow.appendChild(el('span', 'st-row__lab', 'Scope'));
  const scopeSeg = _api.ui.createSegmented(scopeRow, {
    ariaLabel: 'Scope', items: kinds, value: st.kind,
    onChange: (v) => { st.kind = v; paintList(); void paintCount(); },
  });
  ctx.add(scopeSeg);
  bd.appendChild(scopeRow);

  // The list under the scope: outline, page inputs, the selection, or the
  // materials; then the one count line under it.
  const listHost = el('div', 'st-sheet__list');
  bd.appendChild(listHost);
  const countEl = el('div', 'st-sheet__count');
  bd.appendChild(countEl);


  function paintList() {
    listHost.innerHTML = '';
    if (st.kind === 'document' || st.kind === 'chapter') {
      if (!sections.length) {
        const pages = stProp(primary, 'pageCount', 0);
        listHost.appendChild(el('div', 'st-selection', `${primary.label}${pages ? ` · ${pages} pages` : ''}`));
        return;
      }
      const outline = el('div', 'st-outline');
      outline.setAttribute('role', 'listbox');
      for (const s of sections) {
        const row = el('div', 'st-outline__o' + (st.kind === 'chapter' && s.id === st.sectionId ? ' st-outline__o--on' : ''));
        row.setAttribute('role', 'option');
        row.dataset.sectionId = String(s.id);
        const nm = el('span', 'st-outline__nm', s.title);
        nm.title = s.title;
        row.appendChild(nm);
        const from0 = stProp(s, 'pageFrom', 0), to0 = stProp(s, 'pageTo', 0);
        const inSection = concepts.filter((c) => c.materialId === primary.id && (c.sectionId === s.id || (from0 && c.page >= from0 && c.page <= to0)));
        row.appendChild(stCoverageBar('st-ocov', stCoverageOf(inSection, now)));
        const from = stProp(s, 'pageFrom', 0), to = stProp(s, 'pageTo', 0);
        row.appendChild(el('span', 'st-outline__pp', from === to ? String(from) : `${from}–${to}`));
        row.addEventListener('click', () => {
          st.sectionId = s.id;
          st.kind = 'chapter';
          scopeSeg.value = 'chapter';
          paintList();
          void paintCount();
        });
        outline.appendChild(row);
      }
      listHost.appendChild(outline);
      return;
    }
    if (st.kind === 'pages') {
      const row = el('div', 'st-pages');
      const max = stProp(primary, 'pageCount', 0);
      const mk = (label, key) => {
        row.appendChild(el('span', '', label));
        const input = el('input', 'st-input');
        input.type = 'number';
        input.min = '1';
        if (max) input.max = String(max);
        input.value = String(st[key]);
        input.setAttribute('aria-label', label === 'From' ? 'First page' : 'Last page');
        input.addEventListener('input', () => { st[key] = Number(input.value) || 1; void paintCount(); });
        row.appendChild(input);
      };
      mk('From', 'pageFrom');
      mk('to', 'pageTo');
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
      const nm = el('span', 'st-outline__nm', m.label);
      nm.title = m.label;
      row.appendChild(nm);
      row.appendChild(stCoverageBar('st-ocov', stCoverageOf(concepts.filter((c) => c.materialId === m.id), now)));
      outline.appendChild(row);
    }
    listHost.appendChild(outline);
  }

  stModeAnswerRow(bd, ctx, st, {
    modes: [{ value: 'practice', label: 'Practice' }, { value: 'test', label: 'Test' }, { value: 'learn', label: 'Learn' }],
    onChange: () => void paintCount(),
  });

  const savePrefs = async () => {
    for (const m of materials) {
      try { await stSetMaterialPrefs(m.id, { model: st.model, contextSetting: st.contextSetting, answerFormat: st.answer }); } catch { /* noop */ }
    }
  };
  const { startBtn } = stSheetFooter(sheet, ctx, { models, activeModel, st, onPrefs: savePrefs, onStart: () => start() });

  let countSeq = 0;
  async function paintCount() {
    const seq = ++countSeq;
    const scope = stBuildScope(st, materials, sections, route);
    const cov = stCoverageOf(stConceptsInScope(concepts, scope), now);
    const questions = st.mode === 'learn' ? 0 : await stCountScopeQuestions(scope);
    if (seq !== countSeq || ctx.disposed()) return;
    countEl.textContent = stSetupCountText({ mode: st.mode, concepts: cov.total, clean: cov.clean, questions, size });
    const short = st.mode !== 'learn' && questions < size;
    stSetLabel(startBtn, short ? 'Make Questions and Start' : 'Start');
    startBtn.title = st.mode === 'learn' ? 'Open the chapter as a page.' : short ? 'Writes the missing questions first, then starts.' : `Draws ${size} questions from the bank.`;
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
      await stStartSession({ scope, mode: st.mode, answerFormat: st.mode === 'test' ? 'type' : st.answer, model: st.model, numCtx: st.contextSetting });
      _emitDataChanged();
      await ctx.closeTab();
    } catch (err) {
      st.starting = false;
      startBtn.disabled = false;
      try { await _api.window.showErrorMessage(`Could not start: ${stErrText(err)}`); } catch { /* noop */ }
    }
  }

  paintList();
  await paintCount();
}

/** The sheet over a question bank: no chapter list, one line, Mode and
 *  Answer; Start runs a session with the bank scope. */
async function renderBankSetup(host, route, ctx) {
  const banks = [];
  for (const id of route.bankIds) {
    const b = await stGetBank(id);
    if (b) banks.push(b);
  }
  if (!banks.length) {
    _api.ui.createEmptyState(host, {
      icon: 'database',
      headline: 'This bank no longer exists.',
      hint: 'It was deleted, with its questions.',
      action: { label: 'Close', onClick: () => void ctx.closeTab() },
    });
    return;
  }
  const scope = { kind: 'bank', bankIds: banks.map((b) => b.id), materialIds: [], label: banks.map((b) => b.name).join(' + ') };
  const questions = ((await stListQuestions({ bankIds: scope.bankIds })) || []).filter((q) => !q.hidden);
  const count = await stCountScopeQuestions(scope);
  const hasChoice = questions.some((q) => q.format === 'mc' && Array.isArray(q.options) && q.options.length);
  const { models, activeModel } = await stSheetModels();
  const configured = String(cfg('answerFormat', 'mixed') || 'mixed');
  const st = {
    mode: 'practice',
    // An essay bank (no choices to pick from) starts on Type.
    answer: !hasChoice ? 'type' : (['choose', 'type', 'mixed'].includes(configured) ? configured : 'mixed'),
    model: String(cfg('aiModel', '') || ''),
    contextSetting: Number(cfg('generationContext', 0)) || 0,
    starting: false,
  };

  const { sheet, bd } = stSheetFrame(host, ctx, banks.length > 1 ? `${banks.length} banks` : banks[0].name);
  const origin = stBankOriginText(banks[0], questions);
  bd.appendChild(el('div', 'st-sheet__count', `${count} ${count === 1 ? 'question' : 'questions'} · ${origin}`));
  stModeAnswerRow(bd, ctx, st, {
    modes: [{ value: 'practice', label: 'Practice' }, { value: 'test', label: 'Test' }],
    noChoose: !hasChoice,
    onChange: () => {},
  });
  const { startBtn } = stSheetFooter(sheet, ctx, { models, activeModel, st, onPrefs: async () => {}, onStart: () => start() });
  if (!count) { startBtn.disabled = true; startBtn.title = 'This bank has no questions to draw.'; }
  else startBtn.title = `Draws ${Math.min(count, Number(cfg('sessionSize', 20)) || 20)} questions from the bank.`;

  async function start() {
    if (st.starting || !count) return;
    st.starting = true;
    startBtn.disabled = true;
    try {
      await stStartSession({ scope, mode: st.mode, answerFormat: st.mode === 'test' ? 'type' : st.answer, model: st.model, numCtx: st.contextSetting });
      _emitDataChanged();
      await ctx.closeTab();
    } catch (err) {
      st.starting = false;
      startBtn.disabled = false;
      try { await _api.window.showErrorMessage(`Could not start: ${stErrText(err)}`); } catch { /* noop */ }
    }
  }
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
  // A bank is never written to: the screen only bridges the draw.
  const isBank = scope.kind === 'bank';
  gen.appendChild(el('div', 'st-gen__t', `${isBank ? 'Drawing from' : 'Making questions for'} ${scope.label || session.name}`));
  const pages = isBank ? 'Question bank' : scope.pageFrom ? `Pages ${scope.pageFrom} to ${scope.pageTo || scope.pageFrom}` : (primary && stProp(primary, 'pageCount', 0) ? `${stProp(primary, 'pageCount', 0)} pages` : (materialIds.length > 1 ? `${materialIds.length} materials` : 'Whole document'));
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
  if (!isBank) gen.appendChild(checks);
  const acts = el('div', 'st-gen__acts');
  const stopBtn = _api.ui.createButton(acts, { label: 'Stop', kind: 'ghost', title: 'Stop writing. What is kept stays in the bank.', onClick: () => void stop() });
  const startBtn = _api.ui.createButton(acts, { label: `Start With ${size} Ready`, kind: 'primary', disabled: true, onClick: () => void startEarly() });
  gen.appendChild(acts);
  host.appendChild(gen);

  const run = stRunFor(session);
  // Questions the session already holds (a Refresh): the new draw excludes them.
  const held = items.length;
  const paint = () => {
    if (ctx.disposed()) return;
    const p = run.progress;
    // Filling a session (stNextDraw runs untilSize): progress is usable
    // questions in scope beyond the ones this session already drew, of the
    // session size. Before the first count arrives, the run's own done/total.
    const avail = p.available == null ? NaN : Number(p.available);
    const filling = Number.isFinite(avail);
    const ready = filling ? Math.min(size, Math.max(0, avail - held)) : 0;
    const done = filling ? ready : Number(p.done) || 0;
    const t = filling ? size : Number(p.total) || 0;
    sub.textContent = `${pages}${concepts.length ? ` · ${concepts.length} ${concepts.length === 1 ? 'concept' : 'concepts'}` : ''}${modelId ? ` · ${modelId}` : ''}`;
    fill.style.width = `${t ? Math.min(100, Math.round((done / t) * 100)) : 0}%`;
    const dropped = p.dropped || {};
    const droppedTotal = Object.values(dropped).reduce((a, b) => a + (Number(b) || 0), 0);
    line.innerHTML = '';
    const part = (b, rest) => { const s = el('span', ''); s.appendChild(el('b', '', b)); s.appendChild(document.createTextNode(` ${rest}`)); line.appendChild(s); };
    part(String(Number(p.kept) || 0), 'kept');
    part(String(droppedTotal), 'dropped');
    if (filling) part(`${ready} of ${size}`, 'ready');
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
    // Start With N Ready: enough usable questions in the whole scope, beyond
    // the ones this session already drew, for a full draw now.
    const full = filling && ready >= size;
    startBtn.disabled = run.done || run.token.cancelled || !full;
    startBtn.title = full ? 'Start now; writing goes on for the rest.' : `Offered once ${size} questions are ready.`;
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
    if (isBank && !stopped) {
      _api.ui.createEmptyState(host, {
        icon: 'database',
        headline: 'Every question in this bank has been drawn.',
        hint: 'Start a new session on the bank to go through it again.',
        action: { label: 'Study This Bank…', onClick: () => void stOpenSetup({ bankIds: scope.bankIds || [] }) },
      });
      return;
    }
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
    // Only this session's run: another tab's generation says nothing here.
    if (!d || typeof d !== 'object' || d.sessionId == null || Number(d.sessionId) !== Number(session.id)) return;
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
    stSetLabel(startBtn, 'Starting…');
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
  const conceptList = await stSessionConcepts(materialIds, questions);
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
      // Test shows no verdict until the results: an answered item is neutral.
      if (isTest && stItemAnswered(it)) i.className = 'ans';
      else if (it.status === 'right') i.className = 'ok';
      else if (it.status === 'wrong') i.className = 'no';
      else if (it.id === currentId) i.className = 'cur';
      strand.appendChild(i);
      segs.set(it.id, i);
    }
    const answered = drawItems.filter((i) => stItemAnswered(i)).length;
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
  // The source Show Source opened beside the session; it stays open across
  // cards until Esc closes it.
  const source = { open: false, uri: '' };

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
    // Test is Type: a multiple-choice question is answered as a short typed answer.
    if (isTest && fmt === 'mc') fmt = 'short';
    const cur = { item, q, concept, fmt, answered: false, retried: false, retryBtn: null, chosen: null, explaining: false, busy: false, ungraded: false, typedField: null };
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
    _api.ui.createIconButton(eyeActs, { icon: 'thumbs-down', title: 'Hide This Question…', size: 'sm', onClick: () => void hideQuestion() });
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
      label: 'Skip', kind: 'ghost', title: 'Skip (K). Moves this question to the end of the session.',
      disabled: queue.length - index <= 1,
      onClick: () => void skip(),
    });
    cur.skipBtn.appendChild(el('span', 'st-k', 'K'));
    cur.nextBtn = _api.ui.createButton(ctl, {
      label: fmt === 'mc' || isTest ? 'Next' : 'Check', kind: 'primary', disabled: fmt === 'mc',
      title: isTest ? 'Next (Enter). Every answer is marked at the end.' : fmt === 'mc' ? 'Next (Enter)' : 'Check (Enter)',
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
    const enterWord = isTest ? 'Enter for the next question' : 'Enter to check';
    hint.appendChild(el('span', '', fmt === 'short' || fmt === 'essay' ? `${enterWord} · Shift+Enter for a new line` : enterWord));
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
      cur.retryBtn = _api.ui.createButton(acts, { label: 'Retry', kind: 'ghost', title: 'Retry (R), once. A right answer now still counts as a miss.', onClick: () => retry() });
    }
    _api.ui.createButton(acts, { label: stSourceLabel(cur.q), kind: 'ghost', title: `${stSourceLabel(cur.q)} (S). Opens the page beside the session.`, onClick: () => void showSource() });
    _api.ui.createButton(acts, { label: 'Explain', kind: 'ghost', title: 'Explain (E). A short explanation grounded in the anchor.', onClick: () => void explain() });
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
    if (result.verdict && rubric.length) fb.appendChild(stRubricEl(rubric, points));
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
    fb.appendChild(el('div', 'st-fb__why', `${stSentence(stErrText(err))} The answer is not counted; Next moves on.`));
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
  /** Test: record the answer with no verdict, queue its marking (one at a
   *  time, in the background) and move on. The results screen waits for it. */
  async function recordTest(cur, text) {
    cur.busy = true;
    cur.typedField.disabled = true;
    cur.nextBtn.disabled = true;
    cur.answered = true;
    cur.typed = text;
    const now = stNow();
    try {
      await stAnswerItem(cur.item.id, { status: 'answered', chosen: '', typed: text, verdict: null, retried: 0, formatUsed: cur.fmt }, now);
      Object.assign(cur.item, { status: 'answered', typed: text, formatUsed: cur.fmt, answeredAt: now });
      await stUpdateSession(session.id, { position: Math.max(0, drawItems.indexOf(cur.item)), seconds });
      bus.emit('session', { sessionId: session.id, itemId: cur.item.id, status: 'answered' });
      stQueueTestGrade(session.id, cur.item, cur.q, { modelId, numCtx });
      pulseSeg(cur.item.id, 'ans');
    } finally { cur.busy = false; }
    if (current !== cur || ctx.disposed()) return;
    await next();
  }

  async function check() {
    const cur = current;
    if (!cur || cur.fmt === 'mc' || cur.answered || cur.busy || !cur.typedField) return;
    const text = String(cur.typedField.value || '').trim();
    if (!text) { cur.typedField.focus(); return; }
    if (isTest) { await recordTest(cur, text); return; }
    cur.busy = true;
    cur.typedField.disabled = true;
    cur.nextBtn.disabled = true;
    stSetLabel(cur.nextBtn, 'Checking…');
    let result;
    try { result = await stGradeTypedResult(cur.q, text, { modelId, numCtx }); }
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
      await commitAnswer(cur, { status: ok ? 'right' : 'wrong', chosen: '', typed: text, verdict: stStoredVerdict(result), correct: ok, rating: result.rating, retried: 0 });
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
    try {
      const opened = await stShowSource(cur.q);
      if (opened) { source.open = true; source.uri = typeof opened === 'string' ? opened : ''; }
    }
    catch (err) { try { await _api.window.showWarningMessage(`Could not open the source: ${stSentence(stErrText(err))}`); } catch { /* noop */ } }
  }

  async function closeSource() {
    source.open = false;
    const uri = source.uri;
    source.uri = '';
    if (uri && typeof stCloseSourceEditor === 'function') await stCloseSourceEditor(uri);
    if (!ctx.disposed()) ctx.root.focus();
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
    block.textContent = 'Explaining…';
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
      block.textContent = `Could not explain: ${stSentence(stErrText(err))}`;
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
    const answered = drawItems.filter((i) => stItemAnswered(i)).length;
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
      // The first Esc closes the source Show Source opened beside the
      // session; only with no source open does Esc ask to end.
      if (source.open) { void closeSource(); return; }
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
  const isBank = scope.kind === 'bank';
  const isTest = session.mode === 'test';
  const materialIds = Array.isArray(scope.materialIds) ? scope.materialIds : [];
  const allItems = (await stListSessionItems(session.id)) || [];
  const draw = allItems.reduce((m, i) => Math.max(m, Number(i.draw) || 0), 0);
  // The draw on screen: everything below (the score, the missed list, what
  // Send Missed sends) is about these items and no earlier draw.
  const drawItems = allItems.filter((i) => (Number(i.draw) || 0) === draw).sort((a, b) => (a.ord || 0) - (b.ord || 0));
  const questions = await stQuestionMap(scope, drawItems.map((i) => i.questionId));
  const conceptList = await stSessionConcepts(materialIds, questions);
  const scopeConcepts = isBank ? [] : stConceptsInScope(conceptList.filter((c) => !materialIds.length || materialIds.includes(c.materialId)), scope);
  const concepts = new Map(conceptList.map((c) => [c.id, c]));
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

  // A Test's answers are marked in the background; pick up any the queue
  // lost (the app closed mid-marking) and wait for the rest, quietly.
  let pending = [];
  if (isTest && drawItems.some((i) => i.status === 'answered')) {
    let modelId = stProp(session, 'model', '');
    if (!modelId) { try { modelId = (await stPickModel(materialIds.length ? await stGetMaterial(materialIds[0]) : null)) || ''; } catch { modelId = ''; } }
    pending = stEnsureTestGrades(session.id, drawItems, questions, { modelId, numCtx: Number(stProp(session, 'numCtx', 0)) || 0 });
  }
  const marking = pending.length > 0;

  // What Send Missed would send, counted by the same function that sends it.
  let cardCount = 0;
  if (flashcards && !marking) {
    try {
      const groups = typeof stMissedCardGroups === 'function' ? await stMissedCardGroups(session, drawItems) : [];
      cardCount = (groups || []).reduce((n, g) => n + ((g && g.cards) || []).length, 0);
    } catch { cardCount = 0; }
  }

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
  const refreshText = `${refreshes} ${refreshes === 1 ? 'refresh' : 'refreshes'} so far`;
  if (isBank) {
    under.appendChild(document.createTextNode(`${scope.label || session.name} · ${refreshText}`));
  } else {
    under.appendChild(document.createTextNode(`${scope.label || session.name} is `));
    under.appendChild(el('b', '', `${cov.clean} of ${cov.total} concepts clean`));
    under.appendChild(document.createTextNode(` · ${Math.max(0, cov.total - cov.clean)} to go · ${refreshText}`));
  }
  left.appendChild(under);
  top.appendChild(left);
  const acts = el('div', 'st-res__acts');
  if (flashcards) {
    const sendBtn = _api.ui.createButton(acts, {
      label: 'Send Missed to Flashcards', icon: 'layers', kind: 'secondary', disabled: marking || cardCount === 0,
      title: marking ? 'Offered once every answer is marked.' : cardCount ? 'One card per missed concept, with the anchor as its source.' : 'Nothing missed this session.',
      onClick: async () => {
        sendBtn.disabled = true;
        try {
          const r = await stSendMissedToFlashcards(session, { items: drawItems });
          const n = r && typeof r.count === 'number' ? r.count : 0;
          await _api.window.showInformationMessage(`${n} ${n === 1 ? 'card' : 'cards'} sent to Flashcards.`);
        } catch (err) {
          sendBtn.disabled = false;
          try { await _api.window.showErrorMessage(`Could not send: ${stSentence(stErrText(err))}`); } catch { /* noop */ }
        }
      },
    });
    if (!marking) sendBtn.appendChild(el('span', 'st-faint', `· ${cardCount}`));
  }
  _api.ui.createButton(acts, {
    label: 'Refresh', icon: 'refresh-cw', kind: 'primary', title: `Draws the next ${sessionSize} from the same scope, weak concepts first.`,
    onClick: async () => {
      await stUpdateSession(session.id, { refreshes: refreshes + 1, finishedAt: 0, position: 0 });
      _emitDataChanged();
      ctx.setRoute({ view: 'generating', sessionId: session.id });
    },
  });
  top.appendChild(acts);
  res.appendChild(top);

  // The coverage bar: one segment per concept in scope (a bank has none).
  if (!isBank) {
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
  }

  if (isTest) {
    // Test: every item with its verdict and per-point feedback.
    const answersBox = el('div', 'st-missed');
    _api.ui.createSectionLabel(answersBox, 'Answers');
    if (marking) {
      const line = el('div', 'st-marking');
      answersBox.appendChild(line);
      const answeredItems = drawItems.filter((i) => stItemAnswered(i) || (i.verdict && i.verdict.ungraded));
      const paintMarking = () => {
        const marked = answeredItems.filter((i) => i.status !== 'answered').length;
        line.textContent = `Marking ${Math.min(answeredItems.length, marked + 1)} of ${answeredItems.length}…`;
      };
      paintMarking();
      const off = bus.on('session', (d) => {
        if (!d || Number(d.sessionId) !== Number(session.id)) return;
        const it = drawItems.find((i) => i.id === d.itemId);
        if (it && d.status) it.status = d.status;
        paintMarking();
      });
      let live = true;
      ctx.add({ dispose: () => { live = false; stOff(off); } });
      void Promise.allSettled(pending).then(() => { if (live && !ctx.disposed()) ctx.rerender(); });
    }
    const list = el('div', 'st-review');
    let n = 0;
    for (const item of drawItems) {
      const q = questions.get(item.questionId);
      if (!q) continue;
      n++;
      list.appendChild(stReviewItemEl(item, q, concepts.get(q.conceptId), n));
    }
    if (!n) list.appendChild(el('div', 'st-muted', 'No answers yet.'));
    answersBox.appendChild(list);
    res.appendChild(answersBox);
  } else {
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
      pg.title = 'Open the page beside this.';
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
  }

  const ft = el('div', 'st-res__ft');
  ft.appendChild(el('span', 'st-res__lhs', `Refresh draws the next ${sessionSize}, weak concepts first.`));
  if (!isTest) _api.ui.createButton(ft, { label: 'Review Answers', kind: 'ghost', onClick: () => ctx.setRoute({ view: 'review', sessionId: session.id }) });
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
  const concepts = new Map((await stSessionConcepts(materialIds, questions)).map((c) => [c.id, c]));

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
    list.appendChild(stReviewItemEl(item, q, concepts.get(q.conceptId), n));
  }
  if (!n) list.appendChild(el('div', 'st-muted', 'No answers yet.'));
}

// ── Learn ───────────────────────────────────────────────────────────────────

async function renderLearn(host, route, ctx) {
  const material = await stGetMaterial(route.materialId);
  if (!material) throw new Error('This material no longer exists.');
  const sections = material.kind === 'pdf' ? ((await stListSections(material.id)) || []) : [];
  const section = route.sectionId ? sections.find((s) => s.id === route.sectionId) || null : null;
  // A chapter's concepts by its page range, so a parent chapter includes its subsections'.
  const concepts = ((section
    ? (typeof stConceptsForSections === 'function' ? await stConceptsForSections([section.id]) : await stListConcepts({ sectionIds: [section.id] }))
    : await stListConcepts({ materialIds: [material.id] })) || [])
    .slice()
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
    pg.title = 'Open the page beside this.';
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
