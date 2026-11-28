// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 62: NEW SUBJECT — the sheet that makes a subject
// ═══════════════════════════════════════════════════════════════════════════════
//
// One sheet, the setup sheet's frame: Name (the only thing it needs), a
// sources folder, and the Questions (a new database, or one he already has).
// His notes are whatever pages and files he attaches to a unit, in any
// layout (67-unit-view.js), so the sheet no longer asks for a notes database;
// a subject made with one keeps it, untouched. Choosing a database he has shows which of its columns Study
// would use for what, each guess a choice he can change; nothing of his is
// copied or renamed, only a missing column is added. Create makes the page
// and its databases (27-subjects.js) and opens the page.

/** "Add a column" in a mapping choice. */
const ST_SUBJECT_ADD = '+add';

/** Open one of a subject's databases in the editor; say so when it is gone. */
async function stOpenSubjectDatabase(databaseId) {
  const door = stSubjectDoor();
  try {
    if (!door || !databaseId) throw new Error('gone');
    await door.open(databaseId);
  } catch (err) {
    if (stIsStopped(err)) return;
    try { await _api.window.showWarningMessage('That database is no longer there. It may be in the Trash.'); } catch { /* noop */ }
  }
}

/** A subject's actions: its More Actions menu, its context menu, and the Subject Actions… command. */
function stSubjectMenuItems(s) {
  return [
    { label: 'Open Progress', icon: 'chart-column', onSelect: () => void stOpenProgress(s.id) },
    { label: 'Study…', icon: 'px-study', onSelect: () => void stOpenSetup({ bankIds: [s.subject.bankId] }) },
    { label: 'Find Matches…', icon: 'paperclip', onSelect: () => void stUnitFindMatches(s.id) },
    { separator: true },
    ...(stPlansOfSubject(s.id).all.length ? [{ label: 'Open Plan', icon: 'calendar', onSelect: () => void stCmdOpenPlan(s.id) }] : []),
    ...(stSubjectDoor() ? [{ label: 'New Plan…', icon: 'calendar-plus', onSelect: () => void stCmdNewPlan(s.id) }] : []),
    { separator: true },
    { label: 'Open Units', icon: 'database', onSelect: () => void stOpenSubjectDatabase(s.subject.unitsDb) },
    { label: 'Open Questions', icon: 'database', onSelect: () => void stOpenSubjectDatabase(s.subject.questionsDb) },
    { label: 'Open Work Log', icon: 'database', onSelect: () => void stOpenSubjectDatabase(s.subject.logDb) },
    { separator: true },
    s.folded
      ? { label: 'Show Units', icon: 'chevron-down', onSelect: () => void stSetSubjectFolded(s.id, false) }
      : { label: 'Hide Units', icon: 'chevron-right', onSelect: () => void stSetSubjectFolded(s.id, true) },
    { separator: true },
    { label: 'Remove Subject…', icon: 'trash', danger: true, onSelect: () => void stRemoveSubjectFlow(s) },
  ];
}

/** Remove Subject…: asks first. Study forgets it; the page and the databases stay. */
async function stRemoveSubjectFlow(s) {
  const ok = await _api.window.showConfirmModal({
    message: `Remove the subject ${s.name}?`,
    detail: 'Study forgets it, with the sessions over it. Its page, Units, Questions and Work Log stay exactly as they are.',
    confirmLabel: 'Remove', danger: true,
  });
  if (!ok) return;
  await stRemoveSubject(s.id);
  await stCloseGoneSessionTabs();
}

/** The subject a command names (its id or its name), else the only one, else his pick. */
async function stPickSubject(arg, placeholder) {
  const all = stSubjectsShown();
  if (arg != null && arg !== '') return all.find((s) => s.id === Number(arg)) || all.find((s) => stSubjectSameName(s.name, arg)) || null;
  if (!all.length) { await _api.window.showInformationMessage('No subjects yet. New Subject… makes one.'); return null; }
  if (all.length === 1) return all[0];
  const pick = await _api.window.showQuickPick(all.map((s) => ({ label: s.name, description: `${s.answered} of ${s.total}`, id: s.id })), { placeholder });
  return pick ? all.find((s) => s.id === pick.id) || null : null;
}

/** Study a Subject…: the setup sheet on the subject, or on one of its units, or on that unit's questions in one state (`result`, from a bar of Progress). */
async function stCmdStudySubject(arg, unit, result) {
  const s = await stPickSubject(arg, 'Study which subject?');
  if (!s) return null;
  const named = unit ? s.units.find((u) => u.rowId === unit) || s.units.find((u) => stSubjectSameName(u.name, unit)) : null;
  return stOpenSetup({ bankIds: [s.subject.bankId], ...(named ? { unit: named.name } : {}), ...(named && ST_PROGRESS_STATES.includes(result) ? { result } : {}) });
}

