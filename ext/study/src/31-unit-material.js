// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 31: A UNIT'S MATERIAL — read, written, followed
// ═══════════════════════════════════════════════════════════════════════════════
//
// What a unit has attached lives in its row of Units, the column Material
// (15-unit-model.js says how an entry is written). This part reads it as
// things to show (a page by its title now and where it lives, a file by its
// name and its folders, each one missing when it is gone), writes what he
// attaches and removes, and keeps an entry on its file when the app moves
// the file (the Explorer's Rename, its cut and paste or drag). The pages and
// files themselves are never touched.
//
// The canvas's page tree is read once a unit tab or a picker wants it, and
// again when a page changes; whether an attached file is there is asked
// once and again when the workspace says that file changed. Everything here
// belongs to the activation: Study off, nothing is heard or read.

/** The canvas's pages as Study last read them: id → { id, parentId, title }, or null until read. */
let _stUnitPages = null;
/** The read in flight, so callers share it. */
let _stUnitPagesAsk = null;
/** Bumped when the pages change, so a read that started before it is not kept. */
let _stUnitPagesSeq = 0;
/** A file's path → whether it is there, as last asked. */
const _stUnitFiles = new Map();
/** Has a unit tab or a picker asked for the pages in this activation? */
let _stUnitWanted = false;
let _stUnitPagesTimer = 0;

const stUnitRoot = () => stWorkspaceRoot();

/** The Material cell of a Units row (whatever the case of the column's name). */
function stUnitCell(row) {
  const values = (row && row.values) || {};
  const key = Object.keys(values).find((k) => stSubjectSameName(k, ST_UNIT_MATERIAL));
  return key ? values[key] : undefined;
}

/** The column's name as Units has it (he may have changed its case), or the one Study adds. */
function stUnitColumnName(row) {
  const values = (row && row.values) || {};
  return Object.keys(values).find((k) => stSubjectSameName(k, ST_UNIT_MATERIAL)) || ST_UNIT_MATERIAL;
}

/** A live subject and one of its Units rows. */
function stUnitRowOf(subjectId, rowId) {
  const st = _stSubjects.get(Number(subjectId));
  const row = st ? (st.unitRows || []).find((r) => r.pageId === rowId) || null : null;
  return { st, row };
}

/** The canvas's pages, read now if they never were (or changed since). */
function stUnitPages() {
  _stUnitWanted = true;
  if (_stUnitPages) return Promise.resolve(_stUnitPages);
  if (_stUnitPagesAsk) return _stUnitPagesAsk;
  const seq = _stUnitPagesSeq;
  const token = stActivation();
  const read = async () => {
    const tree = await _api.workspace.getCanvasPageTree();
    const byId = new Map();
    const walk = (nodes) => { for (const n of nodes || []) { byId.set(n.id, { id: n.id, parentId: n.parentId || null, title: String(n.title || '').trim() || 'Untitled' }); walk(n.children); } };
    walk(tree);
    return byId;
  };
  _stUnitPagesAsk = read().then((byId) => {
    _stUnitPagesAsk = null;
    if (!stIsCurrent(token)) return byId;
    if (seq === _stUnitPagesSeq) _stUnitPages = byId;
    return byId;
  }, (err) => { _stUnitPagesAsk = null; console.warn('[Study] the canvas pages could not be read:', err && err.message); return new Map(); });
  return _stUnitPagesAsk;
}

/** The pages as last read, without asking (null until they are). */
const stUnitPagesNow = () => _stUnitPages;

/** A page changed somewhere: read them again shortly, if a tab or a picker shows them. */
function stUnitPagesTouched(token) {
  _stUnitPagesSeq += 1;
  _stUnitPages = null;
  if (!_stUnitWanted || !stIsCurrent(token)) return;
  clearTimeout(_stUnitPagesTimer);
  _stUnitPagesTimer = setTimeout(() => {
    if (!stIsCurrent(token)) return;
    void stUnitPages().then(() => { if (stIsCurrent(token)) bus.emit('unit'); });
  }, 120);
}

