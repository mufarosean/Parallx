// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 27: SUBJECTS — the record kept in canvas databases
// ═══════════════════════════════════════════════════════════════════════════════
//
// A subject (st_subjects, migration study_004) names a canvas page and the
// canvas databases under it: Units, Questions, a Work Log. They are read and
// written through the core's door, api.canvas.databases; nothing here knows
// how the canvas stores them. The Questions database is the record:
//
//   in    every row is a question of the subject's bank (st_questions, by the
//         row's page id), taken in again whenever the database changes, so a
//         row added, retitled, re-answered or deleted in the table is what
//         the next session asks. One read of the rows, one batch of inserts.
//   out   each final verdict on a session item goes to its row (Attempts,
//         Correct, Last Result, Last Answered) as a difference from what that
//         item already added (st_subject_marks), so a hand edit is added to
//         and a changed verdict never counts an attempt twice. One row written.
//   then  the unit's kept columns in Units follow, and the session's one row
//         in the Work Log (st_subject_logs holds which row).
//
// Everything a subject has running (its change listeners, its timer) belongs
// to the activation and goes with it; nothing is written when Study goes off.
// The pure part is 12-subject-model.js.

/** id → the live state of a subject: { subject, rows, unitRows, counts, ... }. */
const _stSubjects = new Map();

function stSubjectDoor() {
  return _api && _api.canvas && _api.canvas.databases ? _api.canvas.databases : null;
}

/** The door, or the reason there is none (an older shell). */
function stSubjectDoorOrThrow() {
  const door = stSubjectDoor();
  if (!door) throw new Error('This version of Parallx has no canvas databases for Study to keep a subject in.');
  return door;
}

const stSubjectProviderId = (id) => `subject:${Number(id) || 0}`;

function stRowToSubject(row) {
  const mapping = stParseJson(row.mapping_json, {}) || {};
  return {
    id: row.id,
    name: row.name,
    pageId: row.page_id || '',
    unitsDb: row.units_db || '',
    questionsDb: row.questions_db || '',
    logDb: row.log_db || '',
    notesDb: row.notes_db || '',
    sourcesFolder: row.sources_folder || '',
    mapping,
    bankId: row.bank_id || 0,
    folded: !!row.folded,
    createdAt: row.created_at || 0,
  };
}

async function stListSubjects() {
  const rows = await db.all('SELECT * FROM st_subjects ORDER BY created_at, id');
  return rows.map(stRowToSubject);
}

/** A subject's mapping as column names by role. */
function stSubjectNames(subject) {
  const out = {};
  for (const role of ST_SUBJECT_ROLES) out[role] = String((subject.mapping[role] && subject.mapping[role].name) || ST_SUBJECT_ROLE_LABELS[role]);
  return out;
}

/** The columns Study makes sure a subject's Questions database has: all of them in one it made, the mapped ones in one of his. */
function stSubjectQuestionSpecs(subject) {
  if (subject.mapping.own) return stSubjectColumns(subject.unitsDb).questions;
  const names = stSubjectNames(subject);
  // A column of his is never given options: only its absence is mended.
  return ST_SUBJECT_ROLES.map((role) => {
    const c = stSubjectRoleColumn(role, subject.unitsDb);
    return { name: names[role], type: c.type, ...(c.type === 'relation' ? { config: c.config } : {}) };
  });
}

/** The live subject a session scope draws from, or null. */
function stSubjectOfScope(scope) {
  if (!scope || scope.kind !== 'bank' || !Array.isArray(scope.bankIds) || scope.bankIds.length !== 1) return null;
  const bankId = Number(scope.bankIds[0]);
  for (const st of _stSubjects.values()) if (Number(st.subject.bankId) === bankId) return st;
  return null;
}

/** Is this bank a subject's (shown under Subjects, not under Question banks)? */
function stIsSubjectBank(bank) {
  return !!bank && bank.kind === 'subject';
}