/** Subject Actions…: the menu at the subject's row when it is on screen, else a pick. */
async function stCmdSubjectActions(arg) {
  const s = await stPickSubject(arg, 'Which subject?');
  if (!s) return null;
  const items = stSubjectMenuItems(s);
  const at = Array.from(document.querySelectorAll('[data-px-id]')).find((n) => n.getAttribute('data-px-id') === `study.side.subject.${s.id}.more` && n.getClientRects().length);
  if (at) { _api.ui.showContextMenu(at, items, { anchorPosition: 'below' }); return null; }
  const pick = await _api.window.showQuickPick(items.filter((i) => !i.separator).map((i) => ({ label: i.label })), { placeholder: s.name });
  const chosen = pick ? items.find((i) => i.label === pick.label) : null;
  if (chosen) chosen.onSelect();
  return null;
}

/** With no material to open the sheet on: the first subject, else Study's empty home. */

/** The New Subject sheet on screen: its form, and what its Create does. */
let _stSubjectSheet = null;
/** What had the focus when a sheet was asked for (New Subject…, a subject's or a unit's row, any Study… button). */
let _stSubjectOpener = null;

/** Remember where he was as a sheet opens: the focus goes back there when the sheet closes with nothing started (stSheetFrame). */
function stNoteSheetOpener() {
  const from = typeof document !== 'undefined' ? document.activeElement : null;
  // And the tab he was in: closing the sheet's tab brings forward the tab beside it, which need not be his (Study's one tab sits anywhere in the strip).
  let editor = '';
  try { const a = ((_api && _api.editors && _api.editors.openEditors) || []).find((e) => e.isActive); editor = a ? String(a.id || '') : ''; } catch { editor = ''; }
  _stSubjectOpener = from && from !== document.body && typeof from.getAttribute === 'function' ? { node: from, id: from.getAttribute('data-px-id') || '', editor } : null;
}

/** Give the focus back to what opened the sheet (the same control, or the one with its id when its view was drawn again). */
function stRefocusSubjectOpener() {
  const opener = _stSubjectOpener;
  _stSubjectOpener = null;
  if (!opener) return;
  // His tab first, then the control: the tab comes to the front a little later, so look again for a while, while the keys are nowhere.
  let tries = 0;
  let broughtBack = false;
  const attempt = () => {
    // A sheet on screen keeps the keys (one in a tab behind does not).
    if (Array.from(document.querySelectorAll('.st-sheet')).some((n) => n.getClientRects().length)) return;
    const hidden = !(opener.node.isConnected && opener.node.getClientRects().length);
    if (hidden && opener.editor && !broughtBack && _api && _api.editors && typeof _api.editors.focusEditor === 'function') {
      broughtBack = true;
      if (((_api.editors.openEditors) || []).some((e) => e.id === opener.editor)) void Promise.resolve(_api.editors.focusEditor(opener.editor)).catch(() => {});
    }
    const node = opener.node.isConnected && opener.node.getClientRects().length ? opener.node
      : opener.id ? Array.from(document.querySelectorAll('[data-px-id]')).find((n) => n.getAttribute('data-px-id') === opener.id && n.getClientRects().length) : null;
    if (node && typeof node.focus === 'function') { node.focus(); return; }
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost && ++tries < 20) setTimeout(attempt, 50);
  };
  setTimeout(attempt, 60);
}

/**
 * New Subject…: the sheet. Given what the sheet would ask ({ name, folder,
 * questions, mapping }: the chat, a script, or the sheet's own
 * Create handing over its form), the subject is made without it.
 */
async function stCmdNewSubject(arg) {
  if (!arg || typeof arg !== 'object') {
    // Where he was (the button that opened it): the focus goes back there when the sheet closes with nothing made.
    stNoteSheetOpener();
    return stOpenPane({ view: 'newSubject' });
  }
  if (_stSubjectSheet && arg === _stSubjectSheet.form) return _stSubjectSheet.create();
  return stCreateSubject({ name: arg.name, folder: arg.folder, questionsDb: arg.questions, mapping: arg.mapping || null });
}

function registerSubjectCommands(context) {
  const cmds = [
    ['study.newSubject', (arg) => stCmdNewSubject(arg)],
    ['study.studySubject', (subject, unit, result) => stCmdStudySubject(subject, unit, result)],
    ['study.openProgress', (subject, where) => stCmdOpenProgress(subject, where)],
    ['study.subjectActions', (subject) => stCmdSubjectActions(subject)],
    ['study.openUnit', (subject, unit) => stCmdOpenUnit(subject, unit)],
    ['study.discussUnit', (subject, unit) => stCmdDiscussUnit(subject, unit)],
    ['study.unitActions', (subject, unit) => stCmdUnitActions(subject, unit)],
    ['study.addNotesOrFiles', (subject, unit) => stCmdAddNotesOrFiles(subject, unit)],
    ['study.openUnitItem', (subject, unit, key) => stCmdOpenUnitItem(subject, unit, key)],
    ['study.removeUnitItem', (subject, unit, key) => stCmdRemoveUnitItem(subject, unit, key)],
    ['study.newPlan', (arg) => stCmdNewPlan(arg)],
    ['study.openPlan', (arg) => stCmdOpenPlan(arg)],
    ['study.findMatches', async (subject) => { const s = await stPickSubject(subject, 'Find matches for which subject?'); return s ? stUnitFindMatches(s.id) : false; }],
  ];
  for (const [id, handler] of cmds) context.subscriptions.push(_api.commands.registerCommand(id, handler));
}