/** A file's whole path, from an item. */
function stUnitAbs(item) {
  if (item.abs) return item.abs;
  const root = stUnitRoot().replace(/[\\/]+$/, '');
  return root ? `${root}/${item.rel}` : item.rel;
}

/** Is this file there? Asked once, then known until the workspace says it changed. */
async function stUnitFileThere(item) {
  const abs = stUnitAbs(item);
  if (_stUnitFiles.has(abs)) return _stUnitFiles.get(abs);
  const fs = _api.workspace && _api.workspace.fs;
  let there = true;
  try { there = fs && typeof fs.exists === 'function' ? !!(await fs.exists(stUriOf(abs))) : true; } catch { there = false; }
  _stUnitFiles.set(abs, there);
  return there;
}

/** The workspace says these files changed: what Study knew of them is asked again, and every tab looks again. */
function stUnitFilesTouched(events, token) {
  if (!stIsCurrent(token) || !_stUnitFiles.size) return;
  let touched = false;
  for (const e of events || []) {
    const p = stUnitSlashes(stFsPathOf(e && e.uri)).replace(/\/+$/, '');
    for (const k of [..._stUnitFiles.keys()]) {
      const known = stUnitSlashes(k);
      if (known === p || known.startsWith(`${p}/`)) { _stUnitFiles.delete(k); touched = true; }
    }
  }
  if (touched) bus.emit('unit');
}

/** Forget what was known of the files (a tab shown again looks afresh). */
function stUnitFilesForget() {
  _stUnitFiles.clear();
}

/**
 * A unit's material as the tab shows it: [{ key, kind, title, where,
 * missing, item }] in the cell's order. `pages` is the page index (null:
 * not read yet, then nothing is said missing and each page keeps the name
 * the cell gives it).
 */
async function stUnitShown(value, pages) {
  const root = stUnitRoot();
  const items = stUnitItems(value, root);
  return Promise.all(items.map(async (item) => {
    if (item.kind === 'page') {
      const page = pages ? pages.get(item.id) : null;
      return { key: item.key, kind: 'page', title: page ? page.title : (item.name || 'Untitled page'), where: page ? stUnitPageWhere(item.id, pages) : '', missing: !!pages && !page, item };
    }
    const there = await stUnitFileThere(item);
    return { key: item.key, kind: stUnitKindOf(item), title: stUnitBase(item.rel || item.abs) || item.name, where: stUnitFileWhere(item), missing: !there, item };
  }));
}

/** Write a unit's cell, and show it at once (the next read of Units says the same). */
async function stUnitWrite(st, rowId, next) {
  const door = stSubjectDoorOrThrow();
  const row = (st.unitRows || []).find((r) => r.pageId === rowId);
  if (!row) throw new Error('That unit is no longer in Units.');
  const name = stUnitColumnName(row);
  stSubjectLive(st);
  // The column first, for a subject made before it (a person who deleted it gets it back, empty, as for Study's other columns).
  await door.ensureColumns(st.subject.unitsDb, [{ name: ST_UNIT_MATERIAL, type: 'files' }]);
  await door.updateRow(st.subject.unitsDb, rowId, { values: { [name]: next } });
  row.values = { ...(row.values || {}), [name]: next };
  _emitDataChanged();
}

/** Attach these items to a unit: pages [{ kind: 'page', id, name }] and files [{ kind: 'file', rel, abs, name }]. One already there stays once. */
async function stUnitAttach(subjectId, rowId, items) {
  const { st, row } = stUnitRowOf(subjectId, rowId);
  if (!st || !row) throw new Error('That unit is no longer in Units.');
  const next = stUnitAdd(stUnitCell(row), items, stUnitRoot());
  if (next) await stUnitWrite(st, rowId, next);
  return !!next;
}

/** Take one item off a unit (its key). The page or the file itself is untouched. */
async function stUnitDetach(subjectId, rowId, key) {
  const { st, row } = stUnitRowOf(subjectId, rowId);
  if (!st || !row) return false;
  const next = stUnitRemove(stUnitCell(row), key, stUnitRoot());
  if (next) await stUnitWrite(st, rowId, next);
  return !!next;
}

