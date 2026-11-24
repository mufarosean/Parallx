// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 32: THE WORK LOG FROM OTHER WORK — the reports read, the rows written
// ═══════════════════════════════════════════════════════════════════════════════
//
// A subject's Work Log is the one record; the plan's Done is its sum. Besides
// a session's own row (27-subjects.js), a day's work reaches it from reports:
//
//   the tools   whatever is registered with the core's work providers
//               (api.work). Study names no tool: it lists the providers and
//               reads each one's days. A tool turned off takes its provider
//               away; the rows it led to stay, and carry on when it is back.
//   reading     time with a PDF of a unit's Material showing, counted here by
//               the app's clock (only Study knows which file is a unit's)
//   discussion  time in a chat he opened from a unit (Discuss in Chat on the
//               unit's tab, or on a question of a session), counted the same
//               way; any other chat counts for nothing
//
// One row per source, unit and local day, which grows with the day's work
// (st_work_rows remembers which, and what was written). A row he changed, or
// took out, is his: never written again, and no second row is made. A row he
// did not touch follows its source. Nothing is written when nothing changed.
// Seconds are counted once: a session showing counts for the session, a PDF
// showing beside the chat counts as reading.
//
// Everything here belongs to the activation: Study off, no provider is heard,
// no clock runs, nothing is written. The pure part is 16-work-model.js.

/** The core's work point and clock, or null on a host without them. */
function stWorkApi() {
  return _api && _api.work && typeof _api.work.providers === 'function' && typeof _api.work.createClock === 'function' ? _api.work : null;
}

let _stWorkTimer = 0;
let _stWorkRunning = false;
let _stWorkAgain = false;
/** A work provider → what Study hears it with. */
const _stWorkSubs = new Map();
/** Study's own seconds on their way to st_work_time, in order. */
let _stWorkKeeping = Promise.resolve();

/** Something a row depends on changed (a report, a unit, the tools that are on): follow it shortly. */
function stWorkTouch(token = stActivation()) {
  if (!stIsCurrent(token) || !stWorkApi()) return;
  clearTimeout(_stWorkTimer);
  _stWorkTimer = setTimeout(() => { void stWorkSync(token); }, 400);
}

/** Every source as it reports now: the tools' providers, then Study's own two clocks. A tool that cannot say now is left out, so its rows stay as they are. */
async function stWorkSources() {
  const work = stWorkApi();
  const out = [];
  let providers = [];
  try { providers = (work.providers() || []).filter((p) => p && typeof p.id === 'string' && p.id && typeof p.work === 'function'); } catch { providers = []; }
  for (const p of providers) {
    try { out.push({ id: `tool:${p.id}`, tool: String(p.displayName || p.id), kind: String(p.kind || ''), entries: (await p.work()) || [] }); } catch (err) { console.warn(`[Study] the work of ${p.id} could not be read:`, err && err.message); }
  }
  const own = await db.all('SELECT day, subject_id, unit_row, kind, seconds FROM st_work_time WHERE seconds > 0');
  for (const kind of [ST_WORK_READING, ST_WORK_DISCUSSION]) {
    out.push({ id: `study:${kind.toLowerCase()}`, tool: 'Study', kind, own: true, entries: own.filter((r) => r.kind === kind).map((r) => ({ day: r.day, subjectId: Number(r.subject_id), unitRow: String(r.unit_row), minutes: Number(r.seconds) / 60, items: 0 })) });
  }
  return out;
}