/** The command that closes the tab in front: the sheet's Cancel. */
const ST_CLOSE_TAB = 'workbench.action.closeActiveEditor';

/** The folders of the workspace, three levels down, as paths from its root (a few hundred at most), in name order. */
async function stWorkspaceFolders() {
  const folders = (_api.workspace && _api.workspace.workspaceFolders) || [];
  const fs = _api.workspace && _api.workspace.fs;
  if (!folders.length || !fs || typeof fs.readdir !== 'function') return [];
  const found = [];
  let level = [{ uri: String(folders[0].uri).replace(/\/$/, ''), rel: '' }];
  for (let depth = 0; depth < 3 && level.length && found.length < 300; depth++) {
    const next = [];
    const listings = await Promise.all(level.map((d) => fs.readdir(d.uri).catch(() => [])));
    listings.forEach((entries, i) => {
      for (const ent of entries || []) {
        const name = String((ent && ent.name) || '');
        if (!ent || ent.type !== ST_FS_DIRECTORY || !name || name.startsWith('.') || name === 'node_modules') continue;
        const rel = level[i].rel ? `${level[i].rel}/${name}` : name;
        found.push(rel);
        next.push({ uri: `${level[i].uri}/${name}`, rel });
      }
    });
    level = next;
  }
  return found.slice(0, 300).sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }));
}