/** The scope of a session over a subject, or over one of its units. */
function stSubjectScope(subject, unit = '') {
  const scope = { kind: 'bank', bankIds: [subject.bankId], materialIds: [], label: unit ? `${subject.name} · ${unit}` : subject.name };
  if (unit) scope.unit = unit;
  return scope;
}

/** A fixed scope's questions narrowed to its unit, when it names one. */
function stScopeUnitFilter(scope, questions) {
  const unit = scope && scope.unit ? String(scope.unit) : '';
  if (!unit) return questions;
  return (questions || []).filter((q) => stSubjectSameName(stQuestionMeta(q).paper, unit));
}

/**
 * What the sidebar shows: every subject with its units in the Units
 * database's order (Order, then the table's own), each "answered of total"
 * as the Questions rows say now.
 */
function stSubjectsShown() {
  const out = [];
  for (const st of _stSubjects.values()) {
    const counts = st.counts || { total: 0, answered: 0, units: [] };
    const order = (r) => { const n = Number((r.values || {}).Order); return Number.isFinite(n) && (r.values || {}).Order !== '' && (r.values || {}).Order != null ? n : Infinity; };
    const units = (st.unitRows || []).map((r, i) => ({ r, i })).filter((x) => String(x.r.title || '').trim())
      .sort((a, b) => (order(a.r) - order(b.r)) || (a.i - b.i))
      .map(({ r }) => {
        const c = counts.units.find((u) => stSubjectSameName(u.name, r.title));
        return { name: String(r.title).trim(), rowId: r.pageId, total: c ? c.total : 0, answered: c ? c.answered : 0 };
      });
    out.push({ id: st.subject.id, name: st.subject.name, subject: st.subject, folded: !!st.subject.folded, total: counts.total, answered: counts.answered, units, ready: !!st.synced, problem: st.problem || '' });
  }
  return out;
}

/** Before each write to a database: work that outlived its activation (Study went off under it) stops here, so nothing is written after. */
function stSubjectLive(st) {
  if (!stIsCurrent(st.token) || _stSubjects.get(st.subject.id) !== st) throw stStoppedError();
}

// ── Taking the rows in ──────────────────────────────────────────────────────

/** The questions of a subject follow its rows: inserted, changed (whatever was edited in Study), or put aside when the row is gone. */
async function stSubjectIngest(st, items) {
  const subject = st.subject;
  const pid = stSubjectProviderId(subject.id);
  const existing = await db.all('SELECT id, stem, answer, format, provider_ref, rubric_origin, bank_id, edited FROM st_questions WHERE provider_id = ?', [pid]);
  const byRef = new Map();
  for (const r of existing) byRef.set(stProviderRefOf({ providerRef: r.provider_ref }), r);
  const now = stNow();
  const statements = [];
  const insertSql = `INSERT INTO st_questions (${ST_QUESTION_COLS.join(', ')}) VALUES (${stPlaceholders(ST_QUESTION_COLS)})`;
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.ref)) continue;
    seen.add(item.ref);
    const mapped = stImportedToQuestion({ kind: item.kind, question: item.question, answer: item.answer, paper: item.unit }, { origin: 'provider', bankId: subject.bankId, providerId: pid, ref: item.ref });
    const prior = byRef.get(item.ref);
    if (!prior) { statements.push({ sql: insertSql, params: stQuestionParams(mapped, now) }); continue; }
    const answerChanged = String(prior.answer || '') !== mapped.answer;
    if (prior.stem === mapped.stem && !answerChanged && prior.format === mapped.format && prior.provider_ref === mapped.providerRef && Number(prior.bank_id) === Number(subject.bankId) && !prior.edited) continue;
    // A changed answer drops a rubric made from the old one (an examiner's report keeps its own).
    const dropRubric = answerChanged && prior.rubric_origin !== 'report';
    statements.push({
      sql: `UPDATE st_questions SET stem = ?, answer = ?, format = ?, origin_label = ?, provider_ref = ?, bank_id = ?, edited = 0${dropRubric ? ", rubric_json = '[]', rubric_origin = ''" : ''} WHERE id = ?`,
      params: [mapped.stem, mapped.answer, mapped.format, mapped.originLabel, mapped.providerRef, subject.bankId, prior.id],
    });
    if (dropRubric && typeof _stTypedRubrics !== 'undefined') _stTypedRubrics.delete(prior.id);
  }
  // A row that is gone is no longer asked; its question stays for the sessions that asked it.
  for (const [ref, r] of byRef) {
    if (seen.has(ref)) continue;
    statements.push({ sql: 'UPDATE st_questions SET provider_id = ?, bank_id = 0, hidden = 1 WHERE id = ?', params: [`${pid}:gone`, r.id] });
  }
  if (!statements.length) return false;
  await db.runAll(statements);
  await db.run('UPDATE st_banks SET count = (SELECT COUNT(*) FROM st_questions WHERE provider_id = ?), name = ? WHERE id = ?', [pid, subject.name, subject.bankId]);
  return true;
}

