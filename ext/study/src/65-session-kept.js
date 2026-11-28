// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 65: THE SESSION, HIS TO CORRECT — looking back, marks, edits, his verdict, drafts
// ═══════════════════════════════════════════════════════════════════════════════
//
// What renderSession (60-pane.js) draws beside the live card:
//   - stPastView: an answered question as it was (his answer, the verdict,
//     the quote), read only: nothing on it writes to the record.
//   - stMarkToggle: the mark to come back to a question (kept in the
//     database, so a restart keeps it; the sidebar's Marked studies them).
//   - stEditForm / stSaveQuestionEdit: his wording and his answer for a
//     question, kept in the bank.
//   - stOverruleAnswer: his verdict over the grader's on a typed answer; the
//     item, the answer row and the concept follow it, the concept from where
//     it stood before this answer counted.
//   - stDraftSaver: the half-typed answer, written to the item as he types.
// Everything here is drawn with the kit (createBlock, kit buttons); the two
// elements the kit has no call for (a multi-line field, an icon) come from
// stTextArea and stIconEl in 60-pane.js. Each control runs a command
// (Previous Question, Mark Question…, Edit Question…, Mark Answer as Right…),
// so it is in the palette and the keybindings too: the command reaches the
// session screen it names (its id), or the one he used last.

// ── The session screen's commands ───────────────────────────────────────────

/** Open session screens by session id: what each one's commands do. */
const _stSessionActions = new Map();
let _stLastSessionId = 0;

/** A session screen offers its actions to the commands; dispose takes them back. */
function stOfferSessionActions(sessionId, root, actions) {
  const entry = { root, actions };
  _stSessionActions.set(sessionId, entry);
  _stLastSessionId = sessionId;
  const mine = () => { _stLastSessionId = sessionId; };
  root.addEventListener('focusin', mine);
  return { dispose: () => { root.removeEventListener('focusin', mine); if (_stSessionActions.get(sessionId) === entry) _stSessionActions.delete(sessionId); } };
}

/** Run one session-screen action: on the session named, else on the one he used last that is still on screen. */
function stSessionAction(name, sessionId, ...args) {
  const id = Number(sessionId) || _stLastSessionId;
  const entry = _stSessionActions.get(id);
  if (!entry || !entry.root.isConnected || typeof entry.actions[name] !== 'function') return false;
  entry.actions[name](...args);
  return true;
}

function registerSessionCommands(context) {
  const cmds = [
    ['study.studyMarked', (arg) => stStudyMarked(arg)],
    ['study.previousQuestion', (id) => stSessionAction('previous', id)],
    ['study.nextQuestion', (id) => stSessionAction('next', id)],
    ['study.markQuestion', (id) => stSessionAction('mark', id)],
    ['study.editQuestion', (id, step) => stSessionAction('edit', id, step)],
    ['study.markAnswerRight', (id) => stSessionAction('overrule', id, 'right')],
    ['study.markAnswerWrong', (id) => stSessionAction('overrule', id, 'wrong')],
    ['study.gradeAgain', (id) => stSessionAction('gradeAgain', id)],
    ['study.discussInChat', (id) => stSessionAction('discuss', id)],
  ];
  for (const [id, handler] of cmds) context.subscriptions.push(_api.commands.registerCommand(id, handler));
}

