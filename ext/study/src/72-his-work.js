// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 72: HIS WORK, FOR THE CHAT — what he got wrong, as he answered it
// ═══════════════════════════════════════════════════════════════════════════════
//
// A miss is worth discussing only with the work on the table: the question,
// what he answered, the right (or model) answer and the passage it rests on.
// One record of that (stMissOf) feeds the two chat tools that report results
// (study_results, study_weak_spots in 70-integration.js) and Discuss in Chat
// on an answered question, which opens the app's chat with the record staged
// for him to send or add to. The chat is reached through its own generic
// commands (chat.show, chat.addFileAttachment, chat.stagePrompt), the ones
// any tool calls; nothing here is drawn.

/** The longest any one part of a record is in a tool's output: a chat model reads it. */
const ST_WORK_CHARS = 600;
/** Misses written out in full per tool call; the rest are counted. */
const ST_WORK_MAX = 10;

/** What he answered on an item: the option he chose, or what he typed. */
function stHisAnswer(item, q) {
  const fmt = (item && item.formatUsed) || (q && q.format);
  if (fmt === 'mc') {
    const options = Array.isArray(q && q.options) ? q.options : [];
    const i = Number(item && item.chosen);
    return item && item.chosen !== '' && item.chosen != null && options[i] !== undefined ? String(options[i]) : '';
  }
  return String((item && item.typed) || '');
}

/** The answer the question is marked against: an mc question's right option, else its answer. */
function stRightAnswerOf(q) {
  if (!q) return '';
  if (q.format === 'mc') {
    const options = Array.isArray(q.options) ? q.options : [];
    const v = options[Number(q.answer)];
    return v !== undefined ? String(v) : String(q.answer ?? '');
  }
  return String(q.answer ?? '');
}

/** One miss as a record: { question, answer, right, typed, quote, where, missed, note }. */
function stMissOf(q, item, { material = null, concept = null } = {}) {
  const fmt = (item && item.formatUsed) || q.format;
  const v = item && item.verdict && typeof item.verdict === 'object' ? item.verdict : null;
  const rubric = v && Array.isArray(v.rubric) && v.rubric.length ? v.rubric : (Array.isArray(q.rubric) ? q.rubric : []);
  const points = v && Array.isArray(v.points) ? v.points : [];
  const missed = fmt !== 'mc' && v ? rubric.filter((p, i) => p && p.text && ((points[i] && points[i].status) || 'miss') !== 'hit').map((p) => String(p.text)) : [];
  const page = Number(q.sourcePage) || 0;
  const label = (material && material.label) || q.originLabel || '';
  return {
    question: String(q.stem || ''),
    answer: stHisAnswer(item, q),
    right: stRightAnswerOf(q),
    typed: fmt !== 'mc',
    quote: String(q.sourceQuote || ''),
    where: [label, page && material && material.kind === 'pdf' ? `p. ${page}` : ''].filter(Boolean).join(', '),
    concept: concept ? String(concept.title || '') : '',
    missed,
    note: v && v.note ? String(v.note) : '',
  };
}

/** A miss as a few lines a chat model reads (each part clipped to ST_WORK_CHARS). */
function stMissLines(m, n) {
  const cut = (t) => stTruncate(String(t || '').replace(/\s+/g, ' ').trim(), ST_WORK_CHARS);
  const lines = [`${n}. Question: ${cut(m.question)}`];
  lines.push(`   Answered: ${m.answer ? cut(m.answer) : '(nothing)'}`);
  lines.push(`   ${m.typed ? 'Model answer' : 'Right answer'}: ${cut(m.right) || '(none stored)'}`);
  if (m.missed.length) lines.push(`   Points missed: ${cut(m.missed.join('; '))}`);
  if (m.quote) lines.push(`   Source${m.where ? ` (${m.where})` : ''}: "${cut(m.quote)}"`);
  return lines;
}

/** The materials by id, for the source label on each record. */
async function stMaterialsById() {
  return new Map(((await stListMaterials()) || []).map((m) => [Number(m.id), m]));
}

/** study_results' block for a session: its wrong answers, newest first, up to ST_WORK_MAX in full. */
async function stResultsMissText(items, questions, concepts) {
  const qs = new Map((questions || []).map((q) => [Number(q.id), q]));
  const cs = new Map((concepts || []).map((c) => [Number(c.id), c]));
  const wrong = (items || []).filter((i) => i.status === 'wrong' && qs.has(Number(i.questionId)))
    .sort((a, b) => (Number(b.answeredAt) || 0) - (Number(a.answeredAt) || 0));
  if (!wrong.length) return '';
  const materials = await stMaterialsById();
  const lines = [`Answered wrong (${wrong.length}${wrong.length > ST_WORK_MAX ? `, the latest ${ST_WORK_MAX} shown` : ''}):`];
  wrong.slice(0, ST_WORK_MAX).forEach((item, i) => {
    const q = qs.get(Number(item.questionId));
    lines.push(...stMissLines(stMissOf(q, item, { material: materials.get(Number(q.materialId)), concept: cs.get(Number(q.conceptId)) }), i + 1));
  });
  return lines.join('\n');
}