/** Make one subject's Work Log say what the sources say, row by row; returns how many rows were written. Runs in the subject's own order of work. */
async function stWorkSyncSubject(st, sources) {
  const door = stSubjectDoor();
  const subject = st.subject;
  if (!door || !subject.logDb || !st.synced || st.problem) return 0;
  const has = (name) => (st.logColumns || []).some((c) => stSubjectSameName(c, name));
  // A Work Log without its Date or its Minutes is not one Study can add a day's work to.
  if (!has('Date') || !has('Minutes')) return 0;
  const units = stProgressUnitsOf(st);
  const wanted = [];
  for (const s of sources) wanted.push(...stWorkWanted(s, s.own ? s.entries.filter((e) => e.subjectId === Number(subject.id)) : s.entries, units));
  if (!wanted.length) return 0;
  const where = 'subject_id = ? AND source = ? AND unit_row = ? AND day = ?';
  const recs = new Map((await db.all('SELECT * FROM st_work_rows WHERE subject_id = ?', [subject.id])).map((r) => [`${r.source}\u0000${r.unit_row}\u0000${r.day}`, {
    rowId: r.row_id, written: stParseJson(r.written_json, {}) || {}, pending: r.pending_json ? stParseJson(r.pending_json, null) : null, his: !!r.his,
  }]));
  const todo = [];
  for (const w of wanted) {
    const full = stWorkRowValues(w);
    const values = Object.fromEntries(Object.entries(full.values).filter(([name]) => has(name)));
    const rec = recs.get(w.key) || null;
    if (rec && (rec.his || stWorkSame(values, rec.written))) continue;
    todo.push({ w, title: full.title, values, rec, at: [subject.id, w.source, w.unitRow, w.day] });
  }
  if (!todo.length) return 0;
  stSubjectLive(st);
  const rows = new Map((await door.listRows(subject.logDb)).map((r) => [r.pageId, r]));
  // A select takes only a word it has: a new tool's name, a new kind, is made one of its options first. A column he
  // deleted is not put back for it.
  const adds = todo.filter((t) => !t.rec);
  const options = [['Tool', [...new Set(adds.map((t) => t.w.tool))]], ['Kind', [...new Set(adds.map((t) => t.w.kind))]]].filter(([name, list]) => has(name) && list.some(Boolean));
  if (options.length) {
    stSubjectLive(st);
    await door.ensureColumns(subject.logDb, options.map(([name, list]) => ({ name, type: 'select', config: { options: list.filter(Boolean) } })));
  }
  let written = 0;
  // The rows never written before go in together: one write and one change, however many days a tool reports the first time.
  if (adds.length) {
    stSubjectLive(st);
    const made = await door.addRows(subject.logDb, adds.map((t) => ({ title: t.title, values: t.values })));
    for (let i = 0; i < adds.length; i++) {
      const row = made && made[i];
      if (!row || !row.pageId) continue;
      await db.run('INSERT OR REPLACE INTO st_work_rows (subject_id, source, unit_row, day, row_id, written_json, pending_json, his) VALUES (?, ?, ?, ?, ?, ?, \'\', 0)', [...adds[i].at, row.pageId, stJsonCol(adds[i].values, '{}')]);
      written += 1;
    }
  }
  for (const t of todo) {
    if (!t.rec) continue;
    stSubjectLive(st);
    const d = stWorkDecide(t.values, t.rec, rows.get(t.rec.rowId) || null);
    if (d.act === 'his') { await db.run(`UPDATE st_work_rows SET his = 1, pending_json = '' WHERE ${where}`, t.at); continue; }
    if (d.act === 'update') {
      // What is about to be written is remembered first: a write that stops half way is not read as his edit.
      await db.run(`UPDATE st_work_rows SET pending_json = ? WHERE ${where}`, [stJsonCol(t.values, '{}'), ...t.at]);
      stSubjectLive(st);
      await door.updateRow(subject.logDb, t.rec.rowId, { values: d.values });
      written += 1;
    }
    if (d.act === 'update' || d.settle) await db.run(`UPDATE st_work_rows SET written_json = ?, pending_json = '' WHERE ${where}`, [stJsonCol(t.values, '{}'), ...t.at]);
  }
  return written;
}

