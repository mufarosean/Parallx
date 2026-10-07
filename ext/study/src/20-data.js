// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20: DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════════
//
// Database access, materials and ingest, banks and providers, the import
// parsers' IO. Every function takes and returns plain objects in the §4
// shapes (camelCase; JSON columns parsed on the way out) and none touches
// the DOM. The database wrapper `db` and `_emitDataChanged()` come from
// 00-header.js; the pure helpers (stHeadingsFromPages, stParseQuestionFile,
// stConceptState and the rest) from 10-model.js.
//
// Patterns copied from ext/flashcards/main.js SECTION 4 (row mapping,
// lastInsertRowid, _emitDataChanged after writes) and SECTION 6 (the PDF
// extractor through electronBridge().document.extractText, the canvas read
// through the 'canvas.getPageMarkdown' command, the workspace walk for the
// picker), renamed to st.

// ── Small helpers ───────────────────────────────────────────────────────────

/** Parse a JSON column, falling back when the cell is empty or corrupt. */
function stParseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    const v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** A JSON column value; '' for an empty object or array when `emptyAs` says so. */
function stJsonCol(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.stringify(value); } catch { return fallback; }
}

/**
 * FNV-1a 32-bit over a string, as eight hex digits. A cheap content hash:
 * it only has to notice that a PDF changed since it was ingested, so the
 * cached text and the sections can be refreshed.
 */
function stHashText(text) {
  const s = String(text || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Integer id list for an IN (...) clause; [] when nothing usable. */
function stIdList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0);
}

function stPlaceholders(list) {
  return list.map(() => '?').join(', ');
}

function stFileNameOf(fsPath) {
  return String(fsPath || '').split(/[\\/]/).pop() || '';
}

function stExtOf(nameOrPath) {
  const m = /\.([a-z0-9]+)$/i.exec(String(nameOrPath || ''));
  return m ? m[1].toLowerCase() : '';
}

// ── Row mapping ─────────────────────────────────────────────────────────────

function stRowToMaterial(row) {
  return {
    id: row.id,
    kind: row.kind,
    uri: row.uri,
    label: row.label,
    pageCount: row.page_count || 0,
    contentHash: row.content_hash || '',
    outline: stParseJson(row.outline_json, []),
    model: row.model || '',
    contextSetting: row.context_setting || 0,
    answerFormat: row.answer_format || '',
    createdAt: row.created_at || 0,
    lastStudiedAt: row.last_studied_at || 0,
  };
}

function stRowToSection(row) {
  return {
    id: row.id,
    materialId: row.material_id,
    title: row.title,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    ord: row.ord,
    mappedAt: row.mapped_at || 0,
  };
}

function stRowToConcept(row) {
  return {
    id: row.id,
    materialId: row.material_id,
    sectionId: row.section_id || 0,
    title: row.title,
    summary: row.summary || '',
    page: row.page || 0,
    anchorQuote: row.anchor_quote || '',
    ord: row.ord || 0,
    mastery: row.mastery || 0,
    answers: row.answers || 0,
    misses: row.misses || 0,
    missStreak: row.miss_streak || 0,
    rightChooseAt: row.right_choose_at || 0,
    rightTypeAt: row.right_type_at || 0,
    lastAnsweredAt: row.last_answered_at || 0,
  };
}

function stRowToQuestion(row) {
  const numeric = stParseJson(row.numeric_json, null);
  return {
    id: row.id,
    materialId: row.material_id || 0,
    conceptId: row.concept_id || 0,
    format: row.format,
    stem: row.stem,
    options: stParseJson(row.options_json, []),
    answer: row.answer || '',
    explanation: row.explanation || '',
    rubric: stParseJson(row.rubric_json, []),
    rubricOrigin: row.rubric_origin || '',
    contradictions: stParseJson(row.contradictions_json, []),
    numeric: numeric && typeof numeric === 'object' ? numeric : null,
    sourcePage: row.source_page || 0,
    sourceQuote: row.source_quote || '',
    sourceUri: row.source_uri || '',
    origin: row.origin || 'generated',
    originLabel: row.origin_label || '',
    providerId: row.provider_id || '',
    providerRef: row.provider_ref || '',
    bankId: row.bank_id || 0,
    checks: stParseJson(row.checks_json, {}),
    difficulty: row.difficulty || '',
    hidden: !!row.hidden,
    edited: !!row.edited,
    runId: row.run_id || 0,
    model: row.model || '',
    createdAt: row.created_at || 0,
  };
}

function stRowToRun(row) {
  return {
    id: row.id,
    materialId: row.material_id,
    sectionId: row.section_id || 0,
    model: row.model || '',
    numCtx: row.num_ctx || 0,
    startedAt: row.started_at || 0,
    finishedAt: row.finished_at || 0,
    status: row.status || 'running',
    written: row.written || 0,
    kept: row.kept || 0,
    dropped: stParseJson(row.dropped_json, {}),
    error: row.error || '',
  };
}

function stRowToSession(row) {
  return {
    id: row.id,
    name: row.name,
    scope: stParseJson(row.scope_json, { kind: 'document', materialIds: [], label: '' }),
    mode: row.mode,
    answerFormat: row.answer_format,
    size: row.size || 20,
    model: row.model || '',
    numCtx: row.num_ctx || 0,
    startedAt: row.started_at || 0,
    finishedAt: row.finished_at || 0,
    position: row.position || 0,
    refreshes: row.refreshes || 0,
    seconds: row.seconds || 0,
  };
}

function stRowToSessionItem(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    draw: row.draw || 0,
    ord: row.ord,
    formatUsed: row.format_used || '',
    status: row.status || 'pending',
    chosen: row.chosen || '',
    typed: row.typed || '',
    verdict: stParseJson(row.verdict_json, null),
    retried: !!row.retried,
    answeredAt: row.answered_at || 0,
  };
}

function stRowToBank(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    path: row.path || '',
    providerId: row.provider_id || '',
    exam: row.exam || '',
    sitting: row.sitting || '',
    count: row.count || 0,
    importedAt: row.imported_at || 0,
  };
}

// ── Database ────────────────────────────────────────────────────────────────

/** Open the per-extension database and apply db/migrations. False on failure. */
async function stEnsureDatabase(api) {
  if (!api || !api.database) {
    console.error('[Study] api.database unavailable; cannot activate.');
    return false;
  }
  _dbBridge = api.database;
  const openResult = await api.database.open();
  if (openResult && openResult.error) {
    console.error('[Study] Database open failed:', openResult.error.message);
    return false;
  }
  const toolPath = String(api.env?.toolPath || '');
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = toolPath + sep + 'db' + sep + 'migrations';
  const res = await api.database.migrate(migrationsDir);
  if (res && res.error) {
    console.error('[Study] Migration failed:', res.error.message);
    return false;
  }
  return true;
}

// ── Materials ───────────────────────────────────────────────────────────────