/** An answered item as it was, into `host`: the eyebrow, the card with his answer, the verdict below. */
function stPastView(host, { item, q, concept, isTest, onSource }) {
  const fmt = item.formatUsed || q.format;
  const eyebrow = stBlock(host, 'div', 'st-eyebrow');
  stBlock(eyebrow, 'span', 'st-eyebrow__cpt', q.origin && q.origin !== 'generated' && q.originLabel ? q.originLabel : (concept ? concept.title : 'Question'));
  stBlock(eyebrow, 'span', 'st-eyebrow__dot');
  stBlock(eyebrow, 'span', 'st-eyebrow__src', 'Answered earlier · nothing here changes the record');
  const card = stBlock(host, 'div', 'st-card st-card--answered st-card--past');
  card.dataset.format = fmt;
  stBlock(card, 'div', 'st-card__q').appendChild(stMd(q.stem));
  const options = Array.isArray(q.options) ? q.options : [];
  const chosen = item.chosen !== '' && item.chosen != null ? Number(item.chosen) : -1;
  if (fmt === 'mc') {
    const opts = stBlock(card, 'div', 'st-opts st-opts--done', null);
    const right = Number(q.answer);
    options.forEach((text, i) => {
      const cls = i === right ? ' st-opt--right' : i === chosen ? ' st-opt--wrong' : '';
      const row = stBlock(opts, 'div', `st-opt${cls}`);
      stBlock(row, 'span', 'st-opt__key', String(i + 1));
      stBlock(row, 'span', 'st-opt__text').appendChild(stMd(text));
      if (cls) stIconEl(row, 'st-opt__mark', i === right ? 'check' : 'x', 16);
    });
  } else {
    const ta = stBlock(card, 'div', 'st-ta');
    stBlock(ta, 'div', 'st-ta__hint', 'Your answer');
    stBlock(ta, 'div', 'st-past__typed', item.typed || 'Nothing written down.');
  }
  const v = item.verdict && typeof item.verdict === 'object' ? item.verdict : null;
  const ok = item.status === 'right';
  const marked = item.status === 'right' || item.status === 'wrong';
  const fb = stBlock(host, 'div', `st-fb st-fb--show${isTest || !marked ? '' : ok ? ' st-fb--ok' : ' st-fb--no'}`);
  const verdict = stBlock(fb, 'div', 'st-fb__verdict');
  stBlock(verdict, 'span', 'st-fb__dot');
  const word = isTest ? 'Answered; marked at the end' : !marked ? 'Not counted' : fmt === 'mc' ? (ok ? 'Correct' : 'Not quite') : (v && v.label) || (ok ? 'Correct' : 'Not quite');
  stBlock(verdict, 'span', 'st-fb__text', word);
  if (item.retried && fmt === 'mc') stBlock(verdict, 'span', 'st-fb__grade', '· retried, counts as Again');
  if (!isTest && fmt !== 'mc' && v && Array.isArray(v.points)) {
    const rubric = Array.isArray(v.rubric) && v.rubric.length ? v.rubric : (Array.isArray(q.rubric) ? q.rubric : []);
    if (rubric.length) fb.appendChild(stRubricEl(rubric, v.points));
  }
  if (!isTest && fmt === 'mc' && !ok && q.explanation) stBlock(fb, 'div', 'st-fb__why').appendChild(stMd(q.explanation));
  if (!isTest) stAppendQuote(fb, q, q.sourceQuote, q.sourcePage, onSource);
  return { card, fb };
}

/** The controls while looking back: Previous and Next in the action row, and where he is. Their ids
 *  are their own: the live row's Previous is still in the page, hidden, while these show. */
function stPastControls(row, { sessionId, canBack, where }) {
  _api.ui.createButton(row, { id: 'study.past.previous', label: 'Previous', icon: 'chevron-left', kind: 'ghost', disabled: !canBack, title: 'Previous (←). The question before this one.', command: 'study.previousQuestion', args: [sessionId] });
  stBlock(row, 'span', 'st-ctl__where', where);
  stBlock(row, 'span', 'st-sp');
  const next = _api.ui.createButton(row, { id: 'study.past.next', label: 'Next', icon: 'chevron-right', kind: 'primary', title: 'Next (Enter). Back toward the question you were on.', command: 'study.nextQuestion', args: [sessionId] });
  stBlock(next, 'span', 'st-k', '↵');
  return next;
}

/** The mark on a question to come back to it: a toggle in the eyebrow, kept in the database. */
function stMarkToggle(parent, q, { sessionId, onChange } = {}) {
  const btn = _api.ui.createIconButton(parent, { id: 'study.markQuestion', icon: q.marked ? 'bookmark-check' : 'bookmark', title: 'Mark to Come Back To (M)', size: 'sm', command: 'study.markQuestion', args: [sessionId] });
  const paint = () => {
    btn.setAttribute('aria-pressed', q.marked ? 'true' : 'false');
    btn.classList.toggle('st-mark--on', !!q.marked);
    btn.replaceChildren();
    stIconEl(btn, '', q.marked ? 'bookmark-check' : 'bookmark', 14);
  };
  let busy = false;
  async function toggle() {
    if (busy) return;
    busy = true;
    try {
      await stSetMarked(q.id, !q.marked);
      q.marked = !q.marked;
      paint();
      if (onChange) onChange(q.marked);
    } finally { busy = false; }
  }
  paint();
  return { element: btn, toggle };
}