/** Every subject's Work Log follows the sources, one run at a time; a touch during a run asks for one more. */
async function stWorkSync(token = stActivation()) {
  if (!stIsCurrent(token) || !stWorkApi()) return;
  if (_stWorkRunning) { _stWorkAgain = true; return; }
  _stWorkRunning = true;
  try {
    do {
      _stWorkAgain = false;
      await _stWorkKeeping;
      const sources = await stWorkSources();
      for (const st of [..._stSubjects.values()]) {
        if (!stIsCurrent(token)) return;
        try { await stSubjectEnqueue(st, () => stWorkSyncSubject(st, sources)); } catch (err) {
          if (stIsStopped(err) || !stIsCurrent(token)) return;
          console.warn(`[Study] ${st.subject.name}: its Work Log could not follow the day's work:`, err && err.message);
        }
      }
    } while (_stWorkAgain && stIsCurrent(token));
  } catch (err) {
    if (!stIsStopped(err) && stIsCurrent(token)) console.warn('[Study] the day\'s work could not be read:', err && err.message);
  } finally {
    _stWorkRunning = false;
  }
}

/** Hear the providers that are registered now, and stop hearing the ones that went. */
function stWorkHear(context, token) {
  const work = stWorkApi();
  if (!work || !stIsCurrent(token)) return;
  let listed = [];
  try { listed = (work.providers() || []).filter((p) => p && typeof p.onDidChange === 'function'); } catch { listed = []; }
  for (const [p, sub] of [..._stWorkSubs]) { if (!listed.includes(p)) { sub.dispose(); _stWorkSubs.delete(p); } }
  for (const p of listed) {
    if (_stWorkSubs.has(p)) continue;
    let raw = null;
    try { raw = p.onDidChange(() => stWorkTouch(token)); } catch { raw = null; }
    _stWorkSubs.set(p, stOwn(context, token, { dispose() { try { if (raw && typeof raw.dispose === 'function') raw.dispose(); } catch { /* the provider's own */ } } }));
  }
  stWorkTouch(token);
}

// ── Study's own clocks: reading and discussion ──────────────────────────────

/** When a session's tab, and a unit's PDF, was last seen showing: what keeps one second from being counted twice. */
let _stSessionShownAt = 0;
let _stReadingShownAt = 0;
const stShownJust = (at) => Date.now() - at < 1500;
const stWindowShown = () => !(typeof document !== 'undefined' && typeof document.visibilityState === 'string' && document.visibilityState !== 'visible');

/** A clock's seconds kept for the unit they were counted for ('subjectId|unitRow', several joined by ';'), then the rows follow. */
function stWorkKeep(kind, credits, token) {
  const rows = [];
  for (const c of credits || []) {
    if (!c || !c.seconds) continue;
    for (const part of String(c.bucket || '').split(';')) {
      const [subjectId, unitRow] = part.split('|');
      if (Number(subjectId) > 0 && unitRow) rows.push([c.day, Number(subjectId), unitRow, kind, c.seconds, c.seconds]);
    }
  }
  if (!rows.length) return;
  _stWorkKeeping = _stWorkKeeping.then(async () => {
    for (const r of rows) {
      await db.run('INSERT INTO st_work_time (day, subject_id, unit_row, kind, seconds) VALUES (?, ?, ?, ?, MAX(0, ?)) ON CONFLICT(day, subject_id, unit_row, kind) DO UPDATE SET seconds = MAX(0, seconds + ?)', r);
    }
    stWorkTouch(token);
  }).catch((err) => { if (!stIsStopped(err) && stIsCurrent(token)) console.warn('[Study] time not kept:', err && err.message); });
}

/** Two paths to the same file: slashes aside, and letter case aside where the path has a drive letter. */
function stWorkSamePath(a, b) {
  const x = stUnitSlashes(a);
  const y = stUnitSlashes(b);
  return /^[a-zA-Z]:\//.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * The units a PDF that is showing belongs to: for the PDF in front (the
 * active group's first, then any other group's), the first unit of each
 * subject whose Material holds that file. Empty when no PDF of a unit shows.
 */