/** The materials a user added (PDFs and canvas pages). A bank's own hidden material (stBankMaterial) is left out. */
async function stListMaterials() {
  const rows = await db.all("SELECT * FROM st_materials WHERE kind != 'bank' ORDER BY last_studied_at DESC, label COLLATE NOCASE");
  return rows.map(stRowToMaterial);
}

async function stGetMaterial(id) {
  if (id == null) return null;
  const row = await db.get('SELECT * FROM st_materials WHERE id = ?', [id]);
  return row ? stRowToMaterial(row) : null;
}

/** Insert or refresh a material by (kind, uri). Returns the stored material. */
async function stUpsertMaterial({ kind, uri, label, pageCount = 0, contentHash = '', outline = [] }) {
  const outlineJson = stJsonCol(Array.isArray(outline) ? outline : [], '[]');
  const existing = await db.get('SELECT id FROM st_materials WHERE kind = ? AND uri = ?', [kind, uri]);
  let id;
  if (existing) {
    await db.run(
      'UPDATE st_materials SET label = ?, page_count = ?, content_hash = ?, outline_json = ? WHERE id = ?',
      [label, pageCount || 0, contentHash || '', outlineJson, existing.id],
    );
    id = existing.id;
  } else {
    const res = await db.run(
      'INSERT INTO st_materials (kind, uri, label, page_count, content_hash, outline_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [kind, uri, label, pageCount || 0, contentHash || '', outlineJson, stNow()],
    );
    id = res.lastInsertRowid;
  }
  _emitDataChanged();
  return stGetMaterial(id);
}