/** study_weak_spots' block: for each of the first ST_WORK_MAX concepts, the last question he got wrong on it. */
async function stWeakSpotMissText(concepts) {
  const ids = (concepts || []).slice(0, ST_WORK_MAX).map((c) => Number(c.id)).filter((n) => n > 0);
  if (!ids.length) return '';
  const rows = await db.all(
    `SELECT i.*, q.concept_id AS q_concept FROM st_session_items i JOIN st_questions q ON q.id = i.question_id
      WHERE i.status = 'wrong' AND q.concept_id IN (${stPlaceholders(ids)}) ORDER BY i.answered_at DESC, i.id DESC`, ids);
  const lastByConcept = new Map();
  for (const r of rows) if (!lastByConcept.has(Number(r.q_concept))) lastByConcept.set(Number(r.q_concept), stRowToSessionItem(r));
  if (!lastByConcept.size) return '';
  const materials = await stMaterialsById();
  const lines = ['The last question answered wrong on each:'];
  let n = 0;
  for (const c of concepts.slice(0, ST_WORK_MAX)) {
    const item = lastByConcept.get(Number(c.id));
    const q = item ? await stGetQuestion(Number(item.questionId)) : null;
    if (!q) continue;
    n += 1;
    lines.push(...stMissLines({ ...stMissOf(q, item, { material: materials.get(Number(q.materialId)), concept: c }) }, n).map((l, i) => (i === 0 ? `${l} [${c.title}]` : l)));
  }
  return n ? lines.join('\n') : '';
}

// ── Discuss in Chat ─────────────────────────────────────────────────────────

/** True while the chat's staging command exists. */
async function stChatAvailable() {
  try {
    const cmds = await _api.commands.getCommands();
    return Array.isArray(cmds) && cmds.includes('chat.stagePrompt');
  } catch { return false; }
}

/** The prompt staged in the chat for an answered question: his work, then what to do with it. */
function stDiscussPrompt(m, { right }) {
  const lines = [
    right ? 'I answered this Study question right, but I want to be sure I understand it.' : 'I got this Study question wrong. Help me see where my thinking went off, then check that I have it.',
    '',
    `Question: ${m.question}`,
    `My answer: ${m.answer || '(nothing)'}`,
    `${m.typed ? 'Model answer' : 'Right answer'}: ${m.right || '(none stored)'}`,
  ];
  if (m.missed.length) lines.push(`Points I missed: ${m.missed.join('; ')}`);
  if (m.note) lines.push(`Grader's note: ${m.note}`);
  if (m.quote) lines.push(`Source${m.where ? ` (${m.where})` : ''}: "${m.quote}"`);
  lines.push(
    '',
    right
      ? 'Ask me to explain it in my own words first, then tell me what I left out.'
      : 'Start from my answer: name the misunderstanding it shows before you give the right one.',
    'Read the source passage and what is around it, and pull in anything else in my workspace that helps.',
    'You can see my other misses with study_weak_spots and study_results; tie this one to them if they share a cause.',
    'End with one question that checks I have it now.',
  );
  return lines.join('\n');
}

/** The item as the card shows it now: what was chosen or typed and the verdict, even before the record has landed. */
function stItemAsShown(cur) {
  const it = { ...(cur.item || {}) };
  if (!it.formatUsed) it.formatUsed = cur.fmt;
  if (cur.chosen != null) it.chosen = String(cur.chosen);
  if (cur.typedField && cur.typedField.value) it.typed = cur.typedField.value;
  if (cur.result) it.verdict = stStoredVerdict(cur.result);
  if (it.status !== 'right' && it.status !== 'wrong') {
    const right = it.formatUsed === 'mc' ? cur.chosen != null && Number(cur.chosen) === Number(cur.q.answer) : !!cur.result && Number(cur.result.rating) >= GOOD;
    it.status = right ? 'right' : 'wrong';
  }
  return it;
}

/** Open the chat with an answered question's record staged, and its source file attached when there is one. */
async function stDiscussInChat(q, item) {
  if (!q || !item) return false;
  if (!(await stChatAvailable())) {
    await _api.window.showInformationMessage('The chat is not available.');
    return false;
  }
  const material = Number(q.materialId) > 0 ? await stGetMaterial(Number(q.materialId)).catch(() => null) : null;
  const m = stMissOf(q, item, { material });
  await _api.commands.executeCommand('chat.show');
  const uri = String(q.sourceUri || (material && material.uri) || '');
  if (uri && /^(file:|[a-zA-Z]:[\\/]|\/)/.test(uri)) {
    try {
      await _api.commands.executeCommand('chat.addFileAttachment', { name: (material && material.label) || stFileNameOf(stFsPathOf(uri)) || 'Source', fullPath: stFsPathOf(uri) });
    } catch { /* the prompt still names the source and quotes it */ }
  }
  await _api.commands.executeCommand('chat.stagePrompt', { text: stDiscussPrompt(m, { right: item.status === 'right' }) });
  return true;
}