/** The mapped columns by the names they have now: a renamed column is followed by its id. */
async function stSubjectFollowRenames(st, columns) {
  const subject = st.subject;
  let changed = false;
  for (const role of ST_SUBJECT_ROLES) {
    const m = subject.mapping[role];
    if (!m || !m.name) continue;
    const byName = columns.find((c) => stSubjectSameName(c.name, m.name));
    const byId = m.id ? columns.find((c) => c.id === m.id) : null;
    const now = byName || byId;
    if (!now) continue;
    if (now.name !== m.name || now.id !== m.id) { subject.mapping[role] = { id: now.id, name: now.name }; changed = true; }
  }
  if (changed) await db.run('UPDATE st_subjects SET mapping_json = ? WHERE id = ?', [stJsonCol(subject.mapping, '{}'), subject.id]);
}

/**
 * Read a subject's databases and make Study agree with them. With `ensure`,
 * the columns Study needs are put back first (one he deleted returns empty;
 * Study's own are then worked out again below). Writes only what differs, so
 * the changes this causes end in a run that writes nothing.
 */
async function stSubjectSyncNow(st, { ensure = false } = {}) {
  const door = stSubjectDoor();
  if (!door) return;
  const subject = st.subject;
  const specs = stSubjectColumns(subject.unitsDb);
  const read = () => Promise.all([door.get(subject.questionsDb), door.get(subject.unitsDb), subject.logDb ? door.get(subject.logDb).catch(() => null) : null]);
  let [qInfo, uInfo, logInfo] = await read();
  if (!qInfo || !uInfo) {
    // He deleted one of them: said in the sidebar, nothing made in its place.
    st.problem = !qInfo ? 'Its questions database is gone.' : 'Its Units database is gone.';
    st.rows = new Map(); st.unitRows = []; st.counts = { total: 0, answered: 0, units: [] }; st.synced = true;
    return;
  }
  if (ensure) {
    stSubjectLive(st);
    await door.ensureColumns(subject.unitsDb, specs.units);
    await door.ensureColumns(subject.questionsDb, stSubjectQuestionSpecs(subject));
    if (logInfo) await door.ensureColumns(subject.logDb, specs.log);
    [qInfo, uInfo, logInfo] = await read();
    if (!qInfo || !uInfo) return;
  }
  st.problem = '';
  await stSubjectFollowRenames(st, qInfo.columns);
  const names = stSubjectNames(subject);
  const [rows, unitRows] = await Promise.all([door.listRows(subject.questionsDb), door.listRows(subject.unitsDb)]);
  const titleById = new Map(unitRows.map((r) => [r.pageId, r.title]));
  const counts = stSubjectCounts(rows, names, titleById);

  // A unit the questions name and Units lacks gets its row (a select's own order, else as first named).
  const unitColumn = qInfo.columns.find((c) => stSubjectSameName(c.name, names.unit));
  const options = unitColumn && unitColumn.config && Array.isArray(unitColumn.config.options) ? unitColumn.config.options.map((o) => String(o && typeof o === 'object' ? o.value : o)) : [];
  const rank = (name) => { const i = options.findIndex((o) => stSubjectSameName(o, name)); return i < 0 ? options.length : i; };
  const missing = counts.units.filter((u) => !unitRows.some((r) => stSubjectSameName(r.title, u.name))).sort((a, b) => rank(a.name) - rank(b.name));
  const unitColumnNames = uInfo.columns.map((c) => c.name);
  const hasOrder = unitColumnNames.some((n) => stSubjectSameName(n, 'Order'));
  let nextOrder = unitRows.reduce((m, r) => Math.max(m, Number((r.values || {}).Order) || 0), 0);
  for (const u of missing) {
    nextOrder += 1;
    stSubjectLive(st);
    const made = await door.addRow(subject.unitsDb, { title: u.name, values: hasOrder ? { Order: nextOrder } : {} });
    unitRows.push({ pageId: made.pageId, title: made.title, values: { ...(made.values || {}) } });
  }

  for (const change of stSubjectUnitChanges(unitRows, counts, unitColumnNames)) {
    stSubjectLive(st);
    await door.updateRow(subject.unitsDb, change.pageId, { values: change.values });
    const row = unitRows.find((r) => r.pageId === change.pageId);
    if (row) row.values = { ...(row.values || {}), ...change.values };
  }

  stSubjectLive(st);
  await stSubjectIngest(st, stSubjectItems(rows, names, titleById));
  st.rows = new Map(rows.map((r) => [r.pageId, r]));
  st.unitRows = unitRows;
  st.counts = counts;
  st.names = names;
  st.columns = qInfo.columns;
  st.logColumns = logInfo ? logInfo.columns.map((c) => c.name) : [];
  st.synced = true;
}