/** The question's wording and answer as he edits them: two fields, Save and Cancel. Ctrl+Enter saves, Esc cancels. */
function stEditForm(host, q, { sessionId, before = null, onSave, onCancel }) {
  const form = stBlock(null, 'div', 'st-edit', null);
  form.setAttribute('role', 'group');
  form.setAttribute('aria-label', 'Edit this question');
  const mc = q.format === 'mc';
  const answerNow = mc ? String((Array.isArray(q.options) ? q.options[Number(q.answer)] : '') || '') : String(q.answer || '');
  stBlock(form, 'div', 'st-edit__lab', 'Question');
  const stem = stTextArea(form, 'st-edit__field', q.stem, 'study.edit.stem', 'Question wording');
  stBlock(form, 'div', 'st-edit__lab', mc ? 'Right option' : 'Answer');
  const answer = stTextArea(form, 'st-edit__field', answerNow, 'study.edit.answer', mc ? 'Right option' : 'Answer');
  stBlock(form, 'div', 'st-edit__hint', mc ? 'The other options stay as they are.' : 'Typed answers are marked against this answer from now on.');
  const acts = stBlock(form, 'div', 'st-edit__acts');
  stBlock(acts, 'span', 'st-sp');
  _api.ui.createButton(acts, { id: 'study.edit.cancel', label: 'Cancel', kind: 'ghost', title: 'Cancel (Esc)', command: 'study.editQuestion', args: [sessionId, 'cancel'] });
  const save = _api.ui.createButton(acts, { id: 'study.edit.save', label: 'Save', kind: 'primary', title: 'Save (Ctrl+Enter)', command: 'study.editQuestion', args: [sessionId, 'save'] });
  let saving = false;
  async function submit() {
    if (saving) return;
    const s = String(stem.value || '').trim();
    const a = String(answer.value || '').trim();
    if (!s) { stem.focus(); return; }
    if (!a) { answer.focus(); return; }
    saving = true;
    save.disabled = true;
    try { await onSave({ stem: s, answer: a }); } finally { saving = false; save.disabled = false; }
  }
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); void submit(); }
  });
  host.insertBefore(form, before);
  queueMicrotask(() => stem.focus());
  return { element: form, submit: () => void submit(), cancel: () => onCancel() };
}

/**
 * His edit of a question, kept in the bank: the wording, and the answer (an
 * mc question's right option). A changed answer of a typed question drops a
 * rubric made from the old answer or the source, so the next grading draws
 * its points from his answer; an examiner's report keeps its rubric.
 */
async function stSaveQuestionEdit(q, { stem, answer }) {
  const next = { ...q, stem: String(stem), edited: true };
  if (q.format === 'mc') {
    const options = (Array.isArray(q.options) ? q.options : []).slice();
    options[Number(q.answer)] = String(answer);
    next.options = options;
  } else if (String(answer) !== String(q.answer || '')) {
    next.answer = String(answer);
    if (q.rubricOrigin !== 'report') { next.rubric = []; next.rubricOrigin = ''; }
  }
  await stUpdateQuestion(next);
  if (typeof _stTypedRubrics !== 'undefined') _stTypedRubrics.delete(q.id);
  // A subject's question lives in its database: the edit goes to its row.
  try { await stSubjectPushEdit(next); } catch (err) { if (!stIsStopped(err)) console.warn('[Study] the edit did not reach its row:', err && err.message); }
  return next;
}

/**
 * His verdict over the grader's on a typed answer. The item, the answer's
 * row and the concept follow it: the concept is `before` (as it stood before
 * this answer counted) with his verdict applied, so overruling to right takes
 * the miss back off. Returns the concept as it now is, or null.
 */
async function stOverruleAnswer({ sessionId, item, answerId, before, fmt, to, verdict }) {
  const ok = to === 'right';
  const rating = ok ? GOOD : AGAIN;
  const now = stNow();
  const stored = { ...(verdict || {}), overruled: to, label: ok ? 'Right, as you marked it' : 'Wrong, as you marked it', rating };
  await stAnswerItem(item.id, { status: ok ? 'right' : 'wrong', verdict: stored }, now);
  await stSetAnswerVerdict(answerId, { correct: ok, rating });
  let concept = null;
  if (before) {
    concept = stApplyAnswer(before, { correct: ok, rating, formatUsed: fmt, retried: 0 }, now);
    await stUpdateConcept(concept);
  }
  Object.assign(item, { status: ok ? 'right' : 'wrong', verdict: stored });
  bus.emit('session', { sessionId, itemId: item.id, status: item.status });
  return { concept, stored, rating };
}

/** The half-typed answer on an item, written a moment after he stops typing, and at once on flush. */
function stDraftSaver(item) {
  let timer = 0;
  let pending = null;
  const write = () => {
    clearTimeout(timer);
    timer = 0;
    if (pending === null) return;
    const text = pending;
    pending = null;
    stSaveDraft(item.id, text).catch((err) => { if (!stIsStopped(err)) console.warn('[Study] draft not saved:', err); });
  };
  return {
    set(text) {
      item.draft = String(text || '');
      pending = item.draft;
      clearTimeout(timer);
      timer = setTimeout(write, 300);
    },
    flush: write,
  };
}
