// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 55: MAKING, ON SCREEN — the run, the screen before the first question, the strip beside it after
// ═══════════════════════════════════════════════════════════════════════════════
//
// A session's questions are made by one run (stRunFor), which outlives the
// pane (the workbench rebuilds a pane on every tab switch). Until the first
// question is ready the tab shows renderGenerating: what is happening, how
// many are made, the time elapsed, Stop. From the first question on the tab
// is the session itself and the same run shows as a strip under its toolbar
// (stMakingStrip) while he answers. A making that ends with nothing leaves
// no session behind: the tab says what happened and how to go on.
//
// Everything here is drawn with the kit: layout and text through
// api.ui.createBlock (stBlock), buttons that run a command (study.stopMaking,
// study.makeAgain, study.open), so each is in the scene and the palette.

/** A layout or text element from the kit (api.ui.createBlock). */
function stBlock(parent, tag, className, text) {
  return _api.ui.createBlock(parent, tag, { className, ...(text != null ? { text } : {}) });
}

// ── In-flight runs, kept across pane rebuilds ───────────────────────────────

const _stRuns = new Map();

/** What a making that ended with nothing said, by session id: the session is gone, the tab still shows it. */
const _stEnded = new Map();

/** Elapsed time as he reads it: 0:07, 12:05, 1:02:03. Pure. */
function stElapsedText(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** What a run is doing right now, in words, from its last progress payload. `names` false leaves the concept out (the session screen: a concept is not named before its question is answered). */
function stRunNowText(p, run, { names = true } = {}) {
  if (run.token.cancelled && !run.done) return 'Stopping…';
  if (run.done) return '';
  const phase = String(p.phase || '');
  const concept = names && p.concept ? `"${p.concept}"` : '';
  const w = p.writing && typeof p.writing === 'object' ? p.writing : null;
  // Streaming: nothing yet means the model is still loading or reading.
  const stream = !w ? ''
    : w.chars > 0 ? `, about ${Math.max(1, Math.round(w.chars / 6))} words so far`
    : w.thinking > 0 ? ', thinking'
    : ', waiting for the model';
  if (phase === 'map') {
    const part = Number(p.parts) > 1 ? `, part ${p.part} of ${p.parts}` : '';
    return `Finding the concepts in the material${part}${stream}`;
  }
  if (phase === 'generate') return w ? `Writing questions${concept ? ` on ${concept}` : ''}${stream}` : 'Preparing the next questions';
  if (phase.startsWith('check:')) {
    const what = { anchor: 'Finding the quote in the material', support: 'Checking the quote supports the answer', distractor: 'Checking the wrong options', numeric: 'Running the calculation' }[phase.slice(6)] || 'Checking a question';
    return `${what}${concept ? ` for ${concept}` : ''}`;
  }
  if (phase === 'rubric') return 'Writing marking guides';
  return 'Starting';
}

/** The session's run, started when there is none. `held` is how many questions its draw holds so far. */
function stRunFor(session) {
  let run = _stRuns.get(session.id);
  if (run) return run;
  const token = { cancelled: false };
  // The activation this run belongs to: once Study goes off (or off and on
  // again) its progress and its end are nobody's, and it reports neither.
  const activation = stActivation();
  run = {
    token,
    progress: { phase: '', done: 0, total: 0, written: 0, kept: 0, available: null, dropped: {} },
    listeners: new Set(),
    done: false, result: null, error: null, promise: null,
    held: 0, startedAt: Date.now(), endedAt: 0,
  };
  const notify = () => {
    if (activation !== stActivation()) return;
    for (const fn of [...run.listeners]) { try { fn(); } catch { /* noop */ } }
  };
  const onProgress = (p) => {
    if (activation !== stActivation()) { token.cancelled = true; return; }
    if (p && typeof p === 'object') {
      const dropped = p.dropped && typeof p.dropped === 'object' ? { ...run.progress.dropped, ...p.dropped } : run.progress.dropped;
      Object.assign(run.progress, p, { dropped });
    }
    notify();
  };
  run.onProgress = onProgress;
  run.notify = notify;
  run.promise = Promise.resolve()
    .then(() => stFillSession(session, { token, onProgress, onFed: (held) => { run.held = held; notify(); } }))
    .then((r) => { run.result = r || null; }, (err) => {
      // Study went off under the run: it stopped, it did not fail.
      if (activation !== stActivation() || stIsStopped(err)) { token.cancelled = true; return; }
      run.error = err;
    })
    .then(() => {
      run.done = true;
      run.endedAt = Date.now();
      if (_stRuns.get(session.id) === run) _stRuns.delete(session.id);
      notify();
    });
  _stRuns.set(session.id, run);
  return run;
}

/** The session's run while it is still making, else null. */
function stLiveRun(sessionId) {
  const run = _stRuns.get(sessionId);
  return run && !run.done ? run : null;
}

/** Stop a session's making (Stop, End Session): what is in the session stays. With no id, every making. */
function stStopRun(sessionId) {
  for (const [id, run] of _stRuns) {
    if (sessionId != null && Number(sessionId) !== Number(id)) continue;
    run.token.cancelled = true;
    run.notify();
  }
}

/**
 * Make a session's questions again (Try Again). A session that is there
 * goes on from what it holds, in its own tab; one whose making ended with
 * nothing (it was removed) starts over with the same choices, and its tab
 * closes. With no id: the making that ended with nothing most recently.
 */
async function stMakeAgain(sessionId) {
  const id = sessionId != null ? Number(sessionId) : [..._stEnded.keys()].pop();
  const session = id != null ? await stGetSession(id) : null;
  if (session) {
    _stEnded.delete(session.id);
    stRunFor(session);
    bus.emit('making', { sessionId: session.id });
    return session;
  }
  const ended = id != null ? _stEnded.get(id) : null;
  if (!ended) {
    await _api.window.showInformationMessage('No session is waiting for questions.');
    return null;
  }
  const started = await stStartOrSay(ended.start);
  if (started) { _stEnded.delete(id); await stCloseGoneSessionTabs(); }
  return started;
}

/** Stop every in-flight draw (deactivate): their tokens are cancelled, so the
 *  pipeline stops at its next check and nothing keeps writing. */
function stCancelRuns() {
  for (const run of _stRuns.values()) { try { run.token.cancelled = true; } catch { /* noop */ } }
  _stRuns.clear();
  _stEnded.clear();
}

/** Close every session tab whose session no longer exists (deleted from the
 *  sidebar, or with its material or bank), stopping its draw first: a tab
 *  left open would keep answering into rows that are gone. */
async function stCloseGoneSessionTabs() {
  const editors = Array.isArray(_api && _api.editors && _api.editors.openEditors) ? _api.editors.openEditors : [];
  for (const e of editors) {
    const m = /:study:session-(\d+)$/.exec(String((e && e.id) || ''));
    if (!m) continue;
    const id = Number(m[1]);
    if (await stGetSession(id)) continue;
    const run = _stRuns.get(id);
    if (run) { run.token.cancelled = true; _stRuns.delete(id); }
    _stEnded.delete(id);
    try { await _api.editors.closeEditor(e.id); } catch { /* already closed */ }
  }
}

/** Call `paint` on every change of the run, and once a second while it is live (the elapsed time). */
function stWatchRun(run, ctx, paint) {
  const listener = () => paint();
  run.listeners.add(listener);
  const tick = setInterval(() => { if (run.done || ctx.disposed()) clearInterval(tick); else paint(); }, 1000);
  const off = { dispose: () => { run.listeners.delete(listener); clearInterval(tick); } };
  ctx.add(off);
  return off;
}

// ── A making that ended with nothing ────────────────────────────────────────

/**
 * What a making that ended with nothing shows, from what was remembered of
 * it (the session itself is gone): what happened, Try Again (the same
 * choices, in a tab of its own; this one closes) and Open Setup…. Read out
 * when it appears (role="alert"). False when nothing is remembered.
 */
function stRenderEnded(host, sessionId) {
  const ended = _stEnded.get(sessionId);
  if (!ended) return false;
  host.replaceChildren();
  const again = { id: 'study.making.again', label: ended.stopped ? 'Start Again' : 'Try Again', icon: 'refresh-cw', title: 'Make the questions again, with the same choices.', command: 'study.makeAgain', args: [sessionId] };
  const setupLabel = ended.setup.bankIds ? 'Study This Bank…' : 'Open Setup…';
  const setupTitle = 'Choose the scope, the mode and the model again.';
  const setup = { id: 'study.making.setup', label: setupLabel, icon: 'px-study', title: setupTitle, command: 'study.open', args: [ended.setup] };
  const box = _api.ui.createEmptyState(host, { icon: ended.setup.bankIds ? 'database' : 'px-study', headline: ended.headline, hint: ended.hint, action: ended.retry ? again : setup });
  box.classList.add('st-ended');
  box.setAttribute('role', 'alert');
  if (ended.retry) _api.ui.createButton(box, { id: 'study.making.setup', label: setupLabel, icon: 'px-study', kind: 'ghost', title: setupTitle, command: 'study.open', args: [ended.setup] });
  return true;
}

// ── The screen before the first question ────────────────────────────────────

const ST_CHECK_ROWS = [
  { key: 'anchor', label: 'Anchor is on the page', setting: 'checkAnchor' },
  { key: 'support', label: 'Anchor settles the answer', setting: 'checkSupport' },
  { key: 'distractor', label: 'No wrong option is defensible', setting: 'checkDistractors' },
  { key: 'numeric', label: 'Numeric answers execute', setting: 'checkNumeric' },
];

async function renderGenerating(host, route, ctx) {
  const session = await stGetSession(route.sessionId);
  if (!session) {
    // A making that ended with nothing: its message; a tab restored for a session that is gone closes.
    if (!stRenderEnded(host, route.sessionId)) await ctx.closeTab();
    return;
  }
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

  const gen = stBlock(host, 'div', 'st-gen');
  // A bank is never written to: the screen only bridges the draw.
  const isBank = stFixedScope(scope);
  stBlock(gen, 'div', 'st-gen__t', `${isBank ? 'Drawing from' : 'Making questions for'} ${scope.label || session.name}`);
  const pages = isBank ? 'Question bank' : scope.pageFrom ? `Pages ${scope.pageFrom} to ${scope.pageTo || scope.pageFrom}` : (primary && stProp(primary, 'pageCount', 0) ? `${stProp(primary, 'pageCount', 0)} pages` : (materialIds.length > 1 ? `${materialIds.length} materials` : 'Whole document'));
  const sub = stBlock(gen, 'div', 'st-gen__s');
  const now = isBank ? stBlock(null, 'div', 'st-gen__now') : stBlock(gen, 'div', 'st-gen__now');
  const fill = stBlock(stBlock(gen, 'div', 'st-gen__bar'), 'span', 'st-gen__fill');
  const line = stBlock(gen, 'div', 'st-genline');
  const checks = stBlock(isBank ? null : gen, 'div', 'st-checks');
  const checkRow = (key, label) => {
    const ck = stBlock(null, 'div', 'st-ck');
    ck.dataset.check = key;
    const dot = stBlock(ck, 'span', 'st-ck__d st-ck__d--idle');
    stBlock(ck, 'span', '', label);
    return { ck, dot, n: stBlock(ck, 'span', 'st-ck__n', '') };
  };
  const rows = new Map();
  for (const def of ST_CHECK_ROWS) {
    const row = checkRow(def.key, def.label);
    checks.appendChild(row.ck);
    rows.set(def.key, { dot: row.dot, n: row.n, on: cfg(def.setting, true) !== false });
  }
  // Model output that could not be read as a question (unparseable or
  // invalid): not a check, so no running dot, and a row only once it counts.
  const unusable = checkRow('parse', 'Unusable model output');
  const acts = stBlock(gen, 'div', 'st-gen__acts');
  stBlock(acts, 'span', 'st-gen__hint', isBank ? '' : 'The session opens on the first question as soon as it is ready.');
  const stopBtn = _api.ui.createButton(acts, { id: 'study.generating.stop', label: 'Stop', icon: 'circle-stop', kind: 'ghost', title: 'Stop writing. What is kept stays in the bank.', command: 'study.stopMaking', args: [session.id] });

  const run = stRunFor(session);
  let settling = false;
  const paint = () => {
    if (ctx.disposed() || settling) return;
    const p = run.progress;
    const ready = Math.min(size, run.held);
    sub.textContent = `${pages}${concepts.length ? ` · ${concepts.length} ${concepts.length === 1 ? 'concept' : 'concepts'}` : ''}${modelId ? ` · ${modelId}` : ''}`;
    // Before the first question there is no count to draw: the bar follows the run's own steps.
    const total = Number(p.total) || 0;
    fill.style.width = `${total ? Math.min(100, Math.round(((Number(p.done) || 0) / total) * 100)) : 0}%`;
    now.textContent = stRunNowText(p, run);
    const dropped = p.dropped || {};
    const droppedTotal = Object.values(dropped).reduce((a, b) => a + (Number(b) || 0), 0);
    line.replaceChildren();
    const part = (b, rest) => { const s = stBlock(line, 'span', ''); stBlock(s, 'strong', '', b); s.appendChild(document.createTextNode(` ${rest}`)); };
    part(String(Number(p.kept) || 0), 'kept');
    part(String(droppedTotal), 'dropped');
    if (!isBank) part(`${ready} of ${size}`, 'ready');
    part(stElapsedText((run.endedAt || Date.now()) - run.startedAt), 'elapsed');
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
    const parsed = Number(dropped.parse) || 0;
    if (parsed > 0) {
      unusable.n.textContent = `${parsed} dropped`;
      if (!unusable.ck.parentNode) checks.appendChild(unusable.ck);
    } else if (unusable.ck.parentNode) unusable.ck.remove();
    stopBtn.disabled = run.done || run.token.cancelled;
    if (run.held > 0 || run.done) void settle();
  };

  // The first question is in the session, or the run is over: the session, or what happened.
  const settle = async () => {
    if (settling || ctx.disposed()) return;
    settling = true;
    try {
      const after = (await stListSessionItems(session.id)) || [];
      if (ctx.disposed()) return;
      if (after.some((i) => i.status === 'pending')) {
        _emitDataChanged();
        ctx.setRoute({ view: 'session', sessionId: session.id });
        return;
      }
      if (!run.done) { settling = false; return; }
      const stopped = !!run.token.cancelled;
      const noModel = stIsNoModel(run.error);
      const unreadable = Number(run.result && run.result.unreadable) || 0;
      const ended = {
        headline: run.error ? (noModel ? 'No model is available.' : 'Could not make questions.')
          : stopped ? 'Stopped before any question was ready.'
          : isBank ? 'This bank has no question to draw.'
          : unreadable ? 'The model\'s replies could not be read.'
          : 'No questions could be made.',
        hint: run.error ? (noModel ? 'Start the model backend, or choose a model in AI Settings, then try again.' : stSentence(stErrText(run.error)))
          : stopped ? 'What was kept stays in the bank.'
          : isBank ? 'A question needs an answer or a rubric to be marked.'
          : unreadable ? `It was asked ${ST_LIST_ASKS} times and never answered with the list it was asked for. Try again, or try another model on the sheet.`
          : `${stUnreadText(run.result && run.result.unread)} Nothing passed the checks. Try another model on the sheet, or a smaller scope.`.trim(),
        stopped,
        retry: !!run.error || !isBank,
        start: { scope, mode: session.mode, answerFormat: stProp(session, 'answerFormat', 'mixed'), model: stProp(session, 'model', ''), numCtx: Number(stProp(session, 'numCtx', 0)) || 0 },
        setup: isBank ? { bankIds: scope.bankIds || [] } : { materialIds, sectionId: scope.sectionIds && scope.sectionIds[0] },
      };
      // A session that never held a question is not kept: no empty row in the sidebar, nothing to reopen.
      _stEnded.set(session.id, ended);
      if (!after.length) await stDeleteSession(session.id);
      if (ctx.disposed()) return;
      stRenderEnded(host, session.id);
    } catch (err) {
      if (ctx.disposed() || stIsStopped(err)) return;
      host.replaceChildren();
      _api.ui.createEmptyState(host, { icon: 'px-study', headline: 'Could not make questions.', hint: stSentence(stErrText(err)) });
    }
  };

  stWatchRun(run, ctx, paint);
  // Try Again on a session that is still there starts a new run: the screen starts over with it.
  const offMaking = bus.on('making', (d) => { if (d && Number(d.sessionId) === Number(session.id) && run.done) ctx.rerender(); });
  ctx.add({ dispose: () => stOff(offMaking) });
  const offRun = bus.on('run', (d) => {
    // Only this session's run: another tab's generation says nothing here.
    if (!d || typeof d !== 'object' || d.sessionId == null || Number(d.sessionId) !== Number(session.id)) return;
    run.onProgress(d);
  });
  ctx.add({ dispose: () => stOff(offRun) });
  paint();
}

// ── The strip beside the questions ──────────────────────────────────────────

/**
 * The making, shown in the session while he answers: what is happening, how
 * many questions are ready of how many are planned, the time elapsed, Stop.
 * Hidden when nothing is being made. A making that failed stays, with its
 * reason and Try Again; one that ended with pages the model could not read
 * stays, saying which (stUnreadText). `onFed()` is called whenever the session holds more
 * questions than before, and when the making ends. Returns { live(), failed() }.
 */
function stMakingStrip(host, session, ctx, { before = null, size, onFed }) {
  const strip = stBlock(null, 'div', 'st-making');
  strip.hidden = true;
  const now = stBlock(strip, 'span', 'st-making__now');
  // The count is the part read out as it changes; the words beside it change too often for that.
  const count = _api.ui.createBlock(strip, 'span', { className: 'st-making__n', attrs: { role: 'status' } });
  const time = stBlock(strip, 'span', 'st-making__t');
  // Read out when it appears: pages of the material the model could not read.
  const note = _api.ui.createBlock(strip, 'span', { className: 'st-making__now', attrs: { role: 'status' } });
  const stopBtn = _api.ui.createButton(strip, { id: 'study.making.stop', label: 'Stop', icon: 'circle-stop', kind: 'ghost', size: 'sm', title: 'Stop writing questions. The ones that are ready stay in this session.', command: 'study.stopMaking', args: [session.id] });
  const againBtn = _api.ui.createButton(strip, { id: 'study.making.more', label: 'Try Again', icon: 'refresh-cw', kind: 'ghost', size: 'sm', title: 'Go on writing questions for this session.', command: 'study.makeAgain', args: [session.id] });
  host.insertBefore(strip, before);

  let run = null;
  let watch = null;
  let seen = 0;
  const paint = () => {
    if (ctx.disposed() || !run) return;
    const failed = run.done && !!run.error;
    // Pages the model could not read are said once the making ends (asked again next start, or left out).
    const unread = run.done && !failed ? stUnreadText(run.result && run.result.unread) : '';
    strip.hidden = run.done && !failed && !unread;
    strip.classList.toggle('st-making--failed', failed);
    now.textContent = failed ? `No more questions could be made: ${stSentence(stErrText(run.error))}` : unread ? '' : stRunNowText(run.progress, run, { names: false });
    if (note.textContent !== unread) note.textContent = unread;
    const text = `${Math.min(size, run.held)} of ${size} ready`;
    if (count.textContent !== text) count.textContent = text;
    time.textContent = `${stElapsedText((run.endedAt || Date.now()) - run.startedAt)} elapsed`;
    stopBtn.hidden = run.done;
    stopBtn.disabled = run.token.cancelled;
    againBtn.hidden = !failed;
    if (run.held !== seen || run.done) { seen = run.held; onFed(); }
  };
  const attach = (next) => {
    if (!next || next === run) return;
    if (watch) watch.dispose();
    run = next;
    seen = run.held;
    watch = stWatchRun(run, ctx, paint);
    paint();
  };
  attach(stLiveRun(session.id));
  // Try Again started a new run for this session: the strip follows it.
  const offMaking = bus.on('making', (d) => { if (d && Number(d.sessionId) === Number(session.id)) attach(stLiveRun(session.id)); });
  ctx.add({ dispose: () => stOff(offMaking) });
  return { live: () => !!run && !run.done, failed: () => !!run && run.done && !!run.error };
}