/** Remember the model, context and answer format chosen for a material. Undefined keys are left alone. */
async function stSetMaterialPrefs(id, { model, contextSetting, answerFormat } = {}) {
  const sets = [];
  const params = [];
  if (model !== undefined) { sets.push('model = ?'); params.push(String(model || '')); }
  if (contextSetting !== undefined) { sets.push('context_setting = ?'); params.push(Number(contextSetting) || 0); }
  if (answerFormat !== undefined) { sets.push('answer_format = ?'); params.push(String(answerFormat || '')); }
  if (!sets.length) return stGetMaterial(id);
  params.push(id);
  await db.run(`UPDATE st_materials SET ${sets.join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
  return stGetMaterial(id);
}

async function stTouchMaterial(id, now) {
  await db.run('UPDATE st_materials SET last_studied_at = ? WHERE id = ?', [now || stNow(), id]);
  _emitDataChanged();
}

// ── Sections ────────────────────────────────────────────────────────────────

async function stListSections(materialId) {
  const rows = await db.all('SELECT * FROM st_sections WHERE material_id = ? ORDER BY ord, id', [materialId]);
  return rows.map(stRowToSection);
}

async function stGetSection(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_sections WHERE id = ?', [id]);
  return row ? stRowToSection(row) : null;
}

/** Replace a material's sections with [{ title, pageFrom, pageTo }] in order. Returns the new rows. */
async function stReplaceSections(materialId, sections) {
  await db.run('DELETE FROM st_sections WHERE material_id = ?', [materialId]);
  const list = Array.isArray(sections) ? sections : [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {};
    await db.run(
      'INSERT INTO st_sections (material_id, title, page_from, page_to, ord) VALUES (?, ?, ?, ?, ?)',
      [materialId, String(s.title || `Pages ${s.pageFrom}-${s.pageTo}`), Number(s.pageFrom) || 1, Number(s.pageTo) || Number(s.pageFrom) || 1, i],
    );
  }
  _emitDataChanged();
  return stListSections(materialId);
}

async function stMarkSectionMapped(sectionId, now) {
  await db.run('UPDATE st_sections SET mapped_at = ? WHERE id = ?', [now || stNow(), sectionId]);
  _emitDataChanged();
}

/**
 * Store sections for a freshly ingested material: keep the existing rows
 * (and their mapped_at) when the new list has the same titles and pages,
 * replace them otherwise. A re-ingest of an unchanged PDF must not throw
 * away the concept maps it already built.
 */
async function stEnsureSections(materialId, sections) {
  const existing = await stListSections(materialId);
  const next = Array.isArray(sections) ? sections : [];
  const same = existing.length === next.length && existing.every((e, i) =>
    e.title === String(next[i].title || '') && e.pageFrom === Number(next[i].pageFrom) && e.pageTo === Number(next[i].pageTo));
  if (existing.length && same) return existing;
  return stReplaceSections(materialId, next);
}

// ── Concepts ────────────────────────────────────────────────────────────────

/**
 * Concepts by id, material and/or section. Any filter may be left out; all
 * left out lists everything. `ids` reaches a bank question's own concept,
 * which lives under its bank's hidden material.
 */
async function stListConcepts({ materialIds, sectionIds, ids } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(ids)) {
    const list = stIdList(ids);
    if (!list.length) return [];
    where.push(`id IN (${stPlaceholders(list)})`);
    params.push(...list);
  }
  const mids = stIdList(materialIds);
  const sids = stIdList(sectionIds);
  if (Array.isArray(materialIds)) {
    if (!mids.length) return [];
    where.push(`material_id IN (${stPlaceholders(mids)})`);
    params.push(...mids);
  }
  if (Array.isArray(sectionIds)) {
    if (!sids.length) return [];
    where.push(`section_id IN (${stPlaceholders(sids)})`);
    params.push(...sids);
  }
  const sql = `SELECT * FROM st_concepts${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY material_id, section_id, ord, id`;
  const rows = await db.all(sql, params);
  return rows.map(stRowToConcept);
}

async function stGetConcept(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_concepts WHERE id = ?', [id]);
  return row ? stRowToConcept(row) : null;
}

/**
 * The concepts of chapters, resolved by page range: every concept of the
 * section's material whose page lies in the section, or that was filed
 * under it. A parent chapter so includes its subsections' concepts (each
 * concept is filed under the deepest section holding its page).
 */
async function stConceptsForSections(sectionIds) {
  const out = [];
  const seen = new Set();
  for (const sid of stIdList(sectionIds)) {
    const section = await stGetSection(sid);
    if (!section) continue;
    const rows = await db.all(
      'SELECT * FROM st_concepts WHERE material_id = ? AND ((page >= ? AND page <= ?) OR section_id = ?) ORDER BY section_id, ord, id',
      [section.materialId, section.pageFrom, section.pageTo, section.id],
    );
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(stRowToConcept(r));
    }
  }
  return out;
}

/** Insert [{ title, summary, page, anchorQuote, ord? }] under a section. Returns the stored concepts. */
async function stInsertConcepts(materialId, sectionId, concepts) {
  const list = Array.isArray(concepts) ? concepts : [];
  if (!list.length) return [];
  const base = await db.get('SELECT COALESCE(MAX(ord), -1) AS m FROM st_concepts WHERE material_id = ? AND section_id = ?', [materialId, sectionId || 0]);
  let ord = base && base.m != null && Number.isFinite(Number(base.m)) ? Number(base.m) : -1;
  const ids = [];
  const now = stNow();
  for (const c of list) {
    ord += 1;
    const res = await db.run(
      'INSERT INTO st_concepts (material_id, section_id, title, summary, page, anchor_quote, ord, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [materialId, sectionId || 0, String(c.title || '').trim(), String(c.summary || '').trim(), Number(c.page) || 0, String(c.anchorQuote || ''), Number.isInteger(c.ord) ? c.ord : ord, now],
    );
    ids.push(res.lastInsertRowid);
  }
  _emitDataChanged();
  const rows = await db.all(`SELECT * FROM st_concepts WHERE id IN (${stPlaceholders(ids)}) ORDER BY ord, id`, ids);
  return rows.map(stRowToConcept);
}

/** Write a concept's text and mastery state back (the pure stApplyAnswer result). */
async function stUpdateConcept(concept) {
  await db.run(
    `UPDATE st_concepts SET title = ?, summary = ?, page = ?, anchor_quote = ?, mastery = ?, answers = ?, misses = ?,
       miss_streak = ?, right_choose_at = ?, right_type_at = ?, last_answered_at = ? WHERE id = ?`,
    [
      String(concept.title || ''), String(concept.summary || ''), Number(concept.page) || 0, String(concept.anchorQuote || ''),
      Number(concept.mastery) || 0, Number(concept.answers) || 0, Number(concept.misses) || 0,
      Number(concept.missStreak) || 0, Number(concept.rightChooseAt) || 0, Number(concept.rightTypeAt) || 0,
      Number(concept.lastAnsweredAt) || 0, concept.id,
    ],
  );
  _emitDataChanged();
}

// ── Questions ───────────────────────────────────────────────────────────────

/**
 * Questions by material, concept, format or bank. Hidden questions are left
 * out unless includeHidden. An empty id list means "none", not "all".
 */
async function stListQuestions({ materialIds, conceptIds, formats, includeHidden = false, bankIds } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(materialIds)) {
    const ids = stIdList(materialIds);
    if (!ids.length) return [];
    where.push(`material_id IN (${stPlaceholders(ids)})`);
    params.push(...ids);
  }
  if (Array.isArray(conceptIds)) {
    const ids = stIdList(conceptIds);
    if (!ids.length) return [];
    where.push(`concept_id IN (${stPlaceholders(ids)})`);
    params.push(...ids);
  }
  if (Array.isArray(bankIds)) {
    const ids = stIdList(bankIds);
    if (!ids.length) return [];
    where.push(`bank_id IN (${stPlaceholders(ids)})`);
    params.push(...ids);
  }
  if (Array.isArray(formats) && formats.length) {
    const list = formats.map((f) => String(f));
    where.push(`format IN (${stPlaceholders(list)})`);
    params.push(...list);
  }
  if (!includeHidden) where.push('hidden = 0');
  const sql = `SELECT * FROM st_questions${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY concept_id, id`;
  const rows = await db.all(sql, params);
  return rows.map(stRowToQuestion);
}

async function stGetQuestion(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_questions WHERE id = ?', [id]);
  return row ? stRowToQuestion(row) : null;
}

const ST_QUESTION_COLS = [
  'material_id', 'concept_id', 'format', 'stem', 'options_json', 'answer', 'explanation', 'rubric_json', 'rubric_origin',
  'contradictions_json', 'numeric_json', 'source_page', 'source_quote', 'source_uri', 'origin', 'origin_label',
  'provider_id', 'provider_ref', 'bank_id', 'checks_json', 'difficulty', 'hidden', 'edited', 'run_id', 'model', 'created_at',
];

function stQuestionParams(q, now) {
  return [
    Number(q.materialId) || 0,
    Number(q.conceptId) || 0,
    String(q.format || 'short'),
    String(q.stem || '').trim(),
    stJsonCol(Array.isArray(q.options) ? q.options : [], '[]'),
    q.answer == null ? '' : String(q.answer),
    String(q.explanation || ''),
    stJsonCol(Array.isArray(q.rubric) ? q.rubric : [], '[]'),
    String(q.rubricOrigin || ''),
    stJsonCol(Array.isArray(q.contradictions) ? q.contradictions : [], '[]'),
    q.numeric && typeof q.numeric === 'object' ? stJsonCol(q.numeric, '') : '',
    Number(q.sourcePage) || 0,
    String(q.sourceQuote || ''),
    String(q.sourceUri || ''),
    String(q.origin || 'generated'),
    String(q.originLabel || ''),
    String(q.providerId || ''),
    String(q.providerRef || ''),
    Number(q.bankId) || 0,
    stJsonCol(q.checks && typeof q.checks === 'object' ? q.checks : {}, '{}'),
    String(q.difficulty || ''),
    q.hidden ? 1 : 0,
    q.edited ? 1 : 0,
    Number(q.runId) || 0,
    String(q.model || ''),
    Number(q.createdAt) || now,
  ];
}

/** Insert StQuestion-shaped objects (no id). Returns the stored questions, in order. */
async function stInsertQuestions(questions) {
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length) return [];
  const now = stNow();
  const ids = [];
  const sql = `INSERT INTO st_questions (${ST_QUESTION_COLS.join(', ')}) VALUES (${stPlaceholders(ST_QUESTION_COLS)})`;
  for (const q of list) {
    const res = await db.run(sql, stQuestionParams(q, now));
    ids.push(res.lastInsertRowid);
  }
  _emitDataChanged();
  const rows = await db.all(`SELECT * FROM st_questions WHERE id IN (${stPlaceholders(ids)})`, ids);
  const byId = new Map(rows.map((r) => [r.id, stRowToQuestion(r)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** Write a full StQuestion back (every editable column). */
async function stUpdateQuestion(q) {
  const cols = ST_QUESTION_COLS.filter((c) => c !== 'created_at');
  const params = stQuestionParams(q, stNow()).slice(0, cols.length);
  params.push(q.id);
  await db.run(`UPDATE st_questions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
}

/** Thumbs down: hide the question and log why. */
async function stHideQuestion(id, reason = '') {
  await db.run('UPDATE st_questions SET hidden = 1 WHERE id = ?', [id]);
  await stRecordFeedback(id, reason);
}

async function stRecordFeedback(questionId, reason = '') {
  await db.run('INSERT INTO st_feedback (question_id, reason, at) VALUES (?, ?, ?)', [questionId, String(reason || ''), stNow()]);
  _emitDataChanged();
}

// ── Runs ────────────────────────────────────────────────────────────────────

async function stStartRun({ materialId, sectionId = 0, model = '', numCtx = 0 }) {
  const res = await db.run(
    'INSERT INTO st_runs (material_id, section_id, model, num_ctx, started_at) VALUES (?, ?, ?, ?, ?)',
    [Number(materialId) || 0, Number(sectionId) || 0, String(model || ''), Number(numCtx) || 0, stNow()],
  );
  _emitDataChanged();
  return res.lastInsertRowid;
}

async function stFinishRun(id, { status = 'done', written = 0, kept = 0, dropped = {}, error = '' } = {}) {
  await db.run(
    'UPDATE st_runs SET finished_at = ?, status = ?, written = ?, kept = ?, dropped_json = ?, error = ? WHERE id = ?',
    [stNow(), String(status), Number(written) || 0, Number(kept) || 0, stJsonCol(dropped || {}, '{}'), String(error || ''), id],
  );
  _emitDataChanged();
}

async function stGetRun(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_runs WHERE id = ?', [id]);
  return row ? stRowToRun(row) : null;
}

/** Generation runs, newest first, for one material or all. The sidebar's per-model record. */
async function stListRuns({ materialId, limit = 50 } = {}) {
  const rows = materialId
    ? await db.all('SELECT * FROM st_runs WHERE material_id = ? ORDER BY started_at DESC LIMIT ?', [materialId, limit])
    : await db.all('SELECT * FROM st_runs ORDER BY started_at DESC LIMIT ?', [limit]);
  return rows.map(stRowToRun);
}

// ── Sessions ────────────────────────────────────────────────────────────────

async function stCreateSession({ name, scope, mode, answerFormat, size, model = '', numCtx = 0 }) {
  const res = await db.run(
    'INSERT INTO st_sessions (name, scope_json, mode, answer_format, size, model, num_ctx, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [String(name || 'Session'), stJsonCol(scope || {}, '{}'), String(mode || 'practice'), String(answerFormat || 'mixed'), Number(size) || 20, String(model || ''), Number(numCtx) || 0, stNow()],
  );
  _emitDataChanged();
  return stGetSession(res.lastInsertRowid);
}

async function stGetSession(id) {
  if (id == null) return null;
  const row = await db.get('SELECT * FROM st_sessions WHERE id = ?', [id]);
  return row ? stRowToSession(row) : null;
}

/** Sessions newest first; `open` true keeps only unfinished ones, false only finished. */
async function stListSessions({ open } = {}) {
  const where = open === true ? ' WHERE finished_at = 0' : open === false ? ' WHERE finished_at > 0' : '';
  const rows = await db.all(`SELECT * FROM st_sessions${where} ORDER BY started_at DESC`);
  return rows.map(stRowToSession);
}

const ST_SESSION_PATCH_COLS = {
  name: (v) => ['name', String(v || '')],
  scope: (v) => ['scope_json', stJsonCol(v || {}, '{}')],
  mode: (v) => ['mode', String(v || '')],
  answerFormat: (v) => ['answer_format', String(v || '')],
  size: (v) => ['size', Number(v) || 20],
  model: (v) => ['model', String(v || '')],
  numCtx: (v) => ['num_ctx', Number(v) || 0],
  finishedAt: (v) => ['finished_at', Number(v) || 0],
  position: (v) => ['position', Number(v) || 0],
  refreshes: (v) => ['refreshes', Number(v) || 0],
  seconds: (v) => ['seconds', Number(v) || 0],
};

async function stUpdateSession(id, patch = {}) {
  const sets = [];
  const params = [];
  for (const [key, map] of Object.entries(ST_SESSION_PATCH_COLS)) {
    if (patch[key] === undefined) continue;
    const [col, val] = map(patch[key]);
    sets.push(`${col} = ?`);
    params.push(val);
  }
  if (!sets.length) return stGetSession(id);
  params.push(id);
  await db.run(`UPDATE st_sessions SET ${sets.join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
  return stGetSession(id);
}

async function stDeleteSession(id) {
  await db.run('DELETE FROM st_session_items WHERE session_id = ?', [id]);
  await db.run('DELETE FROM st_sessions WHERE id = ?', [id]);
  _emitDataChanged();
}

/**
 * Remove a material and everything made from it: sections and concepts
 * (cascade), its questions, its runs, and every session whose scope was
 * only this material (a session over several materials keeps its rows;
 * its questions from this material are simply gone from future draws).
 */
async function stDeleteMaterial(id) {
  const mid = Number(id);
  if (!Number.isFinite(mid) || mid <= 0) return;
  const sessions = await db.all('SELECT id, scope_json FROM st_sessions', []);
  for (const row of sessions) {
    let scope = null;
    try { scope = JSON.parse(row.scope_json || '{}'); } catch { scope = null; }
    const ids = Array.isArray(scope?.materialIds) ? scope.materialIds.map(Number) : [];
    if (ids.length && ids.every((x) => x === mid)) {
      await db.run('DELETE FROM st_session_items WHERE session_id = ?', [row.id]);
      await db.run('DELETE FROM st_sessions WHERE id = ?', [row.id]);
    }
  }
  await db.run('DELETE FROM st_answers WHERE concept_id IN (SELECT id FROM st_concepts WHERE material_id = ?)', [mid]);
  await db.run('DELETE FROM st_questions WHERE material_id = ?', [mid]);
  await db.run('DELETE FROM st_runs WHERE material_id = ?', [mid]);
  await db.run('DELETE FROM st_concepts WHERE material_id = ?', [mid]);
  await db.run('DELETE FROM st_sections WHERE material_id = ?', [mid]);
  await db.run('DELETE FROM st_materials WHERE id = ?', [mid]);
  _stTextCache.delete(`${mid}:`);
  for (const k of [..._stTextCache.keys()]) if (k.startsWith(`${mid}:`)) _stTextCache.delete(k);
  _emitDataChanged();
}

// ── Session items ───────────────────────────────────────────────────────────

/** Append a draw's questions to a session, in order. `formats[i]` is the format item i is answered in. */
async function stAddSessionItems(sessionId, draw, questionIds, formats = []) {
  const ids = stIdList(questionIds);
  if (!ids.length) return [];
  const base = await db.get('SELECT COALESCE(MAX(ord), -1) AS m FROM st_session_items WHERE session_id = ?', [sessionId]);
  let ord = base && base.m != null && Number.isFinite(Number(base.m)) ? Number(base.m) : -1;
  const inserted = [];
  for (let i = 0; i < ids.length; i++) {
    ord += 1;
    const res = await db.run(
      'INSERT INTO st_session_items (session_id, question_id, draw, ord, format_used) VALUES (?, ?, ?, ?, ?)',
      [sessionId, ids[i], Number(draw) || 0, ord, String((formats && formats[i]) || '')],
    );
    inserted.push(res.lastInsertRowid);
  }
  _emitDataChanged();
  const rows = await db.all(`SELECT * FROM st_session_items WHERE id IN (${stPlaceholders(inserted)}) ORDER BY ord`, inserted);
  return rows.map(stRowToSessionItem);
}

async function stListSessionItems(sessionId) {
  const rows = await db.all('SELECT * FROM st_session_items WHERE session_id = ? ORDER BY draw, ord, id', [sessionId]);
  return rows.map(stRowToSessionItem);
}

async function stAnswerItem(itemId, { status, chosen, typed, verdict, retried, formatUsed } = {}, now) {
  const sets = ['answered_at = ?'];
  const params = [now || stNow()];
  if (status !== undefined) { sets.push('status = ?'); params.push(String(status)); }
  if (chosen !== undefined) { sets.push('chosen = ?'); params.push(chosen == null ? '' : String(chosen)); }
  if (typed !== undefined) { sets.push('typed = ?'); params.push(String(typed || '')); }
  if (verdict !== undefined) { sets.push('verdict_json = ?'); params.push(verdict ? stJsonCol(verdict, '') : ''); }
  if (retried !== undefined) { sets.push('retried = ?'); params.push(retried ? 1 : 0); }
  if (formatUsed !== undefined) { sets.push('format_used = ?'); params.push(String(formatUsed || '')); }
  params.push(itemId);
  await db.run(`UPDATE st_session_items SET ${sets.join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
}

async function stLogAnswer({ questionId, conceptId = 0, sessionId = 0, formatUsed, correct, rating = 0, retried = false }, now) {
  const res = await db.run(
    'INSERT INTO st_answers (question_id, concept_id, session_id, format_used, correct, rating, retried, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(questionId) || 0, Number(conceptId) || 0, Number(sessionId) || 0, String(formatUsed || ''), correct ? 1 : 0, Number(rating) || 0, retried ? 1 : 0, now || stNow()],
  );
  _emitDataChanged();
  return res.lastInsertRowid;
}

async function stListAnswers({ conceptId, questionId, sessionId, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (conceptId) { where.push('concept_id = ?'); params.push(conceptId); }
  if (questionId) { where.push('question_id = ?'); params.push(questionId); }
  if (sessionId) { where.push('session_id = ?'); params.push(sessionId); }
  params.push(limit);
  const rows = await db.all(`SELECT * FROM st_answers${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ?`, params);
  return rows.map((r) => ({
    id: r.id, questionId: r.question_id, conceptId: r.concept_id, sessionId: r.session_id,
    formatUsed: r.format_used, correct: !!r.correct, rating: r.rating || 0, retried: !!r.retried, at: r.at,
  }));
}

// ── Banks ───────────────────────────────────────────────────────────────────

async function stListBanks() {
  const rows = await db.all('SELECT * FROM st_banks ORDER BY imported_at DESC');
  return rows.map(stRowToBank);
}

async function stGetBank(id) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM st_banks WHERE id = ?', [id]);
  return row ? stRowToBank(row) : null;
}

async function stInsertBank(bank) {
  const res = await db.run(
    'INSERT INTO st_banks (name, kind, path, provider_id, exam, sitting, count, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [String(bank.name || 'Bank'), String(bank.kind || 'file'), String(bank.path || ''), String(bank.providerId || ''), String(bank.exam || ''), String(bank.sitting || ''), Number(bank.count) || 0, stNow()],
  );
  _emitDataChanged();
  return stGetBank(res.lastInsertRowid);
}

async function stSetBankCount(id, count) {
  await db.run('UPDATE st_banks SET count = ? WHERE id = ?', [Number(count) || 0, id]);
  _emitDataChanged();
}

/** Delete a bank, the questions it brought in and their own concepts. Answers stay in st_answers (history). */
async function stDeleteBank(id) {
  await db.run('DELETE FROM st_questions WHERE bank_id = ?', [id]);
  await stDeleteBankMaterial(id);
  await db.run('DELETE FROM st_banks WHERE id = ?', [id]);
  _emitDataChanged();
}

/**
 * The hidden material a bank's own concepts live under (kind 'bank', uri
 * 'bank:<id>'). st_concepts.material_id references st_materials and the
 * app's database enforces foreign keys, so a concept cannot hang off
 * material 0; stListMaterials leaves these out.
 */
async function stBankMaterial(bankId) {
  const uri = `bank:${Number(bankId) || 0}`;
  const row = await db.get("SELECT * FROM st_materials WHERE kind = 'bank' AND uri = ?", [uri]);
  if (row) return stRowToMaterial(row);
  const bank = await stGetBank(bankId);
  const res = await db.run(
    'INSERT INTO st_materials (kind, uri, label, page_count, content_hash, outline_json, created_at) VALUES (?, ?, ?, 0, \'\', \'[]\', ?)',
    ['bank', uri, String((bank && bank.name) || 'Question bank'), stNow()],
  );
  return stGetMaterial(res.lastInsertRowid);
}

async function stDeleteBankMaterial(bankId) {
  const row = await db.get("SELECT id FROM st_materials WHERE kind = 'bank' AND uri = ?", [`bank:${Number(bankId) || 0}`]);
  if (!row) return;
  await db.run('DELETE FROM st_concepts WHERE material_id = ?', [row.id]);
  await db.run('DELETE FROM st_materials WHERE id = ?', [row.id]);
}

/**
 * Give every bank question that has no concept one of its own, made on
 * first use: titled by its origin label or its stem, anchored to its
 * source page and quote, under its bank's hidden material. The question's
 * concept_id is updated, so mastery, draws and results work as for a
 * concept of the reading. Mutates and returns the questions.
 */
async function stEnsureBankConcepts(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const materials = new Map();
  let made = 0;
  for (const q of list) {
    if (!q || q.conceptId) continue;
    const bankId = Number(q.bankId) || 0;
    if (!materials.has(bankId)) materials.set(bankId, await stBankMaterial(bankId));
    const material = materials.get(bankId);
    if (!material) continue;
    const res = await db.run(
      'INSERT INTO st_concepts (material_id, section_id, title, summary, page, anchor_quote, ord, created_at) VALUES (?, 0, ?, \'\', ?, ?, ?, ?)',
      [material.id, stBankConceptTitle(q), Number(q.sourcePage) || 0, String(q.sourceQuote || ''), Number(q.id) || 0, stNow()],
    );
    await db.run('UPDATE st_questions SET concept_id = ? WHERE id = ?', [res.lastInsertRowid, q.id]);
    q.conceptId = res.lastInsertRowid;
    made += 1;
  }
  if (made) _emitDataChanged();
  return list;
}

// ── Material text ───────────────────────────────────────────────────────────

/** Extracted text per material id + content hash. A few entries; a long PDF is about a megabyte. */
const _stTextCache = new Map();
const ST_TEXT_CACHE_MAX = 8;

function stTextCacheKey(material) {
  return `${material.id}:${material.contentHash || ''}`;
}

function stTextCachePut(key, value) {
  if (_stTextCache.size >= ST_TEXT_CACHE_MAX) {
    const oldest = _stTextCache.keys().next().value;
    if (oldest !== undefined) _stTextCache.delete(oldest);
  }
  _stTextCache.set(key, value);
}

/** Extract a PDF's text. Copy of fcExtractDocument, keeping pageTexts and the outline. */
async function stExtractPdf(fsPath) {
  const electron = electronBridge();
  if (!electron || !electron.document || !electron.document.extractText) {
    throw new Error('Document extraction is not available in this build. Open the PDF in the desktop app.');
  }
  const result = await electron.document.extractText(fsPath);
  if (result && result.error) throw new Error(result.error.message || 'The document could not be read.');
  const text = String(result && result.text || '').trim();
  if (text.length < 200) {
    throw new Error(text.length === 0
      ? 'No text was found in that document. If it is a scanned PDF, run OCR on it first.'
      : `Only ${text.length} characters of text could be read from that document. It looks scanned; run OCR on it first.`);
  }
  const pageTexts = Array.isArray(result.pageTexts) && result.pageTexts.length ? result.pageTexts.map((p) => String(p || '')) : [text];
  const pageCount = Number(result.metadata && result.metadata.pageCount) || pageTexts.length;
  const outline = Array.isArray(result.outline) ? result.outline : [];
  const meta = (result && result.metadata) || {};
  const metadataTitle = String(meta.title || meta.Title || (meta.info && meta.info.Title) || result.title || '').trim();
  return { text, pageTexts, pageCount, outline, metadataTitle };
}

/** Read a canvas page as markdown through the core command. Copy of fcReadCanvasPage. */
async function stReadCanvasPage(pageId) {
  const result = await _api.commands.executeCommand('canvas.getPageMarkdown', pageId);
  if (!result || !result.markdown) throw new Error('That canvas page could not be read. Pick a page with written notes.');
  const text = String(result.markdown).trim();
  if (text.length < 120) {
    throw new Error(`Only ${text.length} characters could be read from "${result.title || 'that page'}". Pick a page with written notes.`);
  }
  return { text, title: result.title || 'Untitled' };
}

/**
 * The material's text: { pageTexts, text, pageCount }. PDFs through the
 * extractor, canvas pages through the canvas command, banks empty. Cached in
 * memory per material id and content hash.
 */
async function stMaterialText(material) {
  if (!material) return { pageTexts: [], text: '', pageCount: 0 };
  const key = stTextCacheKey(material);
  const hit = _stTextCache.get(key);
  if (hit) return hit;
  let value;
  if (material.kind === 'pdf') {
    const ex = await stExtractPdf(stFsPathOf(material.uri));
    value = { pageTexts: ex.pageTexts, text: ex.text, pageCount: ex.pageCount };
  } else if (material.kind === 'canvas') {
    const page = await stReadCanvasPage(material.uri);
    value = { pageTexts: [page.text], text: page.text, pageCount: 1 };
  } else {
    value = { pageTexts: [], text: '', pageCount: 0 };
  }
  stTextCachePut(key, value);
  return value;
}

// ── Ingest ──────────────────────────────────────────────────────────────────

/** Sections as [{ title, pageFrom, pageTo, level }] clamped to the page count; one whole-document section when nothing usable came back. */
function stNormalizeSections(sections, pageCount) {
  const total = Math.max(1, Number(pageCount) || 1);
  const out = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s) continue;
    const from = Math.min(total, Math.max(1, Math.round(Number(s.pageFrom) || 1)));
    const to = Math.min(total, Math.max(from, Math.round(Number(s.pageTo) || from)));
    const title = String(s.title || '').trim() || `Pages ${from} to ${to}`;
    out.push({ title, pageFrom: from, pageTo: to, level: Number(s.level) || 0 });
  }
  if (!out.length) out.push({ title: total > 1 ? `Pages 1 to ${total}` : 'Page 1', pageFrom: 1, pageTo: total, level: 0 });
  return out;
}

/**
 * Ingest a PDF: extract, hash, find its sections (the PDF outline when the
 * extractor returns one, else the numbered-heading heuristic over the page
 * texts), store the material and its sections. Returns the material.
 */
async function stIngestPdf(fsPath) {
  const path = stFsPathOf(fsPath);
  const ex = await stExtractPdf(path);
  const contentHash = stHashText(ex.text);
  const raw = ex.outline.length
    ? stSectionsFromOutline(ex.outline, ex.pageCount)
    : stHeadingsFromPages(ex.pageTexts);
  const sections = stNormalizeSections(raw, ex.pageCount);
  const uri = stUriOf(path);
  // An existing material keeps its label; a new one is named by the PDF's
  // title, else its file name made readable (stMaterialLabelFor).
  const prior = await db.get("SELECT label FROM st_materials WHERE kind = 'pdf' AND uri = ?", [uri]);
  const material = await stUpsertMaterial({
    kind: 'pdf',
    uri,
    label: prior && prior.label ? prior.label : stMaterialLabelFor(stFileNameOf(path), ex.metadataTitle),
    pageCount: ex.pageCount,
    contentHash,
    outline: sections,
  });
  await stEnsureSections(material.id, sections);
  stTextCachePut(stTextCacheKey(material), { pageTexts: ex.pageTexts, text: ex.text, pageCount: ex.pageCount });
  return material;
}

/** Ingest a canvas page as a one-page material with one section. */
async function stIngestCanvasPage(pageId) {
  const page = await stReadCanvasPage(pageId);
  const contentHash = stHashText(page.text);
  const sections = [{ title: page.title, pageFrom: 1, pageTo: 1, level: 0 }];
  const material = await stUpsertMaterial({
    kind: 'canvas',
    uri: String(pageId),
    label: page.title,
    pageCount: 1,
    contentHash,
    outline: sections,
  });
  await stEnsureSections(material.id, sections);
  stTextCachePut(stTextCacheKey(material), { pageTexts: [page.text], text: page.text, pageCount: 1 });
  return material;
}

/** The FileType.Directory value of api.workspace.fs.readdir entries. */
const ST_FS_DIRECTORY = 2;

/**
 * Quick pick over every .pdf under the workspace folders. Walks
 * api.workspace.fs.readdir, skipping dot folders and node_modules, capped at
 * a few thousand entries. Returns the chosen fsPath or null.
 */
async function stPickWorkspacePdf() {
  const folders = (_api.workspace && _api.workspace.workspaceFolders) || [];
  const fs = _api.workspace && _api.workspace.fs;
  if (!folders.length || !fs || typeof fs.readdir !== 'function') {
    await _api.window.showInformationMessage('Open a workspace folder first.');
    return null;
  }
  const MAX = 3000;
  const found = [];
  const walk = async (dirUri, rel, depth) => {
    if (depth > 12 || found.length >= MAX) return;
    let entries;
    try { entries = await fs.readdir(dirUri); } catch { return; }
    for (const ent of entries || []) {
      if (found.length >= MAX) return;
      const name = String(ent.name || '');
      if (!name || name.startsWith('.') || name === 'node_modules') continue;
      const childUri = `${dirUri.replace(/\/$/, '')}/${name}`;
      const childRel = rel ? `${rel}/${name}` : name;
      if (ent.type === ST_FS_DIRECTORY) await walk(childUri, childRel, depth + 1);
      else if (stExtOf(name) === 'pdf') found.push({ name, rel: childRel, uri: childUri });
    }
  };
  for (const folder of folders) {
    const prefix = folders.length > 1 ? folder.name : '';
    await walk(String(folder.uri), prefix, 0);
  }
  if (!found.length) {
    await _api.window.showInformationMessage('No PDFs were found in this workspace.');
    return null;
  }
  found.sort((a, b) => a.rel.localeCompare(b.rel));
  const pick = await _api.window.showQuickPick(
    found.map((f) => ({ label: f.name, description: f.rel })),
    { placeholder: `Study which PDF? (${found.length} found)`, matchOnDescription: true },
  );
  if (!pick) return null;
  const chosen = found.find((f) => f.name === pick.label && f.rel === pick.description);
  return chosen ? stFsPathOf(chosen.uri) : null;
}

// ── Imports ─────────────────────────────────────────────────────────────────

const ST_IMPORT_KINDS = { essay: 'essay', short: 'short', mc: 'mc', numeric: 'numeric', formula: 'formula', cloze: 'cloze', quant: 'short', qual: 'essay', other: 'essay' };

/** "CAS Exam 7 · 2019 Fall · Q5(b)" from the pieces an import carries. */
function stOriginLabel({ exam, sitting, number, part, paper, label } = {}) {
  if (label) return String(label);
  const parts = [];
  if (exam) parts.push(String(exam));
  else if (paper) parts.push(String(paper));
  if (sitting) parts.push(String(sitting));
  if (number != null && number !== '') parts.push(`Q${number}${part ? `(${part})` : ''}`);
  return parts.join(' · ');
}

/** The import keys kept in providerRef JSON, so report matching can read them back (stQuestionKeys). */
const ST_IMPORT_META_KEYS = ['exam', 'sitting', 'number', 'part', 'paper', 'source'];

/**
 * providerRef for an imported or provider question: JSON of the unknown
 * columns, the import keys, and a provider's own `ref` (stProviderRefOf
 * reads it back for the provider's open). '' when there is nothing to keep.
 */
function stImportProviderRef(raw, ref) {
  const out = {};
  const extras = stQuestionMeta({ providerRef: raw.providerRef != null ? raw.providerRef : (raw.extra && typeof raw.extra === 'object' ? raw.extra : '') });
  Object.assign(out, extras);
  for (const k of ST_IMPORT_META_KEYS) {
    const v = raw[k];
    if (v == null || String(v).trim() === '') continue;
    out[k] = k === 'part' ? String(v).trim().toLowerCase() : String(v).trim();
  }
  if (ref != null && ref !== '') out.ref = String(ref);
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

/** A parsed import entry (§7) as an StQuestion-shaped insert. */
function stImportedToQuestion(raw, { origin, bankId, sourceUri, providerId = '', ref = '' }) {
  const kind = String(raw.format || raw.kind || '').toLowerCase();
  let format = ST_IMPORT_KINDS[kind] || 'essay';
  const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o)) : [];
  if (format === 'mc' && options.length < 2) format = 'short';
  const rubric = stNormalizeRubric(raw.rubric);
  return {
    materialId: 0,
    conceptId: 0,
    format,
    stem: String(raw.stem || raw.question || '').trim(),
    options,
    answer: raw.answer == null ? '' : String(raw.answer),
    explanation: String(raw.explanation || ''),
    rubric,
    rubricOrigin: rubric.length ? String(raw.rubricOrigin || 'source') : '',
    contradictions: Array.isArray(raw.contradictions) ? raw.contradictions.map((c) => String(c)) : [],
    numeric: null,
    sourcePage: Number(raw.sourcePage || raw.page) || 0,
    sourceQuote: String(raw.sourceQuote || ''),
    sourceUri: String(raw.sourceUri || sourceUri || ''),
    origin: String(raw.origin || origin),
    originLabel: raw.originLabel ? String(raw.originLabel) : stOriginLabel(raw),
    providerId,
    providerRef: stImportProviderRef(raw, ref),
    bankId,
    checks: {},
    difficulty: '',
    hidden: false,
    edited: false,
  };
}

/** Read a workspace file as text through api.workspace.fs. */
async function stReadWorkspaceFile(fsPath) {
  const fs = _api.workspace && _api.workspace.fs;
  if (!fs || typeof fs.readFile !== 'function') throw new Error('Workspace file access is not available in this build.');
  const res = await fs.readFile(stUriOf(stFsPathOf(fsPath)));
  return typeof res === 'string' ? res : String((res && res.content) || '');
}

/** Import a question file (.md, .csv, .tsv, .json) as a bank. Returns { bank, inserted }. */
async function stImportQuestionFile(fsPath) {
  const path = stFsPathOf(fsPath);
  const ext = stExtOf(path);
  if (!['md', 'csv', 'tsv', 'json', 'txt'].includes(ext)) {
    throw new Error('Pick a Markdown, CSV, TSV or JSON file of questions.');
  }
  const text = await stReadWorkspaceFile(path);
  const parsed = stParseQuestionFile(text, ext) || { questions: [], skipped: 0 };
  const entries = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (!entries.length) throw new Error('No questions were found in that file. Each question needs question text: a Q: line or a **Question** block in Markdown, a question column in CSV or TSV, or a question field in JSON.');
  const bank = await stInsertBank({ name: stFileNameOf(path), kind: 'file', path, count: entries.length });
  const sourceUri = stUriOf(path);
  const rows = entries
    .map((raw) => stImportedToQuestion(raw, { origin: 'imported', bankId: bank.id, sourceUri }))
    .filter((q) => q.stem);
  const inserted = await stInsertQuestions(rows);
  await stSetBankCount(bank.id, inserted.length);
  return { bank: await stGetBank(bank.id), inserted: inserted.length, skipped: Number(parsed.skipped) || 0 };
}

/**
 * Import an examiner's report: extract its pages, parse the entries, match
 * them to the bank questions by exam, sitting, number and part, and write
 * each matched question's rubric and contradictions (origin 'report') with
 * the report as its source. Returns { bank, matched, unmatched }.
 */
async function stImportExaminerReport(fsPath, { modelId } = {}) {
  const path = stFsPathOf(fsPath);
  const ex = await stExtractPdf(path);
  const report = stParseExaminerReport(ex.pageTexts) || { exam: '', sitting: '', questions: [] };
  const entries = Array.isArray(report.questions) ? report.questions : [];
  if (!entries.length) throw new Error('No question entries were found in that report. Check that it is a CAS examiner\'s report PDF.');
  const bank = await stInsertBank({ name: stFileNameOf(path), kind: 'report', path, exam: report.exam || '', sitting: report.sitting || '', count: entries.length });
  const candidates = (await stListQuestions({ includeHidden: true })).filter((q) => q.origin !== 'generated');
  const matches = stMatchReportToQuestions(report, candidates) || [];
  const reportUri = stUriOf(path);
  // One question can be named by several entries (a whole Q5 against parts
  // a and b): its rubric is made from all of them together.
  const byQuestion = new Map();
  for (const m of matches) {
    if (!m || !m.entry) continue;
    if (!byQuestion.has(m.questionId)) byQuestion.set(m.questionId, []);
    byQuestion.get(m.questionId).push(m.entry);
  }
  let matched = 0;
  for (const [questionId, list] of byQuestion) {
    const q = candidates.find((c) => c.id === questionId);
    if (!q) continue;
    const entry = list.length === 1 ? list[0] : {
      number: list[0].number,
      part: '',
      sampleAnswer: list.map((e) => `${e.part ? `Part ${e.part}: ` : ''}${e.sampleAnswer || ''}`.trim()).filter(Boolean).join('\n\n'),
      commonErrors: list.map((e) => String(e.commonErrors || '').trim()).filter(Boolean).join('\n\n'),
      page: list[0].page,
    };
    const derived = await stRubricFromReport(entry, { modelId });
    if (!derived || !derived.rubric || !derived.rubric.length) continue;
    q.rubric = derived.rubric;
    q.contradictions = Array.isArray(derived.contradictions) ? derived.contradictions : [];
    q.rubricOrigin = 'report';
    q.sourceUri = reportUri;
    q.sourcePage = Number(entry.page) || 0;
    await stUpdateQuestion(q);
    matched += 1;
  }
  const named = new Set(matches.map((m) => m && m.entry));
  const unmatched = entries.filter((e) => !named.has(e)).length;
  return { bank, matched, unmatched };
}

/** Providers seen by a sync in this run: one gone from the registry since was turned off. */
const _stSeenProviders = new Set();

/** Remove a provider's questions, its bank and their own concepts. Answers stay (history). */
async function stDeleteProviderBank(bank) {
  await db.run('DELETE FROM st_questions WHERE provider_id = ? OR bank_id = ?', [bank.providerId, bank.id]);
  await stDeleteBankMaterial(bank.id);
  await db.run('DELETE FROM st_banks WHERE id = ?', [bank.id]);
}

/**
 * Pull every question provider's items into st_questions with origin
 * 'provider' (idempotent by provider_id + the provider's ref) and one
 * st_banks row per provider. `registry` is what the core command
 * `questions.getRegistry` returns: { register, list, onDidChange }.
 * A provider that a sync in this run saw and that is gone now (its tool
 * was turned off) loses its questions and bank; answers stay as history.
 * Providers absent since the start are kept unless `prune: 'all'` (tools
 * still registering at startup must not lose their banks to a race).
 * Returns { providers, inserted, updated, removed }.
 */
async function stSyncProviders(registry, { prune = 'gone' } = {}) {
  const lister = registry && typeof registry.list === 'function' ? registry.list
    : registry && typeof registry.listQuestionProviders === 'function' ? registry.listQuestionProviders : null;
  if (!lister) return { providers: 0, inserted: 0, updated: 0, removed: 0 };
  let providers;
  try { providers = Array.from(lister.call(registry) || []); } catch { providers = []; }
  let inserted = 0;
  let updated = 0;
  const banks = await stListBanks();
  const live = new Set();
  for (const p of providers) {
    if (!p || !p.id || typeof p.list !== 'function') continue;
    live.add(String(p.id));
    let items;
    try { items = await p.list({ limit: 2000 }); } catch (err) {
      console.warn(`[Study] provider ${p.id} failed to list:`, err && err.message);
      continue;
    }
    if (!Array.isArray(items)) continue;
    let bank = banks.find((b) => b.kind === 'provider' && b.providerId === p.id);
    if (!bank) {
      bank = await stInsertBank({ name: String(p.displayName || p.id), kind: 'provider', providerId: p.id, count: 0 });
      banks.push(bank);
    }
    const existing = await db.all('SELECT * FROM st_questions WHERE provider_id = ?', [p.id]);
    const byRef = new Map(existing.map((r) => { const q = stRowToQuestion(r); return [stProviderRefOf(q), q]; }));
    const rows = [];
    for (const item of items) {
      if (!item || item.ref == null) continue;
      const ref = String(item.ref);
      const mapped = stImportedToQuestion({
        kind: item.kind,
        question: item.question,
        answer: item.answer,
        rubric: item.rubric,
        paper: item.paper,
        source: item.source,
        exam: item.exam,
        sitting: item.sitting,
        number: item.number,
        part: item.part,
        label: item.label,
        sourceUri: item.sourceUri,
        sourcePage: item.sourcePage,
      }, { origin: 'provider', bankId: bank.id, providerId: p.id, ref });
      if (!mapped.stem) continue;
      const prior = byRef.get(ref);
      if (prior) {
        const changed = prior.stem !== mapped.stem || prior.answer !== mapped.answer || prior.originLabel !== mapped.originLabel
          || prior.format !== mapped.format || prior.providerRef !== mapped.providerRef || prior.bankId !== bank.id
          || stJsonCol(prior.rubric, '') !== stJsonCol(mapped.rubric, '');
        if (changed && !prior.edited) {
          await stUpdateQuestion({ ...prior, stem: mapped.stem, answer: mapped.answer, format: mapped.format, originLabel: mapped.originLabel,
            providerRef: mapped.providerRef, bankId: bank.id,
            rubric: mapped.rubric.length ? mapped.rubric : prior.rubric, rubricOrigin: mapped.rubric.length ? 'source' : prior.rubricOrigin,
            sourceUri: mapped.sourceUri || prior.sourceUri, sourcePage: mapped.sourcePage || prior.sourcePage });
          updated += 1;
        }
      } else {
        rows.push(mapped);
      }
    }
    if (rows.length) {
      await stInsertQuestions(rows);
      inserted += rows.length;
    }
    const count = await db.get('SELECT COUNT(*) AS n FROM st_questions WHERE provider_id = ?', [p.id]);
    await stSetBankCount(bank.id, (count && count.n) || 0);
  }
  let removed = 0;
  for (const bank of banks) {
    if (bank.kind !== 'provider' || live.has(bank.providerId)) continue;
    if (prune !== 'all' && !_stSeenProviders.has(bank.providerId)) continue;
    await stDeleteProviderBank(bank);
    _stSeenProviders.delete(bank.providerId);
    removed += 1;
  }
  for (const id of live) _stSeenProviders.add(id);
  if (removed) _emitDataChanged();
  return { providers: providers.length, inserted, updated, removed };
}

// ── Weak concepts ───────────────────────────────────────────────────────────

/**
 * Concepts across every material that have been answered, weak first
 * (lowest mastery first), then stale, then clean. Each carries `state`.
 */
async function stWeakConcepts({ limit = 50 } = {}) {
  const rows = await db.all('SELECT * FROM st_concepts WHERE answers > 0 ORDER BY mastery ASC, last_answered_at ASC');
  const now = stNow();
  const staleDays = Number(cfg('staleDays', 14)) || 14;
  const rank = { weak: 0, stale: 1, clean: 2, unasked: 3 };
  const list = rows.map((r) => {
    const c = stRowToConcept(r);
    c.state = stConceptState(c, now, { staleDays });
    return c;
  });
  list.sort((a, b) => (rank[a.state] - rank[b.state]) || (a.mastery - b.mastery) || (a.lastAnsweredAt - b.lastAnsweredAt));
  return list.slice(0, Math.max(1, Number(limit) || 50));
}