async function renderNewSubject(host, route, ctx) {
  const door = stSubjectDoor();
  if (!door) {
    _api.ui.createEmptyState(host, { icon: 'database', headline: 'Subjects need canvas databases.', hint: 'This version of Parallx does not offer them to Study.', action: { label: 'Close', command: ST_CLOSE_TAB } });
    return;
  }
  const offered = await stSubjectDatabasesOffered();
  const workspaceFolders = await stWorkspaceFolders();
  if (ctx.disposed()) return;
  // The form: what Create hands to the command (stCmdNewSubject).
  const st = { name: '', folder: '', questions: '', columns: [], mapping: null, busy: false };
  const sheetActions = { form: st, create: () => create() };
  _stSubjectSheet = sheetActions;
  ctx.add({ dispose: () => { if (_stSubjectSheet === sheetActions) _stSubjectSheet = null; if (st.made) _stSubjectOpener = null; } });

  const { sheet, bd } = stSheetFrame(host, ctx, 'A page with its units, questions and work log.', { title: 'New Subject' });
  bd.classList.add('st-subj');
  let seq = 0;
  const field = (label, { hint = '' } = {}) => {
    const row = _api.ui.createBlock(bd, 'div', { className: 'st-subj__row' });
    const lab = _api.ui.createBlock(row, 'span', { className: 'st-row__lab', text: label });
    lab.id = `st-subj-lab-${++seq}`;
    const cell = _api.ui.createBlock(row, 'div', { className: 'st-subj__cell' });
    if (hint) _api.ui.createBlock(row, 'div', { className: 'st-subj__hint', text: hint });
    return cell;
  };

  // Name.
  const name = _api.ui.createInput(field('Name'), { id: 'study.subject.name', label: 'Name', placeholder: 'For example, Exam 7' });
  ctx.add(name);
  const nameInput = name.element.querySelector('input');

  // Sources folder: one of the workspace's.
  const folder = _api.ui.createSelect(field('Sources folder', { hint: 'Optional. Each subfolder becomes a unit, or each PDF, Markdown or text file.' }), {
    id: 'study.subject.folder', label: 'Sources folder', items: [{ value: '', label: 'None' }, ...workspaceFolders.map((f) => ({ value: f, label: f }))], value: '', onChange: (v) => { st.folder = v; } });
  ctx.add(folder);

  // Questions, and the columns of a database he already has.
  const dbItems = (first) => [{ value: '', label: first }, ...offered.map((d) => ({ value: d.id, label: String(d.title || 'Untitled') }))];
  const questions = _api.ui.createSelect(field('Questions'), { id: 'study.subject.questions', label: 'Questions', items: dbItems('New database'), value: '', onChange: (v) => void chooseQuestions(v) });
  ctx.add(questions);
  const mapHost = _api.ui.createBlock(bd, 'div', { className: 'st-subj__map' });
  mapHost.hidden = true;
  let mapSelects = [];
  const clearMap = () => { for (const s of mapSelects) s.dispose(); mapSelects = []; mapHost.replaceChildren(); mapHost.hidden = true; };
  ctx.add({ dispose: () => { for (const s of mapSelects) s.dispose(); } });

  async function chooseQuestions(id) {
    st.questions = id;
    st.mapping = null;
    clearMap();
    say('');
    if (!id) return;
    let info = null;
    try { info = await door.get(id); } catch { info = null; }
    if (ctx.disposed() || st.questions !== id) return;
    if (!info) { say('That database is no longer there.'); return; }
    st.columns = info.columns.filter((c) => c.type !== 'title');
    st.mapping = stSubjectGuessMapping(info.columns);
    const head = _api.ui.createBlock(mapHost, 'div', { className: 'st-subj__maphd' });
    _api.ui.createBlock(head, 'span', { className: 'st-subj__mapt', text: 'Its columns' });
    _api.ui.createBlock(head, 'span', { className: 'st-subj__hint', text: 'The database is used where it is. Only a column it lacks is added; your rows stay as they are.' });
    const grid = _api.ui.createBlock(mapHost, 'div', { className: 'st-subj__grid' });
    const items = [...st.columns.map((c) => ({ value: c.name, label: c.name })), { value: ST_SUBJECT_ADD, label: 'Add a column' }];
    for (const role of ST_SUBJECT_ROLES) {
      const pair = _api.ui.createBlock(grid, 'div', { className: 'st-subj__pair' });
      _api.ui.createBlock(pair, 'span', { className: 'st-row__lab', text: ST_SUBJECT_ROLE_LABELS[role] });
      mapSelects.push(_api.ui.createSelect(pair, { id: `study.subject.map.${role}`, label: ST_SUBJECT_ROLE_LABELS[role], items, value: st.mapping[role] || ST_SUBJECT_ADD,
        onChange: (v) => { st.mapping[role] = v === ST_SUBJECT_ADD ? '' : v; say(''); } }));
    }
    mapHost.hidden = false;
  }

  // Footer: what is wrong (when something is), Cancel, Create.
  const ft = _api.ui.createBlock(sheet, 'div', { className: 'st-sheet__ft' });
  const problem = _api.ui.createBlock(ft, 'div', { className: 'st-subj__problem', attrs: { role: 'alert' } });
  const say = (text) => { problem.textContent = text; };
  const acts = _api.ui.createBlock(ft, 'span', { className: 'st-sheet__acts' });
  _api.ui.createButton(acts, { id: 'study.subject.cancel', label: 'Cancel', kind: 'ghost', command: ST_CLOSE_TAB });
  const createBtn = _api.ui.createButton(acts, { id: 'study.subject.create', label: 'Create', icon: 'plus', kind: 'primary', title: 'Make the page and its databases.', command: 'study.newSubject', args: [st] });

  async function create() {
    if (st.busy) return;
    const title = String(name.value || '').trim();
    if (!title) { say('Give the subject a name.'); if (nameInput) nameInput.focus(); return; }
    if (st.questions && !st.mapping) { say('Its columns are still being read. Try again in a moment.'); return; }
    if (st.mapping) {
      const picked = ST_SUBJECT_ROLES.map((r) => st.mapping[r]).filter(Boolean);
      const twice = picked.find((c, i) => picked.indexOf(c) !== i);
      if (twice) { say(`${twice} is chosen twice. A column can stand for one thing.`); return; }
    }
    st.busy = true;
    createBtn.disabled = true;
    say('');
    try {
      const subject = await stCreateSubject({ name: title, folder: st.folder, questionsDb: st.questions, mapping: st.mapping });
      st.made = true;
      await ctx.closeTab();
      // What was made, on screen: the subject's page, with its databases under it.
      try { if (subject.pageId) await _api.commands.executeCommand('canvas.openPage', subject.pageId); } catch { /* the sidebar shows it all the same */ }
    } catch (err) {
      st.busy = false;
      createBtn.disabled = false;
      if (!stIsStopped(err) && !ctx.disposed()) say(stSentence(stErrText(err)));
    }
  }

  // In the Name field, Enter creates and Escape closes the sheet (the field itself takes both keys, so the sheet's own Escape never hears it).
  sheet.addEventListener('keydown', (e) => {
    if (e.isComposing || !e.target || e.target.tagName !== 'INPUT') return;
    if (e.key === 'Enter') { e.preventDefault(); void create(); }
    else if (e.key === 'Escape') { e.stopPropagation(); void ctx.closeTab(); }
  });
  setTimeout(() => { if (!ctx.disposed() && nameInput && nameInput.isConnected) nameInput.focus(); }, 0);
}
