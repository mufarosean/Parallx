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
// after every answer, so a closed tab reopens where it was. The making of
// questions (the run, its screen, its strip in the session) is 55-making-view.js.

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
  if (route.view === 'newSubject') return 'new-subject';
  if (route.view === 'progress') return `progress-${Number(route.subjectId) || 0}`;
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
  if (id === 'new-subject') return { view: 'newSubject' };
  m = /^progress-(\d+)$/.exec(id);
  if (m) return { view: 'progress', subjectId: Number(m[1]) };
  return { view: 'setup', materialIds: [] };
}

async function stRouteTitle(route) {
  try {
    if (route.view === 'setup') return 'Study';
    if (route.view === 'newSubject') return 'New Subject';
    if (route.view === 'progress') {
      const st = _stSubjects.get(Number(route.subjectId));
      return st ? `${st.subject.name} Progress` : 'Progress';
    }
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
  stNoteSheetOpener();
  const route = { view: 'setup', materialIds: Array.isArray(p.materialIds) ? p.materialIds.slice() : [] };
  if (Array.isArray(p.bankIds) && p.bankIds.length) route.bankIds = p.bankIds.slice();
  for (const k of ['unit', 'result', 'sectionId', 'pageFrom', 'pageTo', 'selectionText', 'selectionPage']) if (p[k] != null) route[k] = p[k];
  return stOpenPane(route);
}

// ── Small helpers shared by the screens ─────────────────────────────────────

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

/** Append the anchor quote with the warning rule and the page link. A
 *  question with no anchor (most imported ones) shows none; Show Source in
 *  the actions still opens what it came from. */
function stAppendQuote(parent, q, quote, page, onOpen) {
  if (!quote) return;
  const box = el('div', 'st-quote');
  box.appendChild(el('span', 'st-quote__text', `“${quote}”`));
  if (page || q.sourceUri || q.providerId) {
    const pg = el('button', 'st-quote__pg');
    pg.type = 'button';
    pg.textContent = `${stPageLabel(q, page)} ↗`;
    pg.title = 'Open beside the session (S)';
    pg.addEventListener('click', () => onOpen());
    box.appendChild(pg);
  }
  parent.appendChild(box);
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
  if (onClose) _api.ui.createIconButton(tb, { id: 'study.close', icon: 'x', title: closeTitle || 'Close', size: 'sm', onClick: () => void onClose() });
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

// ── Answers and marking shared by the session, results and review ──────────

/** A registry icon in a span: one of the two elements the kit has no call for. */
function stIconEl(parent, className, id, size) {
  const span = stBlock(parent, 'span', className || null);
  span.innerHTML = icon(id, size);
  return span;
}

/** A multi-line text field, declared to the scene: the other element the kit has no call for. */
function stTextArea(parent, className, value, id, label) {
  const field = el('textarea', className);
  field.value = String(value ?? '');
  stDeclare(field, id, label);
  field.setAttribute('aria-label', label);
  if (parent) parent.appendChild(field);
  return field;
}

/** The rubric points, hit / partial / miss, landing one after another. */
function stRubricEl(rubric, points) {
  const rub = stBlock(null, 'div', 'st-rub');
  // "required" tells points apart; on a rubric where every point is, it would only repeat.
  const mixed = (rubric || []).some((p) => p && p.required) && (rubric || []).some((p) => !(p && p.required));
  (rubric || []).forEach((p, i) => {
    const status = (points && points[i] && points[i].status) || 'miss';
    const pt = stBlock(rub, 'div', `st-rub__pt st-rub__pt--${status}`);
    pt.style.setProperty('--st-i', String(i));
    stIconEl(pt, 'st-rub__g', status === 'hit' ? 'check' : status === 'partial' ? 'minus' : 'x', 12);
    const body = stBlock(pt, 'span', 'st-rub__text');
    body.appendChild(stMd(p && p.text));
    if (mixed && p && p.required) stBlock(body, 'span', 'st-rub__req', 'required');
  });
  return rub;
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
  const shownRubric = v && Array.isArray(v.rubric) && v.rubric.length ? v.rubric : (Array.isArray(q.rubric) ? q.rubric : []);
  const restates = fmt !== 'mc' && v && Array.isArray(v.points) && stNoteRestatesPoint(v.note, shownRubric, v.points);
  if (v && v.note && !restates) {
    const note = el('div', 'st-fb__why');
    note.appendChild(stMd(v.note));
    box.appendChild(note);
  }

  const rightEl = el('div', 'st-review__ans');
  rightEl.appendChild(el('span', 'st-review__lab', 'Right answer'));
  const rightText = q.format === 'mc' ? (options[Number(q.answer)] !== undefined ? options[Number(q.answer)] : String(q.answer)) : String(q.answer || '');
  rightEl.appendChild(stMd(rightText));
  box.appendChild(rightEl);
  stAppendQuote(box, q, q.sourceQuote, q.sourcePage, () => void stShowSource(q));
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
    const token = stActivation();
    try {
      do {
        renderQueued = false;
        if (state.disposed || !stIsCurrent(token)) return;
        disposeView();
        root.innerHTML = '';
        const route = state.route;
        try {
          if (route.view === 'setup') await renderSetup(root, route, ctx);
          else if (route.view === 'newSubject') await renderNewSubject(root, route, ctx);
          else if (route.view === 'progress') await renderProgress(root, route, ctx);
          else if (route.view === 'generating') await renderGenerating(root, route, ctx);
          else if (route.view === 'session') await renderSession(root, route, ctx);
          else if (route.view === 'results') await renderResults(root, route, ctx);
          else if (route.view === 'review') await renderReview(root, route, ctx);
          else if (route.view === 'learn') await renderLearn(root, route, ctx);
          else await renderSetup(root, { view: 'setup', materialIds: [] }, ctx);
        } catch (err) {
          if (state.disposed) return;
          // Study turned off under the view: the pane is going, nothing to say.
          if (!stIsCurrent(token) || stIsStopped(err)) return;
          // Error boundary, as the Flashcards pane: a view that throws says so.
          root.innerHTML = '';
          const box = el('div', 'st-error');
          box.appendChild(el('div', 'st-error__t', 'Study could not open this view.'));
          box.appendChild(el('div', '', String(err && err.message ? err.message : err)));
          const acts = el('div', 'st-row');
          _api.ui.createButton(acts, { id: 'study.retry', label: 'Retry', icon: 'refresh-cw', onClick: () => void render() });
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

/** The scrim, the sheet and its header; returns the body to fill. */
function stSheetFrame(host, ctx, subtitle, { title = 'Study' } = {}) {
  host.appendChild(el('div', 'st-scrim'));
  const sheet = el('div', 'st-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', title);
  host.appendChild(sheet);
  const hd = el('div', 'st-sheet__hd');
  const titles = el('div', '');
  titles.appendChild(el('h3', 'st-sheet__title', title));
  const sub = el('div', 'st-sheet__sub', subtitle);
  sub.title = subtitle;
  titles.appendChild(sub);
  hd.appendChild(titles);
  _api.ui.createIconButton(hd, { id: 'study.sheet.close', icon: 'x', title: 'Cancel', size: 'sm', onClick: () => void ctx.closeTab() });
  sheet.appendChild(hd);
  const bd = stBlock(sheet, 'div', 'st-sheet__bd');
  // A dialog: it takes the focus when it opens, and Esc closes it (a menu open over it closes first, on its own).
  sheet.tabIndex = -1;
  const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); void ctx.closeTab(); } };
  host.addEventListener('keydown', onKey);
  ctx.add({ dispose: () => host.removeEventListener('keydown', onKey) });
  // Modal while it is up: Tab stays among its controls. Closed (its tab gone, not drawn again), the focus goes back to what opened it.
  ctx.add(_api.ui.keepTabInside(sheet, host));
  ctx.add({ dispose: () => { if (ctx.disposed()) stRefocusSubjectOpener(); } });
  setTimeout(() => { if (!ctx.disposed() && sheet.isConnected && !sheet.contains(document.activeElement)) sheet.focus(); }, 0);
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
  const modeSeg = _api.ui.createSegmented(modePair, { id: 'study.setup.mode',
    ariaLabel: 'Mode', items: modes, value: st.mode,
    onChange: (v) => { st.mode = v; sync(); onChange(); },
  });
  modeSeg.element.title = modes.some((m) => m.value === 'learn')
    ? 'Practice marks as you go and lets you retry. Test is typed answers, no retry, results at the end. Learn is the chapter in a page.'
    : 'Practice marks as you go and lets you retry. Test is typed answers, no retry, results at the end.';
  ctx.add(modeSeg);
  answerSeg = _api.ui.createSegmented(answerPair, { id: 'study.setup.answer',
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
  _api.ui.createButton(acts, { id: 'study.setup.cancel', label: 'Cancel', kind: 'ghost', onClick: () => void ctx.closeTab() });
  const startBtn = _api.ui.createButton(acts, { id: 'study.setup.start', label: 'Start', kind: 'primary', onClick: () => void onStart() });
  ft.appendChild(acts);
  sheet.appendChild(ft);

  // A choice left at its default falls back to Settings first (stPickModel,
  // stContextSettingFor), so the line and the menu name what a run will use.
  const setModel = String(cfg('aiModel', '') || '').trim();
  const setContext = Number(cfg('generationContext', 0)) || 0;
  const effectiveModel = () => st.model || setModel || activeModel || (models[0] ? models[0].id : '');
  const modelName = (id) => { const m = models.find((x) => x.id === id); return m ? (m.displayName || m.id) : (id || 'No model'); };
  const paintModel = () => {
    const ctx = st.contextSetting || setContext;
    const ctxLabel = ctx ? `${stFmtK(ctx)} context` : 'Auto context';
    stSetLabel(mdlBtn, `${modelName(effectiveModel())} · ${ctxLabel}`);
  };
  const pick = (patch) => { Object.assign(st, patch); paintModel(); void onPrefs(); };
  // Model and context are set together: every choice keeps the menu open,
  // and a model redraws it, since its maximum decides the sizes offered.
  const limitOf = (id) => { const m = models.find((x) => x.id === id); return m ? Number(m.contextLength) || 0 : 0; };
  let menu = null;
  function menuItems() {
    const items = [{ label: 'Model', disabled: true }];
    const pickModel = (id) => {
      const limit = limitOf(id || setModel || activeModel);
      // A fixed size the new model cannot hold becomes its maximum.
      pick(limit && st.contextSetting > limit ? { model: id, contextSetting: limit } : { model: id });
      menu?.update(menuItems());
    };
    for (const m of models) {
      items.push({ label: m.displayName || m.id, keybinding: stFmtK(m.contextLength), checked: st.model === m.id, keepOpen: true, onSelect: () => pickModel(m.id) });
    }
    items.push(setModel
      ? { label: 'Use the Model in Settings', keybinding: modelName(setModel), checked: !st.model, keepOpen: true, onSelect: () => pickModel('') }
      : { label: "Use the Chat's Model", checked: !st.model, keepOpen: true, onSelect: () => pickModel('') });
    items.push({ separator: true });
    items.push({ label: 'Context', disabled: true });
    items.push(setContext
      ? { label: 'As in Settings', keybinding: stFmtK(setContext), checked: !st.contextSetting, keepOpen: true, onSelect: () => pick({ contextSetting: 0 }) }
      : { label: 'Auto', checked: !st.contextSetting, keepOpen: true, onSelect: () => pick({ contextSetting: 0 }) });
    for (const tokens of stContextSizesFor(limitOf(effectiveModel()))) {
      items.push({ label: stFmtK(tokens), checked: st.contextSetting === tokens, keepOpen: true, onSelect: () => pick({ contextSetting: tokens }) });
    }
    return items;
  }
  function openMenu() {
    menu = _api.ui.showContextMenu(mdlBtn, menuItems(), { anchorPosition: 'above', onClose: () => { menu = null; } });
  }
  paintModel();
  return { startBtn, mdlBtn };
}

async function renderSetup(host, route, ctx) {
  // He is choosing again: the tab of a making that ended with nothing (its session is gone) closes.
  void stCloseGoneSessionTabs();
  if (Array.isArray(route.bankIds) && route.bankIds.length) { await renderBankSetup(host, route, ctx); return; }
  const now = stNow();
  const all = (await stListMaterials()) || [];
  let ids = Array.isArray(route.materialIds) ? route.materialIds.filter((n) => n != null) : [];
  if (!ids.length) ids = all.map((m) => m.id);
  const materials = ids.map((id) => all.find((m) => m.id === id)).filter(Boolean);
  if (!materials.length) {
    const empty = _api.ui.createEmptyState(host, {
      icon: 'px-study',
      headline: 'Nothing to study yet.',
      hint: 'Open a PDF or a notes file and choose Study This Document…, or add one here. A subject keeps its units, questions and work log in databases you can open.',
      action: { id: 'study.addPdf', label: 'Add Document…', onClick: () => void stAddPdfFlow() },
    });
    if (stSubjectDoor()) _api.ui.createButton(empty, { id: 'study.home.newSubject', label: 'New Subject…', icon: 'plus', kind: 'ghost', title: 'A subject: a page with its units, questions and work log.', command: 'study.newSubject' });
    return;
  }
  const primary = materials[0];
  const sections = stHasSections(primary) ? ((await stListSections(primary.id)) || []) : [];
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
    // Empty and 0 mean the default (Settings, else the chat's model and Auto).
    model: stProp(primary, 'model', ''),
    contextSetting: Number(stProp(primary, 'contextSetting', 0)) || 0,
    starting: false,
  };
  if (!['choose', 'type', 'mixed'].includes(st.answer)) st.answer = 'mixed';

  const { sheet, bd } = stSheetFrame(host, ctx, materials.length > 1 ? `${materials.length} materials` : primary.label);

  // Scope row.
  const scopeRow = el('div', 'st-row');
  scopeRow.appendChild(el('span', 'st-row__lab', 'Scope'));
  const scopeSeg = _api.ui.createSegmented(scopeRow, { id: 'study.setup.scope',
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
        input.value = String(st[key]); stDeclare(input, `study.setup.${key}`, key === 'pageTo' ? 'To page' : 'From page');
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
        _stSubjectOpener = null;
        await ctx.closeTab();
        return;
      }
      await stStartSession({ scope, mode: st.mode, answerFormat: st.mode === 'test' ? 'type' : st.answer, model: st.model, numCtx: st.contextSetting });
      _emitDataChanged();
      _stSubjectOpener = null; // the session has the focus now
      await ctx.closeTab();
    } catch (err) {
      st.starting = false;
      startBtn.disabled = false;
      await stSheetStartFailed(sheet, err, () => start());
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
  // One unit of a subject: its bank, narrowed.
  if (route.unit && banks.length === 1) { scope.unit = String(route.unit); scope.label = `${banks[0].name} · ${scope.unit}`; }
  // And to one last result (from a bar of Progress): the same scope, filtered.
  if (ST_PROGRESS_STATES.includes(route.result) && banks.length === 1 && stIsSubjectBank(banks[0])) { scope.result = route.result; scope.label = `${scope.label} · ${ST_PROGRESS_WORDS[route.result]}`; }
  const ofSubject = banks.length === 1 && stIsSubjectBank(banks[0]);
  const questions = ((await stFixedScopeQuestions(scope)) || []).filter((q) => !q.hidden);
  const count = await stCountScopeQuestions(scope);
  const hasChoice = questions.some((q) => q.format === 'mc' && Array.isArray(q.options) && q.options.length);
  const { models, activeModel } = await stSheetModels();
  const configured = String(cfg('answerFormat', 'mixed') || 'mixed');
  const st = {
    mode: 'practice',
    // An essay bank (no choices to pick from) starts on Type.
    answer: !hasChoice ? 'type' : (['choose', 'type', 'mixed'].includes(configured) ? configured : 'mixed'),
    model: '',
    contextSetting: 0,
    starting: false,
  };

  const { sheet, bd } = stSheetFrame(host, ctx, banks.length > 1 ? `${banks.length} banks` : scope.label);
  const origin = stBankOriginText(banks[0], questions);
  bd.appendChild(el('div', 'st-sheet__count', `${count} ${count === 1 ? 'question' : 'questions'} · ${origin}`));
  stModeAnswerRow(bd, ctx, st, {
    modes: [{ value: 'practice', label: 'Practice' }, { value: 'test', label: 'Test' }],
    noChoose: !hasChoice,
    onChange: () => {},
  });
  const { startBtn } = stSheetFooter(sheet, ctx, { models, activeModel, st, onPrefs: async () => {}, onStart: () => start() });
  if (!count) { startBtn.disabled = true; startBtn.title = ofSubject ? 'No question with an answer here yet. Add rows to its Questions database.' : 'This bank has no questions to draw.'; }
  else startBtn.title = `Draws ${Math.min(count, Number(cfg('sessionSize', 20)) || 20)} questions from ${ofSubject ? 'its Questions database' : 'the bank'}.`;

  async function start() {
    if (st.starting || !count) return;
    st.starting = true;
    startBtn.disabled = true;
    try {
      await stStartSession({ scope, mode: st.mode, answerFormat: st.mode === 'test' ? 'type' : st.answer, model: st.model, numCtx: st.contextSetting });
      _emitDataChanged();
      _stSubjectOpener = null; // the session has the focus now
      await ctx.closeTab();
    } catch (err) {
      st.starting = false;
      startBtn.disabled = false;
      await stSheetStartFailed(sheet, err, () => start());
    }
  }
}

/**
 * The sheet's Start failed. With no model: a notice on the sheet, above its
 * footer, with the ways on (Try Again starts again from the sheet as it
 * stands; Open AI Settings when the app offers it). Anything else: the
 * error message, as before.
 */
async function stSheetStartFailed(sheet, err, retry) {
  const old = sheet.querySelector('.st-sheet__notice');
  if (old) old.remove();
  if (!stIsNoModel(err)) {
    try { await _api.window.showErrorMessage(`Could not start: ${stErrText(err)}`); } catch { /* noop */ }
    return;
  }
  const [headline, ...rest] = stSentence(stErrText(err)).split(/(?<=\.)\s+/);
  const settings = await stModelSettingsCommand();
  const notice = _api.ui.createEmptyState(null, { headline, hint: rest.join(' '), action: { id: 'study.noModel.retry', label: 'Try Again', icon: 'refresh-cw', title: 'Look for the model again and start.', onClick: () => void retry() } });
  notice.classList.add('st-sheet__notice');
  notice.setAttribute('role', 'alert');
  if (settings) _api.ui.createButton(notice, { id: 'study.noModel.settings', label: 'Open AI Settings', icon: 'settings', kind: 'ghost', title: 'Where the model and its backend are chosen.', command: settings });
  sheet.insertBefore(notice, sheet.querySelector('.st-sheet__ft'));
}

// ── Session screen ──────────────────────────────────────────────────────────

async function renderSession(host, route, ctx) {
  const session = await stGetSession(route.sessionId);
  // Gone: a making that ended with nothing says so; a tab restored for a session that no longer exists closes.
  if (!session) { if (!stRenderEnded(host, route.sessionId)) await ctx.closeTab(); return; }
  if (stProp(session, 'finishedAt', 0)) { ctx.setRoute({ view: 'results', sessionId: session.id }); return; }
  const scope = stSessionScope(session);
  const allItems = (await stListSessionItems(session.id)) || [];
  if (!allItems.length) { ctx.setRoute({ view: 'generating', sessionId: session.id }); return; }
  const draw = allItems.reduce((m, i) => Math.max(m, Number(i.draw) || 0), 0);
  const drawItems = allItems.filter((i) => (Number(i.draw) || 0) === draw).sort((a, b) => (a.ord || 0) - (b.ord || 0));
  const isPending = (i) => i.status === 'pending' || !i.status;
  const queue = drawItems.filter(isPending);
  // Every question so far is answered: the results, unless more are being written.
  if (!queue.length && !stLiveRun(session.id)) { ctx.setRoute({ view: 'results', sessionId: session.id }); return; }
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
  const main = stBlock(sess, 'div', 'st-sess-main');
  const qwrap = stBlock(main, 'div', 'st-qwrap');
  // An answered question he went back to (Previous) shows here, the live card kept as it was.
  const pastWrap = stBlock(main, 'div', 'st-qwrap st-past');
  // The action row stays in one place from question to question, under the scrolling card.
  const foot = stBlock(sess, 'div', 'st-foot');
  const ctl = stBlock(foot, 'div', 'st-ctl');
  const pastCtl = stBlock(foot, 'div', 'st-ctl');
  pastWrap.hidden = true;
  pastCtl.hidden = true;

  // ── Timing: seconds while the pane is visible, stored every 30 s and on close ──
  let seconds = Number(stProp(session, 'seconds', 0)) || 0;
  // The timer belongs to this activation: once Study goes off it stops, and
  // a save that lands after that is dropped quietly.
  const timerToken = stActivation();
  const saveSeconds = () => {
    if (!stIsCurrent(timerToken)) return;
    stUpdateSession(session.id, { seconds }).catch((err) => { if (stIsCurrent(timerToken) && !stIsStopped(err)) console.warn('[Study] session time not saved:', err); });
  };
  const tick = setInterval(() => {
    if (!stIsCurrent(timerToken)) { clearInterval(tick); return; }
    if (ctx.disposed() || !host.isConnected) return;
    if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return;
    seconds++;
    if (seconds % 30 === 0) saveSeconds();
  }, 1000);
  // The tab closing is told too, with the time as it stands (a subject's Work Log row follows it).
  ctx.add({ dispose: () => { clearInterval(tick); saveSeconds(); if (stIsCurrent(timerToken)) bus.emit('session', { sessionId: session.id, seconds }); } });

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

  // ── Looking back: what he answered, in the order he answered it ──
  const history = drawItems.filter((i) => stItemAnswered(i)).sort((a, b) => ((a.answeredAt || 0) - (b.answeredAt || 0)) || ((a.ord || 0) - (b.ord || 0)));
  const past = { at: -1 };
  // The last answered item before the one on screen (the card on screen is not "before" itself).
  const lastPast = () => history.length - 1 - (current && current.answered && history[history.length - 1] === current.item ? 1 : 0);
  function showPast(k) {
    const item = history[k];
    const q = item && questions.get(item.questionId);
    if (!q) return;
    past.at = k;
    pastWrap.replaceChildren();
    pastCtl.replaceChildren();
    stPastView(pastWrap, { item, q, concept: concepts.get(q.conceptId) || null, isTest, onSource: () => void stShowSource(q) });
    stPastControls(pastCtl, { sessionId: session.id, canBack: k > 0, where: `${k + 1} of ${history.length} answered` });
    qwrap.hidden = true; ctl.hidden = true; pastWrap.hidden = false; pastCtl.hidden = false;
    ctx.root.focus();
  }
  function previous() {
    if (past.at > 0) showPast(past.at - 1);
    else if (past.at < 0 && lastPast() >= 0) { if (current && current.saver) current.saver.flush(); showPast(lastPast()); }
  }
  function forward() {
    if (past.at < 0) return;
    if (past.at < lastPast()) { showPast(past.at + 1); return; }
    past.at = -1;
    pastWrap.replaceChildren(); pastCtl.replaceChildren();
    pastWrap.hidden = true; pastCtl.hidden = true; qwrap.hidden = false; ctl.hidden = false;
    if (current && current.typedField && !current.answered) current.typedField.focus(); else ctx.root.focus();
  }
  const previousButton = () => _api.ui.createButton(ctl, { id: 'study.previousQuestion', label: 'Previous', icon: 'chevron-left', kind: 'ghost',
    disabled: lastPast() < 0, title: 'Previous (←). The question before, as you answered it; nothing there changes the record.', command: 'study.previousQuestion', args: [session.id] });

  // ── Questions that arrive while he answers ──
  // The run puts each question into the session as it is stored and orders
  // the ones still waiting. The pane takes them in without touching the card
  // on screen: what he has passed stays, what he skipped stays last.
  let waiting = false;
  const skipped = new Set();
  let absorbing = Promise.resolve();
  const absorb = () => { absorbing = absorbing.then(absorbNow).catch((err) => { if (!stIsStopped(err)) console.warn('[Study] new questions not shown:', err); }); };
  async function absorbNow() {
    const rows = ((await stListSessionItems(session.id)) || []).filter((i) => (Number(i.draw) || 0) === draw).sort((a, b) => (a.ord || 0) - (b.ord || 0));
    if (ctx.disposed()) return;
    const known = new Map(drawItems.map((i) => [i.id, i]));
    const merged = rows.map((i) => known.get(i.id) || i);
    const added = merged.filter((i) => !known.has(i.id));
    if (added.length) {
      const more = await stQuestionMap(scope, added.map((i) => i.questionId));
      for (const [id, q] of more) questions.set(id, q);
      for (const c of await stSessionConcepts(materialIds, more)) if (!concepts.has(c.id)) concepts.set(c.id, c);
      if (ctx.disposed()) return;
    }
    drawItems.splice(0, drawItems.length, ...merged);
    const head = queue.slice(0, Math.min(index + 1, queue.length));
    const rest = merged.filter((i) => isPending(i) && !head.includes(i));
    queue.splice(0, queue.length, ...head, ...rest.filter((i) => !skipped.has(i.id)), ...rest.filter((i) => skipped.has(i.id)));
    if (waiting) { renderItem(); return; }
    paintStrand(current ? current.item.id : 0);
    if (current && !current.answered) current.skipBtn.disabled = queue.length - index <= 1;
  }

  /** Every question that is ready has been answered, and more are being written (or the writing failed). */
  function showWaiting() {
    current = null;
    waiting = true;
    stSetOnScreen(session.id, 0);
    paintStrand(0);
    qwrap.replaceChildren();
    ctl.replaceChildren();
    if (history.length) previousButton();
    _api.ui.createEmptyState(qwrap, {
      headline: making.failed() ? 'No more questions were made.' : 'The next question is being written…',
      hint: 'Every question that is ready has been answered.',
      action: { id: 'study.session.results', label: 'See Results', icon: 'chart-column', title: 'End here and see the results. Refresh there makes more questions.', onClick: () => void finishDraw() },
    });
    ctx.root.focus();
  }

  function renderItem() {
    if (ctx.disposed()) return;
    while (index < queue.length && !questions.get(queue[index].questionId)) index++;
    if (index >= queue.length) { if (making.live() || making.failed()) showWaiting(); else void finishDraw(); return; }
    waiting = false;
    const item = queue[index];
    const q = questions.get(item.questionId);
    const concept = concepts.get(q.conceptId) || null;
    let fmt = item.formatUsed || '';
    if (!fmt) { try { fmt = stResolveFormat(concept, q, answerFormat); } catch { fmt = ''; } }
    if (!fmt) fmt = q.format || 'mc';
    if (fmt === 'mc' && !(Array.isArray(q.options) && q.options.length)) fmt = 'short';
    // Test is Type: a multiple-choice question is answered as a short typed answer.
    if (isTest && fmt === 'mc') fmt = 'short';
    stSetOnScreen(session.id, item.id);
    const cur = { item, q, concept, fmt, answered: false, retried: false, retryBtn: null, chosen: null, explaining: false, explained: false, busy: false, ungraded: false, typedField: null, editing: false };
    current = cur;
    paintStrand(item.id);
    qwrap.replaceChildren();
    ctl.replaceChildren();

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
      // The concept's name would give the answer away: it shows once he has answered.
      cur.cptEl = stBlock(eyebrow, 'span', 'st-eyebrow__cpt', `Question ${drawItems.indexOf(item) + 1}`);
    }
    const eyeActs = stBlock(eyebrow, 'span', 'st-eyebrow__acts');
    cur.mark = stMarkToggle(eyeActs, q, { sessionId: session.id });
    _api.ui.createIconButton(eyeActs, { id: 'study.editQuestion', icon: 'pencil', title: 'Edit Question…', size: 'sm', command: 'study.editQuestion', args: [session.id] });
    _api.ui.createIconButton(eyeActs, { id: 'study.session.hide', icon: 'thumbs-down', title: 'Hide This Question…', size: 'sm', onClick: () => void hideQuestion() });
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

    cur.prevBtn = previousButton();
    stBlock(ctl, 'span', 'st-sp');
    cur.skipBtn = _api.ui.createButton(ctl, { id: 'study.session.skip',
      label: 'Skip', kind: 'ghost', title: 'Skip (K). Moves this question to the end of the session.',
      disabled: queue.length - index <= 1,
      onClick: () => void skip(),
    });
    cur.skipBtn.appendChild(el('span', 'st-k', 'K'));
    cur.nextBtn = _api.ui.createButton(ctl, { id: 'study.session.next',
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
      field.placeholder = 'Number'; stDeclare(field, 'study.session.answer', 'Answer');
      row.appendChild(field);
      const units = q.numeric && q.numeric.units;
      if (units) row.appendChild(el('span', 'st-ta__units', String(units)));
      ta.appendChild(row);
    } else if (fmt === 'formula') {
      field = el('input', 'st-ta__line');
      field.type = 'text';
      field.placeholder = 'LaTeX or plain text'; stDeclare(field, 'study.session.answer', 'Answer');
      ta.appendChild(field);
    } else if (fmt === 'cloze') {
      field = el('input', 'st-ta__line');
      field.type = 'text';
      field.placeholder = 'The missing term'; stDeclare(field, 'study.session.answer', 'Answer');
      ta.appendChild(field);
    } else {
      field = stTextArea(ta, `st-ta__field${fmt === 'essay' ? ' st-ta__field--essay' : ''}`, '', 'study.session.answer', 'Answer');
      field.placeholder = 'Write it out before it shows.';
    }
    field.setAttribute('aria-label', 'Your answer');
    // What he had typed here before the tab or the app closed; kept as he types.
    field.value = cur.item.draft || '';
    cur.saver = stDraftSaver(cur.item);
    field.addEventListener('input', () => cur.saver.set(field.value));
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

  function feedbackActs(cur, { retry: withRetry, overrule = '', regrade = false }) {
    const acts = stBlock(null, 'div', 'st-fb__acts');
    if (regrade) cur.regradeBtn = _api.ui.createButton(acts, { id: 'study.gradeAgain', label: 'Grade Again', icon: 'refresh-cw', kind: 'ghost', title: 'Grade Again (G). Your answer is marked again as it stands.', command: 'study.gradeAgain', args: [session.id] });
    if (withRetry) cur.retryBtn = _api.ui.createButton(acts, { id: 'study.session.retry', label: 'Retry', icon: 'rotate-ccw', kind: 'ghost', title: 'Retry (R), once. A right answer now still counts as a miss.', onClick: () => retry() });
    // His verdict over the grader's, on a typed answer: the record and the concept follow it.
    const markAs = overrule === 'right' ? 'study.markAnswerRight' : 'study.markAnswerWrong';
    if (overrule) _api.ui.createButton(acts, { id: markAs, label: overrule === 'right' ? 'Mark as Right' : 'Mark as Wrong', icon: overrule === 'right' ? 'check' : 'x', kind: 'ghost',
      title: overrule === 'right' ? 'The grader said wrong; count this answer as right.' : 'The grader said right; count this answer as wrong.', command: markAs, args: [session.id] });
    _api.ui.createButton(acts, { id: 'study.session.source', label: stSourceLabel(cur.q), icon: 'file-text', kind: 'ghost', title: `${stSourceLabel(cur.q)} (S). Opens the page beside the session.`, onClick: () => void showSource() });
    _api.ui.createButton(acts, { id: 'study.session.explain', label: 'Explain', icon: 'message-square', kind: 'ghost', title: 'Explain (E). A short explanation grounded in the anchor.', onClick: () => void explain() });
    if (!regrade) _api.ui.createButton(acts, { id: 'study.discussInChat', label: 'Discuss in Chat', icon: 'messages-square', kind: 'ghost', title: 'Discuss in Chat (D). Opens the chat with the question, your answer, the right answer and the source.', command: 'study.discussInChat', args: [session.id] });
    return acts;
  }

  /** The verdict line: first on the card once he has answered; the concept's name shows now too. */
  function verdictLine(cur, fb, okClass, word, grade) {
    fb.replaceChildren();
    fb.className = `st-fb${okClass}`;
    if (cur.cptEl && cur.concept) cur.cptEl.textContent = cur.concept.title;
    cur.card.classList.add('st-card--answered');
    const verdict = stBlock(fb, 'div', 'st-fb__verdict');
    stBlock(verdict, 'span', 'st-fb__dot');
    stBlock(verdict, 'span', 'st-fb__text', word);
    if (grade) {
      const g = stBlock(verdict, 'span', 'st-fb__grade', '· counts as ');
      stBlock(g, 'strong', '', grade);
    }
  }

  function renderChoiceFeedback(cur, ok, retried) {
    const fb = cur.fb;
    verdictLine(cur, fb, ok ? ' st-fb--ok' : ' st-fb--no', ok ? 'Correct' : 'Not quite', retried ? stRatingWord(AGAIN) : '');
    fb.appendChild(feedbackActs(cur, { retry: !ok && !retried && !isTest }));
    if (!ok && cur.q.explanation) stBlock(fb, 'div', 'st-fb__why').appendChild(stMd(cur.q.explanation));
    stAppendQuote(fb, cur.q, cur.q.sourceQuote, cur.q.sourcePage, () => void showSource());
    showFeedback(fb);
  }

  /** The answer a typed card is marked against: an mc question's right option, else its answer. */
  const fullAnswerOf = (q) => (q.format === 'mc' ? stTestQuestion(q).answer : String(q.answer ?? ''));

  function renderTypedFeedback(cur, result) {
    const q = cur.q;
    const rubric = Array.isArray(result.rubric) ? result.rubric : (Array.isArray(q.rubric) ? q.rubric : []);
    const ok = result.rating >= GOOD;
    const fb = cur.fb;
    verdictLine(cur, fb, ok ? ' st-fb--ok' : ' st-fb--no', result.label, stRatingWord(result.rating));
    fb.appendChild(feedbackActs(cur, { retry: false, overrule: isTest ? '' : ok ? 'wrong' : 'right' }));
    const points = result.verdict && Array.isArray(result.verdict.points) ? result.verdict.points : [];
    if (result.verdict && rubric.length) fb.appendChild(stRubricEl(rubric, points));
    // The note stays only when it adds to the points (nothing said twice).
    if (result.verdict && result.verdict.note && !stNoteRestatesPoint(result.verdict.note, rubric, points)) {
      stBlock(fb, 'div', 'st-fb__why').appendChild(stMd(result.verdict.note));
    }
    // The anchor is the line for the missed point when the rubric carries
    // quotes; else the question's own quote.
    let quote = q.sourceQuote, page = q.sourcePage;
    const missIdx = rubric.findIndex((p, i) => p && p.quote && ((points[i] && points[i].status) || 'miss') !== 'hit');
    if (missIdx >= 0) { quote = rubric[missIdx].quote; page = rubric[missIdx].page || page; }
    stAppendQuote(fb, q, quote, page, () => void showSource());
    const full = fullAnswerOf(q);
    if (full !== '') {
      const d = el('details', 'st-full');
      const s = el('summary', '');
      stIconEl(s, '', 'chevron-right', 12);
      s.appendChild(document.createTextNode('Full answer'));
      d.appendChild(s);
      stBlock(d, 'div', 'st-full__text').appendChild(stMd(full));
      fb.appendChild(d);
    }
    showFeedback(fb);
  }

  function renderGradeError(cur, err) {
    const fb = cur.fb;
    verdictLine(cur, fb, '', 'Could not grade this answer', '');
    fb.appendChild(feedbackActs(cur, { retry: false, regrade: true }));
    stBlock(fb, 'div', 'st-fb__why', `${stSentence(stErrText(err))} Your answer is kept: Grade Again marks it, Next moves on without counting it.`);
    stBlock(fb, 'div', 'st-full__text').appendChild(stMd(fullAnswerOf(cur.q)));
    stAppendQuote(fb, cur.q, cur.q.sourceQuote, cur.q.sourcePage, () => void showSource());
    showFeedback(fb);
  }

  // ── Persistence: every answer lands before the UI moves on ──
  async function commitAnswer(cur, { status, chosen, typed, verdict, correct, rating, retried }) {
    const now = stNow();
    const q = cur.q, fmt = cur.fmt;
    await stAnswerItem(cur.item.id, { status, chosen, typed, verdict, retried, formatUsed: fmt }, now);
    cur.answerId = await stLogAnswer({ questionId: q.id, conceptId: q.conceptId, sessionId: session.id, formatUsed: fmt, correct: correct ? 1 : 0, rating, retried }, now);
    // Where the concept stood before this answer counted: an overrule starts from here.
    cur.conceptBefore = cur.concept;
    if (cur.concept) {
      const nextConcept = stApplyAnswer(cur.concept, { correct, rating, formatUsed: fmt, retried }, now);
      await stUpdateConcept(nextConcept);
      concepts.set(nextConcept.id, nextConcept);
      cur.concept = nextConcept;
    }
    Object.assign(cur.item, { status, chosen, typed, verdict, retried, formatUsed: fmt, answeredAt: now });
    if (!history.includes(cur.item)) history.push(cur.item);
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
    cur.typedField.readOnly = true;
    cur.nextBtn.disabled = true;
    cur.answered = true;
    cur.typed = text;
    const now = stNow();
    try {
      await stAnswerItem(cur.item.id, { status: 'answered', chosen: '', typed: text, verdict: null, retried: 0, formatUsed: cur.fmt }, now);
      Object.assign(cur.item, { status: 'answered', typed: text, formatUsed: cur.fmt, answeredAt: now });
      if (!history.includes(cur.item)) history.push(cur.item);
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
    // Read only, not disabled: his answer stays legible (and selectable) while it is marked.
    cur.typedField.readOnly = true;
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
    cur.result = result;
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

  /** Grading failed: his answer is still in the box; mark it again as it stands. */
  function gradeAgain() {
    const cur = current;
    if (!cur || !cur.ungraded || cur.busy) return;
    cur.ungraded = false;
    cur.answered = false;
    cur.fb.classList.remove('st-fb--show');
    void check();
  }

  /** His verdict over the grader's (a typed answer only): the item, the answer row and the concept follow. */
  async function overruleAnswer(to) {
    const cur = current;
    if (!cur || !cur.answered || cur.busy || cur.fmt === 'mc' || isTest || !cur.result) return;
    cur.busy = true;
    try {
      const r = await stOverruleAnswer({ sessionId: session.id, item: cur.item, answerId: cur.answerId, before: cur.conceptBefore, fmt: cur.fmt, to, verdict: stStoredVerdict(cur.result) });
      if (r.concept) { concepts.set(r.concept.id, r.concept); cur.concept = r.concept; }
      cur.result = { ...cur.result, rating: r.rating, label: r.stored.label };
      if (current !== cur || ctx.disposed()) return;
      renderTypedFeedback(cur, cur.result);
      pulseSeg(cur.item.id, to === 'right' ? 'ok' : 'no');
    } finally { cur.busy = false; }
    ctx.root.focus();
  }

  /** His wording and his answer for the question, kept in the bank; the card shows them at once. */
  function editQuestion(step) {
    const cur = current;
    if (cur && cur.editing && cur.editForm) { if (step === 'save') cur.editForm.submit(); else if (step === 'cancel') cur.editForm.cancel(); return; }
    if (!cur || cur.busy || cur.editing || step) return;
    cur.editing = true;
    if (cur.saver) cur.saver.flush();
    // The form is the one thing to act on while it is open: the card and the action row step aside.
    cur.card.hidden = true;
    cur.fb.hidden = true;
    ctl.hidden = true;
    const close = (q2) => {
      cur.editForm.element.remove();
      cur.editForm = null;
      cur.editing = false;
      ctl.hidden = past.at >= 0;
      if (current !== cur || ctx.disposed()) return;
      if (q2 && !cur.answered) { renderItem(); return; }
      if (q2) {
        cur.card.querySelector('.st-card__q').replaceChildren(stMd(q2.stem));
        cur.card.querySelectorAll('.st-opt__text').forEach((t, i) => t.replaceChildren(stMd((q2.options || [])[i] ?? '')));
      }
      cur.card.hidden = false;
      cur.fb.hidden = false;
      if (cur.typedField && !cur.answered) cur.typedField.focus(); else ctx.root.focus();
    };
    cur.editForm = stEditForm(qwrap, cur.q, { sessionId: session.id, before: cur.card, onCancel: () => close(null), onSave: async (patch) => {
      const q2 = await stSaveQuestionEdit(cur.q, patch);
      questions.set(q2.id, q2);
      cur.q = q2;
      close(q2);
    } });
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
    // Asked once per card; Enter after it moves on (the pane takes the focus back from the button).
    if (!cur || !cur.answered || cur.explaining || cur.explained) return;
    cur.explaining = true;
    ctx.root.focus();
    let block = cur.fb.querySelector('.st-explain');
    if (!block) {
      block = stBlock(null, 'div', 'st-explain');
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
      block.replaceChildren(stMd(String(full || text || 'Nothing to add: the anchor says it.')));
      cur.explained = true;
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
    skipped.add(cur.item.id);
    queue.splice(index, 1);
    queue.push(cur.item);
    await leave(cur);
    cur.busy = false;
    renderItem();
  }

  function leave(cur) {
    if (cur.saver) cur.saver.flush();
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
    stStopRun(session.id);
    await stUpdateSession(session.id, { position: drawItems.length, finishedAt: stNow(), seconds });
    bus.emit('session', { sessionId: session.id, seconds });
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
    stStopRun(session.id);
    await stUpdateSession(session.id, { finishedAt: stNow(), seconds });
    bus.emit('session', { sessionId: session.id, seconds });
    _emitDataChanged();
    ctx.setRoute({ view: 'results', sessionId: session.id });
  }

  // ── Keys, scoped to the focusable pane root ──
  const onKey = (e) => {
    const cur = current;
    const t = e.target;
    const onControl = !!(t && typeof t.closest === 'function' && t.closest('button, summary, a'));
    // Looking back: Enter or → goes forward, ← further back, Esc back to the question he was on.
    if (past.at >= 0) {
      if (e.key === 'Escape') { e.preventDefault(); past.at = lastPast(); forward(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && onControl) return;
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); forward(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); previous(); }
      return;
    }
    // Waiting for the next question: Esc still asks to end.
    if (!cur) { if (waiting && e.key === 'Escape') { e.preventDefault(); void endSession(); } return; }
    if (cur.editing) return; // the form takes its own keys
    const inField = (typeof HTMLInputElement !== 'undefined' && t instanceof HTMLInputElement) || (typeof HTMLTextAreaElement !== 'undefined' && t instanceof HTMLTextAreaElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      // The first Esc closes the source Show Source opened beside the
      // session; only with no source open does Esc ask to end.
      if (source.open) { void closeSource(); return; }
      void endSession();
      return;
    }
    if (inField || ((e.key === 'Enter' || e.key === ' ') && onControl)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); previous(); return; }
    if (cur.fmt === 'mc' && /^[1-5]$/.test(e.key)) { e.preventDefault(); void choose(Number(e.key) - 1); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (cur.fmt !== 'mc' && !cur.answered) void check(); else void next(); return; }
    const k = String(e.key).toLowerCase();
    if (k === 's') { if (cur.answered) { e.preventDefault(); void showSource(); } return; }
    if (k === 'r') { if (cur.retryBtn) { e.preventDefault(); retry(); } return; }
    if (k === 'e') { if (cur.answered) { e.preventDefault(); void explain(); } return; }
    if (k === 'k') { if (!cur.answered) { e.preventDefault(); void skip(); } return; }
    if (k === 'm') { e.preventDefault(); void cur.mark.toggle(); return; }
    if (k === 'g') { if (cur.ungraded) { e.preventDefault(); gradeAgain(); } return; }
    if (k === 'd') { if (cur.answered && !cur.ungraded) { e.preventDefault(); void stDiscussInChat(cur.q, stItemAsShown(cur)); } return; }
  };
  ctx.root.addEventListener('keydown', onKey);
  ctx.add({ dispose: () => { ctx.root.removeEventListener('keydown', onKey); if (current && current.saver) current.saver.flush(); stSetOnScreen(session.id, 0); } });
  // What the session's commands (Previous Question, Mark Question…, Edit Question…) do on this screen.
  ctx.add(stOfferSessionActions(session.id, ctx.root, {
    previous, edit: editQuestion, gradeAgain, overrule: (to) => void overruleAnswer(to),
    next: () => { if (past.at >= 0) forward(); else if (current && current.fmt !== 'mc' && !current.answered) void check(); else void next(); },
    mark: () => { if (current && current.mark) void current.mark.toggle(); },
    discuss: () => { if (past.at < 0 && current && current.answered && !current.ungraded) void stDiscussInChat(current.q, stItemAsShown(current)); },
  }));

  const making = stMakingStrip(sess, session, ctx, { before: main, size: Number(stProp(session, 'size', 0)) || Number(cfg('sessionSize', 20)) || 20, onFed: absorb });
  renderItem();
  if (making.live()) absorb(); // what arrived while this screen was being built
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
  // One row per missed concept, its note from the most recent miss.
  const missed = (Array.isArray(summary.missedConcepts) ? summary.missedConcepts : []).map((m) => ({ ...m, note: m.note || stMissedNote(enriched.find((i) => i.questionId === m.questionId && i.status === 'wrong'), questions.get(m.questionId)) }));
  const cov = stCoverageOf(scopeConcepts, now);
  const size = drawItems.length || Number(stProp(session, 'size', 0)) || 0;
  const sessionSize = Number(stProp(session, 'size', 0)) || Number(cfg('sessionSize', 20)) || 20;
  const refreshes = Number(stProp(session, 'refreshes', 0)) || 0;
  const answerFormat = stProp(session, 'answerFormat', 'mixed');
  const flashcards = await stFlashcardsAvailable();
  // Every question in scope asked: the next Refresh repeats, missed first.
  const earlier = new Set(allItems.filter((i) => (Number(i.draw) || 0) < draw).map((i) => i.questionId));
  let willRepeat = false;
  try { willRepeat = await stRefreshWillRepeat({ ...session, scope }, { drewRepeats: drawItems.some((i) => earlier.has(i.questionId)) }); } catch { willRepeat = false; }
  let repeatLine = '';
  if (willRepeat) {
    try { repeatLine = stRepeatLineText(await stScopeUnseenCount({ ...session, scope })); } catch { repeatLine = stRepeatLineText(0); }
  }

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
  // The refresh count only once there is one to count.
  const refreshText = refreshes > 0 ? ` · ${refreshes} ${refreshes === 1 ? 'refresh' : 'refreshes'} so far` : '';
  if (isBank) {
    under.appendChild(document.createTextNode(`${scope.label || session.name}${refreshText}`));
  } else {
    under.appendChild(document.createTextNode(`${scope.label || session.name} is `));
    under.appendChild(el('b', '', `${cov.clean} of ${cov.total} concepts clean`));
    under.appendChild(document.createTextNode(` · ${Math.max(0, cov.total - cov.clean)} to go${refreshText}`));
  }
  if (willRepeat) under.appendChild(document.createTextNode(` · ${repeatLine}`));
  left.appendChild(under);
  top.appendChild(left);
  const acts = el('div', 'st-res__acts');
  if (flashcards) {
    const sendBtn = _api.ui.createButton(acts, { id: 'study.results.sendToFlashcards',
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
  _api.ui.createButton(acts, { id: 'study.results.refresh',
    label: 'Refresh', icon: 'refresh-cw', kind: 'primary', title: willRepeat ? `Draws ${sessionSize} again from the same scope, missed questions first.` : `Draws the next ${sessionSize} from the same scope, weak concepts first.`,
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
      const stEl = el('span', `st-mrow__st${m.secondMiss || m.count > 1 ? ' st-mrow__st--w' : ''}`);
      stEl.appendChild(el('i', ''));
      stEl.appendChild(document.createTextNode(stMissedStatusText(m)));
      row.appendChild(stEl);
      missedBox.appendChild(row);
    }
    res.appendChild(missedBox);
  }

  const ft = el('div', 'st-res__ft');
  // Said once: when the under line says Refresh repeats, the footer does not say otherwise.
  ft.appendChild(el('span', 'st-res__lhs', willRepeat ? '' : `Refresh draws the next ${sessionSize}, weak concepts first.`));
  if (!isTest) _api.ui.createButton(ft, { id: 'study.results.review', label: 'Review Answers', kind: 'ghost', onClick: () => ctx.setRoute({ view: 'review', sessionId: session.id }) });
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
  const sections = stHasSections(material) ? ((await stListSections(material.id)) || []) : [];
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
  _api.ui.createButton(ft, { id: 'study.learn.practice',
    label: 'Practice This Chapter', kind: 'primary',
    onClick: () => void stOpenSetup({ materialIds: [material.id], sectionId: section ? section.id : undefined }),
  });
  learn.appendChild(ft);
}