// ── One subject's work, in order ────────────────────────────────────────────

/** Run `fn` after whatever this subject is doing; a failure is said once and does not stop what follows. */
function stSubjectEnqueue(st, fn) {
  const token = st.token;
  const run = () => (stIsCurrent(token) && _stSubjects.get(st.subject.id) === st ? fn() : undefined);
  st.chain = st.chain.then(run, run);
  return st.chain;
}

/** The sync the last changes asked for, now. */
async function stSubjectFlush(st) {
  if (!st.dirty && st.synced) return;
  const ensure = st.ensure || !st.synced;
  st.dirty = false;
  st.ensure = false;
  clearTimeout(st.timer);
  try {
    await stSubjectSyncNow(st, { ensure });
    st.tries = 0;
  } catch (err) {
    if (stIsStopped(err) || !stIsCurrent(st.token)) return;
    // The canvas is still starting (the door says so): look again shortly.
    st.dirty = true; st.ensure = st.ensure || ensure;
    st.tries = (st.tries || 0) + 1;
    if (st.tries <= 20) st.timer = setTimeout(() => void stSubjectEnqueue(st, () => stSubjectFlush(st)), 1500);
    if (st.tries === 1 || st.tries === 20) console.warn(`[Study] ${st.subject.name}: its databases could not be read:`, err && err.message);
    st.problem = st.tries >= 20 ? 'Its databases could not be read.' : '';
    return;
  }
  if (stIsCurrent(st.token)) _emitDataChanged();
}

/** One of the subject's databases changed (the person, the chat, another tool, or Study itself): read again shortly. */
function stSubjectTouched(st, kind) {
  st.dirty = true;
  // A column deleted is not put back under his hands: it returns with the next change of rows or values, or at the next start.
  if (kind !== 'columns') st.ensure = true;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => void stSubjectEnqueue(st, () => stSubjectFlush(st)), 200);
}