/** Open an item in its own editor: a page in the canvas, a file in what the app opens it with. */
async function stUnitOpen(shown) {
  if (shown.missing) {
    await _api.window.showWarningMessage(shown.kind === 'page' ? `${shown.title} is not there any more. It may be in the Trash.` : `${shown.title} is not there any more. It was moved or deleted.`);
    return;
  }
  if (shown.item.kind === 'page') await _api.commands.executeCommand('canvas.openPage', shown.item.id);
  else await _api.editors.openFileEditor(stUriOf(stUnitAbs(shown.item)));
}

/** The pages and databases a subject is made of: its Units, Questions and Work Log, and their rows. Not material. */
function stUnitInternalIds() {
  const out = new Set();
  for (const st of _stSubjects.values()) {
    for (const id of [st.subject.unitsDb, st.subject.questionsDb, st.subject.logDb]) if (id) out.add(id);
    for (const r of st.unitRows || []) out.add(r.pageId);
    for (const id of (st.rows && st.rows.keys ? st.rows.keys() : [])) out.add(id);
  }
  return out;
}

/**
 * Everything that can be attached: every canvas page (a subject's own
 * databases and their rows aside) and every file of the workspace, each
 * { key, kind, label, where, item }.
 */
async function stUnitCandidates() {
  const [pages, files] = await Promise.all([
    stUnitPages(),
    typeof _api.workspace.listFiles === 'function' ? _api.workspace.listFiles().catch(() => []) : Promise.resolve([]),
  ]);
  const internal = stUnitInternalIds();
  const out = [];
  for (const p of pages.values()) {
    if (internal.has(p.id)) continue;
    const item = { kind: 'page', id: p.id, name: p.title };
    out.push({ key: stUnitKey(item), kind: 'page', label: p.title, where: stUnitPageWhere(p.id, pages), item });
  }
  const root = stUnitRoot();
  const single = ((_api.workspace && _api.workspace.workspaceFolders) || []).length <= 1;
  for (const f of files || []) {
    const abs = stFsPathOf(f.uri);
    const rel = stUnitRelative(abs, root) || (single ? f.relativePath : '');
    const item = { kind: 'file', rel, abs: rel ? '' : abs, name: f.name };
    out.push({ key: stUnitKey(item), kind: stUnitKindOf(item), label: f.name, where: stUnitFileWhere(item), item });
  }
  return out;
}

/** The app moved a file or a folder: every unit's entry for it, or under it, follows. */
async function stUnitFollowMoves(moves, token) {
  if (!stIsCurrent(token) || !_stSubjects.size) return;
  const root = stUnitRoot();
  for (const m of moves || []) {
    const from = stUnitRelative(stFsPathOf(m && m.from), root);
    const to = stUnitRelative(stFsPathOf(m && m.to), root);
    if (!from || !to) continue;
    for (const st of _stSubjects.values()) {
      for (const row of st.unitRows || []) {
        const next = stUnitMoved(stUnitCell(row), from, to, root);
        if (!next) continue;
        try { await stUnitWrite(st, row.pageId, next); } catch (err) { if (!stIsStopped(err)) console.warn('[Study] a moved file could not be followed:', err && err.message); }
      }
    }
  }
  stUnitFilesForget();
  bus.emit('unit');
}

/** Hear the pages, the files and the moves for this activation. */
function registerUnits(context, token = stActivation()) {
  const ws = _api.workspace;
  if (!ws) return;
  if (typeof ws.onDidChangeCanvasPages === 'function') context.subscriptions.push(ws.onDidChangeCanvasPages(() => stUnitPagesTouched(token)));
  if (typeof ws.onDidFilesChange === 'function') context.subscriptions.push(ws.onDidFilesChange((events) => stUnitFilesTouched(events, token)));
  if (typeof ws.onDidMoveFiles === 'function') context.subscriptions.push(ws.onDidMoveFiles((moves) => { void stUnitFollowMoves(moves, token); }));
}

/** Forget it all (deactivate). */
function stUnitsReset() {
  clearTimeout(_stUnitPagesTimer);
  _stUnitPages = null;
  _stUnitPagesAsk = null;
  _stUnitPagesSeq += 1;
  _stUnitFiles.clear();
  _stUnitWanted = false;
}