function stReadingTargets() {
  let editors = [];
  try { editors = (_api.editors && _api.editors.openEditors) || []; } catch { editors = []; }
  const shown = editors.filter((e) => e && e.isShowing && e.typeId === 'parallx.editor.pdf' && e.filePath).sort((a, b) => Number(!!b.isActive) - Number(!!a.isActive));
  const root = stUnitRoot();
  for (const e of shown) {
    const hits = [];
    for (const st of _stSubjects.values()) {
      if (!st.synced || st.problem) continue;
      const row = (st.unitRows || []).find((r) => stUnitItems(stUnitCell(r), root).some((i) => i.kind === 'file' && stWorkSamePath(stUnitAbs(i), e.filePath)));
      if (row) hits.push(`${st.subject.id}|${row.pageId}`);
    }
    if (hits.length) return hits;
  }
  return [];
}

let _stReadingClock = null;
let _stReadingTargets = [];

/** The editors, or a unit's Material, changed: the reading clock runs only while a unit's PDF is in front somewhere. */
function stReadingLook(token = stActivation()) {
  const work = stWorkApi();
  if (!work || !stIsCurrent(token)) return;
  _stReadingTargets = stReadingTargets();
  if (_stReadingTargets.length && !_stReadingClock) {
    _stReadingClock = work.createClock({
      showing: () => {
        const on = _stReadingTargets.length > 0 && stWindowShown() && !stShownJust(_stSessionShownAt);
        if (on) _stReadingShownAt = Date.now();
        return on;
      },
      bucket: () => _stReadingTargets.join(';'),
      credit: (credits) => stWorkKeep(ST_WORK_READING, credits, token),
    });
  } else if (!_stReadingTargets.length && _stReadingClock) {
    const clock = _stReadingClock;
    _stReadingClock = null;
    clock.dispose();
  }
}

let _stChatClock = null;
/** The chat conversation that is open now and the unit it was opened from: { sessionId, bucket }, or null. */
let _stChatTarget = null;

/** The chat opened another conversation, or one was just tied to a unit: the discussion clock runs only while the chat is on one opened from a unit. */
async function stChatLook(token = stActivation()) {
  const work = stWorkApi();
  const chat = _api && _api.chat;
  if (!work || !chat || typeof chat.shownSession !== 'function' || !stIsCurrent(token)) return;
  let shown = null;
  try { shown = chat.shownSession() || null; } catch { shown = null; }
  const tie = shown && shown.id ? await db.get('SELECT subject_id, unit_row FROM st_unit_chats WHERE session_id = ?', [String(shown.id)]).catch(() => null) : null;
  if (!stIsCurrent(token)) return;
  _stChatTarget = tie ? { sessionId: String(shown.id), bucket: `${tie.subject_id}|${tie.unit_row}` } : null;
  if (_stChatTarget && !_stChatClock) {
    _stChatClock = work.createClock({
      showing: () => {
        if (!_stChatTarget || !stWindowShown() || stShownJust(_stSessionShownAt) || stShownJust(_stReadingShownAt)) return false;
        let now = null;
        try { now = chat.shownSession() || null; } catch { now = null; }
        return !!now && now.showing === true && String(now.id) === _stChatTarget.sessionId;
      },
      bucket: () => (_stChatTarget ? _stChatTarget.bucket : ''),
      credit: (credits) => stWorkKeep(ST_WORK_DISCUSSION, credits, token),
    });
  } else if (!_stChatTarget && _stChatClock) {
    const clock = _stChatClock;
    _stChatClock = null;
    clock.dispose();
  }
}

/** The conversation the chat has open now was opened from this unit: its time counts for the unit from here on. */
async function stWorkTieChat(subjectId, unitRow, token = stActivation()) {
  const chat = _api && _api.chat;
  if (!stWorkApi() || !chat || typeof chat.shownSession !== 'function' || !(Number(subjectId) > 0) || !unitRow) return false;
  let shown = null;
  try { shown = chat.shownSession() || null; } catch { shown = null; }
  if (!shown || !shown.id) return false;
  await db.run('INSERT OR REPLACE INTO st_unit_chats (session_id, subject_id, unit_row, at) VALUES (?, ?, ?, ?)', [String(shown.id), Number(subjectId), String(unitRow), Date.now()]);
  await stChatLook(token);
  return true;
}