/** Start following a subject: hear its databases, and read them once. */
function stSubjectWatch(context, subject, token = stActivation()) {
  const door = stSubjectDoor();
  if (!door || !stIsCurrent(token)) return null;
  const st = { subject, token, rows: new Map(), unitRows: [], counts: null, names: stSubjectNames(subject), columns: [], logColumns: [], synced: false, dirty: true, ensure: true, timer: 0, tries: 0, chain: Promise.resolve(), listeners: [], problem: '' };
  _stSubjects.set(subject.id, st);
  for (const id of new Set([subject.questionsDb, subject.unitsDb, subject.logDb].filter(Boolean))) {
    const off = stOwn(context, token, door.onDidChange(id, (e) => { if (stIsCurrent(token) && _stSubjects.get(subject.id) === st) stSubjectTouched(st, e && e.kind); }));
    st.listeners.push(off);
  }
  void stSubjectEnqueue(st, () => stSubjectFlush(st));
  return st;
}

/** Show or hide a subject's units in the sidebar; kept with the subject. */
async function stSetSubjectFolded(id, on) {
  await db.run('UPDATE st_subjects SET folded = ? WHERE id = ?', [on ? 1 : 0, id]);
  const st = _stSubjects.get(id);
  if (st) st.subject.folded = !!on;
  _emitDataChanged();
}

/** Stop following every subject (deactivate): no timer left, nothing written. */
function stSubjectsReset() {
  for (const st of _stSubjects.values()) clearTimeout(st.timer);
  _stSubjects.clear();
}

// ── Making and removing a subject ───────────────────────────────────────────

/** The entries of a folder (an absolute path, or one inside the workspace), [] when it cannot be read. */
async function stSubjectFolderListing(folder) {
  const fs = _api.workspace && _api.workspace.fs;
  let p = String(folder || '').trim();
  if (!p || !fs || typeof fs.readdir !== 'function') return [];
  if (!/^([a-zA-Z]:[\\/]|[\\/]|file:)/.test(p)) p = `${stWorkspaceRoot().replace(/[\\/]$/, '')}/${p}`;
  try { return (await fs.readdir(stUriOf(stFsPathOf(p)))) || []; } catch { return []; }
}

/**
 * New Subject: a page named after it, Units and a Work Log under it, and its
 * Questions: a new database there, or one he has (`questionsDb`), used in
 * place with `mapping` ({ role: column name, or '' to add the column }).
 * Returns the subject; its rows are taken in right after.
 */
