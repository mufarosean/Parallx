// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 25: WHAT HE KEEPS — marks, drafts, his own verdict, the Marked set
// ═══════════════════════════════════════════════════════════════════════════════
//
// The data a session screen writes beside the answer itself (migration
// study_002): a question marked to come back to (st_questions.marked), the
// answer he had half typed on an item (st_session_items.draft), and the
// verdict he gave when he overruled the grader (the st_answers row of that
// answer is corrected, so the record says what he decided). The Marked set
// is a scope of its own kind, 'marked': fixed like a bank (nothing is
// written for it), drawn from the questions marked when it is drawn.

/** Mark or unmark a question to come back to. */
async function stSetMarked(questionId, on) {
  await db.run('UPDATE st_questions SET marked = ? WHERE id = ?', [on ? 1 : 0, Number(questionId) || 0]);
  _emitDataChanged();
}

/** The questions marked to come back to and not hidden, oldest first. */
async function stListMarkedQuestions() {
  const rows = await db.all('SELECT * FROM st_questions WHERE marked = 1 AND hidden = 0 ORDER BY id');
  return rows.map(stRowToQuestion);
}

/** The half-typed answer on an item. Quiet: nothing else repaints for it. */
async function stSaveDraft(itemId, text) {
  await db.run('UPDATE st_session_items SET draft = ? WHERE id = ?', [String(text || ''), Number(itemId) || 0]);
}

/** His verdict on an answer already logged: the st_answers row says right or wrong as he decided. */
async function stSetAnswerVerdict(answerId, { correct, rating }) {
  if (!answerId) return;
  await db.run('UPDATE st_answers SET correct = ?, rating = ? WHERE id = ?', [correct ? 1 : 0, Number(rating) || 0, answerId]);
  _emitDataChanged();
}

/** Has he answered anything yet, anywhere? */
async function stHasAnswers() {
  const row = await db.get('SELECT (SELECT COUNT(*) FROM st_answers) + (SELECT COUNT(*) FROM st_concepts WHERE answers > 0) AS n');
  return Number(row && row.n) > 0;
}

/** What Study Weak Spots says when there is nothing weak: with no history, that nothing is answered yet. */
async function stNoWeakSpotsText() {
  return (await stHasAnswers())
    ? 'No weak spots yet: every concept you have answered is clean.'
    : 'Nothing answered yet: answer some questions first, and the concepts you miss show up here.';
}

/** A scope nothing is written for: a question bank, or the Marked set. */
function stFixedScope(scope) {
  return !!scope && (scope.kind === 'bank' || scope.kind === 'marked');
}

/** Every question a fixed scope holds, hidden ones included (the caller filters). */
async function stFixedScopeQuestions(scope) {
  if (scope.kind === 'marked') return stListMarkedQuestions();
  // A subject's unit is its bank narrowed to the questions of that unit.
  return stScopeUnitFilter(scope, await stListQuestions({ bankIds: Array.isArray(scope.bankIds) ? scope.bankIds : [] }));
}

/** Study the marked questions as a set: one Practice session over exactly those. */
async function stStudyMarked() {
  const marked = await stListMarkedQuestions();
  if (!marked.length) {
    await _api.window.showInformationMessage('Nothing is marked yet: mark a question on its card to come back to it.');
    return null;
  }
  return stStartOrSay({ scope: { kind: 'marked', materialIds: [], label: 'Marked questions' }, mode: 'practice', ...stSessionPrefs(null) });
}