/** The subject and the unit's row a question belongs to, when it is a question of a subject's unit. */
function stWorkUnitOfQuestion(q) {
  const m = /^subject:(\d+)$/.exec(String((q && q.providerId) || ''));
  const st = m ? _stSubjects.get(Number(m[1])) : null;
  const unit = st ? String(stQuestionMeta(q).paper || '') : '';
  const row = unit ? (st.unitRows || []).find((r) => stSubjectSameName(r.title, unit)) : null;
  return row ? { subjectId: st.subject.id, unitRow: row.pageId } : null;
}

/** The prompt staged in the chat for a unit: what to talk through, and from what. */
function stDiscussUnitPrompt(subjectName, unitName, material) {
  const lines = [`I want to talk through ${unitName} (${subjectName}).`, ''];
  if (material.length) lines.push(`Its material in my workspace: ${material.join('; ')}.`);
  lines.push(
    'Start by asking me what I find hardest in it, then explain from its material and what is around it in my workspace, not from memory.',
    'You can see what I got wrong with study_weak_spots and study_results; tie what you explain to those misses.',
    'End with one question that checks I have it.',
  );
  return lines.join('\n');
}

/** Discuss in Chat on a unit's tab: the chat opens with a prompt about the unit staged, and the time in that chat counts for the unit. */
async function stCmdDiscussUnit(subjectId, rowId) {
  const { st, row } = stUnitRowOf(subjectId, rowId);
  if (!st || !row) return false;
  if (!(await stChatAvailable())) {
    await _api.window.showInformationMessage('The chat is not available.');
    return false;
  }
  const material = stUnitItems(stUnitCell(row), stUnitRoot()).map((i) => String(i.name || '')).filter(Boolean).slice(0, 12);
  await _api.commands.executeCommand('chat.stagePrompt', { text: stDiscussUnitPrompt(st.subject.name, String(row.title || '').trim(), material) });
  await stWorkTieChat(st.subject.id, row.pageId).catch((err) => { if (!stIsStopped(err)) console.warn('[Study] the chat could not be tied to the unit:', err && err.message); });
  return true;
}

/** Hear the work providers, the editors and the chat for this activation. */
function registerWork(context, token = stActivation()) {
  const work = stWorkApi();
  if (!work) return;
  context.subscriptions.push(work.onDidChangeProviders(() => stWorkHear(context, token)));
  stWorkHear(context, token);
  // A unit read, renamed or given another name; a file put in a unit's Material: the rows and the reading clock follow.
  context.subscriptions.push(onDataChanged(() => { stWorkTouch(token); stReadingLook(token); }));
  if (_api.editors && typeof _api.editors.onDidChangeOpenEditors === 'function') context.subscriptions.push(_api.editors.onDidChangeOpenEditors(() => stReadingLook(token)));
  stReadingLook(token);
  if (_api.chat && typeof _api.chat.onDidChangeShownSession === 'function') context.subscriptions.push(_api.chat.onDidChangeShownSession(() => { void stChatLook(token); }));
  void stChatLook(token);
}

/** Stop it all (deactivate): no timer left, no clock, nothing heard. */
function stWorkReset() {
  clearTimeout(_stWorkTimer);
  _stWorkTimer = 0;
  _stWorkAgain = false;
  for (const sub of _stWorkSubs.values()) sub.dispose();
  _stWorkSubs.clear();
  for (const clock of [_stReadingClock, _stChatClock]) { try { if (clock) clock.dispose(); } catch { /* gone with the host */ } }
  _stReadingClock = null;
  _stChatClock = null;
  _stReadingTargets = [];
  _stChatTarget = null;
  _stSessionShownAt = 0;
  _stReadingShownAt = 0;
}