async function stCreateSubject({ name, folder = '', questionsDb = '', notesDb = '', mapping = null }) {
  const door = stSubjectDoorOrThrow();
  const title = String(name || '').trim();
  if (!title) throw new Error('Give the subject a name.');
  let adopted = null;
  if (questionsDb) {
    adopted = await door.get(questionsDb);
    if (!adopted) throw new Error('That database is no longer there.');
  }
  const page = await door.createPage({ title });
  const units = await door.create({ title: 'Units', parentPageId: page.id, columns: stSubjectColumns('').units });
  const specs = stSubjectColumns(units.id);
  const stored = {};
  let questionsId = questionsDb;
  if (!adopted) {
    const made = await door.create({ title: 'Questions', parentPageId: page.id, columns: specs.questions });
    questionsId = made.id;
    stored.own = true;
    for (const role of ST_SUBJECT_ROLES) { const c = made.columns.find((x) => x.name === ST_SUBJECT_ROLE_LABELS[role]); stored[role] = { id: c ? c.id : '', name: ST_SUBJECT_ROLE_LABELS[role] }; }
  } else {
    const chosen = mapping || stSubjectGuessMapping(adopted.columns);
    const taken = new Set(adopted.columns.map((c) => stSubjectFold(c.name)));
    const add = [];
    for (const role of ST_SUBJECT_ROLES) {
      const have = chosen[role] ? adopted.columns.find((c) => c.type !== 'title' && stSubjectSameName(c.name, chosen[role])) : null;
      if (have) { stored[role] = { id: have.id, name: have.name }; continue; }
      // A column is added under the role's name; when he already has one of that name doing something else, under "Study <name>".
      let colName = ST_SUBJECT_ROLE_LABELS[role];
      if (taken.has(stSubjectFold(colName))) colName = `Study ${colName}`;
      taken.add(stSubjectFold(colName));
      add.push({ ...stSubjectRoleColumn(role, units.id), name: colName });
      stored[role] = { id: '', name: colName };
    }
    if (add.length) await door.ensureColumns(questionsId, add);
  }
  const log = await door.create({ title: 'Work Log', parentPageId: page.id, columns: specs.log });
  const proposed = stSubjectUnitsFromListing(await stSubjectFolderListing(folder));
  for (let i = 0; i < proposed.length; i++) await door.addRow(units.id, { title: proposed[i], values: { Order: i + 1 } });

  const bank = await stInsertBank({ name: title, kind: 'subject', providerId: '', count: 0 });
  const res = await db.run(
    'INSERT INTO st_subjects (name, page_id, units_db, questions_db, log_db, notes_db, sources_folder, mapping_json, bank_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [title, page.id, units.id, questionsId, log.id, String(notesDb || ''), String(folder || '').trim(), stJsonCol(stored, '{}'), bank.id, stNow()],
  );
  await db.run('UPDATE st_banks SET provider_id = ? WHERE id = ?', [stSubjectProviderId(res.lastInsertRowid), bank.id]);
  const subject = stRowToSubject(await db.get('SELECT * FROM st_subjects WHERE id = ?', [res.lastInsertRowid]));
  // Its rows are read behind this (a long database takes a moment): the sidebar shows the subject now and its numbers as they arrive.
  stSubjectWatch(null, subject);
  _emitDataChanged();
  return subject;
}

/** Remove Subject: Study forgets it (its bank, the sessions over it, what it noted of them). The page and every database stay as they are. */
async function stRemoveSubject(id) {
  const st = _stSubjects.get(id);
  if (st) {
    clearTimeout(st.timer);
    for (const off of st.listeners) off.dispose();
    _stSubjects.delete(id);
  }
  const row = await db.get('SELECT * FROM st_subjects WHERE id = ?', [id]);
  if (!row) return;
  await db.run('DELETE FROM st_subject_marks WHERE subject_id = ?', [id]);
  await db.run('DELETE FROM st_subject_logs WHERE subject_id = ?', [id]);
  await db.run('DELETE FROM st_questions WHERE provider_id IN (?, ?)', [stSubjectProviderId(id), `${stSubjectProviderId(id)}:gone`]);
  if (row.bank_id) await stDeleteBank(row.bank_id);
  await db.run('DELETE FROM st_subjects WHERE id = ?', [id]);
  _emitDataChanged();
}

// ── Results back to the rows ────────────────────────────────────────────────

/** The session's row in the Work Log: made with the first answer, then only what changed is written. */
async function stSubjectWriteLog(st, session, items, questionsById) {
  const door = stSubjectDoor();
  const subject = st.subject;
  if (!door || !subject.logDb) return;
  const unitIds = [];
  for (const item of items) {
    if (!(item.status === 'right' || item.status === 'wrong' || item.status === 'answered')) continue;
    const q = questionsById.get(item.questionId);
    const unit = q ? String(stQuestionMeta({ providerRef: q.provider_ref }).paper || '') : '';
    const row = unit ? st.unitRows.find((r) => stSubjectSameName(r.title, unit)) : null;
    if (row && !unitIds.includes(row.pageId)) unitIds.push(row.pageId);
  }
  const want = stSubjectLogValues(session, items, unitIds);
  if (!want) return;
  stSubjectLive(st);
  const has = (name) => st.logColumns.some((c) => stSubjectSameName(c, name));
  const values = Object.fromEntries(Object.entries(want.values).filter(([name]) => has(name)));
  const rec = await db.get('SELECT * FROM st_subject_logs WHERE session_id = ?', [session.id]);
  const written = rec ? (stParseJson(rec.written_json, {}) || {}) : {};
  if (rec && rec.row_id) {
    const changed = Object.fromEntries(Object.entries(values).filter(([name, v]) => JSON.stringify(written[name]) !== JSON.stringify(v)));
    if (!Object.keys(changed).length) return;
    try {
      await door.updateRow(subject.logDb, rec.row_id, { values: changed });
      await db.run('UPDATE st_subject_logs SET written_json = ? WHERE session_id = ?', [stJsonCol({ ...written, ...changed }, '{}'), session.id]);
      return;
    } catch (err) {
      if (stIsStopped(err)) throw err;
      // The row is gone from the Work Log: the work is logged again below.
    }
  }
  const made = await door.addRow(subject.logDb, { title: want.title, values });
  await db.run('INSERT OR REPLACE INTO st_subject_logs (session_id, subject_id, row_id, written_json) VALUES (?, ?, ?, ?)', [session.id, subject.id, made.pageId, stJsonCol(values, '{}')]);
}

/**
 * Make a session's rows say what its items say: every item with a final
 * verdict has added one attempt to its question's row, and Correct and Last
 * Result follow the verdict as it stands now (the grader's, or his over it).
 * Then the units' kept columns and the session's Work Log row follow.
 * `seconds` is the session's own time when the caller knows it better than
 * the stored row (the pane, as its tab closes).
 */
async function stSubjectReconcile(sessionId, { seconds = 0 } = {}) {
  const door = stSubjectDoor();
  const first = await stGetSession(sessionId);
  const st = first ? stSubjectOfScope(first.scope) : null;
  if (!door || !st) return;
  await stSubjectEnqueue(st, async () => {
    await stSubjectFlush(st);
    if (!st.synced || st.problem) return;
    const session = await stGetSession(sessionId);
    if (!session) return;
    session.seconds = Math.max(Number(session.seconds) || 0, Number(seconds) || 0);
    const subject = st.subject;
    const pid = stSubjectProviderId(subject.id);
    const items = await stListSessionItems(sessionId);
    const marks = new Map((await db.all('SELECT * FROM st_subject_marks WHERE session_id = ?', [sessionId])).map((m) => [m.item_id, m]));
    const qids = [...new Set(items.map((i) => Number(i.questionId)).filter((n) => n > 0))];
    const questionsById = new Map(qids.length ? (await db.all(`SELECT id, provider_id, provider_ref FROM st_questions WHERE id IN (${stPlaceholders(qids)})`, qids)).map((q) => [q.id, q]) : []);
    const names = st.names;
    const columnOf = (name) => st.columns.find((c) => stSubjectSameName(c.name, name)) || null;
    let wrote = false;
    for (const item of items) {
      const result = stSubjectResultOfItem(item);
      const mark = marks.get(item.id);
      if (!result || (mark && mark.result === result)) continue;
      const q = questionsById.get(item.questionId);
      if (!q || (q.provider_id !== pid && q.provider_id !== `${pid}:gone`)) continue;
      const rowId = stProviderRefOf({ providerRef: q.provider_ref });
      const row = st.rows.get(rowId);
      const correct = result === 'right' ? 1 : 0;
      if (row) {
        const values = {};
        const addCorrect = correct - (mark ? Number(mark.correct) || 0 : 0);
        if (!mark && columnOf(names.attempts)) values[columnOf(names.attempts).name] = stSubjectNum(row.values[columnOf(names.attempts).name]) + 1;
        if (addCorrect && columnOf(names.correct)) values[columnOf(names.correct).name] = Math.max(0, stSubjectNum(row.values[columnOf(names.correct).name]) + addCorrect);
        const resultColumn = columnOf(names.lastResult);
        if (resultColumn) values[resultColumn.name] = stSubjectResultCell(resultColumn, result);
        const whenColumn = columnOf(names.lastAnswered);
        if (whenColumn) values[whenColumn.name] = whenColumn.type === 'datetime' ? stSubjectLocalDateTime(item.answeredAt || stNow()) : stSubjectLocalDate(item.answeredAt || stNow());
        try {
          stSubjectLive(st);
          await door.updateRow(subject.questionsDb, rowId, { values });
          row.values = { ...row.values, ...values };
          wrote = true;
        } catch (err) {
          if (stIsStopped(err)) throw err;
          console.warn('[Study] a result could not be written to its row:', err && err.message);
          continue;
        }
      }
      await db.run('INSERT OR REPLACE INTO st_subject_marks (item_id, session_id, subject_id, row_id, correct, result) VALUES (?, ?, ?, ?, ?, ?)', [item.id, sessionId, subject.id, row ? rowId : '', correct, result]);
    }
    if (wrote) {
      const titleById = new Map(st.unitRows.map((r) => [r.pageId, r.title]));
      st.counts = stSubjectCounts([...st.rows.values()], names, titleById);
      const unitInfo = await door.get(subject.unitsDb);
      for (const change of stSubjectUnitChanges(st.unitRows, st.counts, unitInfo ? unitInfo.columns.map((c) => c.name) : [])) {
        stSubjectLive(st);
        await door.updateRow(subject.unitsDb, change.pageId, { values: change.values });
        const row = st.unitRows.find((r) => r.pageId === change.pageId);
        if (row) row.values = { ...(row.values || {}), ...change.values };
      }
    }
    await stSubjectWriteLog(st, session, items, questionsById);
    if (wrote && stIsCurrent(st.token)) _emitDataChanged();
  }).catch((err) => { if (!stIsStopped(err) && stIsCurrent(st.token)) console.warn('[Study] results could not be written back:', err); });
}

/** His edit of a subject's question inside Study goes to its row, so the database stays the record. */
async function stSubjectPushEdit(q) {
  const door = stSubjectDoor();
  const st = q && q.bankId ? stSubjectOfScope({ kind: 'bank', bankIds: [q.bankId] }) : null;
  if (!door || !st || q.providerId !== stSubjectProviderId(st.subject.id)) return false;
  const rowId = stProviderRefOf(q);
  const answerColumn = st.columns.find((c) => stSubjectSameName(c.name, st.names.answer));
  await door.updateRow(st.subject.questionsDb, rowId, { title: q.stem, values: answerColumn && q.format !== 'mc' ? { [answerColumn.name]: q.answer } : {} });
  return true;
}

// ── Activation ──────────────────────────────────────────────────────────────

/**
 * Follow every subject for this activation: hear their databases, read them
 * once (the columns Study needs are put back then), and write each answered
 * item's result back as sessions report it. With no door (an older shell)
 * nothing is registered.
 */
function registerSubjects(context, token = stActivation()) {
  if (!stSubjectDoor() || !stIsCurrent(token)) return;
  // After the bus has told everyone else, and only while this activation runs: a tab closing because Study went off writes nothing.
  context.subscriptions.push(bus.on('session', (e) => {
    const sessionId = e && Number(e.sessionId);
    if (!sessionId) return;
    setTimeout(() => { if (stIsCurrent(token)) void stSubjectReconcile(sessionId, { seconds: e.seconds }); }, 0);
  }));
  stListSubjects()
    .then(async (subjects) => {
      if (!stIsCurrent(token)) return;
      for (const subject of subjects) stSubjectWatch(context, subject, token);
      _emitDataChanged();
      // An answer whose write was cut short (the app closed) is written now.
      await Promise.all([..._stSubjects.values()].map((st) => st.chain));
      if (!stIsCurrent(token)) return;
      for (const session of await stListSessions({ open: true })) if (stSubjectOfScope(session.scope)) await stSubjectReconcile(session.id);
    })
    .catch((err) => { if (!stIsStopped(err) && stIsCurrent(token)) console.warn('[Study] subjects could not be loaded:', err); });
}
